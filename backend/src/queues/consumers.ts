import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as aihousekeeperSchema from '../db/schema';
import { ApprovalQueueShim } from '../services/ai/approval-queue-shim';
import {
  handleGardenPlanGenerationJob,
} from '../services/ai/garden-plan-job-handler';
import { refundGardenPlanCount } from '../services/ai/garden-plan-rate-limit';
import { friendlyErrorMessage } from '../services/ai/garden-site-plan-image-service';
import {
  handleHomeProjectSchematicJob,
} from '../services/ai/home-project-schematic-job-handler';
import {
  handleHomeProjectSmartDraftJob,
} from '../services/ai/home-project-smart-draft-job-handler';
import {
  handleTaskEnrichmentJob,
} from '../services/ai/task-enrichment-handler';
import { handleOutboundMessage } from '../services/aihousekeeper/outbound-loop';
import { NotificationService } from '../services/notification-service';
import {
  handleDlqConsumerBatch,
  isDlqQueueName,
} from '../services/observability/dlq-consumer';
import type {
  AihousekeeperOutboundMessage,
  Env,
  GardenPlanGenerationMessage,
  HomeProjectSchematicMessage,
  HomeProjectSmartDraftMessage,
  TaskEnrichmentMessage,
} from '../types';
import { nowIso } from '../utils/id';

/**
 * Queue consumer dispatcher. A single Worker has exactly one `queue()`
 * export, so we route by `batch.queue` (the queue name from
 * wrangler.toml's `[[queues.consumers]] queue = "..."`).
 *
 *   aihousekeeper-outbound                  → Aihousekeeper outbound messages (§F2)
 *   garden-plan-generation                  → Async DALL·E garden-plan generation
 *   garden-plan-generation-staging          → Same pipeline for staging
 *
 * Concurrency / batching for each queue is controlled in wrangler.toml;
 * this handler just cooperatively schedules per-message work on the
 * single event loop.
 */
export async function handleQueue(
  batch:
    | MessageBatch<AihousekeeperOutboundMessage>
    | MessageBatch<GardenPlanGenerationMessage>
    | MessageBatch<TaskEnrichmentMessage>
    | MessageBatch<unknown>,
  env: Env
): Promise<void> {
  if (isDlqQueueName(batch.queue)) {
    await handleDlqConsumerBatch(env, batch as MessageBatch<unknown>);
    return;
  }

  switch (batch.queue) {
    case 'aihousekeeper-outbound': {
      const b = batch as MessageBatch<AihousekeeperOutboundMessage>;
      await Promise.all(
        b.messages.map((msg) => handleOutboundMessage(env, msg))
      );
      return;
    }
    case 'garden-plan-generation':
    case 'garden-plan-generation-staging': {
      const b = batch as MessageBatch<GardenPlanGenerationMessage>;
      // Garden-plan jobs run sequentially per batch — DALL·E is high-cost
      // (~$0.04/image) and high-latency (12–60s), so parallel-within-batch
      // would just stack on the OpenAI rate limit. `max_concurrency` in
      // wrangler.toml drives horizontal concurrency across batches.
      for (const msg of b.messages) {
        await handleGardenPlanQueueMessage(env, msg);
      }
      return;
    }
    case 'task-enrichment':
    case 'task-enrichment-staging': {
      const b = batch as MessageBatch<TaskEnrichmentMessage>;
      // Each enrichment is one short Claude call — run the batch in parallel.
      await Promise.all(b.messages.map((msg) => handleTaskEnrichmentQueueMessage(env, msg)));
      return;
    }
    default: {
      // Brand-prefixed schematic queues (House + Budget/Kaizen/Health fleet).
      if (batch.queue.includes('home-project-schematic') && !isDlqQueueName(batch.queue)) {
        const b = batch as MessageBatch<HomeProjectSchematicMessage>;
        for (const msg of b.messages) {
          await handleHomeProjectSchematicQueueMessage(env, msg);
        }
        return;
      }
      // Smart Project describe-to-draft. Matched on the full feature name
      // rather than a `home-project-` prefix, so adding a third home-project
      // queue later cannot silently route into either of these two.
      if (batch.queue.includes('home-project-smart-draft') && !isDlqQueueName(batch.queue)) {
        const b = batch as MessageBatch<HomeProjectSmartDraftMessage>;
        // Serial, not Promise.all: one draft is a single long multimodal call
        // and `max_batch_size = 1` already means one per batch.
        for (const msg of b.messages) {
          await handleHomeProjectSmartDraftQueueMessage(env, msg);
        }
        return;
      }
      // Unknown queue — almost certainly a deploy/config drift. Retry
      // rather than ack so the message survives until the dispatcher is
      // taught about it; CF will eventually DLQ if it's truly orphaned.
      // Acking silently here would lose data on any future queue rename.
      console.error('[queue] unknown queue (retrying)', {
        queue: batch.queue,
        messageCount: batch.messages.length,
      });
      for (const msg of batch.messages) {
        msg.retry({ delaySeconds: 60 });
      }
    }
  }
}

const HOME_PROJECT_SCHEMATIC_MAX_ATTEMPTS = 4;

async function handleHomeProjectSchematicQueueMessage(
  env: Env,
  msg: Message<HomeProjectSchematicMessage>
): Promise<void> {
  const body = msg.body;
  if (
    !body ||
    typeof body.geometryId !== 'string' ||
    typeof body.projectId !== 'string' ||
    typeof body.householdId !== 'string'
  ) {
    console.error('[home-project-schematic-queue] malformed — ack', {
      attempt: msg.attempts,
      bodyPreview: JSON.stringify(body).slice(0, 200),
    });
    msg.ack();
    return;
  }

  try {
    const outcome = await handleHomeProjectSchematicJob(env, body, {
      attempt: msg.attempts,
      maxAttempts: HOME_PROJECT_SCHEMATIC_MAX_ATTEMPTS,
    });
    if (outcome.kind === 'retry') {
      msg.retry({ delaySeconds: Math.min(60 * msg.attempts, 300) });
      return;
    }
    msg.ack();
  } catch (err) {
    console.error('[home-project-schematic-queue] handler threw', {
      geometryId: body.geometryId.slice(0, 8),
      attempt: msg.attempts,
      error: (err as Error).message,
    });
    if (msg.attempts < HOME_PROJECT_SCHEMATIC_MAX_ATTEMPTS) {
      msg.retry({ delaySeconds: Math.min(60 * msg.attempts, 300) });
      return;
    }
    msg.ack();
  }
}

/**
 * Fewer attempts than the schematic job, deliberately.
 *
 * A draft generation is a long multimodal call, and its dominant failure mode
 * is a malformed generation, which the handler already classifies as permanent
 * — retrying the same prompt against the same model reproduces it. Three
 * deliveries covers the transient cases (rate limit, cold provider) without
 * spending four long calls to arrive at the same bad shape.
 */
const HOME_PROJECT_SMART_DRAFT_MAX_ATTEMPTS = 3;

async function handleHomeProjectSmartDraftQueueMessage(
  env: Env,
  msg: Message<HomeProjectSmartDraftMessage>
): Promise<void> {
  const body = msg.body;
  if (
    !body ||
    typeof body.draftId !== 'string' ||
    typeof body.projectId !== 'string' ||
    typeof body.householdId !== 'string' ||
    typeof body.userId !== 'string'
  ) {
    console.error('[home-project-smart-draft-queue] malformed — ack', {
      attempt: msg.attempts,
      // Ids only. The description is not in the message and must not be logged.
      bodyPreview: JSON.stringify(body).slice(0, 200),
    });
    msg.ack();
    return;
  }

  try {
    const outcome = await handleHomeProjectSmartDraftJob(env, body, {
      attempt: msg.attempts,
      maxAttempts: HOME_PROJECT_SMART_DRAFT_MAX_ATTEMPTS,
    });
    if (outcome.kind === 'retry') {
      msg.retry({ delaySeconds: Math.min(60 * msg.attempts, 300) });
      return;
    }
    msg.ack();
  } catch (err) {
    console.error('[home-project-smart-draft-queue] handler threw', {
      draftId: body.draftId.slice(0, 8),
      attempt: msg.attempts,
      error: (err as Error).message,
    });
    if (msg.attempts < HOME_PROJECT_SMART_DRAFT_MAX_ATTEMPTS) {
      msg.retry({ delaySeconds: Math.min(60 * msg.attempts, 300) });
      return;
    }
    msg.ack();
  }
}

/**
 * Per-message wrapper for the garden-plan queue. Translates the handler's
 * structured outcome into ack/retry calls so Cloudflare Queues handles
 * backoff + DLQ correctly.
 *
 * Per wrangler.toml: max_retries=3 means the first delivery plus three
 * retries (4 total deliveries). The handler treats the fourth delivery as
 * terminal so the user gets a 'failed' push and the row is marked failed
 * before we ack. The stuck-row sweep cron is the safety net for the case
 * where even the terminal cleanup throws.
 */
const GARDEN_PLAN_MAX_DELIVERY_ATTEMPTS = 4;

async function handleGardenPlanQueueMessage(
  env: Env,
  msg: Message<GardenPlanGenerationMessage>
): Promise<void> {
  // Defensive: malformed body should never happen because the producer is
  // typed, but if it does we don't want a NPE somewhere downstream — DLQ it.
  if (!isValidGardenPlanMessage(msg.body)) {
    console.error('[garden-plan-queue] malformed message body — DLQ', {
      attempt: msg.attempts,
      bodyPreview: JSON.stringify(msg.body).slice(0, 200),
    });
    msg.ack();
    return;
  }

  try {
    const outcome = await handleGardenPlanGenerationJob(env, msg.body, {
      attempt: msg.attempts,
      maxAttempts: GARDEN_PLAN_MAX_DELIVERY_ATTEMPTS,
    });
    if (outcome.kind === 'retry') {
      msg.retry({ delaySeconds: gardenPlanRetryDelaySeconds(msg.attempts) });
      return;
    }
    msg.ack();
  } catch (err) {
    console.error('[garden-plan-queue] handler threw', {
      gardenPlanId: msg.body.gardenPlanId.slice(0, 8),
      attempt: msg.attempts,
      error: (err as Error).message,
    });
    // On non-terminal attempts let CF retry. On the terminal attempt, run a
    // best-effort terminal cleanup so the user gets a 'failed' push and the
    // counter is refunded; the stuck-row sweep is a backstop if even this
    // throws.
    if (msg.attempts < GARDEN_PLAN_MAX_DELIVERY_ATTEMPTS) {
      msg.retry({ delaySeconds: gardenPlanRetryDelaySeconds(msg.attempts) });
      return;
    }
    try {
      await terminalCleanupAfterCrash(env, msg.body, (err as Error).message);
    } catch (cleanupErr) {
      console.error('[garden-plan-queue] terminal cleanup also threw', {
        gardenPlanId: msg.body.gardenPlanId.slice(0, 8),
        error: (cleanupErr as Error).message,
      });
    }
    msg.ack();
  }
}

/**
 * Per-message wrapper for the task-enrichment queue. Maps the handler's
 * outcome to ack/retry. max_retries=3 → 4 total deliveries; on the terminal
 * delivery the handler marks the row 'failed', so we always ack rather than
 * DLQ on a normal failure. The stuck-row sweep is the backstop for crashes.
 */
const TASK_ENRICHMENT_MAX_DELIVERY_ATTEMPTS = 4;

async function handleTaskEnrichmentQueueMessage(
  env: Env,
  msg: Message<TaskEnrichmentMessage>
): Promise<void> {
  const body = msg.body;
  if (!body || typeof body.taskId !== 'string' || typeof body.householdId !== 'string') {
    console.error('[task-enrichment-queue] malformed message — DLQ', {
      attempt: msg.attempts,
      bodyPreview: JSON.stringify(body).slice(0, 200),
    });
    msg.ack();
    return;
  }

  console.info('[task-enrichment-queue] received', {
    taskId: body.taskId.slice(0, 8),
    householdId: body.householdId.slice(0, 8),
    attempt: msg.attempts,
    ageMs: typeof body.enqueuedAt === 'number' ? Date.now() - body.enqueuedAt : null,
  });

  try {
    const outcome = await handleTaskEnrichmentJob(env, body, {
      attempt: msg.attempts,
      maxAttempts: TASK_ENRICHMENT_MAX_DELIVERY_ATTEMPTS,
    });
    console.info('[task-enrichment-queue] outcome', {
      taskId: body.taskId.slice(0, 8),
      attempt: msg.attempts,
      kind: outcome.kind,
      reason: 'reason' in outcome ? outcome.reason : undefined,
    });
    if (outcome.kind === 'retry') {
      msg.retry({ delaySeconds: Math.min(60 * msg.attempts, 300) });
      return;
    }
    msg.ack();
  } catch (err) {
    console.error('[task-enrichment-queue] handler threw', {
      taskId: body.taskId.slice(0, 8),
      attempt: msg.attempts,
      error: (err as Error).message,
    });
    // Let CF retry on non-terminal attempts; ack on the last so we don't loop.
    if (msg.attempts < TASK_ENRICHMENT_MAX_DELIVERY_ATTEMPTS) {
      msg.retry({ delaySeconds: Math.min(60 * msg.attempts, 300) });
      return;
    }
    msg.ack();
  }
}

function isValidGardenPlanMessage(
  body: unknown
): body is GardenPlanGenerationMessage {
  if (!body || typeof body !== 'object') return false;
  const b = body as Partial<GardenPlanGenerationMessage>;
  return (
    typeof b.approvalId === 'string' &&
    typeof b.gardenPlanId === 'string' &&
    typeof b.householdId === 'string' &&
    typeof b.userId === 'string' &&
    typeof b.diagramPrompt === 'string' &&
    typeof b.planType === 'string' &&
    typeof b.areaLabel === 'string'
  );
}

/**
 * Last-ditch terminal cleanup invoked when the handler throws on its final
 * delivery. Mirrors `failTerminally` from the handler module but inlined
 * here so we can call it without importing private helpers, and tolerant of
 * each step throwing independently.
 */
async function terminalCleanupAfterCrash(
  env: Env,
  body: GardenPlanGenerationMessage,
  reason: string
): Promise<void> {
  const code = `garden_plan_handler_crash:${reason}`.slice(0, 200);
  const ts = nowIso();
  const db = drizzle(env.DB, { schema: aihousekeeperSchema });
  const approvals = new ApprovalQueueShim(env.DB);

  // Use raw SQL with a `status='generating'` guard so this is idempotent —
  // a redelivery (or the stuck-row sweep) won't clobber a row that's been
  // moved to a different terminal state in the meantime.
  try {
    await db.run(
      sql`UPDATE garden_plans
         SET status='failed', error_message=${code}, updated_at=${ts}
         WHERE id=${body.gardenPlanId} AND status='generating'`
    );
  } catch (err) {
    console.warn('[garden-plan-queue] terminal cleanup row update failed', {
      gardenPlanId: body.gardenPlanId.slice(0, 8),
      error: (err as Error).message,
    });
  }

  // Refund only if the approval is still 'approved' to avoid double-refund
  // on a redelivery that re-enters this path.
  try {
    if (body.approvalId) {
      const approval = await approvals.get(body.approvalId);
      if (approval && approval.status === 'approved') {
        await approvals.markExecuted(body.approvalId, { ok: false, error: code });
        await refundGardenPlanCount(env, body.householdId);
      }
    }
  } catch (err) {
    console.warn('[garden-plan-queue] terminal cleanup approval write failed', {
      gardenPlanId: body.gardenPlanId.slice(0, 8),
      error: (err as Error).message,
    });
  }

  try {
    const notifications = new NotificationService(env, env.DB);
    await notifications.sendNotification({
      userId: body.userId,
      type: 'garden_plan_failed',
      title: "Couldn't generate your garden plan",
      body: friendlyErrorMessage(code),
      data: {
        type: 'garden_plan_failed',
        garden_plan_id: body.gardenPlanId,
        household_id: body.householdId,
        error_code: code,
      },
      referenceType: 'garden_plan',
      referenceId: body.gardenPlanId,
    });
  } catch (err) {
    console.warn('[garden-plan-queue] terminal cleanup push failed', {
      gardenPlanId: body.gardenPlanId.slice(0, 8),
      error: (err as Error).message,
    });
  }
}

function gardenPlanRetryDelaySeconds(attempts: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 300);
}
