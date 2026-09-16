/**
 * `services/health-food-provider.ts` — the ONE place the Symply Health Worker
 * talks to an external food database (parity phase P3, ported from the donor's
 * FatSecret integration in `routes/foodSearch.ts` + `routes/integrations.ts`).
 *
 * Two things this suite is really about:
 *
 *  1. THE MAPPING IS THE PRODUCT. FatSecret sends every number as a string,
 *     sends `servings.serving` as an array OR a bare object, and frequently
 *     omits the metric serving size altogether. Each of those, mishandled,
 *     writes a wrong `base_*_per_100` into a user's library — and every portion
 *     of that food, forever after, is derived from it. The donor got the third
 *     one wrong (see the `metric_serving_amount || 100` spec below), which is
 *     why these cases are asserted against exact numbers rather than shapes.
 *
 *  2. EVERY FAILURE IS A STATUS, NEVER A THROW AND NEVER A STRING. A missing
 *     credential, a 429, an application-level error riding a 200, a 5xx and a
 *     dead socket must each resolve to their own word, because the client turns
 *     that word into copy. Nothing here may surface a provider message.
 *
 * THE REAL FATSECRET API IS NEVER CALLED. `globalThis.fetch` is replaced for the
 * duration of each spec and every request is recorded, which is also how the
 * "the secret only ever goes to the token endpoint" spec is expressible.
 */

import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../types';
import {
  __resetFoodProviderTokenCache,
  asArray,
  ExternalFoodProvider,
  EXTERNAL_FOOD_PROVIDER,
  FOOD_PROVIDER_KV_PREFIX,
  importValuesFor,
  mapFatSecretFood,
  mapFoodPayload,
  mapSearchPayload,
  isImportableServing,
  mapServing,
  normalizeQuery,
  pickPreferredServing,
  RATE_LIMIT_COOLDOWN_KEY,
  resolveServing,
  toNumber,
  type ExternalFood,
} from '../health-food-provider';

const testEnv = env as unknown as Env;

const CONFIGURED = {
  ...testEnv,
  FATSECRET_CLIENT_ID: 'test-client-id',
  FATSECRET_CLIENT_SECRET: 'test-client-secret',
} as Env;

/* ==================================================================== */
/* Provider payload fixtures — the exact shapes FatSecret answers with    */
/* ==================================================================== */

/** A metric serving: numbers as STRINGS, which is how the API sends them. */
const METRIC_SERVING = {
  serving_id: '32729',
  serving_description: '1 container (170 g)',
  metric_serving_amount: '170.000',
  metric_serving_unit: 'g',
  number_of_units: '1.000',
  calories: '100',
  protein: '18.000',
  carbohydrate: '6.000',
  fat: '0.000',
};

/** No metric amount at all — very common, and the donor's blind spot. */
const NON_METRIC_SERVING = {
  serving_id: '55901',
  serving_description: '1 large',
  measurement_description: 'large',
  number_of_units: '1.000',
  calories: '78',
  protein: '6.290',
  carbohydrate: '0.560',
  fat: '5.300',
};

/** A second metric serving, so a mapped food carries a real choice. */
const METRIC_100G = {
  serving_id: '32730',
  serving_description: '100 g',
  metric_serving_amount: '100.000',
  metric_serving_unit: 'g',
  number_of_units: '100.000',
  calories: '59',
  protein: '10.600',
  carbohydrate: '3.500',
  fat: '0.000',
};

function searchPayload(foods: unknown[]): unknown {
  return { foods_search: { max_results: '20', results: { food: foods } } };
}

const YOGURT = {
  food_id: '33691',
  food_name: 'Greek Yogurt',
  brand_name: 'Fage',
  food_type: 'Brand',
  servings: { serving: [METRIC_SERVING, METRIC_100G, NON_METRIC_SERVING] },
};

/* ==================================================================== */
/* fetch harness                                                         */
/* ==================================================================== */

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

const realFetch = globalThis.fetch;
let calls: Recorded[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const TOKEN_OK = { access_token: 'tok_abc123', expires_in: 86400, token_type: 'Bearer' };

/**
 * Install a fetch stub. `handler` sees the recorded request and returns the
 * response; anything it does not handle throws, so an unexpected call is a
 * failure rather than a silent pass-through to the real internet.
 */
function stubFetch(handler: (call: Recorded) => Response | Promise<Response>): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const recorded: Recorded = {
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers,
      body: typeof init?.body === 'string' ? init.body : null,
    };
    calls.push(recorded);
    return handler(recorded);
  }) as unknown as typeof fetch;
}

/** The common case: the token grant succeeds and the API answers `payload`. */
function stubApi(payload: unknown, status = 200): void {
  stubFetch((call) => {
    if (call.url.startsWith('https://oauth.fatsecret.com/')) return jsonResponse(TOKEN_OK);
    return jsonResponse(payload, status);
  });
}

const apiCalls = () => calls.filter((c) => c.url.startsWith('https://platform.fatsecret.com/'));
const tokenCalls = () => calls.filter((c) => c.url.startsWith('https://oauth.fatsecret.com/'));

/** Every key this module owns — a cached answer would mask the next spec. */
async function clearProviderCache(): Promise<void> {
  const listed = await testEnv.CONFIG_KV.list({ prefix: FOOD_PROVIDER_KV_PREFIX });
  await Promise.all(listed.keys.map((key) => testEnv.CONFIG_KV.delete(key.name)));
}

beforeEach(async () => {
  calls = [];
  __resetFoodProviderTokenCache();
  await clearProviderCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/* ==================================================================== */

describe('health food provider — mapping', () => {
  it('reads FatSecret string numbers, and treats junk as zero', () => {
    expect(toNumber('170.000')).toBe(170);
    expect(toNumber(12)).toBe(12);
    expect(toNumber('  6 ')).toBe(6);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber('n/a')).toBe(0);
    expect(toNumber(Number.NaN)).toBe(0);
    expect(toNumber(undefined, 1)).toBe(1);
  });

  it('accepts `servings.serving` as an array OR a bare object', () => {
    // A single-serving food answers with an object, not a one-element array.
    expect(asArray(METRIC_SERVING)).toHaveLength(1);
    expect(asArray([METRIC_SERVING, NON_METRIC_SERVING])).toHaveLength(2);
    expect(asArray(undefined)).toEqual([]);
    expect(asArray(null)).toEqual([]);

    const single = mapFatSecretFood({
      food_id: '1',
      food_name: 'Milk',
      servings: { serving: METRIC_SERVING },
    });
    expect(single?.servings).toHaveLength(1);
  });

  it('derives the per-100 basis from a METRIC serving', () => {
    const serving = mapServing(METRIC_SERVING, 0);

    expect(serving).not.toBeNull();
    expect(serving?.portion).toBe(170);
    expect(serving?.unit).toBe('g');
    expect(serving?.is_metric).toBe(true);
    expect(serving?.calories).toBe(100);
    // 100 kcal / 170 g × 100 — not the serving figure, not a guess.
    expect(serving?.base_calories_per_100).toBe(58.82);
    expect(serving?.base_proteins_per_100).toBe(10.59);
  });

  it('a serving with NO metric amount stays a serving — the donor called it 100 g', () => {
    const serving = mapServing(NON_METRIC_SERVING, 0);

    expect(serving?.is_metric).toBe(false);
    expect(serving?.unit).toBe('serving');
    expect(serving?.portion).toBe(1);
    // Per-100-OF-THAT-UNIT, the platform's own convention: 78 kcal for 1
    // serving is 7800 per 100 servings, and `portionFrom(basis, 1)` returns 78.
    expect(serving?.base_calories_per_100).toBe(7800);
    expect(serving?.calories).toBe(78);

    // THE DONOR'S BUG, stated as an assertion. `foodSearch.ts` computed
    // `calories * 100 / (metric_serving_amount || 100)`, so a large egg with no
    // metric amount became 78 kcal per 100 g — 4× too low — and every portion
    // of it afterwards was derived from that.
    const donorBasis = 78 * 100 / 100;
    expect(serving?.base_calories_per_100).not.toBe(donorBasis);
  });

  it('prefers a metric serving over `serving[0]`', () => {
    const servings = [NON_METRIC_SERVING, METRIC_SERVING]
      .map((raw, i) => mapServing(raw, i))
      .filter((s): s is NonNullable<typeof s> => s !== null);

    // The donor took [0] blindly, which is often "1 container" for a packaged
    // food and reads as though a whole tub were the normal portion.
    expect(pickPreferredServing(servings)?.unit).toBe('g');

    // With no metric serving at all, the first one is still the answer.
    const nonMetricOnly = [mapServing(NON_METRIC_SERVING, 0)!];
    expect(pickPreferredServing(nonMetricOnly)?.serving_id).toBe('55901');
    expect(pickPreferredServing([])).toBeNull();
  });

  it('maps a whole food onto the platform vocabulary', () => {
    const food = mapFatSecretFood(YOGURT);

    expect(food).toMatchObject({
      id: 'fatsecret:33691',
      provider: 'fatsecret',
      provider_food_id: '33691',
      name: 'Greek Yogurt',
      brand_name: 'Fage',
      portion: 170,
      unit: 'g',
      serving_id: '32729',
      serving_description: '1 container (170 g)',
      calories: 100,
      base_calories_per_100: 58.82,
    });
    // Two of the three servings survive: the non-metric one cannot be expressed
    // within the platform's gram-semantic bounds — see the dedicated spec below.
    expect(food?.servings.map((s) => s.serving_id)).toEqual(['32729', '32730']);
  });

  it('drops a serving the PLATFORM cannot store, and says which bound did it', () => {
    const serving = mapServing(NON_METRIC_SERVING, 0);

    // The mapping itself is correct — 78 kcal for one serving.
    expect(serving?.calories).toBe(78);
    // But `validateBasis`'s ceilings are per-100-GRAMS, and 7800 kcal per 100
    // *eggs* is 7.8x the 1000 kcal cap. Same refusal a hand-typed
    // "1 serving / 78 kcal" gets from POST /custom-foods, so this is a
    // pre-existing platform bound surfacing here, not a provider quirk.
    expect(isImportableServing(serving!)).toBe(false);

    // A food left with NO importable serving is dropped whole, rather than
    // offered as something that would 422 the moment it was imported.
    expect(
      mapFatSecretFood({
        food_id: '77',
        food_name: 'Large egg',
        servings: { serving: NON_METRIC_SERVING },
      })
    ).toBeNull();
  });

  it('drops a food whose basis is physically impossible', () => {
    // 3000 kcal per 100 g is not a food, it is a corrupted row — and importing
    // it would poison every portion derived from it afterwards.
    const corrupt = mapFatSecretFood({
      food_id: '9',
      food_name: 'Broken',
      servings: {
        serving: {
          serving_id: 's',
          metric_serving_amount: '10',
          metric_serving_unit: 'g',
          calories: '300',
          protein: '0',
          carbohydrate: '0',
          fat: '0',
        },
      },
    });
    expect(corrupt).toBeNull();
  });

  it('survives the shapes a provider answer is NOT supposed to have', () => {
    // Each of these has been seen in the wild or is one field away from it, and
    // every one used to be a `TypeError` inside a search the user was typing.
    expect(mapServing(null, 0)).toBeNull();
    expect(mapServing('1 large egg', 0)).toBeNull();
    // A food with no `servings` key at all.
    expect(mapFatSecretFood({ food_id: '1', food_name: 'Ghost' })).toBeNull();
    // A servings block whose entries are all junk.
    expect(
      mapFatSecretFood({ food_id: '1', food_name: 'Ghost', servings: { serving: [null, 'x'] } })
    ).toBeNull();
  });

  it('a serving with no id of its own gets a positional one, so it stays pickable', () => {
    // `serving_id` is the handle `/foods/import` uses to keep the serving the
    // person chose; a null would make the second serving unselectable.
    const serving = mapServing({ ...METRIC_SERVING, serving_id: '   ' }, 3);
    expect(serving?.serving_id).toBe('idx_3');
  });

  it('a blank metric unit is treated as no metric unit, not as an empty one', () => {
    // `"  "` is not a unit. Trusting it would label the basis "per 100  " and
    // make `isImportableServing` judge it against gram semantics anyway.
    const serving = mapServing({ ...METRIC_SERVING, metric_serving_unit: '   ' }, 0);
    expect(serving?.is_metric).toBe(false);
    expect(serving?.unit).toBe('serving');
  });

  it('drops an unusable entry rather than inventing one', () => {
    expect(mapFatSecretFood(null)).toBeNull();
    expect(mapFatSecretFood({ food_name: 'No id' })).toBeNull();
    expect(mapFatSecretFood({ food_id: '1' })).toBeNull();
    // No servings at all, and a serving with no energy of any kind.
    expect(mapFatSecretFood({ food_id: '1', food_name: 'Empty' })).toBeNull();
    expect(
      mapFatSecretFood({
        food_id: '1',
        food_name: 'Zero',
        servings: { serving: { calories: '0', protein: '0', carbohydrate: '0', fat: '0' } },
      })
    ).toBeNull();
  });

  it('reads both list envelopes, and the single-food one', () => {
    expect(mapSearchPayload(searchPayload([YOGURT]))).toHaveLength(1);
    // A food with no valid servings is filtered out of the list, not returned
    // as a hole in it.
    expect(mapSearchPayload(searchPayload([YOGURT, { food_id: '2' }]))).toHaveLength(1);
    expect(mapSearchPayload({})).toEqual([]);
    expect(mapSearchPayload(null)).toEqual([]);

    expect(mapFoodPayload({ food: YOGURT })?.provider_food_id).toBe('33691');
    expect(mapFoodPayload({})).toBeNull();
  });

  it('normalises a query once — the same string is sent and cached on', () => {
    expect(normalizeQuery('  Greek   YOGURT ')).toBe('greek yogurt');
    expect(normalizeQuery('x'.repeat(200))).toHaveLength(100);
  });

  it('resolves the serving the user picked, and falls back when they did not', () => {
    const food = mapFatSecretFood(YOGURT) as ExternalFood;

    expect(resolveServing(food, '32730')?.portion).toBe(100);
    // No choice made ⇒ the preferred serving, which is the first metric one.
    expect(resolveServing(food, undefined)?.portion).toBe(170);
    // An id we do not recognise is not an error — it falls back to the default
    // rather than refusing to import anything at all.
    expect(resolveServing(food, 'nope')?.portion).toBe(170);
  });

  it('an import carries the BASIS, never the provider serving figures', () => {
    const food = mapFatSecretFood(YOGURT) as ExternalFood;
    const values = importValuesFor(resolveServing(food, null)!);

    expect(values).toEqual({
      portion: 170,
      unit: 'g',
      base_calories_per_100: 58.82,
      base_proteins_per_100: 10.59,
      base_carbs_per_100: 3.53,
      base_fats_per_100: 0,
    });
    // The serving is the service's to derive (rule 1). Passing the provider's
    // rounded figures through would be the one place a serving was copied.
    expect(values).not.toHaveProperty('calories');
  });
});

describe('health food provider — configuration', () => {
  it('reports not_configured, and makes no request at all, without a credential', async () => {
    stubFetch(() => jsonResponse({}));
    const provider = new ExternalFoodProvider(testEnv);

    expect(provider.isConfigured()).toBe(false);
    expect(provider.probe()).toEqual({
      id: EXTERNAL_FOOD_PROVIDER,
      configured: false,
      status: 'not_configured',
    });

    const search = await provider.search('yogurt');
    expect(search).toEqual({ status: 'not_configured', foods: [], cached: false });
    const lookup = await provider.getFood('33691');
    expect(lookup).toEqual({ status: 'not_configured', food: null, cached: false });
    // Not even a token grant: a deploy with no key must be silent, not noisy.
    expect(calls).toEqual([]);
  });

  it('half a credential is no credential', async () => {
    const halves: Env[] = [
      { ...testEnv, FATSECRET_CLIENT_ID: 'id' } as Env,
      { ...testEnv, FATSECRET_CLIENT_SECRET: 'secret' } as Env,
      { ...testEnv, FATSECRET_CLIENT_ID: '', FATSECRET_CLIENT_SECRET: 'secret' } as Env,
    ];
    for (const half of halves) {
      expect(new ExternalFoodProvider(half).isConfigured()).toBe(false);
    }
    expect(new ExternalFoodProvider(CONFIGURED).isConfigured()).toBe(true);
    expect(new ExternalFoodProvider(CONFIGURED).probe().status).toBe('ok');
  });

  it('answers an under-length needle without asking the provider', async () => {
    stubApi(searchPayload([YOGURT]));
    const provider = new ExternalFoodProvider(CONFIGURED);

    expect(await provider.search('a')).toEqual({ status: 'ok', foods: [], cached: false });
    expect(await provider.search('   ')).toEqual({ status: 'ok', foods: [], cached: false });
    expect(calls).toEqual([]);
  });
});

describe('health food provider — search', () => {
  it('mints a token, searches, and maps the answer', async () => {
    stubApi(searchPayload([YOGURT]));

    const result = await new ExternalFoodProvider(CONFIGURED).search('search-happy', 20);

    expect(result.status).toBe('ok');
    expect(result.cached).toBe(false);
    expect(result.foods.map((f) => f.id)).toEqual(['fatsecret:33691']);

    expect(tokenCalls()).toHaveLength(1);
    expect(apiCalls()).toHaveLength(1);
    expect(apiCalls()[0].url).toContain('method=foods.search.v4');
    expect(apiCalls()[0].url).toContain('search_expression=search-happy');
    expect(apiCalls()[0].url).toContain('max_results=20');
  });

  it('the SECRET only ever goes to the token endpoint', async () => {
    stubApi(searchPayload([YOGURT]));
    await new ExternalFoodProvider(CONFIGURED).search('secret-scope');

    // Basic auth on the grant …
    expect(tokenCalls()[0].headers.authorization).toBe(
      `Basic ${btoa('test-client-id:test-client-secret')}`
    );
    expect(tokenCalls()[0].body).toContain('grant_type=client_credentials');
    // … and a short-lived Bearer on the API call. The credential never rides a
    // query string, and never leaves the Worker in any other form.
    expect(apiCalls()[0].headers.authorization).toBe('Bearer tok_abc123');
    for (const call of apiCalls()) {
      expect(call.url).not.toContain('test-client-secret');
      expect(call.url).not.toContain('test-client-id');
    }
  });

  it('serves a repeated query from CONFIG_KV instead of the provider', async () => {
    stubApi(searchPayload([YOGURT]));
    const provider = new ExternalFoodProvider(CONFIGURED);

    const first = await provider.search('cache-me');
    const second = await provider.search('  CACHE-ME  ');

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.foods.map((f) => f.id)).toEqual(first.foods.map((f) => f.id));
    // The whole reason the cache is in KV: the same needle repeats constantly
    // across a keystroke-driven search, and the provider is rate-limited.
    expect(apiCalls()).toHaveLength(1);
  });

  it('reuses the token across searches', async () => {
    stubApi(searchPayload([YOGURT]));
    const provider = new ExternalFoodProvider(CONFIGURED);

    await provider.search('token-one');
    await provider.search('token-two');

    expect(apiCalls()).toHaveLength(2);
    expect(tokenCalls()).toHaveLength(1);
  });

  it('an HTTP 429 is rate_limited, and arms a cooldown that skips the next call', async () => {
    stubFetch((call) =>
      call.url.startsWith('https://oauth.fatsecret.com/')
        ? jsonResponse(TOKEN_OK)
        : jsonResponse({ error: 'slow down' }, 429)
    );
    const provider = new ExternalFoodProvider(CONFIGURED);

    const first = await provider.search('limit-one');
    expect(first).toEqual({ status: 'rate_limited', foods: [], cached: false });
    expect(await testEnv.CONFIG_KV.get(RATE_LIMIT_COOLDOWN_KEY)).toBe('1');

    const before = apiCalls().length;
    const second = await provider.search('limit-two');
    expect(second.status).toBe('rate_limited');
    // Short-circuited: a screen that keeps typing must not keep spending a
    // quota that is already spent.
    expect(apiCalls()).toHaveLength(before);
  });

  it("FatSecret's own error codes ride a 200, and are classified", async () => {
    // 13 is the quota/throttle family …
    stubApi({ error: { code: 13, message: 'Invalid token: too many requests' } });
    expect((await new ExternalFoodProvider(CONFIGURED).search('code-13')).status).toBe(
      'rate_limited'
    );

    // … 21 is "this IP is not allow-listed", which is an outage from the user's
    // point of view, not a throttle they can wait out.
    calls = [];
    __resetFoodProviderTokenCache();
    await clearProviderCache();
    stubApi({ error: { code: 21, message: 'Invalid IP address detected' } });
    expect((await new ExternalFoodProvider(CONFIGURED).search('code-21')).status).toBe(
      'unavailable'
    );
  });

  it('a 5xx, an unparseable body and a dead socket are all `unavailable`', async () => {
    stubFetch((call) =>
      call.url.startsWith('https://oauth.fatsecret.com/')
        ? jsonResponse(TOKEN_OK)
        : new Response('upstream exploded', { status: 502 })
    );
    expect((await new ExternalFoodProvider(CONFIGURED).search('five-oh-two')).status).toBe(
      'unavailable'
    );

    __resetFoodProviderTokenCache();
    stubFetch((call) =>
      call.url.startsWith('https://oauth.fatsecret.com/')
        ? jsonResponse(TOKEN_OK)
        : new Response('<html>not json</html>', { status: 200 })
    );
    expect((await new ExternalFoodProvider(CONFIGURED).search('not-json')).status).toBe(
      'unavailable'
    );

    __resetFoodProviderTokenCache();
    stubFetch(() => {
      throw new TypeError('network error');
    });
    expect((await new ExternalFoodProvider(CONFIGURED).search('dead-socket')).status).toBe(
      'unavailable'
    );
  });

  it('a credential the provider REFUSES is unavailable, not not_configured', async () => {
    stubFetch(() => jsonResponse({ error: 'invalid_client' }, 401));

    const result = await new ExternalFoodProvider(CONFIGURED).search('bad-secret');

    // `not_configured` would tell the user to set something that is already set.
    expect(result.status).toBe('unavailable');
    expect(apiCalls()).toEqual([]);
  });

  it('a token grant that answers no token is unavailable', async () => {
    stubFetch((call) =>
      call.url.startsWith('https://oauth.fatsecret.com/')
        ? jsonResponse({ expires_in: 86400 })
        : jsonResponse(searchPayload([YOGURT]))
    );
    expect((await new ExternalFoodProvider(CONFIGURED).search('no-token')).status).toBe(
      'unavailable'
    );
  });

  it('never throws — every failure is a status the caller can render', async () => {
    stubFetch(() => {
      throw new Error('boom');
    });
    const provider = new ExternalFoodProvider(CONFIGURED);

    await expect(provider.search('never-throws')).resolves.toMatchObject({
      status: 'unavailable',
      foods: [],
    });
    await expect(provider.getFood('33691')).resolves.toMatchObject({
      status: 'unavailable',
      food: null,
    });
  });
});

describe('health food provider — getFood', () => {
  it('fetches one food by id and caches it', async () => {
    stubApi({ food: YOGURT });
    const provider = new ExternalFoodProvider(CONFIGURED);

    const first = await provider.getFood('33691');
    expect(first.status).toBe('ok');
    expect(first.cached).toBe(false);
    expect(first.food?.name).toBe('Greek Yogurt');
    expect(apiCalls()[0].url).toContain('method=food.get.v4');
    expect(apiCalls()[0].url).toContain('food_id=33691');

    const second = await provider.getFood('33691');
    expect(second.cached).toBe(true);
    expect(apiCalls()).toHaveLength(1);
  });

  it('an unknown id is a null food, not a failure', async () => {
    stubApi({ food: null });
    const result = await new ExternalFoodProvider(CONFIGURED).getFood('does-not-exist');

    expect(result.status).toBe('ok');
    expect(result.food).toBeNull();
    // A null answer is NOT cached — the id may simply be new to the provider.
    expect(result.cached).toBe(false);
  });

  it('a blank id asks nothing', async () => {
    stubApi({ food: YOGURT });
    expect(await new ExternalFoodProvider(CONFIGURED).getFood('   ')).toEqual({
      status: 'ok',
      food: null,
      cached: false,
    });
    expect(calls).toEqual([]);
  });

  it('the cooldown armed by a search also spares the IMPORT path', async () => {
    // `/foods/import` calls `getFood`. Without the same guard, a rate limit hit
    // while typing would be re-hit the moment the user picked a result — the
    // single most likely next action.
    stubFetch((call) =>
      call.url.startsWith('https://oauth.fatsecret.com/')
        ? jsonResponse(TOKEN_OK)
        : new Response('slow down', { status: 429 })
    );
    expect((await new ExternalFoodProvider(CONFIGURED).search('busy')).status).toBe('rate_limited');

    calls = [];
    const lookup = await new ExternalFoodProvider(CONFIGURED).getFood('33691');
    expect(lookup).toEqual({ status: 'rate_limited', food: null, cached: false });
    // Nothing was spent: not even a token grant.
    expect(calls).toEqual([]);
  });
});

/* ==================================================================== */
/* The failure modes that only appear once a TOKEN already exists        */
/* ==================================================================== */

describe('health food provider — token and transport failures', () => {
  it('a token grant that is itself RATE LIMITED is reported as such, not as an outage', async () => {
    // The two words drive different copy: "busy right now, try again" versus
    // "could not be reached". A 429 on the grant is the same quota as a 429 on
    // the query.
    stubFetch(() => new Response('slow down', { status: 429 }));
    expect((await new ExternalFoodProvider(CONFIGURED).search('quota')).status).toBe(
      'rate_limited'
    );
  });

  it('a token grant answering non-JSON is unavailable, not a crash', async () => {
    stubFetch((call) =>
      call.url.startsWith('https://oauth.fatsecret.com/')
        ? new Response('<html>login page</html>', { status: 200 })
        : jsonResponse(searchPayload([YOGURT]))
    );
    expect((await new ExternalFoodProvider(CONFIGURED).search('html-token')).status).toBe(
      'unavailable'
    );
  });

  it('a socket that dies AFTER the token was minted is unavailable, not a throw', async () => {
    // Distinct from the all-fetch-throws case: the grant succeeds and the QUERY
    // is what fails, which is the ordinary mid-request timeout.
    stubFetch((call) => {
      if (call.url.startsWith('https://oauth.fatsecret.com/')) return jsonResponse(TOKEN_OK);
      throw new TypeError('network error');
    });
    const result = await new ExternalFoodProvider(CONFIGURED).search('api-timeout');
    expect(result).toMatchObject({ status: 'unavailable', foods: [], cached: false });
    // …and the failure carries nothing about the transport.
    expect(JSON.stringify(result)).not.toContain('network');
  });

  it('a CACHE that throws degrades to a live call rather than failing the search', async () => {
    // CONFIG_KV is not on the critical path: an unreadable cache must cost a
    // request, never a search result.
    const brokenKv = {
      get: async () => {
        throw new Error('KV unavailable');
      },
      put: async () => {
        throw new Error('KV unavailable');
      },
      list: async () => ({ keys: [] }),
      delete: async () => undefined,
    };
    const env = { ...CONFIGURED, CONFIG_KV: brokenKv } as unknown as Env;
    stubApi(searchPayload([YOGURT]));

    const result = await new ExternalFoodProvider(env).search('greek yogurt');
    expect(result.status).toBe('ok');
    expect(result.cached).toBe(false);
    expect(result.foods).toHaveLength(1);
  });

  it('a cooldown that cannot be WRITTEN still reports the rate limit', async () => {
    // The status is what the screen renders; losing the cooldown costs a wasted
    // request next time, but reporting `ok` would be a lie.
    const brokenKv = {
      get: async () => null,
      put: async () => {
        throw new Error('KV unavailable');
      },
      list: async () => ({ keys: [] }),
      delete: async () => undefined,
    };
    const env = { ...CONFIGURED, CONFIG_KV: brokenKv } as unknown as Env;
    stubFetch((call) =>
      call.url.startsWith('https://oauth.fatsecret.com/')
        ? jsonResponse(TOKEN_OK)
        : new Response('slow down', { status: 429 })
    );
    expect((await new ExternalFoodProvider(env).search('quota')).status).toBe('rate_limited');
  });

  it('a nonsense limit falls back to the default rather than asking for zero results', async () => {
    stubApi(searchPayload([YOGURT]));
    await new ExternalFoodProvider(CONFIGURED).search('greek yogurt', 0);
    expect(new URL(apiCalls()[0].url).searchParams.get('max_results')).toBe('20');

    calls = [];
    __resetFoodProviderTokenCache();
    await clearProviderCache();
    stubApi(searchPayload([YOGURT]));
    await new ExternalFoodProvider(CONFIGURED).search('greek yogurt', Number.NaN);
    expect(new URL(apiCalls()[0].url).searchParams.get('max_results')).toBe('20');
  });
});
