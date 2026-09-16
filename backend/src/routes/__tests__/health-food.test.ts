/**
 * Symply Health FOOD routes (`src/routes/health-food.ts`) — HTTP surface of the
 * ported donor `customFoods` / `foodSearch` / `recipes` routes (parity P2),
 * driven through the real Hono router against a live miniflare D1.
 *
 * Three layers, in order of importance — same contract as health.test.ts:
 *   1. BRAND GATE — `requireHealthApi()` must 404 every single path on
 *      House/Budget/Kaizen. The gate is registered before `authMiddleware()`,
 *      so a wrong-brand request must never even reach the token check.
 *   2. AUTH — on the Health Worker every path is 401 without a valid bearer.
 *   3. USER SCOPING — a food library is PERSONAL: user B must never read,
 *      update, delete, re-portion or log a use against a row owned by user A.
 *
 * Everything below that is the per-endpoint HTTP contract (status codes,
 * envelopes, validation). The maths — per-100 portioning, recipe totals,
 * scaling, time-of-day bucketing, relevance — lives in
 * services/__tests__/health-food-service.test.ts.
 *
 * Harness mirrors health.test.ts: `cloudflare:test` env, a jose HS256 JWT whose
 * `sub` becomes the user id, brand flipped by spreading a new APP_BRAND onto the
 * pool env, and local DDL from health-test-helpers.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import healthRoutes from '../health';
import healthFoodRoutes from '../health-food';

import {
  createHealthFoodTables,
  createHealthTables,
  resetHealthFoodTables,
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

const UID_A = 'u_food_route_alice';
const UID_B = 'u_food_route_bob';

/** Fixed stamps — nothing here depends on the wall clock. */
const MORNING = '2026-06-01T07:30:00.000Z';
const MORNING_2 = '2026-06-02T08:15:00.000Z';
const EVENING = '2026-06-01T19:30:00.000Z';

/** Oats: 155.5 kcal/100g never divides cleanly, which is the point. */
const OATS_BASIS = {
  base_calories_per_100: 155.5,
  base_proteins_per_100: 13.2,
  base_carbs_per_100: 67.7,
  base_fats_per_100: 6.9,
};

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

/** Mirrors the `app.route('/health', healthFoodRoutes)` mount in src/index.ts. */
function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthFoodRoutes);
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

interface FoodRow {
  id: string;
  name: string;
  brand_name: string | null;
  portion: number;
  unit: string;
  calories: number;
  proteins: number;
  carbohydrates: number;
  fats: number;
  base_calories_per_100: number;
  base_proteins_per_100: number;
  is_favorite: boolean;
  use_count: number;
  last_used_at: string | null;
  barcode: string | null;
  preferred_meal_types: string;
  source_type: string;
  is_shared: boolean;
  share_code: string | null;
  deleted_at: string | null;
}

interface RecipeRowJson {
  id: string;
  name: string;
  servings: number;
  ingredients: string;
  total_calories: number;
  total_proteins: number;
  is_favorite: boolean;
  category: string | null;
}

/** Every path the router owns — the gate/auth sweeps must cover all of them. */
const ROUTES: ReadonlyArray<readonly [string, string, unknown?]> = [
  ['GET', '/custom-foods'],
  ['POST', '/custom-foods', { name: 'Oats', portion: 100, ...OATS_BASIS }],
  ['PUT', '/custom-foods/cf_x', { portion: 50 }],
  ['DELETE', '/custom-foods/cf_x'],
  ['POST', '/custom-foods/cf_x/use', { meal_type: 'breakfast' }],
  ['GET', '/foods/search?query=oat'],
  ['GET', '/foods/suggestions?meal_type=breakfast'],
  ['GET', '/foods/provider'],
  // `POST /foods/import` is swept in health-food-external.test.ts instead: with
  // no credential in this pool env it legitimately answers 503, which the
  // "no route 5xxs on a cold account" spec below would read as a defect. The
  // neighbouring file configures the provider and stubs its fetch, so it can
  // sweep the gate, auth and user scoping for that path honestly.
  ['GET', '/recipes'],
  [
    'POST',
    '/recipes',
    { name: 'Porridge', ingredients: [{ name: 'Oats', quantity: 80, ...OATS_BASIS }] },
  ],
  ['PUT', '/recipes/rcp_x', { name: 'Porridge' }],
  ['DELETE', '/recipes/rcp_x'],
  ['POST', '/recipes/rcp_x/scale', { servings: 4 }],
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

async function createFood(
  body: Record<string, unknown> = {},
  token = tokenA
): Promise<FoodRow> {
  const res = await call('POST', '/custom-foods', {
    token,
    body: { name: 'Oats', portion: 100, unit: 'g', ...OATS_BASIS, ...body },
  });
  expect(res.status).toBe(201);
  return (await json<{ food: FoodRow }>(res)).food;
}

async function createRecipe(
  body: Record<string, unknown> = {},
  token = tokenA
): Promise<RecipeRowJson> {
  const res = await call('POST', '/recipes', {
    token,
    body: {
      name: 'Porridge',
      servings: 2,
      ingredients: [
        { name: 'Oats', quantity: 80, ...OATS_BASIS },
        {
          name: 'Milk',
          quantity: 250,
          base_calories_per_100: 42,
          base_proteins_per_100: 3.4,
          base_carbs_per_100: 5,
          base_fats_per_100: 1,
        },
      ],
      ...body,
    },
  });
  expect(res.status).toBe(201);
  return (await json<{ recipe: RecipeRowJson }>(res)).recipe;
}

describe('health food routes', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createHealthFoodTables(testEnv.DB);
    await resetHealthFoodTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);
  });

  /* ====================== 1. BRAND GATE ============================== */

  describe('brand gate (requireHealthApi)', () => {
    // A shared-fleet deploy puts these routes on every Worker binary. The gate
    // is the only thing stopping House/Budget/Kaizen from serving a user's food
    // library, so it is swept across EVERY path rather than a sample.
    it.each([
      ['symply-house', HOUSE_ENV],
      ['symply-budget', BUDGET_ENV],
      ['symply-kaizen', KAIZEN_ENV],
    ])('404s every /health food route on %s', async (_brand, brandEnv) => {
      const leaked: string[] = [];
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { token: tokenA, body, brandEnv });
        if (!(await isGate404(res))) leaked.push(`${method} ${path} -> ${res.status}`);
      }
      expect(leaked).toEqual([]);
    });

    it('fires BEFORE auth — a tokenless wrong-brand request 404s, never 401s', async () => {
      // Ordering matters: a 401 would confirm the surface exists on that brand.
      const res = await call('GET', '/custom-foods', { token: null, brandEnv: BUDGET_ENV });
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

    it('coexists with the P1 router on the same /health prefix', async () => {
      // Both P2 routers own disjoint sub-paths, so mounting order must not
      // matter: the food surface and the P1 surface answer through one app.
      const app = new Hono<{ Bindings: Env }>();
      app.route('/health', healthRoutes);
      app.route('/health', healthFoodRoutes);
      const headers = { Authorization: `Bearer ${tokenA}` };
      expect(
        (await app.request('/health/weight/entries', { headers }, HEALTH_ENV)).status
      ).toBe(200);
      expect((await app.request('/health/custom-foods', { headers }, HEALTH_ENV)).status).toBe(200);
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
      const res = await call('GET', '/custom-foods', { token: forged });
      expect(res.status).toBe(401);
    });

    it('401s a malformed bearer value', async () => {
      const res = await call('GET', '/custom-foods', { token: 'not-a-jwt' });
      expect(res.status).toBe(401);
    });
  });

  /* ====================== 3. USER SCOPING ============================= */

  describe('user scoping (personal data, no household)', () => {
    it('never leaks another user rows in any list endpoint', async () => {
      const food = await createFood({ name: 'Alice oats' });
      await call('POST', `/custom-foods/${food.id}/use`, {
        token: tokenA,
        body: { used_at: MORNING },
      });
      await createRecipe({ name: 'Alice porridge' });

      const empties: Array<[string, string]> = [
        ['/custom-foods', 'foods'],
        ['/foods/search?query=alice', 'results'],
        ['/recipes', 'recipes'],
      ];
      const leaks: string[] = [];
      for (const [path, key] of empties) {
        const res = await call('GET', path, { token: tokenB });
        const rows = (await json<Record<string, unknown[]>>(res))[key];
        if (rows.length !== 0) leaks.push(`${path} -> ${rows.length}`);
      }
      expect(leaks).toEqual([]);

      // Suggestions read food_usage_history — the same rule applies there.
      const suggestions = await json<{ suggestions: unknown[] }>(
        await call('GET', `/foods/suggestions?at=${MORNING_2}`, { token: tokenB })
      );
      expect(suggestions.suggestions).toEqual([]);
    });

    it('404s every cross-user mutation by id and leaves the row intact', async () => {
      const food = await createFood({ name: 'Alice oats', is_favorite: true });
      const recipe = await createRecipe({ name: 'Alice porridge' });

      const attacks: Array<[string, string, unknown?]> = [
        ['PUT', `/custom-foods/${food.id}`, { name: 'Stolen', portion: 1 }],
        ['DELETE', `/custom-foods/${food.id}`],
        ['POST', `/custom-foods/${food.id}/use`, { meal_type: 'breakfast' }],
        ['PUT', `/recipes/${recipe.id}`, { name: 'Stolen' }],
        ['DELETE', `/recipes/${recipe.id}`],
        ['POST', `/recipes/${recipe.id}/scale`, { servings: 8 }],
      ];
      const allowed: string[] = [];
      for (const [method, path, body] of attacks) {
        const res = await call(method, path, { token: tokenB, body });
        // 404, never 403 — a 403 would confirm the id exists on another account.
        if (res.status !== 404) allowed.push(`${method} ${path} -> ${res.status}`);
      }
      expect(allowed).toEqual([]);

      // A's rows survive untouched: same name, same portion, no phantom use.
      const foods = await json<{ foods: FoodRow[] }>(
        await call('GET', '/custom-foods', { token: tokenA })
      );
      expect(foods.foods).toHaveLength(1);
      expect(foods.foods[0].name).toBe('Alice oats');
      expect(foods.foods[0].portion).toBe(100);
      expect(foods.foods[0].use_count).toBe(0);
      expect(foods.foods[0].last_used_at).toBeNull();

      const recipes = await json<{ recipes: RecipeRowJson[] }>(
        await call('GET', '/recipes', { token: tokenA })
      );
      expect(recipes.recipes).toHaveLength(1);
      expect(recipes.recipes[0].name).toBe('Alice porridge');
    });

    it('cannot borrow another user food as a recipe ingredient', async () => {
      // The one cross-user READ a recipe could smuggle: an ingredient that only
      // carries a food_id is resolved against the CALLER's library.
      const theirs = await createFood({ name: 'Alice secret' }, tokenA);
      const res = await call('POST', '/recipes', {
        token: tokenB,
        body: {
          name: 'Borrowed',
          ingredients: [{ name: 'Theirs', quantity: 100, food_id: theirs.id }],
        },
      });
      expect(res.status).toBe(400);
      expect((await json<{ error: { code: string } }>(res)).error.code).toBe('invalid_ingredients');
      expect(
        (await json<{ recipes: unknown[] }>(await call('GET', '/recipes', { token: tokenB })))
          .recipes
      ).toEqual([]);
    });

    it('keeps identical food names in separate user lanes', async () => {
      await createFood({ name: 'Oats', portion: 100 }, tokenA);
      await createFood({ name: 'Oats', portion: 40 }, tokenB);
      const a = await json<{ foods: FoodRow[] }>(await call('GET', '/custom-foods', { token: tokenA }));
      const b = await json<{ foods: FoodRow[] }>(await call('GET', '/custom-foods', { token: tokenB }));
      expect(a.foods).toHaveLength(1);
      expect(b.foods).toHaveLength(1);
      expect(a.foods[0].portion).toBe(100);
      expect(b.foods[0].portion).toBe(40);
    });
  });

  /* ========================= 4. CUSTOM FOODS ========================== */

  describe('custom foods', () => {
    it('creates with the donor defaults and a DERIVED serving', async () => {
      const food = await createFood({ name: 'Oats' });
      expect(food.unit).toBe('g');
      expect(food.portion).toBe(100);
      expect(food.calories).toBe(155.5);
      expect(food.use_count).toBe(0);
      expect(food.last_used_at).toBeNull();
      expect(food.is_favorite).toBe(false);
      expect(food.preferred_meal_types).toBe('[]');
      expect(food.source_type).toBe('manual');
      expect(food.deleted_at).toBeNull();
    });

    it('never lets a request set the P4 sharing columns', async () => {
      // `is_shared` / `share_code` are behind a privacy review; zod strips them
      // and the service hard-codes the safe value.
      const food = await createFood({ is_shared: true, share_code: 'HACKED12' });
      expect(food.is_shared).toBe(false);
      expect(food.share_code).toBeNull();
    });

    it('re-portions from the basis, never from the rounded serving', async () => {
      const food = await createFood();
      const seen: number[] = [];
      for (const portion of [7, 3, 250, 100]) {
        const res = await call('PUT', `/custom-foods/${food.id}`, {
          token: tokenA,
          body: { portion },
        });
        expect(res.status).toBe(200);
        const updated = (await json<{ food: FoodRow }>(res)).food;
        expect(updated.base_calories_per_100).toBe(155.5); // basis is untouched
        seen.push(updated.calories);
      }
      // Rescaling the ROUNDED serving each time would end at 155.67 here.
      expect(seen).toEqual([10.89, 4.67, 388.75, 155.5]);
    });

    it('patches a single field without dropping the rest', async () => {
      const food = await createFood({ name: 'Oats', brand_name: 'Quaker', barcode: '123' });
      const res = await call('PUT', `/custom-foods/${food.id}`, {
        token: tokenA,
        body: { is_favorite: true },
      });
      const updated = (await json<{ food: FoodRow }>(res)).food;
      expect(updated.is_favorite).toBe(true);
      expect(updated.name).toBe('Oats');
      expect(updated.brand_name).toBe('Quaker');
      expect(updated.barcode).toBe('123');
      expect(updated.calories).toBe(155.5);
    });

    it('404s an unknown id on update, delete and use', async () => {
      for (const [method, path, body] of [
        ['PUT', '/custom-foods/cf_nope', { portion: 10 }],
        ['DELETE', '/custom-foods/cf_nope'],
        ['POST', '/custom-foods/cf_nope/use', {}],
      ] as Array<[string, string, unknown]>) {
        const res = await call(method, path, { token: tokenA, body });
        expect(res.status).toBe(404);
      }
    });

    it('soft-deletes: gone from the list, still a tombstone in the table', async () => {
      const food = await createFood();
      const res = await call('DELETE', `/custom-foods/${food.id}`, { token: tokenA });
      expect(res.status).toBe(200);
      expect(await json<{ deleted: boolean }>(res)).toEqual({ deleted: true });

      expect(
        (await json<{ foods: unknown[] }>(await call('GET', '/custom-foods', { token: tokenA })))
          .foods
      ).toEqual([]);
      // A second delete is a 404, not a second tombstone.
      expect((await call('DELETE', `/custom-foods/${food.id}`, { token: tokenA })).status).toBe(404);

      const row = await testEnv.DB.prepare(
        'SELECT id, deleted_at FROM custom_foods WHERE id = ?'
      )
        .bind(food.id)
        .first<{ id: string; deleted_at: string | null }>();
      expect(row?.id).toBe(food.id);
      expect(row?.deleted_at).not.toBeNull();
    });

    it('filters by favourites, most-used and free text', async () => {
      await createFood({ name: 'Zucchini' });
      const banana = await createFood({ name: 'Banana' });
      await createFood({ name: 'Apple', is_favorite: true });
      await call('POST', `/custom-foods/${banana.id}/use`, { token: tokenA, body: {} });

      const all = await json<{ foods: FoodRow[] }>(
        await call('GET', '/custom-foods', { token: tokenA })
      );
      expect(all.foods.map((f) => f.name)).toEqual(['Apple', 'Banana', 'Zucchini']);

      const favourites = await json<{ foods: FoodRow[] }>(
        await call('GET', '/custom-foods?favorites=true', { token: tokenA })
      );
      expect(favourites.foods.map((f) => f.name)).toEqual(['Apple']);

      const mostUsed = await json<{ foods: FoodRow[] }>(
        await call('GET', '/custom-foods?most_used=true', { token: tokenA })
      );
      expect(mostUsed.foods[0].name).toBe('Banana');

      const searched = await json<{ foods: FoodRow[] }>(
        await call('GET', '/custom-foods?search=zucc', { token: tokenA })
      );
      expect(searched.foods.map((f) => f.name)).toEqual(['Zucchini']);
    });

    describe('validation', () => {
      it('400s an empty or missing name', async () => {
        for (const name of ['', '   ', undefined]) {
          const res = await call('POST', '/custom-foods', {
            token: tokenA,
            body: { name, portion: 100, ...OATS_BASIS },
          });
          expect(res.status).toBe(400);
        }
      });

      it('400s negative macros and negative energy', async () => {
        const bodies = [
          { base_calories_per_100: -1 },
          { base_proteins_per_100: -0.5 },
          { calories: -10, base_calories_per_100: undefined },
          { portion: -100 },
          { portion: 0 },
        ];
        for (const over of bodies) {
          const res = await call('POST', '/custom-foods', {
            token: tokenA,
            body: { name: 'Bad', portion: 100, ...OATS_BASIS, ...over },
          });
          expect(res.status).toBe(400);
        }
      });

      it('400s absurd calories — declared OR implied by the portion', async () => {
        const declared = await call('POST', '/custom-foods', {
          token: tokenA,
          body: { name: 'Plutonium', portion: 100, base_calories_per_100: 5000 },
        });
        expect(declared.status).toBe(400);

        // 700 kcal in 10g is 7000 kcal/100g. The donor only ever checked the
        // number the client happened to send, never the implied basis.
        const implied = await call('POST', '/custom-foods', {
          token: tokenA,
          body: { name: 'Implied', portion: 10, calories: 700 },
        });
        expect(implied.status).toBe(400);
        expect((await json<{ error: { code: string } }>(implied)).error.code).toBe(
          'invalid_nutrition'
        );

        expect(
          (await json<{ foods: unknown[] }>(await call('GET', '/custom-foods', { token: tokenA })))
            .foods
        ).toEqual([]);
      });

      it('400s a macro total that is physically impossible', async () => {
        const res = await call('POST', '/custom-foods', {
          token: tokenA,
          body: {
            name: 'Impossible',
            portion: 100,
            base_calories_per_100: 400,
            base_proteins_per_100: 60,
            base_carbs_per_100: 60,
            base_fats_per_100: 60,
          },
        });
        expect(res.status).toBe(400);
      });

      it('400s a create with neither a serving nor a basis', async () => {
        const res = await call('POST', '/custom-foods', {
          token: tokenA,
          body: { name: 'Nothing', portion: 100 },
        });
        expect(res.status).toBe(400);
      });

      it('400s an out-of-contract source type or meal type', async () => {
        expect(
          (
            await call('POST', '/custom-foods', {
              token: tokenA,
              body: { name: 'Odd', portion: 100, ...OATS_BASIS, source_type: 'telepathy' },
            })
          ).status
        ).toBe(400);
        expect(
          (
            await call('POST', '/custom-foods', {
              token: tokenA,
              body: { name: 'Odd', portion: 100, ...OATS_BASIS, preferred_meal_types: ['brunch'] },
            })
          ).status
        ).toBe(400);
      });

      it('400s a patch that would corrupt an existing basis', async () => {
        const food = await createFood();
        const res = await call('PUT', `/custom-foods/${food.id}`, {
          token: tokenA,
          body: { base_calories_per_100: 9999 },
        });
        expect(res.status).toBe(400);
        // The stored row is untouched.
        const foods = await json<{ foods: FoodRow[] }>(
          await call('GET', '/custom-foods', { token: tokenA })
        );
        expect(foods.foods[0].base_calories_per_100).toBe(155.5);
      });

      it('400s a patch the SERVICE refuses, not only one zod catches first', async () => {
        // The case above is stopped by the schema bound (max 1000 per 100), so
        // it never reaches the handler's own not_found-vs-invalid split. These
        // figures are each inside their column bound and only the CROSS-FIELD
        // rule (110 g of macros per 100 g) rejects them — which only the service
        // knows, and which must answer 400, not the 404 an unknown id gets.
        const food = await createFood();
        const res = await call('PUT', `/custom-foods/${food.id}`, {
          token: tokenA,
          body: { base_proteins_per_100: 60, base_carbs_per_100: 60, base_fats_per_100: 20 },
        });
        expect(res.status).toBe(400);
        expect((await json<{ error: { code: string } }>(res)).error.code).toBe(
          'invalid_nutrition'
        );

        const foods = await json<{ foods: FoodRow[] }>(
          await call('GET', '/custom-foods', { token: tokenA })
        );
        expect(foods.foods[0].base_proteins_per_100).toBe(13.2);
      });
    });

    it('honours ?limit on the library list', async () => {
      // The library is the screen's first paint; an unbounded list on a large
      // account is the difference between a fast tab and a stalled one.
      await createFood({ name: 'Apple' });
      await createFood({ name: 'Milk' });
      await createFood({ name: 'Rice' });
      const limited = await json<{ foods: FoodRow[] }>(
        await call('GET', '/custom-foods?limit=2', { token: tokenA })
      );
      expect(limited.foods.map((f) => f.name)).toEqual(['Apple', 'Milk']);
    });
  });

  /* =========================== 5. USE + HISTORY ======================= */

  describe('POST /custom-foods/:id/use', () => {
    it('bumps the counter, stamps the clock and writes the history row', async () => {
      const food = await createFood();
      const res = await call('POST', `/custom-foods/${food.id}/use`, {
        token: tokenA,
        body: { used_at: EVENING },
      });
      expect(res.status).toBe(200);
      const body = await json<{
        food: FoodRow;
        logged: { calories: number };
        usage: { meal_type: string; time_of_day: string; food_name: string };
      }>(res);

      expect(body.food.use_count).toBe(1);
      expect(body.food.last_used_at).toBe(EVENING);
      expect(body.usage.time_of_day).toBe('evening');
      expect(body.usage.meal_type).toBe('dinner'); // inferred from the bucket
      expect(body.usage.food_name).toBe('Oats');

      const stored = await call('GET', '/custom-foods', { token: tokenA });
      expect((await json<{ foods: FoodRow[] }>(stored)).foods[0].use_count).toBe(1);
    });

    it('derives the logged portion from the basis, not from the stored serving', async () => {
      const food = await createFood();
      const res = await call('POST', `/custom-foods/${food.id}/use`, {
        token: tokenA,
        body: { portion: 37, meal_type: 'snack' },
      });
      const body = await json<{ logged: Record<string, number> }>(res);
      expect(body.logged).toEqual({
        calories: 57.54, // 155.5 * 0.37
        proteins: 4.88,
        carbohydrates: 25.05,
        fats: 2.55,
      });
    });

    it('accumulates across uses', async () => {
      const food = await createFood();
      for (const at of [MORNING, MORNING_2, EVENING]) {
        await call('POST', `/custom-foods/${food.id}/use`, { token: tokenA, body: { used_at: at } });
      }
      const foods = await json<{ foods: FoodRow[] }>(
        await call('GET', '/custom-foods', { token: tokenA })
      );
      expect(foods.foods[0].use_count).toBe(3);

      const rows = await testEnv.DB.prepare(
        'SELECT time_of_day, COUNT(*) as n FROM food_usage_history WHERE user_id = ? GROUP BY time_of_day ORDER BY time_of_day'
      )
        .bind(UID_A)
        .all<{ time_of_day: string; n: number }>();
      expect(rows.results).toEqual([
        { time_of_day: 'evening', n: 1 },
        { time_of_day: 'morning', n: 2 },
      ]);
    });

    it('400s a malformed timestamp or a non-positive portion', async () => {
      const food = await createFood();
      for (const body of [{ used_at: 'yesterday' }, { portion: 0 }, { meal_type: 'brunch' }]) {
        const res = await call('POST', `/custom-foods/${food.id}/use`, { token: tokenA, body });
        expect(res.status).toBe(400);
      }
    });

    it('refuses to log a use against a DELETED food', async () => {
      const food = await createFood();
      await call('DELETE', `/custom-foods/${food.id}`, { token: tokenA });
      expect(
        (await call('POST', `/custom-foods/${food.id}/use`, { token: tokenA, body: {} })).status
      ).toBe(404);
    });
  });

  /* ============================ 6. SEARCH ============================= */

  describe('GET /foods/search', () => {
    it('searches the user own library by name, brand and barcode', async () => {
      await createFood({ name: 'Greek yoghurt', brand_name: 'Fage', barcode: '5000112637922' });
      await createFood({ name: 'Oat milk' });

      const byName = await json<{ results: FoodRow[] }>(
        await call('GET', '/foods/search?query=yogh', { token: tokenA })
      );
      expect(byName.results.map((r) => r.name)).toEqual(['Greek yoghurt']);

      const byBrand = await json<{ results: FoodRow[] }>(
        await call('GET', '/foods/search?query=fage', { token: tokenA })
      );
      expect(byBrand.results.map((r) => r.name)).toEqual(['Greek yoghurt']);

      const byBarcode = await json<{ results: FoodRow[] }>(
        await call('GET', '/foods/search?query=5000112637922', { token: tokenA })
      );
      expect(byBarcode.results.map((r) => r.name)).toEqual(['Greek yoghurt']);
    });

    it('ranks by relevance and echoes the query', async () => {
      await createFood({ name: 'Oat milk' });
      await createFood({ name: 'Milk' });
      const body = await json<{ results: Array<FoodRow & { relevance_score: number }>; query: string }>(
        await call('GET', '/foods/search?query=milk', { token: tokenA })
      );
      expect(body.query).toBe('milk');
      expect(body.results.map((r) => r.name)).toEqual(['Milk', 'Oat milk']);
      expect(body.results[0].relevance_score).toBeGreaterThan(body.results[1].relevance_score);
    });

    it('honours the limit and returns [] for a miss', async () => {
      await createFood({ name: 'Milk' });
      await createFood({ name: 'Oat milk' });
      const limited = await json<{ results: unknown[] }>(
        await call('GET', '/foods/search?query=milk&limit=1', { token: tokenA })
      );
      expect(limited.results).toHaveLength(1);
      const missed = await json<{ results: unknown[] }>(
        await call('GET', '/foods/search?query=zzzz', { token: tokenA })
      );
      expect(missed.results).toEqual([]);
    });

    it('400s a query shorter than 2 characters (donor rule)', async () => {
      for (const q of ['', 'a', '%20']) {
        const res = await call('GET', `/foods/search?query=${q}`, { token: tokenA });
        expect(res.status).toBe(400);
      }
      expect((await call('GET', '/foods/search', { token: tokenA })).status).toBe(400);
    });

    it('excludes soft-deleted foods', async () => {
      const food = await createFood({ name: 'Milk' });
      await call('DELETE', `/custom-foods/${food.id}`, { token: tokenA });
      const body = await json<{ results: unknown[] }>(
        await call('GET', '/foods/search?query=milk', { token: tokenA })
      );
      expect(body.results).toEqual([]);
    });
  });

  /* ========================== 7. SUGGESTIONS ========================== */

  describe('GET /foods/suggestions', () => {
    it('reports the bucket and infers the meal slot from the clock', async () => {
      const body = await json<{ time_of_day: string; meal_type: string; suggestions: unknown[] }>(
        await call(`GET`, `/foods/suggestions?at=${EVENING}`, { token: tokenA })
      );
      expect(body.time_of_day).toBe('evening');
      expect(body.meal_type).toBe('dinner');
      expect(body.suggestions).toEqual([]); // cold account
    });

    it('honours an explicit meal_type over the inferred one', async () => {
      const body = await json<{ time_of_day: string; meal_type: string }>(
        await call('GET', `/foods/suggestions?at=${EVENING}&meal_type=snack`, { token: tokenA })
      );
      expect(body.time_of_day).toBe('evening');
      expect(body.meal_type).toBe('snack');
    });

    it('surfaces what you usually eat at this time of day', async () => {
      const porridge = await createFood({ name: 'Porridge' });
      const crisps = await createFood({ name: 'Crisps' });
      for (const at of [MORNING, MORNING_2]) {
        await call('POST', `/custom-foods/${porridge.id}/use`, { token: tokenA, body: { used_at: at } });
      }
      await call('POST', `/custom-foods/${crisps.id}/use`, {
        token: tokenA,
        body: { used_at: '2026-06-01T22:00:00.000Z', meal_type: 'snack' },
      });

      const body = await json<{
        suggestions: Array<{ food: FoodRow; score: number; reasons: string[] }>;
      }>(await call('GET', '/foods/suggestions?at=2026-06-03T07:45:00.000Z', { token: tokenA }));

      expect(body.suggestions[0].food.name).toBe('Porridge');
      expect(body.suggestions[0].reasons).toContain('time_based_match');
      expect(body.suggestions[0].score).toBeGreaterThan(0);
      const crispsEntry = body.suggestions.find((s) => s.food.name === 'Crisps');
      expect(crispsEntry?.reasons ?? []).not.toContain('time_based_match');
    });

    it('never suggests a food that was never eaten and is not a favourite', async () => {
      await createFood({ name: 'Untouched' });
      const body = await json<{ suggestions: unknown[] }>(
        await call('GET', `/foods/suggestions?at=${MORNING}`, { token: tokenA })
      );
      expect(body.suggestions).toEqual([]);
    });

    it('honours the limit and 400s an invalid meal_type', async () => {
      await createFood({ name: 'A', is_favorite: true });
      await createFood({ name: 'B', is_favorite: true });
      const body = await json<{ suggestions: unknown[] }>(
        await call('GET', `/foods/suggestions?at=${MORNING}&limit=1`, { token: tokenA })
      );
      expect(body.suggestions).toHaveLength(1);
      expect(
        (await call('GET', '/foods/suggestions?meal_type=brunch', { token: tokenA })).status
      ).toBe(400);
    });
  });

  /* ============================ 8. RECIPES ============================ */

  describe('recipes', () => {
    it('computes the totals server-side and ignores any the client sends', async () => {
      const recipe = await createRecipe({
        total_calories: 99999,
        total_proteins: 99999,
      });
      expect(recipe.total_calories).toBe(229.4); // 155.5*0.8 + 42*2.5
      expect(recipe.total_proteins).toBe(19.06);
      expect(recipe.servings).toBe(2);

      const stored = JSON.parse(recipe.ingredients) as Array<Record<string, number | string>>;
      expect(stored).toHaveLength(2);
      // Each stored ingredient keeps the basis it was costed against.
      expect(stored[0].calories).toBe(124.4);
      expect(stored[0].base_calories_per_100).toBe(155.5);
    });

    it('costs an ingredient from the caller own food when only an id is sent', async () => {
      const oats = await createFood({ name: 'Oats' });
      const res = await call('POST', '/recipes', {
        token: tokenA,
        body: {
          name: 'From library',
          servings: 1,
          ingredients: [{ name: 'Oats', quantity: 200, food_id: oats.id }],
        },
      });
      expect(res.status).toBe(201);
      expect((await json<{ recipe: RecipeRowJson }>(res)).recipe.total_calories).toBe(311);
    });

    it('recomputes the totals on every edit', async () => {
      const recipe = await createRecipe();
      const res = await call('PUT', `/recipes/${recipe.id}`, {
        token: tokenA,
        body: { ingredients: [{ name: 'Oats', quantity: 40, ...OATS_BASIS }] },
      });
      expect(res.status).toBe(200);
      expect((await json<{ recipe: RecipeRowJson }>(res)).recipe.total_calories).toBe(62.2);
    });

    it('soft-deletes: gone from the list, still a tombstone in the table', async () => {
      const recipe = await createRecipe();
      expect((await call('DELETE', `/recipes/${recipe.id}`, { token: tokenA })).status).toBe(200);
      expect(
        (await json<{ recipes: unknown[] }>(await call('GET', '/recipes', { token: tokenA }))).recipes
      ).toEqual([]);
      expect((await call('DELETE', `/recipes/${recipe.id}`, { token: tokenA })).status).toBe(404);
      const row = await testEnv.DB.prepare('SELECT deleted_at FROM recipes WHERE id = ?')
        .bind(recipe.id)
        .first<{ deleted_at: string | null }>();
      expect(row?.deleted_at).not.toBeNull();
    });

    it('filters by favourite, category and free text', async () => {
      await createRecipe({ name: 'Porridge', category: 'breakfast', is_favorite: true });
      await createRecipe({ name: 'Chilli', category: 'dinner', description: 'beans and rice' });
      const favourites = await json<{ recipes: RecipeRowJson[] }>(
        await call('GET', '/recipes?favorites=true', { token: tokenA })
      );
      expect(favourites.recipes.map((r) => r.name)).toEqual(['Porridge']);
      const byCategory = await json<{ recipes: RecipeRowJson[] }>(
        await call('GET', '/recipes?category=dinner', { token: tokenA })
      );
      expect(byCategory.recipes.map((r) => r.name)).toEqual(['Chilli']);
      const byText = await json<{ recipes: RecipeRowJson[] }>(
        await call('GET', '/recipes?search=beans', { token: tokenA })
      );
      expect(byText.recipes.map((r) => r.name)).toEqual(['Chilli']);
    });

    it('404s an unknown id on update, delete and scale', async () => {
      for (const [method, path, body] of [
        ['PUT', '/recipes/rcp_nope', { name: 'x' }],
        ['DELETE', '/recipes/rcp_nope'],
        ['POST', '/recipes/rcp_nope/scale', { servings: 2 }],
      ] as Array<[string, string, unknown]>) {
        expect((await call(method, path, { token: tokenA, body })).status).toBe(404);
      }
    });

    describe('validation', () => {
      it('400s servings below 1 or non-integer', async () => {
        for (const servings of [0, -2, 1.5]) {
          const res = await call('POST', '/recipes', {
            token: tokenA,
            body: {
              name: 'Bad',
              servings,
              ingredients: [{ name: 'Oats', quantity: 80, ...OATS_BASIS }],
            },
          });
          expect(res.status).toBe(400);
        }
      });

      it('400s an empty name or an empty ingredient list', async () => {
        expect(
          (
            await call('POST', '/recipes', {
              token: tokenA,
              body: { name: '  ', ingredients: [{ name: 'Oats', quantity: 80, ...OATS_BASIS }] },
            })
          ).status
        ).toBe(400);
        expect(
          (await call('POST', '/recipes', { token: tokenA, body: { name: 'Empty', ingredients: [] } }))
            .status
        ).toBe(400);
      });

      it('400s an ingredient with a non-positive quantity, a bad basis or no basis', async () => {
        const bad = [
          [{ name: 'Oats', quantity: 0, ...OATS_BASIS }],
          [{ name: 'Oats', quantity: -5, ...OATS_BASIS }],
          [{ name: 'Oats', quantity: 80, base_calories_per_100: -1 }],
          [{ name: 'Oats', quantity: 80, base_calories_per_100: 4000 }],
          [{ name: 'Oats', quantity: 80 }],
        ];
        for (const ingredients of bad) {
          const res = await call('POST', '/recipes', {
            token: tokenA,
            body: { name: 'Bad', ingredients },
          });
          expect(res.status).toBe(400);
        }
        expect(
          (await json<{ recipes: unknown[] }>(await call('GET', '/recipes', { token: tokenA })))
            .recipes
        ).toEqual([]);
      });

      it('400s a scale request with a bad serving count', async () => {
        const recipe = await createRecipe();
        for (const servings of [0, -1, 2.5, 'four']) {
          const res = await call('POST', `/recipes/${recipe.id}/scale`, {
            token: tokenA,
            body: { servings },
          });
          expect(res.status).toBe(400);
        }
      });
    });

    describe('POST /recipes/:id/scale', () => {
      it('returns per-serving and scaled batch figures', async () => {
        const recipe = await createRecipe(); // 229.4 kcal over 2 servings
        const res = await call('POST', `/recipes/${recipe.id}/scale`, {
          token: tokenA,
          body: { servings: 6 },
        });
        expect(res.status).toBe(200);
        const { scaled } = await json<{
          scaled: {
            servings: number;
            target_servings: number;
            per_serving: { calories: number };
            totals: { calories: number };
            ingredients: Array<{ name: string; quantity: number; calories: number }>;
          };
        }>(res);

        expect(scaled.servings).toBe(2);
        expect(scaled.target_servings).toBe(6);
        expect(scaled.per_serving.calories).toBe(114.7);
        expect(scaled.totals.calories).toBe(688.2);
        expect(scaled.ingredients[0].quantity).toBe(240); // 80g * 3
        expect(scaled.ingredients[0].calories).toBe(373.2);
      });

      it('does not write — the stored recipe stays the one-batch definition', async () => {
        const recipe = await createRecipe();
        await call('POST', `/recipes/${recipe.id}/scale`, { token: tokenA, body: { servings: 6 } });
        await call('POST', `/recipes/${recipe.id}/scale`, { token: tokenA, body: { servings: 6 } });
        const list = await json<{ recipes: RecipeRowJson[] }>(
          await call('GET', '/recipes', { token: tokenA })
        );
        expect(list.recipes[0].total_calories).toBe(229.4);
        expect(list.recipes[0].servings).toBe(2);
      });
    });

    it('separates "not yours" (404) from "will not store that" (400) on an edit', async () => {
      // Two very different facts behind the same PUT. A 404 for a bad
      // ingredient would send the client hunting for a recipe that is right
      // there; a 400 for someone else's id would confirm the id exists.
      const recipe = await createRecipe();

      const notMine = await call('PUT', `/recipes/${recipe.id}`, {
        token: tokenB,
        body: { name: 'Stolen' },
      });
      expect(notMine.status).toBe(404);

      const badIngredient = await call('PUT', `/recipes/${recipe.id}`, {
        token: tokenA,
        body: {
          name: 'Renamed',
          ingredients: [{ name: 'Mystery', quantity: 50, food_id: 'cf_does_not_exist' }],
        },
      });
      expect(badIngredient.status).toBe(400);
      expect((await json<{ error: { code: string } }>(badIngredient)).error.code).not.toBe(
        'not_found'
      );

      // Neither attempt landed — the name is still the one it was created with.
      const list = await json<{ recipes: RecipeRowJson[] }>(
        await call('GET', '/recipes', { token: tokenA })
      );
      expect(list.recipes[0].name).toBe('Porridge');
    });

    it('honours ?limit on the recipe list', async () => {
      await createRecipe({ name: 'Alpha' });
      await createRecipe({ name: 'Beta' });
      await createRecipe({ name: 'Gamma' });
      const limited = await json<{ recipes: RecipeRowJson[] }>(
        await call('GET', '/recipes?limit=2', { token: tokenA })
      );
      expect(limited.recipes.map((r) => r.name)).toEqual(['Alpha', 'Beta']);
    });
  });
});
