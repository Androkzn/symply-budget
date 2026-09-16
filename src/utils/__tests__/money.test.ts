/**
 * The canonical money formatter. These tests exist because Settings → Currency
 * was, for a long time, a picker that changed nothing on screen: most screens
 * hard-coded "$", and the two dollar currencies the app offered (USD and CAD)
 * rendered with the identical glyph. Both failure modes are pinned here.
 */
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from '@config/currencies';
import { useAppStore } from '@stores/appStore';
import {
  currentCurrency,
  formatMoney,
  formatMoneyRange,
  formatMoneyUnits,
  moneySymbol,
} from '@utils/money';

function withCurrency(code: string, run: () => void) {
  const previous = useAppStore.getState().currency;
  useAppStore.setState({ currency: code as never });
  try {
    run();
  } finally {
    useAppStore.setState({ currency: previous });
  }
}

afterEach(() => {
  useAppStore.setState({ currency: DEFAULT_CURRENCY });
});

describe('symbol disambiguation', () => {
  it('gives every dollar currency a distinguishable glyph', () => {
    // The original bug: picking "Canadian Dollar" was a visual no-op because
    // CAD, AUD and MXN all rendered a bare "$" exactly like USD.
    const dollarSymbols = ['USD', 'CAD', 'AUD', 'MXN'].map((c) => moneySymbol(c));
    expect(dollarSymbols).toEqual(['$', 'CA$', 'A$', 'MX$']);
    expect(new Set(dollarSymbols).size).toBe(dollarSymbols.length);
  });

  it('keeps every supported symbol unique so no two picks look the same', () => {
    const symbols = SUPPORTED_CURRENCIES.map((c) => c.symbol);
    // CNY and JPY genuinely share "¥" in common usage; everything else must differ.
    const collisions = symbols.filter((s, i) => symbols.indexOf(s) !== i);
    expect(collisions).toEqual(['¥']);
  });
});

describe('formatMoney', () => {
  it('follows the selected display currency', () => {
    withCurrency('USD', () => expect(formatMoney(123456)).toBe('$1,235'));
    withCurrency('CAD', () => expect(formatMoney(123456)).toBe('CA$1,235'));
    withCurrency('GBP', () => expect(formatMoney(123456)).toBe('£1,235'));
  });

  it('leads with the sign, never "$-1,234"', () => {
    withCurrency('CAD', () => expect(formatMoney(-123400)).toBe('-CA$1,234'));
  });

  it('renders cents only when asked', () => {
    withCurrency('USD', () => {
      expect(formatMoney(549)).toBe('$5');
      expect(formatMoney(549, { decimals: 2 })).toBe('$5.49');
    });
  });

  it('clamps decimals to the currency precision (JPY has no sub-unit)', () => {
    withCurrency('JPY', () => expect(formatMoney(123400, { decimals: 2 })).toBe('¥1,234'));
  });

  it('abbreviates thousands for tight chart labels', () => {
    withCurrency('USD', () => {
      expect(formatMoney(120000, { abbreviate: true })).toBe('$1.2k');
      expect(formatMoney(1500000, { abbreviate: true })).toBe('$15k');
      expect(formatMoney(45000, { abbreviate: true })).toBe('$450');
      expect(formatMoney(-120000, { abbreviate: true })).toBe('-$1.2k');
    });
  });

  it('renders a zero amount rather than a bare symbol for null/undefined', () => {
    withCurrency('CAD', () => {
      expect(formatMoney(null)).toBe('CA$0');
      expect(formatMoney(undefined, { decimals: 2 })).toBe('CA$0.00');
      expect(formatMoney(null, { fallback: '—' })).toBe('—');
    });
  });

  it('honors an explicit code for amounts that carry their own currency', () => {
    withCurrency('USD', () => expect(formatMoney(500000, { code: 'EUR' })).toBe('€5,000'));
  });

  it('falls back to the default currency for an unknown stored code', () => {
    withCurrency('ZZZ', () => {
      expect(currentCurrency().code).toBe(DEFAULT_CURRENCY);
      expect(formatMoney(100)).toBe('$1');
    });
  });
});

describe('formatMoneyUnits', () => {
  it('takes whole units instead of cents', () => {
    withCurrency('CAD', () => {
      expect(formatMoneyUnits(1234)).toBe('CA$1,234');
      expect(formatMoneyUnits(12.5, { decimals: 2 })).toBe('CA$12.50');
    });
  });
});

describe('formatMoneyRange', () => {
  it('collapses to one figure when the bounds match or the max is missing', () => {
    withCurrency('USD', () => {
      expect(formatMoneyRange(50000, 50000)).toBe('$500');
      expect(formatMoneyRange(50000, null)).toBe('$500');
      expect(formatMoneyRange(50000, 90000)).toBe('$500 - $900');
    });
  });

  it('reports the empty placeholder when there are no bounds', () => {
    expect(formatMoneyRange(null, null)).toBe('TBD');
    expect(formatMoneyRange(0, 0, { empty: 'Cost TBD' })).toBe('Cost TBD');
  });
});
