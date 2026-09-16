/**
 * Foreground / on-open sync for Budget (BR-016 B3).
 *
 * EVERY HOUSEHOLD, INDEPENDENTLY
 * ------------------------------
 * `runBudgetLocalSync()` fans out over every household this device holds. Each
 * run is bound to a `BudgetSessionHandle` rather than to "whatever is active",
 * because the active-session accessors (`getLocalLedger`, `getLocalOpLog`,
 * `getLocalHouseholdKeys`) would seal household B's ops under A's HDK and
 * address them to A's peers — correctly encrypted, wrong household, invisible
 * until the two diverge. Single-flight is keyed per household so one unreachable
 * household cannot block the others (plan §2 hazard 7), and `Promise.allSettled`
 * means one failure does not abort the fan-out.
 *
 * Ordering within a household is load-bearing and inherited unchanged:
 *   1. control-plane state — who the peers are, and their public keys
 *   2. enrolment — accept an HDK wrap if this device was just approved
 *   3. RE-READ the handle, because step 2 swaps both the household keys and the
 *      OpLog instance; values captured earlier would seal this run's batches
 *      under the pre-join key and every op from the household would be rejected
 *      until the next sync
 *   4. checkpoint bootstrap / catch-up
 *   5. the mailbox round itself
 *   6. publish + compact
 *
 * Every household takes the mailbox path; only the ACTIVE one is offered the
 * opportunistic WebRTC upgrade — see `maybeSyncOverWebRtc` for why one
 * module-global signaling socket cannot represent N households.
 */
import { AppState } from 'react-native';

import { recordE2EPersistEntry } from '@api/e2eTestObservability';
import { useAuthStore } from '@stores/authStore';
import {
  CATCH_UP_OPS_THRESHOLD,
  CATCH_UP_STALE_MS,
  MailboxSyncEngine,
  PeerSyncSession,
  hexToBytes,
  lagOps,
  type DeviceId,
} from '@symply/local-first';

import {
  budgetHouseholdIsOnControlPlane,
  fetchControlPlaneState,
  syncLocalHouseholdToControlPlane,
} from '../controlPlaneClient';
import {
  getActiveBudgetHouseholdId,
  getLocalBudgetSession,
  getLocalConflictsFor,
  isHouseholdBootstrapPending,
  isLocalBudgetSessionOpen,
  listLocalBudgetHouseholds,
  noteRemoteOpsApplied,
  withLedgerBatch,
  type BudgetSessionHandle,
} from '../engine';
import { isBudgetLocalFirst } from '../flag';
import { publishBudgetRoster } from '../householdRoster';
import { purgeRevokedBudgetHouseholds } from '../membershipWatch';
import { syncBudgetLocalReminders } from '../reminders/budgetLocalReminders';

import {
  maybeCompactAfterSync,
  maybePublishCheckpoint,
  runHouseholdBackfill,
  tryInstallLatestCheckpoint,
} from './checkpoints';
import { HttpControlPlaneClient } from './httpControlPlane';
import { refreshBudgetLedgerNow } from './ledgerRefresh';
import { getSignalingClient } from './signalingClient';
import { classifySyncError } from './syncErrors';
import {
  useBudgetSyncStatusStore,
  type BudgetSyncStatus,
  type SyncPhase,
  type SyncStage,
} from './syncStatusStore';
import { WebRtcPeerTransport } from './webrtcPeer';

/**
 * Single-flight PER HOUSEHOLD, not globally. A single global promise meant one
 * slow or unreachable household blocked every other household's sync — and it
 * silently swallowed the second household's run, because the caller was handed
 * the first one's promise and believed it had synced.
 */
const syncInFlight = new Map<string, Promise<void>>();

/**
 * When each household last completed a mailbox round, in this process.
 *
 * The status store holds ONE `lastSyncedAt` — the foreground household's — so
 * using it for the catch-up staleness heuristic would compare household A's
 * clock against household B's lag and never fire for a background household.
 * As durable as the store itself (both are in-memory and start empty on a cold
 * launch), which is all the heuristic needs: a bootstrap is decided by the
 * version vector, not by this.
 */
const lastSyncedAtByHousehold = new Map<string, number>();

type PeerContext = {
  state: Awaited<ReturnType<typeof fetchControlPlaneState>>;
  peerDeviceIds: DeviceId[];
  pubMap: Map<string, Uint8Array>;
};

/**
 * Which triggers are a PERSON asking, and which are the app deciding.
 *
 * Printed as `source=user` / `source=auto` beside the trigger name so a log can
 * be filtered down to "what happened when they tapped the button" without
 * knowing which of the seven call sites is which. It matters because the two
 * classes fail differently and are reported differently: an automatic run that
 * finds nothing is correct and silent, while a tap that finds nothing owes the
 * member an explanation on screen. Chasing "sync does nothing" meant reading a
 * log where a background poll and a deliberate tap were indistinguishable.
 */
const USER_TRIGGERS = new Set(['sync-now-button', 'after-join', 'history-repair']);
const triggerSource = (trigger: string): 'user' | 'auto' =>
  USER_TRIGGERS.has(trigger) ? 'user' : 'auto';

/**
 * The status-store writers, already gated on the household being active. Passed
 * down rather than re-derived, so no helper can reach for the raw store and
 * report a background household's result onto the foreground banner.
 */
type StatusWriters = {
  setPhase: (phase: SyncPhase) => void;
  setStage: (stage: SyncStage) => void;
  setSnapshotProgress: (progress: { done: number; total: number } | null) => void;
  setResult: (patch: Partial<BudgetSyncStatus>) => void;
};

function readPeers(
  state: Awaited<ReturnType<typeof fetchControlPlaneState>>,
  ownDeviceId: string,
  pubMap: Map<string, Uint8Array>,
): DeviceId[] {
  for (const device of state.devices) {
    if (device.signingPublicKey) {
      pubMap.set(device.deviceId, hexToBytes(device.signingPublicKey));
    }
  }
  return state.devices
    .filter((d) => d.status === 'active' && d.deviceId !== ownDeviceId)
    .map((d) => d.deviceId);
}

/** "3m", "2h", "5d" — how stale a `lastSeenAt` stamp is, or null if never set. */
function agoLabel(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'unknown';
  if (ms < 0) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Who else is in this household, and when the server last heard from them.
 *
 * "Is anyone else online?" is the first question anybody asks when a change
 * does not appear on the other phone, and nothing in the log answered it. The
 * status store's `peersOnline` is a misnomer — it counts peers this device
 * KNOWS of, not peers that are reachable — so a household whose other phone has
 * been in a drawer for a week reported the same number as one syncing live.
 *
 * `lastSeenAt` is stamped server-side by each device's own sync poll, so it is
 * the closest thing to a liveness signal that exists without a socket. Absent
 * on records enrolled before liveness tracking, which reads as "never" here and
 * must not be mistaken for "offline".
 *
 * Devices and members both, because they answer different questions: a member
 * with no active device has been invited but has never enrolled, which looks
 * identical to "not in the household" from the device list alone. Revoked
 * devices are counted, not listed — they explain a key epoch, not a sync.
 */
function logHouseholdPresence(
  householdId: string,
  state: Awaited<ReturnType<typeof fetchControlPlaneState>>,
  ownDeviceId: string,
): void {
  try {
    const revoked = state.devices.filter((d) => d.status !== 'active').length;
    const rows = state.devices
      .filter((d) => d.status === 'active')
      .map((d) => {
        const who = d.label?.trim() || d.displayName?.trim() || 'unnamed';
        const self = d.deviceId === ownDeviceId ? ' SELF' : '';
        return `${d.deviceId}(${who}, seen ${agoLabel(d.lastSeenAt)})${self}`;
      });
    console.log(
      `[BudgetLocal] sync/household hh=${householdId} epoch=${state.keyEpoch} members=${state.members.length} activeDevices=${rows.length} revokedDevices=${revoked}`,
    );
    console.log(`[BudgetLocal] sync/peers hh=${householdId} ${rows.join(' | ') || '(none)'}`);
    const strangers = state.members.filter(
      (m) => m.status === 'active' && !state.devices.some((d) => d.userId === m.userId && d.status === 'active'),
    );
    for (const member of strangers) {
      console.log(
        `[BudgetLocal] sync/member-no-device hh=${householdId} ${member.displayName ?? member.email ?? member.userId} is a member but has no active device — they cannot send or receive anything`,
      );
    }
  } catch (error) {
    // Presence is a diagnostic. It must never be the reason a sync fails.
    console.warn('[BudgetLocal] presence log skipped', householdId, error);
  }
}

/**
 * One control-plane answer, read for both things it carries.
 *
 * The device keys are what this sync needs; the member profiles are what every
 * screen that names a peer needs (`householdRoster`). Publishing here rather
 * than on a timer is what makes a rename or a new avatar show up across the
 * household on the next sync — the trip is already being made, so a fresh roster
 * costs nothing extra.
 *
 * A 403 means the control plane does not yet know this device — the usual cause
 * is a fresh install whose registration has not landed. Register once and retry;
 * anything else is treated as offline rather than as a hard failure.
 */
async function resolvePeers(
  householdId: string,
  ownDeviceId: string,
  assertCurrentSession: () => void,
): Promise<PeerContext | null> {
  const pubMap = new Map<string, Uint8Array>();
  const absorb = (state: Awaited<ReturnType<typeof fetchControlPlaneState>>): PeerContext => {
    assertCurrentSession();
    // The roster is a single-household surface — `householdStore` holds ONE
    // member list — so only the active household publishes into it. A
    // background household would blank the names on the screen the member is
    // actually looking at. `publishBudgetRoster` has a cross-household guard of
    // its own, but that one needs `state.householdId` to come back populated;
    // this one does not.
    if (getActiveBudgetHouseholdId() === householdId) {
      try {
        publishBudgetRoster(state);
        useBudgetSyncStatusStore.getState().setResult({
          membershipConfirmed: state.devices.some(d => d.deviceId === ownDeviceId && d.status === 'active' && state.members.some(m => m.userId === d.userId && m.status === 'active')),
          recentlyActivePeers: state.devices.filter(d => d.status === 'active' && d.deviceId !== ownDeviceId &&
            d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < 90_000).length,
        });
      } catch (error) {
        // A roster is a display concern; it must never fail a sync.
        console.warn('[BudgetLocal] roster publish skipped', error);
      }
    }
    logHouseholdPresence(householdId, state, ownDeviceId);
    return { state, peerDeviceIds: readPeers(state, ownDeviceId, pubMap), pubMap };
  };

  try {
    return absorb(await fetchControlPlaneState(householdId));
  } catch (error) {
    const httpStatus =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { status?: number } }).response?.status
        : undefined;
    // A household that reports "offline" while the phone plainly is not is the
    // other way this fails silently — 403 (not a member / device revoked) and a
    // real network error land on the same banner and must not read the same in
    // the log.
    console.warn(
      `[BudgetLocal] sync/peers hh=${householdId} control plane refused status=${httpStatus ?? 'network'}`,
    );
    if (httpStatus !== 403) return null;
    try {
      // Registers THE HOUSEHOLD THAT 403'd, not whichever one is active.
      //
      // This used to call `syncLocalHouseholdToControlPlane()` with no argument,
      // back when the resolver read the active ledger and single-flighted
      // globally (plan §2 hazard 8). The consequence was that a BACKGROUND
      // household's 403 re-registered the foreground household instead — so the
      // one that actually needed recovering stayed unregistered and reported
      // offline until the member happened to switch into it, while the
      // foreground household paid for a POST it did not need. The resolver takes
      // a household id and keys its in-flight promise by it now, so the fix the
      // old comment here asked for is simply to pass the id.
      await syncLocalHouseholdToControlPlane(householdId);
      return absorb(await fetchControlPlaneState(householdId));
    } catch {
      return null;
    }
  }
}

/**
 * Sync every household this device holds, concurrently, without letting one
 * failure stop the rest.
 */
export async function runBudgetLocalSync(trigger = 'unknown'): Promise<void> {
  // Both preconditions logged, because a run that never starts is exactly what
  // "the sync button does nothing" looks like from the outside. Silence here
  // was indistinguishable from a sync that ran and found nothing.
  if (!isBudgetLocalFirst() || !isLocalBudgetSessionOpen()) {
    console.warn(
      `[BudgetLocal] sync/start trigger=${trigger} source=${triggerSource(trigger)} REFUSED — localFirst=${isBudgetLocalFirst()} sessionOpen=${isLocalBudgetSessionOpen()}`,
    );
    return;
  }
  // BEFORE the fan-out, not after: a household this account has been removed
  // from is not a household to sync. Syncing it first would spend a round on
  // rows that are about to be erased and — worse — walk into `resolvePeers`'s
  // 403 recovery, which answers a refusal by re-registering the very household
  // the control plane has just refused. This is also the ONLY recurring trigger
  // the removed device has: the push that announces a removal is best-effort,
  // and the member who LEFT from their other phone is deliberately sent none at
  // all. Throttled inside, and it never throws.
  const accountId = useAuthStore.getState().user?.id;
  await purgeRevokedBudgetHouseholds(trigger);
  if (!isLocalBudgetSessionOpen() || useAuthStore.getState().user?.id !== accountId) return;
  const households = listLocalBudgetHouseholds();
  console.log(
    `[BudgetLocal] sync/start trigger=${trigger} source=${triggerSource(trigger)} households=${households.length} [${households
      .map((h) => h.householdId)
      .join(',')}] active=${getActiveBudgetHouseholdId() ?? 'none'}`,
  );
  const startedAt = Date.now();
  try {
    await Promise.allSettled(households.map((household) => runOne(household.householdId)));
  } finally {
    console.log(
      `[BudgetLocal] sync/done trigger=${trigger} source=${triggerSource(trigger)} households=${households.length} in ${Date.now() - startedAt}ms`,
    );
    refreshReminders();
  }
}

/** Sync ONE household — the push-wake and switcher entry point. */
export async function runBudgetLocalSyncFor(
  householdId: string,
  trigger = 'unknown',
): Promise<void> {
  if (!isBudgetLocalFirst() || !isLocalBudgetSessionOpen()) {
    console.warn(
      `[BudgetLocal] sync/start trigger=${trigger} source=${triggerSource(trigger)} hh=${householdId} REFUSED — localFirst=${isBudgetLocalFirst()} sessionOpen=${isLocalBudgetSessionOpen()}`,
    );
    return;
  }
  console.log(`[BudgetLocal] sync/start trigger=${trigger} source=${triggerSource(trigger)} hh=${householdId}`);
  const startedAt = Date.now();
  try {
    await runOne(householdId);
  } finally {
    console.log(
      `[BudgetLocal] sync/done trigger=${trigger} source=${triggerSource(trigger)} hh=${householdId} in ${Date.now() - startedAt}ms`,
    );
    refreshReminders();
  }
}

/**
 * The single-flight gate, shared by both entry points so a UI-triggered sync of
 * one household joins the fan-out's run for it instead of duplicating it.
 */
function runOne(householdId: string): Promise<void> {
  const key = `${useAuthStore.getState().user?.id ?? 'signed-out'}:${householdId}`;
  const existing = syncInFlight.get(key);
  if (existing) {
    // Joining, not duplicating — correct, and worth saying. A tap that lands on
    // an in-flight run returns when THAT run finishes, which can look like a
    // button that responded instantly and did nothing.
    console.log(`[BudgetLocal] sync/join hh=${householdId} — a run is already in flight`);
    return existing;
  }

  const run = syncOneHousehold(householdId).finally(() => {
    syncInFlight.delete(key);
  });
  syncInFlight.set(key, run);
  return run;
}

/**
 * A peer's ops just landed, so the horizon this device scheduled reminders from
 * is stale — top it up.
 *
 * Once per INVOCATION, not once per household: the reminders pass cancels Budget
 * notifications by prefix and reschedules wholesale, so N concurrent passes do
 * the same work N times and interleave over the notification centre for nothing.
 * Best-effort and fired from a `finally`, because a household that failed to
 * sync still has reminders that need to stay scheduled.
 */
function refreshReminders(): void {
  void syncBudgetLocalReminders();
}

async function syncOneHousehold(householdId: string): Promise<void> {
  // The status store is a single-household surface: only the ACTIVE household
  // drives the banner, so a background household that fails does not paint an
  // error over a screen that is working fine.
  const accountId = useAuthStore.getState().user?.id;
  const isCurrentAccount = () => isLocalBudgetSessionOpen() &&
    useAuthStore.getState().isAuthenticated && useAuthStore.getState().user?.id === accountId;
  const assertCurrentAccount = () => {
    if (!isCurrentAccount()) throw new Error('Sync cancelled: account session changed');
  };
  if (!accountId || !isCurrentAccount()) return;
  const isActive = getActiveBudgetHouseholdId() === householdId;
  const status = useBudgetSyncStatusStore.getState();
  const setPhase: StatusWriters['setPhase'] = (phase) => {
    if (isCurrentAccount() && getActiveBudgetHouseholdId() === householdId) status.setPhase(phase);
  };
  const setStage: StatusWriters['setStage'] = (stage) => {
    if (isCurrentAccount() && getActiveBudgetHouseholdId() === householdId) status.setStage(stage);
  };
  const setSnapshotProgress: StatusWriters['setSnapshotProgress'] = (progress) => {
    if (isCurrentAccount() && getActiveBudgetHouseholdId() === householdId) status.setSnapshotProgress(progress);
  };
  const setResult: StatusWriters['setResult'] = (patch) => {
    if (isCurrentAccount() && getActiveBudgetHouseholdId() === householdId) status.setResult(patch);
  };

  // A household nobody else can reach has nothing to sync: no peers to poll, no
  // mailbox to drain, and no checkpoint worth uploading — the server cannot
  // decrypt one and the key that could never leaves this device. Skipping is not
  // an optimisation. It is what keeps a solo ledger OFF the control plane: the
  // 403 recovery inside `resolvePeers` would otherwise re-create, on the next
  // tick, exactly the household row that is not supposed to exist.
  if (!(await budgetHouseholdIsOnControlPlane(householdId))) {
    // THE "sync button does nothing" case, said out loud.
    //
    // For a genuinely solo household this is correct and there is nothing to
    // do. But the check is also false when the device is OFFLINE
    // (`budgetHouseholdIsOnControlPlane` catches and returns false) and when
    // the registration marker was never written — and in those two cases a
    // shared household silently skips its entire sync. Same return, same
    // silence, three completely different situations.
    console.log(
      `[BudgetLocal] sync/skip hh=${householdId} — not on the control plane. Either solo (nothing to sync), offline, or the registration marker is missing.`,
    );
    setPhase('idle');
    setStage('idle');
    return;
  }

  console.log(`[BudgetLocal] sync/begin hh=${householdId} active=${isActive}`);
  setPhase('syncing');
  setStage('connecting');
  // A fresh window for the live record counter. "1,203 records" is meaningless
  // without one, and the window a member cares about is the sync in front of
  // them — not everything since the app launched.
  if (isCurrentAccount() && getActiveBudgetHouseholdId() === householdId) status.resetRecords();
  setResult({ lastError: null, backfilling: await isHouseholdBootstrapPending(householdId) });

  // EVERY ledger notification this run produces is held until it finishes.
  //
  // Without this the screen repaints once per merged op — `ledgerRefresh` bumps
  // four stores and invalidates the whole query cache per event — so a member
  // watching a join sees hundreds of partial states flash past: totals that
  // climb, months that appear half-populated, charts that redraw against a
  // ledger mid-merge. The batch turns that into one repaint, at the end, off a
  // ledger that is whole. The `finally` inside `withLedgerBatch` releases it
  // even when the run throws, so a failed sync still shows whatever landed.
  try {
    await withLedgerBatch(householdId, async () => {
      let session: BudgetSessionHandle = await getLocalBudgetSession(householdId);

      assertCurrentAccount();
      if (session.ledger.memberId !== accountId) throw new Error('Sync account does not own this local session');
      const peers = await resolvePeers(householdId, session.ledger.deviceId, assertCurrentAccount);
      if (!peers) {
        setResult({ phase: 'offline', lastError: 'control_plane_unreachable' });
        setStage('idle');
        return;
      }
      assertCurrentAccount();
      const { peerDeviceIds, pubMap } = peers;
      pubMap.set(session.identity.deviceId, session.identity.signingPublicKey);

      // Enrolment: accept the HDK wrap if this device was just approved. Scoped,
      // so a wrap for a household in the background installs into THAT household
      // rather than into whichever one the member happens to be looking at.
      if (session.awaitingEnrolment) setStage('enrolling');
      try {
        const { tryAcceptHdkFromMailbox } = await import('./hdkTransfer');
        await tryAcceptHdkFromMailbox(householdId);
      } catch {
        /* best effort — the next sync retries */
      }

      // Read the keys AFTER enrolment, never before: installing the HDK swaps both
      // the household keys and the OpLog instance, so the handle has to be
      // re-read. A handle captured earlier would seal/open this run's batches
      // under the pre-join key and every op from the household would be rejected
      // until the next sync.
      assertCurrentAccount();
      session = await getLocalBudgetSession(householdId);
      const { householdKeys, retiredHouseholdKeys, opLog, store, identity } = session;

      // The key ring this run can read with, by EPOCH ONLY — never the bytes.
      // Printed on every sync because it is the first thing to check when a
      // household applies nothing: a device holding one epoch against a household
      // that has rotated can only read the slice written since the last rotation.
      const ringEpochs = [...retiredHouseholdKeys.keys()].sort((a, b) => a - b);
      console.log(
        `[BudgetLocal] sync/keys hh=${householdId} epoch=${householdKeys.keyEpoch} ring=[${ringEpochs.join(',')}] awaitingEnrolment=${session.awaitingEnrolment}`,
      );

      if (session.awaitingEnrolment) {
        // Said out loud rather than inferred from the absence of everything else.
        // A device stuck here syncs forever, applies nothing, and looks identical
        // to one that is simply up to date.
        console.log(
          `[BudgetLocal] sync/enrolment hh=${householdId} still waiting for the household key — nothing can be read or written yet`,
        );
        const { requestRecoveryWake } = await import('./recoveryWake');
        await requestRecoveryWake(householdId);
        assertCurrentAccount();
        setPhase('idle');
        setStage('enrolling');
        setResult({ backfilling: true, lastError: null, lastErrorCode: null });
        return;
      }

      let checkpointError: unknown = null;
      if (!session.awaitingEnrolment) {
        try {
          const ours = await store.getVersionVector(householdKeys.householdId);
          // A JOINED household still owed its history, or a device that has never
          // stored an op for this household. The first test is a durable marker
          // and the second is the legacy inference it replaces — both are kept,
          // because devices that joined before the marker shipped have a non-empty
          // vector and no marker, and the vector test is the only thing that still
          // catches a genuinely fresh one.
          //
          // The retry is the fix. The old code made ONE attempt, gated on the
          // vector being empty, which stops being true the moment a single live
          // op is applied — and the owner publishes the snapshot and hands over
          // the household key as two independent steps, so a joiner that gets the
          // key first, finds no checkpoint, and then merges one op has lost its
          // only chance at every month that predates the join.
          const owedBackfill = await isHouseholdBootstrapPending(householdId);
          if (owedBackfill || Object.keys(ours).length === 0) {
            setStage('downloading');
            const outcome = await runHouseholdBackfill(householdId, {
              onProgress: (done, total) => setSnapshotProgress({ done, total }),
              onApplying: () => setStage('applying'),
              onApplied: () => refreshBudgetLedgerNow(householdId),
            });
            setSnapshotProgress(null);
            setResult({ backfilling: await isHouseholdBootstrapPending(householdId) });
            if (outcome === 'not-needed' && Object.keys(ours).length === 0) {
              // No marker (a pre-marker join, or a device that simply has no ops
              // yet) — take the single legacy attempt so behaviour is unchanged
              // for households this feature is not about.
              const installed = await tryInstallLatestCheckpoint('bootstrap', householdId, {
                onProgress: (done, total) => setSnapshotProgress({ done, total }),
              onApplying: () => setStage('applying'),
              onApplied: () => refreshBudgetLedgerNow(householdId),
              });
              setSnapshotProgress(null);
              console.log(
                `[BudgetLocal] sync/bootstrap hh=${householdId} installed=${installed} (version vector empty)`,
              );
            } else {
              console.log(`[BudgetLocal] sync/bootstrap hh=${householdId} outcome=${outcome}`);
            }
          } else {
            let maxLag = 0;
            for (const peerId of peerDeviceIds) {
              const peerState = await store.getSyncPeerState(householdKeys.householdId, peerId);
              if (peerState) maxLag = Math.max(maxLag, lagOps(ours, peerState.knownVv));
            }
            const lastSyncedAt = lastSyncedAtByHousehold.get(householdId) ?? null;
            const stale =
              maxLag > 0 && lastSyncedAt != null && Date.now() - lastSyncedAt >= CATCH_UP_STALE_MS;
            // Why this device is NOT bootstrapping. The common answer — "its
            // vector is not empty" — is the one that matters: it means the
            // bootstrap window is gone and only ops can fill this ledger now.
            console.log(
              `[BudgetLocal] sync/bootstrap hh=${householdId} skipped — vector holds ${Object.keys(ours).length} author(s), maxLag=${maxLag} stale=${stale}`,
            );
            if (maxLag >= CATCH_UP_OPS_THRESHOLD || stale) {
              const installed = await tryInstallLatestCheckpoint('catch-up', householdId);
              console.log(
                `[BudgetLocal] sync/catch-up hh=${householdId} installed=${installed} maxLag=${maxLag}`,
              );
            }
          }
        } catch (error) {
          checkpointError = error;
          console.warn('[BudgetLocal] checkpoint install FAILED', householdId, error);
        }
      }

      const control = new HttpControlPlaneClient(householdId, assertCurrentAccount);
      const mailbox = new MailboxSyncEngine({
        store,
        opLog,
        householdKeys,
        // Read-side key ring. A peer that rotated while this device was away —
        // or a peer still draining a backlog deposited before the rotation —
        // sends batches sealed under an epoch that is no longer current, and
        // without the ring every one of them is refused and left on the relay.
        retiredHdks: retiredHouseholdKeys,
        deviceId: identity.deviceId,
        signingPublicKey: identity.signingPublicKey,
        control,
        peerDeviceIds: peerDeviceIds.length > 0 ? peerDeviceIds : undefined,
        resolveSenderPublicKey: (deviceId) => pubMap.get(deviceId) ?? null,
      });

      // A version vector, not the log. The old code materialized every
      // StoredOperation (payload + signature Uint8Arrays) twice per sync and
      // diffed them in JS purely to count what arrived — 17,750 rows at the
      // 5-year reference, on Hermes, for a number the engine already returns.
      setStage('applying');
      const beforeVv = await store.getVersionVector(householdKeys.householdId);
      const result = await mailbox.syncOnce();
      assertCurrentAccount();
      let appliedFromPeers = 0;
      if (result.applied > 0) {
        const fresh = await store.listOperationsSince(householdKeys.householdId, beforeVv);
        appliedFromPeers = fresh.length;
        if (fresh.length > 0) {
          // The OpLog projection handler already merged these into THIS
          // household's ledger inside applyRemote(); this persists the merged
          // snapshot. The household id is not decoration: without it this drains
          // the ACTIVE session's deltas and writes B's rows into A.
          await noteRemoteOpsApplied(fresh, householdId);
        }
      }

      const incomplete = checkpointError != null || result.rejected > 0 || result.deferredBlobs > 0 ||
        await isHouseholdBootstrapPending(householdId);
      if (!incomplete) lastSyncedAtByHousehold.set(householdId, Date.now());
      const conflictCount = getLocalConflictsFor(householdId).length;
      setResult({
        // What genuinely still has to leave this device — not the size of the
        // log, which is why the UI used to claim thousands of pending items.
        pendingOutbound: await mailbox.pendingOutboundCount(),
        lastTransport: 'mailbox',
        ...(!incomplete ? { lastSyncedAt: Date.now() } : {}),
        lastAppliedFromPeers: appliedFromPeers,
        peersOnline: peerDeviceIds.length,
        conflicts: conflictCount,
      });
      // Diagnostics, and NOTHING they do may fail the sync.
      //
      // This block is inside the try that decides the household's phase, so a
      // throw in here does not report a logging bug — it reports the household as
      // BROKEN. That is not hypothetical: reading `result.rejectedReasons`
      // unguarded threw `Cannot convert undefined or null to object` against a
      // result shape that predates the field, and a healthy household came out of
      // `syncOneHousehold` as phase 'error' with the WebRTC upgrade skipped. A
      // sync that worked, reported as a sync that failed, because of a log line.
      //
      // So: every field is read defensively, and the whole block is wrapped. The
      // wrapper is the part that matters — it means the next field added here
      // cannot reintroduce this, whatever shape the caller passes.
      try {
        // `rejected` on its own was the number that hid the epoch bug for nine
        // days: "applied=0" with no way to tell an idle household from one
        // refusing every op it is handed. The breakdown names the reason, and
        // `deferredBlobs` says how many deposits were LEFT on the relay because
        // of it — a count that stays above zero forever is a wedged mailbox, not
        // a quiet one.
        const reasons = Object.entries(result.rejectedReasons ?? {})
          .sort(([, a], [, b]) => b - a)
          .map(([reason, count]) => `${reason}=${count}`)
          .join(' ');
        console.log(
          `[BudgetLocal] sync hh=${householdId} applied=${appliedFromPeers} duplicates=${result.duplicates ?? 0} rejected=${result.rejected ?? 0} deferredBlobs=${result.deferredBlobs ?? 0} acked=${result.acked} pushedOps=${result.pushedOps} chunks=${result.chunks} skippedPeers=${result.skippedPeers} pages=${result.pages} peers=${peerDeviceIds.length} conflicts=${conflictCount}`,
        );
        if (reasons) {
          console.warn(`[BudgetLocal] sync/rejected hh=${householdId} ${reasons}`);
        }
        recordE2EPersistEntry({
          store: 'budget_mailbox',
          operation: 'sync',
          detail: `hh=${householdId} applied=${appliedFromPeers} deposited=${result.deposited} pushedOps=${result.pushedOps} acked=${result.acked} rejected=${result.rejected ?? 0} deferredBlobs=${result.deferredBlobs ?? 0} conflicts=${conflictCount}${reasons ? ` reasons(${reasons})` : ''}`,
        });
      } catch (error) {
        console.warn('[BudgetLocal] sync telemetry skipped', householdId, error);
      }

      setStage('publishing');
      let recoveryDeposits = 0;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Avoid the engine/control-plane initialization cycle.
        const { recoverExistingMemberDevices } = require('./peerRecovery') as typeof import('./peerRecovery');
        recoveryDeposits = await recoverExistingMemberDevices(peers.state);
      } catch (error) {
        console.warn('[BudgetLocal] peer recovery failed', householdId, error);
      }
      try {
        // Recovery owns forced snapshots and throttles them per recipient.
        // Re-forcing here for stale device registrations uploaded the entire
        // history on every heartbeat, even after the real recipient caught up.
        const published = await maybePublishCheckpoint(householdId);
        if (published) console.log(`[BudgetLocal] checkpoint published hh=${householdId}`);
      } catch (error) {
        console.warn('[BudgetLocal] checkpoint publish FAILED', householdId, error);
      }
      await maybeCompactAfterSync(householdId);

      if (getActiveBudgetHouseholdId() === householdId && AppState.currentState === 'active') {
        await maybeSyncOverWebRtc({
          session,
          peerDeviceIds,
          pubMap,
          setResult,
          // Only a run that actually LEFT something for a peer announces.
          //
          // This is what stops the announcement from becoming an infinite loop
          // now that peers act on it. The coordinator fans `sync_available` out
          // to every other device, so if announcing were unconditional: A
          // announces → B syncs → B announces → A syncs → A announces, for ever,
          // over a household where nothing is happening. Gated on a deposit the
          // exchange terminates after one hop — B finds nothing to push, so B
          // says nothing.
          deposited: result.deposited > 0 || recoveryDeposits > 0,
        });
      }

      assertCurrentAccount();
      if (checkpointError) throw checkpointError;
      if (result.rejected > 0 || result.deferredBlobs > 0) {
        throw new Error('Sync incomplete: some received messages need another attempt');
      }
      if (await isHouseholdBootstrapPending(householdId)) {
        setResult({backfilling: true});
        setPhase('idle');
        setStage('downloading');
        return;
      }
      setResult({ lastErrorCode: null, lastError: null });
      setPhase('ok');
      setStage('done');
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync_failed';
    const code = classifySyncError(error);
    // Log the raw message; surface only the code. A payload_too_large is
    // permanent until the batch is bounded, so it must not read as "offline".
    console.warn(`[BudgetLocal] sync failed hh=${householdId} code=${code}`, message);
    setResult({ phase: 'error', lastError: message, lastErrorCode: code });
    // The stage must not be left mid-run: a banner frozen on "Downloading
    // household history" over a sync that died reads as a hang, and a member
    // waiting on their budget will wait indefinitely rather than retry.
    setStage('idle');
    setSnapshotProgress(null);
    recordE2EPersistEntry({
      store: 'budget_mailbox',
      operation: 'sync',
      detail: `FAIL hh=${householdId} code=${code}`,
    });
  }
}

/**
 * Opportunistic peer-to-peer round, ACTIVE household only.
 *
 * House shipped multi-property mailbox-only, so there is no precedent to copy
 * here — this is Budget's decision, and it is a deliberate restriction rather
 * than an oversight.
 *
 * The signaling client is a module-global socket whose URL is built from the
 * ACTIVE ledger (`signalingClient.ts` — `getLocalLedger().household.id`), and
 * `connect()` tears down the previous socket every time it is called. One socket
 * cannot represent N households: a fan-out would have each household reconnect
 * over the last one's room, and the survivor would offer a household's ops into
 * a coordinator room belonging to a household its peers are not in. Making that
 * safe means multiplexing signaling by household inside HouseholdCoordinatorDO —
 * a protocol change, not a client refactor.
 *
 * Background households therefore sync by mailbox alone, which is per-household
 * by construction: every deposit is addressed device-by-device and sealed under
 * that household's HDK. That is exactly what House ships for every property, so
 * the background path is the well-trodden one and only the foreground household
 * takes the upgrade.
 */
async function maybeSyncOverWebRtc(input: {
  session: BudgetSessionHandle;
  peerDeviceIds: DeviceId[];
  pubMap: Map<string, Uint8Array>;
  setResult: StatusWriters['setResult'];
  /** This run deposited ops for a peer, so there is something to announce. */
  deposited: boolean;
}): Promise<void> {
  const { session, peerDeviceIds, pubMap, setResult, deposited } = input;
  const { ledger, householdKeys, opLog, store, identity } = session;

  const signaling = getSignalingClient();
  signaling.connect();
  // The nudge that makes a peer's screen update while the author is still
  // looking at theirs — `autoSync` turns the inbound frame into a sync. Sent
  // only when this run left something to collect; see the caller.
  if (deposited) signaling.announceSyncAvailable();

  if (peerDeviceIds.length === 0 || !(await WebRtcPeerTransport.isAvailable())) return;

  const remote = peerDeviceIds[0]!;
  try {
    const transport = new WebRtcPeerTransport({
      signaling,
      remoteDeviceId: remote,
      isInitiator: ledger.deviceId < remote,
    });
    await transport.start();
    const peerSession = new PeerSyncSession({
      householdId: householdKeys.householdId,
      deviceId: identity.deviceId,
      signingPublicKey: identity.signingPublicKey,
      agreementPublicKey: identity.agreementPublicKey,
      opLog,
      listLocalOps: () => store.listOperationsByHlc(householdKeys.householdId),
      resolveSenderPublicKey: (deviceId) => pubMap.get(deviceId) ?? null,
    });
    const peerResult =
      ledger.deviceId < remote
        ? await peerSession.runAsInitiator(transport)
        : await peerSession.runAsResponder(transport);
    if (peerResult.applied > 0) {
      const latest = await store.listOperationsByHlc(householdKeys.householdId);
      await noteRemoteOpsApplied(latest, session.householdId);
    }
    lastSyncedAtByHousehold.set(session.householdId, Date.now());
    const webrtcConflicts = getLocalConflictsFor(session.householdId).length;
    setResult({
      lastTransport: 'webrtc',
      lastSyncedAt: Date.now(),
      lastAppliedFromPeers: peerResult.applied,
      conflicts: webrtcConflicts,
    });
    recordE2EPersistEntry({
      store: 'budget_webrtc',
      operation: 'sync',
      detail: `hh=${session.householdId} applied=${peerResult.applied} conflicts=${webrtcConflicts}`,
    });
  } catch (error) {
    // Mailbox already succeeded — WebRTC is opportunistic.
    console.warn('[budget.local] webrtc sync skipped', error);
  }
}
