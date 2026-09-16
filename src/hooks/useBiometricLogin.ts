/**
 * Biometric login hook — re-homed from LoginScreen after MainNavigator removal.
 * Use on auth screens (Login, Settings security) for auto/manual biometric sign-in.
 *
 * "Remember last login" = SecureStore holds { email, refreshToken } behind a
 * Face ID / Touch ID / device-passcode gate. Sign-out clears session JWTs but
 * keeps enrollment so this hook can restore the session.
 */
import { useCallback, useEffect, useState, type MutableRefObject } from 'react';

import { authApi } from '@api/auth';
import { joinedPlatformAuth } from '@api/joined-platform-auth';
import { isJoinedPlatformBrand } from '@api/platform-spine';
import { userApi } from '@api/user';
import { ENV } from '@config/env';
import { biometricService } from '@services/biometric';
import { useAuthStore } from '@stores/authStore';

export interface UseBiometricLoginOptions {
  /** When true, attempt biometric login shortly after mount (Login screen). */
  autoTrigger?: boolean;
  /** Skip auto-trigger (e.g. after explicit password logout). */
  skipAutoTriggerRef?: MutableRefObject<boolean>;
  onError?: (message: string) => void;
}

export function useBiometricLogin(options: UseBiometricLoginOptions = {}) {
  const { autoTrigger = false, skipAutoTriggerRef, onError } = options;
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const login = useAuthStore((s) => s.login);
  const setTokens = useAuthStore((s) => s.setTokens);

  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [canBiometricLogin, setCanBiometricLogin] = useState(false);
  const [biometricType, setBiometricType] = useState('Biometrics');
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [rememberedEmail, setRememberedEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!ENV.FEATURES.ENABLE_BIOMETRIC_AUTH) {
        if (!cancelled) {
          setBiometricAvailable(false);
          setCanBiometricLogin(false);
        }
        return;
      }

      try {
        const [available, hasCreds, email] = await Promise.all([
          biometricService.isAvailable(),
          biometricService.hasStoredCredentials(),
          biometricService.getRememberedEmail(),
        ]);
        if (cancelled) return;

        setBiometricAvailable(available);
        setRememberedEmail(email);
        setCanBiometricLogin(available && hasCreds);

        if (available) {
          setBiometricType(await biometricService.getBiometricTypeName());
        }

        // SecureStore is the device source of truth — heal a stale Zustand flag
        // without queueing a settings sync.
        if (hasCreds && !useAuthStore.getState().biometricEnabled) {
          useAuthStore.setState({ biometricEnabled: true });
        }
      } catch (error) {
        console.error('[useBiometricLogin] availability probe failed:', error);
        if (!cancelled) {
          setBiometricAvailable(false);
          setCanBiometricLogin(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBiometricLogin = useCallback(
    async (isAutoTriggered = false) => {
      if (!ENV.FEATURES.ENABLE_BIOMETRIC_AUTH || !canBiometricLogin) {
        return false;
      }

      setBiometricLoading(true);
      try {
        const credentials = await biometricService.getCredentialsWithBiometric();
        if (!credentials) {
          if (!isAutoTriggered) {
            onError?.('Biometric authentication failed or no stored credentials');
          }
          return false;
        }

        const response = isJoinedPlatformBrand()
          ? await joinedPlatformAuth.refresh(credentials.refreshToken)
          : await authApi.refreshToken(credentials.refreshToken);

        setTokens(response.access_token, response.refresh_token);
        await biometricService.updateStoredRefreshToken(response.refresh_token);
        await biometricService.rememberEmail(credentials.email);

        const userResponse = await userApi.getProfile();
        login(userResponse.user, response.access_token, response.refresh_token);
        return true;
      } catch {
        // Refresh token is dead — wipe enrollment so we don't loop a failing prompt.
        await biometricService.disableBiometric();
        useAuthStore.getState().setBiometricEnabled(false);
        setCanBiometricLogin(false);
        if (!isAutoTriggered) {
          onError?.('Session expired. Please sign in with your password.');
        }
        return false;
      } finally {
        setBiometricLoading(false);
      }
    },
    [canBiometricLogin, login, onError, setTokens]
  );

  useEffect(() => {
    if (!autoTrigger) return;
    if (skipAutoTriggerRef?.current) return;
    if (!canBiometricLogin) return;

    const timer = setTimeout(() => {
      void handleBiometricLogin(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [autoTrigger, canBiometricLogin, handleBiometricLogin, skipAutoTriggerRef]);

  return {
    biometricAvailable,
    /** Hardware + enrolled credentials ready for Face ID / Touch ID / passcode. */
    canBiometricLogin,
    biometricEnabled: canBiometricLogin || biometricEnabled,
    biometricType,
    biometricLoading,
    rememberedEmail,
    handleBiometricLogin,
  };
}
