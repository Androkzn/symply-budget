import {
  healthFoodApi,
  type HealthCustomFood,
  type HealthCustomFoodPayload,
  type HealthExternalFood,
  type HealthExternalServing,
  type HealthFoodProviderId,
  type HealthFoodProviderStatus,
  type HealthMacros,
  type HealthRecipe,
  type HealthRecipeIngredient,
  type HealthRecipePayload,
  type HealthScaledRecipe,
  type HealthSuggestionReason,
  type HealthTimeOfDay,
} from '@api/healthFood';
import { storageHelpers } from '@services/storage';

import {
  uploadHealthPhoto,
  type HealthFileUploadRequest,
  type HealthFileWriteStatus,
} from './healthFilesStorage';
import { todayDateKey } from './healthLocalStorage';
import {
  addMealEntry,
  fromWireMealType,
  toWireMealType,
  type MealSlot,
} from './healthNutritionStorage';
import { healthSyncStateFor, readThrough, writeThrough } from './healthRepository';

/**
 * Symply Health — FOOD library and recipes (parity phase P2), plus the external
 * food database (parity phase P3).
 *
 * The record of truth is `/health/custom-foods`, `/health/foods/*` and
 * `/health/recipes` on the `symply-health-api` Worker; MMKV is an offline
 * read-through cache exactly as in every other Health store.
 *
 * THE FOOD DATABASE IS THE WORKER'S, NOT THE DEVICE'S. `searchFoods` asks the
 * Worker, which asks FatSecret through its one provider chokepoint; no
 * credential, no provider URL and no provider payload ever reaches this
 * process. A hit only becomes something the app can use offline once
 * `importExternalFood` has turned it into a real `custom_foods` row — which is
 * also what keeps `base_*_per_100` re-portioning applicable to it afterwards.
 *
 * THE RULE THIS MODULE PROTECTS: **nutrition is never computed on the device.**
 *
 * `base_*_per_100` is the exact basis and the Worker derives every serving,
 * recipe total, per-serving figure and scaled quantity from it. So:
 *
 *  - `fromWireFood` RENAMES the server's serving macros, it does not derive them;
 *  - a recipe's per-serving figure is fetched from `/recipes/:id/scale`, never
 *    obtained by dividing totals by servings here;
 *  - "log to today" writes the `logged` macros the `use` route answered with,
 *    plus the food id and portion so the DIARY row carries the same basis and
 *    can be re-portioned later (0124) instead of being frozen at what it was
 *    logged at;
 *  - creating a food sends the portion and the macros FOR that portion, and lets
 *    the Worker infer the per-100 basis.
 *
 * A locally recomputed figure that disagrees with the server is the exact bug
 * class the per-100 basis exists to prevent.
 */

export const HEALTH_FOODS_KEY = 'health.foods.v1';
export const HEALTH_RECIPES_KEY = 'health.recipes.v1';

/* ==================================================================== */
/* Screen shapes                                                         */
/* ==================================================================== */

/** Macros in the app's vocabulary; the wire spells them out (`proteins`, …). */
export interface FoodMacros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const ZERO_MACROS: FoodMacros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

export interface FoodItem {
  id: string;
  name: string;
  brand: string | null;
  portion: number;
  unit: string;
  /** Macros for `portion` `unit`, exactly as the server derived them. */
  serving: FoodMacros;
  isFavorite: boolean;
  useCount: number;
  lastUsedAt: string | null;
  updatedAt: string;
}

export interface RecipeIngredient {
  name: string;
  quantity: number;
  unit: string;
  /** Set when the ingredient points at one of the user's own foods. */
  foodId: string | null;
  /** Server-derived macros for `quantity` — not multiplied out here. */
  macros: FoodMacros;
}

export interface RecipeItem {
  id: string;
  name: string;
  description: string | null;
  servings: number;
  /** Server-computed totals for the whole batch. */
  totals: FoodMacros;
  ingredients: RecipeIngredient[];
  isFavorite: boolean;
  useCount: number;
  /** One of `RECIPE_CATEGORIES`, or a value from before that vocabulary existed. */
  category: string | null;
  /** Minutes, stored as-is — never summed with `cookingTime` here (see the row). */
  preparationTime: number | null;
  cookingTime: number | null;
  /** Proxied file path (`/health/files/<id>/content`); render via `healthFileContentSource`. */
  imageUrl: string | null;
  updatedAt: string;
}

/* ---------------- recipe categories (donor `FoodCategory`) --------------- */

/**
 * Mirrors the donor's `FoodCategory` enum (`CustomFood.swift`) — the SAME
 * vocabulary the donor's `Recipe.category` uses, not an invented one. The
 * route stores `category` as a free `z.string().max(40)`, so this is a
 * client-side controlled list rather than a server-enforced enum: an older
 * row (or a value written before this list existed) still round-trips, it
 * just will not match one of these chips.
 */
export const RECIPE_CATEGORIES = [
  { id: 'dairy', label: 'Dairy', icon: 'cafe-outline' },
  { id: 'meat', label: 'Meat', icon: 'restaurant-outline' },
  { id: 'fish', label: 'Fish', icon: 'fish-outline' },
  { id: 'seafood', label: 'Seafood', icon: 'fish-outline' },
  { id: 'vegetables', label: 'Vegetables', icon: 'leaf-outline' },
  { id: 'fruits', label: 'Fruits', icon: 'nutrition-outline' },
  { id: 'grains', label: 'Grains', icon: 'basket-outline' },
  { id: 'legumes', label: 'Legumes', icon: 'leaf-outline' },
  { id: 'nuts', label: 'Nuts', icon: 'ellipse-outline' },
  { id: 'beverages', label: 'Beverages', icon: 'wine-outline' },
  { id: 'snacks', label: 'Snacks', icon: 'fast-food-outline' },
  { id: 'desserts', label: 'Desserts', icon: 'ice-cream-outline' },
  { id: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle-outline' },
] as const;

export type RecipeCategoryId = (typeof RECIPE_CATEGORIES)[number]['id'];

/** Fallback placeholder glyph for a recipe with no photo and no category set. */
export const DEFAULT_RECIPE_ICON = 'restaurant-outline';

/** The chip's icon for a stored `category`, or the generic placeholder. */
export function recipeCategoryIcon(category: string | null | undefined): string {
  return RECIPE_CATEGORIES.find((c) => c.id === category)?.icon ?? DEFAULT_RECIPE_ICON;
}

/** The chip's label for a stored `category`, or `null` when it is unset/unknown. */
export function recipeCategoryLabel(category: string | null | undefined): string | null {
  return RECIPE_CATEGORIES.find((c) => c.id === category)?.label ?? null;
}

/**
 * `/recipes/:id/scale`. `perServing` is invariant (one serving is one serving);
 * `totals` and the ingredient quantities move with `targetServings`.
 */
export interface ScaledRecipe {
  recipeId: string;
  name: string;
  servings: number;
  targetServings: number;
  perServing: FoodMacros;
  totals: FoodMacros;
  ingredients: RecipeIngredient[];
}

export type FoodSuggestionReason = HealthSuggestionReason;

export interface FoodSuggestion {
  food: FoodItem;
  /** 0–1, weighted server-side. */
  score: number;
  reasons: FoodSuggestionReason[];
}

export interface FoodSuggestions {
  timeOfDay: HealthTimeOfDay;
  /** The slot the SERVER says this time of day belongs to. */
  mealSlot: MealSlot;
  suggestions: FoodSuggestion[];
}

export type FoodFilter = 'all' | 'favorites' | 'most-used';
export type RecipeFilter = 'all' | 'favorites';

/* ---------------- external food database (parity phase P3) --------------- */

export type FoodProviderStatus = HealthFoodProviderStatus;

/** One of the provider's servings, offered as a choice before importing. */
export interface ExternalFoodServingOption {
  id: string;
  /** The provider's own label ("1 cup (240 g)") — shown, never parsed. */
  description: string;
  portion: number;
  unit: string;
  /** False ⇒ no mass/volume was given, so `unit` is `serving`. */
  isMetric: boolean;
  /** Macros for this serving, as the WORKER derived them from the basis. */
  macros: FoodMacros;
}

/**
 * A food-database hit. Deliberately NOT a `FoodItem`: until it is imported it
 * has no row of its own, so it supports none of a library food's verbs and
 * carries no `useCount`, `isFavorite` or `updatedAt` to pretend otherwise.
 */
export interface ExternalFoodItem {
  /** Namespaced (`fatsecret:12345`); can never collide with a `cf_…` row id. */
  id: string;
  provider: HealthFoodProviderId;
  providerFoodId: string;
  name: string;
  brand: string | null;
  portion: number;
  unit: string;
  servingId: string | null;
  servingDescription: string | null;
  /** Macros for `portion` `unit`. */
  serving: FoodMacros;
  /** The per-100 basis, for the "x kcal / 100 g" line. Display only. */
  per100: FoodMacros;
  servings: ExternalFoodServingOption[];
}

/**
 * What one search produced. The two halves are kept apart all the way to the
 * screen: an outage in the food database must never change what the user's own
 * library looks like, and a row you can log is not the same thing as a row you
 * must first import.
 */
export interface FoodSearchOutcome {
  library: FoodItem[];
  external: ExternalFoodItem[];
  /**
   * Plain-language reason the food database is not contributing, or `null` when
   * it is (or was not asked). Never a status code, never a provider string.
   */
  providerNotice: string | null;
  /** True when the library half came from the offline cache. */
  offline: boolean;
}

/* ==================================================================== */
/* Bounds + input parsing                                                */
/* ==================================================================== */

/** Mirrors the route schema in backend/src/routes/health-food.ts. */
export const MAX_FOOD_NAME = 120;
export const MAX_FOOD_BRAND = 80;
export const MAX_FOOD_UNIT = 20;
export const MAX_SERVING_MACRO = 100000;
export const MAX_PORTION = 100000;
export const MAX_SERVINGS = 100;
export const MAX_INGREDIENTS = 100;
/** The route 400s a shorter needle — a 1-char query matches most of a library. */
export const MIN_FOOD_SEARCH_LENGTH = 2;

export const FOOD_UNITS = ['g', 'ml', 'piece', 'serving'] as const;
export type FoodUnit = (typeof FOOD_UNITS)[number];
export const DEFAULT_FOOD_UNIT: FoodUnit = 'g';

/**
 * Slot used only when the server has NOT told us which one this time of day
 * belongs to (offline first open). Never used to reinterpret a server answer.
 */
export const DEFAULT_MEAL_SLOT: MealSlot = 'snacks';

/**
 * Keep a numeric field numeric as it is typed. `keyboardType` only picks the
 * on-screen keyboard — paste, hardware keyboards and UI automation still deliver
 * letters (same reasoning as `sanitizeAmountInput` in the nutrition store).
 */
export function sanitizeDecimalInput(raw: string): string {
  if (typeof raw !== 'string') return '';
  const digitsAndSeparators = raw.replace(/[^0-9.,]/g, '');
  const firstSeparator = digitsAndSeparators.search(/[.,]/);
  if (firstSeparator === -1) return digitsAndSeparators;
  const head = digitsAndSeparators.slice(0, firstSeparator + 1);
  const tail = digitsAndSeparators.slice(firstSeparator + 1).replace(/[.,]/g, '');
  return head + tail;
}

/**
 * Parse a decimal amount. Blank → 0, invalid / negative / out-of-range → null.
 * Decimals are KEPT: 0.5 of a serving is a real portion, and rounding it here
 * would send the server a basis the user never typed.
 */
export function parseFoodAmount(raw: string, max = MAX_SERVING_MACRO): number | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().replace(',', '.');
  if (normalized.length === 0) return 0;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0 || value > max) return null;
  return value;
}

/** A portion divides into the per-100 basis server-side, so 0 is not allowed. */
export function parseFoodPortion(raw: string): number | null {
  const value = parseFoodAmount(raw, MAX_PORTION);
  if (value === null || value <= 0) return null;
  return value;
}

/** Servings is a whole head count, 1..100 (route bound). */
export function parseServingsInput(raw: string): number | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim();
  if (normalized.length === 0) return null;
  const value = Number(normalized);
  if (!Number.isInteger(value) || value < 1 || value > MAX_SERVINGS) return null;
  return value;
}

/**
 * Render a server figure. DISPLAY ONLY — at most one decimal so a gram-level
 * portion stays honest without a "300.55 kcal" row. Never feed the result back
 * into a request.
 */
export function formatMacro(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * An ISO stamp on the user's OWN wall clock (no `Z`, no offset).
 *
 * The Worker reads the literal hour out of this string to bucket the time of
 * day, exactly as the donor read `Calendar.current` on the device. Sending
 * `toISOString()` would file a 20:00 dinner in UTC+4 as "night" and quietly
 * wreck every suggestion.
 */
export function localWallClockStamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

function clampMacro(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(MAX_SERVING_MACRO, Math.max(0, value));
}

/* ==================================================================== */
/* Wire ↔ screen mappers                                                 */
/* ==================================================================== */

export function fromWireMacros(macros: HealthMacros | null | undefined): FoodMacros {
  if (!macros) return { ...ZERO_MACROS };
  return {
    calories: numberOr(macros.calories),
    protein: numberOr(macros.proteins),
    carbs: numberOr(macros.carbohydrates),
    fat: numberOr(macros.fats),
  };
}

function numberOr(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function fromWireFood(row: HealthCustomFood): FoodItem {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand_name ?? null,
    portion: numberOr(row.portion, 100),
    unit: row.unit || DEFAULT_FOOD_UNIT,
    // Renamed, never derived: the row's serving is what the Worker computed
    // from `base_*_per_100` for this portion.
    serving: fromWireMacros(row),
    isFavorite: row.is_favorite === true,
    useCount: numberOr(row.use_count),
    lastUsedAt: row.last_used_at ?? null,
    updatedAt: row.updated_at,
  };
}

function fromWireServing(raw: HealthExternalServing, index: number): ExternalFoodServingOption {
  return {
    id: typeof raw?.serving_id === 'string' && raw.serving_id.length > 0 ? raw.serving_id : `idx_${index}`,
    description: String(raw?.description ?? ''),
    portion: numberOr(raw?.portion, 100),
    unit: raw?.unit || DEFAULT_FOOD_UNIT,
    isMetric: raw?.is_metric === true,
    macros: fromWireMacros(raw),
  };
}

/**
 * A provider hit as the screen sees it.
 *
 * `serving` is RENAMED from the Worker's figures, never derived — the Worker
 * already computed it from the same `base_*_per_100` the import will store, so
 * the number on the row is the number that lands in the library.
 */
export function fromWireExternalFood(row: HealthExternalFood): ExternalFoodItem {
  return {
    id: row.id,
    provider: row.provider,
    providerFoodId: row.provider_food_id,
    name: row.name,
    brand: row.brand_name ?? null,
    portion: numberOr(row.portion, 100),
    unit: row.unit || DEFAULT_FOOD_UNIT,
    servingId: row.serving_id ?? null,
    servingDescription: row.serving_description ?? null,
    serving: fromWireMacros(row),
    per100: {
      calories: numberOr(row.base_calories_per_100),
      protein: numberOr(row.base_proteins_per_100),
      carbs: numberOr(row.base_carbs_per_100),
      fat: numberOr(row.base_fats_per_100),
    },
    servings: (row.servings ?? []).map(fromWireServing),
  };
}

function fromWireIngredient(raw: HealthRecipeIngredient): RecipeIngredient {
  return {
    name: String(raw?.name ?? ''),
    quantity: numberOr(raw?.quantity),
    unit: raw?.unit || DEFAULT_FOOD_UNIT,
    foodId: raw?.food_id ?? null,
    macros: fromWireMacros(raw),
  };
}

/** Stored ingredients are ones the Worker resolved, but never trust a blob. */
export function parseIngredientsJson(json: string): RecipeIngredient[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((raw) => fromWireIngredient(raw as HealthRecipeIngredient));
  } catch {
    return [];
  }
}

/** A stored minutes column, kept as a whole non-negative number or `null`. */
function positiveIntOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

export function fromWireRecipe(row: HealthRecipe): RecipeItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    servings: Math.max(1, Math.round(numberOr(row.servings, 1))),
    totals: {
      calories: numberOr(row.total_calories),
      protein: numberOr(row.total_proteins),
      carbs: numberOr(row.total_carbohydrates),
      fat: numberOr(row.total_fats),
    },
    ingredients: parseIngredientsJson(row.ingredients ?? '[]'),
    isFavorite: row.is_favorite === true,
    useCount: numberOr(row.use_count),
    category: row.category ?? null,
    preparationTime: positiveIntOrNull(row.preparation_time),
    cookingTime: positiveIntOrNull(row.cooking_time),
    imageUrl: row.image_url && row.image_url.length > 0 ? row.image_url : null,
    updatedAt: row.updated_at,
  };
}

function fromWireScaled(scaled: HealthScaledRecipe): ScaledRecipe {
  return {
    recipeId: scaled.recipe_id,
    name: scaled.name,
    servings: numberOr(scaled.servings, 1),
    targetServings: numberOr(scaled.target_servings, 1),
    perServing: fromWireMacros(scaled.per_serving),
    totals: fromWireMacros(scaled.totals),
    ingredients: (scaled.ingredients ?? []).map(fromWireIngredient),
  };
}

/* ==================================================================== */
/* Cache-shape guards                                                    */
/* ==================================================================== */

function isValidFood(food: FoodItem | null | undefined): food is FoodItem {
  return (
    !!food &&
    typeof food.id === 'string' &&
    typeof food.name === 'string' &&
    !!food.serving &&
    Number.isFinite(food.serving.calories)
  );
}

function isValidRecipe(recipe: RecipeItem | null | undefined): recipe is RecipeItem {
  return (
    !!recipe &&
    typeof recipe.id === 'string' &&
    typeof recipe.name === 'string' &&
    Array.isArray(recipe.ingredients) &&
    !!recipe.totals &&
    Number.isFinite(recipe.totals.calories)
  );
}

/* ==================================================================== */
/* Failure copy — no raw error string ever reaches the UI                */
/* ==================================================================== */

export type FoodWriteStatus = 'saved' | 'offline' | 'rejected';

export const OFFLINE_WRITE_MESSAGE =
  'Saved on this device — it will sync when you are back online.';
export const MISSING_FOOD_MESSAGE = 'That food is no longer in your library.';
export const SCALE_OFFLINE_MESSAGE = 'Serving maths needs a connection — try again once online.';

/* -------- external food database: every failure has a sentence ---------- */

export const PROVIDER_NOT_CONFIGURED_MESSAGE =
  'The food database is not switched on for this app yet, so this searches your own foods only.';
export const PROVIDER_RATE_LIMITED_MESSAGE =
  'The food database is busy right now — showing your own foods. Try again in a minute.';
export const PROVIDER_UNAVAILABLE_MESSAGE =
  'The food database could not be reached — showing your own foods.';
export const SEARCH_OFFLINE_MESSAGE =
  'You are offline, so this searches the foods saved on this device.';
export const IMPORT_OFFLINE_MESSAGE =
  'Adding a food from the database needs a connection, so nothing was added yet.';
export const IMPORT_MISSING_MESSAGE = 'That food is no longer in the food database.';
export const IMPORT_REJECTED_MESSAGE =
  'Those figures did not look right, so that food was not added to your library.';

/**
 * The sentence a provider status turns into, or `null` when there is nothing to
 * say (`ok`, `skipped`, or no answer at all).
 *
 * THIS IS THE WHOLE POINT of the status word: the Worker never hands the client
 * a provider message, an HTTP code or an exception string, so there is nothing
 * here to accidentally leak — the copy is written locally per state (repo rule:
 * no raw error strings in the UI).
 */
export function providerNoticeFor(status: FoodProviderStatus | undefined | null): string | null {
  switch (status) {
    case 'not_configured':
      return PROVIDER_NOT_CONFIGURED_MESSAGE;
    case 'rate_limited':
      return PROVIDER_RATE_LIMITED_MESSAGE;
    case 'unavailable':
      return PROVIDER_UNAVAILABLE_MESSAGE;
    default:
      return null;
  }
}

/**
 * Friendly copy for a refused import. Same discipline as `rejectionMessageFor`:
 * only the HTTP status is inspected, so the server's own words can never reach
 * the screen. `null` means "no answer at all" — treated as offline.
 */
export function importFailureMessageFor(error: unknown): string | null {
  const status = httpStatusOf(error);
  if (status === undefined) return null;
  if (status === 404) return IMPORT_MISSING_MESSAGE;
  if (status === 429) return PROVIDER_RATE_LIMITED_MESSAGE;
  if (status === 503) return PROVIDER_UNAVAILABLE_MESSAGE;
  if (status === 400 || status === 422) return IMPORT_REJECTED_MESSAGE;
  if (status === 401 || status === 403) return 'Please sign in again to save this.';
  if (status >= 500) return PROVIDER_UNAVAILABLE_MESSAGE;
  return IMPORT_REJECTED_MESSAGE;
}

/**
 * Friendly copy for a request the SERVER refused, or `null` when the failure
 * looks like a lost connection (which `writeThrough` already handles by keeping
 * the optimistic row). Only the HTTP status is ever inspected — the error's own
 * message is never read, so a raw string cannot leak into the UI.
 */
export function rejectionMessageFor(error: unknown): string | null {
  const status = httpStatusOf(error);
  if (status === undefined) return null; // no answer at all → treat as offline
  if (status === 404) return MISSING_FOOD_MESSAGE;
  if (status === 400 || status === 422) {
    return 'Those numbers do not add up. Check the portion, calories and macros.';
  }
  if (status === 401 || status === 403) return 'Please sign in again to save this.';
  if (status >= 500) return null; // a server wobble behaves like being offline
  return 'That could not be saved. Please check the details and try again.';
}

function httpStatusOf(error: unknown): number | undefined {
  const response = (error as { response?: { status?: unknown } } | null | undefined)?.response;
  const status = response?.status;
  return typeof status === 'number' ? status : undefined;
}

/* ==================================================================== */
/* Shared write path                                                     */
/* ==================================================================== */

interface ListWriteResult<T> {
  items: T[];
  status: FoodWriteStatus;
  message: string | null;
}

/**
 * One write against a cached Health list, with the three outcomes the UI has to
 * tell apart:
 *
 *  - `saved`    — the Worker took it;
 *  - `offline`  — the request never landed, so `writeThrough` keeps the
 *                 optimistic row and the user still sees what they just did;
 *  - `rejected` — the Worker refused it (impossible macros, already deleted).
 *                 The optimistic row is ROLLED BACK, because it does not exist
 *                 server-side and a phantom row would outlive the session and
 *                 reappear on every cold start.
 */
async function writeList<T>(options: {
  cacheKey: string;
  before: T[];
  optimistic: T[];
  request: () => Promise<unknown>;
  refresh: () => Promise<T[]>;
  detail: string;
}): Promise<ListWriteResult<T>> {
  // A holder rather than a `let`: TypeScript does not track assignments made
  // inside the callback below.
  const outcome: { rejection: string | null } = { rejection: null };

  const items = await writeThrough(
    options.cacheKey,
    async () => {
      try {
        await options.request();
      } catch (error) {
        outcome.rejection = rejectionMessageFor(error);
        throw error;
      }
    },
    options.refresh,
    options.optimistic,
    options.detail
  );

  if (outcome.rejection !== null) {
    await storageHelpers.setObject(options.cacheKey, options.before);
    return { items: options.before, status: 'rejected', message: outcome.rejection };
  }

  const offline = healthSyncStateFor(options.cacheKey) === 'offline';
  return {
    items,
    status: offline ? 'offline' : 'saved',
    message: offline ? OFFLINE_WRITE_MESSAGE : null,
  };
}

/* ==================================================================== */
/* Custom foods                                                          */
/* ==================================================================== */

export interface FoodWriteResult {
  foods: FoodItem[];
  status: FoodWriteStatus;
  message: string | null;
}

/**
 * Pull the WHOLE library, unfiltered.
 *
 * Favourites / most-used are applied after the fetch on purpose: caching a
 * filtered response under the one snapshot key would leave an offline read
 * showing only the favourites the user last looked at.
 */
async function fetchFoods(): Promise<FoodItem[]> {
  const payload = await healthFoodApi.listCustomFoods();
  return (payload?.foods ?? []).map(fromWireFood);
}

/** Mirrors the Worker's own ordering so offline and online read the same. */
export function sortFoods(foods: FoodItem[], filter: FoodFilter = 'all'): FoodItem[] {
  const sorted = [...foods];
  if (filter === 'most-used') {
    return sorted.sort(
      (a, b) => b.useCount - a.useCount || (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '')
    );
  }
  return sorted.sort(
    (a, b) =>
      Number(b.isFavorite) - Number(a.isFavorite) ||
      b.useCount - a.useCount ||
      a.name.localeCompare(b.name)
  );
}

export function applyFoodFilter(foods: FoodItem[], filter: FoodFilter): FoodItem[] {
  if (filter === 'favorites') return foods.filter((f) => f.isFavorite);
  if (filter === 'most-used') return foods.filter((f) => f.useCount > 0);
  return foods;
}

/**
 * The list a screen renders for `filter` — filter first, then the Worker's own
 * ordering. Exported so a screen can re-derive the view from a writer's answer
 * without paying for a second round trip.
 */
export function viewFoods(foods: FoodItem[], filter: FoodFilter): FoodItem[] {
  return sortFoods(applyFoodFilter(foods, filter), filter);
}

export async function loadFoods(filter: FoodFilter = 'all'): Promise<FoodItem[]> {
  const foods = (await readThrough(HEALTH_FOODS_KEY, fetchFoods, [])).filter(isValidFood);
  return viewFoods(foods, filter);
}

/** Name / brand match over a cached library — the offline stand-in for search. */
export function matchFoods(foods: FoodItem[], query: string): FoodItem[] {
  const needle = query.toLowerCase().trim();
  if (needle.length === 0) return [];
  return foods.filter(
    (f) => f.name.toLowerCase().includes(needle) || (f.brand ?? '').toLowerCase().includes(needle)
  );
}

const EMPTY_SEARCH: FoodSearchOutcome = {
  library: [],
  external: [],
  providerNotice: null,
  offline: false,
};

/**
 * Relevance-ranked search over the user's own library, topped up from the
 * external food database (parity P3).
 *
 * Ranking is the Worker's (fuzzy word match + usage + recency + favourite), so
 * the offline path degrades to a plain substring match rather than pretending to
 * reproduce the score.
 *
 * THREE FAILURE MODES, ALL LEGIBLE, NONE SILENT:
 *
 *  - the DEVICE is offline → the library half answers from the cache and
 *    `providerNotice` says so. The old behaviour returned the same rows with no
 *    explanation, which reads as "no such food" for anything not already saved.
 *  - the PROVIDER is missing, throttled or down → the Worker still answers with
 *    the library and a status word, which becomes a sentence here.
 *  - the query is too short for the route → answered from the cache rather than
 *    collecting a 400.
 *
 * `includeExternal: false` searches the library alone, without the round trip
 * to the provider.
 */
export async function searchFoods(
  query: string,
  opts: { includeExternal?: boolean } = {}
): Promise<FoodSearchOutcome> {
  const needle = typeof query === 'string' ? query.trim() : '';
  if (needle.length === 0) return { ...EMPTY_SEARCH };
  // Below the route's minimum: answer from the cache instead of collecting a 400.
  if (needle.length < MIN_FOOD_SEARCH_LENGTH) {
    return { ...EMPTY_SEARCH, library: matchFoods(await loadFoods(), needle) };
  }
  try {
    const payload = await healthFoodApi.searchFoods(
      needle,
      opts.includeExternal === false ? { include_external: false } : undefined
    );
    return {
      library: (payload?.results ?? []).map(fromWireFood),
      external: (payload?.external ?? []).map(fromWireExternalFood),
      providerNotice: providerNoticeFor(payload?.provider?.status),
      offline: false,
    };
  } catch {
    // A failed search must never blank the screen or surface a raw error — and
    // must never look like an authoritative "nothing found" either.
    return {
      library: matchFoods(await loadFoods(), needle),
      external: [],
      providerNotice: SEARCH_OFFLINE_MESSAGE,
      offline: true,
    };
  }
}

export const BARCODE_OFFLINE_MESSAGE =
  'You are offline, so a scanned barcode cannot be looked up right now.';

/** What `lookupFoodBarcode` hands the screen — never a raw status word. */
export interface BarcodeLookupOutcome {
  /** The provider's match, mapped onto the same shape a food-search hit uses. */
  food: ExternalFoodItem | null;
  /**
   * Plain-language reason the provider did not answer (`not_configured` /
   * `rate_limited` / `unavailable`), or `null` when it did — including the
   * honest "this code is not in the database" case (`food: null` + `null`
   * here), which is NOT a failure and must render its own copy, not this one.
   */
  providerNotice: string | null;
  /** True when the Worker itself could not be reached. */
  offline: boolean;
}

/**
 * `/health/foods/barcode` — one scanned code in, one outcome out.
 *
 * Mirrors `searchFoods`'s three-failure-mode discipline exactly: a missing
 * credential, a throttle or an outage is a `provider.status` word turned into
 * a sentence by `providerNoticeFor` (never the server's own text), and a
 * device that cannot reach the Worker at all gets its own offline copy rather
 * than being folded into the provider notice.
 */
export async function lookupFoodBarcode(code: string): Promise<BarcodeLookupOutcome> {
  try {
    const payload = await healthFoodApi.lookupBarcode(code);
    return {
      food: payload?.food ? fromWireExternalFood(payload.food) : null,
      providerNotice: providerNoticeFor(payload?.provider?.status),
      offline: false,
    };
  } catch {
    return { food: null, providerNotice: BARCODE_OFFLINE_MESSAGE, offline: true };
  }
}

export interface FoodDraft {
  name: string;
  brand?: string;
  /** How much this food's macros describe (e.g. 100 g, 1 serving). */
  portion: number;
  unit: string;
  /** Macros FOR `portion` — the Worker infers the per-100 basis from the pair. */
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  isFavorite?: boolean;
  /**
   * Where the row came from. Defaults to `'manual'` — anything without an
   * explicit origin was typed in. The AI label scanner
   * (`screens/HealthScanScreen.tsx`) sends `'scanned'`, which is the donor's own
   * value and has been in the route's enum since 0120; the column was simply
   * never written by anything until P3 landed a scanner.
   */
  sourceType?: HealthCustomFoodPayload['source_type'];
}

/**
 * The payload `toFoodPayload` produces — every column FILLED.
 *
 * `HealthCustomFoodPayload` marks most columns optional because a PUT may carry
 * exactly one of them (`setFoodFavorite` sends only `is_favorite`). A full draft
 * always fills them all, and saying so in the type is what lets `optimisticFood`
 * echo the user's own input back without re-defaulting values that cannot be
 * missing — a fallback that can never fire is a fallback nobody can check.
 */
export type FullFoodPayload = HealthCustomFoodPayload &
  Required<
    Pick<
      HealthCustomFoodPayload,
      'portion' | 'unit' | 'calories' | 'proteins' | 'carbohydrates' | 'fats' | 'is_favorite'
    >
  >;

/** The exact body `/custom-foods` receives. Bounds mirror the route schema. */
export function toFoodPayload(draft: FoodDraft): FullFoodPayload {
  const brand = (draft.brand ?? '').trim();
  return {
    name: draft.name.trim().slice(0, MAX_FOOD_NAME),
    brand_name: brand.length > 0 ? brand.slice(0, MAX_FOOD_BRAND) : null,
    portion: Math.min(MAX_PORTION, Math.max(0.01, draft.portion)),
    unit: (draft.unit || DEFAULT_FOOD_UNIT).slice(0, MAX_FOOD_UNIT),
    calories: clampMacro(draft.calories),
    proteins: clampMacro(draft.protein),
    carbohydrates: clampMacro(draft.carbs),
    fats: clampMacro(draft.fat),
    is_favorite: draft.isFavorite ?? false,
    source_type: draft.sourceType ?? 'manual',
  };
}

/**
 * The row we show until the server answers. Its macros are the ones the user
 * typed for that portion — an echo of the input, not a derivation: the Worker
 * round-trips the same pair back through `basisFrom` → `portionFrom`.
 */
function optimisticFood(payload: FullFoodPayload): FoodItem {
  return {
    // A locally minted id renders and removes fine, but can never satisfy a
    // PUT/DELETE route — the refreshed server row replaces it.
    id: `local-${new Date().toISOString()}`,
    name: payload.name,
    brand: payload.brand_name ?? null,
    portion: payload.portion,
    unit: payload.unit,
    serving: {
      calories: payload.calories,
      protein: payload.proteins,
      carbs: payload.carbohydrates,
      fat: payload.fats,
    },
    isFavorite: payload.is_favorite,
    useCount: 0,
    lastUsedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function createFood(draft: FoodDraft): Promise<FoodWriteResult> {
  const before = await loadFoods();
  const payload = toFoodPayload(draft);
  const result = await writeList({
    cacheKey: HEALTH_FOODS_KEY,
    before,
    optimistic: sortFoods([optimisticFood(payload), ...before]),
    request: () => healthFoodApi.createCustomFood(payload),
    refresh: fetchFoods,
    detail: `insert food=${payload.name}`,
  });
  return { foods: sortFoods(result.items), status: result.status, message: result.message };
}

export async function updateFood(id: string, draft: FoodDraft): Promise<FoodWriteResult> {
  const before = await loadFoods();
  const payload = toFoodPayload(draft);
  const optimistic = before.map((food) =>
    food.id === id
      ? {
          ...food,
          name: payload.name,
          brand: payload.brand_name ?? null,
          portion: payload.portion,
          unit: payload.unit,
          serving: {
            calories: payload.calories,
            protein: payload.proteins,
            carbs: payload.carbohydrates,
            fat: payload.fats,
          },
          isFavorite: payload.is_favorite,
        }
      : food
  );
  const result = await writeList({
    cacheKey: HEALTH_FOODS_KEY,
    before,
    optimistic: sortFoods(optimistic),
    request: () => healthFoodApi.updateCustomFood(id, payload),
    refresh: fetchFoods,
    detail: `update food=${id}`,
  });
  return { foods: sortFoods(result.items), status: result.status, message: result.message };
}

/**
 * Favourite is a flag, so the PUT carries ONLY that column — sending the macros
 * again would make the Worker re-derive a basis the user never edited.
 */
export async function setFoodFavorite(id: string, isFavorite: boolean): Promise<FoodWriteResult> {
  const before = await loadFoods();
  const optimistic = before.map((food) => (food.id === id ? { ...food, isFavorite } : food));
  const result = await writeList({
    cacheKey: HEALTH_FOODS_KEY,
    before,
    optimistic: sortFoods(optimistic),
    request: () => healthFoodApi.updateCustomFood(id, { is_favorite: isFavorite }),
    refresh: fetchFoods,
    detail: `favorite food=${id} value=${isFavorite}`,
  });
  return { foods: sortFoods(result.items), status: result.status, message: result.message };
}

export async function deleteFood(id: string): Promise<FoodWriteResult> {
  const before = await loadFoods();
  const result = await writeList({
    cacheKey: HEALTH_FOODS_KEY,
    before,
    optimistic: before.filter((food) => food.id !== id),
    request: () => healthFoodApi.deleteCustomFood(id),
    refresh: fetchFoods,
    detail: `delete food=${id}`,
  });
  return { foods: sortFoods(result.items), status: result.status, message: result.message };
}

export interface LogFoodResult extends FoodWriteResult {
  /** The serving the SERVER derived for this use; null when it never landed. */
  logged: FoodMacros | null;
  /** The slot the use was filed under — the server's answer wins. */
  mealSlot: MealSlot;
}

/**
 * "Log to today": record the use AND put the food in the day's diary.
 *
 * `/custom-foods/:id/use` only records usage (it powers suggestions), so the
 * diary row is written through the nutrition store with the `logged` macros the
 * route answered with. Offline we fall back to the food's cached serving —
 * itself a server-derived figure from the cached row, never a device
 * calculation.
 */
export async function logFoodToDiary(
  id: string,
  input: { mealSlot?: MealSlot; portion?: number; date?: string } = {}
): Promise<LogFoodResult> {
  const before = await loadFoods();
  const food = before.find((f) => f.id === id);
  const requestedSlot = input.mealSlot ?? DEFAULT_MEAL_SLOT;
  if (!food) {
    return {
      foods: before,
      status: 'rejected',
      message: MISSING_FOOD_MESSAGE,
      logged: null,
      mealSlot: requestedSlot,
    };
  }

  const usedAt = localWallClockStamp();
  const state: { logged: FoodMacros | null; slot: MealSlot } = { logged: null, slot: requestedSlot };
  const optimistic = before.map((f) =>
    f.id === id ? { ...f, useCount: f.useCount + 1, lastUsedAt: usedAt } : f
  );

  const result = await writeList({
    cacheKey: HEALTH_FOODS_KEY,
    before,
    optimistic: sortFoods(optimistic),
    request: async () => {
      const payload = await healthFoodApi.useCustomFood(id, {
        meal_type: toWireMealType(requestedSlot),
        used_at: usedAt,
        portion: input.portion,
      });
      if (payload) {
        state.logged = fromWireMacros(payload.logged);
        state.slot = fromWireMealType(payload.usage?.meal_type ?? toWireMealType(requestedSlot));
      }
    },
    refresh: fetchFoods,
    detail: `use food=${id} slot=${requestedSlot}`,
  });

  if (result.status === 'rejected') {
    return {
      foods: result.items,
      status: 'rejected',
      message: result.message,
      logged: null,
      mealSlot: state.slot,
    };
  }

  const macros = state.logged ?? food.serving;
  await addMealEntry({
    name: food.name,
    slot: state.slot,
    calories: macros.calories,
    protein: macros.protein,
    carbs: macros.carbs,
    fat: macros.fat,
    date: input.date ?? todayDateKey(),
    // Provenance (0124). Before this, the diary row kept only the resulting
    // absolute macros, so changing the portion afterwards had nothing to rescale
    // FROM. Sending the food id and the portion lets the Worker copy that food's
    // stored `base_*_per_100` onto the row — the basis is never computed here.
    foodId: food.id,
    portion: input.portion ?? food.portion,
    unit: food.unit,
  });

  return {
    foods: result.items,
    status: result.status,
    message: result.message,
    logged: state.logged,
    mealSlot: state.slot,
  };
}

/**
 * "What you usually eat at this time of day".
 *
 * Deliberately NOT cached: the answer is a function of the current time bucket,
 * so a snapshot taken at breakfast would still be offering porridge at dinner.
 * A failed call returns `null` and the screen simply drops the card.
 */
export async function loadFoodSuggestions(mealSlot?: MealSlot): Promise<FoodSuggestions | null> {
  try {
    const payload = await healthFoodApi.foodSuggestions({
      meal_type: mealSlot ? toWireMealType(mealSlot) : undefined,
      at: localWallClockStamp(),
    });
    if (!payload) return null;
    return {
      timeOfDay: payload.time_of_day,
      mealSlot: fromWireMealType(payload.meal_type),
      suggestions: (payload.suggestions ?? []).map((entry) => ({
        food: fromWireFood(entry.food),
        score: numberOr(entry.score),
        reasons: entry.reasons ?? [],
      })),
    };
  } catch {
    return null;
  }
}

/* ==================================================================== */
/* External food database → a row the user owns                          */
/* ==================================================================== */

export interface ImportFoodResult extends FoodWriteResult {
  /** The stored row, or `null` when nothing was written. */
  food: FoodItem | null;
  /** False when the user already had this food — nothing was overwritten. */
  created: boolean;
}

/**
 * Keep a food-database hit as a real `custom_foods` row.
 *
 * NOT OPTIMISTIC, deliberately. Every other writer in this module can show the
 * user's own input immediately, because the input IS the row. Here the row does
 * not exist until the Worker builds it from the provider's basis, so inventing
 * a local one would put a food in the library that no server has agreed to — and
 * the id it carried could never satisfy a later PUT or DELETE. Offline, the
 * honest answer is "not added yet" (same rule as `logRecipeToDiary`).
 *
 * Only the provider's id and the chosen serving go up: the Worker re-fetches
 * and derives the stored basis itself, so nothing here can inject macros under
 * a provider's name.
 */
export async function importExternalFood(
  external: ExternalFoodItem,
  opts: { servingId?: string | null; isFavorite?: boolean; mealSlot?: MealSlot } = {}
): Promise<ImportFoodResult> {
  const before = await loadFoods();
  const state: { food: FoodItem | null; created: boolean } = { food: null, created: false };
  const outcome: { rejection: string | null } = { rejection: null };

  const items = await writeThrough(
    HEALTH_FOODS_KEY,
    async () => {
      try {
        const payload = await healthFoodApi.importExternalFood({
          provider: external.provider,
          provider_food_id: external.providerFoodId,
          ...(opts.servingId ? { serving_id: opts.servingId } : {}),
          ...(opts.isFavorite === undefined ? {} : { is_favorite: opts.isFavorite }),
          ...(opts.mealSlot ? { preferred_meal_types: [toWireMealType(opts.mealSlot)] } : {}),
        });
        if (payload?.food) {
          state.food = fromWireFood(payload.food);
          state.created = payload.created === true;
        }
      } catch (error) {
        outcome.rejection = importFailureMessageFor(error);
        throw error;
      }
    },
    fetchFoods,
    // No optimistic row — see the note above.
    before,
    `import food provider=${external.provider} id=${external.providerFoodId}`
  );

  if (outcome.rejection !== null) {
    await storageHelpers.setObject(HEALTH_FOODS_KEY, before);
    return {
      foods: before,
      status: 'rejected',
      message: outcome.rejection,
      food: null,
      created: false,
    };
  }
  if (healthSyncStateFor(HEALTH_FOODS_KEY) === 'offline' || state.food === null) {
    return {
      foods: before,
      status: 'offline',
      message: IMPORT_OFFLINE_MESSAGE,
      food: null,
      created: false,
    };
  }
  return {
    foods: sortFoods(items),
    status: 'saved',
    message: null,
    food: state.food,
    created: state.created,
  };
}

/**
 * "Add this food-database result to today" — import it, then log it.
 *
 * Two steps on purpose, and in this order: the import is what makes the row
 * exist, and `logFoodToDiary` is the one path that records a use, derives the
 * serving server-side and writes the diary row WITH its `base_*_per_100`
 * provenance (0124). Going straight to the diary would file a meal whose
 * portion could never be re-derived afterwards, which is exactly the gap 0124
 * closed.
 *
 * A failed import never logs anything and says which half failed.
 */
export async function logExternalFoodToDiary(
  external: ExternalFoodItem,
  input: { mealSlot?: MealSlot; servingId?: string | null; date?: string } = {}
): Promise<LogFoodResult & { created: boolean }> {
  const mealSlot = input.mealSlot ?? DEFAULT_MEAL_SLOT;
  const imported = await importExternalFood(external, {
    servingId: input.servingId,
    mealSlot,
  });
  if (imported.status !== 'saved' || !imported.food) {
    return {
      foods: imported.foods,
      status: imported.status,
      message: imported.message,
      logged: null,
      mealSlot,
      created: false,
    };
  }

  const logged = await logFoodToDiary(imported.food.id, {
    mealSlot,
    portion: imported.food.portion,
    date: input.date,
  });
  return { ...logged, created: imported.created };
}

/* ==================================================================== */
/* Recipes                                                               */
/* ==================================================================== */

export interface RecipeWriteResult {
  recipes: RecipeItem[];
  status: FoodWriteStatus;
  message: string | null;
}

async function fetchRecipes(): Promise<RecipeItem[]> {
  const payload = await healthFoodApi.listRecipes();
  return (payload?.recipes ?? []).map(fromWireRecipe);
}

/** Mirrors the Worker's ordering: favourites, then most used, then by name. */
export function sortRecipes(recipes: RecipeItem[]): RecipeItem[] {
  return [...recipes].sort(
    (a, b) =>
      Number(b.isFavorite) - Number(a.isFavorite) ||
      b.useCount - a.useCount ||
      a.name.localeCompare(b.name)
  );
}

/** The list a screen renders for `filter` (see `viewFoods`). */
export function viewRecipes(recipes: RecipeItem[], filter: RecipeFilter): RecipeItem[] {
  return sortRecipes(filter === 'favorites' ? recipes.filter((r) => r.isFavorite) : recipes);
}

export async function loadRecipes(filter: RecipeFilter = 'all'): Promise<RecipeItem[]> {
  const recipes = (await readThrough(HEALTH_RECIPES_KEY, fetchRecipes, [])).filter(isValidRecipe);
  return viewRecipes(recipes, filter);
}

export interface RecipePhotoResult {
  /** Feed straight into `RecipeDraft.imageUrl`. Null on failure. */
  imageUrl: string | null;
  status: HealthFileWriteStatus;
  message: string | null;
}

/**
 * Attach a photo to a recipe: the exact reserve → PUT dance every Health file
 * upload uses (`uploadHealthPhoto` in `healthFilesStorage.ts`), tagged
 * `category: 'recipe'` (mirrors the donor's own upload tag) so it can be told
 * apart from an ordinary Files-tab photo later.
 *
 * Returns the proxied path to send as `RecipeDraft.imageUrl` — NOT a public
 * URL. Rendering it back needs `healthFileContentSource`, same as any other
 * Health file, because the bearer token has to ride on the request.
 */
export async function uploadRecipePhoto(
  request: HealthFileUploadRequest
): Promise<RecipePhotoResult> {
  const result = await uploadHealthPhoto(request, { category: 'recipe' });
  return { imageUrl: result.contentPath, status: result.status, message: result.message };
}

/** Route bound (`recipeFields.preparation_time` / `.cooking_time`). */
export const MAX_RECIPE_TIME_MINUTES = 10000;

export interface RecipeDraft {
  name: string;
  servings: number;
  ingredients: Array<{ name: string; quantity: number; unit?: string; foodId?: string | null }>;
  description?: string;
  isFavorite?: boolean;
  /** One of `RECIPE_CATEGORIES`, or `null`/omitted for "None". */
  category?: string | null;
  /** Minutes, or `null`/omitted to leave it unset. */
  preparationTime?: number | null;
  cookingTime?: number | null;
  /** Proxied file path from `uploadRecipePhoto`, or `null` to clear the photo. */
  imageUrl?: string | null;
}

/** The recipe equivalent of `FullFoodPayload` — see the note there. */
export type FullRecipePayload = Omit<HealthRecipePayload, 'ingredients'> &
  Required<
    Pick<
      HealthRecipePayload,
      | 'description'
      | 'servings'
      | 'is_favorite'
      | 'category'
      | 'preparation_time'
      | 'cooking_time'
      | 'image_url'
    >
  > & {
    ingredients: Array<HealthRecipePayload['ingredients'][number] & { unit: string }>;
  };

/** A minutes field as the route wants it: a whole number, bounded, or `null`. */
function toRecipeMinutes(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.min(MAX_RECIPE_TIME_MINUTES, Math.round(value));
}

/** The exact body `/recipes` receives. Bounds mirror the route schema. */
export function toRecipePayload(draft: RecipeDraft): FullRecipePayload {
  const description = (draft.description ?? '').trim();
  return {
    name: draft.name.trim().slice(0, MAX_FOOD_NAME),
    description: description.length > 0 ? description : null,
    servings: Math.min(MAX_SERVINGS, Math.max(1, Math.round(draft.servings))),
    is_favorite: draft.isFavorite ?? false,
    category: draft.category ?? null,
    preparation_time: toRecipeMinutes(draft.preparationTime),
    cooking_time: toRecipeMinutes(draft.cookingTime),
    image_url: draft.imageUrl ?? null,
    // No macros are sent: an ingredient carries its quantity and which food it
    // is, and the Worker resolves that food's stored basis (rule 2).
    ingredients: draft.ingredients.slice(0, MAX_INGREDIENTS).map((ingredient) => ({
      name: ingredient.name.trim().slice(0, MAX_FOOD_NAME),
      quantity: Math.min(MAX_PORTION, Math.max(0.01, ingredient.quantity)),
      unit: (ingredient.unit || DEFAULT_FOOD_UNIT).slice(0, MAX_FOOD_UNIT),
      ...(ingredient.foodId ? { food_id: ingredient.foodId } : {}),
    })),
  };
}

/**
 * The row shown until the server answers. Totals are left at ZERO on purpose:
 * they are the Worker's to compute, and inventing a local sum would put a number
 * on screen the server is about to disagree with.
 */
function optimisticRecipe(payload: FullRecipePayload): RecipeItem {
  const now = new Date().toISOString();
  return {
    id: `local-${now}`,
    name: payload.name,
    description: payload.description,
    servings: payload.servings,
    totals: { ...ZERO_MACROS },
    ingredients: payload.ingredients.map((ingredient) => ({
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      // `food_id` is spread in only when the draft named a food, so this one
      // fallback DOES fire — for a free-text ingredient.
      foodId: ingredient.food_id ?? null,
      macros: { ...ZERO_MACROS },
    })),
    isFavorite: payload.is_favorite,
    useCount: 0,
    category: payload.category,
    preparationTime: payload.preparation_time,
    cookingTime: payload.cooking_time,
    imageUrl: payload.image_url,
    updatedAt: now,
  };
}

export async function createRecipe(draft: RecipeDraft): Promise<RecipeWriteResult> {
  const before = await loadRecipes();
  const payload = toRecipePayload(draft);
  const result = await writeList({
    cacheKey: HEALTH_RECIPES_KEY,
    before,
    optimistic: sortRecipes([optimisticRecipe(payload), ...before]),
    request: () => healthFoodApi.createRecipe(payload),
    refresh: fetchRecipes,
    detail: `insert recipe=${payload.name}`,
  });
  return { recipes: sortRecipes(result.items), status: result.status, message: result.message };
}

export async function updateRecipe(id: string, draft: RecipeDraft): Promise<RecipeWriteResult> {
  const before = await loadRecipes();
  const payload = toRecipePayload(draft);
  const optimistic = before.map((recipe) =>
    recipe.id === id
      ? { ...optimisticRecipe(payload), id: recipe.id, useCount: recipe.useCount }
      : recipe
  );
  const result = await writeList({
    cacheKey: HEALTH_RECIPES_KEY,
    before,
    optimistic: sortRecipes(optimistic),
    request: () => healthFoodApi.updateRecipe(id, payload),
    refresh: fetchRecipes,
    detail: `update recipe=${id}`,
  });
  return { recipes: sortRecipes(result.items), status: result.status, message: result.message };
}

export async function setRecipeFavorite(
  id: string,
  isFavorite: boolean
): Promise<RecipeWriteResult> {
  const before = await loadRecipes();
  const optimistic = before.map((recipe) =>
    recipe.id === id ? { ...recipe, isFavorite } : recipe
  );
  const result = await writeList({
    cacheKey: HEALTH_RECIPES_KEY,
    before,
    optimistic: sortRecipes(optimistic),
    request: () => healthFoodApi.updateRecipe(id, { is_favorite: isFavorite }),
    refresh: fetchRecipes,
    detail: `favorite recipe=${id} value=${isFavorite}`,
  });
  return { recipes: sortRecipes(result.items), status: result.status, message: result.message };
}

export async function deleteRecipe(id: string): Promise<RecipeWriteResult> {
  const before = await loadRecipes();
  const result = await writeList({
    cacheKey: HEALTH_RECIPES_KEY,
    before,
    optimistic: before.filter((recipe) => recipe.id !== id),
    request: () => healthFoodApi.deleteRecipe(id),
    refresh: fetchRecipes,
    detail: `delete recipe=${id}`,
  });
  return { recipes: sortRecipes(result.items), status: result.status, message: result.message };
}

/**
 * Per-serving and scaled figures, computed by the Worker.
 *
 * This is the ONLY source of a per-serving number: dividing `totals` by
 * `servings` on the device is exactly the recompute this architecture forbids.
 * `null` means the answer is unavailable (offline) — the screen says so rather
 * than showing a figure it made up.
 */
export async function scaleRecipe(id: string, servings: number): Promise<ScaledRecipe | null> {
  const target = Math.min(MAX_SERVINGS, Math.max(1, Math.round(servings)));
  try {
    const payload = await healthFoodApi.scaleRecipe(id, target);
    return payload?.scaled ? fromWireScaled(payload.scaled) : null;
  } catch {
    return null;
  }
}

/* ==================================================================== */
/* Recipe → diary (donor RecipePortionPickerView / AddRecipeToMealSheet) */
/* ==================================================================== */

export type LogRecipeStatus = 'saved' | 'missing' | 'unavailable';

export interface LogRecipeResult {
  status: LogRecipeStatus;
  message: string | null;
  /** The macros the SERVER derived for the chosen head count; null on failure. */
  logged: FoodMacros | null;
  servings: number;
  mealSlot: MealSlot;
}

export const MISSING_RECIPE_MESSAGE = 'That recipe is no longer in your library.';

/**
 * Offline copy. Deliberately says nothing was added, because nothing was —
 * unlike a typed food, a recipe's diary figures do not exist until the server
 * has scaled them.
 */
export const RECIPE_LOG_OFFLINE_MESSAGE =
  'Working out the servings needs a connection, so nothing was added to the diary yet.';

/**
 * Log a recipe to the diary at a chosen number of servings.
 *
 * THE SCALING MATHS IS THE SERVER'S, AND ONLY THE SERVER'S.
 * `/recipes/:id/scale` answers with `totals = storedTotals × (target ÷ stored
 * servings)` computed from the exact stored totals (`scaleTotals` in
 * `health-food-service.ts`), and those totals ARE the diary row — for two
 * servings of a four-serving, 2,000 kcal bake the row is 1,000 kcal, and the
 * device multiplied nothing. Scaling from the rounded per-serving figure
 * instead is the drift this architecture exists to prevent: the donor does
 * exactly that (`Recipe.caloriesPerServing` is integer division, so its 4→3→4
 * round trip does not return), and it also previews one number while writing
 * another (`caloriesPer100g` truncates, the write does not). We show the user
 * the figure we are about to log, and log the figure we showed.
 *
 * DELIBERATE DIVERGENCES from the donor, both forced by the deployed contract:
 *
 *  - **Whole servings only, 1–100.** The donor's `AddRecipeToMealSheet` stepped
 *    by 0.5. `/recipes/:id/scale` validates `z.number().int().min(1).max(100)`,
 *    so half a serving is a 400. Getting there would mean halving `per_serving`
 *    on the device — the one thing this module refuses to do — so the stepper is
 *    whole servings until the route takes a fraction.
 *  - **No usage bump.** The donor calls `recipeRepository.recordUsage`; there is
 *    no `/recipes/:id/use` route, so `recipes.use_count` stays where it is
 *    rather than being faked with a PUT that would re-resolve every ingredient.
 *
 * The row is written with `portion = servings` and `unit = 'serving'`, matching
 * the donor's servings path. That pair is also what lets the Worker derive a
 * basis for the row, so a recipe logged at 2 servings can afterwards be
 * re-portioned to 3 from the diary and land on the right figure.
 */
export async function logRecipeToDiary(
  id: string,
  input: { servings: number; mealSlot?: MealSlot; date?: string }
): Promise<LogRecipeResult> {
  const mealSlot = input.mealSlot ?? DEFAULT_MEAL_SLOT;
  const servings = Math.min(MAX_SERVINGS, Math.max(1, Math.round(input.servings)));

  const recipe = (await loadRecipes()).find((r) => r.id === id);
  if (!recipe) {
    return { status: 'missing', message: MISSING_RECIPE_MESSAGE, logged: null, servings, mealSlot };
  }

  const scaled = await scaleRecipe(id, servings);
  if (!scaled) {
    // No answer, no entry. Writing the stored totals instead would log a
    // one-batch figure as if it were the chosen head count.
    return {
      status: 'unavailable',
      message: RECIPE_LOG_OFFLINE_MESSAGE,
      logged: null,
      servings,
      mealSlot,
    };
  }

  await addMealEntry({
    // Donor `Recipe.toNutritionEntry` writes `recipe.name` bare — the head count
    // lives in `portion`/`unit`, not in the name, so the diary does not grow a
    // second "Chicken Curry (2 servings)" row that no longer matches the recipe.
    name: recipe.name,
    slot: mealSlot,
    calories: scaled.totals.calories,
    protein: scaled.totals.protein,
    carbs: scaled.totals.carbs,
    fat: scaled.totals.fat,
    date: input.date ?? todayDateKey(),
    portion: servings,
    unit: 'serving',
    // No `foodId`: a recipe id is not a custom-food id, and sending it would
    // 404 the create (`resolveNutritionBasis` looks it up in `custom_foods`).
  });

  return { status: 'saved', message: null, logged: scaled.totals, servings, mealSlot };
}
