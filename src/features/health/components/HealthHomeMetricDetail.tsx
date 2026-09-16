import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet, ProgressRing, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import {
  formatDuration,
  type ActivityGoals,
  type StepDay,
  type WorkoutEntry,
} from '../healthActivityStorage';
import { BODY_METRICS, summarizeBody, type BodyEntry } from '../healthBodyStorage';
import { isDoneOn, type Habit } from '../healthHabitsStorage';
import {
  formatWeightValue,
  weightDayOf,
  type WaterDay,
  type WeightEntry,
  type WeightUnit,
} from '../healthLocalStorage';
import {
  formatDayKey,
  sumNutrition,
  type MealEntry,
  type NutritionGoals,
} from '../healthNutritionStorage';
import { formatSleepDuration, sleepHours, type SleepNight } from '../healthSleepStorage';

import { MACRO_SERIES } from './HealthMacroBreakdown';
import { HealthGoalBar } from './HealthStatTiles';
import { HealthStatRow } from './HealthWeightDashboard';

/**
 * Symply Health — Home's PER-METRIC drill-down (the donor's dashboard
 * detail views).
 *
 * The donor's dashboard does not swap tabs when you tap a stat: it presents
 * `StepsDetailView`, `BurnedCaloriesDetailView` or `SleepDetailView` — one
 * metric, its goal, a short history, and what feeds it — and the member comes
 * straight back to where they were. Home here sent every ring and every tile
 * off to a whole tab, which is a different screen, a different scroll position
 * and a different task.
 *
 * So a ring or a tile now opens the metric's OWN sheet, and the sheet carries
 * the link to the tab that owns the record. Nothing is lost — the tab is one tap
 * further away — and a member checking "how are my steps going" gets an answer
 * without leaving Home.
 *
 * SHAPE, ported from the donor's three detail views: the headline figure against
 * its goal as a ring, a short daily history, three summary figures, one sentence
 * saying where the number comes from, and the way through to the tab.
 *
 * `buildHomeMetricDetail` is PURE and does every sum — the sheet renders and
 * does no arithmetic, so a figure here cannot disagree with the same figure on
 * the card that opened it.
 */

/* ------------------------------------------------------------------ */
/* Which metrics have a detail view                                    */
/* ------------------------------------------------------------------ */

export const HOME_METRIC_KEYS = [
  'calories',
  'steps',
  'move',
  'water',
  'weight',
  'sleep',
  'habits',
  'body',
] as const;

export type HomeMetricKey = (typeof HOME_METRIC_KEYS)[number];

/**
 * The token a ring or a tile hands to `onOpenTarget`.
 *
 * `HealthDayRing.route` / `HealthGlanceCard.route` are opaque strings the caller
 * gets back verbatim, so a prefixed metric key travels the same path a route
 * does and Home's one handler tells them apart. Two of the rings (steps, move)
 * share a tab, which is exactly why the destination cannot be inferred from a
 * route alone.
 */
export const HOME_METRIC_PREFIX = 'metric:';

export function homeMetricTarget(key: HomeMetricKey): string {
  return `${HOME_METRIC_PREFIX}${key}`;
}

/** The metric a target names, or `null` when it is an ordinary route. */
export function homeMetricFromTarget(target: string): HomeMetricKey | null {
  if (typeof target !== 'string' || !target.startsWith(HOME_METRIC_PREFIX)) return null;
  const key = target.slice(HOME_METRIC_PREFIX.length);
  return (HOME_METRIC_KEYS as readonly string[]).includes(key) ? (key as HomeMetricKey) : null;
}

/* ------------------------------------------------------------------ */
/* The model                                                           */
/* ------------------------------------------------------------------ */

export interface HomeMetricPoint {
  /** `YYYY-MM-DD`. */
  date: string;
  /** `null` means NOT LOGGED — drawn as an empty slot, never as a zero. */
  value: number | null;
}

export interface HomeMetricStat {
  label: string;
  value: string;
  testID: string;
}

/** One macro bar — populated only on the `calories` detail. */
export interface HomeMetricMacro {
  label: string;
  value: number;
  target: number;
  suffix: string;
  color: string;
  testID: string;
}

export interface HomeMetricDetail {
  key: HomeMetricKey;
  title: string;
  icon: string;
  /** Which of the three fixed hues this metric owns; resolved by the sheet. */
  tone: 'warm' | 'cool' | 'primary';
  /** Headline figure, already formatted. `—` when nothing is logged. */
  value: string;
  /** The line under it — the goal, or why there is no figure. */
  caption: string;
  /** Ring fraction, or `null` when the metric has no goal to measure against. */
  progress: number | null;
  /** Oldest first. Empty when the metric has no daily history. */
  series: HomeMetricPoint[];
  /** Names the series AND its unit — a bare bar chart says nothing. */
  seriesLabel: string;
  /** Short bar label, e.g. `8.4k`. */
  formatBar: (value: number) => string;
  stats: HomeMetricStat[];
  /** Protein/carbs/fat bars against today's goals — `calories` only. */
  macros?: HomeMetricMacro[];
  /** One sentence: where this number comes from. */
  explanation: string;
  /** The tab that owns the record, when there is one. */
  route: string | null;
  routeLabel: string | null;
}

/** Everything the eight detail views read. The screen already loads all of it. */
export interface HomeMetricSources {
  /** The window, oldest first — normally the last seven days ending today. */
  dayKeys: string[];
  meals: MealEntry[];
  nutritionGoals: NutritionGoals;
  stepDays: StepDay[];
  workouts: WorkoutEntry[];
  activityGoals: ActivityGoals;
  waterToday: WaterDay | null;
  waterHistory: WaterDay[];
  weights: WeightEntry[];
  weightUnit: WeightUnit;
  sleepNights: SleepNight[];
  sleepGoalHours: number;
  habits: Habit[];
  bodyEntries: BodyEntry[];
}

/* ------------------------------------------------------------------ */
/* Small shared maths                                                  */
/* ------------------------------------------------------------------ */

/**
 * Mean of the days that WERE logged.
 *
 * Never divided by the window width: three logged days in a week are three
 * logged days, and dividing by seven would quietly report a deficit that is
 * really an absence.
 */
function averageOf(series: HomeMetricPoint[]): number | null {
  const logged = series.filter((point) => point.value !== null) as Array<{ value: number }>;
  if (logged.length === 0) return null;
  return logged.reduce((sum, point) => sum + point.value, 0) / logged.length;
}

function bestOf(series: HomeMetricPoint[]): number | null {
  const logged = series.filter((point) => point.value !== null) as Array<{ value: number }>;
  if (logged.length === 0) return null;
  return logged.reduce((best, point) => Math.max(best, point.value), logged[0].value);
}

function loggedCount(series: HomeMetricPoint[]): number {
  return series.filter((point) => point.value !== null).length;
}

function fraction(value: number | null, target: number): number | null {
  if (value === null || !Number.isFinite(target) || target <= 0) return null;
  return value / target;
}

/** `8.4k` for a big count, otherwise the rounded number. */
function shortCount(value: number): string {
  const rounded = Math.round(value);
  return rounded >= 10000 ? `${Math.round(rounded / 100) / 10}k` : String(rounded);
}

function wholeOrDash(value: number | null, suffix: string): string {
  return value === null ? '—' : `${Math.round(value)}${suffix}`;
}

/* ------------------------------------------------------------------ */
/* The builder                                                         */
/* ------------------------------------------------------------------ */

/**
 * Build one metric's detail. Pure — every figure is derived here, once.
 */
export function buildHomeMetricDetail(
  key: HomeMetricKey,
  sources: HomeMetricSources
): HomeMetricDetail {
  const { dayKeys } = sources;
  const today = dayKeys[dayKeys.length - 1] ?? '';
  const days = dayKeys.length;

  switch (key) {
    case 'calories': {
      const byDay = new Map<string, number>();
      for (const meal of sources.meals) {
        byDay.set(meal.date, (byDay.get(meal.date) ?? 0) + meal.calories);
      }
      const series: HomeMetricPoint[] = dayKeys.map((date) => ({
        date,
        value: byDay.has(date) ? Math.round(byDay.get(date) as number) : null,
      }));
      const target = sources.nutritionGoals.calories;
      const todayValue = byDay.get(today) ?? null;
      // The ring above already carries today's kcal total — this is the ONE
      // place that number's macro breakdown lives now (Home's calorie ring
      // used to draw a second, identical ring plus these same bars a few
      // cards down, restating the figure the member had just read).
      const todayMacros = sumNutrition(sources.meals.filter((meal) => meal.date === today));
      const macros: HomeMetricMacro[] = [
        {
          label: 'Protein',
          value: todayMacros.protein,
          target: sources.nutritionGoals.protein,
          suffix: 'g',
          color: MACRO_SERIES[0].color,
          testID: 'health-metric-calories-protein-bar',
        },
        {
          label: 'Carbs',
          value: todayMacros.carbs,
          target: sources.nutritionGoals.carbs,
          suffix: 'g',
          color: MACRO_SERIES[1].color,
          testID: 'health-metric-calories-carbs-bar',
        },
        {
          label: 'Fat',
          value: todayMacros.fat,
          target: sources.nutritionGoals.fat,
          suffix: 'g',
          color: MACRO_SERIES[2].color,
          testID: 'health-metric-calories-fat-bar',
        },
      ];
      return {
        key,
        title: 'Calories',
        icon: 'calories',
        tone: 'warm',
        value: todayValue === null ? '—' : `${Math.round(todayValue)}`,
        caption: target > 0 ? `of ${target} kcal today` : 'no calorie goal set',
        progress: fraction(todayValue, target),
        series,
        seriesLabel: `Calories eaten per day, last ${days} days`,
        formatBar: shortCount,
        stats: [
          {
            label: 'Today',
            value: wholeOrDash(todayValue, ' kcal'),
            testID: 'health-metric-calories-today',
          },
          {
            label: 'Average',
            value: wholeOrDash(averageOf(series), ' kcal'),
            testID: 'health-metric-calories-average',
          },
          {
            label: 'Days logged',
            value: `${loggedCount(series)}/${days}`,
            testID: 'health-metric-calories-days',
          },
        ],
        macros,
        explanation:
          'Added up from the meals you logged on the Nutrition tab. A day with no meals is left blank rather than counted as zero.',
        route: '/health-nutrition',
        routeLabel: 'Open Nutrition',
      };
    }

    case 'steps': {
      const byDay = new Map(sources.stepDays.map((day) => [day.date, day.steps]));
      const series: HomeMetricPoint[] = dayKeys.map((date) => ({
        date,
        value: byDay.has(date) ? (byDay.get(date) as number) : null,
      }));
      const target = sources.activityGoals.steps;
      const todayValue = byDay.get(today) ?? null;
      return {
        key,
        title: 'Steps',
        icon: 'steps',
        tone: 'cool',
        value: todayValue === null ? '—' : String(todayValue),
        caption: target > 0 ? `of ${target} steps today` : 'no step goal set',
        progress: fraction(todayValue, target),
        series,
        seriesLabel: `Steps per day, last ${days} days`,
        formatBar: shortCount,
        stats: [
          {
            label: 'Today',
            value: wholeOrDash(todayValue, ''),
            testID: 'health-metric-steps-today',
          },
          {
            label: 'Average',
            value: wholeOrDash(averageOf(series), ''),
            testID: 'health-metric-steps-average',
          },
          {
            label: 'Best day',
            value: wholeOrDash(bestOf(series), ''),
            testID: 'health-metric-steps-best',
          },
        ],
        explanation:
          'The count you entered on the Activity tab. Apple Health is not connected yet, so nothing is counted automatically.',
        route: '/health-activity',
        routeLabel: 'Open Activity',
      };
    }

    case 'move': {
      const byDay = new Map<string, number>();
      for (const workout of sources.workouts) {
        byDay.set(workout.date, (byDay.get(workout.date) ?? 0) + workout.minutes);
      }
      const series: HomeMetricPoint[] = dayKeys.map((date) => ({
        date,
        value: byDay.has(date) ? (byDay.get(date) as number) : null,
      }));
      const target = sources.activityGoals.minutes;
      const todayValue = byDay.get(today) ?? null;
      return {
        key,
        title: 'Move',
        icon: 'move-rings',
        tone: 'primary',
        value: todayValue === null ? '—' : String(Math.round(todayValue)),
        caption: target > 0 ? `of ${target} minutes today` : 'no move goal set',
        progress: fraction(todayValue, target),
        series,
        seriesLabel: `Active minutes per day, last ${days} days`,
        formatBar: (value) => `${Math.round(value)}`,
        stats: [
          {
            label: 'Today',
            value: todayValue === null ? '—' : formatDuration(Math.round(todayValue)),
            testID: 'health-metric-move-today',
          },
          {
            label: 'This week',
            value: formatDuration(
              Math.round(
                series.reduce((sum, point) => sum + (point.value ?? 0), 0)
              )
            ),
            testID: 'health-metric-move-total',
          },
          {
            label: 'Days moved',
            value: `${loggedCount(series)}/${days}`,
            testID: 'health-metric-move-days',
          },
        ],
        explanation:
          'Minutes from the workouts you logged on the Activity tab, added up per day.',
        route: '/health-activity',
        routeLabel: 'Open Activity',
      };
    }

    case 'water': {
      // Today's count lives on its own key (the history is rebuilt from the
      // server's per-entry rows and can lag a tap by one read), so today is
      // taken from the live day and the rest from the history.
      const byDay = new Map(sources.waterHistory.map((day) => [day.date, day.cups]));
      if (sources.waterToday) byDay.set(sources.waterToday.date, sources.waterToday.cups);
      const series: HomeMetricPoint[] = dayKeys.map((date) => ({
        date,
        value: byDay.has(date) ? (byDay.get(date) as number) : null,
      }));
      const target = sources.waterToday?.target ?? 0;
      const todayValue = byDay.get(today) ?? null;
      return {
        key,
        title: 'Water',
        icon: 'hydration',
        tone: 'cool',
        value: todayValue === null ? '0' : String(todayValue),
        caption: target > 0 ? `of ${target} cups today` : 'no water target set',
        progress: fraction(todayValue, target),
        series,
        seriesLabel: `Cups per day, last ${days} days`,
        formatBar: (value) => `${Math.round(value)}`,
        stats: [
          {
            label: 'Today',
            value: todayValue === null ? '0 cups' : `${todayValue} cups`,
            testID: 'health-metric-water-today',
          },
          {
            label: 'Average',
            value: averageOf(series) === null ? '—' : `${Math.round(averageOf(series) as number)} cups`,
            testID: 'health-metric-water-average',
          },
          {
            label: 'Days on target',
            value: `${
              series.filter((point) => target > 0 && (point.value ?? 0) >= target).length
            }/${days}`,
            testID: 'health-metric-water-ontarget',
          },
        ],
        explanation:
          'One cup is 240 ml. The count comes from the ± buttons on Home; a day you never tapped is left blank.',
        route: '/health-trends',
        routeLabel: 'Open Trends',
      };
    }

    case 'weight': {
      // One reading per day — the LAST one entered that day, which is what the
      // card above already shows.
      // Oldest first, so the LAST write per day wins — the newest reading of
      // that day, which is the one the card above already shows. `weightDayOf`
      // rather than `entry.date`: a row cached before `date` existed carries
      // only a timestamp, and every other weight surface derives the day the
      // same way.
      const byDay = new Map<string, WeightEntry>();
      for (const entry of [...sources.weights].reverse()) {
        byDay.set(weightDayOf(entry), entry);
      }
      const series: HomeMetricPoint[] = dayKeys.map((date) => ({
        date,
        value: byDay.get(date)?.value ?? null,
      }));
      const latest = sources.weights[0] ?? null;
      const first = series.find((point) => point.value !== null)?.value ?? null;
      const last = [...series].reverse().find((point) => point.value !== null)?.value ?? null;
      const change = first !== null && last !== null ? Math.round((last - first) * 10) / 10 : null;
      return {
        key,
        title: 'Weight',
        icon: 'weight',
        tone: 'primary',
        value: latest ? formatWeightValue(latest.value) : '—',
        caption: latest ? `${latest.unit} · ${formatDayKey(weightDayOf(latest))}` : 'not logged yet',
        // The target weight lives on the Weight tab's goal, which Home does not
        // read; showing a ring here would need a second source of truth for it.
        progress: null,
        series,
        seriesLabel: `Readings, last ${days} days (${sources.weightUnit})`,
        formatBar: (value) => formatWeightValue(value),
        stats: [
          {
            label: 'Latest',
            value: latest ? `${formatWeightValue(latest.value)} ${latest.unit}` : '—',
            testID: 'health-metric-weight-latest',
          },
          {
            label: 'This week',
            value:
              change === null
                ? '—'
                : `${change > 0 ? '+' : ''}${formatWeightValue(change)} ${sources.weightUnit}`,
            testID: 'health-metric-weight-change',
          },
          {
            label: 'Readings',
            value: `${loggedCount(series)}/${days}`,
            testID: 'health-metric-weight-readings',
          },
        ],
        explanation:
          'Your own weigh-ins. The weekly figure is the first reading of the window against the last — not a goal, which lives on the Weight tab.',
        route: '/health-weight',
        routeLabel: 'Open Weight',
      };
    }

    case 'sleep': {
      const byDay = new Map(sources.sleepNights.map((night) => [night.date, night.minutes]));
      const series: HomeMetricPoint[] = dayKeys.map((date) => ({
        date,
        value: byDay.has(date) ? (byDay.get(date) as number) : null,
      }));
      const goalMinutes = Math.round(sources.sleepGoalHours * 60);
      const lastLogged = [...series].reverse().find((point) => point.value !== null) ?? null;
      const average = averageOf(series);
      return {
        key,
        title: 'Sleep',
        icon: 'sleep',
        tone: 'cool',
        value: lastLogged?.value ? String(sleepHours(lastLogged.value)) : '—',
        caption: lastLogged?.value
          ? `hours · ${formatDayKey(lastLogged.date)} · of ${sources.sleepGoalHours} h`
          : 'no nights logged yet',
        progress: fraction(lastLogged?.value ?? null, goalMinutes),
        series,
        seriesLabel: `Hours slept per night, last ${days} nights`,
        formatBar: (value) => String(sleepHours(value)),
        stats: [
          {
            label: 'Last night',
            value: lastLogged?.value ? formatSleepDuration(lastLogged.value) : '—',
            testID: 'health-metric-sleep-last',
          },
          {
            label: 'Average',
            value: average === null ? '—' : formatSleepDuration(Math.round(average)),
            testID: 'health-metric-sleep-average',
          },
          {
            label: 'Nights logged',
            value: `${loggedCount(series)}/${days}`,
            testID: 'health-metric-sleep-nights',
          },
        ],
        explanation:
          'The hours you entered on Home. Apple Health sync is not connected yet, so nothing is imported — and when it is, a night you typed yourself is kept.',
        route: null,
        routeLabel: null,
      };
    }

    case 'habits': {
      const total = sources.habits.length;
      const series: HomeMetricPoint[] = dayKeys.map((date) => ({
        date,
        // Habits are day-keyed with a fixed denominator, so a day with none done
        // is a real zero rather than a missing reading.
        value: total === 0 ? null : sources.habits.filter((habit) => isDoneOn(habit, date)).length,
      }));
      const todayValue = series[series.length - 1]?.value ?? null;
      const perfectDays = series.filter(
        (point) => total > 0 && point.value === total
      ).length;
      return {
        key,
        title: 'Habits',
        icon: 'streak',
        tone: 'primary',
        value: total === 0 ? '—' : `${todayValue ?? 0}/${total}`,
        caption: total === 0 ? 'no habits yet' : 'done today',
        progress: total === 0 ? null : (todayValue ?? 0) / total,
        series,
        seriesLabel:
          total === 0
            ? 'No habits to chart yet'
            : `Habits done per day, last ${days} days (of ${total})`,
        formatBar: (value) => String(Math.round(value)),
        stats: [
          {
            label: 'Today',
            value: total === 0 ? '—' : `${todayValue ?? 0}/${total}`,
            testID: 'health-metric-habits-today',
          },
          {
            label: 'Average',
            value: averageOf(series) === null ? '—' : (Math.round((averageOf(series) as number) * 10) / 10).toString(),
            testID: 'health-metric-habits-average',
          },
          {
            label: 'Full days',
            value: total === 0 ? '—' : `${perfectDays}/${days}`,
            testID: 'health-metric-habits-perfect',
          },
        ],
        explanation:
          'Ticked on the Habits tab. A habit has no time of day, so this counts whole days rather than moments.',
        route: '/health-habits',
        routeLabel: 'Open Habits',
      };
    }

    case 'body':
    default: {
      const summaries = summarizeBody(sources.bodyEntries);
      const measured = summaries.filter((summary) => summary.latest !== null);
      const newest = measured
        .map((summary) => summary.latest as { loggedAt: string })
        .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt))[0];
      return {
        key: 'body',
        title: 'Body',
        icon: 'body-measurements',
        tone: 'primary',
        value: `${measured.length}/${BODY_METRICS.length}`,
        caption: 'sites measured',
        progress: BODY_METRICS.length > 0 ? measured.length / BODY_METRICS.length : null,
        // Measurements are taken every few weeks, not daily — a seven-day strip
        // of one bar would misrepresent them as a habit that is being missed.
        series: [],
        seriesLabel: '',
        formatBar: (value) => String(Math.round(value)),
        stats: [
          {
            label: 'Sites',
            value: `${measured.length}/${BODY_METRICS.length}`,
            testID: 'health-metric-body-sites',
          },
          {
            label: 'Last measured',
            value: newest ? formatDayKey(newest.loggedAt.slice(0, 10)) : '—',
            testID: 'health-metric-body-last',
          },
          {
            label: 'Entries',
            value: String(sources.bodyEntries.length),
            testID: 'health-metric-body-entries',
          },
        ],
        explanation:
          'Waist, chest, arms and the rest, from the Body tab — with their own trend charts and a two-date compare.',
        route: '/health-body',
        routeLabel: 'Open Body',
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/* The sheet                                                           */
/* ------------------------------------------------------------------ */

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Single letter for a day key, used as the bar strip's axis. */
function weekdayInitial(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return '';
  return WEEKDAY_INITIALS[new Date(year, month - 1, day).getDay()] ?? '';
}

const BAR_HEIGHT = 84;

/**
 * A seven-slot daily strip.
 *
 * Deliberately not one of the gifted-charts primitives: those measure their own
 * width, and inside an animated sheet that has not finished presenting they
 * render at zero. This is proportional, labelled on both axes, and every bar
 * carries its own figure for a screen reader.
 */
function MetricBars({ detail, tone }: { detail: HomeMetricDetail; tone: string }) {
  const colors = useAppColors();
  const max = detail.series.reduce((best, point) => Math.max(best, point.value ?? 0), 0);

  if (detail.series.length === 0) return null;

  return (
    <View style={styles.barsBlock} testID={`health-metric-${detail.key}-series`}>
      <Typography variant="caption1" color={colors.textSecondary}>
        {detail.seriesLabel}
      </Typography>
      <View style={styles.barsRow}>
        {detail.series.map((point) => {
          const height = max > 0 && point.value !== null ? (point.value / max) * BAR_HEIGHT : 0;
          return (
            <View
              key={point.date}
              style={styles.barCell}
              accessible
              accessibilityLabel={`${formatDayKey(point.date)}: ${
                point.value === null ? 'not logged' : detail.formatBar(point.value)
              }`}
              testID={`health-metric-${detail.key}-bar-${point.date}`}
            >
              <Typography variant="caption1" color={colors.textSecondary}>
                {point.value === null ? '—' : detail.formatBar(point.value)}
              </Typography>
              <View style={[styles.barTrack, { backgroundColor: colors.borderColor }]}>
                <View
                  style={[
                    styles.barFill,
                    { height: Math.max(point.value === null ? 0 : 2, height), backgroundColor: tone },
                  ]}
                />
              </View>
              <Typography variant="caption1" color={colors.textSecondary}>
                {weekdayInitial(point.date)}
              </Typography>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export interface HealthHomeMetricSheetProps {
  /** `null` closes the sheet — the screen holds the open metric. */
  detail: HomeMetricDetail | null;
  onClose: () => void;
  /** Follow the sheet's link into the tab that owns the record. */
  onOpenRoute: (route: string) => void;
}

export function HealthHomeMetricSheet({
  detail,
  onClose,
  onOpenRoute,
}: HealthHomeMetricSheetProps) {
  const colors = useAppColors();
  const tone = detail
    ? detail.tone === 'warm'
      ? colors.chartWarm
      : detail.tone === 'cool'
        ? colors.chartCool
        : colors.primary
    : colors.primary;

  return (
    <BottomSheet
      visible={detail !== null}
      onClose={onClose}
      height="tall"
      title={detail?.title}
      showCloseButton
    >
      {detail ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.sheetContent}
          testID={`health-metric-detail-${detail.key}`}
        >
          <View style={styles.headRow}>
            {detail.progress === null ? (
              <View
                style={[styles.headIcon, { backgroundColor: colors.backgroundSecondary }]}
                accessible={false}
              >
                <Icon name={detail.icon} size={28} color={tone} />
              </View>
            ) : (
              <ProgressRing
                progress={detail.progress}
                size={96}
                stroke={10}
                color={tone}
                showPercent={false}
              >
                <Icon name={detail.icon} size={22} color={tone} />
              </ProgressRing>
            )}
            <View style={styles.headText}>
              <Typography
                variant="title1"
                weight="bold"
                color={colors.textPrimary}
                testID={`health-metric-${detail.key}-value`}
              >
                {detail.value}
              </Typography>
              <Typography variant="body" color={colors.textSecondary}>
                {detail.caption}
              </Typography>
            </View>
          </View>

          {detail.macros && detail.macros.length > 0 ? (
            <View style={styles.macrosBlock} testID={`health-metric-${detail.key}-macros`}>
              {detail.macros.map((macro) => (
                <HealthGoalBar
                  key={macro.testID}
                  label={macro.label}
                  value={macro.value}
                  target={macro.target}
                  suffix={macro.suffix}
                  color={macro.color}
                  testID={macro.testID}
                />
              ))}
            </View>
          ) : null}

          <MetricBars detail={detail} tone={tone} />

          <HealthStatRow stats={detail.stats} />

          <Typography variant="caption1" color={colors.textSecondary}>
            {detail.explanation}
          </Typography>

          {detail.route && detail.routeLabel ? (
            <Pressable
              onPress={() => onOpenRoute(detail.route as string)}
              accessibilityRole="button"
              accessibilityLabel={detail.routeLabel}
              testID={`health-metric-${detail.key}-open`}
              style={[styles.openButton, { backgroundColor: colors.primary }]}
            >
              <Typography variant="body" weight="semibold" color={colors.white}>
                {detail.routeLabel}
              </Typography>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetContent: {
    gap: Spacing.base,
    paddingBottom: Spacing.xl,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
  },
  headIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: {
    flex: 1,
    gap: Spacing.xxs,
  },
  macrosBlock: {
    gap: Spacing.sm,
  },
  barsBlock: {
    gap: Spacing.sm,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  barCell: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  barTrack: {
    width: '100%',
    height: BAR_HEIGHT,
    borderRadius: CornerRadius.sm,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: CornerRadius.sm,
  },
  openButton: {
    height: 48,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
