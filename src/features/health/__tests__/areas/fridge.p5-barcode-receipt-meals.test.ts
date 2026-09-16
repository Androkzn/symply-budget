/**
 * Symply Health — FRIDGE, parity phase **P5**: batch add, barcode lookup,
 * receipt reading and meal ideas.
 *
 * These four landed AFTER the fridge's original suites were written and arrived
 * with no tests at all. Everything here is the storage layer — the part that is
 * pure or mockable — and every assertion is against the SHIPPED module.
 *
 * What makes this surface worth pinning carefully rather than smoke-testing:
 *
 *  - **Nothing here may leak a raw error.** All three remote paths swallow the
 *    thrown error and answer with a member-facing sentence chosen by HTTP STATUS
 *    alone (`fridgeAiStatusFor`). A provider or axios string reaching the UI is
 *    the failure mode this whole shape exists to prevent.
 *  - **`not_configured` is the state the barcode surface ships in** — no
 *    FatSecret credential is set on any Health deploy — so "switched off" and
 *    "broken" must read differently, or every member concludes the app is broken.
 *  - **A batch is not one write.** `addFridgeItems` reports per-draft outcomes;
 *    "6 of 8 items added" is actionable, "something went wrong" is not.
 *  - **A receipt persists NOTHING.** It produces reviewable rows, pre-ticked
 *    only for food, and the non-food lines are SHOWN rather than dropped so a
 *    misclassification looks like a tick to change, not a missing item.
 */

import {
  healthFridgeApi,
  type HealthBarcodeLookup,
  type HealthExternalFood,
  type HealthFridgeItem,
  type HealthFridgeReceiptItem,
} from '@api/healthFridge';
import { storageHelpers } from '@services/storage';

import {
  addFridgeItems,
  barcodeDraft,
  BARCODE_COPY,
  DEFAULT_FRIDGE_CATEGORY,
  DEFAULT_FRIDGE_UNIT,
  DEFAULT_MEAL_GOAL,
  FRIDGE_AI_COPY,
  fridgeAiStatusFor,
  fromWireFridgeItem,
  isSendableBarcode,
  loadFridgeMealIdeas,
  lookupFridgeBarcode,
  parseFridgeNutrition,
  receiptRow,
  receiptRowToDraft,
  sanitizeBarcodeInput,
  scanFridgeReceipt,
  suggestedExpiryDate,
  type FridgeDraft,
} from '../../healthFridgeStorage';
import { __setHealthOfflineForTests, clearHealthCache } from '../../healthRepository';

jest.mock('@api/healthFridge');

const api = healthFridgeApi as unknown as jest.Mocked<typeof healthFridgeApi>;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';
const ISO = '2026-07-13T08:00:00.000Z';

/** An HTTP refusal carrying ONLY a status — never a message the UI could print. */
function httpError(status: number): Error & { response: { status: number } } {
  return Object.assign(new Error('Request failed with status code ' + status), {
    response: { status },
  });
}

function row(over: Partial<HealthFridgeItem> = {}): HealthFridgeItem {
  return {
    id: 'fr_1',
    user_id: 'user-1',
    name: 'Milk',
    quantity: 1,
    unit: 'L',
    category: 'Dairy',
    expiry_date: '2026-07-15',
    is_favorite: false,
    nutrition_json: null,
    source: 'manual',
    image_url: null,
    notes: null,
    created_at: ISO,
    updated_at: ISO,
    deleted_at: null,
    ...over,
  };
}

function draft(over: Partial<FridgeDraft> = {}): FridgeDraft {
  return {
    name: 'Milk',
    quantity: 1,
    unit: 'L',
    category: 'Dairy',
    expiryDate: '2026-07-15',
    notes: '',
    isFavorite: false,
    ...over,
  };
}

function externalFood(over: Partial<HealthExternalFood> = {}): HealthExternalFood {
  return {
    id: 'fs_1',
    provider: 'fatsecret',
    provider_food_id: '12345',
    name: 'Baked Beans',
    brand_name: 'Heinz',
    portion: 200,
    unit: 'g',
    serving_id: 's1',
    serving_description: 'half a tin',
    calories: 155,
    proteins: 9.4,
    carbohydrates: 26.1,
    fats: 0.4,
    base_calories_per_100: 77.5,
    base_proteins_per_100: 4.7,
    base_carbs_per_100: 13,
    base_fats_per_100: 0.2,
    servings: [],
    ...over,
  };
}

function lookup(over: Partial<HealthBarcodeLookup> = {}): HealthBarcodeLookup {
  return {
    barcode: '5000157024671',
    food: externalFood(),
    provider: { id: 'fatsecret', configured: true, status: 'ok' },
    ...over,
  };
}

function receiptItem(over: Partial<HealthFridgeReceiptItem> = {}): HealthFridgeReceiptItem {
  return {
    name: 'Tomatoes',
    category: 'Vegetables',
    suggested_expiry_days: 5,
    amount_cents: 249,
    looks_like_food: true,
    ...over,
  };
}

/** A stateful stand-in for the fridge Worker — every write re-reads the list. */
function fakeServer(initial: HealthFridgeItem[] = []): { rows: HealthFridgeItem[] } {
  const state = { rows: [...initial] };
  api.listFridge.mockImplementation(() => Promise.resolve({ items: [...state.rows] }));
  api.createFridgeItem.mockImplementation((payload) => {
    const created = row({
      id: `fr_${state.rows.length + 1}`,
      name: payload.name,
      quantity: payload.quantity ?? null,
      unit: payload.unit ?? null,
      category: payload.category ?? null,
      expiry_date: payload.expiry_date ?? null,
      notes: (payload.notes as string | null) ?? null,
      source: payload.source ?? 'manual',
      nutrition_json:
        payload.nutrition_json === undefined || payload.nutrition_json === null
          ? null
          : typeof payload.nutrition_json === 'string'
            ? payload.nutrition_json
            : JSON.stringify(payload.nutrition_json),
      created_at: new Date(Date.now() + state.rows.length).toISOString(),
    });
    state.rows = [created, ...state.rows];
    return Promise.resolve({ item: created });
  });
  return state;
}

beforeEach(async () => {
  await storageHelpers.clearAll();
  await clearHealthCache([]);
  __setHealthOfflineForTests(false);
  jest.resetAllMocks();
  fakeServer();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Batch add                                                           */
/* ------------------------------------------------------------------ */

describe('fridge P5 — adding several items at once', () => {
  it('HEALTH-FRIDGE-260: a batch posts SEQUENTIALLY and counts what landed', async () => {
    // Parallel POSTs would race the read-back `writeThrough` performs after each
    // write, and whichever finished last would decide what the cache holds.
    const server = fakeServer();

    const result = await addFridgeItems([
      draft({ name: 'Tomatoes' }),
      draft({ name: 'Onions' }),
      draft({ name: 'Garlic' }),
    ]);

    expect(api.createFridgeItem).toHaveBeenCalledTimes(3);
    expect(server.rows.map((r) => r.name)).toEqual(['Garlic', 'Onions', 'Tomatoes']);
    expect(result.status).toBe('saved');
    expect({ saved: result.saved, attempted: result.attempted }).toEqual({ saved: 3, attempted: 3 });
    expect(result.message).toBe('3 items added to your fridge.');
    expect(result.items).toHaveLength(3);
  });

  it('HEALTH-FRIDGE-261: one item is counted in the singular', async () => {
    const result = await addFridgeItems([draft({ name: 'Tomatoes' })]);
    expect(result.message).toBe('1 item added to your fridge.');
  });

  it('HEALTH-FRIDGE-262: an empty batch is a no-op that still returns the fridge', async () => {
    // The review screen can reach this by unticking every row before saving —
    // and a crash, or a "0 items added" banner over an unchanged fridge, would
    // both be worse than doing nothing quietly.
    fakeServer([row({ id: 'fr_1' })]);

    const result = await addFridgeItems([]);

    expect(api.createFridgeItem).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'saved', message: null, saved: 0, attempted: 0 });
    expect(result.items.map((i) => i.id)).toEqual(['fr_1']);
  });

  it('HEALTH-FRIDGE-263: a partial refusal says HOW MANY landed, and keeps them', async () => {
    // The honest outcome: the first rows really were saved. Reporting one
    // failure for the whole batch would make a member re-add items they already
    // have, and rolling the good ones back would throw away work.
    fakeServer();
    let call = 0;
    api.createFridgeItem.mockImplementation((payload) => {
      call += 1;
      if (call === 3) return Promise.reject(httpError(400));
      return Promise.resolve({ item: row({ id: `fr_${call}`, name: payload.name }) });
    });

    const result = await addFridgeItems([
      draft({ name: 'Tomatoes' }),
      draft({ name: 'Onions' }),
      draft({ name: 'Bag fee' }),
      draft({ name: 'Garlic' }),
    ]);

    expect(result.status).toBe('rejected');
    expect({ saved: result.saved, attempted: result.attempted }).toEqual({ saved: 3, attempted: 4 });
    expect(result.message).toBe(
      '3 of 4 items were added. The rest could not be saved — check their details and try again.'
    );
    // The sentence is ours, and carries nothing from the transport layer.
    expect(result.message).not.toMatch(/status code|Request failed|Error/);
  });

  it('HEALTH-FRIDGE-264: an offline batch keeps every row and says so once', async () => {
    // Not "3 items added" — nothing has reached the server. One honest sentence
    // beats three optimistic ones.
    __setHealthOfflineForTests(true);

    const result = await addFridgeItems([draft({ name: 'Tomatoes' }), draft({ name: 'Onions' })]);

    expect(result.status).toBe('offline');
    expect(result.message).toBe('Saved on this device — it will sync when you are back online.');
    expect(result.saved).toBe(0);
    expect(result.items.map((i) => i.name)).toEqual(['Onions', 'Tomatoes']);
  });
});

/* ------------------------------------------------------------------ */
/* Barcode                                                             */
/* ------------------------------------------------------------------ */

describe('fridge P5 — barcode lookup', () => {
  it('HEALTH-FRIDGE-265: only digits are kept, capped at a GTIN-14', () => {
    expect(sanitizeBarcodeInput('5000157024671')).toBe('5000157024671');
    expect(sanitizeBarcodeInput(' 5000-157 024671 ')).toBe('5000157024671');
    expect(sanitizeBarcodeInput('abc')).toBe('');
    expect(sanitizeBarcodeInput('1'.repeat(20))).toHaveLength(14);
    expect(sanitizeBarcodeInput(undefined as unknown as string)).toBe('');
  });

  it('HEALTH-FRIDGE-266: a code is sendable from 8 digits (EAN-8) to 14 (GTIN-14)', () => {
    // Below eight digits it is a half-typed code, and asking spends a provider
    // call to be told nothing.
    expect(isSendableBarcode('1234567')).toBe(false);
    expect(isSendableBarcode('12345678')).toBe(true);
    expect(isSendableBarcode('5000157024671')).toBe(true);
    expect(isSendableBarcode('1'.repeat(14))).toBe(true);
    // Longer input is TRUNCATED to 14 first, so it stays sendable rather than
    // being refused for a length the user cannot see.
    expect(isSendableBarcode('1'.repeat(15))).toBe(true);
    expect(isSendableBarcode('')).toBe(false);
  });

  it('HEALTH-FRIDGE-267: a half-typed code never reaches the provider', async () => {
    const result = await lookupFridgeBarcode('123');

    expect(api.lookupBarcode).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'invalid',
      draft: null,
      barcode: '123',
      message: BARCODE_COPY.invalid,
    });
  });

  it('HEALTH-FRIDGE-268: a found product becomes a draft that keeps the macros AND their portion', async () => {
    // "155 kcal" of WHAT is the donor's own bug: it stored four numbers with no
    // serving. Carrying the portion the provider quoted is what makes the row
    // honest, and re-portionable later.
    api.lookupBarcode.mockResolvedValue(lookup());

    const result = await lookupFridgeBarcode('5000157024671');

    expect(api.lookupBarcode).toHaveBeenCalledWith('5000157024671');
    expect(result.status).toBe('found');
    expect(result.message).toBe('');
    expect(result.draft).toEqual({
      name: 'Heinz Baked Beans',
      quantity: 1,
      unit: DEFAULT_FRIDGE_UNIT,
      category: DEFAULT_FRIDGE_CATEGORY,
      // A barcode identifies a PRODUCT, not the particular tin in this person's
      // hand, so it says nothing about when this one goes off.
      expiryDate: null,
      notes: 'Barcode 5000157024671',
      isFavorite: false,
      source: 'scan',
      nutrition: {
        calories: 155,
        protein: 9.4,
        carbs: 26.1,
        fats: 0.4,
        portion: 200,
        unit: 'g',
        source: 'fatsecret',
        barcode: '5000157024671',
      },
    });
  });

  it('HEALTH-FRIDGE-269: an unbranded product is not named " Baked Beans"', () => {
    // The name is `brand + name` joined; a null brand must not leave a leading
    // space, and a food with neither must still be named something.
    expect(barcodeDraft(externalFood({ brand_name: null }), '12345678').name).toBe('Baked Beans');
    expect(barcodeDraft(externalFood({ brand_name: '' }), '12345678').name).toBe('Baked Beans');
    // The column caps the name at 200; a provider string longer than that is cut
    // here rather than 400ing at the Worker.
    expect(
      barcodeDraft(externalFood({ brand_name: null, name: 'x'.repeat(400) }), '12345678').name
    ).toHaveLength(200);
  });

  it('HEALTH-FRIDGE-270: the Worker echoes the code it actually looked up, and that is what is shown', async () => {
    // A 12-digit UPC-A is padded to a GTIN-13 server-side. Showing the padded
    // code is what stops the leading zero looking like the app mangled it.
    api.lookupBarcode.mockResolvedValue(lookup({ barcode: '0012345678905' }));

    const result = await lookupFridgeBarcode('012345678905');

    expect(result.barcode).toBe('0012345678905');
    expect(result.draft?.notes).toBe('Barcode 0012345678905');
  });

  it('HEALTH-FRIDGE-271: "not configured" reads as switched off, never as broken', async () => {
    // This is the state the feature SHIPS in — no FatSecret credential is set on
    // any Health deploy. If it read as an error every member would conclude the
    // app is broken, and the copy has to name the next action instead.
    api.lookupBarcode.mockResolvedValue(
      lookup({ food: null, provider: { id: 'fatsecret', configured: false, status: 'not_configured' } })
    );

    const result = await lookupFridgeBarcode('5000157024671');

    expect(result.status).toBe('not_configured');
    expect(result.draft).toBeNull();
    expect(result.message).toBe(BARCODE_COPY.not_configured);
    expect(result.message).toContain('Add the item by hand');
  });

  it('HEALTH-FRIDGE-272: an unknown code, a rate limit and an outage each get their own answer', async () => {
    // 200-with-a-null-food means "the database does not know that code" — a
    // different fact, and a different next step, from "we could not ask".
    api.lookupBarcode.mockResolvedValue(lookup({ food: null }));
    expect(await lookupFridgeBarcode('5000157024671')).toMatchObject({
      status: 'not_found',
      draft: null,
      message: BARCODE_COPY.not_found,
    });

    for (const status of ['rate_limited', 'unavailable', 'skipped'] as const) {
      api.lookupBarcode.mockResolvedValue(
        lookup({ food: null, provider: { id: 'fatsecret', configured: true, status } })
      );
      expect(await lookupFridgeBarcode('5000157024671')).toMatchObject({
        status: 'unavailable',
        message: BARCODE_COPY.unavailable,
      });
    }
  });

  it('HEALTH-FRIDGE-273: a transport failure degrades to "unavailable" with no raw string', async () => {
    // Every provider outcome answers 200, so a throw here is the network. The
    // error's own text is never read — it cannot reach the screen.
    api.lookupBarcode.mockRejectedValue(new Error('ECONNRESET at 10.0.0.1'));

    const result = await lookupFridgeBarcode('5000157024671');

    expect(result.status).toBe('unavailable');
    expect(result.message).toBe(BARCODE_COPY.unavailable);
    expect(result.message).not.toMatch(/ECONNRESET|10\.0\.0\.1|Error/);
  });

  it('HEALTH-FRIDGE-274: a scanned draft round-trips its macros through the wire and back', async () => {
    // `nutrition_json` is stored TEXT and returned VERBATIM. The draft goes out
    // as an object and has to come back as a readable one, or the macros a
    // barcode found would be invisible on the row it created.
    api.lookupBarcode.mockResolvedValue(lookup());
    const found = await lookupFridgeBarcode('5000157024671');
    const server = fakeServer();

    const saved = await addFridgeItems([found.draft as FridgeDraft]);

    expect(api.createFridgeItem).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'scan',
        nutrition_json: expect.objectContaining({ calories: 155, portion: 200 }),
      })
    );
    expect(saved.items[0].nutrition).toMatchObject({
      calories: 155,
      portion: 200,
      unit: 'g',
      source: 'fatsecret',
      barcode: '5000157024671',
    });
    expect(server.rows[0].source).toBe('scan');
  });
});

/* ------------------------------------------------------------------ */
/* nutrition_json parsing                                              */
/* ------------------------------------------------------------------ */

describe('fridge P5 — reading nutrition_json', () => {
  it('HEALTH-FRIDGE-275: an unreadable blob reads as "no macros" rather than taking the row down', () => {
    // The column is returned verbatim, so it holds whatever ANY client ever
    // wrote — an older shape, a truncated string, another tool's payload. Every
    // one of these must render as a row with no macros, which is how a
    // hand-typed row renders anyway.
    for (const raw of [
      null,
      undefined,
      '',
      '   ',
      'not json',
      '[]',
      'null',
      '"a string"',
      '{"protein":9}', // no calories at all
      '{"calories":"lots"}',
      '{"calories":null}',
    ]) {
      expect([raw, parseFridgeNutrition(raw as string | null)]).toEqual([raw, null]);
    }
  });

  it('HEALTH-FRIDGE-276: missing macro figures default to 0, and a missing portion to 100 g', () => {
    // A row with calories but no protein is a real provider answer. Defaulting
    // the portion to 100 g is what keeps "155 kcal" from being unreadable.
    expect(parseFridgeNutrition('{"calories":155}')).toEqual({
      calories: 155,
      protein: 0,
      carbs: 0,
      fats: 0,
      portion: 100,
      unit: 'g',
      source: undefined,
      barcode: undefined,
    });
    // A zero or negative portion is not a portion.
    expect(parseFridgeNutrition('{"calories":155,"portion":0}')?.portion).toBe(100);
    expect(parseFridgeNutrition('{"calories":155,"portion":-5}')?.portion).toBe(100);
    expect(parseFridgeNutrition('{"calories":155,"unit":""}')?.unit).toBe('g');
    // Zero calories IS a fact (a diet drink), and must survive.
    expect(parseFridgeNutrition('{"calories":0}')?.calories).toBe(0);
  });

  it('HEALTH-FRIDGE-277: the parse happens on the way in, so the screen never sees the raw text', () => {
    const item = fromWireFridgeItem(
      row({ nutrition_json: '{"calories":155,"protein":9.4,"portion":200,"unit":"g"}' })
    );
    expect(item.nutrition).toMatchObject({ calories: 155, protein: 9.4, portion: 200 });
    expect(fromWireFridgeItem(row({ nutrition_json: 'corrupt' })).nutrition).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Receipt                                                             */
/* ------------------------------------------------------------------ */

describe('fridge P5 — reading a receipt', () => {
  // `HealthScanImage` — raw base64 under `data`, and a media type the Worker
  // treats as ADVISORY (it sniffs the magic bytes and ignores this).
  const image = { data: 'AAA', media_type: 'image/jpeg' as const };

  it('HEALTH-FRIDGE-278: a scan PERSISTS NOTHING and returns reviewable rows', async () => {
    api.scanFridgeReceipt.mockResolvedValue({
      draft: {
        vendor: 'Corner Shop',
        purchase_date: '2026-07-12',
        items: [receiptItem(), receiptItem({ name: 'Milk', category: 'Dairy', suggested_expiry_days: 7 })],
      },
    });

    const result = await scanFridgeReceipt([image], TODAY);

    expect(api.scanFridgeReceipt).toHaveBeenCalledWith([image]);
    expect(api.createFridgeItem).not.toHaveBeenCalled(); // nothing saved
    expect(result.status).toBe('ok');
    expect(result.vendor).toBe('Corner Shop');
    expect(result.purchaseDate).toBe('2026-07-12');
    expect(result.rows.map((r) => r.name)).toEqual(['Tomatoes', 'Milk']);
    // The suggested shelf life is resolved against TODAY, not the purchase date:
    // it is a typical shelf life from a server table, and the fridge cares about
    // when the thing will go off from now.
    expect(result.rows[0].suggestedExpiryDate).toBe('2026-07-18');
    expect(result.rows[1].suggestedExpiryDate).toBe('2026-07-20');
  });

  it('HEALTH-FRIDGE-279: non-food lines are SHOWN but not ticked', async () => {
    // A receipt carries batteries and bag fees. Dropping them would make a
    // wrongly-classified item look like a misread; ticking them would fill the
    // fridge with things to clean out by hand.
    api.scanFridgeReceipt.mockResolvedValue({
      draft: {
        vendor: null,
        purchase_date: null,
        items: [
          receiptItem({ name: 'Tomatoes' }),
          receiptItem({ name: 'Carrier bag', category: null, looks_like_food: false, suggested_expiry_days: null }),
        ],
      },
    });

    const result = await scanFridgeReceipt([image], TODAY);

    expect(result.rows.map((r) => [r.name, r.selected])).toEqual([
      ['Tomatoes', true],
      ['Carrier bag', false],
    ]);
    // …and the unplaceable line still gets a category to render, with no
    // invented expiry.
    expect(result.rows[1].category).toBe(DEFAULT_FRIDGE_CATEGORY);
    expect(result.rows[1].suggestedExpiryDate).toBeNull();
  });

  it('HEALTH-FRIDGE-280: each row key is stable within one scan, even for repeated names', () => {
    // The review list keys on it before anything has a server id. Two lines with
    // the same name must not collapse into one row.
    const items = [receiptItem({ name: 'Milk' }), receiptItem({ name: 'Milk' })];
    const keys = items.map((item, index) => receiptRow(item, index, TODAY).key);
    expect(new Set(keys).size).toBe(2);
    expect(keys).toEqual(['0-Milk', '1-Milk']);
  });

  it('HEALTH-FRIDGE-281: a shelf-life suggestion is refused rather than guessed when it makes no sense', () => {
    expect(suggestedExpiryDate(0, TODAY)).toBe(TODAY);
    expect(suggestedExpiryDate(5, TODAY)).toBe('2026-07-18');
    expect(suggestedExpiryDate(4.6, TODAY)).toBe('2026-07-18'); // rounded, not floored
    expect(suggestedExpiryDate(null, TODAY)).toBeNull();
    expect(suggestedExpiryDate(-3, TODAY)).toBeNull(); // never dates it in the past
    expect(suggestedExpiryDate(Number.NaN, TODAY)).toBeNull();
    expect(suggestedExpiryDate(Number.POSITIVE_INFINITY, TODAY)).toBeNull();
  });

  it('HEALTH-FRIDGE-282: a malformed amount or category degrades to null rather than rendering "NaN"', () => {
    const built = receiptRow(
      {
        name: 'Mystery',
        category: null,
        suggested_expiry_days: 'soon' as unknown as number,
        amount_cents: 'lots' as unknown as number,
        looks_like_food: 'yes' as unknown as boolean,
      },
      0,
      TODAY
    );
    expect(built).toMatchObject({
      category: DEFAULT_FRIDGE_CATEGORY,
      suggestedExpiryDays: null,
      suggestedExpiryDate: null,
      amountCents: null,
      // `looks_like_food` is compared with `=== true`, so a truthy non-boolean
      // is NOT food — the safe direction, since it only leaves a row unticked.
      looksLikeFood: false,
      selected: false,
    });
  });

  it('HEALTH-FRIDGE-283: a ticked row becomes a draft with UNKNOWN quantity and the receipt source', () => {
    // The reader groups three tomato lines into one "Tomatoes", so the count on
    // the paper does not survive. Inventing `1` would be a number nobody checked.
    const built = receiptRow(receiptItem(), 0, TODAY);
    const asDraft = receiptRowToDraft(built, built.suggestedExpiryDate);

    expect(asDraft).toEqual({
      name: 'Tomatoes',
      quantity: null,
      unit: DEFAULT_FRIDGE_UNIT,
      category: 'Vegetables',
      expiryDate: '2026-07-18',
      notes: 'Added from a receipt',
      isFavorite: false,
      source: 'receipt',
    });
    // The reviewer can also refuse the suggested date entirely.
    expect(receiptRowToDraft(built, null).expiryDate).toBeNull();
  });

  it('HEALTH-FRIDGE-284: every AI failure is mapped by STATUS, and names its own next step', async () => {
    const cases: Array<[number, keyof typeof FRIDGE_AI_COPY]> = [
      [403, 'needs_ai'],
      [415, 'unsupported'],
      [422, 'unreadable'],
      [500, 'unavailable'],
      [503, 'unavailable'],
    ];
    for (const [status, expected] of cases) {
      api.scanFridgeReceipt.mockRejectedValue(httpError(status));
      const result = await scanFridgeReceipt([image], TODAY);
      expect([status, result.status]).toEqual([status, expected]);
      expect(result.message).toBe(FRIDGE_AI_COPY[expected]);
      expect(result.rows).toEqual([]);
      // Nothing from the transport reaches the member.
      expect(result.message).not.toMatch(/status code|Request failed/);
    }
    // A thrown non-HTTP error is "unavailable" too — the honest generic answer.
    api.scanFridgeReceipt.mockRejectedValue(new Error('socket hang up'));
    expect((await scanFridgeReceipt([image], TODAY)).status).toBe('unavailable');
    // The entitlement denial is the one that must name where to switch AI on.
    expect(FRIDGE_AI_COPY.needs_ai).toContain('AI access');
  });

  it('HEALTH-FRIDGE-285: a status mapper reads the status and nothing else', () => {
    expect(fridgeAiStatusFor(httpError(403))).toBe('needs_ai');
    expect(fridgeAiStatusFor(httpError(415))).toBe('unsupported');
    expect(fridgeAiStatusFor(httpError(422))).toBe('unreadable');
    expect(fridgeAiStatusFor(httpError(429))).toBe('unavailable'); // "slow down", not broken
    expect(fridgeAiStatusFor(null)).toBe('unavailable');
    expect(fridgeAiStatusFor(undefined)).toBe('unavailable');
    expect(fridgeAiStatusFor({ message: 'needs_ai' })).toBe('unavailable');
  });

  it('HEALTH-FRIDGE-286: a scan that reads nothing is an EMPTY list, not a crash', async () => {
    // The Worker can answer 200 with no items — a blurred photo of a blank
    // receipt. That is a real outcome and must render as "nothing to review".
    api.scanFridgeReceipt.mockResolvedValue({
      draft: { vendor: null, purchase_date: null, items: [] },
    });
    expect(await scanFridgeReceipt([image], TODAY)).toEqual({
      status: 'ok',
      vendor: null,
      purchaseDate: null,
      rows: [],
      message: null,
    });

    // …and a body missing `items` altogether behaves the same rather than
    // throwing on `.map`.
    api.scanFridgeReceipt.mockResolvedValue({ draft: {} as never });
    expect((await scanFridgeReceipt([image], TODAY)).rows).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Meal ideas                                                          */
/* ------------------------------------------------------------------ */

describe('fridge P5 — meal ideas', () => {
  const plan = {
    meals: [
      {
        name: 'Tomato soup',
        description: 'Uses what is going off first.',
        ingredients_used: ['Tomatoes'],
        missing_ingredients: ['Stock'],
        calories: 210,
        protein_g: 6,
        carbs_g: 24,
        fat_g: 9,
        instructions: ['Chop', 'Simmer'],
        uses_expiring: ['Tomatoes'],
        prep_minutes: 25,
      },
    ],
    notes: null,
    considered: ['Tomatoes', 'Onions'],
  };

  it('HEALTH-FRIDGE-287: the request carries the local day and the donor default goal', async () => {
    // The plan is a function of what is going off TODAY, so the device's own day
    // has to travel with it — the Worker has no user timezone.
    api.fridgeMealIdeas.mockResolvedValue({ plan });

    const result = await loadFridgeMealIdeas({ today: TODAY });

    expect(api.fridgeMealIdeas).toHaveBeenCalledWith({
      today: TODAY,
      goal: DEFAULT_MEAL_GOAL,
      restrictions: null,
    });
    expect(result.status).toBe('ok');
    expect(result.plan?.meals[0].name).toBe('Tomato soup');
  });

  it('HEALTH-FRIDGE-288: a blank goal falls back rather than sending an empty prompt', async () => {
    api.fridgeMealIdeas.mockResolvedValue({ plan });

    await loadFridgeMealIdeas({ goal: '   ', restrictions: 'no nuts', today: TODAY });

    expect(api.fridgeMealIdeas).toHaveBeenLastCalledWith({
      today: TODAY,
      goal: DEFAULT_MEAL_GOAL,
      restrictions: 'no nuts',
    });

    await loadFridgeMealIdeas({ goal: '  High protein  ', today: TODAY });
    expect(api.fridgeMealIdeas).toHaveBeenLastCalledWith({
      today: TODAY,
      goal: 'High protein',
      restrictions: null,
    });
  });

  it('HEALTH-FRIDGE-289: with no options at all it still asks about the CURRENT day', async () => {
    api.fridgeMealIdeas.mockResolvedValue({ plan });
    await loadFridgeMealIdeas();
    expect(api.fridgeMealIdeas).toHaveBeenCalledWith({
      today: TODAY,
      goal: DEFAULT_MEAL_GOAL,
      restrictions: null,
    });
  });

  it('HEALTH-FRIDGE-290: "no meal in this fridge" is a SUCCESS with a sentence, not a failure', async () => {
    // Three condiments have no meal in them. Saying so is the right answer, and
    // dressing it as an error would send the member to look for a fault.
    api.fridgeMealIdeas.mockResolvedValue({
      plan: { meals: [], notes: 'There is not much to work with yet.', considered: ['Salt'] },
    });

    const result = await loadFridgeMealIdeas({ today: TODAY });

    expect(result.status).toBe('ok');
    expect(result.message).toBeNull();
    expect(result.plan).toEqual({
      meals: [],
      notes: 'There is not much to work with yet.',
      considered: ['Salt'],
    });
  });

  it('HEALTH-FRIDGE-291: a malformed plan is normalised to empty arrays rather than crashing the card', async () => {
    api.fridgeMealIdeas.mockResolvedValue({ plan: {} as never });
    expect((await loadFridgeMealIdeas({ today: TODAY })).plan).toEqual({
      meals: [],
      notes: null,
      considered: [],
    });

    api.fridgeMealIdeas.mockResolvedValue({
      plan: { meals: 'nope', notes: null, considered: null } as never,
    });
    expect((await loadFridgeMealIdeas({ today: TODAY })).plan).toEqual({
      meals: [],
      notes: null,
      considered: [],
    });
  });

  it('HEALTH-FRIDGE-292: every failure is the shared AI copy, chosen by status', async () => {
    for (const [status, expected] of [
      [403, 'needs_ai'],
      [415, 'unsupported'],
      [422, 'unreadable'],
      [500, 'unavailable'],
    ] as Array<[number, keyof typeof FRIDGE_AI_COPY]>) {
      api.fridgeMealIdeas.mockRejectedValue(httpError(status));
      const result = await loadFridgeMealIdeas({ today: TODAY });
      expect([status, result.status]).toEqual([status, expected]);
      expect(result.plan).toBeNull();
      expect(result.message).toBe(FRIDGE_AI_COPY[expected]);
      expect(result.message).not.toMatch(/status code|Request failed/);
    }
  });

  it('HEALTH-FRIDGE-293: the plan is NEVER cached — a stale one describes a fridge that no longer exists', async () => {
    api.fridgeMealIdeas.mockResolvedValue({ plan });
    await loadFridgeMealIdeas({ today: TODAY });

    // Nothing was written under any fridge key, and a second ask really asks
    // again rather than replaying a snapshot.
    expect(await storageHelpers.getObject('health.fridge.meals.v1')).toBeNull();
    await loadFridgeMealIdeas({ today: TODAY });
    expect(api.fridgeMealIdeas).toHaveBeenCalledTimes(2);
  });
});
