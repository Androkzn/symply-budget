/**
 * BudgetDashboardView — full component render.
 *
 * Renders the real dashboard against the canonical MonthlyOverview +
 * SavingsOverview and asserts the balance card, savings-headroom card,
 * category-spending total and the planned-fit card all show the BE-computed
 * figures verbatim (using the same `formatBudgetCurrency` the screen uses).
 *
 * gifted-charts' PieChart/BarChart are stubbed to plain views (the PieChart
 * stub still invokes `centerLabelComponent` so the "Left" figure renders).
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useFocusEffect: (cb: () => (() => void) | void) => {
      React.useEffect(cb, []);
    },
  };
});

jest.mock('react-native-gifted-charts', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    PieChart: ({ centerLabelComponent }: { centerLabelComponent?: () => React.ReactNode }) =>
      React.createElement(
        View,
        { testID: 'pie-chart' },
        typeof centerLabelComponent === 'function' ? centerLabelComponent() : null
      ),
    BarChart: () => React.createElement(View, { testID: 'bar-chart' }),
  };
});

const mockGetMonthlyOverview = jest.fn();
const mockGetCategories = jest.fn();
const mockGetEncouragement = jest.fn();
const mockGetInsights = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    getMonthlyOverview: (...args: unknown[]) => mockGetMonthlyOverview(...args),
    getCategories: (...args: unknown[]) => mockGetCategories(...args),
    getEncouragement: (...args: unknown[]) => mockGetEncouragement(...args),
    getInsights: (...args: unknown[]) => mockGetInsights(...args),
  },
}));
jest.mock('@api/home-budget', () => ({
  homeBudgetApi: {
    getMonthlyOverview: (...args: unknown[]) => mockGetMonthlyOverview(...args),
    getGlance: jest.fn(),
  },
}));
jest.mock('@features/budget', () => ({
  isMinimalBudget: () => false,
}));

const mockGetOverview = jest.fn();
const mockGetProjection = jest.fn();
let mockSavingsRevision = 0;
jest.mock('@api/savings', () => ({
  PROJECTION_METHOD_LABELS: { hybrid: 'Base', historical_average: 'Cautious' },
  savingsApi: {
    getOverview: (...args: unknown[]) => mockGetOverview(...args),
    getProjection: (...args: unknown[]) => mockGetProjection(...args),
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-consistency' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      dataRevision: 0,
      cacheInsights: jest.fn(),
      getCachedInsights: () => null,
      insightsDirtyHids: {},
      clearInsightsDirty: jest.fn(),
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/savingsStore', () => ({
  useSavingsStore: (sel?: (s: unknown) => unknown) => {
    const s = { dataRevision: mockSavingsRevision };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import { StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { palette } from '@theme/colors';

import {
  CANONICAL_MONTH,
  CANONICAL_YEAR,
  collectRenderedText,
  makeCanonicalMonthlyOverview,
  makeCanonicalSavingsOverview,
} from '../../../test-utils/budgetConsistency';
import { BudgetDashboardView } from '../BudgetDashboardView';
import { formatBudgetCurrency } from '../budgetFormat';

const CATEGORIES = [
  { id: 'cat-food', household_id: 'hh-consistency', name: 'Groceries', icon: '🛒', color: '#66BB6A', sort_order: 0, created_at: '2026-07-01T00:00:00Z' },
  { id: 'cat-garden', household_id: 'hh-consistency', name: 'Garden', icon: '🌱', color: '#689F38', sort_order: 1, created_at: '2026-07-01T00:00:00Z' },
];

const DEFAULT_PROPS = {
  year: CANONICAL_YEAR,
  month: CANONICAL_MONTH,
  onMonthChange: jest.fn(),
  // Savings navigation is available: the screen only fetches savingsApi.getOverview
  // and renders the "Savings summary" card when onOpenGoals is provided.
  onOpenGoals: jest.fn(),
};

async function renderDashboard(
  props: React.ComponentProps<typeof BudgetDashboardView> = DEFAULT_PROPS
) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetDashboardView {...props} />
      </ThemeProvider>
    );
  });
  // Flush the focus-effect load() + savings headroom + insights microtasks.
  // Loop generously so the chained setState/re-render/effects all settle even
  // under the slower coverage-instrumented run.
  await act(async () => {
    for (let i = 0; i < 25; i += 1) {
      await Promise.resolve();
    }
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSavingsRevision = 0;
  mockGetProjection.mockResolvedValue(null);
  mockGetMonthlyOverview.mockResolvedValue(makeCanonicalMonthlyOverview());
  mockGetCategories.mockResolvedValue({ categories: CATEGORIES });
  mockGetEncouragement.mockResolvedValue(null);
  mockGetInsights.mockResolvedValue({
    summary: 'Looking good this month.',
    alerts: [],
    recommendations: [],
    projected_month_end_balance: 100000,
    generatedAt: '2026-07-15T00:00:00Z',
    cached: false,
  });
  mockGetOverview.mockResolvedValue(makeCanonicalSavingsOverview());
});

describe('BudgetDashboardView — data loading', () => {
  it('fetches the overview for the selected household / year / month', async () => {
    await renderDashboard();
    expect(mockGetMonthlyOverview).toHaveBeenCalledWith('hh-consistency', 2026, 7);
    expect(mockGetOverview).toHaveBeenCalledWith('hh-consistency', 2026, 7);
  });

  it('mounts the dashboard content (loading spinner cleared)', async () => {
    const tree = await renderDashboard();
    expect(tree.root.findAllByProps({ testID: 'budget-dashboard-loading' }).length).toBe(0);
    expect(tree.root.findByProps({ testID: 'budget-dashboard' })).toBeTruthy();
  });

  it('keeps the month nav mounted but hides the add row while the content spinner shows', async () => {
    // A pending overview keeps isLoading=true so we observe the loading render.
    let resolveOverview: (v: unknown) => void = () => {};
    mockGetMonthlyOverview.mockReturnValue(
      new Promise((resolve) => {
        resolveOverview = resolve;
      })
    );

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <BudgetDashboardView {...DEFAULT_PROPS} />
        </ThemeProvider>
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Spinner confined to the main content area…
    expect(tree.root.findAllByProps({ testID: 'budget-dashboard-loading' }).length).toBeGreaterThanOrEqual(1);
    // …the month nav stays statically mounted…
    expect(tree.root.findByProps({ testID: 'budget-dashboard' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'budget-month-prev' })).toBeTruthy();
    // …and the Home tab carries no quick-add CTA row at all (Planned / Spent /
    // AI live on the Planning and Spending tabs).
    expect(tree.root.findAllByProps({ testID: 'budget-dashboard-add-row' }).length).toBe(0);

    // Settle the pending fetch to avoid act warnings.
    await act(async () => {
      resolveOverview(makeCanonicalMonthlyOverview());
      for (let i = 0; i < 25; i += 1) {
        await Promise.resolve();
      }
    });
  });
});

describe('BudgetDashboardView — balance card', () => {
  it('renders budget / spent / committed / remaining figures verbatim', async () => {
    const tree = await renderDashboard();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('$3,000'); // plannedBudget 300000
    expect(texts).toContain('$1,600'); // actualSpent 160000
    expect(texts).toContain('$400'); // committedTotal 40000
    expect(texts).toContain('$1,000'); // remainingBudget 100000
  });

  it('renders every balance-card LABEL', async () => {
    const tree = await renderDashboard();
    const texts = collectRenderedText(tree);
    for (const label of ['Left', 'Budget', 'Spent', 'Committed', 'Remaining', 'Remaining days']) {
      expect(texts).toContain(label);
    }
  });

  describe('remaining days row', () => {
    // Pin "now" inside the canonical month (July 2026, 31 days) so the figure
    // is deterministic: the 12th…31st inclusive = 20 days = 65%.
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2026, 6, 12, 9, 0, 0));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('shows the days left in the selected month with their share, in orange', async () => {
      const tree = await renderDashboard();
      expect(collectRenderedText(tree)).toContain('20 (65%)');
      // The host <Text> carrying the testID (the BalanceRow composite matches
      // the same testID prop but holds no children/style of its own).
      const [text] = tree.root.findAll(
        (n) => n.props.testID === 'budget-dashboard-remaining-days' && typeof n.type === 'string'
      );
      expect(text).toBeTruthy();
      // Orange — `colors.orange` is the semantic warning token in light mode —
      // not the default text colour.
      expect(StyleSheet.flatten(text.props.style).color).toBe(palette.semantic.warning);
    });

    it('reads 0 (0%) for a month already over', async () => {
      jest.setSystemTime(new Date(2026, 8, 12, 9, 0, 0)); // Sep 2026 looking at Jul
      const tree = await renderDashboard();
      expect(collectRenderedText(tree)).toContain('0 (0%)');
    });
  });
});

describe('BudgetDashboardView — savings summary card', () => {
  it('renders the BE-computed net savings', async () => {
    const tree = await renderDashboard();
    expect(tree.root.findByProps({ testID: 'budget-savings-headroom' })).toBeTruthy();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('$5,400'); // netSavings 540000 (= 900000 − 200000 − 160000)
    // …and every label on the card.
    for (const label of ['Savings summary', 'Savings this month']) {
      expect(texts).toContain(label);
    }
  });

  it('hides the savings summary card when savings is disabled (404)', async () => {
    mockGetOverview.mockRejectedValue({ response: { status: 404 } });
    const tree = await renderDashboard();
    expect(tree.root.findAllByProps({ testID: 'budget-savings-headroom' }).length).toBe(0);
  });

  it('prompts to add income instead of showing negative savings when no income is logged', async () => {
    const noIncomeOverview = makeCanonicalSavingsOverview();
    noIncomeOverview.income.total = 0;
    noIncomeOverview.income.bySource = {};
    noIncomeOverview.income.entries = [];
    noIncomeOverview.netSavings = -noIncomeOverview.spending.total;
    mockGetOverview.mockResolvedValue(noIncomeOverview);

    const onAddIncome = jest.fn();
    const tree = await renderDashboard({ ...DEFAULT_PROPS, onAddIncome });
    const texts = collectRenderedText(tree);

    // No scary negative dollar figure — the netSavings figure is meaningless
    // without any income logged.
    expect(texts).not.toContain(formatBudgetCurrency(noIncomeOverview.netSavings));
    expect(texts).toContain(
      'Add your income for July to see your savings for this month.'
    );
    expect(texts).toContain('Add income');

    const addIncomeButton = tree.root.findByProps({
      testID: 'budget-savings-add-income',
    });
    expect(addIncomeButton).toBeTruthy();
    act(() => addIncomeButton.props.onPress());
    expect(onAddIncome).toHaveBeenCalledTimes(1);
  });
});

describe('BudgetDashboardView — category spending', () => {
  it('shows the category-spending total equal to actualSpent', async () => {
    const tree = await renderDashboard();
    const texts = collectRenderedText(tree);
    // Category card header total mirrors actualSpent ($1,600) and the two
    // categories with recorded spend are named.
    expect(texts).toContain('$1,600');
    expect(texts).toContain('Groceries');
    expect(texts).toContain('Garden');
  });
});

describe('BudgetDashboardView — CTA callbacks', () => {
  it('renders no quick-add CTAs once the month has loaded', async () => {
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

  it('steps the month back and forward via the header arrows', async () => {
    const onMonthChange = jest.fn();
    const tree = await renderDashboard({ ...DEFAULT_PROPS, onMonthChange });
    act(() => tree.root.findByProps({ testID: 'budget-month-prev' }).props.onPress());
    expect(onMonthChange).toHaveBeenLastCalledWith(2026, 6);
    act(() => tree.root.findByProps({ testID: 'budget-month-next' }).props.onPress());
    expect(onMonthChange).toHaveBeenLastCalledWith(2026, 8);
  });
});

it('refreshes Home with the shared scenario after Savings invalidation', async () => {
  mockGetProjection.mockResolvedValue({ year: CANONICAL_YEAR, method: 'hybrid', projectedYearEnd: 3_160_285 });
  const tree = await renderDashboard();
  expect(collectRenderedText(tree)).toContain(formatBudgetCurrency(3_160_285));
  mockGetProjection.mockResolvedValue({ year: CANONICAL_YEAR, method: 'historical_average', projectedYearEnd: 939_881 });
  mockSavingsRevision += 1;
  await act(async () => {
    tree.update(<ThemeProvider><BudgetDashboardView {...DEFAULT_PROPS} /></ThemeProvider>);
  });
  expect(mockGetProjection).toHaveBeenLastCalledWith('hh-consistency', CANONICAL_YEAR);
  expect(collectRenderedText(tree)).toContain(formatBudgetCurrency(939_881));
  expect(collectRenderedText(tree)).not.toContain(formatBudgetCurrency(3_160_285));
});

it('shows alerts and recommendations without an empty summary or failure card', async () => {
  mockGetInsights.mockResolvedValue({
    summary: '', alerts: [{ severity: 'info', message: 'Spending is concentrated in groceries.' }],
    recommendations: ['Review the grocery budget.'], projected_month_end_balance: 10000,
    generatedAt: '2026-08-01T00:00:00Z', cached: false,
  });
  const tree = await renderDashboard();
  const text = collectRenderedText(tree);
  expect(text).toContain('Spending is concentrated in groceries.');
  expect(text).toContain('Review the grocery budget.');
  expect(tree.root.findAllByProps({ testID: 'budget-insights-summary' })).toHaveLength(0);
  expect(tree.root.findAllByProps({ testID: 'budget-insights-empty' })).toHaveLength(0);
});
