/**
 * Symply Health section tabs — Nutrition · Activity · Trends · Body · Habits.
 *
 * Renders the REAL screens through <ThemeProvider> and drives the primary path
 * of each: load → enter → persist → reflect. Only the storage-backed async fns
 * are mocked; the pure helpers stay real (they own their coverage in
 * ../../__tests__/health*Storage.test.ts and healthTrends.test.ts).
 *
 * These five tabs are the donor-parity restoration (Swift `TabItem.defaultTabs`
 * plus its Body/Habits extras) — see src/navigation/__tests__/healthTabShell.test.ts
 * for the bar contract itself.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Alert, Platform } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  addWorkoutEntry,
  deleteWorkoutEntry,
  loadActivityGoals,
  loadStepDays,
  loadStepsForDate,
  loadWorkouts,
  saveActivityGoals,
  setStepsForDate,
  updateWorkoutEntry,
  type ActivityGoals,
  type StepDay,
  type WorkoutEntry,
} from '../../healthActivityStorage';
import {
  addBodyEntry,
  BODY_METRICS,
  deleteBodyEntry,
  loadBodyEntries,
  PRIMARY_BODY_METRICS,
  type BodyEntry,
} from '../../healthBodyStorage';
import { loadChallengeProgressToday } from '../../healthChallengesStorage';
import {
  loadFoods,
  loadFoodSuggestions,
  logFoodToDiary,
  type FoodItem,
  type FoodSuggestion,
  type LogFoodResult,
} from '../../healthFoodStorage';
import {
  addHabit,
  deleteHabit,
  loadHabits,
  toggleHabitToday,
  type Habit,
} from '../../healthHabitsStorage';
import {
  adjustWater,
  loadWaterHistory,
  loadWaterToday,
  loadWeightLog,
  todayDateKey,
  type WaterDay,
  type WeightEntry,
} from '../../healthLocalStorage';
import {
  addMealEntry,
  copyMealEntriesTo,
  copyMealsFromDay,
  deleteMealEntries,
  deleteMealEntry,
  loadMeals,
  loadMealsForDate,
  loadNutritionGoals,
  reportionMealEntry,
  saveNutritionGoals,
  shiftDateKey,
  updateMealEntry,
  type MealEntry,
  type NutritionGoals,
} from '../../healthNutritionStorage';
import { EMPTY_WEIGHT_GOAL, loadWeightGoal } from '../../healthWeightStorage';
import {
  formatAxisDay,
  HealthActivityScreen,
  volumeSeries,
  workoutStreaks,
} from '../HealthActivityScreen';
import { HealthBodyScreen } from '../HealthBodyScreen';
import { HealthHabitsScreen } from '../HealthHabitsScreen';
import { HealthNutritionScreen } from '../HealthNutritionScreen';
import { HealthTrendsScreen } from '../HealthTrendsScreen';

const IPHONE = { width: 393, height: 852, scale: 3, fontScale: 1 };

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
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header', accessibilityLabel: title }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

// react-native-gifted-charts renders through SVG + measurement; the Trends tab
// only needs to prove it hands the right series over.
jest.mock('@components/ui/AppLineChart', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  const actual = jest.requireActual('@components/ui/AppLineChart');
  return {
    // `AppBarChart.tsx` imports both of these real functions from this same
    // module — a stub without them left the chart crashing the moment
    // anything ELSE in this file rendered a real (unmocked) `AppBarChart`,
    // which nothing did until `HealthHabitDetailScreen` landed here.
    collectReferenceLines: actual.collectReferenceLines,
    referenceLineProps: actual.referenceLineProps,
    AppLineChart: ({ data }: { data: Array<{ value: number; label?: string }> }) =>
      ReactMock.createElement(View, {
        testID: 'app-line-chart',
        accessibilityValue: { text: data.map((p) => p.value).join(',') },
        // The axis labels the screen handed over, so a test can prove a thinned
        // axis really drops the labels it says it drops.
        accessibilityHint: data.map((p) => p.label ?? '').join('|'),
      }),
  };
});

// The copy sheets' custom-date field drives a native picker, not a `TextInput`
// — mocked as a passthrough View (mirrors `HealthGoalsScreen.test.tsx`), which
// this suite never needs to open since the day-stepper covers every scenario.
jest.mock('@react-native-community/datetimepicker', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return (props: Record<string, unknown>) =>
    ReactMock.createElement(View, { testID: 'date-time-picker', ...props });
});

jest.mock('../../healthNutritionStorage', () => {
  const actual = jest.requireActual('../../healthNutritionStorage');
  return {
    ...actual,
    loadMeals: jest.fn(),
    loadMealsForDate: jest.fn(),
    loadNutritionGoals: jest.fn(),
    saveNutritionGoals: jest.fn(),
    addMealEntry: jest.fn(),
    updateMealEntry: jest.fn(),
    reportionMealEntry: jest.fn(),
    deleteMealEntry: jest.fn(),
    copyMealsFromDay: jest.fn(),
    copyMealEntriesTo: jest.fn(),
    deleteMealEntries: jest.fn(),
  };
});

// Nutrition's quick add reads the food library; the pure helpers stay real so
// the serving figures on screen are the ones the store would hand over.
jest.mock('../../healthFoodStorage', () => {
  const actual = jest.requireActual('../../healthFoodStorage');
  return {
    ...actual,
    loadFoods: jest.fn(),
    loadFoodSuggestions: jest.fn(),
    logFoodToDiary: jest.fn(),
  };
});

jest.mock('../../healthActivityStorage', () => {
  const actual = jest.requireActual('../../healthActivityStorage');
  return {
    ...actual,
    loadWorkouts: jest.fn(),
    loadStepDays: jest.fn(),
    loadStepsForDate: jest.fn(),
    loadActivityGoals: jest.fn(),
    saveActivityGoals: jest.fn(),
    setStepsForDate: jest.fn(),
    addWorkoutEntry: jest.fn(),
    updateWorkoutEntry: jest.fn(),
    deleteWorkoutEntry: jest.fn(),
  };
});

jest.mock('../../healthBodyStorage', () => {
  const actual = jest.requireActual('../../healthBodyStorage');
  return {
    ...actual,
    loadBodyEntries: jest.fn(),
    addBodyEntry: jest.fn(),
    deleteBodyEntry: jest.fn(),
  };
});

jest.mock('../../healthHabitsStorage', () => {
  const actual = jest.requireActual('../../healthHabitsStorage');
  return {
    ...actual,
    loadHabits: jest.fn(),
    toggleHabitToday: jest.fn(),
    addHabit: jest.fn(),
    deleteHabit: jest.fn(),
  };
});

jest.mock('../../healthLocalStorage', () => {
  const actual = jest.requireActual('../../healthLocalStorage');
  return {
    ...actual,
    loadWeightLog: jest.fn(),
    loadWaterToday: jest.fn(),
    loadWaterHistory: jest.fn(),
    adjustWater: jest.fn(),
  };
});

// Only the goal READ is stubbed — `weightInUnit` stays real, because the point
// of the Trends assertion is the conversion it performs.
jest.mock('../../healthWeightStorage', () => {
  const actual = jest.requireActual('../../healthWeightStorage');
  return {
    ...actual,
    loadWeightGoal: jest.fn(),
  };
});

// `HealthTodayChallengesCard` (mounted inside the real Nutrition screen) pulls
// `useFocusEffect` from `@react-navigation/native` directly — this suite
// renders screens standalone, with no real NavigationContainer, so the real
// hook throws the instant that card mounts. Same inert-callback shim
// `HealthTodayChallengesCard.test.tsx` uses on its own.
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactActual = jest.requireActual('react');
    ReactActual.useEffect(() => callback(), [callback]);
  },
}));

// Defaults to "no challenges" so the 100+ pre-existing Nutrition-screen
// assertions in this file are unaffected; challenge-specific behaviour has
// its own coverage in HealthTodayChallengesCard.test.tsx.
jest.mock('../../healthChallengesStorage', () => {
  const actual = jest.requireActual('../../healthChallengesStorage');
  return {
    ...actual,
    loadChallengeProgressToday: jest.fn(),
  };
});

const mockLoadChallengeProgressToday = loadChallengeProgressToday as jest.Mock;
const mockLoadMeals = loadMeals as jest.Mock;
const mockLoadMealsForDate = loadMealsForDate as jest.Mock;
const mockLoadNutritionGoals = loadNutritionGoals as jest.Mock;
const mockSaveNutritionGoals = saveNutritionGoals as jest.Mock;
const mockAddMealEntry = addMealEntry as jest.Mock;
const mockUpdateMealEntry = updateMealEntry as jest.Mock;
const mockReportionMealEntry = reportionMealEntry as jest.Mock;
const mockDeleteMealEntry = deleteMealEntry as jest.Mock;
const mockCopyMealsFromDay = copyMealsFromDay as jest.Mock;
const mockCopyMealEntriesTo = copyMealEntriesTo as jest.Mock;
const mockDeleteMealEntries = deleteMealEntries as jest.Mock;

const mockLoadFoods = loadFoods as jest.Mock;
const mockLoadFoodSuggestions = loadFoodSuggestions as jest.Mock;
const mockLogFoodToDiary = logFoodToDiary as jest.Mock;

const mockLoadWorkouts = loadWorkouts as jest.Mock;
const mockLoadStepDays = loadStepDays as jest.Mock;
const mockLoadStepsForDate = loadStepsForDate as jest.Mock;
const mockLoadActivityGoals = loadActivityGoals as jest.Mock;
const mockSaveActivityGoals = saveActivityGoals as jest.Mock;
const mockSetStepsForDate = setStepsForDate as jest.Mock;
const mockAddWorkoutEntry = addWorkoutEntry as jest.Mock;
const mockUpdateWorkoutEntry = updateWorkoutEntry as jest.Mock;
const mockDeleteWorkoutEntry = deleteWorkoutEntry as jest.Mock;

const mockLoadBodyEntries = loadBodyEntries as jest.Mock;
const mockAddBodyEntry = addBodyEntry as jest.Mock;
const mockDeleteBodyEntry = deleteBodyEntry as jest.Mock;

const mockLoadHabits = loadHabits as jest.Mock;
const mockToggleHabitToday = toggleHabitToday as jest.Mock;
const mockAddHabit = addHabit as jest.Mock;
const mockDeleteHabit = deleteHabit as jest.Mock;

const mockLoadWeightGoal = loadWeightGoal as jest.Mock;
const mockLoadWeightLog = loadWeightLog as jest.Mock;
const mockLoadWaterToday = loadWaterToday as jest.Mock;
const mockLoadWaterHistory = loadWaterHistory as jest.Mock;
const mockAdjustWater = adjustWater as jest.Mock;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

const goals: NutritionGoals = { calories: 2000, protein: 120, carbs: 220, fat: 65 };
const activityGoals: ActivityGoals = { minutes: 30, steps: 8000 };

function meal(over: Partial<MealEntry> = {}): MealEntry {
  return {
    id: over.id ?? 'm1',
    date: over.date ?? TODAY,
    slot: over.slot ?? 'lunch',
    name: over.name ?? 'Soup',
    calories: over.calories ?? 300,
    protein: over.protein ?? 20,
    carbs: over.carbs ?? 30,
    fat: over.fat ?? 10,
    loggedAt: over.loggedAt ?? '2026-07-13T10:00:00.000Z',
    // 0124 provenance. Spread LAST so `portion` / `unit` / `foodId` /
    // `canReportion` reach the row — the defaults above are hand-picked rather
    // than spread, so a new optional field would otherwise be silently dropped.
    ...over,
  };
}

function food(over: Partial<FoodItem> = {}): FoodItem {
  return {
    id: over.id ?? 'cf_1',
    name: over.name ?? 'Oats',
    brand: over.brand ?? null,
    portion: over.portion ?? 100,
    unit: over.unit ?? 'g',
    serving: over.serving ?? { calories: 380, protein: 13, carbs: 60, fat: 7 },
    isFavorite: over.isFavorite ?? false,
    useCount: over.useCount ?? 0,
    lastUsedAt: over.lastUsedAt ?? null,
    updatedAt: over.updatedAt ?? '2026-07-13T08:00:00.000Z',
  };
}

function suggestion(over: Partial<FoodSuggestion> = {}): FoodSuggestion {
  return {
    food: over.food ?? food(),
    score: over.score ?? 0.9,
    reasons: over.reasons ?? ['time_based_match'],
  };
}

function logResult(over: Partial<LogFoodResult> = {}): LogFoodResult {
  return {
    foods: over.foods ?? [],
    status: over.status ?? 'saved',
    message: over.message ?? null,
    logged: over.logged ?? { calories: 380, protein: 13, carbs: 60, fat: 7 },
    mealSlot: over.mealSlot ?? 'breakfast',
  };
}

function workout(over: Partial<WorkoutEntry> = {}): WorkoutEntry {
  return {
    id: over.id ?? 'w1',
    date: over.date ?? TODAY,
    type: over.type ?? 'run',
    minutes: over.minutes ?? 40,
    calories: over.calories ?? 300,
    intensity: over.intensity ?? 'steady',
    // `null` by default, matching the type. Leaving `distanceM` as JS
    // `undefined` broke `HealthActivityScreen`'s edit form: `handleEdit`
    // checks `entry.distanceM === null` to decide the distance field is
    // blank, so an `undefined` fell through to `metresToDisplay(undefined,
    // …)` — producing a value the submit's distance guard then silently
    // rejected, aborting the whole edit with NO call to the mocked store.
    distanceM: over.distanceM ?? null,
    startedAt: over.startedAt ?? null,
    note: over.note ?? '',
    loggedAt: over.loggedAt ?? '2026-07-13T10:00:00.000Z',
  };
}

function bodyEntry(over: Partial<BodyEntry> = {}): BodyEntry {
  return {
    id: over.id ?? 'b1',
    date: over.date ?? TODAY,
    metric: over.metric ?? 'waist',
    value: over.value ?? 80,
    unit: over.unit ?? 'cm',
    loggedAt: over.loggedAt ?? '2026-07-13T10:00:00.000Z',
  };
}

function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: over.id ?? 'sleep',
    name: over.name ?? 'Sleep 7+ hours',
    icon: over.icon ?? 'sleep-habit',
    category: over.category ?? 'custom',
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

function water(over: Partial<WaterDay> = {}): WaterDay {
  return { date: over.date ?? TODAY, cups: over.cups ?? 3, target: over.target ?? 8 };
}

function weightEntry(loggedAt: string, value: number, unit: WeightEntry['unit'] = 'kg'): WeightEntry {
  return {
    id: loggedAt,
    value,
    unit,
    loggedAt,
    date: loggedAt.slice(0, 10),
    note: '',
    source: 'manual',
  };
}

/** `count` consecutive step days ending TODAY, newest first (store order). */
function stepDaysBack(count: number): StepDay[] {
  return Array.from({ length: count }, (_, i) => ({
    date: shiftDateKey(TODAY, -i),
    steps: 6000 + i * 10,
  }));
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

/** Fire onPress on the composite carrying `testID` (Pressable, not its host View). */
function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function',
  );
  act(() => node.props.onPress());
}

function input(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID,
  );
}

function type(tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) {
  act(() => input(tree, testID).props.onChangeText(text));
}

/**
 * A meal row's edit/move/delete now live behind one "more" button instead of
 * three permanently-visible icons. This opens the menu and presses one of the
 * three actions in a single step, mirroring how a user actually gets there.
 */
function chooseRowAction(
  tree: ReactTestRenderer.ReactTestRenderer,
  id: string,
  action: 'edit' | 'move' | 'delete',
) {
  act(() => press(tree, `health-meal-more-${id}`));
  act(() => press(tree, `health-meal-menu-${action}-${id}`));
}

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);

  mockLoadChallengeProgressToday.mockResolvedValue(null);
  mockLoadMeals.mockResolvedValue([]);
  mockLoadMealsForDate.mockResolvedValue([]);
  mockLoadNutritionGoals.mockResolvedValue(goals);
  mockSaveNutritionGoals.mockResolvedValue(goals);
  mockAddMealEntry.mockResolvedValue([]);
  mockUpdateMealEntry.mockResolvedValue([]);
  mockReportionMealEntry.mockResolvedValue({ entries: [], status: 'saved' });
  mockDeleteMealEntry.mockResolvedValue([]);
  mockCopyMealsFromDay.mockResolvedValue({
    entries: [],
    copied: 0,
    status: 'copied',
    message: null,
  });
  mockCopyMealEntriesTo.mockResolvedValue({
    entries: [],
    copied: 0,
    status: 'copied',
    message: null,
  });
  mockDeleteMealEntries.mockResolvedValue({
    entries: [],
    deleted: 0,
    failed: 0,
    status: 'deleted',
    message: null,
  });

  mockLoadFoods.mockResolvedValue([]);
  mockLoadFoodSuggestions.mockResolvedValue(null);
  mockLogFoodToDiary.mockResolvedValue(logResult());

  mockLoadWorkouts.mockResolvedValue([]);
  mockLoadStepDays.mockResolvedValue([]);
  mockLoadStepsForDate.mockResolvedValue(0);
  mockLoadActivityGoals.mockResolvedValue(activityGoals);
  mockSaveActivityGoals.mockResolvedValue(activityGoals);
  mockSetStepsForDate.mockResolvedValue([]);
  mockAddWorkoutEntry.mockResolvedValue([]);
  mockUpdateWorkoutEntry.mockResolvedValue([]);
  mockDeleteWorkoutEntry.mockResolvedValue([]);

  mockLoadBodyEntries.mockResolvedValue([]);
  mockAddBodyEntry.mockResolvedValue([]);
  mockDeleteBodyEntry.mockResolvedValue([]);

  mockLoadHabits.mockResolvedValue([]);
  mockToggleHabitToday.mockResolvedValue([]);
  mockAddHabit.mockResolvedValue([]);
  mockDeleteHabit.mockResolvedValue([]);

  mockLoadWeightGoal.mockResolvedValue(EMPTY_WEIGHT_GOAL);
  mockLoadWeightLog.mockResolvedValue([]);
  mockLoadWaterToday.mockResolvedValue(water({ cups: 0 }));
  mockLoadWaterHistory.mockResolvedValue([]);
  mockAdjustWater.mockResolvedValue(water({ cups: 1 }));

  expect(IPHONE.width).toBe(393); // the mocked window this suite renders at
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Nutrition                                                           */
/* ------------------------------------------------------------------ */

describe('HealthNutritionScreen', () => {
  it('HEALTH-NUTR-050: renders the diary shell with all four meal groups', async () => {
    const tree = await render(<HealthNutritionScreen />);

    expect(byTestId(tree, 'health-nutrition-screen').length).toBe(1);
    expect(byTestId(tree, 'health-nutrition-screen-scroll-end').length).toBe(1);
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snacks']) {
      expect(byTestId(tree, `health-meal-group-${slot}`).length).toBe(1);
    }
    expect(allText(tree.toJSON())).toContain('CALORIES');
  });

  it('HEALTH-NUTR-051: totals the day and shows what is left against the goal', async () => {
    mockLoadMealsForDate.mockResolvedValue([
      meal({ id: 'a', calories: 300, protein: 20 }),
      meal({ id: 'b', slot: 'dinner', calories: 500, protein: 30 }),
    ]);
    const tree = await render(<HealthNutritionScreen />);

    expect(allText(byTestId(tree, 'health-nutrition-total-kcal')[0])).toBe('800');
    // 2000 goal − 800 logged.
    expect(allText(tree.toJSON())).toContain('1200 kcal');
    expect(allText(byTestId(tree, 'health-meal-group-dinner-total')[0])).toContain('500 kcal');
  });

  it('HEALTH-NUTR-052: adding food persists the slot + macros, then clears the form', async () => {
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-add-food-mode-manual');
    press(tree, 'health-meal-slot-dinner');
    type(tree, 'health-meal-name-input', 'Chicken bowl');
    type(tree, 'health-meal-calories-input', '620');
    type(tree, 'health-meal-protein-input', '45');
    type(tree, 'health-meal-carbs-input', '60');
    type(tree, 'health-meal-fat-input', '18');
    await act(async () => press(tree, 'health-meal-add-button'));

    expect(mockAddMealEntry).toHaveBeenCalledWith({
      name: 'Chicken bowl',
      slot: 'dinner',
      calories: 620,
      protein: 45,
      carbs: 60,
      fat: 18,
      date: TODAY,
    });
    expect(input(tree, 'health-meal-name-input').props.value).toBe('');
    expect(input(tree, 'health-meal-calories-input').props.value).toBe('');
  });

  it('HEALTH-NUTR-053: the add button stays inert without a calorie value', async () => {
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-add-food-mode-manual');
    type(tree, 'health-meal-name-input', 'Just a name');
    await act(async () => press(tree, 'health-meal-add-button'));
    expect(mockAddMealEntry).not.toHaveBeenCalled();

    const button = byTestId(tree, 'health-meal-add-button')[0];
    expect(button.props.accessibilityState).toEqual({ disabled: true });
  });

  it('HEALTH-NUTR-054: deleting an item removes it through the store', async () => {
    mockLoadMealsForDate.mockResolvedValue([meal({ id: 'gone' })]);
    const tree = await render(<HealthNutritionScreen />);

    chooseRowAction(tree, 'gone', 'delete');
    expect(mockDeleteMealEntry).toHaveBeenCalledWith('gone', TODAY);
  });

  it('HEALTH-NUTR-055: stepping to yesterday reloads that day and disables "next" on today', async () => {
    const tree = await render(<HealthNutritionScreen />);

    expect(allText(byTestId(tree, 'health-nutrition-day-label')[0])).toBe('Today');
    expect(byTestId(tree, 'health-nutrition-next-day')[0].props.accessibilityState).toEqual({
      disabled: true,
    });

    await act(async () => press(tree, 'health-nutrition-prev-day'));
    expect(allText(byTestId(tree, 'health-nutrition-day-label')[0])).toBe('Yesterday');
    expect(mockLoadMealsForDate).toHaveBeenLastCalledWith('2026-07-12');

    await act(async () => press(tree, 'health-nutrition-next-day'));
    expect(allText(byTestId(tree, 'health-nutrition-day-label')[0])).toBe('Today');
  });

  it('HEALTH-NUTR-056: hydration is only offered on today, and writes the shared water store', async () => {
    const tree = await render(<HealthNutritionScreen />);
    expect(byTestId(tree, 'health-nutrition-water-plus').length).toBe(1);

    await act(async () => press(tree, 'health-nutrition-water-plus'));
    expect(mockAdjustWater).toHaveBeenCalledWith(1);

    // Past days have no "today" counter to adjust.
    await act(async () => press(tree, 'health-nutrition-prev-day'));
    expect(byTestId(tree, 'health-nutrition-water-plus').length).toBe(0);
  });

  it('HEALTH-NUTR-057: the goal picker writes the chosen calorie target', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSaveNutritionGoals.mockResolvedValue({ ...goals, calories: 1800 });
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-nutrition-goal-button');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => buttons.find((b) => b.text === '1800 kcal')?.onPress?.());

    expect(mockSaveNutritionGoals).toHaveBeenCalledWith({ calories: 1800 });
    alertSpy.mockRestore();
  });

  it('HEALTH-NUTR-058: a past day offers a one-tap way back to today', async () => {
    const tree = await render(<HealthNutritionScreen />);
    expect(byTestId(tree, 'health-nutrition-today-button').length).toBe(0);

    await act(async () => press(tree, 'health-nutrition-prev-day'));
    expect(byTestId(tree, 'health-nutrition-today-button').length).toBe(1);

    await act(async () => press(tree, 'health-nutrition-today-button'));
    expect(allText(byTestId(tree, 'health-nutrition-day-label')[0])).toBe('Today');
    expect(mockLoadMealsForDate).toHaveBeenLastCalledWith(TODAY);
  });

  it('HEALTH-NUTR-059: past the goal the day reports how far OVER, not a negative remainder', async () => {
    mockLoadMealsForDate.mockResolvedValue([meal({ calories: 2300 })]);
    const tree = await render(<HealthNutritionScreen />);

    expect(allText(byTestId(tree, 'health-nutrition-balance')[0])).toBe('300 over');
    expect(byTestId(tree, 'health-nutrition-remaining-tile')[0].props.accessibilityLabel).toBe(
      'Over: 300 kcal',
    );
  });

  it('HEALTH-NUTR-060: a slot with food opens itself; an empty one waits to be asked', async () => {
    mockLoadMealsForDate.mockResolvedValue([meal({ id: 'a', slot: 'lunch' })]);
    const tree = await render(<HealthNutritionScreen />);

    expect(allText(byTestId(tree, 'health-meal-group-lunch-count')[0])).toBe('1 item');
    expect(byTestId(tree, 'health-meal-more-a').length).toBe(1);
    // Empty slots stay shut rather than stacking four "nothing here" panels.
    expect(byTestId(tree, 'health-meal-detail-dinner').length).toBe(0);

    act(() => press(tree, 'health-meal-group-lunch-toggle'));
    expect(byTestId(tree, 'health-meal-more-a').length).toBe(0);

    act(() => press(tree, 'health-meal-group-dinner-toggle'));
    expect(byTestId(tree, 'health-meal-detail-dinner-empty').length).toBe(1);
  });

  it('HEALTH-NUTR-061: a day with nothing on it says so', async () => {
    const tree = await render(<HealthNutritionScreen />);
    expect(byTestId(tree, 'health-nutrition-empty').length).toBe(1);

    mockLoadMealsForDate.mockResolvedValue([meal()]);
    const withFood = await render(<HealthNutritionScreen />);
    expect(byTestId(withFood, 'health-nutrition-empty').length).toBe(0);
  });

  it('HEALTH-NUTR-062: editing an item UPDATES it in place — no add-then-delete', async () => {
    mockLoadMealsForDate.mockResolvedValue([
      meal({ id: 'a', slot: 'lunch', name: 'Soup', calories: 300 }),
    ]);
    const tree = await render(<HealthNutritionScreen />);

    chooseRowAction(tree, 'a', 'edit');
    type(tree, 'health-meal-edit-calories-a', '420');
    await act(async () => press(tree, 'health-meal-edit-save-a'));

    // The screen used to add the replacement and delete the original, because
    // the client had no update method — which minted a new row id and reset
    // `loggedAt`, moving the item to the end of its slot.
    expect(mockUpdateMealEntry).toHaveBeenCalledWith(
      'a',
      { name: 'Soup', calories: 420, protein: 20, carbs: 30, fat: 10 },
      TODAY,
    );
    expect(mockAddMealEntry).not.toHaveBeenCalled();
    expect(mockDeleteMealEntry).not.toHaveBeenCalled();
  });

  it('HEALTH-NUTR-063: moving an item is the same update with a different slot', async () => {
    mockLoadMealsForDate.mockResolvedValue([
      meal({ id: 'a', slot: 'lunch', name: 'Soup', calories: 300 }),
    ]);
    const tree = await render(<HealthNutritionScreen />);

    chooseRowAction(tree, 'a', 'move');
    await act(async () => press(tree, 'health-meal-move-a-dinner'));

    // Only the slot moves, so only the slot is sent — resending the macros
    // would risk overwriting a figure another device had just corrected.
    expect(mockUpdateMealEntry).toHaveBeenCalledWith('a', { slot: 'dinner' }, TODAY);
    expect(mockAddMealEntry).not.toHaveBeenCalled();
    expect(mockDeleteMealEntry).not.toHaveBeenCalled();
  });

  it('HEALTH-NUTR-127: a re-portionable row gets a Rescale control that asks the SERVER', async () => {
    mockLoadMealsForDate.mockResolvedValue([
      meal({
        id: 'a',
        slot: 'lunch',
        name: 'Rice',
        calories: 200,
        portion: 100,
        unit: 'g',
        canReportion: true,
      }),
    ]);
    const tree = await render(<HealthNutritionScreen />);

    chooseRowAction(tree, 'a', 'edit');
    type(tree, 'health-meal-portion-a', '250');
    await act(async () => press(tree, 'health-meal-portion-apply-a'));

    // The new macros are the Worker's to derive from `base_*_per_100`; the
    // screen sends a portion and renders the answer.
    expect(mockReportionMealEntry).toHaveBeenCalledWith('a', 250, TODAY);
    expect(mockUpdateMealEntry).not.toHaveBeenCalled();
  });

  it('HEALTH-NUTR-128: a row with no basis gets no Rescale control at all', async () => {
    mockLoadMealsForDate.mockResolvedValue([
      meal({ id: 'a', slot: 'lunch', name: 'Soup', calories: 300, canReportion: false }),
    ]);
    const tree = await render(<HealthNutritionScreen />);

    chooseRowAction(tree, 'a', 'edit');

    // Offering a control that can only ever 400 `no_basis` is worse than not
    // offering it — the typed editor is the honest path for a hand-typed row.
    expect(byTestId(tree, 'health-meal-portion-a').length).toBe(0);
    expect(byTestId(tree, 'health-meal-portion-apply-a').length).toBe(0);
    expect(byTestId(tree, 'health-meal-edit-calories-a').length).toBe(1);
  });

  it('HEALTH-NUTR-129: a refused rescale explains itself instead of failing silently', async () => {
    mockLoadMealsForDate.mockResolvedValue([
      meal({ id: 'a', slot: 'lunch', name: 'Rice', portion: 100, unit: 'g', canReportion: true }),
    ]);
    mockReportionMealEntry.mockResolvedValue({ entries: [], status: 'no-basis' });
    const tree = await render(<HealthNutritionScreen />);

    chooseRowAction(tree, 'a', 'edit');
    type(tree, 'health-meal-portion-a', '250');
    await act(async () => press(tree, 'health-meal-portion-apply-a'));

    // Friendly copy, never the server's own error string.
    expect(allText(byTestId(tree, 'health-nutrition-banner')[0])).toContain(
      'no per-portion basis',
    );
  });

  it('HEALTH-NUTR-064: quick add sends the portion and lets the SERVER derive the serving', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', isFavorite: true })]);
    const tree = await render(<HealthNutritionScreen />);

    act(() => press(tree, 'health-quick-add-tab-favorites'));
    act(() => press(tree, 'health-quick-add-food-cf_1'));
    type(tree, 'health-quick-add-portion-cf_1', '250');
    await act(async () => press(tree, 'health-quick-add-log-cf_1'));

    // The portion goes to /custom-foods/:id/use; nothing is multiplied here.
    expect(mockLogFoodToDiary).toHaveBeenCalledWith('cf_1', {
      mealSlot: 'breakfast',
      portion: 250,
      date: TODAY,
    });
    expect(mockAddMealEntry).not.toHaveBeenCalled();
  });

  it('HEALTH-NUTR-065: a refused quick add explains itself without a raw error string', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', isFavorite: true })]);
    mockLogFoodToDiary.mockResolvedValue(
      logResult({ status: 'rejected', message: 'That food is no longer in your library.' }),
    );
    const tree = await render(<HealthNutritionScreen />);

    act(() => press(tree, 'health-quick-add-tab-favorites'));
    act(() => press(tree, 'health-quick-add-food-cf_1'));
    await act(async () => press(tree, 'health-quick-add-log-cf_1'));

    const banner = allText(byTestId(tree, 'health-nutrition-banner')[0]);
    expect(banner).toContain('no longer in your library');
    expect(banner).not.toMatch(/Error|undefined|\[object/);

    act(() => press(tree, 'health-nutrition-banner-dismiss'));
    expect(byTestId(tree, 'health-nutrition-banner').length).toBe(0);
  });

  it('HEALTH-NUTR-066: suggestions are re-asked whenever the target slot changes', async () => {
    const tree = await render(<HealthNutritionScreen />);
    expect(mockLoadFoodSuggestions).toHaveBeenLastCalledWith('breakfast');

    await act(async () => press(tree, 'health-meal-slot-dinner'));
    expect(mockLoadFoodSuggestions).toHaveBeenLastCalledWith('dinner');
  });

  it('HEALTH-NUTR-067: an unanswered suggestions call degrades to copy, never a blank tab', async () => {
    mockLoadFoodSuggestions.mockResolvedValue(null);
    const tree = await render(<HealthNutritionScreen />);

    expect(allText(byTestId(tree, 'health-quick-add-empty')[0])).toContain('need a connection');
  });

  it('HEALTH-NUTR-068: a scored suggestion is offered with the reason the server gave', async () => {
    mockLoadFoodSuggestions.mockResolvedValue({
      timeOfDay: 'morning',
      mealSlot: 'breakfast',
      suggestions: [suggestion({ reasons: ['favorite'] })],
    });
    const tree = await render(<HealthNutritionScreen />);

    expect(allText(byTestId(tree, 'health-quick-add-reason-cf_1')[0])).toBe('Favourite');
    expect(allText(byTestId(tree, 'health-quick-add-row-cf_1')[0])).toContain('380 kcal per 100 g');
  });

  it('HEALTH-NUTR-069: favourites and recents are split out of the one library read', async () => {
    mockLoadFoods.mockResolvedValue([
      food({ id: 'fav', name: 'Oats', isFavorite: true }),
      food({ id: 'rec', name: 'Rice', lastUsedAt: '2026-07-13T09:00:00.000Z' }),
    ]);
    const tree = await render(<HealthNutritionScreen />);

    act(() => press(tree, 'health-quick-add-tab-favorites'));
    expect(byTestId(tree, 'health-quick-add-row-fav').length).toBe(1);
    expect(byTestId(tree, 'health-quick-add-row-rec').length).toBe(0);

    act(() => press(tree, 'health-quick-add-tab-recent'));
    expect(byTestId(tree, 'health-quick-add-row-rec').length).toBe(1);
    expect(byTestId(tree, 'health-quick-add-row-fav').length).toBe(0);
  });

  it('HEALTH-NUTR-110: calories-only quick add writes a bare entry to the chosen slot', async () => {
    const tree = await render(<HealthNutritionScreen />);

    act(() => press(tree, 'health-meal-slot-dinner'));
    type(tree, 'health-quick-add-calories-name', 'Canteen lunch');
    type(tree, 'health-quick-add-calories-input', '540');
    await act(async () => press(tree, 'health-quick-add-calories-button'));

    expect(mockAddMealEntry).toHaveBeenCalledWith({
      name: 'Canteen lunch',
      slot: 'dinner',
      calories: 540,
      date: TODAY,
    });
  });

  it('HEALTH-NUTR-111: the macro split reflects the day, and sums to exactly 100', async () => {
    mockLoadMealsForDate.mockResolvedValue([
      meal({ id: 'a', calories: 400, protein: 40, carbs: 40, fat: 20 }),
    ]);
    const tree = await render(<HealthNutritionScreen />);

    expect(byTestId(tree, 'health-macro-breakdown-bar')[0].props.accessibilityLabel).toBe(
      'Macro split: Protein 40%, Carbs 40%, Fat 20%',
    );
  });

  /* -------------- copy + multi-select (copy-day, bulk, batch delete) ------ */

  it('HEALTH-NUTR-160: a shortcut chip sends this meal straight to tomorrow’s lunch', async () => {
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-meal-group-dinner-copy');
    await act(async () =>
      press(tree, 'health-meal-copy-to-dinner-shortcut-tomorrow-lunch')
    );

    expect(mockCopyMealsFromDay).toHaveBeenCalledWith(
      { fromDate: TODAY, toDate: '2026-07-14', fromSlot: 'dinner', toSlot: 'lunch' },
      TODAY,
    );
    expect(mockCopyMealEntriesTo).not.toHaveBeenCalled();
  });

  it('HEALTH-NUTR-161: the other shortcut sends this meal to today’s dinner', async () => {
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-meal-group-breakfast-copy');
    await act(async () =>
      press(tree, 'health-meal-copy-to-breakfast-shortcut-today-dinner')
    );

    expect(mockCopyMealsFromDay).toHaveBeenCalledWith(
      { fromDate: TODAY, toDate: TODAY, fromSlot: 'breakfast', toSlot: 'dinner' },
      TODAY,
    );
  });

  it('HEALTH-NUTR-162: a custom destination is a day stepper and a meal chip away', async () => {
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-meal-group-breakfast-copy');
    // The sheet already defaults one day ahead, so a single tap lands two days out.
    press(tree, 'health-meal-copy-to-breakfast-to-next');
    press(tree, 'health-meal-copy-to-breakfast-to-slot-lunch');
    await act(async () => press(tree, 'health-meal-copy-to-breakfast-confirm'));

    expect(mockCopyMealsFromDay).toHaveBeenCalledWith(
      { fromDate: TODAY, toDate: '2026-07-15', fromSlot: 'breakfast', toSlot: 'lunch' },
      TODAY,
    );
  });

  it('HEALTH-NUTR-163: pushing an empty meal reports there was nothing to send', async () => {
    mockCopyMealsFromDay.mockResolvedValue({
      entries: [],
      copied: 0,
      status: 'nothing-to-copy',
      message: 'Nothing logged for breakfast on Today.',
    });
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-meal-group-breakfast-copy');
    await act(async () =>
      press(tree, 'health-meal-copy-to-breakfast-shortcut-today-dinner')
    );

    expect(allText(byTestId(tree, 'health-nutrition-banner')[0])).toContain(
      'Nothing logged for breakfast',
    );
    // Still open, so a different destination can be tried.
    expect(byTestId(tree, 'health-meal-copy-to-breakfast-body').length).toBe(1);
  });

  it('HEALTH-NUTR-164: the Add Food card pulls another meal in — a source day and meal, or the whole day', async () => {
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-nutrition-copy-meal-toggle');
    // Opens on yesterday, into the meal the Add Food card is set to (breakfast).
    expect(allText(byTestId(tree, 'health-nutrition-copy-meal-from-label')[0])).toContain(
      'Yesterday',
    );
    press(tree, 'health-nutrition-copy-meal-source-whole-day');
    await act(async () => press(tree, 'health-nutrition-copy-meal-confirm'));

    const sent = mockCopyMealsFromDay.mock.calls[0][0];
    expect(sent).toEqual({ fromDate: '2026-07-12', toDate: TODAY, toSlot: 'breakfast' });
    expect(mockCopyMealEntriesTo).not.toHaveBeenCalled();
  });

  it('HEALTH-NUTR-165: selecting rows swaps the per-row actions for tick boxes', async () => {
    mockLoadMealsForDate.mockResolvedValue([
      meal({ id: 'a', slot: 'lunch', name: 'Soup' }),
      meal({ id: 'b', slot: 'lunch', name: 'Bread' }),
    ]);
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-meal-group-lunch-select');

    expect(byTestId(tree, 'health-meal-select-a').length).toBe(1);
    // The donor suppresses the per-row context menu while selecting; a live
    // "more" button on one row is how the wrong thing gets edited or deleted.
    expect(byTestId(tree, 'health-meal-more-a').length).toBe(0);
    expect(allText(byTestId(tree, 'health-meal-selection-lunch')[0])).toContain('Nothing selected');
  });

  it('HEALTH-NUTR-166: a batch delete confirms first, then removes exactly the ticked rows', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadMealsForDate.mockResolvedValue([
      meal({ id: 'a', slot: 'lunch', name: 'Soup' }),
      meal({ id: 'b', slot: 'lunch', name: 'Bread' }),
    ]);
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-meal-group-lunch-select');
    press(tree, 'health-meal-select-a');
    press(tree, 'health-meal-select-b');
    press(tree, 'health-meal-select-b'); // untick — only 'a' survives
    press(tree, 'health-meal-selection-lunch-delete');

    // Singularised properly, unlike the donor's "Delete 1 Items".
    expect(alertSpy.mock.calls[0][0]).toBe('Delete 1 item');
    expect(mockDeleteMealEntries).not.toHaveBeenCalled();

    const confirm = (alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>)
      .find((button) => button.text === 'Delete');
    await act(async () => confirm?.onPress?.());

    expect(mockDeleteMealEntries).toHaveBeenCalledWith(['a'], TODAY);
    alertSpy.mockRestore();
  });

  it('HEALTH-NUTR-167: a PARTIAL batch delete reports the split and re-ticks the survivors', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadMealsForDate.mockResolvedValue([
      meal({ id: 'a', slot: 'lunch', name: 'Soup' }),
      meal({ id: 'b', slot: 'lunch', name: 'Bread' }),
    ]);
    mockDeleteMealEntries.mockResolvedValue({
      entries: [meal({ id: 'b', slot: 'lunch', name: 'Bread' })],
      deleted: 1,
      failed: 1,
      status: 'partial',
      message: 'Removed 1 of 2. 1 item is still there — try again.',
    });
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-meal-group-lunch-select');
    press(tree, 'health-meal-select-a');
    press(tree, 'health-meal-select-b');
    press(tree, 'health-meal-selection-lunch-delete');
    const confirm = (alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>)
      .find((button) => button.text === 'Delete');
    await act(async () => confirm?.onPress?.());

    // The donor showed one generic alert AND skipped its reload, so the rows it
    // had deleted stayed on screen. Here the split is named and selection mode
    // stays open with exactly the un-deleted row still ticked.
    expect(allText(byTestId(tree, 'health-nutrition-banner')[0])).toContain('Removed 1 of 2');
    expect(byTestId(tree, 'health-meal-selection-lunch').length).toBe(1);
    expect(allText(byTestId(tree, 'health-meal-selection-lunch')[0])).toContain('1 item selected');
    alertSpy.mockRestore();
  });

  it('HEALTH-NUTR-168: copying a selection sends those rows to the chosen day and meal', async () => {
    mockLoadMealsForDate.mockResolvedValue([
      meal({ id: 'a', slot: 'lunch', name: 'Soup' }),
      meal({ id: 'b', slot: 'lunch', name: 'Bread' }),
    ]);
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-meal-group-lunch-select');
    press(tree, 'health-meal-select-a');
    press(tree, 'health-meal-selection-lunch-copy');
    press(tree, 'health-meal-selection-lunch-copy-slot-dinner');
    await act(async () => press(tree, 'health-meal-selection-lunch-copy-confirm'));

    expect(mockCopyMealEntriesTo).toHaveBeenCalledWith(
      { entries: [expect.objectContaining({ id: 'a' })], toDate: TODAY, toSlot: 'dinner' },
      TODAY,
    );
  });

  it('HEALTH-NUTR-169: stepping to another day drops any open panel and selection', async () => {
    mockLoadMealsForDate.mockResolvedValue([meal({ id: 'a', slot: 'lunch', name: 'Soup' })]);
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-meal-group-lunch-select');
    press(tree, 'health-meal-select-a');
    await act(async () => press(tree, 'health-nutrition-prev-day'));

    // A selection carried across a day change would offer to delete rows the
    // user can no longer see.
    expect(byTestId(tree, 'health-meal-selection-lunch').length).toBe(0);
    expect(byTestId(tree, 'health-meal-select-a').length).toBe(0);
  });

  /* -------------- panels close, steppers step, sources are bounded ------- */

  it('HEALTH-NUTR-180: "Copy meal" opens a sheet, closed by its own button without sending anything', async () => {
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-nutrition-copy-meal-toggle');
    expect(byTestId(tree, 'health-nutrition-copy-meal-body').length).toBe(1);

    press(tree, 'bottom-sheet-close');
    expect(byTestId(tree, 'health-nutrition-copy-meal-body').length).toBe(0);
    expect(mockCopyMealsFromDay).not.toHaveBeenCalled();
  });

  it('HEALTH-NUTR-181: the pull sheet steps its source day back, and copies THAT day', async () => {
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-nutrition-copy-meal-toggle');
    expect(allText(byTestId(tree, 'health-nutrition-copy-meal-from-label')[0])).toContain(
      'Yesterday',
    );

    press(tree, 'health-nutrition-copy-meal-from-prev');
    expect(allText(byTestId(tree, 'health-nutrition-copy-meal-from-label')[0])).toContain(
      '2026-07-11',
    );
    await act(async () => press(tree, 'health-nutrition-copy-meal-confirm'));

    expect(mockCopyMealsFromDay).toHaveBeenCalledWith(
      { fromDate: '2026-07-11', toDate: TODAY, fromSlot: 'breakfast', toSlot: 'breakfast' },
      TODAY,
    );

    // Closing is a separate verb from copying: the sheet has to be dismissable
    // without sending anything.
    press(tree, 'health-nutrition-copy-meal-toggle');
    press(tree, 'bottom-sheet-close');
    expect(byTestId(tree, 'health-nutrition-copy-meal-body').length).toBe(0);
    expect(mockCopyMealsFromDay).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-NUTR-182: Select is a toggle — "Done" gives the per-row actions back', async () => {
    mockLoadMealsForDate.mockResolvedValue([meal({ id: 'a', slot: 'lunch' })]);
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-meal-group-lunch-select');
    expect(byTestId(tree, 'health-meal-selection-lunch').length).toBe(1);
    expect(byTestId(tree, 'health-meal-more-a').length).toBe(0);

    press(tree, 'health-meal-group-lunch-select');
    expect(byTestId(tree, 'health-meal-selection-lunch').length).toBe(0);
    expect(byTestId(tree, 'health-meal-more-a').length).toBe(1);
  });

  it('HEALTH-NUTR-183: a selection copies onto ANOTHER day, stepped in both directions', async () => {
    mockLoadMealsForDate.mockResolvedValue([meal({ id: 'a', slot: 'lunch', name: 'Soup' })]);
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-meal-group-lunch-select');
    press(tree, 'health-meal-select-a');
    press(tree, 'health-meal-selection-lunch-copy');

    // The target opens on the day the selection lives on, so "copy" is refused
    // until the day or the meal actually moves.
    expect(
      byTestId(tree, 'health-meal-selection-lunch-copy-confirm')[0].props.accessibilityState,
    ).toEqual({ disabled: true });

    press(tree, 'health-meal-selection-lunch-copy-prev');
    press(tree, 'health-meal-selection-lunch-copy-prev');
    press(tree, 'health-meal-selection-lunch-copy-next');
    expect(allText(byTestId(tree, 'health-meal-selection-lunch-copy-to-label')[0])).toContain(
      'Yesterday',
    );

    await act(async () => press(tree, 'health-meal-selection-lunch-copy-confirm'));
    expect(mockCopyMealEntriesTo).toHaveBeenCalledWith(
      { entries: [expect.objectContaining({ id: 'a' })], toDate: '2026-07-12', toSlot: 'lunch' },
      TODAY,
    );
  });

  it('HEALTH-NUTR-184: the pull sheet’s source stepper stops a year back', async () => {
    const tree = await render(<HealthNutritionScreen />);

    // The bound is a year back from TODAY, and nothing in the UI steps a whole
    // year in one go — so it is reached here by the day on screen ageing past
    // it rather than by 365 taps. Either way the sheet must refuse to walk
    // further into a diary that does not exist.
    jest.setSystemTime(new Date(2027, 9, 1, 12, 0, 0));
    press(tree, 'health-nutrition-copy-meal-toggle');

    expect(
      byTestId(tree, 'health-nutrition-copy-meal-from-prev')[0].props.accessibilityState,
    ).toEqual({ disabled: true });
    // Forward is still open — the bound is only on the past.
    expect(
      byTestId(tree, 'health-nutrition-copy-meal-from-next')[0].props.accessibilityState,
    ).toEqual({ disabled: false });
  });

  /* -------------- refusals and writes that never land -------------------- */

  it('HEALTH-NUTR-185: a macro that is not a number is refused in words, and nothing is sent', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-add-food-mode-manual');
    type(tree, 'health-meal-name-input', 'Porridge');
    type(tree, 'health-meal-calories-input', '300');
    // The field keeps digits and ONE separator, so a lone "." survives
    // sanitising and reaches the parser as NaN.
    type(tree, 'health-meal-protein-input', '.');
    await act(async () => press(tree, 'health-meal-add-button'));

    expect(alertSpy.mock.calls[0][0]).toBe('Check the macros');
    expect(mockAddMealEntry).not.toHaveBeenCalled();
    // Nothing is cleared, so the typo is corrected rather than retyped.
    expect(input(tree, 'health-meal-name-input').props.value).toBe('Porridge');
    expect(input(tree, 'health-meal-calories-input').props.value).toBe('300');
    alertSpy.mockRestore();
  });

  it('HEALTH-NUTR-186: an edit that never reaches the server says so and re-reads the day', async () => {
    mockLoadMealsForDate.mockResolvedValue([
      meal({ id: 'a', slot: 'lunch', name: 'Soup', calories: 300 }),
    ]);
    mockUpdateMealEntry.mockRejectedValue(new Error('Network request failed'));
    const tree = await render(<HealthNutritionScreen />);

    chooseRowAction(tree, 'a', 'edit');
    type(tree, 'health-meal-edit-calories-a', '420');
    await act(async () => press(tree, 'health-meal-edit-save-a'));

    const banner = allText(byTestId(tree, 'health-nutrition-banner')[0]);
    expect(banner).toContain('Check your connection');
    expect(banner).not.toMatch(/Network request failed|Error|undefined/);
    // Re-read, so the row shows what the server still holds rather than the
    // figure that was never accepted.
    expect(mockLoadMealsForDate).toHaveBeenLastCalledWith(TODAY);
    expect(allText(byTestId(tree, 'health-meal-group-lunch-total')[0])).toContain('300 kcal');
  });

  it('HEALTH-NUTR-187: a rescale that fails, and one that never lands, both stay friendly', async () => {
    const rice = meal({
      id: 'a',
      slot: 'lunch',
      name: 'Rice',
      portion: 100,
      unit: 'g',
      canReportion: true,
    });
    mockLoadMealsForDate.mockResolvedValue([rice]);
    mockReportionMealEntry.mockResolvedValue({ entries: [rice], status: 'failed' });
    const tree = await render(<HealthNutritionScreen />);

    chooseRowAction(tree, 'a', 'edit');
    type(tree, 'health-meal-portion-a', '250');
    await act(async () => press(tree, 'health-meal-portion-apply-a'));
    expect(allText(byTestId(tree, 'health-nutrition-banner')[0])).toContain(
      'Check your connection',
    );

    mockReportionMealEntry.mockRejectedValue(new Error('Network request failed'));
    const thrown = await render(<HealthNutritionScreen />);
    chooseRowAction(thrown, 'a', 'edit');
    type(thrown, 'health-meal-portion-a', '250');
    await act(async () => press(thrown, 'health-meal-portion-apply-a'));

    const banner = allText(byTestId(thrown, 'health-nutrition-banner')[0]);
    expect(banner).toContain('Check your connection');
    expect(banner).not.toMatch(/Network request failed/);
    expect(mockLoadMealsForDate).toHaveBeenLastCalledWith(TODAY);
  });

  it('HEALTH-NUTR-188: a copy that never lands keeps the sheet open on the target picked', async () => {
    mockCopyMealsFromDay.mockRejectedValue(new Error('Network request failed'));
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-meal-group-dinner-copy');
    await act(async () => press(tree, 'health-meal-copy-to-dinner-confirm'));

    const banner = allText(byTestId(tree, 'health-nutrition-banner')[0]);
    expect(banner).toContain('Check your connection');
    expect(banner).not.toMatch(/Network request failed/);
    // Open, so "try again" does not start over, and the day is re-read so no
    // phantom copies are left on screen.
    expect(byTestId(tree, 'health-meal-copy-to-dinner-body').length).toBe(1);
    expect(mockLoadMealsForDate).toHaveBeenLastCalledWith(TODAY);
  });

  it('HEALTH-NUTR-189: a selection copy that never lands keeps the ticks to retry with', async () => {
    mockLoadMealsForDate.mockResolvedValue([meal({ id: 'a', slot: 'lunch', name: 'Soup' })]);
    mockCopyMealEntriesTo.mockRejectedValue(new Error('Network request failed'));
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-meal-group-lunch-select');
    press(tree, 'health-meal-select-a');
    press(tree, 'health-meal-selection-lunch-copy');
    press(tree, 'health-meal-selection-lunch-copy-slot-dinner');
    await act(async () => press(tree, 'health-meal-selection-lunch-copy-confirm'));

    expect(allText(byTestId(tree, 'health-nutrition-banner')[0])).toContain(
      'Check your connection',
    );
    expect(allText(byTestId(tree, 'health-meal-selection-lunch')[0])).toContain('1 item selected');
  });

  it('HEALTH-NUTR-190: a batch delete that never lands leaves the rows AND the ticks', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadMealsForDate.mockResolvedValue([meal({ id: 'a', slot: 'lunch', name: 'Soup' })]);
    mockDeleteMealEntries.mockRejectedValue(new Error('Network request failed'));
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-meal-group-lunch-select');
    press(tree, 'health-meal-select-a');
    press(tree, 'health-meal-selection-lunch-delete');
    const confirm = (
      alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>
    ).find((button) => button.text === 'Delete');
    await act(async () => confirm?.onPress?.());

    const banner = allText(byTestId(tree, 'health-nutrition-banner')[0]);
    expect(banner).toContain('Check your connection');
    expect(banner).not.toMatch(/Network request failed/);
    // Selection mode survives, so the same rows can be retried rather than
    // re-found and re-ticked.
    expect(allText(byTestId(tree, 'health-meal-selection-lunch')[0])).toContain('1 item selected');
    alertSpy.mockRestore();
  });

  it('HEALTH-NUTR-191: a quick add that never lands says so and leaves the library alone', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', isFavorite: true })]);
    mockLogFoodToDiary.mockRejectedValue(new Error('Network request failed'));
    const tree = await render(<HealthNutritionScreen />);

    act(() => press(tree, 'health-quick-add-tab-favorites'));
    act(() => press(tree, 'health-quick-add-food-cf_1'));
    await act(async () => press(tree, 'health-quick-add-log-cf_1'));

    const banner = allText(byTestId(tree, 'health-nutrition-banner')[0]);
    expect(banner).toContain('Check your connection');
    expect(banner).not.toMatch(/Network request failed/);
    expect(byTestId(tree, 'health-quick-add-row-cf_1').length).toBe(1);
  });

  it('HEALTH-NUTR-192: a calories-only add that never lands says so, not silence', async () => {
    mockAddMealEntry.mockRejectedValue(new Error('Network request failed'));
    const tree = await render(<HealthNutritionScreen />);

    type(tree, 'health-quick-add-calories-name', 'Canteen lunch');
    type(tree, 'health-quick-add-calories-input', '540');
    await act(async () => press(tree, 'health-quick-add-calories-button'));

    const banner = allText(byTestId(tree, 'health-nutrition-banner')[0]);
    expect(banner).toContain('Check your connection');
    expect(banner).not.toMatch(/Network request failed/);
  });

  /* -------------- boundaries, ordering and the platform keypad ----------- */

  it('HEALTH-NUTR-193: a calorie goal of zero hands the ring 0, not Infinity', async () => {
    mockLoadNutritionGoals.mockResolvedValue({ ...goals, calories: 0 });
    mockLoadMealsForDate.mockResolvedValue([meal({ calories: 300 })]);
    const tree = await render(<HealthNutritionScreen />);

    // 300 / 0 is Infinity. `ProgressRing` happens to floor a non-finite value at
    // zero, but a ring that CLAMPED instead would draw a complete circle —
    // "goal reached" for a goal that was never set — so the screen owes it a
    // real number rather than relying on a shared primitive's guard.
    const ring = tree.root.find(
      (n) => n.props?.testID === 'health-nutrition-ring' && typeof n.props?.progress === 'number',
    );
    expect(ring.props.progress).toBe(0);

    const arc = tree.root.findAll((n) => n.props?.strokeDashoffset !== undefined);
    // A fully offset dash IS an empty ring; offset 0 would be a closed circle.
    const circumference = Number(String(arc[0].props.strokeDasharray).split(' ')[0]);
    expect(arc[0].props.strokeDashoffset).toBe(circumference);
    expect(allText(byTestId(tree, 'health-nutrition-balance')[0])).toBe('300 over');
    expect(allText(tree.toJSON())).not.toContain('NaN');
  });

  it('HEALTH-NUTR-194: recents are newest-first, and a never-used food is not one', async () => {
    mockLoadFoods.mockResolvedValue([
      food({ id: 'mid', name: 'Rice', lastUsedAt: '2026-07-11T09:00:00.000Z' }),
      food({ id: 'new', name: 'Eggs', lastUsedAt: '2026-07-13T09:00:00.000Z' }),
      food({ id: 'old', name: 'Beans', lastUsedAt: '2026-07-02T09:00:00.000Z' }),
      // A row that reached the client WITHOUT the key has still never been
      // used. `lastUsedAt !== null` let `undefined` through and offered it as a
      // recent, sorted to the end by an empty string. (Spread after the builder
      // so the key really is undefined — the builder defaults it to `null`.)
      { ...food({ id: 'never', name: 'Kale' }), lastUsedAt: undefined as unknown as null },
    ]);
    const tree = await render(<HealthNutritionScreen />);

    act(() => press(tree, 'health-quick-add-tab-recent'));
    const rows = tree.root.findAll(
      (n) =>
        typeof n.type === 'string' &&
        typeof n.props?.testID === 'string' &&
        n.props.testID.startsWith('health-quick-add-row-'),
    );
    expect(rows.map((n) => n.props.testID)).toEqual([
      'health-quick-add-row-new',
      'health-quick-add-row-mid',
      'health-quick-add-row-old',
    ]);
  });

  it('HEALTH-NUTR-195: a cup can be taken back off the day, not only added', async () => {
    mockLoadWaterToday.mockResolvedValue(water({ cups: 3 }));
    mockAdjustWater.mockResolvedValue(water({ cups: 2 }));
    const tree = await render(<HealthNutritionScreen />);
    expect(allText(byTestId(tree, 'health-nutrition-water-count')[0])).toBe('3 / 8 cups');

    await act(async () => press(tree, 'health-nutrition-water-minus'));
    expect(mockAdjustWater).toHaveBeenCalledWith(-1);
    expect(allText(byTestId(tree, 'health-nutrition-water-count')[0])).toBe('2 / 8 cups');
  });

  it('HEALTH-NUTR-196: the macro fields ask Android for its numeric keypad', async () => {
    // `decimal-pad` does not exist on Android — asking for it there falls back
    // to a full keyboard, which is what a numeric field is trying to avoid.
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    try {
      const android = await render(<HealthNutritionScreen />);
      press(android, 'health-add-food-mode-manual');
      expect(input(android, 'health-meal-protein-input').props.keyboardType).toBe('numeric');
    } finally {
      Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
    }

    const ios = await render(<HealthNutritionScreen />);
    press(ios, 'health-add-food-mode-manual');
    expect(input(ios, 'health-meal-protein-input').props.keyboardType).toBe('decimal-pad');
  });

  /* -------------- in-flight reads ---------------------------------------- */

  it('HEALTH-NUTR-197: quick add WAITS visibly for the library instead of claiming it is empty', async () => {
    let answerLibrary!: (foods: FoodItem[]) => void;
    mockLoadFoods.mockImplementation(
      () =>
        new Promise<FoodItem[]>((resolve) => {
          answerLibrary = resolve;
        }),
    );
    const tree = await render(<HealthNutritionScreen />);

    // In flight: quick add says so rather than showing its empty copy, which
    // reads as "you have saved no foods" to someone who has saved plenty.
    expect(byTestId(tree, 'health-quick-add-loading').length).toBe(1);
    expect(byTestId(tree, 'health-quick-add-empty').length).toBe(0);

    await act(async () => {
      answerLibrary([food({ id: 'cf_1', isFavorite: true })]);
    });
    expect(byTestId(tree, 'health-quick-add-loading').length).toBe(0);
    act(() => press(tree, 'health-quick-add-tab-favorites'));
    expect(byTestId(tree, 'health-quick-add-row-cf_1').length).toBe(1);

    // Leaving the tab with a read still outstanding tears the screen down
    // cleanly; the effect's cancel flag then drops the answer. (React makes a
    // late `setState` on a dead fiber a silent no-op, so the flag has no
    // symptom of its own here — its sibling in HEALTH-NUTR-198, where the same
    // pattern decides which slot's answer wins, is where it is pinned.)
    const second = await render(<HealthNutritionScreen />);
    act(() => second.unmount());
    await act(async () => {
      answerLibrary([food({ id: 'late' })]);
    });
    expect(second.toJSON()).toBeNull();
  });

  it('HEALTH-NUTR-198: a slow answer for the slot you LEFT never replaces the one you are on', async () => {
    const answers: Array<(value: unknown) => void> = [];
    mockLoadFoodSuggestions.mockImplementation(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    const tree = await render(<HealthNutritionScreen />);
    expect(answers.length).toBe(1); // breakfast, unanswered

    act(() => press(tree, 'health-meal-slot-dinner'));
    expect(answers.length).toBe(2);

    // Dinner answers first, then breakfast — the order a slow connection makes
    // ordinary. Without the effect's cancel flag the stale breakfast list would
    // land last and win.
    await act(async () => {
      answers[1]({
        timeOfDay: 'evening',
        mealSlot: 'dinner',
        suggestions: [suggestion({ food: food({ id: 'steak', name: 'Steak' }) })],
      });
      answers[0]({
        timeOfDay: 'morning',
        mealSlot: 'breakfast',
        suggestions: [suggestion({ food: food({ id: 'oats', name: 'Oats' }) })],
      });
    });

    expect(byTestId(tree, 'health-quick-add-row-steak').length).toBe(1);
    expect(byTestId(tree, 'health-quick-add-row-oats').length).toBe(0);
  });

  /* -------------- the batch verbs honour the status they are given ------- */

  it('HEALTH-NUTR-199: a copy the STORE refuses prints its sentence and keeps the ticks', async () => {
    const soup = meal({ id: 'a', slot: 'lunch', name: 'Soup' });
    mockLoadMealsForDate.mockResolvedValue([soup]);
    mockCopyMealEntriesTo.mockResolvedValue({
      entries: [soup],
      copied: 0,
      status: 'failed',
      message: 'That copy did not go through, so nothing was added. Check your connection.',
    });
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-meal-group-lunch-select');
    press(tree, 'health-meal-select-a');
    press(tree, 'health-meal-selection-lunch-copy');
    press(tree, 'health-meal-selection-lunch-copy-slot-dinner');
    await act(async () => press(tree, 'health-meal-selection-lunch-copy-confirm'));

    // A 4xx and a lost connection are one honest sentence in the store, and the
    // screen shows THAT rather than its own generic "did not save".
    expect(allText(byTestId(tree, 'health-nutrition-banner')[0])).toContain('nothing was added');
    // Only a confirmed copy ends selection; anything else leaves the same rows
    // ticked so "try again" sends the same set.
    expect(allText(byTestId(tree, 'health-meal-selection-lunch')[0])).toContain('1 item selected');
  });

  it('HEALTH-NUTR-200: a batch delete that removes NOTHING keeps every row and every tick', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const soup = meal({ id: 'a', slot: 'lunch', name: 'Soup' });
    const bread = meal({ id: 'b', slot: 'lunch', name: 'Bread' });
    mockLoadMealsForDate.mockResolvedValue([soup, bread]);
    mockDeleteMealEntries.mockResolvedValue({
      entries: [soup, bread],
      deleted: 0,
      failed: 2,
      status: 'failed',
      message: 'Nothing was removed. Check your connection and try again.',
    });
    const tree = await render(<HealthNutritionScreen />);

    press(tree, 'health-meal-group-lunch-select');
    press(tree, 'health-meal-select-a');
    press(tree, 'health-meal-select-b');
    press(tree, 'health-meal-selection-lunch-delete');
    const confirm = (
      alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>
    ).find((button) => button.text === 'Delete');
    await act(async () => confirm?.onPress?.());

    // All-or-nothing failure is neither "deleted" nor "partial": the rows stay,
    // the selection stays, and the count is not silently re-derived to zero.
    expect(allText(byTestId(tree, 'health-nutrition-banner')[0])).toContain('Nothing was removed');
    expect(allText(byTestId(tree, 'health-meal-selection-lunch')[0])).toContain('2 items selected');
    expect(byTestId(tree, 'health-meal-select-a').length).toBe(1);
    expect(byTestId(tree, 'health-meal-select-b').length).toBe(1);
    alertSpy.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

describe('HealthActivityScreen', () => {
  it('HEALTH-ACT-050: renders the shell and says so when nothing is logged', async () => {
    const tree = await render(<HealthActivityScreen />);

    expect(byTestId(tree, 'health-activity-screen').length).toBe(1);
    expect(byTestId(tree, 'health-activity-empty').length).toBe(1);
    expect(allText(tree.toJSON())).toContain('LOG A WORKOUT');
  });

  it('HEALTH-ACT-051: summarises the last 7 days from the stored sessions', async () => {
    mockLoadWorkouts.mockResolvedValue([
      workout({ id: 'a', minutes: 40, calories: 300 }),
      workout({ id: 'b', date: '2026-07-10', minutes: 20, calories: 90 }),
      // Outside the 7-day window — must not be counted.
      workout({ id: 'c', date: '2026-01-01', minutes: 999, calories: 999 }),
    ]);
    const tree = await render(<HealthActivityScreen />);

    expect(allText(byTestId(tree, 'health-activity-week-workouts')[0])).toContain('2');
    expect(allText(byTestId(tree, 'health-activity-week-minutes')[0])).toContain('1h');
    expect(allText(byTestId(tree, 'health-activity-week-calories')[0])).toContain('390 kcal');
  });

  it('HEALTH-ACT-052: logging a workout persists type + duration, then clears the form', async () => {
    const tree = await render(<HealthActivityScreen />);

    press(tree, 'health-workout-type-strength');
    type(tree, 'health-workout-minutes-input', '45');
    type(tree, 'health-workout-calories-input', '260');
    await act(async () => press(tree, 'health-workout-add-button'));

    // The form now always states the DAY and the INSTANT (`composeStartedAt`
    // off the form's own date/time fields, defaulting to "now") and an
    // unconditional `distanceM` (null when the type carries none) — see
    // `HealthActivityScreen`'s `payload` comment.
    expect(mockAddWorkoutEntry).toHaveBeenCalledWith({
      type: 'strength',
      minutes: 45,
      calories: 260,
      date: TODAY,
      startedAt: FIXED_NOW.toISOString(),
      distanceM: null,
    });
    expect(input(tree, 'health-workout-minutes-input').props.value).toBe('');
  });

  it('HEALTH-ACT-053: a workout with no duration is not logged', async () => {
    const tree = await render(<HealthActivityScreen />);

    await act(async () => press(tree, 'health-workout-add-button'));
    expect(mockAddWorkoutEntry).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-workout-add-button')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
  });

  it('HEALTH-ACT-054: deleting a session removes it through the store', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const destructive = (buttons as Array<{ text: string; onPress?: () => void }>).find(
        (b) => b.text === 'Delete',
      );
      destructive?.onPress?.();
    });
    mockLoadWorkouts.mockResolvedValue([workout({ id: 'gone' })]);
    const tree = await render(<HealthActivityScreen />);

    // Row → detail sheet → Delete (with its confirmation) — edit/delete no
    // longer sit on the row itself, matching the donor's list (a chevron
    // only) with the actions living on the pushed detail screen instead.
    press(tree, 'health-workout-row-gone');
    await act(async () => press(tree, 'health-workout-detail-delete'));
    expect(mockDeleteWorkoutEntry).toHaveBeenCalledWith('gone');
    alertSpy.mockRestore();
  });

  it('HEALTH-ACT-055: steps are typed in and written for today — no HealthKit read', async () => {
    const tree = await render(<HealthActivityScreen />);

    type(tree, 'health-steps-input', '7200');
    await act(async () => press(tree, 'health-steps-save-button'));

    expect(mockSetStepsForDate).toHaveBeenCalledWith(7200);
    expect(input(tree, 'health-steps-input').props.value).toBe('7200');
  });

  it('HEALTH-ACT-056: an unparseable step count is discarded and the stored value restored', async () => {
    mockLoadStepsForDate.mockResolvedValue(5000);
    const tree = await render(<HealthActivityScreen />);
    expect(input(tree, 'health-steps-input').props.value).toBe('5000');

    // `sanitizeIntegerInput` blocks letters at the field, so drive the reject
    // path through the raw handler the way a paste/automation would.
    await act(async () => input(tree, 'health-steps-input').props.onEndEditing({
      nativeEvent: { text: '99 bottles' },
    }));

    expect(mockSetStepsForDate).not.toHaveBeenCalled();
    expect(input(tree, 'health-steps-input').props.value).toBe('5000');
  });

  it('HEALTH-ACT-057: the movement-goal picker writes the chosen target', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await render(<HealthActivityScreen />);

    press(tree, 'health-activity-goal-button');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    expect(buttons.map((b) => b.text)).toContain('45 min');
    alertSpy.mockRestore();
  });

  it('HEALTH-ACT-058: intensity is a real field on the wire, not a tag inside the note', async () => {
    const tree = await render(<HealthActivityScreen />);

    type(tree, 'health-workout-minutes-input', '30');
    press(tree, 'health-workout-intensity-hard');
    type(tree, 'health-workout-note-input', 'hill repeats');
    await act(async () => press(tree, 'health-workout-add-button'));

    // 0124 gave `health_entries` an `intensity` column, so the note is exactly
    // what the user typed. It used to be sent as `'[hard] hill repeats'`,
    // because the route's zod schema stripped every key it did not name.
    expect(mockAddWorkoutEntry).toHaveBeenCalledWith({
      type: 'walk',
      minutes: 30,
      calories: 0,
      intensity: 'hard',
      note: 'hill repeats',
      date: TODAY,
      startedAt: FIXED_NOW.toISOString(),
      distanceM: null,
    });
  });

  it('HEALTH-ACT-158: the default intensity is not sent, so "not recorded" survives', async () => {
    const tree = await render(<HealthActivityScreen />);

    type(tree, 'health-workout-minutes-input', '30');
    await act(async () => press(tree, 'health-workout-add-button'));

    // The column's NULL means "not recorded". Writing the picker's default for
    // everybody would erase that state, and it would change the payload the
    // plain "log a walk" path has always written.
    expect(mockAddWorkoutEntry).toHaveBeenCalledWith({
      type: 'walk',
      minutes: 30,
      calories: 0,
      date: TODAY,
      startedAt: FIXED_NOW.toISOString(),
      distanceM: null,
    });
  });

  it('HEALTH-ACT-059: a stored session reads its intensity off the column', async () => {
    mockLoadWorkouts.mockResolvedValue([
      workout({ id: 'w1', intensity: 'max', note: 'threshold set' }),
      workout({ id: 'w2', date: '2026-07-12', note: 'easy jog with the dog' }),
    ]);
    const tree = await render(<HealthActivityScreen />);

    const rendered = allText(tree.toJSON());
    expect(rendered).toContain('All out');
    expect(rendered).toContain('threshold set');
    // No machine tag is written or rendered any more.
    expect(rendered).not.toContain('[max]');
    // An unrecorded session shows its note and no intensity label.
    expect(rendered).toContain('easy jog with the dog');
  });

  it('HEALTH-ACT-060: editing UPDATES the session in place — never add-then-delete', async () => {
    mockLoadWorkouts.mockResolvedValue([
      workout({ id: 'old', date: '2026-07-11', minutes: 40, intensity: 'hard' }),
    ]);
    const tree = await render(<HealthActivityScreen />);

    // Row → detail sheet → Edit Workout, which closes the sheet and hands the
    // entry to the SAME inline form the tab has always used — one editing
    // code path, not a second one duplicated onto the detail sheet.
    press(tree, 'health-workout-row-old');
    press(tree, 'health-workout-detail-edit');
    expect(input(tree, 'health-workout-minutes-input').props.value).toBe('40');
    // The copy no longer has to apologise for moving the logged time.
    expect(allText(byTestId(tree, 'health-workout-edit-note')[0])).toContain('in place');

    type(tree, 'health-workout-minutes-input', '55');
    await act(async () => press(tree, 'health-workout-add-button'));

    expect(mockUpdateWorkoutEntry).toHaveBeenCalledWith('old', {
      type: 'run',
      minutes: 55,
      calories: 300,
      intensity: 'hard',
      note: '',
      date: '2026-07-11',
      // The form's date (unchanged by this edit) combined with the clock time
      // extracted from the fixture's `loggedAt` fallback (no `startedAt` was
      // seeded on this row).
      startedAt: '2026-07-11T10:00:00.000Z',
      distanceM: null,
    });
    expect(mockAddWorkoutEntry).not.toHaveBeenCalled();
    expect(mockDeleteWorkoutEntry).not.toHaveBeenCalled();
    // Form returns to "log" mode.
    expect(byTestId(tree, 'health-workout-cancel-edit').length).toBe(0);
  });

  it('HEALTH-ACT-159: moving the picker back to the default CLEARS a stored intensity', async () => {
    mockLoadWorkouts.mockResolvedValue([
      workout({ id: 'old', date: '2026-07-11', minutes: 40, intensity: 'max' }),
    ]);
    const tree = await render(<HealthActivityScreen />);

    press(tree, 'health-workout-row-old');
    press(tree, 'health-workout-detail-edit');
    press(tree, 'health-workout-intensity-steady');
    await act(async () => press(tree, 'health-workout-add-button'));

    // `undefined` here is what the store turns into an explicit `null` on the
    // wire. Omitting the key would keep 'max' forever, so there would be no way
    // to un-record an intensity once it had been set.
    expect(mockUpdateWorkoutEntry.mock.calls[0][1]).toMatchObject({ intensity: undefined });
  });

  it('HEALTH-ACT-061: the range picker re-derives every summary below it', async () => {
    mockLoadWorkouts.mockResolvedValue([
      workout({ id: 'recent', minutes: 40, calories: 300 }),
      // 20 days back: inside 30 days, outside 7.
      workout({ id: 'older', date: '2026-06-23', minutes: 90, calories: 500 }),
    ]);
    const tree = await render(<HealthActivityScreen />);

    expect(allText(byTestId(tree, 'health-activity-week-workouts')[0])).toContain('1');
    expect(byTestId(tree, 'health-activity-range-7')[0].props.accessibilityState).toEqual({
      selected: true,
    });

    await act(async () => press(tree, 'health-activity-range-30'));
    expect(allText(byTestId(tree, 'health-activity-week-workouts')[0])).toContain('2');
    expect(allText(byTestId(tree, 'health-activity-week-minutes')[0])).toContain('2h 10m');
  });

  it('HEALTH-ACT-062: the volume chart labels by DATE and discloses its bucketing', async () => {
    mockLoadWorkouts.mockResolvedValue([workout({ id: 'a', minutes: 40 })]);
    const tree = await render(<HealthActivityScreen />);

    // 7 days → one bar per day, labelled with a real date, no thinning. The
    // note now also names the daily-goal rule drawn on the chart, so this
    // checks the base sentence rather than the whole string.
    expect(allText(byTestId(tree, 'health-activity-volume-note')[0])).toContain(
      'One bar per day, labelled by date.'
    );

    await act(async () => press(tree, 'health-activity-range-90'));
    const note = allText(byTestId(tree, 'health-activity-volume-note')[0]);
    // 90 days → 7-day blocks (13 of them), so labels are thinned AND said so.
    expect(note).toContain('7-day block');
    expect(note).toContain('label is drawn');
  });

  it('HEALTH-ACT-063: an empty range says so in words rather than drawing a flat chart', async () => {
    const tree = await render(<HealthActivityScreen />);

    expect(allText(byTestId(tree, 'health-activity-volume-empty')[0])).toContain(
      'No active minutes logged'
    );
    expect(allText(byTestId(tree, 'health-activity-breakdown-empty')[0])).toContain('no split');
    expect(allText(byTestId(tree, 'health-activity-steps-empty')[0])).toContain(
      'No step counts recorded'
    );
    expect(byTestId(tree, 'bar-chart').length).toBe(0);
    expect(byTestId(tree, 'app-line-chart').length).toBe(0);
  });

  it('HEALTH-ACT-064: the per-type split shares out the range, busiest first', async () => {
    mockLoadWorkouts.mockResolvedValue([
      workout({ id: 'r1', type: 'run', minutes: 60 }),
      workout({ id: 's1', type: 'strength', date: '2026-07-12', minutes: 20 }),
      workout({ id: 's2', type: 'strength', date: '2026-07-11', minutes: 20 }),
    ]);
    const tree = await render(<HealthActivityScreen />);

    expect(byTestId(tree, 'health-activity-breakdown-run').length).toBe(1);
    expect(allText(byTestId(tree, 'health-activity-breakdown-run')[0])).toContain('60%');
    expect(allText(byTestId(tree, 'health-activity-breakdown-strength')[0])).toContain(
      '2 sessions'
    );
    // Silent types are absent, not rendered as a row of zeroes.
    expect(byTestId(tree, 'health-activity-breakdown-swim').length).toBe(0);
  });

  it('HEALTH-ACT-065: streaks count consecutive days and survive a rest day still in progress', async () => {
    mockLoadWorkouts.mockResolvedValue([
      workout({ id: 'a', date: '2026-07-12' }),
      workout({ id: 'b', date: '2026-07-11' }),
      workout({ id: 'c', date: '2026-07-10' }),
    ]);
    const tree = await render(<HealthActivityScreen />);

    // Nothing logged TODAY yet, but yesterday keeps the streak alive.
    expect(allText(byTestId(tree, 'health-activity-streak-current')[0])).toContain('3 d');
    expect(allText(byTestId(tree, 'health-activity-streak-longest')[0])).toContain('3 d');
    expect(allText(byTestId(tree, 'health-activity-streak-note')[0])).toContain('Yesterday');
  });

  it('HEALTH-ACT-066: the steps line leaves unrecorded days out instead of drawing them as zero', async () => {
    mockLoadStepDays.mockResolvedValue([
      { date: TODAY, steps: 9000 },
      { date: '2026-07-11', steps: 4000 },
    ]);
    const tree = await render(<HealthActivityScreen />);

    expect(byTestId(tree, 'app-line-chart').length).toBe(1);
    const note = allText(byTestId(tree, 'health-activity-steps-note')[0]);
    expect(note).toContain('2 recorded days');
    expect(note).toContain('left out rather than drawn as zero');
  });

  /* -------------- what the form refuses, and what it must not ------------ */

  it('HEALTH-ACT-180: a typed 0 kcal logs the session, exactly as leaving it blank does', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await render(<HealthActivityScreen />);

    type(tree, 'health-workout-minutes-input', '30');
    type(tree, 'health-workout-calories-input', '0');
    await act(async () => press(tree, 'health-workout-add-button'));

    // The shared integer parser rejects anything `<= 0` — a guard that belongs
    // to the REQUIRED minutes field. On this optional one it meant a typed zero
    // raised "Check the calories" and threw the whole session away, while a
    // blank field sent the very same 0.
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockAddWorkoutEntry).toHaveBeenCalledWith({
      type: 'walk',
      minutes: 30,
      calories: 0,
      date: TODAY,
      startedAt: FIXED_NOW.toISOString(),
      distanceM: null,
    });
    alertSpy.mockRestore();
  });

  it('HEALTH-ACT-181: an impossible burn is refused in words, and nothing is written', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await render(<HealthActivityScreen />);

    type(tree, 'health-workout-minutes-input', '30');
    type(tree, 'health-workout-calories-input', '99000');
    await act(async () => press(tree, 'health-workout-add-button'));

    expect(alertSpy.mock.calls[0][0]).toBe('Check the calories');
    expect(alertSpy.mock.calls[0][1]).toContain('more than one session can burn');
    expect(mockAddWorkoutEntry).not.toHaveBeenCalled();
    // The form keeps what was typed, so the figure is corrected, not retyped.
    expect(input(tree, 'health-workout-minutes-input').props.value).toBe('30');
    expect(input(tree, 'health-workout-calories-input').props.value).toBe('99000');
    alertSpy.mockRestore();
  });

  it('HEALTH-ACT-182: editing a session with no calorie figure leaves the box EMPTY', async () => {
    mockLoadWorkouts.mockResolvedValue([workout({ id: 'w0', minutes: 25, calories: 0 })]);
    const tree = await render(<HealthActivityScreen />);

    press(tree, 'health-workout-row-w0');
    press(tree, 'health-workout-detail-edit');
    // 0 means "not counted". A literal "0" in the box would be re-saved as a
    // recorded zero and read back as "this session burned nothing".
    expect(input(tree, 'health-workout-calories-input').props.value).toBe('');
    expect(input(tree, 'health-workout-minutes-input').props.value).toBe('25');
  });

  it('HEALTH-ACT-183: deleting the session being edited drops the edit with it', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const destructive = (buttons as Array<{ text: string; onPress?: () => void }>).find(
        (b) => b.text === 'Delete',
      );
      destructive?.onPress?.();
    });
    const a = workout({ id: 'a', minutes: 40 });
    const b = workout({ id: 'b', date: '2026-07-12', minutes: 20 });
    let stored = [a, b];
    mockLoadWorkouts.mockResolvedValue(stored);
    mockDeleteWorkoutEntry.mockImplementation(async (id: string) => {
      stored = stored.filter((entry) => entry.id !== id);
      return stored;
    });
    const tree = await render(<HealthActivityScreen />);

    press(tree, 'health-workout-row-a');
    press(tree, 'health-workout-detail-edit');
    expect(byTestId(tree, 'health-workout-cancel-edit').length).toBe(1);

    // Deleting a DIFFERENT session leaves the edit in progress alone…
    press(tree, 'health-workout-row-b');
    await act(async () => press(tree, 'health-workout-detail-delete'));
    expect(byTestId(tree, 'health-workout-cancel-edit').length).toBe(1);
    expect(input(tree, 'health-workout-minutes-input').props.value).toBe('40');

    // …but deleting the one being edited has to reset the form, or "Save
    // session" writes to a row that is no longer there.
    press(tree, 'health-workout-row-a');
    await act(async () => press(tree, 'health-workout-detail-delete'));
    expect(byTestId(tree, 'health-workout-cancel-edit').length).toBe(0);
    expect(input(tree, 'health-workout-minutes-input').props.value).toBe('');
    expect(allText(tree.toJSON())).toContain('LOG A WORKOUT');
    alertSpy.mockRestore();
  });

  /* -------------- grouping, sharing out and the two goal pickers --------- */

  it('HEALTH-ACT-184: two sessions on one day share a heading, newest logged first', async () => {
    mockLoadWorkouts.mockResolvedValue([
      workout({ id: 'early', type: 'walk', minutes: 20, loggedAt: '2026-07-13T07:00:00.000Z' }),
      workout({ id: 'late', type: 'swim', minutes: 45, loggedAt: '2026-07-13T19:00:00.000Z' }),
    ]);
    const tree = await render(<HealthActivityScreen />);

    // One day heading carrying both, not a heading per session.
    expect(byTestId(tree, `health-activity-day-${TODAY}`).length).toBe(1);
    const day = allText(byTestId(tree, `health-activity-day-${TODAY}`)[0]);
    // Full donor display names now ('Swimming'/'Walking'), not the old
    // abbreviated 'Swim'/'Walk'. Name and duration render as separate nodes
    // (a title line plus an icon+value chip) rather than one joined string,
    // so this checks both are present and correctly ordered rather than an
    // exact ` · ` join.
    expect(day).toContain('Swimming');
    expect(day).toContain('45m');
    expect(day).toContain('Walking');
    expect(day).toContain('20m');
    expect(day.indexOf('Swimming')).toBeLessThan(day.indexOf('Walking'));
  });

  it('HEALTH-ACT-185: a session with no duration is shared out as 0%, never NaN%', async () => {
    // `loadWorkouts` only demands a finite `minutes`, so a zero-minute session
    // (an import, or a mis-typed correction) really does reach this screen.
    mockLoadWorkouts.mockResolvedValue([
      workout({ id: 'z', type: 'yoga', minutes: 0, calories: 0 }),
    ]);
    const tree = await render(<HealthActivityScreen />);

    const row = allText(byTestId(tree, 'health-activity-breakdown-yoga')[0]);
    expect(row).toContain('0% of active minutes');
    expect(row).not.toContain('NaN');
    // Nothing burned is nothing to say, not "· 0 kcal".
    expect(row).not.toContain('kcal');
    expect(allText(byTestId(tree, `health-activity-day-${TODAY}`)[0])).not.toContain('kcal');
  });

  it('HEALTH-ACT-186: types with equal minutes are ordered by name, not by log order', async () => {
    mockLoadWorkouts.mockResolvedValue([
      workout({ id: 'w', type: 'walk', minutes: 30 }),
      workout({ id: 'r', type: 'run', date: '2026-07-12', minutes: 30 }),
    ]);
    const tree = await render(<HealthActivityScreen />);

    // A tie has to break the same way every render, or the split reshuffles
    // itself whenever a session is added.
    const rows = tree.root.findAll(
      (n) =>
        typeof n.type === 'string' &&
        typeof n.props?.testID === 'string' &&
        n.props.testID.startsWith('health-activity-breakdown-'),
    );
    expect(rows.map((n) => n.props.testID)).toEqual([
      'health-activity-breakdown-run',
      'health-activity-breakdown-walk',
    ]);
  });

  it('HEALTH-ACT-187: the movement-goal picker writes the target and re-draws the bar', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSaveActivityGoals.mockResolvedValue({ ...activityGoals, minutes: 45 });
    const tree = await render(<HealthActivityScreen />);

    press(tree, 'health-activity-goal-button');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => buttons.find((b) => b.text === '45 min')?.onPress?.());

    expect(mockSaveActivityGoals).toHaveBeenCalledWith({ minutes: 45 });
    expect(allText(tree.toJSON())).toContain('Goal 45 min');
    alertSpy.mockRestore();
  });

  it('HEALTH-ACT-188: the step-goal picker writes its own target, not the minutes one', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSaveActivityGoals.mockResolvedValue({ ...activityGoals, steps: 12000 });
    const tree = await render(<HealthActivityScreen />);

    press(tree, 'health-activity-steps-goal-button');
    expect(alertSpy.mock.calls[0][0]).toBe('Daily step goal');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    expect(buttons.map((b) => b.text)).toEqual([
      '5000 steps',
      '8000 steps',
      '10000 steps',
      '12000 steps',
      'Cancel',
    ]);

    await act(async () => buttons.find((b) => b.text === '12000 steps')?.onPress?.());
    // Only `steps` is sent: the two goals share one row, and resending both
    // would overwrite a minutes target set on another device.
    expect(mockSaveActivityGoals).toHaveBeenCalledWith({ steps: 12000 });
    expect(allText(tree.toJSON())).toContain('Step goal: 12000');
    alertSpy.mockRestore();
  });

  /* -------------- the step field, and what the axis admits to ------------ */

  it('HEALTH-ACT-189: the step count commits from the keyboard and on blur too', async () => {
    // The field is `returnKeyType="done"` on a number pad, so "done" — and
    // tapping away — IS the commit for most people. If either did nothing the
    // count would look accepted and never be stored.
    const tree = await render(<HealthActivityScreen />);

    type(tree, 'health-steps-input', '7200');
    await act(async () => input(tree, 'health-steps-input').props.onSubmitEditing());
    expect(mockSetStepsForDate).toHaveBeenLastCalledWith(7200);

    type(tree, 'health-steps-input', '7600');
    await act(async () => input(tree, 'health-steps-input').props.onBlur());
    expect(mockSetStepsForDate).toHaveBeenLastCalledWith(7600);
  });

  it('HEALTH-ACT-190: clearing the day to zero steps is a real write, and empties the box', async () => {
    mockLoadStepsForDate.mockResolvedValue(5000);
    const tree = await render(<HealthActivityScreen />);
    expect(input(tree, 'health-steps-input').props.value).toBe('5000');

    type(tree, 'health-steps-input', '0');
    await act(async () => press(tree, 'health-steps-save-button'));

    expect(mockSetStepsForDate).toHaveBeenCalledWith(0);
    // Back to the placeholder: a literal "0" reads as a recorded zero.
    expect(input(tree, 'health-steps-input').props.value).toBe('');
  });

  it('HEALTH-ACT-191: an unreadable count with nothing stored clears the box, not "0"', async () => {
    const tree = await render(<HealthActivityScreen />);

    type(tree, 'health-steps-input', '12000');
    // `sanitizeIntegerInput` blocks a space at the field, so drive the reject
    // path through the raw handler the way a paste would.
    await act(async () =>
      input(tree, 'health-steps-input').props.onEndEditing({ nativeEvent: { text: '12 000' } }),
    );

    expect(mockSetStepsForDate).not.toHaveBeenCalled();
    expect(input(tree, 'health-steps-input').props.value).toBe('');
  });

  it('HEALTH-ACT-192: one recorded day of steps is named as such, not drawn as a line', async () => {
    mockLoadStepDays.mockResolvedValue([{ date: TODAY, steps: 9000 }]);
    const tree = await render(<HealthActivityScreen />);

    expect(allText(byTestId(tree, 'health-activity-steps-empty')[0])).toContain(
      'One day of steps is not a trend yet',
    );
    expect(byTestId(tree, 'app-line-chart').length).toBe(0);
  });

  it('HEALTH-ACT-193: a thinned steps axis says exactly how often a label is drawn', async () => {
    mockLoadStepDays.mockResolvedValue(stepDaysBack(15));
    const tree = await render(<HealthActivityScreen />);
    await act(async () => press(tree, 'health-activity-range-30'));

    const note = allText(byTestId(tree, 'health-activity-steps-note')[0]);
    expect(note).toContain('15 recorded days');
    expect(note).toContain('Only every 3rd label is drawn.');
    // And the axis really is thinned: 15 points, every 3rd labelled.
    const drawn = String(byTestId(tree, 'app-line-chart')[0].props.accessibilityHint)
      .split('|')
      .filter(Boolean);
    expect(drawn.length).toBe(5);
    expect(drawn[0]).toMatch(/^[A-Z][a-z]{2} \d+$/); // a date, never an index

    // A denser series thins further, and the ordinal has to follow it rather
    // than stopping at "3rd".
    mockLoadStepDays.mockResolvedValue(stepDaysBack(30));
    const denser = await render(<HealthActivityScreen />);
    await act(async () => press(denser, 'health-activity-range-30'));
    expect(allText(byTestId(denser, 'health-activity-steps-note')[0])).toContain(
      'Only every 5th label is drawn.',
    );
  });

  it('HEALTH-ACT-194: an empty range points at the sessions that sit outside it', async () => {
    mockLoadWorkouts.mockResolvedValue([workout({ id: 'old', date: '2026-01-01' })]);
    const tree = await render(<HealthActivityScreen />);

    // "No workouts yet" would be a lie — they are there, just not in view.
    expect(allText(byTestId(tree, 'health-activity-empty')[0])).toContain(
      'Your 1 earlier session is still there',
    );

    mockLoadWorkouts.mockResolvedValue([
      workout({ id: 'o1', date: '2026-01-01' }),
      workout({ id: 'o2', date: '2026-01-02' }),
    ]);
    const two = await render(<HealthActivityScreen />);
    expect(allText(byTestId(two, 'health-activity-empty')[0])).toContain(
      'Your 2 earlier sessions are still there',
    );
  });
});

/* ------------------------------------------------------------------ */
/* Activity — the exported pure helpers                                */
/* ------------------------------------------------------------------ */

describe('HealthActivityScreen helpers', () => {
  it('HEALTH-ACT-195: an axis label echoes a date key it cannot read', async () => {
    expect(formatAxisDay('2026-07-13')).toBe('Jul 13');
    // A corrupt key must come back as itself. Rendering `undefined NaN` under a
    // bar is worse than an ugly label, and a thrown error blanks the chart.
    expect(formatAxisDay('2026-13-01')).toBe('2026-13-01');
    expect(formatAxisDay('not-a-date')).toBe('not-a-date');
    expect(formatAxisDay('')).toBe('');
  });

  it('HEALTH-ACT-196: a day key that cannot be placed breaks the streak, not the maths', async () => {
    expect(workoutStreaks(['2026-07-12', '2026-07-13'], '2026-07-13')).toEqual({
      current: 2,
      longest: 2,
      lastActiveDate: '2026-07-13',
    });

    // The gap to an unparseable key is unknown, so the CURRENT streak is zero
    // rather than a figure derived from NaN.
    expect(workoutStreaks(['2026-07-12', 'corrupt'], '2026-07-13')).toEqual({
      current: 0,
      longest: 1,
      lastActiveDate: 'corrupt',
    });
  });

  it('HEALTH-ACT-197: streaks fall back to today when no reference day is given', async () => {
    // The screen always passes its own `today`; the default has to agree with
    // it, or a caller without one would read yesterday as a broken streak.
    expect(workoutStreaks([todayDateKey()])).toEqual({
      current: 1,
      longest: 1,
      lastActiveDate: todayDateKey(),
    });
  });

  it('HEALTH-ACT-198: a range with no days at all produces no bars and no note', async () => {
    // The screen never asks for one, but a caller that does must get an empty
    // series rather than a bucket built out of `dayKeys[undefined]`.
    expect(volumeSeries([workout()], [])).toEqual({
      buckets: [],
      granularity: 'day',
      labelStep: 1,
      note: '',
    });
  });

  it('HEALTH-ACT-199: a bucket splits its minutes into walk/run vs everything else', async () => {
    // The donor's Activity Minutes chart is two HealthKit workout-type
    // buckets, not one total. `walk`/`run` are this app's own two locomotion
    // slugs (see healthWorkoutTypes.ts); every other type — strength here —
    // falls into the second bucket.
    const day = '2026-07-13';
    const series = volumeSeries(
      [
        workout({ id: 'a', type: 'run', date: day, minutes: 20 }),
        workout({ id: 'b', type: 'walk', date: day, minutes: 10 }),
        workout({ id: 'c', type: 'strength', date: day, minutes: 15 }),
      ],
      [day],
    );
    expect(series.buckets).toEqual([
      {
        start: day,
        end: day,
        minutes: 45,
        walkRunMinutes: 30,
        exerciseMinutes: 15,
        sessions: 3,
        calories: 900,
        distanceM: null,
      },
    ]);
    // The two figures still add up to the total the single-series tiles read.
    expect(series.buckets[0].walkRunMinutes + series.buckets[0].exerciseMinutes).toBe(
      series.buckets[0].minutes,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Trends                                                              */
/* ------------------------------------------------------------------ */

describe('HealthTrendsScreen', () => {
  it('HEALTH-TREND-050: renders every summary card and defaults to the 30-day range', async () => {
    const tree = await render(<HealthTrendsScreen />);

    expect(byTestId(tree, 'health-trends-screen').length).toBe(1);
    const text = allText(tree.toJSON());
    expect(text).toContain('WEIGHT');
    expect(text).toContain('NUTRITION');
    expect(text).toContain('ACTIVITY');
    expect(text).toContain('HYDRATION');
    expect(byTestId(tree, 'health-trends-range-30')[0].props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('HEALTH-TREND-051: says what is missing instead of drawing a flat empty line', async () => {
    const tree = await render(<HealthTrendsScreen />);

    expect(byTestId(tree, 'health-trends-weight-empty').length).toBe(1);
    expect(byTestId(tree, 'app-line-chart').length).toBe(0);
    expect(allText(byTestId(tree, 'health-trends-weight-latest')[0])).toContain('—');
  });

  it('HEALTH-TREND-052: charts the weight series and reports latest / average / change', async () => {
    mockLoadWeightLog.mockResolvedValue([
      weightEntry(new Date(2026, 6, 13, 8).toISOString(), 79),
      weightEntry(new Date(2026, 6, 12, 8).toISOString(), 80),
      weightEntry(new Date(2026, 6, 11, 8).toISOString(), 81),
    ]);
    const tree = await render(<HealthTrendsScreen />);

    const chart = byTestId(tree, 'app-line-chart')[0];
    expect(chart.props.accessibilityValue.text).toBe('81,80,79');
    expect(allText(byTestId(tree, 'health-trends-weight-latest')[0])).toContain('79 kg');
    expect(allText(byTestId(tree, 'health-trends-weight-average')[0])).toContain('80 kg');
    expect(allText(byTestId(tree, 'health-trends-weight-change')[0])).toContain('-2 kg');
  });

  it('HEALTH-TREND-053: switching the range re-derives every card', async () => {
    mockLoadWeightLog.mockResolvedValue([
      weightEntry(new Date(2026, 6, 13, 8).toISOString(), 79),
      // 8 days back: inside the July calendar-month window, outside the
      // Monday-Sunday week window (which starts on the 13th).
      weightEntry(new Date(2026, 6, 5, 8).toISOString(), 84),
    ]);
    const tree = await render(<HealthTrendsScreen />);
    expect(byTestId(tree, 'app-line-chart')[0].props.accessibilityValue.text).toBe('84,79');

    await act(async () => press(tree, 'health-trends-range-7'));
    // Only one point remains in a 7-day window, so the chart gives way to copy.
    expect(byTestId(tree, 'app-line-chart').length).toBe(0);
    expect(byTestId(tree, 'health-trends-weight-empty').length).toBe(1);
  });

  it('HEALTH-TREND-054: nutrition and activity read from their own stores', async () => {
    mockLoadMeals.mockResolvedValue([meal({ calories: 600, protein: 40 })]);
    mockLoadWorkouts.mockResolvedValue([workout({ minutes: 40 })]);
    mockLoadStepDays.mockResolvedValue([{ date: TODAY, steps: 9000 }]);
    const tree = await render(<HealthTrendsScreen />);

    // July's calendar month is 31 days, not a fixed 30.
    expect(allText(byTestId(tree, 'health-trends-nutrition-days')[0])).toContain('1/31');
    expect(allText(byTestId(tree, 'health-trends-nutrition-avg')[0])).toContain('600 kcal');
    expect(allText(byTestId(tree, 'health-trends-activity-workouts')[0])).toContain('1');
    expect(allText(byTestId(tree, 'health-trends-activity-steps')[0])).toContain('9000');
  });

  it('HEALTH-TREND-055: hydration + habit streaks come from the rolling history', async () => {
    mockLoadWaterHistory.mockResolvedValue([water({ cups: 8 }), water({ date: '2026-07-12', cups: 4 })]);
    mockLoadHabits.mockResolvedValue([habit({ days: [TODAY, '2026-07-12'] })]);
    const tree = await render(<HealthTrendsScreen />);

    expect(allText(byTestId(tree, 'health-trends-water-goal-days')[0])).toContain('1/2 days');
    expect(allText(byTestId(tree, 'health-trends-water-average')[0])).toContain('6');
    expect(allText(byTestId(tree, 'health-trends-habit-streak')[0])).toContain('2 d');
    expect(allText(tree.toJSON())).toContain('Longest run: Sleep 7+ hours');
  });

  it('HEALTH-TREND-056: discloses the axis sampling when the series is thinned', async () => {
    // The default window is the calendar month of July — all 20 dates stay
    // inside it (1 Jul … 20 Jul), so all 20 points are plotted.
    mockLoadWeightLog.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) =>
        weightEntry(new Date(2026, 6, 1 + i, 8).toISOString(), 80 + i),
      ),
    );
    const tree = await render(<HealthTrendsScreen />);

    const note = byTestId(tree, 'health-trends-axis-note');
    expect(note.length).toBe(1);
    expect(allText(note[0])).toContain('every 3 logged days');
  });

  /* ---------------------------------------------------------------- */
  /* The two donor chart dashboards, wired into this tab               */
  /* ---------------------------------------------------------------- */

  it('HEALTH-TREND-057: mounts both donor dashboards and the consistency heatmap', async () => {
    const tree = await render(<HealthTrendsScreen />);

    // The owner's complaint was "I see no charts" — these three assertions are
    // the ones that fail if a dashboard is ever built but left unwired.
    expect(byTestId(tree, 'health-weight-dashboard').length).toBe(1);
    expect(byTestId(tree, 'health-calories-dashboard').length).toBe(1);
    expect(byTestId(tree, 'health-trends-consistency').length).toBe(1);
    expect(allText(tree.toJSON())).toContain('CALORIES');
    expect(allText(tree.toJSON())).toContain('LOGGING CONSISTENCY');
  });

  it('HEALTH-TREND-058: the weight dashboard draws the trend, the average and the weekly bars', async () => {
    mockLoadWeightLog.mockResolvedValue([
      weightEntry(new Date(2026, 6, 13, 8).toISOString(), 79),
      weightEntry(new Date(2026, 6, 12, 8).toISOString(), 80),
      weightEntry(new Date(2026, 6, 11, 8).toISOString(), 81),
    ]);
    const tree = await render(<HealthTrendsScreen />);

    expect(byTestId(tree, 'health-weight-dashboard-chart').length).toBe(1);
    expect(byTestId(tree, 'health-weight-dashboard-weekly').length).toBe(1);
    // Two series on one axis always ship a legend naming both.
    const legend = allText(byTestId(tree, 'health-weight-dashboard-legend')[0]);
    expect(legend).toContain('Logged weight');
    expect(legend).toContain('7-day average');
    // Lowest / highest are the two figures the old summary card never carried.
    expect(allText(byTestId(tree, 'health-weight-dashboard-min')[0])).toContain('79 kg');
    expect(allText(byTestId(tree, 'health-weight-dashboard-max')[0])).toContain('81 kg');
  });

  it('HEALTH-TREND-059: the calories dashboard scores each day against the stored goal', async () => {
    mockLoadNutritionGoals.mockResolvedValue({ ...goals, calories: 2000 });
    mockLoadMeals.mockResolvedValue([
      meal({ id: 'a', date: '2026-07-11', calories: 1800 }),
      meal({ id: 'b', date: '2026-07-12', calories: 2400 }),
      meal({ id: 'c', date: TODAY, calories: 1900 }),
    ]);
    const tree = await render(<HealthTrendsScreen />);

    expect(allText(byTestId(tree, 'health-calories-dashboard-target-note')[0])).toContain(
      'Daily target 2000 kcal',
    );
    expect(allText(byTestId(tree, 'health-calories-dashboard-on-target')[0])).toContain('2/3');
    expect(allText(byTestId(tree, 'health-calories-dashboard-average')[0])).toContain('2033 kcal');
    // Closest to target wins "best", not the smallest number.
    expect(allText(byTestId(tree, 'health-calories-dashboard-best')[0])).toContain('13 Jul');
    expect(allText(byTestId(tree, 'health-calories-dashboard-worst')[0])).toContain('12 Jul');
  });

  it('HEALTH-TREND-060: every dashboard chart announces its headline figure', async () => {
    mockLoadWeightLog.mockResolvedValue([
      weightEntry(new Date(2026, 6, 13, 8).toISOString(), 79),
      weightEntry(new Date(2026, 6, 11, 8).toISOString(), 81),
    ]);
    mockLoadMeals.mockResolvedValue([
      meal({ id: 'a', date: TODAY, calories: 1800, protein: 50, carbs: 0, fat: 0 }),
    ]);
    const tree = await render(<HealthTrendsScreen />);

    expect(byTestId(tree, 'health-weight-dashboard-chart')[0].props.accessibilityLabel).toContain(
      'latest 79 kg',
    );
    expect(byTestId(tree, 'health-weight-dashboard-weekly')[0].props.accessibilityLabel).toContain(
      'Weekly average weight',
    );
    expect(byTestId(tree, 'health-calories-dashboard-chart')[0].props.accessibilityLabel).toContain(
      '1 of 1 logged days at or under it',
    );
    expect(byTestId(tree, 'health-calories-dashboard-macros')[0].props.accessibilityLabel).toContain(
      'protein 100%',
    );
    // The heatmap speaks its own coverage — it cannot be read as a grid of tints.
    expect(byTestId(tree, 'health-trends-consistency')[0].props.accessibilityLabel).toContain(
      'days logged',
    );
  });

  it('HEALTH-TREND-061: the heatmap counts a day logged from ANY tracker', async () => {
    mockLoadMeals.mockResolvedValue([meal({ id: 'a', date: TODAY })]);
    mockLoadWorkouts.mockResolvedValue([workout({ id: 'w', date: '2026-07-12' })]);
    mockLoadWaterHistory.mockResolvedValue([water({ date: '2026-07-11', cups: 4 })]);
    mockLoadHabits.mockResolvedValue([habit({ days: ['2026-07-10'] })]);
    const tree = await render(<HealthTrendsScreen />);

    // July's calendar month is 31 days, not a fixed 30.
    expect(allText(byTestId(tree, 'health-trends-consistency-days')[0])).toContain('4/31');
    expect(allText(byTestId(tree, 'health-trends-consistency-rate')[0])).toContain('13%');
    // 10th–13th are four consecutive logged days.
    expect(allText(byTestId(tree, 'health-trends-consistency-streak')[0])).toContain('4 d');
  });

  it('HEALTH-TREND-062: an empty range says so on every dashboard, drawing no zero series', async () => {
    const tree = await render(<HealthTrendsScreen />);

    expect(byTestId(tree, 'health-trends-weight-empty').length).toBe(1);
    expect(byTestId(tree, 'health-weight-dashboard-weekly-empty').length).toBe(1);
    expect(byTestId(tree, 'health-calories-dashboard-empty').length).toBe(1);
    expect(byTestId(tree, 'health-calories-dashboard-macros-empty').length).toBe(1);
    expect(byTestId(tree, 'app-line-chart').length).toBe(0);
    // July's calendar month is 31 days, not a fixed 30.
    expect(allText(byTestId(tree, 'health-trends-consistency-days')[0])).toContain('0/31');
    expect(allText(tree.toJSON())).toContain('Nothing logged in this range yet.');
  });

  it('HEALTH-TREND-063: switching the range re-derives the dashboards too', async () => {
    mockLoadMeals.mockResolvedValue([
      meal({ id: 'a', date: TODAY, calories: 1900 }),
      // 8 days back: inside the July calendar-month window, outside the
      // Monday-Sunday week window (which starts on the 13th).
      meal({ id: 'b', date: '2026-07-05', calories: 2400 }),
    ]);
    const tree = await render(<HealthTrendsScreen />);
    expect(allText(byTestId(tree, 'health-calories-dashboard-on-target')[0])).toContain('1/2');

    await act(async () => press(tree, 'health-trends-range-7'));
    expect(allText(byTestId(tree, 'health-calories-dashboard-on-target')[0])).toContain('1/1');
    expect(allText(byTestId(tree, 'health-trends-consistency-days')[0])).toContain('1/7');
  });

  it('HEALTH-TREND-080: the weight target is drawn in the unit the SERIES is logged in', async () => {
    mockLoadWeightGoal.mockResolvedValue({ ...EMPTY_WEIGHT_GOAL, targetKg: 75, unit: 'kg' });
    mockLoadWeightLog.mockResolvedValue([
      weightEntry(new Date(2026, 6, 13, 8).toISOString(), 180, 'lb'),
      weightEntry(new Date(2026, 6, 11, 8).toISOString(), 182, 'lb'),
    ]);
    const tree = await render(<HealthTrendsScreen />);

    // The target is stored in canonical kg. `buildWeightSeries` plots in the
    // NEWEST entry's unit, so the rule is converted into that one — a 75 drawn
    // against a pounds axis would sit off the bottom of the chart and read as a
    // goal already smashed.
    expect(allText(byTestId(tree, 'health-weight-dashboard-legend-rule')[0])).toContain(
      'Goal 165.3 lb',
    );
  });

  it('HEALTH-TREND-081: a target with nothing logged draws no rule to hang it on', async () => {
    mockLoadWeightGoal.mockResolvedValue({ ...EMPTY_WEIGHT_GOAL, targetKg: 75, unit: 'kg' });
    const tree = await render(<HealthTrendsScreen />);

    // With no series there is no scale the target could be honest against, so
    // it is simply not drawn — rather than converted into a guessed unit.
    expect(byTestId(tree, 'health-weight-dashboard-legend-rule').length).toBe(0);
    expect(byTestId(tree, 'health-trends-weight-empty').length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Body                                                                */
/* ------------------------------------------------------------------ */

describe('HealthBodyScreen', () => {
  it('HEALTH-BODY-050: renders a tile per metric, dashed until one is logged', async () => {
    const tree = await render(<HealthBodyScreen />);

    expect(byTestId(tree, 'health-body-screen').length).toBe(1);
    // Only the PRIMARY tier is visible until "Show detailed sites" is on (or
    // a detailed site already has a reading) — the 41-site comprehensive
    // vocabulary is too many tiles to show at once by default.
    for (const metric of PRIMARY_BODY_METRICS) {
      expect(byTestId(tree, `health-body-summary-${metric}`).length).toBe(1);
    }
    expect(byTestId(tree, 'health-body-summary-waist')[0].props.accessibilityLabel).toBe(
      'Waist: not logged',
    );

    // Toggling detailed sites on reveals the rest of the full BODY_METRICS set.
    await act(async () => press(tree, 'health-body-detailed-toggle'));
    for (const metric of BODY_METRICS) {
      expect(byTestId(tree, `health-body-summary-${metric}`).length).toBe(1);
    }
  });

  it('HEALTH-BODY-051: shows the latest reading and the change against the previous one', async () => {
    mockLoadBodyEntries.mockResolvedValue([
      bodyEntry({ id: 'new', value: 78.5, loggedAt: '2026-07-13T10:00:00.000Z' }),
      bodyEntry({ id: 'old', value: 80, loggedAt: '2026-07-06T10:00:00.000Z' }),
    ]);
    const tree = await render(<HealthBodyScreen />);

    const tile = byTestId(tree, 'health-body-summary-waist')[0];
    expect(tile.props.accessibilityLabel).toBe('Waist: 78.5 cm');
    expect(allText(tile)).toContain('1.5');
  });

  it('HEALTH-BODY-052: logging a measurement stores metric + unit, then clears the field', async () => {
    const tree = await render(<HealthBodyScreen />);

    press(tree, 'health-body-metric-chest');
    press(tree, 'health-body-unit-in');
    type(tree, 'health-body-value-input', '39.5');
    await act(async () => press(tree, 'health-body-add-button'));

    // `addBodyEntry` now takes the entry-form's DATE too (back-dating support).
    expect(mockAddBodyEntry).toHaveBeenCalledWith('chest', 39.5, 'in', TODAY);
    expect(input(tree, 'health-body-value-input').props.value).toBe('');
  });

  it('HEALTH-BODY-053: body fat is stored as a percentage, with no length-unit toggle', async () => {
    const tree = await render(<HealthBodyScreen />);

    press(tree, 'health-body-metric-bodyFat');
    expect(byTestId(tree, 'health-body-unit-cm').length).toBe(0);

    type(tree, 'health-body-value-input', '18.4');
    await act(async () => press(tree, 'health-body-add-button'));
    expect(mockAddBodyEntry).toHaveBeenCalledWith('bodyFat', 18.4, '%', TODAY);
  });

  it('HEALTH-BODY-054: an empty or invalid value cannot be logged', async () => {
    const tree = await render(<HealthBodyScreen />);

    await act(async () => press(tree, 'health-body-add-button'));
    expect(mockAddBodyEntry).not.toHaveBeenCalled();

    type(tree, 'health-body-value-input', '0');
    await act(async () => press(tree, 'health-body-add-button'));
    expect(mockAddBodyEntry).not.toHaveBeenCalled();
  });

  it('HEALTH-BODY-055: history follows the selected metric and can delete a reading', async () => {
    const chest = bodyEntry({ id: 'chest-1', metric: 'chest', value: 100 });
    mockLoadBodyEntries.mockResolvedValue([bodyEntry({ id: 'waist-1' }), chest]);
    // Deleting the waist reading leaves the chest one behind.
    mockDeleteBodyEntry.mockResolvedValue([chest]);
    const tree = await render(<HealthBodyScreen />);

    // The history list is scoped to the selected metric (waist by default).
    expect(byTestId(tree, 'health-body-delete-waist-1').length).toBe(1);
    expect(byTestId(tree, 'health-body-delete-chest-1').length).toBe(0);

    await act(async () => press(tree, 'health-body-delete-waist-1'));
    expect(mockDeleteBodyEntry).toHaveBeenCalledWith('waist-1');
    expect(byTestId(tree, 'health-body-history-empty').length).toBe(1);

    press(tree, 'health-body-metric-chest');
    expect(byTestId(tree, 'health-body-delete-chest-1').length).toBe(1);
  });

  it('HEALTH-BODY-056: groups the sites the way the donor’s measurement form does', async () => {
    const tree = await render(<HealthBodyScreen />);
    // Reveal the detailed tier so every one of the 41 comprehensive sites is
    // on screen, not just the PRIMARY set — this test's whole point is that
    // grouping covers the full `BODY_METRICS` vocabulary.
    await act(async () => press(tree, 'health-body-detailed-toggle'));

    const text = allText(tree.toJSON());
    expect(text).toContain('Upper body');
    expect(text).toContain('Arms');
    expect(text).toContain('Legs');
    expect(text).toContain('Composition');
    // Grouping is derived from BODY_METRICS, so every exposed site still has
    // exactly one summary tile and exactly one entry chip.
    for (const metric of BODY_METRICS) {
      expect(byTestId(tree, `health-body-summary-${metric}`).length).toBe(1);
      expect(byTestId(tree, `health-body-metric-${metric}`).length).toBe(1);
    }
  });

  it('HEALTH-BODY-057: charts a per-metric trend instead of only a latest value', async () => {
    mockLoadBodyEntries.mockResolvedValue([
      bodyEntry({ id: 'w1', date: TODAY, value: 78, loggedAt: '2026-07-13T10:00:00.000Z' }),
      bodyEntry({ id: 'w2', date: '2026-07-06', value: 80, loggedAt: '2026-07-06T10:00:00.000Z' }),
    ]);
    const tree = await render(<HealthBodyScreen />);

    // The 41-site comprehensive vocabulary reordered `BODY_METRICS` by
    // anatomical region ('neck' now leads), so the trend card's own internal
    // picker defaults to neck rather than waist — select it explicitly.
    await act(async () => press(tree, 'health-body-trend-metric-waist'));

    const chart = byTestId(tree, 'health-body-trend-chart');
    expect(chart.length).toBe(1);
    expect(chart[0].props.accessibilityLabel).toContain('Waist trend');
    expect(chart[0].props.accessibilityLabel).toContain('down 2 cm');
    expect(allText(byTestId(tree, 'health-body-trend-change')[0])).toContain('-2 cm');
  });

  it('HEALTH-BODY-058: body fat gets its OWN axis — a percentage is not a circumference', async () => {
    mockLoadBodyEntries.mockResolvedValue([
      bodyEntry({ id: 'w1', date: TODAY, value: 78, loggedAt: '2026-07-13T10:00:00.000Z' }),
      bodyEntry({ id: 'w2', date: '2026-07-06', value: 80, loggedAt: '2026-07-06T10:00:00.000Z' }),
      bodyEntry({
        id: 'f1',
        metric: 'bodyFat',
        unit: '%',
        date: TODAY,
        value: 18.4,
        loggedAt: '2026-07-13T10:05:00.000Z',
      }),
      bodyEntry({
        id: 'f2',
        metric: 'bodyFat',
        unit: '%',
        date: '2026-07-06',
        value: 19.2,
        loggedAt: '2026-07-06T10:05:00.000Z',
      }),
    ]);
    const tree = await render(<HealthBodyScreen />);
    await act(async () => press(tree, 'health-body-trend-metric-waist'));

    // Two charts, therefore two scales. One shared axis would draw a 60-unit
    // gulf between a waist in cm and a percentage.
    expect(byTestId(tree, 'app-line-chart').length).toBe(2);
    expect(byTestId(tree, 'health-body-trend-chart')[0].props.accessibilityLabel).toContain('cm');
    const fat = byTestId(tree, 'health-body-fat-trend-chart');
    expect(fat.length).toBe(1);
    expect(fat[0].props.accessibilityLabel).toContain('Body fat trend');
    expect(fat[0].props.accessibilityLabel).toContain('18.4 %');
    // Body fat is never offered as a choice on the length chart.
    expect(byTestId(tree, 'health-body-trend-metric-bodyFat').length).toBe(0);
  });

  it('HEALTH-BODY-059: compares a chosen baseline against a later day across every site', async () => {
    mockLoadBodyEntries.mockResolvedValue([
      bodyEntry({ id: 'w1', date: TODAY, value: 78, loggedAt: '2026-07-13T10:00:00.000Z' }),
      bodyEntry({
        id: 'c1',
        metric: 'chest',
        date: TODAY,
        value: 101,
        loggedAt: '2026-07-13T10:01:00.000Z',
      }),
      bodyEntry({ id: 'w0', date: '2026-05-01', value: 84, loggedAt: '2026-05-01T10:00:00.000Z' }),
      bodyEntry({
        id: 'c0',
        metric: 'chest',
        date: '2026-05-01',
        value: 100,
        loggedAt: '2026-05-01T10:01:00.000Z',
      }),
    ]);
    const tree = await render(<HealthBodyScreen />);

    expect(byTestId(tree, 'health-body-compare-row-waist')[0].props.accessibilityLabel).toBe(
      'Waist: 84 cm to 78 cm, −6 cm',
    );
    expect(byTestId(tree, 'health-body-compare-row-chest')[0].props.accessibilityLabel).toBe(
      'Chest: 100 cm to 101 cm, +1 cm',
    );
    expect(allText(byTestId(tree, 'health-body-compare-summary')[0])).toContain('2 of 2');
  });

  it('HEALTH-BODY-060: an untouched Body tab says so rather than drawing empty charts', async () => {
    const tree = await render(<HealthBodyScreen />);
    // 'neck' leads the reordered `BODY_METRICS`, so it — not 'waist' — is the
    // trend card's default selection; pick 'waist' explicitly to match the
    // rest of this describe block's fixtures.
    await act(async () => press(tree, 'health-body-trend-metric-waist'));

    expect(allText(byTestId(tree, 'health-body-measurements-empty')[0])).toContain(
      'No measurements yet',
    );
    expect(byTestId(tree, 'app-line-chart').length).toBe(0);
    expect(allText(byTestId(tree, 'health-body-trend-empty')[0])).toContain('No waist readings');
    expect(allText(byTestId(tree, 'health-body-fat-trend-empty')[0])).toContain(
      'No body fat readings',
    );
    expect(allText(byTestId(tree, 'health-body-compare-empty')[0])).toContain(
      'at least two different days',
    );
  });

  it('HEALTH-BODY-061: submitting from the keyboard logs the same reading as the button', async () => {
    // The field is `returnKeyType="done"` on a decimal pad, so "done" IS the
    // commit for most people. If it did nothing, the value would look accepted
    // and silently never be stored.
    const tree = await render(<HealthBodyScreen />);

    press(tree, 'health-body-metric-hips');
    type(tree, 'health-body-value-input', '96');
    await act(async () => input(tree, 'health-body-value-input').props.onSubmitEditing());

    expect(mockAddBodyEntry).toHaveBeenCalledWith('hips', 96, 'cm', TODAY);
    expect(input(tree, 'health-body-value-input').props.value).toBe('');
  });

  it('HEALTH-BODY-062: body fat is charted on its OWN card, never on the length axis', async () => {
    // Both trend cards are gated on the STATIC `BODY_METRICS` set, so which
    // cards exist is a property of the metric vocabulary, not of the log. What
    // must hold is that a body-fat reading only ever reaches the % card.
    mockLoadBodyEntries.mockResolvedValue([
      bodyEntry({
        id: 'bf1',
        metric: 'bodyFat',
        unit: '%',
        value: 22,
        date: TODAY,
        loggedAt: '2026-07-13T10:00:00.000Z',
      }),
      bodyEntry({
        id: 'bf2',
        metric: 'bodyFat',
        unit: '%',
        value: 24,
        date: '2026-07-06',
        loggedAt: '2026-07-06T10:00:00.000Z',
      }),
    ]);
    const tree = await render(<HealthBodyScreen />);

    // The % card has a series…
    expect(byTestId(tree, 'health-body-fat-trend-empty').length).toBe(0);
    // …and the circumference card, which has no readings at all, says so
    // instead of plotting a percentage against centimetres.
    expect(allText(byTestId(tree, 'health-body-trend-empty')[0])).toContain('readings');
  });
});

/* ------------------------------------------------------------------ */
/* Habits                                                              */
/* ------------------------------------------------------------------ */

describe('HealthHabitsScreen', () => {
  it('HEALTH-HABIT-050: says so when there are no habits', async () => {
    const tree = await render(<HealthHabitsScreen />);

    expect(byTestId(tree, 'health-habits-screen').length).toBe(1);
    expect(byTestId(tree, 'health-habits-empty').length).toBe(1);
    expect(allText(byTestId(tree, 'health-habits-done-today')[0])).toContain('0/0');
  });

  it('HEALTH-HABIT-051: renders each habit with its streak and today summary', async () => {
    mockLoadHabits.mockResolvedValue([
      habit({ id: 'sleep', days: [TODAY, '2026-07-12'] }),
      habit({ id: 'move', name: 'Move 30 minutes', days: [] }),
    ]);
    const tree = await render(<HealthHabitsScreen />);

    // The row now leads with the schedule (`scheduleSummary`, "Every day" for
    // the fixture's default frequency), and the streak is an appended clause
    // only when there IS one — a zero streak adds nothing rather than a
    // separate "No streak yet" string.
    expect(allText(byTestId(tree, 'health-habit-streak-sleep')[0])).toBe('Every day · 2 day streak');
    expect(allText(byTestId(tree, 'health-habit-streak-move')[0])).toBe('Every day');
    expect(allText(byTestId(tree, 'health-habits-done-today')[0])).toContain('1/2');
    expect(allText(byTestId(tree, 'health-habits-completion')[0])).toContain('50%');
    expect(allText(byTestId(tree, 'health-habits-best-streak')[0])).toContain('2 d');
  });

  it('HEALTH-HABIT-052: ticking a habit writes today and re-renders as checked', async () => {
    mockLoadHabits.mockResolvedValue([habit({ id: 'sleep' })]);
    mockToggleHabitToday.mockResolvedValue([habit({ id: 'sleep', days: [TODAY] })]);
    const tree = await render(<HealthHabitsScreen />);

    // The underlying Pressable always spreads the full accessibilityState
    // shape (busy/disabled/expanded/selected included, undefined when unset).
    const before = byTestId(tree, 'health-habit-toggle-sleep')[0];
    expect(before.props.accessibilityState).toEqual({
      checked: false,
      selected: false,
      busy: undefined,
      disabled: undefined,
      expanded: undefined,
    });

    await act(async () => press(tree, 'health-habit-toggle-sleep'));
    // `toggleHabitToday` now takes the day-selector's date too (the whole
    // point of the port: a forgotten day can still be ticked after the fact).
    expect(mockToggleHabitToday).toHaveBeenCalledWith('sleep', TODAY);
    expect(byTestId(tree, 'health-habit-toggle-sleep')[0].props.accessibilityState).toEqual({
      checked: true,
      selected: true,
      busy: undefined,
      disabled: undefined,
      expanded: undefined,
    });
  });

  it('HEALTH-HABIT-053: adding a habit persists the name and clears the field', async () => {
    const tree = await render(<HealthHabitsScreen />);

    type(tree, 'health-habit-name-input', 'Walk after lunch');
    await act(async () => press(tree, 'health-habit-add-button'));

    expect(mockAddHabit).toHaveBeenCalledWith('Walk after lunch');
    expect(input(tree, 'health-habit-name-input').props.value).toBe('');
  });

  it('HEALTH-HABIT-056: the keyboard’s Done key adds the habit, without reaching for the button', async () => {
    // The field is a one-line name with `returnKeyType="done"`; on a phone the
    // Add button sits under the keyboard, so submitting from the keyboard has
    // to do the same thing as pressing it.
    const tree = await render(<HealthHabitsScreen />);

    type(tree, 'health-habit-name-input', 'Walk after lunch');
    await act(async () => input(tree, 'health-habit-name-input').props.onSubmitEditing());

    expect(mockAddHabit).toHaveBeenCalledWith('Walk after lunch');
    expect(input(tree, 'health-habit-name-input').props.value).toBe('');
  });

  it('HEALTH-HABIT-054: a blank name cannot be added', async () => {
    const tree = await render(<HealthHabitsScreen />);

    await act(async () => press(tree, 'health-habit-add-button'));
    expect(mockAddHabit).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-habit-add-button')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
  });

  it('HEALTH-HABIT-055: deleting from the detail sheet asks ONCE, then removes the habit and its history', async () => {
    // The donor-parity rewrite moved delete off the main list and into the
    // habit's own detail sheet (opened by tapping the row): `confirmDelete()`
    // there shows the Alert and, on "Delete", calls `onDelete` directly. That
    // callback must NOT show a second Alert of its own — it used to be wired
    // to `handleDelete` (which shows its own, identically-worded confirm),
    // stacking two confirmations for one delete. Fixed to call the plain
    // delete side-effect instead; this test pins BOTH halves: exactly one
    // Alert, and the row survives a Cancel.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadHabits.mockResolvedValue([habit({ id: 'sleep' })]);
    const tree = await render(<HealthHabitsScreen />);

    await act(async () => press(tree, 'health-habit-open-sleep'));
    expect(byTestId(tree, 'health-habit-detail').length).toBe(1);

    press(tree, 'health-habit-detail-delete');
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }>;
    expect(buttons.find((b) => b.text === 'Cancel')?.style).toBe('cancel');

    await act(async () => buttons.find((b) => b.text === 'Delete')?.onPress?.());
    expect(mockDeleteHabit).toHaveBeenCalledWith('sleep');
    // Exactly one Alert for the whole flow — the fixed callback must not have
    // triggered a second confirmation on top of this one.
    expect(alertSpy).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });

  it('HEALTH-HABIT-420: Cancel on the real custom-habit form closes it and adds nothing', async () => {
    // `habits.screen.test.tsx` mocks `HealthHabitForm` down to a one-button
    // stub to keep ITS suite about the screen's wiring, which means the
    // form's own Cancel button — as opposed to the "Custom habit" toggle that
    // opens/closes the same section — had never actually been pressed. This
    // file renders the real form, so it is the one place that can.
    const tree = await render(<HealthHabitsScreen />);

    press(tree, 'health-habits-create-custom');
    expect(byTestId(tree, 'health-habit-create-form')).toHaveLength(1);

    press(tree, 'health-habit-create-cancel');

    expect(byTestId(tree, 'health-habit-create-form')).toHaveLength(0);
    expect(mockAddHabit).not.toHaveBeenCalled();
  });
});
