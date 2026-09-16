/**
 * House V2 encrypted blob channel — routes (plan §8, stage H6).
 *
 * Mounted into `local-first-v2.ts`, so it inherits that router's
 * `requireLocalFirstApi()` gate and `authMiddleware()` — do not mount it
 * directly on the app, or `/v2/households/:id/blobs/*` becomes an unauthed hole
 * in four production Workers at once.
 *
 * Contract, in one line: **the body is opaque**. Chunk PUT and GET move
 * `application/octet-stream` and this file never calls `.json()` on either.
 * Everything the routes decide — who may touch this household, whether the
 * chunk fits, whether the quota allows it — is decided from the URL, the
 * headers and D1.
 */
import { Hono, type Context } from 'hono';

import {
  BLOB_MAX_CHUNK_COUNT,
  BLOB_MAX_CHUNK_CIPHERTEXT_BYTES,
  BlobIncompleteError,
  BlobQuotaExceededError,
  LocalFirstBlobService,
} from '../services/local-first-blob-service';
import { LocalFirstControlService } from '../services/local-first-control-service';
import type { Env } from '../types';
import { ValidationError } from '../utils/errors';

const blobs = new Hono<{ Bindings: Env }>();

function userId(c: { get: (k: 'userId') => string | undefined }): string {
  const id = c.get('userId');
  if (!id) throw new ValidationError('Unauthorized');
  return id;
}

/**
 * Every route is membership-gated, not owner-gated: any member of the household
 * may attach a document and any member must be able to read one. Checkpoints are
 * owner-only because a checkpoint rewrites the shared bootstrap; a blob does not.
 */
async function denyNonMember(
  c: Context<{ Bindings: Env }>,
  householdId: string,
): Promise<Response | null> {
  const control = new LocalFirstControlService(c.env);
  try {
    await control.assertMember(householdId, userId(c));
  } catch (error) {
    if (error instanceof Error && error.message === 'not_a_member') {
      return c.json({ error: { code: 'forbidden', message: 'Not a member' } }, 403);
    }
    throw error;
  }
  return null;
}

function parseIndex(raw: string): number | null {
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0 || index >= BLOB_MAX_CHUNK_COUNT) return null;
  return index;
}

function parseChunkCount(raw: string | undefined): number | null {
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1 || count > BLOB_MAX_CHUNK_COUNT) return null;
  return count;
}

/**
 * Upload one sealed chunk.
 *
 * `chunkCount` and `keyEpoch` ride in headers rather than the body precisely so
 * the body can stay unparsed. A JSON envelope would force the Worker to buffer
 * and decode ciphertext for no reason, and would inflate every chunk by a third
 * in base64.
 */
blobs.put('/households/:householdId/blobs/:blobId/chunks/:index', async (c) => {
  const householdId = c.req.param('householdId');
  const denied = await denyNonMember(c, householdId);
  if (denied) return denied;

  const blobId = c.req.param('blobId');
  const index = parseIndex(c.req.param('index'));
  if (index === null) {
    return c.json({ error: { code: 'validation_error', message: 'index out of range' } }, 400);
  }
  const chunkCount = parseChunkCount(c.req.header('X-LF-Chunk-Count'));
  if (chunkCount === null) {
    return c.json(
      { error: { code: 'validation_error', message: 'X-LF-Chunk-Count required' } },
      400,
    );
  }
  if (index >= chunkCount) {
    return c.json({ error: { code: 'validation_error', message: 'index out of range' } }, 400);
  }
  const keyEpoch = Number(c.req.header('X-LF-Key-Epoch') ?? '1');
  if (!Number.isInteger(keyEpoch) || keyEpoch < 1) {
    return c.json({ error: { code: 'validation_error', message: 'X-LF-Key-Epoch invalid' } }, 400);
  }

  const ciphertext = await c.req.arrayBuffer();
  if (ciphertext.byteLength === 0) {
    return c.json({ error: { code: 'validation_error', message: 'empty chunk' } }, 400);
  }
  if (ciphertext.byteLength > BLOB_MAX_CHUNK_CIPHERTEXT_BYTES) {
    return c.json(
      {
        error: {
          code: 'payload_too_large',
          message: 'Blob chunk exceeds the per-chunk limit',
          limit: BLOB_MAX_CHUNK_CIPHERTEXT_BYTES,
          actual: ciphertext.byteLength,
        },
      },
      413,
    );
  }

  const service = new LocalFirstBlobService(c.env);
  try {
    const { usage } = await service.putChunk({
      householdId,
      blobId,
      keyEpoch,
      chunkIndex: index,
      chunkCount,
      ciphertext,
    });
    return c.json({ ok: true, chunkIndex: index, sizeBytes: ciphertext.byteLength, usage }, 201);
  } catch (error) {
    if (error instanceof BlobQuotaExceededError) {
      return c.json(
        {
          error: {
            code: 'quota_exceeded',
            message: 'Household attachment storage is full',
            limit: error.limitBytes,
            used: error.usedBytes,
          },
        },
        // 507, not 413: the chunk is fine, the household is out of room. A
        // client that reads 413 as "shrink and retry" would loop forever here.
        507,
      );
    }
    throw error;
  }
});

/** Mark every chunk uploaded, making the blob readable by peers. */
blobs.post('/households/:householdId/blobs/:blobId/finalize', async (c) => {
  const householdId = c.req.param('householdId');
  const denied = await denyNonMember(c, householdId);
  if (denied) return denied;

  const blobId = c.req.param('blobId');
  const body = (await c.req.json().catch(() => null)) as { chunkCount?: unknown } | null;
  const chunkCount = parseChunkCount(
    typeof body?.chunkCount === 'number' ? String(body.chunkCount) : undefined,
  );
  if (chunkCount === null) {
    return c.json({ error: { code: 'validation_error', message: 'chunkCount required' } }, 400);
  }

  try {
    const row = await new LocalFirstBlobService(c.env).finalize({
      householdId,
      blobId,
      chunkCount,
    });
    return c.json({
      blobId: row.blob_id,
      keyEpoch: row.key_epoch,
      chunkCount: row.chunk_count,
      cipherBytes: row.cipher_bytes,
      status: row.status,
    });
  } catch (error) {
    if (error instanceof BlobIncompleteError) {
      return c.json(
        {
          error: {
            code: 'incomplete',
            message: 'Not every chunk has been uploaded',
            expected: error.expected,
            present: error.present,
          },
        },
        409,
      );
    }
    throw error;
  }
});

/** Blob manifest — counts and sizes only; the metadata lives in the ledger row. */
blobs.get('/households/:householdId/blobs/:blobId', async (c) => {
  const householdId = c.req.param('householdId');
  const denied = await denyNonMember(c, householdId);
  if (denied) return denied;

  const row = await new LocalFirstBlobService(c.env).getBlob(householdId, c.req.param('blobId'));
  if (!row || row.status === 'tombstoned') {
    return c.json({ error: { code: 'not_found', message: 'No blob' } }, 404);
  }
  return c.json({
    blobId: row.blob_id,
    keyEpoch: row.key_epoch,
    chunkCount: row.chunk_count,
    cipherBytes: row.cipher_bytes,
    status: row.status,
    createdAt: row.created_at,
  });
});

/**
 * Fetch one sealed chunk as raw bytes.
 *
 * A `pending` blob 409s rather than 404s: the difference between "still
 * uploading" and "never existed" is the difference between a client that should
 * retry and one that should surface a broken attachment.
 */
blobs.get('/households/:householdId/blobs/:blobId/chunks/:index', async (c) => {
  const householdId = c.req.param('householdId');
  const denied = await denyNonMember(c, householdId);
  if (denied) return denied;

  const blobId = c.req.param('blobId');
  const index = parseIndex(c.req.param('index'));
  if (index === null) {
    return c.json({ error: { code: 'validation_error', message: 'index out of range' } }, 400);
  }

  const service = new LocalFirstBlobService(c.env);
  const blob = await service.getBlob(householdId, blobId);
  if (!blob || blob.status === 'tombstoned') {
    return c.json({ error: { code: 'not_found', message: 'No blob' } }, 404);
  }
  if (blob.status === 'pending') {
    return c.json({ error: { code: 'incomplete', message: 'Upload in progress' } }, 409);
  }

  const chunk = await service.getChunk(householdId, blobId, index);
  if (!chunk) {
    return c.json({ error: { code: 'not_found', message: 'Chunk missing' } }, 404);
  }
  return new Response(chunk.bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(chunk.row.size_bytes),
      'X-LF-Chunk-Count': String(blob.chunk_count),
      'X-LF-Key-Epoch': String(blob.key_epoch),
      // Ciphertext for a given (blobId, index) is immutable — the client is
      // forbidden from re-sealing under a fresh nonce — so it caches forever.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
});

/** Tombstone. Bytes survive until the watermark passes (see the service). */
blobs.delete('/households/:householdId/blobs/:blobId', async (c) => {
  const householdId = c.req.param('householdId');
  const denied = await denyNonMember(c, householdId);
  if (denied) return denied;

  const row = await new LocalFirstBlobService(c.env).tombstone(householdId, c.req.param('blobId'));
  if (!row) {
    return c.json({ error: { code: 'not_found', message: 'No blob' } }, 404);
  }
  return c.json({ blobId: row.blob_id, status: row.status, purgeAfter: row.purge_after });
});

/** Quota rollup for the Settings card (Q5 soft warn / hard stop). */
blobs.get('/households/:householdId/blobs-usage', async (c) => {
  const householdId = c.req.param('householdId');
  const denied = await denyNonMember(c, householdId);
  if (denied) return denied;

  return c.json(await new LocalFirstBlobService(c.env).usage(householdId));
});

export default blobs;
