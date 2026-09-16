import React, { useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import type { BudgetLoan, LoanScheduleView } from '@api/budgetLoans';
import { budgetLoansApi } from '@api/budgetLoans';
import type { SavingsRecurringPayment } from '@api/savings';
import { AppLineChart, ProgressBar, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { AppBarChart, formatChartCurrencyShort } from '@components/ui/AppBarChart';
import { useTheme } from '@contexts/ThemeContext';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';
import { fmtMonthYear } from '../mortgage/mortgageFormat';
import { StatTile } from '../mortgage/MortgageStatTile';
import { attachDates, buildBucketStacks, buildCumulativeSeries, groupByMonth } from '../mortgage/paymentsInsights';

/**
 * "Loan payoff insights" — the richer replacement for the old inline
 * payments-left/progress-bar block in `RecurringPaymentDetailSheet`, for a
 * Monthly-Payments row that has a loan/BNPL plan tracked via `budget_loans`
 * (car loans, personal loans, installment plans — see `budgetLoansApi`).
 *
 * Renders in two layers, deliberately NOT gated together:
 *   1. Immediately from `item.loan_summary` (already loaded with the list,
 *      no fetch) — a progress bar + a grid of `StatTile`s. These must render
 *      the instant this component mounts.
 *   2. Lazily, after mount — the full amortization schedule
 *      (`budgetLoansApi.getSchedule`) drives two chart cards ("Where your
 *      payments go" / "What it adds up to"), and the loan record itself
 *      (`budgetLoansApi.get`) adds a lender/portal-link row and tells us
 *      whether the loan is 0% APR (in which case the cumulative-interest
 *      chart is meaningless and is skipped entirely).
 *
 * Standalone by design — this file does not import from or get imported by
 * `RecurringPaymentDetailSheet.tsx`; a separate integration pass wires it in.
 * Every chart figure comes straight off the BE schedule via the SAME pure
 * bucketing helpers the Mortgage → Payments tab uses
 * (`paymentsInsights.ts`) — nothing here re-derives amortization math.
 */

interface LoanPaymentInsightsProps {
  item: SavingsRecurringPayment;
  householdId: string;
}

/** Dot + name legend for a chart — mirrors `MortgagePaymentsView`'s hand-rolled legend row exactly. */
function ChartLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  const colors = useAppColors();
  return (
    <View style={styles.legendRow}>
      {items.map((legendItem) => (
        <View key={legendItem.label} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: legendItem.color }]} />
          <Typography variant="caption1" color={colors.textSecondary}>
            {legendItem.label}
          </Typography>
        </View>
      ))}
    </View>
  );
}

export function LoanPaymentInsights({ item, householdId }: LoanPaymentInsightsProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(240, width - 2 * Spacing.lg - 2 * Spacing.base);

  const summary = item.loan_summary ?? null;

  const [schedule, setSchedule] = useState<LoanScheduleView | null>(null);
  const [scheduleSettled, setScheduleSettled] = useState(false);
  const [loan, setLoan] = useState<BudgetLoan | null>(null);
  const [loanSettled, setLoanSettled] = useState(false);

  // Layer 2a — the amortization schedule. Drives the two chart cards below;
  // never blocks the stat tiles, which render straight from props.
  useEffect(() => {
    if (!item.loan_summary) return;
    let cancelled = false;
    setSchedule(null);
    setScheduleSettled(false);
    budgetLoansApi
      .getSchedule(householdId, item.id)
      .then((view) => {
        if (!cancelled) setSchedule(view);
      })
      .catch(() => {
        // Swallow — the chart cards simply stay empty; the stat tiles above
        // already carry every figure a member needs.
      })
      .finally(() => {
        if (!cancelled) setScheduleSettled(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `item.loan_summary` only gates whether to fetch at all.
  }, [householdId, item.id]);

  // Layer 2b — the loan record itself: lender/portal link + whether it's 0%
  // APR (which hides the cumulative-interest chart). Fetched independently
  // of the schedule so a slow schedule fetch never holds up the lender row.
  useEffect(() => {
    if (!item.loan_summary) return;
    let cancelled = false;
    setLoan(null);
    setLoanSettled(false);
    budgetLoansApi
      .get(householdId, item.id)
      .then((res) => {
        if (!cancelled) setLoan(res.loan);
      })
      .catch(() => {
        // Swallow — lender/portal row simply stays absent; rate-type gating
        // below defaults to showing the cumulative chart when unknown.
      })
      .finally(() => {
        if (!cancelled) setLoanSettled(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `item.loan_summary` only gates whether to fetch at all.
  }, [householdId, item.id]);

  // The chart cards need BOTH the schedule (for the bars/lines themselves)
  // AND the loan record (for `start_date`, to attach calendar dates, and for
  // `rate_type`, to decide whether the cumulative chart is meaningful) — so
  // the loading affordance covers both fetches rather than flashing an
  // undateable/wrongly-gated chart while the second one is still in flight.
  const chartsLoading = !scheduleSettled || !loanSettled;

  const dated = useMemo(() => {
    if (!schedule) return [];
    // `attachDates` is typed against `MortgageScheduleRow`, which carries an
    // `estimated` flag a fixed installment schedule has no use for — added
    // here purely to satisfy that shape, never read by the pure helpers.
    const rowsWithEstimated = schedule.rows.map((row) => ({ ...row, estimated: false }));
    return attachDates(rowsWithEstimated, loan?.start_date ?? null, 'monthly');
  }, [schedule, loan?.start_date]);

  const chartColors = useMemo(
    () => ({ principal: colors.primary, interest: colors.chartWarm }),
    [colors.primary, colors.chartWarm]
  );
  const currentYear = new Date().getFullYear();
  const monthBuckets = useMemo(() => groupByMonth(dated, currentYear), [dated, currentYear]);
  const stacks = useMemo(() => buildBucketStacks(monthBuckets, chartColors), [monthBuckets, chartColors]);
  const cumulative = useMemo(() => buildCumulativeSeries(dated), [dated]);

  // A loan we know nothing about (fetch failed) is NOT known to be 0% — default
  // to showing the chart rather than silently dropping it on a network blip.
  const isZeroApr = loan?.rate_type === 'zero';
  const showCumulativeChart = !isZeroApr && dated.length > 0;
  const showLenderRow = loanSettled && !!loan && (!!loan.lender || !!loan.portal_url);

  if (!summary) return null;

  return (
    <View style={styles.container} testID="savings-loan-insights">
      <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.headerRow}>
          <Typography variant="body" weight="semibold">
            {`${summary.paymentsRemaining} payments left`}
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            {`Payoff ${fmtMonthYear(summary.payoffDate)}`}
          </Typography>
        </View>
        <ProgressBar
          value={summary.elapsedMonths}
          max={summary.termMonths}
          color={theme.pastel.orange}
          testID="savings-loan-progress-bar"
        />
        <Typography variant="caption1" color={colors.textSecondary}>
          {`${summary.elapsedMonths} of ${summary.termMonths} paid`}
        </Typography>

        <View style={styles.tileGrid} testID="savings-loan-stat-tiles">
          <View style={styles.tileRow}>
            <StatTile
              label="Remaining balance"
              value={formatCurrency(summary.currentBalanceCents)}
              testID="savings-loan-stat-balance"
            />
            <StatTile
              label="Payments remaining"
              value={String(summary.paymentsRemaining)}
              testID="savings-loan-stat-remaining"
            />
          </View>
          <View style={styles.tileRow}>
            <StatTile
              label="Payoff date"
              value={fmtMonthYear(summary.payoffDate)}
              testID="savings-loan-stat-payoff"
            />
            <StatTile
              label="Interest paid to date"
              value={formatCurrency(summary.interestPaidToDateCents)}
              valueColor={colors.chartWarm}
              testID="savings-loan-stat-interest-paid"
            />
          </View>
          <View style={styles.tileRow}>
            <StatTile
              label="Total interest"
              value={formatCurrency(summary.totalInterestCents)}
              valueColor={colors.chartWarm}
              testID="savings-loan-stat-total-interest"
            />
            <StatTile
              label="Total cost"
              value={formatCurrency(summary.totalCostCents)}
              testID="savings-loan-stat-total-cost"
            />
          </View>
        </View>
      </View>

      {showLenderRow && loan ? (
        <View
          style={[styles.card, styles.lenderCard, { backgroundColor: colors.backgroundSecondary }]}
          testID="savings-loan-lender-card"
        >
          {loan.lender ? (
            <Typography variant="body" weight="medium">
              {loan.lender}
            </Typography>
          ) : null}
          {loan.portal_url ? (
            <TouchableOpacity
              style={styles.linkRow}
              activeOpacity={0.7}
              onPress={() => loan.portal_url && Linking.openURL(loan.portal_url)}
              testID="savings-loan-portal-link"
            >
              <Typography variant="subheadline" weight="semibold" color={colors.primary}>
                View account
              </Typography>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {chartsLoading ? (
        <View
          style={[styles.card, styles.loadingCard, { backgroundColor: colors.backgroundSecondary }]}
          testID="savings-loan-charts-loading"
        >
          <ActivityIndicator size="small" color={theme.pastel.orange} />
        </View>
      ) : (
        <>
          <View
            style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
            testID="savings-loan-chart-payments-go"
          >
            <Typography variant="body" weight="semibold">
              Where your payments go
            </Typography>
            <ChartLegend
              items={[
                { label: 'Principal', color: colors.primary },
                { label: 'Interest', color: colors.chartWarm },
              ]}
            />
            {stacks.length ? (
              <AppBarChart stacks={stacks} width={chartWidth} allowNegative={false} />
            ) : (
              <Typography variant="footnote" color={colors.textSecondary} align="center">
                No payments scheduled this year.
              </Typography>
            )}
          </View>

          {showCumulativeChart ? (
            <View
              style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
              testID="savings-loan-chart-cumulative"
            >
              <Typography variant="body" weight="semibold">
                What it adds up to
              </Typography>
              <ChartLegend
                items={[
                  { label: 'Interest paid', color: colors.chartWarm },
                  { label: 'Principal repaid', color: colors.primary },
                ]}
              />
              <AppLineChart
                data={cumulative.interest}
                data2={cumulative.principal}
                color={colors.chartWarm}
                color2={colors.primary}
                width={chartWidth}
                formatValue={formatChartCurrencyShort}
              />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.base },
  card: {
    borderRadius: CornerRadius.lg,
    padding: Spacing.base,
    gap: Spacing.smd,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tileGrid: { gap: Spacing.smd },
  tileRow: { flexDirection: 'row', gap: Spacing.md },
  lenderCard: { gap: Spacing.xs },
  linkRow: { flexDirection: 'row', alignItems: 'center' },
  loadingCard: { alignItems: 'center', justifyContent: 'center', minHeight: 96 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
});

export default LoanPaymentInsights;
