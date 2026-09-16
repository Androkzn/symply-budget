import {
  closeLocalBudgetSession,
  getLocalLedger,
  openLocalBudgetSessionForTests,
} from '../engine';
import { localBudgetLoansApi } from '../loans/localBudgetLoansApi';

describe('localBudgetLoansApi', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-loan-1' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('upserts a loan, anchors summary to the recurring payment amount, and builds schedule', async () => {
    const householdId = getLocalLedger().household.id;
    const paymentId = 'pay_local_car_loan';
    const now = new Date().toISOString();

    getLocalLedger().savingsRecurringPayments = [
      {
        id: paymentId,
        household_id: householdId,
        category_id: null,
        label: 'Car loan',
        amount_cents: 10_000,
        currency: 'CAD',
        day_of_month: 15,
        group_label: null,
        is_essential: true,
        active: true,
        is_automated: false,
        scope_type: 'all_year',
        scope_year: null,
        active_months: null,
        source: 'manual',
        created_by: 'user-loan-1',
        created_at: now,
        updated_at: now,
      },
    ];

    const { loan, summary } = await localBudgetLoansApi.upsert(householdId, paymentId, {
      rate_type: 'zero',
      principal_cents: 120_000,
      term_months: 12,
      start_date: '2099-01-15',
    });

    expect(loan.recurring_payment_id).toBe(paymentId);
    expect(loan.principal_cents).toBe(120_000);
    expect(getLocalLedger().budgetLoans).toHaveLength(1);

    expect(summary.termMonths).toBe(12);
    expect(summary.elapsedMonths).toBe(0);
    expect(summary.paymentsRemaining).toBe(12);
    expect(summary.currentBalanceCents).toBe(120_000);
    expect(summary.totalInterestCents).toBe(0);
    expect(summary.totalCostCents).toBe(120_000);

    const schedule = await localBudgetLoansApi.getSchedule(householdId, paymentId);
    expect(schedule.paymentsElapsed).toBe(0);
    expect(schedule.rows).toHaveLength(12);
    expect(schedule.rows[schedule.rows.length - 1].balance).toBe(0);

    const fetched = await localBudgetLoansApi.get(householdId, paymentId);
    expect(fetched.loan?.id).toBe(loan.id);
    expect(fetched.summary?.paymentsRemaining).toBe(12);

    await localBudgetLoansApi.remove(householdId, paymentId);
    expect(getLocalLedger().budgetLoans).toHaveLength(0);
    const afterRemove = await localBudgetLoansApi.get(householdId, paymentId);
    expect(afterRemove.loan).toBeNull();
    expect(afterRemove.summary).toBeNull();
  });
});
