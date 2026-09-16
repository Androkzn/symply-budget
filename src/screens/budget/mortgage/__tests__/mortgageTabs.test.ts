/**
 * mortgageTabs — the Mortgage strip's layout resolver. A persisted layout is
 * just a list of ids, so this module is the whole contract between what the
 * customizer saves and what the dashboard renders: it must survive a stale or
 * corrupt saved layout without ever stranding the user on an empty strip, and
 * it must keep Overview visible no matter what was stored.
 */

import {
  DEFAULT_MORTGAGE_TAB_ORDER,
  MORTGAGE_TABS,
  REQUIRED_MORTGAGE_TAB,
  getMortgageTab,
  mortgageTabsSignature,
  resolveMortgageTabs,
  toMortgageFilterTabs,
  visibleContentTabs,
} from '../mortgageTabs';

describe('mortgageTabs catalog', () => {
  it('locks exactly one tab — Overview — as the guaranteed fallback', () => {
    const locked = MORTGAGE_TABS.filter((t) => t.locked);
    expect(locked.map((t) => t.id)).toEqual([REQUIRED_MORTGAGE_TAB]);
    expect(REQUIRED_MORTGAGE_TAB).toBe('overview');
  });

  it('marks the three screen-pushing tabs as destinations', () => {
    expect(MORTGAGE_TABS.filter((t) => t.destination).map((t) => t.id)).toEqual([
      'statements',
      'renew',
      'history',
    ]);
  });

  it('exposes a default order covering every catalog tab, and lookup by id', () => {
    expect(DEFAULT_MORTGAGE_TAB_ORDER).toHaveLength(MORTGAGE_TABS.length);
    expect(new Set(DEFAULT_MORTGAGE_TAB_ORDER).size).toBe(MORTGAGE_TABS.length);
    expect(getMortgageTab('equity')?.label).toBe('Equity');
    expect(getMortgageTab('nope')).toBeUndefined();
  });
});

describe('resolveMortgageTabs', () => {
  it('returns the factory strip when nothing has been customized', () => {
    const { shown, hidden } = resolveMortgageTabs(null, null);
    expect(shown.map((t) => t.id)).toEqual(DEFAULT_MORTGAGE_TAB_ORDER);
    expect(hidden).toEqual([]);
  });

  it('applies the saved order', () => {
    const { shown } = resolveMortgageTabs(
      ['forecast', 'overview', 'schedule', 'payments', 'equity', 'renewal', 'statements', 'renew', 'history'],
      []
    );
    expect(shown.slice(0, 4).map((t) => t.id)).toEqual([
      'forecast',
      'overview',
      'schedule',
      'payments',
    ]);
  });

  it('splits hidden tabs out of the strip, keeping the saved order in each list', () => {
    const { shown, hidden } = resolveMortgageTabs(DEFAULT_MORTGAGE_TAB_ORDER, [
      'schedule',
      'renew',
    ]);
    expect(shown.map((t) => t.id)).toEqual([
      'overview',
      'payments',
      'equity',
      'forecast',
      'renewal',
      'statements',
      'history',
    ]);
    expect(hidden.map((t) => t.id)).toEqual(['schedule', 'renew']);
  });

  it('never hides the locked tab, however the layout was persisted', () => {
    const { shown, hidden } = resolveMortgageTabs(DEFAULT_MORTGAGE_TAB_ORDER, [
      'overview',
      'payments',
      'equity',
      'forecast',
      'schedule',
      'renewal',
      'statements',
      'renew',
      'history',
    ]);
    expect(shown.map((t) => t.id)).toEqual(['overview']);
    expect(hidden.map((t) => t.id)).not.toContain('overview');
  });

  it('drops ids that are no longer in the catalog, and de-dupes', () => {
    const { shown } = resolveMortgageTabs(['equity', 'ghost-tab', 'equity', 'overview'], []);
    expect(shown.map((t) => t.id).slice(0, 2)).toEqual(['equity', 'overview']);
    expect(shown.map((t) => t.id)).not.toContain('ghost-tab');
    // Still complete — the un-saved catalog tabs came back.
    expect(shown).toHaveLength(MORTGAGE_TABS.length);
  });

  it('appends catalog tabs a stale saved layout never knew about, visible', () => {
    const { shown, hidden } = resolveMortgageTabs(['overview', 'payments'], []);
    expect(shown.slice(0, 2).map((t) => t.id)).toEqual(['overview', 'payments']);
    expect(shown.map((t) => t.id)).toContain('history');
    expect(hidden).toEqual([]);
  });
});

describe('strip view model', () => {
  it('gives destination tabs a leading icon and leaves content tabs label-only', () => {
    const { shown } = resolveMortgageTabs(null, null);
    const filterTabs = toMortgageFilterTabs(shown);
    expect(filterTabs.find((t) => t.id === 'overview')).toEqual({
      id: 'overview',
      label: 'Overview',
    });
    expect(filterTabs.find((t) => t.id === 'statements')).toEqual({
      id: 'statements',
      label: 'Statements',
      icon: 'documents-outline',
    });
  });

  it('lists only the inline-content tabs as candidates for the active tab', () => {
    const { shown } = resolveMortgageTabs(null, null);
    expect(visibleContentTabs(shown).map((t) => t.id)).toEqual([
      'overview',
      'payments',
      'equity',
      'forecast',
      'schedule',
      'renewal',
    ]);
  });

  it('signs a layout so the customizer can detect real edits only', () => {
    const a = resolveMortgageTabs(null, null);
    const b = resolveMortgageTabs(DEFAULT_MORTGAGE_TAB_ORDER, []);
    const c = resolveMortgageTabs(DEFAULT_MORTGAGE_TAB_ORDER, ['equity']);
    expect(mortgageTabsSignature(a.shown, a.hidden)).toBe(mortgageTabsSignature(b.shown, b.hidden));
    expect(mortgageTabsSignature(c.shown, c.hidden)).not.toBe(
      mortgageTabsSignature(a.shown, a.hidden)
    );
  });
});
