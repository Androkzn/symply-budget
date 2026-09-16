import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Typography } from '@components/ui';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { MACRO_LABELS, macroSplit, type MacroKey } from '../healthGoalsStorage';

export interface HealthGoalMacroBarProps {
  split: ReturnType<typeof macroSplit>;
  testID: string;
}

/**
 * The donor's `macroDistributionView` — a three-segment bar showing what share
 * of the calorie target each macro claims.
 *
 * Shared by the in-app Goals screen and the onboarding nutrition step so a
 * calorie-target goal only has one visual representation in the app, drawn
 * once, rather than two screens quietly drifting apart.
 *
 * Colour is never load-bearing here: each segment's share is also printed in
 * the legend, and callers pair this with `macroSplit`'s own difference
 * sentence.
 */
export function HealthGoalMacroBar({ split, testID }: HealthGoalMacroBarProps) {
  const colors = useAppColors();
  const segments: { key: MacroKey; color: string }[] = [
    { key: 'protein', color: colors.primary },
    { key: 'carbs', color: colors.info },
    { key: 'fat', color: colors.warning },
  ];
  // Normalise against the LARGER of the target and the macro total, so an
  // overshoot visibly exceeds nothing — the bar stays a share of what is
  // actually planned rather than silently clipping the excess.
  const denominator = Math.max(split.total, 1);

  return (
    <View testID={testID}>
      <View style={[styles.bar, { backgroundColor: colors.borderColor }]}>
        {segments.map((segment) => (
          <View
            key={segment.key}
            style={{
              flex: Math.max(0, split.calories[segment.key] / denominator),
              backgroundColor: segment.color,
            }}
          />
        ))}
      </View>
      <View style={styles.legend}>
        {segments.map((segment) => (
          <View key={segment.key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: segment.color }]} />
            <Typography variant="caption2" color={colors.textSecondary}>
              {MACRO_LABELS[segment.key]}{' '}
              {split.total > 0 ? Math.round((split.calories[segment.key] / split.total) * 100) : 0}%
            </Typography>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    height: 14,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    paddingTop: Spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
