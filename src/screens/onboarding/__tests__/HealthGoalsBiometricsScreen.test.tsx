/**
 * HealthGoalsBiometricsScreen — "About you", step 1 of 7 and the FIRST of
 * Symply Health's GOALS mini-flow (moved to the front so the later steps'
 * suggestions have something to work from).
 *
 * Drives the real screen and asserts: gender, age (converted to a birth
 * year), height and activity level each save through `saveWeightGoal` (the
 * SAME module the Weight tab's "Goal & body details" section uses); leaving
 * everything untouched skips the network call; "Continue" always hands off
 * to `HealthGoalsWeight` with `onDone` carried through unresolved; each field
 * has its own "why this matters" explanation sheet; and Back pops to the
 * previous step.
 *
 * Gender and activity level are `OnboardingWheelSelectField`s — dropdown
 * wells that open an `OptionWheelPickerSheet`. Rather than simulating a real
 * wheel spin, tests grab the mounted sheet by its `testID` and call
 * `onConfirm` directly, the same escape hatch `HealthGoalsNutritionScreen.test.tsx`
 * uses for `NumberWheelPickerSheet`.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { OptionWheelPickerSheet } from '@components/ui';
import { ThemeProvider } from '@contexts/ThemeContext';

import { HealthGoalsBiometricsScreen } from '../HealthGoalsBiometricsScreen';

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

const mockSaveWeightGoal = jest.fn();
jest.mock('@features/health/healthWeightStorage', () => ({
  __esModule: true,
  ...jest.requireActual('@features/health/healthWeightStorage'),
  saveWeightGoal: (patch: unknown) => mockSaveWeightGoal(patch),
}));

function pressByTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.findAllByProps({ testID })[0];
  node.props.onPress?.();
}

function typeInto(tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) {
  const node = tree.root
    .findAllByProps({ testID })
    .find((n) => typeof n.props.onChangeText === 'function');
  act(() => node?.props.onChangeText?.(text));
}

/** Opens a field's wheel sheet the same way a real tap does — via the well's `onFocus`. */
function focusByTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  // Disambiguate by `onChangeText`, not `onFocus`: `OnboardingWheelNumberField`'s
  // outer `Card` shares this same `testID` (it is the real tap target while the
  // `TextInput` itself is `pointerEvents: 'none'`) and, being a `Pressable`,
  // also carries its own internal `onFocus` — `onChangeText` is exclusive to
  // the actual `TextInput`.
  const node = tree.root
    .findAllByProps({ testID })
    .find((n) => typeof n.props.onChangeText === 'function');
  act(() => node?.props.onFocus?.());
}

/** Confirms a value on the `OptionWheelPickerSheet` mounted at `testID` (the field's `${testID}-picker`). */
function selectOption(tree: ReactTestRenderer.ReactTestRenderer, testID: string, key: string) {
  const sheet = tree.root
    .findAllByType(OptionWheelPickerSheet as unknown as React.ComponentType<Record<string, unknown>>)
    .find((node) => node.props.testID === testID);
  act(() => (sheet?.props as { onConfirm?: (value: string) => void }).onConfirm?.(key));
}

async function pressAndSettle(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  await act(async () => {
    pressByTestId(tree, testID);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthGoalsBiometricsScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

/**
 * `InfoButton`'s sheet body is a `View` at `${testID}-content`, mounted only
 * while its `BottomSheet` is `visible` — presence, not a `variant` filter,
 * is what tells "closed" from "open" here. Same helper
 * `HealthGoalsNutritionScreen.test.tsx` uses for its own info sheets.
 */
function infoOpen(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return tree.root.findAllByProps({ testID: `${testID}-content` }).length > 0;
}

describe('HealthGoalsBiometricsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { onDone: 'complete' };
    mockSaveWeightGoal.mockResolvedValue({});
  });

  it('saves gender and age (converted to a birth year) and hands off to Weight', async () => {
    const tree = await renderScreen();
    selectOption(tree, 'onboarding-health-goals-gender-picker', 'female');
    typeInto(tree, 'onboarding-health-goals-age-input', '30');

    await pressAndSettle(tree, 'onboarding-health-goals-biometrics-screen-continue');

    const expectedBirthYear = new Date().getFullYear() - 30;
    expect(mockSaveWeightGoal).toHaveBeenCalledWith({ gender: 'female', birthYear: expectedBirthYear });
    expect(mockNavigate).toHaveBeenCalledWith('HealthGoalsWeight', { onDone: 'complete' });
  });

  it('saves gender on its own, with nothing else set', async () => {
    const tree = await renderScreen();
    selectOption(tree, 'onboarding-health-goals-gender-picker', 'male');

    await pressAndSettle(tree, 'onboarding-health-goals-biometrics-screen-continue');

    expect(mockSaveWeightGoal).toHaveBeenCalledWith({ gender: 'male' });
  });

  it('saves a typed height and a picked activity level', async () => {
    const tree = await renderScreen();
    typeInto(tree, 'onboarding-health-goals-height-input', '178');
    selectOption(tree, 'onboarding-health-goals-activity-level-picker', 'moderatelyActive');

    await pressAndSettle(tree, 'onboarding-health-goals-biometrics-screen-continue');

    expect(mockSaveWeightGoal).toHaveBeenCalledWith({
      heightCm: 178,
      activityLevel: 'moderatelyActive',
    });
  });

  it('re-picking an activity level replaces the previous selection', async () => {
    const tree = await renderScreen();
    selectOption(tree, 'onboarding-health-goals-activity-level-picker', 'veryActive');
    selectOption(tree, 'onboarding-health-goals-activity-level-picker', 'sedentary');

    await pressAndSettle(tree, 'onboarding-health-goals-biometrics-screen-continue');

    expect(mockSaveWeightGoal).toHaveBeenCalledWith({ activityLevel: 'sedentary' });
  });

  it('saves all four fields together', async () => {
    const tree = await renderScreen();
    selectOption(tree, 'onboarding-health-goals-gender-picker', 'other');
    typeInto(tree, 'onboarding-health-goals-age-input', '45');
    typeInto(tree, 'onboarding-health-goals-height-input', '165');
    selectOption(tree, 'onboarding-health-goals-activity-level-picker', 'sedentary');

    await pressAndSettle(tree, 'onboarding-health-goals-biometrics-screen-continue');

    expect(mockSaveWeightGoal).toHaveBeenCalledWith({
      gender: 'other',
      birthYear: new Date().getFullYear() - 45,
      heightCm: 165,
      activityLevel: 'sedentary',
    });
  });

  it('carries a non-"complete" onDone through to Weight unresolved', async () => {
    mockRouteParams = { onDone: 'CreateHousehold' };
    const tree = await renderScreen();

    await pressAndSettle(tree, 'onboarding-health-goals-biometrics-screen-continue');

    expect(mockNavigate).toHaveBeenCalledWith('HealthGoalsWeight', { onDone: 'CreateHousehold' });
  });

  it('hands off to Weight without saving when nothing is set', async () => {
    const tree = await renderScreen();

    await pressAndSettle(tree, 'onboarding-health-goals-biometrics-screen-continue');

    expect(mockSaveWeightGoal).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('HealthGoalsWeight', { onDone: 'complete' });
  });

  it('opens the activity-level explanation sheet, listing all five levels', async () => {
    const tree = await renderScreen();
    expect(infoOpen(tree, 'onboarding-health-goals-activity-level-info')).toBe(false);

    act(() => pressByTestId(tree, 'onboarding-health-goals-activity-level-info-toggle'));
    expect(infoOpen(tree, 'onboarding-health-goals-activity-level-info')).toBe(true);

    // Description text is unique to the info sheet body — unlike the level
    // NAMES, which also render on the field's own wheel and so would not tell
    // "the sheet rendered its own content" from "the field is on screen".
    for (const description of [
      'Little or no exercise, a desk job.',
      'Light exercise or sports 1–3 days a week.',
      'Moderate exercise or sports 3–5 days a week.',
      'Hard exercise or sports 6–7 days a week.',
      'Very hard exercise, a physical job, or training twice a day.',
    ]) {
      expect(tree.root.findAllByProps({ children: description }).length).toBeGreaterThan(0);
    }
  });

  it('gives every activity level a checkable steps and minutes metric in the explanation sheet', async () => {
    const tree = await renderScreen();
    act(() => pressByTestId(tree, 'onboarding-health-goals-activity-level-info-toggle'));

    // Same figures `STEPS_BY_LEVEL`/`MINUTES_BY_LEVEL` (healthGoalsStorage.ts)
    // use for the post-onboarding step/movement targets — shown here as a
    // self-assessment hint so picking a level isn't a guess from adjectives
    // alone.
    for (const metric of [
      'usually under 6,000 steps a day',
      'roughly 6,000–8,000 steps a day',
      'roughly 8,000–10,000 steps a day',
      'roughly 10,000–12,000 steps a day',
      '12,000+ steps a day',
      '~20 min of movement most days',
      '~30 min of movement most days',
      '~45 min of movement most days',
      '~60 min of movement most days',
      '~90 min of movement most days',
    ]) {
      expect(tree.root.findAllByProps({ children: metric }).length).toBeGreaterThan(0);
    }
  });

  it('opens the gender, age and height explanation sheets', async () => {
    const tree = await renderScreen();

    for (const field of ['gender', 'age', 'height']) {
      const infoTestID = `onboarding-health-goals-${field}-info`;
      expect(infoOpen(tree, infoTestID)).toBe(false);
      act(() => pressByTestId(tree, `${infoTestID}-toggle`));
      expect(infoOpen(tree, infoTestID)).toBe(true);
    }
  });

  it('moves the Units toggle inside the Height wheel instead of a separate field', async () => {
    const tree = await renderScreen();

    // No standalone "Units" dropdown field/picker anymore.
    expect(tree.root.findAllByProps({ testID: 'onboarding-health-goals-units' }).length).toBe(0);
    expect(tree.root.findAllByProps({ testID: 'onboarding-health-goals-units-picker' }).length).toBe(0);

    // Opening the Height wheel reveals the Metric/Imperial switch inside it.
    focusByTestId(tree, 'onboarding-health-goals-height-input');
    expect(
      tree.root.findAllByProps({ testID: 'onboarding-health-goals-unit-system-imperial' }).length,
    ).toBeGreaterThan(0);
  });

  it('switching to Imperial inside the Height wheel relabels the field to inches', async () => {
    const tree = await renderScreen();
    focusByTestId(tree, 'onboarding-health-goals-height-input');

    act(() => pressByTestId(tree, 'onboarding-health-goals-unit-system-imperial'));

    expect(tree.root.findAllByProps({ children: 'Height (in)' }).length).toBeGreaterThan(0);
  });

  it('shows the current unit choice as a hint pill without needing to open the Height wheel first', async () => {
    // The switch itself only lives inside the Height wheel sheet — nothing
    // upstream of that ever surfaces it. Someone who skips Height (it is
    // optional) must still be able to SEE what is currently selected.
    const tree = await renderScreen();

    expect(
      tree.root.findAllByProps({ testID: 'onboarding-health-goals-height-input-units-hint' }).length,
    ).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ children: 'Metric' }).length).toBeGreaterThan(0);
  });

  it('tapping the hint pill opens the Height wheel and its Metric/Imperial switch, same as tapping Height itself', async () => {
    const tree = await renderScreen();

    expect(
      tree.root.findAllByProps({ testID: 'onboarding-health-goals-unit-system-imperial' }).length,
    ).toBe(0);

    act(() => pressByTestId(tree, 'onboarding-health-goals-height-input-units-hint'));

    expect(
      tree.root.findAllByProps({ testID: 'onboarding-health-goals-unit-system-imperial' }).length,
    ).toBeGreaterThan(0);
  });

  it('the hint pill relabels to Imperial once that is chosen', async () => {
    const tree = await renderScreen();
    focusByTestId(tree, 'onboarding-health-goals-height-input');

    act(() => pressByTestId(tree, 'onboarding-health-goals-unit-system-imperial'));

    expect(
      tree.root
        .findAllByProps({ testID: 'onboarding-health-goals-height-input-units-hint' })[0]
        .findAllByProps({ children: 'Imperial' }).length,
    ).toBeGreaterThan(0);
  });

  it('gives every activity level an icon and description for the wheel panel', async () => {
    const tree = await renderScreen();
    const sheet = tree.root
      .findAllByType(OptionWheelPickerSheet as unknown as React.ComponentType<Record<string, unknown>>)
      .find((node) => node.props.testID === 'onboarding-health-goals-activity-level-picker');

    const options =
      (sheet?.props as { options?: { key: string; description?: string; icon?: string }[] }).options ?? [];
    expect(options.length).toBe(5);
    for (const option of options) {
      expect(option.description).toBeTruthy();
      expect(option.icon).toBeTruthy();
    }
  });

  it('pops to the previous step on Back', async () => {
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, 'onboarding-health-goals-biometrics-screen-back');
    });

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('opens the "science behind these numbers" deep-dive sheet', async () => {
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: 'health-science-sheet-content' }).length).toBe(0);

    act(() => pressByTestId(tree, 'onboarding-health-goals-science-link'));

    expect(
      tree.root.findAllByProps({ testID: 'health-science-sheet-content' }).length,
    ).toBeGreaterThan(0);
  });
});
