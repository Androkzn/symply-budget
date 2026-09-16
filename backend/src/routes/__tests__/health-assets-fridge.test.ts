/**
 * Symply Health — the FRIDGE half of `src/routes/health-assets.ts`, driven
 * through the real Hono router against live miniflare D1.
 *
 * `health-assets.test.ts` owns the shared sweeps (brand gate, auth, user
 * scoping) and the fridge's happy CRUD path. This suite owns what the client
 * actually depends on and that file does not assert:
 *
 *  1. THE WIRE CONTRACT. `src/api/healthFridge.ts` declares a `HealthFridgeItem`
 *     with fifteen named keys, and `fromWireFridgeItem` reads eleven of them.
 *     The Worker returns whatever `select()` produced. A column renamed in a
 *     later migration would leave the client rendering `undefined` while every
 *     status code stayed 200 — so the key SET is asserted, not just a value.
 *  2. THE UNFILTERED ORDER. The store's `loadFridge()` re-sorts newest-first and
 *     documents that it "mirrors the Worker's own ordering". If the Worker's
 *     order drifted, the two would silently disagree for anyone reading an
 *     offline snapshot written before the drift.
 *  3. `expiring_within_days` PARSING, at the edges a query string really
 *     produces — an empty value, whitespace, exponent notation, the 3650 cap.
 *     `Number('')` is 0, not NaN, so an empty parameter is a REQUEST FOR THE
 *     ZERO-DAY WINDOW rather than "no filter", and the difference is the whole
 *     list versus what is already due.
 *  4. THE CLIENT'S OWN VOCABULARY. All ten `FRIDGE_UNITS` and all ten
 *     `FRIDGE_CATEGORIES` the RN chip rows can produce, round-tripped through
 *     the column caps, plus the quantity ceiling and a fractional value through
 *     D1's REAL column.
 *
 * Shared setup is `health-test-helpers.ts` (same 0120 DDL, CHECKs intact) so
 * this file adds no schema of its own.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

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
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;

const UID_A = 'u_fridge_alice';
const UID_B = 'u_fridge_bob';

/** A fixed "today" — nothing in this file depends on the wall clock. */
const TODAY = '2026-06-10';
const YESTERDAY = '2026-06-09';
const PLUS_7 = '2026-06-17';
const PLUS_8 = '2026-06-18';

/**
 * The client's own vocabulary, copied from `src/features/health/healthFridgeStorage.ts`.
 *
 * Duplicated rather than imported: the mobile module lives outside the backend
 * tsconfig and pulls React Native with it. Copying is what makes this a CONTRACT
 * test — if the RN list grows a unit the column cannot hold, the two lists
 * diverge here and the failure names the value.
 */
const CLIENT_UNITS = ['pc', 'kg', 'g', 'L', 'ml', 'oz', 'lb', 'cup', 'tbsp', 'tsp'] as const;
const CLIENT_CATEGORIES = [
  'Dairy',
  'Meat',
  'Vegetables',
  'Fruits',
  'Grains',
  'Beverages',
  'Snacks',
  'Frozen',
  'Condiments',
  'Uncategorized',
] as const;

/** Every key `src/api/healthFridge.ts` declares on `HealthFridgeItem`. */
const WIRE_KEYS = [
  'id',
  'user_id',
  'name',
  'quantity',
  'unit',
  'category',
  'expiry_date',
  'is_favorite',
  'nutrition_json',
  'source',
  'image_url',
  'notes',
  'created_at',
  'updated_at',
  'deleted_at',
].sort();

interface FridgeItem {
  id: string;
  user_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  expiry_date: string | null;
  is_favorite: boolean;
  nutrition_json: string | null;
  source: string;
  image_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

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

let tokenA = '';
let tokenB = '';

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = opts.token ?? tokenA;
  if (token) headers.Authorization = `Bearer ${token}`;
  return mkApp().request(
    `/health${path}`,
    { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) },
    HEALTH_ENV
  );
}

async function add(body: Record<string, unknown>, token = tokenA): Promise<FridgeItem> {
  const res = await call('POST', '/fridge', { token, body });
  expect(res.status).toBe(201);
  return ((await res.json()) as { item: FridgeItem }).item;
}

async function list(query = '', token = tokenA): Promise<FridgeItem[]> {
  const res = await call('GET', `/fridge${query}`, { token });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: FridgeItem[] }).items;
}

describe('health fridge routes — the client contract', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createHealthAssetTables(testEnv.DB);
    await resetHealthAssetTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);
  });

  /* ================= 1. The shape the RN client reads ================= */

  describe('wire shape', () => {
    it('HEALTH-FRIDGE-301: every response row carries exactly the keys the client declares', async () => {
      // `fromWireFridgeItem` reads eleven of these by name. A renamed column
      // would keep every status at 200 and quietly render `undefined` in the
      // fridge, which is why the key SET is the assertion.
      const created = await add({
        name: 'Milk',
        quantity: 2,
        unit: 'L',
        category: 'Dairy',
        expiry_date: PLUS_7,
        is_favorite: true,
        notes: 'semi-skimmed',
        image_url: 'https://example.invalid/milk.png',
        nutrition_json: { calories: 120 },
        source: 'receipt',
      });
      expect(Object.keys(created).sort()).toEqual(WIRE_KEYS);

      const [listed] = await list();
      expect(Object.keys(listed).sort()).toEqual(WIRE_KEYS);

      const putRes = await call('PUT', `/fridge/${created.id}`, { body: { quantity: 1 } });
      expect(putRes.status).toBe(200);
      const updated = ((await putRes.json()) as { item: FridgeItem }).item;
      expect(Object.keys(updated).sort()).toEqual(WIRE_KEYS);
    });

    it('HEALTH-FRIDGE-302: is_favorite crosses D1 INTEGER as a real boolean', async () => {
      // The column is INTEGER. `fromWireFridgeItem` maps with `=== true`, so a
      // 1/0 leaking through would make every starred row read as unstarred and
      // the Favourites filter would always be empty.
      const item = await add({ name: 'Butter', is_favorite: true });
      expect(item.is_favorite).toBe(true);
      expect((await list())[0].is_favorite).toBe(true);

      const res = await call('PUT', `/fridge/${item.id}`, { body: { is_favorite: false } });
      expect(((await res.json()) as { item: FridgeItem }).item.is_favorite).toBe(false);
      expect((await list())[0].is_favorite).toBe(false);
    });

    it('HEALTH-FRIDGE-303: an empty fridge answers with an empty ARRAY, never a null', async () => {
      // The client does `(payload?.items ?? []).map(...)`. A null `items` would
      // survive that, but a MISSING one would not — and an empty fridge is the
      // first thing a new account sees.
      const res = await call('GET', '/fridge');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ items: [] });
      expect(await list('?expiring_within_days=7&today=' + TODAY)).toEqual([]);
    });

    it('HEALTH-FRIDGE-304: the unfiltered list is NEWEST-CREATED FIRST', async () => {
      // `loadFridge()` re-sorts by `createdAt` descending and its comment says
      // it "mirrors the Worker's own ordering". Nothing asserted that until now,
      // so the two could drift and only an offline snapshot would show it.
      const first = await add({ name: 'First' });
      // D1 timestamps are ISO strings at whole milliseconds; force distinct
      // ones rather than relying on the insert taking measurable time.
      await testEnv.DB.prepare('UPDATE fridge_items SET created_at = ? WHERE id = ?')
        .bind('2026-06-01T00:00:00.000Z', first.id)
        .run();
      const second = await add({ name: 'Second' });
      await testEnv.DB.prepare('UPDATE fridge_items SET created_at = ? WHERE id = ?')
        .bind('2026-06-02T00:00:00.000Z', second.id)
        .run();
      const third = await add({ name: 'Third' });
      await testEnv.DB.prepare('UPDATE fridge_items SET created_at = ? WHERE id = ?')
        .bind('2026-06-03T00:00:00.000Z', third.id)
        .run();

      expect((await list()).map((i) => i.name)).toEqual(['Third', 'Second', 'First']);
    });

    it('HEALTH-FRIDGE-305: the expiring list is SOONEST-EXPIRY FIRST, which puts the worst food on top', async () => {
      await add({ name: 'Boundary', expiry_date: PLUS_7 });
      await add({ name: 'Ancient', expiry_date: '2020-01-01' });
      await add({ name: 'Today', expiry_date: TODAY });
      await add({ name: 'Yesterday', expiry_date: YESTERDAY });

      expect(
        (await list(`?expiring_within_days=7&today=${TODAY}`)).map((i) => i.name)
      ).toEqual(['Ancient', 'Yesterday', 'Today', 'Boundary']);
    });
  });

  /* ============ 2. `expiring_within_days` as a query string ============ */

  describe('the expiring window parameter', () => {
    async function seed() {
      await add({ name: 'Yesterday', expiry_date: YESTERDAY });
      await add({ name: 'Today', expiry_date: TODAY });
      await add({ name: 'Boundary', expiry_date: PLUS_7 });
      await add({ name: 'JustOutside', expiry_date: PLUS_8 });
      await add({ name: 'Undated' });
    }

    it('HEALTH-FRIDGE-306: an EMPTY parameter is the zero-day window, not "no filter"', async () => {
      // `?expiring_within_days=` reaches the handler as `''`, and `Number('')`
      // is 0 — an integer, so it passes validation and selects "already due".
      // That is a materially different list from the unfiltered one, and it is
      // exactly what a client that built its query string carelessly would send.
      await seed();
      expect((await list(`?expiring_within_days=&today=${TODAY}`)).map((i) => i.name)).toEqual([
        'Yesterday',
        'Today',
      ]);
      // The undated row proves the filter really ran rather than being ignored.
      expect((await list(`?expiring_within_days=&today=${TODAY}`)).map((i) => i.name)).not.toContain(
        'Undated'
      );
      expect((await list()).length).toBe(5);
    });

    it('HEALTH-FRIDGE-307: padded and exponent forms parse the same as the plain integer', async () => {
      // `Number(' 7 ')` is 7 and `Number('1e1')` is 10 — both integers, so both
      // are accepted. Pinned as SHIPPED behaviour: a stricter parser later is a
      // deliberate change, not an accident.
      await seed();
      const plain = (await list(`?expiring_within_days=7&today=${TODAY}`)).map((i) => i.name);
      expect(plain).toEqual(['Yesterday', 'Today', 'Boundary']);
      expect((await list(`?expiring_within_days=%207%20&today=${TODAY}`)).map((i) => i.name)).toEqual(
        plain
      );
      // 1e1 = ten days, which reaches one day further than the seven-day window.
      expect((await list(`?expiring_within_days=1e1&today=${TODAY}`)).map((i) => i.name)).toEqual([
        'Yesterday',
        'Today',
        'Boundary',
        'JustOutside',
      ]);
    });

    it('HEALTH-FRIDGE-308: the 0 and 3650 ends of the range are accepted, one past either is a 400', async () => {
      await seed();
      expect((await call('GET', `/fridge?expiring_within_days=0&today=${TODAY}`)).status).toBe(200);
      expect((await call('GET', `/fridge?expiring_within_days=3650&today=${TODAY}`)).status).toBe(
        200
      );
      expect((await call('GET', '/fridge?expiring_within_days=3651')).status).toBe(400);
      expect((await call('GET', '/fridge?expiring_within_days=-1')).status).toBe(400);
      // A ten-year horizon still refuses the undated row: it cannot be
      // "expiring", at any distance.
      expect(
        (await list(`?expiring_within_days=3650&today=${TODAY}`)).map((i) => i.name)
      ).not.toContain('Undated');
    });

    it('HEALTH-FRIDGE-309: a 400 on the window says WHICH parameter, and never lists the fridge anyway', async () => {
      // Answering 200-with-everything on a bad window would show the user the
      // whole fridge under a "needs eating" heading — worse than an error.
      await seed();
      const res = await call('GET', '/fridge?expiring_within_days=abc');
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: 'bad_request', message: 'expiring_within_days must be an integer 0..3650' },
      });

      const bad = await call('GET', '/fridge?today=10-06-2026');
      expect(bad.status).toBe(400);
      expect(await bad.json()).toEqual({
        error: { code: 'bad_request', message: 'today must be YYYY-MM-DD' },
      });
    });

    it('HEALTH-FRIDGE-310: `today` alone does nothing — it only means something WITH a window', async () => {
      // The client always sends the pair. A `today` on its own must not be read
      // as an implicit filter, or a caller probing the API would silently get a
      // partial fridge.
      await seed();
      expect((await list(`?today=${TODAY}`)).length).toBe(5);
    });

    it('HEALTH-FRIDGE-311: without `today` the window falls back to the SERVER day, which is why the client sends one', async () => {
      // No `today` → the service uses `nowIso()`, i.e. the Worker's UTC day. For
      // a user east or west of Greenwich that is the wrong calendar day, which
      // is precisely why `loadExpiringSoon` always sends the device's own key.
      // Asserted relative to the server's own clock so it cannot go stale.
      const serverDay = new Date().toISOString().slice(0, 10);
      await add({ name: 'DueOnServerDay', expiry_date: serverDay });
      await add({ name: 'FarFuture', expiry_date: '2099-01-01' });

      const names = (await list('?expiring_within_days=0')).map((i) => i.name);
      expect(names).toEqual(['DueOnServerDay']);
    });
  });

  /* ============= 3. The vocabulary the RN chip rows produce ============ */

  describe('the client vocabulary round-trips', () => {
    it.each(CLIENT_UNITS)(
      'HEALTH-FRIDGE-312: unit %s survives the column cap unchanged',
      async (unit) => {
        const item = await add({ name: `Item ${unit}`, quantity: 2, unit });
        expect(item.unit).toBe(unit);
        expect((await list()).find((i) => i.id === item.id)?.unit).toBe(unit);
      }
    );

    it.each(CLIENT_CATEGORIES)(
      'HEALTH-FRIDGE-313: category %s survives the column cap unchanged',
      async (category) => {
        const item = await add({ name: 'Anonymous', category });
        expect(item.category).toBe(category);
        expect((await list()).find((i) => i.id === item.id)?.category).toBe(category);
      }
    );

    it('HEALTH-FRIDGE-314: a fractional quantity survives D1 REAL, and the ceiling is exact', async () => {
      // The client rounds to two decimals before sending; the column is REAL.
      // 2.57 coming back as 2.5700000000000003 would render "2.6" either way,
      // but an edit would then re-send a value the user never typed.
      const fraction = await add({ name: 'Flour', quantity: 2.57 });
      expect(fraction.quantity).toBe(2.57);
      expect((await list())[0].quantity).toBe(2.57);

      const ceiling = await add({ name: 'Rice grains', quantity: 1_000_000 });
      expect(ceiling.quantity).toBe(1_000_000);
      // One past the CHECK is a 400 rather than a 500 constraint error.
      expect(
        (await call('POST', '/fridge', { body: { name: 'Too much', quantity: 1_000_000.01 } })).status
      ).toBe(400);
      // Zero is a real quantity — "the packet is empty" is a fact worth storing.
      expect((await add({ name: 'Empty packet', quantity: 0 })).quantity).toBe(0);
    });

    it('HEALTH-FRIDGE-315: a name with accents or non-Latin script round-trips byte for byte', async () => {
      // The fridge is a list of food names typed by a human. A mangled `Crème`
      // would also break the client-side search, which matches on the stored
      // string.
      for (const name of ['Crème fraîche', 'Молоко', '日本茶', 'Jalapeño 🌶']) {
        const item = await add({ name });
        expect(item.name).toBe(name);
        expect((await list()).find((i) => i.id === item.id)?.name).toBe(name);
      }
    });

    it('HEALTH-FRIDGE-316: image_url and nutrition_json have caps too, and both are nullable', async () => {
      // Neither is reachable from the RN form today (no scanner, no OCR), but
      // both are on the wire type and a future import path will use them — so
      // the boundary is pinned now rather than discovered by a 500 later.
      const ok = await add({
        name: 'Scanned',
        // Exactly the 500-character cap: `https://example.invalid/` is 24.
        image_url: `https://example.invalid/${'a'.repeat(476)}`,
        nutrition_json: 'x'.repeat(4000),
      });
      expect(ok.image_url?.length).toBe(500);
      expect(ok.nutrition_json).toHaveLength(4000);

      expect(
        (await call('POST', '/fridge', { body: { name: 'Too long', image_url: 'u'.repeat(501) } }))
          .status
      ).toBe(400);
      expect(
        (
          await call('POST', '/fridge', {
            body: { name: 'Too long', nutrition_json: 'x'.repeat(4001) },
          })
        ).status
      ).toBe(400);

      const cleared = await call('PUT', `/fridge/${ok.id}`, {
        body: { image_url: null, nutrition_json: null },
      });
      const item = ((await cleared.json()) as { item: FridgeItem }).item;
      expect(item.image_url).toBeNull();
      expect(item.nutrition_json).toBeNull();
    });
  });

  /* ================== 4. Partial writes and lifecycle ================= */

  describe('partial writes', () => {
    it('HEALTH-FRIDGE-317: the star patch touches ONLY is_favorite', async () => {
      // `setFridgeFavorite` sends `{ is_favorite }` and nothing else, precisely
      // so a star cannot clobber a name the user is mid-way through editing on
      // another device.
      const item = await add({
        name: 'Milk',
        quantity: 2,
        unit: 'L',
        category: 'Dairy',
        expiry_date: PLUS_7,
        notes: 'semi-skimmed',
      });
      const res = await call('PUT', `/fridge/${item.id}`, { body: { is_favorite: true } });
      const updated = ((await res.json()) as { item: FridgeItem }).item;

      expect(updated.is_favorite).toBe(true);
      expect({
        name: updated.name,
        quantity: updated.quantity,
        unit: updated.unit,
        category: updated.category,
        expiry_date: updated.expiry_date,
        notes: updated.notes,
      }).toEqual({
        name: 'Milk',
        quantity: 2,
        unit: 'L',
        category: 'Dairy',
        expiry_date: PLUS_7,
        notes: 'semi-skimmed',
      });
    });

    it('HEALTH-FRIDGE-318: an EMPTY patch is a legal no-op that only moves updated_at', async () => {
      // `updateFridgeSchema` has no required key, so `{}` validates. It must not
      // reset anything — a client retrying a dropped PUT with a trimmed body
      // would otherwise wipe the row.
      const item = await add({ name: 'Milk', quantity: 2, notes: 'keep me' });
      await testEnv.DB.prepare('UPDATE fridge_items SET updated_at = ? WHERE id = ?')
        .bind('2020-01-01T00:00:00.000Z', item.id)
        .run();

      const res = await call('PUT', `/fridge/${item.id}`, { body: {} });
      expect(res.status).toBe(200);
      const updated = ((await res.json()) as { item: FridgeItem }).item;
      expect(updated.name).toBe('Milk');
      expect(updated.quantity).toBe(2);
      expect(updated.notes).toBe('keep me');
      expect(updated.updated_at).not.toBe('2020-01-01T00:00:00.000Z');
    });

    it('HEALTH-FRIDGE-319: the RN client full-PUT (every field, nulls included) clears what it cleared', async () => {
      // `toWireFridgePayload` sends all seven keys on every edit — including the
      // nulls — because an omitted key means "leave alone". This is that exact
      // body, replayed against the route.
      const item = await add({
        name: 'Milk',
        quantity: 2,
        unit: 'L',
        category: 'Dairy',
        expiry_date: PLUS_7,
        notes: 'semi-skimmed',
        is_favorite: true,
      });

      const res = await call('PUT', `/fridge/${item.id}`, {
        body: {
          name: 'Oat milk',
          quantity: null,
          unit: null,
          category: null,
          expiry_date: null,
          is_favorite: false,
          notes: null,
        },
      });
      expect(res.status).toBe(200);
      const updated = ((await res.json()) as { item: FridgeItem }).item;
      expect(updated).toMatchObject({
        name: 'Oat milk',
        quantity: null,
        unit: null,
        category: null,
        expiry_date: null,
        is_favorite: false,
        notes: null,
      });
      // A cleared expiry really does leave the expiring window.
      expect(await list(`?expiring_within_days=3650&today=${TODAY}`)).toEqual([]);
    });

    it('HEALTH-FRIDGE-320: a deleted row is gone from BOTH list shapes and 404s on every verb', async () => {
      const item = await add({ name: 'Milk', expiry_date: TODAY });
      expect((await call('DELETE', `/fridge/${item.id}`)).status).toBe(200);

      expect(await list()).toEqual([]);
      expect(await list(`?expiring_within_days=7&today=${TODAY}`)).toEqual([]);
      expect((await call('DELETE', `/fridge/${item.id}`)).status).toBe(404);
      expect((await call('PUT', `/fridge/${item.id}`, { body: { name: 'Zombie' } })).status).toBe(
        404
      );
      // …and the tombstone survives, which is what lets another device drop its
      // own copy on the next sync.
      const row = await testEnv.DB.prepare('SELECT deleted_at FROM fridge_items WHERE id = ?')
        .bind(item.id)
        .first<{ deleted_at: string | null }>();
      expect(row?.deleted_at).toBeTruthy();
    });

    it('HEALTH-FRIDGE-321: an unknown id 404s in OUR envelope, not the framework default', async () => {
      // The RN store maps 404 to "That item is no longer in your fridge." and
      // rolls the optimistic row back. It reads only the STATUS, but the body is
      // the fleet-wide error contract and a bare framework 404 would break the
      // pattern every other route follows.
      const res = await call('PUT', '/fridge/fr_does_not_exist', { body: { name: 'Ghost' } });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: { code: 'not_found', message: 'Item not found' },
      });

      const del = await call('DELETE', '/fridge/fr_does_not_exist');
      expect(del.status).toBe(404);
      expect(await del.json()).toEqual({ error: { code: 'not_found', message: 'Item not found' } });
    });

    it("HEALTH-FRIDGE-322: another user's row is a 404, not a 403 — the id is not confirmed to exist", async () => {
      // Food stock is personal (BRD §7). Answering 403 would tell B that A's id
      // is real; 404 tells them nothing.
      const mine = await add({ name: 'Milk' });
      expect((await call('PUT', `/fridge/${mine.id}`, { token: tokenB, body: { name: 'Hijack' } }))
        .status).toBe(404);
      expect((await call('DELETE', `/fridge/${mine.id}`, { token: tokenB })).status).toBe(404);
      expect(await list('', tokenB)).toEqual([]);
      // …and A's row is untouched by the attempt.
      expect((await list())[0].name).toBe('Milk');
    });
  });
});
