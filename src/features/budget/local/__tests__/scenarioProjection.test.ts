import type { LocalBudgetLedger } from '../engine';
import { getProjection } from '../savings/localSavingsProjector';
import { getScenarioProjection } from '../savings/scenarioProjection';

import { emptyLedger } from './ledgerTestKit';

const now = new Date('2026-09-10T12:00:00Z');

function income(l: LocalBudgetLedger, month: number, amount: number, source = 'payroll', year = 2026) {
  l.savingsIncome.push({ id: `income-${l.savingsIncome.length}`, income_date: `${year}-${String(month).padStart(2, '0')}-05`, amount_cents: amount, source_type: source, status: 'confirmed' } as LocalBudgetLedger['savingsIncome'][number]);
}
function spend(l: LocalBudgetLedger, month: number, amount: number, year = 2026) {
  l.expenses.push({ id: `expense-${l.expenses.length}`, expense_date: `${year}-${String(month).padStart(2, '0')}-05`, amount, category_id: null } as LocalBudgetLedger['expenses'][number]);
}
function fixture() {
  const l = emptyLedger();
  income(l, 6, 600_000); spend(l, 6, 200_000);
  income(l, 7, 800_000); spend(l, 7, 300_000);
  income(l, 8, 1_000_000); spend(l, 8, 400_000);
  income(l, 9, 400_000); spend(l, 9, 100_000);
  for (const m of [10, 11, 12]) {
    income(l, m, 900_000);
    l.goals.push({ id: `budget-${m}`, year: 2026, month: m, planned_budget: 350_000 } as LocalBudgetLedger['goals'][number]);
  }
  return l;
}

describe('cashflow scenarios', () => {
  it('keeps four distinct forecasts with income entered in every future month', () => {
    const old = getProjection(fixture(), 2026, now);
    expect(new Set(old.methodComparison.map((s) => s.projectedYearEnd)).size).toBe(1);
    const p = getScenarioProjection(fixture(), 2026, now);
    // Historical net 15k. Cautious changes income only; Pessimistic also raises spending.
    expect(p.forecast?.scenarios.map((s) => s.projectedYearEnd)).toEqual([3_550_000, 3_650_000, 3_850_000, 3_350_000]);
    expect(p.actualToDate).toBe(1_800_000);
    expect(p.projectedYearEnd).toBe(3_650_000);
    expect(p.forecast?.scenarios.map((s) => s.exampleMonth?.net)).toEqual([550_000, 550_000, 600_000, 500_000]);
    for (const scenario of p.forecast!.scenarios) {
      expect(scenario.remainingMonths!.reduce((sum, m) => sum + m.netChange, 0))
        .toBe(scenario.projectedYearEnd - p.actualToDate);
      // September adds only its forecast remainder, not another full month.
      expect(scenario.remainingMonths![0].netChange).toBe(
        getScenarioProjection(fixture(), 2026, now, scenario.method).months[8].projectedNet - 300_000,
      );
      const current = scenario.remainingMonths![0];
      expect(current.recordedNet! + current.netChange).toBe(current.fullMonthNet);
      expect(current.income).toBeGreaterThan(0);
      const example = scenario.exampleMonth!;
      expect(example.month).toBe(10);
      expect(example.income - example.recurring - example.spending).toBe(example.net);
    }
    expect(p.months[9].forecastBreakdown).toMatchObject({ income: 900_000, spending: 350_000, incomeSource: 'entries', spendingSource: 'budget', plannedSpending: 350_000, scenarioSpendingAdjustment: 0, loggedSpendingFloorAdjustment: 0 });
    for (const s of p.forecast!.scenarios) {
      const selected = getScenarioProjection(fixture(), 2026, now, s.method);
      expect(selected.projectedYearEnd).toBe(s.projectedYearEnd);
      expect(selected.months.reduce((sum, m) => sum + m.projectedNet, 0)).toBe(s.projectedYearEnd);
    }
  });

  it('never invents optimistic income growth: uses Base income with lower spending', () => {
    const l = fixture();
    const base = getScenarioProjection(l, 2026, now, 'hybrid');
    const optimistic = getScenarioProjection(l, 2026, now, 'trend');
    const cautious = getScenarioProjection(l, 2026, now, 'historical_average');
    const pessimistic = getScenarioProjection(l, 2026, now, 'pessimistic');
    for (let i = 8; i < 12; i++) {
      expect(optimistic.months[i].forecastBreakdown?.income).toBe(base.months[i].forecastBreakdown?.income);
      expect(cautious.months[i].forecastBreakdown?.spending).toBe(base.months[i].forecastBreakdown?.spending);
      expect(pessimistic.months[i].forecastBreakdown?.income).toBe(cautious.months[i].forecastBreakdown?.income);
      expect(pessimistic.months[i].forecastBreakdown!.spending).toBeGreaterThanOrEqual(cautious.months[i].forecastBreakdown!.spending);
    }
    // Last month earned 10k; the 6-month-window median is 8k, not a promised raise.
    expect(optimistic.months[8].forecastBreakdown?.income).toBe(800_000);
    expect(optimistic.months[9].forecastBreakdown?.income).toBe(900_000);
  });

  it('treats monthly targets and goal allocations as benchmarks, never cash', () => {
    const l = fixture();
    const before = getScenarioProjection(l, 2026, now);
    l.savingsMonthlyTargets.push({ id: 'target', period: '2026-10', target_cents: 99_000_000, updated_at: '' });
    l.savingsGoals.push({ id: 'goal', status: 'active', monthly_allocation_cents: 20_000_000, target_amount_cents: 4_000_000 } as LocalBudgetLedger['savingsGoals'][number]);
    const after = getScenarioProjection(l, 2026, now);
    expect(after.projectedYearEnd).toBe(before.projectedYearEnd);
    expect(after.months[9].targetCents).toBe(99_000_000);
    expect(after.forecast?.goalGap).toBe(-350_000);
    expect(after.forecast?.requiredMonthly).toBe(550_000);
  });

  it('never repeats a historical windfall and adds a future windfall exactly once', () => {
    const l = fixture();
    const base = getScenarioProjection(l, 2026, now);
    income(l, 7, 2_000_000, 'marketplace_sale');
    const past = getScenarioProjection(l, 2026, now);
    expect(past.projectedYearEnd - base.projectedYearEnd).toBe(2_000_000);
    expect(past.months[10].projectedNet).toBe(base.months[10].projectedNet);
    income(l, 10, 100_000, 'marketplace_sale');
    expect(getScenarioProjection(l, 2026, now).projectedYearEnd - past.projectedYearEnd).toBe(100_000);
  });

  it('does not count drafts or recurring schedules as completed history', () => {
    const l = emptyLedger();
    income(l, 8, 500_000);
    l.savingsIncome[0].status = 'draft';
    l.savingsRecurringPayments.push({ id: 'rent', active: true, amount_cents: 100_000 } as LocalBudgetLedger['savingsRecurringPayments'][number]);
    const p = getScenarioProjection(l, 2026, now);
    expect(p.forecast?.sampleMonths).toBe(0);
    expect(p.forecast?.warnings.join(' ')).toMatch(/no income estimate/);
    expect(p.months[9].projectedNet).toBe(-100_000);
  });

  it('uses scoped commitments and never forecasts spending below logged spending', () => {
    const l = fixture();
    spend(l, 10, 800_000);
    l.savingsRecurringPayments.push({ id: 'payment', active: true, amount_cents: 100_000, scope_type: 'custom_months', scope_year: 2026, active_months: [10] } as LocalBudgetLedger['savingsRecurringPayments'][number]);
    for (const method of ['hybrid', 'trend', 'historical_average', 'pessimistic'] as const) {
      const p = getScenarioProjection(l, 2026, now, method);
      expect(p.months[9].projectedNet).toBe(0);
      expect(p.months[10].forecastBreakdown?.recurring).toBe(0);
    }
  });

  it('explains legitimate equality without inventing differences', () => {
    const l = emptyLedger();
    for (const m of [6, 7, 8]) { income(l, m, 500_000); spend(l, m, 200_000); }
    const p = getScenarioProjection(l, 2026, now);
    expect(new Set(p.forecast?.scenarios.map((s) => s.projectedYearEnd)).size).toBe(1);
    expect(p.forecast?.warnings.join(' ')).toMatch(/Scenarios coincide/);
  });

  it('carries history across January and estimates the still-open December', () => {
    const l = emptyLedger();
    income(l, 12, 500_000, 'payroll', 2025); spend(l, 12, 200_000, 2025);
    const jan = getScenarioProjection(l, 2026, new Date('2026-01-10T12:00:00Z'));
    expect(jan.forecast?.sampleMonths).toBe(1);
    expect(jan.projectedYearEnd).toBe(3_600_000);
    const dec = getScenarioProjection(fixture(), 2026, new Date('2026-12-10T12:00:00Z'));
    expect(dec.forecast?.includesCurrentMonth).toBe(true);
    expect(dec.months[11].forecastBreakdown).toBeDefined();
  });

  it('counts income-only actual months and uses actuals alone for past years', () => {
    const l = emptyLedger(); income(l, 1, 500_000);
    const p = getScenarioProjection(l, 2026, new Date('2027-02-01T12:00:00Z'));
    expect(p.actualToDate).toBe(500_000);
    expect(p.projectedYearEnd).toBe(500_000);
    expect(p.forecast?.scenarios.map((s) => s.projectedYearEnd)).toEqual([500_000, 500_000, 500_000, 500_000]);
  });
});
