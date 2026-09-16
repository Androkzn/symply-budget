/**
 * SettingsScreen (the "More" tab) — House's hub is the OVERFLOW hub now.
 *
 * House used to reach every setting it has through a tab called "More", which
 * made one tab name mean two unrelated things and put every preference a tab
 * switch, a scroll and two taps from wherever the member was. The settings moved
 * behind a header gear on every tab (`/house-settings`) and the account rows
 * moved to Profile; what is left here is what the tab is actually for.
 *
 * Three things are worth guarding, and the first two are the ones a refactor
 * silently breaks:
 *
 *  1. What REMAINS. MORE TABS, CUSTOMIZATION (the tab editor plus House's own
 *     Customization screen — the other half of "change what this app shows me")
 *     and INSIGHTS (the AI Insights Dashboard, which configures nothing).
 *  2. What is GONE. Every moved row must be absent, not merely further down: a
 *     row left behind here is a second door to a screen that now has one, and
 *     that is exactly the split this change deleted.
 *  3. That the reduction is HOUSE-ONLY. Any brand still running the old shape
 *     must keep its full list, or the move silently strips a settings screen
 *     from an app that has nowhere else to show it.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

/*
 * The Jest brand IS House, so the reduced hub is the default and only the
 * "other brand" case needs a mock.
 *
 * `isHouseBrand` lives on the `@brand` barrel itself (not `@brand/capabilities`,
 * where `isFullBudget` lives), so the barrel is what has to be mocked — and a
 * Proxy rather than `{...actual}`, because spreading it READS every lazy getter
 * while `brand/capabilities` is still mid-require in the module cycle and throws
 * before a single test runs. See ProfileScreen.settingsGear.test.tsx.
 */
let mockHouseBrand = true;
jest.mock('@brand', () => {
  const actual = jest.requireActual('@brand');
  return new Proxy(actual, {
    get: (target, prop, receiver) =>
      prop === 'isHouseBrand' ? () => mockHouseBrand : Reflect.get(target, prop, receiver),
  });
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
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
    SettingsGearButton: () => null,
    // Version/env footer — covered by its own suite (AppVersionFooter.test.tsx).
    AppVersionFooter: () => null,
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

/*
 * Stubbed, but NOT to null: House hands its Customization row to this component
 * as `extraCustomizationRows` so the two live under one header. A stub that
 * dropped its props would make this suite pass while that row rendered nowhere.
 * The overflow list itself has its own suite.
 */
jest.mock('@components/navigation/TabOverflowSection', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    TabOverflowSection: ({ extraCustomizationRows }: { extraCustomizationRows?: React.ReactNode }) =>
      React.createElement(View, { testID: 'tab-overflow-section' }, extraCustomizationRows ?? null),
  };
});

jest.mock('@components/ai/useAIAccessEntry', () => ({
  __esModule: true,
  useAIAccessEntry: () => ({
    show: true,
    route: '/ai-access',
    title: 'AI assistance',
    subtitle: 'Connect OpenAI, Claude, or Gemini',
    icon: 'sparkles-outline',
  }),
}));

jest.mock('@api/households', () => ({
  __esModule: true,
  householdsApi: { update: jest.fn() },
}));

jest.mock('@hooks/useDeviceType', () => ({
  __esModule: true,
  useDeviceType: () => ({ isTablet: false }),
}));

jest.mock('@hooks/useLayoutPadding', () => ({
  __esModule: true,
  useLayoutPadding: () => ({ content: 16 }),
}));

jest.mock('@services/biometric', () => ({
  __esModule: true,
  biometricService: {
    isAvailable: () => Promise.resolve(false),
    getBiometricTypeName: () => Promise.resolve('Face ID'),
  },
}));

jest.mock('@stores/appStore', () => ({
  __esModule: true,
  useAppStore: (sel?: (s: unknown) => unknown) => {
    const s = { currency: 'CAD', taxCountry: 'CA', taxRegion: 'BC', accentScheme: 'classic' };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/authStore', () => ({
  __esModule: true,
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      user: { email: 'a@example.com' },
      refreshToken: 'r',
      logout: jest.fn(),
      biometricEnabled: false,
      setBiometricEnabled: jest.fn(),
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/householdStore', () => ({
  __esModule: true,
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-1', name: 'Home', unit_system: 'metric' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { SettingsScreen } from '../SettingsScreen';

/** Rows that MOVED — every one of them must be gone from House's More tab. */
const MOVED_ROWS = [
  // → the settings hub behind the gear
  'settings-row-floor-plans',
  'settings-row-appearance',
  'settings-row-currency',
  'settings-row-region',
  'settings-row-area-units',
  'settings-row-notification-settings',
  'settings-row-calendar-sync',
  'settings-row-ai-housekeeper-settings',
  'settings-row-persona-settings',
  'settings-row-ai-providers',
  'settings-row-connect-budget',
  'settings-row-data-sharing',
  'settings-row-symply-apps',
  // → Profile
  'settings-row-household-members',
  'settings-row-biometric',
] as const;

const mockNavigate = jest.fn();

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- only `navigate` is used */}
        <SettingsScreen navigation={{ navigate: mockNavigate } as any} route={{} as any} />
      </ThemeProvider>,
    );
  });
  return tree;
}

const row = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockHouseBrand = true;
});

describe('SettingsScreen — House More hub', () => {
  it('MORE-HOUSE-001: keeps the overflow tabs, Customization and Insights', async () => {
    const tree = await render();

    expect(row(tree, 'tab-overflow-section')).toBeTruthy();
    // Handed to TabOverflowSection, so it renders under the CUSTOMIZATION header
    // rather than in a group of its own below the tab list.
    expect(row(tree, 'settings-row-customization')).toBeTruthy();
    expect(row(tree, 'settings-section-insights')).toBeTruthy();
    expect(row(tree, 'settings-row-ai-insights')).toBeTruthy();
  });

  it('MORE-HOUSE-002: Customization and Insights reach their screens on this stack', async () => {
    const tree = await render();

    act(() => row(tree, 'settings-row-customization').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Customization');

    act(() => row(tree, 'settings-row-ai-insights').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('AIInsightsDashboard');
  });

  it.each(MOVED_ROWS)('MORE-HOUSE-003: %s is gone from the More tab', async (id) => {
    const tree = await render();
    expect(row(tree, id)).toBeUndefined();
  });

  it('MORE-HOUSE-004: a brand that did not move keeps its full settings list', async () => {
    mockHouseBrand = false;
    const tree = await render();

    // The shared rows every brand still shows on More.
    expect(row(tree, 'settings-row-household-members')).toBeTruthy();
    expect(row(tree, 'settings-row-appearance')).toBeTruthy();
    expect(row(tree, 'settings-row-currency')).toBeTruthy();
    expect(row(tree, 'settings-row-notification-settings')).toBeTruthy();
    expect(row(tree, 'settings-row-symply-apps')).toBeTruthy();
    // …and none of House's own groups.
    expect(row(tree, 'settings-section-insights')).toBeUndefined();
    expect(row(tree, 'settings-row-customization')).toBeUndefined();
  });
});
