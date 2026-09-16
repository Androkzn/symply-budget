/**
 * H6 attachment channel — device side (plan §8).
 *
 * The plan's H6 DoD names one verification that no other layer can make:
 * *"Interrupted upload resumes without duplicate chunks **and without minting a
 * new nonce**."* The server cannot check it — every chunk is opaque bytes to it
 * — so it is checked here, by capturing the exact envelope of every PUT across a
 * simulated crash and asserting the nonces are byte-identical.
 *
 * `expo-file-system/legacy` is backed by a real in-memory filesystem rather than
 * a bag of `jest.fn()`s. A stateless mock would let a resume path that silently
 * re-seals pass every assertion in this file, which is precisely the bug the
 * suite exists to catch.
 *
 * Static imports throughout (plan §6.2: `await import()` throws under this Jest
 * config).
 */
import * as FileSystem from 'expo-file-system/legacy';

import { bytesToBase64 } from '@symply/local-first';

import {
  BLOB_MAX_PLAINTEXT_BYTES,
  BLOB_PLAINTEXT_CHUNK,
  blobPlaintextHash,
} from '../blobs/blobCrypto';
import {
  HouseBlobCorruptError,
  HouseBlobKeyUnavailableError,
  HouseBlobTooLargeError,
  cachedBlobUri,
  clearHouseBlobLocalState,
  deleteHouseBlob,
  evictHouseBlobCache,
  getHouseBlobUsage,
  houseBlobIsAvailable,
  isHouseBlobCached,
  newBlobId,
  resolveHouseBlobUri,
  stageHouseBlobOrigin,
  uploadHouseBlob,
  type HouseBlobDescriptor,
} from '../blobs/houseBlobStore';

// --- in-memory filesystem ---------------------------------------------------

type Entry = { bytes: Uint8Array; mtime: number; isDirectory: boolean };

const fs = new Map<string, Entry>();
let clock = 1_000;

function normalize(uri: string): string {
  return uri.replace(/\/+$/, '');
}

/**
 * Writing a file materialises its parent directories, as a real filesystem does.
 * Without that, `evictHouseBlobCache`'s "does the cache dir exist" guard reads
 * false while the cache is full of files, and the eviction tests pass by never
 * running.
 */
function put(uri: string, bytes: Uint8Array, isDirectory = false): void {
  clock += 1;
  const path = normalize(uri);
  if (!isDirectory) {
    const parts = path.split('/');
    for (let i = parts.length - 1; i > 3; i -= 1) {
      const parent = parts.slice(0, i).join('/');
      if (!fs.has(parent)) fs.set(parent, { bytes: new Uint8Array(0), mtime: clock, isDirectory: true });
    }
  }
  fs.set(path, { bytes, mtime: clock, isDirectory });
}

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  copyAsync: jest.fn(),
  readDirectoryAsync: jest.fn(),
}));

function installFsBehaviour(): void {
  const mocked = FileSystem as jest.Mocked<typeof FileSystem>;

  mocked.getInfoAsync.mockImplementation(async (uri: string) => {
    const entry = fs.get(normalize(uri));
    if (!entry) return { exists: false, uri, isDirectory: false } as never;
    return {
      exists: true,
      uri,
      isDirectory: entry.isDirectory,
      size: entry.bytes.length,
      modificationTime: entry.mtime,
    } as never;
  });

  mocked.makeDirectoryAsync.mockImplementation(async (uri: string) => {
    put(uri, new Uint8Array(0), true);
  });

  mocked.readAsStringAsync.mockImplementation(
    async (uri: string, options?: { position?: number; length?: number }) => {
      const entry = fs.get(normalize(uri));
      if (!entry) throw new Error(`ENOENT ${uri}`);
      const from = options?.position ?? 0;
      const to = options?.length === undefined ? entry.bytes.length : from + options.length;
      return bytesToBase64(entry.bytes.subarray(from, to));
    },
  );

  mocked.writeAsStringAsync.mockImplementation(async (uri: string, contents: string) => {
    put(uri, base64(contents));
  });

  mocked.deleteAsync.mockImplementation(async (uri: string) => {
    const prefix = `${normalize(uri)}/`;
    for (const key of Array.from(fs.keys())) {
      if (key === normalize(uri) || key.startsWith(prefix)) fs.delete(key);
    }
  });

  mocked.copyAsync.mockImplementation(async ({ from, to }: { from: string; to: string }) => {
    const entry = fs.get(normalize(from));
    if (!entry) throw new Error(`ENOENT ${from}`);
    put(to, entry.bytes);
  });

  mocked.readDirectoryAsync.mockImplementation(async (uri: string) => {
    const prefix = `${normalize(uri)}/`;
    return Array.from(fs.keys())
      .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .map((key) => key.slice(prefix.length));
  });
}

function base64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

// --- engine + transport stand-ins -------------------------------------------

let mockKeyEpoch = 1;
/** Retired `epoch → hdk`, exactly as the engine now persists (H6 §8.2). */
const mockRetiredKeys = new Map<number, Uint8Array>();

jest.mock('../engine', () => ({
  getActiveHouseholdId: jest.fn(() => 'hh_blob'),
  getLocalHouseSession: jest.fn(async () => ({
    householdId: 'hh_blob',
    householdKeys: {
      householdId: 'hh_blob',
      // A rotation mints a WHOLE NEW random HDK — modelled here by making the
      // key material depend on the epoch, not just the epoch number. A mock that
      // kept one hdk across epochs would let a broken keyring pass.
      hdk: new Uint8Array(32).fill(mockKeyEpoch === 1 ? 3 : 77),
      keyEpoch: mockKeyEpoch,
    },
    retiredHouseholdKeys: mockRetiredKeys,
  })),
}));

/** A stand-in relay: remembers exactly what was PUT, chunk by chunk. */
const mockRelay = {
  chunks: new Map<string, Uint8Array>(),
  puts: [] as Array<{ blobId: string; chunkIndex: number; envelope: Uint8Array }>,
  finalized: [] as string[],
  deleted: [] as string[],
  failAfterChunk: null as number | null,
  reset() {
    this.chunks.clear();
    this.puts = [];
    this.finalized = [];
    this.deleted = [];
    this.failAfterChunk = null;
  },
};

jest.mock('../blobs/blobTransport', () => ({
  putBlobChunk: jest.fn(async (input: {
    blobId: string;
    chunkIndex: number;
    envelope: Uint8Array;
  }) => {
    mockRelay.puts.push({
      blobId: input.blobId,
      chunkIndex: input.chunkIndex,
      envelope: Uint8Array.from(input.envelope),
    });
    if (mockRelay.failAfterChunk !== null && input.chunkIndex >= mockRelay.failAfterChunk) {
      throw new Error('network died');
    }
    mockRelay.chunks.set(`${input.blobId}/${input.chunkIndex}`, Uint8Array.from(input.envelope));
  }),
  finalizeBlob: jest.fn(async (input: { blobId: string; chunkCount: number }) => {
    mockRelay.finalized.push(input.blobId);
    return {
      blobId: input.blobId,
      keyEpoch: 1,
      chunkCount: input.chunkCount,
      cipherBytes: 0,
      status: 'complete' as const,
    };
  }),
  fetchBlobChunk: jest.fn(async (_hh: string, blobId: string, index: number) => {
    const found = mockRelay.chunks.get(`${blobId}/${index}`);
    if (!found) throw new Error('missing chunk');
    return found;
  }),
  fetchBlobManifest: jest.fn(async (_hh: string, blobId: string) => ({
    blobId,
    keyEpoch: 1,
    chunkCount: 1,
    cipherBytes: 0,
    status: 'complete' as const,
  })),
  deleteRemoteBlob: jest.fn(async (_hh: string, blobId: string) => {
    mockRelay.deleted.push(blobId);
  }),
  fetchBlobUsage: jest.fn(),
}));

// --- fixtures ----------------------------------------------------------------

const SOURCE = 'file:///doc/picked/photo.jpg';

function seedSource(bytes: Uint8Array): void {
  put(SOURCE, bytes);
}

function pattern(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i * 7 + seed * 13) % 256;
  return out;
}

function nonceOf(envelope: Uint8Array): string {
  return Array.from(envelope.subarray(0, 12)).join(',');
}

/** Wipe the plaintext cache so a resolve is forced to go to the relay. */
function dropCache(blobId: string): void {
  fs.delete(normalize(`file:///cache/lf-blobs/${blobId}`));
}

beforeEach(() => {
  fs.clear();
  clock = 1_000;
  mockKeyEpoch = 1;
  mockRetiredKeys.clear();
  mockRelay.reset();
  jest.clearAllMocks();
  installFsBehaviour();
});

describe('uploadHouseBlob', () => {
  it('returns a descriptor with no device path in it', async () => {
    const bytes = pattern(500);
    seedSource(bytes);

    const descriptor = await uploadHouseBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });

    expect(descriptor).toEqual({
      blobId: expect.stringMatching(/^blob_[0-9a-f]{24}$/),
      mime: 'image/jpeg',
      bytes: 500,
      sha256: blobPlaintextHash(bytes),
      chunkCount: 1,
      keyEpoch: 1,
    });
    // The Budget wish-media defect, asserted as an absence: nothing in the row
    // that a peer's filesystem cannot resolve.
    expect(JSON.stringify(descriptor)).not.toContain('file://');
  });

  it('splits a multi-chunk file and uploads every chunk once', async () => {
    seedSource(pattern(BLOB_PLAINTEXT_CHUNK * 2 + 10));

    const descriptor = await uploadHouseBlob({ sourceUri: SOURCE, mime: 'application/pdf' });

    expect(descriptor.chunkCount).toBe(3);
    expect(mockRelay.puts.map((p) => p.chunkIndex)).toEqual([0, 1, 2]);
  });

  it('uploads ciphertext, never the source bytes', async () => {
    const bytes = pattern(400);
    seedSource(bytes);
    await uploadHouseBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });

    const sent = mockRelay.puts[0]!.envelope;
    expect(Array.from(sent)).not.toEqual(Array.from(bytes));
    expect(sent.length).toBe(bytes.length + 28);
  });

  it('finalizes only after every chunk has landed', async () => {
    seedSource(pattern(BLOB_PLAINTEXT_CHUNK + 1));
    await uploadHouseBlob({ sourceUri: SOURCE, mime: 'application/pdf' });
    expect(mockRelay.finalized).toHaveLength(1);
    expect(mockRelay.puts).toHaveLength(2);
  });

  it('reports progress per chunk', async () => {
    seedSource(pattern(BLOB_PLAINTEXT_CHUNK * 2));
    const seen: number[] = [];
    await uploadHouseBlob({
      sourceUri: SOURCE,
      mime: 'application/pdf',
      onProgress: (p) => seen.push(p.percent),
    });
    expect(seen).toEqual([50, 100]);
  });

  it('clears the staging directory once finalized', async () => {
    seedSource(pattern(BLOB_PLAINTEXT_CHUNK + 1));
    const descriptor = await uploadHouseBlob({ sourceUri: SOURCE, mime: 'application/pdf' });
    const staged = Array.from(fs.keys()).filter((k) => k.includes(`lf-blob-staging/${descriptor.blobId}`));
    expect(staged).toEqual([]);
  });

  it('seeds the cache from the authoring device, so it never re-downloads its own file', async () => {
    seedSource(pattern(300));
    const descriptor = await uploadHouseBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });
    await expect(isHouseBlobCached(descriptor.blobId)).resolves.toBe(true);
  });

  it('rejects an empty or unreadable source rather than uploading nothing', async () => {
    seedSource(new Uint8Array(0));
    await expect(uploadHouseBlob({ sourceUri: SOURCE, mime: 'image/jpeg' })).rejects.toThrow(
      /empty or unreadable/,
    );
  });
});

describe('resume — the nonce-reuse invariant (H6 DoD)', () => {
  it('re-sends the byte-identical envelope after an interruption', async () => {
    seedSource(pattern(BLOB_PLAINTEXT_CHUNK * 3));
    const blobId = newBlobId();

    // Crash partway: chunk 0 lands, chunk 1's PUT throws.
    mockRelay.failAfterChunk = 1;
    await expect(
      uploadHouseBlob({ sourceUri: SOURCE, mime: 'application/pdf', blobId }),
    ).rejects.toThrow('network died');
    const firstAttempt = mockRelay.puts.map((p) => ({ ...p }));
    expect(firstAttempt.map((p) => p.chunkIndex)).toEqual([0, 1]);

    // Resume.
    mockRelay.failAfterChunk = null;
    mockRelay.puts = [];
    await uploadHouseBlob({ sourceUri: SOURCE, mime: 'application/pdf', blobId });

    const resent = mockRelay.puts.filter((p) => p.chunkIndex <= 1);
    expect(resent).toHaveLength(2);
    for (const sent of resent) {
      const original = firstAttempt.find((p) => p.chunkIndex === sent.chunkIndex)!;
      // Same nonce AND same ciphertext: the resume re-read the staged envelope
      // instead of re-sealing. A re-seal would mint a second nonce for the same
      // (contentKey, chunkIndex) and leak the XOR of the two plaintexts.
      expect(nonceOf(sent.envelope)).toBe(nonceOf(original.envelope));
      expect(Array.from(sent.envelope)).toEqual(Array.from(original.envelope));
    }
  });

  it('produces a descriptor identical to an uninterrupted upload', async () => {
    const bytes = pattern(BLOB_PLAINTEXT_CHUNK * 2 + 7);
    seedSource(bytes);
    const blobId = newBlobId();

    mockRelay.failAfterChunk = 1;
    await expect(
      uploadHouseBlob({ sourceUri: SOURCE, mime: 'application/pdf', blobId }),
    ).rejects.toThrow();
    mockRelay.failAfterChunk = null;

    const descriptor = await uploadHouseBlob({
      sourceUri: SOURCE,
      mime: 'application/pdf',
      blobId,
    });
    // The hash covers the whole plaintext, so a resume that skipped hashing the
    // already-staged chunks would produce a digest no peer could verify.
    expect(descriptor.sha256).toBe(blobPlaintextHash(bytes));
    expect(descriptor.chunkCount).toBe(3);
  });

  it('does not duplicate chunks on the relay after a resume', async () => {
    seedSource(pattern(BLOB_PLAINTEXT_CHUNK * 2));
    const blobId = newBlobId();
    mockRelay.failAfterChunk = 1;
    await expect(
      uploadHouseBlob({ sourceUri: SOURCE, mime: 'application/pdf', blobId }),
    ).rejects.toThrow();
    mockRelay.failAfterChunk = null;
    await uploadHouseBlob({ sourceUri: SOURCE, mime: 'application/pdf', blobId });

    expect(Array.from(mockRelay.chunks.keys()).sort()).toEqual([`${blobId}/0`, `${blobId}/1`]);
  });
});

describe('resolveHouseBlobUri — the peer side', () => {
  async function uploadFixture(bytes: Uint8Array): Promise<HouseBlobDescriptor> {
    seedSource(bytes);
    return uploadHouseBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });
  }

  it('fetches, decrypts and returns the byte-identical file', async () => {
    const bytes = pattern(BLOB_PLAINTEXT_CHUNK + 123, 9);
    const descriptor = await uploadFixture(bytes);
    dropCache(descriptor.blobId);

    const uri = await resolveHouseBlobUri(descriptor);
    expect(Array.from(fs.get(normalize(uri))!.bytes)).toEqual(Array.from(bytes));
  });

  it('serves the cache without touching the relay on the second read', async () => {
    const descriptor = await uploadFixture(pattern(200));
    const before = (FileSystem as jest.Mocked<typeof FileSystem>).writeAsStringAsync.mock.calls
      .length;

    await resolveHouseBlobUri(descriptor);
    await resolveHouseBlobUri(descriptor);

    expect(
      (FileSystem as jest.Mocked<typeof FileSystem>).writeAsStringAsync.mock.calls.length,
    ).toBe(before);
  });

  it('re-fetches transparently after the OS evicts the cache directory', async () => {
    const bytes = pattern(500, 4);
    const descriptor = await uploadFixture(bytes);
    dropCache(descriptor.blobId);

    const uri = await resolveHouseBlobUri(descriptor);
    expect(Array.from(fs.get(normalize(uri))!.bytes)).toEqual(Array.from(bytes));
  });

  it('surfaces a corrupt blob instead of rendering it', async () => {
    const descriptor = await uploadFixture(pattern(300));
    dropCache(descriptor.blobId);

    const tampered = { ...descriptor, sha256: 'deadbeef'.repeat(8) };
    const error = (await resolveHouseBlobUri(tampered).catch((e) => e)) as HouseBlobCorruptError;
    expect(error).toBeInstanceOf(HouseBlobCorruptError);
    expect(error.expected).toBe(tampered.sha256);
  });

  it('opens a PRE-ROTATION blob using the retired key (H6 §8.2)', async () => {
    const bytes = pattern(400, 6);
    const descriptor = await uploadFixture(bytes);
    dropCache(descriptor.blobId);

    // A device revoke rotates to a brand-new HDK. Before the keyring, this blob
    // was permanently unreadable — the defect that made every revoke destroy
    // member content.
    mockRetiredKeys.set(1, new Uint8Array(32).fill(3));
    mockKeyEpoch = 2;

    const uri = await resolveHouseBlobUri(descriptor);
    expect(Array.from(fs.get(normalize(uri))!.bytes)).toEqual(Array.from(bytes));
  });

  it('names the epoch a device never held, rather than failing with a raw AEAD error', async () => {
    const descriptor = await uploadFixture(pattern(400, 6));
    dropCache(descriptor.blobId);

    // Rotated, and this device has NO retired key for epoch 1 — it enrolled
    // after the rotation. Genuinely unreadable here (a longer-lived peer can
    // still open it), so it must surface as a named state.
    mockKeyEpoch = 2;

    const error = (await resolveHouseBlobUri(descriptor).catch((e) => e)) as
      HouseBlobKeyUnavailableError;
    expect(error).toBeInstanceOf(HouseBlobKeyUnavailableError);
    expect({ sealed: error.sealedEpoch, current: error.currentEpoch }).toEqual({
      sealed: 1,
      current: 2,
    });
  });

  it('still reads normally while the epoch is unchanged', async () => {
    const bytes = pattern(400, 7);
    const descriptor = await uploadFixture(bytes);
    dropCache(descriptor.blobId);

    const uri = await resolveHouseBlobUri(descriptor);
    expect(Array.from(fs.get(normalize(uri))!.bytes)).toEqual(Array.from(bytes));
  });

  it('serves a pre-rotation blob from cache — a cached read needs no key', async () => {
    const bytes = pattern(400, 8);
    const descriptor = await uploadFixture(bytes);
    mockKeyEpoch = 2;

    // The authoring device seeded its own cache at upload time, so the member
    // who attached the file keeps seeing it after a revoke.
    const uri = await resolveHouseBlobUri(descriptor);
    expect(Array.from(fs.get(normalize(uri))!.bytes)).toEqual(Array.from(bytes));
  });

  it('refuses a chunk the relay swapped in from another blob', async () => {
    const first = await uploadFixture(pattern(300, 1));
    const second = await uploadFixture(pattern(300, 2));
    dropCache(first.blobId);

    mockRelay.chunks.set(`${first.blobId}/0`, mockRelay.chunks.get(`${second.blobId}/0`)!);
    await expect(resolveHouseBlobUri(first)).rejects.toThrow();
  });
});

describe('deleteHouseBlob', () => {
  it('tombstones remotely and drops every local copy', async () => {
    seedSource(pattern(300));
    const descriptor = await uploadHouseBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });

    await deleteHouseBlob(descriptor.blobId);

    expect(mockRelay.deleted).toEqual([descriptor.blobId]);
    await expect(isHouseBlobCached(descriptor.blobId)).resolves.toBe(false);
    expect(Array.from(fs.keys()).filter((k) => k.includes(descriptor.blobId))).toEqual([]);
  });
});

describe('evictHouseBlobCache', () => {
  it('does nothing while under budget', async () => {
    put('file:///cache/lf-blobs/a', pattern(100));
    expect(await evictHouseBlobCache(1_000)).toBe(0);
  });

  it('evicts oldest-first until the budget is met', async () => {
    put('file:///cache/lf-blobs/oldest', pattern(100));
    put('file:///cache/lf-blobs/middle', pattern(100));
    put('file:///cache/lf-blobs/newest', pattern(100));

    expect(await evictHouseBlobCache(150)).toBe(2);
    expect(fs.has('file:///cache/lf-blobs/newest')).toBe(true);
    expect(fs.has('file:///cache/lf-blobs/oldest')).toBe(false);
    expect(fs.has('file:///cache/lf-blobs/middle')).toBe(false);
  });

  it('is a no-op when the cache directory does not exist yet', async () => {
    expect(await evictHouseBlobCache(10)).toBe(0);
  });
});

describe('size bound', () => {
  it('refuses a source file past the in-memory ceiling instead of OOMing the app', async () => {
    // The file is never materialised — only its reported size matters, and the
    // guard has to fire before any chunk is read.
    put(SOURCE, new Uint8Array(0));
    fs.set(normalize(SOURCE), {
      bytes: new Uint8Array(0),
      mtime: 1,
      isDirectory: false,
    });
    const mocked = FileSystem as jest.Mocked<typeof FileSystem>;
    mocked.getInfoAsync.mockImplementation(async (uri: string) => {
      if (normalize(uri) === normalize(SOURCE)) {
        return {
          exists: true,
          uri,
          isDirectory: false,
          size: BLOB_MAX_PLAINTEXT_BYTES + 1,
          modificationTime: 1,
        } as never;
      }
      const entry = fs.get(normalize(uri));
      if (!entry) return { exists: false, uri, isDirectory: false } as never;
      return {
        exists: true,
        uri,
        isDirectory: entry.isDirectory,
        size: entry.bytes.length,
        modificationTime: entry.mtime,
      } as never;
    });

    const error = (await uploadHouseBlob({ sourceUri: SOURCE, mime: 'application/pdf' }).catch(
      (e) => e,
    )) as HouseBlobTooLargeError;
    expect(error).toBeInstanceOf(HouseBlobTooLargeError);
    expect(mockRelay.puts).toHaveLength(0);
  });
});

describe('local state', () => {
  it('keeps a picked file alive before its upload finishes', async () => {
    const bytes = pattern(120, 2);
    put('file:///doc/picked/offline.jpg', bytes);
    const blobId = newBlobId();

    const staged = await stageHouseBlobOrigin('file:///doc/picked/offline.jpg', blobId);
    expect(Array.from(fs.get(normalize(staged))!.bytes)).toEqual(Array.from(bytes));
  });

  it('wipes every local copy on logout — cache, staging and originals', async () => {
    seedSource(pattern(BLOB_PLAINTEXT_CHUNK + 5));
    const blobId = newBlobId();
    // Crash mid-upload so staged envelopes and an origin copy both exist.
    mockRelay.failAfterChunk = 1;
    await expect(
      uploadHouseBlob({ sourceUri: SOURCE, mime: 'application/pdf', blobId }),
    ).rejects.toThrow();
    mockRelay.failAfterChunk = null;
    await stageHouseBlobOrigin(SOURCE, blobId);
    expect(Array.from(fs.keys()).some((k) => k.includes('lf-blob-staging'))).toBe(true);

    await clearHouseBlobLocalState();

    // Nothing decrypted, staged or picked may survive a sign-out: the ledger is
    // wiped with the session, and plaintext attachments outliving it would be a
    // hole in exactly the guarantee the channel exists to provide.
    const leftovers = Array.from(fs.keys()).filter(
      (k) => k.includes('lf-blob') || k.includes('lf-blobs'),
    );
    expect(leftovers).toEqual([]);
  });

  it('resolves a stable cache path per blob', () => {
    expect(cachedBlobUri('blob_x')).toBe('file:///cache/lf-blobs/blob_x');
    expect(cachedBlobUri('blob_x')).toBe(cachedBlobUri('blob_x'));
    expect(cachedBlobUri('blob_y')).not.toBe(cachedBlobUri('blob_x'));
  });
});

describe('household quota + availability surfaces', () => {
  it('reports the quota rollup Settings renders', async () => {
    const transport = jest.requireMock('../blobs/blobTransport') as {
      fetchBlobUsage: jest.Mock;
    };
    transport.fetchBlobUsage.mockResolvedValueOnce({
      blobCount: 3,
      cipherBytes: 2_500_000_000,
      softLimitBytes: 2_147_483_648,
      hardLimitBytes: 5_368_709_120,
      overSoftLimit: true,
    });

    await expect(getHouseBlobUsage()).resolves.toMatchObject({ overSoftLimit: true });
    expect(transport.fetchBlobUsage).toHaveBeenCalledWith('hh_blob');
  });

  it('reports a blob as unavailable while it is still uploading', async () => {
    const transport = jest.requireMock('../blobs/blobTransport') as {
      fetchBlobManifest: jest.Mock;
    };
    transport.fetchBlobManifest.mockResolvedValueOnce({
      blobId: 'b1',
      keyEpoch: 1,
      chunkCount: 2,
      cipherBytes: 0,
      status: 'pending',
    });
    await expect(houseBlobIsAvailable('b1')).resolves.toBe(false);
  });

  it('reports a finalized blob as available', async () => {
    await expect(houseBlobIsAvailable('b1')).resolves.toBe(true);
  });
});

describe('multi-property scoping (H5 interaction)', () => {
  it('derives per-household keys, so the same blob id in two properties does not cross over', async () => {
    seedSource(pattern(300, 3));
    const descriptor = await uploadHouseBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });
    dropCache(descriptor.blobId);

    // Same descriptor, different property: the content key derivation includes
    // the household id, so this must not decrypt.
    await expect(
      resolveHouseBlobUri(descriptor, { householdId: 'hh_other' }),
    ).rejects.toThrow();
  });
});
