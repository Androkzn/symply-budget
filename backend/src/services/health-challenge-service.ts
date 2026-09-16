import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import { nutritionEntries } from '../db/schema-health';
import { foodChallengeProgress, foodChallenges } from '../db/schema-health-challenges';
import { customFoods, recipes } from '../db/schema-health-p2';
import { convertPortionToGrams, matchesIngredient } from '../utils/food-category-detector';

import { addDays, weekStartOf } from './health-service';

/**
 * Symply Health — personal FOOD CHALLENGES (Dashboard widget).
 *
 * Ported from the donor `backend/src/routes/challenges.ts` (1262 lines),
 * adapted to this codebase's auth (`userId` from the JWT, no household
 * concept — same scoping every other `/health/*` route in this file uses) and
 * response conventions. See `migrations/0136_food_challenges.sql` for the full
 * donor mapping and every deliberate deviation.
 *
 * THIN CLIENT, same contract as `HealthService`: the route only validates a
 * shape and passes it through; every match rule and every derived figure
 * (consumed grams, percentage, the weekly zero-fill) is computed here.
 *
 * ============================ WHAT IS DEFERRED ============================
 *
 * `updateChallengeStreak` / `checkAchievements` (donor `challenges.ts`
 * ~1116-1260) are NOT ported in this pass. `current_streak`, `longest_streak`
 * and `total_completions` are real columns that stay at their created value
 * (0), and `challenge_achievements` is never written to. The Dashboard widget
 * this feature exists for does not read either — it needs `progress_percentage`
 * per challenge and the 7-day daily array, both of which ARE live. Wiring the
 * streak/achievement writers is a follow-up, not a widget blocker.
 *
 * Also not ported: `POST /:id/progress` (donor's AI-analysis callback) and
 * `POST /progress/recalculate` (retroactive backfill for a challenge created
 * after food was already logged) — neither is on the Dashboard's read path.
 * `GET /progress/today` recomputes and upserts the cache on every call, so a
 * challenge created today still sees today's already-logged food without a
 * recalculate step; only PAST days it was never active for stay unbackfilled.
 */

const MAX_TARGET_GRAMS = 10_000;

export type FoodChallengeRow = typeof foodChallenges.$inferSelect;

export interface MatchedFood {
  food_name: string;
  grams: number;
  confidence: number;
}

export interface ChallengeWriteInput {
  name: string;
  target_category?: string | null;
  target_food_name?: string | null;
  target_amount_grams: number;
  frequency: 'daily' | 'weekly';
  start_date?: string;
  end_date?: string | null;
  custom_icon?: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/** Derive a target ingredient from the challenge name when unset, e.g. "Eat 30g Avocado" → "Avocado". */
function deriveTargetFoodName(challenge: {
  name?: string | null;
  target_food_name?: string | null;
}): string | null {
  const explicit = (challenge.target_food_name || '').trim();
  if (explicit) return explicit;
  const name = (challenge.name || '').trim();
  const match = name.match(/Eat\s+\d+\s*g\s+(.+)/i);
  return match ? match[1].trim() : null;
}

function parseMatchedFoods(raw: string | null | undefined): MatchedFood[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MatchedFood[]) : [];
  } catch {
    return [];
  }
}

interface RecipeIngredient {
  name?: string;
  quantity?: number;
  unit?: string;
  food_id?: string | null;
}

const VEG_FRUIT_KEYWORDS =
  /(tomato|lettuce|pepper|onion|carrot|broccoli|cucumber|spinach|kale|avocado|apple|banana|berry|peach|pear|orange|fruit|vegetable)/i;

/**
 * Recipe → contribution = sum of matching-ingredient grams, proportional to
 * the logged portion. Donor `getRecipeChallengeContribution`.
 *
 * This backend's `recipes.ingredients` rows carry `{ name, quantity, unit,
 * food_id }` (see `HealthFoodService.ResolvedIngredient`), not the donor's
 * `{ name, portion, unit, customFoodId }` — field names only, same shape.
 *
 * Total recipe weight ALWAYS takes the donor's own fallback (sum of ingredient
 * grams): this schema's `recipes` table has no `raw_weight`/`cooked_weight` to
 * prefer, unlike the donor's (see migration 0136 DEVIATIONS).
 */
function recipeChallengeContribution(
  recipeIngredientsJson: string,
  loggedGrams: number,
  challenge: Pick<FoodChallengeRow, 'name' | 'target_category' | 'target_food_name'>,
  customFoodCategoryById: Map<string, string | null>
): number {
  let ingredients: RecipeIngredient[];
  try {
    ingredients = JSON.parse(recipeIngredientsJson || '[]');
  } catch {
    return 0;
  }
  if (!Array.isArray(ingredients) || ingredients.length === 0) return 0;

  let totalRecipeGrams = 0;
  for (const i of ingredients) {
    totalRecipeGrams += convertPortionToGrams(Number(i.quantity) || 0, i.unit || 'g');
  }
  if (totalRecipeGrams <= 0) return 0;

  const proportion = loggedGrams / totalRecipeGrams;
  const targetFoodName = deriveTargetFoodName(challenge);
  const targetCategory = challenge.target_category;

  let matchingGrams = 0;
  for (const i of ingredients) {
    const ingGrams = convertPortionToGrams(Number(i.quantity) || 0, i.unit || 'g');
    let matches = false;
    if (targetCategory === 'custom_ingredient' && targetFoodName) {
      if (matchesIngredient(i.name || '', targetFoodName)) matches = true;
    } else if (targetCategory) {
      const category = i.food_id ? (customFoodCategoryById.get(i.food_id) ?? null) : null;
      if (category === targetCategory) matches = true;
      else if (targetCategory === 'vegetables' && category === 'fruits') matches = true;
      // Fallback: match the ingredient NAME to common veg/fruit keywords when
      // it has no linked custom_food category — same heuristic the donor uses.
      if (!matches && (targetCategory === 'vegetables' || targetCategory === 'fruits')) {
        if (VEG_FRUIT_KEYWORDS.test((i.name || '').toLowerCase())) matches = true;
      }
    }
    if (matches) matchingGrams += ingGrams;
  }
  return matchingGrams * proportion;
}

export class HealthChallengeService {
  private db: DrizzleD1Database;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  /* ---------------------------------------------------------------- */
  /* CRUD                                                              */
  /* ---------------------------------------------------------------- */

  async list(userId: string, opts: { activeOnly?: boolean } = {}) {
    const conds = [eq(foodChallenges.user_id, userId)];
    if (opts.activeOnly) conds.push(eq(foodChallenges.is_active, true));
    return this.db
      .select()
      .from(foodChallenges)
      .where(and(...conds))
      .orderBy(desc(foodChallenges.created_at))
      .all();
  }

  async get(userId: string, id: string): Promise<FoodChallengeRow | null> {
    return (
      (await this.db
        .select()
        .from(foodChallenges)
        .where(and(eq(foodChallenges.id, id), eq(foodChallenges.user_id, userId)))
        .get()) ?? null
    );
  }

  async create(userId: string, input: ChallengeWriteInput): Promise<FoodChallengeRow> {
    const ts = nowIso();
    const row = {
      id: newId('fchal'),
      user_id: userId,
      name: input.name,
      target_category: input.target_category ?? null,
      target_food_name: input.target_food_name ?? null,
      target_amount_grams: Math.min(input.target_amount_grams, MAX_TARGET_GRAMS),
      frequency: input.frequency,
      start_date: input.start_date ?? ts.slice(0, 10),
      end_date: input.end_date ?? null,
      is_active: true,
      custom_icon: input.custom_icon ?? null,
      current_streak: 0,
      longest_streak: 0,
      total_completions: 0,
      created_at: ts,
      updated_at: ts,
    };
    await this.db.insert(foodChallenges).values(row).run();
    return row;
  }

  /**
   * Partial patch. `end_date` and `custom_icon` use the donor's sentinel-flag
   * trick (ported as a plain JS presence check, since the route already hands
   * this a parsed object): an explicit `null` CLEARS the field, an OMITTED key
   * leaves it alone. Every other field is a plain "present = update".
   */
  async update(
    userId: string,
    id: string,
    patch: Record<string, unknown>
  ): Promise<FoodChallengeRow | null> {
    const existing = await this.get(userId, id);
    if (!existing) return null;

    const set: Record<string, unknown> = { updated_at: nowIso() };
    for (const key of [
      'name',
      'target_category',
      'target_food_name',
      'target_amount_grams',
      'frequency',
      'start_date',
      'is_active',
    ] as const) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'end_date')) set.end_date = patch.end_date;
    if (Object.prototype.hasOwnProperty.call(patch, 'custom_icon')) {
      set.custom_icon = patch.custom_icon;
    }

    await this.db
      .update(foodChallenges)
      .set(set as never)
      .where(and(eq(foodChallenges.id, id), eq(foodChallenges.user_id, userId)))
      .run();
    return this.get(userId, id);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const res = await this.db
      .delete(foodChallenges)
      .where(and(eq(foodChallenges.id, id), eq(foodChallenges.user_id, userId)))
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /* ---------------------------------------------------------------- */
  /* Progress                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * The Dashboard widget's core data: every active challenge's consumed grams
   * for `date`, computed by scanning that day's nutrition entries. Donor
   * `challenges.ts` `GET /progress/today` (~400-566), ported rule-for-rule:
   *
   *  - recipe-sourced entry (`source_recipe_id` set) → proportional ingredient
   *    credit, never full portion;
   *  - processed entry with NO recipe → skipped for CATEGORY matching (but not
   *    for `custom_ingredient` name matching — same asymmetry the donor has);
   *  - raw/recognised entry → full portion credits a matching category,
   *    vegetables⊇fruits (a fruit always also counts toward a vegetables
   *    target, matching the donor's own fallback);
   *  - `custom_ingredient` challenges match the food name directly, regardless
   *    of `is_processed`.
   *
   * Upserts a `challenge_progress` cache row per challenge (fire-and-forget in
   * the donor; awaited here — this Worker has no background-task primitive to
   * detach it onto, and the write is one indexed upsert).
   */
  async progressToday(userId: string, date: string) {
    const challenges = await this.list(userId, { activeOnly: true });
    if (challenges.length === 0) {
      return { date, challenges: [], completed_count: 0, total_count: 0 };
    }

    const entries = await this.db
      .select()
      .from(nutritionEntries)
      .where(
        and(
          eq(nutritionEntries.user_id, userId),
          eq(nutritionEntries.date, date),
          isNull(nutritionEntries.deleted_at)
        )
      )
      .all();

    // Pre-fetch recipes + the custom_foods their ingredients point at, so the
    // per-challenge loop below never awaits inside a nested loop.
    const recipeIds = [...new Set(entries.map((e) => e.source_recipe_id).filter((v): v is string => !!v))];
    const recipesById = new Map<string, { ingredients: string }>();
    for (const rid of recipeIds) {
      const row = await this.db
        .select({ ingredients: recipes.ingredients })
        .from(recipes)
        .where(eq(recipes.id, rid))
        .get();
      if (row) recipesById.set(rid, row);
    }
    const ingredientFoodIds = new Set<string>();
    for (const r of recipesById.values()) {
      try {
        const ing = JSON.parse(r.ingredients || '[]') as RecipeIngredient[];
        for (const i of ing) if (i.food_id) ingredientFoodIds.add(i.food_id);
      } catch {
        // corrupt ingredients blob — no ids to add
      }
    }
    const customFoodCategoryById = new Map<string, string | null>();
    for (const fid of ingredientFoodIds) {
      const cf = await this.db
        .select({ category: customFoods.category })
        .from(customFoods)
        .where(and(eq(customFoods.id, fid), or(eq(customFoods.user_id, userId), eq(customFoods.is_shared, true))))
        .get();
      if (cf) customFoodCategoryById.set(fid, cf.category ?? null);
    }

    const result = [];
    for (const challenge of challenges) {
      let consumedGrams = 0;
      const matchedFoods: MatchedFood[] = [];

      for (const entry of entries) {
        const portionGrams = convertPortionToGrams(entry.portion, entry.unit);
        const sourceRecipeId = entry.source_recipe_id ?? null;

        if (sourceRecipeId && recipesById.has(sourceRecipeId)) {
          const contrib = recipeChallengeContribution(
            recipesById.get(sourceRecipeId)!.ingredients,
            portionGrams,
            challenge,
            customFoodCategoryById
          );
          if (contrib > 0) {
            consumedGrams += contrib;
            matchedFoods.push({
              food_name: entry.food_name,
              grams: Math.round(contrib * 10) / 10,
              confidence: 0.95,
            });
          }
          continue;
        }

        // Processed + no recipe → excluded from CATEGORY matching only (a
        // custom_ingredient name match is not gated on this — see class header).
        const skipCategoryWhenProcessed = entry.is_processed && !sourceRecipeId;

        let matched = false;
        let confidence = 0;
        const targetFoodName = deriveTargetFoodName(challenge);
        if (challenge.target_category === 'custom_ingredient' && targetFoodName) {
          if (matchesIngredient(entry.food_name, targetFoodName)) {
            matched = true;
            confidence = 0.9;
          }
        } else if (challenge.target_category && !skipCategoryWhenProcessed) {
          const entryCategory = entry.detected_category;
          if (entryCategory) {
            if (entryCategory === challenge.target_category) {
              matched = true;
              confidence = 1.0;
            } else if (challenge.target_category === 'vegetables' && entryCategory === 'fruits') {
              matched = true;
              confidence = 1.0;
            }
          }
        }

        if (matched) {
          consumedGrams += portionGrams;
          matchedFoods.push({ food_name: entry.food_name, grams: portionGrams, confidence });
        }
      }

      const isCompleted = consumedGrams >= challenge.target_amount_grams;
      await this.upsertProgress(challenge.id, userId, date, {
        consumedGrams,
        targetGrams: challenge.target_amount_grams,
        isCompleted,
        matchedFoods,
      });

      result.push({
        ...challenge,
        consumed_grams: consumedGrams,
        today_completed: isCompleted,
        matched_foods: matchedFoods,
        progress_percentage: Math.min((consumedGrams / challenge.target_amount_grams) * 100, 100),
        remaining_grams: Math.max(challenge.target_amount_grams - consumedGrams, 0),
      });
    }

    return {
      date,
      challenges: result,
      completed_count: result.filter((r) => r.today_completed).length,
      total_count: result.length,
    };
  }

  private async upsertProgress(
    challengeId: string,
    userId: string,
    date: string,
    data: { consumedGrams: number; targetGrams: number; isCompleted: boolean; matchedFoods: MatchedFood[] }
  ) {
    const ts = nowIso();
    const matchedFoodsJson = JSON.stringify(data.matchedFoods);
    await this.db
      .insert(foodChallengeProgress)
      .values({
        id: newId('cprog'),
        challenge_id: challengeId,
        user_id: userId,
        date,
        consumed_grams: data.consumedGrams,
        target_grams: data.targetGrams,
        is_completed: data.isCompleted,
        matched_foods: matchedFoodsJson,
        last_updated_at: ts,
      })
      .onConflictDoUpdate({
        target: [foodChallengeProgress.challenge_id, foodChallengeProgress.date],
        set: {
          consumed_grams: data.consumedGrams,
          target_grams: data.targetGrams,
          is_completed: data.isCompleted,
          matched_foods: matchedFoodsJson,
          last_updated_at: ts,
        },
      })
      .run();
  }

  /**
   * Mon-Sun progress for one challenge, missing days zero-filled. Donor
   * `challenges.ts` `GET /:id/progress/weekly` (~810-895), same Monday-start
   * math as `HealthService.weekStartOf` (this file's own convention).
   */
  async weeklyProgress(userId: string, challengeId: string) {
    const challenge = await this.get(userId, challengeId);
    if (!challenge) return null;

    const today = nowIso().slice(0, 10);
    const weekStart = weekStartOf(today);
    const weekEnd = addDays(weekStart, 6);

    const rows = await this.db
      .select()
      .from(foodChallengeProgress)
      .where(
        and(
          eq(foodChallengeProgress.challenge_id, challengeId),
          eq(foodChallengeProgress.user_id, userId),
          gte(foodChallengeProgress.date, weekStart),
          lte(foodChallengeProgress.date, weekEnd)
        )
      )
      .all();
    const byDate = new Map(rows.map((r) => [r.date, r]));

    const dailyTarget =
      challenge.frequency === 'daily'
        ? challenge.target_amount_grams
        : challenge.target_amount_grams / 7;

    const dailyProgress = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekStart, i);
      const existing = byDate.get(d);
      if (existing) {
        return {
          date: existing.date,
          consumed_grams: existing.consumed_grams,
          target_grams: existing.target_grams,
          is_completed: existing.is_completed,
          matched_foods: parseMatchedFoods(existing.matched_foods),
        };
      }
      return {
        date: d,
        consumed_grams: 0,
        target_grams: dailyTarget,
        is_completed: false,
        matched_foods: [] as MatchedFood[],
      };
    });

    const weeklyTotal = dailyProgress.reduce((sum, r) => sum + (r.consumed_grams || 0), 0);
    const weeklyTarget =
      challenge.frequency === 'weekly'
        ? challenge.target_amount_grams
        : challenge.target_amount_grams * 7;

    return {
      challenge,
      daily_progress: dailyProgress,
      weekly_total_grams: weeklyTotal,
      weekly_target_grams: weeklyTarget,
      weekly_progress_percentage: Math.min((weeklyTotal / weeklyTarget) * 100, 100),
    };
  }
}
