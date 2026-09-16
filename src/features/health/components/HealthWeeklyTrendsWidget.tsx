import React, { useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Typography } from '@components/ui';
import { AppLineChart } from '@components/ui/AppLineChart';
import { Icon } from '@components/ui/Icon';
import { Spacing, useAppColors, useIsDarkMode } from '@theme';
import { Chart } from '@theme/designTokens';

import { healthChartPalette } from '../healthDashboards';
import {
  averageWeeklyWeight,
  caloriesChartPoints,
  combinedNormalizedPoints,
  latestCalorieGoal,
  weightChartPoints,
  type HealthWeeklyTrendResponse,
} from '../healthWeeklyTrendStorage';

import { HealthStatRow, LegendKey } from './HealthWeightDashboard';

/**
 * Symply Health — Dashboard "Weekly Trends" (donor `WeeklyTrendChartWidget`).
 *
 * The donor's period selector (Week / Month / Custom) and its "customize
 * metrics" sheet are UI-only there — switching period never re-queries the
 * underlying data (confirmed by reading the whole 763-line source). So this
 * ships a static "Weekly Trends" header for the two metrics this app already
 * tracks (Calories, Weight) rather than porting decorative controls that do
 * nothing in the app they came from — that is parity, not a regression.
 *
 * TWO SEPARATE small charts by default, each on its own scale — `AppLineChart`'s
 * `data2` shares ONE y-axis ceiling with `data`, which would misrepresent where
 * a calorie line and a weight line "cross" when plotted in raw units. Tapping
 * either legend key swaps to a THIRD mode: one combined chart with both series
 * rescaled onto a shared 0–100 axis (`combinedNormalizedPoints`), for reading
 * correlation ("did the drop in calories line up with the weight drop?") that
 * two side-by-side charts on different scales make hard to eyeball. Each
 * metric still gets its own `HealthStatRow` (This week / Last week), reusing
 * the exact primitives the Weight dashboard already ships rather than
 * inventing new markup.
 */
export interface HealthWeeklyTrendsWidgetProps {
  trend: HealthWeeklyTrendResponse | null;
  testID?: string;
}

/** Whole-number kcal with a thousands separator, or "—" once nothing was logged (never a bare `0`). */
function formatCalories(value: number | null): string {
  return value === null ? '—' : Math.round(value).toLocaleString();
}

function formatWeight(value: number | null): string {
  return value === null ? '—' : `${value}`;
}

/** `+3` / `-3` — never a bare number, so a zero-delta week still reads as "no change". */
function formatDelta(value: number, decimals = 0): string {
  const rounded = decimals > 0 ? Math.round(value * 10 ** decimals) / 10 ** decimals : Math.round(value);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function DeltaChip({
  value,
  unit,
  testID,
  decimals = 0,
}: {
  value: number | null;
  unit: string;
  testID: string;
  decimals?: number;
}) {
  const colors = useAppColors();
  if (value === null) return null;
  // Donor rule, ported verbatim: a DECREASE is favourable (green, down-arrow);
  // an increase — or no change — is the less-favourable reading (red, up-arrow).
  const favorable = value < 0;
  const tone = favorable ? colors.success : colors.error;
  return (
    <View
      style={[styles.deltaChip, { backgroundColor: tone + '1F' }]}
      testID={testID}
      accessible
      accessibilityLabel={`${favorable ? 'Down' : 'Up'} ${formatDelta(Math.abs(value), decimals)} ${unit} versus last week`}
    >
      <Icon name={favorable ? 'arrow-down' : 'arrow-up'} size={12} color={tone} />
      <Typography variant="caption1" weight="semibold" color={tone}>
        {formatDelta(value, decimals)} {unit}
      </Typography>
    </View>
  );
}

export function HealthWeeklyTrendsWidget({
  trend,
  testID = 'health-weekly-trends',
}: HealthWeeklyTrendsWidgetProps) {
  const colors = useAppColors();
  const isDark = useIsDarkMode();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(200, width - 2 * Spacing.lg - 2 * Spacing.base);
  const palette = healthChartPalette(isDark);
  const [showCombined, setShowCombined] = useState(false);

  if (!trend) {
    return (
      <Typography variant="body" color={colors.textSecondary} testID={`${testID}-empty`}>
        Log a few days of meals and weight to see this week compared with last.
      </Typography>
    );
  }

  const thisWeekAvgCalories = trend.this_week.avg_calories > 0 ? trend.this_week.avg_calories : null;
  const lastWeekAvgCalories = trend.last_week.avg_calories > 0 ? trend.last_week.avg_calories : null;
  const thisWeekAvgWeight = averageWeeklyWeight(trend.this_week);
  const lastWeekAvgWeight = averageWeeklyWeight(trend.last_week);

  const caloriesPoints = caloriesChartPoints(trend.this_week);
  const weightPoints = weightChartPoints(trend.this_week);
  const calorieGoal = latestCalorieGoal(trend.this_week);
  const combined = combinedNormalizedPoints(trend.this_week);

  const toggleCombined = () => setShowCombined((on) => !on);
  const combinedToggleHint = showCombined
    ? 'Showing calories and weight on one combined chart. Double tap to split them back into separate charts.'
    : 'Double tap to compare calories and weight on one combined chart.';

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.legendRow}>
        <Pressable
          onPress={toggleCombined}
          hitSlop={Spacing.xxs}
          accessibilityRole="button"
          accessibilityState={{ selected: showCombined }}
          accessibilityLabel={`Calories. ${combinedToggleHint}`}
          style={[
            styles.legendToggle,
            showCombined && { backgroundColor: palette.energyIntake + '1F' },
          ]}
          testID={`${testID}-legend-calories`}
        >
          <LegendKey color={palette.energyIntake} label="Calories" />
        </Pressable>
        <Pressable
          onPress={toggleCombined}
          hitSlop={Spacing.xxs}
          accessibilityRole="button"
          accessibilityState={{ selected: showCombined }}
          accessibilityLabel={`Weight. ${combinedToggleHint}`}
          style={[
            styles.legendToggle,
            showCombined && { backgroundColor: palette.weightDaily + '1F' },
          ]}
          testID={`${testID}-legend-weight`}
        >
          <LegendKey color={palette.weightDaily} label="Weight" />
        </Pressable>
      </View>

      {/* These are 7-day AVERAGES — a different figure from the single day's
          total the Today ring and the calorie card above already show. Without
          this line the two read as three cards silently disagreeing about
          today's number, when only one of them is actually about today. */}
      <Typography variant="caption1" color={colors.textSecondary}>
        Daily averages, not today's totals
      </Typography>

      <HealthStatRow
        stats={[
          {
            label: 'This wk kcal',
            value: formatCalories(thisWeekAvgCalories),
            testID: `${testID}-stat-this-week-calories`,
          },
          {
            label: 'Last wk kcal',
            value: formatCalories(lastWeekAvgCalories),
            testID: `${testID}-stat-last-week-calories`,
          },
          {
            label: 'This wk wt',
            value: formatWeight(thisWeekAvgWeight),
            testID: `${testID}-stat-this-week-weight`,
          },
          {
            label: 'Last wk wt',
            value: formatWeight(lastWeekAvgWeight),
            testID: `${testID}-stat-last-week-weight`,
          },
        ]}
      />

      <View style={styles.deltaRow}>
        <DeltaChip value={trend.change.calories} unit="kcal" testID={`${testID}-delta-calories`} />
        <DeltaChip value={trend.change.weight} unit="" decimals={1} testID={`${testID}-delta-weight`} />
      </View>

      {showCombined ? (
        <View style={styles.chartBlock} testID={`${testID}-chart-combined`}>
          {combined.calories.length > 0 ? (
            <>
              <AppLineChart
                data={combined.calories}
                data2={combined.weight}
                width={chartWidth}
                height={150}
                color={palette.energyIntake}
                color2={palette.weightDaily}
                // The shared axis is a fixed 0–100% domain by construction, so
                // an exact ceiling reads as clean 25%-steps instead of
                // `niceLineMax` padding 100 into an arbitrary 125.
                axisMax={100}
                formatValue={(value) => `${Math.round(value)}%`}
                // Position is normalized, but the label must still read as the
                // real reading — `displayValue` on each point carries that
                // through, formatted per series since kcal and weight are
                // never interchangeable numbers.
                formatPointValue={(value) => Math.round(value).toLocaleString()}
                formatPointValue2={(value) => value.toFixed(1)}
                showValues={combined.calories.length <= Chart.maxLabelledBars}
                valueLabelPosition="below"
              />
              <Typography variant="caption1" color={colors.textSecondary}>
                Calories and weight rescaled to their own 0–100% range for the days you logged
                both, so both trends fit on one chart. Tap a legend to split them apart again.
              </Typography>
            </>
          ) : (
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID={`${testID}-chart-combined-empty`}
            >
              No day this week has both calories and weight logged yet — log both on the same day
              to compare them here.
            </Typography>
          )}
        </View>
      ) : (
        <>
          <View style={styles.chartBlock}>
            {caloriesPoints.length > 0 ? (
              <View testID={`${testID}-chart-calories`}>
                <AppLineChart
                  data={caloriesPoints}
                  width={chartWidth}
                  height={130}
                  color={palette.energyIntake}
                  formatValue={(value) => Math.round(value).toLocaleString()}
                  referenceValue={calorieGoal}
                  referenceLabel={calorieGoal ? `Goal ${calorieGoal.toLocaleString()}` : undefined}
                  // A week never carries more than 7 points — the same threshold
                  // AppBarChart uses to label every bar instead of leaning on the
                  // y-axis alone — so every logged day gets its exact kcal figure
                  // right on the line, not just an approximate gridline read.
                  showValues={caloriesPoints.length <= Chart.maxLabelledBars}
                  // Below, not above: above crowds the goal rule and the top
                  // gridlines whenever a point sits near the ceiling.
                  valueLabelPosition="below"
                />
              </View>
            ) : (
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                testID={`${testID}-chart-calories-empty`}
              >
                No calories logged this week yet.
              </Typography>
            )}
          </View>

          <View style={styles.chartBlock}>
            {weightPoints.length > 0 ? (
              <View testID={`${testID}-chart-weight`}>
                <AppLineChart
                  data={weightPoints}
                  width={chartWidth}
                  height={130}
                  color={palette.weightDaily}
                  // Ticks are computed as floor + n·step, so a whole-number floor
                  // (rather than the raw lowest reading) is what keeps every tick a
                  // clean one-decimal figure instead of a repeating fraction.
                  formatValue={(value) => value.toFixed(1)}
                  baselineValue={Math.floor(Math.min(...weightPoints.map((p) => p.value))) - 1}
                  showValues={weightPoints.length <= Chart.maxLabelledBars}
                  valueLabelPosition="below"
                />
                <Typography variant="caption1" color={colors.textSecondary}>
                  Axis starts near your lowest weight this week, not zero, so day-to-day change is
                  visible.
                </Typography>
              </View>
            ) : (
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                testID={`${testID}-chart-weight-empty`}
              >
                No weight logged this week yet.
              </Typography>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.sm,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.base,
  },
  legendToggle: {
    borderRadius: 8,
    paddingHorizontal: Spacing.xxs,
    paddingVertical: 2,
  },
  deltaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  deltaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: 8,
  },
  chartBlock: {
    gap: Spacing.xs,
  },
});
