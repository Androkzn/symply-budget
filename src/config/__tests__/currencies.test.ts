/**
 * Unit tests for the supported-currency registry + resolvers. These back the
 * Settings → Currency picker and the budget money formatter, so an unknown or
 * legacy persisted code must always degrade to a sensible default rather than
 * render an amount with no symbol.
 */
import {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  currencyForCountry,
  currencySymbol,
  detectCurrencyInText,
  normalizeCurrencyCode,
  resolveCurrency,
} from '../currencies';

describe('currencies registry', () => {
  it('defaults to USD and lists it first', () => {
    expect(DEFAULT_CURRENCY).toBe('USD');
    expect(SUPPORTED_CURRENCIES[0].code).toBe('USD');
  });

  it('has unique codes and a non-empty symbol/label/locale for every option', () => {
    const codes = SUPPORTED_CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of SUPPORTED_CURRENCIES) {
      expect(c.symbol).toBeTruthy();
      expect(c.label).toBeTruthy();
      expect(c.locale).toBeTruthy();
    }
  });
});

describe('resolveCurrency', () => {
  it('returns the matching option for a known code', () => {
    expect(resolveCurrency('EUR').symbol).toBe('€');
    expect(resolveCurrency('GBP').label).toBe('British Pound');
  });

  it('falls back to the default (USD) for unknown / null / undefined', () => {
    expect(resolveCurrency('ZZZ').code).toBe('USD');
    expect(resolveCurrency(null).code).toBe('USD');
    expect(resolveCurrency(undefined).code).toBe('USD');
  });
});

describe('currencySymbol', () => {
  it('returns the glyph for a known code', () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('INR')).toBe('₹');
  });

  it('falls back to "$" for an unknown code', () => {
    expect(currencySymbol('ZZZ')).toBe('$');
  });
});

describe('recognising a receipt currency', () => {
  it('normalizes ISO codes, casing, and the symbols a model might return', () => {
    expect(normalizeCurrencyCode('USD')).toBe('USD');
    expect(normalizeCurrencyCode('cad')).toBe('CAD');
    expect(normalizeCurrencyCode('€')).toBe('EUR');
    expect(normalizeCurrencyCode('R$')).toBe('BRL');
    expect(normalizeCurrencyCode('RMB')).toBe('CNY');
  });

  it('returns null for nothing, noise, and unsupported currencies', () => {
    expect(normalizeCurrencyCode(null)).toBeNull();
    expect(normalizeCurrencyCode('')).toBeNull();
    expect(normalizeCurrencyCode('NOK')).toBeNull();
    expect(normalizeCurrencyCode('banana')).toBeNull();
  });

  it('refuses to resolve a bare dollar sign', () => {
    // USD, CAD, AUD and MXN all print "$". Calling it USD would convert a
    // Canadian member's Canadian receipt at a rate nobody asked for.
    expect(normalizeCurrencyCode('$')).toBeNull();
    expect(detectCurrencyInText('TOTAL $45.20')).toBeNull();
  });

  it('maps a printed country to its currency, eurozone included', () => {
    expect(currencyForCountry('US')).toBe('USD');
    expect(currencyForCountry('ca')).toBe('CAD');
    expect(currencyForCountry('FR')).toBe('EUR');
    expect(currencyForCountry('DE')).toBe('EUR');
    expect(currencyForCountry('NO')).toBeNull();
    expect(currencyForCountry(null)).toBeNull();
  });

  it('reads a currency out of receipt text only when it is unambiguous', () => {
    expect(detectCurrencyInText('SUBTOTAL 40.00 USD')).toBe('USD');
    expect(detectCurrencyInText('Total £12.40')).toBe('GBP');
    expect(detectCurrencyInText('Gesamt 12,40 €')).toBe('EUR');
    // Shared between JPY and CNY — never decisive on its own.
    expect(detectCurrencyInText('合計 ¥1200')).toBeNull();
    expect(detectCurrencyInText('')).toBeNull();
  });
});
