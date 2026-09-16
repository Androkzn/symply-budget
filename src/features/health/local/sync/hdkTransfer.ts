/**
 * Household-data-key handover to **another device of the same user** (plan §1.2,
 * §6 He5).
 *
 * Structurally identical to House's `sync/hdkTransfer.ts` — same envelope, same
 * X25519 wrap, same zero-knowledge mailbox — with one product difference that
 * changes nothing in the crypto and everything in the copy: the recipient is
 * never a *member*. A Health household has one `user_id` and N devices, so this
 * is "your other phone", and there is no invite-a-member flow to reach it from.
 *
 * The key never touches the relay in the clear: it is wrapped to the recipient
 * device's agreement public key, and the AAD binds the wrap to
 * `(householdId, keyEpoch, recipientDeviceId)` so an envelope cannot be replayed
 * at another device, another epoch, or another household.
 */
import {
  bytesToHex,
  hexToBytes,
  unwrapHouseholdDataKey,
  utf8Encode,
  wrapHouseholdDataKey,
} from '@symply/local-first';

import { ackHealthMailboxBlobs, depositHealthMailboxBlob, fetchHealthMailboxBlobs } from '../controlPlaneClient';
import {
  getLocalHealthHouseholdKeys,
  getLocalHealthIdentity,
  installHealthHouseholdKeys,
  isAwaitingHealthEnrolment,
  isLocalHealthSessionOpen,
} from '../engine';

const WRAP_PREFIX = 'HDK_WRAP_V1:';

/**
 * Wrap the CURRENT HDK for another device of this user and post it to the
 * mailbox.
 *
 * Two callers, one envelope: enrolment (`HealthOtherDeviceScreen`, after the
 * OOB approval) and rotation (`hdkRotation`, after a revoke). The `hdk-enrol:`
 * AAD label is historical and must stay — the receiver rebuilds the identical
 * string, so renaming it would make every envelope in flight unopenable — and
 * the epoch inside the AAD is what actually distinguishes the two cases.
 */
export async function depositHealthHdkForDevice(input: {
  recipientDeviceId: string;
  recipientAgreementPublicKeyHex: string;
}): Promise<void> {
  if (!isLocalHealthSessionOpen()) return;
  const identity = getLocalHealthIdentity();
  const keys = getLocalHealthHouseholdKeys();
  const aad = `hdk-enrol:${keys.householdId}:${keys.keyEpoch}:${input.recipientDeviceId}`;
  const wrapped = wrapHouseholdDataKey(
    keys.hdk,
    identity.agreementPrivateKey,
    hexToBytes(input.recipientAgreementPublicKeyHex),
    aad,
  );
  const payload = utf8Encode(
    JSON.stringify({
      kind: 'HDK_WRAP_V1',
      householdId: keys.householdId,
      keyEpoch: keys.keyEpoch,
      senderDeviceId: identity.deviceId,
      senderAgreementPublicKeyHex: bytesToHex(identity.agreementPublicKey),
      recipientDeviceId: input.recipientDeviceId,
      wrappedHex: bytesToHex(wrapped),
    }),
  );
  const envelope = new Uint8Array(WRAP_PREFIX.length + payload.length);
  envelope.set(utf8Encode(WRAP_PREFIX), 0);
  envelope.set(payload, WRAP_PREFIX.length);
  await depositHealthMailboxBlob(envelope, input.recipientDeviceId);
}

/**
 * Bound on pages walked looking for the envelope. High enough to clear a mailbox
 * head full of op chunks the joining device cannot decrypt, low enough that a
 * wedged relay cannot spin here.
 */
const MAX_ENROLMENT_PAGES = 8;

/**
 * Accept an HDK wrap addressed to this device and install it — enrolment's
 * "this device was approved", and rotation's "the key changed after a revoke".
 */
export async function tryAcceptHealthHdkFromMailbox(): Promise<boolean> {
  if (!isLocalHealthSessionOpen()) return false;
  const identity = getLocalHealthIdentity();
  const prefixBytes = utf8Encode(WRAP_PREFIX);
  // A device still waiting to be approved holds a placeholder key at epoch 1
  // and must take whatever the first device sends, including epoch 1. Every
  // other device already holds a real key, and for those the epoch is the only
  // thing separating a rotation from a REPLAY of a superseded envelope — which
  // an unacked enrolment blob sitting ahead in the mailbox is, and which would
  // otherwise downgrade this device onto a key the revoked one still has.
  const awaitingEnrolment = isAwaitingHealthEnrolment();
  const liveKeyEpoch = getLocalHealthHouseholdKeys().keyEpoch;

  // Every page, not just the first. Nothing orders the envelope ahead of op
  // batches — the enrolled device addresses every device the control plane
  // reports active, which can precede approval — and a joiner holds no HDK, so
  // it can neither open nor ack those chunks. They stay at the head of its
  // mailbox, and reading page 1 alone leaves it on "Waiting for approval…" for
  // ever.
  let cursor: string | undefined;
  for (let page = 0; page < MAX_ENROLMENT_PAGES; page += 1) {
    const { blobs, hasMore, nextCursor } = await fetchHealthMailboxBlobs(cursor);
    const accepted = await tryAcceptFromPage(blobs, {
      identity,
      deviceId: identity.deviceId,
      prefixBytes,
      awaitingEnrolment,
      liveKeyEpoch,
    });
    if (accepted) return true;
    if (!hasMore || !nextCursor) break;
    cursor = nextCursor;
  }
  return false;
}

async function tryAcceptFromPage(
  blobs: Array<{ blobId: string; ciphertext: Uint8Array }>,
  context: {
    identity: ReturnType<typeof getLocalHealthIdentity>;
    deviceId: string;
    prefixBytes: Uint8Array;
    awaitingEnrolment: boolean;
    liveKeyEpoch: number;
  },
): Promise<boolean> {
  const { identity, deviceId, prefixBytes, awaitingEnrolment, liveKeyEpoch } = context;

  for (const blob of blobs) {
    if (blob.ciphertext.length < prefixBytes.length) continue;
    let match = true;
    for (let i = 0; i < prefixBytes.length; i += 1) {
      if (blob.ciphertext[i] !== prefixBytes[i]) {
        match = false;
        break;
      }
    }
    if (!match) continue;

    const text = new TextDecoder().decode(blob.ciphertext.slice(prefixBytes.length));
    const parsed = JSON.parse(text) as {
      kind: string;
      householdId: string;
      keyEpoch: number;
      senderAgreementPublicKeyHex: string;
      recipientDeviceId: string;
      wrappedHex: string;
    };
    if (parsed.kind !== 'HDK_WRAP_V1') continue;
    if (parsed.recipientDeviceId !== deviceId) continue;
    // Left unacked deliberately: acking is this function's signal that a key was
    // consumed, and a superseded envelope was not. It expires with the mailbox
    // TTL, and the scan is bounded either way.
    if (!awaitingEnrolment && !(parsed.keyEpoch > liveKeyEpoch)) continue;

    const aad = `hdk-enrol:${parsed.householdId}:${parsed.keyEpoch}:${deviceId}`;
    const hdk = unwrapHouseholdDataKey(
      hexToBytes(parsed.wrappedHex),
      identity.agreementPrivateKey,
      hexToBytes(parsed.senderAgreementPublicKeyHex),
      aad,
    );

    // `installHealthHouseholdKeys` takes the HDK as HEX and derives the
    // household id from the open session — passing raw bytes and an explicit
    // householdId silently installed `undefined` as the key.
    await installHealthHouseholdKeys({
      hdkHex: bytesToHex(hdk),
      keyEpoch: parsed.keyEpoch,
    });
    await ackHealthMailboxBlobs([blob.blobId], deviceId);
    return true;
  }
  return false;
}
