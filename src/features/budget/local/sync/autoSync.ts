/**
 * What makes Budget sync BY ITSELF.
 *
 * Everything here exists because the sync engine was complete and nothing ever
 * called it. Before this module the full list of triggers was: app launch
 * (`session-open`), a push wake, two enrolment-only pollers, and three buttons.
 * Writing a spending fired NOTHING — `mutateLocalLedger` appended the op to the
 * local log and stopped there — so a member's change sat on their phone until
 * they relaunched the app or tapped "Sync now".
 *
 * That one gap disabled the whole chain, not just the push half. A peer is woken
 * by a mailbox DEPOSIT, and a deposit only happens inside a sync run, so if the
 * author never syncs there is no deposit, no wake, and the other devices have no
 * reason to sync either. Both phones sat idle, each correctly, and the household
 * silently diverged.
 *
 * Four triggers, deliberately overlapping, because each one fails in conditions
 * the others survive:
 *
 *  1. **local write** — the author pushes within a second of writing. This is
 *     the one that matters; the rest are about the receiving side.
 *  2. **peer announce** — `sync_available` over the coordinator socket. The
 *     fastest inbound path, and the one that makes an arrival feel instant, but
 *     it needs a live socket.
 *  3. **push wake** — already wired (`pushWake.ts`). Works when the app is
 *     backgrounded, needs notification permission, and never fires in the
 *     Simulator.
 *  4. **foreground heartbeat + app-foreground** — the safety net for when the
 *     socket is down and the push was dropped. Slow, but it cannot fail
 *     silently the way the other three can.
 *
 * Everything is a no-op without an open local-first session, and the whole
 * module is started and stopped with the session (`ensureSession`).
 */
import { AppState, type AppStateStatus } from 'react-native';

import {
  getActiveBudgetHouseholdId,
  isLocalBudgetSessionOpen,
  listLocalBudgetHouseholds,
  setLocalWriteListener,
  setRemoteApplyListener,
  subscribeToLedgerChanges,
} from '../engine';
import { isBudgetLocalFirst } from '../flag';

import { runBudgetLocalSync, runBudgetLocalSyncFor } from './orchestrator';
import { getSignalingClient } from './signalingClient';
import { useBudgetSyncStatusStore } from './syncStatusStore';

/**
 * How long a local write waits before it is pushed.
 *
 * Not zero, and not long. One gesture is routinely several ops — a receipt
 * import writes a row per line item, `applyGoalToYear` writes twelve, a bulk
 * paste writes one per expense — and syncing per op would open a mailbox round
 * per row. The debounce collapses a burst into one deposit while still being
 * far below the threshold where a person would call it "not immediate".
 *
 * The single-flight gate in `runOne` would merge overlapping runs anyway, but
 * only the ones that overlap in TIME; twenty sequential awaits do not, and would
 * be twenty rounds.
 */
const LOCAL_WRITE_DEBOUNCE_MS = 700;

/**
 * Minimum gap between reacting to two `sync_available` frames for one household.
 *
 * The coordinator fans a frame out to every other device, so a household with
 * three phones turns one announcement into two inbound frames per peer. This
 * collapses the duplicates without adding perceptible delay.
 */
const PEER_ANNOUNCE_THROTTLE_MS = 1_500;

/**
 * The safety-net poll, while the app is in the foreground.
 *
 * Deliberately slow. It is not how a change is supposed to arrive — the socket
 * and the push are — it is what stops "the socket dropped and nobody noticed"
 * from turning into an hour of divergence. Stopped on background so it cannot
 * drain a battery.
 */
const FOREGROUND_POLL_MS = 45_000;

/** Ignore an app-foreground trigger that lands right after another sync. */
const FOREGROUND_THROTTLE_MS = 5_000;

let started = false;
let unsubscribeSignaling: (() => void) | null = null;
let unsubscribeLedger: (() => void) | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastAnnounceReactionAt = new Map<string, number>();
let lastForegroundSyncAt = 0;

/**
 * Every trigger asks this, INCLUDING from inside its own timer callback.
 *
 * `started` is part of it deliberately. `stopBudgetAutoSync` clears the pending
 * timers and releases the engine's listener slot, so in practice nothing should
 * reach a scheduler afterwards — but "should" is doing the work in that
 * sentence, and the cost of being wrong is a sync fired on behalf of an account
 * that has signed out. Making the stopped state a precondition rather than an
 * assumption means a caller holding a stale reference to the write listener
 * cannot resurrect this module.
 */
function canSync(): boolean {
  return started && isBudgetLocalFirst() && isLocalBudgetSessionOpen();
}

/**
 * Push what this device just wrote, once the burst settles.
 *
 * Per household, because two households can be written to in the same second
 * (a transfer screen open on one while a reminder fires on another) and one
 * timer would drop the first household's push on the floor.
 */
function scheduleLocalWritePush(householdId: string): void {
  if (!canSync()) return;
  const existing = writeTimers.get(householdId);
  if (existing) clearTimeout(existing);
  writeTimers.set(
    householdId,
    setTimeout(() => {
      writeTimers.delete(householdId);
      if (!canSync()) return;
      void runBudgetLocalSyncFor(householdId, 'local-write').catch(() => {
        // Offline, most likely. The op is durable and the heartbeat, the next
        // foreground, or the next write will carry it — this must never surface
        // as an error over a save that genuinely succeeded.
      });
    }, LOCAL_WRITE_DEBOUNCE_MS),
  );
}

/**
 * A peer says it has deposited something for us — go and get it.
 *
 * This is the path that makes another member's spending appear on this screen
 * while they are still looking at theirs. It is only as good as the socket
 * underneath it, which is why `keepSignalingConnected` exists: before this the
 * socket was opened at the TAIL of a sync run and for the active household only,
 * so the device most in need of an announcement — an idle one, not syncing —
 * was exactly the one with no socket open to hear it.
 */
function onPeerAnnounce(fromHouseholdId: string | null): void {
  if (!canSync()) return;
  const householdId = fromHouseholdId ?? getActiveBudgetHouseholdId();
  if (!householdId) return;
  const now = Date.now();
  const last = lastAnnounceReactionAt.get(householdId) ?? 0;
  if (now - last < PEER_ANNOUNCE_THROTTLE_MS) return;
  lastAnnounceReactionAt.set(householdId, now);
  void runBudgetLocalSyncFor(householdId, 'peer-announce').catch(() => {
    /* the heartbeat retries */
  });
}

/**
 * Hold the coordinator socket open for the household on screen.
 *
 * `connect()` reuses a live socket and refuses any household that is not the
 * active one, so calling it on every ledger change is cheap and is what
 * re-establishes the socket after a household switch. A dropped socket is
 * re-opened by the heartbeat's own call rather than by a reconnect loop here —
 * one timer is enough, and `connect()` is idempotent.
 */
function keepSignalingConnected(): void {
  if (!canSync()) return;
  try {
    getSignalingClient().connect();
  } catch (error) {
    // Signaling is the fast path, never the only one. Mailbox sync is unaffected.
    console.warn('[budget.local] signaling connect skipped', error);
  }
}

function onAppStateChange(next: AppStateStatus): void {
  if (next !== 'active') {
    stopHeartbeat();
    return;
  }
  startHeartbeat();
  keepSignalingConnected();
  if (!canSync()) return;
  const now = Date.now();
  if (now - lastForegroundSyncAt < FOREGROUND_THROTTLE_MS) return;
  lastForegroundSyncAt = now;
  void runBudgetLocalSync('app-foreground').catch(() => undefined);
}

function startHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    if (!canSync()) return;
    // Re-asserted every tick rather than only on foreground: a socket that dies
    // mid-session (a network change, a Worker restart) has nothing else to
    // notice it, and `connect()` returns immediately when one is already live.
    keepSignalingConnected();
    // Nothing to sync against is the common case on a solo device, and
    // `syncOneHousehold` returns before doing any work for a household that is
    // not on the control plane — so this costs one cheap check per household.
    if (listLocalBudgetHouseholds().length === 0) return;
    lastForegroundSyncAt = Date.now();
    void runBudgetLocalSync('heartbeat').catch(() => undefined);
  }, FOREGROUND_POLL_MS);
}

function stopHeartbeat(): void {
  if (!heartbeat) return;
  clearInterval(heartbeat);
  heartbeat = null;
}

/** Idempotent — safe to call on every session open. */
export function startBudgetAutoSync(): void {
  if (started) return;
  if (!isBudgetLocalFirst()) return;
  started = true;

  setLocalWriteListener(scheduleLocalWritePush);

  // The live record counter. Gated on the ACTIVE household for the same reason
  // every other status writer is: a background household merging four hundred
  // rows must not make the foreground screen claim it just received them.
  setRemoteApplyListener((householdId, rows) => {
    if (householdId !== getActiveBudgetHouseholdId()) return;
    useBudgetSyncStatusStore.getState().addRecords(rows);
  });

  unsubscribeSignaling = getSignalingClient().onEvent((event) => {
    if (event.type !== 'sync_available') return;
    // The socket is bound to one household, and it is the one that announced.
    onPeerAnnounce(getSignalingClient().householdId);
  });

  // A switch makes a different household active, which means a different
  // signaling room. `connect()` refuses a non-active household, so this is what
  // moves the socket across.
  unsubscribeLedger = subscribeToLedgerChanges(() => {
    keepSignalingConnected();
  });

  appStateSubscription = AppState.addEventListener('change', onAppStateChange);

  // The app is by definition in the foreground when a session opens.
  startHeartbeat();
  keepSignalingConnected();
}

export function stopBudgetAutoSync(): void {
  if (!started) return;
  started = false;
  setLocalWriteListener(null);
  setRemoteApplyListener(null);
  unsubscribeSignaling?.();
  unsubscribeSignaling = null;
  unsubscribeLedger?.();
  unsubscribeLedger = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
  stopHeartbeat();
  for (const timer of writeTimers.values()) clearTimeout(timer);
  writeTimers.clear();
  lastAnnounceReactionAt.clear();
  lastForegroundSyncAt = 0;
}
