/**
 * OpenAI image generation for garden / yard site plans.
 *
 * Replaces the legacy DALL·E 3 text-only path. We now use `gpt-image-1`,
 * which supports BOTH text-to-image generation and image-conditioned
 * editing — passing a reference image (e.g. a satellite tile of the
 * household's lot, or the user's own yard photo) lets the model trace
 * the real lot shape rather than hallucinating a generic suburban yard.
 *
 * Two callable functions:
 *   - `generateGardenSitePlanFromReference(env, prompt, refImage)` — POST
 *     `/v1/images/edits` with the reference PNG attached as `image[]`.
 *     Used when we have a user-attached yard photo.
 *   - `generateGardenSitePlanTextOnly(env, prompt)` — POST
 *     `/v1/images/generations`. Used as a fallback when no reference
 *     image is available; the resulting plan is rebranded as a "concept"
 *     in the UI so the user knows it isn't tied to their actual lot.
 *
 * Both return the same `GenerateGardenPlanImageResult` shape so the queue
 * handler doesn't have to branch.
 */
const GPT_IMAGE_MODEL = 'gpt-image-1';
const MAX_PROMPT_CHARS = 4000;
/**
 * Workers wall-clock fetch limit on `cf.alwaysUseLatestCompatibilityDate` is
 * generous, but `gpt-image-1` high quality calls can take 30–60s. We give
 * the queue handler a margin (queue handlers have minutes of wall time, not
 * the 30s request limit), but still abort at a clear ceiling so a stuck
 * request doesn't hold the consumer worker forever.
 */
const OPENAI_TIMEOUT_MS = 90_000;

/** Stable error codes returned via `Error.message`. */
export type GardenPlanErrorCode =
  | 'openai_not_configured'
  | 'openai_image_timeout'
  | 'openai_image_no_data'
  | 'openai_image_rate_limited'
  | 'openai_image_content_policy'
  | 'openai_image_unauthorized'
  | 'openai_image_failed'
  | 'openai_image_invalid_prompt';

/**
 * Output dimensions. gpt-image-1 supports `1024x1024`, `1024x1536`, and
 * `1536x1024`. We use `1536x1024` (3:2 landscape) so the result fits the
 * mobile garden plan card aspect ratio without letterboxing.
 */
export const GARDEN_PLAN_IMAGE_WIDTH = 1536;
export const GARDEN_PLAN_IMAGE_HEIGHT = 1024;
const OUTPUT_SIZE = `${GARDEN_PLAN_IMAGE_WIDTH}x${GARDEN_PLAN_IMAGE_HEIGHT}` as const;

/**
 * Build the prompt sent to gpt-image-1. The prompt is now mostly DETERMINISTIC
 * — Mira only contributes the user-facing description; the structural
 * scaffolding lives here so the output is consistent across requests.
 */
export function buildGardenSitePlanPrompt(
  userDiagramDescription: string,
  hasReferenceImage: boolean
): string {
  const structuralPrefix = hasReferenceImage
    ? 'Using the attached image as the LOT REFERENCE for shape, orientation, ' +
      'and existing structures, draw a professional 2D top-down landscape ' +
      'and garden site plan that fits the confirmed plot boundary. If the ' +
      'reference contains a green parcel/property outline, preserve that exact ' +
      'boundary as the outer limit of the plan and do not place any design ' +
      'elements outside it. Trace the actual house footprint, driveway, and ' +
      'key existing trees from the reference. ' +
      'Render the result as a clean architectural presentation drawing in a ' +
      'simple watercolor + ink-line style — NOT a photo, NOT a satellite image, ' +
      'NOT a 3D render. Bird-eye orthographic view, north up.'
    : 'Professional 2D top-down landscape and garden site plan, architectural ' +
      'presentation drawing, simple watercolor + ink-line style, bird-eye ' +
      'orthographic view, NOT a photograph, NOT a satellite or aerial photo, ' +
      'NOT a 3D render. Generic suburban lot — this is a stylized concept, ' +
      'not the user\'s actual property.';
  const structuralSuffix =
    ' Use clear text labels on each zone (lawn, beds, dining, fire pit, etc.). ' +
    'Show planting beds with simple plant symbols, paths in a contrasting tone, ' +
    'patio or deck as a hatched rectangle, lawn as light green. Light neutral ' +
    'background, fully readable labels. Avoid people, animals, vehicles, and ' +
    'photographic textures.';
  const combined =
    structuralPrefix + ' ' + userDiagramDescription.trim() + structuralSuffix;
  return combined.length > MAX_PROMPT_CHARS
    ? combined.slice(0, MAX_PROMPT_CHARS)
    : combined;
}

export interface GenerateGardenPlanImageResult {
  pngBytes: ArrayBuffer;
  width: number;
  height: number;
  /** OpenAI's revised prompt — useful for debugging hallucinations. */
  revisedPrompt?: string;
  /** Round-trip to OpenAI in milliseconds — useful for observability. */
  latencyMs: number;
  /** Was a reference image used (image-conditioned edit) or pure text-to-image? */
  usedReference: boolean;
}

/**
 * Map OpenAI HTTP status + error body to a stable `GardenPlanErrorCode`.
 */
function classifyOpenAiError(status: number, body: string): GardenPlanErrorCode {
  if (status === 401 || status === 403) return 'openai_image_unauthorized';
  if (status === 429) return 'openai_image_rate_limited';
  if (status === 400 && /content[_\s-]?policy|safety|moderation/i.test(body)) {
    return 'openai_image_content_policy';
  }
  if (status === 400) return 'openai_image_invalid_prompt';
  return 'openai_image_failed';
}

function arrayBufferToBytes(b: ArrayBuffer): Uint8Array {
  return new Uint8Array(b);
}

function decodeB64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Text-to-image generation. Use only when no reference image is available;
 * the result is a stylized "concept" plan, not tied to the real lot.
 *
 * @throws Error whose `.message` is a `GardenPlanErrorCode`.
 */
export async function generateGardenSitePlanTextOnly(
  apiKey: string,
  userDiagramDescription: string
): Promise<GenerateGardenPlanImageResult> {
  if (!apiKey) {
    throw new Error('openai_not_configured');
  }
  const prompt = buildGardenSitePlanPrompt(userDiagramDescription, false);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GPT_IMAGE_MODEL,
        prompt,
        n: 1,
        size: OUTPUT_SIZE,
        // gpt-image-1 always returns base64; no `response_format` needed.
        quality: 'high',
      }),
    });
  } catch (err) {
    clearTimeout(timeout);
    const aborted =
      (err as { name?: string }).name === 'AbortError' ||
      controller.signal.aborted;
    throw new Error(aborted ? 'openai_image_timeout' : 'openai_image_failed');
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const code = classifyOpenAiError(res.status, errText);
    console.warn('[garden-plan] openai images.generate error', {
      status: res.status,
      code,
      excerpt: errText.slice(0, 200),
    });
    throw new Error(code);
  }

  const data = (await res.json()) as {
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  };
  const first = data.data?.[0];
  const b64 = first?.b64_json;
  if (!b64) {
    throw new Error('openai_image_no_data');
  }
  return {
    pngBytes: decodeB64ToArrayBuffer(b64),
    width: GARDEN_PLAN_IMAGE_WIDTH,
    height: GARDEN_PLAN_IMAGE_HEIGHT,
    revisedPrompt: first.revised_prompt,
    latencyMs: Date.now() - startedAt,
    usedReference: false,
  };
}

export interface ReferenceImage {
  /** Raw PNG / JPEG bytes the model conditions on. */
  bytes: ArrayBuffer;
  /** MIME type — only `image/png` and `image/jpeg` are accepted by gpt-image-1. */
  mimeType: 'image/png' | 'image/jpeg';
  /** A short descriptive filename (user attachments preserve original). */
  filename: string;
}

/**
 * Image-conditioned generation via `/v1/images/edits`. The reference image
 * tells the model the actual lot shape, so the result reads as the user's
 * yard rather than a generic stock illustration.
 *
 * @throws Error whose `.message` is a `GardenPlanErrorCode`.
 */
export async function generateGardenSitePlanFromReference(
  apiKey: string,
  userDiagramDescription: string,
  reference: ReferenceImage
): Promise<GenerateGardenPlanImageResult> {
  if (!apiKey) {
    throw new Error('openai_not_configured');
  }
  const prompt = buildGardenSitePlanPrompt(userDiagramDescription, true);

  const form = new FormData();
  form.append('model', GPT_IMAGE_MODEL);
  form.append('prompt', prompt);
  form.append('n', '1');
  form.append('size', OUTPUT_SIZE);
  form.append('quality', 'high');
  // `input_fidelity=high` tells the model to stick close to the geometry
  // of the reference image (lot shape, house footprint). Without it the
  // model treats the reference as a soft inspiration and drifts.
  form.append('input_fidelity', 'high');

  // FormData expects a Blob/File. Build a Blob from the ArrayBuffer.
  const blob = new Blob([reference.bytes], { type: reference.mimeType });
  form.append('image[]', blob, reference.filename);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        // DO NOT set Content-Type — the runtime fills it with the correct
        // multipart boundary when we pass FormData as the body.
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });
  } catch (err) {
    clearTimeout(timeout);
    const aborted =
      (err as { name?: string }).name === 'AbortError' ||
      controller.signal.aborted;
    throw new Error(aborted ? 'openai_image_timeout' : 'openai_image_failed');
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const code = classifyOpenAiError(res.status, errText);
    console.warn('[garden-plan] openai images.edit error', {
      status: res.status,
      code,
      excerpt: errText.slice(0, 200),
      referenceBytes: reference.bytes.byteLength,
    });
    throw new Error(code);
  }

  const data = (await res.json()) as {
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  };
  const first = data.data?.[0];
  const b64 = first?.b64_json;
  if (!b64) {
    throw new Error('openai_image_no_data');
  }
  return {
    pngBytes: decodeB64ToArrayBuffer(b64),
    width: GARDEN_PLAN_IMAGE_WIDTH,
    height: GARDEN_PLAN_IMAGE_HEIGHT,
    revisedPrompt: first.revised_prompt,
    latencyMs: Date.now() - startedAt,
    usedReference: true,
  };
}

/**
 * Suppress an unused-import lint in test environments where `arrayBufferToBytes`
 * isn't called from this file but is exported for tests.
 */
export const __internal = { arrayBufferToBytes, decodeB64ToArrayBuffer };

/**
 * Map a `GardenPlanErrorCode` (or arbitrary string) to a user-friendly
 * sentence. Used by the API layer and the mobile approvals screen so we
 * never surface raw OpenAI error JSON to homeowners.
 */
export function friendlyErrorMessage(code: string): string {
  switch (code) {
    case 'openai_not_configured':
    case 'garden_plan_openai_unavailable':
      return 'Image generation is not configured on the server. Add a plan image manually from the Gardening tab.';
    case 'openai_image_timeout':
      return 'Image generation took too long to respond. Please try again in a moment.';
    case 'openai_image_rate_limited':
    case 'garden_plan_rate_limited':
      return "We've hit today's image generation limit for this household. Please try again tomorrow.";
    case 'openai_image_content_policy':
      return 'The description was rejected by the safety filter. Re-word the prompt and try again.';
    case 'openai_image_unauthorized':
      return 'Image generation credentials are invalid. Please contact support.';
    case 'openai_image_invalid_prompt':
      return 'Image generation rejected the prompt. Make it more concrete and try again.';
    case 'openai_image_no_data':
      return 'Image generation returned no image. Please try again.';
    case 'invalid_plan_context':
    case 'invalid_plan_type':
      return 'The selected area is not a valid outdoor plan type.';
    case 'missing_diagram_prompt':
      return 'No description was provided for the plan.';
    case 'garden_plan_stuck_in_queue':
      return "Generation took longer than expected and we couldn't recover it. Please try again.";
    case 'garden_plan_row_missing':
      return 'We lost track of this plan request. Please try again.';
    case 'openai_image_failed':
    default:
      return 'Could not generate the plan image. Please try again later.';
  }
}
