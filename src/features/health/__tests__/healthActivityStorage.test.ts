/**
 * Symply Health — Activity (donor "Workouts" tab).
 *
 * Workouts and steps both ride the donor's generic `health_entries` table, so
 * the interesting wire detail is the JSON `data` blob: one row per session, one
 * upserted row per step-day, and a payload that has to survive being parsed back
 * out. A corrupt blob must be SKIPPED rather than rendered as a zero-minute
 * session, which is the case the parser exists for.
 *
 * The HealthKit-OFF invariant still holds: steps are a manually written day
 * record (`source: 'manual'` server-side), never a sensor read.
 */

import { healthApi, type HealthEntry } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  addWorkoutEntry,
  DEFAULT_ACTIVITY_GOALS,
  DEFAULT_INTENSITY,
  deleteWorkoutEntry,
  displayToMetres,
  distanceUnitFor,
  formatDistance,
  formatDuration,
  HEALTH_ACTIVITY_GOALS_KEY,
  HEALTH_STEPS_KEY,
  HEALTH_WORKOUTS_KEY,
  isWorkoutType,
  loadActivityGoals,
  loadStepDays,
  loadStepsForDate,
  loadWorkouts,
  metresToDisplay,
  parseDistanceInput,
  parseIntegerInput,
  parseMinutesInput,
  parseStepsInput,
  parseWorkoutCaloriesInput,
  parseWorkoutNote,
  recentDayKeys,
  sanitizeDecimalInput,
  sanitizeIntegerInput,
  saveActivityGoals,
  setStepsForDate,
  summarizeActivity,
  updateWorkoutEntry,
  WORKOUT_TYPE_ICONS,
  WORKOUT_TYPE_LABELS,
  WORKOUT_TYPES,
  type WorkoutEntry,
} from '../healthActivityStorage';
import {
  __setHealthOfflineForTests,
  clearHealthCache,
  HEALTH_OUTBOX_KEY,
  healthSyncStateFor,
} from '../healthRepository';
import {
  fakeGoalServer,
  goalRow,
  healthEntryRow,
  installHealthApiDefaults,
  NETWORK_ERROR,
  ok,
  stepsRow,
  workoutRow,
  type MockedHealthApi,
} from '../test-utils/healthApiTestKit';

jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

function workout(over: Partial<WorkoutEntry> = {}): WorkoutEntry {
  return {
    id: over.id ?? 'w1',
    date: over.date ?? TODAY,
    type: over.type ?? 'walk',
    minutes: over.minutes ?? 30,
    calories: over.calories ?? 120,
    intensity: over.intensity ?? DEFAULT_INTENSITY,
    // `null` by default, matching the type: a fixture that silently omitted
    // these two fields used to leave `distanceM` as JS `undefined`, which
    // `summarizeActivity`'s `!== null` filter treats as "measured" — every
    // plain fixture workout was accidentally counted as a distance session.
    distanceM: over.distanceM ?? null,
    startedAt: over.startedAt ?? null,
    note: over.note ?? '',
    loggedAt: over.loggedAt ?? '2026-07-13T10:00:00.000Z',
  };
}

/**
 * Stand-in for `/health/entries`, which serves BOTH workouts and steps.
 *
 * `setSteps` upserts one manual row per day (re-entering a count replaces it
 * rather than stacking), so the fake has to model that or every steps test would
 * pass by accident on an append-only list.
 */
function fakeEntriesServer(): { rows: HealthEntry[] } {
  const state = { rows: [] as HealthEntry[] };
  api.listEntries.mockImplementation((params) =>
    Promise.resolve(
      ok({ entries: state.rows.filter((r) => !params?.type || r.entry_type === params.type) })
    )
  );
  api.logWorkout.mockImplementation((body) => {
    const row = workoutRow(
      {
        workout_type: body.workout_type,
        minutes: body.minutes,
        calories: body.calories ?? 0,
        note: body.note ?? '',
      },
      {
        id: `srv-${state.rows.length + 1}`,
        date: body.date,
        // 0124: absent means "not recorded", which is what the column stores.
        intensity: body.intensity ?? null,
        created_at: new Date().toISOString(),
      }
    );
    state.rows.push(row);
    return Promise.resolve(ok({ entry: row }));
  });
  // 0124. The Worker MERGES the typed payload and REPLACES the column, so the
  // fake has to do both or an "untouched note survives" test would pass by
  // accident on a full-replace stub.
  api.updateWorkout.mockImplementation((id, body) => {
    const index = state.rows.findIndex((r) => r.id === id);
    if (index === -1) return Promise.reject(new Error('not found'));
    const current = JSON.parse(state.rows[index].data) as Record<string, unknown>;
    const next = workoutRow(
      {
        workout_type: (body.workout_type ?? current.workout_type) as string,
        minutes: (body.minutes ?? current.minutes) as number,
        calories: (body.calories ?? current.calories) as number,
        note: (body.note ?? current.note) as string,
      },
      {
        id,
        date: body.date ?? state.rows[index].date,
        intensity: body.intensity === undefined ? state.rows[index].intensity : body.intensity,
        created_at: state.rows[index].created_at,
      }
    );
    state.rows[index] = next;
    return Promise.resolve(ok({ entry: next }));
  });
  api.deleteEntry.mockImplementation((id) => {
    state.rows = state.rows.filter((r) => r.id !== id);
    return Promise.resolve(ok({ deleted: true }));
  });
  api.setSteps.mockImplementation((date, steps) => {
    state.rows = state.rows.filter((r) => !(r.entry_type === 'steps' && r.date === date));
    const row = stepsRow(steps, { id: `steps-${date}`, date });
    state.rows.push(row);
    return Promise.resolve(ok({ entry: row }));
  });
  return state;
}

beforeEach(async () => {
  await storageHelpers.clearAll();
  await clearHealthCache([]);
  __setHealthOfflineForTests(false);
  jest.resetAllMocks();
  installHealthApiDefaults(api);
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
});

describe('healthActivityStorage — type contract', () => {
  it('HEALTH-ACT-001: exposes the donor workout types with a label and a kit icon each', () => {
    // The donor's full 61-case vocabulary (healthWorkoutTypes.ts), not the 7
    // this app shipped before that port — test the CONTRACT (every type has a
    // label and an icon, and the 7 legacy slugs this app already stores are
    // still present, spelled exactly as before) rather than a literal list
    // that drifts every time a type is added.
    expect(WORKOUT_TYPES.length).toBe(61);
    expect(new Set(WORKOUT_TYPES).size).toBe(61); // no duplicates
    for (const legacy of ['walk', 'run', 'strength', 'cycle', 'swim', 'yoga', 'other']) {
      expect(WORKOUT_TYPES).toContain(legacy);
    }
    for (const type of WORKOUT_TYPES) {
      expect(WORKOUT_TYPE_LABELS[type]).toBeTruthy();
      expect(WORKOUT_TYPE_ICONS[type]).toBeTruthy();
    }
  });

  it('HEALTH-ACT-002: isWorkoutType only accepts the known types', () => {
    expect(isWorkoutType('run')).toBe(true);
    expect(isWorkoutType('crossfit')).toBe(false);
  });
});

describe('healthActivityStorage — numeric input handling', () => {
  it('HEALTH-ACT-003: sanitizeIntegerInput strips everything but digits', () => {
    expect(sanitizeIntegerInput('30')).toBe('30');
    expect(sanitizeIntegerInput('3o0 min')).toBe('30');
    expect(sanitizeIntegerInput('30.5')).toBe('305'); // no fractional minutes
    expect(sanitizeIntegerInput(null as unknown as string)).toBe('');
  });

  it('HEALTH-ACT-004: minutes must be a positive whole number inside a day', () => {
    expect(parseMinutesInput('45')).toBe(45);
    expect(parseMinutesInput('')).toBeNull();
    expect(parseMinutesInput('0')).toBeNull();
    expect(parseMinutesInput('-5')).toBeNull();
    expect(parseMinutesInput('30.5')).toBeNull();
    expect(parseMinutesInput('1441')).toBeNull(); // longer than a day
    expect(parseMinutesInput('1440')).toBe(1440);
    expect(parseIntegerInput(null as unknown as string, 10)).toBeNull();
  });

  it('HEALTH-ACT-005: burned calories are optional — blank means zero', () => {
    expect(parseWorkoutCaloriesInput('')).toBe(0);
    expect(parseWorkoutCaloriesInput('  ')).toBe(0);
    expect(parseWorkoutCaloriesInput('250')).toBe(250);
    expect(parseWorkoutCaloriesInput('abc')).toBeNull();
  });

  it('HEALTH-ACT-006: steps accept zero (clearing the day) but not junk or absurd counts', () => {
    expect(parseStepsInput('')).toBe(0);
    expect(parseStepsInput('0')).toBe(0);
    expect(parseStepsInput('8000')).toBe(8000);
    expect(parseStepsInput('-1')).toBeNull();
    expect(parseStepsInput('abc')).toBeNull();
    expect(parseStepsInput('200001')).toBeNull();
  });
});

describe('healthActivityStorage — formatting + ranges', () => {
  it('HEALTH-ACT-007: formatDuration reads as minutes, hours, or both', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(65)).toBe('1h 05m');
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(NaN)).toBe('0m');
  });

  it('HEALTH-ACT-008: recentDayKeys returns N days oldest-first, ending today', () => {
    const keys = recentDayKeys(3);
    expect(keys).toEqual(['2026-07-11', '2026-07-12', TODAY]);
  });
});

describe('healthActivityStorage — summaries', () => {
  it('HEALTH-ACT-009: sums only the days inside the range', () => {
    const summary = summarizeActivity(
      [
        workout({ minutes: 30, calories: 100 }),
        workout({ id: 'w2', date: '2026-07-01', minutes: 60 }),
      ],
      [
        { date: TODAY, steps: 5000 },
        { date: '2026-07-01', steps: 9000 },
      ],
      [TODAY],
    );
    // No fixture session sets `distanceM`, so none is "measured" —
    // `distanceM` stays `null` (not 0: see the field's own doc comment) and
    // `distanceSessions` stays 0.
    expect(summary).toEqual({
      workouts: 1,
      minutes: 30,
      calories: 100,
      steps: 5000,
      distanceM: null,
      distanceSessions: 0,
    });
  });

  it('HEALTH-ACT-010: an empty range summarizes to zeroes', () => {
    expect(summarizeActivity([], [], [TODAY])).toEqual({
      workouts: 0,
      minutes: 0,
      calories: 0,
      steps: 0,
      distanceM: null,
      distanceSessions: 0,
    });
  });

  it('HEALTH-ACT-199: a distance IS summed, and skips sessions that never recorded one', () => {
    const summary = summarizeActivity(
      [
        workout({ distanceM: 5000 }),
        workout({ id: 'w2', distanceM: 3200 }),
        workout({ id: 'w3' }), // no distance — must not count as a 0m session
      ],
      [],
      [TODAY],
    );
    expect(summary.distanceM).toBe(8200);
    expect(summary.distanceSessions).toBe(2);
  });
});

describe('healthActivityStorage — workout wire contract', () => {
  it('HEALTH-ACT-011: an empty account reads as no workouts', async () => {
    expect(await loadWorkouts()).toEqual([]);
  });

  it('HEALTH-ACT-025: reads the workout window and unpacks the JSON payload', async () => {
    api.listEntries.mockResolvedValue(
      ok({
        entries: [
          workoutRow(
            { workout_type: 'run', minutes: 40, calories: 380, note: 'Park' },
            { id: 'srv-1', created_at: '2026-07-13T18:00:00.000Z' }
          ),
        ],
      })
    );

    // `data` is a JSON STRING in D1 — everything the workout card shows lives
    // inside it, so a parser change here silently blanks the whole list.
    expect(await loadWorkouts()).toEqual<WorkoutEntry[]>([
      {
        id: 'srv-1',
        date: TODAY,
        type: 'run',
        minutes: 40,
        calories: 380,
        intensity: DEFAULT_INTENSITY,
        // Neither field is in the raw payload above (a row logged before the
        // distance/start-time port, or a HealthKit import without one) — both
        // fall back to `null`, never `0`/`''`, per their own doc comments.
        distanceM: null,
        startedAt: null,
        note: 'Park',
        loggedAt: '2026-07-13T18:00:00.000Z',
      },
    ]);
    expect(api.listEntries).toHaveBeenCalledWith({ type: 'workout', limit: 400 });
  });

  it('HEALTH-ACT-026: a corrupt JSON payload is skipped, never rendered', async () => {
    api.listEntries.mockResolvedValue(
      ok({
        entries: [
          healthEntryRow({ id: 'broken', data: '{not json' }),
          workoutRow({ workout_type: 'walk', minutes: 20 }, { id: 'ok' }),
        ],
      })
    );

    // Rendering a broken row would show a 0-minute "other" session the user
    // never logged and would pollute every duration total on the Trends tab.
    expect((await loadWorkouts()).map((w) => w.id)).toEqual(['ok']);
  });

  it('HEALTH-ACT-027: an unknown workout type degrades to "other" with safe defaults', async () => {
    api.listEntries.mockResolvedValue(
      ok({ entries: [workoutRow({ workout_type: 'parkour' }, { id: 'srv-1' })] })
    );

    // A type the app has no label/icon for must not reach the renderer; missing
    // minutes floor at 1 so a session is never a zero-length row.
    expect(await loadWorkouts()).toMatchObject([
      { id: 'srv-1', type: 'other', minutes: 1, calories: 0, note: '' },
    ]);
  });

  it('HEALTH-ACT-012: adds a workout newest-first and stamps the local day', async () => {
    fakeEntriesServer();

    await addWorkoutEntry({ type: 'walk', minutes: 20 });
    jest.setSystemTime(new Date(2026, 6, 13, 18, 0, 0));
    const list = await addWorkoutEntry({ type: 'run', minutes: 40, calories: 380, note: 'Park' });

    expect(list.map((e) => e.type)).toEqual(['run', 'walk']);
    expect(list[0]).toMatchObject({ date: TODAY, minutes: 40, calories: 380, note: 'Park' });
    // An omitted calorie count is stored as 0, never undefined.
    expect(list[1].calories).toBe(0);
  });

  it('HEALTH-ACT-028: addWorkoutEntry posts the donor payload for one session', async () => {
    fakeEntriesServer();

    await addWorkoutEntry({ type: 'run', minutes: 40, calories: 380, note: 'Park' });

    // No explicit `startedAt` was given, so it defaults to the moment the
    // session was logged — the fake clock's `FIXED_NOW`.
    expect(api.logWorkout).toHaveBeenCalledWith({
      date: TODAY,
      workout_type: 'run',
      minutes: 40,
      calories: 380,
      note: 'Park',
      started_at: FIXED_NOW.toISOString(),
    });
  });

  it('HEALTH-ACT-013: clamps a sub-minute session to one minute rather than storing zero', async () => {
    fakeEntriesServer();
    const list = await addWorkoutEntry({ type: 'yoga', minutes: 0 });
    expect(list[0].minutes).toBe(1);
    expect(api.logWorkout).toHaveBeenCalledWith(expect.objectContaining({ minutes: 1 }));
  });

  it('HEALTH-ACT-029: trims and caps the note before it reaches the wire', async () => {
    fakeEntriesServer();

    await addWorkoutEntry({ type: 'run', minutes: 30, note: `  ${'x'.repeat(120)}  ` });

    // The note is a one-line caption on the workout card; 80 chars is the bound
    // that keeps it from wrapping the row into a paragraph.
    expect(api.logWorkout.mock.calls[0][0].note).toHaveLength(80);
  });

  it('HEALTH-ACT-014: deletes by id', async () => {
    fakeEntriesServer();
    const list = await addWorkoutEntry({ type: 'swim', minutes: 30 });

    expect(await deleteWorkoutEntry(list[0].id)).toEqual([]);
  });

  it('HEALTH-ACT-030: deleteWorkoutEntry removes the generic entry row by server id', async () => {
    fakeEntriesServer();
    const list = await addWorkoutEntry({ type: 'swim', minutes: 30 });

    // Workouts and steps share one table, so the delete goes to the generic
    // `/health/entries/:id` route rather than a workouts-specific one.
    await deleteWorkoutEntry(list[0].id);
    expect(api.deleteEntry).toHaveBeenCalledWith('srv-1');
  });
});

/* ==================================================================== */
/* 0124 — intensity is a column, and a session can be edited             */
/* ==================================================================== */

describe('healthActivityStorage — intensity (0124)', () => {
  it('HEALTH-ACT-160: sends intensity as its own field, leaving the note untouched', async () => {
    fakeEntriesServer();

    await addWorkoutEntry({
      type: 'run',
      minutes: 30,
      intensity: 'hard',
      note: 'hill repeats',
    });

    // It used to be folded into the note as `'[hard] hill repeats'`, because
    // the route's zod schema stripped every key it did not name.
    expect(api.logWorkout).toHaveBeenCalledWith({
      date: TODAY,
      workout_type: 'run',
      minutes: 30,
      calories: 0,
      note: 'hill repeats',
      intensity: 'hard',
      started_at: FIXED_NOW.toISOString(),
    });
  });

  it('HEALTH-ACT-161: omits the field entirely when no intensity was chosen', async () => {
    fakeEntriesServer();

    await addWorkoutEntry({ type: 'walk', minutes: 20 });

    // NULL on the column means "not recorded". Sending the picker's default for
    // everyone would erase that state and change a payload that has been stable
    // since P1.
    expect(api.logWorkout.mock.calls[0][0]).not.toHaveProperty('intensity');
    expect((await loadWorkouts())[0].intensity).toBe(DEFAULT_INTENSITY);
  });

  it('HEALTH-ACT-162: reads intensity off the COLUMN when the server sends one', async () => {
    api.listEntries.mockResolvedValue(
      ok({
        entries: [
          workoutRow(
            { workout_type: 'run', minutes: 40, note: 'threshold set' },
            { id: 'srv-1', intensity: 'max' }
          ),
        ],
      })
    );

    const [entry] = await loadWorkouts();
    expect(entry.intensity).toBe('max');
    expect(entry.note).toBe('threshold set');
  });

  it('HEALTH-ACT-163: falls back to the LEGACY note tag, and strips it from the text', async () => {
    api.listEntries.mockResolvedValue(
      ok({
        entries: [
          // A row written before 0124: the tag is in the note, the column is
          // NULL. 0124's backfill lifts the tag into the column but deliberately
          // does not rewrite the note, and a device holding a pre-0124 offline
          // cache has no column at all — so this reader cannot be deleted yet.
          workoutRow(
            { workout_type: 'run', minutes: 40, note: '[hard] hill repeats' },
            { id: 'legacy', intensity: null }
          ),
        ],
      })
    );

    const [entry] = await loadWorkouts();
    expect(entry.intensity).toBe('hard');
    // The machine tag must never reach the screen.
    expect(entry.note).toBe('hill repeats');
  });

  it('HEALTH-ACT-164: the COLUMN wins over a stale tag left in the note', async () => {
    api.listEntries.mockResolvedValue(
      ok({
        entries: [
          workoutRow(
            { workout_type: 'run', minutes: 40, note: '[easy] recovery' },
            { id: 'srv-1', intensity: 'max' }
          ),
        ],
      })
    );

    // After the backfill both exist. The column is the record; the tag is
    // residue, and is only stripped for display.
    const [entry] = await loadWorkouts();
    expect(entry.intensity).toBe('max');
    expect(entry.note).toBe('recovery');
  });

  it('HEALTH-ACT-165: a cache written before 0124 reads at the default, not undefined', async () => {
    // Exactly what MMKV holds after an app update: rows with no `intensity` key.
    await storageHelpers.setObject(HEALTH_WORKOUTS_KEY, [
      { id: 'cached', date: TODAY, type: 'run', minutes: 30, calories: 0, note: '', loggedAt: '2026-07-13T10:00:00.000Z' },
    ]);
    __setHealthOfflineForTests(true);

    // Without the normalisation this is `undefined`, and the screen indexes
    // WORKOUT_INTENSITY_LABELS with it on the first open after an update.
    expect((await loadWorkouts())[0].intensity).toBe(DEFAULT_INTENSITY);
  });
});

describe('healthActivityStorage — updateWorkoutEntry (0124)', () => {
  it('HEALTH-ACT-166: edits IN PLACE — same id, one row, no delete', async () => {
    const server = fakeEntriesServer();
    const created = await addWorkoutEntry({ type: 'run', minutes: 30, calories: 200 });

    const list = await updateWorkoutEntry(created[0].id, {
      type: 'run',
      minutes: 55,
      calories: 300,
    });

    // The re-record workaround wrote a second row and then tombstoned the first,
    // which minted a new id and moved the logged time.
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created[0].id);
    expect(list[0].minutes).toBe(55);
    expect(server.rows).toHaveLength(1);
    expect(api.deleteEntry).not.toHaveBeenCalled();
    expect(api.logWorkout).toHaveBeenCalledTimes(1); // only the original create
  });

  it('HEALTH-ACT-167: sends an explicit null to CLEAR a stored intensity', async () => {
    fakeEntriesServer();
    const created = await addWorkoutEntry({ type: 'run', minutes: 30, intensity: 'max' });

    const list = await updateWorkoutEntry(created[0].id, { type: 'run', minutes: 30 });

    // Omitting the key would keep 'max' forever — there would be no way to move
    // the picker back to its default once an intensity had been recorded.
    expect(api.updateWorkout).toHaveBeenCalledWith(
      'srv-1',
      expect.objectContaining({ intensity: null })
    );
    expect(list[0].intensity).toBe(DEFAULT_INTENSITY);
  });

  it('HEALTH-ACT-168: keeps the entry on its original day unless asked to move it', async () => {
    fakeEntriesServer();
    const created = await addWorkoutEntry({ type: 'run', minutes: 30, date: '2026-07-11' });

    await updateWorkoutEntry(created[0].id, { type: 'run', minutes: 45, date: '2026-07-11' });
    expect(api.updateWorkout).toHaveBeenCalledWith(
      'srv-1',
      expect.objectContaining({ date: '2026-07-11' })
    );

    // No date at all ⇒ the key is not sent, so the server keeps the stored day
    // rather than being told "today".
    await updateWorkoutEntry(created[0].id, { type: 'run', minutes: 50 });
    expect(api.updateWorkout.mock.calls[1][1]).not.toHaveProperty('date');
  });

  it('HEALTH-ACT-169: a failed edit still shows the change and reports offline', async () => {
    fakeEntriesServer();
    const created = await addWorkoutEntry({ type: 'run', minutes: 30 });
    api.updateWorkout.mockRejectedValue(NETWORK_ERROR);

    const list = await updateWorkoutEntry(created[0].id, { type: 'run', minutes: 45 });

    // Same contract as every other Health writer: the user sees what they just
    // did, and the badge says the write has not landed yet.
    expect(list[0].minutes).toBe(45);
    expect(healthSyncStateFor(HEALTH_WORKOUTS_KEY)).toBe('offline');
  });
});

describe('healthActivityStorage — steps wire contract', () => {
  it('HEALTH-ACT-016: an untouched day reads as zero steps', async () => {
    expect(await loadStepsForDate()).toBe(0);
    expect(await loadStepDays()).toEqual([]);
  });

  it('HEALTH-ACT-031: reads the steps window and unpacks the day count', async () => {
    api.listEntries.mockResolvedValue(
      ok({ entries: [stepsRow(7500, { id: 'steps-1', date: TODAY })] })
    );

    expect(await loadStepDays()).toEqual([{ date: TODAY, steps: 7500 }]);
    expect(api.listEntries).toHaveBeenCalledWith({ type: 'steps', limit: 400 });
  });

  it('HEALTH-ACT-032: a corrupt or zeroed steps row is skipped', async () => {
    api.listEntries.mockResolvedValue(
      ok({
        entries: [
          healthEntryRow({ id: 'broken', entry_type: 'steps', data: 'not json' }),
          stepsRow(0, { id: 'zero', date: '2026-07-12' }),
          stepsRow(6000, { id: 'ok', date: TODAY }),
        ],
      })
    );

    // A zero-step day is "not logged", not "logged as zero" — keeping it would
    // drag the Trends average down for every untouched day.
    expect(await loadStepDays()).toEqual([{ date: TODAY, steps: 6000 }]);
  });

  it('HEALTH-ACT-017: writing steps upserts the day rather than appending duplicates', async () => {
    fakeEntriesServer();

    await setStepsForDate(4000);
    await setStepsForDate(7500);

    expect(await loadStepDays()).toEqual([{ date: TODAY, steps: 7500 }]);
    expect(await loadStepsForDate()).toBe(7500);
  });

  it('HEALTH-ACT-033: setStepsForDate posts the day key and the clamped count', async () => {
    fakeEntriesServer();

    await setStepsForDate(7500, '2026-07-12');

    expect(api.setSteps).toHaveBeenCalledWith('2026-07-12', 7500);
  });

  it('HEALTH-ACT-018: writing zero clears the day instead of storing an empty record', async () => {
    fakeEntriesServer();
    await setStepsForDate(4000);

    expect(await setStepsForDate(0)).toEqual([]);
    expect(await loadStepsForDate()).toBe(0);
  });

  it('HEALTH-ACT-019: clamps an absurd count to the sanity bound', async () => {
    fakeEntriesServer();
    const days = await setStepsForDate(999999);

    expect(days[0].steps).toBe(200000);
    expect(api.setSteps).toHaveBeenCalledWith(TODAY, 200000);
  });

  it('HEALTH-ACT-020: keeps separate days and reads them back newest-first', async () => {
    fakeEntriesServer();

    await setStepsForDate(3000, '2026-07-12');
    await setStepsForDate(6000);

    expect(await loadStepDays()).toEqual([
      { date: TODAY, steps: 6000 },
      { date: '2026-07-12', steps: 3000 },
    ]);
    expect(await loadStepsForDate('2026-07-12')).toBe(3000);
  });
});

describe('healthActivityStorage — offline contract', () => {
  it('HEALTH-ACT-034: a failed read falls back to the cached workouts', async () => {
    await storageHelpers.setObject(HEALTH_WORKOUTS_KEY, [workout({ id: 'cached', minutes: 25 })]);
    api.listEntries.mockRejectedValue(NETWORK_ERROR);

    expect((await loadWorkouts()).map((w) => w.id)).toEqual(['cached']);
    expect(healthSyncStateFor(HEALTH_WORKOUTS_KEY)).toBe('offline');
  });

  it('HEALTH-ACT-035: an offline add returns and caches the optimistic list', async () => {
    __setHealthOfflineForTests(true);

    const list = await addWorkoutEntry({ type: 'run', minutes: 40 });

    expect(list.map((e) => e.type)).toEqual(['run']);
    expect(api.logWorkout).not.toHaveBeenCalled();
    expect((await loadWorkouts()).map((e) => e.type)).toEqual(['run']);
  });

  it('HEALTH-ACT-036: an offline steps write returns the optimistic upsert', async () => {
    await storageHelpers.setObject(HEALTH_STEPS_KEY, [{ date: '2026-07-12', steps: 3000 }]);
    __setHealthOfflineForTests(true);

    expect(await setStepsForDate(6000)).toEqual([
      { date: TODAY, steps: 6000 },
      { date: '2026-07-12', steps: 3000 },
    ]);
    expect(api.setSteps).not.toHaveBeenCalled();
    expect(healthSyncStateFor(HEALTH_STEPS_KEY)).toBe('offline');
  });

  it('HEALTH-ACT-015: drops corrupt cached workout rows on read', async () => {
    await storageHelpers.setObject(HEALTH_WORKOUTS_KEY, [
      workout({ id: 'ok' }),
      { id: 'bad-type', date: TODAY, type: 'parkour', minutes: 10, loggedAt: 'x' },
      null,
    ]);
    __setHealthOfflineForTests(true);

    expect((await loadWorkouts()).map((e) => e.id)).toEqual(['ok']);
  });

  it('HEALTH-ACT-021: a corrupt cached step store degrades to empty', async () => {
    await storageHelpers.setObject(HEALTH_STEPS_KEY, [{ date: TODAY, steps: 'lots' }, null]);
    __setHealthOfflineForTests(true);

    expect(await loadStepDays()).toEqual([]);
  });

  it('HEALTH-ACT-037: a non-array cached snapshot degrades to empty, not a crash', async () => {
    await storageHelpers.setObject(HEALTH_WORKOUTS_KEY, 'nope');
    await storageHelpers.setObject(HEALTH_STEPS_KEY, 42);
    __setHealthOfflineForTests(true);

    // Fixed 2026-07-25: `readThrough` now rejects a cached snapshot whose
    // shape does not match the caller's fallback, so a corrupt or
    // schema-drifted blob degrades to the empty state instead of throwing a
    // TypeError into the screen — on exactly the offline path the cache
    // exists to protect.
    expect(await loadWorkouts()).toEqual([]);
    expect(await loadStepDays()).toEqual([]);
  });
});

describe('healthActivityStorage — goals', () => {
  it('HEALTH-ACT-022: defaults apply until a goal is saved', async () => {
    api.getGoal.mockResolvedValue(ok({ goal: null }));
    expect(await loadActivityGoals()).toEqual(DEFAULT_ACTIVITY_GOALS);
  });

  it('HEALTH-ACT-038: reads the activity columns off the shared goal row', async () => {
    fakeGoalServer(api, { daily_workout_minutes: 45, daily_steps: 12000 });

    // Nutrition and Activity share ONE effective-dated goal row; each store only
    // reads (and writes) its own columns off it.
    expect(await loadActivityGoals()).toEqual({ minutes: 45, steps: 12000 });
  });

  it('HEALTH-ACT-023: saves a partial goal and keeps the rest', async () => {
    fakeGoalServer(api);

    const saved = await saveActivityGoals({ minutes: 45 });
    expect(saved).toEqual({ minutes: 45, steps: DEFAULT_ACTIVITY_GOALS.steps });
    expect(api.saveGoal).toHaveBeenCalledWith({
      daily_workout_minutes: 45,
      daily_steps: DEFAULT_ACTIVITY_GOALS.steps,
    });
    expect(await loadActivityGoals()).toEqual(saved);
  });

  it('HEALTH-ACT-024: a zero or negative stored goal falls back — a bar never divides by zero', async () => {
    api.getGoal.mockResolvedValue(
      ok({ goal: goalRow({ daily_workout_minutes: 0, daily_steps: -1 }) })
    );

    expect(await loadActivityGoals()).toEqual(DEFAULT_ACTIVITY_GOALS);
  });

  it('HEALTH-ACT-039: offline goals fall back to the cached targets', async () => {
    await storageHelpers.setObject(HEALTH_ACTIVITY_GOALS_KEY, { minutes: 60, steps: 10000 });
    __setHealthOfflineForTests(true);

    expect(await loadActivityGoals()).toEqual({ minutes: 60, steps: 10000 });
    expect(healthSyncStateFor(HEALTH_ACTIVITY_GOALS_KEY)).toBe('offline');
  });
});

/* ------------------------------------------------------------------ */
/* Partial and malformed rows                                          */
/* ------------------------------------------------------------------ */

describe('healthActivityStorage — partial and malformed rows', () => {
  it('HEALTH-ACT-040: a workout row with no `data` blob still renders as a session', async () => {
    // `data` is the JSON payload every workout field lives in. A row written by
    // an older build (or drifted by a migration) can arrive without it, and
    // `JSON.parse(undefined)` throws — which would drop the whole day, not just
    // the row, because the parse is inside the list mapper.
    const bare = workoutRow({}) as unknown as Record<string, unknown>;
    delete bare.data;
    api.listEntries.mockResolvedValue(ok({ entries: [bare] as never }));

    const [entry] = await loadWorkouts();
    expect(entry).toMatchObject({
      date: TODAY,
      type: 'other', // no workout_type in the payload → the catch-all
      minutes: 1, // a session is at least one whole minute
      calories: 0,
      intensity: DEFAULT_INTENSITY,
      note: '',
    });
  });

  it('HEALTH-ACT-041: a steps row with no `data`, or a null payload, counts as no steps', async () => {
    api.listEntries.mockImplementation((params) => {
      if (params?.type !== 'steps') return Promise.resolve(ok({ entries: [] }));
      // The bare fixture is a today-dated steps row; strip its payload entirely.
      const noData = stepsRow(0) as unknown as Record<string, unknown>;
      delete noData.data;
      return Promise.resolve(
        ok({
          entries: [
            noData,
            // `JSON.parse('null')` is legal and yields null — the optional chain
            // is what stops `.steps` throwing on it.
            stepsRow(0, { id: 's2', date: '2026-07-12', data: 'null' }),
            stepsRow(0, { id: 's3', date: '2026-07-11', data: '{}' }),
          ] as never,
        })
      );
    });

    // A day with no readable count is ABSENT, never a zero row — the steps
    // chart would otherwise draw a 0 the user never logged.
    expect(await loadStepDays()).toEqual([]);
    expect(await loadStepsForDate(TODAY)).toBe(0);
  });

  it('HEALTH-ACT-042: a body with no `entries` key reads as no workouts and no steps', async () => {
    api.listEntries.mockResolvedValue(ok({} as never));

    expect(await loadWorkouts()).toEqual([]);
    expect(await loadStepDays()).toEqual([]);
  });

  it('HEALTH-ACT-043: a non-string note is read as no note, not thrown on', () => {
    // The legacy `[hard] ` tag reader still runs over every cached row, and
    // `.exec` on a non-string throws inside the list mapper.
    expect(parseWorkoutNote(undefined as unknown as string)).toEqual({
      intensity: DEFAULT_INTENSITY,
      note: '',
    });
    expect(parseWorkoutNote('[hard] hill repeats')).toEqual({
      intensity: 'hard',
      note: 'hill repeats',
    });
  });

  it('HEALTH-ACT-044: editing one session leaves every OTHER session untouched', async () => {
    // The optimistic map rewrites the list before the PUT lands. Offline that
    // list IS the answer, so a comparator that matched too widely would silently
    // rewrite the wrong day's session.
    api.listEntries.mockResolvedValue(
      ok({
        entries: [
          workoutRow({ workout_type: 'run', minutes: 30 }, { id: 'w1', date: TODAY }),
          workoutRow({ workout_type: 'yoga', minutes: 45 }, { id: 'w2', date: '2026-07-12' }),
        ],
      })
    );
    await loadWorkouts();
    __setHealthOfflineForTests(true);

    const after = await updateWorkoutEntry('w1', { type: 'cycle', minutes: 20 });

    expect(after.find((e) => e.id === 'w1')).toMatchObject({
      type: 'cycle',
      minutes: 20,
      date: TODAY, // no `date` in the patch → the session keeps its own day
    });
    expect(after.find((e) => e.id === 'w2')).toMatchObject({ type: 'yoga', minutes: 45 });
  });
});

/* ==================================================================== */
/* Distance — metres on the wire, km/mi on screen                        */
/* ==================================================================== */

describe('healthActivityStorage — distance conversion + parsing', () => {
  it('HEALTH-ACT-200: distanceUnitFor follows the ONE units switch — imperial runs in mi, metric in km', () => {
    expect(distanceUnitFor('imperial')).toBe('mi');
    expect(distanceUnitFor('metric')).toBe('km');
  });

  it('HEALTH-ACT-201: metresToDisplay and displayToMetres round-trip both units', () => {
    expect(metresToDisplay(5000, 'km')).toBe(5);
    expect(metresToDisplay(1609.344, 'mi')).toBeCloseTo(1, 9);
    expect(displayToMetres(5, 'km')).toBe(5000);
    expect(displayToMetres(1, 'mi')).toBeCloseTo(1609.344, 5);
  });

  it('HEALTH-ACT-202: formatDistance refuses null, non-finite and negative readings with an em-dash', () => {
    expect(formatDistance(null, 'km')).toBe('—');
    expect(formatDistance(Number.NaN, 'km')).toBe('—');
    expect(formatDistance(-100, 'km')).toBe('—');
    expect(formatDistance(5000, 'km')).toBe('5.0 km');
    // 5000 m ≈ 3.1069 mi, one decimal.
    expect(formatDistance(5000, 'mi')).toBe('3.1 mi');
  });

  it('HEALTH-ACT-203: sanitizeDecimalInput keeps ONE decimal separator and strips a non-string', () => {
    expect(sanitizeDecimalInput('12.3.4')).toBe('12.34');
    expect(sanitizeDecimalInput('a1b2,5c')).toBe('12,5');
    expect(sanitizeDecimalInput('123')).toBe('123'); // no separator at all
    expect(sanitizeDecimalInput(42 as unknown as string)).toBe('');
  });

  it('HEALTH-ACT-204: parseDistanceInput reads blank, and a typed zero, as "not measured" — not zero', () => {
    expect(parseDistanceInput('', 'km')).toBeNull();
    expect(parseDistanceInput('   ', 'km')).toBeNull();
    expect(parseDistanceInput('0', 'km')).toBeNull();
  });

  it('HEALTH-ACT-205: parseDistanceInput refuses non-numeric, negative or non-string input', () => {
    expect(parseDistanceInput('abc', 'km')).toBeUndefined();
    expect(parseDistanceInput('-5', 'km')).toBeUndefined();
    expect(parseDistanceInput(42 as unknown as string, 'km')).toBeUndefined();
  });

  it('HEALTH-ACT-206: parseDistanceInput accepts the 500 km bound and refuses one metre past it', () => {
    expect(parseDistanceInput('500', 'km')).toBe(500_000);
    expect(parseDistanceInput('500.001', 'km')).toBeUndefined();
  });

  it('HEALTH-ACT-207: parseDistanceInput converts a comma decimal and rounds to the metre', () => {
    expect(parseDistanceInput('5,5', 'km')).toBe(5500);
    expect(parseDistanceInput('3.1', 'mi')).toBe(Math.round(3.1 * 1609.344));
  });
});

/* ==================================================================== */
/* Distance — off the wire and back onto it                              */
/* ==================================================================== */

describe('healthActivityStorage — distance on the wire', () => {
  it('HEALTH-ACT-208: a positive distance_m survives, clamped to the 500 km ceiling', async () => {
    api.listEntries.mockResolvedValue(
      ok({
        entries: [
          healthEntryRow({
            id: 'a',
            entry_type: 'workout',
            data: JSON.stringify({ workout_type: 'run', minutes: 40, distance_m: 5000 }),
          }),
          // Absurdly far — a slipped decimal, not a real session — clamped rather
          // than left to blow out every distance chart's axis.
          healthEntryRow({
            id: 'b',
            entry_type: 'workout',
            data: JSON.stringify({ workout_type: 'run', minutes: 40, distance_m: 999_000 }),
          }),
        ],
      })
    );
    const list = await loadWorkouts();
    expect(list.find((w) => w.id === 'a')?.distanceM).toBe(5000);
    expect(list.find((w) => w.id === 'b')?.distanceM).toBe(500_000);
  });

  it('HEALTH-ACT-209: a zero, negative or non-numeric distance_m reads as "not recorded", never zero', async () => {
    api.listEntries.mockResolvedValue(
      ok({
        entries: [
          healthEntryRow({
            id: 'zero',
            entry_type: 'workout',
            data: JSON.stringify({ workout_type: 'run', minutes: 40, distance_m: 0 }),
          }),
          healthEntryRow({
            id: 'neg',
            entry_type: 'workout',
            data: JSON.stringify({ workout_type: 'run', minutes: 40, distance_m: -5 }),
          }),
          healthEntryRow({
            id: 'str',
            entry_type: 'workout',
            data: JSON.stringify({ workout_type: 'run', minutes: 40, distance_m: 'far' }),
          }),
        ],
      })
    );
    const list = await loadWorkouts();
    for (const id of ['zero', 'neg', 'str']) {
      expect(list.find((w) => w.id === id)?.distanceM).toBeNull();
    }
  });

  it('HEALTH-ACT-210: startedAt reads a valid ISO string and refuses a non-string or unparsable one', async () => {
    api.listEntries.mockResolvedValue(
      ok({
        entries: [
          healthEntryRow({
            id: 'good',
            entry_type: 'workout',
            data: JSON.stringify({
              workout_type: 'run',
              minutes: 40,
              started_at: '2026-07-13T07:30:00.000Z',
            }),
          }),
          healthEntryRow({
            id: 'bad',
            entry_type: 'workout',
            data: JSON.stringify({ workout_type: 'run', minutes: 40, started_at: 'not a date' }),
          }),
          healthEntryRow({
            id: 'num',
            entry_type: 'workout',
            data: JSON.stringify({ workout_type: 'run', minutes: 40, started_at: 12345 }),
          }),
          healthEntryRow({
            id: 'empty',
            entry_type: 'workout',
            data: JSON.stringify({ workout_type: 'run', minutes: 40, started_at: '' }),
          }),
        ],
      })
    );
    const list = await loadWorkouts();
    expect(list.find((w) => w.id === 'good')?.startedAt).toBe('2026-07-13T07:30:00.000Z');
    expect(list.find((w) => w.id === 'bad')?.startedAt).toBeNull();
    expect(list.find((w) => w.id === 'num')?.startedAt).toBeNull();
    expect(list.find((w) => w.id === 'empty')?.startedAt).toBeNull();
  });

  it('HEALTH-ACT-211: addWorkoutEntry sends distance_m to the server only when one was recorded', async () => {
    fakeEntriesServer();
    await addWorkoutEntry({ type: 'run', minutes: 30, distanceM: 5000 });
    expect(api.logWorkout.mock.calls[0][0]).toMatchObject({ distance_m: 5000 });

    await addWorkoutEntry({ type: 'yoga', minutes: 30 });
    expect(api.logWorkout.mock.calls[1][0]).not.toHaveProperty('distance_m');
  });

  it('HEALTH-ACT-212: the offline queue blob only carries distance_m for a positive reading', async () => {
    __setHealthOfflineForTests(true);
    await addWorkoutEntry({ type: 'run', minutes: 30, distanceM: 5000 });
    // `entry.id` is derived from the date + the moment it was logged
    // (`${date}-${loggedAt}`); without moving the fake clock the second call
    // would mint the SAME id as the first and the outbox — which is id-keyed
    // for `health_entries` — would collapse the two into one queued row.
    jest.setSystemTime(new Date(2026, 6, 13, 18, 0, 0));
    await addWorkoutEntry({ type: 'walk', minutes: 20 });

    const outbox =
      (await storageHelpers.getObject<Array<{ row: { data: string; entry_type: string } }>>(
        HEALTH_OUTBOX_KEY
      )) ?? [];
    const blobs = outbox
      .filter((entry) => entry.row.entry_type === 'workout')
      .map((entry) => JSON.parse(entry.row.data) as Record<string, unknown>);
    expect(blobs.find((b) => b.minutes === 30)).toMatchObject({ distance_m: 5000 });
    expect(blobs.find((b) => b.minutes === 20)).not.toHaveProperty('distance_m');
  });

  it('HEALTH-ACT-213: updateWorkoutEntry sends started_at to the server only when a new one was given', async () => {
    fakeEntriesServer();
    const created = await addWorkoutEntry({ type: 'run', minutes: 30 });

    await updateWorkoutEntry(created[0].id, {
      type: 'run',
      minutes: 30,
      startedAt: '2026-07-11T08:00:00.000Z',
    });
    expect(api.updateWorkout.mock.calls[0][1]).toMatchObject({
      started_at: '2026-07-11T08:00:00.000Z',
    });

    await updateWorkoutEntry(created[0].id, { type: 'run', minutes: 35 });
    expect(api.updateWorkout.mock.calls[1][1]).not.toHaveProperty('started_at');
  });

  it('HEALTH-ACT-214: deleting an id absent from the cache is a safe no-op, queue included', async () => {
    __setHealthOfflineForTests(true);
    await expect(deleteWorkoutEntry('never-existed')).resolves.toEqual([]);
  });

  it('HEALTH-ACT-215: updating an id absent from the cache is a safe no-op, queue included', async () => {
    __setHealthOfflineForTests(true);
    await expect(
      updateWorkoutEntry('never-existed', { type: 'run', minutes: 30 })
    ).resolves.toEqual([]);
  });
});
