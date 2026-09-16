/**
 * Symply Health — Men's Health (Vitality): the LAST 7 DAYS card's maths.
 *
 * `summarizeVitality(entries, dayKeys)` drives three tiles at the bottom of the
 * tab (Days logged, Avg score, Kegel sets) plus the `issueDays` figure. It is
 * the only place on the tab where several days are combined, and the rule it
 * implements is easy to get wrong in a way nobody notices: it averages over the
 * days that were LOGGED, not over the length of the window.
 *
 * Averaging over the window instead would divide by 7 no matter what, so a user
 * who logged two excellent days would be shown a mediocre average and told, in
 * effect, that the days they did not log counted against them. `healthVitality
 * Storage.test.ts` proves the rule once on a two-day window; this file walks the
 * window itself — under-filled, exactly full, and with a HOLE in the middle,
 * which is the shape a real week almost always has.
 *
 * It also pins the window's own boundary. The screen builds its keys with
 * `recentDayKeys(7)`, which is inclusive of today and reaches back six days, so
 * an entry exactly seven days old is OUTSIDE and an entry six days old is IN.
 * That off-by-one is invisible on any window that happens to be full.
 */

import { recentDayKeys } from '../../healthActivityStorage';
import {
  createEmptyVitalityEntry,
  summarizeVitality,
  vitalityScore,
  type VitalityEntry,
} from '../../healthVitalityStorage';

const TREND_DAYS = 7; // must match HealthVitalityScreen's TREND_DAYS
/** Fixed local noon so `todayDateKey()` is '2026-07-13' in every timezone. */
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

function entry(over: Partial<VitalityEntry> & { date: string }): VitalityEntry {
  return { ...createEmptyVitalityEntry(over.date), ...over };
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* The window itself                                                   */
/* ------------------------------------------------------------------ */

describe('vitality trend window — which days are in it', () => {
  it('HEALTH-VITALITY-220: the screen window is today plus the six days before it', () => {
    // Pinned literally rather than derived, because every other spec in this
    // file is stated against these dates.
    expect(recentDayKeys(TREND_DAYS)).toEqual([
      '2026-07-07',
      '2026-07-08',
      '2026-07-09',
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
      TODAY,
    ]);
  });

  it('HEALTH-VITALITY-221: six days back is IN, seven days back is OUT', () => {
    // The inclusive/exclusive edge. A window built as "today − 7" would quietly
    // count eight days, and the tile would read `8/7`.
    const window = recentDayKeys(TREND_DAYS);

    expect(
      summarizeVitality([entry({ date: '2026-07-07', kegelSets: 4 })], window)
    ).toMatchObject({ daysLogged: 1, kegelSets: 4 });

    expect(
      summarizeVitality([entry({ date: '2026-07-06', kegelSets: 4 })], window)
    ).toMatchObject({ daysLogged: 0, kegelSets: 0 });
  });

  it('HEALTH-VITALITY-222: a FUTURE-dated row is outside the window too', () => {
    // The store keeps entries sorted by date descending and slices the newest
    // 400, so a row stamped ahead of the device clock (a timezone slip, or a
    // device whose date was wrong when the day was logged) sorts to the FRONT of
    // the list. It must still not be counted into this week.
    expect(
      summarizeVitality([entry({ date: '2026-07-14', kegelSets: 9 })], recentDayKeys(TREND_DAYS))
    ).toEqual({ daysLogged: 0, averageScore: 0, averageEnergy: 0, kegelSets: 0, issueDays: 0 });
  });
});

/* ------------------------------------------------------------------ */
/* Fewer than 7 / exactly 7 / a gap in the middle                      */
/* ------------------------------------------------------------------ */

describe('vitality trend window — how full it is', () => {
  it('HEALTH-VITALITY-223: an under-filled week divides by the LOGGED days, not by 7', () => {
    // Two strong days out of seven. Dividing by the window would report an
    // average of 24 for a user whose every logged day scored 84 — the single
    // most misleading thing this card could do.
    const window = recentDayKeys(TREND_DAYS);
    const days = [
      entry({ date: TODAY, energyLevel: 8, kegelSets: 3 }),
      entry({ date: '2026-07-11', energyLevel: 8, kegelSets: 1 }),
    ];
    const perDay = vitalityScore(days[0]);

    expect(summarizeVitality(days, window)).toEqual({
      daysLogged: 2,
      averageScore: perDay,
      averageEnergy: 8,
      kegelSets: 4,
      issueDays: 0,
    });
    // Same figure, stated the way the bug would have: 2 × perDay / 7.
    expect(Math.round((perDay * 2) / TREND_DAYS)).not.toBe(perDay);
  });

  it('HEALTH-VITALITY-224: a completely full week counts all seven', () => {
    const window = recentDayKeys(TREND_DAYS);
    const days = window.map((date, i) =>
      entry({ date, energyLevel: i + 1, kegelSets: 1, hadLowDesire: i === 0 })
    );

    const summary = summarizeVitality(days, window);
    expect(summary.daysLogged).toBe(TREND_DAYS);
    expect(summary.kegelSets).toBe(7);
    expect(summary.issueDays).toBe(1);
    // Energy 1…7 → mean 4 exactly.
    expect(summary.averageEnergy).toBe(4);
    expect(summary.averageScore).toBe(
      Math.round(days.reduce((s, e) => s + vitalityScore(e), 0) / TREND_DAYS)
    );
  });

  it('HEALTH-VITALITY-225: a GAP in the middle is skipped, not treated as a zero day', () => {
    // The realistic shape: logged Mon–Tue, missed Wed–Thu, logged Fri–Sun. A
    // missing day is "not asked", not "scored nothing" — counting the hole as a
    // zero would drag the average toward a number the user never reported. This
    // is the same reason an unlogged day shows the neutral 50 on the ring rather
    // than a 0.
    const window = recentDayKeys(TREND_DAYS);
    const logged = ['2026-07-07', '2026-07-08', '2026-07-11', '2026-07-12', TODAY];
    const days = logged.map((date) => entry({ date, energyLevel: 6, kegelSets: 2 }));

    const summary = summarizeVitality(days, window);
    expect(summary.daysLogged).toBe(5); // 5/7, with 07-09 and 07-10 missing
    expect(summary.averageEnergy).toBe(6); // NOT 30/7 = 4.3
    expect(summary.kegelSets).toBe(10);
    expect(summary.averageScore).toBe(vitalityScore(days[0]));
  });

  it('HEALTH-VITALITY-226: an empty window reports zeroes, never the neutral 50', () => {
    // 50 is a per-DAY placeholder for "you have not logged today". As a WEEK
    // average it would be a claim about data that does not exist, and the screen
    // renders `—` for the score tile precisely because this returns 0.
    expect(summarizeVitality([], recentDayKeys(TREND_DAYS))).toEqual({
      daysLogged: 0,
      averageScore: 0,
      averageEnergy: 0,
      kegelSets: 0,
      issueDays: 0,
    });
    // …and a window with no days at all (a defensive call, not a screen path).
    expect(summarizeVitality([entry({ date: TODAY })], [])).toMatchObject({ daysLogged: 0 });
  });
});

/* ------------------------------------------------------------------ */
/* Rounding                                                            */
/* ------------------------------------------------------------------ */

describe('vitality trend window — rounding', () => {
  it('HEALTH-VITALITY-227: average energy keeps ONE decimal place', () => {
    // The tile is narrow; `4.333333333333333` would overflow it. The rounding is
    // ×10 → round → ÷10, so the recurring case has to be checked as an exact
    // number and not with a tolerance.
    const window = recentDayKeys(TREND_DAYS);
    const energies = (levels: number[]) =>
      summarizeVitality(
        levels.map((energyLevel, i) => entry({ date: window[i], energyLevel })),
        window
      ).averageEnergy;

    expect(energies([1, 2, 2])).toBe(1.7); // 5/3 = 1.666… → 1.7
    expect(energies([1, 2])).toBe(1.5); // exact halves survive
    expect(energies([1, 1, 2])).toBe(1.3); // 4/3 = 1.333… → 1.3
    expect(energies([7])).toBe(7); // a whole number stays whole, not 7.0
  });

  it('HEALTH-VITALITY-228: average score is a whole number, rounded half UP', () => {
    // Unlike the headline ring — which FLOORS — the week average rounds. The two
    // rules live three cards apart on the same screen, so they are pinned
    // against each other here.
    const window = recentDayKeys(TREND_DAYS);
    // energy 5 → score 50; energy 6 → floor((50+50+60+50)/4) = 52. Mean 51.
    const days = [
      entry({ date: TODAY, energyLevel: 6 }),
      entry({ date: '2026-07-12', energyLevel: 5 }),
    ];
    expect(vitalityScore(days[0])).toBe(52);
    expect(vitalityScore(days[1])).toBe(50);
    expect(summarizeVitality(days, window).averageScore).toBe(51);

    // The .5 case: scores 50 and 51 → 50.5 → 51, not 50.
    const half = [
      entry({ date: TODAY, mentalClarity: 6, mood: 5, stressLevel: 5 }), // mental 55 → 51
      entry({ date: '2026-07-12' }), // 50
    ];
    expect([vitalityScore(half[0]), vitalityScore(half[1])]).toEqual([51, 50]);
    expect(summarizeVitality(half, window).averageScore).toBe(51);
  });
});

/* ------------------------------------------------------------------ */
/* issueDays and kegel totals                                          */
/* ------------------------------------------------------------------ */

describe('vitality trend window — counters', () => {
  it('HEALTH-VITALITY-229: issueDays counts DAYS, not issues', () => {
    // A day with five things wrong is still one bad day. Summing the flags
    // instead would let `issueDays` exceed `daysLogged`, which reads as nonsense
    // wherever it is shown.
    const window = recentDayKeys(TREND_DAYS);
    const days = [
      entry({
        date: TODAY,
        hadErectionDifficulty: true,
        hadMaintenanceDifficulty: true,
        hadPrematureEjaculation: true,
        hadPerformanceAnxiety: true,
        hadLowDesire: true,
      }),
      entry({ date: '2026-07-12', hadPainOrDiscomfort: true }),
      entry({ date: '2026-07-11' }), // clean day
    ];

    const summary = summarizeVitality(days, window);
    expect(summary.issueDays).toBe(2);
    expect(summary.issueDays).toBeLessThanOrEqual(summary.daysLogged);
  });

  it('HEALTH-VITALITY-230: kegel sets are SUMMED across the week, not averaged', () => {
    // "Kegel sets" is a weekly total — the one figure on this card that grows
    // with effort rather than describing a typical day.
    const window = recentDayKeys(TREND_DAYS);
    const days = window.map((date) => entry({ date, kegelSets: 5 }));

    expect(summarizeVitality(days, window).kegelSets).toBe(35);
    // A week where only one day had sets still shows the total, not 5/7.
    expect(
      summarizeVitality([entry({ date: TODAY, kegelSets: 5 })], window).kegelSets
    ).toBe(5);
  });

  it('HEALTH-VITALITY-231: rows arrive newest-first and the summary is order-independent', () => {
    // `loadVitalityEntries` sorts descending by date, so this is the order the
    // screen actually passes in. The summary must not depend on it.
    const window = recentDayKeys(TREND_DAYS);
    const days = [
      entry({ date: TODAY, energyLevel: 9, kegelSets: 1 }),
      entry({ date: '2026-07-09', energyLevel: 3, kegelSets: 2 }),
      entry({ date: '2026-07-07', energyLevel: 6, kegelSets: 3 }),
    ];

    expect(summarizeVitality(days, window)).toEqual(
      summarizeVitality([...days].reverse(), window)
    );
    expect(summarizeVitality(days, window).averageEnergy).toBe(6); // (9+3+6)/3
  });
});
