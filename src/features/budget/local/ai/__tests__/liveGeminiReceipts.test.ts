import { buildReceiptDraftFromRaw, type RawReceiptDraft } from '../buildReceiptDraft';

import live from './fixtures/live-gemini-receipts.json';


const CATEGORIES = [
  { id: 'cat-groc', name: 'Groceries' },
  { id: 'cat-dairy', name: 'Dairy' },
  { id: 'cat-produce', name: 'Produce' },
  { id: 'cat-alcohol', name: 'Alcohol' },
];

function asDraft(label: string): RawReceiptDraft {
  const row = live.find((r) => r.label === label);
  if (!row || !('items' in row)) throw new Error(`missing live fixture ${label}`);
  return {
    vendor: row.vendor,
    purchase_date: row.purchase_date,
    receipt_country: 'CA',
    receipt_region: 'BC',
    tax_summary: row.tax_summary,
    items: row.items,
  };
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

describe('live Gemini receipt analysis (actual API response)', () => {
  it('draft injects Title Case of raw_name into name chips for every item', () => {
    for (const label of ['superstore', 'costco', 'bcl']) {
      const draft = buildReceiptDraftFromRaw(asDraft(label), CATEGORIES);
      for (const item of draft.items) {
        const title = titleCase(item.raw_name ?? item.name);
        expect(item.name_suggestions?.map((s) => s.toLowerCase())).toContain(title.toLowerCase());
        expect(item.name_suggestions?.length).toBeGreaterThan(0);
        expect(item.name_suggestions?.length).toBeLessThanOrEqual(7);
      }
    }
  });

  it('Superstore: store, milk fees attached, all No tax, no fee rows', () => {
    const draft = buildReceiptDraftFromRaw(asDraft('superstore'), CATEGORIES);
    expect(draft.vendor).toBe('Real Canadian Superstore');
    expect(draft.items.length).toBeGreaterThanOrEqual(10);
    expect(draft.items.some((i) => /recycling|deposit 1/i.test(i.name))).toBe(false);
    const milk = draft.items.find((i) => /milk/i.test(i.name));
    expect(milk?.fees?.map((f) => f.kind)).toEqual(['environmental', 'deposit']);
    expect(milk?.deposit_amount).toBe(10);
    expect(milk?.name_suggestions).toEqual(expect.arrayContaining(['Prt Skm Milk 1%']));
    expect(draft.items.every((i) => (i.tax_amount ?? 0) === 0)).toBe(true);
  });

  it('Costco: Kumato stays Kumato, milk fees attach, only Roti is taxed', () => {
    const draft = buildReceiptDraftFromRaw(asDraft('costco'), CATEGORIES);
    expect(draft.vendor).toBe('Costco Wholesale');
    const kumatos = draft.items.filter((i) => /kumato/i.test(i.name));
    expect(kumatos).toHaveLength(1);
    expect(kumatos[0].name).toMatch(/kumato/i);
    expect(kumatos[0].name).not.toMatch(/^tomatoes$/i);
    expect(kumatos[0].amount).toBe(2097);
    expect(draft.items.some((i) => /tpd/i.test(i.name))).toBe(false);

    const roti = draft.items.find((i) => /roti/i.test(i.name));
    expect(roti?.tax_amount).toBe(40);
    expect(draft.items.filter((i) => (i.tax_amount ?? 0) > 0)).toHaveLength(1);

    const milk = draft.items.find((i) => /1% milk/i.test(i.name));
    expect(milk?.fees?.map((f) => f.kind)).toEqual(['environmental', 'deposit']);
    expect(milk?.deposit_amount).toBe(10);
  });

  it('BCL: Canadian Club stays Canadian Club, deposit attached, PST + GST', () => {
    const draft = buildReceiptDraftFromRaw(asDraft('bcl'), CATEGORIES);
    expect(draft.vendor).toBe('BC Liquor Store');
    expect(draft.items).toHaveLength(1);
    const club = draft.items[0];
    expect(club.name).toMatch(/canadian club/i);
    expect(club.name).not.toMatch(/^alcohol$/i);
    expect(club.deposit_amount).toBe(10);
    expect(club.fees?.map((f) => f.kind)).toEqual(['deposit']);
    expect(club.tax_amount).toBe(360);
    expect(club.amount).toBe(2409 + 360);
    expect(club.name_suggestions).toEqual(
      expect.arrayContaining(['Canadian Club - Premium 1x750ml']),
    );
  });
});
