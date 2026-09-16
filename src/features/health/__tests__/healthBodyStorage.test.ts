/**
 * Symply Health — Body measurements (donor "Body" tab).
 *
 * Two invariants carry this module. First the delta rule: a change is only
 * reported when two consecutive readings share a unit, so a cm→in switch never
 * draws a jump the user did not make (same rule as `weightDelta`). Second the
 * shape mismatch: the donor stores ONE row with a column per site, while the
 * screen renders one row per metric — `fromWireMeasurement` fans a wire row out,
 * and `deleteBodyEntry` has to fold the composite id back down.
 */

import { healthApi, type HealthMeasurement } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  addBodyEntry,
  BODY_METRIC_HINTS,
  BODY_METRIC_LABELS,
  BODY_METRIC_TIERS,
  BODY_METRICS,
  bodyMetricTier,
  deleteBodyEntry,
  formatMeasurement,
  HEALTH_BODY_KEY,
  isBodyMetric,
  LENGTH_UNITS,
  loadBodyEntries,
  METRIC_COLUMN,
  parseMeasurementInput,
  PRIMARY_BODY_METRICS,
  summarizeBody,
  unitForMetric,
  type BodyEntry,
} from '../healthBodyStorage';
import {
  __setHealthOfflineForTests,
  clearHealthCache,
  healthSyncStateFor,
} from '../healthRepository';
import {
  installHealthApiDefaults,
  measurementRow,
  NETWORK_ERROR,
  ok,
  type MockedHealthApi,
} from '../test-utils/healthApiTestKit';

jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

function bodyEntry(over: Partial<BodyEntry> = {}): BodyEntry {
  return {
    id: over.id ?? 'b1',
    date: over.date ?? TODAY,
    metric: over.metric ?? 'waist',
    value: over.value ?? 80,
    unit: over.unit ?? 'cm',
    loggedAt: over.loggedAt ?? '2026-07-13T10:00:00.000Z',
  };
}

/** Stand-in for `/health/measurements` — one row per submission, never merged. */
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
  jest.resetAllMocks();
  installHealthApiDefaults(api);
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
});

describe('healthBodyStorage — metric contract', () => {
  it('HEALTH-BODY-001: every exposed site is complete — label, hint, column', () => {
    // Widened twice: six → the 0119 legacy block (14) → the donor's
    // COMPREHENSIVE set (0131). Pinning the literal array a third time would
    // only re-break on the next widening while proving nothing about the sites
    // already there, so what is pinned is the CONTRACT a site has to satisfy to
    // be offered at all. A site with no column is silently discarded by the
    // route's `z.object` (unknown keys are stripped, and it still answers 200),
    // which is the exact failure this catches.
    expect(BODY_METRICS.length).toBeGreaterThan(0);
    expect(new Set(BODY_METRICS).size).toBe(BODY_METRICS.length);
    for (const metric of BODY_METRICS) {
      expect(BODY_METRIC_LABELS[metric]).toBeTruthy();
      expect(BODY_METRIC_HINTS[metric]).toBeTruthy();
      expect(METRIC_COLUMN[metric]).toBeTruthy();
    }
    // No site is offered that the tier split does not place, and the two tiers
    // PARTITION the set — a site in neither would be unreachable from the entry
    // sheet, and one in both would render twice.
    expect(PRIMARY_BODY_METRICS.every((m) => bodyMetricTier(m) === 'primary')).toBe(true);
    expect(BODY_METRICS.filter((m) => bodyMetricTier(m) === 'primary')).toEqual(
      PRIMARY_BODY_METRICS
    );
    expect(BODY_METRICS.every((m) => BODY_METRIC_TIERS.includes(bodyMetricTier(m)))).toBe(true);
    expect(LENGTH_UNITS).toEqual(['cm', 'in']);
  });

  it('HEALTH-BODY-029: the LEGACY sites survive every widening', () => {
    // These fourteen are the 0119 columns — the only ones any deployed client
    // has ever written, so they are the ones with real member data behind them.
    // A rename or a drop during a parity widening would orphan that data on the
    // server while the tab quietly showed nothing.
    for (const legacy of [
      'waist',
      'chest',
      'hips',
      'shoulders',
      'neck',
      'leftArm',
      'rightArm',
      'leftForearm',
      'rightForearm',
      'leftThigh',
      'rightThigh',
      'leftCalf',
      'rightCalf',
      'bodyFat',
    ] as const) {
      expect(BODY_METRICS).toContain(legacy);
      // …and each still maps to the column it has always mapped to.
      expect(METRIC_COLUMN[legacy]).toBe(
        legacy === 'bodyFat'
          ? 'body_fat_percentage'
          : legacy.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
      );
      // The legacy sites are the ones a member reaches without opening
      // "detailed sites" — burying an existing reading behind a disclosure
      // would read as data loss.
      expect(bodyMetricTier(legacy)).toBe('primary');
    }
  });

  it('HEALTH-BODY-002: isBodyMetric only accepts the known metrics', () => {
    expect(isBodyMetric('waist')).toBe(true);
    // `neck` became valid when the vocabulary widened to the full schema set.
    expect(isBodyMetric('neck')).toBe(true);
    expect(isBodyMetric('rightCalf')).toBe(true);
    // Still rejects anything the schema has no column for.
    expect(isBodyMetric('elbow')).toBe(false);
    expect(isBodyMetric('arm')).toBe(false); // superseded by leftArm/rightArm
  });

  it('HEALTH-BODY-003: body fat is a percentage, everything else uses the chosen length unit', () => {
    expect(unitForMetric('bodyFat', 'cm')).toBe('%');
    expect(unitForMetric('waist', 'cm')).toBe('cm');
    expect(unitForMetric('waist', 'in')).toBe('in');
  });

  it('HEALTH-BODY-016: every metric maps to its OWN snake_case column, per side', () => {
    // Limbs are tracked per SIDE. The store used to collapse each pair to a
    // single metric reading the LEFT column, so the right-side columns were
    // never read or written and asymmetry — a real signal — was invisible.
    for (const metric of BODY_METRICS) {
      const column = METRIC_COLUMN[metric];
      // The FE name is camelCase and the D1 column is snake_case; deriving one
      // from the other is what keeps a new site from being mapped by hand onto
      // a column that does not exist. `bodyFat` is the one deliberate
      // exception — the column is named for what it holds, a percentage.
      expect(column).toBe(
        metric === 'bodyFat'
          ? 'body_fat_percentage'
          : metric.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
      );
    }
    // Every metric must have a DISTINCT column — two metrics sharing one would
    // make writing either silently overwrite the other. Checked over the whole
    // map, so a stale entry left behind by a rename is caught too.
    const columns = Object.values(METRIC_COLUMN);
    expect(new Set(columns).size).toBe(columns.length);
    expect(Object.keys(METRIC_COLUMN).sort()).toEqual([...BODY_METRICS].sort());
  });
});

describe('healthBodyStorage — input parsing', () => {
  it('HEALTH-BODY-004: parses one decimal place from a dot or comma', () => {
    expect(parseMeasurementInput('80', 'waist')).toBe(80);
    expect(parseMeasurementInput('80,45', 'waist')).toBe(80.5);
    expect(parseMeasurementInput(' 32.4 ', 'waist')).toBe(32.4);
  });

  it('HEALTH-BODY-005: rejects blank, non-numeric and non-positive input', () => {
    expect(parseMeasurementInput('', 'waist')).toBeNull();
    expect(parseMeasurementInput('abc', 'waist')).toBeNull();
    expect(parseMeasurementInput('0', 'waist')).toBeNull();
    expect(parseMeasurementInput('-4', 'waist')).toBeNull();
    expect(parseMeasurementInput(null as unknown as string, 'waist')).toBeNull();
  });

  it('HEALTH-BODY-006: body fat is bounded at 100%, lengths at the sanity bound', () => {
    expect(parseMeasurementInput('100', 'bodyFat')).toBe(100);
    expect(parseMeasurementInput('101', 'bodyFat')).toBeNull();
    expect(parseMeasurementInput('400', 'waist')).toBe(400);
    expect(parseMeasurementInput('401', 'waist')).toBeNull();
  });

  it('HEALTH-BODY-007: formatMeasurement drops a trailing .0', () => {
    expect(formatMeasurement(80)).toBe('80');
    expect(formatMeasurement(80.5)).toBe('80.5');
  });
});

describe('healthBodyStorage — summaries', () => {
  it('HEALTH-BODY-008: reports every metric, with nulls for the ones never logged', () => {
    const summaries = summarizeBody([bodyEntry()]);
    expect(summaries.map((s) => s.metric)).toEqual(BODY_METRICS);
    expect(summaries.find((s) => s.metric === 'waist')?.latest?.value).toBe(80);
    expect(summaries.find((s) => s.metric === 'chest')?.latest).toBeNull();
    expect(summaries.find((s) => s.metric === 'chest')?.count).toBe(0);
  });

  it('HEALTH-BODY-009: reports the change between the two newest readings of one metric', () => {
    const summaries = summarizeBody([
      bodyEntry({ id: 'new', value: 78.5, loggedAt: '2026-07-13T10:00:00.000Z' }),
      bodyEntry({ id: 'old', value: 80, loggedAt: '2026-07-06T10:00:00.000Z' }),
    ]);
    const waist = summaries.find((s) => s.metric === 'waist');
    expect(waist?.delta).toBe(-1.5);
    expect(waist?.count).toBe(2);
  });

  it('HEALTH-BODY-010: reports NO delta across a unit switch — a converted jump would be a lie', () => {
    const summaries = summarizeBody([
      bodyEntry({ id: 'new', value: 31, unit: 'in', loggedAt: '2026-07-13T10:00:00.000Z' }),
      bodyEntry({ id: 'old', value: 80, unit: 'cm', loggedAt: '2026-07-06T10:00:00.000Z' }),
    ]);
    expect(summaries.find((s) => s.metric === 'waist')?.delta).toBeNull();
  });

  it('HEALTH-BODY-011: a single reading has no delta to report', () => {
    expect(summarizeBody([bodyEntry()]).find((s) => s.metric === 'waist')?.delta).toBeNull();
  });
});

describe('healthBodyStorage — wire contract', () => {
  it('HEALTH-BODY-012: an empty account reads as no measurements', async () => {
    expect(await loadBodyEntries()).toEqual([]);
  });

  it('HEALTH-BODY-017: fans one wire row out into a screen row per populated site', async () => {
    api.listMeasurements.mockResolvedValue(
      ok({
        measurements: [
          measurementRow({
            id: 'srv-1',
            waist: 80,
            left_arm: 34,
            body_fat_percentage: 18.4,
            created_at: '2026-07-13T10:00:00.000Z',
          }),
        ],
      })
    );

    // Ids are `<rowId>:<metric>` so several screen rows can point back at the
    // single measurement row they came from.
    expect(await loadBodyEntries()).toEqual<BodyEntry[]>([
      {
        id: 'srv-1:waist',
        date: TODAY,
        metric: 'waist',
        value: 80,
        unit: 'cm',
        loggedAt: '2026-07-13T10:00:00.000Z',
      },
      {
        id: 'srv-1:leftArm',
        date: TODAY,
        metric: 'leftArm',
        value: 34,
        unit: 'cm',
        loggedAt: '2026-07-13T10:00:00.000Z',
      },
      {
        id: 'srv-1:bodyFat',
        date: TODAY,
        metric: 'bodyFat',
        value: 18.4,
        unit: '%', // never a length, whatever the row's unit column says
        loggedAt: '2026-07-13T10:00:00.000Z',
      },
    ]);
    expect(healthSyncStateFor(HEALTH_BODY_KEY)).toBe('synced');
  });

  it('HEALTH-BODY-018: maps the donor unit alias "inches" onto the app\'s "in"', async () => {
    api.listMeasurements.mockResolvedValue(
      ok({ measurements: [measurementRow({ id: 'srv-1', waist: 31, unit: 'inches' })] })
    );

    // `summarizeBody` compares units by string equality, so a leaked 'inches'
    // next to an 'in' reading would suppress the delta chip forever.
    const entries = await loadBodyEntries();
    expect(entries[0].unit).toBe('in');
    expect(LENGTH_UNITS).toContain(entries[0].unit);
  });

  it('HEALTH-BODY-019: skips the columns a row leaves null', async () => {
    api.listMeasurements.mockResolvedValue(
      ok({ measurements: [measurementRow({ id: 'srv-1', chest: 100 })] })
    );

    // A NULL column means "not measured this session", not "measured as 0".
    expect((await loadBodyEntries()).map((e) => e.metric)).toEqual(['chest']);
  });

  it('HEALTH-BODY-020: falls back to a midday stamp when a row has no created_at', async () => {
    api.listMeasurements.mockResolvedValue(
      ok({
        measurements: [
          measurementRow({
            id: 'srv-1',
            date: '2026-07-09',
            waist: 80,
            created_at: undefined as unknown as string,
          }),
        ],
      })
    );

    expect((await loadBodyEntries())[0].loggedAt).toBe('2026-07-09T12:00:00.000Z');
  });

  it('HEALTH-BODY-027: a row with no unit column reads in cm, not as a blank unit', async () => {
    api.listMeasurements.mockResolvedValue(
      ok({
        measurements: [
          measurementRow({ id: 'srv-1', waist: 80, unit: undefined as unknown as 'cm' }),
        ],
      })
    );

    // `summarizeBody` compares units by string equality to decide whether a
    // delta is honest, so an empty unit would silently suppress the delta chip
    // against every properly-stamped reading beside it.
    const entries = await loadBodyEntries();
    expect(entries[0].unit).toBe('cm');
    expect(LENGTH_UNITS).toContain(entries[0].unit);
  });

  it('HEALTH-BODY-028: a payload with no measurements list reads as no measurements', async () => {
    api.listMeasurements.mockResolvedValue(ok({} as { measurements: HealthMeasurement[] }));

    // A truncated answer must land on the Body tab's empty state, not throw on
    // `.flatMap` and blank the whole tab.
    expect(await loadBodyEntries()).toEqual([]);
  });

  it('HEALTH-BODY-013: adds a reading newest-first with the local day stamped', async () => {
    fakeMeasurementServer();

    await addBodyEntry('waist', 80, 'cm');
    jest.setSystemTime(new Date(2026, 6, 13, 18, 0, 0));
    const list = await addBodyEntry('bodyFat', 18.4, '%');

    expect(list[0]).toMatchObject({ metric: 'bodyFat', value: 18.4, unit: '%', date: TODAY });
    expect(list).toHaveLength(2);
  });

  it('HEALTH-BODY-021: addBodyEntry posts the donor column for the chosen metric', async () => {
    fakeMeasurementServer();

    await addBodyEntry('leftArm', 34, 'in');

    expect(api.createMeasurement).toHaveBeenCalledWith({
      date: TODAY,
      unit: 'in',
      left_arm: 34, // the single-sided metric's LEFT column
    });
  });

  it('HEALTH-BODY-022: body fat still ships a length unit because the row requires one', async () => {
    fakeMeasurementServer();

    await addBodyEntry('bodyFat', 18.4, '%');

    // '%' is not a member of the donor's unit CHECK constraint; the column is a
    // percentage regardless, so the row is sent as 'cm' and the server ignores
    // the unit for that column.
    expect(api.createMeasurement).toHaveBeenCalledWith({
      date: TODAY,
      unit: 'cm',
      body_fat_percentage: 18.4,
    });
  });

  it('HEALTH-BODY-014: deletes by id', async () => {
    fakeMeasurementServer();
    const list = await addBodyEntry('chest', 100, 'cm');

    expect(await deleteBodyEntry(list[0].id)).toEqual([]);
  });

  it('HEALTH-BODY-023: deleteBodyEntry sends the ROW id, not the composite screen id', async () => {
    fakeMeasurementServer();
    const list = await addBodyEntry('chest', 100, 'cm');

    expect(list[0].id).toBe('srv-1:chest');
    // The server deletes whole measurement rows, so the `:metric` suffix has to
    // be stripped — sending it would 404 and silently leave the reading behind.
    await deleteBodyEntry(list[0].id);
    expect(api.deleteMeasurement).toHaveBeenCalledWith('srv-1');
  });
});

describe('healthBodyStorage — offline contract', () => {
  it('HEALTH-BODY-024: a failed read falls back to the cached readings', async () => {
    await storageHelpers.setObject(HEALTH_BODY_KEY, [bodyEntry({ id: 'cached' })]);
    api.listMeasurements.mockRejectedValue(NETWORK_ERROR);

    expect((await loadBodyEntries()).map((e) => e.id)).toEqual(['cached']);
    expect(healthSyncStateFor(HEALTH_BODY_KEY)).toBe('offline');
  });

  it('HEALTH-BODY-025: an offline add returns and caches the optimistic list', async () => {
    __setHealthOfflineForTests(true);

    const list = await addBodyEntry('waist', 78.5, 'cm');

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ metric: 'waist', value: 78.5, unit: 'cm', date: TODAY });
    expect(api.createMeasurement).not.toHaveBeenCalled();
    expect(await loadBodyEntries()).toHaveLength(1);
  });

  it('HEALTH-BODY-015: drops corrupt cached rows on read', async () => {
    await storageHelpers.setObject(HEALTH_BODY_KEY, [
      bodyEntry({ id: 'ok' }),
      // `neck` used to be the example of an unknown metric; it is a real site
      // now, so the corrupt row needs one the schema genuinely has no column for.
      { id: 'bad', metric: 'elbow', value: 40, loggedAt: 'x' },
      null,
    ]);
    __setHealthOfflineForTests(true);

    expect((await loadBodyEntries()).map((e) => e.id)).toEqual(['ok']);
  });

  it('HEALTH-BODY-026: a non-array cached snapshot degrades to empty, not a crash', async () => {
    await storageHelpers.setObject(HEALTH_BODY_KEY, 42);
    __setHealthOfflineForTests(true);

    // Fixed 2026-07-25: `readThrough` now rejects a cached snapshot whose
    // shape does not match the caller's fallback, so a corrupt or
    // schema-drifted blob degrades to the empty state instead of throwing a
    // TypeError into the screen — on exactly the offline path the cache
    // exists to protect.
    expect(await loadBodyEntries()).toEqual([]);
  });
});
