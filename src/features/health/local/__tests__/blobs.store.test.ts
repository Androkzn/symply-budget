/**
 * He6 attachment channel — device side (plan §8).
 *
 * What only this layer can prove:
 *
 *  - **No plaintext byte reaches the network.** The whole stage exists for that
 *    sentence on a health surface, and it is not checkable from the crypto tests
 *    (which never call the transport) or the transport tests (which never see a
 *    plaintext). Here every byte handed to the relay is captured and searched
 *    for the source bytes.
 *  - **Content addressing is stable end to end.** The same file uploaded twice
 *    resolves to one object rather than an orphaned twin — the property that
 *    makes a crashed upload resumable at all, since Health mints no random id.
 *  - **A resume never re-seals.** Re-sealing mints a second nonce under the same
 *    (contentKey, chunkIndex), which leaks the XOR of the plaintexts. The staged
 *    envelopes are captured across a simulated crash and their nonces compared
 *    byte for byte.
 *  - **A missing blob degrades to a state, not an exception.** Home fires a
 *    17-way `Promise.all` on every focus (plan §4); one rejected attachment read
 *    inside that blanks the dashboard.
 *
 * `expo-file-system/legacy` is backed by a real in-memory filesystem rather than
 * a bag of `jest.fn()`s. A stateless mock would let a resume path that silently
 * re-seals pass every assertion in this file.
 *
 * Static imports throughout (`await import()` throws under this Jest config).
 */
import * as FileSystem from 'expo-file-system/legacy';

import { bytesToBase64, bytesToHex } from '@symply/local-first';

import {
  HEALTH_BLOB_MAX_PLAINTEXT_BYTES,
  HEALTH_BLOB_PLAINTEXT_CHUNK,
  healthBlobPlaintextHash,
} from '../blobs/blobCrypto';
import {
  HealthBlobIncompleteError,
  HealthBlobMissingError,
} from '../blobs/blobTransport';
import {
  HEALTH_BLOB_CACHE_BUDGET_BYTES,
  HealthBlobCorruptError,
  HealthBlobKeyUnavailableError,
  HealthBlobTooLargeError,
  cachedHealthBlobUri,
  clearHealthBlobLocalState,
  collectHealthBlobRefs,
  deleteHealthBlob,
  evictHealthBlobCache,
  isHealthBlobCached,
  isHealthBlobDescriptor,
  reconcileHealthBlobs,
  resolveHealthBlobUri,
  stageHealthBlobOrigin,
  tryResolveHealthBlobUri,
  uploadHealthBlob,
  type HealthBlobDescriptor,
} from '../blobs/healthBlobStore';
import { HealthLocalEnrolmentPendingError } from '../errors';

// --- in-memory filesystem ---------------------------------------------------

type Entry = { bytes: Uint8Array; mtime: number; isDirectory: boolean; size?: number };

const fs = new Map<string, Entry>();
let clock = 1_000;

function normalize(uri: string): string {
  return uri.replace(/\/+$/, '');
}

/**
 * Writing a file materialises its parent directories, as a real filesystem
 * does. Without that, the "does the cache dir exist" guards read false while the
 * cache is full of files, and the eviction tests pass by never running.
 */
function put(uri: string, bytes: Uint8Array, isDirectory = false): void {
  clock += 1;
  const path = normalize(uri);
  if (!isDirectory) {
    const parts = path.split('/');
    for (let i = parts.length - 1; i > 3; i -= 1) {
      const parent = parts.slice(0, i).join('/');
      if (!fs.has(parent)) {
        fs.set(parent, { bytes: new Uint8Array(0), mtime: clock, isDirectory: true });
      }
    }
  }
  fs.set(path, { bytes, mtime: clock, isDirectory });
}

/**
 * A file whose *reported* size is declared rather than allocated, so the cache
 * budget (128 MB) can be crossed without a Jest worker holding 128 MB of zeroes.
 * Only the eviction path reads sizes; nothing reads these bytes.
 */
function putSized(uri: string, size: number): void {
  put(uri, new Uint8Array(0));
  const entry = fs.get(normalize(uri));
  if (entry) entry.size = size;
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

function base64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function installFsBehaviour(): void {
  const mocked = FileSystem as jest.Mocked<typeof FileSystem>;

  mocked.getInfoAsync.mockImplementation(async (uri: string) => {
    const entry = fs.get(normalize(uri));
    if (!entry) return { exists: false, uri, isDirectory: false } as never;
    return {
      exists: true,
      uri,
      isDirectory: entry.isDirectory,
      size: entry.size ?? entry.bytes.length,
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

// --- engine stand-in ----------------------------------------------------------

let mockKeyEpoch = 1;
let mockAwaitingEnrolment = false;
const mockLedger: Record<string, unknown> = {
  household: { id: 'hh_health', userId: 'user_1', createdAt: '2026-01-01T00:00:00.000Z' },
  weightEntries: [],
  waterEntries: [],
  nutritionEntries: [],
  healthEntries: [],
  bodyMeasurements: [],
  userHabits: [],
  habitLogs: [],
  healthGoals: [],
};

/**
 * A rotation mints a whole new random HDK — modelled by making the key material
 * depend on the epoch, not just the epoch number. A mock that kept one hdk
 * across epochs would let a broken epoch check pass.
 */
function mockHdkForEpoch(epoch: number): Uint8Array {
  return new Uint8Array(32).fill(epoch === 1 ? 5 : 99);
}

/** The engine's retired-key ring, as this suite chooses to populate it. */
const mockRetiredKeys = new Map<number, Uint8Array>();

jest.mock('../engine', () => ({
  getLocalHealthHouseholdKeys: jest.fn(() => ({
    householdId: 'hh_health',
    hdk: mockHdkForEpoch(mockKeyEpoch),
    keyEpoch: mockKeyEpoch,
  })),
  getLocalHealthRetiredHouseholdKey: jest.fn(
    (epoch: number) => mockRetiredKeys.get(epoch) ?? null,
  ),
  getLocalHealthLedger: jest.fn(() => mockLedger),
  isAwaitingHealthEnrolment: jest.fn(() => mockAwaitingEnrolment),
}));

// --- relay stand-in -----------------------------------------------------------

/**
 * Remembers exactly what was PUT, chunk by chunk. The error classes are defined
 * inside the factory so `instanceof` in the store narrows against the same
 * classes this file imports.
 */
const mockRelay = {
  chunks: new Map<string, Uint8Array>(),
  puts: [] as Array<{ blobId: string; chunkIndex: number; envelope: Uint8Array }>,
  finalized: new Map<string, { chunkCount: number; keyEpoch: number }>(),
  deleted: [] as string[],
  failAfterChunk: null as number | null,
  chunkFailure: null as null | 'missing' | 'incomplete' | 'offline',
  reset() {
    this.chunks.clear();
    this.puts = [];
    this.finalized.clear();
    this.deleted = [];
    this.failAfterChunk = null;
    this.chunkFailure = null;
  },
};

jest.mock('../blobs/blobTransport', () => {
  // Plain assignment, not a TS parameter property: the transform Babel emits
  // for `constructor(readonly blobId)` trips Jest's out-of-scope guard inside a
  // mock factory.
  class HealthBlobIncompleteErrorMock extends Error {
    readonly code = 'blob_incomplete';
    constructor(id: string) {
      super(`Attachment ${id} is still uploading`);
      this.name = 'HealthBlobIncompleteError';
    }
  }
  class HealthBlobMissingErrorMock extends Error {
    readonly code = 'blob_missing';
    constructor(id: string) {
      super(`Attachment ${id} is no longer stored`);
      this.name = 'HealthBlobMissingError';
    }
  }
  return {
    HealthBlobIncompleteError: HealthBlobIncompleteErrorMock,
    HealthBlobMissingError: HealthBlobMissingErrorMock,
    HealthBlobQuotaError: class extends Error {},
    putHealthBlobChunk: jest.fn(
      async (input: { blobId: string; chunkIndex: number; envelope: Uint8Array }) => {
        mockRelay.puts.push({
          blobId: input.blobId,
          chunkIndex: input.chunkIndex,
          envelope: Uint8Array.from(input.envelope),
        });
        if (mockRelay.failAfterChunk !== null && input.chunkIndex >= mockRelay.failAfterChunk) {
          throw new Error('network died');
        }
        mockRelay.chunks.set(`${input.blobId}/${input.chunkIndex}`, Uint8Array.from(input.envelope));
      },
    ),
    finalizeHealthBlob: jest.fn(
      async (input: { blobId: string; chunkCount: number; householdId: string }) => {
        mockRelay.finalized.set(input.blobId, {
          chunkCount: input.chunkCount,
          keyEpoch: mockKeyEpoch,
        });
        return {
          blobId: input.blobId,
          keyEpoch: mockKeyEpoch,
          chunkCount: input.chunkCount,
          cipherBytes: 0,
          status: 'complete' as const,
        };
      },
    ),
    fetchHealthBlobManifest: jest.fn(async (_hh: string, blobId: string) => {
      const row = mockRelay.finalized.get(blobId);
      if (!row) return null;
      return {
        blobId,
        keyEpoch: row.keyEpoch,
        chunkCount: row.chunkCount,
        cipherBytes: 0,
        status: 'complete' as const,
      };
    }),
    fetchHealthBlobChunk: jest.fn(async (_hh: string, blobId: string, index: number) => {
      if (mockRelay.chunkFailure === 'missing') throw new HealthBlobMissingErrorMock(blobId);
      if (mockRelay.chunkFailure === 'incomplete') throw new HealthBlobIncompleteErrorMock(blobId);
      if (mockRelay.chunkFailure === 'offline') throw new Error('Network unavailable');
      const found = mockRelay.chunks.get(`${blobId}/${index}`);
      if (!found) throw new HealthBlobMissingErrorMock(blobId);
      return found;
    }),
    deleteRemoteHealthBlob: jest.fn(async (_hh: string, blobId: string) => {
      mockRelay.deleted.push(blobId);
      mockRelay.finalized.delete(blobId);
    }),
    fetchHealthBlobUsage: jest.fn(async () => ({
      blobCount: 1,
      cipherBytes: 10,
      softLimitBytes: 100,
      hardLimitBytes: 200,
      overSoftLimit: false,
    })),
  };
});

// --- fixtures ------------------------------------------------------------------

const SOURCE = 'file:///doc/picked/photo.jpg';

function pattern(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i * 7 + seed * 13) % 256;
  return out;
}

function seedSource(bytes: Uint8Array, uri = SOURCE): void {
  put(uri, bytes);
}

function nonceOf(envelope: Uint8Array): string {
  return Array.from(envelope.subarray(0, 12)).join(',');
}

function concatPuts(): Uint8Array {
  const total = mockRelay.puts.reduce((sum, p) => sum + p.envelope.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of mockRelay.puts) {
    out.set(p.envelope, offset);
    offset += p.envelope.length;
  }
  return out;
}

function dropCache(blobId: string): void {
  fs.delete(normalize(cachedHealthBlobUri(blobId)));
}

beforeEach(() => {
  fs.clear();
  clock = 1_000;
  mockKeyEpoch = 1;
  mockRetiredKeys.clear();
  mockAwaitingEnrolment = false;
  mockRelay.reset();
  for (const key of Object.keys(mockLedger)) {
    if (Array.isArray(mockLedger[key])) mockLedger[key] = [];
  }
  jest.clearAllMocks();
  installFsBehaviour();
});

// --- upload ---------------------------------------------------------------------

describe('uploadHealthBlob', () => {
  it('returns a descriptor with no device path in it', async () => {
    const bytes = pattern(500);
    seedSource(bytes);

    const descriptor = await uploadHealthBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });

    expect(descriptor).toEqual({
      blobId: expect.stringMatching(/^blob_[0-9a-f]{32}$/),
      mime: 'image/jpeg',
      bytes: 500,
      sha256: healthBlobPlaintextHash(bytes),
      chunkCount: 1,
      keyEpoch: 1,
    });
    // The Budget wish-media defect, asserted as an absence: nothing in the row
    // that the user's other device cannot resolve.
    expect(JSON.stringify(descriptor)).not.toContain('file://');
  });

  it('splits a multi-chunk file and uploads every chunk once', async () => {
    seedSource(pattern(HEALTH_BLOB_PLAINTEXT_CHUNK * 2 + 10));

    const descriptor = await uploadHealthBlob({ sourceUri: SOURCE, mime: 'application/pdf' });

    expect(descriptor.chunkCount).toBe(3);
    expect(mockRelay.puts.map((p) => p.chunkIndex)).toEqual([0, 1, 2]);
  });

  it('finalizes only after every chunk has landed, then clears staging', async () => {
    seedSource(pattern(HEALTH_BLOB_PLAINTEXT_CHUNK + 1));
    const descriptor = await uploadHealthBlob({ sourceUri: SOURCE, mime: 'application/pdf' });

    expect(mockRelay.puts).toHaveLength(2);
    expect(mockRelay.finalized.has(descriptor.blobId)).toBe(true);
    const staged = Array.from(fs.keys()).filter((k) =>
      k.includes(`lf-health-blob-staging/${descriptor.blobId}`),
    );
    expect(staged).toEqual([]);
  });

  it('reports progress per chunk', async () => {
    seedSource(pattern(HEALTH_BLOB_PLAINTEXT_CHUNK * 2));
    const seen: number[] = [];
    await uploadHealthBlob({
      sourceUri: SOURCE,
      mime: 'application/pdf',
      onProgress: (p) => seen.push(p.percent),
    });
    expect(seen).toEqual([50, 100]);
  });

  it('seeds the cache from the authoring device, so it never re-downloads its own file', async () => {
    const bytes = pattern(300);
    seedSource(bytes);
    const descriptor = await uploadHealthBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });

    expect(await isHealthBlobCached(descriptor.blobId)).toBe(true);
    expect(fs.get(normalize(cachedHealthBlobUri(descriptor.blobId)))?.bytes).toEqual(bytes);
  });

  it('refuses a file over the plaintext ceiling before touching the relay', async () => {
    put(SOURCE, new Uint8Array(0));
    fs.set(normalize(SOURCE), {
      bytes: new Uint8Array(0),
      mtime: clock,
      isDirectory: false,
    });
    // A real 50MB fixture would dominate the suite; the size is read through
    // `getInfoAsync`, so oversizing the stat is the honest way to drive it.
    (FileSystem.getInfoAsync as jest.Mock).mockImplementationOnce(async (uri: string) => ({
      exists: true,
      uri,
      isDirectory: false,
      size: HEALTH_BLOB_MAX_PLAINTEXT_BYTES + 1,
      modificationTime: clock,
    }));

    await expect(uploadHealthBlob({ sourceUri: SOURCE, mime: 'image/jpeg' })).rejects.toBeInstanceOf(
      HealthBlobTooLargeError,
    );
    expect(mockRelay.puts).toHaveLength(0);
  });

  it('refuses to author while device enrolment is pending', async () => {
    seedSource(pattern(200));
    mockAwaitingEnrolment = true;

    await expect(uploadHealthBlob({ sourceUri: SOURCE, mime: 'image/jpeg' })).rejects.toBeInstanceOf(
      HealthLocalEnrolmentPendingError,
    );
    expect(mockRelay.puts).toHaveLength(0);
  });
});

// --- the property the whole stage exists for -------------------------------------

describe('no plaintext byte reaches the network layer', () => {
  it('sends ciphertext only, for every chunk', async () => {
    const bytes = pattern(512);
    seedSource(bytes);
    await uploadHealthBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });

    const sent = mockRelay.puts[0]!.envelope;
    expect(Array.from(sent)).not.toEqual(Array.from(bytes));
    // 12-byte nonce + 16-byte GCM tag.
    expect(sent.length).toBe(bytes.length + 28);

    // Not one 12-byte run of the source survives anywhere in the byte stream
    // that left this device.
    const wire = bytesToHex(concatPuts());
    const plain = bytesToHex(bytes);
    for (let offset = 0; offset + 24 <= plain.length; offset += 1) {
      expect(wire).not.toContain(plain.slice(offset, offset + 24));
    }
  });

  it('stages ciphertext on disk too, never a plaintext copy under the staging dir', async () => {
    const bytes = pattern(400);
    seedSource(bytes);
    mockRelay.failAfterChunk = 0;

    await expect(uploadHealthBlob({ sourceUri: SOURCE, mime: 'image/jpeg' })).rejects.toThrow(
      'network died',
    );

    const staged = Array.from(fs.entries()).filter(([key]) =>
      key.includes('lf-health-blob-staging'),
    );
    expect(staged.length).toBeGreaterThan(0);
    for (const [, entry] of staged) {
      if (entry.isDirectory) continue;
      expect(Array.from(entry.bytes)).not.toEqual(Array.from(bytes));
    }
  });
});

// --- content addressing + resume ---------------------------------------------------

describe('content addressing', () => {
  it('gives the same file the same id, and dedups the second upload', async () => {
    const bytes = pattern(700);
    seedSource(bytes);
    const first = await uploadHealthBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });

    const putsAfterFirst = mockRelay.puts.length;
    seedSource(bytes, 'file:///doc/picked/again.jpg');
    const second = await uploadHealthBlob({
      sourceUri: 'file:///doc/picked/again.jpg',
      mime: 'image/jpeg',
    });

    expect(second.blobId).toBe(first.blobId);
    // The relay already holds it complete, so nothing is re-uploaded.
    expect(mockRelay.puts).toHaveLength(putsAfterFirst);
  });

  it('gives different bytes a different id', async () => {
    seedSource(pattern(700, 1));
    const first = await uploadHealthBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });
    seedSource(pattern(700, 2));
    const second = await uploadHealthBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });
    expect(second.blobId).not.toBe(first.blobId);
  });

  it('resumes an interrupted upload without minting a second nonce', async () => {
    seedSource(pattern(HEALTH_BLOB_PLAINTEXT_CHUNK * 2 + 5));

    mockRelay.failAfterChunk = 1;
    await expect(
      uploadHealthBlob({ sourceUri: SOURCE, mime: 'application/pdf' }),
    ).rejects.toThrow('network died');
    const beforeCrash = mockRelay.puts.map((p) => ({ index: p.chunkIndex, nonce: nonceOf(p.envelope) }));
    expect(beforeCrash.map((p) => p.index)).toEqual([0, 1]);

    mockRelay.failAfterChunk = null;
    mockRelay.puts = [];
    const descriptor = await uploadHealthBlob({ sourceUri: SOURCE, mime: 'application/pdf' });

    expect(descriptor.chunkCount).toBe(3);
    const afterResume = mockRelay.puts.map((p) => ({
      index: p.chunkIndex,
      nonce: nonceOf(p.envelope),
    }));
    expect(afterResume.map((p) => p.index)).toEqual([0, 1, 2]);
    // The staged envelopes are re-sent byte for byte. A re-seal here would be a
    // GCM nonce reuse under the same (contentKey, chunkIndex).
    expect(afterResume[0]!.nonce).toBe(beforeCrash[0]!.nonce);
    expect(afterResume[1]!.nonce).toBe(beforeCrash[1]!.nonce);
  });
});

// --- download ------------------------------------------------------------------

describe('resolveHealthBlobUri', () => {
  async function uploadThenForget(bytes: Uint8Array): Promise<HealthBlobDescriptor> {
    seedSource(bytes);
    const descriptor = await uploadHealthBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });
    dropCache(descriptor.blobId);
    return descriptor;
  }

  it('fetches, decrypts and caches on first view', async () => {
    const bytes = pattern(HEALTH_BLOB_PLAINTEXT_CHUNK + 33);
    const descriptor = await uploadThenForget(bytes);

    const uri = await resolveHealthBlobUri(descriptor);

    expect(uri).toBe(cachedHealthBlobUri(descriptor.blobId));
    expect(fs.get(normalize(uri))?.bytes).toEqual(bytes);
  });

  it('serves a cached blob without touching the relay', async () => {
    const bytes = pattern(256);
    seedSource(bytes);
    const descriptor = await uploadHealthBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });
    mockRelay.chunks.clear();

    await expect(resolveHealthBlobUri(descriptor)).resolves.toBe(
      cachedHealthBlobUri(descriptor.blobId),
    );
  });

  it('rejects a file that is authentic chunk by chunk but not the row it describes', async () => {
    const descriptor = await uploadThenForget(pattern(600));
    const lying = { ...descriptor, sha256: 'f'.repeat(64) };

    await expect(resolveHealthBlobUri(lying)).rejects.toBeInstanceOf(HealthBlobCorruptError);
  });

  it('refuses an epoch this device does not hold, before fetching a byte', async () => {
    const descriptor = await uploadThenForget(pattern(600));
    mockKeyEpoch = 2;

    await expect(resolveHealthBlobUri(descriptor)).rejects.toBeInstanceOf(
      HealthBlobKeyUnavailableError,
    );
  });

  it('opens a blob sealed at epoch 1 after this device rotated to epoch 2', async () => {
    // The defect this closes: before the engine kept a retired-key ring, every
    // rotation made every attachment uploaded before it permanently unopenable
    // — body photos and clinical documents, silently gone.
    const bytes = pattern(900);
    const descriptor = await uploadThenForget(bytes);

    mockKeyEpoch = 2;
    mockRetiredKeys.set(1, mockHdkForEpoch(1));

    const uri = await resolveHealthBlobUri(descriptor);

    expect(uri).toBe(cachedHealthBlobUri(descriptor.blobId));
    expect(fs.get(normalize(uri))?.bytes).toEqual(bytes);
  });

  it('still refuses when the epoch has aged out of the bounded ring', async () => {
    // The ring is capped, so a blob older than the cap is genuinely unopenable
    // here even though the ring exists. That must stay a named refusal, not a
    // bare AEAD failure three chunks into a download.
    const descriptor = await uploadThenForget(pattern(600));

    mockKeyEpoch = 3;
    mockRetiredKeys.set(2, mockHdkForEpoch(2));

    await expect(resolveHealthBlobUri(descriptor)).rejects.toMatchObject({
      code: 'blob_key_unavailable',
      sealedEpoch: 1,
      currentEpoch: 3,
    });
  });

  it('never opens a retired-epoch blob with the CURRENT key', async () => {
    // Deriving with the live HDK under the old epoch's info string would
    // produce a wrong key rather than an error, so the ring holding the WRONG
    // bytes for that epoch must fail authentication rather than pass.
    const descriptor = await uploadThenForget(pattern(600));

    mockKeyEpoch = 2;
    mockRetiredKeys.set(1, mockHdkForEpoch(2));

    await expect(resolveHealthBlobUri(descriptor)).rejects.not.toBeInstanceOf(
      HealthBlobKeyUnavailableError,
    );
  });
});

describe('tryResolveHealthBlobUri — degrades, never throws into a screen', () => {
  async function descriptorFor(bytes: Uint8Array): Promise<HealthBlobDescriptor> {
    seedSource(bytes);
    const descriptor = await uploadHealthBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });
    dropCache(descriptor.blobId);
    return descriptor;
  }

  it('reports a ready blob', async () => {
    const descriptor = await descriptorFor(pattern(300));
    await expect(tryResolveHealthBlobUri(descriptor)).resolves.toEqual({
      state: 'ready',
      uri: cachedHealthBlobUri(descriptor.blobId),
      reason: null,
    });
  });

  const cases: Array<[string, 'missing' | 'incomplete' | 'offline', string]> = [
    ['a purged or never-uploaded blob', 'missing', 'missing'],
    ['a blob the other device is still uploading', 'incomplete', 'uploading'],
    ['a transport failure', 'offline', 'unavailable'],
  ];

  it.each(cases)('answers a state for %s', async (_label, failure, reason) => {
    const descriptor = await descriptorFor(pattern(300));
    mockRelay.chunkFailure = failure;

    await expect(tryResolveHealthBlobUri(descriptor)).resolves.toEqual({
      state: 'unavailable',
      uri: null,
      reason,
    });
  });

  it('answers a state for an unopenable key epoch and for a corrupt file', async () => {
    const descriptor = await descriptorFor(pattern(300));

    await expect(tryResolveHealthBlobUri({ ...descriptor, sha256: '0'.repeat(64) })).resolves
      .toMatchObject({ state: 'unavailable', reason: 'corrupt' });

    mockKeyEpoch = 2;
    await expect(tryResolveHealthBlobUri(descriptor)).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'key_unavailable',
    });
  });

  it('is a mapping over typed transport errors, not a blanket catch', async () => {
    const descriptor = await descriptorFor(pattern(300));

    mockRelay.chunkFailure = 'missing';
    await expect(resolveHealthBlobUri(descriptor)).rejects.toBeInstanceOf(HealthBlobMissingError);
    mockRelay.chunkFailure = 'incomplete';
    await expect(resolveHealthBlobUri(descriptor)).rejects.toBeInstanceOf(
      HealthBlobIncompleteError,
    );
  });

  it('never rejects, whatever the relay does', async () => {
    const descriptor = await descriptorFor(pattern(300));
    const transport = jest.requireMock('../blobs/blobTransport') as {
      fetchHealthBlobChunk: jest.Mock;
    };
    transport.fetchHealthBlobChunk.mockRejectedValueOnce(new Error('boom'));

    await expect(tryResolveHealthBlobUri(descriptor)).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'unavailable',
    });
  });
});

// --- cache -----------------------------------------------------------------------

describe('evictHealthBlobCache', () => {
  function seedCached(name: string, size: number): void {
    put(`file:///cache/lf-health-blobs/${name}`, new Uint8Array(size));
  }

  it('does nothing while the cache is inside budget', async () => {
    seedCached('blob_a', 100);
    seedCached('blob_b', 100);
    await expect(evictHealthBlobCache(1_000)).resolves.toBe(0);
    expect(fs.has(normalize('file:///cache/lf-health-blobs/blob_a'))).toBe(true);
  });

  it('evicts oldest-first until the cache fits', async () => {
    seedCached('blob_old', 400);
    seedCached('blob_mid', 400);
    seedCached('blob_new', 400);

    const evicted = await evictHealthBlobCache(900);

    expect(evicted).toBe(1);
    expect(fs.has(normalize('file:///cache/lf-health-blobs/blob_old'))).toBe(false);
    expect(fs.has(normalize('file:///cache/lf-health-blobs/blob_mid'))).toBe(true);
    expect(fs.has(normalize('file:///cache/lf-health-blobs/blob_new'))).toBe(true);
  });

  it('is a no-op when nothing has ever been cached', async () => {
    await expect(evictHealthBlobCache(0)).resolves.toBe(0);
  });

  it('runs after a write, so a full cache cannot stay over budget', async () => {
    // Reported size only — see `putSized`. Crossing the real 128 MB budget by
    // allocation would cost the worker 128 MB per run.
    putSized('file:///cache/lf-health-blobs/blob_ancient', HEALTH_BLOB_CACHE_BUDGET_BYTES);
    seedSource(pattern(400));

    await uploadHealthBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });

    expect(fs.has(normalize('file:///cache/lf-health-blobs/blob_ancient'))).toBe(false);
  });
});

describe('teardown', () => {
  it('leaves no decrypted byte behind', async () => {
    seedSource(pattern(500));
    const descriptor = await uploadHealthBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });
    await stageHealthBlobOrigin(SOURCE, 'blob_pending');

    await clearHealthBlobLocalState();

    expect(await isHealthBlobCached(descriptor.blobId)).toBe(false);
    const survivors = Array.from(fs.keys()).filter(
      (key) => key.includes('lf-health-blob') || key.includes('lf-health-blobs'),
    );
    expect(survivors).toEqual([]);
  });

  it('tombstones the relay copy and drops every local copy on delete', async () => {
    seedSource(pattern(500));
    const descriptor = await uploadHealthBlob({ sourceUri: SOURCE, mime: 'image/jpeg' });

    await deleteHealthBlob(descriptor.blobId);

    expect(mockRelay.deleted).toEqual([descriptor.blobId]);
    expect(await isHealthBlobCached(descriptor.blobId)).toBe(false);
  });
});

// --- reconciliation with the ledger ------------------------------------------------

describe('collectHealthBlobRefs', () => {
  const descriptor: HealthBlobDescriptor = {
    blobId: 'blob_deadbeefdeadbeefdeadbeefdeadbeef',
    mime: 'image/jpeg',
    bytes: 10,
    sha256: 'a'.repeat(64),
    chunkCount: 1,
    keyEpoch: 1,
  };

  it('recognises a descriptor and rejects anything that only looks like one', () => {
    expect(isHealthBlobDescriptor(descriptor)).toBe(true);
    expect(isHealthBlobDescriptor({ ...descriptor, sha256: 'nope' })).toBe(false);
    expect(isHealthBlobDescriptor({ ...descriptor, blobId: 'file:///doc/photo.jpg' })).toBe(false);
    expect(isHealthBlobDescriptor(null)).toBe(false);
    expect(isHealthBlobDescriptor('blob_x')).toBe(false);
  });

  it('finds descriptors on live rows, in fields and in arrays', () => {
    mockLedger.bodyMeasurements = [
      { id: 'b1', date: '2026-01-01', unit: 'cm', photo: descriptor },
      { id: 'b2', date: '2026-01-02', unit: 'cm' },
    ];
    mockLedger.nutritionEntries = [
      {
        id: 'n1',
        date: '2026-01-01',
        attachments: [{ ...descriptor, blobId: 'blob_cafebabecafebabecafebabecafebabe' }],
      },
    ];

    const refs = collectHealthBlobRefs();

    expect(Array.from(refs.keys()).sort()).toEqual([
      'blob_cafebabecafebabecafebabecafebabe',
      'blob_deadbeefdeadbeefdeadbeefdeadbeef',
    ]);
  });

  it('skips tombstoned rows — their blobs are exactly the orphans to reclaim', () => {
    mockLedger.bodyMeasurements = [
      { id: 'b1', date: '2026-01-01', unit: 'cm', photo: descriptor, deleted_at: '2026-02-01' },
    ];
    expect(collectHealthBlobRefs().size).toBe(0);
  });

  it('finds nothing on a Wave A ledger, which is the correct answer today', () => {
    expect(collectHealthBlobRefs().size).toBe(0);
  });

  describe('the Wave D contract: a descriptor must be a real field', () => {
    /** What a descriptor looks like once it has been folded into `data`. */
    const encoded = JSON.stringify({ photo: descriptor });

    it('does NOT see a descriptor encoded inside a string, and says so out loud', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockLedger.healthEntries = [
        { id: 'h1', date: '2026-01-01', entry_type: 'workout', data: encoded },
      ];

      // Invisible — which is exactly the hazard, since the reconciler would
      // then sweep those bytes as an orphan.
      expect(collectHealthBlobRefs().size).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('healthEntries.data'),
      );
      warn.mockRestore();
    });

    it('stays quiet on ordinary string fields — it is a tripwire, not a scanner', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockLedger.healthEntries = [
        { id: 'h1', date: '2026-01-01', entry_type: 'workout', data: '{"steps":8123}' },
      ];

      collectHealthBlobRefs();

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('does not parse strings, however many rows there are', () => {
      // The guard samples a fixed number of rows and never JSON.parses one. A
      // reconciler that parsed every `data` string of a ten-year corpus is the
      // unbounded read plan §4's thresholds forbid.
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const parse = jest.spyOn(JSON, 'parse');
      mockLedger.healthEntries = Array.from({ length: 500 }, (_unused, index) => ({
        id: `h${index}`,
        date: '2026-01-01',
        entry_type: 'workout',
        data: encoded,
      }));

      collectHealthBlobRefs();

      expect(parse).not.toHaveBeenCalled();
      parse.mockRestore();
      warn.mockRestore();
    });
  });
});

describe('reconcileHealthBlobs', () => {
  const referencedDescriptor: HealthBlobDescriptor = {
    blobId: 'blob_11111111111111111111111111111111',
    mime: 'image/jpeg',
    bytes: 10,
    sha256: 'b'.repeat(64),
    chunkCount: 1,
    keyEpoch: 1,
  };

  beforeEach(() => {
    put(`file:///cache/lf-health-blobs/${referencedDescriptor.blobId}`, new Uint8Array(10));
    put('file:///cache/lf-health-blobs/blob_orphan', new Uint8Array(10));
    put('file:///doc/lf-health-blob-origin/blob_orphan', new Uint8Array(10));
    mockLedger.bodyMeasurements = [
      { id: 'b1', date: '2026-01-01', unit: 'cm', photo: referencedDescriptor },
    ];
  });

  it('drops local copies of blobs no live row points at, and keeps the rest', async () => {
    const result = await reconcileHealthBlobs();

    expect(result.referenced).toEqual([referencedDescriptor.blobId]);
    expect(result.cacheEvicted).toEqual(['blob_orphan']);
    expect(result.stagingCleared).toEqual(['blob_orphan']);
    expect(await isHealthBlobCached(referencedDescriptor.blobId)).toBe(true);
    expect(await isHealthBlobCached('blob_orphan')).toBe(false);
  });

  it('does not tombstone on the relay unless asked — a stale ledger would delete live bytes', async () => {
    await reconcileHealthBlobs();
    expect(mockRelay.deleted).toEqual([]);

    put('file:///cache/lf-health-blobs/blob_orphan', new Uint8Array(10));
    const released = await reconcileHealthBlobs({ releaseRemote: true });
    expect(released.tombstoned).toEqual(['blob_orphan']);
    expect(mockRelay.deleted).toEqual(['blob_orphan']);
  });

  it('reports referenced blobs whose bytes are not on this device yet', async () => {
    fs.delete(normalize(cachedHealthBlobUri(referencedDescriptor.blobId)));

    const result = await reconcileHealthBlobs();

    expect(result.notCached).toEqual([referencedDescriptor.blobId]);
  });

  it('accepts an explicit reference set, for a caller that knows better than the scan', async () => {
    const result = await reconcileHealthBlobs({ referenced: ['blob_orphan'] });

    expect(result.cacheEvicted).toEqual([referencedDescriptor.blobId]);
    expect(await isHealthBlobCached('blob_orphan')).toBe(true);
  });
});
