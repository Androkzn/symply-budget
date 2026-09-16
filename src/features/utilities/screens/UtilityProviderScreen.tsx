import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from 'expo-router/react-navigation';
import { useNavigation, useRoute } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, RefreshControl, TouchableOpacity, Dimensions } from 'react-native';

import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography, Card } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { AppBarChart } from '@components/ui/AppBarChart';
import {
  utilitiesApi,
  type BillAnalytics,
  type UtilityBill,
} from '@features/utilities/api/utilities';
import { ProviderLogo } from '@features/utilities/components/ProviderLogo';
import { PROVIDER_META } from '@features/utilities/providers/bill-providers';
import type { UtilitiesStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import {Layout, Spacing, useAppColors } from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';

type Route = RouteProp<UtilitiesStackParamList, 'UtilityProvider'>;
type Nav = NativeStackNavigationProp<UtilitiesStackParamList, 'UtilityProvider'>;

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatCurrency(cents: number): string {
  return formatMoney(cents, { decimals: 2 });
}

function monthLabel(ym: string): string {
  const [year, month] = ym.split('-');
  const idx = parseInt(month, 10) - 1;
  const abbr = MONTH_ABBR[idx] ?? month;
  return idx === 0 ? `${abbr} '${year.slice(2)}` : abbr;
}

export function UtilityProviderScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const colors = useAppColors();  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { providerKey } = route.params;
  const { currentHousehold } = useHouseholdStore();
  const meta = PROVIDER_META[providerKey];

  const [analytics, setAnalytics] = useState<BillAnalytics | null>(null);
  const [bills, setBills] = useState<UtilityBill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!currentHousehold?.id) return;
    const year = new Date().getFullYear();
    const [analyticsData, billsData] = await Promise.all([
      utilitiesApi.getAnalytics(currentHousehold.id, {
        startYear: year - 1,
        endYear: year,
        providerKey: providerKey === 'overview' ? undefined : providerKey,
      }),
      utilitiesApi.getBills(currentHousehold.id, { limit: 50 }),
    ]);
    setAnalytics(analyticsData);
    const types = meta.billTypes;
    setBills(
      providerKey === 'overview'
        ? billsData
        : billsData.filter((b) => {
            const key = b.provider?.toLowerCase() ?? '';
            if (providerKey === 'bc_hydro') return key.includes('hydro') || b.bill_type === 'electricity';
            if (providerKey === 'fortisbc') return key.includes('fortis') || b.bill_type === 'gas';
            if (providerKey === 'city_of_surrey')
              return key.includes('surrey') || types.includes(b.bill_type);
            return true;
          })
    );
  }, [currentHousehold?.id, providerKey, meta.billTypes]);

  useEffect(() => {
    setIsLoading(true);
    loadData()
      .catch((e) => console.error('Provider dashboard load failed:', e))
      .finally(() => setIsLoading(false));
  }, [loadData]);

  const providerSummary = useMemo(
    () => analytics?.byProvider.find((p) => p.providerKey === providerKey),
    [analytics, providerKey]
  );

  const chartWidth = Dimensions.get('window').width - 96;
  const months = analytics?.monthlyData.slice(-12) ?? [];
  const barData = months.map((m) => ({
    value: m.total / 100,
    label: monthLabel(m.month),
  }));

  const handleRefresh = async () => {
    setIsRefreshing(true);
    // `loadData` has no try/catch of its own. The mount path above wraps it in
    // .catch().finally(), but this one awaited it bare: a rejected fetch threw
    // straight out of the handler, so `setIsRefreshing(false)` never ran and
    // the pull-to-refresh spinner stuck permanently, on top of an unhandled
    // promise rejection.
    try {
      await loadData();
    } catch (error) {
      console.error('Provider dashboard refresh failed:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLoading) {
    return (
      <AppBackground opacity={0.5}>
        <ScreenHeader title={meta.label} showBackButton onBackPress={() => navigation.goBack()} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader title={meta.label} showBackButton onBackPress={() => navigation.goBack()} />
      <ScrollView
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        testID={`utility-provider-${providerKey}`}
      >
        <Card variant="filled" style={styles.heroCard}>
          <ProviderLogo providerKey={providerKey} fallbackIcon={meta.ionicon} size={72} logoWidth={220} />
          {/* The provider label is shown in the centered header; the hero keeps
              the logo + subtitle without repeating it. */}
          <Typography variant="body" color={colors.textSecondary}>
            Prorated monthly view — multi-month bills are split by day
          </Typography>
          {providerSummary && (
            <View style={styles.heroStats}>
              <View style={styles.heroStat}>
                <Typography variant="headline" weight="bold" color={colors.primary}>
                  {formatCurrency(providerSummary.avgMonthlyAmount)}
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary}>
                  Avg / month
                </Typography>
              </View>
              <View style={styles.heroStat}>
                <Typography variant="title2" weight="semibold">
                  {providerSummary.billCount}
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary}>
                  Bills
                </Typography>
              </View>
              {providerSummary.totalUsage > 0 && (
                <View style={styles.heroStat}>
                  <Typography variant="title2" weight="semibold">
                    {providerSummary.totalUsage.toFixed(1)}
                  </Typography>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    {providerSummary.usageUnit ?? 'usage'}
                  </Typography>
                </View>
              )}
            </View>
          )}
        </Card>

        {analytics?.insights && analytics.insights.length > 0 && (
          <View style={styles.section}>
            <Typography variant="title3" weight="semibold" style={styles.sectionTitle}>
              Insights
            </Typography>
            {analytics.insights
              .filter((i) => !i.providerKey || i.providerKey === providerKey || providerKey === 'overview')
              .slice(0, 3)
              .map((insight) => (
                <Card key={insight.id} variant="filled" style={styles.insightCard}>
                  <Typography variant="body" weight="semibold">
                    {insight.title}
                  </Typography>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    {insight.body}
                  </Typography>
                </Card>
              ))}
          </View>
        )}

        {barData.length > 0 && (
          <Card variant="filled" style={styles.chartCard}>
            <Typography variant="title3" weight="semibold">
              Monthly spend
            </Typography>
            <AppBarChart data={barData} width={chartWidth} />
          </Card>
        )}

        <View style={styles.section}>
          <Typography variant="title3" weight="semibold" style={styles.sectionTitle}>
            Recent bills
          </Typography>
          {bills.length === 0 ? (
            <Typography variant="body" color={colors.textSecondary}>
              No bills for this provider yet.
            </Typography>
          ) : (
            bills.slice(0, 5).map((bill) => (
              <TouchableOpacity
                key={bill.id}
                onPress={() => navigation.navigate('UtilityDetail', { billId: bill.id })}
              >
                <Card variant="filled" style={styles.billRow}>
                  <View>
                    <Typography variant="body" weight="semibold">
                      {bill.provider ?? bill.bill_type}
                    </Typography>
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {bill.billing_period_start} – {bill.billing_period_end}
                    </Typography>
                  </View>
                  <Typography variant="body" weight="bold" color={colors.primary}>
                    {formatCurrency(bill.amount)}
                  </Typography>
                </Card>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.base, paddingBottom: Layout.bottomTabBarClearance },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heroCard: { padding: Spacing.lg, marginBottom: Spacing.base, gap: Spacing.xs + Spacing.xxs },
  heroStats: { flexDirection: 'row', gap: Spacing.base, marginTop: Spacing.md },
  heroStat: { flex: 1 },
  section: { marginBottom: Spacing.base },
  sectionTitle: { marginBottom: Spacing.smd },
  insightCard: { padding: Spacing.md, marginBottom: Spacing.sm, gap: Spacing.xs },
  chartCard: { padding: Spacing.lg, marginBottom: Spacing.base },
  billRow: {
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
