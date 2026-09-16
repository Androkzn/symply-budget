/**
 * Sales tax for a MANUALLY entered spending.
 *
 * The receipt scanner reads tax off the printed receipt and splits it back onto
 * each line ([[taxAttribution]]). A hand-typed spending has no receipt to read,
 * so the form asks instead: one row per tax the region actually charges (Canada
 * = GST + PST, an HST province = one HST row, the US = one Sales tax row), and
 * each row is either a RATE the app applies for you or a dollar amount you copy
 * straight off the till slip.
 *
 * The typed "Amount" is the PRE-TAX price. Every row is computed against it,
 * the rows are summed into one total tax, and that total is added on top — so
 * what gets recorded is `amount = subtotal + total tax` with
 * `tax_amount = total tax`, exactly the tax-inclusive shape the scanner writes
 * (see `Expense.amount`).
 *
 * Rates here come from the same province/state tables the scanner falls back
 * to, so a manually typed spending and a scanned one never disagree about what
 * BC charges.
 */
import { getTaxProfile } from '@features/budget/local/ai/taxAttribution';

import { toCents, toDollarsString } from './budgetItemFormUtils';

/** How a single tax row supplies its number. */
export type TaxEntryMode = 'percent' | 'amount';

export interface TaxLineDraft {
  /** Stable row key — the receipt flag letter ('G' GST, 'P' PST/QST, 'H' HST, 'S' sales tax). */
  key: string;
  /** Row heading, e.g. "GST". */
  label: string;
  mode: TaxEntryMode;
  /** Rate as a percent (5 = 5%). Read only in `percent` mode. */
  percent: number;
  /** Raw dollars text as typed. Read only in `amount` mode. */
  amount: string;
}

export const TAX_PERCENT_MIN = 0;
export const TAX_PERCENT_MAX = 30;
/**
 * Wheel step. 0.025 rather than a rounder 0.05 so Quebec's 9.975% QST — and
 * the US local rates that sit on the 0.125 grid (8.375%, 8.875%) — land on an
 * exact step instead of being silently snapped to a rate nobody charges.
 */
export const TAX_PERCENT_STEP = 0.025;

/**
 * Which flag letters become rows, in the order they are printed on a receipt.
 * 'L' (BC's liquor PST) is deliberately absent: it is a per-item rate, not
 * something a whole hand-typed purchase is charged at.
 */
const PRIMARY_TAX_CODES = ['G', 'H', 'P', 'S'];

/** Rate fraction (0.09975) → percent (9.975), without the float tail. */
function toPercent(rate: number): number {
  return Math.round(rate * 100_000) / 1000;
}

function makeLine(key: string, label: string, percent: number): TaxLineDraft {
  return { key, label, mode: 'percent', percent, amount: '' };
}

function isCanada(country: string | null | undefined): boolean {
  const code = (country ?? '').trim().toUpperCase();
  return code === 'CA' || code === 'CANADA';
}

/**
 * The tax rows to offer for a household's region, pre-filled with that region's
 * rates. Falls back to the country's row SHAPE (Canada = GST + PST) with blank
 * rates when the province/state is unset, so the user only has to supply the
 * numbers rather than work out which taxes apply.
 */
export function defaultTaxLines(
  country: string | null | undefined,
  region: string | null | undefined
): TaxLineDraft[] {
  const profile = getTaxProfile(country, region);
  if (profile) {
    const lines: TaxLineDraft[] = [];
    const seenLabels = new Set<string>();
    for (const code of PRIMARY_TAX_CODES) {
      const rule = profile.rates[code];
      // The US table maps every common single flag letter to ONE rule; dedupe by
      // label so a US household gets one "Sales Tax" row, not five.
      if (!rule || seenLabels.has(rule.label)) continue;
      seenLabels.add(rule.label);
      lines.push(makeLine(code, rule.label, toPercent(rule.rate)));
    }
    if (lines.length > 0) return lines;
  }

  if (isCanada(country)) return [makeLine('G', 'GST', 5), makeLine('P', 'PST', 0)];
  return [makeLine('S', 'Sales tax', 0)];
}

/** One row's tax in cents. A percent row is computed on the pre-tax subtotal. */
export function taxLineCents(line: TaxLineDraft, subtotalCents: number): number {
  if (line.mode === 'amount') {
    const cents = toCents(line.amount);
    return cents && cents > 0 ? cents : 0;
  }
  if (!(subtotalCents > 0) || !(line.percent > 0)) return 0;
  return Math.round((subtotalCents * line.percent) / 100);
}

/** Every row combined — the single figure stored as `Expense.tax_amount`. */
export function totalTaxCents(lines: TaxLineDraft[], subtotalCents: number): number {
  return lines.reduce((sum, line) => sum + taxLineCents(line, subtotalCents), 0);
}

/** "5%", "9.975%" — trailing zeros trimmed so a whole rate reads as one. */
export function formatTaxPercent(percent: number): string {
  return `${percent.toFixed(3).replace(/\.?0+$/, '')}%`;
}

/**
 * Rebuild the rows for an expense being EDITED. Only the combined tax total is
 * stored, so the split has to be inferred: when the total matches what the
 * region's rates would have produced (to the cent, allowing one cent of
 * rounding per row) the rows reopen as those rates, and the GST/PST breakdown
 * survives the round trip. Anything else — a scanned receipt's attributed
 * share, a figure typed by hand — comes back as a single amount row, because
 * inventing a split would change the number the user already saved.
 */
export function restoreTaxLines(
  taxCents: number,
  subtotalCents: number,
  country: string | null | undefined,
  region: string | null | undefined
): TaxLineDraft[] {
  if (taxCents > 0 && subtotalCents > 0) {
    const defaults = defaultTaxLines(country, region);
    const fromRates = totalTaxCents(defaults, subtotalCents);
    if (fromRates > 0 && Math.abs(fromRates - taxCents) <= defaults.length) return defaults;
  }
  return [
    { key: 'T', label: 'Sales tax', mode: 'amount', percent: 0, amount: toDollarsString(taxCents) },
  ];
}
