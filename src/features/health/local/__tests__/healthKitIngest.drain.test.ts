/**
 * **He11a — the HealthKit drain writes the LEDGER, in airplane mode** (plan §11,
 * §1.6 Wave B).
 *
 * ## What is actually at risk here
 *
 * The import plan is idempotent only as far as its BASELINE READ is complete.
 * `planImport` / `planWeightImport` / `planNutritionImport` / `planWorkoutImport`
 * decide "already imported, skip" by looking at what the destination already
 * holds; a read that returns fewer rows than the destination has makes the
 * planner create a row that is already there — and it does that again on the
 * next sync, and the next. **An under-read is a DUPLICATE row, permanently, on
 * every device that syncs.** That is why the registered read windows are
 * asserted here as well as in `windows.test.ts`: this is the caller whose
 * correctness depends on them.
 *
 * The suite therefore covers, in the order the plan cares about them:
 *
 *  1. **Routing.** `resolveHealthKitImportSink()` answers the ledger sink on a
 *     flag-1 build and the API sink otherwise — and a flag-1 import through the
 *     DEFAULT sink (no `sink` in the config, i.e. what the app builds) writes the
 *     ledger and reaches no network at all.
 *  2. **Round trip.** All four tracks — entries, weight, workouts, nutrition —
 *     land as ledger rows tagged `source: 'healthkit'`, with the radio off.
 *  3. **De-duplication.** Re-importing the SAME HealthKit samples creates
 *     nothing; a CHANGED figure supersedes exactly one row and creates exactly
 *     one replacement; a workout is recognised by Apple's own `healthkit_uuid`.
 *  4. **Manual always wins.** A day the member typed is skipped, its row
 *     untouched and un-tombstoned — including a weight row with NO recorded
 *     origin, which pre-dates migration 0122 and can only be read as manual.
 *  5. **The windows bound the baseline read.** 400 for entries, **200** (not
 *     500) for weight, and **no cap at all** for nutrition, taken from
 *     `HEALTH_READ_WINDOWS` rather than restated — a suite that hard-coded the
 *     numbers would pass after someone edited the registry.
 *  6. **Bulk.** A multi-day import is a handful of ops, not one per row.
 *
 * ## Airplane mode is asserted, not assumed
 *
 * `@api/client` is replaced by a transport that records the call and rejects,
 * and `globalThis.fetch` does the same. Every test ends with both untouched.
 * Without that, a sink that fell through to the server would satisfy most of the
 * assertions below against a live Worker.
 *
 * ## Why most tests pass the sink explicitly
 *
 * `EXPO_PUBLIC_HEALTH_LOCAL_FIRST` is suppressed under Jest unless it is set
 * (`flag.ts`), and this suite must be green in BOTH the plain
 * `npx jest src/features/health` run and the `=1` run. So the behavioural tests
 * construct `createLedgerHealthKitImportSink()` directly — that is the object
 * under test either way — and the flag is flipped, saved and restored only by
 * the two routing tests that are ABOUT the flag.
 *
 * Static imports only: `await import()` throws under this Jest config without
 * `--experimental-vm-modules`.
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

import {
  createHealthKitService,
  resolveHealthKitImportSink,
  type HealthKitBridge,
  type HealthKitImportResult,
} from '../../healthKit';
import type { HealthKitSample, HealthKitWorkoutSample } from '../../healthKitTypes';
import {
  closeLocalHealthSession,
  getLocalHealthLedger,
  openLocalHealthSessionForTests,
} from '../engine';
import { createLedgerHealthKitImportSink } from '../healthKitIngest';
import { localEntriesApi } from '../localEntriesApi';
import { localNutritionApi } from '../localNutritionApi';
import { localWeightApi } from '../localWeightApi';
import { allRowsOf, nowIso, rowsOf } from '../localWrite';
import type { LocalHealthEntry, LocalNutritionEntry, LocalWeightEntry } from '../types';
import { HEALTH_READ_WINDOWS, maxRowsForWindow } from '../windows';

const USER = 'user_healthkit_ingest';

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
  await openLocalHealthSessionForTests({ userId: USER });
});

afterEach(async () => {
  // The load-bearing assertion of the whole file. A drain that reached the
  // Worker would 410 on a flag-1 device (the He0 reject-list covers
  // `/health/entries`, `/health/weight` and `/health/nutrition`), and a drain
  // that reached it on a flag-0 device would be writing D1 behind the ledger's
  // back. Neither may happen.
  expect(mockNetworkCalls).toEqual([]);
  await closeLocalHealthSession();
});

/* ------------------------------------------------------------------ */
/* The flag, borrowed and given back                                   */
/* ------------------------------------------------------------------ */

/**
 * Run `work` with the client gate explicitly on, then restore whatever the
 * ambient run had.
 *
 * `isHealthLocalFirst()` reads `process.env` per CALL (`flag.ts`), so no module
 * registry reset is needed — but the variable is process-wide and Jest reuses a
 * worker across files, so it has to be handed back exactly as it was found.
 */
async function withLocalFirstFlag<T>(value: '0' | '1', work: () => Promise<T>): Promise<T> {
  const previous = process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST;
  process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST = value;
  try {
    return await work();
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST;
    else process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST = previous;
  }
}

/* ------------------------------------------------------------------ */
/* A bridge that answers with whatever the test hands it               */
/* ------------------------------------------------------------------ */

const NOW = new Date('2026-08-14T12:00:00.000Z');
/** Inside the default 7-day catch-up window, and in local time all day. */
const DAY_1 = '2026-08-12';
const DAY_2 = '2026-08-13';

function at(date: string, hour = 10): string {
  // Midday-ish local: `localDayKey` buckets on the LOCAL day, so an instant near
  // either midnight could land on the neighbouring date under a non-UTC TZ.
  return new Date(`${date}T${String(hour).padStart(2, '0')}:00:00.000Z`).toISOString();
}

function sample(
  type: HealthKitSample['type'],
  date: string,
  value: number,
  unit: HealthKitSample['unit'],
): HealthKitSample {
  return { type, startedAt: at(date), endedAt: at(date, 11), value, unit };
}

function workout(uuid: string, date: string, minutes = 30, calories = 250): HealthKitWorkoutSample {
  return {
    uuid,
    startedAt: at(date, 9),
    endedAt: at(date, 10),
    workoutType: 'Running',
    minutes,
    calories,
  };
}

/**
 * A bridge whose sample set the test controls between runs, so a second
 * `importNow()` can hand back exactly the same samples (the re-import case) or
 * a corrected figure (the supersede case).
 */
function stubBridge(): HealthKitBridge & {
  setSamples(next: readonly HealthKitSample[]): void;
  setWorkouts(next: readonly HealthKitWorkoutSample[]): void;
} {
  let samples: readonly HealthKitSample[] = [];
  let workouts: readonly HealthKitWorkoutSample[] = [];
  const authorized = Object.fromEntries(
    // Every identifier we ever ask for, answered `sharingAuthorized`; the
    // service filters by scope itself.
    [
      'HKQuantityTypeIdentifierStepCount',
      'HKQuantityTypeIdentifierActiveEnergyBurned',
      'HKCategoryTypeIdentifierSleepAnalysis',
      'HKQuantityTypeIdentifierHeartRate',
      'HKQuantityTypeIdentifierBodyMass',
      'HKQuantityTypeIdentifierDietaryEnergyConsumed',
      'HKQuantityTypeIdentifierDietaryProtein',
      'HKQuantityTypeIdentifierDietaryCarbohydrates',
      'HKQuantityTypeIdentifierDietaryFatTotal',
      'HKWorkoutTypeIdentifier',
    ].map((identifier) => [identifier, 'sharingAuthorized' as const]),
  );

  return {
    isAvailable: () => true,
    getAuthorizationStatus: async () => authorized,
    requestAuthorization: async () => authorized,
    querySamples: async ({ type }) => samples.filter((s) => s.type === type),
    queryWorkouts: async () => workouts,
    setSamples: (next) => {
      samples = next;
    },
    setWorkouts: (next) => {
      workouts = next;
    },
  };
}

type Drain = {
  bridge: ReturnType<typeof stubBridge>;
  run: () => Promise<HealthKitImportResult>;
};

/**
 * A service wired to the LEDGER sink explicitly.
 *
 * `sink` is passed rather than resolved so this works identically in the plain
 * and `=1` Jest runs — see the header. The routing tests below are the ones that
 * prove the app picks this same object on its own.
 */
function drain(over: { sink?: ReturnType<typeof createLedgerHealthKitImportSink> } = {}): Drain {
  const bridge = stubBridge();
  const service = createHealthKitService({
    bridge,
    sink: over.sink ?? createLedgerHealthKitImportSink(),
    now: () => NOW,
    // Pinned rather than read from `health.prefs.v1`: the weight log keeps a
    // unit per row and the "unchanged" comparison is unit-sensitive.
    weightUnit: () => 'kg',
  });

  return {
    bridge,
    run: async () => {
      await service.requestPermission();
      // An explicit `days` reads ONE flat window instead of the two-chunk
      // historical backfill, which is what keeps these fixtures small.
      return service.importNow({ days: 7 });
    },
  };
}

const entryRows = (): LocalHealthEntry[] => rowsOf<LocalHealthEntry>('healthEntries');
const weightRows = (): LocalWeightEntry[] => rowsOf<LocalWeightEntry>('weightEntries');
const nutritionRows = (): LocalNutritionEntry[] => rowsOf<LocalNutritionEntry>('nutritionEntries');
const opCount = (): number => getLocalHealthLedger().ops.length;

function dataOf(row: LocalHealthEntry): Record<string, unknown> {
  return JSON.parse(row.data) as Record<string, unknown>;
}

/* ================================================================== */
/* 1. Routing                                                          */
/* ================================================================== */

describe('which sink a build gets', () => {
  it('answers the LEDGER sink on a flag-1 build', async () => {
    const sink = await withLocalFirstFlag('1', async () => resolveHealthKitImportSink());
    // `createAll` is the tell: it exists only on the ledger sink, because
    // `POST /health/entries` has no bulk verb to route to.
    expect(typeof sink.createAll).toBe('function');
    expect(typeof sink.createWeightAll).toBe('function');
    expect(typeof sink.createNutritionAll).toBe('function');
    expect(typeof sink.createWorkoutAll).toBe('function');
  });

  it('answers the API sink when the gate is off', async () => {
    const sink = await withLocalFirstFlag('0', async () => resolveHealthKitImportSink());
    expect(sink.createAll).toBeUndefined();
    expect(sink.createWeightAll).toBeUndefined();
  });

  it('imports into the ledger through the DEFAULT sink on the flag-1 path', async () => {
    // No `sink` in the config — this is the object the shipped `healthKit`
    // instance builds for itself, resolved through `resolveHealthKitImportSink`.
    const bridge = stubBridge();
    bridge.setSamples([sample('steps', DAY_1, 4200, 'count')]);
    const service = createHealthKitService({ bridge, now: () => NOW, weightUnit: () => 'kg' });

    const result = await withLocalFirstFlag('1', async () => {
      await service.requestPermission();
      return service.importNow({ days: 7 });
    });

    expect(result.imported).toBe(1);
    expect(entryRows()).toHaveLength(1);
    // `afterEach` re-states this over every test; here it is the point of the
    // test rather than a guard. Wave B's line in plan §1.6 is that a background
    // sync stops POSTing `/health`.
    expect(mockNetworkCalls).toEqual([]);
  });
});

/* ================================================================== */
/* 2. Round trip, radio off                                            */
/* ================================================================== */

describe('round trip — every track lands in the ledger', () => {
  it('imports the four scalar entry types with the radio off', async () => {
    const { bridge, run } = drain();
    bridge.setSamples([
      sample('steps', DAY_1, 4200, 'count'),
      sample('activeEnergy', DAY_1, 310, 'kcal'),
      sample('sleep', DAY_1, 431, 'minutes'),
      sample('heartRate', DAY_1, 62, 'bpm'),
    ]);

    const result = await run();

    expect(result.imported).toBe(4);
    expect(result.failed).toBe(0);
    const byType = Object.fromEntries(entryRows().map((row) => [row.entry_type, row]));
    expect(Object.keys(byType).sort()).toEqual(['active_energy', 'heart_rate', 'sleep', 'steps']);
    expect(dataOf(byType.steps)).toEqual({ steps: 4200 });
    // Every imported row carries the tag the de-duplicator and "manual wins"
    // both key on. A row that arrived untagged would read as hand-typed.
    for (const row of entryRows()) expect(row.source).toBe('healthkit');
  });

  it('imports body mass into weight_entries with a RANDOM id', async () => {
    const { bridge, run } = drain();
    bridge.setSamples([
      sample('bodyMass', DAY_1, 80.5, 'kg'),
      sample('bodyMass', DAY_2, 80.2, 'kg'),
    ]);

    const result = await run();

    expect(result.weightImported).toBe(2);
    expect(weightRows().map((row) => row.weight).sort()).toEqual([80.2, 80.5]);
    for (const row of weightRows()) {
      expect(row.source).toBe('healthkit');
      expect(row.unit).toBe('kg');
      // THE flagship silent-loss case (plan §1.5a): a `weight_${date}` id would
      // let LWW drop one of two weigh-ins on a day. `weight_entries` carries no
      // D1 `unique()` and must keep random ids on the ingest path too.
      expect(row.id).not.toContain(row.date);
      expect(row.id.startsWith('wgt_')).toBe(true);
    }
  });

  it('imports the four dietary macros as ONE Apple Health row per day', async () => {
    const { bridge, run } = drain();
    bridge.setSamples([
      sample('dietaryEnergy', DAY_1, 1900, 'kcal'),
      sample('dietaryProtein', DAY_1, 110, 'g'),
      sample('dietaryCarbs', DAY_1, 180, 'g'),
      sample('dietaryFat', DAY_1, 70, 'g'),
    ]);

    const result = await run();

    expect(result.nutritionImported).toBe(1);
    expect(nutritionRows()).toHaveLength(1);
    const [row] = nutritionRows();
    // `food_name` is the sentinel `planNutritionImport` re-reads on the next
    // pass; renaming it orphans the row and duplicates the day.
    expect(row.food_name).toBe('Apple Health');
    expect(row.source).toBe('healthkit');
    expect([row.calories, row.proteins, row.carbohydrates, row.fats]).toEqual([1900, 110, 180, 70]);
  });

  it('imports workouts and keeps Apple’s uuid in the data blob', async () => {
    const { bridge, run } = drain();
    bridge.setWorkouts([workout('hk-uuid-1', DAY_1), workout('hk-uuid-2', DAY_1, 45, 400)]);

    const result = await run();

    expect(result.workoutImported).toBe(2);
    const workouts = entryRows().filter((row) => row.entry_type === 'workout');
    expect(workouts).toHaveLength(2);
    expect(workouts.map((row) => dataOf(row).healthkit_uuid).sort()).toEqual([
      'hk-uuid-1',
      'hk-uuid-2',
    ]);
    // Two sessions on ONE day stay two rows — unlike the scalar types, a workout
    // is never collapsed to a per-day figure.
    expect(new Set(workouts.map((row) => row.date))).toEqual(new Set([DAY_1]));
  });
});

/* ================================================================== */
/* 3. De-duplication — the whole risk                                  */
/* ================================================================== */

describe('de-duplication — a re-import never stacks', () => {
  it('creates nothing on a second pass over the same samples', async () => {
    const { bridge, run } = drain();
    bridge.setSamples([
      sample('steps', DAY_1, 4200, 'count'),
      sample('bodyMass', DAY_1, 80.5, 'kg'),
      sample('dietaryEnergy', DAY_1, 1900, 'kcal'),
      sample('dietaryProtein', DAY_1, 110, 'g'),
    ]);
    bridge.setWorkouts([workout('hk-uuid-1', DAY_1)]);

    const first = await run();
    expect(first.imported + first.weightImported + first.nutritionImported).toBe(3);
    expect(first.workoutImported).toBe(1);

    const before = {
      entries: entryRows().map((row) => row.id).sort(),
      weight: weightRows().map((row) => row.id).sort(),
      nutrition: nutritionRows().map((row) => row.id).sort(),
    };

    const second = await run();

    // Nothing created, nothing retired: the planner recognised every row as its
    // own and unchanged.
    expect(second.imported).toBe(0);
    expect(second.weightImported).toBe(0);
    expect(second.nutritionImported).toBe(0);
    expect(second.workoutImported).toBe(0);
    expect(second.superseded + second.weightSuperseded + second.nutritionSuperseded).toBe(0);
    expect(second.skipped.map((skip) => skip.reason)).toEqual(['unchanged']);
    expect(second.weightSkipped.map((skip) => skip.reason)).toEqual(['unchanged']);

    // And the rows are the SAME rows, not replacements that happen to match.
    expect(entryRows().map((row) => row.id).sort()).toEqual(before.entries);
    expect(weightRows().map((row) => row.id).sort()).toEqual(before.weight);
    expect(nutritionRows().map((row) => row.id).sort()).toEqual(before.nutrition);
  });

  it('replaces a corrected figure with exactly one row, not two', async () => {
    const { bridge, run } = drain();
    bridge.setSamples([sample('steps', DAY_1, 4200, 'count')]);
    await run();
    const [original] = entryRows();

    // Apple revised the day (a watch synced late). One row in, one row out.
    bridge.setSamples([sample('steps', DAY_1, 5100, 'count')]);
    const second = await run();

    expect(second.imported).toBe(1);
    expect(second.superseded).toBe(1);
    expect(entryRows()).toHaveLength(1);
    expect(dataOf(entryRows()[0])).toEqual({ steps: 5100 });
    // Superseded means TOMBSTONED, not spliced: a peer device's older copy must
    // have something to lose against.
    const all = allRowsOf<LocalHealthEntry>('healthEntries');
    expect(all).toHaveLength(2);
    expect(all.find((row) => row.id === original.id)?.deleted_at).toBeTruthy();
  });

  it('recognises a workout by uuid even when the session is re-read', async () => {
    const { bridge, run } = drain();
    bridge.setWorkouts([workout('hk-uuid-1', DAY_1, 30, 250)]);
    await run();

    // Same uuid, different facts. A workout's own facts do not change once
    // recorded, so the planner skips rather than superseding.
    bridge.setWorkouts([workout('hk-uuid-1', DAY_1, 31, 260)]);
    const second = await run();

    expect(second.workoutImported).toBe(0);
    expect(second.workoutSkipped).toBe(1);
    expect(entryRows().filter((row) => row.entry_type === 'workout')).toHaveLength(1);
  });

  it('does not stack a second Apple Health nutrition row on the same day', async () => {
    const { bridge, run } = drain();
    bridge.setSamples([sample('dietaryEnergy', DAY_1, 1900, 'kcal')]);
    await run();

    bridge.setSamples([sample('dietaryEnergy', DAY_1, 2050, 'kcal')]);
    const second = await run();

    expect(second.nutritionImported).toBe(1);
    expect(second.nutritionSuperseded).toBe(1);
    // One live sentinel row for the day, carrying the corrected total.
    expect(nutritionRows()).toHaveLength(1);
    expect(nutritionRows()[0].calories).toBe(2050);
  });
});

/* ================================================================== */
/* 4. Manual always wins                                               */
/* ================================================================== */

describe('manual rows are left alone', () => {
  it('skips a day the member typed on the entries track', async () => {
    const typed = await localEntriesApi.setSteps(DAY_1, 9000);

    const { bridge, run } = drain();
    bridge.setSamples([sample('steps', DAY_1, 4200, 'count')]);
    const result = await run();

    expect(result.imported).toBe(0);
    expect(result.skipped).toEqual([
      { date: DAY_1, entry_type: 'steps', reason: 'manual-entry-exists' },
    ]);
    // Untouched: same row, same value, not tombstoned.
    expect(entryRows()).toHaveLength(1);
    expect(entryRows()[0].id).toBe(typed.entry.id);
    expect(dataOf(entryRows()[0])).toEqual({ steps: 9000 });
    expect(entryRows()[0].deleted_at).toBeNull();
  });

  it('skips a day the member weighed in by hand', async () => {
    const typed = await localWeightApi.createWeight({ date: DAY_1, weight: 79.4, unit: 'kg' });
    expect(typed.entry.source).toBe('manual');

    const { bridge, run } = drain();
    bridge.setSamples([sample('bodyMass', DAY_1, 80.5, 'kg')]);
    const result = await run();

    expect(result.weightImported).toBe(0);
    expect(result.weightSkipped).toEqual([{ date: DAY_1, reason: 'manual-entry-exists' }]);
    expect(weightRows()).toHaveLength(1);
    expect(weightRows()[0].weight).toBe(79.4);
  });

  it('treats a weight row with NO recorded origin as manual (pre-0122)', async () => {
    // Seeded straight onto the ledger rather than through the facade, because
    // the facade cannot produce this row: `createWeight` coalesces `source` to
    // `'manual'`. Every row written before migration 0122 WAS typed in, and the
    // only safe reading of "unknown origin" is "leave it alone".
    const timestamp = nowIso();
    getLocalHealthLedger().weightEntries.push({
      id: 'wgt_pre_0122',
      user_id: USER,
      date: DAY_1,
      weight: 79.4,
      unit: 'kg',
      note: null,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    } as unknown as LocalWeightEntry);

    const { bridge, run } = drain();
    bridge.setSamples([sample('bodyMass', DAY_1, 80.5, 'kg')]);
    const result = await run();

    expect(result.weightImported).toBe(0);
    expect(result.weightSkipped).toEqual([{ date: DAY_1, reason: 'manual-entry-exists' }]);
    expect(weightRows()).toHaveLength(1);
    expect(weightRows()[0].id).toBe('wgt_pre_0122');
  });

  it('lets a typed meal and the imported day-total coexist', async () => {
    // Nutrition is the ONE track with no "a manual row exists, skip the day"
    // rule: a diary day holds several hand-logged meals plus one imported
    // summary. The plan de-duplicates only against its own sentinel row.
    const typed = await localNutritionApi.createNutrition({
      date: DAY_1,
      food_name: 'Porridge',
      meal_type: 'breakfast',
      calories: 320,
      proteins: 12,
      carbohydrates: 48,
      fats: 8,
    });

    const { bridge, run } = drain();
    bridge.setSamples([sample('dietaryEnergy', DAY_1, 1900, 'kcal')]);
    const result = await run();

    expect(result.nutritionImported).toBe(1);
    expect(result.nutritionSuperseded).toBe(0);
    expect(nutritionRows()).toHaveLength(2);
    const survivor = nutritionRows().find((row) => row.id === typed.entry.id);
    expect(survivor?.calories).toBe(320);
    expect(survivor?.deleted_at).toBeNull();
  });
});

/* ================================================================== */
/* 5. The registered windows bound the baseline read                   */
/* ================================================================== */

describe('the drain reads its baseline through the REGISTERED window', () => {
  /** Seed straight onto the ledger — this section exercises reads, not writes. */
  function seedEntries(count: number): void {
    const ledger = getLocalHealthLedger();
    const timestamp = nowIso();
    for (let index = 0; index < count; index += 1) {
      ledger.healthEntries.push({
        id: `he_seed_${index}`,
        user_id: USER,
        // One row per day, walking backwards from the start of the range, so
        // every row is inside the from/to the drain asks for.
        date: `2026-0${index < 200 ? '8' : '7'}-01`,
        entry_type: 'steps',
        data: JSON.stringify({ steps: 1000 + index }),
        source: 'healthkit',
        intensity: null,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
      });
    }
  }

  it('caps the entries baseline at the registry’s 400', async () => {
    const cap = maxRowsForWindow(HEALTH_READ_WINDOWS['healthKitImportSink.listExisting'].reads[0].window);
    expect(cap).toBe(400);
    seedEntries(cap! + 60);

    const existing = await createLedgerHealthKitImportSink().listExisting({
      from: '2026-07-01',
      to: '2026-08-31',
    });

    expect(existing).toHaveLength(cap!);
  });

  it('caps the weight baseline at 200 — the route default, NOT loadWeightLog’s 500', async () => {
    const drainCap = maxRowsForWindow(
      HEALTH_READ_WINDOWS['healthKitImportSink.listExistingWeight'].reads[0].window,
    );
    const screenCap = maxRowsForWindow(HEALTH_READ_WINDOWS.loadWeightLog.reads[0].window);
    // The asymmetry `windows.ts` records deliberately: the drain sends no
    // `limit`, so it inherits the route's own default. Serving it the screen's
    // 500 would change how much history the de-duplicator sees.
    expect(drainCap).toBe(200);
    expect(screenCap).toBe(500);

    const ledger = getLocalHealthLedger();
    const timestamp = nowIso();
    for (let index = 0; index < drainCap! + 40; index += 1) {
      ledger.weightEntries.push({
        id: `wgt_seed_${index}`,
        user_id: USER,
        date: '2026-08-01',
        weight: 80 + index / 1000,
        unit: 'kg',
        note: null,
        source: 'healthkit',
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
      });
    }

    const existing = await createLedgerHealthKitImportSink().listExistingWeight!({
      from: '2026-07-01',
      to: '2026-08-31',
    });

    expect(existing).toHaveLength(drainCap!);
  });

  it('applies NO row cap to the nutrition baseline — the caller’s range is the window', async () => {
    const read = HEALTH_READ_WINDOWS['healthKitImportSink.listExistingNutrition'].reads[0];
    // The only genuinely range-only read in the registry. Clamping it to
    // `loadMeals`' 120 days would re-import everything past the boundary on
    // every pass, which is a duplicate storm rather than a missing row.
    expect(maxRowsForWindow(read.window)).toBeNull();
    expect(read.window.kind).toBe('callerRange');

    const ledger = getLocalHealthLedger();
    const timestamp = nowIso();
    const seeded = 300;
    for (let index = 0; index < seeded; index += 1) {
      ledger.nutritionEntries.push({
        id: `n_seed_${index}`,
        user_id: USER,
        date: '2026-08-01',
        food_name: 'Apple Health',
        portion: 1,
        unit: 'serving',
        meal_type: 'snack',
        calories: 100,
        proteins: 1,
        carbohydrates: 2,
        fats: 3,
        food_id: null,
        base_calories_per_100: null,
        base_proteins_per_100: null,
        base_carbs_per_100: null,
        base_fats_per_100: null,
        detected_category: null,
        is_processed: 1,
        source_recipe_id: null,
        source: 'healthkit',
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
      } as unknown as LocalNutritionEntry);
    }

    const existing = await createLedgerHealthKitImportSink().listExistingNutrition!({
      from: '2026-07-01',
      to: '2026-08-31',
    });

    expect(existing).toHaveLength(seeded);
  });

  it('honours the caller’s from/to rather than the whole table', async () => {
    // The range IS the query on every one of the three: rows outside it are not
    // part of the baseline, and rows inside it must all be.
    await localWeightApi.createWeight({ date: '2026-01-05', weight: 88, unit: 'kg' });
    await localWeightApi.createWeight({ date: DAY_1, weight: 80.5, unit: 'kg' });

    const existing = await createLedgerHealthKitImportSink().listExistingWeight!({
      from: DAY_1,
      to: DAY_2,
    });

    expect(existing.map((row) => row.date)).toEqual([DAY_1]);
  });

  it('never plans against a tombstoned row', async () => {
    // A row the member deleted must be re-importable, not blocked forever —
    // every remote list this replaces filtered `deleted_at` server-side.
    const created = await localWeightApi.createWeight({
      date: DAY_1,
      weight: 80.5,
      unit: 'kg',
      source: 'healthkit',
    });
    await localWeightApi.deleteWeight(created.entry.id);

    const { bridge, run } = drain();
    bridge.setSamples([sample('bodyMass', DAY_1, 80.5, 'kg')]);
    const result = await run();

    expect(result.weightImported).toBe(1);
    expect(weightRows()).toHaveLength(1);
    expect(weightRows()[0].id).not.toBe(created.entry.id);
  });
});

/* ================================================================== */
/* 6. Bulk — one op per chunk, not one per row                         */
/* ================================================================== */

describe('bulk', () => {
  it('writes a multi-day import as far fewer ops than rows', async () => {
    // "Bulk callers must pre-chunk … one op per row is quadratic: every call
    // re-captures and re-diffs the whole ledger" (`engine.ts:908-912`). The
    // drain is the fleet's largest bulk caller.
    const days = Array.from(
      { length: 7 },
      (_, index) => `2026-08-${String(index + 8).padStart(2, '0')}`,
    );
    const { bridge, run } = drain();
    bridge.setSamples(
      days.flatMap((date) => [
        sample('steps', date, 4000 + Number(date.slice(-2)), 'count'),
        sample('activeEnergy', date, 300, 'kcal'),
        sample('sleep', date, 420, 'minutes'),
        sample('bodyMass', date, 80.5, 'kg'),
        sample('dietaryEnergy', date, 1900, 'kcal'),
      ]),
    );

    const before = opCount();
    const result = await run();
    const ops = opCount() - before;

    // 7 days × (3 entry types + weight + nutrition) = 35 rows.
    expect(result.imported).toBe(21);
    expect(result.weightImported).toBe(7);
    expect(result.nutritionImported).toBe(7);
    // Three ops — one per track — rather than thirty-five.
    expect(ops).toBe(3);
  });

  it('reports a failed batch as failed rather than as imported', async () => {
    // All-or-nothing accounting: nothing half-written may be counted as
    // imported, because the toast the member sees is built from these numbers.
    const sink = createLedgerHealthKitImportSink();
    const broken = {
      ...sink,
      createAll: async () => {
        throw new Error('ledger refused the batch');
      },
    };

    const { bridge, run } = drain({ sink: broken });
    bridge.setSamples([
      sample('steps', DAY_1, 4200, 'count'),
      sample('activeEnergy', DAY_1, 310, 'kcal'),
    ]);
    const result = await run();

    expect(result.imported).toBe(0);
    expect(result.failed).toBe(2);
    expect(entryRows()).toHaveLength(0);
  });
});
