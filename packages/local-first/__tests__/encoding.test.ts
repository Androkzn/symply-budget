import { describe, expect, it } from 'vitest';

import { base64DecodedLength, base64ToBytes, bytesToBase64 } from '../src/crypto/base64';
import { bytesToHex, hexToBytes } from '../src/crypto/bytes';
import { deserializeOperation, serializeOperation } from '../src/sync/batch';

/**
 * Encoding is on every persist and every sync, so these run over sizes that
 * cross the chunk boundaries (8192 bytes for hex, 8190 for base64) — the old
 * unchunked implementations were correct but pathologically slow, and the
 * chunked ones are only correct if no chunk splits a group.
 */

function pattern(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = (i * 31 + (i >> 8)) & 0xff;
  return out;
}

const SIZES = [0, 1, 2, 3, 4, 5, 255, 256, 8189, 8190, 8191, 8192, 8193, 24571, 40000];

describe('bytesToHex / hexToBytes', () => {
  it('round-trips across and beyond the chunk boundary', () => {
    for (const n of SIZES) {
      const bytes = pattern(n);
      const hex = bytesToHex(bytes);
      expect(hex.length).toBe(n * 2);
      expect(hexToBytes(hex)).toEqual(bytes);
    }
  });

  it('covers every byte value', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) all[i] = i;
    expect(hexToBytes(bytesToHex(all))).toEqual(all);
  });

  it('emits lowercase, zero-padded pairs', () => {
    expect(bytesToHex(new Uint8Array([0x00, 0x0f, 0xa0, 0xff]))).toBe('000fa0ff');
  });

  it('accepts uppercase input', () => {
    expect(hexToBytes('000FA0FF')).toEqual(new Uint8Array([0x00, 0x0f, 0xa0, 0xff]));
  });

  it('rejects odd length and non-hex characters', () => {
    expect(() => hexToBytes('abc')).toThrow(/odd length/);
    expect(() => hexToBytes('zz')).toThrow(/invalid hex/);
    expect(() => hexToBytes('00ß0')).toThrow(/invalid hex/);
  });
});

describe('bytesToBase64 / base64ToBytes', () => {
  it('round-trips across and beyond the chunk boundary', () => {
    for (const n of SIZES) {
      const bytes = pattern(n);
      const text = bytesToBase64(bytes);
      expect(base64ToBytes(text)).toEqual(bytes);
      expect(base64DecodedLength(text)).toBe(n);
    }
  });

  it('matches known vectors, including both padding cases', () => {
    const enc = (s: string) => bytesToBase64(new TextEncoder().encode(s));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('Zg==');
    expect(enc('fo')).toBe('Zm8=');
    expect(enc('foo')).toBe('Zm9v');
    expect(enc('foob')).toBe('Zm9vYg==');
    expect(enc('fooba')).toBe('Zm9vYmE=');
    expect(enc('foobar')).toBe('Zm9vYmFy');
  });

  it('covers every byte value', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) all[i] = i;
    expect(base64ToBytes(bytesToBase64(all))).toEqual(all);
  });

  it('is meaningfully smaller than hex', () => {
    const bytes = pattern(30000);
    expect(bytesToBase64(bytes).length).toBeLessThan(bytesToHex(bytes).length * 0.7);
  });

  it('rejects malformed input', () => {
    expect(() => base64ToBytes('Zm9')).toThrow(/multiple of 4/);
    expect(() => base64ToBytes('Z!9v')).toThrow(/invalid character/);
  });

  it('agrees with the platform encoder where one exists', () => {
    const g = globalThis as { btoa?: (s: string) => string };
    if (typeof g.btoa !== 'function') return;
    for (const n of [1, 2, 3, 255, 8191]) {
      const bytes = pattern(n);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
      expect(bytesToBase64(bytes)).toBe(g.btoa(binary));
    }
  });
});

/**
 * The wire round trip, not just the encoder. Batch v2 puts payload and
 * signature through JSON, so a chunk-boundary or high-byte defect would surface
 * as a bad signature on a peer rather than as an encoding failure here.
 */
describe('batch v2 operation round trip', () => {
  const base = {
    opId: 'op-1',
    householdId: 'hh-1',
    deviceId: 'dev-1',
    authorMemberId: 'm-1',
    hlc: '000000001700000-0000-dev1',
    seq: 7,
    parentsJson: '["op-0"]',
    opType: 'EXPENSE_CREATE',
    entityType: 'expense',
    entityId: 'e-1',
    keyEpoch: 3,
    appliedAt: 1_700_000_000_000,
  };

  it('survives JSON byte-for-byte across the chunk boundary', () => {
    for (const n of [0, 1, 2, 3, 8189, 8190, 8191, 24571]) {
      const op = { ...base, payload: pattern(n), signature: pattern(64) };
      const revived = deserializeOperation(
        JSON.parse(JSON.stringify(serializeOperation(op))) as never,
      );
      expect([...revived.payload]).toEqual([...op.payload]);
      expect([...revived.signature]).toEqual([...op.signature]);
      expect(revived.hlc).toBe(op.hlc);
      expect(revived.seq).toBe(op.seq);
    }
  });

  it('survives all 256 byte values', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) all[i] = i;
    const op = { ...base, payload: all, signature: all };
    const revived = deserializeOperation(
      JSON.parse(JSON.stringify(serializeOperation(op))) as never,
    );
    expect([...revived.payload]).toEqual([...all]);
  });
});
