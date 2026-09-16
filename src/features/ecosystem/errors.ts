import { isAxiosError } from 'axios';

export const SOFT_TRANSFER_DISABLED_MESSAGE =
  'Soft Transfer is not enabled yet. Your account is ready, but the platform has not turned on data sharing for this environment.';

/**
 * User-facing copy. We deliberately DO NOT forward the backend's raw
 * `error.message` (e.g. "Invalid or expired token", "unauthorized") to the UI —
 * those are developer/system strings. Everything the user sees is curated here
 * and keyed off the HTTP status category instead.
 */
const SESSION_EXPIRED_MESSAGE =
  'Your session has expired. Please sign out and sign in again to continue.';
const OFFLINE_MESSAGE = "We couldn't reach the server. Check your connection and try again.";
const FORBIDDEN_MESSAGE = "You don't have access to this right now.";
const SERVER_MESSAGE = 'The server ran into a problem. Please try again in a moment.';
const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

export function isSoftTransferDisabledError(error: unknown): boolean {
  if (!isAxiosError(error)) return false;
  if (error.response?.status !== 403) return false;
  const body = error.response.data as { error?: { message?: string }; message?: string } | undefined;
  const message = (body?.error?.message ?? body?.message ?? '').toLowerCase();
  return message.includes('soft transfer') && message.includes('disabled');
}

/** A lapsed/invalid auth session (any 401). Callers can prompt re-login. */
export function isSessionExpiredError(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 401;
}

export function resolveSoftTransferErrorMessage(error: unknown): string {
  // Known, intentionally user-facing case first.
  if (isSoftTransferDisabledError(error)) {
    return SOFT_TRANSFER_DISABLED_MESSAGE;
  }

  if (isAxiosError(error)) {
    const status = error.response?.status;
    // No response at all → network/timeout.
    if (status === undefined) return OFFLINE_MESSAGE;
    if (status === 401) return SESSION_EXPIRED_MESSAGE;
    if (status === 403) return FORBIDDEN_MESSAGE;
    if (status >= 500) return SERVER_MESSAGE;
    // Any other 4xx: never leak the raw backend string.
    return GENERIC_MESSAGE;
  }

  // Non-HTTP failures (thrown JS errors, unknowns) — stay generic; the raw
  // `error.message` is a system string, not something the user should read.
  return GENERIC_MESSAGE;
}
