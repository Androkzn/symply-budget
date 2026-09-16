import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireHealthApi } from '../middleware/brand-gate';
import {
  EXTERNAL_FOOD_PROVIDER,
  ExternalFoodProvider,
  importValuesFor,
  resolveServing,
  type ExternalFood,
  type FoodProviderStatus,
} from '../services/health-food-provider';
import { HealthFoodService, type MealType } from '../services/health-food-service';
import type { Env } from '../types';

/**
 * Symply Health — parity phase P2, `food` group: custom foods, food search and recipes.
 *
 * Mounted at `/health` alongside `routes/health.ts`. Same contract:
 * `requireHealthApi()` 404s the whole surface on every non-Health Worker, and
 * every row is scoped to the authenticated USER — health data is personal and
 * has no household read path by design (BRD §7).
 *
 * Each P2 router owns disjoint sub-paths, so mount ordering between them at the
 * shared `/health` prefix does not matter.
 *
 * THIN CLIENT, exactly like routes/health.ts: portion maths, recipe totals,
 * relevance and suggestion scoring all live in `HealthFoodService`. Handlers
 * validate the shape and pass through — a serving is NEVER stored as the client
 * sent it, it is re-derived from `base_*_per_100`.
 *
 * P3 ADDITION — the external food database. `/foods/search` tops its answer up
 * from FatSecret and `/foods/import` keeps a hit the user chose. All of that
 * goes through ONE chokepoint, `services/health-food-provider.ts`; this file
 * never sees a credential, a provider URL or a raw provider payload, and the
 * DEVICE never sees any of them either. Every provider failure resolves to a
 * `provider.status` the client renders as copy — never an error string.
 */
const healthFood = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

healthFood.use('/*', requireHealthApi());
healthFood.use('/*', authMiddleware());

function uid(c: { get: (k: 'userId') => string }): string {
  return c.get('userId');
}

function svc(c: { env: Env }): HealthFoodService {
  return new HealthFoodService(c.env.DB);
}

function isTrue(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

const mealType = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);

/** An ISO stamp with a wall-clock time; the offset is optional on purpose — the
 * client sends its OWN local clock, which is what the time-of-day bucket means. */
const timestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'must be an ISO timestamp');

/* ============================ CUSTOM FOODS ============================== */

// Per-100 bounds are the donor's: >1000 kcal or >100g of one macro per 100g is
// physically impossible and would poison every portion derived from it. The
// cross-field checks (implied basis, macro sum) need the effective portion, so
// they run in the service.
const per100 = z.number().min(0).max(1000);
const macroPer100 = z.number().min(0).max(100);
const servingMacro = z.number().min(0).max(100000);

const foodFields = {
  brand_name: z.string().max(80).nullable().optional(),
  portion: z.number().positive().max(100000).optional(),
  unit: z.string().min(1).max(20).optional(),
  calories: servingMacro.optional(),
  proteins: servingMacro.optional(),
  carbohydrates: servingMacro.optional(),
  fats: servingMacro.optional(),
  base_calories_per_100: per100.optional(),
  base_proteins_per_100: macroPer100.optional(),
  base_carbs_per_100: macroPer100.optional(),
  base_fats_per_100: macroPer100.optional(),
  category: z.string().max(40).nullable().optional(),
  barcode: z.string().max(40).nullable().optional(),
  is_favorite: z.boolean().optional(),
  preferred_meal_types: z.array(mealType).max(4).optional(),
  source_type: z.enum(['manual', 'scanned', 'imported', 'shared', 'recipe']).optional(),
};

const createFoodSchema = z
  .object({ name: z.string().trim().min(1).max(120), ...foodFields })
  .refine((v) => v.calories !== undefined || v.base_calories_per_100 !== undefined, {
    message: 'calories or base_calories_per_100 is required',
    path: ['calories'],
  });

const updateFoodSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  ...foodFields,
});

healthFood.get('/custom-foods', async (c) => {
  const { search, favorites, most_used, limit } = c.req.query();
  const parsedLimit = limit ? Number(limit) : undefined;
  // Bound into `LIMIT ?`, and D1 rejects a non-integer REAL there with
  // SQLITE_MISMATCH — so `?limit=1.5` used to 500 on an ordinary list.
  if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
    return c.json({ error: { code: 'bad_request', message: 'limit must be an integer' } }, 400);
  }
  const foods = await svc(c).listCustomFoods(uid(c), {
    search,
    favorites: isTrue(favorites),
    mostUsed: isTrue(most_used),
    limit: parsedLimit,
  });
  return c.json({ foods });
});

healthFood.post('/custom-foods', zValidator('json', createFoodSchema), async (c) => {
  const result = await svc(c).createCustomFood(uid(c), c.req.valid('json'));
  if (!result.ok) return c.json({ error: { code: result.code, message: result.message } }, 400);
  return c.json({ food: result.food }, 201);
});

healthFood.put('/custom-foods/:id', zValidator('json', updateFoodSchema), async (c) => {
  const result = await svc(c).updateCustomFood(uid(c), c.req.param('id'), c.req.valid('json'));
  if (!result.ok) {
    // 404, never 403 — a 403 would confirm the id exists on another account.
    const status = result.code === 'not_found' ? 404 : 400;
    return c.json({ error: { code: result.code, message: result.message } }, status);
  }
  return c.json({ food: result.food });
});

healthFood.delete('/custom-foods/:id', async (c) => {
  const ok = await svc(c).deleteCustomFood(uid(c), c.req.param('id'));
  if (!ok) return c.json({ error: { code: 'not_found', message: 'Custom food not found' } }, 404);
  return c.json({ deleted: true });
});

/**
 * Log a use. Bumps `use_count`, stamps `last_used_at` and appends the
 * `food_usage_history` row that `/foods/suggestions` reads. `logged` comes back
 * derived from the per-100 basis so the client never re-does the maths itself.
 */
healthFood.post(
  '/custom-foods/:id/use',
  zValidator(
    'json',
    z.object({
      meal_type: mealType.optional(),
      used_at: timestampSchema.optional(),
      portion: z.number().positive().max(100000).optional(),
    })
  ),
  async (c) => {
    const result = await svc(c).recordUse(uid(c), c.req.param('id'), c.req.valid('json'));
    if (!result) return c.json({ error: { code: 'not_found', message: 'Custom food not found' } }, 404);
    return c.json(result);
  }
);

/* ============================ FOOD SEARCH ============================== */

/** Name key used to keep a provider hit out of a library the user already has. */
function nameKey(name: string, brand?: string | null): string {
  return `${name}|${brand ?? ''}`.toLowerCase().replace(/[^a-z0-9|]/g, '');
}

/**
 * Provider capability probe.
 *
 * Answers WITHOUT calling out, so a screen can explain the state of the feature
 * before the user types a single character. Declared above `/foods/search` for
 * readability only — all three `/foods/*` paths are literal, so Hono's matcher
 * does not care about their order.
 */
healthFood.get('/foods/provider', (c) => {
  return c.json({ provider: new ExternalFoodProvider(c.env).probe() });
});

/**
 * A packaged food, by the barcode printed on it — the donor's
 * `/integrations/fatsecret/foods/barcode/:barcode` (parity P5).
 *
 * ONE ROUTE, NOT THE DONOR'S TWO. The donor returned the raw
 * `food.find_id_for_barcode.v2` payload and made the DEVICE do the second
 * `food.get.v4` call, which meant every client re-implemented the two-step, the
 * `food_id.value` unwrap and the GTIN-13 padding. All three live in
 * `health-food-provider.ts` now; this answers with a mapped `ExternalFood` or a
 * status, and nothing else.
 *
 * ALWAYS 200 (except on a code with no digits in it at all), exactly like
 * `/foods/search`: a missing credential, a rate limit or an outage is a
 * `provider.status` the client renders as copy, not an HTTP failure. `food:
 * null` with `status: 'ok'` is the "this database does not know that code"
 * answer, which is a different fact from "we could not ask" and the client says
 * so.
 *
 * `barcode` echoes the GTIN-13 that was actually SENT — a 12-digit UPC-A is
 * padded to 13 before the provider sees it, and without that pad every North
 * American product answers "not found".
 */
healthFood.get('/foods/barcode', async (c) => {
  const code = c.req.query('code') ?? '';
  if (code.replace(/\D/g, '').length === 0) {
    return c.json({ error: { code: 'bad_request', message: 'code must contain digits' } }, 400);
  }

  const provider = new ExternalFoodProvider(c.env);
  const lookup = await provider.lookupBarcode(code);
  return c.json({
    barcode: lookup.barcode,
    food: lookup.food,
    provider: {
      id: EXTERNAL_FOOD_PROVIDER,
      configured: provider.isConfigured(),
      status: lookup.status,
    },
  });
});

/**
 * The user's own library, TOPPED UP from an external food database (parity P3).
 *
 * Two arrays, not one. The donor merged its FatSecret hits into a single
 * relevance-ranked list and told them apart with a `SourceBadge`; here `results`
 * stays exactly what it was — the user's own rows, unchanged shape — and
 * provider hits ride alongside in `external`. Three reasons:
 *
 *   1. They are not the same kind of thing. A library row has an id you can
 *      PUT, DELETE, favourite and log; a provider hit has none of that until it
 *      is imported. One array would hand the client rows whose available verbs
 *      differ silently.
 *   2. An outage cannot change the shape of the library half. `external: []`
 *      plus a status is a complete, honest answer.
 *   3. It is additive: every existing caller of `results` keeps working.
 *
 * `include_external=false` skips the provider entirely (status `skipped`).
 *
 * DELIBERATE DIVERGENCE from the donor: `foodSearch.ts` only called FatSecret
 * `if (results.length < 5)`. That gate makes the external database invisible to
 * exactly the users who have built a library — the ones most likely to be
 * looking for something they have NOT typed before — so the top-up is
 * unconditional here. The cost that gate was protecting against is paid instead
 * by the 24 h CONFIG_KV cache in `health-food-provider.ts`, which is a better
 * trade: it removes repeat calls for everyone rather than removing the feature
 * for some.
 *
 * FAIL CLOSED AND LEGIBLY: a missing credential, a rate limit or an outage never
 * fails this request and never returns a raw provider string. `results` still
 * answers from the library and `provider.status` names what happened, which is
 * what the client turns into copy.
 */
healthFood.get('/foods/search', async (c) => {
  const query = c.req.query('query');
  // Donor rule: a 1-character query matches most of a library and is never what
  // the user meant.
  if (!query || query.trim().length < 2) {
    return c.json(
      { error: { code: 'bad_request', message: 'query must be at least 2 characters' } },
      400
    );
  }
  const limit = c.req.query('limit');
  const parsedLimit = limit ? Number(limit) : undefined;
  if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
    return c.json({ error: { code: 'bad_request', message: 'limit must be an integer' } }, 400);
  }
  const results = await svc(c).searchFoods(uid(c), query, { limit: parsedLimit });

  const provider = new ExternalFoodProvider(c.env);
  const includeExternal = c.req.query('include_external') !== 'false';

  let external: ExternalFood[] = [];
  let status: FoodProviderStatus = 'skipped';
  if (includeExternal) {
    const lookup = await provider.search(query, parsedLimit ?? 20);
    status = lookup.status;
    // Donor `foodSearch.ts` dedupe, kept: a food already in the library must not
    // be offered again as something to import.
    const owned = new Set(results.map((row) => nameKey(row.name, row.brand_name)));
    external = lookup.foods.filter((food) => !owned.has(nameKey(food.name, food.brand_name)));
  }

  return c.json({
    results,
    external,
    query: query.trim(),
    sources: includeExternal && status === 'ok' ? ['library', EXTERNAL_FOOD_PROVIDER] : ['library'],
    provider: { id: EXTERNAL_FOOD_PROVIDER, configured: provider.isConfigured(), status },
  });
});

/**
 * Keep an external hit as a real `custom_foods` row the user owns.
 *
 * The provider food is re-fetched by id rather than trusted from the request
 * body: a client could otherwise post any macros it liked under a provider's
 * name, and the imported row is the basis every future portion of that food is
 * derived from. `food.get.v4` is cached for 7 days, so this is normally a KV
 * read.
 *
 * Answers 201 on a fresh import and 200 with `created: false` when the user
 * already has it — see `HealthFoodService.importExternalFood` for why a repeat
 * import never overwrites.
 */
healthFood.post(
  '/foods/import',
  zValidator(
    'json',
    z.object({
      /** Present for forward compatibility; only one provider exists today. */
      provider: z.literal(EXTERNAL_FOOD_PROVIDER).optional(),
      provider_food_id: z.string().trim().min(1).max(80),
      /** Which of the provider's servings the user picked. */
      serving_id: z.string().trim().max(80).optional(),
      is_favorite: z.boolean().optional(),
      preferred_meal_types: z.array(mealType).max(4).optional(),
    })
  ),
  async (c) => {
    const provider = new ExternalFoodProvider(c.env);
    if (!provider.isConfigured()) {
      return c.json(
        {
          error: {
            code: 'provider_not_configured',
            message: 'The external food database is not set up for this environment',
          },
          provider: provider.probe(),
        },
        503
      );
    }

    const body = c.req.valid('json');
    const lookup = await provider.getFood(body.provider_food_id);
    if (lookup.status === 'rate_limited') {
      return c.json(
        {
          error: { code: 'provider_rate_limited', message: 'The food database is busy right now' },
          provider: { id: EXTERNAL_FOOD_PROVIDER, configured: true, status: lookup.status },
        },
        429
      );
    }
    if (lookup.status !== 'ok') {
      return c.json(
        {
          error: {
            code: 'provider_unavailable',
            message: 'The food database could not be reached',
          },
          provider: { id: EXTERNAL_FOOD_PROVIDER, configured: true, status: lookup.status },
        },
        503
      );
    }
    if (!lookup.food) {
      return c.json({ error: { code: 'not_found', message: 'Food not found' } }, 404);
    }

    const serving = resolveServing(lookup.food, body.serving_id);
    if (!serving) {
      // Mapped foods always carry at least one serving, so this is a provider
      // shape we do not understand rather than a user error.
      //
      // DELIBERATELY UNREACHABLE FROM HERE, and left in: `mapFatSecretFood`
      // returns null unless `pickPreferredServing` found one, so a mapped food
      // always has a serving and a missing one 404s above. This is the guard
      // that keeps that true if the mapper's contract ever loosens — the two
      // files are not edited together.
      return c.json(
        { error: { code: 'invalid_nutrition', message: 'That food has no usable serving' } },
        422
      );
    }

    const result = await svc(c).importExternalFood(uid(c), {
      external_source: EXTERNAL_FOOD_PROVIDER,
      external_id: lookup.food.provider_food_id,
      name: lookup.food.name,
      brand_name: lookup.food.brand_name,
      is_favorite: body.is_favorite,
      preferred_meal_types: body.preferred_meal_types,
      ...importValuesFor(serving),
    });
    if (!result.ok) {
      // Also unreachable through the provider today, for the same reason:
      // `isImportableServing` already ran `validateBasis` over these exact four
      // numbers inside `mapServing`, so a serving that gets this far cannot
      // fail it again. The service applies the gate anyway (it does not trust
      // its caller — HEALTH-FOOD-150), and this maps the refusal if it ever
      // fires.
      return c.json({ error: { code: result.code, message: result.message } }, 422);
    }
    return c.json({ food: result.food, created: result.created }, result.created ? 201 : 200);
  }
);

/** Donor's "what you usually eat at this time of day". */
healthFood.get('/foods/suggestions', async (c) => {
  const raw = c.req.query('meal_type');
  const parsed = raw ? mealType.safeParse(raw) : null;
  if (parsed && !parsed.success) {
    return c.json({ error: { code: 'bad_request', message: 'invalid meal_type' } }, 400);
  }
  const limit = c.req.query('limit');
  const parsedLimit = limit ? Number(limit) : undefined;
  if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
    return c.json({ error: { code: 'bad_request', message: 'limit must be an integer' } }, 400);
  }
  const result = await svc(c).suggestions(uid(c), {
    meal_type: parsed?.data as MealType | undefined,
    at: c.req.query('at'),
    limit: parsedLimit,
  });
  return c.json(result);
});

/* =============================== RECIPES =============================== */

const ingredientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: z.number().positive().max(100000),
  unit: z.string().min(1).max(20).optional(),
  /** Points at one of the user's own foods; its stored basis wins. */
  food_id: z.string().max(80).optional(),
  base_calories_per_100: per100.optional(),
  base_proteins_per_100: macroPer100.optional(),
  base_carbs_per_100: macroPer100.optional(),
  base_fats_per_100: macroPer100.optional(),
});

const recipeFields = {
  description: z.string().max(2000).nullable().optional(),
  // Rule 2: `servings` divides the server-computed totals, so it cannot be 0.
  servings: z.number().int().min(1).max(100).optional(),
  preparation_time: z.number().int().min(0).max(10000).nullable().optional(),
  cooking_time: z.number().int().min(0).max(10000).nullable().optional(),
  instructions: z.string().max(20000).nullable().optional(),
  image_url: z.string().max(500).nullable().optional(),
  category: z.string().max(40).nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  is_favorite: z.boolean().optional(),
};

const createRecipeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ingredients: z.array(ingredientSchema).min(1).max(100),
  ...recipeFields,
});

const updateRecipeSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  ingredients: z.array(ingredientSchema).min(1).max(100).optional(),
  ...recipeFields,
});

healthFood.get('/recipes', async (c) => {
  const { search, favorites, category, limit } = c.req.query();
  const parsedLimit = limit ? Number(limit) : undefined;
  if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
    return c.json({ error: { code: 'bad_request', message: 'limit must be an integer' } }, 400);
  }
  const list = await svc(c).listRecipes(uid(c), {
    search,
    favorites: isTrue(favorites),
    category,
    limit: parsedLimit,
  });
  return c.json({ recipes: list });
});

healthFood.post('/recipes', zValidator('json', createRecipeSchema), async (c) => {
  const result = await svc(c).createRecipe(uid(c), c.req.valid('json'));
  if (!result.ok) return c.json({ error: { code: result.code, message: result.message } }, 400);
  return c.json({ recipe: result.recipe }, 201);
});

healthFood.put('/recipes/:id', zValidator('json', updateRecipeSchema), async (c) => {
  const result = await svc(c).updateRecipe(uid(c), c.req.param('id'), c.req.valid('json'));
  if (!result.ok) {
    const status = result.code === 'not_found' ? 404 : 400;
    return c.json({ error: { code: result.code, message: result.message } }, status);
  }
  return c.json({ recipe: result.recipe });
});

healthFood.delete('/recipes/:id', async (c) => {
  const ok = await svc(c).deleteRecipe(uid(c), c.req.param('id'));
  if (!ok) return c.json({ error: { code: 'not_found', message: 'Recipe not found' } }, 404);
  return c.json({ deleted: true });
});

/**
 * Cook the same recipe for a different head count. Read-only: the stored recipe
 * stays the canonical one-batch definition, so scaling twice never compounds.
 */
healthFood.post(
  '/recipes/:id/scale',
  zValidator('json', z.object({ servings: z.number().int().min(1).max(100) })),
  async (c) => {
    const scaled = await svc(c).scaleRecipe(
      uid(c),
      c.req.param('id'),
      c.req.valid('json').servings
    );
    if (!scaled) return c.json({ error: { code: 'not_found', message: 'Recipe not found' } }, 404);
    return c.json({ scaled });
  }
);

export default healthFood;
