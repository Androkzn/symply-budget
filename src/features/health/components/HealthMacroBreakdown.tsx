import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Typography } from '@components/ui';
import { CornerRadius, Spacing, useAppColors } from '@theme';

/**
 * Symply Health — macro split (donor `NutritionView` "macro breakdown").
 *
 * WHAT THIS SHOWS, PRECISELY: the share of the day's logged macro GRAMS taken by
 * protein, carbs and fat. It is deliberately NOT an energy split. Turning grams
 * into calories means applying 4/4/9 kcal-per-gram on the device — a nutrition
 * figure this architecture never computes locally (see healthFoodStorage.ts).
 * The header says "of macro grams" so the number cannot be misread as energy.
 *
 * The percentages themselves are presentation arithmetic over totals the SERVER
 * supplied; no calorie, per-serving or portion figure is derived here.
 *
 * ROUNDING — the reason `macroSplitPercentages` exists:
 * three independently-rounded shares famously sum to 99 or 101 (33.3/33.3/33.3
 * rounds to 33/33/33 = 99). This uses the largest-remainder method: floor every
 * share, then hand the leftover points to the largest fractional remainders, ties
 * broken by the fixed series order. The three labels ALWAYS sum to exactly 100,
 * and the bar is laid out from the same rounded values so a segment labelled 34%
 * is 34% wide.
 *
 * COLOR — categorical (the macros are the subject, and identity is the job).
 * Assigned by macro, in fixed order, never cycled or re-assigned by rank. The
 * three hues were picked from the app's own ramps and validated (not eyeballed)
 * with the dataviz palette validator against BOTH the light card surface
 * (#F7FAFA) and the dark one (#1C1C1E):
 *
 *   #007AFF protein · #B36A00 carbs · #5856D6 fat
 *   → light: all 5 checks PASS (CVD ΔE 29.5, normal-vision 31.7, contrast ≥3:1)
 *   → dark:  all 5 checks PASS (same separations)
 *
 * One palette clears both modes, so identity does not shift when the skin does.
 * Text never wears the series color — the swatch beside a label carries identity
 * and the type stays on the ink tokens.
 */

export type MacroKey = 'protein' | 'carbs' | 'fat';

export interface MacroSeries {
  key: MacroKey;
  label: string;
  /** Single-letter tag used on the compact pills in a meal row. */
  short: string;
  color: string;
}

/** Fixed order. A macro's color follows the macro, never its size. */
export const MACRO_SERIES: readonly MacroSeries[] = [
  { key: 'protein', label: 'Protein', short: 'P', color: '#007AFF' },
  { key: 'carbs', label: 'Carbs', short: 'C', color: '#B36A00' },
  { key: 'fat', label: 'Fat', short: 'F', color: '#5856D6' },
] as const;

/**
 * Below this share a segment is narrower than its own "C 12%" label on a small
 * phone, so the label moves to the legend instead of being clipped by the fill.
 */
export const INLINE_LABEL_MIN_PERCENT = 18;

export interface MacroGrams {
  protein: number;
  carbs: number;
  fat: number;
}

export interface MacroSplit extends MacroGrams {
  /** Total grams the split was taken over; 0 means "nothing logged". */
  total: number;
}

function safeGrams(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Whole-percent share of total macro grams, guaranteed to sum to exactly 100
 * whenever anything is logged (largest-remainder / Hare-Niemeyer).
 *
 * Returns all zeros — and `total: 0` — when nothing is logged, so a caller can
 * tell "no data" apart from a genuine 0% share.
 */
export function macroSplitPercentages(grams: MacroGrams): MacroSplit {
  const values = MACRO_SERIES.map((series) => safeGrams(grams[series.key]));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0, total: 0 };

  const exact = values.map((value) => (value / total) * 100);
  const whole = exact.map((value) => Math.floor(value));
  // At most `values.length - 1` points can be left over, so a single pass over
  // the remainder ranking always closes the gap.
  let leftover = 100 - whole.reduce((sum, value) => sum + value, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const candidate of byRemainder) {
    if (leftover <= 0) break;
    whole[candidate.index] += 1;
    leftover -= 1;
  }

  return { protein: whole[0], carbs: whole[1], fat: whole[2], total };
}

/** Grams as shown beside a share — display only, never fed back into a request. */
function formatGrams(value: number): string {
  const grams = safeGrams(value);
  const rounded = Math.round(grams * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export interface HealthMacroBreakdownProps {
  /** The day's macro totals, exactly as the server reported them. */
  totals: MacroGrams;
  testID?: string;
}

/**
 * A stacked share bar plus a legend — the part-to-whole form for 3 categories.
 * With only three series each segment is direct-labelled where the text fits,
 * and the legend carries every value regardless, so identity is never colour-alone.
 */
export function HealthMacroBreakdown({
  totals,
  testID = 'health-macro-breakdown',
}: HealthMacroBreakdownProps) {
  const colors = useAppColors();
  const split = useMemo(() => macroSplitPercentages(totals), [totals]);

  const description = MACRO_SERIES.map(
    (series) => `${series.label} ${split[series.key]}%`
  ).join(', ');

  if (split.total <= 0) {
    return (
      <View style={styles.wrap} testID={testID}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.heading}>
          MACRO SPLIT
        </Typography>
        <Typography
          variant="footnote"
          color={colors.textSecondary}
          testID={`${testID}-empty`}
          accessibilityLabel="No macros logged yet"
        >
          Log a food with protein, carbs or fat and the split appears here.
        </Typography>
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID={testID}>
      <Typography variant="footnote" color={colors.textSecondary} style={styles.heading}>
        MACRO SPLIT · % OF MACRO GRAMS
      </Typography>

      {/* The 2px gaps are the card surface showing through — segments are
          separated by space, never by a stroke drawn around them. */}
      <View
        style={styles.bar}
        testID={`${testID}-bar`}
        accessible
        accessibilityLabel={`Macro split: ${description}`}
      >
        {MACRO_SERIES.map((series) => {
          const percent = split[series.key];
          if (percent <= 0) return null;
          return (
            <View
              key={series.key}
              testID={`${testID}-segment-${series.key}`}
              style={[styles.segment, { flexGrow: percent, backgroundColor: series.color }]}
            >
              {/* Inline label only where it genuinely fits. An interior stacked
                  segment has no free end to spill a label onto, so below the
                  threshold the legend carries it — cropping the text inside the
                  fill would be worse than no label at all. */}
              {percent >= INLINE_LABEL_MIN_PERCENT ? (
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={colors.white}
                  numberOfLines={1}
                >
                  {series.short} {percent}%
                </Typography>
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={styles.legend}>
        {MACRO_SERIES.map((series) => (
          <View
            key={series.key}
            style={styles.legendItem}
            testID={`${testID}-legend-${series.key}`}
            accessible
            accessibilityLabel={`${series.label}: ${formatGrams(totals[series.key])} grams, ${
              split[series.key]
            } percent of macro grams`}
          >
            <View style={[styles.swatch, { backgroundColor: series.color }]} />
            <Typography variant="caption1" color={colors.textSecondary}>
              {series.label}
            </Typography>
            <Typography variant="caption1" weight="semibold" color={colors.textPrimary}>
              {split[series.key]}%
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              {formatGrams(totals[series.key])}g
            </Typography>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.sm,
  },
  heading: {
    letterSpacing: 0.6,
  },
  bar: {
    flexDirection: 'row',
    height: 22,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
    gap: 2,
  },
  segment: {
    flexBasis: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    paddingHorizontal: 2,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
});
