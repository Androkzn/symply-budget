/**
 * Focused suite for the "See all" spending link that BudgetSpendingsView renders
 * on the Spent tab's "Spent this month" section header. Kept in its own file so
 * it stays independent of the broader CTA-layout suite.
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
const mockGetQuickAddSuggestions = jest.fn();
const mockGetCategories = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    getMonthlyOverview: (...args: unknown[]) => mockGetMonthlyOverview(...args),
    getQuickAddSuggestions: (...args: unknown[]) => mockGetQuickAddSuggestions(...args),
    getCategories: (...args: unknown[]) => mockGetCategories(...args),
  },
}));

jest.mock('react-native-gesture-handler', () => {
  const RN = require('react-native');
  return { TouchableOpacity: RN.TouchableOpacity, ScrollView: RN.ScrollView };
});

jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => <>{children}</>,
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (selector?: (s: { currentHousehold: { id: string } }) => unknown) => {
    const state = { currentHousehold: { id: 'hh-test' } };
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

import type { BudgetItem, Expense, MonthlyOverview } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';

import { BudgetSpendingsView } from '../BudgetSpendingsView';

const EMPTY_OVERVIEW: MonthlyOverview = {
  goal: {
    id: 'goal_1',
    household_id: 'hh-test',
    year: 2026,
    month: 7,
    planned_budget: 50000,
    actual_spent: 0,
    category_budgets: null,
    notes: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  },
  plannedBudget: 50000,
  actualSpent: 0,
  committedTotal: 0,
  remainingBudget: 50000,
  affordability: { remaining_budget: 50000, used_budget: 0, affordable: [], deferred: [] },
  items: [],
  expenses: [],
  itemCount: 0,
  savedTotal: 0,
};

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'exp-1',
    household_id: 'hh-test',
    category_id: null,
    budget_item_id: null,
    title: 'Groceries',
    description: null,
    amount: 3200,
    saved_amount: 0,
    expense_date: '2026-07-10',
    vendor: null,
    receipt_key: null,
    created_by: null,
    created_at: '2026-07-10T00:00:00Z',
    ...overrides,
  };
}

function makeItem(overrides: Partial<BudgetItem> = {}): BudgetItem {
  return {
    id: 'item-1',
    household_id: 'hh-test',
    category_id: null,
    timeframe: 'immediate',
    year: 2026,
    quarter: null,
    title: 'New sofa',
    description: null,
    estimated_cost_min: 60000,
    estimated_cost_max: 80000,
    actual_cost: null,
    priority: 'medium',
    status: 'planned',
    is_recurring: false,
    recurrence_frequency: null,
    source_type: null,
    source_id: null,
    target_date: null,
    completed_at: null,
    created_by: null,
    created_at: '2026-07-05T00:00:00Z',
    updated_at: '2026-07-05T00:00:00Z',
    ...overrides,
  };
}

const BASE_PROPS = {
  variant: 'spent' as const,
  year: 2026,
  month: 7,
  onMonthChange: jest.fn(),
  onEditItem: jest.fn(),
  onEditExpense: jest.fn(),
};

async function renderView(node: React.ReactElement): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMonthlyOverview.mockResolvedValue({
    ...EMPTY_OVERVIEW,
    actualSpent: 3200,
    expenses: [makeExpense()],
  });
  mockGetQuickAddSuggestions.mockResolvedValue({ recent: [], popular: [] });
  mockGetCategories.mockResolvedValue({ categories: [] });
});

describe('BudgetSpendingsView — See all spending link', () => {
  it('renders a "See all" action on the spent tab and fires onSeeAllSpending', async () => {
    const onSeeAllSpending = jest.fn();
    const r = await renderView(
      <BudgetSpendingsView {...BASE_PROPS} onSeeAllSpending={onSeeAllSpending} />
    );
    const link = r.root.findByProps({ testID: 'budget-see-all-spending' });
    act(() => link.props.onPress());
    expect(onSeeAllSpending).toHaveBeenCalledTimes(1);
  });

  it('omits the link when onSeeAllSpending is not provided', async () => {
    const r = await renderView(<BudgetSpendingsView {...BASE_PROPS} />);
    expect(r.root.findAllByProps({ testID: 'budget-see-all-spending' })).toHaveLength(0);
  });

  it('never shows the link on the planned tab', async () => {
    const r = await renderView(
      <BudgetSpendingsView {...BASE_PROPS} variant="planned" onSeeAllSpending={jest.fn()} />
    );
    expect(r.root.findAllByProps({ testID: 'budget-see-all-spending' })).toHaveLength(0);
  });
});

describe('BudgetSpendingsView — See all planned link', () => {
  beforeEach(() => {
    // Planned tab derives its list from overview.items + affordability; give it one
    // item and no affordability scoring so it lands in the "Planned · other" group.
    mockGetMonthlyOverview.mockResolvedValue({
      ...EMPTY_OVERVIEW,
      items: [makeItem()],
    });
  });

  it('renders a "See all" action on the planned tab and fires onSeeAllPlanned', async () => {
    const onSeeAllPlanned = jest.fn();
    const r = await renderView(
      <BudgetSpendingsView {...BASE_PROPS} variant="planned" onSeeAllPlanned={onSeeAllPlanned} />
    );
    const link = r.root.findByProps({ testID: 'budget-see-all-planned' });
    act(() => link.props.onPress());
    expect(onSeeAllPlanned).toHaveBeenCalledTimes(1);
  });

  it('omits the link when onSeeAllPlanned is not provided', async () => {
    const r = await renderView(<BudgetSpendingsView {...BASE_PROPS} variant="planned" />);
    expect(r.root.findAllByProps({ testID: 'budget-see-all-planned' })).toHaveLength(0);
  });

  it('never shows the planned link on the spent tab', async () => {
    const r = await renderView(
      <BudgetSpendingsView {...BASE_PROPS} variant="spent" onSeeAllPlanned={jest.fn()} />
    );
    expect(r.root.findAllByProps({ testID: 'budget-see-all-planned' })).toHaveLength(0);
  });
});
