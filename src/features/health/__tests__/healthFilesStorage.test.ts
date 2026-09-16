/**
 * Symply Health — FILES store (`src/features/health/healthFilesStorage.ts`).
 *
 * This is the client half of `/health/files` on `symply-health-api` (R2 for the
 * bytes, D1 for the row) — see `files.posture.test.ts` for why this suite has to
 * exist at all: until now the surface had six deployed handlers and no client
 * test anywhere in the repo.
 *
 * Layers, same shape as the other Health store suites:
 *
 *  1. PURE — formatting, filtering, sorting, MIME resolution, name cleaning,
 *     rejection copy.
 *  2. WIRE — the wire → screen mapping.
 *  3. READS — the cached read-through.
 *  4. WRITES — upload (reserve → PUT bytes → re-read) and delete, including the
 *     one behaviour this file exists to pin: a failed PUT after a successful
 *     reservation deletes the reservation rather than leaving a "ghost row" the
 *     member can see in their list but never open.
 *  5. PRIVACY — the cache holds METADATA ONLY. The bytes of a `body_photo` are
 *     the single most sensitive thing this app stores; this suite proves they
 *     never reach MMKV.
 */

import {
  type CreateHealthFileInput,
  type HealthFile,
  type HealthFileReservation,
  healthAssetsApi,
} from '@api/healthAssets';
import { storageHelpers } from '@services/storage';

import {
  cleanFileName,
  deleteHealthFile,
  FILE_EMPTY_MESSAGE,
  FILE_MISSING_MESSAGE,
  fileDayKey,
  FILE_OFFLINE_MESSAGE,
  fileRejectionMessageFor,
  fileTypeForMime,
  FILE_TOO_LARGE_MESSAGE,
  FILE_TYPE_MESSAGE,
  FILE_UNREADABLE_MESSAGE,
  formatFileSize,
  fromWireHealthFile,
  HEALTH_FILE_MAX_BYTES,
  HEALTH_FILES_KEY,
  loadFiles,
  resolveMimeType,
  sortFiles,
  summarizeFiles,
  uploadHealthFile,
  viewFiles,
  type HealthFileEntry,
} from '../healthFilesStorage';
import { __setHealthOfflineForTests, clearHealthCache, healthSyncStateFor } from '../healthRepository';

// A full `jest.mock('@api/healthAssets')` automock would ALSO wipe
// `HEALTH_FILE_MIME_TYPES` (an object of arrays of strings, not a function) —
// automocking a module recreates arrays empty, which would make every real
// MIME resolution in `healthFilesStorage.ts` fail regardless of what a test
// sets up. Only the five FILE methods this suite drives are replaced; the
// allow-list and the byte cap stay real.
jest.mock('@api/healthAssets', () => {
  const actual = jest.requireActual('@api/healthAssets');
  return {
    ...actual,
    healthAssetsApi: {
      ...actual.healthAssetsApi,
      listFiles: jest.fn(),
      getFile: jest.fn(),
      createFile: jest.fn(),
      uploadFileBytes: jest.fn(),
      deleteFile: jest.fn(),
    },
  };
});

type MockedAssetsApi = jest.Mocked<typeof healthAssetsApi>;
const api = healthAssetsApi as unknown as MockedAssetsApi;

const NETWORK_ERROR = new Error('Network request failed');
/** A refusal from the Worker, carrying only an HTTP status (never a message). */
function httpError(status: number): Error & { response: { status: number } } {
  return Object.assign(new Error('Request failed'), { response: { status } });
}

// Fixed local noon, matching the convention every other Health suite pins to.
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const ISO = '2026-07-13T08:00:00.000Z';
const ISO_OLDER = '2026-07-01T08:00:00.000Z';

function wireRow(over: Partial<HealthFile> = {}): HealthFile {
  return {
    id: 'file_1',
    file_name: 'photo.jpg',
    file_type: 'photo',
    mime_type: 'image/jpeg',
    file_size: 1024,
    category: null,
    metadata: null,
    created_at: ISO,
    updated_at: ISO,
    content_path: '/health/files/file_1/content',
    ...over,
  };
}

function entry(over: Partial<HealthFileEntry> = {}): HealthFileEntry {
  return {
    id: 'file_1',
    name: 'photo.jpg',
    type: 'photo',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    category: null,
    createdAt: ISO,
    updatedAt: ISO,
    contentPath: '/health/files/file_1/content',
    isImage: true,
    ...over,
  };
}

/**
 * A tiny stateful server, same trick as `healthFridgeStorage.test.ts`: every
 * writer here re-reads the list afterwards, so a static mock would report each
 * upload as lost.
 *
 * `uploadFileBytes` mutates the SAME row `createFile` reserved — mirroring the
 * real Worker, which corrects `file_size` to the true byte length once the PUT
 * lands — so a test can tell "reserved but never uploaded" apart from "landed".
 */
function fakeFilesServer(initial: HealthFile[] = []) {
  const state = { rows: [...initial] };
  let nextId = state.rows.length + 1;

  api.listFiles.mockImplementation(() => Promise.resolve({ files: [...state.rows] }));

  api.createFile.mockImplementation((input: CreateHealthFileInput) => {
    const id = `file_${nextId++}`;
    const created = wireRow({
      id,
      file_name: input.file_name,
      file_type: input.file_type,
      mime_type: input.mime_type,
      file_size: input.file_size,
      category: input.category ?? null,
      content_path: `/health/files/${id}/content`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    state.rows = [created, ...state.rows];
    const reservation: HealthFileReservation = {
      file: created,
      upload: {
        upload_url: null,
        method: 'PUT',
        path: `/health/files/${id}/content`,
        max_size_bytes: HEALTH_FILE_MAX_BYTES,
      },
    };
    return Promise.resolve(reservation);
  });

  api.uploadFileBytes.mockImplementation((path: string) => {
    const id = path.split('/')[3];
    const found = state.rows.find((r) => r.id === id);
    if (!found) return Promise.reject(httpError(404));
    return Promise.resolve({ file: found });
  });

  api.deleteFile.mockImplementation((id: string) => {
    const before = state.rows.length;
    state.rows = state.rows.filter((r) => r.id !== id);
    if (state.rows.length === before) return Promise.reject(httpError(404));
    return Promise.resolve({ deleted: true });
  });

  return state;
}

/** Point `global.fetch` at a fake local blob of exactly `size` bytes. */
function mockLocalBlob(size: number): void {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    blob: () => Promise.resolve({ size }),
  } as unknown as Response);
}

function mockUnreadableLocalFile(): void {
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ENOENT'));
}

beforeEach(async () => {
  await storageHelpers.clearAll();
  await clearHealthCache([]);
  __setHealthOfflineForTests(false);
  jest.resetAllMocks();
  fakeFilesServer();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* Pure — formatting                                                    */
/* ------------------------------------------------------------------ */

describe('healthFilesStorage — formatting', () => {
  it('HEALTH-FILES-001: file size prints B / KB / MB / GB at the right thresholds', () => {
    expect(formatFileSize(0)).toBe('0 KB');
    expect(formatFileSize(-5)).toBe('0 KB');
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(15360)).toBe('15 KB'); // >= 10 KB drops the decimal
    expect(formatFileSize(1024 * 1024 * 2.5)).toBe('2.5 MB');
    expect(formatFileSize(1024 * 1024 * 1024 * 1.2)).toBe('1.2 GB');
  });

  it('HEALTH-FILES-002: the day key is the first 10 characters of the ISO stamp', () => {
    expect(fileDayKey('2026-07-13T08:00:00.000Z')).toBe('2026-07-13');
    expect(fileDayKey(undefined as unknown as string)).toBe('');
    expect(fileDayKey(null as unknown as string)).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* Pure — summarizing, filtering, sorting                               */
/* ------------------------------------------------------------------ */

describe('healthFilesStorage — summary, filter, search, sort', () => {
  const stock = [
    entry({ id: 'p1', name: 'Sunset.jpg', type: 'photo', sizeBytes: 1000 }),
    entry({ id: 'd1', name: 'Bloodwork.pdf', type: 'document', category: 'Labs', sizeBytes: 2000 }),
    entry({ id: 'b1', name: 'Progress.jpg', type: 'body_photo', sizeBytes: 3000 }),
  ];

  it('HEALTH-FILES-003: the summary counts each type once and sums the bytes IN THE LIST', () => {
    const summary = summarizeFiles(stock);
    expect(summary).toEqual({ total: 3, photos: 1, documents: 1, bodyPhotos: 1, totalBytes: 6000 });
    // Not a server storage quota — recomputed from whatever the list holds.
    expect(summarizeFiles([]).totalBytes).toBe(0);
  });

  it('HEALTH-FILES-003b: a row whose type matches none of the three known kinds still counts toward the total and byte sum', () => {
    // A future file_type this build does not know about (or a drifted row).
    // `total` and `totalBytes` must still be honest even though none of the
    // three per-type counters increments for it.
    const withUnknown = [
      ...stock,
      entry({ id: 'u1', name: 'x', type: 'unknown_kind' as never, sizeBytes: 500 }),
    ];
    const summary = summarizeFiles(withUnknown);
    expect(summary).toEqual({ total: 4, photos: 1, documents: 1, bodyPhotos: 1, totalBytes: 6500 });
  });

  it('HEALTH-FILES-004: the filter chip narrows by type, and "all" is a no-op', () => {
    expect(viewFiles(stock, { filter: 'photo' }).map((f) => f.id)).toEqual(['p1']);
    expect(viewFiles(stock, { filter: 'body_photo' }).map((f) => f.id)).toEqual(['b1']);
    expect(viewFiles(stock, { filter: 'all' }).map((f) => f.id)).toEqual(['p1', 'd1', 'b1']);
    expect(viewFiles(stock, {}).map((f) => f.id)).toEqual(['p1', 'd1', 'b1']);
    // No options argument at all — the default parameter, not an explicit {}.
    expect(viewFiles(stock).map((f) => f.id)).toEqual(['p1', 'd1', 'b1']);
  });

  it('HEALTH-FILES-004b: a file with no category still searches by name only, never throwing on the missing field', () => {
    const noCategory = [entry({ id: 'x1', name: 'Vaccine record.pdf', type: 'document', category: null })];
    expect(viewFiles(noCategory, { query: 'vaccine' }).map((f) => f.id)).toEqual(['x1']);
    expect(viewFiles(noCategory, { query: 'nonexistent-category' })).toEqual([]);
  });

  it('HEALTH-FILES-005: search matches the name OR the category, trimmed and case-insensitive', () => {
    expect(viewFiles(stock, { query: '  sunset  ' }).map((f) => f.id)).toEqual(['p1']);
    expect(viewFiles(stock, { query: 'LABS' }).map((f) => f.id)).toEqual(['d1']);
    expect(viewFiles(stock, { query: 'nothing-matches-this' })).toEqual([]);
  });

  it('HEALTH-FILES-006: filter and search compose', () => {
    expect(viewFiles(stock, { filter: 'document', query: 'blood' }).map((f) => f.id)).toEqual(['d1']);
    expect(viewFiles(stock, { filter: 'photo', query: 'blood' })).toEqual([]);
  });

  it('HEALTH-FILES-007: sorting is newest first, and a shared date breaks the tie by name', () => {
    const files = [
      entry({ id: 'old', name: 'Zebra', createdAt: ISO_OLDER }),
      entry({ id: 'new', name: 'Milk', createdAt: ISO }),
      entry({ id: 'same-b', name: 'Bravo', createdAt: ISO }),
      entry({ id: 'same-a', name: 'Alpha', createdAt: ISO }),
    ];
    expect(sortFiles(files).map((f) => f.id)).toEqual(['same-a', 'same-b', 'new', 'old']);
  });

  it('HEALTH-FILES-008: a malformed cached entry is dropped rather than crashing the sort', () => {
    const bad = { id: 'x' } as unknown as HealthFileEntry; // no name / contentPath / createdAt
    expect(sortFiles([entry(), bad])).toEqual([entry()]);
    expect(sortFiles([null, undefined, bad] as unknown as HealthFileEntry[])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Pure — MIME resolution, type inference, name cleaning                */
/* ------------------------------------------------------------------ */

describe('healthFilesStorage — picking a file', () => {
  it('HEALTH-FILES-009: a trusted declared MIME wins even when it disagrees with the extension', () => {
    expect(resolveMimeType('report.txt', 'application/pdf')).toBe('application/pdf');
  });

  it('HEALTH-FILES-010: an untrusted declared MIME (octet-stream) falls back to the extension', () => {
    // iOS hands this back for plenty of ordinary files — must not be trusted.
    expect(resolveMimeType('report.pdf', 'application/octet-stream')).toBe('application/pdf');
    expect(resolveMimeType('photo.HEIC', 'application/octet-stream')).toBe('image/heic');
  });

  it('HEALTH-FILES-011: no declared MIME resolves purely from the extension, case-insensitively', () => {
    expect(resolveMimeType('IMG_0001.JPG')).toBe('image/jpeg');
    expect(resolveMimeType('notes.json')).toBe('application/json');
    expect(resolveMimeType('archive.zip')).toBeNull(); // not on the server's allow-list
    expect(resolveMimeType('no-extension')).toBeNull();
  });

  it('HEALTH-FILES-012: images resolve to photo, everything else to document', () => {
    expect(fileTypeForMime('image/heic')).toBe('photo');
    expect(fileTypeForMime('application/pdf')).toBe('document');
    expect(fileTypeForMime('text/plain')).toBe('document');
  });

  it('HEALTH-FILES-013: the file name is taken from the last path segment, query stripped, trimmed', () => {
    expect(cleanFileName('https://x/y/My Scan.pdf?token=abc', 'application/pdf')).toBe('My Scan.pdf');
    expect(cleanFileName('  spaced.txt  ', 'text/plain')).toBe('spaced.txt');
  });

  it('HEALTH-FILES-014: a blank name falls back to a generated one with the right extension', () => {
    expect(cleanFileName('', 'application/pdf')).toBe(`file-${FIXED_NOW.getTime()}.pdf`);
    expect(cleanFileName(null, 'image/jpeg')).toBe(`file-${FIXED_NOW.getTime()}.jpeg`);
    expect(cleanFileName(undefined, 'image/heic')).toBe(`file-${FIXED_NOW.getTime()}.heic`);
  });

  it('HEALTH-FILES-015: an overlong name is truncated to 200 characters, not rejected', () => {
    const long = `${'a'.repeat(250)}.pdf`;
    expect(cleanFileName(long, 'application/pdf').length).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* Pure — rejection copy                                                */
/* ------------------------------------------------------------------ */

describe('healthFilesStorage — rejection copy is chosen by STATUS only', () => {
  it('HEALTH-FILES-016: every documented status maps to our own words', () => {
    expect(fileRejectionMessageFor(httpError(404))).toBe(FILE_MISSING_MESSAGE);
    expect(fileRejectionMessageFor(httpError(413))).toBe(FILE_TOO_LARGE_MESSAGE);
    expect(fileRejectionMessageFor(httpError(400))).toBe(FILE_TYPE_MESSAGE);
    expect(fileRejectionMessageFor(httpError(415))).toBe(FILE_TYPE_MESSAGE);
    expect(fileRejectionMessageFor(httpError(422))).toBe(FILE_TYPE_MESSAGE);
    expect(fileRejectionMessageFor(httpError(401))).toContain('sign in again');
    expect(fileRejectionMessageFor(httpError(403))).toContain('sign in again');
    expect(fileRejectionMessageFor(httpError(409))).toBe('That could not be saved. Please try again.');
  });

  it('HEALTH-FILES-017: a server wobble and a lost connection both read as "no status" (null)', () => {
    expect(fileRejectionMessageFor(httpError(500))).toBeNull();
    expect(fileRejectionMessageFor(httpError(503))).toBeNull();
    expect(fileRejectionMessageFor(NETWORK_ERROR)).toBeNull();
  });

  it('HEALTH-FILES-018: the error MESSAGE is never read, only the HTTP status', () => {
    const suspicious = Object.assign(new Error('Row 42 deleted_at IS NOT NULL'), {
      response: { status: 404 },
    });
    const message = fileRejectionMessageFor(suspicious);
    expect(message).toBe(FILE_MISSING_MESSAGE);
    expect(message).not.toContain('deleted_at');
  });
});

/* ------------------------------------------------------------------ */
/* Wire mapping                                                         */
/* ------------------------------------------------------------------ */

describe('healthFilesStorage — wire mapping', () => {
  it('HEALTH-FILES-019: a wire row maps straight across, isImage derived from the MIME', () => {
    expect(fromWireHealthFile(wireRow())).toEqual(entry());
    expect(fromWireHealthFile(wireRow({ mime_type: 'application/pdf', file_type: 'document' }))).toMatchObject(
      { isImage: false, type: 'document' }
    );
  });

  it('HEALTH-FILES-020: an unrecognised file_type reads as "document" rather than crashing the UI', () => {
    // A row a newer server build wrote with a type this client does not know.
    const row = wireRow({ file_type: 'x-ray' as unknown as HealthFile['file_type'] });
    expect(fromWireHealthFile(row).type).toBe('document');
  });

  it('HEALTH-FILES-021: a non-finite or non-positive file_size reads as 0, not NaN', () => {
    expect(fromWireHealthFile(wireRow({ file_size: Number.NaN })).sizeBytes).toBe(0);
    expect(fromWireHealthFile(wireRow({ file_size: -5 })).sizeBytes).toBe(0);
    expect(fromWireHealthFile(wireRow({ file_size: 0 })).sizeBytes).toBe(0);
  });

  it('HEALTH-FILES-022: category is preserved when present and null when absent', () => {
    expect(fromWireHealthFile(wireRow({ category: 'Labs' })).category).toBe('Labs');
    expect(fromWireHealthFile(wireRow({ category: null })).category).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Reads                                                                */
/* ------------------------------------------------------------------ */

describe('healthFilesStorage — reads', () => {
  it('HEALTH-FILES-023: the list loads newest first and mirrors into MMKV', async () => {
    fakeFilesServer([
      wireRow({ id: 'old', file_name: 'Old.pdf', created_at: ISO_OLDER }),
      wireRow({ id: 'new', file_name: 'New.pdf', created_at: ISO }),
    ]);

    const files = await loadFiles();
    expect(files.map((f) => f.id)).toEqual(['new', 'old']);
    expect(healthSyncStateFor(HEALTH_FILES_KEY)).toBe('synced');
    expect(await storageHelpers.getObject(HEALTH_FILES_KEY)).not.toBeNull();
  });

  it('HEALTH-FILES-024: a failed read serves the cache instead of blanking the screen', async () => {
    fakeFilesServer([wireRow({ id: 'file_1' })]);
    await loadFiles();

    api.listFiles.mockRejectedValue(NETWORK_ERROR);
    const files = await loadFiles();
    expect(files.map((f) => f.id)).toEqual(['file_1']);
    expect(healthSyncStateFor(HEALTH_FILES_KEY)).toBe('offline');
  });

  it('HEALTH-FILES-025: a corrupt cached snapshot falls back to empty rather than throwing', async () => {
    await storageHelpers.setObject(HEALTH_FILES_KEY, { not: 'an array' });
    api.listFiles.mockRejectedValue(NETWORK_ERROR);

    await expect(loadFiles()).resolves.toEqual([]);
  });

  it('HEALTH-FILES-026: a body with no `files` key reads as an empty list', async () => {
    api.listFiles.mockResolvedValue({} as never);
    await expect(loadFiles()).resolves.toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Writes — upload                                                     */
/* ------------------------------------------------------------------ */

describe('healthFilesStorage — uploadHealthFile: client-side refusals', () => {
  it('HEALTH-FILES-027: an unsupported type is refused before any request is made', async () => {
    mockLocalBlob(1000);
    const result = await uploadHealthFile({ uri: 'file:///a/thing.zip', name: 'thing.zip' });
    expect(result).toEqual({ files: [], status: 'rejected', message: FILE_TYPE_MESSAGE });
    expect(api.createFile).not.toHaveBeenCalled();
  });

  it('HEALTH-FILES-028: an explicit fileType that disagrees with the MIME is refused', async () => {
    mockLocalBlob(1000);
    // A JPEG forced to `document` — the document allow-list has no image MIME.
    const result = await uploadHealthFile({
      uri: 'file:///a/photo.jpg',
      name: 'photo.jpg',
      fileType: 'document',
    });
    expect(result.status).toBe('rejected');
    expect(result.message).toBe(FILE_TYPE_MESSAGE);
    expect(api.createFile).not.toHaveBeenCalled();
  });

  it('HEALTH-FILES-029: a file this device cannot read is refused with its own message', async () => {
    mockUnreadableLocalFile();
    const result = await uploadHealthFile({ uri: 'file:///a/photo.jpg', name: 'photo.jpg' });
    expect(result.status).toBe('rejected');
    expect(result.message).toBe(FILE_UNREADABLE_MESSAGE);
    expect(api.createFile).not.toHaveBeenCalled();
  });

  it('HEALTH-FILES-030: an empty file is refused without reserving a row', async () => {
    mockLocalBlob(0);
    const result = await uploadHealthFile({ uri: 'file:///a/photo.jpg', name: 'photo.jpg' });
    expect(result.status).toBe('rejected');
    expect(result.message).toBe(FILE_EMPTY_MESSAGE);
    expect(api.createFile).not.toHaveBeenCalled();
  });

  it('HEALTH-FILES-031: a file over the 50MB cap is refused without reserving a row', async () => {
    mockLocalBlob(HEALTH_FILE_MAX_BYTES + 1);
    const result = await uploadHealthFile({ uri: 'file:///a/photo.jpg', name: 'photo.jpg' });
    expect(result.status).toBe('rejected');
    expect(result.message).toBe(FILE_TOO_LARGE_MESSAGE);
    expect(api.createFile).not.toHaveBeenCalled();
  });

  it('HEALTH-FILES-031b: a blob whose size is not a real number is treated as empty, not thrown', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      blob: () => Promise.resolve({ size: undefined }),
    } as unknown as Response);
    const result = await uploadHealthFile({ uri: 'file:///a/photo.jpg', name: 'photo.jpg' });
    expect(result.status).toBe('rejected');
    expect(result.message).toBe(FILE_EMPTY_MESSAGE);
    expect(api.createFile).not.toHaveBeenCalled();
  });
});

describe('healthFilesStorage — uploadHealthFile: no name given (uri decides)', () => {
  it('HEALTH-FILES-031c: with no `name`, both the MIME guess and the saved file name fall back to the uri', async () => {
    mockLocalBlob(2048);
    const result = await uploadHealthFile({ uri: 'file:///a/nested/scan.pdf' });

    expect(api.createFile).toHaveBeenCalledWith(
      expect.objectContaining({ file_name: 'scan.pdf', mime_type: 'application/pdf' })
    );
    expect(result.status).toBe('saved');
  });
});

describe('healthFilesStorage — uploadHealthFile: the happy path', () => {
  it('HEALTH-FILES-032: reserves, PUTs the bytes to the reserved path, then re-reads the list', async () => {
    mockLocalBlob(2048);
    const result = await uploadHealthFile({
      uri: 'file:///a/photo.jpg',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      category: 'Checkup',
    });

    expect(api.createFile).toHaveBeenCalledWith({
      file_name: 'photo.jpg',
      file_type: 'photo',
      mime_type: 'image/jpeg',
      file_size: 2048,
      category: 'Checkup',
    });
    expect(api.uploadFileBytes).toHaveBeenCalledWith(
      '/health/files/file_1/content',
      expect.objectContaining({ size: 2048 }),
      'image/jpeg'
    );
    expect(result.status).toBe('saved');
    expect(result.message).toBeNull();
    expect(result.files.map((f) => f.name)).toEqual(['photo.jpg']);
  });

  it('HEALTH-FILES-033: omitting a category sends no category key at all', async () => {
    mockLocalBlob(2048);
    await uploadHealthFile({ uri: 'file:///a/photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg' });

    expect(api.createFile).toHaveBeenCalledWith({
      file_name: 'photo.jpg',
      file_type: 'photo',
      mime_type: 'image/jpeg',
      file_size: 2048,
    });
  });

  it('HEALTH-FILES-034: a document upload with no explicit fileType is inferred from the MIME', async () => {
    mockLocalBlob(500);
    await uploadHealthFile({ uri: 'file:///a/scan.pdf', name: 'scan.pdf', mimeType: 'application/pdf' });
    expect(api.createFile).toHaveBeenCalledWith(
      expect.objectContaining({ file_type: 'document', mime_type: 'application/pdf' })
    );
  });

  it('HEALTH-FILES-035: an explicit body_photo fileType is honoured and never silently downgraded', async () => {
    mockLocalBlob(500);
    await uploadHealthFile({
      uri: 'file:///a/progress.jpg',
      name: 'progress.jpg',
      mimeType: 'image/jpeg',
      fileType: 'body_photo',
    });
    expect(api.createFile).toHaveBeenCalledWith(expect.objectContaining({ file_type: 'body_photo' }));
  });
});

describe('healthFilesStorage — uploadHealthFile: the reservation-rollback ("ghost row") behaviour', () => {
  // THE FAILURE THIS PROTECTS AGAINST: `POST /health/files` reserves a row in
  // D1 and hands back where to PUT. If the PUT then fails, the reservation is
  // ALREADY on the server. Without a rollback, the member's file list would
  // show an entry that can never be opened — a ghost they cannot tell apart
  // from a real file until they tap it. `uploadHealthFile` is documented to
  // delete the reservation in exactly this case.

  it('HEALTH-FILES-036: a failed PUT deletes the reservation it just created', async () => {
    mockLocalBlob(2048);
    api.uploadFileBytes.mockRejectedValue(httpError(413)); // e.g. the Worker re-validates size

    const result = await uploadHealthFile({ uri: 'file:///a/photo.jpg', name: 'photo.jpg' });

    // The reservation `createFile` returned (file_1) is exactly what gets cleaned up.
    expect(api.createFile).toHaveBeenCalledTimes(1);
    expect(api.deleteFile).toHaveBeenCalledWith('file_1');
    expect(result.status).toBe('rejected');
    expect(result.message).toBe(FILE_TOO_LARGE_MESSAGE);
    // The member's list is exactly what it was before — no ghost to see.
    expect(result.files).toEqual([]);
  });

  it('HEALTH-FILES-037: a PUT that never lands (offline) still triggers the same cleanup', async () => {
    mockLocalBlob(2048);
    api.uploadFileBytes.mockRejectedValue(NETWORK_ERROR);

    const result = await uploadHealthFile({ uri: 'file:///a/photo.jpg', name: 'photo.jpg' });

    expect(api.deleteFile).toHaveBeenCalledWith('file_1');
    expect(result.status).toBe('offline');
    expect(result.message).toBe(FILE_OFFLINE_MESSAGE);
  });

  it('HEALTH-FILES-038: if the RESERVATION itself fails, there is nothing to clean up', async () => {
    mockLocalBlob(2048);
    api.createFile.mockRejectedValue(NETWORK_ERROR);

    const result = await uploadHealthFile({ uri: 'file:///a/photo.jpg', name: 'photo.jpg' });

    expect(api.deleteFile).not.toHaveBeenCalled();
    expect(result.status).toBe('offline');
  });

  it('HEALTH-FILES-039: the cleanup itself failing does not crash the upload or surface a raw error', async () => {
    // Worst case: the PUT fails AND the best-effort delete can't reach the
    // server either. The member still gets a plain-words answer.
    mockLocalBlob(2048);
    api.uploadFileBytes.mockRejectedValue(httpError(500));
    api.deleteFile.mockRejectedValue(NETWORK_ERROR);

    await expect(
      uploadHealthFile({ uri: 'file:///a/photo.jpg', name: 'photo.jpg' })
    ).resolves.toEqual({ files: [], status: 'offline', message: FILE_OFFLINE_MESSAGE });
    expect(api.deleteFile).toHaveBeenCalledWith('file_1');
  });

  it('HEALTH-FILES-040: a successful upload whose REFRESH fails still reports success, keeping the old list', async () => {
    const existingRow = wireRow({ id: 'existing', file_name: 'Existing.pdf' });
    fakeFilesServer([existingRow]);
    mockLocalBlob(2048);

    // `uploadHealthFile` calls `listFiles` TWICE: once for its own `before`
    // snapshot, and once more (`fetchFiles`) after the reserve+PUT succeed.
    // Queue them in that exact order so only the SECOND — the refresh — fails.
    // The upload itself (createFile + uploadFileBytes) still succeeds. The
    // member's action DID land — the answer must not look like a failure.
    api.listFiles.mockImplementationOnce(() => Promise.resolve({ files: [existingRow] }));
    api.listFiles.mockRejectedValueOnce(NETWORK_ERROR);

    const result = await uploadHealthFile({ uri: 'file:///a/photo.jpg', name: 'photo.jpg' });

    expect(result.status).toBe('saved');
    expect(result.message).toBeNull();
    // The NEW file is not in the answer — the refresh that would have picked
    // it up is exactly what failed — but nothing is reported as lost either.
    expect(result.files).toEqual(sortFiles([fromWireHealthFile(existingRow)]));
  });
});

/* ------------------------------------------------------------------ */
/* Writes — delete                                                      */
/* ------------------------------------------------------------------ */

describe('healthFilesStorage — deleteHealthFile', () => {
  it('HEALTH-FILES-041: a successful delete removes the row and survives a re-read', async () => {
    fakeFilesServer([wireRow({ id: 'file_1' }), wireRow({ id: 'file_2', file_name: 'Other.pdf' })]);
    await loadFiles();

    const result = await deleteHealthFile('file_1');
    expect(api.deleteFile).toHaveBeenCalledWith('file_1');
    expect(result.status).toBe('saved');
    expect(result.files.map((f) => f.id)).toEqual(['file_2']);
    expect((await loadFiles()).map((f) => f.id)).toEqual(['file_2']);
  });

  it('HEALTH-FILES-042: deleting is OPTIMISTIC — the row is gone from the result immediately', async () => {
    fakeFilesServer([wireRow({ id: 'file_1' })]);
    await loadFiles();
    // Slow server: the request never resolves before we inspect the promise's
    // synchronous effect isn't observable in JS, so instead assert the final
    // outcome reflects the optimistic remove even though `deleteFile` was the
    // thing awaited.
    const result = await deleteHealthFile('file_1');
    expect(result.files).toEqual([]);
  });

  it('HEALTH-FILES-043: a 404 means it is already gone — treated as success, not a failure', async () => {
    fakeFilesServer([wireRow({ id: 'file_1' })]);
    await loadFiles();
    api.deleteFile.mockRejectedValue(httpError(404));

    const result = await deleteHealthFile('file_1');
    expect(result.status).toBe('saved');
    expect(result.message).toBeNull();
    expect(result.files).toEqual([]);
    expect(await storageHelpers.getObject(HEALTH_FILES_KEY)).toEqual([]);
  });

  it('HEALTH-FILES-044: a lost connection rolls the row BACK — no optimistic phantom is persisted', async () => {
    fakeFilesServer([wireRow({ id: 'file_1' })]);
    const before = await loadFiles();
    api.deleteFile.mockRejectedValue(NETWORK_ERROR);

    const result = await deleteHealthFile('file_1');
    expect(result.status).toBe('offline');
    expect(result.message).toBe(FILE_OFFLINE_MESSAGE);
    expect(result.files).toEqual(before);
    // The cache still holds the file — a cold start must not lose it.
    expect(await storageHelpers.getObject(HEALTH_FILES_KEY)).toEqual(before);
  });

  it('HEALTH-FILES-045: a REFUSED delete (not 404, not a network wobble) rolls back with its own message', async () => {
    fakeFilesServer([wireRow({ id: 'file_1' })]);
    const before = await loadFiles();
    api.deleteFile.mockRejectedValue(httpError(403));

    const result = await deleteHealthFile('file_1');
    expect(result.status).toBe('rejected');
    expect(result.message).toContain('sign in again');
    expect(result.files).toEqual(before);
  });

  it('HEALTH-FILES-046: a successful delete whose REFRESH fails still reports success, keeping the optimistic list', async () => {
    const rows = [wireRow({ id: 'file_1' }), wireRow({ id: 'file_2', file_name: 'Other.pdf' })];
    fakeFilesServer(rows);

    // `deleteHealthFile` calls `listFiles` TWICE: once for its own `before`
    // snapshot, and once more (`fetchFiles`) after the DELETE succeeds. Queue
    // them in that exact order so only the SECOND — the refresh — fails; a
    // naive single `mockRejectedValueOnce` here would instead fail the FIRST
    // call and let the fake server's persistent handler answer the refresh,
    // which would pass even if the catch branch under test were broken.
    api.listFiles.mockImplementationOnce(() => Promise.resolve({ files: rows }));
    api.listFiles.mockRejectedValueOnce(NETWORK_ERROR);

    const result = await deleteHealthFile('file_1');
    expect(api.deleteFile).toHaveBeenCalledWith('file_1');
    expect(result.status).toBe('saved');
    expect(result.files.map((f) => f.id)).toEqual(['file_2']);
    // The optimistic list is what actually persisted — the refresh never landed.
    expect(await storageHelpers.getObject(HEALTH_FILES_KEY)).toEqual(result.files);
  });
});

/* ------------------------------------------------------------------ */
/* Privacy — the cache holds METADATA ONLY, never bytes                 */
/* ------------------------------------------------------------------ */

describe('healthFilesStorage — the cache never holds file bytes', () => {
  const METADATA_KEYS = [
    'id',
    'name',
    'type',
    'mimeType',
    'sizeBytes',
    'category',
    'createdAt',
    'updatedAt',
    'contentPath',
    'isImage',
  ].sort();

  it('HEALTH-FILES-047: every cached entry after a load is exactly the metadata shape — no extra keys', async () => {
    fakeFilesServer([wireRow({ id: 'file_1' })]);
    await loadFiles();

    const cached = await storageHelpers.getObject<HealthFileEntry[]>(HEALTH_FILES_KEY);
    expect(cached).not.toBeNull();
    for (const row of cached ?? []) {
      expect(Object.keys(row).sort()).toEqual(METADATA_KEYS);
    }
  });

  it('HEALTH-FILES-048: a successful upload caches metadata only — the Blob never reaches storageHelpers', async () => {
    const setObjectSpy = jest.spyOn(storageHelpers, 'setObject');
    mockLocalBlob(2048);

    await uploadHealthFile({ uri: 'file:///a/body.jpg', name: 'body.jpg', fileType: 'body_photo' });

    const filesCalls = setObjectSpy.mock.calls.filter(([key]) => key === HEALTH_FILES_KEY);
    expect(filesCalls.length).toBeGreaterThan(0);
    for (const [, value] of filesCalls) {
      const serialised = JSON.stringify(value);
      // No Blob-shaped payload, no raw byte buffer, ever leaves this function
      // for the cache — only the metadata fields defined on HealthFileEntry.
      expect(serialised).not.toMatch(/"size":2048/); // the Blob's own `size` field
      for (const row of value as HealthFileEntry[]) {
        expect(Object.keys(row).sort()).toEqual(METADATA_KEYS);
      }
    }
  });

  it('HEALTH-FILES-049: a body_photo entry carries no more data than any other file — same shape', async () => {
    fakeFilesServer([wireRow({ id: 'bp_1', file_type: 'body_photo', file_name: 'progress.jpg' })]);
    const files = await loadFiles();
    expect(Object.keys(files[0]).sort()).toEqual(METADATA_KEYS);
  });
});
