/**
 * He8 — revoking a device rotates the household data key (plan §5).
 *
 * **The defect this closes.** `revokeHealthLocalFirstDevice` removed a device
 * from the control plane and stopped there. The removed device kept the HDK it
 * had already been handed, which decrypts every row and every blob it can still
 * reach — so a "revoke" on a health surface bought nothing cryptographic, and
 * the bounded retired-key ring the engine grew for exactly this
 * (`HEALTH_RETAINED_KEY_EPOCHS`) had nothing to retire because nothing rotated.
 *
 * Against the REAL engine, not a re-implementation of its rules: under Jest
 * `openHealthLocalFirstStore` returns a process-lifetime `MemoryLocalFirstStore`
 * and the DEK lives in the same module, so `installHealthHouseholdKeys` here is
 * the shipping install path, ring and persistence included. Only `@api/client`
 * is mocked — it is the relay, and this suite must never reach one.
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
  bytesToHex,
  generateDeviceIdentity,
  hexToBytes,
  unwrapHouseholdDataKey,
  type DeviceIdentity,
} from '@symply/local-first';

import {
  deriveHealthBlobContentKey,
  openHealthBlobChunk,
  sealHealthBlobChunk,
  type HealthBlobKeyContext,
} from '../blobs/blobCrypto';
import type { ControlPlaneHealthState } from '../controlPlaneClient';
import {
  getLocalHealthDeviceId,
  getLocalHealthHouseholdKeys,
  getLocalHealthIdentity,
  getLocalHealthRetiredHouseholdKey,
  getLocalHealthRetiredKeyEpochs,
  openLocalHealthSession,
  resetLocalHealthSession,
} from '../engine';
import {
  readPendingHealthKeyDelivery,
  revokeHealthLocalFirstDeviceAndRotateKey,
} from '../sync/hdkRotation';

const USER = 'user_health_rotation';
const WRAP_PREFIX = 'HDK_WRAP_V1:';

/** The user's other phone — the device that must still work after the revoke. */
const PEER = generateDeviceIdentity('dev_peer');
/** The lost phone — the device the rotation exists to lock out. */
const REVOKED = generateDeviceIdentity('dev_revoked');

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

/**
 * What the Worker returns from the DELETE: the device marked revoked and
 * `key_epoch` already bumped (`household-coordinator.ts:237-240`).
 */
function stateAfterRevoke(options?: { keyEpoch?: number; peers?: DeviceIdentity[] }): ControlPlaneHealthState {
  const own = getLocalHealthIdentity();
  return {
    householdId: getLocalHealthHouseholdKeys().householdId,
    keyEpoch: options?.keyEpoch ?? 2,
    securityRevision: 2,
    members: [{ userId: USER, role: 'OWNER', status: 'active' }],
    devices: [
      deviceRow(own, 'active'),
      ...(options?.peers ?? [PEER]).map((peer) => deviceRow(peer, 'active')),
      deviceRow(REVOKED, 'revoked'),
    ],
  };
}

function mailboxDeposits(): MailboxDeposit[] {
  return mockApiPost.mock.calls
    .filter(([url]) => String(url).endsWith('/mailbox'))
    .map(([, body]) => body as MailboxDeposit);
}

/** Open an envelope the way the receiving device's `hdkTransfer` would. */
function openEnvelope(deposit: MailboxDeposit, recipient: DeviceIdentity) {
  const bytes = base64ToBytes(deposit.ciphertextBase64);
  const text = new TextDecoder().decode(bytes.slice(WRAP_PREFIX.length));
  const parsed = JSON.parse(text) as {
    kind: string;
    householdId: string;
    keyEpoch: number;
    senderAgreementPublicKeyHex: string;
    recipientDeviceId: string;
    wrappedHex: string;
  };
  const aad = `hdk-enrol:${parsed.householdId}:${parsed.keyEpoch}:${parsed.recipientDeviceId}`;
  return {
    parsed,
    plaintextJson: text,
    envelopeBytes: bytes,
    hdk: unwrapHouseholdDataKey(
      hexToBytes(parsed.wrappedHex),
      recipient.agreementPrivateKey,
      hexToBytes(parsed.senderAgreementPublicKeyHex),
      aad,
    ),
  };
}

/** Does `haystack` contain `needle` as a contiguous run of bytes? */
function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let matched = true;
    for (let i = 0; i < needle.length && matched; i += 1) {
      matched = haystack[start + i] === needle[i];
    }
    if (matched) return true;
  }
  return false;
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockApiGet.mockResolvedValue({ data: {} });
  mockApiPost.mockResolvedValue({ data: { blob: { blobId: 'blob_1' } } });
  mockApiPut.mockResolvedValue({ data: {} });
  await resetLocalHealthSession();
  await openLocalHealthSession({ userId: USER });
  mockApiDelete.mockResolvedValue({ data: { state: stateAfterRevoke() } });
});

afterEach(async () => {
  await resetLocalHealthSession();
});

describe('revoke rotates the household key', () => {
  it('moves the live epoch and retires the outgoing key into the ring', async () => {
    const before = getLocalHealthHouseholdKeys();
    expect(before.keyEpoch).toBe(1);

    const result = await revokeHealthLocalFirstDeviceAndRotateKey(REVOKED.deviceId);

    const after = getLocalHealthHouseholdKeys();
    expect(result.rotated).toBe(true);
    expect(result.keyEpoch).toBe(2);
    expect(after.keyEpoch).toBe(2);
    // A NEW random key, not a re-derivation: the revoked device holds the old
    // bytes and no amount of epoch bumping helps if the material is the same.
    expect(after.hdk).not.toEqual(before.hdk);
    expect(getLocalHealthRetiredKeyEpochs()).toEqual([1]);
    expect(getLocalHealthRetiredHouseholdKey(1)).toEqual(before.hdk);
  });

  it('sends the DELETE before anything local changes', async () => {
    mockApiDelete.mockRejectedValueOnce(new Error('relay down'));

    await expect(revokeHealthLocalFirstDeviceAndRotateKey(REVOKED.deviceId)).rejects.toThrow(
      'relay down',
    );

    // The device is still enrolled and still syncing, so rotating would only cut
    // the honest peer off — no rotation, no deposit, no queue.
    expect(getLocalHealthHouseholdKeys().keyEpoch).toBe(1);
    expect(getLocalHealthRetiredKeyEpochs()).toEqual([]);
    expect(mailboxDeposits()).toEqual([]);
    expect(await readPendingHealthKeyDelivery()).toBeNull();
  });

  it('takes the epoch strictly forward even if the server did not bump', async () => {
    // The security property is a new random key at a strictly greater epoch —
    // never the server's counter, which is only the floor.
    mockApiDelete.mockResolvedValueOnce({ data: { state: stateAfterRevoke({ keyEpoch: 1 }) } });

    const result = await revokeHealthLocalFirstDeviceAndRotateKey(REVOKED.deviceId);

    expect(result.keyEpoch).toBe(2);
    expect(getLocalHealthHouseholdKeys().keyEpoch).toBe(2);
  });

  it('rotates when the LAST other device is revoked', async () => {
    // Personal household: one user, N devices (plan §1.2). Being left with one
    // device is the ordinary steady state, not a failure — and the rotation is
    // exactly as necessary, because it is what the removed device can no longer
    // read.
    mockApiDelete.mockResolvedValueOnce({
      data: {
        state: {
          ...stateAfterRevoke(),
          devices: [deviceRow(getLocalHealthIdentity(), 'active'), deviceRow(REVOKED, 'revoked')],
        },
      },
    });

    const result = await revokeHealthLocalFirstDeviceAndRotateKey(REVOKED.deviceId);

    expect(result.rotated).toBe(true);
    expect(result.delivered).toEqual([]);
    expect(result.undelivered).toEqual([]);
    expect(getLocalHealthHouseholdKeys().keyEpoch).toBe(2);
    expect(mailboxDeposits()).toEqual([]);
    expect(await readPendingHealthKeyDelivery()).toBeNull();
  });
});

describe('what the old epoch can still open', () => {
  it('opens a blob sealed before the rotation, with the retired key', async () => {
    const householdId = getLocalHealthHouseholdKeys().householdId;
    const ctx: HealthBlobKeyContext = { householdId, keyEpoch: 1, blobId: 'blob_before' };
    const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const sealed = sealHealthBlobChunk({
      contentKey: deriveHealthBlobContentKey(getLocalHealthHouseholdKeys().hdk, ctx),
      ctx,
      chunkIndex: 0,
      chunkCount: 1,
      plaintext,
    });

    await revokeHealthLocalFirstDeviceAndRotateKey(REVOKED.deviceId);

    // This is the whole point of the ring: the descriptor's epoch selects the
    // key (`healthBlobStore.sealingKeyFor`), so an attachment uploaded before
    // the revoke is still readable after it.
    const retired = getLocalHealthRetiredHouseholdKey(1);
    expect(retired).not.toBeNull();
    expect(
      openHealthBlobChunk({
        contentKey: deriveHealthBlobContentKey(retired as Uint8Array, ctx),
        ctx,
        chunkIndex: 0,
        chunkCount: 1,
        envelope: sealed,
      }),
    ).toEqual(plaintext);

    // …and the live key genuinely cannot, which is why keeping it was required
    // rather than tidy.
    expect(() =>
      openHealthBlobChunk({
        contentKey: deriveHealthBlobContentKey(getLocalHealthHouseholdKeys().hdk, ctx),
        ctx,
        chunkIndex: 0,
        chunkCount: 1,
        envelope: sealed,
      }),
    ).toThrow();
  });
});

describe('who receives the new key', () => {
  it('hands it to the remaining device, wrapped to that device alone', async () => {
    const result = await revokeHealthLocalFirstDeviceAndRotateKey(REVOKED.deviceId);

    expect(result.delivered).toEqual([PEER.deviceId]);
    const deposits = mailboxDeposits();
    expect(deposits).toHaveLength(1);
    expect(deposits[0].recipientDeviceId).toBe(PEER.deviceId);
    expect(deposits[0].sourceDeviceId).toBe(getLocalHealthDeviceId());

    // The peer can open it with its own agreement key, and what comes out is the
    // key this device is now sealing under.
    const opened = openEnvelope(deposits[0], PEER);
    expect(opened.parsed.kind).toBe('HDK_WRAP_V1');
    expect(opened.parsed.keyEpoch).toBe(2);
    expect(opened.hdk).toEqual(getLocalHealthHouseholdKeys().hdk);
  });

  it('never puts the key on the relay in the clear', async () => {
    await revokeHealthLocalFirstDeviceAndRotateKey(REVOKED.deviceId);

    const live = getLocalHealthHouseholdKeys();
    const deposit = mailboxDeposits()[0];
    const opened = openEnvelope(deposit, PEER);

    // Neither as hex in the envelope's JSON…
    expect(opened.plaintextJson).not.toContain(bytesToHex(live.hdk));
    expect(opened.parsed.wrappedHex).not.toBe(bytesToHex(live.hdk));
    // …nor as raw bytes anywhere in what was posted.
    expect(containsBytes(opened.envelopeBytes, live.hdk)).toBe(false);
    // Nor the retired one — a rotation that leaked the old key would hand the
    // revoked device's material to anyone reading the relay.
    const retired = getLocalHealthRetiredHouseholdKey(1) as Uint8Array;
    expect(containsBytes(opened.envelopeBytes, retired)).toBe(false);
  });

  it('does not address the revoked device, or this one', async () => {
    await revokeHealthLocalFirstDeviceAndRotateKey(REVOKED.deviceId);

    const recipients = mailboxDeposits().map((deposit) => deposit.recipientDeviceId);
    expect(recipients).not.toContain(REVOKED.deviceId);
    expect(recipients).not.toContain(getLocalHealthDeviceId());
    // Broadcast (null recipient) would be the same mistake wearing a different
    // hat: the revoked device fetches broadcasts too.
    expect(recipients).not.toContain(null);
  });

  it('refuses to wrap the key to a device belonging to another user', async () => {
    // The control plane refuses a second `user_id` (He5). This is the client's
    // own check, because the cost of that refusal regressing is the household
    // key wrapped to a stranger's public key.
    const stranger = generateDeviceIdentity('dev_stranger');
    mockApiDelete.mockResolvedValueOnce({
      data: {
        state: {
          ...stateAfterRevoke(),
          devices: [
            deviceRow(getLocalHealthIdentity(), 'active'),
            { ...deviceRow(stranger, 'active'), userId: 'user_someone_else' },
            deviceRow(REVOKED, 'revoked'),
          ],
        },
      },
    });

    const result = await revokeHealthLocalFirstDeviceAndRotateKey(REVOKED.deviceId);

    expect(result.rotated).toBe(true);
    expect(result.delivered).toEqual([]);
    expect(mailboxDeposits()).toEqual([]);
  });

  it('leaves this device out when it is the one being signed out', async () => {
    // Rotating here would mint a key only this device holds and then try to hand
    // it over from a device the relay has just stopped trusting.
    mockApiDelete.mockResolvedValueOnce({ data: { state: stateAfterRevoke() } });

    const result = await revokeHealthLocalFirstDeviceAndRotateKey(getLocalHealthDeviceId());

    expect(result.rotated).toBe(false);
    expect(getLocalHealthHouseholdKeys().keyEpoch).toBe(1);
    expect(mailboxDeposits()).toEqual([]);
  });
});
