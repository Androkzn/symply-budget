/**
 * BiometricService — Face ID / Touch ID / passcode remember-last-login.
 */
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __store: store,
  };
});

const mockHasHardware = jest.fn(async (..._args: unknown[]) => true);
const mockIsEnrolled = jest.fn(async (..._args: unknown[]) => true);
const mockSupportedTypes = jest.fn(async (..._args: unknown[]) => [1]); // FACIAL_RECOGNITION
const mockAuthenticate = jest.fn(async (..._args: unknown[]) => ({ success: true }));

jest.mock('expo-local-authentication', () => ({
  AuthenticationType: {
    FINGERPRINT: 1,
    FACIAL_RECOGNITION: 2,
    IRIS: 3,
  },
  hasHardwareAsync: (...a: unknown[]) => mockHasHardware(...a),
  isEnrolledAsync: (...a: unknown[]) => mockIsEnrolled(...a),
  supportedAuthenticationTypesAsync: (...a: unknown[]) => mockSupportedTypes(...a),
  authenticateAsync: (...a: unknown[]) => mockAuthenticate(...a),
}));

jest.mock('@brand', () => ({
  brand: { id: 'symply-house' },
}));

jest.mock('@config/env', () => ({
  ENV: { IS_PRODUCTION: false },
}));

import * as SecureStore from 'expo-secure-store';

import { biometricService } from '../index';

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

describe('biometricService', () => {
  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    mockSupportedTypes.mockResolvedValue([2]);
    mockAuthenticate.mockResolvedValue({ success: true });
  });

  it('isAvailable requires hardware + enrollment and never throws', async () => {
    await expect(biometricService.isAvailable()).resolves.toBe(true);
    mockIsEnrolled.mockResolvedValueOnce(false);
    await expect(biometricService.isAvailable()).resolves.toBe(false);
    mockHasHardware.mockRejectedValueOnce(new Error('native boom'));
    await expect(biometricService.isAvailable()).resolves.toBe(false);
  });

  it('authenticate enables passcode fallback and swallows native errors', async () => {
    await expect(biometricService.authenticate()).resolves.toBe(true);
    expect(mockAuthenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        disableDeviceFallback: false,
        fallbackLabel: 'Use Passcode',
      })
    );
    mockAuthenticate.mockRejectedValueOnce(new Error('cancelled'));
    await expect(biometricService.authenticate()).resolves.toBe(false);
  });

  it('enableBiometric stores credentials + remembered email behind scoped keys', async () => {
    const ok = await biometricService.enableBiometric({
      email: 'user@example.com',
      refreshToken: 'rt-1',
    });
    expect(ok).toBe(true);
    expect(store.get('symply-house.staging.1.biometric.enabled')).toBe('true');
    expect(store.get('symply-house.staging.1.biometric.credentials')).toContain('rt-1');
    expect(await biometricService.getRememberedEmail()).toBe('user@example.com');
    expect(await biometricService.hasStoredCredentials()).toBe(true);
  });

  it('enableBiometric returns false when user cancels biometric prompt', async () => {
    mockAuthenticate.mockResolvedValueOnce({ success: false });
    await expect(
      biometricService.enableBiometric({ email: 'a@b.c', refreshToken: 'rt' })
    ).resolves.toBe(false);
    expect(store.size).toBe(0);
  });

  it('getCredentialsWithBiometric returns null without enrollment or on cancel', async () => {
    await expect(biometricService.getCredentialsWithBiometric()).resolves.toBeNull();

    await biometricService.enableBiometric({
      email: 'user@example.com',
      refreshToken: 'rt-1',
    });
    mockAuthenticate.mockResolvedValueOnce({ success: false });
    await expect(biometricService.getCredentialsWithBiometric()).resolves.toBeNull();
  });

  it('getCredentialsWithBiometric returns stored blob after successful auth', async () => {
    await biometricService.enableBiometric({
      email: 'user@example.com',
      refreshToken: 'rt-1',
    });
    const creds = await biometricService.getCredentialsWithBiometric();
    expect(creds).toEqual({ email: 'user@example.com', refreshToken: 'rt-1' });
  });

  it('updateStoredRefreshToken rotates the refresh token in place', async () => {
    await biometricService.enableBiometric({
      email: 'user@example.com',
      refreshToken: 'rt-old',
    });
    await biometricService.updateStoredRefreshToken('rt-new');
    const creds = await biometricService.getCredentialsWithBiometric();
    expect(creds?.refreshToken).toBe('rt-new');
  });

  it('disableBiometric clears credentials, enabled flag, and remembered email', async () => {
    await biometricService.enableBiometric({
      email: 'user@example.com',
      refreshToken: 'rt-1',
    });
    await biometricService.disableBiometric();
    expect(await biometricService.isBiometricEnabled()).toBe(false);
    expect(await biometricService.hasStoredCredentials()).toBe(false);
    expect(await biometricService.getRememberedEmail()).toBeNull();
  });

  it('rememberEmail is readable without a biometric prompt', async () => {
    await biometricService.rememberEmail('  last@example.com  ');
    expect(await biometricService.getRememberedEmail()).toBe('last@example.com');
  });
});
