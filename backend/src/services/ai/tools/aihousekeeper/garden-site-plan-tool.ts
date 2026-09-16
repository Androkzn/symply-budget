/**
 * `create_garden_site_plan` — propose a 2D top-down garden / yard site plan.
 *
 * SIMPLIFIED INPUT (replaces the legacy free-form `diagram_prompt`):
 *   - plan_type: which outdoor area
 *   - area_label: short user-facing name
 *   - vibe: one short style descriptor (Mira can collect with a single
 *     question; e.g. "cottage garden", "modern minimalist", "low-maintenance")
 *   - must_haves: 0-12 short feature names (e.g. "fire pit", "raised veg beds")
 *   - notes: optional 1-2 sentence freeform amendment
 *   - attachment_id: optional aihousekeeper_attachments.id of a yard photo /
 *     screenshot the user attached. When present the backend uses it as the
 *     reference image for gpt-image-1; otherwise generation falls back to a
 *     stylized text-only concept plan.
 *
 * The structured fields are deterministically rendered into the OpenAI
 * prompt by `buildDiagramPromptFromStructuredInput`. Keeping the rendering
 * server-side means we control the result quality without re-prompting
 * Mira every release.
 */
import { z } from 'zod';

import { GARDEN_PLAN_TYPES, type GardenPlanType } from '../../../../db/schema-garden-plans';
import { resolveProviderApiKey } from '../../../ai-credential-resolver';
import { sha256Hex } from '../../../aihousekeeper/event-bus';
import {
  DEFAULT_GARDEN_PLAN_DAILY_CAP,
  getGardenPlanCount,
} from '../../garden-plan-rate-limit';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

const planTypeValues = GARDEN_PLAN_TYPES as unknown as [GardenPlanType, ...GardenPlanType[]];

/**
 * Render the structured user intent into a single descriptive paragraph the
 * image-generation service prefixes with the architectural-drawing scaffold.
 *
 * Exported for unit tests + so `executeCreateGardenSitePlan` can call it
 * when the parked input came from a legacy chat (still has `diagram_prompt`).
 */
export function buildDiagramPromptFromStructuredInput(input: {
  plan_type: GardenPlanType;
  area_label: string;
  vibe?: string | null;
  must_haves?: readonly string[] | null;
  notes?: string | null;
  boundary_measurements?: {
    unit: 'feet' | 'meters';
    width: number;
    depth: number;
    area: number;
  } | null;
}): string {
  const planLabel = input.plan_type.replace(/_/g, ' ');
  const vibe = input.vibe?.trim();
  const features = (input.must_haves ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const notes = input.notes?.trim();
  const measurements = input.boundary_measurements;

  const parts: string[] = [];
  parts.push(`Subject: ${input.area_label} — a ${planLabel}.`);
  if (vibe) {
    parts.push(`Style: ${vibe}.`);
  }
  if (features.length > 0) {
    parts.push(
      `Must include, each clearly labeled in plan view: ${features.join(', ')}.`
    );
  }
  if (measurements) {
    const lengthUnit = measurements.unit === 'feet' ? 'ft' : 'm';
    const areaUnit = measurements.unit === 'feet' ? 'sq ft' : 'sq m';
    parts.push(
      `Confirmed map size: approximately ${formatMeasurement(measurements.width)} ${lengthUnit} x ` +
        `${formatMeasurement(measurements.depth)} ${lengthUnit} ` +
        `(${formatMeasurement(measurements.area)} ${areaUnit}).`
    );
  }
  parts.push(
    'Show the house footprint clearly, with the lot boundary visible. ' +
      'Render planting beds, lawn, hardscape, and paths in distinct tones ' +
      'so the zones are easy to read at a glance.'
  );
  if (notes) {
    parts.push(`Additional notes from the homeowner: ${notes}`);
  }
  return parts.join(' ');
}

function formatMeasurement(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export const createGardenSitePlan: AihousekeeperTool = {
  name: 'create_garden_site_plan',
  kind: 'HIGH_WRITE',
  description:
    'Propose a 2D top-down garden / yard site plan after collecting a tiny amount of structured intent. ' +
    'Use when the homeowner asks Aihousekeeper to draw, design, or plan a yard, garden, front yard, back yard, or planting bed. ' +
    'You only need: which area (plan_type), a short label, an overall vibe (one or two words like "cottage garden" or "modern minimalist"), and 0–8 must-have features (each a short noun-phrase like "fire pit", "raised veg beds", "shade tree"). The backend handles all the rest — including fetching a satellite tile of the household address — so DO NOT try to describe the lot shape, dimensions, or compass orientation yourself. ' +
    'If the user has attached a yard photo or satellite screenshot in this conversation, pass its attachment_id so the AI traces their actual lot. ' +
    'This parks for user approval; after approval a PNG is generated (15–30s) and saved as a site plan in Gardening. ' +
    'If the tool returns garden_plan_rate_limited say the household has hit today\'s image limit and to try tomorrow. ' +
    'If it returns garden_plan_openai_unavailable, say image generation is not configured and they can add a plan manually from Gardening.',
  input: z.object({
    plan_type: z
      .enum(planTypeValues)
      .describe(
        'Which outdoor area: front_yard, back_yard, garden, bed, or other_outdoor.'
      ),
    area_label: z
      .string()
      .min(1)
      .max(120)
      .describe(
        'Short user-facing name for the plan, e.g. "Back yard", "Front garden", "Pollinator bed".'
      ),
    vibe: z
      .string()
      .min(1)
      .max(80)
      .describe(
        'Overall style in 1–4 words. Examples: "cottage garden", "modern minimalist", "low-maintenance native", "kid-friendly lawn".'
      ),
    must_haves: z
      .array(z.string().min(1).max(60))
      .max(12)
      .optional()
      .describe(
        'Up to 12 short feature names the homeowner asked for. Each item should be a noun-phrase, not a sentence.'
      ),
    notes: z
      .string()
      .max(600)
      .optional()
      .describe(
        'Optional 1–2 sentence freeform note to add to the prompt. Use only when the homeowner gives a detail that does not fit must_haves (e.g. "neighbors\' fence on the south side blocks afternoon sun").'
      ),
    boundary_measurements: z
      .object({
        unit: z.enum(['feet', 'meters']),
        width: z.number().positive(),
        depth: z.number().positive(),
        area: z.number().positive(),
      })
      .optional()
      .describe(
        'Optional map-derived boundary size confirmed by the user before generation.'
      ),
    attachment_id: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe(
        'aihousekeeper_attachments.id of a yard photo or satellite screenshot the user uploaded earlier in the chat. When set, the AI traces the user\'s actual lot. Omit when no photo was uploaded.'
      ),
    /**
     * Legacy field kept for backwards compatibility with any in-flight
     * approvals or saved drafts that still carry it. New callers should
     * leave it unset and let the backend render the prompt.
     */
    diagram_prompt: z.string().min(1).max(3500).optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    // BYOK-aware availability check: the acting user's own OpenAI key (when
    // connected) satisfies this gate even if the managed key is absent. The
    // queue handler generates the image on the same resolved key.
    const { apiKey: openaiApiKey } = await resolveProviderApiKey(ctx.env, ctx.userId, 'openai');
    if (!openaiApiKey) {
      return {
        ok: false,
        error: 'garden_plan_openai_unavailable',
        message:
          'Image generation is not configured on the server. The user can add a site plan image from the Gardening tab.',
      };
    }

    const limit = await getGardenPlanCount(ctx.env, ctx.householdId);
    if (!limit.allowed) {
      return {
        ok: false,
        error: 'garden_plan_rate_limited',
        message: `Daily limit reached (${limit.used}/${limit.cap} per day). Try again after ${limit.resetsAt}.`,
        cap: limit.cap,
        used: limit.used,
        resets_at: limit.resetsAt,
      };
    }

    // Render the prompt server-side from the structured input. Old chats
    // that still pass `diagram_prompt` keep working — we use that string
    // verbatim — but new clients leave it blank and we build it here.
    const renderedPrompt =
      input.diagram_prompt && input.diagram_prompt.trim().length >= 20
        ? input.diagram_prompt.trim()
        : buildDiagramPromptFromStructuredInput({
            plan_type: input.plan_type,
            area_label: input.area_label,
            vibe: input.vibe,
            must_haves: input.must_haves,
            notes: input.notes,
            boundary_measurements: input.boundary_measurements,
          });

    // Idempotency: hash the meaningful inputs. Same household + same exact
    // structured intent → same parked row, no duplicates.
    const idempotencyKey = await sha256Hex(
      [
        'create_garden_site_plan',
        ctx.householdId,
        input.plan_type,
        input.area_label,
        input.vibe ?? '',
        (input.must_haves ?? []).join('|'),
        input.notes ?? '',
        input.boundary_measurements
          ? [
              input.boundary_measurements.unit,
              input.boundary_measurements.width,
              input.boundary_measurements.depth,
              input.boundary_measurements.area,
            ].join('|')
          : '',
        input.attachment_id ?? '',
        renderedPrompt,
      ].join(':')
    );

    const parked = await ctx.approvalQueue.park({
      householdId: ctx.householdId,
      userId: ctx.userId,
      toolName: 'create_garden_site_plan',
      input: {
        plan_type: input.plan_type,
        area_label: input.area_label,
        vibe: input.vibe,
        must_haves: input.must_haves ?? [],
        notes: input.notes ?? null,
        boundary_measurements: input.boundary_measurements ?? null,
        attachment_id: input.attachment_id ?? null,
        diagram_prompt: renderedPrompt,
      },
      idempotencyKey,
    });

    return {
      ok: true,
      pending_id: parked.pendingId,
      status: 'parked_for_approval',
      queue_status: parked.status,
      area_label: input.area_label,
      plan_type: input.plan_type,
      vibe: input.vibe,
      must_haves: input.must_haves ?? [],
      attachment_used: Boolean(input.attachment_id),
      daily_cap: limit.cap,
      daily_used: limit.used,
      message:
        'Parked for approval. Open Approvals to confirm — once approved I\'ll generate it (15–30s).',
    };
  },
};

export const gardenSitePlanTools: readonly AihousekeeperTool[] = [createGardenSitePlan] as const;

export { DEFAULT_GARDEN_PLAN_DAILY_CAP };
