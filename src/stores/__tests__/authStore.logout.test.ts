/**
 * authStore.logout — sign-out must ALWAYS flip auth state.
 *
 * Regression guard for the fleet-wide "sign out does nothing" bug: the auth
 * flip used to run LAST in logout(), after ~14 dynamic store imports + resets +
 * awaited storage clears. If any of that threw/hung (a store module failing to
 * evaluate, a circular-dep resolution, a chunk load failure), logout() rejected
 * before flipping isAuthenticated and — because the sign-out button floats the
 * promise (`onPress: () => logout()`) — the user stayed signed in with no
 * feedback. Every brand shares this action, so this covers all of them.
 */
const mockClearProductTokens = jest.fn().mockResolvedValue(undefined);
const mockClearCompanionToken = jest.fn().mockResolvedValue(undefined);
const mockDisableBiometric = jest.fn().mockResolvedValue(undefined);
const mockUpdateStoredRefreshToken = jest.fn().mockResolvedValue(undefined);

jest.mock('@services/secure-token-storage', () => ({
  loadProductTokens: jest.fn().mockResolvedValue({ accessToken: null, refreshToken: null }),
  saveProductTokens: jest.fn().mockResolvedValue(undefined),
  clearProductTokens: (...a: unknown[]) => mockClearProductTokens(...a),
  clearCompanionToken: (...a: unknown[]) => mockClearCompanionToken(...a),
}));

jest.mock('@services/biometric', () => ({
  biometricService: {
    disableBiometric: (...a: unknown[]) => mockDisableBiometric(...a),
    updateStoredRefreshToken: (...a: unknown[]) => mockUpdateStoredRefreshToken(...a),
    rememberEmail: jest.fn(),
    hasStoredCredentials: jest.fn(async () => false),
  },
}));

const mockTrackEvent = jest.fn();
jest.mock('@services/analytics', () => ({
  trackEvent: (...a: unknown[]) => mockTrackEvent(...a),
  AnalyticsEvent: { SIGNED_IN: 'signed_in', SIGNED_OUT: 'signed_out', ONBOARDING_COMPLETED: 'ob' },
}));

jest.mock('@services/settings-sync', () => ({
  settingsSync: { flushNow: jest.fn(), queueSync: jest.fn() },
}));

// Simulate one store module that throws while being evaluated — the exact
// failure mode that used to silently abort sign-out. authStore imports these
// dynamically; the reset helper must isolate this so it can neither reject out
// of logout() nor prevent the auth flip.
jest.mock('../notificationStore', () => {
  throw new Error('TEST: notificationStore failed to evaluate');
});

import { useAuthStore } from '../authStore';

const SIGNED_IN_STATE = {
  user: { id: 'u1' } as never,
  token: 't',
  refreshToken: 'r',
  isAuthenticated: true,
  isLoading: false,
  hasCompletedOnboarding: true,
  biometricEnabled: true,
  biometricPromptShown: true,
};

describe('authStore.logout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClearProductTokens.mockResolvedValue(undefined);
    mockClearCompanionToken.mockResolvedValue(undefined);
    useAuthStore.setState({ ...SIGNED_IN_STATE });
  });

  it('flips isAuthenticated=false even when a store module fails to evaluate', async () => {
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    // Must not reject despite the failing dynamic import.
    await expect(useAuthStore.getState().logout()).resolves.toBeUndefined();

    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.user).toBeNull();
    expect(s.token).toBeNull();
    expect(s.refreshToken).toBeNull();
    expect(s.hasCompletedOnboarding).toBe(false);
  });

  it('clears secure tokens and emits the sign-out analytics event', async () => {
    await useAuthStore.getState().logout();

    expect(mockClearProductTokens).toHaveBeenCalledTimes(1);
    expect(mockClearCompanionToken).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith('signed_out');
  });

  it('preserves biometric enrollment for remember-last-login after sign-out', async () => {
    await useAuthStore.getState().logout();

    const s = useAuthStore.getState();
    expect(s.biometricEnabled).toBe(true);
    expect(s.biometricPromptShown).toBe(true);
    expect(mockDisableBiometric).not.toHaveBeenCalled();
    expect(mockUpdateStoredRefreshToken).toHaveBeenCalledWith('r');
  });

  it('still signs out when clearing secure tokens rejects', async () => {
    mockClearProductTokens.mockRejectedValueOnce(new Error('secure store unavailable'));

    await expect(useAuthStore.getState().logout()).resolves.toBeUndefined();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
