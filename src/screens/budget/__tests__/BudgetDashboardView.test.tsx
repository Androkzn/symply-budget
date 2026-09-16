jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

// Child cards + charts are stubbed so this suite focuses on the dashboard's own
// data-loading + rendering logic (their behaviour is covered by their own tests).
jest.mock('react-native-gifted-charts', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    PieChart: (p: Record<string, unknown>) => React.createElement(View, { testID: 'pie', ...p }),
    BarChart: (p: Record<string, unknown>) => React.createElement(View, { testID: 'bar', ...p }),
  };
});
jest.mock('../BudgetEncouragementBanner', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { BudgetEncouragementBanner: () => React.createElement(View, { testID: 'encouragement' }) };
});
jest.mock('../BudgetPlannedFitCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { BudgetPlannedFitCard: () => React.createElement(View, { testID: 'planned-fit' }) };
});

const mockGetMonthlyOverview = jest.fn();
const mockGetCategories = jest.fn();
const mockGetEncouragement = jest.fn();
const mockGetInsights = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    getMonthlyOverview: (...a: unknown[]) => mockGetMonthlyOverview(...a),
    getCategories: (...a: unknown[]) => mockGetCategories(...a),
    getEncouragement: (...a: unknown[]) => mockGetEncouragement(...a),
    getInsights: (...a: unknown[]) => mockGetInsights(...a),
  },
}));
jest.mock('@api/home-budget', () => ({
  homeBudgetApi: {
    getMonthlyOverview: (...a: unknown[]) => mockGetMonthlyOverview(...a),
    getGlance: jest.fn(),
  },
}));
jest.mock('@features/budget', () => ({
  isMinimalBudget: () => false,
}));

const mockGetSavingsOverview = jest.fn();
const mockGetSavingsTrend = jest.fn();
const mockGetSavingsProjection = jest.fn();
jest.mock('@api/savings', () => ({
  savingsApi: {
    getOverview: (...a: unknown[]) => mockGetSavingsOverview(...a),
    getTrend: (...a: unknown[]) => mockGetSavingsTrend(...a),
    getProjection: (...a: unknown[]) => mockGetSavingsProjection(...a),
  },
}));

// SavingsProjectionView imports its own labels for BudgetDashboardView to
// reuse — mocked here so this suite doesn't drag in the whole Projection tab.
jest.mock('../savings/SavingsProjectionView', () => ({
  PROJECTION_METHOD_LABELS: {
    historical_average: 'Recent Average',
    trend: 'Trend',
    planned_budget: 'Planned Budget',
    hybrid: 'Smart Blend',
  },
}));

let mockBudgetDataRevision = 0;
let mockCachedInsights: unknown = null;
let mockInsightsDirtyHids: Record<string, boolean> = {};
const mockCacheInsights = jest.fn();
const mockClearInsightsDirty = jest.fn();
const mockGetCachedInsights = jest.fn(() => mockCachedInsights);
jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      dataRevision: mockBudgetDataRevision,
      cacheInsights: mockCacheInsights,
      getCachedInsights: mockGetCachedInsights,
      insightsDirtyHids: mockInsightsDirtyHids,
      clearInsightsDirty: mockClearInsightsDirty,
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

let mockSavingsDataRevision = 0;
jest.mock('@stores/savingsStore', () => ({
  useSavingsStore: (sel?: (s: unknown) => unknown) => {
    const s = { dataRevision: mockSavingsDataRevision };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-test' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { MonthlyOverview } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';
import { budgetInsightsFingerprint } from '@features/budget/insights/budgetInsightsFingerprint';

import {
  BudgetDashboardView,
  buildCategorySpendingRows,
  buildDonutSlices,
  remainingDaysInMonth,
} from '../BudgetDashboardView';

const OVERVIEW = {
  year: 2026,
  month: 7,
  plannedBudget: 500000,
  actualSpent: 200000,
  committedTotal: 50000,
  remainingBudget: 250000,
  expenses: [
    { category_id: 'cat-food', amount: 120000 },
    { category_id: null, amount: 80000 },
  ],
};

const INSIGHTS = {
  summary: 'You are on track.',
  alerts: [
    { severity: 'critical', message: 'Over budget on food' },
    { severity: 'warning', message: 'Close to cap' },
    { severity: 'info', message: 'FYI note' },
  ],
  recommendations: ['Cook at home more'],
};

const SAVINGS = {
  netSavings: 300000,
  income: { total: 500000, bySource: { payroll: 500000 }, entries: [] },
};

const PROJECTION = {
  year: 2026,
  method: 'hybrid',
  projectedYearEnd: 4_200_000,
};

// Current-year cashflow (Jan → selected month): spending includes recurring,
// net = income − spending. March/June are deficits so the sign-coloring path is
// exercised. `monthlyPayments` is a flat $1,000/mo recurring baseline in every
// month; `spendings` makes up the rest of `spending` (spending = monthlyPayments
// + spendings), matching the split the backend's /trend endpoint returns.
const SAVINGS_TREND = {
  months: [
    { period: '2026-01', income: 1853100, spending: 2111100, monthlyPayments: 100000, spendings: 2011100, net: -258000, hasExpenseData: true },
    { period: '2026-02', income: 1851902, spending: 1792253, monthlyPayments: 100000, spendings: 1692253, net: 59649, hasExpenseData: true },
    { period: '2026-03', income: 2174344, spending: 2363211, monthlyPayments: 100000, spendings: 2263211, net: -188867, hasExpenseData: true },
    { period: '2026-04', income: 1836990, spending: 1757061, monthlyPayments: 100000, spendings: 1657061, net: 79929, hasExpenseData: true },
    { period: '2026-05', income: 3901287, spending: 2923841, monthlyPayments: 100000, spendings: 2823841, net: 977446, hasExpenseData: true },
    { period: '2026-06', income: 1960150, spending: 2699246, monthlyPayments: 100000, spendings: 2599246, net: -739096, hasExpenseData: true },
    { period: '2026-07', income: 1954686, spending: 817025, monthlyPayments: 100000, spendings: 717025, net: 1137661, hasExpenseData: true },
  ],
};

const onMonthChange = jest.fn();

async function renderDashboard(extraProps: Record<string, unknown> = {}) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetDashboardView
          year={2026}
          month={7}
          onMonthChange={onMonthChange}
          {...extraProps}
        />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

const dashText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

beforeEach(() => {
  jest.clearAllMocks();
  mockBudgetDataRevision = 0;
  mockSavingsDataRevision = 0;
  mockCachedInsights = null;
  mockInsightsDirtyHids = {};
  mockGetMonthlyOverview.mockResolvedValue(OVERVIEW);
  mockGetCategories.mockResolvedValue({ categories: [{ id: 'cat-food', name: 'Food', icon: '🍎', color: '#f00' }] });
  mockGetEncouragement.mockResolvedValue({ headline: 'Nice', body: 'Keep going', tone: 'positive' });
  mockGetInsights.mockResolvedValue(INSIGHTS);
  mockGetSavingsOverview.mockResolvedValue(SAVINGS);
  mockGetSavingsTrend.mockResolvedValue(SAVINGS_TREND);
  mockGetSavingsProjection.mockResolvedValue(PROJECTION);
});

describe('BudgetDashboardView — component', () => {
  it('loads and renders the overview, savings headroom, and insights', async () => {
    // The savings-headroom card only mounts when the screen is given an
    // `onOpenGoals` handler (full-Budget config); pass one so this test can
    // assert the card + its figures.
    const tree = await renderDashboard({ onOpenGoals: jest.fn() });
    expect(mockGetMonthlyOverview).toHaveBeenCalledWith('hh-test', 2026, 7);
    expect(tree.root.findAllByProps({ testID: 'budget-dashboard' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'budget-savings-headroom' }).length).toBeGreaterThan(0);
    const texts = dashText(tree);
    expect(texts).toContain('You are on track.');
    expect(texts).toContain('Over budget on food');
    expect(texts).toContain('Cook at home more');

    // The balance donut renders a center-label component — exercise it.
    const pieWithCenter = tree.root.findAll(
      (n) => n.props?.testID === 'pie' && typeof n.props?.centerLabelComponent === 'function'
    )[0];
    expect(pieWithCenter).toBeTruthy();
    const center = pieWithCenter.props.centerLabelComponent();
    expect(center).toBeTruthy();
  });

  it('shows the household-default projected year-end figure beside savings this month', async () => {
    const tree = await renderDashboard({ onOpenGoals: jest.fn() });
    expect(mockGetSavingsProjection).toHaveBeenCalledWith('hh-test', 2026);
    const stat = tree.root.findByProps({ testID: 'budget-savings-projected-year-end' });
    const texts = stat
      .findAll((n) => typeof n.props?.children === 'string')
      .map((n) => n.props.children as string);
    // $42,000.00 → the shared formatter rounds to whole dollars.
    expect(texts.join('')).toContain('42,000');
  });

  it('navigates months via the prev/next arrows', async () => {
    const tree = await renderDashboard();
    await act(async () => tree.root.findByProps({ testID: 'budget-month-prev' }).props.onPress());
    expect(onMonthChange).toHaveBeenCalledWith(2026, 6);
    await act(async () => tree.root.findByProps({ testID: 'budget-month-next' }).props.onPress());
    expect(onMonthChange).toHaveBeenCalledWith(2026, 8);
  });

  it('renders no quick-add CTA row — Home has no Planned/Spent/AI buttons', async () => {
    const tree = await renderDashboard();
    for (const testID of [
      'budget-dashboard-add-row',
      'budget-dashboard-add-planned',
      'budget-dashboard-add-spent',
      'budget-dashboard-add-ai',
    ]) {
      expect(tree.root.findAllByProps({ testID }).length).toBe(0);
    }
  });

  it('does not render a Savings goals link even when onOpenGoals is provided', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <BudgetDashboardView
            year={2026}
            month={7}
            onMonthChange={onMonthChange}
            onOpenGoals={jest.fn()}
          />
        </ThemeProvider>
      );
    });
    await act(async () => {
      for (let i = 0; i < 15; i += 1) await Promise.resolve();
    });
    expect(tree.root.findAllByProps({ testID: 'budget-dashboard-open-goals' }).length).toBe(0);
  });

  it('force-refreshes insights from the Refresh button', async () => {
    const tree = await renderDashboard();
    mockGetInsights.mockClear();
    await act(async () => {
      tree.root.findByProps({ testID: 'budget-insights-refresh' }).props.onPress();
      await Promise.resolve();
    });
    expect(mockGetInsights).toHaveBeenCalledWith('hh-test', 2026, 7, true);
  });

  // Insights are generated on-device from the member's own AI key on
  // local-first. The old copy claimed "need a connection" for every failure,
  // which is what an online member with a connected provider was shown when the
  // local API simply had no implementation. Refresh must now name the real
  // cause: a missing key, or whatever the provider actually said.
  it('alerts about a missing AI key when the local guard fires on Refresh', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const noKey = new Error('Budget local-first: "getInsights" is not available offline yet.');
    noKey.name = 'BudgetLocalUnsupportedError';
    mockGetInsights.mockRejectedValue(noKey);

    const tree = await renderDashboard();
    await act(async () => {
      tree.root.findByProps({ testID: 'budget-insights-refresh' }).props.onPress();
      await Promise.resolve();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Insights need your AI key',
      expect.stringContaining('Settings → AI Providers'),
    );
    alertSpy.mockRestore();
  });

  it('alerts with the provider reason when generation fails on Refresh', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetInsights.mockRejectedValue(new Error('anthropic HTTP 401: invalid x-api-key'));

    const tree = await renderDashboard();
    await act(async () => {
      tree.root.findByProps({ testID: 'budget-insights-refresh' }).props.onPress();
      await Promise.resolve();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Insights unavailable',
      expect.stringContaining('HTTP 401'),
    );
    alertSpy.mockRestore();
  });

  it('stays silent when an automatic insights refetch fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetInsights.mockRejectedValue(new Error('anthropic HTTP 500'));

    await renderDashboard();

    expect(mockGetInsights).toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  // The cache is scored against the month it was generated from: a cached
  // answer whose fingerprint still matches the overview on screen is reused,
  // and no model is asked. This is what stops the card rewriting itself.
  it('reuses a cached answer for an unchanged month without hitting the API', async () => {
    mockCachedInsights = {
      ...INSIGHTS,
      inputHash: budgetInsightsFingerprint(OVERVIEW as unknown as MonthlyOverview),
    };
    await renderDashboard();
    expect(mockGetInsights).not.toHaveBeenCalled();
    expect(dashText(await renderDashboard())).toContain('You are on track.');
  });

  it('regenerates when the cached answer belongs to different numbers', async () => {
    jest.useFakeTimers();
    try {
      mockCachedInsights = { ...INSIGHTS, inputHash: 'stale-fingerprint' };
      await renderDashboard();
      // Replacing an answer waits out the settling window (a sync burst walks
      // the month through several states); the first answer never does.
      expect(mockGetInsights).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(2_000);
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
      });
      expect(mockGetInsights).toHaveBeenCalledWith('hh-test', 2026, 7, false);
    } finally {
      jest.useRealTimers();
    }
  });

  // The dirty flag is now bookkeeping only — the fingerprint decides. Focus
  // clears it (so it can't pile up) but must not force a generation.
  it('clears the dirty flag on focus without forcing a generation', async () => {
    mockInsightsDirtyHids = { 'hh-test': true };
    mockCachedInsights = {
      ...INSIGHTS,
      inputHash: budgetInsightsFingerprint(OVERVIEW as unknown as MonthlyOverview),
    };
    await renderDashboard();
    expect(mockClearInsightsDirty).toHaveBeenCalledWith('hh-test');
    expect(mockGetInsights).not.toHaveBeenCalled();
  });

  it('hides the savings card on a 404 and keeps the dashboard', async () => {
    mockGetSavingsOverview.mockRejectedValue({ response: { status: 404 } });
    const tree = await renderDashboard();
    expect(tree.root.findAllByProps({ testID: 'budget-savings-headroom' }).length).toBe(0);
    expect(tree.root.findAllByProps({ testID: 'budget-dashboard' }).length).toBeGreaterThan(0);
  });

  it('logs (but does not crash) on a non-404 savings error', async () => {
    mockGetSavingsOverview.mockRejectedValue({ response: { status: 500 } });
    const tree = await renderDashboard();
    expect(tree.root.findAllByProps({ testID: 'budget-savings-headroom' }).length).toBe(0);
  });

  it('recovers when the overview + trend fail to load', async () => {
    mockGetMonthlyOverview.mockRejectedValue(new Error('boom'));
    const tree = await renderDashboard();
    // Overview + trend both swallow the failure — the dashboard still renders
    // (no crash) and, with no overview, shows no donut/pie chart.
    expect(tree.root.findAllByProps({ testID: 'budget-dashboard' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'pie' }).length).toBe(0);
  });

  it('recovers when the insights fetch fails', async () => {
    mockGetInsights.mockRejectedValue(new Error('boom'));
    const tree = await renderDashboard();
    expect(dashText(tree).some((t) => t.includes('No insights'))).toBe(true);
  });

  it('shows the encouragement banner failure as a no-op (null)', async () => {
    mockGetEncouragement.mockRejectedValue(new Error('boom'));
    const tree = await renderDashboard();
    expect(tree.root.findAllByProps({ testID: 'encouragement' }).length).toBe(0);
  });

  it('reloads on a budget data-revision bump', async () => {
    mockBudgetDataRevision = 3;
    await renderDashboard();
    // Focus effect + the dataRevision effect each load the overview.
    expect(mockGetMonthlyOverview.mock.calls.length).toBeGreaterThan(6);
  });

  it('drills into the aggregate Other row with the categories it folded', async () => {
    mockGetMonthlyOverview.mockResolvedValue({
      ...OVERVIEW,
      expenses: [
        { category_id: 'cat-1', amount: 6000 },
        { category_id: 'cat-2', amount: 5000 },
        { category_id: 'cat-3', amount: 4000 },
        { category_id: 'cat-4', amount: 3000 },
        { category_id: 'cat-5', amount: 2000 },
        { category_id: null, amount: 1000 },
      ],
    });
    mockGetCategories.mockResolvedValue({
      categories: [1, 2, 3, 4, 5].map((n) => ({
        id: `cat-${n}`,
        name: `Cat ${n}`,
        icon: '🍎',
        color: '#f00',
      })),
    });

    const onCategoryPress = jest.fn();
    const tree = await renderDashboard({ onCategoryPress });

    // The bucket is pressable like every other row (it renders a chevron too).
    const row = tree.root.find(
      (n) => n.props?.testID === 'budget-category-row-other' && typeof n.props?.onPress === 'function'
    );
    await act(async () => {
      row.props.onPress();
    });

    expect(onCategoryPress).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'other', categoryIds: ['cat-5', 'uncategorized'] })
    );
  });
});

describe('buildDonutSlices', () => {
  it('omits zero slices so PieChart never starts with value 0', () => {
    const slices = buildDonutSlices(0, 70_000, 70_000, '#teal', '#border');
    expect(slices).toEqual([{ value: 70_000, color: '#border' }]);
    expect(slices[0]?.value).toBeGreaterThan(0);
  });

  it('includes both slices when spent and remaining are positive', () => {
    expect(buildDonutSlices(20_000, 50_000, 70_000, '#teal', '#border')).toEqual([
      { value: 20_000, color: '#teal' },
      { value: 50_000, color: '#border' },
    ]);
  });

  it('falls back to planned budget when both spent and remaining are zero', () => {
    expect(buildDonutSlices(0, 0, 70_000, '#teal', '#border')).toEqual([
      { value: 70_000, color: '#border' },
    ]);
  });
});

describe('remainingDaysInMonth', () => {
  it('counts today as a remaining day in the current month', () => {
    // 12 Sep of a 30-day month: 12th…30th inclusive = 19 days, 63%.
    expect(remainingDaysInMonth(2026, 9, new Date(2026, 8, 12))).toEqual({
      days: 19,
      total: 30,
      percent: 63,
    });
  });

  it('never reaches zero while the month is still running', () => {
    expect(remainingDaysInMonth(2026, 9, new Date(2026, 8, 30))).toEqual({
      days: 1,
      total: 30,
      percent: 3,
    });
  });

  it('is the whole month on its first day (Feb is 28 in 2026)', () => {
    expect(remainingDaysInMonth(2026, 2, new Date(2026, 1, 1))).toEqual({
      days: 28,
      total: 28,
      percent: 100,
    });
  });

  it('is 0 (0%) for a month already over', () => {
    expect(remainingDaysInMonth(2026, 7, new Date(2026, 8, 12))).toEqual({
      days: 0,
      total: 31,
      percent: 0,
    });
    // Across a year boundary too — Dec 2026 seen from Jan 2027.
    expect(remainingDaysInMonth(2026, 12, new Date(2027, 0, 1)).days).toBe(0);
  });

  it('is the full month (100%) for a month not yet started', () => {
    expect(remainingDaysInMonth(2026, 10, new Date(2026, 8, 12))).toEqual({
      days: 31,
      total: 31,
      percent: 100,
    });
    // Jan 2027 seen from Dec 2026.
    expect(remainingDaysInMonth(2027, 1, new Date(2026, 11, 31)).percent).toBe(100);
  });
});

// Per-tab series mapping (netBarColor sign coloring, the spending/monthly flat
// series) is covered by `SavingsTrendChart.test.tsx` — this file only needs to
// prove the Home dashboard wires the SHARED chart in correctly.
describe('BudgetDashboardView — cashflow trend selector', () => {
  const withSavings = { onOpenGoals: jest.fn() };

  it('defaults to the Savings tab: shows the shared chart\'s tab strip and the accrued figure', async () => {
    const tree = await renderDashboard(withSavings);
    // Current-year window: Jan → the selected month (July) → span of 7.
    expect(mockGetSavingsTrend).toHaveBeenCalledWith('hh-test', 2026, 7, 7);
    // All three tabs present (the shared SavingsTrendChart's strip).
    expect(tree.root.findAllByProps({ testID: 'filter-tab-chart-savings' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'filter-tab-chart-spending' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'filter-tab-chart-monthly' }).length).toBeGreaterThan(0);
    const texts = dashText(tree);
    expect(texts).toContain('Cashflow trend');
    // Home renders its own header — the shared chart's own title is suppressed.
    expect(texts).not.toContain('Net savings trend');
    // Current-year window label (Jan → selected month), never a rolling window.
    expect(texts).toContain('Jan–Jul 2026');
    expect(texts).not.toContain('Last 6 months');
    // Savings accumulated so far this year (running sum of the net bars).
    expect(tree.root.findAllByProps({ testID: 'budget-trend-accrued' }).length).toBeGreaterThan(0);
    expect(texts).toContain('Saved so far');
    // Default tab renders the net series (Jan is a deficit month → negative bar).
    const bar = tree.root.findByProps({ testID: 'bar' });
    expect(bar.props.data[0].value).toBeCloseTo(-258000 / 100);
  });

  it('switches to the spendings series when the Spending tab is selected', async () => {
    const tree = await renderDashboard(withSavings);
    await act(async () => {
      tree.root.findByProps({ testID: 'filter-tab-chart-spending' }).props.onPress();
      await Promise.resolve();
    });
    const bar = tree.root.findByProps({ testID: 'bar' });
    // Jan spendings = 2011100c → $20,111.
    expect(bar.props.data[0].value).toBeCloseTo(2011100 / 100);
    // Budget spendings are never negative — every bar shares one flat color.
    const colors = new Set(bar.props.data.map((d: { frontColor: string }) => d.frontColor));
    expect(colors.size).toBe(1);
  });

  it('switches to the monthly-payments series when the Monthly tab is selected', async () => {
    const tree = await renderDashboard(withSavings);
    await act(async () => {
      tree.root.findByProps({ testID: 'filter-tab-chart-monthly' }).props.onPress();
      await Promise.resolve();
    });
    const bar = tree.root.findByProps({ testID: 'bar' });
    // Flat $1,000/mo baseline in every fixture month.
    for (const point of bar.props.data) {
      expect(point.value).toBeCloseTo(1000);
    }
  });

  it('falls back to the spending-only chart (no selector) when savings is unavailable', async () => {
    // No onOpenGoals → savings feature off → getTrend is never called.
    const tree = await renderDashboard();
    expect(mockGetSavingsTrend).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ testID: 'filter-tab-chart-savings' }).length).toBe(0);
    expect(tree.root.findAllByProps({ testID: 'budget-trend-accrued' }).length).toBe(0);
    expect(dashText(tree)).toContain('Spending trend');
  });

  it('falls back to spending-only when the trend endpoint 404s', async () => {
    mockGetSavingsTrend.mockRejectedValue({ response: { status: 404 } });
    const tree = await renderDashboard(withSavings);
    expect(tree.root.findAllByProps({ testID: 'filter-tab-chart-savings' }).length).toBe(0);
    expect(dashText(tree)).toContain('Spending trend');
  });
});

describe('buildCategorySpendingRows', () => {
  const categories = [
    { id: 'cat-garden', name: 'Garden', icon: '🌱', color: '#689F38' },
    { id: 'cat-food', name: 'Groceries', icon: '🛒', color: '#66BB6A' },
  ];

  it('returns empty array when there are no expenses', () => {
    expect(buildCategorySpendingRows([], categories, '#teal')).toEqual([]);
  });

  it('aggregates expenses by category and computes share', () => {
    const rows = buildCategorySpendingRows(
      [
        { category_id: 'cat-garden', amount: 3500 },
        { category_id: 'cat-food', amount: 5000 },
      ],
      categories,
      '#teal'
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe('Groceries');
    expect(rows[0]?.amount).toBe(5000);
    expect(rows[0]?.share).toBeCloseTo(5000 / 8500);
    expect(rows[1]?.name).toBe('Garden');
  });

  it('groups overflow categories into Other', () => {
    const rows = buildCategorySpendingRows(
      [
        { category_id: 'cat-garden', amount: 1000 },
        { category_id: 'cat-food', amount: 2000 },
        { category_id: 'cat-a', amount: 3000 },
        { category_id: 'cat-b', amount: 4000 },
        { category_id: 'cat-c', amount: 5000 },
        { category_id: 'cat-d', amount: 6000 },
      ],
      [
        ...categories,
        { id: 'cat-a', name: 'A', icon: 'A', color: '#111111' },
        { id: 'cat-b', name: 'B', icon: 'B', color: '#222222' },
        { id: 'cat-c', name: 'C', icon: 'C', color: '#333333' },
        { id: 'cat-d', name: 'D', icon: 'D', color: '#444444' },
      ],
      '#teal',
      5
    );

    expect(rows).toHaveLength(5);
    expect(rows[4]?.name).toBe('Other');
    expect(rows[4]?.amount).toBe(3000);
    // The bucket carries the ids it folded so the drill-down can rebuild it.
    expect(rows[4]?.categoryIds).toEqual(['cat-food', 'cat-garden']);
    // Rows that ARE a category are their own bucket — no id list.
    expect(rows[0]?.categoryIds).toBeUndefined();
  });
});
