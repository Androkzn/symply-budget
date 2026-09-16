/**
 * BudgetItemFormScreen — the create/edit form for planned items and spendings.
 * This is the largest budget screen; the suite drives every top-level branch:
 *   • add planned (create) + validation
 *   • add spent (addExpense) + amount validation
 *   • kind-locked entry (route.params.kind)
 *   • edit planned (getItem → updateItem)
 *   • edit expense (getExpense → updateExpense)
 *   • expenseDraft prefill
 *   • cost mode exact/range
 *   • category picker open/search/select
 *   • quick-add suggestion apply
 *   • when-mode specific date
 *   • save error handling
 *
 * Every interaction is wrapped in `await act(async …)` because several presses
 * (e.g. the Planned/Spent toggle) kick off async effects (getQuickAddSuggestions);
 * a bare synchronous act() would leave overlapping act scopes and tear the tree.
 */
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: Record<string, unknown> = {};

// Stable navigation object — the expense-loading effect lists `navigation` in
// its deps, so a fresh object each render would loop forever.
const mockNav = { navigate: mockNavigate, goBack: mockGoBack };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockRouteParams }),
}));

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
    ScreenHeader: ({
      title,
      showBackButton,
      onBackPress,
      rightElement,
    }: {
      title?: string;
      showBackButton?: boolean;
      onBackPress?: () => void;
      rightElement?: React.ReactNode;
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
          : null,
        rightElement ?? null
      ),
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

// Mutable so a describe block can flip the form between phone and iPad. Only
// dereferenced when useDeviceType() runs at render, so no hoist/TDZ issue.
let mockDeviceInfo: { isIPad: boolean; width: number } = { isIPad: false, width: 390 };
jest.mock('@hooks/useDeviceType', () => ({
  useDeviceType: () => mockDeviceInfo,
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

// The name shortcut bubbles read the spending history and the household's
// remembered renames; both are stubbed so a test can decide what this
// household "usually calls" a thing.
const mockListAliasHints = jest.fn();
const mockRecordNameRename = jest.fn();
jest.mock('@features/budget/local/receiptAliases', () => ({
  listAliasHints: (...a: unknown[]) => mockListAliasHints(...a),
  recordNameRename: (...a: unknown[]) => mockRecordNameRename(...a),
}));

const mockApi = {
  getCategories: jest.fn(),
  getExpenses: jest.fn(),
  getQuickAddSuggestions: jest.fn(),
  getItem: jest.fn(),
  getExpense: jest.fn(),
  createItem: jest.fn(),
  updateItem: jest.fn(),
  addExpense: jest.fn(),
  updateExpense: jest.fn(),
  createCategory: jest.fn(),
  updateCategory: jest.fn(),
};
jest.mock('@api/budget', () => ({
  budgetApi: {
    getCategories: (...a: unknown[]) => mockApi.getCategories(...a),
    getExpenses: (...a: unknown[]) => mockApi.getExpenses(...a),
    getQuickAddSuggestions: (...a: unknown[]) => mockApi.getQuickAddSuggestions(...a),
    getItem: (...a: unknown[]) => mockApi.getItem(...a),
    getExpense: (...a: unknown[]) => mockApi.getExpense(...a),
    createItem: (...a: unknown[]) => mockApi.createItem(...a),
    updateItem: (...a: unknown[]) => mockApi.updateItem(...a),
    addExpense: (...a: unknown[]) => mockApi.addExpense(...a),
    updateExpense: (...a: unknown[]) => mockApi.updateExpense(...a),
    createCategory: (...a: unknown[]) => mockApi.createCategory(...a),
    updateCategory: (...a: unknown[]) => mockApi.updateCategory(...a),
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

// Validation + save-failure UX moved from Alert.alert to showToast('error', …).
jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { BudgetCategory, BudgetItem, Expense } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';
import { showToast } from '@services/toastManager';
import { useAppStore } from '@stores/appStore';

import { collectRenderedText } from '../../../test-utils/budgetConsistency';
import { BudgetItemFormScreen } from '../BudgetItemFormScreen';
import { dateForThisMonth, toLocalYMD } from '../budgetItemFormUtils';

const CATEGORY: BudgetCategory = {
  id: 'cat-food',
  household_id: 'hh-consistency',
  name: 'Food',
  icon: '🍎',
  color: '#EF5350',
  sort_order: 0,
  created_at: '2026-07-01T00:00:00Z',
};

const CATEGORY_2: BudgetCategory = { ...CATEGORY, id: 'cat-home', name: 'Home', icon: '🏠' };

/** What the server hands back for a category created from inside the picker. */
const NEW_CATEGORY: BudgetCategory = {
  ...CATEGORY,
  id: 'cat-new',
  name: 'Cat show fees',
  icon: 'tag',
};

/** A default the household toggled off — absent from the picker, still on file. */
const HIDDEN_CATEGORY: BudgetCategory = {
  ...CATEGORY,
  id: 'cat-pets',
  name: 'Pets',
  is_default: true,
  hidden: true,
};

const PLANNED_ITEM: BudgetItem = {
  id: 'bi-filter',
  household_id: 'hh-consistency',
  category_id: 'cat-food',
  timeframe: 'immediate',
  year: 2026,
  quarter: null,
  title: 'Water filter',
  description: 'Replace filter',
  estimated_cost_min: 20000,
  estimated_cost_max: 30000,
  actual_cost: null,
  priority: 'high',
  status: 'planned',
  is_recurring: false,
  recurrence_frequency: null,
  source_type: null,
  source_id: null,
  target_date: '2026-07-20',
  completed_at: null,
  created_by: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

const EXPENSE: Expense = {
  id: 'exp-1',
  household_id: 'hh-consistency',
  budget_item_id: null,
  category_id: 'cat-food',
  title: 'Groceries',
  description: null,
  amount: 12500,
  saved_amount: 0,
  expense_date: '2026-07-10',
  vendor: null,
  receipt_key: null,
  created_by: null,
  created_at: '2026-07-10T00:00:00Z',
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
}

async function press(id: string) {
  await act(async () => {
    byTestID(id).props.onPress();
    await Promise.resolve();
  });
  await flush();
}

/**
 * Presses Save — whichever affordance the form currently renders (the footer
 * button, or the header action); both run the same `runSaveAfterNativeFlush`
 * path. A form with nothing to save renders NO Save at all, and this models
 * that faithfully by pressing nothing: the user has no way to write.
 */
async function save() {
  const target =
    maybeByTestID('budget-item-form-save')[0] ?? maybeByTestID('budget-item-form-save-header')[0];
  if (!target) return;
  await act(async () => {
    target.props.onPress();
    await Promise.resolve();
  });
  await flush();
}

afterEach(async () => {
  await flush();
  await act(async () => {
    try {
      tree?.unmount();
    } catch {
      /* already unmounted */
    }
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = {};
  mockApi.getCategories.mockResolvedValue({ categories: [CATEGORY, CATEGORY_2] });
  mockApi.getExpenses.mockResolvedValue({ expenses: [] });
  mockListAliasHints.mockResolvedValue([]);
  mockRecordNameRename.mockResolvedValue(undefined);
  mockApi.getQuickAddSuggestions.mockResolvedValue({ recent: [], popular: [] });
  mockApi.getItem.mockResolvedValue({ item: PLANNED_ITEM });
  mockApi.getExpense.mockResolvedValue({ expense: EXPENSE });
  mockApi.createItem.mockResolvedValue({});
  mockApi.updateItem.mockResolvedValue({});
  mockApi.addExpense.mockResolvedValue({});
  mockApi.updateExpense.mockResolvedValue({});
  mockApi.createCategory.mockResolvedValue({ category: NEW_CATEGORY });
  mockApi.updateCategory.mockResolvedValue({ category: { ...HIDDEN_CATEGORY, hidden: false } });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('BudgetItemFormScreen — add planned', () => {
  it('renders the planned form with title, type and category picker', async () => {
    await renderScreen();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('Add planned spending');
    expect(texts).toContain('Planned spending');
    expect(texts).toContain('Already spent');
    expect(byTestID('budget-item-title')).toBeTruthy();
    expect(byTestID('budget-item-category-picker')).toBeTruthy();
    expect(mockApi.getCategories).toHaveBeenCalledWith('hh-consistency');
    expect(mockApi.getQuickAddSuggestions).toHaveBeenCalledWith('hh-consistency', 'planned');
  });

  it('blocks saving with an empty title', async () => {
    await renderScreen();
    // A blank (whitespace) title marks the form dirty so Save runs, then the
    // title guard rejects it — createItem never fires.
    await setInput('budget-item-title', '   ');
    await save();
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('name'));
    expect(mockApi.createItem).not.toHaveBeenCalled();
  });

  it('creates an exact-cost planned item', async () => {
    await renderScreen();
    await setInput('budget-item-title', 'Water filter');
    await setInput('budget-item-cost-exact', '250');
    await save();
    expect(mockApi.createItem).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({
        title: 'Water filter',
        estimated_cost_min: 25000,
        estimated_cost_max: 25000,
        priority: 'medium',
        timeframe: 'immediate',
      })
    );
    expect(mockMarkInsightsDirty).toHaveBeenCalledWith('hh-consistency');
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('creates a range-cost planned item after switching to Range', async () => {
    await renderScreen();
    await setInput('budget-item-title', 'Roof');
    await press('budget-item-cost-mode-range');
    await setInput('budget-item-cost-min', '100');
    await setInput('budget-item-cost-max', '200');
    await save();
    expect(mockApi.createItem).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ estimated_cost_min: 10000, estimated_cost_max: 20000 })
    );
  });

  it('changes the priority selection', async () => {
    await renderScreen();
    await setInput('budget-item-title', 'Critical fix');
    await setInput('budget-item-cost-exact', '10');
    await press('budget-item-priority-critical');
    await save();
    expect(mockApi.createItem).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ priority: 'critical' })
    );
  });

  it('surfaces an alert when the save API rejects', async () => {
    mockApi.createItem.mockRejectedValue(new Error('boom'));
    await renderScreen();
    await setInput('budget-item-title', 'X');
    await setInput('budget-item-cost-exact', '5');
    await save();
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('save'));
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});

describe('BudgetItemFormScreen — add spent', () => {
  it('switches to the spent form and records an expense', async () => {
    await renderScreen();
    await press('budget-item-kind-spent');
    await setInput('budget-item-title', 'Groceries');
    await setInput('budget-item-cost-exact', '125');
    await save();
    expect(mockApi.addExpense).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ title: 'Groceries', amount: 12500, vendor: 'Other' })
    );
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('saves an optional store name on spent items', async () => {
    await renderScreen();
    await press('budget-item-kind-spent');
    await setInput('budget-item-title', 'Milk');
    await setInput('budget-item-cost-exact', '4.50');
    await setInput('budget-item-store', 'Costco');
    await save();
    expect(mockApi.addExpense).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ title: 'Milk', vendor: 'Costco' })
    );
  });

  it('blocks a spent save with no amount', async () => {
    await renderScreen();
    await press('budget-item-kind-spent');
    await setInput('budget-item-title', 'Groceries');
    await save();
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('how much you spent'));
    expect(mockApi.addExpense).not.toHaveBeenCalled();
  });

  it('opens the spent date picker', async () => {
    await renderScreen();
    await press('budget-item-kind-spent');
    await press('budget-item-spent-date-picker');
    expect(maybeByTestID('date-time-picker').length).toBeGreaterThanOrEqual(1);
  });

  it('prefills the form from a quick-add draft passed in the route', async () => {
    mockRouteParams = {
      kind: 'spent',
      quickAddDraft: {
        title: 'Greek Yogurt',
        description: null,
        category_id: null,
        amount: 1100,
        estimated_cost_min: 1100,
        estimated_cost_max: 1100,
        priority: 'medium',
        is_recurring: false,
        recurrence_frequency: null,
        usage_count: 4,
        last_used_at: '2026-07-10T00:00:00Z',
      },
    };
    await renderScreen();
    expect(byTestID('budget-item-title').props.value).toBe('Greek Yogurt');
    expect(byTestID('budget-item-cost-exact').props.value).toBe('11');
    // A prefill leaves the form dirty so Save writes immediately without edits.
    await save();
    expect(mockApi.addExpense).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ title: 'Greek Yogurt', amount: 1100 })
    );
  });
});

describe('BudgetItemFormScreen — quick-add draft prefill', () => {
  const spentDraft = (overrides: Record<string, unknown> = {}) => ({
    title: 'Oat Milk',
    description: null,
    category_id: 'cat-food',
    amount: 650,
    estimated_cost_min: 650,
    estimated_cost_max: 650,
    priority: 'medium' as const,
    is_recurring: false,
    recurrence_frequency: null,
    usage_count: 2,
    last_used_at: '2026-07-10T00:00:00Z',
    ...overrides,
  });

  const plannedDraft = (overrides: Record<string, unknown> = {}) => ({
    title: 'New Fridge',
    description: 'Replace the old one',
    category_id: 'cat-home',
    amount: null,
    estimated_cost_min: 80000,
    estimated_cost_max: 120000,
    priority: 'high' as const,
    is_recurring: false,
    recurrence_frequency: null,
    usage_count: 1,
    last_used_at: '2026-07-01T00:00:00Z',
    ...overrides,
  });

  it('prefills a spent form and resolves the draft category label', async () => {
    mockRouteParams = { kind: 'spent', quickAddDraft: spentDraft() };
    await renderScreen();
    expect(byTestID('budget-item-title').props.value).toBe('Oat Milk');
    expect(byTestID('budget-item-cost-exact').props.value).toBe('6.5');
    await save();
    // The draft category_id is carried through to the write.
    expect(mockApi.addExpense).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ title: 'Oat Milk', amount: 650, category_id: 'cat-food' })
    );
  });

  it('prefills a planned form with a cost RANGE (min ≠ max) and priority', async () => {
    mockRouteParams = { kind: 'planned', quickAddDraft: plannedDraft() };
    await renderScreen();
    expect(byTestID('budget-item-title').props.value).toBe('New Fridge');
    // A min≠max suggestion opens in range mode with both bounds populated.
    expect(byTestID('budget-item-cost-min').props.value).toBe('800');
    expect(byTestID('budget-item-cost-max').props.value).toBe('1200');
    await save();
    expect(mockApi.createItem).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({
        title: 'New Fridge',
        estimated_cost_min: 80000,
        estimated_cost_max: 120000,
        category_id: 'cat-home',
      })
    );
  });

  it('prefills a planned form with an EXACT cost when min === max', async () => {
    mockRouteParams = {
      kind: 'planned',
      quickAddDraft: plannedDraft({ estimated_cost_min: 5000, estimated_cost_max: 5000 }),
    };
    await renderScreen();
    expect(byTestID('budget-item-cost-exact').props.value).toBe('50');
    expect(maybeByTestID('budget-item-cost-min')).toHaveLength(0);
  });

  it('keeps user edits after prefill (prefill applies once, never clobbers)', async () => {
    mockRouteParams = { kind: 'spent', quickAddDraft: spentDraft() };
    await renderScreen();
    await setInput('budget-item-title', 'My Edited Title');
    // Extra async settle (mirrors quick-add/category effects re-rendering) must
    // NOT re-run the one-shot prefill and overwrite the edit.
    await flush();
    expect(byTestID('budget-item-title').props.value).toBe('My Edited Title');
    await save();
    expect(mockApi.addExpense).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ title: 'My Edited Title' })
    );
  });

  it('prefills the name from a spent draft with no amount, and Save still needs a price', async () => {
    mockRouteParams = { kind: 'spent', quickAddDraft: spentDraft({ amount: null }) };
    await renderScreen();
    // applyQuickAddSuggestion no longer no-ops on a spent chip without an
    // amount (a silent no-op read as a dead chip): the name lands and the
    // amount stays blank, so a bare Save is still blocked by money validation.
    expect(byTestID('budget-item-title').props.value).toBe('Oat Milk');
    expect(byTestID('budget-item-cost-exact').props.value).toBe('');
    await save();
    expect(mockApi.addExpense).not.toHaveBeenCalled();
  });

  it('does not prefill when editing an existing entry (draft ignored)', async () => {
    mockRouteParams = { itemId: 'bi-filter', quickAddDraft: plannedDraft() };
    await renderScreen();
    // Editing wins: the loaded item, not the stray draft, populates the form.
    expect(byTestID('budget-item-title').props.value).toBe('Water filter');
  });
});

describe('BudgetItemFormScreen — kind locked', () => {
  it('hides the type toggle when a kind is passed in the route', async () => {
    mockRouteParams = { kind: 'spent' };
    await renderScreen();
    expect(collectRenderedText(tree)).not.toContain('Planned spending');
    expect(collectRenderedText(tree)).toContain('Record spending');
    expect(mockApi.getQuickAddSuggestions).toHaveBeenCalledWith('hh-consistency', 'spent');
  });
});

describe('BudgetItemFormScreen — editing', () => {
  it('loads an existing planned item and updates it', async () => {
    mockRouteParams = { itemId: 'bi-filter' };
    await renderScreen();
    expect(mockApi.getItem).toHaveBeenCalledWith('hh-consistency', 'bi-filter');
    expect(byTestID('budget-item-cost-min').props.value).toBe('200');
    expect(byTestID('budget-item-cost-max').props.value).toBe('300');
    expect(collectRenderedText(tree)).toContain('Edit planned spending');
    // Save is gated by useUnsavedChanges — an edit is required to make the
    // loaded form dirty before updateItem will dispatch.
    await setInput('budget-item-description', 'Replace filter soon');
    await save();
    expect(mockApi.updateItem).toHaveBeenCalledWith(
      'hh-consistency',
      'bi-filter',
      expect.objectContaining({ title: 'Water filter' })
    );
  });

  it('loads an existing expense and updates it', async () => {
    mockRouteParams = { expenseId: 'exp-1' };
    await renderScreen();
    expect(mockApi.getExpense).toHaveBeenCalledWith('hh-consistency', 'exp-1');
    expect(byTestID('budget-item-cost-exact').props.value).toBe('125');
    expect(collectRenderedText(tree)).toContain('Edit spending');
    // Dirty the loaded expense (mark it on-sale) so Save runs; title/amount
    // stay untouched and must survive into the updateExpense payload.
    await press('budget-item-discount-toggle');
    await save();
    expect(mockApi.updateExpense).toHaveBeenCalledWith(
      'hh-consistency',
      'exp-1',
      expect.objectContaining({ title: 'Groceries', amount: 12500 })
    );
  });

  it('prefills instantly from an expenseDraft before the server load resolves', async () => {
    // getExpense stays pending so the optimistic draft remains on screen.
    mockApi.getExpense.mockReturnValue(new Promise(() => {}));
    mockRouteParams = {
      expenseId: 'exp-1',
      expenseDraft: { title: 'Draft lunch', amount: 4200, expense_date: '2026-07-05', category_id: 'cat-food' },
    };
    await renderScreen();
    expect(byTestID('budget-item-title').props.value).toBe('Draft lunch');
    expect(byTestID('budget-item-cost-exact').props.value).toBe('42');
  });

  it('alerts and returns when an expense fails to load without a draft', async () => {
    mockApi.getExpense.mockRejectedValue(new Error('nope'));
    mockRouteParams = { expenseId: 'exp-1' };
    await renderScreen();
    expect(Alert.alert).toHaveBeenCalledWith('Could not load spending', expect.any(String));
    expect(mockGoBack).toHaveBeenCalled();
  });
});

describe('BudgetItemFormScreen — category picker & when mode', () => {
  it('opens the category picker, searches, and selects a category', async () => {
    await renderScreen();
    await press('budget-item-category-picker');
    await setInput('budget-item-category-search', 'home');
    expect(byTestID(`budget-item-category-${CATEGORY_2.id}`)).toBeTruthy();
    expect(maybeByTestID(`budget-item-category-${CATEGORY.id}`)).toHaveLength(0);

    await press(`budget-item-category-${CATEGORY_2.id}`);
    await setInput('budget-item-title', 'With category');
    await setInput('budget-item-cost-exact', '10');
    await save();
    expect(mockApi.createItem).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ category_id: 'cat-home' })
    );
  });

  it('reveals the specific-date picker when When = Specific date', async () => {
    await renderScreen();
    await press('budget-item-when-specific-date');
    expect(byTestID('budget-item-specific-date-picker')).toBeTruthy();
    await press('budget-item-specific-date-picker');
    expect(maybeByTestID('date-time-picker').length).toBeGreaterThanOrEqual(1);
  });

  it('applies a quick-add suggestion into the planned form', async () => {
    mockApi.getQuickAddSuggestions.mockResolvedValue({
      recent: [
        {
          title: 'Filter',
          description: 'Air filter',
          priority: 'high',
          category_id: 'cat-home',
          estimated_cost_min: 5000,
          estimated_cost_max: 5000,
          amount: null,
        },
      ],
      popular: [],
    });
    await renderScreen();
    // Find the quick-add chip whose subtree text is "Filter" and press it.
    const target = tree.root
      .findAll((n) => typeof n.props?.onPress === 'function')
      .find((n) =>
        n
          .findAll((c) => typeof c.props?.children === 'string')
          .some((c) => c.props.children === 'Filter')
      );
    expect(target).toBeTruthy();
    await act(async () => {
      target!.props.onPress();
      await Promise.resolve();
    });
    expect(byTestID('budget-item-title').props.value).toBe('Filter');
  });

  const pressQuickAdd = async (title: string) => {
    const target = tree.root
      .findAll((n) => typeof n.props?.onPress === 'function')
      .find((n) =>
        n
          .findAll((c) => typeof c.props?.children === 'string')
          .some((c) => c.props.children === title)
      );
    expect(target).toBeTruthy();
    await act(async () => {
      target!.props.onPress();
      await Promise.resolve();
    });
    await flush();
  };

  it('applies a range-cost quick-add suggestion (range mode)', async () => {
    mockApi.getQuickAddSuggestions.mockResolvedValue({
      recent: [
        {
          title: 'Reno',
          description: null,
          priority: 'low',
          category_id: null,
          estimated_cost_min: 10000,
          estimated_cost_max: 20000,
          amount: null,
        },
      ],
      popular: [],
    });
    await renderScreen();
    await pressQuickAdd('Reno');
    expect(byTestID('budget-item-cost-min').props.value).toBe('100');
    expect(byTestID('budget-item-cost-max').props.value).toBe('200');
  });

  it('applies a quick-add suggestion into the spent form', async () => {
    mockApi.getQuickAddSuggestions.mockResolvedValue({
      recent: [
        {
          title: 'Coffee',
          description: null,
          priority: null,
          category_id: 'cat-food',
          estimated_cost_min: null,
          estimated_cost_max: null,
          amount: 800,
        },
      ],
      popular: [],
    });
    await renderScreen();
    await press('budget-item-kind-spent');
    await pressQuickAdd('Coffee');
    expect(byTestID('budget-item-title').props.value).toBe('Coffee');
    expect(byTestID('budget-item-cost-exact').props.value).toBe('8');
  });

  it('fills the name from a spent quick-add suggestion without a price, leaving the amount blank', async () => {
    mockApi.getQuickAddSuggestions.mockResolvedValue({
      recent: [
        {
          title: 'Zero',
          description: null,
          priority: null,
          category_id: 'cat-food',
          estimated_cost_min: null,
          estimated_cost_max: null,
          amount: 0,
        },
      ],
      popular: [],
    });
    await renderScreen();
    await press('budget-item-kind-spent');
    await pressQuickAdd('Zero');
    // A chip that carries no remembered price must still do something visible
    // when tapped (a silent no-op reads as a dead chip): the name lands, the
    // amount is left for the member to type rather than showing a literal "0".
    expect(byTestID('budget-item-title').props.value).toBe('Zero');
    expect(byTestID('budget-item-cost-exact').props.value).toBe('');
  });

  it('shows recent and popular suggestions together in one strip, deduped by title', async () => {
    const base = {
      description: null,
      priority: null,
      category_id: null,
      estimated_cost_min: null,
      estimated_cost_max: null,
    };
    mockApi.getQuickAddSuggestions.mockResolvedValue({
      recent: [{ ...base, title: 'Coffee', amount: 800 }],
      popular: [
        { ...base, title: 'coffee', amount: 700 },
        { ...base, title: 'Beer', amount: 1200 },
      ],
    });
    await renderScreen();
    await press('budget-item-kind-spent');
    // No tab bar: both lists render as chips in the single section.
    expect(maybeByTestID('budget-quick-add-tab-recent')).toHaveLength(0);
    expect(maybeByTestID('budget-quick-add-tab-popular')).toHaveLength(0);
    expect(byTestID('budget-quick-add-chip-Coffee')).toBeTruthy();
    expect(byTestID('budget-quick-add-chip-Beer')).toBeTruthy();
    // The popular "coffee" duplicate is folded into the recent "Coffee".
    expect(maybeByTestID('budget-quick-add-chip-coffee')).toHaveLength(0);
    // A popular chip is as tappable as a recent one.
    await pressQuickAdd('Beer');
    expect(byTestID('budget-item-title').props.value).toBe('Beer');
    expect(byTestID('budget-item-cost-exact').props.value).toBe('12');
  });

  it('toggles cost mode range → exact, seeding the exact field', async () => {
    await renderScreen();
    await setInput('budget-item-title', 'Seeded');
    await press('budget-item-cost-mode-range');
    await setInput('budget-item-cost-min', '75');
    await press('budget-item-cost-mode-exact');
    expect(byTestID('budget-item-cost-exact').props.value).toBe('75');
  });

  it('closes the date picker when When switches away from Specific date', async () => {
    await renderScreen();
    await press('budget-item-when-specific-date');
    await press('budget-item-specific-date-picker');
    expect(maybeByTestID('date-time-picker').length).toBeGreaterThanOrEqual(1);
    // Switch back to "this month" → picker is dismissed.
    await press('budget-item-when-this-month');
    expect(maybeByTestID('date-time-picker').length).toBe(0);
  });

  it('picks a spent date through the date picker onChange + Done', async () => {
    await renderScreen();
    await press('budget-item-kind-spent');
    await press('budget-item-spent-date-picker');
    await act(async () => {
      byTestID('date-time-picker').props.onChange({}, new Date(2026, 6, 18, 12, 0, 0));
      await Promise.resolve();
    });
    // Done commits the wheel's draft and closes the sheet.
    await press('budget-item-spent-date-sheet-done');
    expect(maybeByTestID('date-time-picker').length).toBe(0);
    expect(collectRenderedText(tree).join(' ')).toContain('Jul 18, 2026');
  });

  it('discards a spent date when the picker sheet is cancelled', async () => {
    await renderScreen();
    await press('budget-item-kind-spent');
    await press('budget-item-spent-date-picker');
    await act(async () => {
      byTestID('date-time-picker').props.onChange({}, new Date(2026, 6, 18, 12, 0, 0));
      await Promise.resolve();
    });
    // The date sheet dismisses through the shared header ✕ now.
    await press('bottom-sheet-close');
    expect(maybeByTestID('date-time-picker').length).toBe(0);
    expect(collectRenderedText(tree).join(' ')).not.toContain('Jul 18, 2026');
  });

  it('picks a specific planned date through the date picker onChange + Done', async () => {
    await renderScreen();
    await press('budget-item-when-specific-date');
    await press('budget-item-specific-date-picker');
    await act(async () => {
      byTestID('date-time-picker').props.onChange({}, new Date(2026, 6, 25, 12, 0, 0));
      await Promise.resolve();
    });
    await press('budget-item-specific-date-sheet-done');
    expect(maybeByTestID('date-time-picker').length).toBe(0);
  });

  it('clears the category search, shows no-results, and closes via Done', async () => {
    await renderScreen();
    await press('budget-item-category-picker');
    await setInput('budget-item-category-search', 'zzz-nonexistent');
    expect(collectRenderedText(tree)).toContain('No categories found');
    // Clear button (X) resets the query.
    const searchRow = byTestID('budget-item-category-search').parent!.parent!;
    const clearBtn = searchRow.findAll((n) => typeof n.props?.onPress === 'function')[0];
    await act(async () => {
      clearBtn.props.onPress();
      await Promise.resolve();
    });
    expect(byTestID('budget-item-category-search').props.value).toBe('');
    // Done closes the picker.
    await press('budget-item-category-close');
    expect(maybeByTestID('budget-item-category-search').length).toBe(0);
  });

  it('creates the typed category from the picker and selects it', async () => {
    await renderScreen();
    await press('budget-item-category-picker');
    await setInput('budget-item-category-search', '  Cat show fees  ');
    await press('budget-item-category-create');

    expect(mockApi.createCategory).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ name: 'Cat show fees', icon: 'tag' })
    );
    // Created → picked → sheet closed, so the half-typed spending survives.
    expect(maybeByTestID('budget-item-category-search')).toHaveLength(0);

    await setInput('budget-item-title', 'Entry fee');
    await setInput('budget-item-cost-exact', '40');
    await save();
    expect(mockApi.createItem).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ category_id: 'cat-new' })
    );
  });

  it('hides the create row when the typed name is already a listed category', async () => {
    await renderScreen();
    await press('budget-item-category-picker');
    expect(byTestID('budget-item-category-create')).toBeTruthy();
    await setInput('budget-item-category-search', 'food');
    expect(maybeByTestID('budget-item-category-create')).toHaveLength(0);
  });

  it('turns a hidden default back on instead of dead-ending on the name clash', async () => {
    mockApi.getCategories.mockImplementation((_hh: string, options?: { includeHidden?: boolean }) =>
      Promise.resolve({
        categories: options?.includeHidden
          ? [CATEGORY, CATEGORY_2, HIDDEN_CATEGORY]
          : [CATEGORY, CATEGORY_2],
      })
    );
    mockApi.createCategory.mockRejectedValue({ name: 'CategoryNameConflictError' });

    await renderScreen();
    await press('budget-item-category-picker');
    await setInput('budget-item-category-search', 'Pets');
    await press('budget-item-category-create');

    expect(mockApi.updateCategory).toHaveBeenCalledWith('hh-consistency', 'cat-pets', {
      hidden: false,
    });
    expect(Alert.alert).not.toHaveBeenCalled();

    await setInput('budget-item-title', 'Litter');
    await setInput('budget-item-cost-exact', '15');
    await save();
    expect(mockApi.createItem).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ category_id: 'cat-pets' })
    );
  });

  it('does not create anything when the create row is tapped with an empty search box', async () => {
    await renderScreen();
    await press('budget-item-category-picker');
    // Empty name → the row is a prompt to type, not a write.
    await press('budget-item-category-create');
    expect(mockApi.createCategory).not.toHaveBeenCalled();
    // Sheet stays open so the member can name the category.
    expect(byTestID('budget-item-category-search')).toBeTruthy();
  });

  it('selects an existing-but-unlisted category on a clash instead of creating a duplicate', async () => {
    // The name is taken by a category that is NOT hidden — it simply was not in
    // this picker's list (a stale load). Selecting it beats an alert.
    mockApi.getCategories.mockImplementation((_hh: string, options?: { includeHidden?: boolean }) =>
      Promise.resolve({
        categories: options?.includeHidden
          ? [CATEGORY, CATEGORY_2, { ...HIDDEN_CATEGORY, hidden: false }]
          : [CATEGORY, CATEGORY_2],
      })
    );
    mockApi.createCategory.mockRejectedValue({ response: { status: 409 } });

    await renderScreen();
    await press('budget-item-category-picker');
    await setInput('budget-item-category-search', 'Pets');
    await press('budget-item-category-create');

    // Already visible → nothing to un-hide, and no duplicate written.
    expect(mockApi.updateCategory).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();

    await setInput('budget-item-title', 'Litter');
    await setInput('budget-item-cost-exact', '15');
    await save();
    expect(mockApi.createItem).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ category_id: 'cat-pets' })
    );
  });

  it('falls back to the alert when the hidden-category lookup itself fails', async () => {
    mockApi.createCategory.mockRejectedValue({ name: 'CategoryNameConflictError' });
    // First call (initial load) succeeds; the includeHidden lookup then fails.
    mockApi.getCategories.mockImplementation((_hh: string, options?: { includeHidden?: boolean }) =>
      options?.includeHidden
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ categories: [CATEGORY, CATEGORY_2] })
    );

    await renderScreen();
    await press('budget-item-category-picker');
    await setInput('budget-item-category-search', 'Pets');
    await press('budget-item-category-create');

    expect(Alert.alert).toHaveBeenCalledWith('Category exists', expect.stringContaining('Pets'));
    // Still usable — the sheet did not get stuck in a creating state.
    expect(byTestID('budget-item-category-search')).toBeTruthy();
  });

  it('alerts and keeps the sheet usable when the create call fails outright', async () => {
    mockApi.createCategory.mockRejectedValue(new Error('network down'));
    await renderScreen();
    await press('budget-item-category-picker');
    await setInput('budget-item-category-search', 'Cat show fees');
    await press('budget-item-category-create');

    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Could not create this category.');
    expect(byTestID('budget-item-category-search')).toBeTruthy();
    // The row is back to tappable rather than stuck behind the spinner.
    expect(byTestID('budget-item-category-create').props.disabled).toBe(false);
  });

  it('alerts when the clashing name belongs to a category that is already visible', async () => {
    mockApi.createCategory.mockRejectedValue({ name: 'CategoryNameConflictError' });
    await renderScreen();
    await press('budget-item-category-picker');
    // Not an exact match of anything listed, so the create row is offered — the
    // clash only surfaces server-side.
    await setInput('budget-item-category-search', 'Foods');
    await press('budget-item-category-create');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Category exists',
      expect.stringContaining('Foods')
    );
  });

  it('selects "No category" from the picker', async () => {
    mockRouteParams = { itemId: 'bi-filter' };
    await renderScreen();
    await press('budget-item-category-picker');
    await press('budget-item-category-none');
    await save();
    expect(mockApi.updateItem).toHaveBeenCalledWith(
      'hh-consistency',
      'bi-filter',
      expect.objectContaining({ category_id: undefined })
    );
  });

  it('lists all eight when options in the More sheet (BUDGET-PLAN-046)', async () => {
    await renderScreen();
    await press('budget-item-when-more');
    const sheetIds = [
      'budget-item-when-sheet-asap',
      'budget-item-when-sheet-this-week',
      'budget-item-when-sheet-next-week',
      'budget-item-when-sheet-this-month',
      'budget-item-when-sheet-next-month',
      'budget-item-when-sheet-next-year',
      'budget-item-when-sheet-when-possible',
      'budget-item-when-sheet-specific-date',
    ];
    for (const id of sheetIds) {
      expect(byTestID(id)).toBeTruthy();
    }
  });

  it('closes the when More sheet without changing the prior selection (BUDGET-PLAN-047)', async () => {
    await renderScreen();
    await press('budget-item-when-more');
    await press('budget-item-when-close');
    await setInput('budget-item-title', 'Still this month');
    await setInput('budget-item-cost-exact', '10');
    await save();
    expect(mockApi.createItem).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({
        target_date: toLocalYMD(dateForThisMonth(2026, 7)),
      })
    );
  });

  it('keeps the loaded category when the picker is closed without a new choice (BUDGET-PLAN-054)', async () => {
    mockRouteParams = { itemId: 'bi-filter' };
    await renderScreen();
    await press('budget-item-category-picker');
    await press('budget-item-category-close');
    await setInput('budget-item-description', 'Touched description only');
    await save();
    expect(mockApi.updateItem).toHaveBeenCalledWith(
      'hh-consistency',
      'bi-filter',
      expect.objectContaining({ category_id: 'cat-food' })
    );
  });
});

describe('BudgetItemFormScreen — load edge cases', () => {
  it('recovers when quick-add suggestions fail to load', async () => {
    mockApi.getQuickAddSuggestions.mockRejectedValue(new Error('boom'));
    await renderScreen();
    // Form still renders despite the failed suggestions fetch.
    expect(byTestID('budget-item-title')).toBeTruthy();
  });

  it('logs and stops loading when the planned item fails to load', async () => {
    mockApi.getItem.mockRejectedValue(new Error('boom'));
    mockRouteParams = { itemId: 'bi-filter' };
    await renderScreen();
    // Loading resolves (spinner gone) and the form is shown.
    expect(byTestID('budget-item-title')).toBeTruthy();
  });

  it('loads an exact-cost planned item into the exact field', async () => {
    mockApi.getItem.mockResolvedValue({
      item: { ...PLANNED_ITEM, estimated_cost_min: 25000, estimated_cost_max: 25000 },
    });
    mockRouteParams = { itemId: 'bi-filter' };
    await renderScreen();
    expect(byTestID('budget-item-cost-exact').props.value).toBe('250');
  });

  it('captures the scroll viewport height via the container onLayout', async () => {
    await renderScreen();
    // Fire every onLayout hook (KeyboardAvoidingView + the container) so the
    // container's viewport-height capture runs regardless of ordering.
    const layoutViews = tree.root.findAll(
      (n) => (n.type as unknown as string) === 'View' && typeof n.props?.onLayout === 'function'
    );
    await act(async () => {
      layoutViews.forEach((v) =>
        v.props.onLayout({ persist: () => {}, nativeEvent: { layout: { height: 900 } } })
      );
      await Promise.resolve();
    });
    expect(layoutViews.length).toBeGreaterThan(0);
  });

  it('goes back when back is pressed', async () => {
    await renderScreen();
    await press('nav-back-button');
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('re-selects the Planned kind chip (no-op when already planned)', async () => {
    await renderScreen();
    await press('budget-item-kind-planned');
    expect(collectRenderedText(tree)).toContain('Planned spending');
  });

  it('is a no-op when pressing the already-active cost mode', async () => {
    await renderScreen();
    await setInput('budget-item-title', 'Same mode');
    // Exact is the default; pressing it again exercises the early-return guard.
    await press('budget-item-cost-mode-exact');
    await setInput('budget-item-cost-exact', '10');
    await save();
    expect(mockApi.createItem).toHaveBeenCalled();
  });
});

describe('BudgetItemFormScreen — iPad layout', () => {
  afterEach(() => {
    // Restore the default phone profile for the rest of the suite.
    mockDeviceInfo = { isIPad: false, width: 390 };
  });

  it('renders the category sheet as a centered (fade) modal on a wide iPad', async () => {
    mockDeviceInfo = { isIPad: true, width: 1366 };
    await renderScreen();
    await press('budget-item-category-picker');
    // On a wide iPad the picker becomes a centered dialog (fade) rather than the
    // phone bottom-sheet (slide). Find the picker Modal by its animationType prop.
    const modals = tree.root.findAll(
      (n) => (n.props as { animationType?: string })?.animationType !== undefined,
      { deep: true }
    );
    expect(modals.length).toBeGreaterThan(0);
    expect(modals.some((m) => (m.props as { animationType?: string }).animationType === 'fade')).toBe(true);
    // The picker still works on iPad: the category rows render.
    expect(byTestID(`budget-item-category-${CATEGORY.id}`)).toBeTruthy();
  });

  it('keeps the phone bottom-sheet (slide) on a narrow iPad below the sidebar breakpoint', async () => {
    // isIPad but width under Layout.sidebarBreakpoint → NOT centered.
    mockDeviceInfo = { isIPad: true, width: 700 };
    await renderScreen();
    await press('budget-item-category-picker');
    const modals = tree.root.findAll(
      (n) => (n.props as { animationType?: string })?.animationType !== undefined,
      { deep: true }
    );
    expect(modals.some((m) => (m.props as { animationType?: string }).animationType === 'slide')).toBe(true);
  });
});

/**
 * Sales tax on a manually entered spending: the typed Amount is the PRE-TAX
 * price, each region row adds to it, and what is recorded is the tax-inclusive
 * total plus the combined tax — the same shape receipt scanning writes.
 */
describe('BudgetItemFormScreen — sales tax', () => {
  beforeEach(() => {
    useAppStore.setState({ taxCountry: 'CA', taxRegion: 'BC' });
  });

  afterAll(() => {
    useAppStore.setState({ taxCountry: null, taxRegion: null });
  });

  async function spentFormWithAmount(amount: string) {
    await renderScreen();
    await press('budget-item-kind-spent');
    await setInput('budget-item-title', 'Groceries');
    await setInput('budget-item-cost-exact', amount);
  }

  it('offers the region rows, off until asked for', async () => {
    await spentFormWithAmount('100');
    expect(maybeByTestID('budget-item-tax-row-G')).toHaveLength(0);
    await press('budget-item-tax-toggle');
    expect(byTestID('budget-item-tax-row-G')).toBeTruthy();
    expect(byTestID('budget-item-tax-row-P')).toBeTruthy();
    expect(collectRenderedText(tree)).toContain('GST');
    expect(collectRenderedText(tree)).toContain('PST');
  });

  it('adds the region rates on top of the typed amount', async () => {
    await spentFormWithAmount('100');
    await press('budget-item-tax-toggle');
    await save();
    // $100.00 + 5% GST + 7% PST = $112.00, of which $12.00 is tax.
    expect(mockApi.addExpense).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ amount: 11200, tax_amount: 1200 })
    );
  });

  it('records no tax while the section is off', async () => {
    await spentFormWithAmount('100');
    await save();
    expect(mockApi.addExpense).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ amount: 10000, tax_amount: 0 })
    );
  });

  it('takes a typed dollar amount for a row instead of its rate', async () => {
    await spentFormWithAmount('100');
    await press('budget-item-tax-toggle');
    await press('budget-item-tax-G-mode-amount');
    // Switching modes seeds the box with the rate's dollars, ready to correct.
    expect(byTestID('budget-item-tax-G-amount').props.value).toBe('5.00');
    await setInput('budget-item-tax-G-amount', '3.50');
    await save();
    // $3.50 typed + 7% PST ($7.00) = $10.50 of tax on a $100.00 subtotal.
    expect(mockApi.addExpense).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ amount: 11050, tax_amount: 1050 })
    );
  });

  it('recomputes a rate row when the wheel picks a different rate', async () => {
    await spentFormWithAmount('100');
    await press('budget-item-tax-toggle');
    await press('budget-item-tax-G-percent');
    await act(async () => {
      byTestID('budget-item-tax-G-picker-whole').props.onValueChange(9);
      await Promise.resolve();
    });
    await press('budget-item-tax-G-picker-done');
    await save();
    // 9% + 7% of $100.00 = $16.00.
    expect(mockApi.addExpense).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ amount: 11600, tax_amount: 1600 })
    );
  });

  it('sends the wheel’s "enter manually" straight to that row’s amount box', async () => {
    await spentFormWithAmount('100');
    await press('budget-item-tax-toggle');
    await press('budget-item-tax-P-percent');
    await press('budget-item-tax-P-picker-manual');
    expect(maybeByTestID('budget-item-tax-P-percent')).toHaveLength(0);
    expect(byTestID('budget-item-tax-P-amount').props.value).toBe('7.00');
  });

  it('splits a saved expense back into its pre-tax amount and rows when edited', async () => {
    mockApi.getExpense.mockResolvedValue({
      expense: { ...EXPENSE, amount: 11200, tax_amount: 1200 },
    });
    mockRouteParams = { expenseId: 'exp-1' };
    await renderScreen();
    // The Amount field shows the pre-tax price, not the $112.00 that was paid.
    expect(byTestID('budget-item-cost-exact').props.value).toBe('100');
    expect(byTestID('budget-item-tax-row-G')).toBeTruthy();
    // Re-saving an untouched expense must write the same total back.
    await setInput('budget-item-title', 'Groceries II');
    await save();
    expect(mockApi.updateExpense).toHaveBeenCalledWith(
      'hh-consistency',
      'exp-1',
      expect.objectContaining({ amount: 11200, tax_amount: 1200 })
    );
  });

  it('clears the stored tax when the section is switched off on an edit', async () => {
    mockApi.getExpense.mockResolvedValue({
      expense: { ...EXPENSE, amount: 11200, tax_amount: 1200 },
    });
    mockRouteParams = { expenseId: 'exp-1' };
    await renderScreen();
    await press('budget-item-tax-toggle');
    await save();
    expect(mockApi.updateExpense).toHaveBeenCalledWith(
      'hh-consistency',
      'exp-1',
      expect.objectContaining({ amount: 10000, tax_amount: 0 })
    );
  });
});

/**
 * Name shortcut bubbles — the row under the Name field that offers the name
 * this household usually reaches for ("Peanuts" → "Nuts").
 */
describe('BudgetItemFormScreen — name shortcuts', () => {
  const NUTS_HISTORY = [
    ...Array.from({ length: 6 }, (_, i) => ({
      ...EXPENSE,
      id: `nuts-${i}`,
      title: 'Nuts',
      expense_date: '2026-07-0'.concat(String(i + 1)),
    })),
    { ...EXPENSE, id: 'peanuts-1', title: 'Peanuts', expense_date: '2026-06-01' },
  ];

  beforeEach(() => {
    mockApi.getExpenses.mockResolvedValue({ expenses: NUTS_HISTORY });
  });

  it('offers the name the household usually uses for what was typed', async () => {
    mockRouteParams = { kind: 'spent' };
    await renderScreen();
    await setInput('budget-item-title', 'Peanuts');

    // findAll matches the bubble through its wrapper chain, so count presence,
    // not nodes.
    expect(maybeByTestID('budget-name-suggestion-Nuts').length).toBeGreaterThan(0);
  });

  it('reads the whole history, not just the month on screen', async () => {
    mockRouteParams = { kind: 'spent' };
    await renderScreen();

    expect(mockApi.getExpenses).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ limit: expect.any(Number) })
    );
    expect(mockApi.getExpenses.mock.calls[0][1]).not.toHaveProperty('month');
  });

  it('stays out of the planned form', async () => {
    mockRouteParams = { kind: 'planned' };
    await renderScreen();
    await setInput('budget-item-title', 'Peanuts');

    expect(maybeByTestID('budget-name-suggestion-Nuts')).toHaveLength(0);
    expect(mockApi.getExpenses).not.toHaveBeenCalled();
  });

  it('tapping a bubble renames the spending and nothing else', async () => {
    mockRouteParams = { kind: 'spent' };
    await renderScreen();
    await setInput('budget-item-title', 'Peanuts');
    await setInput('budget-item-cost-exact', '11.98');
    await press('budget-name-suggestion-Nuts');
    await save();

    expect(mockApi.addExpense).toHaveBeenCalledWith(
      'hh-consistency',
      // The bubble touches the name only — the typed amount survives it, and no
      // category rides along.
      expect.objectContaining({ title: 'Nuts', amount: 1198, category_id: undefined })
    );
  });

  it('remembers the swap so the next "Peanuts" already knows', async () => {
    mockRouteParams = { kind: 'spent' };
    await renderScreen();
    await setInput('budget-item-title', 'Peanuts');
    await press('budget-name-suggestion-Nuts');

    expect(mockRecordNameRename).toHaveBeenCalledWith('Peanuts', 'Nuts');
  });

  it('learns a rename typed by hand when an existing spending is saved', async () => {
    mockRouteParams = { expenseId: 'exp-1' };
    await renderScreen();
    await setInput('budget-item-title', 'Nuts');
    await save();

    // EXPENSE arrives as "Groceries" and leaves as "Nuts".
    expect(mockRecordNameRename).toHaveBeenCalledWith('Groceries', 'Nuts');
  });

  it('survives a spending history that will not load', async () => {
    mockApi.getExpenses.mockRejectedValue(new Error('boom'));
    mockRouteParams = { kind: 'spent' };
    await renderScreen();
    await setInput('budget-item-title', 'Peanuts');

    expect(byTestID('budget-item-title')).toBeTruthy();
    expect(maybeByTestID('budget-name-suggestions')).toHaveLength(0);
  });
});
