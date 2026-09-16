/**
 * Symply Health vision extraction — nutrition labels and meal photos.
 *
 * Ports the donor's `POST /api/v1/ai/scan-nutrition-label` (+ its second
 * `/scan-product-name` pass), `POST /api/v1/ai/analyze-food` and
 * `POST /api/v1/ai/analyze-food-scale`
 * (`~/Desktop/Symply Ecosystem/Simply Health/backend/src/routes/ai.ts`).
 *
 * NOTHING IS PERSISTED HERE. Both calls return a reviewable DRAFT. The person
 * edits it and saves through routes that already exist — `POST /health/custom-foods`
 * (`source_type: 'scanned'`, a value the enum has carried since 0120) and
 * `POST /health/nutrition/entries`. That is deliberate: a scan is a suggestion,
 * and the same review-before-write rule the Budget receipt scanner follows.
 *
 * ── THE MEDIA-TYPE TRAP, AND THE ONE CHOKEPOINT THAT CLOSES IT ───────────────
 *
 * A phone photo named `.png` that actually holds JPEG bytes makes Anthropic
 * answer `400 invalid_request_error: "media type image/png, but the image
 * appears to be a image/jpeg image"`, which reaches the member as a generic
 * "could not read". This is common — pickers and share sheets rename freely.
 *
 * `ai/media-type.ts` already exists for exactly this and is the ONLY sniffer in
 * the repo; `resolveMediaType()` is called here on every image before it is
 * handed to a provider. It is not re-implemented, and the declared MIME is never
 * trusted over the magic bytes.
 *
 * A file whose bytes match nothing we support (HEIC/HEIF is the common case on
 * iOS) is REFUSED with a plain message rather than forwarded to fail — the RN
 * screen re-encodes to JPEG before upload, the same `toVisionSafeAttachment`
 * step `BudgetReceiptScanScreen` does.
 *
 * ── FAIL CLOSED ──────────────────────────────────────────────────────────────
 *
 * Every failure mode returns a typed refusal, never a fabricated draft and never
 * a provider string: `unsupported_media` (bad bytes), `unreadable` (the model
 * answered but the answer was not a usable extraction), `provider_unavailable`
 * (it threw or timed out). The route maps each to member-facing copy.
 */

import { detectMediaTypeFromBase64, type SupportedMediaType } from '../../ai/media-type';
import {
  ANALYZE_MEAL_PHOTO_SCHEMA,
  ANALYZE_MEAL_PHOTO_SYSTEM_PROMPT,
  ANALYZE_MEAL_PHOTO_USER_PROMPT,
  type RawMealPhoto,
  type RawMealPhotoFood,
} from '../../ai/prompts/health-meal-photo';
import {
  SCAN_NUTRITION_LABEL_SCHEMA,
  SCAN_NUTRITION_LABEL_SYSTEM_PROMPT,
  SCAN_NUTRITION_LABEL_USER_PROMPT,
  type RawNutritionLabel,
} from '../../ai/prompts/health-nutrition-label';
import type { AIProvider, GenerateMessage } from '../../ai/provider';

/** Image types Anthropic accepts. PDFs are not a food photo, so they are out. */
const VISION_MEDIA_TYPES: readonly SupportedMediaType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** A long label may be shot in two frames (panel + front of pack). */
export const MAX_VISION_IMAGES = 4;

export interface VisionImageInput {
  base64: string;
  /** What the client CLAIMS it is. Never trusted over the bytes. */
  declaredMediaType: string;
}

export type VisionFailure =
  | { ok: false; reason: 'unsupported_media' }
  | { ok: false; reason: 'unreadable' }
  | { ok: false; reason: 'provider_unavailable' };

/**
 * Where the per-100 g basis came from. Shown to the person, because "copied off
 * the label" and "we divided by the serving size" are not the same claim.
 */
export type Per100Source = 'label' | 'derived' | 'none';

export interface NutritionLabelDraft {
  product_name: string | null;
  brand: string | null;
  serving_size: string | null;
  serving_size_g: number | null;
  serving_size_unit: 'g' | 'ml' | null;
  servings_per_container: number | null;
  /** Per SERVING, as printed. */
  calories: number | null;
  proteins: number | null;
  carbohydrates: number | null;
  fats: number | null;
  saturated_fat: number | null;
  trans_fat: number | null;
  cholesterol: number | null;
  sodium: number | null;
  dietary_fiber: number | null;
  total_sugars: number | null;
  added_sugars: number | null;
  vitamin_d: number | null;
  calcium: number | null;
  iron: number | null;
  potassium: number | null;
  ingredients: string | null;
  /** The basis `custom_foods` stores and every portion is re-derived from. */
  base_calories_per_100: number | null;
  base_proteins_per_100: number | null;
  base_carbs_per_100: number | null;
  base_fats_per_100: number | null;
  per_100_source: Per100Source;
  confidence: number | null;
  notes: string | null;
}

export interface MealPhotoDraft {
  foods: RawMealPhotoFood[];
  scale_reading: RawMealPhoto['scale_reading'];
  meal_type: RawMealPhoto['meal_type'];
  total_calories: number | null;
  image_quality: string | null;
  notes: string | null;
}

/**
 * Sniff each image from its MAGIC BYTES and refuse the batch if any one is
 * unusable.
 *
 * `detectMediaTypeFromBase64` is the shared sniffer from `ai/media-type.ts` —
 * the same primitive `resolveMediaType()` calls, and the only one in the repo.
 * It is used directly here rather than through `resolveMediaType` for one
 * reason: `resolveMediaType` FALLS BACK to the declared type when the bytes are
 * unrecognisable, which is right for a document-extraction path that would
 * rather try than refuse. For a photo it is not. Unrecognisable leading bytes
 * mean HEIC (what an iPhone hands you by default), a truncated upload, or
 * something that is not an image; forwarding any of those produces a provider
 * 400 that the member reads as "could not read that label". Refusing with a
 * clear message, and letting the RN screen re-encode to JPEG first (the same
 * `toVisionSafeAttachment` step `BudgetReceiptScanScreen` already does), is the
 * honest version.
 *
 * The consequence, stated plainly: `declaredMediaType` is ADVISORY here and is
 * never what gets sent. The bytes decide, always.
 *
 * Refusing the BATCH rather than dropping the bad frame is deliberate too: a
 * person who attached the nutrition panel and the front of the pack, and
 * silently got a reading of only one of them, would not know which half the
 * answer came from.
 */
export function resolveVisionImages(
  images: readonly VisionImageInput[]
): { ok: true; images: Array<{ base64: string; mediaType: SupportedMediaType }> } | VisionFailure {
  if (images.length === 0 || images.length > MAX_VISION_IMAGES) {
    return { ok: false, reason: 'unsupported_media' };
  }
  const out: Array<{ base64: string; mediaType: SupportedMediaType }> = [];
  for (const img of images) {
    if (!img.base64) return { ok: false, reason: 'unsupported_media' };
    const sniffed = detectMediaTypeFromBase64(img.base64);
    // null → unrecognised (HEIC, truncated, not an image at all).
    // 'application/pdf' → recognised, but not a photograph of food.
    if (sniffed === null || !(VISION_MEDIA_TYPES as readonly string[]).includes(sniffed)) {
      return { ok: false, reason: 'unsupported_media' };
    }
    out.push({ base64: img.base64, mediaType: sniffed });
  }
  return { ok: true, images: out };
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  // The donor's iOS DTO coerces string→double because models sometimes answer
  // "150" for a numeric field. Same tolerance, but only for a clean numeral.
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/** Round to one decimal — the precision a label is printed at. */
function per100(value: number, servingG: number): number {
  return Math.round((value / servingG) * 100 * 10) / 10;
}

/**
 * Turn a raw label reading into the draft the app stores.
 *
 * THE ONE PIECE OF ARITHMETIC THAT MATTERS: `custom_foods` derives every portion
 * from `base_*_per_100`, so a scan without that basis produces a food that can
 * never be re-portioned — the gap 0124 closed for the diary. The label's own
 * per-100 column is preferred when it prints one (EU/UK labels always do); only
 * when it does not do we divide by the serving mass, and `per_100_source` says
 * which happened so the screen can show it.
 *
 * The model is explicitly told NOT to do this division (see the prompt): a model
 * asked to divide tends to round the serving figure first and compound the error.
 */
export function normalizeLabelDraft(raw: Partial<RawNutritionLabel>): NutritionLabelDraft {
  const servingG = num(raw.serving_size_g);
  const unit = raw.serving_size_unit === 'ml' ? 'ml' : raw.serving_size_unit === 'g' ? 'g' : null;

  const calories = num(raw.calories);
  const proteins = num(raw.protein);
  const carbs = num(raw.total_carbohydrates);
  const fats = num(raw.total_fat);

  const labelPer100 = num(raw.per_100_calories);
  let base_calories_per_100: number | null = null;
  let base_proteins_per_100: number | null = null;
  let base_carbs_per_100: number | null = null;
  let base_fats_per_100: number | null = null;
  let per_100_source: Per100Source = 'none';

  if (labelPer100 !== null) {
    per_100_source = 'label';
    base_calories_per_100 = labelPer100;
    base_proteins_per_100 = num(raw.per_100_protein);
    base_carbs_per_100 = num(raw.per_100_carbohydrates);
    base_fats_per_100 = num(raw.per_100_fat);
  } else if (servingG !== null && servingG > 0 && calories !== null) {
    per_100_source = 'derived';
    base_calories_per_100 = per100(calories, servingG);
    base_proteins_per_100 = proteins === null ? null : per100(proteins, servingG);
    base_carbs_per_100 = carbs === null ? null : per100(carbs, servingG);
    base_fats_per_100 = fats === null ? null : per100(fats, servingG);
  }

  return {
    product_name: str(raw.product_name),
    brand: str(raw.brand),
    serving_size: str(raw.serving_size),
    serving_size_g: servingG,
    serving_size_unit: unit,
    servings_per_container: num(raw.servings_per_container),
    calories,
    proteins,
    carbohydrates: carbs,
    fats,
    saturated_fat: num(raw.saturated_fat),
    trans_fat: num(raw.trans_fat),
    cholesterol: num(raw.cholesterol),
    sodium: num(raw.sodium),
    dietary_fiber: num(raw.dietary_fiber),
    total_sugars: num(raw.total_sugars),
    added_sugars: num(raw.added_sugars),
    vitamin_d: num(raw.vitamin_d),
    calcium: num(raw.calcium),
    iron: num(raw.iron),
    potassium: num(raw.potassium),
    ingredients: str(raw.ingredients),
    base_calories_per_100,
    base_proteins_per_100,
    base_carbs_per_100,
    base_fats_per_100,
    per_100_source,
    confidence: num(raw.confidence),
    notes: str(raw.notes),
  };
}

/**
 * A draft with no energy figure at all is NOT a reading — it is the model
 * describing a picture. The donor's UI has the same rule ("The scan returned all
 * zeros… try again or enter values manually"), enforced client-side; enforcing
 * it here means every client gets it.
 */
export function labelDraftIsUsable(draft: NutritionLabelDraft): boolean {
  return draft.calories !== null || draft.base_calories_per_100 !== null;
}

export function normalizeMealDraft(raw: Partial<RawMealPhoto>): MealPhotoDraft {
  const rawFoods = Array.isArray(raw.foods) ? raw.foods : [];
  const foods: RawMealPhotoFood[] = [];
  for (const f of rawFoods.slice(0, 20)) {
    // `raw` is whatever the model returned, so the declared element type is a
    // claim rather than a fact — widen through `unknown` and re-read every field.
    const item = (f ?? {}) as unknown as Record<string, unknown>;
    const name = str(item.food_name);
    if (!name) continue;
    foods.push({
      food_name: name.slice(0, 120),
      brand: str(item.brand),
      cooking_state: str(item.cooking_state),
      portion: num(item.portion),
      unit: str(item.unit),
      calories: num(item.calories),
      proteins: num(item.proteins),
      carbohydrates: num(item.carbohydrates),
      fats: num(item.fats),
      fiber: num(item.fiber),
      sugar: num(item.sugar),
      calories_per_100g: num(item.calories_per_100g),
      proteins_per_100g: num(item.proteins_per_100g),
      carbs_per_100g: num(item.carbs_per_100g),
      fats_per_100g: num(item.fats_per_100g),
      confidence: num(item.confidence),
      data_source: (item.data_source ?? null) as RawMealPhotoFood['data_source'],
    });
  }

  const scale = raw.scale_reading as RawMealPhoto['scale_reading'];
  const meal = raw.meal_type;

  return {
    foods,
    scale_reading:
      scale && typeof scale === 'object'
        ? {
            value: num((scale as Record<string, unknown>).value),
            unit: str((scale as Record<string, unknown>).unit),
            detected: (scale as Record<string, unknown>).detected === true,
          }
        : null,
    meal_type:
      meal === 'breakfast' || meal === 'lunch' || meal === 'dinner' || meal === 'snack' ? meal : null,
    // Always recomputed rather than trusted: the donor returns the model's own
    // sum, which disagrees with its rows often enough to be noticed.
    total_calories: foods.some((f) => f.calories === null)
      ? null
      : Math.round(foods.reduce((s, f) => s + (f.calories ?? 0), 0)),
    image_quality: str(raw.image_quality),
    notes: str(raw.notes),
  };
}

/**
 * The vision call itself, shared by every Health surface that reads a picture.
 *
 * Uses the provider-neutral `generate()` with a FORCED single tool, so the model
 * has to answer in the schema rather than in prose that then needs a JSON
 * scraper. `generateStructured` cannot be used here because it takes a text
 * prompt only and these calls carry images.
 *
 * EXPORTED so the fridge receipt reader (`health-fridge-ai-service.ts`) runs
 * through this exact function rather than growing a second copy of the
 * image-block assembly, the forced-tool call and the "the model answered but not
 * with an extraction" rule. Three vision surfaces, one call path.
 */
export async function extractWithVision<T>(args: {
  provider: AIProvider;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  images: Array<{ base64: string; mediaType: SupportedMediaType }>;
  maxTokens: number;
}): Promise<{ ok: true; value: Partial<T> } | VisionFailure> {
  const content: Extract<GenerateMessage['content'], unknown[]> = [
    ...args.images.map(
      (img) =>
        ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            // Already sniffed by `resolveVisionImages`; the provider sniffs again
            // at its own boundary, which is idempotent.
            media_type: img.mediaType as 'image/jpeg' | 'image/png' | 'image/webp',
            data: img.base64,
          },
        }) as const
    ),
    { type: 'text' as const, text: args.userPrompt },
  ];

  let result;
  try {
    result = await args.provider.generate({
      model: args.model,
      systemPrompt: args.systemPrompt,
      messages: [{ role: 'user', content }],
      tools: [
        {
          name: 'output',
          description: 'Return the extraction as structured output.',
          input_schema: args.schema,
        },
      ],
      toolChoice: { type: 'tool', name: 'output' },
      maxTokens: args.maxTokens,
    });
  } catch (err) {
    // Scrubbed, logged, and NEVER returned — no raw provider strings in the UI.
    console.error('[health-vision] provider call failed:', String(err).slice(0, 200));
    return { ok: false, reason: 'provider_unavailable' };
  }

  const block = result.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use' || !block.input || typeof block.input !== 'object') {
    // The model answered, but not with an extraction. That is "unreadable" — it
    // must never be turned into an empty draft that looks like a real reading.
    return { ok: false, reason: 'unreadable' };
  }
  return { ok: true, value: block.input as Partial<T> };
}

export class HealthVisionService {
  /** Vision-capable, and the model the platform's other extract paths use. */
  static readonly MODEL = 'claude-sonnet-4-5-20250929';

  async scanNutritionLabel(args: {
    provider: AIProvider;
    images: readonly VisionImageInput[];
    model?: string;
  }): Promise<{ ok: true; draft: NutritionLabelDraft } | VisionFailure> {
    const resolved = resolveVisionImages(args.images);
    if (!resolved.ok) return resolved;

    const extracted = await extractWithVision<RawNutritionLabel>({
      provider: args.provider,
      model: args.model ?? HealthVisionService.MODEL,
      systemPrompt: SCAN_NUTRITION_LABEL_SYSTEM_PROMPT,
      userPrompt: SCAN_NUTRITION_LABEL_USER_PROMPT,
      schema: SCAN_NUTRITION_LABEL_SCHEMA,
      images: resolved.images,
      maxTokens: 2048,
    });
    if (!extracted.ok) return extracted;

    const draft = normalizeLabelDraft(extracted.value);
    if (!labelDraftIsUsable(draft)) return { ok: false, reason: 'unreadable' };
    return { ok: true, draft };
  }

  async analyzeMealPhoto(args: {
    provider: AIProvider;
    images: readonly VisionImageInput[];
    model?: string;
  }): Promise<{ ok: true; draft: MealPhotoDraft } | VisionFailure> {
    const resolved = resolveVisionImages(args.images);
    if (!resolved.ok) return resolved;

    const extracted = await extractWithVision<RawMealPhoto>({
      provider: args.provider,
      model: args.model ?? HealthVisionService.MODEL,
      systemPrompt: ANALYZE_MEAL_PHOTO_SYSTEM_PROMPT,
      userPrompt: ANALYZE_MEAL_PHOTO_USER_PROMPT,
      schema: ANALYZE_MEAL_PHOTO_SCHEMA,
      images: resolved.images,
      maxTokens: 4096,
    });
    if (!extracted.ok) return extracted;

    const draft = normalizeMealDraft(extracted.value);
    // An empty food list is a legitimate answer ("that is not food"), and the
    // screen says so — unlike a label, where no energy figure means the read
    // failed. Both are honest; they differ because the questions differ.
    return { ok: true, draft };
  }
}
