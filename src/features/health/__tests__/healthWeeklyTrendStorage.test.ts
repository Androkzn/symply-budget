import type { HealthWeeklyTrendWindow } from '@api/health';

import {
  averageWeeklyWeight,
  caloriesChartPoints,
  combinedNormalizedPoints,
  latestCalorieGoal,
  weightChartPoints,
} from '../healthWeeklyTrendStorage';

function window(over: Partial<HealthWeeklyTrendWindow> = {}): HealthWeeklyTrendWindow {
  return {
    week_start: '2026-07-06',
    week_end: '2026-07-12',
    days: [],
    daily_weight: [],
    total_calories: 0,
    avg_calories: 0,
    ...over,
  };
}

describe('weightChartPoints', () => {
  it('drops a null SLOT — a day with no reading at all', () => {
    const points = weightChartPoints(
      window({
        daily_weight: [
          { date: '2026-07-06', weight: 70 },
          null,
          { date: '2026-07-08', weight: 69.5 },
        ],
      })
    );
    expect(points.map((p) => p.value)).toEqual([70, 69.5]);
  });

  // The wire type claims `weight: number`, but a live response has been seen
  // to hand back a present entry whose `weight` field is itself null — a
  // partial row, not a missing day. `formatValue={(v) => v.toFixed(1)}` in
  // HealthWeeklyTrendsWidget crashes on that null, so this guard has to sit
  // here, at the one place every consumer of this window reads through.
  it('drops an entry whose OWN weight field is null, not just a null slot', () => {
    const points = weightChartPoints(
      window({
        daily_weight: [
          { date: '2026-07-06', weight: 70 },
          { date: '2026-07-07', weight: null as unknown as number },
          { date: '2026-07-08', weight: 69.5 },
        ],
      })
    );
    expect(points.map((p) => p.value)).toEqual([70, 69.5]);
  });

  it('drops a non-finite weight the same way', () => {
    const points = weightChartPoints(
      window({
        daily_weight: [
          { date: '2026-07-06', weight: 70 },
          { date: '2026-07-07', weight: NaN },
        ],
      })
    );
    expect(points.map((p) => p.value)).toEqual([70]);
  });

  it('an absent daily_weight array is no points, not a crash', () => {
    expect(weightChartPoints(undefined)).toEqual([]);
  });
});

describe('caloriesChartPoints', () => {
  it('skips a zero-calorie day rather than drawing it as a real reading', () => {
    const points = caloriesChartPoints(
      window({
        days: [
          { date: '2026-07-06', calories: 1800, calorie_goal: 2000 },
          { date: '2026-07-07', calories: 0, calorie_goal: 2000 },
        ],
      })
    );
    expect(points.map((p) => p.value)).toEqual([1800]);
  });
});

describe('averageWeeklyWeight', () => {
  it('averages only the days actually logged, never divides by 7', () => {
    const mean = averageWeeklyWeight(
      window({
        daily_weight: [{ date: '2026-07-06', weight: 70 }, null, { date: '2026-07-08', weight: 71 }],
      })
    );
    expect(mean).toBe(70.5);
  });

  it('nothing logged is null, not zero', () => {
    expect(averageWeeklyWeight(window({ daily_weight: [null, null] }))).toBeNull();
  });
});

describe('latestCalorieGoal', () => {
  it('reads the goal off the LAST day in the window', () => {
    const goal = latestCalorieGoal(
      window({
        days: [
          { date: '2026-07-06', calories: 1800, calorie_goal: 1800 },
          { date: '2026-07-07', calories: 1900, calorie_goal: 2000 },
        ],
      })
    );
    expect(goal).toBe(2000);
  });

  it('a zero goal is undefined, not a real reference line', () => {
    const goal = latestCalorieGoal(
      window({ days: [{ date: '2026-07-06', calories: 1800, calorie_goal: 0 }] })
    );
    expect(goal).toBeUndefined();
  });
});

describe('combinedNormalizedPoints', () => {
  it('rescales both series to a shared 0–100 range and keeps the real reading as displayValue', () => {
    const combined = combinedNormalizedPoints(
      window({
        days: [
          { date: '2026-07-06', calories: 1500, calorie_goal: 2000 },
          { date: '2026-07-07', calories: 2000, calorie_goal: 2000 },
          { date: '2026-07-08', calories: 2500, calorie_goal: 2000 },
        ],
        daily_weight: [
          { date: '2026-07-06', weight: 70 },
          { date: '2026-07-07', weight: 71 },
          { date: '2026-07-08', weight: 72 },
        ],
      })
    );
    expect(combined.calories.map((p) => p.value)).toEqual([0, 50, 100]);
    expect(combined.calories.map((p) => p.displayValue)).toEqual([1500, 2000, 2500]);
    expect(combined.weight.map((p) => p.value)).toEqual([0, 50, 100]);
    expect(combined.weight.map((p) => p.displayValue)).toEqual([70, 71, 72]);
  });

  it('drops a day missing EITHER measurement, never interpolates', () => {
    const combined = combinedNormalizedPoints(
      window({
        days: [
          { date: '2026-07-06', calories: 1500, calorie_goal: 2000 },
          { date: '2026-07-07', calories: 0, calorie_goal: 2000 }, // no calories logged
          { date: '2026-07-08', calories: 2500, calorie_goal: 2000 },
        ],
        daily_weight: [
          { date: '2026-07-06', weight: 70 },
          { date: '2026-07-07', weight: 71 },
          null, // no weight logged
        ],
      })
    );
    expect(combined.calories.map((p) => p.displayValue)).toEqual([1500]);
    expect(combined.weight.map((p) => p.displayValue)).toEqual([70]);
  });

  it('a flat week (no range to show) sits every point mid-scale, never divides by zero', () => {
    const combined = combinedNormalizedPoints(
      window({
        days: [
          { date: '2026-07-06', calories: 2000, calorie_goal: 2000 },
          { date: '2026-07-07', calories: 2000, calorie_goal: 2000 },
        ],
        daily_weight: [
          { date: '2026-07-06', weight: 70 },
          { date: '2026-07-07', weight: 70 },
        ],
      })
    );
    expect(combined.calories.map((p) => p.value)).toEqual([50, 50]);
    expect(combined.weight.map((p) => p.value)).toEqual([50, 50]);
  });

  it('no overlapping day is empty arrays, not a crash', () => {
    expect(combinedNormalizedPoints(undefined)).toEqual({ calories: [], weight: [] });
    expect(
      combinedNormalizedPoints(
        window({
          days: [{ date: '2026-07-06', calories: 0, calorie_goal: 2000 }],
          daily_weight: [null],
        })
      )
    ).toEqual({ calories: [], weight: [] });
  });
});
