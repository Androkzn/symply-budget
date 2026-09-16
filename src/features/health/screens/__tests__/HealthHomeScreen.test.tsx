/**
 * HealthHomeScreen — Symply Health (`symply-health`) home tab.
 *
 * Renders the REAL screen through <ThemeProvider> on iPhone- and iPad-class
 * windows and drives every interactive path: the loading gate, greeting, the
 * TODAY rings + weekly trends + food challenges cards, the at-a-glance grid
 * (habits/body), the sleep card (log a night, drill-down sheet), the water
 * counter (± → adjustWater, clamped), and the daily note (edit + blur-save).
 * The Weight card was removed from Home entirely (HEALTH-HOME dashboard no
 * longer has a weight widget); weight logging still exists via the Weight
 * tab, and `loadWeightLog`/`loadHealthPrefs` are still hydrated here only to
 * feed the generic per-metric drill-down sheet's `metricSources` — there is
 * currently no UI path left on Home that opens it. Only the storage-backed
 * async fns are mocked; the pure display helpers + constants stay real
 * (covered in ../../__tests__/healthLocalStorage.test.ts).
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { InputAccessoryView, Keyboard, Platform, StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { AdaptiveContainer } from '@components/layout';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';
import { Spacing } from '@theme';

import { DEFAULT_HOME_WIDGETS } from '../../components';
import {
  loadActivityGoals,
  loadStepDays,
  loadWorkouts,
  type ActivityGoals,
  type WorkoutEntry,
} from '../../healthActivityStorage';
import { loadBodyEntries, PRIMARY_BODY_METRICS, type BodyEntry } from '../../healthBodyStorage';
import { loadHabits, type Habit } from '../../healthHabitsStorage';
import { loadHomeLayout, saveHomeLayout } from '../../healthHomeStorage';
import {
  adjustWater,
  loadHealthPrefs,
  loadNoteForDate,
  loadWaterHistory,
  loadWaterToday,
  loadWeightLog,
  saveNoteForDate,
  type HealthPrefs,
  type WaterDay,
} from '../../healthLocalStorage';
import {
  loadMeals,
  loadNutritionGoals,
  type MealEntry,
  type NutritionGoals,
} from '../../healthNutritionStorage';
import { EMPTY_SLEEP_LOG, loadSleepLog, logSleep } from '../../healthSleepStorage';
import { HealthHomeScreen } from '../HealthHomeScreen';

const IPHONE = { width: 393, height: 852, scale: 3, fontScale: 1 };
const IPAD = { width: 1024, height: 1366, scale: 2, fontScale: 1 };
let mockWindow = IPHONE;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  // PermissionCard has no native dependency of its own (Button/Card/Typography/
  // Icon, same as everything else this mock leaves real) — keep the ACTUAL
  // implementation rather than a stub, so these tests exercise the real
  // not-requested/denied copy and the real `-request`/`-settings` testIDs.
  const { PermissionCard } = jest.requireActual('@components/common');
  return {
    PermissionCard,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    // Mirror the real header's two tap targets so tests can drive them by testID
    // (`header-notifications` / `header-profile`, as in src/components/common/ScreenHeader.tsx).
    ScreenHeader: ({
      onNotificationPress,
      onProfilePress,
    }: {
      onNotificationPress?: () => void;
      onProfilePress?: () => void;
    }) =>
      ReactMock.createElement(View, { testID: 'screen-header' }, [
        ReactMock.createElement(View, {
          key: 'notifications',
          testID: 'header-notifications',
          onPress: onNotificationPress,
        }),
        ReactMock.createElement(View, {
          key: 'profile',
          testID: 'header-profile',
          onPress: onProfilePress,
        }),
      ]),
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
}));

// Focus callbacks are recorded so tests can replay a tab blur/refocus without a
// real navigator (the screen registers two: note reload + sleep-draft cleanup).
const mockFocusCallbacks: Array<() => void | (() => void)> = [];
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactMock = require('react');
    if (!mockFocusCallbacks.includes(callback)) mockFocusCallbacks.push(callback);
    ReactMock.useEffect(() => callback(), [callback]);
  },
}));

const mockUser: { display_name?: string } | null = { display_name: 'Ada Lovelace' };
jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: mockUser, logout: jest.fn() }),
}));

// The Health home screen feeds the shared widget/watch kit. Capture the handoff
// so we can assert the cups → millilitres conversion for `widget_health_today`.
const mockSetSnapshot = jest.fn();
jest.mock('@services/widget-sync', () => ({
  // Forward lazily: the factory is hoisted above `mockSetSnapshot`, so reading it
  // inside a wrapper (called at render time) avoids the eager-undefined capture.
  widgetSync: { setSnapshot: (...args: unknown[]) => mockSetSnapshot(...args) },
}));

// Keep the pure helpers + constants real; stub only the storage-backed reads/writes.
jest.mock('../../healthLocalStorage', () => {
  const actual = jest.requireActual('../../healthLocalStorage');
  return {
    ...actual,
    loadWeightLog: jest.fn(),
    loadHealthPrefs: jest.fn(),
    loadWaterToday: jest.fn(),
    loadWaterHistory: jest.fn(),
    loadNoteForDate: jest.fn(),
    adjustWater: jest.fn(),
    saveNoteForDate: jest.fn(),
  };
});

// Home is now a dashboard: it reads the other tabs' stores to render the day's
// rings, the at-a-glance grid and the recent-activity feed. Only the async
// reads are stubbed; the pure summarisers (sumNutrition, isDoneOn, …) stay real.
jest.mock('../../healthNutritionStorage', () => {
  const actual = jest.requireActual('../../healthNutritionStorage');
  // Home reads the whole seven-day window and filters to today itself, so the
  // drill-down sheets can render a series without a second read.
  return { ...actual, loadMeals: jest.fn(), loadNutritionGoals: jest.fn() };
});

jest.mock('../../healthActivityStorage', () => {
  const actual = jest.requireActual('../../healthActivityStorage');
  return {
    ...actual,
    loadWorkouts: jest.fn(),
    loadStepDays: jest.fn(),
    loadActivityGoals: jest.fn(),
  };
});

jest.mock('../../healthHabitsStorage', () => {
  const actual = jest.requireActual('../../healthHabitsStorage');
  return { ...actual, loadHabits: jest.fn() };
});

jest.mock('../../healthBodyStorage', () => {
  const actual = jest.requireActual('../../healthBodyStorage');
  return { ...actual, loadBodyEntries: jest.fn() };
});

jest.mock('../../healthSleepStorage', () => {
  const actual = jest.requireActual('../../healthSleepStorage');
  return { ...actual, loadSleepLog: jest.fn(), logSleep: jest.fn() };
});

// The card order is stored, so Home reads a layout before it can render at all.
jest.mock('../../healthHomeStorage', () => {
  const actual = jest.requireActual('../../healthHomeStorage');
  return { ...actual, loadHomeLayout: jest.fn(), saveHomeLayout: jest.fn() };
});

/**
 * Which trackers this member has.
 *
 * Home now filters its rings, its at-a-glance tiles, its stored card order AND
 * its jump grid through `useHealthFeatures`. The default for a COMMON user is
 * the four core trackers only, which would hide habits/body/sleep from most of
 * these rows — so the suite drives the full surface and the gating itself is
 * asserted explicitly (see "feature gates" below, and areas/home.dashboard).
 */
const mockFeatures: Record<string, boolean> = {};
jest.mock('@hooks/useHealthFeature', () => {
  const { HEALTH_FEATURE_KEYS } = jest.requireActual('@config/healthFeatures');
  return {
    useHealthFeatures: () =>
      Object.fromEntries(
        (HEALTH_FEATURE_KEYS as string[]).map((key) => [key, mockFeatures[key] !== false]),
      ),
    useHealthFeature: (key: string) => mockFeatures[key] !== false,
    isHealthFeatureEnabled: (key: string) => mockFeatures[key] !== false,
  };
});

let mockPushState: 'unavailable' | 'not-requested' | 'denied' | 'granted' = 'unavailable';
const mockRequestPush = jest.fn().mockResolvedValue(undefined);
jest.mock('@hooks/useNotificationPermission', () => ({
  useNotificationPermission: () => ({
    state: mockPushState,
    busy: false,
    request: mockRequestPush,
    refresh: jest.fn(),
  }),
}));

let mockHealthKitStatus: { state: string; lastSyncedAt: string | null } | null = null;
const mockConnectOrSync = jest.fn();
jest.mock('../../useHealthKitConnection', () => ({
  useHealthKitConnection: () => ({
    status: mockHealthKitStatus,
    busy: false,
    connectOrSync: mockConnectOrSync,
  }),
}));

const mockLoadWeightLog = loadWeightLog as jest.Mock;
const mockLoadHealthPrefs = loadHealthPrefs as jest.Mock;
const mockLoadWaterToday = loadWaterToday as jest.Mock;
const mockLoadNoteForDate = loadNoteForDate as jest.Mock;
const mockAdjustWater = adjustWater as jest.Mock;
const mockSaveNoteForDate = saveNoteForDate as jest.Mock;
const mockLoadMeals = loadMeals as jest.Mock;
const mockLoadNutritionGoals = loadNutritionGoals as jest.Mock;
const mockLoadWorkouts = loadWorkouts as jest.Mock;
const mockLoadStepDays = loadStepDays as jest.Mock;
const mockLoadActivityGoals = loadActivityGoals as jest.Mock;
const mockLoadHabits = loadHabits as jest.Mock;
const mockLoadBodyEntries = loadBodyEntries as jest.Mock;
const mockLoadWaterHistory = loadWaterHistory as jest.Mock;
const mockLoadSleepLog = loadSleepLog as jest.Mock;
const mockLogSleep = logSleep as jest.Mock;
const mockLoadHomeLayout = loadHomeLayout as jest.Mock;
const mockSaveHomeLayout = saveHomeLayout as jest.Mock;

/** Today's step count, in the shape `loadStepDays` returns. */
const stepsToday = (steps: number) => (steps > 0 ? [{ date: TODAY_KEY, steps }] : []);

const prefs = (unit: HealthPrefs['preferredUnit'] = 'kg'): HealthPrefs => ({
  unitSystem: unit === 'lb' ? 'imperial' : 'metric',
  preferredUnit: unit,
  healthKitEnabled: false,
  aiEnabled: false,
});
const water = (over: Partial<WaterDay> = {}): WaterDay => ({
  date: '2026-07-13',
  cups: 0,
  target: 8,
  ...over,
});

const TODAY_KEY = '2026-07-13';

const nutritionGoals: NutritionGoals = { calories: 2000, protein: 120, carbs: 220, fat: 65 };
const activityGoals: ActivityGoals = { minutes: 30, steps: 8000 };

function meal(over: Partial<MealEntry> = {}): MealEntry {
  return {
    id: over.id ?? 'meal-1',
    date: over.date ?? TODAY_KEY,
    slot: over.slot ?? 'lunch',
    name: over.name ?? 'Chicken salad',
    calories: over.calories ?? 520,
    protein: over.protein ?? 40,
    carbs: over.carbs ?? 30,
    fat: over.fat ?? 20,
    loggedAt: over.loggedAt ?? '2026-07-13T12:00:00.000Z',
  };
}

function workout(over: Partial<WorkoutEntry> = {}): WorkoutEntry {
  return {
    id: over.id ?? 'workout-1',
    date: over.date ?? TODAY_KEY,
    type: over.type ?? 'run',
    minutes: over.minutes ?? 40,
    calories: over.calories ?? 320,
    intensity: over.intensity ?? 'steady',
    distanceM: over.distanceM ?? null,
    startedAt: over.startedAt ?? null,
    note: over.note ?? '',
    loggedAt: over.loggedAt ?? '2026-07-13T07:00:00.000Z',
  };
}

function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: over.id ?? 'sleep',
    name: over.name ?? 'Sleep 7+ hours',
    icon: over.icon ?? 'sleep-habit',
    category: over.category ?? 'wellness',
    templateId: over.templateId ?? null,
    timeOfDay: over.timeOfDay ?? 'anytime',
    frequency: over.frequency ?? 'daily',
    customDays: over.customDays ?? null,
    reminderTime: over.reminderTime ?? null,
    reminderEnabled: over.reminderEnabled ?? false,
    targetDuration: over.targetDuration ?? null,
    notes: over.notes ?? null,
    archived: over.archived ?? false,
    sortOrder: over.sortOrder ?? 0,
    days: over.days ?? [],
    createdAt: over.createdAt ?? '2026-07-01T00:00:00.000Z',
  };
}

function bodyEntry(over: Partial<BodyEntry> = {}): BodyEntry {
  return {
    id: over.id ?? 'body-1',
    date: over.date ?? TODAY_KEY,
    metric: over.metric ?? 'waist',
    value: over.value ?? 80,
    unit: over.unit ?? 'cm',
    loggedAt: over.loggedAt ?? '2026-07-13T09:00:00.000Z',
  };
}

/** Flatten every string in the rendered host tree, preserving concatenation. */
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

/** Every host TextInput node (sleep field + multiline note). */
function textInputs(tree: ReactTestRenderer.ReactTestRenderer) {
  // `type` is typed as ElementType, which does not include RN host names.
  return tree.root.findAll((n) => (n.type as unknown as string) === 'TextInput');
}
function inputByPlaceholder(tree: ReactTestRenderer.ReactTestRenderer, placeholder: string) {
  return textInputs(tree).find((n) => n.props?.placeholder === placeholder)!;
}

/** Fire onPress on the pressable carrying `accessibilityLabel`. */
/**
 * The newest `widget_health_today` payload.
 *
 * Home now publishes through `publishHealthGlance`, which writes the widget
 * key and then mirrors a `watch_health_today` shape right after it — so "the
 * last call" on the raw mock is the watch's, not the widget's.
 */
function lastWidgetSnapshot(): Record<string, unknown> {
  const calls = mockSetSnapshot.mock.calls.filter(([key]) => key === 'widget_health_today');
  return calls[calls.length - 1][1] as Record<string, unknown>;
}

/** How many times the WIDGET (not watch) key has been published. */
function widgetSnapshotCallCount(): number {
  return mockSetSnapshot.mock.calls.filter(([key]) => key === 'widget_health_today').length;
}

function pressByLabel(tree: ReactTestRenderer.ReactTestRenderer, label: string) {
  const node = tree.root.find(
    (n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function',
  );
  node.props.onPress();
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthHomeScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  mockPushState = 'unavailable';
  mockHealthKitStatus = null;
  mockLoadWeightLog.mockResolvedValue([]);
  mockLoadHealthPrefs.mockResolvedValue(prefs());
  mockLoadWaterToday.mockResolvedValue(water());
  mockLoadNoteForDate.mockResolvedValue('');
  mockAdjustWater.mockResolvedValue(water({ cups: 1 }));
  mockSaveNoteForDate.mockResolvedValue([]);
  mockLoadMeals.mockResolvedValue([]);
  mockLoadNutritionGoals.mockResolvedValue(nutritionGoals);
  mockLoadWorkouts.mockResolvedValue([]);
  mockLoadStepDays.mockResolvedValue([]);
  mockLoadActivityGoals.mockResolvedValue(activityGoals);
  mockLoadHabits.mockResolvedValue([]);
  mockLoadBodyEntries.mockResolvedValue([]);
  mockLoadWaterHistory.mockResolvedValue([]);
  mockLoadSleepLog.mockResolvedValue(EMPTY_SLEEP_LOG);
  mockLogSleep.mockResolvedValue(EMPTY_SLEEP_LOG);
  mockLoadHomeLayout.mockResolvedValue({ widgets: [...DEFAULT_HOME_WIDGETS] });
  mockSaveHomeLayout.mockImplementation(async (layout: { widgets: string[] }) => layout);
  for (const key of Object.keys(mockFeatures)) delete mockFeatures[key];
  jest.useFakeTimers().setSystemTime(new Date(2026, 6, 13, 9, 0, 0)); // stable "Good morning"
});

afterEach(() => {
  jest.useRealTimers();
});

describe('HealthHomeScreen — loading gate', () => {
  it('shows a spinner until every read resolves, with the screen testID mounted', () => {
    mockLoadWeightLog.mockReturnValue(new Promise(() => {})); // never resolves
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <HealthHomeScreen />
        </ThemeProvider>,
      );
    });
    expect(byTestId(tree, 'health-home-screen').length).toBe(1);
    expect(tree.root.findAllByType(ActivityIndicator).length).toBe(1);
  });
});

describe('HealthHomeScreen — loaded content', () => {
  it('greets by first name and renders every section', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Good morning, Ada');
    expect(text).toContain('your data is private to you');
    expect(text).toContain('WATER');
    expect(text).toContain("TODAY'S NOTE");
  });

  it('drops the name suffix when there is no display name', async () => {
    (mockUser as { display_name?: string }).display_name = undefined;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Good morning');
    expect(allText(tree.toJSON())).not.toContain('Good morning,');
    (mockUser as { display_name?: string }).display_name = 'Ada Lovelace';
  });

  it('greets by time of day: afternoon and evening', async () => {
    jest.setSystemTime(new Date(2026, 6, 13, 14, 0, 0)); // 2 PM
    let tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Good afternoon');

    jest.setSystemTime(new Date(2026, 6, 13, 20, 0, 0)); // 8 PM
    tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Good evening');
  });

  it('renders the water target and a fresh count of zero', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('0');
    expect(text).toContain('/ 8 cups');
  });

  it('feeds the widget snapshot with cups converted to millilitres (240 ml/cup)', async () => {
    mockLoadWaterToday.mockResolvedValue(water({ cups: 3, target: 8 }));
    await renderScreen();
    expect(lastWidgetSnapshot()).toEqual({
      water_ml: 720, // 3 cups × 240
      water_goal_ml: 1920, // 8 cups × 240
      // The widget has always READ these three; until 2026-07-25 nothing wrote
      // them, so its step and move tiles were blank on every device.
      steps: 0,
      steps_goal: 8000,
      move_pct: 0,
      next_reminder: null,
      // Widget-only domains this screen's own publish call never supplies —
      // see healthWidgetStorage.ts's file header ("The widget now carries
      // weight, nutrition and workouts — deliberately"). They still ride in
      // the payload as explicit nulls so its shape never changes.
      weight: null,
      weight_trend: null,
      nutrition: null,
      nutrition_trend: null,
      workouts: null,
      preferences: null,
    });
  });

  it('falls back to zero cups and the default target when the stored day is malformed', async () => {
    // cups/target missing exercises every defensive fallback: `?? 0`, `?? DEFAULT`,
    // and the `|| DEFAULT` divisor guard in the progress-bar width calc.
    mockLoadWaterToday.mockResolvedValue({
      date: '2026-07-13',
      cups: undefined,
      target: undefined,
    } as unknown as WaterDay);
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('/ 8 cups'); // DEFAULT_WATER_TARGET
    expect(lastWidgetSnapshot()).toEqual({
      water_ml: 0, // (undefined ?? 0) × 240
      water_goal_ml: 1920, // (undefined ?? 8) × 240
      steps: 0,
      steps_goal: 8000,
      move_pct: 0,
      next_reminder: null,
      weight: null,
      weight_trend: null,
      nutrition: null,
      nutrition_trend: null,
      workouts: null,
      preferences: null,
    });
  });
});

describe('HealthHomeScreen — ambient permission detection', () => {
  it('shows the notification card when push is not-requested, and requests it on tap', async () => {
    mockPushState = 'not-requested';
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-home-notification-permission-card').length).toBe(1);
    pressByTestId(tree, 'health-home-notification-permission-card-action');
    expect(mockRequestPush).toHaveBeenCalledTimes(1);
  });

  it('shows Open Settings, not a request button, once notifications are denied', async () => {
    mockPushState = 'denied';
    const tree = await renderScreen();

    const action = byTestId(tree, 'health-home-notification-permission-card-action')[0];
    expect(action).toBeTruthy();
    const label = action
      .findAll((n) => typeof n.type === 'string')
      .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
      .filter((c) => typeof c === 'string' || typeof c === 'number')
      .map(String)
      .join(' ');
    expect(label).toContain('Open Settings');
  });

  it('hides the notification card once granted', async () => {
    mockPushState = 'granted';
    const tree = await renderScreen();
    expect(byTestId(tree, 'health-home-notification-permission-card').length).toBe(0);
  });

  it('dismisses the notification card for the session without touching the permission itself', async () => {
    mockPushState = 'not-requested';
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, 'health-home-notification-permission-card-dismiss');
    });
    expect(byTestId(tree, 'health-home-notification-permission-card').length).toBe(0);
    expect(mockRequestPush).not.toHaveBeenCalled();
  });

  it('shows the HealthKit card once status has loaded and connects on tap', async () => {
    mockHealthKitStatus = { state: 'not-requested', lastSyncedAt: null };
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-home-healthkit-card').length).toBe(1);
    pressByTestId(tree, 'health-home-healthkit-card-action');
    expect(mockConnectOrSync).toHaveBeenCalledTimes(1);
  });

  it('hides the HealthKit card before status resolves, rather than crashing', async () => {
    mockHealthKitStatus = null;
    const tree = await renderScreen();
    expect(byTestId(tree, 'health-home-healthkit-card').length).toBe(0);
    expect(byTestId(tree, 'health-home-screen').length).toBe(1);
  });

  it('hides the HealthKit card once connected', async () => {
    mockHealthKitStatus = { state: 'connected', lastSyncedAt: null };
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-home-healthkit-card').length).toBe(0);
  });
});

describe('HealthHomeScreen — water counter', () => {
  it('adds and removes a cup through adjustWater', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByLabel(tree, 'Add a cup');
    });
    expect(mockAdjustWater).toHaveBeenCalledWith(1);

    await act(async () => {
      pressByLabel(tree, 'Remove a cup');
    });
    expect(mockAdjustWater).toHaveBeenCalledWith(-1);
  });
});

describe('HealthHomeScreen — daily note', () => {
  it('edits the note locally and saves it on blur', async () => {
    const tree = await renderScreen();
    const note = inputByPlaceholder(tree, 'How are you feeling today?');
    act(() => note.props.onChangeText('Slept well, energetic'));
    await act(async () => {
      await note.props.onBlur();
    });
    expect(mockSaveNoteForDate).toHaveBeenCalledWith('Slept well, energetic');
  });
});

describe('HealthHomeScreen — header navigation', () => {
  it('routes to notifications and profile from the screen header', async () => {
    const tree = await renderScreen();
    const header = tree.root.find(
      (n) => typeof n.props?.onNotificationPress === 'function',
    );
    act(() => header.props.onNotificationPress());
    expect(mockPush).toHaveBeenCalledWith('/notifications');
    act(() => header.props.onProfilePress());
    expect(mockPush).toHaveBeenCalledWith('/profile');
  });
});

describe('HealthHomeScreen — iPad rendering', () => {
  it('mounts on iPad-class dimensions with the same content', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(byTestId(tree, 'health-home-screen').length).toBe(1);
    expect(allText(tree.toJSON())).toContain('WATER');
  });
});

/* ------------------------------------------------------------------ */
/* Coverage-gap matrix (HEALTH-HOME-067…096 + HEALTH-WIDGET-028)      */
/* ------------------------------------------------------------------ */

const ORIGINAL_OS = Platform.OS;

/** Platform.OS is a plain data property on RN's Platform module — flip + restore. */
function setPlatform(os: 'ios' | 'android') {
  (Platform as unknown as { OS: string }).OS = os;
}

/** Press the element carrying `testID` that actually owns an onPress handler. */
function pressByTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  const node = tree.root.findAll(
    (n) => n.props?.testID === id && typeof n.props?.onPress === 'function',
  )[0];
  if (!node) throw new Error(`No pressable with testID "${id}"`);
  node.props.onPress();
}

/** Composite (non-host) node for a testID — carries props Pressable does not forward. */
function componentByTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.findAll(
    (n) => typeof n.type !== 'string' && n.props?.testID === id,
    { deep: true },
  )[0];
}

const noteInput = (tree: ReactTestRenderer.ReactTestRenderer) =>
  inputByPlaceholder(tree, 'How are you feeling today?');

/**
 * Width of the water progress fill.
 *
 * Scoped to the water card's own subtree — other Home cards (the calorie
 * ring's macro bars, the food challenges detail rows) also draw a height-8
 * fill, so matching anywhere in the tree would grab whichever one happens to
 * render first once more cards ship, not necessarily water's.
 */
function progressFillWidth(tree: ReactTestRenderer.ReactTestRenderer): string {
  const waterCard = tree.root.findAll(
    (n) => typeof n.type !== 'string' && n.props?.testID === 'health-home-widget-water',
    { deep: true },
  )[0];
  if (!waterCard) throw new Error('water widget not found');
  const node = waterCard.findAll((n) => {
    if (typeof n.type !== 'string') return false;
    const flat = StyleSheet.flatten(n.props?.style) as
      | { height?: number; width?: unknown }
      | undefined;
    return !!flat && flat.height === 8 && typeof flat.width === 'string';
  })[0];
  if (!node) throw new Error('progress fill not found');
  return (StyleSheet.flatten(node.props.style) as { width: string }).width;
}

/** Replay a plain refocus (no cleanup) — re-runs the note reload. */
async function refocus() {
  await act(async () => {
    mockFocusCallbacks.forEach((cb) => {
      cb();
    });
  });
}

beforeEach(() => {
  mockFocusCallbacks.length = 0;
  setPlatform('ios');
});

afterEach(() => {
  setPlatform(ORIGINAL_OS as 'ios' | 'android');
});

describe('HealthHomeScreen — keyboard Done rows', () => {
  /*
   * These used to be two `InputAccessoryView`s mounted unconditionally on iOS.
   *
   * On device that component renders NOTHING under the New Architecture — the
   * bar never appeared above the decimal pad — while the mounted native
   * accessory container swallowed the pan gesture for the whole screen, so the
   * Home list could not be scrolled at all (measured 2026-07-26: four swipes,
   * six byte-identical screenshots; removing the pair restored scrolling on the
   * first probe). Both symptoms were invisible to this suite, because a test
   * renderer happily renders an `InputAccessoryView` that a device ignores.
   *
   * They are now ordinary rows inside their own cards, shown while the field
   * owns the keyboard. Same testIDs, same behaviour, and — the point — they
   * actually exist on screen.
   */
  it('HEALTH-HOME-067: shows the note Done row only while the note field has focus', async () => {
    setPlatform('ios');
    const tree = await renderScreen();

    // Nothing focused → no Done row. This is the regression guard: an
    // always-mounted row is what broke scrolling.
    expect(byTestId(tree, 'health-note-keyboard-done')).toHaveLength(0);

    act(() => noteInput(tree).props.onFocus());
    expect(byTestId(tree, 'health-note-keyboard-done')).toHaveLength(1);

    act(() => noteInput(tree).props.onBlur());
    expect(byTestId(tree, 'health-note-keyboard-done')).toHaveLength(0);
  });

  it('HEALTH-HOME-067b: never mounts an InputAccessoryView, and sets no inputAccessoryViewID', async () => {
    setPlatform('ios');
    const tree = await renderScreen();
    act(() => noteInput(tree).props.onFocus());

    expect(tree.root.findAllByType(InputAccessoryView)).toHaveLength(0);
    expect(noteInput(tree).props.inputAccessoryViewID).toBeUndefined();
  });

  it('HEALTH-HOME-068: renders no Done row on Android, focused or not', async () => {
    setPlatform('android');
    const tree = await renderScreen();

    act(() => noteInput(tree).props.onFocus());

    expect(tree.root.findAllByType(InputAccessoryView)).toHaveLength(0);
    expect(byTestId(tree, 'health-note-keyboard-done')).toHaveLength(0);
    expect(noteInput(tree).props.inputAccessoryViewID).toBeUndefined();
    // The Android keyboard has a return key and `onSubmitEditing` already
    // commits, so the row would be redundant chrome rather than a missing
    // affordance. Screen still mounts fully.
    expect(byTestId(tree, 'health-home-screen')).toHaveLength(1);
    expect(allText(tree.toJSON())).toContain('WATER');
  });

  it('HEALTH-HOME-070: the note Done row only dismisses the keyboard', async () => {
    setPlatform('ios');
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const tree = await renderScreen();

    act(() => noteInput(tree).props.onFocus());
    act(() => noteInput(tree).props.onChangeText('Feeling steady'));
    await act(async () => {
      pressByTestId(tree, 'health-note-keyboard-done');
    });

    expect(dismiss).toHaveBeenCalled();
    // DEFECT (HEALTH-HOME-070): the note's Done button should also persist the draft
    // (the weight row logs its entry); today it only dismisses the keyboard and
    // relies on the TextInput's onBlur firing afterwards to save.
    expect(mockSaveNoteForDate).not.toHaveBeenCalled();
    dismiss.mockRestore();
  });

  it('HEALTH-HOME-070b: blurring the note field saves it and closes the Done row', async () => {
    setPlatform('ios');
    const tree = await renderScreen();

    act(() => noteInput(tree).props.onFocus());
    act(() => noteInput(tree).props.onChangeText('Feeling steady'));
    await act(async () => {
      noteInput(tree).props.onBlur();
    });

    expect(mockSaveNoteForDate).toHaveBeenCalledWith('Feeling steady');
    expect(byTestId(tree, 'health-note-keyboard-done')).toHaveLength(0);
  });
});

describe('HealthHomeScreen — note commit paths', () => {
  it('HEALTH-HOME-071: onEndEditing saves the event text rather than the stale draft', async () => {
    const tree = await renderScreen();

    await act(async () => {
      await noteInput(tree).props.onEndEditing({ nativeEvent: { text: 'Ran 5k this morning' } });
    });

    expect(mockSaveNoteForDate).toHaveBeenCalledWith('Ran 5k this morning');
    expect(noteInput(tree).props.value).toBe('Ran 5k this morning');
  });

  it('HEALTH-HOME-072: onSubmitEditing saves the current noteDraft', async () => {
    const tree = await renderScreen();

    act(() => noteInput(tree).props.onChangeText('Short walk'));
    await act(async () => {
      await noteInput(tree).props.onSubmitEditing();
    });

    expect(mockSaveNoteForDate).toHaveBeenCalledWith('Short walk');
  });

  it('HEALTH-HOME-073: onChange skips an identical value and applies a different one', async () => {
    const tree = await renderScreen();

    act(() => noteInput(tree).props.onChangeText('same'));
    expect(noteInput(tree).props.value).toBe('same');

    // Identical text → the `if (text !== noteDraft)` guard short-circuits.
    act(() => noteInput(tree).props.onChange({ nativeEvent: { text: 'same' } }));
    expect(noteInput(tree).props.value).toBe('same');

    act(() => noteInput(tree).props.onChange({ nativeEvent: { text: 'different' } }));
    expect(noteInput(tree).props.value).toBe('different');
  });

  it('HEALTH-HOME-074: exposes the saved-note marker with the note as its label', async () => {
    mockLoadNoteForDate.mockResolvedValue('Slept 8 hours');
    const tree = await renderScreen();

    const marker = byTestId(tree, 'health-note-saved-text');
    expect(marker.length).toBe(1);
    expect(marker[0].props.accessibilityLabel).toBe('Slept 8 hours');
  });

  it('HEALTH-HOME-075: hides the saved-note marker when the note is empty', async () => {
    mockLoadNoteForDate.mockResolvedValue('');
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-note-saved-text').length).toBe(0);

    // Whitespace-only is treated as empty too.
    act(() => noteInput(tree).props.onChangeText('   '));
    expect(byTestId(tree, 'health-note-saved-text').length).toBe(0);
  });
});

describe('HealthHomeScreen — focus lifecycle', () => {
  it('HEALTH-HOME-077: reloads today’s note on refocus after an out-of-band change', async () => {
    mockLoadNoteForDate.mockResolvedValue('first version');
    const tree = await renderScreen();
    expect(noteInput(tree).props.value).toBe('first version');

    // Another surface (e.g. the widget or a second screen) rewrote today's note.
    mockLoadNoteForDate.mockResolvedValue('edited elsewhere');
    await refocus();

    expect(noteInput(tree).props.value).toBe('edited elsewhere');
  });

  it('HEALTH-HOME-078: does not push a widget snapshot before the water day hydrates', () => {
    mockLoadWaterToday.mockReturnValue(new Promise(() => {})); // never resolves
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <HealthHomeScreen />
        </ThemeProvider>,
      );
    });

    expect(byTestId(tree, 'health-home-screen').length).toBe(1);
    expect(mockSetSnapshot).not.toHaveBeenCalled();
  });
});

describe('HealthHomeScreen — water progress', () => {
  it('HEALTH-HOME-082: clamps the progress bar to 100% when cups exceed the target', async () => {
    mockLoadWaterToday.mockResolvedValue(water({ cups: 10, target: 8 }));
    const tree = await renderScreen();

    expect(progressFillWidth(tree)).toBe('100%');
    expect(allText(tree.toJSON())).toContain('/ 8 cups');
  });

  it('HEALTH-HOME-093: never drops the count below zero when removing a cup at zero', async () => {
    mockLoadWaterToday.mockResolvedValue(water({ cups: 0, target: 8 }));
    mockAdjustWater.mockResolvedValue(water({ cups: 0, target: 8 }));
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, 'health-water-minus');
    });

    expect(mockAdjustWater).toHaveBeenCalledWith(-1);
    expect(allText(byTestId(tree, 'health-water-cups-count')[0])).toBe('0');
    expect(progressFillWidth(tree)).toBe('0%');
  });

  it('HEALTH-HOME-094: shows a full bar when the count reaches the target', async () => {
    mockLoadWaterToday.mockResolvedValue(water({ cups: 8, target: 8 }));
    const tree = await renderScreen();

    expect(allText(byTestId(tree, 'health-water-cups-count')[0])).toBe('8');
    expect(allText(tree.toJSON())).toContain('/ 8 cups');
    expect(progressFillWidth(tree)).toBe('100%');
  });

  it('HEALTH-HOME-087: labels the cup count for assistive tech', async () => {
    mockLoadWaterToday.mockResolvedValue(water({ cups: 3, target: 8 }));
    const tree = await renderScreen();

    const count = byTestId(tree, 'health-water-cups-count');
    expect(count.length).toBe(1);
    expect(count[0].props.accessibilityLabel).toBe('3 cups');
  });

  it('HEALTH-WIDGET-028: re-publishes the widget snapshot after every water tap', async () => {
    mockLoadWaterToday.mockResolvedValue(water({ cups: 0, target: 8 }));
    mockAdjustWater
      .mockResolvedValueOnce(water({ cups: 1, target: 8 }))
      .mockResolvedValueOnce(water({ cups: 2, target: 8 }));
    const tree = await renderScreen();

    const widgetOnlyDomains = {
      weight: null,
      weight_trend: null,
      nutrition: null,
      nutrition_trend: null,
      workouts: null,
      preferences: null,
    };

    expect(lastWidgetSnapshot()).toEqual({
      water_ml: 0,
      water_goal_ml: 1920,
      steps: 0,
      steps_goal: 8000,
      move_pct: 0,
      next_reminder: null,
      ...widgetOnlyDomains,
    });

    await act(async () => {
      pressByTestId(tree, 'health-water-plus');
    });
    expect(lastWidgetSnapshot()).toEqual({
      water_ml: 240,
      water_goal_ml: 1920,
      steps: 0,
      steps_goal: 8000,
      move_pct: 0,
      next_reminder: null,
      ...widgetOnlyDomains,
    });

    await act(async () => {
      pressByTestId(tree, 'health-water-plus');
    });
    expect(lastWidgetSnapshot()).toEqual({
      water_ml: 480,
      water_goal_ml: 1920,
      steps: 0,
      steps_goal: 8000,
      move_pct: 0,
      next_reminder: null,
      ...widgetOnlyDomains,
    });
    // Each publish writes BOTH the widget key and its watch mirror, so three
    // publishes is six raw `setSnapshot` calls — three on the widget's own key.
    expect(widgetSnapshotCallCount()).toBe(3);
  });
});

describe('HealthHomeScreen — greeting boundaries', () => {
  it('HEALTH-HOME-083: greets with "Good afternoon" at exactly 12:00', async () => {
    jest.setSystemTime(new Date(2026, 6, 13, 12, 0, 0));
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Good afternoon');
  });

  it('HEALTH-HOME-084: greets with "Good evening" at exactly 18:00', async () => {
    jest.setSystemTime(new Date(2026, 6, 13, 18, 0, 0));
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Good evening');
  });
});

describe('HealthHomeScreen — accessibility + testID contract', () => {
  it('HEALTH-HOME-088: labels the note field and mirrors the draft in its accessibility value', async () => {
    mockLoadNoteForDate.mockResolvedValue('');
    const tree = await renderScreen();

    expect(noteInput(tree).props.accessibilityLabel).toBe("Today's note");
    expect(noteInput(tree).props.accessibilityValue).toEqual({ text: '' });

    act(() => noteInput(tree).props.onChangeText('Rest day'));
    expect(noteInput(tree).props.accessibilityValue).toEqual({ text: 'Rest day' });
  });

  it('HEALTH-HOME-090: renders the scroll-end sentinel', async () => {
    const tree = await renderScreen();
    expect(byTestId(tree, 'health-home-screen-scroll-end').length).toBe(1);
  });

  it('HEALTH-HOME-095: routes to notifications from the header bell', async () => {
    const tree = await renderScreen();
    act(() => pressByTestId(tree, 'header-notifications'));
    expect(mockPush).toHaveBeenCalledWith('/notifications');
  });

  it('HEALTH-HOME-096: routes to the profile from the header avatar', async () => {
    const tree = await renderScreen();
    act(() => pressByTestId(tree, 'header-profile'));
    expect(mockPush).toHaveBeenCalledWith('/profile');
  });

  // The ScrollView's contentContainerStyle gap cannot space the cards — it has a
  // single child (AdaptiveContainer), so the rhythm must live on that container
  // or every card renders flush against the next one.
  it('HEALTH-HOME-097: spaces the stacked cards from the AdaptiveContainer, not the scroll content', async () => {
    const tree = await renderScreen();
    const stack = tree.root.findByType(AdaptiveContainer);
    expect(StyleSheet.flatten(stack.props.style)?.gap).toBe(Spacing.base);
  });
});

/* ------------------------------------------------------------------ */
/* Dashboard parity (HEALTH-HOME-103…111)                              */
/*                                                                     */
/* Home is the donor's Dashboard: goal rings for the day, a tappable   */
/* at-a-glance grid, and a feed of what was actually logged. Every     */
/* figure here is read from another tab's store, so these rows also    */
/* guard that Home never invents a number.                             */
/* ------------------------------------------------------------------ */

describe('HealthHomeScreen — the day at a glance', () => {
  it('HEALTH-HOME-103: renders a goal ring per domain, each stating its headline figure', async () => {
    mockLoadMeals.mockResolvedValue([meal({ calories: 520 })]);
    mockLoadStepDays.mockResolvedValue(stepsToday(6000));
    mockLoadWorkouts.mockResolvedValue([workout({ minutes: 40 })]);
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-today-label').length).toBe(1);
    // A ring is opaque to assistive tech unless it says what it shows.
    const expected: Array<[string, string]> = [
      ['health-today-ring-calories', 'Calories: 520 kcal of 2000 kcal'],
      ['health-today-ring-steps', 'Steps: 6000 of 8000'],
      ['health-today-ring-move', 'Move: 40 min of 30 min'],
    ];
    for (const [testId, label] of expected) {
      const ring = byTestId(tree, testId);
      expect(ring.length).toBe(1);
      expect(ring[0].props.accessibilityLabel).toBe(label);
    }
  });

  /**
   * A ring no longer jumps straight to a tab.
   *
   * The donor presents `StepsDetailView` — one metric, its goal, its week — and
   * two of the three rings (steps, move) share the Activity tab, so a route
   * alone could not tell them apart. Each ring now opens its OWN detail sheet,
   * and the sheet carries the button that goes to the tab. Both halves are
   * asserted here: the sheet that opens, and the route it hands on.
   */
  it('HEALTH-HOME-104: each ring opens its own detail sheet, which owns the route', async () => {
    const tree = await renderScreen();

    for (const [testId, metric, route] of [
      ['health-today-ring-calories', 'calories', '/health-nutrition'],
      ['health-today-ring-steps', 'steps', '/health-activity'],
      ['health-today-ring-move', 'move', '/health-activity'],
    ] as const) {
      mockPush.mockClear();
      act(() => pressByTestId(tree, testId));
      // The sheet is the destination — no navigation has happened yet.
      expect(byTestId(tree, `health-metric-detail-${metric}`).length).toBe(1);
      expect(mockPush).not.toHaveBeenCalled();

      act(() => pressByTestId(tree, `health-metric-${metric}-open`));
      expect(mockPush).toHaveBeenCalledWith(route);
      // Opening the tab closes the sheet behind it.
      expect(byTestId(tree, `health-metric-detail-${metric}`).length).toBe(0);
    }
  });

  it('HEALTH-HOME-105: says nothing is logged rather than passing zeros off as progress', async () => {
    const tree = await renderScreen();

    const note = byTestId(tree, 'health-today-empty');
    expect(note.length).toBe(1);
    expect(allText(note[0])).toContain('Nothing logged today yet');
    // The rings still render — a zero against a real goal is honest.
    expect(byTestId(tree, 'health-today-ring-calories')[0].props.accessibilityLabel).toBe(
      'Calories: 0 kcal of 2000 kcal',
    );
  });

  it('HEALTH-HOME-106: drops the empty note as soon as anything is logged', async () => {
    mockLoadStepDays.mockResolvedValue(stepsToday(1200));
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-today-empty').length).toBe(0);
  });

  it('HEALTH-HOME-107: reports no goal instead of dividing by zero when one is unset', async () => {
    mockLoadActivityGoals.mockResolvedValue({ minutes: 0, steps: 0 });
    mockLoadStepDays.mockResolvedValue(stepsToday(4000));
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-today-ring-steps')[0].props.accessibilityLabel).toBe(
      'Steps: 4000, no goal set',
    );
  });
});

describe('HealthHomeScreen — at-a-glance grid', () => {
  it('HEALTH-HOME-108: each card carries today’s figure and opens its own detail sheet', async () => {
    mockLoadWaterToday.mockResolvedValue(water({ cups: 3, target: 8 }));
    mockLoadHabits.mockResolvedValue([
      habit({ id: 'sleep', days: ['2026-07-13'] }),
      habit({ id: 'move', name: 'Move for 30 minutes', days: [] }),
    ]);
    mockLoadBodyEntries.mockResolvedValue([bodyEntry()]);
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-glance-label').length).toBe(1);
    // Water owns a full card above this grid (see the "water counter" and
    // "water progress" suites) — Habits and Body are the only two data
    // points that live ONLY as a glance tile, since neither owns a card of
    // its own on Home (Weight's own card was removed; its drill-down sheet
    // is currently unreachable from Home).
    const expected: Array<[string, string, string]> = [
      ['health-glance-habits', 'Habits: 1/2, done today', 'habits'],
      // The denominator is the LIVE site catalogue: it grew from 14 to 41
      // when the Body tab shipped its full donor list, and a literal here rots.
      ['health-glance-body', `Body: 1/${PRIMARY_BODY_METRICS.length}, sites measured`, 'body'],
    ];
    for (const [testId, label, metric] of expected) {
      const card = byTestId(tree, testId);
      expect(card.length).toBe(1);
      expect(card[0].props.accessibilityLabel).toBe(label);
      act(() => pressByTestId(tree, testId));
      expect(byTestId(tree, `health-metric-detail-${metric}`).length).toBe(1);
      act(() => pressByTestId(tree, `health-metric-${metric}-open`));
    }

    // Water's full card is the drill-down entry point now — same sheet, same
    // figures, one fewer place to read them from.
    expect(byTestId(tree, 'health-water-open-detail')[0].props.accessibilityLabel).toBe(
      'Water: 3 of 8 cups',
    );
    act(() => pressByTestId(tree, 'health-water-open-detail'));
    expect(byTestId(tree, 'health-metric-detail-water').length).toBe(1);
    act(() => pressByTestId(tree, 'health-metric-water-open'));
  });

  it('HEALTH-HOME-109: an untouched account reads as dashes and zeroes, never as data', async () => {
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-glance-habits')[0].props.accessibilityLabel).toBe(
      'Habits: 0/0, none yet',
    );
    expect(byTestId(tree, 'health-glance-body')[0].props.accessibilityLabel).toBe(
      `Body: 0/${PRIMARY_BODY_METRICS.length}, sites measured`,
    );
  });
});

/**
 * The SLEEP card — logged by hand (no HealthKit), and its own drill-down
 * sheet. Unlike the other seven `HOME_METRIC_KEYS`, sleep has no tab of its
 * own to route to (`buildHomeMetricDetail`'s `sleep` case returns
 * `route: null`), so its sheet renders no "Open …" button — that absence is
 * itself part of the contract and is asserted, not just the happy path.
 */
describe('HealthHomeScreen — sleep card', () => {
  it('HEALTH-HOME-114: an empty log reads as an honest empty state, not a zero', async () => {
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-sleep-label').length).toBe(1);
    const empty = byTestId(tree, 'health-sleep-empty');
    expect(empty.length).toBe(1);
    expect(allText(empty[0])).toContain('No nights logged yet');
    expect(byTestId(tree, 'health-sleep-summary')[0].props.accessibilityLabel).toBe(
      'Sleep: not logged yet',
    );
  });

  it('HEALTH-HOME-115: the log button is disabled for an unparseable draft', async () => {
    const tree = await renderScreen();
    const input = inputByPlaceholder(tree, 'Hours slept');

    expect(componentByTestId(tree, 'health-log-sleep-button').props.disabled).toBe(true);
    act(() => input.props.onChangeText('0'));
    expect(componentByTestId(tree, 'health-log-sleep-button').props.disabled).toBe(true);

    await act(async () => {
      pressByTestId(tree, 'health-log-sleep-button');
    });
    expect(mockLogSleep).not.toHaveBeenCalled();
  });

  it('HEALTH-HOME-116: logs a night — parses hours to minutes, writes through, and clears the draft', async () => {
    mockLogSleep.mockResolvedValue({
      nights: [{ id: 'n1', date: TODAY_KEY, minutes: 450, source: 'manual' }],
      goalHours: 8,
    });
    const tree = await renderScreen();

    act(() => inputByPlaceholder(tree, 'Hours slept').props.onChangeText('7.5'));
    await act(async () => {
      pressByTestId(tree, 'health-log-sleep-button');
    });

    // 7.5h → 450 minutes, the same unit `POST /health/entries` (type sleep) stores.
    expect(mockLogSleep).toHaveBeenCalledWith(450);
    expect(inputByPlaceholder(tree, 'Hours slept').props.value).toBe('');
    expect(allText(byTestId(tree, 'health-sleep-last-value')[0])).toBe('7h 30m');
  });

  it('HEALTH-HOME-117: the summary opens its own detail sheet with no route out — sleep lives only on Home', async () => {
    mockLoadSleepLog.mockResolvedValue({
      nights: [{ id: 'n1', date: TODAY_KEY, minutes: 450, source: 'manual' }],
      goalHours: 8,
    });
    const tree = await renderScreen();

    act(() => pressByTestId(tree, 'health-sleep-summary'));

    expect(byTestId(tree, 'health-metric-detail-sleep').length).toBe(1);
    expect(allText(byTestId(tree, 'health-metric-sleep-value')[0])).toBe('7.5');
    // Every other metric sheet ends in an "Open <tab>" button (HEALTH-HOME-104);
    // sleep's `route` is `null` because the reading is entered right here.
    expect(byTestId(tree, 'health-metric-sleep-open').length).toBe(0);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// NOTE: the inline "Customise Home" disclosure (move/hide/reset, the
// `health-home-customise-*` testIDs) was ported out of this screen into
// `src/screens/settings/TabCustomizationScreen.tsx` — Home no longer renders
// it at all. That screen has its own coverage in
// `src/features/health/__tests__/areas/platform.tabCustomization.test.tsx`.
