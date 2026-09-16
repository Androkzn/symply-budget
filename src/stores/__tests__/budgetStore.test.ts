/**
 * budgetStore — client-only Smart Budget UI state: selected period, active view,
 * an offline insights cache (period-keyed), and the dirty/revision bookkeeping
 * that drives dashboard re-fetches. Exercised through the store's public API.
 */
import type { BudgetInsights } from '@api/budget';
import { useBudgetStore } from '@stores/budgetStore';

const s = () => useBudgetStore.getState();

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

const INSIGHTS: BudgetInsights = {
  summary: 'On track',
  alerts: [],
  recommendations: [],
  generatedAt: '2026-07-01T00:00:00.000Z',
} as unknown as BudgetInsights;

const HASH = 'abc12345-9';

beforeEach(() => {
  // Each test starts from a clean, current-month store.
  s().reset();
});

describe('initial state', () => {
  it('defaults to the current year/month, dashboard view, and empty caches', () => {
    const { year, month } = currentYearMonth();
    expect(s().selectedYear).toBe(year);
    expect(s().selectedMonth).toBe(month);
    expect(s().activeView).toBe('dashboard');
    expect(s().insightsCache).toEqual({});
    expect(s().dataRevision).toBe(0);
    expect(s().insightsDirtyHids).toEqual({});
  });
});

describe('period selection', () => {
  it('setSelectedMonth updates both year and month', () => {
    s().setSelectedMonth(2025, 3);
    expect(s().selectedYear).toBe(2025);
    expect(s().selectedMonth).toBe(3);
  });

  it('resetToCurrentMonth snaps back to today after navigating away', () => {
    s().setSelectedMonth(2000, 1);
    s().resetToCurrentMonth();
    const { year, month } = currentYearMonth();
    expect(s().selectedYear).toBe(year);
    expect(s().selectedMonth).toBe(month);
  });

  it('persists the selected month/year so Home/Planning/Spending land back on it after a relaunch', () => {
    s().setSelectedMonth(2025, 3);
    const persisted = useBudgetStore.persist.getOptions().partialize?.(s()) as Record<
      string,
      unknown
    >;
    expect(persisted).toMatchObject({ selectedYear: 2025, selectedMonth: 3 });
  });

  it('does not persist the session-only active view', () => {
    s().setActiveView('planned');
    const persisted = useBudgetStore.persist.getOptions().partialize?.(s()) as Record<
      string,
      unknown
    >;
    expect(persisted).not.toHaveProperty('activeView');
  });
});

describe('active view', () => {
  it.each(['planned', 'spendings', 'savings', 'pension', 'wishes', 'dashboard'] as const)(
    'setActiveView(%s) is reflected',
    (view) => {
      s().setActiveView(view);
      expect(s().activeView).toBe(view);
    }
  );
});

describe('insights cache', () => {
  it('caches insights under household + period and returns them on an exact match', () => {
    s().cacheInsights('hh-1', '2026-07', INSIGHTS, HASH);
    const got = s().getCachedInsights('hh-1', '2026-07');
    expect(got).toMatchObject({
      ...INSIGHTS,
      householdId: 'hh-1',
      period: '2026-07',
      inputHash: HASH,
    });
  });

  it('returns null when the period does not match the cached one (stale month)', () => {
    s().cacheInsights('hh-1', '2026-07', INSIGHTS, HASH);
    expect(s().getCachedInsights('hh-1', '2026-08')).toBeNull();
  });

  it('returns null when nothing is cached for the household', () => {
    expect(s().getCachedInsights('nobody', '2026-07')).toBeNull();
  });

  it('keeps per-household caches independent', () => {
    s().cacheInsights('hh-1', '2026-07', INSIGHTS, HASH);
    s().cacheInsights(
      'hh-2',
      '2026-07',
      { ...INSIGHTS, summary: 'Over budget' } as BudgetInsights,
      HASH
    );
    expect(s().getCachedInsights('hh-1', '2026-07')?.summary).toBe('On track');
    expect(s().getCachedInsights('hh-2', '2026-07')?.summary).toBe('Over budget');
  });

  // Month nav used to evict: one entry per household meant stepping back a
  // month threw away the month you came from, so returning to it regenerated.
  it('keeps several periods per household so month nav costs no generations', () => {
    s().cacheInsights('hh-1', '2026-07', INSIGHTS, HASH);
    s().cacheInsights('hh-1', '2026-08', { ...INSIGHTS, summary: 'August' } as BudgetInsights, HASH);
    expect(s().getCachedInsights('hh-1', '2026-07')?.summary).toBe('On track');
    expect(s().getCachedInsights('hh-1', '2026-08')?.summary).toBe('August');
  });

  it('evicts the oldest generations once the cache is full', () => {
    for (let i = 1; i <= 14; i += 1) {
      s().cacheInsights(
        'hh-1',
        `2026-${String(i).padStart(2, '0')}`,
        { ...INSIGHTS, generatedAt: `2026-01-${String(i).padStart(2, '0')}T00:00:00.000Z` } as BudgetInsights,
        HASH
      );
    }
    expect(Object.keys(s().insightsCache)).toHaveLength(12);
    expect(s().getCachedInsights('hh-1', '2026-01')).toBeNull(); // oldest, dropped
    expect(s().getCachedInsights('hh-1', '2026-14')).not.toBeNull();
  });
});

describe('insights dirty tracking + dataRevision', () => {
  it('markInsightsDirty flags the household and bumps dataRevision', () => {
    expect(s().dataRevision).toBe(0);
    s().markInsightsDirty('hh-1');
    expect(s().insightsDirtyHids['hh-1']).toBe(true);
    expect(s().dataRevision).toBe(1);
    s().markInsightsDirty('hh-1');
    expect(s().dataRevision).toBe(2); // every mutation bumps the revision
  });

  it('clearInsightsDirty removes only that household flag (revision unchanged)', () => {
    s().markInsightsDirty('hh-1');
    s().markInsightsDirty('hh-2');
    const revBefore = s().dataRevision;
    s().clearInsightsDirty('hh-1');
    expect(s().insightsDirtyHids['hh-1']).toBeUndefined();
    expect(s().insightsDirtyHids['hh-2']).toBe(true);
    expect(s().dataRevision).toBe(revBefore); // clearing does not bump
  });
});

describe('reset', () => {
  it('restores every field to its initial, current-month state', () => {
    s().setSelectedMonth(1999, 12);
    s().setActiveView('wishes');
    s().cacheInsights('hh-1', '2026-07', INSIGHTS, HASH);
    s().markInsightsDirty('hh-1');

    s().reset();

    const { year, month } = currentYearMonth();
    expect(s().selectedYear).toBe(year);
    expect(s().selectedMonth).toBe(month);
    expect(s().activeView).toBe('dashboard');
    expect(s().insightsCache).toEqual({});
    expect(s().dataRevision).toBe(0);
    expect(s().insightsDirtyHids).toEqual({});
  });
});
