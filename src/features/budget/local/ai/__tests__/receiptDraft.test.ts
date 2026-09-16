import { buildReceiptDraftFromParsed, buildReceiptDraftFromRaw } from '../buildReceiptDraft';
import { parseReceiptText } from '../parseReceiptText';

describe('parseReceiptText', () => {
  it('extracts vendor, date, and priced lines from pasted receipt text', () => {
    const parsed = parseReceiptText(`
Real Canadian Superstore
2026-08-09
MILK 2%              4.49
BANANAS              2.99
SUBTOTAL             7.48
TOTAL                7.48
`);
    expect(parsed.vendor).toBe('Real Canadian Superstore');
    expect(parsed.purchaseDate).toBe('2026-08-09');
    expect(parsed.lines).toEqual([
      { name: 'MILK 2%', amountCents: 449, savedCents: 0 },
      { name: 'BANANAS', amountCents: 299, savedCents: 0 },
    ]);
  });
});

describe('buildReceiptDraftFromParsed', () => {
  it('builds a tax-inclusive draft with groceries category fallback', () => {
    const parsed = parseReceiptText('Store\nBread 3.50');
    const draft = buildReceiptDraftFromParsed(parsed, [
      { id: 'cat_groc', name: 'Groceries' },
    ]);
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({
      name: 'Bread',
      amount: 350,
      category_id: 'cat_groc',
    });
    expect(draft.total_amount).toBe(350);
  });
});

describe('receipt currency plumbing', () => {
  it('reports the currency the model named, normalized', () => {
    const draft = buildReceiptDraftFromRaw(
      { vendor: 'Target', purchase_date: null, items: [], receipt_currency: 'usd' },
      [],
    );
    expect(draft.receipt_currency).toBe('USD');
  });

  it('reports null when the model named none — the country is NOT a substitute', () => {
    // Whether a US receipt is "foreign" depends on where the member is, which
    // this module cannot see. Inferring here would take the decision away from
    // the screen, which can.
    const draft = buildReceiptDraftFromRaw(
      { vendor: 'Target', purchase_date: null, items: [], receipt_country: 'US' },
      [],
    );
    expect(draft.receipt_currency).toBeNull();
    expect(draft.receipt_country).toBe('US');
  });

  it('carries a currency the receipt TEXT spelled out', () => {
    const draft = buildReceiptDraftFromParsed(
      parseReceiptText('Corner Shop\nBread  3.20\nTOTAL 3.20 GBP'),
      [],
    );
    expect(draft.receipt_currency).toBe('GBP');
  });

  it('leaves a bare dollar sign undecided', () => {
    const draft = buildReceiptDraftFromParsed(
      parseReceiptText('Corner Shop\nBread  $3.20'),
      [],
    );
    expect(draft.receipt_currency).toBeNull();
  });
});
