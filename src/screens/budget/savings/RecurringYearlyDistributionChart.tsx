import React, { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { savingsApi, type RecurringYearlyGroupBreakdown } from '@api/savings';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { AppBarChart } from '@components/ui/AppBarChart';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { buildYearlyLegend, buildYearlyStacks } from './recurringYearlyDistributionInsights';

interface RecurringYearlyDistributionChartProps {
  householdId: string;
  /** Calendar year to fetch the month-by-month breakdown for. */
  year: number;
}

/**
 * "Distribution by category, across the whole year" — a 12-month stacked bar
 * companion to `RecurringDistributionChart`'s single-month proportional bar.
 * Fetched lazily from `savingsApi.getRecurringYearlyGroupBreakdown` so a
 * payment that only applies to part of the year, or that stopped/started
 * mid-year, shows up as a genuinely shorter/taller bar in its own months
 * rather than one flat total repeated 12 times.
 *
 * Every month reads each payment's CURRENT amount — a mid-year price change
 * shows at today's price for every month, same as every other total this
 * app shows (see the BE doc comment on `getRecurringYearlyGroupBreakdown`).
 *
 * Never surfaces a raw fetch error — a failed load just renders nothing,
 * same convention `RecurringPaymentMonthsChart` uses for this sheet family.
 */
export function RecurringYearlyDistributionChart({
  householdId,
  year,
}: RecurringYearlyDistributionChartProps) {
  const colors = useAppColors();
  const { width: windowWidth } = useWindowDimensions();
  const [breakdown, setBreakdown] = useState<RecurringYearlyGroupBreakdown | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBreakdown(null);
    savingsApi
      .getRecurringYearlyGroupBreakdown(householdId, year)
      .then((data) => {
        if (!cancelled) setBreakdown(data);
      })
      .catch(() => {
        // Fetch failure → fall through to the empty render below. Never show
        // a raw error string in this UI.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [householdId, year]);

  if (loading) {
    return (
      <View style={styles.loadingBlock} testID="savings-yearly-distribution-loading">
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  // Nothing meaningful to show for a household with no active payments this
  // year (or a fetch failure) — same "render nothing" convention the
  // single-month chart uses rather than an empty card shell.
  const hasData = !!breakdown && breakdown.groups.length > 0;
  if (!hasData) return null;

  const stacks = buildYearlyStacks(breakdown, colors);
  const legend = buildYearlyLegend(breakdown, colors);
  // This card pads `Spacing.base` on both sides inside the Monthly tab's own
  // root padding — same width budget `RecurringPaymentMonthsChart` uses.
  const chartWidth = Math.max(240, windowWidth - Spacing.base * 4);

  return (
    <View
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      testID="savings-yearly-distribution"
    >
      <Typography variant="subheadline" weight="semibold">
        Distribution by category
      </Typography>
      <AppBarChart stacks={stacks} width={chartWidth} allowNegative={false} />
      <View style={styles.legend} testID="savings-yearly-distribution-legend">
        {legend.map((item) => (
          <View key={item.label} style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: item.color }]} />
            <Typography variant="footnote" color={colors.textSecondary} numberOfLines={1}>
              {item.label}
            </Typography>
          </View>
        ))}
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
  loadingBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.lg,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
