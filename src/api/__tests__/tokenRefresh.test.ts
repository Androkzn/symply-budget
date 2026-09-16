/**
 * The client half of "session expired and the app never noticed".
 *
 * Observed in production on 2026-08-22 (`simple-budget-api`): after a sign-in,
 * every authenticated request 401'd for hours with
 * `[platform-jwt] product verify failed: "exp" claim timestamp check failed`,
 * and in that whole window the device made ZERO `/auth/refresh` calls. Reads
 * failed invisibly (screens kept rendering cached rows) and the first write the
 * member attempted — Clear All on Notifications — surfaced as
 * "Could not clear notifications. Please try again.", which no retry could fix.
 *
 * Two properties keep that from recurring, and both are asserted here:
 *   1. the in-flight refresh slot is never pinned by sign-out teardown, so one
 *      bad refresh can't cost the process its ability to ever refresh again;
 *   2. a token already known to be expired is refreshed BEFORE the request goes
 *      out, instead of being fired at the Worker for a guaranteed 401.
 */
import axios, { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';

import { apiClient, refreshAccessToken } from '@api/client';
import { useAuthStore } from '@stores/authStore';

jest.mock('@services/monitoring', () => ({
  captureException: jest.fn(),
}));

/** A logout that never settles — the teardown hang this suite exists for. */
const hungLogout = jest.fn(() => new Promise<void>(() => {}));

function signedInWith(options: { expiresAt: number | null; refreshToken?: string | null }): void {
  useAuthStore.setState({
    token: 'expired-access-token',
    refreshToken: options.refreshToken === undefined ? 'refresh-token' : options.refreshToken,
    tokenExpiresAt: options.expiresAt,
    isAuthenticated: true,
  });
}

/** Run the real request interceptor over a bare config, as axios would. */
async function runRequestInterceptor(url: string): Promise<InternalAxiosRequestConfig> {
  const handlers = (
    apiClient.interceptors.request as unknown as {
      handlers: Array<{
        fulfilled: (c: InternalAxiosRequestConfig) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig>;
      } | null>;
    }
  ).handlers;

  let config = { url, headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  for (const handler of handlers) {
    if (!handler?.fulfilled) continue;
    config = await handler.fulfilled(config);
  }
  return config;
}

let postSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  postSpy = jest.spyOn(axios, 'post');
  useAuthStore.setState({
    token: null,
    refreshToken: null,
    tokenExpiresAt: null,
    isAuthenticated: false,
    logout: hungLogout as unknown as () => Promise<void>,
  });
});

afterEach(() => {
  postSpy.mockRestore();
});

describe('refreshAccessToken — the in-flight slot', () => {
  it('is released even when sign-out teardown never settles', async () => {
    // No refresh token → the only thing to do is sign out. `logout()` here
    // never resolves, standing in for a hung dynamic import in its best-effort
    // teardown. Awaiting it inside the refresh promise is what used to strand
    // `refreshInFlight` forever.
    signedInWith({ expiresAt: Date.now() - 1_000, refreshToken: null });

    await expect(refreshAccessToken()).resolves.toBeNull();
    expect(hungLogout).toHaveBeenCalledTimes(1);

    // The slot is free again: with a refresh token back in hand, the next call
    // actually reaches the network instead of awaiting the dead promise.
    useAuthStore.setState({ refreshToken: 'refresh-token' });
    postSpy.mockResolvedValue({
      status: 200,
      data: { access_token: 'fresh', refresh_token: 'fresh-refresh', expires_in: 900 },
    });

    await expect(refreshAccessToken()).resolves.toBe('fresh');
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('survives a poll that 401s during sign-out — the production sequence', async () => {
    // Sign-out clears the tokens; requests already in flight come back 401 a
    // moment later and ask for a refresh with nothing to refresh from. That one
    // call used to pin the in-flight slot for the life of the process, so the
    // NEXT session — a member who signed straight back in — could never refresh
    // once its access token aged out.
    await expect(refreshAccessToken()).resolves.toBeNull();

    useAuthStore.getState().setTokens('new-access', 'new-refresh', Date.now() + 900_000);
    useAuthStore.setState({ tokenExpiresAt: Date.now() - 1_000 }); // 15 minutes later
    postSpy.mockResolvedValue({
      status: 200,
      data: { access_token: 'refreshed', refresh_token: 'rotated', expires_in: 900 },
    });

    await expect(refreshAccessToken()).resolves.toBe('refreshed');
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('is released when the server rejects the refresh token', async () => {
    signedInWith({ expiresAt: Date.now() - 1_000 });
    postSpy.mockRejectedValueOnce(new Error('401'));

    await expect(refreshAccessToken()).rejects.toThrow('401');
    expect(hungLogout).toHaveBeenCalledTimes(1);

    postSpy.mockResolvedValue({
      status: 200,
      data: { access_token: 'fresh', refresh_token: 'fresh-refresh', expires_in: 900 },
    });
    await expect(refreshAccessToken()).resolves.toBe('fresh');
    expect(postSpy).toHaveBeenCalledTimes(2);
  });
});

describe('the request interceptor — spent access tokens', () => {
  it('refreshes an expired token before sending it', async () => {
    signedInWith({ expiresAt: Date.now() - 60_000 });
    postSpy.mockResolvedValue({
      status: 200,
      data: { access_token: 'fresh', refresh_token: 'fresh-refresh', expires_in: 900 },
    });

    const config = await runRequestInterceptor('/notifications/delete-all');

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(config.headers.Authorization).toBe('Bearer fresh');
  });

  it('leaves a healthy token alone', async () => {
    signedInWith({ expiresAt: Date.now() + 10 * 60_000 });
    useAuthStore.setState({ token: 'good-access-token' });

    const config = await runRequestInterceptor('/notifications/history');

    expect(postSpy).not.toHaveBeenCalled();
    expect(config.headers.Authorization).toBe('Bearer good-access-token');
  });

  it('does not refresh when the expiry is unknown', async () => {
    // Pre-upgrade sessions have no recorded expiry. Treating that as spent
    // would refresh on every request; the 401 path covers it instead.
    signedInWith({ expiresAt: null });

    const config = await runRequestInterceptor('/notifications/history');

    expect(postSpy).not.toHaveBeenCalled();
    expect(config.headers.Authorization).toBe('Bearer expired-access-token');
  });

  it('still sends the request when the refresh fails, so the UI sees one 401', async () => {
    signedInWith({ expiresAt: Date.now() - 60_000 });
    postSpy.mockRejectedValue(new Error('refresh failed'));

    await expect(runRequestInterceptor('/notifications/delete-all')).resolves.toBeDefined();
    expect(hungLogout).toHaveBeenCalled();
  });
});
