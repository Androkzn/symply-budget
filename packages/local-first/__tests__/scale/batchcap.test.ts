/**
 * Cheap guard — runs in the package's normal `npm test`.
 *
 * The cap search is the harness's only search algorithm and the only place it
 * could report a confidently wrong number. Cross-checking the ceil(n/3)*4
 * estimator against the real encoder also catches the day someone changes the
 * base64 padding rules.
 */
import { describe, expect, it } from 'vitest';

import { bytesToBase64 } from '../../src/crypto/base64';
import { MAILBOX_BATCH_VERSION, sealOpBatch } from '../../src/sync/batch';

import {
  MAX_MAILBOX_CIPHERTEXT_B64,
  base64Length,
  batchHeader,
  buildBatch,
  findMaxOpsUnderCap,
  probeBatch,
  type BatchIdentity,
} from './lib/batch-cap';
import { enableDevAssertions } from './lib/dev-global';
import { generateLedger } from './lib/ledger-factory';
import { generateOps, pseudoBytes } from './lib/oplog-factory';

enableDevAssertions();

const HDK = pseudoBytes(32, 0xb0b);

function fixture(count: number): BatchIdentity & {
  ops: ReturnType<typeof generateOps>;
  hdk: Uint8Array;
  keyEpoch: number;
} {
  const ledger = generateLedger({ years: 1 });
  const householdId = String(ledger.household.id);
  return {
    ops: generateOps({
      ledger,
      count,
      hdk: HDK,
      householdId,
      deviceId: ledger.deviceId,
      memberId: ledger.memberId,
    }),
    householdId,
    senderDeviceId: ledger.deviceId,
    senderSigningPublicKeyB64: bytesToBase64(pseudoBytes(32, 0xc0ffee)),
    senderVersionVector: { [ledger.deviceId]: count },
    hdk: HDK,
    keyEpoch: 1,
  };
}

describe('batch cap search', () => {
  it('brackets the boundary exactly under a lowered synthetic cap', () => {
    const base = fixture(400);
    const cap = 60_000; // low enough that the answer sits well inside 400 ops
    const search = findMaxOpsUnderCap({ ...base, cap });

    expect(search.maxOps).toBeGreaterThan(0);
    expect(search.maxOps).toBeLessThan(400);
    expect(search.atMax.ops).toBe(search.maxOps);
    expect(search.atMax.fits).toBe(true);
    expect(search.atMax.b64).toBeLessThanOrEqual(cap);

    expect(search.justOver).not.toBeNull();
    expect(search.justOver!.ops).toBe(search.maxOps + 1);
    expect(search.justOver!.fits).toBe(false);
    expect(search.justOver!.b64).toBeGreaterThan(cap);
  });

  it('reports the whole log when it fits', () => {
    const base = fixture(4);
    const search = findMaxOpsUnderCap({ ...base, cap: MAX_MAILBOX_CIPHERTEXT_B64 });
    expect(search.maxOps).toBe(4);
    expect(search.justOver).toBeNull();
  });

  it('reports zero when even one op is over the cap', () => {
    const base = fixture(4);
    const search = findMaxOpsUnderCap({ ...base, cap: 16 });
    expect(search.maxOps).toBe(0);
    expect(search.atMax.fits).toBe(false);
  });

  it('the ceil(n/3)*4 estimator equals the real encoder length', () => {
    const base = fixture(37);
    const sealed = sealOpBatch(buildBatch(base), HDK, 1);
    expect(base64Length(sealed.length)).toBe(bytesToBase64(sealed).length);

    // …including at every residue class of 3, where padding differs.
    for (const extra of [0, 1, 2]) {
      const buffer = pseudoBytes(300 + extra);
      expect(base64Length(buffer.length)).toBe(bytesToBase64(buffer).length);
    }
  });

  it('probes grow monotonically with op count', () => {
    const base = fixture(64);
    const small = probeBatch({ ...base, count: 8, cap: MAX_MAILBOX_CIPHERTEXT_B64 });
    const large = probeBatch({ ...base, count: 64, cap: MAX_MAILBOX_CIPHERTEXT_B64 });
    expect(large.ciphertextBytes).toBeGreaterThan(small.ciphertextBytes);
  });

  it('builds the CURRENT batch version, not a stale copy of it', () => {
    // If the wire format moves again, this fails here rather than quietly
    // re-labelling a different measurement as the same metric.
    const base = fixture(2);
    expect(batchHeader(base).v).toBe(MAILBOX_BATCH_VERSION);
    expect(buildBatch(base).ops[0]).toHaveProperty('payloadB64');
  });
});
