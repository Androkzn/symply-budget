/**
 * HealthKitPermissionScreen — the Symply Health-only onboarding step for
 * Apple Health, the LAST of Health's 8 onboarding steps (Welcome, then five
 * goals steps, then the shared `EssentialPermissionsScreen` for
 * notifications, then this one) — see that screen's test for the branch that
 * routes here.
 *
 * Drives the real screen and asserts: the HealthKit card renders once status
 * has loaded; "Finish" resolves `onDone` directly (complete onboarding, or
 * hand off to the House step the caller decided on) — never blocked on
 * actually connecting anything; "Back" pops to the previous step; and, as the
 * last step of the flow, there is no header forward-chevron shortcut.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { HealthKitPermissionScreen } from '../HealthKitPermissionScreen';

// `expo-router/react-navigation` is jest-config-aliased to `@react-navigation/native`
// (see jest.config.js) — one mock for both import specifiers, not two.
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

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ replace: mockReplace }),
}));

const mockCompleteOnboarding = jest.fn();
jest.mock('@stores/authStore', () => ({
  __esModule: true,
  useAuthStore: (selector: (s: { completeOnboarding: () => void }) => unknown) =>
    selector({ completeOnboarding: mockCompleteOnboarding }),
}));

const mockConnectOrSync = jest.fn();
let mockHealthKitStatus: { state: string; lastSyncedAt: string | null } | null = {
  state: 'not-requested',
  lastSyncedAt: null,
};
jest.mock('@features/health/useHealthKitConnection', () => ({
  __esModule: true,
  useHealthKitConnection: () => ({
    status: mockHealthKitStatus,
    busy: false,
    syncing: false,
    progress: null,
    connectOrSync: mockConnectOrSync,
  }),
}));
jest.mock('@features/health/components', () => {
  /* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted */
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    HealthKitConnectCard: ({ testID }: { testID?: string }) =>
      ReactMock.createElement(View, { testID }),
    HealthKitSyncProgressModal: ({ testID }: { testID?: string }) =>
      ReactMock.createElement(View, { testID }),
  };
});

const SCREEN = 'onboarding-healthkit-permission-screen';

function hasTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return tree.root.findAllByProps({ testID }).length > 0;
}

function pressByTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.findAllByProps({ testID })[0];
  node.props.onPress?.();
}

/**
 * The step-dots row's a11y label — `OnboardingStepScreen`'s dots carry no
 * visible text. `findAllByProps` also matches the `StepDots` composite
 * instance (whose own props are `currentStep`/`totalSteps`/`stepLabel`, not
 * `accessibilityLabel`), so the host `View` that actually carries the label
 * has to be picked out explicitly rather than trusting match order.
 */
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
        <HealthKitPermissionScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

describe('HealthKitPermissionScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { onDone: 'complete' };
    mockHealthKitStatus = { state: 'not-requested', lastSyncedAt: null };
  });

  it('renders the HealthKit card once status has loaded', async () => {
    const tree = await renderScreen();
    expect(hasTestId(tree, 'onboarding-healthkit-card')).toBe(true);
  });

  it('renders nothing for the card before status resolves, rather than crashing', async () => {
    mockHealthKitStatus = null;
    const tree = await renderScreen();
    expect(hasTestId(tree, 'onboarding-healthkit-card')).toBe(false);
    expect(hasTestId(tree, SCREEN)).toBe(true);
  });

  it('completes onboarding on Finish when onDone is "complete", without requiring a connection', async () => {
    mockRouteParams = { onDone: 'complete' };
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
    });

    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(mockConnectOrSync).not.toHaveBeenCalled();
  });

  it('labels the footer button "Finish" — the end of the flow, not another step to continue into', async () => {
    const tree = await renderScreen();
    const button = tree.root.findAllByProps({ testID: `${SCREEN}-continue` })[0];
    expect(button.props.title).toBe('Finish');
  });

  it('continues into the decided House step on Finish instead of completing', async () => {
    mockRouteParams = { onDone: 'CreateHousehold' };
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
    });

    expect(mockNavigate).toHaveBeenCalledWith('CreateHousehold');
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
  });

  it('pops back to the previous step on Back', async () => {
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-back`);
    });

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('has no header forward-chevron shortcut — this is the end of the flow, not a step to skip ahead through', async () => {
    const tree = await renderScreen();
    expect(hasTestId(tree, `${SCREEN}-forward`)).toBe(false);
  });

  it('shows step 8 of 8 progress — the last step, after Welcome, goals and notifications', async () => {
    const tree = await renderScreen();
    expect(dotsLabel(tree)).toBe('Step 8 of 8: Apple Health');
  });
});
