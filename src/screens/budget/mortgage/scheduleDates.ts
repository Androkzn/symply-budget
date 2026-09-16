import type { MortgagePaymentFrequency } from '@api/mortgage';
import { paymentsPerYear } from '@features/mortgage/amortization';

/**
 * Calendar date of a schedule row, so the amortization table can label each
 * payment by the month it lands in (and link the month to its statement).
 *
 * Mirrors the backend schedule convention EXACTLY: the schedule is built from the
 * current term's `term_start_date`, and a payment "elapses" once `days / (365/n)`
 * crosses its index (see `clampPayments` in mortgage-service.ts). So payment `k`
 * (1-based) lands one payment period after the term start → `start + k periods`.
 *
 * Monthly uses whole-month arithmetic (exact, overflow-free — only the month is
 * shown); every other frequency steps by `365/n` days to match the backend's
 * per-payment day length. Timezone-safe: the ISO parts are parsed directly and
 * day-of-month math runs in UTC, so a month never rolls back a day in a
 * negative-offset zone.
 *
 * @returns `YYYY-MM-DD`, or `null` when the term start is missing/unparseable.
 */
export function paymentDateIso(
  termStartDate: string | null | undefined,
  index: number,
  frequency: MortgagePaymentFrequency
): string | null {
  if (!termStartDate || !Number.isFinite(index)) return null;
  const [y, m, d] = termStartDate.split('-').map((p) => parseInt(p, 10));
  if (!y || !m || !d) return null;

  if (frequency === 'monthly') {
    const total = m - 1 + index; // months since the term-start year's January
    const year = y + Math.floor(total / 12);
    const month = (total % 12) + 1;
    // Clamp the day so a 29–31 start never produces an invalid short-month date
    // (only the year+month are ever displayed/matched, so the day is cosmetic).
    return `${year}-${pad(month)}-${pad(Math.min(d, 28))}`;
  }

  const perPaymentDays = 365 / paymentsPerYear(frequency);
  const ms = Date.UTC(y, m - 1, d) + Math.round(index * perPaymentDays) * 86_400_000;
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
