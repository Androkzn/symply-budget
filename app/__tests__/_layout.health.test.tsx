/**
 * `app/_layout.tsx` — the two Health-only effect lines.
 *
 * Extends the provider-mount smoke coverage in `__tests__/App.test.tsx` with
 * ONE additional scenario: an authenticated, onboarded Health-brand member on
 * iOS with a current household. That is the gate on the effect that publishes
 * the widget/watch glance and corrects a stale reminder timezone — see the
 * "Push household context to Widget/Watch App Group" effect.
 *
 * Everything NOT related to that gate (AI connection watcher, the BYOK lease
 * keeper, the biometric enrollment sheet, SecureStore hydration, push-token
 * sync, RevenueCat) is stubbed as a seam here, exactly as `App.test.tsx` stubs
 * `RootNavigator` — this file does not re-prove the rest of the root layout,
 * only the Health wiring.
 */

 
// `usePropertyAddressCaptureGate` too: `_layout.tsx` asks it directly, because
// the mount decision is made there rather than inside the navigator. This brand
// never answers true (the gate is House-only) — the stub just has to exist.
jest.mock('@navigation/RootNavigator', () => ({
  RootNavigator: () => null,
  usePropertyAddressCaptureGate: () => false,
}));
jest.mock('@components/ai/AIConnectionWatcher', () => ({ AIConnectionWatcher: () => null }));
jest.mock('@components/ai/AiLeaseKeeper', () => ({ AiLeaseKeeper: () => null }));
jest.mock('@components/auth/BiometricEnrollmentGate', () => ({ BiometricEnrollmentGate: () => null }));

jest.mock('@stores/authStore', () => {
  const actual = jest.requireActual('@stores/authStore');
  return {
    ...actual,
    // The real functions read the device Keychain via expo-secure-store, which
    // is unavailable under Jest and (by design — see the source) CLEARS
    // `isAuthenticated` on a read failure. Stubbed so the auth state this test
    // sets survives `initializeAuth()`; `useAuthStore` itself stays REAL so the
    // component subscribes to genuine store state.
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

// Push-token sync is unrelated to the Health effect under test and pulls in a
// chunk of unrelated notification-store surface (`checkPermission`,
// `registerPushToken`, …) that would otherwise need its own mocking.
jest.mock('@hooks/useNotificationHandler', () => ({ useNotificationHandler: () => undefined }));

// RevenueCat configuration reads `isFeatureEnabled` from `@stores/featureFlagStore`
// (a plain function export, separate from the `useFeatureFlagStore` object mocked
// above) — irrelevant to the Health effect, stubbed out wholesale.
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

jest.mock('@features/health/brandGuard', () => ({ isHealthBrand: jest.fn(() => true) }));
jest.mock('@features/health/healthWidgetStorage', () => ({
  syncHealthGlanceFromServer: jest.fn().mockResolvedValue(true),
}));
jest.mock('@features/health/healthRemindersStorage', () => ({
  syncHealthReminderTimezone: jest.fn().mockResolvedValue(undefined),
}));

import React from 'react';
import { Platform } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { isHealthBrand } from '@features/health/brandGuard';
import { syncHealthReminderTimezone } from '@features/health/healthRemindersStorage';
import { syncHealthGlanceFromServer } from '@features/health/healthWidgetStorage';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';

import RootLayout from '../_layout';

const mockIsHealthBrand = isHealthBrand as jest.Mock;
const mockSyncGlance = syncHealthGlanceFromServer as jest.Mock;
const mockSyncTimezone = syncHealthReminderTimezone as jest.Mock;

/** Flush the microtask queue enough times for `initializeAuth()`'s await chain to settle. */
async function flushAsync(times = 6) {
  for (let i = 0; i < times; i += 1) {
     
    await act(async () => {
      await Promise.resolve();
    });
  }
}

let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  mockSyncGlance.mockResolvedValue(true);
  mockSyncTimezone.mockResolvedValue(undefined);
  mockIsHealthBrand.mockReturnValue(true);
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

  useAuthStore.setState({
    isAuthenticated: true,
    hasCompletedOnboarding: true,
    user: { id: 'watch-user-1' } as never,
    token: 'tok',
    refreshToken: 'rtok',
    biometricEnabled: true,
    biometricPromptShown: true,
  } as never);
  useHouseholdStore.setState({ currentHousehold: { id: 'household-1' } as never });
});

afterEach(() => {
  // Without this, a previous test's tree stays mounted (real, shared
  // `useAuthStore`/`useHouseholdStore` subscriptions and all) and re-renders
  // when a LATER test mutates that shared state — re-evaluating `isHealthBrand()`
  // against whatever the next test's `beforeEach` reset the mock to, and
  // double-counting calls on mocks that `jest.clearAllMocks()` only zeroed,
  // it didn't stop from firing again.
  renderer?.unmount();
  renderer = undefined;
});

describe('app/_layout — the Health-only widget/reminder-timezone effect', () => {
  it('LAYOUT-HEALTH-001: publishes the glance AND corrects the reminder timezone for an authenticated Health member on iOS', async () => {
    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).toHaveBeenCalledTimes(1);
    expect(mockSyncTimezone).toHaveBeenCalledTimes(1);
  });

  it('LAYOUT-HEALTH-002: does NEITHER on a non-Health brand, even fully authenticated on iOS', async () => {
    mockIsHealthBrand.mockReturnValue(false);

    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).not.toHaveBeenCalled();
    expect(mockSyncTimezone).not.toHaveBeenCalled();
  });

  it('LAYOUT-HEALTH-003: does NEITHER on Android, even for an authenticated Health member', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).not.toHaveBeenCalled();
    expect(mockSyncTimezone).not.toHaveBeenCalled();
  });

  it('LAYOUT-HEALTH-004: publishes BOTH with no current household selected — Health has no household concept', async () => {
    // Health never provisions a household (no onboarding path creates one —
    // `OnboardingNavigator` registers `CreateHousehold`/`JoinHousehold` for
    // House only), so gating this effect on `currentHousehold` — as this test
    // used to assert — silently starved every Health member's widget/watch
    // forever. The effect substitutes the member's own user id as its "signed
    // in" stand-in instead, so a null household must NOT block it.
    useHouseholdStore.setState({ currentHousehold: null });

    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).toHaveBeenCalledTimes(1);
    expect(mockSyncTimezone).toHaveBeenCalledTimes(1);
  });

  it('LAYOUT-HEALTH-005: does NEITHER with no authenticated user id yet', async () => {
    useAuthStore.setState({ user: undefined } as never);

    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).not.toHaveBeenCalled();
    expect(mockSyncTimezone).not.toHaveBeenCalled();
  });
});
