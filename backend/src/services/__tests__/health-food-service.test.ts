/**
 * HealthFoodService — the maths of the ported Symply Health FOOD domain (P2).
 *
 * The routes are a thin pass-through (covered in routes/__tests__/health-food.test.ts);
 * everything a phone, a widget and a watch must AGREE on is computed here, so
 * this suite owns the four donor rules:
 *
 *   1. `base_*_per_100` is the EXACT basis — a portion is DERIVED from it, never
 *      rescaled from an already-rounded serving. The "compounding" spec below
 *      shows what the rescaling approach actually costs.
 *   2. Recipe totals are computed SERVER-SIDE from the ingredient array and are
 *      divided by `servings`; the client's own totals are ignored.
 *   3. The `time_of_day` buckets that drive suggestions are pinned at every
 *      boundary hour.
 *   4. Search and suggestion relevance follow the donor's weights.
 *
 * D1-backed specs run against live miniflare D1 with the migration-0120 DDL from
 * routes/__tests__/health-test-helpers.ts (same cross-directory helper pattern as
 * services/__tests__/health-service.test.ts).
 */

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createHealthFoodTables,
  createHealthTables,
  resetHealthFoodTables,
  resetHealthTables,
  seedHealthUsers,
} from '../../routes/__tests__/health-test-helpers';
import type { Env } from '../../types';
import {
  HealthFoodService,
  basisFrom,
  levenshtein,
  perServingFrom,
  portionFrom,
  primaryMealTypeFor,
  recipeTotals,
  round2,
  scaleTotals,
  searchScore,
  suggestionScore,
  timeOfDayFor,
  validateBasis,
  wordMatchScore,
  type MacroBasis,
  type MealType,
  type ResolvedIngredient,
} from '../health-food-service';

const testEnv = env as unknown as Env;

const UID = 'u_food_alice';
const OTHER = 'u_food_bob';

/** Oats: a real, awkward basis — 155.5 kcal/100g never divides cleanly. */
const OATS: MacroBasis = {
  base_calories_per_100: 155.5,
  base_proteins_per_100: 13.2,
  base_carbs_per_100: 67.7,
  base_fats_per_100: 6.9,
};

function svc(): HealthFoodService {
  return new HealthFoodService(testEnv.DB);
}

function ingredient(over: Partial<ResolvedIngredient> = {}): ResolvedIngredient {
  const basis: MacroBasis = {
    base_calories_per_100: over.base_calories_per_100 ?? 100,
    base_proteins_per_100: over.base_proteins_per_100 ?? 10,
    base_carbs_per_100: over.base_carbs_per_100 ?? 20,
    base_fats_per_100: over.base_fats_per_100 ?? 5,
  };
  const quantity = over.quantity ?? 100;
  return {
    name: over.name ?? 'Thing',
    quantity,
    unit: over.unit ?? 'g',
    food_id: over.food_id ?? null,
    ...basis,
    ...portionFrom(basis, quantity),
  };
}

/* ==================================================================== */
/* Rule 1 — the per-100 basis is the source of truth                     */
/* ==================================================================== */

describe('portion maths (rule 1: derive from base_*_per_100)', () => {
  it('derives a portion from the basis', () => {
    expect(portionFrom(OATS, 100)).toEqual({
      calories: 155.5,
      proteins: 13.2,
      carbohydrates: 67.7,
      fats: 6.9,
    });
    expect(portionFrom(OATS, 50)).toEqual({
      calories: 77.75,
      proteins: 6.6,
      carbohydrates: 33.85,
      fats: 3.45,
    });
    expect(portionFrom(OATS, 0).calories).toBe(0);
  });

  it('is EXACT under repeated re-portioning — 20 hops land on the one-shot value', () => {
    // The property the donor's base_* columns exist for: the 20th portion is
    // computed from the same basis as the 1st, so nothing accumulates.
    const portions = [33, 7, 250, 12.5, 3, 180, 44, 91, 1, 100];
    for (let round = 0; round < 2; round += 1) {
      for (const p of portions) {
        expect(portionFrom(OATS, p)).toEqual({
          calories: round2((155.5 * p) / 100),
          proteins: round2((13.2 * p) / 100),
          carbohydrates: round2((67.7 * p) / 100),
          fats: round2((6.9 * p) / 100),
        });
      }
    }
    // …and re-portioning back to 100 g returns the basis itself, untouched.
    expect(portionFrom(OATS, 100).calories).toBe(OATS.base_calories_per_100);
  });

  it('shows the error the DONOR-WRONG approach (rescaling a rounded serving) accumulates', () => {
    // Same three re-portionings, once derived from the basis and once rescaled
    // from the previously rounded serving. Three hops is all it takes to drift.
    const derived = [100, 7, 3, 100].map((p) => portionFrom(OATS, p).calories);
    expect(derived).toEqual([155.5, 10.89, 4.67, 155.5]);

    let rescaled = 155.5;
    let previous = 100;
    for (const p of [7, 3, 100]) {
      rescaled = round2((rescaled / previous) * p);
      previous = p;
    }
    expect(rescaled).toBe(155.67); // 0.17 kcal invented out of nothing
    expect(rescaled).not.toBe(155.5);
  });

  it('recovers the basis from a declared serving (basisFrom is portionFrom inverted)', () => {
    // "180 kcal per 45 g" -> 400 kcal/100 g.
    const basis = basisFrom({ calories: 180, proteins: 9, carbohydrates: 22.5, fats: 4.5 }, 45);
    expect(basis).toEqual({
      base_calories_per_100: 400,
      base_proteins_per_100: 20,
      base_carbs_per_100: 50,
      base_fats_per_100: 10,
    });
    expect(portionFrom(basis, 45)).toEqual({
      calories: 180,
      proteins: 9,
      carbohydrates: 22.5,
      fats: 4.5,
    });
  });

  it('treats a zero portion as no basis rather than dividing by zero', () => {
    expect(basisFrom({ calories: 180, proteins: 0, carbohydrates: 0, fats: 0 }, 0)).toEqual({
      base_calories_per_100: 0,
      base_proteins_per_100: 0,
      base_carbs_per_100: 0,
      base_fats_per_100: 0,
    });
  });
});

describe('validateBasis (donor validateNutritionValues)', () => {
  it('accepts a real food', () => {
    expect(validateBasis(OATS)).toEqual([]);
  });

  it('rejects negative energy or macros', () => {
    expect(validateBasis({ ...OATS, base_calories_per_100: -1 })).toContain(
      'base_calories_per_100 cannot be negative'
    );
    expect(validateBasis({ ...OATS, base_proteins_per_100: -0.1 })).toContain(
      'base_proteins_per_100 cannot be negative'
    );
  });

  it('rejects an impossible energy density (>1000 kcal per 100g)', () => {
    // Pure fat is ~900; anything past 1000 is a corrupted scan.
    expect(validateBasis({ ...OATS, base_calories_per_100: 900 })).toEqual([]);
    expect(validateBasis({ ...OATS, base_calories_per_100: 1001 })).toHaveLength(1);
  });

  it('rejects more than 100g of one macro per 100g', () => {
    expect(validateBasis({ ...OATS, base_fats_per_100: 101 })).toHaveLength(2); // >100 AND sum>110
  });

  it('rejects a macro SUM past the donor 110g margin', () => {
    const sane = { ...OATS, base_proteins_per_100: 40, base_carbs_per_100: 40, base_fats_per_100: 30 };
    expect(validateBasis(sane)).toEqual([]); // exactly 110
    const impossible = { ...sane, base_fats_per_100: 31 };
    expect(validateBasis(impossible)).toEqual(['total macros (111.0g) exceed 110g per 100']);
  });

  it('rejects NaN rather than storing it', () => {
    expect(validateBasis({ ...OATS, base_calories_per_100: Number.NaN })).toContain(
      'base_calories_per_100 cannot be negative'
    );
  });
});

/* ==================================================================== */
/* Rule 3 — time-of-day buckets                                          */
/* ==================================================================== */

describe('timeOfDayFor (donor TimeOfDay.from(date:))', () => {
  const at = (hour: number) => `2026-06-01T${String(hour).padStart(2, '0')}:00:00.000Z`;

  it.each([
    [0, 'night'],
    [4, 'night'],
    [5, 'morning'], // boundary: 05:00 opens morning
    [10, 'morning'],
    [11, 'midday'], // boundary: 11:00 closes morning
    [13, 'midday'],
    [14, 'afternoon'], // boundary
    [16, 'afternoon'],
    [17, 'evening'], // boundary
    [20, 'evening'],
    [21, 'night'], // boundary: 21:00 closes evening
    [23, 'night'],
  ])('buckets %i:00 as %s', (hour, expected) => {
    expect(timeOfDayFor(at(hour))).toBe(expected);
  });

  it('pins the exact minute either side of every boundary', () => {
    expect(timeOfDayFor('2026-06-01T04:59:59Z')).toBe('night');
    expect(timeOfDayFor('2026-06-01T05:00:00Z')).toBe('morning');
    expect(timeOfDayFor('2026-06-01T10:59:59Z')).toBe('morning');
    expect(timeOfDayFor('2026-06-01T11:00:00Z')).toBe('midday');
    expect(timeOfDayFor('2026-06-01T13:59:59Z')).toBe('midday');
    expect(timeOfDayFor('2026-06-01T14:00:00Z')).toBe('afternoon');
    expect(timeOfDayFor('2026-06-01T16:59:59Z')).toBe('afternoon');
    expect(timeOfDayFor('2026-06-01T17:00:00Z')).toBe('evening');
    expect(timeOfDayFor('2026-06-01T20:59:59Z')).toBe('evening');
    expect(timeOfDayFor('2026-06-01T21:00:00Z')).toBe('night');
  });

  it('reads the WALL CLOCK the client sent, offset or not', () => {
    // A 19:30 dinner logged from UTC+4 must be "evening", not the 15:30 UTC
    // instant. The donor read Calendar.current on the device; we read the local
    // stamp it wrote.
    expect(timeOfDayFor('2026-06-01T19:30:00+04:00')).toBe('evening');
    expect(timeOfDayFor('2026-06-01T19:30:00')).toBe('evening');
  });

  it('falls back to night on an unparseable stamp instead of throwing', () => {
    expect(timeOfDayFor('not-a-date')).toBe('night');
  });
});

describe('primaryMealTypeFor (donor TimeOfDay.primaryMealType)', () => {
  it.each([
    ['morning', 'breakfast'],
    ['midday', 'lunch'],
    ['afternoon', 'snack'],
    ['evening', 'dinner'],
    ['night', 'snack'],
  ] as const)('maps %s to %s', (bucket, meal) => {
    expect(primaryMealTypeFor(bucket)).toBe(meal);
  });
});

/* ==================================================================== */
/* Rule 2 — recipe totals + scaling                                      */
/* ==================================================================== */

describe('recipe maths (rule 2: totals are computed, never trusted)', () => {
  it('sums the resolved ingredients', () => {
    const totals = recipeTotals([
      ingredient({ name: 'Oats', quantity: 80, ...OATS }),
      ingredient({
        name: 'Milk',
        quantity: 250,
        base_calories_per_100: 42,
        base_proteins_per_100: 3.4,
        base_carbs_per_100: 5,
        base_fats_per_100: 1,
      }),
    ]);
    // 155.5*0.8 = 124.4 ; 42*2.5 = 105
    expect(totals.calories).toBe(229.4);
    expect(totals.proteins).toBe(round2(10.56 + 8.5));
    expect(totals.carbohydrates).toBe(round2(54.16 + 12.5));
    expect(totals.fats).toBe(round2(5.52 + 2.5));
  });

  it('is zero for an empty ingredient list', () => {
    expect(recipeTotals([])).toEqual({ calories: 0, proteins: 0, carbohydrates: 0, fats: 0 });
  });

  it('divides the totals by servings', () => {
    const totals = { calories: 900, proteins: 45, carbohydrates: 90, fats: 30 };
    expect(perServingFrom(totals, 4)).toEqual({
      calories: 225,
      proteins: 11.25,
      carbohydrates: 22.5,
      fats: 7.5,
    });
  });

  it('never divides by zero or a negative serving count', () => {
    const totals = { calories: 900, proteins: 45, carbohydrates: 90, fats: 30 };
    expect(perServingFrom(totals, 0)).toEqual(totals);
    expect(perServingFrom(totals, -3)).toEqual(totals);
  });

  it('scales from the EXACT totals, so a round trip returns the original', () => {
    const totals = { calories: 703, proteins: 31.4, carbohydrates: 88.9, fats: 21.7 };
    const tripled = scaleTotals(totals, 3, 9);
    expect(tripled.calories).toBe(2109);
    expect(scaleTotals(tripled, 9, 3)).toEqual(totals);
  });

  it('treats a recipe stored with NO servings as one batch rather than dividing by it', () => {
    // A hand-edited or pre-migration row can hold 0. Dividing by it would make
    // every figure on the scale sheet Infinity.
    const totals = { calories: 900, proteins: 45, carbohydrates: 90, fats: 30 };
    expect(scaleTotals(totals, 0, 3)).toEqual({
      calories: 2700,
      proteins: 135,
      carbohydrates: 270,
      fats: 90,
    });
  });
});

/* ==================================================================== */
/* Rule 4 — search + suggestion relevance                                */
/* ==================================================================== */

describe('search relevance (donor scorer)', () => {
  it('measures edit distance', () => {
    expect(levenshtein('gouda', 'gouda')).toBe(0);
    expect(levenshtein('gouda', 'gauda')).toBe(1);
    expect(levenshtein('gouda', '')).toBe(5);
    expect(levenshtein('', 'gouda')).toBe(5);
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('rewards matching EVERY query word over a popular partial match', () => {
    // The donor's headline case: "Gauda Cheese" must outrank "Chocolate Cottage
    // Cheese" for the query "gouda cheese" despite the typo.
    const words = ['gouda', 'cheese'];
    expect(wordMatchScore('Gauda Cheese', words)).toBeGreaterThan(
      wordMatchScore('Chocolate Cottage Cheese', words)
    );
  });

  it('penalises unmatched query words and floors at zero', () => {
    expect(wordMatchScore('Apple', ['banana', 'split', 'sundae'])).toBe(0);
    expect(wordMatchScore('Apple', [])).toBe(0);
  });

  it('scores the MIDDLE rungs of the donor ladder, not just all-or-nothing', () => {
    // Matching most of a multi-word query has to rank above matching half of
    // it, and both above matching none — otherwise a long query only ever finds
    // an exact title.
    const four = ['greek', 'strained', 'yoghurt', 'plain'];
    const all = wordMatchScore('Greek Strained Yoghurt Plain', four);
    const half = wordMatchScore('Greek Strained Cheese', four); // 2 of 4
    const none = wordMatchScore('Cheddar Block', four);
    expect(all).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(none);
    expect(none).toBe(0);

    const five = ['greek', 'strained', 'yoghurt', 'plain', 'natural'];
    const most = wordMatchScore('Greek Strained Yoghurt Plain', five); // 4 of 5
    const fewer = wordMatchScore('Greek Strained Cheddar Block', five); // 2 of 5
    expect(most).toBeGreaterThan(fewer);
  });

  it('does not fuzzy-match a word too short to have a safe edit distance', () => {
    // Two characters is one edit away from most of the alphabet; fuzzing there
    // would make every short query match every food.
    expect(wordMatchScore('Oat milk', ['ot'])).toBe(0);
    expect(wordMatchScore('Oat milk', ['oats'])).toBeGreaterThan(0);
  });

  it('ranks exact > prefix > contains', () => {
    const base = { use_count: 0, last_used_at: null, is_favorite: false, brand_name: null };
    const exact = searchScore({ ...base, name: 'Milk' }, 'milk');
    const prefix = searchScore({ ...base, name: 'Milk chocolate' }, 'milk');
    const contains = searchScore({ ...base, name: 'Oat milk' }, 'milk');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(contains);
  });

  it('puts an exact BARCODE above every text signal for the same query', () => {
    // Scanning a barcode is a machine-exact identity: the row carrying that
    // code must win even against a popular favourite whose NAME matches the
    // digits perfectly.
    const now = Date.parse('2026-06-10T12:00:00Z');
    const scanned = searchScore(
      {
        name: 'Unrelated',
        barcode: '5000112637922',
        use_count: 0,
        last_used_at: null,
        is_favorite: false,
      },
      '5000112637922',
      now
    );
    const textual = searchScore(
      {
        name: '5000112637922',
        use_count: 100,
        last_used_at: '2026-06-10T08:00:00Z',
        is_favorite: true,
      },
      '5000112637922',
      now
    );
    expect(scanned).toBeGreaterThan(textual);
  });

  it('adds usage, recency and favourite bonuses without overriding relevance', () => {
    const now = Date.parse('2026-06-10T12:00:00Z');
    const cold = searchScore(
      { name: 'Milk', use_count: 0, last_used_at: null, is_favorite: false },
      'milk',
      now
    );
    const used = searchScore(
      { name: 'Milk', use_count: 40, last_used_at: '2026-06-09T12:00:00Z', is_favorite: true },
      'milk',
      now
    );
    expect(used - cold).toBe(300); // 100 usage cap + 100 recency + 100 favourite
    // A stale favourite loses only the recency bonus.
    const stale = searchScore(
      { name: 'Milk', use_count: 40, last_used_at: '2026-01-01T12:00:00Z', is_favorite: true },
      'milk',
      now
    );
    expect(used - stale).toBe(100);
  });
});

describe('suggestion scoring (donor FoodSuggestionService weights)', () => {
  const now = Date.parse('2026-06-10T08:00:00Z');
  const base = {
    name: 'Porridge',
    use_count: 0,
    last_used_at: null,
    is_favorite: false,
    preferred_meal_types: [] as MealType[],
    time_based: false,
  };

  it('is NOT a suggestion when the food was never eaten and is not a favourite', () => {
    // Donor parity: the candidate set is favourites ∪ frequent ∪ recent. A
    // matching meal type alone must not conjure a suggestion.
    expect(
      suggestionScore(
        { ...base, preferred_meal_types: ['breakfast'], time_based: true },
        'breakfast',
        now
      )
    ).toBeNull();
  });

  it('weights favourite 0.35, frequency 0.25 (capped at 50 uses), meal 0.10, time 0.10', () => {
    const result = suggestionScore(
      {
        ...base,
        is_favorite: true,
        use_count: 50,
        preferred_meal_types: ['breakfast'],
        time_based: true,
      },
      'breakfast',
      now
    );
    expect(result?.score).toBe(0.8); // 0.35 + 0.25 + 0.10 + 0.10
    expect(result?.reasons).toEqual([
      'favorite',
      'frequently_used',
      'meal_type_match',
      'time_based_match',
    ]);
  });

  it('decays recency linearly across the 7-day window', () => {
    const fresh = suggestionScore(
      { ...base, use_count: 1, last_used_at: '2026-06-10T08:00:00Z' },
      'breakfast',
      now
    );
    const halfway = suggestionScore(
      { ...base, use_count: 1, last_used_at: '2026-06-06T20:00:00Z' },
      'breakfast',
      now
    );
    const stale = suggestionScore(
      { ...base, use_count: 1, last_used_at: '2026-05-01T08:00:00Z' },
      'breakfast',
      now
    );
    expect(fresh!.score).toBeGreaterThan(halfway!.score);
    expect(halfway!.score).toBeGreaterThan(stale!.score);
    expect(stale!.reasons).not.toContain('recently_used');
  });

  it('never exceeds 1.0', () => {
    const result = suggestionScore(
      {
        ...base,
        is_favorite: true,
        use_count: 5000,
        last_used_at: '2026-06-10T08:00:00Z',
        preferred_meal_types: ['breakfast'],
        time_based: true,
      },
      'breakfast',
      now
    );
    expect(result?.score).toBeLessThanOrEqual(1);
  });
});

/* ==================================================================== */
/* D1-backed service behaviour                                           */
/* ==================================================================== */

describe('HealthFoodService against D1', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createHealthFoodTables(testEnv.DB);
    await resetHealthFoodTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID, OTHER]);
  });

  async function addFood(over: Record<string, unknown> = {}, userId = UID) {
    const result = await svc().createCustomFood(userId, {
      name: 'Oats',
      portion: 100,
      unit: 'g',
      base_calories_per_100: 155.5,
      base_proteins_per_100: 13.2,
      base_carbs_per_100: 67.7,
      base_fats_per_100: 6.9,
      ...over,
    });
    if (!result.ok) throw new Error(`fixture rejected: ${result.message}`);
    return result.food;
  }

  describe('custom foods', () => {
    it('derives the basis when the client sends only a serving', async () => {
      const food = await addFood({
        name: 'Protein bar',
        portion: 45,
        calories: 180,
        proteins: 9,
        carbohydrates: 22.5,
        fats: 4.5,
        base_calories_per_100: undefined,
      });
      expect(food.base_calories_per_100).toBe(400);
      expect(food.base_proteins_per_100).toBe(20);
      // The stored serving is re-derived from that basis, so the row agrees
      // with itself (the donor copied `calories` into the basis column, which
      // is only correct at a 100g portion).
      expect(food.calories).toBe(180);
    });

    it('re-portioning through the service never drifts', async () => {
      const food = await addFood();
      let current = food;
      for (const portion of [7, 3, 250, 33, 100]) {
        const result = await svc().updateCustomFood(UID, food.id, { portion });
        if (!result.ok) throw new Error(result.message);
        current = result.food;
        // The basis is immutable across a pure re-portioning…
        expect(current.base_calories_per_100).toBe(155.5);
        expect(current.calories).toBe(round2((155.5 * portion) / 100));
      }
      // …so the final round trip back to 100g is the original number exactly.
      expect(current.calories).toBe(155.5);
    });

    it('rejects a basis the maths could never recover from', async () => {
      const result = await svc().createCustomFood(UID, {
        name: 'Corrupt',
        portion: 100,
        base_calories_per_100: 5000,
      });
      expect(result).toEqual({
        ok: false,
        code: 'invalid_nutrition',
        message: 'base_calories_per_100 (5000) exceeds 1000 kcal per 100',
      });
      expect(await svc().listCustomFoods(UID)).toHaveLength(0);
    });

    it('rejects a basis IMPLIED by an impossible serving', async () => {
      // 700 kcal in 10 g is 7000 kcal/100 g — the donor never checked the
      // implied basis, only the one the client happened to send.
      const result = await svc().createCustomFood(UID, {
        name: 'Implied nonsense',
        portion: 10,
        calories: 700,
      });
      expect(result.ok).toBe(false);
    });

    it('sorts favourites first, then most used, then alphabetically', async () => {
      await addFood({ name: 'Zucchini' });
      const banana = await addFood({ name: 'Banana' });
      const apple = await addFood({ name: 'Apple', is_favorite: true });
      await svc().recordUse(UID, banana.id, { used_at: '2026-06-01T08:00:00Z' });

      expect((await svc().listCustomFoods(UID)).map((f) => f.name)).toEqual([
        'Apple', // favourite
        'Banana', // 1 use
        'Zucchini',
      ]);
      expect((await svc().listCustomFoods(UID, { favorites: true })).map((f) => f.name)).toEqual([
        'Apple',
      ]);
      expect((await svc().listCustomFoods(UID, { mostUsed: true }))[0].name).toBe('Banana');
      expect(apple.use_count).toBe(0);
    });

    it('searches name, brand and barcode case-insensitively', async () => {
      await addFood({ name: 'Greek yoghurt', brand_name: 'Fage', barcode: '5000112637922' });
      await addFood({ name: 'Oat milk' });
      expect((await svc().listCustomFoods(UID, { search: 'YOGH' })).map((f) => f.name)).toEqual([
        'Greek yoghurt',
      ]);
      expect((await svc().listCustomFoods(UID, { search: 'fage' })).map((f) => f.name)).toEqual([
        'Greek yoghurt',
      ]);
      expect(
        (await svc().listCustomFoods(UID, { search: '5000112637922' })).map((f) => f.name)
      ).toEqual(['Greek yoghurt']);
    });

    it('soft-deletes: the row leaves every read path but the tombstone survives', async () => {
      const food = await addFood();
      expect(await svc().deleteCustomFood(UID, food.id)).toBe(true);
      expect(await svc().listCustomFoods(UID)).toHaveLength(0);
      expect(await svc().getCustomFood(UID, food.id)).toBeNull();
      expect(await svc().searchFoods(UID, 'oats')).toHaveLength(0);

      const row = await testEnv.DB.prepare('SELECT deleted_at, updated_at FROM custom_foods WHERE id = ?')
        .bind(food.id)
        .first<{ deleted_at: string | null; updated_at: string }>();
      expect(row?.deleted_at).not.toBeNull();
      // The sync cursor is updated_at — a tombstone the cursor cannot see would
      // be resurrected by the next pull from another device.
      expect(row?.updated_at).toBe(row?.deleted_at);

      // Deleting twice is not a second tombstone.
      expect(await svc().deleteCustomFood(UID, food.id)).toBe(false);
    });

    it('scopes every read and write to the owner', async () => {
      const mine = await addFood({ name: 'Mine' });
      await addFood({ name: 'Theirs' }, OTHER);

      expect((await svc().listCustomFoods(UID)).map((f) => f.name)).toEqual(['Mine']);
      expect(await svc().getCustomFood(OTHER, mine.id)).toBeNull();
      expect(await svc().updateCustomFood(OTHER, mine.id, { name: 'Stolen' })).toEqual({
        ok: false,
        code: 'not_found',
        message: 'Custom food not found',
      });
      expect(await svc().deleteCustomFood(OTHER, mine.id)).toBe(false);
      expect(await svc().recordUse(OTHER, mine.id)).toBeNull();
      expect((await svc().getCustomFood(UID, mine.id))?.name).toBe('Mine');
    });
  });

  describe('clock handling on a use', () => {
    it('HEALTH-FOOD-319: a timestamp with no readable hour buckets as night, never NaN', async () => {
      // `used_at` reaches the bucketer from the client. A value the regex and
      // Date.parse both miss must land somewhere real — a NaN hour would make
      // every comparison in the bucket ladder false and return `night` anyway,
      // but only by accident.
      const food = await addFood({ name: 'Oats' });
      const used = await svc().recordUse(UID, food.id, { used_at: 'yesterday evening' });
      expect(used).not.toBeNull();
      expect(used?.usage.time_of_day).toBe('night');
      expect(used?.usage.meal_type).toBe('snack');
    });

    it('HEALTH-FOOD-320: an unreadable `at` on suggestions falls back to now, not to NaN', async () => {
      // `at` drives the recency decay. A NaN would make every food score
      // NaN and the whole suggestion list vanish.
      await addFood({ name: 'Oats', is_favorite: true });
      const out = await svc().suggestions(UID, { meal_type: 'breakfast', at: 'not a date' });
      expect(out.suggestions).toHaveLength(1);
      expect(Number.isFinite(out.suggestions[0].score)).toBe(true);
    });
  });

  describe('recording a use', () => {
    it('bumps the counter, stamps the clock and appends history with the derived bucket', async () => {
      const food = await addFood();
      const first = await svc().recordUse(UID, food.id, { used_at: '2026-06-01T19:30:00Z' });
      expect(first?.food.use_count).toBe(1);
      expect(first?.food.last_used_at).toBe('2026-06-01T19:30:00Z');
      expect(first?.usage.time_of_day).toBe('evening');
      // No meal type sent -> the donor's primary meal for that bucket.
      expect(first?.usage.meal_type).toBe('dinner');
      expect(first?.usage.food_name).toBe('Oats');

      const second = await svc().recordUse(UID, food.id, {
        used_at: '2026-06-02T07:15:00Z',
        meal_type: 'breakfast',
      });
      expect(second?.food.use_count).toBe(2);
      expect(second?.usage.time_of_day).toBe('morning');

      const rows = await testEnv.DB.prepare(
        'SELECT COUNT(*) as n FROM food_usage_history WHERE user_id = ?'
      )
        .bind(UID)
        .first<{ n: number }>();
      expect(rows?.n).toBe(2);
    });

    it('returns the requested portion DERIVED from the basis', async () => {
      const food = await addFood();
      const used = await svc().recordUse(UID, food.id, { portion: 37 });
      expect(used?.logged).toEqual(portionFrom(OATS, 37));
      // …and defaults to the food's own serving when no portion is sent.
      const plain = await svc().recordUse(UID, food.id, {});
      expect(plain?.logged.calories).toBe(155.5);
    });
  });

  describe('suggestions', () => {
    it('needs TWO uses in a bucket before a food counts as a time match', async () => {
      const food = await addFood({ name: 'Porridge' });
      await svc().recordUse(UID, food.id, { used_at: '2026-06-01T07:00:00Z' });
      const once = await svc().suggestions(UID, { at: '2026-06-03T07:30:00Z' });
      expect(once.time_of_day).toBe('morning');
      expect(once.meal_type).toBe('breakfast');
      expect(once.suggestions[0].reasons).not.toContain('time_based_match');

      await svc().recordUse(UID, food.id, { used_at: '2026-06-02T07:00:00Z' });
      const twice = await svc().suggestions(UID, { at: '2026-06-03T07:30:00Z' });
      expect(twice.suggestions[0].reasons).toContain('time_based_match');
    });

    it('ignores history from another bucket AND another meal slot', async () => {
      const food = await addFood({ name: 'Crisps' });
      await svc().recordUse(UID, food.id, { used_at: '2026-06-01T22:00:00Z', meal_type: 'snack' });
      await svc().recordUse(UID, food.id, { used_at: '2026-06-02T22:30:00Z', meal_type: 'snack' });
      const morning = await svc().suggestions(UID, {
        at: '2026-06-03T07:30:00Z',
        meal_type: 'breakfast',
      });
      expect(morning.suggestions[0].reasons).not.toContain('time_based_match');
      const night = await svc().suggestions(UID, { at: '2026-06-03T22:15:00Z' });
      expect(night.time_of_day).toBe('night');
      expect(night.suggestions[0].reasons).toContain('time_based_match');
    });

    it('orders by score and honours the limit', async () => {
      const favourite = await addFood({ name: 'Favourite', is_favorite: true });
      const used = await addFood({ name: 'Used once' });
      await addFood({ name: 'Never eaten' });
      await svc().recordUse(UID, used.id, { used_at: '2026-06-01T08:00:00Z' });

      const result = await svc().suggestions(UID, { at: '2026-06-02T08:00:00Z' });
      expect(result.suggestions.map((s) => s.food.name)).toEqual(['Favourite', 'Used once']);
      expect(result.suggestions[0].food.id).toBe(favourite.id);
      expect(await svc().suggestions(UID, { at: '2026-06-02T08:00:00Z', limit: 1 })).toHaveProperty(
        'suggestions.length',
        1
      );
    });

    it('never reads another user history', async () => {
      const mine = await addFood({ name: 'Mine' });
      await svc().recordUse(UID, mine.id, { used_at: '2026-06-01T08:00:00Z' });
      await svc().recordUse(UID, mine.id, { used_at: '2026-06-02T08:00:00Z' });
      expect((await svc().suggestions(OTHER, { at: '2026-06-03T08:00:00Z' })).suggestions).toEqual(
        []
      );
    });
  });

  describe('recipes', () => {
    async function addRecipe(over: Record<string, unknown> = {}, userId = UID) {
      const result = await svc().createRecipe(userId, {
        name: 'Porridge',
        servings: 2,
        ingredients: [
          { name: 'Oats', quantity: 80, ...OATS },
          {
            name: 'Milk',
            quantity: 250,
            base_calories_per_100: 42,
            base_proteins_per_100: 3.4,
            base_carbs_per_100: 5,
            base_fats_per_100: 1,
          },
        ],
        ...over,
      });
      if (!result.ok) throw new Error(`fixture rejected: ${result.message}`);
      return result.recipe;
    }

    it('computes the totals SERVER-SIDE from the ingredients', async () => {
      const recipe = await addRecipe();
      expect(recipe.total_calories).toBe(229.4); // 124.4 + 105
      expect(recipe.servings).toBe(2);
      const stored = JSON.parse(recipe.ingredients) as ResolvedIngredient[];
      expect(stored).toHaveLength(2);
      // Each ingredient carries the basis it was costed against, so a later
      // edit to the source food cannot silently rewrite history.
      expect(stored[0].calories).toBe(124.4);
      expect(stored[0].base_calories_per_100).toBe(155.5);
    });

    it('pulls an ingredient basis from the user OWN food when only an id is sent', async () => {
      const oats = await addFood({ name: 'Oats' });
      const recipe = await svc().createRecipe(UID, {
        name: 'From library',
        servings: 1,
        ingredients: [{ name: 'Oats', quantity: 200, food_id: oats.id }],
      });
      expect(recipe.ok && recipe.recipe.total_calories).toBe(311); // 155.5 * 2
    });

    it('refuses an ingredient pointing at ANOTHER user food', async () => {
      const theirs = await addFood({ name: 'Theirs' }, OTHER);
      const result = await svc().createRecipe(UID, {
        name: 'Borrowed',
        ingredients: [{ name: 'Theirs', quantity: 100, food_id: theirs.id }],
      });
      expect(result).toEqual({
        ok: false,
        code: 'invalid_ingredients',
        message: 'ingredient 1 ("Theirs") references an unknown food',
      });
    });

    it('refuses an ingredient with no nutrition basis at all', async () => {
      const result = await svc().createRecipe(UID, {
        name: 'Mystery',
        ingredients: [{ name: 'Something', quantity: 100 }],
      });
      expect(result).toEqual({
        ok: false,
        code: 'invalid_ingredients',
        message: 'ingredient 1 ("Something") has no nutrition basis',
      });
    });

    it('refuses an ingredient whose basis is physically impossible', async () => {
      const result = await svc().createRecipe(UID, {
        name: 'Corrupt',
        ingredients: [{ name: 'Oil?', quantity: 100, base_calories_per_100: 4000 }],
      });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.code).toBe('invalid_ingredients');
    });

    it('recomputes the totals on every edit, including a servings-only one', async () => {
      const recipe = await addRecipe();
      const edited = await svc().updateRecipe(UID, recipe.id, { servings: 4 });
      expect(edited.ok && edited.recipe.total_calories).toBe(229.4); // totals are a BATCH figure
      expect(edited.ok && edited.recipe.servings).toBe(4);

      const swapped = await svc().updateRecipe(UID, recipe.id, {
        ingredients: [{ name: 'Oats', quantity: 40, ...OATS }],
      });
      expect(swapped.ok && swapped.recipe.total_calories).toBe(62.2);
    });

    it('scales per-serving and batch figures without writing anything', async () => {
      const recipe = await addRecipe(); // 229.4 kcal over 2 servings
      const scaled = await svc().scaleRecipe(UID, recipe.id, 6);
      expect(scaled?.per_serving.calories).toBe(114.7);
      expect(scaled?.totals.calories).toBe(688.2); // 229.4 * 3
      expect(scaled?.ingredients[0].quantity).toBe(240); // 80g * 3
      expect(scaled?.ingredients[0].calories).toBe(round2(155.5 * 2.4));

      // Read-only: the stored recipe is still the one-batch definition.
      const stored = await svc().getRecipe(UID, recipe.id);
      expect(stored?.total_calories).toBe(229.4);
      expect(stored?.servings).toBe(2);

      // Scaling down and back up returns the original.
      const halved = await svc().scaleRecipe(UID, recipe.id, 1);
      expect(halved?.totals.calories).toBe(114.7);
    });

    it('soft-deletes and scopes every path to the owner', async () => {
      const recipe = await addRecipe();
      await addRecipe({ name: 'Theirs' }, OTHER);

      expect((await svc().listRecipes(UID)).map((r) => r.name)).toEqual(['Porridge']);
      expect(await svc().getRecipe(OTHER, recipe.id)).toBeNull();
      expect(await svc().scaleRecipe(OTHER, recipe.id, 4)).toBeNull();
      expect(await svc().updateRecipe(OTHER, recipe.id, { name: 'Stolen' })).toEqual({
        ok: false,
        code: 'not_found',
        message: 'Recipe not found',
      });
      expect(await svc().deleteRecipe(OTHER, recipe.id)).toBe(false);

      expect(await svc().deleteRecipe(UID, recipe.id)).toBe(true);
      expect(await svc().listRecipes(UID)).toHaveLength(0);
      const row = await testEnv.DB.prepare('SELECT deleted_at FROM recipes WHERE id = ?')
        .bind(recipe.id)
        .first<{ deleted_at: string | null }>();
      expect(row?.deleted_at).not.toBeNull();
    });

    it('filters by favourite, category and text', async () => {
      await addRecipe({ name: 'Porridge', category: 'breakfast', is_favorite: true });
      await addRecipe({ name: 'Chilli', category: 'dinner', description: 'beans and rice' });
      expect((await svc().listRecipes(UID, { favorites: true })).map((r) => r.name)).toEqual([
        'Porridge',
      ]);
      expect((await svc().listRecipes(UID, { category: 'dinner' })).map((r) => r.name)).toEqual([
        'Chilli',
      ]);
      expect((await svc().listRecipes(UID, { search: 'BEANS' })).map((r) => r.name)).toEqual([
        'Chilli',
      ]);
    });
  });

  describe('search', () => {
    it('returns the user own foods ranked by relevance', async () => {
      await addFood({ name: 'Oat milk' });
      await addFood({ name: 'Milk', is_favorite: true });
      await addFood({ name: 'Cheddar' });
      await addFood({ name: 'Milk', is_favorite: true }, OTHER);

      const results = await svc().searchFoods(UID, 'milk');
      expect(results.map((r) => r.name)).toEqual(['Milk', 'Oat milk']);
      expect(results[0].relevance_score).toBeGreaterThan(results[1].relevance_score);
    });

    it('finds a scanned barcode exactly', async () => {
      await addFood({ name: 'Greek yoghurt', barcode: '5000112637922' });
      const results = await svc().searchFoods(UID, '5000112637922');
      expect(results.map((r) => r.name)).toEqual(['Greek yoghurt']);
    });

    it('tolerates a typo the way the donor scorer does', async () => {
      await addFood({ name: 'Gouda cheese' });
      await addFood({ name: 'Chocolate cottage cheese' });
      const results = await svc().searchFoods(UID, 'gauda cheese');
      expect(results[0].name).toBe('Gouda cheese');
    });

    it('never returns another user food', async () => {
      await addFood({ name: 'Theirs' }, OTHER);
      expect(await svc().searchFoods(UID, 'theirs')).toEqual([]);
    });
  });

  /* ================================================================== */
  /* Editing a food by its SERVING rather than by its basis              */
  /* ================================================================== */

  describe('updateCustomFood — correcting the figures on the pack', () => {
    it('HEALTH-FOOD-300: correcting ONE macro re-derives the basis from the merged serving', async () => {
      // The screen edits the SERVING ("this bar is 180 kcal for 45 g"), not the
      // per-100 basis. A patch that names only `calories` therefore has to be
      // merged over the stored serving and the basis re-derived from the
      // result — keeping the old basis would leave the row claiming figures it
      // no longer shows, and every later re-portion would undo the correction.
      const food = await addFood({
        name: 'Protein bar',
        portion: 45,
        calories: 180,
        proteins: 9,
        carbohydrates: 22.5,
        fats: 4.5,
        base_calories_per_100: undefined,
      });
      expect(food.base_calories_per_100).toBe(400);

      const updated = await svc().updateCustomFood(UID, food.id, { calories: 225 });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;

      // 225 kcal per 45 g → 500 per 100 g …
      expect(updated.food.base_calories_per_100).toBe(500);
      // …and the untouched macros survive the merge rather than resetting to 0.
      expect(updated.food.base_proteins_per_100).toBe(20);
      expect(updated.food.base_carbs_per_100).toBe(50);
      expect(updated.food.base_fats_per_100).toBe(10);
      // The stored serving still agrees with the basis it now claims.
      expect(updated.food.calories).toBe(225);
      expect(updated.food.proteins).toBe(9);
    });

    it('HEALTH-FOOD-303: a serving edit that implies an impossible basis is refused', async () => {
      const food = await addFood({
        name: 'Protein bar',
        portion: 45,
        calories: 180,
        base_calories_per_100: undefined,
      });
      // 900 kcal in 45 g → 2000 kcal per 100 g, past the platform ceiling.
      const result = await svc().updateCustomFood(UID, food.id, { calories: 900 });
      expect(result).toMatchObject({ ok: false, code: 'invalid_nutrition' });

      // Nothing was written — the stored row still describes the old pack.
      const stored = await svc().getCustomFood(UID, food.id);
      expect(stored?.calories).toBe(180);
      expect(stored?.base_calories_per_100).toBe(400);
    });

    it('HEALTH-FOOD-301: a patch naming ONE per-100 column changes that one and only that one', async () => {
      // `PUT /custom-foods/:id` is a PATCH — every key is optional — so a
      // client correcting a single figure off the pack is the ordinary case.
      // The old gate keyed on `base_calories_per_100` alone, so this whole
      // patch was DROPPED and answered 200 with nothing changed.
      const food = await addFood({ name: 'Oats' });
      const updated = await svc().updateCustomFood(UID, food.id, {
        base_proteins_per_100: 15,
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;

      expect(updated.food.base_proteins_per_100).toBe(15);
      // The three the patch did not name are untouched.
      expect(updated.food.base_calories_per_100).toBe(155.5);
      expect(updated.food.base_carbs_per_100).toBe(67.7);
      expect(updated.food.base_fats_per_100).toBe(6.9);
      // …and the stored serving is re-derived, so the row still agrees with
      // the basis it now claims.
      expect(updated.food.proteins).toBe(15);
    });

    it('HEALTH-FOOD-302: correcting the ENERGY alone does not zero the other three', async () => {
      // The mirror of the bug above: routing an update through the CREATE-time
      // basis resolver defaulted every unnamed macro to 0, so fixing a calorie
      // figure silently emptied the protein, carb and fat basis — and every
      // portion derived from the row afterwards read 0 g.
      const food = await addFood({ name: 'Oats' });
      const updated = await svc().updateCustomFood(UID, food.id, {
        base_calories_per_100: 160,
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;

      expect(updated.food.base_calories_per_100).toBe(160);
      expect(updated.food.base_proteins_per_100).toBe(13.2);
      expect(updated.food.base_carbs_per_100).toBe(67.7);
      expect(updated.food.base_fats_per_100).toBe(6.9);
    });

    it('HEALTH-FOOD-304: every other editable field is a real PATCH — named or left alone', async () => {
      // Each of these has its own "did the caller name it?" arm. A shared one
      // would make renaming a food clear its category, or favouriting it drop
      // the barcode the person scanned.
      const food = await addFood({
        name: 'Oats',
        unit: 'g',
        category: 'grains',
        barcode: '5000112637922',
        brand_name: 'Quaker',
        preferred_meal_types: ['breakfast'],
      });

      const renamed = await svc().updateCustomFood(UID, food.id, { name: 'Rolled oats' });
      expect(renamed.ok).toBe(true);
      if (!renamed.ok) return;
      expect(renamed.food).toMatchObject({
        name: 'Rolled oats',
        category: 'grains',
        barcode: '5000112637922',
        brand_name: 'Quaker',
        unit: 'g',
      });
      expect(JSON.parse(renamed.food.preferred_meal_types)).toEqual(['breakfast']);

      const retagged = await svc().updateCustomFood(UID, food.id, {
        category: 'breakfast',
        barcode: '0000000000000',
        unit: 'oz',
        preferred_meal_types: ['snack', 'lunch'],
      });
      expect(retagged.ok).toBe(true);
      if (!retagged.ok) return;
      expect(retagged.food).toMatchObject({
        name: 'Rolled oats',
        category: 'breakfast',
        barcode: '0000000000000',
        unit: 'oz',
      });
      expect(JSON.parse(retagged.food.preferred_meal_types)).toEqual(['snack', 'lunch']);

      // …and an explicit null CLEARS, which is not the same as omitting.
      const cleared = await svc().updateCustomFood(UID, food.id, {
        category: null,
        barcode: null,
        brand_name: null,
      });
      expect(cleared.ok).toBe(true);
      if (!cleared.ok) return;
      expect(cleared.food).toMatchObject({ category: null, barcode: null, brand_name: null });
    });

    it('HEALTH-FOOD-305: changing only the PORTION re-derives, it never rescales', async () => {
      // Rule 1: the basis is the statement of record. Re-portioning must derive
      // the new serving from it, so a portion change alone leaves the basis put.
      const food = await addFood({ name: 'Oats' });
      const updated = await svc().updateCustomFood(UID, food.id, { portion: 40 });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.food.base_calories_per_100).toBe(155.5);
      expect(updated.food.calories).toBe(62.2);
    });
  });

  /* ================================================================== */
  /* Rows written by something other than this service                   */
  /* ================================================================== */

  describe('columns holding JSON that was not written here', () => {
    /** A favourite is enough to be a suggestion candidate on its own. */
    async function favouriteWithSlots(slots: string) {
      const food = await addFood({ name: 'Oats', is_favorite: true });
      await testEnv.DB.prepare('UPDATE custom_foods SET preferred_meal_types = ? WHERE id = ?')
        .bind(slots, food.id)
        .run();
      return food;
    }

    it('HEALTH-FOOD-306: a corrupt preferred_meal_types costs the slot bonus, not the whole screen', async () => {
      // The suggestion scorer parses this column for EVERY candidate, so one
      // unparseable row would take the whole "what you usually eat" list down.
      await favouriteWithSlots('not json');
      const clean = await svc().suggestions(UID, { meal_type: 'breakfast' });
      expect(clean.suggestions).toHaveLength(1);
      // Favourite only — no meal-slot match could be read.
      expect(clean.suggestions[0].reasons).not.toContain('meal_type_match');
    });

    it('HEALTH-FOOD-307: valid JSON that is not a LIST scores as no slots at all', async () => {
      await favouriteWithSlots('{"breakfast":true}');
      const out = await svc().suggestions(UID, { meal_type: 'breakfast' });
      expect(out.suggestions[0].reasons).not.toContain('meal_type_match');
    });

    it('HEALTH-FOOD-308: an unknown slot inside the list is dropped, the real one is kept', async () => {
      await favouriteWithSlots('["brunch","breakfast"]');
      const matched = await svc().suggestions(UID, { meal_type: 'breakfast' });
      expect(matched.suggestions[0].reasons).toContain('meal_type_match');
      // "brunch" is not a slot the app has, so it must never match one.
      const unmatched = await svc().suggestions(UID, { meal_type: 'lunch' });
      expect(unmatched.suggestions[0].reasons).not.toContain('meal_type_match');
    });

    it('HEALTH-FOOD-309: an ingredients column that is valid JSON but not a LIST is empty too', async () => {
      const created = await svc().createRecipe(UID, {
        name: 'Porridge',
        ingredients: [{ name: 'Oats', quantity: 60, base_calories_per_100: 155.5 }],
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await testEnv.DB.prepare('UPDATE recipes SET ingredients = ? WHERE id = ?')
        .bind('{"oats":60}', created.recipe.id)
        .run();

      const scaled = await svc().scaleRecipe(UID, created.recipe.id, 2);
      expect(scaled?.ingredients).toEqual([]);
    });

    it('HEALTH-FOOD-321: a recipe stored with ZERO servings scales as one batch, not Infinity', async () => {
      // `servings` divides the stored totals. A pre-migration or hand-edited 0
      // would make every figure on the scale sheet Infinity, which renders.
      const created = await svc().createRecipe(UID, {
        name: 'Porridge',
        servings: 2,
        ingredients: [{ name: 'Oats', quantity: 100, base_calories_per_100: 155.5 }],
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await testEnv.DB.prepare('UPDATE recipes SET servings = 0 WHERE id = ?')
        .bind(created.recipe.id)
        .run();

      const scaled = await svc().scaleRecipe(UID, created.recipe.id, 3);
      expect(scaled).not.toBeNull();
      // Treated as one batch → tripled, not divided by zero.
      expect(scaled?.totals.calories).toBe(466.5);
      expect(Number.isFinite(scaled?.totals.calories ?? Infinity)).toBe(true);
    });

    it('HEALTH-FOOD-310: a corrupt ingredients column reads as an empty recipe', async () => {
      const created = await svc().createRecipe(UID, {
        name: 'Porridge',
        servings: 2,
        ingredients: [
          { name: 'Oats', quantity: 60, base_calories_per_100: 155.5 },
        ],
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await testEnv.DB.prepare('UPDATE recipes SET ingredients = ? WHERE id = ?')
        .bind('not json', created.recipe.id)
        .run();

      // Scaling must not throw on it …
      const scaled = await svc().scaleRecipe(UID, created.recipe.id, 4);
      expect(scaled?.ingredients).toEqual([]);
      // …and an edit that does not resend the ingredients recomputes honest
      // zeroes rather than keeping totals nothing backs any more.
      const updated = await svc().updateRecipe(UID, created.recipe.id, { name: 'Porridge v2' });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.recipe.total_calories).toBe(0);
    });
  });

  /* ================================================================== */
  /* Ordering ties                                                       */
  /* ================================================================== */

  describe('list ordering tie-breakers', () => {
    it('HEALTH-FOOD-311: equal favourite AND equal use count falls back to the name', async () => {
      // Without the final comparator the order is whatever D1 returns, so the
      // library reshuffles between two identical reads.
      await addFood({ name: 'Rice' });
      await addFood({ name: 'Apple' });
      await addFood({ name: 'Milk' });
      expect((await svc().listCustomFoods(UID, {})).map((f) => f.name)).toEqual([
        'Apple',
        'Milk',
        'Rice',
      ]);

      await svc().createRecipe(UID, {
        name: 'Stew',
        ingredients: [{ name: 'Oats', quantity: 10, base_calories_per_100: 100 }],
      });
      await svc().createRecipe(UID, {
        name: 'Broth',
        ingredients: [{ name: 'Oats', quantity: 10, base_calories_per_100: 100 }],
      });
      expect((await svc().listRecipes(UID, {})).map((r) => r.name)).toEqual(['Broth', 'Stew']);
    });
  });

  /* ================================================================== */
  /* Recipe edits                                                        */
  /* ================================================================== */

  describe('updateRecipe', () => {
    async function seedRecipe() {
      const created = await svc().createRecipe(UID, {
        name: 'Porridge',
        description: 'Breakfast',
        ingredients: [{ name: 'Oats', quantity: 60, base_calories_per_100: 155.5 }],
        preparation_time: 5,
        cooking_time: 10,
        instructions: 'Stir',
        image_url: 'https://example.invalid/p.jpg',
        category: 'breakfast',
        tags: ['quick'],
      });
      if (!created.ok) throw new Error(created.message);
      return created.recipe;
    }

    it('HEALTH-FOOD-312: an ingredient list that cannot be resolved refuses the WHOLE edit', async () => {
      const recipe = await seedRecipe();
      const result = await svc().updateRecipe(UID, recipe.id, {
        name: 'Renamed',
        ingredients: [{ name: 'Mystery', quantity: 50, food_id: 'cf_not_mine' }],
      });
      expect(result.ok).toBe(false);

      // The name change did NOT land either — a half-applied edit would leave a
      // recipe whose title no longer matches its contents.
      const stored = await svc().getRecipe(UID, recipe.id);
      expect(stored?.name).toBe('Porridge');
    });

    it('HEALTH-FOOD-313: every optional field can be edited, and cleared to null', async () => {
      const recipe = await seedRecipe();
      const patched = await svc().updateRecipe(UID, recipe.id, {
        description: 'Weekend version',
        preparation_time: 8,
        cooking_time: 12,
        instructions: 'Stir slowly',
        image_url: 'https://example.invalid/q.jpg',
        category: 'brunch',
        tags: ['slow', 'weekend'],
        is_favorite: true,
      });
      expect(patched.ok).toBe(true);
      if (!patched.ok) return;
      expect(patched.recipe).toMatchObject({
        description: 'Weekend version',
        preparation_time: 8,
        cooking_time: 12,
        instructions: 'Stir slowly',
        image_url: 'https://example.invalid/q.jpg',
        category: 'brunch',
        is_favorite: true,
      });
      expect(JSON.parse(patched.recipe.tags)).toEqual(['slow', 'weekend']);

      // An explicit null clears; an omitted key keeps.
      const cleared = await svc().updateRecipe(UID, recipe.id, {
        description: null,
        preparation_time: null,
        cooking_time: null,
        instructions: null,
        image_url: null,
        category: null,
      });
      expect(cleared.ok).toBe(true);
      if (!cleared.ok) return;
      expect(cleared.recipe).toMatchObject({
        description: null,
        preparation_time: null,
        cooking_time: null,
        instructions: null,
        image_url: null,
        category: null,
        // Untouched by this patch.
        is_favorite: true,
      });
      expect(JSON.parse(cleared.recipe.tags)).toEqual(['slow', 'weekend']);
    });
  });

  /* ================================================================== */
  /* Importing from the external database                                */
  /* ================================================================== */

  describe('importExternalFood', () => {
    const IMPORT = {
      external_source: 'fatsecret',
      external_id: '33691',
      name: 'Greek Yogurt',
      brand_name: 'Fage',
      portion: 170,
      unit: 'g',
      base_calories_per_100: 59,
      base_proteins_per_100: 10.6,
      base_carbs_per_100: 3.5,
      base_fats_per_100: 0,
    };

    it('HEALTH-FOOD-314: a basis the platform cannot store is refused even from a provider', async () => {
      // The provider mapper filters these out, but the service must not depend
      // on its caller having done so — this is the last gate before a poisoned
      // basis becomes the source of every future portion of that food.
      const result = await svc().importExternalFood(UID, {
        ...IMPORT,
        base_calories_per_100: 5000,
      });
      expect(result).toMatchObject({ ok: false, code: 'invalid_nutrition' });
      expect(await svc().listCustomFoods(UID, {})).toEqual([]);
    });

    it('HEALTH-FOOD-315: importing the same food twice returns the SAME row and overwrites nothing', async () => {
      const first = await svc().importExternalFood(UID, IMPORT);
      expect(first).toMatchObject({ ok: true, created: true });
      if (!first.ok) return;

      // The person may since have renamed or favourited it; a second "add"
      // must not undo that.
      await svc().updateCustomFood(UID, first.food.id, { name: 'My yoghurt', is_favorite: true });

      const second = await svc().importExternalFood(UID, IMPORT);
      expect(second).toMatchObject({ ok: true, created: false });
      if (!second.ok) return;
      expect(second.food.id).toBe(first.food.id);
      expect(second.food.name).toBe('My yoghurt');
      expect(second.food.is_favorite).toBe(true);

      expect(await svc().listCustomFoods(UID, {})).toHaveLength(1);
    });

    it('HEALTH-FOOD-316: two CONCURRENT imports collapse onto one row instead of 500ing', async () => {
      // Both calls read "not imported yet" before either writes, so the second
      // insert hits the partial UNIQUE index of migration 0127. That is the
      // double-tap on Import, and it must resolve to the winner's row.
      const [a, b] = await Promise.all([
        svc().importExternalFood(UID, IMPORT),
        svc().importExternalFood(UID, IMPORT),
      ]);
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      if (!a.ok || !b.ok) return;

      // Exactly one of them minted the row; both name it.
      expect([a.created, b.created].sort()).toEqual([false, true]);
      expect(a.food.id).toBe(b.food.id);
      expect(await svc().listCustomFoods(UID, {})).toHaveLength(1);
    });

    it('HEALTH-FOOD-317: a write that fails for any OTHER reason still surfaces', async () => {
      // The race handler must not swallow a genuine failure — an unknown owner
      // is an FK violation with no racing row behind it, and hiding it would
      // report a successful import that never happened.
      await expect(
        svc().importExternalFood('u_not_a_user', IMPORT)
      ).rejects.toThrow();
      expect(await svc().listCustomFoods(UID, {})).toEqual([]);
    });

    it('HEALTH-FOOD-318: a portion the provider could not state falls back to 100, never to zero', async () => {
      // Portion divides every derived serving; a 0 would make the row NaN.
      const result = await svc().importExternalFood(UID, { ...IMPORT, portion: 0, unit: '' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.food.portion).toBe(100);
      expect(result.food.unit).toBe('g');
      expect(result.food.calories).toBe(59);
    });
  });
});
