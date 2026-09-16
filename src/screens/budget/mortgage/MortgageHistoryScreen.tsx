import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { mortgageApi, type MortgageStatement } from '@api/mortgage';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Button, Card, EmptyState, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { AppBarChart } from '@components/ui/AppBarChart';
import { AppLineChart } from '@components/ui/AppLineChart';
import { Icon, type IconProps } from '@components/ui/Icon';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useMortgageStore } from '@stores/mortgageStore';
import { IconSize, Layout, Spacing, useAppColors } from '@theme';
import { formatMoneyUnits, useDisplayCurrency } from '@utils/money';

import { buildChangeTimeline, type HistoryItemKind, type MortgageHistoryItem } from './mortgageHistory';
import { buildRateChangeHistory } from './mortgageRateHistory';
import {
  buildActualSplitStacks,
  buildInterestShareSeries,
  buildRateImpactSummary,
  type RateImpactSummary,
} from './mortgageRateImpact';

const KIND_ICON: Record<HistoryItemKind, IconProps['name']> = {
  origination: 'home-outline',
  renewal: 'refresh-outline',
  rate_change: 'trending-up-outline',
  rate_observed: 'trending-down-outline',
  payment_increase: 'card-outline',
  lump_sum_prepayment: 'arrow-down-circle-outline',
  amortization_change: 'calendar-outline',
};

/** Compact currency for the split-chart axis (bars are already ~$1–5k). */
function fmtChartMoney(dollars: number): string {
  return formatMoneyUnits(dollars, { abbreviate: true });
}

/**
 * Change history / timeline for a property — origination + every renewal (from
 * the terms) merged with the dated changes the user logs (rate/payment changes,
 * prepayments). Read-only; "Record a change" routes to the entry form.
 * useFocusEffect reloads so a newly recorded change shows on return.
 */
export function MortgageHistoryScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const route = useRoute<RouteProp<BudgetStackParamList, 'MortgageHistory'>>();
  const mortgageId = route.params?.mortgageId;
  const { currentHousehold } = useHouseholdStore();
  const dataRevision = useMortgageStore((s) => s.dataRevision);

  const [items, setItems] = useState<MortgageHistoryItem[] | null>(null);
  const [statements, setStatements] = useState<MortgageStatement[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentHousehold?.id || !mortgageId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      // Rate periods are the canonical rate axis; the statements also carry the
      // actual principal/interest split the impact charts are built from.
      // allSettled — a rate-history failure must not blank the whole timeline.
      const [terms, events, statementsRes, ratePeriodsRes] = await Promise.all([
        mortgageApi.listTerms(currentHousehold.id, mortgageId),
        mortgageApi.listEvents(currentHousehold.id, mortgageId),
        mortgageApi.listStatements(currentHousehold.id, mortgageId).catch(() => ({ statements: [] })),
        mortgageApi.listRatePeriods(currentHousehold.id, mortgageId).catch(() => ({ ratePeriods: [] })),
      ]);
      const { changes } = buildRateChangeHistory(
        statementsRes.statements,
        terms.terms,
        ratePeriodsRes.ratePeriods
      );
      setStatements(statementsRes.statements);
      setItems(buildChangeTimeline(terms.terms, events.events, changes));
    } catch {
      setStatements([]);
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold?.id, mortgageId]);

  // A peer can update this property while the detail screen stays open.
  useEffect(() => {
    if (dataRevision > 0) load();
  }, [dataRevision, load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const goRecord = () => {
    if (mortgageId) navigation.navigate('MortgageRecordChange', { mortgageId });
  };

  const header = (
    <ScreenHeader
      title="History"
      showBackButton
      onBackPress={() => navigation.goBack()}
      showNotificationBell={false}
      showAvatar={false}
      showPropertySwitcher={false}
    />
  );

  if (isLoading && items === null) {
    return (
      <AppBackground>
        <SafeAreaView edges={[]} testID="mortgage-history-screen">
          {header}
          <View style={styles.center} testID="mortgage-history-loading">
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  const isEmpty = !items || items.length === 0;

  return (
    <AppBackground>
    <SafeAreaView edges={[]} testID="mortgage-history-screen">
      {header}
      <ScrollView style={[screenScrollViewStyle.scroll, styles.flex]} contentContainerStyle={styles.content}>
        <Button title="Record a change" onPress={goRecord} testID="mortgage-history-record" />

        <RateImpactCard statements={statements} />

        {isEmpty ? (
          <View testID="mortgage-history-empty" style={styles.emptyWrap}>
            <EmptyState
              icon="time-outline"
              title="No history yet"
              description="Your mortgage start and every renewal show up here. Record a rate, payment or prepayment change to build the timeline."
            />
          </View>
        ) : (
          <>
            <Typography variant="caption" color={colors.textSecondary} style={styles.intro}>
              Every change to your rate, term and payment, in the order it happened.
            </Typography>
            {items!.map((item) => (
              <Card key={item.key} variant="filled" style={styles.row} testID={`mortgage-history-item-${item.kind}`}>
                <View style={[styles.iconWrap, { backgroundColor: colors.inputFieldBackground }]}>
                  <Icon name={KIND_ICON[item.kind] ?? 'ellipse-outline'} size={IconSize.md} color={colors.primary} />
                </View>
                <View style={styles.rowMeta}>
                  <Typography variant="body" weight="semibold">
                    {item.title}
                  </Typography>
                  <Typography variant="caption" color={colors.textSecondary}>
                    {item.date}
                  </Typography>
                  {item.lines.map((line, i) => (
                    <Typography key={`${item.key}-line-${i}`} variant="caption" color={colors.textPrimary}>
                      {line}
                    </Typography>
                  ))}
                  {item.note ? (
                    <Typography variant="caption" color={colors.textSecondary}>
                      {item.note}
                    </Typography>
                  ) : null}
                </View>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

/**
 * "How the rate changes hit your mortgage" — actuals from the statements.
 *
 * The headline sentence is deliberately framed per $100 paid rather than as a
 * raw dollar delta: statement periods aren't uniform (the first month of a
 * mortgage often has one payment, later ones two), so only a share-based
 * comparison is safe to state as a conclusion.
 */
function RateImpactCard({ statements }: { statements: MortgageStatement[] }) {
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const chartWidth = width - Spacing.lg * 2 - Spacing.base * 2;

  const summary: RateImpactSummary = useMemo(() => buildRateImpactSummary(statements), [statements]);
  const stacks = useMemo(
    () => buildActualSplitStacks(summary.points, colors.chartCool, colors.chartWarm),
    [summary.points, colors.chartCool, colors.chartWarm]
  );
  const shareSeries = useMemo(() => buildInterestShareSeries(summary.points), [summary.points]);

  if (!summary.hasComparison) return null;

  const improved = summary.interestShareDeltaPp < 0;
  const shareWord = improved ? 'less' : 'more';
  const rateNote =
    summary.rateDeltaBps != null && summary.rateDeltaBps !== 0
      ? `Your rate ${summary.rateDeltaBps < 0 ? 'fell' : 'rose'} ${(
          Math.abs(summary.rateDeltaBps) / 100
        ).toFixed(2)}% over these statements. `
      : '';

  return (
    <Card variant="filled" style={styles.impactCard} testID="mortgage-rate-impact">
      <Typography variant="label" weight="semibold">
        What the rate changes did
      </Typography>
      <Typography variant="caption" color={colors.textSecondary}>
        {rateNote}
        {Math.abs(summary.interestShareDeltaPp)}pp {shareWord} of every payment now goes to interest.
      </Typography>

      <View style={styles.impactRow}>
        <View style={styles.impactCell}>
          <Typography variant="caption" color={colors.textSecondary}>
            Was
          </Typography>
          <Typography variant="title" weight="bold" testID="mortgage-impact-before">
            ${summary.principalPer100First}
          </Typography>
          <Typography variant="caption" color={colors.textSecondary}>
            to your loan per $100
          </Typography>
        </View>
        <View style={styles.impactCell}>
          <Typography variant="caption" color={colors.textSecondary}>
            Now
          </Typography>
          <Typography
            variant="title"
            weight="bold"
            color={improved ? colors.success : colors.chartWarm}
            testID="mortgage-impact-after"
          >
            ${summary.principalPer100Latest}
          </Typography>
          <Typography variant="caption" color={colors.textSecondary}>
            to your loan per $100
          </Typography>
        </View>
      </View>

      <Typography variant="caption" weight="semibold" style={styles.chartTitle}>
        Where each payment went
      </Typography>
      <View style={styles.legendRow}>
        <LegendDot color={colors.chartCool} label="Principal" />
        <LegendDot color={colors.chartWarm} label="Interest" />
      </View>
      <AppBarChart
        stacks={stacks}
        width={chartWidth}
        formatValue={fmtChartMoney}
        hideValueLabels
      />

      <Typography variant="caption" weight="semibold" style={styles.chartTitle}>
        Interest share of each payment
      </Typography>
      <AppLineChart
        data={shareSeries}
        width={chartWidth}
        color={colors.chartWarm}
        formatValue={(v) => `${Math.round(v)}%`}
      />
    </Card>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Typography variant="caption" color={colors.textSecondary}>
        {label}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  impactCard: { padding: Spacing.base, gap: Spacing.xs },
  impactRow: { flexDirection: 'row', gap: Spacing.base, marginTop: Spacing.xs },
  impactCell: { flex: 1, gap: Spacing.xxs },
  chartTitle: { marginTop: Spacing.base },
  legendRow: { flexDirection: 'row', gap: Spacing.base },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xxs },
  legendSwatch: { width: 10, height: 10, borderRadius: 5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.lg, paddingBottom: Layout.bottomTabBarClearance, gap: Spacing.md },
  intro: { marginTop: Spacing.xs },
  emptyWrap: { marginTop: Spacing.lg },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.base, padding: Spacing.base },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowMeta: { flex: 1, gap: Spacing.xxs },
});
