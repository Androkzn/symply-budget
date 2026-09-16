import { describe, expect, it } from 'vitest';

import {
  generateDeviceIdentity,
  generateHouseholdKeys,
  openCheckpoint,
  sealCheckpoint,
} from '../src/index';

describe('checkpoint seal/open', () => {
  it('round-trips plaintext through chunked HDK AEAD and a signed manifest', () => {
    const identity = generateDeviceIdentity('dev-cp');
    const keys = generateHouseholdKeys('hh-cp', 1);
    const plaintext = {
      v: 1 as const,
      householdId: 'hh-cp',
      keyEpoch: 1,
      versionVector: { 'dev-cp': 12, 'dev-peer': 4 },
      household: { id: 'hh-cp', name: 'Checkpoint' },
      rows: [
        {
          table: 'expenses',
          rowKey: 'exp-1',
          bucket: '2026-08',
          deleted: false,
          bodyJson: '{"row":{"id":"exp-1","amount":100},"lww":{"f":{}}}',
          updatedHlc: '000000000000100-0000-devcp',
        },
      ],
    };
    const sealed = sealCheckpoint({
      plaintext,
      hdk: keys.hdk,
      generation: 3,
      signerDeviceId: identity.deviceId,
      signingPrivateKey: identity.signingPrivateKey,
    });
    expect(sealed.chunks.length).toBeGreaterThan(0);
    expect(sealed.manifest.chunkCount).toBe(sealed.chunks.length);
    expect(sealed.manifest.signerDeviceId).toBe(identity.deviceId);

    const opened = openCheckpoint({
      chunks: sealed.chunks,
      manifest: sealed.manifest,
      hdk: keys.hdk,
      signerPublicKey: identity.signingPublicKey,
    });
    expect(opened.rows).toEqual(plaintext.rows);
    expect(opened.versionVector).toEqual(plaintext.versionVector);
  });

  it('rejects a bad signature, a missing chunk, and a tampered chunk', () => {
    const identity = generateDeviceIdentity('dev-cp');
    const other = generateDeviceIdentity('dev-other');
    const keys = generateHouseholdKeys('hh-cp', 1);
    const plaintext = {
      v: 1 as const,
      householdId: 'hh-cp',
      keyEpoch: 1,
      versionVector: {},
      household: { id: 'hh-cp' },
      rows: [],
    };
    const sealed = sealCheckpoint({
      plaintext,
      hdk: keys.hdk,
      generation: 1,
      signerDeviceId: identity.deviceId,
      signingPrivateKey: identity.signingPrivateKey,
    });

    expect(() =>
      openCheckpoint({
        chunks: sealed.chunks,
        manifest: sealed.manifest,
        hdk: keys.hdk,
        signerPublicKey: other.signingPublicKey,
      }),
    ).toThrow(/bad signature/);

    expect(() =>
      openCheckpoint({
        chunks: [],
        manifest: sealed.manifest,
        hdk: keys.hdk,
        signerPublicKey: identity.signingPublicKey,
      }),
    ).toThrow(/incomplete/);

    const tampered = sealed.chunks.map((chunk, i) => {
      if (i !== 0) return chunk;
      const copy = new Uint8Array(chunk);
      copy[copy.length - 1] ^= 0xff;
      return copy;
    });
    expect(() =>
      openCheckpoint({
        chunks: tampered,
        manifest: sealed.manifest,
        hdk: keys.hdk,
        signerPublicKey: identity.signingPublicKey,
      }),
    ).toThrow();
  });

  it('splits a large snapshot into more than one chunk', () => {
    const identity = generateDeviceIdentity('dev-cp');
    const keys = generateHouseholdKeys('hh-cp', 1);
    const body = 'x'.repeat(200_000);
    const plaintext = {
      v: 1 as const,
      householdId: 'hh-cp',
      keyEpoch: 1,
      versionVector: { a: 1 },
      household: {},
      rows: Array.from({ length: 4 }, (_, i) => ({
        table: 'expenses',
        rowKey: `exp-${i}`,
        bucket: '2026-08',
        deleted: false,
        bodyJson: body,
        updatedHlc: '1',
      })),
    };
    const sealed = sealCheckpoint({
      plaintext,
      hdk: keys.hdk,
      generation: 2,
      signerDeviceId: identity.deviceId,
      signingPrivateKey: identity.signingPrivateKey,
    });
    expect(sealed.chunks.length).toBeGreaterThan(1);
    const opened = openCheckpoint({
      chunks: sealed.chunks,
      manifest: sealed.manifest,
      hdk: keys.hdk,
      signerPublicKey: identity.signingPublicKey,
    });
    expect(opened.rows).toHaveLength(4);
  });
});
