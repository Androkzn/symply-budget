import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { AppLineChart, type AppLinePoint } from '@components/ui/AppLineChart';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import {
  BODY_METRIC_LABELS,
  BODY_METRICS,
  bodyEntryDay,
  formatMeasurement,
  type BodyEntry,
  type BodyMetric,
} from '../healthBodyStorage';
import { dateKeyOf, todayDateKey } from '../healthLocalStorage';
import { formatAxisDate } from '../healthTrends';

import { HealthStatTiles } from './HealthStatTiles';

/**
 * Body tab — per-metric trends and the donor's "progress compare".
 *
 * The donor's Body tab charts ONE metric at a time and never charts body fat at
 * all; this rebuild keeps the one-metric-per-chart rule (a waist in cm and a
 * body-fat percentage on one axis would draw a change that never happened) and
 * adds the body-fat trend as its own chart with its own `%` axis.
 *
 * Everything derived is a pure function so the arithmetic can be pinned without
 * rendering — the same reason `summarizeBody` lives in the storage module.
 *
 * Body PHOTOS stay out on purpose (documents/apps/symply-health/PARITY_PLAN.md
 * files them under "Later — privacy"), which also excludes the donor's
 * photo-derived AI measurement and silhouette surfaces.
 */

/* ------------------------------------------------------------------ */
/* Ranges                                                              */
/* ------------------------------------------------------------------ */

/** Days back from today; `0` means "every reading ever logged". */
export const BODY_RANGES = [30, 90, 180, 365, 0] as const;
export type BodyRange = (typeof BODY_RANGES)[number];

/** The donor's own range vocabulary (`1M`/`3M`/`6M`/`1Y`/`All`). */
export const BODY_RANGE_LABELS: Record<BodyRange, string> = {
  30: '1M',
  90: '3M',
  180: '6M',
  365: '1Y',
  0: 'All',
};

/** Spoken form, for the accessibility label on the chart. */
export const BODY_RANGE_SPOKEN: Record<BodyRange, string> = {
  30: 'the past month',
  90: 'the past 3 months',
  180: 'the past 6 months',
  365: 'the past year',
  0: 'all time',
};

/** Max x-axis labels before the series is thinned (callers must disclose it). */
const MAX_AXIS_LABELS = 8;

/* ------------------------------------------------------------------ */
/* Site grouping                                                       */
/* ------------------------------------------------------------------ */

/**
 * The donor's manual-entry sections (Upper Body / Arms / Legs / Other), used to
 * group whatever sites the storage layer exposes.
 *
 * The lists are deliberately WIDER than today's `BODY_METRICS`, so a site the
 * storage layer starts exposing lands in the right group with no change here.
 * Anything unrecognised falls into "Other" rather than silently disappearing.
 *
 * Within a section the order runs down the body and, for the comprehensive
 * sites 0131 added, out from the landmark the member already knows: `leftArm`
 * (bicep at its widest) then `leftArmMid`, `waist` (narrowest) then the three
 * fixed belly points. The detailed sites sit NEXT TO the primary one they
 * refine rather than in a section of their own, because "upper belly" is only
 * meaningful beside "waist".
 *
 * The belly points and the chest points stay in **Upper body** with the waist
 * and chest they qualify: splitting a "Core" section out would separate `waist`
 * from `hips` for the sake of a heading.
 */
export const BODY_SITE_GROUPS: ReadonlyArray<{
  id: string;
  title: string;
  metrics: readonly string[];
}> = [
  {
    id: 'upper',
    title: 'Upper body',
    metrics: [
      'neck',
      'shoulders',
      'backWidth',
      'chest',
      'chestUpper',
      'chestUnder',
      'waist',
      'waistNavel',
      'waistUpper',
      'waistLower',
      'iliac',
      'hips',
    ],
  },
  {
    id: 'arms',
    title: 'Arms',
    metrics: [
      'arm',
      'leftArm',
      'leftArmMid',
      'rightArm',
      'rightArmMid',
      'forearm',
      'leftForearm',
      'leftForearmMid',
      'rightForearm',
      'rightForearmMid',
      'leftWrist',
      'rightWrist',
    ],
  },
  {
    id: 'legs',
    title: 'Legs',
    metrics: [
      'thigh',
      'leftThigh',
      'leftThighMid',
      'leftThighLower',
      'rightThigh',
      'rightThighMid',
      'rightThighLower',
      'leftKnee',
      'rightKnee',
      'calf',
      'leftCalf',
      'leftCalfMid',
      'leftCalfLower',
      'rightCalf',
      'rightCalfMid',
      'rightCalfLower',
      'leftAnkle',
      'rightAnkle',
    ],
  },
  // The donor's "Other" section, named for what is in it.
  { id: 'wholeBody', title: 'Whole body', metrics: ['torsoLength', 'inseam'] },
  { id: 'composition', title: 'Composition', metrics: ['bodyFat'] },
];

export interface BodyMetricGroup {
  id: string;
  title: string;
  metrics: BodyMetric[];
}

/**
 * Group the supplied sites into the donor's sections, dropping empty ones.
 *
 * Within a section the order is the SECTION's (neck → shoulders → chest →
 * waist → hips), not the order the storage layer happens to list them in — the
 * anatomical run is what makes the grid scannable, and it stays stable if the
 * storage array is ever reordered.
 */
export function groupBodyMetrics(metrics: readonly BodyMetric[]): BodyMetricGroup[] {
  const claimed = new Set<string>();
  const groups: BodyMetricGroup[] = [];

  for (const group of BODY_SITE_GROUPS) {
    const inGroup = group.metrics.filter((metric) =>
      (metrics as readonly string[]).includes(metric),
    ) as BodyMetric[];
    if (inGroup.length === 0) continue;
    inGroup.forEach((metric) => claimed.add(metric));
    groups.push({ id: group.id, title: group.title, metrics: inGroup });
  }

  const rest = metrics.filter((metric) => !claimed.has(metric));
  if (rest.length > 0) groups.push({ id: 'other', title: 'Other', metrics: [...rest] });
  return groups;
}

/** Every site measured as a LENGTH — i.e. everything but the percentage. */
export function lengthBodyMetrics(metrics: readonly BodyMetric[] = BODY_METRICS): BodyMetric[] {
  return metrics.filter((metric) => metric !== 'bodyFat');
}

/* ------------------------------------------------------------------ */
/* Per-metric trend series                                             */
/* ------------------------------------------------------------------ */

export interface BodyMetricSeries {
  points: AppLinePoint[];
  /** The unit every plotted point shares; null when nothing is plotted. */
  unit: string | null;
  /** 1 = every point labelled; N = every Nth. Callers MUST disclose N > 1. */
  labelEvery: number;
  first: number | null;
  last: number | null;
  average: number | null;
  change: number | null;
  /** Number of distinct logged days in the plotted series. */
  days: number;
  /**
   * Units found in range that are NOT plotted. Converting them onto the shared
   * axis would draw a jump the body never made, so they are excluded and
   * disclosed instead.
   */
  excludedUnits: string[];
}

/**
 * A body entry's day key.
 *
 * Re-exported from the storage layer rather than redefined here: since the Body
 * tab gained date navigation, `date` (the day it was TAKEN) and `loggedAt` (the
 * day it was typed) are routinely different, and two definitions of "which day
 * is this" would put a back-dated reading on one date in the chart and another
 * in the compare card.
 */
const dayKeyOf = bodyEntryDay;

/**
 * One point per logged day for a single metric, oldest-first, labelled by DATE.
 *
 * Only readings sharing the LATEST reading's unit are plotted (same rule as
 * `buildWeightSeries` and `summarizeBody`): a 78 cm and a 31 in waist on one
 * axis is a 47-unit cliff that never happened.
 */
export function buildBodyMetricSeries(
  entries: BodyEntry[],
  metric: BodyMetric,
  rangeDays: number,
  today = todayDateKey(),
): BodyMetricSeries {
  const forMetric = entries.filter((entry) => entry.metric === metric);
  const unit = forMetric[0]?.unit ?? null;

  // Noon anchors keep the subtraction DST-proof.
  const cutoff =
    rangeDays > 0
      ? dateKeyOf(
          new Date(
            new Date(`${today}T12:00:00`).getTime() - (rangeDays - 1) * 86_400_000,
          ).toISOString(),
        )
      : null;
  const inRange = forMetric.filter((entry) => cutoff === null || dayKeyOf(entry) >= cutoff);

  const excludedUnits = [
    ...new Set(inRange.filter((entry) => entry.unit !== unit).map((entry) => entry.unit)),
  ];

  // `entries` arrive newest-first, so the first hit for a day is that day's reading.
  const byDay = new Map<string, number>();
  for (const entry of inRange) {
    if (entry.unit !== unit) continue;
    const key = dayKeyOf(entry);
    if (!byDay.has(key)) byDay.set(key, entry.value);
  }

  const ordered = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const labelEvery = Math.max(1, Math.ceil(ordered.length / MAX_AXIS_LABELS));
  const points: AppLinePoint[] = ordered.map(([key, value], index) => ({
    value,
    label: index % labelEvery === 0 ? formatAxisDate(key) : undefined,
  }));

  const values = ordered.map(([, value]) => value);
  const first = values.length > 0 ? values[0] : null;
  const last = values.length > 0 ? values[values.length - 1] : null;
  const average =
    values.length > 0
      ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
      : null;

  return {
    points,
    unit: values.length > 0 ? unit : null,
    labelEvery,
    first,
    last,
    average,
    change: first !== null && last !== null ? Math.round((last - first) * 10) / 10 : null,
    days: ordered.length,
    excludedUnits,
  };
}

/* ------------------------------------------------------------------ */
/* Two-date comparison (the donor's "progress compare")                */
/* ------------------------------------------------------------------ */

export interface BodyCompareRow {
  metric: BodyMetric;
  baseline: BodyEntry | null;
  current: BodyEntry | null;
  /** Signed change, or null when a side is missing or the unit changed. */
  delta: number | null;
  /** Both sides exist but were logged in different units — no honest delta. */
  unitChanged: boolean;
}

/** Every day that carries at least one reading, newest-first. */
export function bodyMeasurementDates(entries: BodyEntry[]): string[] {
  const dates = new Set<string>();
  for (const entry of entries) dates.add(dayKeyOf(entry));
  return [...dates].sort((a, b) => b.localeCompare(a));
}

/**
 * Deltas across EVERY metric between two chosen days.
 *
 * The donor only ever compares "latest vs the one before"; letting the user pin
 * a baseline is the point of this surface. A unit switch between the two days
 * reports `unitChanged` rather than a converted number.
 */
export function compareBodyDates(
  entries: BodyEntry[],
  baselineDate: string,
  currentDate: string,
  metrics: readonly BodyMetric[] = BODY_METRICS,
): BodyCompareRow[] {
  // `entries` are newest-first, so `find` yields that day's latest reading.
  const pick = (metric: BodyMetric, date: string) =>
    entries.find((entry) => entry.metric === metric && dayKeyOf(entry) === date) ?? null;

  return metrics.map((metric) => {
    const baseline = pick(metric, baselineDate);
    const current = pick(metric, currentDate);
    const unitChanged = !!baseline && !!current && baseline.unit !== current.unit;
    return {
      metric,
      baseline,
      current,
      unitChanged,
      delta:
        baseline && current && !unitChanged
          ? Math.round((current.value - baseline.value) * 10) / 10
          : null,
    };
  });
}

export interface BodyCompareSummary {
  /** Rows with a real, same-unit delta. */
  compared: number;
  /** Of those, the ones that actually moved. */
  changed: number;
  /** Rows blocked by a unit switch. */
  unitChanged: number;
}

export function summarizeBodyCompare(rows: BodyCompareRow[]): BodyCompareSummary {
  return {
    compared: rows.filter((row) => row.delta !== null).length,
    changed: rows.filter((row) => row.delta !== null && row.delta !== 0).length,
    unitChanged: rows.filter((row) => row.unitChanged).length,
  };
}

/* ------------------------------------------------------------------ */
/* Trend card                                                          */
/* ------------------------------------------------------------------ */

interface HealthBodyTrendCardProps {
  entries: BodyEntry[];
  /** Sites the selector offers. One entry hides the selector entirely. */
  metrics: readonly BodyMetric[];
  chartWidth: number;
  title: string;
  /** testID prefix, e.g. `health-body-trend`. */
  idPrefix: string;
  /** Line colour — one hue per chart, never per point. */
  color?: string;
}

/**
 * One metric, one axis, one chart. Rendered twice by the Body tab: once for the
 * length sites and once for body fat, so a percentage never shares a scale with
 * a circumference.
 */
export function HealthBodyTrendCard({
  entries,
  metrics,
  chartWidth,
  title,
  idPrefix,
  color,
}: HealthBodyTrendCardProps) {
  const colors = useAppColors();
  const [requested, setRequested] = useState<BodyMetric>(metrics[0]);
  const [range, setRange] = useState<BodyRange>(90);

  // The offered set can change (a site appears once storage exposes it), so a
  // stale selection falls back rather than rendering an empty chart forever.
  const metric = metrics.includes(requested) ? requested : metrics[0];
  const label = BODY_METRIC_LABELS[metric];

  const series = useMemo(
    () => buildBodyMetricSeries(entries, metric, range),
    [entries, metric, range],
  );

  const unit = series.unit ?? '';
  const hasTrend = series.points.length >= 2;
  const changeLabel =
    series.change === null
      ? '—'
      : `${series.change > 0 ? '+' : ''}${formatMeasurement(series.change)} ${unit}`;

  // The chart's headline, spoken as one sentence for assistive tech.
  const direction =
    series.change === null || series.change === 0
      ? 'unchanged'
      : `${series.change < 0 ? 'down' : 'up'} ${formatMeasurement(Math.abs(series.change))} ${unit}`;
  const chartLabel = `${label} trend over ${BODY_RANGE_SPOKEN[range]}: latest ${
    series.last !== null ? `${formatMeasurement(series.last)} ${unit}` : 'no reading'
  }, ${direction} across ${series.days} logged ${series.days === 1 ? 'day' : 'days'}.`;

  return (
    <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
      <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
        {title}
      </Typography>

      {/* Range — the donor's 1M/3M/6M/1Y/All */}
      <View style={[styles.rangeRow, { borderColor: colors.borderColor }]}>
        {BODY_RANGES.map((option) => {
          const active = option === range;
          return (
            <Pressable
              key={option}
              onPress={() => setRange(option)}
              accessibilityRole="button"
              accessibilityLabel={`Range ${BODY_RANGE_LABELS[option]}`}
              accessibilityState={{ selected: active }}
              testID={`${idPrefix}-range-${option}`}
              style={[styles.rangeOption, active && { backgroundColor: colors.primary }]}
            >
              <Typography
                variant="caption1"
                weight="semibold"
                color={active ? colors.white : colors.textSecondary}
              >
                {BODY_RANGE_LABELS[option]}
              </Typography>
            </Pressable>
          );
        })}
      </View>

      {/* Metric selector — omitted when the card charts a single site */}
      {metrics.length > 1 ? (
        <View style={styles.chipGrid}>
          {metrics.map((option) => {
            const active = option === metric;
            return (
              <Pressable
                key={option}
                onPress={() => setRequested(option)}
                accessibilityRole="button"
                accessibilityLabel={`Chart ${BODY_METRIC_LABELS[option]}`}
                accessibilityState={{ selected: active }}
                testID={`${idPrefix}-metric-${option}`}
                style={[
                  styles.chip,
                  {
                    borderColor: active ? colors.primary : colors.borderColor,
                    backgroundColor: active ? colors.primary : 'transparent',
                  },
                ]}
              >
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={active ? colors.white : colors.textSecondary}
                >
                  {BODY_METRIC_LABELS[option]}
                </Typography>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {hasTrend ? (
        <View accessible accessibilityLabel={chartLabel} testID={`${idPrefix}-chart`}>
          <AppLineChart
            data={series.points}
            width={chartWidth}
            color={color}
            area
            formatValue={(value) => formatMeasurement(Math.round(value * 10) / 10)}
          />
        </View>
      ) : (
        // An empty range says so in words. A flat zero line would read as a real
        // measurement of zero.
        <Typography
          variant="body"
          color={colors.textSecondary}
          testID={`${idPrefix}-empty`}
        >
          {series.days === 0
            ? `No ${label.toLowerCase()} readings in ${BODY_RANGE_SPOKEN[range]}.`
            : `Log ${label.toLowerCase()} on at least two days in this range to see a trend line.`}
        </Typography>
      )}

      {hasTrend && series.labelEvery > 1 ? (
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          testID={`${idPrefix}-axis-note`}
        >
          x-axis labels every {series.labelEvery} logged days.
        </Typography>
      ) : null}

      {series.excludedUnits.length > 0 ? (
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          testID={`${idPrefix}-unit-note`}
        >
          Readings in {series.excludedUnits.join(', ')} are not plotted — converting them would
          draw a change that never happened.
        </Typography>
      ) : null}

      <HealthStatTiles
        stats={[
          {
            label: 'Latest',
            value: series.last !== null ? `${formatMeasurement(series.last)} ${unit}` : '—',
            icon: 'body-measurements',
            testID: `${idPrefix}-latest`,
          },
          {
            label: 'Average',
            value: series.average !== null ? `${formatMeasurement(series.average)} ${unit}` : '—',
            icon: 'insights',
            testID: `${idPrefix}-average`,
          },
          {
            label: 'Change',
            value: changeLabel,
            icon: 'trends',
            testID: `${idPrefix}-change`,
          },
        ]}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Compare card                                                        */
/* ------------------------------------------------------------------ */

interface HealthBodyCompareCardProps {
  entries: BodyEntry[];
  metrics?: readonly BodyMetric[];
  idPrefix?: string;
}

/** `2026-07-13` → `13 Jul` for a chip; the full key stays in the a11y label. */
function chipDate(dateKey: string): string {
  return formatAxisDate(dateKey);
}

/**
 * Pick a baseline day and a comparison day, and see every site's delta at once.
 *
 * The donor's own compare is implicit (latest vs the reading before it), which
 * cannot answer "how far have I come since I started".
 */
export function HealthBodyCompareCard({
  entries,
  metrics = BODY_METRICS,
  idPrefix = 'health-body-compare',
}: HealthBodyCompareCardProps) {
  const colors = useAppColors();
  const dates = useMemo(() => bodyMeasurementDates(entries), [entries]);

  // Held loosely: a selection that no longer exists (an entry was deleted)
  // resolves back to the natural default instead of showing an empty compare.
  const [pickedBaseline, setPickedBaseline] = useState<string | null>(null);
  const [pickedCurrent, setPickedCurrent] = useState<string | null>(null);

  const currentDate =
    pickedCurrent && dates.includes(pickedCurrent) ? pickedCurrent : (dates[0] ?? '');
  // Default to the earliest day — but never to the day already on the other
  // side, which would compare a reading with itself and report "no change"
  // across the board.
  const defaultBaseline =
    dates[dates.length - 1] === currentDate ? dates[0] : dates[dates.length - 1];
  const baselineDate =
    pickedBaseline && dates.includes(pickedBaseline) && pickedBaseline !== currentDate
      ? pickedBaseline
      : (defaultBaseline ?? '');

  const rows = useMemo(
    () => compareBodyDates(entries, baselineDate, currentDate, metrics),
    [entries, baselineDate, currentDate, metrics],
  );
  const summary = summarizeBodyCompare(rows);

  if (dates.length < 2) {
    return (
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          COMPARE
        </Typography>
        <Typography variant="body" color={colors.textSecondary} testID={`${idPrefix}-empty`}>
          Log measurements on at least two different days to compare a baseline with a later
          reading.
        </Typography>
      </Card>
    );
  }

  const renderDateRow = (
    kind: 'baseline' | 'current',
    selected: string,
    onSelect: (date: string) => void,
  ) => (
    <View style={styles.chipGrid}>
      {dates.map((date) => {
        const active = date === selected;
        return (
          <Pressable
            key={date}
            onPress={() => onSelect(date)}
            accessibilityRole="button"
            accessibilityLabel={`${kind === 'baseline' ? 'Baseline' : 'Compare with'} ${date}`}
            accessibilityState={{ selected: active }}
            testID={`${idPrefix}-${kind}-${date}`}
            style={[
              styles.chip,
              {
                borderColor: active ? colors.primary : colors.borderColor,
                backgroundColor: active ? colors.primary : 'transparent',
              },
            ]}
          >
            <Typography
              variant="caption1"
              weight="semibold"
              color={active ? colors.white : colors.textSecondary}
            >
              {chipDate(date)}
            </Typography>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
      <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
        COMPARE
      </Typography>

      <Typography variant="caption1" color={colors.textSecondary}>
        Baseline
      </Typography>
      {renderDateRow('baseline', baselineDate, setPickedBaseline)}

      <Typography variant="caption1" color={colors.textSecondary}>
        Compared with
      </Typography>
      {renderDateRow('current', currentDate, setPickedCurrent)}

      <Typography
        variant="caption1"
        color={colors.textSecondary}
        testID={`${idPrefix}-summary`}
      >
        {summary.compared === 0
          ? 'No site was measured on both days.'
          : `${summary.changed} of ${summary.compared} measured ${
              summary.compared === 1 ? 'site' : 'sites'
            } changed between ${baselineDate} and ${currentDate}.`}
      </Typography>

      {rows.map((row) => {
        const label = BODY_METRIC_LABELS[row.metric];
        const baselineText = row.baseline
          ? `${formatMeasurement(row.baseline.value)} ${row.baseline.unit}`
          : '—';
        const currentText = row.current
          ? `${formatMeasurement(row.current.value)} ${row.current.unit}`
          : '—';

        let deltaText: string;
        if (row.unitChanged) deltaText = 'unit changed';
        // `delta` is only non-null when BOTH sides exist, so naming `current`
        // in the same guard lets the unit be read without a `?? ''` that would
        // print a bare number if it ever fired.
        else if (row.delta === null || row.current === null) deltaText = '—';
        else if (row.delta === 0) deltaText = 'no change';
        else
          deltaText = `${row.delta > 0 ? '+' : '−'}${formatMeasurement(Math.abs(row.delta))} ${
            row.current.unit
          }`;

        return (
          <View
            key={row.metric}
            style={[styles.compareRow, { borderTopColor: colors.borderColor }]}
            testID={`${idPrefix}-row-${row.metric}`}
            accessible
            accessibilityLabel={`${label}: ${baselineText} to ${currentText}, ${deltaText}`}
          >
            <Typography variant="body" color={colors.textPrimary} style={styles.compareLabel}>
              {label}
            </Typography>
            <Typography variant="footnote" color={colors.textSecondary}>
              {baselineText} → {currentText}
            </Typography>
            <View style={styles.compareDelta}>
              {row.delta !== null && row.delta !== 0 ? (
                <Icon
                  name={row.delta < 0 ? 'arrow-down' : 'arrow-up'}
                  size={12}
                  color={colors.primary}
                />
              ) : null}
              <Typography
                variant="footnote"
                weight="semibold"
                color={row.delta !== null && row.delta !== 0 ? colors.primary : colors.textSecondary}
              >
                {deltaText}
              </Typography>
            </View>
          </View>
        );
      })}

      {summary.unitChanged > 0 ? (
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          testID={`${idPrefix}-unit-note`}
        >
          A site logged in one unit and then another has no honest delta — re-log it in a single
          unit to compare.
        </Typography>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  rangeRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  rangeOption: {
    flex: 1,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  chip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  compareLabel: {
    flexShrink: 1,
  },
  compareDelta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
});
