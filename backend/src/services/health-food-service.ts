import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import { customFoods, foodUsageHistory, recipes } from '../db/schema-health-p2';

/**
 * Symply Health FOOD domain service — the ported donor `customFoods` /
 * `foodSearch` / `recipes` routes (parity P2).
 *
 * THIN CLIENT, same contract as HealthService: every derived figure is computed
 * HERE. Three donor rules drive the whole file:
 *
 *  1. `base_*_per_100` is the EXACT basis. A logged/stored serving is always
 *     DERIVED from it (`basis * portion / 100`), never scaled from an already
 *     rounded serving — re-portioning a food 20 times must not drift. Rounding
 *     is terminal: it is applied to the derived value and never fed back in.
 *  2. Recipe totals are computed SERVER-SIDE from the ingredient array; the
 *     client's own totals are ignored. `servings` divides into per-serving.
 *  3. `time_of_day` buckets (donor `TimeOfDay.from(date:)`) are derived from the
 *     logged timestamp and drive "what you usually eat at this time of day".
 *
 * Deliberate deviations from the donor, and why:
 *  - Delete is SOFT (`deleted_at` + `updated_at`), not the donor's hard DELETE,
 *    so the delta-sync cursor can carry a tombstone instead of resurrecting the
 *    row on the next pull from another device (same rule as P1).
 *  - `searchFoods` still searches the user's OWN library only. The external
 *    food database landed in P3, but it lives behind `health-food-provider.ts`
 *    and is merged by the ROUTE — this service stays free of vendor shapes and
 *    of outbound I/O, so its every answer is a function of D1 alone. What P3
 *    added here is `importExternalFood`, which turns a hit the user chose into a
 *    row they own. Sharing (`is_shared` / `share_code`) is P4 behind privacy
 *    review, so those columns are read and written by nothing here.
 *  - The donor's cross-source `deduplicateResults()` (drop a row whose
 *    normalised name is within Levenshtein 3 of another) is NOT ported: with a
 *    single source it deletes genuinely distinct foods ("Milk" vs "Milk 2%").
 */

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type TimeOfDay = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';

export const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** The exact per-100 basis every portion is derived from. */
export interface MacroBasis {
  base_calories_per_100: number;
  base_proteins_per_100: number;
  base_carbs_per_100: number;
  base_fats_per_100: number;
}

export interface Macros {
  calories: number;
  proteins: number;
  carbohydrates: number;
  fats: number;
}

/** An ingredient after its nutrition basis has been resolved server-side. */
export interface ResolvedIngredient extends MacroBasis, Macros {
  name: string;
  quantity: number;
  unit: string;
  food_id: string | null;
}

export interface IngredientInput {
  name: string;
  quantity: number;
  unit?: string;
  food_id?: string;
  base_calories_per_100?: number;
  base_proteins_per_100?: number;
  base_carbs_per_100?: number;
  base_fats_per_100?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/* ==================================================================== */
/* Pure maths — exported for unit tests                                  */
/* ==================================================================== */

/**
 * Terminal rounding for a derived figure. Two decimals keeps a gram-level
 * portion honest without ever becoming an input again (see rule 1).
 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Rule 1 — derive a serving from the per-100 basis.
 *
 * ALWAYS call this against the stored basis. Scaling a previously rounded
 * serving (`serving / oldPortion * newPortion`) compounds its rounding error on
 * every re-portioning, which is exactly what the donor's `base_*_per_100`
 * columns exist to prevent.
 */
export function portionFrom(basis: MacroBasis, portion: number): Macros {
  const factor = portion / 100;
  return {
    calories: round2(basis.base_calories_per_100 * factor),
    proteins: round2(basis.base_proteins_per_100 * factor),
    carbohydrates: round2(basis.base_carbs_per_100 * factor),
    fats: round2(basis.base_fats_per_100 * factor),
  };
}

/**
 * The inverse: recover the per-100 basis from a declared serving.
 *
 * Used when the client sends "180 kcal per 45 g" without a basis. For a
 * non-mass unit (`serving`, `piece`) the result is per-100-OF-THAT-UNIT, which
 * keeps `portionFrom(basisFrom(x, p), p) === x` true for every unit. The donor
 * instead stored the per-SERVING figure in `base_*_per_100` when converting a
 * recipe to a food, which silently breaks its own portion maths by 100x — not
 * ported.
 */
export function basisFrom(macros: Macros, portion: number): MacroBasis {
  const factor = portion > 0 ? 100 / portion : 0;
  return {
    base_calories_per_100: round2(macros.calories * factor),
    base_proteins_per_100: round2(macros.proteins * factor),
    base_carbs_per_100: round2(macros.carbohydrates * factor),
    base_fats_per_100: round2(macros.fats * factor),
  };
}

/**
 * Donor `validateNutritionValues()` — rejects physically impossible bases so a
 * corrupted scan can never poison every portion derived from it afterwards.
 * Returns the list of human-readable problems ([] when the basis is sane).
 */
export function validateBasis(basis: MacroBasis): string[] {
  const errors: string[] = [];
  const {
    base_calories_per_100: kcal,
    base_proteins_per_100: protein,
    base_carbs_per_100: carbs,
    base_fats_per_100: fats,
  } = basis;

  if (!Number.isFinite(kcal) || kcal < 0) errors.push('base_calories_per_100 cannot be negative');
  // ~900 kcal/100g is pure fat; 1000 is the donor's headroom.
  else if (kcal > 1000) errors.push(`base_calories_per_100 (${kcal}) exceeds 1000 kcal per 100`);

  const macros: Array<[string, number]> = [
    ['base_proteins_per_100', protein],
    ['base_carbs_per_100', carbs],
    ['base_fats_per_100', fats],
  ];
  for (const [label, value] of macros) {
    if (!Number.isFinite(value) || value < 0) errors.push(`${label} cannot be negative`);
    else if (value > 100) errors.push(`${label} (${value}g) exceeds 100g per 100`);
  }

  // Physically impossible: 110g leaves the donor's margin for fibre/water/ash.
  const total = protein + carbs + fats;
  if (Number.isFinite(total) && total > 110) {
    errors.push(`total macros (${total.toFixed(1)}g) exceed 110g per 100`);
  }
  return errors;
}

/**
 * Rule 3 — donor `TimeOfDay.from(date:)`. Boundaries are inclusive-left /
 * exclusive-right: 05–11 morning, 11–14 midday, 14–17 afternoon,
 * 17–21 evening, everything else (21–05) night.
 *
 * The hour is read from the WALL CLOCK the client wrote, exactly like the donor
 * read `Calendar.current` on the device — the server has no user timezone, and
 * bucketing a 20:00 dinner as "night" because the device is UTC+4 would break
 * the whole suggestion surface.
 */
export function timeOfDayFor(usedAt: string): TimeOfDay {
  const hour = wallClockHour(usedAt);
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'midday';
  if (hour >= 14 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

function wallClockHour(iso: string): number {
  const literal = /T(\d{2}):/.exec(iso);
  if (literal) return Number(literal[1]);
  const parsed = new Date(iso).getUTCHours();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Donor `TimeOfDay.primaryMealType` — the slot assumed when none is sent. */
export function primaryMealTypeFor(timeOfDay: TimeOfDay): MealType {
  switch (timeOfDay) {
    case 'morning':
      return 'breakfast';
    case 'midday':
      return 'lunch';
    case 'evening':
      return 'dinner';
    default:
      return 'snack'; // afternoon + night
  }
}

/** Rule 2 — recipe totals are the SUM of the resolved ingredients, nothing else. */
export function recipeTotals(ingredients: ResolvedIngredient[]): Macros {
  const totals = { calories: 0, proteins: 0, carbohydrates: 0, fats: 0 };
  for (const ing of ingredients) {
    totals.calories += ing.calories;
    totals.proteins += ing.proteins;
    totals.carbohydrates += ing.carbohydrates;
    totals.fats += ing.fats;
  }
  return {
    calories: round2(totals.calories),
    proteins: round2(totals.proteins),
    carbohydrates: round2(totals.carbohydrates),
    fats: round2(totals.fats),
  };
}

/** Rule 2 — `servings` divides into the totals. Guarded: servings >= 1. */
export function perServingFrom(totals: Macros, servings: number): Macros {
  const divisor = servings >= 1 ? servings : 1;
  return {
    calories: round2(totals.calories / divisor),
    proteins: round2(totals.proteins / divisor),
    carbohydrates: round2(totals.carbohydrates / divisor),
    fats: round2(totals.fats / divisor),
  };
}

/**
 * Scale a recipe to a different serving count. Like rule 1, the scaled figure
 * comes from the EXACT stored totals (`totals / stored * target`), not from the
 * rounded per-serving value, so 1 → 3 → 1 servings returns the original.
 */
export function scaleTotals(totals: Macros, storedServings: number, targetServings: number): Macros {
  const factor = targetServings / (storedServings >= 1 ? storedServings : 1);
  return {
    calories: round2(totals.calories * factor),
    proteins: round2(totals.proteins * factor),
    carbohydrates: round2(totals.carbohydrates * factor),
    fats: round2(totals.fats * factor),
  };
}

/* ---------------------------- search scoring ---------------------------- */

/** Donor `levenshteinDistance` — powers the typo tolerance in the scorer. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let i = 1; i <= b.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= a.length; j += 1) {
      row[j] =
        b.charAt(i - 1) === a.charAt(j - 1)
          ? prev[j - 1]
          : Math.min(prev[j - 1] + 1, row[j - 1] + 1, prev[j] + 1);
    }
    prev = row;
  }
  return prev[a.length];
}

/**
 * Donor `calculateWordMatchScore` — matching EVERY query word must beat a
 * partial match no matter how popular the popular row is ("Gouda cheese" must
 * not return "Chocolate Cottage Cheese" first).
 */
export function wordMatchScore(name: string, queryWords: string[]): number {
  if (queryWords.length === 0) return 0;
  const normalized = name.toLowerCase();
  const nameWords = normalized.split(/\s+/);

  let exact = 0;
  let fuzzy = 0;
  let unmatched = 0;

  for (const word of queryWords) {
    if (normalized.includes(word)) {
      exact += 1;
      continue;
    }
    let found = false;
    for (const nameWord of nameWords) {
      if (nameWord.length < 3 || word.length < 3) continue;
      const maxDistance = Math.min(word.length, nameWord.length) <= 5 ? 1 : 2;
      if (levenshtein(word, nameWord) <= maxDistance) {
        found = true;
        break;
      }
    }
    if (found) fuzzy += 1;
    else unmatched += 1;
  }

  let score = exact * 200 + fuzzy * 150;
  const matched = exact + fuzzy;
  if (matched >= queryWords.length) score += 500;
  else if (matched >= queryWords.length * 0.8) score += 200;
  else if (matched >= queryWords.length * 0.5) score += 50;
  score -= unmatched * 150;
  return Math.max(0, score);
}

export interface ScorableFood {
  name: string;
  brand_name?: string | null;
  barcode?: string | null;
  use_count: number;
  last_used_at?: string | null;
  is_favorite: boolean;
}

/**
 * Donor `calculateScore`, minus the multi-source `source_score` (there is one
 * source until P3). A barcode is an exact machine lookup, so it outranks every
 * text signal.
 */
export function searchScore(food: ScorableFood, query: string, now = Date.now()): number {
  const name = food.name.toLowerCase();
  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/).filter((w) => w.length >= 2);

  let score = 0;
  // A barcode is a machine-exact identity, so it outranks the entire text
  // ceiling (300 exact + 700 word-match + 275 usage/recency/favourite/brand).
  if (food.barcode && food.barcode.toLowerCase() === q) score += 2000;
  if (name === q) score += 300;
  else if (name.startsWith(q)) score += 150;
  else if (name.includes(q)) score += 50;
  if (food.brand_name && food.brand_name.toLowerCase().includes(q)) score += 75;

  score += wordMatchScore(food.name, words);
  score += Math.min(food.use_count * 5, 100);

  if (food.last_used_at) {
    const days = (now - new Date(food.last_used_at).getTime()) / 86_400_000;
    if (days >= 0 && days <= 7) score += 100;
  }
  if (food.is_favorite) score += 100;
  return score;
}

/* -------------------------- suggestion scoring -------------------------- */

export type SuggestionReason =
  | 'favorite'
  | 'frequently_used'
  | 'recently_used'
  | 'meal_type_match'
  | 'time_based_match';

/** Donor `FoodSuggestionService` weights — they sum to 1.0 by construction. */
export const SUGGESTION_WEIGHTS = {
  favorite: 0.35,
  frequently_used: 0.25,
  recently_used: 0.2,
  meal_type_match: 0.1,
  time_based_match: 0.1,
} as const;

/** Donor normalisation factors. */
const MAX_USE_COUNT = 50;
const MAX_RECENCY_DAYS = 7;

export interface SuggestionCandidate extends ScorableFood {
  preferred_meal_types: MealType[];
  time_based: boolean;
}

/**
 * Donor `getSuggestions` scoring for ONE candidate. `null` means the food is
 * not a candidate at all (donor only ever scored the union of favourites,
 * frequently used and recently used — a never-eaten food is not a suggestion,
 * however well its meal type matches).
 */
export function suggestionScore(
  candidate: SuggestionCandidate,
  mealType: MealType,
  now = Date.now()
): { score: number; reasons: SuggestionReason[] } | null {
  const reasons: SuggestionReason[] = [];
  let score = 0;

  if (candidate.is_favorite) {
    score += SUGGESTION_WEIGHTS.favorite;
    reasons.push('favorite');
  }
  if (candidate.use_count > 0) {
    score += Math.min(candidate.use_count / MAX_USE_COUNT, 1) * SUGGESTION_WEIGHTS.frequently_used;
    reasons.push('frequently_used');
  }
  let recent = false;
  if (candidate.last_used_at) {
    const days = (now - new Date(candidate.last_used_at).getTime()) / 86_400_000;
    if (days >= 0 && days <= MAX_RECENCY_DAYS) {
      recent = true;
      score +=
        ((MAX_RECENCY_DAYS - days) / MAX_RECENCY_DAYS) * SUGGESTION_WEIGHTS.recently_used;
      reasons.push('recently_used');
    }
  }

  if (!candidate.is_favorite && candidate.use_count === 0 && !recent) return null;

  if (candidate.preferred_meal_types.includes(mealType)) {
    score += SUGGESTION_WEIGHTS.meal_type_match;
    reasons.push('meal_type_match');
  }
  if (candidate.time_based) {
    score += SUGGESTION_WEIGHTS.time_based_match;
    reasons.push('time_based_match');
  }

  return { score: Math.min(1, Math.max(0, round2(score))), reasons };
}

/* ==================================================================== */
/* Row shapes                                                            */
/* ==================================================================== */

export type CustomFoodRow = typeof customFoods.$inferSelect;
export type RecipeRow = typeof recipes.$inferSelect;

export interface CustomFoodInput extends Partial<MacroBasis>, Partial<Macros> {
  name: string;
  brand_name?: string | null;
  portion?: number;
  unit?: string;
  category?: string | null;
  barcode?: string | null;
  is_favorite?: boolean;
  preferred_meal_types?: MealType[];
  source_type?: string;
}

export interface RecipeInput {
  name: string;
  description?: string | null;
  ingredients: IngredientInput[];
  servings?: number;
  preparation_time?: number | null;
  cooking_time?: number | null;
  instructions?: string | null;
  image_url?: string | null;
  category?: string | null;
  tags?: string[];
  is_favorite?: boolean;
}

export type RecipeWriteResult =
  | { ok: true; recipe: RecipeRow }
  | { ok: false; code: 'not_found' | 'invalid_ingredients'; message: string };

/**
 * Writes answer with a result rather than throwing: the basis can only be
 * validated once the EFFECTIVE portion is known (a patch may change one and not
 * the other), which is a fact the route's schema does not have.
 */
export type FoodWriteResult =
  | { ok: true; food: CustomFoodRow }
  | { ok: false; code: 'not_found' | 'invalid_nutrition'; message: string };

/**
 * An external search hit the user chose to keep (parity P3, migration 0127).
 *
 * Vendor-neutral on purpose: the route maps the provider payload and hands over
 * a basis plus a provenance pair, so nothing about FatSecret's shapes reaches
 * the domain layer. A second provider is a new `external_source` value.
 */
export interface ExternalFoodImportInput extends MacroBasis {
  external_source: string;
  external_id: string;
  name: string;
  brand_name?: string | null;
  /** The chosen serving's size — the basis is what everything derives from. */
  portion: number;
  unit: string;
  is_favorite?: boolean;
  preferred_meal_types?: MealType[];
}

/** `created: false` means the user already had this food — see the method. */
export type FoodImportResult =
  | { ok: true; food: CustomFoodRow; created: boolean }
  | { ok: false; code: 'invalid_nutrition'; message: string };

/* ==================================================================== */
/* Service                                                               */
/* ==================================================================== */

export class HealthFoodService {
  private db: DrizzleD1Database;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  /* ---------------------------------------------------------------- */
  /* Custom foods                                                      */
  /* ---------------------------------------------------------------- */

  async listCustomFoods(
    userId: string,
    opts: { search?: string; favorites?: boolean; mostUsed?: boolean; limit?: number } = {}
  ): Promise<CustomFoodRow[]> {
    const conds = [eq(customFoods.user_id, userId), isNull(customFoods.deleted_at)];
    if (opts.favorites) conds.push(eq(customFoods.is_favorite, true));

    const rows = await this.db
      .select()
      .from(customFoods)
      .where(and(...conds))
      .all();

    // Donor filters the text search in memory so it is case-insensitive without
    // depending on a collation D1 does not guarantee.
    const needle = opts.search?.toLowerCase().trim();
    const filtered = needle
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(needle) ||
            (r.brand_name ?? '').toLowerCase().includes(needle) ||
            (r.barcode ?? '').toLowerCase() === needle
        )
      : rows;

    const sorted = opts.mostUsed
      ? filtered.sort(
          (a, b) => b.use_count - a.use_count || (b.last_used_at ?? '').localeCompare(a.last_used_at ?? '')
        )
      : // Donor default: favourites first, then most used, then alphabetical.
        filtered.sort(
          (a, b) =>
            Number(b.is_favorite) - Number(a.is_favorite) ||
            b.use_count - a.use_count ||
            a.name.localeCompare(b.name)
        );

    return sorted.slice(0, opts.limit ?? 200);
  }

  async getCustomFood(userId: string, id: string): Promise<CustomFoodRow | null> {
    const row = await this.db
      .select()
      .from(customFoods)
      .where(
        and(
          eq(customFoods.id, id),
          eq(customFoods.user_id, userId),
          isNull(customFoods.deleted_at)
        )
      )
      .get();
    return row ?? null;
  }

  async createCustomFood(userId: string, input: CustomFoodInput): Promise<FoodWriteResult> {
    const ts = nowIso();
    const portion = input.portion ?? 100;
    const basis = resolveBasis(input, portion);
    const errors = validateBasis(basis);
    if (errors.length > 0) {
      return { ok: false, code: 'invalid_nutrition', message: errors.join('; ') };
    }
    // Rule 1: the stored serving is DERIVED, so the row can never disagree with
    // its own basis (the donor stored whatever the client sent for both).
    const serving = portionFrom(basis, portion);

    const row: CustomFoodRow = {
      id: newId('cf'),
      user_id: userId,
      name: input.name,
      brand_name: input.brand_name ?? null,
      portion,
      unit: input.unit ?? 'g',
      ...serving,
      ...basis,
      category: input.category ?? null,
      barcode: input.barcode ?? null,
      is_favorite: input.is_favorite ?? false,
      use_count: 0,
      last_used_at: null,
      preferred_meal_types: JSON.stringify(input.preferred_meal_types ?? []),
      source_type: input.source_type ?? 'manual',
      source_recipe_id: null,
      // Provenance (0127) belongs to `importExternalFood` alone — a food typed
      // by hand must never claim it came from an external database.
      external_source: null,
      external_id: null,
      // P4, behind privacy review — never set from a request.
      is_shared: false,
      share_code: null,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.insert(customFoods).values(row).run();
    return { ok: true, food: row };
  }

  async updateCustomFood(
    userId: string,
    id: string,
    patch: Partial<CustomFoodInput>
  ): Promise<FoodWriteResult> {
    const existing = await this.getCustomFood(userId, id);
    if (!existing) return { ok: false, code: 'not_found', message: 'Custom food not found' };

    const portion = patch.portion ?? existing.portion;
    // A patch that supplies neither a basis nor a serving keeps the stored
    // basis: re-portioning alone must re-derive, never rescale (rule 1).
    //
    // A basis patch is OVERLAID key by key (`mergeBasis`), not rebuilt from the
    // patch alone — see that helper for the two silent failures the rebuild
    // caused.
    const basis = hasAnyBasisKey(patch)
      ? mergeBasis(patch, basisOf(existing))
      : hasServing(patch)
        ? basisFrom(mergeServing(patch, existing), portion)
        : basisOf(existing);
    const errors = validateBasis(basis);
    if (errors.length > 0) {
      return { ok: false, code: 'invalid_nutrition', message: errors.join('; ') };
    }
    const serving = portionFrom(basis, portion);

    const next: CustomFoodRow = {
      ...existing,
      name: patch.name ?? existing.name,
      brand_name: patch.brand_name === undefined ? existing.brand_name : patch.brand_name,
      portion,
      unit: patch.unit ?? existing.unit,
      ...serving,
      ...basis,
      category: patch.category === undefined ? existing.category : patch.category,
      barcode: patch.barcode === undefined ? existing.barcode : patch.barcode,
      is_favorite: patch.is_favorite ?? existing.is_favorite,
      preferred_meal_types: patch.preferred_meal_types
        ? JSON.stringify(patch.preferred_meal_types)
        : existing.preferred_meal_types,
      updated_at: nowIso(),
    };

    await this.db
      .update(customFoods)
      .set(next)
      .where(and(eq(customFoods.id, id), eq(customFoods.user_id, userId)))
      .run();
    return { ok: true, food: next };
  }

  /** Soft delete — the tombstone is what lets another device drop its copy. */
  async deleteCustomFood(userId: string, id: string): Promise<boolean> {
    const ts = nowIso();
    const res = await this.db
      .update(customFoods)
      .set({ deleted_at: ts, updated_at: ts })
      .where(
        and(
          eq(customFoods.id, id),
          eq(customFoods.user_id, userId),
          isNull(customFoods.deleted_at)
        )
      )
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /**
   * Log a use: bump the counter, stamp `last_used_at` and append the usage row
   * that `/foods/suggestions` reads. `logged` is the portion the caller asked
   * for, derived from the basis (rule 1) — the client never has to do the maths.
   */
  async recordUse(
    userId: string,
    id: string,
    input: { meal_type?: MealType; used_at?: string; portion?: number } = {}
  ): Promise<{ food: CustomFoodRow; logged: Macros; usage: typeof foodUsageHistory.$inferSelect } | null> {
    const existing = await this.getCustomFood(userId, id);
    if (!existing) return null;

    const ts = nowIso();
    const usedAt = input.used_at ?? ts;
    const timeOfDay = timeOfDayFor(usedAt);
    const mealType = input.meal_type ?? primaryMealTypeFor(timeOfDay);

    await this.db
      .update(customFoods)
      .set({
        use_count: sql`${customFoods.use_count} + 1`,
        last_used_at: usedAt,
        updated_at: ts,
      })
      .where(and(eq(customFoods.id, id), eq(customFoods.user_id, userId)))
      .run();

    const usage = {
      id: newId('fuh'),
      user_id: userId,
      food_id: id,
      food_name: existing.name,
      used_at: usedAt,
      meal_type: mealType,
      time_of_day: timeOfDay,
    };
    await this.db.insert(foodUsageHistory).values(usage).run();

    return {
      food: {
        ...existing,
        use_count: existing.use_count + 1,
        last_used_at: usedAt,
        updated_at: ts,
      },
      logged: portionFrom(basisOf(existing), input.portion ?? existing.portion),
      usage,
    };
  }

  /**
   * Keep an EXTERNAL search hit (parity P3) as a real row the user owns.
   *
   * This is the whole point of the food-database integration: a provider result
   * is a lookup that vanishes with the response, a `custom_foods` row is a
   * possession. Once imported it syncs, caches offline, re-portions from its own
   * `base_*_per_100` and shows up in suggestions like anything else — the app
   * never has to ask the provider about it again.
   *
   * IDEMPOTENT on `(user_id, external_source, external_id)`. Importing the same
   * food twice returns the EXISTING row with `created: false` and writes
   * nothing — deliberately, because that row may since have been renamed,
   * favourited or corrected by the user, and letting the provider overwrite
   * those edits on a second "add" would silently undo them. The donor could not
   * do this at all: its `toCustomFood` dropped the provider id
   * (`UUID(uuidString: "fatsecret_123") ?? UUID()`), so every save minted a
   * duplicate. See migration 0127.
   *
   * The provider is NOT a dependency of this service: the route maps the hit and
   * hands over a plain basis, so the domain layer stays free of vendor shapes.
   */
  async importExternalFood(
    userId: string,
    input: ExternalFoodImportInput
  ): Promise<FoodImportResult> {
    const existing = await this.findExternalFood(userId, input.external_source, input.external_id);
    if (existing) return { ok: true, food: existing, created: false };

    const basis: MacroBasis = {
      base_calories_per_100: input.base_calories_per_100,
      base_proteins_per_100: input.base_proteins_per_100,
      base_carbs_per_100: input.base_carbs_per_100,
      base_fats_per_100: input.base_fats_per_100,
    };
    // A corrupted provider row must never become a stored basis — every future
    // portion of this food would be derived from it.
    const errors = validateBasis(basis);
    if (errors.length > 0) {
      return { ok: false, code: 'invalid_nutrition', message: errors.join('; ') };
    }

    const ts = nowIso();
    const portion = input.portion > 0 ? input.portion : 100;
    const row: CustomFoodRow = {
      id: newId('cf'),
      user_id: userId,
      name: input.name,
      brand_name: input.brand_name ?? null,
      portion,
      unit: input.unit || 'g',
      // Rule 1 again: even here the stored serving is DERIVED, never copied from
      // the provider's already-rounded figures.
      ...portionFrom(basis, portion),
      ...basis,
      category: null,
      barcode: null,
      is_favorite: input.is_favorite ?? false,
      use_count: 0,
      last_used_at: null,
      preferred_meal_types: JSON.stringify(input.preferred_meal_types ?? []),
      // The donor's own member for "came from somewhere else" (0120).
      source_type: 'imported',
      source_recipe_id: null,
      external_source: input.external_source,
      external_id: input.external_id,
      is_shared: false,
      share_code: null,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };

    try {
      await this.db.insert(customFoods).values(row).run();
    } catch (error) {
      // Lost a race with a parallel import: `idx_custom_foods_external` (0127)
      // is the backstop, and the winner's row is the right answer.
      const raced = await this.findExternalFood(userId, input.external_source, input.external_id);
      if (raced) return { ok: true, food: raced, created: false };
      throw error;
    }
    return { ok: true, food: row, created: true };
  }

  /** The live copy of an imported food, if this user already has one. */
  private async findExternalFood(
    userId: string,
    source: string,
    externalId: string
  ): Promise<CustomFoodRow | null> {
    const row = await this.db
      .select()
      .from(customFoods)
      .where(
        and(
          eq(customFoods.user_id, userId),
          eq(customFoods.external_source, source),
          eq(customFoods.external_id, externalId),
          isNull(customFoods.deleted_at)
        )
      )
      .get();
    return row ?? null;
  }

  /* ---------------------------------------------------------------- */
  /* Search + suggestions                                              */
  /* ---------------------------------------------------------------- */

  /**
   * The user's OWN foods only — external providers are P3. Scored in memory
   * (donor parity) because relevance needs fuzzy matching D1 cannot express.
   */
  async searchFoods(
    userId: string,
    query: string,
    opts: { limit?: number } = {}
  ): Promise<Array<CustomFoodRow & { relevance_score: number }>> {
    const q = query.toLowerCase().trim();
    const words = q.split(/\s+/).filter((w) => w.length >= 2);
    const rows = await this.db
      .select()
      .from(customFoods)
      .where(and(eq(customFoods.user_id, userId), isNull(customFoods.deleted_at)))
      .all();

    const now = Date.now();
    return rows
      .filter((r) => {
        const name = r.name.toLowerCase();
        const brand = (r.brand_name ?? '').toLowerCase();
        if (r.barcode && r.barcode.toLowerCase() === q) return true;
        if (name.includes(q) || brand.includes(q)) return true;
        return words.some((w) => name.includes(w) || brand.includes(w));
      })
      .map((r) => ({ ...r, relevance_score: searchScore(r, q, now) }))
      .sort((a, b) => b.relevance_score - a.relevance_score || a.name.localeCompare(b.name))
      .slice(0, opts.limit ?? 30);
  }

  /**
   * Donor "what you usually eat at this time of day". The time bucket comes
   * from `at` (the client's own wall clock) and a food counts as a time match
   * when it appears at least TWICE in the history for this bucket or meal slot.
   */
  async suggestions(
    userId: string,
    opts: { meal_type?: MealType; at?: string; limit?: number } = {}
  ): Promise<{
    time_of_day: TimeOfDay;
    meal_type: MealType;
    suggestions: Array<{
      food: CustomFoodRow;
      score: number;
      reasons: SuggestionReason[];
    }>;
  }> {
    const at = opts.at ?? nowIso();
    const timeOfDay = timeOfDayFor(at);
    const mealType = opts.meal_type ?? primaryMealTypeFor(timeOfDay);

    const [foods, history] = await Promise.all([
      this.db
        .select()
        .from(customFoods)
        .where(and(eq(customFoods.user_id, userId), isNull(customFoods.deleted_at)))
        .all(),
      this.db
        .select()
        .from(foodUsageHistory)
        .where(eq(foodUsageHistory.user_id, userId))
        .all(),
    ]);

    const counts = new Map<string, number>();
    for (const h of history) {
      if (h.time_of_day !== timeOfDay && h.meal_type !== mealType) continue;
      counts.set(h.food_id, (counts.get(h.food_id) ?? 0) + 1);
    }

    const now = Date.parse(at);
    const scored = foods
      .map((food) => {
        const result = suggestionScore(
          {
            name: food.name,
            brand_name: food.brand_name,
            barcode: food.barcode,
            use_count: food.use_count,
            last_used_at: food.last_used_at,
            is_favorite: food.is_favorite,
            preferred_meal_types: parseMealTypes(food.preferred_meal_types),
            time_based: (counts.get(food.id) ?? 0) >= 2,
          },
          mealType,
          Number.isNaN(now) ? Date.now() : now
        );
        return result ? { food, ...result } : null;
      })
      .filter((s): s is { food: CustomFoodRow; score: number; reasons: SuggestionReason[] } => s !== null)
      .sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name))
      .slice(0, opts.limit ?? 10);

    return { time_of_day: timeOfDay, meal_type: mealType, suggestions: scored };
  }

  /* ---------------------------------------------------------------- */
  /* Recipes                                                           */
  /* ---------------------------------------------------------------- */

  async listRecipes(
    userId: string,
    opts: { search?: string; favorites?: boolean; category?: string; limit?: number } = {}
  ): Promise<RecipeRow[]> {
    const conds = [eq(recipes.user_id, userId), isNull(recipes.deleted_at)];
    if (opts.favorites) conds.push(eq(recipes.is_favorite, true));
    if (opts.category) conds.push(eq(recipes.category, opts.category));

    const rows = await this.db
      .select()
      .from(recipes)
      .where(and(...conds))
      .all();

    const needle = opts.search?.toLowerCase().trim();
    const filtered = needle
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(needle) ||
            (r.description ?? '').toLowerCase().includes(needle)
        )
      : rows;

    return filtered
      .sort(
        (a, b) =>
          Number(b.is_favorite) - Number(a.is_favorite) ||
          b.use_count - a.use_count ||
          a.name.localeCompare(b.name)
      )
      .slice(0, opts.limit ?? 200);
  }

  async getRecipe(userId: string, id: string): Promise<RecipeRow | null> {
    const row = await this.db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.user_id, userId), isNull(recipes.deleted_at)))
      .get();
    return row ?? null;
  }

  async createRecipe(userId: string, input: RecipeInput): Promise<RecipeWriteResult> {
    const resolved = await this.resolveIngredients(userId, input.ingredients);
    if (!resolved.ok) return resolved;

    const ts = nowIso();
    const servings = input.servings ?? 1;
    // Rule 2: totals are OURS. Whatever the client computed is discarded.
    const totals = recipeTotals(resolved.ingredients);

    const row: RecipeRow = {
      id: newId('rcp'),
      user_id: userId,
      name: input.name,
      description: input.description ?? null,
      ingredients: JSON.stringify(resolved.ingredients),
      servings,
      total_calories: totals.calories,
      total_proteins: totals.proteins,
      total_carbohydrates: totals.carbohydrates,
      total_fats: totals.fats,
      preparation_time: input.preparation_time ?? null,
      cooking_time: input.cooking_time ?? null,
      instructions: input.instructions ?? null,
      image_url: input.image_url ?? null,
      category: input.category ?? null,
      tags: JSON.stringify(input.tags ?? []),
      is_favorite: input.is_favorite ?? false,
      use_count: 0,
      last_used_at: null,
      // P4, behind privacy review.
      is_shared: false,
      share_code: null,
      ai_calculated: false,
      ai_confidence: null,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.insert(recipes).values(row).run();
    return { ok: true, recipe: row };
  }

  async updateRecipe(
    userId: string,
    id: string,
    patch: Partial<RecipeInput>
  ): Promise<RecipeWriteResult> {
    const existing = await this.getRecipe(userId, id);
    if (!existing) return { ok: false, code: 'not_found', message: 'Recipe not found' };

    let ingredients = parseIngredients(existing.ingredients);
    if (patch.ingredients) {
      const resolved = await this.resolveIngredients(userId, patch.ingredients);
      if (!resolved.ok) return resolved;
      ingredients = resolved.ingredients;
    }
    // Recomputed on EVERY write, including a servings-only edit, so the stored
    // totals and the ingredient list can never drift apart.
    const totals = recipeTotals(ingredients);

    const next: RecipeRow = {
      ...existing,
      name: patch.name ?? existing.name,
      description: patch.description === undefined ? existing.description : patch.description,
      ingredients: JSON.stringify(ingredients),
      servings: patch.servings ?? existing.servings,
      total_calories: totals.calories,
      total_proteins: totals.proteins,
      total_carbohydrates: totals.carbohydrates,
      total_fats: totals.fats,
      preparation_time:
        patch.preparation_time === undefined ? existing.preparation_time : patch.preparation_time,
      cooking_time: patch.cooking_time === undefined ? existing.cooking_time : patch.cooking_time,
      instructions: patch.instructions === undefined ? existing.instructions : patch.instructions,
      image_url: patch.image_url === undefined ? existing.image_url : patch.image_url,
      category: patch.category === undefined ? existing.category : patch.category,
      tags: patch.tags ? JSON.stringify(patch.tags) : existing.tags,
      is_favorite: patch.is_favorite ?? existing.is_favorite,
      updated_at: nowIso(),
    };

    await this.db
      .update(recipes)
      .set(next)
      .where(and(eq(recipes.id, id), eq(recipes.user_id, userId)))
      .run();
    return { ok: true, recipe: next };
  }

  async deleteRecipe(userId: string, id: string): Promise<boolean> {
    const ts = nowIso();
    const res = await this.db
      .update(recipes)
      .set({ deleted_at: ts, updated_at: ts })
      .where(and(eq(recipes.id, id), eq(recipes.user_id, userId), isNull(recipes.deleted_at)))
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /**
   * Cook the same recipe for a different number of servings. Nothing is
   * written: the stored recipe stays the canonical one-batch definition.
   */
  async scaleRecipe(
    userId: string,
    id: string,
    targetServings: number
  ): Promise<{
    recipe_id: string;
    name: string;
    servings: number;
    target_servings: number;
    per_serving: Macros;
    totals: Macros;
    ingredients: ResolvedIngredient[];
  } | null> {
    const recipe = await this.getRecipe(userId, id);
    if (!recipe) return null;

    const stored: Macros = {
      calories: recipe.total_calories,
      proteins: recipe.total_proteins,
      carbohydrates: recipe.total_carbohydrates,
      fats: recipe.total_fats,
    };
    const factor = targetServings / (recipe.servings >= 1 ? recipe.servings : 1);

    return {
      recipe_id: recipe.id,
      name: recipe.name,
      servings: recipe.servings,
      target_servings: targetServings,
      per_serving: perServingFrom(stored, recipe.servings),
      totals: scaleTotals(stored, recipe.servings, targetServings),
      ingredients: parseIngredients(recipe.ingredients).map((ing) => {
        const quantity = round2(ing.quantity * factor);
        return { ...ing, quantity, ...portionFrom(ing, quantity) };
      }),
    };
  }

  /**
   * Rule 2 — an ingredient's nutrition comes from its own per-100 basis or, when
   * it points at one of the user's foods, from THAT food's stored basis. Either
   * way the macros are derived here; the client's numbers are never stored.
   */
  private async resolveIngredients(
    userId: string,
    inputs: IngredientInput[]
  ): Promise<{ ok: true; ingredients: ResolvedIngredient[] } | { ok: false; code: 'invalid_ingredients'; message: string }> {
    const resolved: ResolvedIngredient[] = [];
    for (const [index, input] of inputs.entries()) {
      let basis: MacroBasis | null = null;
      if (input.base_calories_per_100 !== undefined) {
        basis = {
          base_calories_per_100: input.base_calories_per_100,
          base_proteins_per_100: input.base_proteins_per_100 ?? 0,
          base_carbs_per_100: input.base_carbs_per_100 ?? 0,
          base_fats_per_100: input.base_fats_per_100 ?? 0,
        };
      } else if (input.food_id) {
        const food = await this.getCustomFood(userId, input.food_id);
        if (!food) {
          return {
            ok: false,
            code: 'invalid_ingredients',
            message: `ingredient ${index + 1} ("${input.name}") references an unknown food`,
          };
        }
        basis = basisOf(food);
      }
      if (!basis) {
        return {
          ok: false,
          code: 'invalid_ingredients',
          message: `ingredient ${index + 1} ("${input.name}") has no nutrition basis`,
        };
      }
      const errors = validateBasis(basis);
      if (errors.length > 0) {
        return {
          ok: false,
          code: 'invalid_ingredients',
          message: `ingredient ${index + 1} ("${input.name}"): ${errors.join('; ')}`,
        };
      }
      resolved.push({
        name: input.name,
        quantity: input.quantity,
        unit: input.unit ?? 'g',
        food_id: input.food_id ?? null,
        ...basis,
        ...portionFrom(basis, input.quantity),
      });
    }
    return { ok: true, ingredients: resolved };
  }
}

/* ==================================================================== */
/* Row helpers                                                           */
/* ==================================================================== */

export function basisOf(row: MacroBasis): MacroBasis {
  return {
    base_calories_per_100: row.base_calories_per_100,
    base_proteins_per_100: row.base_proteins_per_100,
    base_carbs_per_100: row.base_carbs_per_100,
    base_fats_per_100: row.base_fats_per_100,
  };
}

/** True when the patch names ANY per-100 column, not only the energy one. */
function hasAnyBasisKey(input: Partial<CustomFoodInput>): boolean {
  return (
    input.base_calories_per_100 !== undefined ||
    input.base_proteins_per_100 !== undefined ||
    input.base_carbs_per_100 !== undefined ||
    input.base_fats_per_100 !== undefined
  );
}

/**
 * Overlay the per-100 columns a PATCH names onto the stored basis.
 *
 * `PUT /custom-foods/:id` is a patch — every field is optional and an omitted
 * key means "leave it". `resolveBasis` cannot express that: it is written for a
 * CREATE, where a missing macro genuinely is zero. Routing an update through it
 * broke the contract in both directions:
 *
 *   - a patch naming only `base_proteins_per_100` was dropped entirely (the old
 *     gate keyed on `base_calories_per_100` alone), so correcting a protein
 *     figure answered 200 and changed nothing;
 *   - a patch naming only `base_calories_per_100` ZEROED the other three, so
 *     correcting an energy density silently emptied the protein, carb and fat
 *     basis — and every portion derived from that row afterwards read 0 g.
 */
function mergeBasis(patch: Partial<CustomFoodInput>, existing: MacroBasis): MacroBasis {
  return {
    base_calories_per_100: patch.base_calories_per_100 ?? existing.base_calories_per_100,
    base_proteins_per_100: patch.base_proteins_per_100 ?? existing.base_proteins_per_100,
    base_carbs_per_100: patch.base_carbs_per_100 ?? existing.base_carbs_per_100,
    base_fats_per_100: patch.base_fats_per_100 ?? existing.base_fats_per_100,
  };
}

function hasServing(input: Partial<CustomFoodInput>): boolean {
  return input.calories !== undefined;
}

function mergeServing(patch: Partial<CustomFoodInput>, existing: Macros): Macros {
  return {
    calories: patch.calories ?? existing.calories,
    proteins: patch.proteins ?? existing.proteins,
    carbohydrates: patch.carbohydrates ?? existing.carbohydrates,
    fats: patch.fats ?? existing.fats,
  };
}

/**
 * The basis the client sent, or the one implied by the serving it sent. The
 * donor copied `calories` straight into `base_calories_per_100`, which is only
 * correct for a 100 g portion — every other portion silently corrupted the row.
 */
function resolveBasis(input: Partial<CustomFoodInput>, portion: number): MacroBasis {
  if (input.base_calories_per_100 !== undefined) {
    return {
      base_calories_per_100: input.base_calories_per_100,
      base_proteins_per_100: input.base_proteins_per_100 ?? 0,
      base_carbs_per_100: input.base_carbs_per_100 ?? 0,
      base_fats_per_100: input.base_fats_per_100 ?? 0,
    };
  }
  return basisFrom(
    {
      calories: input.calories ?? 0,
      proteins: input.proteins ?? 0,
      carbohydrates: input.carbohydrates ?? 0,
      fats: input.fats ?? 0,
    },
    portion
  );
}

function parseMealTypes(json: string): MealType[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is MealType => MEAL_TYPES.includes(v as MealType));
  } catch {
    return [];
  }
}

/** Stored ingredients are always ones WE resolved, but never trust a blob. */
function parseIngredients(json: string): ResolvedIngredient[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as ResolvedIngredient[];
  } catch {
    return [];
  }
}
