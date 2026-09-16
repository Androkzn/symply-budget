/**
 * pensionStore — UI-transient state for the Budget → Pension tab. Mirrors the
 * savingsStore contract: year select, sub-tab switch, and `markDirty` bump. No
 * money math and nothing persisted lives here.
 */
import { usePensionStore } from '../pensionStore';

describe('pensionStore', () => {
  beforeEach(() => {
    usePensionStore.getState().reset();
  });

  it('defaults to the current year, the room sub-tab, and revision 0', () => {
    const s = usePensionStore.getState();
    expect(s.selectedYear).toBe(new Date().getFullYear());
    expect(s.activeSubTab).toBe('room');
    expect(s.dataRevision).toBe(0);
  });

  it('setSelectedYear updates the year', () => {
    usePensionStore.getState().setSelectedYear(2027);
    expect(usePensionStore.getState().selectedYear).toBe(2027);
  });

  it('setActiveSubTab switches the sub-tab', () => {
    usePensionStore.getState().setActiveSubTab('room');
    expect(usePensionStore.getState().activeSubTab).toBe('room');
  });

  it('markDirty increments dataRevision so views refetch', () => {
    const before = usePensionStore.getState().dataRevision;
    usePensionStore.getState().markDirty();
    expect(usePensionStore.getState().dataRevision).toBe(before + 1);
  });

  it('reset restores defaults', () => {
    const store = usePensionStore.getState();
    store.setSelectedYear(2030);
    store.setActiveSubTab('accounts');
    store.markDirty();
    store.reset();
    const s = usePensionStore.getState();
    expect(s.selectedYear).toBe(new Date().getFullYear());
    expect(s.activeSubTab).toBe('room');
    expect(s.dataRevision).toBe(0);
  });
});
