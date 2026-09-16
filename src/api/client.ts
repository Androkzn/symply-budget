import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';

import { AIAccessError, extractApiErrorCode, isAIAccessAxiosDenial } from '@/errors/AIAccessError';
import type { ApiError, ApiResponse } from '@/types';
import { isJoinedPlatformBrand } from '@brand';
import { ENV } from '@config/env';
import { notifyAIAccessDenied } from '@services/aiAccessDeniedHandler';
import { isE2ENetworkBlocked } from '@services/e2e-network-block';
import { captureException } from '@services/monitoring';
import { TOKEN_REFRESH_BUFFER_MS, useAuthStore } from '@stores/authStore';

import { summarizeHttpResponseBody } from './e2eResponseSummary';
import { recordE2ENetworkEntry } from './e2eTestObservability';

// Create axios instance with CloudFront-ready configuration.
// baseURL/timeout are resolved lazily in the request interceptor because `ENV`
// can be `undefined` at module-init under a circular import
// (env.ts -> brand -> ... -> api/client -> env). Reading it at axios.create time
// crashes the app on launch ("Cannot read property 'API_BASE_URL' of undefined").
const apiClient: AxiosInstance = axios.create({
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

/**
 * True when the access token is expired, or close enough that it will be by the
 * time the request lands. Mirrors the launch-time proactive refresh in
 * authStore's SecureStore hydrate, applied per-request for the rest of the
 * session. Unknown expiry (null) is never treated as spent — a pre-upgrade
 * session must not trigger a refresh storm.
 */
function isAccessTokenSpent(expiresAt: number | null): boolean {
  return expiresAt != null && expiresAt - Date.now() < TOKEN_REFRESH_BUFFER_MS;
}

// Request interceptor - Add auth token
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    if (isE2ENetworkBlocked()) {
      return Promise.reject(new Error('Network unavailable'));
    }

    if (!config.baseURL) config.baseURL = ENV.API_BASE_URL;
    if (config.timeout == null || config.timeout === 0) {
      config.timeout = ENV.TIMEOUTS.API_REQUEST;
    }

    let token = useAuthStore.getState().token;

    // Refresh a token we already know is spent instead of firing it and eating
    // a guaranteed 401. `tokenExpiresAt` is maintained on login, on refresh and
    // on SecureStore hydrate, so the client can tell the difference between "my
    // token aged out" (recoverable, silently) and "the server rejected me"
    // (not). Only the reactive 401 path existed before, which meant a single
    // wedged refresh left every later request firing an expired token forever.
    // Null expiry = unknown (pre-upgrade session): leave it to the 401 path.
    if (token && isAccessTokenSpent(useAuthStore.getState().tokenExpiresAt)) {
      // Swallow: a failed refresh has already signed the user out, and letting
      // the doomed request go on to a real 401 keeps one error shape for the UI.
      token = (await refreshAccessToken().catch(() => null)) ?? useAuthStore.getState().token;
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Never cache authenticated API reads — stale owner-pending / notifications
    // caused Movement Feed to stay empty after new join requests.
    config.headers['Cache-Control'] = 'no-cache';
    config.headers.Pragma = 'no-cache';

    // Health V2: declare local-first authority on `/health/*` once the ledger
    // session is open, so the Worker's Wave A reject-list actually arms
    // (plan §2 item 3 / §1.3).
    //
    // It has to live HERE rather than at the `healthApi` call sites, because the
    // calls that most need gating are the ones that never go through `healthApi`
    // at all: `healthRepository.ts`'s `writeThrough` / `readThrough` and the
    // legacy outbox `syncPush` reach `apiClient` directly. Hand-spread headers
    // on `/v2` — the only arming that existed before — cannot gate `/health`,
    // since HTTP gates are per-request.
    //
    // Narrow require, never the barrel: `@features/health/local` pulls the sync
    // orchestrator, status store and control-plane client into the module graph,
    // and this runs on EVERY request from EVERY brand. `sync/headers` has no
    // imports of its own. Wrapped because a brand bundle without the Health
    // feature must not fail a request on a missing module.
    if (config.url?.startsWith('/health')) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const headers = require('@features/health/local/sync/headers') as {
          isHealthLocalFirstHeaderArmed: () => boolean;
          HEALTH_LOCAL_FIRST_HEADER: string;
        };
        if (headers.isHealthLocalFirstHeaderArmed()) {
          config.headers[headers.HEALTH_LOCAL_FIRST_HEADER] = '1';
        }
      } catch {
        // No Health feature in this bundle — nothing to arm.
      }
    }

    // Log API requests for debugging
    if (config.url?.includes('process-enhanced') || config.url?.includes('confirm-upload')) {
      console.log(`[API] Making request: ${config.method?.toUpperCase()} ${config.url}`);
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - Handle token refresh
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Sign out after a refresh that can never succeed (no refresh token to retry
 * with, or the server rejected the one we have).
 *
 * Deliberately NOT awaited. `logout()` applies the auth-state flip
 * synchronously — before its first `await` — so the store is already cleared
 * and the navigation gate already knows the session is gone by the time this
 * returns; awaiting it buys no extra guarantee against zombie auth. What
 * follows the flip is best-effort teardown: ~14 dynamic store imports plus
 * AsyncStorage removals. Awaiting THAT from inside the refresh promise put the
 * session's entire ability to refresh behind it — if any one of those imports
 * hung, `refreshInFlight` never reached its `finally`, every later 401 awaited
 * that dead promise, and the app kept firing an expired token forever without
 * ever refreshing or reaching the login screen.
 */
function endSessionAfterFailedRefresh(): void {
  void useAuthStore
    .getState()
    .logout()
    .catch((error) => {
      captureException(error, { source: 'token_refresh', phase: 'logout' });
    });
}

// Exported so authStore.hydrateProductTokensFromSecureStore can proactively
// refresh a near-expired token on launch (dynamic import there — see its own
// comment — sidesteps the client.ts <-> authStore.ts circular top-level import).
export async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) {
    // No refresh token to retry with — without this, the request interceptor
    // keeps attaching the same dead access token forever (every poll silently
    // 401s, refresh is never attempted again, no UI ever surfaces a login
    // screen). Logging out here is what actually breaks the loop.
    //
    // This runs OUTSIDE the memoized promise below, and must stay there. It
    // used to be the first statement inside it — before the `try`, and so
    // before the `finally` that releases `refreshInFlight` — which meant one
    // trip through this branch pinned the slot to a resolved-null promise for
    // the life of the process. That is reachable from an ordinary sign-out: any
    // poll already in flight 401s just after logout() clears the tokens, hits
    // this branch, and strands the slot. The member then signs back in
    // successfully, their new access token ages out 15 minutes later, and every
    // 401 after that short-circuits on the stale promise — no refresh is ever
    // attempted again, no sign-out ever fires, reads fail invisibly behind
    // cached screens, and writes surface as "please try again" against a
    // session that can never come back. Seen in production 2026-08-22: hours of
    // 401s on `simple-budget-api` with `"exp" claim timestamp check failed` and
    // not one `/auth/refresh` call in the whole window.
    endSessionAfterFailedRefresh();
    return null;
  }

  refreshInFlight = (async () => {
    const refreshPath =
      !isJoinedPlatformBrand() ? '/api/v1/auth/refresh' : '/auth/refresh';

    try {
      const response = await axios.post<{
        access_token: string;
        refresh_token: string;
        expires_in: number;
      }>(
        `${ENV.API_BASE_URL}${refreshPath}`,
        { refresh_token: refreshToken },
        // This bypasses apiClient, so it doesn't inherit the request
        // interceptor's default timeout — without one, a hung refresh call
        // never settles, refreshInFlight is never cleared, and every 401 for
        // the rest of the session awaits that same dead promise forever.
        { timeout: ENV.TIMEOUTS.API_REQUEST }
      );

      const { access_token, refresh_token: newRefreshToken, expires_in } = response.data;
      if (!access_token) {
        // Backend returned 200 but no token — treat as invalid refresh
        endSessionAfterFailedRefresh();
        return null;
      }
      const expiresAt =
        typeof expires_in === 'number' ? Date.now() + expires_in * 1000 : undefined;
      useAuthStore.getState().setTokens(access_token, newRefreshToken, expiresAt);
      if (__DEV__) {
        recordE2ENetworkEntry({
          method: 'POST',
          url: refreshPath,
          status: response.status,
          ok: true,
        });
      }
      return access_token;
    } catch (refreshError) {
      if (__DEV__) {
        recordE2ENetworkEntry({
          method: 'POST',
          url: refreshPath,
          status: axios.isAxiosError(refreshError) ? refreshError.response?.status ?? null : null,
          ok: false,
        });
      }
      captureException(refreshError, { source: 'token_refresh' });
      endSessionAfterFailedRefresh();
      throw refreshError;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function shouldCaptureApiError(error: AxiosError<ApiError>): boolean {
  const status = error.response?.status;
  // Expected client/auth/validation outcomes — not crash-report material.
  if (status !== undefined && status >= 400 && status < 500) {
    return false;
  }
  // Network failures and 5xx.
  return true;
}

apiClient.interceptors.response.use(
  (response) => {
    if (__DEV__) {
      // `response.config` is optional here for the same reason `error.config` is
      // optional in the rejection handler below: an interceptor chain can hand
      // on a response object that never carried a config — a hot-reloaded
      // client, a cached or synthesised response — and this arm runs on EVERY
      // successful call. Dereferencing it bare took out the whole notifications
      // surface (unread-count, history and preferences all failed with
      // `Cannot read property 'url' of undefined`) while the requests
      // themselves had returned 200.
      recordE2ENetworkEntry({
        method: response.config?.method,
        url: response.config?.url,
        status: response.status,
        ok: true,
        detail: summarizeHttpResponseBody(response.data),
      });
      const url = response.config?.url ?? '';
      if (url.includes('owner-pending') || url.includes('/notifications/history')) {
        console.log('[MovementFeed] API response', url, response.status, response.data);
      }
    }
    // Log successful responses for process-enhanced. NOT inside the `__DEV__`
    // guard above, so an absent `config` here threw in release builds too.
    if (response.config?.url?.includes('process-enhanced')) {
      console.log(`[API] Response: ${response.status} ${response.config?.url}`, response.data);
    }
    return response;
  },
  async (error: AxiosError<ApiError>) => {
    if (__DEV__) {
      recordE2ENetworkEntry({
        method: error.config?.method,
        url: error.config?.url,
        status: error.response?.status ?? null,
        ok: false,
        detail: summarizeHttpResponseBody(error.response?.data, { isError: true }),
      });
    }
    // Log errors for process-enhanced
    if (error.config?.url?.includes('process-enhanced')) {
      console.error(`[API] Error: ${error.response?.status || 'Network'} ${error.config.url}`, {
        message: error.message,
        response: error.response?.data,
      });
    }
    // `| undefined` is NOT decoration. Axios omits `config` when the failure
    // happened before a request was built — a rejection thrown by the request
    // interceptor above is the common case — and the old cast asserted it away,
    // so every consumer below read it as always-present.
    //
    // The 401 arm never noticed, because `error.response?.status === 401` is
    // evaluated first and short-circuits for a config-less error. The 403 arm
    // did not have that luck: it reads `originalRequest.url` BEFORE testing the
    // status, so any config-less error threw `Cannot read property 'url' of
    // undefined` from inside the interceptor and replaced the real error with a
    // TypeError. That is what broke the notifications surface — unread-count,
    // history and preferences all reported a TypeError instead of the failure
    // they actually hit.
    const originalRequest = error.config as
      | (AxiosRequestConfig & { _retry?: boolean })
      | undefined;

    // Handle 401 - Try to refresh token (single in-flight refresh for concurrent 401s)
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const accessToken = await refreshAccessToken();
        if (accessToken) {
          // Request interceptor reads the new token from the store, so we
          // don't need to patch headers manually — just retry.
          return apiClient(originalRequest);
        }
      } catch (refreshError) {
        return Promise.reject(refreshError);
      }
    }

    // Handle 403 on a Tier-B endpoint scoped to a LOCAL household id.
    //
    // House V2 rebinds `currentHousehold` to the on-device ledger id
    // (`hh_local_…`) as soon as the encrypted session opens, but the endpoints
    // that are still server-authoritative — home projects, quotes, the
    // home-budget glance, the AI housekeeper — authorise against the legacy
    // `household_members` rows that only exist once the control plane has
    // mirrored them. Session open starts that registration fire-and-forget so
    // cold start stays offline-first, which leaves a ~2s window where those
    // screens 403. Measured on device 2026-08-13: 10 such 403s at launch, and
    // every one of them 200s afterwards.
    //
    // Budget reaches the same 403 by a different road, and a permanent one.
    // It does NOT register a solo household at all any more — doing that on
    // every session open is what left an orphan household on the server for
    // every reinstall and wipe (see `budgetHouseholdIsOnControlPlane`) — so a
    // household that has never been shared has no legacy mirror at all, and its
    // owner meets this 403 the first time they open chat or the assistant room.
    // Registering from here is the whole design: the row is created by the act
    // that needs it, not by the household existing.
    //
    // Waiting for registration and retrying once closes both cases without
    // putting a network round trip back on the cold-start path. Scoped
    // deliberately: only `hh_local_` ids (a real permission denial on a server
    // household id must stay a denial) and only one retry. House is tried
    // first and answers `false` immediately on a Budget build (and vice versa),
    // so each brand pays one no-op import for the other's seam.
    const localHouseholdId = /\/households\/(hh_local_[A-Za-z0-9_-]+)/.exec(
      originalRequest?.url ?? ''
    )?.[1];
    if (
      error.response?.status === 403 &&
      originalRequest &&
      !originalRequest._retry &&
      localHouseholdId
    ) {
      originalRequest._retry = true;
      try {
        const { awaitHouseControlPlaneRegistration } = await import(
          '@features/house/local/controlPlaneClient'
        );
        // NAMED. A device holds several homes, and the one that 403'd is not
        // always the one on screen — left to default, the retry registered the
        // active home and re-asked the same failing question.
        if (await awaitHouseControlPlaneRegistration(localHouseholdId)) {
          return apiClient(originalRequest);
        }
      } catch {
        // Fall through — a failed registration must not turn a 403 into an
        // unhandled error.
      }
      try {
        const { awaitBudgetControlPlaneRegistration } = await import(
          '@features/budget/local/controlPlaneClient'
        );
        if (await awaitBudgetControlPlaneRegistration(localHouseholdId)) {
          return apiClient(originalRequest);
        }
      } catch {
        // Same — fall through to the normal rejection.
      }
    }

    // AI entitlement denials — throw typed error; UI layer handles navigation.
    const status = error.response?.status;
    const errBody = error.response?.data as
      | { error?: ApiError; code?: string }
      | undefined;
    const code = extractApiErrorCode(errBody);
    if (isAIAccessAxiosDenial(status, code)) {
      const aiAccessError =
        AIAccessError.fromAxiosError(error) ??
        new AIAccessError(code, 'AI access denied', status!);
      notifyAIAccessDenied(aiAccessError);
      return Promise.reject(aiAccessError);
    }

    if (status !== 401 && shouldCaptureApiError(error)) {
      captureException(error, {
        source: 'api_interceptor',
        url: error.config?.url,
        method: error.config?.method,
        status,
        code,
      });
    }

    return Promise.reject(error);
  }
);

// Generic request methods
export const api = {
  get: <T>(url: string, config?: AxiosRequestConfig) =>
    apiClient.get<ApiResponse<T>>(url, config).then((res) => res.data),

  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    apiClient.post<ApiResponse<T>>(url, data, config).then((res) => res.data),

  put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    apiClient.put<ApiResponse<T>>(url, data, config).then((res) => res.data),

  patch: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    apiClient.patch<ApiResponse<T>>(url, data, config).then((res) => res.data),

  delete: <T>(url: string, config?: AxiosRequestConfig) =>
    apiClient.delete<ApiResponse<T>>(url, config).then((res) => res.data),

  // Upload with FormData (for file uploads)
  upload: <T>(url: string, formData: FormData, config?: AxiosRequestConfig) =>
    apiClient
      .post<T>(url, formData, {
        ...config,
        headers: {
          ...config?.headers,
          'Content-Type': 'multipart/form-data',
        },
        timeout: 120000, // 2 minute timeout for uploads
      })
      .then((res) => res.data),
};

export { apiClient };
export {
  clearE2ENetworkLog,
  findE2ENetworkEntry,
  findE2ER2UploadEntry,
  findE2EWsEntry,
  getE2ENetworkLog,
  getE2ER2UploadLog,
  getE2EWsLog,
  recordE2ER2UploadEntry,
  recordE2EWsEvent,
  type E2ENetworkEntry,
} from './e2eTestObservability';
export {
  clearAllE2ETestLogs,
  clearE2EPersistLog,
  clearE2EUiLog,
  dumpE2ETestObservabilityToConsole,
  findE2ENetworkEntryBySpec,
  getE2EPersistLog,
  getE2ETestObservabilitySnapshot,
  installE2EGlobalProbe,
  recordE2EPersistEntry,
  recordE2EUiEvent,
  setE2EActiveMatrixTag,
} from './e2eTestObservability';

/**
 * Helper to safely extract data from API response.
 * Throws an error if data is null/undefined.
 */
export function ensureData<T>(response: { data?: T | null }, errorMessage?: string): T {
  if (response.data === null || response.data === undefined) {
    throw new Error(errorMessage || 'API response data is null or undefined');
  }
  return response.data;
}
