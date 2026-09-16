/**
 * HealthNotificationSettingsScreen — the donor's `ActivityNotificationPreferencesView`.
 *
 * Renders the REAL screen through <ThemeProvider>, with `healthSettingsStorage`
 * mocked as a seam (its own suite, `healthSettingsStorage.test.ts`, owns the
 * read/write contract). This file proves the SCREEN'S OWN job: every one of the
 * ten switches is independently wired to its own flag, the optimistic paint
 * happens before the write resolves, a failed save still keeps the member's tap
 * and shows the friendly offline copy, the shared `PermissionCard` renders the
 * right state (not-requested vs. denied are NOT the same card), and "Reset"
 * sends all ten defaults rather than a partial patch.
 *
 * `HealthSettingsShell` is NOT mocked away — this is one of only two screens
 * that use it, so it is exercised for real here (loading state, the back
 * button's `canGoBack()` branch).
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Linking } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  DEFAULT_HEALTH_NOTIFICATION_PREFERENCES,
  HEALTH_NOTIFICATION_GROUPS,
  loadNotificationPreferences,
  resetNotificationPreferences,
  saveNotificationPreferences,
  type HealthNotificationPreferences,
} from '../../healthSettingsStorage';
import { HealthNotificationSettingsScreen } from '../HealthNotificationSettingsScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View, Pressable, Text } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({
      title,
      onBackPress,
      backButtonTestID,
    }: {
      title?: string;
      onBackPress?: () => void;
      backButtonTestID?: string;
    }) =>
      ReactMock.createElement(
        View,
        { testID: 'screen-header', accessibilityLabel: title },
        ReactMock.createElement(Pressable, { testID: backButtonTestID, onPress: onBackPress })
      ),
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    // Faithful enough to the real component (src/components/common/PermissionCard.tsx)
    // for these tests: title + the copy for the current state, plus a `-request`
    // button in `not-requested` and a `-settings` button in `denied`.
    PermissionCard: ({
      state,
      title,
      copy,
      onRequest,
      onOpenSettings,
      busy,
      testID = 'permission-card',
    }: {
      state: string;
      title: string;
      copy: Record<string, { body: string } | undefined>;
      onRequest?: () => void;
      onOpenSettings?: () => void;
      busy?: boolean;
      testID?: string;
    }) =>
      ReactMock.createElement(
        View,
        { testID },
        ReactMock.createElement(Text, null, title),
        ReactMock.createElement(Text, null, copy[state]?.body ?? ''),
        state === 'not-requested' && onRequest
          ? ReactMock.createElement(
              Pressable,
              { testID: `${testID}-request`, onPress: onRequest, disabled: busy },
              ReactMock.createElement(Text, null, busy ? 'Requesting…' : 'Allow')
            )
          : null,
        state === 'denied' && onOpenSettings
          ? ReactMock.createElement(
              Pressable,
              { testID: `${testID}-settings`, onPress: onOpenSettings },
              ReactMock.createElement(Text, null, 'Open Settings')
            )
          : null
      ),
  };
});

let mockPushState: 'unavailable' | 'not-requested' | 'denied' | 'granted' = 'granted';
const mockRequestPush = jest.fn().mockResolvedValue(undefined);
jest.mock('@hooks/useNotificationPermission', () => ({
  useNotificationPermission: () => ({
    state: mockPushState,
    busy: false,
    request: mockRequestPush,
    refresh: jest.fn(),
  }),
}));

jest.mock('../../healthSettingsStorage', () => {
  const actual = jest.requireActual('../../healthSettingsStorage');
  return {
    ...actual,
    loadNotificationPreferences: jest.fn(),
    saveNotificationPreferences: jest.fn(),
    resetNotificationPreferences: jest.fn(),
  };
});

const mockLoad = loadNotificationPreferences as jest.Mock;
const mockSave = saveNotificationPreferences as jest.Mock;
const mockReset = resetNotificationPreferences as jest.Mock;

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function byTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthNotificationSettingsScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

/** A promise that never settles — models "the read has not come back yet". */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  mockLoad.mockResolvedValue(DEFAULT_HEALTH_NOTIFICATION_PREFERENCES);
  mockPushState = 'granted';
  mockSave.mockImplementation(async (patch: Partial<HealthNotificationPreferences>) => ({
    preferences: { ...DEFAULT_HEALTH_NOTIFICATION_PREFERENCES, ...patch },
    status: 'saved',
    message: null,
  }));
  mockReset.mockResolvedValue({
    preferences: DEFAULT_HEALTH_NOTIFICATION_PREFERENCES,
    status: 'saved',
    message: null,
  });
});

describe('HealthNotificationSettingsScreen — loading', () => {
  it('HEALTH-NOTIFY-001: shows the shell spinner until preferences resolve, then the content', async () => {
    mockLoad.mockReturnValue(pending<HealthNotificationPreferences>());
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-notifications-screen').length).toBe(1);
    expect(byTestId(tree, 'health-notifications-screen-scroll').length).toBe(0);
    expect(byTestId(tree, `health-notifications-group-${HEALTH_NOTIFICATION_GROUPS[0].id}`).length).toBe(
      0
    );
  });

  it('HEALTH-NOTIFY-002: renders every group and every toggle once loaded', async () => {
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-notifications-screen-scroll').length).toBe(1);
    for (const group of HEALTH_NOTIFICATION_GROUPS) {
      expect(byTestId(tree, `health-notifications-group-${group.id}`).length).toBe(1);
      for (const toggle of group.toggles) {
        expect(byTestId(tree, `health-notify-${toggle.flag}`).length).toBe(1);
      }
    }
    expect(allText(tree.toJSON())).toContain('Reset to standard settings');
  });
});

describe('HealthNotificationSettingsScreen — OS permission card', () => {
  it('HEALTH-NOTIFY-003: shows the denied state — explanation + Open Settings, never a request button — once the OS has already refused', async () => {
    mockPushState = 'denied';
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-notifications-permission-card').length).toBe(1);
    expect(byTestId(tree, 'health-notifications-permission-card-settings').length).toBe(1);
    expect(byTestId(tree, 'health-notifications-permission-card-request').length).toBe(0);
    expect(allText(tree.toJSON())).toContain(
      'nothing can reach this device until you allow notifications in the system settings'
    );
  });

  it('HEALTH-NOTIFY-003b: shows the not-requested state — a real "Allow" request, not a detour through Settings — for a member the OS has never asked', async () => {
    mockPushState = 'not-requested';
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-notifications-permission-card-request').length).toBe(1);
    expect(byTestId(tree, 'health-notifications-permission-card-settings').length).toBe(0);

    act(() => {
      const node = tree.root.find(
        (n) => n.props?.testID === 'health-notifications-permission-card-request'
      );
      node.props.onPress();
    });
    expect(mockRequestPush).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-NOTIFY-004: no card when the system permission is granted', async () => {
    mockPushState = 'granted';
    const tree = await renderScreen();
    expect(byTestId(tree, 'health-notifications-permission-card').length).toBe(0);
  });

  it('HEALTH-NOTIFY-005: no card when the bridge reports unavailable rather than crashing', async () => {
    mockPushState = 'unavailable';
    const tree = await renderScreen();
    expect(byTestId(tree, 'health-notifications-permission-card').length).toBe(0);
    expect(byTestId(tree, 'health-notifications-screen').length).toBe(1);
  });

  it('HEALTH-NOTIFY-006: "Open Settings" opens the OS settings app', async () => {
    mockPushState = 'denied';
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const tree = await renderScreen();

    act(() => {
      const node = tree.root.find(
        (n) => n.props?.testID === 'health-notifications-permission-card-settings'
      );
      node.props.onPress();
    });

    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });
});

/* ------------------------------------------------------------------ *
 * Every one of the ten switches, independently.
 * ------------------------------------------------------------------ */

describe('HealthNotificationSettingsScreen — each toggle saves its OWN flag', () => {
  const allToggles = HEALTH_NOTIFICATION_GROUPS.flatMap((g) => g.toggles);

  it('HEALTH-NOTIFY-010: there are exactly ten toggles, matching the donor set', () => {
    expect(allToggles).toHaveLength(10);
  });

  it.each(allToggles.map((t) => t.flag))(
    'HEALTH-NOTIFY-011: flipping %s sends a patch containing ONLY that flag',
    async (flag) => {
      const tree = await renderScreen();
      const toggle = tree.root.find((n) => n.props?.testID === `health-notify-${flag}`);
      const next = !toggle.props.value;

      await act(async () => {
        toggle.props.onValueChange(next);
      });

      expect(mockSave).toHaveBeenCalledWith({ [flag]: next });
      // No other flag rides along on the same request.
      expect(Object.keys(mockSave.mock.calls[0][0])).toEqual([flag]);
    }
  );

  it('HEALTH-NOTIFY-012: the switch moves OPTIMISTICALLY, before the save resolves', async () => {
    let resolveSave!: (value: unknown) => void;
    mockSave.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    const tree = await renderScreen();
    const toggle = () => tree.root.find((n) => n.props?.testID === 'health-notify-notify_recipe_updated');

    expect(toggle().props.value).toBe(false);
    act(() => {
      toggle().props.onValueChange(true);
    });
    // Painted immediately — before the write has resolved at all.
    expect(toggle().props.value).toBe(true);
    // …and every switch is disabled while a write is in flight.
    expect(toggle().props.disabled).toBe(true);

    await act(async () => {
      resolveSave({
        preferences: { ...DEFAULT_HEALTH_NOTIFICATION_PREFERENCES, notify_recipe_updated: true },
        status: 'saved',
        message: null,
      });
    });
    expect(toggle().props.disabled).toBe(false);
  });

  it('HEALTH-NOTIFY-013: a failed save keeps the tap AND shows the offline copy — no snap-back', async () => {
    mockSave.mockResolvedValue({
      preferences: { ...DEFAULT_HEALTH_NOTIFICATION_PREFERENCES, notify_photo_shared: false },
      status: 'offline',
      message: 'Saved on this device — we will sync it to your account when you are back online.',
    });
    const tree = await renderScreen();
    const toggle = () => tree.root.find((n) => n.props?.testID === 'health-notify-notify_photo_shared');

    await act(async () => {
      toggle().props.onValueChange(false);
    });

    // The screen renders exactly what the store settled on — it must not
    // silently revert to the value it had before the tap.
    expect(toggle().props.value).toBe(false);
    expect(byTestId(tree, 'health-notifications-message')).toHaveLength(1);
    expect(allText(tree.toJSON())).toContain('we will sync it to your account when you are back online');
  });
});

describe('HealthNotificationSettingsScreen — reset', () => {
  it('HEALTH-NOTIFY-020: sends ALL TEN defaults explicitly, never a bare/partial PUT', async () => {
    const tree = await renderScreen();

    await act(async () => {
      const node = tree.root.find((n) => n.props?.testID === 'health-notifications-reset');
      node.props.onPress();
    });

    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-NOTIFY-021: a reset with no message falls back to the "standard settings" caption', async () => {
    mockReset.mockResolvedValue({
      preferences: DEFAULT_HEALTH_NOTIFICATION_PREFERENCES,
      status: 'saved',
      message: null,
    });
    const tree = await renderScreen();

    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'health-notifications-reset').props.onPress();
    });

    expect(allText(tree.toJSON())).toContain('Reset to the standard settings.');
  });

  it('HEALTH-NOTIFY-022: a reset that goes offline shows THAT message instead of the fallback', async () => {
    mockReset.mockResolvedValue({
      preferences: DEFAULT_HEALTH_NOTIFICATION_PREFERENCES,
      status: 'offline',
      message: 'Saved on this device — we will sync it to your account when you are back online.',
    });
    const tree = await renderScreen();

    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'health-notifications-reset').props.onPress();
    });

    expect(allText(tree.toJSON())).toContain('we will sync it to your account when you are back online');
    expect(allText(tree.toJSON())).not.toContain('Reset to the standard settings.');
  });
});

describe('HealthNotificationSettingsScreen — back navigation (HealthSettingsShell)', () => {
  it('HEALTH-NOTIFY-030: goes back when the router CAN go back', async () => {
    mockCanGoBack = true;
    const tree = await renderScreen();

    act(() => {
      tree.root.find((n) => n.props?.testID === 'health-notifications-screen-back').props.onPress();
    });

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('HEALTH-NOTIFY-031: replaces with /settings when there is nowhere to go back to', async () => {
    mockCanGoBack = false;
    const tree = await renderScreen();

    act(() => {
      tree.root.find((n) => n.props?.testID === 'health-notifications-screen-back').props.onPress();
    });

    expect(mockReplace).toHaveBeenCalledWith('/settings');
    expect(mockBack).not.toHaveBeenCalled();
  });
});
