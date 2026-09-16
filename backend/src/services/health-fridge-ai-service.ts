import {
  FRIDGE_MEALS_SCHEMA,
  FRIDGE_MEALS_SYSTEM_PROMPT,
  buildFridgeMealsUserPrompt,
  type RawFridgeMeal,
  type RawFridgeMealPlan,
} from '../ai/prompts/health-fridge-meals';
import {
  SCAN_GROCERY_RECEIPT_SCHEMA,
  SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT,
  buildScanReceiptUserPrompt,
  type RawGroceryReceipt,
} from '../ai/prompts/scan-grocery-receipt';
import type { AIProvider } from '../ai/provider';
import { createAnthropicAdapterForUser } from '../ai/provider-factory';
import type { Env } from '../types';

import {
  HealthVisionService,
  extractWithVision,
  resolveVisionImages,
  type VisionFailure,
  type VisionImageInput,
} from './health-ai/vision-service';

/**
 * Symply Health — the Smart Fridge's two AI surfaces (parity phase P5).
 *
 * The donor's Fridge tab had three capabilities this platform had no route for:
 * barcode lookup, receipt OCR and meal suggestions. Barcode lives in
 * `health-food-provider.ts` (it is a food-database question, not a model one);
 * the other two live here.
 *
 * ── RECEIPT: ONE RECEIPT READER, TWO CONSUMERS ──────────────────────────────
 *
 * This does NOT write a second receipt prompt. It calls the SAME
 * `SCAN_GROCERY_RECEIPT_*` prompt and schema Budget's scanner uses — the one
 * that already reads ANY receipt type and gives every line a simple, groupable
 * name ("Tomatoes", "Milk", "Alcohol"), which is exactly the vocabulary a fridge
 * wants. The extension point it already exposes for Budget's household
 * categories, `buildScanReceiptUserPrompt(names)`, is handed the TEN DONOR
 * FRIDGE CATEGORIES instead, so the model tags each line with a fridge category
 * without a single new prompt sentence.
 *
 * It also runs through the same `extractWithVision` the label and meal scanners
 * use, so magic-byte sniffing, the forced-tool call and the "answered, but not
 * with an extraction" rule are shared rather than re-implemented.
 *
 * The donor did this differently and worse: Apple Vision OCR on the DEVICE, then
 * a text-only LLM parse server-side. That is iOS-only, loses the layout the
 * model could have used, and needed a hand-written markdown-fence stripper
 * because the response format and the prompt disagreed about arrays. Reading the
 * image directly removes all three problems and costs nothing extra.
 *
 * ── WHAT A RECEIPT CANNOT TELL YOU, AND IS NOT ASKED TO ─────────────────────
 *
 * A receipt prints names and prices. It does NOT print how many of a thing you
 * have in a form that survives grouping (the reader merges three tomato lines
 * into one), and it never prints an expiry date. So:
 *
 *  - `quantity`/`unit` come back UNSET, not as a fabricated "1 pc". The person
 *    sets them in review, where they are looking at the actual shopping.
 *  - `suggested_expiry_days` is a DETERMINISTIC, PUBLISHED figure from
 *    `TYPICAL_SHELF_LIFE_DAYS`, not a model guess. The donor asked the model to
 *    "estimate realistic shelf life in days" and wrote the answer straight onto
 *    the field that drives the expiring-soon alarm. A table can be read,
 *    checked and argued with; a per-request guess cannot, and it costs tokens to
 *    be less reliable.
 *
 * ── MEALS ───────────────────────────────────────────────────────────────────
 *
 * The Worker reads the fridge ITSELF — the client sends a goal, not an
 * inventory. Same rule the coach follows: the device does not get to tell the
 * server what the server already knows.
 *
 * ── FAIL CLOSED ─────────────────────────────────────────────────────────────
 *
 * Both surfaces return the shared `VisionFailure` union — `unsupported_media`,
 * `unreadable`, `provider_unavailable` — and never a provider string, a status
 * code or an exception message. No entitlement and no credential are handled by
 * the ROUTE, ahead of this service, so a person without AI never reaches a model
 * call at all.
 */

/* ==================================================================== */
/* Vocabulary                                                            */
/* ==================================================================== */

/**
 * The donor's ten fridge categories, verbatim (`fridge.ts` prompt + the iOS
 * category picker). Kept here rather than derived from the D1 column, which
 * accepts any string up to 50 characters — the column is permissive so an older
 * client's value is never rejected, but the model must choose from a closed list
 * or the review screen's picker cannot show what it chose.
 */
export const FRIDGE_CATEGORIES = [
  'Dairy',
  'Meat',
  'Vegetables',
  'Fruits',
  'Grains',
  'Beverages',
  'Snacks',
  'Frozen',
  'Condiments',
  'Uncategorized',
] as const;
export type FridgeCategory = (typeof FRIDGE_CATEGORIES)[number];

/**
 * Typical shelf life once it is home, in days, per category.
 *
 * A SUGGESTION, and the UI says so. These are conservative supermarket-to-fridge
 * figures for an opened-or-fresh item, not a food-safety ruling: fresh meat and
 * fish spoil fastest, produce lasts about a week, dry and frozen goods last long
 * enough that a date is barely worth setting.
 *
 * `Uncategorized` is deliberately null. Guessing a shelf life for something we
 * could not even categorise would put a number on the expiring-soon alarm with
 * nothing behind it.
 */
export const TYPICAL_SHELF_LIFE_DAYS: Record<FridgeCategory, number | null> = {
  Dairy: 7,
  Meat: 3,
  Vegetables: 7,
  Fruits: 7,
  Grains: 30,
  Beverages: 30,
  Snacks: 60,
  Frozen: 90,
  Condiments: 180,
  Uncategorized: null,
};

/** Longest a receipt scan will hand back — a review list has to stay reviewable. */
export const MAX_RECEIPT_ITEMS = 60;

/** Fridge rows fed to the meal planner. Beyond this the prompt is mostly noise. */
export const MAX_MEAL_INGREDIENTS = 60;

/** Meals the planner may return. The donor asked for exactly 3; 3 is the cap. */
export const MAX_MEAL_SUGGESTIONS = 3;

/** "Expiring" for the planner's purposes — matches the donor's own 3-day bucket. */
export const MEAL_URGENT_DAYS = 3;

/* ==================================================================== */
/* Shapes                                                               */
/* ==================================================================== */

export interface FridgeReceiptItem {
  /** Simple, groupable name — the receipt reader's own aggressive grouping. */
  name: string;
  /** One of `FRIDGE_CATEGORIES`, or null when nothing fitted. */
  category: FridgeCategory | null;
  /**
   * Typical shelf life for that category. The review screen offers it as a
   * one-tap fill and labels it as typical, NEVER as something read off the
   * receipt. Null when the category is unknown or has no sensible default.
   */
  suggested_expiry_days: number | null;
  /** Pre-tax price paid for the line, in cents, so the row can be checked. */
  amount_cents: number | null;
  /**
   * False when the line does not look like food.
   *
   * The receipt reader reads the WHOLE receipt — batteries, a phone cable, a
   * bag fee — because Budget needs all of it. A fridge does not. Rather than
   * silently dropping those lines (which would look like a misread), they come
   * back flagged and the review screen leaves them unticked.
   */
  looks_like_food: boolean;
}

export interface FridgeReceiptDraft {
  vendor: string | null;
  /** YYYY-MM-DD if the receipt printed one. NOT an expiry date. */
  purchase_date: string | null;
  items: FridgeReceiptItem[];
}

export interface FridgeMealSuggestion {
  name: string;
  description: string | null;
  ingredients_used: string[];
  missing_ingredients: string[];
  /** Per-serving ESTIMATES. Null means "could not judge", never zero. */
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  instructions: string[];
  /** Ingredients used that are expired or expiring within `MEAL_URGENT_DAYS`. */
  uses_expiring: string[];
  prep_minutes: number | null;
}

export interface FridgeMealPlan {
  meals: FridgeMealSuggestion[];
  /** Plain sentence when nothing could be built from the list. */
  notes: string | null;
  /** Fridge names actually offered to the model, so the screen can say so. */
  considered: string[];
}

/** One fridge row as the planner needs it. */
export interface MealPlannerItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  /** `YYYY-MM-DD` or null. */
  expiry_date: string | null;
}

/* ==================================================================== */
/* Pure helpers — exported so the mapping is checkable without a model   */
/* ==================================================================== */

const CATEGORY_LOOKUP = new Map<string, FridgeCategory>(
  FRIDGE_CATEGORIES.map((c) => [c.toLowerCase(), c])
);

/** Match a model's category to the closed list, case-insensitively, or null. */
export function toFridgeCategory(raw: unknown): FridgeCategory | null {
  if (typeof raw !== 'string') return null;
  return CATEGORY_LOOKUP.get(raw.trim().toLowerCase()) ?? null;
}

/**
 * Words that mark a receipt line as something a fridge should not hold.
 *
 * A SECOND filter, on top of the category. The category is the primary signal —
 * an item the model could not place in any of the ten food categories is
 * probably not food — but "Uncategorized" is one of the ten, and a model that
 * reaches for it turns a phone cable into a fridge item. These are the receipt
 * lines that are reliably not food and reliably named the same way.
 */
const NON_FOOD_PATTERN =
  /\b(bag|bags|fee|fees|deposit|recycl|enviro|delivery|service charge|tip|gratuity|battery|batteries|cable|charger|light\s*bulb|detergent|soap|shampoo|toothpaste|razor|tissue|toilet|paper towel|napkin|foil|wrap|cleaner|bleach|litter|pet food|dog|cat|flower|card|magazine|newspaper|lottery|gift card|stamp)\b/i;

/**
 * Does this line look like something you would put in a fridge or a cupboard?
 *
 * Deliberately generous: a false NO hides real shopping behind an unticked
 * checkbox, which is worse than a false YES that the person unticks. The
 * category is trusted first; only an unplaced or `Uncategorized` line is tested
 * against the non-food words.
 */
export function looksLikeFood(name: string, category: FridgeCategory | null): boolean {
  if (NON_FOOD_PATTERN.test(name)) return false;
  if (category === null) return false;
  return true;
}

/** The typical shelf life to offer for a category. Null when we should not guess. */
export function suggestedShelfLifeDays(category: FridgeCategory | null): number | null {
  if (category === null) return null;
  return TYPICAL_SHELF_LIFE_DAYS[category];
}

function trimmed(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length === 0 ? null : text.slice(0, max);
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return null;
}

function nonNegative(value: unknown): number | null {
  const parsed = num(value);
  if (parsed === null) return null;
  return parsed < 0 ? null : Math.round(parsed * 10) / 10;
}

function stringList(value: unknown, max: number, maxLen = 120): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const text = trimmed(entry, maxLen);
    if (text !== null) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Turn the shared receipt reading into fridge drafts.
 *
 * Exported and pure so the whole mapping — grouping, category matching, the
 * non-food flag, the shelf-life suggestion — can be reasoned about without a
 * model in the loop.
 *
 * Deduplicates by name AFTER category matching: the receipt prompt already
 * merges lines that share a simplified name, but two images of one long receipt
 * can still produce a repeat, and a fridge with "Milk" twice is a bug the person
 * has to clean up by hand.
 */
export function normalizeReceiptDraft(raw: Partial<RawGroceryReceipt>): FridgeReceiptDraft {
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const seen = new Set<string>();
  const items: FridgeReceiptItem[] = [];

  for (const entry of rawItems) {
    // `raw` is whatever the model returned, so the declared element type is a
    // claim rather than a fact — widen through `unknown` and re-read each field.
    const row = (entry ?? {}) as unknown as Record<string, unknown>;
    const name = trimmed(row.name, 120);
    if (name === null) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const category = toFridgeCategory(row.category);
    items.push({
      name,
      category,
      suggested_expiry_days: suggestedShelfLifeDays(category),
      // Cents, as the shared schema defines it. Negative would be a discount
      // line leaking through, which is not a purchase.
      amount_cents: (() => {
        const cents = num(row.amount);
        return cents === null || cents < 0 ? null : Math.round(cents);
      })(),
      looks_like_food: looksLikeFood(name, category),
    });
    if (items.length >= MAX_RECEIPT_ITEMS) break;
  }

  return {
    vendor: trimmed(raw.vendor, 120),
    purchase_date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.purchase_date ?? ''))
      ? String(raw.purchase_date)
      : null,
    items,
  };
}

/** Whole days from `today` to `dateKey`; negative once the date has passed. */
function daysUntil(dateKey: string, today: string): number | null {
  const from = Date.parse(`${today}T00:00:00Z`);
  const to = Date.parse(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

/**
 * Render the fridge for the prompt: most urgent first, each line carrying how
 * long it has left.
 *
 * Exported because WHAT THE MODEL WAS TOLD is the interesting half of any answer
 * it gives, and a caller that wants to show "these are the items we considered"
 * should not have to rebuild the list.
 */
export function buildIngredientLines(
  items: readonly MealPlannerItem[],
  today: string
): { lines: string[]; considered: string[] } {
  const scored = items
    .map((item) => {
      const days = item.expiry_date === null ? null : daysUntil(item.expiry_date, today);
      return { item, days };
    })
    // Dated items first, soonest (and longest-expired) first; undated last.
    .sort((a, b) => {
      if (a.days === null && b.days === null) return a.item.name.localeCompare(b.item.name);
      if (a.days === null) return 1;
      if (b.days === null) return -1;
      if (a.days !== b.days) return a.days - b.days;
      return a.item.name.localeCompare(b.item.name);
    })
    .slice(0, MAX_MEAL_INGREDIENTS);

  const lines = scored.map(({ item, days }) => {
    const amount =
      item.quantity === null
        ? ''
        : ` (${Number.isInteger(item.quantity) ? item.quantity : item.quantity.toFixed(1)}${
            item.unit ? ` ${item.unit}` : ''
          })`;
    const urgency =
      days === null
        ? 'no expiry date recorded'
        : days < 0
          ? `EXPIRED ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
          : days === 0
            ? 'expires TODAY'
            : `${days} day${days === 1 ? '' : 's'} left`;
    return `${item.name}${amount} — ${urgency}`;
  });

  return { lines, considered: scored.map(({ item }) => item.name) };
}

/** Coerce one model meal into the shape the client is typed against. */
function normalizeMeal(raw: unknown): FridgeMealSuggestion | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  const name = trimmed(row.name, 120);
  if (name === null) return null;
  return {
    name,
    description: trimmed(row.description, 400),
    ingredients_used: stringList(row.ingredients_used, 30),
    missing_ingredients: stringList(row.missing_ingredients, 10),
    calories: nonNegative(row.calories),
    protein_g: nonNegative(row.protein_g),
    carbs_g: nonNegative(row.carbs_g),
    fat_g: nonNegative(row.fat_g),
    instructions: stringList(row.instructions, 20, 400),
    uses_expiring: stringList(row.uses_expiring, 30),
    prep_minutes: (() => {
      const minutes = nonNegative(row.prep_minutes);
      return minutes === null ? null : Math.round(minutes);
    })(),
  };
}

/**
 * Normalise the plan, and hold the model to the list it was given.
 *
 * `ingredients_used` and `uses_expiring` are FILTERED against the fridge names
 * that were actually sent. The prompt says to copy them verbatim; filtering is
 * what makes that true rather than hoped-for, and it is the difference between
 * "uses the chicken you have" and a suggestion that quietly assumes chicken.
 * Anything the model invented moves to `missing_ingredients`, which is where an
 * ingredient you do not have belongs.
 */
export function normalizeMealPlan(
  raw: Partial<RawFridgeMealPlan>,
  considered: readonly string[]
): { meals: FridgeMealSuggestion[]; notes: string | null } {
  const owned = new Map(considered.map((name) => [name.toLowerCase(), name]));
  const rawMeals = Array.isArray(raw.meals) ? raw.meals : [];
  const meals: FridgeMealSuggestion[] = [];

  for (const entry of rawMeals.slice(0, MAX_MEAL_SUGGESTIONS)) {
    const meal = normalizeMeal(entry as RawFridgeMeal);
    if (meal === null) continue;

    const used: string[] = [];
    const invented: string[] = [];
    for (const ingredient of meal.ingredients_used) {
      const match = owned.get(ingredient.toLowerCase());
      if (match) used.push(match);
      else invented.push(ingredient);
    }
    meal.ingredients_used = [...new Set(used)];
    meal.missing_ingredients = [...new Set([...meal.missing_ingredients, ...invented])].slice(0, 12);
    meal.uses_expiring = meal.uses_expiring
      .map((n) => owned.get(n.toLowerCase()))
      .filter((n): n is string => n !== undefined && meal.ingredients_used.includes(n));

    // A "meal" that turned out to use nothing from the fridge is not an answer
    // to the question this feature asks.
    if (meal.ingredients_used.length === 0) continue;
    meals.push(meal);
  }

  return {
    meals,
    notes: meals.length === 0 ? (trimmed(raw.notes, 400) ?? null) : trimmed(raw.notes, 400),
  };
}

/* ==================================================================== */
/* Provider                                                             */
/* ==================================================================== */

/**
 * The acting user's provider, honouring BYOK.
 *
 * Returns null — never throws — when no key is configured for them: "no
 * credential" is a fail-closed state the screen renders as a plain notice, not
 * an error. Entitlement denial is a separate thing and is raised by
 * `assertCanUseAI` in the route, which is what produces the Unlock AI path.
 *
 * Same body as `routes/health-ai.ts`'s own `providerFor`; it lives here too
 * because that one is module-private and this service is mounted from a
 * different router.
 */
export async function providerForFridge(
  env: Env,
  userId: string,
  feature: string
): Promise<AIProvider | null> {
  try {
    const adapter = await createAnthropicAdapterForUser(
      env,
      userId,
      { feature, userId },
      HealthVisionService.MODEL
    );
    return adapter.isAvailable() ? adapter : null;
  } catch (err) {
    console.error('[health-fridge-ai] provider construction failed:', String(err).slice(0, 200));
    return null;
  }
}

/* ==================================================================== */
/* Service                                                              */
/* ==================================================================== */

export class HealthFridgeAiService {
  /**
   * A photographed receipt → reviewable fridge drafts. PERSISTS NOTHING.
   *
   * The person ticks what they actually want in the fridge and saves through the
   * ordinary `POST /health/fridge` route with `source: 'receipt'` — the same
   * review-before-write contract the label and meal scanners keep, and the
   * reason `fridge_items.source` has carried `'receipt'` since 0120 with nothing
   * ever writing it.
   */
  async scanReceipt(args: {
    provider: AIProvider;
    images: readonly VisionImageInput[];
    model?: string;
  }): Promise<{ ok: true; draft: FridgeReceiptDraft } | VisionFailure> {
    const resolved = resolveVisionImages(args.images);
    if (!resolved.ok) return resolved;

    const extracted = await extractWithVision<RawGroceryReceipt>({
      provider: args.provider,
      model: args.model ?? HealthVisionService.MODEL,
      systemPrompt: SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT,
      // The one line that makes Budget's receipt reader a FRIDGE receipt reader.
      userPrompt: buildScanReceiptUserPrompt(FRIDGE_CATEGORIES),
      schema: SCAN_GROCERY_RECEIPT_SCHEMA,
      images: resolved.images,
      // Budget's own figure for the same prompt: a long grocery receipt runs to
      // dozens of items and 2048 truncates the JSON mid-array.
      maxTokens: 4096,
    });
    if (!extracted.ok) return extracted;

    const draft = normalizeReceiptDraft(extracted.value);
    // No items at all means the picture was not a readable receipt. An empty
    // review list with a Save button would read as "your receipt had nothing on
    // it", which is a different and untrue statement.
    if (draft.items.length === 0) return { ok: false, reason: 'unreadable' };
    return { ok: true, draft };
  }

  /**
   * What could be cooked from what is in the fridge, urgent food first.
   *
   * `items` come from the caller's own D1 read — the client never sends an
   * inventory. An EMPTY fridge is answered without calling a model at all: there
   * is nothing to be creative about, and spending a request to be told so is
   * both slow and billable.
   */
  async suggestMeals(args: {
    provider: AIProvider;
    items: readonly MealPlannerItem[];
    today: string;
    goal: string;
    restrictions: string | null;
    model?: string;
  }): Promise<{ ok: true; plan: FridgeMealPlan } | VisionFailure> {
    const { lines, considered } = buildIngredientLines(args.items, args.today);
    if (lines.length === 0) {
      return {
        ok: true,
        plan: {
          meals: [],
          notes: 'There is nothing in your fridge yet, so there is nothing to cook from.',
          considered: [],
        },
      };
    }

    let result;
    try {
      result = await args.provider.generate({
        model: args.model ?? HealthVisionService.MODEL,
        systemPrompt: FRIDGE_MEALS_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: buildFridgeMealsUserPrompt({
              ingredients: lines,
              goal: args.goal,
              restrictions: args.restrictions,
            }),
          },
        ],
        tools: [
          {
            name: 'output',
            description: 'Return the meal suggestions as structured output.',
            input_schema: FRIDGE_MEALS_SCHEMA,
          },
        ],
        toolChoice: { type: 'tool', name: 'output' },
        maxTokens: 3072,
      });
    } catch (err) {
      // Scrubbed, logged, and NEVER returned — no raw provider strings in the UI.
      console.error('[health-fridge-ai] provider call failed:', String(err).slice(0, 200));
      return { ok: false, reason: 'provider_unavailable' };
    }

    const block = result.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use' || !block.input || typeof block.input !== 'object') {
      return { ok: false, reason: 'unreadable' };
    }

    const { meals, notes } = normalizeMealPlan(
      block.input as Partial<RawFridgeMealPlan>,
      considered
    );
    return {
      ok: true,
      plan: {
        meals,
        // An empty list is a legitimate answer ("this fridge holds condiments"),
        // so it is not a failure — but it must come with a reason, or the screen
        // shows a blank card that reads as a broken feature.
        notes:
          meals.length === 0
            ? (notes ??
              'Nothing in your fridge adds up to a meal on its own right now. Add a few staples and try again.')
            : notes,
        considered,
      },
    };
  }
}
