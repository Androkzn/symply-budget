import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { AppLineChart, type AppLinePoint } from '@components/ui/AppLineChart';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors, type AppColors } from '@theme';

import type { DatedValue } from '../healthDashboards';
import { formatAxisDate } from '../healthTrends';
import {
  bmiCategory,
  daysBetween,
  weightAxisFloor,
  weightProjection,
  MIN_PROJECTION_SAMPLES,
  type BmiCategoryKey,
  type WeightWindow,
} from '../healthWeightAnalytics';

import { HealthStatRow, LegendKey } from './HealthWeightDashboard';

/**
 * Symply Health — Body Composition, the donor's `bodyCompositionCard`
 * (`WeightTabView.swift`, lines 678–765) restyled to this app's own tokens.
 *
 * Up to three compact tiles — Fat, BMI, BMR — each rendered only when its
 * figure is known, plus an (i) button that expands an inline explainer panel
 * (this screen's established pattern for "more detail", the same one
 * `WeightGoalEditor` uses — no new modal/sheet component).
 *
 * Deliberately out of scope, matching a decision already made elsewhere in
 * this codebase: the donor's `buildAdditionalMetrics` tiles (muscle mass,
 * body water, visceral fat, bone mass, metabolic age) need a smart bathroom
 * scale this app has no integration for, and there is no source for them
 * here — so they are not rebuilt.
 */

const TEST_PREFIX = 'health-weight-bodycomposition';

export interface HealthWeightBodyCompositionCardProps {
  /** Body-fat percentage, from the Body tab. Null hides the Fat tile. */
  bodyFatPercent: number | null;
  /** Null hides the BMI tile. */
  bmi: number | null;
  /** Whole kcal. Null hides the BMR tile. */
  bmr: number | null;
  gender: 'male' | 'female' | 'other' | null;
  /**
   * BMI for every logged day, oldest first — one point per day the member
   * weighed in, derived from that day's weight and the height on file. Empty
   * hides the BMI TREND section entirely (no history yet to chart).
   */
  bmiHistory?: DatedValue[];
  /**
   * The SAME window (width + offset) the rest of this screen's navigator,
   * summary card, and period chart use — the BMI TREND chart below filters
   * `bmiHistory` to exactly this span, so there is one period control for
   * the whole page, not a second one scoped to this card.
   */
  window: WeightWindow;
  /** Pixel width for the BMI trend chart — the screen's own chart width. */
  chartWidth?: number;
  testID?: string;
}

/** BMI band → this app's own semantic tokens, never the donor's raw colours. */
function bmiCategoryColor(key: BmiCategoryKey, colors: AppColors): string {
  switch (key) {
    case 'underweight':
      return colors.blue;
    case 'normal':
      return colors.success;
    case 'overweight':
      return colors.warning;
    case 'obese1':
    case 'obese2':
    case 'obese3':
      return colors.error;
    /* istanbul ignore next -- BmiCategoryKey is a closed union covering every
       band `bmiCategory` can return; there is no seventh key to fall through
       to. Kept so a future band added to the table cannot render undefined. */
    default:
      return colors.textPrimary;
  }
}

/** Standard ACE ranges. Static local data — never fetched, never per-brand. */
interface BodyFatRange {
  key: string;
  label: string;
  /** `[min, max]`; `max: null` means "and above". */
  women: [number, number | null];
  men: [number, number | null];
}

const BODY_FAT_RANGES: readonly BodyFatRange[] = [
  { key: 'essential', label: 'Essential fat', women: [10, 13], men: [2, 5] },
  { key: 'athletes', label: 'Athletes', women: [14, 20], men: [6, 13] },
  { key: 'fitness', label: 'Fitness', women: [21, 24], men: [14, 17] },
  { key: 'average', label: 'Average', women: [25, 31], men: [18, 24] },
  { key: 'obese', label: 'Obese', women: [32, null], men: [25, null] },
];

function formatRange([min, max]: [number, number | null]): string {
  return max === null ? `${min}%+` : `${min}–${max}%`;
}

/**
 * Which row (if any) contains this member's own body-fat %, for their gender
 * — the donor's `bodyFatRangeRow(isHighlighted:)`. `null` whenever the gender
 * is unknown/`'other'` or no body-fat % has been logged, so the table renders
 * plainly rather than guessing.
 */
function highlightedRangeKey(
  gender: 'male' | 'female' | 'other' | null,
  bodyFatPercent: number | null
): string | null {
  if (bodyFatPercent === null || (gender !== 'male' && gender !== 'female')) return null;
  const match = BODY_FAT_RANGES.find(({ women, men }) => {
    const [min, max] = gender === 'male' ? men : women;
    return bodyFatPercent >= min && (max === null || bodyFatPercent <= max);
  });
  return match?.key ?? null;
}

/* ------------------------------------------------------------------ */
/* BMI trend — filtered to the SAME window (width + offset) as the      */
/* rest of this screen's ◀ / ▶ navigator, summary card, and period      */
/* chart. There is one period control for the whole page; this card    */
/* does not carry a second one.                                        */
/* ------------------------------------------------------------------ */

/** Max labels the BMI trend x-axis carries before the series is thinned. */
const MAX_BMI_TREND_LABELS = 6;

interface BmiTrendSeries {
  points: AppLinePoint[];
  /** Same points, still dated — what the Trend line's regression fits against. */
  dated: DatedValue[];
  latest: number | null;
  average: number | null;
  change: number | null;
  days: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildBmiTrendSeries(history: DatedValue[], window: WeightWindow): BmiTrendSeries {
  const inRange = history.filter((point) => point.date >= window.start && point.date <= window.end);
  const labelEvery = Math.max(1, Math.ceil(inRange.length / MAX_BMI_TREND_LABELS));
  const points = inRange.map((point, index) => ({
    value: point.value,
    label: index % labelEvery === 0 ? formatAxisDate(point.date) : undefined,
  }));

  const values = inRange.map((point) => point.value);
  const first = values.length > 0 ? values[0] : null;
  const latest = values.length > 0 ? values[values.length - 1] : null;
  const average =
    values.length > 0 ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

  return {
    points,
    dated: inRange,
    latest,
    average,
    change: first !== null && latest !== null ? round1(latest - first) : null,
    days: inRange.length,
  };
}

export function HealthWeightBodyCompositionCard({
  bodyFatPercent,
  bmi,
  bmr,
  gender,
  bmiHistory = [],
  window,
  chartWidth = 280,
  testID = `${TEST_PREFIX}-card`,
}: HealthWeightBodyCompositionCardProps) {
  const colors = useAppColors();
  const [showInfo, setShowInfo] = useState(false);
  // Both off by default — tapping a chip is what draws its line, same as the
  // Weight Period Chart's own Average/Goal toggles above this card.
  const [showAverage, setShowAverage] = useState(false);
  const [showTrendLine, setShowTrendLine] = useState(false);

  const band = bmi === null ? null : bmiCategory(bmi);
  const bmiColor = band === null ? colors.textPrimary : bmiCategoryColor(band.key, colors);
  const hasAnyMetric = bodyFatPercent !== null || bmi !== null || bmr !== null;
  const highlightKey = highlightedRangeKey(gender, bodyFatPercent);
  const bmiAsOfDate = bmiHistory.length > 0 ? bmiHistory[bmiHistory.length - 1].date : null;

  const trendSeries = useMemo(
    () => buildBmiTrendSeries(bmiHistory, window),
    [bmiHistory, window]
  );
  const hasTrendLine = trendSeries.points.length >= 2;

  // The Trend line — a least-squares fit through the SAME points the chart
  // is showing, regressed against the calendar day (not row index) so a gap
  // in logging does not get treated as if it were the next day, exactly how
  // `weightProjection` already fits the weight chart's own projection widget.
  // BMI is weight divided by a near-constant height, so the same straight-line
  // fit is honest here too. `MIN_PROJECTION_SAMPLES` gates it for the same
  // reason it gates the weight one — two points make a perfect line through
  // pure noise.
  const trendFit = useMemo(() => weightProjection(trendSeries.dated), [trendSeries.dated]);
  const hasTrendFit = trendFit.samples >= MIN_PROJECTION_SAMPLES;
  const trendLine = useMemo<AppLinePoint[] | null>(() => {
    if (!hasTrendFit) return null;
    const lastDate = trendSeries.dated[trendSeries.dated.length - 1].date;
    return trendSeries.dated.map((point) => ({
      value: trendFit.project(daysBetween(lastDate, point.date)) ?? point.value,
    }));
  }, [hasTrendFit, trendSeries.dated, trendFit]);

  // BMI moves in a narrow band (a whole point of change is a real swing), so a
  // zero-based axis flattens every real movement into a hairline near the top
  // — the same reasoning `weightAxisFloor` exists for on the weight chart.
  // Whatever is currently drawn (the line, the average rule, the trend line)
  // all share this one floor, so toggling one never clips another off-screen.
  // `null` when the series is too tight/close to zero to truncate usefully.
  const trendFloor = useMemo(() => {
    const values = trendSeries.points.map((point) => point.value);
    if (showTrendLine && trendLine) values.push(...trendLine.map((point) => point.value));
    return weightAxisFloor(values, showAverage ? trendSeries.average : null);
  }, [trendSeries.points, trendSeries.average, showAverage, showTrendLine, trendLine]);

  return (
    <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]} testID={testID}>
      <View style={styles.rowBetween}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          BODY COMPOSITION
        </Typography>
        <Pressable
          onPress={() => setShowInfo((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={showInfo ? 'Hide body composition info' : 'Show body composition info'}
          accessibilityState={{ expanded: showInfo }}
          testID={`${TEST_PREFIX}-info-toggle`}
          hitSlop={8}
        >
          <Icon name="information-circle-outline" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      {hasAnyMetric ? (
        <View style={styles.tileRow} testID={`${TEST_PREFIX}-tiles`}>
          {bodyFatPercent !== null ? (
            <View
              style={[styles.tile, { backgroundColor: colors.backgroundMain }]}
              testID={`${TEST_PREFIX}-fat`}
              accessible
              accessibilityLabel={`Body fat: ${bodyFatPercent.toFixed(1)}%`}
            >
              <Typography variant="caption1" color={colors.textSecondary}>
                Fat
              </Typography>
              <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                {bodyFatPercent.toFixed(1)}%
              </Typography>
            </View>
          ) : null}

          {bmi !== null ? (
            <View
              style={[styles.tile, { backgroundColor: colors.backgroundMain }]}
              testID={`${TEST_PREFIX}-bmi`}
              accessible
              accessibilityLabel={`BMI: ${bmi.toFixed(1)}${band ? `, ${band.label}` : ''}`}
            >
              <Typography variant="caption1" color={colors.textSecondary}>
                BMI
              </Typography>
              <Typography variant="footnote" weight="semibold" color={bmiColor}>
                {bmi.toFixed(1)}
              </Typography>
              {band ? (
                <Typography variant="caption1" weight="semibold" color={bmiColor}>
                  {band.label}
                </Typography>
              ) : null}
              {bmiAsOfDate ? (
                <Typography
                  variant="caption2"
                  color={colors.textSecondary}
                  testID={`${TEST_PREFIX}-bmi-asof`}
                >
                  {formatAxisDate(bmiAsOfDate)}
                </Typography>
              ) : null}
            </View>
          ) : null}

          {bmr !== null ? (
            <View
              style={[styles.tile, { backgroundColor: colors.backgroundMain }]}
              testID={`${TEST_PREFIX}-bmr`}
              accessible
              accessibilityLabel={`BMR: ${Math.round(bmr).toLocaleString()} kcal`}
            >
              <Typography variant="caption1" color={colors.textSecondary}>
                BMR
              </Typography>
              <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                {Math.round(bmr).toLocaleString()} kcal
              </Typography>
            </View>
          ) : null}
        </View>
      ) : (
        <Typography variant="body" color={colors.textSecondary} testID={`${TEST_PREFIX}-empty`}>
          Log a body-fat percentage or your height to see body composition here.
        </Typography>
      )}

      {bmiHistory.length > 0 ? (
        <View style={styles.trendSection} testID={`${TEST_PREFIX}-bmi-trend`}>
          <View style={[styles.divider, { borderTopColor: colors.borderColor }]} />
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            BMI TREND
          </Typography>

          {hasTrendLine ? (
            <>
              <View style={styles.toggleRow}>
                <Pressable
                  onPress={() => setShowAverage((on) => !on)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: showAverage }}
                  testID={`${TEST_PREFIX}-bmi-trend-toggle-average`}
                  style={[
                    styles.toggleChip,
                    {
                      borderColor: showAverage ? colors.textTertiary : colors.borderColor,
                      backgroundColor: showAverage ? colors.textTertiary : 'transparent',
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

                {hasTrendFit ? (
                  <Pressable
                    onPress={() => setShowTrendLine((on) => !on)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: showTrendLine }}
                    testID={`${TEST_PREFIX}-bmi-trend-toggle-trend`}
                    style={[
                      styles.toggleChip,
                      {
                        borderColor: showTrendLine ? colors.primary : colors.borderColor,
                        backgroundColor: showTrendLine ? colors.primary : 'transparent',
                      },
                    ]}
                  >
                    <Typography
                      variant="footnote"
                      weight="semibold"
                      color={showTrendLine ? colors.white : colors.textSecondary}
                    >
                      Trend
                    </Typography>
                  </Pressable>
                ) : (
                  <View
                    testID={`${TEST_PREFIX}-bmi-trend-toggle-trend`}
                    style={[styles.toggleChip, styles.toggleChipDisabled, { borderColor: colors.borderColor }]}
                  >
                    <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
                      {`Trend (need ${MIN_PROJECTION_SAMPLES}+)`}
                    </Typography>
                  </View>
                )}
              </View>

              <View testID={`${TEST_PREFIX}-bmi-trend-chart`}>
                <AppLineChart
                  data={trendSeries.points}
                  data2={showTrendLine && trendLine ? trendLine : undefined}
                  width={chartWidth}
                  color={bmiColor}
                  color2={colors.textTertiary}
                  area
                  baselineValue={trendFloor ?? undefined}
                  referenceValue={
                    showAverage && trendSeries.average !== null ? trendSeries.average : undefined
                  }
                  referenceLabel={showAverage ? 'Average' : undefined}
                  referenceColor={colors.textTertiary}
                  formatValue={(value) => value.toFixed(1)}
                />
              </View>

              {/* Two series always get a legend — identity must never rest on colour alone. */}
              {showTrendLine && trendLine ? (
                <View style={styles.legendRow} testID={`${TEST_PREFIX}-bmi-trend-legend`}>
                  <LegendKey color={bmiColor} label="BMI" />
                  <LegendKey color={colors.textTertiary} label="Trend" />
                </View>
              ) : null}
            </>
          ) : (
            <Typography
              variant="body"
              color={colors.textSecondary}
              testID={`${TEST_PREFIX}-bmi-trend-empty`}
            >
              {`Log your weight on at least two days in this period to see a BMI trend line.`}
            </Typography>
          )}

          {hasTrendLine ? (
            <HealthStatRow
              stats={[
                {
                  label: 'Latest',
                  value: trendSeries.latest !== null ? trendSeries.latest.toFixed(1) : '—',
                  testID: `${TEST_PREFIX}-bmi-trend-latest`,
                },
                {
                  label: 'Average',
                  value: trendSeries.average !== null ? trendSeries.average.toFixed(1) : '—',
                  testID: `${TEST_PREFIX}-bmi-trend-average`,
                },
                {
                  label: 'Change',
                  value:
                    trendSeries.change === null
                      ? '—'
                      : `${trendSeries.change > 0 ? '+' : ''}${trendSeries.change.toFixed(1)}`,
                  testID: `${TEST_PREFIX}-bmi-trend-change`,
                },
              ]}
            />
          ) : null}
        </View>
      ) : null}

      {showInfo ? (
        <View style={styles.infoPanel} testID={`${TEST_PREFIX}-info-panel`}>
          <Typography variant="caption1" color={colors.textSecondary}>
            BMI = weight ÷ height². It does not know the difference between muscle and fat, so a
            trained body reads high.
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            BMR uses the Mifflin–St Jeor equation.
          </Typography>

          <View style={styles.rangeTable} testID={`${TEST_PREFIX}-range-table`}>
            <View style={styles.rangeRow}>
              <Typography
                variant="caption1"
                weight="semibold"
                color={colors.textSecondary}
                style={styles.rangeLabelCol}
              >
                Category
              </Typography>
              <Typography
                variant="caption1"
                weight="semibold"
                color={colors.textSecondary}
                style={styles.rangeValueCol}
              >
                Women
              </Typography>
              <Typography
                variant="caption1"
                weight="semibold"
                color={colors.textSecondary}
                style={styles.rangeValueCol}
              >
                Men
              </Typography>
            </View>

            {BODY_FAT_RANGES.map((range) => {
              const highlighted = range.key === highlightKey;
              return (
                <View
                  key={range.key}
                  style={[
                    styles.rangeRow,
                    highlighted && { backgroundColor: colors.primary + '1F' },
                  ]}
                  accessibilityState={{ selected: highlighted }}
                  testID={
                    highlighted
                      ? `${TEST_PREFIX}-range-row-${range.key}-highlighted`
                      : `${TEST_PREFIX}-range-row-${range.key}`
                  }
                >
                  <Typography
                    variant="caption1"
                    weight={highlighted ? 'semibold' : 'regular'}
                    color={highlighted ? colors.primary : colors.textPrimary}
                    style={styles.rangeLabelCol}
                  >
                    {range.label}
                  </Typography>
                  <Typography
                    variant="caption1"
                    weight={highlighted ? 'semibold' : 'regular'}
                    color={highlighted ? colors.primary : colors.textSecondary}
                    style={styles.rangeValueCol}
                  >
                    {formatRange(range.women)}
                  </Typography>
                  <Typography
                    variant="caption1"
                    weight={highlighted ? 'semibold' : 'regular'}
                    color={highlighted ? colors.primary : colors.textSecondary}
                    style={styles.rangeValueCol}
                  >
                    {formatRange(range.men)}
                  </Typography>
                </View>
              );
            })}
          </View>
        </View>
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
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tileRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '28%',
    minWidth: 84,
    borderRadius: CornerRadius.sm,
    padding: Spacing.xs,
    gap: Spacing.xxs,
  },
  trendSection: {
    gap: Spacing.sm,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  toggleChip: {
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
  },
  toggleChipDisabled: {
    opacity: 0.5,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.base,
  },
  infoPanel: {
    gap: Spacing.sm,
  },
  rangeTable: {
    gap: 2,
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.xxs,
    borderRadius: CornerRadius.xs,
  },
  rangeLabelCol: {
    flex: 1.4,
  },
  rangeValueCol: {
    flex: 1,
    textAlign: 'right',
  },
});
