/**
 * Symply Health (`symply-health`) — weight / water / notes / preferences.
 *
 * Parity phase P1 moved the record of truth to the `symply-health-api` Worker,
 * so this suite now covers three layers:
 *  1. the side-effect-free helpers (parse/format/sort/delta/clamp/date), which
 *     are unchanged and still run without any I/O at all;
 *  2. the WIRE contract — the exact `healthApi` method and payload each writer
 *     sends, and how each `fromWire*` mapper turns a donor row into the shape
 *     the screens have always rendered;
 *  3. the OFFLINE contract — reads fall back to the cached MMKV snapshot, writes
 *     still return (and cache) the optimistic value, and `healthSyncStateFor`
 *     reports which of the two happened.
 *
 * Notes and preferences deliberately stayed device-local (UI state, not health
 * records), so those paths still run against the real `storageHelpers` MMKV
 * in-memory mock with no API involved.
 *
 * Privacy invariants (BRD §7) are unchanged: HealthKit + AI stay OFF regardless
 * of what was persisted, and health rows are per-USER, never household-shared.
 */

import * as e2eObservability from '@api/e2eTestObservability';
import { healthApi, type HealthWeightEntry } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  addWeightEntry,
  adjustWater,
  clampCups,
  clampTarget,
  createEmptyWaterDay,
  CUP_ML,
  dateKeyOf,
  DEFAULT_HEALTH_PREFS,
  DEFAULT_WATER_TARGET,
  deleteWeightEntry,
  formatLoggedAt,
  formatWeightValue,
  HEALTH_NOTES_KEY,
  HEALTH_UNIT_SYSTEM_KEY,
  HEALTH_WATER_HISTORY_KEY,
  HEALTH_WATER_KEY,
  HEALTH_WEIGHT_LOG_KEY,
  latestWeight,
  loadHealthPrefs,
  MAX_WEIGHT_ENTRIES,
  loadNoteForDate,
  loadNotes,
  loadWaterHistory,
  loadWaterToday,
  loadWeightLog,
  parseWeightInput,
  sanitizeWeightInput,
  saveNoteForDate,
  setPreferredUnit,
  setUnitSystem,
  setWaterTarget,
  sortEntriesDesc,
  todayDateKey,
  updateWeightEntry,
  WEIGHT_UNITS,
  weightDayOf,
  weightDelta,
  type DailyNote,
  type HealthPrefs,
  type WaterDay,
  type WeightEntry,
} from '../healthLocalStorage';
import {
  __setHealthOfflineForTests,
  clearHealthCache,
  healthSyncStateFor,
} from '../healthRepository';
import {
  fakeGoalServer,
  goalRow,
  installHealthApiDefaults,
  NETWORK_ERROR,
  ok,
  waterEntryRow,
  waterSummaryRow,
  weightRow,
  type MockedHealthApi,
} from '../test-utils/healthApiTestKit';

jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

function entry(loggedAt: string, value: number, unit: WeightEntry['unit'] = 'kg'): WeightEntry {
  // `date` defaults to the day the reading was TAKEN, which is what every row
  // written before back-dating existed looked like.
  return { id: loggedAt, value, unit, loggedAt, date: dateKeyOf(loggedAt), note: '', source: 'manual' };
}

// A fixed local noon keeps date-key derivation away from any timezone's
// midnight boundary, so `todayDateKey()` === '2026-07-13' on every machine.
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

/**
 * Stand-in for the server's water ledger: one row per logged sip.
 *
 * Every water path is a WRITE followed by a re-read (`/water/summary/daily` for
 * today, `/water/entries` for the Trends history), so a static summary mock
 * would make every adjust test assert the same zero. The daily goal rides the
 * shared goal row, hence the embedded `fakeGoalServer`.
 */
function fakeWaterServer(): { sips: Array<{ date: string; ml: number }> } {
  const goal = fakeGoalServer(api);
  const state = { sips: [] as Array<{ date: string; ml: number }> };
  const totalFor = (date: string) =>
    state.sips.filter((s) => s.date === date).reduce((sum, s) => sum + s.ml, 0);

  api.addWater.mockImplementation((body) => {
    state.sips.push({ date: body.date, ml: body.amount_ml });
    return Promise.resolve(ok({ entry: waterEntryRow({ date: body.date, amount_ml: body.amount_ml }) }));
  });
  api.undoWater.mockImplementation((date) => {
    // The route removes the most recent SIP for the day, not a fixed volume.
    const index = state.sips.map((s) => s.date).lastIndexOf(date);
    if (index >= 0) state.sips.splice(index, 1);
    return Promise.resolve(ok({ removed: index >= 0 }));
  });
  api.waterSummary.mockImplementation((date) =>
    Promise.resolve(
      ok({
        summary: waterSummaryRow({
          date,
          total_ml: totalFor(date),
          goal_ml: goal.goal.daily_water_ml,
        }),
      })
    )
  );
  api.listWater.mockImplementation(() =>
    Promise.resolve(
      ok({
        entries: state.sips.map((s, i) =>
          waterEntryRow({ id: `w-${i}`, date: s.date, amount_ml: s.ml })
        ),
      })
    )
  );
  return state;
}

beforeEach(async () => {
  await storageHelpers.clearAll();
  await clearHealthCache([]); // reset the module-level sync-state map
  __setHealthOfflineForTests(false);
  jest.resetAllMocks();
  installHealthApiDefaults(api);
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
});

/* ---------------------------------------------------------------- */
/* Pure helpers                                                      */
/* ---------------------------------------------------------------- */

describe('healthLocalStorage — parseWeightInput', () => {
  it('parses valid decimals and rounds to one place', () => {
    expect(parseWeightInput('70')).toBe(70);
    expect(parseWeightInput('70.48')).toBe(70.5);
    expect(parseWeightInput(' 70,5 ')).toBe(70.5); // comma decimal + whitespace
  });

  it('rejects empty, non-numeric, non-positive, and out-of-range input', () => {
    expect(parseWeightInput('')).toBeNull();
    expect(parseWeightInput('   ')).toBeNull();
    expect(parseWeightInput('abc')).toBeNull();
    expect(parseWeightInput('0')).toBeNull();
    expect(parseWeightInput('-5')).toBeNull();
    expect(parseWeightInput('99999')).toBeNull();
    expect(parseWeightInput('1000.1')).toBeNull(); // just past the sanity bound
  });

  it('accepts the upper sanity bound and rejects non-string input', () => {
    expect(parseWeightInput('1000')).toBe(1000);
    // Defensive guard for non-string callers.
    expect(parseWeightInput(null as unknown as string)).toBeNull();
    expect(parseWeightInput(undefined as unknown as string)).toBeNull();
  });
});

describe('healthLocalStorage — sanitizeWeightInput', () => {
  it('keeps digits and a single decimal separator', () => {
    expect(sanitizeWeightInput('70')).toBe('70');
    expect(sanitizeWeightInput('70.5')).toBe('70.5');
    expect(sanitizeWeightInput('70,5')).toBe('70,5'); // comma separator preserved
  });

  it('strips letters and symbols — a numeric field must never hold them', () => {
    expect(sanitizeWeightInput('abc')).toBe('');
    expect(sanitizeWeightInput('7a0b')).toBe('70');
    expect(sanitizeWeightInput('68 kg')).toBe('68');
    expect(sanitizeWeightInput('-5')).toBe('5');
    expect(sanitizeWeightInput('$70.5!')).toBe('70.5');
  });

  it('collapses repeated separators to the first one entered', () => {
    expect(sanitizeWeightInput('70.5.3')).toBe('70.53');
    expect(sanitizeWeightInput('70,5,3')).toBe('70,53');
    expect(sanitizeWeightInput('70.5,3')).toBe('70.53');
  });

  it('recovers the field-merge corruption seen in E2E (note text into weight)', () => {
    // Observed on-device: note text + water digits merged into the weight input.
    expect(sanitizeWeightInput('2Slept well, energetic8')).toBe('2,8');
    // …and the sanitized remainder must still be parseable or safely rejected.
    expect(parseWeightInput(sanitizeWeightInput('2Slept well, energetic8'))).toBe(2.8);
  });

  it('returns an empty string for non-string input', () => {
    expect(sanitizeWeightInput(null as unknown as string)).toBe('');
    expect(sanitizeWeightInput(undefined as unknown as string)).toBe('');
  });
});

describe('healthLocalStorage — formatWeightValue', () => {
  it('omits a trailing .0 but keeps real decimals', () => {
    expect(formatWeightValue(70)).toBe('70');
    expect(formatWeightValue(70.5)).toBe('70.5');
  });
});

describe('healthLocalStorage — ordering & latest', () => {
  it('sorts newest-first and returns the latest entry', () => {
    const unsorted = [
      entry('2026-07-10T08:00:00.000Z', 71),
      entry('2026-07-12T08:00:00.000Z', 70),
      entry('2026-07-11T08:00:00.000Z', 70.5),
    ];
    const sorted = sortEntriesDesc(unsorted);
    expect(sorted.map((e) => e.value)).toEqual([70, 70.5, 71]);
    expect(latestWeight(sorted)?.value).toBe(70);
    expect(latestWeight([])).toBeNull();
  });

  it('does not mutate the input array', () => {
    const input = [
      entry('2026-07-10T08:00:00.000Z', 71),
      entry('2026-07-12T08:00:00.000Z', 70),
    ];
    sortEntriesDesc(input);
    expect(input.map((e) => e.value)).toEqual([71, 70]); // original order intact
  });
});

describe('healthLocalStorage — weightDelta', () => {
  it('computes the delta between the two most recent same-unit entries', () => {
    const entries = sortEntriesDesc([
      entry('2026-07-12T08:00:00.000Z', 70),
      entry('2026-07-11T08:00:00.000Z', 72),
    ]);
    expect(weightDelta(entries)).toEqual({ value: -2, unit: 'kg' });
  });

  it('returns null when units differ (no misleading conversion)', () => {
    const entries = sortEntriesDesc([
      entry('2026-07-12T08:00:00.000Z', 154, 'lb'),
      entry('2026-07-11T08:00:00.000Z', 70, 'kg'),
    ]);
    expect(weightDelta(entries)).toBeNull();
  });

  it('returns null with fewer than two entries', () => {
    expect(weightDelta([])).toBeNull();
    expect(weightDelta([entry('2026-07-12T08:00:00.000Z', 70)])).toBeNull();
  });
});

describe('healthLocalStorage — date helpers', () => {
  it('todayDateKey uses the local calendar date', () => {
    expect(todayDateKey()).toBe(TODAY);
  });

  it('dateKeyOf zero-pads month and day', () => {
    expect(dateKeyOf(new Date(2026, 0, 5, 12, 0, 0).toISOString())).toBe('2026-01-05');
    expect(dateKeyOf(new Date(2026, 11, 31, 12, 0, 0).toISOString())).toBe('2026-12-31');
  });

  it('formatLoggedAt labels Today / Yesterday and falls back to the date key', () => {
    expect(formatLoggedAt(new Date(2026, 6, 13, 9, 0, 0).toISOString())).toBe('Today');
    expect(formatLoggedAt(new Date(2026, 6, 12, 9, 0, 0).toISOString())).toBe('Yesterday');
    expect(formatLoggedAt(new Date(2026, 6, 1, 9, 0, 0).toISOString())).toBe('2026-07-01');
  });
});

/* ---------------------------------------------------------------- */
/* Weight log — wire contract                                        */
/* ---------------------------------------------------------------- */

describe('healthLocalStorage — weight log wire contract', () => {
  it('HEALTH-STORE-034: reads the capped window and maps rows to the screen shape', async () => {
    api.listWeight.mockResolvedValue(
      ok({
        entries: [
          weightRow({ id: 'a', weight: 71, created_at: '2026-07-11T08:00:00.000Z' }),
          weightRow({ id: 'b', weight: 70, created_at: '2026-07-12T08:00:00.000Z' }),
        ],
      })
    );

    // `limit` is the ONLY cap now — the client no longer trims the list itself,
    // so a changed limit here silently changes what every Health screen shows.
    expect(await loadWeightLog()).toEqual<WeightEntry[]>([
      // `date` is the row's OWN day column, not the timestamp's — a back-dated
      // reading belongs to the day it was taken, not the day it was typed.
      {
        id: 'b',
        value: 70,
        unit: 'kg',
        loggedAt: '2026-07-12T08:00:00.000Z',
        date: '2026-07-13',
        note: '',
        source: 'manual',
      },
      {
        id: 'a',
        value: 71,
        unit: 'kg',
        loggedAt: '2026-07-11T08:00:00.000Z',
        date: '2026-07-13',
        note: '',
        source: 'manual',
      },
    ]);
    // The window is what makes PAST-window navigation possible: 100 rows is
    // about three months for a daily weigher, so the ◀ button would run out of
    // data almost immediately.
    expect(api.listWeight).toHaveBeenCalledWith({ limit: MAX_WEIGHT_ENTRIES });
    expect(healthSyncStateFor(HEALTH_WEIGHT_LOG_KEY)).toBe('synced');
  });

  it('HEALTH-STORE-035: maps the donor unit alias "lbs" onto the app\'s "lb"', async () => {
    api.listWeight.mockResolvedValue(ok({ entries: [weightRow({ weight: 154, unit: 'lbs' })] }));

    // The server still accepts the donor's spelling; the app has only ever
    // rendered 'lb', and `weightDelta` compares units by string equality — a
    // leaked 'lbs' would silently suppress every trend chip.
    const log = await loadWeightLog();
    expect(log[0].unit).toBe('lb');
    expect(WEIGHT_UNITS).toContain(log[0].unit);
  });

  it('HEALTH-STORE-036: falls back to a midday stamp when a row has no created_at', async () => {
    api.listWeight.mockResolvedValue(
      ok({
        entries: [
          weightRow({ date: '2026-07-09', created_at: undefined as unknown as string }),
        ],
      })
    );

    // Midday (not midnight) so the derived local day-key cannot slip to the
    // previous date in a negative-offset timezone.
    expect((await loadWeightLog())[0].loggedAt).toBe('2026-07-09T12:00:00.000Z');
  });

  it('HEALTH-STORE-037: addWeightEntry posts exactly {date, weight, unit}', async () => {
    api.listWeight.mockResolvedValue(ok({ entries: [] }));
    api.createWeight.mockImplementation(() => {
      // The refreshed read is what the screen renders, so the row only appears
      // once the server has it.
      api.listWeight.mockResolvedValue(
        ok({ entries: [weightRow({ id: 'srv', weight: 72, unit: 'kg' })] })
      );
      return Promise.resolve(ok({ entry: weightRow() }));
    });

    const next = await addWeightEntry(72, 'kg');

    expect(api.createWeight).toHaveBeenCalledWith({ date: TODAY, weight: 72, unit: 'kg' });
    expect(next).toEqual<WeightEntry[]>([
      {
        id: 'srv',
        value: 72,
        unit: 'kg',
        loggedAt: '2026-07-13T08:00:00.000Z',
        date: '2026-07-13',
        note: '',
        source: 'manual',
      },
    ]);
  });

  it('HEALTH-STORE-038: deleteWeightEntry deletes by server id and re-reads the list', async () => {
    api.listWeight.mockResolvedValue(
      ok({ entries: [weightRow({ id: 'keep' }), weightRow({ id: 'drop' })] })
    );
    api.deleteWeight.mockImplementation(() => {
      api.listWeight.mockResolvedValue(ok({ entries: [weightRow({ id: 'keep' })] }));
      return Promise.resolve(ok({ deleted: true }));
    });

    const next = await deleteWeightEntry('drop');

    expect(api.deleteWeight).toHaveBeenCalledWith('drop');
    expect(next.map((e) => e.id)).toEqual(['keep']);
  });

  it('HEALTH-STORE-039: a server read is mirrored into MMKV for the next cold start', async () => {
    api.listWeight.mockResolvedValue(ok({ entries: [weightRow({ id: 'srv', weight: 68 })] }));

    await loadWeightLog();

    expect(await storageHelpers.getObject<WeightEntry[]>(HEALTH_WEIGHT_LOG_KEY)).toEqual([
      {
        id: 'srv',
        value: 68,
        unit: 'kg',
        loggedAt: '2026-07-13T08:00:00.000Z',
        date: '2026-07-13',
        note: '',
        source: 'manual',
      },
    ]);
  });
});

/* ---------------------------------------------------------------- */
/* Weight log — offline contract                                     */
/* ---------------------------------------------------------------- */

describe('healthLocalStorage — weight log offline contract', () => {
  it('HEALTH-STORE-040: a failed read falls back to the cached snapshot', async () => {
    await storageHelpers.setObject(HEALTH_WEIGHT_LOG_KEY, [entry('2026-07-12T08:00:00.000Z', 70)]);
    api.listWeight.mockRejectedValue(NETWORK_ERROR);

    // Logging happens in gyms and basements: a dropped request must show the
    // last-known log, never an empty screen and never a raw error string.
    expect((await loadWeightLog()).map((e) => e.value)).toEqual([70]);
    expect(healthSyncStateFor(HEALTH_WEIGHT_LOG_KEY)).toBe('offline');
  });

  it('HEALTH-STORE-041: an offline add returns and caches the optimistic list', async () => {
    await storageHelpers.setObject(HEALTH_WEIGHT_LOG_KEY, [entry('2026-07-12T08:00:00.000Z', 70)]);
    __setHealthOfflineForTests(true);

    const next = await addWeightEntry(71.5, 'kg');

    expect(next.map((e) => e.value)).toEqual([71.5, 70]); // newest first
    expect(api.createWeight).not.toHaveBeenCalled();
    // Cached, so the entry is still there after a relaunch with no signal.
    expect((await loadWeightLog()).map((e) => e.value)).toEqual([71.5, 70]);
    expect(healthSyncStateFor(HEALTH_WEIGHT_LOG_KEY)).toBe('offline');
  });

  it('HEALTH-STORE-042: an offline delete removes the row from the optimistic list', async () => {
    await storageHelpers.setObject(HEALTH_WEIGHT_LOG_KEY, [
      entry('a', 70),
      entry('b', 71),
      entry('c', 72),
    ]);
    __setHealthOfflineForTests(true);

    const next = await deleteWeightEntry('b');

    expect(next.map((e) => e.id).sort()).toEqual(['a', 'c']);
    expect(await loadWeightLog()).toHaveLength(2);
  });

  it('HEALTH-STORE-043: a non-array cached snapshot degrades to empty, not a crash', async () => {
    await storageHelpers.setObject(HEALTH_WEIGHT_LOG_KEY, { not: 'an array' });
    __setHealthOfflineForTests(true);

    // Fixed 2026-07-25: `readThrough` now rejects a cached snapshot whose
    // shape does not match the caller's fallback, so a corrupt or
    // schema-drifted blob degrades to the empty state instead of throwing a
    // TypeError into the screen — on exactly the offline path the cache
    // exists to protect.
    expect(await loadWeightLog()).toEqual([]);
  });

  it('drops corrupt entries from the cached snapshot and returns the rest newest-first', async () => {
    await storageHelpers.setObject(HEALTH_WEIGHT_LOG_KEY, [
      entry('2026-07-11T08:00:00.000Z', 71),
      null,
      { id: 'x', unit: 'kg', loggedAt: '2026-07-10T08:00:00.000Z' }, // no finite value
      entry('2026-07-12T08:00:00.000Z', 70),
    ]);
    __setHealthOfflineForTests(true);

    expect((await loadWeightLog()).map((e) => e.value)).toEqual([70, 71]);
  });

  it('HEALTH-STORE-017: entry id is loggedAt — same-ms offline adds collide on id', async () => {
    __setHealthOfflineForTests(true);
    jest.setSystemTime(new Date(2026, 6, 13, 10, 0, 0));

    const first = await addWeightEntry(70, 'kg');
    const second = await addWeightEntry(71, 'kg');

    // Both share the same ISO id (= loggedAt) within one millisecond. Online the
    // server hands out real ids, so this only bites the offline optimistic list.
    expect(first[0].id).toBe(second[0].id);
    expect(first[0].id).toBe(first[0].loggedAt);
    expect(second.filter((e) => e.id === second[0].id).length).toBeGreaterThanOrEqual(1);
  });

  it('HEALTH-STORE-022: deleting an unknown id still issues the request and the record', async () => {
    const persistSpy = jest.spyOn(e2eObservability, 'recordE2EPersistEntry');
    api.listWeight.mockResolvedValue(
      ok({ entries: [weightRow({ id: 'a', weight: 70 }), weightRow({ id: 'b', weight: 71 })] })
    );

    const next = await deleteWeightEntry('does-not-exist');

    expect(next.map((e) => e.value)).toEqual([70, 71]); // untouched

    // DEFECT (HEALTH-STORE-022): a no-op delete should short-circuit. Instead a
    // DELETE is sent for an id that was never in the list, and a 'delete' entry
    // is emitted, which makes the E2E persist log lie about what happened.
    expect(api.deleteWeight).toHaveBeenCalledWith('does-not-exist');
    expect(persistSpy).toHaveBeenCalledWith({
      store: HEALTH_WEIGHT_LOG_KEY,
      operation: 'update',
      detail: 'delete id=does-not-exist',
    });

    persistSpy.mockRestore();
  });
});

/* ---------------------------------------------------------------- */
/* Weight log — rows written by an older build, and provenance       */
/* ---------------------------------------------------------------- */

describe('healthLocalStorage — legacy rows and provenance', () => {
  const OLDER = new Date(2026, 6, 11, 8, 0, 0).toISOString();
  const NEWER = new Date(2026, 6, 12, 8, 0, 0).toISOString();

  it('HEALTH-STORE-063: a row from before the `date` column belongs to the day it was logged', () => {
    // `date` landed after `HEALTH_WEIGHT_LOG_KEY` did, so a handset that has not
    // synced since carries rows without it. Deriving the day from `loggedAt` is
    // exactly what every pre-0125 screen did — and the ordering, which is by DAY
    // and not by timestamp, has to survive the missing column.
    const legacy = (loggedAt: string, value: number): WeightEntry =>
      ({ id: loggedAt, value, unit: 'kg', loggedAt, note: '' } as unknown as WeightEntry);

    expect(weightDayOf({ loggedAt: OLDER })).toBe('2026-07-11');
    expect(sortEntriesDesc([legacy(OLDER, 71), legacy(NEWER, 70)]).map((e) => e.value)).toEqual([
      70, 71,
    ]);
  });

  it('HEALTH-STORE-064: an imported reading arrives flagged, so the UI can mark it', async () => {
    api.listWeight.mockResolvedValue(
      ok({ entries: [weightRow({ id: 'hk', source: 'healthkit' }), weightRow({ id: 'typed' })] })
    );

    // 0122. A member who sees an unexplained number has to be able to tell an
    // Apple Health reading from one they typed before deciding to correct it.
    // Anything that is not the literal 'healthkit' is a typed reading — a Worker
    // older than 0122 sends no `source` at all.
    const log = await loadWeightLog();
    expect(log.find((e) => e.id === 'hk')?.source).toBe('healthkit');
    expect(log.find((e) => e.id === 'typed')?.source).toBe('manual');
  });

  it('HEALTH-STORE-065: an offline snapshot from an older build is repaired on read', async () => {
    await storageHelpers.setObject(HEALTH_WEIGHT_LOG_KEY, [
      // No `date` and no `note` — the two fields that arrived after this cache
      // key did — on a row that WAS imported, so the flag has to survive too.
      { id: 'old', value: 70, unit: 'kg', loggedAt: NEWER, source: 'healthkit' },
    ]);
    __setHealthOfflineForTests(true);

    expect(await loadWeightLog()).toEqual<WeightEntry[]>([
      {
        id: 'old',
        value: 70,
        unit: 'kg',
        loggedAt: NEWER,
        date: '2026-07-12',
        note: '',
        source: 'healthkit',
      },
    ]);
  });

  it('HEALTH-STORE-066: a note travels with a new reading; a blank one is omitted', async () => {
    api.listWeight.mockResolvedValue(ok({ entries: [] }));

    await addWeightEntry(72, 'kg', { date: '2026-07-11', note: '  after the gym  ' });
    expect(api.createWeight).toHaveBeenCalledWith({
      date: '2026-07-11', // back-dated: the day it was TAKEN, not the day it was typed
      weight: 72,
      unit: 'kg',
      note: 'after the gym', // trimmed
    });

    api.createWeight.mockClear();
    await addWeightEntry(72, 'kg', { note: '   ' });
    // Omitted rather than sent empty: the column is nullable and an empty string
    // is not the same as "no note" once it is read back.
    expect(api.createWeight).toHaveBeenCalledWith({ date: TODAY, weight: 72, unit: 'kg' });
  });
});

/* ---------------------------------------------------------------- */
/* Weight log — editing a reading in place                           */
/* ---------------------------------------------------------------- */

/**
 * Stand-in for `/weight/entries` with a working PUT.
 *
 * Every writer re-reads the log after writing, so a static list mock would
 * report each correction as lost.
 */
function fakeWeightServer(rows: HealthWeightEntry[]): { rows: HealthWeightEntry[] } {
  const state = { rows: [...rows] };
  api.listWeight.mockImplementation(() => Promise.resolve(ok({ entries: [...state.rows] })));
  api.updateWeight.mockImplementation((id, body) => {
    state.rows = state.rows.map((row) =>
      row.id === id ? ({ ...row, ...body } as HealthWeightEntry) : row
    );
    return Promise.resolve(ok({ entry: state.rows.find((r) => r.id === id) as HealthWeightEntry }));
  });
  return state;
}

describe('healthLocalStorage — updateWeightEntry', () => {
  const MONDAY = new Date(2026, 6, 12, 8, 0, 0).toISOString();
  const SUNDAY = new Date(2026, 6, 11, 8, 0, 0).toISOString();

  function twoReadings() {
    return fakeWeightServer([
      weightRow({ id: 'a', date: '2026-07-12', weight: 70, note: 'morning', created_at: MONDAY }),
      weightRow({ id: 'b', date: '2026-07-11', weight: 71, note: null, created_at: SUNDAY }),
    ]);
  }

  it('HEALTH-STORE-067: a correction PUTs the changed columns and keeps the row’s identity', async () => {
    twoReadings();

    const next = await updateWeightEntry('a', {
      value: 69.5,
      unit: 'lb',
      date: '2026-07-10',
      note: 'after the gym',
    });

    // `source: 'manual'` rides along because the FIGURE changed — see
    // HEALTH-STORE-071. It is part of the correction, not an extra field.
    expect(api.updateWeight).toHaveBeenCalledWith('a', {
      weight: 69.5,
      unit: 'lb',
      date: '2026-07-10',
      note: 'after the gym',
      source: 'manual',
    });
    // The whole point of a real PUT: delete-then-re-add minted a new row id and a
    // new `created_at`, which threw the corrected reading to the top of the list.
    expect(api.createWeight).not.toHaveBeenCalled();
    expect(api.deleteWeight).not.toHaveBeenCalled();
    expect(next.find((e) => e.id === 'a')).toEqual<WeightEntry>({
      id: 'a',
      value: 69.5,
      unit: 'lb',
      loggedAt: MONDAY, // unchanged — this is not a new reading
      date: '2026-07-10',
      note: 'after the gym',
      source: 'manual',
    });
    // The other reading is not touched.
    expect(next.find((e) => e.id === 'b')).toMatchObject({ value: 71, date: '2026-07-11' });
  });

  it('HEALTH-STORE-068: a one-field patch sends ONLY that field', async () => {
    twoReadings();

    await updateWeightEntry('a', { value: 69.5 });

    // The route spreads whatever it is given straight onto the row, so sending a
    // column the member did not touch would restate it — and re-dating a reading
    // moves it between weeks, which triggers a weekly-average recompute.
    // "Only that field" plus the origin claim the figure change implies.
    expect(api.updateWeight).toHaveBeenCalledWith('a', {
      weight: 69.5,
      source: 'manual',
    });
  });

  it('HEALTH-STORE-069: an offline correction keeps every field it did not touch', async () => {
    await storageHelpers.setObject(HEALTH_WEIGHT_LOG_KEY, [
      {
        id: 'a',
        value: 70,
        unit: 'kg',
        loggedAt: MONDAY,
        date: '2026-07-12',
        note: 'morning',
        source: 'manual',
      },
      {
        id: 'b',
        value: 71,
        unit: 'kg',
        loggedAt: SUNDAY,
        date: '2026-07-11',
        note: '',
        source: 'manual',
      },
    ]);
    __setHealthOfflineForTests(true);

    const next = await updateWeightEntry('a', { value: 69.5 });

    // Offline the OPTIMISTIC row is what the member sees, so the merge has to be
    // right on its own — the server is not there to restate the untouched fields.
    expect(api.updateWeight).not.toHaveBeenCalled();
    expect(next.find((e) => e.id === 'a')).toEqual<WeightEntry>({
      id: 'a',
      value: 69.5,
      unit: 'kg',
      loggedAt: MONDAY,
      date: '2026-07-12',
      note: 'morning',
      source: 'manual',
    });
    expect(next.find((e) => e.id === 'b')?.value).toBe(71);
    // …and it is what the NEXT read gives back, after a relaunch with no signal.
    expect((await loadWeightLog()).find((e) => e.id === 'a')?.value).toBe(69.5);
    expect(healthSyncStateFor(HEALTH_WEIGHT_LOG_KEY)).toBe('offline');
  });

  it('HEALTH-STORE-070: `note: null` un-records the note; omitting the key keeps it', async () => {
    twoReadings();

    // Absent and null are two different instructions and the wire carries the
    // difference: the column is nullable, so only an explicit null clears it.
    await updateWeightEntry('a', { note: null });
    expect(api.updateWeight).toHaveBeenLastCalledWith('a', { note: null });
    expect((await loadWeightLog()).find((e) => e.id === 'a')?.note).toBe('');

    await updateWeightEntry('a', { value: 68 });
    // Annotating alone sends no origin; changing the figure does.
    expect(api.updateWeight).toHaveBeenLastCalledWith('a', {
      weight: 68,
      source: 'manual',
    });
    expect((await loadWeightLog()).find((e) => e.id === 'a')).toMatchObject({
      value: 68,
      note: '',
    });
  });

  it('HEALTH-STORE-071: correcting an IMPORTED reading claims it as the member’s own', async () => {
    // Was a pinned DEFECT, fixed 2026-07-26. A reading the member corrected by
    // hand stayed flagged `healthkit`, and `planWeightImport` protects only rows
    // whose origin is NOT healthkit (HEALTH-HK-160/161) — so the next Apple
    // Health sync saw "an imported row whose figure changed" and replaced the
    // correction, breaking the one thing rule 4 of healthKit.ts promises. The
    // route now accepts an origin on update.
    fakeWeightServer([
      weightRow({ id: 'hk', date: '2026-07-12', weight: 70, source: 'healthkit', created_at: MONDAY }),
    ]);

    const next = await updateWeightEntry('hk', { value: 68.5 });

    expect(next[0]).toMatchObject({ id: 'hk', value: 68.5, source: 'manual' });
    expect(api.updateWeight).toHaveBeenCalledWith('hk', { weight: 68.5, source: 'manual' });
  });

  it('HEALTH-STORE-072: re-dating or annotating alone does NOT re-origin the reading', async () => {
    // Typing over a FIGURE is a statement of ownership. Moving the day it belongs
    // to, or adding a note, is not — the reading is still the one the scale took,
    // and the sync should carry on maintaining it.
    fakeWeightServer([
      weightRow({ id: 'hk', date: '2026-07-12', weight: 70, source: 'healthkit', created_at: MONDAY }),
    ]);

    const next = await updateWeightEntry('hk', { note: 'after a long run' });

    expect(next[0]).toMatchObject({ id: 'hk', value: 70, source: 'healthkit' });
    expect(api.updateWeight.mock.calls[0][1]).not.toHaveProperty('source');
  });
});

/* ---------------------------------------------------------------- */
/* Preferences — the ONE global unit system (0141, server-synced)   */
/* + shell invariants (device-local)                                */
/* ---------------------------------------------------------------- */

describe('healthLocalStorage — preferences', () => {
  it('defaults HealthKit and AI to off, and the unit system to metric', () => {
    expect(DEFAULT_HEALTH_PREFS.healthKitEnabled).toBe(false);
    expect(DEFAULT_HEALTH_PREFS.aiEnabled).toBe(false);
    expect(DEFAULT_HEALTH_PREFS.unitSystem).toBe('metric');
    expect(DEFAULT_HEALTH_PREFS.preferredUnit).toBe('kg');
    expect(WEIGHT_UNITS).toEqual(['kg', 'lb']);
  });

  it('loadHealthPrefs reads the unit system from the shared goal row and derives preferredUnit, but forces the shell OFF invariants', async () => {
    fakeGoalServer(api, { unit_system: 'imperial' });

    const prefs = await loadHealthPrefs();
    expect(prefs).toEqual<HealthPrefs>({
      unitSystem: 'imperial',
      preferredUnit: 'lb', // derived, never independently stored
      healthKitEnabled: false,
      aiEnabled: false,
    });
  });

  it('HEALTH-STORE-044: the unit system IS synced server-side (0141) — unlike the note, which stays local', async () => {
    // Retired the donor's device-local-only unit toggle: a choice made once
    // during onboarding should not have to be repeated on a second device,
    // the same reasoning `water_unit` (0140) already established.
    const goal = fakeGoalServer(api, { unit_system: null });
    await setUnitSystem('imperial');

    expect(api.saveGoal).toHaveBeenCalledWith(expect.objectContaining({ unit_system: 'imperial' }));
    expect(goal.goal.unit_system).toBe('imperial');
  });

  it('falls back to defaults when the Worker predates 0141 (key absent, not null)', async () => {
    fakeGoalServer(api); // goalRow() with no `unit_system` key at all
    expect(await loadHealthPrefs()).toEqual(DEFAULT_HEALTH_PREFS);
  });

  it('setUnitSystem writes through the shared goal row, and setPreferredUnit is a thin compatibility wrapper over the same value', async () => {
    const goal = fakeGoalServer(api, { unit_system: null });

    const afterImperial = await setUnitSystem('imperial');
    expect(afterImperial.unitSystem).toBe('imperial');
    expect(afterImperial.preferredUnit).toBe('lb');
    expect((await loadHealthPrefs()).unitSystem).toBe('imperial');

    // kg/lb was never a second, independent preference — `setPreferredUnit`
    // just flips the same global switch `setUnitSystem` does.
    const afterKg = await setPreferredUnit('kg');
    expect(afterKg.unitSystem).toBe('metric');
    expect(afterKg.preferredUnit).toBe('kg');
    expect(goal.goal.unit_system).toBe('metric');
  });

  it('coerces an unknown unit system to metric rather than passing it through', async () => {
    fakeGoalServer(api, { unit_system: 'stone' as never });
    expect((await loadHealthPrefs()).unitSystem).toBe('metric');

    expect(await setUnitSystem('stone' as never)).toMatchObject({ unitSystem: 'metric' });
  });

  it('a pre-0141 Worker keeps the cached unit system rather than resetting to metric', async () => {
    fakeGoalServer(api, { unit_system: 'imperial' });
    expect((await loadHealthPrefs()).unitSystem).toBe('imperial');

    // Now simulate a Worker that predates 0141 — the key is OMITTED, not null.
    api.getGoal.mockResolvedValue(ok({ goal: goalRow() }));
    expect((await loadHealthPrefs()).unitSystem).toBe('imperial');
  });
});

/* ---------------------------------------------------------------- */
/* Water — clamps                                                    */
/* ---------------------------------------------------------------- */

describe('healthLocalStorage — water clamps', () => {
  it('clamps cups to [0, 30] and rounds', () => {
    expect(clampCups(-3)).toBe(0);
    expect(clampCups(5)).toBe(5);
    expect(clampCups(4.6)).toBe(5);
    expect(clampCups(999)).toBe(30);
    expect(clampCups(NaN)).toBe(0);
  });

  it('clamps target to [1, 30], falling back to default', () => {
    expect(clampTarget(0)).toBe(DEFAULT_WATER_TARGET);
    expect(clampTarget(-1)).toBe(DEFAULT_WATER_TARGET);
    expect(clampTarget(NaN)).toBe(DEFAULT_WATER_TARGET);
    expect(clampTarget(10)).toBe(10);
    expect(clampTarget(999)).toBe(30);
  });

  it('creates an empty day with a clamped target', () => {
    const day = createEmptyWaterDay('2026-07-12', 8);
    expect(day).toEqual({ date: '2026-07-12', cups: 0, target: 8 });
    expect(createEmptyWaterDay('2026-07-12', 0).target).toBe(DEFAULT_WATER_TARGET);
  });

  it('defaults createEmptyWaterDay to today with the default target', () => {
    expect(createEmptyWaterDay()).toEqual<WaterDay>({
      date: TODAY,
      cups: 0,
      target: DEFAULT_WATER_TARGET,
    });
  });

  it('HEALTH-STORE-029: clampCups collapses both infinities to 0', () => {
    // DEFECT (HEALTH-STORE-029): +Infinity means "as many as possible" far more
    // than it means "none" — clamping it to MAX_CUPS (30) would be the least
    // surprising behaviour. Both infinities currently collapse to 0.
    expect(clampCups(Infinity)).toBe(0);
    expect(clampCups(-Infinity)).toBe(0);
  });
});

/* ---------------------------------------------------------------- */
/* Water — wire contract                                             */
/* ---------------------------------------------------------------- */

describe('healthLocalStorage — water wire contract', () => {
  it('HEALTH-STORE-045: converts the server millilitre total into whole cups', async () => {
    api.waterSummary.mockResolvedValue(
      ok({ summary: waterSummaryRow({ total_ml: 3 * CUP_ML, goal_ml: 10 * CUP_ML }) })
    );

    // A cup is the donor's 240 ml; the server only ever stores millilitres, so
    // this conversion is the single place the ring's number comes from.
    expect(await loadWaterToday()).toEqual<WaterDay>({ date: TODAY, cups: 3, target: 10 });
    expect(api.waterSummary).toHaveBeenCalledWith(TODAY);
  });

  it('HEALTH-STORE-046: an unset goal keeps the last known local target', async () => {
    await storageHelpers.setObject(HEALTH_WATER_KEY, { date: TODAY, cups: 0, target: 12 });
    api.waterSummary.mockResolvedValue(ok({ summary: waterSummaryRow({ goal_ml: null }) }));

    // Without this fallback an account with no goal row would reset every
    // device's ring back to 8 cups on the next launch.
    expect((await loadWaterToday()).target).toBe(12);
  });

  it('HEALTH-STORE-047: +1 posts one cup of millilitres, −1 undoes the last sip', async () => {
    fakeWaterServer();

    expect((await adjustWater(1)).cups).toBe(1);
    expect(api.addWater).toHaveBeenCalledWith({ date: TODAY, amount_ml: CUP_ML });

    expect((await adjustWater(-1)).cups).toBe(0);
    // "Minus" is an UNDO, never a negative entry — a negative volume would
    // corrupt every downstream average.
    expect(api.undoWater).toHaveBeenCalledWith(TODAY);
  });

  it('HEALTH-STORE-048: a multi-cup add writes ONE entry, so one undo removes them all', async () => {
    const server = fakeWaterServer();

    await adjustWater(2);
    expect(api.addWater).toHaveBeenCalledWith({ date: TODAY, amount_ml: 2 * CUP_ML });
    expect(server.sips).toEqual([{ date: TODAY, ml: 2 * CUP_ML }]);

    // The shipped ± control only ever sends ±1, so this asymmetry is currently
    // unreachable in the UI — pinned so a future "+N" affordance cannot ship
    // without noticing that one tap of "−" would wipe all N.
    expect((await adjustWater(-1)).cups).toBe(0);
  });

  it('HEALTH-STORE-049: setWaterTarget saves the goal in millilitres', async () => {
    fakeWaterServer();
    await adjustWater(4);

    const updated = await setWaterTarget(12);

    expect(api.saveGoal).toHaveBeenCalledWith({ daily_water_ml: 12 * CUP_ML });
    expect(updated).toEqual<WaterDay>({ date: TODAY, cups: 4, target: 12 });
    expect((await setWaterTarget(0)).target).toBe(DEFAULT_WATER_TARGET); // invalid → default
  });
});

/* ---------------------------------------------------------------- */
/* Water — offline + edge cases                                      */
/* ---------------------------------------------------------------- */

describe('healthLocalStorage — water offline & edge cases', () => {
  it('HEALTH-STORE-050: an offline adjust returns the optimistic count and caches it', async () => {
    await storageHelpers.setObject(HEALTH_WATER_KEY, { date: TODAY, cups: 2, target: 8 });
    __setHealthOfflineForTests(true);

    expect((await adjustWater(1)).cups).toBe(3);
    expect(api.addWater).not.toHaveBeenCalled();
    expect((await loadWaterToday()).cups).toBe(3);
    expect(healthSyncStateFor(HEALTH_WATER_KEY)).toBe('offline');
  });

  it('HEALTH-STORE-051: an offline snapshot from yesterday resets cups but carries the target', async () => {
    await storageHelpers.setObject(HEALTH_WATER_KEY, { date: '2026-07-12', cups: 6, target: 10 });
    __setHealthOfflineForTests(true);

    // Online the server always answers for TODAY, so this rollover branch only
    // ever runs against a stale cache — which is exactly when it matters.
    expect(await loadWaterToday()).toEqual<WaterDay>({ date: TODAY, cups: 0, target: 10 });
  });

  it('HEALTH-STORE-052: an offline day clamps a corrupt cached count and target', async () => {
    await storageHelpers.setObject(HEALTH_WATER_KEY, { date: TODAY, cups: 99, target: 999 });
    __setHealthOfflineForTests(true);

    expect(await loadWaterToday()).toEqual<WaterDay>({ date: TODAY, cups: 30, target: 30 });
  });

  it('HEALTH-STORE-028: returns a fresh zeroed day for a non-object cached payload', async () => {
    await storageHelpers.setObject(HEALTH_WATER_KEY, 'corrupt');
    __setHealthOfflineForTests(true);

    // No throw: the string has no `.date`, so the "new day" branch is taken.
    // Fail-safe reset — a corrupt blob must never throw out of the water loader.
    expect(await loadWaterToday()).toEqual<WaterDay>({
      date: TODAY,
      cups: 0,
      target: DEFAULT_WATER_TARGET, // `stored?.target` is undefined on a string
    });
  });

  it('HEALTH-STORE-021: a non-finite or zero delta is a no-op, never a destructive one', async () => {
    const server = fakeWaterServer();
    await adjustWater(1);
    await adjustWater(1);
    const before = server.sips.length;

    // Fixed 2026-07-25. `NaN > 0` is false, which used to route to the UNDO leg
    // and quietly delete the user's most recent sip; `Infinity > 0` is true,
    // which used to put a non-serialisable volume on the wire (JSON.stringify
    // turns it into `null`). Both now return the day untouched.
    for (const delta of [NaN, Infinity, -Infinity, 0]) {
      expect((await adjustWater(delta)).cups).toBe(2);
    }
    expect(api.undoWater).not.toHaveBeenCalled();
    expect(api.addWater).toHaveBeenCalledTimes(before);
    expect(server.sips).toHaveLength(before);
  });

  it('HEALTH-STORE-023: setWaterTarget(0.4) rounds to 0 then floors to 1', async () => {
    fakeWaterServer();

    const day = await setWaterTarget(0.4);

    // DEFECT (HEALTH-STORE-023): a sub-1 positive target is neither rejected
    // (like 0 / negatives, which fall back to DEFAULT_WATER_TARGET) nor kept —
    // clampTarget rounds 0.4 to 0, then Math.max(1, 0) yields a target of 1.
    // Consistency would mean falling back to DEFAULT_WATER_TARGET here too.
    expect(day.target).toBe(1);
    expect(day.target).not.toBe(DEFAULT_WATER_TARGET);
    expect(api.saveGoal).toHaveBeenCalledWith({ daily_water_ml: CUP_ML });
    expect((await loadWaterToday()).target).toBe(1); // persisted
  });

  it('HEALTH-STORE-030: the Trends history is derived from the SERVER water rows', async () => {
    // `HEALTH_WATER_KEY` only holds today, so Trends reads `loadWaterHistory()`.
    // Grouping the server's raw entries (rather than keeping a device-local log)
    // is what makes the history correct on a new device and after a reinstall.
    fakeWaterServer();

    await adjustWater(3);
    expect(await loadWaterHistory()).toEqual([{ date: TODAY, cups: 3, target: 8 }]);

    // Several sips on one day collapse into ONE history row, never two.
    await adjustWater(2);
    expect(await loadWaterHistory()).toEqual([{ date: TODAY, cups: 5, target: 8 }]);

    // The target comes off the shared goal row, so retargeting restates it.
    await setWaterTarget(10);
    expect(await loadWaterHistory()).toEqual([{ date: TODAY, cups: 5, target: 10 }]);
  });

  it('HEALTH-STORE-057: a cup tap folds into the cached history without a second round trip', async () => {
    fakeWaterServer();

    await adjustWater(3);

    // `recordWaterHistory` reads the CACHE, not `loadWaterHistory()` — otherwise
    // every single tap would fire the water-list + goal pair again.
    expect(api.listWater).not.toHaveBeenCalled();
    expect(await storageHelpers.getObject(HEALTH_WATER_HISTORY_KEY)).toEqual([
      { date: TODAY, cups: 3, target: 8 },
    ]);
  });

  it('HEALTH-STORE-031: the offline history keeps prior days and drops one emptied to zero', async () => {
    await storageHelpers.setObject(HEALTH_WATER_HISTORY_KEY, [
      { date: '2026-07-12', cups: 7, target: 8 },
    ]);
    __setHealthOfflineForTests(true);

    await adjustWater(4);
    expect((await loadWaterHistory()).map((d) => d.date)).toEqual([TODAY, '2026-07-12']);

    // Undoing the whole day removes it rather than storing a zero record that
    // would drag the Trends average down.
    await adjustWater(-4);
    expect((await loadWaterHistory()).map((d) => d.date)).toEqual(['2026-07-12']);
  });

  it('HEALTH-STORE-032: corrupt cached history rows are dropped', async () => {
    await storageHelpers.setObject(HEALTH_WATER_HISTORY_KEY, [
      { date: '2026-07-12', cups: 'lots', target: 8 },
      null,
    ]);
    __setHealthOfflineForTests(true);

    expect(await loadWaterHistory()).toEqual([]);
  });

  it('HEALTH-STORE-058: a non-array cached history degrades to empty, not a crash', async () => {
    await storageHelpers.setObject(HEALTH_WATER_HISTORY_KEY, 'nope');
    __setHealthOfflineForTests(true);

    // Fixed 2026-07-25: `readThrough` now rejects a cached snapshot whose
    // shape does not match the caller's fallback, so a corrupt or
    // schema-drifted blob degrades to the empty state instead of throwing a
    // TypeError into the screen — on exactly the offline path the cache
    // exists to protect.
    expect(await loadWaterHistory()).toEqual([]);
  });
});

/* ---------------------------------------------------------------- */
/* Daily notes (device-local)                                        */
/* ---------------------------------------------------------------- */

describe('healthLocalStorage — notes', () => {
  it('loadNotes returns [] for missing / non-array values and sorts newest-first', async () => {
    expect(await loadNotes()).toEqual([]);
    await storageHelpers.setObject(HEALTH_NOTES_KEY, 'corrupt');
    expect(await loadNotes()).toEqual([]);

    await storageHelpers.setObject(HEALTH_NOTES_KEY, [
      { date: '2026-07-10', text: 'a', updatedAt: 'x' },
      { date: '2026-07-12', text: 'c', updatedAt: 'x' },
      { date: '2026-07-11', text: 'b', updatedAt: 'x' },
    ]);
    expect((await loadNotes()).map((n) => n.date)).toEqual([
      '2026-07-12',
      '2026-07-11',
      '2026-07-10',
    ]);
  });

  it('loadNoteForDate returns the matching text or an empty string', async () => {
    await saveNoteForDate('Felt great today');
    expect(await loadNoteForDate()).toBe('Felt great today'); // defaults to today
    expect(await loadNoteForDate('2026-01-01')).toBe(''); // no note for that day
  });

  it('saves, trims, and updates a note in place for a given date', async () => {
    await saveNoteForDate('  first  ', TODAY);
    expect(await loadNoteForDate(TODAY)).toBe('first'); // trimmed

    const after = await saveNoteForDate('second', TODAY);
    expect(after).toHaveLength(1); // updated, not appended
    expect(await loadNoteForDate(TODAY)).toBe('second');
  });

  it('clears a note when the text is empty or whitespace-only', async () => {
    await saveNoteForDate('temp', TODAY);
    const after = await saveNoteForDate('   ', TODAY);
    expect(after).toEqual([]);
    expect(await loadNoteForDate(TODAY)).toBe('');
  });

  it('caps the note history at 60 entries, keeping the newest dates', async () => {
    // 60 distinct dates, all older than today (2026-07-13). Adding one more
    // must drop the oldest, not exceed the cap.
    const distinct: DailyNote[] = Array.from({ length: 60 }, (_, i) => ({
      date: `2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      text: `note ${i}`,
      updatedAt: '2025-01-01T00:00:00.000Z',
    }));
    await storageHelpers.setObject(HEALTH_NOTES_KEY, distinct);

    const after = await saveNoteForDate('newest', TODAY);
    expect(after).toHaveLength(60); // bounded
    expect(after[0]).toMatchObject({ date: TODAY, text: 'newest' }); // newest kept, first
  });

  it('HEALTH-STORE-053: the daily note never reaches the API', async () => {
    await saveNoteForDate('Slept badly', TODAY);
    await loadNotes();

    // The donor kept the reflection note on-device and parity P1 did not port a
    // notes endpoint — free-text reflections are the most sensitive field in the
    // module, so a stray upload here would be a privacy regression, not a bug.
    expect(api.saveGoal).not.toHaveBeenCalled();
    expect(api.createNutrition).not.toHaveBeenCalled();
  });

  it('HEALTH-STORE-033: a whitespace-only save removes the day rather than storing an empty note', async () => {
    const afterWrite = await saveNoteForDate('hello', TODAY);
    expect(afterWrite).toEqual([
      { date: TODAY, text: 'hello', updatedAt: new Date().toISOString() },
    ]);

    const afterClear = await saveNoteForDate('   ', TODAY);

    // The day is dropped from the array entirely — it is NOT persisted as an
    // entry with `text: ''`. Callers must therefore treat "no row" and "empty
    // note" as the same state (loadNoteForDate already returns '' for both).
    expect(afterClear).toEqual([]);
    expect(afterClear.some((n: DailyNote) => n.date === TODAY)).toBe(false);
    expect(await loadNotes()).toEqual([]);
    expect(await loadNoteForDate(TODAY)).toBe('');
  });
});

/* ---------------------------------------------------------------- */
/* Observability records                                             */
/* ---------------------------------------------------------------- */

describe('healthLocalStorage — observability records', () => {
  it('HEALTH-STORE-024: each writer emits one persist record with its own store key', async () => {
    const persistSpy = jest.spyOn(e2eObservability, 'recordE2EPersistEntry');
    fakeWaterServer();

    // Every repository write is logged as 'update' with a writer-supplied detail;
    // Maestro greps these [E2E-DB] lines to prove a tap reached the store.
    await addWeightEntry(70.5, 'kg');
    expect(persistSpy).toHaveBeenCalledWith({
      store: HEALTH_WEIGHT_LOG_KEY,
      operation: 'update',
      detail: `insert weight=70.5kg date=${TODAY}`,
    });

    persistSpy.mockClear();
    await adjustWater(2);
    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(persistSpy).toHaveBeenCalledWith({
      store: HEALTH_WATER_KEY,
      operation: 'update',
      detail: `date=${TODAY} cups=2`,
    });

    // saveNoteForDate is still a direct MMKV write → 'upsert' for real text…
    persistSpy.mockClear();
    await saveNoteForDate('  hello  ', TODAY);
    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(persistSpy).toHaveBeenCalledWith({
      store: HEALTH_NOTES_KEY,
      operation: 'upsert',
      detail: `date=${TODAY} len=5`, // trimmed length
    });

    // …and 'delete' for whitespace-only text.
    persistSpy.mockClear();
    await saveNoteForDate('   ', TODAY);
    expect(persistSpy).toHaveBeenCalledWith({
      store: HEALTH_NOTES_KEY,
      operation: 'delete',
      detail: `date=${TODAY} len=0`,
    });

    persistSpy.mockRestore();
  });

  it('HEALTH-STORE-025: setUnitSystem DOES emit a persist record, unlike the old device-local writer it replaced', async () => {
    // FIXED as a side effect of 0141: the old local-only `saveHealthPrefs`
    // writer never called `recordE2EPersistEntry` (unlike every other writer
    // in this module), so unit changes were invisible in the [E2E-DB] log
    // during Maestro runs. `setUnitSystem` goes through the SAME
    // `writeThrough` every other server-synced preference (`water_unit`,
    // `saveWeightGoal`) uses, which always records one.
    fakeGoalServer(api, { unit_system: null });
    const persistSpy = jest.spyOn(e2eObservability, 'recordE2EPersistEntry');

    await setUnitSystem('imperial');

    expect(persistSpy).toHaveBeenCalledWith(
      expect.objectContaining({ store: HEALTH_UNIT_SYSTEM_KEY, operation: 'update' })
    );

    persistSpy.mockRestore();
  });
});

/* ---------------------------------------------------------------- */
/* Formatting & derivation edge cases                                */
/* ---------------------------------------------------------------- */

describe('healthLocalStorage — formatting & derivation edge cases', () => {
  it('HEALTH-STORE-026: dateKeyOf yields "NaN-NaN-NaN" for an unparseable date', () => {
    // DEFECT (HEALTH-STORE-026): dateKeyOf should validate the parsed Date
    // (`Number.isNaN(d.getTime())`) and return a sentinel the UI can handle —
    // e.g. '' or the raw input. Instead an invalid ISO string produces the
    // literal key 'NaN-NaN-NaN', which then renders straight into the log list
    // via formatLoggedAt's fallback branch.
    expect(dateKeyOf('not-a-date')).toBe('NaN-NaN-NaN');
    expect(formatLoggedAt('not-a-date')).toBe('NaN-NaN-NaN');
  });

  it('HEALTH-STORE-027: weightDelta returns a zero delta rather than null for identical readings', () => {
    const entries = sortEntriesDesc([
      entry('2026-07-12T08:00:00.000Z', 70, 'kg'),
      entry('2026-07-11T08:00:00.000Z', 70, 'kg'),
    ]);

    // DEFECT (HEALTH-STORE-027): "no change" is arguably not a delta worth
    // rendering — callers that treat a non-null result as "there is a change"
    // will show a "0 kg" trend chip. Current behaviour returns {value: 0, …}.
    expect(weightDelta(entries)).toEqual({ value: 0, unit: 'kg' });
    expect(weightDelta(entries)).not.toBeNull();
  });

  it('HEALTH-STORE-054: formatWeightValue renders 0 and keeps a negative sign', () => {
    expect(formatWeightValue(0)).toBe('0');

    // DEFECT (HEALTH-STORE-054): weights are never negative (parseWeightInput
    // rejects them), yet formatWeightValue happily formats a negative value —
    // it is reused for weightDelta output, where '-1.5' is correct, so any
    // future guard must not break the delta call site.
    expect(formatWeightValue(-1.5)).toBe('-1.5');
    expect(formatWeightValue(-2)).toBe('-2'); // integers keep the sign too
  });

  it('HEALTH-STORE-055: labels the last day of the previous month as Yesterday', () => {
    // Freeze on the 1st of August; the entry is from July 31st.
    jest.setSystemTime(new Date(2026, 7, 1, 12, 0, 0));
    const lastDayOfJuly = new Date(2026, 6, 31, 9, 0, 0).toISOString();

    // Month-boundary regression guard: formatLoggedAt derives "yesterday" via
    // Date#setDate(-1), which correctly rolls back across the month boundary.
    expect(todayDateKey()).toBe('2026-08-01');
    expect(dateKeyOf(lastDayOfJuly)).toBe('2026-07-31');
    expect(formatLoggedAt(lastDayOfJuly)).toBe('Yesterday');
  });

  it('HEALTH-STORE-056: latestWeight assumes a pre-sorted list', () => {
    expect(latestWeight([])).toBeNull();

    const sorted = sortEntriesDesc([
      entry('2026-07-11T08:00:00.000Z', 71),
      entry('2026-07-12T08:00:00.000Z', 70),
    ]);
    expect(latestWeight(sorted)?.value).toBe(70); // newest-first input → newest out

    // DEFECT (HEALTH-STORE-056): latestWeight is `entries[0]`, not a max-by-
    // loggedAt, so an unsorted list returns the wrong "latest" reading. It is
    // also dead code — no Health screen imports it (drift risk: it can rot
    // undetected, and a future caller passing an unsorted array gets a silently
    // wrong headline weight).
    const unsorted = [entry('2026-07-11T08:00:00.000Z', 71), entry('2026-07-12T08:00:00.000Z', 70)];
    expect(latestWeight(unsorted)?.value).toBe(71); // older entry wins
  });
});

/* ---------------------------------------------------------------- */
/* Partial server payloads                                          */
/* ---------------------------------------------------------------- */

describe('healthLocalStorage — partial server payloads', () => {
  it('HEALTH-STORE-058: a weight body with no `entries` key reads as an empty log', async () => {
    // The Health Worker answers BARE, so a renamed key or a 204-shaped body
    // arrives as `{}`. `.map` on that throws straight into Home's weight card.
    api.listWeight.mockResolvedValue(ok({} as never));

    expect(await loadWeightLog()).toEqual([]);
  });

  it('HEALTH-STORE-062: a water-entries body with no `entries` key gives Trends an empty history', async () => {
    // Trends averages this array. `.map` on an absent key would throw inside the
    // hydration card rather than drawing "no data".
    api.listWater.mockResolvedValue(ok({} as never));

    expect(await loadWaterHistory()).toEqual([]);
  });

  it('HEALTH-STORE-059: a water body with no `summary` shows an empty ring, not NaN', async () => {
    // `total_ml / CUP_ML` on an absent summary would be NaN, which renders the
    // ring as an empty arc AND prints "NaN cups" under it.
    await storageHelpers.setObject(HEALTH_WATER_KEY, { date: TODAY, cups: 4, target: 11 });
    api.waterSummary.mockResolvedValue(ok({} as never));

    const day = await loadWaterToday();
    expect(day.cups).toBe(0);
    expect(Number.isFinite(day.cups)).toBe(true);
    // The last known local target survives, exactly as for an unset goal row.
    expect(day.target).toBe(11);
  });

  it('HEALTH-STORE-060: a cached day from another date with no target falls back to the default', async () => {
    // The rollover branch carries the target forward. A snapshot written before
    // the field existed has none, and `clampTarget(undefined)` would otherwise
    // leave the ring with no denominator.
    await storageHelpers.setObject(HEALTH_WATER_KEY, { date: '2026-07-12', cups: 6 });
    __setHealthOfflineForTests(true);

    expect(await loadWaterToday()).toEqual<WaterDay>({
      date: TODAY,
      cups: 0,
      target: DEFAULT_WATER_TARGET,
    });
  });

  it('HEALTH-STORE-061: the water history spans several days, newest first, one row per day', async () => {
    // Every existing history case had at most ONE day on the wire, which is
    // exactly the size at which a broken comparator still looks correct — and
    // Trends renders this array in order.
    api.listWater.mockResolvedValue(
      ok({
        entries: [
          waterEntryRow({ id: 'w1', date: '2026-07-11', amount_ml: 2 * CUP_ML }),
          waterEntryRow({ id: 'w2', date: TODAY, amount_ml: CUP_ML }),
          waterEntryRow({ id: 'w3', date: '2026-07-12', amount_ml: 3 * CUP_ML }),
          // A second sip on a day already seen must fold into that day's row.
          waterEntryRow({ id: 'w4', date: TODAY, amount_ml: 2 * CUP_ML }),
        ],
      })
    );
    api.getGoal.mockResolvedValue(ok({ goal: goalRow({ daily_water_ml: 9 * CUP_ML }) }));

    expect(await loadWaterHistory()).toEqual<WaterDay[]>([
      { date: TODAY, cups: 3, target: 9 },
      { date: '2026-07-12', cups: 3, target: 9 },
      { date: '2026-07-11', cups: 2, target: 9 },
    ]);
  });
});
