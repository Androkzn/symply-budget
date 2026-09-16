/**
 * Live health of the ACTIVE BYOK provider connection.
 *
 * `/ai-access` (via {@link useAIEntitlement}) is the source of truth for each
 * stored key's status. This hook layers three things on top of it:
 *
 *  1. Derives whether the *active* provider is currently disconnected (the key
 *     was rejected / expired / revoked), plus a friendly reason.
 *  2. A listener that keeps that status fresh — it refetches `/ai-access` every
 *     time the app returns to the foreground (free, just re-reads stored state).
 *  3. A throttled real *health check* — on foreground it re-probes the active
 *     provider's stored key at most once per {@link PROBE_INTERVAL_MS} so a key
 *     that silently expired while the app was closed is caught and its status
 *     flipped, rather than only surfacing mid-feature.
 *
 * Pass `{ monitor: true }` to enable (2) + (3); the default is derive-only so
 * screens can read the status without every mount installing a listener/probe.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { aiAccessApi, type AIProviderId } from '@api/aiAccess';
import { useAIEntitlement, type BYOKConnectionView } from '@hooks/useAIEntitlement';

/** Minimum gap between real provider probes triggered by foregrounding. */
export const PROBE_INTERVAL_MS = 15 * 60 * 1000;

/** Module-level so multiple hook instances share one throttle window. */
let lastProbeAt = 0;

/** A stored-key status that means inference through this provider will fail. */
export function isUnhealthyStatus(status: string | undefined | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  if (s.includes('valid') && !s.includes('invalid')) return false; // "valid"/"validated"
  return ['invalid', 'expired', 'revoked', 'error', 'needs', 'fail'].some((k) => s.includes(k));
}

export interface AIConnectionHealth {
  /** The active provider when the user is on BYOK, else null. */
  activeProvider: AIProviderId | null;
  /** The active provider's stored connection, if any. */
  activeConnection: BYOKConnectionView | null;
  /** True when BYOK is active and the active key is unhealthy. */
  isDisconnected: boolean;
  /** Human-readable reason for the disconnection banner/toast. */
  reason: string | null;
  /** Re-read `/ai-access` (cheap — no provider call). */
  refresh: () => Promise<void>;
  /** Force a real provider probe now (updates stored status), then refresh. */
  probeNow: () => Promise<void>;
  isLoading: boolean;
}

export function useAIConnectionHealth(options?: { monitor?: boolean }): AIConnectionHealth {
  const monitor = options?.monitor ?? false;
  const {
    source,
    provider,
    byokConnections,
    invalidate,
    isLoading,
    bringYourOwnAIEnabled,
  } = useAIEntitlement();

  const activeProvider = source === 'byok' ? (provider as AIProviderId | null) : null;
  const activeConnection = useMemo(
    () => (activeProvider ? byokConnections.find((c) => c.provider === activeProvider) ?? null : null),
    [activeProvider, byokConnections]
  );

  const isDisconnected = !!activeConnection && isUnhealthyStatus(activeConnection.status);
  const reason = isDisconnected
    ? 'Your key may have expired or been revoked at the provider.'
    : null;

  const refresh = useCallback(async () => {
    await invalidate();
  }, [invalidate]);

  const probeNow = useCallback(async () => {
    if (!activeProvider) return;
    lastProbeAt = Date.now();
    try {
      await aiAccessApi.validateConnection(activeProvider);
    } catch {
      // A rejected key throws — the stored status is updated to `invalid`
      // server-side regardless, so the refresh below surfaces it.
    } finally {
      await invalidate();
    }
  }, [activeProvider, invalidate]);

  // (2) + (3): keep status fresh on foreground; probe the active key on a
  // throttle so silent expiry is caught without hammering the provider.
  useEffect(() => {
    if (!monitor || !bringYourOwnAIEnabled) return;

    const onChange = (state: AppStateStatus) => {
      if (state !== 'active') return;
      void invalidate();
      if (activeProvider && Date.now() - lastProbeAt > PROBE_INTERVAL_MS) {
        void probeNow();
      }
    };

    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [monitor, bringYourOwnAIEnabled, activeProvider, invalidate, probeNow]);

  return {
    activeProvider,
    activeConnection,
    isDisconnected,
    reason,
    refresh,
    probeNow,
    isLoading,
  };
}
