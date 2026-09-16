/**
 * Smart Project — describe-to-draft generation (async).
 *
 * See documents/requirements/HomeProjects/HomeProjects_SmartProject_BRD.md.
 *
 * Deliberately shaped like `home-project-schematic-job-handler.ts`: same
 * outcome union, same retry/entitlement handling, same stuck-row sweep. That
 * pattern already has a queue consumer, a retry policy and a cron sweep written
 * against it, and a second job shape would need all three again.
 *
 * The queue message carries IDs only — never the description, never photo
 * bytes.
 *
 * ## What this handler will not do
 *
 * It writes no price. `estimate_cents` is 0 on every budget line it creates,
 * and there is no code path here that sets it to anything else. It writes no
 * area it did not compute: every `area_value` comes from
 * `deriveSmartProjectSurfaces` operating on the member's typed dimensions, and
 * when there are none, no surfaces are written at all.
 */
import { and, eq, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import {
  applyAsIsToPhases,
  deriveSmartProjectSurfaces,
  orderPhases,
  parseSmartProjectGeneration,
  questionsForUnknowns,
  roomModelForSpace,
  smartProjectSpaceDimensionsSchema,
  SMART_DRAFT_SOURCE,
  SMART_PROJECT_JSON_SCHEMA,
  type GeneratedBlocker,
  type SmartProjectGeneration,
  type SmartProjectSpaceDimensions,
} from '@symply/contracts';

import { generateWithFallback } from '../../ai/fallback';
import {
  buildSmartProjectUserPrompt,
  requiredElementsForUse,
  SMART_PROJECT_SYSTEM_PROMPT,
} from '../../ai/prompts/smart-project';
import { createProviderAdapter } from '../../ai/provider-factory';
import {
  homeProjectAsIs,
  homeProjectBlockers,
  homeProjectBudgetLines,
  homeProjectGeometry,
  homeProjectOptionGroups,
  homeProjectPhases,
  homeProjectSelections,
  homeProjects,
  homeProjectSmartDrafts,
  type HomeProjectSmartDraft,
} from '../../db/schema-home-projects';
import type { GenerateMessage } from '../../ai/provider';
import type { Env, HomeProjectSmartDraftMessage } from '../../types';
import { AIAccessError } from '../../utils/errors';
import { generateId, nowIso } from '../../utils/id';
import { resolveProviderApiKey } from '../ai-credential-resolver';
import { usageRecorderFor } from '../ai-usage-service';
import { assertCanUseAI } from '../entitlement-service';
import { NotificationService } from '../notification-service';

export const STUCK_SMART_DRAFT_GRACE_MS = 30 * 60 * 1000;

export type SmartDraftJobOutcome =
  | { kind: 'completed' }
  | { kind: 'failed-permanent'; code: string }
  | { kind: 'retry'; code: string }
  | { kind: 'skipped'; reason: string };

const DISCLAIMER =
  'A starting point drafted from your description — not a scope of work. Check every line before buying or booking anything.';


/**
 * R2 objects → base64 image blocks the model can actually look at.
 *
 * The photos were plumbed through from the very first version — the client
 * uploads them, the route resolves their keys, the message carries them — and
 * then the job told the model only how MANY there were. The description alone
 * cannot settle what a space already has; the pictures can, and as-is state is
 * the whole reason this feature exists. Reading them closes that.
 *
 * A key that fails to load is skipped rather than failing the draft: five
 * photos where one is missing is still a better draft than none, and the member
 * is not in a position to fix an R2 miss.
 */
async function loadPhotos(
  env: Env,
  keys: readonly string[]
): Promise<Array<{ base64: string; mime: SupportedPhotoMime }>> {
  const out: Array<{ base64: string; mime: SupportedPhotoMime }> = [];
  for (const key of keys.slice(0, MAX_PHOTOS)) {
    try {
      const object = await env.REPORTS_BUCKET.get(key);
      if (!object) continue;
      const buffer = await object.arrayBuffer();
      // A phone photo is ~2-5 MB; base64 inflates by a third. Past this the
      // request is more likely to be rejected for size than to help.
      if (buffer.byteLength > MAX_PHOTO_BYTES) continue;
      out.push({
        base64: toBase64(buffer),
        mime: mimeForKey(key, object.httpMetadata?.contentType),
      });
    } catch (err) {
      console.error('[home-project-smart-draft] photo load failed', {
        key: key.slice(0, 40),
        error: (err as Error).message,
      });
    }
  }
  return out;
}

type SupportedPhotoMime = 'image/jpeg' | 'image/png' | 'image/webp';

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
  // Chunked: `String.fromCharCode(...bytes)` blows the argument limit on a
  // multi-megabyte photo.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Roughly 6 MB of raw bytes — about 8 MB once base64-encoded. */
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

/** Photos are context for condition and scope, never for measurement. */
const MAX_PHOTOS = 8;

export async function handleHomeProjectSmartDraftJob(
  env: Env,
  body: HomeProjectSmartDraftMessage,
  opts: { attempt: number; maxAttempts: number }
): Promise<SmartDraftJobOutcome> {
  const db = drizzle(env.DB);

  const row = await db
    .select()
    .from(homeProjectSmartDrafts)
    .where(eq(homeProjectSmartDrafts.id, body.draftId))
    .get();

  if (!row) {
    return opts.attempt >= opts.maxAttempts
      ? { kind: 'skipped', reason: 'row_missing' }
      : { kind: 'retry', code: 'row_missing' };
  }
  // Cancelled or already finished — a late redelivery must not resurrect it.
  if (row.status !== 'generating') {
    return { kind: 'skipped', reason: `status_is_${row.status}` };
  }

  try {
    await assertCanUseAI(body.userId, env);
  } catch (err) {
    if (err instanceof AIAccessError || (err as Error).name === 'AIAccessError') {
      await failDraft(db, row, 'entitlement_denied');
      await notifyDraft(env, body, false);
      return { kind: 'skipped', reason: 'entitlement_denied' };
    }
    throw err;
  }

  const spaces = parseSpaces(row.spaces_json);

  let generation: SmartProjectGeneration;
  try {
    const { apiKey } = await resolveProviderApiKey(env, body.userId, 'anthropic');
    const ai = createProviderAdapter({
      provider: 'anthropic',
      apiKey,
      options: {
        onUsage: usageRecorderFor(env, {
          feature: 'home_project_smart_draft',
          householdId: body.householdId,
          userId: body.userId,
        }),
      },
    });

    // The photos, actually read. `photoCount` is what LOADED, not what was
    // requested: telling the model about a picture it cannot see would invite
    // it to describe one.
    const photos = await loadPhotos(env, body.attachmentR2Keys ?? []);

    const messages: GenerateMessage[] = [
      {
        role: 'user',
        content: [
          ...photos.map(p => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: p.mime,
              data: p.base64,
            },
          })),
          {
            type: 'text' as const,
            text: buildSmartProjectUserPrompt({
              description: row.description,
              spaces,
              photoCount: photos.length,
              knownSpaces: body.knownSpaceNames,
              templateKeys: body.templateKeys,
            }),
          },
        ],
      },
    ];

    // A FORCED tool, not free-form JSON. `generateStructured` cannot carry
    // images, and a model answering in prose here produces a plan the parser
    // has to guess at — the same reason the shelf-tag reader forces its own
    // `output` tool.
    const result = await generateWithFallback(
      ai,
      env.AIHOUSEKEEPER_BRIEFING_MODEL,
      env.AIHOUSEKEEPER_FALLBACK_MODEL,
      {
        systemPrompt: SMART_PROJECT_SYSTEM_PROMPT,
        messages,
        tools: [
          {
            name: 'output',
            description:
              'Return the drafted project, matching the JSON schema exactly.',
            input_schema: SMART_PROJECT_JSON_SCHEMA as unknown as Record<
              string,
              unknown
            >,
          },
        ],
        toolChoice: { type: 'tool', name: 'output' },
        maxTokens: 4000,
      }
    );

    const toolBlock = result.content.find(b => b.type === 'tool_use');
    const raw =
      toolBlock && toolBlock.type === 'tool_use' ? toolBlock.input : null;

    const parsed = parseSmartProjectGeneration(raw);
    if (!parsed) {
      // Malformed output is permanent, not transient: retrying the same prompt
      // against the same model reliably produces the same shape.
      await failDraft(db, row, 'malformed_generation');
      await notifyDraft(env, body, false);
      return { kind: 'failed-permanent', code: 'malformed_generation' };
    }
    generation = parsed;
  } catch (err) {
    const code = (err as Error).message || 'smart_draft_ai_failed';
    if (opts.attempt < opts.maxAttempts) return { kind: 'retry', code };
    await failDraft(db, row, code);
    await notifyDraft(env, body, false);
    return { kind: 'failed-permanent', code };
  }

  try {
    const dropped = await writeDraft(db, row, generation, spaces, body);
    await db
      .update(homeProjectSmartDrafts)
      .set({
        status: 'completed',
        confidence: generation.confidence,
        disclaimer: DISCLAIMER,
        dropped_json: JSON.stringify(dropped),
        error_code: null,
        updated_at: nowIso(),
      })
      .where(eq(homeProjectSmartDrafts.id, row.id));
  } catch (err) {
    const code = (err as Error).message || 'smart_draft_write_failed';
    await failDraft(db, row, code);
    await notifyDraft(env, body, false);
    return { kind: 'failed-permanent', code };
  }

  await notifyDraft(env, body, true);
  return { kind: 'completed' };
}

/**
 * Turn a validated generation into rows on the project.
 *
 * The project is already `visibility='draft'` when this runs — the route
 * created it that way — so everything written here is invisible to the rest of
 * the household until the member publishes. That is what makes it safe to write
 * real rows instead of holding a preview in memory: the member reviews in the
 * actual hub screens, so what they approve is exactly what they get.
 */
async function writeDraft(
  db: ReturnType<typeof drizzle>,
  row: HomeProjectSmartDraft,
  generation: SmartProjectGeneration,
  spaces: SmartProjectSpaceDimensions[],
  body: HomeProjectSmartDraftMessage
): Promise<Array<{ title: string; because: string }>> {
  const now = nowIso();
  const projectId = row.project_id;

  // ---- project header ----------------------------------------------------
  await db
    .update(homeProjects)
    .set({
      title: generation.title,
      type: generation.type,
      template_key: generation.template_key ?? null,
      target_use: generation.target_use ?? null,
      summary: generation.summary ?? row.description,
      updated_at: now,
    })
    .where(eq(homeProjects.id, projectId));

  // ---- as-is state -------------------------------------------------------
  // Written before phases, because it is what decides which phases survive.
  for (const entry of generation.as_is) {
    await db.insert(homeProjectAsIs).values({
      id: generateId(),
      project_id: projectId,
      element: entry.element,
      state: entry.state,
      evidence: entry.evidence ?? null,
      source: SMART_DRAFT_SOURCE,
      created_at: now,
      updated_at: now,
    });
  }

  // ---- phases ------------------------------------------------------------
  const ordered = orderPhases(generation.phases);
  const { kept, dropped } = applyAsIsToPhases(ordered, generation.as_is);
  for (const [index, phase] of kept.entries()) {
    await db.insert(homeProjectPhases).values({
      id: generateId(),
      project_id: projectId,
      title: phase.title,
      status: 'pending',
      draft_source: SMART_DRAFT_SOURCE,
      draft_confidence: generation.confidence,
      sort_order: index,
      created_at: now,
      updated_at: now,
    });
  }

  // ---- geometry, from the member's own numbers ---------------------------
  // One room model per measured space. `source='manual'` because the dimensions
  // ARE manual — the member typed them. Marking this 'ai' would misreport the
  // provenance of the only trustworthy numbers in the draft.
  if (spaces.length) {
    const model = roomModelForSpace(spaces[0]);
    await db.insert(homeProjectGeometry).values({
      id: generateId(),
      project_id: projectId,
      source: 'manual',
      status: 'completed',
      schema_version: model.schema_version,
      payload_json: JSON.stringify(model),
      confidence: 'member_entered',
      created_at: now,
      updated_at: now,
    });
  }

  // ---- surfaces ----------------------------------------------------------
  // Empty when dimensions were skipped, and that is the honest outcome: no
  // surfaces rather than surfaces with guessed areas.
  const surfaces = deriveSmartProjectSurfaces(generation.surfaces, spaces);
  const groupIdByName = new Map<string, string>();
  for (const [index, surface] of surfaces.entries()) {
    const id = generateId();
    groupIdByName.set(surface.name.toLowerCase(), id);
    await db.insert(homeProjectOptionGroups).values({
      id,
      project_id: projectId,
      name: surface.name,
      category: surface.category,
      area_value: surface.area_m2,
      area_unit: 'm2',
      // 'manual' — the area came from typed dimensions through exact
      // arithmetic, not from a floor-plan prefill and not from the model.
      area_source: 'manual',
      waste_factor_pct: surface.waste_factor_pct,
      draft_source: SMART_DRAFT_SOURCE,
      draft_confidence: generation.confidence,
      sort_order: index,
      created_at: now,
      updated_at: now,
    });
  }

  // ---- materials ---------------------------------------------------------
  for (const [index, material] of generation.materials.entries()) {
    const groupId = material.surface_name
      ? (groupIdByName.get(material.surface_name.toLowerCase()) ?? null)
      : null;
    await db.insert(homeProjectSelections).values({
      id: generateId(),
      project_id: projectId,
      name: material.label,
      category: material.category,
      status: 'idea',
      qty: 1,
      unit: material.unit,
      // No price. Not zero-as-placeholder in a money column the UI would
      // render as "$0.00" — NULL, meaning nobody has priced this yet.
      unit_price_cents: null,
      option_group_id: groupId,
      coverage_per_unit: material.coverage_per_unit ?? null,
      coverage_unit: material.coverage_unit ?? null,
      notes: material.notes ?? null,
      // The fourth rung on the ladder this column already carried.
      extraction_source: SMART_DRAFT_SOURCE,
      extraction_confidence: material.confidence,
      sort_order: index,
      created_at: now,
      updated_at: now,
    });
  }

  // ---- blockers ----------------------------------------------------------
  // The model's own blockers, plus one question per element it could not
  // determine, plus anything the target use requires that it never mentioned.
  const blockers: GeneratedBlocker[] = [
    ...generation.blockers,
    ...questionsForUnknowns(generation.as_is),
    ...missingUseRequirements(generation),
  ];
  for (const [index, blocker] of blockers.entries()) {
    await db.insert(homeProjectBlockers).values({
      id: generateId(),
      project_id: projectId,
      title: blocker.title,
      severity: blocker.severity,
      status: 'open',
      notes: blocker.question ?? null,
      draft_source: SMART_DRAFT_SOURCE,
      draft_confidence: generation.confidence,
      // The three sources above are concatenated in a meaningful order — the
      // model's own blockers, then the questions, then the missing
      // requirements — and `sort_order` is what preserves it now that the read
      // is ordered. Without it the list would come back in scan order and the
      // grouping the member sees would be an accident of the query planner.
      sort_order: index,
      created_at: now,
      updated_at: now,
    });
  }

  // ---- budget lines ------------------------------------------------------
  // Labels and categories only. `estimate_cents` stays 0 — the member or their
  // contractor supplies every number. See BRD D3.
  const budgetLabels = new Set(generation.materials.map(m => m.category));
  let budgetOrder = 0;
  for (const category of budgetLabels) {
    await db.insert(homeProjectBudgetLines).values({
      id: generateId(),
      project_id: projectId,
      category: 'materials',
      label: category,
      estimate_cents: 0,
      actual_cents: 0,
      sort_order: budgetOrder++,
      created_at: now,
      updated_at: now,
    });
  }

  // ---- tasks -------------------------------------------------------------
  // Held on the draft row, NOT written to `tasks`. A House task is
  // household-shared the moment it exists, so materialising these now would put
  // work in everyone's list for a project nobody else can open.
  // `publishSmartDraft` turns them into real tasks; nothing else does.
  await db
    .update(homeProjectSmartDrafts)
    .set({ tasks_json: JSON.stringify(generation.tasks), updated_at: now })
    .where(eq(homeProjectSmartDrafts.id, row.id));

  void body;

  return dropped.map(d => ({ title: d.phase.title, because: d.because }));
}

/**
 * Requirements the target use implies that the model never raised.
 *
 * A safety net, not the main path — the prompt already asks for these. But a
 * woodworking shop plan with no ventilation question is missing the item most
 * likely to hurt someone, and "the model usually remembers" is not a guarantee
 * worth relying on for that class of item.
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
 * Never throws on bad JSON, and drops any space that fails validation rather
 * than the whole set. A member who typed three rooms and fat-fingered one
 * should get two rooms of quantities, not none.
 */
function parseSpaces(json: string | null): SmartProjectSpaceDimensions[] {
  if (!json) return [];
  try {
    const raw: unknown = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    const out: SmartProjectSpaceDimensions[] = [];
    for (const item of raw) {
      const parsed = smartProjectSpaceDimensionsSchema.safeParse(item);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  } catch {
    return [];
  }
}

async function failDraft(
  db: ReturnType<typeof drizzle>,
  row: HomeProjectSmartDraft,
  code: string
): Promise<void> {
  await db
    .update(homeProjectSmartDrafts)
    .set({
      status: 'failed',
      error_code: code.slice(0, 80),
      disclaimer: DISCLAIMER,
      updated_at: nowIso(),
    })
    .where(eq(homeProjectSmartDrafts.id, row.id));
}

async function notifyDraft(
  env: Env,
  body: HomeProjectSmartDraftMessage,
  ok: boolean
): Promise<void> {
  try {
    const notifications = new NotificationService(env, env.DB);
    await notifications.sendNotification({
      // Only the creator. A draft is theirs alone until they publish it, so
      // notifying the household here would announce a project nobody else can
      // open — the same reason a peer's draft answers NotFound.
      userId: body.userId,
      type: ok ? 'home_project_smart_draft_ready' : 'home_project_smart_draft_failed',
      title: ok ? 'Your project draft is ready' : 'Could not draft that project',
      body: ok
        ? 'Review it before sharing with your household'
        : 'Try again, or start from a template instead',
      data: {
        type: ok ? 'home_project_smart_draft_ready' : 'home_project_smart_draft_failed',
        home_project_id: body.projectId,
        projectId: body.projectId,
        householdId: body.householdId,
        draftId: body.draftId,
        screen: 'HomeProjectHub',
      },
      referenceType: 'home_project',
      referenceId: body.projectId,
    });
  } catch (err) {
    console.error('[home-project-smart-draft] notify failed', err);
  }
}

/**
 * Reconcile rows left `generating` by a worker that died mid-job.
 *
 * Without this a draft spins forever in the UI and the member cannot retry —
 * the enqueue path refuses a second job while one is in flight.
 */
export async function sweepStuckSmartDrafts(
  env: Env,
  now = new Date(),
  graceMs = STUCK_SMART_DRAFT_GRACE_MS
): Promise<{ scanned: number; reconciled: number }> {
  const db = drizzle(env.DB);
  const cutoff = new Date(now.getTime() - graceMs).toISOString();
  const stuck = await db
    .select()
    .from(homeProjectSmartDrafts)
    .where(
      and(
        eq(homeProjectSmartDrafts.status, 'generating'),
        lt(homeProjectSmartDrafts.updated_at, cutoff)
      )
    )
    .all();

  let reconciled = 0;
  for (const row of stuck) {
    await failDraft(db, row, 'stuck_generating_timeout');
    reconciled += 1;
  }
  return { scanned: stuck.length, reconciled };
}
