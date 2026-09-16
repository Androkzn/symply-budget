/**
 * Symply Health — the `/health/files*` half of `src/routes/health-assets.ts`,
 * driven through the real Hono router against live miniflare D1 **and** R2.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `health-assets.test.ts`.
 * That suite covers all three P2 `assets` groups (files + widget + fridge) at
 * the level of "the contract holds". This one is the FILES group's own
 * exhaustive sweep: six handlers over four paths, every branch of each, and the
 * R2 round-trip in both directions. Keeping it apart means the files surface can
 * be run — and read — on its own:
 *
 *     npx vitest run src/routes/__tests__/health-files.test.ts
 *
 * so it opens with a compact brand-gate + auth slice restricted to the four file
 * paths (the files-only projection of ASSET-001/005) rather than assuming the
 * broader suite ran first.
 *
 * THE THING TO KNOW ABOUT THIS SURFACE: **no client calls it.** `grep -rn
 * "/health/files" src/ app/` is empty — there is no files screen, no
 * `src/api/healthFiles.ts`, and the body-photo feature that would use it is
 * explicitly deferred. So the Worker contract is the ONLY contract, and every
 * guarantee below has to be held here because nothing downstream re-checks it.
 * The posture guard for that gap lives in
 * `src/features/health/__tests__/areas/files.posture.test.ts`.
 *
 * The rules this domain exists to enforce, restated because they are what most
 * of the assertions below are actually about:
 *
 *  1. `storage_key` never leaves the Worker, and the client never gets to
 *     CHOOSE one either — a leaked or attacker-picked key on a `body_photo` is
 *     a privacy incident, not a cosmetic bug.
 *  2. The bytes are served back with the mime type that was ALLOW-LISTED at
 *     reservation time, never one the uploader asserted later.
 *  3. Delete means the pixels are gone, even though the row survives as a
 *     tombstone for the sync cursor.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ALLOWED_MIME_TYPES,
  HealthAssetsService,
  MAX_FILE_BYTES,
  storageKeyFor,
} from '../../services/health-assets-service';
import type { Env } from '../../types';
import healthAssetsRoutes from '../health-assets';

import {
  createHealthAssetTables,
  createHealthTables,
  resetHealthAssetTables,
  resetHealthTables,
  seedHealthUsers,
} from './health-test-helpers';

const testEnv = env as unknown as Env;

// The pool env is House (wrangler.toml); each brand gets its own copy so one
// request can be replayed across the fleet.
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;
const HOUSE_ENV = { ...testEnv, APP_BRAND: 'symply-house' } as Env;
const BUDGET_ENV = { ...testEnv, APP_BRAND: 'symply-budget' } as Env;
const KAIZEN_ENV = { ...testEnv, APP_BRAND: 'symply-kaizen' } as Env;

const UID_A = 'u_files_alice';
const UID_B = 'u_files_bob';

/**
 * Deliberately NOT valid image bytes: a NUL, a 0xFF and a byte above the
 * ASCII range. If anything on the path ever decoded the body as text, this
 * pattern would come back mangled where a plain JPEG header might survive.
 */
const BINARY = new Uint8Array([0x00, 0xff, 0x89, 0x50, 0x00, 0x0d, 0x0a, 0x1a, 0x7f, 0x80]);

let tokenA = '';
let tokenB = '';

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(testEnv.JWT_SECRET ?? 'test-jwt-secret-32-chars-minimum');
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

/** Mirrors the `app.route('/health', healthAssetsRoutes)` mount in src/index.ts. */
function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthAssetsRoutes);
  return app;
}

async function call(
  method: string,
  path: string,
  opts: {
    token?: string | null;
    body?: unknown;
    rawBody?: BodyInit;
    /** `null` sends NO Content-Type header at all — a real client mistake. */
    contentType?: string | null;
    brandEnv?: Env;
  } = {}
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.contentType !== null) headers['Content-Type'] = opts.contentType ?? 'application/json';
  const token = opts.token === undefined ? tokenA : opts.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  const body =
    opts.rawBody !== undefined
      ? opts.rawBody
      : opts.body === undefined
        ? undefined
        : JSON.stringify(opts.body);
  return mkApp().request(`/health${path}`, { method, headers, body }, opts.brandEnv ?? HEALTH_ENV);
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface FileMeta {
  id: string;
  file_name: string;
  file_type: string;
  mime_type: string;
  file_size: number;
  category: string | null;
  metadata: string | null;
  content_path: string;
  created_at: string;
  updated_at: string;
}

interface UploadEnvelope {
  file: FileMeta;
  upload: { upload_url: null; method: string; path: string; max_size_bytes: number };
}

type Reservation = Partial<{
  file_name: string;
  file_type: string;
  mime_type: string;
  file_size: number;
  category: string;
  metadata: Record<string, unknown>;
}>;

async function reserve(token: string, overrides: Reservation = {}): Promise<UploadEnvelope> {
  const res = await call('POST', '/files', {
    token,
    body: {
      file_name: 'shot.jpg',
      file_type: 'photo',
      mime_type: 'image/jpeg',
      file_size: 1024,
      ...overrides,
    },
  });
  expect(res.status).toBe(201);
  return json<UploadEnvelope>(res);
}

/** Reserve + PUT the bytes, i.e. a file that really exists in R2. */
async function upload(
  token: string,
  overrides: Reservation = {},
  bytes: Uint8Array = BINARY
): Promise<FileMeta> {
  const { file } = await reserve(token, overrides);
  const res = await call('PUT', `/files/${file.id}/content`, {
    token,
    rawBody: bytes,
    contentType: 'application/octet-stream',
  });
  expect(res.status).toBe(200);
  return (await json<{ file: FileMeta }>(res)).file;
}

async function bytesOf(res: Response): Promise<number[]> {
  return Array.from(new Uint8Array(await res.arrayBuffer()));
}

/** `created_at` is second-grained; force a stamp so ordering asserts the QUERY. */
async function backdate(id: string, createdAt: string): Promise<void> {
  await testEnv.DB.prepare('UPDATE user_files SET created_at = ? WHERE id = ?')
    .bind(createdAt, id)
    .run();
}

/** The four paths this file owns. `f_x` never exists — the sweeps want a miss. */
const FILE_ROUTES: ReadonlyArray<readonly [string, string, unknown?]> = [
  ['GET', '/files'],
  [
    'POST',
    '/files',
    { file_name: 'a.jpg', file_type: 'photo', mime_type: 'image/jpeg', file_size: 8 },
  ],
  ['GET', '/files/f_x'],
  ['PUT', '/files/f_x/content', { bytes: 'stand-in' }],
  ['GET', '/files/f_x/content'],
  ['DELETE', '/files/f_x'],
];

describe('health files routes (/health/files*)', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createHealthAssetTables(testEnv.DB);
    await resetHealthAssetTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);
  });

  /* ================= 0. THE SURFACE ITSELF ============================ */

  describe('surface', () => {
    // The files-only projection of ASSET-001: a shared-fleet deploy puts this
    // router on every Worker binary, and the content proxy is the one route in
    // the whole health domain that hands back RAW USER BYTES.
    it.each([
      ['symply-house', HOUSE_ENV],
      ['symply-budget', BUDGET_ENV],
      ['symply-kaizen', KAIZEN_ENV],
    ])('404s every file path on %s', async (_brand, brandEnv) => {
      const leaked: string[] = [];
      for (const [method, path, body] of FILE_ROUTES) {
        const res = await call(method, path, { token: tokenA, body, brandEnv });
        if (res.status !== 404) leaked.push(`${method} ${path} -> ${res.status}`);
      }
      expect(leaked).toEqual([]);
    });

    it('401s every file path without a bearer token', async () => {
      const open: string[] = [];
      for (const [method, path, body] of FILE_ROUTES) {
        const res = await call(method, path, { token: null, body });
        if (res.status !== 401) open.push(`${method} ${path} -> ${res.status}`);
      }
      expect(open).toEqual([]);
    });

    it('serves exactly six handlers — no verb falls through to another', async () => {
      // Hono matches by method as well as path, so a mis-registered handler
      // would show up as an unexpected 2xx/4xx here rather than a 404. The
      // dangerous direction is a verb quietly reaching the content proxy.
      const notServed: Array<[string, string]> = [
        ['PUT', '/files'],
        ['DELETE', '/files'],
        ['PATCH', '/files'],
        ['POST', '/files/f_x'],
        ['PUT', '/files/f_x'],
        ['PATCH', '/files/f_x'],
        ['POST', '/files/f_x/content'],
        ['DELETE', '/files/f_x/content'],
        ['GET', '/files/f_x/thumbnail'],
        ['GET', '/files/f_x/storage_key'],
      ];
      const served: string[] = [];
      for (const [method, path] of notServed) {
        const res = await call(method, path, {
          token: tokenA,
          // A GET may not carry a body; everything else does, so a handler that
          // wrongly matched would still get something to read.
          rawBody: method === 'GET' ? undefined : new Uint8Array([1]),
        });
        if (res.status !== 404) served.push(`${method} ${path} -> ${res.status}`);
      }
      expect(served).toEqual([]);
    });
  });

  /* ==================== 1. GET /files — the list ====================== */

  describe('GET /files', () => {
    it('is empty-but-shaped on a cold account', async () => {
      const res = await call('GET', '/files', { token: tokenA });
      expect(res.status).toBe(200);
      expect(await json<{ files: unknown[] }>(res)).toEqual({ files: [] });
    });

    it('returns the public projection and nothing else', async () => {
      await upload(tokenA, { file_name: 'shot.jpg', category: 'progress', metadata: { a: 1 } });
      const { files } = await json<{ files: FileMeta[] }>(
        await call('GET', '/files', { token: tokenA })
      );
      expect(files).toHaveLength(1);
      // Hardcoded on purpose: a new column lands here as a failure BEFORE it
      // lands in a response body. `storage_key` / `thumbnail_key` absent is the
      // headline, but `user_id` and `deleted_at` are noise the client must not
      // learn to depend on either.
      expect(Object.keys(files[0]).sort()).toEqual([
        'category',
        'content_path',
        'created_at',
        'file_name',
        'file_size',
        'file_type',
        'id',
        'metadata',
        'mime_type',
        'updated_at',
      ]);
    });

    it('orders newest first', async () => {
      const older = await upload(tokenA, { file_name: 'older.jpg' });
      const newer = await upload(tokenA, { file_name: 'newer.jpg' });
      await backdate(older.id, '2020-01-01T00:00:00.000Z');
      const { files } = await json<{ files: FileMeta[] }>(
        await call('GET', '/files', { token: tokenA })
      );
      expect(files.map((f) => f.id)).toEqual([newer.id, older.id]);
    });

    it('caps an unbounded list at 200 rows', async () => {
      // `limit` defaults to 200 in the service. Without the default a user with
      // years of body photos would pull the whole table into one response — the
      // cap is the difference between a list endpoint and a full-table scan.
      const ts = new Date().toISOString();
      await testEnv.DB.batch(
        Array.from({ length: 205 }, (_, i) =>
          testEnv.DB.prepare(
            `INSERT INTO user_files
               (id, user_id, file_name, file_type, mime_type, file_size, storage_key, created_at, updated_at)
             VALUES (?, ?, ?, 'photo', 'image/jpeg', 1, ?, ?, ?)`
          ).bind(`f_bulk_${i}`, UID_A, `f${i}.jpg`, `health-files/${UID_A}/f_bulk_${i}.jpg`, ts, ts)
        )
      );
      const { files } = await json<{ files: FileMeta[] }>(
        await call('GET', '/files', { token: tokenA })
      );
      expect(files).toHaveLength(200);
    });

    it('excludes soft-deleted rows', async () => {
      const kept = await upload(tokenA, { file_name: 'kept.jpg' });
      const gone = await upload(tokenA, { file_name: 'gone.jpg' });
      expect((await call('DELETE', `/files/${gone.id}`, { token: tokenA })).status).toBe(200);
      const { files } = await json<{ files: FileMeta[] }>(
        await call('GET', '/files', { token: tokenA })
      );
      expect(files.map((f) => f.id)).toEqual([kept.id]);
    });

    it('filters by every file_type in the contract', async () => {
      await upload(tokenA, { file_name: 'p.jpg', file_type: 'photo' });
      await upload(tokenA, { file_name: 'b.jpg', file_type: 'body_photo' });
      await upload(tokenA, {
        file_name: 'd.pdf',
        file_type: 'document',
        mime_type: 'application/pdf',
      });
      for (const [type, name] of [
        ['photo', 'p.jpg'],
        ['body_photo', 'b.jpg'],
        ['document', 'd.pdf'],
      ] as const) {
        const { files } = await json<{ files: FileMeta[] }>(
          await call('GET', `/files?file_type=${type}`, { token: tokenA })
        );
        expect(files.map((f) => f.file_name)).toEqual([name]);
      }
    });

    it('treats an EMPTY file_type / limit as "no filter", not as an error', async () => {
      // `?file_type=` and `?limit=` arrive as empty strings, which the handler's
      // truthiness checks skip. Pinned because the alternative reading — 400 on
      // an empty value — is equally defensible, and a client that builds its
      // query string by concatenation will send exactly this.
      await upload(tokenA, { file_name: 'p.jpg' });
      for (const q of ['?file_type=', '?limit=', '?file_type=&limit=']) {
        const res = await call('GET', `/files${q}`, { token: tokenA });
        expect(res.status, q).toBe(200);
        expect((await json<{ files: FileMeta[] }>(res)).files, q).toHaveLength(1);
      }
    });

    it('ignores an unknown query parameter — this list has NO pagination', async () => {
      // There is no `offset` / `cursor` / `page` in the handler. A client that
      // assumed otherwise would silently re-read page 1 forever, so the absence
      // is asserted rather than left to be discovered.
      await upload(tokenA, { file_name: 'a.jpg' });
      await upload(tokenA, { file_name: 'b.jpg' });
      const { files } = await json<{ files: FileMeta[] }>(
        await call('GET', '/files?offset=1&cursor=abc&page=2', { token: tokenA })
      );
      expect(files).toHaveLength(2);
    });

    it('takes the FIRST value when a parameter is repeated', async () => {
      await upload(tokenA, { file_name: 'p.jpg', file_type: 'photo' });
      await upload(tokenA, { file_name: 'b.jpg', file_type: 'body_photo' });
      const { files } = await json<{ files: FileMeta[] }>(
        await call('GET', '/files?file_type=photo&file_type=body_photo', { token: tokenA })
      );
      expect(files.map((f) => f.file_name)).toEqual(['p.jpg']);
    });

    it('400s a fractional ?limit instead of 500ing on the D1 bind', async () => {
      // REGRESSION (found 2026-07-26, fixed in the same change): the guard
      // tested `Number.isFinite`, so `1.5` passed validation and was bound into
      // `LIMIT ?`. D1 rejects a REAL there — `SQLITE_MISMATCH` — so an ordinary
      // authenticated GET answered **500**. The sibling `?expiring_within_days=`
      // guard already used `Number.isInteger`; this one now matches it.
      for (const limit of ['1.5', '0.5', '2.0000001', '1e-3']) {
        const res = await call('GET', `/files?limit=${limit}`, { token: tokenA });
        expect(res.status, `limit=${limit}`).toBe(400);
      }
    });

    it('accepts the limit bounds and any integer spelling of them', async () => {
      await upload(tokenA, { file_name: 'a.jpg' });
      await upload(tokenA, { file_name: 'b.jpg' });
      // `1e2` and `+1` are integers once coerced; rejecting them would be a
      // validator that is too strict, which is as wrong as one too loose.
      for (const limit of ['1', '500', '1e2', '+2', '2.0']) {
        const res = await call('GET', `/files?limit=${limit}`, { token: tokenA });
        expect(res.status, `limit=${limit}`).toBe(200);
      }
      const one = await json<{ files: FileMeta[] }>(
        await call('GET', '/files?limit=1', { token: tokenA })
      );
      expect(one.files).toHaveLength(1);
    });
  });

  /* =================== 2. POST /files — reservation =================== */

  describe('POST /files', () => {
    it('accepts every allow-listed mime type for its own file_type', async () => {
      // The per-type allow-list is what stops a `body_photo` reservation
      // smuggling in a content type the proxy would later serve back on our own
      // origin. Sweeping it BOTH ways (accept the allowed, reject the rest)
      // is the only way to know the list is the list.
      for (const [fileType, mimes] of Object.entries(ALLOWED_MIME_TYPES)) {
        for (const mime of mimes) {
          const { file } = await reserve(tokenA, {
            file_name: `x-${fileType}`,
            file_type: fileType,
            mime_type: mime,
          });
          expect(file.mime_type, `${fileType}/${mime}`).toBe(mime);
        }
      }
    });

    it.each([
      ['photo', 'application/pdf'],
      ['photo', 'text/html'],
      ['body_photo', 'application/pdf'],
      ['body_photo', 'text/html'],
      ['document', 'image/jpeg'],
      ['document', 'application/octet-stream'],
    ])('400s %s + %s — the allow-list is per type', async (fileType, mime) => {
      const res = await call('POST', '/files', {
        token: tokenA,
        body: { file_name: 'a', file_type: fileType, mime_type: mime, file_size: 8 },
      });
      expect(res.status).toBe(400);
    });

    it('accepts the exact boundary values', async () => {
      // The complement of the existing over-the-line 400s: a validator one unit
      // too strict rejects a legitimate 50 MB body photo.
      const name = `${'x'.repeat(251)}.jpg`; // 255 chars exactly
      const { file } = await reserve(tokenA, {
        file_name: name,
        file_size: MAX_FILE_BYTES,
      });
      expect(file.file_name).toHaveLength(255);
      expect(file.file_size).toBe(MAX_FILE_BYTES);
      const min = await reserve(tokenA, { file_name: 'b.jpg', file_size: 1 });
      expect(min.file.file_size).toBe(1);
    });

    it('round-trips category and metadata through the route', async () => {
      const { file } = await reserve(tokenA, {
        file_name: 'front.jpg',
        file_type: 'body_photo',
        category: 'body_photos',
        metadata: { angle: 'front', date: '2026-06-01', nested: { ok: true } },
      });
      expect(file.category).toBe('body_photos');
      // Stored as JSON TEXT and returned verbatim (P1 convention).
      expect(typeof file.metadata).toBe('string');
      expect(JSON.parse(file.metadata as string)).toEqual({
        angle: 'front',
        date: '2026-06-01',
        nested: { ok: true },
      });
    });

    it('defaults category and metadata to null when omitted', async () => {
      const { file } = await reserve(tokenA);
      expect(file.category).toBeNull();
      expect(file.metadata).toBeNull();
    });

    it.each([
      ['a metadata string', 'not-an-object'],
      ['a metadata array', [1, 2]],
      ['a metadata number', 7],
    ])('400s %s', async (_label, metadata) => {
      const res = await call('POST', '/files', {
        token: tokenA,
        body: {
          file_name: 'a.jpg',
          file_type: 'photo',
          mime_type: 'image/jpeg',
          file_size: 8,
          metadata,
        },
      });
      expect(res.status).toBe(400);
    });

    it('IGNORES a client-supplied id, storage_key or content_path', async () => {
      // The whole privacy model rests on the server owning the R2 key. A client
      // that could name its own key could read (or overwrite) another user's
      // object; one that could name its own id could collide deliberately.
      const attacker = {
        file_name: 'a.jpg',
        file_type: 'photo',
        mime_type: 'image/jpeg',
        file_size: 8,
        id: 'f_attacker_chosen',
        storage_key: `health-files/${UID_B}/owned.jpg`,
        thumbnail_key: `health-files/${UID_B}/owned-thumb.jpg`,
        content_path: '/health/files/f_attacker_chosen/content',
        user_id: UID_B,
      };
      const res = await call('POST', '/files', { token: tokenA, body: attacker });
      expect(res.status).toBe(201);
      const { file } = await json<UploadEnvelope>(res);
      expect(file.id).not.toBe('f_attacker_chosen');
      expect(file.content_path).toBe(`/health/files/${file.id}/content`);

      const row = await testEnv.DB.prepare(
        'SELECT user_id, storage_key, thumbnail_key FROM user_files WHERE id = ?'
      )
        .bind(file.id)
        .first<{ user_id: string; storage_key: string; thumbnail_key: string | null }>();
      expect(row?.user_id).toBe(UID_A); // the TOKEN owns the row, not the body
      expect(row?.storage_key).toBe(storageKeyFor(UID_A, file.id, 'a.jpg'));
      expect(row?.thumbnail_key).toBeNull();
    });

    it('400s a malformed or missing JSON body', async () => {
      for (const rawBody of ['not json', '{', '[]', 'null']) {
        const res = await call('POST', '/files', { token: tokenA, rawBody });
        expect(res.status, rawBody).toBe(400);
      }
      const empty = await call('POST', '/files', { token: tokenA });
      expect(empty.status).toBe(400);
    });

    it('400s when the Content-Type header is missing entirely', async () => {
      // Hono only parses the body as JSON when the header says so; without it
      // the validator sees an empty object. It must answer 400, not 500.
      const res = await call('POST', '/files', {
        token: tokenA,
        contentType: null,
        rawBody: JSON.stringify({
          file_name: 'a.jpg',
          file_type: 'photo',
          mime_type: 'image/jpeg',
          file_size: 8,
        }),
      });
      expect(res.status).toBe(400);
    });

    it('writes exactly one row and no R2 object — a reservation is not an upload', async () => {
      const { file } = await reserve(tokenA);
      expect(
        await testEnv.REPORTS_BUCKET.get(storageKeyFor(UID_A, file.id, 'shot.jpg'))
      ).toBeNull();
      const count = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM user_files WHERE user_id = ?')
        .bind(UID_A)
        .first<{ n: number }>();
      expect(count?.n).toBe(1);
    });
  });

  /* ================== 3. GET /files/:id — metadata ==================== */

  describe('GET /files/:id', () => {
    it('reads back exactly what the reservation returned', async () => {
      const { file } = await reserve(tokenA, { file_name: 'shot.jpg', category: 'progress' });
      const res = await call('GET', `/files/${file.id}`, { token: tokenA });
      expect(res.status).toBe(200);
      expect((await json<{ file: FileMeta }>(res)).file).toEqual(file);
    });

    it.each([
      ['an id that never existed', 'f_never'],
      ['an empty-looking id', '%20'],
      ['a path-ish id', 'health-files%2Fu%2Ffoo'],
    ])('404s %s with the not_found envelope', async (_label, id) => {
      const res = await call('GET', `/files/${id}`, { token: tokenA });
      expect(res.status).toBe(404);
      expect(await json<{ error: { code: string } }>(res)).toEqual({
        error: { code: 'not_found', message: 'File not found' },
      });
    });

    it('404s a soft-deleted file rather than serving a tombstone', async () => {
      const file = await upload(tokenA);
      await call('DELETE', `/files/${file.id}`, { token: tokenA });
      expect((await call('GET', `/files/${file.id}`, { token: tokenA })).status).toBe(404);
    });
  });

  /* ============ 4. PUT /files/:id/content — the bytes in ============== */

  describe('PUT /files/:id/content', () => {
    it('round-trips arbitrary binary byte-for-byte', async () => {
      const file = await upload(tokenA, {}, BINARY);
      expect(file.file_size).toBe(BINARY.byteLength);
      const res = await call('GET', `/files/${file.id}/content`, { token: tokenA });
      expect(await bytesOf(res)).toEqual(Array.from(BINARY));
    });

    it('round-trips a UTF-8 document', async () => {
      const text = 'Blood panel — 2026-06-01\nHbA1c: 5.2%\n✓ within range\n';
      const bytes = new TextEncoder().encode(text);
      const file = await upload(
        tokenA,
        { file_name: 'panel.txt', file_type: 'document', mime_type: 'text/plain' },
        bytes
      );
      const res = await call('GET', `/files/${file.id}/content`, { token: tokenA });
      expect(await res.text()).toBe(text);
      expect(file.file_size).toBe(bytes.byteLength);
    });

    it('IGNORES the request Content-Type — the stored type is the allow-listed one', async () => {
      // The attack this closes: reserve `image/jpeg` (allowed), then PUT the
      // bytes declaring `text/html`. If the proxy echoed the upload header, we
      // would serve attacker HTML from our own origin under a bearer-protected
      // URL. The type comes from the ROW, which was validated at reservation.
      const { file } = await reserve(tokenA, { file_name: 'shot.jpg' });
      const put = await call('PUT', `/files/${file.id}/content`, {
        token: tokenA,
        rawBody: new TextEncoder().encode('<script>alert(1)</script>'),
        contentType: 'text/html',
      });
      expect(put.status).toBe(200);

      const object = await testEnv.REPORTS_BUCKET.get(storageKeyFor(UID_A, file.id, 'shot.jpg'));
      expect(object?.httpMetadata?.contentType).toBe('image/jpeg');
      const res = await call('GET', `/files/${file.id}/content`, { token: tokenA });
      expect(res.headers.get('Content-Type')).toBe('image/jpeg');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('accepts an upload with no Content-Type header at all', async () => {
      const { file } = await reserve(tokenA);
      const res = await call('PUT', `/files/${file.id}/content`, {
        token: tokenA,
        contentType: null,
        rawBody: BINARY,
      });
      expect(res.status).toBe(200);
      expect((await json<{ file: FileMeta }>(res)).file.file_size).toBe(BINARY.byteLength);
    });

    it('accepts a body of EXACTLY the 50MB ceiling', async () => {
      // Boundary pair with the existing `MAX + 1` rejection: the cap must be
      // inclusive, or a 50 MB photo the reservation accepted could never be
      // uploaded.
      const { file } = await reserve(tokenA, { file_name: 'big.jpg' });
      const res = await call('PUT', `/files/${file.id}/content`, {
        token: tokenA,
        rawBody: new Uint8Array(MAX_FILE_BYTES),
        contentType: 'application/octet-stream',
      });
      expect(res.status).toBe(200);
      expect((await json<{ file: FileMeta }>(res)).file.file_size).toBe(MAX_FILE_BYTES);
    });

    it('404s an unknown id even though the body was already read', async () => {
      // The size guards run BEFORE the ownership lookup, so this pins that a
      // miss is still a clean 404 and not a half-processed 500.
      const res = await call('PUT', '/files/f_never/content', {
        token: tokenA,
        rawBody: BINARY,
        contentType: 'application/octet-stream',
      });
      expect(res.status).toBe(404);
      expect(await json<{ error: { code: string } }>(res)).toEqual({
        error: { code: 'not_found', message: 'File not found' },
      });
    });

    it('404s a soft-deleted file — a tombstone cannot be refilled', async () => {
      const file = await upload(tokenA);
      await call('DELETE', `/files/${file.id}`, { token: tokenA });
      const res = await call('PUT', `/files/${file.id}/content`, {
        token: tokenA,
        rawBody: BINARY,
        contentType: 'application/octet-stream',
      });
      expect(res.status).toBe(404);
    });

    it('overwrites on re-PUT without stacking rows — a dropped-connection retry is safe', async () => {
      const file = await upload(tokenA, { file_name: 'shot.jpg' }, BINARY);
      const second = new Uint8Array([1, 2, 3]);
      const res = await call('PUT', `/files/${file.id}/content`, {
        token: tokenA,
        rawBody: second,
        contentType: 'application/octet-stream',
      });
      expect((await json<{ file: FileMeta }>(res)).file.file_size).toBe(3);
      expect(await bytesOf(await call('GET', `/files/${file.id}/content`, { token: tokenA }))).toEqual(
        [1, 2, 3]
      );
      const { files } = await json<{ files: FileMeta[] }>(
        await call('GET', '/files', { token: tokenA })
      );
      expect(files).toHaveLength(1);
    });

    it('rejects an empty body and leaves the reservation empty', async () => {
      const { file } = await reserve(tokenA, { file_name: 'shot.jpg' });
      const res = await call('PUT', `/files/${file.id}/content`, {
        token: tokenA,
        rawBody: new Uint8Array(0),
        contentType: 'application/octet-stream',
      });
      expect(res.status).toBe(400);
      // …and nothing reached R2, so a later GET is an honest 404.
      expect(
        await testEnv.REPORTS_BUCKET.get(storageKeyFor(UID_A, file.id, 'shot.jpg'))
      ).toBeNull();
      expect((await call('GET', `/files/${file.id}/content`, { token: tokenA })).status).toBe(404);
    });

    it('does NOT re-check the declared size — the row is corrected to the truth', async () => {
      // A declared size is a claim. The upload may be bigger or smaller; what
      // matters is that the stored figure ends up matching the actual object,
      // because that number is what a future quota or UI would trust.
      const { file } = await reserve(tokenA, { file_name: 'shot.jpg', file_size: 5 });
      const bigger = new Uint8Array(2048);
      const res = await call('PUT', `/files/${file.id}/content`, {
        token: tokenA,
        rawBody: bigger,
        contentType: 'application/octet-stream',
      });
      expect(res.status).toBe(200);
      expect((await json<{ file: FileMeta }>(res)).file.file_size).toBe(2048);
      const object = await testEnv.REPORTS_BUCKET.get(storageKeyFor(UID_A, file.id, 'shot.jpg'));
      expect(object?.size).toBe(2048);
    });

    it('advances updated_at but never created_at', async () => {
      const { file } = await reserve(tokenA, { file_name: 'shot.jpg' });
      await backdate(file.id, '2020-01-01T00:00:00.000Z');
      const res = await call('PUT', `/files/${file.id}/content`, {
        token: tokenA,
        rawBody: BINARY,
        contentType: 'application/octet-stream',
      });
      const uploaded = (await json<{ file: FileMeta }>(res)).file;
      expect(uploaded.created_at).toBe('2020-01-01T00:00:00.000Z');
      expect(uploaded.updated_at > uploaded.created_at).toBe(true);
    });
  });

  /* ============ 5. GET /files/:id/content — the bytes out ============= */

  describe('GET /files/:id/content', () => {
    it('sets the private cache headers and a real ETag', async () => {
      // `private` keeps a shared cache from ever holding somebody's body photo;
      // the ETag is R2's own, so a conditional client can revalidate.
      const file = await upload(tokenA);
      const res = await call('GET', `/files/${file.id}/content`, { token: tokenA });
      expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
      expect(res.headers.get('ETag')).toMatch(/^"?[0-9a-f]{16,}"?$/);
    });

    it('changes the ETag when the bytes change', async () => {
      const file = await upload(tokenA, {}, BINARY);
      const first = (await call('GET', `/files/${file.id}/content`, { token: tokenA })).headers.get(
        'ETag'
      );
      await call('PUT', `/files/${file.id}/content`, {
        token: tokenA,
        rawBody: new Uint8Array([9, 9, 9, 9]),
        contentType: 'application/octet-stream',
      });
      const second = (await call('GET', `/files/${file.id}/content`, { token: tokenA })).headers.get(
        'ETag'
      );
      expect(second).not.toBe(first);
    });

    it.each([
      ['photo', 'shot.jpg', 'image/jpeg', 'inline'],
      ['body_photo', 'front.jpg', 'image/jpeg', 'inline'],
      ['document', 'report.pdf', 'application/pdf', 'attachment'],
      ['document', 'notes.txt', 'text/plain', 'attachment'],
    ])('serves %s as %s', async (fileType, fileName, mime, disposition) => {
      // Only `document` downloads; everything else renders. `body_photo` is the
      // type most likely to be forgotten in a refactor, so it is asserted here
      // rather than assumed to behave like `photo`.
      const file = await upload(tokenA, {
        file_name: fileName,
        file_type: fileType,
        mime_type: mime,
      });
      const res = await call('GET', `/files/${file.id}/content`, { token: tokenA });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe(mime);
      expect(res.headers.get('Content-Disposition')).toBe(`${disposition}; filename="${fileName}"`);
    });

    it('404s an unknown id, a reservation and a tombstone alike', async () => {
      // The caller must not be able to tell these apart — "does this id exist?"
      // is itself information about another account.
      const reserved = await reserve(tokenA);
      const deleted = await upload(tokenA, { file_name: 'gone.jpg' });
      await call('DELETE', `/files/${deleted.id}`, { token: tokenA });

      for (const id of ['f_never', reserved.file.id, deleted.id]) {
        const res = await call('GET', `/files/${id}/content`, { token: tokenA });
        expect(res.status, id).toBe(404);
        expect(res.headers.get('Content-Type')).toContain('application/json');
      }
    });

    it('never publishes the R2 key in a header', async () => {
      // The response headers are the one place a proxy implementation tends to
      // leak the backing object — a `Location`, an `X-Amz-*`, a debug header.
      const file = await upload(tokenA, { file_name: 'front.jpg', file_type: 'body_photo' });
      const res = await call('GET', `/files/${file.id}/content`, { token: tokenA });
      const dumped = JSON.stringify([...res.headers.entries()]);
      expect(dumped).not.toContain('health-files');
      expect(dumped).not.toContain(UID_A);
      expect(dumped).not.toContain('r2.dev');
    });
  });

  /* ================== 6. DELETE /files/:id =========================== */

  describe('DELETE /files/:id', () => {
    it('404s an id that never existed', async () => {
      const res = await call('DELETE', '/files/f_never', { token: tokenA });
      expect(res.status).toBe(404);
      expect(await json<{ error: { code: string } }>(res)).toEqual({
        error: { code: 'not_found', message: 'File not found' },
      });
    });

    it('deletes a reserved-but-never-uploaded file', async () => {
      // There is no R2 object to remove; the row must still tombstone rather
      // than the handler failing on the missing object.
      const { file } = await reserve(tokenA);
      const res = await call('DELETE', `/files/${file.id}`, { token: tokenA });
      expect(res.status).toBe(200);
      expect((await call('GET', `/files/${file.id}`, { token: tokenA })).status).toBe(404);
    });

    it('touches only the named file', async () => {
      const doomed = await upload(tokenA, { file_name: 'doomed.jpg' });
      const spared = await upload(tokenA, { file_name: 'spared.jpg' });
      const spareKey = storageKeyFor(UID_A, spared.id, 'spared.jpg');

      await call('DELETE', `/files/${doomed.id}`, { token: tokenA });
      expect(await testEnv.REPORTS_BUCKET.get(spareKey)).not.toBeNull();
      expect((await call('GET', `/files/${spared.id}`, { token: tokenA })).status).toBe(200);
      expect(
        await bytesOf(await call('GET', `/files/${spared.id}/content`, { token: tokenA }))
      ).toEqual(Array.from(BINARY));
    });

    it('leaves another user file and bytes untouched', async () => {
      const mine = await upload(tokenA, { file_name: 'mine.jpg' });
      const theirs = await upload(tokenB, { file_name: 'theirs.jpg' });
      const theirKey = storageKeyFor(UID_B, theirs.id, 'theirs.jpg');

      expect((await call('DELETE', `/files/${theirs.id}`, { token: tokenA })).status).toBe(404);
      expect(await testEnv.REPORTS_BUCKET.get(theirKey)).not.toBeNull();
      expect((await call('GET', `/files/${theirs.id}`, { token: tokenB })).status).toBe(200);
      // …and A's own file is still there: the failed delete was a no-op, not a
      // delete of the wrong row.
      expect((await call('GET', `/files/${mine.id}`, { token: tokenA })).status).toBe(200);
    });
  });

  /* ====== 7. CROSS-USER ISOLATION, stated as its own contract ========= */

  describe('cross-user isolation', () => {
    it('gives two users the same file NAME but disjoint R2 keys', async () => {
      // The key is namespaced by user id, so identical names cannot collide —
      // which is exactly what would make one account overwrite another's photo.
      const a = await upload(tokenA, { file_name: 'front.jpg', file_type: 'body_photo' });
      const b = await upload(tokenB, { file_name: 'front.jpg', file_type: 'body_photo' });
      const keyA = storageKeyFor(UID_A, a.id, 'front.jpg');
      const keyB = storageKeyFor(UID_B, b.id, 'front.jpg');
      expect(keyA).not.toBe(keyB);
      expect(await testEnv.REPORTS_BUCKET.get(keyA)).not.toBeNull();
      expect(await testEnv.REPORTS_BUCKET.get(keyB)).not.toBeNull();
    });

    it('404s B on every by-id file route and never mutates A rows', async () => {
      const file = await upload(tokenA, { file_name: 'private.jpg', file_type: 'body_photo' });
      const attacks: Array<[string, string, BodyInit?]> = [
        ['GET', `/files/${file.id}`],
        ['GET', `/files/${file.id}/content`],
        ['PUT', `/files/${file.id}/content`, new Uint8Array([6, 6, 6])],
        ['DELETE', `/files/${file.id}`],
      ];
      for (const [method, path, rawBody] of attacks) {
        const res = await call(method, path, {
          token: tokenB,
          rawBody,
          contentType: 'application/octet-stream',
        });
        expect(res.status, `${method} ${path}`).toBe(404);
      }
      // Byte-for-byte intact — a failed PUT must not have partially written.
      expect(
        await bytesOf(await call('GET', `/files/${file.id}/content`, { token: tokenA }))
      ).toEqual(Array.from(BINARY));
    });
  });

  /* ===== 8. SERVICE-LEVEL BRANCHES the HTTP layer cannot reach ======== */

  describe('HealthAssetsService file branches not reachable over HTTP', () => {
    function svc(bucketOverride?: Partial<R2Bucket>): HealthAssetsService {
      const envForSvc = bucketOverride
        ? ({ ...testEnv, REPORTS_BUCKET: bucketOverride } as unknown as Env)
        : testEnv;
      return new HealthAssetsService(envForSvc, testEnv.DB);
    }

    it('stamps the R2 object with an owner trail', async () => {
      // `customMetadata` is the only link from a bare object back to a user, and
      // it is what a support/forensics or bulk-purge job would key on.
      const { file } = await svc().createFileUpload(UID_A, {
        file_name: 'front.jpg',
        file_type: 'body_photo',
        mime_type: 'image/jpeg',
        file_size: 10,
      });
      await svc().putFileContent(UID_A, file.id, BINARY.buffer as ArrayBuffer);
      const object = await testEnv.REPORTS_BUCKET.get(storageKeyFor(UID_A, file.id, 'front.jpg'));
      expect(object?.customMetadata).toEqual({
        userId: UID_A,
        fileId: file.id,
        fileType: 'body_photo',
      });
    });

    it('deletes the thumbnail object alongside the file', async () => {
      // `thumbnail_key` is never populated by the current write path (thumbnails
      // are not generated yet), so this branch is unreachable through HTTP —
      // but the column exists and a future thumbnailer will fill it. If the
      // sibling delete regressed, an orphan preview of a deleted BODY PHOTO
      // would survive in R2, which is the exact thing "delete" must not mean.
      const { file } = await svc().createFileUpload(UID_A, {
        file_name: 'front.jpg',
        file_type: 'body_photo',
        mime_type: 'image/jpeg',
        file_size: 10,
      });
      await svc().putFileContent(UID_A, file.id, BINARY.buffer as ArrayBuffer);
      const thumbKey = `health-files/${UID_A}/${file.id}-thumb.jpg`;
      await testEnv.REPORTS_BUCKET.put(thumbKey, BINARY);
      await testEnv.DB.prepare('UPDATE user_files SET thumbnail_key = ? WHERE id = ?')
        .bind(thumbKey, file.id)
        .run();

      expect(await svc().deleteFile(UID_A, file.id)).toBe(true);
      expect(await testEnv.REPORTS_BUCKET.get(thumbKey)).toBeNull();
      expect(
        await testEnv.REPORTS_BUCKET.get(storageKeyFor(UID_A, file.id, 'front.jpg'))
      ).toBeNull();
    });

    it('still tombstones the row when the R2 delete throws', async () => {
      // R2 is a network call and can fail. If a transient error blocked the
      // tombstone, the user's "delete" would report failure while the metadata
      // stayed live — the worst of both outcomes. The catch is deliberate, and
      // this is the only way to exercise it.
      const { file } = await svc().createFileUpload(UID_A, {
        file_name: 'shot.jpg',
        file_type: 'photo',
        mime_type: 'image/jpeg',
        file_size: 10,
      });
      await svc().putFileContent(UID_A, file.id, BINARY.buffer as ArrayBuffer);

      const failing = {
        get: (key: string) => testEnv.REPORTS_BUCKET.get(key),
        put: (key: string, value: ArrayBuffer) => testEnv.REPORTS_BUCKET.put(key, value),
        delete: () => {
          throw new Error('R2 unavailable');
        },
      } as unknown as R2Bucket;

      expect(await svc(failing).deleteFile(UID_A, file.id)).toBe(true);
      const row = await testEnv.DB.prepare('SELECT deleted_at FROM user_files WHERE id = ?')
        .bind(file.id)
        .first<{ deleted_at: string | null }>();
      expect(row?.deleted_at).toBeTruthy();
      // The object survives the failure — it is unreachable (the key was never
      // published) but honestly reported here rather than assumed gone.
      expect(
        await testEnv.REPORTS_BUCKET.get(storageKeyFor(UID_A, file.id, 'shot.jpg'))
      ).not.toBeNull();
    });

    it('returns null content when the row exists but the object vanished', async () => {
      // R2 and D1 are two stores with no transaction between them. A lifecycle
      // rule or a manual bucket edit can leave a row pointing at nothing, and
      // the proxy must 404 rather than throw.
      const { file } = await svc().createFileUpload(UID_A, {
        file_name: 'shot.jpg',
        file_type: 'photo',
        mime_type: 'image/jpeg',
        file_size: 10,
      });
      await svc().putFileContent(UID_A, file.id, BINARY.buffer as ArrayBuffer);
      await testEnv.REPORTS_BUCKET.delete(storageKeyFor(UID_A, file.id, 'shot.jpg'));

      expect(await svc().getFileContent(UID_A, file.id)).toBeNull();
      const res = await call('GET', `/files/${file.id}/content`, { token: tokenA });
      expect(res.status).toBe(404);
      // …and the metadata read still works, so the app can offer a re-upload.
      expect((await call('GET', `/files/${file.id}`, { token: tokenA })).status).toBe(200);
    });
  });
});
