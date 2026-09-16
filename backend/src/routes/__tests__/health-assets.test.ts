/**
 * Symply Health P2 `assets` routes (`src/routes/health-assets.ts`) — files,
 * widget preferences and the fridge, driven through the real Hono router
 * against live miniflare D1 + R2.
 *
 * Same three load-bearing layers as health.test.ts, in the same order:
 *   1. BRAND GATE — `requireHealthApi()` must 404 every path on
 *      House/Budget/Kaizen, BEFORE the token check.
 *   2. AUTH — every path is 401 without a valid bearer.
 *   3. USER SCOPING — B must never read, mutate or delete A's file, preference
 *      or fridge row.
 *
 * Plus the two privacy rules this domain exists to hold:
 *   4. `storage_key` NEVER reaches a response body and is never turned into a
 *      URL. A leaked key on a `body_photo` is a privacy incident.
 *   5. The widget snapshot is a SUMMARY: no files at all (body photos least of
 *      all — a widget renders on a LOCKED screen), no cycle, no vitality.
 *
 * …and the validation twin of migration 0120's CHECK constraints: miniflare D1
 * enforces them, so a missing zod rule is a 500, not a 400.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_FILE_BYTES,
  sanitizeFileName,
  storageKeyFor,
} from '../../services/health-assets-service';
import { HealthService } from '../../services/health-service';
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

// The pool env is House (wrangler.toml); each brand gets its own copy so a
// single request can be replayed across the fleet.
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;
const HOUSE_ENV = { ...testEnv, APP_BRAND: 'symply-house' } as Env;
const BUDGET_ENV = { ...testEnv, APP_BRAND: 'symply-budget' } as Env;
const KAIZEN_ENV = { ...testEnv, APP_BRAND: 'symply-kaizen' } as Env;

const UID_A = 'u_assets_alice';
const UID_B = 'u_assets_bob';

/** Fixed "personal" dates — nothing here depends on the wall clock. */
const D1 = '2026-06-01';
const TODAY = '2026-06-10';
const YESTERDAY = '2026-06-09';
const PLUS_3 = '2026-06-13';
const PLUS_7 = '2026-06-17';
const PLUS_8 = '2026-06-18';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04]);

async function mintToken(userId: string, secretOverride?: string): Promise<string> {
  const secret = new TextEncoder().encode(
    secretOverride ?? testEnv.JWT_SECRET ?? 'test-jwt-secret-32-chars-minimum'
  );
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

let tokenA = '';
let tokenB = '';

async function call(
  method: string,
  path: string,
  opts: {
    token?: string | null;
    body?: unknown;
    rawBody?: BodyInit;
    contentType?: string;
    brandEnv?: Env;
  } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': opts.contentType ?? 'application/json',
  };
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

interface FridgeItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  expiry_date: string | null;
  is_favorite: boolean;
  nutrition_json: string | null;
  source: string;
  notes: string | null;
}

/** Every path the router owns — the gate/auth sweeps must cover all of them. */
const ROUTES: ReadonlyArray<readonly [string, string, unknown?]> = [
  ['GET', '/files'],
  ['POST', '/files', { file_name: 'a.jpg', file_type: 'photo', mime_type: 'image/jpeg', file_size: 8 }],
  ['GET', '/files/f_x'],
  ['PUT', '/files/f_x/content', { bytes: 'stand-in' }],
  ['GET', '/files/f_x/content'],
  ['DELETE', '/files/f_x'],
  ['GET', '/widget/preferences'],
  ['PUT', '/widget/preferences', { show_weight: false }],
  ['GET', '/widget/snapshot'],
  ['GET', '/fridge'],
  ['POST', '/fridge', { name: 'Milk' }],
  ['PUT', '/fridge/fr_x', { name: 'Oat milk' }],
  ['DELETE', '/fridge/fr_x'],
];

/** The brand gate's own envelope — distinguishes it from a real not-found. */
const GATE_MESSAGE = 'Not found';

async function isGate404(res: Response): Promise<boolean> {
  if (res.status !== 404) return false;
  try {
    const b = (await res.json()) as { error?: { message?: string } };
    return b.error?.message === GATE_MESSAGE;
  } catch {
    // Hono's built-in "no route" 404 is plain text — treat as a gate/miss too.
    return true;
  }
}

async function reserveFile(
  token: string,
  overrides: Partial<{
    file_name: string;
    file_type: string;
    mime_type: string;
    file_size: number;
    category: string;
    metadata: Record<string, unknown>;
  }> = {}
): Promise<UploadEnvelope> {
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

/** Reserve + upload the bytes, i.e. a file that really exists in R2. */
async function uploadFile(
  token: string,
  overrides: Parameters<typeof reserveFile>[1] = {},
  bytes: Uint8Array = JPEG
): Promise<FileMeta> {
  const { file } = await reserveFile(token, overrides);
  const res = await call('PUT', `/files/${file.id}/content`, {
    token,
    rawBody: bytes,
    contentType: 'application/octet-stream',
  });
  expect(res.status).toBe(200);
  return (await json<{ file: FileMeta }>(res)).file;
}

async function addFridgeItem(token: string, body: Record<string, unknown>): Promise<FridgeItem> {
  const res = await call('POST', '/fridge', { token, body });
  expect(res.status).toBe(201);
  return (await json<{ item: FridgeItem }>(res)).item;
}

async function listFridge(token: string, query = ''): Promise<FridgeItem[]> {
  const res = await call('GET', `/fridge${query}`, { token });
  expect(res.status).toBe(200);
  return (await json<{ items: FridgeItem[] }>(res)).items;
}

describe('health assets routes', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createHealthAssetTables(testEnv.DB);
    await resetHealthAssetTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);
  });

  /* ====================== 1. BRAND GATE ============================== */

  describe('brand gate (requireHealthApi)', () => {
    // A shared-fleet deploy puts these routes on every Worker binary. The gate
    // is the only thing stopping House/Budget/Kaizen from serving health files,
    // so it is swept across EVERY path rather than a sample.
    it.each([
      ['symply-house', HOUSE_ENV],
      ['symply-budget', BUDGET_ENV],
      ['symply-kaizen', KAIZEN_ENV],
    ])('404s every /health assets route on %s', async (_brand, brandEnv) => {
      const leaked: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body, brandEnv });
        if (!(await isGate404(res))) leaked.push(`${method} ${path} -> ${res.status}`);
      }
      expect(leaked).toEqual([]);
    });

    it('fires BEFORE auth — a tokenless wrong-brand request 404s, never 401s', async () => {
      // Ordering matters: a 401 would confirm the surface exists on that brand.
      const res = await call('GET', '/files', { token: null, brandEnv: BUDGET_ENV });
      expect(res.status).toBe(404);
      expect(await json<{ error: { message: string } }>(res)).toEqual({
        error: { code: 'not_found', message: GATE_MESSAGE },
      });
    });

    it('never fires on symply-health — every route is reachable there', async () => {
      // A 404 on the Health Worker may only be a real "not found"; the generic
      // gate message would mean the capability table regressed.
      const gated: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body });
        if (await isGate404(res)) gated.push(`${method} ${path}`);
      }
      expect(gated).toEqual([]);
    });

    it('no route 5xxs on a cold, empty account', async () => {
      const crashed: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body });
        if (res.status >= 500) crashed.push(`${method} ${path} -> ${res.status}`);
      }
      expect(crashed).toEqual([]);
    });
  });

  /* ========================== 2. AUTH ================================= */

  describe('auth', () => {
    it('401s every route without a bearer token', async () => {
      const open: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: null, body });
        if (res.status !== 401) open.push(`${method} ${path} -> ${res.status}`);
      }
      expect(open).toEqual([]);
    });

    it('401s a token signed with the wrong secret', async () => {
      const forged = await mintToken(UID_A, 'an-attacker-secret-32-chars-minimum');
      const res = await call('GET', '/files', { token: forged });
      expect(res.status).toBe(401);
    });

    it('401s a malformed bearer value', async () => {
      const res = await call('GET', '/files', { token: 'not-a-jwt' });
      expect(res.status).toBe(401);
    });
  });

  /* ====================== 3. USER SCOPING ============================= */

  describe('user scoping (personal data, no household)', () => {
    it('never leaks another user rows in any list endpoint', async () => {
      await uploadFile(tokenA, { file_name: 'private.jpg', file_type: 'body_photo' });
      await addFridgeItem(tokenA, { name: 'Milk', expiry_date: TODAY });
      await call('PUT', '/widget/preferences', {
        token: tokenA,
        body: { small_widget_metric: 'water', show_weight: false },
      });

      expect(
        (await json<{ files: unknown[] }>(await call('GET', '/files', { token: tokenB }))).files
      ).toEqual([]);
      expect(await listFridge(tokenB)).toEqual([]);
      // B reads the DEFAULTS, not A's saved preferences.
      const prefsB = await json<{ preferences: Record<string, unknown> }>(
        await call('GET', '/widget/preferences', { token: tokenB })
      );
      expect(prefsB.preferences).toEqual({
        small_widget_metric: 'steps',
        chart_type: 'bar',
        chart_metric: 'weight',
        show_weight: true,
        show_nutrition: true,
        show_workouts: true,
        small_widget_style: 'standard',
        medium_widget_layout: 'standard',
        medium_primary_metric: 'steps',
        medium_secondary_metric: 'calories',
        medium_show_all_metrics: true,
      });
    });

    it('404s every cross-user read and mutation by id, leaving the row intact', async () => {
      const file = await uploadFile(tokenA, { file_name: 'a.jpg' });
      const item = await addFridgeItem(tokenA, { name: 'Cheese' });

      const attacks: Array<[string, string, unknown?]> = [
        ['GET', `/files/${file.id}`],
        ['GET', `/files/${file.id}/content`],
        ['PUT', `/files/${file.id}/content`, { bytes: 'overwrite' }],
        ['DELETE', `/files/${file.id}`],
        ['PUT', `/fridge/${item.id}`, { name: 'Hijacked' }],
        ['DELETE', `/fridge/${item.id}`],
      ];
      const allowed: string[] = [];
      for (const [method, path, body] of attacks) {
        const res = await call(method, path, { token: tokenB, body });
        if (res.status !== 404) allowed.push(`${method} ${path} -> ${res.status}`);
      }
      expect(allowed).toEqual([]);

      // A's rows survive untouched — content and all.
      const stillThere = await json<{ file: FileMeta }>(
        await call('GET', `/files/${file.id}`, { token: tokenA })
      );
      expect(stillThere.file.file_size).toBe(JPEG.byteLength);
      const content = await call('GET', `/files/${file.id}/content`, { token: tokenA });
      expect(content.status).toBe(200);
      expect(Array.from(new Uint8Array(await content.arrayBuffer()))).toEqual(Array.from(JPEG));
      const itemsA = await listFridge(tokenA);
      expect(itemsA).toHaveLength(1);
      expect(itemsA[0].name).toBe('Cheese');
    });

    it('keeps the user-keyed widget preference upsert in separate lanes', async () => {
      // `widget_preferences.user_id` is UNIQUE and the write is an upsert — the
      // classic place for a missing user filter to overwrite the wrong row.
      await call('PUT', '/widget/preferences', {
        token: tokenA,
        body: { small_widget_metric: 'water' },
      });
      await call('PUT', '/widget/preferences', {
        token: tokenB,
        body: { small_widget_metric: 'calories' },
      });

      const a = await json<{ preferences: { small_widget_metric: string } }>(
        await call('GET', '/widget/preferences', { token: tokenA })
      );
      const b = await json<{ preferences: { small_widget_metric: string } }>(
        await call('GET', '/widget/preferences', { token: tokenB })
      );
      expect(a.preferences.small_widget_metric).toBe('water');
      expect(b.preferences.small_widget_metric).toBe('calories');
    });
  });

  /* ================== 4. FILES: THE STORAGE-KEY RULE ================== */

  describe('files — storage_key never leaves the server', () => {
    it('omits storage_key from every file-shaped response, on every file type', async () => {
      // `body_photo` is the sensitive class: a leaked key here is a privacy
      // incident, so all three types are swept rather than one.
      for (const fileType of ['photo', 'document', 'body_photo'] as const) {
        const mime = fileType === 'document' ? 'application/pdf' : 'image/jpeg';
        const name = fileType === 'document' ? 'scan.pdf' : `${fileType}.jpg`;
        const reserved = await reserveFile(tokenA, {
          file_name: name,
          file_type: fileType,
          mime_type: mime,
        });
        const id = reserved.file.id;
        const expectedKey = storageKeyFor(UID_A, id, sanitizeFileName(name));

        const uploaded = await call('PUT', `/files/${id}/content`, {
          token: tokenA,
          rawBody: JPEG,
          contentType: 'application/octet-stream',
        });
        const bodies = [
          JSON.stringify(reserved),
          await uploaded.text(),
          await (await call('GET', `/files/${id}`, { token: tokenA })).text(),
          await (await call('GET', '/files', { token: tokenA })).text(),
        ];

        for (const body of bodies) {
          expect(body).not.toContain(expectedKey);
          expect(body).not.toContain('health-files/');
          expect(body).not.toContain('storage_key');
          expect(body).not.toContain('thumbnail_key');
          // …and no attempt to publish it as a URL either.
          expect(body).not.toMatch(/https?:\/\/[^"]*health-files/);
          expect(body).not.toContain('r2.dev');
        }

        // The key is REAL and holds the bytes — it is simply never published.
        const object = await testEnv.REPORTS_BUCKET.get(expectedKey);
        expect(object).not.toBeNull();
      }
    });

    it('hands back a proxied content_path instead of a URL', async () => {
      const { file, upload } = await reserveFile(tokenA);
      expect(upload.upload_url).toBeNull(); // R2 bindings have no presigned PUT
      expect(upload.method).toBe('PUT');
      expect(upload.path).toBe(`/health/files/${file.id}/content`);
      expect(upload.max_size_bytes).toBe(50 * 1024 * 1024);
      expect(file.content_path).toBe(upload.path);
      // Relative, same-origin, auth-checked — never an absolute public URL.
      expect(file.content_path.startsWith('/')).toBe(true);
    });
  });

  describe('files — upload / read / delete lifecycle', () => {
    it('corrects the declared size to the real byte length on upload', async () => {
      const { file } = await reserveFile(tokenA, { file_size: 999_999 });
      expect(file.file_size).toBe(999_999); // the client's DECLARED size
      const uploaded = await call('PUT', `/files/${file.id}/content`, {
        token: tokenA,
        rawBody: JPEG,
        contentType: 'application/octet-stream',
      });
      expect((await json<{ file: FileMeta }>(uploaded)).file.file_size).toBe(JPEG.byteLength);
      const fetched = await json<{ file: FileMeta }>(
        await call('GET', `/files/${file.id}`, { token: tokenA })
      );
      expect(fetched.file.file_size).toBe(JPEG.byteLength);
    });

    it('serves the bytes back with the DECLARED mime type, inline for images', async () => {
      const file = await uploadFile(tokenA, { file_name: 'shot.jpg', file_type: 'photo' });
      const res = await call('GET', `/files/${file.id}/content`, { token: tokenA });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/jpeg');
      expect(res.headers.get('Content-Disposition')).toBe('inline; filename="shot.jpg"');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(JPEG));
    });

    it('serves documents as an attachment', async () => {
      const file = await uploadFile(tokenA, {
        file_name: 'report.pdf',
        file_type: 'document',
        mime_type: 'application/pdf',
      });
      const res = await call('GET', `/files/${file.id}/content`, { token: tokenA });
      expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="report.pdf"');
    });

    it('sanitises the file name so it cannot break out of the header', async () => {
      // The name is client-supplied and is rendered into Content-Disposition.
      const file = await uploadFile(tokenA, { file_name: 'evil".jpg' });
      expect(file.file_name).toBe('evil_.jpg');
      const res = await call('GET', `/files/${file.id}/content`, { token: tokenA });
      expect(res.headers.get('Content-Disposition')).toBe('inline; filename="evil_.jpg"');
    });

    it('404s the content of a reserved-but-never-uploaded file', async () => {
      const { file } = await reserveFile(tokenA);
      const res = await call('GET', `/files/${file.id}/content`, { token: tokenA });
      expect(res.status).toBe(404);
    });

    it('deletes softly, destroys the bytes, and is not repeatable', async () => {
      const file = await uploadFile(tokenA, { file_name: 'private.jpg', file_type: 'body_photo' });
      const key = storageKeyFor(UID_A, file.id, 'private.jpg');
      expect(await testEnv.REPORTS_BUCKET.get(key)).not.toBeNull();

      const del = await call('DELETE', `/files/${file.id}`, { token: tokenA });
      expect(del.status).toBe(200);
      expect(await json<{ deleted: boolean }>(del)).toEqual({ deleted: true });

      // "Delete this body photo" has to mean the PIXELS are gone.
      expect(await testEnv.REPORTS_BUCKET.get(key)).toBeNull();
      expect((await call('GET', `/files/${file.id}`, { token: tokenA })).status).toBe(404);
      expect((await call('GET', `/files/${file.id}/content`, { token: tokenA })).status).toBe(404);
      expect((await call('DELETE', `/files/${file.id}`, { token: tokenA })).status).toBe(404);
      expect(
        (await json<{ files: unknown[] }>(await call('GET', '/files', { token: tokenA }))).files
      ).toEqual([]);

      // …but the row survives as a tombstone so the sync cursor can carry it.
      const row = await testEnv.DB.prepare('SELECT deleted_at FROM user_files WHERE id = ?')
        .bind(file.id)
        .first<{ deleted_at: string | null }>();
      expect(row?.deleted_at).toBeTruthy();
    });

    it('filters the list by file_type and rejects an unknown one', async () => {
      await uploadFile(tokenA, { file_name: 'p.jpg', file_type: 'photo' });
      await uploadFile(tokenA, { file_name: 'b.jpg', file_type: 'body_photo' });
      await uploadFile(tokenA, {
        file_name: 'd.pdf',
        file_type: 'document',
        mime_type: 'application/pdf',
      });

      const all = await json<{ files: FileMeta[] }>(await call('GET', '/files', { token: tokenA }));
      expect(all.files).toHaveLength(3);

      const bodyPhotos = await json<{ files: FileMeta[] }>(
        await call('GET', '/files?file_type=body_photo', { token: tokenA })
      );
      expect(bodyPhotos.files.map((f) => f.file_name)).toEqual(['b.jpg']);

      const bad = await call('GET', '/files?file_type=avatar', { token: tokenA });
      expect(bad.status).toBe(400);
    });
  });

  describe('files — validation (400, never 500)', () => {
    const invalid: Array<[string, Record<string, unknown>]> = [
      ['unknown file_type', { file_name: 'a.jpg', file_type: 'avatar', mime_type: 'image/jpeg', file_size: 8 }],
      ['mime not allowed for a document', { file_name: 'a.pdf', file_type: 'document', mime_type: 'image/jpeg', file_size: 8 }],
      ['mime not allowed for a photo', { file_name: 'a.jpg', file_type: 'photo', mime_type: 'application/pdf', file_size: 8 }],
      ['empty file_name', { file_name: '', file_type: 'photo', mime_type: 'image/jpeg', file_size: 8 }],
      ['file_name over 255', { file_name: `${'x'.repeat(256)}.jpg`, file_type: 'photo', mime_type: 'image/jpeg', file_size: 8 }],
      ['file_size over 50MB', { file_name: 'a.jpg', file_type: 'photo', mime_type: 'image/jpeg', file_size: 50 * 1024 * 1024 + 1 }],
      ['file_size zero', { file_name: 'a.jpg', file_type: 'photo', mime_type: 'image/jpeg', file_size: 0 }],
      ['missing file_type', { file_name: 'a.jpg', mime_type: 'image/jpeg', file_size: 8 }],
    ];

    it.each(invalid)('400s on %s', async (_label, body) => {
      const res = await call('POST', '/files', { token: tokenA, body });
      expect(res.status).toBe(400);
    });

    it('400s an empty upload body', async () => {
      const { file } = await reserveFile(tokenA);
      const res = await call('PUT', `/files/${file.id}/content`, {
        token: tokenA,
        rawBody: new Uint8Array(0),
        contentType: 'application/octet-stream',
      });
      expect(res.status).toBe(400);
    });

    it('400s an upload past the ceiling, and never writes it to R2', async () => {
      // The RESERVATION caps `file_size`, but the bytes arrive on a second
      // request that can say anything. Without this check the ceiling is
      // advisory and a client could stream 200 MB into the bucket.
      const { file } = await reserveFile(tokenA);
      const res = await call('PUT', `/files/${file.id}/content`, {
        token: tokenA,
        rawBody: new Uint8Array(MAX_FILE_BYTES + 1),
        contentType: 'application/octet-stream',
      });
      expect(res.status).toBe(400);
      expect((await json<{ error: { message: string } }>(res)).error.message).toMatch(/too large/);

      // The reservation is still empty — nothing was stored.
      const content = await call('GET', `/files/${file.id}/content`, { token: tokenA });
      expect(content.status).toBe(404);
    });

    it('400s a nonsense ?limit rather than silently listing everything', async () => {
      // `limit` reaches SQL. A NaN or a negative would either throw at the
      // driver or quietly become "no bound", which is how a list endpoint turns
      // into a full-table scan.
      for (const limit of ['abc', '0', '-1', '501', 'Infinity']) {
        const res = await call('GET', `/files?limit=${limit}`, { token: tokenA });
        expect(res.status, `limit=${limit}`).toBe(400);
      }
      // …and the bounds themselves are accepted.
      for (const limit of ['1', '500']) {
        expect((await call('GET', `/files?limit=${limit}`, { token: tokenA })).status).toBe(200);
      }
    });

    it('honours a valid ?limit', async () => {
      await uploadFile(tokenA, { file_name: 'a.jpg', file_type: 'photo' });
      await uploadFile(tokenA, { file_name: 'b.jpg', file_type: 'photo' });
      const listed = await json<{ files: FileMeta[] }>(
        await call('GET', '/files?limit=1', { token: tokenA })
      );
      expect(listed.files).toHaveLength(1);
    });
  });

  /* ============== 5. WIDGET: SUMMARY, AND ONLY A SUMMARY ============== */

  describe('widget preferences', () => {
    it('reads column defaults before anything was ever saved', async () => {
      const res = await call('GET', '/widget/preferences', { token: tokenA });
      expect(res.status).toBe(200);
      expect(await json<{ preferences: unknown }>(res)).toEqual({
        preferences: {
          small_widget_metric: 'steps',
          chart_type: 'bar',
          chart_metric: 'weight',
          show_weight: true,
          show_nutrition: true,
          show_workouts: true,
          small_widget_style: 'standard',
          medium_widget_layout: 'standard',
          medium_primary_metric: 'steps',
          medium_secondary_metric: 'calories',
          medium_show_all_metrics: true,
        },
      });
    });

    it('PATCH-merges: an omitted key keeps its stored value', async () => {
      // The donor's PUT reset every omitted field to its default, so an older
      // client that knew three keys silently wiped the rest.
      await call('PUT', '/widget/preferences', {
        token: tokenA,
        body: { small_widget_metric: 'water', chart_type: 'line' },
      });
      const res = await call('PUT', '/widget/preferences', {
        token: tokenA,
        body: { show_weight: false },
      });
      expect(await json<{ preferences: unknown }>(res)).toEqual({
        preferences: {
          small_widget_metric: 'water',
          chart_type: 'line',
          chart_metric: 'weight',
          show_weight: false,
          show_nutrition: true,
          show_workouts: true,
          small_widget_style: 'standard',
          medium_widget_layout: 'standard',
          medium_primary_metric: 'steps',
          medium_secondary_metric: 'calories',
          medium_show_all_metrics: true,
        },
      });
    });

    it('upserts on the UNIQUE user_id — repeated PUTs never stack rows', async () => {
      for (const metric of ['steps', 'water', 'calories']) {
        await call('PUT', '/widget/preferences', {
          token: tokenA,
          body: { small_widget_metric: metric },
        });
      }
      const count = await testEnv.DB.prepare(
        'SELECT COUNT(*) AS n FROM widget_preferences WHERE user_id = ?'
      )
        .bind(UID_A)
        .first<{ n: number }>();
      expect(count?.n).toBe(1);
    });

    it.each([
      ['small_widget_metric', { small_widget_metric: 'bpm' }],
      ['chart_type', { chart_type: 'pie' }],
      ['chart_metric', { chart_metric: 'steps' }],
      ['show_weight type', { show_weight: 'yes' }],
    ])('400s an out-of-contract %s instead of hitting the D1 CHECK', async (_label, body) => {
      const res = await call('PUT', '/widget/preferences', { token: tokenA, body });
      expect(res.status).toBe(400);
    });
  });

  describe('widget snapshot', () => {
    /** Seed the P1 tracking data the snapshot is derived FROM. */
    async function seedTracking(userId: string) {
      const health = new HealthService(testEnv.DB);
      await health.saveGoal(userId, D1, {
        daily_calories: 2000,
        daily_water_ml: 2000,
        daily_steps: 10000,
      });
      await health.createWeight(userId, { date: D1, weight: 70.5, unit: 'kg' });
      await health.createWater(userId, { date: D1, amount_ml: 500 });
      await health.createNutrition(userId, {
        date: D1,
        food_name: 'Eggs',
        meal_type: 'breakfast',
        calories: 300,
        proteins: 20,
        carbohydrates: 5,
        fats: 10,
      });
      await health.setSteps(userId, D1, 8000);
      await health.createHealthEntry(userId, {
        date: D1,
        entry_type: 'workout',
        data: { workout_type: 'run', minutes: 30, calories: 250 },
      });
    }

    async function snapshot(token: string): Promise<Record<string, unknown>> {
      const res = await call('GET', `/widget/snapshot?date=${D1}`, { token });
      expect(res.status).toBe(200);
      return (await json<{ snapshot: Record<string, unknown> }>(res)).snapshot;
    }

    it('derives every figure from the P1 data via HealthService', async () => {
      await seedTracking(UID_A);
      const s = await snapshot(tokenA);
      expect(s.date).toBe(D1);
      expect(s.steps).toEqual({ value: 8000, goal: 10000 });
      expect(s.water).toEqual({ total_ml: 500, goal_ml: 2000 });
      expect(s.weight).toEqual({ value: 70.5, unit: 'kg', date: D1 });
      expect(s.nutrition).toEqual({
        calories: 300,
        proteins: 20,
        carbohydrates: 5,
        fats: 10,
        goal_calories: 2000,
        protein_target: null,
        carbs_target: null,
        fats_target: null,
      });
      expect(s.workouts).toEqual({ count: 1, minutes: 30, calories: 250, goal_minutes: null });
      // Default small metric is steps.
      expect(s.small).toEqual({ metric: 'steps', value: 8000, goal: 10000 });
      // weight_trend / nutrition_trend are covered in depth by
      // `health-assets-widget.test.ts`; this just pins that they exist and
      // carry today's reading/total, so this test stays the one place a
      // reader sees every top-level block populated from one seed.
      expect(s.weight_trend).toMatchObject({ avg_this_week: 70.5 });
      expect(s.nutrition_trend).toMatchObject({ avg_this_week: expect.any(Number) });
    });

    it('carries a fixed key set — nothing sensitive can be added quietly', async () => {
      await seedTracking(UID_A);
      // Hardcoded on purpose: a future field lands here as a failure first.
      expect(Object.keys(await snapshot(tokenA)).sort()).toEqual([
        'date',
        'generated_at',
        'nutrition',
        'nutrition_trend',
        'preferences',
        'small',
        'steps',
        'water',
        'weight',
        'weight_trend',
        'workouts',
      ]);
    });

    it.each([
      ['show_weight', 'weight', 'weight_trend'],
      ['show_nutrition', 'nutrition', 'nutrition_trend'],
      ['show_workouts', 'workouts', null],
    ])('honours the %s toggle', async (pref, key, trendKey) => {
      await seedTracking(UID_A);
      const before = await snapshot(tokenA);
      expect(before[key]).not.toBeNull();
      if (trendKey) expect(before[trendKey]).not.toBeNull();

      await call('PUT', '/widget/preferences', { token: tokenA, body: { [pref]: false } });
      const s = await snapshot(tokenA);
      expect(s[key]).toBeNull();
      if (trendKey) expect(s[trendKey]).toBeNull();
      // …and only that domain goes dark.
      const untouched = ['weight', 'weight_trend', 'nutrition', 'nutrition_trend', 'workouts'].filter(
        (k) => k !== key && k !== trendKey
      );
      for (const other of untouched) expect(s[other]).not.toBeNull();
      // Steps and water have no toggle — they are the always-on glance metrics.
      expect(s.steps).toEqual({ value: 8000, goal: 10000 });
    });

    it.each([
      ['steps', 8000, 10000],
      ['water', 500, 2000],
      ['calories', 300, 2000],
    ])('renders small_widget_metric=%s', async (metric, value, goal) => {
      await seedTracking(UID_A);
      await call('PUT', '/widget/preferences', {
        token: tokenA,
        body: { small_widget_metric: metric },
      });
      expect((await snapshot(tokenA)).small).toEqual({ metric, value, goal });
    });

    it('falls back to steps when the small metric belongs to a hidden domain', async () => {
      // show_nutrition=false must not leak calories back in through the small slot.
      await seedTracking(UID_A);
      await call('PUT', '/widget/preferences', {
        token: tokenA,
        body: { small_widget_metric: 'calories', show_nutrition: false },
      });
      const s = await snapshot(tokenA);
      expect(s.small).toEqual({ metric: 'steps', value: 8000, goal: 10000 });
      expect(s.nutrition).toBeNull();
      expect(s.nutrition_trend).toBeNull();
    });

    it('EXCLUDES body photos and every other sensitive domain', async () => {
      // A widget renders on a LOCKED screen: anything in this payload is
      // readable without unlocking the device.
      await seedTracking(UID_A);
      const health = new HealthService(testEnv.DB);
      await health.logPeriodDay(UID_A, D1, 4, 'heavy day');
      await health.saveMensHealth(UID_A, D1, { libido: 9 });
      const bodyPhoto = await uploadFile(tokenA, {
        file_name: 'front-2026.jpg',
        file_type: 'body_photo',
        category: 'body_photos',
      });
      const photo = await uploadFile(tokenA, { file_name: 'lunch.jpg', file_type: 'photo' });

      const res = await call('GET', `/widget/snapshot?date=${D1}`, { token: tokenA });
      const text = await res.text();

      for (const forbidden of [
        bodyPhoto.id,
        bodyPhoto.file_name,
        photo.id,
        photo.file_name,
        'body_photo',
        'storage_key',
        'health-files',
        'content_path',
        'files',
        'flow_level',
        'period',
        'cycle',
        'libido',
        'symptom',
        'heavy day',
      ]) {
        expect(text).not.toContain(forbidden);
      }
    });

    it('is empty-but-shaped on a cold account and never 500s', async () => {
      const s = await snapshot(tokenB);
      expect(s.steps).toEqual({ value: 0, goal: null });
      expect(s.water).toEqual({ total_ml: 0, goal_ml: null });
      expect(s.weight).toBeNull();
      expect(s.workouts).toEqual({ count: 0, minutes: 0, calories: 0, goal_minutes: null });
      // show_weight / show_nutrition default true, so their trend blocks are
      // still present — just empty, never a raw HealthService throw.
      expect(s.weight_trend).toMatchObject({ entries: [], avg_this_week: null });
      expect(s.nutrition_trend).toMatchObject({ avg_this_week: 0 });
    });

    it('400s a malformed date', async () => {
      const res = await call('GET', '/widget/snapshot?date=01-06-2026', { token: tokenA });
      expect(res.status).toBe(400);
    });
  });

  /* ============================ 6. FRIDGE ============================= */

  describe('fridge CRUD', () => {
    it('creates, lists, updates and soft-deletes', async () => {
      const item = await addFridgeItem(tokenA, {
        name: '  Milk  ',
        quantity: 2,
        unit: 'L',
        category: 'Dairy',
        expiry_date: PLUS_3,
        notes: 'semi-skimmed',
        source: 'receipt',
      });
      expect(item.name).toBe('Milk'); // trimmed
      expect(item.expiry_date).toBe(PLUS_3);
      expect(item.source).toBe('receipt');
      expect(item.is_favorite).toBe(false);

      const updated = await json<{ item: FridgeItem }>(
        await call('PUT', `/fridge/${item.id}`, {
          token: tokenA,
          body: { quantity: 1, is_favorite: true },
        })
      );
      expect(updated.item.quantity).toBe(1);
      expect(updated.item.is_favorite).toBe(true);
      // An omitted key is left alone, not reset.
      expect(updated.item.name).toBe('Milk');
      expect(updated.item.unit).toBe('L');
      expect(updated.item.notes).toBe('semi-skimmed');

      const del = await call('DELETE', `/fridge/${item.id}`, { token: tokenA });
      expect(await json<{ deleted: boolean }>(del)).toEqual({ deleted: true });
      expect(await listFridge(tokenA)).toEqual([]);
      // Soft — the tombstone survives for the sync cursor.
      const row = await testEnv.DB.prepare('SELECT deleted_at FROM fridge_items WHERE id = ?')
        .bind(item.id)
        .first<{ deleted_at: string | null }>();
      expect(row?.deleted_at).toBeTruthy();

      // …and a second delete / an update of a tombstone is a 404, not a no-op 200.
      expect((await call('DELETE', `/fridge/${item.id}`, { token: tokenA })).status).toBe(404);
      expect(
        (await call('PUT', `/fridge/${item.id}`, { token: tokenA, body: { name: 'Zombie' } }))
          .status
      ).toBe(404);
    });

    it('clears a nullable field when null is sent explicitly', async () => {
      const item = await addFridgeItem(tokenA, { name: 'Yoghurt', expiry_date: PLUS_3, notes: 'x' });
      const updated = await json<{ item: FridgeItem }>(
        await call('PUT', `/fridge/${item.id}`, {
          token: tokenA,
          body: { expiry_date: null, notes: null },
        })
      );
      expect(updated.item.expiry_date).toBeNull();
      expect(updated.item.notes).toBeNull();
    });

    it('stores nutrition_json as TEXT whether an object or a string was sent', async () => {
      const asObject = await addFridgeItem(tokenA, {
        name: 'Yoghurt',
        nutrition_json: { calories: 120 },
      });
      const asString = await addFridgeItem(tokenA, {
        name: 'Kefir',
        nutrition_json: '{"calories":90}',
      });
      expect(JSON.parse(asObject.nutrition_json as string)).toEqual({ calories: 120 });
      expect(JSON.parse(asString.nutrition_json as string)).toEqual({ calories: 90 });
    });
  });

  describe('fridge expiry filtering', () => {
    /** Six items around a FIXED "today" — no wall-clock dependency. */
    async function seedExpiries() {
      await addFridgeItem(tokenA, { name: 'Expired', expiry_date: YESTERDAY });
      await addFridgeItem(tokenA, { name: 'Today', expiry_date: TODAY });
      await addFridgeItem(tokenA, { name: 'Plus3', expiry_date: PLUS_3 });
      await addFridgeItem(tokenA, { name: 'Boundary', expiry_date: PLUS_7 });
      await addFridgeItem(tokenA, { name: 'JustOutside', expiry_date: PLUS_8 });
      await addFridgeItem(tokenA, { name: 'NoExpiry' });
    }

    it('lists everything, including undated items, with no filter', async () => {
      await seedExpiries();
      expect((await listFridge(tokenA)).map((i) => i.name).sort()).toEqual([
        'Boundary',
        'Expired',
        'JustOutside',
        'NoExpiry',
        'Plus3',
        'Today',
      ]);
    });

    it('includes today AND already-expired items, and the exact boundary day', async () => {
      // Already-expired is the most urgent thing in the fridge; hiding it from
      // a "what needs eating" surface would be worse than useless. The boundary
      // (today + N) is INCLUSIVE; today + N + 1 is not.
      await seedExpiries();
      const names = (await listFridge(tokenA, `?expiring_within_days=7&today=${TODAY}`)).map(
        (i) => i.name
      );
      expect(names).toEqual(['Expired', 'Today', 'Plus3', 'Boundary']); // soonest first
      expect(names).not.toContain('JustOutside');
      // An item with NO expiry can never be "expiring".
      expect(names).not.toContain('NoExpiry');
    });

    it('days=0 keeps only what is already due', async () => {
      await seedExpiries();
      expect(
        (await listFridge(tokenA, `?expiring_within_days=0&today=${TODAY}`)).map((i) => i.name)
      ).toEqual(['Expired', 'Today']);
    });

    it('normalises a full ISO timestamp so it lands on the right side of the cutoff', async () => {
      // The donor stored epochs; the column is ISO TEXT and compared
      // lexicographically, so '2026-06-17T23:30:00Z' > '2026-06-17' would fall
      // OUTSIDE a 7-day window that should contain it.
      const item = await addFridgeItem(tokenA, {
        name: 'Timestamped',
        expiry_date: `${PLUS_7}T23:30:00.000Z`,
      });
      expect(item.expiry_date).toBe(PLUS_7);
      expect(
        (await listFridge(tokenA, `?expiring_within_days=7&today=${TODAY}`)).map((i) => i.name)
      ).toEqual(['Timestamped']);
    });

    it('400s a nonsense window instead of silently listing everything', async () => {
      for (const q of ['?expiring_within_days=abc', '?expiring_within_days=-1', '?expiring_within_days=1.5']) {
        expect((await call('GET', `/fridge${q}`, { token: tokenA })).status).toBe(400);
      }
      expect((await call('GET', '/fridge?today=10-06-2026', { token: tokenA })).status).toBe(400);
    });
  });

  describe('fridge validation mirrors the migration-0120 CHECKs (400, never 500)', () => {
    // D1 — miniflare's included — ENFORCES these CHECKs, so a missing zod rule
    // is a constraint error and a 500, not an honest 400.
    const invalid: Array<[string, Record<string, unknown>]> = [
      ['empty name', { name: '' }],
      ['whitespace-only name', { name: '   ' }],
      ['name over 200', { name: 'x'.repeat(201) }],
      ['negative quantity', { name: 'Milk', quantity: -1 }],
      ['unit over 20', { name: 'Milk', unit: 'u'.repeat(21) }],
      ['category over 50', { name: 'Milk', category: 'c'.repeat(51) }],
      ['notes over 1000', { name: 'Milk', notes: 'n'.repeat(1001) }],
      ['unknown source', { name: 'Milk', source: 'telepathy' }],
      ['unparseable expiry_date', { name: 'Milk', expiry_date: 'next tuesday' }],
      ['impossible expiry_date', { name: 'Milk', expiry_date: '2026-13-45' }],
      // Rolls over to 2 March in V8 rather than failing — a silent bad write.
      ['rolled-over expiry_date', { name: 'Milk', expiry_date: '2026-02-30' }],
      ['non-numeric quantity', { name: 'Milk', quantity: 'two' }],
    ];

    it.each(invalid)('400s POST on %s', async (_label, body) => {
      const res = await call('POST', '/fridge', { token: tokenA, body });
      expect(res.status).toBe(400);
    });

    it.each(invalid)('400s PUT on %s', async (_label, body) => {
      const item = await addFridgeItem(tokenA, { name: 'Milk' });
      const res = await call('PUT', `/fridge/${item.id}`, { token: tokenA, body });
      expect(res.status).toBe(400);
    });

    it('accepts every value that sits exactly ON a CHECK boundary', async () => {
      const item = await addFridgeItem(tokenA, {
        name: 'x'.repeat(200),
        quantity: 0,
        unit: 'u'.repeat(20),
        category: 'c'.repeat(50),
        notes: 'n'.repeat(1000),
        source: 'photo',
      });
      expect(item.name).toHaveLength(200);
      expect(item.quantity).toBe(0);
    });

    it.each(['manual', 'scan', 'receipt', 'photo'])('accepts source=%s', async (source) => {
      const item = await addFridgeItem(tokenA, { name: 'Milk', source });
      expect(item.source).toBe(source);
    });
  });
});
