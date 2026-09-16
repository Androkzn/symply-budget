/**
 * The EXTERNAL food-database half of `src/routes/health-food.ts` (parity P3):
 * `GET /foods/provider`, the provider top-up on `GET /foods/search`, and
 * `POST /foods/import`.
 *
 * It lives beside health-food.test.ts rather than inside it for one concrete
 * reason: these specs need `FATSECRET_*` on the env AND a stubbed
 * `globalThis.fetch`, and the sibling file's "no route 5xxs on a cold account"
 * sweep would otherwise read `/foods/import`'s honest 503-when-unconfigured as
 * a defect. So the gate, auth and user-scoping sweeps for the import path are
 * repeated here, against an env where the route can actually run.
 *
 * THE REAL FATSECRET API IS NEVER CALLED. Every outbound request is stubbed and
 * recorded; the mapping itself is covered in
 * services/__tests__/health-food-provider.test.ts.
 *
 * What the specs are weighted toward:
 *
 *   - the DEVICE never sees a credential, and the SEARCH never fails because
 *     the provider did. A missing key, a rate limit and an outage each leave
 *     `results` answering from the library with a status word beside it;
 *   - an import is IDEMPOTENT per user, and the stored serving is DERIVED from
 *     the basis rather than copied from the provider;
 *   - an imported row is a normal `custom_foods` row afterwards — user-scoped,
 *     soft-deletable, and re-importable once deleted.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetFoodProviderTokenCache,
  FOOD_PROVIDER_KV_PREFIX,
} from '../../services/health-food-provider';
import type { Env } from '../../types';
import healthFoodRoutes from '../health-food';

import {
  createHealthFoodTables,
  createHealthTables,
  resetHealthFoodTables,
  resetHealthTables,
  seedHealthUsers,
} from './health-test-helpers';

const testEnv = env as unknown as Env;

const FATSECRET = {
  FATSECRET_CLIENT_ID: 'test-client-id',
  FATSECRET_CLIENT_SECRET: 'test-client-secret',
};

/** Health, with the provider configured — the shipping shape of the feature. */
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health', ...FATSECRET } as Env;
/** Health with NO credential — a deploy where the feature simply is not on. */
const UNCONFIGURED_ENV = {
  ...testEnv,
  APP_BRAND: 'symply-health',
  FATSECRET_CLIENT_ID: undefined,
  FATSECRET_CLIENT_SECRET: undefined,
} as Env;
const HOUSE_ENV = { ...testEnv, APP_BRAND: 'symply-house', ...FATSECRET } as Env;
const BUDGET_ENV = { ...testEnv, APP_BRAND: 'symply-budget', ...FATSECRET } as Env;
const KAIZEN_ENV = { ...testEnv, APP_BRAND: 'symply-kaizen', ...FATSECRET } as Env;

const UID_A = 'u_food_ext_alice';
const UID_B = 'u_food_ext_bob';

/* ------------------------- provider fixtures --------------------------- */

const YOGURT_SERVING_CONTAINER = {
  serving_id: '32729',
  serving_description: '1 container (170 g)',
  metric_serving_amount: '170.000',
  metric_serving_unit: 'g',
  calories: '100',
  protein: '18.000',
  carbohydrate: '6.000',
  fat: '0.000',
};

const YOGURT_SERVING_100G = {
  serving_id: '32730',
  serving_description: '100 g',
  metric_serving_amount: '100.000',
  metric_serving_unit: 'g',
  calories: '59',
  protein: '10.600',
  carbohydrate: '3.500',
  fat: '0.000',
};

const YOGURT = {
  food_id: '33691',
  food_name: 'Greek Yogurt',
  brand_name: 'Fage',
  servings: { serving: [YOGURT_SERVING_CONTAINER, YOGURT_SERVING_100G] },
};

const TOKEN_OK = { access_token: 'tok_abc123', expires_in: 86400 };

const realFetch = globalThis.fetch;
let fetchCalls: string[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Stub every outbound call. `apiResponse` decides what the FatSecret API
 * answers; the token grant always succeeds unless overridden.
 */
function stubProvider(apiResponse: () => Response): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    fetchCalls.push(url);
    if (url.startsWith('https://oauth.fatsecret.com/')) return jsonResponse(TOKEN_OK);
    return apiResponse();
  }) as unknown as typeof fetch;
}

const searchHits = () => stubProvider(() => jsonResponse({ foods_search: { results: { food: [YOGURT] } } }));
const noHits = () => stubProvider(() => jsonResponse({ foods_search: { results: {} } }));
const oneFood = () => stubProvider(() => jsonResponse({ food: YOGURT }));
const rateLimited = () => stubProvider(() => jsonResponse({ error: 'slow down' }, 429));
const outage = () => stubProvider(() => new Response('nope', { status: 502 }));

const apiCalls = () => fetchCalls.filter((u) => u.startsWith('https://platform.fatsecret.com/'));

/**
 * Drop every key the provider owns in CONFIG_KV.
 *
 * The cache is the point of the feature — a repeated query never reaches the
 * provider — so without this each spec would inherit its predecessor's answers
 * and a spec that asserts an OUTAGE would quietly pass on a cached success.
 */
async function clearProviderCache(): Promise<void> {
  const listed = await testEnv.CONFIG_KV.list({ prefix: FOOD_PROVIDER_KV_PREFIX });
  await Promise.all(listed.keys.map((key) => testEnv.CONFIG_KV.delete(key.name)));
}

/* --------------------------- HTTP harness ------------------------------ */

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
    { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) },
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
  base_calories_per_100: number;
  base_proteins_per_100: number;
  source_type: string;
  external_source: string | null;
  external_id: string | null;
  is_favorite: boolean;
  preferred_meal_types: string;
  deleted_at: string | null;
}

interface SearchBody {
  results: Array<{ id: string; name: string }>;
  external: Array<{
    id: string;
    provider: string;
    provider_food_id: string;
    name: string;
    portion: number;
    servings: Array<{ serving_id: string }>;
  }>;
  query: string;
  sources: string[];
  provider: { id: string; configured: boolean; status: string };
}

/** The two paths this file owns — the gate/auth sweeps must cover both. */
const EXTERNAL_ROUTES: ReadonlyArray<readonly [string, string, unknown?]> = [
  ['GET', '/foods/provider'],
  ['POST', '/foods/import', { provider_food_id: '33691' }],
];

const GATE_MESSAGE = 'Not found';

describe('health food routes — external database', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createHealthFoodTables(testEnv.DB);
    await resetHealthFoodTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
    tokenA = await mintToken(UID_A);
    tokenB = await mintToken(UID_B);

    fetchCalls = [];
    __resetFoodProviderTokenCache();
    await clearProviderCache();
    searchHits();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  /* ------------------------- gate + auth --------------------------- */

  describe('brand gate and auth', () => {
    it.each([
      ['symply-house', HOUSE_ENV],
      ['symply-budget', BUDGET_ENV],
      ['symply-kaizen', KAIZEN_ENV],
    ])('404s every external food route on %s', async (_brand, brandEnv) => {
      for (const [method, path, body] of EXTERNAL_ROUTES) {
        const res = await call(method, path, { body, brandEnv });
        expect(res.status).toBe(404);
        const parsed = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        expect(parsed.error?.message ?? GATE_MESSAGE).toBe(GATE_MESSAGE);
      }
      // The gate fires before anything else: a wrong-brand Worker must never
      // reach out to a food provider on a user's behalf.
      expect(fetchCalls).toEqual([]);
    });

    it('the gate fires BEFORE auth — a tokenless wrong-brand call 404s, never 401s', async () => {
      for (const [method, path, body] of EXTERNAL_ROUTES) {
        const res = await call(method, path, { body, token: null, brandEnv: BUDGET_ENV });
        expect(res.status).toBe(404);
      }
    });

    it('401s every external food route without a bearer token', async () => {
      for (const [method, path, body] of EXTERNAL_ROUTES) {
        const res = await call(method, path, { body, token: null });
        expect(res.status).toBe(401);
      }
      // …and no provider call is made on an unauthenticated request.
      expect(fetchCalls).toEqual([]);
    });
  });

  /* ------------------------ capability probe ------------------------ */

  describe('GET /foods/provider', () => {
    it('reports the provider as configured, without calling it', async () => {
      const body = await json<{ provider: { id: string; configured: boolean; status: string } }>(
        await call('GET', '/foods/provider')
      );
      expect(body.provider).toEqual({ id: 'fatsecret', configured: true, status: 'ok' });
      expect(fetchCalls).toEqual([]);
    });

    it('reports `not_configured` on a deploy with no credential', async () => {
      const body = await json<{ provider: { configured: boolean; status: string } }>(
        await call('GET', '/foods/provider', { brandEnv: UNCONFIGURED_ENV })
      );
      expect(body.provider).toEqual({ id: 'fatsecret', configured: false, status: 'not_configured' });
    });
  });

  /* --------------------------- search ------------------------------- */

  describe('GET /foods/search', () => {
    it('tops the library up from the provider and keeps the halves apart', async () => {
      await call('POST', '/custom-foods', {
        body: { name: 'My oats', portion: 100, base_calories_per_100: 380 },
      });

      const body = await json<SearchBody>(await call('GET', '/foods/search?query=yogurt'));

      expect(body.results).toEqual([]);
      expect(body.external).toHaveLength(1);
      expect(body.external[0]).toMatchObject({
        id: 'fatsecret:33691',
        provider: 'fatsecret',
        provider_food_id: '33691',
        name: 'Greek Yogurt',
        // The metric serving is preferred over `serving[0]`-by-luck.
        portion: 170,
      });
      expect(body.external[0].servings.map((s) => s.serving_id)).toEqual(['32729', '32730']);
      expect(body.sources).toEqual(['library', 'fatsecret']);
      expect(body.provider).toEqual({ id: 'fatsecret', configured: true, status: 'ok' });
    });

    it('never offers a food the user already owns (donor dedupe)', async () => {
      await call('POST', '/custom-foods', {
        body: {
          name: 'Greek Yogurt',
          brand_name: 'Fage',
          portion: 170,
          base_calories_per_100: 58.82,
        },
      });

      const body = await json<SearchBody>(await call('GET', '/foods/search?query=yogurt'));

      expect(body.results.map((r) => r.name)).toEqual(['Greek Yogurt']);
      // Same name AND brand: offering it again as something to "import" would
      // invite a second copy of a food they already have.
      expect(body.external).toEqual([]);
    });

    it('`include_external=false` skips the provider entirely', async () => {
      const body = await json<SearchBody>(
        await call('GET', '/foods/search?query=yogurt&include_external=false')
      );

      expect(body.external).toEqual([]);
      expect(body.sources).toEqual(['library']);
      expect(body.provider.status).toBe('skipped');
      expect(apiCalls()).toEqual([]);
    });

    it('a MISSING credential does not fail the search — the library still answers', async () => {
      await call('POST', '/custom-foods', {
        token: tokenA,
        body: { name: 'Yogurt drink', portion: 100, base_calories_per_100: 60 },
        brandEnv: UNCONFIGURED_ENV,
      });

      const res = await call('GET', '/foods/search?query=yogurt', { brandEnv: UNCONFIGURED_ENV });
      const body = await json<SearchBody>(res);

      expect(res.status).toBe(200);
      expect(body.results.map((r) => r.name)).toEqual(['Yogurt drink']);
      expect(body.external).toEqual([]);
      expect(body.provider).toEqual({
        id: 'fatsecret',
        configured: false,
        status: 'not_configured',
      });
      // A deploy with no key must be silent, not noisy.
      expect(fetchCalls).toEqual([]);
    });

    it('a RATE-LIMITED provider is a 200 with a status, never a 429 for the whole search', async () => {
      rateLimited();
      const res = await call('GET', '/foods/search?query=yogurt');
      const body = await json<SearchBody>(res);

      expect(res.status).toBe(200);
      expect(body.provider.status).toBe('rate_limited');
      expect(body.external).toEqual([]);
      expect(body.sources).toEqual(['library']);
    });

    it('an OUTAGE is a 200 with a status, and leaks no provider text', async () => {
      outage();
      const res = await call('GET', '/foods/search?query=yogurt');
      const raw = await res.text();

      expect(res.status).toBe(200);
      expect(JSON.parse(raw).provider.status).toBe('unavailable');
      // The provider's own body ("nope"), its status code and any exception
      // text must not ride out to the device.
      expect(raw).not.toContain('nope');
      expect(raw).not.toContain('502');
      expect(raw).not.toContain('fatsecret.com');
    });

    it('never sends a credential to the device', async () => {
      const raw = await (await call('GET', '/foods/search?query=yogurt')).text();
      expect(raw).not.toContain('test-client-secret');
      expect(raw).not.toContain('test-client-id');
      expect(raw).not.toContain('tok_abc123');
    });

    it('an empty provider answer is still a 200 with an empty list', async () => {
      noHits();
      const body = await json<SearchBody>(await call('GET', '/foods/search?query=zzzq'));
      expect(body.external).toEqual([]);
      expect(body.provider.status).toBe('ok');
    });
  });

  /* --------------------------- import ------------------------------- */

  describe('POST /foods/import', () => {
    beforeEach(() => oneFood());

    it('turns a hit into a row the user owns, with a DERIVED serving', async () => {
      const res = await call('POST', '/foods/import', { body: { provider_food_id: '33691' } });
      expect(res.status).toBe(201);
      const { food, created } = await json<{ food: FoodRow; created: boolean }>(res);

      expect(created).toBe(true);
      expect(food).toMatchObject({
        name: 'Greek Yogurt',
        brand_name: 'Fage',
        portion: 170,
        unit: 'g',
        // The donor's own member for "came from somewhere else".
        source_type: 'imported',
        external_source: 'fatsecret',
        external_id: '33691',
        deleted_at: null,
      });
      // Rule 1: the serving is `basis × portion / 100`, not the provider's
      // already-rounded 100 kcal. 58.82 × 1.7 = 99.99.
      expect(food.base_calories_per_100).toBe(58.82);
      expect(food.calories).toBe(99.99);
      expect(food.base_proteins_per_100).toBe(10.59);

      // And it is a normal library row from here on.
      const list = await json<{ foods: FoodRow[] }>(await call('GET', '/custom-foods'));
      expect(list.foods.map((f) => f.id)).toEqual([food.id]);
    });

    it('honours the serving the user picked', async () => {
      const { food } = await json<{ food: FoodRow }>(
        await call('POST', '/foods/import', {
          body: { provider_food_id: '33691', serving_id: '32730' },
        })
      );
      expect(food.portion).toBe(100);
      expect(food.base_calories_per_100).toBe(59);
      expect(food.calories).toBe(59);
    });

    it('carries `is_favorite` and the meal slot the user was logging into', async () => {
      const { food } = await json<{ food: FoodRow }>(
        await call('POST', '/foods/import', {
          body: {
            provider_food_id: '33691',
            is_favorite: true,
            preferred_meal_types: ['breakfast'],
          },
        })
      );
      expect(food.is_favorite).toBe(true);
      expect(JSON.parse(food.preferred_meal_types)).toEqual(['breakfast']);
    });

    it('is idempotent: a second import returns the SAME row and overwrites nothing', async () => {
      const first = await json<{ food: FoodRow }>(
        await call('POST', '/foods/import', { body: { provider_food_id: '33691' } })
      );
      // The user renames it — their edit must survive a re-import.
      await call('PUT', `/custom-foods/${first.food.id}`, { body: { name: 'My yoghurt' } });

      const res = await call('POST', '/foods/import', { body: { provider_food_id: '33691' } });
      expect(res.status).toBe(200);
      const second = await json<{ food: FoodRow; created: boolean }>(res);

      expect(second.created).toBe(false);
      expect(second.food.id).toBe(first.food.id);
      expect(second.food.name).toBe('My yoghurt');

      const list = await json<{ foods: FoodRow[] }>(await call('GET', '/custom-foods'));
      expect(list.foods).toHaveLength(1);
    });

    it('two users import the same food into their own libraries', async () => {
      const a = await json<{ food: FoodRow }>(
        await call('POST', '/foods/import', { body: { provider_food_id: '33691' } })
      );
      const b = await json<{ food: FoodRow }>(
        await call('POST', '/foods/import', {
          token: tokenB,
          body: { provider_food_id: '33691' },
        })
      );

      // Same external id, two independent rows — the uniqueness is per USER.
      expect(a.food.id).not.toBe(b.food.id);
      const listA = await json<{ foods: FoodRow[] }>(await call('GET', '/custom-foods'));
      const listB = await json<{ foods: FoodRow[] }>(
        await call('GET', '/custom-foods', { token: tokenB })
      );
      expect(listA.foods).toHaveLength(1);
      expect(listB.foods).toHaveLength(1);
      expect(listA.foods[0].id).toBe(a.food.id);
    });

    it('re-importing after a DELETE makes a new row, not a resurrection', async () => {
      const first = await json<{ food: FoodRow }>(
        await call('POST', '/foods/import', { body: { provider_food_id: '33691' } })
      );
      expect((await call('DELETE', `/custom-foods/${first.food.id}`)).status).toBe(200);

      const res = await call('POST', '/foods/import', { body: { provider_food_id: '33691' } });
      expect(res.status).toBe(201);
      const second = await json<{ food: FoodRow; created: boolean }>(res);

      // The unique index is partial on `deleted_at IS NULL` precisely so that a
      // tombstone cannot block the user from adding the food back.
      expect(second.created).toBe(true);
      expect(second.food.id).not.toBe(first.food.id);
      const list = await json<{ foods: FoodRow[] }>(await call('GET', '/custom-foods'));
      expect(list.foods.map((f) => f.id)).toEqual([second.food.id]);
    });

    it('re-fetches the food itself — the body cannot smuggle macros in', async () => {
      const { food } = await json<{ food: FoodRow }>(
        await call('POST', '/foods/import', {
          body: {
            provider_food_id: '33691',
            name: 'Free Calories',
            calories: 1,
            base_calories_per_100: 1,
          },
        })
      );

      // Everything came from the provider lookup; the extra keys were stripped.
      expect(food.name).toBe('Greek Yogurt');
      expect(food.base_calories_per_100).toBe(58.82);
      expect(apiCalls().some((u) => u.includes('method=food.get.v4'))).toBe(true);
    });

    it('404s a food the provider does not have', async () => {
      stubProvider(() => jsonResponse({ food: null }));
      const res = await call('POST', '/foods/import', { body: { provider_food_id: '999999' } });
      expect(res.status).toBe(404);
      expect((await json<{ error: { code: string } }>(res)).error.code).toBe('not_found');
    });

    it('503s when the provider is not configured, and names that as the reason', async () => {
      const res = await call('POST', '/foods/import', {
        body: { provider_food_id: '33691' },
        brandEnv: UNCONFIGURED_ENV,
      });
      expect(res.status).toBe(503);
      const body = await json<{ error: { code: string }; provider: { configured: boolean } }>(res);
      expect(body.error.code).toBe('provider_not_configured');
      expect(body.provider.configured).toBe(false);
      expect(fetchCalls).toEqual([]);
    });

    it('429s a rate limit and 503s an outage — two different facts', async () => {
      rateLimited();
      const limited = await call('POST', '/foods/import', { body: { provider_food_id: '33691' } });
      expect(limited.status).toBe(429);
      expect((await json<{ error: { code: string } }>(limited)).error.code).toBe(
        'provider_rate_limited'
      );

      __resetFoodProviderTokenCache();
      await clearProviderCache();
      outage();
      const down = await call('POST', '/foods/import', { body: { provider_food_id: '33692' } });
      expect(down.status).toBe(503);
      expect((await json<{ error: { code: string } }>(down)).error.code).toBe(
        'provider_unavailable'
      );

      // Neither wrote anything.
      const list = await json<{ foods: FoodRow[] }>(await call('GET', '/custom-foods'));
      expect(list.foods).toEqual([]);
    });

    it('400s a body with no provider food id', async () => {
      expect((await call('POST', '/foods/import', { body: {} })).status).toBe(400);
      expect(
        (await call('POST', '/foods/import', { body: { provider_food_id: '' } })).status
      ).toBe(400);
      expect(
        (await call('POST', '/foods/import', { body: { provider_food_id: '1', provider: 'usda' } }))
          .status
      ).toBe(400);
    });

    it('an imported row obeys every rule a typed one does', async () => {
      const { food } = await json<{ food: FoodRow }>(
        await call('POST', '/foods/import', { body: { provider_food_id: '33691' } })
      );

      // Cross-user mutation is 404, never 403.
      expect((await call('DELETE', `/custom-foods/${food.id}`, { token: tokenB })).status).toBe(404);
      // Re-portioning derives from the stored basis, so the round trip returns.
      const rePortioned = await json<{ food: FoodRow }>(
        await call('PUT', `/custom-foods/${food.id}`, { body: { portion: 50 } })
      );
      expect(rePortioned.food.base_calories_per_100).toBe(58.82);
      expect(rePortioned.food.calories).toBe(29.41);
      const back = await json<{ food: FoodRow }>(
        await call('PUT', `/custom-foods/${food.id}`, { body: { portion: 170 } })
      );
      expect(back.food.calories).toBe(99.99);
      // And the provenance survives every write.
      expect(back.food.external_source).toBe('fatsecret');
      expect(back.food.external_id).toBe('33691');
    });

    it('a typed food never claims a provenance it does not have', async () => {
      const { food } = await json<{ food: FoodRow }>(
        await call('POST', '/custom-foods', {
          body: { name: 'Hand typed', portion: 100, base_calories_per_100: 100 },
        })
      );
      expect(food.external_source).toBeNull();
      expect(food.external_id).toBeNull();
      expect(food.source_type).toBe('manual');
    });
  });
});
