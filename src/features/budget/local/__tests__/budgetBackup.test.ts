import {
  buildBudgetBackupArchive,
  restoreBudgetBackup,
  verifyBudgetBackup,
} from '../backup/budgetBackup';
import {
  closeLocalBudgetSession,
  getLocalLedger,
  openLocalBudgetSessionForTests,
} from '../engine';
import { localBudgetApi } from '../localBudgetApi';

describe('budgetBackup', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-backup-1' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it(
    'creates a sealed archive and restores projection after dry-run verify',
    async () => {
    const householdId = getLocalLedger().household.id;
    await localBudgetApi.addExpense(householdId, {
      title: 'Backup me',
      amount: 2500,
      expense_date: '2026-08-10',
    });

    // BR-016: household-addressed and async — a cold household is hydrated by
    // the build, so naming one is the whole point of the parameter.
    const created = await buildBudgetBackupArchive({ householdId });
    expect(created.householdId).toBe(householdId);
    expect(created.archiveJson).not.toContain('Backup me');
    expect(created.phrase.split(' ')).toHaveLength(12);

    const verified = verifyBudgetBackup(created.archiveJson, created.phrase);
    expect(verified.status).toBe('ok');
    expect(verified.payload?.snapshotJson).toContain('Backup me');

    // Wipe projection then restore from archive.
    getLocalLedger().expenses = [];
    expect(getLocalLedger().expenses).toHaveLength(0);

    const restored = await restoreBudgetBackup(created.archiveJson, created.phrase);
    expect(restored.expenseCount).toBe(1);
    expect(getLocalLedger().expenses[0].title).toBe('Backup me');
  },
    60_000,
  );

  it(
    'round-trips receipt-scan tax and deposit breakdowns',
    async () => {
      // `snapshotFromLedger` rest-spreads the ledger and `restoreDeltaFromBackup`
      // copies rows verbatim, so new expense columns ride along for free — but
      // only as long as nobody reintroduces a field whitelist on either side.
      // The D1→V2 export script did exactly that and silently dropped
      // `deposit_amount` (backend/scripts/export-budget-d1-to-v2-backup.mjs).
      const householdId = getLocalLedger().household.id;
      await localBudgetApi.addExpense(householdId, {
        title: 'Groceries',
        amount: 1210, // tax-inclusive
        expense_date: '2026-08-10',
        tax_amount: 110,
        deposit_amount: 20,
        saved_amount: 75,
      });

      const created = await buildBudgetBackupArchive({ householdId });
      getLocalLedger().expenses = [];

      await restoreBudgetBackup(created.archiveJson, created.phrase);

      const [expense] = getLocalLedger().expenses;
      expect(expense.amount).toBe(1210);
      expect(expense.tax_amount).toBe(110);
      expect(expense.deposit_amount).toBe(20);
      expect(expense.saved_amount).toBe(75);
    },
    60_000,
  );
});
