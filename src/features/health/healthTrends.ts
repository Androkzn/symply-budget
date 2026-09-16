import type { AppBarDatum } from '@components/ui/AppBarChart';
import type { AppLinePoint } from '@components/ui/AppLineChart';

import type { StepDay, WorkoutEntry } from './healthActivityStorage';
import type { Habit } from './healthHabitsStorage';
import { weightDayOf, type WaterDay, type WeightEntry, type WeightUnit } from './healthLocalStorage';
import { sumNutrition, type MealEntry } from './healthNutritionStorage';

/**
 * Symply Health — Trends analytics.
 *
 * Pure functions only: every screen figure is derived here so it can be
 * unit-tested without rendering, and so the same rule ("never mix units, never
 * average a day that was never logged") is applied identically everywhere.
 */

export const TREND_RANGES = [7, 30, 90] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

/** Max x-axis labels before the series is thinned (a 90-day axis is unreadable). */
const MAX_AXIS_LABELS = 8;

export interface WeightSeries {
  points: AppLinePoint[];
  unit: WeightUnit | null;
  /** 1 = every point labelled; N = every Nth. Callers must disclose N > 1. */
  labelEvery: number;
  first: number | null;
  last: number | null;
  average: number | null;
  change: number | null;
}

/** `12 Mar` — short, unambiguous, and never a bare index. */
export function formatAxisDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const d = new Date(year, (month ?? 1) - 1, day ?? 1);
  return `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}`;
}

/**
 * One weight point per logged day, oldest-first.
 *
 * Only entries sharing the LATEST entry's unit are plotted — a kg reading and a
 * lb reading on one axis would draw a jump that never happened.
 */
export function buildWeightSeries(entries: WeightEntry[], dayKeys: string[]): WeightSeries {
  const inRange = new Set(dayKeys);
  const unit = entries[0]?.unit ?? null;
  const relevant = entries.filter((e) => e.unit === unit && inRange.has(weightDayOf(e)));

  // Newest wins per day: `entries` arrive newest-first, so the first hit stays.
  const byDay = new Map<string, number>();
  for (const entry of relevant) {
    const key = weightDayOf(entry);
    if (!byDay.has(key)) byDay.set(key, entry.value);
  }

  const ordered = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const labelEvery = Math.max(1, Math.ceil(ordered.length / MAX_AXIS_LABELS));
  const points: AppLinePoint[] = ordered.map(([key, value], index) => ({
    value,
    label: index % labelEvery === 0 ? formatAxisDate(key) : undefined,
  }));

  const values = ordered.map(([, value]) => value);
  const first = values.length > 0 ? values[0] : null;
  const last = values.length > 0 ? values[values.length - 1] : null;
  const average =
    values.length > 0
      ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10
      : null;

  return {
    points,
    unit,
    labelEvery,
    first,
    last,
    average,
    change: first !== null && last !== null ? Math.round((last - first) * 10) / 10 : null,
  };
}

export interface NutritionTrend {
  daysLogged: number;
  averageCalories: number;
  averageProtein: number;
  bestDay: { date: string; calories: number } | null;
}

/**
 * Averages are over days that were actually logged, not over the whole range —
 * dividing by untouched days would understate every figure.
 */
export function summarizeNutritionTrend(meals: MealEntry[], dayKeys: string[]): NutritionTrend {
  const inRange = new Set(dayKeys);
  const byDay = new Map<string, MealEntry[]>();
  for (const entry of meals) {
    if (!inRange.has(entry.date)) continue;
    byDay.set(entry.date, [...(byDay.get(entry.date) ?? []), entry]);
  }

  const days = [...byDay.entries()].map(([date, entries]) => ({
    date,
    totals: sumNutrition(entries),
  }));
  if (days.length === 0) {
    return { daysLogged: 0, averageCalories: 0, averageProtein: 0, bestDay: null };
  }

  const best = days.reduce((top, day) => (day.totals.calories > top.totals.calories ? day : top));
  return {
    daysLogged: days.length,
    averageCalories: Math.round(
      days.reduce((s, d) => s + d.totals.calories, 0) / days.length,
    ),
    averageProtein: Math.round(days.reduce((s, d) => s + d.totals.protein, 0) / days.length),
    bestDay: { date: best.date, calories: best.totals.calories },
  };
}

export interface ActivityTrend {
  workouts: number;
  minutes: number;
  calories: number;
  activeDays: number;
  averageSteps: number;
}

export function summarizeActivityTrend(
  workouts: WorkoutEntry[],
  steps: StepDay[],
  dayKeys: string[],
): ActivityTrend {
  const inRange = new Set(dayKeys);
  const w = workouts.filter((entry) => inRange.has(entry.date));
  const s = steps.filter((day) => inRange.has(day.date) && day.steps > 0);
  return {
    workouts: w.length,
    minutes: w.reduce((sum, e) => sum + e.minutes, 0),
    calories: w.reduce((sum, e) => sum + e.calories, 0),
    activeDays: new Set(w.map((e) => e.date)).size,
    averageSteps: s.length > 0 ? Math.round(s.reduce((sum, d) => sum + d.steps, 0) / s.length) : 0,
  };
}

export interface HydrationTrend {
  daysTracked: number;
  goalDays: number;
  averageCups: number;
}

export function summarizeHydrationTrend(history: WaterDay[], dayKeys: string[]): HydrationTrend {
  const inRange = new Set(dayKeys);
  const days = history.filter((d) => inRange.has(d.date) && d.cups > 0);
  if (days.length === 0) return { daysTracked: 0, goalDays: 0, averageCups: 0 };
  return {
    daysTracked: days.length,
    goalDays: days.filter((d) => d.cups >= d.target).length,
    averageCups: Math.round((days.reduce((s, d) => s + d.cups, 0) / days.length) * 10) / 10,
  };
}

export interface HabitTrend {
  habits: number;
  bestStreak: number;
  bestHabit: string | null;
  completionRate: number;
}

/** Completion rate = ticks landed inside the range ÷ (habits × days in range). */
export function summarizeHabitTrend(
  habits: Habit[],
  dayKeys: string[],
  streakOf: (days: string[]) => number,
): HabitTrend {
  if (habits.length === 0 || dayKeys.length === 0) {
    return { habits: 0, bestStreak: 0, bestHabit: null, completionRate: 0 };
  }
  const inRange = new Set(dayKeys);
  const ticks = habits.reduce(
    (sum, habit) => sum + habit.days.filter((d) => inRange.has(d)).length,
    0,
  );
  // The empty case returned above, so there is always a top-ranked habit — no
  // `?? 0` fallback that could quietly stand in for a real zero streak.
  const [top] = habits
    .map((habit) => ({ habit, streak: streakOf(habit.days) }))
    .sort((a, b) => b.streak - a.streak);
  return {
    habits: habits.length,
    bestStreak: top.streak,
    // A best streak of 0 names nobody: every habit is equally "best".
    bestHabit: top.streak > 0 ? top.habit.name : null,
    completionRate: ticks / (habits.length * dayKeys.length),
  };
}

/* ------------------------------------------------------------------ */
/* Habit statistics — the donor's `HabitStatisticsView`                 */
/* ------------------------------------------------------------------ */

/** One day of the completion-rate chart. */
export interface HabitDayPoint {
  date: string;
  /** Habits ticked that day. */
  completed: number;
  /** Habits that EXISTED that day — the honest denominator. */
  total: number;
  /** `completed / total`, in [0, 1]. */
  rate: number;
}

/** One row of the per-habit breakdown and of the streak leaderboard. */
export interface HabitLeader {
  id: string;
  name: string;
  icon: string;
  /** Days ticked inside the range. */
  completed: number;
  /** Days inside the range this habit was DUE and already existed. */
  trackedDays: number;
  rate: number;
  /** Live streak ending today (or yesterday). */
  streak: number;
  /** Longest unbroken run of DUE days inside the range. */
  bestStreak: number;
}

/**
 * The habit rules this module needs but must not import.
 *
 * `healthHabitsStorage` reaches the network at import time (`healthApi` via
 * `healthRepository`), and this file is pure derivation that the tests and the
 * coach both load without a client — so the schedule rule is INJECTED, exactly
 * as `summarizeHabitTrend` already injects `streakOf`. Passing the storage
 * module's own `isScheduledOn` / `isDoneOn` is what keeps "is this habit due
 * today?" answered in ONE place: a weekdays-only habit must not be scored as
 * missed on a Sunday here while the Habits tab says it was never due.
 */
export interface HabitRules {
  isScheduledOn: (habit: Habit, date: string) => boolean;
  isDoneOn: (habit: Habit, date: string) => boolean;
  streakOf: (days: string[]) => number;
}

export interface HabitStatistics {
  /** One point per day that had at least one habit to tick, oldest first. */
  days: HabitDayPoint[];
  /** How many days that is — never the width of the window. */
  daysCounted: number;
  /** Ticks ÷ opportunities across the whole range, in [0, 1]. */
  overallRate: number;
  /** Days every habit was ticked. */
  fullDays: number;
  /** Counted days that were not full days. */
  missedDays: number;
  /** Mean live streak across the habits, rounded. */
  averageStreak: number;
  /** Every habit, best rate first. */
  perHabit: HabitLeader[];
  /** Top three by longest run in range; habits that never ran are omitted. */
  leaders: HabitLeader[];
}

export const EMPTY_HABIT_STATISTICS: HabitStatistics = {
  days: [],
  daysCounted: 0,
  overallRate: 0,
  fullDays: 0,
  missedDays: 0,
  averageStreak: 0,
  perHabit: [],
  leaders: [],
};

/** Longest unbroken run of ticked days across `dayKeys`, in the order given. */
function longestRunIn(ticked: Set<string>, dayKeys: string[]): number {
  let best = 0;
  let run = 0;
  for (const date of dayKeys) {
    run = ticked.has(date) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/** `YYYY-MM-DD` prefix of an ISO timestamp, or `''` when it is unreadable. */
function createdDayOf(habit: Habit): string {
  const key = (habit.createdAt ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '';
}

/**
 * The donor's `HabitStatisticsView` figures, computed once.
 *
 * THREE RULES THE DONOR DOES NOT APPLY, each of which changes the picture:
 *
 * 1. **A habit only counts on the days it is DUE.** The schedule rule is
 *    injected (`rules.isScheduledOn`) rather than re-derived, so a
 *    weekdays-only habit is not scored as missed every Sunday — the donor
 *    divides by `habits.count` regardless of frequency.
 * 2. **A habit only counts from the day it was created.** Adding a habit today
 *    would otherwise drag the whole month down to a rate the member could not
 *    have achieved. An unreadable `createdAt` counts everywhere, because
 *    dropping real ticks is the worse failure.
 * 3. **A day with nothing due is ABSENT, not 0%.** Days before the first habit
 *    existed — and rest days on a custom schedule — are left out of the series
 *    rather than plotted as bars the member never had a chance to fill.
 *
 * Archived habits are excluded throughout, matching the storage module's own
 * completion rules. `overallRate` is ticks ÷ opportunities across the range,
 * not the mean of the per-habit rates, which over-weights a habit created
 * yesterday.
 */
export function habitStatistics(
  habits: Habit[],
  dayKeys: string[],
  rules: HabitRules
): HabitStatistics {
  const rows = (habits ?? []).filter(
    (habit) => habit && Array.isArray(habit.days) && !habit.archived
  );
  const keys = (dayKeys ?? []).filter((key) => typeof key === 'string' && key.length > 0);
  if (rows.length === 0 || keys.length === 0) return EMPTY_HABIT_STATISTICS;

  const startedOn = new Map<string, string>(rows.map((habit) => [habit.id, createdDayOf(habit)]));
  const counts = (habit: Habit, date: string) =>
    (startedOn.get(habit.id) ?? '') <= date && rules.isScheduledOn(habit, date);

  const days: HabitDayPoint[] = [];
  let completedTotal = 0;
  let opportunities = 0;
  for (const date of keys) {
    const due = rows.filter((habit) => counts(habit, date));
    if (due.length === 0) continue;
    const completed = due.filter((habit) => rules.isDoneOn(habit, date)).length;
    days.push({ date, completed, total: due.length, rate: completed / due.length });
    completedTotal += completed;
    opportunities += due.length;
  }

  const perHabit: HabitLeader[] = rows
    .map((habit) => {
      const tracked = keys.filter((date) => counts(habit, date));
      const ticked = new Set(habit.days);
      const completed = tracked.filter((date) => ticked.has(date)).length;
      return {
        id: habit.id,
        name: habit.name,
        icon: habit.icon,
        completed,
        trackedDays: tracked.length,
        rate: tracked.length > 0 ? completed / tracked.length : 0,
        streak: rules.streakOf(habit.days),
        // Walked over the DUE days only, so a weekdays habit ticked Mon–Fri
        // scores a run of 5 rather than being broken by the weekend.
        bestStreak: longestRunIn(ticked, tracked),
      };
    })
    .sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));

  const fullDays = days.filter((day) => day.total > 0 && day.completed === day.total).length;

  return {
    days,
    daysCounted: days.length,
    overallRate: opportunities > 0 ? completedTotal / opportunities : 0,
    fullDays,
    missedDays: days.length - fullDays,
    averageStreak:
      perHabit.length > 0
        ? Math.round(perHabit.reduce((sum, row) => sum + row.streak, 0) / perHabit.length)
        : 0,
    perHabit,
    leaders: [...perHabit]
      .sort((a, b) => b.bestStreak - a.bestStreak || a.name.localeCompare(b.name))
      .filter((row) => row.bestStreak > 0)
      .slice(0, 3),
  };
}

/**
 * The completion rate per day as PERCENTAGE bars (0–100), labelled by date.
 *
 * The chart is bounded at 100 by its caller (`axisMax`), so the values are
 * whole percents rather than fractions — a 0–1 axis with a "nice" ceiling would
 * print gridlines above 100%.
 */
export function habitRateBars(
  days: Array<{ date: string; rate: number }>,
  color: string,
  maxLabels: number = MAX_AXIS_LABELS
): AppBarDatum[] {
  const rows = days ?? [];
  const every = Math.max(1, Math.ceil(rows.length / Math.max(1, maxLabels)));
  return rows.map((day, index) => ({
    value: Math.round(day.rate * 100),
    label: index % every === 0 ? formatAxisDate(day.date) : '',
    frontColor: color,
  }));
}

/** 1 = every bar labelled, N = every Nth — the disclosure the caller must print. */
export function habitLabelEvery(count: number, maxLabels: number = MAX_AXIS_LABELS): number {
  return Math.max(1, Math.ceil(Math.max(0, count) / Math.max(1, maxLabels)));
}
