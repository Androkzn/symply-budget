/**
 * Converting an amount from the currency it was PRINTED in to the currency the
 * member budgets in.
 *
 * This is the one place in the ecosystem that changes what an amount is worth.
 * `@utils/money` deliberately does not: it swaps the symbol in front of a number
 * and says so loudly, because a display preference must never quietly restate
 * the value. Receipt import is the exception that proves it — a receipt from a
 * trip carries its own currency on the paper, and the member's budget is in
 * theirs, so somebody has to multiply.
 *
 * Everything here is pure. The rate itself comes from `@services/exchangeRates`
 * or from the member typing it in, and by the time it reaches these functions
 * the decision of which rate to trust has already been made.
 */
import { resolveCurrency, type CurrencyCode } from '@config/currencies';

/**
 * A rate outside this band is a typo, not a currency.
 *
 * Real pairs among the supported currencies span roughly 0.006 (JPY→GBP) to
 * ~190 (GBP→JPY), so the band is wide enough for every one of them and still
 * catches the two mistakes that actually happen: a rate left at 0, and a
 * percentage ("37") typed where a multiplier ("1.37") belongs.
 */
export const MIN_RATE = 0.0001;
export const MAX_RATE = 100000;

export interface ConversionRate {
  from: CurrencyCode;
  to: CurrencyCode;
  /** Multiply a `from` amount by this to get a `to` amount. */
  rate: number;
  /** ECB reference date (YYYY-MM-DD) for a fetched rate; null when hand-typed. */
  asOf: string | null;
  source: 'fetched' | 'manual';
}

/** True when this rate can be used — finite, positive, and not absurd. */
export function isUsableRate(rate: number | null | undefined): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= MIN_RATE && rate <= MAX_RATE;
}

/**
 * Parse what the member typed into the rate field.
 *
 * Accepts a plain decimal with either separator ("1.37", "1,37") because the
 * numeric keypad on a European device prints a comma. Returns null for anything
 * that is not a usable rate, which is what disables Save.
 */
export function parseRate(input: string | null | undefined): number | null {
  const cleaned = input?.trim().replace(',', '.');
  if (!cleaned) return null;
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return isUsableRate(value) ? value : null;
}

/**
 * A rate as text for the input field — enough precision to round-trip a weak
 * currency (JPY→CAD is 0.0092) without printing six zeros for a strong one.
 */
export function formatRate(rate: number): string {
  if (rate >= 100) return rate.toFixed(2);
  if (rate >= 1) return rate.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return rate.toPrecision(4).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * cents in the source currency → cents in the target currency.
 *
 * Rounds each line INDEPENDENTLY and at the last moment. Converting a running
 * total instead would be a cent or two more accurate and would stop the columns
 * adding up: the member sees per-line amounts and a total, and a total that is
 * not the sum of the lines above it reads as a bug every time. So the lines are
 * the truth and the total is their sum.
 *
 * Minor units are the target currency's own — converting to JPY yields whole
 * yen, because a fractional yen cannot be spent or displayed.
 */
export function convertCents(
  cents: number,
  rate: number,
  toCurrency?: CurrencyCode | string | null,
): number {
  if (!isUsableRate(rate) || !Number.isFinite(cents)) return 0;
  const converted = cents * rate;
  const digits = toCurrency ? resolveCurrency(toCurrency).decimalDigits : 2;
  if (digits === 0) {
    // JPY has no sub-unit: the ecosystem still stores integer "cents", so a
    // whole yen is 100 of them. Snapping to that here keeps ¥1,234 out of the
    // ledger as ¥1,234.56, which no Japanese receipt could have printed.
    return Math.round(converted / 100) * 100;
  }
  return Math.round(converted);
}

/** Whether a receipt in `from` needs converting for a member budgeting in `to`. */
export function needsConversion(
  from: CurrencyCode | null | undefined,
  to: CurrencyCode | null | undefined,
): boolean {
  return !!from && !!to && from !== to;
}
