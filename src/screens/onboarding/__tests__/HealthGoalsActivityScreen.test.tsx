/**
 * HealthGoalsActivityScreen — step 4 of 6 in Symply Health's goals
 * mini-flow.
 *
 * Drives the real screen and asserts: typed steps/minutes save through
 * `saveActivityGoals` (the SAME module the Activity tab's step target reads
 * from) and clamp into bounds rather than rejecting; a preset chip fills the
 * field; leaving both blank skips the network call and still advances; and
 * Back pops to the previous step.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { HealthGoalsActivityScreen } from '../HealthGoalsActivityScreen';

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

const mockSaveActivityGoals = jest.fn();
jest.mock('@features/health/healthActivityStorage', () => ({
  __esModule: true,
  saveActivityGoals: (patch: unknown) => mockSaveActivityGoals(patch),
}));

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

function typeInto(tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) {
  const node = tree.root
    .findAllByProps({ testID })
    .find((n) => typeof n.props.onChangeText === 'function');
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
        <HealthGoalsActivityScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

describe('HealthGoalsActivityScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { onDone: 'complete' };
    mockSuggestion = null;
    mockSaveActivityGoals.mockResolvedValue({ steps: 8000, minutes: 30 });
  });

  it('shows a "Suggested for you" banner once a suggestion is available, and applies it', async () => {
    mockSuggestion = { calories: 2150, protein: 130, carbs: 240, fat: 70, steps: 11000, minutes: 55, waterCups: 9, bmr: 1600, tdee: 2150 };
    const tree = await renderScreen();

    expect(
      tree.root.findAllByProps({ testID: 'onboarding-health-goals-activity-suggestion' }).length
    ).toBeGreaterThan(0);

    act(() => pressByTestId(tree, 'onboarding-health-goals-activity-suggestion-apply'));

    expect(
      tree.root
        .findAllByProps({ testID: 'onboarding-health-goals-steps-input' })
        .find((n) => typeof n.props.onChangeText === 'function')?.props.value
    ).toBe('11000');
    expect(
      tree.root
        .findAllByProps({ testID: 'onboarding-health-goals-minutes-input' })
        .find((n) => typeof n.props.onChangeText === 'function')?.props.value
    ).toBe('55');
  });

  it('shows no suggestion banner when useSuggestedGoals has no answer', async () => {
    const tree = await renderScreen();

    expect(
      tree.root.findAllByProps({ testID: 'onboarding-health-goals-activity-suggestion' }).length
    ).toBe(0);
  });

  it('saves typed steps and minutes, and advances to Water', async () => {
    const tree = await renderScreen();
    typeInto(tree, 'onboarding-health-goals-steps-input', '9000');
    typeInto(tree, 'onboarding-health-goals-minutes-input', '40');

    await pressAndSettle(tree, 'onboarding-health-goals-activity-screen-continue');

    expect(mockSaveActivityGoals).toHaveBeenCalledWith({ steps: 9000, minutes: 40 });
    expect(mockNavigate).toHaveBeenCalledWith('HealthGoalsWater', { onDone: 'complete' });
  });

  it('clamps an out-of-bounds step target rather than rejecting it', async () => {
    const tree = await renderScreen();
    typeInto(tree, 'onboarding-health-goals-steps-input', '9999999');

    await pressAndSettle(tree, 'onboarding-health-goals-activity-screen-continue');

    expect(mockSaveActivityGoals).toHaveBeenCalledWith({ steps: 200000 });
  });

  it('fills steps from a preset chip', async () => {
    const tree = await renderScreen();
    act(() => pressByTestId(tree, 'onboarding-health-goals-steps-preset-8000'));

    await pressAndSettle(tree, 'onboarding-health-goals-activity-screen-continue');

    expect(mockSaveActivityGoals).toHaveBeenCalledWith({ steps: 8000 });
  });

  it('advances without saving when both fields are left blank', async () => {
    const tree = await renderScreen();

    await pressAndSettle(tree, 'onboarding-health-goals-activity-screen-continue');

    expect(mockSaveActivityGoals).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('HealthGoalsWater', { onDone: 'complete' });
  });

  it('pops to the previous step on Back', async () => {
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, 'onboarding-health-goals-activity-screen-back');
    });

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
