/**
 * Symply Health — Trends analytics (pure derivations).
 *
 * Two rules are load-bearing and asserted throughout:
 *  1. never mix weight units on one axis, and
 *  2. average over days that were LOGGED, not over the whole range.
 * Both keep a sparse diary from reading as a collapse in the numbers.
 */

import { recentDayKeys } from '../healthActivityStorage';
import type { StepDay, WorkoutEntry } from '../healthActivityStorage';
import { streakOf, type Habit } from '../healthHabitsStorage';
import type { WaterDay, WeightEntry } from '../healthLocalStorage';
import type { MealEntry } from '../healthNutritionStorage';
import {
  buildWeightSeries,
  formatAxisDate,
  summarizeActivityTrend,
  summarizeHabitTrend,
  summarizeHydrationTrend,
  summarizeNutritionTrend,
  TREND_RANGES,
} from '../healthTrends';

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

/** Local noon on a given day → an ISO stamp whose local date key is that day. */
function at(day: number, hour = 12): string {
  return new Date(2026, 6, day, hour, 0, 0).toISOString();
}

function weight(day: number, value: number, unit: WeightEntry['unit'] = 'kg'): WeightEntry {
  const loggedAt = at(day);
  // Derived from the constructed Date rather than formatted from `day`: the
  // suite passes NEGATIVE day numbers to reach into the previous month, which
  // `new Date` normalises and a string template would not.
  const taken = new Date(2026, 6, day, 12, 0, 0);
  const date = `${taken.getFullYear()}-${String(taken.getMonth() + 1).padStart(2, '0')}-${String(
    taken.getDate()
  ).padStart(2, '0')}`;
  return { id: loggedAt, value, unit, loggedAt, date, note: '', source: 'manual' };
}

function meal(date: string, calories: number, protein = 0): MealEntry {
  return {
    id: `${date}-${calories}`,
    date,
    slot: 'lunch',
    name: 'Meal',
    calories,
    protein,
    carbs: 0,
    fat: 0,
    loggedAt: `${date}T10:00:00.000Z`,
  };
}

function workout(date: string, minutes: number, calories = 0): WorkoutEntry {
  return { distanceM: null, startedAt: null,
    id: `${date}-${minutes}`,
    date,
    type: 'walk',
    minutes,
    calories,
    intensity: 'steady',
    note: '',
    loggedAt: `${date}T10:00:00.000Z`,
  };
}

function steps(date: string, count: number): StepDay {
  return { date, steps: count };
}

function water(date: string, cups: number, target = 8): WaterDay {
  return { date, cups, target };
}

function habit(id: string, days: string[]): Habit {
  return { category: 'custom', templateId: null, timeOfDay: 'anytime', frequency: 'daily', customDays: null, reminderTime: null, reminderEnabled: false, targetDuration: null, notes: null, archived: false, sortOrder: 0, id, name: id, icon: 'goals', days, createdAt: at(1) };
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('healthTrends — contract', () => {
  it('HEALTH-TREND-001: offers the 7 / 30 / 90 day ranges', () => {
    expect(TREND_RANGES).toEqual([7, 30, 90]);
  });

  it('HEALTH-TREND-002: axis labels are dates, never bare indices', () => {
    expect(formatAxisDate('2026-07-13')).toBe('13 Jul');
    expect(formatAxisDate('2026-01-01')).toBe('1 Jan');
  });
});

describe('healthTrends — buildWeightSeries', () => {
  it('HEALTH-TREND-003: plots one point per logged day, oldest-first', () => {
    const series = buildWeightSeries(
      [weight(13, 79), weight(12, 80), weight(11, 81)],
      recentDayKeys(7),
    );
    expect(series.points.map((p) => p.value)).toEqual([81, 80, 79]);
    expect(series.first).toBe(81);
    expect(series.last).toBe(79);
    expect(series.change).toBe(-2);
    expect(series.average).toBe(80);
    expect(series.unit).toBe('kg');
  });

  it('HEALTH-TREND-004: keeps the newest reading when a day has several', () => {
    const early = { ...weight(13, 82), loggedAt: at(13, 7) };
    const late = { ...weight(13, 79), loggedAt: at(13, 20) };
    // Entries arrive newest-first from the store.
    const series = buildWeightSeries([late, early], recentDayKeys(7));
    expect(series.points.map((p) => p.value)).toEqual([79]);
  });

  it('HEALTH-TREND-005: excludes readings in another unit — no converted phantom jump', () => {
    const series = buildWeightSeries(
      [weight(13, 79, 'kg'), weight(12, 176, 'lb'), weight(11, 81, 'kg')],
      recentDayKeys(7),
    );
    expect(series.unit).toBe('kg');
    expect(series.points.map((p) => p.value)).toEqual([81, 79]);
  });

  it('HEALTH-TREND-006: ignores entries outside the range', () => {
    const series = buildWeightSeries([weight(13, 79), weight(1, 85)], recentDayKeys(7));
    expect(series.points).toHaveLength(1);
  });

  it('HEALTH-TREND-007: an empty log yields an empty, null-safe series', () => {
    const series = buildWeightSeries([], recentDayKeys(30));
    expect(series.points).toEqual([]);
    expect(series.unit).toBeNull();
    expect(series.first).toBeNull();
    expect(series.last).toBeNull();
    expect(series.average).toBeNull();
    expect(series.change).toBeNull();
    expect(series.labelEvery).toBe(1);
  });

  it('HEALTH-TREND-008: thins the axis past 8 points and reports the sampling', () => {
    // 20 consecutive days ending today (crosses the month boundary backwards).
    const many = Array.from({ length: 20 }, (_, i) => weight(13 - i, 80 + i));
    const series = buildWeightSeries(many, recentDayKeys(30));
    expect(series.points).toHaveLength(20);
    expect(series.labelEvery).toBe(3); // ceil(20 / 8)
    const labelled = series.points.filter((p) => p.label !== undefined);
    expect(labelled).toHaveLength(7);
    // The screen must disclose the sampling whenever labelEvery > 1.
    expect(series.labelEvery).toBeGreaterThan(1);
  });

  it('HEALTH-TREND-009: labels every point when the series is short enough', () => {
    const series = buildWeightSeries([weight(13, 79), weight(12, 80)], recentDayKeys(7));
    expect(series.labelEvery).toBe(1);
    expect(series.points.every((p) => typeof p.label === 'string')).toBe(true);
  });
});

describe('healthTrends — nutrition', () => {
  it('HEALTH-TREND-010: averages over logged days only, not the whole range', () => {
    // 2 logged days inside a 30-day window: the average must be 500, not 33.
    const trend = summarizeNutritionTrend(
      [meal(TODAY, 300, 20), meal(TODAY, 200, 10), meal('2026-07-12', 500, 30)],
      recentDayKeys(30),
    );
    expect(trend.daysLogged).toBe(2);
    expect(trend.averageCalories).toBe(500);
    expect(trend.averageProtein).toBe(30);
  });

  it('HEALTH-TREND-011: reports the highest-calorie day', () => {
    const trend = summarizeNutritionTrend(
      [meal(TODAY, 300), meal('2026-07-12', 900)],
      recentDayKeys(30),
    );
    expect(trend.bestDay).toEqual({ date: '2026-07-12', calories: 900 });
  });

  it('HEALTH-TREND-012: an empty range reports zeroes and no best day', () => {
    expect(summarizeNutritionTrend([], recentDayKeys(7))).toEqual({
      daysLogged: 0,
      averageCalories: 0,
      averageProtein: 0,
      bestDay: null,
    });
  });

  it('HEALTH-TREND-013: excludes days outside the range', () => {
    const trend = summarizeNutritionTrend([meal('2026-01-01', 900)], recentDayKeys(7));
    expect(trend.daysLogged).toBe(0);
  });
});

describe('healthTrends — activity', () => {
  it('HEALTH-TREND-014: totals sessions, minutes, calories and distinct active days', () => {
    const trend = summarizeActivityTrend(
      [workout(TODAY, 30, 100), workout(TODAY, 20, 80), workout('2026-07-12', 45, 200)],
      [steps(TODAY, 6000), steps('2026-07-12', 4000)],
      recentDayKeys(7),
    );
    expect(trend).toEqual({
      workouts: 3,
      minutes: 95,
      calories: 380,
      activeDays: 2,
      averageSteps: 5000,
    });
  });

  it('HEALTH-TREND-015: averages steps over days with a count, ignoring zero days', () => {
    const trend = summarizeActivityTrend(
      [],
      [steps(TODAY, 6000), steps('2026-07-12', 0)],
      recentDayKeys(7),
    );
    expect(trend.averageSteps).toBe(6000);
  });

  it('HEALTH-TREND-016: an empty range reports zeroes', () => {
    expect(summarizeActivityTrend([], [], recentDayKeys(7))).toEqual({
      workouts: 0,
      minutes: 0,
      calories: 0,
      activeDays: 0,
      averageSteps: 0,
    });
  });
});

describe('healthTrends — hydration', () => {
  it('HEALTH-TREND-017: counts goal-hitting days and averages the tracked ones', () => {
    const trend = summarizeHydrationTrend(
      [water(TODAY, 8), water('2026-07-12', 5), water('2026-07-11', 0)],
      recentDayKeys(7),
    );
    expect(trend).toEqual({ daysTracked: 2, goalDays: 1, averageCups: 6.5 });
  });

  it('HEALTH-TREND-018: an untracked range reports zeroes rather than NaN', () => {
    expect(summarizeHydrationTrend([], recentDayKeys(7))).toEqual({
      daysTracked: 0,
      goalDays: 0,
      averageCups: 0,
    });
  });
});

describe('healthTrends — habits', () => {
  it('HEALTH-TREND-019: reports the best streak, its habit, and the completion rate', () => {
    const trend = summarizeHabitTrend(
      [habit('sleep', ['2026-07-13', '2026-07-12']), habit('move', ['2026-07-13'])],
      recentDayKeys(7),
      streakOf,
    );
    expect(trend.habits).toBe(2);
    expect(trend.bestStreak).toBe(2);
    expect(trend.bestHabit).toBe('sleep');
    // 3 ticks ÷ (2 habits × 7 days).
    expect(trend.completionRate).toBeCloseTo(3 / 14);
  });

  it('HEALTH-TREND-020: no habits, or no streak, reports no best habit', () => {
    expect(summarizeHabitTrend([], recentDayKeys(7), streakOf)).toEqual({
      habits: 0,
      bestStreak: 0,
      bestHabit: null,
      completionRate: 0,
    });
    const stale = summarizeHabitTrend([habit('sleep', ['2026-01-01'])], recentDayKeys(7), streakOf);
    expect(stale.bestStreak).toBe(0);
    expect(stale.bestHabit).toBeNull();
  });

  it('HEALTH-TREND-021: an empty range never divides by zero', () => {
    expect(summarizeHabitTrend([habit('sleep', [])], [], streakOf).completionRate).toBe(0);
  });
});
