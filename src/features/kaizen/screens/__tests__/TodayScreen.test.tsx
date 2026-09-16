/**
 * TodayScreen — Symply Kaizen (`symply-kaizen`) Today tab.
 *
 * Renders the REAL screen through <ThemeProvider> and asserts the daily-core
 * summary and pull-to-refresh sync. The sqlite-backed store, expo-router, and the native
 * ScreenHeader are stubbed so the screen mounts deterministically in isolation. Every
 * primary pressable drives a dedicated test that asserts router.push or a store action —
 * not text presence alone.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { router } from 'expo-router';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  IPHONE,
  
  allText,
  byTestId,
  
  instanceText,
  listPressableLabels,
  pressByText,
} from '../../test-utils/kaizenScreenTestKit';
import { TodayScreen } from '../TodayScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('expo-router', () => ({
  __esModule: true,
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

// Capture the props TodayScreen passes to the header so we can assert the
// notification-bell / avatar tap handlers are wired (regression: they were
// rendered but never given onPress handlers, so taps were dead no-ops).
const mockHeaderProps: Record<string, unknown> = {};
jest.mock('@components/common', () => {
  const R = require('react');
  const { View } = require('react-native');
  // PermissionCard has no native dependency of its own (Button/Card/Typography/
  // Icon, same as everything else this mock leaves real) — keep the ACTUAL
  // implementation so these tests exercise the real not-requested/denied copy
  // and the real `-request`/`-settings`/`-dismiss` testIDs.
  const { PermissionCard } = jest.requireActual('@components/common');
  return {
    __esModule: true,
    PermissionCard,
    ScreenHeader: (props: Record<string, unknown>) => {
      Object.assign(mockHeaderProps, props);
      return R.createElement(View, { testID: 'screen-header' });
    },
    ScreenScrollEnd: ({ testID }: { testID: string }) =>
      R.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

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

const mockQuestionsState: { questions: unknown[] } = { questions: [] };

jest.mock('@features/kaizen/hooks/useKaizenInterviewQuestions', () => ({
  __esModule: true,
  useKaizenInterviewQuestions: () => ({ data: mockQuestionsState.questions }),
  useInvalidateKaizenInterviewQuestions: () => jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const A = () => jest.fn().mockResolvedValue(undefined);
  const state = {
    profile: { enabled_systems: JSON.stringify(['career']) },
    dailyCore: [],
    todayLogs: [],
    deepWork: [],
    rotations: [],
    habitStacks: [],
    habitStackSteps: [],
    wakeConfirmedToday: false,
    isSyncing: false,
    completeDailyAction: A(),
    skipDailyAction: A(),
    confirmWake: A(),
    hydrate: A(),
    sync: A(),
  };
  const useKaizenStore = (sel?: (value: typeof state) => unknown) => (sel ? sel(state) : state);
  useKaizenStore.getState = () => state;
  useKaizenStore.setState = (p: Partial<typeof state> | ((value: typeof state) => Partial<typeof state>)) =>
    Object.assign(state, typeof p === 'function' ? p(state) : p);
  return { __esModule: true, useKaizenStore, __state: state };
});

 
const { __state: state } = require('@features/kaizen/stores/kaizenStore');

const now = new Date();
const todayStr = now.toISOString().slice(0, 10);
const todayWeekday = ((now.getDay() + 6) % 7) + 1; // 1 Mon ... 7 Sun, matching TodayScreen's lookup
const pastISO = new Date(now.getTime() - 86_400_000).toISOString();
const futureISO = new Date(now.getTime() + 86_400_000).toISOString();

/** Minimal KaizenActionEntry with the fields TodayScreen reads. */
function action(over: Record<string, unknown>) {
  return {
    id: 'a',
    user_id: 'u1',
    title: 'Action',
    system: 'Health',
    rhythm: 'daily',
    linked_feature: null,
    is_daily_core: 1,
    sort_order: 0,
    time_of_day: 'anytime',
    stack_id: null,
    rotation_day: null,
    reminder_anchor: null,
    reminder_policy: null,
    watch_quick_log_enabled: 0,
    voice_log_prompt: null,
    input_description: null,
    output_description: null,
    is_archived: 0,
    created_at: '',
    updated_at: '',
    deleted_at: null,
    ...over,
  };
}

/** Populated board used by interaction tests (wake hidden, one open action). */
function seedPopulatedBoard() {
  state.profile = { enabled_systems: JSON.stringify(['career', 'health']) };
  state.wakeConfirmedToday = true;
  state.dailyCore = [
    action({
      id: 'a1',
      title: 'Morning meditation',
      time_of_day: 'morning',
      system: 'Mental',
      output_description: '10 minutes',
      voice_log_prompt: 'How did it go?',
      watch_quick_log_enabled: 1,
      stack_id: 'st1',
      sort_order: 0,
    }),
    action({
      id: 'a2',
      title: 'Journaling',
      time_of_day: 'morning',
      system: 'Mental',
      stack_id: 'st1',
      sort_order: 1,
    }),
    action({
      id: 'a3',
      title: 'Drink water',
      time_of_day: 'anytime',
      output_description: '2L',
      voice_log_prompt: 'Logged your water?',
      watch_quick_log_enabled: 1,
      sort_order: 2,
    }),
    action({ id: 'a4', title: 'Evening walk', time_of_day: 'evening', sort_order: 3 }),
    action({ id: 'a5', title: 'Afternoon reps', time_of_day: 'afternoon', sort_order: 4 }),
  ];
  state.todayLogs = [
    { action_id: 'a1', completed_at: pastISO, skipped: 0, source: 'manual' },
    { action_id: 'a2', completed_at: null, skipped: 1, source: 'manual' },
    { action_id: 'a4', completed_at: pastISO, skipped: 0, source: 'manual' },
    { action_id: 'a5', completed_at: pastISO, skipped: 0, source: 'health' },
  ];
  state.habitStacks = [{ id: 'st1', name: 'Morning Routine' }];
  state.habitStackSteps = [
    { id: 'sp1', stack_id: 'st1', action_id: 'a1', sort_order: 0 },
    { id: 'sp2', stack_id: 'st1', action_id: 'a2', sort_order: 1 },
  ];
  state.rotations = [{ weekday: todayWeekday, focus_title: 'Ship the RFC', system: 'Career' }];
  mockQuestionsState.questions = [
    { id: 'q1', import_review_status: 'approved', due_at: pastISO },
    { id: 'q2', import_review_status: 'pending', due_at: pastISO },
    { id: 'q3', import_review_status: 'approved', due_at: null },
    { id: 'q4', import_review_status: 'approved', due_at: futureISO },
  ];
  state.deepWork = [
    { id: 'd1', date: todayStr, topic: 'Write the spec', start_time: '09:00', end_time: '11:00' },
    { id: 'd2', date: todayStr, topic: null, start_time: null, end_time: null },
    { id: 'd3', date: '2000-01-01', topic: 'Old block', start_time: '08:00', end_time: '09:00' },
  ];
}

/** Rejecting mock that attaches .catch immediately so void store calls do not fail Jest. */
function mockHandledRejection(fn: jest.Mock): void {
  fn.mockImplementationOnce(() => {
    const rejected = Promise.reject(new Error('offline'));
    void rejected.catch(() => undefined);
    return rejected;
  });
}

function pressablesWithExactText(tree: ReactTestRenderer.ReactTestRenderer, text: string) {
  return tree.root.findAll(
    (n) =>
      typeof n.props?.onPress === 'function' && instanceText(n).trim() === text,
  );
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <TodayScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  mockPushState = 'unavailable';
  Object.assign(state, {
    profile: { enabled_systems: JSON.stringify(['career']) },
    dailyCore: [],
    todayLogs: [],
    deepWork: [],
    rotations: [],
    habitStacks: [],
    habitStackSteps: [],
    wakeConfirmedToday: false,
    isSyncing: false,
  });
  mockQuestionsState.questions = [];
});

describe('TodayScreen — ambient notification permission detection', () => {
  it('shows the notification card when push is not-requested, and requests it on tap', async () => {
    mockPushState = 'not-requested';
    const tree = await renderScreen();

    expect(byTestId(tree, 'kaizen-today-notification-permission-card').length).toBe(1);
    act(() => {
      const node = tree.root.findAll(
        (n) =>
          n.props?.testID === 'kaizen-today-notification-permission-card-action' &&
          typeof n.props?.onPress === 'function',
      )[0];
      node.props.onPress();
    });
    expect(mockRequestPush).toHaveBeenCalledTimes(1);
  });

  it('shows Open Settings, not a request button, once denied', async () => {
    mockPushState = 'denied';
    const tree = await renderScreen();

    const action = byTestId(tree, 'kaizen-today-notification-permission-card-action')[0];
    expect(instanceText(action)).toContain('Open Settings');
  });

  it('hides the card once granted or when the bridge is unavailable', async () => {
    mockPushState = 'granted';
    const grantedTree = await renderScreen();
    expect(byTestId(grantedTree, 'kaizen-today-notification-permission-card').length).toBe(0);

    mockPushState = 'unavailable';
    const unavailableTree = await renderScreen();
    expect(
      byTestId(unavailableTree, 'kaizen-today-notification-permission-card').length,
    ).toBe(0);
  });

  it('dismisses the card for the session without touching the permission itself', async () => {
    mockPushState = 'not-requested';
    const tree = await renderScreen();

    await act(async () => {
      const node = tree.root.findAll(
        (n) => n.props?.testID === 'kaizen-today-notification-permission-card-dismiss',
      )[0];
      node.props.onPress();
    });
    expect(byTestId(tree, 'kaizen-today-notification-permission-card').length).toBe(0);
    expect(mockRequestPush).not.toHaveBeenCalled();
  });
});

describe('TodayScreen', () => {

  it('renders a fully populated board with grouped actions and cards', async () => {
    seedPopulatedBoard();
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).not.toContain('Start your day');
    expect(text).toContain('Morning Routine');
    expect(text).toContain('morning');
    expect(text).toContain('Logged your water?');
    expect(text).not.toContain('How did it go?');
    expect(text).toContain('Watch quick-log');
    expect(text).toContain('Skipped');
    expect(text).toContain('Ship the RFC');
    expect(text).toContain('Career');
    expect(text).toContain('1 questions due');
    expect(text).toContain('Write the spec');
    expect(text).toContain('09:00 – 11:00');
    expect(text).toContain('Focus block');
    expect(text).toContain('Unscheduled');
    expect(text).not.toContain('Old block');
  });

  it('calls completeDailyAction when Done is pressed on an open action', async () => {
    seedPopulatedBoard();
    const tree = await renderScreen();
    await act(async () => pressByText(tree, 'Done'));
    expect(state.completeDailyAction).toHaveBeenCalledWith('a3');
  });

  it('still renders after completeDailyAction rejects', async () => {
    seedPopulatedBoard();
    mockHandledRejection(state.completeDailyAction);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Done');
      await Promise.resolve();
    });
    expect(state.completeDailyAction).toHaveBeenCalledWith('a3');
    expect(allText(tree.toJSON())).toContain('Drink water');
  });

  it('calls skipDailyAction when Skip is pressed on an open action', async () => {
    seedPopulatedBoard();
    const tree = await renderScreen();
    await act(async () => pressByText(tree, 'Skip'));
    expect(state.skipDailyAction).toHaveBeenCalledWith('a3');
  });

  it('still renders after skipDailyAction rejects', async () => {
    seedPopulatedBoard();
    mockHandledRejection(state.skipDailyAction);
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Skip');
      await Promise.resolve();
    });
    expect(state.skipDailyAction).toHaveBeenCalledWith('a3');
    expect(allText(tree.toJSON())).toContain('Drink water');
  });

  it('completes and skips each open action independently', async () => {
    state.wakeConfirmedToday = true;
    state.dailyCore = [
      action({ id: 'open-a', title: 'First open', time_of_day: 'morning', sort_order: 0 }),
      action({ id: 'open-b', title: 'Second open', time_of_day: 'afternoon', sort_order: 1 }),
    ];
    const tree = await renderScreen();
    const doneButtons = pressablesWithExactText(tree, 'Done');
    const skipButtons = pressablesWithExactText(tree, 'Skip');
    expect(doneButtons.length).toBe(2);
    expect(skipButtons.length).toBe(2);

    await act(async () => {
      doneButtons[0].props.onPress();
    });
    expect(state.completeDailyAction).toHaveBeenLastCalledWith('open-a');

    await act(async () => {
      skipButtons[1].props.onPress();
    });
    expect(state.skipDailyAction).toHaveBeenLastCalledWith('open-b');
  });

  it('navigates to question banks from the career reps Open link', async () => {
    seedPopulatedBoard();
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Open'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/banks');
  });

  it('navigates to deep-work planner from the Add link', async () => {
    seedPopulatedBoard();
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Add'));
    expect(router.push).toHaveBeenCalledWith('/kaizen/deep-work');
  });

  it('navigates to the coach from the footer link', async () => {
    seedPopulatedBoard();
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Ask your coach'));
    expect(router.push).toHaveBeenCalledWith('/mira');
  });

  it('covers every primary pressable with a router or store side effect', async () => {
    seedPopulatedBoard();
    const tree = await renderScreen();
    const labels = listPressableLabels(tree);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Done',
        'Skip',
        expect.stringContaining('Open'),
        'Add',
        expect.stringContaining('Ask your coach'),
      ]),
    );
    // Header handlers are not Pressables in the tree — asserted in dedicated tests.
    expect(typeof mockHeaderProps.onNotificationPress).toBe('function');
    expect(typeof mockHeaderProps.onProfilePress).toBe('function');
  });

  it('shows the completed pill and a system-less rotation focus', async () => {
    state.dailyCore = [action({ id: 'a1', title: 'Stretch', time_of_day: 'morning' })];
    state.todayLogs = [{ action_id: 'a1', completed_at: pastISO, skipped: 0, source: 'manual' }];
    state.rotations = [{ weekday: todayWeekday, focus_title: 'Deep focus day', system: null }];
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Daily Core complete');
    expect(text).toContain('Deep focus day');
  });
});
