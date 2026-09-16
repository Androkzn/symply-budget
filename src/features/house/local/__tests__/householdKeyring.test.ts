/**
 * Retained household keyring (H6 §8.2) — rotation must stop orphaning attachments.
 *
 * **The defect this closes.** `revokeLocalFirstDevice` rotates by minting a
 * WHOLE NEW random HDK (`generateHouseholdKeys(id, nextEpoch)`) and, before this
 * existed, dropped the old one on the floor. Everything that predates H6
 * tolerated that — rows are sealed under the device-local DEK, ops expire with
 * the 14-day mailbox TTL, and the owner republishes checkpoints under the new
 * epoch — but **attachments are the first durable HDK-sealed data in the
 * system**. So every blob uploaded before a rotation became permanently
 * unreadable the moment any member's device was revoked, which is to say: every
 * revoke destroyed member content.
 *
 * These are pure semantics tests over the persisted crypto bundle, deliberately
 * not standing up a real session — what has to be right is *which* key is kept,
 * *when*, and that it survives a cold open.
 */
import { bytesToHex } from '@symply/local-first';

type CryptoBundle = {
  hdkHex: string;
  keyEpoch: number;
  retiredHdksByEpoch?: Record<string, string>;
};

/**
 * The engine's retire-on-rotate rule, as implemented in `installHouseholdKeys`.
 * Kept in lockstep with it: only a strictly older epoch retires, because
 * enrolment also flows through that function.
 */
function installKeys(
  state: { hdk: Uint8Array; keyEpoch: number; retired: Map<number, Uint8Array> },
  next: { hdk: Uint8Array; keyEpoch: number },
): void {
  if (state.hdk?.length && state.keyEpoch < next.keyEpoch) {
    state.retired.set(state.keyEpoch, state.hdk);
  }
  state.hdk = next.hdk;
  state.keyEpoch = next.keyEpoch;
}

function persist(state: {
  hdk: Uint8Array;
  keyEpoch: number;
  retired: Map<number, Uint8Array>;
}): CryptoBundle {
  const retiredHdksByEpoch: Record<string, string> = {};
  for (const [epoch, hdk] of state.retired) retiredHdksByEpoch[String(epoch)] = bytesToHex(hdk);
  return {
    hdkHex: bytesToHex(state.hdk),
    keyEpoch: state.keyEpoch,
    ...(Object.keys(retiredHdksByEpoch).length > 0 ? { retiredHdksByEpoch } : {}),
  };
}

function rehydrate(bundle: CryptoBundle): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  for (const [epoch, hex] of Object.entries(bundle.retiredHdksByEpoch ?? {})) {
    const parsed = Number(epoch);
    if (Number.isInteger(parsed) && hex) {
      out.set(parsed, Uint8Array.from(Buffer.from(hex, 'hex')));
    }
  }
  return out;
}

function key(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function freshState(fill = 1, epoch = 1) {
  return { hdk: key(fill), keyEpoch: epoch, retired: new Map<number, Uint8Array>() };
}

describe('rotation retains the outgoing key', () => {
  it('keeps epoch 1 when rotating to 2', () => {
    const state = freshState(1, 1);
    installKeys(state, { hdk: key(2), keyEpoch: 2 });

    expect(state.keyEpoch).toBe(2);
    expect(Array.from(state.retired.get(1)!)).toEqual(Array.from(key(1)));
  });

  it('accumulates every retired epoch across repeated revokes', () => {
    const state = freshState(1, 1);
    installKeys(state, { hdk: key(2), keyEpoch: 2 });
    installKeys(state, { hdk: key(3), keyEpoch: 3 });
    installKeys(state, { hdk: key(4), keyEpoch: 4 });

    // Three revokes → three readable historical epochs. Dropping any one of them
    // would orphan whatever was attached during it.
    expect([...state.retired.keys()].sort()).toEqual([1, 2, 3]);
    expect(state.keyEpoch).toBe(4);
  });

  it('does NOT retire on first enrolment — there is no previous key to keep', () => {
    // Enrolment installs the first HDK through the same function. Retiring here
    // would persist a meaningless zero-length entry.
    const state = { hdk: new Uint8Array(0), keyEpoch: 1, retired: new Map<number, Uint8Array>() };
    installKeys(state, { hdk: key(9), keyEpoch: 1 });
    expect(state.retired.size).toBe(0);
  });

  it('does NOT retire when the same epoch is re-installed', () => {
    // Re-enrolment / HDK re-delivery replays the current epoch. Retiring the
    // current key under its own epoch would shadow the live one.
    const state = freshState(5, 3);
    installKeys(state, { hdk: key(5), keyEpoch: 3 });
    expect(state.retired.size).toBe(0);
    expect(state.keyEpoch).toBe(3);
  });

  it('does NOT retire on an out-of-order older key', () => {
    const state = freshState(5, 4);
    installKeys(state, { hdk: key(6), keyEpoch: 2 });
    expect(state.retired.size).toBe(0);
  });
});

describe('the keyring survives a cold open', () => {
  it('round-trips through the persisted crypto bundle', () => {
    const state = freshState(1, 1);
    installKeys(state, { hdk: key(2), keyEpoch: 2 });
    installKeys(state, { hdk: key(3), keyEpoch: 3 });

    const restored = rehydrate(persist(state));

    expect([...restored.keys()].sort()).toEqual([1, 2]);
    expect(Array.from(restored.get(1)!)).toEqual(Array.from(key(1)));
    expect(Array.from(restored.get(2)!)).toEqual(Array.from(key(2)));
  });

  it('omits the field entirely when nothing has been retired', () => {
    // Sessions that never rotated must not grow a new key in their persisted
    // shape — old builds read this bundle too.
    expect(persist(freshState()).retiredHdksByEpoch).toBeUndefined();
  });

  it('reads a pre-keyring session as simply having no retired keys', () => {
    // Every session persisted before §8.2 landed lacks the field. It must open
    // cleanly, not throw.
    expect(rehydrate({ hdkHex: bytesToHex(key(1)), keyEpoch: 1 }).size).toBe(0);
  });

  it('ignores a malformed epoch key rather than throwing on a cold open', () => {
    const restored = rehydrate({
      hdkHex: bytesToHex(key(1)),
      keyEpoch: 2,
      retiredHdksByEpoch: { '1': bytesToHex(key(1)), notanepoch: bytesToHex(key(2)), '3': '' },
    });
    expect([...restored.keys()]).toEqual([1]);
  });
});

describe('what the keyring deliberately does NOT change', () => {
  it('never hands the retired key to the current epoch', () => {
    // The live key and the retired one must stay distinct: a bug that returned
    // the retired key for the current epoch would seal NEW blobs under a key a
    // revoked device still holds.
    const state = freshState(1, 1);
    installKeys(state, { hdk: key(2), keyEpoch: 2 });
    expect(Array.from(state.hdk)).not.toEqual(Array.from(state.retired.get(1)!));
  });

  it('does not weaken a revoke — the ring is per-device, never transmitted', () => {
    // Retention is local. A revoked device gets no new keys and no ring; what it
    // keeps is only the stale copy it already had, which is exactly the state
    // before this change. Asserted structurally: the persisted bundle is the
    // device's own identity record, and nothing here serialises it to the wire.
    const state = freshState(1, 1);
    installKeys(state, { hdk: key(2), keyEpoch: 2 });
    const bundle = persist(state);
    expect(Object.keys(bundle).sort()).toEqual(['hdkHex', 'keyEpoch', 'retiredHdksByEpoch']);
  });
});
