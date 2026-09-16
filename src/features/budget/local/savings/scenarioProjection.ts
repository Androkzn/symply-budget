import type { ProjectionMethod, SavingsProjection, SavingsProjectionMonth } from '@api/savings';
import { isIrregularIncomeSource } from '@screens/budget/savings/incomeSourceMeta';

import { spentByMonth } from '../../bulk/bulkSplit';
import type { LocalBudgetLedger } from '../engine';
import { monthKey } from '../ids';

import { getProjection } from './localSavingsProjector';
import { isRecurringPaymentActiveInMonth } from './recurringScope';

// Keep the existing API tokens for Home/companions and older callers. The UI
// names scenarios, not competing algorithms. A legacy planned-budget pick maps
// to the base scenario; household goals never manufacture forecast cashflow.
export const SCENARIOS = [
  { method: 'historical_average', label: 'Cautious', incomeQuantile: 0.25, spendQuantile: 0.5 },
  { method: 'hybrid', label: 'Base', incomeQuantile: 0.5, spendQuantile: 0.5 },
  { method: 'trend', label: 'Optimistic', incomeQuantile: 0.5, spendQuantile: 0.25 },
  { method: 'pessimistic', label: 'Pessimistic', incomeQuantile: 0.25, spendQuantile: 0.75 },
] as const;

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  return Math.round(sorted[lo] + (sorted[Math.ceil(index)] - sorted[lo]) * (index - lo));
}

/** Deterministic, offline cashflow scenarios; no probabilistic confidence claim. */
export function getScenarioProjection(
  ledger: LocalBudgetLedger,
  year: number,
  now = new Date(),
  requestedMethod: ProjectionMethod = 'hybrid',
): SavingsProjection {
  const method = requestedMethod === 'planned_budget' ? 'hybrid' : requestedMethod;
  const legacy = getProjection(ledger, year, now, method === 'pessimistic' ? 'historical_average' : method);
  const nowYear = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;
  const incomeFor = (period: string) => ledger.savingsIncome.filter(
    (e) => e.income_date.startsWith(period) && (!e.status || e.status === 'confirmed'),
  );
  // Month lens (a stock-up counts its portion per month), one pass for the whole ledger.
  const countedByMonth = spentByMonth(ledger.expenses);
  const spendingFor = (period: string) => countedByMonth.get(period) ?? 0;

  // A scheduled payment alone is not evidence that a month has been tracked.
  // Require income AND logged variable spending. Look across the year boundary
  // so January does not discard December's history. Missing months are unknown,
  // not zero-spend observations. At most six observations within twelve months.
  const anchor = Math.min(year * 12, nowYear * 12 + nowMonth - 1);
  const end = year === nowYear ? nowYear * 12 + nowMonth - 1 : anchor;
  const samples: { income: number; spending: number }[] = [];
  for (let index = end - 12; index < end; index++) {
    const y = Math.floor(index / 12);
    const m = index % 12 + 1;
    const period = monthKey(y, m);
    const entries = incomeFor(period);
    if (!entries.length || !ledger.expenses.some((e) => e.expense_date.startsWith(period))) continue;
    const income = entries.filter((e) => !isIrregularIncomeSource(e.source_type))
      .reduce((sum, e) => sum + e.amount_cents, 0);
    samples.push({ income, spending: spendingFor(period) });
  }
  const recent = samples.slice(-6);
  const incomeHistory = recent.map((s) => s.income);
  const spendHistory = recent.map((s) => s.spending);
  const templates = ledger.savingsIncomeTemplates.filter(
    (t) => t.active && !isIrregularIncomeSource(t.source_type),
  );
  const templateIncome = templates.reduce((sum, t) => sum + t.amount_cents, 0);
  const warnings = new Set<string>();
  if (recent.length < 3) warnings.add('Limited history: fewer than 3 completed months with income and spending.');

  const scenarioMonths = SCENARIOS.map((scenario) => legacy.months.map((month): SavingsProjectionMonth => {
    if (month.status === 'actual') return {
      ...month, projectedNet: month.actualNet ?? 0,
      hasData: month.hasData || incomeFor(monthKey(year, month.month)).length > 0,
    };
    const period = monthKey(year, month.month);
    const entries = incomeFor(period);
    const regular = entries.filter((e) => !isIrregularIncomeSource(e.source_type));
    const loggedIncome = regular.reduce((sum, e) => sum + e.amount_cents, 0);
    const oneOff = entries.filter((e) => isIrregularIncomeSource(e.source_type))
      .reduce((sum, e) => sum + e.amount_cents, 0);
    const typicalIncome = templates.length ? templateIncome : quantile(incomeHistory, scenario.incomeQuantile);
    // Future entries are explicit monthly income assumptions. For the live
    // month they are partial receipts, so never replace a full-month estimate
    // with the first paycheck. Windfalls are added only in their own month.
    const income = (month.status === 'current'
      ? Math.max(loggedIncome, typicalIncome)
      : regular.length ? loggedIncome : typicalIncome) + oneOff;
    const usesIncomeEstimate = !regular.length || (month.status === 'current' && typicalIncome > loggedIncome);
    const incomeSource = !usesIncomeEstimate ? 'entries' : templates.length ? 'templates'
      : recent.length ? 'history' : 'missing';
    if (incomeSource === 'missing') warnings.add('Some months have no income estimate. Add income or a recurring income source.');
    if (regular.length && month.status === 'future') {
      warnings.add('Future income entries are treated as that month’s full income plan; check that all paychecks are entered.');
    }
    const planned = ledger.goals.filter((g) => g.year === year && g.month === month.month && g.planned_budget != null)
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '') || b.id.localeCompare(a.id))[0]?.planned_budget;
    const medianSpend = quantile(spendHistory, 0.5);
    // The plan anchors Base. Historical dispersion supplies transparent
    // scenario variation; no arbitrary +/- percentages or invented noise.
    const estimatedSpend = planned != null
      ? Math.max(0, planned + quantile(spendHistory, scenario.spendQuantile) - medianSpend)
      : quantile(spendHistory, scenario.spendQuantile);
    const spending = Math.max(spendingFor(period), estimatedSpend);
    const spendingSource = planned != null ? 'budget' : recent.length ? 'history' : 'missing';
    if (spendingSource === 'missing') warnings.add('Some months have no variable-spending estimate. The forecast may overstate savings.');
    // Recurring is already scoped month-by-month by the Savings projector.
    const recurring = ledger.savingsRecurringPayments.filter(
      (p) => p.active && isRecurringPaymentActiveInMonth(p, year, month.month),
    ).reduce((sum, p) => sum + p.amount_cents, 0);
    return {
      ...month,
      projectedNet: income - recurring - spending,
      projectionSource: month.status === 'future' ? 'pace' : null,
      oneOffIncome: oneOff,
      forecastBreakdown: {
        income, recurring, spending, incomeSource, spendingSource,
        ...(planned != null ? {
          plannedSpending: planned,
          scenarioSpendingAdjustment: estimatedSpend - planned,
          loggedSpendingFloorAdjustment: spending - estimatedSpend,
        } : {}),
        recordedNet: entries.reduce((sum, e) => sum + e.amount_cents, 0) - recurring - spendingFor(period),
      },
    };
  }));
  const scenarios = SCENARIOS.map((scenario, i) => {
    const example = scenarioMonths[i].find((m) => m.status === 'future' && m.forecastBreakdown)
      ?? scenarioMonths[i].find((m) => m.forecastBreakdown);
    return {
      method: scenario.method,
      label: scenario.label,
      projectedYearEnd: scenarioMonths[i].reduce((sum, m) => sum + m.projectedNet, 0),
      remainingMonths: scenarioMonths[i].filter((m) => m.status !== 'actual').map((m) => ({
        month: m.month,
        netChange: m.projectedNet - (m.status === 'current' ? m.actualNet ?? 0 : 0),
        ...(m.status === 'current' ? {
          recordedNet: m.actualNet ?? 0,
          fullMonthNet: m.projectedNet,
          income: m.forecastBreakdown?.income,
          recordedSpending: spendingFor(monthKey(year, m.month)),
          breakdown: m.forecastBreakdown,
        } : {}),
      })),
      exampleMonth: example?.forecastBreakdown
        ? { month: example.month, net: example.projectedNet, ...example.forecastBreakdown }
        : undefined,
    };
  });
  const index = Math.max(0, SCENARIOS.findIndex((s) => s.method === method));
  const months = scenarioMonths[index];
  const actualToDate = months.filter((m) => m.status !== 'future')
    .reduce((sum, m) => sum + (m.actualNet ?? 0), 0);
  const projectedYearEnd = scenarios[index].projectedYearEnd;
  const openMonths = months.filter((m) => m.status !== 'actual').length;
  if (openMonths && new Set(scenarios.map((s) => s.projectedYearEnd)).size === 1) {
    warnings.add('Scenarios coincide: the available income and spending assumptions have no remaining variation.');
  }
  if (openMonths && scenarios[0].projectedYearEnd === scenarios[1].projectedYearEnd && new Set(scenarios.map((s) => s.projectedYearEnd)).size > 1) {
    warnings.add('Cautious and Base match: entered or recurring income, or steady income history, leaves no lower-income difference. Both use the same spending plan.');
  }
  return {
    ...legacy, months, method, actualToDate, projectedYearEnd,
    methodComparison: scenarios,
    forecast: {
      model: 'cashflow-scenarios-v1', sampleMonths: recent.length,
      includesCurrentMonth: year === nowYear, scenarios, warnings: [...warnings],
      goalGap: legacy.yearGoal == null ? null : projectedYearEnd - legacy.yearGoal,
      requiredMonthly: legacy.yearGoal == null || !openMonths ? null
        : Math.max(0, Math.ceil((legacy.yearGoal - actualToDate) / openMonths)),
    },
  };
}
