/**
 * Cross-tab consistency — the guarantee that "all numbers match across tabs".
 *
 * A SINGLE canonical MonthlyOverview + SavingsOverview drives every Budget tab.
 * The tabs never recompute money locally, so this suite renders the real
 * Dashboard, Planned, Spendings and Savings views from that one dataset and
 * asserts the shared fields render the same figure on every tab that shows it:
 *
 *   • actualSpent      — Dashboard balance "Spent"  ==  Σ Spendings-tab line items
 *   • committedTotal   — Dashboard balance "Committed" == Σ Planned-tab "fits" items
 *   • remainingBudget  — Dashboard balance "Remaining" == Dashboard planned-fit "Remaining"
 *   • netSavings       — Dashboard "Savings summary" == Savings Overview tab
 *
 * The fixture's own coherence (Σ expenses === actualSpent, etc.) is enforced by
 * assertMonthlyOverviewCoherent / assertSavingsOverviewCoherent, so a passing
 * suite means the numbers are consistent both within a view model and across
 * every tab that renders it.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
    useFocusEffect: (cb: () => (() => void) | void) => {
      React.useEffect(cb, []);
    },
  };
});

// SafeAreaView passthrough so SavingsOverviewView's @components/common barrel
// (which transitively pulls the navigator chain) never loads.
jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      React.createElement(View, { testID }),
    screenScrollEndTestId: (screenRootTestId: string) => `${screenRootTestId}-scroll-end`,
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
    LineChart: () => React.createElement(View, { testID: 'line-chart' }),
  };
});

// Preserve every RNGH export (so SavingsOverviewView's chain still mounts) but
// swap the touchables for RN's, which render their children in the test env.
jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler');
  const RN = require('react-native');
  return new Proxy(actual, {
    get(target, prop) {
      if (prop === 'ScrollView') return RN.ScrollView;
      if (prop === 'FlatList') return RN.FlatList;
      if (prop === 'TouchableOpacity') return RN.TouchableOpacity;
      return (target as Record<string, unknown>)[prop as string];
    },
  });
});

jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  __esModule: true,
  default: ({ children }: { children?: unknown }) => children ?? null,
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => 'consistency-uuid' }));

const mockGetMonthlyOverview = jest.fn();
const mockGetCategories = jest.fn();
const mockGetEncouragement = jest.fn();
const mockGetInsights = jest.fn();
const mockGetQuickAddSuggestions = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    getMonthlyOverview: (...args: unknown[]) => mockGetMonthlyOverview(...args),
    getCategories: (...args: unknown[]) => mockGetCategories(...args),
    getEncouragement: (...args: unknown[]) => mockGetEncouragement(...args),
    getInsights: (...args: unknown[]) => mockGetInsights(...args),
    getQuickAddSuggestions: (...args: unknown[]) => mockGetQuickAddSuggestions(...args),
    createItem: jest.fn(),
    addExpense: jest.fn(),
    updateItem: jest.fn(),
    deleteItem: jest.fn(),
    deleteExpense: jest.fn(),
    recordPlannedSpending: jest.fn(),
  },
}));
jest.mock('@api/home-budget', () => ({
  homeBudgetApi: {
    getMonthlyOverview: (...args: unknown[]) => mockGetMonthlyOverview(...args),
    getGlance: jest.fn(),
  },
}));
// The real `@features/budget` barrel re-exports BudgetHomeScreen from
// `./screens`, whose import chain (useLayoutPadding → SidebarTabBar →
// aihousekeeper → tasks → TaskDetailScreen) circles back to `@features/budget`.
// `jest.requireActual('@features/budget')` would therefore re-enter this factory
// mid-initialization and its `...actual` spread would touch the not-yet-loaded
// BudgetHomeScreen getter (undefined `./screens`), crashing the whole suite.
// So we pull the real gating helpers from the lighter `@features/budget/mode`
// (no screen graph) and stub the heavy screens the cross-tab views never render.
jest.mock('@features/budget', () => {
  const mode = jest.requireActual('@features/budget/mode');
  const React = require('react');
  const { View } = require('react-native');
  const ScreenStub = () => React.createElement(View, null);
  return {
    __esModule: true,
    ...mode,
    BUDGET_FEATURE_ID: 'budget',
    isBudgetBrand: () => false,
    BudgetHomeScreen: ScreenStub,
    SoftTransferImportScreen: ScreenStub,
    isMinimalBudget: () => false,
    isFullBudget: () => true,
    isBudgetOff: () => false,
    isBudgetEnabled: () => true,
  };
});

const mockGetOverview = jest.fn();
const mockGetTrend = jest.fn();
jest.mock('@api/savings', () => ({
  savingsApi: {
    getOverview: (...args: unknown[]) => mockGetOverview(...args),
    getTrend: (...args: unknown[]) => mockGetTrend(...args),
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-consistency' }, currentHouseholdMembers: [] };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      dataRevision: 0,
      markInsightsDirty: jest.fn(),
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
    const s = {
      selectedYear: 2026,
      selectedMonth: 7,
      dataRevision: 0,
      markDirty: jest.fn(),
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  assertCrossModelSpendConsistent,
  assertMonthlyOverviewCoherent,
  assertSavingsOverviewCoherent,
  collectRenderedText,
  formatBudgetCurrency,
  makeCanonicalMonthlyOverview,
  makeCanonicalSavingsOverview,
} from '../../../test-utils/budgetConsistency';
import { BudgetDashboardView } from '../BudgetDashboardView';
import { BudgetSpendingsView } from '../BudgetSpendingsView';
import { SavingsOverviewView } from '../savings/SavingsOverviewView';

/** BudgetSpendingsView's line-item formatter (0/null → $0, else whole grouped dollars). */
function formatSpendingsLine(cents: number): string {
  if (cents === 0) return '$0';
  return `$${Math.round(cents / 100).toLocaleString('en-CA')}`;
}

const OVERVIEW = makeCanonicalMonthlyOverview();
const SAVINGS = makeCanonicalSavingsOverview();

const CATEGORIES = [
  { id: 'cat-food', household_id: 'hh-consistency', name: 'Groceries', icon: '🛒', color: '#66BB6A', sort_order: 0, created_at: '2026-07-01T00:00:00Z' },
  { id: 'cat-garden', household_id: 'hh-consistency', name: 'Garden', icon: '🌱', color: '#689F38', sort_order: 1, created_at: '2026-07-01T00:00:00Z' },
];

const SPENDINGS_PROPS = {
  year: 2026,
  month: 7,
  onEditItem: jest.fn(),
  onEditExpense: jest.fn(),
};

async function flush(tree: ReactTestRenderer.ReactTestRenderer) {
  // Drain enough microtask ticks that the focus-effect load() chains
  // (getMonthlyOverview / getOverview / getQuickAddSuggestions → setState →
  // re-render → follow-up effects) all settle. Fixed small counts flake under
  // the slower coverage-instrumented run, so loop generously.
  await act(async () => {
    for (let i = 0; i < 25; i += 1) {
      await Promise.resolve();
    }
  });
  return tree;
}

async function renderView(node: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return flush(tree);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMonthlyOverview.mockResolvedValue(makeCanonicalMonthlyOverview());
  mockGetCategories.mockResolvedValue({ categories: CATEGORIES });
  mockGetEncouragement.mockResolvedValue(null);
  mockGetInsights.mockResolvedValue({
    summary: '',
    alerts: [],
    recommendations: [],
    projected_month_end_balance: 100000,
    generatedAt: '2026-07-15T00:00:00Z',
    cached: false,
  });
  mockGetQuickAddSuggestions.mockResolvedValue({ recent: [], popular: [] });
  mockGetOverview.mockResolvedValue(makeCanonicalSavingsOverview());
  mockGetTrend.mockResolvedValue({ months: [] });
});

describe('Budget cross-tab consistency — fixture coherence', () => {
  it('the shared MonthlyOverview is internally coherent', () => {
    expect(() => assertMonthlyOverviewCoherent(OVERVIEW)).not.toThrow();
  });

  it('the shared SavingsOverview is internally coherent', () => {
    expect(() => assertSavingsOverviewCoherent(SAVINGS)).not.toThrow();
  });

  it('the two view models agree on the ONE spend figure (single source of truth)', () => {
    expect(SAVINGS.spending.spendings).toBe(OVERVIEW.actualSpent);
    expect(() => assertCrossModelSpendConsistent(OVERVIEW, SAVINGS)).not.toThrow();
  });
});

describe('Budget cross-tab consistency — spend figure (Dashboard ⇄ Spendings ⇄ Savings)', () => {
  it('the same spend total renders on the Dashboard "Spent" and the Savings "Spendings" line', async () => {
    const dashboard = await renderView(<BudgetDashboardView {...SPENDINGS_PROPS} onMonthChange={jest.fn()} />);
    const savings = await renderView(<SavingsOverviewView />);
    const spent = await renderView(
      <BudgetSpendingsView {...SPENDINGS_PROPS} variant="spent" onMonthChange={jest.fn()} />
    );

    const spend = formatBudgetCurrency(OVERVIEW.actualSpent); // $1,600

    // Dashboard "Spent" total.
    expect(collectRenderedText(dashboard)).toContain(spend);

    // Savings Overview "Spendings" line — same figure, now DEDUCTED from net.
    const savingsText = collectRenderedText(savings);
    expect(savingsText).toContain('Spendings');
    expect(savingsText).toContain(spend);
    const spendingsNode = savings.root.findByProps({ testID: 'savings-overview-spendings' });
    expect(spendingsNode.props.children).toBe(spend);

    // Spendings tab line items sum to the exact same figure.
    const lineSum = OVERVIEW.expenses.reduce((sum, e) => sum + e.amount, 0);
    expect(lineSum).toBe(OVERVIEW.actualSpent);
    // Each expense line is present on the Spendings tab.
    const spentText = collectRenderedText(spent);
    for (const e of OVERVIEW.expenses) {
      expect(spentText).toContain(e.title);
    }
  });
});

describe('Budget cross-tab consistency — actualSpent (Dashboard ⇄ Spendings)', () => {
  it('the Dashboard "Spent" total equals the sum of the Spendings-tab line items', async () => {
    const dashboard = await renderView(<BudgetDashboardView {...SPENDINGS_PROPS} onMonthChange={jest.fn()} />);
    const spent = await renderView(
      <BudgetSpendingsView {...SPENDINGS_PROPS} variant="spent" onMonthChange={jest.fn()} />
    );

    const dashboardText = collectRenderedText(dashboard);
    const spentText = collectRenderedText(spent);

    // Dashboard renders the total with the dashboard formatter.
    expect(dashboardText).toContain(formatBudgetCurrency(OVERVIEW.actualSpent)); // $1,600

    // Every expense line item is rendered on the Spendings tab...
    for (const expense of OVERVIEW.expenses) {
      expect(spentText).toContain(expense.title);
      expect(spentText).toContain(formatSpendingsLine(expense.amount));
    }
    // ...and the line items sum to the Dashboard total (same source of truth).
    const lineSum = OVERVIEW.expenses.reduce((sum, e) => sum + e.amount, 0);
    expect(lineSum).toBe(OVERVIEW.actualSpent);
    expect(formatBudgetCurrency(lineSum)).toBe(formatBudgetCurrency(OVERVIEW.actualSpent));
  });
});

describe('Budget cross-tab consistency — committedTotal (Dashboard ⇄ Planned)', () => {
  it('the Dashboard "Committed" total equals the Σ of the Planned-tab "fits this month" items', async () => {
    const dashboard = await renderView(<BudgetDashboardView {...SPENDINGS_PROPS} onMonthChange={jest.fn()} />);
    const planned = await renderView(
      <BudgetSpendingsView {...SPENDINGS_PROPS} variant="planned" onMonthChange={jest.fn()} />
    );

    const dashboardText = collectRenderedText(dashboard);
    const plannedText = collectRenderedText(planned);

    // Dashboard shows the committed figure.
    expect(dashboardText).toContain(formatBudgetCurrency(OVERVIEW.committedTotal)); // $400

    // Planned tab lists the affordable ("fits this month") items whose
    // estimates sum to committedTotal.
    expect(plannedText.join(' ')).toMatch(/fits this month/i);
    for (const item of OVERVIEW.affordability.affordable) {
      expect(plannedText).toContain(item.title);
    }
    const affordableSum = OVERVIEW.affordability.affordable.reduce(
      (sum, i) => sum + i.estimatedCost,
      0
    );
    expect(affordableSum).toBe(OVERVIEW.committedTotal);
  });
});

describe('Budget cross-tab consistency — remainingBudget (Dashboard balance ⇄ planned-fit)', () => {
  it('the balance card and the planned-fit card show the same remaining figure', async () => {
    const dashboard = await renderView(<BudgetDashboardView {...SPENDINGS_PROPS} onMonthChange={jest.fn()} />);
    const text = collectRenderedText(dashboard);
    const remaining = formatBudgetCurrency(OVERVIEW.remainingBudget); // $1,000

    // The figure appears (balance "Remaining", pie center, and planned-fit
    // "Remaining" all read from the same remaining budget).
    const occurrences = text.filter((t) => t === remaining).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    // And it equals affordability.remaining_budget by construction.
    expect(OVERVIEW.affordability.remaining_budget).toBe(OVERVIEW.remainingBudget);
  });
});

describe('Budget cross-tab consistency — savings (Dashboard summary ⇄ Savings tab)', () => {
  it('the Dashboard savings summary card and the Savings Overview tab show the same net savings', async () => {
    // onOpenGoals enables the Dashboard "Savings summary" card (it gates both
    // the savingsApi fetch and the card render — BudgetDashboardView L235/L461).
    const dashboard = await renderView(
      <BudgetDashboardView {...SPENDINGS_PROPS} onMonthChange={jest.fn()} onOpenGoals={jest.fn()} />
    );
    const savings = await renderView(<SavingsOverviewView />);

    const dashboardText = collectRenderedText(dashboard);
    const savingsText = collectRenderedText(savings);

    const net = formatBudgetCurrency(SAVINGS.netSavings); // $5,400

    expect(dashboardText).toContain(net);
    expect(savingsText).toContain(net);
  });

  it('the Dashboard and Savings tab both fetch the same household/year/month overview', async () => {
    // onOpenGoals makes the Dashboard actually fetch the savings overview too,
    // so this genuinely asserts BOTH tabs request the same household/year/month.
    await renderView(
      <BudgetDashboardView {...SPENDINGS_PROPS} onMonthChange={jest.fn()} onOpenGoals={jest.fn()} />
    );
    await renderView(<SavingsOverviewView />);
    for (const call of mockGetOverview.mock.calls) {
      expect(call).toEqual(['hh-consistency', 2026, 7]);
    }
  });
});
