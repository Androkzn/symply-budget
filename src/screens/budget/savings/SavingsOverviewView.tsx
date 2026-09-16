import { useFocusEffect } from "expo-router/react-navigation";
import React, { useCallback, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { savingsApi, type SavingsOverview, type SavingsTrendPoint } from '@api/savings';
import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useTheme } from '@contexts/ThemeContext';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useSavingsStore } from '@stores/savingsStore';
import {EmptyState, Spacing, useAppColors } from '@theme';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';
import { SavingsTrendChart, type SavingsTrendChartTab } from '../SavingsTrendChart';

import { incomeSourceLabel, isIrregularIncomeSource } from './incomeSourceMeta';

const sourceLabel = incomeSourceLabel;

// Re-exported so the existing `netBarColor` unit test keeps working unchanged
// — the sign→color mapping now lives with the shared chart component since
// `BudgetDashboardView` (Home) renders the exact same chart.
export { netBarColor } from '../SavingsTrendChart';

export function SavingsOverviewView() {
  const colors = useAppColors();
  const { theme } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear, selectedMonth, dataRevision } = useSavingsStore();
  // Reverse cross-store (plan W2/IP5): the "Spendings" line (net savings) is
  // derived from Budget expenses, so a budget mutation must also refresh this view.
  const budgetDataRevision = useBudgetStore((s) => s.dataRevision);

  const [overview, setOverview] = useState<SavingsOverview | null>(null);
  const [trend, setTrend] = useState<SavingsTrendPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [chartTab, setChartTab] = useState<SavingsTrendChartTab>('chart-savings');

  const load = useCallback(async () => {
    if (!currentHousehold?.id) return;
    try {
      const [overviewData, trendData] = await Promise.all([
        savingsApi.getOverview(currentHousehold.id, selectedYear, selectedMonth),
        savingsApi.getTrend(currentHousehold.id, selectedYear, selectedMonth, 6),
      ]);
      setOverview(overviewData);
      setTrend(trendData.months);
    } catch (error) {
      console.error('Error loading savings overview:', error);
    }
  }, [currentHousehold?.id, selectedYear, selectedMonth]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load])
  );

  // Skips only the very first run (useFocusEffect above already covers the
  // initial load) — every later change, including a bare month-nav tap with
  // no mutation, must still refetch. Also watches BOTH savings + budget
  // dataRevision so the Spendings line (and net) never goes stale after a
  // budget-expense edit.
  const didMountRef = React.useRef(false);
  React.useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    void load();
  }, [currentHousehold?.id, selectedYear, selectedMonth, dataRevision, budgetDataRevision, load]);

  const chartWidth = Math.max(200, windowWidth - 96);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer} testID="savings-overview-loading">
        <ActivityIndicator size="large" color={theme.pastel.teal} />
      </View>
    );
  }

  if (!overview) {
    return (
      <View style={styles.empty} testID="savings-overview-empty">
        <Typography variant="body" color={colors.textSecondary} align="center">
          Nothing to show yet. Add income or spending to see your cashflow.
        </Typography>
      </View>
    );
  }

  const incomeSources = Object.entries(overview.income.bySource);

  // Regular vs one-off split. A Worker deployed before the irregular-income
  // split omits these totals, so derive them from bySource when absent rather
  // than rendering a blank or a wrong zero.
  const irregularIncome =
    overview.income.irregularTotal ??
    incomeSources.reduce(
      (sum, [key, amount]) => (isIrregularIncomeSource(key) ? sum + amount : sum),
      0
    );
  const regularIncome = overview.income.regularTotal ?? overview.income.total - irregularIncome;

  return (
    <View testID="savings-overview" style={styles.root}>
      {/* Net savings hero */}
      <Card variant="elevated" style={styles.heroCard}>
        <Typography variant="caption1" color={colors.textSecondary}>
          Net savings this month
        </Typography>
        <Typography
          variant="largeTitle"
          weight="bold"
          color={overview.netSavings < 0 ? colors.error : theme.pastel.teal}
        >
          {formatCurrency(overview.netSavings)}
        </Typography>
        <View style={styles.heroRow}>
          <View style={styles.heroStat}>
            <Typography variant="caption2" color={colors.textSecondary}>
              Year to date
            </Typography>
            <Typography
              variant="subheadline"
              weight="semibold"
              color={overview.ytdNet < 0 ? colors.error : colors.textPrimary}
            >
              {formatCurrency(overview.ytdNet)}
            </Typography>
          </View>
        </View>
      </Card>

      {/* Income breakdown */}
      <Card variant="outlined" style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Typography variant="subheadline" weight="semibold">
            Income
          </Typography>
          <Typography variant="subheadline" weight="semibold" color={theme.pastel.teal}>
            {formatCurrency(overview.income.total)}
          </Typography>
        </View>
        {incomeSources.length === 0 ? (
          <Typography variant="caption1" color={colors.textSecondary}>
            No income recorded this month.
          </Typography>
        ) : (
          <>
            {/* Regular vs one-off summary — only meaningful once some one-off
                income exists, so it stays hidden for payroll-only households. */}
            {irregularIncome > 0 && (
              <View testID="savings-overview-income-split">
                <View style={styles.lineRow}>
                  <Typography variant="body" color={colors.textSecondary}>
                    Regular
                  </Typography>
                  <Typography
                    variant="body"
                    weight="medium"
                    testID="savings-overview-income-regular"
                  >
                    {formatCurrency(regularIncome)}
                  </Typography>
                </View>
                <View style={styles.lineRow}>
                  <Typography variant="body" color={colors.textSecondary}>
                    One-off
                  </Typography>
                  <Typography
                    variant="body"
                    weight="medium"
                    testID="savings-overview-income-irregular"
                  >
                    {formatCurrency(irregularIncome)}
                  </Typography>
                </View>
              </View>
            )}
            {incomeSources.map(([key, amount]) => (
              <View key={key} style={styles.lineRow}>
                <Typography variant="body" color={colors.textSecondary}>
                  {sourceLabel(key)}
                </Typography>
                <Typography variant="body" weight="medium">
                  {formatCurrency(amount)}
                </Typography>
              </View>
            ))}
          </>
        )}
      </Card>

      {/* Spending breakdown */}
      <Card variant="outlined" style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Typography variant="subheadline" weight="semibold">
            Spending
          </Typography>
          <Typography variant="subheadline" weight="semibold" color={theme.pastel.teal}>
            {formatCurrency(overview.spending.total)}
          </Typography>
        </View>
        <View style={styles.lineRow}>
          <Typography variant="body" color={colors.textSecondary}>
            Monthly payments
          </Typography>
          <Typography variant="body" weight="medium" testID="savings-overview-monthly-payments">
            {formatCurrency(overview.spending.monthlyPayments)}
          </Typography>
        </View>
        <View style={styles.lineRow}>
          <Typography variant="body" color={colors.textSecondary}>
            Spendings
          </Typography>
          <Typography variant="body" weight="medium" testID="savings-overview-spendings">
            {formatCurrency(overview.spending.spendings)}
          </Typography>
        </View>
      </Card>

      {/* Trend chart — Savings / Spending / Monthly, selectable via tabs.
          Same shared component the Home dashboard's cashflow card renders. */}
      {trend.length > 0 && (
        <Card variant="outlined" style={styles.sectionCard}>
          <SavingsTrendChart
            trend={trend}
            width={chartWidth}
            activeTab={chartTab}
            onTabChange={setChartTab}
          />
        </Card>
      )}

      {/* Goals summary */}
      {overview.goals.length > 0 && (
        <Card variant="outlined" style={styles.sectionCard}>
          <Typography variant="subheadline" weight="semibold" style={styles.chartTitle}>
            Goals
          </Typography>
          {overview.goals.map((goal) => (
            <View key={goal.id} style={styles.lineRow}>
              <View style={styles.goalLabel}>
                <Typography variant="body" weight="medium" numberOfLines={1}>
                  {goal.name}
                </Typography>
                <Typography variant="caption2" color={colors.textSecondary}>
                  {formatCurrency(goal.current)} / {formatCurrency(goal.target)}
                </Typography>
              </View>
              {goal.monthlyAllocation != null && (
                <Typography variant="caption1" color={colors.textSecondary}>
                  {formatCurrency(goal.monthlyAllocation)}/mo
                </Typography>
              )}
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    alignSelf: 'stretch',
  },
  loadingContainer: {
    paddingVertical: EmptyState.blockPaddingVertical,
    alignItems: 'center',
  },
  empty: {
    paddingVertical: Spacing.xxl,
  },
  heroCard: {
    marginBottom: Spacing.base,
    gap: Spacing.xs,
  },
  heroRow: {
    flexDirection: 'row',
    gap: Spacing.xl,
    marginTop: Spacing.md,
  },
  heroStat: {
    gap: Spacing.xxs,
  },
  sectionCard: {
    marginBottom: Spacing.base,
    gap: Spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chartTitle: {
    marginBottom: Spacing.xs,
  },
  goalLabel: {
    flex: 1,
    marginRight: Spacing.sm,
  },
});
