/**
 * WHEN a blob reconcile runs, and what a run is allowed to do (plan §8).
 *
 * **The drift this closes.** `reconcileHealthBlobs` had no caller. A row deleted
 * on THIS device takes `deleteHealthBlob` with it; a row deleted on the user's
 * OTHER device arrives as an op, and nothing on this side ever heard about the
 * bytes it pointed at — the encrypted object stayed on the relay as an orphan
 * and, on the surface where it matters most, the DECRYPTED plaintext stayed in
 * `cacheDirectory` for a photo the member had already deleted.
 *
 * Three things have to be true, and each is a separate failure mode:
 *
 *  1. A sync that applied remote ops schedules a pass (the wiring test at the
 *     bottom reads the orchestrator's source, because a behavioural test would
 *     need the whole mailbox engine and would be skipped in exactly the
 *     conditions where the missing call site lives).
 *  2. A pass drops LOCAL copies of blobs no live row points at.
 *  3. A pass does **not** release the remote object. A device that has not
 *     caught up would tombstone attachments for rows it simply has not received
 *     yet — deleting live bytes belonging to the user's other device.
 *
 * The filesystem is a real in-memory one rather than a bag of `jest.fn()`s, for
 * the same reason `blobs.store.test.ts` uses one: a stateless mock would let a
 * pass that deleted nothing satisfy every assertion here.
 *
 * Static imports only: `await import()` throws under this Jest config.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import * as FileSystem from 'expo-file-system/legacy';

import { cachedHealthBlobUri, isHealthBlobCached } from '../blobs/healthBlobStore';
import {
  HEALTH_BLOB_RECONCILE_MIN_INTERVAL_MS,
  resetHealthBlobReconcileScheduleForTests,
  scheduleHealthBlobReconcile,
} from '../blobs/reconcileScheduler';

// --- in-memory filesystem ----------------------------------------------------

type Entry = { bytes: Uint8Array; isDirectory: boolean };

const fs = new Map<string, Entry>();

function normalize(uri: string): string {
  return uri.replace(/\/+$/, '');
}

function put(uri: string, isDirectory = false): void {
  const path = normalize(uri);
  if (!isDirectory) {
    const parts = path.split('/');
    for (let i = parts.length - 1; i > 3; i -= 1) {
      const parent = parts.slice(0, i).join('/');
      if (!fs.has(parent)) fs.set(parent, { bytes: new Uint8Array(0), isDirectory: true });
    }
  }
  fs.set(path, { bytes: new Uint8Array(4), isDirectory });
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
      modificationTime: 1,
    } as never;
  });
  mocked.makeDirectoryAsync.mockImplementation(async (uri: string) => put(uri, true));
  mocked.deleteAsync.mockImplementation(async (uri: string) => {
    const prefix = `${normalize(uri)}/`;
    for (const path of Array.from(fs.keys())) {
      if (path === normalize(uri) || path.startsWith(prefix)) fs.delete(path);
    }
  });
  mocked.readDirectoryAsync.mockImplementation(async (uri: string) => {
    const prefix = `${normalize(uri)}/`;
    return Array.from(fs.keys())
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map((path) => path.slice(prefix.length));
  });
}

// --- engine + relay stand-ins -------------------------------------------------

const LIVE_BLOB = 'blob_1111111111111111111111111111aaaa';
const DELETED_BLOB = 'blob_2222222222222222222222222222bbbb';

function descriptorFor(blobId: string) {
  return {
    blobId,
    mime: 'image/jpeg',
    bytes: 4,
    sha256: 'c'.repeat(64),
    chunkCount: 1,
    keyEpoch: 1,
  };
}

/**
 * The ledger AFTER a sync applied the other device's tombstone: the row that
 * carried `DELETED_BLOB` is tombstoned, the row that carries `LIVE_BLOB` is not.
 */
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

jest.mock('../engine', () => ({
  getLocalHealthHouseholdKeys: jest.fn(() => ({
    householdId: 'hh_health',
    hdk: new Uint8Array(32).fill(5),
    keyEpoch: 1,
  })),
  getLocalHealthRetiredHouseholdKey: jest.fn(() => null),
  getLocalHealthLedger: jest.fn(() => mockLedger),
  isAwaitingHealthEnrolment: jest.fn(() => false),
}));

const mockRelay = { deleted: [] as string[] };

jest.mock('../blobs/blobTransport', () => ({
  HealthBlobIncompleteError: class extends Error {},
  HealthBlobMissingError: class extends Error {},
  HealthBlobQuotaError: class extends Error {},
  putHealthBlobChunk: jest.fn(),
  finalizeHealthBlob: jest.fn(),
  fetchHealthBlobManifest: jest.fn(async () => null),
  fetchHealthBlobChunk: jest.fn(),
  fetchHealthBlobUsage: jest.fn(),
  deleteRemoteHealthBlob: jest.fn(async (_householdId: string, blobId: string) => {
    mockRelay.deleted.push(blobId);
  }),
}));

beforeEach(() => {
  fs.clear();
  mockRelay.deleted = [];
  jest.clearAllMocks();
  installFsBehaviour();
  resetHealthBlobReconcileScheduleForTests();
  jest.spyOn(console, 'log').mockImplementation(() => {});

  mockLedger.bodyMeasurements = [
    { id: 'b1', date: '2026-01-01', unit: 'cm', photo: descriptorFor(LIVE_BLOB) },
    {
      id: 'b2',
      date: '2026-01-02',
      unit: 'cm',
      photo: descriptorFor(DELETED_BLOB),
      // The other device's tombstone, as the sync just merged it.
      deleted_at: '2026-02-01T00:00:00.000Z',
    },
  ];
  put(cachedHealthBlobUri(LIVE_BLOB));
  put(cachedHealthBlobUri(DELETED_BLOB));
  put(`file:///doc/lf-health-blob-origin/${DELETED_BLOB}`);
});

afterEach(() => {
  (console.log as jest.Mock).mockRestore();
});

describe('a scheduled pass', () => {
  it('evicts the local plaintext of a row the other device deleted', async () => {
    const result = await scheduleHealthBlobReconcile({ reason: 'sync' });

    expect(result?.cacheEvicted).toEqual([DELETED_BLOB]);
    expect(result?.stagingCleared).toEqual([DELETED_BLOB]);
    expect(await isHealthBlobCached(DELETED_BLOB)).toBe(false);
    // The live row's photo is untouched — an over-eager sweep is the other way
    // to lose a member's attachment.
    expect(await isHealthBlobCached(LIVE_BLOB)).toBe(true);
  });

  it('does NOT release the remote object', async () => {
    // The load-bearing default. This device's view of the ledger is only as
    // complete as its last sync, so a device that has not caught up would
    // tombstone attachments for rows it has simply not received yet.
    const result = await scheduleHealthBlobReconcile({ reason: 'sync' });

    expect(result?.tombstoned).toEqual([]);
    expect(mockRelay.deleted).toEqual([]);
  });
});

describe('the debounce', () => {
  it('runs once and then declines until the window has passed', async () => {
    expect(await scheduleHealthBlobReconcile({ reason: 'sync' })).not.toBeNull();

    // A catch-up round applies ops in the hundreds; each one asking for a pass
    // would put a filesystem scan behind every inbound delta.
    put(cachedHealthBlobUri(DELETED_BLOB));
    expect(await scheduleHealthBlobReconcile({ reason: 'sync' })).toBeNull();
    expect(await isHealthBlobCached(DELETED_BLOB)).toBe(true);
  });

  it('runs again once the window has passed', async () => {
    const start = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(start);
    await scheduleHealthBlobReconcile({ reason: 'sync' });

    clock.mockReturnValue(start + HEALTH_BLOB_RECONCILE_MIN_INTERVAL_MS);
    put(cachedHealthBlobUri(DELETED_BLOB));
    expect(await scheduleHealthBlobReconcile({ reason: 'sync' })).not.toBeNull();
    expect(await isHealthBlobCached(DELETED_BLOB)).toBe(false);

    clock.mockRestore();
  });

  it('lets a member-initiated pass through, but never a second concurrent walk', async () => {
    await scheduleHealthBlobReconcile({ reason: 'sync' });

    const first = scheduleHealthBlobReconcile({ reason: 'manual', force: true });
    const second = scheduleHealthBlobReconcile({ reason: 'manual', force: true });
    // Single-flight: the second ask joins the in-flight pass rather than
    // starting a concurrent walk over the same directories.
    expect(second).toBe(first);
    await first;
  });

  it('never throws, so a failed tidy-up cannot fail the sync that scheduled it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (FileSystem as jest.Mocked<typeof FileSystem>).readDirectoryAsync.mockRejectedValue(
      new Error('filesystem said no'),
    );

    await expect(scheduleHealthBlobReconcile({ reason: 'sync' })).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not retry a failing pass on every sync', async () => {
    // The clock advances BEFORE the pass, so a pass that throws every time
    // cannot turn into a filesystem scan on every sync round.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const readDir = (FileSystem as jest.Mocked<typeof FileSystem>).readDirectoryAsync;
    readDir.mockRejectedValue(new Error('filesystem said no'));

    await scheduleHealthBlobReconcile({ reason: 'sync' });
    const callsAfterFirst = readDir.mock.calls.length;
    await scheduleHealthBlobReconcile({ reason: 'sync' });

    expect(readDir.mock.calls.length).toBe(callsAfterFirst);
    warn.mockRestore();
  });
});

// --- the sync seam ------------------------------------------------------------

describe('the sync applies remote ops and asks for a pass', () => {
  const ORCHESTRATOR = readFileSync(join(__dirname, '..', 'sync', 'orchestrator.ts'), 'utf8');

  /** Comments stripped — assert on code, not on prose about the code. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, (_match, before) =>
      before === undefined ? ' ' : `${before} `,
    );
  }

  const CODE = stripComments(ORCHESTRATOR);

  it('imports the scheduler', () => {
    expect(CODE).toMatch(
      /import\s*\{[^}]*scheduleHealthBlobReconcile[^}]*\}\s*from\s*'\.\.\/blobs'/,
    );
  });

  it('calls it where the remote ops were applied, not merely somewhere in the run', () => {
    // Scoped to the `fresh.length > 0` branch: a call placed outside it would
    // satisfy an import assertion while running on rounds that applied nothing
    // — and, worse, could be moved out of the branch by a refactor unnoticed.
    const start = CODE.indexOf('if (fresh.length > 0)');
    const branch = CODE.slice(start, CODE.indexOf('status.setResult({', start));
    expect(start).toBeGreaterThan(0);
    expect(branch).toContain('noteRemoteHealthOpsApplied(fresh)');
    expect(branch).toMatch(/scheduleHealthBlobReconcile\(\{\s*reason:\s*'sync'\s*\}\)/);
  });

  it('never asks the sync seam to release the remote object', () => {
    // `releaseRemote` from a device that has not caught up deletes live bytes.
    expect(CODE).not.toContain('releaseRemote');
  });
});
