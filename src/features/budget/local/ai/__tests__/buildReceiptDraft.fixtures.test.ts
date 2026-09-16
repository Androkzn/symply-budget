import { buildReceiptDraftFromRaw } from '../buildReceiptDraft';

const CATEGORIES = [
  { id: 'cat-groc', name: 'Groceries' },
  { id: 'cat-dairy', name: 'Dairy' },
  { id: 'cat-produce', name: 'Produce' },
  { id: 'cat-alcohol', name: 'Alcohol' },
];

describe('buildReceiptDraftFromRaw — Superstore / Costco / BCL fixtures', () => {
  it('Superstore: store, milk fees attached, Title Case chips, all No tax, no fee rows', () => {
    const draft = buildReceiptDraftFromRaw(
      {
        vendor: 'Real Canadian Superstore',
        purchase_date: '2024-07-26',
        receipt_country: 'CA',
        receipt_region: 'BC',
        tax_summary: [],
        items: [
          {
            raw_name: 'PRT SKM MILK 1%',
            raw_code: null,
            name: '1% Milk',
            name_suggestions: ['1% Milk', 'Skim Milk', 'Prt Skm Milk 1%'],
            amount: 573,
            saved_amount: 0,
            tax_codes: [],
            category: 'Dairy',
            category_suggestions: ['Groceries', 'Dairy'],
            fees: [],
          },
          {
            raw_name: 'RECYCLING FEE',
            raw_code: null,
            name: 'Recycling Fee',
            name_suggestions: ['Recycling Fee'],
            amount: 7,
            saved_amount: 0,
            tax_codes: [],
            category: null,
            category_suggestions: [],
            fees: [],
          },
          {
            raw_name: 'DEPOSIT 1',
            raw_code: null,
            name: 'Deposit',
            name_suggestions: ['Deposit'],
            amount: 10,
            saved_amount: 0,
            tax_codes: [],
            category: null,
            category_suggestions: [],
            fees: [],
          },
          {
            raw_name: 'LBRT GRK PNAPLE',
            raw_code: null,
            name: 'Greek Yogurt',
            name_suggestions: ['Greek Yogurt', 'Pineapple Yogurt', 'Lbrt Grk Pnaple'],
            amount: 1394,
            saved_amount: 279,
            tax_codes: [],
            category: 'Dairy',
            category_suggestions: ['Groceries'],
            fees: [],
          },
        ],
      },
      CATEGORIES,
    );

    expect(draft.vendor).toBe('Real Canadian Superstore');
    expect(draft.items.some((i) => /recycling|deposit 1/i.test(i.name))).toBe(false);
    const milk = draft.items.find((i) => /milk/i.test(i.name));
    expect(milk?.fees?.map((f) => f.kind)).toEqual(['environmental', 'deposit']);
    expect(milk?.deposit_amount).toBe(10);
    expect(milk?.tax_amount).toBe(0);
    expect(milk?.name_suggestions).toEqual(
      expect.arrayContaining(['Prt Skm Milk 1%']),
    );
    expect(draft.items.every((i) => (i.tax_amount ?? 0) === 0)).toBe(true);
    expect(draft.tax_source).toBe('none');
  });

  it('Costco: Kumatos stay Kumato, TPD on brie, only Roti gets tax, milk fees attach', () => {
    const draft = buildReceiptDraftFromRaw(
      {
        vendor: 'Costco Wholesale',
        purchase_date: '2026-07-01',
        receipt_country: 'CA',
        receipt_region: 'BC',
        tax_summary: [{ code: 'G', label: 'TAX', rate_percent: null, amount: 40 }],
        items: [
          {
            raw_name: 'KS DC BRIE',
            raw_code: '610845',
            name: 'Brie',
            name_suggestions: ['Brie', 'Kirkland Brie', 'Ks Dc Brie'],
            amount: 1099,
            saved_amount: 0,
            tax_codes: [],
            category: 'Groceries',
            category_suggestions: ['Dairy'],
            fees: [],
          },
          {
            raw_name: 'TPD/610845',
            raw_code: '610845',
            name: 'Tpd',
            name_suggestions: ['Tpd'],
            amount: 350,
            saved_amount: 350,
            tax_codes: [],
            category: null,
            category_suggestions: [],
            fees: [],
          },
          {
            raw_name: '1% MILK',
            raw_code: '1281',
            name: '1% Milk',
            name_suggestions: ['1% Milk', 'Milk'],
            amount: 573,
            saved_amount: 0,
            tax_codes: [],
            category: 'Dairy',
            category_suggestions: ['Groceries'],
            fees: [
              { kind: 'environmental', label: 'Enviro fee', amount: 7 },
              { kind: 'deposit', label: 'Deposit', amount: 10 },
            ],
          },
          {
            raw_name: 'KUMATO',
            raw_code: '43483',
            name: 'Kumato',
            name_suggestions: ['Kumato', 'Kumato Tomato', 'Tomatoes'],
            amount: 699,
            saved_amount: 0,
            tax_codes: [],
            category: 'Produce',
            category_suggestions: ['Groceries'],
            fees: [],
          },
          {
            raw_name: 'KUMATO',
            raw_code: '43483',
            name: 'Kumato',
            name_suggestions: ['Kumato'],
            amount: 699,
            saved_amount: 0,
            tax_codes: [],
            category: 'Produce',
            category_suggestions: [],
            fees: [],
          },
          {
            raw_name: 'KUMATO',
            raw_code: '43483',
            name: 'Kumato',
            name_suggestions: ['Kumato'],
            amount: 699,
            saved_amount: 0,
            tax_codes: [],
            category: 'Produce',
            category_suggestions: [],
            fees: [],
          },
          {
            raw_name: 'ROTI CHICKEN',
            raw_code: '347937',
            name: 'Roti Chicken',
            name_suggestions: ['Roti Chicken', 'Chicken Roti', 'Prepared Food'],
            amount: 799,
            saved_amount: 0,
            tax_codes: ['G'],
            category: 'Groceries',
            category_suggestions: [],
            fees: [],
          },
        ],
      },
      CATEGORIES,
    );

    expect(draft.vendor).toBe('Costco Wholesale');
    const kumatos = draft.items.filter((i) => /kumato/i.test(i.name));
    expect(kumatos).toHaveLength(1);
    expect(kumatos[0].name).toBe('Kumato');
    expect(kumatos[0].amount).toBe(2097);
    expect(kumatos[0].name_suggestions).toEqual(expect.arrayContaining(['Kumato']));

    const brie = draft.items.find((i) => i.raw_code === '610845');
    expect(brie?.saved_amount).toBe(350);
    expect(draft.items.some((i) => /tpd/i.test(i.name))).toBe(false);

    const roti = draft.items.find((i) => /roti/i.test(i.name));
    expect(roti?.tax_amount).toBe(40);
    expect(roti?.amount).toBe(839);
    expect(draft.items.filter((i) => (i.tax_amount ?? 0) > 0)).toHaveLength(1);

    const milk = draft.items.find((i) => /milk/i.test(i.name));
    expect(milk?.fees?.map((f) => f.kind)).toEqual(['environmental', 'deposit']);
    expect(milk?.deposit_amount).toBe(10);
  });

  it('BCL: Canadian Club stays Canadian Club, deposit attached, PST 10% + GST 5%', () => {
    const draft = buildReceiptDraftFromRaw(
      {
        vendor: 'BC Liquor Store',
        purchase_date: '2026-07-13',
        receipt_country: 'CA',
        receipt_region: 'BC',
        tax_summary: [
          { code: 'L', label: 'PST Liquor', rate_percent: 10, amount: 240 },
          { code: 'G', label: 'GST', rate_percent: 5, amount: 120 },
        ],
        items: [
          {
            raw_name: 'CANADIAN CLUB - PREMIUM 1X750ml',
            raw_code: '42',
            name: 'Canadian Club',
            name_suggestions: [
              'Canadian Club',
              'Canadian Club Premium',
              'Whisky',
              'Canadian Club - Premium 1x750ml',
            ],
            amount: 2399,
            saved_amount: 0,
            tax_codes: ['L', 'G'],
            category: 'Alcohol',
            category_suggestions: ['Groceries'],
            fees: [{ kind: 'deposit', label: 'Container deposit', amount: 10 }],
          },
          {
            raw_name: 'Container Deposit',
            raw_code: null,
            name: 'Container Deposit',
            name_suggestions: ['Container Deposit'],
            amount: 10,
            saved_amount: 0,
            tax_codes: [],
            category: null,
            category_suggestions: [],
            fees: [],
          },
        ],
      },
      CATEGORIES,
    );

    expect(draft.vendor).toBe('BC Liquor Store');
    expect(draft.items).toHaveLength(1);
    const club = draft.items[0];
    expect(club.name).toBe('Canadian Club');
    expect(club.name).not.toMatch(/^alcohol$/i);
    expect(club.deposit_amount).toBe(10);
    expect(club.fees?.map((f) => f.kind)).toEqual(['deposit']);
    expect(club.tax_amount).toBe(360);
    expect(club.amount).toBe(2399 + 10 + 360);
    expect(club.name_suggestions).toEqual(
      expect.arrayContaining(['Canadian Club - Premium 1x750ml']),
    );
    expect(draft.tax_breakdown?.map((l) => l.label)).toEqual(
      expect.arrayContaining(['PST Liquor', 'GST']),
    );
  });
});
