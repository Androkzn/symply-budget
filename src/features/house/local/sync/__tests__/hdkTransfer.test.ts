/**
 * The one step that turns an approved device into a member: the wrapped home
 * key, deposited in the zero-knowledge mailbox and installed on the other side.
 *
 * Everything else in enrolment is a claim about who somebody is. This is the
 * part that actually hands over the ability to read the home, and every failure
 * mode here is silent — the member sits on "Waiting for approval…" for ever,
 * with nothing on any screen and nothing in any log to say why. So each case
 * below is one of those silences:
 *
 *  - the envelope sitting behind a page of op chunks a joiner can neither
 *    decrypt nor ack, because a peer addresses every device the control plane
 *    reports active and that can precede approval;
 *  - a wrap deposited into the WRONG home's mailbox, where the recipient —
 *    polling the right one — never sees it;
 *  - a home that has rotated handing over only the current key, so the new
 *    member syncs, acks, and reads nothing that predates the last rotation;
 *  - a device still awaiting its own enrolment wrapping the THROWAWAY key it is
 *    holding, which enrols the peer onto a key nothing is sealed under.
 */
import {
  bytesToHex,
  generateDeviceIdentity,
  generateHouseholdKeys,
  utf8Encode,
  wrapHouseholdDataKey,
} from '@symply/local-first';

import { ackMailboxBlobs, depositMailboxBlob, fetchMailboxBlobs } from '../../controlPlaneClient';
import { getLocalHouseSession, installHouseholdKeys } from '../../engine';
import { depositHdkForDevice, tryAcceptHdkFromMailbox } from '../hdkTransfer';

jest.mock('../../controlPlaneClient', () => ({
  ackMailboxBlobs: jest.fn(async () => undefined),
  depositMailboxBlob: jest.fn(async () => ({})),
  fetchMailboxBlobs: jest.fn(),
}));

/**
 * The session mock is a FUNCTION of the household asked for, not a fixed
 * object: the whole point of the per-property scoping is that asking for B
 * hands back B's keys, and a mock that answers the same thing whatever it is
 * asked would pass the very tests that exist to catch a cross-property leak.
 *
 * Literals rather than consts: jest hoists this factory above them, so
 * referencing one would be a TDZ error.
 */
jest.mock('../../engine', () => {
  const sessions = new Map<string, unknown>();
  return {
    __sessions: sessions,
    isLocalHouseSessionOpen: jest.fn(() => true),
    getActiveHouseholdId: jest.fn(() => 'hh-join'),
    getLocalHouseSession: jest.fn(async (householdId: string) => {
      const session = sessions.get(householdId);
      if (!session) throw new Error(`no session for ${householdId}`);
      return session;
    }),
    installHouseholdKeys: jest.fn(async () => undefined),
  };
});

const WRAP_PREFIX = 'HDK_WRAP_V1:';
const JOINED = 'hh-join';
const OTHER = 'hh-other';

const owner = generateDeviceIdentity('owner-device');
const joiner = generateDeviceIdentity('joiner-device');

const { __sessions: sessions } = jest.requireMock('../../engine') as {
  __sessions: Map<string, unknown>;
};

type Blob = { blobId: string; ciphertext: Uint8Array; recipientDeviceId: string | null };

function session(input: {
  householdId: string;
  identity: ReturnType<typeof generateDeviceIdentity>;
  keys: ReturnType<typeof generateHouseholdKeys>;
  retired?: Map<number, Uint8Array>;
  awaitingEnrolment?: boolean;
}) {
  return {
    householdId: input.householdId,
    identity: input.identity,
    ledger: { deviceId: input.identity.deviceId, household: { id: input.householdId } },
    householdKeys: input.keys,
    retiredHouseholdKeys: input.retired ?? new Map<number, Uint8Array>(),
    awaitingEnrolment: input.awaitingEnrolment ?? false,
  };
}

/** An envelope as the OWNER's device writes it, for the joiner to find. */
function envelopeBlob(
  blobId: string,
  overrides?: {
    householdId?: string;
    recipientDeviceId?: string;
    keys?: ReturnType<typeof generateHouseholdKeys>;
    retired?: Map<number, Uint8Array>;
  },
): Blob {
  const householdId = overrides?.householdId ?? JOINED;
  const keys = overrides?.keys ?? generateHouseholdKeys(JOINED, 1);
  const recipientDeviceId = overrides?.recipientDeviceId ?? joiner.deviceId;
  const aad = `hdk-enrol:${householdId}:${keys.keyEpoch}:${recipientDeviceId}`;
  const wrapped = wrapHouseholdDataKey(
    keys.hdk,
    owner.agreementPrivateKey,
    joiner.agreementPublicKey,
    aad,
  );
  const retiredWraps: Record<string, string> = {};
  for (const [epoch, hdk] of overrides?.retired ?? []) {
    retiredWraps[String(epoch)] = bytesToHex(
      wrapHouseholdDataKey(
        hdk,
        owner.agreementPrivateKey,
        joiner.agreementPublicKey,
        `hdk-enrol:${householdId}:${epoch}:${recipientDeviceId}`,
      ),
    );
  }
  const payload = utf8Encode(
    JSON.stringify({
      kind: 'HDK_WRAP_V1',
      householdId,
      keyEpoch: keys.keyEpoch,
      senderDeviceId: owner.deviceId,
      senderAgreementPublicKeyHex: bytesToHex(owner.agreementPublicKey),
      recipientDeviceId,
      wrappedHex: bytesToHex(wrapped),
      ...(Object.keys(retiredWraps).length > 0
        ? { retiredWrappedHexByEpoch: retiredWraps }
        : {}),
    }),
  );
  const prefix = utf8Encode(WRAP_PREFIX);
  const ciphertext = new Uint8Array(prefix.length + payload.length);
  ciphertext.set(prefix, 0);
  ciphertext.set(payload, prefix.length);
  return { blobId, ciphertext, recipientDeviceId };
}

/** An op chunk: real mail, and completely opaque to a device with no key. */
function opChunkBlob(blobId: string): Blob {
  return { blobId, ciphertext: utf8Encode(`OPS:${blobId}`), recipientDeviceId: joiner.deviceId };
}

function servePages(pages: Blob[][]): void {
  (fetchMailboxBlobs as jest.Mock).mockImplementation(async (cursor?: string) => {
    const index = cursor ? Number(cursor) : 0;
    const blobs = pages[index] ?? [];
    const hasMore = index + 1 < pages.length;
    return { blobs, hasMore, ...(hasMore ? { nextCursor: String(index + 1) } : {}) };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  sessions.clear();
  sessions.set(
    JOINED,
    session({ householdId: JOINED, identity: joiner, keys: generateHouseholdKeys(JOINED, 1) }),
  );
});

describe('accepting the wrap — the invitee side', () => {
  it('installs the key when the envelope is on the first page', async () => {
    servePages([[envelopeBlob('b1')]]);

    await expect(tryAcceptHdkFromMailbox(JOINED)).resolves.toBe(true);
    expect(installHouseholdKeys).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: JOINED, keyEpoch: 1 }),
      JOINED,
      expect.any(Map),
    );
  });

  it('walks past a page of op chunks it can neither read nor ack', async () => {
    // The failure this exists for: a joiner holds no HDK, so those chunks stay
    // at the head of its mailbox for ever and page 1 alone never finds the
    // envelope.
    servePages([[opChunkBlob('c1'), opChunkBlob('c2')], [opChunkBlob('c3')], [envelopeBlob('b1')]]);

    await expect(tryAcceptHdkFromMailbox(JOINED)).resolves.toBe(true);
    expect(fetchMailboxBlobs).toHaveBeenCalledTimes(3);
  });

  it('acks only the envelope, and acks it in the right home', async () => {
    servePages([[opChunkBlob('c1'), envelopeBlob('b1')]]);

    await tryAcceptHdkFromMailbox(JOINED);

    expect(ackMailboxBlobs).toHaveBeenCalledWith(['b1'], joiner.deviceId, JOINED);
  });

  it('installs the retired ring, so history sealed under an older epoch opens', async () => {
    // A member admitted to a home that has rotated and handed only the current
    // key can open NOTHING that predates the last rotation — not the op
    // backlog, not the checkpoint. They sync, ack nothing, and sit on an empty
    // ledger with no error anywhere.
    const retired = new Map<number, Uint8Array>([
      [1, generateHouseholdKeys(JOINED, 1).hdk],
      [2, generateHouseholdKeys(JOINED, 2).hdk],
    ]);
    servePages([[envelopeBlob('b1', { keys: generateHouseholdKeys(JOINED, 3), retired })]]);

    await expect(tryAcceptHdkFromMailbox(JOINED)).resolves.toBe(true);

    const ring = (installHouseholdKeys as jest.Mock).mock.calls[0]![2] as Map<number, Uint8Array>;
    expect([...ring.keys()].sort()).toEqual([1, 2]);
  });

  it('ignores an envelope addressed to a different device', async () => {
    servePages([[envelopeBlob('b1', { recipientDeviceId: 'someone-elses-phone' })]]);

    await expect(tryAcceptHdkFromMailbox(JOINED)).resolves.toBe(false);
    expect(installHouseholdKeys).not.toHaveBeenCalled();
  });

  it('refuses an envelope that names a DIFFERENT home', async () => {
    // Installing another home's HDK here would seal every op this home writes
    // afterwards under a key its peers do not hold: silent, undiagnosable
    // divergence.
    servePages([[envelopeBlob('b1', { householdId: OTHER })]]);

    await expect(tryAcceptHdkFromMailbox(JOINED)).resolves.toBe(false);
    expect(installHouseholdKeys).not.toHaveBeenCalled();
  });

  it('reads the mailbox of the property it was ASKED about', async () => {
    sessions.set(
      OTHER,
      session({ householdId: OTHER, identity: joiner, keys: generateHouseholdKeys(OTHER, 1) }),
    );
    servePages([[]]);

    await tryAcceptHdkFromMailbox(OTHER);

    expect(fetchMailboxBlobs).toHaveBeenCalledWith(undefined, OTHER);
  });

  it('gives up after a bounded number of pages rather than spinning on a wedged relay', async () => {
    servePages(Array.from({ length: 40 }, (_, i) => [opChunkBlob(`c${i}`)]));

    await expect(tryAcceptHdkFromMailbox(JOINED)).resolves.toBe(false);
    expect((fetchMailboxBlobs as jest.Mock).mock.calls.length).toBeLessThanOrEqual(8);
  });
});

describe('depositing the wrap — the owner side', () => {
  const approved = { recipientDeviceId: joiner.deviceId, recipientAgreementPublicKeyHex: bytesToHex(joiner.agreementPublicKey) };

  it('posts into the NAMED property, never into whatever is on screen', async () => {
    // Approving into a background home while another is active posted the wrap
    // to a DIFFERENT home's mailbox, where the recipient never sees it.
    sessions.set(
      OTHER,
      session({ householdId: OTHER, identity: owner, keys: generateHouseholdKeys(OTHER, 1) }),
    );

    await depositHdkForDevice({ ...approved, householdId: OTHER });

    expect(depositMailboxBlob).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      joiner.deviceId,
      { householdId: OTHER },
    );
  });

  it('wraps the whole ring, so the joiner can read what predates the last rotation', async () => {
    sessions.set(
      JOINED,
      session({
        householdId: JOINED,
        identity: owner,
        keys: generateHouseholdKeys(JOINED, 3),
        retired: new Map([[1, generateHouseholdKeys(JOINED, 1).hdk]]),
      }),
    );

    await depositHdkForDevice({ ...approved, householdId: JOINED });

    const envelope = (depositMailboxBlob as jest.Mock).mock.calls[0]![0] as Uint8Array;
    const text = new TextDecoder().decode(envelope.slice(WRAP_PREFIX.length));
    const parsed = JSON.parse(text) as { keyEpoch: number; retiredWrappedHexByEpoch?: object };
    expect(parsed.keyEpoch).toBe(3);
    expect(Object.keys(parsed.retiredWrappedHexByEpoch ?? {})).toEqual(['1']);
  });

  it('omits the ring entirely for a home that has never rotated', async () => {
    // Byte-identical to what an older build produces, so a peer running one can
    // still read the envelope.
    await depositHdkForDevice({ ...approved, householdId: JOINED });

    const envelope = (depositMailboxBlob as jest.Mock).mock.calls[0]![0] as Uint8Array;
    const parsed = JSON.parse(new TextDecoder().decode(envelope.slice(WRAP_PREFIX.length)));
    expect(parsed).not.toHaveProperty('retiredWrappedHexByEpoch');
  });

  it('refuses to hand over the THROWAWAY key of a home it has not been let into itself', async () => {
    // That key is what `adoptJoinedHousehold` mints to hold the session
    // together until the real wrap arrives. Nothing in the home is sealed under
    // it, so a peer enrolled onto it would sync, ack, and read nothing.
    sessions.set(
      JOINED,
      session({
        householdId: JOINED,
        identity: owner,
        keys: generateHouseholdKeys(JOINED, 1),
        awaitingEnrolment: true,
      }),
    );

    await depositHdkForDevice({ ...approved, householdId: JOINED });

    expect(depositMailboxBlob).not.toHaveBeenCalled();
  });

  it('reads the key off the NAMED property, not off the active one', async () => {
    // The security content of the whole step: approving into B while A is on
    // screen must not wrap A's key and hand a member of B the key to a home
    // they were never invited to.
    sessions.set(
      OTHER,
      session({ householdId: OTHER, identity: owner, keys: generateHouseholdKeys(OTHER, 7) }),
    );

    await depositHdkForDevice({ ...approved, householdId: OTHER });

    expect(getLocalHouseSession).toHaveBeenCalledWith(OTHER);
    const envelope = (depositMailboxBlob as jest.Mock).mock.calls[0]![0] as Uint8Array;
    const parsed = JSON.parse(new TextDecoder().decode(envelope.slice(WRAP_PREFIX.length)));
    expect(parsed.householdId).toBe(OTHER);
    expect(parsed.keyEpoch).toBe(7);
  });
});
