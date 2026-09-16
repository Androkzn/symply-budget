/**
 * SavingsView — container behaviour.
 *
 * Mocks the savings API (no network / native modules) and the five leaf
 * sub-views (tagged stand-ins, so this test is decoupled from peer-owned view
 * internals), then asserts: the internal FilterTabs (overview / income /
 * monthly / projection / goals) render, the active sub-tab renders the matching
 * stub, switching `activeSubTab` swaps the stub, and pressing a tab calls
 * `setActiveSubTab`.
 *
 * Also covers the header's dual scope: month-scoped tabs step MONTHS, while the
 * year-scoped Projection tab steps YEARS (a month stepper on a 12-month grid
 * would change nothing the user can see).
 *
 * The savingsStore mock is driven through a `mock`-prefixed holder object so
 * jest permits the out-of-scope reference inside the factory.
 */

// SafeAreaView passthrough — defensive, in case any live import pulls the heavy
// @components/common barrel (its real SafeAreaView drags in the navigator chain
// that crashes under the mocked @react-navigation/native).
jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      React.createElement(View, { testID }),
    screenScrollEndTestId: (screenRootTestId: string) => `${screenRootTestId}-scroll-end`,
  };
});

jest.mock('@api/savings', () => ({
  savingsApi: {
    getOverview: jest.fn().mockResolvedValue({}),
    listIncome: jest.fn().mockResolvedValue({ entries: [] }),
    listSpending: jest.fn().mockResolvedValue({ entries: [] }),
    listGoals: jest.fn().mockResolvedValue({ goals: [] }),
  },
}));

// Decouple from peer-owned leaf views — render tagged stand-ins so we can assert
// which one is mounted for a given activeSubTab.
jest.mock('../SavingsOverviewView', () => ({
  SavingsOverviewView: () =>
    require('react').createElement(require('react-native').View, {
      testID: 'stub-overview',
    }),
}));
jest.mock('../SavingsIncomeView', () => ({
  SavingsIncomeView: () =>
    require('react').createElement(require('react-native').View, {
      testID: 'stub-income',
    }),
}));
jest.mock('../SavingsMonthlyView', () => ({
  SavingsMonthlyView: () =>
    require('react').createElement(require('react-native').View, {
      testID: 'stub-monthly',
    }),
}));
jest.mock('../SavingsProjectionView', () => ({
  SavingsProjectionView: () =>
    require('react').createElement(require('react-native').View, {
      testID: 'stub-projection',
    }),
}));
jest.mock('../SavingsGoalsView', () => ({
  SavingsGoalsView: () =>
    require('react').createElement(require('react-native').View, {
      testID: 'stub-goals',
    }),
}));

const mockSetActiveSubTab = jest.fn();
const mockSetSelectedMonth = jest.fn();

// `mock`-prefixed so the jest.mock factory below may reference it (out-of-scope
// access is only permitted for names beginning with "mock").
const mockSavingsState: {
  selectedYear: number;
  selectedMonth: number;
  activeSubTab: 'overview' | 'income' | 'monthly' | 'projection' | 'goals';
  setActiveSubTab: jest.Mock;
  setSelectedMonth: jest.Mock;
} = {
  selectedYear: 2026,
  selectedMonth: 7,
  activeSubTab: 'overview',
  setActiveSubTab: mockSetActiveSubTab,
  setSelectedMonth: mockSetSelectedMonth,
};

jest.mock('@stores/savingsStore', () => ({
  useSavingsStore: (sel?: (s: unknown) => unknown) =>
    typeof sel === 'function' ? sel(mockSavingsState) : mockSavingsState,
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { SavingsView } from '../SavingsView';

function renderView() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SavingsView />
      </ThemeProvider>
    );
  });
  return tree;
}

beforeEach(() => {
  mockSetActiveSubTab.mockReset();
  mockSetSelectedMonth.mockReset();
  mockSavingsState.selectedYear = 2026;
  mockSavingsState.selectedMonth = 7;
  mockSavingsState.activeSubTab = 'overview';
});

describe('SavingsView', () => {
  it('renders the five sub-tabs and the month header', () => {
    const tree = renderView();
    const root = tree.root;

    expect(root.findByProps({ testID: 'savings-view' })).toBeTruthy();
    expect(root.findByProps({ testID: 'savings-month-prev' })).toBeTruthy();
    expect(root.findByProps({ testID: 'savings-month-next' })).toBeTruthy();
    // Sub-tab pills (FilterTabs renders each with testID `filter-tab-<id>`).
    expect(root.findByProps({ testID: 'filter-tab-overview' })).toBeTruthy();
    expect(root.findByProps({ testID: 'filter-tab-income' })).toBeTruthy();
    expect(root.findByProps({ testID: 'filter-tab-monthly' })).toBeTruthy();
    expect(root.findByProps({ testID: 'filter-tab-projection' })).toBeTruthy();
    expect(root.findByProps({ testID: 'filter-tab-goals' })).toBeTruthy();
  });

  it('renders the overview sub-view by default', () => {
    const tree = renderView();
    expect(tree.root.findByProps({ testID: 'stub-overview' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'stub-income' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'stub-monthly' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'stub-goals' })).toHaveLength(0);
  });

  it('renders the income sub-view when activeSubTab is income', () => {
    mockSavingsState.activeSubTab = 'income';
    const tree = renderView();
    expect(tree.root.findByProps({ testID: 'stub-income' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'stub-overview' })).toHaveLength(0);
  });

  it('renders the monthly sub-view when activeSubTab is monthly', () => {
    mockSavingsState.activeSubTab = 'monthly';
    const tree = renderView();
    expect(tree.root.findByProps({ testID: 'stub-monthly' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'stub-overview' })).toHaveLength(0);
  });

  it('renders the projection sub-view when activeSubTab is projection', () => {
    mockSavingsState.activeSubTab = 'projection';
    const tree = renderView();
    expect(tree.root.findByProps({ testID: 'stub-projection' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'stub-overview' })).toHaveLength(0);
  });

  it('renders the goals sub-view when activeSubTab is goals', () => {
    mockSavingsState.activeSubTab = 'goals';
    const tree = renderView();
    expect(tree.root.findByProps({ testID: 'stub-goals' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'stub-overview' })).toHaveLength(0);
  });

  it('calls setActiveSubTab with the tab id when a sub-tab is pressed', () => {
    const tree = renderView();
    act(() => {
      tree.root.findByProps({ testID: 'filter-tab-monthly' }).props.onPress();
    });
    expect(mockSetActiveSubTab).toHaveBeenCalledWith('monthly');
  });

  it('steps the month via setSelectedMonth when the arrows are pressed', () => {
    const tree = renderView();
    const root = tree.root;

    // Prev arrow → one month back (Jun 2026).
    act(() => {
      root.findByProps({ testID: 'savings-month-prev' }).props.onPress();
    });
    expect(mockSetSelectedMonth).toHaveBeenLastCalledWith(2026, 6);

    // Next arrow → one month forward (Aug 2026).
    act(() => {
      root.findByProps({ testID: 'savings-month-next' }).props.onPress();
    });
    expect(mockSetSelectedMonth).toHaveBeenLastCalledWith(2026, 8);
  });

  it('shows a month label on month-scoped tabs', () => {
    const tree = renderView();
    expect(tree.root.findByProps({ testID: 'savings-period-label' }).props.children).toBe(
      'July 2026'
    );
  });

  it('steps YEARS (not months) on the year-scoped Projection tab', () => {
    mockSavingsState.activeSubTab = 'projection';
    const tree = renderView();
    const root = tree.root;

    // The header collapses to the bare year — the whole grid is that year.
    expect(root.findByProps({ testID: 'savings-period-label' }).props.children).toBe('2026');

    act(() => {
      root.findByProps({ testID: 'savings-month-prev' }).props.onPress();
    });
    expect(mockSetSelectedMonth).toHaveBeenLastCalledWith(2025, 7);

    act(() => {
      root.findByProps({ testID: 'savings-month-next' }).props.onPress();
    });
    // Steps from the CURRENT store year, and the month is carried through so
    // switching back to a month-scoped tab lands where the user left it.
    expect(mockSetSelectedMonth).toHaveBeenLastCalledWith(2027, 7);
  });
});
