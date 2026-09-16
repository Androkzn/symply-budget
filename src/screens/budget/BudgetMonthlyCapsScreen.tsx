import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { budgetApi } from '@api/budget';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Card, TextInput, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useTheme } from '@contexts/ThemeContext';
import type { BudgetStackParamList } from '@navigation/types';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Layout, Spacing, hexToRgba, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { formatBudgetCurrency } from './budgetFormat';

/**
 * Budget → Settings → Monthly Budget.
 *
 * The per-year cap editor: a 12-month grid (tap a month to edit it), an inline
 * amount field, an "N of 12 months set · $X planned" summary, and the
 * first-of-year "apply to the rest of the year" prompt.
 *
 * Editing is scoped to the YEAR, not to one month: typed amounts are parked in
 * `drafts` and survive switching months, the grid previews every pending change,
 * and one header Save writes them all. Previously each month had its own "Save
 * <Month>" button and selecting another month silently discarded whatever had
 * been typed — a pass over the year lost every month but the last one saved.
 *
 * Split out of BudgetSettingsScreen, where the whole grid sat inline above the
 * navigation rows: Settings opened onto a wall of months, and the rows that
 * actually route somewhere (Transfer, Categories, Sub-budgets, Sync, Backup,
 * Invite) began below the fold. Settings now carries one row for this, with the
 * same summary line as its subtitle.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** Cents → the editor's dollar string. '' whenever the month has no cap yet. */
function toAmountText(cents: number | null | undefined): string {
  return cents != null ? (cents / 100).toString() : '';
}

/** Dollar string → integer cents. null when blank or not a valid amount. */
function toAmountCents(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const dollars = parseFloat(trimmed);
  if (Number.isNaN(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}

export function BudgetMonthlyCapsScreen() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear, selectedMonth, markInsightsDirty } = useBudgetStore();

  // planned_budget (cents) per month for selectedYear — null means "not set yet".
  const [monthlyBudgets, setMonthlyBudgets] = useState<Record<number, number | null>>({});
  const [editingMonth, setEditingMonth] = useState(selectedMonth);
  // Typed-but-unsaved amounts, keyed by month. Switching months parks the entry
  // here rather than discarding it, so the whole year can be filled in one pass.
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingGoal, setIsSavingGoal] = useState(false);

  const fetchMonthlyBudgets = useCallback(
    async (householdId: string) => {
      const results = await Promise.all(
        MONTHS.map((month) =>
          budgetApi
            .getMonthlyGoal(householdId, selectedYear, month)
            .then((res) => [month, res.goal.planned_budget] as const)
            .catch(() => [month, null] as const)
        )
      );
      return Object.fromEntries(results) as Record<number, number | null>;
    },
    [selectedYear]
  );

  const load = useCallback(async () => {
    if (!currentHousehold?.id) {
      // No household hydrated yet — don't stay stuck on the spinner (which has
      // no testID); drop into the rendered screen so it's detectable/usable.
      setIsLoading(false);
      return;
    }
    try {
      const map = await fetchMonthlyBudgets(currentHousehold.id);
      setMonthlyBudgets(map);
      setEditingMonth(selectedMonth);
      // Drafts are keyed by month alone, so they must not survive a reload that
      // swapped the year (or the household) underneath them.
      setDrafts({});
    } catch (error) {
      console.error('Error loading monthly budgets:', error);
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold?.id, selectedMonth, fetchMonthlyBudgets]);

  useEffect(() => {
    load();
  }, [load]);

  // Re-pull every month without the full-screen spinner (used after "apply to the
  // rest of the year" so the grid reflects the change in place).
  const refreshMonths = useCallback(async () => {
    if (!currentHousehold?.id) return;
    try {
      setMonthlyBudgets(await fetchMonthlyBudgets(currentHousehold.id));
    } catch (error) {
      console.error('Error refreshing monthly budgets:', error);
    }
  }, [currentHousehold?.id, fetchMonthlyBudgets]);

  // Switching months only moves the editor — the amount typed for the month being
  // left stays in `drafts` and is written by the next Save.
  const handleSelectMonth = (month: number) => setEditingMonth(month);

  const plannedBudget = drafts[editingMonth] ?? toAmountText(monthlyBudgets[editingMonth]);

  const handleChangeAmount = (text: string) => {
    setDrafts((prev) => ({ ...prev, [editingMonth]: text }));
  };

  // Months whose typed amount differs from what's stored. Text comparison, so an
  // amount typed back to its saved value stops counting as a change.
  const pendingMonths = useMemo(
    () =>
      MONTHS.filter((month) => {
        const draft = drafts[month];
        return draft !== undefined && draft.trim() !== toAmountText(monthlyBudgets[month]);
      }),
    [drafts, monthlyBudgets]
  );

  const pendingSet = useMemo(() => new Set(pendingMonths), [pendingMonths]);

  // What the grid and summary show: saved caps with every valid pending edit laid
  // over them, so an edit made in January is visible while February is selected.
  const previewBudgets = useMemo(() => {
    const next: Record<number, number | null> = { ...monthlyBudgets };
    for (const month of pendingMonths) {
      const cents = toAmountCents(drafts[month]!);
      if (cents !== null) next[month] = cents;
    }
    return next;
  }, [monthlyBudgets, drafts, pendingMonths]);

  const setCount = useMemo(
    () => MONTHS.filter((m) => previewBudgets[m] != null).length,
    [previewBudgets]
  );

  // Sum of every month that has a cap set — the year's planned spend so far.
  const annualTotalCents = useMemo(
    () => MONTHS.reduce((sum, m) => sum + (previewBudgets[m] ?? 0), 0),
    [previewBudgets]
  );

  // Single string (one Text child) so the summary reads as one line and stays
  // easy to assert on. Only surface the annual total once something is set.
  const summaryText =
    setCount > 0
      ? `${setCount} of 12 months set · ${formatBudgetCurrency(annualTotalCents)} planned for ${selectedYear}`
      : `${setCount} of 12 months set`;

  const handleSaveAll = async () => {
    if (!currentHousehold?.id || pendingMonths.length === 0) return;
    const householdId = currentHousehold.id;

    const invalid = pendingMonths.find((month) => toAmountCents(drafts[month]!) === null);
    if (invalid !== undefined) {
      Alert.alert(
        'Invalid amount',
        `Please enter a valid monthly budget for ${MONTH_NAMES[invalid - 1]}.`
      );
      return;
    }

    const edits = pendingMonths.map(
      (month) => [month, toAmountCents(drafts[month]!)!] as const
    );

    setIsSavingGoal(true);
    try {
      // Sequential: setMonthlyGoal reports isFirstForYear against the stored
      // year, so firing these in parallel would have every one of them claim it.
      let firstForYear: { month: number; cents: number } | null = null;
      for (const [month, cents] of edits) {
        const { isFirstForYear } = await budgetApi.setMonthlyGoal(householdId, selectedYear, month, {
          planned_budget: cents,
        });
        if (isFirstForYear && !firstForYear) firstForYear = { month, cents };
      }
      markInsightsDirty(householdId);
      // Optimistically reflect the saved months in the grid; stay on the screen so
      // the user can keep setting other months.
      setMonthlyBudgets((prev) => ({ ...prev, ...Object.fromEntries(edits) }));
      setDrafts({});

      // Only worth offering for a single first-of-year month — a batch that
      // already set several months has answered the question itself.
      if (firstForYear && firstForYear.month < 12 && edits.length === 1) {
        promptApplyToYear(householdId, firstForYear.month, firstForYear.cents);
      }
    } catch (error) {
      console.error('Error saving monthly goal:', error);
      Alert.alert('Error', 'Could not save the monthly budget.');
    } finally {
      setIsSavingGoal(false);
    }
  };

  const promptApplyToYear = (householdId: string, month: number, cents: number) => {
    Alert.alert(
      'Apply this budget?',
      `Use this amount for the rest of ${selectedYear}, or set a different budget for each month?`,
      [
        {
          text: 'Different per month',
          style: 'cancel',
        },
        {
          text: 'Same for rest of year',
          onPress: async () => {
            try {
              await budgetApi.applyGoalToYear(householdId, selectedYear, month, cents);
            } catch (error) {
              console.error('Error applying budget to year:', error);
              Alert.alert('Error', 'Could not apply this budget to the rest of the year.');
            } finally {
              refreshMonths();
            }
          },
        },
      ]
    );
  };

  // Save lives only in the header, and only while something is actually pending:
  // with nothing edited there is nothing to save, so no action is rendered.
  const saveHeaderAction =
    pendingMonths.length > 0 || isSavingGoal ? (
      <TouchableOpacity
        onPress={handleSaveAll}
        disabled={isSavingGoal}
        testID="budget-settings-save"
        accessibilityRole="button"
        accessibilityLabel={`Save ${pendingMonths.length} changed month${
          pendingMonths.length === 1 ? '' : 's'
        }`}
      >
        {isSavingGoal ? (
          <ActivityIndicator size="small" color={theme.pastel.teal} />
        ) : (
          <Typography variant="body" weight="semibold" color={theme.pastel.teal}>
            Save
          </Typography>
        )}
      </TouchableOpacity>
    ) : undefined;

  if (isLoading) {
    return (
      // AppBackground reserves the iPad leading sidebar inset (paddingLeft) —
      // without it this pushed screen renders UNDER the always-on-top
      // (zIndex 9999) SidebarTabBar and its left ~130-320pt is clipped.
      <AppBackground>
        <SafeAreaView edges={[]} testID="budget-monthly-caps-screen">
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.pastel.teal} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground>
      <SafeAreaView edges={[]} testID="budget-monthly-caps-screen">
        <ScreenHeader
          title="Monthly Budget"
          showBackButton
          onBackPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
              return;
            }
            navigation.navigate('BudgetSettings');
          }}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
          rightElement={saveHeaderAction}
        />

        <ScrollView
          {...keyboardDismissScrollProps}
          style={[screenScrollViewStyle.scroll, styles.flex]}
          contentContainerStyle={styles.content}
        >
          <Typography variant="title3" weight="bold" style={styles.sectionTitle}>
            {selectedYear}
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary} style={styles.sectionSubtitle}>
            Set a spending cap for each month. Shared with everyone in your household — it’s the amount used
            to compute the remaining balance.
          </Typography>

          {/* Year at a glance — tap any month to set or edit its budget. Cells
              show pending edits too, so the whole year is visible before Save. */}
          <View style={styles.monthGrid}>
            {MONTHS.map((month) => {
              const cents = previewBudgets[month];
              const isSet = cents != null;
              const isActive = month === editingMonth;
              const isPending = pendingSet.has(month);
              return (
                <TouchableOpacity
                  key={month}
                  onPress={() => handleSelectMonth(month)}
                  activeOpacity={0.7}
                  testID={`budget-month-${month}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={`${MONTH_NAMES[month - 1]} ${selectedYear}, ${
                    isSet ? formatBudgetCurrency(cents) : 'not set'
                  }${isPending ? ', unsaved' : ''}`}
                  style={[
                    styles.monthCell,
                    {
                      backgroundColor: isActive ? hexToRgba(colors.primary, 0.12) : colors.card,
                      borderColor: isActive || isPending ? colors.primary : colors.divider,
                    },
                    isPending && styles.monthCellPending,
                  ]}
                >
                  <Typography
                    variant="footnote"
                    weight="semibold"
                    color={isActive ? colors.primary : colors.textPrimary}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {MONTH_NAMES[month - 1]}
                  </Typography>
                  <Typography
                    variant="caption1"
                    weight={isSet ? 'semibold' : 'regular'}
                    color={
                      isActive || isPending
                        ? colors.primary
                        : isSet
                          ? colors.textPrimary
                          : colors.textTertiary
                    }
                  >
                    {isSet ? formatBudgetCurrency(cents) : '—'}
                  </Typography>
                </TouchableOpacity>
              );
            })}
          </View>

          <Typography
            variant="caption2"
            color={colors.textTertiary}
            style={styles.setSummary}
            testID="budget-settings-summary"
          >
            {summaryText}
          </Typography>

          {/* Editor for the currently selected month. */}
          <Card variant="filled" style={styles.editorCard}>
            <TextInput
              testID="budget-settings-planned-budget"
              label={`${MONTH_NAMES[editingMonth - 1]} ${selectedYear} budget ($)`}
              placeholder="0"
              value={plannedBudget}
              onChangeText={handleChangeAmount}
              keyboardType="decimal-pad"
            />
            <Typography
              variant="caption2"
              color={pendingMonths.length > 0 ? colors.primary : colors.textTertiary}
              style={styles.editorHint}
              testID="budget-settings-pending"
            >
              {pendingMonths.length > 0
                ? `${pendingMonths.length} unsaved ${
                    pendingMonths.length === 1 ? 'month' : 'months'
                  } — tap Save to apply them all.`
                : 'Pick any month to edit it. Your changes are kept while you move between months.'}
            </Typography>
          </Card>
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: Layout.bottomTabBarClearance + 48 },
  sectionTitle: { marginBottom: Spacing.xxs },
  sectionSubtitle: { marginBottom: Spacing.lg },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  monthCell: {
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xs,
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
    gap: Spacing.xxs,
  },
  // Dashed edge marks a month that is edited but not written yet.
  monthCellPending: { borderStyle: 'dashed' },
  setSummary: {
    marginTop: Spacing.smd,
    textAlign: 'center',
  },
  editorCard: { marginTop: Spacing.lg },
  editorHint: { marginTop: Spacing.sm },
});
