/**
 * budgetTaxEntry — the sales-tax rows offered on a manually entered spending.
 *
 * The rows come from the SAME province/state tables receipt scanning falls back
 * to, so what the form charges and what a scan infers can never drift apart.
 * These tests pin the three things the form depends on: which rows a region
 * gets, what each row is worth in cents, and how a saved expense's single
 * combined tax total is split back into rows when it is reopened for editing.
 */
import {
  defaultTaxLines,
  formatTaxPercent,
  restoreTaxLines,
  taxLineCents,
  totalTaxCents,
  type TaxLineDraft,
} from '../budgetTaxEntry';

const line = (over: Partial<TaxLineDraft> = {}): TaxLineDraft => ({
  key: 'G',
  label: 'GST',
  mode: 'percent',
  percent: 5,
  amount: '',
  ...over,
});

describe('defaultTaxLines', () => {
  it('gives a PST province the two rows it charges, at its own rates', () => {
    expect(defaultTaxLines('CA', 'BC')).toEqual([
      { key: 'G', label: 'GST', mode: 'percent', percent: 5, amount: '' },
      { key: 'P', label: 'PST', mode: 'percent', percent: 7, amount: '' },
    ]);
  });

  it('skips BC liquor PST — a per-item rate, not one a whole purchase carries', () => {
    expect(defaultTaxLines('CA', 'BC').map((l) => l.label)).not.toContain('PST Liquor');
  });

  it('gives an HST province one combined row', () => {
    expect(defaultTaxLines('CA', 'ON')).toEqual([
      { key: 'H', label: 'HST', mode: 'percent', percent: 13, amount: '' },
    ]);
  });

  it('carries QST at its exact 9.975% with no float tail', () => {
    const qc = defaultTaxLines('CA', 'QC');
    expect(qc.map((l) => [l.label, l.percent])).toEqual([
      ['GST', 5],
      ['QST', 9.975],
    ]);
  });

  it('dedupes the US flag letters into a single sales-tax row', () => {
    expect(defaultTaxLines('US', 'CA')).toEqual([
      { key: 'S', label: 'Sales Tax', mode: 'percent', percent: 7.25, amount: '' },
    ]);
  });

  it('still offers Canada GST + PST when the province is unset, rates blank', () => {
    expect(defaultTaxLines('CA', null)).toEqual([
      { key: 'G', label: 'GST', mode: 'percent', percent: 5, amount: '' },
      { key: 'P', label: 'PST', mode: 'percent', percent: 0, amount: '' },
    ]);
  });

  it('falls back to one generic row when the region is unknown entirely', () => {
    expect(defaultTaxLines(null, null)).toEqual([
      { key: 'S', label: 'Sales tax', mode: 'percent', percent: 0, amount: '' },
    ]);
  });
});

describe('taxLineCents', () => {
  it('applies a rate to the pre-tax subtotal', () => {
    expect(taxLineCents(line({ percent: 7 }), 10_000)).toBe(700);
  });

  it('rounds a fractional rate to the cent', () => {
    // 9.975% of $100.00 = 997.5¢
    expect(taxLineCents(line({ percent: 9.975 }), 10_000)).toBe(998);
  });

  it('is zero while the amount or the rate is still blank', () => {
    expect(taxLineCents(line({ percent: 0 }), 10_000)).toBe(0);
    expect(taxLineCents(line({ percent: 7 }), 0)).toBe(0);
  });

  it('reads a typed amount instead of the rate in amount mode', () => {
    expect(taxLineCents(line({ mode: 'amount', amount: '5.25', percent: 7 }), 10_000)).toBe(525);
  });

  it('treats a blank or negative typed amount as no tax', () => {
    expect(taxLineCents(line({ mode: 'amount', amount: '' }), 10_000)).toBe(0);
    expect(taxLineCents(line({ mode: 'amount', amount: '-3' }), 10_000)).toBe(0);
  });
});

describe('totalTaxCents', () => {
  it('combines every row into the one figure stored on the expense', () => {
    const lines = [
      line({ key: 'G', percent: 5 }),
      line({ key: 'P', label: 'PST', mode: 'amount', amount: '3.50' }),
    ];
    expect(totalTaxCents(lines, 10_000)).toBe(500 + 350);
  });

  it('is zero with no rows', () => {
    expect(totalTaxCents([], 10_000)).toBe(0);
  });
});

describe('formatTaxPercent', () => {
  it('trims trailing zeros but keeps a real fraction', () => {
    expect(formatTaxPercent(5)).toBe('5%');
    expect(formatTaxPercent(7.25)).toBe('7.25%');
    expect(formatTaxPercent(9.975)).toBe('9.975%');
    expect(formatTaxPercent(0)).toBe('0%');
  });
});

describe('restoreTaxLines', () => {
  it('reopens a region-rate total as its own rows, split intact', () => {
    // $100.00 + BC's 5% + 7% = $12.00 of tax.
    expect(restoreTaxLines(1200, 10_000, 'CA', 'BC')).toEqual(defaultTaxLines('CA', 'BC'));
  });

  it('tolerates a cent of rounding per row before giving up on the split', () => {
    expect(restoreTaxLines(1201, 10_000, 'CA', 'BC')).toEqual(defaultTaxLines('CA', 'BC'));
  });

  it('comes back as a single amount row when the total is not the region rates', () => {
    // A scanned receipt's attributed share — inventing a split would change it.
    expect(restoreTaxLines(137, 10_000, 'CA', 'BC')).toEqual([
      { key: 'T', label: 'Sales tax', mode: 'amount', percent: 0, amount: '1.37' },
    ]);
  });

  it('falls back to the amount row when there is no subtotal to rate against', () => {
    expect(restoreTaxLines(500, 0, 'CA', 'BC')).toEqual([
      { key: 'T', label: 'Sales tax', mode: 'amount', percent: 0, amount: '5' },
    ]);
  });
});
