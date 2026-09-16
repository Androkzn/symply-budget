import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { biometricService } from '@services/biometric';
import { useAuthStore } from '@stores/authStore';

/**
 * The "Face ID / Touch ID for quick sign in" toggle, as one hook.
 *
 * Two screens own this row now — the More hub for every brand that still has an
 * ACCOUNT section there, and Profile for full Budget, where the account rows
 * moved (Profile is already where Sign out and Delete account live). The row
 * itself is drawn per screen, in that screen's idiom; only this — availability,
 * the platform's name for it, and the enable/disable round trip that must not
 * flip the switch when it fails — is shared, so the two cannot drift.
 *
 * `available` is false until the async capability check lands, so a caller can
 * render nothing rather than a toggle that vanishes a frame later.
 */
export function useBiometricQuickSignIn() {
  const user = useAuthStore((state) => state.user);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const enabled = useAuthStore((state) => state.biometricEnabled);
  const setBiometricEnabled = useAuthStore((state) => state.setBiometricEnabled);

  const [available, setAvailable] = useState(false);
  const [typeName, setTypeName] = useState('Biometrics');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const isAvailable = await biometricService.isAvailable();
      if (cancelled) return;
      setAvailable(isAvailable);
      if (!isAvailable) return;
      const name = await biometricService.getBiometricTypeName();
      if (!cancelled) setTypeName(name);
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(
    async (next: boolean) => {
      if (!user || !refreshToken) return;

      setBusy(true);
      try {
        if (next) {
          const success = await biometricService.enableBiometric({
            email: user.email,
            refreshToken,
          });
          if (success) {
            setBiometricEnabled(true);
          } else {
            Alert.alert('Failed', `Could not enable ${typeName}. Please try again.`);
          }
        } else {
          await biometricService.disableBiometric();
          setBiometricEnabled(false);
        }
      } catch (error) {
        console.error('Biometric toggle error:', error);
        Alert.alert('Error', 'An error occurred. Please try again.');
      } finally {
        setBusy(false);
      }
    },
    [refreshToken, setBiometricEnabled, typeName, user],
  );

  /** Face ID / Face Recognition get the scan glyph; everything else, a print. */
  const icon =
    typeName === 'Face ID' || typeName === 'Face Recognition'
      ? ('scan-outline' as const)
      : ('finger-print-outline' as const);

  return { available, typeName, enabled, busy, toggle, icon };
}
