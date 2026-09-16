import axios from 'axios';
import { Alert } from 'react-native';

import { useAuthStore } from '@stores/authStore';

/**
 * Shared error handling for the onboarding "Get Started" (accept-terms) tap,
 * used by both House `WelcomeScreen` and the child `ChildWelcomeScreen`.
 *
 * A 401 usually means the persisted session is dead — the access token expired
 * and the refresh token could not renew it. The API client's response
 * interceptor has already called `logout()` for that case, which flips
 * `isAuthenticated` to false and re-mounts the login flow (see
 * `RootNavigator`). So there is nothing for the user to "retry": surfacing a
 * raw `Request failed with status code 401` alert on the welcome screen would
 * just be confusing noise on top of an automatic bounce to login.
 *
 * But a 401 can also reach here with the session still very much alive: the
 * interceptor's silent refresh-and-retry can succeed (new access token minted)
 * while the *retried* request still 401s for an unrelated reason — e.g. Budget
 * proxying this call to the House Worker and that hop rejecting it — and that
 * path never calls `logout()`. If we swallowed every 401 unconditionally, that
 * case would leave the user stuck on this screen with zero feedback: no alert,
 * no navigation, no bounce to login. So only swallow when the session is
 * actually dead (`isAuthenticated` false); otherwise treat it like any other
 * genuine, retryable failure.
 *
 * Any other failure (network drop, 5xx) is always a genuine, retryable problem
 * the user should see, so it still raises the generic error alert.
 */
export function handleAcceptTermsError(error: unknown): void {
  console.error('Terms acceptance error:', error);

  if (axios.isAxiosError(error) && error.response?.status === 401) {
    if (!useAuthStore.getState().isAuthenticated) {
      // Session expired — the interceptor logged us out and the app is
      // already routing back to the login screen. No alert needed.
      return;
    }
    // Still authenticated — this 401 wasn't a dead session, so there's no
    // automatic bounce to rescue the user. Fall through to the generic alert.
  }

  // Never surface the raw axios/error message (e.g. "Request failed with
  // status code 401") — it's internal plumbing, not something the user can
  // act on. Show one generic, retryable message instead.
  Alert.alert(
    'Something went wrong',
    "We couldn't save that. Please check your connection and try again."
  );
}
