import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ENV } from '@config/env';
import { useAppStore } from '@stores/appStore';

/**
 * `isConnected` only means "attached to a network" (Wi-Fi/cellular radio up) —
 * a captive portal or a dead router still reports `true`. `isInternetReachable`
 * is NetInfo's actual reachability probe; treat `null`/`undefined` (probe not
 * finished yet) as online so a slow first check doesn't flash the block overlay.
 */
function resolveIsOnline(state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

/** Debounce before acting on a transition, so a brief Wi-Fi↔cellular handoff doesn't flip the UI. */
const TRANSITION_DEBOUNCE_MS = 800;

/**
 * How long the connection must read offline WITHOUT INTERRUPTION before the
 * block overlay shows. Weak cellular (one bar of LTE, moving between cell
 * towers, etc.) drops and recovers within a second or two routinely — and a
 * scheme that just counts N bad readings is easy for that kind of flicker to
 * satisfy by chance (two brief drops seconds apart look identical to one
 * sustained outage). A single continuous countdown that's cancelled by ANY
 * good reading, however brief, only fires for a connection that's ACTUALLY
 * been down the whole time. Going back online is always immediate — only the
 * offline transition waits this out. Also covers Budget's heavier Worker
 * (queues, Durable Objects, a cross-Worker House binding, a 5m cron), whose
 * occasional slower `/health` response shouldn't alone trip the overlay.
 */
const OFFLINE_CONFIRM_MS = 6 * 1000;

/**
 * Fallback while blocked: NetInfo's change events (native callback, or its
 * own internal reachability retry loop) can stall or get reset by rapid
 * native updates during flaky connectivity, leaving `isOnline` stuck `false`
 * long after the network actually recovers. Force a fresh one-shot check on
 * this interval so the overlay clears on its own instead of requiring the
 * member to tap Retry.
 */
const OFFLINE_RECHECK_MS = 10 * 1000;

let hasConfiguredReachability = false;

/**
 * Android's native module reports its own `isInternetReachable` boolean
 * (`NetworkCapabilities.NET_CAPABILITY_VALIDATED`), which NetInfo trusts over
 * any custom probe by default (`useNativeReachability: true`) — and that
 * OS-level check false-negatives behind some VPNs/custom DNS/corporate
 * networks even with a perfectly good connection (see
 * react-native-netinfo/react-native-netinfo#615), silently making the
 * `reachabilityUrl` config below dead code. `useNativeReachability: false`
 * makes Android actually run our own probe against `/health` instead — a
 * cheap, always-200 route reflecting the thing that matters here (can the
 * app reach Symply's backend), not just "is some host on the internet up".
 * iOS's native module never reports this boolean at all, so it always runs
 * the JS-side probe regardless of this flag.
 */
function ensureReachabilityConfigured() {
  if (hasConfiguredReachability) return;
  const base = ENV.API_BASE_URL;
  if (!base) return; // not resolved yet (e.g. mid circular-import) — retry next mount
  hasConfiguredReachability = true;
  NetInfo.configure({
    reachabilityUrl: `${base}/health`,
    reachabilityTest: async (response) => response.status === 200,
    reachabilityShortTimeout: 5 * 1000,
    reachabilityLongTimeout: 60 * 1000,
    reachabilityRequestTimeout: 15 * 1000,
    useNativeReachability: false,
  });
}

export function useNetworkStatus() {
  const setOnlineStatus = useAppStore((state) => state.setOnlineStatus);
  const isOnline = useAppStore((state) => state.isOnline);
  const [isRetrying, setIsRetrying] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Single source of truth for connectivity, also driving React Query's
  // `onlineManager` — so queries/mutations pause + auto-refetch on the same
  // signal, without a second independent NetInfo subscription.
  const apply = useCallback(
    (nextIsOnline: boolean) => {
      setOnlineStatus(nextIsOnline);
      onlineManager.setOnline(nextIsOnline);
    },
    [setOnlineStatus]
  );

  // See `OFFLINE_CONFIRM_MS` — an offline reading starts a countdown (unless
  // one is already running) instead of applying immediately; any online
  // reading cancels it and applies right away. The overlay only shows once
  // the countdown completes with no good reading in between, i.e. the
  // connection has been down continuously for the full window.
  const applyConfirmed = useCallback(
    (nextIsOnline: boolean) => {
      if (nextIsOnline) {
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = null;
        }
        apply(true);
        return;
      }
      if (offlineTimerRef.current) return; // already counting down
      offlineTimerRef.current = setTimeout(() => {
        offlineTimerRef.current = null;
        apply(false);
      }, OFFLINE_CONFIRM_MS);
    },
    [apply]
  );

  useEffect(() => {
    ensureReachabilityConfigured();

    const applyDebounced = (nextIsOnline: boolean) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        applyConfirmed(nextIsOnline);
      }, TRANSITION_DEBOUNCE_MS);
    };

    // Prime state immediately on mount rather than waiting for the first
    // listener tick, so a cold start doesn't briefly assume "online".
    NetInfo.fetch()
      .then((state) => applyConfirmed(resolveIsOnline(state)))
      .catch(() => {});

    const unsubscribe = NetInfo.addEventListener((state) => {
      applyDebounced(resolveIsOnline(state));
    });

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      unsubscribe();
    };
  }, [applyConfirmed]);

  // See `OFFLINE_RECHECK_MS` — self-heals a stuck block overlay without
  // requiring a manual Retry tap.
  useEffect(() => {
    if (isOnline) return;
    const interval = setInterval(() => {
      NetInfo.fetch()
        .then((state) => applyConfirmed(resolveIsOnline(state)))
        .catch(() => {});
    }, OFFLINE_RECHECK_MS);
    return () => clearInterval(interval);
  }, [isOnline, applyConfirmed]);

  /** Manual "Retry" — single fresh check, bypasses debounce/confirmation so the button feels instant. */
  const retry = useCallback(async () => {
    setIsRetrying(true);
    try {
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
      const state = await NetInfo.fetch();
      apply(resolveIsOnline(state));
    } catch {
      // Native module unavailable — leave current status as-is.
    } finally {
      setIsRetrying(false);
    }
  }, [apply]);

  return { isOnline, isRetrying, retry };
}
