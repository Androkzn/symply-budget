/**
 * Language API client — talks to the existing (donor) Language backend, which is
 * already live on staging + production:
 *   staging    https://simple-language-api-staging.a-tekhtelev.workers.dev
 *   production https://simple-language-api.a-tekhtelev.workers.dev
 *
 * The backend speaks the donor `/api/v1/*` contract with donor auth — NOT the
 * platform's shared contract — so Language routes through THIS fetch client
 * instead of the shared axios `apiClient` (whose 401 refresh interceptor is
 * platform-only). Tokens live in the shared `authStore`, so the shared Login UI,
 * biometric unlock, and logout all keep working unchanged.
 */
import {
  AIAccessError,
  extractApiErrorCode,
  isAIAccessAxiosDenial,
} from '@/errors/AIAccessError';
import { summarizeLanguageResponseBody } from '@api/e2eResponseSummary';
import { recordE2ENetworkEntry } from '@api/e2eTestObservability';
import { ENV } from '@config/env';
import { notifyAIAccessDenied } from '@services/aiAccessDeniedHandler';
import { useAuthStore } from '@stores/authStore';

/** Donor routes are mounted under this prefix (see donor backend index.ts). */
export const LANGUAGE_API_PREFIX = '/api/v1';

export class LanguageApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'LanguageApiError';
    this.status = status;
    this.body = body;
  }
}

export interface LanguageRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Attach the bearer access token (default true). */
  auth?: boolean;
  /** On a 401, refresh the token once and retry (default true). */
  retryOnAuth?: boolean;
  signal?: AbortSignal;
}

/**
 * A message safe to put in front of a member, chosen by STATUS — never the
 * server's own error string. Screens mostly substitute their own copy, but a
 * `LanguageApiError` that escapes to a generic handler must not surface
 * "Gemini API key not configured" or a stack-shaped string. Same rule as
 * `resolveSoftTransferErrorMessage` and `scanFailureMessage`.
 */
function languageErrorMessage(parsed: unknown, status: number): string {
  if (status === 401 || status === 403) {
    return 'You do not have access to that right now.';
  }
  if (status === 404) return 'That is not available.';
  if (status === 413) return 'That recording or file is too large.';
  if (status === 429) return 'Too many requests in a row. Try again in a few minutes.';
  if (status >= 500) return 'The service could not be reached just now. Please try again.';
  // 4xx validation: keep the request identifiable in logs without echoing bodies.
  void parsed;
  return `Language request failed (${status})`;
}

function safeJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Refresh via the donor contract (`{ refreshToken }` → `{ accessToken, refreshToken }`). */
async function refreshTokens(): Promise<boolean> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return false;
  try {
    const refreshUrl = `${ENV.API_BASE_URL}${LANGUAGE_API_PREFIX}/auth/refresh`;
    const res = await fetch(refreshUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    recordE2ENetworkEntry({
      method: 'POST',
      url: `${LANGUAGE_API_PREFIX}/auth/refresh`,
      status: res.status,
      ok: res.ok,
    });
    if (!res.ok) return false;
    const data = safeJson(await res.text()) as
      | { accessToken?: string; refreshToken?: string }
      | undefined;
    if (!data?.accessToken || !data.refreshToken) return false;
    useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

/**
 * Perform a request against the Language backend. `path` is relative to
 * `/api/v1` (e.g. `/assessment/start`). Returns the parsed JSON body typed as T.
 */
export async function languageRequest<T>(
  path: string,
  opts: LanguageRequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, auth = true, retryOnAuth = true, signal } = opts;

  const doFetch = (): Promise<Response> => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (auth) {
      const token = useAuthStore.getState().token;
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return fetch(`${ENV.API_BASE_URL}${LANGUAGE_API_PREFIX}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  };

  let res = await doFetch();
  let parsed = safeJson(await res.text());
  recordE2ENetworkEntry({
    method,
    url: `${LANGUAGE_API_PREFIX}${path}`,
    status: res.status,
    ok: res.ok,
    detail: summarizeLanguageResponseBody(parsed, !res.ok),
  });
  if (res.status === 401 && auth && retryOnAuth) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      res = await doFetch();
      parsed = safeJson(await res.text());
      recordE2ENetworkEntry({
        method,
        url: `${LANGUAGE_API_PREFIX}${path}`,
        status: res.status,
        ok: res.ok,
        detail: summarizeLanguageResponseBody(parsed, !res.ok),
      });
    }
  }
  if (!res.ok) {
    // AI entitlement denials get the SAME typed error the shared axios client
    // raises, so Language's AI surfaces route to `/ai-access` through the one
    // `useAIAccessErrorNavigation` listener instead of showing a dead end.
    // Language speaks the donor contract, but its AI routes deliberately answer
    // with the platform's `{ error: { code, message } }` denial shape.
    const denialCode = extractApiErrorCode(
      parsed as { error?: { code?: string }; code?: string } | undefined
    );
    if (isAIAccessAxiosDenial(res.status, denialCode)) {
      const aiAccessError = new AIAccessError(
        denialCode,
        'AI access denied',
        res.status
      );
      notifyAIAccessDenied(aiAccessError);
      throw aiAccessError;
    }

    const message = languageErrorMessage(parsed, res.status);
    throw new LanguageApiError(res.status, message, parsed);
  }
  return parsed as T;
}
