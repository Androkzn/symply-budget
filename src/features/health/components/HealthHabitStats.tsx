import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, ProgressRing, Typography } from '@components/ui';
import { AppBarChart } from '@components/ui/AppBarChart';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors, useIsDarkMode } from '@theme';

import { healthChartPalette } from '../healthDashboards';
import { isDoneOn, isScheduledOn, streakOf, type Habit } from '../healthHabitsStorage';
import { habitLabelEvery, habitRateBars, habitStatistics } from '../healthTrends';
import { weightWindow } from '../healthWeightAnalytics';

import { HealthGoalBar } from './HealthStatTiles';
import { HealthStatRow } from './HealthWeightDashboard';

/**
 * Symply Health — the donor's `HabitStatisticsView`, ported whole.
 *
 * The donor's habit area computes a completion rate and prints it as a bare
 * number; the chart that gives it a shape is the one donor `Chart` block with
 * no RN counterpart that is not gated on HealthKit or on the privacy review.
 * This is that chart, plus the three cards around it: the overall ring, the
 * streak leaderboard and the per-habit breakdown.
 *
 * ### Three rules the donor does not apply
 *
 * All three live in `habitStatistics` and each changes what the picture says:
 *
 *  - **A habit only counts on the days it is DUE.** The rule is the Habits
 *    module's own `isScheduledOn`, passed in rather than re-derived, so a
 *    weekdays-only habit is never scored as missed on a Sunday.
 *  - **A habit only counts from the day it was created.** The donor divides
 *    every day of the period by `habits.count`, so adding a habit today drags
 *    the whole month down to a rate the member could not have achieved.
 *  - **A day with nothing due is absent, not 0%.** Days before the first habit
 *    existed — and rest days on a custom schedule — are left out of the series
 *    rather than drawn as a run of empty bars.
 *
 * ### Why the axis is pinned at 100
 *
 * A completion rate is BOUNDED. The chart primitive's usual "nice" ceiling adds
 * ~15% headroom, which on a percentage lands at 125 and prints gridlines at
 * 31 / 63 / 94 / 125% — implying a day could clear its own maximum. The axis is
 * pinned with `axisMax`, so it divides 100 evenly into quarters.
 *
 * Rendered as a self-contained card so the Habits tab (owned elsewhere) and the
 * Trends tab can both mount it without either owning the maths.
 */

export const HABIT_STATS_PERIODS = [
  { key: 'week' as const, label: 'Week', days: 7 },
  { key: 'month' as const, label: 'Month', days: 30 },
];

export type HabitStatsPeriod = (typeof HABIT_STATS_PERIODS)[number]['key'];

export interface HealthHabitStatsProps {
  /** The habit list, exactly as `loadHabits()` returns it. */
  habits: Habit[];
  /** Today's local day key, `YYYY-MM-DD`. */
  today: string;
  /** Plot width in points. */
  width: number;
  /** Which period opens first. Defaults to the donor's Week. */
  initialPeriod?: HabitStatsPeriod;
  testID?: string;
}

export function HealthHabitStats({
  habits,
  today,
  width,
  initialPeriod = 'week',
  testID = 'health-habit-stats',
}: HealthHabitStatsProps) {
  const colors = useAppColors();
  const palette = healthChartPalette(useIsDarkMode());
  const [period, setPeriod] = useState<HabitStatsPeriod>(initialPeriod);

  const days = HABIT_STATS_PERIODS.find((p) => p.key === period)?.days ?? 7;
  // The same window helper the Weight tab navigates with, so "7 days" means the
  // same seven calendar days on every surface in the app.
  const window = useMemo(() => weightWindow(today, days), [today, days]);
  // The schedule rule comes from the module that owns habits, so "due today?"
  // is answered identically here and on the Habits tab.
  const stats = useMemo(
    () =>
      habitStatistics(habits, window.dayKeys, {
        isScheduledOn: (habit, date) => isScheduledOn(habit, date),
        isDoneOn: (habit, date) => isDoneOn(habit, date),
        streakOf: (ticked) => streakOf(ticked, today),
      }),
    [habits, window.dayKeys, today]
  );
  const bars = useMemo(
    () => habitRateBars(stats.days, palette.habitCompletion),
    [stats.days, palette.habitCompletion]
  );
  const labelEvery = habitLabelEvery(stats.days.length);

  const ratePercent = Math.round(stats.overallRate * 100);
  const chartLabel =
    stats.daysCounted > 0
      ? `Habit completion over ${window.label}: ${ratePercent}% of ticks landed, ` +
        `${stats.fullDays} of ${stats.daysCounted} days complete.`
      : 'Habit completion: no habits existed in this range yet.';

  return (
    <Card
      variant="filled"
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      testID={testID}
    >
      <View style={styles.headRow}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          HABIT STATISTICS
        </Typography>
        <View style={[styles.periodToggle, { borderColor: colors.borderColor }]}>
          {HABIT_STATS_PERIODS.map((option) => {
            const active = option.key === period;
            return (
              <Pressable
                key={option.key}
                onPress={() => setPeriod(option.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Last ${option.days} days`}
                testID={`${testID}-period-${option.key}`}
                style={[styles.periodOption, active && { backgroundColor: colors.primary }]}
              >
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={active ? colors.white : colors.textSecondary}
                >
                  {option.label}
                </Typography>
              </Pressable>
            );
          })}
        </View>
      </View>

      {habits.length === 0 || stats.daysCounted === 0 ? (
        <Typography variant="body" color={colors.textSecondary} testID={`${testID}-empty`}>
          Add a habit and tick it off for a few days — this is where the completion rate, the
          streaks and the per-habit breakdown appear.
        </Typography>
      ) : (
        <>
          <Typography variant="caption1" color={colors.textSecondary}>
            {window.label} · a day counts only the habits that were DUE on it and already existed,
            so a rest day on a weekdays-only habit is not a miss and a habit added yesterday does
            not drag the whole period down.
          </Typography>

          {/* Overall completion — the donor's ring, directly labelled. */}
          <View style={styles.overallRow}>
            <ProgressRing
              progress={stats.overallRate}
              size={96}
              stroke={10}
              color={palette.habitCompletion}
              label="complete"
              testID={`${testID}-ring`}
            />
            <View style={styles.overallStats}>
              <HealthStatRow
                stats={[
                  {
                    label: 'All done',
                    value: `${stats.fullDays} d`,
                    testID: `${testID}-full-days`,
                  },
                  {
                    label: 'Missed',
                    value: `${stats.missedDays} d`,
                    testID: `${testID}-missed-days`,
                  },
                  {
                    label: 'Avg streak',
                    value: `${stats.averageStreak} d`,
                    testID: `${testID}-average-streak`,
                  },
                ]}
              />
            </View>
          </View>

          {/* Daily completion rate — the donor's one uncounted Chart block. */}
          <Typography variant="caption1" color={colors.textSecondary}>
            Share of that day&apos;s habits you ticked off.
          </Typography>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={chartLabel}
            testID={`${testID}-chart`}
          >
            <AppBarChart
              data={bars}
              width={width}
              axisMax={100}
              hideValueLabels
              formatValue={(v) => `${Math.round(v)}%`}
            />
          </View>
          {labelEvery > 1 ? (
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID={`${testID}-axis-note`}
            >
              x-axis labels every {labelEvery} days.
            </Typography>
          ) : null}

          {/* Best streaks — the donor's top-three leaderboard. */}
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            BEST STREAKS
          </Typography>
          {stats.leaders.length === 0 ? (
            <Typography
              variant="body"
              color={colors.textSecondary}
              testID={`${testID}-streaks-empty`}
            >
              Tick a habit on two days in a row and the streak board fills in.
            </Typography>
          ) : (
            <View style={styles.rows}>
              {stats.leaders.map((leader, index) => (
                <View
                  key={leader.id}
                  style={[styles.leaderRow, { borderTopColor: colors.borderColor }]}
                  testID={`${testID}-leader-${index + 1}`}
                  accessible
                  accessibilityLabel={`Rank ${index + 1}: ${leader.name}, longest run ${leader.bestStreak} days`}
                >
                  <View style={[styles.rank, { backgroundColor: colors.backgroundMain }]}>
                    <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
                      {index + 1}
                    </Typography>
                  </View>
                  <Icon name={leader.icon} size={18} color={colors.textSecondary} />
                  <Typography variant="body" color={colors.textPrimary} style={styles.leaderName}>
                    {leader.name}
                  </Typography>
                  <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                    {leader.bestStreak} d
                  </Typography>
                </View>
              ))}
            </View>
          )}
          <Typography variant="caption1" color={colors.textSecondary}>
            The longest unbroken run inside this period — not the streak running today, which can
            reach back before it.
          </Typography>

          {/* Per-habit breakdown — the donor's rate + progress bar per row. */}
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            BY HABIT
          </Typography>
          <View style={styles.rows}>
            {stats.perHabit.map((row) => (
              <View key={row.id} style={styles.habitRow} testID={`${testID}-habit-${row.id}`}>
                <View style={styles.habitHead}>
                  <Icon name={row.icon} size={16} color={colors.textSecondary} />
                  <Typography variant="footnote" color={colors.textPrimary} style={styles.leaderName}>
                    {row.name}
                  </Typography>
                  <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
                    {Math.round(row.rate * 100)}%
                  </Typography>
                </View>
                <HealthGoalBar
                  label="Days ticked"
                  value={row.completed}
                  target={row.trackedDays}
                  suffix=" d"
                  color={palette.habitCompletion}
                  testID={`${testID}-habit-bar-${row.id}`}
                />
              </View>
            ))}
          </View>
          <Typography variant="caption1" color={colors.textSecondary}>
            Each bar divides by the days that habit was due in this period and already existed, so
            it is measured only against the days it could actually have been ticked.
          </Typography>
        </>
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
  periodToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  periodOption: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    minWidth: 56,
    alignItems: 'center',
  },
  overallRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
  },
  overallStats: {
    flex: 1,
  },
  rows: {
    gap: Spacing.xs,
  },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.xs,
  },
  rank: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderName: {
    flex: 1,
  },
  habitRow: {
    gap: Spacing.xxs,
  },
  habitHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
});
