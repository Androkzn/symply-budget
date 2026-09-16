/**
 * The retained household keyring (plan §8; House H6 §8.2) — rotation must stop
 * destroying attachments.
 *
 * **The defect this closes.** `installHealthHouseholdKeys` replaced
 * `session.householdKeys` wholesale and kept nothing. Everything that predates
 * the blob channel tolerated that — rows are sealed under the device-local DEK,
 * ops expire with the mailbox TTL, checkpoints are republished under the new
 * epoch — but **attachments are the first durable HDK-sealed data on this
 * side**. So the first rotation would have made every body photo and clinical
 * document uploaded before it permanently unopenable, with the ledger rows
 * still sitting there pointing at bytes nobody can decrypt.
 *
 * Against the REAL engine, not a local reimplementation of its rules: under
 * Jest `openHealthLocalFirstStore` returns a process-lifetime
 * `MemoryLocalFirstStore` and the DEK is held in the same module, so
 * `closeLocalHealthSession()` → `openLocalHealthSession()` is a genuine cold
 * open through `persistIdentity` / `buildSessionFromDisk`. A keyring proven only
 * over a hand-written copy of the persistence rules proves nothing about the
 * code that ships.
 *
 * Static imports only: `await import()` throws under this Jest config.
 */
import { bytesToHex, randomBytes } from '@symply/local-first';

import {
  HEALTH_RETAINED_KEY_EPOCHS,
  closeLocalHealthSession,
  getLocalHealthHouseholdKeys,
  getLocalHealthLedger,
  getLocalHealthRetiredHouseholdKey,
  getLocalHealthRetiredKeyEpochs,
  installHealthHouseholdKeys,
  openLocalHealthSession,
  resetLocalHealthSession,
} from '../engine';

const USER = 'user_health_keyring';

/** Distinguishable, deterministic key material per epoch. */
function key(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

async function rotateTo(epoch: number, fill = epoch): Promise<void> {
  await installHealthHouseholdKeys({ hdkHex: bytesToHex(key(fill)), keyEpoch: epoch });
}

/** The radio, off — nothing here may reach a relay. */
let fetchSpy: jest.Mock;

beforeEach(async () => {
  fetchSpy = jest.fn(() => Promise.reject(new Error('airplane mode: network is off')));
  (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy;
  await resetLocalHealthSession();
  await openLocalHealthSession({ userId: USER });
});

afterEach(async () => {
  expect(fetchSpy).not.toHaveBeenCalled();
  await resetLocalHealthSession();
});

describe('rotation retains the outgoing key', () => {
  it('keeps the epoch-1 HDK when rotating to epoch 2', async () => {
    const original = getLocalHealthHouseholdKeys().hdk;

    await rotateTo(2);

    expect(getLocalHealthHouseholdKeys().keyEpoch).toBe(2);
    expect(getLocalHealthRetiredHouseholdKey(1)).toEqual(original);
  });

  it('accumulates every retired epoch across repeated rotations', async () => {
    await rotateTo(2);
    await rotateTo(3);
    await rotateTo(4);

    // Three rotations → three readable historical epochs. Dropping any one of
    // them orphans whatever was attached during it.
    expect(getLocalHealthRetiredKeyEpochs()).toEqual([1, 2, 3]);
    expect(getLocalHealthHouseholdKeys().keyEpoch).toBe(4);
  });

  it('does NOT retire when the same epoch is re-installed', async () => {
    // HDK re-delivery replays the current epoch. Retiring the live key under its
    // own epoch would shadow it with a copy of itself.
    const current = getLocalHealthHouseholdKeys();
    await installHealthHouseholdKeys({
      hdkHex: bytesToHex(current.hdk),
      keyEpoch: current.keyEpoch,
    });

    expect(getLocalHealthRetiredKeyEpochs()).toEqual([]);
    expect(getLocalHealthHouseholdKeys().keyEpoch).toBe(current.keyEpoch);
  });

  it('does NOT retire on an out-of-order older key', async () => {
    await rotateTo(4);
    await rotateTo(2);

    // Only epoch 1 was ever superseded; a late-arriving older key is not a
    // rotation and must not push the live epoch into the ring.
    expect(getLocalHealthRetiredKeyEpochs()).toEqual([1]);
  });

  it('never hands back the live key as a retired one', async () => {
    // A bug that answered the current epoch from the ring would let a NEW blob
    // be sealed under a key a revoked device still holds.
    await rotateTo(2);

    expect(getLocalHealthRetiredHouseholdKey(2)).toBeNull();
    expect(getLocalHealthRetiredHouseholdKey(99)).toBeNull();
  });
});

describe('the ring is bounded', () => {
  it(`keeps at most ${HEALTH_RETAINED_KEY_EPOCHS} epochs, dropping the oldest first`, async () => {
    // Every retained key is another copy of something that decrypts the
    // member's records, so the ring is capped rather than unbounded (this is
    // the one place Health deliberately diverges from House, which keeps all).
    const liveEpoch = HEALTH_RETAINED_KEY_EPOCHS + 4;
    for (let epoch = 2; epoch <= liveEpoch; epoch += 1) {
      await rotateTo(epoch);
    }

    // Oldest dropped, newest kept: a newer epoch is the likelier to still have
    // live attachments behind it.
    const newestRetired = liveEpoch - 1;
    const expected = Array.from(
      { length: HEALTH_RETAINED_KEY_EPOCHS },
      (_unused, index) => newestRetired - HEALTH_RETAINED_KEY_EPOCHS + 1 + index,
    );
    expect(getLocalHealthRetiredKeyEpochs()).toEqual(expected);
    expect(getLocalHealthRetiredHouseholdKey(1)).toBeNull();
    expect(getLocalHealthRetiredHouseholdKey(newestRetired)).toEqual(key(newestRetired));
  });

  it('does not reinstate an over-large ring written by another build', async () => {
    // A bundle persisted by a build with a larger bound is pruned on the way
    // in, not trusted — otherwise the cap would be advisory.
    for (let epoch = 2; epoch <= HEALTH_RETAINED_KEY_EPOCHS + 3; epoch += 1) {
      await rotateTo(epoch);
    }

    await closeLocalHealthSession();
    await openLocalHealthSession({ userId: USER });

    expect(getLocalHealthRetiredKeyEpochs()).toHaveLength(HEALTH_RETAINED_KEY_EPOCHS);
  });
});

describe('the ring survives a cold open', () => {
  it('restores retired keys from the persisted identity record', async () => {
    const original = getLocalHealthHouseholdKeys().hdk;
    await rotateTo(2);
    await rotateTo(3);

    await closeLocalHealthSession();
    await openLocalHealthSession({ userId: USER });

    expect(getLocalHealthHouseholdKeys().keyEpoch).toBe(3);
    expect(getLocalHealthRetiredKeyEpochs()).toEqual([1, 2]);
    expect(getLocalHealthRetiredHouseholdKey(1)).toEqual(original);
    expect(getLocalHealthRetiredHouseholdKey(2)).toEqual(key(2));
  });

  it('leaves the persisted shape untouched when nothing has rotated', async () => {
    // A device that never rotated must not grow a new key in its on-disk
    // bundle — the field is omitted entirely, which is what lets a session
    // written before the ring existed read back unchanged.
    expect(getLocalHealthLedger().crypto?.retiredHdksByEpoch).toBeUndefined();

    await closeLocalHealthSession();
    await openLocalHealthSession({ userId: USER });

    expect(getLocalHealthLedger().crypto?.retiredHdksByEpoch).toBeUndefined();
    expect(getLocalHealthRetiredKeyEpochs()).toEqual([]);
  });

  it('persists the ring as hex beside the live key, and only there', async () => {
    await rotateTo(2);

    const crypto = getLocalHealthLedger().crypto;
    expect(crypto?.keyEpoch).toBe(2);
    expect(crypto?.retiredHdksByEpoch).toEqual({ '1': expect.any(String) });
    // Device-local, and nothing serialises it to the wire: a revoked device
    // receives no ring, so retention does not weaken a revoke. Asserted
    // structurally — the ring lives in the device's own identity bundle.
    expect(crypto?.retiredHdksByEpoch?.['1']).not.toBe(crypto?.hdkHex);
  });
});

describe('what a rotation does NOT disturb', () => {
  it('keeps the household binding and the device identity across rotations', async () => {
    const before = getLocalHealthLedger();
    const householdId = before.household.id;
    const deviceId = before.deviceId;

    await rotateTo(2);

    const after = getLocalHealthLedger();
    expect(after.household.id).toBe(householdId);
    expect(after.deviceId).toBe(deviceId);
    // Rows are sealed under the DEK, not the HDK — a rotation must not touch
    // the device key, or every row on disk becomes unreadable.
    expect(after.household.userId).toBe(USER);
  });

  it('tolerates a random hex key of the right length, whatever the source', async () => {
    // The HDK arrives over the mailbox as hex; the engine must accept the real
    // shape, not just this suite's fill patterns.
    const minted = randomBytes(32);
    await installHealthHouseholdKeys({ hdkHex: bytesToHex(minted), keyEpoch: 2 });

    expect(getLocalHealthHouseholdKeys().hdk).toEqual(minted);
    expect(getLocalHealthRetiredKeyEpochs()).toEqual([1]);
  });
});
