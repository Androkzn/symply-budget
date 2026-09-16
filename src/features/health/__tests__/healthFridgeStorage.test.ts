/**
 * Symply Health — FRIDGE store (parity phase P2).
 *
 * Three layers, same shape as the other Health store suites:
 *
 *  1. PURE — expiry arithmetic, bucketing, formatting, input parsing.
 *  2. WIRE — the EXACT payload every writer sends, and the `fromWire` mapping
 *     back.
 *  3. OFFLINE — cached read, optimistic write, sync state, plus the third
 *     outcome: a SERVER REJECTION rolls the optimistic row back rather than
 *     leaving a phantom item behind.
 *
 * The load-bearing behaviour pinned here is the deployed expiring-soon
 * semantics: `expiring_within_days` INCLUDES the past and EXCLUDES undated
 * items. `expiringWithin` is the offline twin of that server rule, so if the
 * two ever drift the fridge silently starts hiding food that has gone off.
 */

import { healthFridgeApi, type HealthFridgeItem } from '@api/healthFridge';
import { storageHelpers } from '@services/storage';

import {
  createFridgeItem,
  daysUntil,
  DEFAULT_FRIDGE_CATEGORY,
  deleteFridgeItem,
  EXPIRY_BUCKETS,
  expiringWithin,
  expiryBucketOf,
  formatExpiry,
  formatQuantity,
  FRIDGE_MISSING_MESSAGE,
  FRIDGE_OFFLINE_MESSAGE,
  fridgeRejectionMessageFor,
  fromWireFridgeItem,
  groupByExpiry,
  HEALTH_FRIDGE_KEY,
  loadExpiringSoon,
  loadFridge,
  parseExpiryInput,
  parseQuantityInput,
  quickPickDate,
  sanitizeExpiryInput,
  sanitizeQuantityInput,
  setFridgeFavorite,
  summarizeFridge,
  updateFridgeItem,
  viewFridge,
  type FridgeDraft,
  type FridgeItem,
} from '../healthFridgeStorage';
import {
  __setHealthOfflineForTests,
  clearHealthCache,
  healthSyncStateFor,
} from '../healthRepository';

jest.mock('@api/healthFridge');

type MockedFridgeApi = jest.Mocked<typeof healthFridgeApi>;
const api = healthFridgeApi as unknown as MockedFridgeApi;

/** The Worker answers with the bare object — no `{ data }` envelope. */
function body<T>(payload: T): T {
  return payload;
}

const NETWORK_ERROR = new Error('Network request failed');
/** A refusal from the Worker, carrying only an HTTP status (never a message). */
function httpError(status: number): Error & { response: { status: number } } {
  return Object.assign(new Error('Request failed'), { response: { status } });
}

// Fixed local noon: `todayDateKey()` === '2026-07-13' in every timezone.
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

/**
 * A tiny stateful server. Every writer re-reads the fridge afterwards, so a
 * static list mock would report each add as lost.
 */
function fakeFridgeServer(initial: HealthFridgeItem[] = []): { rows: HealthFridgeItem[] } {
  const state = { rows: [...initial] };
  api.listFridge.mockImplementation((params) => {
    if (params?.expiring_within_days === undefined) {
      return Promise.resolve(body({ items: [...state.rows] }));
    }
    // Mirror the deployed SQL: dated, on or before today + N, oldest first.
    const cutoff = quickPickDate(params.expiring_within_days, params.today ?? TODAY) as string;
    return Promise.resolve(
      body({
        items: state.rows
          .filter((r) => r.expiry_date !== null && r.expiry_date <= cutoff)
          .sort((a, b) => (a.expiry_date ?? '').localeCompare(b.expiry_date ?? '')),
      })
    );
  });
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    state.rows = [created, ...state.rows];
    return Promise.resolve(body({ item: created }));
  });
  api.updateFridgeItem.mockImplementation((id, payload) => {
    const found = state.rows.find((r) => r.id === id);
    if (!found) return Promise.reject(httpError(404));
    const next: HealthFridgeItem = {
      ...found,
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.quantity !== undefined ? { quantity: payload.quantity } : {}),
      ...(payload.unit !== undefined ? { unit: payload.unit } : {}),
      ...(payload.category !== undefined ? { category: payload.category } : {}),
      ...(payload.expiry_date !== undefined ? { expiry_date: payload.expiry_date } : {}),
      ...(payload.is_favorite !== undefined ? { is_favorite: payload.is_favorite } : {}),
      ...(payload.notes !== undefined ? { notes: payload.notes as string | null } : {}),
    };
    state.rows = state.rows.map((r) => (r.id === id ? next : r));
    return Promise.resolve(body({ item: next }));
  });
  api.deleteFridgeItem.mockImplementation((id) => {
    const before = state.rows.length;
    state.rows = state.rows.filter((r) => r.id !== id);
    if (state.rows.length === before) return Promise.reject(httpError(404));
    return Promise.resolve(body({ deleted: true }));
  });
  return state;
}

beforeEach(async () => {
  await storageHelpers.clearAll();
  await clearHealthCache([]);
  __setHealthOfflineForTests(false);
  jest.resetAllMocks();
  fakeFridgeServer();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Pure — expiry arithmetic                                            */
/* ------------------------------------------------------------------ */

describe('healthFridgeStorage — expiry arithmetic', () => {
  it('HEALTH-FRIDGE-001: daysUntil counts whole days in both directions', () => {
    expect(daysUntil(TODAY, TODAY)).toBe(0);
    expect(daysUntil('2026-07-14', TODAY)).toBe(1);
    expect(daysUntil('2026-07-12', TODAY)).toBe(-1);
    expect(daysUntil('2026-08-12', TODAY)).toBe(30);
    expect(daysUntil('not-a-date', TODAY)).toBeNull();
  });

  it('HEALTH-FRIDGE-002: buckets run expired → today → week → later → undated', () => {
    expect(expiryBucketOf('2026-07-01', TODAY)).toBe('expired');
    expect(expiryBucketOf(TODAY, TODAY)).toBe('today');
    expect(expiryBucketOf('2026-07-14', TODAY)).toBe('week');
    expect(expiryBucketOf('2026-07-20', TODAY)).toBe('week'); // exactly 7 days
    expect(expiryBucketOf('2026-07-21', TODAY)).toBe('later'); // 8 days
    expect(expiryBucketOf(null, TODAY)).toBe('undated');
    // Ordering is the contract the screen renders in.
    expect([...EXPIRY_BUCKETS]).toEqual(['expired', 'today', 'week', 'later', 'undated']);
  });

  it('HEALTH-FRIDGE-003: expiry copy names the day, and says "expired" when it has', () => {
    expect(formatExpiry('2026-07-12', TODAY)).toBe('Expired yesterday');
    expect(formatExpiry('2026-07-10', TODAY)).toBe('Expired 3 days ago');
    expect(formatExpiry(TODAY, TODAY)).toBe('Expires today');
    expect(formatExpiry('2026-07-14', TODAY)).toBe('Expires tomorrow');
    expect(formatExpiry('2026-07-18', TODAY)).toBe('Expires in 5 days');
    // Beyond a week the absolute date is the useful fact.
    expect(formatExpiry('2026-09-01', TODAY)).toBe('Expires 2026-09-01');
    expect(formatExpiry(null, TODAY)).toBe('No expiry date');
  });

  it('HEALTH-FRIDGE-004: quantity formats whole numbers without a decimal tail', () => {
    expect(formatQuantity(2, 'pc')).toBe('2 pc');
    expect(formatQuantity(2.5, 'kg')).toBe('2.5 kg');
    expect(formatQuantity(1, null)).toBe('1');
    // No quantity is a different fact from zero, and prints as nothing.
    expect(formatQuantity(null, 'pc')).toBe('');
    expect(formatQuantity(0, 'pc')).toBe('0 pc');
  });
});

/* ------------------------------------------------------------------ */
/* Pure — the deployed expiring-soon window                             */
/* ------------------------------------------------------------------ */

describe('healthFridgeStorage — expiring-soon window', () => {
  const stock = [
    item({ id: 'gone', name: 'Yoghurt', expiryDate: '2026-07-09' }), // 4 days expired
    item({ id: 'yesterday', name: 'Cream', expiryDate: '2026-07-12' }),
    item({ id: 'today', name: 'Fish', expiryDate: TODAY }),
    item({ id: 'week', name: 'Bread', expiryDate: '2026-07-18' }),
    item({ id: 'later', name: 'Rice', expiryDate: '2026-12-01' }),
    item({ id: 'undated', name: 'Salt', expiryDate: null }),
  ];

  it('HEALTH-FRIDGE-005: the window INCLUDES the past — expired stock is the most urgent', () => {
    const ids = expiringWithin(stock, 7, TODAY).map((i) => i.id);
    expect(ids).toEqual(['gone', 'yesterday', 'today', 'week']);
    // Longest-expired first: that is the thing most likely to be a problem.
    expect(ids[0]).toBe('gone');
  });

  it('HEALTH-FRIDGE-006: the window EXCLUDES undated items, so they are never "expiring"', () => {
    expect(expiringWithin(stock, 3650, TODAY).map((i) => i.id)).not.toContain('undated');
    // …but they are still in the fridge.
    expect(viewFridge(stock, { filter: 'all', today: TODAY }).map((i) => i.id)).toContain('undated');
  });

  it('HEALTH-FRIDGE-007: the summary counts the same rows the window would return', () => {
    const summary = summarizeFridge(stock, TODAY);
    expect(summary.total).toBe(6);
    expect(summary.expired).toBe(2);
    expect(summary.dueToday).toBe(1);
    expect(summary.dueThisWeek).toBe(1);
    expect(summary.undated).toBe(1);
    expect(summary.expiringSoon).toBe(expiringWithin(stock, 7, TODAY).length);
    expect(summary.cutoff).toBe('2026-07-20');
  });

  it('HEALTH-FRIDGE-008: grouping orders urgent first and never merges undated into "later"', () => {
    const groups = groupByExpiry(stock, TODAY);
    expect(groups.map((g) => g.bucket)).toEqual(['expired', 'today', 'week', 'later', 'undated']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['gone', 'yesterday']);
    expect(groups[4].hint).toContain('never appear in the expiring-soon count');
    // Empty buckets are dropped rather than rendered as blank sections.
    expect(groupByExpiry([item({ expiryDate: null })], TODAY).map((g) => g.bucket)).toEqual([
      'undated',
    ]);
  });

  it('HEALTH-FRIDGE-009: filters and search narrow the same list', () => {
    expect(viewFridge(stock, { filter: 'expiring', today: TODAY }).map((i) => i.id)).toEqual([
      'gone',
      'yesterday',
      'today',
      'week',
    ]);
    const starred = [...stock, item({ id: 'fav', name: 'Butter', isFavorite: true })];
    expect(viewFridge(starred, { filter: 'favorites', today: TODAY }).map((i) => i.id)).toEqual([
      'fav',
    ]);
    // Search matches the name OR the category (donor behaviour).
    expect(viewFridge(stock, { query: 'bre', today: TODAY }).map((i) => i.id)).toEqual(['week']);
    expect(viewFridge(stock, { query: 'dairy', today: TODAY }).length).toBe(stock.length);
  });
});

/* ------------------------------------------------------------------ */
/* Pure — input parsing                                                 */
/* ------------------------------------------------------------------ */

describe('healthFridgeStorage — input handling', () => {
  it('HEALTH-FRIDGE-010: quantity keeps digits and one separator', () => {
    expect(sanitizeQuantityInput('1a0b0')).toBe('100');
    expect(sanitizeQuantityInput('2.5.7')).toBe('2.57');
    expect(sanitizeQuantityInput('2,5')).toBe('2,5');
  });

  it('HEALTH-FRIDGE-011: a blank quantity is VALID and means "no quantity", not zero', () => {
    expect(parseQuantityInput('')).toEqual({ valid: true, quantity: null });
    expect(parseQuantityInput('  ')).toEqual({ valid: true, quantity: null });
    expect(parseQuantityInput('0')).toEqual({ valid: true, quantity: 0 });
    expect(parseQuantityInput('2,5')).toEqual({ valid: true, quantity: 2.5 });
    expect(parseQuantityInput('-1')).toEqual({ valid: false });
    expect(parseQuantityInput('99 bottles')).toEqual({ valid: false });
    expect(parseQuantityInput('9000000')).toEqual({ valid: false }); // past the column CHECK
  });

  it('HEALTH-FRIDGE-012: an impossible date is refused rather than rolled over', () => {
    expect(parseExpiryInput('2026-07-15')).toEqual({ valid: true, date: '2026-07-15' });
    expect(parseExpiryInput('')).toEqual({ valid: true, date: null });
    expect(parseExpiryInput('15/07/2026')).toEqual({ valid: false });
    // V8 parses 30 February happily as 2 March; storing it verbatim would sort
    // on the wrong side of the `<= cutoff` comparison the whole window uses.
    expect(parseExpiryInput('2026-02-30')).toEqual({ valid: false });
    expect(parseExpiryInput('2026-13-01')).toEqual({ valid: false });
  });

  it('HEALTH-FRIDGE-013: the expiry field takes only a day key, and quick picks resolve to dates', () => {
    // Digits and dashes only, capped at the length of a day key. Anything else
    // is DROPPED rather than translated — a silent `/`→`-` rewrite would let a
    // half-typed `15/07` become a date the user did not mean.
    expect(sanitizeExpiryInput('2026-07-15abc')).toBe('2026-07-15');
    expect(sanitizeExpiryInput('2026/07-15')).toBe('202607-15');
    expect(parseExpiryInput('202607-15')).toEqual({ valid: false });
    expect(sanitizeExpiryInput('2026-07-15-99')).toBe('2026-07-15');
    expect(quickPickDate(0, TODAY)).toBe(TODAY);
    expect(quickPickDate(7, TODAY)).toBe('2026-07-20');
    expect(quickPickDate(null, TODAY)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Wire mapping                                                         */
/* ------------------------------------------------------------------ */

describe('healthFridgeStorage — wire mapping', () => {
  it('HEALTH-FRIDGE-020: a wire row maps to the screen shape, nulls preserved', () => {
    expect(fromWireFridgeItem(row({ quantity: null, unit: null, category: null, notes: null })))
      .toEqual({
        id: 'fr_1',
        name: 'Milk',
        quantity: null,
        unit: null,
        // An uncategorised row is labelled, not blank.
        category: DEFAULT_FRIDGE_CATEGORY,
        expiryDate: '2026-07-15',
        isFavorite: false,
        notes: '',
        source: 'manual',
        // Macros are absent on a hand-typed row — `null`, not an empty object,
        // so the row renders without a "0 kcal" that nobody measured.
        nutrition: null,
        createdAt: ISO,
        updatedAt: ISO,
      });
  });

  it('HEALTH-FRIDGE-021: a create sends every field, so nothing is left to a server default', async () => {
    await createFridgeItem(draft({ name: '  Milk  ', notes: '  two litres  ' }));

    expect(api.createFridgeItem).toHaveBeenCalledWith({
      name: 'Milk',
      quantity: 1,
      unit: 'L',
      category: 'Dairy',
      expiry_date: '2026-07-15',
      is_favorite: false,
      notes: 'two litres',
    });
  });

  it('HEALTH-FRIDGE-022: an edit sends the NULLS too — an omitted key means "leave alone"', async () => {
    fakeFridgeServer([row()]);
    await updateFridgeItem('fr_1', draft({ expiryDate: null, notes: '', quantity: null }));

    expect(api.updateFridgeItem).toHaveBeenCalledWith('fr_1', {
      name: 'Milk',
      quantity: null,
      unit: 'L',
      category: 'Dairy',
      expiry_date: null,
      is_favorite: false,
      notes: null,
    });
  });

  it('HEALTH-FRIDGE-023: the star patches ONLY is_favorite, so nothing else can be clobbered', async () => {
    fakeFridgeServer([row()]);
    const result = await setFridgeFavorite('fr_1', true);

    expect(api.updateFridgeItem).toHaveBeenCalledWith('fr_1', { is_favorite: true });
    expect(result.items[0].isFavorite).toBe(true);
    expect(result.items[0].name).toBe('Milk');
  });
});

/* ------------------------------------------------------------------ */
/* Reads                                                                */
/* ------------------------------------------------------------------ */

describe('healthFridgeStorage — reads', () => {
  it('HEALTH-FRIDGE-030: the fridge loads newest-added first and caches the snapshot', async () => {
    fakeFridgeServer([
      row({ id: 'old', name: 'Rice', created_at: '2026-07-01T08:00:00.000Z' }),
      row({ id: 'new', name: 'Milk', created_at: '2026-07-12T08:00:00.000Z' }),
    ]);

    expect((await loadFridge()).map((i) => i.id)).toEqual(['new', 'old']);
    expect(healthSyncStateFor(HEALTH_FRIDGE_KEY)).toBe('synced');
    expect(await storageHelpers.getObject(HEALTH_FRIDGE_KEY)).not.toBeNull();
  });

  it('HEALTH-FRIDGE-031: the expiring window is asked of the SERVER, not recomputed', async () => {
    fakeFridgeServer([
      row({ id: 'gone', expiry_date: '2026-07-09' }),
      row({ id: 'later', expiry_date: '2026-12-01' }),
      row({ id: 'undated', expiry_date: null }),
    ]);

    const items = await loadExpiringSoon(7, TODAY);
    expect(api.listFridge).toHaveBeenCalledWith({ expiring_within_days: 7, today: TODAY });
    expect(items.map((i) => i.id)).toEqual(['gone']);
  });

  it('HEALTH-FRIDGE-032: offline, the window falls back to the SAME rule on the cached list', async () => {
    fakeFridgeServer([
      row({ id: 'gone', expiry_date: '2026-07-09' }),
      row({ id: 'later', expiry_date: '2026-12-01' }),
      row({ id: 'undated', expiry_date: null }),
    ]);
    await loadFridge(); // warm the cache while still online

    api.listFridge.mockRejectedValue(NETWORK_ERROR);
    expect((await loadExpiringSoon(7, TODAY)).map((i) => i.id)).toEqual(['gone']);
  });

  it('HEALTH-FRIDGE-033: a failed read serves the cache instead of blanking the screen', async () => {
    fakeFridgeServer([row({ id: 'fr_1' })]);
    await loadFridge();

    api.listFridge.mockRejectedValue(NETWORK_ERROR);
    expect((await loadFridge()).map((i) => i.id)).toEqual(['fr_1']);
    expect(healthSyncStateFor(HEALTH_FRIDGE_KEY)).toBe('offline');
  });

  it('HEALTH-FRIDGE-034: a corrupt cached snapshot falls back to empty rather than throwing', async () => {
    await storageHelpers.setObject(HEALTH_FRIDGE_KEY, { not: 'an array' });
    api.listFridge.mockRejectedValue(NETWORK_ERROR);

    await expect(loadFridge()).resolves.toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Writes — saved / offline / rejected                                  */
/* ------------------------------------------------------------------ */

describe('healthFridgeStorage — write outcomes', () => {
  it('HEALTH-FRIDGE-040: a saved write reports no message and returns the server list', async () => {
    const result = await createFridgeItem(draft({ name: 'Eggs' }));

    expect(result.status).toBe('saved');
    expect(result.message).toBeNull();
    expect(result.items.map((i) => i.name)).toEqual(['Eggs']);
  });

  it('HEALTH-FRIDGE-041: offline keeps the optimistic row and says so in plain words', async () => {
    __setHealthOfflineForTests(true);
    const result = await createFridgeItem(draft({ name: 'Eggs' }));

    expect(result.status).toBe('offline');
    expect(result.message).toBe(FRIDGE_OFFLINE_MESSAGE);
    expect(result.items.map((i) => i.name)).toEqual(['Eggs']);
    // No raw error string ever reaches the UI.
    expect(result.message).not.toContain('Network');
  });

  it('HEALTH-FRIDGE-042: a REFUSED write rolls the optimistic row back', async () => {
    fakeFridgeServer([row({ id: 'fr_1' })]);
    await loadFridge();
    api.updateFridgeItem.mockRejectedValue(httpError(404));

    const result = await updateFridgeItem('fr_1', draft({ name: 'Renamed' }));

    expect(result.status).toBe('rejected');
    expect(result.message).toBe(FRIDGE_MISSING_MESSAGE);
    expect(result.items.map((i) => i.name)).toEqual(['Milk']);
    // The rollback is persisted, so a cold start cannot resurrect the phantom.
    expect(await storageHelpers.getObject(HEALTH_FRIDGE_KEY)).toEqual(result.items);
  });

  it('HEALTH-FRIDGE-043: rejection copy is chosen by STATUS, never by the error message', () => {
    expect(fridgeRejectionMessageFor(httpError(404))).toBe(FRIDGE_MISSING_MESSAGE);
    expect(fridgeRejectionMessageFor(httpError(400))).toContain('Check the name');
    expect(fridgeRejectionMessageFor(httpError(401))).toContain('sign in again');
    // A server wobble and a lost connection behave the same: keep the row.
    expect(fridgeRejectionMessageFor(httpError(500))).toBeNull();
    expect(fridgeRejectionMessageFor(NETWORK_ERROR)).toBeNull();
    expect(fridgeRejectionMessageFor(new Error('ECONNRESET at 10.0.0.1'))).toBeNull();
  });

  it('HEALTH-FRIDGE-044: deleting removes the row and survives a re-read', async () => {
    fakeFridgeServer([row({ id: 'fr_1' }), row({ id: 'fr_2', name: 'Cheese' })]);
    await loadFridge();

    const result = await deleteFridgeItem('fr_1');
    expect(result.status).toBe('saved');
    expect(result.items.map((i) => i.id)).toEqual(['fr_2']);
    expect((await loadFridge()).map((i) => i.id)).toEqual(['fr_2']);
  });
});

/* ------------------------------------------------------------------ */
/* "Today" defaults                                                     */
/* ------------------------------------------------------------------ */

/**
 * Every date helper here takes `today` so the suite can pin the arithmetic, and
 * every SCREEN call site omits it. That default is what decides whether the
 * fridge is telling the user about the right day at all, and until now the
 * suite had never taken it once.
 */
describe('healthFridgeStorage — the defaulted "today"', () => {
  it('HEALTH-FRIDGE-045: every date helper defaults to the real current day', () => {
    expect(daysUntil('2026-07-20')).toBe(7);
    expect(daysUntil(TODAY)).toBe(0);
    expect(expiryBucketOf(TODAY)).toBe('today');
    expect(expiryBucketOf('2026-07-12')).toBe('expired');
    expect(formatExpiry('2026-07-14')).toBe('Expires tomorrow');
    expect(quickPickDate(7)).toBe('2026-07-20');
    expect(summarizeFridge([item({ expiryDate: TODAY })]).cutoff).toBe('2026-07-20');
    expect(groupByExpiry([item({ expiryDate: TODAY })])[0].bucket).toBe('today');
  });

  it('HEALTH-FRIDGE-046: the expiring window defaults to the 7 days the card announces', () => {
    // The screen's card says "on or before <cutoff>". If the defaulted window
    // were not the same 7 days, the copy would describe a different set than the
    // rows underneath it.
    const stock = [
      item({ id: 'gone', expiryDate: '2026-07-10' }),
      item({ id: 'edge', expiryDate: '2026-07-20' }),
      item({ id: 'later', expiryDate: '2026-08-01' }),
      item({ id: 'undated', expiryDate: null }),
    ];
    expect(expiringWithin(stock).map((i) => i.id)).toEqual(['gone', 'edge']);
    expect(viewFridge(stock).map((i) => i.id)).toEqual(stock.map((i) => i.id));
  });

  it('HEALTH-FRIDGE-047: loadExpiringSoon asks the server for TODAY when nothing is passed', async () => {
    const server = fakeFridgeServer([
      row({ id: 'fr_1', expiry_date: '2026-07-14' }),
      row({ id: 'fr_2', expiry_date: '2026-09-01' }),
    ]);

    expect((await loadExpiringSoon()).map((i) => i.id)).toEqual(['fr_1']);
    expect(api.listFridge).toHaveBeenLastCalledWith({ expiring_within_days: 7, today: TODAY });
    expect(server.rows).toHaveLength(2); // a read must not mutate the fridge
  });
});

/* ------------------------------------------------------------------ */
/* Malformed input and partial payloads                                 */
/* ------------------------------------------------------------------ */

describe('healthFridgeStorage — malformed input and partial payloads', () => {
  it('HEALTH-FRIDGE-048: an unparseable expiry reads as UNDATED, never as expired', () => {
    // A cached row written by an older build can carry a non-day-key string.
    // Bucketing it as `expired` would put "throw this out" next to food that is
    // perfectly fine; `undated` is the honest answer.
    expect(daysUntil('not-a-date', TODAY)).toBeNull();
    expect(expiryBucketOf('not-a-date', TODAY)).toBe('undated');
    expect(formatExpiry('not-a-date', TODAY)).toBe('No expiry date');
    expect(formatExpiry(null, TODAY)).toBe('No expiry date');
  });

  it('HEALTH-FRIDGE-049: a non-string in either field clears it instead of crashing', () => {
    // Both are controlled <TextInput>s; `.replace` and `.trim` on a non-string
    // throw, and the fridge form is the one place a user pastes into.
    expect(sanitizeQuantityInput(undefined as unknown as string)).toBe('');
    expect(sanitizeExpiryInput(undefined as unknown as string)).toBe('');
    expect(parseQuantityInput(null as unknown as string)).toEqual({ valid: false });
    expect(parseExpiryInput(null as unknown as string)).toEqual({ valid: false });
  });

  it('HEALTH-FRIDGE-050: a body with no `items` key reads as an empty fridge', async () => {
    api.listFridge.mockResolvedValue(body({} as never));
    expect(await loadFridge()).toEqual([]);
    expect(await loadExpiringSoon(7, TODAY)).toEqual([]);
  });

  it('HEALTH-FRIDGE-051: a row with no source is assumed manual', () => {
    // `source` distinguishes a hand-typed row from a scanned one. Defaulting it
    // to `manual` keeps a drifted row editable rather than locked as imported.
    const bare = row() as unknown as Record<string, unknown>;
    delete bare.source;
    expect(fromWireFridgeItem(bare as unknown as HealthFridgeItem).source).toBe('manual');
  });

  it('HEALTH-FRIDGE-052: undated rows sort by name, and a shared date breaks the tie by name', () => {
    // Both comparators fell into `''` for an undated row, so ordering was
    // decided by nothing at all — two undated items could swap between reads.
    const undated = groupByExpiry(
      [
        item({ id: 'c', name: 'Chives', expiryDate: null, createdAt: ISO, updatedAt: ISO }),
        item({ id: 'a', name: 'Anchovies', expiryDate: null, createdAt: ISO, updatedAt: ISO }),
      ],
      TODAY
    );
    expect(undated[0].bucket).toBe('undated');

    // Same date → the name decides, so the list is stable read to read.
    const sameDay = groupByExpiry(
      [
        item({ id: 'z', name: 'Zucchini', expiryDate: '2026-07-15' }),
        item({ id: 'b', name: 'Butter', expiryDate: '2026-07-15' }),
      ],
      TODAY
    );
    expect(sameDay[0].items.map((i) => i.name)).toEqual(['Butter', 'Zucchini']);
  });

  it('HEALTH-FRIDGE-053: a blank unit or category is stored as null / the default, not as ""', async () => {
    // An empty string in `unit` would render as a dangling separator ("2 · ")
    // and an empty `category` would make the search-by-category path match
    // everything. Both are normalised at the write.
    const server = fakeFridgeServer();

    const created = await createFridgeItem(draft({ name: 'Loose eggs', unit: '', category: '' }));

    expect(api.createFridgeItem).toHaveBeenCalledWith(
      expect.objectContaining({ unit: null, category: null })
    );
    // The optimistic row the screen shows agrees with what was sent.
    expect(created.items[0]).toMatchObject({ unit: null, category: DEFAULT_FRIDGE_CATEGORY });
    expect(server.rows[0].name).toBe('Loose eggs');

    // Whitespace-only is the same answer — a " " unit would print "2 · " forever.
    await createFridgeItem(draft({ name: 'Loose eggs', unit: '   ', category: '  ' }));
    expect(api.createFridgeItem).toHaveBeenLastCalledWith(
      expect.objectContaining({ unit: null, category: null })
    );
  });

  it('HEALTH-FRIDGE-054: an edit blanks the unit and leaves every OTHER row alone', async () => {
    fakeFridgeServer([row({ id: 'fr_1' }), row({ id: 'fr_2', name: 'Cheese', unit: 'g' })]);
    await loadFridge();

    const result = await updateFridgeItem('fr_1', draft({ unit: '', category: '' }));

    expect(api.updateFridgeItem).toHaveBeenCalledWith(
      'fr_1',
      expect.objectContaining({ unit: null, category: null })
    );
    // The row that was NOT edited keeps its own unit.
    expect(result.items.find((i) => i.id === 'fr_2')).toMatchObject({ unit: 'g' });
  });

  it('HEALTH-FRIDGE-055: starring one row leaves every other row unstarred', async () => {
    fakeFridgeServer([row({ id: 'fr_1' }), row({ id: 'fr_2', name: 'Cheese' })]);
    await loadFridge();

    const result = await setFridgeFavorite('fr_2', true);

    expect(result.items.filter((i) => i.isFavorite).map((i) => i.id)).toEqual(['fr_2']);
  });

  it('HEALTH-FRIDGE-057: an UNDATED row inside the server window still sorts deterministically', async () => {
    // The deployed `?expiring_within_days=` excludes undated rows. If the Worker
    // ever returns one anyway, sorting must not depend on `undefined` — the
    // fridge would reorder itself between reads for no visible reason.
    api.listFridge.mockResolvedValue(
      body({
        items: [
          row({ id: 'zebra', name: 'Zucchini', expiry_date: null }),
          row({ id: 'dated', name: 'Milk', expiry_date: '2026-07-14' }),
          row({ id: 'apple', name: 'Anchovies', expiry_date: null }),
        ],
      })
    );

    const window = await loadExpiringSoon(7, TODAY);

    // Undated rows sort as "no date" — before every dated one — and tie-break by
    // NAME so the order is stable.
    expect(window.map((i) => i.id)).toEqual(['apple', 'zebra', 'dated']);
  });

  it('HEALTH-FRIDGE-056: an unmapped refusal still answers in our own words', () => {
    // 4xx codes the fridge routes do not document (409, 418, 429…) must still
    // resolve to one of OUR sentences — never the axios message.
    for (const status of [409, 418, 429]) {
      const message = fridgeRejectionMessageFor(httpError(status));
      expect(message).toBe('That could not be saved. Please check the details and try again.');
      expect(message).not.toContain('Request failed');
    }
  });
});
