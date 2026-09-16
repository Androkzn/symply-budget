import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { budgetApi, type CategoryProductTrend, type CategoryProductTrends } from '@api/budget';
import { AppBackground, SafeAreaView, ScreenHeader } from '@components/common';
import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import type { BudgetStackParamList } from '@navigation/types';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import {CornerRadius, Layout, Spacing, useAppColors } from '@theme';
import { formatMoney as formatAmount, useDisplayCurrency } from '@utils/money';

import { mergeCategoryProductTrends } from './budgetCategoryTrendsUtils';

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** 'YYYY-MM' → 'Jul'. */
function monthAbbr(ym: string): string {
  const m = Number.parseInt(ym.slice(5, 7), 10);
  return MONTH_ABBR[m - 1] ?? ym;
}

/** Cents → '$12' or '$5.49' (2 decimals only when there's a fractional part). */
function formatMoney(cents: number): string {
  return formatAmount(cents, { decimals: cents % 100 === 0 ? 0 : 2 });
}

/** Signed delta label, e.g. '+$4' / '-$2'. */
function formatDelta(cents: number): string {
  const sign = cents > 0 ? '+' : cents < 0 ? '-' : '';
  return `${sign}${formatMoney(Math.abs(cents))}`;
}

type DetailRoute = RouteProp<BudgetStackParamList, 'BudgetCategoryDetail'>;

const WINDOW_MONTHS = 6;

// Bar-chart dimensions — component-specific sizes with no spacing-token equivalent.
const CHART_HEIGHT = 96;
const BAR_TRACK_HEIGHT = 72;
const SPARKLINE_HEIGHT = 24;

export function BudgetCategoryDetailScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const colors = useAppColors();
  const { theme } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const route = useRoute<DetailRoute>();
  const { categoryId, categoryName, categoryIds } = route.params;
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear, selectedMonth, dataRevision } = useBudgetStore();

  // The dashboard's "Other" row is a bucket of categories, not a category:
  // it arrives with the ids it folded, and this screen re-aggregates them.
  const bucketIds = useMemo(
    () => (categoryIds && categoryIds.length > 0 ? categoryIds : [categoryId]),
    [categoryIds, categoryId]
  );
  const isBucket = bucketIds.length > 1;

  const [data, setData] = useState<CategoryProductTrends | null>(null);
  const [bucketNames, setBucketNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentHousehold?.id) return;
    try {
      setError(null);
      const parts = await Promise.all(
        bucketIds.map((id) =>
          budgetApi.getCategoryProductTrends(
            currentHousehold.id,
            id,
            selectedYear,
            selectedMonth,
            WINDOW_MONTHS
          )
        )
      );
      setData(
        parts.length === 1
          ? parts[0] ?? null
          : mergeCategoryProductTrends(parts, { categoryId, categoryName })
      );
      setBucketNames(
        parts.length === 1
          ? []
          : parts.map((part) => part.categoryName ?? 'Uncategorized')
      );
    } catch (err) {
      console.error('Error loading category products:', err);
      setError('Could not load this category. Pull to try again.');
    }
  }, [currentHousehold?.id, bucketIds, categoryId, categoryName, selectedYear, selectedMonth]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load])
  );

  // Refresh when a budget mutation elsewhere bumps the revision.
  React.useEffect(() => {
    if (dataRevision > 0) load();
  }, [dataRevision, load]);

  const monthlyTotals = data?.monthlyTotals ?? [];
  const months = data?.months ?? [];
  const maxMonthly = Math.max(1, ...monthlyTotals);
  const delta = data ? data.currentMonthTotal - data.previousMonthTotal : 0;
  const emptyItemsCopy = `No items recorded in ${
    isBucket ? 'these categories' : 'this category'
  } yet. Scan a receipt or add a spending to start tracking what you buy.`;

  return (
    // ScreenHeader owns the top safe-area inset; a `top` edge here double-counts
    // it (extra gap above the header) and — as the native padded scroll parent —
    // can also stop the ScrollView from bounding, so it won't scroll. See [[BudgetTimelineScreen]].
    <AppBackground>
    <SafeAreaView edges={[]}>
      <ScreenHeader
        title={categoryName}
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
      />

      <ScrollView
        style={[styles.container, { backgroundColor: colors.backgroundMain }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View style={styles.loading} testID="budget-category-detail-loading">
            <ActivityIndicator size="large" color={theme.pastel.teal} />
          </View>
        ) : error ? (
          <Card variant="filled" style={styles.card}>
            <Typography variant="body" color={colors.textSecondary}>
              {error}
            </Typography>
          </Card>
        ) : (
          <>
            {/* This month + trend vs last month */}
            <Card variant="filled" style={styles.card} testID="budget-category-summary">
              <Typography variant="caption1" color={colors.textSecondary}>
                {MONTH_ABBR[selectedMonth - 1]} {selectedYear} spending
              </Typography>
              {/* "Other" says nothing on its own — name the categories it folds. */}
              {isBucket && bucketNames.length > 0 && (
                <Typography
                  variant="caption2"
                  color={colors.textTertiary}
                  style={styles.bucketCategories}
                  testID="budget-category-bucket-members"
                >
                  {bucketNames.join(' · ')}
                </Typography>
              )}
              <View style={styles.summaryRow}>
                <Typography variant="largeTitle" weight="bold">
                  {formatMoney(data?.currentMonthTotal ?? 0)}
                </Typography>
                {data && data.previousMonthTotal > 0 && (
                  <View style={styles.deltaPill}>
                    <Icon
                      name={delta > 0 ? 'arrow-up' : delta < 0 ? 'arrow-down' : 'remove'}
                      size={14}
                      color={delta > 0 ? colors.warning : delta < 0 ? colors.success : colors.textSecondary}
                    />
                    <Typography
                      variant="caption1"
                      weight="semibold"
                      color={delta > 0 ? colors.warning : delta < 0 ? colors.success : colors.textSecondary}
                    >
                      {formatDelta(delta)} vs {monthAbbr(months[months.length - 2] ?? '')}
                    </Typography>
                  </View>
                )}
              </View>

              {/* Category monthly trend bars */}
              {monthlyTotals.length > 0 && (
                <View style={styles.trendChart}>
                  {monthlyTotals.map((total, i) => {
                    const isCurrent = i === monthlyTotals.length - 1;
                    return (
                      <View key={months[i] ?? i} style={styles.trendCol}>
                        <View style={styles.trendBarTrack}>
                          <View
                            style={[
                              styles.trendBar,
                              {
                                height: `${Math.max((total / maxMonthly) * 100, total > 0 ? 6 : 0)}%`,
                                backgroundColor: isCurrent ? theme.pastel.teal : colors.borderColor,
                              },
                            ]}
                          />
                        </View>
                        <Typography
                          variant="caption2"
                          color={isCurrent ? colors.textPrimary : colors.textTertiary}
                        >
                          {monthAbbr(months[i] ?? '')}
                        </Typography>
                      </View>
                    );
                  })}
                </View>
              )}
            </Card>

            {/* Product breakdown + per-product trends */}
            <View style={styles.sectionHeader}>
              <Typography variant="title3" weight="semibold">
                Items this month
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                Last {WINDOW_MONTHS} months
              </Typography>
            </View>

            {data && data.products.length > 0 ? (
              <Card variant="filled" style={styles.card} testID="budget-category-products">
                {data.products.map((product, index) => (
                  <ProductRow
                    key={product.name}
                    product={product}
                    isLast={index === data.products.length - 1}
                  />
                ))}
              </Card>
            ) : (
              <Card variant="filled" style={styles.card}>
                <Typography variant="body" color={colors.textSecondary}>
                  {emptyItemsCopy}
                </Typography>
              </Card>
            )}

            <Typography variant="caption2" color={colors.textTertiary} style={styles.footnote}>
              Trends group purchases by item name. Scanning grocery receipts captures each item
              automatically.
            </Typography>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

function ProductRow({ product, isLast }: { product: CategoryProductTrend; isLast: boolean }) {
  const colors = useAppColors();
  const { theme } = useTheme();

  const trendColor =
    product.trend === 'up'
      ? colors.warning
      : product.trend === 'down'
        ? colors.success
        : product.trend === 'new'
          ? theme.pastel.teal
          : colors.textSecondary;

  const trendIcon =
    product.trend === 'up'
      ? 'trending-up'
      : product.trend === 'down'
        ? 'trending-down'
        : product.trend === 'new'
          ? 'sparkles'
          : 'remove';

  const maxBar = Math.max(1, ...product.byMonth.map((m) => m.amount));

  return (
    <View
      style={[
        styles.productRow,
        !isLast && { borderBottomColor: colors.borderColor, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <View style={styles.productTop}>
        <View style={styles.productLabels}>
          <Typography variant="body" weight="medium" numberOfLines={1} style={styles.productName}>
            {product.name}
          </Typography>
          <Typography variant="caption2" color={colors.textSecondary}>
            {product.currentCount > 0
              ? `${product.currentCount}× this month · avg ${formatMoney(product.averageAmount)}/mo`
              : `avg ${formatMoney(product.averageAmount)}/mo`}
          </Typography>
        </View>
        <View style={styles.productRight}>
          <Typography variant="subheadline" weight="semibold">
            {formatMoney(product.currentAmount)}
          </Typography>
          <View style={styles.trendPill}>
            <Icon name={trendIcon as never} size={12} color={trendColor} />
            <Typography variant="caption2" weight="semibold" color={trendColor}>
              {product.trend === 'new'
                ? 'New'
                : product.trend === 'flat'
                  ? 'Steady'
                  : formatDelta(product.currentAmount - product.previousAmount)}
            </Typography>
          </View>
        </View>
      </View>

      {/* Per-item sparkline across the window */}
      <View style={styles.sparkline}>
        {product.byMonth.map((m, i) => {
          const isCurrent = i === product.byMonth.length - 1;
          return (
            <View key={m.month} style={styles.sparkCol}>
              <View
                style={[
                  styles.sparkBar,
                  {
                    height: Math.max((m.amount / maxBar) * SPARKLINE_HEIGHT, m.amount > 0 ? 3 : 1),
                    backgroundColor: m.amount > 0
                      ? isCurrent
                        ? theme.pastel.teal
                        : `${theme.pastel.teal}66`
                      : colors.borderColor,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
    gap: Spacing.md,
  },
  loading: {
    paddingTop: Spacing.xxl * 2,
    alignItems: 'center',
  },
  card: {
    padding: Spacing.base,
  },
  bucketCategories: {
    marginTop: Spacing.xxs,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
    gap: Spacing.sm,
  },
  deltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  trendChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: CHART_HEIGHT,
    marginTop: Spacing.base,
    gap: Spacing.sm,
  },
  trendCol: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  trendBarTrack: {
    width: '100%',
    height: BAR_TRACK_HEIGHT,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  trendBar: {
    width: '70%',
    borderRadius: CornerRadius.xs,
    minHeight: Spacing.xxs,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  productRow: {
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  productTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  productLabels: {
    flex: 1,
    gap: Spacing.xxs,
  },
  productName: {
    textTransform: 'capitalize',
  },
  productRight: {
    alignItems: 'flex-end',
    gap: Spacing.xxs,
  },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  sparkline: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: SPARKLINE_HEIGHT,
    gap: Spacing.xs,
  },
  sparkCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
  },
  sparkBar: {
    width: '100%',
    borderRadius: CornerRadius.xs,
  },
  footnote: {
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
});
