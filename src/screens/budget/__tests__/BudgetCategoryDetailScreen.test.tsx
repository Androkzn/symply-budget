/**
 * BudgetCategoryDetailScreen — the per-category product-trends drill-down.
 * Drives every top-level branch of the screen:
 *   • loading spinner while the fetch is pending
 *   • the fetch itself (route params + store period → budgetApi args)
 *   • dataRevision-triggered reload
 *   • populated: summary total, month-over-month delta pill, category trend
 *     bars, the per-product rows (up / down / new / flat trends, currency +
 *     fractional-cents formatting, current-count caption variants), footnote
 *   • empty-products state (with data) and the no-household early return
 *   • the fetch-failure error branch
 *   • the header back button
 *   • the negative-delta (spending fell) summary variant
 *
 * Navigation hooks are imported from `expo-router/react-navigation`, which the
 * Jest config remaps to `@react-navigation/native`, so the mock below actually
 * intercepts the screen's useNavigation/useRoute/useFocusEffect.
 */
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockNav = { navigate: mockNavigate, goBack: mockGoBack };

let mockParams: Record<string, unknown> = { categoryId: 'cat-food', categoryName: 'Groceries' };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockParams }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenHeader: ({
      title,
      showBackButton,
      onBackPress,
    }: {
      title?: string;
      showBackButton?: boolean;
      onBackPress?: () => void;
    }) =>
      React.createElement(
        View,
        null,
        title ? React.createElement(Text, null, title) : null,
        showBackButton
          ? React.createElement(TouchableOpacity, {
              onPress: onBackPress,
              testID: 'nav-back-button',
            })
          : null
      ),
  };
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const mockGetCategoryProductTrends = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    getCategoryProductTrends: (...args: unknown[]) => mockGetCategoryProductTrends(...args),
  },
}));

let mockHousehold: { id: string } | null = { id: 'hh-test' };
jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: mockHousehold };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

let mockBudgetState: { selectedYear: number; selectedMonth: number; dataRevision: number } = {
  selectedYear: 2026,
  selectedMonth: 7,
  dataRevision: 0,
};
jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (sel?: (s: unknown) => unknown) =>
    typeof sel === 'function' ? sel(mockBudgetState) : mockBudgetState,
}));

jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { CategoryProductTrend, CategoryProductTrends } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../test-utils/budgetConsistency';
import { BudgetCategoryDetailScreen } from '../BudgetCategoryDetailScreen';

const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];

function makeProduct(overrides: Partial<CategoryProductTrend> & Pick<CategoryProductTrend, 'name'>): CategoryProductTrend {
  return {
    total: 0,
    count: 0,
    currentAmount: 0,
    currentCount: 0,
    previousAmount: 0,
    averageAmount: 0,
    trend: 'flat',
    byMonth: MONTHS.map((month, i) => ({ month, amount: i === MONTHS.length - 1 ? 1000 : 0, count: 0 })),
    ...overrides,
  };
}

// Prices are all < $1,000 so formatMoney never groups — assertions stay exact
// regardless of the runtime's locale/ICU. `bread` uses 750 cents to pin the
// fractional-cents branch ("$7.50").
const TRENDS: CategoryProductTrends = {
  categoryId: 'cat-food',
  categoryName: 'Groceries',
  months: MONTHS,
  monthlyTotals: [12000, 20000, 15000, 25000, 60000, 84000],
  currentMonthTotal: 84000, // "$840"
  previousMonthTotal: 60000, // delta = +24000 → "+$240 vs Jun"
  products: [
    makeProduct({
      name: 'milk',
      trend: 'up',
      currentAmount: 5000, // "$50"
      previousAmount: 3000, // delta label "+$20"
      currentCount: 3, // "3× this month · avg $40/mo"
      averageAmount: 4000,
      byMonth: [
        { month: MONTHS[0], amount: 1000, count: 1 },
        { month: MONTHS[1], amount: 0, count: 0 }, // zero-amount sparkline bar
        { month: MONTHS[2], amount: 2000, count: 1 },
        { month: MONTHS[3], amount: 3000, count: 1 },
        { month: MONTHS[4], amount: 4000, count: 1 },
        { month: MONTHS[5], amount: 5000, count: 3 }, // current
      ],
    }),
    makeProduct({
      name: 'eggs',
      trend: 'down',
      currentAmount: 2000, // "$20"
      previousAmount: 4000, // delta label "-$20"
      currentCount: 1, // "1× this month · avg $30/mo"
      averageAmount: 3000,
    }),
    makeProduct({
      name: 'bread',
      trend: 'new',
      currentAmount: 1500, // "$15"
      previousAmount: 0,
      currentCount: 2, // "2× this month · avg $7.50/mo" (fractional)
      averageAmount: 750,
    }),
    makeProduct({
      name: 'coffee',
      trend: 'flat',
      currentAmount: 1000, // "$10"
      previousAmount: 1000,
      currentCount: 0, // "avg $10/mo" (no count prefix)
      averageAmount: 1000,
    }),
  ],
};

const EMPTY_WITH_DATA: CategoryProductTrends = {
  categoryId: 'cat-food',
  categoryName: 'Groceries',
  months: MONTHS,
  monthlyTotals: [0, 0, 0, 0, 0, 0],
  currentMonthTotal: 0,
  previousMonthTotal: 0, // no delta pill
  products: [],
};

/**
 * Joined string/number children per node — captures multi-expression labels
 * (e.g. `{month} {year} spending`) that `collectRenderedText` (string-only
 * children) can't see as a single node.
 */
function nodeTexts(tree: ReactTestRenderer.ReactTestRenderer): string[] {
  return tree.root.findAll(() => true).map((n) => {
    const c = n.props?.children;
    if (Array.isArray(c)) {
      return c
        .map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x) : ''))
        .join('');
    }
    if (typeof c === 'string' || typeof c === 'number') return String(c);
    return '';
  });
}

const byTestID = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id);

async function flush() {
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetCategoryDetailScreen />
      </ThemeProvider>
    );
  });
  await flush();
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { categoryId: 'cat-food', categoryName: 'Groceries' };
  mockHousehold = { id: 'hh-test' };
  mockBudgetState = { selectedYear: 2026, selectedMonth: 7, dataRevision: 0 };
  mockGetCategoryProductTrends.mockResolvedValue(TRENDS);
});

describe('BudgetCategoryDetailScreen — loading & fetch', () => {
  it('shows the loading spinner while the fetch is pending', async () => {
    mockGetCategoryProductTrends.mockReturnValue(new Promise(() => {}));
    const tree = await renderScreen();
    expect(byTestID(tree, 'budget-category-detail-loading').length).toBeGreaterThanOrEqual(1);
    // Content cards are absent while loading.
    expect(byTestID(tree, 'budget-category-summary')).toHaveLength(0);
  });

  it('fetches the category trends for the route category + store period, once', async () => {
    await renderScreen();
    expect(mockGetCategoryProductTrends).toHaveBeenCalledWith('hh-test', 'cat-food', 2026, 7, 6);
    // dataRevision === 0 → the revision effect is a no-op, so only the focus
    // effect fetches.
    expect(mockGetCategoryProductTrends).toHaveBeenCalledTimes(1);
  });

  it('reloads once more when the budget dataRevision is bumped', async () => {
    mockBudgetState = { selectedYear: 2026, selectedMonth: 7, dataRevision: 5 };
    await renderScreen();
    // Focus effect + revision effect both fire on mount when dataRevision > 0.
    expect(mockGetCategoryProductTrends).toHaveBeenCalledTimes(2);
  });
});

describe('BudgetCategoryDetailScreen — populated', () => {
  it('renders the header title and month-labeled summary total', async () => {
    const tree = await renderScreen();
    expect(collectRenderedText(tree)).toContain('Groceries');
    expect(nodeTexts(tree)).toContain('Jul 2026 spending');
    expect(collectRenderedText(tree)).toContain('$840'); // currentMonthTotal
  });

  it('renders the positive month-over-month delta pill vs last month', async () => {
    const tree = await renderScreen();
    // delta = 84000 − 60000 = +24000, previous month is 2026-06 → "Jun".
    expect(nodeTexts(tree)).toContain('+$240 vs Jun');
  });

  it('renders the category trend bars with month abbreviations', async () => {
    const tree = await renderScreen();
    expect(byTestID(tree, 'budget-category-summary').length).toBeGreaterThanOrEqual(1);
    const texts = collectRenderedText(tree);
    ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'].forEach((m) => expect(texts).toContain(m));
  });

  it('renders the section header with the rolling-window label', async () => {
    const tree = await renderScreen();
    expect(collectRenderedText(tree)).toContain('Items this month');
    expect(nodeTexts(tree)).toContain('Last 6 months');
  });

  it('renders the product rows with names, current amounts and count captions', async () => {
    const tree = await renderScreen();
    expect(byTestID(tree, 'budget-category-products').length).toBeGreaterThanOrEqual(1);
    const texts = collectRenderedText(tree);
    // names
    ['milk', 'eggs', 'bread', 'coffee'].forEach((n) => expect(texts).toContain(n));
    // current-month amounts
    ['$50', '$20', '$15', '$10'].forEach((a) => expect(texts).toContain(a));
    // count-caption variants (with and without the "N× this month" prefix)
    expect(texts).toContain('3× this month · avg $40/mo');
    expect(texts).toContain('1× this month · avg $30/mo');
    expect(texts).toContain('avg $10/mo'); // currentCount === 0 branch (coffee)
  });

  it('renders each product trend label + fractional-cents formatting', async () => {
    const tree = await renderScreen();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('+$20'); // milk "up" → signed delta
    expect(texts).toContain('-$20'); // eggs "down" → signed delta
    expect(texts).toContain('New'); // bread "new"
    expect(texts).toContain('Steady'); // coffee "flat"
    expect(texts).toContain('2× this month · avg $7.50/mo'); // 750¢ → fractional
  });

  it('renders the trends footnote', async () => {
    const tree = await renderScreen();
    expect(collectRenderedText(tree)).toContain(
      'Trends group purchases by item name. Scanning grocery receipts captures each item automatically.'
    );
  });
});

describe('BudgetCategoryDetailScreen — empty & error', () => {
  it('shows the empty-items card when the category has no products', async () => {
    mockGetCategoryProductTrends.mockResolvedValue(EMPTY_WITH_DATA);
    const tree = await renderScreen();
    // Trend chart (from monthlyTotals) still renders, but no product card and
    // no delta pill (previousMonthTotal === 0).
    expect(byTestID(tree, 'budget-category-products')).toHaveLength(0);
    expect(collectRenderedText(tree)).toContain(
      'No items recorded in this category yet. Scan a receipt or add a spending to start tracking what you buy.'
    );
  });

  it('renders the null-data empty state without fetching when there is no household', async () => {
    mockHousehold = null;
    const tree = await renderScreen();
    expect(mockGetCategoryProductTrends).not.toHaveBeenCalled();
    expect(collectRenderedText(tree)).toContain(
      'No items recorded in this category yet. Scan a receipt or add a spending to start tracking what you buy.'
    );
    // data === null → summary total falls back to "$0".
    expect(collectRenderedText(tree)).toContain('$0');
  });

  it('shows the error card when the fetch rejects', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetCategoryProductTrends.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    expect(collectRenderedText(tree)).toContain('Could not load this category. Pull to try again.');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('BudgetCategoryDetailScreen — navigation & delta variants', () => {
  it('goes back when the header back button is pressed', async () => {
    const tree = await renderScreen();
    const back = byTestID(tree, 'nav-back-button')[0];
    act(() => back.props.onPress());
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('renders a negative delta pill when spending fell versus last month', async () => {
    mockGetCategoryProductTrends.mockResolvedValue({
      ...TRENDS,
      currentMonthTotal: 30000, // "$300"
      previousMonthTotal: 60000, // delta = −30000 → "-$300 vs Jun"
    });
    const tree = await renderScreen();
    expect(nodeTexts(tree)).toContain('-$300 vs Jun');
  });

  it('renders a flat (zero) delta pill when spending is unchanged', async () => {
    mockGetCategoryProductTrends.mockResolvedValue({
      ...TRENDS,
      currentMonthTotal: 60000,
      previousMonthTotal: 60000, // delta === 0 → unsigned "$0 vs Jun"
    });
    const tree = await renderScreen();
    expect(nodeTexts(tree)).toContain('$0 vs Jun');
  });
});

/**
 * The dashboard's "Other" row is a bucket of the categories that fell below the
 * top-5 cut. It arrives as `categoryIds`, and the screen fetches each one and
 * merges them so the bucket opens the same item list a real category does.
 */
describe('BudgetCategoryDetailScreen — aggregate "Other" bucket', () => {
  const PART_A: CategoryProductTrends = {
    categoryId: 'cat-home',
    categoryName: 'Home Improvement',
    months: MONTHS,
    monthlyTotals: [0, 0, 0, 0, 3000, 4000],
    currentMonthTotal: 4000,
    previousMonthTotal: 3000,
    products: [
      makeProduct({
        name: 'paint',
        trend: 'up',
        total: 7000,
        count: 2,
        currentAmount: 4000,
        currentCount: 1,
        previousAmount: 3000,
        averageAmount: 1167,
      }),
    ],
  };

  const PART_UNCATEGORIZED: CategoryProductTrends = {
    categoryId: 'uncategorized',
    categoryName: null,
    months: MONTHS,
    monthlyTotals: [0, 0, 0, 0, 0, 2500],
    currentMonthTotal: 2500,
    previousMonthTotal: 0,
    products: [
      makeProduct({
        name: 'paint',
        trend: 'new',
        total: 1500,
        count: 1,
        currentAmount: 1500,
        currentCount: 1,
        previousAmount: 0,
        averageAmount: 250,
      }),
      makeProduct({
        name: 'stamps',
        trend: 'new',
        total: 1000,
        count: 1,
        currentAmount: 1000,
        currentCount: 1,
        previousAmount: 0,
        averageAmount: 167,
      }),
    ],
  };

  beforeEach(() => {
    mockParams = {
      categoryId: 'other',
      categoryName: 'Other',
      categoryIds: ['cat-home', 'uncategorized'],
    };
    mockGetCategoryProductTrends.mockImplementation((_hh: string, id: string) =>
      Promise.resolve(id === 'cat-home' ? PART_A : PART_UNCATEGORIZED)
    );
  });

  it('fetches every folded category for the same window', async () => {
    await renderScreen();
    expect(mockGetCategoryProductTrends).toHaveBeenCalledTimes(2);
    expect(mockGetCategoryProductTrends).toHaveBeenCalledWith('hh-test', 'cat-home', 2026, 7, 6);
    expect(mockGetCategoryProductTrends).toHaveBeenCalledWith('hh-test', 'uncategorized', 2026, 7, 6);
  });

  it('shows the merged month total and delta under the bucket name', async () => {
    const tree = await renderScreen();
    expect(collectRenderedText(tree)).toContain('Other'); // header title
    expect(collectRenderedText(tree)).toContain('$65'); // 4000 + 2500
    expect(nodeTexts(tree)).toContain('+$35 vs Jun'); // 6500 − 3000
  });

  it('names the categories the bucket folded, with the uncategorized fallback', async () => {
    const tree = await renderScreen();
    const members = byTestID(tree, 'budget-category-bucket-members');
    expect(members.length).toBeGreaterThan(0);
    expect(collectRenderedText(tree)).toContain('Home Improvement · Uncategorized');
  });

  it('collapses a product bought in two of the folded categories into one row', async () => {
    const tree = await renderScreen();
    const text = collectRenderedText(tree);
    // 'paint' came from both parts but renders as often as the single-part
    // 'stamps' — i.e. exactly one row each.
    expect(text.filter((t) => t === 'paint')).toHaveLength(
      text.filter((t) => t === 'stamps').length
    );
    expect(text).toContain('$55'); // 4000 + 1500 merged into one item row
    expect(text).toContain('$10'); // stamps, only in the uncategorized part
    // …and the per-category amounts it merged are no longer shown on their own.
    expect(text).not.toContain('$40');
    expect(text).not.toContain('$15');
  });

  it('keeps the single-category path on one fetch and no member list', async () => {
    mockParams = { categoryId: 'cat-food', categoryName: 'Groceries' };
    mockGetCategoryProductTrends.mockResolvedValue(TRENDS);
    const tree = await renderScreen();
    expect(mockGetCategoryProductTrends).toHaveBeenCalledTimes(1);
    expect(byTestID(tree, 'budget-category-bucket-members')).toHaveLength(0);
  });
});
