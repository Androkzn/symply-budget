/**
 * BudgetTransferScreen — move a month's leftover to next month / a savings goal
 * / a registered account, and undo past transfers. All figures + destinations
 * come from the backend context; the screen renders them, validates the amount
 * client-side, and fires create/undo. Covers: load → render, default amount,
 * a next-month transfer, picking a savings-goal destination, "Move all",
 * over-limit guard, undo (via the confirm alert), the no-leftover empty state,
 * and the back button.
 */
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
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

const mockGetTransferContext = jest.fn();
const mockCreateTransfer = jest.fn();
const mockDeleteTransfer = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    getTransferContext: (...a: unknown[]) => mockGetTransferContext(...a),
    createTransfer: (...a: unknown[]) => mockCreateTransfer(...a),
    deleteTransfer: (...a: unknown[]) => mockDeleteTransfer(...a),
  },
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
    const s = { currentHousehold: { id: 'hh-xfer' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { BudgetTransferContext } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../test-utils/budgetConsistency';
import { BudgetTransferScreen } from '../BudgetTransferScreen';

const CONTEXT: BudgetTransferContext = {
  year: 2026,
  month: 7,
  monthLabel: 'July 2026',
  leftoverCents: 60000,
  plannedBudgetCents: 100000,
  actualSpentCents: 40000,
  carriedInCents: 0,
  transferredOutCents: 0,
  destinations: [
    {
      type: 'next_month',
      id: null,
      label: 'Next month · August 2026',
      sublabel: 'Roll it into next month’s budget',
      icon: 'arrow-forward-circle-outline',
    },
    {
      type: 'savings_goal',
      id: 'goal-1',
      label: 'New Roof',
      sublabel: '$1,000 of $5,000 saved',
      icon: 'flag-outline',
    },
    {
      type: 'registered_account',
      id: 'acct-1',
      label: 'TFSA · Questrade',
      sublabel: 'Balance $12,000',
      icon: 'card-outline',
    },
  ],
  history: [
    {
      id: 'xfer-1',
      amountCents: 20000,
      destinationType: 'savings_goal',
      destinationLabel: 'New Roof',
      note: 'Rainy day',
      createdAt: '2026-07-05T00:00:00Z',
    },
  ],
};

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetTransferScreen />
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

const queryByTestID = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0] ?? null;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetTransferContext.mockResolvedValue(CONTEXT);
  mockCreateTransfer.mockResolvedValue({ ...CONTEXT, leftoverCents: 0, transferredOutCents: 60000 });
  mockDeleteTransfer.mockResolvedValue({ ...CONTEXT, history: [] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('BudgetTransferScreen', () => {
  it('loads the transfer context for the selected month', async () => {
    await renderScreen();
    expect(mockGetTransferContext).toHaveBeenCalledWith('hh-xfer', 2026, 7);
  });

  it('renders the leftover, destinations, and existing transfers', async () => {
    const tree = await renderScreen();
    const text = collectRenderedText(tree);
    expect(text).toContain('$600'); // leftover 60000 cents
    expect(text).toContain('Next month · August 2026');
    expect(text).toContain('New Roof');
    expect(text).toContain('TFSA · Questrade');
  });

  it('defaults the amount field to the full leftover', async () => {
    const tree = await renderScreen();
    expect(findByTestID(tree, 'budget-transfer-amount').props.value).toBe('600');
  });

  it('transfers the leftover to next month by default', async () => {
    const tree = await renderScreen();
    await act(async () => {
      findByTestID(tree, 'budget-transfer-submit').props.onPress();
      await Promise.resolve();
    });
    expect(mockCreateTransfer).toHaveBeenCalledWith('hh-xfer', {
      source_year: 2026,
      source_month: 7,
      amount_cents: 60000,
      destination_type: 'next_month',
      destination_id: null,
      note: null,
    });
    expect(mockMarkInsightsDirty).toHaveBeenCalledWith('hh-xfer');
  });

  it('transfers to a chosen savings goal', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-transfer-dest-savings_goal-goal-1').props.onPress());
    await act(async () => {
      findByTestID(tree, 'budget-transfer-submit').props.onPress();
      await Promise.resolve();
    });
    expect(mockCreateTransfer).toHaveBeenCalledWith(
      'hh-xfer',
      expect.objectContaining({ destination_type: 'savings_goal', destination_id: 'goal-1' })
    );
  });

  it('"Move all" refills the amount with the whole leftover', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-transfer-amount').props.onChangeText('100'));
    expect(findByTestID(tree, 'budget-transfer-amount').props.value).toBe('100');
    act(() => findByTestID(tree, 'budget-transfer-move-all').props.onPress());
    expect(findByTestID(tree, 'budget-transfer-amount').props.value).toBe('600');
  });

  it('rejects an amount larger than the leftover without calling the API', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-transfer-amount').props.onChangeText('700'));
    await act(async () => {
      findByTestID(tree, 'budget-transfer-submit').props.onPress();
      await Promise.resolve();
    });
    expect(Alert.alert).toHaveBeenCalledWith('Too much', expect.stringContaining('$600'));
    expect(mockCreateTransfer).not.toHaveBeenCalled();
  });

  it('undoes a transfer from the history list (via the confirm alert)', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-transfer-undo-xfer-1').props.onPress());
    const undoAlert = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Undo transfer?');
    expect(undoAlert).toBeTruthy();
    const buttons = undoAlert![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Undo')!.onPress?.();
      await Promise.resolve();
    });
    expect(mockDeleteTransfer).toHaveBeenCalledWith('hh-xfer', 'xfer-1');
    expect(mockMarkInsightsDirty).toHaveBeenCalledWith('hh-xfer');
  });

  it('shows an empty state and no transfer form when there is no leftover', async () => {
    mockGetTransferContext.mockResolvedValue({ ...CONTEXT, leftoverCents: 0, destinations: [] });
    const tree = await renderScreen();
    expect(queryByTestID(tree, 'budget-transfer-submit')).toBeNull();
    expect(collectRenderedText(tree).join(' ')).toContain('No leftover to move this month');
  });

  it('goes back from the header back button', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'back-button').props.onPress());
    expect(mockGoBack).toHaveBeenCalled();
  });
});
