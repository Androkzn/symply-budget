import { AxiosError } from 'axios';

const TAG = '[MovementFeed]';

function formatError(error: unknown): Record<string, unknown> {
  if (error instanceof AxiosError) {
    return {
      message: error.message,
      status: error.response?.status,
      url: error.config?.url,
      method: error.config?.method,
      data: error.response?.data,
    };
  }
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }
  return { raw: String(error) };
}

/** Dev-only logs for join requests, notifications, and Movement Feed refresh. */
export function logMovementFeed(message: string, data?: unknown): void {
  if (!__DEV__) return;
  if (data !== undefined) {
    console.log(TAG, message, data);
  } else {
    console.log(TAG, message);
  }
}

export function logMovementFeedError(message: string, error: unknown): void {
  if (!__DEV__) return;
  console.warn(TAG, message, formatError(error));
}

/** Dev-only: read JWT `sub` without verifying (for auth/store mismatch debugging). */
export function decodeJwtSub(token: string | null | undefined): string | undefined {
  if (!token) return undefined;
  try {
    const part = token.split('.')[1];
    if (!part) return undefined;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(normalized);
    return (JSON.parse(json) as { sub?: string }).sub;
  } catch {
    return undefined;
  }
}
