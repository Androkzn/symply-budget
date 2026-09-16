import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';

import { useAppColors } from '@theme';
import { Chart, CornerRadius, Spacing } from '@theme/designTokens';
import { formatMoneyUnits, useDisplayCurrency } from '@utils/money';

// The reference-rule shape and its slot mapping live with `AppLineChart` and are
// shared rather than duplicated, so a goal drawn on a line and the same goal
// drawn on bars can never disagree about dash pattern, ordering or the 3-slot
// ceiling. The dependency is one-way (the line chart imports nothing from here)
// and free at runtime — both primitives already load the same chart package.
import {
  collectReferenceLines,
  referenceLineProps,
  type ChartReferenceLine,
} from './AppLineChart';
import { Typography } from './Typography';

/**
 * Shared, token-driven vertical bar chart.
 *
 * Single source of truth for every bar chart in the app (budget spend trend,
 * savings net trend, utility monthly spend, …) so they read identically:
 *   - value labels above each bar for short, all-positive series; series that
 *     are dense OR contain negative bars fall back to the compact,
 *     currency-formatted y-axis (per-bar labels on a diverging chart collide
 *     with the x-axis labels sitting on the zero line)
 *   - auto-scaled "nice" axis ceiling with headroom so nothing clips
 *   - a minor top corner radius on every bar (`CornerRadius.xs`)
 *   - all geometry from the `Chart` tokens, all colors from `useAppColors()`
 *
 * Callers only supply the data (value + label, plus an optional per-bar color)
 * and the width; everything else stays consistent across screens.
 */

export interface AppBarDatum {
  /** Bar value in display units (e.g. dollars). May be negative when `allowNegative`. */
  value: number;
  /** X-axis label rendered under the bar. */
  label: string;
  /** Per-bar color override. Defaults to the brand chart color. */
  frontColor?: string;
}

/** One bar within a group (multi-series compare). Color is required to tell series apart. */
export interface AppBarGroupBar {
  value: number;
  frontColor: string;
}

/** A cluster of bars sharing one x-axis label (e.g. one month, N years side by side). */
export interface AppBarGroup {
  label: string;
  bars: AppBarGroupBar[];
}

/** One segment of a stacked bar. Positive segments stack up; a negative one drops below the axis. */
export interface AppBarStackSegment {
  value: number;
  color: string;
}

/** One stacked bar: N segments sharing a single x-axis label (e.g. spending + net = income). */
export interface AppBarStack {
  label: string;
  segments: AppBarStackSegment[];
}

interface AppBarChartProps {
  /** Single-series data. Provide this OR `groups` OR `stacks`. */
  data?: AppBarDatum[];
  /** Grouped/multi-series data (side-by-side bars per label). Takes precedence over `data`. */
  groups?: AppBarGroup[];
  /** Stacked data (segments stacked into one bar per label). Takes precedence over `data`/`groups`. */
  stacks?: AppBarStack[];
  width: number;
  height?: number;
  /** Formats the value shown above each bar / on the y-axis. Defaults to compact currency. */
  formatValue?: (value: number) => string;
  /** Hide the per-bar value labels (shown by default for short series). */
  hideValueLabels?: boolean;
  /** Allow bars below the x-axis (e.g. negative net savings). */
  allowNegative?: boolean;
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
   * same plot (calories vs goal vs this-week vs last-week average) — with a
   * single slot the screen has to pick one and the other read is unavailable.
   * Every rule shares the bars' units and axis, and every rule participates in
   * the ceiling exactly like `referenceValue`.
   *
   * Opt-in: omit it and the chart renders exactly as it did before. Slot 1 is
   * always `referenceValue`; three slots exist and extras are dropped.
   */
  referenceLines?: ChartReferenceLine[];
  /**
   * Pin the axis ceiling instead of auto-scaling to a "nice" rounded maximum.
   *
   * For a BOUNDED measure the auto ceiling is wrong rather than generous: a
   * completion rate maxes out at 100%, and `niceAxisMax(100)` lands on 125,
   * printing gridlines at 31% / 63% / 94% / 125% and implying a day could clear
   * its own maximum. Pass the real bound and the axis divides it evenly.
   *
   * Opt-in and rarely correct — an unbounded series (money, calories, minutes)
   * must keep the auto ceiling, since a hand-pinned one silently clips the day
   * that overshot. A value below the tallest bar is ignored for the same reason.
   */
  axisMax?: number;
}

/** A flattened grouped bar in gifted-charts terms (pure geometry, unit-testable). */
export interface FlatGroupedBar {
  value: number;
  frontColor: string;
  /** Group label on the FIRST bar of each group, '' on the rest. */
  label: string;
  /** Gap rendered AFTER this bar: small between siblings, larger between groups. */
  spacing: number;
  /** True for the first bar of a group (carries the shared x-axis label). */
  isGroupStart: boolean;
}

/**
 * Flatten groups into the linear bar list gifted-charts renders, inserting a
 * small gap between sibling bars and a larger gap between groups so clusters
 * read as one x-axis tick. Pure so it can be unit-tested without rendering.
 */
export function flattenBarGroups(
  groups: AppBarGroup[],
  opts: { intraSpacing: number; groupSpacing: number }
): FlatGroupedBar[] {
  const out: FlatGroupedBar[] = [];
  for (const group of groups) {
    const n = group.bars.length;
    for (let j = 0; j < n; j++) {
      const isLast = j === n - 1;
      out.push({
        value: group.bars[j].value,
        frontColor: group.bars[j].frontColor,
        label: j === 0 ? group.label : '',
        spacing: isLast ? opts.groupSpacing : opts.intraSpacing,
        isGroupStart: j === 0,
      });
    }
  }
  return out;
}

/**
 * Corner radius on a bar's FREE end: the top for a bar growing up from the axis,
 * the visible bottom tip for one hanging below it. Keeps the rounded corner on
 * the open end (never the end fused to the zero line).
 *
 * NOTE the `barBorder*` prefix: gifted-charts' single-series/grouped renderer
 * reads per-bar radius from `item.barBorderTopLeftRadius` (etc.), NOT the plain
 * RN `borderTopLeftRadius` names. Passing the unprefixed names is silently
 * ignored and the bar renders square. (Stacked segments are the exception — see
 * `stackChartData` — where the library reads the unprefixed names.)
 *
 * NOTE ALSO that this is the TOP radius for negative bars too: gifted-charts
 * draws a negative bar as a normal upward bar and flips the whole wrapper
 * (`rotateZ: '180deg'` in its `RenderBars`), so the bar's own top edge is what
 * lands at the visual BOTTOM. Setting `barBorderBottom*` on a negative bar
 * rounds the end welded to the zero line and leaves the visible tip square.
 * (Stacked deficit segments are NOT rotated — they position below the axis — so
 * `stackChartData` rounds their real bottom.)
 */
const FREE_END_RADIUS = {
  barBorderTopLeftRadius: CornerRadius.xs,
  barBorderTopRightRadius: CornerRadius.xs,
} as const;

/**
 * Gap between the y-axis gutter and the first bar (gifted-charts `initialSpacing`).
 * Shared with the custom x-axis label row's left inset — the two must agree or
 * the labels drift off their bars.
 */
const INITIAL_SPACING = Spacing.md;

/**
 * Compact currency for chart labels: 1234 → "$1.2k", 45 → "$45", -60 → "-$60".
 * Input is whole units, and the glyph follows Settings → Currency.
 */
export function formatChartCurrencyShort(value: number): string {
  return formatMoneyUnits(value, { abbreviate: true });
}

// Nice-number ladder for axis ceilings. Finer than the classic 1/2/5/10 steps
// (each rung is ≤~17% above the last) so the ceiling hugs the real max instead
// of padding it out by up to 100% — e.g. a $9.2k max lands on ~$11k (not
// $12.5k or $20k) — leaving more of the plot's height for the actual bars, so
// differences between them read clearly instead of being compressed into a
// sliver at the bottom.
const NICE_STEPS = [1, 1.1, 1.25, 1.4, 1.6, 1.8, 2, 2.25, 2.5, 2.75, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 9, 10];

/**
 * Rounds a raw maximum up to a "nice" ceiling with ~15% headroom so the tallest
 * bar's value label never clips at the top.
 */
function niceAxisMax(rawMax: number): number {
  if (rawMax <= 0) return 1;
  const padded = rawMax * Chart.axisHeadroom;
  const magnitude = Math.pow(10, Math.floor(Math.log10(padded)));
  const normalized = padded / magnitude;
  const niceNormalized = NICE_STEPS.find((s) => normalized <= s) ?? 10;
  return niceNormalized * magnitude;
}

/**
 * Per-bar value label. Positive bars label above their top (offsetY 0); negative
 * bars pass a small positive `offsetY` to nudge the label just below the bar's
 * bottom tip via translateY.
 */
function ChartValueLabel({
  text,
  color,
  offsetY,
}: {
  text: string;
  color: string;
  offsetY: number;
}) {
  const style = offsetY
    ? [styles.topLabelText, { transform: [{ translateY: offsetY }] }]
    : styles.topLabelText;
  return (
    <Typography
      variant="micro"
      weight="semibold"
      align="center"
      color={color}
      numberOfLines={1}
      style={style}
    >
      {text}
    </Typography>
  );
}

export function AppBarChart({
  data,
  groups,
  stacks,
  width,
  height = Chart.height,
  formatValue = formatChartCurrencyShort,
  hideValueLabels = false,
  referenceValue,
  referenceLabel,
  referenceColor,
  referenceLines,
  axisMax: axisMaxOverride,
  allowNegative = false,
}: AppBarChartProps) {
  const colors = useAppColors();
  // Re-render bar labels when Settings → Currency changes.
  useDisplayCurrency();

  const isStacked = !!stacks && stacks.length > 0;
  const isGrouped = !isStacked && !!groups && groups.length > 0;
  // Normalize both inputs to a flat value list for axis scaling.
  const singleData = useMemo(() => data ?? [], [data]);
  const stackList = useMemo(() => stacks ?? [], [stacks]);
  const seriesCount = isGrouped ? Math.max(1, groups![0].bars.length) : 1;

  const intraSpacing = Chart.barMinSpacing;
  const flatGroups = useMemo(
    () =>
      isGrouped
        ? flattenBarGroups(groups!, { intraSpacing, groupSpacing: Spacing.md })
        : [],
    [isGrouped, groups, intraSpacing]
  );

  const totalBars = isStacked
    ? Math.max(stackList.length, 1)
    : isGrouped
      ? Math.max(flatGroups.length, 1)
      : Math.max(singleData.length, 1);
  // Floor to whole pixels. A fractional bar width/gap lands each bar on a
  // different sub-pixel phase, so the OS rounds neighbouring bars to slightly
  // different pixel widths and the months read as unequal. Integer width + gap
  // — with the already-integer initialSpacing/yAxisLabelWidth — keeps every
  // bar's edges on whole pixels, so all months render exactly the same width.
  const barWidth = Math.floor(
    Math.max(
      Chart.barMinWidth,
      Math.min(Chart.barMaxWidth, width / (totalBars * Chart.barWidthDivisor))
    )
  );
  // Single/stacked spacing is derived from bar count; grouped spacing lives on
  // each flattened bar (small between siblings, larger between groups).
  const spacing = isGrouped
    ? intraSpacing
    : Math.floor(Math.max(Chart.barMinSpacing, width / (totalBars * Chart.barSpacingDivisor)));
  const groupSpan = seriesCount * barWidth + (seriesCount - 1) * intraSpacing;

  // Per-bar positive/negative extents for axis scaling. A stacked bar's positive
  // extent is the sum of its positive segments (e.g. spending + surplus), its
  // negative extent the sum of its negative segments (e.g. a deficit).
  const { positiveExtents, negativeExtents } = useMemo(() => {
    if (isStacked) {
      const pos: number[] = [];
      const neg: number[] = [];
      for (const s of stackList) {
        let up = 0;
        let down = 0;
        for (const seg of s.segments) {
          if (seg.value >= 0) up += seg.value;
          else down += seg.value;
        }
        pos.push(up);
        neg.push(down);
      }
      return { positiveExtents: pos, negativeExtents: neg };
    }
    const values = isGrouped ? flatGroups.map((b) => b.value) : singleData.map((d) => d.value);
    return { positiveExtents: values, negativeExtents: values };
  }, [isStacked, stackList, isGrouped, flatGroups, singleData]);

  // Axis ceiling (nice-rounded). Computed here (ahead of chartData) because a
  // negative bar's value label is offset by its own pixel height, which needs
  // the same unit→pixel scale the axis uses.
  const posMax = Math.max(0, ...positiveExtents);
  const negMax = Math.abs(Math.min(0, ...negativeExtents));
  // Muted by default: a rule is context, not data.
  const ruleColor = referenceColor ?? colors.textTertiary;
  const rules = collectReferenceLines(
    { value: referenceValue, label: referenceLabel, color: ruleColor },
    referenceLines
  );
  // EVERY reference rule participates in the ceiling — a target above every bar
  // must still render inside the plot instead of clipping at the top edge.
  const naturalMax = Math.max(posMax, negMax, 1, ...rules.map((rule) => rule.value));
  // A pinned ceiling below the data would clip the very bar the reader needs, so
  // it only applies when it actually contains the series.
  const axisMax =
    Number.isFinite(axisMaxOverride) && (axisMaxOverride as number) >= naturalMax
      ? (axisMaxOverride as number)
      : niceAxisMax(naturalMax);
  const step = axisMax / Chart.sections;
  const sectionsBelow =
    allowNegative && negMax > 0
      ? Math.max(1, Math.ceil((negMax * Chart.axisHeadroom) / step))
      : 0;

  // With a negative region the x-axis (zero line) floats mid-chart, so the month
  // labels would sit on the zero line ON TOP of the bars. Push them down past the
  // negative region (height ∝ sections-below) so they sit clear at the bottom.
  const belowHeight = (height * sectionsBelow) / Chart.sections;
  const xAxisLabelsShift = sectionsBelow > 0 ? belowHeight + Spacing.xs : 0;

  // gifted-charts positions a negative bar's x-axis label by rotating the whole
  // bar+label wrapper 180° and re-deriving the label's offset from THAT bar's
  // own (small, per-value) height — so short negative bars and tall ones land
  // their labels at visibly different heights instead of one flat row (months
  // with a small deficit float near the TOP of the chart; large ones near the
  // bottom). It is a library geometry bug, not fixable via its own props: any
  // shift value we pass goes through the same per-bar-height-dependent math.
  // Single/grouped diverging charts render their own flat label row below the
  // chart instead (see `xAxisLabelColumns`) and mute gifted-charts' per-item
  // labels via `label: ''`. Stacked charts are unaffected today (every stacked
  // caller passes `allowNegative={false}`) so they keep the library's labels.
  const showCustomXAxisLabels = !isStacked && sectionsBelow > 0;

  // A value on every bar reads best on short, ALL-POSITIVE single series.
  // Grouped charts have too many bars to label per-bar (a legend names the
  // series). Diverging series (any negative bar) fall back to the y-axis: a
  // per-bar `topLabelComponent` on a negative bar corrupts gifted-charts' bar
  // geometry (the bar renders at the wrong height), and the labels collide with
  // the x-axis labels sitting on the zero line regardless.
  const hasNegative = negMax > 0;
  const showValueLabels =
    !isGrouped &&
    !isStacked &&
    !hideValueLabels &&
    !hasNegative &&
    singleData.length <= Chart.maxLabelledBars;

  // gifted-charts stack format: one entry per bar, each with a `stacks` array of
  // {value, color}. Positive segments stack up; a negative segment renders below
  // the zero axis (a deficit month). Rounding hugs the FREE end of the stack:
  // the topmost positive segment rounds its top, negative segments round their
  // bottom; interior segments stay square so the stack reads as one bar.
  const stackChartData = useMemo(
    () =>
      stackList.map((s) => {
        let topPositive = -1;
        s.segments.forEach((seg, i) => {
          if (seg.value >= 0) topPositive = i;
        });
        return {
          label: s.label,
          stacks: s.segments.map((seg, i) => ({
            value: seg.value,
            color: seg.color,
            ...(seg.value < 0
              ? { borderBottomLeftRadius: CornerRadius.xs, borderBottomRightRadius: CornerRadius.xs }
              : i === topPositive
                ? { borderTopLeftRadius: CornerRadius.xs, borderTopRightRadius: CornerRadius.xs }
                : {}),
          })),
        };
      }),
    [stackList]
  );

  const chartData = useMemo(() => {
    if (isGrouped) {
      return flatGroups.map((b) => ({
        value: b.value,
        label: showCustomXAxisLabels ? '' : b.label,
        frontColor: b.frontColor,
        spacing: b.spacing,
        labelWidth: b.isGroupStart ? groupSpan : undefined,
        ...FREE_END_RADIUS,
      }));
    }
    return singleData.map((d) => ({
      value: d.value,
      label: showCustomXAxisLabels ? '' : d.label,
      frontColor: d.frontColor ?? colors.primary,
      ...FREE_END_RADIUS,
      topLabelComponent: showValueLabels
        ? () => (
            <ChartValueLabel
              text={formatValue(d.value)}
              color={colors.textSecondary}
              // gifted-charts centers a negative bar's rotated top-label on the
              // bar's bottom tip, so only a small clearance is needed to drop it
              // clear below the bar (mirroring how positive labels sit above).
              offsetY={d.value < 0 ? Chart.divergingLabelClearance : 0}
            />
          )
        : undefined,
    }));
  }, [
    isGrouped,
    flatGroups,
    groupSpan,
    singleData,
    colors.primary,
    colors.textSecondary,
    showValueLabels,
    formatValue,
    showCustomXAxisLabels,
  ]);

  // One flat row of x-axis labels, laid out with the SAME column geometry
  // gifted-charts itself uses (`initialSpacing` + barWidth/groupSpan + spacing) —
  // see `showCustomXAxisLabels` above for why the library's own per-item labels
  // are muted instead of relied on here.
  //
  // Each box spans its bar PLUS the gap that follows it, pulled half a gap left
  // by a negative margin — the same trick the library uses for its own labels
  // (`width: barWidth + spacing, left: spacing / -2` in RenderBars). Sizing the
  // box to the bar alone left a 12-month year with 14pt columns, too narrow for
  // "Jan" at 9pt, so every month rendered as an ellipsised initial ("J…", "F…").
  // The negative/positive margins cancel, so a column still advances exactly one
  // bar pitch (barWidth + spacing) and the row stays locked to the bars.
  const xAxisLabelColumns = useMemo(() => {
    if (!showCustomXAxisLabels) return [];
    if (isGrouped) {
      // Groups are separated by `Spacing.md`, not by the intra-group spacing.
      const halfGap = Math.floor(Spacing.md / 2);
      return groups!.map((g, i) => ({
        key: `${i}-${g.label}`,
        text: g.label,
        width: groupSpan + Spacing.md,
        marginLeft: -halfGap,
        marginRight: halfGap,
      }));
    }
    const halfGap = Math.floor(spacing / 2);
    return singleData.map((d, i) => ({
      key: `${i}-${d.label}`,
      text: d.label,
      width: barWidth + spacing,
      marginLeft: -halfGap,
      marginRight: halfGap,
    }));
  }, [showCustomXAxisLabels, isGrouped, groups, groupSpan, singleData, barWidth, spacing]);

  // Auto-scaling ceiling (`axisMax`/`step`/`sectionsBelow`) is computed above so
  // negative value-label offsets can share the same scale.
  // Always keep a readable y-axis, formatted as compact currency ("$2k" not
  // raw "2000"). Runs bottom-to-top and spans the negative side when present.
  const yAxisLabelTexts = Array.from(
    { length: Chart.sections + sectionsBelow + 1 },
    (_, i) => formatValue((i - sectionsBelow) * step)
  );

  // Chart-library numeric label config (color + size from tokens). Held in consts
  // so the `react-native/no-inline-styles` lint doesn't flag the config objects.
  const referenceConfig = referenceLineProps(rules, {
    color: colors.textTertiary,
    labelColor: colors.textSecondary,
    fontSize: Chart.xAxisFontSize,
  });

  const yAxisTextStyle = { color: colors.textSecondary, fontSize: Chart.yAxisFontSize };
  const xAxisLabelTextStyle = { color: colors.textSecondary, fontSize: Chart.xAxisFontSize };

  return (
    <View style={showCustomXAxisLabels ? { width } : undefined}>
      <BarChart
        {...referenceConfig}
        // Stacked mode drives the chart via `stackData`; single/grouped via `data`.
        data={isStacked ? undefined : chartData}
        stackData={isStacked ? stackChartData : undefined}
        width={width}
        height={height}
        barWidth={barWidth}
        spacing={spacing}
        initialSpacing={INITIAL_SPACING}
        noOfSections={Chart.sections}
        maxValue={axisMax}
        stepValue={step}
        noOfSectionsBelowXAxis={sectionsBelow}
        // Drop the x-axis labels below the negative region so they never overlap
        // the bars sitting on the (mid-chart) zero line.
        xAxisLabelsVerticalShift={xAxisLabelsShift}
        // Keep the per-bar value on a single centered line above the bar.
        topLabelContainerStyle={{
          width: Chart.valueLabelWidth,
          marginLeft: (barWidth - Chart.valueLabelWidth) / 2,
        }}
        yAxisThickness={0}
        yAxisLabelWidth={Chart.yAxisLabelWidth}
        yAxisLabelTexts={yAxisLabelTexts}
        xAxisThickness={1}
        xAxisColor={colors.borderColor}
        yAxisTextStyle={yAxisTextStyle}
        xAxisLabelTextStyle={xAxisLabelTextStyle}
        rulesColor={colors.divider}
        rulesType="dashed"
        // The library animates heights only on mount (effect with [] deps).
        // Initial empty-ledger bars would otherwise stay at zero after sync.
        // Render heights from current props for single, grouped and stacked data.
        isAnimated={false}
        // Bars are sized to fit `width` (see barWidth/spacing above), so the
        // chart never needs to scroll horizontally. Disabling gifted-charts'
        // internal ScrollView stops it from swallowing the parent ScrollView's
        // vertical drag — otherwise dragging on a chart freezes the whole screen.
        disableScroll
      />
      {showCustomXAxisLabels && (
        <View style={styles.xAxisLabelRow} testID="chart-x-axis-labels">
          {xAxisLabelColumns.map((col) => (
            <Typography
              key={col.key}
              variant="micro"
              align="center"
              color={colors.textSecondary}
              numberOfLines={1}
              style={[
                styles.xAxisLabelText,
                {
                  width: col.width,
                  marginLeft: col.marginLeft,
                  marginRight: col.marginRight,
                  fontSize: Chart.xAxisFontSize,
                },
              ]}
            >
              {col.text}
            </Typography>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topLabelText: {
    width: Chart.valueLabelWidth,
    marginBottom: Spacing.xxs,
  },
  // Left inset MUST match where gifted-charts actually starts the bars, or every
  // label sits under the wrong month. The library positions the bar area at
  // `marginLeft: yAxisLabelWidth + yAxisThickness` (the y-axis label gutter) and
  // then pads it by `initialSpacing` — so bar i's left edge is
  // `yAxisLabelWidth + initialSpacing + i * (barWidth + spacing)`. Padding by
  // `initialSpacing` alone shifted this row a full gutter (44pt) to the LEFT of
  // the bars. `yAxisThickness` is 0 on this chart, so it contributes nothing.
  xAxisLabelRow: {
    flexDirection: 'row',
    paddingLeft: Chart.yAxisLabelWidth + INITIAL_SPACING,
    marginTop: Spacing.xs,
  },
  xAxisLabelText: {
    textAlign: 'center',
  },
});
