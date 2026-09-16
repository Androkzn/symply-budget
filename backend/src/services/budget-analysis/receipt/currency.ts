/**
 * Normalising the currency a receipt was printed in.
 *
 * Deliberately duplicates the mobile client's `@config/currencies` rather than
 * sharing it — the same split the fee and tax attribution helpers already live
 * with, because the mobile tsconfig excludes `backend/**` and there is no
 * shared package between the two trees. The list below and the client's must be
 * changed together; the contract is the ISO code on the wire, so a code only
 * one side knows degrades to null rather than to a wrong conversion.
 */

/** Currencies the ecosystem can display and therefore convert into. */
const SUPPORTED = new Set([
  'USD', 'CAD', 'EUR', 'GBP', 'AUD', 'JPY', 'CNY', 'INR', 'CHF', 'MXN', 'BRL',
]);

/** Codes and symbols a model might return instead of the bare ISO code. */
const ALIASES: Record<string, string> = {
  'US$': 'USD', US: 'USD',
  'CA$': 'CAD', C$: 'CAD',
  '€': 'EUR',
  '£': 'GBP',
  A$: 'AUD',
  RMB: 'CNY',
  '₹': 'INR',
  'MX$': 'MXN',
  R$: 'BRL',
};

/**
 * The currency the model reported, normalised to a supported ISO code.
 *
 * Null when the receipt named nothing — never a guess, and deliberately NOT
 * inferred from the printed store country. Whether a Canadian receipt is
 * "foreign" depends on where the MEMBER is, which is device state the Worker
 * does not have; the client pairs `receipt_country` with the member's own
 * region to decide. A guess here would rewrite every amount on the receipt,
 * while a null leaves a domestic import exactly as it was.
 */
export function normalizeReceiptCurrency(reported: string | null | undefined): string | null {
  const key = reported?.trim().toUpperCase();
  if (!key) return null;
  if (SUPPORTED.has(key)) return key;
  return ALIASES[key] ?? null;
}
