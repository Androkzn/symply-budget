/**
 * Symply Health — Women's Health / cycle tracking (donor `WomensHealthView`).
 *
 * This is the most sensitive data in the app, so the suite pins three things:
 *  1. the pure cycle MATHS (cycle day, phase, predictions, observed averages) —
 *     calendar arithmetic presented as wellness estimates, never as medical or
 *     contraceptive guidance, so an off-by-one here is a product claim;
 *  2. the WIRE contract — the donor's 1–5 `flow_level` scale ↔ the app's named
 *     levels, and the per-symptom snake_case columns ↔ the screen's severity map;
 *  3. the OFFLINE contract — a dropped request must never blank a log the user
 *     depends on, and a tap must still look like it worked.
 *
 * `fakeCycleServer` keeps the rows because every writer re-reads the log
 * afterwards; a static list mock would report every logged day as lost.
 */

import { healthApi, type HealthCycleSymptomEntry, type HealthPeriodEntry } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  averageCycleLength,
  averagePeriodLength,
  clampCycleLength,
  clampPeriodLength,
  commonSymptoms,
  createEmptySymptomEntry,
  CRAVING_LABELS,
  CRAVINGS,
  cycleDayLabel,
  cycleDayOn,
  CYCLE_PHASE_DESCRIPTIONS,
  CYCLE_PHASE_ICONS,
  CYCLE_PHASE_LABELS,
  CYCLE_PHASES,
  CYCLE_SYMPTOM_CATEGORY,
  CYCLE_SYMPTOM_LABELS,
  CYCLE_SYMPTOMS,
  daysBetween,
  DEFAULT_CYCLE_SETTINGS,
  FLOW_LABELS,
  FLOW_LEVELS,
  flowFromLevel,
  HEALTH_CYCLE_PERIODS_KEY,
  HEALTH_CYCLE_SETTINGS_KEY,
  HEALTH_CYCLE_SYMPTOMS_KEY,
  isCyclePhase,
  isCycleSymptom,
  isFlowLevel,
  levelFromFlow,
  loadCycleSettings,
  loadCycleSymptoms,
  loadCycleSymptomsForDate,
  loadPeriodEntries,
  logPeriodDay,
  periodStarts,
  phaseForCycleDay,
  phaseOn,
  predictCycle,
  removePeriodDay,
  saveCycleSettings,
  saveCycleSymptomEntry,
  SYMPTOM_COLUMN,
  type CycleSettings,
  type CycleSymptomEntry,
  type PeriodEntry,
} from '../healthCycleStorage';
import {
  __setHealthOfflineForTests,
  clearHealthCache,
  healthSyncStateFor,
} from '../healthRepository';
import {
  cycleSettingsRow,
  cycleSymptomRow,
  installHealthApiDefaults,
  NETWORK_ERROR,
  ok,
  periodRow,
  type MockedHealthApi,
} from '../test-utils/healthApiTestKit';

jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

/** 28-day cycle anchored three days ago — cycle day 4, still bleeding. */
const ANCHORED: CycleSettings = {
  cycleLength: 28,
  periodLength: 5,
  lastPeriodStart: '2026-07-10',
};

function period(over: Partial<PeriodEntry> = {}): PeriodEntry {
  return {
    id: over.id ?? `period-${over.date ?? TODAY}`,
    date: over.date ?? TODAY,
    flow: over.flow ?? 'medium',
    notes: over.notes ?? '',
    loggedAt: over.loggedAt ?? '2026-07-13T08:00:00.000Z',
  };
}

function symptomEntry(over: Partial<CycleSymptomEntry> = {}): CycleSymptomEntry {
  return {
    id: over.id ?? `cycle-${over.date ?? TODAY}`,
    date: over.date ?? TODAY,
    mood: over.mood ?? null,
    energy: over.energy ?? null,
    sleepQuality: over.sleepQuality ?? null,
    symptoms: over.symptoms ?? {},
    craving: over.craving ?? 'none',
    notes: over.notes ?? '',
    loggedAt: over.loggedAt ?? '2026-07-13T08:00:00.000Z',
  };
}

/** Stand-in for `/health/cycle/*` — periods and symptoms are both per-DATE. */
function fakeCycleServer(): {
  periods: HealthPeriodEntry[];
  symptoms: HealthCycleSymptomEntry[];
} {
  const state = { periods: [] as HealthPeriodEntry[], symptoms: [] as HealthCycleSymptomEntry[] };
  api.listPeriods.mockImplementation(() => Promise.resolve(ok({ periods: [...state.periods] })));
  api.logPeriodDay.mockImplementation((body) => {
    state.periods = [
      ...state.periods.filter((p) => p.date !== body.date),
      periodRow({
        id: `p-${body.date}`,
        date: body.date,
        flow_level: body.flow_level,
        notes: body.notes ?? null,
      }),
    ];
    return Promise.resolve(ok({ periods: [...state.periods], settings: null }));
  });
  api.removePeriodDay.mockImplementation((date) => {
    state.periods = state.periods.filter((p) => p.date !== date);
    return Promise.resolve(ok({ deleted: true, periods: [...state.periods] }));
  });
  api.listCycleSymptoms.mockImplementation(() =>
    Promise.resolve(ok({ symptoms: [...state.symptoms] }))
  );
  api.saveCycleSymptoms.mockImplementation((body) => {
    const row = cycleSymptomRow({
      ...(body as unknown as Partial<HealthCycleSymptomEntry>),
      id: `s-${body.date}`,
    });
    state.symptoms = [...state.symptoms.filter((s) => s.date !== body.date), row];
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

/* ---------------------------------------------------------------- */
/* Donor enum contract                                               */
/* ---------------------------------------------------------------- */

describe('healthCycleStorage — donor enum contract', () => {
  it('HEALTH-CYCLE-001: every phase carries a label, a description and a kit icon', () => {
    expect(CYCLE_PHASES).toEqual(['menstrual', 'follicular', 'ovulation', 'luteal']);
    for (const phase of CYCLE_PHASES) {
      expect(CYCLE_PHASE_LABELS[phase]).toBeTruthy();
      expect(CYCLE_PHASE_ICONS[phase]).toBeTruthy();
      // The copy is deliberately informational — a missing description would
      // leave the phase card making a bare claim with no context.
      expect(CYCLE_PHASE_DESCRIPTIONS[phase].length).toBeGreaterThan(20);
    }
  });

  it('HEALTH-CYCLE-002: every symptom has a label, a donor column and a category', () => {
    expect(CYCLE_SYMPTOMS).toHaveLength(10);
    for (const symptom of CYCLE_SYMPTOMS) {
      expect(CYCLE_SYMPTOM_LABELS[symptom]).toBeTruthy();
      expect(SYMPTOM_COLUMN[symptom]).toMatch(/^[a-z_]+$/); // snake_case D1 column
      expect(['physical', 'emotional']).toContain(CYCLE_SYMPTOM_CATEGORY[symptom]);
    }
    // The donor's split: the last three are the emotional card.
    expect(
      CYCLE_SYMPTOMS.filter((s) => CYCLE_SYMPTOM_CATEGORY[s] === 'emotional')
    ).toEqual(['anxiety', 'irritability', 'sadness']);
  });

  it('HEALTH-CYCLE-003: flow levels and cravings each carry a label', () => {
    expect(FLOW_LEVELS).toEqual(['spotting', 'light', 'medium', 'heavy', 'veryHeavy']);
    for (const flow of FLOW_LEVELS) expect(FLOW_LABELS[flow]).toBeTruthy();
    for (const craving of CRAVINGS) expect(CRAVING_LABELS[craving]).toBeTruthy();
  });

  it('HEALTH-CYCLE-004: the type guards only accept known values', () => {
    expect(isCyclePhase('luteal')).toBe(true);
    expect(isCyclePhase('waxing')).toBe(false);
    expect(isFlowLevel('veryHeavy')).toBe(true);
    expect(isFlowLevel('torrential')).toBe(false);
    expect(isCycleSymptom('cramps')).toBe(true);
    expect(isCycleSymptom('hiccups')).toBe(false);
  });
});

/* ---------------------------------------------------------------- */
/* Pure cycle maths                                                  */
/* ---------------------------------------------------------------- */

describe('healthCycleStorage — clamps', () => {
  it('HEALTH-CYCLE-005: clamps a cycle length to the donor 20–45 day range', () => {
    expect(clampCycleLength(28)).toBe(28);
    expect(clampCycleLength(10)).toBe(20);
    expect(clampCycleLength(90)).toBe(45);
    expect(clampCycleLength(27.6)).toBe(28);
    expect(clampCycleLength(NaN)).toBe(DEFAULT_CYCLE_SETTINGS.cycleLength);
  });

  it('HEALTH-CYCLE-006: clamps a period length to 1–14 days', () => {
    expect(clampPeriodLength(5)).toBe(5);
    expect(clampPeriodLength(0)).toBe(1);
    expect(clampPeriodLength(30)).toBe(14);
    expect(clampPeriodLength(NaN)).toBe(DEFAULT_CYCLE_SETTINGS.periodLength);
  });
});

describe('healthCycleStorage — cycle day & phase', () => {
  it('HEALTH-CYCLE-007: daysBetween counts whole days in both directions', () => {
    expect(daysBetween('2026-07-10', '2026-07-13')).toBe(3);
    expect(daysBetween('2026-07-13', '2026-07-10')).toBe(-3);
    expect(daysBetween('2026-06-30', '2026-07-01')).toBe(1); // month boundary
    expect(daysBetween('2026-07-13', '2026-07-13')).toBe(0);
  });

  it('HEALTH-CYCLE-008: cycleDayOn is null until the first period is logged', () => {
    // The screen must say "log a period to see your cycle" rather than invent
    // day 1 and start predicting from a date the user never entered.
    expect(cycleDayOn(TODAY, DEFAULT_CYCLE_SETTINGS)).toBeNull();
  });

  it('HEALTH-CYCLE-009: cycleDayOn is 1-based and wraps by the cycle length', () => {
    expect(cycleDayOn('2026-07-10', ANCHORED)).toBe(1); // the anchor itself
    expect(cycleDayOn(TODAY, ANCHORED)).toBe(4);
    expect(cycleDayOn('2026-08-07', ANCHORED)).toBe(1); // exactly one cycle on
    // A date BEFORE the anchor still lands in range rather than going negative.
    expect(cycleDayOn('2026-07-09', ANCHORED)).toBe(28);
  });

  it('HEALTH-CYCLE-010: phases follow the donor boundaries around cycleLength − 14', () => {
    expect(phaseForCycleDay(1, ANCHORED)).toBe('menstrual');
    expect(phaseForCycleDay(5, ANCHORED)).toBe('menstrual'); // inclusive
    expect(phaseForCycleDay(6, ANCHORED)).toBe('follicular');
    // A 3-day ovulation window centred on day 14 of a 28-day cycle.
    expect(phaseForCycleDay(13, ANCHORED)).toBe('ovulation');
    expect(phaseForCycleDay(14, ANCHORED)).toBe('ovulation');
    expect(phaseForCycleDay(15, ANCHORED)).toBe('ovulation');
    expect(phaseForCycleDay(16, ANCHORED)).toBe('luteal');
  });

  it('HEALTH-CYCLE-011: phaseOn resolves a date, or null before the first log', () => {
    expect(phaseOn(TODAY, ANCHORED)).toBe('menstrual');
    expect(phaseOn('2026-07-23', ANCHORED)).toBe('ovulation'); // cycle day 14
    expect(phaseOn(TODAY, DEFAULT_CYCLE_SETTINGS)).toBeNull();
  });

  it('HEALTH-CYCLE-012: cycleDayLabel renders an em dash before the first log', () => {
    expect(cycleDayLabel('2026-07-13T09:00:00.000Z', ANCHORED)).toBe('Day 4');
    expect(cycleDayLabel('2026-07-13T09:00:00.000Z', DEFAULT_CYCLE_SETTINGS)).toBe('—');
  });
});

describe('healthCycleStorage — predictions', () => {
  it('HEALTH-CYCLE-013: predicts nothing at all before the first period is logged', () => {
    expect(predictCycle(DEFAULT_CYCLE_SETTINGS, TODAY)).toEqual({
      nextPeriodStart: null,
      ovulationDate: null,
      fertileWindowStart: null,
      fertileWindowEnd: null,
      daysUntilNextPeriod: null,
    });
  });

  it('HEALTH-CYCLE-014: projects the next period, ovulation and the 6-day fertile window', () => {
    expect(predictCycle(ANCHORED, TODAY)).toEqual({
      nextPeriodStart: '2026-08-07', // anchor + 28
      ovulationDate: '2026-07-24', // anchor + (28 − 14)
      fertileWindowStart: '2026-07-20', // ovulation − 4
      fertileWindowEnd: '2026-07-25', // ovulation + 1
      daysUntilNextPeriod: 25,
    });
  });

  it('HEALTH-CYCLE-015: rolls a stale anchor forward instead of predicting the past', () => {
    // Someone who stopped logging in May must still be told when the NEXT
    // period is due, not shown a date two months behind them.
    const stale: CycleSettings = { ...ANCHORED, lastPeriodStart: '2026-05-01' };
    const prediction = predictCycle(stale, TODAY);

    expect(prediction.nextPeriodStart).toBe('2026-07-24');
    expect(prediction.daysUntilNextPeriod).toBe(11);
    expect(prediction.daysUntilNextPeriod as number).toBeGreaterThan(0);
  });
});

describe('healthCycleStorage — observed averages', () => {
  const run = (dates: string[]): PeriodEntry[] => dates.map((date) => period({ date }));

  it('HEALTH-CYCLE-016: a period START is the first day of a run, not every logged day', () => {
    // Three consecutive bleeding days are ONE period; counting each as a start
    // would report a 1-day cycle length.
    expect(periodStarts(run(['2026-06-12', '2026-06-13', '2026-06-14', '2026-07-10']))).toEqual([
      '2026-06-12',
      '2026-07-10',
    ]);
  });

  it('HEALTH-CYCLE-017: averages the gaps between consecutive starts', () => {
    expect(
      averageCycleLength(run(['2026-06-12', '2026-06-13', '2026-07-10', '2026-07-11']))
    ).toBe(28);
  });

  it('HEALTH-CYCLE-018: reports no average until two starts exist, or when a gap is implausible', () => {
    expect(averageCycleLength([])).toBeNull();
    expect(averageCycleLength(run(['2026-07-10']))).toBeNull();
    // A 100-day gap is a stopped-logging artefact, not a cycle — including it
    // would drag the prediction months out.
    expect(averageCycleLength(run(['2026-01-01', '2026-07-10']))).toBeNull();
  });

  it('HEALTH-CYCLE-019: averages bleeding days per run, and reports null with no data', () => {
    expect(
      averagePeriodLength(
        run(['2026-06-12', '2026-06-13', '2026-06-14', '2026-07-10', '2026-07-11', '2026-07-12'])
      )
    ).toBe(3);
    expect(averagePeriodLength([])).toBeNull();
  });

  it('HEALTH-CYCLE-020: commonSymptoms ranks by frequency, ignoring zero severities', () => {
    const entries = [
      symptomEntry({ date: '2026-07-13', symptoms: { cramps: 2, bloating: 1 } }),
      symptomEntry({ date: '2026-07-12', symptoms: { cramps: 3, headache: 0 } }),
      symptomEntry({ date: '2026-07-11', symptoms: { cramps: 1, bloating: 2 } }),
    ];

    // A severity of 0 means "not present" — counting it would crown a symptom
    // the user explicitly cleared.
    expect(commonSymptoms(entries)).toEqual([
      { symptom: 'cramps', count: 3 },
      { symptom: 'bloating', count: 2 },
    ]);
    expect(commonSymptoms(entries, 1)).toHaveLength(1);
    expect(commonSymptoms([])).toEqual([]);
  });
});

/* ---------------------------------------------------------------- */
/* Wire contract                                                     */
/* ---------------------------------------------------------------- */

describe('healthCycleStorage — flow level mapping', () => {
  it('HEALTH-CYCLE-021: maps the donor 1–5 flow scale onto the named levels both ways', () => {
    expect([1, 2, 3, 4, 5].map(flowFromLevel)).toEqual([
      'spotting',
      'light',
      'medium',
      'heavy',
      'veryHeavy',
    ]);
    expect(FLOW_LEVELS.map(levelFromFlow)).toEqual([1, 2, 3, 4, 5]);
  });

  it('HEALTH-CYCLE-022: an out-of-range level degrades to the middle of the scale', () => {
    // A row written by a future donor build (or a corrupt column) must render
    // as a plausible flow rather than crash the calendar cell.
    expect(flowFromLevel(0)).toBe('medium');
    expect(flowFromLevel(9)).toBe('medium');
    expect(levelFromFlow('unknown' as never)).toBe(3);
  });
});

describe('healthCycleStorage — settings wire contract', () => {
  it('HEALTH-CYCLE-023: maps the snake_case settings row onto the screen shape', async () => {
    api.getCycleSettings.mockResolvedValue(
      ok({
        settings: cycleSettingsRow({
          cycle_length: 30,
          period_length: 6,
          last_period_start: '2026-07-10',
        }),
      })
    );

    expect(await loadCycleSettings()).toEqual<CycleSettings>({
      cycleLength: 30,
      periodLength: 6,
      lastPeriodStart: '2026-07-10',
    });
    expect(healthSyncStateFor(HEALTH_CYCLE_SETTINGS_KEY)).toBe('synced');
  });

  it('HEALTH-CYCLE-024: an account with no settings row falls back to the donor defaults', async () => {
    api.getCycleSettings.mockResolvedValue(ok({ settings: null }));
    expect(await loadCycleSettings()).toEqual(DEFAULT_CYCLE_SETTINGS);
  });

  it('HEALTH-CYCLE-025: clamps an implausible stored length instead of predicting from it', async () => {
    api.getCycleSettings.mockResolvedValue(
      ok({ settings: cycleSettingsRow({ cycle_length: 90, period_length: 0 }) })
    );

    expect(await loadCycleSettings()).toMatchObject({ cycleLength: 45, periodLength: 1 });
  });

  it('HEALTH-CYCLE-026: saveCycleSettings writes all three donor columns', async () => {
    api.getCycleSettings.mockResolvedValue(ok({ settings: null }));

    const saved = await saveCycleSettings({ cycleLength: 30 });

    // The row is written whole, so a PATCH that omitted the untouched columns
    // would blank the anchor date and stop every prediction.
    expect(api.saveCycleSettings).toHaveBeenCalledWith({
      cycle_length: 30,
      period_length: DEFAULT_CYCLE_SETTINGS.periodLength,
      last_period_start: null,
    });
    expect(saved).toEqual<CycleSettings>({
      cycleLength: 30,
      periodLength: 5,
      lastPeriodStart: null,
    });
  });
});

describe('healthCycleStorage — period log wire contract', () => {
  it('HEALTH-CYCLE-027: maps period rows onto per-date entries newest-first', async () => {
    api.listPeriods.mockResolvedValue(
      ok({
        periods: [
          periodRow({ date: '2026-07-11', flow_level: 2, notes: null }),
          periodRow({ date: '2026-07-13', flow_level: 4, notes: 'Heavy day' }),
        ],
      })
    );

    // Ids are derived from the DATE (`period-<date>`) because there is exactly
    // one bleeding entry per day — this is what makes re-logging an update.
    expect(await loadPeriodEntries()).toEqual<PeriodEntry[]>([
      {
        id: 'period-2026-07-13',
        date: '2026-07-13',
        flow: 'heavy',
        notes: 'Heavy day',
        loggedAt: '2026-07-13T08:00:00.000Z',
      },
      {
        id: 'period-2026-07-11',
        date: '2026-07-11',
        flow: 'light',
        notes: '', // a null note renders as empty, never as "null"
        loggedAt: '2026-07-13T08:00:00.000Z',
      },
    ]);
  });

  it('HEALTH-CYCLE-028: logPeriodDay posts the numeric flow level for the day', async () => {
    fakeCycleServer();

    await logPeriodDay('heavy', TODAY, 'Cramps in the morning');

    expect(api.logPeriodDay).toHaveBeenCalledWith({
      date: TODAY,
      flow_level: 4,
      notes: 'Cramps in the morning',
    });
  });

  it('HEALTH-CYCLE-029: re-logging a day updates the flow instead of stacking duplicates', async () => {
    fakeCycleServer();

    await logPeriodDay('light', TODAY);
    const entries = await logPeriodDay('heavy', TODAY);

    // Two rows for one date would corrupt `averagePeriodLength`, which counts
    // distinct logged DAYS.
    expect(entries).toHaveLength(1);
    expect(entries[0].flow).toBe('heavy');
  });

  it('HEALTH-CYCLE-030: logging a day refreshes the settings the server re-anchored', async () => {
    fakeCycleServer();
    api.getCycleSettings.mockResolvedValue(
      ok({ settings: cycleSettingsRow({ last_period_start: TODAY }) })
    );

    await logPeriodDay('medium', TODAY);

    // The server owns the "is this the start of a NEW run" rule (and adopts the
    // observed average length), so the client only re-reads afterwards rather
    // than duplicating the logic and disagreeing with it.
    expect(api.getCycleSettings).toHaveBeenCalled();
    expect((await loadCycleSettings()).lastPeriodStart).toBe(TODAY);
  });

  it('HEALTH-CYCLE-031: the note cap reaches the payload, not just the local entry', async () => {
    fakeCycleServer();
    const long = `  ${'n'.repeat(250)}  `;

    const online = await logPeriodDay('medium', TODAY, long);

    // Fixed 2026-07-25. The payload used to send `notes` RAW while only the
    // optimistic entry was trimmed and capped, so the cap was cosmetic: the
    // oversized note was what the server stored and what came straight back on
    // the next read, contradicting what the client had just rendered.
    expect(api.logPeriodDay.mock.calls[0][0].notes).toHaveLength(200);
    expect(api.logPeriodDay.mock.calls[0][0].notes).toBe('n'.repeat(200));
    expect(online[0].notes).toHaveLength(200);

    // The offline branch caps identically — the two paths must not disagree.
    __setHealthOfflineForTests(true);
    const offline = await logPeriodDay('medium', '2026-07-12', long);
    expect(offline.find((e) => e.date === '2026-07-12')?.notes).toHaveLength(200);
  });

  it('HEALTH-CYCLE-032: removePeriodDay deletes by date, not by row id', async () => {
    fakeCycleServer();
    await logPeriodDay('medium', TODAY);

    // The route is keyed by date because the screen only ever knows the calendar
    // cell the user tapped.
    expect(await removePeriodDay(TODAY)).toEqual([]);
    expect(api.removePeriodDay).toHaveBeenCalledWith(TODAY);
  });
});

describe('healthCycleStorage — symptom log wire contract', () => {
  it('HEALTH-CYCLE-033: folds the per-symptom columns into the screen severity map', async () => {
    api.listCycleSymptoms.mockResolvedValue(
      ok({
        symptoms: [
          cycleSymptomRow({
            date: TODAY,
            mood: 4,
            energy: 2,
            cramps: 2,
            breast_tenderness: 1,
            back_pain: 0, // 0 = not present, so it must NOT appear in the map
            anxiety: 7, // out of range — clamped into 1–3
            cravings: 'chocolate',
            notes: 'Tired',
          }),
        ],
      })
    );

    expect(await loadCycleSymptoms()).toEqual<CycleSymptomEntry[]>([
      {
        id: `cycle-${TODAY}`,
        date: TODAY,
        mood: 4,
        energy: 2,
        // `sleep_quality` has existed on the donor column since 0119 and is now
        // read back (2026-07-26); a bare row still means "not rated", not 0.
        sleepQuality: null,
        symptoms: { cramps: 2, breastTenderness: 1, anxiety: 3 },
        craving: 'chocolate',
        notes: 'Tired',
        loggedAt: '2026-07-13T08:00:00.000Z',
      },
    ]);
  });

  it('HEALTH-CYCLE-034: a bare row reads as an empty day, never as nulls in the UI', async () => {
    api.listCycleSymptoms.mockResolvedValue(ok({ symptoms: [cycleSymptomRow({ date: TODAY })] }));

    expect(await loadCycleSymptomsForDate()).toMatchObject({
      symptoms: {},
      craving: 'none', // a null cravings column is "none", not the string "null"
      notes: '',
    });
    expect(await loadCycleSymptomsForDate('2026-01-01')).toBeNull();
  });

  it('HEALTH-CYCLE-035: saveCycleSymptomEntry fans the map back out into every column', async () => {
    fakeCycleServer();

    await saveCycleSymptomEntry({ mood: 4, symptoms: { cramps: 2 }, craving: 'sweet' }, TODAY);

    // EVERY symptom column is written (0 for the ones cleared), otherwise an
    // unticked symptom would keep whatever severity it had last time.
    expect(api.saveCycleSymptoms).toHaveBeenCalledWith({
      date: TODAY,
      mood: 4,
      energy: null,
      sleep_quality: null,
      cravings: 'sweet',
      notes: '',
      cramps: 2,
      headache: 0,
      bloating: 0,
      breast_tenderness: 0,
      back_pain: 0,
      acne: 0,
      nausea: 0,
      anxiety: 0,
      irritability: 0,
      sadness: 0,
    });
  });

  it('HEALTH-CYCLE-036: saving merges into the existing day rather than replacing it', async () => {
    fakeCycleServer();

    await saveCycleSymptomEntry({ mood: 4, symptoms: { cramps: 2 } }, TODAY);
    const entries = await saveCycleSymptomEntry({ energy: 3 }, TODAY);

    // One entry per day: a second save must keep the mood and the cramps the
    // first save recorded.
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ mood: 4, energy: 3, symptoms: { cramps: 2 } });
  });

  it('HEALTH-CYCLE-037: an empty entry template carries the neutral donor defaults', () => {
    expect(createEmptySymptomEntry(TODAY)).toEqual<CycleSymptomEntry>({
      id: `cycle-${TODAY}`,
      date: TODAY,
      mood: null,
      energy: null,
      sleepQuality: null,
      symptoms: {},
      craving: 'none',
      notes: '',
      loggedAt: '',
    });
  });
});

/* ---------------------------------------------------------------- */
/* Offline contract                                                  */
/* ---------------------------------------------------------------- */

describe('healthCycleStorage — offline contract', () => {
  it('HEALTH-CYCLE-038: settings fall back to the cached copy so predictions survive', async () => {
    await storageHelpers.setObject(HEALTH_CYCLE_SETTINGS_KEY, {
      cycleLength: 30,
      periodLength: 6,
      lastPeriodStart: '2026-07-10',
    });
    api.getCycleSettings.mockRejectedValue(NETWORK_ERROR);

    const settings = await loadCycleSettings();

    // Without the cache the anchor would vanish and the phase card would drop
    // back to "log a period to see your cycle" on every offline launch.
    expect(settings.lastPeriodStart).toBe('2026-07-10');
    expect(predictCycle(settings, TODAY).nextPeriodStart).toBe('2026-08-09');
    expect(healthSyncStateFor(HEALTH_CYCLE_SETTINGS_KEY)).toBe('offline');
  });

  it('HEALTH-CYCLE-039: the period log falls back to the cached days', async () => {
    await storageHelpers.setObject(HEALTH_CYCLE_PERIODS_KEY, [
      period({ date: '2026-07-11', flow: 'light' }),
      period({ date: '2026-07-13', flow: 'heavy' }),
    ]);
    api.listPeriods.mockRejectedValue(NETWORK_ERROR);

    expect((await loadPeriodEntries()).map((e) => e.date)).toEqual(['2026-07-13', '2026-07-11']);
    expect(healthSyncStateFor(HEALTH_CYCLE_PERIODS_KEY)).toBe('offline');
  });

  it('HEALTH-CYCLE-040: an offline period log returns and caches the optimistic day', async () => {
    __setHealthOfflineForTests(true);

    const entries = await logPeriodDay('heavy', TODAY, 'Cramps');

    expect(entries).toEqual<PeriodEntry[]>([
      {
        id: `period-${TODAY}`,
        date: TODAY,
        flow: 'heavy',
        notes: 'Cramps',
        loggedAt: FIXED_NOW.toISOString(),
      },
    ]);
    expect(api.logPeriodDay).not.toHaveBeenCalled();
    expect((await loadPeriodEntries())[0].flow).toBe('heavy');
  });

  it('HEALTH-CYCLE-041: an offline symptom save returns the merged optimistic entry', async () => {
    await storageHelpers.setObject(HEALTH_CYCLE_SYMPTOMS_KEY, [
      symptomEntry({ date: TODAY, mood: 4, symptoms: { cramps: 2 } }),
    ]);
    __setHealthOfflineForTests(true);

    const entries = await saveCycleSymptomEntry({ energy: 3 }, TODAY);

    expect(entries[0]).toMatchObject({ mood: 4, energy: 3, symptoms: { cramps: 2 } });
    expect(api.saveCycleSymptoms).not.toHaveBeenCalled();
    expect(healthSyncStateFor(HEALTH_CYCLE_SYMPTOMS_KEY)).toBe('offline');
  });

  it('HEALTH-CYCLE-042: corrupt cached rows are dropped rather than rendered', async () => {
    await storageHelpers.setObject(HEALTH_CYCLE_PERIODS_KEY, [
      period({ date: TODAY }),
      { id: 'bad', date: '2026-07-12', flow: 'torrential' }, // not a known level
      null,
    ]);
    await storageHelpers.setObject(HEALTH_CYCLE_SYMPTOMS_KEY, [
      symptomEntry({ date: TODAY }),
      { id: 'bad', date: '2026-07-12' }, // no symptoms object
      null,
    ]);
    __setHealthOfflineForTests(true);

    expect((await loadPeriodEntries()).map((e) => e.date)).toEqual([TODAY]);
    expect((await loadCycleSymptoms()).map((e) => e.date)).toEqual([TODAY]);
  });

  it('HEALTH-CYCLE-043: a non-array cached snapshot degrades to empty, not a crash', async () => {
    await storageHelpers.setObject(HEALTH_CYCLE_PERIODS_KEY, 'nope');
    await storageHelpers.setObject(HEALTH_CYCLE_SYMPTOMS_KEY, 7);
    __setHealthOfflineForTests(true);

    // DEFECT (HEALTH-CYCLE-043): both loaders call `.filter` straight on the
    // cached value, so a corrupt or schema-drifted snapshot throws a TypeError
    // into the Women's Health screen instead of showing empty state. Same
    // pattern as HEALTH-STORE-043 / HEALTH-NUTR-034 / HEALTH-BODY-026.
    expect(await loadPeriodEntries()).toEqual([]);
    expect(await loadCycleSymptoms()).toEqual([]);
  });
});

/* ---------------------------------------------------------------- */
/* Ordering, defaults and partial payloads                           */
/* ---------------------------------------------------------------- */

describe('healthCycleStorage — ordering and partial payloads', () => {
  it('HEALTH-CYCLE-044: a truncated day key is read as the 1st of its month, not as NaN', () => {
    // `daysBetween` is fed from cached keys and from the settings anchor, both
    // of which can be short after a schema drift. Producing NaN there would
    // propagate into the cycle DAY and the next-period prediction, which are
    // the two numbers the whole tab is about.
    expect(daysBetween('2026-07', '2026-07-05')).toBe(4); // missing day → the 1st
    expect(daysBetween('2026', '2026-01-11')).toBe(10); // missing month AND day
    // …and the same repair applies to the SECOND key, either component.
    expect(daysBetween('2026-07-01', '2026-07')).toBe(0);
    expect(daysBetween('2026-01-05', '2026')).toBe(-4);
  });

  it('HEALTH-CYCLE-045: symptoms tied on frequency are ordered alphabetically, not by hash', () => {
    // The patterns card is read top-down. Map insertion order would make two
    // equally-frequent symptoms swap places between reads for no reason the
    // user can see, so the tie-break is deterministic and stable.
    const entries = [
      symptomEntry({ date: '2026-07-13', symptoms: { headache: 2, bloating: 1, acne: 3 } }),
      symptomEntry({ date: '2026-07-12', symptoms: { headache: 1, bloating: 2, acne: 1 } }),
    ];

    expect(commonSymptoms(entries).map((s) => s.symptom)).toEqual([
      'acne',
      'bloating',
      'headache',
    ]);
  });

  it('HEALTH-CYCLE-046: a period row with no notes reads as an empty string', async () => {
    // `notes` binds straight to a <TextInput value>; `null` there logs a React
    // Native warning and makes the field uncontrolled.
    // The bare fixture IS a today-dated row with `notes: null` — the shape the
    // Worker returns for a day logged with a flow and nothing else.
    api.listPeriods.mockResolvedValue(ok({ periods: [periodRow()] }));

    const [entry] = await loadPeriodEntries();
    expect(entry.date).toBe(TODAY);
    expect(entry.notes).toBe('');
  });

  it('HEALTH-CYCLE-047: logPeriodDay with no date logs TODAY', async () => {
    // The screen's flow buttons call `logPeriodDay(flow)` — the defaulted form
    // is the one the app actually uses.
    const server = fakeCycleServer();

    await logPeriodDay('heavy');

    expect(api.logPeriodDay).toHaveBeenCalledWith(
      expect.objectContaining({ date: TODAY, flow_level: levelFromFlow('heavy') })
    );
    expect(server.periods.map((p) => p.date)).toEqual([TODAY]);
  });

  it('HEALTH-CYCLE-048: createEmptySymptomEntry with no date opens TODAY', () => {
    // The screen falls back to this template whenever the day has nothing
    // logged, and it must land on today or the first tap would write yesterday.
    expect(createEmptySymptomEntry()).toEqual({
      id: `cycle-${TODAY}`,
      date: TODAY,
      mood: null,
      energy: null,
      sleepQuality: null,
      symptoms: {},
      craving: 'none',
      notes: '',
      loggedAt: '',
    });
  });

  it('HEALTH-CYCLE-049: a body with no `symptoms` / `periods` key reads as an empty log', async () => {
    api.listCycleSymptoms.mockResolvedValue(ok({} as never));
    api.listPeriods.mockResolvedValue(ok({} as never));

    expect(await loadCycleSymptoms()).toEqual([]);
    expect(await loadCycleSymptomsForDate(TODAY)).toBeNull();
    expect(await loadPeriodEntries()).toEqual([]);
  });

  it('HEALTH-CYCLE-050: saveCycleSymptomEntry with no date writes TODAY', async () => {
    // Every symptom/mood/craving tap on the screen calls this without a date —
    // the defaulted form is the one the app actually uses.
    const server = fakeCycleServer();

    await saveCycleSymptomEntry({ mood: 5 });

    expect(api.saveCycleSymptoms).toHaveBeenCalledWith(
      expect.objectContaining({ date: TODAY, mood: 5 })
    );
    expect(server.symptoms.map((s) => s.date)).toEqual([TODAY]);
  });

  it('HEALTH-CYCLE-061: multi-day symptom logs come back newest-first, and stay that way after a save', async () => {
    // The patterns + recent lists are rendered in array order, so ordering IS
    // the behaviour. Every existing case had at most one row on the wire, which
    // is exactly the size at which a broken comparator still looks correct.
    const server = fakeCycleServer();
    server.symptoms.push(
      cycleSymptomRow({ id: 's-1', date: '2026-07-11', cramps: 2 }),
      cycleSymptomRow({ id: 's-3', date: TODAY, cramps: 1 }),
      cycleSymptomRow({ id: 's-2', date: '2026-07-12', cramps: 3 })
    );

    expect((await loadCycleSymptoms()).map((e) => e.date)).toEqual([
      TODAY,
      '2026-07-12',
      '2026-07-11',
    ]);

    // Saving another day must slot it into the same order, not append it.
    const after = await saveCycleSymptomEntry({ mood: 4 }, '2026-07-10');
    expect(after.map((e) => e.date)).toEqual([TODAY, '2026-07-12', '2026-07-11', '2026-07-10']);
  });
});
