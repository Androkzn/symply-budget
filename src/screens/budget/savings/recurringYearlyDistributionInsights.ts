import type { RecurringYearlyGroupBreakdown } from '@api/savings';
import type { AppBarStack } from '@components/ui/AppBarChart';
import type { AppColors } from '@theme';
import { seriesColor } from '@theme/chartPalette';

/**
 * Pure helpers behind `RecurringYearlyDistributionChart` — the "distribution
 * by category, across the whole year" stacked bar shown on the Savings →
 * Monthly tab, alongside the existing single-month `RecurringDistributionChart`.
 *
 * Kept dependency-free from the rest of `savings/` (own local month-label
 * table, no import from `mortgage/paymentsInsights.ts`) — same convention
 * `recurringMonthsInsights.ts` uses, so this piece is developable/testable in
 * isolation against the documented `RecurringYearlyGroupBreakdown` contract.
 */

// prettier-ignore
const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/** 1-indexed month (1–12) → single-letter axis tick — 12 bars leave no room for "Jan". */
function monthLetterLabel(month: number): string {
  return MONTH_LETTERS[month - 1] ?? '';
}

/** "Other" for the ungrouped catch-all, else the group's own label verbatim. */
export function groupDisplayLabel(groupLabel: string | null): string {
  return groupLabel ?? 'Other';
}

/**
 * One stacked bar per month (always all 12, Jan→Dec) — each bar's segments
 * are `breakdown.groups`, IN THAT FIXED ORDER, so a group holds the exact
 * same stack position/color in every month's bar even when it contributes
 * nothing that month (an empty/zero segment, never a dropped one) — the
 * single thing that keeps 12 side-by-side bars readable as "the same
 * category" rather than a palette that reshuffles bar to bar.
 */
export function buildYearlyStacks(
  breakdown: RecurringYearlyGroupBreakdown,
  colors: AppColors
): AppBarStack[] {
  const monthByNumber = new Map(breakdown.months.map((m) => [m.month, m]));
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const entry = monthByNumber.get(month);
    const byGroupLabel = new Map((entry?.byGroup ?? []).map((g) => [g.group_label, g.subtotalCents]));
    return {
      label: monthLetterLabel(month),
      segments: breakdown.groups.map((g, index) => ({
        value: (byGroupLabel.get(g.group_label) ?? 0) / 100,
        color: seriesColor(colors, index),
      })),
    };
  });
}

/** Legend rows for the chart — one per group, same order/color the stacks use. */
export function buildYearlyLegend(
  breakdown: RecurringYearlyGroupBreakdown,
  colors: AppColors
): Array<{ label: string; color: string }> {
  return breakdown.groups.map((g, index) => ({
    label: groupDisplayLabel(g.group_label),
    color: seriesColor(colors, index),
  }));
}
