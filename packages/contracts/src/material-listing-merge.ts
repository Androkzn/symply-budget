/**
 * A shop page's listing, folded into a material — one copy, both runtimes.
 *
 * `price_basis` is the reason this is shared rather than reimplemented. "What
 * does this floor cost" is not a display concern: it is the number that lands
 * in the member's budget, and it only exists once the price and the coverage
 * are expressed in the same terms. Two implementations of that rule are two
 * budgets. The Worker had it first; the device now reads pages too, so it uses
 * this and not a copy of it.
 *
 * Pure. No `fetch`, no D1, no ledger — a listing and a baseline in, a draft out.
 */
import {
  hasSaleOffer,
  normalizeMaterialAppearance,
  normalizeMaterialSaleOffer,
} from './home-project-material';
import { absoluteImageUrl, parsePriceToCents } from './link-extraction';
import type { RawMaterialListing } from './material-listing-prompt';

/** One spec chip on a material card. */
export interface MaterialSpec {
  label: string;
  value: string;
}

/**
 * A material as the link importer assembles it, before either backend writes it.
 *
 * Structural on purpose: the Worker turns this into a D1 row and the device
 * turns it into a ledger op, and neither shape belongs in the other's runtime.
 */
export interface SelectionDraft {
  name: string;
  productUrl: string;
  unitPriceCents?: number;
  unit?: string;
  vendor?: string;
  brand?: string;
  sku?: string;
  notes?: string;
  imageUrl?: string;
  category?: string;
  coveragePerUnit?: number;
  coverageUnit?: string;
  specs?: MaterialSpec[];
  /**
   * Appearance — migration 0164's `color_hex` / `grout_color_hex` /
   * `unit_*_mm`, in the camelCase the two backends' create-selection inputs
   * already speak.
   *
   * They live on the draft rather than being re-derived by each caller because
   * the draft IS the handover: the Worker turns it into a D1 row and the device
   * turns it into a ledger op. A field the draft does not carry is a field the
   * model was asked for, the normaliser checked, and nobody ever stored — which
   * is exactly what happened to all eight of these until now.
   */
  colorHex?: string | null;
  groutColorHex?: string | null;
  unitWMm?: number | null;
  unitHMm?: number | null;
  /**
   * The offer. NOT money an estimate reads — `unitPriceCents` above is the only
   * one of those, and it already holds the price the page says the customer
   * pays TODAY, which is the sale price while a sale is on.
   */
  listPriceCents?: number | null;
  salePriceCents?: number | null;
  discountPct?: number | null;
  saleEndsAt?: string | null;
  extractionSource: string;
}

/**
 * A symbol for the currency the page quoted, falling back to the code.
 *
 * Only ever used INSIDE a spec value, never for the budget: `unitPriceCents` is
 * the number that reaches money, and it is stamped with the project's currency
 * by the caller. This is a label on a fact the page stated.
 */
function currencySymbolFor(code: string | null | undefined): string {
  switch (code?.toUpperCase()) {
    case 'USD':
    case 'CAD':
    case 'AUD':
    case 'NZD':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    default:
      return code ? `${code.toUpperCase()} ` : '';
  }
}

/** The shop's hostname, `www.` dropped. Null for anything unparseable. */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export function compactRecord(
  input: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value) out[key] = value;
  }
  return out;
}

function clamp(
  value: string | null | undefined,
  max: number,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * A provider's number, whatever shape it actually arrived in — or null.
 *
 * Built on `parsePriceToCents` rather than `Number()` so that ONE tolerance
 * applies to every number a listing carries. Money has always absorbed `"7.13"`,
 * `"$7.13"` and `"7,13"`; nothing else did, and the asymmetry was silent in
 * three different ways:
 *
 *   `coverage_per_unit: "23.8"`      passed the `> 0` gate — `"23.8" > 0` is
 *                                    `true` — and was assigned to a field typed
 *                                    `number`. TypeScript cannot see it: the
 *                                    value crossed the boundary inside a model
 *                                    response. A string then reached the takeoff,
 *                                    where `"23.8" * 2` is 47.6 and looks right
 *                                    while `"23.8" + 2` is `"23.82"` and does
 *                                    not — so which failure the member got
 *                                    depended on the operator downstream.
 *   `unit_size_w: "12"`              was dropped by `toMillimetres`, so the
 *                                    material had no repeat size and the preview
 *                                    could not draw a pattern.
 *   `sale_discount_pct_stated: "25"` was dropped by the badge cross-check, so a
 *                                    page disagreeing with its own prices was
 *                                    never reported as disputed.
 *
 * All three are silent: the member gets a card that looks complete and is
 * missing exactly the facts this feature was added to capture. Coercing at the
 * one boundary every extraction crosses is what makes the type declared in
 * `RawMaterialListing` true at runtime as well as at compile time.
 */
function coerceNumber(raw: number | string | null | undefined): number | null {
  // A real number is returned untouched, and deliberately not routed through
  // the parser below: that one answers in CENTS, so a coverage figure printed
  // to three decimals would come back rounded to two. This function must only
  // ever ADD tolerance — anything already well-typed has to behave exactly as
  // it did before, or fixing the string case would break the common one.
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const cents = parsePriceToCents(raw);
  return cents == null ? null : cents / 100;
}

/**
 * The listing with every numeric field actually numeric.
 *
 * Applied once, at the top of the merge, so no reader below has to ask what
 * shape it was handed — and so the two normalizers receive numbers whatever the
 * provider emitted. Non-numeric fields pass through the spread untouched.
 */
function withCoercedNumbers(listing: RawMaterialListing): RawMaterialListing {
  return {
    ...listing,
    coverage_per_unit: coerceNumber(listing.coverage_per_unit),
    pieces_per_unit: coerceNumber(listing.pieces_per_unit),
    price_per_area_amount: coerceNumber(listing.price_per_area_amount),
    unit_size_w: coerceNumber(listing.unit_size_w),
    unit_size_h: coerceNumber(listing.unit_size_h),
    sale_discount_pct_stated: coerceNumber(listing.sale_discount_pct_stated),
  };
}

/**
 * Fold the model's reading of the page over the OpenGraph baseline.
 *
 * `price_basis` is where the interesting work is. The member compares cards on
 * "what does this floor cost", and that number only exists once the price and
 * the coverage are expressed in the same terms:
 *
 *   'sqft' / 'm2'   the price already IS per unit area, so coverage is 1 of
 *                   that unit. The takeoff then rounds up to whole square feet,
 *                   which is what a shop selling by the foot actually does.
 *   'box' / 'case'  the price is per package and the coverage came off the page.
 *   'each'          a per-piece product. No coverage, and the card says so
 *                   rather than pretending a faucet tiles a floor.
 *
 * A currency the project does not use is NOT converted — there is no rate
 * source here and a silently wrong conversion is the worst of the options. It
 * is recorded as a spec so the member sees it on the card.
 */
export function mergeListingIntoDraft(
  base: SelectionDraft,
  rawListing: RawMaterialListing,
  pageUrl: string,
  projectCurrency: string,
): SelectionDraft {
  // Numbers first, before a single gate or normaliser reads one. See
  // `coerceNumber`: a quoted `"23.8"` satisfies `> 0` and lands in a field typed
  // `number`, which no compiler catches and the takeoff arithmetic then gets
  // wrong in whichever direction its operator happens to choose.
  const listing = withCoercedNumbers(rawListing);
  const priceCents = parsePriceToCents(listing.price_amount);
  const basis = listing.price_basis;

  let unit: string | undefined;
  let coveragePerUnit: number | undefined;
  let coverageUnit: string | undefined;

  if (basis === 'sqft' || basis === 'm2') {
    unit = basis === 'sqft' ? 'sq ft' : 'm²';
    coveragePerUnit = 1;
    coverageUnit = basis;
  } else if (basis === 'box' || basis === 'case' || basis === 'pallet') {
    unit = basis;
    if (
      listing.coverage_per_unit != null &&
      listing.coverage_per_unit > 0 &&
      listing.coverage_unit
    ) {
      coveragePerUnit = listing.coverage_per_unit;
      coverageUnit = listing.coverage_unit;
    }
  } else if (basis === 'linear_ft') {
    unit = 'linear ft';
  } else if (basis === 'each') {
    unit = 'each';
  }

  // Coverage can be stated on a page that gives no basis at all; take it anyway.
  if (
    coveragePerUnit == null &&
    listing.coverage_per_unit != null &&
    listing.coverage_per_unit > 0 &&
    listing.coverage_unit
  ) {
    coveragePerUnit = listing.coverage_per_unit;
    coverageUnit = listing.coverage_unit;
  }

  const specs: MaterialSpec[] = (listing.specs ?? [])
    .map(s => ({
      label: clamp(s?.label, 40) ?? '',
      value: clamp(s?.value, 60) ?? '',
    }))
    .filter(s => s.label && s.value)
    .slice(0, 20);

  /*
    Size goes FIRST, and is extracted as its own field rather than trusted to
    land at the top of `specs`.

    It is the thing a member checks before anything else — a 9x10 hex and a
    12x24 subway are not alternatives — and it is the spec retailers agree least
    on where to put: the title, the variant name, a table row, or nowhere. Its
    own field means it is always on the card; de-duplicating here means a model
    that ALSO listed it as a spec does not print it twice.
  */
  const size = clamp(listing.dimensions, 60);
  if (size && !specs.some(s => /size|dimension/i.test(s.label))) {
    specs.unshift({ label: 'Size', value: size });
  }

  /*
    The three facts a tile page states that no column here can hold.

    `home_project_selections` has one price, one coverage and one unit — the
    shape a budget line needs. A real product page states more than that: how
    many pieces come in the box, what the shop itself charges per square foot,
    and whether it is in stock. All three change what a member does, and all
    three would be lost.

    They go in `specs`, which is JSON and costs no migration. `unshift` in
    reverse order so they read price → pieces → availability, directly under
    the size, which is where a member looks first. Each is skipped when the
    model already listed it, so a thorough extraction does not print twice.
  */
  const stock = clamp(listing.availability, 40);
  if (stock && !specs.some(s => /availab|in stock|stock status/i.test(s.label))) {
    specs.unshift({ label: 'Availability', value: stock });
  }

  const pieces = listing.pieces_per_unit;
  if (
    pieces != null &&
    pieces > 0 &&
    // Must mention PIECES. `/per box/` also matched "Estimated Weight per Box
    // (lbs.)", which a real tile page lists — so the count of tiles in the box,
    // the single most useful packaging fact, was silently dropped.
    !specs.some(s => /\bpieces?\b|\btiles? per\b/i.test(s.label))
  ) {
    const per = unit ?? 'unit';
    specs.unshift({ label: `Pieces per ${per}`, value: String(pieces) });
  }

  /*
    The per-area price, ONLY when the page printed it.

    A shop that publishes "$5.98 /Sq. ft." beside "$48.80 /box" has done the
    division itself, against its own rounding and its own coverage figure. That
    beats recomputing it here — and where the two disagree, the member is better
    served seeing the shop's number than ours.
  */
  const areaPrice = listing.price_per_area_amount;
  if (
    areaPrice != null &&
    areaPrice > 0 &&
    listing.price_per_area_unit &&
    !specs.some(s => /per sq|per square|per m²|price per area/i.test(s.label))
  ) {
    const areaLabel = listing.price_per_area_unit === 'm2' ? 'm²' : 'sq ft';
    specs.unshift({
      label: `Price per ${areaLabel}`,
      value: `${currencySymbolFor(listing.price_currency)}${areaPrice}`,
    });
  }

  const currency = clamp(listing.price_currency, 8)?.toUpperCase();
  if (
    priceCents != null &&
    currency &&
    currency !== projectCurrency.toUpperCase()
  ) {
    specs.unshift({ label: 'Listed in', value: currency });
  }

  /*
    Appearance and the offer — migration 0164.

    Folded in HERE, once, rather than at the two call sites, for the same reason
    `price_basis` is: the Worker reads shop pages and so does the device, and a
    fact that only one of them carries is a fact the member loses by choosing a
    private-mode household. Until this, every part of the pipe existed except
    the middle — the prompt asked for the colour and the sale, the normalisers
    checked them, the card knew how to draw them, and the draft dropped them, so
    nothing was ever written on either backend.

    The offer is carried as a UNIT. A `salePriceCents` off this page beside a
    `listPriceCents` left over from the baseline is a strike-through the vendor
    never printed, and a percentage spanning two unrelated numbers is precisely
    the fabricated discount `normalizeMaterialSaleOffer` refuses to produce —
    fabricating it here by merging field by field would hand it back.
  */
  const appearance = normalizeMaterialAppearance(listing);
  const offer = normalizeMaterialSaleOffer(listing);
  const carriedOffer = hasSaleOffer(offer)
    ? {
        listPriceCents: offer.listPriceCents,
        salePriceCents: offer.salePriceCents,
        discountPct: offer.discountPct,
        saleEndsAt: offer.saleEndsAt,
      }
    : {
        listPriceCents: base.listPriceCents ?? null,
        salePriceCents: base.salePriceCents ?? null,
        discountPct: base.discountPct ?? null,
        saleEndsAt: base.saleEndsAt ?? null,
      };

  return {
    ...base,
    name: clamp(listing.name, 200) ?? base.name,
    brand: clamp(listing.brand, 200) ?? base.brand,
    vendor: clamp(listing.vendor, 200) ?? hostnameOf(pageUrl) ?? base.vendor,
    sku: clamp(listing.sku, 120) ?? base.sku,
    category: clamp(listing.category, 40) ?? base.category,
    // Still `price_amount`, and still the ONLY money that reaches a budget.
    // The prompt asks for the price the customer pays today, so on a sale page
    // this already IS the sale price; `salePriceCents` below duplicates it for
    // the strike-through rather than replacing it. Writing the discounted price
    // in here from the offer instead would be right until the sale ended and
    // then wrong in a stored number nobody re-reads.
    unitPriceCents: priceCents ?? base.unitPriceCents,
    unit: unit ?? base.unit,
    coveragePerUnit: coveragePerUnit ?? base.coveragePerUnit,
    coverageUnit: coverageUnit ?? base.coverageUnit,
    imageUrl:
      absoluteImageUrl(listing.image_url ?? undefined, pageUrl) ??
      base.imageUrl,
    specs: specs.length ? specs : base.specs,
    // Both sides or neither is already enforced by `normalizeMaterialAppearance`
    // — a page that printed one dimension gives a repeat that cannot be drawn,
    // and squaring the width would invent a tile nobody sells.
    colorHex: appearance.colorHex ?? base.colorHex ?? null,
    groutColorHex: appearance.groutColorHex ?? base.groutColorHex ?? null,
    unitWMm: appearance.unitWMm ?? base.unitWMm ?? null,
    unitHMm: appearance.unitHMm ?? base.unitHMm ?? null,
    ...carriedOffer,
    extractionSource: 'link_ai',
  };
}
