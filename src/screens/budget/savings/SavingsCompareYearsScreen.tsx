import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import { savingsApi, type YearComparison } from '@api/savings';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { AppBarChart, type AppBarGroup } from '@components/ui/AppBarChart';
import { useTheme } from '@contexts/ThemeContext';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useSavingsStore } from '@stores/savingsStore';
import { Layout, useAppColors } from '@theme';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

import { MONTH_ABBR, buildYearOptions, formatDeltaPct, netColor, pickSeriesColors } from './historyShared';

type Nav = NativeStackNavigationProp<BudgetStackParamList>;

const MAX_YEARS = 5;
const DOLLARS = (cents: number) => cents / 100;

/** Default selection: the (up to 3) most recent years that have data. */
function defaultSelection(availableYears: number[], fallbackYear: number): number[] {
  if (availableYears.length === 0) return [fallbackYear];
  return availableYears.slice(0, 3).sort((a, b) => a - b);
}

export function SavingsCompareYearsScreen() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<Nav>();
  const { width } = useWindowDimensions();
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear, dataRevision } = useSavingsStore();

  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [comparison, setComparison] = useState<YearComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  // Series palette (one color per compared year), from theme tokens.
  const palette = useMemo(
    () => [theme.pastel.teal, colors.primary, colors.warning, colors.yellow, colors.error],
    [theme.pastel.teal, colors.primary, colors.warning, colors.yellow, colors.error]
  );

  // Load the available years once, then pick a sensible default selection.
  useEffect(() => {
    if (!currentHousehold?.id) return;
    savingsApi
      .getHistoryYears(currentHousehold.id)
      .then((years) => {
        setAvailableYears(years);
        setSelected((prev) => (prev.length ? prev : defaultSelection(years, selectedYear)));
      })
      .catch(() => {})
      .finally(() => setInitialized(true));
  }, [currentHousehold?.id, selectedYear]);

  const load = useCallback(
    async (years: number[]) => {
      if (!currentHousehold?.id || years.length === 0) {
        setComparison(null);
        return;
      }
      try {
        setComparison(await savingsApi.compareYears(currentHousehold.id, years));
      } catch {
        setComparison(null);
      }
    },
    [currentHousehold?.id]
  );

  useEffect(() => {
    if (!initialized) return;
    let active = true;
    setLoading(true);
    load(selected).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [initialized, load, selected, dataRevision]);

  const toggleYear = (y: number) =>
    setSelected((prev) => {
      if (prev.includes(y)) {
        if (prev.length === 1) return prev; // keep at least one
        return prev.filter((v) => v !== y);
      }
      if (prev.length >= MAX_YEARS) return prev;
      return [...prev, y].sort((a, b) => a - b);
    });

  const yearOptions = useMemo(
    () => buildYearOptions(availableYears, selectedYear).sort((a, b) => a - b),
    [availableYears, selectedYear]
  );

  const seriesColors = useMemo(
    () => pickSeriesColors(comparison?.years.length ?? 0, palette),
    [comparison?.years.length, palette]
  );

  // Grouped net-by-month bars: one group per month, one bar per year.
  const chartGroups: AppBarGroup[] = useMemo(() => {
    if (!comparison) return [];
    return MONTH_ABBR.map((label, monthIdx) => ({
      label,
      bars: comparison.netByYearMonth.map((series, yearIdx) => ({
        value: DOLLARS(series.months[monthIdx] ?? 0),
        frontColor: seriesColors[yearIdx] ?? palette[0],
      })),
    }));
  }, [comparison, seriesColors, palette]);

  const chartWidth = Math.max(width - 32, 320);

  return (
    <AppBackground>
    <SafeAreaView edges={[]} testID="savings-compare-years">
      <ScreenHeader
        title="Compare years"
        showBackButton
        backButtonTestID="savings-compare-back"
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
      />

      {/* Year multi-select */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.yearRow}
      >
        {yearOptions.map((y) => {
          const active = selected.includes(y);
          return (
            <TouchableOpacity
              key={y}
              onPress={() => toggleYear(y)}
              testID={`savings-compare-chip-${y}`}
              style={[
                styles.yearChip,
                {
                  backgroundColor: active ? theme.pastel.teal : colors.backgroundSecondary,
                  borderColor: active ? theme.pastel.teal : colors.borderColor,
                },
              ]}
            >
              <Typography
                variant="caption1"
                weight="semibold"
                color={active ? colors.white : colors.textPrimary}
              >
                {y}
              </Typography>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.pastel.teal} />
        </View>
      ) : !comparison || comparison.years.length === 0 ? (
        <View style={styles.centered}>
          <Typography variant="body" color={colors.textSecondary} align="center">
            No data to compare yet. Import a previous year first.
          </Typography>
        </View>
      ) : (
        <ScrollView style={[screenScrollViewStyle.scroll, styles.flex]} contentContainerStyle={styles.content}>
          {/* Legend */}
          <View style={styles.legendRow}>
            {comparison.years.map((col, i) => (
              <View key={col.year} style={styles.legendItem}>
                <View
                  style={[styles.legendSwatch, { backgroundColor: seriesColors[i] ?? palette[0] }]}
                />
                <Typography variant="caption1" weight="medium">
                  {col.year}
                </Typography>
              </View>
            ))}
          </View>

          {/* Net savings per month, grouped by year */}
          <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="subheadline" weight="semibold" style={styles.cardTitle}>
              Net savings by month
            </Typography>
            <AppBarChart groups={chartGroups} width={chartWidth} allowNegative />
          </View>

          {/* Totals table */}
          <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="subheadline" weight="semibold" style={styles.cardTitle}>
              Yearly totals
            </Typography>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                <View style={[styles.tRow, styles.tHeader, { borderColor: colors.borderColor }]}>
                  <View style={styles.tMetric}>
                    <Typography variant="caption1" weight="semibold">
                      Metric
                    </Typography>
                  </View>
                  {comparison.years.map((col) => (
                    <View key={col.year} style={styles.tCol}>
                      <Typography variant="caption1" weight="semibold" align="right">
                        {col.year}
                      </Typography>
                    </View>
                  ))}
                </View>
                {(
                  [
                    ['Income', 'income'],
                    ['Payments', 'monthlyPayments'],
                    ['Food', 'food'],
                    ['Other', 'other'],
                    ['Net', 'net'],
                  ] as const
                ).map(([label, key]) => (
                  <View key={key} style={[styles.tRow, { borderColor: colors.divider }]}>
                    <View style={styles.tMetric}>
                      <Typography variant="caption1" color={colors.textSecondary}>
                        {label}
                      </Typography>
                    </View>
                    {comparison.years.map((col) => (
                      <View key={col.year} style={styles.tCol}>
                        <Typography
                          variant="caption1"
                          align="right"
                          weight={key === 'net' ? 'semibold' : 'regular'}
                          color={key === 'net' ? netColor(col.totals.net, colors) : undefined}
                        >
                          {formatCurrency(col.totals[key])}
                        </Typography>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* Deltas */}
          {comparison.deltas.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
              <Typography variant="subheadline" weight="semibold" style={styles.cardTitle}>
                Year over year
              </Typography>
              {comparison.deltas.map((d) => (
                <View key={`${d.fromYear}-${d.toYear}`} style={styles.deltaRow}>
                  <Typography variant="footnote" color={colors.textSecondary}>
                    {`${d.fromYear} → ${d.toYear} net`}
                  </Typography>
                  <View style={styles.deltaValue}>
                    <Typography variant="footnote" weight="semibold" color={netColor(d.net, colors)}>
                      {`${d.net >= 0 ? '+' : ''}${formatCurrency(d.net)}`}
                    </Typography>
                    <Typography variant="caption2" color={colors.textSecondary}>
                      {formatDeltaPct(d.netPct)}
                    </Typography>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { padding: 16, paddingBottom: Layout.bottomTabBarClearance, gap: 16 },
  yearRow: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  yearChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 12, height: 12, borderRadius: 3 },
  card: { borderRadius: 16, padding: 16, gap: 12 },
  cardTitle: { marginBottom: 2 },
  tRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tHeader: { borderBottomWidth: 1 },
  tMetric: { width: 92 },
  tCol: { width: 92, paddingHorizontal: 6 },
  deltaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deltaValue: { alignItems: 'flex-end' },
});
