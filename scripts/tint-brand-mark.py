#!/usr/bin/env python3
"""
Recolor a brand's `logo-splash.png` brush mark to a new accent-scheme hue,
preserving its own shading (saturation/value) and alpha — so the mark's
lighting/gradient structure carries over, just repainted onto a different
color. Used to generate the Symply Budget accent-scheme splash marks (see
`src/theme/accentSchemes.ts`, `src/brand/assets.ts`).

Every sufficiently-saturated pixel gets its hue replaced with the target
color's hue; near-white/near-gray pixels (highlights, specular detail) are
left untouched so they don't pick up a color cast. Fully transparent pixels
are skipped.

Usage:
    python3 scripts/tint-brand-mark.py <src.png> <out.png> <#targetHex> [--min-sat 0.12]
"""
import argparse
import colorsys

from PIL import Image


def hex_to_rgb01(h: str):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))


def tint_mark(src_path: str, out_path: str, target_hex: str, ref_hex: str, min_sat: float) -> None:
    target_h, target_s, _target_v = colorsys.rgb_to_hsv(*hex_to_rgb01(target_hex))
    _ref_h, ref_s, _ref_v = colorsys.rgb_to_hsv(*hex_to_rgb01(ref_hex))
    # Scale each pixel's saturation by how much more/less saturated the target
    # is than the reference (classic brand primary) — so a muted target (e.g.
    # sage) actually reads as muted, instead of inheriting the source mark's
    # own (often more vibrant) saturation at the new hue.
    sat_ratio = target_s / ref_s if ref_s > 0 else 1.0

    im = Image.open(src_path).convert("RGBA")
    w, h = im.size
    px = im.load()

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            hue, sat, val = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if sat < min_sat:
                # Near-white/gray highlight — leave as-is, don't tint.
                continue
            new_sat = max(0.0, min(1.0, sat * sat_ratio))
            nr, ng, nb = colorsys.hsv_to_rgb(target_h, new_sat, val)
            px[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)

    im.save(out_path)
    print(f"[tint-brand-mark] {src_path} -> {out_path} (hue -> {target_hex}, sat x{sat_ratio:.2f})")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("src")
    parser.add_argument("out")
    parser.add_argument("target_hex")
    parser.add_argument("--ref-hex", default="#2BB673", help="Source mark's own brand primary (saturation baseline)")
    parser.add_argument("--min-sat", type=float, default=0.12)
    args = parser.parse_args()
    tint_mark(args.src, args.out, args.target_hex, args.ref_hex, args.min_sat)


if __name__ == "__main__":
    main()
