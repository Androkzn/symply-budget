import type { Env } from '../types';

import { basisFrom, round2, validateBasis, type MacroBasis, type Macros } from './health-food-service';

/**
 * Symply Health — the EXTERNAL food-database chokepoint (parity phase P3).
 *
 * Ported from the donor's FatSecret integration, which lived in two places:
 * `backend/src/routes/foodSearch.ts` (the top-up inside smart search) and
 * `backend/src/routes/integrations.ts` (the raw `foods.search.v4` /
 * `food.get.v4` / barcode passthroughs). Both minted an OAuth 2.0
 * client-credentials token and called `platform.fatsecret.com` directly from
 * the handler.
 *
 * THIS MODULE IS THE ONLY PLACE IN THE WORKER THAT TALKS TO A FOOD PROVIDER,
 * exactly as `ai/provider.ts` is the only place that talks to a model vendor.
 * Routes never see a credential, a URL or a provider payload — they get the
 * mapped `ExternalFood` shape and a `FoodProviderStatus`, and nothing else.
 *
 * THE DEVICE NEVER HOLDS A FATSECRET CREDENTIAL. `FATSECRET_CLIENT_ID` /
 * `FATSECRET_CLIENT_SECRET` are Worker secrets (`wrangler secret put`, see
 * documents/apps/symply-health/features/food-database.md); there is no client
 * flow and no token is ever returned to the app.
 *
 * ============================ FAIL CLOSED ==================================
 *
 * Every failure resolves to a STATUS, never a throw and never a raw provider
 * string:
 *
 *   `not_configured`  the secrets are absent — the deploy simply has no
 *                     provider. The library search still answers.
 *   `rate_limited`    HTTP 429, or FatSecret's own error code 13/14 quota
 *                     replies. A 60 s cooldown is written to KV so a screen
 *                     that keeps typing cannot keep hammering a limited key.
 *   `unavailable`     anything else: 5xx, a timeout, a bad credential, a body
 *                     we cannot parse, or FatSecret's IP-allowlist rejection.
 *   `skipped`         the caller asked not to query the provider.
 *
 * The caller renders copy for the status. No provider message, no HTTP status
 * and no exception text ever reaches the UI (repo rule: no raw error leaks).
 *
 * `not_configured` IS THE STATE THIS SHIPS IN: `FATSECRET_CLIENT_ID` /
 * `FATSECRET_CLIENT_SECRET` are not set on any Health deploy yet. Search, food
 * lookup and BARCODE lookup all answer that status today, and every screen that
 * uses them has to read as a feature that is switched off rather than as a
 * feature that is broken.
 *
 * ============================ CACHING ======================================
 *
 * CONFIG_KV, not a D1 table. An external food search is slow (250–900 ms),
 * rate-limited per key per day, and the same handful of queries repeat
 * constantly across every user of the fleet — which is exactly the shape KV is
 * for: read-mostly, TTL-native, globally replicated, and shared across users
 * because a provider's answer for "oats" is not personal data. A D1 table would
 * mean a migration, a sweeper for expiry, a write on every miss, and per-Worker
 * (not per-colo) locality — all cost for a cache whose contents we are happy to
 * lose. The one thing that IS per-user — the food the user chose to keep — goes
 * to D1 as a real `custom_foods` row (`importExternalFood`), which is what makes
 * the app keep working offline afterwards.
 *
 * The OAuth token is deliberately NOT in KV. It is a bearer credential, and
 * CONFIG_KV otherwise holds only non-secret feature flags; an isolate-global
 * cache (the donor's own approach) costs at most one token grant per isolate
 * per day, and the search cache above already collapses the call volume that
 * would make that matter.
 */

/* ==================================================================== */
/* Contract                                                              */
/* ==================================================================== */

/** The only provider today. Kept as a value so a second one is an addition. */
export const EXTERNAL_FOOD_PROVIDER = 'fatsecret';
export type ExternalFoodProviderId = typeof EXTERNAL_FOOD_PROVIDER;

export type FoodProviderStatus =
  | 'ok'
  | 'not_configured'
  | 'rate_limited'
  | 'unavailable'
  | 'skipped';

/** One of the provider's declared servings, mapped onto our own vocabulary. */
export interface ExternalServing extends MacroBasis, Macros {
  /** Provider's serving id; synthesised as the index when it omits one. */
  serving_id: string;
  /** Human label, e.g. "1 cup (240 g)" — shown, never parsed. */
  description: string;
  portion: number;
  unit: string;
  /**
   * True when the provider gave a real mass/volume for this serving. A false
   * here is what makes `unit: 'serving'` honest instead of a fake gram figure.
   */
  is_metric: boolean;
}

/**
 * A provider food, in the same vocabulary a `custom_foods` row uses. The
 * top-level portion/serving/basis are the PREFERRED serving's — see
 * `pickPreferredServing`.
 */
export interface ExternalFood extends MacroBasis, Macros {
  /** Namespaced so it can never collide with a `cf_…` row id. */
  id: string;
  provider: ExternalFoodProviderId;
  provider_food_id: string;
  name: string;
  brand_name: string | null;
  portion: number;
  unit: string;
  serving_id: string | null;
  serving_description: string | null;
  servings: ExternalServing[];
}

export interface ExternalFoodSearchResult {
  status: FoodProviderStatus;
  foods: ExternalFood[];
  /** True when the answer came from CONFIG_KV rather than the provider. */
  cached: boolean;
}

export interface ExternalFoodLookupResult {
  status: FoodProviderStatus;
  food: ExternalFood | null;
  cached: boolean;
}

/**
 * A barcode lookup. `barcode` is the GTIN-13 that was actually SENT, not what
 * the caller typed — a 12-digit UPC-A is padded before the provider sees it, and
 * echoing the padded form back is what lets a screen show why "0" appeared.
 *
 * `status: 'ok'` with `food: null` is a real answer: the code is well-formed and
 * the provider does not know it. That is different from `unavailable`, and the
 * two must not be collapsed — one means "not in the database", the other means
 * "we could not ask".
 */
export interface ExternalFoodBarcodeResult extends ExternalFoodLookupResult {
  barcode: string;
}

/* ==================================================================== */
/* Tunables                                                              */
/* ==================================================================== */

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
const API_URL = 'https://platform.fatsecret.com/rest/server.api';

/**
 * `basic` only, for search and `food.get`. The donor asked for
 * `basic premier barcode` on EVERY grant; `premier` is dropped because nothing
 * here calls a premier method, and FatSecret refuses the WHOLE grant when the
 * account does not hold a requested scope — so asking for scopes we do not use
 * turns a working key into `unavailable`.
 */
const TOKEN_SCOPE = 'basic';

/**
 * The barcode scope, requested ONLY for `food.find_id_for_barcode.v2`.
 *
 * THIS IS THE WHOLE REASON TOKENS ARE CACHED PER SCOPE rather than once per
 * isolate. `barcode` is a separately-licensed FatSecret entitlement: an account
 * that holds `basic` but not `barcode` gets its token grant REFUSED outright
 * when both are asked for. Minting one token with `basic barcode` and using it
 * everywhere would therefore take a working food SEARCH offline the moment
 * anyone typed a barcode — a strictly worse outcome than the barcode feature
 * simply reporting `unavailable` on its own.
 *
 * So: search keeps its `basic` token, barcode asks for its own, and a barcode
 * grant that fails is contained to the barcode path.
 */
const BARCODE_TOKEN_SCOPE = 'basic barcode';

/** A food search must never hold a request open. 8 s, then `unavailable`. */
export const PROVIDER_TIMEOUT_MS = 8_000;

/** Search answers: a food's macros do not move day to day. */
export const SEARCH_CACHE_TTL_SECONDS = 86_400; // 24 h
/** A specific food by id is effectively static. */
export const FOOD_CACHE_TTL_SECONDS = 604_800; // 7 d
/**
 * A barcode→food_id mapping is a property of the PACKAGE, so it is the most
 * static thing this module caches. A MISS is cached too (as an empty string) and
 * for the same length: a code the provider does not know is overwhelmingly
 * likely to be a local/store-brand product it will never know, and re-asking on
 * every scan of the same tin spends quota to be told the same thing.
 */
export const BARCODE_CACHE_TTL_SECONDS = 604_800; // 7 d
/** Circuit breaker after a 429. KV's floor is 60 s, which is also enough. */
export const RATE_LIMIT_COOLDOWN_SECONDS = 60;

/**
 * Cache-key namespace; `v1` so a mapping change can invalidate everything.
 * Exported so a test can sweep every key this module owns without guessing.
 */
export const FOOD_PROVIDER_KV_PREFIX = 'health:foodprovider:fatsecret:v1';
const KV_PREFIX = FOOD_PROVIDER_KV_PREFIX;
export const RATE_LIMIT_COOLDOWN_KEY = `${KV_PREFIX}:cooldown`;

/** Longest needle we will send (and therefore key a cache entry on). */
export const MAX_QUERY_LENGTH = 100;

/**
 * FatSecret answers HTTP 200 with `{ error: { code, message } }` for most
 * application-level failures. 12/13/14 are the quota/throttle family; anything
 * else (21 = IP not allow-listed, 5 = invalid token, …) is `unavailable`.
 */
const RATE_LIMIT_ERROR_CODES = new Set([12, 13, 14]);

/* ==================================================================== */
/* Pure mapping — exported for tests                                     */
/* ==================================================================== */

/** FatSecret sends every number as a string, and omits keys freely. */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `servings.serving` is an ARRAY for a multi-serving food and a bare OBJECT
 * for a single-serving one. The donor hit this and so do we. */
export function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function trimmedOrNull(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length === 0 ? null : text.slice(0, max);
}

/**
 * Map one provider serving.
 *
 * THE BUG THIS FIXES, relative to the donor: `foodSearch.ts` computed
 * `base_calories_per_100 = calories * 100 / (metric_serving_amount || 100)`.
 * When FatSecret gives no metric amount — very common for "1 slice", "1 large
 * egg", every restaurant item — that fallback silently declares the serving to
 * be 100 g, so a 78 kcal egg was stored as 78 kcal/100 g and every re-portion
 * afterwards was wrong. Here a serving with no metric amount keeps
 * `unit: 'serving'` and its basis is per-100-OF-THAT-UNIT via the platform's own
 * `basisFrom`, which is the convention `health-food-service` already documents
 * and the only one under which `portionFrom(basisFrom(x, p), p) === x` holds for
 * a non-mass unit.
 *
 * Returns `null` for a serving with no usable energy figure — a row with 0 kcal
 * and no macros is not a food, it is a parsing failure.
 */
export function mapServing(raw: unknown, index: number): ExternalServing | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;

  const macros: Macros = {
    calories: round2(toNumber(row.calories)),
    proteins: round2(toNumber(row.protein)),
    carbohydrates: round2(toNumber(row.carbohydrate)),
    fats: round2(toNumber(row.fat)),
  };
  if (macros.calories <= 0 && macros.proteins <= 0 && macros.carbohydrates <= 0 && macros.fats <= 0) {
    return null;
  }

  const metricAmount = toNumber(row.metric_serving_amount);
  const metricUnit = trimmedOrNull(row.metric_serving_unit, 10);
  const isMetric = metricAmount > 0 && metricUnit !== null;

  // Non-metric: the provider's own `number_of_units` ("2" of "2 cookies"), or
  // one serving. Never invented as grams.
  const portion = isMetric ? metricAmount : Math.max(toNumber(row.number_of_units, 1), 0.01);
  const unit = isMetric ? (metricUnit as string) : 'serving';

  const description =
    trimmedOrNull(row.serving_description, 120) ??
    trimmedOrNull(row.measurement_description, 120) ??
    `${round2(portion)} ${unit}`;

  return {
    serving_id: trimmedOrNull(row.serving_id, 80) ?? `idx_${index}`,
    description,
    portion: round2(portion),
    unit,
    is_metric: isMetric,
    ...macros,
    ...basisFrom(macros, portion),
  };
}

/**
 * Which serving becomes the food's headline figures.
 *
 * The donor took `servings.serving[0]` blindly. A metric serving is preferred
 * here because a gram basis is the one the whole re-portioning surface works in
 * — and because `[0]` is frequently "1 container" for a packaged food, which
 * makes the row read as though 1 tub of yoghurt were the normal portion.
 * Falls back to the first serving, which is the donor's behaviour.
 */
export function pickPreferredServing(servings: ExternalServing[]): ExternalServing | null {
  if (servings.length === 0) return null;
  return servings.find((s) => s.is_metric) ?? servings[0];
}

/**
 * Can this serving become a `custom_foods` row on THIS platform?
 *
 * `validateBasis` is the same gate `createCustomFood` applies, and its ceilings
 * (1000 kcal, 100 g of any macro, 110 g of macros in total, all "per 100") are
 * GRAM-SEMANTIC. That has a consequence worth stating out loud rather than
 * discovering as a mysteriously missing search result:
 *
 *   A NON-METRIC SERVING ESSENTIALLY NEVER PASSES. "1 large egg, 78 kcal" has a
 *   basis of 7800 kcal per 100 *eggs*, which is arithmetically correct and 7.8×
 *   the ceiling. So a FatSecret serving with no `metric_serving_amount` is
 *   filtered out here, and a food left with no serving at all is dropped.
 *
 * This is a PLATFORM bound, not a provider one, and it is pre-existing: typing
 * "1 serving / 78 kcal" by hand into `POST /custom-foods` is refused for exactly
 * the same reason. Widening it means changing `validateBasis` to know about
 * units, which is a change to the shared portion contract and is deliberately
 * not smuggled in here. In practice FatSecret publishes a metric amount for the
 * overwhelming majority of foods, so what this drops is the tail.
 */
export function isImportableServing(serving: ExternalServing): boolean {
  return validateBasis(serving).length === 0;
}

/**
 * Map one `foods_search.results.food[]` / `food` entry.
 *
 * Returns `null` when the entry is unusable: no id, no name, no serving we can
 * read, or a basis that fails the platform's own physical-plausibility check
 * (`validateBasis`, the donor's `isValidNutrition` in a shared form). Filtering
 * here rather than in the route is deliberate — a corrupted provider row must
 * never reach a screen, and must never be importable into a user's library
 * where it would poison every portion derived from it afterwards.
 */
export function mapFatSecretFood(raw: unknown): ExternalFood | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;

  const providerFoodId = trimmedOrNull(row.food_id, 80);
  const name = trimmedOrNull(row.food_name, 120);
  if (!providerFoodId || !name) return null;

  const rawServings = asArray((row.servings as Record<string, unknown> | undefined)?.serving);
  const servings = rawServings
    .map((serving, index) => mapServing(serving, index))
    .filter((serving): serving is ExternalServing => serving !== null)
    .filter(isImportableServing);

  const preferred = pickPreferredServing(servings);
  if (!preferred) return null;

  return {
    id: `${EXTERNAL_FOOD_PROVIDER}:${providerFoodId}`,
    provider: EXTERNAL_FOOD_PROVIDER,
    provider_food_id: providerFoodId,
    name,
    brand_name: trimmedOrNull(row.brand_name, 80),
    portion: preferred.portion,
    unit: preferred.unit,
    serving_id: preferred.serving_id,
    serving_description: preferred.description,
    calories: preferred.calories,
    proteins: preferred.proteins,
    carbohydrates: preferred.carbohydrates,
    fats: preferred.fats,
    base_calories_per_100: preferred.base_calories_per_100,
    base_proteins_per_100: preferred.base_proteins_per_100,
    base_carbs_per_100: preferred.base_carbs_per_100,
    base_fats_per_100: preferred.base_fats_per_100,
    servings,
  };
}

/** Every list shape FatSecret has answered `foods.search.v4` with. */
export function mapSearchPayload(payload: unknown): ExternalFood[] {
  const body = (payload ?? {}) as Record<string, unknown>;
  const search = (body.foods_search ?? body.foods) as Record<string, unknown> | undefined;
  const results = (search?.results ?? search) as Record<string, unknown> | undefined;
  return asArray(results?.food)
    .map(mapFatSecretFood)
    .filter((food): food is ExternalFood => food !== null);
}

/** `food.get.v4` answers `{ food: {...} }` with the same entry shape. */
export function mapFoodPayload(payload: unknown): ExternalFood | null {
  const body = (payload ?? {}) as Record<string, unknown>;
  return mapFatSecretFood(body.food);
}

/**
 * Read the food id out of a `food.find_id_for_barcode.v2` answer.
 *
 * The documented shape is `{ food_id: { value: "1234" } }`, but the same call
 * has been observed answering with a bare `{ food_id: "1234" }`, and a MISS is
 * a 200 with no id rather than an error — so "not found" and "found" arrive
 * down the same channel and both have to be read here.
 *
 * `'0'` is FatSecret's own sentinel for "no match" and is treated as a miss;
 * returning it would send us off to `food.get.v4` for a food that does not
 * exist. Returns `''` for every miss, which is also the cached-miss marker.
 */
export function readBarcodeFoodId(payload: unknown): string {
  const body = (payload ?? {}) as Record<string, unknown>;
  const raw = body.food_id;
  const value =
    raw !== null && typeof raw === 'object'
      ? (raw as { value?: unknown }).value
      : raw;
  const id = trimmedOrNull(typeof value === 'number' ? String(value) : value, 80);
  if (id === null || id === '0') return '';
  return id;
}

/** The needle as it is sent AND as it is keyed — one normalisation, not two. */
export function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
}

/* ==================================================================== */
/* Barcodes                                                              */
/* ==================================================================== */

/**
 * Expand a UPC-E (compressed, 6 payload digits) to its UPC-A (11 payload +
 * check) form, per the GS1 zero-suppression table.
 *
 * `digits` is the 8-character UPC-E including the leading number system and the
 * trailing check digit — the form a scanner and a printed barcode both use.
 * Returns null when it is not a UPC-E we can expand (a non-zero number system;
 * GS1 only defines suppression for system 0 and 1).
 */
export function expandUpcE(digits: string): string | null {
  if (!/^\d{8}$/.test(digits)) return null;
  const system = digits[0];
  if (system !== '0' && system !== '1') return null;
  const body = digits.slice(1, 7);
  const check = digits[7];
  const last = body[5];

  let manufacturer: string;
  let product: string;
  switch (last) {
    case '0':
    case '1':
    case '2':
      manufacturer = `${body.slice(0, 2)}${last}00`;
      product = `00${body.slice(2, 5)}`;
      break;
    case '3':
      manufacturer = `${body.slice(0, 3)}00`;
      product = `000${body.slice(3, 5)}`;
      break;
    case '4':
      manufacturer = body.slice(0, 4);
      product = `0000${body[4]}`;
      break;
    default:
      // 5–9: the last digit IS the final product digit.
      manufacturer = body.slice(0, 5);
      product = `0000${last}`;
      break;
  }
  return `${system}${manufacturer}${product}${check}`;
}

/**
 * Normalise a scanned/typed code to the GTIN-13 the provider requires.
 *
 * `food.find_id_for_barcode.v2` accepts GTIN-13 ONLY. A 12-digit UPC-A sent
 * verbatim — which is what every North American tin, box and bottle carries —
 * comes back as "not found", so this is not a nicety: without the pad, barcode
 * lookup silently fails for a whole continent. The donor did this on the DEVICE
 * (`FatSecretSearchService.normalizeToGTIN13`); it belongs on the server, where
 * every client gets it and there is one copy of the rule.
 *
 * Returns null when there is nothing plausible to send — no digits, or more than
 * 14 of them. A refusal here is better than spending a provider call to be told
 * the same thing.
 */
export function normalizeGtin13(barcode: string): string | null {
  const digits = (typeof barcode === 'string' ? barcode : '').replace(/\D/g, '');
  if (digits.length === 0 || digits.length > 14) return null;

  // GTIN-14 (a shipping/case code) carries the retail GTIN-13 in its last 13.
  if (digits.length === 14) return digits.slice(1);
  if (digits.length === 13) return digits;
  if (digits.length === 8) {
    // Ambiguous by length: EAN-8 and UPC-E are both 8 digits. A UPC-E always
    // starts 0 or 1 and expands to a real UPC-A, so try that first and fall back
    // to treating it as an EAN-8.
    const expanded = expandUpcE(digits);
    if (expanded) return expanded.padStart(13, '0');
  }
  return digits.padStart(13, '0');
}

/**
 * A serving chosen by the caller, or the preferred one. Exported because the
 * import route's "which serving did the user pick" decision is a contract, not
 * an implementation detail.
 */
export function resolveServing(
  food: ExternalFood,
  servingId?: string | null
): ExternalServing | null {
  if (servingId) {
    const chosen = food.servings.find((serving) => serving.serving_id === servingId);
    if (chosen) return chosen;
  }
  return pickPreferredServing(food.servings);
}

/**
 * The size and BASIS an imported serving contributes to a `custom_foods` row.
 *
 * Deliberately does NOT carry the serving's own `calories`/`proteins`/… —
 * `HealthFoodService.importExternalFood` re-derives those from this basis with
 * `portionFrom` (rule 1), so the stored row can never disagree with the basis it
 * claims. Passing the provider's already-rounded figures through would be the
 * one place in this feature where a serving was copied rather than derived.
 */
export function importValuesFor(
  serving: ExternalServing
): MacroBasis & { portion: number; unit: string } {
  return {
    portion: serving.portion,
    unit: serving.unit,
    base_calories_per_100: serving.base_calories_per_100,
    base_proteins_per_100: serving.base_proteins_per_100,
    base_carbs_per_100: serving.base_carbs_per_100,
    base_fats_per_100: serving.base_fats_per_100,
  };
}

/* ==================================================================== */
/* Provider                                                              */
/* ==================================================================== */

/**
 * OAuth 2.0 client-credentials tokens, cached for the life of the isolate and
 * keyed BY SCOPE.
 *
 * Module-global on purpose (donor parity): a bearer credential is not written
 * to KV, and the search cache means a busy isolate mints one token a day.
 *
 * Keyed by scope because `basic` and `basic barcode` are different grants with
 * different failure modes — see `BARCODE_TOKEN_SCOPE`. One shared token would
 * make a missing barcode entitlement break search.
 *
 * Exported reset hook so a test starts from a known state.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Test-only: drop every cached token in this isolate. */
export function __resetFoodProviderTokenCache(): void {
  tokenCache.clear();
}

/** Thrown internally only; every public method converts it to a status. */
class ProviderFailure extends Error {
  constructor(readonly status: Exclude<FoodProviderStatus, 'ok' | 'skipped'>, reason: string) {
    super(reason);
    this.name = 'ProviderFailure';
  }
}

export class ExternalFoodProvider {
  constructor(private readonly env: Env) {}

  /** Capability check. False ⇒ this deploy simply has no external database. */
  isConfigured(): boolean {
    return (
      typeof this.env.FATSECRET_CLIENT_ID === 'string' &&
      this.env.FATSECRET_CLIENT_ID.length > 0 &&
      typeof this.env.FATSECRET_CLIENT_SECRET === 'string' &&
      this.env.FATSECRET_CLIENT_SECRET.length > 0
    );
  }

  /** The probe `/foods/provider` answers with — never calls out. */
  probe(): { id: ExternalFoodProviderId; configured: boolean; status: FoodProviderStatus } {
    const configured = this.isConfigured();
    return {
      id: EXTERNAL_FOOD_PROVIDER,
      configured,
      status: configured ? 'ok' : 'not_configured',
    };
  }

  async search(query: string, limit = 20): Promise<ExternalFoodSearchResult> {
    const needle = normalizeQuery(query);
    if (needle.length < 2) return { status: 'ok', foods: [], cached: false };
    if (!this.isConfigured()) return { status: 'not_configured', foods: [], cached: false };

    const max = Math.min(Math.max(Math.trunc(limit) || 20, 1), 50);
    const cacheKey = `${KV_PREFIX}:search:${max}:${needle}`;

    const cached = await this.readCache<ExternalFood[]>(cacheKey);
    if (cached) return { status: 'ok', foods: cached, cached: true };

    if (await this.inCooldown()) return { status: 'rate_limited', foods: [], cached: false };

    try {
      const payload = await this.call({
        method: 'foods.search.v4',
        search_expression: needle,
        max_results: String(max),
      });
      const foods = mapSearchPayload(payload);
      await this.writeCache(cacheKey, foods, SEARCH_CACHE_TTL_SECONDS);
      return { status: 'ok', foods, cached: false };
    } catch (error) {
      return { status: await this.statusFor(error), foods: [], cached: false };
    }
  }

  async getFood(providerFoodId: string): Promise<ExternalFoodLookupResult> {
    const id = providerFoodId.trim().slice(0, 80);
    if (id.length === 0) return { status: 'ok', food: null, cached: false };
    if (!this.isConfigured()) return { status: 'not_configured', food: null, cached: false };

    const cacheKey = `${KV_PREFIX}:food:${id}`;
    const cached = await this.readCache<ExternalFood>(cacheKey);
    if (cached) return { status: 'ok', food: cached, cached: true };

    if (await this.inCooldown()) return { status: 'rate_limited', food: null, cached: false };

    try {
      const payload = await this.call({ method: 'food.get.v4', food_id: id });
      const food = mapFoodPayload(payload);
      if (food) await this.writeCache(cacheKey, food, FOOD_CACHE_TTL_SECONDS);
      return { status: 'ok', food, cached: false };
    } catch (error) {
      return { status: await this.statusFor(error), food: null, cached: false };
    }
  }

  /**
   * A PACKAGED food, by the barcode printed on it (donor parity phase P5).
   *
   * Two provider steps, exactly as the donor's pair of passthroughs did:
   * `food.find_id_for_barcode.v2` answers `{ food_id: { value } }`, and that id
   * is then read through `getFood`, which is the SAME mapping, the SAME
   * `validateBasis` gate and the SAME 7-day cache every other food goes through.
   * There is no second parser and no second shape.
   *
   * WHAT EACH OUTCOME MEANS, because the screen renders different copy for each:
   *
   *  - `not_configured` — no FatSecret secret on this deploy. TRUE TODAY: the
   *    credentials are not set, so this is the state barcode lookup actually
   *    ships in, and it degrades exactly as `search` does rather than erroring.
   *  - `ok` + `food: null` — a good code the database does not hold (store
   *    brands, local products, non-food). The user adds the item by hand.
   *  - `rate_limited` / `unavailable` — we could not ask. Never conflated with
   *    "not found", because the right next action differs.
   *
   * A code we cannot normalise never reaches the provider at all.
   */
  async lookupBarcode(barcode: string): Promise<ExternalFoodBarcodeResult> {
    const gtin = normalizeGtin13(barcode);
    if (gtin === null) return { status: 'ok', food: null, cached: false, barcode: '' };
    if (!this.isConfigured()) {
      return { status: 'not_configured', food: null, cached: false, barcode: gtin };
    }

    const cacheKey = `${KV_PREFIX}:barcode:${gtin}`;
    // '' is the cached MISS marker — a distinct value from "no cache entry", so
    // a known-absent code costs a KV read rather than a provider call.
    const cachedId = await this.readCache<string>(cacheKey);
    if (cachedId !== null) {
      if (cachedId === '') return { status: 'ok', food: null, cached: true, barcode: gtin };
      const hit = await this.getFood(cachedId);
      return { ...hit, barcode: gtin };
    }

    if (await this.inCooldown()) {
      return { status: 'rate_limited', food: null, cached: false, barcode: gtin };
    }

    let foodId: string;
    try {
      const payload = await this.call(
        { method: 'food.find_id_for_barcode.v2', barcode: gtin },
        BARCODE_TOKEN_SCOPE
      );
      foodId = readBarcodeFoodId(payload);
    } catch (error) {
      return { status: await this.statusFor(error), food: null, cached: false, barcode: gtin };
    }

    // Cache the MAPPING (including the miss) before resolving the food, so a
    // repeat scan skips this step whatever `getFood` then does.
    await this.writeCache(cacheKey, foodId, BARCODE_CACHE_TTL_SECONDS);
    if (foodId.length === 0) return { status: 'ok', food: null, cached: false, barcode: gtin };

    const lookup = await this.getFood(foodId);
    return { ...lookup, barcode: gtin };
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * One provider call. Throws `ProviderFailure` — never leaks a body, a URL or
   * a credential into the error, because the message is what would end up in a
   * log line beside a user id.
   */
  private async call(params: Record<string, string>, scope = TOKEN_SCOPE): Promise<unknown> {
    const token = await this.accessToken(scope);
    const query = new URLSearchParams({ format: 'json', ...params });

    let response: Response;
    try {
      response = await fetch(`${API_URL}?${query.toString()}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch {
      // Timeout, DNS, TLS — indistinguishable to the user, and all "try later".
      throw new ProviderFailure('unavailable', 'request failed');
    }

    if (response.status === 429) throw new ProviderFailure('rate_limited', 'http 429');
    if (!response.ok) {
      // A 401/403 here means the SECRET is wrong, not that it is missing —
      // `not_configured` would tell the user to set something that is already
      // set. Status only; the body is never read into the error.
      throw new ProviderFailure('unavailable', `http ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ProviderFailure('unavailable', 'unparseable body');
    }

    // FatSecret's application-level errors ride a 200.
    const providerError = (payload as { error?: { code?: unknown } } | null)?.error;
    if (providerError && typeof providerError === 'object') {
      const code = toNumber((providerError as { code?: unknown }).code, -1);
      if (RATE_LIMIT_ERROR_CODES.has(code)) {
        throw new ProviderFailure('rate_limited', `provider code ${code}`);
      }
      throw new ProviderFailure('unavailable', `provider code ${code}`);
    }

    return payload;
  }

  /** Client-credentials grant, cached per isolate PER SCOPE with a 60 s margin. */
  private async accessToken(scope = TOKEN_SCOPE): Promise<string> {
    const cached = tokenCache.get(scope);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const credentials = btoa(`${this.env.FATSECRET_CLIENT_ID}:${this.env.FATSECRET_CLIENT_SECRET}`);
    let response: Response;
    try {
      response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch {
      throw new ProviderFailure('unavailable', 'token request failed');
    }

    if (response.status === 429) throw new ProviderFailure('rate_limited', 'token http 429');
    if (!response.ok) throw new ProviderFailure('unavailable', `token http ${response.status}`);

    let body: { access_token?: unknown; expires_in?: unknown };
    try {
      body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    } catch {
      throw new ProviderFailure('unavailable', 'unparseable token body');
    }

    const token = typeof body.access_token === 'string' ? body.access_token : '';
    if (token.length === 0) throw new ProviderFailure('unavailable', 'token missing');

    const ttl = Math.max(toNumber(body.expires_in, 3600), 120);
    tokenCache.set(scope, { token, expiresAt: Date.now() + (ttl - 60) * 1000 });
    return token;
  }

  /**
   * Turn an internal failure into a status, and arm the cooldown on a 429 so
   * the next keystroke does not spend another unit of a spent quota.
   */
  private async statusFor(error: unknown): Promise<Exclude<FoodProviderStatus, 'ok' | 'skipped'>> {
    const status = error instanceof ProviderFailure ? error.status : 'unavailable';
    if (status === 'rate_limited') {
      // A cached token is not the problem, but a quota reset is not either —
      // dropping them costs one grant each and rules out a stale-token 429.
      tokenCache.clear();
      try {
        await this.env.CONFIG_KV.put(RATE_LIMIT_COOLDOWN_KEY, '1', {
          expirationTtl: RATE_LIMIT_COOLDOWN_SECONDS,
        });
      } catch {
        // A cache that cannot be written still leaves the status correct.
      }
    }
    return status;
  }

  private async inCooldown(): Promise<boolean> {
    try {
      return (await this.env.CONFIG_KV.get(RATE_LIMIT_COOLDOWN_KEY)) !== null;
    } catch {
      return false;
    }
  }

  /** A cache miss and a broken cache are the same thing to the caller. */
  private async readCache<T>(key: string): Promise<T | null> {
    try {
      return await this.env.CONFIG_KV.get<T>(key, 'json');
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, value: unknown, ttl: number): Promise<void> {
    try {
      await this.env.CONFIG_KV.put(key, JSON.stringify(value), { expirationTtl: ttl });
    } catch {
      // Never fail a search because the cache did.
    }
  }
}
