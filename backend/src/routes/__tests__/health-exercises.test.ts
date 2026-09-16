/**
 * Symply Health WORKOUT LIBRARY routes (`src/routes/health-exercises.ts`) —
 * HTTP surface of the ported donor `exercise_library`, driven through the real
 * Hono router against a live miniflare D1 seeded from the REAL migration.
 *
 * Four layers, in order of importance — same contract as health-food.test.ts:
 *   1. BRAND GATE — `requireHealthApi()` must 404 every single path on
 *      House/Budget/Kaizen. The gate is registered before `authMiddleware()`,
 *      so a wrong-brand request must never even reach the token check.
 *   2. AUTH — on the Health Worker every path is 401 without a valid bearer.
 *   3. USER SCOPING — the CATALOGUE is shared, but everything personal hanging
 *      off it is not: user B must never see user A's favourites, and A's
 *      injuries must never gate B's library.
 *   4. THE INJURY GATE over HTTP — the safety surface. An exercise loading a
 *      body part with an active injury comes back flagged and de-prioritised.
 *
 * The scoring, folding and ordering maths lives in
 * services/__tests__/health-exercise-service.test.ts.
 *
 * Harness mirrors health-food.test.ts: `cloudflare:test` env, a jose HS256 JWT
 * whose `sub` becomes the user id, brand flipped by spreading a new APP_BRAND
 * onto the pool env, and local DDL from health-test-helpers.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import healthRoutes from '../health';
import healthExerciseRoutes from '../health-exercises';

import {
  createHealthExerciseTables,
  createHealthTables,
  insertHealthRow,
  listHealthRows,
  resetHealthExerciseTables,
  resetHealthTables,
  seedExerciseCatalogueFromMigration,
  seedHealthUsers,
} from './health-test-helpers';

const testEnv = env as unknown as Env;

// The pool env is House (wrangler.toml); each brand gets its own copy so a
// single request can be replayed across the fleet.
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;
const HOUSE_ENV = { ...testEnv, APP_BRAND: 'symply-house' } as Env;
const BUDGET_ENV = { ...testEnv, APP_BRAND: 'symply-budget' } as Env;
const KAIZEN_ENV = { ...testEnv, APP_BRAND: 'symply-kaizen' } as Env;

const UID_A = 'u_ex_route_alice';
const UID_B = 'u_ex_route_bob';

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

/** Mirrors the `app.route('/health', healthExerciseRoutes)` mount in src/index.ts. */
function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthExerciseRoutes);
  return app;
}

let tokenA = '';
let tokenB = '';
let seededCount = 0;

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

interface ExerciseJson {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  muscle_groups: string[];
  secondary_muscles: string[];
  equipment: string[];
  body_parts: string[];
  difficulty: string;
  difficulty_level: number;
  instructions: string | null;
  illustration: string | null;
  media_url: string | null;
  default_minutes: number;
  workout_type: string;
  is_favorite: boolean;
  injury_flag: 'caution' | 'avoid' | null;
  injury_body_parts: string[];
}

interface ListJson {
  exercises: ExerciseJson[];
  injury_body_parts: Array<{ body_part: string; canonical: string; max_pain_level: number }>;
}

/** Every path the router owns — the gate/auth sweeps must cover all of them. */
const ROUTES: ReadonlyArray<readonly [string, string, unknown?]> = [
  ['GET', '/exercises'],
  ['GET', '/exercises?search=plank&muscle_group=abs&difficulty=level2'],
  ['GET', '/exercises/ex_plank'],
  ['PUT', '/exercises/ex_plank/favorite', { is_favorite: true }],
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

async function seedInjury(
  userId: string,
  bodyPart: string,
  over: { id?: string; pain?: number; active?: boolean } = {}
): Promise<void> {
  const ts = '2026-07-01T00:00:00.000Z';
  await insertHealthRow(testEnv.DB, 'injuries', {
    id: over.id ?? `inj_${userId}_${bodyPart.replace(/\W+/g, '_')}`,
    user_id: userId,
    date: '2026-07-01',
    body_part: bodyPart,
    pain_level: over.pain ?? 3,
    injury_type: 'pain',
    cause: null,
    muscle_group: null,
    notes: null,
    is_active: over.active === false ? 0 : 1,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
  });
}

async function list(path = '/exercises', token = tokenA): Promise<ListJson> {
  const res = await call('GET', path, { token });
  expect(res.status).toBe(200);
  return json<ListJson>(res);
}

describe('health workout-library routes', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createHealthExerciseTables(testEnv.DB);
    await resetHealthExerciseTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
    seededCount = await seedExerciseCatalogueFromMigration(testEnv.DB);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);
  });

  /* ====================== 1. BRAND GATE ============================== */

  describe('brand gate (requireHealthApi)', () => {
    // A shared-fleet deploy puts these routes on every Worker binary. The gate
    // is the only thing stopping House/Budget/Kaizen from serving a Health
    // user's favourites and injury flags, so it is swept across EVERY path.
    it.each([
      ['symply-house', HOUSE_ENV],
      ['symply-budget', BUDGET_ENV],
      ['symply-kaizen', KAIZEN_ENV],
    ])('404s every /health exercise route on %s', async (_brand, brandEnv) => {
      const leaked: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body, brandEnv });
        if (!(await isGate404(res))) leaked.push(`${method} ${path} -> ${res.status}`);
      }
      expect(leaked).toEqual([]);
    });

    it('fires BEFORE auth — a tokenless wrong-brand request 404s, never 401s', async () => {
      // Ordering matters: a 401 would confirm the surface exists on that brand.
      const res = await call('GET', '/exercises', { token: null, brandEnv: BUDGET_ENV });
      expect(res.status).toBe(404);
      expect(await json<{ error: { message: string } }>(res)).toEqual({
        error: { code: 'not_found', message: GATE_MESSAGE },
      });
    });

    it('never fires on symply-health — every route is reachable there', async () => {
      const gated: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body });
        if (await isGate404(res)) gated.push(`${method} ${path}`);
      }
      expect(gated).toEqual([]);
    });

    it('no route 5xxs on a cold account with no favourites and no injuries', async () => {
      const crashed: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body });
        if (res.status >= 500) crashed.push(`${method} ${path} -> ${res.status}`);
      }
      expect(crashed).toEqual([]);
    });

    it('coexists with the P1 router on the same /health prefix', async () => {
      // Disjoint sub-paths, so mounting order must not matter: the library and
      // the P1 tracking surface answer through one app.
      const app = new Hono<{ Bindings: Env }>();
      app.route('/health', healthRoutes);
      app.route('/health', healthExerciseRoutes);
      const headers = { Authorization: `Bearer ${tokenA}` };
      expect(
        (await app.request('/health/weight/entries', { headers }, HEALTH_ENV)).status
      ).toBe(200);
      expect((await app.request('/health/exercises', { headers }, HEALTH_ENV)).status).toBe(200);
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
      expect((await call('GET', '/exercises', { token: forged })).status).toBe(401);
    });

    it('401s a malformed bearer value', async () => {
      expect((await call('GET', '/exercises', { token: 'not-a-jwt' })).status).toBe(401);
    });
  });

  /* ====================== 3. USER SCOPING ============================= */

  describe('user scoping (shared catalogue, personal everything else)', () => {
    it('serves the SAME catalogue to every account', async () => {
      // The catalogue is global by design — it is authored in the migration, not
      // owned by a user. This is what makes read-only-over-HTTP correct.
      const a = await list('/exercises', tokenA);
      const b = await list('/exercises', tokenB);
      expect(a.exercises.map((e) => e.id)).toEqual(b.exercises.map((e) => e.id));
      expect(a.exercises).toHaveLength(seededCount);
    });

    it('never leaks another user favourite', async () => {
      expect(
        (await call('PUT', '/exercises/ex_plank/favorite', { token: tokenA, body: { is_favorite: true } }))
          .status
      ).toBe(200);

      const mine = await list('/exercises?favorites=true', tokenA);
      expect(mine.exercises.map((e) => e.id)).toEqual(['ex_plank']);

      const theirs = await list('/exercises?favorites=true', tokenB);
      expect(theirs.exercises).toEqual([]);

      const detail = await json<{ exercise: ExerciseJson }>(
        await call('GET', '/exercises/ex_plank', { token: tokenB })
      );
      expect(detail.exercise.is_favorite).toBe(false);
    });

    it('never lets one account gate another account library', async () => {
      // Injuries are the most sensitive input this surface has. A leak here
      // would also be a health-data disclosure, not just a wrong sort order.
      await seedInjury(UID_A, 'Left knee');

      const theirs = await list('/exercises', tokenB);
      expect(theirs.injury_body_parts).toEqual([]);
      expect(theirs.exercises.every((e) => e.injury_flag === null)).toBe(true);
      expect(theirs.exercises.every((e) => e.injury_body_parts.length === 0)).toBe(true);
    });

    it('un-favouriting another account favourite is impossible — it writes its OWN row', async () => {
      await call('PUT', '/exercises/ex_plank/favorite', {
        token: tokenA,
        body: { is_favorite: true },
      });
      // B "un-favourites" the same exercise. A's row must be untouched.
      expect(
        (await call('PUT', '/exercises/ex_plank/favorite', {
          token: tokenB,
          body: { is_favorite: false },
        })).status
      ).toBe(200);

      expect((await list('/exercises?favorites=true', tokenA)).exercises.map((e) => e.id)).toEqual([
        'ex_plank',
      ]);
      const rows = await listHealthRows<{ user_id: string; deleted_at: string | null }>(
        testEnv.DB,
        'exercise_favorites'
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(UID_A);
      expect(rows[0].deleted_at).toBeNull();
    });
  });

  /* ==================== 4. THE INJURY GATE ============================ */

  describe('injury gate (safety surface)', () => {
    it('flags and de-prioritises an exercise that loads an injured part', async () => {
      await seedInjury(UID_A, 'Left knee', { pain: 3 });
      const body = await list();

      expect(body.injury_body_parts).toEqual([
        { body_part: 'Left knee', canonical: 'knee', max_pain_level: 3, injury_count: 1 },
      ]);

      const squat = body.exercises.find((e) => e.id === 'ex_squat');
      expect(squat?.injury_flag).toBe('avoid');
      // Reported in the user's OWN wording so the UI can name the injury.
      expect(squat?.injury_body_parts).toEqual(['Left knee']);

      // De-prioritised: nothing flagged may appear before something clear.
      const rank = (f: ExerciseJson['injury_flag']) => (f === 'avoid' ? 2 : f === 'caution' ? 1 : 0);
      const ranks = body.exercises.map((e) => rank(e.injury_flag));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      expect(body.exercises[0].injury_flag).toBeNull();
    });

    it('flags but does NOT hide — rehab work for the injured part stays findable', async () => {
      await seedInjury(UID_A, 'lower back');
      const body = await list();
      expect(body.exercises).toHaveLength(seededCount);
      expect(body.exercises.some((e) => e.injury_flag !== null)).toBe(true);
      // A physio-prescribed pelvic tilt loads the lower back on purpose.
      expect(body.exercises.some((e) => e.id === 'ex_pelvic_tilt')).toBe(true);
    });

    it('exclude_flagged=true is opt-in and removes them', async () => {
      await seedInjury(UID_A, 'knee');
      const kept = await list('/exercises');
      const dropped = await list('/exercises?exclude_flagged=true');
      expect(dropped.exercises.length).toBeLessThan(kept.exercises.length);
      expect(dropped.exercises.every((e) => e.injury_flag === null)).toBe(true);
    });

    it('surfaces the flag on the DETAIL route too', async () => {
      await seedInjury(UID_A, 'wrist');
      const detail = await json<{ exercise: ExerciseJson }>(
        await call('GET', '/exercises/ex_pushup', { token: tokenA })
      );
      // A wrist injury has to reach a push-up, whose muscles are chest/triceps.
      expect(detail.exercise.injury_flag).toBe('avoid');
      expect(detail.exercise.injury_body_parts).toEqual(['wrist']);
    });

    it('a healed injury stops flagging', async () => {
      await seedInjury(UID_A, 'knee', { active: false });
      const body = await list();
      expect(body.injury_body_parts).toEqual([]);
      expect(body.exercises.every((e) => e.injury_flag === null)).toBe(true);
    });
  });

  /* ================== 5. CATALOGUE / FILTER CONTRACT ================== */

  describe('GET /exercises', () => {
    it('answers with the parsed catalogue — no raw JSON blobs reach the client', async () => {
      const body = await list();
      const squat = body.exercises.find((e) => e.id === 'ex_squat');
      expect(squat).toBeDefined();
      // Arrays, not '["quads","glutes"]' strings: the client never parses D1.
      expect(Array.isArray(squat?.muscle_groups)).toBe(true);
      expect(squat?.muscle_groups).toEqual(['quads', 'glutes']);
      expect(squat?.equipment).toContain('barbell');
      expect(squat?.body_parts).toContain('knee');
      expect(squat?.difficulty_level).toBe(2);
      expect(typeof squat?.instructions).toBe('string');
      expect(squat?.workout_type).toBe('strength');
      expect(squat?.default_minutes).toBeGreaterThan(0);
      // Video is P4.
      expect(squat?.media_url).toBeNull();
    });

    it('filters by muscle group, equipment, difficulty and category', async () => {
      const glutes = await list('/exercises?muscle_group=glutes');
      expect(glutes.exercises.length).toBeGreaterThan(0);
      expect(
        glutes.exercises.every(
          (e) => e.muscle_groups.includes('glutes') || e.secondary_muscles.includes('glutes')
        )
      ).toBe(true);

      const roller = await list('/exercises?equipment=foam_roller');
      expect(roller.exercises.length).toBeGreaterThan(0);
      expect(roller.exercises.every((e) => e.equipment.includes('foam_roller'))).toBe(true);

      const level1 = await list('/exercises?difficulty=level1');
      expect(level1.exercises.every((e) => e.difficulty === 'level1')).toBe(true);

      const yoga = await list('/exercises?category=yoga');
      expect(yoga.exercises.length).toBeGreaterThan(0);
      expect(yoga.exercises.every((e) => e.category === 'yoga')).toBe(true);
    });

    it('searches by name and by ALIAS', async () => {
      expect((await list('/exercises?search=plank')).exercises[0].id).toBe('ex_plank');
      // "press up" is nowhere in any exercise NAME — this is the alias column.
      expect((await list('/exercises?search=press%20up')).exercises.map((e) => e.id)).toContain(
        'ex_pushup'
      );
      expect((await list('/exercises?search=kayaking')).exercises).toEqual([]);
    });

    it('honours limit', async () => {
      expect((await list('/exercises?limit=3')).exercises).toHaveLength(3);
    });

    it('400s an out-of-vocabulary category or difficulty', async () => {
      // Closed sets: a typo would otherwise return an EMPTY library, which reads
      // to a user as "there are no exercises".
      for (const path of ['/exercises?category=pilates', '/exercises?difficulty=hard']) {
        const res = await call('GET', path, { token: tokenA });
        expect(res.status).toBe(400);
        expect((await json<{ error: { code: string } }>(res)).error.code).toBe('bad_request');
      }
    });

    it('an unknown OPEN-vocabulary token returns an empty list, not a 400', async () => {
      // muscle_group / equipment are open by design (the catalogue grows).
      const res = await call('GET', '/exercises?muscle_group=gills', { token: tokenA });
      expect(res.status).toBe(200);
      expect((await json<ListJson>(res)).exercises).toEqual([]);
    });
  });

  describe('GET /exercises/:id', () => {
    it('returns one exercise', async () => {
      const res = await call('GET', '/exercises/ex_downward_dog', { token: tokenA });
      expect(res.status).toBe(200);
      const { exercise } = await json<{ exercise: ExerciseJson }>(res);
      expect(exercise.name).toBe('Downward Dog');
      expect(exercise.category).toBe('yoga');
      expect(exercise.instructions?.length ?? 0).toBeGreaterThan(20);
    });

    it('404s an unknown id with a real not-found, not the gate envelope', async () => {
      const res = await call('GET', '/exercises/ex_nope', { token: tokenA });
      expect(res.status).toBe(404);
      expect(await json<{ error: { code: string; message: string } }>(res)).toEqual({
        error: { code: 'not_found', message: 'Exercise not found' },
      });
    });
  });

  /* ======================= 6. FAVOURITES ============================== */

  describe('PUT /exercises/:id/favorite', () => {
    it('favourites and un-favourites, answering with the updated row', async () => {
      const on = await json<{ exercise: ExerciseJson }>(
        await call('PUT', '/exercises/ex_plank/favorite', {
          token: tokenA,
          body: { is_favorite: true },
        })
      );
      expect(on.exercise.is_favorite).toBe(true);

      const off = await json<{ exercise: ExerciseJson }>(
        await call('PUT', '/exercises/ex_plank/favorite', {
          token: tokenA,
          body: { is_favorite: false },
        })
      );
      expect(off.exercise.is_favorite).toBe(false);
    });

    it('un-favouriting leaves a TOMBSTONE, never a hard delete', async () => {
      await call('PUT', '/exercises/ex_plank/favorite', {
        token: tokenA,
        body: { is_favorite: true },
      });
      await call('PUT', '/exercises/ex_plank/favorite', {
        token: tokenA,
        body: { is_favorite: false },
      });

      const rows = await listHealthRows<{ deleted_at: string | null; updated_at: string }>(
        testEnv.DB,
        'exercise_favorites'
      );
      expect(rows).toHaveLength(1);
      // The row survives: a hard DELETE would let another device push its stale
      // copy back and silently resurrect the favourite.
      expect(rows[0].deleted_at).not.toBeNull();
      expect(rows[0].updated_at.length).toBeGreaterThan(0);
    });

    it('is idempotent in both directions and never duplicates a row', async () => {
      for (const value of [true, true, false, false, true]) {
        expect(
          (await call('PUT', '/exercises/ex_plank/favorite', {
            token: tokenA,
            body: { is_favorite: value },
          })).status
        ).toBe(200);
      }
      expect(await listHealthRows(testEnv.DB, 'exercise_favorites')).toHaveLength(1);
      expect((await list('/exercises?favorites=true')).exercises.map((e) => e.id)).toEqual([
        'ex_plank',
      ]);
    });

    it('400s a missing or non-boolean is_favorite', async () => {
      for (const body of [{}, { is_favorite: 'yes' }, { is_favorite: 1 }, { is_favorite: null }]) {
        const res = await call('PUT', '/exercises/ex_plank/favorite', { token: tokenA, body });
        expect(res.status).toBe(400);
      }
      expect(await listHealthRows(testEnv.DB, 'exercise_favorites')).toEqual([]);
    });

    it('404s an unknown exercise and writes nothing', async () => {
      const res = await call('PUT', '/exercises/ex_nope/favorite', {
        token: tokenA,
        body: { is_favorite: true },
      });
      expect(res.status).toBe(404);
      expect(await listHealthRows(testEnv.DB, 'exercise_favorites')).toEqual([]);
    });
  });

  /* =================== 7. NO SESSION LOGGING HERE ===================== */

  describe('session logging is not duplicated', () => {
    it('this router exposes no log endpoint — the EXISTING entries route owns it', async () => {
      // "Log this" must go through `/health/entries/workouts`. A second writer
      // here would fork the activity history in two.
      const res = await call('POST', '/exercises/ex_plank/log', {
        token: tokenA,
        body: { minutes: 10 },
      });
      expect(res.status).toBe(404);
    });

    it('every catalogue row carries a workout_type the entries route accepts', async () => {
      // The contract that makes "log this" work without duplicating anything.
      const app = new Hono<{ Bindings: Env }>();
      app.route('/health', healthRoutes);
      app.route('/health', healthExerciseRoutes);

      const body = await list();
      const types = [...new Set(body.exercises.map((e) => e.workout_type))].sort();
      expect(types.length).toBeGreaterThan(1);

      for (const workout_type of types) {
        const res = await app.request(
          '/health/entries/workouts',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokenA}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ date: '2026-07-25', workout_type, minutes: 20 }),
          },
          HEALTH_ENV
        );
        expect([200, 201]).toContain(res.status);
      }
    });
  });
});
