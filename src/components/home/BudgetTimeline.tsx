import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';

import { Typography, Card } from '@components/ui';
import { useAppColors, type AppColors } from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';

interface TimeframeBudget {
  timeframe: string;
  label: string;
  minCost: number;
  maxCost: number;
  itemCount: number;
  criticalCount: number;
}

interface BudgetTimelineProps {
  budgets: TimeframeBudget[];
}

// Cents → the user's display currency (Settings → Currency).
const formatCurrency = (cents: number) => formatMoney(cents);

export function BudgetTimeline({ budgets }: BudgetTimelineProps) {  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Calculate max for scaling
  const maxBudget = Math.max(...budgets.map((b) => b.maxCost));

  const getBarWidth = (max: number) => {
    if (maxBudget === 0) return 0;
    return Math.max((max / maxBudget) * 100, 5);
  };

  const getTimeframeColor = (timeframe: string) => {
    switch (timeframe) {
      case '0-30_days':
        return colors.error;
      case '3-6_months':
        return colors.warning;
      case '1_year':
        return colors.primary;
      case '2-5_years':
        return colors.success;
      case '5-10_years':
        return colors.textSecondary;
      default:
        return colors.primary;
    }
  };

  const totalMin = budgets.reduce((sum, b) => sum + b.minCost, 0);
  const totalMax = budgets.reduce((sum, b) => sum + b.maxCost, 0);

  return (
    <Card
      variant="filled"
      style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}
    >
      <View style={styles.header}>
        <Typography variant="headline" weight="semibold">
          Budget Forecast
        </Typography>
        <Typography variant="footnote" color={colors.textSecondary}>
          Estimated costs by timeframe
        </Typography>
      </View>

      {/* Total Summary */}
      <View
        style={[
          styles.totalCard,
          { backgroundColor: colors.groupedListBackground },
        ]}
      >
        <Typography variant="footnote" color={colors.textSecondary}>
          Total Estimated Cost
        </Typography>
        <Typography variant="title2" weight="bold" color={colors.primary}>
          {formatCurrency(totalMin)} - {formatCurrency(totalMax)}
        </Typography>
      </View>

      {/* Timeline */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.timelineScroll}
      >
        {budgets.map((budget, index) => (
          <View
            key={budget.timeframe}
            style={[
              styles.timelineItem,
              index < budgets.length - 1 && styles.timelineItemWithLine,
            ]}
          >
            {/* Connector Line */}
            {index < budgets.length - 1 && (
              <View
                style={[
                  styles.connectorLine,
                  { backgroundColor: colors.borderColor },
                ]}
              />
            )}

            {/* Dot */}
            <View
              style={[
                styles.dot,
                { backgroundColor: getTimeframeColor(budget.timeframe) },
              ]}
            />

            {/* Label */}
            <Typography
              variant="caption1"
              weight="medium"
              style={styles.timeframeLabel}
            >
              {budget.label}
            </Typography>

            {/* Cost Range */}
            <Typography variant="callout" weight="semibold">
              {formatCurrency(budget.minCost)}
            </Typography>
            <Typography
              variant="caption2"
              color={colors.textSecondary}
            >
              to {formatCurrency(budget.maxCost)}
            </Typography>

            {/* Item Count */}
            <View
              style={[
                styles.itemBadge,
                { backgroundColor: colors.groupedListBackground },
              ]}
            >
              <Typography variant="caption2" color={colors.textSecondary}>
                {budget.itemCount} items
              </Typography>
            </View>

            {/* Critical Indicator */}
            {budget.criticalCount > 0 && (
              <View
                style={[
                  styles.criticalBadge,
                  { backgroundColor: colors.error + '20' },
                ]}
              >
                <Typography variant="caption2" color={colors.error}>
                  {budget.criticalCount} critical
                </Typography>
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Bar Chart */}
      <View style={styles.chartContainer}>
        <Typography
          variant="footnote"
          color={colors.textSecondary}
          style={styles.chartTitle}
        >
          Cost Distribution
        </Typography>
        {budgets.map((budget) => (
          <View key={budget.timeframe} style={styles.barRow}>
            <Typography
              variant="caption2"
              color={colors.textSecondary}
              style={styles.barLabel}
            >
              {budget.label}
            </Typography>
            <View style={styles.barContainer}>
              <View
                style={[
                  styles.bar,
                  {
                    width: `${getBarWidth(budget.maxCost)}%`,
                    backgroundColor: getTimeframeColor(budget.timeframe),
                  },
                ]}
              />
            </View>
          </View>
        ))}
      </View>

      {/* Disclaimer */}
      <Typography
        variant="caption2"
        color={colors.textSecondary}
        style={styles.disclaimer}
      >
        * Estimates are non-binding and may vary based on location, contractor,
        and market conditions.
      </Typography>
    </Card>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  header: {
    marginBottom: 16,
  },
  totalCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    alignItems: 'center',
  },
  timelineScroll: {
    paddingVertical: 12,
  },
  timelineItem: {
    alignItems: 'center',
    width: 100,
    paddingHorizontal: 8,
  },
  timelineItemWithLine: {
    marginRight: 0,
  },
  connectorLine: {
    position: 'absolute',
    top: 8,
    left: '50%',
    width: 100,
    height: 2,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginBottom: 8,
    zIndex: 1,
  },
  timeframeLabel: {
    marginBottom: 4,
    textAlign: 'center',
  },
  itemBadge: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  criticalBadge: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  chartContainer: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  chartTitle: {
    marginBottom: 12,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  barLabel: {
    width: 70,
  },
  barContainer: {
    flex: 1,
    height: 12,
    backgroundColor: colors.pillBackground,
    borderRadius: 6,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 6,
  },
  disclaimer: {
    marginTop: 16,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});

export default BudgetTimeline;
