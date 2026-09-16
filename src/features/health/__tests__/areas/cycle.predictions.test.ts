/**
 * Symply Health — Women's Health (Cycle): the PREDICTION ARITHMETIC, in depth.
 *
 * `healthCycleStorage.test.ts` pins the happy shape of each pure helper — one
 * anchor, one 28-day cycle, one stale-anchor roll-forward. That is the size at
 * which every calendar bug still looks correct. This file drives the same
 * helpers through the states a real log actually reaches:
 *
 *   * no history at all, and exactly one logged period;
 *   * a period still IN PROGRESS versus one that finished a fortnight ago;
 *   * the exact boundary where a cycle is considered complete and the anchor
 *     rolls (elapsed === cycleLength) versus the day before it;
 *   * month, year and short-month boundaries, where naive day arithmetic
 *     silently lands on the wrong date;
 *   * a cycle length far outside the 28-day default — including a stored value
 *     the clamp has to catch before it pushes "next period" three months out;
 *   * irregular gaps, where the average has to drop the stopped-logging
 *     artefacts and keep the rest.
 *
 * Everything here is a PURE function of its arguments, so there is no API mock
 * and no cache: a failure is an arithmetic failure, not a plumbing one. The
 * expectations are hand-computed calendar dates, never re-derived from the
 * implementation — a test that computes the answer the same way the code does
 * cannot fail when the code is wrong.
 *
 * These figures are wellness estimates from the person's own logged dates, not
 * contraception (BRD: no clinical claims) — but an off-by-one still shows a
 * date the person plans around, which is why the boundaries are pinned to the
 * day.
 */

import {
  averageCycleLength,
  averagePeriodLength,
  commonSymptoms,
  createEmptySymptomEntry,
  cycleDayLabel,
  cycleDayOn,
  daysBetween,
  DEFAULT_CYCLE_SETTINGS,
  periodStarts,
  phaseForCycleDay,
  phaseOn,
  predictCycle,
  type CyclePhase,
  type CycleSettings,
  type CycleSymptomEntry,
  type PeriodEntry,
} from '../../healthCycleStorage';

const TODAY = '2026-07-13';
/** Local noon so `todayDateKey()` is 2026-07-13 in every timezone. */
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);

function settings(over: Partial<CycleSettings> = {}): CycleSettings {
  return { ...DEFAULT_CYCLE_SETTINGS, ...over };
}

function days(dates: string[]): PeriodEntry[] {
  return dates.map((date) => ({
    id: `period-${date}`,
    date,
    flow: 'medium' as const,
    notes: '',
    loggedAt: `${date}T08:00:00.000Z`,
  }));
}

function symptomDay(date: string, symptoms: CycleSymptomEntry['symptoms']): CycleSymptomEntry {
  return { ...createEmptySymptomEntry(date), symptoms };
}

/* ------------------------------------------------------------------ */
/* predictCycle — the states a real log reaches                        */
/* ------------------------------------------------------------------ */

describe('predictCycle — history states', () => {
  it('HEALTH-CYCLE-067: with NO history every field is null, whatever the lengths say', () => {
    // A configured cycle length is not a log. Predicting from a default the
    // person never entered would put a date on the card that came from nowhere,
    // and the screen would have no way to tell the user that is what happened.
    for (const cycleLength of [20, 28, 45]) {
      expect(predictCycle(settings({ cycleLength, lastPeriodStart: null }), TODAY)).toEqual({
        nextPeriodStart: null,
        ovulationDate: null,
        fertileWindowStart: null,
        fertileWindowEnd: null,
        daysUntilNextPeriod: null,
      });
    }
  });

  it('HEALTH-CYCLE-068: ONE period logged today is enough to project the whole cycle', () => {
    // The first flow tap must light the card up — this is the moment the tab
    // goes from "log a period day" to a working forecast.
    expect(predictCycle(settings({ lastPeriodStart: TODAY }), TODAY)).toEqual({
      nextPeriodStart: '2026-08-10', // today + 28
      ovulationDate: '2026-07-27', // today + (28 − 14)
      fertileWindowStart: '2026-07-23', // ovulation − 4
      fertileWindowEnd: '2026-07-28', // ovulation + 1
      daysUntilNextPeriod: 28,
    });
  });

  it('HEALTH-CYCLE-069: a period still IN PROGRESS predicts forward, not backward', () => {
    // Anchored two days ago, still bleeding. The naive "the cycle restarts when
    // the period ends" reading would put the next period 5 days early.
    const inProgress = settings({ lastPeriodStart: '2026-07-11' });
    const prediction = predictCycle(inProgress, TODAY);

    expect(prediction.nextPeriodStart).toBe('2026-08-08');
    expect(prediction.daysUntilNextPeriod).toBe(26);
    // …and the phase for today is still the period itself (cycle day 3 of 5).
    expect(cycleDayOn(TODAY, inProgress)).toBe(3);
    expect(phaseOn(TODAY, inProgress)).toBe<CyclePhase>('menstrual');
  });

  it('HEALTH-CYCLE-070: the roll-forward boundary is elapsed === cycleLength, exactly', () => {
    // Off by one here and the card either shows a date in the past on the day a
    // period is due, or skips a whole cycle the day before it.
    //
    // 27 days elapsed → the current cycle is still running, so the prediction is
    // the one the original anchor produced.
    expect(predictCycle(settings({ lastPeriodStart: '2026-06-16' }), TODAY)).toMatchObject({
      nextPeriodStart: '2026-07-14',
      daysUntilNextPeriod: 1,
    });

    // 28 days elapsed → that cycle is complete, so the anchor rolls once and the
    // next period is a full cycle out rather than "today".
    expect(predictCycle(settings({ lastPeriodStart: '2026-06-15' }), TODAY)).toMatchObject({
      nextPeriodStart: '2026-08-10',
      daysUntilNextPeriod: 28,
    });
  });

  it('HEALTH-CYCLE-071: a cycle spanning a MONTH boundary lands on real calendar dates', () => {
    // 31 January + 28 days is 28 February, not "32 January" and not 1 March.
    // Adding to a day-of-month rather than to a Date is the classic way to get
    // this wrong, and February is where it shows.
    expect(predictCycle(settings({ lastPeriodStart: '2026-01-31' }), '2026-02-01')).toMatchObject({
      nextPeriodStart: '2026-02-28',
      ovulationDate: '2026-02-14',
    });
  });

  it('HEALTH-CYCLE-072: a cycle spanning a YEAR boundary rolls the year, not just the month', () => {
    const december = settings({ lastPeriodStart: '2026-12-20' });

    expect(predictCycle(december, '2026-12-25')).toEqual({
      nextPeriodStart: '2027-01-17',
      ovulationDate: '2027-01-03',
      fertileWindowStart: '2026-12-30', // the window OPENS in the old year
      fertileWindowEnd: '2027-01-04',
      daysUntilNextPeriod: 23,
    });
    // …and the day count crosses the boundary in both directions.
    expect(daysBetween('2026-12-25', '2027-01-17')).toBe(23);
    expect(daysBetween('2027-01-17', '2026-12-25')).toBe(-23);
  });

  it('HEALTH-CYCLE-073: a cycle length far from 28 predicts from the CLAMPED value', () => {
    // A 45-day cycle is a real body. A 90-day one is a corrupt row or a donor
    // schema drift, and predicting from it would say "next period in three
    // months" — which reads as a medical event, not as a bad number.
    expect(predictCycle(settings({ cycleLength: 45, lastPeriodStart: TODAY }), TODAY)).toEqual({
      nextPeriodStart: '2026-08-27',
      ovulationDate: '2026-08-13', // + (45 − 14)
      fertileWindowStart: '2026-08-09',
      fertileWindowEnd: '2026-08-14',
      daysUntilNextPeriod: 45,
    });
    // 90 clamps to 45 — the SAME answer, which is the point of the clamp.
    expect(predictCycle(settings({ cycleLength: 90, lastPeriodStart: TODAY }), TODAY)).toMatchObject(
      { nextPeriodStart: '2026-08-27', daysUntilNextPeriod: 45 }
    );

    // …and the bottom of the range behaves the same way: 5 clamps to 20.
    expect(predictCycle(settings({ cycleLength: 20, lastPeriodStart: TODAY }), TODAY)).toEqual({
      nextPeriodStart: '2026-08-02',
      ovulationDate: '2026-07-19', // + (20 − 14)
      fertileWindowStart: '2026-07-15',
      fertileWindowEnd: '2026-07-20',
      daysUntilNextPeriod: 20,
    });
    expect(predictCycle(settings({ cycleLength: 5, lastPeriodStart: TODAY }), TODAY)).toMatchObject({
      nextPeriodStart: '2026-08-02',
      daysUntilNextPeriod: 20,
    });
  });

  it('HEALTH-CYCLE-074: the roll-forward loop TERMINATES on an absurdly stale anchor', () => {
    // `predictCycle` walks the anchor forward one cycle at a time, so a date far
    // enough in the past is an unbounded loop unless the guard holds. The guard
    // is 200 iterations, which at the shortest permitted cycle is ~11 years —
    // beyond any plausible gap between two launches of the app.
    const ancient = predictCycle(settings({ cycleLength: 20, lastPeriodStart: '1900-01-01' }), TODAY);

    // 200 shifts of 20 days lands on 1910-12-15; the projection is one more.
    expect(ancient.nextPeriodStart).toBe('1911-01-04');
    // KNOWN CONSEQUENCE, pinned deliberately: once the guard trips the figure is
    // in the past, so `daysUntilNextPeriod` goes negative and the tile would
    // read "in -42194d". It is unreachable from any real account (the anchor is
    // written by the server on every logged day), and the alternative — an
    // unbounded loop on the render path — is worse. If the guard ever changes,
    // this is the test that says what it used to cost.
    expect(ancient.daysUntilNextPeriod).toBe(-42194);
  });

  it('HEALTH-CYCLE-075: predictCycle with no `today` uses the real clock', () => {
    // The screen calls `predictCycle(settings)` with one argument, so the
    // defaulted form is the one that ships.
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
    try {
      expect(predictCycle(settings({ lastPeriodStart: TODAY }))).toMatchObject({
        nextPeriodStart: '2026-08-10',
        daysUntilNextPeriod: 28,
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Cycle day + phase across the permitted range                        */
/* ------------------------------------------------------------------ */

describe('cycle day and phase — the whole permitted range', () => {
  it('HEALTH-CYCLE-076: cycleDayOn wraps many cycles in BOTH directions', () => {
    const anchored = settings({ lastPeriodStart: '2026-07-10' });

    // Three full cycles on, and three back: the modulo has to normalise a
    // negative remainder or a date before the anchor reads as day −55.
    expect(cycleDayOn('2026-09-04', anchored)).toBe(1); // +56 = 2 cycles
    expect(cycleDayOn('2026-05-15', anchored)).toBe(1); // −56 = 2 cycles back
    expect(cycleDayOn('2026-05-14', anchored)).toBe(28);
    expect(cycleDayOn('2026-09-05', anchored)).toBe(2);
  });

  it('HEALTH-CYCLE-077: a 45-day cycle with a 14-day period fills all four phases', () => {
    const long = settings({ cycleLength: 45, periodLength: 14 });
    const phaseOfDay = (day: number) => phaseForCycleDay(day, long);

    expect(phaseOfDay(14)).toBe<CyclePhase>('menstrual'); // inclusive top
    expect(phaseOfDay(15)).toBe<CyclePhase>('follicular');
    expect(phaseOfDay(29)).toBe<CyclePhase>('follicular');
    // Ovulation is a 3-day window centred on cycleLength − 14 = 31.
    expect(phaseOfDay(30)).toBe<CyclePhase>('ovulation');
    expect(phaseOfDay(31)).toBe<CyclePhase>('ovulation');
    expect(phaseOfDay(32)).toBe<CyclePhase>('ovulation');
    expect(phaseOfDay(33)).toBe<CyclePhase>('luteal');
    expect(phaseOfDay(45)).toBe<CyclePhase>('luteal');
  });

  it('HEALTH-CYCLE-078: on a SHORT cycle the follicular phase is squeezed out entirely', () => {
    // 20-day cycle, 5-day period → ovulation is centred on day 6, so the window
    // opens on day 5 — which the period rule already owns. There is no day left
    // that is follicular, and the phase card must simply never show it rather
    // than render an empty band or fall through to a default.
    const short = settings({ cycleLength: 20, periodLength: 5 });
    const walk = Array.from({ length: 20 }, (_, i) => phaseForCycleDay(i + 1, short));

    expect(walk).toEqual([
      ...Array(5).fill('menstrual'),
      'ovulation',
      'ovulation',
      ...Array(13).fill('luteal'),
    ]);
    expect(walk).not.toContain('follicular');
  });

  it('HEALTH-CYCLE-079: every cycle day in the permitted grid resolves to a known phase', () => {
    // The phase function has no explicit "unknown" arm — it falls through to
    // luteal — so the guard that matters is that no length/period pair produces
    // a value outside the four the labels, icons and descriptions cover.
    const known = new Set<string>(['menstrual', 'follicular', 'ovulation', 'luteal']);
    const unknown: string[] = [];
    for (let length = 20; length <= 45; length += 1) {
      for (let period = 1; period <= 14; period += 1) {
        const s = settings({ cycleLength: length, periodLength: period });
        for (let day = 1; day <= length; day += 1) {
          const phase = phaseForCycleDay(day, s);
          if (!known.has(phase)) unknown.push(`${length}/${period}/${day} -> ${phase}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it('HEALTH-CYCLE-080: cycleDayLabel reads the LOCAL day of an ISO timestamp', () => {
    // History rows carry `loggedAt` (an ISO instant), not a day key. A UTC read
    // would move an evening entry to the next day for anyone east of Greenwich
    // and back a day for anyone west, which shifts the cycle-day caption.
    const anchored = settings({ lastPeriodStart: '2026-07-10' });
    const localNoon = new Date(2026, 6, 13, 12, 0, 0).toISOString();

    expect(cycleDayLabel(localNoon, anchored)).toBe('Day 4');
    expect(cycleDayLabel(localNoon, settings({ lastPeriodStart: null }))).toBe('—');
  });
});

/* ------------------------------------------------------------------ */
/* Observed averages over an irregular log                             */
/* ------------------------------------------------------------------ */

describe('observed averages — irregular logs', () => {
  it('HEALTH-CYCLE-081: the plausible-gap window is INCLUSIVE at both ends', () => {
    // 20 and 45 are the same bounds `clampCycleLength` uses. Excluding them
    // would silently throw away the shortest and longest real cycles — the two
    // the person is most likely to be watching.
    expect(averageCycleLength(days(['2026-01-01', '2026-01-21']))).toBe(20);
    expect(averageCycleLength(days(['2026-01-01', '2026-02-15']))).toBe(45);
    expect(averageCycleLength(days(['2026-01-01', '2026-01-20']))).toBeNull(); // 19
    expect(averageCycleLength(days(['2026-01-01', '2026-02-16']))).toBeNull(); // 46
  });

  it('HEALTH-CYCLE-082: three irregular gaps average and round to a whole day', () => {
    // Gaps of 27, 28 and 30 days → 28.33, which the card shows as "28d". A
    // fractional day on a calendar figure would be nonsense.
    expect(
      averageCycleLength(days(['2026-01-01', '2026-01-28', '2026-02-25', '2026-03-27']))
    ).toBe(28);
  });

  it('HEALTH-CYCLE-083: a stopped-logging gap is DROPPED, the rest still average', () => {
    // Someone logs Jan, stops until June, then logs again. The 123-day hole is
    // an absence, not a cycle — averaging it in would push the next period more
    // than a month out. Earlier coverage only proved the all-implausible case
    // returns null; this proves the SURVIVORS are still used.
    const irregular = days([
      '2026-01-01',
      '2026-01-29', // gap 28 — usable
      '2026-06-01', // gap 123 — dropped
      '2026-06-30', // gap 29 — usable
    ]);

    expect(averageCycleLength(irregular)).toBe(29); // (28 + 29) / 2 = 28.5 → 29
  });

  it('HEALTH-CYCLE-084: period runs are counted per run and rounded, month boundary included', () => {
    // A run that crosses the end of a month is ONE period. Splitting it would
    // both halve the reported period length and invent an extra cycle start.
    expect(periodStarts(days(['2026-06-29', '2026-06-30', '2026-07-01']))).toEqual(['2026-06-29']);
    expect(averagePeriodLength(days(['2026-06-29', '2026-06-30', '2026-07-01']))).toBe(3);

    // Runs of 3 and 4 → 3.5, rounded to 4.
    expect(
      averagePeriodLength(
        days([
          '2026-01-01',
          '2026-01-02',
          '2026-01-03',
          '2026-02-01',
          '2026-02-02',
          '2026-02-03',
          '2026-02-04',
        ])
      )
    ).toBe(4);
  });

  it('HEALTH-CYCLE-085: unsorted and duplicated logged days do not invent extra runs', () => {
    // Entries arrive newest-first from the store and the optimistic path can
    // repeat a date mid-write. Both would read as extra run starts — and every
    // extra start is an extra "cycle" in the average.
    const messy = days([
      '2026-07-11',
      '2026-07-10',
      '2026-07-11', // duplicate
      '2026-06-12',
      '2026-06-13',
    ]);

    expect(periodStarts(messy)).toEqual(['2026-06-12', '2026-07-10']);
    expect(averageCycleLength(messy)).toBe(28);
    expect(averagePeriodLength(messy)).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* commonSymptoms — the PATTERNS aggregation                           */
/* ------------------------------------------------------------------ */

describe('commonSymptoms — patterns aggregation', () => {
  it('HEALTH-CYCLE-086: the default limit is three, and a bigger log is cut to it', () => {
    // The PATTERNS card renders whatever comes back, so the cut is the store's
    // job. Five symptoms would push the card past the fold on a small phone.
    const entries = [
      symptomDay('2026-07-13', { cramps: 3, headache: 2, bloating: 1, acne: 2, nausea: 1 }),
      symptomDay('2026-07-12', { cramps: 3, headache: 2, bloating: 1, acne: 2 }),
      symptomDay('2026-07-11', { cramps: 3, headache: 2, bloating: 1 }),
    ];

    // All three top symptoms tie on 3, so the alphabetical tie-break decides
    // the order — bloating, cramps, headache — and acne (2) / nausea (1) fall
    // off the bottom.
    expect(commonSymptoms(entries)).toEqual([
      { symptom: 'bloating', count: 3 },
      { symptom: 'cramps', count: 3 },
      { symptom: 'headache', count: 3 },
    ]);
    expect(commonSymptoms(entries, 5)).toHaveLength(5);
    expect(commonSymptoms(entries, 0)).toEqual([]);
  });

  it('HEALTH-CYCLE-087: an ALL-tied log is ordered alphabetically, top to bottom', () => {
    // Every symptom on one day: the counts carry no information at all, so the
    // ONLY thing deciding what the card shows is the tie-break. Map insertion
    // order would show whichever three the enum happens to list first.
    const oneOfEach = [
      symptomDay('2026-07-13', {
        sadness: 1,
        cramps: 1,
        bloating: 1,
        acne: 1,
        nausea: 1,
        anxiety: 1,
      }),
    ];

    expect(commonSymptoms(oneOfEach, 6).map((s) => s.symptom)).toEqual([
      'acne',
      'anxiety',
      'bloating',
      'cramps',
      'nausea',
      'sadness',
    ]);
  });

  it('HEALTH-CYCLE-088: a cleared or unknown symptom key never reaches the card', () => {
    // `0` is what the wire sends for "not present" and `undefined` is what a
    // deleted key leaves behind; an unknown key is what a donor schema drift
    // would add. All three must be skipped rather than counted or crashed on.
    const noisy = [
      symptomDay('2026-07-13', {
        cramps: 2,
        headache: 0 as never,
        bloating: undefined,
      }),
      { ...symptomDay('2026-07-12', { cramps: 1 }), symptoms: { cramps: 1, hiccups: 3 } as never },
    ];

    expect(commonSymptoms(noisy)).toEqual([{ symptom: 'cramps', count: 2 }]);
  });
});
