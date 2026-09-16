/**
 * brand-prompts.mjs — ONE unified paint-brush icon prompt, parameterized per
 * brand. This is the single source of truth that keeps every generated icon in
 * the same handcrafted family across all five apps.
 *
 * The user authored five per-brand master prompts (House teal, Budget green,
 * Kaizen lime→blue, Language orange, Health coral-red). They shared ~90% of
 * their text — the same brush-texture rules, the same hard "no circle / no tile
 * / no text / transparent 1024²" restrictions, the same composition. This file
 * factors that shared spine into `buildIconPrompt()` and keeps only what truly
 * differs per brand in BRANDS: display name, palette, and a one-line style/tone
 * nuance.
 *
 * Two builders:
 *   buildIconPrompt(brandId, name, concept)  → one standalone transparent icon
 *                                              (the reliable path — 1 PNG/call,
 *                                              no sheet slicing).
 *   buildSheetPrompt(brandId, items, grid)    → a labeled grid sheet for manual
 *                                              generation in ChatGPT/Canva when
 *                                              you'd rather draw many at once.
 */

/** @typedef {{name:string, palette:string[], gradientDir:string, styleLine:string, tone:string}} BrandCfg */

/** @type {Record<string, BrandCfg>} */
export const BRANDS = {
  'symply-house': {
    name: 'Symply House',
    palette: ['#7EDDD6', '#4ECDC4', '#3DBDB5', '#2D9D96'],
    gradientDir: 'from lighter mint teal at the upper-left to deeper teal at the lower-right',
    styleLine:
      'minimalist UX/UI line icons drawn with natural paint-brush strokes — medium-thick, ' +
      'rounded ends, subtle visible bristle texture and small dry-brush tails at a few stroke ends',
    tone: 'calm, trustworthy, home-management',
  },
  'symply-budget': {
    name: 'Symply Budget',
    palette: ['#5FD49A', '#2BB673', '#239A61', '#1B7A4C'],
    gradientDir: 'from light lime/mint green at the top-left to dark emerald green at the lower-right',
    styleLine:
      'minimalist hand-painted brush-outline icons — mostly outline based, rounded geometry, ' +
      'consistent medium-to-thick stroke weight, slight natural dry-brush texture and subtle ' +
      'tapering with tiny visible brush fibers at selected stroke ends',
    tone: 'calm, precise, trustworthy financial-app',
  },
  'symply-kaizen': {
    name: 'Symply Life',
    palette: ['#A8F43D', '#35D77A', '#12C7C8', '#2674F5'],
    gradientDir:
      'one continuous gradient flowing through each stroke: bright lime green at the top-left, ' +
      'through fresh emerald, to teal/cyan in the middle, to clear electric blue at the lower-right',
    styleLine:
      'modern hand-painted brush line-art — rounded expressive strokes, slightly imperfect painted ' +
      'edges and visible dry-brush texture, minimal line-art construction, smooth controlled shapes',
    tone: 'calm, motivational, premium wellness/productivity',
  },
  'symply-language': {
    name: 'Symply Language',
    palette: ['#F0A06E', '#E07A3D', '#C9662E', '#A85222'],
    gradientDir: 'with the primary #E07A3D leading and subtle natural brush variation from the other palette tones',
    styleLine:
      'handcrafted dry-paint-brush pictograms — visible bristle texture, slightly uneven edges, small ' +
      'natural gaps, subtle stroke-thickness variation, rounded friendly geometry, medium-thick strokes',
    tone: 'warm, friendly, encouraging, practice-focused',
  },
  'symply-health': {
    name: 'Symply Health',
    palette: ['#F07A7E', '#E5484D', '#D1383C', '#B02A2E'],
    gradientDir: 'led by #E5484D with restrained tonal variation from the other coral-red palette tones inside the strokes',
    styleLine:
      'minimal hand-painted brush strokes inspired by Japanese ink-brush and dry acrylic brushwork — ' +
      'natural bristle marks, slightly uneven edges, subtle paint-density variation, small dry-brush gaps, ' +
      'a smooth confident silhouette at consistent medium stroke thickness',
    tone: 'human, calm, authentic, premium',
  },
};

export const ALL_BRAND_IDS = Object.keys(BRANDS);

/** Shared hard restrictions — merged verbatim intent from all five prompts. */
const RESTRICTIONS = [
  'Draw ONLY the requested pictogram — one standalone symbol, perfectly centered.',
  'NO enclosing circle, ring, halo, badge, or brush surround around the icon. A circle may appear only when it is intrinsic to the concept itself (clock, target, progress ring, pie chart, currency coin, profile head, sync arrows).',
  'NO app-icon tile, square, rounded-rectangle, card, button, or container background.',
  'NO decorative background brush strokes, splashes, or flourishes unrelated to the meaning.',
  'NO shadow, glow, bevel, emboss, 3D, glossy or glass effect, metallic texture, or photorealism.',
  'NO thin perfectly-smooth technical vector lines, no monoline, no black outlines.',
  'NO text, letters, captions, labels, numbers, or watermark inside the icon (unless a letter is intrinsic to the concept, e.g. "AI", "XP", "ABC").',
  'Do NOT crop any brush stroke; keep everything inside a safe margin.',
  'Keep it simple and recognizable at 24, 32, 48 and 64 px — avoid tiny details that vanish when small.',
];

/**
 * Build the single-icon generation prompt (the reliable path).
 * @param {string} brandId
 * @param {string} name    kebab-case slug, becomes the filename
 * @param {string} concept short visual description of WHAT to draw
 */
export function buildIconPrompt(brandId, name, concept) {
  const b = BRANDS[brandId];
  if (!b) throw new Error(`Unknown brand: ${brandId}`);
  const label = name.replace(/-/g, ' ');
  return [
    `Create one standalone mobile-app UI icon for "${b.name}".`,
    ``,
    `Icon: "${label}".`,
    `Visual concept: ${concept}.`,
    ``,
    `STYLE: ${b.styleLine}. It must look genuinely hand-painted yet stay clean, professional and ` +
      `recognizable — ${b.tone} in feel. Maintain the same visual weight, brush density, scale and ` +
      `detail level as the rest of this icon family. Not a rough sketch, not watercolor, not a child's drawing, not clip-art.`,
    ``,
    `CONSTRUCTION: build the icon from thin-to-medium hand-painted brush OUTLINE strokes only — an ` +
      `outlined line-art pictogram. Do NOT fill shapes with solid color; do NOT render solid silhouettes ` +
      `or bold filled blobs. It is line art drawn with a brush, not a painted-in shape.`,
    ``,
    `INTERRUPTED DRY-BRUSH (the single most important quality — study it carefully): every stroke must ` +
      `look painted with a nearly-dry brush, so the lines are visibly BROKEN and DISCONTINUOUS. Along each ` +
      `stroke leave clear GAPS OF MISSING COLOR — bare transparent breaks where the brush skipped and laid ` +
      `down no paint at all — plus ink-starved thinning patches and scratchy bristle streaks. The outline ` +
      `should read as an intermittent, interrupted dry-brush line with real holes in it, NOT a smooth ` +
      `continuous line and NOT a solid filled shape. Roughly every stroke has several skips/gaps. Despite ` +
      `the breaks the pictogram must stay instantly recognizable, exactly like the interrupted dry-brush ` +
      `reference icons in this family.`,
    ``,
    `COLOR: use ONLY the ${b.name} palette ${b.palette.join(', ')}, applied as a smooth gradient across ` +
      `each stroke ${b.gradientDir}. Do not introduce any unrelated colors, and no white fills.`,
    ``,
    `COMPOSITION: one centered icon occupying ~68% of the canvas with generous transparent padding, ` +
      `front-facing flat 2D, no perspective unless essential to read the object.`,
    ``,
    `RESTRICTIONS:`,
    ...RESTRICTIONS.map(r => `• ${r}`),
    ``,
    `OUTPUT: a 1024×1024 PNG with a genuinely transparent (alpha) background — never a white or ` +
      `checkerboard background. Crisp high-resolution edges that preserve the natural brush texture.`,
  ].join('\n');
}

/** The negative-prompt companion (for models that take one separately). */
export const NEGATIVE_PROMPT =
  'perfect vector lines, monoline icon, circular icon background, circle around icon, enclosing ring, ' +
  'badge, app icon tile, rounded-square container, button, white background, visible checkerboard, ' +
  'glossy, 3D, bevel, emboss, glassmorphism, metallic, drop shadow, glow, neon, photorealistic, ' +
  'watercolor blob, messy sketch, thin inconsistent lines, black outlines, unrelated colors, text, ' +
  'labels, captions, watermark, logo, cropped icon, overlapping icons, inconsistent scale';

/**
 * Build a labeled-grid sheet prompt (for hand-generating many at once, then
 * slicing with scripts/extract-icon-sheet.mjs).
 * @param {string} brandId
 * @param {Array<{name:string, concept:string}>} items
 * @param {{cols:number, rows:number}} grid
 */
export function buildSheetPrompt(brandId, items, grid = { cols: 4, rows: 3 }) {
  const b = BRANDS[brandId];
  if (!b) throw new Error(`Unknown brand: ${brandId}`);
  const list = items.map((it, i) => `${i + 1}. ${it.name} — ${it.concept}`).join('\n');
  return [
    `Create a high-resolution asset sheet of ${items.length} UI icons for "${b.name}", in a precise ` +
      `${grid.cols}-column × ${grid.rows}-row grid.`,
    ``,
    `Every icon uses the SAME style: ${b.styleLine}. Consistent scale, brush density and stroke weight ` +
      `across all — one internally consistent family, not icons by different designers.`,
    ``,
    `COLOR: ONLY the ${b.name} palette ${b.palette.join(', ')}, gradient ${b.gradientDir}.`,
    ``,
    `Put the exact icon name beneath each icon in a small dark navy (#071B33) sans-serif label that does ` +
      `not touch the icon. Clean off-white background, equal cells, generous spacing so each pictogram can ` +
      `be cropped into its own transparent PNG afterwards.`,
    ``,
    `RESTRICTIONS (per icon):`,
    ...RESTRICTIONS.map(r => `• ${r}`),
    ``,
    `Icons, row by row, left to right:`,
    list,
  ].join('\n');
}
