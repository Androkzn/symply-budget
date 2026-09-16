/**
 * NotificationSettingsScreen — Settings ("More" tab) push/email/notification
 * preference controls.
 *
 * The screen loads preferences from the notification store on mount (showing a
 * spinner until they resolve), then renders five sections of on/off toggles.
 * Every toggle writes back through `updatePreferences`, and every task/home/
 * report/other toggle is gated off while Push Notifications is disabled.
 *
 * Coverage:
 *  - Renders the header, the five sections, their rows and the footer note on
 *    iPhone AND iPad (it.each over ALL_DEVICES).
 *  - Each toggle fires `updatePreferences({ <key>: value })`.
 *  - Corner cases: the loading spinner before preferences resolve; the
 *    "Failed to load preferences" fallback when the store has none; and the
 *    push-disabled gating that disables every dependent toggle (vs. enabled
 *    when push is on).
 *  - The header back button calls `navigation.goBack` on phones and tablets.
 */

// deviceRender drives useDeviceType via a mocked useWindowDimensions.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

// The notification store is the screen's only data source. Selector-aware so a
// bare `useNotificationStore()` (what the screen does) yields the whole state,
// while `getState()` still works for anything reaching through the store.
// `loadPreferences` / `updatePreferences` must resolve — the screen chains
// `.finally()` / `await` on them.
const mockNotificationState: {
  preferences: Record<string, unknown> | null;
  loadPreferences: jest.Mock;
  updatePreferences: jest.Mock;
} = {
  preferences: null,
  loadPreferences: jest.fn().mockResolvedValue(undefined),
  updatePreferences: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@stores/notificationStore', () => ({
  useNotificationStore: Object.assign(
    (selector?: (s: typeof mockNotificationState) => unknown) =>
      typeof selector === 'function' ? selector(mockNotificationState) : mockNotificationState,
    { getState: () => mockNotificationState, setState: jest.fn(), subscribe: jest.fn() }
  ),
}));

// Stub the chrome from @components/common. The real SafeAreaView/BackButton drag
// the whole barrel in (ScreenHeader → ProfileProvider + notification wiring),
// which isn't the subject here. SafeAreaView → passthrough View; BackButton →
// a TouchableOpacity keeping its `nav-back-button` id wired to onPress. Toggle
// and Typography (@components/ui) stay REAL so the tap / disabled assertions
// exercise real behaviour.
jest.mock('@components/common', () => {
  const React = require('react');
  const { View, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, { testID: 'safe-area' }, children ?? null),
    BackButton: ({ onPress }: { onPress?: () => void }) =>
      React.createElement(TouchableOpacity, { testID: 'nav-back-button', onPress }),
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenHeader: ({
      onBackPress,
      rightElement,
    }: {
      onBackPress?: () => void;
      rightElement?: React.ReactNode;
    }) =>
      React.createElement(
        View,
        null,
        React.createElement(TouchableOpacity, { testID: 'nav-back-button', onPress: onBackPress }),
        rightElement ?? null
      ),
    screenScrollViewStyle: { scroll: { flex: 1 } },
  };
});

// FocusModeIndicator owns its own async Focus-Mode state + expo-linking; it isn't
// the subject here. Stub it to a marker View so we can assert it's mounted.
jest.mock('@components/notifications/FocusModeIndicator', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    FocusModeIndicator: () => React.createElement(View, { testID: 'focus-mode-indicator' }),
  };
});

import React from 'react';
import { act, type ReactTestRenderer } from 'react-test-renderer';

import { Toggle } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { NotificationSettingsScreen } from '@screens/settings/NotificationSettingsScreen';

import {
  ALL_DEVICES,
  IPADS,
  PHONES,
  renderOnDevice,
  treeText,
  type DeviceName,
} from '../../../test-utils/deviceRender';

const mockNavigation = { goBack: jest.fn(), navigate: jest.fn(), push: jest.fn() };

function makeProps() {
  return {
    navigation: mockNavigation,
    route: { key: 'NotificationSettings', name: 'NotificationSettings' },
  } as any;
}

/** A full, valid preferences object (push on, weekly summary off). */
function basePreferences(): Record<string, unknown> {
  return {
    id: 'pref-1',
    user_id: 'user-1',
    push_enabled: true,
    email_enabled: true,
    quiet_hours_start: null,
    quiet_hours_end: null,
    timezone: 'America/Toronto',
    task_reminders: true,
    task_overdue: true,
    task_assigned: true,
    task_completed: true,
    household_updates: true,
    report_ready: true,
    weekly_summary: false,
    garbage_collection: true,
    task_drafts_ready: true,
    critical_findings: true,
    maintenance_suggestions: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

// Toggle order matches JSX source order (used to target a specific row).
const TOGGLE = {
  push_enabled: 0,
  email_enabled: 1,
  task_reminders: 2,
  task_overdue: 3,
  task_assigned: 4,
  task_completed: 5,
  garbage_collection: 6,
  maintenance_suggestions: 7,
  task_drafts_ready: 8,
  critical_findings: 9,
  household_updates: 10,
  report_ready: 11,
  weekly_summary: 12,
} as const;

/** Let the mount effect's loadPreferences().finally(setIsLoading(false)) settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Render and wait for preferences to resolve (past the loading spinner). */
async function renderReady(device: DeviceName): Promise<ReactTestRenderer> {
  const r = renderOnDevice(device, <NotificationSettingsScreen {...makeProps()} />);
  await flush();
  return r;
}

function toggles(r: ReactTestRenderer) {
  return r.root.findAllByType(Toggle);
}

async function fireToggle(r: ReactTestRenderer, index: number, value: boolean): Promise<void> {
  await act(async () => {
    toggles(r)[index].props.onValueChange(value);
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockNotificationState.preferences = basePreferences();
  mockNotificationState.loadPreferences.mockClear();
  mockNotificationState.updatePreferences.mockClear();
  mockNavigation.goBack.mockClear();
});

describe('NotificationSettingsScreen — layout', () => {
  it.each(ALL_DEVICES.map((d) => [d] as [DeviceName]))(
    'renders every section, row and the footer note on %s',
    async (device) => {
      const r = await renderReady(device);

      // Preferences are pulled on mount.
      expect(mockNotificationState.loadPreferences).toHaveBeenCalledTimes(1);

      // Focus-mode indicator is mounted at the top of the list.
      expect(r.root.findByProps({ testID: 'focus-mode-indicator' })).toBeTruthy();

      // All 13 preference toggles rendered.
      expect(toggles(r)).toHaveLength(13);

      const text = treeText(r);
      // Section headers (SettingSection upper-cases the titles).
      expect(text).toContain('NOTIFICATION CHANNELS');
      expect(text).toContain('TASK NOTIFICATIONS');
      expect(text).toContain('HOME MAINTENANCE');
      expect(text).toContain('REPORTS & ANALYSIS');
      expect(text).toContain('OTHER NOTIFICATIONS');
      // A representative row title from each section.
      expect(text).toContain('Push Notifications');
      expect(text).toContain('Email Notifications');
      expect(text).toContain('Task Reminders');
      expect(text).toContain('Garbage Collection');
      expect(text).toContain('Task Drafts Ready');
      expect(text).toContain('Weekly Summary');
      // Footer note.
      expect(text).toContain("Notifications respect your device");
    }
  );
});

describe('NotificationSettingsScreen — toggles write preferences', () => {
  it('turns Push Notifications off through updatePreferences', async () => {
    const r = await renderReady('iPhone 14 Pro');
    await fireToggle(r, TOGGLE.push_enabled, false);
    expect(mockNotificationState.updatePreferences).toHaveBeenCalledWith({ push_enabled: false });
  });

  it('turns a task toggle off through updatePreferences', async () => {
    const r = await renderReady('iPad Pro 11 (portrait)');
    await fireToggle(r, TOGGLE.task_reminders, false);
    expect(mockNotificationState.updatePreferences).toHaveBeenCalledWith({ task_reminders: false });
  });

  it('toggles an "Other" preference (Weekly Summary) on through updatePreferences', async () => {
    const r = await renderReady('iPhone SE');
    // Weekly Summary starts off in basePreferences → toggling yields `true`.
    await fireToggle(r, TOGGLE.weekly_summary, true);
    expect(mockNotificationState.updatePreferences).toHaveBeenCalledWith({ weekly_summary: true });
  });
});

describe('NotificationSettingsScreen — corner cases', () => {
  it('shows a loading spinner before preferences resolve', () => {
    const r = renderOnDevice('iPhone 14 Pro', <NotificationSettingsScreen {...makeProps()} />);
    // Still loading: spinner up, no toggles/sections yet.
    expect(r.root.findAllByType(ActivityIndicator).length).toBeGreaterThanOrEqual(1);
    expect(toggles(r)).toHaveLength(0);
    expect(treeText(r)).not.toContain('Push Notifications');
  });

  it('renders the fallback when the store has no preferences', async () => {
    mockNotificationState.preferences = null;
    const r = await renderReady('iPhone 14 Pro');
    expect(treeText(r)).toContain('Failed to load preferences');
    // No spinner and no toggles once loading has finished.
    expect(r.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(toggles(r)).toHaveLength(0);
  });

  it('disables every dependent toggle while Push Notifications is off', async () => {
    mockNotificationState.preferences = { ...basePreferences(), push_enabled: false };
    const r = await renderReady('iPad mini (portrait)');
    const t = toggles(r);
    // Push + Email are only gated by isSaving (false here) → still enabled.
    expect(t[TOGGLE.push_enabled].props.disabled).not.toBe(true);
    expect(t[TOGGLE.email_enabled].props.disabled).not.toBe(true);
    // Every task/home/report/other toggle is disabled.
    const dependent = [
      TOGGLE.task_reminders,
      TOGGLE.task_overdue,
      TOGGLE.task_assigned,
      TOGGLE.task_completed,
      TOGGLE.garbage_collection,
      TOGGLE.maintenance_suggestions,
      TOGGLE.task_drafts_ready,
      TOGGLE.critical_findings,
      TOGGLE.household_updates,
      TOGGLE.report_ready,
      TOGGLE.weekly_summary,
    ];
    expect(dependent.every((i) => t[i].props.disabled === true)).toBe(true);
  });

  it('enables the dependent toggles while Push Notifications is on', async () => {
    const r = await renderReady('iPhone 14 Pro');
    const t = toggles(r);
    expect(t[TOGGLE.task_reminders].props.disabled).not.toBe(true);
    expect(t[TOGGLE.report_ready].props.disabled).not.toBe(true);
    // The toggle reflects the current preference value.
    expect(t[TOGGLE.push_enabled].props.value).toBe(true);
    expect(t[TOGGLE.weekly_summary].props.value).toBe(false);
  });
});

describe('NotificationSettingsScreen — navigation', () => {
  it.each(PHONES.concat(IPADS).map((d) => [d] as [DeviceName]))(
    'goes back from the header on %s',
    async (device) => {
      const r = await renderReady(device);
      const back = r.root.findByProps({ testID: 'nav-back-button' });
      act(() => {
        back.props.onPress();
      });
      expect(mockNavigation.goBack).toHaveBeenCalled();
    }
  );
});
