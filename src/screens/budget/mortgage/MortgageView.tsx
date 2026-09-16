import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import {
  mortgageApi,
  type MortgagePaymentFrequency,
  type MortgageScheduleView,
  type MortgageStatement,
  type MortgageSummary,
  type MortgageTerm,
} from '@api/mortgage';
import {
  AppLineChart,
  Button,
  Card,
  EmptyState,
  FilterTabs,
  Icon,
  ProgressBar,
  ProgressRing,
  Typography,
  formatPercentShort,
} from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useMortgageStore, type MortgageSubTab } from '@stores/mortgageStore';
import { Spacing, useAppColors } from '@theme';

import { buildEquitySegments, buildRateHistory } from './mortgageChartData';
import { fmtCents, fmtMonths, fmtMonthYear, MONTHS_SHORT } from './mortgageFormat';
import { MortgagePaymentsView } from './MortgagePaymentsView';
import { buildRateChangeHistory, type RateChangeHistory } from './mortgageRateHistory';
import {
  buildRateLadder,
  buildScenarioSeed,
  computeRateScenario,
  type RateScenario,
} from './mortgageScenario';
import { StatTile } from './MortgageStatTile';
import {
  REQUIRED_MORTGAGE_TAB,
  resolveMortgageTabs,
  toMortgageFilterTabs,
  visibleContentTabs,
} from './mortgageTabs';
import { MortgageTermAverageSheet } from './MortgageTermAverageSheet';
import {
  attachDates,
  FREQUENCY_ADJECTIVE,
  FREQUENCY_LABEL,
  lastPaymentSplit,
  termAverageSplit,
  type LastPaymentSplit,
  type TermAverageSplit,
} from './paymentsInsights';
import { RateSlider } from './RateSlider';
import { paymentDateIso } from './scheduleDates';

/**
 * Mortgage container (Budget-only). Loads the household's mortgage list + the
 * active mortgage's BE-computed summary/schedule, and renders the sub-tab views.
 * Does NO money math — every figure comes from the amortization engine via
 * `mortgageApi`. Charts (principal-vs-interest, equity growth, rate history)
 * land in Phase 2; Phase 1 ships the overview + schedule.
 */
export function MortgageView() {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const { currentHousehold } = useHouseholdStore();
  const {
    selectedMortgageId,
    setSelectedMortgage,
    setMortgages,
    activeSubTab,
    setActiveSubTab,
    dataRevision,
    subTabOrder,
    hiddenSubTabs,
  } = useMortgageStore();

  // The strip the user configured in Mortgage settings → "Customize tabs".
  const shownTabs = useMemo(
    () => resolveMortgageTabs(subTabOrder, hiddenSubTabs).shown,
    [subTabOrder, hiddenSubTabs]
  );
  const subTabs = useMemo(() => toMortgageFilterTabs(shownTabs), [shownTabs]);
  // Hiding the tab you were last on must not blank the view: fall back to the
  // first visible content tab (Overview can never be hidden, so there is always
  // at least one). Rendering off the derived value avoids a one-frame blank.
  const contentTabs = useMemo(() => visibleContentTabs(shownTabs), [shownTabs]);
  const effectiveSubTab = contentTabs.some((t) => t.id === activeSubTab)
    ? activeSubTab
    : ((contentTabs[0]?.id ?? REQUIRED_MORTGAGE_TAB) as MortgageSubTab);

  React.useEffect(() => {
    if (effectiveSubTab !== activeSubTab) setActiveSubTab(effectiveSubTab);
  }, [effectiveSubTab, activeSubTab, setActiveSubTab]);

  const [summary, setSummary] = useState<MortgageSummary | null>(null);
  const [schedule, setSchedule] = useState<MortgageScheduleView | null>(null);
  const [terms, setTerms] = useState<MortgageTerm[]>([]);
  const [statements, setStatements] = useState<MortgageStatement[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hasMortgage, setHasMortgage] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  // A local-first build reads the mortgage out of the on-device ledger, so a
  // failure here is never "you are offline" — a cloud-with-a-slash icon and
  // "check your connection" send the member to reset their Wi-Fi over a problem
  // the radio cannot fix, and they are exactly the connectivity noise a
  // local-first app promises not to make. Remote builds keep the old wording,
  // which is accurate for them.
  const localFirst = isBudgetLocalFirst();
  const loadFailedIcon = localFirst ? 'refresh-outline' : 'cloud-offline-outline';
  const loadFailedDescription = localFirst
    ? 'Your mortgage is saved on this device — nothing was lost. Try again.'
    : 'Something went wrong. Check your connection and try again.';

  const load = useCallback(async () => {
    if (!currentHousehold?.id) return;
    setIsLoading(true);
    setError(false);
    try {
      const { mortgages } = await mortgageApi.list(currentHousehold.id);
      // Republish for the header's property switcher, which renders outside
      // this view and must not fetch the list a second time.
      setMortgages(mortgages);
      if (mortgages.length === 0) {
        setHasMortgage(false);
        setActiveId(null);
        setSummary(null);
        // No property → clear the selection so the header title falls back from
        // the switcher to a plain "Mortgage".
        if (selectedMortgageId !== null) setSelectedMortgage(null);
        return;
      }
      setHasMortgage(true);
      const active = mortgages.find((m) => m.id === selectedMortgageId) ?? mortgages[0];
      if (active.id !== selectedMortgageId) setSelectedMortgage(active.id);
      // Select the active mortgage UP FRONT so the destination tabs (Statements /
      // Renew / History) stay usable even if the detail fetches below fail —
      // they only need the id, not the summary. (Previously activeId was set
      // last, so any one failed call left the whole view empty with dead
      // actions.)
      setActiveId(active.id);
      const [s, sched, t, st] = await Promise.all([
        mortgageApi.getSummary(currentHousehold.id, active.id),
        mortgageApi.getSchedule(currentHousehold.id, active.id),
        mortgageApi.listTerms(currentHousehold.id, active.id),
        mortgageApi.listStatements(currentHousehold.id, active.id),
      ]);
      setSummary(s);
      setSchedule(sched);
      setTerms(t.terms);
      setStatements(st.statements);
    } catch {
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold?.id, selectedMortgageId, setSelectedMortgage, setMortgages]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Reload whenever a mutation bumps the revision.
  React.useEffect(() => {
    if (dataRevision === 0) return;
    load();
  }, [dataRevision, load]);

  if (isLoading && hasMortgage === null) {
    return (
      <View style={styles.center} testID="mortgage-loading">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (hasMortgage === false) {
    return (
      <View testID="mortgage-empty" style={styles.root}>
        <EmptyState
          icon="home"
          title="Track your mortgage"
          description="Add your mortgage to see how much you've paid off, your interest-vs-equity split, and a renewal reminder."
          action={{ label: 'Set up mortgage', onPress: () => navigation.navigate('MortgageSetup') }}
        />
      </View>
    );
  }

  // The list call itself failed — we don't even know if a mortgage exists.
  if (error && hasMortgage === null) {
    return (
      <View testID="mortgage-view" style={styles.root}>
        <EmptyState
          icon={loadFailedIcon}
          title="Couldn't load your mortgage"
          description={loadFailedDescription}
          action={{ label: 'Retry', onPress: load }}
        />
      </View>
    );
  }

  return (
    <View testID="mortgage-view" style={styles.root}>
      <FilterTabs
        tabs={subTabs}
        activeTab={effectiveSubTab}
        onTabChange={(id) => {
          // The three destination tabs push their own screen; the rest switch
          // the inline content below. (`activeId` is always set once the tabs
          // render — the empty/loading states return before this point.)
          switch (id) {
            case 'statements':
              if (activeId) navigation.navigate('MortgageStatements', { mortgageId: activeId });
              return;
            case 'renew':
              if (activeId) navigation.navigate('MortgageRenew', { mortgageId: activeId });
              return;
            case 'history':
              if (activeId) navigation.navigate('MortgageHistory', { mortgageId: activeId });
              return;
            default:
              setActiveSubTab(id as MortgageSubTab);
          }
        }}
        showActiveIndicator={false}
        scrollable
      />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {effectiveSubTab === 'overview' && summary ? (
          <MortgageOverview summary={summary} schedule={schedule} statements={statements} />
        ) : null}
        {effectiveSubTab === 'payments' && schedule ? (
          <MortgagePaymentsView schedule={schedule} summary={summary} statements={statements} />
        ) : null}
        {effectiveSubTab === 'equity' && summary ? <EquityBreakdownCard summary={summary} /> : null}
        {effectiveSubTab === 'forecast' && summary ? (
          <ForecastTab summary={summary} statements={statements} terms={terms} />
        ) : null}
        {effectiveSubTab === 'schedule' && schedule ? (
          <MortgageScheduleTable
            schedule={schedule}
            statements={statements}
            mortgageId={activeId}
            termStartDate={summary?.currentTerm?.termStartDate ?? null}
            paymentFrequency={summary?.paymentFrequency ?? null}
          />
        ) : null}
        {effectiveSubTab === 'renewal' && summary ? (
          <RenewalCard summary={summary} terms={terms} />
        ) : null}

        {error && !summary ? (
          <EmptyState
            icon={loadFailedIcon}
            title="Couldn't load the details"
            description="Your mortgage is here, but we couldn't load its figures. Please try again."
            action={{ label: 'Retry', onPress: load }}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function useChartWidth(): number {
  const { width } = useWindowDimensions();
  return Math.max(240, width - 2 * Spacing.lg - 2 * Spacing.base);
}

function EquityBreakdownCard({ summary }: { summary: MortgageSummary }) {
  const colors = useAppColors();
  const segments = useMemo(
    () =>
      buildEquitySegments(summary.equity, {
        down: colors.chartCool,
        paydown: colors.primary,
        appreciation: colors.chartWarm,
      }),
    [summary.equity, colors.chartCool, colors.primary, colors.chartWarm]
  );
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <Card variant="filled" style={styles.card}>
      <Typography variant="label" weight="semibold">
        Your equity
      </Typography>
      <Typography variant="title" weight="bold">
        ${Math.round(summary.equity.totalEquityCents / 100).toLocaleString('en-CA')}
      </Typography>
      {segments.map((seg) => (
        <View key={seg.label} style={styles.equityRow}>
          <View style={styles.equityLabel}>
            <View style={[styles.dot, { backgroundColor: seg.color }]} />
            <Typography variant="caption" color={colors.textSecondary}>
              {seg.label}
            </Typography>
          </View>
          <View style={styles.equityBarFill}>
            <ProgressBar progress={seg.value / total} height={8} color={seg.color} />
          </View>
          <Typography variant="caption">${Math.round(seg.value).toLocaleString('en-CA')}</Typography>
        </View>
      ))}
      {!summary.equity.hasAppreciation ? (
        <Typography variant="caption" color={colors.textSecondary}>
          Add your home's current value in settings to see appreciation.
        </Typography>
      ) : null}

      <View style={[styles.projectedRow, { borderTopColor: colors.divider }]} testID="mortgage-equity-projected">
        <Typography variant="caption" color={colors.textSecondary}>
          Projected at renewal ({summary.projected.toEndOfTerm.date})
        </Typography>
        <View style={styles.projectedValueRow}>
          <Typography variant="bodyLarge" weight="bold">
            {fmtCents(summary.projected.toEndOfTerm.equityCents)}
          </Typography>
          <Typography variant="caption" color={colors.success}>
            +{fmtCents(summary.projected.toEndOfTerm.equityCents - summary.equity.totalEquityCents)}
          </Typography>
        </View>
        <Typography variant="caption" color={colors.textSecondary}>
          At today's rate of {summary.projected.forwardRate.nominalPct}%. Upload each statement to keep this
          current — a variable rate can move it a lot.
        </Typography>
      </View>
    </Card>
  );
}

function RenewalCard({ summary, terms }: { summary: MortgageSummary; terms: MortgageTerm[] }) {
  const colors = useAppColors();
  const chartWidth = useChartWidth();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const rateHistory = useMemo(() => buildRateHistory(terms), [terms]);
  return (
    <View style={styles.overview}>
      <Card variant="filled" style={styles.card}>
        <Typography variant="label" weight="semibold">
          Renewal window
        </Typography>
        <Typography variant="body" color={colors.textSecondary}>
          Matures {summary.nextRenewalDate} · {Math.max(0, summary.daysToRenewal)} days away.
        </Typography>
        <Typography variant="caption" color={colors.textSecondary}>
          Shop offers across banks a few months before maturity — most people leave money on the table by
          auto-renewing.
        </Typography>
        <Button
          title="Compare bank offers"
          onPress={() => navigation.navigate('MortgageRenewalOffers', { mortgageId: summary.mortgageId })}
        />
      </Card>
      {rateHistory.length > 1 ? (
        <Card variant="filled" style={styles.card}>
          <Typography variant="label" weight="semibold">
            Rate history
          </Typography>
          <AppLineChart data={rateHistory} width={chartWidth} stepped formatValue={formatPercentShort} />
        </Card>
      ) : null}
    </View>
  );
}

function MortgageOverview({
  summary,
  schedule,
  statements,
}: {
  summary: MortgageSummary;
  schedule: MortgageScheduleView | null;
  statements: MortgageStatement[];
}) {
  const colors = useAppColors();

  const rows = useMemo(
    () => attachDates(schedule?.rows ?? [], summary.currentTerm?.termStartDate, summary.paymentFrequency),
    [schedule?.rows, summary.currentTerm?.termStartDate, summary.paymentFrequency]
  );
  // Top = the payment that just happened (the bank's own figures when a statement
  // carries them); bottom = the average payment of this term, the yardstick that
  // makes the top figure mean something.
  const last = useMemo(
    () => lastPaymentSplit(rows, statements, schedule?.paymentsElapsed ?? summary.paymentsElapsed),
    [rows, statements, schedule?.paymentsElapsed, summary.paymentsElapsed]
  );
  const termAverage = useMemo(
    () => termAverageSplit(rows, summary.currentTerm?.maturityDate),
    [rows, summary.currentTerm?.maturityDate]
  );
  const [termSheetVisible, setTermSheetVisible] = useState(false);

  return (
    <View style={styles.overview}>
      {/* Paid-off ring + balance */}
      <Card variant="filled" style={styles.card}>
        <View style={styles.ringRow}>
          <ProgressRing progress={summary.pctPaid} size={132} label="paid off" color={colors.primary} />
          <View style={styles.ringMeta}>
            <Typography variant="caption" color={colors.textSecondary}>
              Balance {summary.balanceStatus === 'estimated' ? '(estimated)' : '(confirmed)'}
            </Typography>
            <Typography variant="title" weight="bold">
              {fmtCents(summary.currentBalanceCents)}
            </Typography>
            <Typography variant="caption" color={colors.textSecondary}>
              of {fmtCents(summary.originalPrincipalCents)} · {summary.rate.nominalPct}%{' '}
              {summary.rate.rateType === 'fixed' ? 'fixed' : 'variable'}
            </Typography>
          </View>
        </View>
      </Card>

      {/* KPI tiles */}
      <View style={styles.tileRow}>
        <StatTile label="Total paid" value={fmtCents(summary.totalPaidToDateCents)} />
        <StatTile
          label="Interest paid"
          value={fmtCents(summary.totalInterestToDateCents)}
          hint={
            summary.paidToDate?.interestSource === 'actual'
              ? `from ${summary.paidToDate.statementsWithInterest} statement${
                  summary.paidToDate.statementsWithInterest === 1 ? '' : 's'
                }`
              : 'estimated'
          }
        />
      </View>
      <View style={styles.tileRow}>
        <StatTile label="Equity built" value={fmtCents(summary.equity.totalEquityCents)} />
        <StatTile
          label="Payment"
          value={fmtCents(summary.scheduledPaymentCents)}
          hint={FREQUENCY_LABEL[summary.paymentFrequency]}
        />
      </View>

      {/* Interest vs principal: the last payment, read against the term's average */}
      <Card variant="filled" style={styles.card} testID="mortgage-overview-split">
        <Typography variant="label" weight="semibold">
          Interest vs equity
        </Typography>

        {last ? (
          <SplitBlock
            testID="mortgage-split-last"
            title={lastSplitTitle(last)}
            interestCents={last.interestCents}
            principalCents={last.principalCents}
            note={lastSplitNote(last, summary.paymentFrequency)}
          />
        ) : (
          <SplitBlock
            testID="mortgage-split-last"
            title="Next payment"
            interestCents={summary.currentPaymentSplit.interestCents}
            principalCents={summary.currentPaymentSplit.principalCents}
            note="At today's balance and rate."
          />
        )}

        {termAverage ? (
          <SplitBlock
            testID="mortgage-split-term-average"
            title="Average this term"
            interestCents={termAverage.interestCents}
            principalCents={termAverage.principalCents}
            note={termAverageNote(termAverage, summary.paymentFrequency)}
            divided
            onPress={() => setTermSheetVisible(true)}
          />
        ) : null}
      </Card>

      {termAverage ? (
        <MortgageTermAverageSheet
          visible={termSheetVisible}
          onClose={() => setTermSheetVisible(false)}
          rows={rows}
          termAverage={termAverage}
          maturityDate={summary.currentTerm?.maturityDate ?? null}
          frequency={summary.paymentFrequency}
        />
      ) : null}
    </View>
  );
}

/** One labelled interest/principal bar — the same reading in both halves of the card. */
function SplitBlock({
  title,
  interestCents,
  principalCents,
  note,
  divided,
  testID,
  onPress,
}: {
  title: string;
  interestCents: number;
  principalCents: number;
  note: string;
  /** Draw a hairline above the block (separates the two readings). */
  divided?: boolean;
  testID: string;
  /** When set, the whole block opens a drill-down (e.g. the term breakdown sheet). */
  onPress?: () => void;
}) {
  const colors = useAppColors();
  const total = interestCents + principalCents;
  // Principal is the exact complement of the displayed interest % so the two
  // shares always read as 100% (independent rounding could sum to 101%).
  const interestPct = total > 0 ? Math.round((interestCents / total) * 100) : 0;
  const principalPct = total > 0 ? 100 - interestPct : 0;

  const body = (
    <>
      <View style={styles.splitHeader}>
        <View style={styles.splitTitleRow}>
          <Typography variant="caption" weight="semibold">
            {title}
          </Typography>
          {onPress ? <Icon name="chevron-forward" size={14} color={colors.textTertiary} /> : null}
        </View>
        <Typography variant="caption" weight="semibold" color={colors.textSecondary}>
          {fmtCents(total)}
        </Typography>
      </View>
      <ProgressBar
        value={interestCents}
        max={Math.max(1, total)}
        height={12}
        color={colors.chartWarm}
        trackColor={colors.primary}
      />
      <View style={styles.splitLegend}>
        <Typography variant="caption" color={colors.chartWarm}>
          Interest {fmtCents(interestCents)} ({interestPct}%)
        </Typography>
        <Typography variant="caption" color={colors.primary}>
          Principal {fmtCents(principalCents)} ({principalPct}%)
        </Typography>
      </View>
      <Typography variant="caption" color={colors.textSecondary}>
        {note}
      </Typography>
    </>
  );

  const containerStyle = [
    styles.splitBlock,
    divided ? [styles.splitDivider, { borderTopColor: colors.divider }] : null,
  ];

  if (onPress) {
    return (
      <Pressable
        style={containerStyle}
        onPress={onPress}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${title}, tap for the term breakdown`}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <View style={containerStyle} testID={testID}>
      {body}
    </View>
  );
}

/** A statement period can cover more than one payment — never call that "one payment". */
function lastSplitTitle(last: LastPaymentSplit): string {
  if (last.payments > 1) return 'Last statement';
  return last.upcoming ? 'Next payment' : 'Last payment';
}

function lastSplitNote(last: LastPaymentSplit, frequency: MortgagePaymentFrequency): string {
  const adjective = FREQUENCY_ADJECTIVE[frequency];
  const when = last.iso ? fmtMonthYear(last.iso) : null;
  if (last.source === 'statement') {
    const period = ` — ${last.payments} ${adjective} payment${last.payments === 1 ? '' : 's'}`;
    return when ? `From your ${when} statement${period}.` : `From your statement${period}.`;
  }
  if (last.upcoming) {
    return when ? `Your first ${adjective} payment, due ${when}.` : `Your first ${adjective} payment.`;
  }
  return when
    ? `${when}, from your plan — upload the statement for your bank's own split.`
    : "From your plan — upload a statement for your bank's own split.";
}

function termAverageNote(avg: TermAverageSplit, frequency: MortgagePaymentFrequency): string {
  const adjective = FREQUENCY_ADJECTIVE[frequency];
  const span = avg.fromIso && avg.toIso ? `, ${fmtMonthYear(avg.fromIso)} – ${fmtMonthYear(avg.toIso)}` : '';
  return `Average of ${avg.payments} ${adjective} payment${avg.payments === 1 ? '' : 's'}${span}, at today's rate. Tap for the term breakdown.`;
}

function MortgageScheduleTable({
  schedule,
  statements,
  mortgageId,
  termStartDate,
  paymentFrequency,
}: {
  schedule: MortgageScheduleView;
  statements: MortgageStatement[];
  mortgageId: string | null;
  termStartDate: string | null;
  paymentFrequency: MortgagePaymentFrequency | null;
}) {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const rows = schedule.rows.slice(0, 24);

  // Newest statement per calendar month, so a row can link to the statement that
  // confirms its month (statements aren't guaranteed sorted or one-per-month).
  const statementByMonth = useMemo(() => {
    const map = new Map<string, MortgageStatement>();
    for (const s of statements) {
      const ym = s.statement_date.slice(0, 7);
      const existing = map.get(ym);
      if (!existing || s.statement_date > existing.statement_date) map.set(ym, s);
    }
    return map;
  }, [statements]);

  // We can only label rows by month when we know the term anchor + cadence; a
  // failed summary fetch leaves those null, so we fall back to the payment number.
  const canDate = Boolean(termStartDate && paymentFrequency);

  return (
    <View style={styles.overview}>
      <Card variant="filled" style={styles.card}>
        <Typography variant="label" weight="semibold">
          Amortization schedule
        </Typography>
        {canDate ? (
          <Typography variant="caption" color={colors.textSecondary}>
            Tap a month with a statement to review it. Months marked “~” are projected.
          </Typography>
        ) : null}
        <View style={[styles.tableHeader, { borderBottomColor: colors.divider }]}>
          <Typography variant="caption" color={colors.textSecondary} style={styles.colMonth}>
            {canDate ? 'Month' : '#'}
          </Typography>
          <Typography variant="caption" color={colors.textSecondary} style={styles.colAmt}>
            Interest
          </Typography>
          <Typography variant="caption" color={colors.textSecondary} style={styles.colAmt}>
            Principal
          </Typography>
          <Typography variant="caption" color={colors.textSecondary} style={styles.colAmt}>
            Balance
          </Typography>
        </View>
        {rows.map((r) => {
          const iso = canDate ? paymentDateIso(termStartDate, r.index, paymentFrequency!) : null;
          const stmt = iso ? statementByMonth.get(iso.slice(0, 7)) : undefined;
          const monthLabel = iso ? fmtMonthYear(iso) : String(r.index);
          return (
            <View key={r.index} style={styles.tableRow}>
              {stmt && mortgageId ? (
                <Pressable
                  style={styles.colMonth}
                  onPress={() =>
                    navigation.navigate('MortgageStatementForm', { mortgageId, statement: stmt })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Open the ${monthLabel} statement`}
                  testID={`mortgage-schedule-statement-${r.index}`}
                >
                  <Typography variant="caption" weight="semibold" color={colors.primary}>
                    {monthLabel}
                  </Typography>
                </Pressable>
              ) : (
                <Typography variant="caption" color={colors.textSecondary} style={styles.colMonth}>
                  {iso ? `~${monthLabel}` : monthLabel}
                </Typography>
              )}
              <Typography variant="caption" color={colors.chartWarm} style={styles.colAmt}>
                {fmtCents(r.interest)}
              </Typography>
              <Typography variant="caption" color={colors.primary} style={styles.colAmt}>
                {fmtCents(r.principal)}
              </Typography>
              <Typography variant="caption" style={styles.colAmt}>
                {fmtCents(r.balance)}
              </Typography>
            </View>
          );
        })}
        {schedule.rows.length > rows.length ? (
          <Typography variant="caption" color={colors.textSecondary} align="center" style={styles.moreNote}>
            + {schedule.rows.length - rows.length} more payments
          </Typography>
        ) : null}
      </Card>
    </View>
  );
}

/** Rate points for the quick-chips: the current rate ± common moves. */
const CHIP_DEFS: Array<{ id: string; label: string; delta: number }> = [
  { id: 'minus1', label: '−1%', delta: -0.01 },
  { id: 'now', label: 'Now', delta: 0 },
  { id: 'plus1', label: '+1%', delta: 0.01 },
  { id: 'plus2', label: '+2%', delta: 0.02 },
];

function ForecastTab({
  summary,
  statements,
  terms,
}: {
  summary: MortgageSummary;
  statements: MortgageStatement[];
  terms: MortgageTerm[];
}) {
  const colors = useAppColors();
  const chartWidth = useChartWidth();

  const seed = useMemo(() => buildScenarioSeed(summary), [summary]);
  const ladder = useMemo(() => buildRateLadder(seed.currentNominal), [seed.currentNominal]);
  const [rate, setRate] = useState(seed.currentNominal);
  const scenario: RateScenario = useMemo(() => computeRateScenario(seed, rate), [seed, rate]);
  // Every rate change, detected automatically from the statements' own interest
  // breakdowns (exact effective dates) — series = step line, changes = the rows.
  const rateHistory = useMemo(() => buildRateChangeHistory(statements, terms), [statements, terms]);

  const ladderMin = ladder[0];
  const ladderMax = ladder[ladder.length - 1];
  const proj = summary.projected;

  if (!summary.scheduleAvailable) {
    return (
      <Card variant="filled" style={styles.card}>
        <Typography variant="label" weight="semibold">
          Forecast
        </Typography>
        <Typography variant="caption" color={colors.textSecondary}>
          Add your rate or a statement with a payment so we can project this mortgage forward.
        </Typography>
      </Card>
    );
  }

  return (
    <View style={styles.overview}>
      {/* Baseline forecast at today's rate */}
      <Card variant="filled" style={styles.card} testID="mortgage-forecast-baseline">
        <Typography variant="label" weight="semibold">
          At today's rate ({proj.forwardRate.nominalPct}%)
        </Typography>
        <Typography variant="caption" color={colors.textSecondary}>
          Projected to renewal on {proj.toEndOfTerm.date}
          {proj.forwardRate.basedOn === 'statement' && proj.forwardRate.asOfDate
            ? ` · based on your ${proj.forwardRate.asOfDate} statement`
            : ''}
          .
        </Typography>
        <View style={styles.tileRow}>
          <StatTile label="Balance at renewal" value={fmtCents(proj.toEndOfTerm.balanceCents)} />
          <StatTile label="Equity at renewal" value={fmtCents(proj.toEndOfTerm.equityCents)} />
        </View>
        <View style={styles.tileRow}>
          <StatTile label="Interest left this term" value={fmtCents(proj.toEndOfTerm.interestRemainingCents)} />
          <StatTile label="Total interest by renewal" value={fmtCents(proj.toEndOfTerm.totalInterestCents)} />
        </View>
        {proj.projectionStale ? (
          <Typography variant="caption" color={colors.chartWarm} testID="mortgage-forecast-stale">
            ⚠️ It's been a while since your last statement — upload a fresh one so this forecast reflects your
            current rate.
          </Typography>
        ) : null}
      </Card>

      {/* Interactive rate scenario */}
      <Card variant="filled" style={styles.card} testID="mortgage-scenario">
        <Typography variant="label" weight="semibold">
          What if your rate changes?
        </Typography>
        <Typography variant="caption" color={colors.textSecondary}>
          A flexible rate can move up or down a lot. Drag to see the impact on your payment, interest and equity.
        </Typography>

        <Typography variant="title" weight="bold" align="center" testID="mortgage-scenario-rate">
          {(rate * 100).toFixed(2)}%
        </Typography>
        <RateSlider
          value={rate}
          min={ladderMin}
          max={ladderMax}
          step={0.0025}
          onChange={setRate}
          testID="mortgage-rate-slider"
        />

        <View style={styles.chipRow}>
          {CHIP_DEFS.map((chip) => {
            const target = Math.max(ladderMin, Math.min(ladderMax, seed.currentNominal + chip.delta));
            const active = Math.abs(target - rate) < 0.0001;
            return (
              <Pressable
                key={chip.id}
                testID={`mortgage-scenario-chip-${chip.id}`}
                onPress={() => setRate(target)}
                style={[
                  styles.chip,
                  { borderColor: active ? colors.primary : colors.divider },
                  active ? { backgroundColor: colors.primary } : null,
                ]}
              >
                <Typography variant="caption" color={active ? colors.white : colors.textSecondary}>
                  {chip.label}
                </Typography>
              </Pressable>
            );
          })}
        </View>

        <ScenarioResultRow
          label="Payment"
          value={fmtCents(Math.round(scenario.paymentDollars * 100))}
          delta={scenario.paymentDeltaDollars}
          testID="mortgage-scenario-payment"
        />
        <ScenarioResultRow
          label="Interest to renewal"
          value={fmtCents(Math.round(scenario.interestToMaturityDollars * 100))}
          testID="mortgage-scenario-interest"
        />
        <ScenarioResultRow
          label="Equity at renewal"
          value={fmtCents(Math.round(scenario.equityAtMaturityDollars * 100))}
          testID="mortgage-scenario-equity"
        />
        <ScenarioResultRow
          label="Total interest to payoff"
          value={fmtCents(Math.round(scenario.totalInterestToPayoffDollars * 100))}
          testID="mortgage-scenario-payoff-interest"
        />
        <ScenarioResultRow
          label="If you keep today's payment"
          value={
            scenario.keepPaymentPayoffMonths == null
              ? "won't amortize"
              : `paid off in ${fmtMonths(scenario.keepPaymentPayoffMonths)}`
          }
          testID="mortgage-scenario-keep-payment"
        />
        {scenario.keepPaymentPayoffMonths == null ? (
          <Typography variant="caption" color={colors.chartWarm}>
            At this rate your current payment wouldn't even cover the interest — the balance would grow (a VRM
            trigger). Your bank would raise the payment.
          </Typography>
        ) : null}
      </Card>

      {/* Rate changes — detected automatically from the statements' own interest
          breakdowns (exact effective dates), shown as a step line + a change log. */}
      {rateHistory.series.length > 1 || rateHistory.changes.length > 0 ? (
        <Card variant="filled" style={styles.card} testID="mortgage-rate-movement">
          <Typography variant="label" weight="semibold">
            How your rate has changed
          </Typography>
          <Typography variant="caption" color={colors.textSecondary}>
            Pulled automatically from your statements — every rate change, dated.
          </Typography>
          {rateHistory.series.length > 1 ? (
            <AppLineChart
              data={rateHistory.series}
              width={chartWidth}
              stepped
              formatValue={formatPercentShort}
            />
          ) : null}
          {rateHistory.changes.length > 0 ? (
            <View style={styles.rateChangeList} testID="mortgage-rate-changes">
              {rateHistory.changes.map((c) => (
                <RateChangeRow key={c.key} change={c} />
              ))}
            </View>
          ) : (
            <Typography variant="caption" color={colors.textSecondary}>
              No rate changes yet — your rate has held steady across your statements.
            </Typography>
          )}
        </Card>
      ) : null}
    </View>
  );
}

/** Formats an ISO date as "Oct 30, 2025" without pulling in a locale/timezone. */
function fmtRateChangeDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const month = MONTHS_SHORT[(m ?? 0) - 1];
  return month && y && d ? `${month} ${d}, ${y}` : iso;
}

/** One detected rate change: "Oct 30, 2025 — 3.84% → 3.59% (↓0.25%)". */
function RateChangeRow({ change }: { change: RateChangeHistory['changes'][number] }) {
  const colors = useAppColors();
  const cut = change.deltaBps < 0;
  const deltaColor = cut ? colors.success : colors.chartWarm;
  const deltaAbs = Math.abs(change.deltaBps) / 100;
  return (
    <View style={styles.rateChangeRow} testID={`mortgage-rate-change-${change.date}`}>
      <View style={styles.rateChangeMeta}>
        <Typography variant="caption" weight="semibold">
          {fmtRateChangeDate(change.date)}
        </Typography>
        <Typography variant="caption" color={colors.textSecondary}>
          {(change.fromBps / 100).toFixed(2)}% → {(change.toBps / 100).toFixed(2)}%
        </Typography>
      </View>
      <Typography variant="caption" weight="semibold" color={deltaColor}>
        {cut ? '↓' : '↑'}
        {deltaAbs.toFixed(2)}%
      </Typography>
    </View>
  );
}

function ScenarioResultRow({
  label,
  value,
  delta,
  testID,
}: {
  label: string;
  value: string;
  delta?: number;
  testID?: string;
}) {
  const colors = useAppColors();
  const deltaColor = delta == null ? colors.textSecondary : delta > 0 ? colors.chartWarm : colors.success;
  return (
    <View style={styles.resultRow} testID={testID}>
      <Typography variant="body" color={colors.textSecondary}>
        {label}
      </Typography>
      <View style={styles.resultValue}>
        <Typography variant="body" weight="semibold">
          {value}
        </Typography>
        {delta != null && Math.abs(delta) >= 1 ? (
          <Typography variant="caption" color={deltaColor}>
            {delta > 0 ? '+' : '−'}${Math.abs(Math.round(delta)).toLocaleString('en-CA')}
          </Typography>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', alignSelf: 'stretch', flex: 1 },
  center: { paddingVertical: Spacing.xxl, alignItems: 'center', justifyContent: 'center' },
  body: { paddingTop: Spacing.base, paddingBottom: 140, gap: Spacing.md },
  overview: { gap: Spacing.md },
  card: { padding: Spacing.base, gap: Spacing.sm },
  equityRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  equityLabel: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, width: 110 },
  equityBarFill: { flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  ringMeta: { flex: 1, gap: Spacing.xxs },
  tileRow: { flexDirection: 'row', gap: Spacing.md },
  splitBlock: { gap: Spacing.xs, paddingTop: Spacing.sm },
  splitDivider: { borderTopWidth: 1 },
  splitHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  splitTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xxs },
  splitLegend: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: Spacing.xs },
  projectedRow: { borderTopWidth: 1, paddingTop: Spacing.sm, marginTop: Spacing.xs, gap: Spacing.xxs },
  projectedValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginVertical: Spacing.xs },
  chip: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: 999,
    borderWidth: 1,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  resultValue: { alignItems: 'flex-end' },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  tableRow: { flexDirection: 'row', paddingVertical: Spacing.xs },
  colMonth: { width: 74 },
  colAmt: { flex: 1, textAlign: 'right' },
  moreNote: { marginTop: Spacing.sm },
  rateChangeList: { marginTop: Spacing.xs, gap: Spacing.xs },
  rateChangeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  rateChangeMeta: { gap: Spacing.xxs },
});
