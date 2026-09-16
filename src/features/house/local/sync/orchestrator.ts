/**
 * Foreground / on-open sync for House (plan §5 stage H4, §7 stage H5).
 *
 * Mailbox only. Budget opportunistically upgrades to WebRTC after the mailbox
 * round; House does not, because `EXPO_PUBLIC_HOUSE_P2P` is off by default
 * (plan §1.7) and a transport nobody enables is a transport nobody tests.
 *
 * EVERY PROPERTY, INDEPENDENTLY
 * -----------------------------
 * `runHouseLocalSync()` fans out over every open property. Each run is bound to
 * a `HouseSessionHandle` rather than to "whatever is active", because the
 * active-session accessors would seal property B's ops under property A's HDK
 * and address them to A's peers. Single-flight is keyed per household so one
 * unreachable property cannot block the others, and `Promise.allSettled` means
 * one failure does not abort the fan-out.
 *
 * Ordering within a property is load-bearing and inherited:
 *   1. control-plane state (who the peers are, and their public keys)
 *   2. enrolment — accept an HDK wrap if this device was just approved
 *   3. RE-READ the handle, because step 2 swaps both the household keys and the
 *      OpLog instance; values captured earlier would seal this run's batches
 *      under the pre-join key and every op would be rejected
 *   4. checkpoint bootstrap / catch-up
 *   5. the mailbox round itself
 *   6. publish + compact
 */
import { recordE2EPersistEntry } from '@api/e2eTestObservability';
import {
  CATCH_UP_OPS_THRESHOLD,
  CATCH_UP_STALE_MS,
  MailboxSyncEngine,
  classifySyncError,
  hexToBytes,
  lagOps,
  type DeviceId,
} from '@symply/local-first';

import {
  fetchControlPlaneState,
  houseHouseholdIsOnControlPlane,
  syncLocalHouseholdToControlPlane,
} from '../controlPlaneClient';
import {
  getActiveHouseholdId,
  getLocalHouseConflictsFor,
  getLocalHouseSession,
  isHouseholdBootstrapPending,
  isLocalHouseSessionOpen,
  listLocalHouseProperties,
  noteRemoteHouseOpsApplied,
  withLedgerBatch,
  type HouseSessionHandle,
} from '../engine';
import { canEnrolmentStillBeApproved } from '../enrolmentReachability';
import { isHouseLocalFirst } from '../flag';
import { publishHouseRoster } from '../householdRoster';
import { purgeRevokedHouseProperties } from '../membershipWatch';
import { syncHouseLocalReminders } from '../reminders/houseLocalReminders';

import {
  maybeCompactAfterSync,
  maybePublishCheckpoint,
  runHouseholdBackfill,
  tryInstallLatestCheckpoint,
} from './checkpoints';
import { HttpControlPlaneClient } from './httpControlPlane';
import { getHouseSignalingClient } from './signalingClient';
import {
  useHouseSyncStatusStore,
  type HouseSyncStatus,
  type SyncPhase,
  type SyncStage,
} from './syncStatusStore';

/**
 * Single-flight PER PROPERTY, not globally (plan §7 rule 4). A global guard
 * means one slow or unreachable property blocks every other one's sync — the
 * landlord case the whole stage exists for.
 */
const syncInFlight = new Map<string, Promise<void>>();

/**
 * When each property last completed a mailbox round, in this process.
 *
 * The status store holds ONE `lastSyncedAt` — the foreground property's — so
 * using it for the catch-up staleness heuristic compares property A's clock
 * against property B's lag and never fires for a background property. Worse, the
 * store snapshot the run captures is read once at entry and never re-read, so
 * even for the ACTIVE property it is the value from before this run began.
 *
 * As durable as the store itself (both are in-memory and start empty on a cold
 * launch), which is all the heuristic needs: a bootstrap is decided by the
 * version vector, not by this.
 */
const lastSyncedAtByHousehold = new Map<string, number>();

type PeerContext = {
  peerDeviceIds: DeviceId[];
  pubMap: Map<string, Uint8Array>;
  /**
   * The raw device roster, kept because `peerDeviceIds` has already thrown away
   * what the enrolment check needs: it drops revoked devices and, more to the
   * point, every device's `lastSeenAt`. Answering "could anyone still approve
   * this device" from ids alone is not possible — see
   * `canEnrolmentStillBeApproved`.
   */
  devices: Awaited<ReturnType<typeof fetchControlPlaneState>>['devices'];
};

/**
 * The status-store writers, already gated on the property being active. Passed
 * down rather than re-derived, so no helper can reach for the raw store and
 * report a background property's result onto the foreground banner.
 */
type StatusWriters = {
  setPhase: (phase: SyncPhase) => void;
  setStage: (stage: SyncStage) => void;
  setSnapshotProgress: (progress: { done: number; total: number } | null) => void;
  setResult: (patch: Partial<HouseSyncStatus>) => void;
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
 * Who else is in this home, and when the server last heard from them.
 *
 * "Is anyone else online?" is the first question anybody asks when a change does
 * not appear on the other phone, and nothing in the log answered it. The status
 * store's `peersOnline` is a misnomer — it counts peers this device KNOWS of,
 * not peers that are reachable — so a home whose other phone has been in a
 * drawer for a week reports the same number as one syncing live.
 *
 * `lastSeenAt` is stamped server-side by each device's own sync poll, so it is
 * the closest thing to a liveness signal that exists without a socket. Absent on
 * records enrolled before liveness tracking, which reads as "never" here and must
 * not be mistaken for "offline".
 *
 * Devices and members both, because they answer different questions: a member
 * with no active device has been invited but has never enrolled, which looks
 * identical to "not in the home" from the device list alone. Revoked devices are
 * counted, not listed — they explain a key epoch, not a sync.
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
      `[HouseLocal] sync/household hh=${householdId} epoch=${state.keyEpoch} members=${state.members.length} activeDevices=${rows.length} revokedDevices=${revoked}`,
    );
    console.log(`[HouseLocal] sync/peers hh=${householdId} ${rows.join(' | ') || '(none)'}`);
    const strangers = state.members.filter(
      (m) =>
        m.status === 'active' &&
        !state.devices.some((d) => d.userId === m.userId && d.status === 'active'),
    );
    for (const member of strangers) {
      console.log(
        `[HouseLocal] sync/member-no-device hh=${householdId} ${member.displayName ?? member.email ?? member.userId} is a member but has no active device — they cannot send or receive anything`,
      );
    }
  } catch (error) {
    // Presence is a diagnostic. It must never be the reason a sync fails.
    console.warn('[HouseLocal] presence log skipped', householdId, error);
  }
}

/**
 * One control-plane answer, read for both things it carries.
 *
 * The device keys are what this sync needs; the member profiles are what every
 * screen that names a peer needs (`householdRoster`). Publishing here rather than
 * on a timer is what makes a rename or a new avatar show up across the home on
 * the next sync — the trip is already being made, so a fresh roster costs nothing
 * extra.
 *
 * A 403 means the control plane does not yet know this device — the usual cause
 * is a fresh install whose registration has not landed. Register once and retry;
 * anything else is treated as offline rather than as a hard failure.
 */
async function resolvePeers(
  householdId: string,
  ownDeviceId: string,
  isActive: boolean,
): Promise<PeerContext | null> {
  const pubMap = new Map<string, Uint8Array>();
  const absorb = (state: Awaited<ReturnType<typeof fetchControlPlaneState>>): PeerContext => {
    // The roster is a single-property surface — the household store holds ONE
    // member list — so only the active property publishes into it. A background
    // property would blank the names on the screen the member is actually
    // looking at. `publishHouseRoster` has a cross-property guard of its own, but
    // that one needs `state.householdId` to come back populated; this one does
    // not.
    if (isActive) {
      try {
        publishHouseRoster(state, householdId);
      } catch (error) {
        // A roster is a display concern; it must never fail a sync.
        console.warn('[HouseLocal] roster publish skipped', error);
      }
    }
    logHouseholdPresence(householdId, state, ownDeviceId);
    return {
      peerDeviceIds: readPeers(state, ownDeviceId, pubMap),
      pubMap,
      devices: state.devices,
    };
  };

  try {
    return absorb(await fetchControlPlaneState(householdId));
  } catch (error) {
    const httpStatus =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { status?: number } }).response?.status
        : undefined;
    // A property that reports "offline" while the phone plainly is not is the
    // other way this fails silently — 403 (not a member / device revoked) and a
    // real network error land on the same banner and must not read the same in
    // the log.
    console.warn(
      `[HouseLocal] sync/peers hh=${householdId} control plane refused status=${httpStatus ?? 'network'}`,
    );
    if (httpStatus !== 403) return null;
    try {
      // NAMED. Left to default this registered whichever property was ACTIVE,
      // which is never the one that just got the 403 when a background property
      // is syncing — so the retry re-asked the same question and failed the same
      // way, for ever.
      await syncLocalHouseholdToControlPlane(householdId);
      return absorb(await fetchControlPlaneState(householdId));
    } catch {
      return null;
    }
  }
}

/**
 * Which triggers were a PERSON, and which were the app deciding for itself.
 *
 * Named because the log is the only place the difference is visible after the
 * fact, and the two failure reports are completely different problems: a
 * background poll that finds nothing is normal, a tap that finds nothing is a
 * member owed an explanation on screen. Chasing "sync does nothing" meant
 * reading a log where a heartbeat and a deliberate tap were indistinguishable.
 */
const USER_TRIGGERS = new Set(['sync-now-button', 'after-join', 'history-repair']);
const triggerSource = (trigger: string): 'user' | 'auto' =>
  USER_TRIGGERS.has(trigger) ? 'user' : 'auto';

/** Sync every open property, concurrently, without letting one failure stop the rest. */
export async function runHouseLocalSync(trigger = 'unknown'): Promise<void> {
  // Both preconditions logged, because a run that never starts is exactly what
  // "the sync button does nothing" looks like from the outside. Silence here was
  // indistinguishable from a sync that ran and found nothing.
  if (!isHouseLocalFirst() || !isLocalHouseSessionOpen()) {
    console.warn(
      `[HouseLocal] sync/start trigger=${trigger} source=${triggerSource(trigger)} REFUSED — localFirst=${isHouseLocalFirst()} sessionOpen=${isLocalHouseSessionOpen()}`,
    );
    return;
  }
  // BEFORE the fan-out, not after: a home this account has been removed from is
  // not a home to sync. Syncing it first would spend a round on rows that are
  // about to be erased and — worse — walk into `resolvePeers`'s 403 recovery,
  // which answers a refusal by re-registering the very home the control plane
  // has just refused. This is also the ONLY recurring trigger the removed device
  // has: the push that announces a removal is best-effort, and the member who
  // LEFT from their other phone is deliberately sent none at all. Throttled
  // inside, and it never throws.
  await purgeRevokedHouseProperties(trigger);
  const properties = listLocalHouseProperties();
  console.log(
    `[HouseLocal] sync/start trigger=${trigger} source=${triggerSource(trigger)} properties=${properties.length} [${properties
      .map((p) => p.householdId)
      .join(',')}] active=${getActiveHouseholdId() ?? 'none'}`,
  );
  const startedAt = Date.now();
  try {
    await Promise.allSettled(properties.map((property) => runOne(property.householdId, trigger)));
  } finally {
    console.log(
      `[HouseLocal] sync/done trigger=${trigger} source=${triggerSource(trigger)} properties=${properties.length} in ${Date.now() - startedAt}ms`,
    );
    refreshReminders();
  }
}

/** Sync ONE property — the push-wake and switcher entry point. */
export async function runHouseLocalSyncFor(householdId: string, trigger = 'unknown'): Promise<void> {
  if (!isHouseLocalFirst() || !isLocalHouseSessionOpen()) {
    console.warn(
      `[HouseLocal] sync/start trigger=${trigger} source=${triggerSource(trigger)} hh=${householdId} REFUSED — localFirst=${isHouseLocalFirst()} sessionOpen=${isLocalHouseSessionOpen()}`,
    );
    return;
  }
  console.log(
    `[HouseLocal] sync/start trigger=${trigger} source=${triggerSource(trigger)} hh=${householdId}`,
  );
  const startedAt = Date.now();
  try {
    await runOne(householdId, trigger);
  } finally {
    console.log(
      `[HouseLocal] sync/done trigger=${trigger} source=${triggerSource(trigger)} hh=${householdId} in ${Date.now() - startedAt}ms`,
    );
    refreshReminders();
  }
}

/**
 * The single-flight gate, shared by both entry points so a UI-triggered sync of
 * one property joins the fan-out's run for it instead of duplicating it.
 */
function runOne(householdId: string, trigger: string): Promise<void> {
  const existing = syncInFlight.get(householdId);
  if (existing) {
    // Joining, not duplicating — correct, and worth saying. A tap that lands on
    // an in-flight run returns when THAT run finishes, which can look like a
    // button that responded instantly and did nothing.
    console.log(`[HouseLocal] sync/join hh=${householdId} — a run is already in flight`);
    return existing;
  }

  const run = syncOneProperty(householdId, trigger).finally(() => {
    syncInFlight.delete(householdId);
  });
  syncInFlight.set(householdId, run);
  return run;
}

/**
 * A peer's ops just landed, so the horizon this device scheduled reminders from
 * is stale — top it up.
 *
 * Once per INVOCATION, not once per property: the reminders pass cancels House
 * notifications by prefix and reschedules wholesale, so N concurrent passes do
 * the same work N times and interleave over the notification centre for nothing.
 * Best-effort and fired from a `finally`, because a property that failed to sync
 * still has reminders that need to stay scheduled — which the old placement, at
 * the tail of the success path inside the batch, did not manage.
 */
function refreshReminders(): void {
  void syncHouseLocalReminders({ includeColdProperties: true });
}

async function syncOneProperty(householdId: string, trigger = 'unknown'): Promise<void> {
  // The status store is a single-property surface: only the ACTIVE property
  // drives the banner, so a background property that fails does not paint an
  // error over a screen that is working fine.
  const isActive = getActiveHouseholdId() === householdId;
  const status = useHouseSyncStatusStore.getState();
  const setPhase: StatusWriters['setPhase'] = (phase) => {
    if (isActive) status.setPhase(phase);
  };
  const setResult: StatusWriters['setResult'] = (patch) => {
    if (isActive) status.setResult(patch);
  };
  const setStage: StatusWriters['setStage'] = (stage) => {
    if (isActive) status.setStage(stage);
  };
  const setSnapshotProgress: StatusWriters['setSnapshotProgress'] = (progress) => {
    if (isActive) status.setSnapshotProgress(progress);
  };

  // A home nobody else can reach has nothing to sync: no peers to poll, no
  // mailbox to drain, and no checkpoint worth uploading — the server cannot
  // decrypt one and the key that could never leaves this device. Skipping is not
  // an optimisation. It is what keeps a private home OFF the control plane: the
  // 403 recovery inside `resolvePeers` would otherwise re-create, on the next
  // tick, exactly the household row that is not supposed to exist.
  if (!(await houseHouseholdIsOnControlPlane(householdId))) {
    // THE "sync button does nothing" case, said out loud.
    //
    // For a genuinely private home this is correct and there is nothing to do.
    // But the check is also false when the device is OFFLINE
    // (`houseHouseholdIsOnControlPlane` catches and returns false) and when the
    // registration marker was never written — and in those two cases a shared
    // home silently skips its entire sync. Same return, same silence, three
    // completely different situations.
    console.log(
      `[HouseLocal] sync/skip hh=${householdId} — not on the control plane. Either private (nothing to sync), offline, or the registration marker is missing.`,
    );
    setPhase('idle');
    setStage('idle');
    return;
  }

  console.log(`[HouseLocal] sync/begin hh=${householdId} active=${isActive}`);
  setPhase('syncing');
  setStage('connecting');
  // A fresh window for the live record counter. "1,203 records" is meaningless
  // without one, and the window a member cares about is the sync in front of
  // them — not everything since the app launched.
  if (isActive) status.resetRecords();
  setResult({ lastError: null, backfilling: await isHouseholdBootstrapPending(householdId) });

  // EVERY ledger notification this run produces is held until it finishes.
  //
  // Without this the screen repaints once per merged op — `ledgerRefresh` maps
  // the moved tables to query keys and invalidates them per event — so a member
  // watching a join sees hundreds of partial states flash past: rooms that
  // appear one at a time, task lists that redraw against a ledger mid-merge. The
  // batch turns that into one repaint, at the end, off a ledger that is whole.
  // The `finally` inside `withLedgerBatch` releases it even when the run throws,
  // so a failed sync still shows whatever landed.
  try {
    await withLedgerBatch(householdId, async () => {
      let session: HouseSessionHandle = await getLocalHouseSession(householdId);

      const peers = await resolvePeers(householdId, session.ledger.deviceId, isActive);
      if (!peers) {
        setResult({ phase: 'offline', lastError: 'control_plane_unreachable' });
        setStage('idle');
        return;
      }
      const { peerDeviceIds, pubMap, devices } = peers;
      pubMap.set(session.identity.deviceId, session.identity.signingPublicKey);

      // Enrolment: accept the HDK wrap if this device was just approved.
      if (session.awaitingEnrolment) setStage('enrolling');
      try {
        const { tryAcceptHdkFromMailbox } = await import('./hdkTransfer');
        await tryAcceptHdkFromMailbox(householdId);
      } catch {
        /* best effort — the next sync retries */
      }

      // AFTER enrolment, never before: installing the HDK swaps the household
      // keys AND the OpLog instance, so the handle has to be re-read.
      session = await getLocalHouseSession(householdId);
      const { householdKeys, retiredHouseholdKeys, opLog, store, identity } = session;

      // The key ring this run can read with, by EPOCH ONLY — never the bytes.
      // Printed on every sync because it is the first thing to check when a home
      // applies nothing: a device holding one epoch against a home that has
      // rotated can only read the slice written since the last rotation.
      const ringEpochs = [...retiredHouseholdKeys.keys()].sort((a, b) => a - b);
      console.log(
        `[HouseLocal] sync/keys hh=${householdId} epoch=${householdKeys.keyEpoch} ring=[${ringEpochs.join(',')}] awaitingEnrolment=${session.awaitingEnrolment}`,
      );

      if (session.awaitingEnrolment) {
        // Said out loud rather than inferred from the absence of everything
        // else. A device stuck here syncs forever, applies nothing, and looks
        // identical to one that is simply up to date.
        //
        // And "forever" is not a figure of speech: if every other enrolled
        // device has stopped reaching the home, the wrap this device is waiting
        // for has nobody left to deposit it. Saying only "still waiting" there
        // promises an approval that cannot arrive, so the reachable and the
        // unreachable wait are now named apart — in the log AND in the status
        // the enrolment screen reads.
        const approvable = canEnrolmentStillBeApproved(devices, session.identity.deviceId);
        setResult({ enrolmentUnreachable: !approvable });
        console.log(
          approvable
            ? `[HouseLocal] sync/enrolment hh=${householdId} still waiting for the home key — nothing can be read or written yet`
            : `[HouseLocal] sync/enrolment hh=${householdId} UNREACHABLE — no live device is left to hand over the home key; waiting cannot resolve this`,
        );
      } else {
        // Clears the moment the wrap lands. Left set, a home that recovered
        // would keep telling the member it was beyond saving.
        setResult({ enrolmentUnreachable: false });
      }

      if (!session.awaitingEnrolment) {
        try {
          const ours = await store.getVersionVector(householdKeys.householdId);
          // A JOINED property still owed its history, or a device that has never
          // stored an op for it. The first test is a durable marker and the
          // second is the legacy inference it replaces — both are kept, because
          // devices that joined before the marker shipped have a non-empty vector
          // and no marker, and the vector test is the only thing that still
          // catches a genuinely fresh one.
          //
          // The retry is the fix. The old code made ONE attempt, gated on the
          // vector being empty, which stops being true the moment a single live
          // op is applied — and the owner publishes the snapshot and hands over
          // the household key as two independent steps, so a joiner that gets the
          // key first, finds no checkpoint, and then merges one op has lost its
          // only chance at everything that predates the join.
          const owedBackfill = await isHouseholdBootstrapPending(householdId);
          if (owedBackfill || Object.keys(ours).length === 0) {
            setStage('downloading');
            const outcome = await runHouseholdBackfill(householdId, {
              onProgress: (done, total) => setSnapshotProgress({ done, total }),
              onRecords: (rows) => setResult({ snapshotRecords: rows }),
            });
            setSnapshotProgress(null);
            setResult({ backfilling: await isHouseholdBootstrapPending(householdId) });
            if (outcome === 'not-needed' && Object.keys(ours).length === 0) {
              // No marker (a pre-marker join, or a device that simply has no ops
              // yet) — take the single legacy attempt so behaviour is unchanged
              // for properties this feature is not about.
              const installed = await tryInstallLatestCheckpoint('bootstrap', householdId, {
                onProgress: (done, total) => setSnapshotProgress({ done, total }),
                onRecords: (rows) => setResult({ snapshotRecords: rows }),
              });
              setSnapshotProgress(null);
              console.log(
                `[HouseLocal] sync/bootstrap hh=${householdId} installed=${installed} (version vector empty)`,
              );
            } else {
              console.log(`[HouseLocal] sync/bootstrap hh=${householdId} outcome=${outcome}`);
            }
          } else {
            let maxLag = 0;
            for (const peerId of peerDeviceIds) {
              const peerState = await store.getSyncPeerState(householdKeys.householdId, peerId);
              if (peerState) maxLag = Math.max(maxLag, lagOps(ours, peerState.knownVv));
            }
            // THIS property's clock, not the foreground banner's — and read now
            // rather than from the store snapshot captured before the run began.
            const lastSyncedAt = lastSyncedAtByHousehold.get(householdId) ?? null;
            const stale =
              maxLag > 0 && lastSyncedAt != null && Date.now() - lastSyncedAt >= CATCH_UP_STALE_MS;
            // Why this device is NOT bootstrapping. The common answer — "its
            // vector is not empty" — is the one that matters: it means the
            // bootstrap window is gone and only ops can fill this ledger now.
            console.log(
              `[HouseLocal] sync/bootstrap hh=${householdId} skipped — vector holds ${Object.keys(ours).length} author(s), maxLag=${maxLag} stale=${stale}`,
            );
            if (maxLag >= CATCH_UP_OPS_THRESHOLD || stale) {
              const installed = await tryInstallLatestCheckpoint('catch-up', householdId);
              console.log(
                `[HouseLocal] sync/catch-up hh=${householdId} installed=${installed} maxLag=${maxLag}`,
              );
            }
          }
        } catch (error) {
          console.warn('[HouseLocal] checkpoint install skipped', householdId, error);
        }
      }

      // BOUND to the property this run is for. An unbound client resolves every
      // mailbox call against whatever is active, which for a background property is
      // a different home entirely — see `HttpControlPlaneClient`.
      const control = new HttpControlPlaneClient(householdId);
      const mailbox = new MailboxSyncEngine({
        store,
        opLog,
        householdKeys,
        // Read-side key ring. A peer that rotated while this device was away —
        // or a peer still draining a backlog deposited before the rotation —
        // sends batches sealed under an epoch that is no longer current, and
        // without the ring every one of them is refused and left on the relay.
        // House held these keys on the session handle for the attachment channel
        // and never handed them to the mailbox, so a home stayed permanently
        // unable to read anything a revocation had aged out.
        retiredHdks: retiredHouseholdKeys,
        deviceId: identity.deviceId,
        signingPublicKey: identity.signingPublicKey,
        control,
        peerDeviceIds: peerDeviceIds.length > 0 ? peerDeviceIds : undefined,
        resolveSenderPublicKey: (deviceId) => pubMap.get(deviceId) ?? null,
      });

      // A version vector, not the log: materializing every StoredOperation just to
      // count what arrived costs a full pass over payload + signature buffers on
      // Hermes, for a number the store can answer directly.
      setStage('applying');
      const beforeVv = await store.getVersionVector(householdKeys.householdId);
      const result = await mailbox.syncOnce();
      let appliedFromPeers = 0;
      if (result.applied > 0) {
        const fresh = await store.listOperationsSince(householdKeys.householdId, beforeVv);
        appliedFromPeers = fresh.length;
        if (fresh.length > 0) {
          // The OpLog projection handler already merged these into THIS property's
          // ledger inside applyRemote(); this persists the merged rows.
          await noteRemoteHouseOpsApplied(fresh, householdId);
        }
      }

      lastSyncedAtByHousehold.set(householdId, Date.now());
      const conflictCount = getLocalHouseConflictsFor(householdId).length;
      setResult({
        // What genuinely still has to leave this device — not the size of the log,
        // which is why a naive count claims thousands of pending items.
        pendingOutbound: await mailbox.pendingOutboundCount(),
        lastTransport: 'mailbox',
        lastSyncedAt: Date.now(),
        lastAppliedFromPeers: appliedFromPeers,
        lastPushedOps: result.pushedOps ?? 0,
        peersOnline: peerDeviceIds.length,
        conflicts: conflictCount,
        // The install is over by the time the mailbox round finishes, and the
        // count belongs to that install — leaving it set would have the next
        // ordinary sync claim it had just restored a thousand records.
        snapshotRecords: null,
      });
      // Diagnostics, and NOTHING they do may fail the sync.
      //
      // This block is inside the try that decides the property's phase, so a
      // throw in here does not report a logging bug — it reports the home as
      // BROKEN. That is not hypothetical in this codebase: reading
      // `result.rejectedReasons` unguarded threw `Cannot convert undefined or
      // null to object` in Budget against a result shape that predates the
      // field, and a healthy household came out of the run as phase 'error'. A
      // sync that worked, reported as a sync that failed, because of a log line.
      //
      // So: every field is read defensively, and the whole block is wrapped. The
      // wrapper is the part that matters — it means the next field added here
      // cannot reintroduce this, whatever shape the caller passes.
      try {
        // `rejected` on its own is the number that hides an epoch bug:
        // "applied=0" with no way to tell an idle home from one refusing every op
        // it is handed. The breakdown names the reason, and `deferredBlobs` says
        // how many deposits were LEFT on the relay because of it — a count that
        // stays above zero forever is a wedged mailbox, not a quiet one.
        const reasons = Object.entries(result.rejectedReasons ?? {})
          .sort(([, a], [, b]) => b - a)
          .map(([reason, count]) => `${reason}=${count}`)
          .join(' ');
        console.log(
          `[HouseLocal] sync hh=${householdId} trigger=${trigger} applied=${appliedFromPeers} duplicates=${result.duplicates ?? 0} rejected=${result.rejected ?? 0} deferredBlobs=${result.deferredBlobs ?? 0} acked=${result.acked} deposited=${result.deposited} pushedOps=${result.pushedOps} chunks=${result.chunks} skippedPeers=${result.skippedPeers} pages=${result.pages} peers=${peerDeviceIds.length} conflicts=${conflictCount}`,
        );
        if (reasons) {
          console.warn(`[HouseLocal] sync/rejected hh=${householdId} ${reasons}`);
        }
        recordE2EPersistEntry({
          store: 'house_mailbox',
          operation: 'sync',
          detail: `hh=${householdId} applied=${appliedFromPeers} deposited=${result.deposited} pushedOps=${result.pushedOps} acked=${result.acked} rejected=${result.rejected ?? 0} deferredBlobs=${result.deferredBlobs ?? 0} conflicts=${conflictCount}${reasons ? ` reasons(${reasons})` : ''}`,
        });
      } catch (error) {
        console.warn('[HouseLocal] sync telemetry skipped', householdId, error);
      }

      // Tell the household a deposit is waiting — the nudge that makes another
      // member's change appear on this screen while they are still looking at
      // theirs. `autoSync` turns the inbound frame into a sync.
      //
      // House never ran WebRTC, so unlike Budget there was no existing call site
      // for this: the coordinator socket was opened only by `enrolmentLive`, for
      // enrolment frames, and nothing ever announced. The mailbox alone gets the
      // data there; the announcement is what stops the other phone waiting up to
      // a heartbeat to discover it.
      //
      // ACTIVE PROPERTY ONLY, and only when this run actually LEFT something.
      //
      //  - active only, because `connect()` refuses a non-active property by
      //    design (one socket, one property) — a background run announcing would
      //    either be dropped or drag the socket out of the room the member is
      //    looking at;
      //  - deposited only, because that is what stops the announcement becoming
      //    an infinite loop now that peers act on it. The coordinator fans the
      //    frame out to every other device, so unconditional announcing gives A
      //    announces → B syncs → B announces → A syncs, for ever, over a home
      //    where nothing happened. Gated on a deposit the exchange terminates
      //    after one hop: B finds nothing to push, so B says nothing.
      if (isActive && result.deposited > 0) {
        try {
          const signaling = getHouseSignalingClient();
          if (signaling.connect(householdId)) signaling.announceSyncAvailable();
        } catch (error) {
          // Signaling is the fast path, never the only one. The deposit is on
          // the relay either way and the peer's heartbeat will find it.
          console.warn('[HouseLocal] sync announce skipped', householdId, error);
        }
      }

      setStage('publishing');
      try {
        // A peer that has never told us it holds anything is a NEWCOMER, and the
        // snapshot is the only way it can ever receive what predates its join —
        // the ops that carried it are compacted here. The ordinary gate ("100 ops
        // since the last checkpoint") is a size heuristic and says nothing about
        // that, so an owner with a quiet ledger can leave a joiner with no
        // snapshot to bootstrap from indefinitely. The approve path forces one,
        // but only the approving device runs it: if that upload failed, was
        // interrupted, or the home was approved from a device that has since been
        // replaced, this is what repairs it.
        const newcomer = await hasUnbackfilledPeer(store, householdKeys.householdId, peerDeviceIds);
        const published = await maybePublishCheckpoint(householdId, { force: newcomer });
        if (published) {
          console.log(`[HouseLocal] checkpoint published hh=${householdId} forNewcomer=${newcomer}`);
        }
      } catch (error) {
        console.warn('[HouseLocal] checkpoint publish skipped', householdId, error);
      }
      await maybeCompactAfterSync(householdId);

      // Reminders are NOT refreshed here — `refreshReminders` does it once per
      // invocation from the entry point's `finally`. Per-property was both too
      // many (the pass cancels by prefix and reschedules wholesale, so N
      // properties interleaved N full passes over the notification centre) and
      // too few (a property that threw never reached this line, so a failed sync
      // left its reminders stale).

      setResult({ lastErrorCode: null, lastError: null });
      setPhase('ok');
      setStage('done');
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync_failed';
    const code = classifySyncError(error);
    // Log the raw message; surface only the code. A payload_too_large is
    // permanent until the batch is bounded, so it must not read as "offline".
    console.warn(`[HouseLocal] sync failed hh=${householdId} code=${code}`, message);
    setResult({ phase: 'error', lastError: message, lastErrorCode: code });
    // The stage must not be left mid-run: a banner frozen on "Downloading home
    // history" over a sync that died reads as a hang, and a member waiting on
    // their home will wait indefinitely rather than retry.
    setStage('idle');
    setSnapshotProgress(null);
    recordE2EPersistEntry({
      store: 'house_mailbox',
      operation: 'sync',
      detail: `FAIL hh=${householdId} code=${code}`,
    });
  }
}

/**
 * Is any known peer a device that has never confirmed holding a single op?
 *
 * That is what a freshly-approved member looks like from the owner's side: the
 * control plane reports the device as active, and there is either no sync-peer
 * row for it yet or one whose `knownVv` is still empty. Either way it holds
 * nothing, and the only thing that can give it the home's earlier history is a
 * published checkpoint.
 *
 * Deliberately cheap and deliberately conservative — a store that will not answer
 * returns false, so a read failure costs one skipped publish rather than an
 * upload of the whole ledger on every sync.
 */
async function hasUnbackfilledPeer(
  store: HouseSessionHandle['store'],
  householdId: string,
  peerDeviceIds: readonly DeviceId[],
): Promise<boolean> {
  try {
    for (const peerId of peerDeviceIds) {
      const state = await store.getSyncPeerState(householdId, peerId);
      if (!state || Object.keys(state.knownVv ?? {}).length === 0) return true;
    }
  } catch (error) {
    console.warn('[HouseLocal] newcomer check skipped', householdId, error);
  }
  return false;
}
