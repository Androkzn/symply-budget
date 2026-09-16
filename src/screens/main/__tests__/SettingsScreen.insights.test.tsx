/**
 * SettingsScreen (the "More" tab) — the INSIGHTS group.
 *
 * The long-term plan, previous years and compare-years views used to be three
 * bare text links at the bottom of Budget Settings, behind the Profile gear.
 * They configure nothing — they only READ the budget over a longer horizon —
 * so they live on More now, as rows in their own group.
 *
 * Two things are worth guarding, and both were shipped wrong elsewhere before:
 *
 *  1. The DOOR. These destinations are screens in the Budget stack, which is
 *     nested inside the HOME tab — a sibling of this one. `router.push` to `/`
 *     re-focuses an already-mounted tab WITHOUT delivering the new params, so
 *     the stack never sees `screen` and you land on the dashboard. Only the
 *     Linking URL delivers them (same finding as `app/_layout.tsx` and
 *     `ProfileScreen.settingsGear.test.tsx`), and each visit needs a fresh
 *     `navNonce` or the stack's NavigationHandler dedupe swallows it.
 *  2. The GATE. Only full Budget shows the group — no other brand has these
 *     screens registered, so a visible row there would be a dead end.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

/*
 * The Jest brand is House, so `isFullBudget()` is false by default and the
 * group under test would never render. Flip it at the SOURCE — `@brand` simply
 * re-exports this binding from `./capabilities`, and mocking the barrel itself
 * takes down the theme, which reads `brand.colors` at import time (see
 * SettingsNavigator.houseV2.test.tsx, which documents both failed attempts).
 *
 * Everything else about the brand stays House: what these tests assert is the
 * gate and the door, neither of which reads any other capability.
 */
let mockFullBudget = true;
jest.mock('@brand/capabilities', () => {
  const actual = jest.requireActual('@brand/capabilities');
  return {
    ...actual,
    isFullBudget: () => mockFullBudget,
  };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
}));

const mockOpenURL = jest.fn((_url: string) => Promise.resolve(true));
jest.mock('expo-linking', () => ({
  __esModule: true,
  createURL: (path: string, opts?: { queryParams?: Record<string, string> }) => {
    const query = new URLSearchParams(opts?.queryParams ?? {}).toString();
    return `symplybudget://${path}${query ? `?${query}` : ''}`;
  },
  openURL: (url: string) => mockOpenURL(url),
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(View, null, children ?? null);
  return {
    __esModule: true,
    AppBackground: Passthrough,
    ScreenHeader: () => null,
    ScreenScrollEnd: () => null,
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    // A PARTIAL mock of a barrel breaks the moment the screen imports one more
    // thing from it: the missing name arrives as `undefined` and React reports
    // "Element type is invalid ... got: undefined" against SettingsScreen,
    // which reads as a fault in the screen rather than in this factory. These
    // two were added to the screen's import list and never here, taking all six
    // INSIGHTS cases down at once. Anything SettingsScreen pulls from
    // @components/common has to be listed, even when these tests never look at
    // it — rendering is what breaks, not the assertion.
    AppVersionFooter: () => null,
    SettingsGearButton: () => null,
  };
});

jest.mock('@components/layout', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AdaptiveContainer: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
  };
});

// The overflow-tab list is its own component with its own suite; this one is
// about the group beneath it.
jest.mock('@components/navigation/TabOverflowSection', () => ({
  __esModule: true,
  TabOverflowSection: () => null,
}));

jest.mock('@components/aihousekeeper', () => ({
  __esModule: true,
  PersonaAvatar: () => null,
}));

jest.mock('@components/ai/useAIAccessEntry', () => ({
  __esModule: true,
  useAIAccessEntry: () => ({ show: false }),
}));

jest.mock('@api/households', () => ({
  __esModule: true,
  householdsApi: { update: jest.fn() },
}));

jest.mock('@contexts/DataContext', () => ({
  __esModule: true,
  useData: () => ({ refreshActivePropertyData: jest.fn() }),
}));

jest.mock('@features/house/local/backup/useHouseBackupSummaryLine', () => ({
  __esModule: true,
  useHouseBackupSummaryLine: () => ({ line: '', needsAttention: false }),
}));

jest.mock('@features/house/local/flag', () => ({
  __esModule: true,
  isHouseLocalFirst: () => false,
}));

jest.mock('@hooks/useAihousekeeperPersona', () => ({
  __esModule: true,
  useAihousekeeperPersona: () => ({ persona: 'mira', name: 'Mira' }),
}));

jest.mock('@hooks/useBiometricQuickSignIn', () => ({
  __esModule: true,
  useBiometricQuickSignIn: () => ({ available: false }),
}));

jest.mock('@hooks/useDeviceType', () => ({
  __esModule: true,
  useDeviceType: () => ({ isTablet: false }),
}));

jest.mock('@hooks/useLayoutPadding', () => ({
  __esModule: true,
  useLayoutPadding: () => ({ content: 16 }),
}));

jest.mock('@services/settings-sync', () => ({
  __esModule: true,
  settingsSync: { queueSync: jest.fn() },
}));

jest.mock('@stores/appStore', () => ({
  __esModule: true,
  useAppStore: (sel?: (s: unknown) => unknown) => {
    const s = { currency: 'CAD', taxCountry: 'CA', taxRegion: 'BC', accentScheme: 'classic' };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/householdStore', () => ({
  __esModule: true,
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      currentHousehold: { id: 'hh-1', name: 'Home', unit_system: 'metric' },
      households: [{ id: 'hh-1' }],
      propertyMode: 'single',
      setPropertyMode: jest.fn(),
      updateHousehold: jest.fn(),
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/settingsStore', () => ({
  __esModule: true,
  useSettingsStore: Object.assign(
    (sel?: (s: unknown) => unknown) => {
      const s = { settings: { 'garden.measurementUnit': 'meters' }, setSetting: jest.fn() };
      return typeof sel === 'function' ? sel(s) : s;
    },
    {
      getState: () => ({
        settings: { 'garden.measurementUnit': 'meters' },
        setSetting: jest.fn(),
      }),
    },
  ),
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { SettingsScreen } from '../SettingsScreen';

const ROWS = {
  'settings-row-budget-timeline': 'BudgetLongTermTimeline',
  'settings-row-budget-year-history': 'SavingsYearHistory',
  'settings-row-budget-compare-years': 'SavingsCompareYears',
} as const;

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- nav/route props unused by this group */}
        <SettingsScreen navigation={{ navigate: jest.fn() } as any} route={{} as any} />
      </ThemeProvider>,
    );
  });
  return tree;
}

const row = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0];

const paramOf = (call: number, key: string): string | null =>
  new URL(mockOpenURL.mock.calls[call][0]).searchParams.get(key);

beforeEach(() => {
  jest.clearAllMocks();
  mockFullBudget = true;
});

describe('SettingsScreen — INSIGHTS', () => {
  it('MORE-INSIGHTS-001: full Budget renders the group with all three rows', async () => {
    const tree = await render();
    expect(row(tree, 'settings-section-insights')).toBeTruthy();
    for (const id of Object.keys(ROWS)) {
      expect(row(tree, id)).toBeTruthy();
    }
  });

  it.each(Object.entries(ROWS))(
    'MORE-INSIGHTS-002: %s opens %s through the Linking door',
    async (id, screen) => {
      const tree = await render();
      act(() => row(tree, id).props.onPress());

      expect(mockOpenURL).toHaveBeenCalledTimes(1);
      expect(new URL(mockOpenURL.mock.calls[0][0]).pathname).toBe('/');
      expect(paramOf(0, 'screen')).toBe(screen);
      expect(paramOf(0, 'navNonce')).toEqual(expect.any(String));
      // `router.push` silently drops `screen` on an already-mounted tab.
      expect(mockPush).not.toHaveBeenCalled();
    },
  );

  it('MORE-INSIGHTS-003: a second visit sends a fresh nonce so the stack dedupe does not swallow it', async () => {
    const tree = await render();
    act(() => row(tree, 'settings-row-budget-timeline').props.onPress());
    const first = paramOf(0, 'navNonce')!;

    jest.spyOn(Date, 'now').mockReturnValue(Number(first) + 1000);
    act(() => row(tree, 'settings-row-budget-timeline').props.onPress());

    expect(paramOf(1, 'navNonce')).not.toBe(first);
    jest.restoreAllMocks();
  });

  it('MORE-INSIGHTS-004: no other brand shows these ROWS — the screens are not on their stack', async () => {
    mockFullBudget = false;
    const tree = await render();

    // The ROWS are the invariant, and the reason for it: these three screens
    // are registered on the BUDGET stack, so a row leaking into another brand
    // is a door to somewhere that brand cannot go.
    for (const id of Object.keys(ROWS)) {
      expect(row(tree, id)).toBeUndefined();
    }

    // The SECTION is deliberately NOT asserted absent any more.
    //
    // It used to be, and that made this file and
    // SettingsScreen.houseMoreHub.test.tsx flatly contradict each other:
    // `settings-section-insights` was reused for House's own INSIGHTS group
    // (its AI Insights Dashboard row), and houseMoreHub asserts that group IS
    // present. Both cannot hold. House won silently, which is how Budget's
    // three rows came to be deleted and three built, registered screens left
    // reachable from nowhere — `BudgetLongTermTimeline` and
    // `SavingsYearHistory` had no caller at all.
    //
    // So the id now names a group two brands fill for their own reasons, each
    // behind its own gate, and this file asserts the half it owns.
  });
});
