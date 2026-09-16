import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { SavingsProjection } from '@api/savings';
import { Typography } from '@components/ui/Typography';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { formatBudgetCurrency as money } from '../budgetFormat';

export function forecastChangeText(recorded: number, yearEnd: number): string {
  const change = yearEnd - recorded;
  return change < 0 ? `${money(-change)} decrease expected`
    : change > 0 ? `${money(change)} more expected` : 'No further net change expected';
}

/** Reconcile the current recorded net with the forecast, without hiding drawdown. */
export function ForecastBridge({ recorded, yearEnd, currentMonth, remainingMonths }: {
  recorded: number;
  yearEnd: number;
  currentMonth: number | null;
  remainingMonths?: NonNullable<SavingsProjection['forecast']>['scenarios'][number]['remainingMonths'];
}) {
  const colors = useAppColors();
  const change = yearEnd - recorded;
  const decreasing = change < 0;
  const changeColor = decreasing ? colors.chartNegative : colors.primary;
  const low = Math.min(0, recorded, yearEnd);
  const span = Math.max(1, Math.max(0, recorded, yearEnd) - low);
  const bar = (value: number, color: string) => (
    <View style={[styles.track, { backgroundColor: colors.backgroundSecondary }]}>
      <View style={[styles.fill, { backgroundColor: color, left: `${(Math.min(0, value) - low) / span * 100}%`, width: `${Math.abs(value) / span * 100}%` }]} />
    </View>
  );
  return (
    <View style={styles.root} testID="forecast-bridge">
      <View style={styles.step}>
        <View style={styles.row}>
          <Typography variant="caption1">Net saved so far</Typography>
          <Typography variant="subheadline" weight="semibold">{money(recorded)}</Typography>
        </View>
        {bar(recorded, colors.textTertiary)}
      </View>
      <View style={[styles.change, { borderColor: changeColor }]}>
        <Typography variant="caption1" weight="semibold" color={changeColor}>
          {decreasing ? '↓ Expected decrease' : change > 0 ? '↑ Expected additional savings' : '→ No further net change'}
        </Typography>
        <Typography variant="title2" weight="bold" color={changeColor} testID="forecast-remaining-change">
          {change < 0 ? '−' : change > 0 ? '+' : ''}{money(Math.abs(change))}
        </Typography>
        <Typography variant="caption2" color={colors.textSecondary}>
          {currentMonth != null ? 'Rest of this month + future months' : 'Remaining months'}
        </Typography>
      </View>
      <View style={styles.step}>
        <View style={styles.row}>
          <Typography variant="caption1">= Estimated year-end total</Typography>
          <Typography variant="subheadline" weight="bold" color={yearEnd < 0 ? colors.chartNegative : changeColor}>{money(yearEnd)}</Typography>
        </View>
        {bar(yearEnd, yearEnd < 0 ? colors.chartNegative : changeColor)}
      </View>
      {decreasing && <Typography variant="caption2" color={colors.textSecondary} testID="forecast-decrease-explanation">
        {recorded > 0
          ? 'From now to year end, this scenario expects remaining expenses to exceed additional income. That could use part of your recorded savings.'
          : 'From now to year end, remaining expenses are forecast to exceed additional income, reducing your annual net total.'}
        {' '}Your recorded savings have not changed.
      </Typography>}
      {!!remainingMonths?.length && <View style={styles.months}>
        <Typography variant="caption1" weight="semibold">Monthly savings forecast</Typography>
        {remainingMonths.map((m) => {
          const isCurrent = m.month === currentMonth && m.fullMonthNet != null;
          const monthTotal = isCurrent ? m.fullMonthNet! : m.netChange;
          const details = m.breakdown;
          const recordedSpending = m.recordedSpending ?? 0;
          return (
          <View key={m.month} style={styles.step}>
            <View style={styles.row}>
              <Typography variant="caption1" weight="semibold">
                {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m.month - 1]}{isCurrent ? ' · full month' : ''}
              </Typography>
              <Typography variant="subheadline" weight="bold" color={monthTotal < 0 ? colors.chartNegative : colors.primary} testID={isCurrent ? 'forecast-current-month-total' : undefined}>
                {monthTotal < 0 ? '−' : '+'}{money(Math.abs(monthTotal))}
              </Typography>
            </View>
            {isCurrent && (
              <View style={[styles.currentMonth, { backgroundColor: colors.backgroundSecondary }]} testID="forecast-current-month-reconciliation">
                <Typography variant="caption2" color={colors.textSecondary}>
                  {monthTotal >= 0 ? 'Still adding to savings this month.' : 'This month’s total spending is forecast to exceed income.'}
                </Typography>
                {m.income != null && <View style={styles.row}>
                  <Typography variant="caption2">Income</Typography>
                  <Typography variant="caption2">{money(m.income)}</Typography>
                </View>}
                {details && <>
                  <View style={styles.row}>
                    <Typography variant="caption2">− Fixed payments</Typography>
                    <Typography variant="caption2">{money(details.recurring)}</Typography>
                  </View>
                  <View style={styles.row}>
                    <Typography variant="caption2">− Full-month variable spending</Typography>
                    <Typography variant="caption2">{money(details.spending)}</Typography>
                  </View>
                  <Typography variant="caption1" weight="semibold">Where the spending estimate comes from</Typography>
                  {details.plannedSpending != null && <>
                    <View style={styles.row}>
                      <Typography variant="caption2">Your budget</Typography>
                      <Typography variant="caption2">{money(details.plannedSpending)}</Typography>
                    </View>
                    <View style={styles.row}>
                      <Typography variant="caption2">Scenario adjustment from past spending</Typography>
                      <Typography variant="caption2" color={colors.chartNegative}>
                        {(details.scenarioSpendingAdjustment ?? 0) < 0 ? '−' : '+'}{money(Math.abs(details.scenarioSpendingAdjustment ?? 0))}
                      </Typography>
                    </View>
                    {(details.loggedSpendingFloorAdjustment ?? 0) > 0 && <Typography variant="caption2">
                      Logged expenses raise this estimate by {money(details.loggedSpendingFloorAdjustment ?? 0)}.
                    </Typography>}
                  </>}
                  <View style={styles.row}>
                    <Typography variant="caption2">Already spent</Typography>
                    <Typography variant="caption2">{money(recordedSpending)}</Typography>
                  </View>
                  <View style={styles.row}>
                    <Typography variant="caption2" weight="semibold">Still assumed to be spent</Typography>
                    <Typography variant="caption2" weight="semibold" color={colors.chartNegative} testID="forecast-current-month-unspent">
                      {money(Math.max(0, details.spending - recordedSpending))}
                    </Typography>
                  </View>
                  <View style={[styles.track, { backgroundColor: colors.chartNegative + '33' }]}>
                    <View style={[styles.fill, { left: 0, width: `${Math.min(100, recordedSpending / Math.max(1, details.spending) * 100)}%`, backgroundColor: colors.textTertiary }]} />
                  </View>
                  <Typography variant="caption2" color={colors.textSecondary}>
                    Grey: already spent · shaded: still assumed. The remaining amount is a scenario assumption, not a scheduled bill or a loss for the whole month.
                  </Typography>
                </>}
              </View>
            )}
          </View>
          );
        })}
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.md },
  step: { gap: Spacing.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.xs },
  track: { height: 10, borderRadius: CornerRadius.sm, overflow: 'hidden' },
  fill: { height: '100%', position: 'absolute', borderRadius: CornerRadius.sm },
  change: { borderLeftWidth: 3, paddingLeft: Spacing.md, gap: Spacing.xxs },
  months: { gap: Spacing.xs },
  currentMonth: { padding: Spacing.md, borderRadius: CornerRadius.md, gap: Spacing.sm },
});
