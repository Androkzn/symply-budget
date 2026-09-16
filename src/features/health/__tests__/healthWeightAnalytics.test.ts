/**
 * Symply Health — the WEIGHT tab's derivation maths.
 *
 * Weight is the app's headline feature, and every figure the tab shows is
 * arithmetic done here rather than in a component: the goal ring, the streak,
 * the projection, the BMI/BMR block, the month-over-month table, the
 * calorie↔weight coefficient and the past-window navigator. Pinning them here
 * means a screen test never has to assert a number, and a wrong number cannot
 * hide behind a render.
 *
 * The cases that matter most are the REFUSALS: a projection from two readings,
 * a correlation from two weeks, a comparison against an empty previous period,
 * a BMI from a missing height. Each of those has an obvious wrong answer that
 * looks plausible on screen, and each is asserted to return null instead.
 */

import type { DatedValue } from '../healthDashboards';
import type { WeightEntry } from '../healthLocalStorage';
import {
  ACTIVITY_MULTIPLIERS,
  ageFromBirthYear,
  bmiCategory,
  bmiFor,
  bmrFor,
  bodyCompositionFor,
  calorieWeightCorrelation,
  entriesInWindow,
  dominantUnit,
  MIN_CORRELATION_SAMPLES,
  MIN_PROJECTION_SAMPLES,
  monthEndOf,
  monthOverMonth,
  monthStartOf,
  monthlyWeightProgress,
  periodAverage,
  periodComparison,
  tdeeFor,
  weekOverWeek,
  weekStartOf,
  weightAxisFloor,
  weightBarBucketDays,
  weightChangeBars,
  weightGoalProgress,
  weightHasGapThisWeek,
  weightHistoryStats,
  weightLoggingStreak,
  weightPeriodBuckets,
  weightPeriodTitle,
  weightProjection,
  weightWindow,
} from '../healthWeightAnalytics';

const TODAY = '2026-07-13'; // a Monday

function day(date: string, value: number): DatedValue {
  return { date, value };
}

function entry(date: string, value: number, over: Partial<WeightEntry> = {}): WeightEntry {
  return {
    id: `${date}-${value}`,
    value,
    unit: 'kg',
    loggedAt: `${date}T08:00:00.000Z`,
    date,
    note: '',
    source: 'manual',
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

describe('weightWindow — past-window navigation', () => {
  it('HEALTH-WEIGHT-100: the 7-day window is the Monday–Sunday week CONTAINING today', () => {
    // TODAY is itself a Monday, so the current week starts on it.
    const w = weightWindow(TODAY, 7, 0);
    expect(w.start).toBe(TODAY);
    expect(w.end).toBe('2026-07-19');
    expect(w.dayKeys).toHaveLength(7);
    expect(w.isCurrent).toBe(true);
  });

  it('HEALTH-WEIGHT-101: stepping back reaches a window that trailing-only ranges never could', () => {
    // The whole reason this exists: every range picker in the app was
    // trailing-only, so "last March" was unreachable. The 30-day width is a
    // real calendar month, so stepping back 4 months from July lands on
    // the whole of March.
    const back = weightWindow(TODAY, 30, 4);
    expect(back.start).toBe('2026-03-01');
    expect(back.end).toBe('2026-03-31');
    expect(back.isCurrent).toBe(false);
    expect(back.offset).toBe(4);
  });

  it('HEALTH-WEIGHT-102: windows tile — they never overlap and never leave a gap', () => {
    const current = weightWindow(TODAY, 30, 0);
    const previous = weightWindow(TODAY, 30, 1);
    // The previous window ends exactly one day before this one starts.
    expect(previous.end < current.start).toBe(true);
    const gap =
      (Date.parse(`${current.start}T00:00:00Z`) - Date.parse(`${previous.end}T00:00:00Z`)) /
      86_400_000;
    expect(gap).toBe(1);
  });

  it('HEALTH-WEIGHT-103: a negative offset is clamped — the future holds no weigh-ins', () => {
    // The current calendar month (July) is 31 days, not a trailing 30.
    expect(weightWindow(TODAY, 30, -5)).toMatchObject({ offset: 0, start: '2026-07-01', end: '2026-07-31' });
  });

  it('HEALTH-WEIGHT-104: the label is a real date span, never "last 30 days"', () => {
    expect(weightWindow(TODAY, 30, 0).label).toBe('1 Jul – 31 Jul');
  });

  it('HEALTH-WEIGHT-105: the week width is always exactly 7 days; the month width follows the real calendar month', () => {
    expect(weightWindow(TODAY, 7, 0).dayKeys).toHaveLength(7);
    // July has 31 days, so the calendar-month window carries 31, not a fixed 30.
    expect(weightWindow(TODAY, 30, 0).dayKeys).toHaveLength(31);
    // 90 and 365 stay trailing windows, so they are exactly that many days.
    expect(weightWindow(TODAY, 90, 0).dayKeys).toHaveLength(90);
    expect(weightWindow(TODAY, 365, 0).dayKeys).toHaveLength(365);
  });

  it('HEALTH-WEIGHT-106: asking for no offset defaults to offset 0', () => {
    // The screen opens on the current window and only passes an offset once the
    // member steps back, so the default is the one they see first.
    expect(weightWindow(TODAY, 7)).toMatchObject({ offset: 0, start: TODAY, isCurrent: true });
  });

  it('HEALTH-WEIGHT-107: a nonsense width collapses to one day, never an empty axis', () => {
    // A zero-day window renders a chart with no x-axis at all, and a NaN one
    // loops forever building `dayKeys`. Neither 0 nor NaN is 7 or 30, so both
    // fall through to the plain trailing-window path.
    expect(weightWindow(TODAY, 0).dayKeys).toEqual([TODAY]);
    expect(weightWindow(TODAY, Number.NaN).dayKeys).toEqual([TODAY]);
    expect(weightWindow(TODAY, 0).label).toBe('13 Jul – 13 Jul');
  });
});

/* ------------------------------------------------------------------ */
/* Period chart — title, bucket width and bar averaging                */
/* ------------------------------------------------------------------ */

describe('the period chart — title, bucket width and bar averaging', () => {
  it('HEALTH-WEIGHT-200: the title names the SELECTED width, never always "weekly"', () => {
    expect(weightPeriodTitle(7)).toBe('WEEKLY WEIGHT');
    expect(weightPeriodTitle(30)).toBe('MONTHLY WEIGHT');
    expect(weightPeriodTitle(90)).toBe('90 DAYS WEIGHT');
    expect(weightPeriodTitle(365)).toBe('YEAR WEIGHT');
  });

  it('HEALTH-WEIGHT-201: a bar covers one day at 7, a week beyond that, and a month at a year', () => {
    // A bar per day at 90 or 365 days would be an illegible sliver — the
    // bucket width is picked so the bar COUNT stays readable at every width.
    expect(weightBarBucketDays(7)).toBe(1);
    expect(weightBarBucketDays(30)).toBe(7);
    expect(weightBarBucketDays(90)).toBe(7);
    expect(weightBarBucketDays(365)).toBe(31);
  });

  it('HEALTH-WEIGHT-202: a one-day bucket averages to the day\'s own reading, or null if it has none', () => {
    const window = weightWindow(TODAY, 7, 0); // 13 Jul … 19 Jul (the week containing TODAY)
    const log = [day('2026-07-14', 82), day('2026-07-16', 80)];
    const buckets = weightPeriodBuckets(window.dayKeys, log, 1);
    expect(buckets).toHaveLength(7);
    expect(buckets[1]).toMatchObject({ start: '2026-07-14', end: '2026-07-14', average: 82, days: 1 });
    expect(buckets[0]).toMatchObject({ start: '2026-07-13', end: '2026-07-13', average: null, days: 0 });
  });

  it('HEALTH-WEIGHT-203: a bucket averages only the days INSIDE it that carry a reading', () => {
    const window = weightWindow(TODAY, 30, 0); // 1 Jul … 31 Jul
    // Two readings a week apart, landing in different weekly buckets.
    const log = [day('2026-07-01', 84), day('2026-07-02', 86), day('2026-07-08', 90)];
    const buckets = weightPeriodBuckets(window.dayKeys, log, 7);
    expect(buckets[0].average).toBe(85); // (84 + 86) / 2
    expect(buckets[1].average).toBe(90);
  });

  it('HEALTH-WEIGHT-204: a width that does not divide evenly covers the remainder rather than dropping or merging it', () => {
    const window = weightWindow(TODAY, 30, 0); // July — 31 real calendar days
    const buckets = weightPeriodBuckets(window.dayKeys, [], 7);
    // July 2026 opens on a Wednesday, so the 7-day buckets are NOT a plain
    // 31 ÷ 7 chunking (four full weeks + a 3-day remainder) — they are real
    // Monday–Sunday weeks clipped to the window, so the first and last are
    // the partial ones: Jul 1–5 (5 days), three full weeks, then Jul 27–31
    // (5 days). Either way the bars must still cover the WHOLE month.
    expect(buckets).toHaveLength(5);
    const totalDaysCovered = buckets.reduce(
      (sum, b) => sum + (Date.parse(b.end) - Date.parse(b.start)) / 86_400_000 + 1,
      0
    );
    expect(totalDaysCovered).toBe(31);
  });

  it('HEALTH-WEIGHT-205: a 7-day bucket is a real Monday–Sunday week, not a chunk counted from the window\'s own start', () => {
    // Before this fix, a 30-day window's "weekly" bars were chunked by array
    // index from whatever day the window happened to start on — for a month
    // that doesn't open on a Monday (July 2026 opens on a Wednesday), that
    // produced bars like "7 Aug / 14 Aug / 21 Aug / 28 Aug" that share no
    // days with the calendar week of the same name. Every bucket boundary
    // here must fall on the app-wide Monday-start convention instead.
    const window = weightWindow(TODAY, 30, 0); // Jul 1 – Jul 31, 2026
    const buckets = weightPeriodBuckets(window.dayKeys, [], 7);
    expect(buckets.map((b) => [b.start, b.end])).toEqual([
      ['2026-07-01', '2026-07-05'], // partial — the window starts mid-week
      ['2026-07-06', '2026-07-12'], // a real Monday–Sunday week
      ['2026-07-13', '2026-07-19'], // a real Monday–Sunday week
      ['2026-07-20', '2026-07-26'], // a real Monday–Sunday week
      ['2026-07-27', '2026-07-31'], // partial — the window ends mid-week
    ]);
    // Every full week's start is a real Monday, by the app's own definition.
    expect(weekStartOf('2026-07-06')).toBe('2026-07-06');
    expect(weekStartOf('2026-07-13')).toBe('2026-07-13');
    expect(weekStartOf('2026-07-20')).toBe('2026-07-20');
  });
});

/* ------------------------------------------------------------------ */
/* Goal progress                                                       */
/* ------------------------------------------------------------------ */

describe('weightGoalProgress', () => {
  it('HEALTH-WEIGHT-110: measures from the BASELINE, not from the visible window', () => {
    const progress = weightGoalProgress({ current: 80, target: 75, baseline: 90 });
    expect(progress.direction).toBe('lose');
    expect(progress.travelled).toBe(-10);
    expect(progress.remaining).toBe(-5);
    expect(progress.fraction).toBeCloseTo(10 / 15, 5);
    expect(progress.reached).toBe(false);
  });

  it('HEALTH-WEIGHT-111: a losing goal that gains reads 0%, never a flipped "gain" goal', () => {
    // Deriving direction from current-vs-target would turn a bad week into a
    // suddenly 20%-complete gain goal.
    const progress = weightGoalProgress({ current: 92, target: 75, baseline: 90 });
    expect(progress.direction).toBe('lose');
    expect(progress.fraction).toBe(0);
  });

  it('HEALTH-WEIGHT-112: reaching or passing the target reads as reached and clamps at 1', () => {
    expect(weightGoalProgress({ current: 74, target: 75, baseline: 90 })).toMatchObject({
      reached: true,
      fraction: 1,
    });
  });

  it('HEALTH-WEIGHT-113: a gain goal counts upward', () => {
    const progress = weightGoalProgress({ current: 65, target: 70, baseline: 60 });
    expect(progress.direction).toBe('gain');
    expect(progress.fraction).toBeCloseTo(0.5, 5);
    expect(progress.remaining).toBe(5);
  });

  it('HEALTH-WEIGHT-114: a baseline equal to the target is MAINTAIN, complete only while held', () => {
    expect(weightGoalProgress({ current: 75, target: 75, baseline: 75 })).toMatchObject({
      direction: 'maintain',
      reached: true,
      fraction: 1,
    });
    expect(weightGoalProgress({ current: 77, target: 75, baseline: 75 })).toMatchObject({
      direction: 'maintain',
      reached: false,
      fraction: 0,
    });
  });

  it('HEALTH-WEIGHT-115: no baseline falls back to the current weight — 0%, not a made-up number', () => {
    expect(weightGoalProgress({ current: 80, target: 75, baseline: null }).fraction).toBe(0);
  });

  it('HEALTH-WEIGHT-116: a missing current or target yields nothing at all', () => {
    expect(weightGoalProgress({ current: null, target: 75, baseline: 90 }).fraction).toBe(0);
    expect(weightGoalProgress({ current: 80, target: null, baseline: 90 }).remaining).toBe(0);
  });

  it('HEALTH-WEIGHT-117: figures too big to subtract read 0%, never "NaN% of the way"', () => {
    // The ring prints `Math.round(fraction * 100)%`, so an un-representable
    // baseline→target span has to land on a real number rather than painting
    // NaN across the goal widget and the insight that quotes it.
    const progress = weightGoalProgress({ current: 1e308, target: 1e308, baseline: -1e308 });
    expect(progress.fraction).toBe(0);
    expect(Number.isNaN(progress.fraction)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Streak                                                              */
/* ------------------------------------------------------------------ */

describe('weightLoggingStreak', () => {
  it('HEALTH-WEIGHT-120: counts consecutive days and remembers the best run', () => {
    const streak = weightLoggingStreak(
      ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-11', '2026-07-12', '2026-07-13'],
      TODAY
    );
    expect(streak.current).toBe(3);
    expect(streak.best).toBe(3);
    expect(streak.lastLogged).toBe(TODAY);
  });

  it('HEALTH-WEIGHT-121: a run ending YESTERDAY is still current', () => {
    // Breaking it at midnight would tell someone who has not yet stood on the
    // scale this morning that they lost a 40-day run.
    expect(weightLoggingStreak(['2026-07-11', '2026-07-12'], TODAY).current).toBe(2);
  });

  it('HEALTH-WEIGHT-122: a run that ended two days ago is over, but the best is kept', () => {
    const streak = weightLoggingStreak(['2026-07-09', '2026-07-10', '2026-07-11'], TODAY);
    expect(streak.current).toBe(0);
    expect(streak.best).toBe(3);
  });

  it('HEALTH-WEIGHT-123: duplicate days count once', () => {
    expect(weightLoggingStreak([TODAY, TODAY, '2026-07-12'], TODAY).current).toBe(2);
  });

  it('HEALTH-WEIGHT-124: an empty log has no streak and no last day', () => {
    expect(weightLoggingStreak([], TODAY)).toEqual({ current: 0, best: 0, lastLogged: null });
  });

  it('HEALTH-WEIGHT-125: a date key that lost its day is read as the 1st, not as a break', () => {
    // `weight_entries.date` is a wire string, and the streak walks it with date
    // arithmetic. A truncated key must degrade to the start of its month/year
    // rather than producing `NaN-aN-aN` and silently ending every run.
    expect(weightLoggingStreak(['2026-07', '2026-07-02'], '2026-07-02')).toEqual({
      current: 2,
      best: 2,
      lastLogged: '2026-07-02',
    });
    expect(weightLoggingStreak(['2026', '2026-01-02'], '2026-01-02').best).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Projection                                                          */
/* ------------------------------------------------------------------ */

describe('weightProjection', () => {
  const falling: DatedValue[] = [
    day('2026-07-01', 80),
    day('2026-07-03', 79.6),
    day('2026-07-05', 79.2),
    day('2026-07-07', 78.8),
    day('2026-07-09', 78.4),
    day('2026-07-11', 78),
  ];

  it('HEALTH-WEIGHT-130: fits a slope per CALENDAR day, not per row', () => {
    // Fitting by index would treat a reading after a three-week gap as the next
    // day and triple the apparent rate.
    const fit = weightProjection(falling);
    expect(fit.slopePerDay).toBeCloseTo(-0.2, 5);
    expect(fit.samples).toBe(6);
    expect(fit.spanDays).toBe(10);
  });

  it('HEALTH-WEIGHT-131: projects forward from the LAST reading', () => {
    expect(weightProjection(falling).project(10)).toBeCloseTo(76, 1);
  });

  it('HEALTH-WEIGHT-132: gives an arrival date only when the trend points at the target', () => {
    const fit = weightProjection(falling);
    expect(fit.daysToTarget(75)).toBe(15);
    // Moving away from it has no arrival date — a negative one would render as
    // "reached 40 days ago".
    expect(fit.daysToTarget(85)).toBeNull();
  });

  it('HEALTH-WEIGHT-133: refuses to fit fewer than two readings', () => {
    const fit = weightProjection([day('2026-07-01', 80)]);
    expect(fit.samples).toBe(1);
    expect(fit.project(30)).toBeNull();
    expect(fit.daysToTarget(70)).toBeNull();
  });

  it('HEALTH-WEIGHT-134: the UI floor is five readings — two points fit noise perfectly', () => {
    expect(MIN_PROJECTION_SAMPLES).toBeGreaterThanOrEqual(5);
    expect(weightProjection(falling.slice(0, 2)).samples).toBeLessThan(MIN_PROJECTION_SAMPLES);
  });

  it('HEALTH-WEIGHT-135: several readings on ONE day give a zero slope, not a divide by zero', () => {
    const sameDay = weightProjection([day(TODAY, 80), day(TODAY, 81)]);
    expect(sameDay.slopePerDay).toBe(0);
    expect(Number.isFinite(sameDay.project(30) as number)).toBe(true);
  });

  it('HEALTH-WEIGHT-136: a nonsense horizon or target gets no forecast rather than a NaN one', () => {
    const fit = weightProjection(falling);
    expect(fit.project(Number.NaN)).toBeNull();
    expect(fit.daysToTarget(Number.NaN)).toBeNull();
    // A flat fit never arrives anywhere: dividing a distance by a zero rate is
    // "never", and the widget prints "—" for it rather than "0 d".
    const flat = weightProjection([day(TODAY, 80), day(TODAY, 81)]);
    expect(flat.daysToTarget(70)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* History extremes                                                    */
/* ------------------------------------------------------------------ */

describe('weightHistoryStats', () => {
  const log = [
    day('2026-05-01', 90),
    day('2026-06-01', 84),
    day('2026-06-15', 86),
    day('2026-07-13', 84),
  ];

  it('HEALTH-WEIGHT-140: reports starting / current / lowest / highest WITH their dates', () => {
    const stats = weightHistoryStats(log);
    expect(stats.starting).toEqual(day('2026-05-01', 90));
    expect(stats.current).toEqual(day('2026-07-13', 84));
    expect(stats.highest).toEqual(day('2026-05-01', 90));
    // Ties keep the EARLIEST date, so "lowest" answers when you first got there.
    expect(stats.lowest).toEqual(day('2026-06-01', 84));
  });

  it('HEALTH-WEIGHT-141: an empty log yields four nulls, not zeros', () => {
    expect(weightHistoryStats([])).toEqual({
      starting: null,
      current: null,
      lowest: null,
      highest: null,
    });
  });

  it('HEALTH-WEIGHT-142: a later reading takes over as the highest, with its own date', () => {
    // The scan seeds both extremes with the FIRST point, so a log that only ever
    // climbs is the case that proves the maximum actually moves.
    const climbing = weightHistoryStats([
      day('2026-05-01', 80),
      day('2026-06-01', 84),
      day('2026-07-13', 88),
    ]);
    expect(climbing.highest).toEqual(day('2026-07-13', 88));
    expect(climbing.lowest).toEqual(day('2026-05-01', 80));
    expect(climbing.current).toEqual(day('2026-07-13', 88));
  });
});

/* ------------------------------------------------------------------ */
/* Period comparison                                                   */
/* ------------------------------------------------------------------ */

describe('period comparison', () => {
  const log = [
    day('2026-07-06', 80),
    day('2026-07-07', 81),
    day('2026-07-13', 79),
    day('2026-06-15', 84),
  ];

  it('HEALTH-WEIGHT-150: an average divides by the days LOGGED, not the span', () => {
    const avg = periodAverage(log, { label: 'w', start: '2026-07-06', end: '2026-07-12' });
    expect(avg.average).toBe(80.5);
    expect(avg.days).toBe(2);
  });

  it('HEALTH-WEIGHT-151: an empty previous period answers null, never a huge change', () => {
    const comparison = periodComparison(
      log,
      { label: 'This', start: '2026-07-06', end: '2026-07-13' },
      { label: 'Prev', start: '2026-01-01', end: '2026-01-31' }
    );
    expect(comparison.previous.average).toBeNull();
    expect(comparison.change).toBeNull();
    expect(comparison.changePercent).toBeNull();
  });

  it('HEALTH-WEIGHT-152: week-over-week uses Monday-started weeks', () => {
    // 13 Jul 2026 is a Monday, so "this week" opens on it.
    expect(weekStartOf(TODAY)).toBe(TODAY);
    const wow = weekOverWeek(log, TODAY);
    expect(wow.current.average).toBe(79);
    expect(wow.previous.average).toBe(80.5);
    expect(wow.change).toBe(-1.5);
  });

  it('HEALTH-WEIGHT-153: month-over-month uses calendar months, leap years included', () => {
    expect(monthStartOf('2026-07-13')).toBe('2026-07-01');
    expect(monthEndOf('2026-07-13')).toBe('2026-07-31');
    expect(monthEndOf('2024-02-05')).toBe('2024-02-29');
    const mom = monthOverMonth(log, TODAY);
    expect(mom.current.average).toBe(80);
    expect(mom.previous.average).toBe(84);
    expect(mom.change).toBe(-4);
  });

  it('HEALTH-WEIGHT-154: the percentage is of the PREVIOUS average, and never divides by zero', () => {
    const zeroed = periodComparison(
      [day('2026-07-01', 0), day('2026-07-13', 5)],
      { label: 'This', start: '2026-07-13', end: '2026-07-13' },
      { label: 'Prev', start: '2026-07-01', end: '2026-07-01' }
    );
    expect(zeroed.changePercent).toBeNull();
  });

  it('HEALTH-WEIGHT-155: a truncated date key still resolves to a real Monday', () => {
    // Week bucketing runs over wire date strings; a key that lost its day must
    // not answer `NaN-aN-aN`, which would drop the reading into a bucket of its
    // own and print an empty week on the comparison card.
    // 1 Jul 2026 is a Wednesday, so its week opened on the Monday before.
    expect(weekStartOf('2026-07')).toBe('2026-06-29');
    // 1 Jan 2026 is a Thursday.
    expect(weekStartOf('2026')).toBe('2025-12-29');
  });
});

/* ------------------------------------------------------------------ */
/* The "LOG A WEIGHT" gate                                             */
/* ------------------------------------------------------------------ */

describe('weightHasGapThisWeek — gates the default "LOG A WEIGHT" card', () => {
  it('HEALTH-WEIGHT-210: an empty log is a gap, even on a Monday where today is the only day due', () => {
    // TODAY is a Monday, so "this week through today" is just today itself.
    expect(weightHasGapThisWeek([], TODAY)).toBe(true);
  });

  it('HEALTH-WEIGHT-211: today logged closes the gap when today is the only day due', () => {
    expect(weightHasGapThisWeek([day(TODAY, 80)], TODAY)).toBe(false);
  });

  it('HEALTH-WEIGHT-212: a midweek gap is found even with earlier days this week already logged', () => {
    const wednesday = '2026-07-15';
    const log = [day('2026-07-13', 82), day('2026-07-14', 81)]; // Mon, Tue — Wed itself missing
    expect(weightHasGapThisWeek(log, wednesday)).toBe(true);
  });

  it('HEALTH-WEIGHT-213: every day this week through today logged closes the gap', () => {
    const wednesday = '2026-07-15';
    const log = [day('2026-07-13', 82), day('2026-07-14', 81), day(wednesday, 80)];
    expect(weightHasGapThisWeek(log, wednesday)).toBe(false);
  });

  it('HEALTH-WEIGHT-214: a day LATER this week never counts — only up to today does', () => {
    const tuesday = '2026-07-14';
    // Monday and Tuesday (today) are unlogged; Wednesday–Sunday being logged
    // must not paper over the days that have actually happened and were missed.
    const log = [
      day('2026-07-15', 1),
      day('2026-07-16', 1),
      day('2026-07-17', 1),
      day('2026-07-18', 1),
      day('2026-07-19', 1),
    ];
    expect(weightHasGapThisWeek(log, tuesday)).toBe(true);
  });

  it('HEALTH-WEIGHT-215: last week\'s gaps do not linger once this week is fully caught up', () => {
    // Nothing logged in the entire month before — only this week matters.
    expect(weightHasGapThisWeek([day(TODAY, 80)], TODAY)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Monthly progress                                                    */
/* ------------------------------------------------------------------ */

describe('monthlyWeightProgress', () => {
  it('HEALTH-WEIGHT-160: averages by calendar month and changes against the previous PRESENT month', () => {
    const months = monthlyWeightProgress([
      day('2026-04-10', 90),
      day('2026-04-20', 88),
      // May is missing entirely — the change must span the gap, not invent zero.
      day('2026-06-01', 85),
    ]);
    expect(months).toEqual([
      { month: '2026-04', average: 89, days: 2, change: null },
      { month: '2026-06', average: 85, days: 1, change: -4 },
    ]);
  });

  it('HEALTH-WEIGHT-161: months with nothing logged are omitted, never zeroed', () => {
    expect(monthlyWeightProgress([]).length).toBe(0);
  });

  it('HEALTH-WEIGHT-162: a corrupt row is skipped, never averaged in as a zero', () => {
    // One unreadable row must not halve the month it lands in — the day count
    // beside each month has to describe the readings that were actually used.
    const months = monthlyWeightProgress([
      day('2026-04-10', 90),
      day('2026-04-11', Number.NaN),
      { date: 20260412 as unknown as string, value: 88 },
      null as unknown as DatedValue,
    ]);
    expect(months).toEqual([{ month: '2026-04', average: 90, days: 1, change: null }]);
  });
});

/* ------------------------------------------------------------------ */
/* Calorie ↔ weight correlation                                        */
/* ------------------------------------------------------------------ */

describe('calorieWeightCorrelation', () => {
  const weeks = ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29'];

  it('HEALTH-WEIGHT-170: correlates WEEKLY intake against weekly weight CHANGE', () => {
    const result = calorieWeightCorrelation(
      weeks.map((weekStart, i) => ({ weekStart, average: 2000 + i * 200 })),
      weeks.map((weekStart, i) => ({ weekStart, average: 80 + i * 0.5 }))
    );
    // Four change pairs from five weeks — the first week has nothing before it.
    expect(result.samples).toBe(4);
    expect(result.averageChange).toBe(0.5);
    // The first week has no predecessor, so its intake never enters a pair:
    // the mean is over weeks 2–5 (2200 … 2800), not all five.
    expect(result.averageCalories).toBe(2500);
  });

  it('HEALTH-WEIGHT-171: a week with no calorie average is skipped, not treated as zero intake', () => {
    const result = calorieWeightCorrelation(
      [{ weekStart: '2026-06-08', average: 2200 }],
      weeks.map((weekStart, i) => ({ weekStart, average: 80 + i * 0.5 }))
    );
    expect(result.samples).toBe(1);
  });

  it('HEALTH-WEIGHT-172: an identical intake every week has no variance, so r is null not 0', () => {
    const result = calorieWeightCorrelation(
      weeks.map((weekStart) => ({ weekStart, average: 2000 })),
      weeks.map((weekStart, i) => ({ weekStart, average: 80 + i * 0.5 }))
    );
    expect(result.r).toBeNull();
  });

  it('HEALTH-WEIGHT-173: nothing to pair answers null with a zero sample size', () => {
    expect(calorieWeightCorrelation([], [])).toEqual({
      r: null,
      samples: 0,
      averageCalories: null,
      averageChange: null,
    });
  });

  it('HEALTH-WEIGHT-174: the UI floor is four weeks — two points always correlate perfectly', () => {
    expect(MIN_CORRELATION_SAMPLES).toBeGreaterThanOrEqual(4);
  });
});

/* ------------------------------------------------------------------ */
/* Body metrics                                                        */
/* ------------------------------------------------------------------ */

describe('body metrics', () => {
  it('HEALTH-WEIGHT-180: BMI is kg ÷ m², and null without BOTH inputs', () => {
    expect(bmiFor(78, 178)).toBe(24.6);
    expect(bmiFor(78, null)).toBeNull();
    expect(bmiFor(null, 178)).toBeNull();
    expect(bmiFor(78, 0)).toBeNull();
  });

  it('HEALTH-WEIGHT-181: the six BMI bands are the donor thresholds, verbatim', () => {
    expect(bmiCategory(18.4)?.key).toBe('underweight');
    expect(bmiCategory(18.5)?.key).toBe('normal');
    expect(bmiCategory(24.9)?.key).toBe('normal');
    expect(bmiCategory(25)?.key).toBe('overweight');
    expect(bmiCategory(30)?.key).toBe('obese1');
    expect(bmiCategory(35)?.key).toBe('obese2');
    expect(bmiCategory(41)?.key).toBe('obese3');
    expect(bmiCategory(null)).toBeNull();
  });

  it('HEALTH-WEIGHT-182: BMR is Mifflin–St Jeor with the donor sex offsets', () => {
    // base = 10·78 + 6.25·178 − 5·36 = 1712.5
    expect(bmrFor({ weightKg: 78, heightCm: 178, age: 36, gender: 'male' })).toBe(1718);
    expect(bmrFor({ weightKg: 78, heightCm: 178, age: 36, gender: 'female' })).toBe(1552);
    // 'other' is the donor's own average of the two constants, not a silent pick.
    expect(bmrFor({ weightKg: 78, heightCm: 178, age: 36, gender: 'other' })).toBe(1635);
  });

  it('HEALTH-WEIGHT-183: BMR refuses to guess a missing input', () => {
    expect(bmrFor({ weightKg: 78, heightCm: null, age: 36, gender: 'male' })).toBeNull();
    expect(bmrFor({ weightKg: 78, heightCm: 178, age: null, gender: 'male' })).toBeNull();
    expect(bmrFor({ weightKg: 78, heightCm: 178, age: 36, gender: null })).toBeNull();
  });

  it('HEALTH-WEIGHT-184: TDEE multiplies by the donor activity factors, and needs a level', () => {
    expect(ACTIVITY_MULTIPLIERS.moderatelyActive).toBe(1.55);
    expect(tdeeFor(1718, 'moderatelyActive')).toBe(2663);
    // NULL rather than a defaulted level: a fabricated activity factor becomes a
    // calorie figure the member is shown as fact.
    expect(tdeeFor(1718, null)).toBeNull();
  });

  it('HEALTH-WEIGHT-185: age comes from a birth YEAR, and rejects an impossible one', () => {
    expect(ageFromBirthYear(1990, TODAY)).toBe(36);
    expect(ageFromBirthYear(2030, TODAY)).toBeNull();
    expect(ageFromBirthYear(null, TODAY)).toBeNull();
  });

  it('HEALTH-WEIGHT-186: composition splits weight into fat and lean mass', () => {
    expect(bodyCompositionFor(80, 20)).toEqual({
      fatMassKg: 16,
      leanMassKg: 64,
      bodyFatPercent: 20,
    });
    expect(bodyCompositionFor(80, null)).toBeNull();
    expect(bodyCompositionFor(80, 140)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Chart series                                                        */
/* ------------------------------------------------------------------ */

describe('chart series', () => {
  const palette = { down: '#0a0', up: '#f60' };

  it('HEALTH-WEIGHT-190: change bars are day-on-day differences with a real zero', () => {
    const bars = weightChangeBars(
      [day('2026-07-11', 80), day('2026-07-12', 79.4), day('2026-07-13', 79.8)],
      palette
    );
    expect(bars.map((b) => b.value)).toEqual([-0.6, 0.4]);
    expect(bars[0].frontColor).toBe(palette.down);
    expect(bars[1].frontColor).toBe(palette.up);
  });

  it('HEALTH-WEIGHT-191: the first logged day is ABSENT, not a zero bar', () => {
    // The donor pads its charts with placeholder bars at the axis minimum, which
    // draws a day that was never weighed.
    expect(weightChangeBars([day(TODAY, 80)], palette)).toEqual([]);
  });

  it('HEALTH-WEIGHT-192: bar labels are real dates and are thinned, never an index', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      day(`2026-07-${String(i + 1).padStart(2, '0')}`, 80 + i * 0.1)
    );
    const bars = weightChangeBars(many, palette, 4);
    expect(bars).toHaveLength(19);
    const labelled = bars.filter((b) => b.label !== '');
    expect(labelled.length).toBeLessThanOrEqual(6);
    for (const bar of labelled) expect(bar.label).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
  });

  it('HEALTH-WEIGHT-193: the axis floor lifts off zero for a narrow band far from it', () => {
    const floor = weightAxisFloor([79, 80, 81]);
    expect(floor).not.toBeNull();
    expect(floor as number).toBeLessThan(79);
    expect(floor as number).toBeGreaterThan(0);
  });

  it('HEALTH-WEIGHT-194: the goal participates in the floor so a target below the data stays visible', () => {
    const withoutGoal = weightAxisFloor([79, 80, 81]) as number;
    const withGoal = weightAxisFloor([79, 80, 81], 70) as number;
    expect(withGoal).toBeLessThan(withoutGoal);
    expect(withGoal).toBeLessThan(70);
  });

  it('HEALTH-WEIGHT-195: a series that already reaches near zero is NOT truncated', () => {
    // Truncating there would exaggerate rather than clarify.
    expect(weightAxisFloor([0.5, 1, 2])).toBeNull();
    expect(weightAxisFloor([])).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Entry helpers                                                       */
/* ------------------------------------------------------------------ */

describe('entry helpers', () => {
  it('HEALTH-WEIGHT-196: a window filters on the day a reading BELONGS to', () => {
    const log = [
      // Back-dated: typed today, but taken on 5 July.
      entry('2026-07-05', 80, { loggedAt: `${TODAY}T09:00:00.000Z` }),
      entry('2026-07-12', 79),
    ];
    const inside = entriesInWindow(log, { start: '2026-07-10', end: TODAY });
    expect(inside.map((e) => e.date)).toEqual(['2026-07-12']);
  });

  it('HEALTH-WEIGHT-197: the display unit falls back when there is nothing logged', () => {
    expect(dominantUnit([entry(TODAY, 176, { unit: 'lb' })])).toBe('lb');
    expect(dominantUnit([], 'lb')).toBe('lb');
    expect(dominantUnit([])).toBe('kg');
  });

  it('HEALTH-WEIGHT-352: the display unit is the MAJORITY unit, not the newest reading’s', () => {
    // The bug this pins: `dominantUnit` returned `entries[0].unit`. Everything
    // downstream filters the log to this unit, so a member with a long kilogram
    // history who recorded ONE pound reading had their whole history dropped
    // from the chart, the history widget, the goal ring and every derived
    // figure — the tab showed a single point.
    const mostlyKg = [
      entry('2026-07-13', 80, { unit: 'lb' }), // newest, the odd one out
      entry('2026-07-12', 72, { unit: 'kg' }),
      entry('2026-07-11', 72.4, { unit: 'kg' }),
      entry('2026-07-10', 72.8, { unit: 'kg' }),
    ];
    expect(dominantUnit(mostlyKg)).toBe('kg');
  });

  it('HEALTH-WEIGHT-353: a tie breaks toward the newest reading', () => {
    // A tie means the member is mid-switch; the direction they are heading is
    // the more useful guess than the direction they are leaving.
    const evenSplit = [
      entry('2026-07-13', 160, { unit: 'lb' }),
      entry('2026-07-12', 161, { unit: 'lb' }),
      entry('2026-07-11', 73, { unit: 'kg' }),
      entry('2026-07-10', 73.2, { unit: 'kg' }),
    ];
    expect(dominantUnit(evenSplit)).toBe('lb');
  });

  it('HEALTH-WEIGHT-354: rows with no unit are not counted, and cannot win', () => {
    const withHoles = [
      entry('2026-07-13', 72, { unit: undefined as never }),
      entry('2026-07-12', 71.8, { unit: undefined as never }),
      entry('2026-07-11', 71.5, { unit: 'kg' }),
    ];
    expect(dominantUnit(withHoles)).toBe('kg');
    // …and a log of nothing but holes falls back rather than inventing a scale.
    expect(
      dominantUnit([entry(TODAY, 72, { unit: undefined as never })], 'lb'),
    ).toBe('lb');
  });
});

/* ------------------------------------------------------------------ */
/* A series that never arrived                                         */
/* ------------------------------------------------------------------ */

describe('a series that never arrived', () => {
  it('HEALTH-WEIGHT-198: an absent series answers exactly like an empty one', () => {
    // A read that fails offline before its cache is written hands `undefined`
    // down the same path an empty log takes. Every figure below is a widget's
    // empty-state trigger — the streak card, the projection refusal, the history
    // card, the month list, the correlation card, the change chart and the axis
    // floor all key their "nothing logged yet" copy off these exact values, so a
    // throw here blanks the whole Weight tab instead of one card.
    const none = undefined as unknown as DatedValue[];

    expect(weightLoggingStreak(undefined as unknown as string[], TODAY)).toEqual({
      current: 0,
      best: 0,
      lastLogged: null,
    });
    expect(weightProjection(none).samples).toBe(0);
    expect(weightHistoryStats(none).current).toBeNull();
    expect(periodAverage(none, { label: 'w', start: '2026-07-01', end: TODAY })).toMatchObject({
      average: null,
      days: 0,
    });
    expect(monthlyWeightProgress(none)).toEqual([]);
    expect(
      calorieWeightCorrelation(undefined as never, undefined as never)
    ).toMatchObject({ r: null, samples: 0 });
    expect(weightChangeBars(none, { down: '#0a0', up: '#f60' })).toEqual([]);
    expect(weightAxisFloor(undefined as never)).toBeNull();
    expect(entriesInWindow(undefined as never, { start: '2026-07-01', end: TODAY })).toEqual([]);
    // The unit is what the whole tab is labelled in, so an absent log has to
    // answer with the member's preference rather than throwing on `.length`.
    expect(dominantUnit(undefined as never, 'lb')).toBe('lb');
  });
});
