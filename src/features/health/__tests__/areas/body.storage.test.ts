/**
 * Symply Health — Body measurements, the arms `healthBodyStorage.test.ts` does
 * not take.
 *
 * The sibling suite pins the metric vocabulary, the wire mapping and the happy
 * single-site add/delete path. Two things were missing entirely:
 *
 *  1. The edges of the parser, the sorter and the loader — a field that is only
 *     whitespace, an exponent, a second comma, a cache that arrives out of
 *     order, a log past the cap. Each of those reaches the store through a
 *     paste, a hardware keyboard or a long history, and each one that slips
 *     through is either a stored lie or a `NaN` on a tile.
 *
 *  2. Everything migration 0131 added, which shipped with NO store-level suite
 *     at all: sessions (`addBodySession` — one row, many sites), back-dating
 *     (`bodyEntryDay` / `compareBodyEntriesDesc` — the day it was TAKEN is no
 *     longer the day it was typed), per-site deletion (a row is a whole taping
 *     session, so removing one bad waist figure must not tombstone the other
 *     forty sites), the four ratios, the left/right differences and the
 *     composition summary.
 *
 * Layout, fixtures and the fake server mirror `../healthBodyStorage.test.ts` so
 * the two read as one suite; only the cases are new.
 */

import { clearE2EPersistLog, getE2EPersistLog } from '@api/e2eTestObservability';
import { healthApi, type HealthMeasurement } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  addBodyEntry,
  addBodySession,
  BODY_METRIC_LABELS,
  BODY_METRICS,
  BODY_RATIO_KEYS,
  bodyEntriesForDay,
  bodyEntryDay,
  bodyRatios,
  bodySideDifferences,
  compareBodyEntriesDesc,
  deleteBodyEntry,
  formatMeasurement,
  HEALTH_BODY_KEY,
  LENGTH_UNITS,
  loadBodyEntries,
  METRIC_COLUMN,
  parseMeasurementInput,
  summarizeBody,
  summarizeBodyComposition,
  unitForMetric,
  type BodyEntry,
  type BodyMetric,
} from '../../healthBodyStorage';
import {
  __setHealthOfflineForTests,
  clearHealthCache,
  healthSyncStateFor,
} from '../../healthRepository';
import {
  installHealthApiDefaults,
  measurementRow,
  NETWORK_ERROR,
  ok,
  type MockedHealthApi,
} from '../../test-utils/healthApiTestKit';

jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

function bodyEntry(over: Partial<BodyEntry> = {}): BodyEntry {
  const date = over.date ?? TODAY;
  return {
    id: over.id ?? `${over.metric ?? 'waist'}-${date}`,
    date,
    metric: over.metric ?? 'waist',
    value: over.value ?? 80,
    unit: over.unit ?? 'cm',
    loggedAt: over.loggedAt ?? `${date}T10:00:00.000Z`,
  };
}

/** Entries as `loadBodyEntries` hands them over: newest measurement day first. */
function log(...items: BodyEntry[]): BodyEntry[] {
  return [...items].sort(compareBodyEntriesDesc);
}

/**
 * Stand-in for `/health/measurements`.
 *
 * One row per SESSION, as the route stores it, plus the 0131 PATCH so a
 * per-site clear can be observed through a refetch rather than only through the
 * call it made.
 */
function fakeMeasurementServer(): { rows: HealthMeasurement[] } {
  const state = { rows: [] as HealthMeasurement[] };
  api.createMeasurement.mockImplementation((body) => {
    const row = measurementRow({
      ...(body as unknown as Partial<HealthMeasurement>),
      id: `srv-${state.rows.length + 1}`,
      created_at: new Date().toISOString(),
    });
    state.rows.push(row);
    return Promise.resolve(ok({ measurement: row }));
  });
  api.updateMeasurement.mockImplementation((id, patch) => {
    const row = state.rows.find((r) => r.id === id);
    if (row) Object.assign(row, patch);
    return Promise.resolve(ok({ measurement: row as HealthMeasurement }));
  });
  api.deleteMeasurement.mockImplementation((id) => {
    state.rows = state.rows.filter((r) => r.id !== id);
    return Promise.resolve(ok({ deleted: true }));
  });
  api.listMeasurements.mockImplementation(() =>
    Promise.resolve(ok({ measurements: [...state.rows] }))
  );
  return state;
}

beforeEach(async () => {
  await storageHelpers.clearAll();
  await clearHealthCache([]);
  __setHealthOfflineForTests(false);
  clearE2EPersistLog();
  jest.resetAllMocks();
  installHealthApiDefaults(api);
  // 0131's per-site clear. Not in the shared defaults, and an unstubbed method
  // resolves `undefined` — which `writeThrough` would read as a SUCCESS.
  api.updateMeasurement.mockResolvedValue(ok({ measurement: measurementRow() }));
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* VALIDATION — what the parser refuses                                */
/* ------------------------------------------------------------------ */

describe('parseMeasurementInput — the remaining refusals', () => {
  it('HEALTH-BODY-110: whitespace and a lone separator are nothing, not zero', () => {
    // `sanitizeWeightInput` lets a bare `.` through (it is a legal prefix of
    // `.5`), so the parser is the only thing standing between "I have not
    // finished typing" and a stored measurement.
    expect(parseMeasurementInput('   ', 'waist')).toBeNull();
    expect(parseMeasurementInput('.', 'waist')).toBeNull();
    expect(parseMeasurementInput(',', 'waist')).toBeNull();
    // A separator with a digit after it IS a measurement — 0.5 cm is absurd for
    // a waist but it is a number the member typed, and the bound is what says
    // no, not the shape.
    expect(parseMeasurementInput('.5', 'waist')).toBe(0.5);
  });

  it('HEALTH-BODY-111: an infinity or an exponent cannot become a measurement', () => {
    // `Number('Infinity')` succeeds, and `Infinity > 400` is true only because
    // the bound is written the way it is — the explicit `Number.isFinite` guard
    // is what makes that independent of the comparison's direction.
    expect(parseMeasurementInput('Infinity', 'waist')).toBeNull();
    expect(parseMeasurementInput('-Infinity', 'waist')).toBeNull();
    expect(parseMeasurementInput('NaN', 'waist')).toBeNull();
    // `Number` accepts exponents, so `1e3` is a real 1000 — refused by the
    // sanity bound rather than by the syntax.
    expect(parseMeasurementInput('1e3', 'waist')).toBeNull();
    expect(parseMeasurementInput('1e1', 'waist')).toBe(10);
  });

  it('HEALTH-BODY-112: only the FIRST comma is a decimal point', () => {
    // `raw.replace(',', '.')` swaps ONE comma. A thousands-separated paste
    // (`1,000`) therefore parses as 1.000 = 1 rather than as 1000 — the safe
    // direction, since the alternative is a 1000 cm waist — but it is not
    // obvious, so it is pinned rather than left to be rediscovered.
    expect(parseMeasurementInput('1,000', 'waist')).toBe(1);
    // A second separator makes the whole thing unparseable, which is the right
    // answer for `80,4,5`.
    expect(parseMeasurementInput('80,4,5', 'waist')).toBeNull();
    expect(parseMeasurementInput('80.4.5', 'waist')).toBeNull();
  });

  it('HEALTH-BODY-113: everything is stored to ONE decimal, rounded half-up', () => {
    // A tape does not resolve past a millimetre; storing 80.44999 would print
    // as 80.4 and compare as something else, so the value is rounded once on
    // the way IN rather than on every read.
    expect(parseMeasurementInput('80.44', 'waist')).toBe(80.4);
    expect(parseMeasurementInput('80.45', 'waist')).toBe(80.5);
    expect(parseMeasurementInput('80.96', 'waist')).toBe(81);
    expect(formatMeasurement(parseMeasurementInput('80.96', 'waist') as number)).toBe('81');
  });

  it('HEALTH-BODY-114: a signed number is read as signed, and the sign decides', () => {
    // `Number('+80')` is 80 — a leading plus is a legal numeric literal, so it
    // is accepted rather than treated as junk. A leading minus is the same
    // literal with the opposite sign and is refused by the `<= 0` guard, not by
    // a character test that would also have thrown out the plus.
    expect(parseMeasurementInput('+80', 'waist')).toBe(80);
    expect(parseMeasurementInput('-80', 'waist')).toBeNull();
    expect(parseMeasurementInput('-0.1', 'bodyFat')).toBeNull();
    // Nobody has ever measured a 0% body fat, and the shared `<= 0` guard is
    // what says so — the percentage ceiling only guards the other end.
    expect(parseMeasurementInput('0', 'bodyFat')).toBeNull();
    expect(parseMeasurementInput('0.1', 'bodyFat')).toBe(0.1);
  });

  it('HEALTH-BODY-115: every site declares its unit, and only body fat is a percent', () => {
    // Driven across the WHOLE vocabulary rather than the two examples the
    // sibling suite spot-checks: a site added to `BODY_METRICS` without a rule
    // here would silently be logged in centimetres.
    for (const metric of BODY_METRICS) {
      for (const preferred of LENGTH_UNITS) {
        expect(unitForMetric(metric, preferred)).toBe(metric === 'bodyFat' ? '%' : preferred);
      }
    }
    // Exactly one percentage, so the `%` axis on the Body tab can never end up
    // sharing a card with a circumference.
    expect(BODY_METRICS.filter((m) => unitForMetric(m, 'cm') === '%')).toEqual(['bodyFat']);
  });
});

/* ------------------------------------------------------------------ */
/* Back-dating — the day a reading BELONGS to                          */
/* ------------------------------------------------------------------ */

describe('bodyEntryDay / compareBodyEntriesDesc — taken vs typed', () => {
  it('HEALTH-BODY-116: a reading belongs to the day it was TAKEN', () => {
    // `date` is what the member says; `loggedAt` is when they typed it. Since
    // the tab gained date navigation those are routinely different days.
    expect(bodyEntryDay(bodyEntry({ date: '2026-07-06', loggedAt: `${TODAY}T09:00:00.000Z` }))).toBe(
      '2026-07-06'
    );
    // A legacy cached row from before the schema carried `date` still knows
    // when it was typed — keying it on the blank string would sort it ahead of
    // every real date.
    expect(
      bodyEntryDay(bodyEntry({ date: '' as string, loggedAt: '2026-07-13T10:00:00.000Z' }))
    ).toBe(TODAY);
  });

  it('HEALTH-BODY-117: a BACK-DATED reading does not outrank the day it was typed on', () => {
    // Tuesday's tape, typed on Friday, next to Friday's own tape. Sorting by
    // `loggedAt` alone would report Tuesday as "latest" — and the summary tile,
    // the delta, the compare card and the ratios all read the first match.
    const typedLate = bodyEntry({ id: 'tuesday', date: '2026-07-07', value: 82, loggedAt: `${TODAY}T09:00:00.000Z` });
    const takenToday = bodyEntry({ id: 'friday', date: TODAY, value: 80, loggedAt: `${TODAY}T08:00:00.000Z` });

    expect(log(typedLate, takenToday).map((e) => e.id)).toEqual(['friday', 'tuesday']);
    expect(summarizeBody([typedLate, takenToday]).find((s) => s.metric === 'waist')).toMatchObject({
      latest: expect.objectContaining({ id: 'friday' }),
      // 80 − 82: today against the day before it, in that order.
      delta: -2,
    });
  });

  it('HEALTH-BODY-118: two readings on the SAME day are ordered by when they were typed', () => {
    // Re-measuring after a bad tape pull is the donor's own habit, and the
    // second pull is the one that counts.
    const rows = log(
      bodyEntry({ id: 'am', value: 80, loggedAt: `${TODAY}T07:00:00.000Z` }),
      bodyEntry({ id: 'pm', value: 79, loggedAt: `${TODAY}T18:00:00.000Z` })
    );

    expect(rows.map((e) => e.id)).toEqual(['pm', 'am']);
    const waist = summarizeBody(rows).find((s) => s.metric === 'waist');
    expect(waist?.latest?.id).toBe('pm');
    expect(waist?.delta).toBe(-1);
    expect(waist?.count).toBe(2);
  });

  it('HEALTH-BODY-119: one day’s readings can be read back on their own', () => {
    // What the entry sheet re-opens with when the member navigates to a past
    // day: that day's sites, and nothing from the days either side.
    const rows = log(
      bodyEntry({ id: 'w-today', date: TODAY, value: 80, loggedAt: `${TODAY}T10:00:00.000Z` }),
      bodyEntry({
        id: 'c-today',
        metric: 'chest',
        date: TODAY,
        value: 100,
        loggedAt: `${TODAY}T10:05:00.000Z`,
      }),
      bodyEntry({ id: 'w-old', date: '2026-07-06', value: 82 }),
      // A back-dated row typed today still belongs to the day it names.
      bodyEntry({ id: 'w-backdated', date: '2026-07-06', value: 81, loggedAt: `${TODAY}T09:00:00.000Z` })
    );

    expect(bodyEntriesForDay(rows, TODAY).map((e) => e.id)).toEqual(['c-today', 'w-today']);
    // Within the day, newest TYPED first — the back-dated correction leads.
    expect(bodyEntriesForDay(rows, '2026-07-06').map((e) => e.id)).toEqual(['w-backdated', 'w-old']);
    expect(bodyEntriesForDay(rows, '2026-01-01')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Loader — order and cap                                              */
/* ------------------------------------------------------------------ */

describe('loadBodyEntries — order and cap', () => {
  it('HEALTH-BODY-120: re-sorts a cached snapshot that arrives out of order', async () => {
    // The cache is a verbatim mirror of whatever was last written, including an
    // OPTIMISTIC list assembled offline. Every consumer — the history card, the
    // trend series, `summarizeBody`, the ratios — documents "newest-first", so
    // the loader re-establishes it rather than assuming.
    await storageHelpers.setObject(HEALTH_BODY_KEY, [
      bodyEntry({ id: 'old', date: '2026-05-01' }),
      bodyEntry({ id: 'new', date: TODAY }),
      bodyEntry({ id: 'mid', date: '2026-06-01' }),
    ]);
    __setHealthOfflineForTests(true);

    expect((await loadBodyEntries()).map((e) => e.id)).toEqual(['new', 'mid', 'old']);
  });

  it('HEALTH-BODY-121: caps the log, keeping the NEWEST sessions', async () => {
    // One wire ROW fans out into one entry per populated site, so a fully taped
    // session is forty-one screen rows and the cap is reached in about a
    // hundred sessions. The newest have to be the ones that survive: a cap that
    // kept the oldest would freeze the tab on last year's numbers.
    const fullRow = (n: number) => {
      const day = `2026-${String(Math.floor(n / 28) + 1).padStart(2, '0')}-${String((n % 28) + 1).padStart(2, '0')}`;
      return measurementRow({
        id: `srv-${n}`,
        date: day,
        created_at: `${day}T10:00:00.000Z`,
        ...(Object.fromEntries(
          BODY_METRICS.map((metric) => [METRIC_COLUMN[metric], 40 + (n % 20)])
        ) as Partial<HealthMeasurement>),
      });
    };
    // 110 sessions × 41 sites = 4510 readings, comfortably past the 4000 cap.
    api.listMeasurements.mockResolvedValue(
      ok({ measurements: Array.from({ length: 110 }, (_, i) => fullRow(i)) })
    );

    const entries = await loadBodyEntries();

    expect(entries).toHaveLength(4000);
    // Newest session intact…
    expect(entries.filter((e) => e.id.startsWith('srv-109:'))).toHaveLength(BODY_METRICS.length);
    // …oldest one dropped entirely.
    expect(entries.filter((e) => e.id.startsWith('srv-0:'))).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Wire mapping — the columns that must NOT become readings            */
/* ------------------------------------------------------------------ */

describe('loadBodyEntries — wire values the mapper must refuse', () => {
  it('HEALTH-BODY-122: a non-numeric column is skipped, never coerced', async () => {
    // D1 columns are REAL, but the row travels as JSON through a client the app
    // does not own. A `"80"` coerced with `Number()` would work; a `"eighty"`
    // would print `NaN cm` on the tile and poison every delta beside it.
    api.listMeasurements.mockResolvedValue(
      ok({
        measurements: [
          measurementRow({ id: 'srv-1', waist: '80' as unknown as number, chest: null, hips: 95 }),
        ],
      })
    );

    expect((await loadBodyEntries()).map((e) => e.metric)).toEqual(['hips']);
  });

  it('HEALTH-BODY-123: a NaN column is skipped too — it is not a reading of zero', async () => {
    api.listMeasurements.mockResolvedValue(
      ok({ measurements: [measurementRow({ id: 'srv-1', waist: Number.NaN, neck: 38 })] })
    );

    expect((await loadBodyEntries()).map((e) => e.metric)).toEqual(['neck']);
  });

  it('HEALTH-BODY-124: an "in" row passes through untouched', async () => {
    // 'inches' is normalised to 'in' (HEALTH-BODY-018); the already-correct
    // spelling must NOT be normalised into something else on the way past.
    api.listMeasurements.mockResolvedValue(
      ok({ measurements: [measurementRow({ id: 'srv-1', waist: 31, unit: 'in' })] })
    );

    expect((await loadBodyEntries())[0].unit).toBe('in');
  });

  it('HEALTH-BODY-125: a cached reading with a NaN value or no id is dropped', async () => {
    // `isValidEntry` is the last guard before the tiles. A NaN renders as
    // `NaN cm`; an id-less row collides with every other id-less row on React's
    // key and makes the delete button remove the wrong reading.
    await storageHelpers.setObject(HEALTH_BODY_KEY, [
      bodyEntry({ id: 'ok' }),
      bodyEntry({ id: 'nan', value: Number.NaN }),
      { date: TODAY, metric: 'waist', value: 80, loggedAt: 'x' },
    ]);
    __setHealthOfflineForTests(true);

    expect((await loadBodyEntries()).map((e) => e.id)).toEqual(['ok']);
  });
});

/* ------------------------------------------------------------------ */
/* SESSIONS — one row, many sites (0131)                               */
/* ------------------------------------------------------------------ */

describe('addBodySession — the donor’s entry sheet', () => {
  it('HEALTH-BODY-130: writes every site of a taping as ONE row', async () => {
    fakeMeasurementServer();

    const list = await addBodySession({ waist: 80, chest: 100, leftArm: 34 }, 'cm');

    // One request, not three: a session is the donor's own shape, and it is
    // what keeps forty-one sites from becoming forty-one rows a day.
    expect(api.createMeasurement).toHaveBeenCalledTimes(1);
    expect(api.createMeasurement).toHaveBeenCalledWith({
      date: TODAY,
      unit: 'cm',
      waist: 80,
      chest: 100,
      left_arm: 34,
    });
    // …and it reads back as three separate site readings.
    expect(list.map((e) => e.metric).sort()).toEqual(['chest', 'leftArm', 'waist']);
    expect(list.every((e) => e.date === TODAY)).toBe(true);
  });

  it('HEALTH-BODY-131: a session may be BACK-DATED to the day it was taped', async () => {
    fakeMeasurementServer();

    const list = await addBodySession({ waist: 82 }, 'cm', '2026-07-06');

    expect(api.createMeasurement).toHaveBeenCalledWith({
      date: '2026-07-06',
      unit: 'cm',
      waist: 82,
    });
    // The reading belongs to the day it was taken, even though it was typed a
    // week later — which is the whole point of the date picker.
    expect(bodyEntryDay(list[0])).toBe('2026-07-06');
  });

  it('HEALTH-BODY-132: an EMPTY session writes nothing at all', async () => {
    fakeMeasurementServer();
    await addBodySession({ waist: 80 }, 'cm');
    (api.createMeasurement as jest.Mock).mockClear();

    // Saving a sheet where nothing was filled in must not post a row whose only
    // content is a date — the tab would then show a measurement day with no
    // measurement on it, and the compare card would offer it as a baseline.
    const list = await addBodySession({}, 'cm');

    expect(api.createMeasurement).not.toHaveBeenCalled();
    expect(list.map((e) => e.metric)).toEqual(['waist']); // the earlier session, unharmed
  });

  it('HEALTH-BODY-133: a site the app does not know, and a NaN, are dropped from the session', async () => {
    fakeMeasurementServer();

    const list = await addBodySession(
      { waist: 80, elbow: 30, chest: Number.NaN } as unknown as Partial<Record<BodyMetric, number>>,
      'cm'
    );

    // `elbow` has no column, so posting it would be silently stripped by the
    // route's `z.object` and answered 200 — a write the member is told
    // succeeded and that stored nothing. It never leaves the device.
    expect(api.createMeasurement).toHaveBeenCalledWith({ date: TODAY, unit: 'cm', waist: 80 });
    expect(list.map((e) => e.metric)).toEqual(['waist']);
  });

  it('HEALTH-BODY-134: body fat rides the session as a percentage, on a length row', async () => {
    fakeMeasurementServer();

    const list = await addBodySession({ waist: 31, bodyFat: 18.4 }, 'in');

    // '%' is not a member of the row's unit CHECK constraint, and the
    // percentage column does not need one — so the ROW is `in` and the body-fat
    // READING is still a percentage.
    expect(api.createMeasurement).toHaveBeenCalledWith({
      date: TODAY,
      unit: 'in',
      waist: 31,
      body_fat_percentage: 18.4,
    });
    expect(list.find((e) => e.metric === 'bodyFat')?.unit).toBe('%');
    expect(list.find((e) => e.metric === 'waist')?.unit).toBe('in');
  });

  it('HEALTH-BODY-135: an OFFLINE session keeps every site, each addressable', async () => {
    __setHealthOfflineForTests(true);

    const list = await addBodySession({ waist: 80, chest: 100 }, 'cm');

    expect(api.createMeasurement).not.toHaveBeenCalled();
    expect(list).toHaveLength(2);
    // The optimistic ids carry the metric after the LAST colon, which is what
    // lets a delete find the column to clear once the row exists for real.
    for (const entry of list) {
      expect(entry.id.slice(entry.id.lastIndexOf(':') + 1)).toBe(entry.metric);
    }
    // Distinct ids, so React keys and the delete button address one row each.
    expect(new Set(list.map((e) => e.id)).size).toBe(2);
  });

  it('HEALTH-BODY-136: the quick-add path is a session of exactly one', async () => {
    fakeMeasurementServer();

    await addBodyEntry('rightCalf', 38.5, 'in');
    // Anything that is not 'in' rides a cm row — including the '%' the body-fat
    // field hands over, which the route would reject as a unit.
    await addBodyEntry('bodyFat', 18, '%');

    expect(api.createMeasurement).toHaveBeenNthCalledWith(1, {
      date: TODAY,
      unit: 'in',
      right_calf: 38.5,
    });
    expect(api.createMeasurement).toHaveBeenNthCalledWith(2, {
      date: TODAY,
      unit: 'cm',
      body_fat_percentage: 18,
    });
  });
});

/* ------------------------------------------------------------------ */
/* Per-site deletion — a row is a whole session                        */
/* ------------------------------------------------------------------ */

describe('deleteBodyEntry — remove ONE reading, not the session', () => {
  it('HEALTH-BODY-140: clears the SITE when the session holds others', async () => {
    fakeMeasurementServer();
    const session = await addBodySession({ waist: 80, chest: 100, hips: 95 }, 'cm');
    const waist = session.find((e) => e.metric === 'waist')!;

    const after = await deleteBodyEntry(waist.id);

    // DELETE would tombstone the whole morning's taping to remove one bad
    // figure. The site's own column is cleared instead.
    expect(api.deleteMeasurement).not.toHaveBeenCalled();
    expect(api.updateMeasurement).toHaveBeenCalledWith('srv-1', { waist: null });
    // Proven through a REFETCH, not just through the call: the other two sites
    // are still there and the waist is gone.
    expect(after.map((e) => e.metric).sort()).toEqual(['chest', 'hips']);
  });

  it('HEALTH-BODY-141: tombstones the ROW when it was the session’s last site', async () => {
    fakeMeasurementServer();
    const [only] = await addBodySession({ waist: 80 }, 'cm');

    const after = await deleteBodyEntry(only.id);

    // Clearing the last column would leave a dated row with no measurement on
    // it — a day the compare card would offer as a baseline and the trend
    // would find nothing in.
    expect(api.updateMeasurement).not.toHaveBeenCalled();
    expect(api.deleteMeasurement).toHaveBeenCalledWith('srv-1');
    expect(after).toEqual([]);
  });

  it('HEALTH-BODY-142: a pre-0131 one-site-per-row log still deletes rows', async () => {
    // Every row written by a client before the session shape existed holds
    // exactly one site, so the ONLY path those rows can take is the tombstone.
    api.listMeasurements.mockResolvedValue(
      ok({
        measurements: [
          measurementRow({ id: 'old-1', waist: 80, created_at: '2026-07-06T10:00:00.000Z' }),
          measurementRow({ id: 'old-2', chest: 100, created_at: '2026-07-06T10:01:00.000Z' }),
        ],
      })
    );
    const entries = await loadBodyEntries();

    await deleteBodyEntry(entries.find((e) => e.metric === 'waist')!.id);

    expect(api.deleteMeasurement).toHaveBeenCalledWith('old-1');
    expect(api.updateMeasurement).not.toHaveBeenCalled();
  });

  it('HEALTH-BODY-143: a PENDING id keeps its whole timestamp as the row id', async () => {
    // Screen ids are `<rowId>:<metric>`, and an offline id is
    // `pending-<ISO stamp>:<metric>` — an ISO stamp CONTAINS colons. Folding on
    // the first one would truncate the row id mid-timestamp; the fold is on the
    // LAST colon precisely so it does not.
    __setHealthOfflineForTests(true);
    const [pending] = await addBodySession({ waist: 78 }, 'cm');
    expect(pending.id).toMatch(/^pending-.*:waist$/);

    __setHealthOfflineForTests(false);
    api.deleteMeasurement.mockResolvedValue(ok({ deleted: true }));
    api.listMeasurements.mockResolvedValue(ok({ measurements: [] }));
    await deleteBodyEntry(pending.id);

    expect(api.deleteMeasurement).toHaveBeenCalledWith(pending.id.slice(0, pending.id.lastIndexOf(':')));
    expect(api.deleteMeasurement).toHaveBeenCalledWith(expect.stringContaining('.000Z'));
  });

  it('HEALTH-BODY-144: an id with no metric suffix is treated as a whole row', async () => {
    // Defensive: a hand-edited cache or a row id that never carried a suffix
    // must not send `undefined` as a column name to PATCH.
    await storageHelpers.setObject(HEALTH_BODY_KEY, [bodyEntry({ id: 'bare-id' })]);
    api.listMeasurements.mockRejectedValue(NETWORK_ERROR);
    api.deleteMeasurement.mockResolvedValue(ok({ deleted: true }));

    await deleteBodyEntry('bare-id');

    expect(api.deleteMeasurement).toHaveBeenCalledWith('bare-id');
    expect(api.updateMeasurement).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* ERROR — what a refused write leaves behind                          */
/* ------------------------------------------------------------------ */

describe('write failures', () => {
  it('HEALTH-BODY-145: a REFUSED write keeps the reading locally and reports offline', async () => {
    // The tape is already back in the drawer by the time the POST fails. The
    // reading stays on screen and in the cache; the sync badge is what says the
    // server has not seen it yet.
    api.createMeasurement.mockRejectedValue(NETWORK_ERROR);

    const list = await addBodySession({ chest: 100 }, 'cm');

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ metric: 'chest', value: 100, unit: 'cm', date: TODAY });
    expect(healthSyncStateFor(HEALTH_BODY_KEY)).toBe('offline');
    __setHealthOfflineForTests(true);
    expect((await loadBodyEntries())[0]).toMatchObject({ metric: 'chest', value: 100 });
  });

  it('HEALTH-BODY-146: a REFUSED delete still removes the reading locally', async () => {
    fakeMeasurementServer();
    const [only] = await addBodySession({ chest: 100 }, 'cm');
    api.deleteMeasurement.mockRejectedValue(NETWORK_ERROR);

    // A delete that appears to do nothing is the worst possible answer: the
    // member taps it again, and again.
    expect(await deleteBodyEntry(only.id)).toEqual([]);
    expect(healthSyncStateFor(HEALTH_BODY_KEY)).toBe('offline');
  });

  it('HEALTH-BODY-147: every write announces itself on the [E2E-DB] persist log', async () => {
    // The matrix's "Console verify" column for this tab is `n/a (local cache)`,
    // which is only true because the write is announced on the persist ring
    // buffer instead. That is what a Maestro `e2e-dump-log` leg reads back, and
    // the two verbs have to be distinguishable — clearing a site and dropping a
    // session are different events.
    fakeMeasurementServer();

    const session = await addBodySession({ waist: 80, chest: 100 }, 'cm', '2026-07-06');
    const waist = session.find((e) => e.metric === 'waist')!;
    const chest = session.find((e) => e.metric === 'chest')!;
    await deleteBodyEntry(waist.id);
    await deleteBodyEntry(chest.id);

    expect(getE2EPersistLog().map((e) => ({ store: e.store, detail: e.detail }))).toEqual([
      { store: HEALTH_BODY_KEY, detail: 'session date=2026-07-06 sites=2' },
      { store: HEALTH_BODY_KEY, detail: `clear site id=${waist.id}` },
      { store: HEALTH_BODY_KEY, detail: `delete row id=${chest.id}` },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Ratios — unitless, so they MAY cross units                          */
/* ------------------------------------------------------------------ */

describe('bodyRatios', () => {
  const twoDays = () =>
    log(
      bodyEntry({ id: 'w2', metric: 'waist', date: TODAY, value: 78 }),
      bodyEntry({ id: 'h2', metric: 'hips', date: TODAY, value: 99 }),
      bodyEntry({ id: 'w1', metric: 'waist', date: '2026-05-01', value: 80 }),
      bodyEntry({ id: 'h1', metric: 'hips', date: '2026-05-01', value: 100 })
    );

  it('HEALTH-BODY-150: reports the donor’s four ratios, latest and previous', () => {
    const ratios = bodyRatios(twoDays(), 175);
    const byKey = new Map(ratios.map((r) => [r.key, r]));

    expect(ratios.map((r) => r.key)).toEqual([...BODY_RATIO_KEYS]);
    // 78 ÷ 99 = 0.7878…, 80 ÷ 100 = 0.8 — two decimals, as displayed.
    expect(byKey.get('waistToHip')).toMatchObject({
      latest: 0.79,
      latestDate: TODAY,
      previous: 0.8,
      previousDate: '2026-05-01',
      change: -0.01,
      missing: [],
    });
    // Height is not a measured site — it comes from the weight goal.
    expect(byKey.get('waistToHeight')).toMatchObject({ latest: 0.45, previous: 0.46 });
  });

  it('HEALTH-BODY-151: a ratio exists only on a day BOTH its sites were taped', () => {
    // "Latest waist ÷ latest hips" would divide two readings weeks apart and
    // present the answer as a fact about a day neither belongs to.
    const straddling = log(
      bodyEntry({ id: 'w', metric: 'waist', date: TODAY, value: 78 }),
      bodyEntry({ id: 'h', metric: 'hips', date: '2026-05-01', value: 100 })
    );

    const waistToHip = bodyRatios(straddling, 175).find((r) => r.key === 'waistToHip')!;
    expect(waistToHip.latest).toBeNull();
    expect(waistToHip.latestDate).toBeNull();
    expect(waistToHip.change).toBeNull();
    // Both sites HAVE been measured, so neither is reported as missing — the
    // card's copy has to say "not on the same day", not "measure your hips".
    expect(waistToHip.missing).toEqual([]);
  });

  it('HEALTH-BODY-152: a ratio MAY cross units, because it is unitless', () => {
    // `summarizeBody` refuses to subtract 31 in from 78 cm — the answer would
    // be a change the body never made. Dividing is a different operation:
    // 78 ÷ 99 in centimetres and 30.7 ÷ 39 in inches are the same number.
    const inches = log(
      bodyEntry({ id: 'w', metric: 'waist', date: TODAY, value: 30.7, unit: 'in' }),
      bodyEntry({ id: 'h', metric: 'hips', date: TODAY, value: 39, unit: 'in' })
    );

    expect(bodyRatios(inches, 175).find((r) => r.key === 'waistToHip')?.latest).toBe(0.79);
  });

  it('HEALTH-BODY-153: names the inputs it is waiting for, and never divides by a missing one', () => {
    const waistOnly = log(bodyEntry({ id: 'w', metric: 'waist', date: TODAY, value: 78 }));

    const byKey = new Map(bodyRatios(waistOnly, null).map((r) => [r.key, r]));
    // Member-facing NAMES, so the card can say what to measure next.
    expect(byKey.get('waistToHip')?.missing).toEqual([BODY_METRIC_LABELS.hips]);
    expect(byKey.get('chestToWaist')?.missing).toEqual([BODY_METRIC_LABELS.chest]);
    expect(byKey.get('shoulderToWaist')?.missing).toEqual([BODY_METRIC_LABELS.shoulders]);
    // Height lives on the weight goal, not on this tab, so it is named as
    // itself rather than as a site to tape.
    expect(byKey.get('waistToHeight')?.missing).toEqual(['Height']);
    expect(byKey.get('waistToHeight')?.latest).toBeNull();
  });

  it('HEALTH-BODY-154: a body-fat percentage is never an input to a length ratio', () => {
    // '%' is not a length, so it cannot be normalised to centimetres. A ratio
    // that silently treated 18.4 as 18.4 cm would be a confident nonsense.
    const withFat = log(
      bodyEntry({ id: 'f', metric: 'bodyFat', date: TODAY, value: 18.4, unit: '%' }),
      bodyEntry({ id: 'w', metric: 'waist', date: TODAY, value: 78 }),
      bodyEntry({ id: 'h', metric: 'hips', date: TODAY, value: 99 })
    );

    expect(bodyRatios(withFat, 175).find((r) => r.key === 'waistToHip')?.latest).toBe(0.79);
  });

  it('HEALTH-BODY-156: a site taped twice in one day contributes its NEWEST reading', () => {
    // Re-measuring after a bad tape pull must move the ratio too — otherwise
    // the tile above the card and the ratio below it would disagree about the
    // same morning.
    const reTaped = log(
      bodyEntry({ id: 'w-am', metric: 'waist', date: TODAY, value: 84, loggedAt: `${TODAY}T07:00:00.000Z` }),
      bodyEntry({ id: 'w-pm', metric: 'waist', date: TODAY, value: 78, loggedAt: `${TODAY}T18:00:00.000Z` }),
      bodyEntry({ id: 'h', metric: 'hips', date: TODAY, value: 99 })
    );

    // 78 ÷ 99 = 0.79, not 84 ÷ 99 = 0.85.
    expect(bodyRatios(reTaped, 175).find((r) => r.key === 'waistToHip')?.latest).toBe(0.79);
  });

  it('HEALTH-BODY-155: a zero or absent height cannot produce an infinite ratio', () => {
    const waistOnly = log(bodyEntry({ id: 'w', metric: 'waist', date: TODAY, value: 78 }));

    expect(bodyRatios(waistOnly, 0).find((r) => r.key === 'waistToHeight')?.latest).toBeNull();
    expect(bodyRatios([], 175).every((r) => r.latest === null)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Left / right — a difference, never a score                          */
/* ------------------------------------------------------------------ */

describe('bodySideDifferences', () => {
  it('HEALTH-BODY-160: reports a signed difference for every measured pair', () => {
    const rows = bodySideDifferences(
      log(
        bodyEntry({ id: 'la', metric: 'leftArm', date: TODAY, value: 34 }),
        bodyEntry({ id: 'ra', metric: 'rightArm', date: TODAY, value: 33.5 }),
        bodyEntry({ id: 'lc', metric: 'leftCalf', date: TODAY, value: 38 }),
        bodyEntry({ id: 'rc', metric: 'rightCalf', date: TODAY, value: 38.6 })
      )
    );

    expect(rows.map((r) => r.label)).toEqual(['Arm', 'Calf']);
    // left − right, in the member's own unit. The donor stores `min ÷ max` as a
    // percentage and colours it; a graded body measurement is exactly what this
    // app does not do.
    expect(rows[0]).toMatchObject({ difference: 0.5, unit: 'cm', unitMismatch: false });
    expect(rows[1].difference).toBe(-0.6);
  });

  it('HEALTH-BODY-161: a pair with only one side measured is not a row', () => {
    // A missing side is not a difference of zero — "perfectly symmetrical"
    // would be a claim made about a limb nobody taped.
    const rows = bodySideDifferences(
      log(bodyEntry({ id: 'la', metric: 'leftArm', date: TODAY, value: 34 }))
    );

    expect(rows).toEqual([]);
  });

  it('HEALTH-BODY-162: a pair measured in two units reports no difference', () => {
    const rows = bodySideDifferences(
      log(
        bodyEntry({ id: 'la', metric: 'leftArm', date: TODAY, value: 34, unit: 'cm' }),
        bodyEntry({ id: 'ra', metric: 'rightArm', date: TODAY, value: 13, unit: 'in' })
      )
    );

    // 34 − 13 = 21 would be a spectacular, entirely fictional asymmetry.
    expect(rows[0]).toMatchObject({ label: 'Arm', unitMismatch: true, difference: null });
  });

  it('HEALTH-BODY-163: each side uses its own LATEST reading', () => {
    const rows = bodySideDifferences(
      log(
        bodyEntry({ id: 'la-old', metric: 'leftArm', date: '2026-05-01', value: 33 }),
        bodyEntry({ id: 'la-new', metric: 'leftArm', date: TODAY, value: 34 }),
        bodyEntry({ id: 'ra', metric: 'rightArm', date: TODAY, value: 34 })
      )
    );

    expect(rows[0]).toMatchObject({ difference: 0, unitMismatch: false });
    expect(rows[0].left.id).toBe('la-new');
  });
});

/* ------------------------------------------------------------------ */
/* Composition — gathered, never recomputed                            */
/* ------------------------------------------------------------------ */

describe('summarizeBodyComposition', () => {
  const complete = {
    weightKg: 80,
    heightCm: 180,
    gender: 'male' as const,
    birthYear: 1990,
    activityLevel: 'moderatelyActive' as const,
    bodyFatPercent: 18,
    today: TODAY,
  };

  it('HEALTH-BODY-170: reports every figure once all its inputs exist', () => {
    // The arithmetic is `healthWeightAnalytics`' — Mifflin–St Jeor lives there
    // because the Weight tab renders the same figures, and two copies is how
    // two tabs come to disagree about one person's BMR. Pinned here as the
    // numbers a member would actually read.
    expect(summarizeBodyComposition(complete)).toEqual({
      bmi: 24.7, // 80 ÷ 1.8²
      bmr: 1750, // 10·80 + 6.25·180 − 5·36 + 5
      tdee: 2713, // 1750 × 1.55
      fatMassKg: 14.4,
      leanMassKg: 65.6,
      bodyFatPercent: 18,
      missing: [],
    });
  });

  it('HEALTH-BODY-171: an empty profile reports NOTHING and names what it needs', () => {
    // Every figure is null until its inputs are real — a BMR computed from a
    // guessed activity level is a calorie number the member would act on.
    expect(
      summarizeBodyComposition({
        weightKg: null,
        heightCm: null,
        gender: null,
        birthYear: null,
        activityLevel: null,
        bodyFatPercent: null,
        today: TODAY,
      })
    ).toEqual({
      bmi: null,
      bmr: null,
      tdee: null,
      fatMassKg: null,
      leanMassKg: null,
      bodyFatPercent: null,
      missing: [
        'A weight reading',
        'Height',
        'Sex',
        'Birth year',
        'Activity level',
        'A body-fat reading',
      ],
    });
  });

  it('HEALTH-BODY-172: each figure fails independently of the others', () => {
    // A member with no body-fat reading still gets a BMI and a BMR; a member
    // with no activity level still gets the BMR the TDEE would have scaled.
    const noFat = summarizeBodyComposition({ ...complete, bodyFatPercent: null });
    expect(noFat).toMatchObject({ bmi: 24.7, bmr: 1750, tdee: 2713, leanMassKg: null });
    expect(noFat.missing).toEqual(['A body-fat reading']);

    const noActivity = summarizeBodyComposition({ ...complete, activityLevel: null });
    expect(noActivity).toMatchObject({ bmr: 1750, tdee: null, leanMassKg: 65.6 });
    expect(noActivity.missing).toEqual(['Activity level']);
  });

  it('HEALTH-BODY-173: the age is taken from the day being summarised', () => {
    // `today` defaults to the wall clock, which is what every screen call
    // relies on; passing it is what makes a summary of a past day honest.
    expect(summarizeBodyComposition({ ...complete, today: '2036-07-13' }).bmr).toBe(1750 - 5 * 10);
    // Defaulted: the clock is pinned to 2026 in this suite, so it agrees with
    // the explicit case above.
    const withoutToday: Omit<typeof complete, 'today'> = { ...complete };
    delete (withoutToday as Partial<typeof complete>).today;
    expect(summarizeBodyComposition(withoutToday).bmr).toBe(1750);
  });
});
