/**
 * savingsStore — client-only Savings UI state: selected period, active sub-tab,
 * and the `dataRevision` counter bumped after every savings mutation so all
 * Savings views (and the Budget headroom card) refetch. Nothing is persisted.
 */
import { getSavedProjectionMethod, useSavingsStore } from '@stores/savingsStore';

const s = () => useSavingsStore.getState();

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

beforeEach(() => {
  s().reset();
});

describe('initial state', () => {
  it('defaults to the current year/month, overview tab, revision 0', () => {
    const { year, month } = currentYearMonth();
    expect(s().selectedYear).toBe(year);
    expect(s().selectedMonth).toBe(month);
    expect(s().activeSubTab).toBe('overview');
    expect(s().dataRevision).toBe(0);
  });
});

describe('period selection', () => {
  it('setSelectedMonth updates both year and month', () => {
    s().setSelectedMonth(2024, 11);
    expect(s().selectedYear).toBe(2024);
    expect(s().selectedMonth).toBe(11);
  });

  it('resetToCurrentMonth snaps back to today', () => {
    s().setSelectedMonth(2001, 2);
    s().resetToCurrentMonth();
    const { year, month } = currentYearMonth();
    expect(s().selectedYear).toBe(year);
    expect(s().selectedMonth).toBe(month);
  });
});

describe('active sub-tab', () => {
  it.each(['overview', 'income', 'monthly', 'goals'] as const)(
    'setActiveSubTab(%s) is reflected',
    (tab) => {
      s().setActiveSubTab(tab);
      expect(s().activeSubTab).toBe(tab);
    }
  );
});

describe('markDirty', () => {
  it('increments dataRevision on every call so views know to refetch', () => {
    expect(s().dataRevision).toBe(0);
    s().markDirty();
    s().markDirty();
    s().markDirty();
    expect(s().dataRevision).toBe(3);
  });
});

describe('reset', () => {
  it('restores every field to its initial, current-month state', () => {
    s().setSelectedMonth(1990, 6);
    s().setActiveSubTab('goals');
    s().markDirty();

    s().reset();

    const { year, month } = currentYearMonth();
    expect(s().selectedYear).toBe(year);
    expect(s().selectedMonth).toBe(month);
    expect(s().activeSubTab).toBe('overview');
    expect(s().dataRevision).toBe(0);
  });
});

describe('durable scenario preference', () => {
  it('isolates households, invalidates consumers and survives UI reset', async () => {
    await getSavedProjectionMethod('scenario-a');
    const revision = s().dataRevision;
    s().setProjectionMethod('scenario-a', 'trend');
    s().setProjectionMethod('scenario-b', 'historical_average');
    expect(s().dataRevision).toBe(revision + 2);
    s().reset();
    expect(await getSavedProjectionMethod('scenario-a')).toBe('trend');
    expect(await getSavedProjectionMethod('scenario-b')).toBe('historical_average');
    expect(await getSavedProjectionMethod('scenario-new')).toBe('hybrid');
  });

  it('restores the saved choice from storage without restoring the selected period', async () => {
    await getSavedProjectionMethod('scenario-persist');
    s().setProjectionMethod('scenario-persist', 'historical_average');
    s().setSelectedMonth(1990, 1);
    await Promise.resolve();
    // Rehydration must read the persisted map, not this in-memory object.
    const originalStorage = useSavingsStore.persist.getOptions().storage!;
    const saved = await originalStorage.getItem('savings-storage');
    useSavingsStore.setState({ projectionMethods: {} });
    await originalStorage.setItem('savings-storage', saved!);
    await useSavingsStore.persist.rehydrate();
    expect(await getSavedProjectionMethod('scenario-persist')).toBe('historical_average');
    const persisted = useSavingsStore.persist.getOptions().partialize!(s());
    expect(persisted).not.toHaveProperty('selectedYear');
  });
});
