/**
 * SettingsScreen — Symply Kaizen (`symply-kaizen`) app settings.
 *
 * App-level controls only (appearance, sync, notifications, systems entry,
 * AI). No daily activity / check-in recording — that lives on Today per system.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Switch } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  IPAD,
  IPHONE,
  allText,
  instanceText,
  pressablesWithText,
  pressByText,
} from '../../test-utils/kaizenScreenTestKit';
import { SettingsScreen } from '../SettingsScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    back: jest.fn(),
    navigate: jest.fn(),
  },
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

const sync = jest.fn().mockResolvedValue(undefined);
const scheduleDailyReminders = jest.fn().mockResolvedValue(undefined);
const setAIDisclosureAck = jest.fn();

const mockKaizenState: Record<string, unknown> = {
  profile: { onboarding_complete: true, enabled_systems: JSON.stringify(['career']), timezone: 'UTC' },
  isSyncing: false,
  sync,
  scheduleDailyReminders,
  hasAIDisclosureAck: () => false,
  setAIDisclosureAck,
  resetOnboarding: jest.fn().mockResolvedValue(undefined),
};
jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const useKaizenStore = (selector?: (s: typeof mockKaizenState) => unknown) =>
    selector ? selector(mockKaizenState) : mockKaizenState;
  useKaizenStore.getState = () => mockKaizenState;
  return { __esModule: true, useKaizenStore };
});

const mockAuthState: Record<string, unknown> = {
  logout: jest.fn(),
  user: { id: 'u1', email: 'user@example.com' },
  refreshToken: 'rt',
  biometricEnabled: false,
  setBiometricEnabled: jest.fn(),
};
jest.mock('@stores/authStore', () => ({
  __esModule: true,
  useAuthStore: (selector?: (s: typeof mockAuthState) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState,
}));

jest.mock('@services/biometric', () => ({
  biometricService: {
    isAvailable: jest.fn(async () => false),
    getBiometricTypeName: jest.fn(async () => 'Face ID'),
    enableBiometric: jest.fn(async () => true),
    disableBiometric: jest.fn(async () => undefined),
  },
}));

const initialize = jest.fn().mockResolvedValue(undefined);
const mockNotifState: Record<string, unknown> = { initialize, permissionGranted: false };
jest.mock('@features/kaizen/stores/notificationStore', () => ({
  __esModule: true,
  useNotificationStore: (selector?: (s: typeof mockNotifState) => unknown) =>
    selector ? selector(mockNotifState) : mockNotifState,
}));

const mockRequestPush = jest.fn().mockResolvedValue(undefined);
const mockRefreshPush = jest.fn().mockResolvedValue(undefined);
let mockPushState: 'unavailable' | 'not-requested' | 'denied' | 'granted' = 'not-requested';
jest.mock('@hooks/useNotificationPermission', () => ({
  __esModule: true,
  useNotificationPermission: () => ({
    state: mockPushState,
    busy: false,
    request: mockRequestPush,
    refresh: mockRefreshPush,
  }),
}));

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SettingsScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  mockKaizenState.profile = {
    onboarding_complete: true,
    enabled_systems: JSON.stringify(['career']),
    timezone: 'UTC',
  };
  mockKaizenState.isSyncing = false;
  mockKaizenState.hasAIDisclosureAck = () => false;
  mockNotifState.permissionGranted = false;
  mockPushState = 'not-requested';
});

describe('SettingsScreen', () => {
  it('renders every settings section', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Settings');
    expect(text).toContain('APPEARANCE');
    expect(text).toContain('Enabled systems');
    expect(text).toContain('Sync Kaizen');
    expect(text).toContain('Manage systems');
    expect(text).toContain('AI disclosure');
    expect(text).toContain('Manage memory');
  });

  it('does not record daily system activity in Settings', async () => {
    for (const systems of [['career'], ['career', 'health'], ['health']]) {
      mockKaizenState.profile = {
        onboarding_complete: true,
        enabled_systems: JSON.stringify(systems),
        timezone: 'UTC',
      };
      const tree = await renderScreen();
      const text = allText(tree.toJSON());
      expect(text).not.toContain('Health check-ins');
      expect(text).not.toContain('Today health logs');
      expect(text).not.toContain('Weight logged');
      expect(text).not.toContain('Nutrition logged');
      expect(text).not.toContain('Desk hero');
    }
  });

  it('runs a sync from the "Sync Kaizen" button', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Sync Kaizen');
    });
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('navigates to coach memory from the "Manage memory" row', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Manage memory'));
    expect(mockPush).toHaveBeenCalledWith('/kaizen/memory');
  });

  it('requests notification permission and schedules daily reminders', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Allow');
    });
    expect(mockRequestPush).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(scheduleDailyReminders).toHaveBeenCalledTimes(1);
    expect(mockRefreshPush).toHaveBeenCalledTimes(1);
  });

  it('hides the permission card once notifications are granted', async () => {
    mockPushState = 'granted';
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).not.toContain('Notifications');
  });

  it('offers Open Settings, not a request button, once denied', async () => {
    mockPushState = 'denied';
    const tree = await renderScreen();
    expect(
      pressablesWithText(tree, 'Allow').some((n) => instanceText(n) === 'Allow'),
    ).toBe(false);
    await act(async () => {
      pressByText(tree, 'Open Settings');
    });
    expect(mockRequestPush).not.toHaveBeenCalled();
  });

  it('navigates to the systems hub from "Manage systems"', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Manage systems'));
    expect(mockPush).toHaveBeenCalledWith('/kaizen-systems');
  });

  it('navigates to the notification inbox', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Notification inbox'));
    expect(mockPush).toHaveBeenCalledWith('/kaizen/notifications');
  });

  it('toggles the AI disclosure switch', async () => {
    const tree = await renderScreen();
    const switches = tree.root.findAllByType(Switch);
    act(() => {
      switches[0].props.onValueChange(true);
    });
    expect(setAIDisclosureAck).toHaveBeenCalledWith(true);
  });

  it('reflects a pre-acknowledged AI disclosure', async () => {
    mockKaizenState.hasAIDisclosureAck = () => true;
    const tree = await renderScreen();
    const switches = tree.root.findAllByType(Switch);
    expect(switches[0].props.value).toBe(true);
  });

  it('re-runs onboarding and logs out from the footer buttons', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Re-run onboarding');
    });
    expect(mockKaizenState.resetOnboarding).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/kaizen/onboarding');
    await act(async () => {
      pressByText(tree, 'Log out');
    });
    expect(mockAuthState.logout).toHaveBeenCalledTimes(1);
  });

  it('shows fallbacks for a missing profile', async () => {
    mockKaizenState.profile = null;
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Not started');
    expect(text).toContain('Automatic');
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('APPEARANCE');
  });
});
