// Stream G (plan §8/G3) — Google Calendar integration.
//
// Real implementation replacing Stream B's interface stub. Provides:
//   - `createGoogleCalendarClient` factory returning a `GoogleCalendarClient`
//     with a `listBusy` method that fetches the caller's freebusy window and
//     transparently refreshes the stored OAuth token when it has expired.
//   - `buildGoogleAuthUrl` + `exchangeCodeForTokens` helpers consumed by
//     Stream E's `/oauth/google/*` handlers.
//   - `GoogleCalendarTokenRefreshError` so callers can distinguish
//     "user needs to re-link" from transient network failures.
//
// Transport: workerd-native `fetch`. Tokens live in `google_calendar_tokens`
// (schema-aihousekeeper.ts) and are refreshed in-place.

import { eq } from 'drizzle-orm';

import { googleCalendarTokens } from '../../db/schema-aihousekeeper';
import type { Database } from '../../types';

// ============================================================================
// Public types (keep interface shape identical for future Stream C consumers)
// ============================================================================

export interface GoogleCalendarClientConfig {
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
}

export interface BusyRange {
  start: string; // ISO-8601 UTC
  end: string; // ISO-8601 UTC
}

export interface ListBusyWindow {
  start: Date;
  end: Date;
}

export interface GoogleCalendarClient {
  /**
   * Returns the busy ranges on the member's primary calendar within the
   * supplied window. Refreshes the stored OAuth token in-place if expired.
   *
   * Throws `GoogleCalendarTokenRefreshError` when the refresh_token itself
   * is no longer valid; the caller should surface a re-link prompt.
   */
  listBusy(memberId: string, window: ListBusyWindow): Promise<BusyRange[]>;
}

/**
 * Raised when a stored refresh_token can no longer be exchanged for a new
 * access_token. Tool callers handle this by telling the user to re-link
 * their Google Calendar.
 */
export class GoogleCalendarTokenRefreshError extends Error {
  public readonly memberId: string;
  public readonly status: number | null;
  public readonly providerBody: string | null;

  constructor(params: { memberId: string; status: number | null; providerBody: string | null; message?: string }) {
    super(
      params.message ??
        `Google Calendar token refresh failed for member ${params.memberId}` +
          (params.status !== null ? ` (HTTP ${params.status})` : '')
    );
    this.name = 'GoogleCalendarTokenRefreshError';
    this.memberId = params.memberId;
    this.status = params.status;
    this.providerBody = params.providerBody;
  }
}

// ============================================================================
// Internal — Google API response shapes (minimal projections)
// ============================================================================

interface TokenRefreshResponse {
  access_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
  // refresh_token is typically NOT re-issued on refresh; keep optional.
  refresh_token?: string;
}

interface TokenExchangeResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type?: string;
}

interface FreeBusyResponse {
  calendars?: {
    [calendarId: string]: {
      busy?: Array<{ start: string; end: string }>;
      errors?: Array<{ domain: string; reason: string }>;
    };
  };
}

// ============================================================================
// Factory
// ============================================================================

interface GoogleCalendarClientDeps {
  db: Database;
  /**
   * Optional clock hook — makes the expiry check unit-testable. Defaults to
   * `Date.now()`.
   */
  now?: () => number;
}

export function createGoogleCalendarClient(
  config: GoogleCalendarClientConfig,
  deps: GoogleCalendarClientDeps
): GoogleCalendarClient {
  const { db } = deps;
  const now = deps.now ?? (() => Date.now());

  async function ensureFreshToken(memberId: string): Promise<string> {
    const row = await db
      .select()
      .from(googleCalendarTokens)
      .where(eq(googleCalendarTokens.member_id, memberId))
      .get();
    if (!row) {
      throw new GoogleCalendarTokenRefreshError({
        memberId,
        status: null,
        providerBody: null,
        message: `No Google Calendar token on file for member ${memberId}`,
      });
    }

    // `expires_at` is stored as unix seconds. Refresh if within 30s of expiry.
    const expiresAtMs = row.expires_at * 1000;
    const skewMs = 30_000;
    if (expiresAtMs - skewMs > now()) {
      return row.access_token;
    }

    // Perform refresh.
    const tokenBody = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: config.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: row.refresh_token,
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new GoogleCalendarTokenRefreshError({
        memberId,
        status: res.status,
        providerBody: text,
      });
    }

    const json = (await res.json()) as TokenRefreshResponse;
    if (!json.access_token || typeof json.expires_in !== 'number') {
      throw new GoogleCalendarTokenRefreshError({
        memberId,
        status: res.status,
        providerBody: JSON.stringify(json),
        message: 'Google token refresh response missing access_token/expires_in',
      });
    }

    const newExpiresAt = Math.floor(now() / 1000) + json.expires_in;
    await db
      .update(googleCalendarTokens)
      .set({
        access_token: json.access_token,
        expires_at: newExpiresAt,
        // Google rarely rotates refresh_tokens, but respect it if present.
        ...(json.refresh_token ? { refresh_token: json.refresh_token } : {}),
        ...(json.scope ? { scope: json.scope } : {}),
      })
      .where(eq(googleCalendarTokens.member_id, memberId))
      .run();

    return json.access_token;
  }

  return {
    async listBusy(memberId: string, window: ListBusyWindow): Promise<BusyRange[]> {
      const accessToken = await ensureFreshToken(memberId);

      const body = {
        timeMin: window.start.toISOString(),
        timeMax: window.end.toISOString(),
        items: [{ id: 'primary' }],
      };

      const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Google freeBusy failed: ${res.status} ${text}`);
      }

      const json = (await res.json()) as FreeBusyResponse;
      const primary = json.calendars?.primary;
      if (primary?.errors && primary.errors.length > 0) {
        // Surface provider-side errors as a distinguishable error string —
        // callers may retry or prompt re-link.
        const reasons = primary.errors.map((e) => `${e.domain}:${e.reason}`).join(',');
        throw new Error(`Google freeBusy primary-calendar errors: ${reasons}`);
      }
      const busy = primary?.busy ?? [];
      return busy.map((b) => ({ start: b.start, end: b.end }));
    },
  };
}

// ============================================================================
// OAuth helpers (Stream E's /oauth/google/* handlers)
// ============================================================================

/**
 * The redirect URI must point at the Worker origin (where /oauth/google/callback
 * is mounted). Prefer API_URL, fall back to APP_URL for legacy envs.
 */
function resolveRedirectUri(env: { APP_URL: string; API_URL?: string }): string {
  const base = env.API_URL || env.APP_URL;
  return `${base}/oauth/google/callback`;
}

/**
 * Build the Google OAuth consent-screen URL. Requests offline access +
 * consent prompt so Google always returns a refresh_token (required for
 * server-side `listBusy` refresh).
 */
export function buildGoogleAuthUrl(
  env: { GOOGLE_OAUTH_CLIENT_ID: string; APP_URL: string; API_URL?: string },
  state: string
): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: resolveRedirectUri(env),
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeCodeForTokens(
  env: { GOOGLE_OAUTH_CLIENT_ID: string; GOOGLE_OAUTH_CLIENT_SECRET: string; APP_URL: string; API_URL?: string },
  code: string
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: resolveRedirectUri(env),
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as TokenExchangeResponse;
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new Error('Google token exchange response missing required fields');
  }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_in: json.expires_in,
    scope: json.scope,
  };
}
