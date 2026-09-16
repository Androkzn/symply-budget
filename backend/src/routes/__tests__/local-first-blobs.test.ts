/**
 * `/v2/households/:id/blobs/**` — route coverage for the H6 encrypted blob
 * channel (House V2 plan §8).
 *
 * The plan's verification list for H6 is mostly about the seams this suite owns:
 *  - **the Worker never sees plaintext** — the stored R2 object is byte-equal to
 *    the ciphertext the client sent and nothing in the route parses it;
 *  - **authz** — a non-member is 403 on every verb, including the read paths
 *    (the mailbox shipped with an ownership hole once already; §H0);
 *  - **an interrupted upload resumes** without duplicate chunks;
 *  - **a partial blob is not readable** — a peer must be able to tell "still
 *    uploading" from "gone";
 *  - **oversize is refused** before it reaches R2.
 *
 * Mirrors the harness in `appliances.test.ts`: `cloudflare:test` env, a
 * jose-signed JWT whose `sub` becomes `userId`, real D1 and R2.
 */
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import { authMiddleware } from '../../middleware/auth';
import { errorHandler } from '../../middleware/error-handler';
import { BLOB_MAX_CHUNK_CIPHERTEXT_BYTES } from '../../services/local-first-blob-service';
import type { Env } from '../../types';
import blobRoutes from '../local-first-blobs';

const testEnv = env as unknown as Env;
const MEMBER = 'u_blob_member';
const PEER = 'u_blob_peer';
const OUTSIDER = 'u_blob_outsider';
const HID = 'hh_blob_routes';

function app() {
  const instance = new Hono<{ Bindings: Env }>();
  instance.use('*', errorHandler());
  instance.use('/v2/*', authMiddleware());
  instance.route('/v2', blobRoutes);
  return instance;
}

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(testEnv.JWT_SECRET || 'test-jwt-secret-32-chars-minimum');
  return new jose.SignJWT({
    sub: userId,
    email: `${userId}@example.com`,
    email_verified: true,
  } as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(testEnv.JWT_ISSUER || 'simple-house')
    .setAudience(testEnv.JWT_AUDIENCE || 'simple-house-app')
    .sign(secret);
}

async function createTables(): Promise<void> {
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS lf_households (id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL, display_name TEXT NOT NULL, key_epoch INTEGER NOT NULL DEFAULT 1, security_revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS lf_memberships (id TEXT PRIMARY KEY NOT NULL, household_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, revoked_at TEXT, UNIQUE (household_id, user_id))`,
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS lf_blobs (household_id TEXT NOT NULL, blob_id TEXT NOT NULL, key_epoch INTEGER NOT NULL, chunk_count INTEGER NOT NULL, cipher_bytes INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, tombstoned_at TEXT, purge_after TEXT, PRIMARY KEY (household_id, blob_id))`,
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS lf_blob_chunks (household_id TEXT NOT NULL, blob_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, chunk_count INTEGER NOT NULL, r2_key TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, PRIMARY KEY (household_id, blob_id, chunk_index))`,
  );
}

async function seedHousehold(): Promise<void> {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO lf_households (id, owner_user_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(HID, MEMBER, 'Blob House', now, now)
    .run();
  for (const [id, user, role] of [
    ['mem_owner', MEMBER, 'OWNER'],
    ['mem_peer', PEER, 'ADULT'],
  ] as const) {
    await testEnv.DB.prepare(
      `INSERT INTO lf_memberships (id, household_id, user_id, role, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`,
    )
      .bind(id, HID, user, role, now)
      .run();
  }
}

async function reset(): Promise<void> {
  await testEnv.DB.exec('DELETE FROM lf_blob_chunks');
  await testEnv.DB.exec('DELETE FROM lf_blobs');
  await testEnv.DB.exec('DELETE FROM lf_memberships');
  await testEnv.DB.exec('DELETE FROM lf_households');
  const listed = await testEnv.REPORTS_BUCKET.list({ prefix: 'lf-blob/' });
  for (const object of listed.objects) {
    await testEnv.REPORTS_BUCKET.delete(object.key);
  }
}

/** Stand-in for a sealed chunk: opaque, high-entropy-looking bytes. */
function sealed(seed: number, length = 96): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (seed * 31 + i * 17) % 256;
  return out;
}

async function putChunk(
  token: string,
  input: {
    blobId: string;
    index: number;
    chunkCount: number;
    body: Uint8Array;
    keyEpoch?: number;
    householdId?: string;
  },
): Promise<Response> {
  return app().request(
    `http://x/v2/households/${input.householdId ?? HID}/blobs/${input.blobId}/chunks/${input.index}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'X-LF-Chunk-Count': String(input.chunkCount),
        'X-LF-Key-Epoch': String(input.keyEpoch ?? 1),
      },
      body: input.body,
    },
    testEnv,
  );
}

async function finalize(token: string, blobId: string, chunkCount: number): Promise<Response> {
  return app().request(
    `http://x/v2/households/${HID}/blobs/${blobId}/finalize`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunkCount }),
    },
    testEnv,
  );
}

async function getChunk(token: string, blobId: string, index: number): Promise<Response> {
  return app().request(
    `http://x/v2/households/${HID}/blobs/${blobId}/chunks/${index}`,
    { headers: { Authorization: `Bearer ${token}` } },
    testEnv,
  );
}

describe('/v2 blob channel — authorization', () => {
  beforeEach(async () => {
    await createTables();
    await reset();
    await seedHousehold();
  });

  it('401s without a token', async () => {
    const res = await app().request(
      `http://x/v2/households/${HID}/blobs/b1/chunks/0`,
      { method: 'PUT', body: sealed(1) },
      testEnv,
    );
    expect(res.status).toBe(401);
  });

  it.each([
    ['upload', (t: string) => putChunk(t, { blobId: 'b1', index: 0, chunkCount: 1, body: sealed(1) })],
    ['finalize', (t: string) => finalize(t, 'b1', 1)],
    ['read chunk', (t: string) => getChunk(t, 'b1', 0)],
    [
      'read manifest',
      (t: string) =>
        app().request(
          `http://x/v2/households/${HID}/blobs/b1`,
          { headers: { Authorization: `Bearer ${t}` } },
          testEnv,
        ),
    ],
    [
      'delete',
      (t: string) =>
        app().request(
          `http://x/v2/households/${HID}/blobs/b1`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } },
          testEnv,
        ),
    ],
    [
      'usage',
      (t: string) =>
        app().request(
          `http://x/v2/households/${HID}/blobs-usage`,
          { headers: { Authorization: `Bearer ${t}` } },
          testEnv,
        ),
    ],
  ])('403s a non-member on %s', async (_label, call) => {
    const res = await call(await mintToken(OUTSIDER));
    expect(res.status).toBe(403);
  });

  it('lets a second member of the household read what the first uploaded', async () => {
    const owner = await mintToken(MEMBER);
    await putChunk(owner, { blobId: 'b1', index: 0, chunkCount: 1, body: sealed(5) });
    await finalize(owner, 'b1', 1);

    const res = await getChunk(await mintToken(PEER), 'b1', 0);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(sealed(5));
  });

  it('403s a revoked member', async () => {
    await testEnv.DB.prepare(`UPDATE lf_memberships SET status = 'revoked' WHERE user_id = ?`)
      .bind(PEER)
      .run();
    const res = await getChunk(await mintToken(PEER), 'b1', 0);
    expect(res.status).toBe(403);
  });
});

describe('/v2 blob channel — round trip', () => {
  beforeEach(async () => {
    await createTables();
    await reset();
    await seedHousehold();
  });

  it('returns every chunk byte-identical, and never parses the body', async () => {
    const token = await mintToken(MEMBER);
    const chunks = [sealed(1), sealed(2), sealed(3)];
    for (let i = 0; i < chunks.length; i += 1) {
      const res = await putChunk(token, {
        blobId: 'doc',
        index: i,
        chunkCount: chunks.length,
        body: chunks[i]!,
      });
      expect(res.status).toBe(201);
    }
    expect((await finalize(token, 'doc', chunks.length)).status).toBe(200);

    for (let i = 0; i < chunks.length; i += 1) {
      const res = await getChunk(token, 'doc', i);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(chunks[i]!);
    }
  });

  it('stores ciphertext, not plaintext — the R2 object equals what the client sent', async () => {
    const token = await mintToken(MEMBER);
    const body = sealed(42, 256);
    await putChunk(token, { blobId: 'doc', index: 0, chunkCount: 1, body });

    const object = await testEnv.REPORTS_BUCKET.get(`lf-blob/${HID}/doc/0`);
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(body);
  });

  it('carries the key epoch back on the manifest and the chunk headers', async () => {
    const token = await mintToken(MEMBER);
    await putChunk(token, { blobId: 'doc', index: 0, chunkCount: 1, body: sealed(1), keyEpoch: 3 });
    await finalize(token, 'doc', 1);

    const manifest = await app().request(
      `http://x/v2/households/${HID}/blobs/doc`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv,
    );
    expect(await manifest.json()).toMatchObject({ keyEpoch: 3, chunkCount: 1, status: 'complete' });
    expect((await getChunk(token, 'doc', 0)).headers.get('X-LF-Key-Epoch')).toBe('3');
  });

  it('reports usage the Settings card can render', async () => {
    const token = await mintToken(MEMBER);
    await putChunk(token, { blobId: 'doc', index: 0, chunkCount: 1, body: sealed(1, 128) });

    const res = await app().request(
      `http://x/v2/households/${HID}/blobs-usage`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv,
    );
    expect(await res.json()).toMatchObject({
      blobCount: 1,
      cipherBytes: 128,
      overSoftLimit: false,
    });
  });
});

describe('/v2 blob channel — partial and interrupted uploads', () => {
  beforeEach(async () => {
    await createTables();
    await reset();
    await seedHousehold();
  });

  it('409s a read of a blob that is still uploading, rather than 404ing it', async () => {
    const token = await mintToken(MEMBER);
    await putChunk(token, { blobId: 'doc', index: 0, chunkCount: 2, body: sealed(1) });

    const res = await getChunk(token, 'doc', 0);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'incomplete' } });
  });

  it('409s finalize while a chunk is missing, and reports the shortfall', async () => {
    const token = await mintToken(MEMBER);
    await putChunk(token, { blobId: 'doc', index: 0, chunkCount: 3, body: sealed(1) });

    const res = await finalize(token, 'doc', 3);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'incomplete', expected: 3, present: 1 } });
  });

  it('resumes an interrupted upload without duplicating chunks', async () => {
    const token = await mintToken(MEMBER);
    const chunks = [sealed(1), sealed(2), sealed(3)];
    // Upload 0 and 1, then "crash".
    await putChunk(token, { blobId: 'doc', index: 0, chunkCount: 3, body: chunks[0]! });
    await putChunk(token, { blobId: 'doc', index: 1, chunkCount: 3, body: chunks[1]! });
    // Resume re-sends 1 (byte-identical, as the client's pending manifest
    // requires) and continues with 2.
    await putChunk(token, { blobId: 'doc', index: 1, chunkCount: 3, body: chunks[1]! });
    await putChunk(token, { blobId: 'doc', index: 2, chunkCount: 3, body: chunks[2]! });

    expect((await finalize(token, 'doc', 3)).status).toBe(200);
    const stored = await testEnv.DB.prepare(
      `SELECT COUNT(*) AS n FROM lf_blob_chunks WHERE household_id = ? AND blob_id = ?`,
    )
      .bind(HID, 'doc')
      .first<{ n: number }>();
    expect(Number(stored?.n)).toBe(3);
  });

  it('404s a chunk index that was never uploaded', async () => {
    const token = await mintToken(MEMBER);
    await putChunk(token, { blobId: 'doc', index: 0, chunkCount: 1, body: sealed(1) });
    await finalize(token, 'doc', 1);
    // Widen the manifest so the index is in range but the object is absent.
    await testEnv.DB.prepare(`UPDATE lf_blobs SET chunk_count = 2 WHERE blob_id = ?`)
      .bind('doc')
      .run();

    expect((await getChunk(token, 'doc', 1)).status).toBe(404);
  });
});

describe('/v2 blob channel — validation and limits', () => {
  beforeEach(async () => {
    await createTables();
    await reset();
    await seedHousehold();
  });

  it('413s a chunk over the per-chunk cap, before it reaches R2', async () => {
    const token = await mintToken(MEMBER);
    const res = await putChunk(token, {
      blobId: 'huge',
      index: 0,
      chunkCount: 1,
      body: new Uint8Array(BLOB_MAX_CHUNK_CIPHERTEXT_BYTES + 1),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: 'payload_too_large' } });
    expect(await testEnv.REPORTS_BUCKET.get(`lf-blob/${HID}/huge/0`)).toBeNull();
  });

  it('400s an empty body', async () => {
    const token = await mintToken(MEMBER);
    const res = await putChunk(token, {
      blobId: 'empty',
      index: 0,
      chunkCount: 1,
      body: new Uint8Array(0),
    });
    expect(res.status).toBe(400);
  });

  it('400s when the chunk-count header is missing', async () => {
    const token = await mintToken(MEMBER);
    const res = await app().request(
      `http://x/v2/households/${HID}/blobs/doc/chunks/0`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
        },
        body: sealed(1),
      },
      testEnv,
    );
    expect(res.status).toBe(400);
  });

  it('400s an index at or past the declared chunk count', async () => {
    const token = await mintToken(MEMBER);
    const res = await putChunk(token, { blobId: 'doc', index: 3, chunkCount: 3, body: sealed(1) });
    expect(res.status).toBe(400);
  });
});

describe('/v2 blob channel — delete', () => {
  beforeEach(async () => {
    await createTables();
    await reset();
    await seedHousehold();
  });

  it('makes the blob unreachable while keeping the bytes until the watermark', async () => {
    const token = await mintToken(MEMBER);
    await putChunk(token, { blobId: 'doc', index: 0, chunkCount: 1, body: sealed(1) });
    await finalize(token, 'doc', 1);

    const del = await app().request(
      `http://x/v2/households/${HID}/blobs/doc`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      testEnv,
    );
    expect(del.status).toBe(200);
    expect(await del.json()).toMatchObject({ status: 'tombstoned' });

    expect((await getChunk(token, 'doc', 0)).status).toBe(404);
    // The bytes are still there — the sweep, not the delete, reclaims them.
    expect(await testEnv.REPORTS_BUCKET.get(`lf-blob/${HID}/doc/0`)).not.toBeNull();
  });

  it('404s a delete of a blob that never existed', async () => {
    const token = await mintToken(MEMBER);
    const res = await app().request(
      `http://x/v2/households/${HID}/blobs/ghost`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      testEnv,
    );
    expect(res.status).toBe(404);
  });
});
