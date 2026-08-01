import io

import gradio as gr
from PIL import Image, ImageOps

# ---- compression rules ----
MAX_SIDE = 1920          # longest edge after resize (keeps handwriting readable)
MIN_QUALITY = 35         # never go below — text becomes unreadable
MAX_QUALITY = 85
SKIP_BELOW = 500 * 1024  # < 500 KB: return as-is
FLOOR_BYTES = 300 * 1024 # never target below 300 KB
CAP_BYTES = 2 * 1024 * 1024  # output never needs to exceed 2 MB


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


with gr.Blocks() as demo:
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

demo.launch()
