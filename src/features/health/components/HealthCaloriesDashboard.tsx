import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { AppBarChart, type AppBarStack } from '@components/ui/AppBarChart';
import type { ChartReferenceLine } from '@components/ui/AppLineChart';
import { CornerRadius, Spacing, useAppColors, useIsDarkMode } from '@theme';

import type { WorkoutEntry } from '../healthActivityStorage';
import {
  averageCaloriesOver,
  caloriesVsTarget,
  energyBalance,
  energyBalanceBars,
  energyGroupBars,
  energyIntakeBars,
  energySeries,
  healthChartPalette,
  labelEveryFor,
  macroSplit,
  weekComparisonKeys,
  weeklyMacroSplits,
  BURN_SOURCE_NOTE,
  MAX_AXIS_LABELS,
  MAX_ENERGY_BARS,
  MAX_ENERGY_GROUPS,
} from '../healthDashboards';
import { sumNutrition, type MealEntry } from '../healthNutritionStorage';
import { formatAxisDate } from '../healthTrends';

import { HealthStatRow, LegendKey } from './HealthWeightDashboard';

/**
 * Symply Health — the donor's "Calories" dashboard (`CaloriesChartWidget`, the
 * donor's most-drawn chart at 16 marks).
 *
 * ### Three readings of one series, because they answer different questions
 *
 *   1. **Intake** — did I hit my target? One bar per logged day (or per block on
 *      a wide window), filled by whether it landed at or under the goal, with
 *      the goal as a real rule, and optionally the donor's this-week /
 *      last-week average rules over it.
 *   2. **Burn** — intake next to the calories burned in logged sessions. Both
 *      series are kcal per day so they share ONE axis; the gap between the pair
 *      is that day's net, which is the only reason to draw them together.
 *   3. **Balance** — `intake − burn − target` as diverging bars from a real
 *      zero. This is the "am I losing weight?" read: below the line finished
 *      under target, above it over. It is drawn against zero rather than
 *      against a rule because a deficit is a SIGNED quantity, and asking the
 *      reader to eyeball the distance between a bar top and a dashed line is a
 *      worse way to answer a yes/no question.
 *
 * Then the macro split by ENERGY, one 100% stacked bar per week, so the shape
 * of the diet — and any drift in it — stays visible rather than flattened into
 * one aggregate.
 *
 * ### What "burned" can and cannot mean here
 *
 * The donor reads active (and total) burn from HealthKit, so its zero is a real
 * zero. This app's only source is the sessions the member logged, so a zero is
 * ambiguous — "I did nothing" or "I did something and never wrote it down". The
 * ambiguity cannot be resolved from the data, so it is disclosed in words on
 * every surface that shows burn, and the number of days actually carrying a
 * session is printed next to the averages.
 *
 * ### Rules are drawn by the primitive, never overlaid here
 *
 * The goal and the two average rules are passed to `AppBarChart` as
 * `referenceValue` / `referenceLines`, so the primitive draws them against its
 * OWN axis ceiling. An overlay drawn in this file would have to re-derive the
 * unit→pixel ladder and would slide off silently the moment that ladder
 * changed, and a rule in the wrong place is a worse lie than no rule.
 *
 * Data arrives as props; the component derives and paints, and never fetches.
 */

export type CaloriesChartMode = 'intake' | 'burn' | 'balance';

const MODE_LABELS: Record<CaloriesChartMode, string> = {
  intake: 'Intake',
  burn: 'Burn',
  balance: 'Balance',
};

const MODE_HINTS: Record<CaloriesChartMode, string> = {
  intake: 'Calories eaten against your target',
  burn: 'Calories eaten next to calories burned',
  balance: 'How far each day landed under or over target',
};

export interface HealthCaloriesDashboardProps {
  /** Every logged meal — the shape `loadMeals()` returns. */
  meals: MealEntry[];
  /**
   * Logged sessions — the burn series. Optional so a caller that has not loaded
   * workouts still renders the intake reading rather than a burn of zero.
   */
  workouts?: WorkoutEntry[];
  /** Daily calorie target from the member's nutrition goals. */
  goal: number;
  /** The window every figure is derived over, oldest first. */
  dayKeys: string[];
  /** Plot width in points. */
  width: number;
  testID?: string;
}

export function HealthCaloriesDashboard({
  meals,
  workouts,
  goal,
  dayKeys,
  width,
  testID = 'health-calories-dashboard',
}: HealthCaloriesDashboardProps) {
  const colors = useAppColors();
  const palette = healthChartPalette(useIsDarkMode());
  const [mode, setMode] = useState<CaloriesChartMode>('intake');
  const [showAverages, setShowAverages] = useState(false);

  const summary = useMemo(() => caloriesVsTarget(meals, goal, dayKeys), [meals, goal, dayKeys]);
  const energy = useMemo(
    () => energyBalance(meals, workouts ?? [], goal, dayKeys),
    [meals, workouts, goal, dayKeys]
  );

  // A pair of bars needs roughly twice the room of one, so the two-series
  // reading blocks the window more coarsely than the single-series ones.
  const series = useMemo(
    () =>
      energySeries(energy.days, dayKeys, goal, {
        maxBuckets: mode === 'burn' ? MAX_ENERGY_GROUPS : MAX_ENERGY_BARS,
      }),
    [energy.days, dayKeys, goal, mode]
  );

  const intakeBars = useMemo(
    () =>
      energyIntakeBars(series, goal, {
        onTarget: palette.caloriesOnTarget,
        over: palette.caloriesOver,
      }),
    [series, goal, palette.caloriesOnTarget, palette.caloriesOver]
  );
  const groupBars = useMemo(
    () => energyGroupBars(series, { consumed: palette.energyIntake, burned: palette.energyBurn }),
    [series, palette.energyIntake, palette.energyBurn]
  );
  const balanceBars = useMemo(
    () =>
      energyBalanceBars(series, {
        deficit: palette.caloriesOnTarget,
        surplus: palette.caloriesOver,
      }),
    [series, palette.caloriesOnTarget, palette.caloriesOver]
  );

  // The donor's two average rules. Both spans are anchored to the END of the
  // window, so "last week" is the seven days before the seven on screen —
  // outside the window when the window itself is only a week wide, which is
  // exactly when the comparison is worth drawing.
  const weekSpans = useMemo(() => weekComparisonKeys(dayKeys), [dayKeys]);
  const thisWeekAverage = useMemo(
    () => averageCaloriesOver(meals, weekSpans.thisWeek),
    [meals, weekSpans.thisWeek]
  );
  const lastWeekAverage = useMemo(
    () => averageCaloriesOver(meals, weekSpans.lastWeek),
    [meals, weekSpans.lastWeek]
  );

  const weeklyMacros = useMemo(() => weeklyMacroSplits(meals, dayKeys), [meals, dayKeys]);
  const rangeSplit = useMemo(() => {
    const inRange = new Set(dayKeys);
    return macroSplit(sumNutrition((meals ?? []).filter((entry) => inRange.has(entry.date))));
  }, [meals, dayKeys]);

  const macroStacks = useMemo<AppBarStack[]>(() => {
    const every = labelEveryFor(weeklyMacros.length, MAX_AXIS_LABELS);
    return weeklyMacros.map((week, index) => ({
      label: index % every === 0 ? formatAxisDate(week.weekStart) : '',
      segments: [
        { value: week.split.protein, color: palette.macroProtein },
        { value: week.split.carbs, color: palette.macroCarbs },
        { value: week.split.fat, color: palette.macroFat },
      ],
    }));
  }, [weeklyMacros, palette.macroProtein, palette.macroCarbs, palette.macroFat]);

  const macroLabelEvery = labelEveryFor(weeklyMacros.length, MAX_AXIS_LABELS);
  const hasMacros = rangeSplit.protein + rangeSplit.carbs + rangeSplit.fat > 0;
  const hasGoal = summary.goal > 0;
  const targetLabel = hasGoal ? `${summary.goal} kcal` : 'no target set';

  // Averages are only offered on the intake reading — they are means of INTAKE,
  // and a rule at 2,100 kcal drawn across a chart of net balances would be
  // measuring one thing against a scale built for another.
  const averageRules = useMemo<ChartReferenceLine[]>(() => {
    if (!showAverages) return [];
    const rules: ChartReferenceLine[] = [];
    if (thisWeekAverage !== null) {
      rules.push({ value: thisWeekAverage, color: palette.weightAverage });
    }
    if (lastWeekAverage !== null) {
      rules.push({ value: lastWeekAverage, color: colors.textTertiary });
    }
    return rules;
  }, [showAverages, thisWeekAverage, lastWeekAverage, palette.weightAverage, colors.textTertiary]);

  const intakeLabel =
    summary.daysLogged > 0
      ? `Daily calories against a ${targetLabel} target: ${summary.daysOnTarget} of ` +
        `${summary.daysLogged} logged days at or under it. Average ${summary.averageCalories} kcal.`
      : 'Daily calories: nothing logged in this range.';
  const burnLabel =
    energy.daysLogged > 0
      ? `Calories eaten next to calories burned across ${energy.daysLogged} logged days: ` +
        `average intake ${energy.averageConsumed} kcal, average burn ${energy.averageBurned} kcal ` +
        `from ${energy.daysWithBurn} days carrying a session. Average net ${energy.averageNet} kcal.`
      : 'Calories eaten next to calories burned: nothing logged in this range.';
  const balanceLabel =
    hasGoal && energy.daysLogged > 0
      ? `Daily balance against a ${targetLabel} target: ${energy.deficitDays} days under it, ` +
        `${energy.surplusDays} over. Average net ${energy.averageNet} kcal.`
      : 'Daily balance: no target set, so no day can be scored against one.';
  const macroLabel = hasMacros
    ? `Macro split by energy across the range: protein ${rangeSplit.protein}%, ` +
      `carbs ${rangeSplit.carbs}%, fat ${rangeSplit.fat}%.`
    : 'Macro split: nothing logged in this range.';

  const signedKcal = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value)}`;

  return (
    <Card
      variant="filled"
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      testID={testID}
    >
      <View style={styles.headRow}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          CALORIES
        </Typography>
        {/* Hidden with nothing logged: a toggle between three empty readings is
            three ways to look at the same blank card. */}
        <View
          style={[
            styles.modeToggle,
            { borderColor: colors.borderColor },
            summary.daysLogged === 0 && styles.hidden,
          ]}
        >
          {(['intake', 'burn', 'balance'] as const).map((option) => {
            const active = option === mode;
            return (
              <Pressable
                key={option}
                onPress={() => setMode(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={MODE_HINTS[option]}
                testID={`${testID}-mode-${option}`}
                style={[styles.modeOption, active && { backgroundColor: colors.primary }]}
              >
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={active ? colors.white : colors.textSecondary}
                >
                  {MODE_LABELS[option]}
                </Typography>
              </Pressable>
            );
          })}
        </View>
      </View>

      {summary.daysLogged === 0 ? (
        <Typography variant="body" color={colors.textSecondary} testID={`${testID}-empty`}>
          Log a meal on at least one day in this range to see your intake against your target.
        </Typography>
      ) : mode === 'intake' ? (
        <>
          {/* The goal in words, alongside the rule the primitive draws. */}
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID={`${testID}-target-note`}
          >
            {hasGoal
              ? `Daily target ${summary.goal} kcal. Bars are coloured by whether the day cleared it.`
              : 'No daily calorie target set yet, so no day is scored against one.'}
          </Typography>

          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={intakeLabel}
            testID={`${testID}-chart`}
          >
            <AppBarChart
              data={intakeBars}
              width={width}
              formatValue={(v) => `${Math.round(v)}`}
              referenceValue={hasGoal ? goal : undefined}
              referenceLabel={hasGoal ? `Goal ${Math.round(goal)}` : undefined}
              referenceColor={hasGoal ? colors.primary : undefined}
              referenceLines={averageRules}
            />
          </View>

          <View style={styles.legendRow} testID={`${testID}-legend`}>
            <LegendKey color={palette.caloriesOnTarget} label="At or under target" />
            <LegendKey color={palette.caloriesOver} label="Over target" />
            {hasGoal ? (
              <LegendKey color={colors.primary} label={`Goal ${summary.goal}`} />
            ) : null}
            {showAverages && thisWeekAverage !== null ? (
              <LegendKey
                color={palette.weightAverage}
                label={`This week ${thisWeekAverage}`}
                testID={`${testID}-legend-this-week`}
              />
            ) : null}
            {showAverages && lastWeekAverage !== null ? (
              <LegendKey
                color={colors.textTertiary}
                label={`Last week ${lastWeekAverage}`}
                testID={`${testID}-legend-last-week`}
              />
            ) : null}
          </View>

          <Pressable
            onPress={() => setShowAverages((on) => !on)}
            accessibilityRole="button"
            accessibilityState={{ selected: showAverages }}
            accessibilityLabel="This week and last week average rules"
            testID={`${testID}-toggle-averages`}
            style={[
              styles.ruleToggle,
              {
                borderColor: colors.borderColor,
                backgroundColor: showAverages ? colors.primary + '1F' : 'transparent',
              },
            ]}
          >
            <Typography
              variant="caption1"
              weight="semibold"
              color={showAverages ? colors.primary : colors.textSecondary}
            >
              {showAverages ? 'Week averages on' : 'Week averages off'}
            </Typography>
          </Pressable>

          {showAverages ? (
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID={`${testID}-averages-note`}
            >
              {thisWeekAverage === null && lastWeekAverage === null
                ? 'Nothing logged in either of the last two weeks, so there is no average to draw.'
                : 'The two dashed rules are your mean intake over the last seven days of this ' +
                  'window and over the seven before them — each averaged across the days you ' +
                  'actually logged.'}
            </Typography>
          ) : null}

          {series.note ? (
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID={`${testID}-axis-note`}
            >
              {series.note}
            </Typography>
          ) : null}
        </>
      ) : mode === 'burn' ? (
        <>
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID={`${testID}-burn-note`}
          >
            Calories eaten next to calories burned. Both are kcal per day on one axis, so the gap
            between a pair is that day&apos;s net. {BURN_SOURCE_NOTE}
          </Typography>

          {energy.daysWithBurn === 0 ? (
            <Typography
              variant="body"
              color={colors.textSecondary}
              testID={`${testID}-burn-empty`}
            >
              No sessions logged in this range, so there is no burn to set against your intake. Log
              a workout on the Activity tab and this chart fills in.
            </Typography>
          ) : (
            <>
              <View
                accessible
                accessibilityRole="image"
                accessibilityLabel={burnLabel}
                testID={`${testID}-burn-chart`}
              >
                <AppBarChart
                  groups={groupBars}
                  width={width}
                  formatValue={(v) => `${Math.round(v)}`}
                  referenceValue={hasGoal ? goal : undefined}
                  referenceLabel={hasGoal ? `Goal ${Math.round(goal)}` : undefined}
                  referenceColor={hasGoal ? colors.primary : undefined}
                />
              </View>

              <View style={styles.legendRow} testID={`${testID}-burn-legend`}>
                <LegendKey color={palette.energyIntake} label={`Eaten ${energy.averageConsumed}`} />
                <LegendKey color={palette.energyBurn} label={`Burned ${energy.averageBurned}`} />
                {hasGoal ? (
                  <LegendKey color={colors.primary} label={`Intake goal ${summary.goal}`} />
                ) : null}
              </View>

              {hasGoal ? (
                <Typography variant="caption1" color={colors.textSecondary}>
                  The dashed rule is your INTAKE target; it scores the eaten bar only.
                </Typography>
              ) : null}

              {series.note ? (
                <Typography
                  variant="caption1"
                  color={colors.textSecondary}
                  testID={`${testID}-burn-axis-note`}
                >
                  {series.note}
                </Typography>
              ) : null}
            </>
          )}
        </>
      ) : (
        <>
          {!hasGoal ? (
            <Typography
              variant="body"
              color={colors.textSecondary}
              testID={`${testID}-balance-empty`}
            >
              Set a daily calorie target and this chart shows how far each day landed under or over
              it, once the sessions you logged are taken off.
            </Typography>
          ) : (
            <>
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                testID={`${testID}-balance-note`}
              >
                Each bar is what you ate minus what you burned, measured against your{' '}
                {summary.goal} kcal target. Below the line finished the day under it. {BURN_SOURCE_NOTE}
              </Typography>

              <View
                accessible
                accessibilityRole="image"
                accessibilityLabel={balanceLabel}
                testID={`${testID}-balance-chart`}
              >
                <AppBarChart
                  data={balanceBars}
                  width={width}
                  allowNegative
                  formatValue={signedKcal}
                />
              </View>

              <View style={styles.legendRow} testID={`${testID}-balance-legend`}>
                <LegendKey
                  color={palette.caloriesOnTarget}
                  label={`Under target · ${energy.deficitDays} days`}
                />
                <LegendKey
                  color={palette.caloriesOver}
                  label={`Over target · ${energy.surplusDays} days`}
                />
              </View>

              {series.note ? (
                <Typography
                  variant="caption1"
                  color={colors.textSecondary}
                  testID={`${testID}-balance-axis-note`}
                >
                  {series.note}
                </Typography>
              ) : null}
            </>
          )}
        </>
      )}

      <HealthStatRow
        stats={[
          {
            label: 'Avg intake',
            value: summary.daysLogged > 0 ? `${summary.averageCalories} kcal` : '—',
            testID: `${testID}-average`,
          },
          {
            label: 'Avg burn',
            value: energy.daysWithBurn > 0 ? `${energy.averageBurned} kcal` : '—',
            testID: `${testID}-average-burn`,
          },
          {
            label: 'Avg net',
            value: energy.daysLogged > 0 ? `${energy.averageNet} kcal` : '—',
            testID: `${testID}-average-net`,
          },
          {
            label: 'On target',
            value: summary.daysLogged > 0 ? `${summary.daysOnTarget}/${summary.daysLogged}` : '—',
            testID: `${testID}-on-target`,
          },
          {
            label: 'Best day',
            value: summary.best
              ? `${formatAxisDate(summary.best.date)} · ${summary.best.calories}`
              : '—',
            testID: `${testID}-best`,
          },
          {
            label: 'Worst day',
            value: summary.worst
              ? `${formatAxisDate(summary.worst.date)} · ${summary.worst.calories}`
              : '—',
            testID: `${testID}-worst`,
          },
        ]}
      />
      <Typography variant="caption1" color={colors.textSecondary}>
        Averages cover the days you logged, not the whole range. Best and worst are the days
        closest to and furthest from your target. Net is intake minus the sessions you logged
        {energy.daysLogged > 0
          ? ` — ${energy.daysWithBurn} of ${energy.daysLogged} logged days carry one.`
          : '.'}
      </Typography>

      {hasGoal && energy.daysLogged > 0 && energy.totalBalance !== null ? (
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          testID={`${testID}-total-balance`}
        >
          Across the {energy.daysLogged} logged{' '}
          {energy.daysLogged === 1 ? 'day' : 'days'} you finished{' '}
          {energy.totalBalance <= 0 ? 'under' : 'over'} target by{' '}
          {Math.abs(energy.totalBalance)} kcal in total. Weight change is not modelled from this
          figure — the burn side counts only what you logged.
        </Typography>
      ) : null}

      {hasMacros ? (
        <>
          <Typography variant="caption1" color={colors.textSecondary}>
            Macro split by energy (4 kcal per gram of protein and carbs, 9 for fat), one bar per
            week.
          </Typography>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={macroLabel}
            testID={`${testID}-macros`}
          >
            <AppBarChart
              stacks={macroStacks}
              width={width}
              formatValue={(v) => `${Math.round(v)}%`}
            />
          </View>
          {/* Three series, direct-labelled with the range-wide share. */}
          <View style={styles.legendRow} testID={`${testID}-macro-legend`}>
            <LegendKey color={palette.macroProtein} label={`Protein ${rangeSplit.protein}%`} />
            <LegendKey color={palette.macroCarbs} label={`Carbs ${rangeSplit.carbs}%`} />
            <LegendKey color={palette.macroFat} label={`Fat ${rangeSplit.fat}%`} />
          </View>
          {macroLabelEvery > 1 && (
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID={`${testID}-macro-axis-note`}
            >
              x-axis labels every {macroLabelEvery} weeks.
            </Typography>
          )}
        </>
      ) : (
        <Typography variant="body" color={colors.textSecondary} testID={`${testID}-macros-empty`}>
          No macros logged in this range yet, so there is no split to show.
        </Typography>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  modeToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  modeOption: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    minWidth: 52,
    alignItems: 'center',
  },
  ruleToggle: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.base,
  },
  hidden: {
    display: 'none',
  },
});
