import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { budgetApi } from '@api/budget';
import { AppBackground, SafeAreaView, ScreenHeader } from '@components/common';
import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { AppBarChart } from '@components/ui/AppBarChart';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import type { BudgetStackParamList } from '@navigation/types';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';

import { monthYearLabel } from './BudgetMonthHeader';
import { spendingExtraAccent } from './BudgetSpendingExtraBanner';
import {
  extrasHistoryBars,
  extrasHistoryMonths,
  extrasHistoryPoint,
  extrasHistoryRangeLabel,
  extrasHistorySummary,
  SPENDING_EXTRA_COPY,
  type ExtrasHistoryPoint,
} from './budgetSpendingExtras';

type ExtrasRoute = RouteProp<BudgetStackParamList, 'BudgetSpendingExtras'>;

/**
 * The page behind each Spent-tab banner — discounts saved, deposits paid,
 * taxes paid. Pushed as a card (standard back chevron), it explains what the
 * figure is, how the month's number is assembled, and charts the same figure
 * over the previous months so a one-off receipt and a habit look different.
 *
 * The month is the one the Spent tab was showing (`useBudgetStore`), and the
 * headline figure is read from that month's own overview rather than passed in,
 * so a ledger move while the page is open (a peer sync, an edit in the form
 * behind it) repaints the number and the chart together.
 */
export function BudgetSpendingExtrasScreen() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const { width: windowWidth } = useWindowDimensions();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const route = useRoute<ExtrasRoute>();
  const { kind } = route.params;
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear: year, selectedMonth: month, dataRevision } = useBudgetStore();
  useDisplayCurrency();

  const copy = SPENDING_EXTRA_COPY[kind];
  const accent = spendingExtraAccent(kind, colors);
  const householdId = currentHousehold?.id;

  const months = useMemo(() => extrasHistoryMonths(year, month), [year, month]);

  const [points, setPoints] = useState<ExtrasHistoryPoint[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!householdId) return;
    setFailed(false);
    try {
      const overviews = await Promise.all(
        months.map((at) => budgetApi.getMonthlyOverview(householdId, at.year, at.month)),
      );
      setPoints(months.map((at, index) => extrasHistoryPoint(at, overviews[index])));
    } catch (error) {
      console.error('Error loading spending extras history:', error);
      setPoints(null);
      setFailed(true);
    }
  }, [householdId, months]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load]),
  );

  // A mutation landed while this page is open — reload without the spinner so
  // the figures move rather than flash.
  React.useEffect(() => {
    if (dataRevision === 0) return;
    void load();
  }, [dataRevision, load]);

  // The viewed month is the LAST point of the window — the same figure the
  // banner showed, read from the same overview.
  const currentCents = points ? points[points.length - 1]?.cents[kind] ?? 0 : null;

  const bars = useMemo(
    () =>
      points
        ? extrasHistoryBars(points, kind, { year, month }, {
            current: accent,
            past: theme.pastel.teal,
          })
        : [],
    [points, kind, year, month, accent, theme.pastel.teal],
  );
  const summary = useMemo(
    () => (points ? extrasHistorySummary(points, kind) : null),
    [points, kind],
  );

  // Card interior = window − screen padding (both sides) − card padding (both sides).
  const chartWidth = Math.max(200, windowWidth - Spacing.base * 4);

  return (
    // ScreenHeader owns the top safe-area inset (see [[BudgetCategoryDetailScreen]]).
    <AppBackground>
      <SafeAreaView edges={[]}>
        <ScreenHeader
          title={copy.title}
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        <View style={[styles.container, { backgroundColor: colors.backgroundMain }]}>
          {isLoading ? (
            <View style={styles.loading} testID="budget-spending-extras-loading">
              <ActivityIndicator size="large" color={theme.pastel.teal} />
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              testID={`budget-spending-extras-${kind}`}
            >
              {/* Headline: the same figure the banner shows, for the month in view. */}
              <Card variant="filled" style={styles.card}>
                <View style={styles.headline}>
                  <View style={[styles.headlineIcon, { backgroundColor: `${accent}22` }]}>
                    <Icon name={copy.icon} size={IconSize.lg} color={accent} />
                  </View>
                  <View style={styles.headlineText}>
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {monthYearLabel(year, month)}
                    </Typography>
                    <Typography
                      variant="title2"
                      weight="bold"
                      color={accent}
                      testID="budget-spending-extras-current"
                    >
                      {currentCents === null ? '—' : formatMoney(currentCents, { decimals: 2 })}
                    </Typography>
                  </View>
                </View>
              </Card>

              <Card variant="filled" style={styles.card}>
                <View style={styles.section}>
                  <Typography variant="subheadline" weight="semibold">
                    What is it
                  </Typography>
                  <Typography variant="body" color={colors.textSecondary}>
                    {copy.what}
                  </Typography>
                </View>
                <View style={[styles.section, styles.sectionSpaced]}>
                  <Typography variant="subheadline" weight="semibold">
                    How it is calculated
                  </Typography>
                  <Typography variant="body" color={colors.textSecondary}>
                    {copy.how}
                  </Typography>
                </View>
              </Card>

              <Card variant="filled" style={styles.card}>
                <View style={styles.chartHeader}>
                  <View style={styles.chartHeaderText}>
                    <Typography variant="title3" weight="semibold">
                      Previous months
                    </Typography>
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {extrasHistoryRangeLabel(months)}
                    </Typography>
                  </View>
                  {summary && !summary.isEmpty && (
                    <View style={styles.chartStats} testID="budget-spending-extras-summary">
                      <Typography variant="caption1" color={colors.textSecondary}>
                        Monthly average
                      </Typography>
                      <Typography variant="title3" weight="bold" color={accent}>
                        {formatMoney(summary.averageCents, { decimals: 2 })}
                      </Typography>
                    </View>
                  )}
                </View>

                {failed ? (
                  <Typography
                    variant="body"
                    color={colors.textSecondary}
                    testID="budget-spending-extras-failed"
                  >
                    Could not load the previous months right now.
                  </Typography>
                ) : summary?.isEmpty ? (
                  <Typography
                    variant="body"
                    color={colors.textSecondary}
                    testID="budget-spending-extras-empty"
                  >
                    {`Nothing ${copy.chartNoun} in these months yet.`}
                  </Typography>
                ) : (
                  <View testID="budget-spending-extras-chart">
                    <AppBarChart data={bars} width={chartWidth} />
                    {summary && (
                      <Typography
                        variant="caption1"
                        color={colors.textSecondary}
                        align="center"
                        style={styles.chartCaption}
                      >
                        {`${formatMoney(summary.totalCents, { decimals: 2 })} ${copy.chartNoun} over ${months.length} months`}
                      </Typography>
                    )}
                  </View>
                )}
              </Card>
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
    gap: Spacing.base,
  },
  card: {
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  headlineIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headlineText: {
    flex: 1,
    gap: 2,
  },
  section: {
    gap: Spacing.xs,
  },
  sectionSpaced: {
    marginTop: Spacing.md,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  chartHeaderText: {
    flex: 1,
    gap: 2,
  },
  chartStats: {
    alignItems: 'flex-end',
    gap: 2,
  },
  chartCaption: {
    marginTop: Spacing.sm,
  },
});
