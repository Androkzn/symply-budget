import type { SavingsImportDraft } from '@api/savings';

import {
  closeLocalBudgetSession,
  getLocalLedger,
  openLocalBudgetSessionForTests,
} from '../../engine';
import {
  commitLocalSavingsImport,
  countLocalImportCommitted,
} from '../confirmSavingsImport';
import { createLocalImportJob, resetLocalImportJobsForTests } from '../localImportJobStore';

const DRAFT: SavingsImportDraft = {
  income: [
    {
      member_name: null,
      source_type: 'other',
      label: 'Payroll',
      amount_cents: 500_000,
      income_date: '2026-08-01',
      is_recurring: false,
      day_of_month: null,
    },
  ],
  spending: [
    {
      category_name: null,
      label: 'Groceries',
      amount_cents: 12_345,
      spending_date: '2026-08-05',
    },
  ],
  recurringPayments: [
    {
      label: 'Internet',
      amount_cents: 8900,
      category_name: null,
      day_of_month: 15,
      group_label: 'Utilities',
      is_essential: true,
    },
  ],
};

describe('commitLocalSavingsImport', () => {
  beforeEach(async () => {
    resetLocalImportJobsForTests();
    await openLocalBudgetSessionForTests({ userId: 'user-test-1' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
    resetLocalImportJobsForTests();
  });

  it('writes only after explicit confirm and is idempotent', async () => {
    const householdId = getLocalLedger().household.id;
    const jobId = createLocalImportJob(householdId, DRAFT, { sourceKind: 'text' });

    expect(getLocalLedger().savingsIncome).toHaveLength(0);

    const first = await commitLocalSavingsImport(householdId, jobId, DRAFT);
    expect(first).toEqual({ income: 1, spending: 1, recurringPayments: 1 });
    expect(getLocalLedger().savingsIncome[0]?.label).toBe('Payroll');

    const second = await commitLocalSavingsImport(householdId, jobId, DRAFT);
    expect(second).toEqual({ income: 0, spending: 0, recurringPayments: 0 });
    // Async since BR-016: it resolves through `getLocalLedgerFor`, which decrypts
    // a household that may never have been opened this launch.
    expect(await countLocalImportCommitted(householdId, jobId)).toEqual(first);
  });
});
