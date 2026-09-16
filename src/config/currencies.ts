/**
 * Supported display currencies for the ecosystem.
 *
 * This is a *display* preference only — amounts are still stored as integer
 * cents in the currency the user entered them; changing this simply swaps the
 * symbol/locale used when rendering money (see `formatBudgetCurrency`). It does
 * NOT convert values between currencies.
 *
 * `USD` is first / the default so behaviour is unchanged for existing users
 * (the app has always rendered a bare "$").
 */
export interface CurrencyOption {
  /** ISO 4217 code — the value we persist. */
  code: CurrencyCode;
  /**
   * Glyph shown in front of amounts (e.g. "$", "€", "£").
   *
   * The non-USD dollar currencies carry their country prefix ("CA$", "A$",
   * "MX$") — the same disambiguation `Intl.NumberFormat` applies. A bare "$"
   * for all four made the picker look broken: selecting Canadian Dollar
   * changed nothing on screen because it rendered identically to US Dollar.
   */
  symbol: string;
  /** Human label for the picker row. */
  label: string;
  /** BCP-47 locale used for `Intl.NumberFormat` where full formatting applies. */
  locale: string;
  /** ISO 4217 minor units — 0 for the currencies that have no sub-unit (JPY). */
  decimalDigits: number;
  /**
   * Flag for the picker, as an emoji.
   *
   * Recognised far faster than a three-letter code — someone scanning a list
   * for "the American one" finds 🇺🇸 before they read USD — and it disambiguates
   * the four currencies that all render as some kind of "$". The euro has no
   * country, so it takes the EU flag.
   */
  flag: string;
}

export type CurrencyCode =
  | 'USD'
  | 'CAD'
  | 'EUR'
  | 'GBP'
  | 'AUD'
  | 'JPY'
  | 'CNY'
  | 'INR'
  | 'CHF'
  | 'MXN'
  | 'BRL';

export const SUPPORTED_CURRENCIES: readonly CurrencyOption[] = [
  { code: 'USD', symbol: '$', label: 'US Dollar', locale: 'en-US', decimalDigits: 2 , flag: '🇺🇸' },
  { code: 'CAD', symbol: 'CA$', label: 'Canadian Dollar', locale: 'en-CA', decimalDigits: 2 , flag: '🇨🇦' },
  { code: 'EUR', symbol: '€', label: 'Euro', locale: 'en-IE', decimalDigits: 2 , flag: '🇪🇺' },
  { code: 'GBP', symbol: '£', label: 'British Pound', locale: 'en-GB', decimalDigits: 2 , flag: '🇬🇧' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar', locale: 'en-AU', decimalDigits: 2 , flag: '🇦🇺' },
  { code: 'JPY', symbol: '¥', label: 'Japanese Yen', locale: 'ja-JP', decimalDigits: 0 , flag: '🇯🇵' },
  { code: 'CNY', symbol: '¥', label: 'Chinese Yuan', locale: 'zh-CN', decimalDigits: 2 , flag: '🇨🇳' },
  { code: 'INR', symbol: '₹', label: 'Indian Rupee', locale: 'en-IN', decimalDigits: 2 , flag: '🇮🇳' },
  { code: 'CHF', symbol: 'CHF', label: 'Swiss Franc', locale: 'de-CH', decimalDigits: 2 , flag: '🇨🇭' },
  { code: 'MXN', symbol: 'MX$', label: 'Mexican Peso', locale: 'es-MX', decimalDigits: 2 , flag: '🇲🇽' },
  { code: 'BRL', symbol: 'R$', label: 'Brazilian Real', locale: 'pt-BR', decimalDigits: 2 , flag: '🇧🇷' },
] as const;

/** Every supported code, for schema validation and picker rows. */
export const SUPPORTED_CURRENCY_CODES: readonly CurrencyCode[] = SUPPORTED_CURRENCIES.map(
  (c) => c.code
);

export const DEFAULT_CURRENCY: CurrencyCode = 'USD';

const CURRENCY_BY_CODE: Record<string, CurrencyOption> = SUPPORTED_CURRENCIES.reduce(
  (acc, c) => {
    acc[c.code] = c;
    return acc;
  },
  {} as Record<string, CurrencyOption>
);

/** Resolve a (possibly unknown/legacy) code to a supported option, falling back to USD. */
export function resolveCurrency(code: string | null | undefined): CurrencyOption {
  if (code && CURRENCY_BY_CODE[code]) return CURRENCY_BY_CODE[code];
  return CURRENCY_BY_CODE[DEFAULT_CURRENCY];
}

/** The glyph for a code — "$" for unknown values so amounts never render symbol-less. */
export function currencySymbol(code: string | null | undefined): string {
  return resolveCurrency(code).symbol;
}

/**
 * ── Recognising a currency that is NOT the member's own ──────────────────────
 *
 * Everything above is about *rendering* the member's preference. The helpers
 * below answer a different question, asked by receipt import: what currency is
 * the money on this piece of paper in? A receipt from a trip prints its own
 * currency, and reading "45.20" off it as if it were the member's is how a
 * US$45.20 lunch lands in a Canadian budget as CA$45.20.
 */

/**
 * The ISO code each supported currency is printed as, plus the aliases a
 * receipt or a model might emit instead. Lower-case; matched exactly.
 */
const CURRENCY_ALIASES: Record<string, CurrencyCode> = {
  usd: 'USD',
  'us$': 'USD',
  us: 'USD',
  cad: 'CAD',
  'ca$': 'CAD',
  'c$': 'CAD',
  eur: 'EUR',
  '€': 'EUR',
  gbp: 'GBP',
  '£': 'GBP',
  aud: 'AUD',
  'a$': 'AUD',
  jpy: 'JPY',
  cny: 'CNY',
  rmb: 'CNY',
  inr: 'INR',
  '₹': 'INR',
  chf: 'CHF',
  mxn: 'MXN',
  'mx$': 'MXN',
  brl: 'BRL',
  'r$': 'BRL',
};

/**
 * A loose code/symbol → supported currency, or null when it is not one we
 * support or not decisive.
 *
 * A BARE "$" deliberately resolves to nothing: USD, CAD, AUD and MXN all print
 * it, so treating it as USD would silently convert a Canadian receipt for a
 * Canadian member. Ambiguity here has to stay ambiguous — the caller falls back
 * to the member's own currency, which is the no-op.
 */
export function normalizeCurrencyCode(raw: string | null | undefined): CurrencyCode | null {
  const key = raw?.trim().toLowerCase();
  if (!key) return null;
  if (CURRENCY_BY_CODE[key.toUpperCase()]) return key.toUpperCase() as CurrencyCode;
  return CURRENCY_ALIASES[key] ?? null;
}

/**
 * ISO-3166 country (as printed in a receipt address) → its currency.
 *
 * The second-best signal after the receipt naming its own currency, and the one
 * that resolves the symbols that are ambiguous on their own: "$" on a receipt
 * with a Texas address is USD, "¥" with a Tokyo address is JPY.
 */
const COUNTRY_CURRENCY: Record<string, CurrencyCode> = {
  US: 'USD', USA: 'USD',
  CA: 'CAD', CAN: 'CAD',
  GB: 'GBP', UK: 'GBP', GBR: 'GBP',
  AU: 'AUD', AUS: 'AUD',
  JP: 'JPY', JPN: 'JPY',
  CN: 'CNY', CHN: 'CNY',
  IN: 'INR', IND: 'INR',
  CH: 'CHF', CHE: 'CHF',
  MX: 'MXN', MEX: 'MXN',
  BR: 'BRL', BRA: 'BRL',
  // Eurozone.
  AT: 'EUR', BE: 'EUR', HR: 'EUR', CY: 'EUR', EE: 'EUR', FI: 'EUR', FR: 'EUR',
  DE: 'EUR', GR: 'EUR', IE: 'EUR', IT: 'EUR', LV: 'EUR', LT: 'EUR', LU: 'EUR',
  MT: 'EUR', NL: 'EUR', PT: 'EUR', SK: 'EUR', SI: 'EUR', ES: 'EUR',
};

/** Currency for a printed country code/name, or null when unknown. */
export function currencyForCountry(country: string | null | undefined): CurrencyCode | null {
  const key = country?.trim().toUpperCase();
  if (!key) return null;
  return COUNTRY_CURRENCY[key] ?? null;
}

/**
 * Scan raw receipt text for a currency it names OUTRIGHT.
 *
 * Only unambiguous markers count — a spelled ISO code as its own word, or a
 * symbol used by exactly one supported currency. "$" and "¥" are shared and are
 * therefore never decisive here; `currencyForCountry` settles those.
 */
export function detectCurrencyInText(text: string | null | undefined): CurrencyCode | null {
  if (!text) return null;
  const codeHit = text.toUpperCase().match(/\b(USD|CAD|EUR|GBP|AUD|JPY|CNY|INR|CHF|MXN|BRL)\b/);
  if (codeHit) return codeHit[1] as CurrencyCode;
  for (const [symbol, code] of [
    ['€', 'EUR'],
    ['£', 'GBP'],
    ['₹', 'INR'],
    ['R$', 'BRL'],
    ['US$', 'USD'],
    ['CA$', 'CAD'],
    ['MX$', 'MXN'],
  ] as Array<[string, CurrencyCode]>) {
    if (text.includes(symbol)) return code;
  }
  return null;
}
