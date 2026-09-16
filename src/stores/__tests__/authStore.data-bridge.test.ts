/**
 * authStore Data Bridge invariants — tokens not in persist; SecureStore hydrate.
 */
const mockLoad = jest.fn();
const mockSave = jest.fn();
const mockClear = jest.fn();
const mockClearCompanion = jest.fn();
const mockRefreshAccessToken = jest.fn();

jest.mock('@services/secure-token-storage', () => ({
  loadProductTokens: (...args: unknown[]) => mockLoad(...args),
  saveProductTokens: (...args: unknown[]) => mockSave(...args),
  clearProductTokens: (...args: unknown[]) => mockClear(...args),
  clearCompanionToken: (...args: unknown[]) => mockClearCompanion(...args),
}));

// hydrateProductTokensFromSecureStore lazily require()s '../api/client' to
// proactively refresh a near-expired token — mock it so tests that don't care
// about that path never trigger a real axios call.
jest.mock('../../api/client', () => ({
  refreshAccessToken: (...args: unknown[]) => mockRefreshAccessToken(...args),
}));

jest.mock('@services/analytics', () => ({
  trackEvent: jest.fn(),
  AnalyticsEvent: { SIGNED_IN: 'signed_in', SIGNED_OUT: 'signed_out', ONBOARDING_COMPLETED: 'ob' },
}));

jest.mock('@services/settings-sync', () => ({
  settingsSync: { flushNow: jest.fn(), queueSync: jest.fn() },
}));

import { useAuthStore, hydrateProductTokensFromSecureStore } from '../authStore';

describe('authStore Data Bridge', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      hasCompletedOnboarding: false,
      biometricEnabled: false,
      biometricPromptShown: false,
      tokenExpiresAt: null,
    });
    jest.clearAllMocks();
    mockSave.mockResolvedValue(undefined);
    mockLoad.mockResolvedValue({ accessToken: null, refreshToken: null, expiresAt: null });
    mockRefreshAccessToken.mockResolvedValue('new-access-token');
  });

  it('partialize omits token and refreshToken', () => {
    useAuthStore.setState({
      user: {
        id: 'u1',
        email: 'a@b.com',
        email_verified: true,
        has_completed_onboarding: true,
      } as never,
      token: 'access-token',
      refreshToken: 'refresh-token',
      isAuthenticated: true,
    });
    const partial = useAuthStore.persist.getOptions().partialize?.(useAuthStore.getState()) as Record<
      string,
      unknown
    >;
    expect(partial.token).toBeUndefined();
    expect(partial.refreshToken).toBeUndefined();
    expect(partial.isAuthenticated).toBe(true);
    expect(partial.user).toBeTruthy();
  });

  it('setTokens writes product tokens to SecureStore, estimating expiresAt when not given', async () => {
    const before = Date.now();
    useAuthStore.getState().setTokens('a', 'r');
    expect(useAuthStore.getState().token).toBe('a');
    expect(useAuthStore.getState().refreshToken).toBe('r');
    expect(mockSave).toHaveBeenCalledWith('a', 'r', expect.any(Number));
    // ~900s (ACCESS_TOKEN_LIFETIME_MS) out from now — a real timestamp, not a stub.
    expect(useAuthStore.getState().tokenExpiresAt).toBeGreaterThanOrEqual(before + 890_000);
  });

  it('setTokens uses a caller-supplied expiresAt when given (real expires_in from a refresh)', async () => {
    useAuthStore.getState().setTokens('a', 'r', 1785900000000);
    expect(mockSave).toHaveBeenCalledWith('a', 'r', 1785900000000);
    expect(useAuthStore.getState().tokenExpiresAt).toBe(1785900000000);
  });

  it('hydrateProductTokensFromSecureStore restores memory tokens', async () => {
    mockLoad.mockResolvedValue({
      accessToken: 'stored-a',
      refreshToken: 'stored-r',
      expiresAt: Date.now() + 800_000, // safely fresh — no proactive refresh
    });
    await hydrateProductTokensFromSecureStore();
    const state = useAuthStore.getState();
    expect(state.token).toBe('stored-a');
    expect(state.refreshToken).toBe('stored-r');
    expect(state.isAuthenticated).toBe(true);
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it('hydrate clears auth when SecureStore empty but persist claimed authenticated', async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: 'u1' } as never,
      token: null,
      refreshToken: null,
    });
    mockLoad.mockResolvedValue({ accessToken: null, refreshToken: null, expiresAt: null });
    await hydrateProductTokensFromSecureStore();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('hydrate proactively refreshes a token that is already past its recorded expiry', async () => {
    mockLoad.mockResolvedValue({
      accessToken: 'stale-a',
      refreshToken: 'stored-r',
      expiresAt: Date.now() - 5_000, // already expired
    });
    await hydrateProductTokensFromSecureStore();
    expect(useAuthStore.getState().token).toBe('stale-a'); // set immediately, not blocked on refresh
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('hydrate proactively refreshes a token with no recorded expiry (pre-upgrade session)', async () => {
    mockLoad.mockResolvedValue({
      accessToken: 'stored-a',
      refreshToken: 'stored-r',
      expiresAt: null,
    });
    await hydrateProductTokensFromSecureStore();
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('hydrate does NOT refresh a token that is safely inside its lifetime', async () => {
    mockLoad.mockResolvedValue({
      accessToken: 'stored-a',
      refreshToken: 'stored-r',
      expiresAt: Date.now() + 800_000,
    });
    await hydrateProductTokensFromSecureStore();
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it('hydrate swallows a failed proactive refresh — reactive retry-after-401 still covers it', async () => {
    mockLoad.mockResolvedValue({
      accessToken: 'stale-a',
      refreshToken: 'stored-r',
      expiresAt: Date.now() - 5_000,
    });
    mockRefreshAccessToken.mockRejectedValue(new Error('network down'));
    await expect(hydrateProductTokensFromSecureStore()).resolves.toBeUndefined();
    expect(useAuthStore.getState().hasHydrated).toBe(true);
  });
});
