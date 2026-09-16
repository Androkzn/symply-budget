/**
 * BudgetSubBudgetsScreen — the nested "Manage Sub-budgets" screen reached from
 * Budget Settings. Covers: loading caps + categories, rendering per-category
 * progress (spent/left + over state), the over-allocation banner, the empty
 * state, adding a fixed-amount cap for all months, adding a percent cap scoped to
 * the selected month, and removing an existing cap.
 */
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
    // The screen refetches caps on focus (via expo-router/react-navigation,
    // which re-exports this module). Run the callback the way a real focus
    // would, or every assertion below renders against an empty screen.
    useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
  };
});

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    // Mirrors `OverlaySheetHeader`: the sheet's glass ✕ (carrying `closeTestID`)
    // and an optional trailing commit — the "Done" these pickers used to end in
    // is now the ✕, so a flow driving that id still finds it here.
    OverlaySheetHeader: ({ title, onClose, closeTestID, action }: Record<string, any>) =>
      React.createElement(
        View,
        null,
        title ? React.createElement(Text, null, title) : null,
        React.createElement(TouchableOpacity, { onPress: onClose, testID: closeTestID }),
        action
          ? React.createElement(
              TouchableOpacity,
              { onPress: action.onPress, testID: action.testID },
              React.createElement(Text, null, action.label)
            )
          : null
      ),
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenHeader: ({ title, showBackButton, onBackPress }: { title?: string; showBackButton?: boolean; onBackPress?: () => void }) =>
      React.createElement(
        View,
        null,
        title ? React.createElement(Text, null, title) : null,
        showBackButton
          ? React.createElement(TouchableOpacity, { onPress: onBackPress, testID: 'nav-back-button' })
          : null
      ),
  };
});

const mockGetSubBudgets = jest.fn();
const mockGetCategories = jest.fn();
const mockUpsertSubBudget = jest.fn();
const mockDeleteSubBudget = jest.fn();
const mockCreateCategory = jest.fn();
const mockUpdateCategory = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    getSubBudgets: (...a: unknown[]) => mockGetSubBudgets(...a),
    getCategories: (...a: unknown[]) => mockGetCategories(...a),
    upsertSubBudget: (...a: unknown[]) => mockUpsertSubBudget(...a),
    deleteSubBudget: (...a: unknown[]) => mockDeleteSubBudget(...a),
    createCategory: (...a: unknown[]) => mockCreateCategory(...a),
    updateCategory: (...a: unknown[]) => mockUpdateCategory(...a),
  },
  // Mirrors the real predicate without pulling axios into the mock.
  isCategoryNameConflict: (error: { name?: string; response?: { status?: number } } | null) =>
    error?.name === 'CategoryNameConflictError' || error?.response?.status === 409,
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
    const s = { currentHousehold: { id: 'hh-consistency' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@hooks/useDeviceType', () => ({
  useDeviceType: () => ({ isIPad: false, width: 390, height: 844, isPhone: true }),
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { SubBudgetProgress } from '@api/budget';
import { FilterTabs } from '@components/ui';
import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../test-utils/budgetConsistency';
import { BudgetSubBudgetsScreen } from '../BudgetSubBudgetsScreen';

const ALCOHOL: SubBudgetProgress = {
  category_id: 'cat-alcohol',
  name: 'Alcohol & Bars',
  icon: '🍷',
  color: '#8E24AA',
  limit_type: 'amount',
  percent_bps: null,
  cap_cents: 10000,
  spent_cents: 12000,
  remaining_cents: -2000,
  over: true,
  scope: 'default',
};

const COFFEE: SubBudgetProgress = {
  category_id: 'cat-coffee',
  name: 'Coffee & Snacks',
  icon: '☕',
  color: '#6D4C41',
  limit_type: 'amount',
  percent_bps: null,
  cap_cents: 5000,
  spent_cents: 3000,
  remaining_cents: 2000,
  over: false,
  scope: 'default',
};

const CATEGORIES = [
  { id: 'cat-alcohol', household_id: 'hh-consistency', name: 'Alcohol & Bars', icon: '🍷', color: '#8E24AA', sort_order: 0, created_at: 'x', is_default: true, hidden: false },
  { id: 'cat-coffee', household_id: 'hh-consistency', name: 'Coffee & Snacks', icon: '☕', color: '#6D4C41', sort_order: 1, created_at: 'x', is_default: true, hidden: false },
  { id: 'cat-groceries', household_id: 'hh-consistency', name: 'Groceries', icon: '🛒', color: '#43A047', sort_order: 2, created_at: 'x', is_default: true, hidden: false },
];

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetSubBudgetsScreen />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

const findByTestID = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.find((n) => n.props?.testID === id);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSubBudgets.mockResolvedValue({
    subBudgets: [ALCOHOL, COFFEE],
    totals: { totalCapCents: 15000, plannedBudget: 100000, overAllocatedBy: 0 },
    rows: [],
  });
  mockGetCategories.mockResolvedValue({ categories: CATEGORIES });
  mockUpsertSubBudget.mockResolvedValue({ subBudget: {} });
  mockDeleteSubBudget.mockResolvedValue({});
  mockCreateCategory.mockResolvedValue({
    category: { ...CATEGORIES[0], id: 'cat-new', name: 'Cat show fees', is_default: false },
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('BudgetSubBudgetsScreen', () => {
  it('loads caps + categories for the selected month', async () => {
    await renderScreen();
    expect(mockGetSubBudgets).toHaveBeenCalledWith('hh-consistency', 2026, 7);
    expect(mockGetCategories).toHaveBeenCalledWith('hh-consistency');
  });

  it('renders each cap with spend and an over state', async () => {
    const tree = await renderScreen();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('Alcohol & Bars');
    expect(texts).toContain('Coffee & Snacks');
    // Alcohol is over its cap; Coffee has money left.
    expect(texts.some((t) => t.includes('over'))).toBe(true);
    expect(texts.some((t) => t.includes('left'))).toBe(true);
    expect(findByTestID(tree, 'budget-sub-budget-cat-alcohol')).toBeTruthy();
  });

  it('shows the over-allocation banner when caps exceed the total', async () => {
    mockGetSubBudgets.mockResolvedValue({
      subBudgets: [ALCOHOL],
      totals: { totalCapCents: 130000, plannedBudget: 100000, overAllocatedBy: 30000 },
      rows: [],
    });
    const tree = await renderScreen();
    expect(findByTestID(tree, 'budget-sub-budgets-overallocated')).toBeTruthy();
  });

  it('renders an empty state with no caps', async () => {
    mockGetSubBudgets.mockResolvedValue({
      subBudgets: [],
      totals: { totalCapCents: 0, plannedBudget: 100000, overAllocatedBy: 0 },
      rows: [],
    });
    const tree = await renderScreen();
    expect(findByTestID(tree, 'budget-sub-budgets-empty')).toBeTruthy();
  });

  it('adds a fixed-amount cap for all months', async () => {
    const tree = await renderScreen();
    // Open the editor.
    act(() => findByTestID(tree, 'budget-sub-budget-add').props.onPress());
    // Open the category picker, then pick a category.
    act(() => findByTestID(tree, 'budget-sub-budget-category-picker').props.onPress());
    act(() => findByTestID(tree, 'budget-sub-budget-category-cat-groceries').props.onPress());
    // Enter a dollar amount.
    const valueInput = tree.root.find(
      (n) => n.props?.testID === 'budget-sub-budget-value' && typeof n.props?.onChangeText === 'function'
    );
    act(() => valueInput.props.onChangeText('150'));
    // Save.
    await act(async () => {
      findByTestID(tree, 'budget-sub-budget-save').props.onPress();
      await Promise.resolve();
    });
    expect(mockUpsertSubBudget).toHaveBeenCalledWith('hh-consistency', {
      category_id: 'cat-groceries',
      year: 2026,
      month: null,
      limit_type: 'amount',
      amount_cents: 15000,
      percent_bps: null,
    });
    expect(mockMarkInsightsDirty).toHaveBeenCalledWith('hh-consistency');
  });

  it('caps a category created from inside the picker', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-sub-budget-add').props.onPress());
    act(() => findByTestID(tree, 'budget-sub-budget-category-picker').props.onPress());

    const search = findByTestID(tree, 'budget-sub-budget-category-search');
    act(() => search.props.onChangeText('Cat show fees'));
    await act(async () => {
      findByTestID(tree, 'budget-sub-budget-category-create').props.onPress();
      await Promise.resolve();
    });
    expect(mockCreateCategory).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ name: 'Cat show fees' })
    );

    const valueInput = tree.root.find(
      (n) => n.props?.testID === 'budget-sub-budget-value' && typeof n.props?.onChangeText === 'function'
    );
    act(() => valueInput.props.onChangeText('20'));
    await act(async () => {
      findByTestID(tree, 'budget-sub-budget-save').props.onPress();
      await Promise.resolve();
    });
    expect(mockUpsertSubBudget).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ category_id: 'cat-new', amount_cents: 2000 })
    );
  });

  it('adds a percent cap scoped to the selected month', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-sub-budget-add').props.onPress());
    act(() => findByTestID(tree, 'budget-sub-budget-category-picker').props.onPress());
    act(() => findByTestID(tree, 'budget-sub-budget-category-cat-groceries').props.onPress());

    // First FilterTabs = limit type, second = scope.
    const tabs = tree.root.findAllByType(FilterTabs);
    act(() => tabs[0].props.onTabChange('percent'));
    act(() => tabs[1].props.onTabChange('month'));

    const valueInput = tree.root.find(
      (n) => n.props?.testID === 'budget-sub-budget-value' && typeof n.props?.onChangeText === 'function'
    );
    act(() => valueInput.props.onChangeText('10'));

    await act(async () => {
      findByTestID(tree, 'budget-sub-budget-save').props.onPress();
      await Promise.resolve();
    });
    expect(mockUpsertSubBudget).toHaveBeenCalledWith('hh-consistency', {
      category_id: 'cat-groceries',
      year: 2026,
      month: 7,
      limit_type: 'percent',
      amount_cents: null,
      percent_bps: 1000,
    });
  });

  it('removes an existing cap after confirmation', async () => {
    const tree = await renderScreen();
    // Tap a row to edit, then Remove.
    act(() => findByTestID(tree, 'budget-sub-budget-cat-coffee').props.onPress());
    act(() => findByTestID(tree, 'budget-sub-budget-remove').props.onPress());
    const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Remove sub-budget');
    const buttons = call![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Remove')!.onPress?.();
      await Promise.resolve();
    });
    expect(mockDeleteSubBudget).toHaveBeenCalledWith('hh-consistency', {
      category_id: 'cat-coffee',
      year: 2026,
      month: null,
    });
  });

  it('goes back from the header back button', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'nav-back-button').props.onPress());
    expect(mockGoBack).toHaveBeenCalled();
  });
});

describe('BudgetSubBudgetsScreen — response rendering + validation quality', () => {
  const findValueInput = (tree: ReactTestRenderer.ReactTestRenderer) =>
    tree.root.find(
      (n) => n.props?.testID === 'budget-sub-budget-value' && typeof n.props?.onChangeText === 'function'
    );

  it('shows a loading spinner before caps + categories resolve', async () => {
    // Hold the load open so we can observe the pre-data state.
    let release!: () => void;
    mockGetSubBudgets.mockReturnValue(new Promise((r) => { release = () => r({ subBudgets: [], totals: { totalCapCents: 0, plannedBudget: 100000, overAllocatedBy: 0 }, rows: [] }); }));
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <BudgetSubBudgetsScreen />
        </ThemeProvider>
      );
    });
    expect(findByTestID(tree, 'budget-sub-budgets-loading')).toBeTruthy();
    await act(async () => { release(); await Promise.resolve(); });
  });

  it('renders a percent cap as "% · resolved dollars"', async () => {
    mockGetSubBudgets.mockResolvedValue({
      subBudgets: [
        { ...COFFEE, limit_type: 'percent', percent_bps: 1000, cap_cents: 10000, spent_cents: 3000, remaining_cents: 7000, over: false },
      ],
      totals: { totalCapCents: 10000, plannedBudget: 100000, overAllocatedBy: 0 },
      rows: [],
    });
    const tree = await renderScreen();
    const texts = collectRenderedText(tree);
    // Meta line: "10% · $100.00".
    expect(texts.some((t) => t.includes('10%') && t.includes('100'))).toBe(true);
  });

  it('prefills the editor and locks the category when editing an existing cap', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-sub-budget-cat-alcohol').props.onPress());
    // Amount cap $100.00 prefilled.
    expect(findValueInput(tree).props.value).toBe('100');
    // Category is locked while editing (can't move a cap to another category).
    expect(findByTestID(tree, 'budget-sub-budget-category-picker').props.disabled).toBe(true);
    // Remove action only exists in edit mode.
    expect(findByTestID(tree, 'budget-sub-budget-remove')).toBeTruthy();
  });

  it('blocks a percent over 100% and never calls the API', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-sub-budget-add').props.onPress());
    act(() => findByTestID(tree, 'budget-sub-budget-category-picker').props.onPress());
    act(() => findByTestID(tree, 'budget-sub-budget-category-cat-groceries').props.onPress());
    const tabs = tree.root.findAllByType(FilterTabs);
    act(() => tabs[0].props.onTabChange('percent'));
    act(() => findValueInput(tree).props.onChangeText('150'));
    await act(async () => {
      findByTestID(tree, 'budget-sub-budget-save').props.onPress();
      await Promise.resolve();
    });
    expect((Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Invalid percent')).toBe(true);
    expect(mockUpsertSubBudget).not.toHaveBeenCalled();
  });

  it('blocks a non-numeric / negative amount and never calls the API', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-sub-budget-add').props.onPress());
    act(() => findByTestID(tree, 'budget-sub-budget-category-picker').props.onPress());
    act(() => findByTestID(tree, 'budget-sub-budget-category-cat-groceries').props.onPress());
    act(() => findValueInput(tree).props.onChangeText('-5'));
    await act(async () => {
      findByTestID(tree, 'budget-sub-budget-save').props.onPress();
      await Promise.resolve();
    });
    expect((Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Invalid amount')).toBe(true);
    expect(mockUpsertSubBudget).not.toHaveBeenCalled();
  });

  it('requires a category before saving', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-sub-budget-add').props.onPress());
    act(() => findValueInput(tree).props.onChangeText('100'));
    await act(async () => {
      findByTestID(tree, 'budget-sub-budget-save').props.onPress();
      await Promise.resolve();
    });
    expect((Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Pick a category')).toBe(true);
    expect(mockUpsertSubBudget).not.toHaveBeenCalled();
  });

  it('surfaces a friendly error when the save API fails', async () => {
    mockUpsertSubBudget.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-sub-budget-add').props.onPress());
    act(() => findByTestID(tree, 'budget-sub-budget-category-picker').props.onPress());
    act(() => findByTestID(tree, 'budget-sub-budget-category-cat-groceries').props.onPress());
    act(() => findValueInput(tree).props.onChangeText('100'));
    await act(async () => {
      findByTestID(tree, 'budget-sub-budget-save').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Error')).toBe(true);
  });
});
