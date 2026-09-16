/**
 * NotificationsScreen — Symply Kaizen (`symply-kaizen`) reminder inbox.
 *
 * Renders the REAL screen through <ThemeProvider> off a mocked notificationStore
 * (unread/inbox + actions), a mocked kaizenStore (scheduleDailyReminders), and a
 * mocked `useNotificationPermission` (the shared OS-permission state machine —
 * see `SettingsScreen.test.tsx` for the sibling surface using the same hook).
 * Asserts the status + inbox sections, drives the `PermissionCard` request/open-
 * settings actions, and taps an inbox item (→ markRead + deep-link).
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { IPAD, IPHONE, allText, byTestId, pressByText } from '../../test-utils/kaizenScreenTestKit';
import { NotificationsScreen } from '../NotificationsScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

// The title is shown once, in the sticky header (`headerTitle`); the body no
// longer repeats it. Capture the props so the tests can assert on the header.
// Extends the shared Kaizen `@components/common` mock (which already provides
// a faithful `PermissionCard` double) with local overrides for ScreenHeader.
let headerProps: Record<string, unknown> = {};
jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  const real = require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock();
  return {
    ...real,
    __esModule: true,
    ScreenHeader: (props: Record<string, unknown>) => {
      headerProps = props;
      return ReactMock.createElement(View, { testID: 'screen-header' });
    },
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

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

jest.mock('expo-router', () => ({
  __esModule: true,
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

const mockHandleDeepLink = jest.fn();
jest.mock('@features/kaizen/services/deepLinks', () => ({
  __esModule: true,
  handleKaizenDeepLink: (...args: unknown[]) => mockHandleDeepLink(...args),
}));

const notifState: Record<string, unknown> = {};
jest.mock('@features/kaizen/stores/notificationStore', () => {
  const useNotificationStore = (selector?: (s: typeof notifState) => unknown) =>
    selector ? selector(notifState) : notifState;
  useNotificationStore.getState = () => notifState;
  return { __esModule: true, useNotificationStore };
});

const kaizenState: Record<string, unknown> = {};
jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const useKaizenStore = (selector?: (s: typeof kaizenState) => unknown) =>
    selector ? selector(kaizenState) : kaizenState;
  useKaizenStore.getState = () => kaizenState;
  return { __esModule: true, useKaizenStore };
});

const initialize = jest.fn().mockResolvedValue(undefined);
const refreshInbox = jest.fn().mockResolvedValue(undefined);
const markRead = jest.fn();
const markAllRead = jest.fn();
const clearAll = jest.fn();
const scheduleDailyReminders = jest.fn().mockResolvedValue(undefined);

function seedNotif(over: Record<string, unknown> = {}) {
  Object.keys(notifState).forEach((k) => delete notifState[k]);
  Object.assign(notifState, {
    unreadCount: 0,
    inbox: [],
    initialize,
    refreshInbox,
    markRead,
    markAllRead,
    clearAll,
    ...over,
  });
  Object.keys(kaizenState).forEach((k) => delete kaizenState[k]);
  Object.assign(kaizenState, { scheduleDailyReminders });
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <NotificationsScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  headerProps = {};
  jest.clearAllMocks();
  mockPushState = 'not-requested';
  seedNotif();
});

describe('NotificationsScreen', () => {
  it('renders the status + inbox sections with the empty state', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(headerProps.title).toBe('Notifications');
    expect(text).toContain('Unread');
    expect(text).toContain('No notifications yet.');
    expect(byTestId(tree, 'kaizen-notifications-permission-card').length).toBe(1);
    expect(refreshInbox).toHaveBeenCalled(); // fired from the mount effect
  });

  it('requests notification permission and re-registers from the permission card', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Allow');
    });
    expect(mockRequestPush).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalled();
    expect(scheduleDailyReminders).toHaveBeenCalled();
    expect(refreshInbox).toHaveBeenCalled();
    expect(mockRefreshPush).toHaveBeenCalledTimes(1);
  });

  it('offers Open Settings, not a request button, once denied', async () => {
    mockPushState = 'denied';
    const tree = await renderScreen();
    expect(byTestId(tree, 'kaizen-notifications-permission-card-request').length).toBe(0);
    await act(async () => {
      pressByText(tree, 'Open Settings');
    });
    expect(mockRequestPush).not.toHaveBeenCalled();
  });

  it('hides the permission card once notifications are granted', async () => {
    mockPushState = 'granted';
    const tree = await renderScreen();
    expect(byTestId(tree, 'kaizen-notifications-permission-card').length).toBe(0);
  });

  it('renders an inbox item and marks it read (with a deep link) when tapped', async () => {
    seedNotif({
      unreadCount: 1,
      inbox: [
        {
          id: 'n1',
          title: 'Daily practice ready',
          body: 'Three questions are due.',
          createdAt: '2026-07-14T09:00:00.000Z',
          read: false,
          data: { destination: 'today' },
        },
      ],
    });
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Daily practice ready');
    act(() => pressByText(tree, 'Daily practice ready'));
    expect(markRead).toHaveBeenCalledWith('n1');
    expect(mockHandleDeepLink).toHaveBeenCalledWith('kaizen://today');
  });

  it('hides the permission card but still offers "Mark all read" once granted with unread items', async () => {
    mockPushState = 'granted';
    seedNotif({ unreadCount: 2 });
    const tree = await renderScreen();
    expect(byTestId(tree, 'kaizen-notifications-permission-card').length).toBe(0);
    // unreadCount > 0 renders "Mark all read".
    act(() => pressByText(tree, 'Mark all read'));
    expect(markAllRead).toHaveBeenCalled();
  });

  it('routes every inbox destination and clears the inbox', async () => {
    seedNotif({
      unreadCount: 3,
      inbox: [
        {
          id: 'c',
          title: 'Career update',
          body: 'A new role matched.',
          createdAt: '2026-07-14T09:00:00.000Z',
          read: false,
          data: { destination: 'career' },
        },
        {
          id: 'co',
          title: 'Coach note',
          body: 'Reflect on today.',
          createdAt: '2026-07-14T09:00:00.000Z',
          read: true, // read item exercises the read-styling branches
          data: { destination: 'coach' },
        },
        {
          id: 'g',
          title: 'GTD item',
          body: 'Process your inbox.',
          createdAt: '2026-07-14T09:00:00.000Z',
          read: false,
          data: { destination: 'gtd' },
        },
        {
          id: 'x',
          title: 'No destination',
          body: 'Just an update.',
          createdAt: '2026-07-14T09:00:00.000Z',
          read: false,
          // no data → item.data?.destination short-circuits, no deep link fires
        },
      ],
    });
    const tree = await renderScreen();

    act(() => pressByText(tree, 'Career update'));
    expect(markRead).toHaveBeenCalledWith('c');
    expect(mockHandleDeepLink).toHaveBeenCalledWith('kaizen://career');

    act(() => pressByText(tree, 'Coach note'));
    expect(mockHandleDeepLink).toHaveBeenCalledWith('kaizen://coach');

    act(() => pressByText(tree, 'GTD item'));
    expect(mockHandleDeepLink).toHaveBeenCalledWith('kaizen://gtd');

    mockHandleDeepLink.mockClear();
    act(() => pressByText(tree, 'No destination'));
    expect(markRead).toHaveBeenCalledWith('x');
    expect(mockHandleDeepLink).not.toHaveBeenCalled();

    act(() => pressByText(tree, 'Clear inbox'));
    expect(clearAll).toHaveBeenCalled();
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Reminders and updates from Kaizen.');
    expect(headerProps.title).toBe('Notifications');
  });
});
