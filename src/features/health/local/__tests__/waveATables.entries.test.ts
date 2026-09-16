/**
 * `localEntriesApi` — the Wave A `healthEntries` facade (He3b, plan §7).
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
 * THE TEST THIS FILE EXISTS FOR
 * -----------------------------
 * `entry_type` is applied **before** the 400-row window, never after
 * (`health-service.ts:1172-1182`). Workouts, step days and sleep nights are
 * three Home loaders over ONE table, and step rows outnumber everything else on
 * it — so a facade that takes the newest 400 rows and then filters by type hands
 * Home zero workouts for anybody who logs steps daily. That failure is invisible
 * in every other kind of test: the method returns a well-formed empty array, and
 * an empty Activity list is indistinguishable from a fresh install.
 *
 * `filters by entry_type BEFORE the window` below is built to fail loudly on
 * exactly that inversion: 450 step days bury three older workouts, so
 * window-then-filter returns `[]` and filter-then-window returns all three.
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
  closeLocalHealthSession,
  openLocalHealthSessionForTests,
  subscribeToHealthLedgerChanges,
  type HealthLedgerChange,
} from '../engine';
import { localDateKey } from '../ids';
import { localEntriesApi } from '../localEntriesApi';
import { activeUserId, allRowsOf, nowIso, writeLocalBulk } from '../localWrite';
import type { LocalHealthEntry } from '../types';
import { HEALTH_READ_WINDOWS, maxRowsForWindow } from '../windows';

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
  await openLocalHealthSessionForTests({ userId: 'user_entries_test' });
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

/** The registry is the source of every number below — never a literal 400. */
const WORKOUT_MAX = maxRowsForWindow(HEALTH_READ_WINDOWS.loadWorkouts.reads[0].window)!;
const STEPS_MAX = maxRowsForWindow(HEALTH_READ_WINDOWS.loadStepDays.reads[0].window)!;
const SLEEP_MAX = maxRowsForWindow(HEALTH_READ_WINDOWS.loadSleepLog.reads[0].window)!;

function dayKey(daysAgo: number): string {
  return localDateKey(new Date(Date.now() - daysAgo * DAY_MS));
}

/**
 * A ledger row written straight through the kernel.
 *
 * Seeding through `writeLocalBulk` rather than through the facade keeps the
 * 450-row window fixtures to a couple of ops, and lets a row carry a `date` far
 * enough back that no facade write would produce it.
 */
function seedRow(overrides: Partial<LocalHealthEntry> & { date: string }): LocalHealthEntry {
  const timestamp = overrides.created_at ?? nowIso();
  return {
    id: `he_seed_${overrides.date}_${Math.random().toString(36).slice(2, 8)}`,
    user_id: activeUserId(),
    entry_type: 'steps',
    data: JSON.stringify({ steps: 5000 }),
    source: 'manual',
    intensity: null,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
    ...overrides,
  };
}

async function seed(rows: LocalHealthEntry[]): Promise<void> {
  await writeLocalBulk(
    rows,
    (draft, chunk) => {
      draft.healthEntries.push(...chunk);
    },
    (chunk) => ({
      opType: 'TEST_SEED',
      entityType: 'health_entry',
      entityId: chunk[0]!.id,
      payload: { count: chunk.length },
    }),
  );
}

/* ------------------------------------------------------------------ */
/* 1. `entry_type` BEFORE the window — the reason this file exists     */
/* ------------------------------------------------------------------ */

describe('localEntriesApi — entry_type is inside the window, not outside it', () => {
  /**
   * The fixture: more step days than the window is wide, and every workout
   * OLDER than all of them. A facade that windows first sees nothing but steps.
   */
  async function seedStepsBuryingWorkouts(): Promise<void> {
    const steps = Array.from({ length: WORKOUT_MAX + 50 }, (_, index) =>
      seedRow({ date: dayKey(index) }),
    );
    const workouts = [0, 1, 2].map((index) =>
      seedRow({
        date: dayKey(WORKOUT_MAX + 100 + index),
        entry_type: 'workout',
        data: JSON.stringify({ workout_type: 'run', minutes: 30, calories: 300, note: '' }),
      }),
    );
    await seed([...steps, ...workouts]);
  }

  it('filters by entry_type BEFORE the window', async () => {
    await seedStepsBuryingWorkouts();

    const { entries } = await localEntriesApi.listEntries({
      type: 'workout',
      limit: WORKOUT_MAX,
    });

    // Window-then-filter answers `[]` here, and an empty Activity list is
    // indistinguishable from a fresh install.
    expect(entries).toHaveLength(3);
    expect(entries.every((entry) => entry.entry_type === 'workout')).toBe(true);
  });

  it('does the same for sleep, the third loader over the same table', async () => {
    const steps = Array.from({ length: SLEEP_MAX + 50 }, (_, index) =>
      seedRow({ date: dayKey(index) }),
    );
    const nights = [0, 1].map((index) =>
      seedRow({
        date: dayKey(SLEEP_MAX + 100 + index),
        entry_type: 'sleep',
        data: JSON.stringify({ minutes: 430 }),
      }),
    );
    await seed([...steps, ...nights]);

    const { entries } = await localEntriesApi.listEntries({ type: 'sleep', limit: SLEEP_MAX });
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.entry_type === 'sleep')).toBe(true);
  });

  it('caps the filtered set at the registered window, newest first', async () => {
    await seed(
      Array.from({ length: STEPS_MAX + 100 }, (_, index) => seedRow({ date: dayKey(index) })),
    );

    const { entries } = await localEntriesApi.listEntries({ type: 'steps', limit: STEPS_MAX });

    expect(entries).toHaveLength(STEPS_MAX);
    expect(entries[0]!.date).toBe(dayKey(0));
    expect(entries[entries.length - 1]!.date).toBe(dayKey(STEPS_MAX - 1));
  });

  it('never widens past the registered window, whatever limit the caller sends', async () => {
    await seed(
      Array.from({ length: STEPS_MAX + 100 }, (_, index) => seedRow({ date: dayKey(index) })),
    );

    const { entries } = await localEntriesApi.listEntries({ type: 'steps', limit: STEPS_MAX * 10 });
    expect(entries).toHaveLength(STEPS_MAX);
  });

  it('lets a smaller caller limit narrow the result', async () => {
    await seed(Array.from({ length: 40 }, (_, index) => seedRow({ date: dayKey(index) })));

    const { entries } = await localEntriesApi.listEntries({ type: 'steps', limit: 10 });
    expect(entries).toHaveLength(10);
    expect(entries[0]!.date).toBe(dayKey(0));
  });

  it('caps the He11 drain’s untyped read at the window the route silently applies', async () => {
    await seed(
      Array.from({ length: STEPS_MAX + 100 }, (_, index) => seedRow({ date: dayKey(index) })),
    );

    // `healthKitImportSink.listExisting` sends no `limit` and inherits 400.
    const { entries } = await localEntriesApi.listEntries({
      from: dayKey(STEPS_MAX + 200),
      to: dayKey(0),
    });
    expect(entries).toHaveLength(
      maxRowsForWindow(HEALTH_READ_WINDOWS['healthKitImportSink.listExisting'].reads[0].window)!,
    );
  });

  it('reproduces the route’s from/to WHERE clause', async () => {
    await seed([
      seedRow({ date: dayKey(1) }),
      seedRow({ date: dayKey(5) }),
      seedRow({ date: dayKey(9) }),
    ]);

    const { entries } = await localEntriesApi.listEntries({ from: dayKey(6), to: dayKey(2) });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.date).toBe(dayKey(5));
  });

  it('drops tombstoned rows from every read', async () => {
    await seed([
      seedRow({ date: dayKey(0), id: 'he_live' }),
      seedRow({ date: dayKey(0), id: 'he_dead', deleted_at: nowIso() }),
    ]);

    const { entries } = await localEntriesApi.listEntries({ type: 'steps' });
    expect(entries.map((entry) => entry.id)).toEqual(['he_live']);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Create / modify / delete, with the network hard-down             */
/* ------------------------------------------------------------------ */

describe('localEntriesApi — airplane mode CRUD', () => {
  it('creates a generic entry with the route’s defaults', async () => {
    const { entry } = await localEntriesApi.createEntry({
      date: dayKey(0),
      entry_type: 'sleep',
      data: { minutes: 430 },
    });

    expect(entry.source).toBe('manual');
    expect(entry.intensity).toBeNull();
    expect(entry.deleted_at).toBeNull();
    expect(entry.user_id).toBe('user_entries_test');
    expect(JSON.parse(entry.data)).toEqual({ minutes: 430 });
  });

  it('INSERTS unconditionally — only /entries/steps upserts', async () => {
    const date = dayKey(0);
    const first = await localEntriesApi.createEntry({
      date,
      entry_type: 'sleep',
      data: { minutes: 430 },
    });
    const second = await localEntriesApi.createEntry({
      date,
      entry_type: 'sleep',
      data: { minutes: 430 },
    });

    // The He11 drain plans its import against insert semantics; an "improved"
    // local upsert would silently break that plan.
    expect(second.entry.id).not.toBe(first.entry.id);
    const { entries } = await localEntriesApi.listEntries({ type: 'sleep' });
    expect(entries).toHaveLength(2);
  });

  it('assembles the workout blob exactly as the route does', async () => {
    const { entry } = await localEntriesApi.logWorkout({
      date: dayKey(0),
      workout_type: 'run',
      minutes: 42,
    });

    expect(entry.entry_type).toBe('workout');
    expect(entry.intensity).toBeNull();
    expect(JSON.parse(entry.data)).toEqual({
      workout_type: 'run',
      minutes: 42,
      calories: 0,
      note: '',
    });
  });

  it('leaves an unmeasured distance ABSENT rather than writing a zero', async () => {
    const zero = await localEntriesApi.logWorkout({
      date: dayKey(0),
      workout_type: 'yoga',
      minutes: 30,
      distance_m: 0,
    });
    const measured = await localEntriesApi.logWorkout({
      date: dayKey(0),
      workout_type: 'run',
      minutes: 30,
      distance_m: 5000,
      started_at: '2026-08-14T06:00:00.000Z',
      intensity: 'hard',
    });

    // A `0` would make "I did not measure it" indistinguishable from "I covered
    // no ground", and every total built on it would average a measurement
    // nobody took.
    expect(JSON.parse(zero.entry.data).distance_m).toBeUndefined();
    expect(JSON.parse(zero.entry.data).started_at).toBeUndefined();
    expect(JSON.parse(measured.entry.data).distance_m).toBe(5000);
    expect(JSON.parse(measured.entry.data).started_at).toBe('2026-08-14T06:00:00.000Z');
    expect(measured.entry.intensity).toBe('hard');
  });

  it('MERGES a workout edit, so changing the duration keeps the note', async () => {
    const { entry } = await localEntriesApi.logWorkout({
      date: dayKey(0),
      workout_type: 'run',
      minutes: 30,
      calories: 300,
      note: 'felt good',
      distance_m: 5000,
    });

    const updated = await localEntriesApi.updateWorkout(entry.id, { minutes: 45 });

    const payload = JSON.parse(updated.entry.data);
    expect(payload.minutes).toBe(45);
    expect(payload.note).toBe('felt good');
    expect(payload.calories).toBe(300);
    expect(payload.distance_m).toBe(5000);
    expect(updated.entry.id).toBe(entry.id);
    expect(updated.entry.created_at).toBe(entry.created_at);
  });

  it('DELETES the distance key when the edit clears it', async () => {
    const { entry } = await localEntriesApi.logWorkout({
      date: dayKey(0),
      workout_type: 'run',
      minutes: 30,
      distance_m: 5000,
      started_at: '2026-08-14T06:00:00.000Z',
    });

    const cleared = await localEntriesApi.updateWorkout(entry.id, {
      distance_m: null,
      started_at: null,
    });

    // A spread can set a key or leave it, never remove one — so "I cleared the
    // distance" has to delete it outright.
    const payload = JSON.parse(cleared.entry.data);
    expect('distance_m' in payload).toBe(false);
    expect('started_at' in payload).toBe(false);
  });

  it('un-records an intensity with an explicit null', async () => {
    const { entry } = await localEntriesApi.logWorkout({
      date: dayKey(0),
      workout_type: 'run',
      minutes: 30,
      intensity: 'hard',
    });

    const cleared = await localEntriesApi.updateWorkout(entry.id, { intensity: null });
    expect(cleared.entry.intensity).toBeNull();
  });

  it('refuses to rewrite a sleep row through the workout path', async () => {
    const { entry } = await localEntriesApi.createEntry({
      date: dayKey(0),
      entry_type: 'sleep',
      data: { minutes: 430 },
    });

    // `/entries/workouts/:id` promises the `{ workout_type, minutes, … }` shape
    // and must not corrupt a night into it.
    await expect(
      localEntriesApi.updateWorkout(entry.id, { minutes: 10 }),
    ).rejects.toMatchObject({ response: { status: 404 } });
    expect(JSON.parse(entry.data)).toEqual({ minutes: 430 });
  });

  it('REPLACES `data` wholesale on the generic update', async () => {
    const { entry } = await localEntriesApi.logWorkout({
      date: dayKey(0),
      workout_type: 'run',
      minutes: 30,
      note: 'felt good',
    });

    const updated = await localEntriesApi.updateEntry(entry.id, { data: { minutes: 45 } });

    // The donor's contract — a merge would make it impossible to remove a key,
    // and the Sleep screen edits a night by sending the whole payload.
    expect(JSON.parse(updated.entry.data)).toEqual({ minutes: 45 });
  });

  it('keeps every omitted key on the generic update', async () => {
    const date = dayKey(3);
    const { entry } = await localEntriesApi.createEntry({
      date,
      entry_type: 'sleep',
      data: { minutes: 430 },
      source: 'manual',
    });

    const updated = await localEntriesApi.updateEntry(entry.id, { data: { minutes: 400 } });
    expect(updated.entry.date).toBe(date);
    expect(updated.entry.source).toBe('manual');
    expect(updated.entry.intensity).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 3. `setSteps` — the one upsert on the table                         */
/* ------------------------------------------------------------------ */

describe('localEntriesApi — setSteps upserts one manual row per day', () => {
  it('replaces the day rather than stacking a second row', async () => {
    const date = dayKey(0);
    const first = await localEntriesApi.setSteps(date, 4000);
    const second = await localEntriesApi.setSteps(date, 9000);

    expect(second.entry.id).toBe(first.entry.id);
    expect(second.entry.created_at).toBe(first.entry.created_at);
    expect(JSON.parse(second.entry.data)).toEqual({ steps: 9000 });

    const { entries } = await localEntriesApi.listEntries({ type: 'steps' });
    expect(entries).toHaveLength(1);
  });

  it('keeps separate rows per day', async () => {
    await localEntriesApi.setSteps(dayKey(0), 4000);
    await localEntriesApi.setSteps(dayKey(1), 6000);

    const { entries } = await localEntriesApi.listEntries({ type: 'steps' });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.date).toBe(dayKey(0));
  });

  it('never overwrites an imported HealthKit row with a typed count', async () => {
    const date = dayKey(0);
    await seed([seedRow({ date, id: 'he_hk', source: 'healthkit' })]);

    const { entry } = await localEntriesApi.setSteps(date, 9000);

    // Two different claims about the day; the importer's de-duplicator owns its
    // own rows.
    expect(entry.id).not.toBe('he_hk');
    const rows = allRowsOf<LocalHealthEntry>('healthEntries');
    expect(rows).toHaveLength(2);
  });

  it('does not resurrect a tombstoned steps row', async () => {
    const date = dayKey(0);
    const first = await localEntriesApi.setSteps(date, 4000);
    await localEntriesApi.deleteEntry(first.entry.id);

    const second = await localEntriesApi.setSteps(date, 9000);
    expect(second.entry.id).not.toBe(first.entry.id);

    const { entries } = await localEntriesApi.listEntries({ type: 'steps' });
    expect(entries).toHaveLength(1);
    expect(JSON.parse(entries[0]!.data)).toEqual({ steps: 9000 });
  });

  it('picks the same duplicate on every device when an offline merge left two', async () => {
    const date = dayKey(0);
    await seed([
      seedRow({ date, id: 'he_b', created_at: '2026-08-14T12:00:00.000Z' }),
      seedRow({ date, id: 'he_a', created_at: '2026-08-14T08:00:00.000Z' }),
    ]);

    // `health_entries` carries no `unique()`, so S3b forbids a deterministic id
    // and two devices CAN mint two rows for one day. The oldest is chosen —
    // insertion order — so at least both devices then update the same one.
    const { entry } = await localEntriesApi.setSteps(date, 9000);
    expect(entry.id).toBe('he_a');
  });
});

/* ------------------------------------------------------------------ */
/* 4. Tombstones                                                       */
/* ------------------------------------------------------------------ */

describe('localEntriesApi — tombstones', () => {
  it('tombstones rather than splices, so a peer cannot resurrect the row', async () => {
    const { entry } = await localEntriesApi.logWorkout({
      date: dayKey(0),
      workout_type: 'run',
      minutes: 30,
    });

    await expect(localEntriesApi.deleteEntry(entry.id)).resolves.toEqual({ deleted: true });

    const stored = allRowsOf<LocalHealthEntry>('healthEntries');
    expect(stored).toHaveLength(1);
    expect(stored[0]!.deleted_at).not.toBeNull();
    expect(stored[0]!.updated_at).toBe(stored[0]!.deleted_at);
    await expect(localEntriesApi.listEntries({ type: 'workout' })).resolves.toEqual({
      entries: [],
    });
  });

  it('refuses a second delete with the Worker’s 404 shape', async () => {
    const { entry } = await localEntriesApi.logWorkout({
      date: dayKey(0),
      workout_type: 'run',
      minutes: 30,
    });
    await localEntriesApi.deleteEntry(entry.id);

    // A bare Error carries no `response.status`, which `writeThrough` reads as a
    // lost connection — and re-queues the delete of an already-gone row forever.
    await expect(localEntriesApi.deleteEntry(entry.id)).rejects.toMatchObject({
      response: { status: 404, data: { error: { code: 'not_found' } } },
    });
  });

  it('treats a tombstoned row as absent for both update verbs', async () => {
    const { entry } = await localEntriesApi.logWorkout({
      date: dayKey(0),
      workout_type: 'run',
      minutes: 30,
    });
    await localEntriesApi.deleteEntry(entry.id);

    await expect(localEntriesApi.updateWorkout(entry.id, { minutes: 5 })).rejects.toMatchObject({
      response: { status: 404 },
    });
    await expect(localEntriesApi.updateEntry(entry.id, { date: dayKey(1) })).rejects.toMatchObject({
      response: { status: 404 },
    });
  });

  it('answers 404 for an unknown id on every write verb', async () => {
    await expect(localEntriesApi.deleteEntry('nope')).rejects.toMatchObject({
      response: { status: 404 },
    });
    await expect(localEntriesApi.updateEntry('nope', { date: dayKey(0) })).rejects.toMatchObject({
      response: { status: 404 },
    });
    await expect(localEntriesApi.updateWorkout('nope', { minutes: 1 })).rejects.toMatchObject({
      response: { status: 404 },
    });
  });
});

/* ------------------------------------------------------------------ */
/* 5. The refresh origin — a drain write no screen rendered            */
/* ------------------------------------------------------------------ */

describe('localEntriesApi — HealthKit writes fan out, manual ones do not', () => {
  function recordOrigins(): { origins: string[]; stop: () => void } {
    const origins: string[] = [];
    const stop = subscribeToHealthLedgerChanges((change: HealthLedgerChange) => {
      origins.push(change.origin);
    });
    return { origins, stop };
  }

  it('tags a `source: healthkit` create as `ingest`', async () => {
    const { origins, stop } = recordOrigins();
    try {
      await localEntriesApi.createEntry({
        date: dayKey(0),
        entry_type: 'steps',
        data: { steps: 8000 },
        source: 'healthkit',
      });
    } finally {
      stop();
    }

    // `'local'` is a no-op for refresh subscribers because the screen that saved
    // already rendered it — but NO SCREEN RENDERED THIS, so Home would keep
    // yesterday's step count until the next navigation.
    expect(origins).toEqual(['ingest']);
  });

  it('leaves a manual create as a `local` echo', async () => {
    const { origins, stop } = recordOrigins();
    try {
      await localEntriesApi.createEntry({
        date: dayKey(0),
        entry_type: 'steps',
        data: { steps: 8000 },
      });
    } finally {
      stop();
    }

    expect(origins).toEqual(['local']);
  });
});
