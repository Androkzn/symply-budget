/**
 * He8 — what happens when the new household key does NOT reach a device
 * (plan §5).
 *
 * This is the half that decides whether rotation is safe to ship. Health is a
 * personal ledger: one `user_id`, N devices (plan §1.2), no second member to
 * re-invite anyone from, and `enrolThisDeviceInHealthHousehold` REFUSES a device
 * that already holds rows — so "set it up again" is not a recovery, it is a
 * wipe. A peer left without the new key must therefore be recoverable **from
 * this side, automatically**, or the rotation is a data-loss bug wearing a
 * security feature's clothes.
 *
 * The design under test:
 *  - rotation is unconditional once the control plane has removed the device,
 *    because a rotation contingent on a successful deposit fails OPEN on a relay
 *    outage — the revoked device would keep a live key;
 *  - the devices a deposit could not reach are queued **durably**, written
 *    before the new key is installed, so a crash cannot lose the fact that a
 *    peer is owed one;
 *  - `redeliverHealthHouseholdKey()` runs on every sync round and re-deposits
 *    the LIVE key, which is the only path a peer that was offline during the
 *    rotation ever gets it.
 *
 * Static imports only: `await import()` throws under this Jest config.
 */
const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
const mockApiPut = jest.fn();
const mockApiDelete = jest.fn();

jest.mock('@api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: (...args: unknown[]) => mockApiPut(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  },
}));

import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  generateDeviceIdentity,
  hexToBytes,
  unwrapHouseholdDataKey,
  utf8Encode,
  wrapHouseholdDataKey,
  type DeviceIdentity,
} from '@symply/local-first';

import type { ControlPlaneHealthState } from '../controlPlaneClient';
import {
  closeLocalHealthSession,
  getLocalHealthHouseholdKeys,
  getLocalHealthIdentity,
  getLocalHealthRetiredKeyEpochs,
  openLocalHealthSession,
  resetLocalHealthSession,
} from '../engine';
import {
  readPendingHealthKeyDelivery,
  redeliverHealthHouseholdKey,
  revokeHealthLocalFirstDeviceAndRotateKey,
} from '../sync/hdkRotation';
import { tryAcceptHealthHdkFromMailbox } from '../sync/hdkTransfer';

const USER = 'user_health_delivery';
const WRAP_PREFIX = 'HDK_WRAP_V1:';

/** Two other phones, so "partial" can mean one of two rather than none at all. */
const PEER_A = generateDeviceIdentity('dev_peer_a');
const PEER_B = generateDeviceIdentity('dev_peer_b');
const REVOKED = generateDeviceIdentity('dev_revoked');
/** The device that enrolled this one — the sender of an enrolment wrap. */
const FIRST = generateDeviceIdentity('dev_first');

type MailboxDeposit = {
  recipientDeviceId: string | null;
  sourceDeviceId: string;
  ciphertextBase64: string;
};

function deviceRow(identity: DeviceIdentity, status: 'active' | 'revoked') {
  return {
    deviceId: identity.deviceId,
    userId: USER,
    signingPublicKey: bytesToHex(identity.signingPublicKey),
    agreementPublicKey: bytesToHex(identity.agreementPublicKey),
    status,
  };
}

function rosterState(options?: {
  keyEpoch?: number;
  active?: DeviceIdentity[];
  revoked?: DeviceIdentity[];
}): ControlPlaneHealthState {
  return {
    householdId: getLocalHealthHouseholdKeys().householdId,
    keyEpoch: options?.keyEpoch ?? 2,
    securityRevision: 2,
    members: [{ userId: USER, role: 'OWNER', status: 'active' }],
    devices: [
      deviceRow(getLocalHealthIdentity(), 'active'),
      ...(options?.active ?? [PEER_A, PEER_B]).map((peer) => deviceRow(peer, 'active')),
      ...(options?.revoked ?? [REVOKED]).map((peer) => deviceRow(peer, 'revoked')),
    ],
  };
}

function mailboxDeposits(): MailboxDeposit[] {
  return mockApiPost.mock.calls
    .filter(([url]) => String(url).endsWith('/mailbox'))
    .map(([, body]) => body as MailboxDeposit);
}

function depositsTo(deviceId: string): MailboxDeposit[] {
  return mailboxDeposits().filter((deposit) => deposit.recipientDeviceId === deviceId);
}

/** Open an envelope the way the receiving device's `hdkTransfer` would. */
function openEnvelope(deposit: MailboxDeposit, recipient: DeviceIdentity) {
  const bytes = base64ToBytes(deposit.ciphertextBase64);
  const parsed = JSON.parse(new TextDecoder().decode(bytes.slice(WRAP_PREFIX.length))) as {
    keyEpoch: number;
    householdId: string;
    recipientDeviceId: string;
    senderAgreementPublicKeyHex: string;
    wrappedHex: string;
  };
  const aad = `hdk-enrol:${parsed.householdId}:${parsed.keyEpoch}:${parsed.recipientDeviceId}`;
  return {
    keyEpoch: parsed.keyEpoch,
    hdk: unwrapHouseholdDataKey(
      hexToBytes(parsed.wrappedHex),
      recipient.agreementPrivateKey,
      hexToBytes(parsed.senderAgreementPublicKeyHex),
      aad,
    ),
  };
}

/** The mirror image: an envelope addressed TO this device, as a peer would send it. */
function envelopeForThisDevice(input: { sender: DeviceIdentity; keyEpoch: number; hdk: Uint8Array }) {
  const own = getLocalHealthIdentity();
  const householdId = getLocalHealthHouseholdKeys().householdId;
  const aad = `hdk-enrol:${householdId}:${input.keyEpoch}:${own.deviceId}`;
  const wrapped = wrapHouseholdDataKey(
    input.hdk,
    input.sender.agreementPrivateKey,
    own.agreementPublicKey,
    aad,
  );
  const payload = utf8Encode(
    JSON.stringify({
      kind: 'HDK_WRAP_V1',
      householdId,
      keyEpoch: input.keyEpoch,
      senderDeviceId: input.sender.deviceId,
      senderAgreementPublicKeyHex: bytesToHex(input.sender.agreementPublicKey),
      recipientDeviceId: own.deviceId,
      wrappedHex: bytesToHex(wrapped),
    }),
  );
  const envelope = new Uint8Array(WRAP_PREFIX.length + payload.length);
  envelope.set(utf8Encode(WRAP_PREFIX), 0);
  envelope.set(payload, WRAP_PREFIX.length);
  return bytesToBase64(envelope);
}

/** `apiClient.post` that fails only for deposits addressed to `deviceIds`. */
function failDepositsTo(...deviceIds: string[]): void {
  mockApiPost.mockImplementation(async (url: string, body: MailboxDeposit) => {
    if (String(url).endsWith('/mailbox') && deviceIds.includes(String(body.recipientDeviceId))) {
      throw new Error('relay refused the deposit');
    }
    return { data: { blob: { blobId: 'blob_1' } } };
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockApiGet.mockImplementation(async (url: string) => {
    if (String(url).endsWith('/state')) return { data: { state: rosterState() } };
    return { data: { blobs: [] } };
  });
  mockApiPost.mockResolvedValue({ data: { blob: { blobId: 'blob_1' } } });
  mockApiPut.mockResolvedValue({ data: {} });
  await resetLocalHealthSession();
  await openLocalHealthSession({ userId: USER });
  mockApiDelete.mockResolvedValue({ data: { state: rosterState() } });
});

afterEach(async () => {
  await resetLocalHealthSession();
});

describe('a delivery that only half worked', () => {
  it('still rotates, and remembers exactly who is owed the key', async () => {
    failDepositsTo(PEER_B.deviceId);

    const result = await revokeHealthLocalFirstDeviceAndRotateKey(REVOKED.deviceId);

    // Rotation is NOT conditional on the deposits: a relay that refuses one
    // envelope must not leave the revoked device holding a live key.
    expect(result.rotated).toBe(true);
    expect(getLocalHealthHouseholdKeys().keyEpoch).toBe(2);
    expect(getLocalHealthRetiredKeyEpochs()).toEqual([1]);

    expect(result.delivered).toEqual([PEER_A.deviceId]);
    expect(result.undelivered).toEqual([PEER_B.deviceId]);
    // The queue is the recovery path, so it has to name the failure — not "some
    // delivery failed", which nothing can act on.
    expect(await readPendingHealthKeyDelivery()).toEqual({
      keyEpoch: 2,
      deviceIds: [PEER_B.deviceId],
    });
  });

  it('keeps the queue across a cold open', async () => {
    // The app is backgrounded far more often than it is running when a relay
    // recovers. An in-memory queue would turn one failed deposit into a peer
    // that never hears about the rotation at all.
    failDepositsTo(PEER_B.deviceId);
    await revokeHealthLocalFirstDeviceAndRotateKey(REVOKED.deviceId);

    await closeLocalHealthSession();
    await openLocalHealthSession({ userId: USER });

    expect(getLocalHealthHouseholdKeys().keyEpoch).toBe(2);
    expect(await readPendingHealthKeyDelivery()).toEqual({
      keyEpoch: 2,
      deviceIds: [PEER_B.deviceId],
    });
  });

  it('recovers the missed device on the next round, with a usable key', async () => {
    failDepositsTo(PEER_B.deviceId);
    await revokeHealthLocalFirstDeviceAndRotateKey(REVOKED.deviceId);
    mockApiPost.mockClear();
    mockApiPost.mockResolvedValue({ data: { blob: { blobId: 'blob_2' } } });

    const outcome = await redeliverHealthHouseholdKey();

    expect(outcome.delivered).toEqual([PEER_B.deviceId]);
    expect(outcome.undelivered).toEqual([]);
    // Not "a deposit happened" — the bytes that arrive must actually be the key
    // this device is sealing under, or the peer is still stranded.
    const deposits = depositsTo(PEER_B.deviceId);
    expect(deposits).toHaveLength(1);
    const opened = openEnvelope(deposits[0], PEER_B);
    expect(opened.keyEpoch).toBe(getLocalHealthHouseholdKeys().keyEpoch);
    expect(opened.hdk).toEqual(getLocalHealthHouseholdKeys().hdk);
    // Nothing left owed, and the device that already had it is not re-sent it.
    expect(await readPendingHealthKeyDelivery()).toBeNull();
    expect(depositsTo(PEER_A.deviceId)).toEqual([]);
  });

  it('sends the LIVE key when a second rotation happened while one was queued', async () => {
    failDepositsTo(PEER_A.deviceId, PEER_B.deviceId);
    await revokeHealthLocalFirstDeviceAndRotateKey(REVOKED.deviceId);
    mockApiDelete.mockResolvedValue({ data: { state: rosterState({ keyEpoch: 3 }) } });
    await revokeHealthLocalFirstDeviceAndRotateKey('dev_another');
    expect(getLocalHealthHouseholdKeys().keyEpoch).toBe(3);

    mockApiPost.mockReset();
    mockApiPost.mockResolvedValue({ data: { blob: { blobId: 'blob_3' } } });
    await redeliverHealthHouseholdKey();

    // Re-sending the epoch the queue was written for would hand the peer a key
    // that is already retired here — it would install it, and immediately be a
    // rotation behind again.
    const opened = openEnvelope(depositsTo(PEER_A.deviceId)[0], PEER_A);
    expect(opened.keyEpoch).toBe(3);
    expect(opened.hdk).toEqual(getLocalHealthHouseholdKeys().hdk);
  });

  it('holds the queue when the control plane cannot be read', async () => {
    failDepositsTo(PEER_B.deviceId);
    await revokeHealthLocalFirstDeviceAndRotateKey(REVOKED.deviceId);
    mockApiGet.mockRejectedValue(new Error('offline'));

    const outcome = await redeliverHealthHouseholdKey();

    expect(outcome.delivered).toEqual([]);
    expect(outcome.undelivered).toEqual([PEER_B.deviceId]);
    expect(await readPendingHealthKeyDelivery()).toEqual({
      keyEpoch: 2,
      deviceIds: [PEER_B.deviceId],
    });
  });

  it('drops a queued device that has since been revoked, instead of re-arming it', async () => {
    failDepositsTo(PEER_B.deviceId);
    await revokeHealthLocalFirstDeviceAndRotateKey(REVOKED.deviceId);
    // PEER_B was revoked in the meantime — the retry must not hand it the key it
    // was just rotated away from, and must not retry it for ever either.
    mockApiGet.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/state')) {
        return { data: { state: rosterState({ active: [PEER_A], revoked: [REVOKED, PEER_B] }) } };
      }
      return { data: { blobs: [] } };
    });
    mockApiPost.mockClear();
    mockApiPost.mockResolvedValue({ data: { blob: { blobId: 'blob_4' } } });

    const outcome = await redeliverHealthHouseholdKey();

    expect(outcome).toEqual({ delivered: [], undelivered: [] });
    expect(mailboxDeposits()).toEqual([]);
    expect(await readPendingHealthKeyDelivery()).toBeNull();
  });

  it('costs nothing when nothing is owed', async () => {
    // This runs on every sync round, so the empty case must not add a request.
    await revokeHealthLocalFirstDeviceAndRotateKey(REVOKED.deviceId);
    expect(await readPendingHealthKeyDelivery()).toBeNull();
    mockApiGet.mockClear();
    mockApiPost.mockClear();

    const outcome = await redeliverHealthHouseholdKey();

    expect(outcome).toEqual({ delivered: [], undelivered: [] });
    expect(mockApiGet).not.toHaveBeenCalled();
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});

describe('the receiving side of a rotation', () => {
  function mailboxReturning(...blobs: Array<{ blobId: string; ciphertextBase64: string }>): void {
    mockApiGet.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/state')) return { data: { state: rosterState() } };
      return {
        data: {
          blobs: blobs.map((blob) => ({
            ...blob,
            recipientDeviceId: getLocalHealthIdentity().deviceId,
          })),
        },
      };
    });
  }

  it('installs a wrap for a NEWER epoch', async () => {
    const rotated = new Uint8Array(32).fill(9);
    mailboxReturning({
      blobId: 'blob_rotate',
      ciphertextBase64: envelopeForThisDevice({ sender: FIRST, keyEpoch: 2, hdk: rotated }),
    });

    expect(await tryAcceptHealthHdkFromMailbox()).toBe(true);
    expect(getLocalHealthHouseholdKeys().keyEpoch).toBe(2);
    expect(getLocalHealthHouseholdKeys().hdk).toEqual(rotated);
    expect(getLocalHealthRetiredKeyEpochs()).toEqual([1]);
  });

  it('ignores a replay of the epoch it already holds', async () => {
    // The mailbox is not ordered, and an unacked enrolment envelope can sit
    // ahead of a rotation one. Taking it would downgrade this device onto a key
    // the revoked device still has — a revoke that undoes itself on the next
    // sync.
    const stale = new Uint8Array(32).fill(1);
    const live = getLocalHealthHouseholdKeys().hdk;
    mailboxReturning({
      blobId: 'blob_stale',
      ciphertextBase64: envelopeForThisDevice({ sender: FIRST, keyEpoch: 1, hdk: stale }),
    });

    expect(await tryAcceptHealthHdkFromMailbox()).toBe(false);
    expect(getLocalHealthHouseholdKeys().hdk).toEqual(live);
    expect(getLocalHealthHouseholdKeys().keyEpoch).toBe(1);
    // Not acked either: acking is this function's "a key was consumed" signal.
    expect(
      mockApiPost.mock.calls.filter(([url]) => String(url).endsWith('/mailbox/ack')),
    ).toEqual([]);
  });

  it('does not walk backwards when a superseded wrap arrives after a rotation', async () => {
    const rotated = new Uint8Array(32).fill(9);
    mailboxReturning({
      blobId: 'blob_rotate',
      ciphertextBase64: envelopeForThisDevice({ sender: FIRST, keyEpoch: 2, hdk: rotated }),
    });
    await tryAcceptHealthHdkFromMailbox();

    mailboxReturning({
      blobId: 'blob_stale',
      ciphertextBase64: envelopeForThisDevice({
        sender: FIRST,
        keyEpoch: 1,
        hdk: new Uint8Array(32).fill(1),
      }),
    });

    expect(await tryAcceptHealthHdkFromMailbox()).toBe(false);
    expect(getLocalHealthHouseholdKeys().keyEpoch).toBe(2);
    expect(getLocalHealthHouseholdKeys().hdk).toEqual(rotated);
  });
});
