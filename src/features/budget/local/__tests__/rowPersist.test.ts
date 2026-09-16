import {
  closeLocalBudgetSession,
  mutateLocalLedger,
  openLocalBudgetSession,
  resetLocalBudgetSession,
} from '../engine';
import type { LocalBudgetLedger } from '../engine';
import {
  ALWAYS_RESIDENT_BUCKET,
  collectRowWrites,
  rowBucket,
  type LedgerDelta,
} from '../projection';

function emptyLedger(): LocalBudgetLedger {
  return {
    version: 1,
    household: { id: 'hh', name: 't' } as LocalBudgetLedger['household'],
    memberId: 'm',
    deviceId: 'd',
    categories: [],
    expenses: [],
    items: [],
    goals: [],
    subBudgets: [],
    transfers: [],
    mortgages: [],
    mortgageTerms: [],
    mortgageStatements: [],
    mortgageEvents: [],
    mortgageOffers: [],
    savingsIncome: [],
    savingsSpending: [],
    savingsRecurringPayments: [],
    savingsGoals: [],
    savingsCategories: [],
    savingsIncomeTemplates: [],
    savingsMonthlyTargets: [],
    budgetLoans: [],
    budgetRenewals: [],
    registeredAccounts: [],
    registeredTransactions: [],
    wishes: [],
    wishEntries: [],
    wishAttachments: [],
    ops: [],
    lww: {},
    conflicts: [],
  };
}

describe('rowBucket', () => {
  it('windows expenses by expense_date and degrades missing dates to *', () => {
    expect(rowBucket('expenses', { id: '1', expense_date: '2026-08-12' })).toBe('2026-08');
    expect(rowBucket('expenses', { id: '1' })).toBe(ALWAYS_RESIDENT_BUCKET);
    expect(rowBucket('expenses', { id: '1', expense_date: 'not-a-date' })).toBe(
      ALWAYS_RESIDENT_BUCKET,
    );
    expect(rowBucket('categories', { id: 'c1' })).toBe(ALWAYS_RESIDENT_BUCKET);
  });
});

describe('collectRowWrites', () => {
  it('writes only the keys in a delta', () => {
    const ledger = emptyLedger();
    ledger.expenses = [
      { id: 'keep', amount: 1 } as never,
      { id: 'edit', amount: 2, expense_date: '2026-08-01' } as never,
    ];
    const delta: LedgerDelta = {
      v: 1,
      u: { expenses: [{ k: 'edit', f: { amount: 3 } }] },
      d: { expenses: ['gone'] },
    };
    const writes = collectRowWrites(ledger, delta);
    expect(writes.map((w) => w.rowKey).sort()).toEqual(['edit', 'gone']);
    expect(writes.find((w) => w.rowKey === 'gone')?.deleted).toBe(true);
    expect(writes.find((w) => w.rowKey === 'edit')?.bucket).toBe('2026-08');
  });
});

describe('row-granular persist roundtrip', () => {
  beforeEach(async () => {
    await resetLocalBudgetSession();
  });
  afterEach(async () => {
    await resetLocalBudgetSession();
  });

  it('reloads an expense after close without rewriting the whole ledger', async () => {
    const first = await openLocalBudgetSession({ userId: 'user-row-1' });
    const householdId = first.household.id;
    await mutateLocalLedger(
      (ledger) => {
        ledger.expenses.push({
          id: 'exp-persist-1',
          household_id: householdId,
          category_id: ledger.categories[0]?.id ?? 'cat',
          title: 'Coffee',
          amount: 450,
          expense_date: '2026-08-12',
        } as never);
      },
      { opType: 'EXPENSE_CREATE', entityType: 'expense', entityId: 'exp-persist-1', payload: {} },
    );

    await closeLocalBudgetSession();
    const reopened = await openLocalBudgetSession({ userId: 'user-row-1' });
    expect(reopened.household.id).toBe(householdId);
    expect(reopened.expenses.some((row) => row.id === 'exp-persist-1')).toBe(true);
    expect(reopened.categories.length).toBeGreaterThan(0);
  });
});
