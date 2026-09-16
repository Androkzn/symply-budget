/**
 * useHealthKitConnection — the Apple Health connect/sync state machine.
 *
 * Extracted out of `HealthMoreScreen`, which was the only place this lived
 * until Activity needed the same `HealthKitConnectCard` (donor parity:
 * `WorkoutsView` shows the "authorization required" card on the tab itself,
 * not tucked away in Settings). One hook keeps `getStatus` /
 * `requestPermission` / `importNow` orchestration in exactly one place, so a
 * second screen can mount the card without a second copy of this state
 * machine to keep in sync.
 */
import { useCallback, useEffect, useState } from 'react';

import { showToast } from '@services/toastManager';
import { useHealthSyncStore } from '@stores/healthSyncStore';

import {
  healthKit,
  summarizeHealthKitImport,
  type HealthKitStatus,
  type HealthKitSyncProgress,
} from './healthKit';

export interface UseHealthKitConnectionResult {
  status: HealthKitStatus | null;
  /** True for the whole action (permission ask + import) — drives the card's disabled/"Syncing…" state. */
  busy: boolean;
  /**
   * True only while `importNow()` is actually reading from Apple Health —
   * drives `HealthKitSyncProgressModal`. Deliberately narrower than `busy` in
   * two ways: while the OS permission sheet is up, the sheet itself IS the
   * "something is happening" signal, and presenting our own full-screen modal
   * at the same moment races the system sheet for the native presentation
   * slot, which is what made the modal appear, get displaced by the sheet,
   * then reappear. And once every area has been read from the on-device
   * HealthKit store, `syncing` drops back to `false` even though the import
   * as a whole is still running — writing what was just read to the backend
   * is the slow, network-bound half, and nothing about it needs the member to
   * keep watching a modal. `busy` stays `true` through that whole tail so the
   * card's button can't fire a second overlapping import; a toast reports
   * what actually landed once it settles.
   */
  syncing: boolean;
  /**
   * The running import's per-area progress, for `HealthKitSyncProgressModal`.
   * `null` before a sync starts — real frames only arrive once `importNow()`
   * starts reading.
   */
  progress: HealthKitSyncProgress | null;
  /** Requests permission when not yet connected; re-imports when already connected. */
  connectOrSync: () => Promise<void>;
}

export function useHealthKitConnection(): UseHealthKitConnectionResult {
  // `getStatus()` never throws — an absent bridge reports `unavailable`,
  // which the card renders as its own honest state.
  const [status, setStatus] = useState<HealthKitStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<HealthKitSyncProgress | null>(null);

  useEffect(() => {
    void healthKit.getStatus().then(setStatus);
  }, []);

  /**
   * Connect, or sync now when already connected.
   *
   * A denied or unavailable result is a NORMAL state, not an error: the card
   * renders it and manual entry keeps working, so nothing is surfaced as a
   * toast and no system string ever reaches the UI.
   */
  const connectOrSync = useCallback(async () => {
    setBusy(true);
    setProgress(null);
    try {
      const current = await healthKit.getStatus();
      if (__DEV__) console.log(`[HealthKitConnection] connectOrSync — current status: ${current.state}`);
      const next = current.state === 'connected' ? current : await healthKit.requestPermission();
      if (__DEV__ && next !== current) console.log(`[HealthKitConnection] requestPermission — result: ${next.state}`);
      setStatus(next);
      if (next.state === 'connected') {
        // Only from here does our own modal appear — the OS sheet, if one was
        // just shown, has already been answered and dismissed by this point.
        setSyncing(true);
        // Flips once, the instant `importNow()` moves from reading (on-device,
        // fast) to saving (network calls to our own backend, slower) — the
        // modal drops away and a toast tells the member their data was read
        // and the rest is finishing behind the scenes, rather than holding
        // them on this screen for the whole round trip.
        let announcedBackground = false;
        let lastStage: HealthKitSyncProgress['stage'] | null = null;
        const result = await healthKit.importNow({
          onProgress: (frame) => {
            setProgress(frame);
            if (__DEV__ && frame.stage !== lastStage) {
              lastStage = frame.stage;
              console.log(
                `[HealthKitConnection] importNow progress — stage=${frame.stage} completedAreas=${frame.completedAreas}/${frame.totalAreas}`,
              );
            }
            if (!announcedBackground && frame.stage === 'saving') {
              announcedBackground = true;
              setSyncing(false);
              showToast('info', 'Fetched from Apple Health — finishing sync in the background…');
            }
          },
        });
        if (__DEV__) console.log('[HealthKitConnection] importNow settled', result);
        setStatus(await healthKit.getStatus());
        if (announcedBackground) {
          const message = summarizeHealthKitImport(result);
          if (message) {
            showToast('success', message);
            // Wakes every mounted Health screen so a manual "Sync now"
            // refreshes whichever screens are currently visible, not just
            // this one.
            useHealthSyncStore.getState().markSynced();
          }
        }
      }
    } catch (error) {
      // The native bridge CAN reject (an HKError, a revoked grant
      // mid-import). Letting it through would be an unhandled rejection — a
      // red box in dev carrying the raw `HKErrorDomain` string, which is
      // exactly what every caller of this hook promises never to show.
      // Re-read instead: whatever the OS now reports is the truth, and the
      // card already has honest copy for every one of those states.
      if (__DEV__) console.warn('[HealthKitConnection] connectOrSync — caught error, re-reading status', error);
      setStatus(await healthKit.getStatus().catch(() => null));
    } finally {
      setBusy(false);
      setSyncing(false);
    }
  }, []);

  return { status, busy, syncing, progress, connectOrSync };
}
