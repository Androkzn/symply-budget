import type { AppColors } from '@theme';

/** Three-letter month labels for the history grid + compare chart. */
export const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Year chips to offer in a picker: every year that has data, plus the currently
 * selected year (so it stays selectable even with no data yet). Descending.
 */
export function buildYearOptions(availableYears: number[], selected: number): number[] {
  const set = new Set<number>(availableYears);
  set.add(selected);
  return Array.from(set).sort((a, b) => b - a);
}

/** Net figure color: success when ≥ 0, error when negative (matches the sheet's red). */
export function netColor(net: number, colors: AppColors): string {
  return net >= 0 ? colors.success : colors.error;
}

/**
 * Human delta label for a year-over-year net change percentage.
 * null (prior net ≈ 0) → "—"; otherwise a signed percentage, e.g. "+12%".
 */
export function formatDeltaPct(pct: number | null): string {
  if (pct == null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct}%`;
}

/**
 * Pick `count` distinct series colors by cycling the provided palette. Used to
 * color each year in the compare chart + legend consistently.
 */
export function pickSeriesColors(count: number, palette: string[]): string[] {
  if (palette.length === 0) return [];
  return Array.from({ length: Math.max(0, count) }, (_, i) => palette[i % palette.length]);
}
