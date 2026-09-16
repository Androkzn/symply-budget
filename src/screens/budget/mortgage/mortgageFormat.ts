/**
 * Shared display formatters for the Mortgage screens. Money on a mortgage is
 * six figures, so headline figures drop the cents ($975,361) — cents noise makes
 * the numbers harder to compare, not more precise.
 *
 * Timezone note: every date formatter here parses the ISO `YYYY-MM-DD` parts
 * DIRECTLY. `new Date('2025-07-31')` is UTC midnight, so `toLocale…` rolls back a
 * day — and thus a month — in negative-offset zones.
 */
import { formatMoney, formatMoneyUnits } from '@utils/money';

/** Whole-dollar currency for headline figures ($975,361 — no cents noise). */
export function fmtCents(cents: number): string {
  return formatMoney(cents);
}

/** Dollars with cents, for small per-unit figures ($0.72 per $1 borrowed). */
export function fmtDollarsPrecise(dollars: number): string {
  return formatMoneyUnits(dollars, { decimals: 2 });
}

// prettier-ignore
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Month + year for a statement/payment anchor ("Jul 2025"). */
export function fmtMonthYear(dateStr: string): string {
  const [y, m] = dateStr.split('-');
  const idx = parseInt(m, 10) - 1;
  if (!y || Number.isNaN(idx) || idx < 0 || idx > 11) return dateStr;
  return `${MONTHS_SHORT[idx]} ${y}`;
}

/** A duration in months as "3y 7m" / "7 mo" — a raw month count reads as noise. */
export function fmtMonths(months: number | null): string {
  if (months == null) return '—';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y <= 0) return `${m} mo`;
  return m > 0 ? `${y}y ${m}m` : `${y}y`;
}

/** Whole percent from a 0–1 fraction ("34%"). */
export function fmtPercentOfOne(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
