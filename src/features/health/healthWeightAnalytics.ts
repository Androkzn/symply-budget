import type { AppBarDatum } from '@components/ui/AppBarChart';

import type { DatedValue } from './healthDashboards';
import { weightDayOf, type WeightEntry, type WeightUnit } from './healthLocalStorage';
import { formatAxisDate } from './healthTrends';
import type { HealthActivityLevel, HealthGender } from './healthWeightStorage';

/**
 * Symply Health — the derivation maths behind the WEIGHT tab.
 *
 * Everything the donor's `WeightTabViewModel`, `WeightDashboardViewModel` and
 * `GoalCalculator` compute, as pure exported functions so each figure can be
 * pinned by a unit test without rendering a chart. The screen and the widgets
 * only paint what these return.
 *
 * Four invariants are enforced here rather than at each call site, because each
 * has already produced a wrong number in one app or another:
 *
 * 1. **A window is a real calendar span, not "the last N rows."** Past-window
 *    navigation exists precisely so last March is reachable; deriving a window
 *    from row COUNT would make "30 days" mean six weeks for an irregular logger.
 * 2. **Averages divide by the days that carry a reading.** Never by the width of
 *    the window — an untouched day is absent, not a zero.
 * 3. **Two readings in different units are never compared.** The caller filters
 *    to one unit (`weightDailyValues`); anything reaching a goal or a delta here
 *    is already single-unit, and the GOAL is converted once, at the edge.
 * 4. **A projection states its own uncertainty.** `weightProjection` returns the
 *    sample size and the span it was fitted over so the UI can refuse to draw a
 *    forecast from three points — the donor's Predictions widget is a "coming
 *    soon" placeholder, and shipping a confident line instead would be worse
 *    than shipping nothing.
 */

/* ------------------------------------------------------------------ */
/* Windows — the past-window navigator                                 */
/* ------------------------------------------------------------------ */

/** The donor's `ChartPeriod` widened: week · month · quarter · year. */
export const WEIGHT_WINDOW_DAYS = [7, 30, 90, 365] as const;
export type WeightWindowDays = (typeof WEIGHT_WINDOW_DAYS)[number];

export interface WeightWindow {
  /** Every day in the window, oldest first, `YYYY-MM-DD`. */
  dayKeys: string[];
  start: string;
  end: string;
  /** How many windows back this is. `0` is the one ending today. */
  offset: number;
  /** True when the window ends today — i.e. the ▶ button must be disabled. */
  isCurrent: boolean;
  /** Human span, e.g. `13 Jun – 12 Jul`. */
  label: string;
}

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The 1st of the month `months` away from `dateKey`'s month (negative = back). */
function monthShift(dateKey: string, months: number): string {
  const [y, m] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1 + months, 1));
  return date.toISOString().slice(0, 10);
}

function dayKeysBetween(start: string, end: string): string[] {
  const keys: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) keys.push(day);
  return keys;
}

/**
 * The `offset`-th window of `days` days, counting back from today.
 *
 * `offset: 0` is the current window, `offset: 1` is the one immediately before
 * it, and so on — which is the whole point: every range picker in this app
 * used to be trailing-only, so a member could ask for "the last 30 days" and
 * never for "last March". Windows tile without overlapping and without gaps,
 * so stepping back N times and forward N times returns to exactly where you
 * started.
 *
 * `days === 7` and `days === 30` are real calendar periods — Monday-Sunday
 * weeks and 1st-to-last-day months — matching the app-wide week/month
 * convention (`weekStartOf`/`monthStartOf`), not a trailing 7- or 30-day
 * count. `offset: 0` is the period CONTAINING today, so it can extend past
 * today (e.g. viewing the current week on a Wednesday includes the coming
 * Thursday–Sunday as not-yet-logged days, not a window that keeps sliding
 * forward every morning). Every other span stays a trailing window ending
 * `back * days` days ago, clamped so it never runs past today.
 */
export function weightWindow(
  today: string,
  days: WeightWindowDays | number,
  offset = 0
): WeightWindow {
  const back = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;

  if (days === 7) {
    const start = addDays(weekStartOf(today), -back * 7);
    const end = addDays(start, 6);
    return {
      dayKeys: dayKeysBetween(start, end),
      start,
      end,
      offset: back,
      isCurrent: back === 0,
      label: `${formatAxisDate(start)} – ${formatAxisDate(end)}`,
    };
  }

  if (days === 30) {
    const start = monthShift(today, -back);
    const end = monthEndOf(start);
    return {
      dayKeys: dayKeysBetween(start, end),
      start,
      end,
      offset: back,
      isCurrent: back === 0,
      label: `${formatAxisDate(start)} – ${formatAxisDate(end)}`,
    };
  }

  const span = Number.isFinite(days) && days >= 1 ? Math.floor(days) : 1;
  const end = addDays(today, -back * span);
  const start = addDays(end, -(span - 1));
  return {
    dayKeys: dayKeysBetween(start, end),
    start,
    end,
    offset: back,
    isCurrent: back === 0,
    label: `${formatAxisDate(start)} – ${formatAxisDate(end)}`,
  };
}

/* ------------------------------------------------------------------ */
/* Period chart — the WEEKLY WEIGHT card, generalised to every window  */
/* ------------------------------------------------------------------ */

/**
 * The section title for the period chart card, keyed off the SAME window
 * width the ◀ / ▶ navigator and the WEIGHT SUMMARY card already use —
 * "Weekly weight" only remains true while a 7-day window is selected.
 *
 * The month window is a real calendar month (`weightWindow`'s `days === 30`
 * case), so it carries 28–31 days depending which month it is — the upper
 * bound here is 31, not 30, or a January/March/May/… window would misreport
 * itself as '90 DAYS WEIGHT'.
 */
export function weightPeriodTitle(windowDays: number): string {
  if (windowDays <= 7) return 'WEEKLY WEIGHT';
  if (windowDays <= 31) return 'MONTHLY WEIGHT';
  if (windowDays <= 90) return '90 DAYS WEIGHT';
  return 'YEAR WEIGHT';
}

/**
 * How many calendar days one bar on the period chart covers, by window width.
 *
 * One bar per day is the donor's own granularity and stays exact at 7 days.
 * Beyond that a bar per day would be illegibly thin (30, let alone 365, bars
 * across one phone width), so 30- and 90-day windows bucket into ~weekly bars
 * and the 365-day window into ~monthly ones — chosen so the bar COUNT stays
 * in a readable range (5, 13, 12) at every one of the four window widths.
 */
export function weightBarBucketDays(windowDays: number): number {
  if (windowDays <= 7) return 1;
  if (windowDays <= 90) return 7;
  return 31;
}

export interface WeightPeriodBucket {
  /** Oldest day in the bucket, inclusive. */
  start: string;
  /** Newest day in the bucket, inclusive — always `<=` today, same as the window. */
  end: string;
  /** Mean of the days in the bucket that carry a reading; null when none do. */
  average: number | null;
  /** How many days in the bucket actually carry a reading. */
  days: number;
}

/**
 * Partitions a window's `dayKeys` (oldest first) into `bucketDays`-wide chunks
 * and averages each — the data behind every bar on the period chart, at
 * whatever granularity `weightBarBucketDays` picked.
 *
 * A 7-day bucket is a WEEK, and every week in this app is Monday–Sunday (see
 * `weekStartOf`) — NOT an arbitrary run of 7 consecutive days counted from
 * wherever the window happens to start. So at `bucketDays === 7` (the 30- and
 * 90-day windows), days are grouped by each one's own Monday rather than
 * chunked by array index: a month that does not itself start on a Monday
 * (most of them) would otherwise bucket "weeks" that share no days with the
 * calendar week of the same name, which is what a 30-day window bucketed
 * from the 1st used to show as "7 Aug / 14 Aug / 21 Aug / 28 Aug" bars that
 * did not line up with Monday–Sunday at all. Grouping by week makes the
 * FIRST and LAST bucket partial whenever the window itself does not start or
 * end on a Monday/Sunday — that partial width is the point, not a bug: it is
 * exactly how much of that real calendar week the window actually covers.
 *
 * Any other bucket width (the `bucketDays === 1` day-per-bar case, and the
 * `bucketDays === 31` month-per-bar case at a year) keeps the previous
 * index-chunked behaviour — the final chunk is whatever is left over rather
 * than being merged into its neighbour or dropped, so the bars still cover
 * the WHOLE window and the last one is simply narrower.
 */
export function weightPeriodBuckets(
  dayKeys: string[],
  allDaily: DatedValue[],
  bucketDays: number
): WeightPeriodBucket[] {
  const valueByDay = new Map<string, number>();
  for (const day of allDaily ?? []) {
    if (day && typeof day.date === 'string' && Number.isFinite(day.value)) {
      valueByDay.set(day.date, day.value);
    }
  }
  const span = Number.isFinite(bucketDays) && bucketDays >= 1 ? Math.floor(bucketDays) : 1;

  function bucketFor(chunk: string[]): WeightPeriodBucket {
    const values = chunk
      .map((day) => valueByDay.get(day))
      .filter((value): value is number => value !== undefined);
    return {
      start: chunk[0],
      end: chunk[chunk.length - 1],
      average: values.length > 0 ? round1(values.reduce((sum, v) => sum + v, 0) / values.length) : null,
      days: values.length,
    };
  }

  if (span === 7) {
    const buckets: WeightPeriodBucket[] = [];
    let chunk: string[] = [];
    let chunkWeek: string | null = null;
    for (const day of dayKeys) {
      const week = weekStartOf(day);
      if (chunkWeek !== null && week !== chunkWeek) {
        buckets.push(bucketFor(chunk));
        chunk = [];
      }
      chunk.push(day);
      chunkWeek = week;
    }
    if (chunk.length > 0) buckets.push(bucketFor(chunk));
    return buckets;
  }

  const buckets: WeightPeriodBucket[] = [];
  for (let i = 0; i < dayKeys.length; i += span) {
    const chunk = dayKeys.slice(i, i + span);
    if (chunk.length === 0) continue;
    buckets.push(bucketFor(chunk));
  }
  return buckets;
}

/* ------------------------------------------------------------------ */
/* Goal progress                                                       */
/* ------------------------------------------------------------------ */

export type WeightGoalDirection = 'lose' | 'gain' | 'maintain';

export interface WeightGoalProgress {
  /** 0…1, clamped. `0` when there is nothing to measure against. */
  fraction: number;
  /** Signed distance still to travel, in the same unit as the inputs. */
  remaining: number;
  /** Which way the target lies from the BASELINE, not from today. */
  direction: WeightGoalDirection;
  /** True once the target has been met or passed in the intended direction. */
  reached: boolean;
  /** How much has been travelled from the baseline so far, signed. */
  travelled: number;
}

export const NO_GOAL_PROGRESS: WeightGoalProgress = {
  fraction: 0,
  remaining: 0,
  direction: 'maintain',
  reached: false,
  travelled: 0,
};

/**
 * Progress from a BASELINE toward a target — the donor's `progressToGoal`.
 *
 * Measured from the baseline, never from "the start of the visible window": a
 * member who set out at 90 kg, is now at 80 kg and wants 75 kg is two thirds of
 * the way there, and that must not change when they flick the chart to a
 * 7-day range.
 *
 * `direction` is fixed by baseline→target, so a member trying to LOSE weight
 * who gains a kilo reads as 0% rather than flipping to a "gain" goal that is
 * suddenly 20% complete. A baseline equal to the target is `maintain`, and is
 * complete exactly while the member is at it (within the 0.05 rounding of a
 * one-decimal scale reading).
 */
export function weightGoalProgress(input: {
  current: number | null;
  target: number | null;
  baseline: number | null;
}): WeightGoalProgress {
  const { current, target } = input;
  if (!isFinite(current) || !isFinite(target)) return NO_GOAL_PROGRESS;

  // With no explicit baseline the current weight IS the baseline, which reads
  // as 0% — honest, because nothing is known about where the member started.
  const baseline = isFinite(input.baseline) ? (input.baseline as number) : (current as number);
  const total = (target as number) - baseline;
  const travelled = round1((current as number) - baseline);
  const remaining = round1((target as number) - (current as number));

  if (Math.abs(total) < 0.05) {
    const atGoal = Math.abs(remaining) < 0.05;
    return {
      fraction: atGoal ? 1 : 0,
      remaining,
      direction: 'maintain',
      reached: atGoal,
      travelled,
    };
  }

  const direction: WeightGoalDirection = total < 0 ? 'lose' : 'gain';
  const fraction = clamp01(travelled / total);
  return {
    fraction,
    remaining,
    direction,
    reached: direction === 'lose' ? remaining >= 0 : remaining <= 0,
    travelled,
  };
}

/* ------------------------------------------------------------------ */
/* Logging streak                                                      */
/* ------------------------------------------------------------------ */

export interface WeightStreak {
  /** Consecutive days ending today (or yesterday — see below). */
  current: number;
  /** Longest unbroken run anywhere in the log. */
  best: number;
  /** Most recent day with a reading, or null. */
  lastLogged: string | null;
}

/**
 * Consecutive weigh-in days — the donor's `streaks` widget, which ships as a
 * "coming soon" placeholder there and is built for real here.
 *
 * A streak that ends YESTERDAY still counts as current. Breaking it at midnight
 * would tell a member who has not yet stood on the scale this morning that they
 * have lost a 40-day run, which is both wrong and the single most demoralising
 * thing a habit counter can do.
 */
export function weightLoggingStreak(dates: string[], today: string): WeightStreak {
  const unique = [...new Set((dates ?? []).filter(Boolean))].sort();
  if (unique.length === 0) return { current: 0, best: 0, lastLogged: null };

  let best = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i += 1) {
    run = addDays(unique[i - 1], 1) === unique[i] ? run + 1 : 1;
    if (run > best) best = run;
  }

  const last = unique[unique.length - 1];
  const yesterday = addDays(today, -1);
  let current = 0;
  if (last === today || last === yesterday) {
    current = 1;
    for (let i = unique.length - 1; i > 0; i -= 1) {
      if (addDays(unique[i - 1], 1) !== unique[i]) break;
      current += 1;
    }
  }
  return { current, best, lastLogged: last };
}

/**
 * Whether a day between the start of THIS calendar week and today has no
 * reading yet — what gates the "LOG A WEIGHT" card.
 *
 * Scoped to the current week rather than the whole log: a member who has
 * years of history with old gaps in it would otherwise never see the card
 * again, and a member who has years of history with NO gaps this week has
 * nothing left to catch up on until tomorrow reopens one. Only days `<=`
 * today are checked — a day later this week is not a gap, it has not
 * happened yet.
 */
export function weightHasGapThisWeek(allDaily: DatedValue[], today: string): boolean {
  const logged = new Set(
    (allDaily ?? [])
      .filter((d) => d && typeof d.date === 'string' && Number.isFinite(d.value))
      .map((d) => d.date)
  );
  const start = weekStartOf(today);
  for (let day = start; day <= today; day = addDays(day, 1)) {
    if (!logged.has(day)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Trend + projection                                                  */
/* ------------------------------------------------------------------ */

export interface WeightProjection {
  /** Least-squares slope, in weight units per DAY. Negative is losing. */
  slopePerDay: number;
  /** Readings the fit used. The UI must refuse to draw a line below `MIN_FIT`. */
  samples: number;
  /** Calendar days between the first and last reading fitted. */
  spanDays: number;
  /** Fitted weight `days` ahead of the last reading, or null when unfittable. */
  project: (days: number) => number | null;
  /** Whole days until `target` at this rate; null when never, or already there. */
  daysToTarget: (target: number) => number | null;
}

/**
 * The fewest readings a forecast may be drawn from.
 *
 * Two points make a perfect line through pure noise: a scale reading moves
 * ±1 kg on water alone, so a two-point fit routinely "predicts" ten kilos a
 * month. Five is still modest but at least averages a week of noise.
 */
export const MIN_PROJECTION_SAMPLES = 5;

/**
 * Least-squares fit over the logged days — the donor's `predictions` widget,
 * which is a "coming soon" placeholder there.
 *
 * Regressed against the calendar DAY, not the row index. Fitting against the
 * index would treat a reading taken after a three-week gap as if it were the
 * next day and quietly triple the apparent rate of change.
 */
export function weightProjection(days: DatedValue[]): WeightProjection {
  const points = (days ?? [])
    .filter((d) => d && typeof d.date === 'string' && Number.isFinite(d.value))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (points.length < 2) {
    return {
      slopePerDay: 0,
      samples: points.length,
      spanDays: 0,
      project: () => null,
      daysToTarget: () => null,
    };
  }

  const origin = points[0].date;
  const xs = points.map((p) => daysBetween(origin, p.date));
  const ys = points.map((p) => p.value);
  const n = xs.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  // Every reading on one day → no slope is defined. 0 is the honest answer.
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  const lastX = xs[n - 1];
  const lastY = ys[n - 1];

  return {
    slopePerDay: slope,
    samples: n,
    spanDays: lastX,
    project: (ahead: number) =>
      Number.isFinite(ahead) ? round1(intercept + slope * (lastX + ahead)) : null,
    daysToTarget: (target: number) => {
      if (!Number.isFinite(target) || slope === 0) return null;
      const delta = target - lastY;
      // Moving AWAY from the target: there is no arrival date, and inventing a
      // negative one would render as "reached 40 days ago".
      if (Math.sign(delta) !== Math.sign(slope)) return null;
      const untilTarget = delta / slope;
      // `Math.ceil` on a float that should be exactly 15 (0.2 kg/day, 3 kg to
      // go) lands on 16, because neither 0.2 nor the least-squares slope that
      // produced it is representable in binary. The epsilon is far below one
      // day, so it can only ever absorb representation error.
      /* istanbul ignore next -- the `> 0` arm is belt-and-braces: the sign check
         above already rejects every case where the quotient is not positive, so
         the `null` arm needs a series spanning ~600 orders of magnitude (an
         underflowing divide) to be taken. Kept so such a series renders nothing
         rather than "-0 d". */
      return untilTarget > 0 ? Math.ceil(untilTarget - 1e-9) : null;
    },
  };
}

export function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = from.split('-').map(Number);
  const [by, bm, bd] = to.split('-').map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000
  );
}

/* ------------------------------------------------------------------ */
/* History extremes                                                    */
/* ------------------------------------------------------------------ */

export interface WeightHistoryStats {
  starting: DatedValue | null;
  current: DatedValue | null;
  lowest: DatedValue | null;
  highest: DatedValue | null;
}

/**
 * Starting / current / lowest / highest — the donor's `weightHistory` widget.
 *
 * Every figure carries its DATE. The donor renders four bare numbers, and a
 * "lowest 68.2" with no date cannot be acted on: was that last week or in 2019?
 *
 * Ties keep the EARLIEST date, so "lowest" answers "when did you first get
 * there" rather than moving every time the member matches their own record.
 */
export function weightHistoryStats(days: DatedValue[]): WeightHistoryStats {
  const points = (days ?? [])
    .filter((d) => d && typeof d.date === 'string' && Number.isFinite(d.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (points.length === 0) {
    return { starting: null, current: null, lowest: null, highest: null };
  }
  let lowest = points[0];
  let highest = points[0];
  for (const point of points) {
    if (point.value < lowest.value) lowest = point;
    if (point.value > highest.value) highest = point;
  }
  return {
    starting: points[0],
    current: points[points.length - 1],
    lowest,
    highest,
  };
}

/* ------------------------------------------------------------------ */
/* Period comparison                                                   */
/* ------------------------------------------------------------------ */

export interface PeriodAverage {
  label: string;
  start: string;
  end: string;
  /** Mean over the days in the span that carry a reading; null when none do. */
  average: number | null;
  /** How many days that mean covers. */
  days: number;
}

export interface PeriodComparison {
  current: PeriodAverage;
  previous: PeriodAverage;
  /** current − previous, or null when either side is empty. */
  change: number | null;
  /** Percent of the previous average, or null when it is empty or zero. */
  changePercent: number | null;
}

/** Mean of the readings that fall inside `[start, end]` inclusive. */
export function periodAverage(
  days: DatedValue[],
  span: { label: string; start: string; end: string }
): PeriodAverage {
  const inside = (days ?? []).filter(
    (d) => d && d.date >= span.start && d.date <= span.end && Number.isFinite(d.value)
  );
  return {
    ...span,
    average:
      inside.length > 0
        ? round1(inside.reduce((s, d) => s + d.value, 0) / inside.length)
        : null,
    days: inside.length,
  };
}

/**
 * Two spans side by side — the donor's `weeklyMonthlyComparisonCard` and its
 * `dataStack` widget, which both compare an average to the one before it.
 *
 * A comparison against an EMPTY previous span answers `null`, never `0`. A
 * "−72 kg change" because nothing was logged last month is the kind of figure
 * that makes a member distrust every other number on the screen.
 */
export function periodComparison(
  days: DatedValue[],
  current: { label: string; start: string; end: string },
  previous: { label: string; start: string; end: string }
): PeriodComparison {
  const a = periodAverage(days, current);
  const b = periodAverage(days, previous);
  const change = a.average !== null && b.average !== null ? round1(a.average - b.average) : null;
  return {
    current: a,
    previous: b,
    change,
    changePercent:
      change !== null && b.average !== null && b.average !== 0
        ? round1((change / b.average) * 100)
        : null,
  };
}

/** Monday that opens the week containing `dateKey` (ISO week, like the heatmap). */
export function weekStartOf(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  const dow = (date.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(dateKey, -dow);
}

/** First day of the month containing `dateKey`. */
export function monthStartOf(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

/** Last day of the month containing `dateKey`. */
export function monthEndOf(dateKey: string): string {
  const [y, m] = dateKey.split('-').map(Number);
  // Day 0 of the NEXT month is the last day of this one, leap years included.
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** This week vs last week, both Monday-started. */
export function weekOverWeek(days: DatedValue[], today: string): PeriodComparison {
  const thisStart = weekStartOf(today);
  const lastStart = addDays(thisStart, -7);
  return periodComparison(
    days,
    { label: 'This week', start: thisStart, end: addDays(thisStart, 6) },
    { label: 'Last week', start: lastStart, end: addDays(thisStart, -1) }
  );
}

/** This calendar month vs last calendar month. */
export function monthOverMonth(days: DatedValue[], today: string): PeriodComparison {
  const thisStart = monthStartOf(today);
  const lastEnd = addDays(thisStart, -1);
  return periodComparison(
    days,
    { label: 'This month', start: thisStart, end: monthEndOf(today) },
    { label: 'Last month', start: monthStartOf(lastEnd), end: lastEnd }
  );
}

/* ------------------------------------------------------------------ */
/* Monthly progress                                                    */
/* ------------------------------------------------------------------ */

export interface MonthlyWeight {
  /** `YYYY-MM`. */
  month: string;
  average: number;
  days: number;
  /** Change against the previous month PRESENT in the series, or null. */
  change: number | null;
}

/**
 * Month-by-month averages — the donor's `monthlyProgress` widget, which is a
 * "coming soon" placeholder there.
 *
 * Months with nothing logged are OMITTED rather than emitted as zero, and the
 * change is measured against the previous month that actually has data, so a
 * gap does not manufacture a cliff. The UI discloses the gap by showing each
 * month's day count.
 */
export function monthlyWeightProgress(days: DatedValue[]): MonthlyWeight[] {
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const day of days ?? []) {
    if (!day || typeof day.date !== 'string' || !Number.isFinite(day.value)) continue;
    const key = day.date.slice(0, 7);
    const bucket = buckets.get(key) ?? { sum: 0, count: 0 };
    bucket.sum += day.value;
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  const ordered = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return ordered.map(([month, { sum, count }], index) => {
    const average = round1(sum / count);
    const prev = index > 0 ? ordered[index - 1] : null;
    return {
      month,
      average,
      days: count,
      change: prev ? round1(average - round1(prev[1].sum / prev[1].count)) : null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Calorie ↔ weight correlation                                        */
/* ------------------------------------------------------------------ */

export interface CalorieWeightCorrelation {
  /** Pearson r in [-1, 1], or null when there is not enough to correlate. */
  r: number | null;
  /** Weeks that had BOTH a calorie average and a weight change. */
  samples: number;
  /** Mean weekly calorie intake across those weeks. */
  averageCalories: number | null;
  /** Mean weekly weight change across those weeks. */
  averageChange: number | null;
}

/**
 * The fewest weeks a correlation may be quoted from.
 *
 * Pearson's r is 1.0 or −1.0 for any two points whatsoever, so a two-week
 * sample always reports a perfect relationship. Four is the smallest sample
 * where the coefficient carries any information at all, and the UI still labels
 * it as weak evidence.
 */
export const MIN_CORRELATION_SAMPLES = 4;

/**
 * How weekly calorie intake tracks weekly weight change — the donor's
 * `calorieCorrelation` widget, which is a "coming soon" placeholder there.
 *
 * Correlated WEEKLY, never daily. Day-to-day weight is dominated by water and
 * gut content, so a daily correlation measures hydration, not energy balance.
 *
 * This is deliberately NOT presented as causation anywhere in the UI: the copy
 * says "moved together", the sample size is always shown, and below
 * `MIN_CORRELATION_SAMPLES` no coefficient is quoted at all.
 */
export function calorieWeightCorrelation(
  weeklyCalories: Array<{ weekStart: string; average: number }>,
  weeklyWeight: Array<{ weekStart: string; average: number }>
): CalorieWeightCorrelation {
  const caloriesBy = new Map(
    (weeklyCalories ?? [])
      .filter((w) => w && Number.isFinite(w.average))
      .map((w) => [w.weekStart, w.average])
  );
  const weights = (weeklyWeight ?? [])
    .filter((w) => w && Number.isFinite(w.average))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  const pairs: Array<{ calories: number; change: number }> = [];
  for (let i = 1; i < weights.length; i += 1) {
    const calories = caloriesBy.get(weights[i].weekStart);
    if (calories === undefined) continue;
    pairs.push({ calories, change: round1(weights[i].average - weights[i - 1].average) });
  }

  if (pairs.length === 0) {
    return { r: null, samples: 0, averageCalories: null, averageChange: null };
  }

  const meanCal = pairs.reduce((s, p) => s + p.calories, 0) / pairs.length;
  const meanChange = pairs.reduce((s, p) => s + p.change, 0) / pairs.length;
  let num = 0;
  let denCal = 0;
  let denChange = 0;
  for (const p of pairs) {
    num += (p.calories - meanCal) * (p.change - meanChange);
    denCal += (p.calories - meanCal) ** 2;
    denChange += (p.change - meanChange) ** 2;
  }
  const denominator = Math.sqrt(denCal * denChange);
  return {
    // Zero variance on either side (identical intake every week, or a perfectly
    // flat weight) means there is nothing to correlate — not r = 0.
    r: denominator === 0 ? null : round2(num / denominator),
    samples: pairs.length,
    averageCalories: Math.round(meanCal),
    averageChange: round1(meanChange),
  };
}

/* ------------------------------------------------------------------ */
/* Body metrics — BMI, BMR, TDEE, composition                          */
/* ------------------------------------------------------------------ */

export const BMI_CATEGORIES = [
  { key: 'underweight', label: 'Underweight', max: 18.5, range: 'below 18.5' },
  { key: 'normal', label: 'Normal', max: 25, range: '18.5 – 24.9' },
  { key: 'overweight', label: 'Overweight', max: 30, range: '25.0 – 29.9' },
  { key: 'obese1', label: 'Obese I', max: 35, range: '30.0 – 34.9' },
  { key: 'obese2', label: 'Obese II', max: 40, range: '35.0 – 39.9' },
  { key: 'obese3', label: 'Obese III', max: Infinity, range: '40.0 and above' },
] as const;

export type BmiCategoryKey = (typeof BMI_CATEGORIES)[number]['key'];

/** BMI = kg ÷ m². Null unless BOTH inputs are real — never a partial guess. */
export function bmiFor(weightKg: number | null, heightCm: number | null): number | null {
  if (!isFinite(weightKg) || !isFinite(heightCm) || (heightCm as number) <= 0) return null;
  const metres = (heightCm as number) / 100;
  return round1((weightKg as number) / (metres * metres));
}

/** The donor's six-band `BMICategory.from(bmi:)`, thresholds verbatim. */
export function bmiCategory(bmi: number | null): (typeof BMI_CATEGORIES)[number] | null {
  if (!isFinite(bmi)) return null;
  /* istanbul ignore next -- the `??` arm is unreachable: the last band's `max`
     is Infinity and the guard above has already rejected a non-finite BMI, so
     `find` always matches. Kept because `find` is typed `| undefined` and the
     bands are data — a future edit to the table must not fall off the end. */
  return BMI_CATEGORIES.find((band) => (bmi as number) < band.max) ?? BMI_CATEGORIES[5];
}

/** Whole years, from a birth YEAR (the app never stores a full date of birth). */
export function ageFromBirthYear(birthYear: number | null, today: string): number | null {
  if (!isFinite(birthYear)) return null;
  const year = Number(today.slice(0, 4));
  const age = year - (birthYear as number);
  // A negative or implausible age would silently produce a nonsense BMR.
  return age >= 0 && age <= 130 ? age : null;
}

/**
 * Mifflin–St Jeor, the donor's `GoalCalculator.calculateBMR`, verbatim:
 *   base = 10·kg + 6.25·cm − 5·age;  male +5, female −161, other −78.
 *
 * The `other` constant is the donor's own average of the two, kept so the two
 * apps cannot disagree about a member's BMR. The UI says it is an average
 * rather than presenting it as a measured value for that member.
 */
export function bmrFor(input: {
  weightKg: number | null;
  heightCm: number | null;
  age: number | null;
  gender: HealthGender | null;
}): number | null {
  const { weightKg, heightCm, age, gender } = input;
  if (!isFinite(weightKg) || !isFinite(heightCm) || !isFinite(age) || !gender) return null;
  const base = 10 * (weightKg as number) + 6.25 * (heightCm as number) - 5 * (age as number);
  const offset = gender === 'male' ? 5 : gender === 'female' ? -161 : -78;
  return Math.round(base + offset);
}

/** Donor `ActivityLevel.multiplier`, verbatim. */
export const ACTIVITY_MULTIPLIERS: Record<HealthActivityLevel, number> = {
  sedentary: 1.2,
  lightlyActive: 1.375,
  moderatelyActive: 1.55,
  veryActive: 1.725,
  extraActive: 1.9,
};

export const ACTIVITY_LABELS: Record<HealthActivityLevel, string> = {
  sedentary: 'Sedentary',
  lightlyActive: 'Lightly active',
  moderatelyActive: 'Moderately active',
  veryActive: 'Very active',
  extraActive: 'Extra active',
};

/** TDEE = BMR × activity multiplier. Null without BOTH — never a defaulted level. */
export function tdeeFor(bmr: number | null, level: HealthActivityLevel | null): number | null {
  if (!isFinite(bmr) || !level) return null;
  return Math.round((bmr as number) * ACTIVITY_MULTIPLIERS[level]);
}

export interface BodyComposition {
  fatMassKg: number;
  leanMassKg: number;
  bodyFatPercent: number;
}

/**
 * Fat mass and lean mass from a weight and a body-fat percentage — the donor's
 * body-composition info sheet, and the data behind its `leanMass` widget.
 *
 * Body fat comes from `body_measurements.body_fat_percentage`, which the Body
 * tab already collects and charts. The donor reads it off a smart scale
 * instead; there is no scale integration here, so the number is whatever the
 * member measured, and the UI names its source rather than implying a device.
 */
export function bodyCompositionFor(
  weightKg: number | null,
  bodyFatPercent: number | null
): BodyComposition | null {
  if (!isFinite(weightKg) || !isFinite(bodyFatPercent)) return null;
  const percent = bodyFatPercent as number;
  if (percent < 0 || percent > 100) return null;
  const fat = round1(((weightKg as number) * percent) / 100);
  return {
    fatMassKg: fat,
    leanMassKg: round1((weightKg as number) - fat),
    bodyFatPercent: round1(percent),
  };
}

/* ------------------------------------------------------------------ */
/* Chart series                                                        */
/* ------------------------------------------------------------------ */

/**
 * Per-day CHANGE against the previous logged day.
 *
 * This is what the weight tab's "Change" chart plots, and it is why that chart
 * is bars while the trend chart is a line. A bar encodes magnitude by LENGTH
 * from a zero baseline, so a bar chart of weight LEVELS is either misleading
 * (truncated axis: a 1 kg move looks like a collapse) or useless (zero
 * baseline: 71.2 and 71.9 are the same bar). A bar chart of change has a
 * genuine, meaningful zero and reads correctly at both ends.
 *
 * The first logged day has no predecessor and is therefore ABSENT, not a zero
 * bar — the donor pads its own charts with placeholder bars at the axis
 * minimum, which draws a day that was never weighed.
 */
export function weightChangeBars(
  days: DatedValue[],
  palette: { down: string; up: string },
  maxLabels = 8
): AppBarDatum[] {
  const points = (days ?? [])
    .filter((d) => d && typeof d.date === 'string' && Number.isFinite(d.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (points.length < 2) return [];
  const every = Math.max(1, Math.ceil((points.length - 1) / Math.max(1, maxLabels)));
  return points.slice(1).map((point, index) => ({
    value: round1(point.value - points[index].value),
    label: index % every === 0 ? formatAxisDate(point.date) : '',
    frontColor: point.value - points[index].value <= 0 ? palette.down : palette.up,
  }));
}

/**
 * The axis floor for a weight LINE chart.
 *
 * A weight series lives in a narrow band a long way from zero (71.2 … 72.4 kg),
 * so a zero-based axis flattens every real movement into one pixel and, worse,
 * puts a goal line 4 kg away visually on top of the data. Position encodes value
 * on a line chart, so a truncated axis is legitimate here in a way it would
 * never be for bars — but only if the floor is DISCLOSED, which is why this
 * returns the floor for the caller to print rather than hiding it inside a
 * chart component.
 *
 * The goal participates in the floor: a target below every reading must stay
 * inside the plot, since "you are above your goal" is the whole point of it.
 * `null` (no truncation) whenever the band already reaches near zero, so a
 * genuinely small series is not artificially magnified.
 */
export function weightAxisFloor(
  values: number[],
  reference?: number | null,
  padFraction = 0.15
): number | null {
  const all = (values ?? []).filter((v) => Number.isFinite(v));
  if (isFinite(reference)) all.push(reference as number);
  if (all.length === 0) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = Math.max((max - min) * padFraction, 1);
  const floor = Math.floor(min - pad);
  // Close enough to zero that truncating would exaggerate rather than clarify.
  return floor <= 0 || floor < max * 0.25 ? null : floor;
}

/* ------------------------------------------------------------------ */
/* Entry helpers                                                       */
/* ------------------------------------------------------------------ */

/** Readings inside `[start, end]`, newest first, already unit-filtered upstream. */
export function entriesInWindow(
  entries: WeightEntry[],
  window: { start: string; end: string }
): WeightEntry[] {
  return (entries ?? []).filter((entry) => {
    const day = weightDayOf(entry);
    return day >= window.start && day <= window.end;
  });
}

/**
 * The unit the majority of a log is expressed in — what the screen displays.
 *
 * It genuinely COUNTS. It used to return `entries[0].unit`, i.e. whatever the
 * newest reading happened to be in, which is a different function with the same
 * name: a member with a long kilogram history who records a single pound reading
 * had their whole log dropped from the chart, the history widget, the goal ring
 * and every derived figure, leaving one data point on screen. Everything
 * downstream filters to this unit, so picking it by recency rather than by
 * weight of evidence discards the evidence.
 *
 * Ties break toward the NEWEST reading, because a tie means the member is
 * mid-switch and the direction they are heading is the more useful guess.
 */
export function dominantUnit(entries: WeightEntry[], fallback: WeightUnit = 'kg'): WeightUnit {
  const log = entries ?? [];

  // `entries` is newest-first and a Map keeps insertion order, so the FIRST
  // unit tallied is the newest one — and the strict `>` below lets it hold a
  // tie against anything logged earlier.
  const tally = new Map<WeightUnit, number>();
  for (const entry of log) {
    if (!entry?.unit) continue;
    tally.set(entry.unit, (tally.get(entry.unit) ?? 0) + 1);
  }

  let best: WeightUnit | null = null;
  let bestCount = 0;
  for (const [unit, count] of tally) {
    if (count > bestCount) {
      best = unit;
      bestCount = count;
    }
  }
  // Nothing carried a unit at all — an empty log, or one of unit-less rows.
  return best ?? fallback;
}

/* ------------------------------------------------------------------ */
/* Small shared numerics                                               */
/* ------------------------------------------------------------------ */

function isFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
