import { describe, it, expect } from 'vitest';

import {
  lastFourDigits,
  scrubDigits,
  parseAmortizationMonths,
  parseRatePeriods,
  normalizeMortgageDraft,
} from '../statement-normalize';

describe('parseRatePeriods', () => {
  it('parses the interest breakdown into sorted, safe periods', () => {
    const periods = parseRatePeriods([
      { effective_date: 'Oct 30, 2025', interest_rate: 3.59, prime_rate: 4.45, variance: -0.86 },
      { effective_date: '2025-10-01', interest_rate: 3.84, prime_rate: 4.7, variance: -0.86 },
    ]);
    // Sorted oldest-first; dates normalized to YYYY-MM-DD.
    expect(periods.map((p) => p.effectiveDate)).toEqual(['2025-10-01', '2025-10-30']);
    expect(periods[1]).toEqual({
      effectiveDate: '2025-10-30',
      interestRate: 3.59,
      primeRate: 4.45,
      variance: -0.86,
    });
  });
  it('drops entries missing a date or rate, and tolerates a non-array', () => {
    expect(parseRatePeriods([{ interest_rate: 3.5 }, { effective_date: '2025-01-01' }])).toEqual([]);
    expect(parseRatePeriods(null)).toEqual([]);
    expect(parseRatePeriods('nope')).toEqual([]);
  });
});

describe('lastFourDigits', () => {
  it('returns the last 4 digits of an account-number-like value', () => {
    expect(lastFourDigits('9104-4099855')).toBe('9855');
    expect(lastFourDigits(987654)).toBe('7654');
  });
  it('returns null when fewer than 4 digits or empty', () => {
    expect(lastFourDigits('12')).toBeNull();
    expect(lastFourDigits(null)).toBeNull();
    expect(lastFourDigits('')).toBeNull();
  });
});

describe('scrubDigits', () => {
  it('masks long digit runs keeping only the last 4', () => {
    const out = scrubDigits('Account 9104-4099855 term portion');
    expect(out).toContain('••••9855');
    expect(out).not.toContain('4099855');
  });
  it('leaves short numbers (amounts) alone', () => {
    expect(scrubDigits('paid 2170.08')).toBe('paid 2170.08');
  });
  it('fully masks a separator-heavy run with fewer than 4 digits', () => {
    expect(scrubDigits('ref 1------1 end')).toContain('••••');
    expect(scrubDigits('ref 1------1 end')).not.toContain('••••1');
  });
});

describe('parseAmortizationMonths', () => {
  it('parses "X Years Y Months"', () => {
    expect(parseAmortizationMonths('11 Years 06 Months')).toBe(138);
    expect(parseAmortizationMonths('25 years')).toBe(300);
    expect(parseAmortizationMonths('6 months')).toBe(6);
  });
  it('accepts a bare number as months, and a numeric input', () => {
    expect(parseAmortizationMonths('300')).toBe(300);
    expect(parseAmortizationMonths(240)).toBe(240);
  });
  it('returns null for unparseable / missing / non-finite', () => {
    expect(parseAmortizationMonths('n/a')).toBeNull();
    expect(parseAmortizationMonths(null)).toBeNull();
    expect(parseAmortizationMonths(Infinity)).toBeNull();
  });
});

describe('normalizeMortgageDraft — deterministic PII scrub + allowlist', () => {
  it('DROPS borrower name and full number; keeps only last-4 (security)', () => {
    const draft = normalizeMortgageDraft({
      lender: 'TD',
      borrower_name: 'Jane Q Public', // must be dropped
      account_number: '9104-4099855', // full number must never survive
      mortgage_number: '9104-4099855-01',
      closing_balance: 975361.04,
      confidence: 0.92,
    });
    // No name anywhere in the safe draft.
    expect(JSON.stringify(draft)).not.toContain('Jane');
    expect(JSON.stringify(draft)).not.toContain('4099855');
    expect(draft.mortgageNumberLast4).toBe('9855');
    expect(draft.closingBalance).toBe(975361.04);
    expect(draft.confidence).toBe(0.92);
  });

  it('maps a TD FlexLine (combined product) correctly', () => {
    const draft = normalizeMortgageDraft({
      lender: 'TD',
      product_type: 'flexline',
      has_heloc_portion: true,
      statement_date: '2025-07-31',
      closing_balance: 975361.04,
      interest_paid: 1531.12,
      interest_charged: 1640.41,
      principal_paid: 638.96,
      payment_amount: 2170.08,
      interest_rate: 4.09,
      rate_type: 'Variable',
      prime_rate: 4.95,
      variance: -0.86,
      payment_frequency: 'biweekly',
      remaining_amortization: '29 Years 08 Months',
      maturity_date: '2028-07-13',
    });
    expect(draft.productType).toBe('heloc_flexline');
    expect(draft.hasHelocPortion).toBe(true);
    expect(draft.rateType).toBe('variable');
    expect(draft.interestPaid).toBe(1531.12);
    expect(draft.interestCharged).toBe(1640.41);
    expect(draft.primeRate).toBe(4.95);
    expect(draft.variance).toBe(-0.86);
    expect(draft.remainingAmortizationMonths).toBe(356);
    expect(draft.maturityDate).toBe('2028-07-13');
  });

  it('handles fixed/standard, string amounts, bad dates, and defaults', () => {
    const draft = normalizeMortgageDraft({
      product_type: 'standard',
      rate_type: 'fixed',
      closing_balance: '$500,000.00', // string with symbols
      statement_date: 'not-a-date',
    });
    expect(draft.productType).toBe('standard');
    expect(draft.rateType).toBe('fixed');
    expect(draft.closingBalance).toBe(500000);
    expect(draft.statementDate).toBeNull();
    expect(draft.confidence).toBe(0.5); // default
    expect(draft.hasHelocPortion).toBe(false);
    expect(draft.mortgageNumberLast4).toBeNull();
  });

  it('maps step product and unknown rate/product to null', () => {
    const step = normalizeMortgageDraft({ product_type: 'step' });
    expect(step.productType).toBe('step');
    const unknown = normalizeMortgageDraft({ product_type: 'weird', rate_type: 'mystery' });
    expect(unknown.productType).toBeNull();
    expect(unknown.rateType).toBeNull();
  });

  it('tolerates a null/undefined input object', () => {
    const draft = normalizeMortgageDraft(null);
    expect(draft.lender).toBeNull();
    expect(draft.confidence).toBe(0.5);
  });

  it('coerces non-numeric / non-finite amount fields to null', () => {
    const draft = normalizeMortgageDraft({
      closing_balance: true, // boolean → null
      opening_balance: Infinity, // non-finite number → null
      interest_paid: {}, // object → null
    });
    expect(draft.closingBalance).toBeNull();
    expect(draft.openingBalance).toBeNull();
    expect(draft.interestPaid).toBeNull();
  });
});
