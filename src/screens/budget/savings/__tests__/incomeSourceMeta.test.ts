/**
 * Income source presentation + classification contract (frontend side).
 *
 * The FE mirrors `backend/src/constants/income-sources.ts` because mobile
 * cannot import from `backend/`. These tests pin the mirror so the two lists
 * cannot silently diverge, and pin the label map so a new source can never
 * reach the UI as a raw enum value.
 */
import {
  INCOME_SOURCE_LABELS,
  INCOME_SOURCE_OPTIONS,
  INCOME_SOURCE_TYPES,
  IRREGULAR_INCOME_SOURCE_TYPES,
  REGULAR_INCOME_SOURCE_TYPES,
  incomeSourceLabel,
  isIrregularIncomeSource,
} from '../incomeSourceMeta';

describe('income source constants (FE mirror)', () => {
  it('matches the backend list exactly', () => {
    // Kept in lockstep with backend/src/constants/income-sources.ts. If this
    // fails, the two mirrors have drifted — fix both, not just this one.
    expect(REGULAR_INCOME_SOURCE_TYPES).toEqual([
      'payroll',
      'rental',
      'rrsp_matching',
      'insurance',
      'other',
    ]);
    expect(IRREGULAR_INCOME_SOURCE_TYPES).toEqual([
      'marketplace_sale',
      'gift',
      'refund',
      'bonus',
      'freelance',
      'tax_refund',
    ]);
    expect(INCOME_SOURCE_TYPES).toEqual([
      ...REGULAR_INCOME_SOURCE_TYPES,
      ...IRREGULAR_INCOME_SOURCE_TYPES,
    ]);
  });

  it('classifies one-off sources as irregular and regular ones as regular', () => {
    for (const t of IRREGULAR_INCOME_SOURCE_TYPES) {
      expect(isIrregularIncomeSource(t)).toBe(true);
    }
    for (const t of REGULAR_INCOME_SOURCE_TYPES) {
      expect(isIrregularIncomeSource(t)).toBe(false);
    }
  });

  it('treats an unknown source as regular', () => {
    // Drives the overview split fallback — an unrecognised key must not be
    // counted as one-off income.
    expect(isIrregularIncomeSource('mystery_source')).toBe(false);
  });
});

describe('income source labels', () => {
  it('labels every source type — no raw enum can reach the UI', () => {
    for (const t of INCOME_SOURCE_TYPES) {
      const label = INCOME_SOURCE_LABELS[t];
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(t);
    }
  });

  it('names the one-off sources in plain language', () => {
    expect(incomeSourceLabel('marketplace_sale')).toBe('Marketplace sale');
    expect(incomeSourceLabel('gift')).toBe('Gift');
    expect(incomeSourceLabel('refund')).toBe('Refund');
    expect(incomeSourceLabel('bonus')).toBe('Bonus');
    expect(incomeSourceLabel('freelance')).toBe('Freelance');
    // Distinct from the pre-existing tax refund.
    expect(incomeSourceLabel('tax_refund')).toBe('Tax refund');
  });

  it('falls back to the raw key for an unrecognised source', () => {
    expect(incomeSourceLabel('mystery_source')).toBe('mystery_source');
  });

  it('offers every source in the picker, regular first', () => {
    expect(INCOME_SOURCE_OPTIONS.map((o) => o.value)).toEqual([...INCOME_SOURCE_TYPES]);
    expect(INCOME_SOURCE_OPTIONS[0].value).toBe('payroll');
    // The one-off block sits after the regular block.
    const firstIrregular = INCOME_SOURCE_OPTIONS.findIndex((o) =>
      isIrregularIncomeSource(o.value)
    );
    const lastRegular = INCOME_SOURCE_OPTIONS.map((o) => isIrregularIncomeSource(o.value)).lastIndexOf(
      false
    );
    expect(firstIrregular).toBeGreaterThan(lastRegular);
  });
});
