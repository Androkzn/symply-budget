/**
 * BudgetAllSpendingScreen — the "See all spending" explorer.
 *
 * Renders the real screen against a mocked expenses API and asserts the
 * range→fetch wiring, the category / search / sort filters, and the empty
 * state. gifted-charts is stubbed globally (jest.setup.js).
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('expo-router/react-navigation', () => {
  const React = require('react');
  return {
    // Mirror react-navigation: re-run whenever the callback identity changes
    // (the screen's callback changes when `load` changes, i.e. on range change).
    useFocusEffect: (cb: () => (() => void) | void) => {
      React.useEffect(cb, [cb]);
    },
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  };
});

const mockGetExpenses = jest.fn();
const mockGetCategories = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    getExpenses: (...args: unknown[]) => mockGetExpenses(...args),
    getCategories: (...args: unknown[]) => mockGetCategories(...args),
  },
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      React.createElement(View, { testID: `header-${title}` }),
  };
});

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (selector?: (s: { currentHousehold: { id: string } }) => unknown) => {
    const state = { currentHousehold: { id: 'hh-test' } };
    return selector ? selector(state) : state;
  },
}));

let mockDataRevision = 0;
jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { selectedYear: 2026, selectedMonth: 7, dataRevision: mockDataRevision };
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

import type { BudgetCategory, Expense } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';

import { BudgetAllSpendingScreen } from '../BudgetAllSpendingScreen';

const GROCERIES: BudgetCategory = {
  id: 'cat-groc',
  household_id: 'hh-test',
  name: 'Groceries',
  icon: '🛒',
  color: '#22aa77',
  sort_order: 0,
  created_at: '2026-07-01T00:00:00Z',
};

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'exp-1',
    household_id: 'hh-test',
    budget_item_id: null,
    category_id: 'cat-groc',
    title: 'Rice',
    description: null,
    amount: 600,
    saved_amount: 0,
    expense_date: '2026-07-22',
    vendor: null,
    receipt_key: null,
    created_by: null,
    created_at: '2026-07-22T00:00:00Z',
    ...overrides,
  };
}

async function renderScreen(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetAllSpendingScreen />
      </ThemeProvider>
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

function treeText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const children = (node as { children?: unknown }).children;
    if (children) walk(children);
  };
  walk(renderer.toJSON());
  return out.join(' ');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDataRevision = 0;
  mockGetExpenses.mockResolvedValue({
    expenses: [
      makeExpense({ id: 'exp-1', title: 'Rice', amount: 600, expense_date: '2026-07-22' }),
      makeExpense({ id: 'exp-2', title: 'Bus fare', category_id: null, amount: 250, expense_date: '2026-07-05' }),
    ],
  });
  mockGetCategories.mockResolvedValue({ categories: [GROCERIES] });
});

describe('BudgetAllSpendingScreen', () => {
  it('fetches the current month with an exclusive next-month end and lists transactions', async () => {
    const r = await renderScreen();
    expect(mockGetExpenses).toHaveBeenCalledWith('hh-test', {
      start_date: '2026-07-01',
      end_date: '2026-08-01',
      limit: 500,
    });
    expect(r.root.findByProps({ testID: 'budget-all-spending' })).toBeTruthy();
    const text = treeText(r);
    expect(text).toContain('Rice');
    expect(text).toContain('Bus fare');
  });

  it('filters the list to a category when its distribution row is tapped', async () => {
    const r = await renderScreen();
    await act(async () => {
      r.root.findByProps({ testID: 'budget-all-spending-category-cat-groc' }).props.onPress();
    });
    const text = treeText(r);
    expect(text).toContain('Rice');
    expect(text).not.toContain('Bus fare');
  });

  it('filters the list by the search query', async () => {
    const r = await renderScreen();
    await act(async () => {
      r.root.findByProps({ testID: 'budget-all-spending-search' }).props.onChangeText('bus');
    });
    const text = treeText(r);
    expect(text).toContain('Bus fare');
    expect(text).not.toContain('Rice');
  });

  it('re-fetches with year bounds when the range changes to "This year"', async () => {
    const r = await renderScreen();
    mockGetExpenses.mockClear();
    // The first FilterTabs instance is the time-range scope.
    const rangeTabs = r.root.findAllByProps({ showActiveIndicator: false })[0];
    await act(async () => {
      rangeTabs.props.onTabChange('year');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockGetExpenses).toHaveBeenCalledWith('hh-test', {
      start_date: '2026-01-01',
      end_date: '2027-01-01',
      limit: 500,
    });
  });

  it('navigates to the expense editor when a transaction is tapped', async () => {
    const r = await renderScreen();
    await act(async () => {
      r.root.findAllByProps({ testID: 'budget-all-spending-item' })[0].props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith(
      'BudgetItemForm',
      expect.objectContaining({ kind: 'spent', expenseId: expect.any(String) })
    );
  });

  it('shows the list AND trend empty states when the window has no spending', async () => {
    mockGetExpenses.mockResolvedValue({ expenses: [] });
    const r = await renderScreen();
    const text = treeText(r);
    expect(text).toContain('No spending matches these filters.');
    expect(text).toContain('No spending in this period yet.');
  });

  it('re-fetches immediately when the budget data revision bumps', async () => {
    mockDataRevision = 7;
    await renderScreen();
    // Focus effect + the dataRevision effect each drive a fetch.
    expect(mockGetExpenses.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('BudgetAllSpendingScreen — summary tiles & filters', () => {
  beforeEach(() => {
    mockGetExpenses.mockResolvedValue({
      expenses: [
        makeExpense({ id: 'e1', title: 'Rice', category_id: 'cat-groc', amount: 600, saved_amount: 0, expense_date: '2026-07-22' }),
        makeExpense({ id: 'e2', title: 'Bus fare', category_id: null, amount: 400, saved_amount: 200, expense_date: '2026-07-05' }),
      ],
    });
  });

  it('renders total / count / average / saved tiles from the filtered set', async () => {
    const r = await renderScreen();
    const text = treeText(r);
    expect(text).toContain('Total spent');
    expect(text).toContain('$10'); // 600 + 400 cents = $10
    expect(text).toContain('Transactions');
    expect(text).toContain('Avg / item');
    expect(text).toContain('$5'); // round(1000 / 2) = 500c = $5
    expect(text).toContain('Saved');
    expect(text).toContain('$2'); // discount savings 200c = $2
  });

  it('flips the sort control label between Newest and Highest', async () => {
    const r = await renderScreen();
    expect(treeText(r)).toContain('Newest');
    await act(async () => {
      r.root.findByProps({ testID: 'budget-all-spending-sort' }).props.onPress();
    });
    expect(treeText(r)).toContain('Highest');
  });

  it('offers an Uncategorized chip and filters the list to it', async () => {
    const r = await renderScreen();
    expect(treeText(r)).toContain('Uncategorized');
    // The 2nd FilterTabs instance is the category-chip row.
    const chipTabs = r.root.findAllByProps({ showActiveIndicator: false })[1];
    await act(async () => {
      chipTabs.props.onTabChange('uncategorized');
    });
    const text = treeText(r);
    expect(text).toContain('Bus fare');
    expect(text).not.toContain('Rice');
  });
});
