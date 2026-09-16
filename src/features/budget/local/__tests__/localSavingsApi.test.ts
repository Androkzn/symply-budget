import { useSavingsStore } from '@stores/savingsStore';
import {
  closeLocalBudgetSession,
  getLocalLedger,
  mutateLocalLedger,
  openLocalBudgetSessionForTests,
} from '../engine';
import { localBudgetApi } from '../localBudgetApi';
import { localSavingsApi } from '../savings/localSavingsApi';

describe('localSavingsApi', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-test-1' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('uses the saved scenario for all implicit reads, years and target responses', async () => {
    const householdId = getLocalLedger().household.id;
    const year = 2026;
    const revision = useSavingsStore.getState().dataRevision;
    for (const method of ['historical_average', 'trend', 'pessimistic', 'hybrid'] as const) {
      const selected = await localSavingsApi.setDefaultProjectionMethod(householdId, year, method);
      expect(selected.method).toBe(method);
      expect((await localSavingsApi.getProjection(householdId, year)).method).toBe(method);
      expect((await localSavingsApi.getProjection(householdId, year + 1)).method).toBe(method);
      expect((await localSavingsApi.setProjectionTargets(householdId, {
        year, months: [12], targetCents: 100_000,
      })).method).toBe(method);
      // An explicit exploratory read never changes the app preference.
      await localSavingsApi.getProjection(householdId, year, 'hybrid');
      expect((await localSavingsApi.getProjection(householdId, year)).method).toBe(method);
    }
    expect(useSavingsStore.getState().dataRevision).toBe(revision + 4);
  });

  it('routes Projection through cashflow scenarios and keeps targets separate from forecasts', async () => {
    const householdId = getLocalLedger().household.id;
    const year = new Date().getUTCFullYear() + 1;
    await localSavingsApi.createIncome(householdId, {
      id: 'audit-salary', source_type: 'payroll', label: 'Salary', amount_cents: 500_000,
      income_date: `${year}-01-05`,
    });
    const before = await localSavingsApi.getProjection(householdId, year);
    expect(before.forecast?.model).toBe('cashflow-scenarios-v1');
    expect(before.forecast?.scenarios).toHaveLength(4);
    const after = await localSavingsApi.setProjectionTargets(householdId, {
      year, months: [1, 2, 3], targetCents: 9_000_000,
    });
    expect(after.projectedYearEnd).toBe(before.projectedYearEnd);
    expect(after.months[0].targetCents).toBe(9_000_000);
  });

  it('includes an income-only past month in Overview YTD and Projection actual totals', async () => {
    const householdId = getLocalLedger().household.id;
    await localSavingsApi.createIncome(householdId, {
      id: 'audit-salary', source_type: 'payroll', label: 'Salary', amount_cents: 500_000,
      income_date: '2020-01-05',
    });
    const overview = await localSavingsApi.getOverview(householdId, 2020, 12);
    const projection = await localSavingsApi.getProjection(householdId, 2020);
    expect(overview.ytdNet).toBe(500_000);
    expect(projection.actualToDate).toBe(overview.ytdNet);
  });

  it('creates income and reflects it in overview', async () => {
    const householdId = getLocalLedger().household.id;

    await localSavingsApi.createIncome(householdId, {
      id: 'inc_payroll_1',
      source_type: 'payroll',
      label: 'Salary',
      amount_cents: 500_000,
      income_date: '2026-08-01',
    });

    const { entries } = await localSavingsApi.listIncome(householdId, 2026, 8);
    expect(entries).toHaveLength(1);
    expect(entries[0].amount_cents).toBe(500_000);
    expect(entries[0].status).toBe('confirmed');

    const overview = await localSavingsApi.getOverview(householdId, 2026, 8);
    expect(overview.income.total).toBe(500_000);
    expect(overview.income.regularTotal).toBe(500_000);
    expect(overview.netSavings).toBe(500_000);
  });

  it('excludes draft income from overview totals', async () => {
    const householdId = getLocalLedger().household.id;

    await localSavingsApi.createIncome(householdId, {
      id: 'inc_draft',
      source_type: 'payroll',
      label: 'Draft rollover',
      amount_cents: 100_000,
      income_date: '2026-08-05',
    });

    await mutateLocalLedger(
      (ledger) => {
        const row = ledger.savingsIncome.find((e) => e.id === 'inc_draft');
        if (row) row.status = 'draft';
      },
      { opType: 'TEST', entityType: 'savings_income', entityId: 'inc_draft', payload: {} },
    );

    const overview = await localSavingsApi.getOverview(householdId, 2026, 8);
    expect(overview.income.total).toBe(0);
    expect(overview.income.entries).toHaveLength(0);
  });

  it('lists recurring payments and applies them to spending', async () => {
    const householdId = getLocalLedger().household.id;

    await localSavingsApi.createRecurringPayment(householdId, {
      id: 'rec_netflix',
      label: 'Netflix',
      amount_cents: 1999,
      is_essential: false,
      day_of_month: 15,
    });
    await localSavingsApi.createRecurringPayment(householdId, {
      id: 'rec_rent',
      label: 'Rent',
      amount_cents: 180_000,
      is_essential: true,
      day_of_month: 1,
    });

    const list = await localSavingsApi.listRecurringPayments(householdId, 2026, 8);
    expect(list.totalMonthlyCents).toBe(181_999);
    expect(list.items).toHaveLength(2);

    const applied = await localSavingsApi.applyRecurringPayments(householdId, {
      year: 2026,
      month: 8,
    });
    expect(applied.created).toBe(2);
    expect(applied.skipped).toBe(0);

    const { entries } = await localSavingsApi.listSpending(householdId, 2026, 8);
    expect(entries).toHaveLength(2);
    expect(entries.reduce((sum, e) => sum + e.amount_cents, 0)).toBe(181_999);

    const status = await localSavingsApi.getRecurringApplyStatus(householdId, 2026);
    expect(status.months[7].applied).toBe(true);
    expect(status.months[7].appliedCents).toBe(181_999);
    expect(status.months[7].matchesCurrent).toBe(true);
  });

  it('computes overview with income, recurring obligations, and budget spendings', async () => {
    const householdId = getLocalLedger().household.id;

    await localSavingsApi.createIncome(householdId, {
      id: 'inc_aug',
      source_type: 'payroll',
      label: 'Pay',
      amount_cents: 400_000,
      income_date: '2026-08-01',
    });
    await localSavingsApi.createRecurringPayment(householdId, {
      id: 'rec_phone',
      label: 'Phone',
      amount_cents: 8000,
    });

    await localBudgetApi.addExpense(householdId, {
      title: 'Groceries',
      amount: 12_500,
      expense_date: '2026-08-12',
    });

    const overview = await localSavingsApi.getOverview(householdId, 2026, 8);
    expect(overview.income.total).toBe(400_000);
    expect(overview.spending.monthlyPayments).toBe(8000);
    expect(overview.spending.spendings).toBe(12_500);
    expect(overview.spending.total).toBe(20_500);
    expect(overview.netSavings).toBe(379_500);
  });
});
