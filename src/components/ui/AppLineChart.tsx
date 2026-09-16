import React, { useMemo } from 'react';
import { LineChart } from 'react-native-gifted-charts';

import { useAppColors } from '@theme';
import { Chart, Spacing } from '@theme/designTokens';

/**
 * Shared, token-driven line chart — the line-shaped sibling of `AppBarChart`.
 * Used for time series where a trend matters more than per-period magnitude:
 * mortgage interest-rate history (stepped), interest-paid-over-time, etc.
 *
 * Axis scaling and the data map are pure functions so they can be unit-tested
 * without rendering. Geometry from the `Chart` tokens, colors from
 * `useAppColors()`.
 */

export interface AppLinePoint {
  /** Y value in display units (e.g. percent or dollars). */
  value: number;
  /** X-axis label under the point. */
  label?: string;
  /**
   * The real-world reading to show in the "show values" label, when it is not
   * `value` itself — e.g. a series rescaled onto a shared 0–100 axis so it can
   * be overlaid with a series in different units, where `value` drives the dot's
   * POSITION but the label still has to read as the true kcal/kg/etc figure.
   * Defaults to `value`.
   */
  displayValue?: number;
}

// Same "nice number" ladder AppBarChart uses, so line and bar axes round alike.
const NICE_STEPS = [1, 1.1, 1.25, 1.4, 1.6, 1.8, 2, 2.25, 2.5, 2.75, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 9, 10];

/**
 * Round a raw maximum up to a "nice" axis ceiling with ~15% headroom so the top
 * point never clips. `rawMax <= 0` (or empty series) → 1 so the axis is valid.
 */
export function niceLineMax(rawMax: number): number {
  if (!Number.isFinite(rawMax) || rawMax <= 0) return 1;
  const padded = rawMax * Chart.axisHeadroom;
  const magnitude = Math.pow(10, Math.floor(Math.log10(padded)));
  const normalized = padded / magnitude;
  // normalized ∈ [1, 10) and the ladder's last step is 10, so `find` always
  // matches — the `?? 10` is unreachable defense.
  const niceNormalized = NICE_STEPS.find((s) => normalized <= s) ?? /* istanbul ignore next */ 10;
  return niceNormalized * magnitude;
}

/** Percent formatter for rate axes: 4 → "4%", 4.09 → "4.09%". */
export function formatPercentShort(value: number): string {
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(2)}%`;
}

/**
 * One horizontal rule drawn across a plot — a goal, a target, or an average.
 *
 * Shared by `AppLineChart` and `AppBarChart` (the bar chart imports this type,
 * which is erased at compile time, so the two primitives stay runtime-independent).
 * Values are in the SAME units as the series, so a rule can never be drawn at a
 * position the data is not measured against.
 */
export interface ChartReferenceLine {
  value: number;
  /** Short caption drawn at the rule (e.g. "Goal 2,000"). Keep it to ~10 chars. */
  label?: string;
  /** Rule colour. Defaults to a muted neutral so it never outranks the data. */
  color?: string;
}

/**
 * The chart library exposes exactly three reference-line slots. Three dashed
 * rules on one 180pt plot is already the readable ceiling, so extra rules are
 * dropped rather than silently overwriting slot 3.
 */
export const MAX_REFERENCE_LINES = 3;

interface GiftedReferenceConfig {
  color: string;
  dashWidth: number;
  dashGap: number;
  thickness: number;
  labelText?: string;
  labelTextStyle: { color: string; fontSize: number };
}

/** The three-slot prop shape gifted-charts reads reference rules from. */
export interface ReferenceLineProps {
  showReferenceLine1?: boolean;
  referenceLine1Position?: number;
  referenceLine1Config?: GiftedReferenceConfig;
  showReferenceLine2?: boolean;
  referenceLine2Position?: number;
  referenceLine2Config?: GiftedReferenceConfig;
  showReferenceLine3?: boolean;
  referenceLine3Position?: number;
  referenceLine3Config?: GiftedReferenceConfig;
}

/**
 * Normalize the single-rule props (`referenceValue`/`referenceLabel`/
 * `referenceColor`) and the optional multi-rule `referenceLines` array into one
 * ordered list. The single-rule props always take slot 1, so a caller that only
 * passes them keeps byte-identical output.
 */
export function collectReferenceLines(
  single: { value?: number; label?: string; color?: string },
  extra?: ChartReferenceLine[]
): ChartReferenceLine[] {
  const out: ChartReferenceLine[] = [];
  if (single.value !== undefined && Number.isFinite(single.value)) {
    out.push({ value: single.value, label: single.label, color: single.color });
  }
  for (const line of extra ?? []) {
    if (line && Number.isFinite(line.value)) {
      out.push({ value: line.value, label: line.label, color: line.color });
    }
  }
  return out.slice(0, MAX_REFERENCE_LINES);
}

/**
 * The gifted-charts props for `rules`. An EMPTY list returns `{}` — no
 * `showReferenceLine*` key at all — which is what keeps every existing caller
 * that passes no rule rendering exactly as it did before.
 */
export function referenceLineProps(
  rules: ChartReferenceLine[],
  defaults: { color: string; labelColor: string; fontSize: number }
): ReferenceLineProps {
  const config = (rule: ChartReferenceLine): GiftedReferenceConfig => ({
    color: rule.color ?? defaults.color,
    dashWidth: 4,
    dashGap: 4,
    thickness: 1,
    labelText: rule.label,
    labelTextStyle: { color: defaults.labelColor, fontSize: defaults.fontSize },
  });
  const [first, second, third] = rules;
  return {
    ...(first
      ? {
          showReferenceLine1: true,
          referenceLine1Position: first.value,
          referenceLine1Config: config(first),
        }
      : {}),
    ...(second
      ? {
          showReferenceLine2: true,
          referenceLine2Position: second.value,
          referenceLine2Config: config(second),
        }
      : {}),
    ...(third
      ? {
          showReferenceLine3: true,
          referenceLine3Position: third.value,
          referenceLine3Config: config(third),
        }
      : {}),
  };
}

export interface LineAxis {
  /** Value at the x-axis. `0` unless the caller asked for a truncated axis. */
  floor: number;
  /** Distance from `floor` to the top of the plot (what the library scales to). */
  span: number;
  /** Gap between gridlines, in data units. */
  step: number;
  /** Absolute value at each gridline, bottom to top. */
  ticks: number[];
}

/**
 * Axis geometry for a line chart, with an optional truncated floor.
 *
 * WHY A FLOOR AT ALL. A zero-based axis is the right default and is
 * non-negotiable for bars, where length encodes magnitude. On a LINE chart
 * position encodes value, and some series live in a narrow band a long way from
 * zero — body weight (71.2 … 72.4 kg) being the canonical case. Forced to zero,
 * every real movement collapses into a pixel or two, and a goal rule four
 * kilos away is drawn effectively on top of the data, which defeats the only
 * question the rule exists to answer.
 *
 * A truncated axis exaggerates, so it is opt-in per chart, it is never applied
 * automatically, and the caller is expected to DISCLOSE the floor in visible
 * text next to the chart. Pure and exported so the arithmetic is unit-testable
 * without rendering.
 */
export function lineAxis(
  rawMax: number,
  baselineValue?: number,
  sections: number = Chart.sections,
  /**
   * An EXACT ceiling to use instead of `niceLineMax`'s headroom-padded guess —
   * for series whose domain is already known and fixed, such as a 0–100
   * normalized scale, where "nice-ifying" 100 into 125 would draw a ceiling
   * the data can never actually reach.
   */
  axisMax?: number
): LineAxis {
  const usable = Number.isFinite(baselineValue) && (baselineValue as number) > 0;
  // A floor at or above the data would put the whole series underneath the
  // x-axis, so it is ignored rather than honoured.
  const floor = usable && (baselineValue as number) < rawMax ? (baselineValue as number) : 0;
  const span =
    Number.isFinite(axisMax) && (axisMax as number) > floor
      ? (axisMax as number) - floor
      : niceLineMax(rawMax - floor);
  const step = span / sections;
  return {
    floor,
    span,
    step,
    ticks: Array.from({ length: sections + 1 }, (_, i) => floor + i * step),
  };
}

interface AppLineChartProps {
  data: AppLinePoint[];
  width: number;
  height?: number;
  /** Line + point color. Defaults to the cool chart accent. */
  color?: string;
  /**
   * Optional SECOND series sharing the same x positions and axis — for comparing
   * two running totals (e.g. cumulative interest vs cumulative principal). Both
   * series scale to one ceiling so the crossing point is truthful. Callers render
   * their own legend (the chart stays label-free).
   */
  data2?: AppLinePoint[];
  /** Color of the second series. Defaults to the brand primary. */
  color2?: string;
  /** Formats the y-axis labels. Defaults to a rounded integer. */
  formatValue?: (value: number) => string;
  /**
   * Formats the first series' per-point "show values" label, when it must
   * differ from `formatValue` — e.g. a normalized series whose axis reads in
   * "%" but whose point labels must still read as the real kcal/kg figure.
   * Defaults to `formatValue`, so a caller that only plots what it labels
   * (nearly everyone) is unaffected.
   */
  formatPointValue?: (value: number) => string;
  /** Same, for `data2`. Defaults to `formatPointValue`. */
  formatPointValue2?: (value: number) => string;
  /** Fill under the line (area chart). */
  area?: boolean;
  /** Step line (holds each value flat until the next) — ideal for rate history. */
  stepped?: boolean;
  /** Line thickness in points (default 2). */
  thickness?: number;
  /**
   * A horizontal reference line — a goal, target or average drawn across the
   * plot as a dashed rule.
   *
   * Nearly every chart in the donor Health app is "a series plus a dashed rule"
   * (calories vs goal, steps vs target, weight vs goal), and a series with no
   * rule cannot answer the only question the user is asking: am I above or
   * below the line? The value is in the SAME units as the data and shares the
   * axis ceiling, so the rule can never be drawn at a position the series is
   * not measured against.
   *
   * Passing a value above the natural data maximum raises the ceiling, so a
   * goal you are far from still renders inside the plot instead of clipping.
   */
  referenceValue?: number;
  /** Short caption for the rule (e.g. "Goal 2,000"). Announced to assistive tech. */
  referenceLabel?: string;
  /** Rule colour. Defaults to a muted neutral so it never outranks the data. */
  referenceColor?: string;
  /**
   * ADDITIONAL horizontal rules, drawn alongside `referenceValue`.
   *
   * The donor Health app routinely draws a goal AND one or two averages on the
   * same plot (calories vs goal vs this-week vs last-week; weight vs goal vs
   * period average) — with a single slot the screen has to choose one and the
   * other read is simply unavailable. Rules share the series' units and axis, so
   * they cannot be drawn at a position the data is not measured against, and
   * every rule participates in the ceiling like `referenceValue` does.
   *
   * Opt-in: omit it and the chart renders exactly as it did before. Slot 1 is
   * always `referenceValue`; the library exposes three slots in total and
   * anything past that is dropped rather than overwriting.
   */
  referenceLines?: ChartReferenceLine[];
  /**
   * Start the y-axis HERE instead of at zero.
   *
   * Opt-in, and only for series that live in a narrow band far from zero (body
   * weight is the case this exists for). Position encodes value on a line
   * chart, so truncating is legitimate — but it exaggerates, so a caller that
   * passes this MUST say so in visible text beside the chart. `lineAxis` is the
   * pure geometry, and it ignores a floor at or above the data.
   */
  baselineValue?: number;
  /**
   * Draw each point's own value as small text above it — the donor's per-chart
   * "show values" toggle (`WeightDashboardLayoutManager.showValues`,
   * `WeightChartWidget`'s `number.circle` button). Opt-in and off by default:
   * the donor defaults it off because a label on every point clutters a busy
   * series, same reasoning as `AppBarChart`'s `maxLabelledBars` cap.
   *
   * Labels use `formatValue`, so they read identically to the y-axis text
   * rather than a raw unrounded float.
   */
  showValues?: boolean;
  /**
   * Where a `showValues` label sits relative to its dot. `'above'` (the
   * default) matches the donor's `number.circle` toggle; `'below'` is for a
   * chart whose top gridlines already sit close to the plotted line, where a
   * label above would crowd or clip against them.
   *
   * This is a PREFERENCE, not a guarantee: a point within `LABEL_EDGE_ZONE` of
   * either axis edge is pinned "above" regardless — near the ceiling that is
   * where `niceLineMax`'s headroom lives, and near the floor it is the only
   * direction that does not run into the x-axis date labels underneath.
   */
  valueLabelPosition?: 'above' | 'below';
  /**
   * An EXACT y-axis ceiling — see `lineAxis`'s `axisMax`. Use this for a series
   * whose domain is already fixed and known (a 0–100 normalized scale), so the
   * axis reads clean round numbers instead of a headroom-padded guess.
   */
  axisMax?: number;
}

/**
 * Fraction of the axis span, measured from either end, where a `showValues`
 * label is forced to sit ABOVE its dot regardless of `valueLabelPosition`.
 *
 * `niceLineMax`'s ~15% headroom exists so a label above the tallest point has
 * somewhere to go — but that headroom is only ABOVE the ceiling. There is no
 * matching reserve below the floor (the x-axis labels sit right there), and a
 * `'below'` label near the ceiling lands on top of the next gridline down
 * instead of the empty headroom. Both edges are safest read from above.
 *
 * 0.22 rather than an exact quarter-span: a live device check (2026-08-01)
 * found a point sitting at 21% of the span below the ceiling still crowded
 * the next gridline down when shifted "below" — the zone has to clear that
 * with a little margin, not land exactly on the boundary.
 */
const LABEL_EDGE_ZONE = 0.22;

function pointLabelShiftY(value: number, axis: LineAxis, preferBelow: boolean): number {
  const span = axis.span || 1;
  const ceiling = axis.floor + axis.span;
  const nearCeiling = (ceiling - value) / span <= LABEL_EDGE_ZONE;
  const nearFloor = (value - axis.floor) / span <= LABEL_EDGE_ZONE;
  const below = preferBelow && !nearCeiling && !nearFloor;
  return below ? Chart.pointValueShiftYBelow : Chart.pointValueShiftY;
}

export function AppLineChart({
  data,
  width,
  height = Chart.height,
  color,
  referenceValue,
  referenceLabel,
  referenceColor,
  referenceLines,
  baselineValue,
  data2,
  color2,
  formatValue = (v) => `${Math.round(v)}`,
  formatPointValue,
  formatPointValue2,
  area = false,
  stepped = false,
  thickness = 2,
  showValues = false,
  valueLabelPosition = 'above',
  axisMax,
}: AppLineChartProps) {
  const colors = useAppColors();
  const lineColor = color ?? colors.chartCool;
  const lineColor2 = color2 ?? colors.primary;
  const pointFormat1 = formatPointValue ?? formatValue;
  const pointFormat2 = formatPointValue2 ?? pointFormat1;

  // One ceiling across BOTH series — scaling them independently would move the
  // lines' crossing point and tell the member the wrong story.
  const rawMax = Math.max(
    0,
    ...data.map((d) => d.value),
    ...(data2 ?? []).map((d) => d.value)
  );
  // Muted by default: a rule is context, not data, and must never outrank the
  // series it is being compared against.
  const ruleColor = referenceColor ?? colors.textTertiary;
  const rules = collectReferenceLines(
    { value: referenceValue, label: referenceLabel, color: ruleColor },
    referenceLines
  );

  // EVERY reference rule participates in the ceiling. A goal you are far from
  // must still render inside the plot rather than clipping at the top edge —
  // "you are below the line" is exactly the case the rule exists to show.
  const axis = lineAxis(
    Math.max(rawMax, ...rules.map((rule) => rule.value)),
    baselineValue,
    Chart.sections,
    axisMax
  );
  const yAxisLabelTexts = axis.ticks.map(formatValue);

  // `dataPointText` (rather than the library's own `showValuesAsDataPointsText`,
  // which prints the raw unrounded value) keeps the label in the SAME format as
  // every other number on this chart. `textShiftY` is set PER POINT (the
  // library reads a point's own value ahead of the shared chart-level one) so a
  // point near either axis edge can be pinned "above" even when the chart's
  // own preference is "below" — see `pointLabelShiftY`.
  const points = useMemo(
    () =>
      data.map((d) => ({
        value: d.value,
        label: d.label ?? '',
        ...(showValues
          ? {
              dataPointText: pointFormat1(d.displayValue ?? d.value),
              textShiftY: pointLabelShiftY(d.value, axis, valueLabelPosition === 'below'),
            }
          : {}),
      })),
    [data, showValues, pointFormat1, axis, valueLabelPosition]
  );
  const points2 = useMemo(
    () =>
      data2 && data2.length
        ? data2.map((d) => ({
            value: d.value,
            label: d.label ?? '',
            ...(showValues
              ? {
                  dataPointText: pointFormat2(d.displayValue ?? d.value),
                  textShiftY: pointLabelShiftY(d.value, axis, valueLabelPosition === 'below'),
                }
              : {}),
          }))
        : undefined,
    [data2, showValues, pointFormat2, axis, valueLabelPosition]
  );

  // Fit the points across the available width (no horizontal scroll).
  const spacing =
    points.length > 1
      ? Math.max(Chart.barMinSpacing, (width - Spacing.xl * 2) / (points.length - 1))
      : width / 2;

  const referenceConfig = referenceLineProps(rules, {
    color: colors.textTertiary,
    labelColor: colors.textSecondary,
    fontSize: Chart.xAxisFontSize,
  });

  const yAxisTextStyle = { color: colors.textSecondary, fontSize: Chart.yAxisFontSize };
  const xAxisLabelTextStyle = { color: colors.textSecondary, fontSize: Chart.xAxisFontSize };

  return (
    <LineChart
      {...referenceConfig}
      data={points}
      data2={points2}
      width={width}
      height={height}
      color={lineColor}
      color2={lineColor2}
      thickness={thickness}
      thickness2={thickness}
      dataPointsColor2={lineColor2}
      // Gated on `showValues` so an untouched chart's props are unchanged —
      // the library only reads these when a point actually carries the
      // `dataPointText` set above, but there's no reason to pass them otherwise.
      {...(showValues
        ? {
            textColor1: lineColor,
            textColor2: lineColor2,
            textFontSize1: Chart.pointValueFontSize,
            textFontSize2: Chart.pointValueFontSize,
          }
        : {})}
      // With a truncated axis the library plots `value - yAxisOffset`, so the
      // ceiling it scales to is the SPAN, not the absolute maximum. It subtracts
      // the same offset from the reference rule, which is why the rule is still
      // passed in raw data units.
      maxValue={axis.span}
      yAxisOffset={axis.floor}
      stepValue={axis.step}
      noOfSections={Chart.sections}
      yAxisLabelTexts={yAxisLabelTexts}
      yAxisThickness={0}
      yAxisLabelWidth={Chart.yAxisLabelWidth}
      xAxisThickness={1}
      xAxisColor={colors.borderColor}
      yAxisTextStyle={yAxisTextStyle}
      xAxisLabelTextStyle={xAxisLabelTextStyle}
      rulesColor={colors.divider}
      rulesType="dashed"
      // A `showValues` label is centered on its dot — with the default inset
      // the FIRST point sits close enough to the y-axis label column that its
      // own value text crowds the axis tick text at the same height (found on
      // a live device 2026-08-01). Only widened when there is a label to
      // clear; every existing chart without `showValues` is unaffected.
      initialSpacing={showValues ? Spacing.xl : Spacing.md}
      spacing={spacing}
      dataPointsColor={lineColor}
      curved={!stepped}
      stepChart={stepped}
      areaChart={area}
      startFillColor={area ? lineColor : undefined}
      endFillColor={area ? lineColor : undefined}
      startOpacity={area ? 0.25 : undefined}
      endOpacity={area ? 0.02 : undefined}
      isAnimated
      // Points are sized to fit `width`, so the chart never needs to scroll —
      // disabling the internal ScrollView stops it swallowing the parent's drag.
      disableScroll
    />
  );
}
