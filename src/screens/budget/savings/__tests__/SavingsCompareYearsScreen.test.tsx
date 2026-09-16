/**
 * SavingsCompareYearsScreen — device-responsive "Compare years" screen.
 *
 * The screen reads `useWindowDimensions()` and derives the ONLY width-dependent
 * value it renders with: `chartWidth = Math.max(width - 32, 320)`, which it
 * hands to <AppBarChart width={chartWidth} />. AppBarChart forwards that width
 * straight to gifted-charts' <BarChart width={…} />, so we override the chart
 * mock to capture the concrete pixel width the chart is laid out at and assert
 * it adapts correctly across the iPhone and iPad matrix (the wider the device,
 * the wider the chart; a narrow device is clamped at the 320 floor).
 *
 * Beyond the width matrix this exercises: the loading spinner, the empty state
 * (both the empty-comparison and the fetch-failure paths), a fully populated
 * comparison (legend + net-by-month chart + yearly-totals table + year-over-year
 * deltas, incl. positive/negative net coloring and the null-percent "—"), the
 * year multi-select chips (add / remove / keep-at-least-one / MAX_YEARS cap and
 * the reload each toggle triggers), back navigation, and the no-household guard.
 *
 * Follows the SavingsOverviewView precedent: `@components/common` is stubbed to
 * avoid its barrel dragging in the navigator chain, and gifted-charts' BarChart
 * is overridden locally (allowed over the global jest.setup stub) to inspect the
 * width + data it receives. The useWindowDimensions mock is hoisted exactly as
 * src/test-utils/deviceRender.tsx documents.
 */

// The device-render harness requires this exact hoisted mock; setDevice() then
// points it at each device's logical size before render.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

// SafeAreaView + BackButton passthroughs so the heavy @components/common barrel
// (SidebarTabBar → navigator chain) never loads under the mocked navigation.
jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    screenScrollViewStyle: { scroll: {} },
    SCREEN_SCROLL_TEST_ID: 'screen-scroll',
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement(View, { testID }, children ?? null),
    BackButton: ({ onPress, testID }: { onPress: () => void; testID?: string }) =>
      React.createElement(TouchableOpacity, { onPress, testID }),
    ScreenHeader: ({
      title,
      showBackButton,
      onBackPress,
      backButtonTestID,
    }: {
      title?: string;
      showBackButton?: boolean;
      onBackPress?: () => void;
      backButtonTestID?: string;
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
        title ? React.createElement(Text, null, title) : null
      ),
  };
});

const mockNav = { goBack: jest.fn(), navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

// Override the global gifted-charts stub so we can read the width + data the
// real AppBarChart forwards to the BarChart (chartWidth → width prop).
let mockLastChartWidth: number | null = null;
let mockLastChartData: unknown[] | null = null;
jest.mock('react-native-gifted-charts', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    BarChart: (props: { width?: number; data?: unknown[] }) => {
      mockLastChartWidth = props.width ?? null;
      mockLastChartData = props.data ?? null;
      return React.createElement(View, { testID: 'bar-chart' });
    },
  };
});

jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

const mockGetHistoryYears = jest.fn();
const mockCompareYears = jest.fn();
jest.mock('@api/savings', () => ({
  savingsApi: {
    getHistoryYears: (...args: unknown[]) => mockGetHistoryYears(...args),
    compareYears: (...args: unknown[]) => mockCompareYears(...args),
  },
}));

// `mock`-prefixed mutable holders so the jest.mock factories may reference them.
let mockCurrentHousehold: { id: string } | null = { id: 'hh-1' };
let mockSelectedYear = 2025;
let mockDataRevision = 0;

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: mockCurrentHousehold };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/savingsStore', () => ({
  useSavingsStore: (sel?: (s: unknown) => unknown) => {
    const s = { selectedYear: mockSelectedYear, dataRevision: mockDataRevision };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import {useWindowDimensions} from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { YearColumnTotals, YearComparison } from '@api/savings';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';


import {
  DEVICES,
  IPADS,
  PHONES,
  setDevice,
  treeText,
  type DeviceName,
} from '../../../../test-utils/deviceRender';
import { SavingsCompareYearsScreen } from '../SavingsCompareYearsScreen';

// ---- Fixtures ------------------------------------------------------------

const totals = (
  income: number,
  monthlyPayments: number,
  food: number,
  other: number,
  net: number
): YearColumnTotals => ({ income, monthlyPayments, food, other, net });

const months12 = (base: number): number[] =>
  Array.from({ length: 12 }, (_, i) => base + i * 1000);

/** Three-year comparison: 2023/2024 net-positive, 2025 net-negative; one delta
 *  with a numeric %, one with a null % ("—"); a short net-by-month array. */
const RICH_COMPARISON: YearComparison = {
  years: [
    { year: 2023, totals: totals(400000, 180000, 70000, 40000, 110000), average: totals(33333, 15000, 5833, 3333, 9166), monthsWithData: 12 },
    { year: 2024, totals: totals(500000, 200000, 80000, 50000, 170000), average: totals(41666, 16666, 6666, 4166, 14166), monthsWithData: 12 },
    { year: 2025, totals: totals(300000, 250000, 90000, 60000, -100000), average: totals(50000, 41666, 15000, 10000, -16666), monthsWithData: 6 },
  ],
  deltas: [
    { fromYear: 2023, toYear: 2024, income: 100000, monthlyPayments: 20000, food: 10000, other: 10000, net: 60000, netPct: 54 },
    { fromYear: 2024, toYear: 2025, income: -200000, monthlyPayments: 50000, food: 10000, other: 10000, net: -270000, netPct: null },
  ],
  netByYearMonth: [
    { year: 2023, months: months12(5000) },
    { year: 2024, months: months12(8000) },
    { year: 2025, months: [10000, -20000, 30000] }, // short → exercises `?? 0`
  ],
};

const EMPTY_COMPARISON: YearComparison = { years: [], deltas: [], netByYearMonth: [] };

// ---- Render helpers ------------------------------------------------------

function renderSync(): ReactTestRenderer.ReactTestRenderer {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <ThemeProvider>
        <SavingsCompareYearsScreen />
      </ThemeProvider>
    );
  });
  return r;
}

async function settle(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
     
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Mount at a device size and flush the two-stage load (years → comparison). */
async function renderCompare(
  device: DeviceName
): Promise<ReactTestRenderer.ReactTestRenderer> {
  setDevice(device);
  const r = renderSync();
  await settle();
  return r;
}

/** Tap a host node's onPress inside act, then flush any reload it triggers. */
async function tap(
  r: ReactTestRenderer.ReactTestRenderer,
  testID: string
): Promise<void> {
  await act(async () => {
    r.root.findByProps({ testID }).props.onPress();
    await Promise.resolve();
  });
  await settle(2);
}

const lastCompareArgs = (): [string, number[]] =>
  mockCompareYears.mock.calls[mockCompareYears.mock.calls.length - 1] as [string, number[]];

beforeEach(() => {
  jest.clearAllMocks();
  mockLastChartWidth = null;
  mockLastChartData = null;
  mockCurrentHousehold = { id: 'hh-1' };
  mockSelectedYear = 2025;
  mockDataRevision = 0;
  (useWindowDimensions as unknown as jest.Mock).mockReturnValue({
    width: 393,
    height: 852,
    scale: 3,
    fontScale: 1,
  });
  mockGetHistoryYears.mockResolvedValue([2025, 2024, 2023]);
  mockCompareYears.mockResolvedValue(RICH_COMPARISON);
});

// ---- Loading / empty / guard states -------------------------------------

describe('SavingsCompareYearsScreen — states', () => {
  it('shows the loading spinner before data resolves', async () => {
    setDevice('iPhone 14 Pro');
    const r = renderSync(); // no flush → still loading
    expect(r.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    expect(treeText(r)).not.toContain('No data to compare yet');
    await settle(); // settle to avoid post-teardown state updates
  });

  it('renders the empty state when the comparison has no years', async () => {
    mockCompareYears.mockResolvedValue(EMPTY_COMPARISON);
    const r = await renderCompare('iPhone 14 Pro');
    expect(r.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(treeText(r)).toContain('No data to compare yet. Import a previous year first.');
  });

  it('falls back to the empty state when the comparison fetch fails', async () => {
    mockCompareYears.mockRejectedValue(new Error('boom'));
    const r = await renderCompare('iPhone 14 Pro');
    expect(treeText(r)).toContain('No data to compare yet');
  });

  it('shows empty (and never fetches a comparison) when there are no history years', async () => {
    // getHistoryYears rejects → selection stays empty → load() short-circuits.
    mockGetHistoryYears.mockRejectedValue(new Error('no years'));
    const r = await renderCompare('iPhone 14 Pro');
    expect(treeText(r)).toContain('No data to compare yet');
    expect(mockCompareYears).not.toHaveBeenCalled();
  });

  it('stays in loading and skips the years fetch when there is no household', async () => {
    mockCurrentHousehold = null;
    const r = await renderCompare('iPhone 14 Pro');
    expect(mockGetHistoryYears).not.toHaveBeenCalled();
    expect(r.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  });
});

// ---- Populated comparison render ----------------------------------------

describe('SavingsCompareYearsScreen — populated comparison', () => {
  it('requests the comparison for the household and default (3 most recent) years', async () => {
    await renderCompare('iPhone 14 Pro');
    expect(mockGetHistoryYears).toHaveBeenCalledWith('hh-1');
    // defaultSelection: 3 most recent, ascending.
    expect(lastCompareArgs()).toEqual(['hh-1', [2023, 2024, 2025]]);
  });

  it('renders the section scaffold, legend and every compared year', async () => {
    const r = await renderCompare('iPhone 14 Pro');
    const text = treeText(r);
    expect(r.root.findByProps({ testID: 'savings-compare-years' })).toBeTruthy();
    expect(text).toContain('Compare years');
    expect(text).toContain('Net savings by month');
    expect(text).toContain('Yearly totals');
    expect(text).toContain('Year over year');
    expect(text).toContain('2023');
    expect(text).toContain('2024');
    expect(text).toContain('2025');
  });

  it('formats totals with sign-leading currency incl. a negative net', async () => {
    const r = await renderCompare('iPhone 14 Pro');
    const text = treeText(r);
    expect(text).toContain('$4,000'); // 2023 income (400000c)
    expect(text).toContain('-$1,000'); // 2025 net (-100000c) → sign leads the "$"
  });

  it('renders year-over-year deltas with signed value + percent, and "—" for a null percent', async () => {
    const r = await renderCompare('iPhone 14 Pro');
    const text = treeText(r);
    expect(text).toContain('2023 → 2024 net');
    expect(text).toContain('+$600'); // +60000c, positive net is "+"-prefixed
    expect(text).toContain('+54%');
    expect(text).toContain('2024 → 2025 net');
    expect(text).toContain('-$2,700'); // -270000c, negative net keeps its own "-"
    expect(text).toContain('—'); // null percent
  });

  it('feeds the chart one flattened bar per month × year (12 × 3 = 36)', async () => {
    await renderCompare('iPhone 14 Pro');
    expect(mockLastChartData).not.toBeNull();
    expect(mockLastChartData).toHaveLength(36);
  });

  it('hides the year-over-year card when there are no deltas', async () => {
    mockCompareYears.mockResolvedValue({ ...RICH_COMPARISON, deltas: [] });
    const r = await renderCompare('iPhone 14 Pro');
    expect(treeText(r)).not.toContain('Year over year');
    // The rest of the populated view still renders.
    expect(treeText(r)).toContain('Yearly totals');
  });
});

// ---- Year multi-select chips + reload ------------------------------------

describe('SavingsCompareYearsScreen — year selection', () => {
  it('offers a chip per available year (ascending)', async () => {
    const r = await renderCompare('iPhone 14 Pro');
    expect(r.root.findByProps({ testID: 'savings-compare-chip-2023' })).toBeTruthy();
    expect(r.root.findByProps({ testID: 'savings-compare-chip-2024' })).toBeTruthy();
    expect(r.root.findByProps({ testID: 'savings-compare-chip-2025' })).toBeTruthy();
  });

  it('deselecting a year reloads the comparison without it', async () => {
    const r = await renderCompare('iPhone 14 Pro');
    await tap(r, 'savings-compare-chip-2023');
    expect(lastCompareArgs()).toEqual(['hh-1', [2024, 2025]]);
  });

  it('re-selecting a year adds it back (kept sorted) and reloads', async () => {
    const r = await renderCompare('iPhone 14 Pro');
    await tap(r, 'savings-compare-chip-2023'); // remove
    await tap(r, 'savings-compare-chip-2023'); // add back
    expect(lastCompareArgs()).toEqual(['hh-1', [2023, 2024, 2025]]);
  });

  it('keeps at least one year: tapping the only selected chip is a no-op', async () => {
    mockGetHistoryYears.mockResolvedValue([2025]);
    const r = await renderCompare('iPhone 14 Pro');
    const before = mockCompareYears.mock.calls.length;
    await tap(r, 'savings-compare-chip-2025'); // only selection → unchanged
    expect(mockCompareYears.mock.calls.length).toBe(before);
    expect(lastCompareArgs()).toEqual(['hh-1', [2025]]);
  });

  it('caps the selection at MAX_YEARS (5): the 6th add is ignored', async () => {
    mockGetHistoryYears.mockResolvedValue([2025, 2024, 2023, 2022, 2021, 2020]);
    const r = await renderCompare('iPhone 14 Pro');
    // Default selection is [2023, 2024, 2025] (3). Add two more to reach 5…
    await tap(r, 'savings-compare-chip-2022');
    await tap(r, 'savings-compare-chip-2021');
    const callsAtFive = mockCompareYears.mock.calls.length;
    // …then the 6th add must be rejected (still exactly 5, without 2020).
    await tap(r, 'savings-compare-chip-2020');
    expect(mockCompareYears.mock.calls.length).toBe(callsAtFive);
    expect(lastCompareArgs()).toEqual(['hh-1', [2021, 2022, 2023, 2024, 2025]]);
  });
});

// ---- Navigation ----------------------------------------------------------

describe('SavingsCompareYearsScreen — navigation', () => {
  it('goes back when the back button is pressed', async () => {
    const r = await renderCompare('iPhone 14 Pro');
    await act(async () => {
      r.root.findByProps({ testID: 'savings-compare-back' }).props.onPress();
    });
    expect(mockNav.goBack).toHaveBeenCalledTimes(1);
  });
});

// ---- Device-responsive width matrix (the crux) ---------------------------
//
// chartWidth = Math.max(width - 32, 320) is the screen's only width branch. It
// flows into <AppBarChart width> → <BarChart width>, which the local chart mock
// captures. Every harness device is wider than 352px, so each resolves to
// `width - 32` (the clamp floor is covered by its own case below).

describe('SavingsCompareYearsScreen — chart width adapts to device (iPhone)', () => {
  it.each(PHONES)('sizes the chart to width−32 on %s', async (device) => {
    const r = await renderCompare(device);
    expect(r.root.findByProps({ testID: 'bar-chart' })).toBeTruthy();
    expect(mockLastChartWidth).toBe(DEVICES[device].width - 32);
  });
});

describe('SavingsCompareYearsScreen — chart width adapts to device (iPad)', () => {
  it.each(IPADS)('sizes the chart to width−32 on %s', async (device) => {
    const r = await renderCompare(device);
    expect(r.root.findByProps({ testID: 'bar-chart' })).toBeTruthy();
    expect(mockLastChartWidth).toBe(DEVICES[device].width - 32);
  });
});

describe('SavingsCompareYearsScreen — chart width, cross-device', () => {
  it('renders a wider chart on iPad than on a compact iPhone', async () => {
    await renderCompare('iPhone SE');
    const phoneWidth = mockLastChartWidth;

    mockLastChartWidth = null;
    await renderCompare('iPad Pro 12.9 (portrait)');
    const ipadWidth = mockLastChartWidth;

    expect(phoneWidth).toBe(DEVICES['iPhone SE'].width - 32); // 343
    expect(ipadWidth).toBe(DEVICES['iPad Pro 12.9 (portrait)'].width - 32); // 992
    expect(ipadWidth!).toBeGreaterThan(phoneWidth!);
  });

  it('clamps the chart width to the 320 floor on an ultra-narrow window', async () => {
    (useWindowDimensions as unknown as jest.Mock).mockReturnValue({
      width: 300,
      height: 700,
      scale: 3,
      fontScale: 1,
    });
    const r = renderSync();
    await settle();
    expect(r.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(mockLastChartWidth).toBe(320); // Math.max(300 − 32, 320)
  });
});
