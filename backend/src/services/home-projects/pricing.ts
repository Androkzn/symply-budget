/**
 * Material option pricing — shelf price → "what this floor costs".
 *
 * The three numbers a member compares on a card are NOT the same number scaled:
 *
 *   price per unit   what the shop charges for one box / piece / pail
 *   price per area   that price divided by what the box covers  ($/sqft)
 *   area total       units you must actually BUY, rounded UP, times unit price
 *
 * The rounding is the whole point of the third one. 24 m² of floor at 2.2 m² a
 * box is 10.9 boxes, and no shop sells 0.9 of a box — you buy 11, and with 10%
 * waste you buy 12. A card that showed `area × price_per_area` would quote a
 * floor nobody can purchase, cheaper than the real one, on the screen where the
 * member decides what to spend. So `areaTotalCents` is always
 * `ceil(units) × unitPrice`, never the smooth product.
 *
 * Every number is nullable and `unavailableReason` says which input was missing,
 * because the alternative — a plausible zero — is a wrong price presented with
 * the same confidence as a right one.
 *
 * MIRRORED in `src/features/house/local/logic/homeProjects.ts` for local-first
 * households. The two implementations must agree exactly; both are driven from
 * the shared fixtures in `pricing-fixtures.ts`.
 */

export type AreaUnit = 'm2' | 'sqft';

const M2_PER_SQFT = 0.09290304;

/** Area in `unit` → m². Unknown units are refused rather than guessed. */
export function toSquareMeters(value: number, unit: AreaUnit): number {
  return unit === 'sqft' ? value * M2_PER_SQFT : value;
}

/** m² → `unit`. */
export function fromSquareMeters(m2: number, unit: AreaUnit): number {
  return unit === 'sqft' ? m2 / M2_PER_SQFT : m2;
}

export function isAreaUnit(value: unknown): value is AreaUnit {
  return value === 'm2' || value === 'sqft';
}

export interface PricingGroupInput {
  area_value: number | null;
  area_unit: string | null;
  waste_factor_pct: number;
}

export interface PricingOptionInput {
  qty: number;
  unit_price_cents: number | null;
  coverage_per_unit: number | null;
  coverage_unit: string | null;
}

export interface OptionPricing {
  /** Price of one purchasable unit, straight off the row. */
  unit_price_cents: number | null;
  /** Price to cover one unit of area, in `price_per_area_unit`. Rounded to cents. */
  price_per_area_cents: number | null;
  price_per_area_unit: AreaUnit | null;
  /** Whole units to buy for the group's area, waste included. Always rounded up. */
  units_needed: number | null;
  /** What buying `units_needed` costs — the number the budget line takes. */
  area_total_cents: number | null;
  /** qty × unit price. The per-piece fallback for groups with no area. */
  line_total_cents: number | null;
  /** Which input was missing, so the card can say so instead of showing a zero. */
  unavailable_reason: 'no_price' | 'no_coverage' | 'no_area' | null;
}

/**
 * Price one option against its group.
 *
 * Reports every number it can and nulls the rest — a faucet option (price, no
 * coverage) still gets `line_total_cents`, and a tile option in a group with no
 * area set still gets `price_per_area_cents`. Only the inputs that are genuinely
 * absent go missing.
 */
export function priceOption(
  group: PricingGroupInput,
  option: PricingOptionInput
): OptionPricing {
  const unitPrice =
    option.unit_price_cents != null && option.unit_price_cents >= 0
      ? option.unit_price_cents
      : null;

  const qty = Number.isFinite(option.qty) && option.qty > 0 ? option.qty : 1;
  const lineTotal = unitPrice != null ? unitPrice * qty : null;

  const coverageUnit = isAreaUnit(option.coverage_unit) ? option.coverage_unit : null;
  const coverage =
    option.coverage_per_unit != null && option.coverage_per_unit > 0
      ? option.coverage_per_unit
      : null;
  const hasCoverage = coverage != null && coverageUnit != null;

  // Reported in the COVERAGE's unit, not the group's: a box labelled "20 sqft"
  // should read back "$/sqft" even if the member measured the room in m².
  const pricePerArea =
    unitPrice != null && hasCoverage ? Math.round(unitPrice / coverage) : null;

  const areaUnit = isAreaUnit(group.area_unit) ? group.area_unit : null;
  const hasArea = group.area_value != null && group.area_value > 0 && areaUnit != null;

  let unitsNeeded: number | null = null;
  let areaTotal: number | null = null;
  if (hasArea && hasCoverage) {
    const waste = Number.isFinite(group.waste_factor_pct)
      ? Math.max(0, group.waste_factor_pct)
      : 0;
    const neededM2 = toSquareMeters(group.area_value!, areaUnit!) * (1 + waste / 100);
    const perUnitM2 = toSquareMeters(coverage!, coverageUnit!);
    unitsNeeded = Math.ceil(neededM2 / perUnitM2);
    if (unitPrice != null) areaTotal = unitsNeeded * unitPrice;
  }

  let reason: OptionPricing['unavailable_reason'] = null;
  if (areaTotal == null) {
    if (unitPrice == null) reason = 'no_price';
    else if (!hasCoverage) reason = 'no_coverage';
    else reason = 'no_area';
  }

  return {
    unit_price_cents: unitPrice,
    price_per_area_cents: pricePerArea,
    price_per_area_unit: hasCoverage ? coverageUnit : null,
    units_needed: unitsNeeded,
    area_total_cents: areaTotal,
    line_total_cents: lineTotal,
    unavailable_reason: reason,
  };
}

/**
 * What the winning option should put into the project budget.
 *
 * Prefers the area total and falls back to qty × price, because a group with no
 * area is a legitimate per-piece group rather than a broken one. Returns 0 when
 * there is no price at all — a chosen-but-unpriced option belongs in the budget
 * as a visible zero, not as a missing line.
 */
export function budgetEstimateCents(
  group: PricingGroupInput,
  option: PricingOptionInput
): number {
  const pricing = priceOption(group, option);
  return pricing.area_total_cents ?? pricing.line_total_cents ?? 0;
}
