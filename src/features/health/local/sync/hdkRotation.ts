/**
 * Household-data-key ROTATION on device revoke — stage He8 (plan §5), the half
 * the retired-key ring in `engine.ts` was built for and nothing filled.
 *
 * WHY THIS IS NOT IN `controlPlaneClient.ts`
 * ------------------------------------------
 * Rotation needs the mailbox wrap (`./hdkTransfer`), and `hdkTransfer` imports
 * the control-plane client — so putting this there would close an import cycle
 * that House only escapes with a dynamic `await import()`
 * (`house/local/controlPlaneClient.ts:375`), which throws under this repo's Jest
 * config. Health already made the same call once, for the same reason, in
 * `HealthOtherDeviceScreen.tsx:455`. So the control-plane client keeps the
 * transport half (`revokeHealthLocalFirstDevice`, the raw DELETE) and this
 * module owns the security half.
 *
 * THE ORDER, AND WHY IT IS THIS ONE
 * ---------------------------------
 * Revoke is **rotate-then-deliver**, and the sequence is:
 *
 *   1. `DELETE /v2/…/devices/:id` — the Worker marks the device revoked and
 *      bumps `key_epoch` + `security_revision`
 *      (`household-coordinator.ts:237-240`), returning the post-revoke roster.
 *      If this fails nothing local has changed: rotating anyway would cut a peer
 *      off while the device being removed is still enrolled and still syncing.
 *   2. Persist the delivery queue — the remaining devices, BEFORE the new key
 *      exists locally. A crash between installing and depositing would otherwise
 *      lose the only record that a peer still needs the key.
 *   3. Mint a fresh random HDK at the new epoch and install it through
 *      `installHealthHouseholdKeys`, which retires the outgoing key into the
 *      bounded ring (`HEALTH_RETAINED_KEY_EPOCHS`) so attachments sealed before
 *      the rotation keep opening.
 *   4. Deposit the new key, wrapped per recipient, into the zero-knowledge
 *      mailbox — one envelope per remaining device, never to the revoked one.
 *   5. Rewrite the queue with whatever did not go out.
 *
 * **Deliver-then-rotate was rejected.** Making the rotation conditional on a
 * successful deposit means a relay outage, or a peer the roster cannot be read
 * for, leaves the household on the epoch the revoked device holds — i.e. the
 * revoke is cosmetic, which is the exact defect this stage closes. Security
 * cannot fail open on a transport error. Note the *window* is identical either
 * way: a peer installs asynchronously, on its next sync, so there is no ordering
 * in which every device changes key at the same instant.
 *
 * WHAT A DEVICE THAT MISSED THE NEW KEY LOSES, AND HOW IT GETS BACK
 * -----------------------------------------------------------------
 * Health is personal — one `user_id`, N devices (plan §1.2) — so the peer that
 * missed the rotation may be the member's ONLY other copy, and there is no
 * second user to re-invite it from. `enrolThisDeviceInHealthHousehold` refuses a
 * device that already holds rows, so "just enrol it again" is not a recovery,
 * it is a wipe. That constrains the design: **nothing here may ever leave a peer
 * in a state only re-enrolment can fix.**
 *
 * It does not, because a peer that misses the envelope keeps everything it has:
 *  - its rows are sealed under its own device DEK, not the HDK, so they are
 *    untouched;
 *  - blobs it holds at epoch ≤ N still open — it keeps that key as its live one;
 *  - what it cannot read is ops and checkpoints this device writes at N+1, and
 *    what this device cannot read is ops the peer authors at N. That gap closes
 *    the moment the key lands; the ops that crossed it reconverge through the
 *    next checkpoint (`sync/checkpoints.ts`), which is republished under the
 *    live epoch.
 *
 * Recovery is `redeliverHealthHouseholdKey()`, called on every sync round. It is
 * free when there is nothing to do — the queue is local — and when there is, it
 * re-reads the roster and re-deposits the LIVE key. Mailbox blobs survive until
 * acked, so an offline peer picks the envelope up whenever it next syncs; the
 * failure this repairs is the one where the deposit itself never happened.
 */
import { bytesToHex, generateHouseholdKeys } from '@symply/local-first';

import {
  fetchHealthControlPlaneState,
  revokeHealthLocalFirstDevice,
  type ControlPlaneHealthState,
} from '../controlPlaneClient';
import {
  getLocalHealthHouseholdKeys,
  getLocalHealthIdentity,
  getLocalHealthStore,
  installHealthHouseholdKeys,
  isLocalHealthSessionOpen,
} from '../engine';

import { depositHealthHdkForDevice } from './hdkTransfer';

/**
 * Devices the current key still has to reach, in the local store's meta table.
 *
 * Durable on purpose: the app is backgrounded far more often than it is running
 * when a relay recovers, and an in-memory list would turn "the deposit failed
 * once" into "this device never hears about the rotation".
 */
export const HEALTH_PENDING_KEY_DELIVERY_META = 'health.hdk.pending_delivery.v1';

export type PendingHealthKeyDelivery = {
  /** Epoch this queue was written for — diagnostics; delivery always sends live. */
  keyEpoch: number;
  deviceIds: string[];
};

export type HealthKeyDelivery = {
  /** Devices whose wrapped envelope the relay accepted. */
  delivered: string[];
  /** Devices still owed the key — queued, retried on the next sync. */
  undelivered: string[];
};

export type HealthKeyRotation = HealthKeyDelivery & {
  /** The control plane's post-revoke state, as the DELETE returned it. */
  state: ControlPlaneHealthState;
  rotated: boolean;
  /** The epoch now live on this device. */
  keyEpoch: number;
};

type Recipient = { deviceId: string; agreementPublicKey: string };

/**
 * The devices a new key legitimately goes to: this user's OWN other devices,
 * still active, minus the one being revoked.
 *
 * The `userId` filter is the same rule `readHealthPeers` re-derives in the
 * orchestrator and for the same reason — a personal household's only protection
 * against a second account is the control plane's refusal to admit one (He5), so
 * the client checks locally too rather than wrapping the household key to a
 * stranger's public key. The revoked id is excluded explicitly as well as by
 * status: a stale or partial state must not be able to re-arm the device this
 * call just removed.
 */
function remainingDevices(
  state: ControlPlaneHealthState | null | undefined,
  options: { ownDeviceId: string; revokedDeviceId?: string },
): Recipient[] {
  const devices = state?.devices ?? [];
  const ownUserId = devices.find((device) => device.deviceId === options.ownDeviceId)?.userId;
  const recipients: Recipient[] = [];

  for (const device of devices) {
    if (device.deviceId === options.ownDeviceId) continue;
    if (device.deviceId === options.revokedDeviceId) continue;
    if (device.status !== 'active') continue;
    if (ownUserId && device.userId && device.userId !== ownUserId) {
      console.warn('[health.local] refusing to hand the household key to another user');
      continue;
    }
    // Nothing to wrap to. Skipped rather than queued: re-delivery would fail
    // identically every round, and the device cannot be reached until it
    // re-registers a key.
    if (!device.agreementPublicKey) {
      console.warn('[health.local] device has no agreement key; cannot hand it the household key');
      continue;
    }
    recipients.push({
      deviceId: device.deviceId,
      agreementPublicKey: device.agreementPublicKey,
    });
  }
  return recipients;
}

/** The queue, or null when nothing is owed. Never throws — this runs on sync. */
export async function readPendingHealthKeyDelivery(): Promise<PendingHealthKeyDelivery | null> {
  if (!isLocalHealthSessionOpen()) return null;
  try {
    const raw = await getLocalHealthStore().getMeta(HEALTH_PENDING_KEY_DELIVERY_META);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingHealthKeyDelivery>;
    const deviceIds = (Array.isArray(parsed.deviceIds) ? parsed.deviceIds : []).filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    if (deviceIds.length === 0) return null;
    return { keyEpoch: Number(parsed.keyEpoch) || 0, deviceIds };
  } catch (error) {
    // An unreadable queue must not wedge sync. The cost of losing it is one
    // peer that stays a rotation behind until the next rotation re-queues it.
    console.warn('[health.local] unreadable key-delivery queue', error);
    return null;
  }
}

/** Written empty rather than deleted — the store's meta table has no delete. */
async function writePendingDelivery(pending: PendingHealthKeyDelivery | null): Promise<void> {
  const value = pending && pending.deviceIds.length > 0 ? JSON.stringify(pending) : '';
  await getLocalHealthStore().setMeta(HEALTH_PENDING_KEY_DELIVERY_META, value);
}

/**
 * Deposit the live HDK for each recipient, one envelope each.
 *
 * Serial, not `Promise.all`: a personal household has one or two other devices,
 * and a serial loop keeps "which one failed" unambiguous — which is the whole
 * point of the queue this feeds.
 */
async function deliverToRecipients(recipients: Recipient[]): Promise<HealthKeyDelivery> {
  const delivered: string[] = [];
  const undelivered: string[] = [];

  for (const recipient of recipients) {
    try {
      await depositHealthHdkForDevice({
        recipientDeviceId: recipient.deviceId,
        recipientAgreementPublicKeyHex: recipient.agreementPublicKey,
      });
      delivered.push(recipient.deviceId);
    } catch (error) {
      // Not fatal and not silent: the device stays queued, and the next sync
      // round tries again.
      console.warn('[health.local] household key handover failed; queued for retry', error);
      undelivered.push(recipient.deviceId);
    }
  }
  return { delivered, undelivered };
}

/**
 * Sign one of this user's own devices out **and rotate the household key away
 * from it** — the call every caller wants. `revokeHealthLocalFirstDevice` on its
 * own only removes the control-plane row; the revoked device would keep a key
 * that opens everything written afterwards.
 *
 * Revoking the LAST other device is a normal outcome here, not an error: Health
 * is personal, so a household with one device left is the ordinary steady state.
 * The rotation still happens — there is nobody to deliver to, and the point of
 * the rotation is what the removed device can no longer read.
 */
export async function revokeHealthLocalFirstDeviceAndRotateKey(
  deviceId: string,
): Promise<HealthKeyRotation> {
  // Read the session BEFORE the network call: a closed session must fail here,
  // not after the control plane has already removed the device.
  const identity = getLocalHealthIdentity();
  const current = getLocalHealthHouseholdKeys();

  const state = await revokeHealthLocalFirstDevice(deviceId);

  if (deviceId === identity.deviceId) {
    // Signing THIS device out. Rotating would mint a key only this device holds
    // and then hand it to peers from a device the relay has just stopped
    // trusting — the deposits would 403 and the peers would be stranded. Local
    // teardown (`resetLocalHealthSession`) is the path for leaving.
    return { state, rotated: false, keyEpoch: current.keyEpoch, delivered: [], undelivered: [] };
  }

  const recipients = remainingDevices(state, {
    ownDeviceId: identity.deviceId,
    revokedDeviceId: deviceId,
  });

  // The server's counter is the floor, not the value: it serialises two
  // concurrent revokes onto different epochs, so the later rotation always lands
  // strictly above the earlier one and both devices converge on it. `+ 1` is the
  // fallback for a response that did not carry the bump — the security property
  // is a NEW random key at a STRICTLY GREATER epoch, never the server's number.
  const keyEpoch = Math.max(Number(state?.keyEpoch) || 0, current.keyEpoch + 1);

  await writePendingDelivery({ keyEpoch, deviceIds: recipients.map((r) => r.deviceId) });

  const next = generateHouseholdKeys(current.householdId, keyEpoch);
  // The engine retires `current` into the bounded ring on the way through, which
  // is what keeps blobs sealed at the old epoch readable.
  await installHealthHouseholdKeys({ hdkHex: bytesToHex(next.hdk), keyEpoch });

  const outcome = await deliverToRecipients(recipients);
  await writePendingDelivery(
    outcome.undelivered.length > 0 ? { keyEpoch, deviceIds: outcome.undelivered } : null,
  );

  return { state, rotated: true, keyEpoch, ...outcome };
}

/**
 * Retry the handover for any device still owed the current household key.
 *
 * Called from the sync round, so the cheap path matters: with an empty queue
 * this reads one local meta row and makes no request at all. With a non-empty
 * one it re-reads the roster first, because a device revoked since the rotation
 * must never be handed the key by a retry.
 *
 * Always sends the LIVE key, not the one the queue was written for: a peer needs
 * whatever epoch this device is sealing under now, and a second rotation while
 * the first was still queued would otherwise deliver a key that is already
 * retired.
 */
export async function redeliverHealthHouseholdKey(): Promise<HealthKeyDelivery> {
  const nothing: HealthKeyDelivery = { delivered: [], undelivered: [] };
  if (!isLocalHealthSessionOpen()) return nothing;

  const pending = await readPendingHealthKeyDelivery();
  if (!pending) return nothing;

  const keys = getLocalHealthHouseholdKeys();
  const identity = getLocalHealthIdentity();

  let state: ControlPlaneHealthState;
  try {
    state = await fetchHealthControlPlaneState(keys.householdId);
  } catch (error) {
    // Offline, or the control plane refused. The queue stands.
    console.warn('[health.local] key re-delivery deferred; control plane unreadable', error);
    return { delivered: [], undelivered: pending.deviceIds };
  }

  const queued = new Set(pending.deviceIds);
  const recipients = remainingDevices(state, { ownDeviceId: identity.deviceId }).filter(
    (recipient) => queued.has(recipient.deviceId),
  );

  const outcome = await deliverToRecipients(recipients);
  // Anything queued that the roster no longer reports as an active device of
  // this user is DROPPED, not carried: it was revoked in the meantime, and a
  // queue that retried it forever would be trying to hand the household key to
  // exactly the device the rotation was for.
  await writePendingDelivery(
    outcome.undelivered.length > 0
      ? { keyEpoch: keys.keyEpoch, deviceIds: outcome.undelivered }
      : null,
  );
  return outcome;
}
