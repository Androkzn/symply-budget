import '../cryptoPolyfill';

import {
  aeadDecrypt,
  utf8Decode,
  utf8Encode,
} from '@symply/local-first';

import {
  buildBudgetBackupArchive,
  restoreBudgetBackup,
} from '../backup/budgetBackup';
import {
  closeLocalBudgetSession,
  getLocalHouseholdKeys,
  getLocalLedger,
  openLocalBudgetSessionForTests,
} from '../engine';
import { localBudgetApi } from '../localBudgetApi';
import {
  applyLedgerDelta,
  decodeLedgerOpPayload,
  restoreDeltaFromBackup,
  restoreStamp,
} from '../projection';

import { emptyLedger, expenseRow, stampAt } from './ledgerTestKit';

describe('restore merge (D-20)', () => {
  it('keeps live field edits and absorbing tombstones', () => {
    const live = emptyLedger();
    applyLedgerDelta(
      live,
      { v: 1, u: { expenses: [{ k: 'exp-1', f: { ...expenseRow('exp-1', { amount: 5000 }) }, n: 1 }] } },
      stampAt(1000, 'member-live', 'op-live'),
    );
    applyLedgerDelta(
      live,
      { v: 1, d: { expenses: ['exp-2'] } },
      stampAt(1000, 'member-live', 'op-del'),
    );

    const backup = emptyLedger();
    backup.expenses = [
      expenseRow('exp-1', { amount: 1000 }) as never,
      expenseRow('exp-2', { amount: 2000 }) as never,
      expenseRow('exp-3', { amount: 3000 }) as never,
    ];

    const delta = restoreDeltaFromBackup(live, backup);
    expect(delta?.u?.expenses?.some((row) => row.k === 'exp-3')).toBe(true);
    applyLedgerDelta(live, delta!, restoreStamp('op-restore'));

    expect(live.expenses.find((row) => row.id === 'exp-1')?.amount).toBe(5000);
    expect(live.expenses.find((row) => row.id === 'exp-2')).toBeUndefined();
    expect(live.expenses.find((row) => row.id === 'exp-3')?.amount).toBe(3000);
  });
});

describe('restoreBudgetBackup persists a real delta', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-restore-delta' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('encodes a LedgerDelta so peers can apply the restore', async () => {
    const householdId = getLocalLedger().household.id;
    await localBudgetApi.addExpense(householdId, {
      title: 'Keep me',
      amount: 1111,
      expense_date: '2026-08-10',
    });
    const created = await buildBudgetBackupArchive({ householdId });

    await localBudgetApi.addExpense(householdId, {
      title: 'Live only',
      amount: 2222,
      expense_date: '2026-08-10',
    });

    await restoreBudgetBackup(created.archiveJson, created.phrase);

    const live = getLocalLedger();
    expect(live.expenses.some((row) => row.title === 'Keep me')).toBe(true);
    expect(live.expenses.some((row) => row.title === 'Live only')).toBe(true);

    const restoreOp = [...live.ops].reverse().find((op) => op.opType === 'BACKUP_RESTORE');
    expect(restoreOp).toBeTruthy();
    const keys = getLocalHouseholdKeys();
    const aad = utf8Encode(`${restoreOp!.householdId}:${restoreOp!.keyEpoch}:${restoreOp!.opId}`);
    const payload = JSON.parse(utf8Decode(aeadDecrypt(keys.hdk, restoreOp!.payload, aad)));
    expect(decodeLedgerOpPayload(payload)).not.toBeNull();
    expect((payload as { intent?: { restoreEpoch?: number } }).intent?.restoreEpoch).toEqual(
      expect.any(Number),
    );
  }, 60_000);
});
