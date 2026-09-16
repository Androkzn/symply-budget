/**
 * HealthGoalsWaterScreen — step 5 of 7 in Symply Health's goals mini-flow.
 *
 * Drives the real screen and asserts: the saved display-unit preference
 * loads on mount; a typed amount saves through `setWaterGoalMl` +
 * `saveWaterUnit` (the SAME two functions the dedicated Water tab's own goal
 * editor and ml/oz toggle use) together, in millilitres regardless of which
 * unit was showing; switching units converts whatever is already typed
 * rather than discarding it; a preset chip fills the field in the CURRENT
 * unit; leaving it blank skips both network calls and still advances; the
 * "Suggested for you" banner fills the field from `useSuggestedGoals()`; and
 * Back pops to the previous step.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { HealthGoalsWaterScreen } from '../HealthGoalsWaterScreen';

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

const mockLoadWaterPrefs = jest.fn();
const mockSetWaterGoalMl = jest.fn();
const mockSaveWaterUnit = jest.fn();
jest.mock('@features/health/healthWaterStorage', () => {
  const actual = jest.requireActual('@features/health/healthWaterStorage');
  return {
    __esModule: true,
    ...actual,
    loadWaterPrefs: () => mockLoadWaterPrefs(),
    setWaterGoalMl: (ml: number) => mockSetWaterGoalMl(ml),
    saveWaterUnit: (unit: unknown) => mockSaveWaterUnit(unit),
  };
});

/** `null` by default (no banner) — see the same note in HealthGoalsNutritionScreen.test.tsx. */
let mockSuggestion: unknown = null;
jest.mock('@features/health/useHealthGoalsSuggestion', () => ({
  __esModule: true,
  useSuggestedGoals: () => mockSuggestion,
}));

function pressByTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.findAllByProps({ testID })[0];
  node.props.onPress?.();
}

function fieldNode(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root
    .findAllByProps({ testID })
    .find((n) => typeof n.props.onChangeText === 'function');
}

function typeInto(tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) {
  const node = fieldNode(tree, testID);
  act(() => node?.props.onChangeText?.(text));
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
        <HealthGoalsWaterScreen />
      </ThemeProvider>,
    );
    await Promise.resolve();
  });
  return tree;
}

describe('HealthGoalsWaterScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { onDone: 'complete' };
    mockSuggestion = null;
    mockLoadWaterPrefs.mockResolvedValue({ unit: 'ml' });
    mockSetWaterGoalMl.mockResolvedValue({ totalMl: 0, goalMl: 2000, date: '2026-01-01', entries: [] });
    mockSaveWaterUnit.mockResolvedValue({ unit: 'ml' });
  });

  it('saves a typed ml amount and the unit together, and advances to EssentialPermissions', async () => {
    const tree = await renderScreen();
    typeInto(tree, 'onboarding-health-goals-water-input', '2500');

    await pressAndSettle(tree, 'onboarding-health-goals-water-screen-continue');

    expect(mockSetWaterGoalMl).toHaveBeenCalledWith(2500);
    expect(mockSaveWaterUnit).toHaveBeenCalledWith('ml');
    expect(mockNavigate).toHaveBeenCalledWith('EssentialPermissions', { onDone: 'complete' });
  });

  it('loads the saved unit preference on mount and labels the field with it', async () => {
    mockLoadWaterPrefs.mockResolvedValue({ unit: 'cups' });
    const tree = await renderScreen();

    expect(fieldNode(tree, 'onboarding-health-goals-water-input')?.props.accessibilityLabel).toBe(
      'Daily water in cups'
    );
  });

  it('switching units converts whatever is already typed', async () => {
    const tree = await renderScreen();
    typeInto(tree, 'onboarding-health-goals-water-input', '2000');

    act(() => pressByTestId(tree, 'onboarding-health-goals-water-unit-L'));

    expect(fieldNode(tree, 'onboarding-health-goals-water-input')?.props.value).toBe('2.0');

    await pressAndSettle(tree, 'onboarding-health-goals-water-screen-continue');
    // 2.0 L saved as its millilitre equivalent, not the raw typed "2.0".
    expect(mockSetWaterGoalMl).toHaveBeenCalledWith(2000);
    expect(mockSaveWaterUnit).toHaveBeenCalledWith('L');
  });

  it('fills the field from a preset chip in the current unit', async () => {
    const tree = await renderScreen();
    act(() => pressByTestId(tree, 'onboarding-health-goals-water-unit-cups'));
    act(() => pressByTestId(tree, 'onboarding-health-goals-water-preset-10'));

    await pressAndSettle(tree, 'onboarding-health-goals-water-screen-continue');

    expect(mockSetWaterGoalMl).toHaveBeenCalledWith(2400); // 10 cups × 240 ml
    expect(mockSaveWaterUnit).toHaveBeenCalledWith('cups');
  });

  it('advances without saving when left blank', async () => {
    const tree = await renderScreen();

    await pressAndSettle(tree, 'onboarding-health-goals-water-screen-continue');

    expect(mockSetWaterGoalMl).not.toHaveBeenCalled();
    expect(mockSaveWaterUnit).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('EssentialPermissions', { onDone: 'complete' });
  });

  it('shows a "Suggested for you" banner once a suggestion is available, and applies it', async () => {
    mockSuggestion = { calories: 2150, protein: 130, carbs: 240, fat: 70, steps: 9000, minutes: 40, waterCups: 9, bmr: 1600, tdee: 2150 };
    const tree = await renderScreen();

    expect(
      tree.root.findAllByProps({ testID: 'onboarding-health-goals-water-suggestion' }).length
    ).toBeGreaterThan(0);

    act(() => pressByTestId(tree, 'onboarding-health-goals-water-suggestion-apply'));

    expect(fieldNode(tree, 'onboarding-health-goals-water-input')?.props.value).toBe('2160'); // 9 × 240 ml
  });

  it('shows no suggestion banner when useSuggestedGoals has no answer', async () => {
    const tree = await renderScreen();

    expect(
      tree.root.findAllByProps({ testID: 'onboarding-health-goals-water-suggestion' }).length
    ).toBe(0);
  });

  it('pops to the previous step on Back', async () => {
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, 'onboarding-health-goals-water-screen-back');
    });

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
