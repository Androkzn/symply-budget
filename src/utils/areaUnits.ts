import type { HouseUnitSystem } from '@api/households';

/**
 * Room/space area unit conversion — the Imperial/Metric switch's House side
 * (`households.unit_system`, 0142). `household_spaces.area_sqft` stays
 * canonical square feet regardless of this switch; only how it is displayed
 * and typed changes, the same "canonical amount, separate display-unit"
 * contract Health's `unit_system` (0141) established for weight/height.
 */

export type AreaUnit = 'sqft' | 'sqm';

/** Exact factor, both directions — never two independently rounded constants. */
export const SQFT_PER_SQM = 10.7639104167;

export function sqmToSqft(sqm: number): number {
  return sqm * SQFT_PER_SQM;
}

export function sqftToSqm(sqft: number): number {
  return sqft / SQFT_PER_SQM;
}

/** 'imperial' → sqft, 'metric' → sqm. */
export function areaUnitFor(system: HouseUnitSystem): AreaUnit {
  return system === 'metric' ? 'sqm' : 'sqft';
}

/** Convert a canonical-sqft figure into the unit a screen is displaying. */
export function areaInUnit(sqft: number, unit: AreaUnit): number {
  return Math.round(unit === 'sqm' ? sqftToSqm(sqft) : sqft);
}

/** Convert a member-entered figure in `unit` back to canonical square feet. */
export function areaToSqft(value: number, unit: AreaUnit): number {
  return unit === 'sqm' ? sqmToSqft(value) : value;
}

export function areaUnitLabel(unit: AreaUnit): string {
  return unit === 'sqm' ? 'sq. m' : 'sq. ft';
}

/** e.g. `"1,200 sq. ft"` / `"111 sq. m"`. */
export function formatArea(sqft: number, unit: AreaUnit): string {
  return `${areaInUnit(sqft, unit).toLocaleString()} ${areaUnitLabel(unit)}`;
}
