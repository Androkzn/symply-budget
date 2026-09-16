import type { AppBarDatum, AppBarGroup } from '@components/ui/AppBarChart';
import type { AppLinePoint } from '@components/ui/AppLineChart';
import { heatmapWeekStart, type HeatmapValue } from '@components/ui/CalendarHeatmap';

import type { WorkoutEntry } from './healthActivityStorage';
import { weightDayOf, type WeightEntry, type WeightUnit } from './healthLocalStorage';
import {
  shiftDateKey,
  sumNutrition,
  type MealEntry,
  type NutritionTotals,
} from './healthNutritionStorage';
import { formatAxisDate } from './healthTrends';

/**
 * Symply Health — derivation maths for the two donor chart dashboards
 * (`WeightDashboard` and `CaloriesDashboard`).
 *
 * Every figure the dashboards render is computed here, as a pure exported
 * function, so the arithmetic can be pinned by unit tests without rendering a
 * chart. The components in `components/HealthWeightDashboard.tsx` and
 * `components/HealthCaloriesDashboard.tsx` only paint what these return.
 *
 * Five invariants are enforced here rather than left to each call site,
 * because each one has already caused a real defect in this repo:
 *
 * 1. **Never mix weight units on one axis.** `weightDailyValues` plots only the
 *    entries sharing the LATEST entry's unit — the same rule `buildWeightSeries`
 *    applies in `healthTrends.ts`, and `healthDashboards.test.ts` pins the two
 *    against each other so they cannot drift apart.
 * 2. **Label an axis by DATE, never by row index.** Every `label` produced here
 *    comes from `formatAxisDate`. When a series is thinned, the companion
 *    `labelEveryFor` tells the component how many labels it dropped so it can
 *    disclose the sampling in visible text.
 * 3. **An empty range is empty, not zero.** These functions return empty arrays
 *    and `null` extremes rather than zero-filled series, so a component can say
 *    so in words instead of drawing a flat zero line.
 * 4. **Averages cover LOGGED days only.** Every denominator here is the count of
 *    days that actually carry a datum, never the width of the window — dividing
 *    by untouched days silently understates every figure.
 * 5. **Rounded shares still sum to 100.** `macroSplit` uses the largest-remainder
 *    method; three independently-rounded percentages famously total 99 or 101.
 */

/* ------------------------------------------------------------------ */
/* Chart palette                                                       */
/* ------------------------------------------------------------------ */

/**
 * Series colors for the two dashboards.
 *
 * These are deliberately NOT the brand tokens. The brand primary swaps per app
 * (House `#4ECDC4`, Health `#E5484D`, …), so a chart painted from it changes
 * its data-viz properties every time the storefront changes — and the House
 * teal in particular lands at OKLCH L 0.776, outside the light-mode band, at
 * 1.73:1 against the card. A data series has to stay legible whichever brand
 * mounts the screen, so the slots below are fixed and validated.
 *
 * Verified with the data-viz palette validator (OKLab ΔE ×100, Machado CVD
 * simulation at severity 1.0):
 *
 * | Set                    | Mode  | Surface   | Result |
 * |------------------------|-------|-----------|--------|
 * | daily ↔ average        | light | `#F2F2F7` | band PASS · chroma PASS · CVD ΔE 21.0 (deutan) · normal ΔE 30.2 · contrast PASS |
 * | daily ↔ average        | dark  | `#1C1C1E` | band PASS · chroma PASS · CVD ΔE 18.9 (deutan) · normal ΔE 27.0 · contrast PASS |
 * | onTarget ↔ over        | light | `#F2F2F7` | band PASS · chroma PASS · CVD ΔE 10.1 (protan) · normal ΔE 28.8 · contrast PASS |
 * | onTarget ↔ over        | dark  | `#1C1C1E` | band PASS · chroma PASS · CVD ΔE 10.1 (protan) · normal ΔE 28.8 · contrast PASS |
 * | macro trio (all pairs) | light | `#F2F2F7` | band PASS · chroma PASS · CVD ΔE 15.0 (deutan) · normal ΔE 24.5 · contrast PASS |
 * | macro trio (all pairs) | dark  | `#1C1C1E` | band PASS · chroma PASS · CVD ΔE 12.6 (deutan) · normal ΔE 21.1 · contrast PASS |
 *
 * `consistency` is the sequential base handed to `CalendarHeatmap`, whose four
 * discrete steps are mixes of it. Validated in ordinal mode on both surfaces —
 * monotone L PASS · adjacent ΔL PASS · single hue PASS · light-end contrast
 * 3.09:1 (light, `#F2F2F7`) and 2.35:1 (dark, `#202632`), both clearing the
 * 2:1 floor. A darker base fails the dark end, which is why it is a step
 * lighter than `weightDaily`.
 *
 * Dark mode is SELECTED, not flipped: only the violet needed its own step
 * (`#7C3AED` measures 2.99:1 on the dark card), everything else re-validated
 * unchanged against the dark surface.
 */
export interface HealthChartPalette {
  /** Raw per-day weight line. */
  weightDaily: string;
  /** Trailing moving average drawn over it. */
  weightAverage: string;
  /** A day at or under the calorie target — also a day that finished in deficit. */
  caloriesOnTarget: string;
  /** A day over the calorie target — also a day that finished in surplus. */
  caloriesOver: string;
  /** Intake, when it is drawn NEXT TO burn rather than scored against a target. */
  energyIntake: string;
  /** Calories burned in logged sessions. */
  energyBurn: string;
  macroProtein: string;
  macroCarbs: string;
  macroFat: string;
  /** Sequential base for the logging-consistency heatmap. */
  consistency: string;
  /**
   * Habit completion rate.
   *
   * Deliberately the SAME step as `caloriesOnTarget`, not a new hue: both mean
   * "the thing you were aiming at, achieved", and the heatmap's teal — the
   * other candidate — measures 2.23:1 against the light card and would need
   * relief the bars do not carry.
   */
  habitCompletion: string;
}

const PALETTE_LIGHT: HealthChartPalette = {
  weightDaily: '#0D9488',
  weightAverage: '#7C3AED',
  caloriesOnTarget: '#059669',
  caloriesOver: '#EA580C',
  // Intake keeps the warm slot it already wears elsewhere in the card; burn
  // takes the cyan. The pair is the macro trio's protein↔carbs pair, already
  // validated on both surfaces (band PASS · chroma PASS · CVD ΔE 19.8 protan ·
  // normal ΔE 30.8 · contrast PASS), so no new colour enters the app.
  energyIntake: '#EA580C',
  energyBurn: '#0891B2',
  macroProtein: '#0891B2',
  macroCarbs: '#EA580C',
  macroFat: '#7C3AED',
  consistency: '#14B8A6',
  habitCompletion: '#059669',
};

const PALETTE_DARK: HealthChartPalette = {
  ...PALETTE_LIGHT,
  weightAverage: '#8B5CF6',
  macroFat: '#8B5CF6',
};

export function healthChartPalette(isDark: boolean): HealthChartPalette {
  return isDark ? PALETTE_DARK : PALETTE_LIGHT;
}

/* ------------------------------------------------------------------ */
/* Shared shapes + axis thinning                                       */
/* ------------------------------------------------------------------ */

/** One day's figure, `date` being a `YYYY-MM-DD` local key. */
export interface DatedValue {
  date: string;
  value: number;
}

/** Max labels an axis carries before the series is thinned (90 days is unreadable). */
export const MAX_AXIS_LABELS = 8;

/**
 * `1` = every mark labelled, `N` = every Nth. Mirrors the rule
 * `buildWeightSeries` applies, so both axes thin identically. A component that
 * receives `N > 1` MUST disclose the sampling in visible text — an axis that
 * silently drops four labels in five reads as a complete axis.
 */
export function labelEveryFor(count: number, maxLabels: number = MAX_AXIS_LABELS): number {
  if (!Number.isFinite(count) || count <= 0) return 1;
  const cap = Number.isFinite(maxLabels) && maxLabels >= 1 ? maxLabels : MAX_AXIS_LABELS;
  return Math.max(1, Math.ceil(count / cap));
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a real `YYYY-MM-DD` calendar day — `2026-02-30` is rejected
 * because `Date.UTC` would silently roll it forward to 2 March.
 *
 * Every function that buckets by week needs this guard: `heatmapWeekStart`
 * returns an unparseable key UNCHANGED, so without it a malformed date opens a
 * phantom week bucket keyed on the junk string and that bucket sorts to the
 * front of the chart.
 */
function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const back = new Date(Date.UTC(year, month - 1, day));
  return (
    back.getUTCFullYear() === year &&
    back.getUTCMonth() === month - 1 &&
    back.getUTCDate() === day
  );
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/* ------------------------------------------------------------------ */
/* Moving average                                                      */
/* ------------------------------------------------------------------ */

/**
 * TRAILING moving average — each point averages itself and the `window - 1`
 * points before it. Never centred, for two reasons:
 *
 *  - A centred window needs points that do not exist yet, so the newest day —
 *    the one a member reads hardest ("am I trending down?") — would either drop
 *    off the chart or be drawn from a half-window and then silently REVISE
 *    itself as tomorrow's entry lands. A trailing average is final the moment
 *    it is drawn.
 *  - It matches the donor, whose only smoothing (`WeightTabViewModel`) is a
 *    trailing 7-point mean with the same shrinking head window.
 *
 * The window SHRINKS at the head (`min(window, index + 1)`) instead of emitting
 * leading nulls, so the output is always the same length as the input. That is
 * a hard requirement, not a convenience: `AppLineChart` draws `data2` against
 * `data`'s x positions, so a shorter average series would slide the whole curve
 * left and misstate every date.
 *
 * A `window` larger than the series is therefore not an error — it degrades to
 * a running mean over everything logged so far. `window < 1` or non-finite
 * falls back to 1 (the raw series). Non-finite values are skipped rather than
 * poisoning the whole window with `NaN`.
 */
export function movingAverage(points: AppLinePoint[], window: number): AppLinePoint[] {
  if (!Array.isArray(points) || points.length === 0) return [];
  const size = Number.isFinite(window) && window >= 1 ? Math.floor(window) : 1;

  return points.map((point, index) => {
    const span = Math.min(size, index + 1);
    let sum = 0;
    let count = 0;
    for (let i = index - span + 1; i <= index; i += 1) {
      const value = points[i]?.value;
      if (Number.isFinite(value)) {
        sum += value as number;
        count += 1;
      }
    }
    return { value: count > 0 ? round1(sum / count) : 0, label: point.label };
  });
}

/* ------------------------------------------------------------------ */
/* Weekly aggregation                                                  */
/* ------------------------------------------------------------------ */

export interface WeeklyAverage {
  /** Monday that opens the week, `YYYY-MM-DD`. */
  weekStart: string;
  /** Mean over the days in that week that carry a datum. */
  average: number;
  /** How many days that mean covers (never 7 unless 7 were logged). */
  days: number;
}

/**
 * Bucket daily figures into Monday-started weeks.
 *
 * The week boundary comes from `heatmapWeekStart`, the same rule the heatmap
 * grid and the backend's `weekStartOf` use, so a bar and a heatmap column
 * always cover the identical span.
 *
 * Each average divides by the days actually logged in that week, never by 7.
 */
export function weeklyAverages(days: DatedValue[]): WeeklyAverage[] {
  const buckets = new Map<string, { sum: number; count: number }>();

  for (const day of days ?? []) {
    if (!day || !isDateKey(day.date) || !Number.isFinite(day.value)) continue;
    const key = heatmapWeekStart(day.date);
    const bucket = buckets.get(key) ?? { sum: 0, count: 0 };
    bucket.sum += day.value;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, { sum, count }]) => ({
      weekStart,
      average: round1(sum / count),
      days: count,
    }));
}

/**
 * Weekly averages as chart bars, labelled by the week-commencing DATE
 * ("8 Jun"), never by bar number.
 *
 * Thinned labels become `''` rather than a positional index, and the caller
 * discloses the sampling with `labelEveryFor(weeks.length, maxLabels)`.
 */
export function weeklyBars(
  weeks: WeeklyAverage[],
  maxLabels: number = MAX_AXIS_LABELS
): AppBarDatum[] {
  const every = labelEveryFor(weeks?.length ?? 0, maxLabels);
  return (weeks ?? []).map((week, index) => ({
    value: week.average,
    label: index % every === 0 ? formatAxisDate(week.weekStart) : '',
  }));
}

/* ------------------------------------------------------------------ */
/* Weight                                                              */
/* ------------------------------------------------------------------ */

export interface WeightDailySeries {
  /** One reading per logged day, oldest first. */
  values: DatedValue[];
  /** The unit every value above is expressed in, or `null` when nothing logged. */
  unit: WeightUnit | null;
}

/**
 * One weight reading per logged day, carrying its date.
 *
 * Deliberately duplicates the selection rule of `buildWeightSeries` (latest
 * entry's unit only, newest entry wins within a day) because the dashboards
 * need the DATE of each point — which `WeightSeries.points` drops, since it
 * only keeps every Nth label. `healthDashboards.test.ts` asserts the two
 * produce identical value sequences, so the duplication cannot drift.
 *
 * A kg reading and a lb reading on one axis would draw a 2.2× cliff that never
 * happened, so the minority unit is excluded outright rather than converted:
 * converting would invent a precision the member never entered.
 */
export function weightDailyValues(entries: WeightEntry[], dayKeys: string[]): WeightDailySeries {
  const inRange = new Set(dayKeys);
  // Guard BEFORE the first read: `entries[0]` on a missing series threw, which
  // made the `?? []` below a lie — a partial payload crashed Trends instead of
  // drawing an empty chart.
  const rows = entries ?? [];
  const unit = rows[0]?.unit ?? null;
  const relevant = rows.filter(
    (entry) => entry.unit === unit && inRange.has(weightDayOf(entry))
  );

  // `entries` arrive newest-first, so the first hit for a day is that day's
  // latest reading — the same tie-break `buildWeightSeries` uses.
  const byDay = new Map<string, number>();
  for (const entry of relevant) {
    const key = weightDayOf(entry);
    if (!byDay.has(key)) byDay.set(key, entry.value);
  }

  const values = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }));

  return { values, unit: values.length > 0 ? unit : null };
}

export interface WeightExtremes {
  min: number | null;
  max: number | null;
}

/** Lightest and heaviest reading in the plotted series; `null` on an empty range. */
export function weightExtremes(points: Array<{ value: number }>): WeightExtremes {
  const values = (points ?? []).map((p) => p.value).filter((v) => Number.isFinite(v));
  if (values.length === 0) return { min: null, max: null };
  return { min: Math.min(...values), max: Math.max(...values) };
}

/* ------------------------------------------------------------------ */
/* Calories vs target                                                  */
/* ------------------------------------------------------------------ */

export interface CalorieDay {
  date: string;
  calories: number;
  /** `calories - goal`; negative is under the target. */
  delta: number;
  /** True when the day landed at or under the target. */
  onTarget: boolean;
}

export interface CaloriesVsTarget {
  /** One entry per LOGGED day inside the window, oldest first. */
  days: CalorieDay[];
  /** The target the days were judged against (`0` when none is set). */
  goal: number;
  daysLogged: number;
  daysOnTarget: number;
  /** Mean over logged days only — never divided by the width of the window. */
  averageCalories: number;
  /** Logged day CLOSEST to the target in either direction; ties → earliest. */
  best: CalorieDay | null;
  /** Logged day FURTHEST from the target in either direction; ties → earliest. */
  worst: CalorieDay | null;
}

/**
 * Daily calorie totals judged against the day's target.
 *
 * Only days carrying at least one meal are included: a day nobody logged is
 * absent, not a zero-calorie day, and averaging it in would drag every figure
 * toward zero.
 *
 * "Best" and "worst" are the days nearest and furthest from the target in
 * EITHER direction, not the lowest and highest intakes. Under-eating by 900
 * kcal is a miss too, and ranking by raw intake would crown a day the member
 * barely ate as their best.
 *
 * With no target set (`goal <= 0`) nothing can be "on target": `daysOnTarget`
 * stays 0 and `delta` degrades to the raw intake, so the caller can render the
 * bars without inventing a goal line.
 */
export function caloriesVsTarget(
  meals: MealEntry[],
  goal: number,
  dayKeys: string[]
): CaloriesVsTarget {
  const target = Number.isFinite(goal) && goal > 0 ? goal : 0;
  const inRange = new Set(dayKeys);

  const byDay = new Map<string, MealEntry[]>();
  for (const entry of meals ?? []) {
    if (!entry || !inRange.has(entry.date)) continue;
    byDay.set(entry.date, [...(byDay.get(entry.date) ?? []), entry]);
  }

  // Walk `dayKeys` (already oldest-first) so the series is chronological and a
  // duplicated key cannot emit the same day twice.
  const seen = new Set<string>();
  const days: CalorieDay[] = [];
  for (const date of dayKeys ?? []) {
    if (seen.has(date)) continue;
    seen.add(date);
    const entries = byDay.get(date);
    if (!entries || entries.length === 0) continue;
    const calories = Math.round(sumNutrition(entries).calories);
    days.push({
      date,
      calories,
      delta: calories - target,
      onTarget: target > 0 && calories <= target,
    });
  }

  if (days.length === 0) {
    return {
      days,
      goal: target,
      daysLogged: 0,
      daysOnTarget: 0,
      averageCalories: 0,
      best: null,
      worst: null,
    };
  }

  let best = days[0];
  let worst = days[0];
  for (const day of days) {
    // Strict `<` / `>` keeps the EARLIEST day on a tie.
    if (Math.abs(day.delta) < Math.abs(best.delta)) best = day;
    if (Math.abs(day.delta) > Math.abs(worst.delta)) worst = day;
  }

  return {
    days,
    goal: target,
    daysLogged: days.length,
    daysOnTarget: days.filter((day) => day.onTarget).length,
    averageCalories: Math.round(days.reduce((sum, day) => sum + day.calories, 0) / days.length),
    best,
    worst,
  };
}

/**
 * Calorie days as chart bars: date labels (thinned, never an index) and a fill
 * that carries whether the day cleared the target.
 *
 * The over/under colors are a STATUS encoding, so the component must ship the
 * legend that names them — colour alone is not an accessible way to say "this
 * day went over".
 *
 * ONE BAR PER DAY, so it is only safe below about a dozen days: a bar has a
 * minimum readable width and ninety of them run off the plot rather than
 * shrinking to fit. `energySeries` + `energyIntakeBars` are the same reading
 * blocked to a width that fits, and are what the Calories dashboard draws;
 * this stays for callers that already know their range is short.
 */
export function calorieBars(
  days: CalorieDay[],
  palette: { onTarget: string; over: string },
  maxLabels: number = MAX_AXIS_LABELS
): AppBarDatum[] {
  const every = labelEveryFor(days?.length ?? 0, maxLabels);
  return (days ?? []).map((day, index) => ({
    value: day.calories,
    label: index % every === 0 ? formatAxisDate(day.date) : '',
    frontColor: day.onTarget ? palette.onTarget : palette.over,
  }));
}

/* ------------------------------------------------------------------ */
/* Energy balance — consumed vs burned vs goal                         */
/* ------------------------------------------------------------------ */

/**
 * What "burned" means in this app, stated once so every caller says the same
 * thing to the member.
 *
 * The donor reads `activeBurned` (and a `totalBurned` that adds resting energy)
 * from HealthKit, so a day with no workout still carries a real burn figure.
 * Here the only source is the sessions the member logged themselves, which
 * makes a zero AMBIGUOUS in a way the donor's is not: it can mean "I did
 * nothing" or "I did something and never wrote it down". That ambiguity cannot
 * be resolved from the data, so it is disclosed in words next to every chart
 * that shows burn, and `daysWithBurn` is surfaced so the reader can see how
 * much of the range actually carries a session.
 */
export const BURN_SOURCE_NOTE =
  'Burn counts only the sessions you logged. A day with no session shows no burn — ' +
  'which is not the same as burning nothing.';

export interface EnergyDay {
  date: string;
  /** kcal eaten (meals logged that day). */
  consumed: number;
  /** kcal burned in LOGGED sessions that day; `0` when none was recorded. */
  burned: number;
  /** `consumed - burned` — the donor's `CaloriesDayData.net`. */
  net: number;
  /**
   * `net - goal`: negative finished the day under target, positive over it.
   * `null` with no target set, because there is nothing to be under.
   */
  balance: number | null;
}

export interface EnergyBalance {
  /** One entry per day carrying a meal OR a session, oldest first. */
  days: EnergyDay[];
  goal: number;
  daysLogged: number;
  /** Days inside the window with at least one logged session. */
  daysWithBurn: number;
  averageConsumed: number;
  /** Mean over `daysLogged` — a logged day with no session counts as 0 burn. */
  averageBurned: number;
  averageNet: number;
  /** Sum of every day's `balance`; negative is a net deficit. `null` with no goal. */
  totalBalance: number | null;
  /** Days that finished under target (`balance < 0`). */
  deficitDays: number;
  /** Days that finished over it. */
  surplusDays: number;
}

const EMPTY_ENERGY_BALANCE: Omit<EnergyBalance, 'goal'> = {
  days: [],
  daysLogged: 0,
  daysWithBurn: 0,
  averageConsumed: 0,
  averageBurned: 0,
  averageNet: 0,
  totalBalance: null,
  deficitDays: 0,
  surplusDays: 0,
};

/**
 * The donor's `CaloriesChartWidget` read: intake, burn, net and the balance
 * against the daily target, per day and across the range.
 *
 * Only days carrying a MEAL are included. A session logged on a day with no
 * food is real data, but it cannot be turned into a net or a balance — "you
 * burned 400 and ate nothing recorded" is a gap in the log, not a 400 kcal
 * deficit — and plotting it would draw a zero-intake day the member never had.
 * Days with nothing at all are absent rather than zero, so no figure here is
 * ever divided by an untouched day.
 *
 * `balance` is `net - goal` rather than the donor's `goal - consumed`: burn has
 * to be in the number that answers "am I losing weight?", and keeping the sign
 * so that NEGATIVE means under target lets it be drawn as diverging bars from a
 * real zero instead of read off against a rule.
 */
export function energyBalance(
  meals: MealEntry[],
  workouts: WorkoutEntry[],
  goal: number,
  dayKeys: string[]
): EnergyBalance {
  const target = Number.isFinite(goal) && goal > 0 ? goal : 0;
  const inRange = new Set(dayKeys ?? []);

  const mealsByDay = new Map<string, MealEntry[]>();
  for (const entry of meals ?? []) {
    if (!entry || !inRange.has(entry.date)) continue;
    mealsByDay.set(entry.date, [...(mealsByDay.get(entry.date) ?? []), entry]);
  }

  const burnByDay = new Map<string, number>();
  for (const entry of workouts ?? []) {
    if (!entry || !inRange.has(entry.date)) continue;
    const calories = Number.isFinite(entry.calories) ? Math.max(0, entry.calories) : 0;
    burnByDay.set(entry.date, (burnByDay.get(entry.date) ?? 0) + calories);
  }

  // Walk `dayKeys` (oldest first) so the series is chronological and a repeated
  // key cannot emit the same day twice.
  const seen = new Set<string>();
  const days: EnergyDay[] = [];
  for (const date of dayKeys ?? []) {
    if (seen.has(date)) continue;
    seen.add(date);
    const entries = mealsByDay.get(date);
    if (!entries || entries.length === 0) continue;
    const burned = Math.round(burnByDay.get(date) ?? 0);
    const consumed = Math.round(sumNutrition(entries).calories);
    const net = consumed - burned;
    days.push({ date, consumed, burned, net, balance: target > 0 ? net - target : null });
  }

  if (days.length === 0) return { ...EMPTY_ENERGY_BALANCE, goal: target };

  const totals = days.reduce(
    (acc, day) => ({
      consumed: acc.consumed + day.consumed,
      burned: acc.burned + day.burned,
      net: acc.net + day.net,
    }),
    { consumed: 0, burned: 0, net: 0 }
  );

  return {
    days,
    goal: target,
    daysLogged: days.length,
    daysWithBurn: days.filter((day) => day.burned > 0).length,
    averageConsumed: Math.round(totals.consumed / days.length),
    averageBurned: Math.round(totals.burned / days.length),
    averageNet: Math.round(totals.net / days.length),
    totalBalance: target > 0 ? days.reduce((sum, day) => sum + (day.balance ?? 0), 0) : null,
    deficitDays: days.filter((day) => day.balance !== null && day.balance < 0).length,
    surplusDays: days.filter((day) => day.balance !== null && day.balance > 0).length,
  };
}

/* ------------------------------------------------------------------ */
/* Energy series — one bar per day, or per block on a wide window      */
/* ------------------------------------------------------------------ */

/**
 * The block widths a calorie chart may use, smallest first.
 *
 * A bar has a minimum readable width (`Chart.barMinWidth`), so a plot ~320pt
 * wide holds roughly a dozen bars — or half that when each x position carries a
 * PAIR of bars. Ninety daily bars do not shrink to fit; they run off the edge
 * and the last month is simply not on screen. So a wide window is aggregated
 * into blocks, and the block width is stated in words beside the chart.
 */
export const ENERGY_BLOCK_DAYS = [1, 7, 14, 28, 91] as const;

/** Bars a single-series calorie chart can show at a readable width. */
export const MAX_ENERGY_BARS = 12;
/** Clusters a two-series calorie chart can show — each is two bars wide. */
export const MAX_ENERGY_GROUPS = 7;

export interface EnergyBlock {
  /** First calendar day the block covers. */
  start: string;
  /** Last calendar day it covers (inclusive). */
  end: string;
  /** Days inside it that carry a meal — the denominator of every mean below. */
  days: number;
  /** Mean intake per LOGGED day in the block. */
  consumed: number;
  /** Mean burn per logged day (a logged day with no session counts as 0). */
  burned: number;
  net: number;
  /** `net - goal`; `null` with no target set. */
  balance: number | null;
}

export interface EnergySeries {
  /** Blocks carrying at least one logged day, oldest first. */
  blocks: EnergyBlock[];
  /** Calendar days each block covers — `1` means one bar per day. */
  blockDays: number;
  /** 1 = every block labelled, N = every Nth. */
  labelEvery: number;
  /** Plain-language disclosure of the blocking AND the thinning. */
  note: string;
}

/**
 * Daily energy figures aggregated to a width the plot can actually draw.
 *
 * Blocks tile the WINDOW (not the logged days) from the newest day backwards,
 * so the last block always ends on the last day of the window and every block
 * covers the same number of calendar days. A block with nothing logged in it is
 * dropped rather than drawn at zero — a fortnight you did not log is not a
 * fortnight you ate nothing.
 *
 * Values are per-day MEANS, never block totals, so the y-axis stays in the same
 * units as the daily goal and the goal rule keeps meaning the same thing at
 * every block width.
 */
export function energySeries(
  days: EnergyDay[],
  dayKeys: string[],
  goal: number,
  opts: { maxBuckets?: number; maxLabels?: number } = {}
): EnergySeries {
  const keys = (dayKeys ?? []).filter(isDateKey);
  const rows = (days ?? []).filter((day) => day && isDateKey(day.date));
  if (keys.length === 0 || rows.length === 0) {
    return { blocks: [], blockDays: 1, labelEvery: 1, note: '' };
  }
  const maxBuckets = Math.max(1, opts.maxBuckets ?? MAX_ENERGY_BARS);
  const target = Number.isFinite(goal) && goal > 0 ? goal : 0;

  const blockDays =
    ENERGY_BLOCK_DAYS.find((width) => Math.ceil(keys.length / width) <= maxBuckets) ??
    ENERGY_BLOCK_DAYS[ENERGY_BLOCK_DAYS.length - 1];

  const byDate = new Map(rows.map((day) => [day.date, day]));
  const blocks: EnergyBlock[] = [];
  for (let end = keys.length - 1; end >= 0; end -= blockDays) {
    const start = Math.max(0, end - blockDays + 1);
    let consumed = 0;
    let burned = 0;
    let logged = 0;
    for (let i = start; i <= end; i += 1) {
      const day = byDate.get(keys[i]);
      if (!day) continue;
      consumed += day.consumed;
      burned += day.burned;
      logged += 1;
    }
    if (logged === 0) continue;
    const meanConsumed = Math.round(consumed / logged);
    const meanBurned = Math.round(burned / logged);
    blocks.unshift({
      start: keys[start],
      end: keys[end],
      days: logged,
      consumed: meanConsumed,
      burned: meanBurned,
      net: meanConsumed - meanBurned,
      balance: target > 0 ? meanConsumed - meanBurned - target : null,
    });
  }

  const labelEvery = labelEveryFor(blocks.length, opts.maxLabels ?? MAX_AXIS_LABELS);
  const parts = [
    blockDays === 1
      ? 'One bar per logged day, labelled by date.'
      : `Each bar is a ${blockDays}-day block showing the average LOGGED day in it, ` +
        'labelled by the day the block starts. Blocks with nothing logged are left out.',
  ];
  if (labelEvery > 1) {
    parts.push(`Only every ${labelEvery}th label is drawn to keep the axis readable.`);
  }

  return { blocks, blockDays, labelEvery, note: parts.join(' ') };
}

/**
 * Intake bars, filled by whether the block landed at or under target — the
 * donor's consumed series.
 */
export function energyIntakeBars(
  series: EnergySeries,
  goal: number,
  palette: { onTarget: string; over: string }
): AppBarDatum[] {
  const target = Number.isFinite(goal) && goal > 0 ? goal : 0;
  return series.blocks.map((block, index) => ({
    value: block.consumed,
    label: index % series.labelEvery === 0 ? formatAxisDate(block.start) : '',
    frontColor: target > 0 && block.consumed <= target ? palette.onTarget : palette.over,
  }));
}

/**
 * Intake and burn side by side — the donor's two-series bar chart.
 *
 * Both series are kcal per day, so they share ONE axis; that is the point,
 * since the gap between the pair IS the net. Colour tells them apart and the
 * caller ships the legend that names both.
 */
export function energyGroupBars(
  series: EnergySeries,
  palette: { consumed: string; burned: string }
): AppBarGroup[] {
  return series.blocks.map((block, index) => ({
    label: index % series.labelEvery === 0 ? formatAxisDate(block.start) : '',
    bars: [
      { value: block.consumed, frontColor: palette.consumed },
      { value: block.burned, frontColor: palette.burned },
    ],
  }));
}

/**
 * Balance against target as DIVERGING bars from a real zero: below the line
 * finished under target after the sessions logged, above it over.
 *
 * With no target set nothing is returned rather than the raw net — a diverging
 * chart with no meaningful zero says nothing about whether the day went well.
 */
export function energyBalanceBars(
  series: EnergySeries,
  palette: { deficit: string; surplus: string }
): AppBarDatum[] {
  const scored = series.blocks.filter((block) => block.balance !== null);
  return scored.map((block, index) => ({
    value: block.balance as number,
    label: index % series.labelEvery === 0 ? formatAxisDate(block.start) : '',
    frontColor: (block.balance as number) <= 0 ? palette.deficit : palette.surplus,
  }));
}

export interface WeekComparisonKeys {
  /** The last 7 days of the window. */
  thisWeek: string[];
  /** The 7 days immediately before those — outside the window when it is short. */
  lastWeek: string[];
}

/**
 * The two 7-day spans the donor's "This wk" / "Last wk" rules compare.
 *
 * Anchored to the END of the window rather than to a calendar week, so the
 * comparison still means "the last seven days you are looking at" when the
 * member has navigated to a past window. `lastWeek` is derived by date, not by
 * slicing the window, so it exists even for a 7-day range — where the whole
 * point of the comparison is that the other week is off-screen.
 */
export function weekComparisonKeys(dayKeys: string[]): WeekComparisonKeys {
  const valid = (dayKeys ?? []).filter(isDateKey);
  if (valid.length === 0) return { thisWeek: [], lastWeek: [] };
  const thisWeek = valid.slice(-7);
  const anchor = thisWeek[0];
  const lastWeek: string[] = [];
  for (let back = 7; back >= 1; back -= 1) lastWeek.push(shiftDateKey(anchor, -back));
  return { thisWeek, lastWeek };
}

/**
 * Mean daily intake across `dayKeys`, over the days that carry a meal.
 * `null` when none of them do — a rule at zero would be a line the member never
 * ate along.
 */
export function averageCaloriesOver(meals: MealEntry[], dayKeys: string[]): number | null {
  const inRange = new Set(dayKeys ?? []);
  const byDay = new Map<string, MealEntry[]>();
  for (const entry of meals ?? []) {
    if (!entry || !inRange.has(entry.date)) continue;
    byDay.set(entry.date, [...(byDay.get(entry.date) ?? []), entry]);
  }
  if (byDay.size === 0) return null;
  let total = 0;
  for (const entries of byDay.values()) total += sumNutrition(entries).calories;
  return Math.round(total / byDay.size);
}

/* ------------------------------------------------------------------ */
/* Bucketed daily totals                                               */
/* ------------------------------------------------------------------ */

export interface BucketedTotals {
  bars: AppBarDatum[];
  /** Days each bar covers — 1 or 7. */
  bucketDays: number;
  /** 1 = every bar labelled, N = every Nth. */
  labelEvery: number;
  /** Plain-language disclosure of the bucketing AND the thinning. */
  note: string;
  /** True when every bar is zero (nothing logged in the window). */
  empty: boolean;
}

/** Above this many days a per-day axis is unreadable, so bars become 7-day blocks. */
const MAX_DAILY_BARS = 21;

/**
 * Daily totals as bars, aggregated into 7-day blocks once the window is too
 * wide to draw one bar per day.
 *
 * Blocks are anchored at the END of the range so the last one always finishes
 * on the newest day and no partial week is silently dropped, and every label
 * names a real date. `bucketDays` is returned rather than hidden because a
 * DAILY goal cannot be compared against a weekly bar without being multiplied
 * by it — the caller scales its own rule and says so.
 */
export function bucketedTotals(
  totalsByDay: Readonly<Record<string, number>>,
  dayKeys: string[],
  opts: { maxDailyBars?: number; maxLabels?: number } = {}
): BucketedTotals {
  const keys = (dayKeys ?? []).filter(isDateKey);
  if (keys.length === 0) {
    return { bars: [], bucketDays: 1, labelEvery: 1, note: '', empty: true };
  }
  const maxDaily = opts.maxDailyBars ?? MAX_DAILY_BARS;
  const maxLabels = opts.maxLabels ?? MAX_AXIS_LABELS;
  const bucketDays = keys.length <= maxDaily ? 1 : 7;

  const buckets: Array<{ start: string; total: number }> = [];
  for (let end = keys.length - 1; end >= 0; end -= bucketDays) {
    const start = Math.max(0, end - bucketDays + 1);
    let total = 0;
    for (let i = start; i <= end; i += 1) {
      const value = totalsByDay?.[keys[i]];
      if (Number.isFinite(value)) total += value as number;
    }
    buckets.unshift({ start: keys[start], total });
  }

  const labelEvery = labelEveryFor(buckets.length, maxLabels);
  const parts = [
    bucketDays === 1
      ? 'One bar per day, labelled by date.'
      : 'Each bar is a 7-day block, labelled by the day it starts.',
  ];
  if (labelEvery > 1) parts.push(`Only every ${labelEvery}th label is drawn to keep the axis readable.`);

  return {
    bars: buckets.map((bucket, index) => ({
      value: Math.round(bucket.total * 10) / 10,
      label: index % labelEvery === 0 ? formatAxisDate(bucket.start) : '',
    })),
    bucketDays,
    labelEvery,
    note: parts.join(' '),
    empty: buckets.every((bucket) => bucket.total <= 0),
  };
}

/* ------------------------------------------------------------------ */
/* Macro split                                                         */
/* ------------------------------------------------------------------ */

export interface MacroSplit {
  protein: number;
  carbs: number;
  fat: number;
}

/** Atwater factors — the energy one gram of each macro carries. */
export const MACRO_KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 } as const;

const MACRO_KEYS = ['protein', 'carbs', 'fat'] as const;

/**
 * Share of ENERGY contributed by each macro, as whole percentages that sum to
 * EXACTLY 100.
 *
 * The split is by calories (4/4/9), not by grams: a gram of fat carries more
 * than twice the energy of a gram of carbohydrate, so a gram split would show
 * a high-fat day as a low-fat day.
 *
 * Rounding uses the largest-remainder method. Rounding the three shares
 * independently is the classic way to publish a pie that adds to 99% or 101%:
 * 33.33/33.33/33.33 rounds to 33/33/33 and loses a point. Here the floors are
 * taken first and the leftover points handed to the largest fractional
 * remainders (ties broken by the fixed protein → carbs → fat order, so the
 * result is deterministic).
 *
 * An empty or all-zero day returns all zeros — a total of 0 is honest, whereas
 * forcing it to 100 would invent a split from nothing.
 */
export function macroSplit(totals: NutritionTotals): MacroSplit {
  const energy = {
    protein: Math.max(0, finite(totals?.protein)) * MACRO_KCAL_PER_GRAM.protein,
    carbs: Math.max(0, finite(totals?.carbs)) * MACRO_KCAL_PER_GRAM.carbs,
    fat: Math.max(0, finite(totals?.fat)) * MACRO_KCAL_PER_GRAM.fat,
  };
  const sum = energy.protein + energy.carbs + energy.fat;
  if (sum <= 0) return { protein: 0, carbs: 0, fat: 0 };

  const parts = MACRO_KEYS.map((key, order) => {
    const exact = (energy[key] / sum) * 100;
    const base = Math.floor(exact);
    return { key, order, base, remainder: exact - base };
  });

  let leftover = 100 - parts.reduce((total, part) => total + part.base, 0);
  const ranked = [...parts].sort((a, b) => b.remainder - a.remainder || a.order - b.order);
  for (let i = 0; leftover > 0; i += 1, leftover -= 1) {
    ranked[i % ranked.length].base += 1;
  }

  return {
    protein: parts[0].base,
    carbs: parts[1].base,
    fat: parts[2].base,
  };
}

export interface WeeklyMacroSplit {
  weekStart: string;
  split: MacroSplit;
  /** Days in that week carrying a meal. */
  days: number;
}

/**
 * The macro split per Monday-started week, so the member can see the shape of
 * their diet move rather than one aggregate bar. Weeks with nothing logged are
 * omitted entirely (an absent week is not a 0/0/0 week).
 */
export function weeklyMacroSplits(meals: MealEntry[], dayKeys: string[]): WeeklyMacroSplit[] {
  const inRange = new Set(dayKeys);
  const byWeek = new Map<string, { entries: MealEntry[]; days: Set<string> }>();

  for (const entry of meals ?? []) {
    if (!entry || !isDateKey(entry.date) || !inRange.has(entry.date)) continue;
    const key = heatmapWeekStart(entry.date);
    const bucket = byWeek.get(key) ?? { entries: [], days: new Set<string>() };
    bucket.entries.push(entry);
    bucket.days.add(entry.date);
    byWeek.set(key, bucket);
  }

  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, bucket]) => ({
      weekStart,
      split: macroSplit(sumNutrition(bucket.entries)),
      days: bucket.days.size,
    }));
}

/* ------------------------------------------------------------------ */
/* Logging consistency                                                 */
/* ------------------------------------------------------------------ */

/**
 * Count how many times each day key appears — the tally that drives the
 * logging-consistency heatmap. Pass every logged date from every tracker
 * (meals, workouts, weigh-ins, water, habit ticks) and each day ends up with
 * the number of things recorded on it.
 *
 * Days with nothing logged are ABSENT from the result, never zero, so the
 * heatmap can draw them as "no data" instead of "logged nothing".
 */
export function tallyDays(dates: Array<string | null | undefined>): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const date of dates ?? []) {
    if (typeof date !== 'string' || date.length === 0) continue;
    tally[date] = (tally[date] ?? 0) + 1;
  }
  return tally;
}

/**
 * Heatmap values for the days inside the window, oldest first.
 *
 * The output is SPARSE by design: only days present in `entriesByDay` are
 * emitted. `CalendarHeatmap` renders an absent day as a hairline outline and a
 * day logged as `0` as a filled chip, so dropping the untouched days is what
 * keeps "I logged nothing" distinct from "I logged a zero".
 */
export function loggingConsistency(
  entriesByDay: Readonly<Record<string, number>>,
  dayKeys: string[]
): HeatmapValue[] {
  const seen = new Set<string>();
  const out: HeatmapValue[] = [];

  for (const date of dayKeys ?? []) {
    if (!isDateKey(date) || seen.has(date)) continue;
    seen.add(date);
    const raw = entriesByDay?.[date];
    if (raw === undefined) continue;
    out.push({ date, value: Number.isFinite(raw) ? Math.max(0, raw) : 0 });
  }

  return out;
}

export interface ConsistencySummary {
  daysLogged: number;
  daysInRange: number;
  /** Logged days ÷ days in range, in [0, 1]. */
  rate: number;
  /** Longest unbroken run of logged days inside the window. */
  bestStreak: number;
}

/** Coverage headline for the consistency card — the figure its label announces. */
export function summarizeConsistency(
  values: HeatmapValue[],
  dayKeys: string[]
): ConsistencySummary {
  const logged = new Set((values ?? []).map((entry) => entry.date));
  const daysInRange = dayKeys?.length ?? 0;

  let bestStreak = 0;
  let run = 0;
  for (const date of dayKeys ?? []) {
    run = logged.has(date) ? run + 1 : 0;
    if (run > bestStreak) bestStreak = run;
  }

  return {
    daysLogged: logged.size,
    daysInRange,
    rate: daysInRange > 0 ? logged.size / daysInRange : 0,
    bestStreak,
  };
}
