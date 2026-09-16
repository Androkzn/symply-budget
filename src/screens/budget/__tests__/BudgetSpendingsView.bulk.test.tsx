/**
 * Bulk purchases in the Spendings list: the purchase month shows what the
 * stock-up COUNTS (its share) with a chip carrying the whole; later months
 * list the reserved shares under "From bulk purchases"; forward navigation
 * runs to the last reserved month; a reserved row opens its purchase.
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

const mockGetMonthlyOverview = jest.fn();
const mockGetCategories = jest.fn();
const mockGetExpense = jest.fn();

jest.mock('@api/budget', () => ({
  budgetApi: {
    getMonthlyOverview: (...args: unknown[]) => mockGetMonthlyOverview(...args),
    getCategories: (...args: unknown[]) => mockGetCategories(...args),
    getExpense: (...args: unknown[]) => mockGetExpense(...args),
    addExpense: jest.fn(),
    createItem: jest.fn(),
    deleteItem: jest.fn(),
    deleteExpense: jest.fn(),
    recordPlannedSpending: jest.fn(),
  },
}));

jest.mock('react-native-gesture-handler', () => {
  const RN = require('react-native');
  return {
    TouchableOpacity: RN.TouchableOpacity,
    ScrollView: RN.ScrollView,
  };
});

jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => <>{children}</>,
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (selector?: (s: { currentHousehold: { id: string } }) => unknown) => {
    const state = { currentHousehold: { id: 'hh-bulk' } };
    return selector ? selector(state) : state;
  },
}));

jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (selector?: (s: { markInsightsDirty: jest.Mock; dataRevision: number }) => unknown) => {
    const state = { markInsightsDirty: jest.fn(), dataRevision: 0 };
    return selector ? selector(state) : state;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { BulkPortionView, Expense, MonthlyOverview } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';

import { formatBudgetCurrency } from '../budgetFormat';
import { BudgetSpendingsView } from '../BudgetSpendingsView';

const SALMON: Expense = {
  id: 'exp-salmon',
  household_id: 'hh-bulk',
  budget_item_id: null,
  category_id: 'cat-fish',
  title: 'Salmon',
  description: null,
  amount: 40000,
  saved_amount: 0,
  tax_amount: 0,
  expense_date: '2026-09-11',
  vendor: 'Costco',
  receipt_key: null,
  created_by: null,
  created_at: '2026-09-11T00:00:00Z',
  bulk: { months: 4, start_month: '2026-09', suggested_months: 4, basis: 'product_rate' },
};

function portion(index: number): BulkPortionView {
  const monthIndex = 2026 * 12 + 8 + (index - 1);
  return {
    expenseId: SALMON.id,
    title: SALMON.title,
    category_id: SALMON.category_id,
    vendor: SALMON.vendor,
    purchase_date: SALMON.expense_date,
    start_month: '2026-09',
    months: 4,
    index,
    month: `${Math.floor(monthIndex / 12)}-${String((monthIndex % 12) + 1).padStart(2, '0')}`,
    portion_cents: 10000,
    total_cents: 40000,
  };
}

function overview(year: number, month: number, partial: Partial<MonthlyOverview>): MonthlyOverview {
  return {
    goal: {
      id: `goal_${year}_${month}`,
      household_id: 'hh-bulk',
      year,
      month,
      planned_budget: 200000,
      actual_spent: 0,
      category_budgets: null,
      notes: null,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    },
    plannedBudget: 200000,
    actualSpent: 0,
    committedTotal: 0,
    remainingBudget: 200000,
    affordability: { remaining_budget: 200000, used_budget: 0, affordable: [], deferred: [] },
    items: [],
    expenses: [],
    itemCount: 0,
    savedTotal: 0,
    bulkLastMonth: '2026-12',
    ...partial,
  };
}

const textOf = (renderer: ReactTestRenderer.ReactTestRenderer) => JSON.stringify(renderer.toJSON());

async function renderMonth(year: number, month: number, onEditExpense = jest.fn()) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetSpendingsView
          variant="spent"
          year={year}
          month={month}
          onMonthChange={jest.fn()}
          onEditItem={jest.fn()}
          onEditExpense={onEditExpense}
        />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

const byTestID = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCategories.mockResolvedValue({
    categories: [
      {
        id: 'cat-fish',
        household_id: 'hh-bulk',
        name: 'Fish',
        icon: 'fish',
        color: '#4C8DFF',
        sort_order: 0,
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
  });
  mockGetExpense.mockResolvedValue({ expense: SALMON });
});

describe('BudgetSpendingsView — bulk purchases', () => {
  it('shows the counted share and the whole in the purchase month, and opens the way forward', async () => {
    mockGetMonthlyOverview.mockResolvedValue(
      overview(2026, 9, {
        actualSpent: 10000,
        remainingBudget: 190000,
        expenses: [SALMON],
        bulkPortions: [portion(1)],
        bulkReservedTotal: 0,
        bulkDeferredTotal: 30000,
      })
    );
    const tree = await renderMonth(2026, 9);
    const text = textOf(tree);

    expect(byTestID(tree, 'budget-spent-bulk-chip').length).toBeGreaterThan(0);
    expect(text).toContain(`Bulk · 1 of 4 · ${formatBudgetCurrency(40000)} total`);
    // The row prints what it counts here, not the cash paid. (A testID sits on
    // the Typography and on its host Text, so de-duplicate before comparing.)
    const amounts = [
      ...new Set(byTestID(tree, 'budget-spent-amount').map((n) => JSON.stringify(n.props.children))),
    ];
    expect(amounts).toEqual([JSON.stringify(formatBudgetCurrency(10000))]);
    expect(byTestID(tree, 'budget-reserved-portion')).toHaveLength(0);
    expect(text).not.toContain('From bulk purchases');

    // September 2026 is the current month, but a share is reserved through
    // December — the spent tab may go forward to it.
    const next = byTestID(tree, 'budget-spendings-month-next')[0]!;
    expect(next.props.disabled).toBe(false);
  });

  it('lists the reserved share in a later month and opens its purchase', async () => {
    mockGetMonthlyOverview.mockResolvedValue(
      overview(2026, 10, {
        actualSpent: 10000,
        remainingBudget: 190000,
        expenses: [],
        bulkPortions: [portion(2)],
        bulkReservedTotal: 10000,
        bulkDeferredTotal: 0,
      })
    );
    const onEditExpense = jest.fn();
    const tree = await renderMonth(2026, 10, onEditExpense);
    const text = textOf(tree);

    expect(text).toContain('FROM BULK PURCHASES');
    expect(text).toContain('Bulk purchase · Sep 2026 · 2 of 4');
    expect(text).not.toContain('Nothing spent this month yet');
    expect(byTestID(tree, 'budget-spent-total')[0]!.props.children).toBe(formatBudgetCurrency(10000));

    await act(async () => {
      byTestID(tree, 'budget-reserved-portion')[0]!.props.onPress();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(mockGetExpense).toHaveBeenCalledWith('hh-bulk', SALMON.id);
    expect(onEditExpense).toHaveBeenCalledWith(SALMON);
  });

  it('stops forward navigation after the last reserved month', async () => {
    mockGetMonthlyOverview.mockResolvedValue(
      overview(2026, 12, {
        actualSpent: 10000,
        expenses: [],
        bulkPortions: [portion(4)],
        bulkReservedTotal: 10000,
      })
    );
    const tree = await renderMonth(2026, 12);
    const next = byTestID(tree, 'budget-spendings-month-next')[0]!;
    expect(next.props.disabled).toBe(true);
  });
});
