/**
 * HealthGoalsNutritionScreen — step 2 of 6 in Symply Health's goals
 * mini-flow.
 *
 * Drives the real screen and asserts: typed calories/macros save through
 * `saveNutritionGoals` (the SAME module the in-app Goals screen and the
 * Nutrition tab's calorie ring read from) and clamp into the route's bounds
 * rather than rejecting; leaving everything blank still advances without a
 * network call (skippable); a save failure never blocks "Continue"; and Back
 * pops to the previous step.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { NumberWheelPickerSheet } from '@components/ui';
import { ThemeProvider } from '@contexts/ThemeContext';

import { HealthGoalsNutritionScreen } from '../HealthGoalsNutritionScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: { onDone: 'CreateHousehold' | 'JoinHousehold' | 'complete' } = {
  onDone: 'complete',
};
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: mockRouteParams }),
}));

const mockSaveNutritionGoals = jest.fn();
jest.mock('@features/health/healthNutritionStorage', () => ({
  __esModule: true,
  saveNutritionGoals: (patch: unknown) => mockSaveNutritionGoals(patch),
  DEFAULT_NUTRITION_GOALS: { calories: 2000, protein: 120, carbs: 220, fat: 65 },
}));

const mockSaveCalorieWeek = jest.fn();
const mockSaveMacroWeek = jest.fn();
jest.mock('@features/health/healthGoalsStorage', () => {
  const actual = jest.requireActual('@features/health/healthGoalsStorage');
  return {
    ...actual,
    saveCalorieWeek: (week: unknown) => mockSaveCalorieWeek(week),
    saveMacroWeek: (week: unknown) => mockSaveMacroWeek(week),
  };
});

/**
 * `null` by default (no banner) so every existing test below — none of which
 * cares about the suggestion — keeps behaving exactly as it did before this
 * hook existed. `mockSuggestion` is reassigned per-test where the banner
 * itself is under test.
 */
let mockSuggestion: unknown = null;
jest.mock('@features/health/useHealthGoalsSuggestion', () => ({
  __esModule: true,
  useSuggestedGoals: () => mockSuggestion,
}));

function pressByTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.findAllByProps({ testID })[0];
  node.props.onPress?.();
}

/**
 * `handleContinue` is `async` (it awaits the save before navigating), and its
 * `onPress` wrapper (`() => void handleContinue()`) hands back no promise for
 * `act` to await — so a bare press leaves the post-`await` continuation
 * (the `finally` that calls `advance()`) unflushed. A few microtask hops
 * after the press settle it.
 */
async function pressAndSettle(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  await act(async () => {
    pressByTestId(tree, testID);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * `findAllByProps({ testID })` also matches `OnboardingNumberField` itself —
 * it forwards `testID` to the inner `TextInput` but keeps its own `onChange`
 * prop name — so the actual `TextInput` (the one with `onChangeText`) has to
 * be picked out explicitly rather than trusting match order.
 */
function typeInto(tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) {
  const node = tree.root
    .findAllByProps({ testID })
    .find((n) => typeof n.props.onChangeText === 'function');
  act(() => node?.props.onChangeText?.(text));
}

function fieldValue(tree: ReactTestRenderer.ReactTestRenderer, testID: string): string | undefined {
  return tree.root
    .findAllByProps({ testID })
    .find((n) => typeof n.props.onChangeText === 'function')?.props.value;
}

function toggleByTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string, value: boolean) {
  const node = tree.root
    .findAllByProps({ testID })
    .find((n) => typeof n.props.onValueChange === 'function');
  act(() => node?.props.onValueChange?.(value));
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthGoalsNutritionScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

describe('HealthGoalsNutritionScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { onDone: 'complete' };
    mockSuggestion = null;
    mockSaveNutritionGoals.mockResolvedValue({ calories: 2000, protein: 0, carbs: 0, fat: 0 });
    mockSaveCalorieWeek.mockResolvedValue({ usePerDay: true, days: [null, null, null, null, null, null, null] });
    mockSaveMacroWeek.mockResolvedValue({ usePerDay: true, days: [] });
  });

  it('saves the typed calorie target and advances to Activity', async () => {
    const tree = await renderScreen();
    typeInto(tree, 'onboarding-health-goals-calories-input', '2200');

    await pressAndSettle(tree, 'onboarding-health-goals-nutrition-screen-continue');

    expect(mockSaveNutritionGoals).toHaveBeenCalledWith({ calories: 2200 });
    expect(mockNavigate).toHaveBeenCalledWith('HealthGoalsActivity', { onDone: 'complete' });
  });

  it('shows a "Suggested for you" banner once a suggestion is available, and applies it', async () => {
    mockSuggestion = { calories: 2150, protein: 130, carbs: 240, fat: 70, steps: 9000, minutes: 40, waterCups: 9, bmr: 1600, tdee: 2150 };
    const tree = await renderScreen();

    expect(
      tree.root.findAllByProps({ testID: 'onboarding-health-goals-nutrition-suggestion' }).length
    ).toBeGreaterThan(0);

    act(() => pressByTestId(tree, 'onboarding-health-goals-nutrition-suggestion-apply'));

    expect(fieldValue(tree, 'onboarding-health-goals-calories-input')).toBe('2150');
    expect(fieldValue(tree, 'onboarding-health-goals-protein-input')).toBe('130');
    expect(fieldValue(tree, 'onboarding-health-goals-carbs-input')).toBe('240');
    expect(fieldValue(tree, 'onboarding-health-goals-fat-input')).toBe('70');
  });

  it('shows no suggestion banner when useSuggestedGoals has no answer', async () => {
    const tree = await renderScreen();

    expect(
      tree.root.findAllByProps({ testID: 'onboarding-health-goals-nutrition-suggestion' }).length
    ).toBe(0);
  });

  it('saves typed macros alongside calories', async () => {
    const tree = await renderScreen();
    act(() => pressByTestId(tree, 'onboarding-health-goals-macro-mode-grams'));
    typeInto(tree, 'onboarding-health-goals-calories-input', '2200');
    typeInto(tree, 'onboarding-health-goals-protein-input', '150');
    typeInto(tree, 'onboarding-health-goals-carbs-input', '200');
    typeInto(tree, 'onboarding-health-goals-fat-input', '70');

    await pressAndSettle(tree, 'onboarding-health-goals-nutrition-screen-continue');

    expect(mockSaveNutritionGoals).toHaveBeenCalledWith({
      calories: 2200,
      protein: 150,
      carbs: 200,
      fat: 70,
    });
  });

  it('clamps an out-of-bounds calorie value rather than rejecting it', async () => {
    const tree = await renderScreen();
    // Sanitized to 7 digits max, well above the route's 10,000 kcal ceiling.
    typeInto(tree, 'onboarding-health-goals-calories-input', '9999999');

    await pressAndSettle(tree, 'onboarding-health-goals-nutrition-screen-continue');

    expect(mockSaveNutritionGoals).toHaveBeenCalledWith({ calories: 10000 });
  });

  /**
   * `style` sizes the placeholder too — RN has no separate hook for it — so
   * the empty field must NOT inherit the bold "hero stat" look meant for an
   * actual typed/picked value (`fontWeight: '700'`), or "Tap to choose" reads
   * as oversized, bold placeholder text instead of an ordinary prompt.
   */
  it('does not bold the placeholder — only an actual calorie value gets the hero-stat weight', async () => {
    const tree = await renderScreen();
    const input = () =>
      tree.root
        .findAllByProps({ testID: 'onboarding-health-goals-calories-input' })
        .find((n) => typeof n.props.onChangeText === 'function');
    const flattenedWeight = () => {
      const style = input()?.props.style;
      const flat = (Array.isArray(style) ? style : [style]).reduce(
        (acc: Record<string, unknown>, s) => ({ ...acc, ...(s ?? {}) }),
        {}
      );
      return flat.fontWeight;
    };

    expect(flattenedWeight()).not.toBe('700');

    typeInto(tree, 'onboarding-health-goals-calories-input', '2200');
    expect(flattenedWeight()).toBe('700');
  });

  it('fills the calorie field by confirming a value from the wheel picker', async () => {
    const tree = await renderScreen();
    const findField = () =>
      tree.root
        .findAllByProps({ testID: 'onboarding-health-goals-calories-input' })
        .find((n) => typeof n.props.onFocus === 'function');
    act(() => findField()?.props.onFocus());
    act(() => {
      tree.root.findByType(NumberWheelPickerSheet).props.onConfirm(2000);
    });

    await pressAndSettle(tree, 'onboarding-health-goals-nutrition-screen-continue');

    expect(mockSaveNutritionGoals).toHaveBeenCalledWith({ calories: 2000 });
  });

  it('fills a per-day calorie row by confirming a value from the shared wheel picker', async () => {
    const tree = await renderScreen();
    typeInto(tree, 'onboarding-health-goals-calories-input', '2000');
    act(() => pressByTestId(tree, 'onboarding-health-goals-calorie-mode-custom'));

    const findRow = () =>
      tree.root
        .findAllByProps({ testID: 'onboarding-health-goals-week-saturday_calories' })
        .find((n) => typeof n.props.onFocus === 'function');
    act(() => findRow()?.props.onFocus());
    act(() => {
      tree.root.findByType(NumberWheelPickerSheet).props.onConfirm(2500);
    });

    await pressAndSettle(tree, 'onboarding-health-goals-nutrition-screen-continue');

    expect(mockSaveCalorieWeek).toHaveBeenCalledWith({
      usePerDay: true,
      days: [2000, 2000, 2000, 2000, 2000, 2500, 2000],
    });
  });

  it('advances without saving when every field is left blank', async () => {
    const tree = await renderScreen();

    await pressAndSettle(tree, 'onboarding-health-goals-nutrition-screen-continue');

    expect(mockSaveNutritionGoals).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('HealthGoalsActivity', { onDone: 'complete' });
  });

  it('still advances when the save fails', async () => {
    mockSaveNutritionGoals.mockRejectedValue(new Error('network down'));
    const tree = await renderScreen();
    typeInto(tree, 'onboarding-health-goals-calories-input', '2200');

    await pressAndSettle(tree, 'onboarding-health-goals-nutrition-screen-continue');

    expect(mockNavigate).toHaveBeenCalledWith('HealthGoalsActivity', { onDone: 'complete' });
  });

  it('pops to the previous step on Back', async () => {
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, 'onboarding-health-goals-nutrition-screen-back');
    });

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  /**
   * `InfoButton`'s sheet body is a `View` at `${testID}-content`, mounted only
   * while its `BottomSheet` is `visible` (a plain `visible ? … : null`, not a
   * CSS hide) — so presence, not a `variant` filter, is what tells "closed"
   * from "open" here.
   */
  function infoOpen(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
    return tree.root.findAllByProps({ testID: `${testID}-content` }).length > 0;
  }

  it('opens the daily calories explanation sheet', async () => {
    const tree = await renderScreen();
    expect(infoOpen(tree, 'onboarding-health-goals-calories-info')).toBe(false);

    act(() => pressByTestId(tree, 'onboarding-health-goals-calories-info-toggle'));
    expect(infoOpen(tree, 'onboarding-health-goals-calories-info')).toBe(true);
  });

  it('opens the macro preset explanation sheet, in default percent mode, with a chart per preset', async () => {
    const tree = await renderScreen();
    expect(infoOpen(tree, 'onboarding-health-goals-macro-preset-info')).toBe(false);

    act(() => pressByTestId(tree, 'onboarding-health-goals-macro-preset-info-toggle'));
    expect(infoOpen(tree, 'onboarding-health-goals-macro-preset-info')).toBe(true);

    for (const key of ['balanced', 'lowCarb', 'highProtein']) {
      expect(
        tree.root.findAllByProps({
          testID: `onboarding-health-goals-macro-preset-info-${key}-bar`,
        }).length
      ).toBeGreaterThan(0);
    }

    // The three real citations (AMDR, Feinman et al., ISSN) render as tappable
    // source links, not just asserted-but-invisible copy.
    expect(
      tree.root.findAllByProps({ testID: 'onboarding-health-goals-macro-preset-info-sources' })
        .length
    ).toBeGreaterThan(0);
  });

  it('focusing the calories field opens the wheel picker, and "Enter manually" switches it to the keyboard', async () => {
    const tree = await renderScreen();
    const findField = () =>
      tree.root
        .findAllByProps({ testID: 'onboarding-health-goals-calories-input' })
        .find((n) => typeof n.props.onFocus === 'function');

    expect(findField()?.props.showSoftInputOnFocus).toBe(false);
    expect(tree.root.findAllByProps({ testID: 'onboarding-health-goals-calories-picker-manual' }).length).toBe(0);

    act(() => findField()?.props.onFocus());
    expect(
      tree.root.findAllByProps({ testID: 'onboarding-health-goals-calories-picker-manual' }).length
    ).toBeGreaterThan(0);

    act(() =>
      pressByTestId(tree, 'onboarding-health-goals-calories-picker-manual')
    );

    expect(findField()?.props.showSoftInputOnFocus).toBe(true);
  });

  it('focusing a per-day row opens the same wheel picker, and "Enter manually" switches that row to the keyboard', async () => {
    const tree = await renderScreen();
    typeInto(tree, 'onboarding-health-goals-calories-input', '2000');
    act(() => pressByTestId(tree, 'onboarding-health-goals-calorie-mode-custom'));

    const findRow = () =>
      tree.root
        .findAllByProps({ testID: 'onboarding-health-goals-week-monday_calories' })
        .find((n) => typeof n.props.onFocus === 'function');

    expect(findRow()?.props.showSoftInputOnFocus).toBe(false);

    act(() => findRow()?.props.onFocus());
    expect(
      tree.root.findAllByProps({ testID: 'onboarding-health-goals-calories-picker-manual' }).length
    ).toBeGreaterThan(0);

    act(() => pressByTestId(tree, 'onboarding-health-goals-calories-picker-manual'));

    expect(findRow()?.props.showSoftInputOnFocus).toBe(true);
  });

  describe('custom week', () => {
    it('saves a per-day calorie plan when Custom week is selected', async () => {
      const tree = await renderScreen();
      typeInto(tree, 'onboarding-health-goals-calories-input', '2000');
      act(() => pressByTestId(tree, 'onboarding-health-goals-calorie-mode-custom'));
      typeInto(tree, 'onboarding-health-goals-week-saturday_calories', '2200');
      typeInto(tree, 'onboarding-health-goals-week-sunday_calories', '2200');

      await pressAndSettle(tree, 'onboarding-health-goals-nutrition-screen-continue');

      expect(mockSaveNutritionGoals).toHaveBeenCalledWith({ calories: 2000 });
      expect(mockSaveCalorieWeek).toHaveBeenCalledWith({
        usePerDay: true,
        days: [2000, 2000, 2000, 2000, 2000, 2200, 2200],
      });
    });

    it('does not save a per-day plan after switching Custom week back off', async () => {
      const tree = await renderScreen();
      typeInto(tree, 'onboarding-health-goals-calories-input', '2000');
      act(() => pressByTestId(tree, 'onboarding-health-goals-calorie-mode-custom'));
      act(() => pressByTestId(tree, 'onboarding-health-goals-calorie-mode-all'));

      await pressAndSettle(tree, 'onboarding-health-goals-nutrition-screen-continue');

      expect(mockSaveCalorieWeek).not.toHaveBeenCalled();
      expect(mockSaveNutritionGoals).toHaveBeenCalledWith({ calories: 2000 });
    });

    it('never renders the per-day rows until Custom week is selected', async () => {
      const tree = await renderScreen();
      expect(tree.root.findAllByProps({ testID: 'onboarding-health-goals-week' }).length).toBe(0);

      act(() => pressByTestId(tree, 'onboarding-health-goals-calorie-mode-custom'));
      expect(
        tree.root.findAllByProps({ testID: 'onboarding-health-goals-week' }).length
      ).toBeGreaterThan(0);
    });
  });

  describe('percent mode', () => {
    it('converts typed percentages into grams using the calorie target', async () => {
      const tree = await renderScreen();
      typeInto(tree, 'onboarding-health-goals-calories-input', '2000');
      act(() => pressByTestId(tree, 'onboarding-health-goals-macro-mode-percent'));
      typeInto(tree, 'onboarding-health-goals-protein-percent-input', '30');
      typeInto(tree, 'onboarding-health-goals-carbs-percent-input', '40');
      typeInto(tree, 'onboarding-health-goals-fat-percent-input', '30');

      await pressAndSettle(tree, 'onboarding-health-goals-nutrition-screen-continue');

      // 30% / 40% / 30% of 2,000 kcal at 4/4/9 kcal per gram.
      expect(mockSaveNutritionGoals).toHaveBeenCalledWith({
        calories: 2000,
        protein: 150,
        carbs: 200,
        fat: 67,
      });
    });

    it('fills all three percent fields from a preset chip', async () => {
      const tree = await renderScreen();
      typeInto(tree, 'onboarding-health-goals-calories-input', '2000');
      act(() => pressByTestId(tree, 'onboarding-health-goals-macro-mode-percent'));
      act(() => pressByTestId(tree, 'onboarding-health-goals-macro-percent-preset-lowCarb'));

      await pressAndSettle(tree, 'onboarding-health-goals-nutrition-screen-continue');

      // Low-carb preset: 40% protein / 20% carbs / 40% fat of 2,000 kcal.
      expect(mockSaveNutritionGoals).toHaveBeenCalledWith({
        calories: 2000,
        protein: 200,
        carbs: 100,
        fat: 89,
      });
    });

    it('leaves macros unset when there is no calorie target to convert against', async () => {
      const tree = await renderScreen();
      act(() => pressByTestId(tree, 'onboarding-health-goals-macro-mode-percent'));
      typeInto(tree, 'onboarding-health-goals-protein-percent-input', '30');

      await pressAndSettle(tree, 'onboarding-health-goals-nutrition-screen-continue');

      expect(mockSaveNutritionGoals).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('HealthGoalsActivity', { onDone: 'complete' });
    });

    it('does not send grams-mode fields left behind after switching to percent mode', async () => {
      const tree = await renderScreen();
      typeInto(tree, 'onboarding-health-goals-calories-input', '2000');
      act(() => pressByTestId(tree, 'onboarding-health-goals-macro-mode-grams'));
      typeInto(tree, 'onboarding-health-goals-protein-input', '999');
      act(() => pressByTestId(tree, 'onboarding-health-goals-macro-mode-percent'));
      typeInto(tree, 'onboarding-health-goals-protein-percent-input', '30');

      await pressAndSettle(tree, 'onboarding-health-goals-nutrition-screen-continue');

      expect(mockSaveNutritionGoals).toHaveBeenCalledWith({ calories: 2000, protein: 150 });
    });
  });

  describe('per-day macro plan', () => {
    function setFlatMacros(tree: ReactTestRenderer.ReactTestRenderer) {
      typeInto(tree, 'onboarding-health-goals-calories-input', '2000');
      act(() => pressByTestId(tree, 'onboarding-health-goals-macro-mode-grams'));
      typeInto(tree, 'onboarding-health-goals-protein-input', '150');
      typeInto(tree, 'onboarding-health-goals-carbs-input', '200');
      typeInto(tree, 'onboarding-health-goals-fat-input', '70');
    }

    it('does not render the per-day macro toggle until there is a flat target to branch from', async () => {
      const tree = await renderScreen();
      expect(
        tree.root.findAllByProps({ testID: 'onboarding-health-goals-macro-week-toggle' }).length
      ).toBe(0);

      setFlatMacros(tree);
      expect(
        tree.root.findAllByProps({ testID: 'onboarding-health-goals-macro-week-toggle' }).length
      ).toBeGreaterThan(0);
    });

    it('seeds the visible day from the flat macro targets when turned on', async () => {
      const tree = await renderScreen();
      setFlatMacros(tree);

      toggleByTestId(tree, 'onboarding-health-goals-macro-week-toggle', true);

      expect(fieldValue(tree, 'onboarding-health-goals-macro-week-protein-input')).toBe('150');
      expect(fieldValue(tree, 'onboarding-health-goals-macro-week-carbs-input')).toBe('200');
      expect(fieldValue(tree, 'onboarding-health-goals-macro-week-fat-input')).toBe('70');
    });

    it('saves a per-day plan carrying the edited day, leaving the rest at the seeded flat split', async () => {
      const tree = await renderScreen();
      setFlatMacros(tree);
      toggleByTestId(tree, 'onboarding-health-goals-macro-week-toggle', true);

      act(() => pressByTestId(tree, 'onboarding-health-goals-macro-week-day-mon'));
      typeInto(tree, 'onboarding-health-goals-macro-week-protein-input', '220');

      await pressAndSettle(tree, 'onboarding-health-goals-nutrition-screen-continue');

      expect(mockSaveMacroWeek).toHaveBeenCalled();
      const saved = mockSaveMacroWeek.mock.calls[0][0];
      expect(saved.usePerDay).toBe(true);
      expect(saved.days[0]).toMatchObject({ protein: 220, carbs: 200, fat: 70 });
      expect(saved.days[1]).toMatchObject({ protein: 150, carbs: 200, fat: 70 }); // Tuesday: untouched, still seeded
    });

    it('does not save a per-day macro plan while the toggle stays off', async () => {
      const tree = await renderScreen();
      setFlatMacros(tree);

      await pressAndSettle(tree, 'onboarding-health-goals-nutrition-screen-continue');

      expect(mockSaveMacroWeek).not.toHaveBeenCalled();
    });
  });
});
