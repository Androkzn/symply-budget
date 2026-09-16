/**
 * When a blob reconcile actually runs (plan §8, stage He6).
 *
 * ── THE DRIFT THIS CLOSES ───────────────────────────────────────────────────
 *
 * `reconcileHealthBlobs` existed with no caller. A row deleted on THIS device
 * takes `deleteHealthBlob` with it, so that half was covered; a row deleted on
 * the user's OTHER device arrives as an op, and nothing on this side ever heard
 * about the bytes it pointed at. The encrypted object stayed on the relay as an
 * orphan, and — worse on this surface — the DECRYPTED plaintext stayed in
 * `cacheDirectory` indefinitely, for a photo the member has already deleted.
 *
 * ── WHY A SCHEDULER AND NOT A CALL ──────────────────────────────────────────
 *
 * The reconcile enumerates three directories and walks the whole projection.
 * Running it per applied op would put a filesystem scan behind every inbound
 * delta, and a catch-up sync applies them in the hundreds. So the sync seam
 * ASKS for a pass and this module decides whether one happens:
 *
 *  - **Debounced** to one pass per {@link HEALTH_BLOB_RECONCILE_MIN_INTERVAL_MS}.
 *    Orphaned bytes are not urgent — nothing renders them and the relay's own
 *    sweep is the backstop — so trading promptness for a bounded number of
 *    scans is the right way round.
 *  - **Single-flight.** A second ask while a pass is running joins it rather
 *    than starting a concurrent walk over the same directories.
 *  - **Never throws.** Callers are fire-and-forget sites at the end of a sync
 *    round; a failed tidy-up must not fail the sync that succeeded.
 *
 * The clock is advanced BEFORE the pass rather than after: a pass that throws
 * every time must not turn into a scan on every sync.
 *
 * ── `releaseRemote` IS OFF, AND STAYS OFF ───────────────────────────────────
 *
 * This module never passes it, and the omission is the point rather than an
 * oversight. This device's view of the ledger is only as complete as its last
 * sync, so a device that has not caught up would tombstone attachments for rows
 * it simply has not received yet — deleting live bytes belonging to the user's
 * other device. Dropping LOCAL copies is always safe (they are a cache, and the
 * bytes are re-fetchable); releasing the remote object is not, and it stays a
 * deliberate call by a caller that knows the ledger is current.
 */
import {
  reconcileHealthBlobs,
  type HealthBlobReconciliation,
} from './healthBlobStore';

/**
 * Minimum gap between two passes.
 *
 * Fifteen minutes is well inside a foreground session (so a member who deletes
 * a photo on their tablet sees the phone's copy dropped the same sitting) and
 * far above the rate at which sync rounds land, which is what makes it a
 * debounce rather than a delay.
 */
export const HEALTH_BLOB_RECONCILE_MIN_INTERVAL_MS = 15 * 60 * 1000;

/** Why a pass was asked for. Logged, never sent anywhere. */
export type HealthBlobReconcileReason = 'sync' | 'manual';

let lastReconcileAt = 0;
let inFlight: Promise<HealthBlobReconciliation | null> | null = null;

/**
 * Ask for a reconcile pass. Resolves to the reconciliation, or to `null` when
 * the ask was debounced away or the pass failed.
 *
 * `force` skips the debounce (not the single-flight): it is for a member-
 * initiated action such as a Settings "free up space" tap, never for the sync
 * seam.
 */
export function scheduleHealthBlobReconcile(
  options: { reason?: HealthBlobReconcileReason; force?: boolean } = {},
): Promise<HealthBlobReconciliation | null> {
  if (inFlight) return inFlight;

  const now = Date.now();
  if (!options.force && now - lastReconcileAt < HEALTH_BLOB_RECONCILE_MIN_INTERVAL_MS) {
    return Promise.resolve(null);
  }
  lastReconcileAt = now;

  const run = runReconcilePass(options.reason ?? 'sync');
  inFlight = run;
  // Cleared AFTER `inFlight` is assigned. A `finally` inside the pass itself
  // races that assignment: a pass that settled before the line above would
  // leave a resolved promise parked in `inFlight` forever, and every later ask
  // would join a pass that had already finished.
  void run.finally(() => {
    inFlight = null;
  });
  return run;
}

async function runReconcilePass(
  reason: HealthBlobReconcileReason,
): Promise<HealthBlobReconciliation | null> {
  try {
    // No `releaseRemote` — see the file header. The default is the contract.
    const result = await reconcileHealthBlobs();
    // Counts only: a blob id is a keyed content address, and this line reaches
    // logs (plan Appendix C.1).
    console.log(
      `[HealthLocal] blob reconcile reason=${reason} ` +
        `referenced=${result.referenced.length} cacheEvicted=${result.cacheEvicted.length} ` +
        `stagingCleared=${result.stagingCleared.length} notCached=${result.notCached.length}`,
    );
    return result;
  } catch (error) {
    // No session, a filesystem that refused, a relay that is down: the next
    // pass retries. A tidy-up must never fail the sync that scheduled it.
    console.warn('[HealthLocal] blob reconcile skipped', error);
    return null;
  }
}

/** Test helper — forget the debounce window and any in-flight pass. */
export function resetHealthBlobReconcileScheduleForTests(): void {
  lastReconcileAt = 0;
  inFlight = null;
}
