/**
 * Meal-photo recognition — vision extraction of a plate (or a packaged product,
 * or a kitchen-scale readout) into diary items.
 *
 * Ported from the donor's `POST /api/v1/ai/analyze-food`
 * (`~/Desktop/Symply Ecosystem/Simply Health/backend/src/routes/ai.ts` L67), and
 * it folds in the donor's separate `POST /api/v1/ai/analyze-food-scale` (L721),
 * which is the same prompt plus "read the number on the scale".
 *
 * ── WHY THE TWO DONOR ENDPOINTS ARE ONE HERE ─────────────────────────────────
 *
 * `/analyze-food` and `/analyze-food-scale` differ in exactly three ways: the
 * scale one adds a `scale_reading` block, adds a `cooking_state` per food, and
 * hard-codes `language: "en"`. Everything else — the food schema, the five-tier
 * `data_source` provenance ladder, the per-100 g fields, the confidence bands —
 * is duplicated between them, which is why the donor's two prompts have drifted
 * (`/analyze-food` forbids estimation outright; `/analyze-food-scale` ships a
 * hard-coded 60-item per-100 g nutrition table and tells the model to use it).
 * One prompt with an optional scale block cannot drift against itself.
 *
 * ── WHAT IS KEPT VERBATIM, AND WHY ───────────────────────────────────────────
 *
 * The donor's single best idea in this whole surface is the `data_source`
 * ladder, and the RN UI renders it as a provenance chip on every row:
 *
 *     nutrition_label     0.98–1.00   read off the panel in the photo
 *     package_description 0.90–0.98   read off other printing on the pack
 *     product_database    0.80–0.95   a specific named product
 *     brand_lookup        0.70–0.90   the brand's published figures
 *     estimation          0.40–0.60   inferred from what the food appears to be
 *
 * That ladder is what lets a member tell a transcription from a guess before
 * they accept it, so it is kept name-for-name. The donor's opening rule is kept
 * almost word for word too:
 *
 *   > You are an OCR and nutrition data extraction specialist. Your ONLY job is
 *   > to READ and COPY the EXACT numbers visible in the image. DO NOT calculate,
 *   > estimate, or guess ANY values.
 *   > If you see ANY nutrition information printed on the package … you MUST use
 *   > those EXACT numbers. DO NOT use your knowledge of similar products.
 *
 * ── WHAT IS DELIBERATELY DIFFERENT ───────────────────────────────────────────
 *
 *   * **The donor's hard-coded nutrition table is dropped.** `/analyze-food-scale`
 *     embeds ~60 lines like "Chicken breast (cooked): 31g protein, 0g carbs,
 *     3.6g fat, 165 kcal" in the prompt. A lookup table frozen into a prompt is
 *     a database nobody maintains, it burns tokens on every call, and it makes
 *     the model MORE confident about foods that are not in it. The model's own
 *     food knowledge with an honest `estimation` tier is the truthful version.
 *   * **`is_processed` is dropped.** The donor asks the model to flag processed
 *     food and to "Default to TRUE when unsure". Nothing in this app consumes it,
 *     and a wrong-by-default judgement about someone's food is exactly the kind
 *     of quiet editorialising the Health port keeps out (same call as the injury
 *     screen dropping the donor's pain-level interpretations).
 *   * **Localised names are dropped.** The donor returns `food_name_localized`
 *     alongside an English `food_name`; the app ships English copy, as
 *     `0123_health_exercise_library.sql` already decided when it dropped
 *     `name_ru`.
 */

/** The donor's provenance ladder, name-for-name. */
export type MealPhotoDataSource =
  | 'nutrition_label'
  | 'package_description'
  | 'product_database'
  | 'brand_lookup'
  | 'estimation';

export interface RawMealPhotoFood {
  /** Plain English name. */
  food_name: string;
  brand: string | null;
  /** Donor's scale field: 'raw' | 'cooked' | 'fried' | … or null. */
  cooking_state: string | null;
  /** Portion for THIS row, in `unit`. */
  portion: number | null;
  unit: string | null;
  calories: number | null;
  proteins: number | null;
  carbohydrates: number | null;
  fats: number | null;
  fiber: number | null;
  sugar: number | null;
  calories_per_100g: number | null;
  proteins_per_100g: number | null;
  carbs_per_100g: number | null;
  fats_per_100g: number | null;
  /** 0–1, banded by `data_source` — see the module header. */
  confidence: number | null;
  data_source: MealPhotoDataSource | null;
}

export interface RawMealPhoto {
  foods: RawMealPhotoFood[];
  /** Only when a kitchen scale is visible in the photo. */
  scale_reading: { value: number | null; unit: string | null; detected: boolean } | null;
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null;
  total_calories: number | null;
  image_quality: string | null;
  notes: string | null;
}

const foodItemSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'food_name',
    'brand',
    'cooking_state',
    'portion',
    'unit',
    'calories',
    'proteins',
    'carbohydrates',
    'fats',
    'fiber',
    'sugar',
    'calories_per_100g',
    'proteins_per_100g',
    'carbs_per_100g',
    'fats_per_100g',
    'confidence',
    'data_source',
  ],
  properties: {
    food_name: {
      type: 'string',
      description:
        'The food in plain ENGLISH, as the person would name it ("Greek yoghurt", "Grilled chicken breast"). Translate anything printed in another language.',
    },
    brand: { type: ['string', 'null'], description: 'Brand if legible on the packaging, else null.' },
    cooking_state: {
      type: ['string', 'null'],
      description:
        'How it was prepared if that is visually obvious: "raw", "cooked", "grilled", "fried", "boiled", "baked". Null when unclear — this changes the energy density, so do not guess it.',
    },
    portion: {
      type: ['number', 'null'],
      description:
        'The amount of THIS food. Use the scale reading when one is visible and the food is what is on the scale. Otherwise estimate from the plate and set data_source to "estimation".',
    },
    unit: {
      type: ['string', 'null'],
      description: 'Unit of `portion`: "g", "ml", "piece", "slice", "cup", "tbsp". Prefer "g".',
    },
    calories: {
      type: ['number', 'null'],
      description: 'kcal for the stated portion. Null rather than a guess you have no basis for.',
    },
    proteins: { type: ['number', 'null'], description: 'Protein in grams for the stated portion.' },
    carbohydrates: {
      type: ['number', 'null'],
      description: 'Carbohydrate in grams for the stated portion.',
    },
    fats: { type: ['number', 'null'], description: 'Fat in grams for the stated portion.' },
    fiber: { type: ['number', 'null'], description: 'Fibre in grams for the stated portion, or null.' },
    sugar: { type: ['number', 'null'], description: 'Sugars in grams for the stated portion, or null.' },
    calories_per_100g: {
      type: ['number', 'null'],
      description:
        'kcal per 100 g of this food. This is the basis the app re-portions from, so give it whenever you know it.',
    },
    proteins_per_100g: { type: ['number', 'null'], description: 'Protein per 100 g, grams.' },
    carbs_per_100g: { type: ['number', 'null'], description: 'Carbohydrate per 100 g, grams.' },
    fats_per_100g: { type: ['number', 'null'], description: 'Fat per 100 g, grams.' },
    confidence: {
      type: ['number', 'null'],
      description:
        'How sure you are of THIS row, 0 to 1, banded by data_source: nutrition_label 0.98–1.0, package_description 0.90–0.98, product_database 0.80–0.95, brand_lookup 0.70–0.90, estimation 0.40–0.60. A visible scale reading pushes a portion estimate to 0.85–0.95.',
    },
    data_source: {
      type: ['string', 'null'],
      enum: [
        'nutrition_label',
        'package_description',
        'product_database',
        'brand_lookup',
        'estimation',
        null,
      ],
      description:
        'Where the numbers came from. This is shown to the person as a provenance label, so it must be honest: use "estimation" whenever you inferred rather than read.',
    },
  },
};

export const ANALYZE_MEAL_PHOTO_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['foods', 'scale_reading', 'meal_type', 'total_calories', 'image_quality', 'notes'],
  properties: {
    foods: {
      type: 'array',
      maxItems: 20,
      description:
        'One entry per distinct food visible. Empty array when the image contains no food at all.',
      items: foodItemSchema,
    },
    scale_reading: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['value', 'unit', 'detected'],
      description:
        'The reading on a kitchen scale IF one is visible in the photo, else null. Read the digits exactly; do not infer a weight from how the food looks.',
      properties: {
        value: { type: ['number', 'null'], description: 'The number shown on the display.' },
        unit: { type: ['string', 'null'], description: 'The unit shown: "g", "oz", "ml", "lb".' },
        detected: {
          type: 'boolean',
          description: 'True only when a scale display is actually legible in the image.',
        },
      },
    },
    meal_type: {
      type: ['string', 'null'],
      enum: ['breakfast', 'lunch', 'dinner', 'snack', null],
      description:
        'Only when the food itself makes it obvious. Null otherwise — the app knows the time of day and you do not.',
    },
    total_calories: {
      type: ['number', 'null'],
      description: 'Sum of the per-row calories you returned. Null if any row is null.',
    },
    image_quality: {
      type: ['string', 'null'],
      description: 'One word: "good", "fair", or "poor".',
    },
    notes: {
      type: ['string', 'null'],
      description:
        'One short sentence about anything that limited the reading — bad light, a food hidden behind another, a portion you could only estimate. Null when the read was clean.',
    },
  },
};

export const ANALYZE_MEAL_PHOTO_SYSTEM_PROMPT = `You are an OCR and nutrition data extraction specialist looking at a photo of food.

===== ABSOLUTE RULE: EXTRACT, NEVER ESTIMATE =====
If ANY nutrition information is printed in the image — a Nutrition Facts panel, a per-100 g table, a "per serving" line on the pack — you MUST use those EXACT numbers and set data_source to "nutrition_label" or "package_description". Do NOT use your knowledge of similar products when the real numbers are visible. Do NOT round them.

Only when nothing is printed may you fall back on what the food is, and then you must say so by setting data_source to "estimation" and a confidence of 0.40–0.60.

PROVENANCE — this is shown to the person, so it must be honest:
- nutrition_label     (0.98–1.00) you read the values off a nutrition panel in the image
- package_description (0.90–0.98) you read them off other printing on the packaging
- product_database    (0.80–0.95) you recognised a specific named product and know its figures
- brand_lookup        (0.70–0.90) you recognised the brand and used its published figures
- estimation          (0.40–0.60) you inferred from what the food appears to be

READING THE PLATE:
- List every distinct food you can see as its own row. A sandwich is one row; a plate of chicken, rice and broccoli is three.
- Give each row a portion. If a KITCHEN SCALE is visible and the food on it is one of your rows, read the display and use that number — that is measured data, not a guess, so its confidence may be 0.85–0.95. Read the digits; never infer a weight from how the food looks.
- Cooking state changes energy density. Say "cooked"/"raw"/"fried" only when the image makes it obvious, and leave it null otherwise.
- Fill calories_per_100g and the other per-100 fields whenever you know them. The app re-portions from that basis, so a row without it cannot be adjusted afterwards.
- food_name MUST be in English. Translate anything printed in another language.

WHAT NOT TO DO:
- Do not invent a food that is not visible, and do not split one food into speculative components.
- Do not return a number you have no basis for. Null is a correct answer; a plausible-looking guess is not.
- If the image contains NO food — a person, a receipt, a screenshot, a blank surface — return an empty foods array, image_quality "poor", and say what you actually see in notes. Do not describe a meal you think might have been intended.
- Say nothing about health, diet quality, or whether the food is good or bad for anyone. You are transcribing a photo, not judging it.

Always return via the "output" tool.`;

export const ANALYZE_MEAL_PHOTO_USER_PROMPT =
  'Identify every food in this photo and return the portion and nutrition for each, preferring numbers printed in the image over anything you know about the product. If a kitchen scale is visible, read its display and use that weight. Fill in the per-100 g basis wherever you know it, and mark each row with where its numbers came from.';
