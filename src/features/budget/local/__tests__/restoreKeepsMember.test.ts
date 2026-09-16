import '../cryptoPolyfill';

import {
  applyLocalLedgerRestore,
  closeLocalBudgetSession,
  getLocalLedger,
  openLocalBudgetSessionForTests,
} from '../engine';
import { localBudgetApi } from '../localBudgetApi';

/**
 * A household-replacing restore must NOT adopt the backup's `memberId`.
 *
 * `openLocalBudgetSession` compares the persisted member id against the
 * signed-in `userId` and, on a mismatch, archives the ledger and mints a fresh
 * empty one. A migration archive carries a SERVER-side member id that can never
 * equal a local user id, so adopting it armed a one-launch fuse: the restore
 * succeeded, the user saw their data, and the next launch retired all of it
 * (observed 2026-08-16 — restored 12:58, retired 13:10, 392 rows archived).
 */
describe('restore does not hand the device a foreign member id', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-local' });
  });
  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('keeps this device’s member id when the backup replaces the household', async () => {
    const live = getLocalLedger();
    await localBudgetApi.addExpense(live.household.id, {
      title: 'Seed',
      amount: 1000,
      expense_date: '2026-08-10',
    });

    // Stands in for a D1→local migration archive: a foreign household, and a
    // member id minted server-side that no local user will ever match.
    const foreignHouseholdId = 'ebaa46a9-378f-4dce-8989-8a48b988c991';
    const foreignMemberId = 'mig_msw1vu4c';
    const backup = JSON.parse(JSON.stringify(getLocalLedger())) as ReturnType<
      typeof getLocalLedger
    >;
    backup.memberId = foreignMemberId;
    backup.household = { ...backup.household, id: foreignHouseholdId, name: 'Sweet Home' };

    await applyLocalLedgerRestore(backup, {
      entityId: foreignHouseholdId,
      replaceHousehold: true,
      payload: { restoreEpoch: 1 },
    });

    const after = getLocalLedger();
    // The household comes from the backup …
    expect(after.household.id).toBe(foreignHouseholdId);
    expect(after.household.name).toBe('Sweet Home');
    // … but the member stays whoever is signed in on this device, or the next
    // `openLocalBudgetSession` archives everything that was just restored.
    expect(after.memberId).toBe('user-local');
    expect(after.memberId).not.toBe(foreignMemberId);
  }, 60000);
});
