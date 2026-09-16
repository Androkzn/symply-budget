/**
 * HomeScreen — the House "Today" dashboard. This screen had no test coverage
 * at all before 2026-07-27; this suite is scoped to the one thing that just
 * landed on it — the ambient, dismissible `PermissionCard` for notifications
 * (`useDismissiblePermissionBanner` + `useNotificationPermission`), the same
 * surface Kaizen's `TodayScreen`, Budget's `BudgetScreen` and Language's
 * `LanguageLearnScreen` all got. Every other dependency (dashboard data,
 * tasks, weather, garbage, Mira insight, movement feed) is stubbed out —
 * those own their own contracts elsewhere; this file does not attempt full
 * screen coverage.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { HomeScreen } from '../HomeScreen';

jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn() }),
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
  const { View } = require('react-native');
  // PermissionCard has no native dependency of its own (Button/Card/Typography/
  // Icon, same as everything else this mock leaves real) — keep the ACTUAL
  // implementation so these tests exercise the real not-requested/denied copy
  // and the real `-request`/`-settings`/`-dismiss` testIDs.
  const { PermissionCard } = jest.requireActual('@components/common');
  return {
    __esModule: true,
    PermissionCard,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ErrorBoundary: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, null, children),
    ScreenHeader: () => ReactMock.createElement(View, { testID: 'screen-header' }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) => ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    AdaptiveModal: ({ visible, children }: { visible?: boolean; children?: React.ReactNode }) =>
      visible ? ReactMock.createElement(View, { testID: 'adaptive-modal' }, children) : null,
  };
});

jest.mock('@components/home', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    HomeAttentionCards: () => ReactMock.createElement(View, { testID: 'home-attention-cards' }),
    HomeMiraBrief: () => ReactMock.createElement(View, { testID: 'home-mira-brief' }),
    HomeProjectsHomeCard: () => ReactMock.createElement(View, { testID: 'home-projects-card' }),
    HomeStatusStrip: () => ReactMock.createElement(View, { testID: 'home-status-strip' }),
    HouseholdMovementFeed: () => ReactMock.createElement(View, { testID: 'home-movement-feed' }),
  };
});

jest.mock('@components/layout', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AdaptiveContainer: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, null, children),
  };
});

jest.mock('@components/tasks', () => ({
  __esModule: true,
  AddTaskSheet: () => null,
  TaskCardItem: () => null,
  TaskDetailBottomSheet: () => null,
}));

jest.mock('@screens/appliances', () => ({ __esModule: true, AppliancesScreen: () => null }));
jest.mock('@screens/garbage', () => ({ __esModule: true, GarbageScheduleScreen: () => null }));

jest.mock('@hooks/useAihousekeeperPersona', () => ({
  __esModule: true,
  useAihousekeeperPersona: () => ({ persona: 'default', name: 'Mira' }),
}));
jest.mock('@hooks/useGarbageSummary', () => ({
  __esModule: true,
  useGarbageSummary: () => ({ badge: null, hasSchedule: false }),
}));
jest.mock('@hooks/useHomeDashboard', () => ({
  __esModule: true,
  useHomeDashboard: () => ({
    budgetRemaining: null,
    draftsTotal: 0,
    draftsCritical: 0,
    warrantiesExpiring: 0,
    quotesPending: 0,
    projectsActive: 0,
  }),
}));
jest.mock('@hooks/useHomeInsight', () => ({
  __esModule: true,
  useHomeInsight: () => ({ insight: null }),
}));
jest.mock('@hooks/useLayoutPadding', () => ({
  __esModule: true,
  useLayoutPadding: () => ({ content: 16 }),
}));
jest.mock('@hooks/useMovementFeed', () => ({
  __esModule: true,
  refreshMovementFeed: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@hooks/useWeather', () => ({
  __esModule: true,
  useWeather: () => null,
}));

let mockPushState: 'unavailable' | 'not-requested' | 'denied' | 'granted' = 'unavailable';
const mockRequestPush = jest.fn().mockResolvedValue(undefined);
jest.mock('@hooks/useNotificationPermission', () => ({
  __esModule: true,
  useNotificationPermission: () => ({
    state: mockPushState,
    busy: false,
    request: mockRequestPush,
    refresh: jest.fn(),
  }),
}));

jest.mock('@services/navigation', () => ({ __esModule: true, navigateToBudget: jest.fn() }));
jest.mock('@services/widget-sync', () => ({
  __esModule: true,
  widgetSync: { setHomeInsight: jest.fn(), setTasks: jest.fn() },
}));
jest.mock('@utils/movementFeedDebug', () => ({ __esModule: true, logMovementFeed: jest.fn() }));

jest.mock('@contexts/DataContext', () => ({
  __esModule: true,
  useData: () => ({ refreshActivePropertyData: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock('@stores/householdStore', () => ({
  __esModule: true,
  useHouseholdStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { currentHousehold: { id: 'hh-1' } };
    return selector ? selector(state) : state;
  },
}));
jest.mock('@stores/memberStore', () => ({
  __esModule: true,
  useMemberStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { ownerPendingJoinRequests: [] };
    return selector ? selector(state) : state;
  },
}));
jest.mock('@stores/settingsStore', () => ({
  __esModule: true,
  useSettingsStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { isSyncing: false, syncError: null };
    return selector ? selector(state) : state;
  },
}));
jest.mock('@stores/taskStore', () => ({
  __esModule: true,
  useTaskStore: () => ({ upcomingTasks: [], maintenanceTasks: [] }),
}));

function byTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

/** The pressable carrying `testID` — host or composite, whichever owns `onPress`. */
function pressableByTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.find(
    (n) => n.props?.testID === id && typeof n.props?.onPress === 'function'
  );
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HomeScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

beforeEach(() => {
  // HomeScreen's movement-feed poll effect (`setInterval(…, MOVEMENT_FEED_POLL_MS)`,
  // never cleared until unmount) hangs `act(async () => …)` under REAL timers —
  // the pending timer starves the async flush loop rather than merely leaking a
  // handle. Fake timers keep the interval from ever registering a real one.
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockPushState = 'unavailable';
});

afterEach(() => {
  jest.useRealTimers();
});

describe('HomeScreen — ambient notification permission card', () => {
  it('shows the card when push is not-requested, and requests it on tap', async () => {
    mockPushState = 'not-requested';
    const tree = await renderScreen();

    expect(byTestId(tree, 'home-notification-permission-card').length).toBe(1);
    act(() => {
      pressableByTestId(tree, 'home-notification-permission-card-action').props.onPress();
    });
    expect(mockRequestPush).toHaveBeenCalledTimes(1);
  });

  it('shows Open Settings, not a request button, once denied', async () => {
    mockPushState = 'denied';
    const tree = await renderScreen();

    const action = byTestId(tree, 'home-notification-permission-card-action')[0];
    const label = action
      .findAll((n) => typeof n.type === 'string')
      .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
      .filter((c) => typeof c === 'string')
      .join(' ');
    expect(label).toContain('Open Settings');
  });

  it('hides the card once granted or when the bridge is unavailable', async () => {
    mockPushState = 'granted';
    const grantedTree = await renderScreen();
    expect(byTestId(grantedTree, 'home-notification-permission-card').length).toBe(0);

    mockPushState = 'unavailable';
    const unavailableTree = await renderScreen();
    expect(byTestId(unavailableTree, 'home-notification-permission-card').length).toBe(0);
  });

  it('dismisses the card for the session without touching the permission itself', async () => {
    mockPushState = 'not-requested';
    const tree = await renderScreen();

    await act(async () => {
      pressableByTestId(tree, 'home-notification-permission-card-dismiss').props.onPress();
    });
    expect(byTestId(tree, 'home-notification-permission-card').length).toBe(0);
    expect(mockRequestPush).not.toHaveBeenCalled();
  });
});
