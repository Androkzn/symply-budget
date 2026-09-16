# Lender logo sources

Drop raw lender logo images here to bundle real wordmarks into the app.

## How

1. Add a source image named by the lender **slug** (from `src/utils/lender-logos.ts` →
   `POPULAR_LENDERS`), e.g. `td.svg`, `rbc.png`, `national-bank.svg`.
   Supported: `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`. SVG or a high-res transparent
   PNG gives the crispest result.
2. Run the normalizer:

   ```sh
   npm run logos:lenders
   ```

   Each image is trimmed, letterboxed onto a transparent 160×160 square, and written to
   `src/assets/images/lenders/<slug>.png`. The require-map
   `src/utils/lender-logos.generated.ts` is regenerated with exactly the slugs that produced
   an asset. `<LenderLogo>` then renders the real logo automatically — no code change.

Alternatively, list source **URLs** in `scripts/lender-logos.manifest.mjs` and the script
will download them. A local file here always wins over a manifest URL.

## Trademarks

Bank names and logos are trademarks of their owners. Only add images you are entitled to use
(an official brand/press kit, or your own licensed copies). Nothing in this folder is tracked
or fetched by default — lenders without an asset simply render a branded monogram tile.

> This folder is intentionally empty except for this README.
