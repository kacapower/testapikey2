"""PW app — heavy library files → Hugging Face dataset.
Why this Space exists
---------------------
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
API (api_name="push"): [file, original_name, key] -> public download URL.
Note on the key: it ships inside browser JS, so it stops drive-by abuse of a
public endpoint — it is NOT real authentication. Same trust model as the
anon-key endpoints the app already uses.
"""

import os
import re
import time
import uuid
from collections import deque

import gradio as gr
from huggingface_hub import HfApi

MAX_BYTES = 250 * 1024 * 1024          # matches the library cap in resources.html
RATE_MAX = 12                          # uploads per IP ...
RATE_WINDOW = 600                      # ... per 10 minutes

TOKEN = os.environ.get("HF_TOKEN")
DATASET = os.environ.get("HF_DATASET_REPO", "kacapower/Directory")
UPLOAD_KEY = os.environ.get("PW_UPLOAD_KEY", "")

api = HfApi(token=TOKEN)
_hits: dict[str, deque] = {}


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
