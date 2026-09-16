/**
 * He6 blob crypto — framing, sealing and the keyed content address (plan §8).
 *
 * Three properties are checked here and nowhere else:
 *
 *  - **Round-trip and AAD binding.** Every framing field the plan lists is in
 *    the AAD, so chunk substitution, reordering, truncation and cross-blob
 *    splicing all fail to open rather than silently producing wrong bytes.
 *  - **Content-addressing stability.** The id is a pure function of
 *    `(hdk, householdId, sha256(plaintext))`. If it were not, a retry would
 *    orphan a half-uploaded twin instead of resuming the same object.
 *  - **The id is not a confirmation-of-file oracle.** `lf_blobs.blob_id` is
 *    stored in D1 in the clear, and `0157`'s header records that the plaintext
 *    hash was deliberately kept out of those tables. A bare `sha256(plaintext)`
 *    id would put it back in through the id column, on a health surface. The
 *    test asserts the digest does not survive into the id.
 *
 * Static imports throughout (`await import()` throws under this Jest config).
 */
import { bytesToHex } from '@symply/local-first';

import {
  HEALTH_BLOB_PLAINTEXT_CHUNK,
  createHealthBlobHasher,
  deriveHealthBlobContentKey,
  deriveHealthBlobId,
  healthBlobChunkCount,
  healthBlobPlaintextHash,
  openHealthBlobChunk,
  sealHealthBlobChunk,
  type HealthBlobKeyContext,
} from '../blobs/blobCrypto';

const HDK = new Uint8Array(32).fill(7);
const OTHER_HDK = new Uint8Array(32).fill(9);

const CTX: HealthBlobKeyContext = {
  householdId: 'hh_health',
  keyEpoch: 1,
  blobId: 'blob_abc',
};

function pattern(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i * 7 + seed * 13) % 256;
  return out;
}

function seal(plaintext: Uint8Array, chunkIndex = 0, chunkCount = 1): Uint8Array {
  return sealHealthBlobChunk({
    contentKey: deriveHealthBlobContentKey(HDK, CTX),
    ctx: CTX,
    chunkIndex,
    chunkCount,
    plaintext,
  });
}

describe('sealHealthBlobChunk / openHealthBlobChunk', () => {
  it('round-trips a chunk', () => {
    const plaintext = pattern(1_024);
    const opened = openHealthBlobChunk({
      contentKey: deriveHealthBlobContentKey(HDK, CTX),
      ctx: CTX,
      chunkIndex: 0,
      chunkCount: 1,
      envelope: seal(plaintext),
    });
    expect(Array.from(opened)).toEqual(Array.from(plaintext));
  });

  it('emits nonce || ciphertext||tag and never the plaintext', () => {
    const plaintext = pattern(500);
    const envelope = seal(plaintext);
    // 12-byte nonce + 16-byte GCM tag.
    expect(envelope.length).toBe(plaintext.length + 28);
    expect(Array.from(envelope)).not.toEqual(Array.from(plaintext));
    expect(bytesToHex(envelope)).not.toContain(bytesToHex(plaintext));
  });

  it('mints a fresh nonce every call, so the same chunk never repeats bytes', () => {
    const plaintext = pattern(64);
    const first = seal(plaintext);
    const second = seal(plaintext);
    expect(Array.from(first.subarray(0, 12))).not.toEqual(Array.from(second.subarray(0, 12)));
  });

  const tampered: Array<[string, () => void]> = [
    [
      'a different chunk index',
      () =>
        openHealthBlobChunk({
          contentKey: deriveHealthBlobContentKey(HDK, CTX),
          ctx: CTX,
          chunkIndex: 1,
          chunkCount: 2,
          envelope: seal(pattern(32), 0, 2),
        }),
    ],
    [
      'a truncated chunk count',
      () =>
        openHealthBlobChunk({
          contentKey: deriveHealthBlobContentKey(HDK, CTX),
          ctx: CTX,
          chunkIndex: 0,
          chunkCount: 4,
          envelope: seal(pattern(32), 0, 8),
        }),
    ],
    [
      'another blob id',
      () => {
        const other = { ...CTX, blobId: 'blob_other' };
        openHealthBlobChunk({
          contentKey: deriveHealthBlobContentKey(HDK, other),
          ctx: other,
          chunkIndex: 0,
          chunkCount: 1,
          envelope: seal(pattern(32)),
        });
      },
    ],
    [
      'another key epoch',
      () => {
        const other = { ...CTX, keyEpoch: 2 };
        openHealthBlobChunk({
          contentKey: deriveHealthBlobContentKey(HDK, other),
          ctx: other,
          chunkIndex: 0,
          chunkCount: 1,
          envelope: seal(pattern(32)),
        });
      },
    ],
    [
      'another household',
      () => {
        const other = { ...CTX, householdId: 'hh_other' };
        openHealthBlobChunk({
          contentKey: deriveHealthBlobContentKey(HDK, other),
          ctx: other,
          chunkIndex: 0,
          chunkCount: 1,
          envelope: seal(pattern(32)),
        });
      },
    ],
    [
      'another household key',
      () =>
        openHealthBlobChunk({
          contentKey: deriveHealthBlobContentKey(OTHER_HDK, CTX),
          ctx: CTX,
          chunkIndex: 0,
          chunkCount: 1,
          envelope: seal(pattern(32)),
        }),
    ],
  ];

  it.each(tampered)('refuses to open under %s', (_label, open) => {
    expect(open).toThrow();
  });
});

describe('deriveHealthBlobContentKey', () => {
  it('is stable for one blob and different for every framing field', () => {
    const base = deriveHealthBlobContentKey(HDK, CTX);
    expect(bytesToHex(base)).toBe(bytesToHex(deriveHealthBlobContentKey(HDK, CTX)));
    expect(base.length).toBe(32);

    const variants = [
      { ...CTX, blobId: 'blob_other' },
      { ...CTX, keyEpoch: 2 },
      { ...CTX, householdId: 'hh_other' },
    ];
    for (const variant of variants) {
      expect(bytesToHex(deriveHealthBlobContentKey(HDK, variant))).not.toBe(bytesToHex(base));
    }
    expect(bytesToHex(deriveHealthBlobContentKey(OTHER_HDK, CTX))).not.toBe(bytesToHex(base));
  });
});

describe('deriveHealthBlobId — keyed content addressing', () => {
  const plaintextSha256 = healthBlobPlaintextHash(pattern(2_000));

  function id(overrides: Partial<Parameters<typeof deriveHealthBlobId>[0]> = {}): string {
    return deriveHealthBlobId({
      hdk: HDK,
      householdId: 'hh_health',
      plaintextSha256,
      ...overrides,
    });
  }

  it('is the same id for the same bytes, every time', () => {
    expect(id()).toBe(id());
    expect(id()).toMatch(/^blob_[0-9a-f]{32}$/);
  });

  it('changes with the content', () => {
    expect(id({ plaintextSha256: healthBlobPlaintextHash(pattern(2_000, 2)) })).not.toBe(id());
  });

  it('changes with the household key, so a rotation cannot reuse an id it cannot open', () => {
    expect(id({ hdk: OTHER_HDK })).not.toBe(id());
    expect(id({ householdId: 'hh_other' })).not.toBe(id());
  });

  it('does not leak the plaintext digest — the relay gets no confirmation oracle', () => {
    const value = id();
    expect(value).not.toContain(plaintextSha256);
    // Not a prefix, a suffix, or any 32-hex window of the digest either.
    for (let offset = 0; offset + 32 <= plaintextSha256.length; offset += 1) {
      expect(value).not.toContain(plaintextSha256.slice(offset, offset + 32));
    }
  });
});

describe('hashing and chunking', () => {
  it('streams to the same digest as a one-shot hash', () => {
    const bytes = pattern(3_000);
    const hasher = createHealthBlobHasher();
    hasher.update(bytes.subarray(0, 1_000));
    hasher.update(bytes.subarray(1_000, 2_500));
    hasher.update(bytes.subarray(2_500));
    expect(hasher.digestHex()).toBe(healthBlobPlaintextHash(bytes));
  });

  it('counts chunks against the plaintext slice size', () => {
    expect(healthBlobChunkCount(0)).toBe(1);
    expect(healthBlobChunkCount(1)).toBe(1);
    expect(healthBlobChunkCount(HEALTH_BLOB_PLAINTEXT_CHUNK)).toBe(1);
    expect(healthBlobChunkCount(HEALTH_BLOB_PLAINTEXT_CHUNK + 1)).toBe(2);
    expect(healthBlobChunkCount(HEALTH_BLOB_PLAINTEXT_CHUNK * 3)).toBe(3);
  });

  it('keeps a sealed chunk inside the Worker per-chunk ciphertext cap', () => {
    // BLOB_MAX_CHUNK_CIPHERTEXT_BYTES on the shared service is 384_000.
    expect(HEALTH_BLOB_PLAINTEXT_CHUNK + 28).toBeLessThan(384_000);
  });
});
