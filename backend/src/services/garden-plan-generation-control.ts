import { and, eq } from 'drizzle-orm';

import { aiToolPending } from '../db/schema-ai-chat';
import * as gardenSchema from '../db/schema-garden-plans';
import {
  gardenPlanBoundaryDrafts,
  gardenPlans as gardenPlansTable,
} from '../db/schema-garden-plans';
import type { Env } from '../types';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { now as nowIso } from '../utils/id';

import { ApprovalQueueShim } from './ai/approval-queue-shim';
import {
  checkAndIncrementGardenPlanCount,
  refundGardenPlanCount,
} from './ai/garden-plan-rate-limit';
import { createDb } from './db';

const RETRY_DEBOUNCE_TTL_SECONDS = 60;
const RETRY_DEBOUNCE_PREFIX = 'garden_plan_retry_lock';

function retryLockKey(gardenPlanId: string): string {
  return `${RETRY_DEBOUNCE_PREFIX}:${gardenPlanId}`;
}

export type GardenPlanRouteResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 409 | 429; body: Record<string, unknown> };

export async function cancelGardenPlanGeneration(
  env: Env,
  householdId: string,
  gardenPlanId: string
): Promise<GardenPlanRouteResponse> {
  const db = createDb(env.DB, gardenSchema);

  const plan = await db
    .select()
    .from(gardenPlansTable)
    .where(eq(gardenPlansTable.id, gardenPlanId))
    .get();

  if (!plan || plan.household_id !== householdId) {
    throw new NotFoundError('Garden plan');
  }
  if (plan.status !== 'generating') {
    return {
      status: 409,
      body: {
        error: {
          code: 'conflict',
          message: `Garden plan is not in a cancellable state (status=${plan.status})`,
        },
      },
    };
  }

  const ts = nowIso();
  const cancelResult = await db
    .update(gardenPlansTable)
    .set({
      status: 'failed',
      error_message: 'cancelled_by_user',
      updated_at: ts,
    })
    .where(and(eq(gardenPlansTable.id, gardenPlanId), eq(gardenPlansTable.status, 'generating')))
    .run();
  const cancelChanges =
    (cancelResult as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;

  if (cancelChanges === 0) {
    const current = await db
      .select()
      .from(gardenPlansTable)
      .where(eq(gardenPlansTable.id, gardenPlanId))
      .get();
    return {
      status: 409,
      body: {
        error: {
          code: 'conflict',
          message: `Garden plan transitioned to '${current?.status ?? 'unknown'}' before cancel landed`,
        },
        garden_plan: current,
      },
    };
  }

  if (plan.source_approval_id) {
    const approvals = new ApprovalQueueShim(env.DB);
    await approvals.markExecuted(
      plan.source_approval_id,
      { ok: false, error: 'cancelled_by_user' },
      { requireStatus: 'approved' }
    );
  }

  await refundGardenPlanCount(env, householdId);

  try {
    await env.CONFIG_KV.delete(retryLockKey(gardenPlanId));
  } catch {
    // best-effort
  }

  const updated = await db
    .select()
    .from(gardenPlansTable)
    .where(eq(gardenPlansTable.id, gardenPlanId))
    .get();

  return { status: 200, body: { garden_plan: updated } };
}

export async function retryGardenPlanGeneration(
  env: Env,
  householdId: string,
  gardenPlanId: string
): Promise<GardenPlanRouteResponse> {
  const db = createDb(env.DB, gardenSchema);

  const plan = await db
    .select()
    .from(gardenPlansTable)
    .where(eq(gardenPlansTable.id, gardenPlanId))
    .get();

  if (!plan || plan.household_id !== householdId) {
    throw new NotFoundError('Garden plan');
  }
  if (plan.status !== 'failed' && plan.status !== 'generating') {
    return {
      status: 409,
      body: {
        error: {
          code: 'conflict',
          message: `Garden plan is not retryable (status=${plan.status})`,
        },
      },
    };
  }
  if (!plan.source_approval_id && !plan.boundary_draft_id) {
    throw new ForbiddenError('This plan was uploaded manually and cannot be retried.');
  }

  const lockKey = retryLockKey(gardenPlanId);
  const existingLock = await env.CONFIG_KV.get(lockKey);
  if (existingLock) {
    return {
      status: 429,
      body: {
        error: {
          code: 'retry_in_progress',
          message:
            'A retry for this garden plan is already in progress. Please wait a moment before trying again.',
        },
      },
    };
  }

  let counterIncremented = false;
  if (plan.status === 'failed') {
    const limit = await checkAndIncrementGardenPlanCount(env, householdId);
    if (!limit.allowed) {
      return {
        status: 429,
        body: {
          error: {
            code: 'garden_plan_rate_limited',
            message: `Daily garden plan limit reached (${limit.used}/${limit.cap}). Resets at ${limit.resetsAt}.`,
            used: limit.used,
            cap: limit.cap,
            resetsAt: limit.resetsAt,
          },
        },
      };
    }
    counterIncremented = true;
  }

  const refundIfNeeded = async (): Promise<void> => {
    if (counterIncremented) {
      await refundGardenPlanCount(env, householdId);
    }
  };

  let approvalRow: typeof aiToolPending.$inferSelect | undefined;
  let input: Record<string, unknown> = {};
  if (plan.source_approval_id) {
    approvalRow = await db
      .select()
      .from(aiToolPending)
      .where(
        and(
          eq(aiToolPending.id, plan.source_approval_id),
          eq(aiToolPending.household_id, householdId)
        )
      )
      .get();
    if (!approvalRow) {
      await refundIfNeeded();
      throw new NotFoundError('Source approval row');
    }
    try {
      input = JSON.parse(approvalRow.input_json);
    } catch (err) {
      await refundIfNeeded();
      throw new ValidationError({
        input_json: [`malformed: ${(err as Error).message}`],
      });
    }
  }

  const diagramPrompt =
    plan.generation_prompt ?? (input.diagram_prompt as string | undefined) ?? '';
  if (!diagramPrompt.trim()) {
    await refundIfNeeded();
    throw new ValidationError({
      diagram_prompt: ['missing in source approval input'],
    });
  }
  const planType = (input.plan_type as string | undefined) ?? plan.plan_type;
  const areaLabel = (input.area_label as string | undefined) ?? plan.label ?? 'Garden';

  const ts = nowIso();
  await db
    .update(gardenPlansTable)
    .set({
      status: 'generating',
      error_message: null,
      updated_at: ts,
    })
    .where(eq(gardenPlansTable.id, gardenPlanId));

  if (approvalRow?.status === 'failed' && plan.source_approval_id) {
    await db
      .update(aiToolPending)
      .set({
        status: 'approved',
        execution_error: null,
        executed_at: null,
        updated_at: ts,
      })
      .where(eq(aiToolPending.id, plan.source_approval_id));
  }

  try {
    await env.CONFIG_KV.put(lockKey, '1', {
      expirationTtl: RETRY_DEBOUNCE_TTL_SECONDS,
    });
  } catch {
    // best-effort
  }

  let boundaryReferenceKey: string | null = null;
  if (plan.boundary_draft_id) {
    const draft = await db
      .select({
        reference_image_key: gardenPlanBoundaryDrafts.reference_image_key,
      })
      .from(gardenPlanBoundaryDrafts)
      .where(eq(gardenPlanBoundaryDrafts.id, plan.boundary_draft_id))
      .get();
    boundaryReferenceKey = draft?.reference_image_key ?? null;
  }

  try {
    await env.GARDEN_PLAN_QUEUE.send({
      approvalId: plan.source_approval_id ?? undefined,
      gardenPlanId,
      householdId,
      userId: plan.created_by,
      diagramPrompt,
      planType,
      areaLabel,
      enqueuedAt: Date.now(),
      referenceImageR2Key: boundaryReferenceKey ?? undefined,
      referenceImageSource: boundaryReferenceKey ? 'confirmed_boundary' : undefined,
      boundaryDraftId: plan.boundary_draft_id ?? undefined,
    });
  } catch (queueErr) {
    await db
      .update(gardenPlansTable)
      .set({
        status: 'failed',
        error_message: `garden_plan_enqueue_failed:${(queueErr as Error).message}`,
        updated_at: nowIso(),
      })
      .where(eq(gardenPlansTable.id, gardenPlanId));
    if (approvalRow?.status === 'failed' && plan.source_approval_id) {
      await db
        .update(aiToolPending)
        .set({
          status: 'failed',
          execution_error: `garden_plan_enqueue_failed:${(queueErr as Error).message}`,
          executed_at: nowIso(),
          updated_at: nowIso(),
        })
        .where(eq(aiToolPending.id, plan.source_approval_id));
    }
    try {
      await env.CONFIG_KV.delete(lockKey);
    } catch {
      // best-effort
    }
    await refundIfNeeded();
    throw queueErr;
  }

  const updated = await db
    .select()
    .from(gardenPlansTable)
    .where(eq(gardenPlansTable.id, gardenPlanId))
    .get();

  return { status: 200, body: { garden_plan: updated } };
}
