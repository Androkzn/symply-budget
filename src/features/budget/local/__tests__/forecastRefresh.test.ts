import { getSavedProjectionMethod, useSavingsStore } from '@stores/savingsStore';

import { closeLocalBudgetSession, getLocalLedger, mutateLocalLedger, openLocalBudgetSessionForTests } from '../engine';
import { localSavingsApi } from '../savings/localSavingsApi';
import { startBudgetLedgerRefreshBridge, stopBudgetLedgerRefreshBridge } from '../sync/ledgerRefresh';

jest.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn().mockResolvedValue(undefined) } }));

describe('forecast refresh from committed data', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'forecast-refresh-user' });
    await getSavedProjectionMethod(getLocalLedger().household.id);
    jest.useFakeTimers();
    startBudgetLedgerRefreshBridge();
  });
  afterEach(async () => {
    stopBudgetLedgerRefreshBridge();
    jest.useRealTimers();
    await closeLocalBudgetSession();
  });

  it('coalesces local income create/edit/delete and retains the selected scenario', async () => {
    const householdId = getLocalLedger().household.id;
    await localSavingsApi.setDefaultProjectionMethod(householdId, 2020, 'pessimistic');
    const revision = useSavingsStore.getState().dataRevision;
    const before = await localSavingsApi.getProjection(householdId, 2020);
    await localSavingsApi.createIncome(householdId, {
      id: 'refresh-pay', source_type: 'payroll', label: 'Salary', amount_cents: 100_000,
      income_date: '2020-08-01',
    });
    await mutateLocalLedger((ledger) => {
      ledger.savingsIncome.find((row) => row.id === 'refresh-pay')!.amount_cents = 200_000;
    }, { opType: 'INCOME_UPDATE', entityType: 'income', entityId: 'refresh-pay', payload: {} });
    // No UI called markDirty; the central bridge publishes one revision.
    expect(useSavingsStore.getState().dataRevision).toBe(revision);
    jest.advanceTimersByTime(120);
    expect(useSavingsStore.getState().dataRevision).toBe(revision + 1);
    const after = await localSavingsApi.getProjection(householdId, 2020);
    expect(after.method).toBe('pessimistic');
    expect(after.projectedYearEnd - before.projectedYearEnd).toBe(200_000);

    await mutateLocalLedger((ledger) => {
      ledger.savingsIncome = ledger.savingsIncome.filter((row) => row.id !== 'refresh-pay');
    }, { opType: 'INCOME_DELETE', entityType: 'income', entityId: 'refresh-pay', payload: {} });
    jest.advanceTimersByTime(120);
    expect(useSavingsStore.getState().dataRevision).toBe(revision + 2);
    expect((await localSavingsApi.getProjection(householdId, 2020)).projectedYearEnd).toBe(before.projectedYearEnd);
  });

  it('cancels a queued refresh when the bridge is stopped', async () => {
    const householdId = getLocalLedger().household.id;
    const revision = useSavingsStore.getState().dataRevision;
    await localSavingsApi.createIncome(householdId, {
      id: 'refresh-stop', source_type: 'payroll', label: 'Salary', amount_cents: 100_000,
      income_date: '2020-08-01',
    });
    stopBudgetLedgerRefreshBridge();
    jest.advanceTimersByTime(120);
    expect(useSavingsStore.getState().dataRevision).toBe(revision);
  });
});
