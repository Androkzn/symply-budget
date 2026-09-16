import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import type {
  MortgagePaymentFrequency,
  MortgageScheduleView,
  MortgageStatement,
  MortgageSummary,
} from '@api/mortgage';
import { AppLineChart, Card, Icon, ProgressBar, Typography } from '@components/ui';
import { AppBarChart, formatChartCurrencyShort } from '@components/ui/AppBarChart';
import { paymentsPerYear } from '@features/mortgage/amortization';
import { Spacing, useAppColors } from '@theme';

import { fmtCents, fmtDollarsPrecise, fmtMonthYear, fmtMonths, fmtPercentOfOne } from './mortgageFormat';
import { StatTile } from './MortgageStatTile';
import {
  attachDates,
  buildBucketStacks,
  buildCumulativeSeries,
  buildIndexStacks,
  crossoverInsight,
  FREQUENCY_LABEL,
  frontLoadingInsight,
  groupByMonth,
  groupByYear,
  interestPerDayCents,
  interestPerDollar,
  sampleBuckets,
  scheduleYears,
  yearInsight,
  type DatedScheduleRow,
  type PeriodBucket,
} from './paymentsInsights';

/**
 * Mortgage → **Payments** tab: where every dollar of a payment goes, now and over
 * the whole plan.
 *
 * Reads ONLY the BE-computed schedule/summary and buckets it by calendar month and
 * year (see `paymentsInsights`) — no money is re-derived here. Payment numbers are
 * never shown on an axis: "#145" tells a member nothing, so bars are labelled by
 * month within a year, or by year across the plan.
 *
 * Every figure past today is "at today's rate" — a variable rate moves it, which
 * is why each projection card says so.
 */

/** ≤12 bars keeps a month/year axis readable at phone width. */
const MAX_BARS = 12;

type Granularity = 'monthly' | 'yearly';

/** The two ways to read the breakdown: month-by-month, or year-by-year to payoff. */
const RANGE_OPTIONS: Array<{ id: Granularity; label: string }> = [
  { id: 'monthly', label: 'By month' },
  { id: 'yearly', label: 'By year' },
];

export function MortgagePaymentsView({
  schedule,
  summary,
  statements,
}: {
  schedule: MortgageScheduleView;
  summary: MortgageSummary | null;
  statements: MortgageStatement[];
}) {
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(240, width - 2 * Spacing.lg - 2 * Spacing.base);

  const termStartDate = summary?.currentTerm?.termStartDate ?? null;
  const frequency = summary?.paymentFrequency ?? null;

  const rows = useMemo(
    () => attachDates(schedule.rows, termStartDate, frequency),
    [schedule.rows, termStartDate, frequency]
  );
  const years = useMemo(() => scheduleYears(rows), [rows]);
  const yearBuckets = useMemo(() => groupByYear(rows), [rows]);

  // The year the member is looking at in monthly mode. Defaults to the year the
  // NEXT unpaid payment lands in (what they're actually paying now), not the term
  // start — an old term would otherwise open on a year that's fully behind them.
  const currentYear = useMemo(() => {
    const next = rows[Math.min(schedule.paymentsElapsed, Math.max(0, rows.length - 1))];
    const iso = next?.iso ?? rows.find((r) => r.iso)?.iso ?? null;
    return iso ? parseInt(iso.slice(0, 4), 10) : null;
  }, [rows, schedule.paymentsElapsed]);

  const [granularity, setGranularity] = useState<Granularity>('monthly');
  const [year, setYear] = useState<number | null>(currentYear);
  const activeYear = year != null && years.includes(year) ? year : (currentYear ?? years[0] ?? null);

  const monthBuckets = useMemo(
    () => (activeYear != null ? groupByMonth(rows, activeYear) : []),
    [rows, activeYear]
  );
  const sampledYears = useMemo(() => sampleBuckets(yearBuckets, MAX_BARS), [yearBuckets]);

  // Undateable schedule (the summary fetch failed, so we know neither the term
  // anchor nor the cadence): sample by payment index rather than inventing months.
  const dateable = rows.some((r) => r.iso != null);

  const visibleBuckets: PeriodBucket[] = granularity === 'monthly' ? monthBuckets : sampledYears.buckets;
  const chartColors = useMemo(
    () => ({ principal: colors.primary, interest: colors.chartWarm }),
    [colors.primary, colors.chartWarm]
  );
  const stacks = useMemo(
    () => (dateable ? buildBucketStacks(visibleBuckets, chartColors) : buildIndexStacks(rows, chartColors)),
    [dateable, visibleBuckets, rows, chartColors]
  );

  const cumulative = useMemo(() => buildCumulativeSeries(rows, MAX_BARS), [rows]);
  const crossover = useMemo(() => crossoverInsight(rows, schedule.paymentsElapsed), [rows, schedule.paymentsElapsed]);
  const frontLoading = useMemo(
    () => frontLoadingInsight(rows, schedule.paymentsElapsed),
    [rows, schedule.paymentsElapsed]
  );
  const thisYear = useMemo(
    () => (activeYear != null ? yearInsight(rows, statements, activeYear) : null),
    [rows, statements, activeYear]
  );

  if (!schedule.scheduleAvailable || rows.length === 0) {
    return (
      <Card variant="filled" style={styles.card} testID="mortgage-payments-unavailable">
        <Typography variant="label" weight="semibold">
          Payments
        </Typography>
        <Typography variant="caption" color={colors.textSecondary}>
          Add your rate — or a statement showing your payment — and we'll break every payment down into
          interest and principal.
        </Typography>
      </Card>
    );
  }

  const yearIdx = activeYear != null ? years.indexOf(activeYear) : -1;

  return (
    <View style={styles.stack} testID="mortgage-payments">
      {/* 1 — Anatomy of the next payment: the only figure a member sees on their
          bank statement, split into the part that's gone and the part that stays. */}
      {summary ? <PaymentAnatomyCard summary={summary} /> : null}

      {/* 2 — This calendar year: the plan for the year + the bank's own actuals. */}
      {thisYear && dateable ? (
        <Card variant="filled" style={styles.card} testID="mortgage-payments-year">
          <Typography variant="label" weight="semibold">
            {thisYear.year} at a glance
          </Typography>
          <Typography variant="caption" color={colors.textSecondary}>
            {thisYear.actualInterestCents != null
              ? `Your bank's own figures from ${thisYear.statementsCount} statement${
                  thisYear.statementsCount === 1 ? '' : 's'
                } this year.`
              : `The plan for ${thisYear.paymentsPlanned} payment${
                  thisYear.paymentsPlanned === 1 ? '' : 's'
                } this year — upload statements to see the bank's actuals.`}
          </Typography>
          <View style={styles.tileRow}>
            <StatTile
              label="Interest"
              value={fmtCents(thisYear.actualInterestCents ?? thisYear.scheduledInterestCents)}
              hint={thisYear.actualInterestCents != null ? 'paid so far' : 'planned'}
              valueColor={colors.chartWarm}
              testID="mortgage-payments-year-interest"
            />
            <StatTile
              label="Principal"
              value={fmtCents(thisYear.actualPrincipalCents ?? thisYear.scheduledPrincipalCents)}
              hint={thisYear.actualPrincipalCents != null ? 'off the balance' : 'planned'}
              valueColor={colors.primary}
              testID="mortgage-payments-year-principal"
            />
          </View>
          {thisYear.actualInterestCents != null ? (
            <Typography variant="caption" color={colors.textSecondary}>
              Full-year plan: {fmtCents(thisYear.scheduledInterestCents)} interest ·{' '}
              {fmtCents(thisYear.scheduledPrincipalCents)} principal.
            </Typography>
          ) : null}
        </Card>
      ) : null}

      {/* 3 — The breakdown chart, labelled by month or year (never payment #). */}
      <Card variant="filled" style={styles.card} testID="mortgage-payments-breakdown">
        <Typography variant="label" weight="semibold">
          Where your payments go
        </Typography>

        {dateable ? (
          <View style={styles.chipRow}>
            {RANGE_OPTIONS.map((opt) => {
              const active = granularity === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  testID={`mortgage-payments-range-${opt.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setGranularity(opt.id)}
                  style={[
                    styles.chip,
                    { borderColor: active ? colors.primary : colors.divider },
                    active ? { backgroundColor: colors.primary } : null,
                  ]}
                >
                  <Typography variant="caption" color={active ? colors.white : colors.textSecondary}>
                    {opt.label}
                  </Typography>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* Year stepper — only meaningful in monthly mode. */}
        {dateable && granularity === 'monthly' && activeYear != null ? (
          <View style={styles.yearStepper}>
            <TouchableOpacity
              disabled={yearIdx <= 0}
              onPress={() => setYear(years[yearIdx - 1])}
              style={styles.stepperArrow}
              accessibilityRole="button"
              accessibilityLabel="Previous year"
              testID="mortgage-payments-year-prev"
            >
              <Icon
                name="chevron-back"
                size={20}
                color={yearIdx <= 0 ? colors.textTertiary : colors.textPrimary}
              />
            </TouchableOpacity>
            <Typography variant="bodyLarge" weight="semibold" testID="mortgage-payments-year-label">
              {activeYear}
            </Typography>
            <TouchableOpacity
              disabled={yearIdx < 0 || yearIdx >= years.length - 1}
              onPress={() => setYear(years[yearIdx + 1])}
              style={styles.stepperArrow}
              accessibilityRole="button"
              accessibilityLabel="Next year"
              testID="mortgage-payments-year-next"
            >
              <Icon
                name="chevron-forward"
                size={20}
                color={yearIdx >= years.length - 1 ? colors.textTertiary : colors.textPrimary}
              />
            </TouchableOpacity>
          </View>
        ) : null}

        <ChartLegend
          items={[
            { label: 'Principal', color: colors.primary },
            { label: 'Interest', color: colors.chartWarm },
          ]}
        />

        {stacks.length ? (
          <AppBarChart stacks={stacks} width={chartWidth} allowNegative={false} />
        ) : (
          <Typography variant="caption" color={colors.textSecondary} align="center">
            No payments scheduled in this year.
          </Typography>
        )}

        {/* Sampled index bars aren't a contiguous span, so a "shown" total would
            be misleading — only the calendar views carry one. */}
        {dateable ? <BucketTotals buckets={visibleBuckets} /> : null}

        <Typography variant="caption" color={colors.textSecondary}>
          {!dateable
            ? 'Each bar is one payment of the plan.'
            : granularity === 'monthly'
              ? `Each bar is one month of ${activeYear}. Step through the years to watch interest shrink.`
              : sampledYears.everyNth > 1
                ? `One bar per year to payoff — showing every ${ordinal(sampledYears.everyNth)} year plus the last, at today's rate.`
                : "One bar per year to payoff, at today's rate."}
        </Typography>
      </Card>

      {/* 4 — The tipping point: when principal finally beats interest. */}
      {crossover ? (
        <Card variant="filled" style={styles.card} testID="mortgage-payments-tipping">
          <Typography variant="label" weight="semibold">
            The tipping point
          </Typography>
          {crossover.reached ? (
            <>
              <Typography variant="body">
                Passed{crossover.iso ? ` in ${fmtMonthYear(crossover.iso)}` : ''} — payment #{crossover.index}.
              </Typography>
              <Typography variant="caption" color={colors.textSecondary}>
                More of every payment now builds equity than goes to interest. Around{' '}
                {fmtPercentOfOne(crossover.principalShare)} of that payment went to principal.
              </Typography>
            </>
          ) : (
            <>
              <Typography variant="body">
                Payment #{crossover.index}
                {crossover.iso ? ` · ${fmtMonthYear(crossover.iso)}` : ''} —{' '}
                {fmtMonths(monthsAway(crossover.paymentsAway, frequency))} away.
              </Typography>
              <Typography variant="caption" color={colors.textSecondary}>
                From that payment on, more of every dollar builds your equity than pays the bank
                ({fmtPercentOfOne(crossover.principalShare)} principal at that point). Paying extra brings it
                closer.
              </Typography>
            </>
          )}
        </Card>
      ) : null}

      {/* 5 — Lifetime cost: the two running totals, and where they cross. */}
      {dateable && cumulative.interest.length > 1 ? (
        <Card variant="filled" style={styles.card} testID="mortgage-payments-cumulative">
          <Typography variant="label" weight="semibold">
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
          <Typography variant="caption" color={colors.textSecondary}>
            {cumulative.crossYear != null
              ? `Running totals to payoff at today's rate. Total principal repaid overtakes total interest paid in ${cumulative.crossYear}.`
              : "Running totals to payoff, at today's rate."}
          </Typography>
          <View style={styles.tileRow}>
            <StatTile
              label="Interest to payoff"
              value={fmtCents(cumulative.totalInterestCents)}
              hint="at today's rate"
              valueColor={colors.chartWarm}
              testID="mortgage-payments-total-interest"
            />
            <StatTile
              label="Cost per $1 borrowed"
              value={fmtDollarsPrecise(
                interestPerDollar(cumulative.totalInterestCents, cumulative.totalPrincipalCents)
              )}
              hint="in interest"
              testID="mortgage-payments-per-dollar"
            />
          </View>
        </Card>
      ) : null}

      {/* 6 — Why paying extra early matters: payments made vs interest burned. */}
      <Card variant="filled" style={styles.card} testID="mortgage-payments-frontloading">
        <Typography variant="label" weight="semibold">
          Interest comes first
        </Typography>
        <MeterRow
          label="Payments made"
          value={fmtPercentOfOne(frontLoading.paymentsFraction)}
          fraction={frontLoading.paymentsFraction}
          color={colors.primary}
        />
        <MeterRow
          label="Interest already paid"
          value={fmtPercentOfOne(frontLoading.interestFraction)}
          fraction={frontLoading.interestFraction}
          color={colors.chartWarm}
        />
        <Typography variant="caption" color={colors.textSecondary}>
          {frontLoading.paymentsMade === 0
            ? `Your first payment is ${fmtPercentOfOne(firstPaymentInterestShare(rows))} interest. `
            : `You're ${fmtPercentOfOne(frontLoading.paymentsFraction)} of the way through the payments but ${fmtPercentOfOne(
                frontLoading.interestFraction
              )} of the way through the interest. `}
          Interest is charged on what you still owe, so extra payments made early save far more than the same
          money later.
        </Typography>
        <View style={styles.tileRow}>
          <StatTile
            label="Interest paid"
            value={fmtCents(frontLoading.interestPaidCents)}
            hint={`over ${frontLoading.paymentsMade} payment${frontLoading.paymentsMade === 1 ? '' : 's'}`}
            valueColor={colors.chartWarm}
            testID="mortgage-payments-interest-paid"
          />
          <StatTile
            label="Interest to come"
            value={fmtCents(frontLoading.interestRemainingCents)}
            hint="at today's rate"
            testID="mortgage-payments-interest-remaining"
          />
        </View>
      </Card>
    </View>
  );
}

/** The next payment, split — with the daily cost of carrying today's balance. */
function PaymentAnatomyCard({ summary }: { summary: MortgageSummary }) {
  const colors = useAppColors();
  const split = summary.currentPaymentSplit;
  const total = split.interestCents + split.principalCents;
  // Principal is the exact complement of the displayed interest share so the two
  // never read as 101%.
  const interestPct = total > 0 ? Math.round((split.interestCents / total) * 100) : 0;
  const principalPct = total > 0 ? 100 - interestPct : 0;
  const perDay = interestPerDayCents(summary.currentBalanceCents, summary.rate.nominalPct);

  return (
    <Card variant="filled" style={styles.card} testID="mortgage-payments-anatomy">
      <Typography variant="label" weight="semibold">
        Your next payment
      </Typography>
      <View style={styles.paymentHeadline}>
        <Typography variant="title" weight="bold">
          {fmtCents(summary.scheduledPaymentCents)}
        </Typography>
        <Typography variant="caption" color={colors.textSecondary}>
          {FREQUENCY_LABEL[summary.paymentFrequency]} · {summary.rate.nominalPct}%
        </Typography>
      </View>
      <ProgressBar
        value={split.interestCents}
        max={Math.max(1, total)}
        height={12}
        color={colors.chartWarm}
        trackColor={colors.primary}
      />
      <View style={styles.splitLegend}>
        <Typography variant="caption" color={colors.chartWarm}>
          Interest {fmtCents(split.interestCents)} ({interestPct}%)
        </Typography>
        <Typography variant="caption" color={colors.primary}>
          Principal {fmtCents(split.principalCents)} ({principalPct}%)
        </Typography>
      </View>
      {perDay > 0 ? (
        <Typography variant="caption" color={colors.textSecondary} testID="mortgage-payments-per-day">
          Carrying {fmtCents(summary.currentBalanceCents)} costs about {fmtCents(perDay)} a day in interest.
        </Typography>
      ) : null}
    </Card>
  );
}

/** Interest/principal totals for whatever the chart is currently showing. */
function BucketTotals({ buckets }: { buckets: PeriodBucket[] }) {
  const colors = useAppColors();
  if (buckets.length === 0) return null;
  const interest = buckets.reduce((sum, b) => sum + b.interestCents, 0);
  const principal = buckets.reduce((sum, b) => sum + b.principalCents, 0);
  return (
    <View style={styles.totalsRow} testID="mortgage-payments-visible-totals">
      <Typography variant="caption" color={colors.textSecondary}>
        Shown:
      </Typography>
      <Typography variant="caption" weight="semibold" color={colors.chartWarm}>
        {fmtCents(interest)} interest
      </Typography>
      <Typography variant="caption" color={colors.textSecondary}>
        ·
      </Typography>
      <Typography variant="caption" weight="semibold" color={colors.primary}>
        {fmtCents(principal)} principal
      </Typography>
    </View>
  );
}

/** Dot + name legend for a chart (the shared charts stay label-free). */
function ChartLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  const colors = useAppColors();
  return (
    <View style={styles.legendRow}>
      {items.map((item) => (
        <View key={item.label} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: item.color }]} />
          <Typography variant="caption" color={colors.textSecondary}>
            {item.label}
          </Typography>
        </View>
      ))}
    </View>
  );
}

/** A labelled progress meter ("Interest already paid — 34%"). */
function MeterRow({
  label,
  value,
  fraction,
  color,
}: {
  label: string;
  value: string;
  fraction: number;
  color: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.meterRow}>
      <View style={styles.meterHeader}>
        <Typography variant="caption" color={colors.textSecondary}>
          {label}
        </Typography>
        <Typography variant="caption" weight="semibold" color={color}>
          {value}
        </Typography>
      </View>
      <ProgressBar progress={fraction} height={8} color={color} />
    </View>
  );
}

/** Interest share of the very first scheduled payment (0–1) — the front-loading hook. */
function firstPaymentInterestShare(rows: DatedScheduleRow[]): number {
  const first = rows[0];
  if (!first) return 0;
  const total = first.interest + first.principal;
  return total > 0 ? first.interest / total : 0;
}

/** Payments-away → months, so "5y 2m" reads instead of "62 payments". */
function monthsAway(payments: number, frequency: MortgagePaymentFrequency | null): number {
  const perYear = frequency ? paymentsPerYear(frequency) : 12;
  return Math.round((payments / perYear) * 12);
}

/** 2 → "2nd", 3 → "3rd" — for "showing every 3rd year". */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.md },
  card: { padding: Spacing.base, gap: Spacing.sm },
  tileRow: { flexDirection: 'row', gap: Spacing.md },
  paymentHeadline: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm, flexWrap: 'wrap' },
  splitLegend: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: Spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: 999,
    borderWidth: 1,
  },
  yearStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  stepperArrow: { padding: Spacing.xs },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  totalsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xxs,
  },
  meterRow: { gap: Spacing.xxs },
  meterHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
