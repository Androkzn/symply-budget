import {
  attributeItemTaxes,
  getTaxProfile,
  type TaxComponentInput,
  type TaxableLine,
} from '../taxAttribution';

/**
 * Tax attribution decides what a stored expense actually costs, so the property
 * that matters most is not any single line's share but that the shares sum to
 * the printed tax EXACTLY — a receipt whose items don't reconcile to the total
 * charged is worse than no receipt at all.
 */

const line = (amount: number, tax_codes: string[] = [], tax_base?: number): TaxableLine =>
  tax_base == null ? { amount, tax_codes } : { amount, tax_codes, tax_base };

const comp = (over: Partial<TaxComponentInput> = {}): TaxComponentInput => ({
  code: null,
  label: 'Tax',
  rate_percent: null,
  amount: 0,
  ...over,
});

describe('attributeItemTaxes — printed amounts with per-item flags', () => {
  it('gives each printed component only to the lines carrying its flag', () => {
    const lines = [line(1000, ['G']), line(2000, ['G', 'P']), line(500, [])];
    const result = attributeItemTaxes(
      lines,
      [comp({ code: 'G', label: 'GST', amount: 150 }), comp({ code: 'P', label: 'PST', amount: 140 })],
      null,
    );

    expect(result.source).toBe('printed-coded');
    // The exempt line carries no tax at all.
    expect(result.lineTaxes[2]).toBe(0);
    // PST only lands on the single P-flagged line.
    expect(result.lineTaxes[1]).toBeGreaterThan(result.lineTaxes[0]);
    expect(result.totalTax).toBe(290);
  });

  it('sums to the printed total exactly, to the cent', () => {
    // 3 lines and 100 cents of tax cannot divide evenly — the largest-remainder
    // split must still reconcile.
    const lines = [line(333, ['G']), line(333, ['G']), line(334, ['G'])];
    const result = attributeItemTaxes(lines, [comp({ code: 'G', label: 'GST', amount: 100 })], null);

    expect(result.lineTaxes.reduce((s, v) => s + v, 0)).toBe(100);
    expect(result.totalTax).toBe(100);
  });

  it('matches flags case-insensitively and ignores surrounding space', () => {
    const lines = [line(1000, [' g '])];
    const result = attributeItemTaxes(lines, [comp({ code: 'G', label: 'GST', amount: 50 })], null);
    expect(result.lineTaxes[0]).toBe(50);
    expect(result.source).toBe('printed-coded');
  });

  it('weights by tax_base when present, so a deposit is excluded', () => {
    // Both lines cost 1000, but the first includes a 500 refundable deposit
    // that must not attract tax — it should therefore receive less.
    const lines = [line(1000, ['G'], 500), line(1000, ['G'])];
    const result = attributeItemTaxes(lines, [comp({ code: 'G', label: 'GST', amount: 150 })], null);
    expect(result.lineTaxes[0]).toBeLessThan(result.lineTaxes[1]);
    expect(result.lineTaxes[0] + result.lineTaxes[1]).toBe(150);
  });

  it('spreads a coded tax across every line when no item carries that flag', () => {
    // Totals still have to reconcile even when the flags are unreadable.
    const lines = [line(1000, ['X']), line(1000, ['X'])];
    const result = attributeItemTaxes(lines, [comp({ code: 'G', label: 'GST', amount: 100 })], null);
    expect(result.totalTax).toBe(100);
    expect(result.lineTaxes).toEqual([50, 50]);
  });

  it('groups the breakdown by label, largest first', () => {
    const lines = [line(1000, ['G', 'P'])];
    const result = attributeItemTaxes(
      lines,
      [comp({ code: 'G', label: 'GST', amount: 50 }), comp({ code: 'P', label: 'PST', amount: 70 })],
      null,
    );
    expect(result.breakdown).toEqual([
      { label: 'PST', amount: 70 },
      { label: 'GST', amount: 50 },
    ]);
  });
});

describe('attributeItemTaxes — printed total with no flags', () => {
  it('spreads an unlabelled total across all lines proportional to price', () => {
    const lines = [line(1000), line(3000)];
    const result = attributeItemTaxes(lines, [comp({ label: 'Tax', amount: 200 })], null);

    expect(result.source).toBe('printed-spread');
    expect(result.lineTaxes).toEqual([50, 150]);
    expect(result.totalTax).toBe(200);
  });

  it('splits evenly when there is no price signal to weight by', () => {
    const lines = [line(0), line(0), line(0)];
    const result = attributeItemTaxes(lines, [comp({ label: 'Tax', amount: 10 })], null);
    // Remainder goes to the earliest lines.
    expect(result.lineTaxes).toEqual([4, 3, 3]);
    expect(result.totalTax).toBe(10);
  });
});

describe('attributeItemTaxes — falling back to the region rate table', () => {
  const bc = getTaxProfile('CA', 'BC');

  it('computes tax from the profile when flags exist but no amount is printed', () => {
    const result = attributeItemTaxes([line(1000, ['G'])], [], bc);
    expect(result.source).toBe('profile-rates');
    expect(result.lineTaxes[0]).toBe(50); // 5% GST
  });

  it('adds every flag a line carries', () => {
    const result = attributeItemTaxes([line(1000, ['G', 'P'])], [], bc);
    expect(result.lineTaxes[0]).toBe(120); // 5% GST + 7% PST
    expect(result.breakdown.map((b) => b.label).sort()).toEqual(['GST', 'PST']);
  });

  it('leaves unflagged lines untaxed', () => {
    const result = attributeItemTaxes([line(1000, [])], [], bc);
    expect(result.source).toBe('none');
    expect(result.totalTax).toBe(0);
  });

  it('prefers a printed amount over the profile rate', () => {
    // Printed 999 must win over the 5% the table would compute.
    const result = attributeItemTaxes([line(1000, ['G'])], [comp({ code: 'G', label: 'GST', amount: 999 })], bc);
    expect(result.totalTax).toBe(999);
  });
});

describe('attributeItemTaxes — nothing to go on', () => {
  it('returns zeroes rather than guessing', () => {
    const result = attributeItemTaxes([line(1000), line(2000)], [], null);
    expect(result).toEqual({ lineTaxes: [0, 0], totalTax: 0, breakdown: [], source: 'none' });
  });

  it('handles an empty receipt', () => {
    const result = attributeItemTaxes([], [comp({ label: 'Tax', amount: 100 })], null);
    expect(result.lineTaxes).toEqual([]);
    expect(result.totalTax).toBe(0);
  });

  it('ignores tax lines with neither an amount nor a rate', () => {
    const result = attributeItemTaxes([line(1000, ['G'])], [comp({ code: 'G', label: 'GST', amount: 0 })], null);
    expect(result.source).toBe('none');
  });
});

describe('getTaxProfile', () => {
  it('resolves a Canadian province by code', () => {
    expect(getTaxProfile('CA', 'BC')?.rates.P.rate).toBe(0.07);
    expect(getTaxProfile('CA', 'AB')?.rates.G.rate).toBe(0.05);
  });

  it('resolves an HST province to a single combined rate', () => {
    expect(getTaxProfile('CA', 'NB')?.rates.H.rate).toBe(0.15);
  });

  it('maps common US flag letters onto one combined sales tax', () => {
    const wa = getTaxProfile('US', 'WA');
    expect(wa).not.toBeNull();
    // US receipts print one tax under varying letters — all must resolve alike.
    expect(wa?.rates.S.rate).toBe(wa?.rates.T.rate);
  });

  it('returns null for an unknown or missing region', () => {
    expect(getTaxProfile('CA', null)).toBeNull();
    expect(getTaxProfile('CA', 'ZZ')).toBeNull();
  });
});
