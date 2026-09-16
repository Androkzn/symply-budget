/**
 * Smart Project generation, with no database in sight.
 *
 * See documents/requirements/HomeProjects/HomeProjects_SmartProject_BRD.md §12 Q4.
 *
 * ## Why this exists separately from the job handler
 *
 * House is local-first: a household's projects live in the encrypted ledger on
 * the member's own device, and the Worker cannot read them. The original job
 * wrote the drafted project straight into D1, which meant that on the brand's
 * DEFAULT configuration the result landed somewhere the member's phone could
 * never open. The feature was gated off for local-first households for exactly
 * that reason — and since House is local-first by default, that gate hid it
 * from everybody.
 *
 * The resolution is to split *thinking* from *storing*:
 *
 *   - the server generates (it has the model, the provider key and the photos)
 *   - the CLIENT stores, through `homeProjectsApi`, which already routes to the
 *     device ledger or to D1 depending on the household
 *
 * So this module returns a payload and writes nothing. It is the whole of the
 * server's job now, and it works identically for both kinds of household.
 *
 * ## Latency
 *
 * A multimodal generation takes tens of seconds, which is fine in a Worker: the
 * 30s limit is CPU time, and waiting on a provider is not CPU. The queue path
 * exists for the older write-through flow and is unchanged.
 */
import {
  applyAsIsToPhases,
  applyIncludeToGeneration,
  deriveSmartProjectSurfaces,
  orderPhases,
  parseSmartProjectGeneration,
  questionsForUnknowns,
  roomModelForSpace,
  SMART_PROJECT_INCLUDE_ALL,
  SMART_PROJECT_JSON_SCHEMA,
  SMART_PROJECT_MAX_PHOTOS,
  type DerivedSurfaceArea,
  type GeneratedBlocker,
  type RoomSurfaceModel,
  type SmartProjectGeneration,
  type SmartProjectInclude,
  type SmartProjectSpaceDimensions,
} from '@symply/contracts';

import { generateWithFallback } from '../../ai/fallback';
import {
  buildSmartProjectUserPrompt,
  requiredElementsForUse,
  SMART_PROJECT_SYSTEM_PROMPT,
  type ExistingProjectContext,
} from '../../ai/prompts/smart-project';
import { createProviderAdapter } from '../../ai/provider-factory';
import type { GenerateMessage } from '../../ai/provider';
import type { Env } from '../../types';
import { resolveProviderApiKey } from '../ai-credential-resolver';
import { usageRecorderFor } from '../ai-usage-service';

/**
 * Photos are context for condition and scope, never for measurement.
 *
 * Shared with the route's validator and with the wizard's grid — see
 * `SMART_PROJECT_MAX_PHOTOS`. A local copy is how the client came to offer a
 * number the route would reject outright.
 */
export const MAX_PHOTOS = SMART_PROJECT_MAX_PHOTOS;
/** ~6 MB raw, ~8 MB base64. Past this the request is likelier to be rejected than to help. */
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

export type SupportedPhotoMime = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * Everything the client needs to build the project itself.
 *
 * Surfaces arrive already measured — the member's typed dimensions run through
 * the shared contract arithmetic HERE, so a device cannot disagree with the
 * server about how big a wall is. The model never sees a number it could
 * multiply, and the client never has to.
 */
export interface SmartProjectPlan {
  generation: SmartProjectGeneration;
  /** Areas computed from the typed dimensions, gable-aware. Empty if unmeasured. */
  surfaces: DerivedSurfaceArea[];
  /** Phases in build order, with anything the as-is state says is done removed. */
  phases: SmartProjectGeneration['phases'];
  /** What was dropped and why, so review can explain the gap. */
  dropped: Array<{ title: string; because: string }>;
  /** Model blockers + one question per unknown + target-use safety net. */
  blockers: GeneratedBlocker[];
  /** One room model per measured space, for the geometry row. */
  roomModels: RoomSurfaceModel[];
  photosRead: number;
}

export async function generateSmartProjectPlan(
  env: Env,
  input: {
    householdId: string;
    userId: string;
    description: string;
    spaces: SmartProjectSpaceDimensions[];
    attachmentR2Keys: string[];
    knownSpaceNames?: string[];
    templateKeys?: string[];
    /** Present only for a re-plan of a project that already exists. */
    existing?: ExistingProjectContext;
    /** What the member ticked in the wizard's last step. Defaults to all three. */
    include?: SmartProjectInclude;
  }
): Promise<SmartProjectPlan | null> {
  const include = input.include ?? SMART_PROJECT_INCLUDE_ALL;
  const { apiKey } = await resolveProviderApiKey(env, input.userId, 'anthropic');
  const ai = createProviderAdapter({
    provider: 'anthropic',
    apiKey,
    options: {
      onUsage: usageRecorderFor(env, {
        feature: 'home_project_smart_draft',
        householdId: input.householdId,
        userId: input.userId,
      }),
    },
  });

  const photos = await loadPhotos(env, input.attachmentR2Keys);

  const messages: GenerateMessage[] = [
    {
      role: 'user',
      content: [
        ...photos.map(p => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: p.mime, data: p.base64 },
        })),
        {
          type: 'text' as const,
          text: buildSmartProjectUserPrompt({
            description: input.description,
            spaces: input.spaces,
            // What LOADED, never what was asked for: telling the model about a
            // picture it cannot see invites it to describe one.
            photoCount: photos.length,
            knownSpaces: input.knownSpaceNames,
            templateKeys: input.templateKeys,
            existing: input.existing,
            include,
          }),
        },
      ],
    },
  ];

  /**
   * ONE RETRY WHEN THE PLAN COMES BACK MALFORMED.
   *
   * `generateWithFallback` covers a model that ERRORS — it does nothing for a
   * model that answers successfully with a payload that fails the schema, which
   * is a different failure and the one seen in practice.
   *
   * The route turns a null from here into a 422 whose comment claims malformed
   * generation is permanent ("the same prompt against the same model reproduces
   * it"). That is not what the suite shows: `home-projects-smart-project-ui`
   * sent this exact shed description three times, drafted a project twice, and
   * 422'd once. Sampling is stochastic, so a single bad payload is transient —
   * and telling a member "Could not draft that" because one sample missed the
   * schema spends their whole attempt on a coin flip.
   *
   * Two attempts, not more: a prompt that is genuinely unsatisfiable should
   * still fail fast rather than burn tokens and keep the member waiting.
   */
  const requestPlan = () =>
    generateWithFallback(
      ai,
      env.AIHOUSEKEEPER_BRIEFING_MODEL,
      env.AIHOUSEKEEPER_FALLBACK_MODEL,
      {
        systemPrompt: SMART_PROJECT_SYSTEM_PROMPT,
        messages,
        tools: [
          {
            name: 'output',
            description: 'Return the drafted project, matching the JSON schema exactly.',
            input_schema: SMART_PROJECT_JSON_SCHEMA as unknown as Record<string, unknown>,
          },
        ],
        // Forced: a model answering in prose produces a plan the parser has to
        // guess at, and a guessed quantity is bought.
        toolChoice: { type: 'tool', name: 'output' },
        /**
         * 8000, because the plan got several times longer.
         *
         * A truncated tool_use payload is not a short plan — it is invalid JSON,
         * which fails `parseSmartProjectGeneration`, burns the one retry and
         * shows the member "Could not draft that" for a generation that was
         * going fine. The prompt now asks for every installation consumable and
         * for tasks broken down per area and per item, so a multi-room draft
         * runs well past what 4000 could hold.
         */
        maxTokens: 8000,
      }
    );

  let parsed: SmartProjectGeneration | null = null;
  for (let attempt = 1; attempt <= 2 && !parsed; attempt += 1) {
    const result = await requestPlan();
    const toolBlock = result.content.find(b => b.type === 'tool_use');
    parsed = parseSmartProjectGeneration(
      toolBlock && toolBlock.type === 'tool_use' ? toolBlock.input : null
    );
    if (!parsed) {
      console.warn(
        `[smart-project] generation failed the schema on attempt ${attempt}/2`
      );
    }
  }
  if (!parsed) return null;

  // Before anything reads it, and before the phase ordering: a section the
  // member unticked must not reach the caller at all, and the derivations below
  // then run over exactly what will be saved.
  const generation = applyIncludeToGeneration(parsed, include);

  const ordered = orderPhases(generation.phases);
  const { kept, dropped } = applyAsIsToPhases(ordered, generation.as_is);

  // Belt and braces on the re-plan instruction, for the same reason
  // `missingUseRequirements` exists: the prompt asks, and a model that ignores
  // it here hands the member a duplicate of a phase they are already working
  // on. Dropping it server-side is recoverable; a duplicated phase in a shared
  // project is a deletion someone has to notice first.
  const { fresh, duplicates } = withoutExistingPhases(kept, input.existing);

  return {
    generation,
    /**
     * Guarded on `include.materials` as well as on the stripped list, because
     * `deriveSmartProjectSurfaces` treats an EMPTY surface list as "the model
     * named none" and falls back to the three every room has — which is right
     * for a draft that forgot the floor and wrong for a member who unticked
     * materials. Without this they get three option groups with areas and
     * nothing to buy against them: empty containers on a project they asked to
     * keep short.
     */
    surfaces: include.materials
      ? deriveSmartProjectSurfaces(generation.surfaces, input.spaces)
      : [],
    phases: fresh,
    dropped: [
      ...dropped.map(d => ({ title: d.phase.title, because: d.because })),
      ...duplicates,
    ],
    blockers: [
      ...generation.blockers,
      ...questionsForUnknowns(generation.as_is),
      ...missingUseRequirements(generation),
    ],
    roomModels: input.spaces.map(roomModelForSpace),
    photosRead: photos.length,
  };
}

/**
 * Words that carry no information about what a phase actually is.
 *
 * "Install" and "fit" are the tell: almost every phase title starts with one,
 * so leaving them in makes every pair of phases look 30% alike and pushes the
 * similarity score toward a false match.
 */
const PHASE_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'at', 'with',
  'install', 'installing', 'installation', 'fit', 'fitting', 'add', 'adding',
  'do', 'complete', 'finish', 'work', 'works', 'phase', 'new', 'all',
]);

/**
 * Crude stem: lowercase, strip punctuation, keep the first four letters.
 *
 * Four is chosen so that the pairs that actually collide in phase titles —
 * insulate/insulation, wire/wiring, paint/painting, wall/walls, floor/flooring —
 * land on the same token, without pulling genuinely different trades together.
 * A real stemmer would be more correct and is not worth a dependency for
 * matching a dozen short titles.
 */
function phaseTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !PHASE_STOPWORDS.has(w))
      .map(w => w.slice(0, 4))
  );
}

/**
 * Jaccard overlap of two phase titles, 0…1.
 *
 * The threshold below is set so "Insulate walls" and "Wall insulation" match
 * (1.0) while "Insulate walls" and "Insulate ceiling" do not (0.33) — the second
 * pair share a trade but are different work, and merging them would silently
 * drop a room's worth of insulation from the plan.
 */
function titleSimilarity(a: string, b: string): number {
  const ta = phaseTokens(a);
  const tb = phaseTokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

const DUPLICATE_PHASE_THRESHOLD = 0.6;

/**
 * Remove phases the project already has, and say which so review can explain it.
 *
 * Only runs for a re-plan; a first draft has nothing to duplicate.
 */
function withoutExistingPhases<T extends { title: string }>(
  phases: T[],
  existing?: ExistingProjectContext
): { fresh: T[]; duplicates: Array<{ title: string; because: string }> } {
  if (!existing?.phases.length) return { fresh: phases, duplicates: [] };

  const fresh: T[] = [];
  const duplicates: Array<{ title: string; because: string }> = [];
  for (const phase of phases) {
    const match = existing.phases.find(
      e => titleSimilarity(e.title, phase.title) >= DUPLICATE_PHASE_THRESHOLD
    );
    if (match) {
      duplicates.push({
        title: phase.title,
        because: `Already on this project as "${match.title}"`,
      });
    } else {
      fresh.push(phase);
    }
  }
  return { fresh, duplicates };
}

/**
 * Requirements the target use implies that the model never raised.
 *
 * A safety net, not the main path — the prompt asks for these. But a
 * woodworking shop with no ventilation question is missing the item most likely
 * to hurt someone, and "the model usually remembers" is not a guarantee.
 */
function missingUseRequirements(generation: SmartProjectGeneration): GeneratedBlocker[] {
  const required = requiredElementsForUse(generation.target_use);
  if (!required.length) return [];
  const mentioned = new Set(generation.as_is.map(e => e.element));
  return required
    .filter(element => !mentioned.has(element))
    .map(element => ({
      title: `Confirm ${element.replace(/_/g, ' ')} for a ${generation.target_use}`,
      severity: 'medium' as const,
      question: `A ${generation.target_use} has requirements a general renovation does not. Confirm what this space needs here.`,
    }));
}

/**
 * R2 objects → base64 image blocks.
 *
 * A key that fails to load is skipped rather than failing the whole plan: four
 * photos beat none, and the member cannot fix an R2 miss.
 */
export async function loadPhotos(
  env: Env,
  keys: readonly string[]
): Promise<Array<{ base64: string; mime: SupportedPhotoMime }>> {
  const out: Array<{ base64: string; mime: SupportedPhotoMime }> = [];
  for (const key of keys.slice(0, MAX_PHOTOS)) {
    try {
      const object = await env.REPORTS_BUCKET.get(key);
      if (!object) continue;
      const buffer = await object.arrayBuffer();
      if (buffer.byteLength > MAX_PHOTO_BYTES) continue;
      out.push({
        base64: toBase64(buffer),
        mime: mimeForKey(key, object.httpMetadata?.contentType),
      });
    } catch (err) {
      console.error('[smart-project-generator] photo load failed', {
        key: key.slice(0, 40),
        error: (err as Error).message,
      });
    }
  }
  return out;
}

/** Anthropic accepts these three; anything else is sent as JPEG, the common case. */
function mimeForKey(key: string, declared?: string): SupportedPhotoMime {
  const candidate = (declared || '').toLowerCase();
  if (candidate === 'image/png' || key.toLowerCase().endsWith('.png')) return 'image/png';
  if (candidate === 'image/webp' || key.toLowerCase().endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked: spreading a multi-megabyte array blows the argument limit.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
