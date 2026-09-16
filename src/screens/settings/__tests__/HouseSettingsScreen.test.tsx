/**
 * HouseSettingsScreen — the hub behind House's header gear.
 *
 * This screen is a MOVE, so the case that matters is not "does it render" but
 * "did everything arrive". A settings screen that quietly lost a row on the way
 * over does not fail anywhere: the More tab no longer shows it either, so the
 * setting simply stops existing and nothing turns red. The inventory below is
 * that guard, and it is the mirror image of `SettingsScreen.houseMoreHub`'s
 * "these are gone from More" list — a row must be on exactly one of the two.
 *
 * The other case is BACK. `/house-settings` mounts this navigator with
 * `HouseSettings` as its initial route, so there is nothing beneath it to pop
 * and `goBack()` is a silent no-op — the member taps a live-looking chevron and
 * stays put. The route above the tabs is what has to be popped.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn(), navigate: jest.fn() }),
}));

let capturedHeaderProps: Record<string, unknown> = {};
jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(View, null, children ?? null);
  return {
    __esModule: true,
    AppBackground: Passthrough,
    ScreenHeader: (props: Record<string, unknown>) => {
      capturedHeaderProps = props;
      return null;
    },
    ScreenScrollEnd: () => null,
    // Version/env footer — covered by its own suite (AppVersionFooter.test.tsx);
    // stubbed here so this one keeps asserting the ROWS.
    AppVersionFooter: () => null,
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
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

jest.mock('@components/aihousekeeper', () => ({
  __esModule: true,
  PersonaAvatar: () => null,
}));

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

jest.mock('@contexts/DataContext', () => ({
  __esModule: true,
  useData: () => ({ refreshActivePropertyData: jest.fn() }),
}));

jest.mock('@hooks/useAihousekeeperPersona', () => ({
  __esModule: true,
  useAihousekeeperPersona: () => ({ persona: 'mira', name: 'Mira' }),
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

let mockHouseholds = [{ id: 'hh-1' }];
jest.mock('@stores/householdStore', () => ({
  __esModule: true,
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      currentHousehold: { id: 'hh-1', name: 'Home', unit_system: 'metric' },
      get households() {
        return mockHouseholds;
      },
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

import { HouseSettingsScreen } from '../HouseSettingsScreen';

/**
 * Row id → the stack route it must push. Every one of these was on the More tab
 * before the gear existed; none of them may be on both.
 */
const ROWS = {
  'settings-row-floor-plans': 'FloorPlansMain',
  'settings-row-appearance': 'Appearance',
  'settings-row-currency': 'Currency',
  'settings-row-region': 'Region',
  'settings-row-ai-housekeeper-settings': 'AIHousekeeperSettings',
  'settings-row-persona-settings': 'AihousekeeperSettings',
  'settings-row-notification-settings': 'NotificationSettings',
  'settings-row-calendar-sync': 'CalendarSync',
  'settings-row-connect-budget': 'SoftTransferConnect',
  'settings-row-data-sharing': 'DataSharing',
} as const;

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockCanGoBack = jest.fn(() => false);

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HouseSettingsScreen
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- only three methods are used
          navigation={{ navigate: mockNavigate, goBack: mockGoBack, canGoBack: mockCanGoBack } as any}
          route={{} as any} // eslint-disable-line @typescript-eslint/no-explicit-any
        />
      </ThemeProvider>,
    );
  });
  return tree;
}

const row = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack.mockReturnValue(false);
  mockHouseholds = [{ id: 'hh-1' }];
});

describe('HouseSettingsScreen', () => {
  it('HOUSE-SETTINGS-001: renders every group that moved off the More tab', async () => {
    const tree = await render();

    expect(row(tree, 'house-settings-screen')).toBeTruthy();
    expect(row(tree, 'house-settings-section-home')).toBeTruthy();
    expect(row(tree, 'house-settings-section-preferences')).toBeTruthy();
    expect(row(tree, 'house-settings-section-ai')).toBeTruthy();
    for (const id of Object.keys(ROWS)) {
      expect(row(tree, id)).toBeTruthy();
    }
    // The two unit controls and the apps grid have no section id of their own.
    expect(row(tree, 'settings-row-area-units')).toBeTruthy();
    expect(row(tree, 'settings-row-symply-apps')).toBeTruthy();
    expect(row(tree, 'settings-row-ai-providers')).toBeTruthy();
  });

  it.each(Object.entries(ROWS))('HOUSE-SETTINGS-002: %s pushes %s', async (id, screen) => {
    const tree = await render();
    act(() => row(tree, id).props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith(screen);
  });

  it('HOUSE-SETTINGS-003: the AI-access row uses the shared entry, not a House route', async () => {
    const tree = await render();
    act(() => row(tree, 'settings-row-ai-providers').props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/ai-access');
  });

  it('HOUSE-SETTINGS-004: back pops the root route when this is the bottom of its stack', async () => {
    await render();
    act(() => (capturedHeaderProps.onBackPress as () => void)());

    // `goBack()` here is a no-op — `/house-settings` mounts this screen as the
    // initial route — so the chevron has to pop the route above the tabs.
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('HOUSE-SETTINGS-005: back defers to the stack when it was pushed onto one', async () => {
    mockCanGoBack.mockReturnValue(true);
    await render();
    act(() => (capturedHeaderProps.onBackPress as () => void)());

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('HOUSE-SETTINGS-006: MULTI-PROPERTY appears only with more than one property', async () => {
    let tree = await render();
    expect(tree.root.findAll((n) => n.props?.children === 'MULTI-PROPERTY')).toHaveLength(0);

    mockHouseholds = [{ id: 'hh-1' }, { id: 'hh-2' }];
    tree = await render();
    expect(tree.root.findAll((n) => n.props?.children === 'MULTI-PROPERTY').length).toBeGreaterThan(0);
  });
});
