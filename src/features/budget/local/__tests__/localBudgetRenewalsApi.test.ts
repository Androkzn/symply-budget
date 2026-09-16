import {
  closeLocalBudgetSession,
  getLocalLedger,
  mutateLocalLedger,
  openLocalBudgetSessionForTests,
} from '../engine';
import { BudgetLocalUnsupportedError } from '../errors';
import { localBudgetRenewalsApi } from '../renewals/localBudgetRenewalsApi';

describe('localBudgetRenewalsApi', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-renewal-1' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('upserts renewal metadata, marks renewed, and removes offline', async () => {
    const householdId = getLocalLedger().household.id;
    const paymentId = 'pay_local_insurance';
    const now = new Date().toISOString();

    await mutateLocalLedger(
      (ledger) => {
        ledger.savingsRecurringPayments = [
          {
            id: paymentId,
            household_id: householdId,
            category_id: null,
            label: 'Car insurance',
            amount_cents: 15_000,
            currency: 'CAD',
            day_of_month: 1,
            group_label: null,
            is_essential: true,
            active: true,
            is_automated: false,
            scope_type: 'all_year',
            scope_year: null,
            active_months: null,
            source: 'manual',
            created_by: null,
            created_at: now,
            updated_at: now,
          },
        ];
      },
      {
        opType: 'SAVINGS_RECURRING_PAYMENT_SEED',
        entityType: 'savings_recurring_payment',
        entityId: paymentId,
        payload: { id: paymentId },
      },
    );

    const { renewal: saved } = await localBudgetRenewalsApi.upsert(householdId, paymentId, {
      category: 'insurance',
      next_renewal_date: '2026-08-15',
      reminder_lead_days: 21,
    });

    expect(saved.recurring_payment_id).toBe(paymentId);
    expect(saved.category).toBe('insurance');
    expect(saved.next_renewal_date).toBe('2026-08-15');
    expect(saved.reminder_lead_days).toBe(21);
    expect(getLocalLedger().budgetRenewals).toHaveLength(1);

    const fetched = await localBudgetRenewalsApi.get(householdId, paymentId);
    expect(fetched.renewal?.next_renewal_date).toBe('2026-08-15');
    expect(fetched.documents).toEqual([]);

    const { renewal: renewed } = await localBudgetRenewalsApi.markRenewed(householdId, paymentId);
    expect(renewed.next_renewal_date).toBe('2027-08-15');
    expect(renewed.last_renewed_at).toBeTruthy();

    await localBudgetRenewalsApi.remove(householdId, paymentId);
    expect(getLocalLedger().budgetRenewals).toHaveLength(0);
    const afterRemove = await localBudgetRenewalsApi.get(householdId, paymentId);
    expect(afterRemove.renewal).toBeNull();
  });

  it('rejects document upload offline', async () => {
    await expect(localBudgetRenewalsApi.createDocument()).rejects.toBeInstanceOf(
      BudgetLocalUnsupportedError,
    );
    await expect(localBudgetRenewalsApi.uploadDocumentBytes()).rejects.toBeInstanceOf(
      BudgetLocalUnsupportedError,
    );
  });
});
