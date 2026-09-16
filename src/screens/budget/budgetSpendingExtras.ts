/**
 * The "extras" of a month's spending — the three figures the Spent tab calls
 * out in a banner above the list: what was SAVED on discounts, what was PAID in
 * container deposits, and what was PAID in sales tax.
 *
 * All three live INSIDE the spending rows (`saved_amount`, `deposit_amount`,
 * `tax_amount` on each `Expense`) and are summed the same way — every row dated
 * in the month, counted in the month of purchase (`monthExpenseView`), so a
 * stock-up spread over several months still reports its whole discount, deposit
 * and tax in the month it was bought. This module is the one place that knows
 * which overview field each banner reads, what the banner says, and how the
 * detail page behind it describes and charts it.
 */
import type { MonthlyOverview } from '@api/budget';
import type { AppBarDatum } from '@components/ui/AppBarChart';

import { monthLabel, shiftMonth } from './BudgetMonthHeader';

export type SpendingExtraKind = 'discounts' | 'deposits' | 'taxes';

/** Render order on the Spent tab — mirrors the order the banners appeared before taxes joined. */
export const SPENDING_EXTRA_KINDS: readonly SpendingExtraKind[] = ['discounts', 'deposits', 'taxes'];

/**
 * Stable per-kind testIDs. The discount and deposit ids predate this module and
 * are driven by Maestro (`budget-receipt-scan-quality` asserts the deposits
 * banner after a save), so they are kept verbatim rather than regularised.
 */
export const SPENDING_EXTRA_BANNER_TEST_IDS: Record<SpendingExtraKind, string> = {
  discounts: 'budget-savings-banner',
  deposits: 'budget-deposits-banner',
  taxes: 'budget-taxes-banner',
};

export interface SpendingExtraCopy {
  /** Sheet title, e.g. "Taxes paid". */
  title: string;
  /** Banner sentence, split around the figure: "You paid {amount} in taxes this month". */
  bannerLead: string;
  bannerTail: string;
  /** Ionicon drawn in the banner and beside the page's headline figure. */
  icon: string;
  /** Accessibility label for the banner as a link to its detail page. */
  detailLabel: string;
  /** Plain-language answer to "what is this figure?". */
  what: string;
  /** Where each cent comes from and how the month's number is assembled. */
  how: string;
  /** Noun for the chart caption: "saved on discounts", "paid in taxes". */
  chartNoun: string;
}

export const SPENDING_EXTRA_COPY: Record<SpendingExtraKind, SpendingExtraCopy> = {
  discounts: {
    title: 'Discount savings',
    bannerLead: 'You saved',
    bannerTail: 'on discounts this month',
    icon: 'pricetag',
    detailLabel: 'Discount savings — what they are, how they are calculated, and previous months',
    what:
      'The money you did not spend because an item was on sale, discounted or bought with a coupon — the gap between the regular price and what you actually paid.',
    how:
      'Every spending can carry a saved amount: the receipt scanner reads it off the printed discount lines, and the manual form has an “On sale / discount” field. This figure adds those amounts up across every spending dated in the month. A discount stays with the purchase it came from, so a stock-up spread over several months counts its whole discount in the month it was bought.',
    chartNoun: 'saved on discounts',
  },
  deposits: {
    title: 'Deposits paid',
    bannerLead: 'You paid',
    bannerTail: 'in deposits this month',
    icon: 'cube-outline',
    detailLabel: 'Deposits paid — what they are, how they are calculated, and previous months',
    what:
      'Refundable container deposits and bottle fees — the deposit on cans and bottles in Canada, the CRV in the US — charged on top of the item price and returned when you bring the containers back.',
    how:
      'A deposit is part of the amount you paid and is tracked separately: the receipt scanner attaches each printed deposit line to its item. This figure adds those amounts up across every spending dated in the month, counted in the month of purchase. Spendings typed by hand carry no deposit, so they never contribute here.',
    chartNoun: 'paid in deposits',
  },
  taxes: {
    title: 'Taxes paid',
    bannerLead: 'You paid',
    bannerTail: 'in taxes this month',
    icon: 'receipt-outline',
    detailLabel: 'Taxes paid — what they are, how they are calculated, and previous months',
    what:
      'The sales tax included in what you spent — GST, PST or HST in Canada, state and local sales tax in the US. It is part of each spending’s amount, not an extra on top of it.',
    how:
      'The receipt scanner reads the tax off the printed receipt and splits it across the items; a spending typed by hand takes it from the “Sales tax” section of the form, either at your region’s rates or as the amount printed on the till slip. This figure adds those tax amounts up across every spending dated in the month, counted in the month of purchase.',
    chartNoun: 'paid in taxes',
  },
};

/** The overview field a kind reads, with the older-API fallback to zero. */
export function extraTotalCents(
  overview: MonthlyOverview | null | undefined,
  kind: SpendingExtraKind,
): number {
  if (!overview) return 0;
  switch (kind) {
    case 'discounts':
      return overview.savedTotal ?? 0;
    case 'deposits':
      return overview.depositsTotal ?? 0;
    case 'taxes':
      return overview.taxesTotal ?? 0;
  }
}

/** How many months the detail page charts, the viewed month included. */
export const EXTRAS_HISTORY_MONTHS = 6;

export interface ExtrasHistoryMonth {
  year: number;
  month: number;
}

/**
 * The window the page charts: `count` months ending at the viewed one, oldest
 * first, so the bars read left-to-right into the present.
 */
export function extrasHistoryMonths(
  year: number,
  month: number,
  count: number = EXTRAS_HISTORY_MONTHS,
): ExtrasHistoryMonth[] {
  const months: ExtrasHistoryMonth[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    months.push(shiftMonth(year, month, back));
  }
  return months;
}

/** One month of the window with every kind's figure — loaded once, charted per kind. */
export interface ExtrasHistoryPoint extends ExtrasHistoryMonth {
  cents: Record<SpendingExtraKind, number>;
}

/** Fold a loaded overview into a history point. */
export function extrasHistoryPoint(
  at: ExtrasHistoryMonth,
  overview: MonthlyOverview | null | undefined,
): ExtrasHistoryPoint {
  return {
    ...at,
    cents: {
      discounts: extraTotalCents(overview, 'discounts'),
      deposits: extraTotalCents(overview, 'deposits'),
      taxes: extraTotalCents(overview, 'taxes'),
    },
  };
}

/**
 * Bars for `AppBarChart`: dollars per month, the viewed month in the accent
 * colour and every earlier month in the muted one — the same convention the
 * dashboard's spending trend uses, so the two charts read the same way.
 */
export function extrasHistoryBars(
  points: readonly ExtrasHistoryPoint[],
  kind: SpendingExtraKind,
  viewed: ExtrasHistoryMonth,
  colors: { current: string; past: string },
): AppBarDatum[] {
  return points.map((point) => ({
    value: point.cents[kind] / 100,
    label: monthLabel(point.month),
    frontColor:
      point.year === viewed.year && point.month === viewed.month ? colors.current : colors.past,
  }));
}

export interface ExtrasHistorySummary {
  /** Σ across the window, in cents. */
  totalCents: number;
  /** Mean per month across the WHOLE window (zero months included), in cents. */
  averageCents: number;
  /** True when no month in the window has anything to show — the chart's empty state. */
  isEmpty: boolean;
}

export function extrasHistorySummary(
  points: readonly ExtrasHistoryPoint[],
  kind: SpendingExtraKind,
): ExtrasHistorySummary {
  const totalCents = points.reduce((sum, point) => sum + point.cents[kind], 0);
  return {
    totalCents,
    averageCents: points.length > 0 ? Math.round(totalCents / points.length) : 0,
    isEmpty: totalCents <= 0,
  };
}

/** "Apr–Sep 2026", or "Sep 2026" for a one-month window; spans a year boundary as "Nov 2025–Apr 2026". */
export function extrasHistoryRangeLabel(months: readonly ExtrasHistoryMonth[]): string {
  if (months.length === 0) return '';
  const first = months[0]!;
  const last = months[months.length - 1]!;
  if (months.length === 1) return `${monthLabel(last.month)} ${last.year}`;
  if (first.year === last.year) {
    return `${monthLabel(first.month)}–${monthLabel(last.month)} ${last.year}`;
  }
  return `${monthLabel(first.month)} ${first.year}–${monthLabel(last.month)} ${last.year}`;
}
