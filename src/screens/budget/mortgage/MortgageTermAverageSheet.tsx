import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import type { MortgagePaymentFrequency } from '@api/mortgage';
import { AppLineChart, BottomSheet, Card, Typography } from '@components/ui';
import { AppBarChart, formatChartCurrencyShort } from '@components/ui/AppBarChart';
import { Spacing, useAppColors } from '@theme';

import { fmtCents, fmtMonthYear, fmtPercentOfOne } from './mortgageFormat';
import { StatTile } from './MortgageStatTile';
import {
  buildBucketStacks,
  buildCumulativeSeries,
  FREQUENCY_ADJECTIVE,
  groupByYear,
  rowsInTerm,
  sampleBuckets,
  type DatedScheduleRow,
  type TermAverageSplit,
} from './paymentsInsights';

/**
 * Bottom sheet behind the Overview tab's "Average this term" row — drills the
 * single average figure into the CURRENT TERM's distribution, running total,
 * and how the interest/principal split shifts payment to payment.
 *
 * Reuses `termAverage` (already computed by `termAverageSplit`) for every
 * headline figure so the sheet can never disagree with the row that opened
 * it; only the chart buckets are (re)computed here, from the same term
 * window via `rowsInTerm`.
 */
export function MortgageTermAverageSheet({
  visible,
  onClose,
  rows,
  termAverage,
  maturityDate,
  frequency,
}: {
  visible: boolean;
  onClose: () => void;
  /** Full attached-date schedule rows (`attachDates()` output) — filtered to the term below. */
  rows: DatedScheduleRow[];
  /** Already-computed average for the term (from `termAverageSplit`) — not recomputed here. */
  termAverage: TermAverageSplit;
  maturityDate: string | null;
  frequency: MortgagePaymentFrequency;
}) {
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  // Sheet content padding (Spacing.xl, both sides) plus this card's own
  // padding (Spacing.base, both sides) — the two insets the chart sits inside.
  const chartWidth = Math.max(240, width - 2 * Spacing.xl - 2 * Spacing.base);

  const termRows = useMemo(() => rowsInTerm(rows, maturityDate), [rows, maturityDate]);
  const yearBuckets = useMemo(() => groupByYear(termRows), [termRows]);
  const sampledYears = useMemo(() => sampleBuckets(yearBuckets, 12), [yearBuckets]);
  const chartColors = useMemo(
    () => ({ principal: colors.primary, interest: colors.chartWarm }),
    [colors.primary, colors.chartWarm]
  );
  const stacks = useMemo(
    () => buildBucketStacks(sampledYears.buckets, chartColors),
    [sampledYears.buckets, chartColors]
  );
  const cumulative = useMemo(() => buildCumulativeSeries(termRows, 12), [termRows]);

  const adjective = FREQUENCY_ADJECTIVE[frequency];
  const rangeClause =
    termAverage.fromIso && termAverage.toIso
      ? `, ${fmtMonthYear(termAverage.fromIso)} – ${fmtMonthYear(termAverage.toIso)}`
      : '';
  const caption = `${termAverage.payments} ${adjective} payments${rangeClause}, at today's rate.`;

  const firstShare = paymentInterestShare(termRows[0]);
  const lastShare = paymentInterestShare(termRows[termRows.length - 1]);

  return (
    <BottomSheet visible={visible} onClose={onClose} height="tall" title="Average this term" showCloseButton>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.sheetContent}
        testID="mortgage-term-average-sheet"
      >
        <Typography variant="caption" color={colors.textSecondary}>
          {caption}
        </Typography>

        <View style={styles.tileRow}>
          <StatTile
            label="Avg. interest"
            value={fmtCents(termAverage.interestCents)}
            hint={`per ${adjective} payment`}
            valueColor={colors.chartWarm}
            testID="mortgage-term-average-interest"
          />
          <StatTile
            label="Avg. principal"
            value={fmtCents(termAverage.principalCents)}
            hint={`per ${adjective} payment`}
            valueColor={colors.primary}
            testID="mortgage-term-average-principal"
          />
        </View>

        <Card variant="filled" style={styles.card} testID="mortgage-term-average-distribution">
          <Typography variant="label" weight="semibold">
            Distribution across the term
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
            <Typography variant="caption" color={colors.textSecondary} align="center">
              No payments scheduled this term.
            </Typography>
          )}
          <Typography variant="caption" color={colors.textSecondary}>
            {sampledYears.everyNth > 1
              ? `One bar per year of the term — showing every ${ordinal(sampledYears.everyNth)} year plus the last, at today's rate.`
              : 'One bar per year of the term.'}
          </Typography>
        </Card>

        {cumulative.interest.length > 1 ? (
          <Card variant="filled" style={styles.card} testID="mortgage-term-average-trend">
            <Typography variant="label" weight="semibold">
              Running total this term
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
                ? `Principal repaid overtakes interest paid in ${cumulative.crossYear}.`
                : 'Interest stays ahead of principal for the whole term.'}
            </Typography>
          </Card>
        ) : null}

        <Card variant="filled" style={styles.card} testID="mortgage-term-average-shift">
          <Typography variant="label" weight="semibold">
            How the split shifts
          </Typography>
          <Typography variant="caption" color={colors.textSecondary}>
            Interest share of each payment: {fmtPercentOfOne(firstShare)} at the start of the term →{' '}
            {fmtPercentOfOne(lastShare)} by the end.
          </Typography>
          <View style={styles.tileRow}>
            <StatTile
              label="Total interest"
              value={fmtCents(termAverage.totalInterestCents)}
              hint="this term"
              valueColor={colors.chartWarm}
              testID="mortgage-term-average-total-interest"
            />
            <StatTile
              label="Total principal"
              value={fmtCents(termAverage.totalPrincipalCents)}
              hint="this term"
              valueColor={colors.primary}
              testID="mortgage-term-average-total-principal"
            />
          </View>
        </Card>
      </ScrollView>
    </BottomSheet>
  );
}

/** Interest's share of one payment (0–1); `undefined`/all-zero rows read as 0. */
function paymentInterestShare(row: DatedScheduleRow | undefined): number {
  if (!row) return 0;
  const total = row.interest + row.principal;
  return total > 0 ? row.interest / total : 0;
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

/** 2 → "2nd", 3 → "3rd" — for "showing every 3rd year". */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

const styles = StyleSheet.create({
  sheetContent: { gap: Spacing.md, paddingBottom: Spacing.xl },
  card: { padding: Spacing.base, gap: Spacing.sm },
  tileRow: { flexDirection: 'row', gap: Spacing.md },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
});
