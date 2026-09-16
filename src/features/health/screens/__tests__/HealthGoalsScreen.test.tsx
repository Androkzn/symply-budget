/**
 * Symply Health — the Goals screen.
 *
 * Renders the REAL screen through <ThemeProvider>. Only the storage-backed
 * async functions are mocked (one per section, matching the screen's own
 * "save through the module that owns the field" design); the pure derivation
 * — macro math, the suggestion engine, bound checking — stays real and owns
 * its coverage in `../../__tests__/healthGoalsStorage.test.ts`. What is
 * asserted here is the SCREEN's use of it: which section saves what, which
 * bound error shows in which words, and which parts of the form are gated on
 * which piece of the snapshot.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { saveActivityGoals, type ActivityGoals } from '../../healthActivityStorage';
import {
  CALORIE_WEEK_DAYS,
  EMPTY_CALORIE_WEEK,
  EMPTY_MACRO_WEEK,
  loadHealthGoals,
  saveCalorieWeek,
  saveMacroWeek,
  type CalorieWeek,
  type HealthGoalsSnapshot,
  type MacroWeek,
} from '../../healthGoalsStorage';
import { setWaterTarget, type WaterDay } from '../../healthLocalStorage';
import { saveNutritionGoals, type NutritionGoals } from '../../healthNutritionStorage';
import {
  EMPTY_WEIGHT_GOAL,
  saveWeightGoal,
  type HealthWeightGoalType,
  type WeightGoal,
} from '../../healthWeightStorage';
import { HealthGoalsScreen } from '../HealthGoalsScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

// This suite renders the screen standalone, with no real NavigationContainer,
// so the real `useFocusEffect` (used to re-hydrate on focus/HealthKit sync)
// would throw the instant it mounts. Same inert-callback shim
// HealthSectionScreens.test.tsx uses.
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactActual = jest.requireActual('react');
    ReactActual.useEffect(() => callback(), [callback]);
  },
}));

// The baseline-date field drives a native picker, not a `TextInput` — mocked
// as a passthrough View (mirrors `SavingsGoalForm.test.tsx`) so its `onChange`
// can be called directly with a concrete `Date`.
jest.mock('@react-native-community/datetimepicker', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return (props: Record<string, unknown>) =>
    ReactMock.createElement(View, { testID: 'date-time-picker', ...props });
});

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header', accessibilityLabel: title }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) => ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

jest.mock('../../healthGoalsStorage', () => {
  const actual = jest.requireActual('../../healthGoalsStorage');
  return {
    ...actual,
    loadHealthGoals: jest.fn(),
    saveCalorieWeek: jest.fn(),
    saveMacroWeek: jest.fn(),
  };
});
jest.mock('../../healthActivityStorage', () => {
  const actual = jest.requireActual('../../healthActivityStorage');
  return { ...actual, saveActivityGoals: jest.fn() };
});
jest.mock('../../healthNutritionStorage', () => {
  const actual = jest.requireActual('../../healthNutritionStorage');
  return { ...actual, saveNutritionGoals: jest.fn() };
});
jest.mock('../../healthLocalStorage', () => {
  const actual = jest.requireActual('../../healthLocalStorage');
  return { ...actual, setWaterTarget: jest.fn() };
});
jest.mock('../../healthWeightStorage', () => {
  const actual = jest.requireActual('../../healthWeightStorage');
  return { ...actual, saveWeightGoal: jest.fn() };
});

const mockLoadHealthGoals = loadHealthGoals as jest.Mock;
const mockSaveCalorieWeek = saveCalorieWeek as jest.Mock;
const mockSaveMacroWeek = saveMacroWeek as jest.Mock;
const mockSaveActivityGoals = saveActivityGoals as jest.Mock;
const mockSaveNutritionGoals = saveNutritionGoals as jest.Mock;
const mockSetWaterTarget = setWaterTarget as jest.Mock;
const mockSaveWeightGoal = saveWeightGoal as jest.Mock;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0); // Monday
const TODAY = '2026-07-13';

function nutritionGoals(over: Partial<NutritionGoals> = {}): NutritionGoals {
  return { calories: 2000, protein: 120, carbs: 220, fat: 65, ...over };
}

function activityGoals(over: Partial<ActivityGoals> = {}): ActivityGoals {
  return { minutes: 30, steps: 8000, ...over };
}

function calorieWeek(over: Partial<CalorieWeek> = {}): CalorieWeek {
  return { ...EMPTY_CALORIE_WEEK, ...over };
}

function macroWeek(over: Partial<MacroWeek> = {}): MacroWeek {
  return { ...EMPTY_MACRO_WEEK, ...over };
}

function weightGoal(over: Partial<WeightGoal> = {}): WeightGoal {
  return { ...EMPTY_WEIGHT_GOAL, ...over };
}

function snapshot(over: Partial<HealthGoalsSnapshot> = {}): HealthGoalsSnapshot {
  return {
    nutrition: nutritionGoals(),
    activity: activityGoals(),
    waterCups: 8,
    calorieWeek: calorieWeek(),
    macroWeek: macroWeek(),
    weight: weightGoal(),
    unit: 'kg',
    currentWeightKg: null,
    today: TODAY,
    ...over,
  };
}

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

/** The HOST node carrying `testID` — the one whose props include accessibilityState. */
function node(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return byTestId(tree, testID)[0];
}

function text(tree: ReactTestRenderer.ReactTestRenderer, testID: string): string {
  const found = byTestId(tree, testID)[0];
  if (!found) throw new Error(`no node with testID "${testID}"`);
  return allText(found);
}

function has(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return byTestId(tree, testID).length > 0;
}

function input(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID
  );
}

function type(tree: ReactTestRenderer.ReactTestRenderer, testID: string, value: string) {
  act(() => input(tree, testID).props.onChangeText(value));
}

function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const target = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  act(() => target.props.onPress());
}

async function pressAsync(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const target = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  await act(async () => {
    await target.props.onPress();
  });
}

function toggle(tree: ReactTestRenderer.ReactTestRenderer, testID: string, value: boolean) {
  const target = tree.root.find((n) => n.props?.testID === testID);
  act(() => target.props.onValueChange(value));
}

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthGoalsScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
  mockLoadHealthGoals.mockResolvedValue(snapshot());
  mockSaveCalorieWeek.mockImplementation((week: CalorieWeek) => Promise.resolve(week));
  mockSaveMacroWeek.mockImplementation((week: MacroWeek) => Promise.resolve(week));
  mockSaveActivityGoals.mockImplementation((patch: Partial<ActivityGoals>) =>
    Promise.resolve({ ...activityGoals(), ...patch })
  );
  mockSaveNutritionGoals.mockImplementation((goals: NutritionGoals) => Promise.resolve(goals));
  mockSetWaterTarget.mockImplementation((target: number) =>
    Promise.resolve({ date: TODAY, cups: 0, target } as WaterDay)
  );
  mockSaveWeightGoal.mockImplementation((patch: Record<string, unknown>) =>
    Promise.resolve(weightGoal(patch as Partial<WeightGoal>))
  );
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Shell + hydration                                                   */
/* ------------------------------------------------------------------ */

describe('HealthGoalsScreen — shell', () => {
  it('HEALTH-GOALS-100: renders every section card on load', async () => {
    const tree = await render();
    expect(byTestId(tree, 'health-goals-screen').length).toBe(1);
    for (const id of [
      'health-goals-nutrition-card',
      'health-goals-activity-card',
      'health-goals-water-card',
      'health-goals-weight-card',
      'health-goals-suggested-card',
      'health-goals-footnote',
    ]) {
      expect(has(tree, id)).toBe(true);
    }
    // No save has happened yet, so no confirmation/error banner.
    expect(has(tree, 'health-goals-message')).toBe(false);
  });

  it('HEALTH-GOALS-101: hydrates every draft field from the loaded snapshot', async () => {
    mockLoadHealthGoals.mockResolvedValue(
      snapshot({
        nutrition: nutritionGoals({ calories: 2200, protein: 150, carbs: 250, fat: 70 }),
        activity: activityGoals({ steps: 9000, minutes: 40 }),
        waterCups: 10,
        weight: weightGoal({ targetKg: 75, startingKg: 90, startingDate: '2026-01-01', goalType: 'lose' }),
        unit: 'kg',
      })
    );
    const tree = await render();

    expect(input(tree, 'health-goals-calories-input').props.value).toBe('2200');
    expect(input(tree, 'health-goals-macro-protein-input').props.value).toBe('150');
    expect(input(tree, 'health-goals-macro-carbs-input').props.value).toBe('250');
    expect(input(tree, 'health-goals-macro-fat-input').props.value).toBe('70');
    expect(input(tree, 'health-goals-steps-input').props.value).toBe('9000');
    expect(input(tree, 'health-goals-minutes-input').props.value).toBe('40');
    expect(input(tree, 'health-goals-water-input').props.value).toBe('10');
    expect(input(tree, 'health-goals-target-input').props.value).toBe('75');
    expect(input(tree, 'health-goals-starting-input').props.value).toBe('90');
    // The date field is a native picker, not a `TextInput` — the clear button
    // only renders for a non-blank value, and the hydrated string itself
    // round-trips through an untouched save.
    expect(has(tree, 'health-goals-starting-date-input-clear')).toBe(true);
    expect(node(tree, 'health-goals-type-lose').props.accessibilityState).toEqual({ selected: true });

    await pressAsync(tree, 'health-goals-weight-save');
    expect(mockSaveWeightGoal.mock.calls[0][0]).toMatchObject({ startingDate: '2026-01-01' });
  });

  it('HEALTH-GOALS-102: an unset weight goal hydrates its fields BLANK, not "0" or "null"', async () => {
    const tree = await render();
    expect(input(tree, 'health-goals-target-input').props.value).toBe('');
    expect(input(tree, 'health-goals-starting-input').props.value).toBe('');
    expect(has(tree, 'health-goals-starting-date-input-clear')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Nutrition — calories, per-weekday plan, macros                      */
/* ------------------------------------------------------------------ */

describe('HealthGoalsScreen — nutrition targets', () => {
  it('HEALTH-GOALS-103: saves calories + macros through their OWN module, then confirms', async () => {
    const tree = await render();
    type(tree, 'health-goals-calories-input', '2200');
    type(tree, 'health-goals-macro-protein-input', '150');
    type(tree, 'health-goals-macro-carbs-input', '250');
    type(tree, 'health-goals-macro-fat-input', '70');
    await pressAsync(tree, 'health-goals-nutrition-save');

    expect(mockSaveNutritionGoals).toHaveBeenCalledWith({
      calories: 2200,
      protein: 150,
      carbs: 250,
      fat: 70,
    });
    // The per-weekday plans are SEPARATE round-trips, saved alongside.
    expect(mockSaveCalorieWeek).toHaveBeenCalledWith(EMPTY_CALORIE_WEEK);
    expect(mockSaveMacroWeek).toHaveBeenCalledWith(EMPTY_MACRO_WEEK);
    expect(text(tree, 'health-goals-message')).toBe('Targets updated.');
  });

  it('HEALTH-GOALS-104: a calorie target outside the route bound is refused, in words — nothing saved', async () => {
    const tree = await render();
    type(tree, 'health-goals-calories-input', '200'); // below CALORIE_MIN (500)
    await pressAsync(tree, 'health-goals-nutrition-save');

    expect(mockSaveNutritionGoals).not.toHaveBeenCalled();
    expect(text(tree, 'health-goals-message')).toMatch(/between 500 and/);
  });

  it('HEALTH-GOALS-105: an out-of-bound macro names WHICH one, not a generic error', async () => {
    const tree = await render();
    type(tree, 'health-goals-macro-protein-input', '9999'); // above MACRO_GRAMS_MAX (2000)
    await pressAsync(tree, 'health-goals-nutrition-save');

    expect(mockSaveNutritionGoals).not.toHaveBeenCalled();
    expect(text(tree, 'health-goals-message')).toMatch(/^Protein: /);
  });

  it('HEALTH-GOALS-106: a preset writes the field, one tap', async () => {
    const tree = await render();
    press(tree, 'health-goals-calorie-preset-2500');
    expect(input(tree, 'health-goals-calories-input').props.value).toBe('2500');
  });

  it('HEALTH-GOALS-107: turning per-day ON seeds all seven from the single target, and highlights TODAY', async () => {
    const tree = await render();
    expect(has(tree, 'health-goals-week')).toBe(false);

    toggle(tree, 'health-goals-perday-toggle', true);
    expect(has(tree, 'health-goals-week')).toBe(true);
    for (const day of CALORIE_WEEK_DAYS) {
      expect(input(tree, `health-goals-week-${day.key}`).props.value).toBe('2000');
    }
    // TODAY (2026-07-13) is a Monday — the first row — and says so.
    expect(text(tree, 'health-goals-week')).toContain('Monday · today');
  });

  it('HEALTH-GOALS-107b: turning per-day OFF hides the week editor but keeps the days it already had', async () => {
    const tree = await render();
    toggle(tree, 'health-goals-perday-toggle', true);
    press(tree, 'health-goals-week-preset-3000');
    toggle(tree, 'health-goals-perday-toggle', false);
    expect(has(tree, 'health-goals-week')).toBe(false);

    // Flipping back on again shows the SAME 3000s, not a re-seed — the toggle
    // only hides the editor, it does not throw the plan away.
    toggle(tree, 'health-goals-perday-toggle', true);
    expect(input(tree, 'health-goals-week-monday_calories').props.value).toBe('3000');
  });

  it('HEALTH-GOALS-108: an out-of-bound WEEKDAY target names the day, not the plan', async () => {
    const tree = await render();
    toggle(tree, 'health-goals-perday-toggle', true);
    type(tree, 'health-goals-week-tuesday_calories', '99999');
    await pressAsync(tree, 'health-goals-nutrition-save');

    expect(mockSaveCalorieWeek).not.toHaveBeenCalled();
    expect(mockSaveNutritionGoals).not.toHaveBeenCalled();
    expect(text(tree, 'health-goals-message')).toMatch(/^Tuesday: /);
  });

  it('HEALTH-GOALS-109: a blank weekday target is legal — it falls back to the single daily figure', async () => {
    const tree = await render();
    toggle(tree, 'health-goals-perday-toggle', true);
    type(tree, 'health-goals-week-monday_calories', '');
    await pressAsync(tree, 'health-goals-nutrition-save');

    expect(mockSaveCalorieWeek).toHaveBeenCalled();
    const saved = mockSaveCalorieWeek.mock.calls[0][0] as CalorieWeek;
    expect(saved.days[0]).toBeNull();
  });

  it('HEALTH-GOALS-110: "Set every day to" overwrites all seven at once', async () => {
    const tree = await render();
    toggle(tree, 'health-goals-perday-toggle', true);
    press(tree, 'health-goals-week-preset-3000');
    for (const day of CALORIE_WEEK_DAYS) {
      expect(input(tree, `health-goals-week-${day.key}`).props.value).toBe('3000');
    }
  });

  it('HEALTH-GOALS-111: the weekly average updates live as the plan is edited', async () => {
    const tree = await render();
    toggle(tree, 'health-goals-perday-toggle', true);
    press(tree, 'health-goals-week-preset-3000');
    // All seven at 3000 -> average 3000 (comma-grouped by `toLocaleString`).
    expect(text(tree, 'health-goals-week-average')).toContain('3,000 kcal');
  });

  it('HEALTH-GOALS-112: "Keep X, rebalance the other two" redistributes the OTHER macros only', async () => {
    const tree = await render();
    type(tree, 'health-goals-macro-protein-input', '200'); // anchor
    press(tree, 'health-goals-macro-protein-rebalance');

    // Protein (the anchor) is untouched by its own rebalance button.
    expect(input(tree, 'health-goals-macro-protein-input').props.value).toBe('200');
    // The other two moved off their loaded defaults (220 / 65).
    expect(input(tree, 'health-goals-macro-carbs-input').props.value).not.toBe('220');
    expect(input(tree, 'health-goals-macro-fat-input').props.value).not.toBe('65');
  });

  it('HEALTH-GOALS-113: the macro-difference line names an overshoot and an undershoot in words, or neither in tolerance', async () => {
    const tree = await render();
    // Loaded macros (120P/220C/65F @ 2000 kcal target) = 480+880+585=1945, 55 under target — inside the ±50 tolerance? No: 1945-2000=-55, outside tolerance.
    expect(text(tree, 'health-goals-macro-difference')).toMatch(/LESS than your calorie target/);

    type(tree, 'health-goals-macro-protein-input', '400'); // now well over target
    expect(text(tree, 'health-goals-macro-difference')).toMatch(/MORE than your calorie target/);

    // Bring the macros back to something inside the ±50 kcal tolerance.
    type(tree, 'health-goals-macro-protein-input', '130');
    expect(text(tree, 'health-goals-macro-difference')).toMatch(/matches your calorie target/);
  });

  it('HEALTH-GOALS-113b: the macro legend reads 0% for every segment when all three are zero, never NaN%', async () => {
    const tree = await render();
    type(tree, 'health-goals-macro-protein-input', '0');
    type(tree, 'health-goals-macro-carbs-input', '0');
    type(tree, 'health-goals-macro-fat-input', '0');
    const bar = text(tree, 'health-goals-macro-bar');
    expect(bar).toContain('Protein 0%');
    expect(bar).toContain('Carbs 0%');
    expect(bar).toContain('Fats 0%');
    expect(bar).not.toContain('NaN');
  });

  it('HEALTH-GOALS-135: turning per-day macros ON seeds every day from the flat targets, starting on TODAY', async () => {
    const tree = await render();
    expect(has(tree, 'health-goals-macro-week-body')).toBe(false);

    toggle(tree, 'health-goals-macro-week-toggle', true);
    expect(has(tree, 'health-goals-macro-week-body')).toBe(true);
    // Loaded flat macros are 120P/220C/65F; TODAY (2026-07-13) is a Monday.
    expect(input(tree, 'health-goals-macro-week-protein-input').props.value).toBe('120');
    expect(input(tree, 'health-goals-macro-week-carbs-input').props.value).toBe('220');
    expect(input(tree, 'health-goals-macro-week-fat-input').props.value).toBe('65');
  });

  it('HEALTH-GOALS-136: switching the day chip shows that day\'s own split — edits touch only the selected day', async () => {
    const tree = await render();
    toggle(tree, 'health-goals-macro-week-toggle', true);
    type(tree, 'health-goals-macro-week-protein-input', '200'); // Monday

    press(tree, 'health-goals-macro-week-day-tue');
    expect(input(tree, 'health-goals-macro-week-protein-input').props.value).toBe('120'); // still seeded

    press(tree, 'health-goals-macro-week-day-mon');
    expect(input(tree, 'health-goals-macro-week-protein-input').props.value).toBe('200'); // Monday's edit stuck
  });

  it('HEALTH-GOALS-137: "Use <day>\'s split for every day" fans the selected day across the week', async () => {
    const tree = await render();
    toggle(tree, 'health-goals-macro-week-toggle', true);
    type(tree, 'health-goals-macro-week-protein-input', '200'); // Monday
    press(tree, 'health-goals-macro-week-copy-all');

    press(tree, 'health-goals-macro-week-day-sun');
    expect(input(tree, 'health-goals-macro-week-protein-input').props.value).toBe('200');
  });

  it('HEALTH-GOALS-138: an out-of-bound per-day macro target names the day AND the macro', async () => {
    const tree = await render();
    toggle(tree, 'health-goals-macro-week-toggle', true);
    type(tree, 'health-goals-macro-week-protein-input', '9999'); // above MACRO_GRAMS_MAX (2000)
    await pressAsync(tree, 'health-goals-nutrition-save');

    expect(mockSaveMacroWeek).not.toHaveBeenCalled();
    expect(mockSaveCalorieWeek).not.toHaveBeenCalled();
    expect(mockSaveNutritionGoals).not.toHaveBeenCalled();
    expect(text(tree, 'health-goals-message')).toMatch(/^Monday Protein: /);
  });

  it('HEALTH-GOALS-139: a per-day macro plan saves alongside the flat targets, off by default', async () => {
    const tree = await render();
    await pressAsync(tree, 'health-goals-nutrition-save');
    expect(mockSaveMacroWeek).toHaveBeenCalledWith(EMPTY_MACRO_WEEK);

    mockSaveMacroWeek.mockClear();
    toggle(tree, 'health-goals-macro-week-toggle', true);
    type(tree, 'health-goals-macro-week-protein-input', '200');
    await pressAsync(tree, 'health-goals-nutrition-save');

    expect(mockSaveMacroWeek).toHaveBeenCalled();
    const saved = mockSaveMacroWeek.mock.calls[0][0] as MacroWeek;
    expect(saved.usePerDay).toBe(true);
    expect(saved.days[0]).toMatchObject({ protein: 200 });
  });
});

/* ------------------------------------------------------------------ */
/* Activity + hydration                                                */
/* ------------------------------------------------------------------ */

describe('HealthGoalsScreen — activity and hydration targets', () => {
  it('HEALTH-GOALS-114: saves steps + minutes through the activity module', async () => {
    const tree = await render();
    type(tree, 'health-goals-steps-input', '9000');
    type(tree, 'health-goals-minutes-input', '40');
    await pressAsync(tree, 'health-goals-activity-save');

    expect(mockSaveActivityGoals).toHaveBeenCalledWith({ steps: 9000, minutes: 40 });
    expect(text(tree, 'health-goals-message')).toBe('Targets updated.');
  });

  it('HEALTH-GOALS-115: a step target of 0 is refused — the floor is 1, not the route\'s 0', async () => {
    const tree = await render();
    type(tree, 'health-goals-steps-input', '0');
    await pressAsync(tree, 'health-goals-activity-save');

    expect(mockSaveActivityGoals).not.toHaveBeenCalled();
    expect(text(tree, 'health-goals-message')).toMatch(/step target/);
  });

  it('HEALTH-GOALS-116: a minutes target over the daily bound is refused', async () => {
    const tree = await render();
    type(tree, 'health-goals-minutes-input', '99999');
    await pressAsync(tree, 'health-goals-activity-save');

    expect(mockSaveActivityGoals).not.toHaveBeenCalled();
    expect(text(tree, 'health-goals-message')).toMatch(/Movement minutes/);
  });

  it('HEALTH-GOALS-116b: the steps and minutes presets write their own field, one tap', async () => {
    const tree = await render();
    press(tree, 'health-goals-steps-preset-12000');
    expect(input(tree, 'health-goals-steps-input').props.value).toBe('12000');
    press(tree, 'health-goals-minutes-preset-60');
    expect(input(tree, 'health-goals-minutes-input').props.value).toBe('60');
  });

  it('HEALTH-GOALS-117: saves the water target through its own module', async () => {
    const tree = await render();
    type(tree, 'health-goals-water-input', '10');
    await pressAsync(tree, 'health-goals-water-save');

    expect(mockSetWaterTarget).toHaveBeenCalledWith(10);
  });

  it('HEALTH-GOALS-118: a water target of 0 is refused', async () => {
    const tree = await render();
    type(tree, 'health-goals-water-input', '0');
    await pressAsync(tree, 'health-goals-water-save');
    expect(mockSetWaterTarget).not.toHaveBeenCalled();
  });

  it('HEALTH-GOALS-119: the litres line states the cup size and matches the wire figure', async () => {
    const tree = await render();
    type(tree, 'health-goals-water-input', '10');
    // 10 cups * 240 ml = 2400 ml = 2.4 L.
    expect(text(tree, 'health-goals-water-ml')).toContain('2.4 L');
    expect(text(tree, 'health-goals-water-ml')).toContain('240 ml');
  });

  it('HEALTH-GOALS-119b: the water preset writes the field, one tap', async () => {
    const tree = await render();
    press(tree, 'health-goals-water-preset-12');
    expect(input(tree, 'health-goals-water-input').props.value).toBe('12');
  });
});

/* ------------------------------------------------------------------ */
/* Weight goal                                                         */
/* ------------------------------------------------------------------ */

describe('HealthGoalsScreen — weight goal', () => {
  it('HEALTH-GOALS-120: saving a target + starting weight + date sends a full patch', async () => {
    const tree = await render();
    press(tree, 'health-goals-type-lose');
    type(tree, 'health-goals-target-input', '75');
    type(tree, 'health-goals-starting-input', '90');
    // Opens the native picker, then drives its (mocked) `onChange` directly —
    // there is no `TextInput` to type a date string into any more.
    press(tree, 'health-goals-starting-date-input');
    act(() => {
      tree.root.findByProps({ testID: 'date-time-picker' }).props.onChange({}, new Date(2026, 0, 1));
    });
    await pressAsync(tree, 'health-goals-weight-save');

    expect(mockSaveWeightGoal).toHaveBeenCalledWith({
      target: 75,
      starting: 90,
      goalType: 'lose',
      unit: 'kg',
      startingDate: '2026-01-01',
    });
  });

  it('HEALTH-GOALS-121: a starting weight with NO date typed omits startingDate — the field keeps its own hint', async () => {
    const tree = await render();
    type(tree, 'health-goals-starting-input', '90');
    await pressAsync(tree, 'health-goals-weight-save');

    expect(mockSaveWeightGoal.mock.calls[0][0]).not.toHaveProperty('startingDate');
  });

  it('HEALTH-GOALS-122: clearing the starting weight sends startingDate: null, never an undated baseline', async () => {
    mockLoadHealthGoals.mockResolvedValue(
      snapshot({ weight: weightGoal({ startingKg: 90, startingDate: '2026-01-01' }) })
    );
    const tree = await render();
    type(tree, 'health-goals-starting-input', '');
    await pressAsync(tree, 'health-goals-weight-save');

    expect(mockSaveWeightGoal.mock.calls[0][0]).toMatchObject({ starting: null, startingDate: null });
  });

  it('HEALTH-GOALS-123: a malformed baseline date loaded from a stale snapshot is still refused on save', async () => {
    // A native picker can never PRODUCE an invalid calendar date — this now
    // exercises the defensive `parseDayKey` round-trip check via a hydrated
    // value instead (e.g. a legacy/corrupted cache row), which is the only
    // way this string reaches the screen at all.
    mockLoadHealthGoals.mockResolvedValue(
      snapshot({ weight: weightGoal({ startingKg: 90, startingDate: '2026-02-30' }) })
    );
    const tree = await render();
    await pressAsync(tree, 'health-goals-weight-save');

    expect(mockSaveWeightGoal).not.toHaveBeenCalled();
    expect(text(tree, 'health-goals-message')).toMatch(/YYYY-MM-DD/);
  });

  it('HEALTH-GOALS-124: an unparseable target weight is refused, and blank is accepted as "no target"', async () => {
    const tree = await render();
    // The field sanitises keystrokes as they are typed (letters never reach
    // state at all — see `sanitizeWeightInput`), so the only way a NON-EMPTY
    // value still fails `parseWeightInput` is a lone separator.
    type(tree, 'health-goals-target-input', '.');
    await pressAsync(tree, 'health-goals-weight-save');
    expect(mockSaveWeightGoal).not.toHaveBeenCalled();
    expect(text(tree, 'health-goals-message')).toMatch(/target weight/);

    type(tree, 'health-goals-target-input', '');
    await pressAsync(tree, 'health-goals-weight-save');
    expect(mockSaveWeightGoal).toHaveBeenCalledWith(expect.objectContaining({ target: null }));
  });

  it('HEALTH-GOALS-125: an unparseable starting weight is refused with its own message', async () => {
    const tree = await render();
    type(tree, 'health-goals-starting-input', '.');
    await pressAsync(tree, 'health-goals-weight-save');
    expect(mockSaveWeightGoal).not.toHaveBeenCalled();
    expect(text(tree, 'health-goals-message')).toMatch(/starting weight/);
  });

  it('HEALTH-GOALS-126: tapping a selected goal-type chip DESELECTS it', async () => {
    mockLoadHealthGoals.mockResolvedValue(snapshot({ weight: weightGoal({ goalType: 'maintain' }) }));
    const tree = await render();
    expect(node(tree, 'health-goals-type-maintain').props.accessibilityState).toEqual({
      selected: true,
    });

    press(tree, 'health-goals-type-maintain');
    expect(node(tree, 'health-goals-type-maintain').props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('HEALTH-GOALS-127: the type note is a generic invitation with nothing picked, and the type\'s own note once picked', async () => {
    const tree = await render();
    expect(text(tree, 'health-goals-type-note')).toMatch(/Pick one/);

    press(tree, 'health-goals-type-gain');
    expect(text(tree, 'health-goals-type-note')).toBe(
      'Suggested calories come out 15% above your daily burn, for lean gain.'
    );
  });

  it('HEALTH-GOALS-127b: a goal type the client no longer recognises shows an empty note rather than crashing', async () => {
    // Wire drift: a value the server once sent but this build's `GOAL_TYPES`
    // no longer lists. The chips themselves would all read "not selected",
    // and the note falls back to blank instead of indexing off the end.
    mockLoadHealthGoals.mockResolvedValue(
      snapshot({ weight: weightGoal({ goalType: 'bulk' as unknown as HealthWeightGoalType }) })
    );
    const tree = await render();
    expect(text(tree, 'health-goals-type-note')).toBe('');
    for (const key of ['lose', 'maintain', 'gain']) {
      expect(node(tree, `health-goals-type-${key}`).props.accessibilityState).toEqual({
        selected: false,
      });
    }
  });

  it('HEALTH-GOALS-128: progress shows once BOTH a target and a current weight exist; otherwise a targeted empty state', async () => {
    // Neither.
    const neither = await render();
    expect(has(neither, 'health-goals-progress')).toBe(false);
    expect(has(neither, 'health-goals-progress-empty')).toBe(false);

    // Target only — no logged weight yet.
    mockLoadHealthGoals.mockResolvedValue(snapshot({ weight: weightGoal({ targetKg: 75 }) }));
    const targetOnly = await render();
    expect(has(targetOnly, 'health-goals-progress')).toBe(false);
    expect(text(targetOnly, 'health-goals-progress-empty')).toMatch(/Log a weight reading/);

    // Both.
    mockLoadHealthGoals.mockResolvedValue(
      snapshot({ weight: weightGoal({ targetKg: 75, startingKg: 90 }), currentWeightKg: 82 })
    );
    const both = await render();
    expect(has(both, 'health-goals-progress')).toBe(true);
    expect(text(both, 'health-goals-progress')).toContain('% of the way there');
  });

  it('HEALTH-GOALS-128b: reaching (or passing) the target says so instead of "100% of the way there"', async () => {
    mockLoadHealthGoals.mockResolvedValue(
      snapshot({ weight: weightGoal({ targetKg: 75, startingKg: 90 }), currentWeightKg: 75 })
    );
    const tree = await render();
    expect(text(tree, 'health-goals-progress')).toContain('Target reached');
    expect(text(tree, 'health-goals-progress')).not.toContain('% of the way there');
  });

  it('HEALTH-GOALS-129: Clear target is offered only with a target set, and clears it through the store', async () => {
    const withTarget = await render();
    expect(has(withTarget, 'health-goals-weight-clear')).toBe(false); // no target loaded by default

    mockLoadHealthGoals.mockResolvedValue(snapshot({ weight: weightGoal({ targetKg: 75 }) }));
    const tree = await render();
    expect(has(tree, 'health-goals-weight-clear')).toBe(true);

    await pressAsync(tree, 'health-goals-weight-clear');
    expect(mockSaveWeightGoal).toHaveBeenCalledWith({ target: null, goalType: null });
    expect(input(tree, 'health-goals-target-input').props.value).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* Suggested targets                                                   */
/* ------------------------------------------------------------------ */

describe('HealthGoalsScreen — suggested targets', () => {
  it('HEALTH-GOALS-130: names exactly what is missing, and points at the Weight tab', async () => {
    const tree = await render();
    // Nothing but height/sex/etc — no logged weight, and none of the
    // biometrics are on the fixture's default EMPTY_WEIGHT_GOAL.
    const missingText = text(tree, 'health-goals-suggested-missing');
    expect(missingText).toContain('a weight reading');
    expect(missingText).toContain('your height');
    expect(missingText).toContain('your birth year');
    expect(missingText).toContain('your sex');
    expect(missingText).toContain('your activity level');
    expect(has(tree, 'health-goals-suggested-apply')).toBe(false);
  });

  it('HEALTH-GOALS-130b: exactly ONE missing input is named alone, with no "and"-joined list', async () => {
    mockLoadHealthGoals.mockResolvedValue(
      snapshot({
        currentWeightKg: 70,
        weight: weightGoal({
          heightCm: 175,
          gender: 'male',
          activityLevel: 'moderatelyActive',
          // birthYear left unset — the only missing input.
        }),
      })
    );
    const tree = await render();
    expect(text(tree, 'health-goals-suggested-missing')).toContain(
      'To work these out we need your birth year.'
    );
  });

  it('HEALTH-GOALS-131: with every input present, shows the basis and offers Apply', async () => {
    mockLoadHealthGoals.mockResolvedValue(
      snapshot({
        currentWeightKg: 70,
        weight: weightGoal({
          heightCm: 175,
          birthYear: 1996,
          gender: 'male',
          activityLevel: 'moderatelyActive',
          goalType: 'maintain',
        }),
      })
    );
    const tree = await render();

    expect(has(tree, 'health-goals-suggested-missing')).toBe(false);
    expect(text(tree, 'health-goals-suggested-basis')).toMatch(/Mifflin–St Jeor/);
    expect(has(tree, 'health-goals-suggested-apply')).toBe(true);
  });

  it('HEALTH-GOALS-132: Apply writes nutrition + activity + water, but leaves the weight target alone', async () => {
    mockLoadHealthGoals.mockResolvedValue(
      snapshot({
        currentWeightKg: 70,
        weight: weightGoal({
          targetKg: 68,
          heightCm: 175,
          birthYear: 1996,
          gender: 'male',
          activityLevel: 'moderatelyActive',
          goalType: 'maintain',
        }),
      })
    );
    const tree = await render();
    await pressAsync(tree, 'health-goals-suggested-apply');

    expect(mockSaveNutritionGoals).toHaveBeenCalled();
    expect(mockSaveActivityGoals).toHaveBeenCalled();
    expect(mockSetWaterTarget).toHaveBeenCalled();
    expect(mockSaveWeightGoal).not.toHaveBeenCalled();
    // The drafts reseed from what was actually saved.
    const savedNutrition = mockSaveNutritionGoals.mock.results[0].value as Promise<NutritionGoals>;
    await savedNutrition.then((goals) => {
      expect(input(tree, 'health-goals-calories-input').props.value).toBe(String(goals.calories));
    });
  });

  it('HEALTH-GOALS-133: the reminder about a per-weekday plan only appears when one is active', async () => {
    mockLoadHealthGoals.mockResolvedValue(
      snapshot({
        currentWeightKg: 70,
        weight: weightGoal({
          heightCm: 175,
          birthYear: 1996,
          gender: 'male',
          activityLevel: 'moderatelyActive',
        }),
        calorieWeek: calorieWeek({ usePerDay: true, days: [1800, null, null, null, null, null, null] }),
      })
    );
    const tree = await render();
    expect(allText(tree.toJSON())).toContain('per-weekday calorie plan is also left alone');
  });
});

/* ------------------------------------------------------------------ */
/* Saving state                                                        */
/* ------------------------------------------------------------------ */

describe('HealthGoalsScreen — saving state', () => {
  it('HEALTH-GOALS-134: the button that is saving reads "Saving…" and disables; the others stay live', async () => {
    let resolveSave!: (value: NutritionGoals) => void;
    mockSaveNutritionGoals.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    const tree = await render();

    act(() => {
      press(tree, 'health-goals-nutrition-save');
    });

    expect(text(tree, 'health-goals-nutrition-save')).toBe('Saving…');
    expect(node(tree, 'health-goals-nutrition-save').props.accessibilityState).toEqual({
      disabled: true,
    });
    expect(text(tree, 'health-goals-activity-save')).toBe('Save activity targets');

    await act(async () => {
      resolveSave(nutritionGoals());
    });
    expect(text(tree, 'health-goals-nutrition-save')).toBe('Save nutrition targets');
  });
});
