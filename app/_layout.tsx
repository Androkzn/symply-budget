// Must run before @noble/* (Budget local-first). expo-router entry skips root index.js.
import 'react-native-get-random-values';
import '@features/budget/local/cryptoPolyfill';

import { QueryClientProvider } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Stack, SplashScreen, useRouter, usePathname } from 'expo-router';
import { NavigationContainer, NavigationIndependentTree } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import { AppState, LogBox, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { queryClient } from '@/lib/queryClient';
import { installE2EGlobalProbe } from '@api/e2eTestObservability';
import { isHouseBrand } from '@brand';
import { isFullBudget } from '@brand/capabilities';
import { AIConnectionWatcher } from '@components/ai/AIConnectionWatcher';
import { AiLeaseKeeper } from '@components/ai/AiLeaseKeeper';
import { BiometricEnrollmentGate } from '@components/auth/BiometricEnrollmentGate';
import { E2EVerifyBadge, NetworkBlockOverlay, TapOutsideWrapper } from '@components/common';
import { ToastContainer } from '@components/ui';
import { ENV } from '@config/env';
import {
  ThemeProvider,
  ProfileProvider,
  DataProvider,
  I18nProvider,
  SubscriptionProvider,
  TapOutsideProvider,
} from '@contexts/index';
import { startBudgetSnapshotWatcher } from '@features/budget/budgetSnapshot';
// Deep paths on purpose: `@features/health` re-exports every Health screen, so
// importing the barrel here would pull the whole feature into the root bundle.
// Same reasoning for the Budget invite store: it is deliberately free of the
// local-first engine so parsing a launch URL costs nothing.
import {
  captureBudgetInviteLink,
  captureInitialBudgetInviteLink,
  useBudgetInviteLinkStore,
} from '@features/budget/local/inviteLinkStore';
import { isHealthBrand } from '@features/health/brandGuard';
// Same reasoning as the Budget store above: House's invite store is deliberately
// free of the local-first engine, so parsing a launch URL costs nothing.
import { startHealthKitBackgroundSync } from '@features/health/healthKitBackgroundSync';
import { syncHealthReminderTimezone } from '@features/health/healthRemindersStorage';
import { syncHealthGlanceFromServer } from '@features/health/healthWidgetStorage';
import {
  captureHouseInviteLink,
  captureInitialHouseInviteLink,
  useHouseInviteLinkStore,
} from '@features/house/local/inviteLinkStore';
import { isKaizenBrand } from '@features/kaizen';
import { handleKaizenDeepLink } from '@features/kaizen/services/deepLinks';
import { syncKaizenGlance } from '@features/kaizen/services/kaizenWidgetSnapshot';
import { isLanguageBrand } from '@features/language/brandGuard';
import { syncLanguageGlance } from '@features/language/languageWidgetSnapshot';
import { useAIAccessErrorNavigation } from '@hooks/useAIAccessErrorNavigation';
import { MOVEMENT_FEED_POLL_MS, refreshMovementFeed } from '@hooks/useMovementFeed';
import { useNotificationHandler } from '@hooks/useNotificationHandler';
import { RootNavigator, usePropertyAddressCaptureGate } from '@navigation/RootNavigator';
// Deep path, not the `@screens/house-v2/enrolment` barrel: that barrel re-exports
// every enrolment screen and the barrel next to it pulls both cloud SDKs, and
// this file is evaluated at startup on all four brands. The recovery screen
// itself is deliberately free of both — it reaches its two destinations by URL.
import {
  HouseRecoverHomeScreen,
  useHouseRecoveryGate,
} from '@screens/house-v2/enrolment/HouseRecoverHomeScreen';
import { initAnalytics, identifyUser, resetAnalytics, trackScreen } from '@services/analytics';
import { trySetE2ELoginFromUrl } from '@services/e2e-autologin';
import { tryQueueE2EDocumentPickFromUrl } from '@services/e2e-document-pick';
import {
  flushPendingE2EKaizenSetup,
  tryQueueE2ESetupFromUrl,
} from '@services/e2e-kaizen-setup';
import { tryHandleE2ETestDeepLink } from '@services/e2e-test-deeplinks';
import {
  initMonitoring,
  identifyMonitoringUser,
  resetMonitoringUser,
  wrapRoot,
  captureException,
} from '@services/monitoring';
import { navigateToHouseJoin, navigationRef } from '@services/navigation';
import { configurePurchases, logInPurchases } from '@services/purchases';
import {
  isStorageReady,
  isUsingMMKV,
  migrateAsyncStorageToMMKV,
  storageHelpers,
} from '@services/storage';
import { watchSyncService } from '@services/watch-sync';
import { widgetSync } from '@services/widget-sync';
import {
  useAuthStore,
  hydrateProductTokensFromSecureStore,
  hydrateBiometricPreferenceFromSecureStore,
} from '@stores/authStore';
import { useFeatureFlagStore } from '@stores/featureFlagStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useInviteStore, parseJoinToken, shouldForwardInviteToken } from '@stores/inviteStore';
import { useNotificationStore } from '@stores/notificationStore';
import { logMovementFeed } from '@utils/movementFeedDebug';

// Dev-only: disable the LogBox notification overlay. In a Debug build LogBox
// floats a "Open debugger to view warnings" toast at the bottom of the screen —
// and with our floating capsule tab bar it lands directly on top of the tab
// items and swallows their taps, breaking tab navigation both in manual dev and
// in every Maestro E2E flow. The warnings behind it are benign/unactionable
// here anyway (110+ `Require cycle:` circular-import warnings, plus RevenueCat
// failing to fetch offerings because the Simulator can't reach StoreKit) and
// they re-fire throughout the session, so an allowlist of patterns can't keep
// the toast down. Warnings/errors are still visible in the Metro console. No
// effect in production — LogBox is __DEV__-only.
if (__DEV__) {
  LogBox.ignoreAllLogs(true);
  installE2EGlobalProbe();
  // Expo Dev Client's floating blue "Tools" FAB sits on the top-right and
  // steals taps meant for header-notifications / header-profile during Maestro.
  // Shake / Cmd+D still open the menu. No-op when the native module is absent.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo') as typeof import('expo');
    const DevMenuPreferences = requireOptionalNativeModule('DevMenuPreferences') as {
      setPreferencesAsync?: (prefs: Record<string, boolean>) => Promise<void>;
    } | null;
    void DevMenuPreferences?.setPreferencesAsync?.({
      showFloatingActionButton: false,
      showsAtLaunch: false,
    });
  } catch {
    // Older / release shells without expo-dev-menu preferences.
  }
}

// Crash / error monitoring (Sentry). Brand-aware + gated + a no-op when
// unconfigured — see src/services/monitoring.ts. Fired at module load, before
// wrapRoot() and the first render, so early-startup crashes are captured.
initMonitoring();

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

function useE2ELoginDeepLinks() {
  useEffect(() => {
    Linking.getInitialURL()
      .then(async (url) => {
        if (tryHandleE2ETestDeepLink(url)) return;
        if (url && isKaizenBrand() && handleKaizenDeepLink(url)) return;
        // An invite link may arrive on a cold start, long before the Budget
        // stack exists — it is parked and forwarded once the shell is up. The
        // launch URL is re-delivered on every relaunch, so this one is honoured
        // once per invite code rather than on every launch.
        if (await captureInitialBudgetInviteLink(url)) return;
        // House's own `simplehouse://lf-invite?…`. Both brands park the link and
        // forward it once the authenticated shell is up; each reads only its own
        // scheme's URLs, and the parse is a regex over the query either way.
        if (isHouseBrand() && (await captureInitialHouseInviteLink(url))) return;
        trySetE2ELoginFromUrl(url);
        tryQueueE2ESetupFromUrl(url);
        tryQueueE2EDocumentPickFromUrl(url);
      })
      .catch(() => {});

    const sub = Linking.addEventListener('url', ({ url }) => {
      if (tryHandleE2ETestDeepLink(url)) return;
      if (isKaizenBrand() && handleKaizenDeepLink(url)) return;
      if (captureBudgetInviteLink(url)) return;
      if (isHouseBrand() && captureHouseInviteLink(url)) return;
      trySetE2ELoginFromUrl(url);
      tryQueueE2ESetupFromUrl(url);
      tryQueueE2EDocumentPickFromUrl(url);
    });
    return () => sub.remove();
  }, []);
}

function AppContent() {
  const [isReady, setIsReady] = useState(false);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hasCompletedOnboarding = useAuthStore((state) => state.hasCompletedOnboarding);
  const watchUserId = useAuthStore((state) => state.user?.id);
  const currentHouseholdId = useHouseholdStore((state) => state.currentHousehold?.id);
  const router = useRouter();
  const pathname = usePathname();
  const pendingJoinToken = useInviteStore((state) => state.pendingJoinToken);
  const setPendingJoinToken = useInviteStore((state) => state.setPendingJoinToken);
  const pendingBudgetInvite = useBudgetInviteLinkStore((state) => state.pendingInvite);
  const pendingHouseInvite = useHouseInviteLinkStore((state) => state.pendingInvite);
  const notificationsInitialized = useRef(false);

  /**
   * The two House states in which this device holds no key for the account's
   * homes. Null on every other brand and in every healthy state.
   */
  const houseRecovery = useHouseRecoveryGate();

  /**
   * Does this device hold a home that still needs its address captured?
   *
   * Asked here as well as inside `RootNavigator` because THIS is where the
   * mount decision is made — the navigator only decides which of its own routes
   * to open once it is mounted. Signing in again on a fresh install restores
   * `hasCompletedOnboarding` from the server, so onboarding is skipped while an
   * address-less home is created underneath; that home can never resolve a
   * property-assessment jurisdiction, and the only address form in the app sits
   * behind the step that was skipped.
   *
   * Narrowed by `!houseRecovery` because the two gates disagree about exactly
   * one member: one whose home is on another phone has no address to capture
   * and no way to save one, and `CreateHousehold` would MAKE a home — the very
   * outcome the recovery screen exists to prevent.
   */
  const needsAddressCapture = usePropertyAddressCaptureGate() && !houseRecovery;

  /**
   * Has this device DISCOVERED homes on this account that it holds no key for?
   *
   * The same-account second device (the iPhone + iPad case) signs in, finds the
   * household already on the control plane, adopts a key-less placeholder, and
   * publishes `recover-this-home` — all correctly, before this render. But the
   * onboarding gate below asks the SERVER's `hasCompletedOnboarding` flag, and
   * that flag belongs to the account's first device: `recordOnboardingStep` is
   * fire-and-forget and answers 401/403 on a not-yet-enrolled local-first
   * device, so it is routinely still false for an account that demonstrably has
   * a home. Onboarding therefore won, and `CreateHousehold` MINTED ANOTHER
   * HOUSEHOLD beside the placeholder — which is how one test account
   * accumulated four homes in a single afternoon, each with its own key that no
   * other device holds.
   *
   * So the discovery result outranks the flag: a device that has positively
   * found homes is not a first-run device, whatever the server row says.
   *
   * Deliberately NOT `undecided-offline`. That state means "could not reach us
   * to find out", and a genuinely new member whose network dropped between
   * sign-in and the households call must still be able to create their first
   * home. Only the state carrying positive evidence of existing homes may
   * suppress onboarding; the offline card still appears inside the shell.
   */
  const hasHomesToRecover = houseRecovery?.status === 'recover-this-home';

  useAIAccessErrorNavigation();

  // Dev-only: after Maestro autologin, finish Kaizen onboarding so Today tab renders.
  useEffect(() => {
    if (!__DEV__ || !isReady || !isAuthenticated) return;
    void flushPendingE2EKaizenSetup();
  }, [isReady, isAuthenticated]);

  // Mount notification listeners only AFTER auth rehydration completes and the
  // user is authenticated; before that the helpers can't route anywhere
  // meaningful. The hook is a no-op when `enabled` is false.
  useNotificationHandler({
    enabled: isReady && isAuthenticated && hasCompletedOnboarding,
  });

  /**
   * Keep notifications arriving when push cannot deliver them.
   *
   * Everything that tells a member something happened — the bell count, the
   * inbox, "someone claimed your invite", "your invite was cancelled" — reaches
   * the app one of two ways: a push, or `refreshMovementFeed`. And that refresh
   * only ran on the Home screen, inside a focus effect. So off Home, with no
   * push, nothing arrived at all.
   *
   * Push is not the reliable half people assume. It cannot reach the iOS
   * Simulator, it is gone the moment notifications are denied or a token is
   * revoked, and even at its best it lands after the event. Three separate
   * "the notification never came" reports in one session were all this: the
   * row existed on the server the whole time and no client ever asked for it.
   *
   * Foreground only, and only while signed in — the point is a member watching
   * the app, not background traffic. `AppState` restarts the timer on return
   * rather than leaving a stale one running through a backgrounded hour.
   */
  useEffect(() => {
    if (!isReady || !isAuthenticated || !hasCompletedOnboarding) return;

    let poll: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (poll) return;
      void refreshMovementFeed('app-poll');
      poll = setInterval(() => void refreshMovementFeed('app-poll'), MOVEMENT_FEED_POLL_MS);
    };
    const stop = () => {
      if (!poll) return;
      clearInterval(poll);
      poll = null;
    };

    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') start();
      else stop();
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [isReady, isAuthenticated, hasCompletedOnboarding]);

  // Expo-router users never mount RootNavigator, so initialize push + unread
  // sync here once the authenticated shell is active.
  useEffect(() => {
    if (!isReady || !isAuthenticated || !hasCompletedOnboarding) {
      notificationsInitialized.current = false;
      return;
    }
    if (notificationsInitialized.current) return;
    notificationsInitialized.current = true;
    logMovementFeed('app/_layout — notificationStore.initialize');
    void useNotificationStore.getState().initialize();
  }, [isReady, isAuthenticated, hasCompletedOnboarding]);

  // Push household context to Widget/Watch App Group (iOS). Product at+jwt must
  // never enter App Group — companion+jwt only (minted separately when ready).
  //
  // Symply Health has no household concept at all (BRD §7: personal data,
  // never shared) and no onboarding path ever creates one for a Health member
  // (`OnboardingNavigator` registers `CreateHousehold`/`JoinHousehold` only for
  // House), so `currentHouseholdId` is permanently null for Health — gating
  // this whole effect on it stranded the widget/watch "signed in" signal
  // (`current_household_id` in the App Group) forever empty and silently
  // skipped `syncHealthGlanceFromServer` / `syncHealthReminderTimezone` too.
  // The widget/watch side only ever checks this id for non-empty presence
  // (never dereferences it as a real household), so the member's own user id
  // is a safe stand-in "signed in" marker for Health.
  const widgetHouseholdId = isHealthBrand() ? watchUserId : currentHouseholdId;
  useEffect(() => {
    if (Platform.OS !== 'ios' || !isReady) return;

    if (isAuthenticated && watchUserId && widgetHouseholdId) {
      widgetSync.setApiBaseUrl(ENV.API_BASE_URL);
      widgetSync.setAuth(widgetHouseholdId, watchUserId);
      void watchSyncService.setApiBaseUrl(ENV.API_BASE_URL);
      // Clear any legacy product JWT from Watch App Group; companion mint is Phase B/A later.
      void watchSyncService.syncAuthTokens('', widgetHouseholdId, watchUserId);
      // Symply Health's widget AND watch face read today's glance out of the
      // App Group. Publishing it here — rather than only from a screen — is
      // what lets both surfaces render before the member has opened the app,
      // which is the entire point of a widget. `syncHealthGlanceFromServer`
      // swallows its own failures and no-ops off iOS.
      if (isHealthBrand()) {
        void syncHealthGlanceFromServer();
        // Reminders are materialised SERVER-side against the member's stored
        // timezone, so a member who flies to Tokyo would keep getting their
        // 08:00 breakfast nudge at 08:00 London time until the server is told.
        // No-ops when nothing is enabled, and swallows its own failures.
        void syncHealthReminderTimezone();
      }
    } else if (!isAuthenticated) {
      widgetSync.clear();
      void watchSyncService.clearWatchData();
    }
  }, [isReady, isAuthenticated, watchUserId, widgetHouseholdId]);

  // Symply Budget: keep the widget and the Watch face on the member's chosen
  // currency.
  //
  // Both surfaces render a snapshot the app pushes into the App Group, and that
  // snapshot carries the ISO code as data — they cannot read the store, and the
  // widget's own fallback is USD. The only writer is an effect inside
  // `BudgetDashboardView`, but Settings → Currency is several screens away from
  // it, so the preference changed with nothing mounted to re-publish and the
  // home screen kept formatting in dollars. This watcher re-emits the last
  // published figures under the new code; its cleanup also drops them, so a
  // second member on the same handset cannot resurrect the first's balances.
  // Matrix: BUDGET-WIDGET-022, BUDGET-WATCH-011.
  useEffect(() => {
    if (Platform.OS !== 'ios' || !isReady || !isFullBudget()) return;
    if (!isAuthenticated) return;
    return startBudgetSnapshotWatcher();
  }, [isReady, isAuthenticated]);

  // Symply Kaizen: publish today's habit snapshot to the App Group on sign-in.
  //
  // Deliberately NOT part of the household effect above and NOT gated on
  // `hasCompletedOnboarding`. Kaizen has no household domain at all, and its only
  // producer used to be an effect inside `TodayScreen` — a screen the tab shell
  // never mounts until onboarding completes (see the RootNavigator branch below).
  // A member signed in but still working through Kaizen's required systems setup
  // therefore had a permanently blank widget reading "Sign in to track your
  // habits". Publishing here keys on the user id alone, which is all Kaizen has
  // and all it needs. `syncKaizenGlance` swallows its own failures.
  useEffect(() => {
    if (Platform.OS !== 'ios' || !isReady || !isKaizenBrand()) return;
    if (!isAuthenticated || !watchUserId) return;
    void syncKaizenGlance(watchUserId);
  }, [isReady, isAuthenticated, watchUserId]);

  // Symply Language: same shape, same reasons. `LanguageLearnScreen`'s effect was
  // the only writer of `widget_language_today` (and NOTHING wrote the Watch's
  // `watch_language_today`, so that face was dead outright). Language has no
  // household either, so this keys on the user id alone.
  // `syncLanguageGlance` swallows its own failures and degrades per-endpoint.
  useEffect(() => {
    if (Platform.OS !== 'ios' || !isReady || !isLanguageBrand()) return;
    if (!isAuthenticated || !watchUserId) return;
    void syncLanguageGlance(watchUserId);
  }, [isReady, isAuthenticated, watchUserId]);

  // Symply Health: react to a HealthKit change without a Sync tap. Started once
  // the authenticated shell is up, on iOS only (the native module is a no-op
  // everywhere else, but there's nothing to listen to off-platform), and torn
  // down on sign-out so a second member on the same handset never inherits a
  // running listener with the first member's toasts.
  useEffect(() => {
    if (!isReady || !isAuthenticated || Platform.OS !== 'ios' || !isHealthBrand()) return;
    const handle = startHealthKitBackgroundSync();
    return () => handle.stop();
  }, [isReady, isAuthenticated]);

  // RevenueCat: configure once and bind App User ID to SimpleHouse user (plan §6.2).
  useEffect(() => {
    if (!isReady || !isAuthenticated || !watchUserId) return;
    void (async () => {
      const ok = await configurePurchases();
      if (ok) await logInPurchases(watchUserId);
    })();
  }, [isReady, isAuthenticated, watchUserId]);

  // Analytics + crash-report identity: bind to the Symply user on login, reset
  // on sign-out — mirrors the RevenueCat identity binding above. Tying the user
  // id to Sentry lets a crash be traced back to the affected account.
  useEffect(() => {
    if (!isReady) return;
    if (isAuthenticated && watchUserId) {
      identifyUser(watchUserId);
      identifyMonitoringUser(watchUserId);
    } else if (!isAuthenticated) {
      resetAnalytics();
      resetMonitoringUser();
    }
  }, [isReady, isAuthenticated, watchUserId]);

  // Screen tracking for the authenticated expo-router shell. Fires on every
  // route change; unconfigured/dev builds no-op inside trackScreen.
  useEffect(() => {
    if (!isReady || !pathname) return;
    trackScreen(pathname);
  }, [isReady, pathname]);

  // Capture shareable household invite links (`/join/<token>` or `/j/<code>`). The expo-router
  // `<Slot />` only mounts for authenticated+onboarded users, so a cold-start
  // tap by a signed-out user would otherwise be dropped. We stash the token and
  // forward into the Join route once the user is signed in (see effect below).
  //
  // GOTCHA: `Linking.getInitialURL()` returns the URL that launched the app and
  // keeps returning it on every subsequent relaunch / re-mount (the OS re-delivers
  // the original launch URL). Without a guard, a one-time invite tap gets replayed
  // on EVERY launch — re-navigating to a link that has since been consumed/expired
  // and showing "Invite Unavailable" forever. So we remember the last initial-URL
  // token we handled (persisted) and ignore it on replay. Warm `url` events are
  // always genuine fresh taps, so they're honored unconditionally.
  useEffect(() => {
    const HANDLED_INVITE_KEY = 'handled-initial-invite-token';

    const handleToken = async (token: string, fromInitialUrl: boolean) => {
      const handledToken = await storageHelpers.getString(HANDLED_INVITE_KEY);
      if (!shouldForwardInviteToken({ token, handledToken, fromInitialUrl })) return;
      await storageHelpers.setString(HANDLED_INVITE_KEY, token);
      setPendingJoinToken(token);
    };

    Linking.getInitialURL()
      .then((url) => {
        const token = parseJoinToken(url);
        if (token) void handleToken(token, true);
      })
      .catch(() => {});

    const sub = Linking.addEventListener('url', ({ url }) => {
      const token = parseJoinToken(url);
      if (token) void handleToken(token, false);
    });
    return () => sub.remove();
  }, [setPendingJoinToken]);

  // Once authenticated, forward any captured invite token into the Join route.
  // `JoinHouseholdScreen` clears the pending token on mount, so this fires once.
  useEffect(() => {
    if (isReady && isAuthenticated && hasCompletedOnboarding && pendingJoinToken) {
      router.replace(`/join/${encodeURIComponent(pendingJoinToken)}`);
    }
  }, [isReady, isAuthenticated, hasCompletedOnboarding, pendingJoinToken, router]);

  // Same idea for a tapped Budget invite link, one route further in: open the
  // Home tab with `screen=BudgetInvite`, which is the same door the Settings
  // row and the E2E deep link already use. Only the destination travels through
  // the router — the code and secret stay in the store and are read by the
  // screen itself, because route params are not a place to put a secret.
  useEffect(() => {
    if (!isReady || !isAuthenticated || !hasCompletedOnboarding || !pendingBudgetInvite) return;
    // Re-enter through the app's own URL rather than `router.push`.
    //
    // The Budget screens live in a React Navigation stack nested inside the
    // Home tab, and that stack is driven by a `screen=` search param the tab
    // reads with `useLocalSearchParams`. An imperative push to `/` does not
    // deliver new params to a tab that is already mounted — verified on
    // Budget-B: the link was captured, the tab re-focused, and the invite
    // screen never opened. The same URL handed to Linking does open it, which
    // is also how the E2E suites reach this screen.
    const url = Linking.createURL('/', {
      // The navigator de-dupes by `screen:itemId:navNonce`, so a second invite
      // in the same session needs a distinct nonce to move at all.
      queryParams: { screen: 'BudgetInvite', navNonce: String(Date.now()) },
    });
    console.log('[budget-invite] opening', url);
    void Linking.openURL(url).catch((error) => {
      console.warn('[budget-invite] could not open the invite screen', error);
    });
  }, [isReady, isAuthenticated, hasCompletedOnboarding, pendingBudgetInvite, router]);

  /**
   * The House equivalent, one route further in.
   *
   * House's enrolment screens live in the SETTINGS stack, which sits in a
   * `NavigationIndependentTree` — nothing outside it can `navigate()` into it.
   * `navigateToHouseJoin` is the established hop for that: it queues the target
   * in the pending-navigation store, pushes `/settings`, and the navigator's own
   * handler performs the navigation once it is mounted.
   *
   * The invite goes straight to JOIN rather than to the hub, with the fields
   * already filled — the invitee's only remaining act is agreeing to the home
   * the link names, and landing them on a hub with no sign of why they are here
   * is the least useful thing this can do. Nothing is claimed by arriving.
   *
   * `takePendingHouseInvite` is not called here: the store entry is cleared by
   * the same act that consumes it, and clearing it before the navigation lands
   * would lose the invite if the push were dropped.
   */
  useEffect(() => {
    if (!isReady || !isAuthenticated || !hasCompletedOnboarding || !pendingHouseInvite) return;
    if (!isHouseBrand()) return;
    console.log('[house-invite] opening the join screen', pendingHouseInvite.code);
    useHouseInviteLinkStore.getState().setPendingInvite(null);
    navigateToHouseJoin(pendingHouseInvite);
  }, [isReady, isAuthenticated, hasCompletedOnboarding, pendingHouseInvite]);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        console.log('[App] Checking storage...');
        console.log('[App] Storage ready:', isStorageReady());
        console.log('[App] Using MMKV:', isUsingMMKV());

        // First launch after the MMKV v4 upgrade: copy any data that has been
        // living in the AsyncStorage fallback into MMKV before anything reads it,
        // so persisted sessions/prefs survive the storage-backend switch. No-op
        // once migrated or when MMKV is unavailable.
        await migrateAsyncStorageToMMKV();

        // Debug: Check what's stored
        const storedAuthData = await storageHelpers.getString('auth-storage');
        console.log('[App] Stored auth data:', storedAuthData ? 'EXISTS' : 'NONE');
        if (storedAuthData) {
          try {
            const parsed = JSON.parse(storedAuthData);
            console.log('[App] Stored auth state:', {
              hasUser: !!parsed?.state?.user,
              hasToken: !!parsed?.state?.token,
              isAuthenticated: parsed?.state?.isAuthenticated,
            });
          } catch (e) {
            console.error('[App] Failed to parse stored auth data:', e);
            captureException(e, { source: 'App', phase: 'parse_stored_auth' });
          }
        }

        console.log('[App] Rehydrating auth store...');
        // Rehydrate auth store
        await useAuthStore.persist.rehydrate();
        // Product JWTs live in SecureStore — must finish before isReady.
        await hydrateProductTokensFromSecureStore();
        // Face ID / Touch ID enrollment flag — SecureStore is device source of truth.
        await hydrateBiometricPreferenceFromSecureStore();
        console.log('[App] Auth store rehydration complete');

        const authState = useAuthStore.getState();
        console.log('[App] Authentication status after rehydration:', {
          isAuthenticated: authState.isAuthenticated,
          hasUser: !!authState.user,
          hasToken: !!authState.token,
          hasRefreshToken: !!authState.refreshToken,
          hasCompletedOnboarding: authState.hasCompletedOnboarding,
        });

        // Signed in, but we do not know WHO — recover the profile before anything
        // gated on it runs.
        //
        // The two halves of a session have different lifetimes: tokens live in
        // the Keychain, which survives an app uninstall, while the user record
        // lives in MMKV, which does not. Reinstalling therefore lands here
        // authenticated with `user === null`, and everything keyed on the member
        // id silently does nothing — `ensureBudgetLocalSession` returns early on
        // `!user?.id`, so no local ledger is ever provisioned and every
        // local-first action fails a precondition it never explains. Observed as
        // "Could not join. Check the invite has not expired…" against a valid,
        // freshly minted invite: the join needs a ledger, not a better code.
        //
        // Restoring or dropping the ID token is deliberately NOT the fix — the
        // tokens are valid and the session is real; only the profile is missing,
        // and one request brings it back.
        if (authState.isAuthenticated && authState.token && !authState.user) {
          try {
            const { userApi } = await import('@api/user');
            const { user } = await userApi.getProfile();
            useAuthStore.getState().setUser(user);
            console.log('[App] Recovered user profile for an authenticated session', {
              userId: user.id,
            });
          } catch (e) {
            // Offline, or the token really is dead. Leave the session as it is:
            // the 401 path already handles a dead token, and a transient network
            // failure must not sign anybody out.
            console.warn('[App] Could not recover user profile', e);
          }
        }

        // Feature flags: rehydrate cached values first so the very first render
        // uses last-known flags (no flicker / no exposing hidden surfaces), then
        // refresh from the network in the background. The endpoint is public, so
        // this runs regardless of auth state.
        await useFeatureFlagStore.persist.rehydrate();
        void useFeatureFlagStore.getState().fetchFlags();

        setIsReady(true);
        logMovementFeed('app/_layout — auth ready', {
          api: ENV.API_BASE_URL,
          isAuthenticated: useAuthStore.getState().isAuthenticated,
          hasCompletedOnboarding: useAuthStore.getState().hasCompletedOnboarding,
          userId: useAuthStore.getState().user?.id,
        });
      } catch (error) {
        console.error('[App] Initialization error:', error);
        captureException(error, { source: 'App', phase: 'initializeAuth' });
        setIsReady(true);
        logMovementFeed('app/_layout — auth ready (after init error)');
      }
    };

    initializeAuth();
  }, []);

  // Refresh feature flags whenever the app returns to the foreground. Cheap —
  // the response is edge-cached for 60s — and keeps a remote kill-switch flip
  // reflected without an app restart.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void useFeatureFlagStore.getState().fetchFlags();
      }
    });
    return () => sub.remove();
  }, []);

  // Don't render until MMKV is initialized and auth is rehydrated
  if (!isReady) {
    return null;
  }

  // If not authenticated or hasn't completed onboarding, use RootNavigator for
  // auth flow — unless this device has found homes it needs the key for, in
  // which case onboarding would mint a duplicate (see `hasHomesToRecover`). Such
  // a device falls through to the authenticated shell, where the recovery screen
  // draws on top of the Stack that hosts its two exits.
  if (!isAuthenticated || (!hasCompletedOnboarding && !hasHomesToRecover) || needsAddressCapture) {
    return (
      <NavigationIndependentTree>
        <NavigationContainer ref={navigationRef}>
          <RootNavigator />
        </NavigationContainer>
      </NavigationIndependentTree>
    );
  }

  // Authenticated shell: a real native Stack (not a bare <Slot />). The Stack is
  // what gives every route PUSHED above the tabs — AI access, AI Housekeeper,
  // chat, the settings detail screens — a proper back button and swipe-back
  // gesture. A <Slot /> renders the matched route with NO navigator, so any
  // screen that declared a header via <Stack.Screen> (e.g. app/ai-access/*) got
  // none and the user was stranded with no way back. Headers are OFF by default
  // here (the tabs and the screens that draw their own in-body header keep their
  // look); a screen opts into the native header per-route via <Stack.Screen>.
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      {/* House local-first: this device holds no key for the homes on this
          account (or could not reach us to find out), so the shell behind has
          no real home to draw. Rendered ON TOP of the Stack rather than instead
          of it — the two ways out are ordinary routes (`/device-sync`,
          `/house-backup`) and a route cannot render without the navigator that
          hosts it. The screen steps aside while the member is on one of them. */}
      {houseRecovery ? <HouseRecoverHomeScreen state={houseRecovery} /> : null}
      {/* One-time "Enable Face ID?" prompt, shown once per user after sign-in.
          A no-op (renders null) once biometrics are enabled or the prompt has
          already been shown. */}
      <BiometricEnrollmentGate />
    </>
  );
}

function RootLayout() {
  useE2ELoginDeepLinks();

  // Product analytics (PostHog). Idempotent + a no-op when unconfigured, so it's
  // safe to fire once at the root before anything else mounts.
  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      SplashScreen.hideAsync();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <I18nProvider>
              <ProfileProvider>
                <SubscriptionProvider>
                  <DataProvider>
                    <TapOutsideProvider>
                      <TapOutsideWrapper>
                        <AppContent />
                        {/* Ambient AI-connection health watcher (behind auth).
                            Renders nothing; keeps the active BYOK provider's
                            status fresh on foreground and toasts + notifies the
                            moment it disconnects. */}
                        <AIConnectionWatcher />
                        {/* Hybrid-key session-lease keeper. Renders nothing;
                            on foreground it refreshes the short-lived server
                            lease from the device-held Keychain key so background
                            AI keeps working (the durable key never leaves the
                            device). */}
                        <AiLeaseKeeper />
                        {/* Global toast host — mounted once at the root so
                            showToast() from anywhere (task completion, errors,
                            etc.) actually renders. It self-positions at the top
                            with a high zIndex and is invisible when idle. */}
                        <ToastContainer />
                        {/* Connectivity subscription — unconditional on auth (the
                            login screen needs it too). Renders nothing while
                            online, and nothing AT ALL on a local-first build,
                            where the device ledger is the source of truth and an
                            outage must not block anything; it stays mounted there
                            purely to keep React Query's onlineManager fed. On a
                            remote-only brand a sustained outage still blocks all
                            touches behind a top banner + manual Retry. See
                            NetworkBlockOverlay for the debounce/reachability
                            details. */}
                        <NetworkBlockOverlay />
                        {/* Dev-only: makes the last e2e-verify-network deep-link
                            result assertable by Maestro instead of console-only
                            (see src/components/common/E2EVerifyBadge.tsx). */}
                        <E2EVerifyBadge />
                      </TapOutsideWrapper>
                    </TapOutsideProvider>
                  </DataProvider>
                </SubscriptionProvider>
              </ProfileProvider>
            </I18nProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default wrapRoot(RootLayout);
