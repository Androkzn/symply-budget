/**
 * HealthGoalsWeightScreen — step 3 of 6 in Symply Health's goals mini-flow.
 *
 * Drives the real screen and asserts: picking a goal type and/or typing a
 * target/starting weight saves through `saveWeightGoal` (the SAME module the
 * Weight tab's "Goal & body details" section uses); a goal type alone (no
 * numbers) is still a real save; leaving everything untouched skips the
 * network call and still advances; and Back pops to the previous step.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { HealthGoalsWeightScreen } from '../HealthGoalsWeightScreen';

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
  saveWeightGoal: (patch: unknown) => mockSaveWeightGoal(patch),
}));

const mockLoadHealthPrefs = jest.fn();
jest.mock('@features/health/healthLocalStorage', () => {
  const actual = jest.requireActual('@features/health/healthLocalStorage');
  return {
    __esModule: true,
    ...actual,
    loadHealthPrefs: () => mockLoadHealthPrefs(),
  };
});

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
        <HealthGoalsWeightScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

describe('HealthGoalsWeightScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { onDone: 'complete' };
    mockLoadHealthPrefs.mockResolvedValue({ preferredUnit: 'kg', healthKitEnabled: false, aiEnabled: false });
    mockSaveWeightGoal.mockResolvedValue({});
  });

  it('saves a typed target and starting weight, in kg, and advances to Nutrition', async () => {
    const tree = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });
    typeInto(tree, 'onboarding-health-goals-target-weight-input', '70');
    typeInto(tree, 'onboarding-health-goals-starting-weight-input', '75');

    await pressAndSettle(tree, 'onboarding-health-goals-weight-screen-continue');

    expect(mockSaveWeightGoal).toHaveBeenCalledWith({
      goalType: null,
      unit: 'kg',
      target: 70,
      starting: 75,
    });
    expect(mockNavigate).toHaveBeenCalledWith('HealthGoalsNutrition', { onDone: 'complete' });
  });

  it('initializes starting weight to the target when starting is left untouched', async () => {
    const tree = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });
    typeInto(tree, 'onboarding-health-goals-target-weight-input', '70');

    await pressAndSettle(tree, 'onboarding-health-goals-weight-screen-continue');

    expect(mockSaveWeightGoal).toHaveBeenCalledWith({
      goalType: null,
      unit: 'kg',
      target: 70,
      starting: 70,
    });
  });

  it('does not overwrite a manually edited starting weight when target changes again', async () => {
    const tree = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });
    typeInto(tree, 'onboarding-health-goals-target-weight-input', '70');
    typeInto(tree, 'onboarding-health-goals-starting-weight-input', '80');
    typeInto(tree, 'onboarding-health-goals-target-weight-input', '65');

    await pressAndSettle(tree, 'onboarding-health-goals-weight-screen-continue');

    expect(mockSaveWeightGoal).toHaveBeenCalledWith({
      goalType: null,
      unit: 'kg',
      target: 65,
      starting: 80,
    });
  });

  it('saves a goal type on its own, with no numbers typed', async () => {
    const tree = await renderScreen();
    act(() => pressByTestId(tree, 'onboarding-health-goals-weight-type-lose'));

    await pressAndSettle(tree, 'onboarding-health-goals-weight-screen-continue');

    expect(mockSaveWeightGoal).toHaveBeenCalledWith({ goalType: 'lose', unit: 'kg' });
  });

  it('advances without saving when nothing is set', async () => {
    const tree = await renderScreen();

    await pressAndSettle(tree, 'onboarding-health-goals-weight-screen-continue');

    expect(mockSaveWeightGoal).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('HealthGoalsNutrition', { onDone: 'complete' });
  });

  it('pops to the previous step on Back', async () => {
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, 'onboarding-health-goals-weight-screen-back');
    });

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
