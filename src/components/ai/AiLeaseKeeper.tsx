/**
 * Session-lease keeper — the glue that makes the hybrid key model work.
 *
 * The durable BYOK key lives in the device Keychain; the server holds only a
 * short-lived, encrypted session lease so background AI (cron digests, Lambda
 * reports, server chat) can run when the user isn't present. This mounts once,
 * globally, and whenever the app becomes active it silently re-leases any
 * connected provider whose lease is expiring soon (or has expired) — reading the
 * key from the Keychain and refreshing the server copy. It renders nothing and
 * never blocks the UI; failures are quiet (the user re-connects if a key is gone).
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { aiAccessApi } from '@api/aiAccess';
import { useAIEntitlement } from '@hooks/useAIEntitlement';
import { aiKeyVault } from '@services/aiKeyVault';

// Re-lease when a lease is within this window of expiring (or already expired).
const REFRESH_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
// Don't run the sweep more than this often (foreground churn guard).
const MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function AiLeaseKeeper() {
  const { byokConnections, bringYourOwnAIEnabled, invalidate } = useAIEntitlement();
  const lastRunRef = useRef(0);
  const runningRef = useRef(false);

  // Keep the latest connections in a ref so the AppState handler stays stable.
  const connectionsRef = useRef(byokConnections);
  connectionsRef.current = byokConnections;
  const enabledRef = useRef(bringYourOwnAIEnabled);
  enabledRef.current = bringYourOwnAIEnabled;

  useEffect(() => {
    const sweep = async () => {
      if (!enabledRef.current || runningRef.current) return;
      const now = Date.now();
      if (now - lastRunRef.current < MIN_INTERVAL_MS) return;
      lastRunRef.current = now;
      runningRef.current = true;

      let refreshed = false;
      try {
        for (const conn of connectionsRef.current) {
          // Only session-leased providers have an expiry; legacy permanent keys skip.
          if (!conn.leaseExpiresAt) continue;
          const expiresMs = Date.parse(conn.leaseExpiresAt);
          if (Number.isNaN(expiresMs)) continue;
          if (expiresMs - now > REFRESH_WINDOW_MS) continue;

          try {
            const key = await aiKeyVault.getKey(conn.provider);
            if (!key) continue; // key not on this device → user must reconnect
            await aiAccessApi.createSessionLease(conn.provider, key);
            refreshed = true;
          } catch {
            // Quiet — a transient failure just retries on the next foreground.
          }
        }
      } finally {
        runningRef.current = false;
        if (refreshed) await invalidate();
      }
    };

    // Run once on mount, then on every transition into the foreground.
    sweep().catch(() => undefined);
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') sweep().catch(() => undefined);
    });
    return () => sub.remove();
     
  }, [invalidate]);

  return null;
}
