import type { FilterTab } from '@components/ui';

/**
 * Duration entry helpers shared by the mortgage forms. Amortization and term
 * are stored canonically in MONTHS on the API (`*_months`), but people think in
 * years for amortization and sometimes in months for short terms. A single
 * units toggle lets the user enter either; these helpers do the (round-tripping)
 * conversion between the displayed value and the canonical months figure.
 */
export type DurationUnit = 'years' | 'months';

export const DURATION_UNIT_TABS: FilterTab[] = [
  { id: 'years', label: 'Years' },
  { id: 'months', label: 'Months' },
];

/**
 * Parse a displayed duration into whole months for the selected unit.
 * Returns NaN when the value is not a positive number (callers gate on `> 0`).
 */
export function durationToMonths(value: string, unit: DurationUnit): number {
  const n = parseFloat(value);
  if (!(n > 0)) return NaN;
  return unit === 'years' ? Math.round(n * 12) : Math.round(n);
}

/** Format a number for a text input, dropping trailing zeros (25, 1.5). */
function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/**
 * Convert a displayed value when the units toggle flips, preserving the real
 * duration (25 years ⇄ 300 months, 18 months ⇄ 1.5 years). Empty / non-numeric
 * input passes through unchanged so a half-typed field isn't clobbered.
 */
export function convertDurationValue(value: string, from: DurationUnit, to: DurationUnit): string {
  if (from === to) return value;
  const n = parseFloat(value);
  if (!(n > 0)) return value;
  const converted = to === 'months' ? n * 12 : n / 12;
  return formatNum(converted);
}
