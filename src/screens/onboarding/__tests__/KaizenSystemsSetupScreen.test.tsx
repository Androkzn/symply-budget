/**
 * KaizenSystemsSetupScreen — Symply Kaizen's required "Build your system"
 * onboarding step, reached after Notifications.
 *
 * Drives the real screen and asserts: Career is pre-selected by default;
 * Continue is disabled once every tile is deselected (picking at least one
 * system is mandatory here, unlike every other onboarding step) and
 * re-enables the moment a tile is picked again; Continue persists the
 * selection (`beginSetupSystems` + `beginSetupQueue`) and hands off to
 * `KaizenSystemConfig` for the first queued system; the progress bar's total
 * grows live as more systems are added to the selection; and Back pops to
 * the previous step.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { KaizenSystemsSetupScreen } from '../KaizenSystemsSetupScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

const mockBeginSetupSystems = jest.fn();
jest.mock('@features/kaizen/stores/kaizenStore', () => ({
  __esModule: true,
  useKaizenStore: (selector: (s: { beginSetupSystems: (...a: unknown[]) => unknown }) => unknown) =>
    selector({ beginSetupSystems: (...a: unknown[]) => mockBeginSetupSystems(...a) }),
}));

const mockBeginSetupQueue = jest.fn();
jest.mock('@features/kaizen/services/setupFlow', () => ({
  __esModule: true,
  ...jest.requireActual('@features/kaizen/services/setupFlow'),
  beginSetupQueue: (...a: unknown[]) => mockBeginSetupQueue(...a),
}));

const SCREEN = 'onboarding-kaizen-systems-screen';

function hasTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return tree.root.findAllByProps({ testID }).length > 0;
}

function pressByTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.findAllByProps({ testID })[0];
  node.props.onPress?.();
}

/** The progress bar's a11y label — same convention every onboarding test uses. */
function dotsLabel(tree: ReactTestRenderer.ReactTestRenderer): string | undefined {
  return tree.root
    .findAllByProps({ testID: `${SCREEN}-dots` })
    .find((n) => typeof n.props.accessibilityLabel === 'string')?.props.accessibilityLabel;
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <KaizenSystemsSetupScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

describe('KaizenSystemsSetupScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBeginSetupSystems.mockResolvedValue(undefined);
  });

  it('pre-selects Career and shows every life-system tile', async () => {
    const tree = await renderScreen();
    expect(hasTestId(tree, 'onboarding-kaizen-system-career')).toBe(true);
    expect(hasTestId(tree, 'onboarding-kaizen-system-health')).toBe(true);
    expect(hasTestId(tree, 'onboarding-kaizen-system-finance')).toBe(true);
    const career = tree.root.findAllByProps({ testID: 'onboarding-kaizen-system-career' })[0];
    expect(career.props.accessibilityState).toEqual({ selected: true });
  });

  it('enables Continue by default (Career pre-selected)', async () => {
    const tree = await renderScreen();
    const continueButton = tree.root.findAllByProps({ testID: `${SCREEN}-continue` })[0];
    expect(continueButton.props.disabled).toBe(false);
  });

  it('disables Continue once every tile is deselected — picking at least one system is required', async () => {
    const tree = await renderScreen();
    act(() => pressByTestId(tree, 'onboarding-kaizen-system-career'));

    const continueButton = tree.root.findAllByProps({ testID: `${SCREEN}-continue` })[0];
    expect(continueButton.props.disabled).toBe(true);
    const forward = tree.root.findAllByProps({ testID: `${SCREEN}-forward` })[0];
    expect(forward.props.disabled).toBe(true);
  });

  it('re-enables Continue once a tile is picked again', async () => {
    const tree = await renderScreen();
    act(() => pressByTestId(tree, 'onboarding-kaizen-system-career'));
    act(() => pressByTestId(tree, 'onboarding-kaizen-system-health'));

    const continueButton = tree.root.findAllByProps({ testID: `${SCREEN}-continue` })[0];
    expect(continueButton.props.disabled).toBe(false);
  });

  it('does nothing when Continue is pressed with zero systems selected', async () => {
    const tree = await renderScreen();
    act(() => pressByTestId(tree, 'onboarding-kaizen-system-career'));

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
    });

    expect(mockBeginSetupSystems).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('persists the selection and hands off to the first queued system on Continue', async () => {
    const tree = await renderScreen();
    act(() => pressByTestId(tree, 'onboarding-kaizen-system-health'));

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
    });

    expect(mockBeginSetupSystems).toHaveBeenCalledWith(['career', 'health']);
    expect(mockBeginSetupQueue).toHaveBeenCalledWith(['career', 'health']);
    expect(mockNavigate).toHaveBeenCalledWith('KaizenSystemConfig', { system: 'career' });
  });

  it('hands off to the first remaining system when Career itself is deselected', async () => {
    const tree = await renderScreen();
    act(() => pressByTestId(tree, 'onboarding-kaizen-system-health'));
    act(() => pressByTestId(tree, 'onboarding-kaizen-system-career'));

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
    });

    expect(mockNavigate).toHaveBeenCalledWith('KaizenSystemConfig', { system: 'health' });
  });

  it("grows the progress bar's total as more systems are added to the selection", async () => {
    const tree = await renderScreen();
    // Default: just Career selected -> 3 fixed steps + 1 system + 5 (Career's
    // own deep setup) = 9.
    expect(dotsLabel(tree)).toBe('Step 3 of 9: Build your system');

    act(() => pressByTestId(tree, 'onboarding-kaizen-system-health'));
    // +1 system, Career still included -> 10.
    expect(dotsLabel(tree)).toBe('Step 3 of 10: Build your system');
  });

  it('drops the Career-specific steps from the total once Career is deselected', async () => {
    const tree = await renderScreen();
    act(() => pressByTestId(tree, 'onboarding-kaizen-system-career'));
    act(() => pressByTestId(tree, 'onboarding-kaizen-system-health'));
    // No Career in the selection -> 3 fixed steps + 1 system, no +5.
    expect(dotsLabel(tree)).toBe('Step 3 of 4: Build your system');
  });

  it('pops to the previous step on Back', async () => {
    const tree = await renderScreen();

    act(() => pressByTestId(tree, `${SCREEN}-back`));

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
