/**
 * Symply Health — FOOD library + recipes (parity phase P2).
 *
 * Three layers, same shape as the other Health store suites:
 *
 *  1. PURE — bounds, input parsing, wall-clock stamping, display formatting.
 *  2. WIRE — the EXACT payload every writer sends and the `fromWire*` mapping
 *     back, including the invariant that binds this whole feature together:
 *     **no nutrition figure is ever computed on the device.**
 *  3. OFFLINE — the triad: cached read, optimistic write, sync state; plus the
 *     third outcome this store adds, a SERVER REJECTION, which must roll the
 *     optimistic row back instead of leaving a phantom food behind.
 *
 * `fakeFoodServer` keeps a tiny row list because every writer re-reads the
 * library afterwards — a static list mock would report each add as lost.
 */

import {
  healthFoodApi,
  type HealthCustomFood,
  type HealthExternalFood,
  type HealthFoodProviderStatus,
  type HealthFoodSearchResponse,
  type HealthRecipe,
  type HealthRecipeIngredient,
  type HealthScaledRecipe,
} from '@api/healthFood';
import { storageHelpers } from '@services/storage';

import {
  BARCODE_OFFLINE_MESSAGE,
  createFood,
  createRecipe,
  deleteFood,
  deleteRecipe,
  DEFAULT_MEAL_SLOT,
  formatMacro,
  fromWireExternalFood,
  fromWireFood,
  fromWireMacros,
  fromWireRecipe,
  HEALTH_FOODS_KEY,
  IMPORT_MISSING_MESSAGE,
  IMPORT_OFFLINE_MESSAGE,
  IMPORT_REJECTED_MESSAGE,
  importExternalFood,
  importFailureMessageFor,
  HEALTH_RECIPES_KEY,
  loadFoodSuggestions,
  loadFoods,
  loadRecipes,
  localWallClockStamp,
  logExternalFoodToDiary,
  logFoodToDiary,
  logRecipeToDiary,
  lookupFoodBarcode,
  matchFoods,
  MISSING_FOOD_MESSAGE,
  MISSING_RECIPE_MESSAGE,
  PROVIDER_NOT_CONFIGURED_MESSAGE,
  PROVIDER_RATE_LIMITED_MESSAGE,
  PROVIDER_UNAVAILABLE_MESSAGE,
  providerNoticeFor,
  parseFoodAmount,
  parseFoodPortion,
  parseIngredientsJson,
  parseServingsInput,
  RECIPE_LOG_OFFLINE_MESSAGE,
  rejectionMessageFor,
  sanitizeDecimalInput,
  scaleRecipe,
  SEARCH_OFFLINE_MESSAGE,
  searchFoods,
  setFoodFavorite,
  setRecipeFavorite,
  sortFoods,
  toFoodPayload,
  toRecipePayload,
  updateFood,
  updateRecipe,
  viewFoods,
  viewRecipes,
  type FoodItem,
  type RecipeItem,
} from '../healthFoodStorage';
import { addMealEntry, HEALTH_MEALS_KEY } from '../healthNutritionStorage';
import {
  __setHealthOfflineForTests,
  clearHealthCache,
  healthSyncStateFor,
} from '../healthRepository';

jest.mock('@api/healthFood');
jest.mock('../healthNutritionStorage', () => {
  const actual = jest.requireActual('../healthNutritionStorage');
  return { ...actual, addMealEntry: jest.fn() };
});

type MockedFoodApi = jest.Mocked<typeof healthFoodApi>;
const api = healthFoodApi as unknown as MockedFoodApi;
const mockAddMealEntry = addMealEntry as jest.Mock;

/** The Worker answers with the bare object — no `{ data }` envelope. */
function body<T>(payload: T): T {
  return payload;
}

const NETWORK_ERROR = new Error('Network request failed');
/** A refusal from the Worker, carrying only an HTTP status (never a message). */
function httpError(status: number): Error & { response: { status: number } } {
  return Object.assign(new Error('Request failed'), { response: { status } });
}

// Fixed local noon: `todayDateKey()` === '2026-07-13' in every timezone.
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';
const ISO = '2026-07-13T08:00:00.000Z';

function foodRow(over: Partial<HealthCustomFood> = {}): HealthCustomFood {
  return {
    id: 'cf_1',
    user_id: 'user-1',
    name: 'Oats',
    brand_name: null,
    portion: 100,
    unit: 'g',
    calories: 380,
    proteins: 13,
    carbohydrates: 60,
    fats: 7,
    base_calories_per_100: 380,
    base_proteins_per_100: 13,
    base_carbs_per_100: 60,
    base_fats_per_100: 7,
    category: null,
    barcode: null,
    is_favorite: false,
    use_count: 0,
    last_used_at: null,
    preferred_meal_types: '[]',
    source_type: 'manual',
    source_recipe_id: null,
    is_shared: false,
    share_code: null,
    created_at: ISO,
    updated_at: ISO,
    deleted_at: null,
    ...over,
  };
}

/**
 * A FatSecret hit as the WORKER already mapped it: our vocabulary, our per-100
 * basis, two servings so the picker has something to pick.
 */
function externalRow(over: Partial<HealthExternalFood> = {}): HealthExternalFood {
  return {
    id: 'fatsecret:33691',
    provider: 'fatsecret',
    provider_food_id: '33691',
    name: 'Greek Yogurt',
    brand_name: 'Fage',
    portion: 170,
    unit: 'g',
    serving_id: 's_metric',
    serving_description: '1 container (170 g)',
    calories: 100,
    proteins: 18,
    carbohydrates: 6,
    fats: 0,
    base_calories_per_100: 58.82,
    base_proteins_per_100: 10.59,
    base_carbs_per_100: 3.53,
    base_fats_per_100: 0,
    servings: [
      {
        serving_id: 's_metric',
        description: '1 container (170 g)',
        portion: 170,
        unit: 'g',
        is_metric: true,
        calories: 100,
        proteins: 18,
        carbohydrates: 6,
        fats: 0,
        base_calories_per_100: 58.82,
        base_proteins_per_100: 10.59,
        base_carbs_per_100: 3.53,
        base_fats_per_100: 0,
      },
      {
        // A second METRIC serving. The Worker filters non-metric ones out — a
        // per-serving basis cannot pass `validateBasis`'s gram-semantic
        // ceilings — so a fixture carrying one would not be a real payload.
        serving_id: 's_100g',
        description: '100 g',
        portion: 100,
        unit: 'g',
        is_metric: true,
        calories: 59,
        proteins: 10.6,
        carbohydrates: 3.5,
        fats: 0,
        base_calories_per_100: 59,
        base_proteins_per_100: 10.6,
        base_carbs_per_100: 3.5,
        base_fats_per_100: 0,
      },
    ],
    ...over,
  };
}

/** `/foods/search` answers both halves plus a provider verdict. */
function searchBody(over: Partial<HealthFoodSearchResponse> = {}): HealthFoodSearchResponse {
  const status: HealthFoodProviderStatus = over.provider?.status ?? 'ok';
  return {
    results: [],
    external: [],
    query: 'yog',
    sources: status === 'ok' ? ['library', 'fatsecret'] : ['library'],
    ...over,
    provider: over.provider ?? { id: 'fatsecret', configured: true, status: 'ok' },
  };
}

function ingredientRow(over: Partial<HealthRecipeIngredient> = {}): HealthRecipeIngredient {
  return {
    name: 'Oats',
    quantity: 80,
    unit: 'g',
    food_id: 'cf_1',
    base_calories_per_100: 380,
    base_proteins_per_100: 13,
    base_carbs_per_100: 60,
    base_fats_per_100: 7,
    calories: 304,
    proteins: 10.4,
    carbohydrates: 48,
    fats: 5.6,
    ...over,
  };
}

function recipeRow(over: Partial<HealthRecipe> = {}): HealthRecipe {
  return {
    id: 'rcp_1',
    user_id: 'user-1',
    name: 'Porridge',
    description: null,
    ingredients: JSON.stringify([ingredientRow()]),
    servings: 2,
    total_calories: 304,
    total_proteins: 10.4,
    total_carbohydrates: 48,
    total_fats: 5.6,
    preparation_time: null,
    cooking_time: null,
    instructions: null,
    image_url: null,
    category: null,
    tags: '[]',
    is_favorite: false,
    use_count: 0,
    last_used_at: null,
    is_shared: false,
    share_code: null,
    ai_calculated: false,
    ai_confidence: null,
    created_at: ISO,
    updated_at: ISO,
    deleted_at: null,
    ...over,
  };
}

function scaledRow(over: Partial<HealthScaledRecipe> = {}): HealthScaledRecipe {
  return {
    recipe_id: 'rcp_1',
    name: 'Porridge',
    servings: 2,
    target_servings: 4,
    per_serving: { calories: 152, proteins: 5.2, carbohydrates: 24, fats: 2.8 },
    totals: { calories: 608, proteins: 20.8, carbohydrates: 96, fats: 11.2 },
    ingredients: [ingredientRow({ quantity: 160, calories: 608 })],
    ...over,
  };
}

/** Minimal stand-in for `/custom-foods` — create, update, delete, list, use. */
function fakeFoodServer(initial: HealthCustomFood[] = []): { rows: HealthCustomFood[] } {
  const state = { rows: [...initial] };
  api.listCustomFoods.mockImplementation(() => Promise.resolve(body({ foods: [...state.rows] })));
  api.createCustomFood.mockImplementation((payload) => {
    const row = foodRow({
      id: `cf_${state.rows.length + 1}`,
      name: payload.name,
      brand_name: payload.brand_name ?? null,
      portion: payload.portion ?? 100,
      unit: payload.unit ?? 'g',
      calories: payload.calories ?? 0,
      proteins: payload.proteins ?? 0,
      carbohydrates: payload.carbohydrates ?? 0,
      fats: payload.fats ?? 0,
      is_favorite: payload.is_favorite ?? false,
    });
    state.rows.push(row);
    return Promise.resolve(body({ food: row }));
  });
  api.updateCustomFood.mockImplementation((id, patch) => {
    state.rows = state.rows.map((row) =>
      row.id === id
        ? {
            ...row,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.is_favorite !== undefined ? { is_favorite: patch.is_favorite } : {}),
            ...(patch.calories !== undefined ? { calories: patch.calories } : {}),
          }
        : row
    );
    const found = state.rows.find((row) => row.id === id) ?? foodRow({ id });
    return Promise.resolve(body({ food: found }));
  });
  api.deleteCustomFood.mockImplementation((id) => {
    state.rows = state.rows.filter((row) => row.id !== id);
    return Promise.resolve(body({ deleted: true }));
  });
  return state;
}

function fakeRecipeServer(initial: HealthRecipe[] = []): { rows: HealthRecipe[] } {
  const state = { rows: [...initial] };
  api.listRecipes.mockImplementation(() => Promise.resolve(body({ recipes: [...state.rows] })));
  api.createRecipe.mockImplementation((payload) => {
    const row = recipeRow({
      id: `rcp_${state.rows.length + 1}`,
      name: payload.name,
      servings: payload.servings ?? 1,
      is_favorite: payload.is_favorite ?? false,
    });
    state.rows.push(row);
    return Promise.resolve(body({ recipe: row }));
  });
  api.updateRecipe.mockImplementation((id, patch) => {
    state.rows = state.rows.map((row) =>
      row.id === id
        ? {
            ...row,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.is_favorite !== undefined ? { is_favorite: patch.is_favorite } : {}),
          }
        : row
    );
    return Promise.resolve(body({ recipe: state.rows.find((row) => row.id === id) ?? recipeRow() }));
  });
  api.deleteRecipe.mockImplementation((id) => {
    state.rows = state.rows.filter((row) => row.id !== id);
    return Promise.resolve(body({ deleted: true }));
  });
  return state;
}

function installDefaults(): void {
  api.listCustomFoods.mockResolvedValue(body({ foods: [] }));
  api.createCustomFood.mockResolvedValue(body({ food: foodRow() }));
  api.updateCustomFood.mockResolvedValue(body({ food: foodRow() }));
  api.deleteCustomFood.mockResolvedValue(body({ deleted: true }));
  api.useCustomFood.mockResolvedValue(
    body({
      food: foodRow({ use_count: 1 }),
      logged: { calories: 380, proteins: 13, carbohydrates: 60, fats: 7 },
      usage: {
        id: 'fuh_1',
        user_id: 'user-1',
        food_id: 'cf_1',
        food_name: 'Oats',
        used_at: `${TODAY}T12:00:00`,
        meal_type: 'lunch',
        time_of_day: 'midday',
      },
    })
  );
  api.searchFoods.mockResolvedValue(
    body({
      results: [],
      external: [],
      query: '',
      sources: ['library'],
      provider: { id: 'fatsecret', configured: false, status: 'not_configured' },
    })
  );
  api.foodSuggestions.mockResolvedValue(
    body({ time_of_day: 'midday', meal_type: 'lunch', suggestions: [] })
  );
  api.listRecipes.mockResolvedValue(body({ recipes: [] }));
  api.createRecipe.mockResolvedValue(body({ recipe: recipeRow() }));
  api.updateRecipe.mockResolvedValue(body({ recipe: recipeRow() }));
  api.deleteRecipe.mockResolvedValue(body({ deleted: true }));
  api.scaleRecipe.mockResolvedValue(body({ scaled: scaledRow() }));
}

beforeEach(async () => {
  await storageHelpers.clearAll();
  await clearHealthCache([]);
  __setHealthOfflineForTests(false);
  jest.resetAllMocks();
  installDefaults();
  mockAddMealEntry.mockResolvedValue([]);
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

describe('healthFoodStorage — input handling', () => {
  it('HEALTH-FOOD-001: sanitizeDecimalInput keeps digits and one separator', () => {
    expect(sanitizeDecimalInput('100')).toBe('100');
    expect(sanitizeDecimalInput('1a0b0')).toBe('100');
    expect(sanitizeDecimalInput('30.5.7')).toBe('30.57');
    expect(sanitizeDecimalInput('30,5')).toBe('30,5');
    expect(sanitizeDecimalInput(null as unknown as string)).toBe('');
  });

  it('HEALTH-FOOD-002: an amount KEEPS its decimals — rounding here would change the basis', () => {
    // The Worker derives `base_*_per_100` from (portion, macros). Rounding 0.5
    // of a serving to 1 would silently halve every portion derived afterwards.
    expect(parseFoodAmount('12.5')).toBe(12.5);
    expect(parseFoodAmount('12,5')).toBe(12.5);
    expect(parseFoodAmount('')).toBe(0);
    expect(parseFoodAmount('-1')).toBeNull();
    expect(parseFoodAmount('abc')).toBeNull();
    expect(parseFoodAmount('100001')).toBeNull(); // past the route bound
  });

  it('HEALTH-FOOD-003: a portion of zero is rejected — it divides into the basis', () => {
    expect(parseFoodPortion('0')).toBeNull();
    expect(parseFoodPortion('')).toBeNull();
    expect(parseFoodPortion('0.5')).toBe(0.5);
  });

  it('HEALTH-FOOD-004: servings is a whole 1..100 head count', () => {
    expect(parseServingsInput('4')).toBe(4);
    expect(parseServingsInput('0')).toBeNull();
    expect(parseServingsInput('101')).toBeNull();
    expect(parseServingsInput('2.5')).toBeNull();
    expect(parseServingsInput('')).toBeNull();
  });

  it('HEALTH-FOOD-005: formatMacro renders a server figure without inventing precision', () => {
    expect(formatMacro(380)).toBe('380');
    expect(formatMacro(10.44)).toBe('10.4');
    expect(formatMacro(10.46)).toBe('10.5');
    expect(formatMacro(NaN)).toBe('0');
  });

  it('HEALTH-FOOD-006: localWallClockStamp sends the device clock, not UTC', () => {
    // The Worker reads the literal hour out of this string to bucket the time of
    // day. `toISOString()` would file a 20:00 dinner in UTC+4 as "night".
    const stamp = localWallClockStamp(new Date(2026, 6, 13, 20, 5, 0));
    expect(stamp).toBe('2026-07-13T20:05:00');
    expect(stamp.endsWith('Z')).toBe(false);
  });

  it('HEALTH-FOOD-007: sortFoods mirrors the Worker order — favourites, most used, name', () => {
    const make = (over: Partial<FoodItem>): FoodItem =>
      fromWireFood(foodRow({ id: over.id ?? 'x', name: over.name ?? 'x' }));
    const a = { ...make({ id: 'a', name: 'Banana' }), useCount: 1 };
    const b = { ...make({ id: 'b', name: 'Apple' }), useCount: 9 };
    const c = { ...make({ id: 'c', name: 'Cheese' }), isFavorite: true, useCount: 0 };

    expect(sortFoods([a, b, c]).map((f) => f.id)).toEqual(['c', 'b', 'a']);
    expect(sortFoods([a, b, c], 'most-used').map((f) => f.id)).toEqual(['b', 'a', 'c']);
  });

  it('HEALTH-FOOD-008: viewFoods filters before ordering', () => {
    const base = fromWireFood(foodRow());
    const foods = [
      { ...base, id: 'a', isFavorite: false, useCount: 3 },
      { ...base, id: 'b', isFavorite: true, useCount: 0 },
      { ...base, id: 'c', isFavorite: false, useCount: 0 },
    ];
    expect(viewFoods(foods, 'favorites').map((f) => f.id)).toEqual(['b']);
    expect(viewFoods(foods, 'most-used').map((f) => f.id)).toEqual(['a']);
    expect(viewFoods(foods, 'all')).toHaveLength(3);
  });

  it('HEALTH-FOOD-009: matchFoods is a plain name/brand match, never a fake score', () => {
    const base = fromWireFood(foodRow());
    const foods = [
      { ...base, id: 'a', name: 'Greek yoghurt', brand: null },
      { ...base, id: 'b', name: 'Oats', brand: 'Quaker' },
    ];
    expect(matchFoods(foods, 'yog').map((f) => f.id)).toEqual(['a']);
    expect(matchFoods(foods, 'quak').map((f) => f.id)).toEqual(['b']);
    expect(matchFoods(foods, '')).toEqual([]);
  });

  it('HEALTH-FOOD-010: rejectionMessageFor maps a status to friendly copy, never a raw string', () => {
    // The error's own message ("Request failed with status code 400") must never
    // reach the UI — only the status is ever inspected.
    expect(rejectionMessageFor(httpError(400))).toContain('do not add up');
    expect(rejectionMessageFor(httpError(404))).toBe(MISSING_FOOD_MESSAGE);
    expect(rejectionMessageFor(httpError(403))).toContain('sign in again');
    // No answer / a server wobble both behave like being offline.
    expect(rejectionMessageFor(NETWORK_ERROR)).toBeNull();
    expect(rejectionMessageFor(httpError(500))).toBeNull();
    for (const status of [400, 404, 403, 418]) {
      expect(rejectionMessageFor(httpError(status))).not.toContain('Request failed');
    }
  });
});

/* ------------------------------------------------------------------ */
/* Wire ↔ screen mapping                                               */
/* ------------------------------------------------------------------ */

describe('healthFoodStorage — wire mapping', () => {
  it('HEALTH-FOOD-011: fromWireFood renames the server serving, it never derives one', () => {
    // 45 g of a 380 kcal/100 g basis = 171 kcal. The row already says so; the
    // mapper must copy that, not multiply the basis out itself.
    const mapped = fromWireFood(
      foodRow({ portion: 45, calories: 171, proteins: 5.85, carbohydrates: 27, fats: 3.15 })
    );
    expect(mapped.serving).toEqual({ calories: 171, protein: 5.85, carbs: 27, fat: 3.15 });
    expect(mapped.portion).toBe(45);
    // `base_*_per_100` is deliberately absent from the screen shape: nothing on
    // the device is allowed to portion from it.
    expect(mapped).not.toHaveProperty('base_calories_per_100');
  });

  it('HEALTH-FOOD-012: fromWireMacros renames the wire spelling', () => {
    expect(fromWireMacros({ calories: 1, proteins: 2, carbohydrates: 3, fats: 4 })).toEqual({
      calories: 1,
      protein: 2,
      carbs: 3,
      fat: 4,
    });
    expect(fromWireMacros(null)).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it('HEALTH-RECIPE-001: fromWireRecipe takes the stored totals and parses the blob', () => {
    const mapped = fromWireRecipe(recipeRow());
    expect(mapped.totals).toEqual({ calories: 304, protein: 10.4, carbs: 48, fat: 5.6 });
    expect(mapped.servings).toBe(2);
    expect(mapped.ingredients).toEqual([
      {
        name: 'Oats',
        quantity: 80,
        unit: 'g',
        foodId: 'cf_1',
        macros: { calories: 304, protein: 10.4, carbs: 48, fat: 5.6 },
      },
    ]);
    // No `perServing`: dividing totals by servings is the server's job.
    expect(mapped).not.toHaveProperty('perServing');
  });

  it('HEALTH-RECIPE-002: a corrupt ingredients blob degrades to empty, not a crash', () => {
    expect(parseIngredientsJson('not json')).toEqual([]);
    expect(parseIngredientsJson('{"nope":true}')).toEqual([]);
    expect(fromWireRecipe(recipeRow({ ingredients: 'oops' })).ingredients).toEqual([]);
  });

  it('HEALTH-FOOD-013: toFoodPayload sends the portion + its macros, never a per-100 basis', () => {
    const payload = toFoodPayload({
      name: '  Greek yoghurt  ',
      brand: '  Fage  ',
      portion: 170,
      unit: 'g',
      calories: 160,
      protein: 17,
      carbs: 6,
      fat: 8,
    });
    expect(payload).toEqual({
      name: 'Greek yoghurt',
      brand_name: 'Fage',
      portion: 170,
      unit: 'g',
      calories: 160,
      proteins: 17,
      carbohydrates: 6,
      fats: 8,
      is_favorite: false,
      // A draft with no explicit origin was typed in. The AI label scanner
      // (P3, `HealthScanScreen`) is the one caller that sends `'scanned'`.
      source_type: 'manual',
    });
    // Deriving `base_*_per_100` on the device is exactly what this feature bans.
    expect(payload).not.toHaveProperty('base_calories_per_100');
  });

  it('HEALTH-AI-200: an explicit sourceType rides through to the wire', () => {
    // `source_type` has been in the route's enum since 0120 and nothing ever
    // wrote anything but the default, so the column could not distinguish a
    // scanned food from a typed one until the scanner shipped.
    const payload = toFoodPayload({
      name: 'Greek yoghurt',
      portion: 170,
      unit: 'g',
      calories: 160,
      sourceType: 'scanned',
    });
    expect(payload.source_type).toBe('scanned');
  });

  it('HEALTH-FOOD-014: toFoodPayload clamps to the route bounds and nulls a blank brand', () => {
    const payload = toFoodPayload({
      name: 'x'.repeat(200),
      brand: '   ',
      portion: 999999,
      unit: 'g',
      calories: -5,
    });
    expect(payload.name).toHaveLength(120);
    expect(payload.brand_name).toBeNull();
    expect(payload.portion).toBe(100000);
    expect(payload.calories).toBe(0);
    expect(payload.proteins).toBe(0);
  });

  it('HEALTH-RECIPE-003: toRecipePayload sends quantities + food ids, and no macros', () => {
    const payload = toRecipePayload({
      name: 'Porridge',
      servings: 2,
      ingredients: [{ name: 'Oats', quantity: 80, unit: 'g', foodId: 'cf_1' }],
    });
    expect(payload).toEqual({
      name: 'Porridge',
      description: null,
      servings: 2,
      is_favorite: false,
      category: null,
      preparation_time: null,
      cooking_time: null,
      image_url: null,
      ingredients: [{ name: 'Oats', quantity: 80, unit: 'g', food_id: 'cf_1' }],
    });
    // Totals are the Worker's — sending ours would just be ignored (rule 2).
    expect(payload).not.toHaveProperty('total_calories');
  });

  it('HEALTH-RECIPE-004: toRecipePayload clamps servings into the 1..100 route bound', () => {
    const draft = { name: 'x', ingredients: [{ name: 'a', quantity: 1 }] };
    expect(toRecipePayload({ ...draft, servings: 0 }).servings).toBe(1);
    expect(toRecipePayload({ ...draft, servings: 500 }).servings).toBe(100);
  });
});

/* ------------------------------------------------------------------ */
/* Wire contract — foods                                               */
/* ------------------------------------------------------------------ */

describe('healthFoodStorage — foods wire contract', () => {
  it('HEALTH-FOOD-015: an empty account reads as an empty library', async () => {
    expect(await loadFoods()).toEqual([]);
    expect(api.listCustomFoods).toHaveBeenCalled();
  });

  it('HEALTH-FOOD-016: the library is fetched UNFILTERED so the cache stays complete', async () => {
    fakeFoodServer([foodRow({ id: 'a', is_favorite: true }), foodRow({ id: 'b', name: 'Rice' })]);

    expect(await loadFoods('favorites')).toHaveLength(1);
    // Caching a filtered response under the one snapshot key would leave the
    // offline read showing only the favourites the user last looked at.
    expect(api.listCustomFoods).toHaveBeenCalledWith();
    expect(await storageHelpers.getObject<FoodItem[]>(HEALTH_FOODS_KEY)).toHaveLength(2);
  });

  it('HEALTH-FOOD-017: createFood posts the donor column names and refreshes the library', async () => {
    fakeFoodServer();

    const result = await createFood({
      name: 'Oats',
      portion: 100,
      unit: 'g',
      calories: 380,
      protein: 13,
      carbs: 60,
      fat: 7,
    });

    expect(api.createCustomFood).toHaveBeenCalledWith({
      name: 'Oats',
      brand_name: null,
      portion: 100,
      unit: 'g',
      calories: 380,
      proteins: 13,
      carbohydrates: 60,
      fats: 7,
      is_favorite: false,
      // Explicit rather than absent: a food with no stated origin was typed in,
      // and the AI scanner is the only caller that sends anything else.
      source_type: 'manual',
    });
    expect(result.status).toBe('saved');
    expect(result.message).toBeNull();
    // The refreshed row replaces the locally minted one.
    expect(result.foods.map((f) => f.id)).toEqual(['cf_1']);
  });

  it('HEALTH-FOOD-018: updateFood re-sends the whole portion + macro pair', async () => {
    fakeFoodServer([foodRow({ id: 'cf_1' })]);

    await updateFood('cf_1', {
      name: 'Oats',
      portion: 45,
      unit: 'g',
      calories: 171,
      protein: 5.85,
      carbs: 27,
      fat: 3.15,
    });

    // A patch that changed the portion WITHOUT its macros would make the Worker
    // re-derive from the old basis and silently misreport the food.
    expect(api.updateCustomFood).toHaveBeenCalledWith(
      'cf_1',
      expect.objectContaining({ portion: 45, calories: 171, proteins: 5.85 })
    );
  });

  it('HEALTH-FOOD-019: setFoodFavorite sends ONLY the flag', async () => {
    fakeFoodServer([foodRow({ id: 'cf_1' })]);

    const result = await setFoodFavorite('cf_1', true);

    // Re-sending the macros would make the Worker re-derive a basis the user
    // never edited.
    expect(api.updateCustomFood).toHaveBeenCalledWith('cf_1', { is_favorite: true });
    expect(result.foods[0].isFavorite).toBe(true);
  });

  it('HEALTH-FOOD-020: deleteFood removes the row through the soft-delete route', async () => {
    fakeFoodServer([foodRow({ id: 'cf_1' }), foodRow({ id: 'cf_2', name: 'Rice' })]);

    const result = await deleteFood('cf_1');

    expect(api.deleteCustomFood).toHaveBeenCalledWith('cf_1');
    expect(result.foods.map((f) => f.id)).toEqual(['cf_2']);
  });

  it('HEALTH-FOOD-021: search hits /foods/search with `query`, not `q`', async () => {
    api.searchFoods.mockResolvedValue(
      searchBody({
        results: [{ ...foodRow({ id: 'cf_9', name: 'Oat milk' }), relevance_score: 900 }],
        query: 'oat',
      })
    );

    const hits = await searchFoods('  oat  ');

    // `undefined` is the second argument: the route defaults to including the
    // food database, so the client must not send `include_external` at all.
    expect(api.searchFoods).toHaveBeenCalledWith('oat', undefined);
    expect(hits.library.map((f) => f.name)).toEqual(['Oat milk']);
    expect(hits.external).toEqual([]);
    expect(hits.providerNotice).toBeNull();
    expect(hits.offline).toBe(false);
  });

  it('HEALTH-FOOD-022: a 1-character needle answers from the cache instead of collecting a 400', async () => {
    fakeFoodServer([foodRow({ id: 'cf_1', name: 'Oats' })]);
    await loadFoods();

    expect((await searchFoods('o')).library.map((f) => f.name)).toEqual(['Oats']);
    expect(api.searchFoods).not.toHaveBeenCalled();
    const blank = await searchFoods('');
    expect(blank.library).toEqual([]);
    expect(blank.external).toEqual([]);
  });

  it('HEALTH-FOOD-023: suggestions carry the device wall clock and map the server slot', async () => {
    api.foodSuggestions.mockResolvedValue(
      body({
        time_of_day: 'midday',
        meal_type: 'snack',
        suggestions: [
          { food: foodRow({ id: 'cf_1' }), score: 0.8, reasons: ['favorite', 'recently_used'] },
        ],
      })
    );

    const result = await loadFoodSuggestions();

    expect(api.foodSuggestions).toHaveBeenCalledWith({
      meal_type: undefined,
      at: '2026-07-13T12:00:00',
    });
    expect(result?.timeOfDay).toBe('midday');
    // 'snack' on the wire is 'snacks' in the app's slot vocabulary.
    expect(result?.mealSlot).toBe('snacks');
    expect(result?.suggestions[0].reasons).toEqual(['favorite', 'recently_used']);
  });

  it('HEALTH-FOOD-024: suggestions are never cached — a stale time bucket is worse than none', async () => {
    api.foodSuggestions.mockRejectedValue(NETWORK_ERROR);

    expect(await loadFoodSuggestions()).toBeNull();
    // Nothing is written under a suggestions key: the answer is a function of
    // the CURRENT time bucket, so a snapshot would offer porridge at dinner.
    expect(await storageHelpers.getObject('health.foodSuggestions.v1')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Log to diary                                                        */
/* ------------------------------------------------------------------ */

describe('healthFoodStorage — log to diary', () => {
  it('HEALTH-FOOD-025: logging posts the use and files the SERVER-derived serving', async () => {
    fakeFoodServer([foodRow({ id: 'cf_1', name: 'Oats' })]);
    api.useCustomFood.mockResolvedValue(
      body({
        food: foodRow({ id: 'cf_1', use_count: 1 }),
        // 45 g of the stored basis, computed by the Worker.
        logged: { calories: 171, proteins: 5.85, carbohydrates: 27, fats: 3.15 },
        usage: {
          id: 'fuh_1',
          user_id: 'user-1',
          food_id: 'cf_1',
          food_name: 'Oats',
          used_at: `${TODAY}T12:00:00`,
          meal_type: 'lunch',
          time_of_day: 'midday',
        },
      })
    );

    const result = await logFoodToDiary('cf_1', { mealSlot: 'lunch', portion: 45 });

    expect(api.useCustomFood).toHaveBeenCalledWith('cf_1', {
      meal_type: 'lunch',
      used_at: '2026-07-13T12:00:00',
      portion: 45,
    });
    // The diary row carries the Worker's figures verbatim — nothing was
    // multiplied out here — PLUS the provenance 0124 added, so the entry can be
    // re-portioned later instead of being frozen at what it was logged at.
    expect(mockAddMealEntry).toHaveBeenCalledWith({
      name: 'Oats',
      slot: 'lunch',
      calories: 171,
      protein: 5.85,
      carbs: 27,
      fat: 3.15,
      date: TODAY,
      foodId: 'cf_1',
      portion: 45,
      unit: 'g',
    });
    expect(result.logged).toEqual({ calories: 171, protein: 5.85, carbs: 27, fat: 3.15 });
    expect(result.status).toBe('saved');
  });

  it("HEALTH-FOOD-140: with no portion asked for, the FOOD's own portion is filed", async () => {
    fakeFoodServer([foodRow({ id: 'cf_1', name: 'Oats', portion: 100, unit: 'g' })]);
    api.useCustomFood.mockResolvedValue(
      body({
        food: foodRow({ id: 'cf_1', use_count: 1 }),
        logged: { calories: 380, proteins: 13, carbohydrates: 60, fats: 7 },
        usage: {
          id: 'fuh_1',
          user_id: 'user-1',
          food_id: 'cf_1',
          food_name: 'Oats',
          used_at: `${TODAY}T12:00:00`,
          meal_type: 'lunch',
          time_of_day: 'midday',
        },
      })
    );

    await logFoodToDiary('cf_1', { mealSlot: 'lunch' });

    // The portion has to match the macros the Worker derived, or the diary row
    // would claim 380 kcal "per 1 serving" and rescale wrongly ever after.
    expect(mockAddMealEntry).toHaveBeenCalledWith(
      expect.objectContaining({ foodId: 'cf_1', portion: 100, unit: 'g' })
    );
  });

  it('HEALTH-FOOD-026: the slot the SERVER filed the use under wins over the requested one', async () => {
    fakeFoodServer([foodRow({ id: 'cf_1' })]);
    api.useCustomFood.mockResolvedValue(
      body({
        food: foodRow({ id: 'cf_1' }),
        logged: { calories: 380, proteins: 13, carbohydrates: 60, fats: 7 },
        usage: {
          id: 'fuh_1',
          user_id: 'user-1',
          food_id: 'cf_1',
          food_name: 'Oats',
          used_at: `${TODAY}T12:00:00`,
          // The route derives the slot from the time of day when it disagrees.
          meal_type: 'snack',
          time_of_day: 'afternoon',
        },
      })
    );

    const result = await logFoodToDiary('cf_1', { mealSlot: 'breakfast' });

    expect(result.mealSlot).toBe('snacks');
    expect(mockAddMealEntry).toHaveBeenCalledWith(expect.objectContaining({ slot: 'snacks' }));
  });

  it('HEALTH-FOOD-027: logging a food that is gone is rejected, not silently diarised', async () => {
    fakeFoodServer([]);

    const result = await logFoodToDiary('missing', { mealSlot: 'lunch' });

    expect(result.status).toBe('rejected');
    expect(result.message).toBe(MISSING_FOOD_MESSAGE);
    expect(api.useCustomFood).not.toHaveBeenCalled();
    expect(mockAddMealEntry).not.toHaveBeenCalled();
  });

  it('HEALTH-FOOD-028: defaults to the fallback slot only when none was chosen', async () => {
    fakeFoodServer([foodRow({ id: 'cf_1' })]);
    await logFoodToDiary('cf_1');

    expect(api.useCustomFood).toHaveBeenCalledWith(
      'cf_1',
      expect.objectContaining({ meal_type: 'snack' })
    );
    expect(DEFAULT_MEAL_SLOT).toBe('snacks');
  });
});

/* ------------------------------------------------------------------ */
/* Recipes wire contract                                               */
/* ------------------------------------------------------------------ */

describe('healthFoodStorage — recipes wire contract', () => {
  it('HEALTH-RECIPE-005: an empty account reads as an empty recipe book', async () => {
    expect(await loadRecipes()).toEqual([]);
  });

  it('HEALTH-RECIPE-006: createRecipe posts ingredients and takes the server totals back', async () => {
    fakeRecipeServer();

    const result = await createRecipe({
      name: 'Porridge',
      servings: 2,
      ingredients: [{ name: 'Oats', quantity: 80, unit: 'g', foodId: 'cf_1' }],
    });

    expect(api.createRecipe).toHaveBeenCalledWith({
      name: 'Porridge',
      description: null,
      servings: 2,
      is_favorite: false,
      category: null,
      preparation_time: null,
      cooking_time: null,
      image_url: null,
      ingredients: [{ name: 'Oats', quantity: 80, unit: 'g', food_id: 'cf_1' }],
    });
    expect(result.recipes[0].totals.calories).toBe(304);
  });

  it('HEALTH-RECIPE-007: updateRecipe replaces the ingredient list wholesale', async () => {
    fakeRecipeServer([recipeRow({ id: 'rcp_1' })]);

    await updateRecipe('rcp_1', {
      name: 'Porridge',
      servings: 4,
      ingredients: [{ name: 'Oats', quantity: 160, unit: 'g', foodId: 'cf_1' }],
    });

    expect(api.updateRecipe).toHaveBeenCalledWith(
      'rcp_1',
      expect.objectContaining({
        servings: 4,
        ingredients: [{ name: 'Oats', quantity: 160, unit: 'g', food_id: 'cf_1' }],
      })
    );
  });

  it('HEALTH-RECIPE-008: setRecipeFavorite sends only the flag', async () => {
    fakeRecipeServer([recipeRow({ id: 'rcp_1' })]);

    const result = await setRecipeFavorite('rcp_1', true);

    expect(api.updateRecipe).toHaveBeenCalledWith('rcp_1', { is_favorite: true });
    expect(result.recipes[0].isFavorite).toBe(true);
  });

  it('HEALTH-RECIPE-009: deleteRecipe drops it from the book', async () => {
    fakeRecipeServer([recipeRow({ id: 'rcp_1' }), recipeRow({ id: 'rcp_2', name: 'Chilli' })]);

    const result = await deleteRecipe('rcp_1');

    expect(api.deleteRecipe).toHaveBeenCalledWith('rcp_1');
    expect(result.recipes.map((r) => r.id)).toEqual(['rcp_2']);
  });

  it('HEALTH-RECIPE-010: per-serving comes from /recipes/:id/scale, never from a local division', async () => {
    api.scaleRecipe.mockResolvedValue(body({ scaled: scaledRow() }));

    const scaled = await scaleRecipe('rcp_1', 4);

    expect(api.scaleRecipe).toHaveBeenCalledWith('rcp_1', 4);
    // 304 total / 2 servings = 152 — but the number rendered is the SERVER's,
    // so the app can never disagree with it after an edit or a re-round.
    expect(scaled?.perServing).toEqual({ calories: 152, protein: 5.2, carbs: 24, fat: 2.8 });
    expect(scaled?.totals.calories).toBe(608);
    expect(scaled?.targetServings).toBe(4);
    expect(scaled?.ingredients[0].quantity).toBe(160);
  });

  it('HEALTH-RECIPE-011: a scale target is clamped into the route bound before it is sent', async () => {
    await scaleRecipe('rcp_1', 0);
    expect(api.scaleRecipe).toHaveBeenCalledWith('rcp_1', 1);

    await scaleRecipe('rcp_1', 900);
    expect(api.scaleRecipe).toHaveBeenLastCalledWith('rcp_1', 100);
  });
});

/* ------------------------------------------------------------------ */
/* Recipe → diary (donor RecipePortionPickerView)                      */
/* ------------------------------------------------------------------ */

/** A 4-serving bake with round totals, so the scaling maths is readable. */
const BAKE = recipeRow({
  id: 'rcp_bake',
  name: 'Chicken bake',
  servings: 4,
  total_calories: 2000,
  total_proteins: 100,
  total_carbohydrates: 200,
  total_fats: 80,
});

/**
 * `/recipes/:id/scale`, running the Worker's OWN arithmetic (`scaleTotals` in
 * `health-food-service.ts`): `stored totals × target ÷ stored servings`, to two
 * decimals, always from the exact stored totals — never from the rounded
 * per-serving figure, which is what makes a scale round trip return.
 */
function fakeScaleServer(recipe = BAKE): void {
  const round2 = (value: number) => Math.round(value * 100) / 100;
  api.scaleRecipe.mockImplementation((id, servings) => {
    if (id !== recipe.id) return Promise.reject(httpError(404));
    const factor = servings / Math.max(1, recipe.servings);
    return Promise.resolve(
      body({
        scaled: scaledRow({
          recipe_id: recipe.id,
          name: recipe.name,
          servings: recipe.servings,
          target_servings: servings,
          per_serving: {
            calories: round2(recipe.total_calories / recipe.servings),
            proteins: round2(recipe.total_proteins / recipe.servings),
            carbohydrates: round2(recipe.total_carbohydrates / recipe.servings),
            fats: round2(recipe.total_fats / recipe.servings),
          },
          totals: {
            calories: round2(recipe.total_calories * factor),
            proteins: round2(recipe.total_proteins * factor),
            carbohydrates: round2(recipe.total_carbohydrates * factor),
            fats: round2(recipe.total_fats * factor),
          },
        }),
      })
    );
  });
}

describe('healthFoodStorage — recipe to diary', () => {
  it('HEALTH-RECIPE-101: logs the SERVER\'s scaled totals for the chosen head count', async () => {
    fakeRecipeServer([BAKE]);
    fakeScaleServer();

    const result = await logRecipeToDiary('rcp_bake', { servings: 2, mealSlot: 'dinner' });

    // 2000 kcal for 4 servings, logged at 2 ⇒ 1000. The device multiplied
    // nothing: this is `totals × 2 ÷ 4` as the Worker computed it.
    expect(api.scaleRecipe).toHaveBeenCalledWith('rcp_bake', 2);
    expect(result.status).toBe('saved');
    expect(result.logged).toEqual({ calories: 1000, protein: 50, carbs: 100, fat: 40 });
    expect(mockAddMealEntry).toHaveBeenCalledWith(
      expect.objectContaining({ calories: 1000, protein: 50, carbs: 100, fat: 40 })
    );
  });

  it('HEALTH-RECIPE-102: scaling always starts from the stored totals, so a round trip returns', async () => {
    fakeRecipeServer([BAKE]);
    fakeScaleServer();

    const half = await logRecipeToDiary('rcp_bake', { servings: 2, mealSlot: 'dinner' });
    const whole = await logRecipeToDiary('rcp_bake', { servings: 4, mealSlot: 'dinner' });

    // The donor derives from `caloriesPerServing`, which is INTEGER division —
    // a 4→3→4 trip there does not come back. Here 4 servings logs the recipe's
    // exact stored total, whatever was asked for in between.
    expect(half.logged?.calories).toBe(1000);
    expect(whole.logged?.calories).toBe(BAKE.total_calories);
    expect(whole.logged).toEqual({ calories: 2000, protein: 100, carbs: 200, fat: 80 });
  });

  it('HEALTH-RECIPE-103: writes ONE row, named bare, with portion/unit in servings and no food_id', async () => {
    fakeRecipeServer([BAKE]);
    fakeScaleServer();

    await logRecipeToDiary('rcp_bake', { servings: 3, mealSlot: 'lunch', date: '2026-07-11' });

    expect(mockAddMealEntry).toHaveBeenCalledTimes(1);
    const sent = mockAddMealEntry.mock.calls[0][0];
    // Donor `Recipe.toNutritionEntry` writes `recipe.name` bare — the head count
    // lives in portion/unit, so the diary never grows a "(3 servings)" suffix
    // that stops matching the recipe after a rename.
    expect(sent.name).toBe('Chicken bake');
    expect(sent).toMatchObject({ slot: 'lunch', date: '2026-07-11', portion: 3, unit: 'serving' });
    // A recipe id is NOT a custom-food id: `resolveNutritionBasis` looks
    // `food_id` up in `custom_foods` and the create would 404.
    expect(sent).not.toHaveProperty('foodId');
    // Ingredients are never expanded into separate rows.
    expect(mockAddMealEntry).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-RECIPE-104: the head count is clamped to the route\'s integer 1..100 bound', async () => {
    fakeRecipeServer([BAKE]);
    fakeScaleServer();

    await logRecipeToDiary('rcp_bake', { servings: 0, mealSlot: 'dinner' });
    expect(api.scaleRecipe).toHaveBeenLastCalledWith('rcp_bake', 1);

    await logRecipeToDiary('rcp_bake', { servings: 900, mealSlot: 'dinner' });
    expect(api.scaleRecipe).toHaveBeenLastCalledWith('rcp_bake', 100);

    // Deliberate divergence from the donor's 0.5 stepper: `/recipes/:id/scale`
    // validates `z.number().int()`, and halving `per_serving` here to fake a
    // fraction is exactly the device-side arithmetic this module forbids.
    await logRecipeToDiary('rcp_bake', { servings: 2.5, mealSlot: 'dinner' });
    expect(api.scaleRecipe).toHaveBeenLastCalledWith('rcp_bake', 3);
  });

  it('HEALTH-RECIPE-105: with no scale answer nothing is logged, and it says so', async () => {
    fakeRecipeServer([BAKE]);
    api.scaleRecipe.mockRejectedValue(NETWORK_ERROR);

    const result = await logRecipeToDiary('rcp_bake', { servings: 2, mealSlot: 'dinner' });

    // Writing the stored one-batch totals instead would log 2000 kcal for a
    // two-serving portion — a number the server would never agree with.
    expect(result.status).toBe('unavailable');
    expect(result.message).toBe(RECIPE_LOG_OFFLINE_MESSAGE);
    expect(result.logged).toBeNull();
    expect(mockAddMealEntry).not.toHaveBeenCalled();
  });

  it('HEALTH-RECIPE-106: a recipe that is no longer in the library never writes a row', async () => {
    fakeRecipeServer([BAKE]);
    fakeScaleServer();

    const result = await logRecipeToDiary('rcp_gone', { servings: 2, mealSlot: 'dinner' });

    expect(result.status).toBe('missing');
    expect(result.message).toBe(MISSING_RECIPE_MESSAGE);
    expect(api.scaleRecipe).not.toHaveBeenCalled();
    expect(mockAddMealEntry).not.toHaveBeenCalled();
  });

  it('HEALTH-RECIPE-107: defaults to today and the default slot when neither is given', async () => {
    fakeRecipeServer([BAKE]);
    fakeScaleServer();

    const result = await logRecipeToDiary('rcp_bake', { servings: 1 });

    expect(result.mealSlot).toBe(DEFAULT_MEAL_SLOT);
    expect(mockAddMealEntry).toHaveBeenCalledWith(
      expect.objectContaining({ slot: DEFAULT_MEAL_SLOT, date: TODAY })
    );
  });
});

/* ------------------------------------------------------------------ */
/* Offline triad + rejection                                           */
/* ------------------------------------------------------------------ */

describe('healthFoodStorage — offline contract', () => {
  it('HEALTH-FOOD-029: a failed read falls back to the cached library', async () => {
    await storageHelpers.setObject(HEALTH_FOODS_KEY, [
      fromWireFood(foodRow({ id: 'cached', name: 'Rye bread' })),
    ]);
    api.listCustomFoods.mockRejectedValue(NETWORK_ERROR);

    expect((await loadFoods()).map((f) => f.name)).toEqual(['Rye bread']);
    expect(healthSyncStateFor(HEALTH_FOODS_KEY)).toBe('offline');
  });

  it('HEALTH-FOOD-030: server rows are mirrored into MMKV for the next cold start', async () => {
    fakeFoodServer([foodRow({ id: 'cf_1' })]);

    await loadFoods();

    expect(await storageHelpers.getObject<FoodItem[]>(HEALTH_FOODS_KEY)).toHaveLength(1);
    expect(healthSyncStateFor(HEALTH_FOODS_KEY)).toBe('synced');
  });

  it('HEALTH-FOOD-031: an offline create keeps the optimistic food and says so', async () => {
    __setHealthOfflineForTests(true);

    const result = await createFood({
      name: 'Oats',
      portion: 100,
      unit: 'g',
      calories: 380,
    });

    expect(api.createCustomFood).not.toHaveBeenCalled();
    expect(result.status).toBe('offline');
    expect(result.message).toContain('sync when you are back online');
    expect(result.foods.map((f) => f.name)).toEqual(['Oats']);
    // The locally minted id renders and removes fine, but can never satisfy a
    // PUT/DELETE route — the refreshed server row replaces it.
    expect(result.foods[0].id.startsWith('local-')).toBe(true);
    expect((await loadFoods()).map((f) => f.name)).toEqual(['Oats']);
  });

  it('HEALTH-FOOD-032: an offline delete drops the row from the optimistic library', async () => {
    await storageHelpers.setObject(HEALTH_FOODS_KEY, [
      fromWireFood(foodRow({ id: 'a', name: 'Keep' })),
      fromWireFood(foodRow({ id: 'b', name: 'Drop' })),
    ]);
    __setHealthOfflineForTests(true);

    expect((await deleteFood('b')).foods.map((f) => f.name)).toEqual(['Keep']);
  });

  it('HEALTH-FOOD-033: an offline log still diarises, using the cached server serving', async () => {
    await storageHelpers.setObject(HEALTH_FOODS_KEY, [
      fromWireFood(foodRow({ id: 'cf_1', name: 'Oats', calories: 380, proteins: 13 })),
    ]);
    __setHealthOfflineForTests(true);

    const result = await logFoodToDiary('cf_1', { mealSlot: 'breakfast' });

    expect(result.status).toBe('offline');
    // No server answer, so there is no `logged` figure — the cached row's own
    // serving (itself server-derived) stands in. Nothing is calculated here.
    expect(result.logged).toBeNull();
    expect(mockAddMealEntry).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 'breakfast', calories: 380, protein: 13 })
    );
  });

  it('HEALTH-FOOD-034: a REJECTED create rolls the optimistic row back', async () => {
    fakeFoodServer([foodRow({ id: 'cf_1', name: 'Oats' })]);
    await loadFoods();
    api.createCustomFood.mockRejectedValue(httpError(400));

    const result = await createFood({
      name: 'Impossible',
      portion: 1,
      unit: 'g',
      calories: 5000,
    });

    expect(result.status).toBe('rejected');
    expect(result.message).toContain('do not add up');
    // A phantom food would outlive the session and reappear on every cold start.
    expect(result.foods.map((f) => f.name)).toEqual(['Oats']);
    expect(
      (await storageHelpers.getObject<FoodItem[]>(HEALTH_FOODS_KEY))?.map((f) => f.name)
    ).toEqual(['Oats']);
  });

  it('HEALTH-FOOD-035: a REJECTED delete puts the row back', async () => {
    fakeFoodServer([foodRow({ id: 'cf_1', name: 'Oats' })]);
    await loadFoods();
    api.deleteCustomFood.mockRejectedValue(httpError(404));

    const result = await deleteFood('cf_1');

    expect(result.status).toBe('rejected');
    expect(result.message).toBe(MISSING_FOOD_MESSAGE);
    expect(result.foods.map((f) => f.id)).toEqual(['cf_1']);
  });

  it('HEALTH-FOOD-036: a failed search degrades to the cached library, never an error', async () => {
    fakeFoodServer([foodRow({ id: 'cf_1', name: 'Oat milk' })]);
    await loadFoods();
    api.searchFoods.mockRejectedValue(NETWORK_ERROR);

    // Ranking is the Worker's; offline this is an honest substring match rather
    // than a pretend score — and it SAYS so, instead of passing the cached
    // subset off as an authoritative answer.
    const outcome = await searchFoods('oat');
    expect(outcome.library.map((f) => f.name)).toEqual(['Oat milk']);
    expect(outcome.external).toEqual([]);
    expect(outcome.offline).toBe(true);
    expect(outcome.providerNotice).toBe(SEARCH_OFFLINE_MESSAGE);
  });

  it('HEALTH-FOOD-037: a corrupt cached snapshot degrades to empty instead of crashing', async () => {
    await storageHelpers.setObject(HEALTH_FOODS_KEY, { nope: true });
    __setHealthOfflineForTests(true);
    expect(await loadFoods()).toEqual([]);

    await storageHelpers.setObject(HEALTH_FOODS_KEY, [
      fromWireFood(foodRow({ id: 'ok' })),
      { id: 'broken' },
      null,
    ]);
    expect((await loadFoods()).map((f) => f.id)).toEqual(['ok']);
  });

  it('HEALTH-RECIPE-012: a failed recipe read falls back to the cached book', async () => {
    await storageHelpers.setObject(HEALTH_RECIPES_KEY, [fromWireRecipe(recipeRow())]);
    api.listRecipes.mockRejectedValue(NETWORK_ERROR);

    expect((await loadRecipes()).map((r) => r.name)).toEqual(['Porridge']);
    expect(healthSyncStateFor(HEALTH_RECIPES_KEY)).toBe('offline');
  });

  it('HEALTH-RECIPE-013: an offline recipe shows ZERO totals rather than a made-up sum', async () => {
    __setHealthOfflineForTests(true);

    const result = await createRecipe({
      name: 'Porridge',
      servings: 2,
      ingredients: [{ name: 'Oats', quantity: 80, foodId: 'cf_1' }],
    });

    expect(result.status).toBe('offline');
    // Totals are the Worker's to compute. Inventing a local sum would put a
    // number on screen the server is about to disagree with.
    expect(result.recipes[0].totals).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it('HEALTH-RECIPE-014: an unavailable scale answer is null — the app never divides instead', async () => {
    api.scaleRecipe.mockRejectedValue(NETWORK_ERROR);

    // The screen shows "needs a connection"; showing `totals / servings` here
    // would be the exact recompute this architecture forbids.
    expect(await scaleRecipe('rcp_1', 4)).toBeNull();
  });

  it('HEALTH-RECIPE-015: a corrupt cached recipe snapshot degrades to empty', async () => {
    await storageHelpers.setObject(HEALTH_RECIPES_KEY, { nope: true });
    __setHealthOfflineForTests(true);
    expect(await loadRecipes()).toEqual([]);

    await storageHelpers.setObject(HEALTH_RECIPES_KEY, [
      fromWireRecipe(recipeRow({ id: 'ok' })),
      { id: 'broken' },
    ]);
    expect((await loadRecipes()).map((r: RecipeItem) => r.id)).toEqual(['ok']);
  });

  it('HEALTH-FOOD-039: the client unwraps BOTH the bare body and a `data` envelope', () => {
    // `api.*` types every body as `ApiResponse<T>`, but the Health Worker
    // answers with the bare object (`c.json({ foods })`). Reading only one shape
    // would render an empty library against the deployed Worker — or against a
    // future one that starts wrapping.
    const { healthFoodPayload } = jest.requireActual<
      typeof import('@api/healthFood')
    >('@api/healthFood');

    expect(healthFoodPayload({ foods: [] } as never)).toEqual({ foods: [] });
    expect(healthFoodPayload({ data: { foods: [] } })).toEqual({ foods: [] });
    expect(healthFoodPayload(undefined)).toBeUndefined();
    expect(
      healthFoodPayload({ error: { code: 'not_found', message: 'gone' } })
    ).toBeUndefined();
  });

  it('HEALTH-FOOD-038: the diary cache is untouched by a food-library write', async () => {
    fakeFoodServer();
    await storageHelpers.setObject(HEALTH_MEALS_KEY, []);

    await createFood({ name: 'Oats', portion: 100, unit: 'g', calories: 380 });

    // Only `addMealEntry` may write the diary; the library writer must not
    // stamp over it (the two snapshots are cleared together on sign-out).
    expect(await storageHelpers.getObject(HEALTH_MEALS_KEY)).toEqual([]);
  });
});

/* ==================================================================== */
/* External food database (parity phase P3)                              */
/* ==================================================================== */

/**
 * The donor's FatSecret integration, client half.
 *
 * Two properties this block exists to hold:
 *
 *  1. **A lookup is not a possession.** A provider hit renders, but nothing in
 *     the app can log, favourite or re-portion it until `importExternalFood`
 *     has made it a real `custom_foods` row. Nothing here writes an optimistic
 *     row for it, because the row's figures are the Worker's to derive.
 *  2. **Every failure has a sentence.** Missing credential, rate limit, outage
 *     and a flat-offline handset each produce their own copy — never an error
 *     string, and never a silent empty list, which would read as "no such food".
 */
describe('healthFoodStorage — external food database', () => {
  it('HEALTH-FOOD-200: a search maps both halves and names the provider verdict', async () => {
    api.searchFoods.mockResolvedValue(
      searchBody({
        results: [{ ...foodRow({ id: 'cf_1', name: 'My yogurt' }), relevance_score: 900 }],
        external: [externalRow()],
      })
    );

    const outcome = await searchFoods('yog');

    expect(outcome.library.map((f) => f.id)).toEqual(['cf_1']);
    expect(outcome.external.map((f) => f.id)).toEqual(['fatsecret:33691']);
    // The provider answered, so there is nothing to explain.
    expect(outcome.providerNotice).toBeNull();
    expect(outcome.offline).toBe(false);
  });

  it('HEALTH-FOOD-201: a provider hit keeps the server figures and is not a library food', () => {
    const hit = fromWireExternalFood(externalRow());

    // Renamed, never derived — the same rule `fromWireFood` follows.
    expect(hit.serving).toEqual({ calories: 100, protein: 18, carbs: 6, fat: 0 });
    expect(hit.per100.calories).toBe(58.82);
    expect(hit.providerFoodId).toBe('33691');
    expect(hit.servingId).toBe('s_metric');
    expect(hit.servings.map((s) => s.id)).toEqual(['s_metric', 's_100g']);
    // Namespaced: it can never be mistaken for, or collide with, a `cf_…` row.
    expect(hit.id.startsWith('fatsecret:')).toBe(true);
    expect(hit).not.toHaveProperty('useCount');
    expect(hit).not.toHaveProperty('isFavorite');
  });

  it('HEALTH-FOOD-202: a missing credential says so and still answers from the library', async () => {
    api.searchFoods.mockResolvedValue(
      searchBody({
        results: [{ ...foodRow({ id: 'cf_1' }), relevance_score: 100 }],
        provider: { id: 'fatsecret', configured: false, status: 'not_configured' },
      })
    );

    const outcome = await searchFoods('oat');

    expect(outcome.library.map((f) => f.id)).toEqual(['cf_1']);
    expect(outcome.external).toEqual([]);
    expect(outcome.providerNotice).toBe(PROVIDER_NOT_CONFIGURED_MESSAGE);
    // The one thing this must never be: an unexplained empty database section.
    expect(outcome.providerNotice).not.toContain('not_configured');
  });

  it('HEALTH-FOOD-203: a rate-limited provider is a different sentence from an outage', async () => {
    expect(providerNoticeFor('rate_limited')).toBe(PROVIDER_RATE_LIMITED_MESSAGE);
    expect(providerNoticeFor('unavailable')).toBe(PROVIDER_UNAVAILABLE_MESSAGE);
    expect(providerNoticeFor('not_configured')).toBe(PROVIDER_NOT_CONFIGURED_MESSAGE);
    // Nothing to say when it worked, or when it was never asked.
    expect(providerNoticeFor('ok')).toBeNull();
    expect(providerNoticeFor('skipped')).toBeNull();
    expect(providerNoticeFor(undefined)).toBeNull();

    api.searchFoods.mockResolvedValue(
      searchBody({ provider: { id: 'fatsecret', configured: true, status: 'rate_limited' } })
    );
    expect((await searchFoods('oat')).providerNotice).toBe(PROVIDER_RATE_LIMITED_MESSAGE);
  });

  it('HEALTH-FOOD-204: `includeExternal: false` asks the route to skip the provider', async () => {
    api.searchFoods.mockResolvedValue(
      searchBody({ provider: { id: 'fatsecret', configured: true, status: 'skipped' } })
    );

    const outcome = await searchFoods('oat', { includeExternal: false });

    expect(api.searchFoods).toHaveBeenCalledWith('oat', { include_external: false });
    expect(outcome.external).toEqual([]);
    expect(outcome.providerNotice).toBeNull();
  });

  /* ---- barcode lookup (parity P5) — same provider, same status discipline ---- */

  it('HEALTH-BARCODE-101: a found code maps onto the SAME shape a search hit uses', async () => {
    api.lookupBarcode.mockResolvedValue(
      body({
        barcode: '0012345678905',
        food: externalRow(),
        provider: { id: 'fatsecret', configured: true, status: 'ok' },
      })
    );

    const outcome = await lookupFoodBarcode('012345678905');

    expect(api.lookupBarcode).toHaveBeenCalledWith('012345678905');
    expect(outcome.food).toEqual(fromWireExternalFood(externalRow()));
    expect(outcome.providerNotice).toBeNull();
    expect(outcome.offline).toBe(false);
  });

  it('HEALTH-BARCODE-102: a well-formed code the database does not hold is `food: null` with NO notice — not an error', async () => {
    api.lookupBarcode.mockResolvedValue(
      body({
        barcode: '0000000000000',
        food: null,
        provider: { id: 'fatsecret', configured: true, status: 'ok' },
      })
    );

    const outcome = await lookupFoodBarcode('0000000000000');

    expect(outcome.food).toBeNull();
    // `status: 'ok'` + `food: null` is "not found", a DIFFERENT fact from a
    // provider outage — `providerNotice` must stay null so the screen can
    // tell the two apart and never blame the database for a real miss.
    expect(outcome.providerNotice).toBeNull();
  });

  it('HEALTH-BARCODE-103: not_configured / rate_limited / unavailable each get their OWN sentence, matching /foods/search', async () => {
    api.lookupBarcode.mockResolvedValue(
      body({ barcode: '1', food: null, provider: { id: 'fatsecret', configured: false, status: 'not_configured' } })
    );
    expect((await lookupFoodBarcode('1')).providerNotice).toBe(PROVIDER_NOT_CONFIGURED_MESSAGE);

    api.lookupBarcode.mockResolvedValue(
      body({ barcode: '1', food: null, provider: { id: 'fatsecret', configured: true, status: 'rate_limited' } })
    );
    expect((await lookupFoodBarcode('1')).providerNotice).toBe(PROVIDER_RATE_LIMITED_MESSAGE);

    api.lookupBarcode.mockResolvedValue(
      body({ barcode: '1', food: null, provider: { id: 'fatsecret', configured: true, status: 'unavailable' } })
    );
    expect((await lookupFoodBarcode('1')).providerNotice).toBe(PROVIDER_UNAVAILABLE_MESSAGE);
  });

  it('HEALTH-BARCODE-104: a request that never reaches the Worker gets its own offline copy, not a raw error', async () => {
    api.lookupBarcode.mockRejectedValue(NETWORK_ERROR);

    const outcome = await lookupFoodBarcode('012345678905');

    expect(outcome.food).toBeNull();
    expect(outcome.offline).toBe(true);
    expect(outcome.providerNotice).toBe(BARCODE_OFFLINE_MESSAGE);
    expect(outcome.providerNotice).not.toContain('Network request failed');
  });

  it('HEALTH-FOOD-205: importing sends only the id and serving, never macros', async () => {
    fakeFoodServer([]);
    const saved = foodRow({ id: 'cf_ext', name: 'Greek Yogurt', portion: 170, calories: 100 });
    api.importExternalFood.mockResolvedValue(body({ food: saved, created: true }));
    api.listCustomFoods.mockResolvedValue(body({ foods: [saved] }));

    const hit = fromWireExternalFood(externalRow());
    const result = await importExternalFood(hit, { servingId: 's_100g', mealSlot: 'breakfast' });

    expect(api.importExternalFood).toHaveBeenCalledWith({
      provider: 'fatsecret',
      provider_food_id: '33691',
      serving_id: 's_100g',
      preferred_meal_types: ['breakfast'],
    });
    // No macro key of any kind goes up: the Worker re-fetches and derives the
    // stored basis, so a client can never inject figures under a brand name.
    const sent = api.importExternalFood.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(sent)).not.toContain('calories');
    expect(Object.keys(sent)).not.toContain('base_calories_per_100');

    expect(result.status).toBe('saved');
    expect(result.created).toBe(true);
    expect(result.food?.id).toBe('cf_ext');
    expect(result.foods.map((f) => f.id)).toEqual(['cf_ext']);
  });

  it('HEALTH-FOOD-206: a repeat import reports `created: false` and overwrites nothing', async () => {
    const existing = foodRow({ id: 'cf_ext', name: 'Greek Yogurt' });
    api.importExternalFood.mockResolvedValue(body({ food: existing, created: false }));
    api.listCustomFoods.mockResolvedValue(body({ foods: [existing] }));

    const result = await importExternalFood(fromWireExternalFood(externalRow()));

    expect(result.status).toBe('saved');
    expect(result.created).toBe(false);
    expect(result.food?.id).toBe('cf_ext');
  });

  it('HEALTH-FOOD-207: offline, an import adds nothing and says nothing was added', async () => {
    fakeFoodServer([foodRow({ id: 'cf_1' })]);
    await loadFoods();
    __setHealthOfflineForTests(true);
    api.importExternalFood.mockRejectedValue(NETWORK_ERROR);

    const result = await importExternalFood(fromWireExternalFood(externalRow()));

    // Unlike a typed food, there is no local row to keep: the figures do not
    // exist until the Worker has derived them.
    expect(result.status).toBe('offline');
    expect(result.message).toBe(IMPORT_OFFLINE_MESSAGE);
    expect(result.food).toBeNull();
    expect(result.created).toBe(false);
    expect(result.foods.map((f) => f.id)).toEqual(['cf_1']);
    // The cached library is exactly what it was — no phantom row survives.
    expect(
      ((await storageHelpers.getObject(HEALTH_FOODS_KEY)) as FoodItem[]).map((f) => f.id)
    ).toEqual(['cf_1']);
  });

  it('HEALTH-FOOD-208: a refused import maps its STATUS to copy, never its body', async () => {
    expect(importFailureMessageFor(httpError(404))).toBe(IMPORT_MISSING_MESSAGE);
    expect(importFailureMessageFor(httpError(429))).toBe(PROVIDER_RATE_LIMITED_MESSAGE);
    expect(importFailureMessageFor(httpError(503))).toBe(PROVIDER_UNAVAILABLE_MESSAGE);
    expect(importFailureMessageFor(httpError(422))).toBe(IMPORT_REJECTED_MESSAGE);
    expect(importFailureMessageFor(httpError(401))).toBe('Please sign in again to save this.');
    // No answer at all is not a refusal — `writeThrough` owns that case.
    expect(importFailureMessageFor(NETWORK_ERROR)).toBeNull();

    fakeFoodServer([foodRow({ id: 'cf_1' })]);
    await loadFoods();
    api.importExternalFood.mockRejectedValue(httpError(404));

    const result = await importExternalFood(fromWireExternalFood(externalRow()));
    expect(result.status).toBe('rejected');
    expect(result.message).toBe(IMPORT_MISSING_MESSAGE);
    expect(result.foods.map((f) => f.id)).toEqual(['cf_1']);
  });

  it('HEALTH-FOOD-209: "log from the database" imports first, then logs the STORED row', async () => {
    const saved = foodRow({ id: 'cf_ext', name: 'Greek Yogurt', portion: 170, calories: 100 });
    api.importExternalFood.mockResolvedValue(body({ food: saved, created: true }));
    api.listCustomFoods.mockResolvedValue(body({ foods: [saved] }));
    api.useCustomFood.mockResolvedValue(
      body({
        food: { ...saved, use_count: 1 },
        logged: { calories: 100, proteins: 18, carbohydrates: 6, fats: 0 },
        usage: {
          id: 'fuh_9',
          user_id: 'user-1',
          food_id: 'cf_ext',
          food_name: 'Greek Yogurt',
          used_at: `${TODAY}T12:00:00`,
          meal_type: 'breakfast',
          time_of_day: 'morning',
        },
      })
    );

    const result = await logExternalFoodToDiary(fromWireExternalFood(externalRow()), {
      mealSlot: 'breakfast',
    });

    expect(result.status).toBe('saved');
    expect(result.created).toBe(true);
    expect(result.logged).toEqual({ calories: 100, protein: 18, carbs: 6, fat: 0 });
    // The use is recorded against the IMPORTED row, at the imported portion.
    expect(api.useCustomFood).toHaveBeenCalledWith('cf_ext', {
      meal_type: 'breakfast',
      used_at: localWallClockStamp(),
      portion: 170,
    });
    // And the diary row carries its provenance, so it can be re-portioned (0124).
    expect(mockAddMealEntry).toHaveBeenCalledWith(
      expect.objectContaining({ foodId: 'cf_ext', portion: 170, unit: 'g', slot: 'breakfast' })
    );
  });

  it('HEALTH-FOOD-210: a failed import logs NOTHING to the diary', async () => {
    fakeFoodServer([]);
    api.importExternalFood.mockRejectedValue(httpError(503));

    const result = await logExternalFoodToDiary(fromWireExternalFood(externalRow()), {
      mealSlot: 'lunch',
    });

    expect(result.status).toBe('rejected');
    expect(result.message).toBe(PROVIDER_UNAVAILABLE_MESSAGE);
    expect(result.logged).toBeNull();
    // Both halves or neither — a meal with no food behind it is worse than none.
    expect(mockAddMealEntry).not.toHaveBeenCalled();
    expect(api.useCustomFood).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Partial and hostile payloads                                        */
/* ------------------------------------------------------------------ */

/**
 * Everything below feeds the mappers a row the Worker would not normally send:
 * a column omitted rather than nulled, a list absent rather than empty, a
 * non-string where a string was declared.
 *
 * The reason this matters more here than in most stores is that the food tab is
 * the only one with a THIRD-PARTY payload behind it. A FatSecret hit is shaped
 * by the Worker, but its contents come from a provider, and a row missing a
 * serving list or a unit is a row the provider had less of — not an error. Every
 * one of these has to land on a legible screen figure rather than a `NaN`, an
 * `undefined` or a throw inside a `.map`.
 */
describe('healthFoodStorage — partial and hostile payloads', () => {
  it('HEALTH-FOOD-230: an amount or head count that is not a string is refused, not coerced', () => {
    // These are fed straight from `onChangeText`, but the same helpers are
    // called from the scan screen and the recipe form; `Number(null)` is 0,
    // which would read as "the user typed zero".
    expect(parseFoodAmount(null as unknown as string)).toBeNull();
    expect(parseFoodAmount(undefined as unknown as string)).toBeNull();
    expect(parseFoodPortion(null as unknown as string)).toBeNull();
    expect(parseServingsInput(null as unknown as string)).toBeNull();
    expect(parseServingsInput(4 as unknown as string)).toBeNull();
  });

  it('HEALTH-FOOD-231: a search for a non-string needle answers empty, not everything', async () => {
    expect(await searchFoods(undefined as unknown as string)).toEqual({
      library: [],
      external: [],
      providerNotice: null,
      offline: false,
    });
    expect(api.searchFoods).not.toHaveBeenCalled();
  });

  it('HEALTH-FOOD-232: a custom food row with columns omitted still renders a whole row', () => {
    const mapped = fromWireFood({ id: 'cf_x', name: 'Mystery' } as unknown as HealthCustomFood);

    // 100 g is the basis unit the whole feature is built on, so it is the only
    // honest stand-in for an absent portion — and a blank unit would render as
    // "100  · 0 kcal".
    expect(mapped.portion).toBe(100);
    expect(mapped.unit).toBe('g');
    expect(mapped.serving).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
    expect(mapped.useCount).toBe(0);
    expect(mapped.isFavorite).toBe(false);
    expect(mapped.brand).toBeNull();
    expect(mapped.lastUsedAt).toBeNull();
    expect(Object.values(mapped).every((v) => !Number.isNaN(v))).toBe(true);
  });

  it('HEALTH-FOOD-233: a provider hit with no servings, unit or ids is still selectable', () => {
    const hit = fromWireExternalFood({
      id: 'fatsecret:9',
      provider: 'fatsecret',
      provider_food_id: '9',
      name: 'Unbranded thing',
    } as unknown as HealthExternalFood);

    expect(hit.portion).toBe(100);
    expect(hit.unit).toBe('g');
    expect(hit.servingId).toBeNull();
    expect(hit.servingDescription).toBeNull();
    // No servings at all means no picker — never a picker of one blank chip.
    expect(hit.servings).toEqual([]);
    expect(hit.per100).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it('HEALTH-FOOD-234: a serving with no id of its own gets a positional one', () => {
    // The id is what the chosen-serving state is keyed by, so two servings that
    // both answered `null` would be the same chip, and picking one would light
    // the other.
    const hit = fromWireExternalFood(
      externalRow({ servings: [{}, {}] as unknown as HealthExternalFood['servings'] })
    );

    expect(hit.servings.map((s) => s.id)).toEqual(['idx_0', 'idx_1']);
    expect(hit.servings[0].description).toBe('');
    expect(hit.servings[0].portion).toBe(100);
    expect(hit.servings[0].unit).toBe('g');
    expect(hit.servings[0].isMetric).toBe(false);
  });

  it('HEALTH-FOOD-235: an ingredient blob with columns omitted maps to a whole ingredient', () => {
    const [ingredient] = parseIngredientsJson('[{}]');

    expect(ingredient).toEqual({
      name: '',
      quantity: 0,
      unit: 'g',
      foodId: null,
      macros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
  });

  it('HEALTH-FOOD-236: a recipe row with no ingredients column reads as no ingredients', () => {
    const mapped = fromWireRecipe({
      id: 'rcp_x',
      name: 'Empty',
      updated_at: ISO,
    } as unknown as HealthRecipe);

    expect(mapped.ingredients).toEqual([]);
    expect(mapped.servings).toBe(1);
    expect(mapped.totals).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
    expect(mapped.isFavorite).toBe(false);
  });

  it('HEALTH-FOOD-237: a scaled answer with no ingredient list still carries its totals', async () => {
    api.scaleRecipe.mockResolvedValue(
      body({
        scaled: {
          recipe_id: 'rcp_1',
          name: 'Porridge',
          servings: 2,
          target_servings: 4,
          per_serving: { calories: 152, proteins: 5.2, carbohydrates: 24, fats: 2.8 },
          totals: { calories: 608, proteins: 20.8, carbohydrates: 96, fats: 11.2 },
        } as unknown as HealthScaledRecipe,
      })
    );

    const scaled = await scaleRecipe('rcp_1', 4);

    // The totals are what the diary row is written from; the ingredient list is
    // a nicety, so losing it must not lose the figure.
    expect(scaled?.totals.calories).toBe(608);
    expect(scaled?.ingredients).toEqual([]);
  });

  it('HEALTH-FOOD-238: a scaled answer with nothing in it is "unavailable", not zero', async () => {
    api.scaleRecipe.mockResolvedValue(body({} as { scaled: HealthScaledRecipe }));

    // Null is what makes `logRecipeToDiary` refuse; a zeroed ScaledRecipe would
    // write a 0 kcal meal for a real recipe.
    expect(await scaleRecipe('rcp_1', 4)).toBeNull();
  });

  it('HEALTH-FOOD-239: every list answered without its list reads as empty, never a throw', async () => {
    api.listCustomFoods.mockResolvedValue(body({} as { foods: HealthCustomFood[] }));
    api.listRecipes.mockResolvedValue(body({} as { recipes: HealthRecipe[] }));
    api.searchFoods.mockResolvedValue(
      body({ query: 'oat', sources: ['library'] } as unknown as HealthFoodSearchResponse)
    );

    expect(await loadFoods()).toEqual([]);
    expect(await loadRecipes()).toEqual([]);
    const outcome = await searchFoods('oat');
    expect(outcome.library).toEqual([]);
    expect(outcome.external).toEqual([]);
    // No provider verdict at all is not a fault to report — the notice card
    // only exists to explain a verdict that was given.
    expect(outcome.providerNotice).toBeNull();
    expect(outcome.offline).toBe(false);
  });

  it('HEALTH-FOOD-240: a suggestions answer with nothing in it drops the card', async () => {
    api.foodSuggestions.mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof api.foodSuggestions>>
    );
    expect(await loadFoodSuggestions()).toBeNull();
  });

  it('HEALTH-FOOD-241: a suggestion with no reason list still offers the food', async () => {
    api.foodSuggestions.mockResolvedValue(
      body({
        time_of_day: 'evening',
        meal_type: 'dinner',
        suggestions: [{ food: foodRow({ id: 'cf_1', name: 'Oats' }) }],
      } as unknown as Awaited<ReturnType<typeof api.foodSuggestions>>)
    );

    const suggestions = await loadFoodSuggestions('dinner');

    // The screen joins the reasons into a caption and falls back to
    // "Suggested"; an absent list must reach it as `[]`, not as undefined.
    expect(suggestions?.suggestions[0].reasons).toEqual([]);
    expect(suggestions?.suggestions[0].score).toBe(0);
    expect(suggestions?.mealSlot).toBe('dinner');
    // Asking about a specific meal sends that meal; asking about "now" does not.
    expect(api.foodSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ meal_type: 'dinner' })
    );
  });

  it('HEALTH-FOOD-242: a suggestions answer with no list at all is an empty card, not a crash', async () => {
    api.foodSuggestions.mockResolvedValue(
      body({ time_of_day: 'midday', meal_type: 'lunch' } as unknown as Awaited<
        ReturnType<typeof api.foodSuggestions>
      >)
    );

    expect((await loadFoodSuggestions())?.suggestions).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* One writer, one row                                                 */
/* ------------------------------------------------------------------ */

describe('healthFoodStorage — a writer touches only its own row', () => {
  it('HEALTH-FOOD-243: editing or favouriting one food leaves the rest of the library alone', async () => {
    fakeFoodServer([
      foodRow({ id: 'cf_1', name: 'Oats', calories: 380 }),
      foodRow({ id: 'cf_2', name: 'Yoghurt', calories: 100, is_favorite: true }),
    ]);
    await loadFoods();
    __setHealthOfflineForTests(true); // the optimistic list IS the answer

    const edited = await updateFood('cf_1', {
      name: 'Jumbo oats',
      portion: 50,
      unit: 'g',
      calories: 190,
    });
    const untouched = edited.foods.find((f) => f.id === 'cf_2');
    expect(edited.foods.find((f) => f.id === 'cf_1')?.name).toBe('Jumbo oats');
    expect(untouched).toMatchObject({ name: 'Yoghurt', isFavorite: true });
    expect(untouched?.serving.calories).toBe(100);

    const favourited = await setFoodFavorite('cf_1', true);
    expect(favourited.foods.find((f) => f.id === 'cf_1')?.isFavorite).toBe(true);
    expect(favourited.foods.find((f) => f.id === 'cf_2')?.isFavorite).toBe(true);
  });

  it('HEALTH-FOOD-244: logging one food bumps only that food’s use count', async () => {
    fakeFoodServer([
      foodRow({ id: 'cf_1', name: 'Oats', use_count: 4 }),
      foodRow({ id: 'cf_2', name: 'Yoghurt', use_count: 9 }),
    ]);
    await loadFoods();
    __setHealthOfflineForTests(true);

    const result = await logFoodToDiary('cf_1', { mealSlot: 'breakfast' });

    expect(result.foods.find((f) => f.id === 'cf_1')?.useCount).toBe(5);
    expect(result.foods.find((f) => f.id === 'cf_2')?.useCount).toBe(9);
    expect(result.foods.find((f) => f.id === 'cf_2')?.lastUsedAt).toBeNull();
  });

  it('HEALTH-FOOD-245: most-used breaks a tie by RECENCY, and a never-used food sorts last', () => {
    const base = fromWireFood(foodRow());
    const foods = [
      { ...base, id: 'stale', useCount: 3, lastUsedAt: '2026-07-01T09:00:00' },
      { ...base, id: 'never', useCount: 3, lastUsedAt: null },
      { ...base, id: 'fresh', useCount: 3, lastUsedAt: '2026-07-12T09:00:00' },
    ];

    // Same count, so the tie-break is "which did you reach for last" — the
    // question the Most used filter is actually asking.
    expect(sortFoods(foods, 'most-used').map((f) => f.id)).toEqual(['fresh', 'stale', 'never']);
  });

  it('HEALTH-FOOD-246: a blank unit falls back to the basis unit, never to an empty label', () => {
    // `unit` is rendered straight onto every row ("100 g"), and the route
    // requires a non-empty string.
    expect(toFoodPayload({ name: 'Oats', portion: 100, unit: '', calories: 380 }).unit).toBe('g');
  });

  it('HEALTH-FOOD-247: a `use` the Worker refuses writes NOTHING to the diary', async () => {
    fakeFoodServer([foodRow({ id: 'cf_1', name: 'Oats' })]);
    await loadFoods();
    api.useCustomFood.mockRejectedValue(httpError(404));

    const result = await logFoodToDiary('cf_1', { mealSlot: 'lunch' });

    expect(result.status).toBe('rejected');
    expect(result.message).toBe(MISSING_FOOD_MESSAGE);
    expect(result.logged).toBeNull();
    // The whole point of the early return: a refused use must not leave a meal
    // in the diary for a food the server says is gone.
    expect(mockAddMealEntry).not.toHaveBeenCalled();
    expect(result.message).not.toContain('Request failed');
  });

  it('HEALTH-FOOD-248: a `use` answered without a usage row still files the asked-for meal', async () => {
    fakeFoodServer([foodRow({ id: 'cf_1', name: 'Oats', portion: 100, calories: 380 })]);
    await loadFoods();
    api.useCustomFood.mockResolvedValue(
      body({ logged: { calories: 190, proteins: 6.5, carbohydrates: 30, fats: 3.5 } } as Awaited<
        ReturnType<typeof api.useCustomFood>
      >)
    );

    const result = await logFoodToDiary('cf_1', { mealSlot: 'breakfast' });

    // The server's own `logged` figures still win; only the SLOT falls back,
    // and it falls back to the one the member picked rather than to a default.
    expect(result.logged).toEqual({ calories: 190, protein: 6.5, carbs: 30, fat: 3.5 });
    expect(result.mealSlot).toBe('breakfast');
    expect(mockAddMealEntry).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 'breakfast', calories: 190 })
    );
  });

  it('HEALTH-FOOD-249: a `use` answered with nothing at all falls back to the cached serving', async () => {
    fakeFoodServer([foodRow({ id: 'cf_1', name: 'Oats', portion: 100, calories: 380 })]);
    await loadFoods();
    api.useCustomFood.mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof api.useCustomFood>>
    );

    const result = await logFoodToDiary('cf_1', { mealSlot: 'lunch' });

    // The cached serving is itself a SERVER figure off the stored row, so the
    // diary still gets a number nobody on this device worked out.
    expect(result.logged).toBeNull();
    expect(mockAddMealEntry).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 'lunch', calories: 380, foodId: 'cf_1', portion: 100 })
    );
  });
});

/* ------------------------------------------------------------------ */
/* Import options and refusals                                         */
/* ------------------------------------------------------------------ */

describe('healthFoodStorage — importing from the database', () => {
  it('HEALTH-FOOD-250: importing as a favourite says so on the wire, and only then', async () => {
    fakeFoodServer([]);
    const saved = foodRow({ id: 'cf_ext', name: 'Greek Yogurt' });
    api.importExternalFood.mockResolvedValue(body({ food: saved, created: true }));

    await importExternalFood(fromWireExternalFood(externalRow()), { isFavorite: true });
    expect(api.importExternalFood).toHaveBeenLastCalledWith(
      expect.objectContaining({ is_favorite: true })
    );

    // Not asked for is not the same as "false": leaving the key out lets the
    // route keep whatever the row already had.
    await importExternalFood(fromWireExternalFood(externalRow()));
    expect(api.importExternalFood).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ is_favorite: expect.anything() })
    );
  });

  it('HEALTH-FOOD-251: an import answered without a row is "not added yet", not a silent success', async () => {
    fakeFoodServer([foodRow({ id: 'cf_1' })]);
    await loadFoods();
    api.importExternalFood.mockResolvedValue(
      body({} as Awaited<ReturnType<typeof api.importExternalFood>>)
    );

    const result = await importExternalFood(fromWireExternalFood(externalRow()));

    expect(result.status).toBe('offline');
    expect(result.message).toBe(IMPORT_OFFLINE_MESSAGE);
    expect(result.food).toBeNull();
    expect(result.created).toBe(false);
    // Nothing was invented in the library either.
    expect(result.foods.map((f) => f.id)).toEqual(['cf_1']);
  });

  it('HEALTH-FOOD-252: "log from the database" with no options at all files under the default slot', async () => {
    const saved = foodRow({ id: 'cf_ext', name: 'Greek Yogurt', portion: 170, calories: 100 });
    api.importExternalFood.mockResolvedValue(body({ food: saved, created: true }));
    api.listCustomFoods.mockResolvedValue(body({ foods: [saved] }));
    api.useCustomFood.mockResolvedValue(
      body({
        food: { ...saved, use_count: 1 },
        logged: { calories: 100, proteins: 18, carbohydrates: 6, fats: 0 },
        usage: {
          id: 'fuh_2',
          user_id: 'user-1',
          food_id: 'cf_ext',
          food_name: 'Greek Yogurt',
          used_at: `${TODAY}T12:00:00`,
          meal_type: 'snack',
          time_of_day: 'midday',
        },
      })
    );

    const result = await logExternalFoodToDiary(fromWireExternalFood(externalRow()));

    // `snacks` is the only slot that claims nothing about the time of day, so
    // it is what an unasked-for meal lands in.
    expect(result.mealSlot).toBe(DEFAULT_MEAL_SLOT);
    expect(result.status).toBe('saved');
    expect(result.created).toBe(true);
    expect(api.importExternalFood).toHaveBeenCalledWith(
      expect.objectContaining({ preferred_meal_types: ['snack'] })
    );
  });

  it('HEALTH-FOOD-253: every remaining refusal status still maps to a sentence', () => {
    expect(importFailureMessageFor(httpError(403))).toBe('Please sign in again to save this.');
    // A 5xx the route did not name is the food database being down, which is
    // the honest thing to say and the one the member can act on (wait).
    expect(importFailureMessageFor(httpError(500))).toBe(PROVIDER_UNAVAILABLE_MESSAGE);
    expect(importFailureMessageFor(httpError(502))).toBe(PROVIDER_UNAVAILABLE_MESSAGE);
    // Anything else at all still gets words rather than nothing.
    expect(importFailureMessageFor(httpError(418))).toBe(IMPORT_REJECTED_MESSAGE);
    for (const status of [403, 418, 500, 502]) {
      expect(importFailureMessageFor(httpError(status))).not.toMatch(/Request failed|\b\d{3}\b/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Recipes — the same rules                                            */
/* ------------------------------------------------------------------ */

describe('healthFoodStorage — recipe writers and views', () => {
  it('HEALTH-RECIPE-116: the favourites view filters before ordering, like the food one', () => {
    const base = fromWireRecipe(recipeRow());
    const recipes = [
      { ...base, id: 'a', name: 'Zuppa', isFavorite: true, useCount: 0 },
      { ...base, id: 'b', name: 'Bake', isFavorite: false, useCount: 9 },
      { ...base, id: 'c', name: 'Ackee', isFavorite: true, useCount: 0 },
    ];

    expect(viewRecipes(recipes, 'favorites').map((r) => r.id)).toEqual(['c', 'a']);
    expect(viewRecipes(recipes, 'all').map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('HEALTH-RECIPE-117: a description is trimmed and kept; a blank one is stored as absent', () => {
    expect(toRecipePayload({ name: 'Porridge', servings: 2, ingredients: [], description: '  Warm oats  ' }).description).toBe('Warm oats');
    // '' in a nullable column would read as "the member wrote an empty note".
    expect(toRecipePayload({ name: 'Porridge', servings: 2, ingredients: [], description: '   ' }).description).toBeNull();
  });

  it('HEALTH-RECIPE-118: a free-text ingredient carries no food id, so nothing is resolved for it', async () => {
    fakeRecipeServer([]);
    __setHealthOfflineForTests(true);

    const result = await createRecipe({
      name: 'Porridge',
      servings: 2,
      ingredients: [
        { name: 'Oats', quantity: 80, unit: 'g', foodId: 'cf_1' },
        { name: 'Pinch of salt', quantity: 1, unit: 'g' },
      ],
    });

    const [ingredients] = result.recipes.map((r) => r.ingredients);
    expect(ingredients[0].foodId).toBe('cf_1');
    expect(ingredients[1].foodId).toBeNull();
    // A blank id would 404 the resolve; leaving the key out is what lets the
    // Worker treat it as an unresolvable, macro-free line.
    expect(api.createRecipe).not.toHaveBeenCalled(); // offline: nothing went up
  });

  it('HEALTH-RECIPE-119: editing or favouriting one recipe leaves the others alone', async () => {
    fakeRecipeServer([
      recipeRow({ id: 'rcp_1', name: 'Porridge' }),
      recipeRow({ id: 'rcp_2', name: 'Chilli', is_favorite: true, use_count: 4 }),
    ]);
    await loadRecipes();
    __setHealthOfflineForTests(true);

    const edited = await updateRecipe('rcp_1', {
      name: 'Overnight oats',
      servings: 2,
      ingredients: [{ name: 'Oats', quantity: 80 }],
    });
    expect(edited.recipes.find((r) => r.id === 'rcp_1')?.name).toBe('Overnight oats');
    expect(edited.recipes.find((r) => r.id === 'rcp_2')).toMatchObject({
      name: 'Chilli',
      isFavorite: true,
      useCount: 4,
    });

    const favourited = await setRecipeFavorite('rcp_1', true);
    expect(favourited.recipes.find((r) => r.id === 'rcp_1')?.isFavorite).toBe(true);
    expect(favourited.recipes.find((r) => r.id === 'rcp_2')?.useCount).toBe(4);
  });
});
