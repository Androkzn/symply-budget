/**
 * NotificationsScreen — the shared notification inbox (House/Budget/Health/
 * Language; Kaizen has its own, `src/features/kaizen/screens/NotificationsScreen`).
 *
 * This screen previously drove its "Push Notifications Disabled" banner off a
 * bespoke `notificationService.hasPermission()`/`requestPermission()` pair with
 * a raw `Linking.openURL('app-settings:')` fallback — the one OS-permission
 * surface in the fleet that had NOT been ported to the shared `PermissionCard`
 * (see `HealthNotificationSettingsScreen.test.tsx` / Kaizen's `SettingsScreen.
 * test.tsx` for the sibling surfaces on the same `useNotificationPermission`
 * hook). This suite proves that port: the card only shows for `not-requested`/
 * `denied`, `not-requested` fires the native "Allow" request rather than a
 * Settings detour, and `denied` routes to `Linking.openSettings()`.
 *
 * Data hooks (`useNotificationHistory`, `useRecurringReminders`, etc.) are
 * mocked as seams — their own contracts live in their respective suites.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Linking, StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { routeNotificationTap } from '@services/notificationRouting';

import { NotificationsScreen } from '../NotificationsScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

jest.mock('react-native-gesture-handler', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    Swipeable: ({ children }: { children?: React.ReactNode }) => children,
    TouchableOpacity: RN.TouchableOpacity,
  };
});

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('expo-router/react-navigation', () => ({
  __esModule: true,
  useFocusEffect: (cb: () => void | (() => void)) => {
    const ReactActual = require('react');
    ReactActual.useEffect(() => cb(), [cb]);
  },
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View, Text, Pressable } = require('react-native');
  return {
    __esModule: true,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'safe-area' }, children),
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header' }, ReactMock.createElement(Text, null, title)),
    ScreenScrollEnd: ({ testID }: { testID?: string }) => ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    screenScrollViewStyle: { scroll: {} },
    FrequencyPickerSheet: () => null,
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
const mockRefreshPush = jest.fn().mockResolvedValue(undefined);
jest.mock('@hooks/useNotificationPermission', () => ({
  __esModule: true,
  useNotificationPermission: () => ({
    state: mockPushState,
    busy: false,
    request: mockRequestPush,
    refresh: mockRefreshPush,
  }),
}));

interface MockNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  sent_at: string;
  read_at: string | null;
  data?: string | null;
}

let mockHistory: MockNotification[] = [];
let mockUnread: MockNotification[] = [];
const mockRefetch = jest.fn().mockResolvedValue(undefined);
const mockRefetchUnread = jest.fn().mockResolvedValue(undefined);
const mockLoadMore = jest.fn().mockResolvedValue(undefined);
jest.mock('@hooks/useNotificationHistory', () => ({
  __esModule: true,
  useNotificationHistory: () => ({
    data: { notifications: mockHistory, hasMore: false },
    isLoading: false,
    isFetching: false,
    refetch: mockRefetch,
    loadMore: mockLoadMore,
  }),
  useUnreadNotifications: () => ({
    data: { notifications: mockUnread, hasMore: false },
    isLoading: false,
    isFetching: false,
    refetch: mockRefetchUnread,
  }),
  useInvalidateNotificationHistory: () => jest.fn().mockResolvedValue(undefined),
}));

interface MockReminder {
  id: string;
  type: string;
  title: string;
  body: string;
  next_nudge_at: string;
  nudge_count: number;
  data?: string | null;
}

let mockReminders: MockReminder[] = [];
const mockRefetchReminders = jest.fn().mockResolvedValue(undefined);
jest.mock('@hooks/useRecurringReminders', () => ({
  __esModule: true,
  useRecurringReminders: () => ({
    reminders: mockReminders,
    frequencyOptions: [],
    isLoading: false,
    refetch: mockRefetchReminders,
    complete: jest.fn().mockResolvedValue(undefined),
    setFrequency: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('@contexts/DataContext', () => ({
  __esModule: true,
  useData: () => ({ refreshActivePropertyData: jest.fn().mockResolvedValue(undefined) }),
}));

jest.mock('@stores/notificationStore', () => ({
  __esModule: true,
  useNotificationStore: () => ({
    markAsRead: jest.fn().mockResolvedValue(undefined),
    markAllAsRead: jest.fn().mockResolvedValue(undefined),
    deleteNotification: jest.fn().mockResolvedValue(undefined),
    deleteAllNotifications: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('@services/notificationRouting', () => ({
  __esModule: true,
  routeNotificationTap: jest.fn(),
}));

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
        <NotificationsScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPushState = 'granted';
  mockHistory = [];
  mockUnread = [];
  mockReminders = [];
});

describe('NotificationsScreen — push permission card', () => {
  it('renders no card once the OS permission is granted', async () => {
    mockPushState = 'granted';
    const tree = await renderScreen();
    expect(byTestId(tree, 'notifications-permission-card').length).toBe(0);
  });

  it('renders no card when push is unavailable on this device', async () => {
    mockPushState = 'unavailable';
    const tree = await renderScreen();
    expect(byTestId(tree, 'notifications-permission-card').length).toBe(0);
  });

  it('offers a real "Allow" request — not a Settings detour — when never asked', async () => {
    mockPushState = 'not-requested';
    const tree = await renderScreen();

    expect(byTestId(tree, 'notifications-permission-card-request').length).toBe(1);
    expect(byTestId(tree, 'notifications-permission-card-settings').length).toBe(0);

    act(() => {
      const node = tree.root.find(
        (n) => n.props?.testID === 'notifications-permission-card-request'
      );
      node.props.onPress();
    });
    expect(mockRequestPush).toHaveBeenCalledTimes(1);
  });

  it('shows Open Settings, not a request button, once denied', async () => {
    mockPushState = 'denied';
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const tree = await renderScreen();

    expect(byTestId(tree, 'notifications-permission-card-request').length).toBe(0);
    expect(byTestId(tree, 'notifications-permission-card-settings').length).toBe(1);
    expect(allText(tree.toJSON())).toContain(
      'Nothing can reach this device until notifications are allowed again in Settings.'
    );

    act(() => {
      const node = tree.root.find(
        (n) => n.props?.testID === 'notifications-permission-card-settings'
      );
      node.props.onPress();
    });
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('re-checks permission state whenever the screen regains focus', async () => {
    mockPushState = 'denied';
    await renderScreen();
    expect(mockRefreshPush).toHaveBeenCalled();
  });
});

/**
 * The "Active" tab used to list ONLY pending recurring reminders, so a member
 * who tapped a bell badged with unread pushes landed on "Nothing pending" and
 * had to discover a second tab to find them — the notifications looked like
 * they had gone straight to History. Active now means "everything still waiting
 * on you": pending reminders AND unread notifications. Reading one is what
 * moves it out (History keeps every row either way).
 */
describe('NotificationsScreen — Active tab', () => {
  const unread = (id: string, title: string): MockNotification => ({
    id,
    type: 'household_update',
    title,
    body: 'body',
    sent_at: new Date().toISOString(),
    read_at: null,
  });

  const reminder = (id: string, title: string): MockReminder => ({
    id,
    type: 'mortgage_statement_reminder',
    title,
    body: 'body',
    next_nudge_at: new Date().toISOString(),
    nudge_count: 0,
  });

  it('lists unread notifications on the default (Active) tab', async () => {
    mockUnread = [unread('n1', 'You are in Sweet Home')];
    mockHistory = [...mockUnread];

    const tree = await renderScreen();

    expect(byTestId(tree, 'notification-row').length).toBe(1);
    expect(byTestId(tree, 'active-reminders-empty-state').length).toBe(0);
    expect(allText(tree.toJSON())).toContain('You are in Sweet Home');
  });

  it('shows pending reminders and unread notifications together', async () => {
    mockReminders = [reminder('r1', 'Upload your mortgage statement')];
    mockUnread = [unread('n1', 'Invite cancelled')];
    mockHistory = [...mockUnread];

    const tree = await renderScreen();

    expect(byTestId(tree, 'active-reminder-row').length).toBe(1);
    expect(byTestId(tree, 'notification-row').length).toBe(1);
  });

  /**
   * The reminder card's two actions, as they must look: two equal halves that
   * fill the card's width, and a "Remind me" that is visibly a button.
   *
   * Both halves of this were broken on Budget's "clean" skin and neither shows
   * up in a behavioural assertion. The buttons hugged their labels at the card's
   * left edge instead of splitting the row, and the secondary was painted
   * `groupedListBackground` — which on that skin resolves to the SAME
   * `palette.clean.surface` as the card behind it, so it rendered as bare text
   * with no button around it at all. Compare against the card's own resolved
   * background rather than naming a token, so any future token swap that
   * re-collides is caught here instead of on a screenshot.
   */
  it('gives both reminder actions an equal half of the row and a visible background', async () => {
    mockReminders = [reminder('r1', 'Upload your mortgage statement')];

    const tree = await renderScreen();

    const card = byTestId(tree, 'active-reminder-row')[0];
    const cardBackground = StyleSheet.flatten(card.props.style)?.backgroundColor;
    const [secondary, primary] = ['active-reminder-frequency', 'active-reminder-complete'].map(
      (id) => StyleSheet.flatten(byTestId(tree, id)[0].props.style)
    );

    for (const button of [secondary, primary]) {
      expect(button.flex).toBe(1);
      expect(button.flexBasis).toBe(0);
      expect(button.minWidth).toBe(0);
    }
    expect(secondary.backgroundColor).toBeDefined();
    expect(secondary.backgroundColor).not.toBe(cardBackground);
    expect(secondary.backgroundColor).not.toBe(primary.backgroundColor);
  });

  it('keeps read notifications out of Active — they live in History alone', async () => {
    mockUnread = [];
    mockHistory = [
      { ...unread('n1', 'Your weekly budget digest'), read_at: new Date().toISOString() },
    ];

    const tree = await renderScreen();

    expect(byTestId(tree, 'notification-row').length).toBe(0);
    expect(byTestId(tree, 'active-reminders-empty-state').length).toBe(1);
  });

  it('counts reminders + unread on the Active tab badge, matching the bell', async () => {
    mockReminders = [reminder('r1', 'Upload your mortgage statement')];
    mockUnread = [unread('n1', 'You are in Sweet Home'), unread('n2', 'Invite cancelled')];
    mockHistory = [...mockUnread];

    const tree = await renderScreen();
    // FilterTabs renders the count as `{tab.count}` — a bare number child.
    const tabBar = tree.root.find((n) => n.props?.testID === 'notifications-tab-bar');

    expect(tabBar.findAll((n) => n.props?.children === 3).length).toBeGreaterThan(0);
  });

  it('refreshes reminders, unread and history together on focus', async () => {
    await renderScreen();

    expect(mockRefetch).toHaveBeenCalled();
    expect(mockRefetchUnread).toHaveBeenCalled();
    expect(mockRefetchReminders).toHaveBeenCalled();
  });
});

/**
 * A tap is a request to go somewhere.
 *
 * Marking read is four sequential round trips — the read POST, the badge
 * refresh, then an invalidation of both notification queries, each refetching
 * because both are mounted on this screen. Awaiting that before navigating left
 * the member on an unchanged screen for as long as the network took, while the
 * row they tapped disappeared out of Active (it had just become read). Reported
 * as "tapping the invite notification does nothing".
 */
describe('NotificationsScreen — tapping a notification', () => {
  const inviteClaim: MockNotification = {
    id: 'n-invite',
    type: 'household_update',
    title: 'Lisa is waiting to join',
    body: 'They claimed your invite to Sweet Home.',
    sent_at: new Date().toISOString(),
    read_at: null,
    data: JSON.stringify({
      screen: 'BudgetInvite',
      updateType: 'budget_join_request_received',
      householdId: 'hh-1',
      type: 'household_update',
    }),
  };

  it('routes on tap without waiting for the read to round-trip', async () => {
    mockUnread = [inviteClaim];
    mockHistory = [inviteClaim];

    const tree = await renderScreen();
    const row = tree.root.findAll((n) => n.props?.testID === 'notification-row')[0]!;

    // Synchronous on purpose: no `await` between the press and the assertion,
    // so a handler that routed only after its awaits would fail here.
    act(() => {
      row.props.onPress();
    });

    expect(routeNotificationTap).toHaveBeenCalledTimes(1);
    expect((routeNotificationTap as jest.Mock).mock.calls[0]![0]).toMatchObject({
      screen: 'BudgetInvite',
      updateType: 'budget_join_request_received',
    });
  });
});
