/**
 * Conversion arithmetic for foreign receipts.
 *
 * The cases that matter are the ones where being slightly wrong is invisible:
 * rounding that makes a total disagree with its own lines, a currency with no
 * sub-unit, and a rate field that accepts something it should not.
 */
import {
  convertCents,
  formatRate,
  isUsableRate,
  MAX_RATE,
  MIN_RATE,
  needsConversion,
  parseRate,
} from '@utils/currencyConversion';

describe('convertCents', () => {
  it('converts at the given rate and rounds to the nearest cent', () => {
    expect(convertCents(1000, 1.3712, 'CAD')).toBe(1371);
    expect(convertCents(599, 1.3712, 'CAD')).toBe(821); // 821.35 → 821
    expect(convertCents(349, 1.3712, 'CAD')).toBe(479); // 478.55 → 479
  });

  it('is the identity at par, so a domestic receipt is untouched', () => {
    expect(convertCents(4520, 1, 'CAD')).toBe(4520);
  });

  it('rounds each line so a summed total always equals the printed lines', () => {
    // The whole reason lines are converted individually: 349 + 599 = 948, and
    // converting the total instead gives 1300 — one cent off the columns above
    // it, which reads as a bug on every receipt with an odd number of cents.
    const lines = [349, 599].map((c) => convertCents(c, 1.3712, 'CAD'));
    expect(lines).toEqual([479, 821]);
    expect(lines[0] + lines[1]).toBe(1300);
  });

  it('snaps to whole units for a currency with no sub-unit', () => {
    // ¥ has no sen. 100 "cents" is one yen, so the result must be a multiple
    // of 100 or the ledger holds an amount no receipt could have printed.
    const yen = convertCents(1000, 15.6, 'JPY');
    expect(yen % 100).toBe(0);
    expect(yen).toBe(15600);
  });

  it('refuses to invent an amount from an unusable rate', () => {
    expect(convertCents(1000, 0, 'CAD')).toBe(0);
    expect(convertCents(1000, Number.NaN, 'CAD')).toBe(0);
  });
});

describe('parseRate', () => {
  it('accepts a plain decimal', () => {
    expect(parseRate('1.37')).toBe(1.37);
    expect(parseRate(' 0.0092 ')).toBe(0.0092);
  });

  it('accepts a comma decimal, which is what a European keypad prints', () => {
    expect(parseRate('1,37')).toBe(1.37);
  });

  it('rejects empty, zero, and non-numeric input', () => {
    expect(parseRate('')).toBeNull();
    expect(parseRate(null)).toBeNull();
    expect(parseRate('0')).toBeNull();
    expect(parseRate('abc')).toBeNull();
    expect(parseRate('1.2.3')).toBeNull();
    expect(parseRate('-1.5')).toBeNull();
  });

  it('rejects a rate outside the plausible band', () => {
    expect(parseRate(String(MAX_RATE * 10))).toBeNull();
    expect(parseRate('0.0000001')).toBeNull();
    expect(isUsableRate(MIN_RATE)).toBe(true);
    expect(isUsableRate(MAX_RATE)).toBe(true);
  });
});

describe('formatRate', () => {
  it('keeps enough precision for a weak currency without padding a strong one', () => {
    expect(formatRate(1.37)).toBe('1.37');
    expect(formatRate(1.3712)).toBe('1.3712');
    expect(formatRate(0.0092)).toBe('0.0092');
    expect(formatRate(189.4213)).toBe('189.42');
    // Round-trips: whatever is shown must parse back to the same rate.
    expect(parseRate(formatRate(0.0092))).toBe(0.0092);
  });
});

describe('needsConversion', () => {
  it('is true only for a genuine, known mismatch', () => {
    expect(needsConversion('USD', 'CAD')).toBe(true);
    expect(needsConversion('CAD', 'CAD')).toBe(false);
    expect(needsConversion(null, 'CAD')).toBe(false);
    expect(needsConversion('USD', null)).toBe(false);
  });
});
