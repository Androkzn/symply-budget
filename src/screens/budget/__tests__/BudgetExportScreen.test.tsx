/**
 * Budget → Settings → Export.
 *
 * Export used to be a button plus a CSV link stapled to the bottom of the
 * Sync & sharing card, and it always dumped the whole ledger. It is a row of its
 * own now, and this screen is where the user says what goes in the file.
 *
 * What is pinned here is that contract: every section on by default, Enable all
 * / Disable all driving the whole list, the selection reaching BOTH export
 * formats, and neither format being reachable with nothing selected.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('expo-router/react-navigation', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, canGoBack: () => true }),
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    screenScrollViewStyle: { scroll: {} },
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    SafeAreaView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement(View, { testID }, children ?? null),
    ScreenHeader: ({ onBackPress }: { onBackPress?: () => void }) =>
      React.createElement(TouchableOpacity, { onPress: onBackPress, testID: 'nav-back-button' }),
  };
});

jest.mock('@features/budget/local/engine', () => ({
  __esModule: true,
  isLocalBudgetSessionOpen: () => true,
  getLocalLedger: () => ({
    household: { id: 'hh_1', name: 'Sweet Home' },
    categories: [{ id: 'c1' }, { id: 'c2' }],
    expenses: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }],
    items: [],
    goals: [],
    subBudgets: [],
    transfers: [],
    mortgages: [],
    savingsIncome: [],
    savingsRecurringPayments: [],
    savingsGoals: [],
    budgetLoans: [],
    registeredAccounts: [],
    wishes: [],
  }),
  // Read through `useSyncExternalStore` by the household members card this
  // screen renders. Omitted, React fails with "getSnapshot is not a function"
  // and points at itself rather than at this mock.
  subscribeToLedgerChanges: () => () => {},
  getLedgerRevision: () => 1,
  getActiveBudgetHouseholdId: () => 'hh_1',
}));

const mockExportXlsx = jest.fn();
const mockExportCsv = jest.fn();

jest.mock('@features/budget/local/export/budgetXlsxExport', () => ({
  __esModule: true,
  exportBudgetWorkbookXlsx: (...a: unknown[]) => mockExportXlsx(...a),
}));

jest.mock('@features/budget/local/export/budgetLedgerExport', () => ({
  __esModule: true,
  exportBudgetLedgerCsv: (...a: unknown[]) => mockExportCsv(...a),
}));

const mockGetItem = jest.fn<Promise<string | null>, [string]>();
const mockSetItem = jest.fn<Promise<void>, [string, string]>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (...a: [string]) => mockGetItem(...a),
    setItem: (...a: [string, string]) => mockSetItem(...a),
  },
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import {
  BUDGET_EXPORT_SECTION_KEYS,
  budgetExportSelectionOf,
} from '@features/budget/local/export/exportSelection';

import { BudgetExportScreen } from '../BudgetExportScreen';

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

const query = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0] ?? null;

const find = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.find((n) => n.props?.testID === id);

async function press(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  await act(async () => {
    find(tree, id).props.onPress();
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function toggle(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  await act(async () => {
    find(tree, id).props.onValueChange(!find(tree, id).props.value);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

const toggleValues = (tree: ReactTestRenderer.ReactTestRenderer) =>
  BUDGET_EXPORT_SECTION_KEYS.map((key) => find(tree, `budget-export-toggle-${key}`).props.value);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
  mockExportXlsx.mockResolvedValue({ status: 'shared', message: 'workbook ready', rows: 3 });
  mockExportCsv.mockResolvedValue({ status: 'shared', message: 'csv ready', rows: 3 });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('BudgetExportScreen', () => {
  it('offers a toggle per section, every one on by default', async () => {
    const tree = await render(<BudgetExportScreen />);

    expect(query(tree, 'budget-export-screen')).not.toBeNull();
    expect(toggleValues(tree)).toEqual(BUDGET_EXPORT_SECTION_KEYS.map(() => true));
  });

  it('restores the last saved choice instead of resetting to all-on', async () => {
    mockGetItem.mockResolvedValue(JSON.stringify({ wishes: false }));

    const tree = await render(<BudgetExportScreen />);

    expect(find(tree, 'budget-export-toggle-wishes').props.value).toBe(false);
    expect(find(tree, 'budget-export-toggle-spending').props.value).toBe(true);
  });

  it('flips one section without touching the rest, and remembers it', async () => {
    const tree = await render(<BudgetExportScreen />);

    await toggle(tree, 'budget-export-toggle-wishes');

    expect(find(tree, 'budget-export-toggle-wishes').props.value).toBe(false);
    expect(find(tree, 'budget-export-toggle-loans').props.value).toBe(true);
    expect(JSON.parse(mockSetItem.mock.calls.at(-1)![1])).toMatchObject({
      wishes: false,
      loans: true,
    });
  });

  it('drives the whole list from Disable all / Enable all', async () => {
    const tree = await render(<BudgetExportScreen />);

    await press(tree, 'budget-export-disable-all');
    expect(toggleValues(tree)).toEqual(BUDGET_EXPORT_SECTION_KEYS.map(() => false));

    await press(tree, 'budget-export-enable-all');
    expect(toggleValues(tree)).toEqual(BUDGET_EXPORT_SECTION_KEYS.map(() => true));
  });

  it('hands the current selection AND the household to both export formats', async () => {
    // BR-016: the household is named rather than defaulted. An export is a long
    // chain of awaits, and a switch anywhere in it would otherwise hand over a
    // workbook of the other household's spending under this one's name.
    const tree = await render(<BudgetExportScreen />);

    await toggle(tree, 'budget-export-toggle-wishes');
    await press(tree, 'budget-settings-export-xlsx');

    expect(mockExportXlsx).toHaveBeenCalledWith({
      householdId: 'hh_1',
      sections: { ...budgetExportSelectionOf(true), wishes: false },
    });

    await press(tree, 'budget-settings-export-csv');
    expect(mockExportCsv).toHaveBeenCalledWith({
      householdId: 'hh_1',
      sections: { ...budgetExportSelectionOf(true), wishes: false },
    });
  });

  it('refuses to export nothing', async () => {
    const tree = await render(<BudgetExportScreen />);

    await press(tree, 'budget-export-disable-all');
    await press(tree, 'budget-settings-export-xlsx');
    await press(tree, 'budget-settings-export-csv');

    expect(mockExportXlsx).not.toHaveBeenCalled();
    expect(mockExportCsv).not.toHaveBeenCalled();
    expect(find(tree, 'budget-settings-export-xlsx').props.disabled).toBe(true);
  });

  it('reports the outcome of an export', async () => {
    const tree = await render(<BudgetExportScreen />);

    await press(tree, 'budget-settings-export-xlsx');

    expect(Alert.alert).toHaveBeenCalledWith('Export ready', 'workbook ready');
  });

  it('surfaces a failed export without blaming the user', async () => {
    mockExportXlsx.mockRejectedValue(new Error('ledger closed'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const tree = await render(<BudgetExportScreen />);

    await press(tree, 'budget-settings-export-xlsx');

    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Could not export budget data.');
    // The button must come back — a one-shot failure cannot strand the screen.
    expect(find(tree, 'budget-settings-export-xlsx').props.disabled).toBe(false);
  });
});
