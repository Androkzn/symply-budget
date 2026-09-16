/**
 * `localNutritionApi` — the Wave A `nutritionEntries` facade (He3b, plan §7).
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * Every test here runs in **airplane mode**: `@api/client` is replaced by a
 * transport that records the call and rejects, and `globalThis.fetch` is
 * replaced by one that does the same. An `afterEach` asserts nothing reached
 * either. That is not decoration — the whole claim of He3 is that a Health
 * device works with the network hard-down, and a facade that quietly falls back
 * to the server would otherwise pass a suite that only checked return values.
 *
 * The four properties asserted, in the order the plan cares about them:
 *
 *  1. **Create / modify / delete / read, offline.** Including the two writes
 *     nothing else in the fleet has: the basis re-derivation on `update` and the
 *     stored-basis re-portioning.
 *  2. **Tombstones.** A deleted meal is gone from every read and still present
 *     in the ledger, because the tombstone is what stops a peer device
 *     resurrecting it.
 *  3. **The read window actually bounds the result.** The window comes from
 *     `HEALTH_READ_WINDOWS`, and so does the number these tests assert against —
 *     a suite that hard-codes 120 would pass after someone edited the registry.
 *  4. **The refusals carry the Worker's shape.** `no_basis` is a 400 with a
 *     machine code, and `healthNutritionStorage.ts:460-466` reads both halves to
 *     decide whether to roll an optimistic portion back.
 */
const mockNetworkCalls: string[] = [];

jest.mock('@api/client', () => {
  const fail = (verb: string) => (url?: unknown) => {
    mockNetworkCalls.push(`${verb} ${String(url)}`);
    const error = new Error('airplane mode: this device has no network') as Error & {
      code: string;
    };
    error.code = 'ERR_NETWORK';
    return Promise.reject(error);
  };
  const client = {
    get: fail('GET'),
    post: fail('POST'),
    put: fail('PUT'),
    patch: fail('PATCH'),
    delete: fail('DELETE'),
    request: fail('REQUEST'),
  };
  return { __esModule: true, apiClient: client, api: client, default: client };
});

import { closeLocalHealthSession, openLocalHealthSessionForTests } from '../engine';
import { localDateKey } from '../ids';
import { localNutritionApi } from '../localNutritionApi';
import { activeUserId, allRowsOf, ledger, nowIso, writeLocalBulk } from '../localWrite';
import type { LocalNutritionEntry } from '../types';
import { HEALTH_READ_WINDOWS, maxDaysForWindow } from '../windows';

/* ------------------------------------------------------------------ */
/* Airplane mode                                                       */
/* ------------------------------------------------------------------ */

const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = ((input?: unknown) => {
    mockNetworkCalls.push(`FETCH ${String(input)}`);
    return Promise.reject(new Error('airplane mode: this device has no network'));
  }) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(async () => {
  mockNetworkCalls.length = 0;
  await openLocalHealthSessionForTests({ userId: 'user_nutrition_test' });
});

afterEach(async () => {
  // The load-bearing assertion of the whole file: not one byte left the device.
  expect(mockNetworkCalls).toEqual([]);
  await closeLocalHealthSession();
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD`, N days back from now — the same arithmetic the window uses. */
function dayKey(daysAgo: number): string {
  return localDateKey(new Date(Date.now() - daysAgo * DAY_MS));
}

/**
 * A ledger row written straight through the kernel.
 *
 * Seeding through `writeLocalBulk` rather than through the facade is deliberate
 * for two cases the facade cannot produce: a row with NO per-100 basis (every
 * `createNutrition` derives one), and a row dated years back. Both are rows a
 * peer device or a restored checkpoint legitimately delivers.
 */
function seedRow(overrides: Partial<LocalNutritionEntry> & { date: string }): LocalNutritionEntry {
  const timestamp = overrides.created_at ?? nowIso();
  return {
    id: `n_seed_${overrides.date}_${Math.random().toString(36).slice(2, 8)}`,
    user_id: activeUserId(),
    food_name: 'Seeded food',
    portion: 1,
    unit: 'serving',
    meal_type: 'lunch',
    calories: 100,
    proteins: 1,
    carbohydrates: 2,
    fats: 3,
    food_id: null,
    base_calories_per_100: 100,
    base_proteins_per_100: 1,
    base_carbs_per_100: 2,
    base_fats_per_100: 3,
    detected_category: null,
    is_processed: 1,
    source_recipe_id: null,
    source: 'manual',
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
    ...overrides,
  };
}

async function seed(rows: LocalNutritionEntry[]): Promise<void> {
  await writeLocalBulk(
    rows,
    (draft, chunk) => {
      draft.nutritionEntries.push(...chunk);
    },
    (chunk) => ({
      opType: 'TEST_SEED',
      entityType: 'nutrition_entry',
      entityId: chunk[0]!.id,
      payload: { count: chunk.length },
    }),
  );
}

/* ------------------------------------------------------------------ */
/* 1. Create / modify / delete / read, with the network hard-down      */
/* ------------------------------------------------------------------ */

describe('localNutritionApi — airplane mode CRUD', () => {
  it('creates a meal with the route’s own coalesced defaults', async () => {
    const { entry } = await localNutritionApi.createNutrition({
      date: dayKey(0),
      food_name: 'Porridge',
      meal_type: 'breakfast',
      calories: 250,
    });

    expect(entry.portion).toBe(1);
    expect(entry.unit).toBe('serving');
    expect(entry.proteins).toBe(0);
    expect(entry.carbohydrates).toBe(0);
    expect(entry.fats).toBe(0);
    expect(entry.source).toBe('manual');
    expect(entry.food_id).toBeNull();
    expect(entry.deleted_at).toBeNull();
    expect(entry.user_id).toBe('user_nutrition_test');
    // Derived from (macros, portion) — the service's third basis rule, which is
    // the only one reachable on device.
    expect(entry.base_calories_per_100).toBe(25000);
  });

  it('reads back what it wrote', async () => {
    const date = dayKey(0);
    await localNutritionApi.createNutrition({
      date,
      food_name: 'Porridge',
      meal_type: 'breakfast',
      calories: 250,
    });

    const { entries } = await localNutritionApi.listNutrition({ date });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.food_name).toBe('Porridge');
  });

  it('never projects the three columns the wire type has never carried', async () => {
    const { entry } = await localNutritionApi.createNutrition({
      date: dayKey(0),
      food_name: 'Porridge',
      meal_type: 'breakfast',
      calories: 250,
    });

    const asRecord = entry as unknown as Record<string, unknown>;
    expect(asRecord.detected_category).toBeUndefined();
    expect(asRecord.is_processed).toBeUndefined();
    expect(asRecord.source_recipe_id).toBeUndefined();
  });

  it('orders a day oldest-first, as the route does (created_at ASC)', async () => {
    const date = dayKey(0);
    await seed([
      seedRow({ date, food_name: 'first', created_at: '2026-08-14T08:00:00.000Z' }),
      seedRow({ date, food_name: 'second', created_at: '2026-08-14T12:00:00.000Z' }),
      seedRow({ date, food_name: 'third', created_at: '2026-08-14T19:00:00.000Z' }),
    ]);

    const { entries } = await localNutritionApi.listNutrition({ date });
    expect(entries.map((e) => e.food_name)).toEqual(['first', 'second', 'third']);
  });

  it('patches an entry and RE-DERIVES the per-100 basis', async () => {
    const date = dayKey(0);
    const { entry } = await localNutritionApi.createNutrition({
      date,
      food_name: 'Rice',
      meal_type: 'dinner',
      calories: 300,
      portion: 100,
      unit: 'g',
    });
    expect(entry.base_calories_per_100).toBe(300);

    const updated = await localNutritionApi.updateNutrition(entry.id, { calories: 400 });

    expect(updated.entry.calories).toBe(400);
    // The basis is the statement "this food is X per 100" — editing the macros
    // changes it, or the next re-portioning silently undoes the correction.
    expect(updated.entry.base_calories_per_100).toBe(400);
    expect(updated.entry.id).toBe(entry.id);
    expect(updated.entry.created_at).toBe(entry.created_at);
  });

  it('leaves the basis alone when the patch touches no macro', async () => {
    const { entry } = await localNutritionApi.createNutrition({
      date: dayKey(0),
      food_name: 'Rice',
      meal_type: 'dinner',
      calories: 300,
      portion: 100,
    });

    const updated = await localNutritionApi.updateNutrition(entry.id, { food_name: 'Brown rice' });

    expect(updated.entry.food_name).toBe('Brown rice');
    expect(updated.entry.base_calories_per_100).toBe(entry.base_calories_per_100);
  });

  it('never invents a basis for a row that has none', async () => {
    const date = dayKey(0);
    await seed([
      seedRow({
        date,
        id: 'n_legacy',
        base_calories_per_100: null,
        base_proteins_per_100: null,
        base_carbs_per_100: null,
        base_fats_per_100: null,
      }),
    ]);

    const updated = await localNutritionApi.updateNutrition('n_legacy', { calories: 999 });

    expect(updated.entry.calories).toBe(999);
    expect(updated.entry.base_calories_per_100).toBeNull();
  });

  it('re-portions from the STORED basis, not from the figures on the row', async () => {
    const { entry } = await localNutritionApi.createNutrition({
      date: dayKey(0),
      food_name: 'Rice',
      meal_type: 'dinner',
      calories: 130,
      proteins: 2.7,
      carbohydrates: 28,
      fats: 0.3,
      portion: 100,
      unit: 'g',
    });

    const first = await localNutritionApi.reportionNutrition(entry.id, { portion: 150 });
    expect(first.entry.calories).toBe(195);
    expect(first.entry.portion).toBe(150);

    // Re-portioning back is EXACT, because it re-derives from the untouched
    // basis rather than scaling the already-rounded 195.
    const back = await localNutritionApi.reportionNutrition(entry.id, { portion: 100 });
    expect(back.entry.calories).toBe(130);
    expect(back.entry.proteins).toBe(2.7);
    expect(back.entry.carbohydrates).toBe(28);
    expect(back.entry.fats).toBe(0.3);
  });

  it('keeps the stored unit when the re-portion does not send one', async () => {
    const { entry } = await localNutritionApi.createNutrition({
      date: dayKey(0),
      food_name: 'Rice',
      meal_type: 'dinner',
      calories: 130,
      portion: 100,
      unit: 'g',
    });

    const { entry: next } = await localNutritionApi.reportionNutrition(entry.id, { portion: 50 });
    expect(next.unit).toBe('g');
  });

  it('deletes a meal', async () => {
    const date = dayKey(0);
    const { entry } = await localNutritionApi.createNutrition({
      date,
      food_name: 'Cake',
      meal_type: 'snack',
      calories: 400,
    });

    await expect(localNutritionApi.deleteNutrition(entry.id)).resolves.toEqual({ deleted: true });
    await expect(localNutritionApi.listNutrition({ date })).resolves.toEqual({ entries: [] });
  });
});

/* ------------------------------------------------------------------ */
/* 2. Tombstones                                                       */
/* ------------------------------------------------------------------ */

describe('localNutritionApi — tombstones', () => {
  it('tombstones rather than splices, so a peer cannot resurrect the row', async () => {
    const date = dayKey(0);
    const { entry } = await localNutritionApi.createNutrition({
      date,
      food_name: 'Cake',
      meal_type: 'snack',
      calories: 400,
    });

    await localNutritionApi.deleteNutrition(entry.id);

    const stored = allRowsOf<LocalNutritionEntry>('nutritionEntries');
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe(entry.id);
    expect(stored[0]!.deleted_at).not.toBeNull();
    expect(stored[0]!.updated_at).toBe(stored[0]!.deleted_at);
  });

  it('refuses a second delete with the Worker’s 404 shape', async () => {
    const { entry } = await localNutritionApi.createNutrition({
      date: dayKey(0),
      food_name: 'Cake',
      meal_type: 'snack',
      calories: 400,
    });
    await localNutritionApi.deleteNutrition(entry.id);

    // A bare Error carries no `response.status`, which `writeThrough` reads as a
    // lost connection — and re-queues the delete of an already-gone row forever.
    await expect(localNutritionApi.deleteNutrition(entry.id)).rejects.toMatchObject({
      response: { status: 404, data: { error: { code: 'not_found' } } },
    });
  });

  it('refuses an unknown id', async () => {
    await expect(localNutritionApi.deleteNutrition('n_nope')).rejects.toMatchObject({
      response: { status: 404 },
    });
  });

  it('treats a tombstoned row as absent for update and reportion', async () => {
    const { entry } = await localNutritionApi.createNutrition({
      date: dayKey(0),
      food_name: 'Cake',
      meal_type: 'snack',
      calories: 400,
      portion: 100,
    });
    await localNutritionApi.deleteNutrition(entry.id);

    // An edit that landed on a tombstone would bump `updated_at` and re-deliver
    // a deleted row through the delta pull with different macros.
    await expect(
      localNutritionApi.updateNutrition(entry.id, { calories: 1 }),
    ).rejects.toMatchObject({ response: { status: 404 } });
    await expect(
      localNutritionApi.reportionNutrition(entry.id, { portion: 50 }),
    ).rejects.toMatchObject({ response: { status: 404 } });
  });

  it('never copies a tombstoned source row forward', async () => {
    const from = dayKey(1);
    const to = dayKey(0);
    const keep = await localNutritionApi.createNutrition({
      date: from,
      food_name: 'Kept',
      meal_type: 'lunch',
      calories: 100,
    });
    const drop = await localNutritionApi.createNutrition({
      date: from,
      food_name: 'Dropped',
      meal_type: 'lunch',
      calories: 200,
    });
    await localNutritionApi.deleteNutrition(drop.entry.id);

    const { entries } = await localNutritionApi.copyNutritionDay({ from_date: from, to_date: to });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.food_name).toBe('Kept');
    expect(entries[0]!.id).not.toBe(keep.entry.id);
  });
});

/* ------------------------------------------------------------------ */
/* 3. The read windows                                                 */
/* ------------------------------------------------------------------ */

describe('localNutritionApi — read windows', () => {
  /** The registry is the source of the number, so an edit there fails here. */
  const MEALS_DAYS = maxDaysForWindow(HEALTH_READ_WINDOWS.loadMeals.reads[0].window)!;

  it('caps an unparameterised read at `loadMeals`’ window, not the whole table', async () => {
    const seeded = Array.from({ length: MEALS_DAYS * 2 }, (_, index) =>
      seedRow({ date: dayKey(index) }),
    );
    await seed(seeded);

    const { entries } = await localNutritionApi.listNutrition({});

    const cutoff = localDateKey(new Date(Date.now() - MEALS_DAYS * DAY_MS));
    expect(entries.length).toBeLessThan(seeded.length);
    expect(entries.length).toBeLessThanOrEqual(MEALS_DAYS + 1);
    expect(entries.every((entry) => entry.date >= cutoff)).toBe(true);
  });

  it('serves exactly one day when the caller pins a date', async () => {
    await seed([
      seedRow({ date: dayKey(0) }),
      seedRow({ date: dayKey(0) }),
      seedRow({ date: dayKey(1) }),
      seedRow({ date: dayKey(2) }),
    ]);

    const { entries } = await localNutritionApi.listNutrition({ date: dayKey(0) });
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.date === dayKey(0))).toBe(true);
  });

  it('serves one day when from === to, however far back it is', async () => {
    // Paging backwards through Meals must not fall off the 120-day cliff.
    const old = dayKey(MEALS_DAYS * 3);
    await seed([seedRow({ date: old }), seedRow({ date: dayKey(0) })]);

    const { entries } = await localNutritionApi.listNutrition({ from: old, to: old });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.date).toBe(old);
  });

  it('reproduces the route’s from/to WHERE clause', async () => {
    await seed([
      seedRow({ date: dayKey(1) }),
      seedRow({ date: dayKey(5) }),
      seedRow({ date: dayKey(9) }),
    ]);

    const { entries } = await localNutritionApi.listNutrition({ from: dayKey(6), to: dayKey(2) });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.date).toBe(dayKey(5));
  });

  it('honours the He11 drain’s caller-supplied range past the 120-day meal window', async () => {
    // `healthKitImportSink.listExistingNutrition` is a registered `callerRange`
    // window with no row cap — because the drain reads to PLAN its import, and
    // an under-read there is a duplicate row rather than a missing one.
    const deep = dayKey(MEALS_DAYS + 40);
    await seed([seedRow({ date: deep }), seedRow({ date: dayKey(0) })]);

    const { entries } = await localNutritionApi.listNutrition({
      from: dayKey(MEALS_DAYS + 60),
      to: dayKey(MEALS_DAYS + 20),
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.date).toBe(deep);
  });

  it('drops tombstoned rows from every read', async () => {
    const date = dayKey(0);
    await seed([
      seedRow({ date, id: 'n_live' }),
      seedRow({ date, id: 'n_dead', deleted_at: nowIso() }),
    ]);

    const day = await localNutritionApi.listNutrition({ date });
    const all = await localNutritionApi.listNutrition({});
    expect(day.entries.map((e) => e.id)).toEqual(['n_live']);
    expect(all.entries.map((e) => e.id)).toEqual(['n_live']);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Refusal shapes                                                   */
/* ------------------------------------------------------------------ */

describe('localNutritionApi — refusals carry the Worker’s shape', () => {
  it('answers 400 `no_basis` for a row with no stored basis', async () => {
    await seed([
      seedRow({
        date: dayKey(0),
        id: 'n_typed',
        base_calories_per_100: null,
        base_proteins_per_100: null,
        base_carbs_per_100: null,
        base_fats_per_100: null,
      }),
    ]);

    // `isNoBasisError` (`healthNutritionStorage.ts:460-466`) reads BOTH halves,
    // and rolls the optimistic portion back only on that exact pair.
    await expect(
      localNutritionApi.reportionNutrition('n_typed', { portion: 50 }),
    ).rejects.toMatchObject({
      response: { status: 400, data: { error: { code: 'no_basis' } } },
    });
  });

  it('leaves the row untouched when it refuses', async () => {
    await seed([
      seedRow({ date: dayKey(0), id: 'n_typed', portion: 1, base_calories_per_100: null }),
    ]);

    await expect(
      localNutritionApi.reportionNutrition('n_typed', { portion: 50 }),
    ).rejects.toBeDefined();

    const stored = allRowsOf<LocalNutritionEntry>('nutritionEntries').find(
      (row) => row.id === 'n_typed',
    );
    expect(stored!.portion).toBe(1);
  });

  it('answers 404 for an unknown id on every write verb', async () => {
    await expect(localNutritionApi.updateNutrition('nope', { calories: 1 })).rejects.toMatchObject({
      response: { status: 404 },
    });
    await expect(
      localNutritionApi.reportionNutrition('nope', { portion: 1 }),
    ).rejects.toMatchObject({ response: { status: 404 } });
  });
});

/* ------------------------------------------------------------------ */
/* 5. The bulk paths                                                   */
/* ------------------------------------------------------------------ */

describe('localNutritionApi — bulk writes', () => {
  it('writes a whole copied day as ONE op, not one per row', async () => {
    const before = ledger().ops.length;

    const { entries } = await localNutritionApi.bulkCreateNutrition({
      entries: Array.from({ length: 12 }, (_, index) => ({
        date: dayKey(0),
        food_name: `Item ${index}`,
        meal_type: 'dinner' as const,
        calories: 100 + index,
      })),
    });

    expect(entries).toHaveLength(12);
    // `mutateLocalHealthLedger` re-captures and re-diffs the WHOLE ledger per
    // call, so twelve writes would be twelve full-ledger diffs.
    expect(ledger().ops.length - before).toBe(1);
    expect(new Set(entries.map((e) => e.id)).size).toBe(12);
  });

  it('writes nothing at all for an empty bulk', async () => {
    const before = ledger().ops.length;
    await expect(localNutritionApi.bulkCreateNutrition({ entries: [] })).resolves.toEqual({
      entries: [],
    });
    expect(ledger().ops.length).toBe(before);
  });

  it('copies a day forward with new ids, carrying provenance and basis', async () => {
    const from = dayKey(1);
    const to = dayKey(0);
    await seed([
      seedRow({
        date: from,
        id: 'n_source',
        food_name: 'Rice',
        meal_type: 'lunch',
        portion: 150,
        unit: 'g',
        calories: 195,
        food_id: 'food_rice',
        base_calories_per_100: 130,
        base_proteins_per_100: 2.7,
        base_carbs_per_100: 28,
        base_fats_per_100: 0.3,
      }),
    ]);

    const { entries } = await localNutritionApi.copyNutritionDay({ from_date: from, to_date: to });

    expect(entries).toHaveLength(1);
    const copy = entries[0]!;
    expect(copy.id).not.toBe('n_source');
    expect(copy.date).toBe(to);
    expect(copy.food_id).toBe('food_rice');
    // Yesterday's 150 g of rice must still be re-portionable after the copy.
    expect(copy.base_calories_per_100).toBe(130);
    expect(copy.calories).toBe(195);
    expect(copy.portion).toBe(150);
    expect(copy.unit).toBe('g');
  });

  it('APPENDS — the target day keeps what was already there', async () => {
    const from = dayKey(1);
    const to = dayKey(0);
    await seed([seedRow({ date: from, food_name: 'Copied' })]);
    await localNutritionApi.createNutrition({
      date: to,
      food_name: 'Already there',
      meal_type: 'breakfast',
      calories: 100,
    });

    await localNutritionApi.copyNutritionDay({ from_date: from, to_date: to });

    const { entries } = await localNutritionApi.listNutrition({ date: to });
    expect(entries.map((e) => e.food_name).sort()).toEqual(['Already there', 'Copied']);
  });

  it('narrows by from_slot and re-files into to_slot', async () => {
    const from = dayKey(1);
    const to = dayKey(0);
    await seed([
      seedRow({ date: from, food_name: 'Soup', meal_type: 'lunch' }),
      seedRow({ date: from, food_name: 'Toast', meal_type: 'breakfast' }),
    ]);

    const { entries } = await localNutritionApi.copyNutritionDay({
      from_date: from,
      to_date: to,
      from_slot: 'lunch',
      to_slot: 'dinner',
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.food_name).toBe('Soup');
    expect(entries[0]!.meal_type).toBe('dinner');
  });

  it('does not carry `source` onto a copy — the service omits it', async () => {
    const from = dayKey(1);
    await seed([seedRow({ date: from, source: 'healthkit' })]);

    const { entries } = await localNutritionApi.copyNutritionDay({
      from_date: from,
      to_date: dayKey(0),
    });

    expect(entries[0]!.source).toBe('manual');
  });

  it('copies an empty day without writing an op', async () => {
    const before = ledger().ops.length;
    await expect(
      localNutritionApi.copyNutritionDay({ from_date: dayKey(9), to_date: dayKey(0) }),
    ).resolves.toEqual({ entries: [] });
    expect(ledger().ops.length).toBe(before);
  });
});
