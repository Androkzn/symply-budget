/**
 * Shared money/date helpers for Budget analysis domain services and chat adapters.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** cents → "$12.50". */
export function fmtCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** Integer cents → dollars float for chart series. */
export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/** Model-supplied dollar amount → integer cents (null when not a number). */
export function dollarsToCents(dollars: unknown): number | null {
  const n = typeof dollars === 'number' ? dollars : Number(dollars);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1] ?? month} ${year}`;
}

/** Parse a 'YYYY-MM' string; falls back to the provided ISO timestamp's month. */
export function resolveYearMonth(
  input: unknown,
  nowIso: string
): { year: number; month: number; label: string } {
  const fallback = nowIso.slice(0, 7);
  const raw = typeof input === 'string' && /^\d{4}-\d{2}$/.test(input) ? input : fallback;
  const [year, month] = raw.split('-').map((s) => parseInt(s, 10));
  return { year, month, label: monthLabel(year, month) };
}

/** Chronological YYYY-MM keys ending at (endYear, endMonth), oldest first. */
export function monthKeys(endYear: number, endMonth: number, monthsBack: number): string[] {
  const keys: string[] = [];
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(endYear, endMonth - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}
