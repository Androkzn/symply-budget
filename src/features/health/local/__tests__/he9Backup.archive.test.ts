/**
 * He9 — the local encrypted archive (`backupArchive.ts`, plan §10).
 *
 * Two things are being certified here, and only one of them is "the code runs":
 *
 *  1. **The archive round-trips through the checkpoint seal path.** Not through
 *     a bespoke crypto helper — through `sealCheckpoint` / `openCheckpoint`, the
 *     same pair `sync/checkpoints.ts` publishes with. If someone ever swaps in a
 *     hand-rolled AEAD, the tamper cases below stop failing the way they do now.
 *
 *  2. **The archive is never written in plaintext.** This is asserted against
 *     the bytes that actually leave the device: the string handed to
 *     `FileSystem.writeAsStringAsync`, scanned for a marker that was written
 *     into a real ledger row, and the base64-decoded chunks scanned for it too.
 *     A test that only checked `chunksBase64.length > 0` would pass against a
 *     writer that JSON-stringified the ledger next to the ciphertext.
 *
 * And one product assertion: **there is no restore.** §16 Q8 is open and §17
 * says the fallback is *"Ship no restore claim"*, so `restoreHealthLedgerFromArchive`
 * must throw rather than work. That is the assertion most likely to be "fixed"
 * by a future engineer, which is exactly why it is here.
 *
 * A REAL in-memory session (`openLocalHealthSessionForTests`) with the real
 * engine, op journal and per-row AEAD — the archive is a snapshot of a projection
 * and mocking the projection would certify nothing.
 *
 * Static imports only: `await import()` throws under this Jest config without
 * `--experimental-vm-modules`.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { base64ToBytes, bytesToBase64, utf8Decode } from '@symply/local-first';

import {
  buildHealthLedgerArchive,
  healthArchiveFileName,
  HealthArchiveKeyingUndecidedError,
  HEALTH_ARCHIVE_FORMAT,
  HEALTH_ARCHIVE_GENERATION,
  HEALTH_ARCHIVE_KEYING,
  HEALTH_ARCHIVE_KEYING_QUESTION,
  HEALTH_ARCHIVE_NOTES,
  HEALTH_ARCHIVE_VERSION,
  openHealthLedgerArchive,
  parseHealthArchiveJson,
  restoreHealthLedgerFromArchive,
  shareHealthLedgerArchive,
  verifyHealthLedgerArchive,
} from '../backupArchive';
import { closeLocalHealthSession, openLocalHealthSessionForTests } from '../engine';
import { localWeightApi } from '../localWeightApi';
import { rowsOf } from '../localWrite';
import type { LocalWeightEntry } from '../types';

jest.mock('expo-file-system/legacy', () => ({
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  cacheDirectory: 'file:///cache/',
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

const mockWrite = FileSystem.writeAsStringAsync as jest.Mock;
const mockDelete = FileSystem.deleteAsync as jest.Mock;
const mockIsAvailable = Sharing.isAvailableAsync as jest.Mock;
const mockShare = Sharing.shareAsync as jest.Mock;

const USER = 'user_health_he9';

/**
 * A string that exists nowhere except inside one weight row's free-text note.
 * Every "is it plaintext" assertion below is a search for exactly this.
 */
const MARKER = 'HE9-PLAINTEXT-CANARY-8f2a';

const NOW = new Date('2026-08-14T09:30:00.000Z');

beforeEach(async () => {
  jest.clearAllMocks();
  mockIsAvailable.mockResolvedValue(true);
  mockShare.mockResolvedValue(undefined);
  mockWrite.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
  await openLocalHealthSessionForTests({ userId: USER });
  await localWeightApi.createWeight({
    date: '2026-08-14',
    weight: 81.2,
    unit: 'kg',
    note: MARKER,
  });
});

afterEach(async () => {
  await closeLocalHealthSession();
});

describe('archive shape', () => {
  it('seals the ledger into an envelope that declares its own keying', async () => {
    const archive = await buildHealthLedgerArchive({ now: NOW });

    expect(archive.envelope.format).toBe(HEALTH_ARCHIVE_FORMAT);
    expect(archive.envelope.version).toBe(HEALTH_ARCHIVE_VERSION);
    expect(archive.envelope.createdAt).toBe(NOW.toISOString());
    expect(archive.envelope.keying).toBe(HEALTH_ARCHIVE_KEYING);
    expect(archive.envelope.notes).toEqual([...HEALTH_ARCHIVE_NOTES]);
    expect(archive.envelope.chunksBase64.length).toBeGreaterThan(0);
  });

  it('stamps the archive generation outside the relay series, so a chunk cannot be replayed as one', async () => {
    const archive = await buildHealthLedgerArchive({ now: NOW });

    // `sync/checkpoints.ts` mints `max(known) + 1`, so published generations
    // start at 1 and can never reach 0.
    expect(HEALTH_ARCHIVE_GENERATION).toBe(0);
    expect(archive.envelope.manifest.generation).toBe(HEALTH_ARCHIVE_GENERATION);
  });

  it('reports row counts in memory and keeps them out of the file', async () => {
    const archive = await buildHealthLedgerArchive({ now: NOW });

    expect(archive.summary.liveRows).toBe(1);
    expect(archive.summary.tableCounts.weightEntries).toBe(1);
    expect(archive.summary.bytes).toBe(archive.json.length);
    // The counts are for the confirmation UI, not for whoever the file is
    // handed to — the envelope must not carry them.
    expect(Object.keys(archive.envelope)).not.toContain('summary');
    expect(Object.keys(archive.envelope)).not.toContain('tableCounts');
  });

  it('dates the file name so repeated saves do not collide', () => {
    expect(healthArchiveFileName('2026-08-14')).toBe('symply-health-archive-2026-08-14.json');
  });
});

describe('round-trip through the checkpoint seal path', () => {
  it('opens back to the rows that were logged', async () => {
    const archive = await buildHealthLedgerArchive({ now: NOW });

    const plaintext = openHealthLedgerArchive(archive.envelope);

    const weight = plaintext.rows.filter((row) => row.table === 'weightEntries');
    expect(weight).toHaveLength(1);
    expect(weight[0]!.bodyJson).toContain(MARKER);
    expect(plaintext.householdId).toBe(archive.envelope.householdId);
  });

  it('survives a JSON write/parse cycle', async () => {
    const archive = await buildHealthLedgerArchive({ now: NOW });

    const parsed = parseHealthArchiveJson(archive.json);
    const verified = verifyHealthLedgerArchive(archive.json);

    expect(parsed.manifest.rootHash).toBe(archive.envelope.manifest.rootHash);
    expect(verified.ok).toBe(true);
    expect(verified.liveRows).toBe(1);
    expect(verified.createdAt).toBe(NOW.toISOString());
  });

  it('refuses a chunk that was tampered with', async () => {
    const archive = await buildHealthLedgerArchive({ now: NOW });
    const bytes = base64ToBytes(archive.envelope.chunksBase64[0]!);
    // `+ 1 mod 256` rather than a XOR — same single-byte corruption, no
    // `no-bitwise` lint noise in a file about exactness.
    bytes[bytes.length - 1] = (bytes[bytes.length - 1]! + 1) % 256;
    const tampered = {
      ...archive.envelope,
      chunksBase64: [bytesToBase64(bytes)],
    };

    // The root hash covers the ciphertext, so the manifest catches this before
    // the AEAD does. Either way it must not open.
    expect(() => openHealthLedgerArchive(tampered)).toThrow(/root hash|decrypt|auth/i);
  });

  it('refuses a manifest that was tampered with', async () => {
    const archive = await buildHealthLedgerArchive({ now: NOW });
    const tampered = {
      ...archive.envelope,
      manifest: { ...archive.envelope.manifest, generation: 7 },
    };

    expect(() => openHealthLedgerArchive(tampered)).toThrow(/signature/i);
  });

  it('refuses a file that is not an archive', () => {
    expect(() => parseHealthArchiveJson('nonsense')).toThrow(/not a Symply Health archive/);
    expect(() => parseHealthArchiveJson(JSON.stringify({ format: 'something-else' }))).toThrow(
      /not a Symply Health archive/,
    );
  });

  it("will not silently skip the signature check for another device's archive", async () => {
    const archive = await buildHealthLedgerArchive({ now: NOW });
    const foreign = {
      ...archive.envelope,
      manifest: { ...archive.envelope.manifest, signerDeviceId: 'dev_the_other_one' },
    };

    expect(() => openHealthLedgerArchive(foreign)).toThrow(/your other device/i);
  });
});

describe('the archive is never written in plaintext', () => {
  it('keeps the marker out of the serialised envelope', async () => {
    const archive = await buildHealthLedgerArchive({ now: NOW });

    expect(archive.json).not.toContain(MARKER);
    // Not just the marker: no ledger table name should be readable either, or
    // the header would leak the shape of the record.
    expect(archive.json).not.toContain('weightEntries');
  });

  it('keeps the marker out of the decoded ciphertext', async () => {
    const archive = await buildHealthLedgerArchive({ now: NOW });

    for (const chunk of archive.envelope.chunksBase64) {
      const bytes = base64ToBytes(chunk);
      // `utf8Decode` over ciphertext yields replacement characters, which is
      // the point: what matters is that the marker is not among them.
      expect(utf8Decode(bytes)).not.toContain(MARKER);
      expect(Buffer.from(bytes).toString('latin1')).not.toContain(MARKER);
    }
  });

  it('keeps the marker out of the bytes handed to the file system', async () => {
    await shareHealthLedgerArchive({ now: NOW });

    expect(mockWrite).toHaveBeenCalledTimes(1);
    const [path, body] = mockWrite.mock.calls[0] as [string, string];
    expect(path).toBe('file:///cache/symply-health-archive-2026-08-14.json');
    expect(body).not.toContain(MARKER);
    // ...and it really is the archive, not an empty stub that trivially passes.
    expect(verifyHealthLedgerArchive(body).liveRows).toBe(1);
  });
});

describe('share sheet discipline', () => {
  it('writes to the cache directory and deletes the file after sharing', async () => {
    const result = await shareHealthLedgerArchive({ now: NOW });

    expect(result.status).toBe('shared');
    expect(result.summary?.liveRows).toBe(1);
    expect(mockShare).toHaveBeenCalledWith(
      'file:///cache/symply-health-archive-2026-08-14.json',
      expect.objectContaining({ mimeType: 'application/json' }),
    );
    expect(mockDelete).toHaveBeenCalledWith(
      'file:///cache/symply-health-archive-2026-08-14.json',
      { idempotent: true },
    );
  });

  it('deletes the file even when sharing fails', async () => {
    mockShare.mockRejectedValueOnce(new Error('sheet dismissed'));

    const result = await shareHealthLedgerArchive({ now: NOW });

    expect(result.status).toBe('failed');
    expect(result.message).not.toMatch(/sheet dismissed/);
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('says so when the device cannot share files', async () => {
    mockIsAvailable.mockResolvedValueOnce(false);

    const result = await shareHealthLedgerArchive({ now: NOW });

    expect(result.status).toBe('unsupported');
    expect(mockShare).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('never surfaces a system error string', async () => {
    mockWrite.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));

    const result = await shareHealthLedgerArchive({ now: NOW });

    expect(result.status).toBe('failed');
    expect(result.message).not.toMatch(/ENOSPC/);
  });
});

describe('Q8 — restore is not shipped', () => {
  it('keeps the question declared open in code', () => {
    expect(HEALTH_ARCHIVE_KEYING_QUESTION.id).toBe('Q8');
    expect(HEALTH_ARCHIVE_KEYING_QUESTION.status).toBe('open');
    expect(HEALTH_ARCHIVE_KEYING_QUESTION.options).toHaveLength(3);
  });

  it('throws rather than restoring, and names the blocker', () => {
    expect(() => restoreHealthLedgerFromArchive()).toThrow(HealthArchiveKeyingUndecidedError);
    expect(() => restoreHealthLedgerFromArchive()).toThrow(/Q8/);
    expect(() => restoreHealthLedgerFromArchive()).toThrow(/no restore claim/i);
  });

  it('does not touch the ledger when the archive is verified', async () => {
    const archive = await buildHealthLedgerArchive({ now: NOW });
    // Read straight off the ledger, not through `listWeight` — the facade
    // applies a read window relative to the real clock, which would make this
    // assertion depend on the day the suite runs.
    const before = rowsOf<LocalWeightEntry>('weightEntries').length;

    verifyHealthLedgerArchive(archive.json);

    expect(rowsOf<LocalWeightEntry>('weightEntries')).toHaveLength(before);
  });
});
