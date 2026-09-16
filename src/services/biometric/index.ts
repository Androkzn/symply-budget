import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { brand } from '@brand';
import { ENV } from '@config/env';

// Biometric SecureStore keys are brand + env scoped so the five ecosystem apps
// (House / Budget / Kaizen / Language / Health) sharing this `src/` can't collide
// on a device that has more than one installed — mirroring secure-token-storage.
// SDK 57 forbids ':' in keys, so use '.' as the separator.
const AUTHORITY_VERSION = '1';

function envSegment(): string {
  return ENV.IS_PRODUCTION ? 'production' : 'staging';
}

function scopedKey(suffix: 'enabled' | 'credentials' | 'email'): string {
  return `${brand.id}.${envSegment()}.${AUTHORITY_VERSION}.biometric.${suffix}`;
}

// Pre-scoping releases used these fixed keys. Wipe them on enable/disable so a
// stale enrollment (or another brand's leftover) can't linger unscoped.
const LEGACY_BIOMETRIC_KEYS = ['biometric_enabled', 'biometric_credentials'] as const;

async function wipeLegacyBiometricKeys(): Promise<void> {
  await Promise.all(
    LEGACY_BIOMETRIC_KEYS.map((key) =>
      SecureStore.deleteItemAsync(key).catch(() => undefined)
    )
  );
}

export interface BiometricCredentials {
  email: string;
  refreshToken: string;
}

export type BiometricType = 'fingerprint' | 'facial' | 'iris' | 'none';

class BiometricService {
  /**
   * Check if biometric hardware is available on the device
   */
  async isAvailable(): Promise<boolean> {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      return compatible && enrolled;
    } catch (error) {
      console.error('Error checking biometric availability:', error);
      return false;
    }
  }

  /**
   * Get the type of biometric authentication available
   */
  async getBiometricType(): Promise<BiometricType> {
    try {
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        return 'facial';
      }
      if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        return 'fingerprint';
      }
      if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
        return 'iris';
      }
      return 'none';
    } catch (error) {
      console.error('Error getting biometric type:', error);
      return 'none';
    }
  }

  /**
   * Get human-readable name for biometric type
   */
  async getBiometricTypeName(): Promise<string> {
    const type = await this.getBiometricType();

    switch (type) {
      case 'facial':
        return Platform.OS === 'ios' ? 'Face ID' : 'Face Recognition';
      case 'fingerprint':
        return Platform.OS === 'ios' ? 'Touch ID' : 'Fingerprint';
      case 'iris':
        return 'Iris Scanner';
      default:
        return 'Biometrics';
    }
  }

  /**
   * Authenticate user with biometrics
   */
  async authenticate(promptMessage?: string): Promise<boolean> {
    try {
      const biometricName = await this.getBiometricTypeName();
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: promptMessage || `Sign in with ${biometricName}`,
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
        fallbackLabel: 'Use Passcode',
      });

      return result.success;
    } catch (error) {
      console.error('Biometric authentication error:', error);
      return false;
    }
  }

  /**
   * Check if biometric login is enabled for the app
   */
  async isBiometricEnabled(): Promise<boolean> {
    try {
      const enabled = await SecureStore.getItemAsync(scopedKey('enabled'));
      return enabled === 'true';
    } catch (error) {
      console.error('Error checking biometric enabled status:', error);
      return false;
    }
  }

  /**
   * Enable biometric login and store credentials securely
   */
  async enableBiometric(credentials: BiometricCredentials): Promise<boolean> {
    try {
      // First verify biometric authentication
      const authenticated = await this.authenticate('Enable biometric login');
      if (!authenticated) {
        return false;
      }

      // Store credentials securely
      await SecureStore.setItemAsync(
        scopedKey('credentials'),
        JSON.stringify(credentials),
        {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }
      );

      // Mark biometric as enabled
      await SecureStore.setItemAsync(scopedKey('enabled'), 'true');
      // Last-used email is non-secret UI state (prefill on Login) — stored
      // separately so we never have to unlock the refresh-token blob to show it.
      await this.rememberEmail(credentials.email);
      // Drop any pre-scoping keys now that the scoped ones are the source of truth.
      await wipeLegacyBiometricKeys();

      return true;
    } catch (error) {
      console.error('Error enabling biometric:', error);
      return false;
    }
  }

  /**
   * Disable biometric login and remove stored credentials
   */
  async disableBiometric(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(scopedKey('credentials'));
      await SecureStore.deleteItemAsync(scopedKey('enabled'));
      await SecureStore.deleteItemAsync(scopedKey('email')).catch(() => undefined);
      await wipeLegacyBiometricKeys();
    } catch (error) {
      console.error('Error disabling biometric:', error);
    }
  }

  /**
   * Persist the last-used account email for Login prefill ("remember last login").
   * Safe to call without a biometric prompt — email alone is not a credential.
   */
  async rememberEmail(email: string): Promise<void> {
    try {
      const trimmed = email.trim();
      if (!trimmed) return;
      await SecureStore.setItemAsync(scopedKey('email'), trimmed, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } catch (error) {
      console.error('Error remembering login email:', error);
    }
  }

  /**
   * Read the remembered login email without prompting for biometrics.
   */
  async getRememberedEmail(): Promise<string | null> {
    try {
      return (await SecureStore.getItemAsync(scopedKey('email'))) ?? null;
    } catch (error) {
      console.error('Error reading remembered login email:', error);
      return null;
    }
  }

  /**
   * Get stored credentials after biometric authentication
   */
  async getCredentialsWithBiometric(): Promise<BiometricCredentials | null> {
    try {
      // First check if biometric is enabled
      const isEnabled = await this.isBiometricEnabled();
      if (!isEnabled) {
        return null;
      }

      // Authenticate with biometrics
      const authenticated = await this.authenticate();
      if (!authenticated) {
        return null;
      }

      // Retrieve stored credentials
      const credentialsJson = await SecureStore.getItemAsync(scopedKey('credentials'));
      if (!credentialsJson) {
        return null;
      }

      return JSON.parse(credentialsJson) as BiometricCredentials;
    } catch (error) {
      console.error('Error getting credentials with biometric:', error);
      return null;
    }
  }

  /**
   * Update stored refresh token (called after token refresh)
   */
  async updateStoredRefreshToken(refreshToken: string): Promise<void> {
    try {
      const isEnabled = await this.isBiometricEnabled();
      if (!isEnabled) {
        return;
      }

      const credentialsJson = await SecureStore.getItemAsync(scopedKey('credentials'));
      if (!credentialsJson) {
        return;
      }

      const credentials = JSON.parse(credentialsJson) as BiometricCredentials;
      credentials.refreshToken = refreshToken;

      await SecureStore.setItemAsync(
        scopedKey('credentials'),
        JSON.stringify(credentials),
        {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }
      );
    } catch (error) {
      console.error('Error updating stored refresh token:', error);
    }
  }

  /**
   * Check if credentials exist for biometric login
   */
  async hasStoredCredentials(): Promise<boolean> {
    try {
      const isEnabled = await this.isBiometricEnabled();
      if (!isEnabled) {
        return false;
      }

      const credentialsJson = await SecureStore.getItemAsync(scopedKey('credentials'));
      return credentialsJson !== null;
    } catch (error) {
      console.error('Error checking stored credentials:', error);
      return false;
    }
  }
}

export const biometricService = new BiometricService();
