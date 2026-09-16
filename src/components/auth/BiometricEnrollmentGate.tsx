/**
 * Renders the one-time "Enable Face ID / Touch ID?" enrollment prompt once a user
 * is signed in — the piece that makes biometric re-login discoverable. Without
 * this, biometrics could only be turned on by digging into Settings, so almost
 * nobody found it.
 *
 * Mounted in the authenticated shell (app/_layout). It shows the sheet exactly
 * once per user, gated on:
 *   - a live session with a refresh token to store behind the biometric gate,
 *   - biometrics not already enabled,
 *   - the prompt never having been shown before (`biometricPromptShown`, which is
 *     persisted AND synced to the backend so it never re-appears across devices),
 *   - the device actually having enrolled biometric hardware.
 *
 * The modal itself flips `biometricPromptShown` on enable/skip, which makes this
 * gate go inert. Shared across the whole fleet via `src/`.
 */
import { useEffect, useState } from 'react';

import { BiometricSetupModal } from '@components/auth/BiometricSetupModal';
import { ENV } from '@config/env';
import { biometricService } from '@services/biometric';
import { useAuthStore } from '@stores/authStore';

export function BiometricEnrollmentGate() {
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const biometricPromptShown = useAuthStore((s) => s.biometricPromptShown);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const user = useAuthStore((s) => s.user);

  const [available, setAvailable] = useState(false);
  const [visible, setVisible] = useState(false);

  // Eligible = signed-in, never prompted, biometrics not already on, and we hold
  // a refresh token to enroll. Recomputed from the store so it goes false the
  // moment the modal marks the prompt shown.
  const eligible =
    ENV.FEATURES.ENABLE_BIOMETRIC_AUTH &&
    !!user &&
    !!refreshToken &&
    !biometricEnabled &&
    !biometricPromptShown;

  useEffect(() => {
    if (!eligible) {
      setAvailable(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const ok = await biometricService.isAvailable();
      if (!cancelled) setAvailable(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [eligible]);

  useEffect(() => {
    if (!eligible || !available) return;
    // Let the home screen settle before sliding the sheet up.
    const timer = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(timer);
  }, [eligible, available]);

  if (!visible) return null;

  return <BiometricSetupModal visible={visible} onComplete={() => setVisible(false)} />;
}
