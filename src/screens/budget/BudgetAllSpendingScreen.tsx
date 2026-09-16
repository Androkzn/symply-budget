import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { PieChart } from 'react-native-gifted-charts';

import { budgetApi, type BudgetCategory, type Expense } from '@api/budget';
import { AppBackground, SafeAreaView, ScreenHeader } from '@components/common';
import { Card, FilterTabs, TextInput, Typography, type FilterTab } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { AppBarChart } from '@components/ui/AppBarChart';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import type { BudgetStackParamList } from '@navigation/types';
import { useAppStore } from '@stores/appStore';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';
import { getBudgetCategoryIcon, resolveCategoryIcon } from '@utils/budgetCategoryIcon';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import {
  SPENDING_RANGE_OPTIONS,
  UNCATEGORIZED_ID,
  buildSpendBuckets,
  expenseCategoryKey,
  filterExpenses,
  sortExpenses,
  spendingDateRange,
  summarizeSpending,
  type SpendingRange,
  type SpendingSort,
} from './budgetAllSpendingUtils';
import { buildCategorySpendingRows, type CategorySpendRow } from './BudgetDashboardView';
import { formatBudgetCurrency as formatCurrency } from './budgetFormat';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ALL_CATEGORIES_ID = 'all';

function formatExpenseDate(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Human sublabel for the active window, e.g. "July 2026" or "Last 3 months". */
function rangeSublabel(range: SpendingRange, year: number, month: number): string {
  switch (range) {
    case 'month':
      return `${MONTH_NAMES[month - 1]} ${year}`;
    case '3m':
      return 'Last 3 months';
    case '6m':
      return 'Last 6 months';
    case 'year':
      return `${year}`;
    case 'all':
    default:
      return 'All time';
  }
}

export function BudgetAllSpendingScreen() {
  const colors = useAppColors();
  const { theme } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear, selectedMonth, dataRevision } = useBudgetStore();
  const { width: windowWidth } = useWindowDimensions();
  // Re-render money figures when the display currency changes (read fresh in format).
  useAppStore((state) => state.currency);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [range, setRange] = useState<SpendingRange>('month');
  const [categoryId, setCategoryId] = useState<string>(ALL_CATEGORIES_ID);
  const [sort, setSort] = useState<SpendingSort>('recent');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!currentHousehold?.id) return;
    const bounds = spendingDateRange(selectedYear, selectedMonth, range);
    try {
      const [expenseRes, categoryRes] = await Promise.all([
        budgetApi.getExpenses(currentHousehold.id, {
          start_date: bounds.start,
          end_date: bounds.end,
          limit: 500,
        }),
        budgetApi.getCategories(currentHousehold.id),
      ]);
      setExpenses(expenseRes.expenses);
      setCategories(categoryRes.categories);
    } catch (error) {
      console.error('Error loading all spending:', error);
    }
  }, [currentHousehold?.id, selectedYear, selectedMonth, range]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load])
  );

  React.useEffect(() => {
    if (dataRevision === 0) return;
    void load();
  }, [dataRevision, load]);

  const categoryById = useMemo(
    () => new Map(categories.map((cat) => [cat.id, cat])),
    [categories]
  );

  // Search narrows EVERYTHING (charts + list); the category chip narrows only
  // the list + stats, so the distribution donut still shows the full breakdown
  // you can tap into.
  const searchedExpenses = useMemo(
    () => filterExpenses(expenses, { query }),
    [expenses, query]
  );

  const listExpenses = useMemo(
    () => sortExpenses(filterExpenses(searchedExpenses, { categoryId }), sort),
    [searchedExpenses, categoryId, sort]
  );

  const stats = useMemo(() => summarizeSpending(listExpenses), [listExpenses]);

  const categoryRows = useMemo(
    () => buildCategorySpendingRows(searchedExpenses, categories, theme.pastel.teal, 6),
    [searchedExpenses, categories, theme.pastel.teal]
  );

  const donutData = useMemo(
    () => categoryRows.map((row) => ({ value: row.amount, color: row.color })),
    [categoryRows]
  );

  const barData = useMemo(
    () =>
      buildSpendBuckets(searchedExpenses, range, selectedYear, selectedMonth).map((b) => ({
        value: b.value,
        label: b.label,
      })),
    [searchedExpenses, range, selectedYear, selectedMonth]
  );
  const hasTrend = barData.some((b) => b.value > 0);

  // Category filter chips: All + every category that has spending in the window
  // (plus Uncategorized when present), each with its transaction count.
  const categoryChips = useMemo<FilterTab[]>(() => {
    const counts = new Map<string, number>();
    for (const e of searchedExpenses) {
      const key = expenseCategoryKey(e);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const chips: FilterTab[] = [{ id: ALL_CATEGORIES_ID, label: 'All', count: searchedExpenses.length }];
    for (const cat of categories) {
      const count = counts.get(cat.id);
      if (count) chips.push({ id: cat.id, label: cat.name, count });
    }
    if (counts.get(UNCATEGORIZED_ID)) {
      chips.push({ id: UNCATEGORIZED_ID, label: 'Uncategorized', count: counts.get(UNCATEGORIZED_ID) });
    }
    return chips;
  }, [searchedExpenses, categories]);

  // If the active category vanishes from the window (range/search change), reset.
  React.useEffect(() => {
    if (categoryId !== ALL_CATEGORIES_ID && !categoryChips.some((c) => c.id === categoryId)) {
      setCategoryId(ALL_CATEGORIES_ID);
    }
  }, [categoryChips, categoryId]);

  const onCategoryRowPress = useCallback(
    (row: CategorySpendRow) => {
      // Aggregate "Other" bucket isn't a real category — don't filter by it.
      if (row.id === 'other') return;
      setCategoryId((prev) => (prev === row.id ? ALL_CATEGORIES_ID : row.id));
    },
    []
  );

  const openExpense = useCallback(
    (expense: Expense) => {
      navigation.navigate('BudgetItemForm', {
        expenseId: expense.id,
        kind: 'spent',
        expenseDraft: {
          title: expense.title,
          amount: expense.amount,
          expense_date: expense.expense_date,
          category_id: expense.category_id,
          tax_amount: expense.tax_amount,
        },
      });
    },
    [navigation]
  );

  const sublabel = rangeSublabel(range, selectedYear, selectedMonth);
  // Card interior = window − screen padding (both sides) − card padding (both sides).
  const chartWidth = Math.max(200, windowWidth - Spacing.base * 4);

  return (
    // ScreenHeader owns the top safe-area inset (see [[BudgetCategoryDetailScreen]]).
    <AppBackground>
    <SafeAreaView edges={[]}>
      <ScreenHeader
        title="All spending"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
      />

      <View style={[styles.container, { backgroundColor: colors.backgroundMain }]}>
        {/* Time-range scope — drives every card below. */}
        <View style={styles.rangeRow}>
          <FilterTabs
            tabs={SPENDING_RANGE_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            activeTab={range}
            onTabChange={(id) => setRange(id as SpendingRange)}
            showActiveIndicator={false}
            scrollable
          />
        </View>

        {isLoading ? (
          <View style={styles.loading} testID="budget-all-spending-loading">
            <ActivityIndicator size="large" color={theme.pastel.teal} />
          </View>
        ) : (
          <View style={styles.scrollHost} testID="budget-all-spending">
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              {...keyboardDismissScrollProps}
            >
              {/* Summary tiles */}
              <View style={styles.statsRow}>
                <StatTile label="Total spent" value={formatCurrency(stats.total)} emphasize />
                <StatTile label="Transactions" value={String(stats.count)} />
              </View>
              <View style={styles.statsRow}>
                <StatTile label="Avg / item" value={formatCurrency(stats.average)} />
                <StatTile
                  label="Saved"
                  value={formatCurrency(stats.saved)}
                  valueColor={stats.saved > 0 ? colors.success : undefined}
                />
              </View>
              <View style={styles.statsRow}>
                <StatTile
                  label="Deposits"
                  value={formatCurrency(stats.deposits)}
                  valueColor={stats.deposits > 0 ? colors.warning : undefined}
                />
              </View>

              {/* Trend over the window */}
              <Card variant="filled" style={styles.card} testID="budget-all-spending-trend">
                <Typography variant="title3" weight="semibold">
                  Spending over time
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary} style={styles.cardSubtitle}>
                  {sublabel}
                </Typography>
                {hasTrend ? (
                  <AppBarChart data={barData} width={chartWidth} />
                ) : (
                  <Typography variant="body" color={colors.textSecondary}>
                    No spending in this period yet.
                  </Typography>
                )}
              </Card>

              {/* Category distribution */}
              <Card variant="filled" style={styles.card} testID="budget-all-spending-categories">
                <View style={styles.categoryHeader}>
                  <View style={styles.categoryHeaderText}>
                    <Typography variant="title3" weight="semibold">
                      By category
                    </Typography>
                    <Typography variant="caption1" color={colors.textSecondary}>
                      Tap a category to filter the list
                    </Typography>
                  </View>
                </View>

                {categoryRows.length === 0 ? (
                  <Typography variant="body" color={colors.textSecondary}>
                    No spending to break down yet.
                  </Typography>
                ) : (
                  <>
                    {donutData.length > 1 && (
                      <View style={styles.donutWrap}>
                        <PieChart
                          data={donutData}
                          donut
                          radius={64}
                          innerRadius={42}
                          innerCircleColor={colors.backgroundSecondary}
                          centerLabelComponent={() => (
                            <View style={styles.pieCenter}>
                              <Typography variant="caption2" color={colors.textSecondary}>
                                Total
                              </Typography>
                              <Typography variant="subheadline" weight="bold">
                                {formatCurrency(
                                  categoryRows.reduce((sum, r) => sum + r.amount, 0)
                                )}
                              </Typography>
                            </View>
                          )}
                        />
                      </View>
                    )}
                    <View style={styles.categoryList}>
                      {categoryRows.map((row) => (
                        <CategoryRow
                          key={row.id}
                          row={row}
                          selected={categoryId === row.id}
                          onPress={onCategoryRowPress}
                        />
                      ))}
                    </View>
                  </>
                )}
              </Card>

              {/* Filters: search + sort */}
              <View style={styles.filterControls}>
                <View style={styles.searchWrap}>
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search title or vendor"
                    leftIcon={<Icon name="search" size={18} color={colors.textTertiary} />}
                    autoCorrect={false}
                    testID="budget-all-spending-search"
                  />
                </View>
                <TouchableOpacity
                  onPress={() => setSort((s) => (s === 'recent' ? 'amount' : 'recent'))}
                  style={[styles.sortToggle, { borderColor: colors.borderColor }]}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Sort by ${sort === 'recent' ? 'amount' : 'date'}`}
                  testID="budget-all-spending-sort"
                >
                  <Icon
                    name={sort === 'recent' ? 'time-outline' : 'swap-vertical'}
                    size={16}
                    color={colors.primary}
                  />
                  <Typography variant="caption1" weight="semibold" color={colors.primary}>
                    {sort === 'recent' ? 'Newest' : 'Highest'}
                  </Typography>
                </TouchableOpacity>
              </View>

              {/* Category chips */}
              {categoryChips.length > 1 && (
                <View style={styles.chipRow}>
                  <FilterTabs
                    tabs={categoryChips}
                    activeTab={categoryId}
                    onTabChange={setCategoryId}
                    showActiveIndicator={false}
                    scrollable
                  />
                </View>
              )}

              {/* Transaction list */}
              <View style={styles.listSection}>
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={colors.textSecondary}
                  style={styles.listHeader}
                >
                  {listExpenses.length} {listExpenses.length === 1 ? 'TRANSACTION' : 'TRANSACTIONS'}
                </Typography>

                {listExpenses.length === 0 ? (
                  <Card variant="filled" style={styles.card}>
                    <Typography variant="body" color={colors.textSecondary} align="center">
                      No spending matches these filters.
                    </Typography>
                  </Card>
                ) : (
                  <View style={[styles.listCard, { backgroundColor: colors.backgroundSecondary }]}>
                    {listExpenses.map((expense, index) => (
                      <ExpenseRow
                        key={expense.id}
                        expense={expense}
                        category={
                          expense.category_id ? categoryById.get(expense.category_id) : undefined
                        }
                        isFirst={index === 0}
                        onPress={openExpense}
                      />
                    ))}
                  </View>
                )}
              </View>
            </ScrollView>
          </View>
        )}
      </View>
    </SafeAreaView>
    </AppBackground>
  );
}

function StatTile({
  label,
  value,
  emphasize,
  valueColor,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  valueColor?: string;
}) {
  const colors = useAppColors();
  return (
    <Card variant="filled" style={styles.statTile}>
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
      <Typography
        variant={emphasize ? 'title2' : 'title3'}
        weight="bold"
        color={valueColor ?? colors.textPrimary}
      >
        {value}
      </Typography>
    </Card>
  );
}

function CategoryRow({
  row,
  selected,
  onPress,
}: {
  row: CategorySpendRow;
  selected: boolean;
  onPress: (row: CategorySpendRow) => void;
}) {
  const colors = useAppColors();
  const sharePct = Math.round(row.share * 100);
  const tappable = row.id !== 'other';

  const body = (
    <View style={styles.categoryRow}>
      <View style={styles.categoryRowTop}>
        <View style={styles.categoryRowLeft}>
          <View style={[styles.categoryIconChip, { backgroundColor: `${row.color}22` }]}>
            <Icon name={getBudgetCategoryIcon(row.name)} size={18} color={row.color} />
          </View>
          <View style={styles.categoryRowLabels}>
            <Typography variant="body" weight="medium" numberOfLines={1}>
              {row.name}
            </Typography>
            <Typography variant="caption2" color={colors.textSecondary}>
              {sharePct}% of spending
            </Typography>
          </View>
        </View>
        <View style={styles.categoryRowRight}>
          <Typography variant="subheadline" weight="semibold">
            {formatCurrency(row.amount)}
          </Typography>
          {tappable && (
            <Icon
              name={selected ? 'checkmark-circle' : 'chevron-forward'}
              size={16}
              color={selected ? colors.primary : colors.textTertiary}
            />
          )}
        </View>
      </View>
      <View style={[styles.categoryTrack, { backgroundColor: colors.borderColor }]}>
        <View
          style={[
            styles.categoryFill,
            {
              width: `${Math.max(sharePct, row.amount > 0 ? 4 : 0)}%`,
              backgroundColor: row.color,
            },
          ]}
        />
      </View>
    </View>
  );

  if (!tappable) return body;

  return (
    <TouchableOpacity
      activeOpacity={0.6}
      onPress={() => onPress(row)}
      testID={`budget-all-spending-category-${row.id}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`Filter by ${row.name}`}
    >
      {body}
    </TouchableOpacity>
  );
}

function ExpenseRow({
  expense,
  category,
  isFirst,
  onPress,
}: {
  expense: Expense;
  category?: BudgetCategory;
  isFirst: boolean;
  onPress: (expense: Expense) => void;
}) {
  const colors = useAppColors();
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      style={[
        styles.expenseRow,
        { borderTopColor: colors.borderColor },
        !isFirst && styles.expenseRowBorder,
      ]}
      onPress={() => onPress(expense)}
      activeOpacity={0.7}
      testID="budget-all-spending-item"
    >
      <View style={[styles.priorityDot, { backgroundColor: theme.pastel.teal }]} />
      <View style={styles.expenseContent}>
        <Typography variant="body" weight="medium" numberOfLines={1}>
          {expense.title}
        </Typography>
        <View style={styles.expenseMeta}>
          {category && (
            <View
              style={[styles.categoryBadge, { backgroundColor: `${category.color ?? theme.pastel.teal}22` }]}
            >
              <Icon
                name={resolveCategoryIcon(category)}
                size={14}
                color={category.color ?? colors.textSecondary}
              />
              <Typography
                variant="caption2"
                weight="medium"
                color={category.color ?? colors.textSecondary}
                numberOfLines={1}
              >
                {category.name}
              </Typography>
            </View>
          )}
          <Typography variant="caption1" color={colors.textSecondary}>
            {formatExpenseDate(expense.expense_date)}
          </Typography>
        </View>
      </View>
      <Typography variant="subheadline" weight="semibold" color={theme.pastel.teal}>
        {formatCurrency(expense.amount)}
      </Typography>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  rangeRow: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
  },
  loading: {
    paddingTop: Spacing.xxl * 2,
    alignItems: 'center',
  },
  scrollHost: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
    gap: Spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  statTile: {
    flex: 1,
    padding: Spacing.base,
    gap: Spacing.xxs,
  },
  card: {
    padding: Spacing.base,
  },
  cardSubtitle: {
    marginTop: Spacing.xxs,
    marginBottom: Spacing.md,
  },
  categoryHeader: {
    marginBottom: Spacing.base,
  },
  categoryHeaderText: {
    gap: Spacing.xxs,
  },
  donutWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.base,
  },
  pieCenter: {
    alignItems: 'center',
  },
  categoryList: {
    gap: Spacing.base,
  },
  categoryRow: {
    gap: Spacing.sm,
  },
  categoryRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  categoryRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  categoryRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  categoryRowLabels: {
    flex: 1,
    gap: Spacing.xxs,
  },
  categoryIconChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  categoryFill: {
    height: '100%',
    borderRadius: 999,
    minWidth: 4,
  },
  filterControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  searchWrap: {
    flex: 1,
  },
  sortToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingHorizontal: Spacing.md,
    height: 44,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
  },
  chipRow: {
    marginTop: -Spacing.xs,
  },
  listSection: {
    gap: Spacing.xs,
  },
  listHeader: {
    marginLeft: Spacing.xs,
    letterSpacing: 0.6,
  },
  listCard: {
    borderRadius: CornerRadius.lg,
  },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    paddingLeft: Spacing.base,
  },
  expenseRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Spacing.md,
  },
  expenseContent: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  expenseMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.xxs,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    maxWidth: '70%',
  },
});
