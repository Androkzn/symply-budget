/**
 * `app/_layout.tsx` — the Language-only widget/watch glance effect.
 *
 * Matrix: LAYOUT-LANGUAGE-001…005
 * (documents/engineering/testing/matrices/language.md)
 *
 * Sibling of `_layout.kaizen.test.tsx` / `_layout.health.test.tsx`, stubbing the
 * same seams for the same reasons. What it locks:
 *
 *   `LanguageLearnScreen`'s effect used to be the ONLY writer of
 *   `widget_language_today`, and NOTHING wrote the Watch's `watch_language_today`.
 *   `app/_layout.tsx` does not mount the tab shell that hosts that screen until
 *   `isAuthenticated && hasCompletedOnboarding`, so a signed-in learner mid-onboarding
 *   saw "Sign in to track your streak" forever and the Watch face was dead outright.
 *
 * The load-bearing cases are LAYOUT-LANGUAGE-002 (publishes with onboarding
 * INCOMPLETE) and LAYOUT-LANGUAGE-003 (publishes with NO household — Language has no
 * household domain and must never acquire one to feed a widget).
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

// The sibling brands' effects share this layout; keep them off so their calls can
// never be mistaken for Language's.
jest.mock('@features/health/brandGuard', () => ({ isHealthBrand: jest.fn(() => false) }));
jest.mock('@features/health/healthWidgetStorage', () => ({
  syncHealthGlanceFromServer: jest.fn().mockResolvedValue(true),
}));
jest.mock('@features/health/healthRemindersStorage', () => ({
  syncHealthReminderTimezone: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@features/kaizen', () => ({ isKaizenBrand: jest.fn(() => false) }));
jest.mock('@features/kaizen/services/kaizenWidgetSnapshot', () => ({
  syncKaizenGlance: jest.fn().mockResolvedValue(undefined),
}));

// `isLanguageBrand` is re-exported by the `@features/language` barrel from this
// small, screen-free module — mocking it here rather than the barrel avoids
// restubbing the whole Language feature surface.
jest.mock('@features/language/brandGuard', () => ({
  ...jest.requireActual('@features/language/brandGuard'),
  isLanguageBrand: jest.fn(() => true),
}));
jest.mock('@features/language/languageWidgetSnapshot', () => ({
  syncLanguageGlance: jest.fn().mockResolvedValue(undefined),
}));

import React from 'react';
import { Platform } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { isLanguageBrand } from '@features/language/brandGuard';
import { syncLanguageGlance } from '@features/language/languageWidgetSnapshot';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';

import RootLayout from '../_layout';

const mockIsLanguageBrand = isLanguageBrand as jest.Mock;
const mockSyncGlance = syncLanguageGlance as jest.Mock;

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
  mockIsLanguageBrand.mockReturnValue(true);
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

  useAuthStore.setState({
    isAuthenticated: true,
    hasCompletedOnboarding: true,
    user: { id: 'lang-user-1' } as never,
    token: 'tok',
    refreshToken: 'rtok',
    biometricEnabled: true,
    biometricPromptShown: true,
  } as never);
  // Language never provisions one; the default here proves it is not required.
  useHouseholdStore.setState({ currentHousehold: null });
});

afterEach(() => {
  // See `_layout.health.test.tsx` — an un-unmounted tree keeps real store
  // subscriptions and re-fires mocks when a later test mutates shared state.
  renderer?.unmount();
  renderer = undefined;
});

describe('app/_layout — the Language-only widget/watch glance effect', () => {
  it('LAYOUT-LANGUAGE-001: publishes the glance for an authenticated Language learner on iOS', async () => {
    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).toHaveBeenCalledTimes(1);
    expect(mockSyncGlance).toHaveBeenCalledWith('lang-user-1');
  });

  it('LAYOUT-LANGUAGE-002: publishes even with onboarding INCOMPLETE — the field bug', async () => {
    // The tab shell (and therefore `LanguageLearnScreen`, the old sole producer) is
    // not mounted in this state.
    useAuthStore.setState({ hasCompletedOnboarding: false } as never);

    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).toHaveBeenCalledTimes(1);
    expect(mockSyncGlance).toHaveBeenCalledWith('lang-user-1');
  });

  it('LAYOUT-LANGUAGE-003: publishes with NO household — Language has no household concept', async () => {
    useHouseholdStore.setState({ currentHousehold: null });

    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).toHaveBeenCalledTimes(1);
  });

  it('LAYOUT-LANGUAGE-004: does NOT publish on a non-Language brand, or on Android', async () => {
    mockIsLanguageBrand.mockReturnValue(false);

    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).not.toHaveBeenCalled();

    renderer?.unmount();
    renderer = undefined;
    mockIsLanguageBrand.mockReturnValue(true);
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).not.toHaveBeenCalled();
  });

  it('LAYOUT-LANGUAGE-005: does NOT publish with no authenticated user id yet', async () => {
    useAuthStore.setState({ user: undefined } as never);

    await act(async () => {
      renderer = ReactTestRenderer.create(<RootLayout />);
    });
    await flushAsync();

    expect(mockSyncGlance).not.toHaveBeenCalled();
  });
});
