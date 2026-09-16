/**
 * Home (Dashboard) — the rows `screens/__tests__/HealthHomeScreen.test.tsx`
 * does not reach.
 *
 * That suite drives the screen's own lines to ~100%, so nothing here is chasing
 * a number. These are BEHAVIOURS with no test:
 *
 *   * the ring ARITHMETIC (0 / partial / exactly-goal / over-goal) — the old
 *     suite asserts a ring's spoken label but never the fraction handed to
 *     `ProgressRing`, so an over-goal day drawing a 260%-long arc would pass;
 *   * the at-a-glance tiles on a first-run account, counted against the LIVE
 *     catalogues rather than a frozen literal (BODY_METRICS went 14 → 41 and
 *     took two tests with it);
 *   * the widget snapshot's `steps` / `move_pct` half, which the water rows
 *     never touch;
 *   * the ScrollView contract installed on 2026-07-26 when Home turned out to
 *     be unscrollable on device;
 *   * the STORED widget order becoming render order, and an unknown stored
 *     key not crashing the tab. (The interactive toggle/move/reset panel that
 *     used to live inline on Home moved to its own screen in f04f7dec —
 *     see `platform.tabCustomization.test.tsx` for that coverage now.)
 *   * the per-feature gates Home now applies to its rings, tiles and cards —
 *     a common member does not have every tracker;
 *   * three of the four ERROR rows (HEALTH-HOME-058, 060…061) whose Automation
 *     column points at a Maestro flow that does not exercise them at all.
 *     (059 — a weight write in flight — no longer applies; the weight card
 *     it pinned was removed from Home.)
 *
 * The PRIVACY and COMING SOON cards this file used to cover (HEALTH-HOME-
 * 154…156) were deleted outright, not relocated, in the same f04f7dec
 * commit — there is nothing left here to test.
 *
 * Only the storage-backed async reads/writes are mocked; every pure helper
 * (`sumNutrition`, `isDoneOn`, `summarizeBody`, `moveWidget`, `toggleWidget`)
 * stays real, so a change in one of those fails here.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Platform } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ProgressRing, ringGeometry } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';

import { DEFAULT_HOME_WIDGETS } from '../../components';
import {
  loadActivityGoals,
  loadStepDays,
  loadWorkouts,
  type ActivityGoals,
  type WorkoutEntry,
} from '../../healthActivityStorage';
import {
  loadBodyEntries,
  PRIMARY_BODY_METRICS,
  type BodyEntry,
} from '../../healthBodyStorage';
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
import { HealthHomeScreen } from '../../screens/HealthHomeScreen';

// Phone-class window — every row here is about content, not about the tablet
// container (HEALTH-HOME-056 owns the iPad path).
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: () => ReactMock.createElement(View, { testID: 'screen-header' }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) => ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
}));

/** Focus callbacks are recorded so a tab blur/refocus can be replayed without a navigator. */
const mockFocusCallbacks: Array<() => void | (() => void)> = [];
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactMock = require('react');
    if (!mockFocusCallbacks.includes(callback)) mockFocusCallbacks.push(callback);
    ReactMock.useEffect(() => callback(), [callback]);
  },
}));

jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { display_name: 'Ada Lovelace' }, logout: jest.fn() }),
}));

const mockSetSnapshot = jest.fn();
jest.mock('@services/widget-sync', () => ({
  widgetSync: { setSnapshot: (...args: unknown[]) => mockSetSnapshot(...args) },
}));

/**
 * Which trackers this member has.
 *
 * Home filters its rings, tiles, stored card order and jump grid through
 * `useHealthFeatures`. Default here is EVERYTHING ON so the content rows see
 * the full surface; the gate itself is asserted by flipping keys off.
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
jest.mock('../../healthNutritionStorage', () => {
  const actual = jest.requireActual('../../healthNutritionStorage');
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
// `moveWidget` / `toggleWidget` stay REAL: the reorder rows below are about the
// screen wiring the shipped reducer up correctly, not about re-testing it.
jest.mock('../../healthHomeStorage', () => {
  const actual = jest.requireActual('../../healthHomeStorage');
  return { ...actual, loadHomeLayout: jest.fn(), saveHomeLayout: jest.fn() };
});

const mockLoadWeightLog = loadWeightLog as jest.Mock;
const mockLoadHealthPrefs = loadHealthPrefs as jest.Mock;
const mockLoadWaterToday = loadWaterToday as jest.Mock;
const mockLoadWaterHistory = loadWaterHistory as jest.Mock;
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
const mockLoadSleepLog = loadSleepLog as jest.Mock;
const mockLogSleep = logSleep as jest.Mock;
const mockLoadHomeLayout = loadHomeLayout as jest.Mock;
const mockSaveHomeLayout = saveHomeLayout as jest.Mock;

/* ------------------------------ fixtures ------------------------------ */

const TODAY = '2026-07-13';
const YESTERDAY = '2026-07-12';
/** Matches `HealthDayRings`' default geometry, so the drawn arc can be recomputed. */
const RING_SIZE = 92;
const RING_STROKE = 10;

const nutritionGoals: NutritionGoals = { calories: 2000, protein: 120, carbs: 220, fat: 65 };
const activityGoals: ActivityGoals = { minutes: 30, steps: 8000 };

const prefs = (unit: HealthPrefs['preferredUnit'] = 'kg'): HealthPrefs => ({
  unitSystem: unit === 'lb' ? 'imperial' : 'metric',
  preferredUnit: unit,
  healthKitEnabled: false,
  aiEnabled: false,
});
const water = (over: Partial<WaterDay> = {}): WaterDay => ({
  date: TODAY,
  cups: 0,
  target: 8,
  ...over,
});
/** Today's step count, in the shape `loadStepDays` returns. */
const stepsToday = (steps: number) => (steps > 0 ? [{ date: TODAY, steps }] : []);

function meal(over: Partial<MealEntry> = {}): MealEntry {
  return {
    id: over.id ?? 'meal-1',
    date: over.date ?? TODAY,
    slot: over.slot ?? 'lunch',
    name: over.name ?? 'Chicken salad',
    calories: over.calories ?? 520,
    protein: over.protein ?? 40,
    carbs: over.carbs ?? 30,
    fat: over.fat ?? 20,
    loggedAt: over.loggedAt ?? `${TODAY}T12:00:00.000Z`,
  };
}
function workout(over: Partial<WorkoutEntry> = {}): WorkoutEntry {
  return {
    id: over.id ?? 'workout-1',
    date: over.date ?? TODAY,
    type: over.type ?? 'run',
    minutes: over.minutes ?? 40,
    calories: over.calories ?? 320,
    intensity: over.intensity ?? 'steady',
    distanceM: over.distanceM ?? null,
    startedAt: over.startedAt ?? null,
    note: over.note ?? '',
    loggedAt: over.loggedAt ?? `${TODAY}T07:00:00.000Z`,
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
    date: over.date ?? TODAY,
    metric: over.metric ?? 'waist',
    value: over.value ?? 80,
    unit: over.unit ?? 'cm',
    loggedAt: over.loggedAt ?? `${TODAY}T09:00:00.000Z`,
  };
}

/* ------------------------------ helpers ------------------------------- */

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

function pressByTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  const node = tree.root.findAll(
    (n) => n.props?.testID === id && typeof n.props?.onPress === 'function',
  )[0];
  if (!node) throw new Error(`No pressable with testID "${id}"`);
  node.props.onPress();
}

/** Every host node whose testID starts with `prefix`, in render order. */
function idsStartingWith(tree: ReactTestRenderer.ReactTestRenderer, prefix: string) {
  return tree.root
    .findAll(
      (n) =>
        typeof n.type === 'string' &&
        typeof n.props?.testID === 'string' &&
        n.props.testID.startsWith(prefix),
    )
    .map((n) => n.props.testID as string);
}

function textInputs(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAll((n) => (n.type as unknown as string) === 'TextInput');
}
const noteInput = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textInputs(tree).find((n) => n.props?.placeholder === 'How are you feeling today?')!;

/**
 * The fraction each TODAY ring hands to `ProgressRing`, in the screen's fixed
 * hue order. Scoped by ring testID: the metric detail sheet draws a ring of its
 * own, so a bare `findAllByType` would count it too.
 */
function ringProgress(tree: ReactTestRenderer.ReactTestRenderer): number[] {
  return ['calories', 'steps', 'move'].map((key) => {
    const cell = tree.root.findAll(
      (n) => typeof n.type !== 'string' && n.props?.testID === `health-today-ring-${key}`,
    )[0];
    return cell.findByType(ProgressRing).props.progress as number;
  });
}

/** Fraction of the arc actually drawn — what the member sees, after clamping. */
function ringArc(progress: number): number {
  return ringGeometry(RING_SIZE, RING_STROKE, progress).clamped;
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

/**
 * The newest `widget_health_today` payload.
 *
 * Home publishes through `publishHealthGlance`, which writes the WIDGET key and
 * then mirrors a differently-shaped `watch_health_today` — so "the last call"
 * is the watch's, and these rows are about the widget's contract.
 */
function lastWidgetSnapshot(): Record<string, number | null> {
  const calls = mockSetSnapshot.mock.calls.filter(([key]) => key === 'widget_health_today');
  return calls[calls.length - 1][1] as Record<string, number | null>;
}

/** Replay a plain refocus (no cleanup) — re-runs the note reload. */
async function refocus() {
  await act(async () => {
    mockFocusCallbacks.forEach((cb) => {
      cb();
    });
  });
}

const ORIGINAL_OS = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallbacks.length = 0;
  for (const key of Object.keys(mockFeatures)) delete mockFeatures[key];
  (Platform as unknown as { OS: string }).OS = 'ios';
  mockLoadWeightLog.mockResolvedValue([]);
  mockLoadHealthPrefs.mockResolvedValue(prefs());
  mockLoadWaterToday.mockResolvedValue(water());
  mockLoadWaterHistory.mockResolvedValue([]);
  mockLoadNoteForDate.mockResolvedValue('');
  mockAdjustWater.mockResolvedValue(water({ cups: 1 }));
  mockSaveNoteForDate.mockResolvedValue(undefined);
  mockLoadMeals.mockResolvedValue([]);
  mockLoadNutritionGoals.mockResolvedValue(nutritionGoals);
  mockLoadWorkouts.mockResolvedValue([]);
  mockLoadStepDays.mockResolvedValue([]);
  mockLoadActivityGoals.mockResolvedValue(activityGoals);
  mockLoadHabits.mockResolvedValue([]);
  mockLoadBodyEntries.mockResolvedValue([]);
  mockLoadSleepLog.mockResolvedValue(EMPTY_SLEEP_LOG);
  mockLogSleep.mockResolvedValue(EMPTY_SLEEP_LOG);
  mockLoadHomeLayout.mockResolvedValue({ widgets: [...DEFAULT_HOME_WIDGETS] });
  mockSaveHomeLayout.mockImplementation(async (layout: { widgets: string[] }) => layout);
  jest.useFakeTimers().setSystemTime(new Date(2026, 6, 13, 9, 0, 0));
});

afterEach(() => {
  jest.useRealTimers();
  (Platform as unknown as { OS: string }).OS = ORIGINAL_OS as 'ios' | 'android';
});

/* ------------------------------------------------------------------ */
/* TODAY rings — the arithmetic, not just the words                    */
/* ------------------------------------------------------------------ */

describe('Home — day rings, the arithmetic', () => {
  it('HEALTH-HOME-140: an untouched day draws three empty arcs against real goals', async () => {
    const tree = await renderScreen();

    expect(ringProgress(tree)).toEqual([0, 0, 0]);
    // Empty is not the same as "no goal": the targets are still announced.
    expect(byTestId(tree, 'health-today-ring-calories')[0].props.accessibilityLabel).toBe(
      'Calories: 0 kcal of 2000 kcal',
    );
    expect(byTestId(tree, 'health-today-ring-steps')[0].props.accessibilityLabel).toBe(
      'Steps: 0 of 8000',
    );
    expect(byTestId(tree, 'health-today-ring-move')[0].props.accessibilityLabel).toBe(
      'Move: 0 min of 30 min',
    );
  });

  it('HEALTH-HOME-141: a part-done day fills each arc by its own fraction', async () => {
    mockLoadMeals.mockResolvedValue([meal({ calories: 500 })]); // 500 / 2000
    mockLoadStepDays.mockResolvedValue(stepsToday(2000)); // 2000 / 8000
    mockLoadWorkouts.mockResolvedValue([workout({ minutes: 15 })]); // 15 / 30
    const tree = await renderScreen();

    expect(ringProgress(tree)).toEqual([0.25, 0.25, 0.5]);
    expect(ringProgress(tree).map(ringArc)).toEqual([0.25, 0.25, 0.5]);
  });

  it('HEALTH-HOME-142: hitting a goal exactly fills the arc, and no further', async () => {
    mockLoadMeals.mockResolvedValue([meal({ calories: 2000 })]);
    mockLoadStepDays.mockResolvedValue(stepsToday(8000));
    mockLoadWorkouts.mockResolvedValue([workout({ minutes: 30 })]);
    const tree = await renderScreen();

    expect(ringProgress(tree)).toEqual([1, 1, 1]);
    expect(ringProgress(tree).map(ringArc)).toEqual([1, 1, 1]);
    expect(byTestId(tree, 'health-today-ring-steps')[0].props.accessibilityLabel).toBe(
      'Steps: 8000 of 8000',
    );
  });

  it('HEALTH-HOME-143: an over-goal day clamps the ARC but never the figure', async () => {
    // A big day must not draw an arc two and a half times round the circle —
    // and must not understate what was logged either.
    mockLoadMeals.mockResolvedValue([meal({ calories: 5200 })]); // 2.6×
    mockLoadStepDays.mockResolvedValue(stepsToday(20000)); // 2.5×
    mockLoadWorkouts.mockResolvedValue([workout({ minutes: 90 })]); // 3×
    const tree = await renderScreen();

    expect(ringProgress(tree)).toEqual([2.6, 2.5, 3]);
    expect(ringProgress(tree).map(ringArc)).toEqual([1, 1, 1]);
    expect(byTestId(tree, 'health-today-ring-calories')[0].props.accessibilityLabel).toBe(
      'Calories: 5200 kcal of 2000 kcal',
    );
    expect(byTestId(tree, 'health-today-ring-move')[0].props.accessibilityLabel).toBe(
      'Move: 90 min of 30 min',
    );
    expect(byTestId(tree, 'health-today-empty').length).toBe(0);
  });

  it('HEALTH-HOME-144: a calorie goal of zero says so rather than dividing by it', async () => {
    // HEALTH-HOME-107 pins this for the STEPS ring; the calorie ring reads a
    // different store (`loadNutritionGoals`) and had no equivalent row.
    mockLoadNutritionGoals.mockResolvedValue({ calories: 0, protein: 0, carbs: 0, fat: 0 });
    mockLoadMeals.mockResolvedValue([meal({ calories: 500 })]);
    const tree = await renderScreen();

    expect(ringProgress(tree)[0]).toBe(0); // not Infinity, not NaN
    expect(byTestId(tree, 'health-today-ring-calories')[0].props.accessibilityLabel).toBe(
      'Calories: 500 kcal, no goal set',
    );
    expect(allText(tree.toJSON())).toContain('no goal set');
  });

  it('HEALTH-HOME-145: the rings count only TODAY, out of a whole-window read', async () => {
    // Home now loads the seven-day window for the drill-down sheets and filters
    // to today itself — a lost filter would credit yesterday to today's rings.
    mockLoadMeals.mockResolvedValue([
      meal({ id: 'today', date: TODAY, calories: 500 }),
      meal({ id: 'yesterday', date: YESTERDAY, calories: 1800 }),
    ]);
    mockLoadWorkouts.mockResolvedValue([
      workout({ id: 'today', date: TODAY, minutes: 15 }),
      workout({ id: 'yesterday', date: YESTERDAY, minutes: 60 }),
    ]);
    mockLoadStepDays.mockResolvedValue([
      { date: TODAY, steps: 2000 },
      { date: YESTERDAY, steps: 11000 },
    ]);
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-today-ring-calories')[0].props.accessibilityLabel).toBe(
      'Calories: 500 kcal of 2000 kcal',
    );
    expect(byTestId(tree, 'health-today-ring-steps')[0].props.accessibilityLabel).toBe(
      'Steps: 2000 of 8000',
    );
    expect(byTestId(tree, 'health-today-ring-move')[0].props.accessibilityLabel).toBe(
      'Move: 15 min of 30 min',
    );
  });

  it('HEALTH-HOME-146: a day with only yesterday’s activity still reads as empty', async () => {
    mockLoadWorkouts.mockResolvedValue([workout({ date: YESTERDAY, minutes: 60 })]);
    mockLoadStepDays.mockResolvedValue([{ date: YESTERDAY, steps: 9000 }]);
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-today-empty').length).toBe(1);
    expect(allText(byTestId(tree, 'health-today-empty')[0])).toContain('Nothing logged today yet');
  });
});

/* ------------------------------------------------------------------ */
/* AT A GLANCE — first-run tiles, counted against live catalogues      */
/* ------------------------------------------------------------------ */

describe('Home — at-a-glance tiles on a first-run account', () => {
  it('HEALTH-HOME-147: the water card reads zero of the stored target, not a dash', async () => {
    const tree = await renderScreen();

    // Water is the one card with a real number on day one — a dash here would
    // be wrong, because "0 cups" is a fact, not a missing reading.
    expect(byTestId(tree, 'health-water-open-detail')[0].props.accessibilityLabel).toBe(
      'Water: 0 of 8 cups',
    );
  });

  it('HEALTH-HOME-148: a malformed stored water day still renders, at the default target', async () => {
    mockLoadWaterToday.mockResolvedValue({
      date: TODAY,
      cups: undefined,
      target: undefined,
    } as unknown as WaterDay);
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-water-open-detail')[0].props.accessibilityLabel).toBe(
      'Water: 0 of 8 cups',
    );
  });

  it('HEALTH-HOME-149: the body tile counts against the LIVE catalogue, not a frozen number', async () => {
    // BODY_METRICS is a growing list (14 sites on the P1 shell, 41 today). A
    // literal denominator rots the moment a site is added — and did, twice.
    mockLoadBodyEntries.mockResolvedValue([
      bodyEntry({ id: 'a', metric: 'waist' }),
      bodyEntry({ id: 'b', metric: 'chest' }),
    ]);
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-glance-body')[0].props.accessibilityLabel).toBe(
      `Body: 2/${PRIMARY_BODY_METRICS.length}, sites measured`,
    );
    expect(PRIMARY_BODY_METRICS.length).toBeGreaterThan(0);
  });

  it('HEALTH-HOME-150: the habits tile counts only what was ticked TODAY', async () => {
    mockLoadHabits.mockResolvedValue([
      habit({ id: 'sleep', days: [TODAY] }),
      habit({ id: 'walk', name: 'Walk', days: [YESTERDAY] }),
      habit({ id: 'read', name: 'Read', days: [] }),
    ]);
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-glance-habits')[0].props.accessibilityLabel).toBe(
      'Habits: 1/3, done today',
    );
  });
});

/* ------------------------------------------------------------------ */
/* PRIVACY + COMING SOON — REMOVED, not just relocated                 */
/*                                                                     */
/* HEALTH-HOME-154…156 covered the structured PRIVACY card (three      */
/* labelled rows) and the COMING SOON section (`health-upcoming-*`,    */
/* `health-coming-soon-section`). Both were deleted outright in        */
/* f04f7dec ("streamline health home screen widgets and layout", same  */
/* day, before the weight-card removal) — `home-empty-and-privacy.yaml`*/
/* was deleted in that same commit. Home's intro now carries a single  */
/* plain sentence ("Track your wellness at your own pace — your data   */
/* is private to you.") instead; there is no structured card left to   */
/* assert "not a control" against, and no CUSTOMISE HOME entry to      */
/* prove it's exempt from — unlike the reorder panel below, this       */
/* content didn't move to another screen, it's just gone. Discovered   */
/* while fixing this file for the weight-card removal; unrelated to    */
/* weight, so noted here rather than silently dropped.                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* CUSTOMISE HOME — the stored card order                              */
/*                                                                     */
/* The toggle/move-up/move-down/reset panel that used to live inline   */
/* on Home (HEALTH-HOME-157…164) moved to its own screen,              */
/* `src/screens/settings/TabCustomizationScreen.tsx`, in an earlier    */
/* commit (f04f7dec, same day, BEFORE the weight-card removal). That   */
/* migration is pre-existing drift, unrelated to weight. Home no       */
/* longer renders `health-home-customise-*` at all — see               */
/* `platform.tabCustomization.test.tsx` for the current coverage of    */
/* that mechanism. `loadHomeLayout` / `saveHomeLayout` are still       */
/* mocked above and still exercised by HEALTH-HOME-158…164's siblings  */
/* below (stored order, unknown keys) wherever they read the layout    */
/* Home itself renders from, but nothing here presses a customise      */
/* control anymore.                                                    */
/* ------------------------------------------------------------------ */

describe('Home — stored widget order (read side only)', () => {
  it('HEALTH-HOME-158: the STORED order is what renders, not the shipped default', async () => {
    mockLoadHomeLayout.mockResolvedValue({ widgets: ['note', 'today', 'sleep'] });
    const tree = await renderScreen();

    expect(idsStartingWith(tree, 'health-home-widget-')).toEqual([
      'health-home-widget-note',
      'health-home-widget-today',
      'health-home-widget-sleep',
    ]);
    // The cards left out of the stored order are genuinely absent.
    expect(byTestId(tree, 'health-home-widget-water').length).toBe(0);
    expect(byTestId(tree, 'health-glance-label').length).toBe(0);
  });

  it('HEALTH-HOME-164: a stored key the build no longer ships renders nothing, and does not throw', async () => {
    // The layout is persisted per device; an app that drops a card must not
    // crash the whole tab on the next launch.
    mockLoadHomeLayout.mockResolvedValue({ widgets: ['today', 'deskHero', 'note'] });
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-home-screen').length).toBe(1);
    expect(idsStartingWith(tree, 'health-home-widget-')).toEqual([
      'health-home-widget-today',
      'health-home-widget-note',
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Feature gates — a common member does not have every tracker         */
/* ------------------------------------------------------------------ */

describe('Home — per-feature gating', () => {
  it('HEALTH-HOME-165: a tracker that is off takes its glance tile with it', async () => {
    mockFeatures.habits = false;
    mockFeatures.body = false;
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-glance-habits').length).toBe(0);
    expect(byTestId(tree, 'health-glance-body').length).toBe(0);
    // Water and sleep are full cards, not glance tiles — an unrelated
    // feature toggle leaves them untouched.
    expect(byTestId(tree, 'health-home-widget-water').length).toBe(1);
    expect(byTestId(tree, 'health-home-widget-sleep').length).toBe(1);
  });

  it('HEALTH-HOME-166: switching workouts off drops both activity rings, not the calorie one', async () => {
    mockFeatures.workouts = false;
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-today-ring-steps').length).toBe(0);
    expect(byTestId(tree, 'health-today-ring-move').length).toBe(0);
    expect(byTestId(tree, 'health-today-ring-calories').length).toBe(1);
    expect(byTestId(tree, 'health-home-widget-today').length).toBe(1);
  });

  it('HEALTH-HOME-167: a card whose every child is gone is dropped, not left as an empty title', async () => {
    mockFeatures.calories = false;
    mockFeatures.workouts = false;
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-home-widget-today').length).toBe(0);
    expect(byTestId(tree, 'health-today-label').length).toBe(0);
    // Home still renders — the rest of the stack is unaffected.
    expect(byTestId(tree, 'health-home-widget-water').length).toBe(1);
    expect(byTestId(tree, 'health-home-screen').length).toBe(1);
  });

  // HEALTH-HOME-168 ("a switched-off card is not offered in the customise
  // list either") pressed `health-home-customise-toggle`, which no longer
  // exists on this screen — that panel moved to its own screen; see the
  // CUSTOMISE HOME comment above and `platform.tabCustomization.test.tsx`.
});

/* ------------------------------------------------------------------ */
/* WIDGET handoff — the half the water rows never touch                */
/* ------------------------------------------------------------------ */

describe('Home — widget snapshot: steps and move', () => {
  it('HEALTH-HOME-169: writes the day’s steps and the step goal from the activity store', async () => {
    mockLoadStepDays.mockResolvedValue(stepsToday(6543));
    mockLoadActivityGoals.mockResolvedValue({ minutes: 30, steps: 12000 });
    await renderScreen();

    expect(mockSetSnapshot).toHaveBeenCalledWith(
      'widget_health_today',
      expect.objectContaining({ steps: 6543, steps_goal: 12000 }),
    );
  });

  it('HEALTH-HOME-170: move_pct is a FRACTION in [0,1], clamped for an over-goal day', async () => {
    // `HealthWidgetData` reads move_pct as a fraction-or-percent double, so
    // sending 3 for "300% of goal" would render a ring three times over target.
    mockLoadWorkouts.mockResolvedValue([workout({ minutes: 90 })]); // 3× a 30-minute goal
    await renderScreen();

    expect(mockSetSnapshot).toHaveBeenCalledWith(
      'widget_health_today',
      expect.objectContaining({ move_pct: 1 }),
    );
  });

  it('HEALTH-HOME-171: a part-done move goal is sent as its own fraction', async () => {
    mockLoadWorkouts.mockResolvedValue([workout({ minutes: 12 })]); // 12 / 30
    await renderScreen();

    expect(mockSetSnapshot).toHaveBeenCalledWith(
      'widget_health_today',
      expect.objectContaining({ move_pct: 0.4 }),
    );
  });

  it('HEALTH-HOME-172: an unset move goal is published as “no goal”, never as a number', async () => {
    mockLoadActivityGoals.mockResolvedValue({ minutes: 0, steps: 0 });
    mockLoadWorkouts.mockResolvedValue([workout({ minutes: 45 })]);
    await renderScreen();

    const payload = lastWidgetSnapshot();
    // `moveFraction` returns null for an unset goal, and `optionalCount` treats
    // a goal of 0 the same way for steps — null is how the widget says "no
    // goal" on either axis. 0 would draw an empty ring as though the member had
    // done nothing, and `45 / 0` would be Infinity.
    expect(payload.move_pct).toBeNull();
    expect(payload.steps_goal).toBeNull();
  });

  it('HEALTH-HOME-173: yesterday’s numbers are never sent as today’s', async () => {
    mockLoadWorkouts.mockResolvedValue([workout({ date: YESTERDAY, minutes: 60 })]);
    mockLoadStepDays.mockResolvedValue([{ date: YESTERDAY, steps: 9000 }]);
    await renderScreen();

    expect(mockSetSnapshot).toHaveBeenCalledWith(
      'widget_health_today',
      expect.objectContaining({ move_pct: 0, steps: 0 }),
    );
  });

  it('HEALTH-HOME-174: hiding the water card does not stop the widget being fed', async () => {
    // The snapshot is the WATCH's only source. It must not become a side-effect
    // of a card the member happens to have on screen.
    mockLoadHomeLayout.mockResolvedValue({ widgets: ['today'] });
    mockLoadWaterToday.mockResolvedValue(water({ cups: 2, target: 8 }));
    const tree = await renderScreen();

    expect(byTestId(tree, 'health-home-widget-water').length).toBe(0);
    expect(mockSetSnapshot).toHaveBeenCalledWith(
      'widget_health_today',
      expect.objectContaining({ water_ml: 480, water_goal_ml: 1920 }),
    );
  });
});

/* ------------------------------------------------------------------ */
/* The metric drill-down sheet                                         */
/* ------------------------------------------------------------------ */

describe('Home — metric detail sheet', () => {
  it('HEALTH-HOME-179: nothing is open until a ring or tile is tapped', async () => {
    const tree = await renderScreen();
    expect(idsStartingWith(tree, 'health-metric-detail-')).toHaveLength(0);
  });

  it('HEALTH-HOME-180: only one metric is open at a time, and closing leaves none', async () => {
    const tree = await renderScreen();

    act(() => pressByTestId(tree, 'health-today-ring-steps'));
    expect(idsStartingWith(tree, 'health-metric-detail-')).toEqual(['health-metric-detail-steps']);

    act(() => pressByTestId(tree, 'health-water-open-detail'));
    expect(idsStartingWith(tree, 'health-metric-detail-')).toEqual(['health-metric-detail-water']);

    // The sheet's own route button closes it on the way out (HEALTH-HOME-104
    // asserts the push); here it is the "one open at a time" invariant.
    act(() => pressByTestId(tree, 'health-metric-water-open'));
    expect(idsStartingWith(tree, 'health-metric-detail-')).toHaveLength(0);
  });

  it('HEALTH-HOME-181: the sheet states the same figure the ring does', async () => {
    mockLoadStepDays.mockResolvedValue(stepsToday(6543));
    const tree = await renderScreen();

    act(() => pressByTestId(tree, 'health-today-ring-steps'));
    // A drill-down that disagrees with the tile it came from is worse than no
    // drill-down: the two read the same store, so they must agree.
    expect(allText(byTestId(tree, 'health-metric-steps-value')[0])).toContain('6543');
  });

  it('HEALTH-HOME-187: the sheet’s own Close button dismisses it without navigating', async () => {
    // The other way to close it — `HEALTH-HOME-180` uses the route button.
    // `onClose` (the backdrop tap / X) is a second, separate prop wired to the
    // same `setActiveMetric(null)`, and nothing else in this suite pressed it.
    const tree = await renderScreen();

    act(() => pressByTestId(tree, 'health-glance-habits'));
    expect(idsStartingWith(tree, 'health-metric-detail-')).toEqual(['health-metric-detail-habits']);

    act(() => pressByTestId(tree, 'bottom-sheet-close'));

    expect(idsStartingWith(tree, 'health-metric-detail-')).toHaveLength(0);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* The sleep card                                                      */
/*                                                                     */
/* Not part of Agent 2's original brief (Home shipped with "no sleep"  */
/* at the time), but the card landed on Home mid-run from a concurrent */
/* workstream and is now live source — leaving it untested would be    */
/* the same gap the brief exists to close. Kept minimal: the log path  */
/* through `handleLogSleep`, which nothing else in this file drives.   */
/* ------------------------------------------------------------------ */

describe('Home — sleep card (landed mid-run, minimal coverage)', () => {
  it('HEALTH-HOME-188: logs a parsed sleep draft and clears the field', async () => {
    mockLogSleep.mockResolvedValue({ nights: [{ id: 'n1', date: TODAY, minutes: 450 }], goalHours: 8 });
    const tree = await renderScreen();

    const sleepField = textInputs(tree).find((n) => n.props?.testID === 'health-sleep-input')!;
    act(() => sleepField.props.onChangeText('7.5'));
    await act(async () => {
      pressByTestId(tree, 'health-log-sleep-button');
    });

    expect(mockLogSleep).toHaveBeenCalledWith(450); // 7.5h → 450 minutes
    expect(
      textInputs(tree).find((n) => n.props?.testID === 'health-sleep-input')!.props.value,
    ).toBe('');
  });

  it('HEALTH-HOME-189: an unparseable sleep draft cannot be logged', async () => {
    const tree = await renderScreen();

    const sleepField = textInputs(tree).find((n) => n.props?.testID === 'health-sleep-input')!;
    act(() => sleepField.props.onChangeText('abc'));
    await act(async () => {
      pressByTestId(tree, 'health-log-sleep-button');
    });

    expect(mockLogSleep).not.toHaveBeenCalled();
  });

  it('HEALTH-HOME-190: the sleep field shows and hides its own Done row on focus/blur', async () => {
    const tree = await renderScreen();
    const sleepField = () =>
      textInputs(tree).find((n) => n.props?.testID === 'health-sleep-input')!;

    expect(byTestId(tree, 'health-sleep-keyboard-done')).toHaveLength(0);
    act(() => sleepField().props.onFocus());
    expect(byTestId(tree, 'health-sleep-keyboard-done')).toHaveLength(1);
    act(() => sleepField().props.onBlur());
    expect(byTestId(tree, 'health-sleep-keyboard-done')).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* The list itself                                                     */
/* ------------------------------------------------------------------ */

describe('Home — the scroll container', () => {
  it('HEALTH-HOME-182: the Home list is addressable, keyboard-inset and tap-through', async () => {
    /*
     * All three props are the 2026-07-26 fix for a member-facing defect: two
     * always-mounted `InputAccessoryView`s swallowed the pan gesture, so the
     * Home tab could not be scrolled at all, and the keypad sat on top of the
     * weight row the card's own copy points at. Losing any one of them
     * silently returns the screen to that state, and no other test would fail.
     */
    const tree = await renderScreen();

    const scroll = tree.root.findAll(
      (n) => n.props?.testID === 'health-home-scroll' && 'keyboardShouldPersistTaps' in n.props,
    )[0];
    expect(scroll).toBeDefined();
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
    expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(true);
  });

  it('HEALTH-HOME-183: the loading gate hides the list, then hands it over intact', async () => {
    mockLoadWeightLog.mockReturnValue(new Promise(() => {}));
    let pending!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      pending = ReactTestRenderer.create(
        <ThemeProvider>
          <HealthHomeScreen />
        </ThemeProvider>,
      );
    });
    expect(pending.root.findAllByType(ActivityIndicator).length).toBe(1);
    expect(byTestId(pending, 'health-home-scroll').length).toBe(0);

    mockLoadWeightLog.mockResolvedValue([]);
    const loaded = await renderScreen();
    expect(loaded.root.findAllByType(ActivityIndicator).length).toBe(0);
    expect(byTestId(loaded, 'health-home-scroll').length).toBe(1);
    expect(byTestId(loaded, 'health-home-screen-scroll-end').length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* CANCEL — a draft nobody committed                                   */
/* ------------------------------------------------------------------ */

describe('Home — abandoned drafts', () => {
  it('HEALTH-HOME-184: an unblurred note draft does not survive a refocus', async () => {
    /*
     * The screen-level half of HEALTH-HOME-066. On device a tab switch blurs
     * the field, and blur SAVES — so the flow's note persists. Here the field
     * is never blurred, and the refocus effect re-reads storage and overwrites
     * the draft: text the member typed is gone with no warning. Pinned so a
     * future "warn about unsaved notes" change is a deliberate one, and so the
     * CANCEL family has a unit-level row at all.
     */
    const tree = await renderScreen();

    act(() => noteInput(tree).props.onChangeText('Half-written thought'));
    expect(noteInput(tree).props.value).toBe('Half-written thought');

    await refocus();

    expect(noteInput(tree).props.value).toBe(''); // silently discarded
    expect(mockSaveNoteForDate).not.toHaveBeenCalled(); // and never persisted
  });

  it('HEALTH-HOME-185: leaving the tab clears the sleep draft, writing neither', async () => {
    const tree = await renderScreen();
    const sleepField = textInputs(tree).find((n) => n.props?.testID === 'health-sleep-input')!;

    act(() => sleepField.props.onChangeText('7.5'));
    await act(async () => {
      mockFocusCallbacks.forEach((cb) => {
        const cleanup = cb();
        if (typeof cleanup === 'function') cleanup();
      });
    });

    expect(
      textInputs(tree).find((n) => n.props?.testID === 'health-sleep-input')!.props.value,
    ).toBe('');
    expect(mockLogSleep).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* ERROR — what a rejected storage promise actually does               */
/*                                                                     */
/* HEALTH-HOME-058…061 are recorded in the matrix as ERROR rows whose  */
/* Automation column points at home-water-note.yaml, which does not    */
/* force a failure at all. These pin the REAL behaviour so each        */
/* defect is a test that changes when it is fixed, not a note.         */
/* ------------------------------------------------------------------ */

describe('Home — storage in flight (defects pinned, not fixed)', () => {
  /*
   * HEALTH-HOME-058…061 are recorded in the matrix as ERROR rows whose
   * Automation column points at a Maestro flow that never forces a failure.
   *
   * They are driven here with reads/writes that NEVER SETTLE rather than ones
   * that reject. That is a harness limit, stated plainly: the screen discards
   * every storage promise (`void hydrate()`, `void handleLog()`, …) with no
   * `catch`, so a rejection becomes an unhandled rejection that jest-circus
   * attributes to whichever test is running — and the listener it uses lives
   * outside this realm, so a test file cannot mute it. See §8 of the report.
   *
   * What the rows below DO prove is the same product defect, and the half a
   * member actually meets: there is no pending state, no error state and no
   * retry anywhere on this screen. A write that has not landed is
   * indistinguishable from one that has — in one case (the note) the UI
   * actively claims success before the write is even attempted.
   */
  const never = () => new Promise<never>(() => {});

  it('HEALTH-HOME-058: a read that never lands leaves the spinner up, with no way out', async () => {
    mockLoadWeightLog.mockReturnValue(never());
    const tree = await renderScreen();

    // `hydrate()` is one Promise.all with no catch and no timeout, so a single
    // slow or broken read holds `setLoading(false)` forever. There is no error
    // copy and no retry affordance — the tab is a spinner, permanently.
    expect(tree.root.findAllByType(ActivityIndicator).length).toBe(1);
    expect(byTestId(tree, 'health-home-scroll').length).toBe(0);
    expect(allText(tree.toJSON())).not.toMatch(/try again|retry|couldn.t/i);
    // The screen root still mounts, so the tab is navigable, just useless.
    expect(byTestId(tree, 'health-home-screen').length).toBe(1);
  });

  it('HEALTH-HOME-186: the stored card order can brick the tab, though it has a default', async () => {
    // The layout read is the newest member of that same Promise.all, so it is
    // the newest way to lose the whole of Home — and `DEFAULT_HOME_LAYOUT` is
    // sitting right there unused.
    mockLoadHomeLayout.mockReturnValue(never());
    const tree = await renderScreen();

    expect(tree.root.findAllByType(ActivityIndicator).length).toBe(1);
    expect(idsStartingWith(tree, 'health-home-widget-')).toHaveLength(0);
  });

  it('HEALTH-HOME-060: the note claims to be saved BEFORE the write is attempted', async () => {
    mockSaveNoteForDate.mockReturnValue(never());
    const tree = await renderScreen();

    act(() => noteInput(tree).props.onChangeText('Slept badly'));
    await act(async () => {
      noteInput(tree).props.onBlur();
    });

    // DEFECT: `handleSaveNote` calls `setNoteDraft(value)` and only THEN awaits
    // the write, so the saved-note marker — the read-back probe E2E asserts
    // against — is up while nothing has been persisted. On a failed write the
    // text is silently gone at next launch.
    expect(noteInput(tree).props.value).toBe('Slept badly');
    expect(byTestId(tree, 'health-note-saved-text').length).toBe(1);
    expect(byTestId(tree, 'health-note-saved-text')[0].props.accessibilityLabel).toBe(
      'Slept badly',
    );
  });

  it('HEALTH-HOME-061: a water tap in flight leaves the counter exactly where it was', async () => {
    mockLoadWaterToday.mockResolvedValue(water({ cups: 3, target: 8 }));
    mockAdjustWater.mockReturnValue(never());
    const tree = await renderScreen();

    const before = mockSetSnapshot.mock.calls.length;
    await act(async () => {
      pressByTestId(tree, 'health-water-plus');
    });

    expect(mockAdjustWater).toHaveBeenCalledWith(1);
    // The opposite trade-off to the note: nothing moves until the write lands,
    // so a slow write reads as a missed tap and the member taps again — which
    // `adjustWater` does honour, because each tap is its own read-modify-write.
    expect(allText(byTestId(tree, 'health-water-cups-count')[0])).toBe('3');
    expect(mockSetSnapshot.mock.calls.length).toBe(before);
  });
});
