/**
 * SavingsOverviewView — cashflow overview, self-fetching sub-view behaviour.
 *
 * The view is a pure render of the BE-computed `SavingsOverview` view model:
 * it fetches on focus (getOverview + getTrend), then renders net / YTD /
 * headroom, the income+spending breakdowns (Monthly payments + Budget
 * "Spendings", the single spend source, both deducted from net), the trend
 * chart, and goals — all straight from the payload. These tests assert the API
 * is called with the selected household/year/month and the screen mounts with it.
 *
 * Stubs `@components/common` (its real barrel transitively pulls the
 * SidebarTabBar → navigator chain that crashes under the mocked navigation),
 * the savings API, and the three stores this view reads
 * (household / savings / budget — the last for the cross-store Home line).
 */

// SafeAreaView passthrough so the heavy @components/common barrel never loads.
jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
  };
});

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => 'ov-new-uuid' }));

const mockGetOverview = jest.fn();
const mockGetTrend = jest.fn();

jest.mock('@api/savings', () => ({
  savingsApi: {
    getOverview: (...args: unknown[]) => mockGetOverview(...args),
    getTrend: (...args: unknown[]) => mockGetTrend(...args),
  },
}));

// Override the global gifted-charts stub so we can inspect the BarChart data
// (per-bar frontColor) the trend chart is fed.
type BarDatum = { value: number; label: string; frontColor?: string };
let mockLastBarData: BarDatum[] | null = null;
jest.mock('react-native-gifted-charts', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    BarChart: (props: { data?: BarDatum[] }) => {
      mockLastBarData = props.data ?? null;
      return React.createElement(View, { testID: 'bar-chart' });
    },
  };
});

const mockMarkDirty = jest.fn();
let mockDataRevision = 0;

jest.mock('@stores/savingsStore', () => ({
  useSavingsStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      selectedYear: 2026,
      selectedMonth: 7,
      dataRevision: mockDataRevision,
      markDirty: mockMarkDirty,
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (sel?: (s: unknown) => unknown) => {
    const s = { dataRevision: 0 };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-test' }, currentHouseholdMembers: [] };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { SavingsOverviewView, netBarColor } from '../SavingsOverviewView';

/** Full BE-computed overview view model (numbers rendered verbatim). */
function overviewFixture() {
  return {
    year: 2026,
    month: 7,
    income: {
      total: 900000, // $9,000
      bySource: { payroll: 800000, rental: 100000 },
      entries: [],
    },
    spending: {
      total: 360000, // $3,600 = monthlyPayments + spendings
      monthlyPayments: 200000, // $2,000  ← flat active recurring total
      spendings: 160000, // $1,600  ← Budget expenses (single spend source, DEDUCTED)
    },
    netSavings: 540000, // $5,400 = 900000 − 200000 − 160000
    ytdNet: 1234500, // $12,345
    goals: [
      {
        id: 'goal-1',
        name: 'Emergency Fund',
        type: 'emergency_fund',
        target: 1000000,
        current: 400000,
        monthlyAllocation: 50000,
      },
    ],
  };
}

function trendFixture() {
  return {
    months: [
      {
        period: '2026-06',
        income: 800000,
        spending: 300000,
        net: 500000,
        monthlyPayments: 100000,
        spendings: 200000,
        hasExpenseData: true,
      },
      {
        period: '2026-07',
        income: 900000,
        spending: 350000,
        net: 550000,
        monthlyPayments: 150000,
        spendings: 200000,
        hasExpenseData: true,
      },
    ],
  };
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SavingsOverviewView />
      </ThemeProvider>
    );
  });
  return tree;
}

/** Collect every rendered Text-node child string in the tree. */
function allText(tree: ReactTestRenderer.ReactTestRenderer): string[] {
  return tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);
}

describe('SavingsOverviewView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDataRevision = 0;
    mockLastBarData = null;
    mockGetOverview.mockResolvedValue(overviewFixture());
    mockGetTrend.mockResolvedValue(trendFixture());
  });

  it('fetches the overview for the selected household / year / month', async () => {
    await renderScreen();

    expect(mockGetOverview).toHaveBeenCalledWith('hh-test', 2026, 7);
    expect(mockGetTrend).toHaveBeenCalledWith('hh-test', 2026, 7, 6);
  });

  it('mounts the overview scroll view with the fetched data', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    // The loading spinner is gone and the real content is mounted.
    expect(root.findAllByProps({ testID: 'savings-overview-loading' }).length).toBe(0);
    expect(root.findByProps({ testID: 'savings-overview' })).toBeTruthy();
  });

  it('renders the BE-computed net / YTD figures verbatim', async () => {
    const tree = await renderScreen();
    const texts = allText(tree);

    // formatCurrency: 540000c → $5,400, 1234500c → $12,345.
    expect(texts).toContain('$5,400'); // netSavings
    expect(texts).toContain('$12,345'); // ytdNet
    // Section labels present.
    expect(texts).toContain('Net savings this month');
    expect(texts).toContain('Year to date');
  });

  it('renders the spending breakdown (monthly payments + Budget spendings, both deducted)', async () => {
    const tree = await renderScreen();
    const texts = allText(tree);

    // Monthly payments (flat recurring) + spendings (Budget) make up spending.total.
    expect(texts).toContain('Spending');
    expect(texts).toContain('Monthly payments');
    expect(texts).toContain('Spendings');
    expect(texts).toContain('$3,600'); // spending.total 360000c
    expect(texts).toContain('$2,000'); // monthlyPayments 200000c
    expect(texts).toContain('$1,600'); // spendings 160000c (== Budget actualSpent)

    // Old model is gone: no "manual" line and no non-deducted Home reference.
    expect(texts).not.toContain('Manual spending');
    expect(texts).not.toContain('Home (from Budget) · not deducted');
  });

  it('renders EVERY label and EVERY figure on the overview (full coverage)', async () => {
    const tree = await renderScreen();
    const texts = allText(tree);

    // Every section/stat label.
    for (const label of [
      'Net savings this month',
      'Year to date',
      'Income',
      'Payroll',
      'Rental',
      'Spending',
      'Monthly payments',
      'Spendings',
      'Net savings trend',
      'Goals',
      'Emergency Fund',
    ]) {
      expect(texts).toContain(label);
    }

    // Every figure, derived from the fixture (cents → formatted).
    expect(texts).toContain('$5,400'); // netSavings 540000
    expect(texts).toContain('$12,345'); // ytdNet 1234500
    expect(texts).toContain('$9,000'); // income total 900000
    expect(texts).toContain('$8,000'); // payroll 800000
    expect(texts).toContain('$1,000'); // rental 100000
    expect(texts).toContain('$3,600'); // spending total 360000
    expect(texts).toContain('$2,000'); // monthlyPayments 200000
    expect(texts).toContain('$1,600'); // spendings 160000
  });

  it('renders income breakdown by source (payroll / rental)', async () => {
    const tree = await renderScreen();
    const texts = allText(tree);

    expect(texts).toContain('Payroll');
    expect(texts).toContain('Rental');
    // income.total 900000c → $9,000
    expect(texts).toContain('$9,000');
  });

  it('netBarColor maps negative net → red and positive/zero net → green', () => {
    const red = '#FF0000';
    const green = '#00AA00';
    expect(netBarColor(-1, { negative: red, positive: green })).toBe(red);
    expect(netBarColor(-500000, { negative: red, positive: green })).toBe(red);
    expect(netBarColor(1, { negative: red, positive: green })).toBe(green);
    expect(netBarColor(0, { negative: red, positive: green })).toBe(green); // zero counts as non-negative
  });

  it('feeds the trend chart per-bar colors: negative net in red, positive in brand teal', async () => {
    // Two months: one negative net, one positive.
    mockGetTrend.mockResolvedValue({
      months: [
        {
          period: '2026-06',
          income: 0,
          spending: 120000,
          net: -120000, // red
          monthlyPayments: 70000,
          spendings: 50000,
          hasExpenseData: true,
        },
        {
          period: '2026-07',
          income: 900000,
          spending: 350000,
          net: 550000, // green
          monthlyPayments: 150000,
          spendings: 200000,
          hasExpenseData: true,
        },
      ],
    });
    await renderScreen();

    expect(mockLastBarData).toHaveLength(2);
    const [negBar, posBar] = mockLastBarData!;
    // Values pass through as dollars (cents / 100), sign preserved so negatives render.
    expect(negBar.value).toBeLessThan(0);
    expect(posBar.value).toBeGreaterThan(0);
    // The two signs get DISTINCT colors (red vs brand teal).
    expect(negBar.frontColor).not.toBe(posBar.frontColor);
    // And each matches the theme mapping used by the component.
    const { lightTheme } = require('@theme');
    expect(negBar.frontColor).toBe(lightTheme.colors.error);
    expect(posBar.frontColor).toBe(lightTheme.pastel.teal);
  });

  describe('chart tab switch (Savings / Spending / Monthly)', () => {
    // Distinct net / spendings / monthlyPayments per point so each series is
    // unambiguously distinguishable from the others once a tab is selected.
    function tabTrendFixture() {
      return {
        months: [
          {
            period: '2026-06',
            income: 800000,
            spending: 300000,
            net: -50000, // distinct: negative, so also exercises the red bar under this tab
            monthlyPayments: 100000,
            spendings: 200000,
            hasExpenseData: true,
          },
          {
            period: '2026-07',
            income: 900000,
            spending: 350000,
            net: 550000,
            monthlyPayments: 150000,
            spendings: 200000,
            hasExpenseData: true,
          },
        ],
      };
    }

    it('defaults to the Savings tab, feeding net/100 per point', async () => {
      mockGetTrend.mockResolvedValue(tabTrendFixture());
      await renderScreen();

      expect(mockLastBarData).toHaveLength(2);
      const [first, second] = mockLastBarData!;
      expect(first.value).toBe(-500); // -50000 / 100
      expect(second.value).toBe(5500); // 550000 / 100
    });

    it('switches to the Spending tab, feeding spendings/100 with one consistent color', async () => {
      mockGetTrend.mockResolvedValue(tabTrendFixture());
      const tree = await renderScreen();

      act(() => {
        tree.root.findByProps({ testID: 'filter-tab-chart-spending' }).props.onPress();
      });

      expect(mockLastBarData).toHaveLength(2);
      const [first, second] = mockLastBarData!;
      expect(first.value).toBe(2000); // spendings 200000 / 100
      expect(second.value).toBe(2000); // spendings 200000 / 100
      // Spending is never negative, so both bars share ONE color (no sign split).
      expect(first.frontColor).toBe(second.frontColor);
      const { lightTheme } = require('@theme');
      expect(first.frontColor).toBe(lightTheme.pastel.orange);
    });

    it('switches to the Monthly tab, feeding monthlyPayments/100 with one consistent color', async () => {
      mockGetTrend.mockResolvedValue(tabTrendFixture());
      const tree = await renderScreen();

      act(() => {
        tree.root.findByProps({ testID: 'filter-tab-chart-monthly' }).props.onPress();
      });

      expect(mockLastBarData).toHaveLength(2);
      const [first, second] = mockLastBarData!;
      expect(first.value).toBe(1000); // monthlyPayments 100000 / 100
      expect(second.value).toBe(1500); // monthlyPayments 150000 / 100
      // Monthly payments are never negative, so both bars share ONE color.
      expect(first.frontColor).toBe(second.frontColor);
      const { lightTheme } = require('@theme');
      expect(first.frontColor).toBe(lightTheme.pastel.skyBlue);
    });
  });

  it('renders the goals summary from the payload', async () => {
    const tree = await renderScreen();
    const texts = allText(tree);

    expect(texts).toContain('Goals');
    expect(texts).toContain('Emergency Fund');
  });

  it('shows the empty state when the overview payload is null', async () => {
    mockGetOverview.mockResolvedValue(null);
    const tree = await renderScreen();
    const texts = allText(tree);

    expect(texts.some((t) => t.includes('Nothing to show yet'))).toBe(true);
    expect(tree.root.findAllByProps({ testID: 'savings-overview' }).length).toBe(0);
  });

  it('shows the empty state when loading the overview fails', async () => {
    mockGetOverview.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    expect(allText(tree).some((t) => t.includes('Nothing to show yet'))).toBe(true);
  });

  it('reloads when the savings data revision changes', async () => {
    const tree = await renderScreen();
    const callsAfterMount = mockGetOverview.mock.calls.length;

    mockDataRevision = 4;
    await act(async () => {
      tree.update(
        <ThemeProvider>
          <SavingsOverviewView />
        </ThemeProvider>
      );
    });

    expect(mockGetOverview.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it('renders negative figures with a leading minus and no income/goals/trend gracefully', async () => {
    mockGetOverview.mockResolvedValue({
      ...overviewFixture(),
      netSavings: -120000, // -$1,200
      income: { total: 0, bySource: {}, entries: [] },
      goals: [],
    });
    mockGetTrend.mockResolvedValue({ months: [] });
    const tree = await renderScreen();
    const texts = allText(tree);
    expect(texts).toContain('-$1,200');
    expect(texts.some((t) => t.includes('No income recorded this month'))).toBe(true);
    // No goals section header when there are no goals.
    expect(texts).not.toContain('Goals');
  });

  it('falls back to the raw key for an unknown income source', async () => {
    mockGetOverview.mockResolvedValue({
      ...overviewFixture(),
      income: { total: 100000, bySource: { mystery_source: 100000 }, entries: [] },
    });
    const tree = await renderScreen();
    expect(allText(tree)).toContain('mystery_source');
  });

  describe('regular vs one-off income split', () => {
    function findByTestID(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
      return tree.root.findAll((n) => n.props?.testID === id);
    }

    it('hides the split for a household with only regular income', async () => {
      // Payroll + rental only — a "One-off: $0" row would be noise.
      const tree = await renderScreen();
      expect(findByTestID(tree, 'savings-overview-income-split')).toHaveLength(0);
    });

    it('renders the split using the totals the backend supplies', async () => {
      mockGetOverview.mockResolvedValue({
        ...overviewFixture(),
        income: {
          total: 925000,
          regularTotal: 900000,
          irregularTotal: 25000,
          bySource: { payroll: 800000, rental: 100000, marketplace_sale: 25000 },
          entries: [],
        },
      });
      const tree = await renderScreen();

      expect(findByTestID(tree, 'savings-overview-income-split').length).toBeGreaterThan(0);
      const regular = findByTestID(tree, 'savings-overview-income-regular')[0];
      const irregular = findByTestID(tree, 'savings-overview-income-irregular')[0];
      expect(regular.props.children).toBe('$9,000');
      expect(irregular.props.children).toBe('$250');
      // The one-off source is still itemised in the per-source breakdown.
      expect(allText(tree)).toContain('Marketplace sale');
    });

    it('derives the split from bySource when an older backend omits the totals', async () => {
      mockGetOverview.mockResolvedValue({
        ...overviewFixture(),
        income: {
          total: 925000,
          // No regularTotal / irregularTotal — pre-split Worker response.
          bySource: { payroll: 800000, rental: 100000, marketplace_sale: 25000 },
          entries: [],
        },
      });
      const tree = await renderScreen();

      const regular = findByTestID(tree, 'savings-overview-income-regular')[0];
      const irregular = findByTestID(tree, 'savings-overview-income-irregular')[0];
      expect(irregular.props.children).toBe('$250');
      expect(regular.props.children).toBe('$9,000');
    });

    it('treats an unknown source as regular when deriving the split', async () => {
      mockGetOverview.mockResolvedValue({
        ...overviewFixture(),
        income: {
          total: 150000,
          bySource: { mystery_source: 100000, gift: 50000 },
          entries: [],
        },
      });
      const tree = await renderScreen();

      const regular = findByTestID(tree, 'savings-overview-income-regular')[0];
      const irregular = findByTestID(tree, 'savings-overview-income-irregular')[0];
      expect(irregular.props.children).toBe('$500');
      expect(regular.props.children).toBe('$1,000');
    });
  });
});
