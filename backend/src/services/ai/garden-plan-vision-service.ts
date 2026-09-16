/**
 * Draft a yard plan from a picture of one.
 *
 * A member who already has a site plan, a survey page or a good aerial shot
 * should not have to re-trace it corner by corner. This reads the image and
 * returns the structure — lot outline, areas, the things standing on them — as a
 * DRAFT the member then drags into place on the map.
 *
 * ## Nothing here is persisted, and that is what makes it safe to be remote
 *
 * This service stores nothing. It takes bytes, returns geometry, and forgets
 * both. The caller saves through `gardenPlansApi.createMapPlan`, which on a
 * local-first household writes the on-device ledger and never touches D1.
 *
 * That property is the whole reason a local-first household may use this at all,
 * and it is the same argument `homeProjectsApi.generateSmartProjectPlan` is
 * declared remote-by-design on:
 *
 *  - the member has just chosen a feature whose entire purpose is to show this
 *    image to a model, so the bytes reach a third party either way;
 *  - they arrive INLINE as base64 and are never written to R2, so unlike the
 *    Smart Project photo path there is not even a transient bucket key to clean
 *    up — there is nothing to accumulate and nothing to forget to delete;
 *  - the resulting plan takes the ordinary local path home.
 *
 * The image is a picture of a plan the member chose to hand over. The home's
 * ADDRESS still never leaves the device: the coordinates come from the lot the
 * member traced on their own map, not from anything in this file.
 *
 * ## Fail closed, always
 *
 * Every failure returns a typed refusal — never a fabricated plan and never a
 * raw provider string. A half-invented yard is worse than an honest "we could
 * not read that", because the member would have to notice the invention before
 * trusting anything else in the plan.
 */

import { detectMediaTypeFromBase64, type SupportedMediaType } from '../../ai/media-type';
import {
  GARDEN_PLAN_VISION_SCHEMA,
  GARDEN_PLAN_VISION_SYSTEM_PROMPT,
  MAX_VISION_ELEMENTS,
  VISION_ZONE_KINDS,
  buildGardenPlanVisionUserPrompt,
  type RawGardenPlanVision,
} from '../../ai/prompts/garden-plan-vision';
import type { AIProvider, GenerateMessage } from '../../ai/provider';

/**
 * What a provider will actually look at.
 *
 * PDFs are excluded even though `detectMediaTypeFromBase64` recognises them and
 * a surveyor's plan is very often a PDF. The reason is structural rather than a
 * product choice: `GenerateMessage` carries an `image` content block and no
 * `document` block, so there is no way to hand a PDF to a provider through this
 * Worker's own interface. Refusing it here with `unsupported_media` gives the
 * member a message that tells them what to do instead; forwarding it would earn
 * a provider 400 they would read as "the feature is broken".
 */
const VISION_MEDIA_TYPES: readonly SupportedMediaType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type GardenVisionFailure =
  | { ok: false; reason: 'unsupported_media' }
  | { ok: false; reason: 'unreadable' }
  | { ok: false; reason: 'provider_unavailable' };

export interface GardenVisionPoint {
  x: number;
  y: number;
}

export interface GardenVisionZone {
  kind: (typeof VISION_ZONE_KINDS)[number];
  label: string | null;
  polygon: GardenVisionPoint[];
  confidence: number | null;
}

export interface GardenVisionElement {
  preset: string;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  confidence: number | null;
}

export interface GardenPlanVisionDraft {
  plan_kind: string | null;
  lot_polygon: GardenVisionPoint[] | null;
  zones: GardenVisionZone[];
  elements: GardenVisionElement[];
  north_heading_degrees: number | null;
  notes: string | null;
}

export interface AnalyzeGardenPlanArgs {
  provider: AIProvider;
  image: { base64: string; declaredMediaType?: string | null };
  /**
   * Preset ids the CALLER can resolve. The catalogue lives in the mobile bundle
   * and is sent with the request so there is exactly one copy of it — see the
   * prompt module's header.
   */
  elementVocabulary: readonly string[];
  hint?: string | null;
}

export class GardenPlanVisionService {
  /** Vision-capable and cheap enough to run on a whole-page drawing. */
  static readonly MODEL = 'claude-sonnet-5';

  async analyze(
    args: AnalyzeGardenPlanArgs
  ): Promise<{ ok: true; draft: GardenPlanVisionDraft } | GardenVisionFailure> {
    if (!args.image?.base64) return { ok: false, reason: 'unsupported_media' };
    if (args.elementVocabulary.length === 0) {
      return { ok: false, reason: 'unsupported_media' };
    }

    // The declared type is ADVISORY. Pickers and share sheets rename freely, and
    // a JPEG called `.png` makes a provider answer 400 with a message the member
    // reads as "could not read your plan". The magic bytes decide, always.
    const sniffed = detectMediaTypeFromBase64(args.image.base64);
    if (sniffed === null || !(VISION_MEDIA_TYPES as readonly string[]).includes(sniffed)) {
      return { ok: false, reason: 'unsupported_media' };
    }

    const content: Extract<GenerateMessage['content'], unknown[]> = [
      {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: sniffed as 'image/jpeg' | 'image/png' | 'image/webp',
          data: args.image.base64,
        },
      },
      {
        type: 'text' as const,
        text: buildGardenPlanVisionUserPrompt({
          elementVocabulary: args.elementVocabulary,
          hint: args.hint,
        }),
      },
    ];

    // `generate` with a forced tool rather than `generateStructured`: the latter
    // takes a `userPrompt` string and has nowhere to put an image. Same shape
    // `HealthVisionService` uses for the identical reason.
    let result;
    try {
      result = await args.provider.generate({
        model: GardenPlanVisionService.MODEL,
        systemPrompt: GARDEN_PLAN_VISION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
        tools: [
          {
            name: 'output',
            description: "Return the property's structure as geometry.",
            input_schema: GARDEN_PLAN_VISION_SCHEMA as unknown as Record<string, unknown>,
          },
        ],
        toolChoice: { type: 'tool', name: 'output' },
        maxTokens: 8000,
      });
    } catch (err) {
      // Scrubbed and never returned — no raw provider strings reach the UI.
      console.error('[garden-vision] provider call failed:', String(err).slice(0, 200));
      return { ok: false, reason: 'provider_unavailable' };
    }

    const block = result.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use' || !block.input || typeof block.input !== 'object') {
      // It answered, but not with an extraction. That is unreadable, and must
      // never become an empty draft that looks like a real reading.
      return { ok: false, reason: 'unreadable' };
    }
    const raw = block.input as RawGardenPlanVision;

    if (raw?.readable === false) return { ok: false, reason: 'unreadable' };

    const draft = normalizeVisionDraft(raw, args.elementVocabulary);

    // A "readable" answer that produced no geometry at all is unreadable in the
    // only sense the member cares about. Saying so beats opening an editor on an
    // empty yard and letting them wonder what they did wrong.
    if (!draft.lot_polygon && draft.zones.length === 0 && draft.elements.length === 0) {
      return { ok: false, reason: 'unreadable' };
    }

    return { ok: true, draft };
  }
}

// ---------------------------------------------------------------------------
// Normalisation
//
// Everything below assumes the model may return anything at all. A field that
// cannot be made sense of is DROPPED rather than defaulted: a zone with three
// good corners and one `null` is a zone with a corner in the sea, and a silently
// clamped `0` is indistinguishable from a real edge.
// ---------------------------------------------------------------------------

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function unit(value: unknown): number | null {
  const parsed = num(value);
  if (parsed === null) return null;
  // Out-of-range is clamped rather than dropped: a model that says `1.02` meant
  // "the very edge", and losing the corner would deform the shape more than
  // moving it by two percent does.
  return Math.min(1, Math.max(0, parsed));
}

function str(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
}

function polygon(value: unknown): GardenVisionPoint[] | null {
  if (!Array.isArray(value)) return null;
  const out: GardenVisionPoint[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const x = unit((entry as Record<string, unknown>).x);
    const y = unit((entry as Record<string, unknown>).y);
    if (x === null || y === null) continue;
    out.push({ x, y });
  }
  return out.length >= 3 ? out : null;
}

export function normalizeVisionDraft(
  raw: RawGardenPlanVision,
  vocabulary: readonly string[]
): GardenPlanVisionDraft {
  const allowed = new Set(vocabulary);

  const zones: GardenVisionZone[] = [];
  for (const zone of Array.isArray(raw?.zones) ? raw.zones : []) {
    const ring = polygon(zone?.polygon);
    if (!ring) continue;
    const kind = (VISION_ZONE_KINDS as readonly string[]).includes(String(zone?.kind))
      ? (zone.kind as GardenVisionZone['kind'])
      : 'other';
    zones.push({
      kind,
      label: str(zone?.label, 60),
      polygon: ring,
      confidence: unit(zone?.confidence),
    });
  }

  const elements: GardenVisionElement[] = [];
  for (const element of Array.isArray(raw?.elements) ? raw.elements : []) {
    const preset = str(element?.preset, 60);
    // An id the caller cannot resolve is dropped, not guessed at. The client
    // owns the catalogue; a preset it has never heard of would render as
    // nothing and be impossible to select.
    if (!preset || !allowed.has(preset)) continue;
    const x = unit(element?.x);
    const y = unit(element?.y);
    const width = unit(element?.width);
    const height = unit(element?.height);
    if (x === null || y === null || width === null || height === null) continue;
    if (width <= 0 || height <= 0) continue;
    elements.push({
      preset,
      label: str(element?.label, 60),
      x,
      y,
      width,
      height,
      rotation: ((num(element?.rotation) ?? 0) % 360 + 360) % 360,
      confidence: unit(element?.confidence),
    });
    if (elements.length >= MAX_VISION_ELEMENTS) break;
  }

  const heading = num(raw?.north_heading_degrees);

  return {
    plan_kind: str(raw?.plan_kind, 40),
    lot_polygon: polygon(raw?.lot_polygon),
    zones,
    elements,
    north_heading_degrees:
      heading === null ? null : ((heading % 360) + 360) % 360,
    notes: str(raw?.notes, 400),
  };
}
