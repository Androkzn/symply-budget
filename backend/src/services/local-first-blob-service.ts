/**
 * House V2 encrypted blob channel — server half (plan §8, stage H6).
 *
 * Budget never needed this: it has one blob-bearing table (wish media) whose
 * bytes deliberately never sync. House has 25, and several of them ARE the
 * feature — appliance manuals, contractor documents, visit recordings, progress
 * photos. "Invisible on your partner's phone" is a defect, not a trade.
 *
 * The Worker's entire job here is authz + streaming. It never parses a chunk
 * body, never learns a mime type or filename, and never sees the plaintext
 * sha256 — the client seals each chunk under a per-blob content key derived from
 * the household HDK, and the ledger row (itself encrypted) carries the metadata.
 * Everything this service stores is either a count, a byte size, or a key epoch.
 *
 * Bucket is `REPORTS_BUCKET` under the `lf-blob/` prefix, mirroring how
 * checkpoints ride `lf-checkpoint/` on the same bucket (plan §8: "Do not add a
 * new bucket in H6"). Lambda report processing must never list or parse
 * `lf-blob/` keys.
 */
import type { Env } from '../types';

import { CHECKPOINT_TTL_MS } from './local-first-checkpoint-service';

const R2_PREFIX = 'lf-blob';

/**
 * Per-chunk ciphertext cap. The client seals 350_000-byte plaintext slices
 * (`BLOB_PLAINTEXT_CHUNK`), so a chunk is 350_028 bytes on the wire — nonce(12)
 * + ciphertext + GCM tag(16). The cap leaves headroom without ever approaching
 * the 512_000 base64 mailbox bound the rest of the protocol is sized against.
 *
 * Deliberately NOT R2 multipart: its minimum part size is 5 MiB and these
 * chunks are ~0.35 MB, so multipart cannot express this upload at all.
 */
export const BLOB_MAX_CHUNK_CIPHERTEXT_BYTES = 384_000;

/** ~1.4 GB of plaintext in one blob — far past any attachment House accepts. */
export const BLOB_MAX_CHUNK_COUNT = 4_096;

/**
 * Q5, as recommended in the plan: soft warn at 2 GB, hard stop at 5 GB, per
 * household. The client surfaces the warn in Settings; the hard stop is
 * enforced here, because a client-only limit is not a limit.
 */
export const BLOB_QUOTA_SOFT_BYTES = 2 * 1024 * 1024 * 1024;
export const BLOB_QUOTA_HARD_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * Q4: retention is tombstone + watermark, never a fixed TTL — "a TTL silently
 * deletes a photo the user still has a row for". The server cannot see the
 * ledger, so the watermark it can actually enforce is the checkpoint lifetime:
 * a checkpoint generation published before the delete stays servable for
 * `CHECKPOINT_TTL_MS`, and a device bootstrapping from it gets the row alive.
 * Purging earlier than that would break a legitimate bootstrap.
 */
export const BLOB_TOMBSTONE_GRACE_MS = CHECKPOINT_TTL_MS;

/**
 * An upload that stops mid-flight leaves `pending` chunks that nothing will ever
 * tombstone — there is no ledger row referencing them. Without this they are a
 * permanent R2 leak. A week is long enough that a genuinely resumed upload is
 * never collected (resume reuses the same blobId and bumps `updated_at`).
 */
export const BLOB_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type BlobStatus = 'pending' | 'complete' | 'tombstoned';

export type BlobRow = {
  household_id: string;
  blob_id: string;
  key_epoch: number;
  chunk_count: number;
  cipher_bytes: number;
  status: BlobStatus;
  created_at: string;
  updated_at: string;
  tombstoned_at: string | null;
  purge_after: string | null;
};

export type BlobChunkRow = {
  household_id: string;
  blob_id: string;
  chunk_index: number;
  chunk_count: number;
  r2_key: string;
  size_bytes: number;
  created_at: string;
};

export type BlobUsage = {
  blobCount: number;
  cipherBytes: number;
  softLimitBytes: number;
  hardLimitBytes: number;
  overSoftLimit: boolean;
};

/** Thrown when a household's live ciphertext would exceed the hard cap. */
export class BlobQuotaExceededError extends Error {
  constructor(
    readonly usedBytes: number,
    readonly limitBytes: number,
  ) {
    super('quota_exceeded');
    this.name = 'BlobQuotaExceededError';
  }
}

/** Thrown by `finalize` when chunks are missing — the blob stays `pending`. */
export class BlobIncompleteError extends Error {
  constructor(
    readonly present: number,
    readonly expected: number,
  ) {
    super('incomplete');
    this.name = 'BlobIncompleteError';
  }
}

function chunkKey(householdId: string, blobId: string, index: number): string {
  return `${R2_PREFIX}/${householdId}/${blobId}/${index}`;
}

export class LocalFirstBlobService {
  constructor(private readonly env: Env) {}

  /**
   * Store one sealed chunk. Idempotent on (household, blob, index): a retry
   * overwrites the same R2 key and upserts the same row.
   *
   * The client is required to re-send the byte-identical envelope it stored
   * locally rather than re-sealing, because re-sealing would mint a fresh nonce
   * for the same (contentKey, chunkIndex) — a GCM nonce-reuse bug that leaks the
   * XOR of two plaintexts. The server cannot detect that (every chunk is opaque
   * to it), which is exactly why the rule lives in the client's pending manifest
   * and is asserted by `blobResume` tests rather than here.
   */
  async putChunk(input: {
    householdId: string;
    blobId: string;
    keyEpoch: number;
    chunkIndex: number;
    chunkCount: number;
    ciphertext: ArrayBuffer;
  }): Promise<{ row: BlobChunkRow; usage: BlobUsage }> {
    const bytes = new Uint8Array(input.ciphertext);
    const now = new Date().toISOString();

    const existing = await this.env.DB.prepare(
      `SELECT size_bytes FROM lf_blob_chunks
       WHERE household_id = ? AND blob_id = ? AND chunk_index = ?`,
    )
      .bind(input.householdId, input.blobId, input.chunkIndex)
      .first<{ size_bytes: number }>();
    const previousSize = Number(existing?.size_bytes ?? 0);
    const delta = bytes.byteLength - previousSize;

    // Quota is checked BEFORE the R2 write, so an over-quota upload never costs
    // storage. Checked against the delta so a retry of an already-stored chunk
    // cannot be refused by a household sitting exactly at the cap.
    if (delta > 0) {
      const usage = await this.usage(input.householdId);
      if (usage.cipherBytes + delta > BLOB_QUOTA_HARD_BYTES) {
        throw new BlobQuotaExceededError(usage.cipherBytes, BLOB_QUOTA_HARD_BYTES);
      }
    }

    const key = chunkKey(input.householdId, input.blobId, input.chunkIndex);
    await this.env.REPORTS_BUCKET.put(key, bytes, {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: {
        householdId: input.householdId,
        blobId: input.blobId,
        chunkIndex: String(input.chunkIndex),
      },
    });

    const row: BlobChunkRow = {
      household_id: input.householdId,
      blob_id: input.blobId,
      chunk_index: input.chunkIndex,
      chunk_count: input.chunkCount,
      r2_key: key,
      size_bytes: bytes.byteLength,
      created_at: now,
    };
    await this.env.DB.prepare(
      `INSERT INTO lf_blob_chunks
        (household_id, blob_id, chunk_index, chunk_count, r2_key, size_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(household_id, blob_id, chunk_index) DO UPDATE SET
         chunk_count = excluded.chunk_count,
         r2_key = excluded.r2_key,
         size_bytes = excluded.size_bytes`,
    )
      .bind(
        row.household_id,
        row.blob_id,
        row.chunk_index,
        row.chunk_count,
        row.r2_key,
        row.size_bytes,
        row.created_at,
      )
      .run();

    // Tombstoning is terminal. A chunk arriving for a tombstoned blob is a peer
    // that has not yet synced the delete; the bytes are stored (the PUT is
    // idempotent either way) but the status is left alone, so the watermark
    // sweep still collects them. Reviving here would strand bytes that nothing
    // will ever tombstone again — the client only issues DELETE once, when the
    // ledger row dies. A genuine re-attach mints a fresh blobId, so a legitimate
    // upload never lands on a tombstoned row.
    await this.env.DB.prepare(
      `INSERT INTO lf_blobs
        (household_id, blob_id, key_epoch, chunk_count, cipher_bytes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(household_id, blob_id) DO UPDATE SET
         key_epoch = excluded.key_epoch,
         chunk_count = excluded.chunk_count,
         cipher_bytes = MAX(0, lf_blobs.cipher_bytes + ?),
         updated_at = excluded.updated_at`,
    )
      .bind(
        input.householdId,
        input.blobId,
        input.keyEpoch,
        input.chunkCount,
        bytes.byteLength,
        now,
        now,
        delta,
      )
      .run();

    return { row, usage: await this.usage(input.householdId) };
  }

  /**
   * Flip `pending` → `complete` once every chunk has landed. Peers must not read
   * a partially uploaded blob: they would verify the plaintext hash against a
   * truncated file and surface a corruption error for what is really an upload
   * still in progress.
   *
   * A tombstoned blob is never finalized back to life — see `putChunk`.
   */
  async finalize(input: {
    householdId: string;
    blobId: string;
    chunkCount: number;
  }): Promise<BlobRow> {
    const countRow = await this.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM lf_blob_chunks WHERE household_id = ? AND blob_id = ?`,
    )
      .bind(input.householdId, input.blobId)
      .first<{ n: number }>();
    const present = Number(countRow?.n ?? 0);
    if (present < input.chunkCount) {
      throw new BlobIncompleteError(present, input.chunkCount);
    }

    await this.env.DB.prepare(
      `UPDATE lf_blobs
       SET status = 'complete', chunk_count = ?, updated_at = ?
       WHERE household_id = ? AND blob_id = ? AND status != 'tombstoned'`,
    )
      .bind(input.chunkCount, new Date().toISOString(), input.householdId, input.blobId)
      .run();

    const row = await this.getBlob(input.householdId, input.blobId);
    if (!row) throw new BlobIncompleteError(present, input.chunkCount);
    return row;
  }

  async getBlob(householdId: string, blobId: string): Promise<BlobRow | null> {
    const row = await this.env.DB.prepare(
      `SELECT * FROM lf_blobs WHERE household_id = ? AND blob_id = ?`,
    )
      .bind(householdId, blobId)
      .first<BlobRow>();
    return row ?? null;
  }

  async getChunk(
    householdId: string,
    blobId: string,
    index: number,
  ): Promise<{ bytes: ArrayBuffer; row: BlobChunkRow } | null> {
    const row = await this.env.DB.prepare(
      `SELECT * FROM lf_blob_chunks
       WHERE household_id = ? AND blob_id = ? AND chunk_index = ?`,
    )
      .bind(householdId, blobId, index)
      .first<BlobChunkRow>();
    if (!row) return null;
    const object = await this.env.REPORTS_BUCKET.get(row.r2_key);
    if (!object) return null;
    return { bytes: await object.arrayBuffer(), row };
  }

  /**
   * Mark the blob deleted. Bytes are NOT removed here — `sweepPurgeable` does
   * that once `purge_after` passes, so an offline peer bootstrapping from a
   * checkpoint older than the delete still resolves its content.
   */
  async tombstone(householdId: string, blobId: string, now = new Date()): Promise<BlobRow | null> {
    const iso = now.toISOString();
    const purgeAfter = new Date(now.getTime() + BLOB_TOMBSTONE_GRACE_MS).toISOString();
    await this.env.DB.prepare(
      `UPDATE lf_blobs
       SET status = 'tombstoned', tombstoned_at = ?, purge_after = ?, updated_at = ?
       WHERE household_id = ? AND blob_id = ?`,
    )
      .bind(iso, purgeAfter, iso, householdId, blobId)
      .run();
    return this.getBlob(householdId, blobId);
  }

  /**
   * Live ciphertext for a household. Tombstoned blobs are excluded: they are
   * retention cost the platform chose to carry for correctness, and counting
   * them would leave a member unable to upload for 90 days after clearing space.
   * The accepted consequence is that delete-then-reupload can transiently hold
   * up to 2× the cap in R2.
   */
  async usage(householdId: string): Promise<BlobUsage> {
    const row = await this.env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(cipher_bytes), 0) AS bytes
       FROM lf_blobs
       WHERE household_id = ? AND status != 'tombstoned'`,
    )
      .bind(householdId)
      .first<{ n: number; bytes: number }>();
    const cipherBytes = Number(row?.bytes ?? 0);
    return {
      blobCount: Number(row?.n ?? 0),
      cipherBytes,
      softLimitBytes: BLOB_QUOTA_SOFT_BYTES,
      hardLimitBytes: BLOB_QUOTA_HARD_BYTES,
      overSoftLimit: cipherBytes > BLOB_QUOTA_SOFT_BYTES,
    };
  }

  /**
   * Cron sweep. Two collections, both bounded by `limit`:
   *  - tombstoned blobs whose watermark has passed
   *  - `pending` blobs abandoned mid-upload past `BLOB_PENDING_TTL_MS`
   *
   * Returns the number of R2 objects removed, matching the mailbox and
   * checkpoint sweeps' contract so the cron log line reads the same way.
   */
  async sweepPurgeable(limit = 500, now = new Date()): Promise<number> {
    const iso = now.toISOString();
    const abandonedBefore = new Date(now.getTime() - BLOB_PENDING_TTL_MS).toISOString();

    const { results: purgeable } = await this.env.DB.prepare(
      `SELECT household_id, blob_id FROM lf_blobs
       WHERE (status = 'tombstoned' AND purge_after IS NOT NULL AND purge_after <= ?)
          OR (status = 'pending' AND updated_at <= ?)
       LIMIT ?`,
    )
      .bind(iso, abandonedBefore, limit)
      .all<{ household_id: string; blob_id: string }>();

    let removed = 0;
    for (const blob of purgeable ?? []) {
      const { results: chunks } = await this.env.DB.prepare(
        `SELECT r2_key FROM lf_blob_chunks WHERE household_id = ? AND blob_id = ?`,
      )
        .bind(blob.household_id, blob.blob_id)
        .all<{ r2_key: string }>();
      for (const chunk of chunks ?? []) {
        await this.env.REPORTS_BUCKET.delete(chunk.r2_key);
        removed += 1;
      }
      await this.env.DB.prepare(
        `DELETE FROM lf_blob_chunks WHERE household_id = ? AND blob_id = ?`,
      )
        .bind(blob.household_id, blob.blob_id)
        .run();
      await this.env.DB.prepare(`DELETE FROM lf_blobs WHERE household_id = ? AND blob_id = ?`)
        .bind(blob.household_id, blob.blob_id)
        .run();
    }
    return removed;
  }
}
