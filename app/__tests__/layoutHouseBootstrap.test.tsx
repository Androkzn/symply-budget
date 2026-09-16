/**
 * `app/_layout.tsx` — the two House diversions away from the tab shell.
 *
 * This file decides what the entire app renders, so both diversions are pinned
 * from the outside rather than trusted:
 *
 *   1. RECOVERY. A device that holds no key for the homes on the account has
 *      nothing real to draw in the shell. Before this the state existed and
 *      nothing rendered it, which is how a member ended up looking at an empty
 *      home (or at nothing) with no explanation and no way out.
 *
 *   2. ADDRESS CAPTURE. Signing in again on a fresh install restores
 *      `hasCompletedOnboarding` from the server, so onboarding is skipped while
 *      an address-less home is created underneath. That home can never resolve
 *      a property-assessment jurisdiction, and the only address form in the app
 *      sits behind the step that was skipped — 17 such homes on staging.
 *
 * And the case where they meet: recovery WINS, because `CreateHousehold` would
 * make a home, which is the exact outcome recovery exists to prevent.
 *
 * Stubs mirror `_layout.kaizen.test.tsx` — same seams, same reasons.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */

const mockRecoveryGate = jest.fn(() => null as { status: string } | null);
const mockAddressGate = jest.fn(() => false);

// Both hooks are wrapped rather than passed by reference: `jest.mock` factories
// are hoisted above the `import` of `../_layout`, so the factory RUNS before the
// two consts above are initialised. Reading them at call time instead is what
// makes them defined by the time a render asks.
jest.mock('@navigation/RootNavigator', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    RootNavigator: () => React.createElement(Text, { testID: 'root-navigator' }, 'onboarding'),
    usePropertyAddressCaptureGate: () => mockAddressGate(),
  };
});

// The screen itself is covered by its own suite; what `_layout` owns is WHETHER
// it mounts and WHAT state it is handed, so the stub reports both.
jest.mock('@screens/house-v2/enrolment/HouseRecoverHomeScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    useHouseRecoveryGate: () => mockRecoveryGate(),
    HouseRecoverHomeScreen: ({ state }: { state: { status: string } }) =>
      React.createElement(Text, { testID: 'house-recover-home-screen' }, state.status),
  };
});

jest.mock('@components/ai/AIConnectionWatcher', () => ({ AIConnectionWatcher: () => null }));
jest.mock('@components/ai/AiLeaseKeeper', () => ({ AiLeaseKeeper: () => null }));
jest.mock('@components/auth/BiometricEnrollmentGate', () => ({
  BiometricEnrollmentGate: () => null,
}));

jest.mock('@stores/authStore', () => {
  const actual = jest.requireActual('@stores/authStore');
  return {
    ...actual,
    // See `_layout.health.test.tsx` — the real hydrators read the device Keychain
    // and CLEAR `isAuthenticated` on the read failure Jest guarantees.
    hydrateProductTokensFromSecureStore: jest.fn().mockResolvedValue(undefined),
    hydrateBiometricPreferenceFromSecureStore: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock('@stores/featureFlagStore', () => ({
  useFeatureFlagStore: {
    persist: { rehydrate: jest.fn().mockResolvedValue(undefined) },
    getState: () => ({ fetchFlags: jest.fn().mockResolvedValue(undefined) }),
  },
}));

jest.mock('@stores/notificationStore', () => ({
  useNotificationStore: { getState: () => ({ initialize: jest.fn().mockResolvedValue(undefined) }) },
}));

jest.mock('@hooks/useNotificationHandler', () => ({ useNotificationHandler: () => undefined }));

jest.mock('@services/purchases', () => ({
  configurePurchases: jest.fn().mockResolvedValue(true),
  logInPurchases: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@services/widget-sync', () => ({
  widgetSync: { setApiBaseUrl: jest.fn(), setAuth: jest.fn(), clear: jest.fn() },
}));

jest.mock('@services/watch-sync', () => ({
  watchSyncService: {
    setApiBaseUrl: jest.fn().mockResolvedValue(undefined),
    syncAuthTokens: jest.fn().mockResolvedValue(undefined),
    clearWatchData: jest.fn().mockResolvedValue(undefined),
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { useAuthStore } from '@stores/authStore';

import RootLayout from '../_layout';

/** Flush the microtask queue enough times for `initializeAuth()`'s await chain to settle. */
async function flushAsync(times = 6) {
  for (let i = 0; i < times; i += 1) {

    await act(async () => {
      await Promise.resolve();
    });
  }
}

let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

async function renderLayout() {
  await act(async () => {
    renderer = ReactTestRenderer.create(<RootLayout />);
  });
  await flushAsync();
  return renderer!;
}

function hasTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string): boolean {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id).length > 0;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRecoveryGate.mockReturnValue(null);
  mockAddressGate.mockReturnValue(false);

  useAuthStore.setState({
    isAuthenticated: true,
    hasCompletedOnboarding: true,
    user: { id: 'house-user-1' } as never,
    token: 'tok',
    refreshToken: 'rtok',
    biometricEnabled: true,
    biometricPromptShown: true,
  } as never);
});

afterEach(() => {
  // See `_layout.health.test.tsx` — an un-unmounted tree keeps real store
  // subscriptions and re-fires mocks when a later test mutates shared state.
  renderer?.unmount();
  renderer = undefined;
});

describe('app/_layout — the House recovery diversion', () => {
  /**
   * The whole point of the screen: the state was already being published and
   * absolutely nothing rendered it, so a member whose device held no key was
   * handed the shell over a home it could not open.
   */
  it('renders the recovery screen for a device that holds no key for the account’s homes', async () => {
    mockRecoveryGate.mockReturnValue({ status: 'recover-this-home' });

    const tree = await renderLayout();

    expect(hasTestId(tree, 'house-recover-home-screen')).toBe(true);
  });

  /** The offline half of the same fix — no answer is not the same as no homes. */
  it('renders the recovery screen when the account could not be checked at all', async () => {
    mockRecoveryGate.mockReturnValue({ status: 'undecided-offline' });

    const tree = await renderLayout();

    expect(hasTestId(tree, 'house-recover-home-screen')).toBe(true);
  });

  /**
   * The cost of getting this wrong is every healthy member seeing a recovery
   * screen over a home that is sitting right there.
   */
  it('stays out of the way of a member whose home is on this device', async () => {
    const tree = await renderLayout();

    expect(hasTestId(tree, 'house-recover-home-screen')).toBe(false);
    expect(hasTestId(tree, 'root-navigator')).toBe(false);
  });
});

describe('app/_layout — the address-capture diversion', () => {
  /**
   * Re-applied after being reverted while chasing an unrelated blank screen.
   * `usePropertyAddressCaptureGate` is a pure store-derived predicate, so this
   * asserts the one thing the predicate cannot: that the layout ACTS on it.
   */
  it('diverts an onboarded member whose home has no address into the onboarding stack', async () => {
    mockAddressGate.mockReturnValue(true);

    const tree = await renderLayout();

    expect(hasTestId(tree, 'root-navigator')).toBe(true);
  });

  /**
   * The two gates disagree about exactly one member, and the disagreement is
   * expensive: `CreateHousehold` MAKES a home, so letting address capture win
   * here would hand the member the empty second home that recovery exists to
   * prevent — while their real one waited on another phone.
   */
  it('lets recovery win over address capture, because the address form would make a home', async () => {
    mockRecoveryGate.mockReturnValue({ status: 'recover-this-home' });
    mockAddressGate.mockReturnValue(true);

    const tree = await renderLayout();

    expect(hasTestId(tree, 'house-recover-home-screen')).toBe(true);
    expect(hasTestId(tree, 'root-navigator')).toBe(false);
  });
});
