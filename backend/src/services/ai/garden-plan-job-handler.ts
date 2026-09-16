/**
 * Garden-plan image generation queue handler.
 *
 * Producer: `executeCreateGardenSitePlan` (approval-executor.ts) — pre-creates
 * a `garden_plans` row with status='generating' and an `ai_tool_pending` row
 * in status='approved', then enqueues a message and returns to the user
 * immediately (the approve HTTP request finishes in <200ms instead of waiting
 * up to 30s for OpenAI).
 *
 * Consumer: this module — calls OpenAI DALL·E 3 (no Workers wall-clock
 * pressure here; queue handlers have minutes of wall time and no CPU limit),
 * uploads the PNG to R2, flips both rows to their terminal state, and sends
 * a push notification.
 *
 * Reliability properties:
 *   - **Idempotent.** Re-checks `garden_plans.status` before doing any work
 *     and exits cleanly if not 'generating'. Cloudflare Queues delivers
 *     at-least-once; duplicates can happen.
 *   - **Replication-tolerant.** If the producer's INSERT hasn't replicated
 *     to the consumer's D1 region yet, early attempts return `retry` instead
 *     of acking; only the final delivery treats a missing row as terminal.
 *   - **Auto-retried on transient failures** via Cloudflare Queues backoff
 *     (`max_retries=3` in wrangler.toml — 4 total deliveries). On the final
 *     delivery, the row is marked failed and the message is acked so the
 *     user sees a terminal state. We never DLQ on a normal failure; the DLQ
 *     is reserved for catastrophic handler crashes.
 *   - **No partial writes**: R2 PUT happens before D1 UPDATE; D1 UPDATE
 *     happens before push send. If push fails the row is still 'completed'
 *     and the user can refresh the Gardening tab. If the D1 UPDATE itself
 *     fails the message is retried (the orphan PNG is re-overwritten on the
 *     next attempt's PUT).
 *   - **Refund safety**: the daily quota counter is refunded only after the
 *     terminal `markExecuted` write succeeds, so a failure-then-retry path
 *     cannot double-refund the same approval.
 */

import { and, eq, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../../db/schema';
import { aiToolPending } from '../../db/schema-ai-chat';
import { gardenPlanBoundaryDrafts, gardenPlans } from '../../db/schema-garden-plans';
import type { Database, Env, GardenPlanGenerationMessage } from '../../types';
import { AIAccessError } from '../../utils/errors';
import { now as nowIso } from '../../utils/id';
import { resolveProviderApiKey } from '../ai-credential-resolver';
import { assertCanUseAI } from '../entitlement-service';
import { SmartNotificationGateway } from '../smart-notification-gateway';

import { ApprovalQueueShim } from './approval-queue-shim';
import { refundGardenPlanCount } from './garden-plan-rate-limit';
import {
  friendlyErrorMessage,
  generateGardenSitePlanFromReference,
  generateGardenSitePlanTextOnly,
  type GardenPlanErrorCode,
  type ReferenceImage,
} from './garden-site-plan-image-service';

/**
 * Outcome returned to the queue dispatcher. The dispatcher decides ack vs
 * retry — keeping the handler free of `Message` imports makes it trivial to
 * unit-test with a plain object.
 */
export type GardenPlanJobOutcome =
  | { kind: 'completed'; gardenPlanId: string }
  | { kind: 'skipped-not-generating'; reason: string }
  | { kind: 'failed-permanent'; code: GardenPlanErrorCode | string }
  | { kind: 'retry'; code: GardenPlanErrorCode | string };

/**
 * Error codes that warrant a queue retry. Anything not in this set is treated
 * as permanent — the row is marked 'failed' and the user is notified.
 *
 * Rationale:
 *   - `openai_image_timeout` / `openai_image_failed`: transient network /
 *     server-side hiccup — retry has a real chance of succeeding.
 *   - `openai_image_rate_limited`: 429s often clear within seconds (token
 *     bucket refill). Backoff retry is correct.
 *   - Everything else (`unauthorized`, `content_policy`, `invalid_prompt`,
 *     `no_data`, `not_configured`): permanent on this prompt/key. Retrying
 *     just costs another DALL·E call; not worth it.
 */
const RETRYABLE_CODES: ReadonlySet<string> = new Set<GardenPlanErrorCode>([
  'openai_image_timeout',
  'openai_image_failed',
  'openai_image_rate_limited',
]);

export interface HandleGardenPlanJobOptions {
  /** 1-based delivery attempt. From `msg.attempts` on Cloudflare Queues. */
  attempt: number;
  /** Matches `max_retries` in wrangler.toml. Beyond this, treat any retryable error as permanent so the message ack-and-DLQs cleanly with the user notified. */
  maxAttempts: number;
}

export async function handleGardenPlanGenerationJob(
  env: Env,
  body: GardenPlanGenerationMessage,
  opts: HandleGardenPlanJobOptions
): Promise<GardenPlanJobOutcome> {
  const db = drizzle(env.DB, { schema }) as unknown as Database;
  const approvals = new ApprovalQueueShim(env.DB);

  // Observability: how long the message sat in the queue before we picked it
  // up. Useful to spot consumer-lag regressions.
  if (typeof body.enqueuedAt === 'number' && body.enqueuedAt > 0) {
    const lagMs = Date.now() - body.enqueuedAt;
    if (lagMs > 0) {
      console.info('[garden-plan-job] queue-lag', {
        gardenPlanId: body.gardenPlanId.slice(0, 8),
        attempt: opts.attempt,
        lagMs,
      });
    }
  }

  const existing = await db
    .select()
    .from(gardenPlans)
    .where(eq(gardenPlans.id, body.gardenPlanId))
    .get();

  if (!existing) {
    // D1 is multi-region with eventual consistency outside the primary; the
    // producer's INSERT may not be visible to this consumer's region yet.
    // Retry on early attempts so we don't silently drop a real job, and only
    // treat the row as truly missing on the final delivery.
    const exhausted = opts.attempt >= opts.maxAttempts;
    console.warn('[garden-plan-job] row missing', {
      gardenPlanId: body.gardenPlanId.slice(0, 8),
      attempt: opts.attempt,
      exhausted,
    });
    if (!exhausted) {
      return { kind: 'retry', code: 'garden_plan_row_missing' };
    }
    // Final attempt: treat as terminally absent. Best-effort mark the
    // approval row failed so the user is not stuck staring at "approved"
    // forever in case the row really was deleted out from under us.
    if (body.approvalId) {
      await approvals
        .markExecuted(body.approvalId, {
          ok: false,
          error: 'garden_plan_row_missing',
        })
        .catch(() => {
          // approval may itself be missing; nothing more we can do
        });
    }
    return {
      kind: 'skipped-not-generating',
      reason: 'garden_plan_row_missing',
    };
  }

  if (existing.status !== 'generating') {
    // Best-effort: bring the approval row in sync with the terminal garden
    // plan state. Errors here are logged and swallowed — re-delivery would
    // see the same state and try again, and we never want a reconciliation
    // hiccup to trigger another OpenAI call (status check guards against it
    // anyway, but defence in depth).
    await reconcileTerminalApproval(approvals, body, existing).catch((err) => {
      console.warn('[garden-plan-job] terminal approval reconcile failed', {
        gardenPlanId: body.gardenPlanId.slice(0, 8),
        status: existing.status,
        error: (err as Error).message,
      });
    });
    return {
      kind: 'skipped-not-generating',
      reason: `status_is_${existing.status}`,
    };
  }

  try {
    await assertCanUseAI(body.userId, env);
  } catch (err) {
    if (err instanceof AIAccessError || (err as Error).name === 'AIAccessError') {
      console.warn('[garden-plan-job] entitlement denied', {
        gardenPlanId: body.gardenPlanId.slice(0, 8),
        code: (err as AIAccessError).code,
      });
      await failTerminally(env, db, approvals, body, 'entitlement_denied');
      return { kind: 'skipped-not-generating', reason: 'entitlement_denied' };
    }
    throw err;
  }

  let pngBytes: ArrayBuffer;
  let imageWidth: number;
  let imageHeight: number;
  let latencyMs: number;
  let usedReference = false;
  try {
    // Try image-conditioned generation when the producer attached a
    // reference key. If the R2 GET fails (object missing / wrong type),
    // fall through to text-only generation so the user still gets a plan.
    const reference = await loadReferenceImage(
      env,
      body.referenceImageR2Key
    ).catch((err) => {
      console.warn('[garden-plan-job] reference image load failed — falling back to text-only', {
        gardenPlanId: body.gardenPlanId.slice(0, 8),
        r2Key: body.referenceImageR2Key,
        error: (err as Error).message,
      });
      return null;
    });

    // Run image generation on the acting user's own OpenAI BYOK key when they
    // have one connected; otherwise the SimpleHouse-managed key. Image models
    // are not in the selectable catalog, so the model default is unchanged.
    const { apiKey: openaiApiKey } = await resolveProviderApiKey(env, body.userId, 'openai');
    const result = reference
      ? await generateGardenSitePlanFromReference(openaiApiKey, body.diagramPrompt, reference)
      : await generateGardenSitePlanTextOnly(openaiApiKey, body.diagramPrompt);
    pngBytes = result.pngBytes;
    imageWidth = result.width;
    imageHeight = result.height;
    latencyMs = result.latencyMs;
    usedReference = result.usedReference;
  } catch (err) {
    const code = (err as Error).message ?? 'openai_image_failed';
    const isRetryable = RETRYABLE_CODES.has(code);
    const exhausted = opts.attempt >= opts.maxAttempts;

    console.warn('[garden-plan-job] image generation failed', {
      gardenPlanId: body.gardenPlanId.slice(0, 8),
      householdId: body.householdId.slice(0, 8),
      code,
      attempt: opts.attempt,
      isRetryable,
      exhausted,
    });

    if (isRetryable && !exhausted) {
      return { kind: 'retry', code };
    }

    await failTerminally(env, db, approvals, body, code);
    return { kind: 'failed-permanent', code };
  }

  const filename = 'garden-site-plan.png';
  const r2Key = `garden-plans/${body.householdId}/${body.gardenPlanId}/${filename}`;

  try {
    await env.REPORTS_BUCKET.put(r2Key, pngBytes, {
      httpMetadata: { contentType: 'image/png' },
    });
  } catch (err) {
    const code = `r2_put_failed:${(err as Error).message}`;
    const exhausted = opts.attempt >= opts.maxAttempts;
    console.warn('[garden-plan-job] R2 put failed', {
      gardenPlanId: body.gardenPlanId.slice(0, 8),
      attempt: opts.attempt,
      error: (err as Error).message,
    });
    if (!exhausted) return { kind: 'retry', code };
    await failTerminally(env, db, approvals, body, code);
    return { kind: 'failed-permanent', code };
  }

  const ts = nowIso();
  let updateChanges = 0;
  try {
    // CAS on `status='generating'` — if the user cancelled (or another path
    // already moved the row to 'failed'/'completed'), we must NOT silently
    // overwrite that terminal state with our own. `meta.changes` will be 0
    // in that case and we treat it as cancellation.
    const updateResult = await db
      .update(gardenPlans)
      .set({
        status: 'completed',
        original_file_key: r2Key,
        display_image_key: r2Key,
        thumbnail_key: r2Key,
        filename,
        file_size: pngBytes.byteLength,
        content_type: 'image/png',
        width_px: imageWidth,
        height_px: imageHeight,
        // Persist for the mobile UI: drives the title ("AI-traced from
        // your lot" vs "Stylized concept") and ops dashboards. Falls back
        // to the producer-supplied source so an ungrounded run is honest
        // even if the load failed silently mid-flight.
        reference_image_source:
          (usedReference
            ? body.referenceImageSource ?? 'user_attachment'
            : 'none'),
        updated_at: ts,
      })
      .where(
        and(
          eq(gardenPlans.id, body.gardenPlanId),
          eq(gardenPlans.status, 'generating')
        )
      )
      .run();
    updateChanges =
      (updateResult as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;
  } catch (err) {
    // R2 PUT succeeded but D1 update failed. Most D1 failures are transient
    // (replication / write-quorum timing); retry on non-final attempts. The
    // next attempt's R2 PUT just re-overwrites the same key, so leaving the
    // PNG in place is intentional. On the final attempt fall through to the
    // terminal failure path so the user isn't stuck.
    const code = `garden_plan_update_failed:${(err as Error).message}`;
    const exhausted = opts.attempt >= opts.maxAttempts;
    console.warn('[garden-plan-job] D1 update failed', {
      gardenPlanId: body.gardenPlanId.slice(0, 8),
      attempt: opts.attempt,
      exhausted,
      error: (err as Error).message,
    });
    if (!exhausted) {
      return { kind: 'retry', code };
    }
    // Last resort: try once more to clean up the orphan PNG, then surface
    // a permanent failure so the user gets a 'failed' push.
    try {
      await env.REPORTS_BUCKET.delete(r2Key);
    } catch {
      // orphan PNG is acceptable
    }
    await failTerminally(env, db, approvals, body, code);
    return { kind: 'failed-permanent', code };
  }

  if (updateChanges === 0) {
    // The CAS missed: the row is no longer 'generating', meaning the user
    // hit /cancel (or some other terminal write landed) while OpenAI was
    // running. Honor that decision — drop the orphan PNG, leave both rows
    // in their user-visible terminal state, and ack.
    console.info('[garden-plan-job] cancelled mid-flight — dropping result', {
      gardenPlanId: body.gardenPlanId.slice(0, 8),
      attempt: opts.attempt,
    });
    try {
      await env.REPORTS_BUCKET.delete(r2Key);
    } catch {
      // orphan PNG is acceptable
    }
    return {
      kind: 'skipped-not-generating',
      reason: 'cancelled_during_generation',
    };
  }

  // CAS on the approval too: only flip if it's still 'approved'. If /cancel
  // already marked the approval 'failed', leave it alone — the gardenPlan
  // CAS above caught the race and we already returned. This is defence in
  // depth in case the gardenPlan CAS ever passes but the approval was
  // independently flipped.
  //
  // If `markExecuted` throws, propagate so index.ts triggers a retry. The
  // next delivery will see status='completed', skip OpenAI entirely, and
  // call `reconcileTerminalApproval` which re-attempts the same write.
  if (body.approvalId) {
    await approvals.markExecuted(
      body.approvalId,
      {
        ok: true,
        result: {
          garden_plan_id: body.gardenPlanId,
          file_key: r2Key,
          plan_type: body.planType,
          area_label: body.areaLabel,
          width_px: imageWidth,
          height_px: imageHeight,
          latency_ms: latencyMs,
        },
      },
      { requireStatus: 'approved' }
    );
  }

  if (body.boundaryDraftId) {
    await db
      .update(gardenPlanBoundaryDrafts)
      .set({ status: 'generated', updated_at: nowIso() })
      .where(eq(gardenPlanBoundaryDrafts.id, body.boundaryDraftId))
      .catch((err) => {
        console.warn('[garden-plan-job] boundary draft generated update failed', {
          boundaryDraftId: body.boundaryDraftId?.slice(0, 8),
          error: (err as Error).message,
        });
      });
  }

  await sendReadyPush(env, body).catch((err) => {
    // Push failure is non-fatal; the row is already 'completed' and the user
    // can pull-to-refresh in the Gardening tab.
    console.warn('[garden-plan-job] push send failed (non-fatal)', {
      gardenPlanId: body.gardenPlanId.slice(0, 8),
      error: (err as Error).message,
    });
  });

  console.info('[garden-plan-job] completed', {
    gardenPlanId: body.gardenPlanId.slice(0, 8),
    householdId: body.householdId.slice(0, 8),
    sizeBytes: pngBytes.byteLength,
    latencyMs,
    attempt: opts.attempt,
  });

  return { kind: 'completed', gardenPlanId: body.gardenPlanId };
}

/**
 * Apply terminal failure side-effects. Best-effort and idempotent: each step
 * is independently safe to re-run, but the refund is gated on the approval
 * row not already being in a terminal state, so a re-delivery after a partial
 * write cannot double-refund the household's daily quota.
 */
async function failTerminally(
  env: Env,
  db: Database,
  approvals: ApprovalQueueShim,
  body: GardenPlanGenerationMessage,
  code: string
): Promise<void> {
  const ts = nowIso();

  // CAS on `status='generating'` — if the user cancelled (cancelled_by_user),
  // we must NOT overwrite their `error_message` with our own code, and we
  // must NOT refund (cancel already refunded). `meta.changes === 0` here
  // means a terminal write beat us to the row.
  let planChanges = 0;
  try {
    const updateResult = await db
      .update(gardenPlans)
      .set({
        status: 'failed',
        error_message: code,
        updated_at: ts,
      })
      .where(
        and(
          eq(gardenPlans.id, body.gardenPlanId),
          eq(gardenPlans.status, 'generating')
        )
      )
      .run();
    planChanges =
      (updateResult as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;
  } catch (err) {
    console.warn('[garden-plan-job] failed-status update failed', {
      gardenPlanId: body.gardenPlanId.slice(0, 8),
      error: (err as Error).message,
    });
  }

  if (planChanges === 0) {
    // Row was already terminal (cancelled or completed by another path).
    // Don't touch the approval, don't refund, don't push — the path that
    // owns the terminal state already did the right thing.
    console.info('[garden-plan-job] failTerminally: plan already terminal — skipping side-effects', {
      gardenPlanId: body.gardenPlanId.slice(0, 8),
      code,
    });
    return;
  }

  // Mark approval failed only if it's still 'approved'. The CAS prevents:
  //   - clobbering an 'executed' state (defence in depth — should be
  //     unreachable since planChanges > 0 above);
  //   - double-refunding when /cancel already marked the approval 'failed'
  //     (also caught by the planChanges guard, but kept for defence).
  let approvalChanged = false;
  if (body.approvalId) {
    try {
      approvalChanged = await approvals.markExecuted(
        body.approvalId,
        { ok: false, error: code },
        { requireStatus: 'approved' }
      );
    } catch (err) {
      console.warn('[garden-plan-job] markExecuted (failed) threw', {
        gardenPlanId: body.gardenPlanId.slice(0, 8),
        error: (err as Error).message,
      });
    }
  }

  // Refund only when we actually flipped the approval. This guards against
  // both: (a) the /cancel path (already refunded — approval is 'failed',
  // CAS misses), and (b) a re-delivery after a previous failTerminally
  // already ran (approval is 'failed', CAS misses).
  if (approvalChanged || !body.approvalId) {
    await refundGardenPlanCount(env, body.householdId);
  }

  await sendFailedPush(env, body, code).catch((err) => {
    console.warn('[garden-plan-job] failure push send failed (non-fatal)', {
      gardenPlanId: body.gardenPlanId.slice(0, 8),
      error: (err as Error).message,
    });
  });
}

/**
 * Bring the approval row in sync with the terminal `garden_plans` state.
 *
 * Only flips the approval if it is still in `'approved'` — once the approval
 * has been marked `'executed'` or `'failed'`, we treat that as authoritative
 * and leave it alone. This prevents a redelivery from clobbering an earlier
 * successful terminal write (and from accidentally turning a `'failed'`
 * approval into `'executed'` if rows ever drift out of sync).
 */
async function reconcileTerminalApproval(
  approvals: ApprovalQueueShim,
  body: GardenPlanGenerationMessage,
  existing: typeof gardenPlans.$inferSelect
): Promise<void> {
  // Use CAS (`requireStatus: 'approved'`) instead of a read-then-write so a
  // concurrent /cancel that flipped the approval to 'failed' isn't clobbered
  // by a delayed reconcile.
  if (existing.status === 'completed') {
    if (!body.approvalId) return;
    await approvals.markExecuted(
      body.approvalId,
      {
        ok: true,
        result: {
          garden_plan_id: body.gardenPlanId,
          file_key: existing.display_image_key ?? existing.original_file_key,
          plan_type: body.planType,
          area_label: body.areaLabel,
          width_px: existing.width_px,
          height_px: existing.height_px,
        },
      },
      { requireStatus: 'approved' }
    );
  } else if (existing.status === 'failed') {
    if (!body.approvalId) return;
    await approvals.markExecuted(
      body.approvalId,
      {
        ok: false,
        error: existing.error_message ?? 'garden_plan_generation_failed',
      },
      { requireStatus: 'approved' }
    );
  }
}

/**
 * Load the reference image bytes from R2 keyed by `referenceImageR2Key`.
 *
 * Returns `null` (not throw) when:
 *   - The key was not provided (text-only path).
 *   - The R2 object is missing (cache eviction, manual cleanup).
 *   - The HTTP content-type is unsupported (gpt-image-1 only accepts
 *     png + jpeg).
 *
 * Throws (so the caller can `.catch` and fall back to text-only) when:
 *   - R2 itself errors (network / permissions).
 */
async function loadReferenceImage(
  env: Env,
  r2Key: string | undefined
): Promise<ReferenceImage | null> {
  if (!r2Key) return null;
  const obj = await env.REPORTS_BUCKET.get(r2Key);
  if (!obj) return null;
  // R2 may not always populate `httpMetadata.contentType`; default to PNG
  // for satellite tiles (which we always cache as PNG) and trust the
  // attachment table for user uploads.
  const ct = obj.httpMetadata?.contentType ?? 'image/png';
  if (ct !== 'image/png' && ct !== 'image/jpeg') {
    return null;
  }
  const bytes = await obj.arrayBuffer();
  if (bytes.byteLength === 0) return null;
  return {
    bytes,
    mimeType: ct,
    filename: ct === 'image/jpeg' ? 'reference.jpg' : 'reference.png',
  };
}

async function sendReadyPush(
  env: Env,
  body: GardenPlanGenerationMessage
): Promise<void> {
  // Routed through the Smart Notification gateway (P1 pass-through): identical
  // delivery via NotificationService, plus a smart_notification_decision row.
  const gateway = new SmartNotificationGateway(env, env.DB);
  await gateway.enqueue({
    producerType: 'garden_plan_ready',
    householdId: body.householdId,
    recipients: [body.userId],
    title: 'Your garden plan is ready',
    body: `${body.areaLabel || 'Your garden plan'} is saved under Gardening site plans.`,
    data: {
      type: 'garden_plan_ready',
      garden_plan_id: body.gardenPlanId,
      household_id: body.householdId,
    },
    referenceType: 'garden_plan',
    referenceId: body.gardenPlanId,
  });
}

async function sendFailedPush(
  env: Env,
  body: GardenPlanGenerationMessage,
  code: string
): Promise<void> {
  const gateway = new SmartNotificationGateway(env, env.DB);
  await gateway.enqueue({
    producerType: 'garden_plan_failed',
    householdId: body.householdId,
    recipients: [body.userId],
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
}

/**
 * How long a `garden_plans` row may sit in `'generating'` before we treat it
 * as catastrophically stuck and reconcile it to `'failed'` from a cron.
 *
 * The end-to-end happy path is 15–30s; with `max_retries=3` and exponential
 * backoff up to 5min, the worst-case successful path is roughly 11min. We
 * pad to 15min so legitimate slow OpenAI calls aren't preempted, and short
 * enough that DLQ-bound jobs don't show "Generating…" to the user for hours.
 */
export const STUCK_GENERATING_GRACE_MS = 15 * 60 * 1000;

export interface SweepStuckGeneratingResult {
  scanned: number;
  reconciled: number;
}

/**
 * Reconcile `garden_plans` rows that are stuck in `'generating'` past the
 * grace window. Catches the failure mode where the queue handler crashed
 * catastrophically (DLQ) or was acked without setting a terminal state, so
 * the user is not left staring at a perma-spinning card.
 *
 * For each stuck row:
 *   1. Flip `garden_plans.status = 'failed'` with a sentinel error.
 *   2. Mark the matching approval `'failed'` (best-effort).
 *   3. Refund the daily quota (best-effort, gated on approval state).
 *   4. Send a failure push (best-effort).
 *
 * Returns a summary for cron logging. Never throws.
 */
export async function sweepStuckGeneratingGardenPlans(
  env: Env,
  now: Date = new Date(),
  graceMs: number = STUCK_GENERATING_GRACE_MS
): Promise<SweepStuckGeneratingResult> {
  const db = drizzle(env.DB, { schema }) as unknown as Database;
  const approvals = new ApprovalQueueShim(env.DB);

  const cutoffIso = new Date(now.getTime() - graceMs).toISOString();
  let stuck: (typeof gardenPlans.$inferSelect)[] = [];
  try {
    stuck = await db
      .select()
      .from(gardenPlans)
      .where(
        and(
          eq(gardenPlans.status, 'generating'),
          lte(gardenPlans.updated_at, cutoffIso)
        )
      )
      .all();
  } catch (err) {
    console.error('[garden-plan-sweep] scan failed', {
      error: (err as Error).message,
    });
    return { scanned: 0, reconciled: 0 };
  }

  if (stuck.length === 0) {
    return { scanned: 0, reconciled: 0 };
  }

  let reconciled = 0;
  const sentinelCode = 'garden_plan_stuck_in_queue';
  const ts = nowIso();

  for (const row of stuck) {
    let rowChanges = 0;
    try {
      // CAS on `status='generating' AND updated_at <= cutoff`. The extra
      // `updated_at` clause closes a TOCTOU window: between the SELECT above
      // and this UPDATE, /retry could have reset the row to 'generating'
      // with a fresh `updated_at`. Without this guard the sweep would
      // clobber the in-flight retry.
      const updateResult = await db
        .update(gardenPlans)
        .set({
          status: 'failed',
          error_message: row.error_message ?? sentinelCode,
          updated_at: ts,
        })
        .where(
          and(
            eq(gardenPlans.id, row.id),
            eq(gardenPlans.status, 'generating'),
            lte(gardenPlans.updated_at, cutoffIso)
          )
        )
        .run();
      rowChanges =
        (updateResult as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;
    } catch (err) {
      console.warn('[garden-plan-sweep] row update failed', {
        gardenPlanId: row.id.slice(0, 8),
        error: (err as Error).message,
      });
      continue;
    }

    if (rowChanges === 0) {
      // Either the row was retried in the racing window or another path
      // already moved it to a terminal state. Either way: leave it alone.
      console.info('[garden-plan-sweep] row no longer eligible — skipping', {
        gardenPlanId: row.id.slice(0, 8),
      });
      continue;
    }

    // Find the approval row tied to this garden plan. We don't have a direct
    // FK, so look up by household + tool_name + approved status. There can
    // be multiple matches in flight; we conservatively skip if we can't
    // disambiguate (the approval will get expired by the regular sweep).
    let approvalId: string | null = null;
    let userIdForPush: string | null = row.created_by;
    try {
      const candidates = await db
        .select()
        .from(aiToolPending)
        .where(
          and(
            eq(aiToolPending.household_id, row.household_id),
            eq(aiToolPending.tool_name, 'create_garden_site_plan'),
            eq(aiToolPending.status, 'approved')
          )
        )
        .all();
      const match = candidates.find((c) => {
        try {
          const parsed = JSON.parse(c.input_json) as {
            diagram_prompt?: string;
            area_label?: string;
          };
          return parsed.area_label === row.label;
        } catch {
          return false;
        }
      });
      if (match) {
        approvalId = match.id;
        userIdForPush = match.user_id ?? userIdForPush;
      }
    } catch (err) {
      console.warn('[garden-plan-sweep] approval lookup failed', {
        gardenPlanId: row.id.slice(0, 8),
        error: (err as Error).message,
      });
    }

    if (approvalId) {
      try {
        await approvals.markExecuted(approvalId, {
          ok: false,
          error: sentinelCode,
        });
      } catch (err) {
        console.warn('[garden-plan-sweep] markExecuted failed', {
          approvalId: approvalId.slice(0, 8),
          error: (err as Error).message,
        });
      }
    }

    await refundGardenPlanCount(env, row.household_id);

    if (userIdForPush) {
      try {
        const gateway = new SmartNotificationGateway(env, env.DB);
        await gateway.enqueue({
          producerType: 'garden_plan_failed',
          householdId: row.household_id,
          recipients: [userIdForPush],
          title: "Couldn't generate your garden plan",
          body: friendlyErrorMessage(sentinelCode),
          data: {
            type: 'garden_plan_failed',
            garden_plan_id: row.id,
            household_id: row.household_id,
            error_code: sentinelCode,
          },
          referenceType: 'garden_plan',
          referenceId: row.id,
        });
      } catch (err) {
        console.warn('[garden-plan-sweep] push send failed (non-fatal)', {
          gardenPlanId: row.id.slice(0, 8),
          error: (err as Error).message,
        });
      }
    }

    reconciled += 1;
  }

  console.info('[garden-plan-sweep] reconciled stuck rows', {
    scanned: stuck.length,
    reconciled,
    cutoffIso,
  });

  return { scanned: stuck.length, reconciled };
}
