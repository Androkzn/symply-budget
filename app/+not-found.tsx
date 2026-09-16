import { Redirect, router, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAuthStore } from '@stores/authStore';

/**
 * Catch-all for unmatched routes / deep links. Expo-router otherwise renders its
 * raw "Unmatched Route — Page could not be found" screen for any path without a
 * route — e.g. the dev-only `<scheme>://e2e-login` autologin handoff (whose
 * credentials are stashed by the Linking listener in `_layout.tsx`), or a stale
 * external link. Redirect to the app root instead: signed-out users land on the
 * login stack (which consumes any pending e2e-login credentials and auto-submits);
 * signed-in users land on Home.
 *
 * EXCEPTION — dev-only `e2e-*` observability deep links (`e2e-block-network`,
 * `e2e-prime-chat-mention`, `e2e-wish-draft`, …) are fired *while a signed-in user
 * is already on a screen under test*. The Linking listener in `_layout.tsx`
 * (`tryHandleE2ETestDeepLink`) fully handles them, but expo-router's independent
 * linking subscription still routes the unmatched URL here. Redirecting to Home in
 * that case navigates the app away from the screen under test (e.g. bounces out of
 * the chat room mid offline-send check). For those, return to the prior screen
 * instead of bouncing to Home. Gated on `__DEV__` so production behaviour is
 * unchanged.
 */
export default function NotFoundRedirect() {
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isE2EObservabilityLink = __DEV__ && isAuthenticated && /^\/e2e-/.test(pathname ?? '');
  // Set when an e2e-* link lands here with nothing to go back TO. Returning
  // null in that case leaves the app permanently blank — root view plus
  // nothing — which reads as a hung or crashed app.
  const [noHistory, setNoHistory] = useState(false);

  useEffect(() => {
    if (!isE2EObservabilityLink) return;
    if (router.canGoBack()) {
      router.back();
      return;
    }
    // No history: this happens whenever the dev client reloads while the
    // INITIAL url is an e2e-* link (every Maestro flow that opens one, then
    // reconnects Metro). Fall through to the normal redirect instead of
    // rendering nothing forever.
    setNoHistory(true);
  }, [isE2EObservabilityLink]);

  if (isE2EObservabilityLink && !noHistory) {
    // Handled by the Linking listener; do not bounce away from the screen under test.
    return null;
  }
  return <Redirect href="/" />;
}
