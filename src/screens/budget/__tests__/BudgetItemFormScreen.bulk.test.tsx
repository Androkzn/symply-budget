/**
 * Bulk purchase (stock-up) on the Record spending form: the toggle asks the
 * ledger how long the purchase should last, the stepper overrides it, the
 * preview follows the split, and Save carries the plan (or `null` to clear).
 */
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: Record<string, unknown> = {};

const mockNav = { navigate: mockNavigate, goBack: mockGoBack };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    OverlaySheetHeader: ({ title, onClose, closeTestID }: Record<string, any>) =>
      React.createElement(
        View,
        null,
        title ? React.createElement(Text, null, title) : null,
        React.createElement(TouchableOpacity, { onPress: onClose, testID: closeTestID })
      ),
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenHeader: ({
      title,
      rightElement,
    }: {
      title?: string;
      rightElement?: React.ReactNode;
    }) =>
      React.createElement(View, null, title ? React.createElement(Text, null, title) : null, rightElement ?? null),
  };
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      React.createElement(View, { testID: 'date-time-picker', ...props }),
  };
});

jest.mock('@hooks/useDeviceType', () => ({
  useDeviceType: () => ({ isIPad: false, width: 390 }),
}));

jest.mock('react-native-gesture-handler', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    GestureHandlerRootView: RN.View,
    ScrollView: RN.ScrollView,
    FlatList: RN.FlatList,
    TouchableOpacity: RN.TouchableOpacity,
  };
});

jest.mock('@features/budget/local/receiptAliases', () => ({
  listAliasHints: jest.fn(async () => []),
  recordNameRename: jest.fn(),
}));

// The section exists only on the full Budget brand over the local ledger.
jest.mock('@brand/capabilities', () => ({
  ...jest.requireActual('@brand/capabilities'),
  isFullBudget: () => true,
}));
jest.mock('@features/budget/local/flag', () => ({ isBudgetLocalFirst: () => true }));

const mockApi = {
  getCategories: jest.fn(),
  getExpenses: jest.fn(),
  getQuickAddSuggestions: jest.fn(),
  getExpense: jest.fn(),
  addExpense: jest.fn(),
  updateExpense: jest.fn(),
  getBulkSuggestion: jest.fn(),
};
jest.mock('@api/budget', () => ({
  budgetApi: {
    getCategories: (...a: unknown[]) => mockApi.getCategories(...a),
    getExpenses: (...a: unknown[]) => mockApi.getExpenses(...a),
    getQuickAddSuggestions: (...a: unknown[]) => mockApi.getQuickAddSuggestions(...a),
    getExpense: (...a: unknown[]) => mockApi.getExpense(...a),
    addExpense: (...a: unknown[]) => mockApi.addExpense(...a),
    updateExpense: (...a: unknown[]) => mockApi.updateExpense(...a),
    getBulkSuggestion: (...a: unknown[]) => mockApi.getBulkSuggestion(...a),
  },
  isCategoryNameConflict: () => false,
}));

const mockMarkInsightsDirty = jest.fn();
jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (sel?: (s: unknown) => unknown) => {
    const s = { selectedYear: 2026, selectedMonth: 7, markInsightsDirty: mockMarkInsightsDirty };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-bulk' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { BudgetCategory, BulkSuggestionResponse, Expense } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';

import { formatBudgetCurrency } from '../budgetFormat';
import { BudgetItemFormScreen } from '../BudgetItemFormScreen';

/** Every rendered string, flattened — substring assertions across text nodes. */
const textOf = (renderer: ReactTestRenderer.ReactTestRenderer) => JSON.stringify(renderer.toJSON());

const CATEGORY: BudgetCategory = {
  id: 'cat-fish',
  household_id: 'hh-bulk',
  name: 'Fish',
  icon: '🐟',
  color: '#4C8DFF',
  sort_order: 0,
  created_at: '2026-07-01T00:00:00Z',
};

function suggestionResponse(months: number): BulkSuggestionResponse {
  return {
    suggestion: {
      months,
      rawMonths: months,
      basis: 'product_rate',
      confidence: 'high',
      looksRegularSize: false,
      evidence: {
        productLabel: 'Salmon',
        eventCount: 3,
        firstEventDate: '2026-03-10',
        monthlyRateCents: 5000,
        medianGapDays: 60,
        relatedLabels: [],
        categoryName: 'Fish',
        precedentMonths: null,
        unit: null,
      },
    },
    monthContext: Array.from({ length: 12 }, (_, i) => {
      const index = 2026 * 12 + 6 + i;
      const year = Math.floor(index / 12);
      const month = index - year * 12 + 1;
      return {
        month: `${year}-${String(month).padStart(2, '0')}`,
        plannedBudget: i === 0 ? 200000 : null,
        countedCents: i === 0 ? 150000 : 0,
      };
    }),
  };
}

const BULK_EXPENSE: Expense = {
  id: 'exp-salmon',
  household_id: 'hh-bulk',
  budget_item_id: null,
  category_id: 'cat-fish',
  title: 'Salmon',
  description: null,
  amount: 40000,
  saved_amount: 0,
  expense_date: '2026-07-10',
  vendor: 'Costco',
  receipt_key: null,
  created_by: null,
  created_at: '2026-07-10T00:00:00Z',
  bulk: { months: 4, start_month: '2026-07', suggested_months: 3, basis: 'default' },
};

let tree: ReactTestRenderer.ReactTestRenderer;

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

async function renderScreen() {
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetItemFormScreen />
      </ThemeProvider>
    );
  });
  await flush();
  return tree;
}

const byTestID = (id: string) => tree.root.find((n) => n.props?.testID === id);
const maybeByTestID = (id: string) => tree.root.findAll((n) => n.props?.testID === id);

async function setInput(id: string, value: string) {
  await act(async () => {
    byTestID(id).props.onChangeText(value);
    await Promise.resolve();
  });
  await flush();
}

async function press(id: string) {
  await act(async () => {
    byTestID(id).props.onPress();
    await Promise.resolve();
  });
  await flush();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = { kind: 'spent' };
  mockApi.getCategories.mockResolvedValue({ categories: [CATEGORY] });
  mockApi.getExpenses.mockResolvedValue({ expenses: [] });
  mockApi.getQuickAddSuggestions.mockResolvedValue({ recent: [], popular: [] });
  mockApi.getBulkSuggestion.mockResolvedValue(suggestionResponse(4));
  mockApi.addExpense.mockResolvedValue({ expense: BULK_EXPENSE });
  mockApi.updateExpense.mockResolvedValue({ expense: { ...BULK_EXPENSE, bulk: null } });
});

describe('BudgetItemFormScreen — bulk purchase', () => {
  it('estimates from the ledger when the toggle turns on and saves the plan', async () => {
    await renderScreen();
    expect(maybeByTestID('budget-item-bulk-card')).toHaveLength(0);

    await setInput('budget-item-title', 'Salmon');
    await setInput('budget-item-cost-exact', '400');
    await press('budget-item-bulk-toggle');

    expect(mockApi.getBulkSuggestion).toHaveBeenCalledWith(
      'hh-bulk',
      expect.objectContaining({
        title: 'Salmon',
        amount: 40000,
        saved_amount: 0,
        expense_date: '2026-07-01',
        exclude_expense_id: null,
      })
    );

    const text = textOf(tree);
    expect(text).toContain('4 months');
    expect(text).toContain(
      `Based on 3 purchases of Salmon since March, about ${formatBudgetCurrency(5000)} a month.`
    );
    expect(maybeByTestID('budget-item-bulk-preview-3').length).toBeGreaterThan(0);
    expect(maybeByTestID('budget-item-bulk-preview-4')).toHaveLength(0);
    // July has a $2,000 cap with $1,500 already counted: $400 left after this $100 share.
    expect(text).toContain(`${formatBudgetCurrency(40000)} left after this`);
    expect(text).toContain('No budget set yet');
    expect(text).toContain(
      `This month counts ${formatBudgetCurrency(10000)} of ${formatBudgetCurrency(40000)}.`
    );
    expect(maybeByTestID('budget-item-bulk-closed-note')).toHaveLength(0);

    await press('budget-item-form-save-header');
    expect(mockApi.addExpense).toHaveBeenCalledWith(
      'hh-bulk',
      expect.objectContaining({
        title: 'Salmon',
        amount: 40000,
        bulk: { months: 4, suggested_months: 4, basis: 'product_rate' },
      })
    );
  });

  it('keeps the member’s stepper choice over a later estimate', async () => {
    await renderScreen();
    await setInput('budget-item-cost-exact', '400');
    await press('budget-item-bulk-toggle');
    await press('budget-item-bulk-plus');
    await press('budget-item-bulk-plus');
    expect(textOf(tree)).toContain('6 months');

    // A new name re-estimates (to 4 again) but must not move the stepper.
    mockApi.getBulkSuggestion.mockResolvedValue(suggestionResponse(4));
    await setInput('budget-item-title', 'Salmon fillets');
    expect(mockApi.getBulkSuggestion.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(textOf(tree)).toContain('6 months');

    await press('budget-item-form-save-header');
    expect(mockApi.addExpense).toHaveBeenCalledWith(
      'hh-bulk',
      expect.objectContaining({ bulk: { months: 6, suggested_months: 4, basis: 'product_rate' } })
    );
  });

  it('never spreads an ordinary spending', async () => {
    await renderScreen();
    await setInput('budget-item-title', 'Bread');
    await setInput('budget-item-cost-exact', '5');
    await press('budget-item-form-save-header');
    expect(mockApi.getBulkSuggestion).not.toHaveBeenCalled();
    const payload = mockApi.addExpense.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('bulk');
  });

  it('loads a saved plan as the member’s decision and clears it with the toggle', async () => {
    mockRouteParams = { expenseId: BULK_EXPENSE.id };
    mockApi.getExpense.mockResolvedValue({ expense: BULK_EXPENSE });
    mockApi.getBulkSuggestion.mockResolvedValue(suggestionResponse(3));
    await renderScreen();

    expect(byTestID('budget-item-bulk-toggle').props.accessibilityState).toEqual({ checked: true });
    // Estimate said 3; the saved plan said 4 and the saved plan stays.
    expect(textOf(tree)).toContain('4 months');
    expect(mockApi.getBulkSuggestion).toHaveBeenCalledWith(
      'hh-bulk',
      expect.objectContaining({ exclude_expense_id: BULK_EXPENSE.id })
    );
    // July 2026 is behind us: re-spreading rewrites closed months, and it says so.
    expect(maybeByTestID('budget-item-bulk-closed-note').length).toBeGreaterThan(0);

    await press('budget-item-bulk-toggle');
    expect(maybeByTestID('budget-item-bulk-card')).toHaveLength(0);
    await press('budget-item-form-save-header');
    expect(mockApi.updateExpense).toHaveBeenCalledWith(
      'hh-bulk',
      BULK_EXPENSE.id,
      expect.objectContaining({ bulk: null })
    );
  });
});
