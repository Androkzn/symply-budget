import {
  healthApi,
  type HealthWeeklyTrendResponse,
  type HealthWeeklyTrendWindow,
} from '@api/health';
import type { AppLinePoint } from '@components/ui/AppLineChart';

import { readThrough } from './healthRepository';
import { formatAxisDate } from './healthTrends';

/**
 * Symply Health — Dashboard "Weekly Trends" widget (donor
 * `WeeklyTrendChartWidget`): calories and weight, this week against last, from
 * the single `GET /health/summary/weekly-trend` summary endpoint.
 *
 * Read-only (there is nothing to write here — the widget only ever displays
 * what the calorie/weight logs already say), so this is a thin `readThrough`
 * wrapper rather than a full CRUD module.
 */

export const HEALTH_WEEKLY_TREND_KEY = 'health.weeklyTrend.v1';

export type { HealthWeeklyTrendResponse, HealthWeeklyTrendWindow };

/** `date` anchors "this week" to the same local day every other Home figure uses. */
export async function loadWeeklyTrend(date?: string): Promise<HealthWeeklyTrendResponse | null> {
  return readThrough(HEALTH_WEEKLY_TREND_KEY, () => healthApi.getWeeklyTrend(date), null);
}

/* ------------------------------------------------------------------ */
/* Pure derivations — unit-testable without rendering a chart          */
/* ------------------------------------------------------------------ */

/**
 * Mean of the days a window actually has a weight reading for — never divided
 * by 7. `null` when nothing was logged that week, so a caller can say so in
 * words rather than drawing a misleading zero.
 */
export function averageWeeklyWeight(window: HealthWeeklyTrendWindow | undefined): number | null {
  const values = (window?.daily_weight ?? [])
    .filter((entry): entry is { date: string; weight: number } => entry !== null)
    .map((entry) => entry.weight)
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(mean * 10) / 10;
}

/**
 * Calorie points for the chart, one per LOGGED day — a day with nothing eaten
 * is a gap (skipped), never a zero bar, mirroring the donor's own rule
 * ("Days with zero/no data are skipped, not interpolated").
 */
export function caloriesChartPoints(window: HealthWeeklyTrendWindow | undefined): AppLinePoint[] {
  return (window?.days ?? [])
    .filter((day) => day.calories > 0)
    .map((day) => ({ value: day.calories, label: formatAxisDate(day.date) }));
}

/** Weight points for the chart — `null` slots (no reading that day) are gaps, not zeros. */
export function weightChartPoints(window: HealthWeeklyTrendWindow | undefined): AppLinePoint[] {
  return (window?.daily_weight ?? [])
    .filter(
      (entry): entry is { date: string; weight: number } =>
        entry !== null && Number.isFinite(entry.weight)
    )
    .map((entry) => ({ value: entry.weight, label: formatAxisDate(entry.date) }));
}

/** The most recent day's calorie goal in the window — the chart's reference rule. */
export function latestCalorieGoal(window: HealthWeeklyTrendWindow | undefined): number | undefined {
  const days = window?.days ?? [];
  const last = days[days.length - 1];
  return last && last.calorie_goal > 0 ? last.calorie_goal : undefined;
}

export interface CombinedTrendPoints {
  calories: AppLinePoint[];
  weight: AppLinePoint[];
}

/**
 * Calories and weight rescaled onto a SHARED 0–100 axis, for the "compare on
 * one chart" toggle. The two series live in wildly different units (hundreds
 * to thousands of kcal vs. a two- or three-digit weight), so plotting them on
 * one raw y-axis would flatten whichever is smaller into a near-straight line.
 *
 * Only days with BOTH a logged calorie total and a weight reading are
 * included — a day missing either measurement has nothing to compare against,
 * so it is skipped rather than faked with an interpolated value, the same
 * "gap, not zero" rule `caloriesChartPoints`/`weightChartPoints` already
 * follow. `days` and `daily_weight` are both 7 entries, oldest first,
 * index-aligned to the same calendar day — that alignment is what lets the
 * two rescaled series share one x-axis without a per-date lookup.
 *
 * Each point's real reading survives as `displayValue`, so a "show values"
 * label still reads as the true kcal/weight figure, not the 0–100 position.
 */
export function combinedNormalizedPoints(
  window: HealthWeeklyTrendWindow | undefined
): CombinedTrendPoints {
  const days = window?.days ?? [];
  const dailyWeight = window?.daily_weight ?? [];

  const rows = days
    .map((day, index) => {
      const weightEntry = dailyWeight[index];
      const calories = day.calories > 0 ? day.calories : null;
      const weight = weightEntry && Number.isFinite(weightEntry.weight) ? weightEntry.weight : null;
      return { date: day.date, calories, weight };
    })
    .filter(
      (row): row is { date: string; calories: number; weight: number } =>
        row.calories !== null && row.weight !== null
    );

  if (rows.length === 0) return { calories: [], weight: [] };

  // Min-max to 0–100. A flat week (min === max) has no shape to show, so every
  // point sits mid-scale rather than dividing by zero.
  const normalize = (values: number[]): number[] => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return max === min ? values.map(() => 50) : values.map((v) => ((v - min) / (max - min)) * 100);
  };

  const caloriesNormalized = normalize(rows.map((row) => row.calories));
  const weightNormalized = normalize(rows.map((row) => row.weight));

  return {
    calories: rows.map((row, index) => ({
      value: caloriesNormalized[index],
      displayValue: row.calories,
      label: formatAxisDate(row.date),
    })),
    weight: rows.map((row, index) => ({
      value: weightNormalized[index],
      displayValue: row.weight,
      label: formatAxisDate(row.date),
    })),
  };
}
