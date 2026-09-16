/**
 * BudgetMonthlyCapsScreen — the per-year monthly-budget editor. A 12-month grid
 * (tap a month to edit it), an inline amount editor and an "N of 12 months set ·
 * $X planned" summary.
 *
 * Split out of BudgetSettingsScreen, which now carries a single row leading
 * here; these tests came with the editor. Covers: loading all 12 months, the
 * grid + summary, month selection, save (in-place grid update, no navigation
 * away), the first-of-year "apply to the rest of the year" prompt, and the
 * error paths.
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
jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
  }),
}));

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
      rightElement,
    }: {
      showBackButton?: boolean;
      onBackPress?: () => void;
      backButtonTestID?: string;
      rightElement?: React.ReactNode;
    }) =>
      React.createElement(
        View,
        null,
        showBackButton
          ? React.createElement(TouchableOpacity, {
              onPress: onBackPress,
              testID: backButtonTestID ?? 'nav-back-button',
            })
          : null,
        rightElement ?? null
      ),
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
import { BudgetMonthlyCapsScreen } from '../BudgetMonthlyCapsScreen';

// planned_budget (cents) per month for the loaded year. Months absent here come
// back as `null` (not set). Jan = $1,000, Jul = $3,000 → 2 set, $4,000 planned.
const GOALS: Record<number, number> = { 1: 100000, 7: 300000 };

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetMonthlyCapsScreen />
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

// Presence, not instance count: findAll matches every fiber carrying the prop
// (a TouchableOpacity renders several), so only "any" vs "none" is meaningful.
const hasTestID = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id).length > 0;

// True when any single-string Text child rendered anywhere contains `sub`.
const hasText = (tree: ReactTestRenderer.ReactTestRenderer, sub: string) =>
  collectRenderedText(tree).some((t) => t.includes(sub));

// Drive the amount field + Save button together (the common save path). Flush a
// generous batch of microtasks so the awaited save + optimistic grid re-render
// both settle before assertions run.
async function saveAmount(tree: ReactTestRenderer.ReactTestRenderer, amount: string) {
  act(() => findByTestID(tree, 'budget-settings-planned-budget').props.onChangeText(amount));
  await act(async () => {
    findByTestID(tree, 'budget-settings-save').props.onPress();
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMonthlyGoal.mockImplementation((_hh: string, _year: number, month: number) =>
    Promise.resolve({ goal: { planned_budget: GOALS[month] ?? null } })
  );
  mockSetMonthlyGoal.mockResolvedValue({ isFirstForYear: false });
  mockApplyGoalToYear.mockResolvedValue({});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('BudgetMonthlyCapsScreen', () => {
  it('loads every month of the year and does not fetch categories', async () => {
    await renderScreen();
    expect(mockGetMonthlyGoal).toHaveBeenCalledTimes(12);
    expect(mockGetMonthlyGoal).toHaveBeenCalledWith('hh-consistency', 2026, 7);
    expect(mockGetMonthlyGoal).toHaveBeenCalledWith('hh-consistency', 2026, 12);
    // Categories are loaded by the nested BudgetCategoriesScreen, not here.
    expect(mockGetCategories).not.toHaveBeenCalled();
  });

  it('prefills the editor for the selected month and renders the grid + summary', async () => {
    const tree = await renderScreen();
    // Editor prefilled from the selected month (Jul → $3,000).
    expect(findByTestID(tree, 'budget-settings-planned-budget').props.value).toBe('3000');
    // The grid renders a cell per month.
    expect(findByTestID(tree, 'budget-month-1')).toBeTruthy();
    expect(findByTestID(tree, 'budget-month-12')).toBeTruthy();
    // Summary counts the set months and sums their caps.
    expect(hasText(tree, '2 of 12 months set · $4,000 planned for 2026')).toBe(true);
  });

  it('selecting a set month loads its amount into the editor', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-month-1').props.onPress());
    expect(findByTestID(tree, 'budget-settings-planned-budget').props.value).toBe('1000');
  });

  it('hides the header Save until something is edited', async () => {
    const tree = await renderScreen();
    expect(hasTestID(tree, 'budget-settings-save')).toBe(false);
    act(() => findByTestID(tree, 'budget-settings-planned-budget').props.onChangeText('450'));
    expect(hasTestID(tree, 'budget-settings-save')).toBe(true);
    // Typing the stored amount back is not a change — the action goes away again.
    act(() => findByTestID(tree, 'budget-settings-planned-budget').props.onChangeText('3000'));
    expect(hasTestID(tree, 'budget-settings-save')).toBe(false);
  });

  it('keeps an edited month when another month is selected', async () => {
    const tree = await renderScreen();
    // Type a new July amount, then go look at January.
    act(() => findByTestID(tree, 'budget-settings-planned-budget').props.onChangeText('450'));
    act(() => findByTestID(tree, 'budget-month-1').props.onPress());
    expect(findByTestID(tree, 'budget-settings-planned-budget').props.value).toBe('1000');
    // The pending July edit is still previewed in the grid and the summary.
    expect(hasText(tree, '$1,450 planned for 2026')).toBe(true);
    // …and coming back to July shows the typed amount, not the stored one.
    act(() => findByTestID(tree, 'budget-month-7').props.onPress());
    expect(findByTestID(tree, 'budget-settings-planned-budget').props.value).toBe('450');
  });

  it('saves every edited month in one go', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-settings-planned-budget').props.onChangeText('450'));
    act(() => findByTestID(tree, 'budget-month-3').props.onPress());
    act(() => findByTestID(tree, 'budget-settings-planned-budget').props.onChangeText('600'));
    await act(async () => {
      findByTestID(tree, 'budget-settings-save').props.onPress();
      for (let i = 0; i < 15; i += 1) await Promise.resolve();
    });

    expect(mockSetMonthlyGoal).toHaveBeenCalledTimes(2);
    expect(mockSetMonthlyGoal).toHaveBeenCalledWith('hh-consistency', 2026, 3, {
      planned_budget: 60000,
    });
    expect(mockSetMonthlyGoal).toHaveBeenCalledWith('hh-consistency', 2026, 7, {
      planned_budget: 45000,
    });
    // Jan $1,000 + Mar $600 + Jul $450.
    expect(hasText(tree, '3 of 12 months set · $2,050 planned for 2026')).toBe(true);
    // Everything is written, so the header action disappears again.
    expect(hasTestID(tree, 'budget-settings-save')).toBe(false);
  });

  it('does not offer "apply to the rest of the year" for a multi-month save', async () => {
    mockSetMonthlyGoal.mockResolvedValue({ isFirstForYear: true });
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-settings-planned-budget').props.onChangeText('450'));
    act(() => findByTestID(tree, 'budget-month-3').props.onPress());
    act(() => findByTestID(tree, 'budget-settings-planned-budget').props.onChangeText('600'));
    await act(async () => {
      findByTestID(tree, 'budget-settings-save').props.onPress();
      for (let i = 0; i < 15; i += 1) await Promise.resolve();
    });
    const applyCall = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Apply this budget?');
    expect(applyCall).toBeUndefined();
  });

  it('selecting an unset month clears the editor', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-month-3').props.onPress());
    expect(findByTestID(tree, 'budget-settings-planned-budget').props.value).toBe('');
  });

  it('rejects an invalid budget amount without calling the API', async () => {
    const tree = await renderScreen();
    await saveAmount(tree, '-5');
    expect(Alert.alert).toHaveBeenCalledWith('Invalid amount', expect.any(String));
    expect(mockSetMonthlyGoal).not.toHaveBeenCalled();
  });

  it('saves the selected month, updates the grid in place, and stays on the screen', async () => {
    const tree = await renderScreen();
    await saveAmount(tree, '450');
    expect(mockSetMonthlyGoal).toHaveBeenCalledWith('hh-consistency', 2026, 7, {
      planned_budget: 45000,
    });
    expect(mockMarkInsightsDirty).toHaveBeenCalledWith('hh-consistency');
    // Editing a month never navigates away — the user keeps setting other months.
    expect(mockGoBack).not.toHaveBeenCalled();
    // Optimistic grid update: Jul is now $450, so the annual total drops from
    // $4,000 to $1,450 (Jan $1,000 + Jul $450) — shown in full, not as "$1.4k".
    expect(hasText(tree, '$1,450 planned for 2026')).toBe(true);
  });

  it('prompts to apply to the rest of the year on the first goal of the year', async () => {
    mockSetMonthlyGoal.mockResolvedValue({ isFirstForYear: true });
    const tree = await renderScreen();
    await saveAmount(tree, '450');

    const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Apply this budget?');
    expect(call).toBeTruthy();

    // "Same for rest of year" applies the amount and re-pulls the months.
    const buttons = call![2] as { text: string; onPress?: () => void }[];
    mockGetMonthlyGoal.mockClear();
    await act(async () => {
      buttons.find((b) => b.text === 'Same for rest of year')!.onPress?.();
      await Promise.resolve();
    });
    expect(mockApplyGoalToYear).toHaveBeenCalledWith('hh-consistency', 2026, 7, 45000);
    // refreshMonths() re-fetches all 12 months.
    expect(mockGetMonthlyGoal).toHaveBeenCalledTimes(12);
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('does not apply to the year when the user picks "Different per month"', async () => {
    mockSetMonthlyGoal.mockResolvedValue({ isFirstForYear: true });
    const tree = await renderScreen();
    await saveAmount(tree, '450');

    const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Apply this budget?');
    const buttons = call![2] as { text: string; onPress?: () => void; style?: string }[];
    const different = buttons.find((b) => b.text === 'Different per month');
    expect(different?.style).toBe('cancel');
    // It's a plain dismiss — no handler, so nothing is applied.
    different?.onPress?.();
    expect(mockApplyGoalToYear).not.toHaveBeenCalled();
  });

  it('does not prompt to apply when editing December', async () => {
    mockSetMonthlyGoal.mockResolvedValue({ isFirstForYear: true });
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-month-12').props.onPress());
    await saveAmount(tree, '500');
    expect(mockSetMonthlyGoal).toHaveBeenCalledWith('hh-consistency', 2026, 12, {
      planned_budget: 50000,
    });
    const applyCall = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Apply this budget?');
    expect(applyCall).toBeUndefined();
  });

  it('alerts when saving the monthly goal fails', async () => {
    mockSetMonthlyGoal.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    await saveAmount(tree, '450');
    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Could not save the monthly budget.');
  });

  it('alerts when applying the budget to the year fails', async () => {
    mockSetMonthlyGoal.mockResolvedValue({ isFirstForYear: true });
    mockApplyGoalToYear.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    await saveAmount(tree, '450');
    const applyCall = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Apply this budget?');
    const buttons = applyCall![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Same for rest of year')!.onPress?.();
      await Promise.resolve();
    });
    expect(Alert.alert).toHaveBeenCalledWith('Error', expect.stringContaining('rest of the year'));
  });

  it('still renders (empty editor, zero set) when loading the months fails', async () => {
    mockGetMonthlyGoal.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    expect(findByTestID(tree, 'budget-settings-planned-budget').props.value).toBe('');
    expect(hasText(tree, '0 of 12 months set')).toBe(true);
  });

  it('goes back from the header back button', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'nav-back-button').props.onPress());
    expect(mockGoBack).toHaveBeenCalled();
  });
});
