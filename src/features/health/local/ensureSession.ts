// Side-effect BEFORE engine / @symply/local-first — `@noble/*` captures
// `globalThis.crypto` at module load, so this import must stay a BARE STATIC
// side-effect at the top of the file. Never `await import('./cryptoPolyfill')`:
// dynamic ESM import throws under Jest without `--experimental-vm-modules`, and
// a lazy call would run after noble has already cached a missing `crypto`.
// Plan §5.1.
import './cryptoPolyfill';

import { asyncStorage } from '@services/storage';
import { useAuthStore } from '@stores/authStore';

import { HEALTH_CACHE_KEYS } from '../healthCacheKeys';

import { clearHealthBlobLocalState } from './blobs';
import {
  closeLocalHealthSession,
  isLocalHealthSessionOpen,
  openLocalHealthSession,
  resetLocalHealthSession,
} from './engine';
import { HealthLocalNotReadyError } from './errors';
import { isHealthLocalFirst } from './flag';
import { startHealthLedgerRefreshBridge, stopHealthLedgerRefreshBridge } from './ledgerRefresh';
import { clearLocalHealthPersistence } from './persistence';
import { armHealthLocalFirstHeader, disarmHealthLocalFirstHeader } from './sync/headers';

/**
 * Health V2 session lifecycle — the four silent-failure points of plan §5.1.
 *
 * WHY THIS FILE IS SECURITY-CRITICAL RATHER THAN PLUMBING
 * ------------------------------------------------------
 * Every failure mode here is silent by construction:
 *
 * - **Session not opened.** He3's Proxy on `src/api/health.ts` catches a local
 *   throw and falls through to remote. So a missed `ensureHealthLocalSession()`
 *   does not crash — it quietly restores the dual-world state §1.3 exists to
 *   kill, and `readThrough` then overwrites the MMKV mirror with the D1 answer
 *   (`healthRepository.ts:364-366`). Nothing goes red. `assertHealthLocalSessionOpen()`
 *   below is the guard every `local*Api` must call first so that omission is a
 *   visible failure instead of a correct-looking screen.
 * - **Teardown not run.** The ledger, its WAL sidecars and the DEK outlive the
 *   sign-out and the next person on the handset inherits a health record
 *   (`e2e/maestro/health/privacy-cross-user-leak.yaml`).
 * - **Refresh bridge not started.** Data from the member's other device lands in
 *   the ledger and no screen repaints.
 *
 * The flag gate is equally load-bearing in the other direction: a TestFlight
 * build ships with `EXPO_PUBLIC_HEALTH_LOCAL_FIRST` OFF and must behave exactly
 * as it does today, so every entry point below returns before touching anything.
 */

/**
 * Single-flight + "already open for this user" guard.
 *
 * `ensureHealthLocalSession()` is called from at least two triggers (post
 * sign-in, post-hydrate cold start) and both can run in the same tick on a warm
 * relaunch. Two concurrent opens race the same SQLite file and the same
 * `POST /v2/households`.
 */
let openInFlight: Promise<void> | null = null;
let openedForUserId: string | null = null;

/**
 * Open (or reopen) the encrypted personal ledger after sign-in / hydration.
 * Idempotent: repeated calls for the same signed-in user are a no-op.
 *
 * Everything after the session open is best-effort and offline-safe. A device
 * with no network still gets a fully usable ledger; control-plane registration,
 * the push token and the first sync all retry on the next foreground.
 */
export async function ensureHealthLocalSession(): Promise<void> {
  if (!isHealthLocalFirst()) return;

  const { user, isAuthenticated, hasHydrated } = useAuthStore.getState();
  if (!hasHydrated || !isAuthenticated || !user?.id) return;

  // A second caller joins the first call rather than starting a second open.
  if (openInFlight) return openInFlight;

  if (openedForUserId === user.id && isLocalHealthSessionOpen()) {
    // Already open for this account. Re-assert the bridge only — it is
    // idempotent and this is the cheap path taken on every foreground.
    startHealthLedgerRefreshBridge();
    return;
  }

  const userId = user.id;
  openInFlight = openSessionOnce(userId).finally(() => {
    openInFlight = null;
  });
  return openInFlight;
}

async function openSessionOnce(userId: string): Promise<void> {
  const ledger = await openLocalHealthSession({ userId });
  openedForUserId = userId;
  console.log('[HealthLocal] session open', {
    householdId: ledger.household.id,
    deviceId: ledger.deviceId,
  });

  // Arm `X-Health-Local-First` on `/health/*` from here on — AFTER the ledger
  // is genuinely open, never merely because the flag is 1.
  //
  // Two orderings are load-bearing and both are easy to get wrong:
  //  - AFTER the open, because arming starts the Worker's 410s. A flag-1
  //    binary whose session failed to open must keep reaching D1, or the user
  //    has no working app at all.
  //  - AFTER the export-before-upgrade window (plan §1.3a). This call is the
  //    "first `X-Health-Local-First` header" the plan measures that window
  //    against; `exportBeforeUpgrade.ts` must have run before it.
  armHealthLocalFirstHeader();

  // Repaint Health screens whenever an op merges in. Health is NOT React Query
  // — the bridge drives `healthLedgerStore`, and without it an inbound sync
  // updates the ledger while Home keeps rendering the previous snapshot
  // (plan §5.1 row 4 / §7 refresh contract). Idempotent.
  startHealthLedgerRefreshBridge();

  // Best-effort control-plane registration + push token. Offline-safe: each
  // step retries on the next session open.
  //
  // TODO(He4): chain the sync client's first pull here, the way Budget and
  // House chain `runBudgetLocalSync` / `runHouseLocalSync`. Until it exists the
  // push wake's `syncHealthOnce()` is a documented no-op (`pushWake.ts`).
  void import('./controlPlaneClient')
    .then((m) => m.syncLocalHealthHouseholdToControlPlane())
    .then(() => import('./pushWake'))
    .then((m) => m.registerHealthLocalPushToken())
    .catch((error) => {
      console.warn('[HealthLocal] control-plane bootstrap deferred', error);
    });
}

/**
 * The guard every `local*Api` read/write must call before touching the ledger.
 *
 * Exists so "the session was never opened" throws a NAMED error at the local
 * boundary instead of being served from D1 by the He3 Proxy's catch-and-fall-
 * through-to-remote branch. Plan §1.3 / §5.1: a flag-1 client that reads D1 is
 * the dual-world state, and it is invisible without this.
 */
export function assertHealthLocalSessionOpen(): void {
  if (!isLocalHealthSessionOpen()) {
    throw new HealthLocalNotReadyError();
  }
}

/**
 * Close the local session, and on `wipe` destroy every trace of it.
 *
 * `wipe` is what sign-out passes (plan §1.3, "Sign-out / teardown"): the ledger
 * `.db`, both WAL sidecars, the Health DEK and the `HEALTH_CACHE_KEYS` MMKV
 * mirrors all go. That is deliberately more destructive than the Budget/House
 * siblings, and it is the plan's decision, not an accident — a Health record
 * surviving a sign-out on a shared handset is the leak
 * `privacy-cross-user-leak.yaml` exists to catch.
 *
 * `clearLocalHealthPersistence()` deletes the DEK **and** all three files;
 * calling it after `resetLocalHealthSession()` is safe because both are
 * idempotent (a checkpointed WAL leaves no sidecar behind, and that is the
 * normal case, not an error).
 */
export async function teardownHealthLocalSession(options?: { wipe?: boolean }): Promise<void> {
  stopHealthLedgerRefreshBridge();
  openedForUserId = null;

  // Disarm FIRST, before anything below can throw. A teardown that fails
  // half-way must not leave a client that still claims local-first authority on
  // every `/health` call while holding no open ledger — that combination 410s
  // the whole Health surface with nothing local to serve it from.
  disarmHealthLocalFirstHeader();

  if (options?.wipe) {
    try {
      await resetLocalHealthSession();
    } finally {
      // Runs even if the engine reset threw: leaving ciphertext + DEK behind
      // because a close failed is the one outcome teardown must not have.
      await clearLocalHealthPersistence();
      await clearHealthCaches();
      // He6 blob cache — the FIFTH thing a wipe has to reach, and the only one
      // stored DECRYPTED. `clearLocalHealthPersistence` drops the ledger, its
      // WAL/SHM sidecars and the DEK; none of that touches the plaintext body
      // photos and clinical documents the blob store keeps in `cacheDirectory`
      // so screens can render them. Without this call they outlive all four
      // wipes and the next person on a shared handset opens them with no key
      // at all — exactly the leak `privacy-cross-user-leak.yaml` catches.
      await clearHealthBlobLocalState();
    }
    return;
  }

  if (isLocalHealthSessionOpen()) {
    await closeLocalHealthSession();
  }
}

/**
 * Drop the MMKV/AsyncStorage mirrors the Health screens read.
 *
 * `authStore.clearPersistedStores()` already clears these on sign-out, and this
 * is deliberately a second site rather than a refactor of that one: teardown
 * also runs WITHOUT a sign-out (account switch, wipe-and-reopen, He2 reinstall
 * sweep), and the mirrors hold weight, nutrition, body, cycle and vitality
 * snapshots. Settled independently so one failing key cannot abort the rest.
 */
async function clearHealthCaches(): Promise<void> {
  const results = await Promise.allSettled(
    HEALTH_CACHE_KEYS.map((key) => asyncStorage.removeItem(key)),
  );
  const failures = results.filter((r) => r.status === 'rejected').length;
  if (failures > 0) {
    console.warn(`[HealthLocal] ${failures} cached Health key(s) failed to clear on teardown`);
  }
}

/** Test seam: forget the "already open for this user" memo. */
export function resetHealthLocalSessionGuardForTests(): void {
  openInFlight = null;
  openedForUserId = null;
}
