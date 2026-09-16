import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { AppBarChart } from '@components/ui/AppBarChart';
import { AppLineChart, type ChartReferenceLine } from '@components/ui/AppLineChart';
import { CornerRadius, Spacing, useAppColors, useIsDarkMode } from '@theme';

import {
  healthChartPalette,
  labelEveryFor,
  movingAverage,
  weeklyAverages,
  weeklyBars,
  weightDailyValues,
  weightExtremes,
  MAX_AXIS_LABELS,
} from '../healthDashboards';
import { formatWeightValue, type WeightEntry } from '../healthLocalStorage';
import { buildWeightSeries } from '../healthTrends';
import { weightAxisFloor, weightChangeBars } from '../healthWeightAnalytics';

/**
 * Symply Health — the donor's "Weight Stats" dashboard.
 *
 * Three reads of the same series, in the order a member asks for them:
 *
 *   1. **Where is it going?** the daily line with a trailing 7-day average over
 *      it, both on ONE ceiling (`AppLineChart`'s `data2`) so the smoothed curve
 *      sits truthfully against the raw points. Two scales would move their
 *      crossing point and invent a trend.
 *   2. **How is it going week to week?** weekly-average bars, which strip the
 *      day-to-day water noise a scale reports.
 *   3. **What are the numbers?** latest · change over the range · average · min
 *      · max, as tiles — five single figures are tiles, not five one-bar charts.
 *
 * The component derives from props and renders; it never loads anything. All of
 * the arithmetic lives in `../healthDashboards.ts` and `../healthWeightAnalytics.ts`
 * and is unit-tested there.
 *
 * ── The chart-mode toggle ───────────────────────────────────────────────────
 *
 * The donor offers a line/bar toggle over the SAME weight values. Bars over
 * weight levels cannot be drawn honestly: a bar encodes magnitude by its length
 * from zero, so a zero-based bar chart makes 71.2 and 71.9 kg the same bar,
 * and the donor's own truncated bar axis (`chartYScale(domain: min...max)`)
 * turns a 1 kg move into a cliff. So the toggle here switches the READING, not
 * just the mark: **Trend** is the level as a line (position encodes value, so a
 * truncated axis is legitimate — and is disclosed in words), and **Change** is
 * the day-on-day difference as diverging bars from a real zero. Both are
 * labelled in the UI, and the caption says which one is on screen.
 *
 * Other donor deltas worth naming: the donor's chart labels its x-axis with a
 * bare day-of-month number (`"d"`), which collides the moment a range spans two
 * months — here every label is a real date. The donor also has no smoothing on
 * this screen at all (it draws a flat rule at the period mean); the trailing
 * average is ported from its `WeightTabViewModel`, which is the only place the
 * donor smooths anything.
 */

/** Trailing window for the smoothed line, in logged days. */
export const WEIGHT_AVERAGE_WINDOW = 7;

export type WeightChartMode = 'trend' | 'change';

export interface HealthWeightDashboardProps {
  /** Raw weight log, newest first — the shape `loadWeightLog()` returns. */
  entries: WeightEntry[];
  /** The window every figure is derived over, oldest first. */
  dayKeys: string[];
  /** Plot width in points. */
  width: number;
  /** Trailing average window (default 7 logged days). */
  averageWindow?: number;
  /**
   * Target weight in the SAME unit as the series, drawn as a dashed rule.
   * A goal in a different unit must be converted by the caller — this component
   * never converts, because a converted measurement invents precision.
   */
  goal?: number | null;
  /** Which reading is on screen. Defaults to the trend line. */
  mode?: WeightChartMode;
  /** Supply to render the Trend/Change toggle. Omit and the toggle is hidden. */
  onModeChange?: (mode: WeightChartMode) => void;
  /** Draw a rule at the window's mean weight (the donor's "Averages" toggle). */
  showAverageLine?: boolean;
  /** Supply to render the average-rule toggle. */
  onToggleAverageLine?: () => void;
  /** Print each point's own value above it (the donor's `number.circle` toggle). */
  showValues?: boolean;
  /** Supply to render the show-values toggle. */
  onToggleShowValues?: () => void;
  /**
   * Drop the five stat tiles (latest · change · average · min · max).
   *
   * The Weight tab prints these figures inside its own reorderable widgets
   * (`weightHistory`, plus `dataStack`/`weeklyChange` when a member re-adds
   * them via Customise), so repeating them here would show every figure
   * twice.
   *
   * It does NOT drop the weekly-average bars. It used to, and since the Weight
   * tab is the only caller that passes it, the donor's `weeklyWeightChartSection`
   * rendered nowhere on the tab that owns weight — no widget draws weekly means,
   * so hiding it here hid it outright rather than deduplicating it.
   */
  compact?: boolean;
  testID?: string;
}

export function HealthWeightDashboard({
  entries,
  dayKeys,
  width,
  averageWindow = WEIGHT_AVERAGE_WINDOW,
  goal = null,
  mode = 'trend',
  onModeChange,
  showAverageLine = false,
  onToggleAverageLine,
  showValues = false,
  onToggleShowValues,
  compact = false,
  testID = 'health-weight-dashboard',
}: HealthWeightDashboardProps) {
  const colors = useAppColors();
  const palette = healthChartPalette(useIsDarkMode());

  const series = useMemo(() => buildWeightSeries(entries, dayKeys), [entries, dayKeys]);
  const daily = useMemo(() => weightDailyValues(entries, dayKeys), [entries, dayKeys]);
  const average = useMemo(
    () => movingAverage(series.points, averageWindow),
    [series.points, averageWindow]
  );
  const weeks = useMemo(() => weeklyAverages(daily.values), [daily.values]);
  const bars = useMemo(() => weeklyBars(weeks), [weeks]);
  const extremes = useMemo(() => weightExtremes(series.points), [series.points]);
  const changeBars = useMemo(
    () =>
      weightChangeBars(
        daily.values,
        { down: palette.caloriesOnTarget, up: palette.caloriesOver },
        MAX_AXIS_LABELS
      ),
    [daily.values, palette.caloriesOnTarget, palette.caloriesOver]
  );

  const unit = series.unit ?? '';
  const withUnit = (value: number | null) =>
    value === null ? '—' : `${formatWeightValue(value)} ${unit}`;
  const changeLabel =
    series.change === null
      ? '—'
      : `${series.change > 0 ? '+' : ''}${formatWeightValue(series.change)} ${unit}`;

  const hasTrend = series.points.length >= 2;
  const weeklyLabelEvery = labelEveryFor(weeks.length, MAX_AXIS_LABELS);
  const smoothedEnd = average.length > 0 ? average[average.length - 1].value : null;

  // The rules the member asked for, and the floor that makes them readable.
  const goalRule = typeof goal === 'number' && Number.isFinite(goal) ? goal : null;
  const averageRule = showAverageLine ? series.average : null;
  // The goal takes the primary slot; the period average rides alongside it.
  // These used to be mutually exclusive — the primitive drew a single rule, so
  // turning the average on while a goal was set silently drew nothing new, and
  // the two figures the donor shows TOGETHER ("where I am aiming" against
  // "where I have actually been") could never be compared.
  const rule = goalRule ?? averageRule;
  const ruleLabel = goalRule !== null ? `Goal ${formatWeightValue(goalRule)}` : 'Average';
  const extraRules = useMemo<ChartReferenceLine[]>(
    () =>
      goalRule !== null && averageRule !== null
        ? [{ value: averageRule, color: colors.textTertiary }]
        : [],
    [goalRule, averageRule, colors.textTertiary]
  );
  // EVERY rule participates in the floor: a target below every reading has to
  // stay inside the plot, since "you are above your goal" is the whole point.
  const floor = useMemo(
    () =>
      weightAxisFloor([
        ...series.points.map((p) => p.value),
        ...(rule !== null ? [rule] : []),
        ...extraRules.map((r) => r.value),
      ]),
    [series.points, rule, extraRules]
  );

  // Every chart announces its headline figure — a screen reader cannot see a
  // line, so the label has to carry the number the picture is making.
  const trendLabel = hasTrend
    ? `Weight trend over ${dayKeys.length} days: latest ${withUnit(series.last)}, ` +
      `${series.change === null || series.change === 0 ? 'unchanged' : `${changeLabel} over the range`}. ` +
      `${averageWindow}-day average now ${withUnit(smoothedEnd)}.` +
      (goalRule !== null ? ` Goal ${withUnit(goalRule)}.` : '') +
      (averageRule !== null ? ` Period average ${withUnit(averageRule)}.` : '')
    : 'Weight trend: not enough logged days to draw a line.';
  const changeChartLabel =
    changeBars.length > 0
      ? `Daily weight change over ${dayKeys.length} days: ${changeBars.length} changes, ` +
        `latest ${changeBars[changeBars.length - 1].value > 0 ? 'up' : 'down'} ` +
        `${formatWeightValue(Math.abs(changeBars[changeBars.length - 1].value))} ${unit}.`
      : 'Daily weight change: not enough logged days to compare.';
  const weeklyLabel =
    weeks.length > 0
      ? `Weekly average weight: ${weeks.length} ${weeks.length === 1 ? 'week' : 'weeks'}, ` +
        `latest week ${withUnit(weeks[weeks.length - 1].average)}.`
      : 'Weekly average weight: nothing logged in this range.';

  return (
    <Card
      variant="filled"
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      testID={testID}
    >
      <View style={styles.headRow}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          WEIGHT
        </Typography>
        {onModeChange ? (
          <View style={[styles.modeToggle, { borderColor: colors.borderColor }]}>
            {(['trend', 'change'] as const).map((option) => {
              const active = option === mode;
              return (
                <Pressable
                  key={option}
                  onPress={() => onModeChange(option)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={option === 'trend' ? 'Trend line' : 'Daily change bars'}
                  testID={`${testID}-mode-${option}`}
                  style={[styles.modeOption, active && { backgroundColor: colors.primary }]}
                >
                  <Typography
                    variant="caption1"
                    weight="semibold"
                    color={active ? colors.white : colors.textSecondary}
                  >
                    {option === 'trend' ? 'Trend' : 'Change'}
                  </Typography>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      {mode === 'change' ? (
        changeBars.length > 0 ? (
          <>
            <Typography variant="caption1" color={colors.textSecondary}>
              Each bar is the difference from the previous day you logged — down is green, up is
              orange. The first logged day has nothing to compare against, so it is not shown.
            </Typography>
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel={changeChartLabel}
              testID={`${testID}-change-chart`}
            >
              <AppBarChart
                data={changeBars}
                width={width}
                allowNegative
                formatValue={(v) => `${v > 0 ? '+' : ''}${formatWeightValue(Math.round(v * 10) / 10)}`}
              />
            </View>
          </>
        ) : (
          <Typography
            variant="body"
            color={colors.textSecondary}
            testID={`${testID}-change-empty`}
          >
            Log weight on at least two days in this range to see day-to-day change.
          </Typography>
        )
      ) : hasTrend ? (
        <>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={trendLabel}
            testID={`${testID}-chart`}
          >
            <AppLineChart
              data={series.points}
              data2={average}
              width={width}
              color={palette.weightDaily}
              color2={palette.weightAverage}
              baselineValue={floor ?? undefined}
              referenceValue={rule ?? undefined}
              referenceLabel={rule !== null ? ruleLabel : undefined}
              referenceColor={goalRule !== null ? colors.primary : undefined}
              referenceLines={extraRules}
              formatValue={(v) => formatWeightValue(Math.round(v * 10) / 10)}
              showValues={showValues}
            />
          </View>

          {/* Two series always get a legend — identity must never rest on colour alone. */}
          <View style={styles.legendRow} testID={`${testID}-legend`}>
            <LegendKey color={palette.weightDaily} label="Logged weight" />
            <LegendKey color={palette.weightAverage} label={`${averageWindow}-day average`} />
            {rule !== null ? (
              <LegendKey
                color={goalRule !== null ? colors.primary : colors.textTertiary}
                label={goalRule !== null ? `Goal ${withUnit(goalRule)}` : `Average ${withUnit(rule)}`}
                testID={`${testID}-legend-rule`}
              />
            ) : null}
            {extraRules.length > 0 && averageRule !== null ? (
              <LegendKey
                color={colors.textTertiary}
                label={`Average ${withUnit(averageRule)}`}
                testID={`${testID}-legend-average`}
              />
            ) : null}
          </View>

          {series.labelEvery > 1 && (
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID="health-trends-axis-note"
            >
              x-axis labels every {series.labelEvery} logged days.
            </Typography>
          )}
        </>
      ) : (
        <Typography variant="body" color={colors.textSecondary} testID="health-trends-weight-empty">
          Log weight on at least two days in this range to see a trend line.
        </Typography>
      )}

      {(onToggleAverageLine || onToggleShowValues) && mode === 'trend' ? (
        <View style={styles.toggleRow}>
          {onToggleAverageLine ? (
            <Pressable
              onPress={onToggleAverageLine}
              accessibilityRole="button"
              accessibilityState={{ selected: showAverageLine }}
              testID={`${testID}-toggle-average`}
              style={[
                styles.ruleToggle,
                {
                  borderColor: colors.borderColor,
                  backgroundColor: showAverageLine ? colors.primary + '1F' : 'transparent',
                },
              ]}
            >
              <Typography
                variant="caption1"
                weight="semibold"
                color={showAverageLine ? colors.primary : colors.textSecondary}
              >
                {showAverageLine ? 'Average line on' : 'Average line off'}
              </Typography>
            </Pressable>
          ) : null}

          {onToggleShowValues ? (
            <Pressable
              onPress={onToggleShowValues}
              accessibilityRole="button"
              accessibilityState={{ selected: showValues }}
              testID={`${testID}-toggle-values`}
              style={[
                styles.ruleToggle,
                {
                  borderColor: colors.borderColor,
                  backgroundColor: showValues ? colors.primary + '1F' : 'transparent',
                },
              ]}
            >
              <Typography
                variant="caption1"
                weight="semibold"
                color={showValues ? colors.primary : colors.textSecondary}
              >
                {showValues ? 'Values shown' : 'Values hidden'}
              </Typography>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {weeks.length > 0 ? (
        <>
          <Typography variant="caption1" color={colors.textSecondary}>
            Weekly average — each bar is the mean of the days you logged that week.
          </Typography>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={weeklyLabel}
            testID={`${testID}-weekly`}
          >
            <AppBarChart
              data={bars}
              width={width}
              formatValue={(v) => formatWeightValue(Math.round(v * 10) / 10)}
            />
          </View>
          {weeklyLabelEvery > 1 && (
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID={`${testID}-weekly-axis-note`}
            >
              x-axis labels every {weeklyLabelEvery} weeks.
            </Typography>
          )}
        </>
      ) : (
        <Typography variant="body" color={colors.textSecondary} testID={`${testID}-weekly-empty`}>
          No weigh-ins in this range yet, so there is no weekly average to show.
        </Typography>
      )}

      {compact ? null : (
        <View style={styles.tiles}>
          <HealthStatRow
            stats={[
              { label: 'Latest', value: withUnit(series.last), testID: 'health-trends-weight-latest' },
              { label: 'Change', value: changeLabel, testID: 'health-trends-weight-change' },
              {
                label: 'Average',
                value: withUnit(series.average),
                testID: 'health-trends-weight-average',
              },
              { label: 'Lowest', value: withUnit(extremes.min), testID: `${testID}-min` },
              { label: 'Highest', value: withUnit(extremes.max), testID: `${testID}-max` },
            ]}
          />
        </View>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                 */
/* ------------------------------------------------------------------ */

/** A swatch + caption. Text wears a text token; only the swatch carries the series colour. */
export function LegendKey({
  color,
  label,
  testID,
}: {
  color: string;
  label: string;
  testID?: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.legendKey} testID={testID}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
    </View>
  );
}

/**
 * Tile row used by both dashboards. Kept local rather than reusing
 * `HealthStatTiles` because these rows carry five figures, and that component's
 * `flexBasis: 30%` grid wraps them into a ragged two-and-three.
 */
export function HealthStatRow({
  stats,
}: {
  stats: Array<{ label: string; value: string; testID?: string }>;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.statGrid}>
      {stats.map((stat) => (
        <View
          key={stat.label}
          style={[styles.statTile, { backgroundColor: colors.backgroundMain }]}
          testID={stat.testID}
          accessible
          accessibilityLabel={`${stat.label}: ${stat.value}`}
        >
          <Typography variant="caption1" color={colors.textSecondary}>
            {stat.label}
          </Typography>
          <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
            {stat.value}
          </Typography>
        </View>
      ))}
    </View>
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
    minWidth: 56,
    alignItems: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
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
  legendKey: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  tiles: {
    marginTop: Spacing.xxs,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  statTile: {
    flexGrow: 1,
    flexBasis: '18%',
    minWidth: 64,
    borderRadius: CornerRadius.sm,
    padding: Spacing.xs,
    gap: Spacing.xxs,
  },
});
