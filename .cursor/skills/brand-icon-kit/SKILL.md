# Brand icon kit — brush-style PNG pipeline

Generate and wire **Symply Ecosystem** per-brand icon kits (paint-brush / double-stroke green gradient art for Budget, parallel palettes for other brands).

## When to use

- Adding or redrawing icons for any `symply-*` brand
- Replacing Ionicons / SF Symbols / MaterialCommunityIcons with branded PNGs
- Auditing “generic icon” gaps in an app

## Canonical docs (read first)

1. `documents/design/ICON_GENERATION_MANIFEST.md` — version table, naming, states, wire-up
2. `documents/apps/<brand-id>/brand/ICON_SYSTEM_GUIDE.md` — visual language per app
3. `documents/apps/<brand-id>/brand/AI_IMPLEMENTATION_PROMPT.md` — runtime rules (`<Icon>`, gradients)

## Visual contract (Budget example)

| Element | Rule |
|---------|------|
| Grid | 24×24 live area, export **96×96** PNG (@4×) |
| Stroke | 1.8pt rounded caps/joins; brush/double-stroke texture on PNG exports |
| Selected | Brand gradient only (`#5FD49A → #1B7A4C` for Budget) |
| Unselected light | `#536A63` monochrome |
| Unselected dark | `#92A6A0` monochrome |
| Brand mark | Painted ring / ensō — **logo only**, not repeated on every glyph |
| No backgrounds | Never add circles/tiles behind nav icons |

## Generate missing PNGs (from SVG paths — fallback only)

Use **only** when a slug is not on the brush sheets. Prefer slicing sheets:

```bash
node scripts/import-budget-brush-sheets.mjs
APP_BRAND=symply-budget npm run icons:build
```

Vector fallback (no brush texture — avoid for Budget UI):

```bash
node scripts/generate-brand-icon-pngs.mjs symply-budget
```

Import external AI kit (ChatGPT sheet, Figma export):

```bash
node scripts/import-brand-icon-pngs.mjs symply-budget "/path/to/kit/assets/png"
APP_BRAND=symply-budget npm run icons:build
```

## Symply Health brush pipeline (canonical — do not revert)

**Status:** locked 2026-07-20. Regenerated 118 icons × 4 states green.

### Commands

```bash
npm run icons:import-health-brush-sheets   # slice + verify-before-write
npm run icons:verify-health-brush          # full-kit check (--verbose optional)
APP_BRAND=symply-health npm run icons:build
```

### Source → output

- Sheets: `documents/apps/symply-health/brand/brush-sheets/sheet-*.png`
- PNG kit: `brands/symply-health/src/assets/icons/png/{selected,unselected-light,unselected-dark,filled-accent}/`
- Map: `src/brand/icons.generated.ts`

### Script layout (keep together)

| File | Role |
|------|------|
| `scripts/import-health-brush-sheets.mjs` | **Blob detection** (`detectSheetIconBoxes`) — not grid cells |
| `scripts/verify-health-brush-icons.mjs` | Standalone per-icon verifier (all 4 states) |
| `scripts/lib/brush-icon-normalize.mjs` | `stripToRedInk`, `stripSolidMass`, `extractBoxBuffer`, edge-safe centering, `finalizePng({ preserveLightInk })` |
| `scripts/lib/brush-icon-verify.mjs` | Per-icon gates: pixels, bbox, meanAlpha/solidFill, edge margin, premulGhost |

### Pipeline rules

1. **Blob boxes** — ink-region detection per sheet row; fails if slug count mismatch.
2. **Solid plate strip** — `stripSolidMass(minDist=3)` removes red fill tiles; keep brush outlines (meanAlpha selected ~0.62–0.67).
3. **Verify before write** — import checks `selected` + `filled-accent` per slug; exit 1 on any failure.
4. **`preserveLightInk`** — use for `unselected-*` and `filled-accent`; normal finalize only for red `selected`.
5. **Wide/thin exceptions** — `steps` (wide), `more`/`search` (thin) in verify limits.
6. **Kit-only slugs** — `chat`, `face-id`, `fingerprint`, `home`, `members` re-normalized from existing `selected/` PNGs.

### Do not revert to

- Grid-only `extractCellBuffer` import (misaligns/crops captions)
- Import without `brush-icon-verify.mjs` (silent bad crops)
- `finalizePng` white-removal on tinted/white states (destroys glyph pixels)

## Wire into the app

1. **Aliases** — map legacy Ionicons names in `src/components/ui/ioniconAliases.ts`
2. **`<Icon>`** — shared primitive; resolves alias → PNG; tints monochrome PNG for semantic colors
3. **`BrandSymbol`** — tabs/nav; brand PNG wins over vector fallbacks
4. **Start Metro** — `./scripts/start-brand.sh <brand>` regenerates tokens + icons for that brand

## Checklist after adding icons

- [ ] All three core states exist: `selected`, `unselected-light`, `unselected-dark`
- [ ] Tab `brandIcon` overrides in `brands/<id>/brand.cjs` resolve (see `brandIconKits.test.ts`)
- [ ] `APP_BRAND=<id> npm run icons:build` and commit regenerated map **or** rely on `start-brand.sh`
- [ ] No direct `<Ionicons>` / `MaterialCommunityIcons` in brand screens — use `<Icon name="…">`
- [ ] Run `npm test -- --testPathPattern='brandIconKits|Icon.test'`

## Do not

- Fork `<Icon>` per brand — one component, brand data in `brands/<id>/`
- Hardcode brand hex in screens — use theme tokens + kit states
- Use SF Symbols on iOS when the brand kit ships the tab glyph
