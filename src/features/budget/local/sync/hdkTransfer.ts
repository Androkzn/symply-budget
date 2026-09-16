import {
  bytesToHex,
  hexToBytes,
  unwrapHouseholdDataKey,
  utf8Encode,
  wrapHouseholdDataKey,
} from '@symply/local-first';

import { ackMailboxBlobs, depositMailboxBlob, fetchMailboxBlobs, fetchControlPlaneState } from '../controlPlaneClient';
import {
  getActiveBudgetHouseholdId,
  getLocalBudgetSession,
  installHouseholdKeys,
  isLocalBudgetSessionOpen,
  type BudgetSessionHandle,
} from '../engine';

const WRAP_PREFIX = 'HDK_WRAP_V1:';

/**
 * The household an enrolment step is about, defaulted to the active one.
 *
 * Both directions then read the HDK off that household's session handle rather
 * than off `getLocalHouseholdKeys()` (BR-016 §B3). The active accessor is the
 * hazard the whole stage exists for: an approve carried out for household B
 * while A is on screen would wrap **A's** HDK and hand a member of B the key to
 * a budget they were never invited to — an isolation break that no later fix
 * can take back, because the key has left the device.
 *
 * Null only when this device holds no session at all, which every caller here
 * treats as "nothing to do" rather than as an error.
 */
function resolveHouseholdId(householdId?: string): string | null {
  return householdId ?? getActiveBudgetHouseholdId();
}

/** Owner: wrap current HDK for an approved peer and deposit in ZK mailbox. */
export async function depositHdkForDevice(input: {
  recipientDeviceId: string;
  recipientAgreementPublicKeyHex: string;
  /** The household whose key is being shared. Defaults to the active one. */
  householdId?: string;
}): Promise<void> {
  if (!isLocalBudgetSessionOpen()) return;
  const householdId = resolveHouseholdId(input.householdId);
  if (!householdId) return;
  const session = await getLocalBudgetSession(householdId);
  const { identity, householdKeys: keys, retiredHouseholdKeys } = session;

  // A household this device has joined but not yet been enrolled into holds the
  // THROWAWAY key `adoptJoinedHousehold` mints, not the real HDK. Wrapping that
  // would enrol the peer onto a key nothing in the household is sealed under —
  // it would sync, ack, and read nothing, for ever, with no error anywhere.
  if (session.awaitingEnrolment) {
    console.warn('[budget.local] HDK deposit skipped — not enrolled yet', householdId);
    return;
  }

  // `householdId` rather than `keys.householdId` throughout: the AAD and the
  // envelope must name the same household the session does, and the recipient
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
  // Everything durable in a household is sealed under the epoch that was
  // current when it was written and is never re-sealed: ops carry their
  // authoring epoch, and a checkpoint carries the publisher's. So a member
  // admitted to a household that has rotated and handed only the current key
  // can open NOTHING that predates the last rotation — not the op backlog, not
  // the checkpoint. They sync, ack nothing, and sit on an empty ledger with no
  // error anywhere. That is what happened on `Sweet Home` (epoch 5).
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
      // Absent on a household that has never rotated, so the envelope stays
      // byte-identical to the one older builds produce.
      ...(Object.keys(retiredWraps).length > 0 ? { retiredWrappedHexByEpoch: retiredWraps } : {}),
    }),
  );
  const envelope = new Uint8Array(WRAP_PREFIX.length + payload.length);
  envelope.set(utf8Encode(WRAP_PREFIX), 0);
  envelope.set(payload, WRAP_PREFIX.length);
  // NAMED, not defaulted to the active household. `depositMailboxBlob` resolves
  // the URL from whatever is on screen otherwise, so approving into (or
  // rotating) a background household posted the wrap to a DIFFERENT household's
  // mailbox — where the recipient, polling the right one, never sees it.
  await depositMailboxBlob(envelope, input.recipientDeviceId, { householdId });
  // The one line that would have found this in minutes. Its ABSENCE from the
  // owner's log is the tell: production had no HDK-wrap blob in the mailbox
  // table at all, and nothing anywhere said whether one had been attempted.
  // Epochs only — never key bytes.
  console.log(
    `[budget.local] HDK wrap deposited hh=${householdId} to=${input.recipientDeviceId} epoch=${keys.keyEpoch} retiredEpochs=[${Object.keys(retiredWraps).join(',')}]`,
  );
}

/**
 * Bound on pages walked looking for the envelope. High enough to clear a mailbox
 * head full of op chunks a joiner cannot decrypt, low enough that a wedged relay
 * cannot spin here.
 */
const MAX_ENROLMENT_PAGES = 8;

/** Invitee: accept HDK wrap from mailbox and install into the named session. */
export async function tryAcceptHdkFromMailbox(householdIdInput?: string): Promise<boolean> {
  if (!isLocalBudgetSessionOpen()) return false;
  const householdId = resolveHouseholdId(householdIdInput);
  if (!householdId) return false;
  const { identity, ledger } = await getLocalBudgetSession(householdId);
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
      // named one so nothing here can read a field off the active household.
      deviceId: ledger.deviceId,
      prefixBytes,
      householdId,
    });
    if (accepted) return true;
    if (!hasMore || !nextCursor) break;
    cursor = nextCursor;
  }
  // A member stuck on "Waiting for approval…" needs to know WHICH half is
  // missing: no envelope in the mailbox (the owner never deposited, or
  // deposited into the wrong household) versus an envelope that is there and
  // will not unwrap. `tryAcceptFromPage` reports the second; this reports the
  // first, and the blob count separates "empty mailbox" from "mail, but none
  // of it for me".
  console.log(
    `[budget.local] HDK wrap not found hh=${householdId} device=${ledger.deviceId} pages=${pagesWalked} blobsSeen=${blobsSeen}`,
  );
  return false;
}

async function tryAcceptFromPage(
  blobs: Array<{ blobId: string; ciphertext: Uint8Array }>,
  context: {
    identity: BudgetSessionHandle['identity'];
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
    let value: unknown;
    try { value = JSON.parse(text); } catch {
      console.warn(`[budget.local] malformed HDK envelope skipped hh=${householdId}`);
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const parsed = value as {
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
        `[budget.local] HDK wrap for another device hh=${householdId} to=${parsed.recipientDeviceId} us=${deviceId}`,
      );
      continue;
    }
    // The envelope must name the household we are enrolling INTO.
    //
    // The fetch above is household-scoped now, so this can only fire on a
    // misaddressed deposit — but it is the check that makes that harmless, and
    // it is cheap. Installing another household's HDK here would seal every op
    // this household writes afterwards under a key its peers do not hold:
    // silent, undiagnosable divergence.
    if (parsed.householdId !== householdId) continue;

    if (!Number.isSafeInteger(parsed.keyEpoch) || parsed.keyEpoch < 1 ||
        typeof parsed.senderAgreementPublicKeyHex !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(parsed.senderAgreementPublicKeyHex)) continue;
    // The envelope's claimed identity is not an authority. Bind it to the
    // authenticated household roster before accepting any key material.
    const state = await fetchControlPlaneState(householdId);
    const sender = state.devices.find((device) => device.deviceId === parsed.senderDeviceId);
    if (state.householdId !== householdId || parsed.keyEpoch !== state.keyEpoch ||
        !sender || sender.status !== 'active' ||
        sender.agreementPublicKey.toLowerCase() !== parsed.senderAgreementPublicKeyHex.toLowerCase() ||
        !state.members.some((member) => member.userId === sender.userId && member.status === 'active')) {
      console.warn(`[budget.local] untrusted or stale HDK envelope skipped hh=${householdId}`);
      continue;
    }
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
      // approve). Rethrown, but named first: unlogged it surfaced as a bare
      // AEAD failure inside a best-effort catch in the orchestrator and the
      // member just kept waiting.
      console.warn(
        `[budget.local] HDK wrap will not unwrap hh=${householdId} epoch=${parsed.keyEpoch} — wrapped to a keypair this device does not hold`,
        error,
      );
      continue;
    }

    // Best-effort per epoch: a retired key that fails to unwrap costs this
    // device the history sealed under THAT epoch, and must not cost it the
    // enrolment. Everything from the current epoch onward still works.
    const retired = new Map<number, Uint8Array>();
    for (const [epochText, wrappedRetiredHex] of Object.entries(
      parsed.retiredWrappedHexByEpoch ?? {},
    )) {
      const epoch = Number(epochText);
      if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch >= parsed.keyEpoch) continue;
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
        console.warn('[budget.local] retired HDK skipped', householdId, epoch, error);
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
    // Enrolment completing is the single most load-bearing event in a join, and
    // it used to happen in total silence. The retired count is the part to
    // watch: zero against a household above epoch 1 means this device can read
    // only what was written since the last rotation.
    console.log(
      `[budget.local] HDK installed hh=${householdId} epoch=${parsed.keyEpoch} retiredEpochs=[${[...retired.keys()].sort((a, b) => a - b).join(',')}] from=${parsed.senderDeviceId ?? 'unknown'}`,
    );
    await ackMailboxBlobs([blob.blobId], deviceId, householdId);
    return true;
  }
  return false;
}
