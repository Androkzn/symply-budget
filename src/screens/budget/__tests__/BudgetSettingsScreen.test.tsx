/**
 * BudgetSettingsScreen — the Budget hub: one row per destination (Monthly
 * Budget, Budget Transfer, Sub-budgets, sharing, and the Preferences group
 * that opens with Spending Categories).
 *
 * Covers the routing and the one piece of data the hub still reads for itself:
 * the year summary shown under the Monthly Budget row. The cap editor those
 * months feed lives on (and is tested by) BudgetMonthlyCapsScreen; categories
 * on BudgetCategoriesScreen.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
  }),
}));
jest.mock('expo-router/react-navigation', () => {
  const React = require('react');
  return {
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      canGoBack: () => true,
    }),
    // The hub re-reads the months on focus; in tests that is simply "on mount".
    useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
  };
});

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, TouchableOpacity } = require('react-native');
  return {
    screenScrollViewStyle: { scroll: {} },
    SCREEN_SCROLL_TEST_ID: 'screen-scroll',
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    BackButton: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
      React.createElement(TouchableOpacity, { onPress, testID: testID ?? 'nav-back-button' }),
    ScreenHeader: ({
      showBackButton,
      onBackPress,
      backButtonTestID,
    }: {
      showBackButton?: boolean;
      onBackPress?: () => void;
      backButtonTestID?: string;
    }) =>
      showBackButton
        ? React.createElement(TouchableOpacity, {
            onPress: onBackPress,
            testID: backButtonTestID ?? 'nav-back-button',
          })
        : null,
  };
});

const mockGetMonthlyGoal = jest.fn();
const mockGetCategories = jest.fn();
const mockSetMonthlyGoal = jest.fn();
const mockApplyGoalToYear = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    getMonthlyGoal: (...a: unknown[]) => mockGetMonthlyGoal(...a),
    getCategories: (...a: unknown[]) => mockGetCategories(...a),
    setMonthlyGoal: (...a: unknown[]) => mockSetMonthlyGoal(...a),
    applyGoalToYear: (...a: unknown[]) => mockApplyGoalToYear(...a),
  },
}));

const mockMarkInsightsDirty = jest.fn();
jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      selectedYear: 2026,
      selectedMonth: 7,
      markInsightsDirty: mockMarkInsightsDirty,
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-consistency' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../test-utils/budgetConsistency';
import { BudgetSettingsScreen } from '../BudgetSettingsScreen';

// planned_budget (cents) per month for the loaded year. Months absent here come
// back as `null` (not set). Jan = $1,000, Jul = $3,000 → 2 set, $4,000 planned.
const GOALS: Record<number, number> = { 1: 100000, 7: 300000 };

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetSettingsScreen />
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

// True when any single-string Text child rendered anywhere contains `sub`.
const hasText = (tree: ReactTestRenderer.ReactTestRenderer, sub: string) =>
  collectRenderedText(tree).some((t) => t.includes(sub));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMonthlyGoal.mockImplementation((_hh: string, _year: number, month: number) =>
    Promise.resolve({ goal: { planned_budget: GOALS[month] ?? null } })
  );
  mockSetMonthlyGoal.mockResolvedValue({ isFirstForYear: false });
  mockApplyGoalToYear.mockResolvedValue({});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('BudgetSettingsScreen', () => {
  it('loads every month of the year and does not fetch categories', async () => {
    await renderScreen();
    expect(mockGetMonthlyGoal).toHaveBeenCalledTimes(12);
    expect(mockGetMonthlyGoal).toHaveBeenCalledWith('hh-consistency', 2026, 7);
    expect(mockGetMonthlyGoal).toHaveBeenCalledWith('hh-consistency', 2026, 12);
    // Categories are loaded by the nested BudgetCategoriesScreen, not here.
    expect(mockGetCategories).not.toHaveBeenCalled();
  });

  it('summarises the year under the Monthly Budget row and routes to the editor', async () => {
    const tree = await renderScreen();
    // The grid itself moved; what stays is one row carrying the same summary.
    expect(findByTestID(tree, 'budget-settings-summary').props.children).toBe(
      '2 of 12 months set · $4,000 planned for 2026'
    );
    expect(hasText(tree, 'Monthly Budget')).toBe(true);

    act(() => findByTestID(tree, 'budget-settings-monthly-caps-link').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('BudgetMonthlyCaps');
  });

  it('still lists the rows when the months cannot be loaded', async () => {
    mockGetMonthlyGoal.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    expect(hasText(tree, '0 of 12 months set')).toBe(true);
    expect(findByTestID(tree, 'budget-settings-transfer-link')).toBeTruthy();
  });

  it('navigates to Budget Transfer from the link', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-settings-transfer-link').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('BudgetTransfer');
  });

  it('navigates to the Categories screen from the link', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-settings-categories-link').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('BudgetCategories');
  });

  // The row is a PREFERENCE — the vocabulary spending is recorded in, like the
  // currency it is recorded in — not a MANAGE BUDGET row, which each set a
  // number. It reads "Spending Categories" and opens the Preferences group; the
  // old plain "Categories" row must not come back above it.
  it('lists Spending Categories first under PREFERENCES, not under MANAGE BUDGET', async () => {
    const tree = await renderScreen();
    const texts = collectRenderedText(tree);
    const row = texts.indexOf('Spending Categories');
    expect(row).toBeGreaterThan(-1);
    expect(texts).not.toContain('Categories');
    // Below every MANAGE BUDGET and SHARING row, directly after the group label.
    expect(row).toBeGreaterThan(texts.indexOf('Sub-budgets'));
    expect(row).toBeGreaterThan(texts.indexOf('SHARING'));
    expect(texts.indexOf('PREFERENCES')).toBeLessThan(row);
    expect(row).toBeLessThan(texts.indexOf('Appearance'));
  });

  // The long-term plan / previous years / compare years links moved to the MORE
  // tab's INSIGHTS group — they read the budget, they do not configure it. Their
  // rows are covered by `SettingsScreen.insights.test.tsx`; this asserts they
  // did not come back here, so the two screens cannot both grow a door.
  it('no longer carries the year-scale insight links', async () => {
    const tree = await renderScreen();
    for (const id of [
      'budget-settings-timeline-link',
      'budget-settings-history-link',
      'budget-settings-compare-link',
    ]) {
      expect(tree.root.findAll((n) => n.props?.testID === id)).toHaveLength(0);
    }
  });

  it('goes back from the header back button', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'nav-back-button').props.onPress());
    expect(mockGoBack).toHaveBeenCalled();
  });
});
