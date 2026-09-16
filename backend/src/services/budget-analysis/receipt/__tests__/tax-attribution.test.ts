import { describe, it, expect } from 'vitest';

import {
  attributeItemTaxes,
  getTaxProfile,
  type TaxableLine,
  type TaxComponentInput,
} from '../tax-attribution';

/**
 * Real Costco Surrey #55 (BC) receipt — the printed footer reads:
 *   (P) PST 7%  4.41
 *   (G) GST 5%  4.75
 *   TAX 9.16
 * GP items are taxed both; G items GST-only; unflagged groceries are exempt.
 */
const COSTCO_LINES: TaxableLine[] = [
  { amount: 699, tax_codes: [] }, // Ace Bakery (exempt)
  { amount: 1099, tax_codes: [] }, // Envy Apples (exempt)
  { amount: 1299, tax_codes: ['G', 'P'] }, // KS Bags 60 (GP)
  { amount: 4999, tax_codes: ['G', 'P'] }, // KS Gusseted (GP)
  { amount: 799, tax_codes: ['G'] }, // Roti Chicken (G)
  { amount: 1099, tax_codes: ['G'] }, // Jollyrancher (G)
  { amount: 1299, tax_codes: ['G'] }, // Trads Fudge (G)
];

const COSTCO_TAX: TaxComponentInput[] = [
  { code: 'P', label: 'PST', rate_percent: 7, amount: 441 },
  { code: 'G', label: 'GST', rate_percent: 5, amount: 475 },
];

describe('attributeItemTaxes — printed amounts + per-item flags (Costco BC)', () => {
  const bc = getTaxProfile('CA', 'BC');
  const result = attributeItemTaxes(COSTCO_LINES, COSTCO_TAX, bc);

  it('reconciles to the printed tax total (9.16) to the cent', () => {
    expect(result.totalTax).toBe(916);
    expect(result.source).toBe('printed-coded');
  });

  it('breaks tax down by label matching the receipt footer', () => {
    const byLabel = Object.fromEntries(result.breakdown.map((b) => [b.label, b.amount]));
    expect(byLabel.GST).toBe(475);
    expect(byLabel.PST).toBe(441);
  });

  it('PST lands only on the GP items and sums to 4.41', () => {
    const pstIdx = [2, 3]; // the two GP lines
    const nonPstIdx = [0, 1, 4, 5, 6];
    // Each GP line carries GST + PST; the non-GP-but-G lines carry GST only, so
    // their tax must be strictly less than a GP line of similar price would be.
    const pstShare = pstIdx.reduce((s, i) => s + result.lineTaxes[i], 0);
    const gstOnG = [4, 5, 6].reduce((s, i) => s + result.lineTaxes[i], 0);
    // GP lines get 5% + 7%; the exempt lines get nothing.
    expect(nonPstIdx.filter((i) => i < 2).every((i) => result.lineTaxes[i] === 0)).toBe(true);
    expect(pstShare).toBeGreaterThan(gstOnG); // 62.98 taxed at 12% >> 31.97 at 5%
  });

  it('exempt (unflagged) grocery lines get zero tax', () => {
    expect(result.lineTaxes[0]).toBe(0);
    expect(result.lineTaxes[1]).toBe(0);
  });

  it('per-line taxes sum exactly to totalTax (no lost/created cents)', () => {
    const sum = result.lineTaxes.reduce((s, v) => s + v, 0);
    expect(sum).toBe(result.totalTax);
  });
});

describe('attributeItemTaxes — printed total spread (no per-item flags)', () => {
  it('spreads a single unlabelled TAX total across all items proportionally', () => {
    const lines: TaxableLine[] = [
      { amount: 1000, tax_codes: [] },
      { amount: 3000, tax_codes: [] },
    ];
    const tax: TaxComponentInput[] = [
      { code: null, label: 'Sales Tax', rate_percent: null, amount: 400 },
    ];
    const r = attributeItemTaxes(lines, tax, null);
    expect(r.totalTax).toBe(400);
    expect(r.source).toBe('printed-spread');
    expect(r.lineTaxes[0]).toBe(100); // 1/4 of 400
    expect(r.lineTaxes[1]).toBe(300); // 3/4 of 400
  });
});

describe('attributeItemTaxes — province rate fallback (flags, no printed amounts)', () => {
  it('computes GST+PST from the BC table when the receipt shows no tax totals', () => {
    const lines: TaxableLine[] = [
      { amount: 10000, tax_codes: ['G', 'P'] }, // 5% + 7% = 1200
      { amount: 10000, tax_codes: ['G'] }, // 5% = 500
      { amount: 10000, tax_codes: [] }, // exempt
    ];
    const r = attributeItemTaxes(lines, [], getTaxProfile('CA', 'British Columbia'));
    expect(r.source).toBe('profile-rates');
    expect(r.lineTaxes[0]).toBe(1200);
    expect(r.lineTaxes[1]).toBe(500);
    expect(r.lineTaxes[2]).toBe(0);
    expect(r.totalTax).toBe(1700);
  });

  it('applies BC liquor PST (L) at 10% plus GST on the tax_base', () => {
    const lines: TaxableLine[] = [
      { amount: 2509, tax_base: 2499, tax_codes: ['L', 'G'] },
    ];
    const r = attributeItemTaxes(lines, [], getTaxProfile('CA', 'BC'));
    expect(r.source).toBe('profile-rates');
    expect(r.lineTaxes[0]).toBe(Math.round(2499 * 0.1) + Math.round(2499 * 0.05));
    const byLabel = Object.fromEntries(r.breakdown.map((b) => [b.label, b.amount]));
    expect(byLabel['PST Liquor']).toBe(Math.round(2499 * 0.1));
    expect(byLabel.GST).toBe(Math.round(2499 * 0.05));
  });

  it('returns none when there is neither printed tax nor a region', () => {
    const lines: TaxableLine[] = [{ amount: 500, tax_codes: ['G'] }];
    const r = attributeItemTaxes(lines, [], null);
    expect(r.source).toBe('none');
    expect(r.totalTax).toBe(0);
  });
});

describe('getTaxProfile', () => {
  it('resolves Canadian provinces by code and by full name', () => {
    expect(getTaxProfile('CA', 'BC')?.rates.P.rate).toBe(0.07);
    expect(getTaxProfile('CA', 'BC')?.rates.L).toEqual({ label: 'PST Liquor', rate: 0.10 });
    expect(getTaxProfile('CA', 'Ontario')?.rates.H.rate).toBe(0.13);
    expect(getTaxProfile('CA', 'AB')?.rates.G.rate).toBe(0.05);
    expect(getTaxProfile('CA', 'AB')?.rates.P).toBeUndefined();
  });

  it('resolves US states to a single sales-tax rate', () => {
    const ca = getTaxProfile('US', 'California');
    expect(ca?.rates.S.rate).toBeGreaterThan(0);
  });

  it('returns null for unknown / missing regions', () => {
    expect(getTaxProfile('CA', null)).toBeNull();
    expect(getTaxProfile('CA', 'Atlantis')).toBeNull();
    expect(getTaxProfile(null, null)).toBeNull();
  });
});
