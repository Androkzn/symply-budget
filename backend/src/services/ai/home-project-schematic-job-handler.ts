/**
 * Async AI schematic for Home Projects (Phase 6).
 * Queue message carries IDs + R2 keys only — never photo bytes.
 */
import { and, eq, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { generateStructuredWithFallback } from '../../ai/fallback';
import { createProviderAdapter } from '../../ai/provider-factory';
import {
  homeProjectGeometry,
  homeProjects,
  type HomeProjectGeometry,
} from '../../db/schema-home-projects';
import type { Env, HomeProjectSchematicMessage } from '../../types';
import { AIAccessError } from '../../utils/errors';
import { nowIso } from '../../utils/id';
import { resolveProviderApiKey } from '../ai-credential-resolver';
import { usageRecorderFor } from '../ai-usage-service';
import { assertCanUseAI } from '../entitlement-service';
import { NotificationService } from '../notification-service';

export const STUCK_SCHEMATIC_GRACE_MS = 30 * 60 * 1000;

export type SchematicJobOutcome =
  | { kind: 'completed' }
  | { kind: 'failed-permanent'; code: string }
  | { kind: 'retry'; code: string }
  | { kind: 'skipped'; reason: string };

const SCHEMATIC_SCHEMA = {
  type: 'object',
  properties: {
    width_m: { type: 'number' },
    depth_m: { type: 'number' },
    wall_height_m: { type: 'number' },
    notes: { type: 'string' },
  },
  required: ['width_m', 'depth_m'],
  additionalProperties: false,
} as const;

const DISCLAIMER =
  'Approximate — verify measurements before buying materials. AI estimate, not a survey.';

function buildPayload(width: number, depth: number, wallHeight = 2.4) {
  const w = Math.max(0.5, Math.min(30, width));
  const d = Math.max(0.5, Math.min(30, depth));
  const area = Number((w * d).toFixed(2));
  return {
    units: 'm' as const,
    floor: {
      polygon: [
        [0, 0],
        [w, 0],
        [w, d],
        [0, d],
      ] as [number, number][],
      area_m2: area,
      openings: [],
    },
    walls: [
      { id: 'w1', label: 'North', width_m: w, height_m: wallHeight, openings: [] },
      { id: 'w2', label: 'East', width_m: d, height_m: wallHeight, openings: [] },
      { id: 'w3', label: 'South', width_m: w, height_m: wallHeight, openings: [] },
      { id: 'w4', label: 'West', width_m: d, height_m: wallHeight, openings: [] },
    ],
    ceiling: { area_m2: area },
    source_meta: { captured_at: new Date().toISOString(), estimator: 'ai_schematic' },
  };
}

async function notifySchematic(
  env: Env,
  userId: string,
  projectId: string,
  householdId: string,
  ok: boolean
): Promise<void> {
  try {
    const notifications = new NotificationService(env, env.DB);
    await notifications.sendNotification({
      userId,
      type: ok ? 'home_project_schematic_ready' : 'home_project_schematic_failed',
      title: ok ? 'Room schematic ready' : 'Room schematic failed',
      body: ok
        ? 'Your approximate room plan is ready to review'
        : 'Could not generate a schematic — try again or enter dimensions manually',
      data: {
        type: ok ? 'home_project_schematic_ready' : 'home_project_schematic_failed',
        home_project_id: projectId,
        projectId,
        householdId,
        screen: 'HomeProjectHub',
      },
      referenceType: 'home_project',
      referenceId: projectId,
    });
  } catch (err) {
    console.error('[home-project-schematic] notify failed', err);
  }
}

export async function handleHomeProjectSchematicJob(
  env: Env,
  body: HomeProjectSchematicMessage,
  opts: { attempt: number; maxAttempts: number }
): Promise<SchematicJobOutcome> {
  const db = drizzle(env.DB);
  const row = await db
    .select()
    .from(homeProjectGeometry)
    .where(eq(homeProjectGeometry.id, body.geometryId))
    .get();

  if (!row) {
    return opts.attempt >= opts.maxAttempts
      ? { kind: 'skipped', reason: 'row_missing' }
      : { kind: 'retry', code: 'row_missing' };
  }
  if (row.status !== 'generating') {
    return { kind: 'skipped', reason: `status_is_${row.status}` };
  }

  try {
    await assertCanUseAI(body.userId, env);
  } catch (err) {
    if (err instanceof AIAccessError || (err as Error).name === 'AIAccessError') {
      await failGeometry(db, row, 'entitlement_denied');
      await notifySchematic(env, body.userId, body.projectId, body.householdId, false);
      return { kind: 'skipped', reason: 'entitlement_denied' };
    }
    throw err;
  }

  const project = await db
    .select()
    .from(homeProjects)
    .where(eq(homeProjects.id, body.projectId))
    .get();

  let width = 3.2;
  let depth = 2.4;
  let wallHeight = 2.4;
  try {
    const { apiKey } = await resolveProviderApiKey(env, body.userId, 'anthropic');
    const ai = createProviderAdapter({
      provider: 'anthropic',
      apiKey,
      options: {
        onUsage: usageRecorderFor(env, {
          feature: 'home_project_schematic',
          householdId: body.householdId,
          userId: body.userId,
        }),
      },
    });
    const photoCount = body.attachmentR2Keys?.length ?? 0;
    const result = await generateStructuredWithFallback<{
      width_m: number;
      depth_m: number;
      wall_height_m?: number;
    }>(ai, env.AIHOUSEKEEPER_BRIEFING_MODEL, env.AIHOUSEKEEPER_FALLBACK_MODEL, {
      systemPrompt:
        'You estimate approximate interior room dimensions in meters for renovation planning. Never claim survey accuracy. Prefer conservative typical sizes when photos are unclear.',
      userPrompt: `Project: "${project?.title || 'Room'}" type=${project?.type || 'renovation'}. Photo attachments: ${photoCount}. Return width_m, depth_m, wall_height_m for a single room floor plan.`,
      schema: SCHEMATIC_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 400,
    });
    if (Number.isFinite(result.width_m)) width = result.width_m;
    if (Number.isFinite(result.depth_m)) depth = result.depth_m;
    if (result.wall_height_m != null && Number.isFinite(result.wall_height_m)) {
      wallHeight = result.wall_height_m;
    }
  } catch (err) {
    const code = (err as Error).message || 'schematic_ai_failed';
    const exhausted = opts.attempt >= opts.maxAttempts;
    if (!exhausted) return { kind: 'retry', code };
    await failGeometry(db, row, code);
    await notifySchematic(env, body.userId, body.projectId, body.householdId, false);
    return { kind: 'failed-permanent', code };
  }

  const payload = buildPayload(width, depth, wallHeight);
  const now = nowIso();
  await db
    .update(homeProjectGeometry)
    .set({
      status: 'completed',
      payload_json: JSON.stringify(payload),
      confidence: 'ai_estimate',
      disclaimer: DISCLAIMER,
      error_code: null,
      updated_at: now,
    })
    .where(eq(homeProjectGeometry.id, row.id));

  await notifySchematic(env, body.userId, body.projectId, body.householdId, true);
  return { kind: 'completed' };
}

async function failGeometry(
  db: ReturnType<typeof drizzle>,
  row: HomeProjectGeometry,
  code: string
): Promise<void> {
  await db
    .update(homeProjectGeometry)
    .set({
      status: 'failed',
      error_code: code.slice(0, 80),
      disclaimer: DISCLAIMER,
      updated_at: nowIso(),
    })
    .where(eq(homeProjectGeometry.id, row.id));
}

export async function sweepStuckGeneratingSchematics(
  env: Env,
  now = new Date(),
  graceMs = STUCK_SCHEMATIC_GRACE_MS
): Promise<{ scanned: number; reconciled: number }> {
  const db = drizzle(env.DB);
  const cutoff = new Date(now.getTime() - graceMs).toISOString();
  const stuck = await db
    .select()
    .from(homeProjectGeometry)
    .where(
      and(
        eq(homeProjectGeometry.source, 'ai_schematic'),
        eq(homeProjectGeometry.status, 'generating'),
        lt(homeProjectGeometry.updated_at, cutoff)
      )
    )
    .all();

  let reconciled = 0;
  for (const row of stuck) {
    await failGeometry(db, row, 'stuck_generating_timeout');
    reconciled += 1;
  }
  return { scanned: stuck.length, reconciled };
}
