/**
 * BudgetYearSetupScreen — prefills the remaining months of the year with the
 * chosen cap and saves them in one batch. Covers the prefill, the per-month
 * setMonthlyGoal calls, and the popToTop short-circuit when every field is blank.
 */
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockPopToTop = jest.fn();
let mockRouteParams = { year: 2026, fromMonth: 9, plannedBudget: 50000 };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, popToTop: mockPopToTop }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, TouchableOpacity } = require('react-native');
  return {
    screenScrollViewStyle: { scroll: {} },
    SCREEN_SCROLL_TEST_ID: 'screen-scroll',
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    BackButton: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
      React.createElement(TouchableOpacity, { onPress, testID: testID ?? 'back-button' }),
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
            testID: backButtonTestID ?? 'back-button',
          })
        : null,
  };
});

const mockSetMonthlyGoal = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    setMonthlyGoal: (...args: unknown[]) => mockSetMonthlyGoal(...args),
  },
}));

const mockMarkInsightsDirty = jest.fn();
jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (sel?: (s: unknown) => unknown) => {
    const s = { markInsightsDirty: mockMarkInsightsDirty };
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
import { BudgetYearSetupScreen } from '../BudgetYearSetupScreen';

function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetYearSetupScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

/** The GradientButton "Save all" — matched by its title prop. */
function findByTitle(tree: ReactTestRenderer.ReactTestRenderer, title: string) {
  return tree.root.find((n) => n.props?.title === title);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = { year: 2026, fromMonth: 9, plannedBudget: 50000 };
  mockSetMonthlyGoal.mockResolvedValue({ goal: {} });
});

describe('BudgetYearSetupScreen', () => {
  it('renders an input for each remaining month of the year', () => {
    const tree = render();
    const texts = collectRenderedText(tree);
    // fromMonth 9 → October, November, December inputs.
    expect(texts).toContain('October 2026 ($)');
    expect(texts).toContain('November 2026 ($)');
    expect(texts).toContain('December 2026 ($)');
  });

  it('saves a monthly goal for every prefilled month on "Save all"', async () => {
    const tree = render();
    await act(async () => {
      findByTitle(tree, 'Save all').props.onPress();
      await Promise.resolve();
    });

    // 3 remaining months, all prefilled with $500 (50000 cents).
    expect(mockSetMonthlyGoal).toHaveBeenCalledTimes(3);
    expect(mockSetMonthlyGoal).toHaveBeenCalledWith('hh-consistency', 2026, 10, {
      planned_budget: 50000,
    });
    expect(mockSetMonthlyGoal).toHaveBeenCalledWith('hh-consistency', 2026, 12, {
      planned_budget: 50000,
    });
    expect(mockMarkInsightsDirty).toHaveBeenCalledWith('hh-consistency');
    expect(mockPopToTop).toHaveBeenCalled();
  });

  it('skips the API and returns when nothing remains to set (December start)', async () => {
    mockRouteParams = { year: 2026, fromMonth: 12, plannedBudget: 50000 };
    const tree = render();
    await act(async () => {
      findByTitle(tree, 'Save all').props.onPress();
      await Promise.resolve();
    });
    expect(mockSetMonthlyGoal).not.toHaveBeenCalled();
    expect(mockPopToTop).toHaveBeenCalled();
  });

  it('edits a month amount before saving', async () => {
    const tree = render();
    const octInput = tree.root.find(
      (n) => n.props?.label === 'October 2026 ($)' && typeof n.props?.onChangeText === 'function'
    );
    await act(async () => octInput.props.onChangeText('750'));
    await act(async () => {
      findByTitle(tree, 'Save all').props.onPress();
      await Promise.resolve();
    });
    expect(mockSetMonthlyGoal).toHaveBeenCalledWith('hh-consistency', 2026, 10, {
      planned_budget: 75000,
    });
  });

  it('alerts when saving the year budgets fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSetMonthlyGoal.mockRejectedValue(new Error('boom'));
    const tree = render();
    await act(async () => {
      findByTitle(tree, 'Save all').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(alertSpy).toHaveBeenCalledWith('Error', expect.any(String));
    expect(mockPopToTop).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('goes back from the header back button', () => {
    const tree = render();
    act(() => tree.root.findByProps({ testID: 'back-button' }).props.onPress());
    expect(mockGoBack).toHaveBeenCalled();
  });
});
