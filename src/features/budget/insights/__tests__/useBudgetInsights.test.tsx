/**
 * The regeneration policy, exercised through the hook that owns it.
 *
 * The bug this replaces: the dashboard regenerated on every focus and every
 * `dataRevision` bump with `forceRefresh: true`, so one sync burst (or one
 * scroll spent on a screen a peer was syncing into) rewrote the card ten times
 * in a row. Each case below pins one of the four guards that make that
 * impossible.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { BudgetInsights, MonthlyOverview } from '@api/budget';
import { useBudgetStore } from '@stores/budgetStore';

import {
  __resetBudgetInsightsInFlight,
  INSIGHTS_AUTO_DEBOUNCE_MS,
  useBudgetInsights,
  type UseBudgetInsightsArgs,
} from '../useBudgetInsights';

const mockGetInsights = jest.fn();

jest.mock('@api/budget', () => ({
  budgetApi: {
    getInsights: (...args: unknown[]) => mockGetInsights(...args),
  },
}));

function answer(summary: string): BudgetInsights {
  return {
    summary,
    alerts: [],
    recommendations: [],
    projected_month_end_balance: 0,
    generatedAt: new Date().toISOString(),
    cached: false,
  };
}

function overviewWith(overrides: Partial<MonthlyOverview> = {}): MonthlyOverview {
  return {
    plannedBudget: 200_000,
    actualSpent: 45_000,
    committedTotal: 0,
    remainingBudget: 155_000,
    savedTotal: 0,
    expenses: [],
    items: [],
    ...overrides,
  } as unknown as MonthlyOverview;
}

/** Harness: renders the hook and exposes its latest result. */
function renderHook(args: UseBudgetInsightsArgs) {
  const result: { current: ReturnType<typeof useBudgetInsights> } = {
    current: { insights: null, loading: false, refresh: () => {} },
  };
  function Probe(props: UseBudgetInsightsArgs) {
    result.current = useBudgetInsights(props);
    return null;
  }
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<Probe {...args} />);
  });
  return {
    result,
    rerender: (next: UseBudgetInsightsArgs) =>
      act(() => {
        tree.update(<Probe {...next} />);
      }),
    unmount: () => act(() => tree.unmount()),
  };
}

/** Let the debounce fire and the awaited API call settle. */
async function settle() {
  await act(async () => {
    jest.advanceTimersByTime(INSIGHTS_AUTO_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
  });
}

const BASE: UseBudgetInsightsArgs = {
  householdId: 'hh-1',
  year: 2026,
  month: 9,
  overview: overviewWith(),
};

beforeEach(() => {
  jest.useFakeTimers();
  __resetBudgetInsightsInFlight();
  useBudgetStore.getState().reset();
  mockGetInsights.mockReset();
  mockGetInsights.mockResolvedValue(answer('First read of the month.'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useBudgetInsights', () => {
  it('generates once for a month it has never summarized', async () => {
    const { result } = renderHook(BASE);
    await settle();

    expect(mockGetInsights).toHaveBeenCalledTimes(1);
    expect(mockGetInsights).toHaveBeenCalledWith('hh-1', 2026, 9, false);
    expect(result.current.insights?.summary).toBe('First read of the month.');
  });

  it('does not make the member wait for the first answer of a month', async () => {
    renderHook(BASE);
    await act(async () => {
      await Promise.resolve(); // no timer advanced — the empty card asks at once
    });
    expect(mockGetInsights).toHaveBeenCalledTimes(1);
  });

  it('lets the month settle before REPLACING an answer already on screen', async () => {
    const { rerender } = renderHook(BASE);
    await settle();
    mockGetInsights.mockClear();

    rerender({ ...BASE, overview: overviewWith({ actualSpent: 46_000 }) });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetInsights).not.toHaveBeenCalled();

    await settle();
    expect(mockGetInsights).toHaveBeenCalledTimes(1);
  });

  it('asks nobody while the month is unchanged, however often it re-renders', async () => {
    const { rerender } = renderHook(BASE);
    await settle();
    expect(mockGetInsights).toHaveBeenCalledTimes(1);

    // Ten repaints off the same numbers — a scroll, a focus, ten peer ops that
    // changed a household this member is not looking at.
    for (let i = 0; i < 10; i += 1) {
      rerender({ ...BASE, overview: overviewWith() });
      await settle();
    }

    expect(mockGetInsights).toHaveBeenCalledTimes(1);
  });

  it('regenerates once when the month actually changes', async () => {
    const { rerender, result } = renderHook(BASE);
    await settle();

    mockGetInsights.mockResolvedValue(answer('You spent on Beer.'));
    rerender({
      ...BASE,
      overview: overviewWith({ actualSpent: 47_748, expenses: [{ id: 'e1', amount: 2_748 }] as MonthlyOverview['expenses'] }),
    });
    await settle();

    expect(mockGetInsights).toHaveBeenCalledTimes(2);
    expect(result.current.insights?.summary).toBe('You spent on Beer.');
  });

  it('coalesces a burst of intermediate states into one generation', async () => {
    const { rerender } = renderHook(BASE);
    await settle();
    mockGetInsights.mockClear();

    // A sync burst walks the overview through five states inside the window.
    for (let spent = 1; spent <= 5; spent += 1) {
      rerender({ ...BASE, overview: overviewWith({ actualSpent: 45_000 + spent }) });
      act(() => {
        jest.advanceTimersByTime(100);
      });
    }
    await settle();

    expect(mockGetInsights).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous answer on screen while a new one is generated', async () => {
    const { rerender, result } = renderHook(BASE);
    await settle();

    let resolveSecond: (value: BudgetInsights) => void = () => {};
    mockGetInsights.mockReturnValue(
      new Promise<BudgetInsights>((resolve) => {
        resolveSecond = resolve;
      }),
    );
    rerender({ ...BASE, overview: overviewWith({ actualSpent: 90_000 }) });
    await settle();

    expect(result.current.loading).toBe(true);
    expect(result.current.insights?.summary).toBe('First read of the month.');

    await act(async () => {
      resolveSecond(answer('Second read.'));
      await Promise.resolve();
    });
    expect(result.current.insights?.summary).toBe('Second read.');
  });

  it('drops an answer that arrives after the member moved to another month', async () => {
    let resolveFirst: (value: BudgetInsights) => void = () => {};
    mockGetInsights.mockReturnValue(
      new Promise<BudgetInsights>((resolve) => {
        resolveFirst = resolve;
      }),
    );

    const { rerender, result } = renderHook(BASE);
    await settle();

    // Month nav lands on August before September's answer comes back.
    mockGetInsights.mockResolvedValue(answer('August.'));
    rerender({ ...BASE, month: 8 });
    await settle();

    await act(async () => {
      resolveFirst(answer('September — too late.'));
      await Promise.resolve();
    });

    expect(result.current.insights?.summary).toBe('August.');
  });

  it('reuses a month it already summarized when the member steps back to it', async () => {
    const { rerender } = renderHook(BASE);
    await settle();
    expect(mockGetInsights).toHaveBeenCalledTimes(1);

    mockGetInsights.mockResolvedValue(answer('August.'));
    rerender({ ...BASE, month: 8 });
    await settle();
    expect(mockGetInsights).toHaveBeenCalledTimes(2);

    rerender(BASE); // back to September — already known, same numbers
    await settle();
    expect(mockGetInsights).toHaveBeenCalledTimes(2);
  });

  it('does not re-ask a provider that just refused for the same month', async () => {
    mockGetInsights.mockRejectedValue(new Error('anthropic HTTP 401'));
    const { rerender } = renderHook(BASE);
    await settle();
    expect(mockGetInsights).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i += 1) {
      rerender({ ...BASE, overview: overviewWith() });
      await settle();
    }
    expect(mockGetInsights).toHaveBeenCalledTimes(1);
  });

  it('stays silent on an automatic failure and reports a manual one', async () => {
    const onRefreshError = jest.fn();
    mockGetInsights.mockRejectedValue(new Error('anthropic HTTP 500'));

    const { result } = renderHook({ ...BASE, onRefreshError });
    await settle();
    expect(onRefreshError).not.toHaveBeenCalled();

    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onRefreshError).toHaveBeenCalledTimes(1);
  });

  it('Refresh regenerates an unchanged month — the one deliberate override', async () => {
    const { result } = renderHook(BASE);
    await settle();
    expect(mockGetInsights).toHaveBeenCalledTimes(1);

    mockGetInsights.mockResolvedValue(answer('Freshly asked.'));
    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetInsights).toHaveBeenCalledTimes(2);
    expect(mockGetInsights).toHaveBeenLastCalledWith('hh-1', 2026, 9, true);
    expect(result.current.insights?.summary).toBe('Freshly asked.');
  });

  it('generates nothing before the month has loaded', async () => {
    renderHook({ ...BASE, overview: null });
    await settle();
    expect(mockGetInsights).not.toHaveBeenCalled();
  });

  it('generates nothing on a brand with no Insights card', async () => {
    renderHook({ ...BASE, enabled: false });
    await settle();
    expect(mockGetInsights).not.toHaveBeenCalled();
  });

  it('shares one generation between two views of the same month', async () => {
    let resolve: (value: BudgetInsights) => void = () => {};
    mockGetInsights.mockReturnValue(
      new Promise<BudgetInsights>((r) => {
        resolve = r;
      }),
    );

    const a = renderHook(BASE);
    const b = renderHook(BASE);
    await settle();

    expect(mockGetInsights).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(answer('Shared.'));
      await Promise.resolve();
    });
    expect(a.result.current.insights?.summary).toBe('Shared.');
    expect(b.result.current.insights?.summary).toBe('Shared.');
  });
});
