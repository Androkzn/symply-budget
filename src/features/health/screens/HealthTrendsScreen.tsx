import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { AppBarChart } from '@components/ui/AppBarChart';
import { CalendarHeatmap } from '@components/ui/CalendarHeatmap';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors, useIsDarkMode } from '@theme';

import {
  HealthCaloriesDashboard,
  HealthHabitStats,
  HealthSectionScreen,
  HealthStatTiles,
  HealthWeightDashboard,
  type WeightChartMode,
} from '../components';
import {
  loadActivityGoals,
  loadStepDays,
  loadWorkouts,
  DEFAULT_ACTIVITY_GOALS,
  type ActivityGoals,
  type StepDay,
  type WorkoutEntry,
} from '../healthActivityStorage';
import {
  bucketedTotals,
  healthChartPalette,
  loggingConsistency,
  summarizeConsistency,
  tallyDays,
} from '../healthDashboards';
import { loadHabits, streakOf, type Habit } from '../healthHabitsStorage';
import {
  dateKeyOf,
  loadWaterHistory,
  loadWeightLog,
  todayDateKey,
  type WaterDay,
  type WeightEntry,
} from '../healthLocalStorage';
import {
  loadMeals,
  loadNutritionGoals,
  DEFAULT_NUTRITION_GOALS,
  type MealEntry,
  type NutritionGoals,
} from '../healthNutritionStorage';
import {
  summarizeActivityTrend,
  summarizeHabitTrend,
  summarizeHydrationTrend,
  summarizeNutritionTrend,
  TREND_RANGES,
  type TrendRange,
} from '../healthTrends';
import { weightWindow } from '../healthWeightAnalytics';
import {
  EMPTY_WEIGHT_GOAL,
  loadWeightGoal,
  weightInUnit,
  type WeightGoal,
} from '../healthWeightStorage';
import { useHealthKitSyncHydration } from '../useHealthKitSyncHydration';

/**
 * Trends tab — the donor's "Weight Stats" dashboard widened to the whole app.
 *
 * Everything is derived from the same local stores the other tabs write to, so
 * the tab has no ingest of its own and nothing to sync. Empty ranges say so
 * plainly instead of drawing a flat zero line.
 *
 * ### The window, not "the last N days"
 *
 * The range picker used to be trailing-only: it could ask for the last 30 days
 * and never for last March. It now drives `weightWindow`, the same helper the
 * Weight tab navigates with, so ◀ / ▶ step whole windows into the past and
 * every card on the screen — charts, heatmap and tiles alike — reads the
 * identical span. The heatmap is given the window's END date for the same
 * reason: a grid that always finished today while the charts sat in March
 * would be two different questions stacked on one screen.
 */
export function HealthTrendsScreen() {
  const colors = useAppColors();
  const palette = healthChartPalette(useIsDarkMode());
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(240, width - 2 * Spacing.lg - 2 * Spacing.base);

  const [range, setRange] = useState<TrendRange>(30);
  const [offset, setOffset] = useState(0);
  const [weightMode, setWeightMode] = useState<WeightChartMode>('trend');
  const [showWeightAverage, setShowWeightAverage] = useState(false);
  const [showWeightValues, setShowWeightValues] = useState(false);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [meals, setMeals] = useState<MealEntry[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutEntry[]>([]);
  const [steps, setSteps] = useState<StepDay[]>([]);
  const [water, setWater] = useState<WaterDay[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [goals, setGoals] = useState<NutritionGoals>(DEFAULT_NUTRITION_GOALS);
  const [weightGoal, setWeightGoal] = useState<WeightGoal>(EMPTY_WEIGHT_GOAL);
  const [activityGoals, setActivityGoals] = useState<ActivityGoals>(DEFAULT_ACTIVITY_GOALS);
  const [loading, setLoading] = useState(true);

  const hydrate = useCallback(async () => {
    const [w, m, wk, st, wa, hb, ng, wg, ag] = await Promise.all([
      loadWeightLog(),
      loadMeals(),
      loadWorkouts(),
      loadStepDays(),
      loadWaterHistory(),
      loadHabits(),
      loadNutritionGoals(),
      loadWeightGoal(),
      loadActivityGoals(),
    ]);
    setWeights(w);
    setMeals(m);
    setWorkouts(wk);
    setSteps(st);
    setWater(wa);
    setHabits(hb);
    // `loadNutritionGoals` merges over `DEFAULT_NUTRITION_GOALS` itself and
    // always answers a complete set, so there is nothing left to default here.
    setGoals(ng);
    setWeightGoal(wg);
    setActivityGoals(ag);
    setLoading(false);
  }, []);

  // Hydrates on mount AND every subsequent focus (leave-and-return) — a plain
  // mount-only `useEffect` would be redundant with this, since `useFocusEffect`
  // already fires immediately when the screen is focused on first render.
  useFocusEffect(
    useCallback(() => {
      void hydrate();
    }, [hydrate]),
  );
  // Also re-hydrate the instant a HealthKit sync lands while already on this
  // tab — the background observer/catch-up paths don't wait for a nav event.
  useHealthKitSyncHydration(hydrate);

  const today = todayDateKey();
  const window = useMemo(() => weightWindow(today, range, offset), [today, range, offset]);
  const dayKeys = window.dayKeys;
  const nutrition = useMemo(() => summarizeNutritionTrend(meals, dayKeys), [meals, dayKeys]);
  const activity = useMemo(
    () => summarizeActivityTrend(workouts, steps, dayKeys),
    [workouts, steps, dayKeys],
  );
  const hydration = useMemo(() => summarizeHydrationTrend(water, dayKeys), [water, dayKeys]);
  const habitTrend = useMemo(
    () => summarizeHabitTrend(habits, dayKeys, (days) => streakOf(days)),
    [habits, dayKeys],
  );

  // Active minutes per day, bucketed to a width the plot can draw, so the
  // donor's minutes-vs-goal rule has something to be drawn against.
  const minutesByDay = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const entry of workouts) {
      totals[entry.date] = (totals[entry.date] ?? 0) + entry.minutes;
    }
    return totals;
  }, [workouts]);
  const minutes = useMemo(() => bucketedTotals(minutesByDay, dayKeys), [minutesByDay, dayKeys]);
  // A DAILY goal cannot be compared against a bar covering seven days without
  // being multiplied by seven. The scaling is disclosed in words below.
  const minutesGoal =
    activityGoals.minutes > 0 ? activityGoals.minutes * minutes.bucketDays : 0;
  const minutesLabel =
    activity.minutes > 0
      ? `Active minutes over ${window.label}: ${activity.minutes} in total across ` +
        `${activity.activeDays} active days` +
        (minutesGoal > 0 ? `, against a ${activityGoals.minutes} minute daily goal.` : '.')
      : 'Active minutes: nothing logged in this window.';

  // One tally across every tracker: a day "counts" as logged if anything at all
  // landed on it. Days with nothing are absent from the map (never zero), so the
  // heatmap can draw "no data" and "logged a zero" as different things.
  const consistency = useMemo(() => {
    const tally = tallyDays([
      ...meals.map((entry) => entry.date),
      ...workouts.map((entry) => entry.date),
      ...weights.map((entry) => dateKeyOf(entry.loggedAt)),
      ...steps.filter((day) => day.steps > 0).map((day) => day.date),
      ...water.filter((day) => day.cups > 0).map((day) => day.date),
      ...habits.flatMap((h) => h.days),
    ]);
    return loggingConsistency(tally, dayKeys);
  }, [meals, workouts, weights, steps, water, habits, dayKeys]);
  const consistencySummary = useMemo(
    () => summarizeConsistency(consistency, dayKeys),
    [consistency, dayKeys],
  );

  return (
    <HealthSectionScreen title="Trends" testID="health-trends-screen" loading={loading}>
      {/* Window navigator + width picker — every card below reads this span */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.navRow}>
          <Pressable
            onPress={() => setOffset((o) => o + 1)}
            accessibilityRole="button"
            accessibilityLabel="Previous window"
            testID="health-trends-window-previous"
            style={[styles.navButton, { borderColor: colors.borderColor }]}
          >
            <Icon name="arrow-back" size={18} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.navCenter}>
            <Typography
              variant="body"
              weight="semibold"
              color={colors.textPrimary}
              testID="health-trends-window-label"
            >
              {window.label}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              {window.isCurrent ? 'Up to today' : `${offset} window${offset === 1 ? '' : 's'} back`}
            </Typography>
          </View>
          <Pressable
            onPress={() => setOffset((o) => Math.max(0, o - 1))}
            disabled={window.isCurrent}
            accessibilityRole="button"
            accessibilityLabel="Next window"
            accessibilityState={{ disabled: window.isCurrent }}
            testID="health-trends-window-next"
            style={[
              styles.navButton,
              { borderColor: colors.borderColor, opacity: window.isCurrent ? 0.35 : 1 },
            ]}
          >
            <Icon name="arrow-forward" size={18} color={colors.textPrimary} />
          </Pressable>
        </View>

        <View style={[styles.rangeRow, { borderColor: colors.borderColor }]}>
          {TREND_RANGES.map((option) => {
            const active = option === range;
            return (
              <Pressable
                key={option}
                onPress={() => {
                  // Changing the width while parked in the past would land on a
                  // different span than the one on screen, so it returns to the
                  // current window — the only window every width agrees on.
                  setOffset(0);
                  setRange(option);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                testID={`health-trends-range-${option}`}
                style={[styles.rangeOption, active && { backgroundColor: colors.primary }]}
              >
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={active ? colors.white : colors.textSecondary}
                >
                  {option} days
                </Typography>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {/* Weight — the donor's "Weight Stats" dashboard */}
      {/* The goal rule follows the member here too: the target is stored in
          canonical kg and converted once into the unit this series is plotted
          in, so it can never be drawn against a scale it was not measured on.
          `buildWeightSeries` plots in the NEWEST entry's unit and drops entries
          logged in any other one, so that is the unit the target is converted
          into. With nothing logged there is no scale to convert onto and no
          chart to draw the rule on, so the target is simply not passed. */}
      <HealthWeightDashboard
        entries={weights}
        dayKeys={dayKeys}
        width={chartWidth}
        goal={
          weightGoal.targetKg === null || weights.length === 0
            ? null
            : weightInUnit(weightGoal.targetKg, weights[0].unit)
        }
        mode={weightMode}
        onModeChange={setWeightMode}
        showAverageLine={showWeightAverage}
        onToggleAverageLine={() => setShowWeightAverage((on) => !on)}
        showValues={showWeightValues}
        onToggleShowValues={() => setShowWeightValues((on) => !on)}
      />

      {/* Calories — the donor's "Calories" dashboard. Workouts are the burn
          series: intake alone cannot answer "am I losing weight?" */}
      <HealthCaloriesDashboard
        meals={meals}
        workouts={workouts}
        goal={goals.calories}
        dayKeys={dayKeys}
        width={chartWidth}
      />

      {/* Logging consistency — one square per day, across every tracker */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          LOGGING CONSISTENCY
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary}>
          One square per day, shaded by how much you recorded. An outlined square is a day with
          nothing logged.
        </Typography>
        <CalendarHeatmap
          values={consistency}
          weeks={Math.max(1, Math.ceil(range / 7))}
          // The grid has to end where the window ends, or a past window would
          // draw its squares against today's calendar.
          endDate={window.end}
          color={palette.consistency}
          emptyLabel="Nothing logged in this range yet."
          testID="health-trends-consistency"
        />
        <HealthStatTiles
          stats={[
            {
              label: 'Days logged',
              value: `${consistencySummary.daysLogged}/${consistencySummary.daysInRange}`,
              icon: 'insights',
              testID: 'health-trends-consistency-days',
            },
            {
              label: 'Coverage',
              value: `${Math.round(consistencySummary.rate * 100)}%`,
              icon: 'trends',
              testID: 'health-trends-consistency-rate',
            },
            {
              label: 'Best run',
              value:
                consistencySummary.bestStreak > 0 ? `${consistencySummary.bestStreak} d` : '—',
              icon: 'streak',
              testID: 'health-trends-consistency-streak',
            },
          ]}
        />
      </Card>

      {/* Nutrition */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          NUTRITION
        </Typography>
        <HealthStatTiles
          stats={[
            {
              label: 'Days logged',
              value: `${nutrition.daysLogged}/${dayKeys.length}`,
              icon: 'meals',
              testID: 'health-trends-nutrition-days',
            },
            {
              label: 'Avg calories',
              value: nutrition.daysLogged > 0 ? `${nutrition.averageCalories} kcal` : '—',
              icon: 'calories',
              testID: 'health-trends-nutrition-avg',
            },
            {
              label: 'Avg protein',
              value: nutrition.daysLogged > 0 ? `${nutrition.averageProtein} g` : '—',
              icon: 'macros',
              testID: 'health-trends-nutrition-protein',
            },
          ]}
        />
        <Typography variant="caption1" color={colors.textSecondary}>
          Averages cover the days you logged, not the whole range.
        </Typography>
      </Card>

      {/* Activity */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          ACTIVITY
        </Typography>
        <HealthStatTiles
          stats={[
            {
              label: 'Workouts',
              value: String(activity.workouts),
              icon: 'workouts',
              testID: 'health-trends-activity-workouts',
            },
            {
              label: 'Active days',
              value: `${activity.activeDays}/${dayKeys.length}`,
              icon: 'move-rings',
              testID: 'health-trends-activity-days',
            },
            {
              label: 'Avg steps',
              value: activity.averageSteps > 0 ? String(activity.averageSteps) : '—',
              icon: 'steps',
              testID: 'health-trends-activity-steps',
            },
          ]}
        />

        {/* Active minutes against the daily movement goal — the donor's
            `WorkoutsView` minutes chart, with the rule it draws there. */}
        {minutes.empty ? (
          <Typography
            variant="body"
            color={colors.textSecondary}
            testID="health-trends-minutes-empty"
          >
            No sessions logged in this window, so there are no active minutes to chart. Log a
            workout on the Activity tab and this fills in.
          </Typography>
        ) : (
          <>
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel={minutesLabel}
              testID="health-trends-minutes-chart"
            >
              <AppBarChart
                data={minutes.bars}
                width={chartWidth}
                formatValue={(v) => `${Math.round(v)}`}
                referenceValue={minutesGoal > 0 ? minutesGoal : undefined}
                referenceLabel={minutesGoal > 0 ? `Goal ${minutesGoal}` : undefined}
                referenceColor={minutesGoal > 0 ? colors.primary : undefined}
              />
            </View>
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID="health-trends-minutes-note"
            >
              {minutes.note}
              {minutesGoal > 0
                ? minutes.bucketDays === 1
                  ? ` The dashed rule is your ${activityGoals.minutes} minute daily goal.`
                  : ` The dashed rule is your ${activityGoals.minutes} minute daily goal times ` +
                    `${minutes.bucketDays} days — ${minutesGoal} minutes per block.`
                : ' No daily movement goal set yet, so no block is scored against one.'}{' '}
              Minutes count only the sessions you logged.
            </Typography>
          </>
        )}
      </Card>

      {/* Hydration + habits */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          HYDRATION &amp; HABITS
        </Typography>
        <HealthStatTiles
          stats={[
            {
              label: 'Water goal',
              value: `${hydration.goalDays}/${hydration.daysTracked || 0} days`,
              icon: 'hydration',
              testID: 'health-trends-water-goal-days',
            },
            {
              label: 'Avg cups',
              value: hydration.daysTracked > 0 ? String(hydration.averageCups) : '—',
              icon: 'water',
              testID: 'health-trends-water-average',
            },
            {
              label: 'Best streak',
              value: habitTrend.bestStreak > 0 ? `${habitTrend.bestStreak} d` : '—',
              icon: 'streak',
              testID: 'health-trends-habit-streak',
            },
          ]}
        />
        {habitTrend.bestHabit ? (
          <View style={styles.footnoteRow}>
            <Icon name="streak" size={16} color={colors.primary} />
            <Typography variant="caption1" color={colors.textSecondary}>
              Longest run: {habitTrend.bestHabit}
            </Typography>
          </View>
        ) : null}
      </Card>

      {/* Habit statistics — the donor's `HabitStatisticsView`. Its own Week /
          Month selector, because a completion rate is read against a habit
          cycle rather than against whatever window the charts above are on. */}
      <HealthHabitStats
        habits={habits}
        today={today}
        width={chartWidth}
        testID="health-trends-habit-stats"
      />

      {/* The privacy promise has to hold on the analytics surface too */}
      <View style={styles.footnoteRow}>
        <Icon name="local-only" size={16} color={colors.textSecondary} />
        <Typography variant="caption1" color={colors.textSecondary}>
          Trends are computed from your own entries and no one else's.
        </Typography>
      </View>
    </HealthSectionScreen>
  );
}

const styles = StyleSheet.create({
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navCenter: {
    flex: 1,
    alignItems: 'center',
  },
  rangeRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  rangeOption: {
    flex: 1,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  footnoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
});
