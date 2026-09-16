import type { AppColors } from '@theme';
import { formatMoney, formatMoneyRange } from '@utils/money';

import type { BudgetPriority } from './budgetAffordabilityChartUtils';

/**
 * Canonical priority → color mapping for the entire Budget tab (legend, planned
 * list chips, spendings list, timeline, AI suggestions and the item form).
 *
 * Single source of truth so the SAME priority never reads as two different
 * colors across screens. Uses theme tokens (never hard-coded hex) so it tracks
 * light/dark and the app color scheme. The scale is intentionally inverted from
 * the usual "critical = red": here Low = red (colors.error) and Critical =
 * green (colors.success).
 */
export function budgetPriorityColor(colors: AppColors, priority: BudgetPriority | string): string {
  const map: Record<BudgetPriority, string> = {
    critical: colors.success,
    high: colors.yellow,
    medium: colors.warning,
    low: colors.error,
  };
  // Backend priority arrives as a loose string; fall back to the "medium" tone
  // for any unrecognized value so the dot never renders with no color.
  return map[priority as BudgetPriority] ?? colors.warning;
}

/**
 * Canonical money formatters for the entire Budget tab (Dashboard, Planned,
 * Spendings, Savings and all sub-screens).
 *
 * Previously every screen defined its own `formatCurrency`, and they disagreed
 * on negatives: some rendered `-$1.5k`, some `$-1500`, some `$-1.5k`. That made
 * the SAME cents value read differently depending on which card showed it. This
 * single implementation is the source of truth so figures are consistent
 * everywhere:
 *   • null/undefined → "$0"
 *   • whole dollars, grouped → "$9,456" (never abbreviated to "$9.5k", never
 *     cents — the Budget cards are wide enough for the real figure, and a
 *     rounded "k" hides the difference between $9,456 and $9,499)
 *   • sign always leads the symbol → "-$9,456", never "$-9,456"
 *
 * The leading symbol follows the user's selected display currency (Settings →
 * Currency). This is a display swap only — amounts are not converted. Screens
 * calling this must also call `useDisplayCurrency()` so they re-render when the
 * preference changes; see @utils/money.
 */
export function formatBudgetCurrency(cents: number | null | undefined): string {
  return formatMoney(cents);
}

/**
 * Bytes on disk, for the rows that report what a delete would free (backup
 * archives, retired ledgers). Empty string at zero so a caller can drop the
 * figure from a line rather than print "0 B".
 */
export function formatDataSize(bytes: number): string {
  if (bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Render an estimated cost range. Mirrors the previous per-screen helpers:
 *   • no min and no max → "TBD"
 *   • equal bounds or missing max → a single figure
 *   • otherwise → "min - max"
 */
export function formatBudgetCurrencyRange(
  min: number | null,
  max: number | null
): string {
  return formatMoneyRange(min, max);
}
