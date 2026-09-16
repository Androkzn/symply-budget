/**
 * Fuel bought by the gallon, read by someone who buys it by the litre.
 *
 * A US pump receipt prints gallons and a price per gallon. A member in Canada
 * has no feel for either: "$6.099/gal" is not a number they can compare to the
 * station they drive past every day. Converting the currency alone does not fix
 * it — CA$8.43/gal is just as unreadable. The unit has to change too, and the
 * two conversions have to happen together or the figure is nonsense.
 *
 * Everything here is pure. What unit the receipt used comes from the scan; what
 * the member wants to see is decided by the screen.
 */
import { resolveCurrency, type CurrencyCode } from '@config/currencies';

/** Exact by definition: 231 cubic inches, and an inch is exactly 25.4 mm. */
export const US_GALLON_LITRES = 3.785411784;

/**
 * The imperial gallon is a DIFFERENT gallon — 20% larger. Canada and the UK
 * used it before metrication, and receipts from either can still say "gallon"
 * meaning this one. Reading an imperial gallon as a US one overstates the
 * per-litre price by that 20%, which looks plausible and is simply wrong, so
 * the two are kept apart rather than folded into one constant.
 */
export const IMPERIAL_GALLON_LITRES = 4.54609;

export type VolumeUnit = 'gal' | 'imp_gal' | 'L';

/**
 * A printed unit → the one we can compute with, or null when it is not a volume
 * at all (a receipt line's "unit" is far more often `ea`, `lb` or `kg`).
 */
export function normalizeVolumeUnit(raw: string | null | undefined): VolumeUnit | null {
  const key = raw?.trim().toLowerCase().replace(/\.$/, '');
  if (!key) return null;
  if (['l', 'lt', 'ltr', 'litre', 'liter', 'litres', 'liters'].includes(key)) return 'L';
  if (['impgal', 'imp gal', 'imperial gallon', 'imp. gallon', 'uk gal'].includes(key)) {
    return 'imp_gal';
  }
  if (['g', 'gal', 'gallon', 'gallons', 'us gal', 'usgal'].includes(key)) return 'gal';
  return null;
}

/** Quantity in `unit` → litres. */
export function toLitres(quantity: number, unit: VolumeUnit): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (unit === 'L') return quantity;
  return quantity * (unit === 'imp_gal' ? IMPERIAL_GALLON_LITRES : US_GALLON_LITRES);
}

/**
 * Price per litre, in cents of whatever currency `amountCents` is already in.
 *
 * Returns null rather than 0 when it cannot be computed: a per-litre price of
 * zero is a claim about the fuel, and "we don't know" is not that.
 *
 * NOT rounded to whole cents. Fuel is priced to a tenth of a cent at every pump
 * on both sides of the border — $6.099, not $6.10 — so rounding here would
 * throw away the digit the member is actually comparing.
 */
export function pricePerLitre(
  amountCents: number,
  quantity: number,
  unit: VolumeUnit,
): number | null {
  const litres = toLitres(quantity, unit);
  if (litres <= 0 || !Number.isFinite(amountCents) || amountCents <= 0) return null;
  return amountCents / litres;
}

/**
 * A per-litre price for display, e.g. `$1.611/L`.
 *
 * Three decimals on the unit price, matching how pumps quote it. `formatMoney`
 * is not used: it clamps to the currency's minor units, which would render
 * $1.611 as $1.61 and lose exactly the precision this line exists to show.
 */
export function formatPerLitre(cents: number, code: CurrencyCode): string {
  const currency = resolveCurrency(code);
  const units = cents / 100;
  const decimals = currency.decimalDigits === 0 ? 1 : 3;
  return `${currency.symbol}${units.toFixed(decimals)}/L`;
}

/** Litres for display — one decimal is the resolution a pump reports. */
export function formatLitres(litres: number): string {
  return `${litres.toFixed(1)} L`;
}
