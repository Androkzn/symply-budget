import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { ProjectionMethod, SavingsProjection } from '@api/savings';
import { Typography } from '@components/ui/Typography';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { formatBudgetCurrency as money } from '../budgetFormat';

import { ForecastBridge } from './ForecastBridge';

const COPY: Record<string, { income: string; spending: string; summary: string }> = {
  historical_average: { income: 'Lower income', spending: 'Base spending', summary: 'A lower-income month, keeping the same spending plan.' },
  pessimistic: { income: 'Lower income', spending: 'Higher spending', summary: 'Two pressures together: less income and more spending.' },
  hybrid: { income: 'Typical income', spending: 'Typical spending', summary: 'The middle of your recent history.' },
  trend: { income: 'Expected income', spending: 'Lower spending', summary: 'The same income as Base, with more left through lower spending.' },
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** All amounts come from the opened scenario, not the background selection. */
export function ScenarioExplanation({ projection, method }: {
  projection: SavingsProjection;
  method: ProjectionMethod;
}) {
  const colors = useAppColors();
  const forecast = projection.forecast;
  const scenario = forecast?.scenarios.find((s) => s.method === method);
  if (!forecast || !scenario) return null;
  const copy = COPY[method] ?? COPY.hybrid;
  const example = scenario.exampleMonth;
  const low = Math.min(0, ...forecast.scenarios.map((s) => s.projectedYearEnd));
  const high = Math.max(0, ...forecast.scenarios.map((s) => s.projectedYearEnd));
  const span = Math.max(1, high - low);
  const zero = -low / span * 100;
  const components = example ? [
    { label: 'Income', sign: '+', amount: example.income, source: example.incomeSource === 'entries' ? 'Your income entries' : example.incomeSource === 'templates' ? 'Recurring income' : example.incomeSource === 'history' ? 'Recent history' : 'No estimate yet', color: colors.primary },
    { label: 'Fixed payments', sign: '−', amount: example.recurring, source: 'Active for this month', color: colors.textSecondary },
    { label: 'Variable spending', sign: '−', amount: example.spending, source: example.spendingSource === 'budget' ? 'Your budget + scenario adjustment' : example.spendingSource === 'history' ? 'Recent history' : 'Logged expenses only', color: colors.chartNegative },
  ] : [];
  const componentScale = Math.max(1, ...components.map((c) => Math.abs(c.amount)));

  return (
    <View style={styles.root} testID={`scenario-explanation-${method}`}>
      <View style={styles.intro}>
        <Typography variant="largeTitle" weight="bold" color={scenario.projectedYearEnd < 0 ? colors.chartNegative : scenario.projectedYearEnd < projection.actualToDate ? colors.chartNegative : colors.primary}>
          {money(scenario.projectedYearEnd)}
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary}>Projected {projection.year} savings · {scenario.label}</Typography>
      </View>

      <ForecastBridge recorded={projection.actualToDate} yearEnd={scenario.projectedYearEnd} currentMonth={projection.currentMonth} remainingMonths={scenario.remainingMonths} />

      <View style={styles.section}>
        <Typography variant="subheadline" weight="semibold">How this scenario thinks</Typography>
        <View style={styles.flow}>
          <View style={[styles.assumption, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="caption1" weight="semibold">{example?.incomeSource === 'entries' ? 'Entered income' : example?.incomeSource === 'templates' ? 'Recurring income' : copy.income}</Typography>
          </View>
          <Typography variant="subheadline">−</Typography>
          <View style={[styles.assumption, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="caption1" weight="semibold">{copy.spending}</Typography>
          </View>
        </View>
        <Typography variant="caption2" color={colors.textSecondary}>{method === 'pessimistic' && (example?.incomeSource === 'entries' || example?.incomeSource === 'templates') ? 'For the example month, known income stays in the calculation; higher spending creates the downside.' : copy.summary} Based on {forecast.sampleMonths} completed months.</Typography>
        <Typography variant="caption2" color={colors.textSecondary}>Entered income replaces the historical income estimate. The spending scenario may exceed your budget. Fixed payments stay scheduled.</Typography>
      </View>

      <View style={styles.section}>
        <Typography variant="subheadline" weight="semibold">Possible year-end outcomes</Typography>
        {forecast.scenarios.map((s) => {
          const selected = s.method === method;
          const position = (s.projectedYearEnd - low) / span * 100;
          return (
            <View key={s.method} style={styles.comparison} accessible accessibilityLabel={`${s.label}: ${money(s.projectedYearEnd)}${selected ? ', opened scenario' : ''}`}>
              <View style={styles.row}>
                <Typography variant="caption1" weight={selected ? 'bold' : 'regular'}>{selected ? '● ' : ''}{s.label}</Typography>
                <Typography variant="caption1" weight={selected ? 'bold' : 'regular'}>{money(s.projectedYearEnd)}</Typography>
              </View>
              <View style={[styles.track, { backgroundColor: colors.backgroundSecondary }]}>
                <View style={[styles.fill, { left: `${Math.min(position, zero)}%`, width: `${Math.abs(position - zero)}%`, backgroundColor: s.projectedYearEnd < projection.actualToDate || s.projectedYearEnd < 0 ? colors.chartNegative : selected ? colors.primary : colors.textTertiary }]} />
                <View style={[styles.zero, { left: `${zero}%`, backgroundColor: colors.textSecondary }]} />
              </View>
            </View>
          );
        })}
        <Typography variant="caption2" color={colors.textSecondary}>Bars start at zero · scenario range, not a guarantee.</Typography>
      </View>

      {example ? (
        <View style={styles.section} testID={`scenario-example-${method}`}>
          <Typography variant="subheadline" weight="semibold">Your {MONTHS[example.month - 1]} calculation</Typography>
          {components.map((c) => (
            <View key={c.label} style={styles.comparison}>
              <View style={styles.row}>
                <Typography variant="caption1">{c.sign} {c.label}</Typography>
                <Typography variant="caption1" weight="semibold">{money(c.amount)}</Typography>
              </View>
              <View style={[styles.track, { backgroundColor: colors.backgroundSecondary }]}>
                <View style={[styles.fill, { width: `${Math.abs(c.amount) / componentScale * 100}%`, backgroundColor: c.color }]} />
              </View>
              <Typography variant="caption2" color={colors.textSecondary}>{c.source}</Typography>
            </View>
          ))}
          {example.plannedSpending != null && (
            <View style={[styles.notes, { borderColor: colors.borderColor }]} testID={`scenario-budget-adjustment-${method}`}>
              <View style={styles.row}>
                <Typography variant="caption1">Your spending budget</Typography>
                <Typography variant="caption1">{money(example.plannedSpending)}</Typography>
              </View>
              <View style={styles.row}>
                <Typography variant="caption1">Scenario adjustment</Typography>
                <Typography variant="caption1" color={(example.scenarioSpendingAdjustment ?? 0) > 0 ? colors.chartNegative : colors.primary}>
                  {(example.scenarioSpendingAdjustment ?? 0) >= 0 ? '+' : '−'}{money(Math.abs(example.scenarioSpendingAdjustment ?? 0))}
                </Typography>
              </View>
              {(example.loggedSpendingFloorAdjustment ?? 0) > 0 && <Typography variant="caption2" color={colors.textSecondary}>
                Already logged expenses add {money(example.loggedSpendingFloorAdjustment ?? 0)} above this estimate.
              </Typography>}
              <Typography variant="caption2" color={colors.textSecondary}>
                The adjustment reflects variation in past spending. It is an assumption, not a planned bill.
              </Typography>
              {example.net < 0 && example.income - example.recurring - example.plannedSpending >= 0 && (
                <Typography variant="caption1" color={colors.chartNegative}>
                  At your budget, {money(example.income - example.recurring - example.plannedSpending)} would remain this month. The higher spending assumption turns this scenario negative.
                </Typography>
              )}
            </View>
          )}
          <View style={[styles.result, { borderColor: colors.primary, backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="caption1">= Forecast savings</Typography>
            <Typography variant="title2" weight="bold" color={example.net < 0 ? colors.chartNegative : colors.primary} testID={`scenario-example-net-${method}`}>{money(example.net)}</Typography>
          </View>
          <Typography variant="caption2" color={colors.textSecondary}>Repeat for each open month + completed months = year-end forecast.</Typography>
        </View>
      ) : (
        <Typography variant="caption1" color={colors.textSecondary}>No open-month breakdown available for this year.</Typography>
      )}

      <View style={[styles.notes, { borderColor: colors.borderColor }]}>
        <Typography variant="caption2" color={colors.textSecondary}>One-off income counts once. Spending never drops below logged expenses. Savings goals are separate from the forecast.</Typography>
        {forecast.sampleMonths < 3 && <Typography variant="caption2" color={colors.textSecondary}>Limited history — add more completed months for a better comparison.</Typography>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.xl },
  intro: { gap: Spacing.xxs },
  section: { gap: Spacing.sm },
  flow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  assumption: { flex: 1, padding: Spacing.sm, borderRadius: CornerRadius.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.xs },
  comparison: { gap: Spacing.xxs },
  track: { height: 12, borderRadius: CornerRadius.sm, overflow: 'hidden' },
  fill: { position: 'absolute', height: '100%', borderRadius: CornerRadius.sm },
  zero: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  result: { gap: Spacing.xs, padding: Spacing.md, borderWidth: 1, borderRadius: CornerRadius.md },
  notes: { paddingTop: Spacing.md, borderTopWidth: 1, gap: Spacing.xs },
});
