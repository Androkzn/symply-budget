import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Typography } from '@components/ui';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { seriesColor } from '@theme/chartPalette';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

export interface DistributionSlice {
  /** Stable key for React (group key). */
  key: string;
  /** Display label ("Housing", "Insurance", "Other", …). */
  label: string;
  /** Active monthly subtotal for this group, in cents. */
  subtotalCents: number;
}

interface Props {
  slices: DistributionSlice[];
  totalCents: number;
}

/** Minimum visible width so a tiny slice still shows as a sliver in the bar. */
const MIN_SEGMENT_PERCENT = 2;

/**
 * A short "distribution by category" diagram for Monthly Payments: one
 * proportional stacked bar plus a legend with each group's share. Brand-aware
 * colors come from the shared chart palette; slice color at index i matches the
 * group section header dot on the list below, so the two read as one.
 *
 * Renders nothing when there is nothing meaningful to distribute (no total, or a
 * single group that would just read 100%).
 */
export function RecurringDistributionChart({ slices, totalCents }: Props) {
  const colors = useAppColors();

  const visible = slices.filter((s) => s.subtotalCents > 0);
  if (totalCents <= 0 || visible.length < 2) return null;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      testID="savings-recurring-distribution"
    >
      <Typography variant="subheadline" weight="semibold">
        Distribution by category
      </Typography>

      <View style={styles.bar}>
        {visible.map((slice, index) => {
          const pct = Math.max((slice.subtotalCents / totalCents) * 100, MIN_SEGMENT_PERCENT);
          return (
            <View
              key={slice.key}
              style={[styles.segment, { flexGrow: pct, backgroundColor: seriesColor(colors, index) }]}
            />
          );
        })}
      </View>

      <View style={styles.legend}>
        {visible.map((slice, index) => {
          const pct = Math.round((slice.subtotalCents / totalCents) * 100);
          return (
            <View key={slice.key} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: seriesColor(colors, index) }]} />
              <Typography
                variant="footnote"
                numberOfLines={1}
                style={styles.legendLabel}
                color={colors.textPrimary}
              >
                {slice.label}
              </Typography>
              <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
                {formatCurrency(slice.subtotalCents)} · {pct}%
              </Typography>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: CornerRadius.lg,
    padding: Spacing.base,
    gap: Spacing.smd,
  },
  bar: {
    flexDirection: 'row',
    height: 14,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
    gap: 2,
  },
  segment: { flexBasis: 0 },
  legend: { gap: Spacing.xs },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { flex: 1 },
});
