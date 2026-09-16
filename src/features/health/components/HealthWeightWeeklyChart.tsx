import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import type { DatedValue } from '../healthDashboards';
import { formatWeightValue, type WeightUnit } from '../healthLocalStorage';
import { formatAxisDate } from '../healthTrends';
import {
  weightBarBucketDays,
  weightPeriodBuckets,
  weightPeriodTitle,
  type WeightPeriodBucket,
  type WeightWindow,
} from '../healthWeightAnalytics';

/**
 * Symply Health — the donor's `weeklyWeightChartSection`, generalised to
 * every window width the ◀ / ▶ navigator offers.
 *
 * It renders the SAME `window` the card above it (WEIGHT SUMMARY) and the
 * window navigator use, so this chart never drifts from what the rest of the
 * screen says: one bar per day at 7 days (the donor's own granularity), and
 * weekly- or monthly-averaged bars beyond that, where a bar per day would be
 * an illegible sliver (`weightBarBucketDays`).
 *
 * The 7- and 30-day windows are real calendar periods (Monday–Sunday weeks,
 * 1st-to-last-day months — `weightWindow`), matching the app-wide week/month
 * convention, not a trailing 7- or 30-day count. That means the CURRENT
 * period can extend past today (e.g. viewing this week on a Wednesday still
 * shows Thursday–Sunday as not-yet-logged slots). The 30- and 90-day windows'
 * own WEEKLY bars carry the same Monday–Sunday convention one level down:
 * `weightPeriodBuckets` groups by each day's own Monday rather than chunking
 * every 7 days from wherever the window starts, so a month that opens
 * mid-week (most of them) still bars out into the SAME calendar weeks the
 * rest of the app shows — with a partial first/last bar, not a misaligned one.
 *
 * At 7 days, a day with no reading is still not skipped: it renders as a
 * tappable empty slot (`onAddForDate`), which is the donor's `onDayTap`
 * affordance — the fastest way to fill in a missed morning is to tap the gap
 * where it should be, not to open the log form and pick a date. Days after
 * today are not tappable — a weight has not been taken yet, so there is
 * nothing to log for them.
 *
 * Beyond 7 days a bar covers many days at once, so there is no single date to
 * hand back to `onAddForDate` — every bar and empty bucket in that view opens
 * the log form for TODAY instead, the fast path back to "just let me log
 * today's weight" while reviewing a longer history.
 */

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface HealthWeightWeeklyChartProps {
  /** The WHOLE weight log, one value per logged day, oldest first, already filtered to one unit. */
  allDaily: DatedValue[];
  /** The window currently selected on the screen — same one the navigator and summary card use. */
  window: WeightWindow;
  /** Today as a 'YYYY-MM-DD' dateKey — where an aggregated-bar tap lands. */
  today: string;
  unit: WeightUnit;
  /** Target weight in `unit`, or null when no goal is set. */
  goal: number | null;
  /** Fired when the member taps an empty day slot (7-day view) or any bar/bucket (longer views). */
  onAddForDate: (dateKey: string) => void;
  testID?: string;
}

/* ------------------------------------------------------------------ */
/* Layout constants                                                    */
/* ------------------------------------------------------------------ */

const TRACK_HEIGHT = 150;
const BAR_WIDTH = 22;
const MIN_BAR_HEIGHT = 6;
const EMPTY_SLOT_HEIGHT = TRACK_HEIGHT * 0.5;
const AGGREGATE_EMPTY_HEIGHT = TRACK_HEIGHT * 0.08;
/** Fraction of headroom added above/below the plotted domain — 10–15%, mid-point. */
const HEADROOM_FRACTION = 0.125;
/** Roughly this many labels show under the bars once there are more than a handful of buckets. */
const MAX_BUCKET_LABELS = 6;

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const WEEKDAY_LABELS: Record<(typeof WEEKDAY_KEYS)[number], string> = {
  sun: 'Su',
  mon: 'Mo',
  tue: 'Tu',
  wed: 'We',
  thu: 'Th',
  fri: 'Fr',
  sat: 'Sa',
};

function weekdayKeyOf(dateKey: string): (typeof WEEKDAY_KEYS)[number] {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return WEEKDAY_KEYS[date.getUTCDay()];
}

function monthLabelOf(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

interface ChartBar {
  key: string;
  dateKey: string;
  label: string;
  showLabel: boolean;
  value: number | null;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function HealthWeightWeeklyChart({
  allDaily,
  window,
  today,
  unit,
  goal,
  onAddForDate,
  testID = 'health-weight-weeklychart',
}: HealthWeightWeeklyChartProps): React.JSX.Element {
  const colors = useAppColors();
  const [showAverage, setShowAverage] = useState(false);
  const [showGoal, setShowGoal] = useState(false);

  const bucketDays = weightBarBucketDays(window.dayKeys.length);
  const perDay = bucketDays === 1;
  const title = weightPeriodTitle(window.dayKeys.length);

  const buckets = useMemo<WeightPeriodBucket[]>(
    () => weightPeriodBuckets(window.dayKeys, allDaily, bucketDays),
    [window.dayKeys, allDaily, bucketDays]
  );

  const bars = useMemo<ChartBar[]>(() => {
    const labelEvery = Math.max(1, Math.ceil(buckets.length / MAX_BUCKET_LABELS));
    return buckets.map((bucket, index) => {
      if (perDay) {
        const weekdayKey = weekdayKeyOf(bucket.end);
        return {
          key: weekdayKey,
          dateKey: bucket.end,
          label: WEEKDAY_LABELS[weekdayKey],
          showLabel: true,
          value: bucket.average,
        };
      }
      return {
        key: String(index),
        dateKey: bucket.end,
        label: bucketDays >= 31 ? monthLabelOf(bucket.start) : formatAxisDate(bucket.end),
        showLabel: index % labelEvery === 0,
        value: bucket.average,
      };
    });
  }, [buckets, perDay, bucketDays]);

  const loggedBars = useMemo(() => bars.filter((bar) => bar.value !== null), [bars]);
  const entriesCount = useMemo(
    () => allDaily.filter((d) => d.date >= window.start && d.date <= window.end).length,
    [allDaily, window.start, window.end]
  );

  const windowAverage = useMemo(() => {
    if (loggedBars.length === 0) return null;
    const sum = loggedBars.reduce((total, bar) => total + (bar.value as number), 0);
    return round1(sum / loggedBars.length);
  }, [loggedBars]);

  const rangeText = useMemo(() => {
    if (loggedBars.length === 0) return '—';
    const values = loggedBars.map((bar) => bar.value as number);
    const low = Math.min(...values);
    const high = Math.max(...values);
    return `${formatWeightValue(low)}–${formatWeightValue(high)} ${unit}`;
  }, [loggedBars, unit]);

  const changeText = useMemo(() => {
    if (loggedBars.length < 2) return '—';
    const first = loggedBars[0].value as number;
    const last = loggedBars[loggedBars.length - 1].value as number;
    const delta = round1(last - first);
    const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
    return `${sign}${formatWeightValue(Math.abs(delta))} ${unit}`;
  }, [loggedBars, unit]);

  // The plotted domain: every bar this window carries, plus whichever
  // reference lines are switched on — so toggling a line never clips it off
  // the top or bottom of the track.
  const { domainMin, domainRange } = useMemo(() => {
    const candidates = loggedBars.map((bar) => bar.value as number);
    if (showAverage && windowAverage !== null) candidates.push(windowAverage);
    if (showGoal && goal !== null) candidates.push(goal);

    if (candidates.length === 0) return { domainMin: 0, domainRange: 1 };

    const min = Math.min(...candidates);
    const max = Math.max(...candidates);
    const span = max - min;
    const pad = span > 0 ? span * HEADROOM_FRACTION : Math.max(Math.abs(min) * 0.1, 1);
    const lo = min - pad;
    const hi = max + pad;
    return { domainMin: lo, domainRange: hi - lo || 1 };
  }, [loggedBars, showAverage, windowAverage, showGoal, goal]);

  function ratioFor(value: number): number {
    return Math.max(0, Math.min(1, (value - domainMin) / domainRange));
  }

  const averageLineVisible = showAverage && windowAverage !== null;
  const goalLineVisible = showGoal && goal !== null;

  return (
    <Card
      variant="filled"
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      testID={testID}
    >
      <View style={styles.headerRow}>
        <Typography
          variant="footnote"
          color={colors.textSecondary}
          style={styles.sectionLabel}
          testID={`${testID}-title`}
        >
          {title}
        </Typography>
      </View>

      <View style={styles.chipRow}>
        <Pressable
          onPress={() => setShowAverage((on) => !on)}
          accessibilityRole="button"
          accessibilityState={{ selected: showAverage }}
          testID={`${testID}-toggle-average`}
          style={[
            styles.chip,
            {
              borderColor: showAverage ? colors.primary : colors.borderColor,
              backgroundColor: showAverage ? colors.primary : 'transparent',
            },
          ]}
        >
          <Typography
            variant="footnote"
            weight="semibold"
            color={showAverage ? colors.white : colors.textSecondary}
          >
            Average
          </Typography>
        </Pressable>

        {goal === null ? (
          <View
            testID={`${testID}-toggle-goal`}
            style={[styles.chip, styles.chipDisabled, { borderColor: colors.borderColor }]}
          >
            <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
              No goal
            </Typography>
          </View>
        ) : (
          <Pressable
            onPress={() => setShowGoal((on) => !on)}
            accessibilityRole="button"
            accessibilityState={{ selected: showGoal }}
            testID={`${testID}-toggle-goal`}
            style={[
              styles.chip,
              {
                borderColor: showGoal ? colors.success : colors.borderColor,
                backgroundColor: showGoal ? colors.success : 'transparent',
              },
            ]}
          >
            <Typography
              variant="footnote"
              weight="semibold"
              color={showGoal ? colors.white : colors.textSecondary}
            >
              {`Goal ${formatWeightValue(goal)} ${unit}`}
            </Typography>
          </Pressable>
        )}

        <View style={styles.chipSpacer} />

        {windowAverage !== null ? (
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID={`${testID}-average-caption`}
          >
            {`Ø ${formatWeightValue(windowAverage)} ${unit}`}
          </Typography>
        ) : null}
      </View>

      <View style={styles.chartWrap}>
        <View style={styles.trackRow} testID={`${testID}-track`}>
          {bars.map((bar) =>
            perDay ? (
              <View key={bar.key} style={styles.trackColumn}>
                {bar.value !== null ? (
                  <>
                    <Typography
                      variant="caption2"
                      weight="semibold"
                      color={colors.textPrimary}
                      numberOfLines={1}
                      style={styles.barValue}
                      testID={`${testID}-barvalue-${bar.key}`}
                    >
                      {formatWeightValue(bar.value)}
                    </Typography>
                    <View
                      testID={`${testID}-bar-${bar.key}`}
                      style={[
                        styles.bar,
                        {
                          height: Math.max(MIN_BAR_HEIGHT, ratioFor(bar.value) * TRACK_HEIGHT),
                          backgroundColor: colors.primary,
                        },
                      ]}
                    />
                  </>
                ) : bar.dateKey > today ? (
                  // A Monday-start week can extend past today (e.g. viewing the
                  // current week on a Wednesday) — those days have no reading YET,
                  // but are not loggable, so no "+" affordance is offered for them.
                  <View
                    testID={`${testID}-future-${bar.key}`}
                    style={[styles.emptySlot, styles.futureSlot, { borderColor: colors.borderColor }]}
                  />
                ) : (
                  <Pressable
                    onPress={() => onAddForDate(bar.dateKey)}
                    accessibilityRole="button"
                    accessibilityLabel={`Log weight for ${bar.dateKey}`}
                    testID={`${testID}-add-${bar.key}`}
                    hitSlop={8}
                    style={[styles.emptySlot, { borderColor: colors.borderColor }]}
                  >
                    <Typography variant="body" weight="semibold" color={colors.textSecondary}>
                      +
                    </Typography>
                  </Pressable>
                )}
              </View>
            ) : (
              <Pressable
                key={bar.key}
                onPress={() => onAddForDate(today)}
                accessibilityRole="button"
                accessibilityLabel="Log weight for today"
                testID={`${testID}-bucket-${bar.key}`}
                style={styles.trackColumn}
              >
                {bar.value !== null ? (
                  <Typography
                    variant="caption2"
                    weight="semibold"
                    color={colors.textPrimary}
                    numberOfLines={1}
                    style={styles.barValue}
                    testID={`${testID}-bucketvalue-${bar.key}`}
                  >
                    {formatWeightValue(bar.value)}
                  </Typography>
                ) : null}
                <View
                  style={[
                    styles.aggregateBar,
                    bar.value !== null
                      ? {
                          height: Math.max(MIN_BAR_HEIGHT, ratioFor(bar.value) * TRACK_HEIGHT),
                          backgroundColor: colors.primary,
                        }
                      : { height: AGGREGATE_EMPTY_HEIGHT, backgroundColor: colors.borderColor },
                  ]}
                />
              </Pressable>
            )
          )}

          {averageLineVisible ? (
            <View
              testID={`${testID}-average-line`}
              pointerEvents="none"
              style={[
                styles.referenceLine,
                {
                  bottom: ratioFor(windowAverage as number) * TRACK_HEIGHT,
                  borderColor: colors.textSecondary,
                },
              ]}
            />
          ) : null}

          {goalLineVisible ? (
            <View
              testID={`${testID}-goal-line`}
              pointerEvents="none"
              style={[
                styles.referenceLine,
                {
                  bottom: ratioFor(goal as number) * TRACK_HEIGHT,
                  borderColor: colors.success,
                },
              ]}
            />
          ) : null}
        </View>

        <View style={styles.labelsRow}>
          {bars.map((bar) => (
            <Typography
              key={bar.key}
              variant="caption2"
              color={colors.textSecondary}
              style={styles.dayLabel}
              testID={`${testID}-daylabel-${bar.key}`}
            >
              {bar.showLabel ? bar.label : ''}
            </Typography>
          ))}
        </View>
      </View>

      <View style={[styles.statsRow, { borderTopColor: colors.borderColor }]}>
        <View style={styles.statCell}>
          <Typography variant="caption2" color={colors.textSecondary}>
            Entries
          </Typography>
          <Typography
            variant="body"
            weight="semibold"
            color={colors.textPrimary}
            testID={`${testID}-entries`}
          >
            {`${entriesCount}/${window.dayKeys.length}`}
          </Typography>
        </View>

        <View style={[styles.statDivider, { backgroundColor: colors.borderColor }]} />

        <View style={styles.statCell}>
          <Typography variant="caption2" color={colors.textSecondary}>
            Range
          </Typography>
          <Typography
            variant="body"
            weight="semibold"
            color={colors.textPrimary}
            testID={`${testID}-range`}
          >
            {rangeText}
          </Typography>
        </View>

        <View style={[styles.statDivider, { backgroundColor: colors.borderColor }]} />

        <View style={styles.statCell}>
          <Typography variant="caption2" color={colors.textSecondary}>
            Change
          </Typography>
          <Typography
            variant="body"
            weight="semibold"
            color={colors.textPrimary}
            testID={`${testID}-change`}
          >
            {changeText}
          </Typography>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipSpacer: {
    flex: 1,
  },
  chartWrap: {
    gap: Spacing.xxs,
  },
  trackRow: {
    flexDirection: 'row',
    height: TRACK_HEIGHT,
    position: 'relative',
  },
  trackColumn: {
    flex: 1,
    height: TRACK_HEIGHT,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  bar: {
    width: BAR_WIDTH,
    borderTopLeftRadius: CornerRadius.xs,
    borderTopRightRadius: CornerRadius.xs,
  },
  barValue: {
    textAlign: 'center',
    marginBottom: 2,
  },
  aggregateBar: {
    width: '55%',
    borderTopLeftRadius: CornerRadius.xs,
    borderTopRightRadius: CornerRadius.xs,
  },
  emptySlot: {
    width: BAR_WIDTH + 10,
    height: EMPTY_SLOT_HEIGHT,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: CornerRadius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  futureSlot: {
    opacity: 0.35,
  },
  referenceLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
  },
  labelsRow: {
    flexDirection: 'row',
  },
  dayLabel: {
    flex: 1,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
  },
});
