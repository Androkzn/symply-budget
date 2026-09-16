/**
 * Symply Health — the WATER half of `src/routes/health.ts`, at the HTTP layer.
 *
 * `health.test.ts` already owns the brand gate, auth, the cross-domain scoping
 * sweep and the water happy path (create / summarise / undo / delete). This file
 * covers what a member can reach that those do not:
 *
 *  * **VALIDATION.** `amount_ml` is `positive().max(10000)` and `date` is a bare
 *    `YYYY-MM-DD` regex. Every one of those bounds is the difference between a
 *    400 and a corrupt row, and the RN client now has TWO writers pointed at
 *    this route — Home's ±1 cup (`adjustWater`) and the Water tab's presets /
 *    custom amount (`healthWaterStorage.addWaterAmount`) — so a bound that is
 *    only enforced client-side is not enforced.
 *  * **Per-entry DELETE scoping.** `DELETE /water/entries/:id` is a live client
 *    path (the Water tab's per-row ✕ → `healthApi.deleteWater`). It takes an id
 *    from the caller, so "user B cannot delete user A's drink" is the security
 *    property of the route, not an incidental one.
 *  * **Soft-delete semantics.** Deletes are tombstones, so a second delete, an
 *    undo, a list and a summary must all agree that the row is gone.
 *  * **Window queries** at the ROUTE level, inclusive at both ends — the Water
 *    tab pulls exactly one day (`from == to`) and the Trends history pulls 400.
 *
 * Harness mirrors health.test.ts (`cloudflare:test` env, a jose HS256 JWT whose
 * `sub` is the user id, local DDL from health-test-helpers).
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import healthRoutes from '../health';

import {
  createHealthTables,
  listHealthRows,
  readHealthRow,
  resetHealthTables,
  seedHealthUsers,
} from './health-test-helpers';

const testEnv = env as unknown as Env;
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;

const UID_A = 'u_water_alice';
const UID_B = 'u_water_bob';

/** Fixed personal dates — nothing here depends on the wall clock. */
const D1 = '2026-06-01';
const D2 = '2026-06-02';
const D3 = '2026-06-03';

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(
    testEnv.JWT_SECRET ?? 'test-jwt-secret-32-chars-minimum'
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

/** Mirrors the `app.route('/health', healthRoutes)` mount in src/index.ts. */
function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthRoutes);
  return app;
}

let tokenA = '';
let tokenB = '';

async function call(
  method: string,
  path: string,
  opts: { token?: string | null; body?: unknown } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = opts.token === undefined ? tokenA : opts.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return mkApp().request(
    `/health${path}`,
    { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) },
    HEALTH_ENV
  );
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** POST a drink and hand back its id — the shape both RN writers use. */
async function addWater(
  token: string,
  body: { date: string; amount_ml: number; beverage_type?: string; container?: string }
): Promise<string> {
  const res = await call('POST', '/water/entries', { token, body });
  expect(res.status).toBe(201);
  return (await json<{ entry: { id: string } }>(res)).entry.id;
}

async function summaryFor(token: string, date: string) {
  const res = await call('GET', `/water/summary/daily?date=${date}`, { token });
  expect(res.status).toBe(200);
  return (
    await json<{
      summary: { date: string; total_ml: number; goal_ml: number | null; entry_count: number };
    }>(res)
  ).summary;
}

async function listWater(token: string, query = '') {
  const res = await call('GET', `/water/entries${query}`, { token });
  expect(res.status).toBe(200);
  return (await json<{ entries: Array<{ id: string; date: string; amount_ml: number }> }>(res))
    .entries;
}

describe('health water routes', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);
  });

  /* ======================= VALIDATION ================================ */

  describe('POST /water/entries — validation', () => {
    it('HEALTH-API-030: rejects every non-positive or out-of-range volume', async () => {
      // The client clamps too (`clampEntryMl`, `adjustWater`), but a clamp on
      // one of two writers is not a bound — this is where it is actually held.
      const bad: unknown[] = [
        { date: D1, amount_ml: 0 }, // `positive()` excludes zero
        { date: D1, amount_ml: -250 },
        { date: D1, amount_ml: 10_001 }, // one past `.max(10000)`
        { date: D1, amount_ml: '250' }, // a string, not a number
        { date: D1, amount_ml: null },
        { date: D1 }, // missing entirely
      ];

      for (const body of bad) {
        const res = await call('POST', '/water/entries', { token: tokenA, body });
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
      // Nothing partially applied — a rejected write leaves no row behind.
      expect(await listHealthRows(testEnv.DB, 'water_entries')).toHaveLength(0);
    });

    it('HEALTH-API-031: accepts both ends of the accepted range, decimals included', async () => {
      // 1 ml is the smallest thing `clampEntryMl` will send; 10,000 is the cap a
      // "did you drink a 10 L jug?" input would hit.
      await addWater(tokenA, { date: D1, amount_ml: 1 });
      await addWater(tokenA, { date: D1, amount_ml: 10_000 });
      // `amount_ml` is a REAL column, and an oz→ml conversion is fractional
      // (16.9 oz = 499.79 ml), so a decimal must survive rather than be floored.
      const id = await addWater(tokenA, { date: D2, amount_ml: 499.79 });

      expect(await readHealthRow<{ amount_ml: number }>(testEnv.DB, 'water_entries', id)).toMatchObject(
        { amount_ml: 499.79 }
      );
      expect((await summaryFor(tokenA, D1)).total_ml).toBe(10_001);
    });

    it('HEALTH-API-032: rejects a date that is not a bare YYYY-MM-DD', async () => {
      // The client always sends its own LOCAL day. A timestamp would bucket the
      // drink into the wrong day for anyone east or west of UTC.
      const bad = ['2026-6-1', '06/01/2026', '2026-06-01T10:00:00Z', 'today', '', '2026-06'];

      for (const date of bad) {
        const res = await call('POST', '/water/entries', {
          token: tokenA,
          body: { date, amount_ml: 250 },
        });
        expect(res.status, date).toBe(400);
      }
    });

    it('HEALTH-API-033: a well-formed but impossible date is ACCEPTED', async () => {
      // GAP (HEALTH-API-033): `dateSchema` is a regex, not a calendar check, so
      // `2026-13-45` passes. Harmless today (the client derives the key from
      // `Date`), but it means a hand-crafted request can create a row no day
      // view will ever show and no summary will ever total. Pinned rather than
      // fixed: tightening it is a shared change across every health domain.
      const id = await addWater(tokenA, { date: '2026-13-45', amount_ml: 250 });
      expect(await readHealthRow<{ date: string }>(testEnv.DB, 'water_entries', id)).toMatchObject({
        date: '2026-13-45',
      });
      expect((await summaryFor(tokenA, D1)).total_ml).toBe(0);
    });

    it('HEALTH-API-034: bounds the optional beverage and container strings', async () => {
      const forty = 'x'.repeat(40);
      const id = await addWater(tokenA, {
        date: D1,
        amount_ml: 350,
        beverage_type: 'coffee',
        container: 'Mug',
      });
      expect(
        await readHealthRow<{ beverage_type: string; container: string }>(
          testEnv.DB,
          'water_entries',
          id
        )
      ).toMatchObject({ beverage_type: 'coffee', container: 'Mug' });

      // The Water tab writes the PRESET name into `container` ('Glass' / 'Mug' /
      // 'Bottle'), which is what makes a log row read "Bottle · 2:15 PM".
      await addWater(tokenA, { date: D1, amount_ml: 250, container: forty });
      for (const over of [
        { date: D1, amount_ml: 250, beverage_type: `${forty}x` },
        { date: D1, amount_ml: 250, container: `${forty}x` },
      ]) {
        expect((await call('POST', '/water/entries', { token: tokenA, body: over })).status).toBe(
          400
        );
      }
    });

    it('HEALTH-API-035: defaults the beverage to water and the container to NULL', async () => {
      // What Home's ±1 cup sends: date + amount and nothing else.
      const id = await addWater(tokenA, { date: D1, amount_ml: 240 });
      expect(
        await readHealthRow<{ beverage_type: string; container: string | null }>(
          testEnv.DB,
          'water_entries',
          id
        )
      ).toMatchObject({ beverage_type: 'water', container: null });
    });
  });

  describe('POST /water/undo — validation', () => {
    it('HEALTH-API-036: 400s a missing or malformed date rather than guessing today', async () => {
      // "Undo the last sip of WHICH day" has no safe default: guessing would let
      // a bad request delete a real row.
      for (const body of [{}, { date: '' }, { date: '2026-6-1' }, { date: 123 }]) {
        const res = await call('POST', '/water/undo', { token: tokenA, body });
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
    });

    it('HEALTH-API-037: undo skips a row that was already soft-deleted', async () => {
      const first = await addWater(tokenA, { date: D1, amount_ml: 100 });
      const second = await addWater(tokenA, { date: D1, amount_ml: 200 });

      expect((await call('DELETE', `/water/entries/${second}`, { token: tokenA })).status).toBe(200);

      // The tombstone must not be "undone" a second time — otherwise the member
      // taps minus, nothing appears to happen, and the sip they meant to remove
      // survives.
      expect(await json(await call('POST', '/water/undo', { token: tokenA, body: { date: D1 } }))).toEqual(
        { removed: true }
      );
      expect((await listWater(tokenA)).map((e) => e.id)).toEqual([]);
      expect(
        await readHealthRow<{ deleted_at: string | null }>(testEnv.DB, 'water_entries', first)
      ).toMatchObject({ deleted_at: expect.any(String) });
    });

    it('HEALTH-API-038: undo is scoped to ONE day and to ONE user', async () => {
      await addWater(tokenA, { date: D1, amount_ml: 100 });
      await addWater(tokenB, { date: D2, amount_ml: 500 });

      // B's undo on a day where only A has rows must not reach across.
      expect(await json(await call('POST', '/water/undo', { token: tokenB, body: { date: D1 } }))).toEqual(
        { removed: false }
      );
      expect(await listWater(tokenA)).toHaveLength(1);
      expect(await listWater(tokenB)).toHaveLength(1);
    });
  });

  /* ===================== PER-ENTRY DELETE ============================ */

  describe('DELETE /water/entries/:id', () => {
    it('HEALTH-API-039: user B cannot delete user A drink', async () => {
      // The route takes an id straight from the caller, so this is THE security
      // property of the per-row ✕ on the Water tab. A 404 (not a 403) is right:
      // confirming the id exists would itself be a leak.
      const id = await addWater(tokenA, { date: D1, amount_ml: 500 });

      const res = await call('DELETE', `/water/entries/${id}`, { token: tokenB });
      expect(res.status).toBe(404);
      expect(await json<{ error: { code: string } }>(res)).toMatchObject({
        error: { code: 'not_found' },
      });

      // Still A's, still visible, still counted.
      expect(await listWater(tokenA)).toHaveLength(1);
      expect((await summaryFor(tokenA, D1)).total_ml).toBe(500);
      expect(
        await readHealthRow<{ deleted_at: string | null }>(testEnv.DB, 'water_entries', id)
      ).toMatchObject({ deleted_at: null });
    });

    it('HEALTH-API-040: a delete is a tombstone, and a REPEAT 404s without re-stamping it', async () => {
      const id = await addWater(tokenA, { date: D1, amount_ml: 250 });

      expect((await call('DELETE', `/water/entries/${id}`, { token: tokenA })).status).toBe(200);

      // The row survives as a tombstone for the sync delta; it is invisible to
      // every read path. That half is right.
      expect(await listHealthRows(testEnv.DB, 'water_entries')).toHaveLength(1);
      expect(await listWater(tokenA)).toHaveLength(0);
      expect(await summaryFor(tokenA, D1)).toMatchObject({ total_ml: 0, entry_count: 0 });

      const first = await readHealthRow<{ deleted_at: string; updated_at: string }>(
        testEnv.DB,
        'water_entries',
        id
      );

      // FIXED (was HEALTH-API-040): `HealthService.deleteWater` now guards
      // `deleted_at IS NULL`, matching every other soft-deleter, so a SECOND
      // delete of the same id answers 404 — it does not match an already-dead
      // row, does not re-stamp `updated_at`, and so does not put an
      // already-deleted row back into the `/health/sync` delta.
      expect((await call('DELETE', `/water/entries/${id}`, { token: tokenA })).status).toBe(404);
      const second = await readHealthRow<{ deleted_at: string; updated_at: string }>(
        testEnv.DB,
        'water_entries',
        id
      );
      expect(second?.updated_at).toBe(first?.updated_at);
      // The row is still gone from every read path.
      expect(await listWater(tokenA)).toHaveLength(0);
      expect(first?.deleted_at).toBeTruthy();
    });

    it('HEALTH-API-041: deleting the MIDDLE drink leaves the others untouched', async () => {
      // The difference from undo: the member is pointing at a specific row, so
      // neither neighbour may move.
      const a = await addWater(tokenA, { date: D1, amount_ml: 100 });
      const b = await addWater(tokenA, { date: D1, amount_ml: 200 });
      const c = await addWater(tokenA, { date: D1, amount_ml: 300 });

      expect((await call('DELETE', `/water/entries/${b}`, { token: tokenA })).status).toBe(200);

      expect((await listWater(tokenA)).map((e) => e.id).sort()).toEqual([a, c].sort());
      expect((await summaryFor(tokenA, D1)).total_ml).toBe(400);
    });
  });

  /* ===================== READS AND WINDOWS =========================== */

  describe('GET /water/entries — windows', () => {
    it('HEALTH-API-042: from/to are inclusive at BOTH ends', async () => {
      await addWater(tokenA, { date: D1, amount_ml: 100 });
      await addWater(tokenA, { date: D2, amount_ml: 200 });
      await addWater(tokenA, { date: D3, amount_ml: 300 });

      // The Trends history pulls a 400-day window and the Water tab pulls ONE
      // day (`from === to`); an exclusive bound would silently drop today.
      expect((await listWater(tokenA, `?from=${D1}&to=${D3}`)).map((e) => e.date)).toEqual([
        D3,
        D2,
        D1,
      ]);
      expect((await listWater(tokenA, `?from=${D2}&to=${D2}`)).map((e) => e.date)).toEqual([D2]);
      expect((await listWater(tokenA, `?from=${D2}`)).map((e) => e.date)).toEqual([D3, D2]);
      expect((await listWater(tokenA, `?to=${D2}`)).map((e) => e.date)).toEqual([D2, D1]);
      expect(await listWater(tokenA, '?from=2027-01-01')).toEqual([]);
    });

    it('HEALTH-API-043: entries come back newest DAY first, and exclude tombstones', async () => {
      await addWater(tokenA, { date: D1, amount_ml: 100 });
      const gone = await addWater(tokenA, { date: D3, amount_ml: 300 });
      await addWater(tokenA, { date: D2, amount_ml: 200 });

      expect((await listWater(tokenA)).map((e) => e.date)).toEqual([D3, D2, D1]);

      await call('DELETE', `/water/entries/${gone}`, { token: tokenA });
      expect((await listWater(tokenA)).map((e) => e.date)).toEqual([D2, D1]);
    });
  });

  describe('GET /water/summary/daily', () => {
    it('HEALTH-API-044: totals only that day, that user, and the live rows', async () => {
      await addWater(tokenA, { date: D1, amount_ml: 250 });
      await addWater(tokenA, { date: D1, amount_ml: 500 });
      await addWater(tokenA, { date: D2, amount_ml: 999 });
      await addWater(tokenB, { date: D1, amount_ml: 1000 });

      expect(await summaryFor(tokenA, D1)).toEqual({
        date: D1,
        total_ml: 750,
        goal_ml: null, // no goal row yet — null, never a fabricated default
        entry_count: 2,
      });
      expect(await summaryFor(tokenB, D1)).toMatchObject({ total_ml: 1000, entry_count: 1 });
    });

    it('HEALTH-API-045: the goal comes from the effective-dated row', async () => {
      await call('PUT', '/goals', {
        token: tokenA,
        body: { effective_date: D1, daily_water_ml: 2500 },
      });
      await addWater(tokenA, { date: D2, amount_ml: 250 });

      // Both RN surfaces divide this by their own unit — Home into cups (2500 /
      // 240 → 10) and the Water tab straight into millilitres — so one row has
      // to serve both.
      expect(await summaryFor(tokenA, D2)).toMatchObject({ goal_ml: 2500, total_ml: 250 });
      // Another user's goal is not this user's.
      expect((await summaryFor(tokenB, D2)).goal_ml).toBeNull();
    });

    it('HEALTH-API-046: a day with nothing logged is zeroes, not a 404', async () => {
      // Every client read-through starts here on a cold account; a 404 would be
      // swallowed by `readThrough` as "offline" and blank the ring.
      expect(await summaryFor(tokenA, D1)).toEqual({
        date: D1,
        total_ml: 0,
        goal_ml: null,
        entry_count: 0,
      });
    });

    it('HEALTH-API-047: an unparseable date is echoed back with zeroes, not rejected', async () => {
      // GAP (HEALTH-API-047): the handler checks the date is PRESENT but not
      // that it is well-formed (unlike every write route, which uses
      // `dateSchema`). A typo therefore reads as "nothing logged that day"
      // rather than a 400. Pinned so the asymmetry is visible; the fix is one
      // `dateSchema.safeParse`, but it is a behaviour change on a live route.
      const res = await call('GET', '/water/summary/daily?date=oops', { token: tokenA });
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({
        summary: { date: 'oops', total_ml: 0, goal_ml: null, entry_count: 0 },
      });
    });
  });

  /* ===================== TWO CLIENTS, ONE LEDGER ===================== */

  describe('the two RN writers share one ledger', () => {
    it('HEALTH-API-048: a ±cup write and a preset write total together', async () => {
      // Exactly what the app produces: Home's `adjustWater(+1)` posts 240 ml
      // with no container; the Water tab's Bottle preset posts 500 ml with one.
      await addWater(tokenA, { date: D1, amount_ml: 240 });
      await addWater(tokenA, { date: D1, amount_ml: 500, container: 'Bottle' });

      expect(await summaryFor(tokenA, D1)).toMatchObject({ total_ml: 740, entry_count: 2 });

      // Home's minus (undo) takes the NEWEST row — the bottle — because it has
      // no id to aim with. That is the documented asymmetry between the two
      // surfaces, and it is why the Water tab uses the per-entry delete instead.
      expect(await json(await call('POST', '/water/undo', { token: tokenA, body: { date: D1 } }))).toEqual(
        { removed: true }
      );
      expect(await summaryFor(tokenA, D1)).toMatchObject({ total_ml: 240, entry_count: 1 });
    });
  });
});
