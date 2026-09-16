/**
 * Foreground / on-open sync for Health — stage He4.
 *
 * MAILBOX ONLY. THERE IS NO SECOND TRANSPORT, AND THERE IS NO STREAM.
 * -------------------------------------------------------------------
 * Health ships **no** `EventSource`, **no** `WebSocket` and **no** WebRTC peer
 * (plan §2 item 6, §5 He4). `EXPO_PUBLIC_HEALTH_P2P` stays 0 for all of Wave A,
 * so the signaling socket the Durable Object exposes is never opened, and
 * `__tests__/syncClient.test.ts` greps this whole feature tree to keep it that
 * way. Sync is exactly two things: a mailbox pull/push round, and a
 * `health_sync_wake` push telling a device that a round is worth running.
 *
 * ONE HOUSEHOLD, N DEVICES — NOT A FAN-OUT
 * ----------------------------------------
 * House fans this run out over every open property and binds each run to a
 * per-property handle, because binding to "whatever is active" would seal
 * property B's ops under property A's HDK. Health has exactly one implicit
 * personal household (plan §1.2), so the global session accessors ARE the
 * correct binding and there is nothing to fan out over. Every peer here is
 * another device of the same user; there are no members, so there is no member
 * fan-out and no invite-a-member path into this module.
 *
 * Ordering is inherited and load-bearing:
 *   1. control-plane state (which of this user's devices exist, and their keys)
 *   2. enrolment — accept an HDK wrap if this device was just approved
 *   3. RE-READ the engine accessors, because step 2 swaps both the household
 *      keys and the OpLog; values captured earlier would seal this run's batches
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

import { scheduleHealthBlobReconcile } from '../blobs';
import { fetchHealthControlPlaneState, syncLocalHealthHouseholdToControlPlane } from '../controlPlaneClient';
import {
  getLocalHealthHouseholdKeys,
  getLocalHealthIdentity,
  getLocalHealthOpLog,
  getLocalHealthStore,
  isLocalHealthSessionOpen,
  noteRemoteHealthOpsApplied,
} from '../engine';
import { isHealthLocalFirst } from '../flag';

import {
  maybeCompactHealthLogAfterSync,
  maybePublishHealthCheckpoint,
  tryInstallLatestHealthCheckpoint,
} from './checkpoints';
import { redeliverHealthHouseholdKey } from './hdkRotation';
import { tryAcceptHealthHdkFromMailbox } from './hdkTransfer';
import { HttpControlPlaneClient } from './httpControlPlane';
import { useHealthSyncStatusStore } from './syncStatusStore';
import { requestHealthSyncWake } from './syncWake';

/** Single-flight. One household means one run; a second caller joins the first. */
let syncInFlight: Promise<void> | null = null;

type PeerContext = {
  peerDeviceIds: DeviceId[];
  pubMap: Map<string, Uint8Array>;
};

type ControlPlaneState = Awaited<ReturnType<typeof fetchHealthControlPlaneState>>;

/**
 * This user's OTHER devices, and nobody else's.
 *
 * The `userId` filter is not defensive decoration. Health's wake policy drops
 * `excludeUserId` entirely (plan §2 item 4c) precisely because a personal
 * household has one user — which means the only thing keeping another user's
 * device out of this household is the control plane's refusal to add a second
 * `user_id` (He5). If that ever regresses, every op this device authors would be
 * addressed to a stranger's mailbox. So the client re-derives the rule locally
 * from its OWN device's row: peers must share this device's user.
 */
export function readHealthPeers(
  state: ControlPlaneState,
  ownDeviceId: string,
  pubMap: Map<string, Uint8Array>,
): DeviceId[] {
  for (const device of state.devices) {
    if (device.signingPublicKey) {
      pubMap.set(device.deviceId, hexToBytes(device.signingPublicKey));
    }
  }
  const own = state.devices.find((d) => d.deviceId === ownDeviceId);
  const ownUserId = own?.userId;
  const peers: DeviceId[] = [];
  for (const device of state.devices) {
    if (device.status !== 'active' || device.deviceId === ownDeviceId) continue;
    if (ownUserId && device.userId && device.userId !== ownUserId) {
      console.warn('[health.local] dropping peer from another user', device.deviceId);
      continue;
    }
    peers.push(device.deviceId);
  }
  return peers;
}

/**
 * A 403 here means the control plane does not yet know this device — usually a
 * fresh install whose registration has not landed. Register once and retry;
 * anything else is treated as offline rather than as a hard failure.
 */
async function resolvePeers(householdId: string, ownDeviceId: string): Promise<PeerContext | null> {
  const pubMap = new Map<string, Uint8Array>();
  try {
    const state = await fetchHealthControlPlaneState(householdId);
    return { peerDeviceIds: readHealthPeers(state, ownDeviceId, pubMap), pubMap };
  } catch (error) {
    const httpStatus =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { status?: number } }).response?.status
        : undefined;
    if (httpStatus !== 403) return null;
    try {
      await syncLocalHealthHouseholdToControlPlane();
      const state = await fetchHealthControlPlaneState(householdId);
      return { peerDeviceIds: readHealthPeers(state, ownDeviceId, pubMap), pubMap };
    } catch {
      return null;
    }
  }
}

/** Run one mailbox round for the personal household. Never throws. */
export async function runHealthLocalSync(): Promise<void> {
  if (!isHealthLocalFirst() || !isLocalHealthSessionOpen()) return;
  if (syncInFlight) return syncInFlight;

  const run = syncOnce().finally(() => {
    syncInFlight = null;
  });
  syncInFlight = run;
  return run;
}

async function syncOnce(): Promise<void> {
  const status = useHealthSyncStatusStore.getState();
  status.setPhase('syncing');
  status.setResult({ lastError: null, lastErrorCode: null });

  try {
    const householdId = getLocalHealthHouseholdKeys().householdId;
    const ownDeviceId = getLocalHealthIdentity().deviceId;

    const peers = await resolvePeers(householdId, ownDeviceId);
    if (!peers) {
      status.setResult({ phase: 'offline', lastError: 'control_plane_unreachable' });
      return;
    }
    const { peerDeviceIds, pubMap } = peers;
    pubMap.set(ownDeviceId, getLocalHealthIdentity().signingPublicKey);

    // Enrolment: accept the HDK wrap if this device was just approved from the
    // user's other device.
    let enrolled = false;
    try {
      enrolled = await tryAcceptHealthHdkFromMailbox();
    } catch {
      /* best effort — the next sync retries */
    }

    // The other direction of the same handover: a rotation after a revoke
    // (`hdkRotation`) queues the devices its deposit could not reach, and this
    // is the retry. Free when the queue is empty — it reads one local meta row
    // and makes no request — and it is the ONLY way a peer that was offline for
    // the rotation ever gets the new key, since Health has no second user to
    // re-enrol it from and re-enrolment would discard its rows.
    try {
      await redeliverHealthHouseholdKey();
    } catch (error) {
      console.warn('[health.local] household key re-delivery skipped', error);
    }

    // AFTER enrolment, never before: installing the HDK swaps the household keys
    // AND the OpLog instance, so everything below re-reads the accessors rather
    // than reusing values captured at the top of the run.
    const store = getLocalHealthStore();
    const opLog = getLocalHealthOpLog();
    const identity = getLocalHealthIdentity();
    const householdKeys = getLocalHealthHouseholdKeys();

    if (enrolled) {
      // A device that has just joined holds nothing, so it has nothing to
      // deposit and sends no receipt — which means the OTHER device has no
      // reason to push and this one would sit empty until the user next opens
      // it there. The explicit wake is the only thing that closes that gap, and
      // it is safe: it excludes this device, so it cannot wake itself.
      void requestHealthSyncWake({ householdId, sourceDeviceId: identity.deviceId });
    }

    try {
      const ours = await store.getVersionVector(householdKeys.householdId);
      if (Object.keys(ours).length === 0) {
        await tryInstallLatestHealthCheckpoint('bootstrap');
      } else {
        let maxLag = 0;
        for (const peerId of peerDeviceIds) {
          const peerState = await store.getSyncPeerState(householdKeys.householdId, peerId);
          if (peerState) maxLag = Math.max(maxLag, lagOps(ours, peerState.knownVv));
        }
        if (maxLag >= CATCH_UP_OPS_THRESHOLD) {
          await tryInstallLatestHealthCheckpoint('catch-up');
        } else if (
          maxLag > 0 &&
          status.lastSyncedAt != null &&
          Date.now() - status.lastSyncedAt >= CATCH_UP_STALE_MS
        ) {
          await tryInstallLatestHealthCheckpoint('catch-up');
        }
      }
    } catch (error) {
      console.warn('[health.local] checkpoint install skipped', error);
    }

    const control = new HttpControlPlaneClient();
    const mailbox = new MailboxSyncEngine({
      store,
      opLog,
      householdKeys,
      deviceId: identity.deviceId,
      signingPublicKey: identity.signingPublicKey,
      control,
      peerDeviceIds: peerDeviceIds.length > 0 ? peerDeviceIds : undefined,
      resolveSenderPublicKey: (deviceId) => pubMap.get(deviceId) ?? null,
    });

    // A version vector, not the log: materializing every StoredOperation just to
    // count what arrived costs a full pass over payload + signature buffers on
    // Hermes, for a number the store can answer directly.
    const beforeVv = await store.getVersionVector(householdKeys.householdId);
    const result = await mailbox.syncOnce();
    let appliedFromPeers = 0;
    if (result.applied > 0) {
      const fresh = await store.listOperationsSince(householdKeys.householdId, beforeVv);
      appliedFromPeers = fresh.length;
      if (fresh.length > 0) {
        // The OpLog projection handler already merged these into the ledger
        // inside applyRemote(); this persists the merged rows.
        await noteRemoteHealthOpsApplied(fresh);
        // A peer's ops carry its TOMBSTONES, so this is the one moment this
        // device learns that rows it holds attachments for are gone. Nothing
        // else on this side ever hears about those bytes: the decrypted
        // plaintext would sit in `cacheDirectory` indefinitely for a photo the
        // member deleted on their other device.
        //
        // Not awaited, and debounced inside the scheduler — a catch-up round
        // applies ops in the hundreds and must not put a filesystem scan behind
        // each one. It never throws and never releases the remote object (a
        // device that has not caught up would tombstone live bytes), so there
        // is nothing here for the sync round to handle.
        void scheduleHealthBlobReconcile({ reason: 'sync' });
      }
    }

    status.setResult({
      // What genuinely still has to leave this device — not the size of the log,
      // which is why a naive count claims thousands of pending items.
      pendingOutbound: await mailbox.pendingOutboundCount(),
      lastTransport: 'mailbox',
      lastSyncedAt: Date.now(),
      lastAppliedFromPeers: appliedFromPeers,
      peersOnline: peerDeviceIds.length,
    });
    // Counts only. Never a row, a value or a date: this line reaches logs, and
    // Health's denylist (Appendix C.1) is not satisfied by "it is only a debug
    // string".
    console.log(
      `[HealthLocal] sync applied=${appliedFromPeers} pushedOps=${result.pushedOps} chunks=${result.chunks} skippedPeers=${result.skippedPeers} pages=${result.pages} devices=${peerDeviceIds.length}`,
    );
    recordE2EPersistEntry({
      store: 'health_mailbox',
      operation: 'sync',
      detail: `applied=${appliedFromPeers} deposited=${result.deposited} pushedOps=${result.pushedOps} acked=${result.acked}`,
    });

    try {
      await maybePublishHealthCheckpoint();
    } catch (error) {
      console.warn('[health.local] checkpoint publish skipped', error);
    }
    await maybeCompactHealthLogAfterSync();

    status.setResult({ lastError: null, lastErrorCode: null });
    status.setPhase('ok');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync_failed';
    const code = classifySyncError(error);
    // Log the raw message; surface only the code. A payload_too_large is
    // permanent until the batch is bounded, so it must not read as "offline",
    // and a 403 from `deviceBelongsToUser` must not read as one either.
    console.warn(`[health.local] sync failed code=${code}`, message);
    status.setResult({ phase: 'error', lastError: message, lastErrorCode: code });
    recordE2EPersistEntry({
      store: 'health_mailbox',
      operation: 'sync',
      detail: `FAIL code=${code}`,
    });
  }
}
