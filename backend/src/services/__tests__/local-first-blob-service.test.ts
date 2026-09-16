/**
 * `LocalFirstBlobService` — the server half of the H6 encrypted blob channel.
 *
 * Runs against a live miniflare D1 + R2 rather than a hand-rolled fake, because
 * the behaviours worth pinning here are all SQL behaviours: the idempotent
 * chunk upsert, the running `cipher_bytes` total the quota is measured on, and
 * the two-armed sweep predicate. A fake that re-implements those in TypeScript
 * would prove the fake, not the service.
 *
 * What is deliberately NOT tested here: anything about plaintext. The service
 * never sees it. The nonce-reuse rule the plan cares most about is a CLIENT
 * invariant (`blobResume` in `houseBlobStore.test.ts`) — the server cannot check
 * it, since every chunk is opaque bytes to it.
 */
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import {
  BLOB_PENDING_TTL_MS,
  BLOB_QUOTA_HARD_BYTES,
  BLOB_TOMBSTONE_GRACE_MS,
  BlobIncompleteError,
  BlobQuotaExceededError,
  LocalFirstBlobService,
} from '../local-first-blob-service';

const testEnv = env as unknown as Env;
const HID = 'hh_blob_1';
const OTHER_HID = 'hh_blob_2';

async function createBlobTables(): Promise<void> {
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS lf_blobs (household_id TEXT NOT NULL, blob_id TEXT NOT NULL, key_epoch INTEGER NOT NULL, chunk_count INTEGER NOT NULL, cipher_bytes INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, tombstoned_at TEXT, purge_after TEXT, PRIMARY KEY (household_id, blob_id))`,
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS lf_blob_chunks (household_id TEXT NOT NULL, blob_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, chunk_count INTEGER NOT NULL, r2_key TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, PRIMARY KEY (household_id, blob_id, chunk_index))`,
  );
}

async function resetBlobTables(): Promise<void> {
  await testEnv.DB.exec('DELETE FROM lf_blob_chunks');
  await testEnv.DB.exec('DELETE FROM lf_blobs');
  const listed = await testEnv.REPORTS_BUCKET.list({ prefix: 'lf-blob/' });
  for (const object of listed.objects) {
    await testEnv.REPORTS_BUCKET.delete(object.key);
  }
}

function chunk(byte: number, length = 64): ArrayBuffer {
  return new Uint8Array(length).fill(byte).buffer;
}

function service(): LocalFirstBlobService {
  return new LocalFirstBlobService(testEnv);
}

async function upload(
  blobId: string,
  chunks: ArrayBuffer[],
  opts: { householdId?: string; keyEpoch?: number } = {},
): Promise<void> {
  const svc = service();
  for (let i = 0; i < chunks.length; i += 1) {
    await svc.putChunk({
      householdId: opts.householdId ?? HID,
      blobId,
      keyEpoch: opts.keyEpoch ?? 1,
      chunkIndex: i,
      chunkCount: chunks.length,
      ciphertext: chunks[i]!,
    });
  }
}

describe('LocalFirstBlobService', () => {
  beforeEach(async () => {
    await createBlobTables();
    await resetBlobTables();
  });

  describe('putChunk', () => {
    it('stores ciphertext in R2 under lf-blob/ and returns it byte-identical', async () => {
      const bytes = new Uint8Array([1, 2, 3, 250, 251, 252]);
      await service().putChunk({
        householdId: HID,
        blobId: 'b1',
        keyEpoch: 1,
        chunkIndex: 0,
        chunkCount: 1,
        ciphertext: bytes.buffer,
      });

      const stored = await testEnv.REPORTS_BUCKET.get(`lf-blob/${HID}/b1/0`);
      expect(stored).not.toBeNull();
      expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(bytes);

      const fetched = await service().getChunk(HID, 'b1', 0);
      expect(new Uint8Array(fetched!.bytes)).toEqual(bytes);
    });

    it('is idempotent on (household, blob, index) — a retry does not double-count bytes', async () => {
      const svc = service();
      const body = chunk(7, 100);
      await svc.putChunk({
        householdId: HID,
        blobId: 'b1',
        keyEpoch: 1,
        chunkIndex: 0,
        chunkCount: 1,
        ciphertext: body,
      });
      await svc.putChunk({
        householdId: HID,
        blobId: 'b1',
        keyEpoch: 1,
        chunkIndex: 0,
        chunkCount: 1,
        ciphertext: body,
      });

      const row = await svc.getBlob(HID, 'b1');
      expect(row?.cipher_bytes).toBe(100);
      const { blobCount, cipherBytes } = await svc.usage(HID);
      expect({ blobCount, cipherBytes }).toEqual({ blobCount: 1, cipherBytes: 100 });
    });

    it('tracks the size delta when a chunk is replaced by a different length', async () => {
      const svc = service();
      await upload('b1', [chunk(1, 200)]);
      await svc.putChunk({
        householdId: HID,
        blobId: 'b1',
        keyEpoch: 1,
        chunkIndex: 0,
        chunkCount: 1,
        ciphertext: chunk(1, 50),
      });
      expect((await svc.getBlob(HID, 'b1'))?.cipher_bytes).toBe(50);
    });

    it('accumulates cipher_bytes across the chunks of one blob', async () => {
      await upload('b1', [chunk(1, 10), chunk(2, 20), chunk(3, 30)]);
      expect((await service().getBlob(HID, 'b1'))?.cipher_bytes).toBe(60);
    });

    it('records the key epoch so a rotated peer knows which HDK opens the blob', async () => {
      await upload('b1', [chunk(1)], { keyEpoch: 4 });
      expect((await service().getBlob(HID, 'b1'))?.key_epoch).toBe(4);
    });

    it('leaves a new blob `pending` until it is finalized', async () => {
      await upload('b1', [chunk(1), chunk(2)]);
      expect((await service().getBlob(HID, 'b1'))?.status).toBe('pending');
    });

    it('does NOT revive a tombstoned blob — the bytes stay collectable', async () => {
      const svc = service();
      await upload('b1', [chunk(1)]);
      await svc.finalize({ householdId: HID, blobId: 'b1', chunkCount: 1 });
      await svc.tombstone(HID, 'b1');

      // A peer that has not yet synced the delete re-uploads.
      await upload('b1', [chunk(1)]);

      const row = await svc.getBlob(HID, 'b1');
      expect(row?.status).toBe('tombstoned');
      expect(row?.purge_after).not.toBeNull();
    });
  });

  describe('quota (Q5)', () => {
    it('refuses a chunk that would cross the hard cap', async () => {
      // Seed the household right up against the cap without moving real bytes.
      await upload('big', [chunk(1, 100)]);
      await testEnv.DB.prepare(
        `UPDATE lf_blobs SET cipher_bytes = ? WHERE household_id = ? AND blob_id = ?`,
      )
        .bind(BLOB_QUOTA_HARD_BYTES, HID, 'big')
        .run();

      await expect(
        service().putChunk({
          householdId: HID,
          blobId: 'b2',
          keyEpoch: 1,
          chunkIndex: 0,
          chunkCount: 1,
          ciphertext: chunk(2, 64),
        }),
      ).rejects.toBeInstanceOf(BlobQuotaExceededError);

      // And nothing was written — quota is checked before the R2 put.
      expect(await testEnv.REPORTS_BUCKET.get(`lf-blob/${HID}/b2/0`)).toBeNull();
    });

    it('still accepts a same-size retry at the cap (delta is zero, not positive)', async () => {
      await upload('b1', [chunk(1, 64)]);
      await testEnv.DB.prepare(
        `UPDATE lf_blobs SET cipher_bytes = ? WHERE household_id = ? AND blob_id = ?`,
      )
        .bind(BLOB_QUOTA_HARD_BYTES, HID, 'b1')
        .run();

      await expect(
        service().putChunk({
          householdId: HID,
          blobId: 'b1',
          keyEpoch: 1,
          chunkIndex: 0,
          chunkCount: 1,
          ciphertext: chunk(1, 64),
        }),
      ).resolves.toBeDefined();
    });

    it('scopes the quota per household', async () => {
      await upload('b1', [chunk(1, 100)]);
      await upload('b1', [chunk(1, 40)], { householdId: OTHER_HID });
      expect((await service().usage(HID)).cipherBytes).toBe(100);
      expect((await service().usage(OTHER_HID)).cipherBytes).toBe(40);
    });

    it('excludes tombstoned bytes from the live total', async () => {
      const svc = service();
      await upload('b1', [chunk(1, 100)]);
      await svc.finalize({ householdId: HID, blobId: 'b1', chunkCount: 1 });
      expect((await svc.usage(HID)).cipherBytes).toBe(100);

      await svc.tombstone(HID, 'b1');
      expect(await svc.usage(HID)).toMatchObject({ blobCount: 0, cipherBytes: 0 });
    });

    it('reports the soft-limit breach the Settings card renders', async () => {
      const usage = await service().usage(HID);
      expect(usage.overSoftLimit).toBe(false);
      expect(usage.softLimitBytes).toBeLessThan(usage.hardLimitBytes);
    });
  });

  describe('finalize', () => {
    it('flips pending → complete once every chunk is present', async () => {
      await upload('b1', [chunk(1), chunk(2), chunk(3)]);
      const row = await service().finalize({ householdId: HID, blobId: 'b1', chunkCount: 3 });
      expect(row.status).toBe('complete');
    });

    it('refuses to complete a blob with a missing chunk', async () => {
      const svc = service();
      await svc.putChunk({
        householdId: HID,
        blobId: 'b1',
        keyEpoch: 1,
        chunkIndex: 0,
        chunkCount: 3,
        ciphertext: chunk(1),
      });
      await expect(
        svc.finalize({ householdId: HID, blobId: 'b1', chunkCount: 3 }),
      ).rejects.toBeInstanceOf(BlobIncompleteError);
      expect((await svc.getBlob(HID, 'b1'))?.status).toBe('pending');
    });

    it('never resurrects a tombstoned blob', async () => {
      const svc = service();
      await upload('b1', [chunk(1)]);
      await svc.finalize({ householdId: HID, blobId: 'b1', chunkCount: 1 });
      await svc.tombstone(HID, 'b1');

      const row = await svc.finalize({ householdId: HID, blobId: 'b1', chunkCount: 1 });
      expect(row.status).toBe('tombstoned');
    });
  });

  describe('retention (Q4 — tombstone + watermark, never a TTL)', () => {
    it('keeps the bytes readable immediately after the tombstone', async () => {
      const svc = service();
      await upload('b1', [chunk(9, 32)]);
      await svc.finalize({ householdId: HID, blobId: 'b1', chunkCount: 1 });
      await svc.tombstone(HID, 'b1');

      expect(await svc.sweepPurgeable(500)).toBe(0);
      expect(await testEnv.REPORTS_BUCKET.get(`lf-blob/${HID}/b1/0`)).not.toBeNull();
    });

    it('purges R2 + D1 once the watermark passes', async () => {
      const svc = service();
      await upload('b1', [chunk(9, 32), chunk(8, 32)]);
      await svc.finalize({ householdId: HID, blobId: 'b1', chunkCount: 2 });
      const deletedAt = new Date('2026-01-01T00:00:00.000Z');
      await svc.tombstone(HID, 'b1', deletedAt);

      const afterWatermark = new Date(deletedAt.getTime() + BLOB_TOMBSTONE_GRACE_MS + 1000);
      expect(await svc.sweepPurgeable(500, afterWatermark)).toBe(2);

      expect(await testEnv.REPORTS_BUCKET.get(`lf-blob/${HID}/b1/0`)).toBeNull();
      expect(await svc.getBlob(HID, 'b1')).toBeNull();
      const chunks = await testEnv.DB.prepare(
        `SELECT COUNT(*) AS n FROM lf_blob_chunks WHERE household_id = ? AND blob_id = ?`,
      )
        .bind(HID, 'b1')
        .first<{ n: number }>();
      expect(Number(chunks?.n)).toBe(0);
    });

    it('never purges a live blob, however old', async () => {
      const svc = service();
      await upload('b1', [chunk(1)]);
      await svc.finalize({ householdId: HID, blobId: 'b1', chunkCount: 1 });
      await testEnv.DB.prepare(`UPDATE lf_blobs SET created_at = ?, updated_at = ?`)
        .bind('2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')
        .run();

      expect(await svc.sweepPurgeable(500, new Date('2030-01-01T00:00:00.000Z'))).toBe(0);
      expect(await svc.getBlob(HID, 'b1')).not.toBeNull();
    });

    it('collects abandoned pending uploads that no ledger row will ever reference', async () => {
      const svc = service();
      await upload('orphan', [chunk(4, 16)]);
      const abandonedAt = new Date('2026-01-01T00:00:00.000Z');
      await testEnv.DB.prepare(`UPDATE lf_blobs SET updated_at = ? WHERE blob_id = ?`)
        .bind(abandonedAt.toISOString(), 'orphan')
        .run();

      const later = new Date(abandonedAt.getTime() + BLOB_PENDING_TTL_MS + 1000);
      expect(await svc.sweepPurgeable(500, later)).toBe(1);
      expect(await svc.getBlob(HID, 'orphan')).toBeNull();
    });

    it('leaves a pending upload alone inside its grace window (a slow resume is not an orphan)', async () => {
      const svc = service();
      await upload('slow', [chunk(4, 16)]);
      const startedAt = new Date('2026-01-01T00:00:00.000Z');
      await testEnv.DB.prepare(`UPDATE lf_blobs SET updated_at = ? WHERE blob_id = ?`)
        .bind(startedAt.toISOString(), 'slow')
        .run();

      const stillEarly = new Date(startedAt.getTime() + BLOB_PENDING_TTL_MS - 60_000);
      expect(await svc.sweepPurgeable(500, stillEarly)).toBe(0);
      expect(await svc.getBlob(HID, 'slow')).not.toBeNull();
    });

    it('bounds the sweep by `limit` so one tick cannot run away', async () => {
      const svc = service();
      const deletedAt = new Date('2026-01-01T00:00:00.000Z');
      for (const id of ['b1', 'b2', 'b3']) {
        await upload(id, [chunk(1, 8)]);
        await svc.finalize({ householdId: HID, blobId: id, chunkCount: 1 });
        await svc.tombstone(HID, id, deletedAt);
      }
      const after = new Date(deletedAt.getTime() + BLOB_TOMBSTONE_GRACE_MS + 1000);
      expect(await svc.sweepPurgeable(2, after)).toBe(2);
      expect(await svc.sweepPurgeable(500, after)).toBe(1);
    });
  });
});
