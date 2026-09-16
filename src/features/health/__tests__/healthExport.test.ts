/**
 * Symply Health — "Export my data" (`healthExport.ts`).
 *
 * The donor shipped this row with an empty body — this is the real thing, so
 * there is no donor test to port from. Two layers:
 *
 *  1. PURE — `buildHealthExport` / `totalExportedRows` / `healthExportFileName`,
 *     which can be reasoned about without a network or a file system.
 *  2. THE VERB — `exportHealthData`, which THIS SUITE PROVES WRITES A REAL FILE
 *     WITH REAL DATA: `FileSystem.writeAsStringAsync` is mocked to CAPTURE its
 *     argument rather than a stub that only checks it was called, and the
 *     captured string is parsed back and asserted against the exact rows the
 *     sync delta carried — a "we called write" test would pass even if the
 *     document builder were wired to `{}`.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { healthApi, type HealthSyncDelta } from '@api/health';

import {
  buildHealthExport,
  exportHealthData,
  healthExportFileName,
  HEALTH_EXPORT_BUCKETS,
  HEALTH_EXPORT_FAILED_MESSAGE,
  HEALTH_EXPORT_FORMAT,
  HEALTH_EXPORT_NOTES,
  HEALTH_EXPORT_VERSION,
  totalExportedRows,
  type HealthExportDocument,
} from '../healthExport';

jest.mock('expo-file-system/legacy', () => ({
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  cacheDirectory: 'file:///cache/',
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));
jest.mock('@api/health', () => {
  const actual = jest.requireActual('@api/health');
  return { ...actual, healthApi: { ...actual.healthApi, sync: jest.fn() } };
});

const mockWrite = FileSystem.writeAsStringAsync as jest.Mock;
const mockDelete = FileSystem.deleteAsync as jest.Mock;
const mockIsAvailable = Sharing.isAvailableAsync as jest.Mock;
const mockShare = Sharing.shareAsync as jest.Mock;
const mockSync = healthApi.sync as jest.Mock;

const NETWORK_ERROR = new Error('Network request failed');
const ISO = '2026-07-26T12:00:00.000Z';

function row(id: string, over: Record<string, unknown> = {}) {
  return { id, updated_at: ISO, deleted_at: null, ...over };
}

/** A delta carrying two live weight rows and one tombstoned one. */
function sampleDelta(over: Partial<HealthSyncDelta> = {}): Partial<HealthSyncDelta> {
  return {
    server_time: ISO,
    weight_entries: [row('w1', { weight: 70 }), row('w2', { weight: 71, deleted_at: ISO })],
    habits: [row('h1', { name: 'Sleep 7+ hours' })],
    ...over,
  } as Partial<HealthSyncDelta>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWrite.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
  mockIsAvailable.mockResolvedValue(true);
  mockShare.mockResolvedValue(undefined);
  mockSync.mockResolvedValue(sampleDelta());
});

/* ------------------------------------------------------------------ */
/* Pure — buildHealthExport                                             */
/* ------------------------------------------------------------------ */

describe('buildHealthExport', () => {
  it('HEALTH-EXPORT-001: copies every declared bucket, in the declared order', () => {
    const doc = buildHealthExport(sampleDelta(), { exportedAt: ISO });
    expect(Object.keys(doc.data)).toEqual([...HEALTH_EXPORT_BUCKETS]);
    expect(Object.keys(doc.counts)).toEqual([...HEALTH_EXPORT_BUCKETS]);
  });

  it('HEALTH-EXPORT-002: tombstoned rows (deleted_at set) are filtered OUT — deleted stays deleted', () => {
    const doc = buildHealthExport(sampleDelta(), { exportedAt: ISO });
    expect(doc.data.weight_entries).toHaveLength(1);
    expect((doc.data.weight_entries[0] as { id: string }).id).toBe('w1');
    expect(doc.counts.weight_entries).toBe(1);
  });

  it('HEALTH-EXPORT-002b: a genuinely non-object row (null, a string, a number) is treated as live, not thrown', () => {
    // `isTombstoned` guards against a malformed row before reading `.deleted_at`
    // off it; only a real `deleted_at` string filters a row OUT.
    const doc = buildHealthExport(
      sampleDelta({ weight_entries: [null, 'garbage', 42] as never }),
      { exportedAt: ISO }
    );
    expect(doc.data.weight_entries).toHaveLength(3);
    expect(doc.counts.weight_entries).toBe(3);
  });

  it('HEALTH-EXPORT-003: a bucket absent from the delta (older Worker) renders as an empty array, not a crash', () => {
    const doc = buildHealthExport({ server_time: ISO }, { exportedAt: ISO });
    for (const bucket of HEALTH_EXPORT_BUCKETS) {
      expect(doc.data[bucket]).toEqual([]);
      expect(doc.counts[bucket]).toBe(0);
    }
  });

  it('HEALTH-EXPORT-004: null/undefined delta is handled the same as an empty one', () => {
    expect(buildHealthExport(null, { exportedAt: ISO }).counts.weight_entries).toBe(0);
    expect(buildHealthExport(undefined, { exportedAt: ISO }).counts.weight_entries).toBe(0);
  });

  it('HEALTH-EXPORT-005: carries the format/version/app/exported_at/server_time/notes verbatim', () => {
    const doc = buildHealthExport(sampleDelta(), { exportedAt: ISO, appName: 'Symply Health' });
    expect(doc.format).toBe(HEALTH_EXPORT_FORMAT);
    expect(doc.version).toBe(HEALTH_EXPORT_VERSION);
    expect(doc.app).toBe('Symply Health');
    expect(doc.exported_at).toBe(ISO);
    expect(doc.server_time).toBe(ISO);
    expect(doc.notes).toEqual([...HEALTH_EXPORT_NOTES]);
  });

  it('HEALTH-EXPORT-006: a non-string server_time (missing on an old Worker) becomes null, not garbage', () => {
    const doc = buildHealthExport({ weight_entries: [] } as never, { exportedAt: ISO });
    expect(doc.server_time).toBeNull();
  });

  it('HEALTH-EXPORT-007: the notes state what is EXCLUDED — deleted rows, the coach transcript, file bytes', () => {
    expect(HEALTH_EXPORT_NOTES.some((n) => /deleted/i.test(n))).toBe(true);
    expect(HEALTH_EXPORT_NOTES.some((n) => /coach/i.test(n) && /never stored on the server/i.test(n))).toBe(
      true
    );
    expect(HEALTH_EXPORT_NOTES.some((n) => /images and documents themselves are not inside/i.test(n))).toBe(
      true
    );
  });
});

describe('totalExportedRows', () => {
  it('HEALTH-EXPORT-010: sums every bucket count', () => {
    const doc = buildHealthExport(sampleDelta(), { exportedAt: ISO });
    expect(totalExportedRows(doc)).toBe(2); // 1 live weight row + 1 habit row
  });

  it('HEALTH-EXPORT-011: an entirely empty account totals zero', () => {
    expect(totalExportedRows(buildHealthExport(null, { exportedAt: ISO }))).toBe(0);
  });
});

describe('healthExportFileName', () => {
  it('HEALTH-EXPORT-020: is dated so repeat exports do not collide', () => {
    expect(healthExportFileName('2026-07-26')).toBe('symply-health-2026-07-26.json');
    expect(healthExportFileName('2026-01-01')).not.toBe(healthExportFileName('2026-01-02'));
  });
});

/* ------------------------------------------------------------------ */
/* The verb — exportHealthData writes a REAL file with REAL data        */
/* ------------------------------------------------------------------ */

describe('exportHealthData — writes an actual file carrying the actual rows', () => {
  it('HEALTH-EXPORT-030: the captured write payload parses back into the SAME rows the delta carried', async () => {
    mockSync.mockResolvedValue(
      sampleDelta({
        weight_entries: [row('w1', { weight: 70.4, unit: 'kg' })],
        water_entries: [row('wt1', { amount_ml: 500 })],
        habits: [],
      } as never)
    );

    const result = await exportHealthData();

    expect(mockWrite).toHaveBeenCalledTimes(1);
    const [path, contents] = mockWrite.mock.calls[0] as [string, string];
    expect(path).toContain('symply-health-');
    expect(path.endsWith('.json')).toBe(true);

    // Parse the EXACT string that would have hit disk — proves the document is
    // real JSON carrying the real rows, not a stub that only checked "was
    // writeAsStringAsync called".
    const parsed = JSON.parse(contents) as HealthExportDocument;
    expect(parsed.format).toBe(HEALTH_EXPORT_FORMAT);
    expect(parsed.data.weight_entries).toEqual([
      expect.objectContaining({ id: 'w1', weight: 70.4, unit: 'kg' }),
    ]);
    expect(parsed.data.water_entries).toEqual([expect.objectContaining({ id: 'wt1', amount_ml: 500 })]);
    expect(parsed.counts.weight_entries).toBe(1);
    expect(parsed.counts.water_entries).toBe(1);

    expect(result.status).toBe('shared');
    expect(result.rows).toBe(2);
  });

  it('HEALTH-EXPORT-031: hands the written path to the OS share sheet as application/json', async () => {
    await exportHealthData();
    expect(mockShare).toHaveBeenCalledTimes(1);
    const [path, options] = mockShare.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(mockWrite.mock.calls[0][0]);
    expect(options.mimeType).toBe('application/json');
  });

  it('HEALTH-EXPORT-032: the cache file is deleted after a SUCCESSFUL share — no health record left behind', async () => {
    await exportHealthData();
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete.mock.calls[0][0]).toBe(mockWrite.mock.calls[0][0]);
    expect(mockDelete.mock.calls[0][1]).toEqual({ idempotent: true });
  });

  it('HEALTH-EXPORT-033: the confirmation message states the real row count, pluralised correctly', async () => {
    mockSync.mockResolvedValue(sampleDelta({ weight_entries: [row('w1')], habits: [] } as never));
    const result = await exportHealthData();
    expect(result.rows).toBe(1);
    expect(result.message).toContain('1 record.');
    expect(result.message).not.toContain('1 records');
  });

  it('HEALTH-EXPORT-034: an empty account still produces a real (empty) file and says so honestly', async () => {
    mockSync.mockResolvedValue({ server_time: ISO });
    const result = await exportHealthData();

    expect(result.status).toBe('shared');
    expect(result.rows).toBe(0);
    expect(result.message).toMatch(/no health records in your account yet/i);
    const parsed = JSON.parse(mockWrite.mock.calls[0][1] as string) as HealthExportDocument;
    expect(totalExportedRows(parsed)).toBe(0);
  });
});

describe('exportHealthData — failure paths never leak a raw error, and always clean up', () => {
  it('HEALTH-EXPORT-040: the initial pull failing writes nothing and shares nothing', async () => {
    mockSync.mockRejectedValue(NETWORK_ERROR);
    const result = await exportHealthData();

    expect(result).toEqual({ status: 'failed', message: HEALTH_EXPORT_FAILED_MESSAGE, rows: 0 });
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockShare).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled(); // nothing was ever written to clean up
  });

  it('HEALTH-EXPORT-041: a write failure reports "failed" with the real row count it TRIED to write', async () => {
    mockSync.mockResolvedValue(sampleDelta({ weight_entries: [row('w1')], habits: [] } as never));
    mockWrite.mockRejectedValue(new Error('disk full'));

    const result = await exportHealthData();
    expect(result.status).toBe('failed');
    expect(result.message).toBe(HEALTH_EXPORT_FAILED_MESSAGE);
    expect(result.message).not.toMatch(/disk full/i);
    expect(result.rows).toBe(1);
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('HEALTH-EXPORT-042: no share-sheet support reports "unsupported" and still cleans up the temp file', async () => {
    mockIsAvailable.mockResolvedValue(false);
    const result = await exportHealthData();

    expect(result.status).toBe('unsupported');
    expect(mockShare).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledTimes(1); // finally still runs
  });

  it('HEALTH-EXPORT-043: a share-sheet rejection (member cancelled, or a system error) reports "failed" and still cleans up', async () => {
    mockShare.mockRejectedValue(new Error('User did not share'));
    const result = await exportHealthData();

    expect(result.status).toBe('failed');
    expect(result.message).toBe(HEALTH_EXPORT_FAILED_MESSAGE);
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-EXPORT-044: the cleanup delete itself failing does not throw or change the verdict', async () => {
    mockDelete.mockRejectedValue(new Error('file already gone'));
    const result = await exportHealthData();
    expect(result.status).toBe('shared'); // the share already succeeded before cleanup ran
  });
});
