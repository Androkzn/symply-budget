/**
 * Symply Health — the `/health/cycle/*` HTTP surface, at its EDGES.
 *
 * `health.test.ts` owns the happy path for this domain (settings singleton,
 * upsert by (user, date), the re-anchor on a new run, the two obvious 400s) and
 * the brand-gate / auth / user-scoping sweeps that cover every route including
 * these. This file is the other half: the boundary values of every zod
 * constraint, the states a soft-delete leaves behind, and one property nothing
 * else pins —
 *
 *   **`saveCycleSymptoms` spreads its patch straight into a D1 insert.**
 *   `{ id, user_id, date, created_at, updated_at, deleted_at, ...patch }` in
 *   `health-service.ts`. The ONLY thing standing between a client-supplied key
 *   and a column write is zod stripping unknown keys off the validated body. If
 *   that ever became a passthrough schema, a request could name `user_id` and
 *   write into somebody else's lane — on the most sensitive table in the app.
 *   HEALTH-CYCLE-186/187 assert the strip on both cycle routes.
 *
 * Why boundaries rather than more happy paths: every bound here is also
 * enforced on the client (`clampCycleLength`, `clampPeriodLength`, the 1–5 flow
 * scale, the 0–3 severity scale). A server that disagreed with the client would
 * either reject a value the app can produce — an unexplainable failure on a tap
 * — or accept one the app cannot render.
 *
 * Harness mirrors `health.test.ts`: `cloudflare:test` env, a jose HS256 JWT
 * whose `sub` becomes the user id, local DDL from `health-test-helpers`.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import healthRoutes from '../health';

import { createHealthTables, resetHealthTables, seedHealthUsers } from './health-test-helpers';

const testEnv = env as unknown as Env;
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;

const UID_A = 'u_cycle_alice';
const UID_B = 'u_cycle_bob';

const D1 = '2026-06-01';
const D2 = '2026-06-02';

let tokenA = '';
let tokenB = '';

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

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthRoutes);
  return app;
}

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

async function statusOf(method: string, path: string, body?: unknown): Promise<number> {
  return (await call(method, path, { body })).status;
}

/**
 * Read rows straight out of D1.
 *
 * The shared helper's `readHealthRow` looks up by primary key, and these tables
 * are keyed by a generated id — the interesting lookup here is always
 * (user_id, date), and several cases have to assert what landed in a column the
 * response body does not echo back.
 */
async function rowsWhere<T = Record<string, unknown>>(
  table: string,
  where: string,
  binds: unknown[] = []
): Promise<T[]> {
  const res = await testEnv.DB.prepare(`SELECT * FROM ${table} WHERE ${where}`)
    .bind(...binds)
    .all<T>();
  return res.results ?? [];
}

describe('health cycle routes — boundaries and states', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);
  });

  /* ================== settings validation boundaries ================== */

  describe('PUT /cycle/settings', () => {
    it('HEALTH-CYCLE-176: accepts the whole 20–45 / 1–14 range and nothing outside it', async () => {
      // These are the SAME bounds `clampCycleLength` / `clampPeriodLength` use on
      // the client. A server that stopped at 44 would reject a value the app is
      // happy to send, and the tap would fail with nothing to explain it.
      for (const cycle_length of [20, 45]) {
        expect(await statusOf('PUT', '/cycle/settings', { cycle_length })).toBe(200);
      }
      for (const period_length of [1, 14]) {
        expect(await statusOf('PUT', '/cycle/settings', { period_length })).toBe(200);
      }
      expect(await statusOf('PUT', '/cycle/settings', { cycle_length: 19 })).toBe(400);
      expect(await statusOf('PUT', '/cycle/settings', { cycle_length: 46 })).toBe(400);
      expect(await statusOf('PUT', '/cycle/settings', { period_length: 0 })).toBe(400);
      expect(await statusOf('PUT', '/cycle/settings', { period_length: 15 })).toBe(400);
      // Whole days only — a fractional cycle length is not a thing a body has,
      // and it would make every derived date land between two days.
      expect(await statusOf('PUT', '/cycle/settings', { cycle_length: 28.5 })).toBe(400);
    });

    it('HEALTH-CYCLE-177: the anchor may be CLEARED, but only with a real day key', async () => {
      // Clearing is how "I deleted my last period day" reaches the settings, and
      // it is what brings the empty state back. It must be distinguishable from
      // "I did not mention the anchor", which leaves it alone.
      await call('PUT', '/cycle/settings', { body: { last_period_start: D1 } });
      await call('PUT', '/cycle/settings', { body: { cycle_length: 30 } });
      expect(
        (
          await json<{ settings: { last_period_start: string | null } }>(
            await call('GET', '/cycle/settings')
          )
        ).settings.last_period_start
      ).toBe(D1);

      expect(await statusOf('PUT', '/cycle/settings', { last_period_start: null })).toBe(200);
      expect(
        (
          await json<{ settings: { last_period_start: string | null } }>(
            await call('GET', '/cycle/settings')
          )
        ).settings.last_period_start
      ).toBeNull();

      // A timestamp is the shape a naive client would send; it is not a local day.
      expect(
        await statusOf('PUT', '/cycle/settings', { last_period_start: '2026-06-01T00:00:00Z' })
      ).toBe(400);
      expect(await statusOf('PUT', '/cycle/settings', { last_period_start: '2026-6-1' })).toBe(400);
    });

    it('HEALTH-CYCLE-178: an empty body is a no-op that still creates the donor defaults', async () => {
      // The client PUTs the whole row, but the schema makes every field optional.
      // An empty PUT must not blank the row it was meant to patch.
      const created = await json<{
        settings: { cycle_length: number; period_length: number; last_period_start: string | null };
      }>(await call('PUT', '/cycle/settings', { body: {} }));
      expect(created.settings).toMatchObject({
        cycle_length: 28,
        period_length: 5,
        last_period_start: null,
      });

      await call('PUT', '/cycle/settings', { body: { cycle_length: 31, last_period_start: D1 } });
      await call('PUT', '/cycle/settings', { body: {} });
      const after = await json<{
        settings: { cycle_length: number; last_period_start: string | null };
      }>(await call('GET', '/cycle/settings'));
      expect(after.settings).toMatchObject({ cycle_length: 31, last_period_start: D1 });
    });
  });

  /* ==================== period log boundaries ========================= */

  describe('POST /cycle/periods', () => {
    it('HEALTH-CYCLE-179: the donor flow scale is 1–5 inclusive, whole numbers only', async () => {
      // 1 = spotting, 5 = very heavy. The client maps names to these numbers, so
      // a rejected 1 or 5 would make two of the five chips dead.
      for (const flow_level of [1, 2, 3, 4, 5]) {
        expect(
          await statusOf('POST', '/cycle/periods', { date: `2026-06-0${flow_level}`, flow_level })
        ).toBe(200);
      }
      expect(await statusOf('POST', '/cycle/periods', { date: D1, flow_level: 0 })).toBe(400);
      expect(await statusOf('POST', '/cycle/periods', { date: D1, flow_level: 6 })).toBe(400);
      expect(await statusOf('POST', '/cycle/periods', { date: D1, flow_level: 2.5 })).toBe(400);
      // `date` and `flow_level` are both required — a body with neither must not
      // create a row against some default day.
      expect(await statusOf('POST', '/cycle/periods', { flow_level: 3 })).toBe(400);
      expect(await statusOf('POST', '/cycle/periods', { date: D1 })).toBe(400);
    });

    it('HEALTH-CYCLE-180: a note up to 500 characters is stored; 501 is refused', async () => {
      // The client caps at 200. The server cap is the backstop for any other
      // writer (sync push, a future import), and it must reject rather than
      // silently truncate — a half-sentence is worse than an error.
      expect(
        await statusOf('POST', '/cycle/periods', {
          date: D1,
          flow_level: 3,
          notes: 'n'.repeat(500),
        })
      ).toBe(200);
      expect(
        await statusOf('POST', '/cycle/periods', {
          date: D2,
          flow_level: 3,
          notes: 'n'.repeat(501),
        })
      ).toBe(400);

      const [row] = await rowsWhere<{ notes: string }>(
        'period_entries',
        'user_id = ? AND date = ?',
        [UID_A, D1]
      );
      expect(row.notes).toHaveLength(500);
    });

    it('HEALTH-CYCLE-181: re-logging a day the member DELETED brings it back, not a duplicate', async () => {
      // Delete is a soft delete (`deleted_at`), and the upsert conflicts on
      // (user_id, date) — so without the explicit `deleted_at: null` in the
      // update set, a re-logged day would stay invisible while its row blocked
      // any new one. "I deleted it by mistake" is a completely ordinary action.
      await call('POST', '/cycle/periods', { body: { date: D1, flow_level: 3 } });
      expect((await call('DELETE', `/cycle/periods/${D1}`)).status).toBe(200);
      expect(
        (await json<{ periods: unknown[] }>(await call('GET', '/cycle/periods'))).periods
      ).toEqual([]);

      const relogged = await json<{ periods: Array<{ date: string; flow_level: number }> }>(
        await call('POST', '/cycle/periods', { body: { date: D1, flow_level: 5 } })
      );
      expect(relogged.periods).toEqual([expect.objectContaining({ date: D1, flow_level: 5 })]);

      // Exactly one physical row for the date — a second would double-count the
      // day in every period-length average derived from the log.
      expect(await rowsWhere('period_entries', 'user_id = ? AND date = ?', [UID_A, D1])).toHaveLength(
        1
      );
    });

    it('HEALTH-CYCLE-182: a repeat delete of the same day 404s; a day you never logged 404s too', async () => {
      // The screen offers the delete from TWO controls for the same day (the
      // selected-day card and its history row), so a double fire is ordinary.
      //
      // FIXED: the soft delete now guards `deleted_at IS NULL` in its WHERE,
      // matching the weight/nutrition/water/habit/measurement/health-entry
      // deleters. A second delete no longer matches the tombstone, so it does
      // not re-stamp `updated_at` on a dead row, and answers 404 like every
      // other "already gone" case — the day being gone either way, from the
      // client's point of view, is unchanged.
      await call('POST', '/cycle/periods', { body: { date: D1, flow_level: 3 } });
      expect((await call('DELETE', `/cycle/periods/${D1}`)).status).toBe(200);
      expect((await call('DELETE', `/cycle/periods/${D1}`)).status).toBe(404);
      // A date that was NEVER logged is a genuine 404 — the two cases are not
      // collapsed into one answer.
      expect((await call('DELETE', '/cycle/periods/2026-01-01')).status).toBe(404);
      // …and another member's logged day is a 404 too, never a delete.
      await call('POST', '/cycle/periods', { token: tokenB, body: { date: D2, flow_level: 3 } });
      expect((await call('DELETE', `/cycle/periods/${D2}`)).status).toBe(404);
      expect(
        (await json<{ periods: unknown[] }>(await call('GET', '/cycle/periods', { token: tokenB })))
          .periods
      ).toHaveLength(1);
    });

    it('HEALTH-CYCLE-183: the POST answers with the settings the write itself re-anchored', async () => {
      // The client re-reads settings after every logged day precisely because
      // the server owns the re-anchor rule. The response carrying them is what
      // lets the screen repaint the phase without a second round trip.
      const body = await json<{
        periods: unknown[];
        settings: { last_period_start: string } | null;
      }>(await call('POST', '/cycle/periods', { body: { date: D1, flow_level: 3 } }));

      expect(body.settings).toMatchObject({ last_period_start: D1 });
      expect(body.periods).toHaveLength(1);
    });
  });

  /* ==================== symptom log boundaries ======================== */

  describe('PUT /cycle/symptoms', () => {
    it('HEALTH-CYCLE-184: severity is 0–3, where 0 is a CLEAR and null is "not stated"', async () => {
      // The client writes every column on every save — 0 for the chips that are
      // off — so 0 has to be a legal value or clearing a symptom would 400.
      expect(await statusOf('PUT', '/cycle/symptoms', { date: D1, cramps: 0 })).toBe(200);
      expect(await statusOf('PUT', '/cycle/symptoms', { date: D1, cramps: 3 })).toBe(200);
      expect(await statusOf('PUT', '/cycle/symptoms', { date: D1, cramps: null })).toBe(200);
      expect(await statusOf('PUT', '/cycle/symptoms', { date: D1, cramps: -1 })).toBe(400);
      expect(await statusOf('PUT', '/cycle/symptoms', { date: D1, cramps: 4 })).toBe(400);

      // …and clearing really clears: 3 then 0 leaves 0, not 3.
      await call('PUT', '/cycle/symptoms', { body: { date: D2, cramps: 3 } });
      await call('PUT', '/cycle/symptoms', { body: { date: D2, cramps: 0 } });
      const [row] = await rowsWhere<{ cramps: number }>(
        'cycle_symptom_entries',
        'user_id = ? AND date = ?',
        [UID_A, D2]
      );
      expect(row.cramps).toBe(0);
    });

    it('HEALTH-CYCLE-185: mood, energy, sleep and libido are all 1–5, and all nullable', async () => {
      // Four scales on the same table with the same band. `sleep_quality` is the
      // newest client of it — the Cycle screen's Sleep row — so its bounds are
      // pinned beside the three that already had a writer.
      for (const field of ['mood', 'energy', 'sleep_quality', 'libido']) {
        expect([field, await statusOf('PUT', '/cycle/symptoms', { date: D1, [field]: 1 })]).toEqual([
          field,
          200,
        ]);
        expect([field, await statusOf('PUT', '/cycle/symptoms', { date: D1, [field]: 5 })]).toEqual([
          field,
          200,
        ]);
        expect([
          field,
          await statusOf('PUT', '/cycle/symptoms', { date: D1, [field]: null }),
        ]).toEqual([field, 200]);
        expect([field, await statusOf('PUT', '/cycle/symptoms', { date: D1, [field]: 0 })]).toEqual([
          field,
          400,
        ]);
        expect([field, await statusOf('PUT', '/cycle/symptoms', { date: D1, [field]: 6 })]).toEqual([
          field,
          400,
        ]);
      }

      const saved = await json<{ entry: { sleep_quality: number } }>(
        await call('PUT', '/cycle/symptoms', { body: { date: D2, sleep_quality: 4 } })
      );
      expect(saved.entry.sleep_quality).toBe(4);
    });

    it('HEALTH-CYCLE-186: only the six donor cravings are accepted', async () => {
      // A free-text craving would reach the column and come back as a chip the
      // screen has no key for, which renders as nothing at all.
      for (const cravings of ['none', 'sweet', 'salty', 'chocolate', 'carbs', 'spicy']) {
        expect([cravings, await statusOf('PUT', '/cycle/symptoms', { date: D1, cravings })]).toEqual(
          [cravings, 200]
        );
      }
      expect(await statusOf('PUT', '/cycle/symptoms', { date: D1, cravings: 'umami' })).toBe(400);
      expect(await statusOf('PUT', '/cycle/symptoms', { date: D1, cravings: null })).toBe(400);
    });

    it('HEALTH-CYCLE-187: an UNKNOWN key in the body never reaches a column', async () => {
      // `saveCycleSymptoms` spreads the validated patch straight into the insert
      // AND into the conflict update. zod stripping unknown keys is the only
      // thing between a request body and an arbitrary column write — on the most
      // sensitive table in the app. If this ever fails, the fix is the schema,
      // not the test.
      const res = await call('PUT', '/cycle/symptoms', {
        body: {
          date: D1,
          mood: 3,
          user_id: UID_B, // would move the row into another member's lane
          deleted_at: '2026-01-01T00:00:00.000Z', // would hide it from its owner
          notes_html: '<b>x</b>', // a column that does not exist → SQL error
        },
      });
      expect(res.status).toBe(200);

      const [row] = await rowsWhere<{ user_id: string; mood: number; deleted_at: string | null }>(
        'cycle_symptom_entries',
        'date = ?',
        [D1]
      );
      expect(row).toMatchObject({ user_id: UID_A, mood: 3, deleted_at: null });
      // …and the row is readable by its owner, which is the behavioural proof
      // that neither the ownership nor the tombstone column moved.
      expect(
        (await json<{ symptoms: unknown[] }>(await call('GET', '/cycle/symptoms'))).symptoms
      ).toHaveLength(1);
      expect(
        (
          await json<{ symptoms: unknown[] }>(await call('GET', '/cycle/symptoms', { token: tokenB }))
        ).symptoms
      ).toEqual([]);
    });

    it('HEALTH-CYCLE-188: an unknown key cannot be smuggled through the SETTINGS route either', async () => {
      // Same shape of risk on the other cycle writer: `saveCycleSettings` merges
      // `{ ...existing, ...patch }` and writes the result whole.
      const res = await call('PUT', '/cycle/settings', {
        body: { cycle_length: 30, user_id: UID_B, id: 'cyc_forced' },
      });
      expect(res.status).toBe(200);

      const rows = await rowsWhere<{ user_id: string; id: string; cycle_length: number }>(
        'cycle_settings',
        '1 = 1'
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: UID_A, cycle_length: 30 });
      expect(rows[0].id).not.toBe('cyc_forced');
    });

    it('HEALTH-CYCLE-189: a symptom note is capped at 500, and a bad date is refused', async () => {
      expect(
        await statusOf('PUT', '/cycle/symptoms', { date: D1, notes: 'n'.repeat(500) })
      ).toBe(200);
      expect(
        await statusOf('PUT', '/cycle/symptoms', { date: D1, notes: 'n'.repeat(501) })
      ).toBe(400);
      expect(await statusOf('PUT', '/cycle/symptoms', { date: 'today', mood: 3 })).toBe(400);
      expect(await statusOf('PUT', '/cycle/symptoms', { mood: 3 })).toBe(400);
    });
  });

  /* ========================= read isolation =========================== */

  describe('GET /cycle/*', () => {
    it('HEALTH-CYCLE-190: a soft-deleted period day is gone from the list but the symptoms stay', async () => {
      // The two logs are independent: deleting a bleeding day must not take the
      // mood and symptoms recorded on the same date with it. They are different
      // records of the same day, and only one of them was deleted.
      await call('POST', '/cycle/periods', { body: { date: D1, flow_level: 3 } });
      await call('PUT', '/cycle/symptoms', { body: { date: D1, mood: 4, cramps: 2 } });

      await call('DELETE', `/cycle/periods/${D1}`);

      expect(
        (await json<{ periods: unknown[] }>(await call('GET', '/cycle/periods'))).periods
      ).toEqual([]);
      const { symptoms } = await json<{ symptoms: Array<{ mood: number; cramps: number }> }>(
        await call('GET', '/cycle/symptoms')
      );
      expect(symptoms).toHaveLength(1);
      expect(symptoms[0]).toMatchObject({ mood: 4, cramps: 2 });
    });

    it('HEALTH-CYCLE-191: periods come back newest-first, which is the order the screen renders', async () => {
      // `loadPeriodEntries` re-sorts defensively, but the history list and the
      // six-row cap are applied to whatever arrives — so a server that returned
      // oldest-first would show the six OLDEST days under "RECENT PERIOD DAYS".
      for (const date of ['2026-06-03', '2026-06-01', '2026-06-02']) {
        await call('POST', '/cycle/periods', { body: { date, flow_level: 3 } });
      }
      const { periods } = await json<{ periods: Array<{ date: string }> }>(
        await call('GET', '/cycle/periods')
      );
      expect(periods.map((p) => p.date)).toEqual(['2026-06-03', '2026-06-02', '2026-06-01']);
    });
  });
});
