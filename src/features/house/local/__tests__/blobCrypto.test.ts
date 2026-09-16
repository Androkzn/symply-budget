/**
 * H6 blob sealing — the crypto framing (plan §8).
 *
 * These are the properties an attacker with the relay's view has to be unable to
 * break. The relay holds every ciphertext chunk of every household it serves, so
 * the interesting failures are not "can it decrypt" (it has no key) but "can it
 * rearrange": swap two chunks, splice a chunk from another blob, truncate the
 * tail, or replay a blob from before a key rotation. Each of those is a
 * one-field change to the AAD, so each gets a test.
 *
 * Static imports throughout (plan §6.2: `await import()` throws under this Jest
 * config).
 */
import { aeadEncrypt } from '@symply/local-first';

import {
  BLOB_PLAINTEXT_CHUNK,
  blobChunkAad,
  blobChunkCount,
  blobPlaintextHash,
  createBlobHasher,
  deriveBlobContentKey,
  openBlobChunk,
  sealBlobChunk,
  type BlobKeyContext,
} from '../blobs/blobCrypto';

const HDK = new Uint8Array(32).fill(7);
const CTX: BlobKeyContext = { householdId: 'hh_1', keyEpoch: 1, blobId: 'blob_a' };

function key(ctx: BlobKeyContext = CTX, hdk = HDK): Uint8Array {
  return deriveBlobContentKey(hdk, ctx);
}

function seal(
  plaintext: Uint8Array,
  ctx: BlobKeyContext = CTX,
  chunkIndex = 0,
  chunkCount = 1,
): Uint8Array {
  return sealBlobChunk({ contentKey: key(ctx), ctx, chunkIndex, chunkCount, plaintext });
}

describe('deriveBlobContentKey', () => {
  it('produces a 32-byte AES key', () => {
    expect(key()).toHaveLength(32);
  });

  it('is deterministic for the same (hdk, household, epoch, blob)', () => {
    expect(Array.from(key())).toEqual(Array.from(key()));
  });

  it.each([
    ['blob', { ...CTX, blobId: 'blob_b' }],
    ['household', { ...CTX, householdId: 'hh_2' }],
    ['key epoch', { ...CTX, keyEpoch: 2 }],
  ])('derives a different key per %s', (_label, ctx) => {
    expect(Array.from(key(ctx as BlobKeyContext))).not.toEqual(Array.from(key()));
  });

  it('derives a different key from a different HDK', () => {
    expect(Array.from(key(CTX, new Uint8Array(32).fill(9)))).not.toEqual(Array.from(key()));
  });
});

describe('sealBlobChunk / openBlobChunk', () => {
  const plaintext = new Uint8Array([1, 2, 3, 4, 5, 250, 251]);

  it('round-trips', () => {
    const envelope = seal(plaintext);
    const opened = openBlobChunk({
      contentKey: key(),
      ctx: CTX,
      chunkIndex: 0,
      chunkCount: 1,
      envelope,
    });
    expect(Array.from(opened)).toEqual(Array.from(plaintext));
  });

  it('produces ciphertext that is not the plaintext', () => {
    const envelope = seal(plaintext);
    expect(Array.from(envelope.subarray(12))).not.toEqual(Array.from(plaintext));
    // nonce(12) + ciphertext + tag(16)
    expect(envelope.length).toBe(plaintext.length + 28);
  });

  it('mints a fresh nonce on every call — which is why a retry must NOT re-seal', () => {
    const a = seal(plaintext);
    const b = seal(plaintext);
    expect(Array.from(a.subarray(0, 12))).not.toEqual(Array.from(b.subarray(0, 12)));
  });

  it('refuses a chunk opened at the wrong index (reordering)', () => {
    const envelope = seal(plaintext, CTX, 2, 5);
    expect(() =>
      openBlobChunk({ contentKey: key(), ctx: CTX, chunkIndex: 3, chunkCount: 5, envelope }),
    ).toThrow();
  });

  it('refuses a chunk whose blob was truncated (chunkCount changed)', () => {
    const envelope = seal(plaintext, CTX, 0, 8);
    expect(() =>
      openBlobChunk({ contentKey: key(), ctx: CTX, chunkIndex: 0, chunkCount: 4, envelope }),
    ).toThrow();
  });

  it('refuses a chunk spliced in from another blob', () => {
    const other: BlobKeyContext = { ...CTX, blobId: 'blob_b' };
    const envelope = sealBlobChunk({
      contentKey: key(other),
      ctx: other,
      chunkIndex: 0,
      chunkCount: 1,
      plaintext,
    });
    expect(() =>
      openBlobChunk({ contentKey: key(), ctx: CTX, chunkIndex: 0, chunkCount: 1, envelope }),
    ).toThrow();
  });

  it('refuses a chunk sealed under a different key epoch', () => {
    const rotated: BlobKeyContext = { ...CTX, keyEpoch: 2 };
    const envelope = sealBlobChunk({
      contentKey: key(rotated),
      ctx: rotated,
      chunkIndex: 0,
      chunkCount: 1,
      plaintext,
    });
    expect(() =>
      openBlobChunk({ contentKey: key(), ctx: CTX, chunkIndex: 0, chunkCount: 1, envelope }),
    ).toThrow();
  });

  it('refuses a tampered byte', () => {
    const envelope = seal(plaintext);
    envelope[envelope.length - 1] = (envelope[envelope.length - 1]! + 1) % 256;
    expect(() =>
      openBlobChunk({ contentKey: key(), ctx: CTX, chunkIndex: 0, chunkCount: 1, envelope }),
    ).toThrow();
  });

  it('binds the AAD to every framing field the plan lists', () => {
    const aad = new TextDecoder().decode(blobChunkAad(CTX, 3, 9));
    expect(aad).toBe('lf-blob:v1:hh_1:1:blob_a:3:9:A256GCM');
  });

  it('does not open with the right key but no AAD', () => {
    const envelope = seal(plaintext);
    // A caller that forgot the AAD would otherwise silently accept a chunk from
    // anywhere in any blob of the household.
    const bare = aeadEncrypt(key(), plaintext);
    expect(bare).not.toEqual(envelope);
    expect(() =>
      openBlobChunk({ contentKey: key(), ctx: CTX, chunkIndex: 0, chunkCount: 1, envelope: bare }),
    ).toThrow();
  });
});

describe('chunking and hashing', () => {
  it('is one chunk for an empty or tiny file', () => {
    expect(blobChunkCount(0)).toBe(1);
    expect(blobChunkCount(1)).toBe(1);
  });

  it('splits exactly on the plaintext chunk boundary', () => {
    expect(blobChunkCount(BLOB_PLAINTEXT_CHUNK)).toBe(1);
    expect(blobChunkCount(BLOB_PLAINTEXT_CHUNK + 1)).toBe(2);
    expect(blobChunkCount(BLOB_PLAINTEXT_CHUNK * 3)).toBe(3);
  });

  it('keeps a sealed chunk inside the Worker per-chunk cap', () => {
    // 384_000 is BLOB_MAX_CHUNK_CIPHERTEXT_BYTES on the Worker. A full-size
    // slice must clear it, or every multi-chunk upload 413s in production while
    // every small-file test passes.
    // Filled deterministically rather than with `randomBytes`: WebCrypto's
    // `getRandomValues` refuses anything over 65,536 bytes, and the size is what
    // this asserts — the contents are irrelevant to AEAD expansion.
    const full = new Uint8Array(BLOB_PLAINTEXT_CHUNK).map((_, i) => i % 256);
    expect(seal(full).length).toBeLessThan(384_000);
  });

  it('hashes incrementally to the same digest as hashing the whole buffer', () => {
    const whole = new Uint8Array(1000).map((_, i) => i % 256);
    const hasher = createBlobHasher();
    hasher.update(whole.subarray(0, 400));
    hasher.update(whole.subarray(400, 900));
    hasher.update(whole.subarray(900));
    expect(hasher.digestHex()).toBe(blobPlaintextHash(whole));
  });

  it('produces a different digest for a one-byte change', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 4]);
    expect(blobPlaintextHash(a)).not.toBe(blobPlaintextHash(b));
  });
});
