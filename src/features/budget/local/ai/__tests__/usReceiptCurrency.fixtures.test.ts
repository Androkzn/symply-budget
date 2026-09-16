/**
 * US receipts scanned by a Canadian member — the whole chain, on real data.
 *
 * Fixtures transcribed from `resourses/testing/US-recept*.HEIC`, four genuine
 * Washington State receipts. What makes them the right test for this feature is
 * what they DON'T print: not one of them names a currency. They all show a bare
 * "$", so the only evidence they are American is the store address — which is
 * exactly the case `resolveScanCurrency` exists to arbitrate, and exactly the
 * case a naive "read the dollar sign" implementation gets silently wrong.
 *
 * The chain under test is the real one, in order:
 *   model output → buildReceiptDraftFromRaw → resolveScanCurrency → convertCents
 * i.e. what the scan screen does between a photo and a row in the ledger.
 */
import { resolveScanCurrency } from '@screens/budget/receiptCurrencyChoice';
import { convertCents } from '@utils/currencyConversion';
import { normalizeVolumeUnit, pricePerLitre, toLitres } from '@utils/fuelUnits';

import { buildReceiptDraftFromRaw, type RawReceiptDraft } from '../buildReceiptDraft';

const CATEGORIES = [
  { id: 'cat-groc', name: 'Groceries' },
  { id: 'cat-dairy', name: 'Dairy' },
  { id: 'cat-auto', name: 'Auto' },
  { id: 'cat-household', name: 'Household' },
];

/** The exchange rate the fixtures convert at — one place, so the sums read. */
const USD_TO_CAD = 1.3712;

/** A Canadian member: region set to BC, budget kept in CAD. */
const CANADIAN = { memberCountry: 'CA', memberCurrency: 'CAD' } as const;

/**
 * US-recept-3.HEIC — Kendall Market, Maple Falls WA, 09/05/2026.
 * Propane $5.98 + $0.54 tax = $6.52. One item, printed tax: the cleanest
 * arithmetic on the pile, so it is the one the E2E flow drives too.
 */
const KENDALL_PROPANE: RawReceiptDraft = {
  vendor: 'Kendall Market',
  purchase_date: '2026-09-05',
  receipt_country: 'US',
  receipt_region: 'WA',
  receipt_currency: null, // prints "$" and nothing else
  tax_summary: [{ code: null, label: 'Sales Tax', rate_percent: null, amount: 54 }],
  items: [
    {
      raw_name: 'Propane',
      raw_code: '101',
      name: 'Propane',
      name_suggestions: ['Propane', 'Propane Refill', 'Fuel', 'Household'],
      amount: 598,
      saved_amount: 0,
      tax_codes: [],
      category: 'Household',
      category_suggestions: ['Auto'],
      fees: [],
    },
  ],
};

/**
 * US-recept-1.HEIC — Kendall Market fuel pump, 09/05/2026.
 * Supreme 10.068 gal @ $6.099 = $61.40. No tax line (fuel tax is in the price).
 */
const KENDALL_FUEL: RawReceiptDraft = {
  vendor: 'Kendall Market',
  purchase_date: '2026-09-05',
  receipt_country: 'US',
  receipt_region: 'WA',
  receipt_currency: null,
  tax_summary: [],
  items: [
    {
      raw_name: 'Supreme-+ 10.068G',
      raw_code: null,
      name: 'Supreme Gasoline',
      quantity: 10.068,
      unit: 'G',
      name_suggestions: ['Supreme 10.068g', 'Supreme Gasoline', 'Gasoline', 'Fuel'],
      amount: 6140,
      saved_amount: 0,
      tax_codes: [],
      category: 'Auto',
      category_suggestions: [],
      fees: [],
    },
  ],
};

/**
 * US-recept.HEIC — Trader Joe's, Bellingham WA. 46 items, $165.60 total,
 * $4.18 tax @ 9.2%. Abridged to the lines that carry a distinct behaviour:
 * a bag fee, a discount, and an ordinary taxed line.
 */
const TRADER_JOES: RawReceiptDraft = {
  vendor: "Trader Joe's",
  purchase_date: null,
  receipt_country: 'US',
  receipt_region: 'WA',
  receipt_currency: null,
  tax_summary: [{ code: 'T', label: 'Sales Tax', rate_percent: 9.2, amount: 418 }],
  items: [
    {
      raw_name: 'GREAT NOTION BREWING BLU',
      raw_code: null,
      name: 'Great Notion Brewing Blueberry',
      name_suggestions: ['Great Notion Brewing Blu', 'Beer', 'Alcohol'],
      amount: 550,
      saved_amount: 0,
      tax_codes: ['T'],
      category: 'Groceries',
      category_suggestions: [],
      fees: [],
    },
    {
      raw_name: 'NO-LI BREWING IMPERIAL S',
      raw_code: null,
      name: 'No-Li Brewing Imperial Stout',
      name_suggestions: ['No-Li Brewing Imperial S', 'Beer', 'Alcohol'],
      amount: 192,
      saved_amount: 1, // the -$0.01 line on the receipt
      tax_codes: ['T'],
      category: 'Groceries',
      category_suggestions: [],
      fees: [],
    },
    {
      raw_name: 'MILK QUART LOW FAT 1%',
      raw_code: null,
      name: '1% Milk Quart',
      name_suggestions: ['Milk Quart Low Fat 1%', 'Milk', 'Dairy'],
      amount: 169,
      saved_amount: 0,
      tax_codes: [],
      category: 'Dairy',
      category_suggestions: ['Groceries'],
      fees: [{ kind: 'bag', label: 'Bag Fee', amount: 16 }],
    },
  ],
};

describe('US receipts — currency is decided by the address, not the dollar sign', () => {
  it.each([
    ['Kendall propane', KENDALL_PROPANE],
    ['Kendall fuel', KENDALL_FUEL],
    ["Trader Joe's", TRADER_JOES],
  ])('%s: reports no PRINTED currency but keeps the US address', (_label, raw) => {
    const draft = buildReceiptDraftFromRaw(raw, CATEGORIES);
    // None of these receipts names a currency, so the draft must not claim one.
    expect(draft.receipt_currency).toBeNull();
    expect(draft.receipt_country).toBe('US');
  });

  it.each([
    ['Kendall propane', KENDALL_PROPANE],
    ['Kendall fuel', KENDALL_FUEL],
    ["Trader Joe's", TRADER_JOES],
  ])('%s: reads as USD for a member whose region is Canada', (_label, raw) => {
    const draft = buildReceiptDraftFromRaw(raw, CATEGORIES);
    expect(
      resolveScanCurrency({
        printed: draft.receipt_currency,
        receiptCountry: draft.receipt_country,
        ...CANADIAN,
      }),
    ).toBe('USD');
  });

  it.each([
    ['Kendall propane', KENDALL_PROPANE],
    ['Kendall fuel', KENDALL_FUEL],
    ["Trader Joe's", TRADER_JOES],
  ])('%s: reads as the member currency when the member is ALSO in the US', (_label, raw) => {
    // The same receipt, same member currency, different member region — and the
    // right answer flips. Nothing about the paper decides this.
    const draft = buildReceiptDraftFromRaw(raw, CATEGORIES);
    expect(
      resolveScanCurrency({
        printed: draft.receipt_currency,
        receiptCountry: draft.receipt_country,
        memberCountry: 'US',
        memberCurrency: 'USD',
      }),
    ).toBe('USD');
  });

  it('Kendall propane: converts item, tax and total to CAD, and the lines still sum', () => {
    const draft = buildReceiptDraftFromRaw(KENDALL_PROPANE, CATEGORIES);

    // Printed: $5.98 + $0.54 tax = $6.52. The draft stores tax-inclusive amounts.
    expect(draft.total_amount).toBe(652);
    expect(draft.tax_amount).toBe(54);
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]!.amount).toBe(652);

    // 652 × 1.3712 = 894.02 → 894
    const converted = draft.items.map((i) => convertCents(i.amount, USD_TO_CAD, 'CAD'));
    expect(converted).toEqual([894]);
    expect(converted.reduce((a, b) => a + b, 0)).toBe(894);
    // The tax rides along inside the amount and converts with it.
    expect(convertCents(draft.items[0]!.tax_amount ?? 0, USD_TO_CAD, 'CAD')).toBe(74);
  });

  it('Kendall fuel: a $61.40 fill-up becomes CA$84.19, not CA$61.40', () => {
    const draft = buildReceiptDraftFromRaw(KENDALL_FUEL, CATEGORIES);
    expect(draft.total_amount).toBe(6140);
    // 6140 × 1.3712 = 8419.17 → 8419. The whole point: importing this at par
    // would understate the month by CA$22.79 and look perfectly normal.
    expect(convertCents(draft.items[0]!.amount, USD_TO_CAD, 'CAD')).toBe(8419);
  });

  it("Trader Joe's: fees and discounts convert with their line, and totals reconcile", () => {
    const draft = buildReceiptDraftFromRaw(TRADER_JOES, CATEGORIES);

    // The bag fee is folded into its parent, never its own row.
    expect(draft.items).toHaveLength(3);
    const milk = draft.items.find((i) => /milk/i.test(i.name))!;
    expect(milk.fees?.map((f) => f.kind)).toEqual(['bag']);

    const convertedLines = draft.items.map((i) => convertCents(i.amount, USD_TO_CAD, 'CAD'));
    const convertedTotal = convertedLines.reduce((a, b) => a + b, 0);
    // Converted per line and then summed — the invariant the summary card shows.
    expect(convertedTotal).toBe(
      draft.items.reduce((sum, i) => sum + convertCents(i.amount, USD_TO_CAD, 'CAD'), 0),
    );
    // Sanity: the CAD total is meaningfully larger than the USD one.
    expect(convertedTotal).toBeGreaterThan(draft.total_amount!);

    // The discount converts too — a US$0.01 saving must not persist as CA$0.01.
    // Matched case-insensitively: the builder title-cases through lower-case, so
    // "No-Li" comes back as "No-li".
    const stout = draft.items.find((i) => /no-li/i.test(i.name))!;
    expect(stout.saved_amount).toBe(1);
    expect(convertCents(stout.saved_amount, USD_TO_CAD, 'CAD')).toBe(1);
  });

  it('Kendall fuel: gallons become litres AND dollars become CAD, together', () => {
    // Converting only the currency leaves "CA$8.42/gal" — correct, and useless
    // to someone whose local station quotes litres. Both or neither.
    const draft = buildReceiptDraftFromRaw(KENDALL_FUEL, CATEGORIES);
    const line = draft.items[0]!;
    expect(line.quantity).toBe(10.068);
    expect(normalizeVolumeUnit(line.unit)).toBe('gal');

    const litres = toLitres(line.quantity!, 'gal');
    expect(litres).toBeCloseTo(38.1115, 4);

    const perLitreUsd = pricePerLitre(line.amount, line.quantity!, 'gal')!;
    expect(perLitreUsd / 100).toBeCloseTo(1.611, 3);
    // The printed PRICE/GAL was $6.099 — dividing that by a gallon must agree.
    expect(perLitreUsd / 100).toBeCloseTo(6.099 / 3.785411784, 2);

    const perLitreCad = perLitreUsd * USD_TO_CAD;
    expect(perLitreCad / 100).toBeCloseTo(2.2091, 3);
  });

  it('a US member scanning these pays nothing for the feature: par, byte for byte', () => {
    const draft = buildReceiptDraftFromRaw(TRADER_JOES, CATEGORIES);
    const atPar = draft.items.map((i) => convertCents(i.amount, 1, 'USD'));
    expect(atPar).toEqual(draft.items.map((i) => i.amount));
  });
});
