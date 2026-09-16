#!/usr/bin/env python3
"""
Build per-brand app icons: the brand brush mark on a soft, brand-tinted diagonal
gradient. One coherent treatment across both iOS appearances —

  * light  (app-icon.png / app-icon-light.png): pale tint (top-left) ->
    soft brand tint (bottom-right) on white.
  * dark   (app-icon-dark.png): deep ink (top-left) -> richer brand tint
    (bottom-right), with the mark brightened toward primaryLight so it pops.

For each brand it:
  1. Reads brand colors (primary / primaryDark / primaryLight) from tokens.json.
  2. Takes the clean mark on transparency from .../logo-splash.png.
  3. Composites it, at the mark's original size/position, over the gradient.
  4. Writes opaque RGB (no alpha channel — iOS App Store icons may not have alpha).

Geometry (scale + center) is baked per brand so the mark lands exactly where it
did on the original icons; re-running is idempotent and independent of the
current icon contents. Tint strength lives in the TINT_* constants.

Requires Pillow.  Usage:
    python3 scripts/build-brand-app-icons.py                     # all brands, both modes
    python3 scripts/build-brand-app-icons.py symply-house        # one brand
    python3 scripts/build-brand-app-icons.py --light-only        # skip dark variant
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZE = 1024

# White->primary mix for the LIGHT gradient endpoints. Kept deliberately light so
# the mark stays the hero and the icon reads on any home-screen wallpaper.
TINT_TOP = 0.07     # top-left (near white)
TINT_BOTTOM = 0.24  # bottom-right (soft brand tint)

# Per-brand LIGHT-tint overrides. Equal white->primary ratios do NOT read equally
# strong across hues: a high-luminance periwinkle (Kaizen #5B7CFF) keeps its blue
# channel pinned at 255 when mixed with white, so at the family default it reads as
# "cool white" rather than blue. An override mixes white toward an explicit anchor at
# custom ratios so the tint lands where we want per brand.
# Each value: {"hex": <#rrggbb>, "top": <ratio>, "bottom": <ratio>}  (or "toward":
# <brand color key> to anchor on a brand token instead of a literal hex).
LIGHT_TINT_OVERRIDES = {
    # Kaizen: soft azure/cornflower backdrop — a light, clearly-present blue in the
    # spirit of the iOS "Preview"-style tile, but lighter. Anchored on a cornflower
    # (#6496E8) rather than the purple-leaning brand periwinkle so it reads azure.
    "symply-kaizen": {"hex": "#6496E8", "top": 0.12, "bottom": 0.42},
}

# Ink->primary mix for the DARK gradient endpoints, over a deep near-black base.
INK = (10, 14, 21)
DARK_TINT_TOP = 0.05     # top-left (near black, faint hue)
DARK_TINT_BOTTOM = 0.30  # bottom-right (richer brand tint)
DARK_MARK_LIGHTEN = 0.34  # blend the brush toward primaryLight so it pops on dark

# scale = mark size relative to the logo-splash mark's alpha bounding box;
# (cx, cy) = mark center on the 1024x1024 canvas. Measured from the original
# icons so placement is preserved exactly.
BRANDS = {
    "symply-budget":   {"scale": 0.9508, "center": (509.5, 490.0)},
    "symply-health":   {"scale": 0.8325, "center": (511.0, 476.5)},
    "symply-house":    {"scale": 0.8133, "center": (514.0, 494.5)},
    "symply-language": {"scale": 0.8263, "center": (529.0, 490.0)},
    "symply-kaizen":   {"scale": 0.7623, "center": (513.5, 489.0)},
}


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(3))


def brand_colors(brand):
    b = json.load(open(os.path.join(ROOT, "brands", brand, "tokens.json")))["brand"]
    return {k: hex_to_rgb(b[k]["$value"]) for k in ("primary", "primaryDark", "primaryLight")}


def diagonal_gradient(tl, br):
    """Linear gradient, corner `tl` (top-left) -> corner `br` (bottom-right)."""
    img = Image.new("RGB", (SIZE, SIZE))
    px = img.load()
    denom = 2 * (SIZE - 1)
    for y in range(SIZE):
        for x in range(SIZE):
            f = (x + y) / denom  # 0 at TL, 1 at BR
            px[x, y] = tuple(round(tl[i] * (1 - f) + br[i] * f) for i in range(3))
    return img


def load_mark(brand, cfg, tint_toward=None, amount=0.0):
    """The brush mark, cropped and scaled to its original footprint. Optionally
    blend the RGB toward `tint_toward` (keeping the brush's alpha/texture)."""
    imgdir = os.path.join(ROOT, "brands", brand, "src", "assets", "images")
    mark = Image.open(os.path.join(imgdir, "logo-splash.png")).convert("RGBA")
    mark = mark.crop(mark.getbbox())
    w = max(1, round(mark.width * cfg["scale"]))
    h = max(1, round(mark.height * cfg["scale"]))
    mark = mark.resize((w, h), Image.LANCZOS)
    if tint_toward and amount:
        r, g, b, a = mark.split()
        tint = Image.new("RGB", mark.size, tuple(round(c) for c in tint_toward))
        blended = Image.blend(Image.merge("RGB", (r, g, b)), tint, amount)
        mark = Image.merge("RGBA", (*blended.split(), a))
    return mark, w, h


def paste_centered(bg, mark, w, h, center):
    cx, cy = center
    bg.paste(mark, (round(cx - w / 2), round(cy - h / 2)), mark)


def build(brand, light_only=False):
    cfg = BRANDS[brand]
    imgdir = os.path.join(ROOT, "brands", brand, "src", "assets", "images")
    c = brand_colors(brand)
    written = []

    # --- light ---
    ov = LIGHT_TINT_OVERRIDES.get(brand)
    if ov:
        tint_anchor = hex_to_rgb(ov["hex"]) if "hex" in ov else c[ov["toward"]]
        tint_top, tint_bottom = ov["top"], ov["bottom"]
    else:
        tint_anchor, tint_top, tint_bottom = c["primary"], TINT_TOP, TINT_BOTTOM
    light = diagonal_gradient(
        mix((255, 255, 255), tint_anchor, tint_top),
        mix((255, 255, 255), tint_anchor, tint_bottom),
    )
    mark, w, h = load_mark(brand, cfg)
    paste_centered(light, mark, w, h, cfg["center"])
    for name in ("app-icon.png", "app-icon-light.png"):
        light.save(os.path.join(imgdir, name))  # RGB -> no alpha channel
        written.append(name)

    # --- dark ---
    if not light_only:
        dark = diagonal_gradient(
            mix(INK, c["primaryDark"], DARK_TINT_TOP),
            mix(INK, c["primary"], DARK_TINT_BOTTOM),
        )
        mark, w, h = load_mark(brand, cfg, tint_toward=c["primaryLight"], amount=DARK_MARK_LIGHTEN)
        paste_centered(dark, mark, w, h, cfg["center"])
        dark.save(os.path.join(imgdir, "app-icon-dark.png"))
        written.append("app-icon-dark.png")

    print(f"[icons] {brand}: {', '.join(written)}")


def main():
    args = sys.argv[1:]
    light_only = "--light-only" in args
    targets = [a for a in args if not a.startswith("--")] or list(BRANDS)
    for brand in targets:
        if brand not in BRANDS:
            sys.exit(f"unknown brand: {brand} (known: {', '.join(BRANDS)})")
        build(brand, light_only=light_only)


if __name__ == "__main__":
    main()
