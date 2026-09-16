/**
 * The wrapped-HDK envelope must be found wherever it is in the mailbox.
 *
 * `tryAcceptHdkFromMailbox` read only the FIRST page and asserted in a comment
 * that the envelope is always on it, "because it is deposited before any op
 * batch". Nothing enforces that: a peer's push addresses every device the
 * control plane reports active, which can precede approval, and a joining device
 * cannot decrypt or ack any of those op chunks — it has no HDK yet. So the head
 * of its mailbox can be a full page of blobs it can neither read nor clear, with
 * the one envelope it is waiting for sitting behind them, and the member sits on
 * "Waiting for approval…" for ever.
 */
import {
  bytesToHex,
  generateDeviceIdentity,
  generateHouseholdKeys,
  utf8Encode,
  wrapHouseholdDataKey,
} from '@symply/local-first';

import { ackMailboxBlobs, fetchMailboxBlobs, fetchControlPlaneState } from '../../controlPlaneClient';
import { getLocalIdentity, getLocalLedger, installHouseholdKeys } from '../../engine';
import { tryAcceptHdkFromMailbox } from '../hdkTransfer';

jest.mock('../../controlPlaneClient', () => ({
  ackMailboxBlobs: jest.fn(async () => undefined),
  depositMailboxBlob: jest.fn(async () => ({})),
  fetchMailboxBlobs: jest.fn(),
  fetchControlPlaneState: jest.fn(),
}));

/**
 * BR-016 moved hdkTransfer off the active-session accessors and onto
 * `getLocalBudgetSession(householdId)` — background enrolment must name the
 * household it is working on, or it installs one household's HDK into another.
 *
 * The session mock DERIVES from `getLocalIdentity` / `getLocalLedger` rather
 * than returning fixed objects, so the per-test overrides below (notably the
 * "addressed to a different device" case, which re-points the ledger's deviceId)
 * keep working unchanged.
 *
 * Literals rather than the HOUSEHOLD_ID const: jest hoists this factory above
 * it, so referencing it would be a TDZ error.
 */
jest.mock('../../engine', () => {
  const getLocalHouseholdKeys = jest.fn();
  const getLocalIdentity = jest.fn();
  const getLocalLedger = jest.fn();
  return {
    getLocalHouseholdKeys,
    getLocalIdentity,
    getLocalLedger,
    installHouseholdKeys: jest.fn(async () => undefined),
    isLocalBudgetSessionOpen: jest.fn(() => true),
    getActiveBudgetHouseholdId: jest.fn(() => 'hh-join'),
    getLocalBudgetSession: jest.fn(async () => ({
      householdId: 'hh-join',
      identity: getLocalIdentity(),
      ledger: getLocalLedger(),
      householdKeys: getLocalHouseholdKeys(),
      awaitingEnrolment: false,
    })),
  };
});

const WRAP_PREFIX = 'HDK_WRAP_V1:';
const HOUSEHOLD_ID = 'hh-join';

const owner = generateDeviceIdentity('owner-device');
const joiner = generateDeviceIdentity('joiner-device');
const householdKeys = generateHouseholdKeys(HOUSEHOLD_ID);

type Blob = { blobId: string; ciphertext: Uint8Array; recipientDeviceId: string | null };

function envelopeBlob(blobId: string): Blob {
  const aad = `hdk-enrol:${HOUSEHOLD_ID}:${householdKeys.keyEpoch}:${joiner.deviceId}`;
  const wrapped = wrapHouseholdDataKey(
    householdKeys.hdk,
    owner.agreementPrivateKey,
    joiner.agreementPublicKey,
    aad,
  );
  const payload = utf8Encode(
    JSON.stringify({
      kind: 'HDK_WRAP_V1',
      householdId: HOUSEHOLD_ID,
      keyEpoch: householdKeys.keyEpoch,
      senderDeviceId: owner.deviceId,
      senderAgreementPublicKeyHex: bytesToHex(owner.agreementPublicKey),
      recipientDeviceId: joiner.deviceId,
      wrappedHex: bytesToHex(wrapped),
    }),
  );
  const prefix = utf8Encode(WRAP_PREFIX);
  const ciphertext = new Uint8Array(prefix.length + payload.length);
  ciphertext.set(prefix, 0);
  ciphertext.set(payload, prefix.length);
  return { blobId, ciphertext, recipientDeviceId: joiner.deviceId };
}

/** Sealed op chunks the joiner cannot open and therefore never acks. */
function opChunkBlobs(count: number): Blob[] {
  return Array.from({ length: count }, (_, i) => ({
    blobId: `chunk-${i + 1}`,
    ciphertext: new Uint8Array(64).fill(i + 1),
    recipientDeviceId: joiner.deviceId,
  }));
}

/** Serve `pages` in order, honouring the cursor the caller sends back. */
function servePages(pages: Blob[][]): void {
  (fetchMailboxBlobs as jest.Mock).mockImplementation(async (cursor?: string) => {
    const index = cursor ? Number(cursor) : 0;
    const blobs = pages[index] ?? [];
    const hasMore = index < pages.length - 1;
    return {
      blobs,
      hasMore,
      ...(hasMore ? { nextCursor: String(index + 1) } : {}),
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (fetchControlPlaneState as jest.Mock).mockResolvedValue({
    householdId: HOUSEHOLD_ID, keyEpoch: householdKeys.keyEpoch,
    members: [{userId: 'owner', status: 'active'}],
    devices: [{deviceId: owner.deviceId, userId: 'owner', status: 'active', agreementPublicKey: bytesToHex(owner.agreementPublicKey)}],
  });
  (getLocalIdentity as jest.Mock).mockReturnValue(joiner);
  (getLocalLedger as jest.Mock).mockReturnValue({ deviceId: joiner.deviceId });
});

describe('tryAcceptHdkFromMailbox', () => {
  it('skips malformed JSON and still accepts the valid envelope behind it', async () => {
    servePages([[{blobId:'bad', ciphertext:utf8Encode(WRAP_PREFIX + '{'), recipientDeviceId:joiner.deviceId}, envelopeBlob('valid')]]);
    await expect(tryAcceptHdkFromMailbox()).resolves.toBe(true);
    expect(ackMailboxBlobs).toHaveBeenCalledWith(['valid'], joiner.deviceId, HOUSEHOLD_ID);
  });
  it.each(['revoked', 'unknown-key', 'stale-epoch'])('rejects %s envelopes without acknowledging them', async (reason) => {
    const state = await fetchControlPlaneState(HOUSEHOLD_ID);
    if (reason === 'revoked') state.devices[0]!.status = 'revoked';
    if (reason === 'unknown-key') state.devices[0]!.agreementPublicKey = '0'.repeat(64);
    if (reason === 'stale-epoch') state.keyEpoch += 1;
    servePages([[envelopeBlob('invalid')]]);
    await expect(tryAcceptHdkFromMailbox()).resolves.toBe(false);
    expect(installHouseholdKeys).not.toHaveBeenCalled();
    expect(ackMailboxBlobs).not.toHaveBeenCalled();
  });

  it('finds the envelope on the first page', async () => {
    servePages([[envelopeBlob('env-1')]]);
    await expect(tryAcceptHdkFromMailbox()).resolves.toBe(true);
    expect(installHouseholdKeys).toHaveBeenCalledTimes(1);
    // Household-SCOPED, all three arguments. Left unnamed, the ack resolved the
    // ACTIVE household instead, so enrolling into a background household acked
    // the envelope against the wrong mailbox — a 404 at best, and at worst an
    // ack that destroys someone else's mail.
    expect(ackMailboxBlobs).toHaveBeenCalledWith(['env-1'], joiner.deviceId, HOUSEHOLD_ID);
  });

  it('finds it behind a full page of op chunks it cannot decrypt', async () => {
    servePages([opChunkBlobs(25), [...opChunkBlobs(3), envelopeBlob('env-2')]]);
    // Was false: only page 1 was ever read, and nothing on it is ackable either,
    // so the joiner waited for approval that had already happened.
    await expect(tryAcceptHdkFromMailbox()).resolves.toBe(true);
    const installed = (installHouseholdKeys as jest.Mock).mock.calls[0]![0] as {
      householdId: string;
      hdk: Uint8Array;
      keyEpoch: number;
    };
    expect(installed.householdId).toBe(HOUSEHOLD_ID);
    expect(bytesToHex(installed.hdk)).toBe(bytesToHex(householdKeys.hdk));
    expect(ackMailboxBlobs).toHaveBeenCalledWith(['env-2'], joiner.deviceId, HOUSEHOLD_ID);
  });

  it('stops when the mailbox is exhausted rather than looping', async () => {
    servePages([opChunkBlobs(2), opChunkBlobs(2), opChunkBlobs(2)]);
    await expect(tryAcceptHdkFromMailbox()).resolves.toBe(false);
    expect(fetchMailboxBlobs).toHaveBeenCalledTimes(3);
    expect(installHouseholdKeys).not.toHaveBeenCalled();
  });

  it('ignores an envelope addressed to a different device', async () => {
    const other = { ...envelopeBlob('env-3'), recipientDeviceId: 'someone-else' };
    (getLocalLedger as jest.Mock).mockReturnValue({ deviceId: 'not-the-recipient' });
    servePages([[other]]);
    await expect(tryAcceptHdkFromMailbox()).resolves.toBe(false);
    expect(installHouseholdKeys).not.toHaveBeenCalled();
  });
});
