import type { D1Database } from '@cloudflare/workers-types';

/**
 * Deterministic food→category detection for Symply Health food challenges.
 *
 * Ported from the donor `backend/src/utils/foodCategoryDetector.ts`
 * verbatim (substring match first, then Levenshtein-fuzzy match for typos),
 * against this backend's `food_category_mappings` table
 * (`src/db/schema-health-challenges.ts`, migration `0136_food_challenges.sql`).
 *
 * No AI call — the donor comment stands here too: this replaces AI-based
 * categorisation for challenge progress so a widget read never depends on an
 * LLM being reachable.
 */

export interface CategoryMapping {
  food_name_pattern: string;
  category: string;
  confidence: number;
}

export type FoodCategory =
  | 'vegetables'
  | 'fruits'
  | 'fish'
  | 'seafood'
  | 'meat'
  | 'dairy'
  | 'grains'
  | 'legumes'
  | 'nuts';

// Maximum Levenshtein distance allowed for fuzzy matching, relative to pattern
// length — short patterns tolerate fewer typos before a false match becomes
// more likely than a real one.
function getMaxDistance(patternLength: number): number {
  if (patternLength <= 4) return 1;
  if (patternLength <= 7) return 2;
  return 2;
}

/** Minimum edits to turn `a` into `b` — classic two-row DP, O(n) memory. */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  let prevRow = new Array<number>(bLen + 1);
  let currRow = new Array<number>(bLen + 1);
  for (let j = 0; j <= bLen; j += 1) prevRow[j] = j;

  for (let i = 1; i <= aLen; i += 1) {
    currRow[0] = i;
    for (let j = 1; j <= bLen; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(prevRow[j] + 1, currRow[j - 1] + 1, prevRow[j - 1] + cost);
    }
    [prevRow, currRow] = [currRow, prevRow];
  }
  return prevRow[bLen];
}

function fuzzyMatch(word: string, pattern: string): boolean {
  return levenshteinDistance(word, pattern) <= getMaxDistance(pattern.length);
}

/** Words of 3+ chars — short fragments are too noisy for fuzzy comparison. */
function extractWords(foodName: string): string[] {
  return foodName
    .toLowerCase()
    .split(/[\s\-_,()]+/)
    .filter((word) => word.length >= 3);
}

let cachedMappings: CategoryMapping[] | null = null;

/** Loaded once per Worker isolate lifetime; the table is global and rarely changes. */
export async function loadCategoryMappings(db: D1Database): Promise<CategoryMapping[]> {
  if (cachedMappings) return cachedMappings;
  const result = await db
    .prepare(
      `SELECT food_name_pattern, category, confidence FROM food_category_mappings ORDER BY confidence DESC`
    )
    .all();
  cachedMappings = (result.results || []) as unknown as CategoryMapping[];
  return cachedMappings;
}

/** Test-only: force the next `loadCategoryMappings` call to re-query the DB. */
export function clearMappingsCache(): void {
  cachedMappings = null;
}

/**
 * Detect a food's category: exact substring match first (fast, high
 * confidence), then Levenshtein-fuzzy match per word (catches typos). Returns
 * null when nothing matches — an unrecognised or composite name.
 */
export function detectFoodCategory(
  foodName: string,
  mappings: CategoryMapping[]
): FoodCategory | null {
  if (!foodName || !mappings.length) return null;
  const foodNameLower = foodName.toLowerCase();

  // Phase 1: exact substring. Mappings are sorted by confidence DESC.
  for (const mapping of mappings) {
    if (foodNameLower.includes(mapping.food_name_pattern)) {
      return mapping.category as FoodCategory;
    }
  }

  // Phase 2: fuzzy, per extracted word.
  const words = extractWords(foodName);
  let bestMatch: { category: FoodCategory; confidence: number } | null = null;
  for (const mapping of mappings) {
    const pattern = mapping.food_name_pattern;
    if (pattern.length < 4) continue; // too many false positives when fuzzy-matched
    for (const word of words) {
      const lengthDiff = Math.abs(word.length - pattern.length);
      if (lengthDiff > 2) continue;
      if (fuzzyMatch(word, pattern)) {
        if (!bestMatch || mapping.confidence > bestMatch.confidence) {
          bestMatch = { category: mapping.category as FoodCategory, confidence: mapping.confidence };
        }
        break;
      }
    }
  }
  return bestMatch?.category ?? null;
}

/** Case-insensitive exact-or-substring match, then fuzzy — for `custom_ingredient` challenges. */
export function matchesIngredient(foodName: string, targetIngredient: string): boolean {
  if (!foodName || !targetIngredient) return false;
  const foodNameLower = foodName.toLowerCase();
  const targetLower = targetIngredient.toLowerCase();
  if (foodNameLower.includes(targetLower)) return true;
  if (targetLower.length < 4) return false;

  const words = extractWords(foodName);
  for (const word of words) {
    const lengthDiff = Math.abs(word.length - targetLower.length);
    if (lengthDiff <= 2 && fuzzyMatch(word, targetLower)) return true;
  }
  return false;
}

/** Portion → grams, donor conversion table verbatim (challenges.ts `convertPortionToGrams`). */
export function convertPortionToGrams(portion: number, unit: string): number {
  const unitLower = (unit || 'g').toLowerCase();
  switch (unitLower) {
    case 'g':
    case 'gram':
    case 'grams':
      return portion;
    case 'kg':
    case 'kilogram':
    case 'kilograms':
      return portion * 1000;
    case 'oz':
    case 'ounce':
    case 'ounces':
      return portion * 28.35;
    case 'lb':
    case 'lbs':
    case 'pound':
    case 'pounds':
      return portion * 453.6;
    case 'ml':
    case 'milliliter':
    case 'milliliters':
      return portion;
    case 'l':
    case 'liter':
    case 'liters':
      return portion * 1000;
    case 'cup':
    case 'cups':
      return portion * 240;
    case 'tbsp':
    case 'tablespoon':
    case 'tablespoons':
      return portion * 15;
    case 'tsp':
    case 'teaspoon':
    case 'teaspoons':
      return portion * 5;
    case 'serving':
    case 'servings':
      return portion * 100;
    case 'pcs':
    case 'piece':
    case 'pieces':
      return portion * 50;
    default:
      return portion;
  }
}
