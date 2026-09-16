/**
 * SavingsYearHistoryScreen — Previous-years history grid behaviour.
 *
 * Renders the tracker-style grid for a single year (12 months + totals/avg/goals)
 * fetched via `savingsApi.getHistoryYears` + `savingsApi.getYearHistory`. This
 * suite drives: the loading spinner, the empty state (no household / no data /
 * fetch failure), the populated grid (month rows, totals, average, currency
 * formatting, net-sign coloring), the year picker, the Goals footer, pull-to-
 * refresh and every navigation target (back / compare / import).
 *
 * Follows the proven isolation pattern: navigation + API + stores are mocked so
 * no native module or network is touched, and the peer-owned `@components/common`
 * barrel is stubbed to passthrough views (its real SafeAreaView drags in the
 * navigator chain that crashes under the mocked @react-navigation/native).
 */

// Navigation — screen pulls useNavigation/useRoute from expo-router/react-navigation,
// which jest.config maps to @react-navigation/native. Stub it so navigate/goBack
// are observable and route params are controllable per-test.
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockNav = { navigate: mockNavigate, goBack: mockGoBack };
// `mock`-prefixed so the jest.mock factory may reference it (out-of-scope access
// is only permitted for names beginning with "mock").
let mockParams: Record<string, unknown> | undefined = { year: 2025 };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockParams }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

// Peer-owned barrel — passthrough the three members this screen uses, preserving
// testID + onPress + label so interactions and structure stay assertable.
jest.mock('@components/common', () => {
  const React = require('react');
  const { View, TouchableOpacity, Text } = require('react-native');
  return {
    screenScrollViewStyle: { scroll: {} },
    SCREEN_SCROLL_TEST_ID: 'screen-scroll',
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children, testID }: any) =>
      React.createElement(View, { testID }, children ?? null),
    BackButton: ({ onPress, testID }: any) =>
      React.createElement(TouchableOpacity, { onPress, testID }),
    HeaderActionButton: ({ onPress, testID, label }: any) =>
      React.createElement(TouchableOpacity, { onPress, testID }, React.createElement(Text, null, label)),
    ScreenHeader: ({
      title,
      showBackButton,
      onBackPress,
      backButtonTestID,
      rightElement,
    }: {
      title?: string;
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
        title ? React.createElement(Text, null, title) : null,
        rightElement ?? null
      ),
  };
});

const mockGetHistoryYears = jest.fn();
const mockGetYearHistory = jest.fn();

jest.mock('@api/savings', () => ({
  savingsApi: {
    getHistoryYears: (...args: unknown[]) => mockGetHistoryYears(...args),
    getYearHistory: (...args: unknown[]) => mockGetYearHistory(...args),
  },
}));

// Toasts — defensive: this screen doesn't surface a toast today, but mocking the
// module keeps any future/transitive import inert in the test env.
jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

const mockHouseholdState: { currentHousehold: { id: string } | null } = {
  currentHousehold: { id: 'hh-1' },
};
jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (selector?: (s: typeof mockHouseholdState) => unknown) =>
    selector ? selector(mockHouseholdState) : mockHouseholdState,
}));

const mockSavingsState: { selectedYear: number; dataRevision: number } = {
  selectedYear: 2026,
  dataRevision: 0,
};
jest.mock('@stores/savingsStore', () => ({
  useSavingsStore: (selector?: (s: typeof mockSavingsState) => unknown) =>
    selector ? selector(mockSavingsState) : mockSavingsState,
}));

import React from 'react';
import { RefreshControl } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type {
  YearHistory,
  YearHistoryGoals,
  YearMonthlyRow,
} from '@api/savings';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';
import { useAppColors, type AppColors } from '@theme';

import { SavingsYearHistoryScreen } from '../SavingsYearHistoryScreen';

// Capture the live theme colors so net-sign coloring can be asserted against the
// SAME values the screen resolves via useAppColors (netColor uses success/error).
let capturedColors: AppColors | null = null;
function ColorProbe() {
  capturedColors = useAppColors();
  return null;
}

function makeMonths(): YearMonthlyRow[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    // February is the lone negative-net month so "-$300" is a unique target.
    if (month === 2) {
      return { month, income: 100000, monthlyPayments: 60000, food: 40000, other: 30000, net: -30000 };
    }
    return { month, income: 500000, monthlyPayments: 200000, food: 80000, other: 50000, net: 170000 };
  });
}

function makeYearHistory(overrides: Partial<YearHistory> = {}): YearHistory {
  const goals: YearHistoryGoals = {
    foodMonthly: 80000, // $800
    otherMonthly: null,
    savingsMonthly: 100000, // $1,000
    savingsYearly: null,
    plannedBudgetByMonth: Array(12).fill(null),
  };
  return {
    year: 2025,
    months: makeMonths(),
    totals: { income: 6000000, monthlyPayments: 2400000, food: 960000, other: 600000, net: 2040000 },
    average: { income: 500000, monthlyPayments: 200000, food: 80000, other: 50000, net: 170000 },
    monthsWithData: 12,
    goals,
    ...overrides,
  };
}

/** Collect every rendered Text string for figure/label assertions. */
function allText(root: ReactTestRenderer.ReactTestInstance): string {
  return root
    .findAllByType('Text' as any)
    .map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children))
    .filter((c) => typeof c === 'string')
    .join(' | ');
}

/** The interactive node carrying `testID` that owns an onPress (skips wrappers). */
function pressTarget(root: ReactTestRenderer.ReactTestInstance, testID: string) {
  return root
    .findAllByProps({ testID })
    .find((n) => typeof n.props.onPress === 'function');
}

/** The Typography node whose visible value equals `value` (unique in fixtures). */
function typographyWith(root: ReactTestRenderer.ReactTestInstance, value: string) {
  return root.findAllByType(Typography).find((n) => n.props.children === value);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <ColorProbe />
        <SavingsYearHistoryScreen />
      </ThemeProvider>
    );
  });
  await flush();
  return tree;
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockGoBack.mockReset();
  mockGetHistoryYears.mockReset().mockResolvedValue([2025, 2024, 2023]);
  mockGetYearHistory.mockReset().mockResolvedValue(makeYearHistory());
  mockHouseholdState.currentHousehold = { id: 'hh-1' };
  mockSavingsState.selectedYear = 2026;
  mockSavingsState.dataRevision = 0;
  mockParams = { year: 2025 };
});

describe('SavingsYearHistoryScreen', () => {
  it('shows a loading spinner until the year fetch resolves, then the grid', async () => {
    // getYearHistory stays pending so Promise.all (and thus `loading`) hangs.
    let resolveHistory!: (v: YearHistory) => void;
    mockGetYearHistory.mockReturnValue(
      new Promise<YearHistory>((res) => {
        resolveHistory = res;
      })
    );

    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <ColorProbe />
          <SavingsYearHistoryScreen />
        </ThemeProvider>
      );
    });

    // Loading branch is on-screen.
    expect(tree.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'savings-year-row-1' })).toHaveLength(0);

    await act(async () => {
      resolveHistory(makeYearHistory());
    });
    await flush();

    // Spinner gone, grid mounted.
    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'savings-year-row-1' })).toBeTruthy();
  });

  it('fetches years + the selected year on mount using the route param year', async () => {
    mockParams = { year: 2024 };
    await renderScreen();

    expect(mockGetHistoryYears).toHaveBeenCalledWith('hh-1');
    expect(mockGetYearHistory).toHaveBeenCalledWith('hh-1', 2024);
  });

  it('falls back to the store selectedYear when the route has no year param', async () => {
    mockParams = {};
    mockSavingsState.selectedYear = 2026;
    await renderScreen();

    expect(mockGetYearHistory).toHaveBeenCalledWith('hh-1', 2026);
  });

  it('renders the header, title and the year picker chips', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    expect(root.findByProps({ testID: 'savings-year-history' })).toBeTruthy();
    expect(root.findByProps({ testID: 'savings-year-history-back' })).toBeTruthy();
    expect(root.findByProps({ testID: 'savings-year-history-compare' })).toBeTruthy();
    expect(allText(root)).toContain('Previous years');

    // A chip per union of available years + selected year (buildYearOptions).
    expect(root.findByProps({ testID: 'savings-year-chip-2025' })).toBeTruthy();
    expect(root.findByProps({ testID: 'savings-year-chip-2024' })).toBeTruthy();
    expect(root.findByProps({ testID: 'savings-year-chip-2023' })).toBeTruthy();
  });

  it('renders the grid: column headers, month labels, totals and average rows', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    // One row per month.
    expect(root.findByProps({ testID: 'savings-year-row-1' })).toBeTruthy();
    expect(root.findByProps({ testID: 'savings-year-row-12' })).toBeTruthy();

    const text = allText(root);
    // Column headers.
    ['Income', 'Payments', 'Food', 'Other', 'Savings'].forEach((h) =>
      expect(text).toContain(h)
    );
    // Month abbreviations from MONTH_ABBR.
    expect(text).toContain('Jan');
    expect(text).toContain('Feb');
    // Totals + average labels.
    expect(text).toContain('Total');
    expect(text).toContain('Avg');
  });

  it('formats the BE cents figures with the shared budget currency formatter', async () => {
    const tree = await renderScreen();
    const text = allText(tree.root);

    // Month 1 income 500000c → "$5,000"; totals income 6000000c → "$60,000".
    expect(text).toContain('$5,000');
    expect(text).toContain('$60,000');
    // Totals net 2040000c → "$20,400"; Feb net -30000c → "-$300".
    expect(text).toContain('$20,400');
    expect(text).toContain('-$300');
  });

  it('colors the net figures by sign (success ≥ 0, error < 0)', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    expect(capturedColors).toBeTruthy();

    // Positive totals net → success color.
    const totalsNet = typographyWith(root, '$20,400');
    expect(totalsNet?.props.color).toBe(capturedColors!.success);

    // Negative February net → error color.
    const febNet = typographyWith(root, '-$300');
    expect(febNet?.props.color).toBe(capturedColors!.error);
  });

  it('renders the Goals footer only for goal rows that are set', async () => {
    const tree = await renderScreen();
    const text = allText(tree.root);

    expect(text).toContain('Goals');
    expect(text).toContain('Food goal / mo'); // 80000c → $800
    expect(text).toContain('Savings goal / mo'); // 100000c → $1,000
    // The null goal rows are omitted.
    expect(text).not.toContain('Other goal / mo');
    expect(text).not.toContain('Savings goal / yr');
  });

  it('omits the Goals footer entirely when no goals are set', async () => {
    mockGetYearHistory.mockResolvedValue(
      makeYearHistory({
        goals: {
          foodMonthly: null,
          otherMonthly: null,
          savingsMonthly: null,
          savingsYearly: null,
          plannedBudgetByMonth: Array(12).fill(null),
        },
      })
    );
    const tree = await renderScreen();
    expect(allText(tree.root)).not.toContain('Goals');
  });

  it('navigates back when the back button is pressed', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressTarget(tree.root, 'savings-year-history-back')!.props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('navigates to the compare screen from the header action', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressTarget(tree.root, 'savings-year-history-compare')!.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('SavingsCompareYears', undefined);
  });

  it('navigates to import (scope: history) from the populated footer button', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressTarget(tree.root, 'savings-year-history-import')!.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('SavingsImport', { scope: 'history' });
  });

  it('reloads the newly selected year when a year chip is pressed', async () => {
    const tree = await renderScreen();
    mockGetYearHistory.mockClear();

    await act(async () => {
      pressTarget(tree.root, 'savings-year-chip-2024')!.props.onPress();
    });
    await flush();

    expect(mockGetYearHistory).toHaveBeenLastCalledWith('hh-1', 2024);
  });

  it('re-fetches the current year on pull-to-refresh', async () => {
    const tree = await renderScreen();
    const refresh = tree.root.findByType(RefreshControl);
    mockGetYearHistory.mockClear();

    await act(async () => {
      refresh.props.onRefresh();
    });
    await flush();

    expect(mockGetYearHistory).toHaveBeenCalledWith('hh-1', 2025);
  });

  it('shows the empty state (with import CTA) when the year has no data', async () => {
    mockGetYearHistory.mockResolvedValue(makeYearHistory({ monthsWithData: 0 }));
    const tree = await renderScreen();
    const root = tree.root;

    expect(allText(root)).toContain('No data for 2025');
    // No grid rows in the empty state.
    expect(root.findAllByProps({ testID: 'savings-year-row-1' })).toHaveLength(0);
    // The dedicated empty-state import CTA routes to import.
    await act(async () => {
      pressTarget(root, 'savings-year-history-import-empty')!.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('SavingsImport', { scope: 'history' });
  });

  it('shows the empty state when the year fetch fails', async () => {
    mockGetYearHistory.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    const root = tree.root;

    // getYearHistory was attempted, the catch cleared history → empty state.
    expect(mockGetYearHistory).toHaveBeenCalledWith('hh-1', 2025);
    expect(allText(root)).toContain('No data for 2025');
    expect(root.findAllByProps({ testID: 'savings-year-row-1' })).toHaveLength(0);
  });

  it('does not fetch and shows the empty state when there is no household', async () => {
    mockHouseholdState.currentHousehold = null;
    const tree = await renderScreen();
    const root = tree.root;

    expect(mockGetHistoryYears).not.toHaveBeenCalled();
    expect(mockGetYearHistory).not.toHaveBeenCalled();
    // Loading resolved to false and, with null history, the empty card renders.
    expect(root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(allText(root)).toContain('No data for 2025');
  });
});
