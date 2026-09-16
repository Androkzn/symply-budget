import type { User } from '@models/index';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

import { HEALTH_CACHE_KEYS } from '@features/health/healthCacheKeys';
// Flag only — `flag.ts` has no top-level imports (it lazily `require`s the brand
// pack inside the function), so this cannot recreate the auth <-> Health import
// cycle that `healthCacheKeys` above exists to avoid. Every Health call below is
// gated on it so a flag-0 build never even dynamic-imports the local-first
// modules and behaves exactly as it does today (plan §5.1).
import { isHealthLocalFirst } from '@features/health/local/flag';
import { trackEvent, AnalyticsEvent } from '@services/analytics';
import { biometricService } from '@services/biometric';
import { captureException } from '@services/monitoring';
import {
  clearCompanionToken,
  clearProductTokens,
  loadProductTokens,
  saveProductTokens,
} from '@services/secure-token-storage';
import { settingsSync } from '@services/settings-sync';
import { asyncStorage } from '@services/storage';

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasCompletedOnboarding: boolean;
  biometricEnabled: boolean;
  biometricPromptShown: boolean;
  /**
   * True only once BOTH `persist.rehydrate()` and
   * `hydrateProductTokensFromSecureStore()` have resolved. `isAuthenticated` is
   * persisted (via `partialize`) and can flip true from disk before the
   * SecureStore-held `token` has loaded — any authenticated fetch gated on
   * `isAuthenticated` alone can fire in that window with `token === null` and
   * get a guaranteed 401. Gate on this flag (in addition to `isAuthenticated`)
   * before firing an authenticated request on mount.
   */
  hasHydrated: boolean;
  /** Epoch ms the current access token expires, or null if unknown (never set,
   * or a pre-upgrade session with no stored expiry). */
  tokenExpiresAt: number | null;
}

interface AuthActions {
  setUser: (user: User | null) => void;
  setTokens: (token: string, refreshToken: string, expiresAt?: number) => void;
  login: (user: User, token: string, refreshToken: string, expiresAt?: number) => void;
  logout: () => Promise<void>;
  completeOnboarding: () => void;
  setLoading: (loading: boolean) => void;
  setBiometricEnabled: (enabled: boolean) => void;
  setBiometricPromptShown: (shown: boolean) => void;
  setHasHydrated: (hydrated: boolean) => void;
}

type AuthStore = AuthState & AuthActions;

const initialState: AuthState = {
  user: null,
  token: null,
  refreshToken: null,
  isAuthenticated: false,
  isLoading: false,
  hasCompletedOnboarding: false,
  biometricEnabled: false,
  biometricPromptShown: false,
  hasHydrated: false,
  tokenExpiresAt: null,
};

/** Backend-issued access-token lifetime — `ACCESS_TOKEN_EXPIRY` in every
 * brand's wrangler*.toml (all envs), currently 900s everywhere. Used as the
 * estimate when a real `expires_in` isn't at hand (login/register/biometric);
 * `refreshAccessToken` in api/client.ts supplies the real value on refresh. */
const ACCESS_TOKEN_LIFETIME_MS = 900_000;
/** Proactively refresh once the token is within this long of expiring, so a
 * relaunch/foreground never fires the first authenticated request on a token
 * that's about to (or already did) expire and eat a guaranteed 401. Exported
 * because api/client.ts applies the same window per-request mid-session. */
export const TOKEN_REFRESH_BUFFER_MS = 60_000;

/**
 * Reset every feature store to its initial state on logout.
 *
 * Stores are imported dynamically to avoid a circular dependency (authStore ←
 * these stores ← authStore). Each import+reset is settled INDEPENDENTLY via
 * Promise.allSettled: a single store that fails to evaluate (circular-dep
 * resolution, a bad top-level statement, a failed chunk load) or lacks a reset
 * can no longer abort the rest — and, crucially, can never reject out of
 * logout(). This is best-effort teardown; it runs AFTER the auth flip, so a
 * failure here leaves the user signed out with some stale cached state (harmless
 * — the auth-gated screens are already unmounted), never signed in.
 */
async function resetAppStores(): Promise<void> {
  const results = await Promise.allSettled([
    import('./householdStore').then((m) => m.useHouseholdStore.getState().reset()),
    import('./projectStore').then((m) => m.useProjectStore.getState().reset()),
    import('./taskDraftStore').then((m) => m.useTaskDraftStore.getState().reset()),
    import('./quoteStore').then((m) => m.useQuoteStore.getState().reset()),
    import('./imagesStore').then((m) => m.useImagesStore.getState().reset()),
    import('./appointmentStore').then((m) => m.useAppointmentStore.getState().reset()),
    import('./messageStore').then((m) => m.useMessageStore.getState().reset()),
    import('./homeFeaturesStore').then((m) => m.useHomeFeaturesStore.getState().reset()),
    import('./maintenanceSuggestionsStore').then((m) =>
      m.useMaintenanceSuggestionsStore.getState().reset()
    ),
    import('./taskStore').then((m) => m.useTaskStore.getState().reset()),
    import('./reportStore').then((m) => m.useReportStore.getState().reset()),
    import('./spaceStore').then((m) => m.useSpaceStore.getState().reset()),
    import('./settingsStore').then((m) => m.useSettingsStore.getState().resetSettings()),
    import('./notificationStore').then((m) => m.useNotificationStore.getState().reset()),
    // Not a store, but the same hazard: a BYOK key borrowed from a household
    // member lives in process memory, and the next account signed in on this
    // device must not inherit it.
    import('@services/aiKeyShare').then((m) => m.forgetBorrowedAiKeys()),
  ]);
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    console.error(`[AuthStore] ${failures.length} store(s) failed to reset on logout`, failures);
    captureException(new Error('Store reset failures on logout'), {
      source: 'AuthStore',
      failureCount: failures.length,
    });
  }
}

/**
 * Clear persisted AsyncStorage keys for stores migrated off Zustand persist.
 * Settled independently so one failing key can't abort the rest or reject out
 * of logout(). Best-effort, runs after the auth flip.
 */
async function clearPersistedStores(): Promise<void> {
  const keys = [
    'household-storage',
    'project-storage',
    'task-draft-storage',
    'quote-storage',
    'images-storage',
    'appointment-storage',
    'message-storage',
    'home-features-storage',
    'maintenance-suggestions-storage',
    // Symply Health offline cache. These snapshots hold weight, nutrition,
    // body measurements, cycle and vitality data, so leaving them behind would
    // show one user's health record to the next person who signs in on the same
    // handset. Listed explicitly rather than wildcarded so a new Health cache
    // key has to be added here deliberately.
    ...HEALTH_CACHE_KEYS,
  ];
  const results = await Promise.allSettled(keys.map((k) => asyncStorage.removeItem(k)));
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    console.error(`[AuthStore] ${failures.length} persisted key(s) failed to clear on logout`, failures);
    captureException(new Error('Persisted key clear failures on logout'), {
      source: 'AuthStore',
      failureCount: failures.length,
    });
  }
}

export const useAuthStore = create<AuthStore>()(
  persist(
    immer((set) => ({
      ...initialState,

      setUser: (user) =>
        set((state) => {
          state.user = user;
        }),

      setTokens: (token, refreshToken, expiresAt) => {
        const resolvedExpiresAt = expiresAt ?? Date.now() + ACCESS_TOKEN_LIFETIME_MS;
        set((state) => {
          state.token = token;
          state.refreshToken = refreshToken;
          state.tokenExpiresAt = resolvedExpiresAt;
        });
        void saveProductTokens(token, refreshToken, resolvedExpiresAt);
        // Keep the Face ID / Touch ID refresh-token blob current so "remember
        // last login" still works after silent token rotation.
        void biometricService.updateStoredRefreshToken(refreshToken);
      },

      login: (user, token, refreshToken, expiresAt) => {
        const resolvedExpiresAt = expiresAt ?? Date.now() + ACCESS_TOKEN_LIFETIME_MS;
        set((state) => {
          state.user = user;
          state.token = token;
          state.refreshToken = refreshToken;
          state.isAuthenticated = true;
          state.tokenExpiresAt = resolvedExpiresAt;
          // Sync onboarding status from backend user object
          state.hasCompletedOnboarding = user.has_completed_onboarding;
          console.log('[AuthStore] User logged in, onboarding status:', user.has_completed_onboarding);
        });
        void saveProductTokens(token, refreshToken, resolvedExpiresAt);
        void biometricService.rememberEmail(user.email);
        void biometricService.updateStoredRefreshToken(refreshToken);
        // Flush any settings changes that were deferred while signed out
        // (fire-and-forget; flushNow swallows its own errors).
        settingsSync.flushNow();
        trackEvent(AnalyticsEvent.SIGNED_IN);
        // Budget V2: provision encrypted local ledger after online sign-in.
        void import('@features/budget/local/ensureSession')
          .then((m) => m.ensureBudgetLocalSession())
          .catch((error) => {
            console.warn('[AuthStore] Budget local session failed:', error);
          });
        // House V2: same, for every property this device holds. `ensureHouseLocalSession`
        // enumerates them cheaply and hydrates only the active one (H5 lazy hydration).
        void import('@features/house/local/ensureSession')
          .then((m) => m.ensureHouseLocalSession())
          .catch((error) => {
            console.warn('[AuthStore] House local session failed:', error);
          });
        // Health V2: provision the encrypted personal ledger (plan §5.1, point 1
        // of four). Without this the ledger is closed, every local*Api call
        // throws, and He3's Proxy falls through to D1 — the dual-world state
        // §1.3 rejects, reached by omission rather than by decision.
        if (isHealthLocalFirst()) {
          void import('@features/health/local/ensureSession')
            .then((m) => m.ensureHealthLocalSession())
            .catch((error) => {
              console.warn('[AuthStore] Health local session failed:', error);
            });
        }
      },

      logout: async () => {
        console.log('[AuthStore] Signing out...');

        // Emit BEFORE the flip so the event is still attributed to the signed-in
        // user (app/_layout resets the analytics identity once isAuthenticated
        // flips). trackEvent is internally guarded, but wrap defensively:
        // NOTHING may throw before the state flip below.
        try {
          trackEvent(AnalyticsEvent.SIGNED_OUT);
        } catch (error) {
          console.error('[AuthStore] Failed to track sign-out:', error);
        }

        // Snapshot the refresh token BEFORE the flip so Face ID / Touch ID
        // "remember last login" keeps a usable credential after sign-out.
        // Product JWTs are cleared below; biometric SecureStore is intentionally
        // preserved so the Login screen can re-auth with biometrics + passcode
        // fallback. Users turn this off explicitly in Settings.
        // updateStoredRefreshToken no-ops when enrollment is not enabled in SecureStore.
        const refreshTokenForBiometric = useAuthStore.getState().refreshToken;
        if (refreshTokenForBiometric) {
          void biometricService.updateStoredRefreshToken(refreshTokenForBiometric);
        }

        // Flip auth state FIRST. This is the single source of truth the app's
        // navigation gate (app/_layout, RootNavigator) reacts to, so signing
        // out must never depend on the cleanup below succeeding. This flip
        // previously ran LAST — after ~14 dynamic store imports, resets, and
        // awaited storage removals — so if ANY of that threw or hung, logout()
        // rejected before flipping and the user stayed signed in with no
        // feedback ("sign out does nothing"). The onPress caller floats the
        // promise (`() => logout()`), so that rejection was silent. All brands
        // share this action, so the bug (and this fix) span the whole fleet.
        set((state) => {
          state.user = null;
          state.token = null;
          state.refreshToken = null;
          state.isAuthenticated = false;
          state.hasCompletedOnboarding = false;
          state.tokenExpiresAt = null;
          // Keep biometricEnabled / biometricPromptShown — remember-last-login.
        });

        // Product/companion JWTs live in SecureStore, never in Zustand persist
        // (Data Bridge A7). Clear session tokens only — do NOT wipe biometric
        // enrollment (that would break Face ID re-login after Sign out).
        void Promise.all([clearProductTokens(), clearCompanionToken()]).catch((error) => {
          console.error('[AuthStore] Failed to clear secure tokens:', error);
          captureException(error, { source: 'AuthStore', phase: 'clear_secure_tokens' });
        });

        // Best-effort teardown of the rest of the app's cached state. Isolated
        // from the flip above: nothing here can revert the sign-out, and one
        // failing store/key can't abort the others (see helpers).
        await resetAppStores();
        await clearPersistedStores();
        void import('@features/budget/local')
          .then((m) => m.teardownBudgetLocalSession())
          .catch(() => undefined);
        void import('@features/house/local/ensureSession')
          .then((m) => m.teardownHouseLocalSession())
          .catch(() => undefined);
        // Health V2 (plan §5.1, point 3). `{ wipe: true }` where the siblings
        // pass nothing: plan §1.3 makes sign-out destroy the Health ledger,
        // both WAL sidecars and the DEK, not merely close the session. The
        // MMKV mirrors are already cleared above via HEALTH_CACHE_KEYS; the
        // ciphertext and its key are what this call removes, and leaving them
        // is the leak `privacy-cross-user-leak.yaml` exists to catch.
        if (isHealthLocalFirst()) {
          void import('@features/health/local/ensureSession')
            .then((m) => m.teardownHealthLocalSession({ wipe: true }))
            .catch(() => undefined);
        }

        console.log('[AuthStore] User logged out successfully');
      },

      completeOnboarding: () => {
        set((state) => {
          state.hasCompletedOnboarding = true;
        });
        trackEvent(AnalyticsEvent.ONBOARDING_COMPLETED);
      },

      setLoading: (loading) =>
        set((state) => {
          state.isLoading = loading;
        }),

      setBiometricEnabled: (enabled) => {
        set((state) => {
          state.biometricEnabled = enabled;
        });
        // Sync biometric preference to database
        settingsSync.queueSync('auth.biometricEnabled', enabled);
      },

      setBiometricPromptShown: (shown) => {
        set((state) => {
          state.biometricPromptShown = shown;
        });
        // Sync biometric prompt shown to database
        settingsSync.queueSync('auth.biometricPromptShown', shown);
      },

      setHasHydrated: (hydrated) =>
        set((state) => {
          state.hasHydrated = hydrated;
        }),
    })),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => asyncStorage),
      // Skip automatic rehydration - we'll do it manually when MMKV is ready
      skipHydration: true,
      partialize: (state) => ({
        user: state.user,
        // Product JWTs must not enter Zustand persist / MMKV (Data Bridge A7).
        isAuthenticated: state.isAuthenticated,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        biometricEnabled: state.biometricEnabled,
        biometricPromptShown: state.biometricPromptShown,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          console.log('[AuthStore] Rehydrated successfully:', {
            hasUser: !!state.user,
            isAuthenticated: state.isAuthenticated,
          });
        } else {
          console.log('[AuthStore] Rehydration found no stored data - user needs to login');
        }
      },
    }
  )
);

/**
 * Load product JWTs from SecureStore into memory.
 * Must be awaited after persist.rehydrate() and before treating the app as ready.
 */
export async function hydrateProductTokensFromSecureStore(): Promise<void> {
  try {
    let accessToken: string | null = null;
    let refreshToken: string | null = null;
    let expiresAt: number | null = null;
    try {
      ({ accessToken, refreshToken, expiresAt } = await loadProductTokens());
    } catch (error) {
      // Debug simulators often lack Keychain entitlements — SecureStore reads fail
      // and leave a zombie session (isAuthenticated + user, no JWT). Clear it so
      // Maestro e2e-login / the login form can establish a fresh session.
      console.warn('[AuthStore] SecureStore unavailable — clearing persisted auth', error);
      useAuthStore.setState({
        isAuthenticated: false,
        user: null,
        token: null,
        refreshToken: null,
      });
      return;
    }

    const state = useAuthStore.getState();
    if (accessToken && refreshToken) {
      useAuthStore.setState({
        token: accessToken,
        refreshToken,
        isAuthenticated: true,
        tokenExpiresAt: expiresAt,
      });

      // Proactively refresh a token that's expired or about to (or one with no
      // recorded expiry — a pre-upgrade session, treated as unknown/stale) so
      // the first authenticated request this launch fires doesn't eat a
      // guaranteed 401 before the reactive retry-after-refresh path kicks in.
      // Best-effort: on failure just fall through to that reactive path.
      const nearExpiry = expiresAt == null || expiresAt - Date.now() < TOKEN_REFRESH_BUFFER_MS;
      if (nearExpiry) {
        try {
          // require(), not `import()`: this file's dynamic-import sibling
          // (resetAppStores, above) uses ESM `import()`, but that throws
          // "invoked without --experimental-vm-modules" under this project's
          // Jest/Babel config — require() lazily resolves at call time the
          // same way (still sidesteps the client.ts <-> authStore.ts circular
          // top-level import) and is what jest.mock() reliably intercepts.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { refreshAccessToken } = require('../api/client') as typeof import('../api/client');
          await refreshAccessToken();
        } catch (error) {
          console.warn('[AuthStore] Proactive token refresh failed — will retry reactively', error);
        }
      }
      return;
    }
    if (state.isAuthenticated && !accessToken) {
      useAuthStore.setState({
        isAuthenticated: false,
        user: null,
        token: null,
        refreshToken: null,
      });
    }
  } finally {
    // Marks the store trustworthy for auth-gated fetches regardless of which
    // branch above ran — see `hasHydrated` doc comment on AuthState.
    useAuthStore.setState({ hasHydrated: true });
    // Budget V2: reopen local ledger after cold start when already signed in.
    void import('@features/budget/local/ensureSession')
      .then((m) => m.ensureBudgetLocalSession())
      .catch((error) => {
        console.warn('[AuthStore] Budget local session (hydrate) failed:', error);
      });
    // House V2: same. Both guards live inside ensureHouseLocalSession
    // (`hasHydrated && isAuthenticated`), so calling it here is safe even when
    // this branch ran for a signed-out user.
    void import('@features/house/local/ensureSession')
      .then((m) => m.ensureHouseLocalSession())
      .catch((error) => {
        console.warn('[AuthStore] House local session (hydrate) failed:', error);
      });
    // Health V2 cold start (plan §5.1, point 2). This is the branch that matters
    // most: the sign-in hook only fires on a fresh login, so a relaunch of an
    // already-signed-in device reaches the Health screens through this path
    // alone. `ensureHealthLocalSession` re-checks `hasHydrated && isAuthenticated`
    // itself, so calling it here is safe even when this ran for a signed-out user.
    if (isHealthLocalFirst()) {
      void import('@features/health/local/ensureSession')
        .then((m) => m.ensureHealthLocalSession())
        .catch((error) => {
          console.warn('[AuthStore] Health local session (hydrate) failed:', error);
        });
    }
  }
}

/**
 * Align Zustand biometricEnabled with SecureStore enrollment (device source of
 * truth for Face ID / Touch ID remember-last-login). Does not queue settings sync.
 */
export async function hydrateBiometricPreferenceFromSecureStore(): Promise<void> {
  try {
    const hasCreds = await biometricService.hasStoredCredentials();
    if (hasCreds && !useAuthStore.getState().biometricEnabled) {
      useAuthStore.setState({ biometricEnabled: true });
    }
  } catch (error) {
    console.error('[AuthStore] Failed to hydrate biometric preference:', error);
  }
}
