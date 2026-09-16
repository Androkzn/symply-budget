/**
 * A shopping selection → a finish the renderer can draw.
 *
 * ## The gap this closes
 *
 * `home_project_selections` is where a material *arrives*: imported from a shop
 * link, read off a shelf photo, or typed in. `materialSchema` in
 * `room-surface-model.ts` is where a material is *drawn*: on a wall, at true
 * scale, with its joints. Until this file there was no path between them, so a
 * member who had just imported a 600×600 porcelain tile — colour, size, grout
 * and photo all captured by the importer — still had to hand-type a hex into
 * the finish editor before the wall stopped rendering as a flat grey.
 *
 * Migration 0164 put the four finish inputs on the selection row
 * (`color_hex`, `grout_color_hex`, `unit_w_mm`, `unit_h_mm`). This is the
 * function that reads them.
 *
 * ## The two things it refuses to do
 *
 * Both are refusals to *invent*, and both exist because the output of this
 * function is a picture a member makes a purchase against.
 *
 *  1. **No colour, no finish.** `materialSchema.colorHex` is required, and the
 *     contract says why: it is what the renderer draws before the texture has
 *     downloaded, offline, and at thumbnail size. A neutral placeholder would
 *     satisfy the schema and put a grey rectangle on the wall that is
 *     indistinguishable from a finish the member chose — the failure is silent,
 *     survives into a preview, and the member never learns the app made the
 *     colour up. So the conversion FAILS with `reason: 'missing_color'` and the
 *     caller prompts. `MaterialEditorSheet`'s colour picker is that prompt and
 *     it already exists; a placeholder would route around it.
 *  2. **No stated size, no repeat.** A missing `unit_w_mm`/`unit_h_mm` means a
 *     non-repeating finish, NOT a guessed tile. `MATERIAL_KIND_DEFAULTS.tile`
 *     holds a 300×300 default that is right for the editor — where the member
 *     is looking at the number and can change it — and wrong here, where
 *     nothing on screen would say the size was assumed. A tile drawn at 300 mm
 *     that is really 600 mm shows twice as many joints and orders four times
 *     the tiles, with total confidence.
 *
 * The same reasoning bounds which kind-defaults are carried at all: see
 * `carryableDefaults` below.
 *
 * Pure. No React, no network, no ledger — the Worker promotes selections too.
 */

import { normalizeHexColor } from './home-project-material';
import { MATERIAL_KIND_DEFAULTS } from './room-surface/materials';
import {
  materialSchema,
  type Material,
  type MaterialKind,
} from './room-surface-model';

/**
 * The `home_project_selections` columns this bridge reads.
 *
 * Declared structurally rather than imported from `src/api/home-projects.ts`
 * because contracts may not reach into the app — and because the four 0164
 * columns are optional here on purpose: a client built before they landed on
 * the DTO still satisfies this type and simply converts to a finish with no
 * colour, which is the honest answer rather than a type error.
 */
export interface SelectionFinishInput {
  id: string;
  name: string;
  /** The importer's lowercase material class — 'tile', 'paint', 'flooring'. */
  category?: string | null;
  /** `#rrggbb` (migration 0164). Null is the case rule 1 above refuses. */
  color_hex?: string | null;
  grout_color_hex?: string | null;
  /** One repeat's real size, millimetres (migration 0164). */
  unit_w_mm?: number | null;
  unit_h_mm?: number | null;
  vendor?: string | null;
  sku?: string | null;
  product_url?: string | null;
  unit?: string | null;
  unit_price_cents?: number | null;
}

export interface MaterialFromSelectionOptions {
  /**
   * `home_project_attachments.id` of the swatch photo, when the selection has a
   * durable one.
   *
   * Resolved by the caller, never looked up here: turning an id into bytes is
   * backend-specific — a sealed H6 blob on a local-first household, an R2 url
   * otherwise — which is exactly why `materialSchema` stores the id alone and
   * `useTextureUris` does the resolving on the device.
   */
  textureAttachmentId?: string | null;
  /** Override the derived id. See `finishIdForSelection`. */
  id?: string;
}

/**
 * Why a selection could not become a finish, in the member's words.
 *
 * A union rather than a `Material` with a fabricated colour, because the type
 * is the only place that can force the caller to notice: `result.material` does
 * not exist unless `result.ok`, so there is no shape of this API in which a
 * made-up colour reaches the renderer by omission.
 */
export type MaterialFromSelectionResult =
  | { ok: true; material: Material }
  | { ok: false; reason: 'missing_color'; message: string }
  | { ok: false; reason: 'invalid_finish'; message: string; issues: string[] };

/**
 * The finish id a selection promotes to, derived from the selection's own id.
 *
 * Deterministic rather than random (`newSurfaceId`) so that applying the same
 * imported tile to a second wall, or tapping the same option twice, upserts the
 * one palette entry instead of stacking near-identical duplicates that the
 * takeoff would then group and price separately.
 */
export function finishIdForSelection(selectionId: string): string {
  return `mt_sel_${selectionId}`;
}

/**
 * Category words the importer emits → the finish kinds the renderer draws.
 *
 * The importer's vocabulary is described in `material-listing-prompt.ts`
 * ("flooring, tile, paint, countertop, cabinet, …") and members type their own,
 * so anything unrecognised lands on `other` rather than on a guess. `other`
 * costs the member one chip tap in the editor; a wrong guess costs them a
 * pattern and a waste percentage they never chose.
 */
const KIND_BY_CATEGORY_WORD: Record<string, MaterialKind> = {
  tile: 'tile',
  tiles: 'tile',
  mosaic: 'tile',
  flooring: 'flooring',
  floor: 'flooring',
  hardwood: 'flooring',
  laminate: 'flooring',
  vinyl: 'flooring',
  carpet: 'flooring',
  paint: 'paint',
  primer: 'paint',
  stain: 'paint',
  wallpaper: 'wallpaper',
  countertop: 'stone',
  stone: 'stone',
  slab: 'stone',
  cabinet: 'panel',
  cabinetry: 'panel',
  panel: 'panel',
  panelling: 'panel',
  paneling: 'panel',
  millwork: 'panel',
  trim: 'panel',
};

/** The finish kind a selection's category names, or `other`. */
export function finishKindForCategory(
  category: string | null | undefined,
): MaterialKind {
  if (typeof category !== 'string') return 'other';
  for (const word of category.toLowerCase().split(/[^a-z]+/)) {
    const kind = KIND_BY_CATEGORY_WORD[word];
    if (kind) return kind;
  }
  return 'other';
}

/**
 * Matches `materialSchema`'s `.max(10_000)` on a repeat side. Ten metres is
 * past any real tile or plank, so a larger number came from a misread coverage
 * or page dimension — and letting it through would fail the Room Surface
 * Model's own validation later, where the cost is the whole room document
 * rather than one field.
 */
const MAX_UNIT_MM = 10_000;

/**
 * Convert a selection into a finish, or say why it cannot be one.
 *
 * Everything the selection actually states is carried; nothing that would
 * change a *quantity* is invented. See the header for the two refusals.
 */
export function materialFromSelection(
  selection: SelectionFinishInput,
  options: MaterialFromSelectionOptions = {},
): MaterialFromSelectionResult {
  const colorHex = normalizeHexColor(selection.color_hex);
  if (!colorHex) {
    return {
      ok: false,
      reason: 'missing_color',
      message: 'Pick a colour for this material to put it on a surface.',
    };
  }

  const kind = finishKindForCategory(selection.category);
  const defaults = MATERIAL_KIND_DEFAULTS[kind];

  /**
   * Both sides or neither — the same rule `normalizeMaterialAppearance` applies
   * to a listing. A page that printed one dimension gives a width with no
   * height, and squaring the width to fill the gap invents a tile nobody sells.
   */
  const unitWMm = repeatSideOrNull(selection.unit_w_mm);
  const unitHMm = repeatSideOrNull(selection.unit_h_mm);
  const repeats = unitWMm !== null && unitHMm !== null;

  /**
   * Which kind-defaults may ride along, and why the line is drawn here.
   *
   * **Dimensionless defaults are carried; anything measured in the vendor's
   * own units is not.** `wastePct` (a percentage) and `coats` (a number of
   * passes) mean the same thing whatever the product is, and carrying them
   * makes an imported finish behave exactly like a hand-typed one.
   * `coverageM2PerUnit` does not: it is m² per PURCHASE unit, and the purchase
   * unit came from the vendor (`selection.unit` — a box, a gallon, a roll), not
   * from our category guess. Defaulting 11 m²/L onto a product sold by the
   * gallon under-orders the paint for a whole room. So coverage is left absent,
   * `quantityGap` says "Add coverage…" in the editor, and the member supplies
   * the one number only the tin can answer.
   *
   * `pattern`, `groutMm` and `groutColorHex` are look-only and are gated on a
   * stated repeat: with no repeat there is nothing to lay out and no joint to
   * draw, and `unitFootprintM2` would fold a phantom joint into the count.
   */
  const carryableDefaults: Partial<Material> = {
    wastePct: defaults.wastePct,
    ...(defaults.coats !== undefined ? { coats: defaults.coats } : {}),
    ...(repeats
      ? {
          unit_w_mm: unitWMm,
          unit_h_mm: unitHMm,
          groutMm: defaults.groutMm,
          pattern: defaults.pattern,
          groutColorHex: defaults.groutColorHex,
        }
      : {}),
  };

  const groutColorHex = normalizeHexColor(selection.grout_color_hex);
  const vendor = clamp(selection.vendor, 160);
  const sku = clamp(selection.sku, 120);
  const productUrl = clamp(selection.product_url, 2048);
  const priceCents = selection.unit_price_cents;
  // The vendor's own word for what is bought — 'box', 'gal', 'roll'. Display
  // only, and preferred over the kind default because the kind is a guess and
  // this one is printed on the listing.
  const unitLabel = clamp(selection.unit, 24) ?? defaults.unitLabel;

  const candidate: Material = {
    ...carryableDefaults,
    id: options.id ?? finishIdForSelection(selection.id),
    name: clamp(selection.name, 160) ?? '',
    kind,
    colorHex,
    textureAttachmentId: options.textureAttachmentId ?? null,
    // The stated grout colour wins over the kind default, and is kept even when
    // the size is unknown: a member who read "matte white grout" off the page
    // has stated a fact, unlike the 3 mm joint we assumed.
    ...(groutColorHex ? { groutColorHex } : {}),
    // ---- provenance, straight copies -------------------------------------
    ...(vendor ? { vendor } : {}),
    ...(sku ? { sku } : {}),
    ...(productUrl ? { productUrl } : {}),
    ...(unitLabel ? { unitLabel } : {}),
    ...(isWholeCents(priceCents) ? { unitPriceCents: priceCents } : {}),
    // The back-pointer `materialSchema` documents: it is what stops promoting
    // this finish back into the budget creating a second line for the same buy.
    selectionId: selection.id,
  };

  /**
   * Validated before it is returned, never after.
   *
   * `parseRoomSurfaceModel` returns null for a document with one bad material,
   * so an invalid finish does not cost the member a swatch — it costs them the
   * whole room. Failing here turns that into a message beside the option they
   * tapped.
   */
  const parsed = materialSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid_finish',
      message: 'This material is missing something a finish needs.',
      issues: parsed.error.issues.map(
        issue => `${issue.path.join('.') || 'material'}: ${issue.message}`,
      ),
    };
  }
  return { ok: true, material: parsed.data };
}

/** A repeat side the schema will accept, or null. See `MAX_UNIT_MM`. */
function repeatSideOrNull(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value > 0 && value <= MAX_UNIT_MM ? value : null;
}

/** Trimmed and cut to the schema's ceiling, or undefined when there is nothing. */
function clamp(
  value: string | null | undefined,
  max: number,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/** `unitPriceCents` is `z.number().int().nonnegative()` — anything else is dropped. */
function isWholeCents(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
