import React, { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { savingsApi, type RecurringPaymentMonthlyHistory, type SavingsRecurringPayment } from '@api/savings';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { AppBarChart } from '@components/ui/AppBarChart';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { buildMonthBars, describeScope, monthBarColor, presentMonthStates } from './recurringMonthsInsights';

interface RecurringPaymentMonthsChartProps {
  /** The row this chart is for — a REGULAR (non-loan) recurring payment. */
  item: SavingsRecurringPayment;
  householdId: string;
  /** Calendar year to fetch the month-by-month history for. */
  year: number;
}

const LEGEND_LABEL: Record<'applied' | 'skipped' | 'outOfScope', string> = {
  applied: 'Applied',
  skipped: 'Skipped',
  outOfScope: 'Not scheduled',
};

/**
 * "Which months does this payment apply to" — a 12-month bar chart for one
 * REGULAR recurring payment, fetched lazily from
 * `savingsApi.getRecurringPaymentMonthlyHistory`. Standalone by design (see
 * `recurringMonthsInsights.ts`): the sheet that hosts it wires up `item` /
 * `householdId` / `year` separately.
 *
 * Never surfaces a raw fetch error to the user — a failed load just renders
 * nothing, same as this codebase's convention elsewhere for a non-critical
 * lazy sheet section.
 */
export function RecurringPaymentMonthsChart({
  item,
  householdId,
  year,
}: RecurringPaymentMonthsChartProps) {
  const colors = useAppColors();
  const { width: windowWidth } = useWindowDimensions();
  const [history, setHistory] = useState<RecurringPaymentMonthlyHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setHistory(null);
    savingsApi
      .getRecurringPaymentMonthlyHistory(householdId, item.id, year)
      .then((data) => {
        if (!cancelled) setHistory(data);
      })
      .catch(() => {
        // Fetch failure → fall through to the `!history` empty render below.
        // Never show a raw error string in this UI.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [householdId, item.id, year]);

  if (loading) {
    return (
      <View style={styles.loadingBlock} testID="savings-months-chart-loading">
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  if (!history) return null;

  const bars = buildMonthBars(history, colors);
  const caption = describeScope(history);
  const states = presentMonthStates(history);
  // The sheet's own scroll content AND this card each pad `Spacing.base` on
  // both sides, so the chart's usable width is the window width minus four
  // of them.
  const chartWidth = Math.max(200, windowWidth - Spacing.base * 4);

  return (
    <View
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      testID="savings-months-chart"
    >
      <Typography variant="body" weight="semibold">
        Monthly activity
      </Typography>
      <Typography variant="caption1" color={colors.textSecondary}>
        {caption}
      </Typography>
      <AppBarChart data={bars} width={chartWidth} hideValueLabels />
      {states.length > 0 && (
        <View style={styles.legend} testID="savings-months-chart-legend">
          {states.map((state) => (
            <View key={state} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: monthBarColor(state, colors) }]} />
              <Typography variant="footnote" color={colors.textSecondary}>
                {LEGEND_LABEL[state]}
              </Typography>
            </View>
          ))}
        </View>
      )}
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
    gap: Spacing.base,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
