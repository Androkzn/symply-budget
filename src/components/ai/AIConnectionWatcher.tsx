/**
 * Ambient AI-connection watcher — renders nothing.
 *
 * Mounted once at the app root (behind auth). It runs the foreground health
 * check via {@link useAIConnectionHealth} and, the moment the active provider
 * flips to disconnected, notifies the user two ways:
 *
 *   • an in-app toast (visible while they're using the app), and
 *   • a local system notification (so it lands even if they've navigated away),
 *     tagged `type: 'ai_disconnected'` so tapping it opens the reconnect hub.
 *
 * Both are de-duplicated per provider per disconnection episode, and a
 * "reconnected" toast confirms recovery.
 */

import { useEffect, useRef } from 'react';

import { providerLabel } from '@components/ai/providerMeta';
import { useAIConnectionHealth } from '@hooks/useAIConnectionHealth';
import { notificationService } from '@services/notifications';
import { showToast } from '@services/toastManager';
import { useAuthStore } from '@stores/authStore';

/** Providers we've already system-notified about this session (dedupe). */
const notifiedProviders = new Set<string>();

function ActiveWatcher() {
  const { isDisconnected, activeProvider } = useAIConnectionHealth({ monitor: true });
  const wasDisconnected = useRef<boolean | null>(null);

  useEffect(() => {
    const prev = wasDisconnected.current;
    wasDisconnected.current = isDisconnected;

    // Skip the very first render's steady state — only react to a change (or a
    // cold start that is already disconnected).
    if (prev === isDisconnected) return;

    const label = activeProvider ? providerLabel(activeProvider) : 'AI';

    if (isDisconnected) {
      showToast('error', `${label} disconnected — reconnect in AI settings.`, 5000);

      if (activeProvider && !notifiedProviders.has(activeProvider)) {
        notifiedProviders.add(activeProvider);
        notificationService
          .scheduleLocalNotification(
            `${label} disconnected`,
            'Your API key stopped working. Tap to reconnect and keep AI features on.',
            null,
            { type: 'ai_disconnected', provider: activeProvider }
          )
          .catch(() => {
            // No notification permission / not available — the toast + the
            // in-app banner still cover it.
          });
      }
    } else if (prev === true) {
      // Recovered.
      if (activeProvider) notifiedProviders.delete(activeProvider);
      showToast('success', `${label} reconnected.`, 3000);
    }
  }, [isDisconnected, activeProvider]);

  return null;
}

export function AIConnectionWatcher() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // Only run (and only fire the `/ai-access` query) once signed in.
  if (!isAuthenticated) return null;
  return <ActiveWatcher />;
}
