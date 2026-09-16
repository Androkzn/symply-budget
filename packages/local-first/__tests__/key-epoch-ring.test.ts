/**
 * Reading across a key rotation.
 *
 * A household rotates its HDK on every device revocation, and `generateHouseholdKeys`
 * mints a RANDOM key each time — so nothing about the new epoch lets a device
 * derive the old one. Everything already written stays sealed under the epoch
 * it was written at: ops carry theirs, and a checkpoint carries whichever was
 * current when it was published. Nothing is ever re-sealed.
 *
 * So a device holding only the current key can read only the slice of history
 * written since the last rotation. That is what shipped: a member admitted to
 * `Sweet Home` (epoch 5, four rotations) received 136 KB of ops and a 659 KB
 * checkpoint, opened neither, and sat on an empty ledger with no error on any
 * screen. These tests pin the ring that fixes it — and the refusal that must
 * still happen when a key genuinely is not held.
 */
import { describe, expect, it } from 'vitest';

import {
  MemoryLocalFirstStore,
  OpLog,
  createOpId,
  generateDeviceIdentity,
  generateHouseholdKeys,
  openCheckpoint,
  sealCheckpoint,
  utf8Encode,
  type HouseholdKeys,
  type StoredOperation,
} from '../src/index';

const HOUSEHOLD = 'hh-rotate';

/** Author one op under `keys` and hand back the sealed row a peer would receive. */
async function authorAt(keys: HouseholdKeys, payload: string) {
  const store = new MemoryLocalFirstStore();
  const identity = generateDeviceIdentity('dev-author');
  await store.open(new Uint8Array(32).fill(7));
  const log = new OpLog({ store, identity, householdKeys: keys });
  const stored = await log.append({
    opId: createOpId(),
    authorMemberId: 'member-author',
    parents: [],
    opType: 'TXN_CREATE',
    entityType: 'transaction',
    entityId: `txn-${payload}`,
    plaintextPayload: utf8Encode(payload),
  });
  return { stored, identity };
}

/** A reader at `current`, optionally holding the retired ring. */
async function readerAt(
  current: HouseholdKeys,
  retiredHdks?: ReadonlyMap<number, Uint8Array>,
) {
  const store = new MemoryLocalFirstStore();
  await store.open(new Uint8Array(32).fill(9));
  const log = new OpLog({
    store,
    identity: generateDeviceIdentity('dev-reader'),
    householdKeys: current,
    ...(retiredHdks ? { retiredHdks } : {}),
  });
  return log;
}

describe('OpLog key ring', () => {
  it('applies an op sealed under a retired epoch when the ring carries that key', async () => {
    const epoch1 = generateHouseholdKeys(HOUSEHOLD, 1);
    const epoch2: HouseholdKeys = generateHouseholdKeys(HOUSEHOLD, 2);
    const { stored, identity } = await authorAt(epoch1, 'sealed-at-epoch-1');

    const log = await readerAt(epoch2, new Map([[1, epoch1.hdk]]));
    const result = await log.applyRemote(stored, identity.signingPublicKey);

    expect(result.status).toBe('applied');
  });

  it('still applies ops at the CURRENT epoch once a ring is present', async () => {
    const epoch1 = generateHouseholdKeys(HOUSEHOLD, 1);
    const epoch2 = generateHouseholdKeys(HOUSEHOLD, 2);
    const { stored, identity } = await authorAt(epoch2, 'sealed-at-epoch-2');

    const log = await readerAt(epoch2, new Map([[1, epoch1.hdk]]));

    expect((await log.applyRemote(stored, identity.signingPublicKey)).status).toBe('applied');
  });

  it('rejects — retryably — an op whose epoch is not on the ring at all', async () => {
    const epoch1 = generateHouseholdKeys(HOUSEHOLD, 1);
    const epoch2 = generateHouseholdKeys(HOUSEHOLD, 2);
    const { stored, identity } = await authorAt(epoch1, 'sealed-at-epoch-1');

    // No ring: exactly the device that shipped, and exactly the failure it hit.
    const log = await readerAt(epoch2);
    const result = await log.applyRemote(stored, identity.signingPublicKey);

    expect(result).toEqual({ status: 'rejected', reason: 'key_epoch_mismatch' });
  });

  it('does not open an op with the WRONG key filed under the right epoch', async () => {
    // The ring is a lookup, not a guess — a key that happens to sit at epoch 1
    // must not decrypt an epoch-1 op it did not seal.
    const epoch1 = generateHouseholdKeys(HOUSEHOLD, 1);
    const impostor = generateHouseholdKeys(HOUSEHOLD, 1);
    const epoch2 = generateHouseholdKeys(HOUSEHOLD, 2);
    const { stored, identity } = await authorAt(epoch1, 'sealed-at-epoch-1');

    const log = await readerAt(epoch2, new Map([[1, impostor.hdk]]));
    const result = await log.applyRemote(stored, identity.signingPublicKey);

    expect(result).toEqual({ status: 'rejected', reason: 'decrypt_failed' });
  });

  it('never seals new ops under a retired key', async () => {
    const epoch1 = generateHouseholdKeys(HOUSEHOLD, 1);
    const epoch2 = generateHouseholdKeys(HOUSEHOLD, 2);
    const store = new MemoryLocalFirstStore();
    await store.open(new Uint8Array(32).fill(3));
    const log = new OpLog({
      store,
      identity: generateDeviceIdentity('dev-writer'),
      householdKeys: epoch2,
      retiredHdks: new Map([[1, epoch1.hdk]]),
    });

    const stored: StoredOperation = await log.append({
      opId: createOpId(),
      authorMemberId: 'member-writer',
      parents: [],
      opType: 'TXN_CREATE',
      entityType: 'transaction',
      entityId: 'txn-new',
      plaintextPayload: utf8Encode('{"amount":1}'),
    });

    expect(stored.keyEpoch).toBe(2);
  });
});

describe('checkpoint key ring', () => {
  it('opens a checkpoint sealed under a retired epoch', () => {
    const identity = generateDeviceIdentity('dev-owner');
    const epoch1 = generateHouseholdKeys(HOUSEHOLD, 1);
    const epoch5 = generateHouseholdKeys(HOUSEHOLD, 5);
    const plaintext = {
      v: 1 as const,
      householdId: HOUSEHOLD,
      keyEpoch: 1,
      versionVector: {},
      household: { id: HOUSEHOLD, name: 'Sweet Home' },
      rows: [
        {
          table: 'expenses',
          rowKey: 'exp-1',
          bucket: '2026-08',
          deleted: false,
          bodyJson: '{"row":{"id":"exp-1","amount":100},"lww":{"f":{}}}',
          updatedHlc: '000000000000100-0000-devown',
        },
      ],
    };
    const sealed = sealCheckpoint({
      plaintext,
      hdk: epoch1.hdk,
      generation: 1,
      signerDeviceId: identity.deviceId,
      signingPrivateKey: identity.signingPrivateKey,
    });

    // The joiner: current key epoch 5, ring carries 1..4.
    const opened = openCheckpoint({
      chunks: sealed.chunks,
      manifest: sealed.manifest,
      hdk: epoch5.hdk,
      retiredHdks: [
        generateHouseholdKeys(HOUSEHOLD, 4).hdk,
        generateHouseholdKeys(HOUSEHOLD, 3).hdk,
        epoch1.hdk,
      ],
      signerPublicKey: identity.signingPublicKey,
    });

    expect(opened.rows).toEqual(plaintext.rows);
  });

  it('throws when no key on the ring opens it', () => {
    const identity = generateDeviceIdentity('dev-owner');
    const epoch1 = generateHouseholdKeys(HOUSEHOLD, 1);
    const epoch5 = generateHouseholdKeys(HOUSEHOLD, 5);
    const sealed = sealCheckpoint({
      plaintext: {
        v: 1 as const,
        householdId: HOUSEHOLD,
        keyEpoch: 1,
        versionVector: {},
        household: { id: HOUSEHOLD, name: 'Sweet Home' },
        rows: [],
      },
      hdk: epoch1.hdk,
      generation: 1,
      signerDeviceId: identity.deviceId,
      signingPrivateKey: identity.signingPrivateKey,
    });

    expect(() =>
      openCheckpoint({
        chunks: sealed.chunks,
        manifest: sealed.manifest,
        hdk: epoch5.hdk,
        retiredHdks: [generateHouseholdKeys(HOUSEHOLD, 2).hdk],
        signerPublicKey: identity.signingPublicKey,
      }),
    ).toThrow();
  });
});
