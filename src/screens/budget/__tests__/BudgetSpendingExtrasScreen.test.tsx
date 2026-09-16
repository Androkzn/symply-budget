/**
 * BudgetSpendingExtrasScreen — the page behind the Spent tab's discounts /
 * deposits / taxes banners.
 *
 * Pins the three things the page promises: the explanation copy for the kind
 * in the route, a chart of the same figure over the previous months (loaded
 * as one window ending at the viewed month), and honest empty / failed states
 * rather than a blank plot. gifted-charts is stubbed globally (jest.setup.js).
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteKind = 'taxes';
jest.mock('expo-router/react-navigation', () => {
  const React = require('react');
  return {
    useFocusEffect: (cb: () => (() => void) | void) => {
      React.useEffect(cb, [cb]);
    },
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
    useRoute: () => ({ params: { kind: mockRouteKind } }),
  };
});

const mockGetMonthlyOverview = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    getMonthlyOverview: (...args: unknown[]) => mockGetMonthlyOverview(...args),
  },
}));

const mockHeader = jest.fn();
jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
    ScreenHeader: (props: { title?: string }) => {
      mockHeader(props);
      return React.createElement(View, { testID: `header-${props.title}` });
    },
  };
});

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (selector?: (s: { currentHousehold: { id: string } | null }) => unknown) => {
    const state = { currentHousehold: mockHousehold };
    return selector ? selector(state) : state;
  },
}));
let mockHousehold: { id: string } | null = { id: 'hh-test' };

let mockDataRevision = 0;
jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { selectedYear: 2026, selectedMonth: 9, dataRevision: mockDataRevision };
    return selector ? selector(state) : state;
  },
}));

jest.mock('@stores/appStore', () => {
  const state = { currency: 'USD', accentScheme: 'classic' };
  const useAppStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useAppStore.getState = () => state;
  return { useAppStore };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { MonthlyOverview } from '@api/budget';
import { AppBarChart } from '@components/ui/AppBarChart';
import { ThemeProvider } from '@contexts/ThemeContext';

import { treeText } from '../../../test-utils/deviceRender';
import { BudgetSpendingExtrasScreen } from '../BudgetSpendingExtrasScreen';

const overviewFor = (extras: Partial<MonthlyOverview>): MonthlyOverview =>
  ({ savedTotal: 0, ...extras }) as MonthlyOverview;

/** Taxes per month, keyed 'YYYY-M', for the six-month window ending Sep 2026. */
const TAXES_BY_MONTH: Record<string, number> = {
  '2026-4': 1200,
  '2026-5': 0,
  '2026-6': 800,
  '2026-7': 1000,
  '2026-8': 2500,
  '2026-9': 1900,
};

function historyResponder(extras: (year: number, month: number) => Partial<MonthlyOverview>) {
  mockGetMonthlyOverview.mockImplementation(async (_hid: string, year: number, month: number) =>
    overviewFor(extras(year, month)),
  );
}

async function renderScreen(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetSpendingExtrasScreen />
      </ThemeProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteKind = 'taxes';
  mockHousehold = { id: 'hh-test' };
  mockDataRevision = 0;
  historyResponder((year, month) => ({
    taxesTotal: TAXES_BY_MONTH[`${year}-${month}`] ?? 0,
    depositsTotal: month === 9 ? 125 : 0,
  }));
});

describe('BudgetSpendingExtrasScreen — taxes', () => {
  it('is a standard pushed page: titled header with a back button', async () => {
    const r = await renderScreen();
    expect(r.root.findByProps({ testID: 'header-Taxes paid' })).toBeTruthy();
    const header = mockHeader.mock.calls[0]![0];
    expect(header.showBackButton).toBe(true);
    header.onBackPress();
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('explains the figure: this month, what it is and how it is calculated', async () => {
    const r = await renderScreen();
    const text = treeText(r);
    expect(r.root.findByProps({ testID: 'budget-spending-extras-taxes' })).toBeTruthy();
    expect(text).toContain('September 2026');
    // The headline is the viewed month's own overview figure — the banner's number.
    expect(r.root.findByProps({ testID: 'budget-spending-extras-current' }).props.children).toBe(
      '$19.00',
    );
    expect(text).toContain('What is it');
    expect(text).toMatch(/GST, PST or HST/);
    expect(text).toContain('How it is calculated');
    expect(text).toMatch(/“Sales tax” section of the form/);
  });

  it('loads the six-month window ending at the viewed month, oldest first', async () => {
    await renderScreen();
    expect(mockGetMonthlyOverview.mock.calls.map(([, y, m]) => `${y}-${m}`)).toEqual([
      '2026-4',
      '2026-5',
      '2026-6',
      '2026-7',
      '2026-8',
      '2026-9',
    ]);
    expect(mockGetMonthlyOverview.mock.calls.every(([hid]) => hid === 'hh-test')).toBe(true);
  });

  it('charts each month in dollars with the viewed month accented, and captions the window', async () => {
    const r = await renderScreen();
    expect(r.root.findByProps({ testID: 'budget-spending-extras-chart' })).toBeTruthy();
    const chart = r.root.findByType(AppBarChart);
    expect(chart.props.data.map((b: { value: number; label: string }) => [b.label, b.value])).toEqual([
      ['Apr', 12],
      ['May', 0],
      ['Jun', 8],
      ['Jul', 10],
      ['Aug', 25],
      ['Sep', 19],
    ]);
    const colors = chart.props.data.map((b: { frontColor: string }) => b.frontColor);
    // Five past months share one colour; the viewed month stands out.
    expect(new Set(colors.slice(0, 5)).size).toBe(1);
    expect(colors[5]).not.toBe(colors[0]);

    const text = treeText(r);
    expect(text).toContain('Previous months');
    expect(text).toContain('Apr–Sep 2026');
    expect(text).toContain('Monthly average');
    // (1200 + 0 + 800 + 1000 + 2500 + 1900) / 6 = 1233.33 cents
    expect(text).toContain('$12.33');
    expect(text).toContain('$74.00 paid in taxes over 6 months');
  });

  it('reloads when the ledger moves', async () => {
    const r = await renderScreen();
    expect(mockGetMonthlyOverview).toHaveBeenCalledTimes(6);
    mockDataRevision = 1;
    await act(async () => {
      r.update(
        <ThemeProvider>
          <BudgetSpendingExtrasScreen />
        </ThemeProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockGetMonthlyOverview).toHaveBeenCalledTimes(12);
  });
});

describe('BudgetSpendingExtrasScreen — other kinds', () => {
  it('deposits: its own title, copy and series', async () => {
    mockRouteKind = 'deposits';
    const r = await renderScreen();
    expect(r.root.findByProps({ testID: 'header-Deposits paid' })).toBeTruthy();
    expect(treeText(r)).toMatch(/CRV/);
    expect(r.root.findByProps({ testID: 'budget-spending-extras-current' }).props.children).toBe(
      '$1.25',
    );
    const chart = r.root.findByType(AppBarChart);
    expect(chart.props.data.map((b: { value: number }) => b.value)).toEqual([0, 0, 0, 0, 0, 1.25]);
  });

  it('discounts: says so when no month in the window has the figure, instead of an empty plot', async () => {
    mockRouteKind = 'discounts';
    const r = await renderScreen();
    expect(r.root.findByProps({ testID: 'header-Discount savings' })).toBeTruthy();
    expect(r.root.findByProps({ testID: 'budget-spending-extras-empty' })).toBeTruthy();
    expect(r.root.findAllByType(AppBarChart)).toHaveLength(0);
    expect(treeText(r)).toContain('Nothing saved on discounts in these months yet.');
    expect(r.root.findAllByProps({ testID: 'budget-spending-extras-summary' })).toHaveLength(0);
    expect(r.root.findByProps({ testID: 'budget-spending-extras-current' }).props.children).toBe(
      '$0.00',
    );
  });
});

describe('BudgetSpendingExtrasScreen — failed load and no household', () => {
  it('reports a failed load and keeps the explanation', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetMonthlyOverview.mockRejectedValue(new Error('ledger closed'));
    const r = await renderScreen();
    expect(r.root.findByProps({ testID: 'budget-spending-extras-failed' })).toBeTruthy();
    expect(r.root.findAllByType(AppBarChart)).toHaveLength(0);
    const text = treeText(r);
    expect(text).toContain('How it is calculated');
    expect(text).toContain('Could not load the previous months right now.');
    expect(r.root.findByProps({ testID: 'budget-spending-extras-current' }).props.children).toBe('—');
    spy.mockRestore();
  });

  it('loads nothing without a household', async () => {
    mockHousehold = null;
    await renderScreen();
    expect(mockGetMonthlyOverview).not.toHaveBeenCalled();
  });
});
