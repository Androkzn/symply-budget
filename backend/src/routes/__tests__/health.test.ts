/**
 * Symply Health routes (`src/routes/health.ts`) — HTTP surface of the ported
 * donor domain, driven through the real Hono router against a live miniflare D1.
 *
 * Three layers, in order of importance:
 *   1. BRAND GATE — `requireHealthApi()` must 404 every single path on
 *      House/Budget/Kaizen. The gate is registered before `authMiddleware()`,
 *      so a wrong-brand request must never even reach the token check.
 *   2. AUTH — on the Health Worker every path is 401 without a valid bearer.
 *   3. USER SCOPING — health data is PERSONAL and household-free: user B must
 *      never read, update or delete a row owned by user A. This is the security
 *      property the whole domain rests on (routes/health.ts header, BRD §7).
 *
 * Everything below that is the per-domain HTTP contract (status codes, response
 * envelopes, validation) — the derived-figure maths lives in
 * services/__tests__/health-service.test.ts.
 *
 * Harness mirrors kaizen-sync.test.ts / mortgage.test.ts: `cloudflare:test` env,
 * a jose HS256 JWT whose `sub` becomes the user id, brand flipped by spreading
 * a new APP_BRAND onto the pool env, and local DDL from health-test-helpers.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import healthRoutes from '../health';

import {
  createHealthTables,
  resetHealthTables,
  seedHealthUsers,
  HEALTH_EXERCISE_TABLE_NAMES,
  HEALTH_FOOD_TABLE_NAMES,
  HEALTH_P2_ASSETS_TABLE_NAMES,
  HEALTH_P2_BODY_EXTRAS_TABLE_NAMES,
  HEALTH_P3_AI_TABLE_NAMES,
  HEALTH_SOCIAL_TABLE_NAMES,
  HEALTH_TABLE_NAMES,
} from './health-test-helpers';

const testEnv = env as unknown as Env;

// The pool env is House (wrangler.toml); each brand gets its own copy so a
// single request can be replayed across the fleet.
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;
const HOUSE_ENV = { ...testEnv, APP_BRAND: 'symply-house' } as Env;
const BUDGET_ENV = { ...testEnv, APP_BRAND: 'symply-budget' } as Env;
const KAIZEN_ENV = { ...testEnv, APP_BRAND: 'symply-kaizen' } as Env;

const UID_A = 'u_health_alice';
const UID_B = 'u_health_bob';

/** Fixed "personal" dates — nothing here depends on the wall clock. */
const D1 = '2026-06-01';
const D2 = '2026-06-02';
const D3 = '2026-06-03';

/** Today/offset in the same UTC basis `streakOf()` uses for its default. */
function dayOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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
  opts: { token?: string | null; body?: unknown; brandEnv?: Env } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = opts.token === undefined ? tokenA : opts.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return mkApp().request(
    `/health${path}`,
    {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    },
    opts.brandEnv ?? HEALTH_ENV
  );
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Every path the router owns — the gate/auth sweeps must cover all of them. */
const ROUTES: ReadonlyArray<readonly [string, string, unknown?]> = [
  ['GET', '/weight/entries'],
  ['POST', '/weight/entries', { date: D1, weight: 70, unit: 'kg' }],
  ['PUT', '/weight/entries/w_x', { weight: 71 }],
  ['DELETE', '/weight/entries/w_x'],
  ['GET', '/weight/statistics'],
  ['GET', '/weight/weekly-averages'],
  ['GET', '/water/entries'],
  ['POST', '/water/entries', { date: D1, amount_ml: 250 }],
  ['DELETE', '/water/entries/h2o_x'],
  ['POST', '/water/undo', { date: D1 }],
  ['GET', '/water/summary/daily?date=2026-06-01'],
  ['GET', '/nutrition/entries'],
  ['POST', '/nutrition/entries', { date: D1, food_name: 'Egg', meal_type: 'breakfast', calories: 70 }],
  ['PUT', '/nutrition/entries/n_x', { calories: 80 }],
  ['POST', '/nutrition/entries/n_x/portion', { portion: 200 }],
  ['DELETE', '/nutrition/entries/n_x'],
  ['GET', '/nutrition/summary?date=2026-06-01'],
  ['GET', '/measurements'],
  ['GET', '/measurements/latest'],
  ['POST', '/measurements', { date: D1, unit: 'cm', waist: 80 }],
  ['DELETE', '/measurements/bm_x'],
  ['GET', '/entries'],
  ['POST', '/entries', { date: D1, entry_type: 'sleep', data: { hours: 8 } }],
  ['PUT', '/entries/he_x', { data: { hours: 7 } }],
  ['POST', '/entries/steps', { date: D1, steps: 1000 }],
  ['POST', '/entries/workouts', { date: D1, workout_type: 'run', minutes: 30 }],
  ['PUT', '/entries/workouts/he_x', { minutes: 45 }],
  ['DELETE', '/entries/he_x'],
  ['GET', '/goals'],
  ['PUT', '/goals', { daily_calories: 2100 }],
  ['GET', '/habits'],
  ['POST', '/habits', { name: 'Stretch' }],
  ['DELETE', '/habits/habit_x'],
  ['POST', '/habits/habit_x/toggle', { date: D1 }],
  ['GET', '/cycle/settings'],
  ['PUT', '/cycle/settings', { cycle_length: 28 }],
  ['GET', '/cycle/periods'],
  ['POST', '/cycle/periods', { date: D1, flow_level: 3 }],
  ['DELETE', '/cycle/periods/2026-06-01'],
  ['GET', '/cycle/symptoms'],
  ['PUT', '/cycle/symptoms', { date: D1, mood: 3 }],
  ['GET', '/mens-health/entries'],
  ['PUT', '/mens-health/entries', { date: D1, libido: 5 }],
  ['GET', '/mens-health/settings'],
  ['PUT', '/mens-health/settings', { track_libido: false }],
  ['GET', '/summary'],
  ['GET', '/sync'],
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

async function createWeight(
  token: string,
  body: {
    date: string;
    weight: number;
    unit: string;
    note?: string;
    /** 0122 — the HealthKit importer's origin flag; absent means 'manual'. */
    source?: 'manual' | 'healthkit';
  }
): Promise<string> {
  const res = await call('POST', '/weight/entries', { token, body });
  expect(res.status).toBe(201);
  return (await json<{ entry: { id: string } }>(res)).entry.id;
}

describe('health routes', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);
  });

  /* ====================== 1. BRAND GATE ============================== */

  describe('brand gate (requireHealthApi)', () => {
    // A shared-fleet deploy puts these routes on every Worker binary. The gate
    // is the only thing stopping House/Budget/Kaizen from serving health data,
    // so it is swept across EVERY path rather than a sample.
    it.each([
      ['symply-house', HOUSE_ENV],
      ['symply-budget', BUDGET_ENV],
      ['symply-kaizen', KAIZEN_ENV],
    ])('404s every /health route on %s', async (_brand, brandEnv) => {
      const leaked: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body, brandEnv });
        if (!(await isGate404(res))) leaked.push(`${method} ${path} -> ${res.status}`);
      }
      expect(leaked).toEqual([]);
    });

    it('fires BEFORE auth — a tokenless wrong-brand request 404s, never 401s', async () => {
      // Ordering matters: a 401 would confirm the surface exists on that brand.
      const res = await call('GET', '/weight/entries', { token: null, brandEnv: BUDGET_ENV });
      expect(res.status).toBe(404);
      expect(await json<{ error: { message: string } }>(res)).toEqual({
        error: { code: 'not_found', message: GATE_MESSAGE },
      });
    });

    it('never fires on symply-health — every route is reachable there', async () => {
      // A 404 on the Health Worker may only be a real "Entry not found"; the
      // generic gate message would mean the capability table regressed.
      const gated: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body });
        if (await isGate404(res)) gated.push(`${method} ${path}`);
      }
      expect(gated).toEqual([]);
    });

    it('no route 5xxs on a cold, empty account', async () => {
      // Smoke sweep: every handler must survive an empty database. This used to
      // carry one documented exception (the FK crash on an unknown habit id);
      // with BUG-2 fixed the list is empty, and must stay that way.
      const crashed: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body });
        if (res.status >= 500) crashed.push(`${method} ${path}`);
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
      const res = await call('GET', '/weight/entries', { token: forged });
      expect(res.status).toBe(401);
    });

    it('401s a malformed bearer value', async () => {
      const res = await call('GET', '/weight/entries', { token: 'not-a-jwt' });
      expect(res.status).toBe(401);
    });
  });

  /* ====================== 3. USER SCOPING ============================= */

  describe('user scoping (personal data, no household)', () => {
    it('never leaks another user rows in any list endpoint', async () => {
      // A writes one row in every list-backed domain…
      await createWeight(tokenA, { date: D1, weight: 70, unit: 'kg' });
      await call('POST', '/water/entries', { token: tokenA, body: { date: D1, amount_ml: 250 } });
      await call('POST', '/nutrition/entries', {
        token: tokenA,
        body: { date: D1, food_name: 'Egg', meal_type: 'breakfast', calories: 70 },
      });
      await call('POST', '/measurements', { token: tokenA, body: { date: D1, unit: 'cm', waist: 80 } });
      await call('POST', '/entries/steps', { token: tokenA, body: { date: D1, steps: 8000 } });
      await call('POST', '/habits', { token: tokenA, body: { name: 'Stretch' } });
      await call('POST', '/cycle/periods', { token: tokenA, body: { date: D1, flow_level: 3 } });
      await call('PUT', '/cycle/symptoms', { token: tokenA, body: { date: D1, mood: 4 } });
      await call('PUT', '/mens-health/entries', { token: tokenA, body: { date: D1, libido: 6 } });
      await call('PUT', '/cycle/settings', { token: tokenA, body: { cycle_length: 30 } });
      await call('PUT', '/mens-health/settings', { token: tokenA, body: { track_libido: false } });
      await call('PUT', '/goals', { token: tokenA, body: { effective_date: D1, daily_calories: 2222 } });

      // …and B, holding a perfectly valid token, sees none of it.
      const empties: Array<[string, string]> = [
        ['/weight/entries', 'entries'],
        ['/water/entries', 'entries'],
        ['/nutrition/entries', 'entries'],
        ['/measurements', 'measurements'],
        ['/entries', 'entries'],
        ['/habits', 'habits'],
        ['/cycle/periods', 'periods'],
        ['/cycle/symptoms', 'symptoms'],
        ['/mens-health/entries', 'entries'],
        ['/weight/weekly-averages', 'weeks'],
      ];
      const leaks: string[] = [];
      for (const [path, key] of empties) {
        const res = await call('GET', path, { token: tokenB });
        const rows = (await json<Record<string, unknown[]>>(res))[key];
        if (rows.length !== 0) leaks.push(`${path} -> ${rows.length}`);
      }
      expect(leaks).toEqual([]);

      // Singleton reads are scoped too.
      expect((await json<{ measurement: unknown }>(
        await call('GET', '/measurements/latest', { token: tokenB })
      )).measurement).toBeNull();
      expect((await json<{ settings: unknown }>(
        await call('GET', '/cycle/settings', { token: tokenB })
      )).settings).toBeNull();
      expect((await json<{ settings: unknown }>(
        await call('GET', '/mens-health/settings', { token: tokenB })
      )).settings).toBeNull();
      expect((await json<{ goal: unknown }>(
        await call('GET', `/goals?date=${D1}`, { token: tokenB })
      )).goal).toBeNull();
      const syncB = await json<{ weight_entries: unknown[]; period_entries: unknown[] }>(
        await call('GET', '/sync', { token: tokenB })
      );
      expect(syncB.weight_entries).toEqual([]);
      expect(syncB.period_entries).toEqual([]);
    });

    it('404s every cross-user mutation by id and leaves the row intact', async () => {
      const weightId = await createWeight(tokenA, { date: D1, weight: 70, unit: 'kg' });
      const waterId = (
        await json<{ entry: { id: string } }>(
          await call('POST', '/water/entries', { token: tokenA, body: { date: D1, amount_ml: 250 } })
        )
      ).entry.id;
      const nutritionId = (
        await json<{ entry: { id: string } }>(
          await call('POST', '/nutrition/entries', {
            token: tokenA,
            body: { date: D1, food_name: 'Egg', meal_type: 'breakfast', calories: 70 },
          })
        )
      ).entry.id;
      const measurementId = (
        await json<{ measurement: { id: string } }>(
          await call('POST', '/measurements', { token: tokenA, body: { date: D1, unit: 'cm', waist: 80 } })
        )
      ).measurement.id;
      const entryId = (
        await json<{ entry: { id: string } }>(
          await call('POST', '/entries/workouts', {
            token: tokenA,
            body: { date: D1, workout_type: 'run', minutes: 30 },
          })
        )
      ).entry.id;
      const habitId = (
        await json<{ habit: { id: string } }>(
          await call('POST', '/habits', { token: tokenA, body: { name: 'Stretch' } })
        )
      ).habit.id;

      const attacks: Array<[string, string, unknown?]> = [
        ['PUT', `/weight/entries/${weightId}`, { weight: 999 }],
        ['DELETE', `/weight/entries/${weightId}`],
        ['DELETE', `/water/entries/${waterId}`],
        ['PUT', `/nutrition/entries/${nutritionId}`, { calories: 9999 }],
        ['POST', `/nutrition/entries/${nutritionId}/portion`, { portion: 999 }],
        ['DELETE', `/nutrition/entries/${nutritionId}`],
        ['DELETE', `/measurements/${measurementId}`],
        ['PUT', `/entries/${entryId}`, { date: D3 }],
        ['PUT', `/entries/workouts/${entryId}`, { minutes: 999 }],
        ['DELETE', `/entries/${entryId}`],
        ['DELETE', `/habits/${habitId}`],
        ['DELETE', `/cycle/periods/${D1}`],
      ];
      const allowed: string[] = [];
      for (const [method, path, body] of attacks) {
        const res = await call(method, path, { token: tokenB, body });
        if (res.status !== 404) allowed.push(`${method} ${path} -> ${res.status}`);
      }
      expect(allowed).toEqual([]);

      // A's rows survive untouched.
      const weights = await json<{ entries: Array<{ weight: number }> }>(
        await call('GET', '/weight/entries', { token: tokenA })
      );
      expect(weights.entries).toHaveLength(1);
      expect(weights.entries[0].weight).toBe(70);
      const nutrition = await json<{ entries: Array<{ calories: number }> }>(
        await call('GET', '/nutrition/entries', { token: tokenA })
      );
      expect(nutrition.entries[0].calories).toBe(70);
      expect(
        (await json<{ entries: unknown[] }>(await call('GET', '/water/entries', { token: tokenA })))
          .entries
      ).toHaveLength(1);
      expect(
        (await json<{ measurements: unknown[] }>(await call('GET', '/measurements', { token: tokenA })))
          .measurements
      ).toHaveLength(1);
      expect(
        (await json<{ entries: unknown[] }>(await call('GET', '/entries', { token: tokenA }))).entries
      ).toHaveLength(1);
      expect(
        (await json<{ habits: unknown[] }>(await call('GET', '/habits', { token: tokenA }))).habits
      ).toHaveLength(1);
    });

    it('keeps per-date upserts (cycle / mens-health / goals) in separate user lanes', async () => {
      // These tables are keyed by (user_id, date), not by an opaque id — the
      // classic place for a missing user filter to silently overwrite.
      await call('POST', '/cycle/periods', { token: tokenA, body: { date: D1, flow_level: 2 } });
      await call('POST', '/cycle/periods', { token: tokenB, body: { date: D1, flow_level: 5 } });
      await call('PUT', '/mens-health/entries', { token: tokenA, body: { date: D1, libido: 3 } });
      await call('PUT', '/mens-health/entries', { token: tokenB, body: { date: D1, libido: 9 } });
      await call('PUT', '/goals', { token: tokenA, body: { effective_date: D1, daily_calories: 1800 } });
      await call('PUT', '/goals', { token: tokenB, body: { effective_date: D1, daily_calories: 3000 } });

      const periodsA = await json<{ periods: Array<{ flow_level: number }> }>(
        await call('GET', '/cycle/periods', { token: tokenA })
      );
      expect(periodsA.periods).toHaveLength(1);
      expect(periodsA.periods[0].flow_level).toBe(2);

      const mensA = await json<{ entries: Array<{ libido: number }> }>(
        await call('GET', '/mens-health/entries', { token: tokenA })
      );
      expect(mensA.entries[0].libido).toBe(3);

      expect(
        (
          await json<{ goal: { daily_calories: number } }>(
            await call('GET', `/goals?date=${D1}`, { token: tokenA })
          )
        ).goal.daily_calories
      ).toBe(1800);
      expect(
        (
          await json<{ goal: { daily_calories: number } }>(
            await call('GET', `/goals?date=${D1}`, { token: tokenB })
          )
        ).goal.daily_calories
      ).toBe(3000);
    });

    it('cannot toggle another user habit id — their completion day survives', async () => {
      // The highest-severity hole this suite covers: without an ownership check,
      // any authenticated Health user holding someone else's habit id could
      // soft-delete THEIR completion day and silently break their streak.
      // Fixed 2026-07-25 (was BUG-1).
      const habitId = (
        await json<{ habit: { id: string } }>(
          await call('POST', '/habits', { token: tokenA, body: { name: 'Stretch' } })
        )
      ).habit.id;
      await call('POST', `/habits/${habitId}/toggle`, { token: tokenA, body: { date: D1 } });
      expect(
        (
          await json<{ habits: Array<{ days: string[] }> }>(
            await call('GET', '/habits', { token: tokenA })
          )
        ).habits[0].days
      ).toEqual([D1]);

      const res = await call(`POST`, `/habits/${habitId}/toggle`, {
        token: tokenB,
        body: { date: D1 },
      });
      // 404, not 403 — a 403 would confirm the id exists on another account.
      expect(res.status).toBe(404);

      const daysA = (
        await json<{ habits: Array<{ days: string[] }> }>(
          await call('GET', '/habits', { token: tokenA })
        )
      ).habits[0].days;
      expect(daysA).toEqual([D1]);
    });
  });

  /* ================ 4. THE TOMBSTONE CONTRACT ======================== */

  /**
   * A tombstoned row must be INDISTINGUISHABLE from one that never existed.
   *
   * Two things ride on that. The privacy one: 404 is already the answer for an
   * unknown id and for someone else's id, so a deleted id answering anything
   * else hands a prober a third signal. The data one is worse — an edit that
   * lands on a tombstone re-stamps `updated_at` on a dead row, so the delta pull
   * ships a tombstone whose figures have changed, and on a device that has not
   * yet applied the delete that reads as a value moving on an entry that is
   * gone. `reportionNutrition` and `readOwnedEntry` already stated this rule in
   * their own comments; `updateWeight` and `updateNutrition` did not follow it.
   */
  describe('soft delete (tombstone) contract', () => {
    it('404s every edit route on a row the caller has already deleted', async () => {
      const weightId = await createWeight(tokenA, { date: D1, weight: 70, unit: 'kg' });
      const nutritionId = (
        await json<{ entry: { id: string } }>(
          await call('POST', '/nutrition/entries', {
            token: tokenA,
            body: {
              date: D1,
              food_name: 'Egg',
              meal_type: 'breakfast',
              calories: 70,
              portion: 100,
              unit: 'g',
              base_calories_per_100: 70,
            },
          })
        )
      ).entry.id;
      const entryId = (
        await json<{ entry: { id: string } }>(
          await call('POST', '/entries/workouts', {
            token: tokenA,
            body: { date: D1, workout_type: 'run', minutes: 30 },
          })
        )
      ).entry.id;

      await call('DELETE', `/weight/entries/${weightId}`, { token: tokenA });
      await call('DELETE', `/nutrition/entries/${nutritionId}`, { token: tokenA });
      await call('DELETE', `/entries/${entryId}`, { token: tokenA });

      const edits: Array<[string, string, unknown]> = [
        ['PUT', `/weight/entries/${weightId}`, { weight: 999 }],
        ['PUT', `/nutrition/entries/${nutritionId}`, { calories: 9999 }],
        ['POST', `/nutrition/entries/${nutritionId}/portion`, { portion: 250 }],
        ['PUT', `/entries/${entryId}`, { date: D3 }],
        ['PUT', `/entries/workouts/${entryId}`, { minutes: 999 }],
      ];
      const answered: string[] = [];
      for (const [method, path, body] of edits) {
        const res = await call(method, path, { token: tokenA, body });
        if (res.status !== 404) answered.push(`${method} ${path} -> ${res.status}`);
      }
      expect(answered).toEqual([]);
    });

    it('leaves the tombstone byte-for-byte untouched — no updated_at bump, no new figures', async () => {
      const weightId = await createWeight(tokenA, { date: D1, weight: 70, unit: 'kg' });
      await call('DELETE', `/weight/entries/${weightId}`, { token: tokenA });

      const before = await testEnv.DB.prepare(
        'SELECT weight, updated_at, deleted_at FROM weight_entries WHERE id = ?'
      )
        .bind(weightId)
        .first<{ weight: number; updated_at: string; deleted_at: string }>();

      await call('PUT', `/weight/entries/${weightId}`, { token: tokenA, body: { weight: 999 } });

      const after = await testEnv.DB.prepare(
        'SELECT weight, updated_at, deleted_at FROM weight_entries WHERE id = ?'
      )
        .bind(weightId)
        .first<{ weight: number; updated_at: string; deleted_at: string }>();

      // Same tombstone, same stamp, same figure — a refused edit writes nothing.
      expect(after).toEqual(before);
      expect(after?.weight).toBe(70);
    });

    it('still travels through the delta sync cursor after the refused edit', async () => {
      const weightId = await createWeight(tokenA, { date: D1, weight: 70, unit: 'kg' });
      await call('DELETE', `/weight/entries/${weightId}`, { token: tokenA });
      await call('PUT', `/weight/entries/${weightId}`, { token: tokenA, body: { weight: 999 } });

      const body = await json<{
        weight_entries: Array<{ id: string; weight: number; deleted_at: string | null }>;
      }>(await call('GET', '/sync?since=1970-01-01T00:00:00.000Z', { token: tokenA }));

      // The delete still propagates (that is what the tombstone is for) and it
      // carries the figure the member actually last saw, not the refused one.
      expect(body.weight_entries).toHaveLength(1);
      expect(body.weight_entries[0].id).toBe(weightId);
      expect(body.weight_entries[0].deleted_at).toBeTruthy();
      expect(body.weight_entries[0].weight).toBe(70);
    });

    it('drops a tombstoned row from every list it used to appear in', async () => {
      const weightId = await createWeight(tokenA, { date: D1, weight: 70, unit: 'kg' });
      const nutritionId = (
        await json<{ entry: { id: string } }>(
          await call('POST', '/nutrition/entries', {
            token: tokenA,
            body: { date: D1, food_name: 'Egg', meal_type: 'breakfast', calories: 70 },
          })
        )
      ).entry.id;
      await call('DELETE', `/weight/entries/${weightId}`, { token: tokenA });
      await call('DELETE', `/nutrition/entries/${nutritionId}`, { token: tokenA });

      // Lists, the derived rollups, and the dashboard all agree it is gone.
      const stats = await json<{ statistics: { count: number } }>(
        await call('GET', '/weight/statistics', { token: tokenA })
      );
      expect(stats.statistics.count).toBe(0);
      const weeks = await json<{ weeks: unknown[] }>(
        await call('GET', '/weight/weekly-averages', { token: tokenA })
      );
      expect(weeks.weeks).toEqual([]);
      const summary = await json<{
        summary: { weight: unknown; nutrition: { entry_count: number } };
      }>(await call('GET', `/summary?date=${D1}`, { token: tokenA }));
      expect(summary.summary.weight).toBeNull();
      expect(summary.summary.nutrition.entry_count).toBe(0);
    });
  });

  /* ========================== WEIGHT ================================= */

  describe('weight', () => {
    it('creates, lists newest-first and filters by range', async () => {
      await createWeight(tokenA, { date: D1, weight: 70.5, unit: 'kg', note: 'morning' });
      await createWeight(tokenA, { date: D3, weight: 70.1, unit: 'kg' });

      const res = await call('GET', '/weight/entries', { token: tokenA });
      expect(res.status).toBe(200);
      const listed = await json<{ entries: Array<{ date: string; note: string | null }> }>(res);
      expect(listed.entries.map((e) => e.date)).toEqual([D3, D1]);
      expect(listed.entries[1].note).toBe('morning');
      expect(listed.entries[0].note).toBeNull(); // omitted note stores NULL, not ''

      const ranged = await json<{ entries: Array<{ date: string }> }>(
        await call('GET', `/weight/entries?from=${D2}&to=${D3}`, { token: tokenA })
      );
      expect(ranged.entries.map((e) => e.date)).toEqual([D3]);

      const limited = await json<{ entries: unknown[] }>(
        await call('GET', '/weight/entries?limit=1', { token: tokenA })
      );
      expect(limited.entries).toHaveLength(1);

      // `limit` is passed through `Number()`; a junk value must not 500 the read.
      // A non-integer `Number('abc')` is NaN, and D1 rejects a non-integer REAL
      // bound into `LIMIT ?` with SQLITE_MISMATCH — so every one of these 400s
      // BEFORE reaching the query rather than 500ing on it.
      expect((await call('GET', '/weight/entries?limit=abc', { token: tokenA })).status).toBe(400);
      expect((await call('GET', '/entries?limit=abc', { token: tokenA })).status).toBe(400);
      expect((await call('GET', '/weight/weekly-averages?limit=abc', { token: tokenA })).status).toBe(
        400
      );
    });

    it('updates an entry and 404s an unknown id', async () => {
      const id = await createWeight(tokenA, { date: D1, weight: 70, unit: 'kg' });
      const res = await call('PUT', `/weight/entries/${id}`, {
        token: tokenA,
        body: { weight: 69.4, note: null },
      });
      expect(res.status).toBe(200);
      expect((await json<{ entry: { weight: number } }>(res)).entry.weight).toBe(69.4);

      const missing = await call('PUT', '/weight/entries/w_nope', {
        token: tokenA,
        body: { weight: 1 },
      });
      expect(missing.status).toBe(404);
    });

    it('re-origins an imported reading when the member corrects it', async () => {
      // The route used to accept no `source` on update, so a reading the member
      // had corrected by hand stayed flagged `healthkit`. The Apple Health import
      // planner protects only rows whose origin is NOT healthkit, so the next
      // sync saw "an imported row whose figure changed" and overwrote the
      // correction — the one thing the importer promises cannot happen.
      const id = await createWeight(tokenA, {
        date: D1,
        weight: 70,
        unit: 'kg',
        source: 'healthkit',
      });

      const res = await call('PUT', `/weight/entries/${id}`, {
        token: tokenA,
        body: { weight: 68.5, source: 'manual' },
      });
      expect(res.status).toBe(200);

      const { entry } = await json<{ entry: { weight: number; source: string } }>(res);
      expect(entry.weight).toBe(68.5);
      expect(entry.source).toBe('manual');
    });

    it('refuses an origin it does not recognise rather than storing it', async () => {
      const id = await createWeight(tokenA, { date: D1, weight: 70, unit: 'kg' });
      const res = await call('PUT', `/weight/entries/${id}`, {
        token: tokenA,
        body: { weight: 69, source: 'telepathy' },
      });
      expect(res.status).toBe(400);
    });

    it('deletes SOFT — the row leaves the list but survives for sync', async () => {
      const id = await createWeight(tokenA, { date: D1, weight: 70, unit: 'kg' });
      const res = await call('DELETE', `/weight/entries/${id}`, { token: tokenA });
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ deleted: true });

      expect(
        (await json<{ entries: unknown[] }>(await call('GET', '/weight/entries', { token: tokenA })))
          .entries
      ).toEqual([]);

      // The tombstone is still there (deleted_at set) so other devices learn of it.
      const row = await testEnv.DB.prepare('SELECT deleted_at FROM weight_entries WHERE id = ?')
        .bind(id)
        .first<{ deleted_at: string | null }>();
      expect(row?.deleted_at).toBeTruthy();
    });

    it('404s a delete of an unknown id', async () => {
      const res = await call('DELETE', '/weight/entries/w_nope', { token: tokenA });
      expect(res.status).toBe(404);
    });

    it('recomputes the weekly average on write and drops the week when it empties', async () => {
      // 2026-06-01 is a Monday → both dates land in the same Mon-based week.
      const id1 = await createWeight(tokenA, { date: D1, weight: 70, unit: 'kg' });
      const id2 = await createWeight(tokenA, { date: D3, weight: 72, unit: 'kg' });

      const weeks = await json<{
        weeks: Array<{ week_start: string; week_end: string; average_weight: number; entry_count: number }>;
      }>(await call('GET', '/weight/weekly-averages', { token: tokenA }));
      expect(weeks.weeks).toHaveLength(1);
      expect(weeks.weeks[0]).toMatchObject({
        week_start: '2026-06-01',
        week_end: '2026-06-07',
        average_weight: 71,
        entry_count: 2,
      });

      await call('DELETE', `/weight/entries/${id2}`, { token: tokenA });
      const afterOne = await json<{ weeks: Array<{ average_weight: number; entry_count: number }> }>(
        await call('GET', '/weight/weekly-averages', { token: tokenA })
      );
      expect(afterOne.weeks[0]).toMatchObject({ average_weight: 70, entry_count: 1 });

      // Emptying the week must REMOVE the rollup, not leave a stale average.
      await call('DELETE', `/weight/entries/${id1}`, { token: tokenA });
      expect(
        (
          await json<{ weeks: unknown[] }>(
            await call('GET', '/weight/weekly-averages', { token: tokenA })
          )
        ).weeks
      ).toEqual([]);
    });

    it('reports statistics only across the LATEST unit', async () => {
      // A user who switches kg → lb must not be told they gained 84 units.
      await createWeight(tokenA, { date: D1, weight: 70, unit: 'kg' });
      await createWeight(tokenA, { date: D2, weight: 154, unit: 'lb' });
      await createWeight(tokenA, { date: D3, weight: 152, unit: 'lb' });

      const stats = await json<{
        statistics: { count: number; unit: string; latest: number; first: number; change: number };
      }>(await call('GET', '/weight/statistics', { token: tokenA }));
      expect(stats.statistics.unit).toBe('lb');
      expect(stats.statistics.count).toBe(2); // the kg row is excluded
      expect(stats.statistics.latest).toBe(152);
      expect(stats.statistics.first).toBe(154);
      expect(stats.statistics.change).toBe(-2);
    });

    it('returns null-safe zeroes for an empty log', async () => {
      const stats = await json<{ statistics: Record<string, unknown> }>(
        await call('GET', '/weight/statistics', { token: tokenA })
      );
      expect(stats.statistics).toEqual({
        count: 0,
        unit: null,
        latest: null,
        first: null,
        change: null,
        average: null,
        min: null,
        max: null,
      });
    });

    it('400s invalid input', async () => {
      const bad: Array<Record<string, unknown>> = [
        { date: '01-06-2026', weight: 70, unit: 'kg' }, // not YYYY-MM-DD
        { date: D1, weight: 0, unit: 'kg' }, // must be positive
        { date: D1, weight: 70, unit: 'stones' }, // unsupported unit
        { date: D1, unit: 'kg' }, // weight missing
      ];
      for (const body of bad) {
        const res = await call('POST', '/weight/entries', { token: tokenA, body });
        expect(res.status).toBe(400);
      }
    });
  });

  /* ========================== WATER ================================== */

  describe('water', () => {
    /** Seed with an explicit created_at — `removeLastWater` orders by it. */
    async function seedWater(id: string, date: string, amount: number, createdAt: string) {
      await testEnv.DB.prepare(
        `INSERT INTO water_entries (id, user_id, date, amount_ml, beverage_type, container, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, 'water', NULL, ?, ?, NULL)`
      )
        .bind(id, UID_A, date, amount, createdAt, createdAt)
        .run();
    }

    it('adds an entry with the default beverage type', async () => {
      const res = await call('POST', '/water/entries', {
        token: tokenA,
        body: { date: D1, amount_ml: 250 },
      });
      expect(res.status).toBe(201);
      const { entry } = await json<{ entry: { beverage_type: string; amount_ml: number } }>(res);
      expect(entry).toMatchObject({ beverage_type: 'water', amount_ml: 250 });
    });

    it('summarises a day against the water goal', async () => {
      await call('PUT', '/goals', {
        token: tokenA,
        body: { effective_date: D1, daily_water_ml: 2000 },
      });
      await call('POST', '/water/entries', { token: tokenA, body: { date: D1, amount_ml: 250 } });
      await call('POST', '/water/entries', { token: tokenA, body: { date: D1, amount_ml: 500 } });
      await call('POST', '/water/entries', { token: tokenA, body: { date: D2, amount_ml: 999 } });

      const res = await call('GET', `/water/summary/daily?date=${D1}`, { token: tokenA });
      expect(await json(res)).toEqual({
        summary: { date: D1, total_ml: 750, goal_ml: 2000, entry_count: 2 },
      });
    });

    it('400s the daily summary without a date', async () => {
      const res = await call('GET', '/water/summary/daily', { token: tokenA });
      expect(res.status).toBe(400);
    });

    it('undo removes the MOST RECENT entry of that day only', async () => {
      // created_at is seeded explicitly: two API writes can share a millisecond,
      // which would make "most recent" ambiguous.
      await seedWater('h2o_early', D1, 100, '2026-06-01T08:00:00.000Z');
      await seedWater('h2o_late', D1, 300, '2026-06-01T20:00:00.000Z');
      await seedWater('h2o_other_day', D2, 500, '2026-06-02T09:00:00.000Z');

      const res = await call('POST', '/water/undo', { token: tokenA, body: { date: D1 } });
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ removed: true });

      const remaining = await json<{ entries: Array<{ id: string }> }>(
        await call('GET', '/water/entries', { token: tokenA })
      );
      expect(remaining.entries.map((e) => e.id).sort()).toEqual(['h2o_early', 'h2o_other_day']);
    });

    it('undo is a no-op on an empty day', async () => {
      await seedWater('h2o_other_day', D2, 500, '2026-06-02T09:00:00.000Z');
      const res = await call('POST', '/water/undo', { token: tokenA, body: { date: D1 } });
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ removed: false });
      expect(
        (await json<{ entries: unknown[] }>(await call('GET', '/water/entries', { token: tokenA })))
          .entries
      ).toHaveLength(1);
    });

    it('deletes by id and 404s an unknown id', async () => {
      const id = (
        await json<{ entry: { id: string } }>(
          await call('POST', '/water/entries', { token: tokenA, body: { date: D1, amount_ml: 250 } })
        )
      ).entry.id;
      expect((await call('DELETE', `/water/entries/${id}`, { token: tokenA })).status).toBe(200);
      expect((await call('DELETE', '/water/entries/h2o_nope', { token: tokenA })).status).toBe(404);
    });
  });

  /* ======================== NUTRITION ================================ */

  describe('nutrition', () => {
    async function addFood(
      body: Record<string, unknown>,
      token = tokenA
    ): Promise<{ id: string }> {
      const res = await call('POST', '/nutrition/entries', { token, body });
      expect(res.status).toBe(201);
      return (await json<{ entry: { id: string } }>(res)).entry;
    }

    it('creates with donor defaults, updates and soft-deletes', async () => {
      const { id } = await addFood({
        date: D1,
        food_name: 'Oats',
        meal_type: 'breakfast',
        calories: 300,
      });
      const created = await json<{ entries: Array<Record<string, unknown>> }>(
        await call('GET', `/nutrition/entries?date=${D1}`, { token: tokenA })
      );
      expect(created.entries[0]).toMatchObject({
        portion: 1,
        unit: 'serving',
        proteins: 0,
        carbohydrates: 0,
        fats: 0,
      });

      const updated = await call('PUT', `/nutrition/entries/${id}`, {
        token: tokenA,
        body: { calories: 350, proteins: 12 },
      });
      expect(updated.status).toBe(200);
      expect((await json<{ entry: { calories: number } }>(updated)).entry.calories).toBe(350);

      expect((await call('DELETE', `/nutrition/entries/${id}`, { token: tokenA })).status).toBe(200);
      expect(
        (
          await json<{ entries: unknown[] }>(
            await call('GET', `/nutrition/entries?date=${D1}`, { token: tokenA })
          )
        ).entries
      ).toEqual([]);
      expect((await call('PUT', '/nutrition/entries/n_nope', { token: tokenA, body: { calories: 1 } })).status).toBe(404);
      expect((await call('DELETE', '/nutrition/entries/n_nope', { token: tokenA })).status).toBe(404);
    });

    it('0143: defaults source to manual, and accepts healthkit from the importer', async () => {
      const typed = await addFood({ date: D1, food_name: 'Oats', meal_type: 'breakfast', calories: 300 });
      const imported = await addFood({
        date: D1,
        food_name: 'Apple Health',
        meal_type: 'snack',
        calories: 1800,
        source: 'healthkit',
      });

      const { entries } = await json<{ entries: Array<{ id: string; source: string }> }>(
        await call('GET', `/nutrition/entries?date=${D1}`, { token: tokenA })
      );
      expect(entries.find((e) => e.id === typed.id)?.source).toBe('manual');
      expect(entries.find((e) => e.id === imported.id)?.source).toBe('healthkit');
    });

    it('buckets the summary per meal and totals the day against the goal', async () => {
      await call('PUT', '/goals', {
        token: tokenA,
        body: { effective_date: D1, daily_calories: 2100, daily_protein_grams: 140 },
      });
      await addFood({ date: D1, food_name: 'Oats', meal_type: 'breakfast', calories: 300, proteins: 10 });
      await addFood({ date: D1, food_name: 'Banana', meal_type: 'snack', calories: 100, carbohydrates: 27 });
      await addFood({ date: D1, food_name: 'Chicken', meal_type: 'dinner', calories: 500, proteins: 45, fats: 12 });
      await addFood({ date: D2, food_name: 'Pizza', meal_type: 'dinner', calories: 900 });

      const res = await call('GET', `/nutrition/summary?date=${D1}`, { token: tokenA });
      const { summary } = await json<{
        summary: {
          totals: { calories: number; proteins: number; carbohydrates: number; fats: number };
          by_meal: Record<string, { calories: number; proteins: number }>;
          entry_count: number;
          goal: { calories: number; proteins: number | null };
        };
      }>(res);
      expect(summary.entry_count).toBe(3); // D2 excluded
      expect(summary.totals).toEqual({ calories: 900, proteins: 55, carbohydrates: 27, fats: 12 });
      expect(summary.by_meal.breakfast).toEqual({ calories: 300, proteins: 10, carbohydrates: 0, fats: 0 });
      expect(summary.by_meal.lunch).toEqual({ calories: 0, proteins: 0, carbohydrates: 0, fats: 0 });
      expect(summary.by_meal.snack.calories).toBe(100);
      expect(summary.by_meal.dinner.calories).toBe(500);
      expect(summary.goal).toEqual({ calories: 2100, proteins: 140, carbohydrates: null, fats: null });
    });

    it('summarises a day with no goal as goal: null', async () => {
      const { summary } = await json<{ summary: { goal: unknown; totals: { calories: number } } }>(
        await call('GET', `/nutrition/summary?date=${D1}`, { token: tokenA })
      );
      expect(summary.goal).toBeNull();
      expect(summary.totals.calories).toBe(0);
    });

    it('400s a missing date or an unknown meal type', async () => {
      expect((await call('GET', '/nutrition/summary', { token: tokenA })).status).toBe(400);
      const res = await call('POST', '/nutrition/entries', {
        token: tokenA,
        body: { date: D1, food_name: 'Egg', meal_type: 'brunch', calories: 70 },
      });
      expect(res.status).toBe(400);
    });

    /* ----------------- 0124: provenance + re-portioning --------------- */

    /** A library food with a clean 100 g basis: 200 kcal / 10 P / 30 C / 5 F. */
    async function seedFood(userId: string, id: string): Promise<string> {
      await testEnv.DB.prepare(
        `INSERT INTO custom_foods
           (id, user_id, name, portion, unit, calories, proteins, carbohydrates, fats,
            base_calories_per_100, base_proteins_per_100, base_carbs_per_100, base_fats_per_100,
            created_at, updated_at)
         VALUES (?, ?, 'Rice', 100, 'g', 200, 10, 30, 5, 200, 10, 30, 5,
                 '2026-06-01T08:00:00.000Z', '2026-06-01T08:00:00.000Z')`
      )
        .bind(id, userId)
        .run();
      return id;
    }

    it('HEALTH-NUTR-121: accepts food_id + the per-100 basis instead of stripping them', async () => {
      const foodId = await seedFood(UID_A, 'cf_a_rice');
      const entry = await addFood({
        date: D1,
        food_name: 'Rice',
        meal_type: 'lunch',
        calories: 300,
        proteins: 15,
        carbohydrates: 45,
        fats: 7.5,
        portion: 150,
        unit: 'g',
        food_id: foodId,
      });

      const listed = await json<{
        entries: Array<{ food_id: string | null; base_calories_per_100: number | null }>;
      }>(await call('GET', `/nutrition/entries?date=${D1}`, { token: tokenA }));
      expect(listed.entries[0].food_id).toBe(foodId);
      expect(listed.entries[0].base_calories_per_100).toBe(200);
      expect(entry.id).toBeTruthy();
    });

    it("HEALTH-NUTR-122: 404s a food_id owned by someone else — never 403", async () => {
      const theirs = await seedFood(UID_B, 'cf_b_rice');
      const res = await call('POST', '/nutrition/entries', {
        token: tokenA,
        body: { date: D1, food_name: 'Rice', meal_type: 'lunch', calories: 300, food_id: theirs },
      });

      // 403 would confirm the id exists on B's account.
      expect(res.status).toBe(404);
      expect(await json(res)).toEqual({
        error: { code: 'not_found', message: 'Food not found' },
      });
      // Nothing was written.
      expect(
        (
          await json<{ entries: unknown[] }>(
            await call('GET', `/nutrition/entries?date=${D1}`, { token: tokenA })
          )
        ).entries
      ).toEqual([]);
    });

    it('HEALTH-NUTR-123: re-portions an entry and returns the server-derived macros', async () => {
      const foodId = await seedFood(UID_A, 'cf_a_rice');
      const { id } = await addFood({
        date: D1,
        food_name: 'Rice',
        meal_type: 'lunch',
        calories: 200,
        proteins: 10,
        carbohydrates: 30,
        fats: 5,
        portion: 100,
        unit: 'g',
        food_id: foodId,
      });

      const res = await call('POST', `/nutrition/entries/${id}/portion`, {
        token: tokenA,
        body: { portion: 250 },
      });
      expect(res.status).toBe(200);
      const { entry } = await json<{
        entry: { id: string; portion: number; calories: number; proteins: number };
      }>(res);
      expect(entry.id).toBe(id); // same row, not a replacement
      expect(entry.portion).toBe(250);
      expect(entry.calories).toBe(500);
      expect(entry.proteins).toBe(25);
    });

    it('HEALTH-NUTR-124: 400s no_basis for an entry that has no per-100 basis', async () => {
      // A row from before 0124: the columns exist but are NULL.
      await testEnv.DB.prepare(
        `INSERT INTO nutrition_entries (id, user_id, date, food_name, portion, unit, meal_type, calories, proteins, carbohydrates, fats, created_at, updated_at, deleted_at)
         VALUES ('n_legacy', ?, ?, 'Soup', 1, 'serving', 'lunch', 300, 10, 40, 5, '2026-06-01T12:00:00.000Z', '2026-06-01T12:00:00.000Z', NULL)`
      )
        .bind(UID_A, D1)
        .run();

      const res = await call('POST', '/nutrition/entries/n_legacy/portion', {
        token: tokenA,
        body: { portion: 2 },
      });
      expect(res.status).toBe(400);
      const body = await json<{ error: { code: string; message: string } }>(res);
      expect(body.error.code).toBe('no_basis');
      // Friendly copy, no raw error string.
      expect(body.error.message).toContain('cannot be rescaled');
    });

    it('HEALTH-NUTR-125: 404s an unknown id and 400s an impossible portion', async () => {
      expect(
        (await call('POST', '/nutrition/entries/n_nope/portion', { token: tokenA, body: { portion: 2 } }))
          .status
      ).toBe(404);

      const { id } = await addFood({
        date: D1,
        food_name: 'Rice',
        meal_type: 'lunch',
        calories: 200,
        portion: 100,
      });
      for (const portion of [0, -5, 100000]) {
        expect(
          (await call('POST', `/nutrition/entries/${id}/portion`, { token: tokenA, body: { portion } }))
            .status
        ).toBe(400);
      }
    });

    /* ---------------- bulk create + copy-day (donor sheets) ------------- */

    it('HEALTH-NUTR-210: bulk create writes every row of the batch in one call', async () => {
      const res = await call('POST', '/nutrition/entries/bulk', {
        token: tokenA,
        body: {
          entries: [
            { date: D1, food_name: 'Oats', meal_type: 'breakfast', calories: 300, proteins: 10 },
            { date: D1, food_name: 'Banana', meal_type: 'snack', calories: 100 },
            { date: D2, food_name: 'Soup', meal_type: 'lunch', calories: 250 },
          ],
        },
      });
      expect(res.status).toBe(201);
      const { entries } = await json<{ entries: Array<{ id: string; date: string }> }>(res);
      expect(entries).toHaveLength(3);
      // Distinct ids — a batch must never collapse into one row.
      expect(new Set(entries.map((e) => e.id)).size).toBe(3);

      const dayOne = await json<{ entries: Array<{ food_name: string }> }>(
        await call('GET', `/nutrition/entries?date=${D1}`, { token: tokenA })
      );
      expect(dayOne.entries.map((e) => e.food_name).sort()).toEqual(['Banana', 'Oats']);
      const dayTwo = await json<{ entries: unknown[] }>(
        await call('GET', `/nutrition/entries?date=${D2}`, { token: tokenA })
      );
      expect(dayTwo.entries).toHaveLength(1);
    });

    it('HEALTH-NUTR-211: bulk create refuses an empty batch and one over the cap', async () => {
      expect(
        (await call('POST', '/nutrition/entries/bulk', { token: tokenA, body: { entries: [] } }))
          .status
      ).toBe(400);

      const tooMany = Array.from({ length: 101 }, () => ({
        date: D1,
        food_name: 'Egg',
        meal_type: 'snack',
        calories: 70,
      }));
      expect(
        (await call('POST', '/nutrition/entries/bulk', {
          token: tokenA,
          body: { entries: tooMany },
        })).status
      ).toBe(400);
      // The cap is a refusal, not a truncation: nothing landed.
      expect(
        (
          await json<{ entries: unknown[] }>(
            await call('GET', `/nutrition/entries?date=${D1}`, { token: tokenA })
          )
        ).entries
      ).toEqual([]);
    });

    it('HEALTH-NUTR-212: copy-day duplicates a day onto another date, leaving the source intact', async () => {
      await addFood({ date: D1, food_name: 'Oats', meal_type: 'breakfast', calories: 300 });
      await addFood({ date: D1, food_name: 'Soup', meal_type: 'lunch', calories: 250 });

      const res = await call('POST', '/nutrition/copy-day', {
        token: tokenA,
        body: { from_date: D1, to_date: D2 },
      });
      expect(res.status).toBe(201);
      const { entries } = await json<{ entries: Array<{ id: string; date: string }> }>(res);
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.date === D2)).toBe(true);

      // The source day is untouched — copy, never move.
      expect(
        (
          await json<{ entries: unknown[] }>(
            await call('GET', `/nutrition/entries?date=${D1}`, { token: tokenA })
          )
        ).entries
      ).toHaveLength(2);
      const copied = await json<{ entries: Array<{ food_name: string; meal_type: string }> }>(
        await call('GET', `/nutrition/entries?date=${D2}`, { token: tokenA })
      );
      expect(copied.entries.map((e) => `${e.meal_type}:${e.food_name}`).sort()).toEqual([
        'breakfast:Oats',
        'lunch:Soup',
      ]);
    });

    it('HEALTH-NUTR-213: copy-day can lift ONE slot onto a different slot', async () => {
      await addFood({ date: D1, food_name: 'Oats', meal_type: 'breakfast', calories: 300 });
      await addFood({ date: D1, food_name: 'Soup', meal_type: 'lunch', calories: 250 });

      const res = await call('POST', '/nutrition/copy-day', {
        token: tokenA,
        body: { from_date: D1, to_date: D2, from_slot: 'lunch', to_slot: 'dinner' },
      });
      expect(res.status).toBe(201);

      const copied = await json<{ entries: Array<{ food_name: string; meal_type: string }> }>(
        await call('GET', `/nutrition/entries?date=${D2}`, { token: tokenA })
      );
      // Only the lunch row travelled, and it landed in the dinner slot.
      expect(copied.entries).toHaveLength(1);
      expect(copied.entries[0]).toMatchObject({ food_name: 'Soup', meal_type: 'dinner' });
    });

    it('HEALTH-NUTR-214: copy-day answers 201 with an empty list for a day with nothing on it', async () => {
      const res = await call('POST', '/nutrition/copy-day', {
        token: tokenA,
        body: { from_date: D3, to_date: D2 },
      });
      expect(res.status).toBe(201);
      expect((await json<{ entries: unknown[] }>(res)).entries).toEqual([]);
    });

    it('HEALTH-NUTR-215: neither bulk nor copy-day can reach another user rows', async () => {
      await addFood({ date: D1, food_name: 'Oats', meal_type: 'breakfast', calories: 300 }, tokenA);

      // B copies "its own" D1 — A's rows are invisible to it, so nothing copies.
      const res = await call('POST', '/nutrition/copy-day', {
        token: tokenB,
        body: { from_date: D1, to_date: D2 },
      });
      expect(res.status).toBe(201);
      expect((await json<{ entries: unknown[] }>(res)).entries).toEqual([]);

      // …and A's day is untouched.
      expect(
        (
          await json<{ entries: unknown[] }>(
            await call('GET', `/nutrition/entries?date=${D1}`, { token: tokenA })
          )
        ).entries
      ).toHaveLength(1);
    });
  });

  /* ====================== MEASUREMENTS =============================== */

  describe('measurements', () => {
    it('creates, lists newest-first, exposes the latest and soft-deletes', async () => {
      const first = (
        await json<{ measurement: { id: string } }>(
          await call('POST', '/measurements', {
            token: tokenA,
            body: { date: D1, unit: 'cm', waist: 84, chest: 100, body_fat_percentage: 18.5 },
          })
        )
      ).measurement;
      const second = (
        await json<{ measurement: { id: string } }>(
          await call('POST', '/measurements', {
            token: tokenA,
            body: { date: D3, unit: 'cm', waist: 82 },
          })
        )
      ).measurement;

      const listed = await json<{ measurements: Array<{ id: string; date: string }> }>(
        await call('GET', '/measurements', { token: tokenA })
      );
      expect(listed.measurements.map((m) => m.id)).toEqual([second.id, first.id]);

      const latest = await json<{ measurement: { id: string; waist: number } }>(
        await call('GET', '/measurements/latest', { token: tokenA })
      );
      expect(latest.measurement).toMatchObject({ id: second.id, waist: 82 });

      expect((await call('DELETE', `/measurements/${second.id}`, { token: tokenA })).status).toBe(200);
      const afterDelete = await json<{ measurement: { id: string } }>(
        await call('GET', '/measurements/latest', { token: tokenA })
      );
      expect(afterDelete.measurement.id).toBe(first.id); // soft-deleted row skipped
      expect((await call('DELETE', '/measurements/bm_nope', { token: tokenA })).status).toBe(404);
    });

    it('400s an unsupported unit', async () => {
      const res = await call('POST', '/measurements', {
        token: tokenA,
        body: { date: D1, unit: 'furlongs', waist: 80 },
      });
      expect(res.status).toBe(400);
    });

    /* -------------------- PATCH /measurements/:id (0131) ------------------- */

    describe('PATCH — correct or clear individual sites', () => {
      async function createMeasurement(body: Record<string, unknown>): Promise<string> {
        const res = await call('POST', '/measurements', { token: tokenA, body });
        expect(res.status).toBe(201);
        return (await json<{ measurement: { id: string } }>(res)).measurement.id;
      }

      it('corrects one site and leaves every other untouched', async () => {
        const id = await createMeasurement({ date: D1, unit: 'cm', waist: 80, chest: 100 });
        const res = await call('PATCH', `/measurements/${id}`, {
          token: tokenA,
          body: { waist: 81.5 },
        });
        expect(res.status).toBe(200);
        const { measurement } = await json<{ measurement: { waist: number; chest: number } }>(res);
        expect(measurement.waist).toBe(81.5);
        expect(measurement.chest).toBe(100); // untouched
      });

      it('an explicit null CLEARS a site; an omitted key keeps it', async () => {
        const id = await createMeasurement({ date: D1, unit: 'cm', waist: 80, chest: 100 });
        const res = await call('PATCH', `/measurements/${id}`, {
          token: tokenA,
          body: { waist: null },
        });
        expect(res.status).toBe(200);
        const { measurement } = await json<{
          measurement: { waist: number | null; chest: number };
        }>(res);
        expect(measurement.waist).toBeNull();
        expect(measurement.chest).toBe(100);
      });

      it('accepts a 0131 comprehensive site absent from the legacy set', async () => {
        const id = await createMeasurement({ date: D1, unit: 'cm', waist: 80 });
        const res = await call('PATCH', `/measurements/${id}`, {
          token: tokenA,
          body: { left_wrist: 16.2, waist_navel: 79 },
        });
        expect(res.status).toBe(200);
        expect(
          (await json<{ measurement: { left_wrist: number; waist_navel: number } }>(res)).measurement
        ).toMatchObject({ left_wrist: 16.2, waist_navel: 79 });
      });

      it('changing unit does not restate values in the other scale', async () => {
        const id = await createMeasurement({ date: D1, unit: 'cm', waist: 82 });
        const res = await call('PATCH', `/measurements/${id}`, {
          token: tokenA,
          body: { unit: 'in' },
        });
        expect(res.status).toBe(200);
        const { measurement } = await json<{ measurement: { unit: string; waist: number } }>(res);
        expect(measurement.unit).toBe('in');
        expect(measurement.waist).toBe(82); // NOT converted
      });

      it('re-dates a session by patching `date`', async () => {
        const id = await createMeasurement({ date: D1, unit: 'cm', waist: 80 });
        const res = await call('PATCH', `/measurements/${id}`, { token: tokenA, body: { date: D2 } });
        expect((await json<{ measurement: { date: string } }>(res)).measurement.date).toBe(D2);
      });

      it('404s an unknown id, and never touches the row when it 404s', async () => {
        const res = await call('PATCH', '/measurements/bm_nope', {
          token: tokenA,
          body: { waist: 50 },
        });
        expect(res.status).toBe(404);
      });

      it("404s — never 403 — another user's measurement, so ownership never leaks", async () => {
        const id = await createMeasurement({ date: D1, unit: 'cm', waist: 80 });
        const res = await call('PATCH', `/measurements/${id}`, {
          token: tokenB,
          body: { waist: 50 },
        });
        expect(res.status).toBe(404);
        // And the row is unchanged for its real owner.
        const stillMine = await json<{ measurement: { waist: number } }>(
          await call('PATCH', `/measurements/${id}`, { token: tokenA, body: {} })
        );
        expect(stillMine.measurement.waist).toBe(80);
      });

      it('404s a PATCH that lands on an already soft-deleted row — the exact tombstone-edit bug class', async () => {
        const id = await createMeasurement({ date: D1, unit: 'cm', waist: 80 });
        expect((await call('DELETE', `/measurements/${id}`, { token: tokenA })).status).toBe(200);

        const res = await call('PATCH', `/measurements/${id}`, {
          token: tokenA,
          body: { waist: 99 },
        });
        expect(res.status).toBe(404);
        // The tombstone stays a tombstone — no resurrection, no updated_at bump.
        const listed = await json<{ measurements: unknown[] }>(
          await call('GET', '/measurements', { token: tokenA })
        );
        expect(listed.measurements).toEqual([]);
      });

      it('400s a malformed site value instead of silently accepting it', async () => {
        const id = await createMeasurement({ date: D1, unit: 'cm', waist: 80 });
        const res = await call('PATCH', `/measurements/${id}`, {
          token: tokenA,
          body: { waist: -5 }, // must be positive
        });
        expect(res.status).toBe(400);
      });
    });
  });

  /* ====================== GENERIC ENTRIES ============================ */

  describe('generic entries', () => {
    it('UPSERTS steps — re-posting a day replaces, never stacks', async () => {
      const first = await call('POST', '/entries/steps', { token: tokenA, body: { date: D1, steps: 4000 } });
      expect(first.status).toBe(200);
      const second = await call('POST', '/entries/steps', { token: tokenA, body: { date: D1, steps: 9000 } });
      expect(second.status).toBe(200);

      const entries = await json<{ entries: Array<{ id: string; data: string }> }>(
        await call('GET', '/entries?type=steps', { token: tokenA })
      );
      expect(entries.entries).toHaveLength(1);
      expect(JSON.parse(entries.entries[0].data)).toEqual({ steps: 9000 });
      // Same row, not a replacement id — the client's cached id stays valid.
      expect((await json<{ entry: { id: string } }>(second)).entry.id).toBe(entries.entries[0].id);
    });

    it('stores a workout as a typed payload on the generic table', async () => {
      const res = await call('POST', '/entries/workouts', {
        token: tokenA,
        body: { date: D1, workout_type: 'run', minutes: 45, calories: 400, note: 'seawall' },
      });
      expect(res.status).toBe(201);
      const { entry } = await json<{ entry: { entry_type: string; source: string; data: string } }>(res);
      expect(entry.entry_type).toBe('workout');
      expect(entry.source).toBe('manual');
      expect(JSON.parse(entry.data)).toEqual({
        workout_type: 'run',
        minutes: 45,
        calories: 400,
        note: 'seawall',
      });
    });

    it('defaults the optional workout fields rather than storing undefined', async () => {
      const res = await call('POST', '/entries/workouts', {
        token: tokenA,
        body: { date: D1, workout_type: 'yoga', minutes: 20 },
      });
      const { entry } = await json<{ entry: { data: string } }>(res);
      expect(JSON.parse(entry.data)).toEqual({
        workout_type: 'yoga',
        minutes: 20,
        calories: 0,
        note: '',
      });
    });

    it('filters the list by type and range', async () => {
      await call('POST', '/entries/steps', { token: tokenA, body: { date: D1, steps: 100 } });
      await call('POST', '/entries/workouts', { token: tokenA, body: { date: D2, workout_type: 'run', minutes: 30 } });
      await call('POST', '/entries', { token: tokenA, body: { date: D3, entry_type: 'sleep', data: { hours: 7 } } });

      const all = await json<{ entries: unknown[] }>(await call('GET', '/entries', { token: tokenA }));
      expect(all.entries).toHaveLength(3);

      const workouts = await json<{ entries: Array<{ entry_type: string }> }>(
        await call('GET', '/entries?type=workout', { token: tokenA })
      );
      expect(workouts.entries.map((e) => e.entry_type)).toEqual(['workout']);

      const ranged = await json<{ entries: Array<{ date: string }> }>(
        await call('GET', `/entries?from=${D2}&to=${D3}`, { token: tokenA })
      );
      expect(ranged.entries.map((e) => e.date)).toEqual([D3, D2]);
    });

    it('400s an invalid entry type on both the list filter and the writer', async () => {
      const listed = await call('GET', '/entries?type=vibes', { token: tokenA });
      expect(listed.status).toBe(400);
      expect(await json(listed)).toEqual({
        error: { code: 'bad_request', message: 'invalid entry type' },
      });

      const written = await call('POST', '/entries', {
        token: tokenA,
        body: { date: D1, entry_type: 'vibes', data: {} },
      });
      expect(written.status).toBe(400);
    });

    it('soft-deletes an entry', async () => {
      const id = (
        await json<{ entry: { id: string } }>(
          await call('POST', '/entries', {
            token: tokenA,
            body: { date: D1, entry_type: 'heart_rate', data: { bpm: 61 } },
          })
        )
      ).entry.id;
      expect((await call('DELETE', `/entries/${id}`, { token: tokenA })).status).toBe(200);
      expect(
        (await json<{ entries: unknown[] }>(await call('GET', '/entries', { token: tokenA }))).entries
      ).toEqual([]);
      expect((await call('DELETE', '/entries/he_nope', { token: tokenA })).status).toBe(404);
    });

    /* ------------------ 0124: update + intensity ---------------------- */

    async function logWorkout(
      body: Record<string, unknown>,
      token = tokenA
    ): Promise<{ id: string }> {
      const res = await call('POST', '/entries/workouts', { token, body });
      expect(res.status).toBe(201);
      return (await json<{ entry: { id: string } }>(res)).entry;
    }

    it('HEALTH-ACT-152: PUT /entries/:id edits in place instead of re-recording', async () => {
      const { id } = await logWorkout({ date: D1, workout_type: 'run', minutes: 30 });

      const res = await call('PUT', `/entries/${id}`, {
        token: tokenA,
        body: { data: { workout_type: 'run', minutes: 45, calories: 300, note: 'tempo' } },
      });
      expect(res.status).toBe(200);
      expect((await json<{ entry: { id: string } }>(res)).entry.id).toBe(id);

      // One row, not two — the re-record workaround always left a second write.
      const entries = await json<{ entries: Array<{ id: string; data: string }> }>(
        await call('GET', '/entries', { token: tokenA })
      );
      expect(entries.entries).toHaveLength(1);
      expect(JSON.parse(entries.entries[0].data).minutes).toBe(45);
    });

    it('HEALTH-ACT-153: PUT /entries/workouts/:id merges, so an untouched note survives', async () => {
      const { id } = await logWorkout({
        date: D1,
        workout_type: 'run',
        minutes: 30,
        calories: 200,
        note: 'hill repeats',
      });

      const res = await call('PUT', `/entries/workouts/${id}`, {
        token: tokenA,
        body: { minutes: 45 },
      });
      expect(res.status).toBe(200);
      expect(JSON.parse((await json<{ entry: { data: string } }>(res)).entry.data)).toEqual({
        workout_type: 'run',
        minutes: 45,
        calories: 200,
        note: 'hill repeats',
      });
    });

    it('HEALTH-ACT-154: the workout PUT 404s an entry that is not a workout', async () => {
      const sleepId = (
        await json<{ entry: { id: string } }>(
          await call('POST', '/entries', {
            token: tokenA,
            body: { date: D1, entry_type: 'sleep', data: { hours: 8 } },
          })
        )
      ).entry.id;

      expect(
        (await call('PUT', `/entries/workouts/${sleepId}`, { token: tokenA, body: { minutes: 45 } }))
          .status
      ).toBe(404);
      expect(
        (await call('PUT', '/entries/workouts/he_nope', { token: tokenA, body: { minutes: 45 } }))
          .status
      ).toBe(404);
      expect(
        (await call('PUT', '/entries/he_nope', { token: tokenA, body: { date: D2 } })).status
      ).toBe(404);
    });

    it('HEALTH-ACT-155: intensity is a real column — the note is never tagged', async () => {
      const res = await call('POST', '/entries/workouts', {
        token: tokenA,
        body: {
          date: D1,
          workout_type: 'run',
          minutes: 30,
          note: 'hill repeats',
          intensity: 'hard',
        },
      });
      expect(res.status).toBe(201);
      const { entry } = await json<{ entry: { intensity: string | null; data: string } }>(res);
      expect(entry.intensity).toBe('hard');
      expect(JSON.parse(entry.data).note).toBe('hill repeats'); // no `[hard] ` prefix
    });

    it('HEALTH-ACT-156: intensity is a CLOSED enum — a made-up value is a 400, not a silent strip', async () => {
      // The bug the tag-smuggling existed to route around was zod silently
      // DROPPING an unnamed key. A closed enum has to reject loudly instead.
      expect(
        (
          await call('POST', '/entries/workouts', {
            token: tokenA,
            body: { date: D1, workout_type: 'run', minutes: 30, intensity: 'brutal' },
          })
        ).status
      ).toBe(400);

      const { id } = await logWorkout({ date: D1, workout_type: 'run', minutes: 30 });
      expect(
        (await call('PUT', `/entries/workouts/${id}`, { token: tokenA, body: { intensity: 'brutal' } }))
          .status
      ).toBe(400);
    });

    it('HEALTH-ACT-157: an explicit null un-records intensity; omitting the key keeps it', async () => {
      const { id } = await logWorkout({
        date: D1,
        workout_type: 'run',
        minutes: 30,
        intensity: 'max',
      });

      const kept = await call('PUT', `/entries/workouts/${id}`, {
        token: tokenA,
        body: { minutes: 31 },
      });
      expect((await json<{ entry: { intensity: string | null } }>(kept)).entry.intensity).toBe('max');

      const cleared = await call('PUT', `/entries/workouts/${id}`, {
        token: tokenA,
        body: { intensity: null },
      });
      expect(
        (await json<{ entry: { intensity: string | null } }>(cleared)).entry.intensity
      ).toBeNull();
    });

    /* --------------- distance_m / started_at (this wave) --------------- */

    it('a measured distance rides the payload; an unmeasured one stays ABSENT, never 0', async () => {
      const measured = await logWorkout({
        date: D1,
        workout_type: 'run',
        minutes: 30,
        distance_m: 5230.5,
      });
      // distance_m omitted entirely — the key must not appear as 0.
      const noDistance = await logWorkout({ date: D2, workout_type: 'yoga', minutes: 20 });
      // distance_m: 0 is the same "not measured" statement as omitting it.
      const zeroDistance = await logWorkout({
        date: D3,
        workout_type: 'walk',
        minutes: 10,
        distance_m: 0,
      });

      const listed = await json<{ entries: Array<{ id: string; data: string }> }>(
        await call('GET', '/entries?type=workout', { token: tokenA })
      );
      const dataFor = (id: string) => JSON.parse(listed.entries.find((e) => e.id === id)!.data);

      expect(dataFor(measured.id)).toMatchObject({ distance_m: 5230.5 });
      expect(dataFor(noDistance.id)).not.toHaveProperty('distance_m');
      expect(dataFor(zeroDistance.id)).not.toHaveProperty('distance_m');
    });

    it('rejects a distance over the 500km ceiling and a negative one', async () => {
      expect(
        (
          await call('POST', '/entries/workouts', {
            token: tokenA,
            body: { date: D1, workout_type: 'run', minutes: 30, distance_m: 500_001 },
          })
        ).status
      ).toBe(400);
      expect(
        (
          await call('POST', '/entries/workouts', {
            token: tokenA,
            body: { date: D1, workout_type: 'run', minutes: 30, distance_m: -1 },
          })
        ).status
      ).toBe(400);
    });

    it('started_at must be an offset ISO datetime, and rides the payload when valid', async () => {
      expect(
        (
          await call('POST', '/entries/workouts', {
            token: tokenA,
            body: { date: D1, workout_type: 'run', minutes: 30, started_at: '2026-06-01' },
          })
        ).status
      ).toBe(400); // date-only, no offset — not a `datetime({ offset: true })`

      const { id } = await logWorkout({
        date: D1,
        workout_type: 'run',
        minutes: 30,
        started_at: '2026-06-01T07:00:00.000Z',
      });
      const listed = await json<{ entries: Array<{ id: string; data: string }> }>(
        await call('GET', '/entries?type=workout', { token: tokenA })
      );
      expect(JSON.parse(listed.entries.find((e) => e.id === id)!.data)).toMatchObject({
        started_at: '2026-06-01T07:00:00.000Z',
      });
    });

    it('PUT clears distance_m/started_at on an explicit null; omitting keeps the stored value', async () => {
      const { id } = await logWorkout({
        date: D1,
        workout_type: 'run',
        minutes: 30,
        distance_m: 1000,
        started_at: '2026-06-01T07:00:00.000Z',
      });

      const kept = await call('PUT', `/entries/workouts/${id}`, { token: tokenA, body: { minutes: 31 } });
      expect(JSON.parse((await json<{ entry: { data: string } }>(kept)).entry.data)).toMatchObject({
        distance_m: 1000,
        started_at: '2026-06-01T07:00:00.000Z',
      });

      const clearedDistance = await call('PUT', `/entries/workouts/${id}`, {
        token: tokenA,
        body: { distance_m: null },
      });
      const clearedData = JSON.parse(
        (await json<{ entry: { data: string } }>(clearedDistance)).entry.data
      );
      expect(clearedData).not.toHaveProperty('distance_m');
      expect(clearedData.started_at).toBe('2026-06-01T07:00:00.000Z'); // untouched

      const clearedStart = await call('PUT', `/entries/workouts/${id}`, {
        token: tokenA,
        body: { started_at: null },
      });
      expect(
        JSON.parse((await json<{ entry: { data: string } }>(clearedStart)).entry.data)
      ).not.toHaveProperty('started_at');
    });

    it('a new distance overwrites the stored one on PUT', async () => {
      const { id } = await logWorkout({
        date: D1,
        workout_type: 'run',
        minutes: 30,
        distance_m: 1000,
      });
      const res = await call('PUT', `/entries/workouts/${id}`, {
        token: tokenA,
        body: { distance_m: 2500 },
      });
      expect(
        JSON.parse((await json<{ entry: { data: string } }>(res)).entry.data).distance_m
      ).toBe(2500);
    });

    it('PUT distance_m: 0 removes it the same as null — "0" is not a real reading', async () => {
      const { id } = await logWorkout({
        date: D1,
        workout_type: 'run',
        minutes: 30,
        distance_m: 1000,
      });
      const res = await call('PUT', `/entries/workouts/${id}`, {
        token: tokenA,
        body: { distance_m: 0 },
      });
      expect(
        JSON.parse((await json<{ entry: { data: string } }>(res)).entry.data)
      ).not.toHaveProperty('distance_m');
    });

    it('PUT sets started_at for the first time on a row that never had one', async () => {
      const { id } = await logWorkout({ date: D1, workout_type: 'run', minutes: 30 });
      const res = await call('PUT', `/entries/workouts/${id}`, {
        token: tokenA,
        body: { started_at: '2026-06-01T07:00:00.000Z' },
      });
      expect(
        JSON.parse((await json<{ entry: { data: string } }>(res)).entry.data).started_at
      ).toBe('2026-06-01T07:00:00.000Z');
    });
  });

  /* =========================== GOALS ================================= */

  describe('goals', () => {
    it('is effective-dated — saving today never rewrites a past day', async () => {
      await call('PUT', '/goals', { token: tokenA, body: { effective_date: D1, daily_calories: 1800 } });
      await call('PUT', '/goals', { token: tokenA, body: { effective_date: D3, daily_calories: 2400 } });

      const past = await json<{ goal: { daily_calories: number; effective_date: string } }>(
        await call('GET', `/goals?date=${D2}`, { token: tokenA })
      );
      expect(past.goal).toMatchObject({ daily_calories: 1800, effective_date: D1 });

      const now = await json<{ goal: { daily_calories: number } }>(
        await call('GET', `/goals?date=${D3}`, { token: tokenA })
      );
      expect(now.goal.daily_calories).toBe(2400);
    });

    it('returns null before any goal exists and for dates before the first one', async () => {
      expect(
        (await json<{ goal: unknown }>(await call('GET', `/goals?date=${D1}`, { token: tokenA }))).goal
      ).toBeNull();
      await call('PUT', '/goals', { token: tokenA, body: { effective_date: D3, daily_calories: 2400 } });
      expect(
        (await json<{ goal: unknown }>(await call('GET', `/goals?date=${D1}`, { token: tokenA }))).goal
      ).toBeNull();
    });

    it('carries unset fields forward and edits an existing effective date in place', async () => {
      await call('PUT', '/goals', {
        token: tokenA,
        body: { effective_date: D1, daily_calories: 1800, daily_water_ml: 2000 },
      });
      // A later goal inherits the water target it did not mention…
      await call('PUT', '/goals', { token: tokenA, body: { effective_date: D3, daily_calories: 2400 } });
      const later = await json<{ goal: { daily_water_ml: number; daily_calories: number } }>(
        await call('GET', `/goals?date=${D3}`, { token: tokenA })
      );
      expect(later.goal).toMatchObject({ daily_calories: 2400, daily_water_ml: 2000 });

      // …and re-saving the SAME date updates that row rather than adding one.
      await call('PUT', '/goals', { token: tokenA, body: { effective_date: D3, daily_calories: 2500 } });
      const count = await testEnv.DB.prepare(
        'SELECT COUNT(*) AS n FROM health_goals WHERE user_id = ?'
      )
        .bind(UID_A)
        .first<{ n: number }>();
      expect(count?.n).toBe(2);
      expect(
        (
          await json<{ goal: { daily_calories: number } }>(
            await call('GET', `/goals?date=${D3}`, { token: tokenA })
          )
        ).goal.daily_calories
      ).toBe(2500);
    });

    it('accepts the donor per-weekday calorie override end to end', async () => {
      // `caloriesGoalFor` has always honoured use_per_day_calories +
      // <weekday>_calories, but PUT /goals used to validate neither key and zod
      // strips unknown keys, so the donor's per-day targets were silently
      // dropped with a 200. Fixed 2026-07-25 (was GAP-4).
      await call('PUT', '/goals', {
        token: tokenA,
        body: {
          effective_date: D1,
          daily_calories: 2000,
          use_per_day_calories: true,
          monday_calories: 1500,
        },
      });
      const row = await testEnv.DB.prepare(
        'SELECT use_per_day_calories, monday_calories FROM health_goals WHERE user_id = ?'
      )
        .bind(UID_A)
        .first<{ use_per_day_calories: number; monday_calories: number | null }>();
      expect(row?.use_per_day_calories).toBe(1);
      expect(row?.monday_calories).toBe(1500);
    });

    it('400s an out-of-range calorie target', async () => {
      const res = await call('PUT', '/goals', { token: tokenA, body: { daily_calories: 10 } });
      expect(res.status).toBe(400);
    });

    it('accepts the per-weekday macro override end to end (0139)', async () => {
      await call('PUT', '/goals', {
        token: tokenA,
        body: {
          effective_date: D1,
          daily_protein_grams: 150,
          use_per_day_macros: true,
          monday_protein_grams: 220,
          monday_carbs_grams: 150,
          monday_fats_grams: 70,
        },
      });
      const row = await testEnv.DB.prepare(
        'SELECT use_per_day_macros, monday_protein_grams, monday_carbs_grams, monday_fats_grams FROM health_goals WHERE user_id = ?'
      )
        .bind(UID_A)
        .first<{
          use_per_day_macros: number;
          monday_protein_grams: number | null;
          monday_carbs_grams: number | null;
          monday_fats_grams: number | null;
        }>();
      expect(row?.use_per_day_macros).toBe(1);
      expect(row?.monday_protein_grams).toBe(220);
      expect(row?.monday_carbs_grams).toBe(150);
      expect(row?.monday_fats_grams).toBe(70);

      const summary = await json<{ summary: { goal: { proteins: number | null } } }>(
        await call('GET', `/nutrition/summary?date=${D1}`, { token: tokenA })
      );
      expect(summary.summary.goal.proteins).toBe(220);
    });

    it('400s an out-of-range per-weekday macro target', async () => {
      const res = await call('PUT', '/goals', {
        token: tokenA,
        body: { monday_protein_grams: 5000 },
      });
      expect(res.status).toBe(400);
    });

    /* ------------------ 0125 — the WEIGHT target ---------------------- */

    it('accepts the weight target + baseline + biometrics end to end (0125)', async () => {
      // Before 0125 zod named none of these keys, so a target was stripped and
      // answered 200 — which is why `goalWeight` was zero hits across the RN
      // app. Assert them at the ROW, not just in the response, so a schema that
      // silently drops one cannot pass.
      await call('PUT', '/goals', {
        token: tokenA,
        body: {
          effective_date: D1,
          target_weight_kg: 72.5,
          weight_goal_type: 'lose',
          starting_weight_kg: 80,
          starting_weight_date: D1,
          height_cm: 178,
          gender: 'male',
          birth_year: 1990,
          activity_level: 'moderatelyActive',
        },
      });

      const row = await testEnv.DB.prepare(
        `SELECT target_weight_kg, weight_goal_type, starting_weight_kg, starting_weight_date,
                height_cm, gender, birth_year, activity_level
           FROM health_goals WHERE user_id = ?`
      )
        .bind(UID_A)
        .first<Record<string, unknown>>();

      expect(row).toMatchObject({
        target_weight_kg: 72.5,
        weight_goal_type: 'lose',
        starting_weight_kg: 80,
        starting_weight_date: D1,
        height_cm: 178,
        gender: 'male',
        birth_year: 1990,
        activity_level: 'moderatelyActive',
      });
    });

    it('is effective-dated for the weight target too — a past chart keeps its own line', async () => {
      await call('PUT', '/goals', {
        token: tokenA,
        body: { effective_date: D1, target_weight_kg: 80 },
      });
      await call('PUT', '/goals', {
        token: tokenA,
        body: { effective_date: D3, target_weight_kg: 75 },
      });

      // The donor overwrites ONE target in place, so re-targeting retro-scores
      // every past day against a goal that did not exist yet. Ours does not.
      const past = await json<{ goal: { target_weight_kg: number } }>(
        await call('GET', `/goals?date=${D2}`, { token: tokenA })
      );
      expect(past.goal.target_weight_kg).toBe(80);
      const now = await json<{ goal: { target_weight_kg: number } }>(
        await call('GET', `/goals?date=${D3}`, { token: tokenA })
      );
      expect(now.goal.target_weight_kg).toBe(75);
    });

    it('CLEARS the weight target on an explicit null (not an omission)', async () => {
      await call('PUT', '/goals', {
        token: tokenA,
        body: { effective_date: D1, target_weight_kg: 72 },
      });
      // Omitting the key carries the old value forward…
      await call('PUT', '/goals', {
        token: tokenA,
        body: { effective_date: D3, daily_calories: 2100 },
      });
      expect(
        (
          await json<{ goal: { target_weight_kg: number | null } }>(
            await call('GET', `/goals?date=${D3}`, { token: tokenA })
          )
        ).goal.target_weight_kg
      ).toBe(72);

      // …an explicit null is the only way to clear it. The client depends on
      // this distinction: an ABSENT key means a pre-0125 Worker (keep the cached
      // goal), an explicit NULL means the member cleared it.
      await call('PUT', '/goals', {
        token: tokenA,
        body: { effective_date: D3, target_weight_kg: null },
      });
      expect(
        (
          await json<{ goal: { target_weight_kg: number | null } }>(
            await call('GET', `/goals?date=${D3}`, { token: tokenA })
          )
        ).goal.target_weight_kg
      ).toBeNull();
    });

    it('400s an out-of-vocabulary activity level, goal type or gender', async () => {
      for (const body of [
        { activity_level: 'lazy' },
        { weight_goal_type: 'shrink' },
        { gender: 'unspecified' },
        { target_weight_kg: -5 },
        { height_cm: 0 },
        { birth_year: 1800 },
      ]) {
        // SQLite cannot take a CHECK on an ALTERed column, so zod is the only
        // thing standing between a typo and a permanently wrong row.
        expect((await call('PUT', '/goals', { token: tokenA, body })).status).toBe(400);
      }
    });
  });

  /* ========================== HABITS ================================= */

  describe('habits', () => {
    async function addHabit(name: string, token = tokenA): Promise<string> {
      const res = await call('POST', '/habits', { token, body: { name } });
      expect(res.status).toBe(201);
      return (await json<{ habit: { id: string } }>(res)).habit.id;
    }

    it('creates with donor defaults and an empty streak', async () => {
      const res = await call('POST', '/habits', { token: tokenA, body: { name: 'Stretch' } });
      const { habit } = await json<{
        habit: { icon: string; category: string; days: string[]; streak: number; sort_order: number };
      }>(res);
      expect(habit).toMatchObject({ icon: 'goals', category: 'custom', streak: 0, sort_order: 0 });
      expect(habit.days).toEqual([]);
    });

    it('creates directly with a custom schedule (frequency + custom_days in one POST)', async () => {
      const res = await call('POST', '/habits', {
        token: tokenA,
        body: { name: 'Gym', frequency: 'custom', custom_days: [2, 4, 6] },
      });
      expect(res.status).toBe(201);
      const { habit } = await json<{ habit: { frequency: string; custom_days: number[] | null } }>(
        res
      );
      expect(habit).toMatchObject({ frequency: 'custom', custom_days: [2, 4, 6] });
    });

    it('returns server-computed days + streak', async () => {
      // Streaks are derived from the logs, never stored — the client must not
      // have to agree with the server about what "3 days" means.
      const id = await addHabit('Stretch');
      for (const d of [dayOffset(0), dayOffset(-1), dayOffset(-2), dayOffset(-5)]) {
        await call('POST', `/habits/${id}/toggle`, { token: tokenA, body: { date: d } });
      }
      const { habits } = await json<{ habits: Array<{ days: string[]; streak: number }> }>(
        await call('GET', '/habits', { token: tokenA })
      );
      expect(habits[0].days).toEqual([dayOffset(0), dayOffset(-1), dayOffset(-2), dayOffset(-5)]);
      expect(habits[0].streak).toBe(3); // the 3-day gap before dayOffset(-5) breaks it
    });

    it('toggle is idempotent per (habit, date) — a second tap unticks', async () => {
      const id = await addHabit('Stretch');
      const on = await call('POST', `/habits/${id}/toggle`, { token: tokenA, body: { date: D1 } });
      expect(await json<{ done: boolean }>(on)).toMatchObject({ done: true });
      const off = await call('POST', `/habits/${id}/toggle`, { token: tokenA, body: { date: D1 } });
      expect((await json<{ done: boolean; habits: Array<{ days: string[] }> }>(off)).done).toBe(false);

      // Re-ticking revives the same log row rather than stacking a duplicate.
      await call('POST', `/habits/${id}/toggle`, { token: tokenA, body: { date: D1 } });
      const rows = await testEnv.DB.prepare(
        'SELECT COUNT(*) AS n FROM habit_logs WHERE habit_id = ? AND date = ?'
      )
        .bind(id, D1)
        .first<{ n: number }>();
      expect(rows?.n).toBe(1);
      const { habits } = await json<{ habits: Array<{ days: string[] }> }>(
        await call('GET', '/habits', { token: tokenA })
      );
      expect(habits[0].days).toEqual([D1]);
    });

    it('404s an unknown habit id instead of crashing on the FK', async () => {
      // `habit_logs.habit_id` is a FK to `user_habits` and D1 DOES enforce FKs
      // (`PRAGMA foreign_keys = 1`), so inserting a log for an id that does not
      // exist used to throw a constraint error and 500. A stale id left on a
      // device is enough to trigger it. Fixed 2026-07-25 (was BUG-2).
      const res = await call('POST', '/habits/habit_does_not_exist/toggle', {
        token: tokenA,
        body: { date: D1 },
      });
      expect(res.status).toBe(404);
      const logs = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM habit_logs').first<{
        n: number;
      }>();
      expect(logs?.n).toBe(0);
    });

    it('toggling a SOFT-DELETED habit still works (the row, and so the FK, survives)', async () => {
      // The realistic "stale id" case: the habit was deleted on another device.
      // Soft delete keeps the parent row, so this path stays a clean 200 and the
      // log simply never surfaces in the (deleted-filtered) habits list.
      const id = await addHabit('Stretch');
      await call('DELETE', `/habits/${id}`, { token: tokenA });
      const res = await call('POST', `/habits/${id}/toggle`, { token: tokenA, body: { date: D1 } });
      expect(res.status).toBe(200);
      expect((await json<{ habits: unknown[] }>(res)).habits).toEqual([]);
    });

    it('deletes SOFT — the habit leaves the list but the row survives', async () => {
      const id = await addHabit('Stretch');
      expect((await call('DELETE', `/habits/${id}`, { token: tokenA })).status).toBe(200);
      expect(
        (await json<{ habits: unknown[] }>(await call('GET', '/habits', { token: tokenA }))).habits
      ).toEqual([]);
      const row = await testEnv.DB.prepare('SELECT deleted_at FROM user_habits WHERE id = ?')
        .bind(id)
        .first<{ deleted_at: string | null }>();
      expect(row?.deleted_at).toBeTruthy();
      expect((await call('DELETE', '/habits/habit_nope', { token: tokenA })).status).toBe(404);
    });

    it('orders habits by creation and 400s an empty name', async () => {
      await addHabit('First');
      await addHabit('Second');
      const { habits } = await json<{ habits: Array<{ name: string; sort_order: number }> }>(
        await call('GET', '/habits', { token: tokenA })
      );
      expect(habits.map((h) => h.name)).toEqual(['First', 'Second']);
      expect(habits.map((h) => h.sort_order)).toEqual([0, 1]);
      expect((await call('POST', '/habits', { token: tokenA, body: { name: '' } })).status).toBe(400);
    });

    /* --------------------- PUT /habits/:id (this wave) --------------------- */

    describe('PUT — schedule + name + archive', () => {
      it('patches a subset of fields and leaves the rest untouched', async () => {
        const id = await addHabit('Stretch');
        const res = await call('PUT', `/habits/${id}`, {
          token: tokenA,
          body: { name: 'Stretch daily', icon: 'flame' },
        });
        expect(res.status).toBe(200);
        const { habit } = await json<{ habit: { name: string; icon: string; category: string } }>(res);
        expect(habit).toMatchObject({ name: 'Stretch daily', icon: 'flame', category: 'custom' });
      });

      it('sets the full schedule (frequency, custom_days, reminder) end to end', async () => {
        const id = await addHabit('Stretch');
        const res = await call('PUT', `/habits/${id}`, {
          token: tokenA,
          body: {
            frequency: 'custom',
            custom_days: [2, 4, 6],
            reminder_time: '07:30',
            reminder_enabled: true,
            target_duration: 600,
            notes: 'after coffee',
          },
        });
        expect(res.status).toBe(200);
        const { habit } = await json<{
          habit: {
            frequency: string;
            custom_days: number[] | null;
            reminder_time: string | null;
            reminder_enabled: boolean;
            target_duration: number | null;
            notes: string | null;
          };
        }>(res);
        expect(habit).toMatchObject({
          frequency: 'custom',
          custom_days: [2, 4, 6],
          reminder_time: '07:30',
          reminder_enabled: true,
          target_duration: 600,
          notes: 'after coffee',
        });
      });

      it('switching frequency away from custom drops the stale custom_days', async () => {
        const id = await addHabit('Stretch');
        await call('PUT', `/habits/${id}`, {
          token: tokenA,
          body: { frequency: 'custom', custom_days: [1, 3, 5] },
        });
        const res = await call('PUT', `/habits/${id}`, { token: tokenA, body: { frequency: 'daily' } });
        expect(
          (await json<{ habit: { frequency: string; custom_days: number[] | null } }>(res)).habit
        ).toMatchObject({ frequency: 'daily', custom_days: null });
      });

      it('an empty custom_days array reads back as null — "custom, no days chosen" means every day', async () => {
        const id = await addHabit('Stretch');
        const res = await call('PUT', `/habits/${id}`, {
          token: tokenA,
          body: { frequency: 'custom', custom_days: [] },
        });
        expect(
          (await json<{ habit: { custom_days: number[] | null } }>(res)).habit.custom_days
        ).toBeNull();
      });

      it('switching to custom without sending custom_days stores null, not a crash', async () => {
        const id = await addHabit('Stretch');
        const res = await call('PUT', `/habits/${id}`, { token: tokenA, body: { frequency: 'custom' } });
        expect(
          (await json<{ habit: { frequency: string; custom_days: number[] | null } }>(res)).habit
        ).toMatchObject({ frequency: 'custom', custom_days: null });
      });

      it('duplicate weekdays are deduped and sorted on write', async () => {
        const id = await addHabit('Stretch');
        const res = await call('PUT', `/habits/${id}`, {
          token: tokenA,
          body: { frequency: 'custom', custom_days: [5, 2, 5, 2, 3] },
        });
        expect(
          (await json<{ habit: { custom_days: number[] } }>(res)).habit.custom_days
        ).toEqual([2, 3, 5]);
      });

      it('a corrupted custom_days blob (legacy/manual data) reads back as null instead of crashing', async () => {
        const id = await addHabit('Stretch');
        // No route can write this — it simulates a pre-validation legacy row or a
        // manual DB edit, which `parseStoredCustomDays` exists to survive.
        await testEnv.DB.prepare('UPDATE user_habits SET custom_days = ? WHERE id = ?')
          .bind('{"not":"an array"}', id)
          .run();
        const { habits } = await json<{ habits: Array<{ custom_days: number[] | null }> }>(
          await call('GET', '/habits', { token: tokenA })
        );
        expect(habits[0].custom_days).toBeNull();

        await testEnv.DB.prepare('UPDATE user_habits SET custom_days = ? WHERE id = ?')
          .bind('not even json', id)
          .run();
        const after = await json<{ habits: Array<{ custom_days: number[] | null }> }>(
          await call('GET', '/habits', { token: tokenA })
        );
        expect(after.habits[0].custom_days).toBeNull();

        // A well-formed JSON array whose every entry is out of the 1-7 range —
        // survives `JSON.parse` and `Array.isArray`, but the filter drops every
        // element, so this must ALSO read back as null rather than `[]`.
        await testEnv.DB.prepare('UPDATE user_habits SET custom_days = ? WHERE id = ?')
          .bind('[0,8,50]', id)
          .run();
        const outOfRange = await json<{ habits: Array<{ custom_days: number[] | null }> }>(
          await call('GET', '/habits', { token: tokenA })
        );
        expect(outOfRange.habits[0].custom_days).toBeNull();
      });

      it('sets category, template_id, time_of_day and sort_order independently', async () => {
        const id = await addHabit('Stretch');
        const res = await call('PUT', `/habits/${id}`, {
          token: tokenA,
          body: {
            category: 'wellness',
            template_id: 'tmpl_meditate',
            time_of_day: 'morning',
            sort_order: 3,
          },
        });
        expect(res.status).toBe(200);
        const { habit } = await json<{
          habit: {
            category: string;
            template_id: string | null;
            time_of_day: string;
            sort_order: number;
          };
        }>(res);
        expect(habit).toMatchObject({
          category: 'wellness',
          template_id: 'tmpl_meditate',
          time_of_day: 'morning',
          sort_order: 3,
        });
      });

      it('clears reminder_time via an explicit null while keeping reminder_enabled', async () => {
        const id = await addHabit('Stretch');
        await call('PUT', `/habits/${id}`, {
          token: tokenA,
          body: { reminder_time: '07:00', reminder_enabled: true },
        });
        const res = await call('PUT', `/habits/${id}`, {
          token: tokenA,
          body: { reminder_time: null },
        });
        const { habit } = await json<{
          habit: { reminder_time: string | null; reminder_enabled: boolean };
        }>(res);
        expect(habit.reminder_time).toBeNull();
        expect(habit.reminder_enabled).toBe(true); // untouched
      });

      it('archives via is_archived, and archived habits are hidden unless asked for', async () => {
        const id = await addHabit('Stretch');
        const res = await call('PUT', `/habits/${id}`, { token: tokenA, body: { is_archived: true } });
        expect((await json<{ habit: { is_archived: boolean } }>(res)).habit.is_archived).toBe(true);

        const hidden = await json<{ habits: unknown[] }>(
          await call('GET', '/habits', { token: tokenA })
        );
        expect(hidden.habits).toEqual([]);

        const shown = await json<{ habits: Array<{ id: string }> }>(
          await call('GET', '/habits?include_archived=true', { token: tokenA })
        );
        expect(shown.habits.map((h) => h.id)).toEqual([id]);
      });

      it('404s an unknown id', async () => {
        const res = await call('PUT', '/habits/habit_nope', { token: tokenA, body: { name: 'x' } });
        expect(res.status).toBe(404);
      });

      it("404s — never 403 — another user's habit, so ownership never leaks", async () => {
        const id = await addHabit('Stretch');
        const res = await call('PUT', `/habits/${id}`, { token: tokenB, body: { name: 'stolen' } });
        expect(res.status).toBe(404);
        // Unaffected for the real owner.
        const mine = await json<{ habit: { name: string } }>(
          await call('PUT', `/habits/${id}`, { token: tokenA, body: {} })
        );
        expect(mine.habit.name).toBe('Stretch');
      });

      it('404s a PUT that lands on an already soft-deleted habit — never a silent resurrection', async () => {
        const id = await addHabit('Stretch');
        expect((await call('DELETE', `/habits/${id}`, { token: tokenA })).status).toBe(200);
        const res = await call('PUT', `/habits/${id}`, { token: tokenA, body: { name: 'back?' } });
        expect(res.status).toBe(404);
        const still = await json<{ habits: unknown[] }>(
          await call('GET', '/habits', { token: tokenA })
        );
        expect(still.habits).toEqual([]);
      });

      it('400s an out-of-range custom_days entry and an over-long name', async () => {
        const id = await addHabit('Stretch');
        expect(
          (
            await call('PUT', `/habits/${id}`, {
              token: tokenA,
              body: { frequency: 'custom', custom_days: [0, 8] },
            })
          ).status
        ).toBe(400);
        expect(
          (await call('PUT', `/habits/${id}`, { token: tokenA, body: { name: 'x'.repeat(61) } }))
            .status
        ).toBe(400);
      });
    });
  });

  /* ====================== WOMEN'S HEALTH ============================= */

  describe('cycle', () => {
    it('upserts the settings singleton', async () => {
      expect(
        (await json<{ settings: unknown }>(await call('GET', '/cycle/settings', { token: tokenA })))
          .settings
      ).toBeNull();

      const created = await call('PUT', '/cycle/settings', {
        token: tokenA,
        body: { cycle_length: 30 },
      });
      expect(
        (await json<{ settings: { cycle_length: number; period_length: number } }>(created)).settings
      ).toMatchObject({ cycle_length: 30, period_length: 5 }); // donor default kept

      await call('PUT', '/cycle/settings', { token: tokenA, body: { period_length: 6 } });
      const after = await json<{ settings: { cycle_length: number; period_length: number } }>(
        await call('GET', '/cycle/settings', { token: tokenA })
      );
      expect(after.settings).toMatchObject({ cycle_length: 30, period_length: 6 });
      const count = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM cycle_settings').first<{
        n: number;
      }>();
      expect(count?.n).toBe(1);
    });

    it('logs a bleeding day, upserts by (user, date) and re-anchors a NEW run', async () => {
      // First run: 06-01..06-03. The first day anchors the cycle.
      for (const d of ['2026-06-01', '2026-06-02', '2026-06-03']) {
        const res = await call('POST', '/cycle/periods', { token: tokenA, body: { date: d, flow_level: 3 } });
        expect(res.status).toBe(200);
      }
      const anchored = await json<{ settings: { last_period_start: string; cycle_length: number } }>(
        await call('GET', '/cycle/settings', { token: tokenA })
      );
      // Only one start so far → no observed average, the 28-day default stands.
      expect(anchored.settings).toMatchObject({ last_period_start: '2026-06-01', cycle_length: 28 });

      // Re-logging an existing day upserts (flow changed, still one row).
      await call('POST', '/cycle/periods', { token: tokenA, body: { date: '2026-06-02', flow_level: 5 } });
      const periods = await json<{ periods: Array<{ date: string; flow_level: number }> }>(
        await call('GET', '/cycle/periods', { token: tokenA })
      );
      expect(periods.periods).toHaveLength(3);
      expect(periods.periods.find((p) => p.date === '2026-06-02')?.flow_level).toBe(5);

      // Second run starts 30 days later → re-anchor AND adopt the observed length.
      const res = await call('POST', '/cycle/periods', {
        token: tokenA,
        body: { date: '2026-07-01', flow_level: 4 },
      });
      const body = await json<{ settings: { last_period_start: string; cycle_length: number } }>(res);
      expect(body.settings).toMatchObject({ last_period_start: '2026-07-01', cycle_length: 30 });
    });

    it('does NOT move the anchor backwards when an older run is backfilled', async () => {
      await call('POST', '/cycle/periods', { token: tokenA, body: { date: '2026-07-01', flow_level: 3 } });
      await call('POST', '/cycle/periods', { token: tokenA, body: { date: '2026-05-01', flow_level: 3 } });
      const settings = await json<{ settings: { last_period_start: string } }>(
        await call('GET', '/cycle/settings', { token: tokenA })
      );
      expect(settings.settings.last_period_start).toBe('2026-07-01');
    });

    it('removes a period day and 404s an unlogged date', async () => {
      await call('POST', '/cycle/periods', { token: tokenA, body: { date: D1, flow_level: 3 } });
      const res = await call('DELETE', `/cycle/periods/${D1}`, { token: tokenA });
      expect(res.status).toBe(200);
      expect((await json<{ periods: unknown[] }>(res)).periods).toEqual([]);
      expect((await call('DELETE', '/cycle/periods/2026-01-01', { token: tokenA })).status).toBe(404);
    });

    it('upserts symptoms by (user, date) and keeps untouched fields', async () => {
      const first = await call('PUT', '/cycle/symptoms', {
        token: tokenA,
        body: { date: D1, mood: 3, cramps: 2, cravings: 'chocolate' },
      });
      expect(first.status).toBe(200);
      await call('PUT', '/cycle/symptoms', { token: tokenA, body: { date: D1, mood: 5 } });

      const { symptoms } = await json<{
        symptoms: Array<{ mood: number; cramps: number; cravings: string }>;
      }>(await call('GET', '/cycle/symptoms', { token: tokenA }));
      expect(symptoms).toHaveLength(1);
      expect(symptoms[0]).toMatchObject({ mood: 5, cramps: 2, cravings: 'chocolate' });
    });

    it('400s an out-of-scale flow level or severity', async () => {
      expect(
        (await call('POST', '/cycle/periods', { token: tokenA, body: { date: D1, flow_level: 9 } })).status
      ).toBe(400);
      expect(
        (await call('PUT', '/cycle/symptoms', { token: tokenA, body: { date: D1, cramps: 7 } })).status
      ).toBe(400);
    });
  });

  /* ======================== MEN'S HEALTH ============================= */

  describe('mens-health', () => {
    it('upserts an entry by (user, date), preserving fields the patch omits', async () => {
      const first = await call('PUT', '/mens-health/entries', {
        token: tokenA,
        body: { date: D1, libido: 7, had_morning_erection: true, energy_level: 6 },
      });
      expect(first.status).toBe(200);
      expect(
        (await json<{ entry: { libido: number; had_morning_erection: boolean } }>(first)).entry
      ).toMatchObject({ libido: 7, had_morning_erection: true });

      await call('PUT', '/mens-health/entries', { token: tokenA, body: { date: D1, mood: 8 } });
      const { entries } = await json<{
        entries: Array<{ libido: number; mood: number; energy_level: number }>;
      }>(await call('GET', '/mens-health/entries', { token: tokenA }));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ libido: 7, mood: 8, energy_level: 6 });
    });

    it('upserts the settings singleton', async () => {
      expect(
        (
          await json<{ settings: unknown }>(
            await call('GET', '/mens-health/settings', { token: tokenA })
          )
        ).settings
      ).toBeNull();

      await call('PUT', '/mens-health/settings', { token: tokenA, body: { track_libido: false } });
      await call('PUT', '/mens-health/settings', { token: tokenA, body: { reminder_time: '21:00' } });

      const { settings } = await json<{
        settings: { track_libido: boolean; track_energy: boolean; reminder_time: string };
      }>(await call('GET', '/mens-health/settings', { token: tokenA }));
      expect(settings).toMatchObject({
        track_libido: false,
        track_energy: true, // untouched columns keep the DDL default
        reminder_time: '21:00',
      });
      const count = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM mens_health_settings').first<{
        n: number;
      }>();
      expect(count?.n).toBe(1);
    });

    it('400s an out-of-scale rating', async () => {
      const res = await call('PUT', '/mens-health/entries', {
        token: tokenA,
        body: { date: D1, libido: 42 },
      });
      expect(res.status).toBe(400);
    });

    it('drops an unknown settings key instead of crashing', async () => {
      // PUT /mens-health/settings validates with `z.record(...)`, so ANY key is
      // accepted by the schema. It must never reach SQL as a column name — the
      // row is written with the known columns only.
      const res = await call('PUT', '/mens-health/settings', {
        token: tokenA,
        body: { bogus_column: true, track_kegels: false },
      });
      expect(res.status).toBe(200);
      // The write echo is the in-memory row, so it can still carry the junk key;
      // what matters is that D1 stored only real columns.
      const { settings } = await json<{ settings: Record<string, unknown> }>(
        await call('GET', '/mens-health/settings', { token: tokenA })
      );
      expect(settings.track_kegels).toBe(false);
      expect(settings.bogus_column).toBeUndefined();
    });
  });

  /* ========================== SUMMARY ================================ */

  describe('daily summary', () => {
    it('fills the home dashboard from one call', async () => {
      await call('PUT', '/goals', {
        token: tokenA,
        body: { effective_date: D1, daily_calories: 2000, daily_water_ml: 2500, daily_steps: 10000 },
      });
      await call('POST', '/nutrition/entries', {
        token: tokenA,
        body: { date: D1, food_name: 'Oats', meal_type: 'breakfast', calories: 300 },
      });
      await call('POST', '/water/entries', { token: tokenA, body: { date: D1, amount_ml: 750 } });
      await call('POST', '/weight/entries', { token: tokenA, body: { date: D1, weight: 70, unit: 'kg' } });
      await call('POST', '/entries/steps', { token: tokenA, body: { date: D1, steps: 8123 } });

      const { summary } = await json<{
        summary: {
          date: string;
          nutrition: { totals: { calories: number } };
          water: { total_ml: number; goal_ml: number };
          weight: { value: number; unit: string; date: string };
          steps: { value: number; goal: number };
        };
      }>(await call('GET', `/summary?date=${D1}`, { token: tokenA }));

      expect(summary.date).toBe(D1);
      expect(summary.nutrition.totals.calories).toBe(300);
      expect(summary.water).toMatchObject({ total_ml: 750, goal_ml: 2500 });
      expect(summary.weight).toEqual({ value: 70, unit: 'kg', date: D1 });
      expect(summary.steps).toEqual({ value: 8123, goal: 10000 });
    });

    it('is null-safe on a day with nothing logged', async () => {
      const { summary } = await json<{
        summary: { weight: unknown; steps: { value: number; goal: number | null }; water: { total_ml: number } };
      }>(await call('GET', `/summary?date=${D1}`, { token: tokenA }));
      expect(summary.weight).toBeNull();
      expect(summary.steps).toEqual({ value: 0, goal: null });
      expect(summary.water.total_ml).toBe(0);
    });
  });

  /* ============================ SYNC ================================= */

  describe('sync', () => {
    it('returns rows after the cursor INCLUDING tombstones', async () => {
      const id = await createWeight(tokenA, { date: D1, weight: 70, unit: 'kg' });
      await call('DELETE', `/weight/entries/${id}`, { token: tokenA });

      const res = await call('GET', '/sync?since=1970-01-01T00:00:00.000Z', { token: tokenA });
      expect(res.status).toBe(200);
      const body = await json<{
        since: string;
        server_time: string;
        weight_entries: Array<{ id: string; deleted_at: string | null }>;
      }>(res);
      expect(body.since).toBe('1970-01-01T00:00:00.000Z');
      expect(body.server_time).toBeTruthy();
      // A hard delete would make the row silently reappear on the next pull.
      expect(body.weight_entries).toHaveLength(1);
      expect(body.weight_entries[0].id).toBe(id);
      expect(body.weight_entries[0].deleted_at).toBeTruthy();
    });

    it('returns every table and honours a future cursor', async () => {
      await createWeight(tokenA, { date: D1, weight: 70, unit: 'kg' });
      await call('POST', '/water/entries', { token: tokenA, body: { date: D1, amount_ml: 250 } });
      await call('POST', '/nutrition/entries', {
        token: tokenA,
        body: { date: D1, food_name: 'Egg', meal_type: 'breakfast', calories: 70 },
      });
      await call('POST', '/measurements', { token: tokenA, body: { date: D1, unit: 'cm', waist: 80 } });
      await call('POST', '/entries/steps', { token: tokenA, body: { date: D1, steps: 100 } });
      const habitId = (
        await json<{ habit: { id: string } }>(
          await call('POST', '/habits', { token: tokenA, body: { name: 'Stretch' } })
        )
      ).habit.id;
      await call('POST', `/habits/${habitId}/toggle`, { token: tokenA, body: { date: D1 } });
      await call('POST', '/cycle/periods', { token: tokenA, body: { date: D1, flow_level: 3 } });
      await call('PUT', '/cycle/symptoms', { token: tokenA, body: { date: D1, mood: 3 } });
      await call('PUT', '/mens-health/entries', { token: tokenA, body: { date: D1, libido: 5 } });

      const full = await json<Record<string, unknown>>(await call('GET', '/sync', { token: tokenA }));
      const collections = [
        'weight_entries',
        'water_entries',
        'nutrition_entries',
        'body_measurements',
        'health_entries',
        'habits',
        'habit_logs',
        'period_entries',
        'cycle_symptom_entries',
        'mens_health_entries',
      ];
      const empty = collections.filter((k) => (full[k] as unknown[]).length === 0);
      expect(empty).toEqual([]);

      // A cursor in the future has nothing to hand back.
      const future = await json<Record<string, unknown[]>>(
        await call('GET', '/sync?since=2999-01-01T00:00:00.000Z', { token: tokenA })
      );
      for (const key of collections) expect(future[key]).toEqual([]);
    });

    /**
     * EVERY health table the migrations added is either PULLED by `/sync` or on
     * the list below with a reason.
     *
     * The failure this exists to prevent has already happened once here: the
     * pull shipped without cycle settings, goals or the P2 rows while
     * `/sync/push` accepted all of them, so a device could push a change no
     * other device could ever pull back. The asymmetry is invisible until
     * somebody reinstalls, and by then the data is gone. Adding a table now
     * forces a decision — wire it into `sync()`, or say here why it does not
     * belong to a device.
     */
    it('HEALTH-SYNC-201: every health table is pulled by /sync, or excluded on the record', async () => {
      /** table name → the reason it is deliberately NOT in the delta pull. */
      const EXCLUDED: Record<string, string> = {
        users: 'platform identity, not health data',
        health_weekly_weight_averages:
          'DERIVED rollup owned by recomputeWeeklyAverage — re-derived on the next weight write, so syncing it would fork the maths',
        food_usage_history:
          'server-side journal behind /foods/suggestions; the device never authors a row, it POSTs /custom-foods/:id/use',
        body_photo_insights:
          'AI output. routes/health-body-extras.ts is READ-ONLY over HTTP by design — a device that could push one could fabricate an "AI" assessment',
        body_comprehensive_insights:
          'same: written only in-process by MeasurementInsightService, never by a client',
        exercise_library:
          'GLOBAL catalogue authored in migration 0123 — identical on every account, and no client may write it',
        exercise_favorites:
          'server-authoritative toggle, read back through GET /exercises?favorites=true; nothing is lost on a reinstall',
        health_coach_consent_receipts:
          'consent must be re-read from the server every time — restoring a grant from a device cache would re-grant something the person may have revoked elsewhere',
        health_coach_operations:
          'audit ledger. A receipt records what the server did; a device replaying its own copy would be evidence of nothing',
      };
      // The whole social domain is multi-user and server-authoritative: a
      // family, a buddy grant or a challenge standing is not a device-local row
      // and must not be restored from one.
      for (const table of HEALTH_SOCIAL_TABLE_NAMES) {
        EXCLUDED[table] =
          'multi-user and server-authoritative — shared state is never restored from a device cache';
      }

      /** Sync collection name for a table, where the two differ. */
      const COLLECTION_OF: Record<string, string> = {
        user_habits: 'habits',
        health_reminder_preferences: 'reminder_preferences',
      };

      const body = await json<Record<string, unknown>>(await call('GET', '/sync', { token: tokenA }));
      const collections = new Set(
        Object.keys(body).filter((k) => k !== 'since' && k !== 'server_time')
      );

      const allTables = new Set([
        ...HEALTH_TABLE_NAMES,
        ...HEALTH_FOOD_TABLE_NAMES,
        ...HEALTH_P2_BODY_EXTRAS_TABLE_NAMES,
        ...HEALTH_P2_ASSETS_TABLE_NAMES,
        ...HEALTH_SOCIAL_TABLE_NAMES,
        ...HEALTH_EXERCISE_TABLE_NAMES,
        ...HEALTH_P3_AI_TABLE_NAMES,
      ]);

      const unaccounted = [...allTables].filter(
        (t) => !collections.has(COLLECTION_OF[t] ?? t) && !(t in EXCLUDED)
      );
      expect(unaccounted).toEqual([]);

      // …and no collection in the response is a phantom with no table behind it.
      const backing = new Set([...allTables].map((t) => COLLECTION_OF[t] ?? t));
      expect([...collections].filter((k) => !backing.has(k))).toEqual([]);
    });
  });
});
