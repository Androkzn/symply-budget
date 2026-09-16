import { AxiosError } from 'axios';

import type { ApiError } from '@/types';

/** Backend codes whose messages are written for users (when not technical). */
const USER_FACING_CODES = new Set([
  'conflict',
  'forbidden',
  'not_found',
  'bad_request',
  'validation_error',
  'unauthorized',
  'rate_limited',
]);

function isTechnicalMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('failed query') ||
    lower.includes('insert into') ||
    lower.includes('update ') ||
    lower.includes('delete from') ||
    lower.includes('select ') ||
    lower.includes('params:') ||
    lower.includes('sqlite_') ||
    lower.includes('unique constraint') ||
    lower.includes('d1_error') ||
    lower.includes('stack') ||
    message.includes('(?,') ||
    message.length > 120
  );
}

function isUserFacingApiMessage(code: string | undefined, message: string | undefined): boolean {
  if (!message || !code) return false;
  if (!USER_FACING_CODES.has(code)) return false;
  if (isTechnicalMessage(message)) return false;
  return true;
}

/**
 * Returns a short, user-safe message for alerts and toasts.
 * Technical / SQL / internal errors are never shown — use `fallback` instead.
 * In dev, the raw error is logged to the console for debugging.
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (__DEV__) {
    console.warn('[getApiErrorMessage]', error);
  }

  if (error instanceof AxiosError) {
    const body = error.response?.data as { error?: ApiError } | undefined;
    const apiError = body?.error;

    if (isUserFacingApiMessage(apiError?.code, apiError?.message)) {
      return apiError!.message;
    }
  }

  if (error instanceof Error && error.message && !isTechnicalMessage(error.message)) {
    // Axios network errors like "Network Error" are OK to surface.
    if (error.message === 'Network Error') {
      return 'Unable to connect. Check your internet and try again.';
    }
  }

  return fallback;
}

/** Copy for a 401 that reached the UI — the session is gone, not the action. */
export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again.';

/**
 * True when a request failed because the session is dead.
 *
 * A 401 only reaches a screen after the response interceptor has already tried
 * to refresh the token once and failed, so it is terminal — the app is signing
 * out. Offering "please try again" for it is a lie: every retry re-sends the
 * same dead token. Screens should show {@link SESSION_EXPIRED_MESSAGE} instead.
 */
export function isSessionExpiredError(error: unknown): boolean {
  return error instanceof AxiosError && error.response?.status === 401;
}
