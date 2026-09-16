import type { ApiResponse } from '@/types';

import { apiClient } from './client';
import type { HealthMealType } from './health';

/**
 * Symply Health FOOD API client — custom foods, food search and recipes
 * (parity phase P2), plus the external food database (parity phase P3).
 *
 * Base path: `/health` on the `symply-health-api` Worker, mounted alongside the
 * P1 routes in `backend/src/routes/health-food.ts`. Every row is scoped to the
 * authenticated USER, and the whole surface 404s on any other brand's Worker via
 * `requireHealthApi()`.
 *
 * THIN CLIENT — the rule this whole module exists to protect:
 *
 *   Nutrition figures are NEVER computed on the device.
 *
 * `base_*_per_100` is the exact basis, and every serving, recipe total,
 * per-serving figure and scaled quantity is DERIVED from it server-side (see
 * `HealthFoodService`). Re-deriving any of them here would drift from the
 * server's rounding and show the user a number the Worker disagrees with — the
 * exact bug class the per-100 basis was introduced to prevent.
 *
 * Envelopes mirror `backend/src/routes/health-food.ts` EXACTLY — change both
 * together.
 */

/* ============================ Row shapes ============================ */

export type HealthFoodMealType = HealthMealType;

/** Donor `TimeOfDay` — 05–11 morning, 11–14 midday, 14–17 afternoon, 17–21 evening, else night. */
export type HealthTimeOfDay = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';

export type HealthFoodSourceType = 'manual' | 'scanned' | 'imported' | 'shared' | 'recipe';

export type HealthSuggestionReason =
  | 'favorite'
  | 'frequently_used'
  | 'recently_used'
  | 'meal_type_match'
  | 'time_based_match';

/** A serving's macros, always as the SERVER derived them. */
export interface HealthMacros {
  calories: number;
  proteins: number;
  carbohydrates: number;
  fats: number;
}

/** The exact per-100 basis every portion is derived from (server-owned). */
export interface HealthMacroBasis {
  base_calories_per_100: number;
  base_proteins_per_100: number;
  base_carbs_per_100: number;
  base_fats_per_100: number;
}

export interface HealthCustomFood extends HealthMacros, HealthMacroBasis {
  id: string;
  user_id: string;
  name: string;
  brand_name: string | null;
  portion: number;
  unit: string;
  category: string | null;
  barcode: string | null;
  is_favorite: boolean;
  use_count: number;
  last_used_at: string | null;
  /** JSON array of meal slots, as D1 stores it. */
  preferred_meal_types: string;
  source_type: HealthFoodSourceType | string;
  source_recipe_id: string | null;
  is_shared: boolean;
  share_code: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** A `/foods/search` hit — the stored row plus the server's relevance score. */
export interface HealthFoodSearchHit extends HealthCustomFood {
  relevance_score: number;
}

/* ---------------- external food database (parity phase P3) --------------- */

/** The only provider today; the wire keeps the field so a second one is additive. */
export type HealthFoodProviderId = 'fatsecret';

/**
 * What the Worker's ONE external-provider chokepoint did, as a word the client
 * turns into copy. There is no error string on this path by construction —
 * `backend/src/services/health-food-provider.ts` never returns one.
 *
 *  - `ok`             the database answered (possibly with nothing).
 *  - `not_configured` this deploy has no provider credential at all.
 *  - `rate_limited`   the provider is throttling; try again shortly.
 *  - `unavailable`    outage, timeout, or a credential the provider refused.
 *  - `skipped`        the caller asked not to query it.
 */
export type HealthFoodProviderStatus =
  | 'ok'
  | 'not_configured'
  | 'rate_limited'
  | 'unavailable'
  | 'skipped';

export interface HealthFoodProvider {
  id: HealthFoodProviderId;
  configured: boolean;
  status: HealthFoodProviderStatus;
}

/**
 * One of the provider's declared servings, already mapped onto our own
 * vocabulary and per-100 basis by the Worker.
 */
export interface HealthExternalServing extends HealthMacros, HealthMacroBasis {
  serving_id: string;
  /** Human label ("1 cup (240 g)") — rendered, never parsed. */
  description: string;
  portion: number;
  unit: string;
  /** False ⇒ the provider gave no mass/volume, so `unit` is `serving`. */
  is_metric: boolean;
}

/**
 * A food-database result. NOT a `HealthCustomFood`: it has no row of its own
 * until `importExternalFood` gives it one, so it carries none of the verbs a
 * library food has (favourite, edit, delete, log). `id` is namespaced
 * (`fatsecret:12345`) and can never collide with a `cf_…` row id.
 */
export interface HealthExternalFood extends HealthMacros, HealthMacroBasis {
  id: string;
  provider: HealthFoodProviderId;
  provider_food_id: string;
  name: string;
  brand_name: string | null;
  /** The PREFERRED serving's size — a metric one when the provider had one. */
  portion: number;
  unit: string;
  serving_id: string | null;
  serving_description: string | null;
  servings: HealthExternalServing[];
}

/**
 * `/foods/search`. Two arrays on purpose (see the route's header): `results` is
 * the user's OWN library, unchanged since P2, and `external` rides alongside so
 * a provider outage can never change the shape of the library half.
 */
export interface HealthFoodSearchResponse {
  results: HealthFoodSearchHit[];
  external: HealthExternalFood[];
  query: string;
  sources: string[];
  provider: HealthFoodProvider;
}

/**
 * `/foods/barcode`. ALWAYS 200 except a code with zero digits (400) — see
 * `backend/src/routes/health-food.ts`. `food: null` with `provider.status ===
 * 'ok'` is "a well-formed code the provider does not recognise", a different
 * fact from `not_configured` / `rate_limited` / `unavailable` ("we could not
 * ask"), so the two must never be collapsed into one generic failure.
 */
export interface HealthBarcodeLookupResponse {
  /** The normalised GTIN-13 actually sent to the provider (padded from UPC-A). */
  barcode: string;
  food: HealthExternalFood | null;
  provider: HealthFoodProvider;
}

/** An ingredient AFTER the server resolved its basis and derived its macros. */
export interface HealthRecipeIngredient extends HealthMacros, HealthMacroBasis {
  name: string;
  quantity: number;
  unit: string;
  food_id: string | null;
}

export interface HealthRecipe {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  /** JSON array of resolved ingredients, as D1 stores it. */
  ingredients: string;
  servings: number;
  total_calories: number;
  total_proteins: number;
  total_carbohydrates: number;
  total_fats: number;
  preparation_time: number | null;
  cooking_time: number | null;
  instructions: string | null;
  image_url: string | null;
  category: string | null;
  /** JSON array of tags, as D1 stores it. */
  tags: string;
  is_favorite: boolean;
  use_count: number;
  last_used_at: string | null;
  is_shared: boolean;
  share_code: string | null;
  ai_calculated: boolean;
  ai_confidence: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * `/recipes/:id/scale` — read-only. The stored recipe stays the canonical
 * one-batch definition, so `per_serving` is invariant and only `totals` and the
 * ingredient quantities move with `target_servings`.
 */
export interface HealthScaledRecipe {
  recipe_id: string;
  name: string;
  servings: number;
  target_servings: number;
  per_serving: HealthMacros;
  totals: HealthMacros;
  ingredients: HealthRecipeIngredient[];
}

export interface HealthFoodUsage {
  id: string;
  user_id: string;
  food_id: string;
  food_name: string;
  used_at: string;
  meal_type: HealthFoodMealType;
  time_of_day: HealthTimeOfDay;
}

export interface HealthFoodSuggestion {
  food: HealthCustomFood;
  /** 0–1, server-weighted. */
  score: number;
  reasons: HealthSuggestionReason[];
}

export interface HealthFoodSuggestions {
  time_of_day: HealthTimeOfDay;
  meal_type: HealthFoodMealType;
  suggestions: HealthFoodSuggestion[];
}

/* ============================== Payloads ============================= */

/**
 * A food as the client declares it: a portion and the macros FOR that portion.
 * The per-100 basis is derived server-side from the pair — sending
 * `base_*_per_100` from the device is possible but deliberately unused, because
 * computing it here is the recompute-on-device trap.
 */
export interface HealthCustomFoodPayload {
  name: string;
  brand_name?: string | null;
  portion?: number;
  unit?: string;
  calories?: number;
  proteins?: number;
  carbohydrates?: number;
  fats?: number;
  category?: string | null;
  barcode?: string | null;
  is_favorite?: boolean;
  preferred_meal_types?: HealthFoodMealType[];
  source_type?: HealthFoodSourceType;
}

/** An ingredient as the client declares it — quantity plus which food it is. */
export interface HealthRecipeIngredientPayload {
  name: string;
  quantity: number;
  unit?: string;
  /** Points at one of the user's own foods; that food's stored basis wins. */
  food_id?: string;
}

export interface HealthRecipePayload {
  name: string;
  ingredients: HealthRecipeIngredientPayload[];
  description?: string | null;
  servings?: number;
  preparation_time?: number | null;
  cooking_time?: number | null;
  instructions?: string | null;
  /** Proxied file path (`/health/files/<id>/content`) — not a public URL. */
  image_url?: string | null;
  category?: string | null;
  tags?: string[];
  is_favorite?: boolean;
}

/* ============================== Client =============================== */

const BASE = '/health';

/**
 * Resolve the payload out of an api-client response.
 *
 * `api.*` types every body as `ApiResponse<T>` (`{ data }`), but the Health
 * Worker answers with the bare object — `c.json({ foods })`, no envelope
 * (`backend/src/routes/health-food.ts`). Reading both shapes keeps the screens
 * working against the deployed Worker today and survives an envelope being
 * introduced later, instead of silently rendering an empty library either way.
 *
 * Applied by every method below, so callers get the PAYLOAD, not the envelope.
 */
export function healthFoodPayload<T>(res: ApiResponse<T> | undefined | null): T | undefined {
  // LEGACY. No longer on any request path: `healthFoodApi` calls `apiClient`
  // directly, so the body IS the payload (see src/api/__tests__/healthEnvelope.test.ts
  // for why accepting both shapes was hiding the real contract). Retained only
  // because it is independently unit-tested; delete both together.
  if (res === undefined || res === null) return undefined;
  const envelope = res as ApiResponse<T>;
  if (envelope.data !== undefined && envelope.data !== null) return envelope.data;
  // Bare body: `{ foods: [...] }` is itself the payload.
  if (envelope.error !== undefined) return undefined;
  return res as unknown as T;
}

export const healthFoodApi = {
  // ---- custom foods (the user's own library) ----
  listCustomFoods: (params?: {
    search?: string;
    favorites?: boolean;
    most_used?: boolean;
    limit?: number;
  }) =>
    apiClient
      .get<{ foods: HealthCustomFood[] }>(`${BASE}/custom-foods`, { params })
      .then((r) => r.data),

  createCustomFood: (body: HealthCustomFoodPayload) =>
    apiClient
      .post<{ food: HealthCustomFood }>(`${BASE}/custom-foods`, body).then((r) => r.data),

  updateCustomFood: (id: string, body: Partial<HealthCustomFoodPayload>) =>
    apiClient
      .put<{ food: HealthCustomFood }>(`${BASE}/custom-foods/${id}`, body).then((r) => r.data),

  /** Soft delete — the tombstone is what lets another device drop its copy. */
  deleteCustomFood: (id: string) =>
    apiClient
      .delete<{ deleted: boolean }>(`${BASE}/custom-foods/${id}`).then((r) => r.data),

  /**
   * Log a use. Bumps `use_count`, stamps `last_used_at`, appends the usage row
   * `/foods/suggestions` reads — and answers with `logged`, the serving DERIVED
   * from the stored basis. That returned figure is what goes in the diary; the
   * device never multiplies a portion out itself.
   */
  useCustomFood: (
    id: string,
    body: { meal_type?: HealthFoodMealType; used_at?: string; portion?: number } = {}
  ) =>
    apiClient
      .post<{ food: HealthCustomFood; logged: HealthMacros; usage: HealthFoodUsage }>(
        `${BASE}/custom-foods/${id}/use`,
        body
      )
      .then((r) => r.data),

  // ---- search + suggestions ----
  /**
   * Relevance-ranked search over the user's own library, TOPPED UP from the
   * external food database (parity phase P3).
   *
   * The route reads `query` (not `q`) and 400s on anything shorter than two
   * characters — callers must not send a 1-character needle.
   *
   * The provider call happens inside the Worker; the device never holds a
   * FatSecret credential and never talks to FatSecret. A missing credential, a
   * rate limit or an outage does NOT fail this request — `results` still answers
   * from the library and `provider.status` says what happened.
   */
  searchFoods: (query: string, params?: { limit?: number; include_external?: boolean }) =>
    apiClient
      .get<HealthFoodSearchResponse>(`${BASE}/foods/search`, {
        params: {
          query,
          ...(params?.limit === undefined ? {} : { limit: params.limit }),
          // Only sent when suppressing — the route defaults to including it.
          ...(params?.include_external === false ? { include_external: 'false' } : {}),
        },
      })
      .then((r) => r.data),

  /**
   * Capability probe. Answers without calling the provider, so a screen can
   * explain the state of the feature before the user types anything.
   */
  foodProvider: () =>
    apiClient.get<{ provider: HealthFoodProvider }>(`${BASE}/foods/provider`).then((r) => r.data),

  /**
   * A packaged food, by the barcode printed on it (donor parity P5). `code`
   * is sent as-is — the Worker normalises to GTIN-13 and pads a 12-digit
   * UPC-A itself, so nothing here needs to know that rule.
   */
  lookupBarcode: (code: string) =>
    apiClient
      .get<HealthBarcodeLookupResponse>(`${BASE}/foods/barcode`, { params: { code } })
      .then((r) => r.data),

  /**
   * Keep an external hit as a real `custom_foods` row the user owns.
   *
   * Only the provider's id and the chosen serving go up — the Worker re-fetches
   * the food and derives the stored basis itself, so a client can never inject
   * macros under a provider's name. Answers 201 with `created: true` on a fresh
   * import and 200 with `created: false` when the user already had it (a repeat
   * import never overwrites a row they may since have corrected).
   */
  importExternalFood: (body: {
    provider_food_id: string;
    provider?: HealthFoodProviderId;
    serving_id?: string;
    is_favorite?: boolean;
    preferred_meal_types?: HealthFoodMealType[];
  }) =>
    apiClient
      .post<{ food: HealthCustomFood; created: boolean }>(`${BASE}/foods/import`, body)
      .then((r) => r.data),

  /** Donor "what you usually eat at this time of day". */
  foodSuggestions: (params?: {
    meal_type?: HealthFoodMealType;
    /** The CLIENT's own wall clock — the server has no user timezone. */
    at?: string;
    limit?: number;
  }) => apiClient
      .get<HealthFoodSuggestions>(`${BASE}/foods/suggestions`, { params }).then((r) => r.data),

  // ---- recipes ----
  listRecipes: (params?: {
    search?: string;
    favorites?: boolean;
    category?: string;
    limit?: number;
  }) => apiClient
      .get<{ recipes: HealthRecipe[] }>(`${BASE}/recipes`, { params }).then((r) => r.data),

  createRecipe: (body: HealthRecipePayload) =>
    apiClient
      .post<{ recipe: HealthRecipe }>(`${BASE}/recipes`, body).then((r) => r.data),

  updateRecipe: (id: string, body: Partial<HealthRecipePayload>) =>
    apiClient
      .put<{ recipe: HealthRecipe }>(`${BASE}/recipes/${id}`, body).then((r) => r.data),

  deleteRecipe: (id: string) =>
    apiClient
      .delete<{ deleted: boolean }>(`${BASE}/recipes/${id}`).then((r) => r.data),

  /**
   * Cook the same recipe for a different head count. Nothing is written, and
   * both `per_serving` and `totals` come back computed — scaling twice never
   * compounds because the server always works from the stored totals.
   */
  scaleRecipe: (id: string, servings: number) =>
    apiClient
      .post<{ scaled: HealthScaledRecipe }>(`${BASE}/recipes/${id}/scale`, { servings })
      .then((r) => r.data),
};

export default healthFoodApi;
