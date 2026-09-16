/**
 * Symply Health — Women's Health (Cycle): the CALENDAR + INSIGHTS layer.
 *
 * ⚠️ These helpers (`hasSymptomContent`, `cycleDayMark`, `cycleCalendarDays`,
 * `countCycleMarks`, `upcomingCycleEvents`, `relativeDayLabel`,
 * `phaseSymptomCounts`, `phaseLoggedDays`, `SLEEP_QUALITY_LABELS`) landed in
 * `healthCycleStorage.ts` on 2026-07-26 as part of the donor month-calendar
 * port. Nothing tested them. They are pure functions of their arguments, and
 * every one of them decides something the person READS OFF A PICTURE — which
 * day was a period, which day is a guess, which date comes next — so a wrong
 * answer here is not a wrong pixel, it is a wrong claim.
 *
 * The single most important property in this file is HEALTH-CYCLE-146:
 * **a logged day and a predicted day must never be the same mark.** The donor
 * painted both the same pink circle because its `isPeriodDay(_:)` was pure
 * arithmetic off the anchor; on a cycle calendar that is the difference between
 * a record and a guess, and the guess is the one that gets read as fact.
 *
 * Positioning is wellness, not clinical: the fertile and ovulation marks are
 * calendar estimates from the person's own logged dates, never contraception.
 */

import { healthApi } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  countCycleMarks,
  createEmptySymptomEntry,
  CYCLE_DAY_MARK_LABELS,
  CYCLE_DAY_MARKS,
  cycleCalendarDays,
  cycleDayMark,
  DEFAULT_CYCLE_SETTINGS,
  hasSymptomContent,
  loadCycleSymptoms,
  phaseLoggedDays,
  phaseSymptomCounts,
  relativeDayLabel,
  SLEEP_QUALITY_LABELS,
  upcomingCycleEvents,
  type CycleCalendarDay,
  type CycleSettings,
  type CycleSymptomEntry,
  type FlowLevel,
  type PeriodEntry,
} from '../../healthCycleStorage';
import { __setHealthOfflineForTests, clearHealthCache } from '../../healthRepository';
import {
  cycleSymptomRow,
  installHealthApiDefaults,
  ok,
  type MockedHealthApi,
} from '../../test-utils/healthApiTestKit';

jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

/** Local noon so `todayDateKey()` is 2026-07-13 in every timezone. */
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

/** 28-day cycle, 5-day period, anchored 2026-07-10 → today is cycle day 4. */
const ANCHORED: CycleSettings = { cycleLength: 28, periodLength: 5, lastPeriodStart: '2026-07-10' };

function symptomEntry(over: Partial<CycleSymptomEntry> = {}): CycleSymptomEntry {
  return { ...createEmptySymptomEntry(over.date ?? TODAY), ...over };
}

function period(date: string, flow: FlowLevel = 'medium'): PeriodEntry {
  return { id: `period-${date}`, date, flow, notes: '', loggedAt: `${date}T08:00:00.000Z` };
}

/** A one-row "month grid" in the shape `heatmapMonthGrid` produces. */
function row(dates: string[], inMonth = true) {
  return dates.map((date) => ({ date, day: Number(date.slice(-2)), inMonth }));
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

/* ------------------------------------------------------------------ */
/* hasSymptomContent — "is this day actually logged?"                  */
/* ------------------------------------------------------------------ */

describe('hasSymptomContent', () => {
  it('HEALTH-CYCLE-146: an entry that exists but holds nothing is NOT a logged day', () => {
    // Every symptom save writes a whole row, so a day the person opened and
    // backed out of still has a row on the wire. Counting it would put a
    // "you wrote something here" dot on a day they never wrote on.
    expect(hasSymptomContent(null)).toBe(false);
    expect(hasSymptomContent(undefined)).toBe(false);
    expect(hasSymptomContent(createEmptySymptomEntry(TODAY))).toBe(false);
    // A cleared symptom (severity 0) and a whitespace-only note are both the
    // shapes "I deleted what I wrote" leaves behind.
    expect(hasSymptomContent(symptomEntry({ symptoms: { cramps: 0 as never } }))).toBe(false);
    // …and an `undefined` left behind by a deleted key is the same as absent.
    expect(hasSymptomContent(symptomEntry({ symptoms: { cramps: undefined } }))).toBe(false);
    expect(hasSymptomContent(symptomEntry({ notes: '   \n  ' }))).toBe(false);
    expect(hasSymptomContent(symptomEntry({ craving: 'none' }))).toBe(false);
  });

  it('HEALTH-CYCLE-147: any ONE field the person set makes the day count', () => {
    // Six independent ways to have logged something. A missed arm means a day
    // the person did fill in shows as blank on the calendar — the failure that
    // makes them log it twice.
    const cases: Array<[string, Partial<CycleSymptomEntry>]> = [
      ['mood', { mood: 3 }],
      ['energy', { energy: 1 }],
      ['sleep', { sleepQuality: 5 }],
      ['craving', { craving: 'chocolate' }],
      ['note', { notes: 'ok' }],
      ['symptom', { symptoms: { cramps: 1 } }],
    ];
    for (const [field, patch] of cases) {
      expect([field, hasSymptomContent(symptomEntry(patch))]).toEqual([field, true]);
    }
  });
});

/* ------------------------------------------------------------------ */
/* cycleDayMark — a record must not look like a guess                  */
/* ------------------------------------------------------------------ */

describe('cycleDayMark', () => {
  const logged = new Set(['2026-07-10', '2026-07-11']);

  it('HEALTH-CYCLE-148: a LOGGED bleeding day always outranks a prediction', () => {
    // The whole point of the two-form encoding. If a prediction could overwrite
    // a logged day the calendar would silently restate the person's own record
    // as an estimate — or, worse, an estimate as their record.
    expect(cycleDayMark('2026-07-10', ANCHORED, logged)).toBe('period');
    expect(cycleDayMark('2026-07-11', ANCHORED, logged)).toBe('period');
    // …and a logged day is a logged day even with NO settings to predict from.
    expect(cycleDayMark('2026-07-10', DEFAULT_CYCLE_SETTINGS, logged)).toBe('period');
  });

  it('HEALTH-CYCLE-149: an UNLOGGED day inside the period window is marked as expected, not logged', () => {
    // 07-12 … 07-14 are cycle positions 2–4 of a 5-day period the person has
    // not logged yet.
    expect(cycleDayMark('2026-07-12', ANCHORED, logged)).toBe('predictedPeriod');
    expect(cycleDayMark('2026-07-14', ANCHORED, logged)).toBe('predictedPeriod');
    // Position 5 is past the period length — no mark at all.
    expect(cycleDayMark('2026-07-15', ANCHORED, logged)).toBeNull();
    // …and the NEXT cycle's period window is predicted too (positions 0–4).
    expect(cycleDayMark('2026-08-07', ANCHORED, logged)).toBe('predictedPeriod');
    expect(cycleDayMark('2026-08-11', ANCHORED, logged)).toBe('predictedPeriod');
    expect(cycleDayMark('2026-08-12', ANCHORED, logged)).toBeNull();
  });

  it('HEALTH-CYCLE-150: the fertile window is a 6-day span with ovulation inside it', () => {
    // Positions 10–15 with ovulation at 14 — the SAME span `predictCycle`
    // reports, so the calendar and the "what's coming" card cannot disagree.
    expect(cycleDayMark('2026-07-19', ANCHORED, logged)).toBeNull(); // position 9
    expect(cycleDayMark('2026-07-20', ANCHORED, logged)).toBe('fertile'); // 10
    expect(cycleDayMark('2026-07-23', ANCHORED, logged)).toBe('fertile'); // 13
    expect(cycleDayMark('2026-07-24', ANCHORED, logged)).toBe('ovulation'); // 14
    expect(cycleDayMark('2026-07-25', ANCHORED, logged)).toBe('fertile'); // 15
    expect(cycleDayMark('2026-07-26', ANCHORED, logged)).toBeNull(); // 16
  });

  it('HEALTH-CYCLE-151: nothing is predicted BEFORE the anchor, or with no anchor at all', () => {
    // Back-filling "your period was probably here" onto a month the person had
    // not started tracking is inventing history, and it is indistinguishable on
    // the grid from something they logged and lost.
    expect(cycleDayMark('2026-07-09', ANCHORED, new Set())).toBeNull();
    expect(cycleDayMark('2026-01-01', ANCHORED, new Set())).toBeNull();
    expect(cycleDayMark(TODAY, DEFAULT_CYCLE_SETTINGS, new Set())).toBeNull();
  });

  it('HEALTH-CYCLE-152: an implausible stored cycle length is CLAMPED before it paints', () => {
    // A 90-day row would otherwise spread the fertile window across a quarter
    // of the year. The clamp is the same one the predictions use, so the two
    // surfaces agree even on a corrupt row.
    const corrupt: CycleSettings = { ...ANCHORED, cycleLength: 90, periodLength: 40 };

    // Clamped to 45/14: period window is positions 0–13 → 07-10 … 07-23.
    expect(cycleDayMark('2026-07-23', corrupt, new Set())).toBe('predictedPeriod');
    expect(cycleDayMark('2026-07-24', corrupt, new Set())).toBeNull();
    // Ovulation at position 45 − 14 = 31 → 2026-08-10.
    expect(cycleDayMark('2026-08-10', corrupt, new Set())).toBe('ovulation');
  });

  it('HEALTH-CYCLE-153: every mark the classifier can return has a legend label', () => {
    // Colour is never load-bearing on this card — a mark with no label would be
    // a state a colour-blind reader could not name.
    for (const mark of CYCLE_DAY_MARKS) {
      expect(CYCLE_DAY_MARK_LABELS[mark]).toBeTruthy();
    }
    // …and the two estimate labels say they are estimates, in words.
    expect(CYCLE_DAY_MARK_LABELS.ovulation).toMatch(/estimate/i);
    expect(CYCLE_DAY_MARK_LABELS.fertile).toMatch(/estimate/i);
    expect(CYCLE_DAY_MARK_LABELS.period).toMatch(/logged/i);
  });
});

/* ------------------------------------------------------------------ */
/* cycleCalendarDays / countCycleMarks                                 */
/* ------------------------------------------------------------------ */

describe('cycleCalendarDays', () => {
  it('HEALTH-CYCLE-154: each cell carries its mark, its flow and whether a symptom day exists', () => {
    // The flow is what turns "period logged" into "period logged, heavy flow"
    // in the day's accessibility label, and it may only be present on a day
    // that was ACTUALLY logged.
    const grid = cycleCalendarDays(
      [row(['2026-07-10', '2026-07-11', '2026-07-12', '2026-07-24'])],
      ANCHORED,
      [period('2026-07-10', 'heavy'), period('2026-07-11', 'light')],
      [
        symptomEntry({ date: '2026-07-11', symptoms: { cramps: 2 } }),
        // An empty row for 07-12: exists on the wire, but nothing was entered.
        symptomEntry({ date: '2026-07-12' }),
      ]
    );

    expect(grid[0]).toEqual<CycleCalendarDay[]>([
      { date: '2026-07-10', day: 10, inMonth: true, mark: 'period', flow: 'heavy', hasSymptomLog: false },
      { date: '2026-07-11', day: 11, inMonth: true, mark: 'period', flow: 'light', hasSymptomLog: true },
      {
        date: '2026-07-12',
        day: 12,
        inMonth: true,
        mark: 'predictedPeriod',
        flow: null,
        hasSymptomLog: false,
      },
      { date: '2026-07-24', day: 24, inMonth: true, mark: 'ovulation', flow: null, hasSymptomLog: false },
    ]);
  });

  it('HEALTH-CYCLE-155: padding days keep their marks but are excluded from the count', () => {
    // The grid borrows days from the neighbouring months so a week reads as a
    // week. Counting them would report a month as busier than it was, and the
    // summary sentence under the grid is built from that count.
    const grid = cycleCalendarDays(
      [
        [...row(['2026-06-29', '2026-06-30'], false), ...row(['2026-07-01', '2026-07-10'])],
        row(['2026-07-11', '2026-07-24', '2026-07-25']),
      ],
      ANCHORED,
      [period('2026-07-10'), period('2026-06-30')],
      []
    );

    // The out-of-month logged day still resolves a mark — the classifier does
    // not know about months — but it is `inMonth: false`…
    expect(grid[0][1]).toMatchObject({ date: '2026-06-30', inMonth: false, mark: 'period' });
    // …so it does not reach the tally.
    // In-month tally: 07-10 logged, 07-11 expected, 07-24 ovulation, 07-25
    // fertile. 07-01 is before the anchor, so it carries nothing.
    expect(countCycleMarks(grid)).toEqual({
      period: 1,
      predictedPeriod: 1,
      ovulation: 1,
      fertile: 1,
    });
  });

  it('HEALTH-CYCLE-156: an empty month counts zero of everything rather than throwing', () => {
    expect(countCycleMarks([])).toEqual({
      period: 0,
      predictedPeriod: 0,
      ovulation: 0,
      fertile: 0,
    });
    expect(
      countCycleMarks(cycleCalendarDays([row(['2026-01-05'])], DEFAULT_CYCLE_SETTINGS, [], []))
    ).toEqual({ period: 0, predictedPeriod: 0, ovulation: 0, fertile: 0 });
  });
});

/* ------------------------------------------------------------------ */
/* upcomingCycleEvents / relativeDayLabel                              */
/* ------------------------------------------------------------------ */

describe('upcomingCycleEvents', () => {
  it('HEALTH-CYCLE-157: with no anchor there is nothing to forecast', () => {
    // The screen renders a sentence in this case rather than three em-dashes,
    // so an empty array is the contract — not a list of nulls.
    expect(upcomingCycleEvents(DEFAULT_CYCLE_SETTINGS, TODAY)).toEqual([]);
  });

  it('HEALTH-CYCLE-158: the three dates come back in DATE order with their day counts', () => {
    // Ordering by key rather than by date would put "next period" above a
    // fertile window that arrives three weeks earlier.
    expect(upcomingCycleEvents(ANCHORED, TODAY)).toEqual([
      {
        key: 'fertileWindow',
        label: 'Fertile window opens',
        date: '2026-07-20',
        daysAway: 7,
        icon: 'insights',
      },
      {
        key: 'ovulation',
        label: 'Ovulation estimate',
        date: '2026-07-24',
        daysAway: 11,
        icon: 'cycle',
      },
      {
        key: 'nextPeriod',
        label: 'Next period',
        date: '2026-08-07',
        daysAway: 25,
        icon: 'hydration',
      },
    ]);
  });

  it('HEALTH-CYCLE-159: the day counts are relative to the day asked about, and default to today', () => {
    // The screen passes `todayKey`; the default exists for every other caller.
    const fromLater = upcomingCycleEvents(ANCHORED, '2026-07-23');
    expect(fromLater.map((e) => e.daysAway)).toEqual([-3, 1, 15]);
    // A window that has already opened reports a NEGATIVE count rather than
    // disappearing — "it started three days ago" is the useful answer.
    expect(fromLater[0].daysAway).toBeLessThan(0);

    expect(upcomingCycleEvents(ANCHORED)).toEqual(upcomingCycleEvents(ANCHORED, TODAY));
  });

  it('HEALTH-CYCLE-160: relativeDayLabel names the three days either side of today', () => {
    // "in 0 days" and "in -1 days" are the two ways this reads as machine
    // output; both are on the card beside a date the person is planning around.
    expect(relativeDayLabel(0)).toBe('Today');
    expect(relativeDayLabel(1)).toBe('Tomorrow');
    expect(relativeDayLabel(-1)).toBe('Yesterday');
    expect(relativeDayLabel(6)).toBe('in 6 days');
    expect(relativeDayLabel(-5)).toBe('5 days ago');
  });
});

/* ------------------------------------------------------------------ */
/* Per-phase read of the person's own log                              */
/* ------------------------------------------------------------------ */

describe('phaseSymptomCounts / phaseLoggedDays', () => {
  /** 07-11/07-12 are menstrual (days 2/3), 07-20 follicular (11), 07-24 ovulation (15). */
  const log = [
    symptomEntry({ date: '2026-07-11', symptoms: { cramps: 2, bloating: 1 } }),
    symptomEntry({ date: '2026-07-12', symptoms: { cramps: 1 } }),
    symptomEntry({ date: '2026-07-20', symptoms: { acne: 2 } }),
    symptomEntry({ date: '2026-07-24', symptoms: { anxiety: 3 } }),
  ];

  it('HEALTH-CYCLE-161: only the days that fall in the phase are counted', () => {
    // This is the honest replacement for the donor's phase TIP rows: the
    // person's own record read back, per phase. Leaking another phase's days in
    // would turn it into a claim about a phase they were never in.
    expect(phaseSymptomCounts(log, ANCHORED, 'menstrual')).toEqual([
      { symptom: 'cramps', count: 2 },
      { symptom: 'bloating', count: 1 },
    ]);
    expect(phaseSymptomCounts(log, ANCHORED, 'follicular')).toEqual([
      { symptom: 'acne', count: 1 },
    ]);
    expect(phaseSymptomCounts(log, ANCHORED, 'ovulation')).toEqual([
      { symptom: 'anxiety', count: 1 },
    ]);
    // A phase with nothing logged says nothing rather than falling back to the
    // whole log.
    expect(phaseSymptomCounts(log, ANCHORED, 'luteal')).toEqual([]);
    // …and with no anchor, no day belongs to any phase at all.
    expect(phaseSymptomCounts(log, DEFAULT_CYCLE_SETTINGS, 'menstrual')).toEqual([]);
  });

  it('HEALTH-CYCLE-162: days from EARLIER cycles land in the phase they actually happened in', () => {
    // The phase of a past day is the same wrapping arithmetic, so a symptom
    // logged two cycles ago still counts — otherwise the card would only ever
    // describe the current cycle and would read as empty for most of the month.
    const twoCyclesBack = [
      symptomEntry({ date: '2026-05-16', symptoms: { cramps: 1 } }), // 55 days back → day 2
      symptomEntry({ date: '2026-07-11', symptoms: { cramps: 2 } }), // day 2
    ];

    expect(phaseSymptomCounts(twoCyclesBack, ANCHORED, 'menstrual')).toEqual([
      { symptom: 'cramps', count: 2 },
    ]);
  });

  it('HEALTH-CYCLE-163: the denominator counts logged DAYS, not symptom ticks', () => {
    // The sentence reads "…across N logged days". Counting ticks would report
    // more days than exist, and an EMPTY row must not inflate it at all.
    const withEmptyRow = [
      ...log,
      symptomEntry({ date: '2026-07-13' }), // day 4, menstrual, but nothing entered
      symptomEntry({ date: '2026-07-14', mood: 4 }), // day 5, menstrual, mood only
    ];

    expect(phaseLoggedDays(withEmptyRow, ANCHORED, 'menstrual')).toBe(3);
    expect(phaseLoggedDays(withEmptyRow, ANCHORED, 'luteal')).toBe(0);
    expect(phaseLoggedDays(withEmptyRow, DEFAULT_CYCLE_SETTINGS, 'menstrual')).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Sleep quality — the first client of a column shipped in P1          */
/* ------------------------------------------------------------------ */

describe('sleep quality', () => {
  it('HEALTH-CYCLE-164: the 1–5 band carries a descriptive word for every level', () => {
    // Descriptive, not graded: this records how the night FELT. Index 0 is the
    // unused slot that makes the level its own index (same shape as MOOD_LABELS).
    expect(SLEEP_QUALITY_LABELS).toHaveLength(6);
    expect(SLEEP_QUALITY_LABELS[0]).toBe('');
    for (let level = 1; level <= 5; level += 1) {
      expect(SLEEP_QUALITY_LABELS[level]).toBeTruthy();
    }
    expect(new Set(SLEEP_QUALITY_LABELS.slice(1)).size).toBe(5); // no repeats
  });

  it('HEALTH-CYCLE-165: `sleep_quality` is read back off the wire, not dropped', () => {
    // The column has existed since parity P1 with nothing writing it. The
    // reader is what makes a rating survive a reinstall — without it the scale
    // would reset to "—" on every launch while the server held the value.
    api.listCycleSymptoms.mockResolvedValue(
      ok({ symptoms: [cycleSymptomRow({ date: TODAY, sleep_quality: 4 })] })
    );

    return loadCycleSymptoms().then((entries) => {
      expect(entries[0].sleepQuality).toBe(4);
      expect(hasSymptomContent(entries[0])).toBe(true);
    });
  });
});
