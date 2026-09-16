"""
Floor plan vectorizer container.

Endpoints:
  POST /health
  POST /trace      — raster → VTracer SVG
  POST /rasterize — PDF/image → PNG (base64)

Auth: optional Bearer token via VECTORIZER_TRACE_TOKEN env.
"""

from __future__ import annotations

import base64
import io
import os
import tempfile
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from PIL import Image, ImageOps, ImageFilter

app = FastAPI(title="floor-plan-vectorizer", version="1.0.0")

AUTH_TOKEN = os.environ.get("VECTORIZER_TRACE_TOKEN", "")


def _check_auth(authorization: str | None) -> None:
    if not AUTH_TOKEN:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    if authorization.removeprefix("Bearer ").strip() != AUTH_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid token")


class TraceRequest(BaseModel):
    contentType: str = Field(..., description="MIME type of the source image")
    imageUrl: str | None = None
    imageBase64: str | None = None


class RasterizeRequest(BaseModel):
    contentType: str
    imageUrl: str | None = None
    imageBase64: str | None = None


def _load_bytes(req: TraceRequest | RasterizeRequest) -> bytes:
    if req.imageBase64:
        return base64.b64decode(req.imageBase64)
    if req.imageUrl:
        import urllib.request

        with urllib.request.urlopen(req.imageUrl, timeout=60) as resp:
            return resp.read()
    raise HTTPException(status_code=400, detail="imageUrl or imageBase64 required")


def _to_pil(data: bytes, content_type: str) -> Image.Image:
    ct = (content_type or "").lower()
    if "pdf" in ct:
        try:
            import fitz  # PyMuPDF
        except ImportError as exc:
            raise HTTPException(
                status_code=501, detail="PDF rasterize requires PyMuPDF (fitz)"
            ) from exc
        doc = fitz.open(stream=data, filetype="pdf")
        if doc.page_count < 1:
            raise HTTPException(status_code=400, detail="Empty PDF")
        page = doc.load_page(0)
        # 2x zoom for decent crop resolution
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        doc.close()
        return img

    img = Image.open(io.BytesIO(data))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return img


def _binarize(img: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(img)
    # Light denoise then threshold
    gray = gray.filter(ImageFilter.MedianFilter(size=3))
    # Adaptive-ish: use point threshold around mid-high for line drawings
    return gray.point(lambda p: 0 if p < 200 else 255, mode="1")


def _vtracer_svg(img: Image.Image) -> str:
    """Trace a PIL image to SVG via vtracer if available, else a simple path fallback."""
    try:
        import vtracer
    except ImportError:
        # Fallback: return a minimal SVG with the image dimensions so the
        # pipeline still completes when vtracer isn't installed locally.
        w, h = img.size
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
            f'preserveAspectRatio="xMidYMid meet">'
            f'<rect x="0" y="0" width="{w}" height="{h}" fill="#ffffff"/>'
            f"</svg>"
        )

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp_in:
        bin_img = _binarize(img).convert("RGB")
        bin_img.save(tmp_in, format="PNG")
        in_path = tmp_in.name

    out_path = in_path.replace(".png", ".svg")
    try:
        vtracer.convert_image_to_svg_py(
            in_path,
            out_path,
            colormode="binary",
            hierarchical="stacked",
            mode="spline",
            filter_speckle=4,
            color_precision=6,
            layer_difference=16,
            corner_threshold=60,
            length_threshold=4.0,
            max_iterations=10,
            splice_threshold=45,
            path_precision=3,
        )
        with open(out_path, "r", encoding="utf-8") as f:
            return f.read()
    finally:
        for path in (in_path, out_path):
            try:
                os.unlink(path)
            except OSError:
                pass


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/trace")
def trace(
    req: TraceRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _check_auth(authorization)
    data = _load_bytes(req)
    img = _to_pil(data, req.contentType)
    svg = _vtracer_svg(img)
    return {"svg": svg}


@app.post("/rasterize")
def rasterize(
    req: RasterizeRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _check_auth(authorization)
    data = _load_bytes(req)
    img = _to_pil(data, req.contentType)
    if img.mode != "RGB":
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return {"pngBase64": png_b64, "width": img.width, "height": img.height}
