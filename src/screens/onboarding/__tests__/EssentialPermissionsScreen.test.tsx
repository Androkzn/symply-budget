/**
 * EssentialPermissionsScreen — the onboarding step that asks about
 * notifications, every brand alike.
 *
 * Drives the real screen and asserts: the notification permission card
 * renders with brand-specific benefit copy whenever there is still something
 * to ask (`not-requested` / `denied`); the screen auto-continues past itself,
 * with no card shown, when the permission already reads `granted` — EXCEPT on
 * the Health brand, which instead renders the granted card plus three
 * default-on reminder toggles (meals/water/weigh-in) to customize; and
 * "Continue" resolves `onDone` directly (complete onboarding, or hand off to
 * the House step the caller decided on) EXCEPT on the Health brand, where it
 * routes through the domain-specific `HealthKitPermission` step first
 * instead — see HealthKitPermissionScreen.test.tsx for that screen's own
 * `onDone` handling — and EXCEPT on the Kaizen brand, where it detours into
 * `KaizenSystemsSetup` instead of completing (Kaizen's own required systems
 * setup — see KaizenSystemsSetupScreen.test.tsx). On Health, this is step 7
 * of 8 (Welcome counts as step 1, then goals, then this, then Apple Health);
 * on Budget/Language it's step 2 of 2 (Welcome is step 1 of their short
 * flow); on Kaizen it's an estimate (assuming the picker's default
 * selection) that firms up once the member reaches the picker; House hides
 * progress here entirely — its own household-setup count doesn't include
 * this step.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { EssentialPermissionsScreen } from '../EssentialPermissionsScreen';

// `expo-router/react-navigation` is jest-config-aliased to `@react-navigation/native`
// (see jest.config.js) — one mock for both import specifiers, not two, or the
// second `jest.mock()` call silently overwrites the first.
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

const mockRequestPush = jest.fn();
let mockPushPermission: { state: string; busy: boolean; checked: boolean } = {
  state: 'not-requested',
  busy: false,
  checked: true,
};
jest.mock('@hooks/useNotificationPermission', () => ({
  __esModule: true,
  useNotificationPermission: () => ({ ...mockPushPermission, request: mockRequestPush }),
}));

let mockIsHealthBrand = false;
jest.mock('@features/health', () => ({
  __esModule: true,
  isHealthBrand: () => mockIsHealthBrand,
}));

let mockIsKaizenBrand = false;
jest.mock('@features/kaizen', () => ({
  __esModule: true,
  isKaizenBrand: () => mockIsKaizenBrand,
}));

// `@brand` is left unmocked — its `index.ts` leans on lazy getters that
// several other real modules (`theme/colors.ts` included) depend on, so a
// partial jest mock here risks breaking those transitively. The test
// environment's real `isHouseBrand()` defaults to House (see the other
// mobile suites' shared baseline), which is exactly the brand this file's
// "no progress" case below exercises.
const mockEnsureHealthReminderPermission = jest.fn();
const mockSaveHealthReminders = jest.fn();
jest.mock('@features/health/healthRemindersStorage', () => ({
  __esModule: true,
  ensureHealthReminderPermission: (...args: unknown[]) =>
    mockEnsureHealthReminderPermission(...args),
  saveHealthReminders: (...args: unknown[]) => mockSaveHealthReminders(...args),
}));

const SCREEN = 'onboarding-essential-permissions-screen';

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
        <EssentialPermissionsScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

describe('EssentialPermissionsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsHealthBrand = false;
    mockIsKaizenBrand = false;
    mockRouteParams = { onDone: 'complete' };
    mockPushPermission = { state: 'not-requested', busy: false, checked: true };
    mockEnsureHealthReminderPermission.mockResolvedValue(true);
    mockSaveHealthReminders.mockResolvedValue({});
  });

  it('always renders the notification permission card', async () => {
    const tree = await renderScreen();
    expect(hasTestId(tree, 'onboarding-notification-permission-card')).toBe(true);
  });

  it('requests notification permission when its card is tapped', async () => {
    const tree = await renderScreen();
    pressByTestId(tree, 'onboarding-notification-permission-card-request');
    expect(mockRequestPush).toHaveBeenCalledTimes(1);
  });

  it('completes onboarding on Continue when onDone is "complete" and not on Health', async () => {
    mockIsHealthBrand = false;
    mockRouteParams = { onDone: 'complete' };
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
    });

    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('continues into the decided House step on Continue instead of completing', async () => {
    mockIsHealthBrand = false;
    mockRouteParams = { onDone: 'JoinHousehold' };
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
    });

    expect(mockNavigate).toHaveBeenCalledWith('JoinHousehold');
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('detours into the Kaizen systems-setup screen instead of completing, on the Kaizen brand', async () => {
    mockIsKaizenBrand = true;
    mockRouteParams = { onDone: 'complete' };
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
    });

    expect(mockNavigate).toHaveBeenCalledWith('KaizenSystemsSetup');
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('routes through HealthKitPermission instead of resolving onDone itself, on the Health brand', async () => {
    mockIsHealthBrand = true;
    mockRouteParams = { onDone: 'complete' };
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
    });

    expect(mockNavigate).toHaveBeenCalledWith('HealthKitPermission', { onDone: 'complete' });
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('carries the House step through to HealthKitPermission unresolved, on the Health brand', async () => {
    // Health is never a House-domain brand, but the routing logic itself must
    // not silently drop a non-'complete' onDone rather than passing it along.
    mockIsHealthBrand = true;
    mockRouteParams = { onDone: 'JoinHousehold' };
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
    });

    expect(mockNavigate).toHaveBeenCalledWith('HealthKitPermission', { onDone: 'JoinHousehold' });
  });

  it('shows a loading state, not the permission card, while the OS read is still pending', async () => {
    mockPushPermission = { state: 'not-requested', busy: false, checked: false };
    const tree = await renderScreen();

    expect(hasTestId(tree, 'onboarding-essential-permissions-loading')).toBe(true);
    expect(hasTestId(tree, 'onboarding-notification-permission-card')).toBe(false);
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('skips straight past the screen when notifications are already granted', async () => {
    mockPushPermission = { state: 'granted', busy: false, checked: true };
    mockRouteParams = { onDone: 'complete' };
    await renderScreen();

    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  /**
   * The skip is an ARRIVAL behaviour, and it has to stop being one the moment
   * it has fired.
   *
   * House's wizard can now be walked backwards, and the step behind
   * `CreateHousehold` is this screen. While the fast path stayed armed, coming
   * back landed on the spinner branch — which renders for as long as the OS
   * reads `granted`, with no card, no arrows and nothing to press. Latching it
   * means a member who walks back finds the real screen, showing the granted
   * card, exactly as if they had never been forwarded.
   */
  it('stops skipping once it has forwarded once, so walking back lands on the card and not a spinner', async () => {
    mockPushPermission = { state: 'granted', busy: false, checked: true };
    mockRouteParams = { onDone: 'CreateHousehold' };
    const tree = await renderScreen();

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('CreateHousehold');
    expect(hasTestId(tree, 'onboarding-essential-permissions-loading')).toBe(false);
    expect(hasTestId(tree, 'onboarding-notification-permission-card')).toBe(true);
    expect(hasTestId(tree, `${SCREEN}-back`)).toBe(true);
  });

  it('renders the granted card and reminder toggles instead of skipping through, on the Health brand', async () => {
    mockIsHealthBrand = true;
    mockPushPermission = { state: 'granted', busy: false, checked: true };
    mockRouteParams = { onDone: 'JoinHousehold' };
    const tree = await renderScreen();

    expect(hasTestId(tree, 'onboarding-notification-permission-card')).toBe(true);
    expect(hasTestId(tree, 'onboarding-reminder-toggle-meals')).toBe(true);
    expect(hasTestId(tree, 'onboarding-reminder-toggle-water')).toBe(true);
    expect(hasTestId(tree, 'onboarding-reminder-toggle-weigh-in')).toBe(true);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
  });

  it('does not render reminder toggles on brands other than Health', async () => {
    mockIsHealthBrand = false;
    mockPushPermission = { state: 'not-requested', busy: false, checked: true };
    const tree = await renderScreen();

    expect(hasTestId(tree, 'onboarding-reminder-toggle-meals')).toBe(false);
  });

  it('defaults all three reminder toggles to on, on the Health brand', async () => {
    mockIsHealthBrand = true;
    const tree = await renderScreen();

    const toggleValue = (testID: string) =>
      tree.root.findAllByProps({ testID })[0]?.props.value;

    expect(toggleValue('onboarding-reminder-toggle-meals')).toBe(true);
    expect(toggleValue('onboarding-reminder-toggle-water')).toBe(true);
    expect(toggleValue('onboarding-reminder-toggle-weigh-in')).toBe(true);
  });

  it('saves the chosen reminder categories on Continue when notifications are granted', async () => {
    mockIsHealthBrand = true;
    mockPushPermission = { state: 'granted', busy: false, checked: true };
    mockRouteParams = { onDone: 'complete' };
    const tree = await renderScreen();

    act(() => {
      const water = tree.root.findAllByProps({ testID: 'onboarding-reminder-toggle-water' })[0];
      water.props.onValueChange(false);
    });

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockEnsureHealthReminderPermission).toHaveBeenCalledTimes(1);
    expect(mockSaveHealthReminders).toHaveBeenCalledWith(
      expect.objectContaining({
        meals_enabled: true,
        water_enabled: false,
        weigh_in_enabled: true,
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('HealthKitPermission', { onDone: 'complete' });
  });

  it('does not save reminder preferences on Continue when notifications are not granted', async () => {
    mockIsHealthBrand = true;
    mockPushPermission = { state: 'not-requested', busy: false, checked: true };
    mockRouteParams = { onDone: 'complete' };
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
      await Promise.resolve();
    });

    expect(mockEnsureHealthReminderPermission).not.toHaveBeenCalled();
    expect(mockSaveHealthReminders).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('HealthKitPermission', { onDone: 'complete' });
  });

  it('pops back to the previous step on Back', async () => {
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-back`);
    });

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('resolves onDone from the header forward arrow too', async () => {
    mockIsHealthBrand = false;
    mockRouteParams = { onDone: 'complete' };
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-forward`);
    });

    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
  });

  it('shows step 7 of 8 progress on the Health brand, where Welcome and goals run before this step', async () => {
    mockIsHealthBrand = true;
    const tree = await renderScreen();
    expect(dotsLabel(tree)).toBe('Step 7 of 8: Notifications');
  });

  it("shows an estimated progress on Kaizen, assuming the picker's default Career-only selection", async () => {
    mockIsKaizenBrand = true;
    const tree = await renderScreen();
    // 3 fixed steps (Welcome, Notifications, picker) + 1 system (Career) + 5
    // (Career's own deep setup) = 9.
    expect(dotsLabel(tree)).toBe('Step 2 of 9: Notifications');
  });

  it('shows no progress on House (this suite\'s default brand), whose own household-setup count excludes this step', async () => {
    mockIsHealthBrand = false;
    const tree = await renderScreen();
    // `StepProgress` renders `null` for a single-step flow, but its OWN
    // composite fiber still carries the `-dots` testID regardless — `hasTestId`
    // would find that fiber and report a false positive, so this checks for
    // the rendered label instead, which only exists on the host node the
    // component actually produces.
    expect(dotsLabel(tree)).toBeUndefined();
  });
});
