/**
 * useBiometricLogin — remember-last-login via Face ID / Touch ID / passcode.
 * Uses a tiny host component + react-test-renderer (no RNTL dependency).
 */
import React, { useEffect } from 'react';
import { View } from 'react-native';
import renderer, { act } from 'react-test-renderer';

const mockIsAvailable = jest.fn(async (..._args: unknown[]) => true);
const mockHasStoredCredentials = jest.fn(async (..._args: unknown[]) => true);
const mockGetRememberedEmail = jest.fn(async (..._args: unknown[]) => 'user@example.com');
const mockGetTypeName = jest.fn(async (..._args: unknown[]) => 'Face ID');
const mockGetCredentials = jest.fn();
const mockUpdateToken = jest.fn(async (..._args: unknown[]) => undefined);
const mockRememberEmail = jest.fn(async (..._args: unknown[]) => undefined);
const mockDisable = jest.fn(async (..._args: unknown[]) => undefined);

jest.mock('@services/biometric', () => ({
  biometricService: {
    isAvailable: (...a: unknown[]) => mockIsAvailable(...a),
    hasStoredCredentials: (...a: unknown[]) => mockHasStoredCredentials(...a),
    getRememberedEmail: (...a: unknown[]) => mockGetRememberedEmail(...a),
    getBiometricTypeName: (...a: unknown[]) => mockGetTypeName(...a),
    getCredentialsWithBiometric: (...a: unknown[]) => mockGetCredentials(...a),
    updateStoredRefreshToken: (...a: unknown[]) => mockUpdateToken(...a),
    rememberEmail: (...a: unknown[]) => mockRememberEmail(...a),
    disableBiometric: (...a: unknown[]) => mockDisable(...a),
  },
}));

const mockJoinedRefresh = jest.fn();
const mockGetProfile = jest.fn();
const mockLogin = jest.fn();
const mockSetTokens = jest.fn();
const mockSetBiometricEnabled = jest.fn();

jest.mock('@api/joined-platform-auth', () => ({
  joinedPlatformAuth: {
    refresh: (...a: unknown[]) => mockJoinedRefresh(...a),
  },
}));

jest.mock('@api/auth', () => ({
  authApi: {
    refreshToken: jest.fn(),
  },
}));

jest.mock('@api/user', () => ({
  userApi: {
    getProfile: (...a: unknown[]) => mockGetProfile(...a),
  },
}));

jest.mock('@api/platform-spine', () => ({
  isJoinedPlatformBrand: () => true,
}));

jest.mock('@config/env', () => ({
  ENV: {
    FEATURES: { ENABLE_BIOMETRIC_AUTH: true },
  },
}));

jest.mock('@stores/authStore', () => {
  const state = {
    biometricEnabled: true,
    login: (...a: unknown[]) => mockLogin(...a),
    setTokens: (...a: unknown[]) => mockSetTokens(...a),
    setBiometricEnabled: (...a: unknown[]) => mockSetBiometricEnabled(...a),
  };
  const useAuthStore = (selector?: (s: typeof state) => unknown) =>
    typeof selector === 'function' ? selector(state) : state;
  useAuthStore.getState = () => state;
  useAuthStore.setState = (partial: Partial<typeof state>) => Object.assign(state, partial);
  return { useAuthStore };
});

import { useBiometricLogin, type UseBiometricLoginOptions } from '../useBiometricLogin';

type HookValue = ReturnType<typeof useBiometricLogin>;

function HookHost({
  options,
  onValue,
}: {
  options?: UseBiometricLoginOptions;
  onValue: (value: HookValue) => void;
}) {
  const value = useBiometricLogin(options);
  useEffect(() => {
    onValue(value);
  }, [onValue, value]);
  return <View testID="hook-host" />;
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useBiometricLogin', () => {
  let latest: HookValue | null;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    latest = null;
    mockIsAvailable.mockResolvedValue(true);
    mockHasStoredCredentials.mockResolvedValue(true);
    mockGetRememberedEmail.mockResolvedValue('user@example.com');
    mockGetTypeName.mockResolvedValue('Face ID');
    mockGetCredentials.mockResolvedValue({
      email: 'user@example.com',
      refreshToken: 'rt-1',
    });
    mockJoinedRefresh.mockResolvedValue({
      access_token: 'at',
      refresh_token: 'rt-2',
    });
    mockGetProfile.mockResolvedValue({
      user: { id: 'u1', email: 'user@example.com', has_completed_onboarding: true },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function mount(options?: UseBiometricLoginOptions) {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <HookHost options={options} onValue={(v) => {
          latest = v;
        }} />
      );
    });
    return tree!;
  }

  it('exposes canBiometricLogin when hardware + credentials exist', async () => {
    mount();
    await flushMicrotasks();
    expect(latest?.canBiometricLogin).toBe(true);
    expect(latest?.biometricType).toBe('Face ID');
    expect(latest?.rememberedEmail).toBe('user@example.com');
  });

  it('handleBiometricLogin refreshes session and signs the user in', async () => {
    mount();
    await flushMicrotasks();

    let ok = false;
    await act(async () => {
      ok = (await latest?.handleBiometricLogin()) ?? false;
    });

    expect(ok).toBe(true);
    expect(mockJoinedRefresh).toHaveBeenCalledWith('rt-1');
    expect(mockSetTokens).toHaveBeenCalledWith('at', 'rt-2');
    expect(mockUpdateToken).toHaveBeenCalledWith('rt-2');
    expect(mockLogin).toHaveBeenCalled();
  });

  it('disables biometric enrollment when refresh token is expired', async () => {
    mockJoinedRefresh.mockRejectedValueOnce(new Error('invalid_grant'));
    const onError = jest.fn();
    mount({ onError });
    await flushMicrotasks();

    await act(async () => {
      await latest?.handleBiometricLogin();
    });

    expect(mockDisable).toHaveBeenCalled();
    expect(mockSetBiometricEnabled).toHaveBeenCalledWith(false);
    expect(onError).toHaveBeenCalledWith('Session expired. Please sign in with your password.');
    expect(latest?.canBiometricLogin).toBe(false);
  });

  it('auto-triggers biometric login after mount when enabled', async () => {
    mount({ autoTrigger: true });
    await flushMicrotasks();

    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    await flushMicrotasks();

    expect(mockJoinedRefresh).toHaveBeenCalled();
  });

  it('does not offer biometric login when credentials are missing', async () => {
    mockHasStoredCredentials.mockResolvedValue(false);
    mount();
    await flushMicrotasks();
    expect(latest?.canBiometricLogin).toBe(false);
  });
});
