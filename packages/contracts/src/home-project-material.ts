/**
 * A material's APPEARANCE and its OFFER, derived from a shop listing.
 *
 * The model reads the page; this file decides what is true. That split is the
 * whole point of the file:
 *
 *  - **Unit conversion is arithmetic, not extraction.** The prompt asks for
 *    "12x24" and "in" and does the ×25.4 here, for the same reason prices come
 *    back in dollars and are turned into cents by the caller: an extraction task
 *    with a multiplication bolted on gets the multiplication wrong occasionally
 *    and silently, and nothing downstream can tell a converted 304.8 from a
 *    hallucinated one.
 *  - **A discount is arithmetic too, and the page's own badge is not evidence.**
 *    "50% OFF" outliving its sale is one of the commonest stale facts in retail
 *    HTML. Where both prices are known the percentage is computed from them and
 *    the badge is only consulted to notice the disagreement.
 *
 * Shared rather than reimplemented for the same reason `material-listing-merge`
 * is: the Worker reads pages and so does the device (a private-mode household
 * has no Worker), and two implementations of "is this on sale" are two answers
 * to a question the member is about to spend money on.
 *
 * Pure. No `fetch`, no D1, no ledger.
 */
import { parsePriceToCents } from './link-extraction';
import type { MaterialSpec } from './material-listing-merge';
import type { RawMaterialListing } from './material-listing-prompt';

/**
 * What the preview needs to draw this finish.
 *
 * Mirrors the fields `materialSchema` in `room-surface-model.ts` requires, and
 * the columns migration 0164 added, so a caller can hand it straight to either.
 */
export interface MaterialAppearance {
  /** `#rrggbb`, lowercase, or null when the page stated no colour. */
  colorHex: string | null;
  /** The vendor's colour name/code verbatim — "SW 7015". */
  colorName: string | null;
  /** `#rrggbb`, lowercase. Tile only, and only when grout was actually shown. */
  groutColorHex: string | null;
  /** One repeat's real size in millimetres, or null when unstated. */
  unitWMm: number | null;
  unitHMm: number | null;
}

/** What the card needs to show a strike-through and a "save 40%". */
export interface MaterialSaleOffer {
  /** The "was" price in cents, when the page struck one through. */
  listPriceCents: number | null;
  /** Today's discounted price in cents. Mirrors `unit_price_cents`. */
  salePriceCents: number | null;
  /** 0-100, rounded. Computed from the prices whenever both are known. */
  discountPct: number | null;
  /** ISO date, only when the vendor published one. */
  saleEndsAt: string | null;
  /**
   * The page's badge disagreed with its own prices by more than a point.
   *
   * Surfaced rather than swallowed so the caller can lower the extraction's
   * confidence: a page whose banner and prices contradict each other is a page
   * whose prices might also be stale, and the member should be nudged to check.
   */
  discountPctDisputed: boolean;
}

/** Neither a colour nor a size was stated. The honest default. */
export const EMPTY_MATERIAL_APPEARANCE: MaterialAppearance = {
  colorHex: null,
  colorName: null,
  groutColorHex: null,
  unitWMm: null,
  unitHMm: null,
};

/** Not on sale. Distinct from "on sale, end date unknown". */
export const EMPTY_MATERIAL_SALE_OFFER: MaterialSaleOffer = {
  listPriceCents: null,
  salePriceCents: null,
  discountPct: null,
  saleEndsAt: null,
  discountPctDisputed: false,
};

/**
 * The largest repeat that can be a repeat.
 *
 * Matches `materialSchema`'s `.max(10_000)` on `unit_w_mm`. Ten metres is past
 * any real tile or plank, so a number above it came from a misread coverage
 * figure or a page dimension, and letting it through would fail the Room
 * Surface Model's own validation later — where the failure costs the member the
 * entire room document, not one field.
 */
const MAX_UNIT_MM = 10_000;

const MM_PER_UNIT: Record<'mm' | 'cm' | 'in', number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
};

/**
 * A hex the strict `#[0-9a-fA-F]{6}` regex in `materialSchema` will accept, or
 * null.
 *
 * Shorthand and bare hexes are widened rather than rejected because models emit
 * them despite the instruction, and "#fff" is unambiguous. Anything else is
 * dropped: a material whose `colorHex` fails validation takes the whole room
 * document down with it — `parseRoomSurfaceModel` returns null and the member
 * sees an empty editor instead of one wrong swatch.
 */
export function normalizeHexColor(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const body = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-f]{6}$/.test(body)) return `#${body}`;
  if (/^[0-9a-f]{3}$/.test(body)) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  }
  return null;
}

/**
 * A number a provider may have quoted as a string.
 *
 * Money already tolerates `"7.13"` / `"$7.13"` / `"7,13"` via
 * `parsePriceToCents`, because at least one provider really does emit numerics
 * as strings. Nothing else did, so `unit_size_w: "12"` and
 * `sale_discount_pct_stated: "25"` were dropped by a bare `typeof === 'number'`
 * gate — SILENTLY, leaving a material that looks complete and is missing the
 * repeat size the preview needs to draw a pattern at all.
 *
 * Tolerating the same shapes everywhere is the point: a field's type should not
 * decide whether the member's tile has a size. A real number passes straight
 * through — widening the door must not round a 3-dp coverage figure on the way.
 */
function numericOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  // Same shapes money accepts: a currency symbol, thin spaces, and a comma used
  // as the decimal separator rather than a thousands group.
  const cleaned = value.trim().replace(/[^\d.,-]/g, '');
  if (!cleaned) return null;
  const normalized =
    cleaned.includes(',') && !cleaned.includes('.')
      ? cleaned.replace(',', '.')
      : cleaned.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A printed size to millimetres.
 *
 * Rounded to 2 dp so 12 in is 304.8 and not 304.80000000000007 — the number is
 * written to a REAL column, read back, and compared, and float noise in a
 * stored dimension shows up as a spurious "changed" on every sync.
 */
export function toMillimetres(
  value: number | string | null | undefined,
  unit: 'mm' | 'cm' | 'in' | null | undefined,
): number | null {
  const numeric = numericOrNull(value);
  if (numeric === null || numeric <= 0) {
    return null;
  }
  if (!unit || !(unit in MM_PER_UNIT)) return null;
  const mm = Math.round(numeric * MM_PER_UNIT[unit] * 100) / 100;
  return mm > 0 && mm <= MAX_UNIT_MM ? mm : null;
}

/**
 * Fill in the keys a provider omitted.
 *
 * The schema marks every new field `required`, but the three providers behind
 * `ai/provider.ts` honour that to three different degrees, and a device using a
 * member's own key may be talking to a fourth. Normalising absent → null here
 * means exactly one shape reaches the rest of the code, so `=== null` is a
 * usable test and no caller has to write `?? null` at every read.
 */
export function normalizeMaterialListingExtras(
  listing: Partial<RawMaterialListing> | null | undefined,
): Required<
  Pick<
    RawMaterialListing,
    | 'color_hex'
    | 'color_name'
    | 'grout_color_hex'
    | 'unit_size_w'
    | 'unit_size_h'
    | 'unit_size_unit'
    | 'list_price_amount'
    | 'sale_price_amount'
    | 'sale_discount_pct_stated'
    | 'sale_ends_at'
  >
> {
  const l = listing ?? {};
  return {
    color_hex: l.color_hex ?? null,
    color_name: l.color_name ?? null,
    grout_color_hex: l.grout_color_hex ?? null,
    unit_size_w: l.unit_size_w ?? null,
    unit_size_h: l.unit_size_h ?? null,
    unit_size_unit: l.unit_size_unit ?? null,
    list_price_amount: l.list_price_amount ?? null,
    sale_price_amount: l.sale_price_amount ?? null,
    sale_discount_pct_stated: l.sale_discount_pct_stated ?? null,
    sale_ends_at: l.sale_ends_at ?? null,
  };
}

/**
 * The listing's appearance, converted and validated.
 *
 * **A half-stated size is discarded.** A page that prints "12" wide and nothing
 * else gives a width with no height, and a repeat needs both — squaring the
 * width to fill the gap would invent a 12x12 tile that nobody sells. Both or
 * neither.
 */
export function normalizeMaterialAppearance(
  listing: Partial<RawMaterialListing> | null | undefined,
): MaterialAppearance {
  const raw = normalizeMaterialListingExtras(listing);
  const unitWMm = toMillimetres(raw.unit_size_w, raw.unit_size_unit);
  const unitHMm = toMillimetres(raw.unit_size_h, raw.unit_size_unit);
  const bothSides = unitWMm != null && unitHMm != null;

  const colorName =
    typeof raw.color_name === 'string' && raw.color_name.trim()
      ? raw.color_name.trim().slice(0, 60)
      : null;

  return {
    colorHex: normalizeHexColor(raw.color_hex),
    colorName,
    groutColorHex: normalizeHexColor(raw.grout_color_hex),
    unitWMm: bothSides ? unitWMm : null,
    unitHMm: bothSides ? unitHMm : null,
  };
}

/**
 * The vendor's colour name as a spec chip.
 *
 * `home_project_selections` has a `color_hex` column and no colour-name column,
 * and specs are where this codebase already puts a member-facing fact with no
 * column of its own (see the pieces-per-box note in `material-listing-merge`).
 * Losing "SW 7015" would be losing the only string the member can take to a
 * paint counter.
 */
export function colorSpecFor(
  appearance: MaterialAppearance,
): MaterialSpec | null {
  if (!appearance.colorName) return null;
  return { label: 'Colour', value: appearance.colorName.slice(0, 60) };
}

/**
 * The listing's offer, with the discount derived rather than believed.
 *
 * The rules, in the order they are applied:
 *
 *  1. **Two prices, the second lower.** The only shape that proves a discount.
 *     `discountPct` is `round((1 - sale/list) * 100)`.
 *  2. **The badge is cross-checked, never trusted.** If the page also claims a
 *     percentage and it differs from the arithmetic by more than one point, the
 *     arithmetic wins and `discountPctDisputed` is set. One point of slack
 *     absorbs honest rounding ("40% off" on $59.99 → $35.99 is 40.007%).
 *  3. **A stated percentage with no "was" price still counts**, because plenty
 *     of pages advertise "25% off everything" and only print the new price. The
 *     percentage is taken as given and `listPriceCents` stays null — deriving a
 *     "was" price from a percentage would print a number the vendor never
 *     published beside a strike-through, which is the one thing a member reads
 *     as a fact.
 *  4. **Everything else is not a sale.** A lone "From $3.99", a range, a bulk
 *     break, a members-price teaser: all null. A fabricated discount rushes a
 *     real decision, which is the failure this strictness exists to prevent.
 *
 * `saleEndsAt` is only ever returned alongside an actual sale: a stray date on a
 * full-price page is a shipping estimate or a copyright line, not an offer.
 */
export function normalizeMaterialSaleOffer(
  listing: Partial<RawMaterialListing> | null | undefined,
): MaterialSaleOffer {
  const raw = normalizeMaterialListingExtras(listing);

  const listCents = positiveCentsOrNull(raw.list_price_amount);
  // Fall back to `price_amount` for the sale side: the prompt asks for the
  // discounted price in both fields, and a model that filled only the one it
  // was asked for first should not cost the member the whole offer.
  const saleCents =
    positiveCentsOrNull(raw.sale_price_amount) ??
    positiveCentsOrNull(listing?.price_amount);

  const stated = statedPctOrNull(raw.sale_discount_pct_stated);
  const endsAt = isoDateOrNull(raw.sale_ends_at);

  if (listCents != null && saleCents != null && saleCents < listCents) {
    const computed = Math.round((1 - saleCents / listCents) * 100);
    if (computed <= 0 || computed >= 100) return EMPTY_MATERIAL_SALE_OFFER;
    return {
      listPriceCents: listCents,
      salePriceCents: saleCents,
      discountPct: computed,
      saleEndsAt: endsAt,
      discountPctDisputed: stated != null && Math.abs(stated - computed) > 1,
    };
  }

  if (stated != null) {
    return {
      // No "was" price was published, so none is reported. See rule 3.
      listPriceCents: null,
      salePriceCents: saleCents,
      discountPct: stated,
      saleEndsAt: endsAt,
      discountPctDisputed: false,
    };
  }

  return EMPTY_MATERIAL_SALE_OFFER;
}

/** True when there is an offer worth rendering a strike-through for. */
export function hasSaleOffer(offer: MaterialSaleOffer): boolean {
  return offer.discountPct != null;
}

function positiveCentsOrNull(amount: number | null | undefined): number | null {
  const cents = parsePriceToCents(amount ?? null);
  return cents != null && cents > 0 ? cents : null;
}

/** A percentage that describes a real discount. 0 and 100 describe neither. */
function statedPctOrNull(pct: number | string | null | undefined): number | null {
  // Same tolerance as `toMillimetres` above, and for the same reason: a stated
  // percentage arriving as "25" was silently dropped, which quietly disabled
  // the cross-check that catches a tag claiming a rounder discount than its own
  // prices support.
  const numeric = numericOrNull(pct);
  if (numeric === null) return null;
  const rounded = Math.round(numeric);
  return rounded > 0 && rounded < 100 ? rounded : null;
}

/**
 * `YYYY-MM-DD`, or null.
 *
 * A longer ISO timestamp is truncated to its date; anything that is not a real
 * calendar date is dropped rather than stored, because the column is read back
 * as a deadline shown to the member ("sale ends in 3 days") and a garbage date
 * there is a countdown to nothing.
 */
function isoDateOrNull(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Rejects "2026-02-31", which `Date` would roll forward to 3 March.
  return date.toISOString().slice(0, 10) === `${y}-${m}-${d}`
    ? `${y}-${m}-${d}`
    : null;
}
