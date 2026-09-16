import {
  bytesToHex,
  hexToBytes,
  unwrapHouseholdDataKey,
  utf8Encode,
  wrapHouseholdDataKey,
} from '@symply/local-first';

import { ackMailboxBlobs, depositMailboxBlob, fetchMailboxBlobs } from '../controlPlaneClient';
import {
  getActiveHouseholdId,
  getLocalHouseSession,
  installHouseholdKeys,
  isLocalHouseSessionOpen,
  type HouseSessionHandle,
} from '../engine';

const WRAP_PREFIX = 'HDK_WRAP_V1:';

/**
 * The property an enrolment step is about, defaulted to the active one.
 *
 * Both directions then read the HDK off that property's session handle rather
 * than off `getLocalHouseholdKeys()`. The active accessor is the hazard the
 * whole per-property scoping exists for: an approve carried out for property B
 * while A is on screen would wrap **A's** HDK and hand a member of B the key to
 * a home they were never invited to — an isolation break that no later fix can
 * take back, because the key has left the device.
 *
 * Null only when this device holds no session at all, which every caller here
 * treats as "nothing to do" rather than as an error.
 */
function resolveHouseholdId(householdId?: string): string | null {
  return householdId ?? getActiveHouseholdId();
}

/** Owner: wrap the current HDK for an approved peer and deposit it in the ZK mailbox. */
export async function depositHdkForDevice(input: {
  recipientDeviceId: string;
  recipientAgreementPublicKeyHex: string;
  /** The property whose key is being shared. Defaults to the active one. */
  householdId?: string;
}): Promise<void> {
  if (!isLocalHouseSessionOpen()) return;
  const householdId = resolveHouseholdId(input.householdId);
  if (!householdId) return;
  const session = await getLocalHouseSession(householdId);
  const { identity, householdKeys: keys, retiredHouseholdKeys } = session;

  // A property this device has joined but not yet been enrolled into holds the
  // THROWAWAY key `adoptJoinedHousehold` mints, not the real HDK. Wrapping that
  // would enrol the peer onto a key nothing in the home is sealed under — it
  // would sync, ack, and read nothing, for ever, with no error anywhere.
  if (session.awaitingEnrolment) {
    console.warn('[house.local] HDK deposit skipped — not enrolled yet', householdId);
    return;
  }

  // `householdId` rather than `keys.householdId` throughout: the AAD and the
  // envelope must name the same property the session does, and the recipient
  // rebuilds the AAD from the envelope. One resolved id, used for both, is what
  // makes that round trip provable.
  const aad = `hdk-enrol:${householdId}:${keys.keyEpoch}:${input.recipientDeviceId}`;
  const wrapped = wrapHouseholdDataKey(
    keys.hdk,
    identity.agreementPrivateKey,
    hexToBytes(input.recipientAgreementPublicKeyHex),
    aad,
  );

  // THE WHOLE RING, not just the current epoch.
  //
  // Everything durable in a home is sealed under the epoch that was current when
  // it was written and is never re-sealed: ops carry their authoring epoch, and
  // a checkpoint carries the publisher's. So a member admitted to a home that
  // has rotated and handed only the current key can open NOTHING that predates
  // the last rotation — not the op backlog, not the checkpoint. They sync, ack
  // nothing, and sit on an empty ledger with no error anywhere.
  //
  // Each retired key is wrapped separately, under an AAD naming its own epoch,
  // so a recipient cannot be tricked into filing one epoch's key under another.
  const retiredWraps: Record<string, string> = {};
  for (const [epoch, hdk] of retiredHouseholdKeys) {
    if (epoch === keys.keyEpoch) continue;
    retiredWraps[String(epoch)] = bytesToHex(
      wrapHouseholdDataKey(
        hdk,
        identity.agreementPrivateKey,
        hexToBytes(input.recipientAgreementPublicKeyHex),
        `hdk-enrol:${householdId}:${epoch}:${input.recipientDeviceId}`,
      ),
    );
  }

  const payload = utf8Encode(
    JSON.stringify({
      kind: 'HDK_WRAP_V1',
      householdId,
      keyEpoch: keys.keyEpoch,
      senderDeviceId: identity.deviceId,
      senderAgreementPublicKeyHex: bytesToHex(identity.agreementPublicKey),
      recipientDeviceId: input.recipientDeviceId,
      wrappedHex: bytesToHex(wrapped),
      // Absent on a home that has never rotated, so the envelope stays
      // byte-identical to the one older builds produce.
      ...(Object.keys(retiredWraps).length > 0 ? { retiredWrappedHexByEpoch: retiredWraps } : {}),
    }),
  );
  const envelope = new Uint8Array(WRAP_PREFIX.length + payload.length);
  envelope.set(utf8Encode(WRAP_PREFIX), 0);
  envelope.set(payload, WRAP_PREFIX.length);
  // NAMED, not defaulted to the active property. `depositMailboxBlob` resolves
  // the URL from whatever is on screen otherwise, so approving into (or
  // rotating) a background home posted the wrap to a DIFFERENT home's mailbox —
  // where the recipient, polling the right one, never sees it.
  await depositMailboxBlob(envelope, input.recipientDeviceId, { householdId });
  // The one line that would find a missing enrolment in minutes. Its ABSENCE
  // from the owner's log is the tell. Epochs only — never key bytes.
  console.log(
    `[house.local] HDK wrap deposited hh=${householdId} to=${input.recipientDeviceId} epoch=${keys.keyEpoch} retiredEpochs=[${Object.keys(retiredWraps).join(',')}]`,
  );
}

/**
 * Bound on pages walked looking for the envelope. High enough to clear a mailbox
 * head full of op chunks a joiner cannot decrypt, low enough that a wedged relay
 * cannot spin here.
 */
const MAX_ENROLMENT_PAGES = 8;

/** Invitee: accept the HDK wrap from the mailbox and install it into the named session. */
export async function tryAcceptHdkFromMailbox(householdIdInput?: string): Promise<boolean> {
  if (!isLocalHouseSessionOpen()) return false;
  const householdId = resolveHouseholdId(householdIdInput);
  if (!householdId) return false;
  const { identity, ledger } = await getLocalHouseSession(householdId);
  const prefixBytes = utf8Encode(WRAP_PREFIX);

  // Every page, not just the first. Nothing orders the envelope ahead of op
  // batches — a peer addresses every device the control plane reports active,
  // which can precede approval — and a joiner holds no HDK, so it can neither
  // open nor ack those chunks. They stay at the head of its mailbox, and reading
  // page 1 alone leaves the member on "Waiting for approval…" for ever.
  let cursor: string | undefined;
  let blobsSeen = 0;
  let pagesWalked = 0;
  for (let page = 0; page < MAX_ENROLMENT_PAGES; page += 1) {
    const { blobs, hasMore, nextCursor } = await fetchMailboxBlobs(cursor, householdId);
    pagesWalked += 1;
    blobsSeen += blobs.length;
    const accepted = await tryAcceptFromPage(blobs, {
      identity,
      // Device-scoped, so any session answers the same — but taken from the
      // named one so nothing here can read a field off the active property.
      deviceId: ledger.deviceId,
      prefixBytes,
      householdId,
    });
    if (accepted) return true;
    if (!hasMore || !nextCursor) break;
    cursor = nextCursor;
  }
  // A member stuck on "Waiting for approval…" needs to know WHICH half is
  // missing: no envelope in the mailbox (the owner never deposited, or deposited
  // into the wrong property) versus an envelope that is there and will not
  // unwrap. `tryAcceptFromPage` reports the second; this reports the first, and
  // the blob count separates "empty mailbox" from "mail, but none of it for me".
  console.log(
    `[house.local] HDK wrap not found hh=${householdId} device=${ledger.deviceId} pages=${pagesWalked} blobsSeen=${blobsSeen}`,
  );
  return false;
}

async function tryAcceptFromPage(
  blobs: Array<{ blobId: string; ciphertext: Uint8Array }>,
  context: {
    identity: HouseSessionHandle['identity'];
    deviceId: string;
    prefixBytes: Uint8Array;
    householdId: string;
  },
): Promise<boolean> {
  const { identity, deviceId, prefixBytes, householdId } = context;

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
      senderDeviceId?: string;
      senderAgreementPublicKeyHex: string;
      recipientDeviceId: string;
      wrappedHex: string;
      retiredWrappedHexByEpoch?: Record<string, string>;
    };
    if (parsed.kind !== 'HDK_WRAP_V1') continue;
    if (parsed.recipientDeviceId !== deviceId) {
      // Somebody else's enrolment, sitting in a shared page. Logged because the
      // opposite case — our OWN wrap addressed to a device id we no longer use
      // after a reinstall — reads identically from the outside and strands the
      // member on "Waiting for approval…".
      console.log(
        `[house.local] HDK wrap for another device hh=${householdId} to=${parsed.recipientDeviceId} us=${deviceId}`,
      );
      continue;
    }
    // The envelope must name the property we are enrolling INTO.
    //
    // The fetch above is property-scoped now, so this can only fire on a
    // misaddressed deposit — but it is the check that makes that harmless, and
    // it is cheap. Installing another home's HDK here would seal every op this
    // home writes afterwards under a key its peers do not hold: silent,
    // undiagnosable divergence.
    if (parsed.householdId !== householdId) continue;

    const aad = `hdk-enrol:${parsed.householdId}:${parsed.keyEpoch}:${deviceId}`;
    let hdk: Uint8Array;
    try {
      hdk = unwrapHouseholdDataKey(
        hexToBytes(parsed.wrappedHex),
        identity.agreementPrivateKey,
        hexToBytes(parsed.senderAgreementPublicKeyHex),
        aad,
      );
    } catch (error) {
      // The envelope is ours and still will not open — the owner wrapped to a
      // keypair this device no longer holds (a reinstall between claim and
      // approve). Rethrown, but named first: unlogged it surfaces as a bare AEAD
      // failure inside a best-effort catch in the orchestrator and the member
      // just keeps waiting.
      console.warn(
        `[house.local] HDK wrap will not unwrap hh=${householdId} epoch=${parsed.keyEpoch} — wrapped to a keypair this device does not hold`,
        error,
      );
      throw error;
    }

    // Best-effort per epoch: a retired key that fails to unwrap costs this
    // device the history sealed under THAT epoch, and must not cost it the
    // enrolment. Everything from the current epoch onward still works.
    const retired = new Map<number, Uint8Array>();
    for (const [epochText, wrappedRetiredHex] of Object.entries(
      parsed.retiredWrappedHexByEpoch ?? {},
    )) {
      const epoch = Number(epochText);
      if (!Number.isInteger(epoch) || epoch >= parsed.keyEpoch) continue;
      try {
        retired.set(
          epoch,
          unwrapHouseholdDataKey(
            hexToBytes(wrappedRetiredHex),
            identity.agreementPrivateKey,
            hexToBytes(parsed.senderAgreementPublicKeyHex),
            `hdk-enrol:${parsed.householdId}:${epoch}:${deviceId}`,
          ),
        );
      } catch (error) {
        console.warn('[house.local] retired HDK skipped', householdId, epoch, error);
      }
    }

    await installHouseholdKeys(
      {
        householdId,
        hdk,
        keyEpoch: parsed.keyEpoch,
      },
      householdId,
      retired,
    );
    // Enrolment completing is the single most load-bearing event in a join. The
    // retired count is the part to watch: zero against a home above epoch 1
    // means this device can read only what was written since the last rotation.
    console.log(
      `[house.local] HDK installed hh=${householdId} epoch=${parsed.keyEpoch} retiredEpochs=[${[...retired.keys()].sort((a, b) => a - b).join(',')}] from=${parsed.senderDeviceId ?? 'unknown'}`,
    );
    await ackMailboxBlobs([blob.blobId], deviceId, householdId);
    return true;
  }
  return false;
}
