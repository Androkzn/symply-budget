/**
 * Symply Health — FRIDGE: the three filters, the search needle, and the
 * vocabulary (10 units × 10 categories) round-tripping through a write.
 *
 * `healthFridgeStorage.test.ts` shows each filter works once. This file owns
 * what happens when they COMBINE, because that is where a fridge quietly starts
 * lying:
 *
 *  - Expiring + a search needle must narrow the SERVER's window, never widen it
 *    back to the whole fridge (an undated row reappearing under a search would
 *    contradict the filter note printed directly above it).
 *  - Favourites + a needle must not resurrect an unstarred row.
 *  - The needle matches the NAME or the CATEGORY — donor behaviour, and the only
 *    way "show me the dairy" works without a category filter — and matches
 *    NOTHING else. A needle that also swept notes or units would make "g" match
 *    half the fridge.
 *
 * The unit/category half is a round trip rather than a list comparison: every
 * value the chip rows can produce has to survive `toWireFridgePayload`'s
 * `slice()` caps, come back through `fromWireFridgeItem`, and render. A unit the
 * form can pick but the column truncates would silently corrupt the row.
 */

import { healthFridgeApi, type HealthFridgeItem } from '@api/healthFridge';
import { storageHelpers } from '@services/storage';

import {
  createFridgeItem,
  DEFAULT_FRIDGE_CATEGORY,
  formatQuantity,
  FRIDGE_CATEGORIES,
  FRIDGE_FILTER_LABELS,
  FRIDGE_FILTERS,
  FRIDGE_UNITS,
  loadFridge,
  parseQuantityInput,
  sanitizeQuantityInput,
  setFridgeFavorite,
  updateFridgeItem,
  viewFridge,
  type FridgeDraft,
  type FridgeItem,
} from '../../healthFridgeStorage';
import { __setHealthOfflineForTests, clearHealthCache } from '../../healthRepository';

jest.mock('@api/healthFridge');

const api = healthFridgeApi as unknown as jest.Mocked<typeof healthFridgeApi>;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';
const ISO = '2026-07-13T08:00:00.000Z';

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

function item(over: Partial<FridgeItem> = {}): FridgeItem {
  return {
    id: 'fr_1',
    name: 'Milk',
    quantity: 1,
    unit: 'L',
    category: 'Dairy',
    expiryDate: '2026-07-15',
    isFavorite: false,
    notes: '',
    source: 'manual',
    nutrition: null,
    createdAt: ISO,
    updatedAt: ISO,
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

/**
 * A stateful stand-in for the Worker. Every writer re-reads the fridge after the
 * request, so a static list mock would report each write as lost.
 */
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
      is_favorite: payload.is_favorite ?? false,
      notes: (payload.notes as string | null) ?? null,
      created_at: new Date(Date.now() + state.rows.length).toISOString(),
      updated_at: ISO,
    });
    state.rows = [created, ...state.rows];
    return Promise.resolve({ item: created });
  });
  api.updateFridgeItem.mockImplementation((id, payload) => {
    const found = state.rows.find((r) => r.id === id);
    if (!found) return Promise.reject(Object.assign(new Error('gone'), { response: { status: 404 } }));
    const next: HealthFridgeItem = {
      ...found,
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.unit !== undefined ? { unit: payload.unit } : {}),
      ...(payload.category !== undefined ? { category: payload.category } : {}),
      ...(payload.quantity !== undefined ? { quantity: payload.quantity } : {}),
      ...(payload.is_favorite !== undefined ? { is_favorite: payload.is_favorite } : {}),
    };
    state.rows = state.rows.map((r) => (r.id === id ? next : r));
    return Promise.resolve({ item: next });
  });
  api.deleteFridgeItem.mockImplementation((id) => {
    state.rows = state.rows.filter((r) => r.id !== id);
    return Promise.resolve({ deleted: true });
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
/* Filters × search                                                    */
/* ------------------------------------------------------------------ */

describe('fridge — filters and search combined', () => {
  /** One row per interesting axis: urgency, starred-ness and category. */
  const stock: FridgeItem[] = [
    item({ id: 'gone', name: 'Yoghurt', category: 'Dairy', expiryDate: '2026-07-09' }),
    item({ id: 'today', name: 'Fish pie', category: 'Frozen', expiryDate: TODAY, isFavorite: true }),
    item({ id: 'week', name: 'Bread', category: 'Grains', expiryDate: '2026-07-18' }),
    item({ id: 'later', name: 'Rice', category: 'Grains', expiryDate: '2026-12-01', isFavorite: true }),
    item({ id: 'undated', name: 'Salt', category: 'Condiments', expiryDate: null }),
  ];

  it('HEALTH-FRIDGE-214: the three filters are exactly the three the segmented control offers', () => {
    // The labels are user-facing copy and the ids are what the testIDs and the
    // Maestro selectors are built from — a fourth filter, or a rename, must be
    // a deliberate change to this list rather than a silent one.
    expect([...FRIDGE_FILTERS]).toEqual(['all', 'expiring', 'favorites']);
    expect(FRIDGE_FILTERS.map((f) => FRIDGE_FILTER_LABELS[f])).toEqual([
      'All',
      'Expiring soon',
      'Favourites',
    ]);
  });

  it('HEALTH-FRIDGE-215: a needle NARROWS the expiring window and never widens it', () => {
    // The screen prints "Items with no date are not in this view" directly above
    // this list. If a search could bring an undated row back, that sentence
    // would be false while it was on screen.
    const expiring = viewFridge(stock, { filter: 'expiring', today: TODAY });
    expect(expiring.map((i) => i.id)).toEqual(['gone', 'today', 'week']);

    expect(
      viewFridge(stock, { filter: 'expiring', query: 'grains', today: TODAY }).map((i) => i.id)
    ).toEqual(['week']);
    // `Rice` is Grains too — but it is outside the window, so the needle must
    // not pull it in.
    expect(
      viewFridge(stock, { filter: 'expiring', query: 'rice', today: TODAY }).map((i) => i.id)
    ).toEqual([]);
    // …and `Salt` is undated, so no needle can reach it in this view.
    expect(
      viewFridge(stock, { filter: 'expiring', query: 'salt', today: TODAY }).map((i) => i.id)
    ).toEqual([]);
    expect(viewFridge(stock, { filter: 'all', query: 'salt', today: TODAY }).map((i) => i.id))
      .toEqual(['undated']);
  });

  it('HEALTH-FRIDGE-216: a needle cannot resurrect an unstarred row in Favourites', () => {
    expect(viewFridge(stock, { filter: 'favorites', today: TODAY }).map((i) => i.id)).toEqual([
      'today',
      'later',
    ]);
    expect(
      viewFridge(stock, { filter: 'favorites', query: 'grains', today: TODAY }).map((i) => i.id)
    ).toEqual(['later']);
    // `Bread` is Grains and NOT starred: the intersection is empty, not "Bread".
    expect(
      viewFridge(stock, { filter: 'favorites', query: 'bread', today: TODAY }).map((i) => i.id)
    ).toEqual([]);
  });

  it('HEALTH-FRIDGE-217: the needle is case-folded on BOTH sides and trimmed', () => {
    const shout = [item({ id: 'caps', name: 'PARMESAN', category: 'DAIRY' })];
    expect(viewFridge(shout, { query: 'parmesan', today: TODAY })).toHaveLength(1);
    expect(viewFridge(shout, { query: 'dairy', today: TODAY })).toHaveLength(1);
    expect(viewFridge(stock, { query: 'YOGH', today: TODAY }).map((i) => i.id)).toEqual(['gone']);
    expect(viewFridge(stock, { query: '  bread  ', today: TODAY }).map((i) => i.id)).toEqual([
      'week',
    ]);
    // A needle of nothing but whitespace is NOT a search — it must leave the
    // list alone rather than matching every row by accident.
    expect(viewFridge(stock, { query: '   ', today: TODAY })).toHaveLength(stock.length);
    expect(viewFridge(stock, { query: '', today: TODAY })).toHaveLength(stock.length);
    expect(viewFridge(stock, { today: TODAY })).toHaveLength(stock.length);
  });

  it('HEALTH-FRIDGE-218: the needle matches a SUBSTRING, anywhere, of the name or the category', () => {
    expect(viewFridge(stock, { query: 'ish p', today: TODAY }).map((i) => i.id)).toEqual(['today']);
    expect(viewFridge(stock, { query: 'ain', today: TODAY }).map((i) => i.id)).toEqual([
      'week',
      'later',
    ]);
    // A needle longer than anything in the fridge finds nothing rather than
    // throwing on the shorter strings.
    expect(viewFridge(stock, { query: 'x'.repeat(500), today: TODAY })).toEqual([]);
  });

  it('HEALTH-FRIDGE-219: search reaches the name and the category, and NOTHING else', () => {
    // Notes, unit and source are deliberately out of scope. A needle that swept
    // the unit would make "g" match every gram in the fridge; one that swept
    // notes would surface rows whose visible text does not contain the needle,
    // which reads as a bug from the outside.
    const one = [
      item({
        id: 'only',
        name: 'Butter',
        category: 'Dairy',
        unit: 'g',
        notes: 'left by Grandma',
        source: 'receipt',
      }),
    ];
    expect(viewFridge(one, { query: 'butter', today: TODAY })).toHaveLength(1);
    expect(viewFridge(one, { query: 'dairy', today: TODAY })).toHaveLength(1);
    expect(viewFridge(one, { query: 'grandma', today: TODAY })).toEqual([]);
    expect(viewFridge(one, { query: 'receipt', today: TODAY })).toEqual([]);
  });

  it('HEALTH-FRIDGE-220: search is NOT accent-folded — a documented product gap, not a crash', () => {
    // `toLowerCase()` folds case but not diacritics, so "creme" does not find
    // "Crème". This is pinned as the SHIPPED behaviour rather than wished away:
    // the fix is a `normalize('NFD')` in `viewFridge`, and when it lands this
    // spec is what says so out loud. Nothing throws either way, which is the
    // part that would actually break the screen.
    const accented = [item({ id: 'creme', name: 'Crème fraîche', category: 'Dairy' })];
    expect(viewFridge(accented, { query: 'crème', today: TODAY })).toHaveLength(1);
    expect(viewFridge(accented, { query: 'CRÈME', today: TODAY })).toHaveLength(1);
    expect(viewFridge(accented, { query: 'creme', today: TODAY })).toEqual([]);
    // Non-Latin names are matched on their own terms and never crash the filter.
    const cyrillic = [item({ id: 'ru', name: 'Молоко', category: 'Dairy' })];
    expect(viewFridge(cyrillic, { query: 'молоко', today: TODAY })).toHaveLength(1);
  });

  it('HEALTH-FRIDGE-221: an unfiltered, unsearched view returns the list unchanged', () => {
    // The identity case matters because `viewFridge` starts from the caller's
    // array: an accidental sort or copy here would fight the ordering the
    // loaders already applied (newest-first / soonest-first).
    expect(viewFridge(stock, { filter: 'all', today: TODAY })).toEqual(stock);
    expect(viewFridge([], { filter: 'expiring', query: 'anything', today: TODAY })).toEqual([]);
    expect(viewFridge([], { filter: 'favorites', today: TODAY })).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Favourite, both directions                                          */
/* ------------------------------------------------------------------ */

describe('fridge — starring and unstarring', () => {
  it('HEALTH-FRIDGE-222: a star toggles both ways and the Favourites view follows it', async () => {
    // Un-starring while standing IN the Favourites view is the interesting
    // direction: the row must LEAVE the list the user is reading, which is the
    // only feedback the screen gives for that action.
    fakeServer([row({ id: 'fr_1', name: 'Milk' }), row({ id: 'fr_2', name: 'Cheese' })]);
    await loadFridge();

    const starred = await setFridgeFavorite('fr_1', true);
    expect(api.updateFridgeItem).toHaveBeenLastCalledWith('fr_1', { is_favorite: true });
    expect(viewFridge(starred.items, { filter: 'favorites', today: TODAY }).map((i) => i.id))
      .toEqual(['fr_1']);

    const unstarred = await setFridgeFavorite('fr_1', false);
    expect(api.updateFridgeItem).toHaveBeenLastCalledWith('fr_1', { is_favorite: false });
    expect(viewFridge(unstarred.items, { filter: 'favorites', today: TODAY })).toEqual([]);
    // The row is still in the fridge — un-starring is not a delete.
    expect(unstarred.items.map((i) => i.id).sort()).toEqual(['fr_1', 'fr_2']);
  });

  it('HEALTH-FRIDGE-223: an edit can flip the star without a second request', async () => {
    // The form carries `isFavorite`, so a save is also a star change. Sending it
    // on the same PUT is what keeps the row from flickering between two writes.
    fakeServer([row({ id: 'fr_1', is_favorite: true })]);
    await loadFridge();

    const result = await updateFridgeItem('fr_1', draft({ isFavorite: false }));

    expect(api.updateFridgeItem).toHaveBeenCalledTimes(1);
    expect(api.updateFridgeItem).toHaveBeenCalledWith(
      'fr_1',
      expect.objectContaining({ is_favorite: false })
    );
    expect(result.items[0].isFavorite).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* The vocabulary: 10 units × 10 categories                            */
/* ------------------------------------------------------------------ */

describe('fridge — units and categories round-trip', () => {
  it('HEALTH-FRIDGE-224: the chip rows offer exactly the donor vocabulary', () => {
    expect([...FRIDGE_UNITS]).toEqual([
      'pc',
      'kg',
      'g',
      'L',
      'ml',
      'oz',
      'lb',
      'cup',
      'tbsp',
      'tsp',
    ]);
    expect([...FRIDGE_CATEGORIES]).toEqual([
      'Dairy',
      'Meat',
      'Vegetables',
      'Fruits',
      'Grains',
      'Beverages',
      'Snacks',
      'Frozen',
      'Condiments',
      'Uncategorized',
    ]);
    // Every value has to survive the column caps the payload builder slices to
    // (unit ≤ 20, category ≤ 50) untouched — a truncated `Uncategorized` would
    // make the default category unsearchable.
    for (const unit of FRIDGE_UNITS) expect(unit.length).toBeLessThanOrEqual(20);
    for (const category of FRIDGE_CATEGORIES) expect(category.length).toBeLessThanOrEqual(50);
    expect(FRIDGE_CATEGORIES).toContain(DEFAULT_FRIDGE_CATEGORY);
  });

  it.each([...FRIDGE_UNITS])(
    'HEALTH-FRIDGE-225: unit %s survives the write and renders beside the quantity',
    async (unit) => {
      const result = await createFridgeItem(draft({ name: `Item ${unit}`, quantity: 2, unit }));

      expect(api.createFridgeItem).toHaveBeenLastCalledWith(expect.objectContaining({ unit }));
      const saved = result.items.find((i) => i.name === `Item ${unit}`);
      expect(saved?.unit).toBe(unit);
      expect(formatQuantity(saved?.quantity ?? null, saved?.unit ?? null)).toBe(`2 ${unit}`);
    }
  );

  it.each([...FRIDGE_CATEGORIES])(
    'HEALTH-FRIDGE-226: category %s survives the write and is findable by search',
    async (category) => {
      const result = await createFridgeItem(draft({ name: 'Anonymous', category }));

      expect(api.createFridgeItem).toHaveBeenLastCalledWith(expect.objectContaining({ category }));
      // The category is the ONLY thing distinguishing this row, so a needle on
      // it is the read-back — this is exactly how a user asks for "the dairy".
      const found = viewFridge(result.items, { query: category, today: TODAY });
      expect(found.map((i) => i.category)).toEqual([category]);
    }
  );
});

/* ------------------------------------------------------------------ */
/* Quantity: the values a real keyboard can produce                    */
/* ------------------------------------------------------------------ */

describe('fridge — quantity edges', () => {
  it('HEALTH-FRIDGE-227: zero is a real quantity and blank is the absence of one', async () => {
    // "0 pc" means the packet is empty and worth replacing; no quantity means
    // nobody counted. Collapsing them would make the fridge claim a fact the
    // user never gave it.
    expect(parseQuantityInput('0')).toEqual({ valid: true, quantity: 0 });
    expect(parseQuantityInput('')).toEqual({ valid: true, quantity: null });

    const zero = await createFridgeItem(draft({ name: 'Zero', quantity: 0 }));
    expect(api.createFridgeItem).toHaveBeenLastCalledWith(expect.objectContaining({ quantity: 0 }));
    expect(zero.items[0].quantity).toBe(0);
    expect(formatQuantity(0, 'pc')).toBe('0 pc');

    const none = await createFridgeItem(draft({ name: 'None', quantity: null }));
    expect(api.createFridgeItem).toHaveBeenLastCalledWith(
      expect.objectContaining({ quantity: null })
    );
    expect(none.items[0].quantity).toBeNull();
    expect(formatQuantity(null, 'pc')).toBe('');
  });

  it('HEALTH-FRIDGE-228: fractions round to two decimals, and the column ceiling is honoured', () => {
    // Two decimals is what the D1 column stores; rounding here rather than at
    // the Worker means a refused write can never be caused by a digit the user
    // cannot see.
    expect(parseQuantityInput('2.5')).toEqual({ valid: true, quantity: 2.5 });
    expect(parseQuantityInput('0.01')).toEqual({ valid: true, quantity: 0.01 });
    expect(parseQuantityInput('2.567')).toEqual({ valid: true, quantity: 2.57 });
    expect(parseQuantityInput('2.564')).toEqual({ valid: true, quantity: 2.56 });
    expect(parseQuantityInput('0.001')).toEqual({ valid: true, quantity: 0 });
    // A comma is a decimal separator on most of the world's keyboards.
    expect(parseQuantityInput('2,75')).toEqual({ valid: true, quantity: 2.75 });

    // The CHECK boundary itself is legal; one hundredth past it is not.
    expect(parseQuantityInput('1000000')).toEqual({ valid: true, quantity: 1_000_000 });
    expect(parseQuantityInput('1000000.01')).toEqual({ valid: false });
    expect(parseQuantityInput('999999999')).toEqual({ valid: false });
    expect(parseQuantityInput('-0.01')).toEqual({ valid: false });
    // Refusing here is what turns a 400 from the Worker into an inline hint.
    expect(parseQuantityInput('Infinity')).toEqual({ valid: false });
    expect(parseQuantityInput('NaN')).toEqual({ valid: false });
  });

  it('HEALTH-FRIDGE-229: the sanitiser emits one shape, and the parser accepts all but the bare separator', () => {
    // The field is `keyboardType="decimal-pad"`, which is a HINT: a paste, a
    // hardware keyboard or a Bluetooth scanner can put anything in it. The pair
    // has to compose, so every sanitised string is fed straight to the parser.
    const pastes = ['1a0b0', '2.5.7', '2,5', '  12  ', '$4.99', '1e3', '--3', '', '3.'];
    for (const paste of pastes) {
      const cleaned = sanitizeQuantityInput(paste);
      expect(cleaned).toMatch(/^[0-9]*[.,]?[0-9]*$/);
      expect([paste, parseQuantityInput(cleaned).valid]).toEqual([paste, true]);
    }
    // Spot-checks of the ones with a surprising answer.
    expect(sanitizeQuantityInput('$4.99')).toBe('4.99');
    expect(sanitizeQuantityInput('1e3')).toBe('13'); // `e` is dropped, not read
    expect(sanitizeQuantityInput('3.')).toBe('3.');
    expect(parseQuantityInput('3.')).toEqual({ valid: true, quantity: 3 });
  });

  it('HEALTH-FRIDGE-230: a lone decimal point is sanitiser-legal and parser-illegal', () => {
    // The ONE composition gap between the pair, pinned rather than wished away.
    // Tapping `.` first on the decimal pad leaves the field holding `.`:
    // `sanitizeQuantityInput` keeps it (one separator is allowed) and
    // `parseQuantityInput` refuses it (`Number('.')` is NaN).
    //
    // Consequence on the screen: `canSave` goes false and **Add to fridge**
    // greys out with NO explanation — the only inline hint the form renders is
    // the EXPIRY one. Recorded as a UX gap in the fridge report; the fix is
    // either a quantity hint beside the expiry hint, or treating a bare
    // separator as blank. Until then this is what ships.
    expect(sanitizeQuantityInput('....')).toBe('.');
    expect(sanitizeQuantityInput('.')).toBe('.');
    expect(parseQuantityInput('.')).toEqual({ valid: false });
    expect(parseQuantityInput(',')).toEqual({ valid: false });
    // The same silent-disable applies to a number past the column ceiling,
    // which the sanitiser cannot know about.
    expect(sanitizeQuantityInput('9000000')).toBe('9000000');
    expect(parseQuantityInput('9000000')).toEqual({ valid: false });
  });

  it('HEALTH-FRIDGE-231: a very large quantity survives the round trip intact', async () => {
    // 1,000,000 is the column ceiling and the one value most likely to be
    // mangled by a float round trip through JSON and D1's REAL column.
    const result = await createFridgeItem(draft({ name: 'Rice grains', quantity: 1_000_000 }));
    expect(api.createFridgeItem).toHaveBeenLastCalledWith(
      expect.objectContaining({ quantity: 1_000_000 })
    );
    expect(result.items[0].quantity).toBe(1_000_000);
    expect(formatQuantity(1_000_000, 'g')).toBe('1000000 g');
  });
});
