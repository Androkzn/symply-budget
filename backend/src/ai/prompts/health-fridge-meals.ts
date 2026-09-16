/**
 * Symply Health — meal ideas from what is actually in the fridge.
 *
 * Ports the donor's `POST /api/v1/fridge/suggest-meals`
 * (`~/Desktop/Symply Ecosystem/Simply Health/backend/src/routes/fridge.ts`),
 * which flattened the fridge into a comma-separated ingredient string, asked for
 * "exactly 3 balanced, healthy meals", and parsed a bare JSON array out of a
 * `response_format: json_object` reply — a mismatch the donor had to paper over
 * with an unwrap fallback. Here the answer comes back through a FORCED TOOL, so
 * the shape is the schema and there is nothing to scrape.
 *
 * ── WHAT THIS PROMPT IS AND IS NOT ──────────────────────────────────────────
 *
 * It is a COOKING suggestion, not a nutrition record. The macros a model
 * estimates for "grilled chicken salad" are a guess about a dish nobody has
 * weighed yet, and the donor piped them straight into the food diary from a "Log
 * This Meal" button. That is the one donor behaviour deliberately not ported:
 * these figures are labelled as estimates and are not offered as a one-tap
 * diary write. Logging a meal goes through the ordinary nutrition path, where
 * the person states the portion.
 *
 * ── WHY EXPIRY IS SENT AND THE DONOR DID NOT SEND IT ────────────────────────
 *
 * The donor sent name/quantity/unit only. A fridge feature whose entire point is
 * "what needs eating" and which then suggests meals ignoring what is about to go
 * off is answering a different question than the one the screen asks. Each
 * ingredient therefore carries how many days are left on it (or that it has no
 * date), and the model is told to build around the urgent ones first.
 */

/** One suggested meal, as the model must return it. */
export interface RawFridgeMeal {
  name: string;
  description: string | null;
  /** Fridge item names actually used — copied verbatim from the input list. */
  ingredients_used: string[];
  /** Anything essential the fridge does not hold. Kept short on purpose. */
  missing_ingredients: string[];
  /** Per-serving ESTIMATES. Never presented as measured values. */
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  /** Step-by-step, one action per entry. */
  instructions: string[];
  /** Fridge item names used that are expired or expiring within 3 days. */
  uses_expiring: string[];
  prep_minutes: number | null;
}

export interface RawFridgeMealPlan {
  meals: RawFridgeMeal[];
  /** Set when nothing sensible can be cooked from the list; `meals` then empty. */
  notes: string | null;
}

export const FRIDGE_MEALS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['meals', 'notes'],
  properties: {
    meals: {
      type: 'array',
      description:
        'Up to 3 meals that can be cooked mostly from the listed ingredients. Return FEWER than 3, or an empty array, rather than inventing a meal the ingredients cannot support.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name',
          'description',
          'ingredients_used',
          'missing_ingredients',
          'calories',
          'protein_g',
          'carbs_g',
          'fat_g',
          'instructions',
          'uses_expiring',
          'prep_minutes',
        ],
        properties: {
          name: { type: 'string', description: 'Short dish name, Title Case.' },
          description: {
            type: ['string', 'null'],
            description: 'One sentence on what it is and why it suits the stated goal.',
          },
          ingredients_used: {
            type: 'array',
            description:
              'Names copied VERBATIM from the fridge list provided in the user message. Never list an ingredient that is not on that list here.',
            items: { type: 'string' },
          },
          missing_ingredients: {
            type: 'array',
            description:
              'Essential items the fridge does not have. Keep this list minimal — a meal needing five missing items is not a suggestion worth making. Omit pantry basics such as salt, pepper, water and cooking oil.',
            items: { type: 'string' },
          },
          calories: {
            type: ['number', 'null'],
            description:
              'ESTIMATED calories per serving. Null if the ingredients are too vague to estimate. Never a fabricated precise figure.',
          },
          protein_g: { type: ['number', 'null'], description: 'Estimated grams of protein per serving.' },
          carbs_g: { type: ['number', 'null'], description: 'Estimated grams of carbohydrate per serving.' },
          fat_g: { type: ['number', 'null'], description: 'Estimated grams of fat per serving.' },
          instructions: {
            type: 'array',
            description: 'Ordered cooking steps, ONE action per entry, no numbering in the text.',
            items: { type: 'string' },
          },
          uses_expiring: {
            type: 'array',
            description:
              'The subset of ingredients_used that the fridge list marked as EXPIRED or as expiring within 3 days. Empty array when the meal uses none.',
            items: { type: 'string' },
          },
          prep_minutes: {
            type: ['integer', 'null'],
            description: 'Rough total time in minutes, or null if it cannot be judged.',
          },
        },
      },
    },
    notes: {
      type: ['string', 'null'],
      description:
        'One plain sentence when no meal can reasonably be built from the list (e.g. the fridge holds only condiments). Null when meals were returned.',
    },
  },
};

export const FRIDGE_MEALS_SYSTEM_PROMPT = `You are a cook planning meals from what someone actually has in their fridge right now.

Your job is to reduce waste and feed the person, in that order.

Rules:
- PRIORITISE INGREDIENTS THAT ARE ABOUT TO GO OFF. The list marks each ingredient with how long it has left. A meal that uses something expiring today is more useful than a better meal that uses nothing urgent. Record which of those you used in "uses_expiring".
- Ingredients marked EXPIRED may be suggested, but say so in the description ("check it is still good") rather than pretending it is fresh. Never build a whole meal around expired meat, fish or dairy.
- Only put a name in "ingredients_used" if it appears in the supplied fridge list, copied exactly. Do not rename, pluralise or merge them.
- Keep "missing_ingredients" minimal and leave out pantry basics (salt, pepper, oil, water). If a meal needs more than three missing items, suggest a different meal.
- Suggest AT MOST 3 meals, and fewer when the ingredients cannot honestly support 3. An empty list plus a one-line note is a correct answer for a fridge holding only ketchup.
- Nutrition figures are ESTIMATES for one serving. Give null rather than a made-up number when you cannot judge it. Do not state a precision you do not have.
- Respect the stated dietary goal and any restriction given. A restriction is absolute: never suggest a meal that breaks it.
- Instructions are plain, ordered actions a person can follow without a recipe book. No numbering inside the text.
- This is cooking guidance, not medical or clinical advice. Do not diagnose, do not prescribe, and do not comment on the person's body.

Always return via the "output" tool.`;

/**
 * Compose the user message.
 *
 * The fridge is rendered as one line per item WITH its urgency, rather than the
 * donor's comma-joined blob, because the urgency is the whole reason the feature
 * exists and a blob gives the model nothing to prioritise on.
 */
export function buildFridgeMealsUserPrompt(args: {
  ingredients: readonly string[];
  goal: string;
  restrictions: string | null;
}): string {
  const list = args.ingredients.map((line) => `- ${line}`).join('\n');
  const restrictions =
    args.restrictions && args.restrictions.trim().length > 0
      ? args.restrictions.trim()
      : 'None stated';
  return (
    `Here is what is in the fridge right now, most urgent first:\n${list}\n\n` +
    `Dietary goal: ${args.goal}\n` +
    `Dietary restrictions: ${restrictions}\n\n` +
    'Suggest up to 3 meals that use as much of the urgent food as possible. ' +
    'Copy ingredient names verbatim from the list above.'
  );
}
