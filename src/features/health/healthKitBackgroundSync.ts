/**
 * Symply Health — the EVENT-DRIVEN side of HealthKit sync.
 *
 * `healthKit.ts` answers "how do I read and import HealthKit data"; this file
 * answers "when". Until now the only trigger was a tap on "Sync now"
 * (`useHealthKitConnection.connectOrSync`). This adds the other one: a change
 * `SymplyHealthKitModule` observed in Apple Health — including one written by a
 * third-party app (a smart scale, a food logger) — with no scheduler and no
 * polling anywhere in this file. The native side is the thing that is actually
 * event-driven (`HKObserverQuery` + `enableBackgroundDelivery`); this module
 * just reacts to what it reports.
 *
 * ## Two arrival paths, because the JS runtime is not always alive
 *
 * A background HealthKit launch does not reliably boot the full React Native
 * runtime the way opening the app does, so there are two ways a change reaches
 * this code:
 *
 * 1. **Live event.** If the JS runtime IS running (the ordinary case: app
 *    foreground, or recently backgrounded but not suspended), the native
 *    module's `onHealthDataChanged` event arrives here directly and triggers a
 *    sync within a few seconds.
 * 2. **Pending flag, read on next foreground.** If it was not — the app was
 *    fully suspended or terminated when the observer fired — Swift persists a
 *    flag and posts a local notification instead (see
 *    `SymplyHealthKitModule.swift`). This module asks for that flag every time
 *    the app becomes active, so a change that arrived with nobody listening
 *    still triggers a catch-up sync the next time the member opens the app,
 *    whether or not they tapped the notification.
 *
 * Both paths debounce through the SAME `scheduleSync`, so a burst of several
 * changed types (one third-party write touching weight AND several nutrition
 * samples together) collapses into one `importNow()` call, not five.
 *
 * ## Why this calls `importNow()` rather than a narrower incremental read
 *
 * `SymplyHealthKitModule` uses `HKAnchoredObjectQuery` internally to confirm a
 * change is real before it ever tells JS about it, but it does not hand JS the
 * exact delta. Re-running the full, already-idempotent `importNow()` catch-up
 * window is simpler and safer than threading a second, parallel "apply this
 * exact diff" code path through the bridge: `importNow()`'s own day-level
 * planning (manual-always-wins, unchanged-skip, `healthkit_uuid` de-dup for
 * workouts) already makes a bounded re-read non-duplicating, so there is
 * nothing this file has to get right that `healthKit.ts` does not already.
 */
import { AppState, type AppStateStatus } from 'react-native';

import { useHealthSyncStore } from '@stores/healthSyncStore';

import { healthKit, summarizeHealthKitImport } from './healthKit';
import { nativeHealthKitModule, type HealthKitNativeModule } from './healthKitBridge';

/** Quiet period after the last signal before a sync actually runs. */
const DEBOUNCE_MS = 3000;

interface BackgroundSyncHandle {
  stop: () => void;
}

/**
 * Starts listening. Returns a `stop()` that tears every subscription and timer
 * down — called on sign-out the same way `widgetSync.clear()` is, so a second
 * member on the same handset never inherits a running listener.
 */
export function startHealthKitBackgroundSync(): BackgroundSyncHandle {
  const maybeNative = nativeHealthKitModule();
  if (!maybeNative) return { stop: () => {} };
  // Rebound to a non-nullable `const`: TS narrowing of a closed-over variable
  // does not reliably persist into the nested function DECLARATIONS below (as
  // opposed to arrow functions), so this alias carries the narrowed type
  // itself rather than asking every closure to re-prove it.
  const native: HealthKitNativeModule = maybeNative;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let syncInFlight: Promise<void> | null = null;
  let stopped = false;

  async function runSync(): Promise<void> {
    if (syncInFlight) {
      if (__DEV__) console.log('[HealthKitSync] runSync — already in flight, joining existing promise');
      return syncInFlight;
    }
    if (__DEV__) console.log('[HealthKitSync] runSync — starting importNow()');
    syncInFlight = (async () => {
      try {
        // No `days` override: reads the same two-chunk historical window
        // (last calendar month + this month to date) as a manual "Sync now"
        // tap. A `days: 7` catch-up window used to miss any change the member
        // backdated more than a week — Apple Health reported the change, this
        // ran, and it silently found nothing because it was looking in the
        // wrong place.
        const result = await healthKit.importNow({});
        if (stopped) {
          if (__DEV__) console.log('[HealthKitSync] runSync — stopped before result could be shown');
          return;
        }
        const message = summarizeHealthKitImport(result);
        if (__DEV__) console.log('[HealthKitSync] runSync — done:', message ?? '(nothing changed)');
        // No toast here — this path fires on every silent background/observer
        // sync, which on a Watch-wearing member can be several times an hour.
        // A popup for each one is the annoyance, not the sync itself; a manual
        // "Sync now" tap (`useHealthKitConnection.connectOrSync`) still gets
        // its toast, since that member is actively waiting for feedback.
        if (message) {
          // Wakes the focused Health screen (via useHealthKitSyncHydration)
          // so a sync landing while the member is already on a tab refreshes
          // it live, not just on next focus.
          useHealthSyncStore.getState().markSynced();
        }
      } catch (error) {
        // Never surface a raw error here — the same "denied/failed is not an
        // error the user sees" contract `importNow()` already promises. The
        // next change (or the next manual Sync tap) tries again.
        if (__DEV__) console.warn('[HealthKitSync] runSync — swallowed error', error);
      } finally {
        syncInFlight = null;
      }
    })();
    return syncInFlight;
  }

  function scheduleSync(): void {
    if (stopped) return;
    if (debounceTimer) {
      if (__DEV__) console.log('[HealthKitSync] scheduleSync — resetting existing debounce timer');
      clearTimeout(debounceTimer);
    } else if (__DEV__) {
      console.log(`[HealthKitSync] scheduleSync — new debounce timer, firing in ${DEBOUNCE_MS}ms`);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runSync();
    }, DEBOUNCE_MS);
  }

  async function consumePendingIfAny(): Promise<void> {
    const pending = await native.consumePendingSync().catch(() => false);
    if (__DEV__) console.log(`[HealthKitSync] consumePendingIfAny — pending=${pending}`);
    if (pending) scheduleSync();
  }

  const changeSubscription = native.addListener('onHealthDataChanged', () => {
    if (__DEV__) console.log('[HealthKitSync] native onHealthDataChanged event received');
    scheduleSync();
  });

  const onAppStateChange = (state: AppStateStatus) => {
    if (__DEV__) console.log(`[HealthKitSync] AppState changed to "${state}"`);
    if (state === 'active') void consumePendingIfAny();
  };
  const appStateSubscription = AppState.addEventListener('change', onAppStateChange);

  // Cover the case where a change landed while the app was fully closed and
  // this is the launch that opens it — not just a foreground-from-background.
  void consumePendingIfAny();

  return {
    stop: () => {
      stopped = true;
      changeSubscription.remove();
      appStateSubscription.remove();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    },
  };
}
