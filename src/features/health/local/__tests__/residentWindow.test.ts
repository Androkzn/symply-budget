/**
 * **He10 §4 — the resident window, and the proof that it is a mitigation
 * rather than data loss.**
 *
 * The cold-open lever measured in
 * `documents/engineering/testing/health-local-first-scale-baseline.md` is
 * blunt: 86.2% of first paint is 66,067 per-row AES-256-GCM opens in pure JS,
 * so the only thing that moves the number is opening fewer rows. Health
 * therefore sets `residentWindowDays` (`local/projection.ts`) and a cold open
 * decrypts ~420 days instead of ten years.
 *
 * That flag, on its own, would be the §1.3 failure mode wearing a stopwatch:
 * *"a cold open that is fast because the data is gone is not a mitigation."*
 * The contract this file exists to pin is the opposite one, stated as a single
 * sentence and asserted from four directions:
 *
 * > **A windowed ledger answers with exactly the rows an unwindowed one would.
 * > The window changes WHEN a row is decrypted, never WHETHER it can be seen.**
 *
 *  1. **The window is real** — a cold open installs a fraction of the rows, and
 *     the rest are still sealed on disk (`§ what a cold open installs`).
 *  2. **Reads widen it** — every facade that can address a date or a row count
 *     outside the window hydrates before it answers, so the answer is
 *     byte-identical to the fully-resident one (`§ a read that misses`).
 *  3. **Merges widen it FIRST** — the case that would be silent, permanent loss
 *     rather than a short answer: a peer patches a row this device did not
 *     load, `applyLedgerDelta` finds no target, parks the patch as an orphan,
 *     and `collectRowWrites` then persists `row: null` over the real sealed
 *     body (`§ convergence`).
 *  4. **The always-resident sets stay resident** and **tombstones stay
 *     absorbing**, both of which the window must not be able to break
 *     (`§ what is never windowed`).
 *
 * ## Why the sessions here are opened twice
 *
 * `openLocalHealthSessionForTests` MINTS a ledger in memory: it is fully
 * resident by construction and a window has nothing to leave out. Every test
 * below seeds through the real write path and then calls
 * `reopenLocalHealthSessionForTests`, which re-runs `buildSessionFromDisk` +
 * `hydrateSession` over the same store — the actual cold-open code path, minus
 * the SecureStore and native-SQLite steps Jest cannot run.
 *
 * ## Dates
 *
 * The corpus is anchored on a FIXED day and the clock is faked to match, so
 * "inside the window" and "outside the window" mean the same thing in January
 * as in July. A suite that used the real clock would drift across a month
 * boundary and start asserting a different window than the one it seeded.
 *
 * Static imports only: `await import()` throws under this Jest config.
 */
import {
  aeadEncrypt,
  canonicalSignBytes,
  createOpId,
  generateDeviceIdentity,
  signDetached,
  utf8Encode,
  LOCAL_FIRST_PROTOCOL_VERSION,
  LOCAL_FIRST_SCHEMA_VERSION,
  type StoredOperation,
} from '@symply/local-first';

import {
  closeLocalHealthSession,
  getLocalHealthHouseholdKeys,
  getLocalHealthLedger,
  getLocalHealthOpLog,
  getLocalHealthResidentBucketsForTests,
  getLocalHealthStore,
  mutateLocalHealthLedger,
  openLocalHealthSessionForTests,
  reopenLocalHealthSessionForTests,
} from '../engine';
import { localBodyApi } from '../localBodyApi';
import { localEntriesApi } from '../localEntriesApi';
import { localHabitsApi } from '../localHabitsApi';
import { localNutritionApi } from '../localNutritionApi';
import { localSummariesApi } from '../localSummariesApi';
import { localWaterApi } from '../localWaterApi';
import { localWeightApi } from '../localWeightApi';
import { allRowsOf, rowsOf } from '../localWrite';
import { encodeLedgerOpPayload, residentBuckets, type LedgerDelta } from '../projection';
import { HEALTH_RESIDENT_WINDOW_DAYS } from '../schema';
import type {
  LocalHabitLog,
  LocalNutritionEntry,
  LocalUserHabit,
  LocalWeightEntry,
} from '../types';
import { HEALTH_READ_WINDOWS, HEALTH_LOADER_NAMES, maxDaysForWindow } from '../windows';

const USER = 'user_health_window';

/** The day every test pretends it is. Mid-month, so no boundary is special. */
const TODAY = '2026-08-14';
const TODAY_MS = Date.parse(`${TODAY}T12:00:00.000Z`);

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD`, `days` before {@link TODAY}. */
function daysAgo(days: number): string {
  return new Date(TODAY_MS - days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Three years back — the plan's own phrasing for what must still be visible. */
const ANCIENT_DAY = daysAgo(365 * 3);
const MIDDLE_DAY = daysAgo(500);

let fetchSpy: jest.Mock;

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(TODAY_MS);
  fetchSpy = jest.fn(() => Promise.reject(new Error('airplane mode: network is off')));
  (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy;
  await openLocalHealthSessionForTests({ userId: USER });
});

afterEach(async () => {
  expect(fetchSpy).not.toHaveBeenCalled();
  await closeLocalHealthSession();
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Seeding — one op per table, never one per row                       */
/* ------------------------------------------------------------------ */

/**
 * Push rows straight through `mutateLocalHealthLedger` in ONE op per call.
 *
 * `writeLocalBulk` would be the product path, but every facade write captures
 * and diffs the whole ledger, so seeding a few hundred rows one facade call at
 * a time is quadratic and this suite would take minutes. The rows land through
 * the same diff → op → seal → `putRows` path either way; only the batching
 * differs.
 */
async function seed(mutator: (ledger: ReturnType<typeof getLocalHealthLedger>) => void) {
  await mutateLocalHealthLedger(mutator, {
    opType: 'TEST_SEED',
    entityType: 'household',
    entityId: 'seed',
    payload: {},
  });
}

function weightRow(date: string, weight: number): LocalWeightEntry {
  return {
    id: `wgt_${date}_${weight}`,
    user_id: USER,
    date,
    weight,
    unit: 'kg',
    note: null,
    source: 'manual',
    created_at: `${date}T07:00:00.000Z`,
    updated_at: `${date}T07:00:00.000Z`,
    deleted_at: null,
  } as LocalWeightEntry;
}

function mealRow(date: string, name: string): LocalNutritionEntry {
  return {
    id: `nut_${date}_${name}`,
    user_id: USER,
    date,
    food_name: name,
    portion: 100,
    unit: 'g',
    meal_type: 'lunch',
    calories: 400,
    proteins: 20,
    carbohydrates: 40,
    fats: 12,
    source: 'manual',
    created_at: `${date}T12:00:00.000Z`,
    updated_at: `${date}T12:00:00.000Z`,
    deleted_at: null,
  } as unknown as LocalNutritionEntry;
}

/**
 * A diary spanning four years: one weigh-in and one meal a day, thinned to
 * every fourth day so the suite stays fast while still crossing ~49 month
 * buckets — far more than the ~15 the window covers.
 */
async function seedFourYearDiary(): Promise<void> {
  const days: string[] = [];
  for (let d = 0; d <= 365 * 4; d += 4) days.push(daysAgo(d));
  await seed((ledger) => {
    for (const day of days) {
      ledger.weightEntries.push(weightRow(day, 80));
      ledger.nutritionEntries.push(mealRow(day, 'Lentil soup'));
    }
  });
}

/* ------------------------------------------------------------------ */
/* A peer device, so convergence can be asserted rather than assumed   */
/* ------------------------------------------------------------------ */

/** A peer stamp that BEATS anything this device wrote at the faked "now". */
const PEER_WINS_MS = TODAY_MS + 5_000;
/** A peer stamp that loses to it. */
const PEER_LOSES_MS = TODAY_MS - 3_600_000;

/**
 * Seal, sign and apply one op as if it had arrived from the member's OTHER
 * device.
 *
 * Built by hand rather than through a second engine: this suite needs an op
 * that patches a row the LOCAL device deliberately did not load, and the only
 * honest way to produce one is the wire format — HDK-sealed payload,
 * Ed25519-signed over `canonicalSignBytes`, applied through
 * `OpLog.applyRemote`. Anything short of that would bypass `projectionFor`,
 * which is where the hydrate-before-merge guard lives and therefore the only
 * thing worth testing here.
 */
async function applyPeerDelta(delta: LedgerDelta, atMs: number): Promise<void> {
  const opLog = getLocalHealthOpLog();
  const keys = getLocalHealthHouseholdKeys();
  const peer = generateDeviceIdentity('dev_peer_tablet');
  const householdId = getLocalHealthLedger().household.id;
  const opId = createOpId();
  const hlc = `${String(atMs).padStart(15, '0')}-0000-devpeert`;
  const payload = aeadEncrypt(
    keys.hdk,
    utf8Encode(JSON.stringify(encodeLedgerOpPayload({}, delta))),
    utf8Encode(`${householdId}:${keys.keyEpoch}:${opId}`),
  );
  const base = {
    opId,
    householdId,
    deviceId: peer.deviceId,
    authorMemberId: peer.deviceId,
    hlc,
    seq: 1,
    parentsJson: '[]',
    opType: 'PEER_EDIT',
    entityType: 'nutrition_entry',
    entityId: 'peer',
    keyEpoch: keys.keyEpoch,
  };
  const signature = signDetached(
    peer.signingPrivateKey,
    canonicalSignBytes({
      protocolVersion: LOCAL_FIRST_PROTOCOL_VERSION,
      schemaVersion: LOCAL_FIRST_SCHEMA_VERSION,
      ...base,
      parents: [],
      payloadCiphertext: payload,
    }),
  );
  const stored: StoredOperation = {
    ...base,
    payload,
    signature,
    appliedAt: atMs,
  } as StoredOperation;

  const result = await opLog.applyRemote(stored, peer.signingPublicKey);
  expect(result.status).toBe('applied');
}

/* ================================================================== */
/* 1. What a cold open installs                                        */
/* ================================================================== */

describe('resident window — what a cold open installs', () => {
  it('decrypts a window, not the table, and leaves the rest sealed on disk', async () => {
    await seedFourYearDiary();
    const seededMeals = rowsOf<LocalNutritionEntry>('nutritionEntries').length;

    await reopenLocalHealthSessionForTests();

    const residentMeals = rowsOf<LocalNutritionEntry>('nutritionEntries').length;
    // The lever, asserted as a lever: a cold open must install a small
    // FRACTION. A regression that quietly reverted to the full read would still
    // pass every correctness test in this file, and only this one would notice.
    expect(residentMeals).toBeLessThan(seededMeals / 2);
    expect(residentMeals).toBeGreaterThan(0);

    // …and nothing was deleted to achieve it. The store still holds every row.
    const onDisk = await getLocalHealthStore().listRows({
      householdId: getLocalHealthLedger().household.id,
    });
    const mealsOnDisk = onDisk.filter((row) => row.table === 'nutritionEntries');
    expect(mealsOnDisk).toHaveLength(seededMeals);
  });

  it('installs exactly the buckets the schema names, and no others', async () => {
    await seedFourYearDiary();
    await reopenLocalHealthSessionForTests();

    expect(getLocalHealthResidentBucketsForTests()).toEqual([...(residentBuckets() ?? [])].sort());
  });

  it('is sized to cover every dated read the registry records', () => {
    // The window is DERIVED from `windows.ts`, not chosen. A loader that widens
    // its day window past the resident window would otherwise start missing on
    // every Home focus — a slower cold open in the costume of a faster one.
    const widest = Math.max(
      ...HEALTH_LOADER_NAMES.flatMap((name) =>
        HEALTH_READ_WINDOWS[name].reads.map((read) => maxDaysForWindow(read.window) ?? 0),
      ),
    );
    expect(widest).toBeGreaterThan(0);
    expect(HEALTH_RESIDENT_WINDOW_DAYS).toBeGreaterThanOrEqual(widest);
  });
});

/* ================================================================== */
/* 2. What is never windowed                                           */
/* ================================================================== */

describe('resident window — what is never windowed', () => {
  it('keeps userHabits and healthGoals whole, however old they are', async () => {
    // Both are always-resident by design (`schema.ts`: "do not relitigate").
    // `healthGoals` carries an `effective_date` and would bucket if it were
    // listed, so an old goal is exactly the row a careless window loses — and
    // losing it means Home cannot find the active goal without a month probe.
    await localHabitsApi.createHabit({ name: 'Floss', icon: 'tooth' });
    await seed((ledger) => {
      ledger.healthGoals.push({
        id: `hgl_${USER}_${ANCIENT_DAY}`,
        user_id: USER,
        effective_date: ANCIENT_DAY,
        daily_calories: 2100,
        created_at: `${ANCIENT_DAY}T09:00:00.000Z`,
        updated_at: `${ANCIENT_DAY}T09:00:00.000Z`,
        deleted_at: null,
      } as never);
    });

    await reopenLocalHealthSessionForTests();

    expect(rowsOf<LocalUserHabit>('userHabits')).toHaveLength(1);
    expect(rowsOf('healthGoals')).toHaveLength(1);
  });

  it('keeps a four-year-old ledger tombstone resident, so a later edit still loses', async () => {
    // The tombstone is ABSORBING (`projection.ts`) and it can only absorb what
    // it is present for. `listRows` includes every `deleted = 1` row whatever
    // bucket it carries; this asserts the engine relies on that rather than,
    // say, filtering tombstones by date on the way in.
    //
    // A real ledger tombstone (`delta.d`), not Health's own `deleted_at`
    // soft-delete: only the former sets the `del` watermark that the merge
    // consults, and only the former is stored with `deleted = 1`.
    await seed((ledger) => {
      ledger.nutritionEntries.push(mealRow(ANCIENT_DAY, 'Deleted lunch'));
    });
    const mealId = `nut_${ANCIENT_DAY}_Deleted lunch`;
    await seed((ledger) => {
      ledger.nutritionEntries = ledger.nutritionEntries.filter((row) => row.id !== mealId);
    });

    await reopenLocalHealthSessionForTests();

    // Resident despite being four years old — the store returns every tombstone
    // whatever bucket it carries.
    const onDisk = await getLocalHealthStore().listRows({
      householdId: getLocalHealthLedger().household.id,
      keys: [{ table: 'nutritionEntries', rowKey: mealId }],
    });
    expect(onDisk[0]?.deleted).toBe(true);

    // A peer's LATER edit must still lose to it.
    await applyPeerDelta(
      { v: 1, u: { nutritionEntries: [{ k: mealId, f: { food_name: 'Resurrected' } }] } },
      PEER_WINS_MS,
    );

    expect(
      allRowsOf<LocalNutritionEntry>('nutritionEntries').find((row) => row.id === mealId),
    ).toBeUndefined();
    const { entries } = await localNutritionApi.listNutrition({ date: ANCIENT_DAY });
    expect(entries).toHaveLength(0);
  });
});

/* ================================================================== */
/* 3. A read that misses the window                                    */
/* ================================================================== */

describe('resident window — a read that misses hydrates, it does not truncate', () => {
  it('serves a meal from three years ago', async () => {
    await seedFourYearDiary();
    await seed((ledger) => {
      ledger.nutritionEntries.push(mealRow(ANCIENT_DAY, 'Birthday cake'));
    });
    await reopenLocalHealthSessionForTests();

    // Not resident after the cold open…
    expect(
      rowsOf<LocalNutritionEntry>('nutritionEntries').some((row) => row.date === ANCIENT_DAY),
    ).toBe(false);

    // …and served anyway, because the read widens the window first.
    const { entries } = await localNutritionApi.listNutrition({ date: ANCIENT_DAY });
    expect(entries.map((entry) => entry.food_name)).toContain('Birthday cake');
  });

  it('serves a water day and a step day from outside the window', async () => {
    await seed((ledger) => {
      ledger.waterEntries.push({
        id: `h2o_${MIDDLE_DAY}`,
        user_id: USER,
        date: MIDDLE_DAY,
        amount_ml: 250,
        beverage_type: 'water',
        container: null,
        created_at: `${MIDDLE_DAY}T09:00:00.000Z`,
        updated_at: `${MIDDLE_DAY}T09:00:00.000Z`,
        deleted_at: null,
      } as never);
      ledger.healthEntries.push({
        id: `hen_${MIDDLE_DAY}`,
        user_id: USER,
        date: MIDDLE_DAY,
        entry_type: 'steps',
        data: JSON.stringify({ steps: 9123 }),
        source: 'manual',
        intensity: null,
        created_at: `${MIDDLE_DAY}T23:00:00.000Z`,
        updated_at: `${MIDDLE_DAY}T23:00:00.000Z`,
        deleted_at: null,
      } as never);
    });
    await reopenLocalHealthSessionForTests();

    const water = await localWaterApi.listWater({ from: MIDDLE_DAY, to: MIDDLE_DAY });
    expect(water.entries).toHaveLength(1);

    const steps = await localEntriesApi.listEntries({
      type: 'steps',
      from: MIDDLE_DAY,
      to: MIDDLE_DAY,
    });
    expect(steps.entries).toHaveLength(1);
  });

  it('answers a ROW-bounded weight read identically to a fully-resident ledger', async () => {
    // `loadWeightLog` is one of the two loaders `windows.ts` flags as the known
    // caveat: 500 ROWS with no date bound at all. On this corpus 500 weigh-ins
    // reach ~5.5 years back, so the resident window holds well under half of
    // them and a facade that answered from memory would return a weight chart
    // that simply stops.
    await seedFourYearDiary();
    const expected = await localWeightApi.listWeight();
    expect(expected.entries.length).toBeGreaterThan(0);

    await reopenLocalHealthSessionForTests();
    const residentBefore = rowsOf<LocalWeightEntry>('weightEntries').length;
    expect(residentBefore).toBeLessThan(expected.entries.length);

    const actual = await localWeightApi.listWeight();
    expect(actual.entries.map((entry) => entry.id)).toEqual(
      expected.entries.map((entry) => entry.id),
    );
  });

  it('answers a ROW-bounded body read identically to a fully-resident ledger', async () => {
    // `loadBodyEntries` is the other undated row cap — 1000 rows, from a
    // service default the call site never sends.
    await seed((ledger) => {
      for (let d = 0; d <= 365 * 4; d += 15) {
        const day = daysAgo(d);
        ledger.bodyMeasurements.push({
          id: `bdy_${day}`,
          user_id: USER,
          date: day,
          unit: 'cm',
          waist: 82,
          created_at: `${day}T07:00:00.000Z`,
          updated_at: `${day}T07:00:00.000Z`,
          deleted_at: null,
        } as never);
      }
    });
    const expected = await localBodyApi.listMeasurements();

    await reopenLocalHealthSessionForTests();
    const actual = await localBodyApi.listMeasurements();
    expect(actual.measurements.map((row) => row.id)).toEqual(
      expected.measurements.map((row) => row.id),
    );
  });

  it('finds the newest weigh-in on or before an ancient day, without walking forwards', async () => {
    // `dailySummary` reads the latest reading ON OR BEFORE the date. The answer
    // for a day three years ago lives in a bucket three years old, and the walk
    // that finds it is bounded by `before` so it cannot hydrate the two years
    // of months in between.
    await seed((ledger) => {
      ledger.weightEntries.push(weightRow(daysAgo(365 * 3 + 5), 88.8));
    });
    await reopenLocalHealthSessionForTests();

    const { summary } = await localSummariesApi.dailySummary(ANCIENT_DAY);
    expect(summary.weight?.value).toBe(88.8);
  });

  it('keeps `loadHabits` inside the window — its 400-day cap needs no widening', async () => {
    // The second of the two known-caveat loaders. Unlike `loadWeightLog` it is
    // DATE-bounded (400 days per habit), and `HEALTH_RESIDENT_WINDOW_DAYS` is
    // sized to cover it — so the honest answer here is "no hydration needed",
    // asserted rather than assumed.
    const { habit } = await localHabitsApi.createHabit({ name: 'Walk', icon: 'footprints' });
    await seed((ledger) => {
      for (const day of [daysAgo(3), daysAgo(200), daysAgo(399)]) {
        ledger.habitLogs.push({
          id: `hlg_${habit.id}_${day}`,
          user_id: USER,
          habit_id: habit.id,
          date: day,
          completed_at: `${day}T08:00:00.000Z`,
          created_at: `${day}T08:00:00.000Z`,
          updated_at: `${day}T08:00:00.000Z`,
          deleted_at: null,
        } as never);
      }
    });

    await reopenLocalHealthSessionForTests();

    expect(rowsOf<LocalHabitLog>('habitLogs')).toHaveLength(3);
  });

  it('does not mint a duplicate when a habit is ticked on a day outside the window', async () => {
    // `habitLogs` is a DETERMINISTIC-id table. If the toggle cannot see the
    // existing log it takes the create branch and writes over it under this
    // op's stamp — an upsert that silently replaces a row rather than reviving
    // it. The Habits grid ticks back over a calendar, so the day really can be
    // arbitrary.
    const { habit } = await localHabitsApi.createHabit({ name: 'Read', icon: 'book' });
    await seed((ledger) => {
      ledger.habitLogs.push({
        id: `hlg_${habit.id}_${ANCIENT_DAY}`,
        user_id: USER,
        habit_id: habit.id,
        date: ANCIENT_DAY,
        completed_at: `${ANCIENT_DAY}T08:00:00.000Z`,
        created_at: `${ANCIENT_DAY}T08:00:00.000Z`,
        updated_at: `${ANCIENT_DAY}T08:00:00.000Z`,
        deleted_at: null,
      } as never);
    });
    await reopenLocalHealthSessionForTests();

    // Untick, not create: the log exists, so the toggle must find and tombstone
    // it rather than write a second one over the top.
    const { done } = await localHabitsApi.toggleHabit(habit.id, ANCIENT_DAY);
    expect(done).toBe(false);
    expect(
      allRowsOf<LocalHabitLog>('habitLogs').filter((row) => row.date === ANCIENT_DAY),
    ).toHaveLength(1);
  });
});

/* ================================================================== */
/* 4. Convergence — the case that would be silent loss                 */
/* ================================================================== */

describe('resident window — convergence is never traded for speed', () => {
  it('merges a peer patch into a row this device never loaded, and keeps the row', async () => {
    await seedFourYearDiary();
    await seed((ledger) => {
      ledger.nutritionEntries.push(mealRow(ANCIENT_DAY, 'Ancient lunch'));
    });
    const mealId = `nut_${ANCIENT_DAY}_Ancient lunch`;
    await reopenLocalHealthSessionForTests();

    // Precondition: the row is genuinely not in memory. Without this the test
    // would pass on a ledger that happens to be fully resident and prove
    // nothing at all.
    expect(rowsOf<LocalNutritionEntry>('nutritionEntries').some((row) => row.id === mealId)).toBe(
      false,
    );

    await applyPeerDelta(
      { v: 1, u: { nutritionEntries: [{ k: mealId, f: { calories: 555 } }] } },
      PEER_WINS_MS,
    );

    // The patch landed on the REAL row: the other fields survived, which is
    // what distinguishes a merge from a parked orphan being materialised.
    const merged = rowsOf<LocalNutritionEntry>('nutritionEntries').find((row) => row.id === mealId);
    expect(merged).toBeDefined();
    expect(merged?.calories).toBe(555);
    expect(merged?.food_name).toBe('Ancient lunch');

    // And the sealed body on disk is still a row, not the `row: null` shadow a
    // parked orphan persists. This is the assertion the whole file is for: the
    // failure it catches is invisible in memory and permanent on disk.
    const onDisk = await getLocalHealthStore().listRows({
      householdId: getLocalHealthLedger().household.id,
      keys: [{ table: 'nutritionEntries', rowKey: mealId }],
    });
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0]?.deleted).toBe(false);

    // Surviving a second cold open is the only proof that matters.
    await reopenLocalHealthSessionForTests();
    const { entries } = await localNutritionApi.listNutrition({ date: ANCIENT_DAY });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.calories).toBe(555);
    expect(entries[0]?.food_name).toBe('Ancient lunch');
  });

  it('lets a resident newer edit beat a peer edit to a non-resident row', async () => {
    // LWW needs the row's FIELD STAMPS, and those live in the same envelope as
    // the row body. A merge that skipped hydration would find no stamp, treat
    // the peer's older write as unopposed and let it win — convergence broken
    // in the direction nobody notices, because the row is still there.
    await seed((ledger) => {
      ledger.nutritionEntries.push(mealRow(ANCIENT_DAY, 'Ancient lunch'));
    });
    const mealId = `nut_${ANCIENT_DAY}_Ancient lunch`;
    // A local edit made NOW — newer than the peer op applied below.
    await localNutritionApi.updateNutrition(mealId, { calories: 999 });

    await reopenLocalHealthSessionForTests();

    await applyPeerDelta(
      { v: 1, u: { nutritionEntries: [{ k: mealId, f: { calories: 111 } }] } },
      // An hour before the local edit: the loser.
      PEER_LOSES_MS,
    );

    const { entries } = await localNutritionApi.listNutrition({ date: ANCIENT_DAY });
    expect(entries[0]?.calories).toBe(999);
  });

  it('tombstones a non-resident row when the peer deletes it', async () => {
    await seed((ledger) => {
      ledger.nutritionEntries.push(mealRow(ANCIENT_DAY, 'Ancient lunch'));
    });
    const mealId = `nut_${ANCIENT_DAY}_Ancient lunch`;
    await reopenLocalHealthSessionForTests();

    await applyPeerDelta({ v: 1, d: { nutritionEntries: [mealId] } }, PEER_WINS_MS);

    const { entries } = await localNutritionApi.listNutrition({ date: ANCIENT_DAY });
    expect(entries).toHaveLength(0);

    await reopenLocalHealthSessionForTests();
    const { entries: afterReopen } = await localNutritionApi.listNutrition({ date: ANCIENT_DAY });
    expect(afterReopen).toHaveLength(0);
  });

  it('applies a peer CREATE for a row key that already exists outside the window', async () => {
    // The deterministic-id collision, from the wire side: the peer's other
    // device re-creates `hlg_<habit>_<date>` for a day this device did not
    // load. Without hydration the create lands unopposed; with it, LWW decides.
    await seed((ledger) => {
      ledger.nutritionEntries.push(mealRow(ANCIENT_DAY, 'Ancient lunch'));
    });
    const mealId = `nut_${ANCIENT_DAY}_Ancient lunch`;
    await reopenLocalHealthSessionForTests();

    await applyPeerDelta(
      {
        v: 1,
        u: {
          nutritionEntries: [
            { k: mealId, f: { ...mealRow(ANCIENT_DAY, 'Ancient lunch'), calories: 42 }, n: 1 },
          ],
        },
      },
      PEER_WINS_MS,
    );

    const { entries } = await localNutritionApi.listNutrition({ date: ANCIENT_DAY });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.calories).toBe(42);
  });
});
