/**
 * mortgageStore — UI-only state: selected mortgage, active sub-tab, the user's
 * customized tab strip, and the dataRevision counter that drives view reloads
 * after every mutation.
 */
import type { MortgageListItem } from '@api/mortgage';

import { useMortgageStore } from '../mortgageStore';

const LIST: MortgageListItem[] = [
  {
    id: 'm_1',
    nickname: 'Main home',
    lender: 'RBC',
    productType: 'fixed',
    currentBalanceCents: 48_000_000,
    pctPaid: 0.22,
    nextRenewalDate: null,
    isActive: true,
  },
];

describe('mortgageStore', () => {
  beforeEach(() => {
    useMortgageStore.getState().reset();
  });

  it('starts with no selection, overview tab, the factory strip, revision 0', () => {
    const s = useMortgageStore.getState();
    expect(s.selectedMortgageId).toBeNull();
    expect(s.mortgages).toEqual([]);
    expect(s.activeSubTab).toBe('overview');
    expect(s.subTabOrder).toBeNull();
    expect(s.hiddenSubTabs).toEqual([]);
    expect(s.dataRevision).toBe(0);
  });

  it('selects a mortgage', () => {
    useMortgageStore.getState().setSelectedMortgage('m_123');
    expect(useMortgageStore.getState().selectedMortgageId).toBe('m_123');
  });

  it('publishes the property list for the header switcher', () => {
    useMortgageStore.getState().setMortgages(LIST);
    expect(useMortgageStore.getState().mortgages).toHaveLength(1);
    expect(useMortgageStore.getState().mortgages[0].nickname).toBe('Main home');
    // A deleted last property must empty the header, not leave it stale.
    useMortgageStore.getState().setMortgages([]);
    expect(useMortgageStore.getState().mortgages).toEqual([]);
  });

  it('never persists the property list (server data, refetched on load)', () => {
    useMortgageStore.getState().setMortgages(LIST);
    const persisted = useMortgageStore.persist.getOptions().partialize?.(
      useMortgageStore.getState()
    );
    expect(persisted).not.toHaveProperty('mortgages');
  });

  it('switches the active sub-tab', () => {
    useMortgageStore.getState().setActiveSubTab('schedule');
    expect(useMortgageStore.getState().activeSubTab).toBe('schedule');
  });

  it('bumps dataRevision on markDirty so views reload', () => {
    const before = useMortgageStore.getState().dataRevision;
    useMortgageStore.getState().markDirty();
    useMortgageStore.getState().markDirty();
    expect(useMortgageStore.getState().dataRevision).toBe(before + 2);
  });

  it('stores a customized tab strip, and drops it again on reset', () => {
    useMortgageStore.getState().setSubTabLayout(
      ['overview', 'forecast', 'payments', 'equity', 'schedule', 'renewal', 'statements',
        'renew', 'history'],
      ['renew', 'history']
    );
    expect(useMortgageStore.getState().subTabOrder?.[1]).toBe('forecast');
    expect(useMortgageStore.getState().hiddenSubTabs).toEqual(['renew', 'history']);

    useMortgageStore.getState().resetSubTabLayout();
    expect(useMortgageStore.getState().subTabOrder).toBeNull();
    expect(useMortgageStore.getState().hiddenSubTabs).toEqual([]);
  });

  it('reset restores initial state', () => {
    useMortgageStore.getState().setSelectedMortgage('m_x');
    useMortgageStore.getState().setMortgages(LIST);
    useMortgageStore.getState().setActiveSubTab('equity');
    useMortgageStore.getState().setSubTabLayout(['equity', 'overview'], ['payments']);
    useMortgageStore.getState().markDirty();
    useMortgageStore.getState().reset();
    const s = useMortgageStore.getState();
    expect(s.selectedMortgageId).toBeNull();
    expect(s.mortgages).toEqual([]);
    expect(s.activeSubTab).toBe('overview');
    expect(s.subTabOrder).toBeNull();
    expect(s.hiddenSubTabs).toEqual([]);
    expect(s.dataRevision).toBe(0);
  });
});
