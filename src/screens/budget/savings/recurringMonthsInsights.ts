import type { RecurringPaymentMonthlyHistory } from '@api/savings';
import type { AppBarDatum } from '@components/ui/AppBarChart';
import { hexToRgba, type AppColors } from '@theme';

/**
 * Pure helpers behind `RecurringPaymentMonthsChart` — the "which months did
 * this payment apply to" bar chart shown for a REGULAR (non-loan) recurring
 * payment in the Monthly-payment detail sheet.
 *
 * Kept dependency-free from the rest of `savings/` (own local month-label
 * tables rather than importing `mortgage/paymentsInsights.ts` or
 * `mortgage/mortgageFormat.ts`) so this piece can be developed and tested in
 * isolation against the documented `RecurringPaymentMonthlyHistory` contract
 * while the sheet integration lands separately.
 */

/** Which of the three visual states a calendar month is in. */
export type MonthBarState = 'applied' | 'skipped' | 'outOfScope';

// prettier-ignore
const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/** 1-indexed month (1–12) → single-letter axis tick ("J" for January/July alike). */
function monthLetterLabel(month: number): string {
  return MONTH_LETTERS[month - 1] ?? '';
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Near-zero sliver height for an out-of-scope month — visible, but reads as "nothing". */
const OUT_OF_SCOPE_VALUE = 0.01;

/**
 * Color for one of the three bar states. `applied` is the brand primary,
 * `skipped` a muted/translucent primary (a "this should have happened but
 * didn't" ghost bar), `outOfScope` the neutral divider color so months
 * outside the payment's scope read as visually absent.
 */
export function monthBarColor(state: MonthBarState, colors: AppColors): string {
  switch (state) {
    case 'applied':
      return colors.primary;
    case 'skipped':
      return hexToRgba(colors.primary, 0.25);
    case 'outOfScope':
      return colors.divider;
  }
}

/** Which state a given calendar month (1–12) is in, per the BE history payload. */
function monthStateFor(history: RecurringPaymentMonthlyHistory, month: number): MonthBarState {
  const entry = history.months.find((m) => m.month === month);
  if (!entry || !entry.inScope) return 'outOfScope';
  return entry.applied ? 'applied' : 'skipped';
}

/**
 * The 12 bars (Jan–Dec, always all 12 — a stable axis even when some months
 * are out of scope) for the monthly-activity chart.
 *
 *  - `applied` months use the historical `appliedAmountCents` (NOT the
 *    payment's current `amountCents`) — drift protection so a since-changed
 *    amount never repaints history.
 *  - `skipped` months (in scope but never applied) use the current
 *    `amountCents` as a ghost value, flagged via the muted color so the bar
 *    reads as "should have happened" rather than a real applied amount.
 *  - out-of-scope months render a near-zero sliver in the neutral color.
 */
export function buildMonthBars(
  history: RecurringPaymentMonthlyHistory,
  colors: AppColors
): AppBarDatum[] {
  const byMonth = new Map(history.months.map((m) => [m.month, m]));
  const bars: AppBarDatum[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const state = monthStateFor(history, month);
    const label = monthLetterLabel(month);
    const entry = byMonth.get(month);
    const value =
      state === 'applied'
        ? (entry?.appliedAmountCents ?? history.amountCents) / 100
        : state === 'skipped'
          ? history.amountCents / 100
          : OUT_OF_SCOPE_VALUE;
    bars.push({ value, label, frontColor: monthBarColor(state, colors) });
  }
  return bars;
}

/** Distinct states actually present across the 12 months, in a stable legend order. */
export function presentMonthStates(history: RecurringPaymentMonthlyHistory): MonthBarState[] {
  const order: MonthBarState[] = ['applied', 'skipped', 'outOfScope'];
  const seen = new Set<MonthBarState>();
  for (let month = 1; month <= 12; month += 1) {
    seen.add(monthStateFor(history, month));
  }
  return order.filter((state) => seen.has(state));
}

/**
 * Caption line under the chart title: "Active all year" for an `all_year`
 * payment, else "Active {Start}–{End} {year}" derived from the min/max
 * in-scope month for a `custom_months` payment (e.g. "Active Mar–Sep 2026").
 */
export function describeScope(history: RecurringPaymentMonthlyHistory): string {
  if (history.scopeType === 'all_year') return 'Active all year';

  const inScopeMonths = history.months.filter((m) => m.inScope).map((m) => m.month);
  if (inScopeMonths.length === 0) return 'Not active this year';

  const min = Math.min(...inScopeMonths);
  const max = Math.max(...inScopeMonths);
  const startLabel = MONTHS_SHORT[min - 1];
  const endLabel = MONTHS_SHORT[max - 1];
  return min === max
    ? `Active ${startLabel} ${history.year}`
    : `Active ${startLabel}–${endLabel} ${history.year}`;
}
