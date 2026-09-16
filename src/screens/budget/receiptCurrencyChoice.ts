/**
 * Deciding what currency a scanned receipt's amounts are in.
 *
 * The hard part is not reading a currency off a receipt — it is knowing when
 * NOT to. Getting this wrong in the cautious direction costs a member one tap
 * in a picker; getting it wrong in the confident direction silently multiplies
 * every line of their grocery shop by 1.37 and there is nothing on the screen
 * afterwards that would look wrong to them.
 *
 * So the two available signals are ranked by how much they actually prove:
 *
 *  1. **Printed.** The receipt named its currency — an ISO code, or a symbol
 *     only one currency uses. This is about the money itself, so it decides.
 *
 *  2. **The store's address.** A Vancouver address means the till rang up
 *     Canadian dollars; that part is certain. What is NOT certain is that this
 *     makes the receipt *foreign*, and that is the question being asked here.
 *     `currency` defaults to USD for every member who has never opened
 *     Settings → Currency, so "receipt says CAD, preference says USD" is the
 *     ordinary state of a Canadian member who simply never changed it — not a
 *     trip to the States. Converting there would corrupt the common case in
 *     order to serve the rare one.
 *
 *     An address is therefore only allowed to override when it disagrees with
 *     a home country we actually know: a member whose region says CA scanning a
 *     receipt printed in the US really is travelling. With no known home
 *     country we assume home, which is exactly the behaviour receipt import had
 *     before conversion existed.
 *
 * Either way the member can set the currency by hand, so every path here is a
 * default rather than a verdict.
 */
import {
  currencyForCountry,
  normalizeCurrencyCode,
  type CurrencyCode,
} from '@config/currencies';

export interface ScanCurrencyInput {
  /** `receipt_currency` off the scan — what the receipt itself said, if anything. */
  printed?: string | null;
  /** `receipt_country` off the scan — the printed store address. */
  receiptCountry?: string | null;
  /** The member's own country (Settings → Region), or null when unset. */
  memberCountry?: string | null;
  /** The member's display currency — the currency their budget is kept in. */
  memberCurrency: CurrencyCode;
}

/**
 * The currency to read the scanned amounts as. Never null: falls back to the
 * member's own, which makes conversion a no-op.
 */
export function resolveScanCurrency(input: ScanCurrencyInput): CurrencyCode {
  const printed = normalizeCurrencyCode(input.printed);
  if (printed) return printed;

  const receiptCountry = input.receiptCountry?.trim().toUpperCase();
  const memberCountry = input.memberCountry?.trim().toUpperCase();
  if (receiptCountry && memberCountry && receiptCountry !== memberCountry) {
    const abroad = currencyForCountry(receiptCountry);
    if (abroad) return abroad;
  }

  return input.memberCurrency;
}
