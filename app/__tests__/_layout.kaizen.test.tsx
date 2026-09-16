/**
 * `app/_layout.tsx` — the Kaizen-only widget/watch glance effect.
 *
 * Matrix: LAYOUT-KAIZEN-001…005
 * (documents/engineering/testing/matrices/kaizen.md)
 *
 * Sibling of `_layout.health.test.tsx`, and stubs the same seams for the same
 * reasons. What it locks is the fix for a blank Kaizen widget in the field:
 *
 *   `TodayScreen`'s effect used to be the ONLY producer of `widget_kaizen_today`,
 *   and `_layout.tsx` does not mount the tab shell that hosts Today until
 *   `isAuthenticated && hasCompletedOnboarding`. A member who had signed in but
 *   was still working through Kaizen's required systems onboarding therefore had
 *   a permanently empty widget reading "Sign in to track your habits" — wrong on
 *   both counts, since they were signed in and the copy suggested no fix.
 *
 * So the two load-bearing cases here are LAYOUT-KAIZEN-002 (publishes with
 * onboarding INCOMPLETE) and LAYOUT-KAIZEN-003 (publishes with NO household —
 * Kaizen has no household domain and must never acquire one to feed a widget).
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

// Health's own effect shares this layout; keep it off so its calls can't be
// mistaken for Kaizen's.
jest.mock('@features/health/brandGuard', () => ({ isHealthBrand: jest.fn(() => false) }));
jest.mock('@features/health/healthWidgetStorage', () => ({
  syncHealthGlanceFromServer: jest.fn().mockResolvedValue(true),
}));
jest.mock('@features/health/healthRemindersStorage', () => ({
  syncHealthReminderTimezone: jest.fn().mockResolvedValue(undefined),
}));

// `isKaizenBrand` is re-exported by the `@features/kaizen` barrel from this
// small, deliberately screen-free module — mocking it here rather than the
// barrel avoids restubbing the whole Kaizen feature surface.
jest.mock('@features/kaizen/branding', () => ({
  ...jest.requireActual('@features/kaizen/branding'),
  isKaizenBrand: jest.fn(() => true),
}));
jest.mock('@features/kaizen/services/kaizenWidgetSnapshot', () => ({
  syncKaizenGlance: jest.fn().mockResolvedValue(undefined),
}));

import React from 'react';
import { Platform } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { isKaizenBrand } from '@features/kaizen/branding';
import { syncKaizenGlance } from '@features/kaizen/services/kaizenWidgetSnapshot';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';

import RootLayout from '../_layout';

const mockIsKaizenBrand = isKaizenBrand as jest.Mock;
const mockSyncGlance = syncKaizenGlance as jest.Mock;

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
  mockSyncGlance.mockResolvedValue(undefined);
  mockIsKaizenBrand.mockReturnValue(true);
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

  useAuthStore.setState({
    isAuthenticated: true,
    hasCompletedOnboarding: true,
    user: { id: 'kaizen-user-1' } as never,
    token: 'tok',
    refreshToken: 'rtok',
    biometricEnabled: true,
    biometricPromptShown: true,
  } as never);
  // Kaizen never provisions one; the default here proves it is not required.
  useHouseholdStore.setState({ currentHousehold: null });
});

afterEach(() => {
  // See `_layout.health.test.tsx` — an un-unmounted tree keeps real store
  // subscriptions and re-fires mocks when a later test mutates shared state.
  renderer?.unmount();
  renderer = undefined;
});

describe('app/_layout — the Kaizen-only widget/watch glance effect', () => {
  it('LAYOUT-KAIZEN-001: publishes the glance for an authenticated Kaizen member on iOS', async () => {
    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).toHaveBeenCalledTimes(1);
    expect(mockSyncGlance).toHaveBeenCalledWith('kaizen-user-1');
  });

  it('LAYOUT-KAIZEN-002: publishes even with onboarding INCOMPLETE — the field bug', async () => {
    // The tab shell (and therefore `TodayScreen`, the old sole producer) is not
    // mounted in this state, so this is exactly the member who used to be stuck
    // looking at "Sign in to track your habits" forever.
    useAuthStore.setState({ hasCompletedOnboarding: false } as never);

    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).toHaveBeenCalledTimes(1);
    expect(mockSyncGlance).toHaveBeenCalledWith('kaizen-user-1');
  });

  it('LAYOUT-KAIZEN-003: publishes with NO household — Kaizen has no household concept', async () => {
    useHouseholdStore.setState({ currentHousehold: null });

    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).toHaveBeenCalledTimes(1);
  });

  it('LAYOUT-KAIZEN-004: does NOT publish on a non-Kaizen brand, or on Android', async () => {
    mockIsKaizenBrand.mockReturnValue(false);

    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).not.toHaveBeenCalled();

    renderer?.unmount();
    renderer = undefined;
    mockIsKaizenBrand.mockReturnValue(true);
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).not.toHaveBeenCalled();
  });

  it('LAYOUT-KAIZEN-005: does NOT publish with no authenticated user id yet', async () => {
    useAuthStore.setState({ user: undefined } as never);

    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).not.toHaveBeenCalled();
  });
});
