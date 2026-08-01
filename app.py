"""PW app — image compressor + heavy library files → Hugging Face dataset.

Two independent tools share one Space so there is one URL and one set of
secrets to manage. They do not interact: the compressor is pure in-process
Pillow work, the uploader only touches the HF dataset.

API endpoints
-------------
  /compress         [image, original_kb, target_ratio] -> compressed JPEG path
  /compress_manual  [image, quality]                   -> compressed JPEG path
  /push             [file, original_name, key]         -> public download URL

Why the uploader exists
-----------------------
Library files used to go through the Supabase Edge Function `hf-upload`. That
can never work: Supabase Edge Functions cap **CPU time at 2 seconds**, and
@huggingface/hub hashes + encodes the whole payload in-process. Measured on the
live project: a 12-byte file succeeded, but 256 KB / 2 MB / 10 MB / 45 MB all
died with WORKER_RESOURCE_LIMIT in ~0.9 s. Every real upload silently fell back
to Supabase storage, which is itself hard-capped at 50 MB on the free plan.
So the bytes have to skip Supabase entirely. Gradio streams uploads to disk
(free CPU Space = 16 GB RAM / 50 GB disk), so 250 MB is comfortable here.
The HF write token stays a Space secret and never reaches a browser.

Space secrets (Settings → Variables and secrets):
  HF_TOKEN         = hf_...  (WRITE access to the dataset)
  HF_DATASET_REPO  = kacapower/Directory   (must be a PUBLIC dataset, else the
                     returned resolve/ links 401 for everyone)
  PW_UPLOAD_KEY    = any random string, must match PW_UPLOAD_KEY in js/config.js

Note on the key: it ships inside browser JS, so it stops drive-by abuse of a
public endpoint — it is NOT real authentication. Same trust model as the
anon-key endpoints the app already uses.
"""

import io
import os
import re
import time
import uuid
from collections import deque

import gradio as gr
from huggingface_hub import HfApi
from PIL import Image, ImageOps

# ---- compression rules ----
MAX_SIDE = 1920          # longest edge after resize (keeps handwriting readable)
MIN_QUALITY = 35         # never go below — text becomes unreadable
MAX_QUALITY = 85
SKIP_BELOW = 500 * 1024  # < 500 KB: return as-is
FLOOR_BYTES = 300 * 1024 # never target below 300 KB
CAP_BYTES = 2 * 1024 * 1024  # output never needs to exceed 2 MB

# ---- uploader config ----
MAX_BYTES = 250 * 1024 * 1024          # matches the library cap in resources.html
RATE_MAX = 12                          # uploads per IP ...
RATE_WINDOW = 600                      # ... per 10 minutes

TOKEN = os.environ.get("HF_TOKEN")
DATASET = os.environ.get("HF_DATASET_REPO", "kacapower/Directory")
UPLOAD_KEY = os.environ.get("PW_UPLOAD_KEY", "")

api = HfApi(token=TOKEN)
_hits: dict[str, deque] = {}


def _encode(image, quality):
    """JPEG-encode in memory, return bytes (metadata stripped by re-encode)."""
    buf = io.BytesIO()
    image.save(buf, "JPEG", optimize=True, quality=quality)
    return buf.getvalue()


def _prepare(image):
    """EXIF-rotate, flatten transparency, force RGB."""
    image = ImageOps.exif_transpose(image)
    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
        bg = Image.new("RGB", image.size, (255, 255, 255))
        bg.paste(image, mask=image.split()[-1])
        return bg
    if image.mode != "RGB":
        return image.convert("RGB")
    return image


def compress(image, original_kb, target_ratio=10):
    """
    Compress to ~original/target_ratio bytes.
    original_kb: size of the file the client read from disk (KB) — the client
    knows the real file size; a decoded PIL image does not carry it.
    Returns path of the compressed JPEG.
    """
    out_path = "compressed_output.jpg"
    original_bytes = int(float(original_kb) * 1024)
    image = _prepare(image)

    # rule 1: tiny files pass through (still re-encoded once at high quality)
    if 0 < original_bytes < SKIP_BELOW:
        data = _encode(image, MAX_QUALITY)
        with open(out_path, "wb") as f:
            f.write(data)
        return out_path

    # target: /10, clamped to [300 KB, 2 MB]
    target = max(FLOOR_BYTES, min(original_bytes // int(target_ratio), CAP_BYTES))

    # rule 2: resize first — the big lever
    w, h = image.size
    longest = max(w, h)
    if longest > MAX_SIDE:
        scale = MAX_SIDE / longest
        image = image.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)

    # rule 3: binary-search quality to land on target size
    lo, hi = MIN_QUALITY, MAX_QUALITY
    best = _encode(image, MIN_QUALITY)  # guaranteed smallest candidate
    while lo <= hi:
        mid = (lo + hi) // 2
        data = _encode(image, mid)
        if len(data) <= target:
            best = data          # fits — try higher quality
            lo = mid + 1
        else:
            hi = mid - 1

    with open(out_path, "wb") as f:
        f.write(best)
    return out_path


def compress_manual(image, quality_score):
    """Original manual mode — kept for the UI slider."""
    out_path = "compressed_output.jpg"
    image = _prepare(image)
    with open(out_path, "wb") as f:
        f.write(_encode(image, int(quality_score)))
    return out_path


def _rate_ok(ip):
    now = time.time()
    q = _hits.setdefault(ip, deque())
    while q and now - q[0] > RATE_WINDOW:
        q.popleft()
    if len(q) >= RATE_MAX:
        return False
    q.append(now)
    return True


def _ext(name):
    """Same sanitising rule the old hf-upload edge function used."""
    raw = (name or "file.bin").rsplit(".", 1)[-1].lower()
    return re.sub(r"[^a-z0-9]", "", raw)[:8] or "bin"


def push(file_path, original_name, key, request: gr.Request):
    """Upload one file to the dataset, return its permanent public URL."""
    if not TOKEN:
        raise gr.Error("Space is not configured: HF_TOKEN secret is missing.")
    if UPLOAD_KEY and key != UPLOAD_KEY:
        raise gr.Error("Rejected: bad upload key.")

    ip = getattr(getattr(request, "client", None), "host", "?") if request else "?"
    if not _rate_ok(ip):
        raise gr.Error("Too many uploads from this device — try again in a few minutes.")

    if not file_path or not os.path.exists(file_path):
        raise gr.Error("No file received.")

    size = os.path.getsize(file_path)
    if size == 0:
        raise gr.Error("Empty file.")
    if size > MAX_BYTES:
        raise gr.Error(f"File is {size / 1048576:.1f} MB — the limit is 250 MB.")

    path_in_repo = f"files/{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}.{_ext(original_name)}"
    api.upload_file(
        path_or_fileobj=file_path,
        path_in_repo=path_in_repo,
        repo_id=DATASET,
        repo_type="dataset",
        commit_message=f"pw-app upload: {path_in_repo}",
    )
    return f"https://huggingface.co/datasets/{DATASET}/resolve/main/{path_in_repo}"


with gr.Blocks() as demo:
    with gr.Tab("Image Compressor"):
        gr.Markdown("## Image Compressor")
        gr.Markdown("Auto mode targets ~1/10 of the original file size (10 MB → ~1 MB) "
                    "while keeping text readable. Manual mode uses the quality slider.")

        with gr.Tab("Auto (API)"):
            with gr.Row():
                with gr.Column():
                    a_img = gr.Image(type="pil", label="Original Image")
                    a_kb = gr.Number(value=0, label="Original file size (KB)")
                    a_ratio = gr.Number(value=10, label="Target ratio (10 = shrink to 1/10)")
                    a_btn = gr.Button("Compress (auto)")
                with gr.Column():
                    a_out = gr.Image(type="filepath", label="Compressed Output")
            a_btn.click(fn=compress, inputs=[a_img, a_kb, a_ratio], outputs=a_out,
                        api_name="compress")

        with gr.Tab("Manual"):
            with gr.Row():
                with gr.Column():
                    m_img = gr.Image(type="pil", label="Original Image")
                    m_q = gr.Slider(minimum=1, maximum=100, step=1, value=75,
                                    label="Compression Quality (1-100)")
                    m_btn = gr.Button("Compress Image")
                with gr.Column():
                    m_out = gr.Image(type="filepath", label="Compressed Output")
            m_btn.click(fn=compress_manual, inputs=[m_img, m_q], outputs=m_out,
                        api_name="compress_manual")

    with gr.Tab("Library Uploader"):
        gr.Markdown("## PW Library — heavy file uploader")
        gr.Markdown(
            f"Pushes files up to **250 MB** into the `{DATASET}` dataset and returns a "
            "permanent public download link. Used by the DoubtShare library page."
        )
        with gr.Row():
            with gr.Column():
                f_in = gr.File(label="File", type="filepath")
                f_name = gr.Textbox(label="Original filename", value="file.bin")
                f_key = gr.Textbox(label="Upload key", type="password")
                f_btn = gr.Button("Upload to dataset", variant="primary")
            f_out = gr.Textbox(label="Public URL", buttons=["copy"])
        f_btn.click(fn=push, inputs=[f_in, f_name, f_key], outputs=f_out, api_name="push")

demo.queue(max_size=20).launch(max_file_size="250mb")
