import React, { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { SavingsTrendPoint } from '@api/savings';
import { FilterTabs, Typography, type FilterTab } from '@components/ui';
import { AppBarChart } from '@components/ui/AppBarChart';
import { useTheme } from '@contexts/ThemeContext';
import { Spacing, useAppColors } from '@theme';

/**
 * Shared Savings/Spending/Monthly trend chart — the SAME component renders on
 * the Savings → Overview screen and the Budget home dashboard's cashflow
 * card, so both surfaces read identically instead of drifting into two
 * hand-rolled chart implementations.
 */

/** Trend chart series tabs. IDs are `chart-`-prefixed to avoid colliding with
 *  a screen's own sub-tab bar — e.g. the Savings screen's outer SavingsView
 *  tab strip already owns a bare `monthly` id (`filter-tab-monthly`), and
 *  FilterTabs' testID is `filter-tab-${id}`. */
export type SavingsTrendChartTab = 'chart-savings' | 'chart-spending' | 'chart-monthly';

export const SAVINGS_TREND_CHART_TABS: FilterTab[] = [
  { id: 'chart-savings', label: 'Savings' },
  { id: 'chart-spending', label: 'Spending' },
  { id: 'chart-monthly', label: 'Monthly' },
];

export const SAVINGS_TREND_CHART_TITLES: Record<SavingsTrendChartTab, string> = {
  'chart-savings': 'Net savings trend',
  'chart-spending': 'Spending trend',
  'chart-monthly': 'Monthly payments trend',
};

/**
 * Net-savings bar color: negative net → red, positive/zero → green. Exported so
 * the sign→color mapping is unit-testable without mounting the chart.
 */
export function netBarColor(net: number, colors: { negative: string; positive: string }): string {
  return net < 0 ? colors.negative : colors.positive;
}

function trendMonthLabel(period: string): string {
  // period is 'YYYY-MM'
  const month = Number(period.slice(5, 7));
  const abbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return abbr[month - 1] ?? period;
}

interface SavingsTrendChartProps {
  trend: SavingsTrendPoint[];
  width: number;
  activeTab: SavingsTrendChartTab;
  onTabChange: (tab: SavingsTrendChartTab) => void;
  /** Render the tab-dependent title above the tab strip (default true). Callers
   *  with their own header row (e.g. the Home dashboard's title + subtitle +
   *  "Saved so far" stat) suppress it and supply their own heading instead. */
  showTitle?: boolean;
  /** Message shown in place of the chart when `trend` is empty (tabs still
   *  render). Omit to render nothing when empty — for callers (Savings
   *  Overview) that already guard the whole card on `trend.length > 0`. */
  emptyLabel?: string;
  /** Wrapper style around the tab strip. Callers whose parent container has no
   *  flex `gap` of its own (e.g. Home's dashboard cards) pass a bottom margin
   *  here instead of one baked into this shared component, so it stays a
   *  no-op for callers (Savings Overview) whose Card already spaces its
   *  children via `gap`. */
  tabsStyle?: StyleProp<ViewStyle>;
}

export function SavingsTrendChart({
  trend,
  width,
  activeTab,
  onTabChange,
  showTitle = true,
  emptyLabel,
  tabsStyle,
}: SavingsTrendChartProps) {
  const colors = useAppColors();
  const { theme } = useTheme();

  const barData = useMemo(() => {
    switch (activeTab) {
      case 'chart-spending':
        // Budget "Spendings" — never negative, so a single flat color (no sign split).
        return trend.map((point) => ({
          value: point.spendings / 100,
          label: trendMonthLabel(point.period),
          frontColor: theme.pastel.orange,
        }));
      case 'chart-monthly':
        // Flat active recurring payments — never negative, its own accent color.
        return trend.map((point) => ({
          value: point.monthlyPayments / 100,
          label: trendMonthLabel(point.period),
          frontColor: theme.pastel.skyBlue,
        }));
      case 'chart-savings':
      default:
        return trend.map((point) => ({
          value: point.net / 100,
          label: trendMonthLabel(point.period),
          // Negative net → the scheme's negative-value accent, positive (or
          // zero) → brand primary. Per-bar sign coloring.
          frontColor: netBarColor(point.net, {
            negative: colors.chartNegative,
            positive: theme.pastel.teal,
          }),
        }));
    }
  }, [trend, activeTab, colors.chartNegative, theme.pastel.teal, theme.pastel.orange, theme.pastel.skyBlue]);

  return (
    <>
      {showTitle && (
        <Typography variant="subheadline" weight="semibold" style={styles.chartTitle}>
          {SAVINGS_TREND_CHART_TITLES[activeTab]}
        </Typography>
      )}
      <View style={tabsStyle}>
        <FilterTabs
          tabs={SAVINGS_TREND_CHART_TABS}
          activeTab={activeTab}
          onTabChange={(id) => onTabChange(id as SavingsTrendChartTab)}
        />
      </View>
      {trend.length > 0 ? (
        <AppBarChart
          data={barData}
          width={width}
          allowNegative={activeTab === 'chart-savings'}
        />
      ) : emptyLabel ? (
        <Typography variant="body" color={colors.textSecondary} style={styles.emptyLabel}>
          {emptyLabel}
        </Typography>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  chartTitle: {
    marginBottom: Spacing.xs,
  },
  emptyLabel: {
    marginTop: Spacing.sm,
  },
});
