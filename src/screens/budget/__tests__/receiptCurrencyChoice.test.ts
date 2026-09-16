/**
 * Which currency a scanned receipt's amounts are read as.
 *
 * The asymmetry under test: being too cautious costs a tap in a picker, being
 * too confident silently multiplies a whole grocery shop by an exchange rate.
 * Most of these cases are about NOT converting.
 */
import { resolveScanCurrency } from '../receiptCurrencyChoice';

describe('resolveScanCurrency', () => {
  it('takes the currency the receipt printed, over everything else', () => {
    expect(
      resolveScanCurrency({
        printed: 'USD',
        receiptCountry: 'CA',
        memberCountry: 'CA',
        memberCurrency: 'CAD',
      }),
    ).toBe('USD');
  });

  it('normalizes a symbol or alias the model returned instead of a code', () => {
    expect(resolveScanCurrency({ printed: '£', memberCurrency: 'CAD' })).toBe('GBP');
    expect(resolveScanCurrency({ printed: 'us$', memberCurrency: 'CAD' })).toBe('USD');
  });

  it("falls back to the member's own currency when the receipt named none", () => {
    expect(resolveScanCurrency({ printed: null, memberCurrency: 'CAD' })).toBe('CAD');
  });

  it('infers from the store address when the member is demonstrably elsewhere', () => {
    // A Canadian member with a receipt from a US store: a real trip.
    expect(
      resolveScanCurrency({
        printed: null,
        receiptCountry: 'US',
        memberCountry: 'CA',
        memberCurrency: 'CAD',
      }),
    ).toBe('USD');
  });

  it('does NOT infer from the store address when the member is in that country', () => {
    expect(
      resolveScanCurrency({
        printed: null,
        receiptCountry: 'CA',
        memberCountry: 'CA',
        memberCurrency: 'CAD',
      }),
    ).toBe('CAD');
  });

  it('does NOT infer from the store address when the home country is unknown', () => {
    // The regression this guards: `currency` defaults to USD for everyone who
    // never opened Settings → Currency, so a Canadian receipt would otherwise
    // look "foreign" to every unconfigured Canadian member and demand a rate
    // before they could import their weekly shop.
    expect(
      resolveScanCurrency({
        printed: null,
        receiptCountry: 'CA',
        memberCountry: null,
        memberCurrency: 'USD',
      }),
    ).toBe('USD');
  });

  it('ignores a country whose currency the ecosystem cannot display', () => {
    expect(
      resolveScanCurrency({
        printed: null,
        receiptCountry: 'NO',
        memberCountry: 'CA',
        memberCurrency: 'CAD',
      }),
    ).toBe('CAD');
  });
});
