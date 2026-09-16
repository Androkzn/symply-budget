import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import {
  savingsApi,
  type RecurringPaymentsView,
  type SavingsRecurringPayment,
} from '@api/savings';
import { ProgressBar, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useSavingsStore } from '@stores/savingsStore';
import { CornerRadius, EmptyState, hexToRgba, Spacing, useAppColors } from '@theme';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

import { loanCardInfo } from './loanShared';
import { RecurringDistributionChart } from './RecurringDistributionChart';
import { RecurringPaymentDetailSheet } from './RecurringPaymentDetailSheet';
import { RecurringYearlyDistributionChart } from './RecurringYearlyDistributionChart';

const UNGROUPED_KEY = '__ungrouped__';

/**
 * "Monthly" savings sub-tab. Recurring monthly payments persist month-to-month;
 * this view shows the running list + total. Full CRUD (add/delete/loan
 * tracking/renewal reminders/month scope) lives on the SavingsRecurringPayments
 * screen, reachable via the "Manage" button. Tapping a row here instead opens
 * a read-only detail sheet; its "Edit" action navigates to that same screen
 * (passing `focusItemId`) so editing always goes through the one full form,
 * matching Manage → tap item exactly.
 */
export function SavingsMonthlyView() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const { currentHousehold } = useHouseholdStore();
  const { dataRevision, selectedYear, selectedMonth } = useSavingsStore();

  const [view, setView] = useState<RecurringPaymentsView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<SavingsRecurringPayment | null>(null);
  const [distributionRange, setDistributionRange] = useState<'month' | 'year'>('month');

  const load = useCallback(async () => {
    if (!currentHousehold?.id) return;
    try {
      const data = await savingsApi.listRecurringPayments(
        currentHousehold.id,
        selectedYear,
        selectedMonth
      );
      setView(data);
    } catch (error) {
      console.error('Error loading monthly payments:', error);
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
  // no mutation, must still refetch.
  const didMountRef = React.useRef(false);
  React.useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    void load();
  }, [currentHousehold?.id, dataRevision, load]);

  const groups = useMemo(() => {
    if (!view) return [];
    const byKey = new Map<string, SavingsRecurringPayment[]>();
    for (const item of view.items) {
      const key = item.group_label ?? UNGROUPED_KEY;
      const list = byKey.get(key) ?? [];
      list.push(item);
      byKey.set(key, list);
    }
    return view.byGroup.map((g) => ({
      key: g.group_label ?? UNGROUPED_KEY,
      label: g.group_label ?? 'Other',
      subtotalCents: g.subtotalCents,
      items: byKey.get(g.group_label ?? UNGROUPED_KEY) ?? [],
    }));
  }, [view]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.pastel.teal} />
      </View>
    );
  }

  const hasItems = !!view && view.items.length > 0;

  return (
    <View testID="savings-monthly" style={styles.root}>
      {view && (
        <View style={[styles.totalCard, { backgroundColor: colors.backgroundSecondary }]}>
          <View style={styles.totalCol}>
            <Typography variant="caption1" color={colors.textSecondary}>
              Monthly payments
            </Typography>
            <Typography variant="title2" weight="bold" testID="savings-monthly-total">
              {formatCurrency(view.totalMonthlyCents)}
            </Typography>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('SavingsRecurringPayments')}
            activeOpacity={0.85}
            style={[styles.manageCta, { backgroundColor: theme.pastel.teal }]}
            testID="savings-monthly-add"
          >
            <Icon name="options-outline" size={16} color={colors.white} />
            <Typography variant="caption1" weight="semibold" color={colors.white}>
              Manage
            </Typography>
          </TouchableOpacity>
        </View>
      )}

      {view && view.items.length > 0 && (
        <View style={styles.distributionWrap}>
          <View style={styles.distributionToggle}>
            <TouchableOpacity
              style={[
                styles.distributionToggleBtn,
                { borderColor: colors.borderColor },
                distributionRange === 'month' && {
                  backgroundColor: theme.pastel.teal,
                  borderColor: theme.pastel.teal,
                },
              ]}
              onPress={() => setDistributionRange('month')}
              testID="savings-distribution-range-month"
            >
              <Typography
                variant="footnote"
                weight="medium"
                color={distributionRange === 'month' ? colors.white : colors.textPrimary}
              >
                This month
              </Typography>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.distributionToggleBtn,
                { borderColor: colors.borderColor },
                distributionRange === 'year' && {
                  backgroundColor: theme.pastel.teal,
                  borderColor: theme.pastel.teal,
                },
              ]}
              onPress={() => setDistributionRange('year')}
              testID="savings-distribution-range-year"
            >
              <Typography
                variant="footnote"
                weight="medium"
                color={distributionRange === 'year' ? colors.white : colors.textPrimary}
              >
                Whole year
              </Typography>
            </TouchableOpacity>
          </View>

          {distributionRange === 'month' ? (
            <RecurringDistributionChart
              slices={groups.map((g) => ({
                key: g.key,
                label: g.label,
                subtotalCents: g.subtotalCents,
              }))}
              totalCents={view.totalMonthlyCents}
            />
          ) : currentHousehold?.id ? (
            <RecurringYearlyDistributionChart householdId={currentHousehold.id} year={selectedYear} />
          ) : null}
        </View>
      )}

      {!hasItems ? (
        <View style={styles.empty}>
          <Typography variant="body" color={colors.textSecondary} align="center">
            No monthly payments yet. Add one or import a bills sheet to track your recurring
            payments.
          </Typography>
        </View>
      ) : (
        groups.map((group) => (
          <View key={group.key} style={styles.groupSection}>
            <View style={styles.groupHeader}>
              <Typography variant="subheadline" weight="semibold">
                {group.label}
              </Typography>
              <Typography variant="subheadline" weight="semibold" color={colors.textSecondary}>
                {formatCurrency(group.subtotalCents)}
              </Typography>
            </View>
            <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
              {group.items.map((item, index) => {
                const loan = loanCardInfo(item.loan_summary);
                const isInterestFree = !!loan && loan.totalInterestCents === 0;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.itemRow,
                      { borderTopColor: colors.borderColor },
                      index === 0 && styles.itemRowFirst,
                    ]}
                    activeOpacity={0.7}
                    onPress={() => setSelectedItem(item)}
                    testID="savings-monthly-item"
                  >
                    <View style={styles.itemContent}>
                      <View style={styles.itemTitleRow}>
                        <Typography
                          variant="body"
                          weight="medium"
                          numberOfLines={1}
                          style={styles.itemLabel}
                          color={item.active ? colors.textPrimary : colors.textTertiary}
                        >
                          {item.label}
                        </Typography>
                        {isInterestFree && (
                          <View
                            style={[
                              styles.interestFreeBadge,
                              { backgroundColor: hexToRgba(theme.pastel.teal, 0.14) },
                            ]}
                            testID="savings-monthly-interest-free-badge"
                          >
                            <Typography variant="caption2" weight="semibold" color={theme.pastel.teal}>
                              Interest free
                            </Typography>
                          </View>
                        )}
                      </View>
                      {item.day_of_month != null && (
                        <Typography variant="caption1" color={colors.textSecondary}>
                          Due day {item.day_of_month}
                        </Typography>
                      )}
                      {loan &&
                        (() => {
                          const pct =
                            loan.termMonths > 0
                              ? Math.round((loan.elapsedMonths / loan.termMonths) * 100)
                              : 0;
                          // Pre-compute full strings (not `{a} literal {b}` JSX) so each
                          // Typography carries one plain-string child, same convention
                          // `SavingsRecurringPaymentsScreen`'s own loan card uses.
                          const remainingLabel = `${loan.paymentsRemaining} payments left`;
                          const paidLabel = `${loan.elapsedMonths} of ${loan.termMonths} paid (${pct}%)`;
                          return (
                            <View style={styles.loanCard} testID="savings-monthly-loan-card">
                              <View style={styles.loanCardHeaderRow}>
                                <Typography variant="caption2" weight="semibold" color={colors.textSecondary}>
                                  {remainingLabel}
                                </Typography>
                                <Typography variant="caption2" weight="semibold" color={colors.textSecondary}>
                                  {paidLabel}
                                </Typography>
                              </View>
                              <ProgressBar
                                value={loan.elapsedMonths}
                                max={loan.termMonths}
                                color={theme.pastel.orange}
                                height={6}
                                testID="savings-monthly-loan-progress-bar"
                              />
                            </View>
                          );
                        })()}
                    </View>
                    <Typography
                      variant="subheadline"
                      weight="semibold"
                      align="right"
                      style={styles.itemAmount}
                      color={item.active ? colors.textPrimary : colors.textTertiary}
                    >
                      {formatCurrency(item.amount_cents)}
                    </Typography>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))
      )}

      <RecurringPaymentDetailSheet
        visible={!!selectedItem}
        item={selectedItem}
        householdId={currentHousehold?.id ?? ''}
        year={selectedYear}
        onClose={() => setSelectedItem(null)}
        onEdit={(item) => {
          setSelectedItem(null);
          navigation.navigate('SavingsRecurringPayments', { focusItemId: item.id });
        }}
      />
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
  totalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: CornerRadius.lg,
    padding: Spacing.base,
    marginBottom: Spacing.base,
  },
  totalCol: { flex: 1, gap: Spacing.xxs },
  manageCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: CornerRadius.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.smd,
  },
  distributionWrap: { marginBottom: Spacing.base, gap: Spacing.sm },
  distributionToggle: { flexDirection: 'row', gap: Spacing.sm },
  distributionToggleBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  groupSection: {
    gap: Spacing.sm,
    marginBottom: Spacing.base,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
  },
  card: {
    borderRadius: CornerRadius.lg,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    paddingLeft: Spacing.base,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  itemRowFirst: {
    borderTopWidth: 0,
  },
  itemContent: {
    flex: 1,
    marginRight: Spacing.sm,
    gap: Spacing.xxs,
  },
  itemTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  itemLabel: { flexShrink: 1 },
  // Reserves column width up to the max supported amount ($99,999) so every
  // row's figure right-aligns to the same edge instead of drifting left/right
  // with its digit count. `minWidth` (not `width`) so a rare wider currency
  // symbol (e.g. "CHF") still renders in full rather than clipping.
  itemAmount: { minWidth: 64 },
  interestFreeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: CornerRadius.sm,
  },
  loanCard: {
    alignSelf: 'stretch',
    marginTop: Spacing.xs,
    gap: Spacing.xxs,
  },
  loanCardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  empty: {
    paddingVertical: Spacing.xxl,
  },
});
