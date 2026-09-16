import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, type RouteProp } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { savingsApi, type YearHistory } from '@api/savings';
import { AppBackground, HeaderActionButton, SafeAreaView, ScreenHeader } from '@components/common';
import { GradientButton, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useTheme } from '@contexts/ThemeContext';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useSavingsStore } from '@stores/savingsStore';
import { Header, Layout, Spacing, useAppColors } from '@theme';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

import {
  MONTH_ABBR,
  buildYearOptions,
  netColor,
} from './historyShared';

type Nav = NativeStackNavigationProp<BudgetStackParamList>;

const COL = { month: 52, figure: 78 } as const;

/** One cell in the grid. `net` cells color by sign; the month label is muted. */
function Cell({
  value,
  width,
  isLabel,
  color,
  bold,
}: {
  value: string;
  width: number;
  isLabel?: boolean;
  color?: string;
  bold?: boolean;
}) {
  return (
    <View style={[styles.cell, { width }]}>
      <Typography
        variant="caption1"
        weight={bold ? 'semibold' : isLabel ? 'medium' : 'regular'}
        align={isLabel ? 'left' : 'right'}
        numberOfLines={1}
        color={color}
      >
        {value}
      </Typography>
    </View>
  );
}

export function SavingsYearHistoryScreen() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<BudgetStackParamList, 'SavingsYearHistory'>>();
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear, dataRevision } = useSavingsStore();

  const initialYear = route.params?.year ?? selectedYear;
  const [year, setYear] = useState(initialYear);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [history, setHistory] = useState<YearHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (targetYear: number) => {
      if (!currentHousehold?.id) return;
      try {
        const [years, yearHistory] = await Promise.all([
          savingsApi.getHistoryYears(currentHousehold.id),
          savingsApi.getYearHistory(currentHousehold.id, targetYear),
        ]);
        setAvailableYears(years);
        setHistory(yearHistory);
      } catch {
        setHistory(null);
      }
    },
    [currentHousehold?.id]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    load(year).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [load, year, dataRevision]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(year);
    setRefreshing(false);
  }, [load, year]);

  const yearOptions = useMemo(
    () => buildYearOptions(availableYears, year),
    [availableYears, year]
  );

  const hasData = !!history && history.monthsWithData > 0;

  const openImport = () => navigation.navigate('SavingsImport', { scope: 'history' });
  const openCompare = () => navigation.navigate('SavingsCompareYears', undefined);

  return (
    <AppBackground>
    <SafeAreaView edges={[]} testID="savings-year-history">
      <ScreenHeader
        title="Previous years"
        showBackButton
        backButtonTestID="savings-year-history-back"
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
        rightElement={
          <HeaderActionButton
            label="Compare"
            onPress={openCompare}
            testID="savings-year-history-compare"
          />
        }
      />

      {/* Year picker */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.yearScroll}
        contentContainerStyle={styles.yearRow}
      >
        {yearOptions.map((y) => {
          const active = y === year;
          return (
            <TouchableOpacity
              key={y}
              onPress={() => setYear(y)}
              testID={`savings-year-chip-${y}`}
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
      ) : (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.pastel.teal}
            />
          }
        >
          {!hasData ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.backgroundSecondary }]}>
              <Typography variant="body" weight="semibold" align="center">
                No data for {year}
              </Typography>
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                align="center"
                style={styles.emptyBody}
              >
                Import a previous year&apos;s budget sheet (income + spending) with AI to see it here.
              </Typography>
              <GradientButton
                title="Import previous years"
                variant="blue"
                onPress={openImport}
                fullWidth
                testID="savings-year-history-import-empty"
              />
            </View>
          ) : (
            <>
              {/* Grid — horizontally scrollable table mirroring the tracker sheet */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  {/* Header row */}
                  <View style={[styles.row, styles.headerGridRow, { borderColor: colors.borderColor }]}>
                    <Cell value="" width={COL.month} isLabel />
                    <Cell value="Income" width={COL.figure} bold />
                    <Cell value="Payments" width={COL.figure} bold />
                    <Cell value="Food" width={COL.figure} bold />
                    <Cell value="Other" width={COL.figure} bold />
                    <Cell value="Savings" width={COL.figure} bold />
                  </View>
                  {history!.months.map((m) => (
                    <View
                      key={m.month}
                      style={[styles.row, { borderColor: colors.divider }]}
                      testID={`savings-year-row-${m.month}`}
                    >
                      <Cell value={MONTH_ABBR[m.month - 1]} width={COL.month} isLabel />
                      <Cell value={formatCurrency(m.income)} width={COL.figure} />
                      <Cell value={formatCurrency(m.monthlyPayments)} width={COL.figure} />
                      <Cell value={formatCurrency(m.food)} width={COL.figure} />
                      <Cell value={formatCurrency(m.other)} width={COL.figure} />
                      <Cell
                        value={formatCurrency(m.net)}
                        width={COL.figure}
                        color={netColor(m.net, colors)}
                        bold
                      />
                    </View>
                  ))}
                  {/* Totals + average */}
                  <View style={[styles.row, styles.totalRow, { borderColor: colors.borderColor }]}>
                    <Cell value="Total" width={COL.month} isLabel bold />
                    <Cell value={formatCurrency(history!.totals.income)} width={COL.figure} bold />
                    <Cell
                      value={formatCurrency(history!.totals.monthlyPayments)}
                      width={COL.figure}
                      bold
                    />
                    <Cell value={formatCurrency(history!.totals.food)} width={COL.figure} bold />
                    <Cell value={formatCurrency(history!.totals.other)} width={COL.figure} bold />
                    <Cell
                      value={formatCurrency(history!.totals.net)}
                      width={COL.figure}
                      color={netColor(history!.totals.net, colors)}
                      bold
                    />
                  </View>
                  <View style={[styles.row, { borderColor: colors.divider }]}>
                    <Cell value="Avg" width={COL.month} isLabel />
                    <Cell value={formatCurrency(history!.average.income)} width={COL.figure} />
                    <Cell
                      value={formatCurrency(history!.average.monthlyPayments)}
                      width={COL.figure}
                    />
                    <Cell value={formatCurrency(history!.average.food)} width={COL.figure} />
                    <Cell value={formatCurrency(history!.average.other)} width={COL.figure} />
                    <Cell
                      value={formatCurrency(history!.average.net)}
                      width={COL.figure}
                      color={netColor(history!.average.net, colors)}
                    />
                  </View>
                </View>
              </ScrollView>

              {/* Goals footer (only rows that are set) */}
              <GoalsFooter goals={history!.goals} />

              <GradientButton
                title="Import another year"
                variant="blue"
                onPress={openImport}
                fullWidth
                style={styles.importButton}
                testID="savings-year-history-import"
              />
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
    </AppBackground>
  );
}

function GoalsFooter({ goals }: { goals: YearHistory['goals'] }) {
  const colors = useAppColors();
  const rows: Array<{ label: string; value: number | null }> = [
    { label: 'Food goal / mo', value: goals.foodMonthly },
    { label: 'Other goal / mo', value: goals.otherMonthly },
    { label: 'Savings goal / mo', value: goals.savingsMonthly },
    { label: 'Savings goal / yr', value: goals.savingsYearly },
  ];
  const visible = rows.filter((r) => r.value != null);
  if (visible.length === 0) return null;
  return (
    <View style={[styles.goalsCard, { backgroundColor: colors.backgroundSecondary }]}>
      <Typography variant="subheadline" weight="semibold" style={styles.goalsTitle}>
        Goals
      </Typography>
      {visible.map((r) => (
        <View key={r.label} style={styles.goalRow}>
          <Typography variant="footnote" color={colors.textSecondary}>
            {r.label}
          </Typography>
          <Typography variant="footnote" weight="semibold">
            {formatCurrency(r.value)}
          </Typography>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Header.paddingHorizontal,
    paddingVertical: Spacing.md,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: Layout.bottomTabBarClearance, gap: 16 },
  // `alignItems` is load-bearing, not cosmetic. A horizontal ScrollView lays its
  // content out on the cross axis with the default `stretch`, so without this
  // every year chip grew to the full height of the row and `borderRadius: 999`
  // rendered it as a page-tall green pill (observed 2026-08-23, Budget-C).
  yearRow: { paddingHorizontal: 16, paddingBottom: 8, gap: 8, alignItems: 'center' },
  // And the ScrollView itself must hug its content: as a plain flex child it
  // otherwise claims every remaining point of vertical space, which is what
  // gave the chip that height to stretch into and pushed the table down the
  // screen behind a large empty gap.
  yearScroll: { flexGrow: 0, flexShrink: 0 },
  yearChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerGridRow: { borderBottomWidth: 1 },
  totalRow: { borderTopWidth: 1, borderBottomWidth: 1 },
  cell: { paddingHorizontal: 6 },
  emptyCard: { borderRadius: 16, padding: 20, gap: 12 },
  emptyBody: { marginBottom: 4 },
  goalsCard: { borderRadius: 16, padding: 16, gap: 8 },
  goalsTitle: { marginBottom: 4 },
  goalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  importButton: { marginTop: 4 },
});
