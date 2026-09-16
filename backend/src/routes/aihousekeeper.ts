/**
 * Aihousekeeper API surface — plan §E1.
 *
 * Single Hono router mounted at `/households/:householdId/aihousekeeper` in
 * backend/src/index.ts. Covers all 12 endpoints listed in §E1:
 *
 *   GET    /briefings                               list briefings (latest 30)
 *   GET    /briefings/:date                         one briefing (404 if absent)
 *   POST   /briefings/:date/read                    mark briefing read
 *   GET    /identity                                single assistant_identity row
 *   PATCH  /identity                                update persona/schedule fields
 *   GET    /memory?type=&q=                         list / search memory
 *   DELETE /memory/:id                              forget a memory
 *   GET    /trust-ledger?since=&category=&includeDismissed=   list ledger
 *   POST   /trust-ledger/:id/dismiss                dismiss a ledger row
 *   POST   /trust-ledger/:id/undo                   attempt undo
 *   GET    /followups?status=                       list followups
 *   POST   /followups/:id/cancel                    cancel a pending followup
 *   GET    /approvals?status=&limit=                list HIGH_WRITE approvals (v1.2 ADR-32)
 *   POST   /approvals/:id/approve                   approve a parked tool invocation
 *   POST   /approvals/:id/cancel                    cancel a parked tool invocation
 *
 * All handlers:
 *   1. `authMiddleware()` is attached at the top of this router.
 *   2. Every household-scoped handler calls
 *      `HouseholdService.getHousehold(hid, userId)` BEFORE doing any work —
 *      this throws `ForbiddenError` if the user is not a member.
 *   3. Rate-limit buckets: `aihousekeeper:default` on PATCH/POST/DELETE (60/min/user),
 *      `aihousekeeper:read` on GET (120/min/user). Both are registered in
 *      middleware/rate-limit.ts::RATE_LIMITS.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AIToolPending, AIToolPendingStatus } from '../db/schema-ai-chat';
import { authMiddleware } from '../middleware/auth';
import { rateLimitDO } from '../middleware/rate-limit';
import { executeApproved } from '../services/ai/approval-executor';
import { ApprovalQueueShim } from '../services/ai/approval-queue-shim';
import { resolveProviderApiKey } from '../services/ai-credential-resolver';
import type { MemoryType } from '../services/aihousekeeper/memory-service';
import { buildAihousekeeperStack } from '../services/aihousekeeper/request-stack';
import {
  cancelFollowup,
  getBriefing,
  getBriefingWeather,
  getHomeInsight,
  getOrCreateIdentity,
  ledgerEntryBelongsToHousehold,
  listBriefings,
  listFollowups,
  markBriefingRead,
  memoryBelongsToHousehold,
  patchIdentity,
} from '../services/aihousekeeper/route-service';
import { HouseholdService } from '../services/household-service';
import type { Env } from '../types';
import { NotFoundError, ValidationError } from '../utils/errors';
import { now as nowIso } from '../utils/id';

const aihousekeeper = new Hono<{ Bindings: Env }>();

// All Aihousekeeper routes require authentication.
aihousekeeper.use('/*', authMiddleware());

// ---------- helpers ----------

function getHouseholdId(c: {
  req: { param: (k: string) => string | undefined };
}): string {
  const hid = c.req.param('householdId');
  if (!hid) {
    throw new ValidationError({ householdId: ['missing householdId param'] });
  }
  return hid;
}

// ---------- validators ----------

const TIME_HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
// Minimal IANA-style sanity check. Accepts strings like "UTC", "America/New_York",
// "Europe/London", "Etc/GMT+5". More strict validation happens at render time
// via Intl.DateTimeFormat throwing on bad zones.
const TIMEZONE_REGEX = /^[A-Za-z_]+(?:\/[A-Za-z_+-]+)*$/;

const ALLOWED_TONES = ['warm_brief', 'direct', 'playful'] as const;

const identityPatchSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    tone: z.enum(ALLOWED_TONES).optional(),
    pronouns: z.string().max(40).nullable().optional(),
    briefing_time: z
      .string()
      .regex(TIME_HHMM, 'briefing_time must be HH:MM')
      .optional(),
    quiet_hours_start: z
      .string()
      .regex(TIME_HHMM, 'quiet_hours_start must be HH:MM')
      .optional(),
    quiet_hours_end: z
      .string()
      .regex(TIME_HHMM, 'quiet_hours_end must be HH:MM')
      .optional(),
    daily_interrupt_budget: z.number().int().min(0).max(20).optional(),
    channels_enabled_json: z.string().optional(),
    timezone: z
      .string()
      .regex(TIMEZONE_REGEX, 'timezone must be an IANA identifier')
      .optional(),
  })
  .strict();

const memoryListQuerySchema = z.object({
  type: z
    .enum(['fact', 'preference', 'history', 'decision', 'unresolved_question'])
    .optional(),
  q: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const trustLedgerListQuerySchema = z.object({
  since: z.string().datetime().optional(),
  category: z
    .enum([
      'decision',
      'message_sent',
      'task_changed',
      'memory_added',
      'followup_scheduled',
      'assignment',
    ])
    .optional(),
  includeDismissed: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const followupListQuerySchema = z.object({
  status: z.enum(['pending', 'fired', 'cancelled', 'skipped']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// ============================================================================
// BRIEFINGS
// ============================================================================

/**
 * GET /briefings — list briefings for this household, newest first, cap 30.
 */
aihousekeeper.get('/briefings', rateLimitDO('aihousekeeper:read'), async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  const rows = await listBriefings(c.env.DB, householdId);
  return c.json({ briefings: rows });
});

/**
 * GET /weather — the household's current weather for the Home tile, via WeatherKit
 * (backend/src/services/weather-service.ts). Returns `{ weather: null }` when
 * WeatherKit isn't configured or the household has no usable location.
 */
aihousekeeper.get('/weather', rateLimitDO('aihousekeeper:read'), async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  const weather = await getBriefingWeather(c.env, householdId);
  return c.json({ weather });
});

/**
 * GET /home-insight — the single most important, actionable thing about the
 * home right now, composed for the Home hero banner.
 *
 * Deterministic (no per-request AI call): gathers cross-domain signals (tasks,
 * bills, property tax, garbage, budget), ranks them by urgency, and returns one
 * fully-composed insight (headline + Mira-voice message + tone + due/days
 * counter + a single deep-link CTA) plus up to 3 secondary chips.
 *
 * `?tz=` — IANA zone from the client (device zone) so the greeting and
 * "days until due" are computed in the household's local day. Falls back to the
 * assistant identity timezone, then UTC.
 */
aihousekeeper.get('/home-insight', rateLimitDO('aihousekeeper:read'), async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  const tz = c.req.query('tz') || undefined;
  const insight = await getHomeInsight(c.env, householdId, userId, tz);
  return c.json({ insight });
});

/**
 * GET /briefings/:date — single briefing (404 if absent).
 */
aihousekeeper.get('/briefings/:date', rateLimitDO('aihousekeeper:read'), async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const date = c.req.param('date')!;
  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  const row = await getBriefing(c.env.DB, householdId, date);
  return c.json({ briefing: row });
});

/**
 * POST /briefings/:date/read — set `read_at = now()`.
 */
aihousekeeper.post('/briefings/:date/read', rateLimitDO('aihousekeeper:default'), async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const date = c.req.param('date')!;
  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  await markBriefingRead(c.env.DB, householdId, date);
  return c.json({ ok: true });
});

// ============================================================================
// IDENTITY
// ============================================================================

/**
 * GET /identity — single assistant_identity row.
 */
aihousekeeper.get('/identity', rateLimitDO('aihousekeeper:read'), async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  const row = await getOrCreateIdentity(c.env.DB, householdId);
  return c.json({ identity: row });
});

/**
 * PATCH /identity — update any subset of persona/schedule fields.
 */
aihousekeeper.patch(
  '/identity',
  rateLimitDO('aihousekeeper:default'),
  zValidator('json', identityPatchSchema),
  async (c) => {
    const householdId = getHouseholdId(c);
    const userId = c.get('userId');
    const input = c.req.valid('json');
    const householdService = new HouseholdService(c.env, c.env.DB);
    await householdService.getHousehold(householdId, userId);

    // Defense in depth: validate timezone via Intl so a pattern-matching but
    // bogus value (e.g. "Foo/Bar") still gets rejected.
    if (input.timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: input.timezone });
      } catch {
        throw new ValidationError({
          timezone: ['Unknown IANA timezone'],
        });
      }
    }

    const update: Record<string, unknown> = { updated_at: nowIso() };
    if (input.name !== undefined) update.name = input.name;
    if (input.tone !== undefined) update.tone = input.tone;
    if (input.pronouns !== undefined) update.pronouns = input.pronouns;
    if (input.briefing_time !== undefined)
      update.briefing_time = input.briefing_time;
    if (input.quiet_hours_start !== undefined)
      update.quiet_hours_start = input.quiet_hours_start;
    if (input.quiet_hours_end !== undefined)
      update.quiet_hours_end = input.quiet_hours_end;
    if (input.daily_interrupt_budget !== undefined)
      update.daily_interrupt_budget = input.daily_interrupt_budget;
    if (input.channels_enabled_json !== undefined)
      update.channels_enabled_json = input.channels_enabled_json;
    if (input.timezone !== undefined) update.timezone = input.timezone;

    const row = await patchIdentity(c.env.DB, householdId, update);
    return c.json({ identity: row });
  }
);

// ============================================================================
// MEMORY
// ============================================================================

/**
 * GET /memory?type=&q=&limit= — list / search memories.
 *
 * When `q` is supplied we use MemoryService.recall (FTS5 pass). Otherwise we
 * do a paged list via MemoryService.list. We surface `redacted_body` on every
 * row so the UI can show a PII-safe preview; callers inside the household
 * still see `body` for full-fidelity detail.
 */
aihousekeeper.get(
  '/memory',
  rateLimitDO('aihousekeeper:read'),
  zValidator('query', memoryListQuerySchema),
  async (c) => {
    const householdId = getHouseholdId(c);
    const userId = c.get('userId');
    const { type, q, limit } = c.req.valid('query');
    const householdService = new HouseholdService(c.env, c.env.DB);
    await householdService.getHousehold(householdId, userId);

    const { apiKey: anthropicKey } = await resolveProviderApiKey(c.env, userId, 'anthropic');
    const { memory } = buildAihousekeeperStack(c.env, anthropicKey, { householdId, userId });

    if (q) {
      const results = await memory.recall(householdId, q, limit ?? 20);
      return c.json({ memories: results, via: 'fts' });
    }
    const results = await memory.list(householdId, {
      type: type as MemoryType | undefined,
      limit: limit ?? 50,
    });
    return c.json({ memories: results, via: 'list' });
  }
);

/**
 * DELETE /memory/:id — forget (hard-delete) a memory.
 */
aihousekeeper.delete('/memory/:id', rateLimitDO('aihousekeeper:default'), async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const id = c.req.param('id')!;
  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  if (!(await memoryBelongsToHousehold(c.env.DB, householdId, id))) {
    throw new NotFoundError('Memory');
  }

  // forget() is a pure delete — no AI provider call — so no BYOK key needed.
  const { memory } = buildAihousekeeperStack(c.env, undefined, { householdId, userId });
  await memory.forget(id, 'user_requested_delete');
  return c.json({ ok: true });
});

// ============================================================================
// TRUST LEDGER
// ============================================================================

/**
 * GET /trust-ledger?since=&category=&includeDismissed=
 */
aihousekeeper.get(
  '/trust-ledger',
  rateLimitDO('aihousekeeper:read'),
  zValidator('query', trustLedgerListQuerySchema),
  async (c) => {
    const householdId = getHouseholdId(c);
    const userId = c.get('userId');
    const { since, category, includeDismissed, limit } = c.req.valid('query');
    const householdService = new HouseholdService(c.env, c.env.DB);
    await householdService.getHousehold(householdId, userId);

    const { ledger } = buildAihousekeeperStack(c.env, undefined, { householdId, userId });
    const entries = await ledger.list(householdId, {
      since,
      category,
      includeDismissed,
      limit,
    });
    return c.json({ entries });
  }
);

/**
 * POST /trust-ledger/:id/dismiss — mark a ledger row as dismissed.
 */
aihousekeeper.post(
  '/trust-ledger/:id/dismiss',
  rateLimitDO('aihousekeeper:default'),
  async (c) => {
    const householdId = getHouseholdId(c);
    const userId = c.get('userId');
    const id = c.req.param('id')!;
    const householdService = new HouseholdService(c.env, c.env.DB);
    await householdService.getHousehold(householdId, userId);

    if (!(await ledgerEntryBelongsToHousehold(c.env.DB, householdId, id))) {
      throw new NotFoundError('Ledger entry');
    }

    const { ledger } = buildAihousekeeperStack(c.env, undefined, { householdId, userId });
    await ledger.dismiss(id);
    return c.json({ ok: true });
  }
);

/**
 * POST /trust-ledger/:id/undo — attempt to reverse a reversible ledger action.
 */
aihousekeeper.post('/trust-ledger/:id/undo', rateLimitDO('aihousekeeper:default'), async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const id = c.req.param('id')!;
  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  if (!(await ledgerEntryBelongsToHousehold(c.env.DB, householdId, id))) {
    throw new NotFoundError('Ledger entry');
  }

  const { ledger } = buildAihousekeeperStack(c.env, undefined, { householdId, userId });
  const result = await ledger.undo(id);
  return c.json(result);
});

// ============================================================================
// FOLLOWUPS
// ============================================================================

/**
 * GET /followups?status= — list followups (defaults to all statuses).
 */
aihousekeeper.get(
  '/followups',
  rateLimitDO('aihousekeeper:read'),
  zValidator('query', followupListQuerySchema),
  async (c) => {
    const householdId = getHouseholdId(c);
    const userId = c.get('userId');
    const { status, limit } = c.req.valid('query');
    const householdService = new HouseholdService(c.env, c.env.DB);
    await householdService.getHousehold(householdId, userId);

    const rows = await listFollowups(c.env.DB, householdId, status, limit);
    return c.json({ followups: rows });
  }
);

/**
 * POST /followups/:id/cancel — mark a pending followup cancelled and emit
 * a decision_made event for the trust ledger.
 */
aihousekeeper.post('/followups/:id/cancel', rateLimitDO('aihousekeeper:default'), async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const id = c.req.param('id')!;
  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  const result = await cancelFollowup(c.env, householdId, id);
  if (!result.ok) {
    return c.json(result.body, result.status as 409);
  }
  return c.json({ ok: true });
});

// ============ APPROVALS (HIGH_WRITE tool parking — v1.2 ADR-32) ============

/**
 * GET /approvals?status=&limit=
 *
 * List parked HIGH_WRITE tool invocations for the current household. Defaults
 * to `status='pending'`. The UX surfaces these as approval cards.
 */
aihousekeeper.get(
  '/approvals',
  rateLimitDO('aihousekeeper:read'),
  zValidator(
    'query',
    z.object({
      status: z
        .enum(['pending', 'approved', 'cancelled', 'executed', 'expired', 'failed'])
        .optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    })
  ),
  async (c) => {
    const householdId = getHouseholdId(c);
    const userId = c.get('userId');
    const householdService = new HouseholdService(c.env, c.env.DB);
    await householdService.getHousehold(householdId, userId);

    const opts = c.req.valid('query');
    const approvals = new ApprovalQueueShim(c.env.DB);
    const rows = await approvals.list(householdId, {
      status: (opts.status as AIToolPendingStatus | undefined) ?? 'pending',
      limit: opts.limit,
    });
    return c.json({ approvals: rows });
  }
);

/**
 * POST /approvals/:id/approve — user approves a parked tool invocation.
 *
 * 1. Flip status to 'approved'.
 * 2. Dispatch to the per-tool executor (`approval-executor.ts`) keyed on
 *    tool_name. Executor performs the actual mutation (task assignment,
 *    SMS send, email send, quote fan-out).
 * 3. Record outcome via `ApprovalQueueShim.markExecuted(pendingId, outcome)`
 *    — status becomes 'executed' on success or 'failed' on error.
 *
 * The route returns BOTH the final approval row AND the execution outcome,
 * so the client can show success/error detail without a second round-trip.
 */
aihousekeeper.post('/approvals/:id/approve', rateLimitDO('aihousekeeper:default'), async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const id = c.req.param('id')!;
  if (!id) throw new ValidationError({ id: ['missing approval id param'] });
  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  const approvals = new ApprovalQueueShim(c.env.DB);
  const existing = await approvals.get(id);
  if (!existing) throw new NotFoundError('Approval');
  if (existing.household_id !== householdId) {
    // Cross-household access — treat as not found to avoid leaking existence.
    throw new NotFoundError('Approval');
  }

  // Idempotency for queued tools: a network retry of the approve POST after
  // the first call succeeded must not 409. If the row is already 'approved'
  // for a tool whose execution was deferred to a queue, return the same
  // queued shape the original call returned. The queue consumer will still
  // mark the row terminal when it finishes.
  if (existing.status === 'approved' && isQueuedTool(existing.tool_name)) {
    return c.json({
      approval: existing,
      execution: {
        ok: true,
        queued: true,
        result: parseQueuedExecutionResult(existing),
      },
    });
  }

  // If the row already reached a terminal state, return the recorded outcome
  // instead of 409 so the client can display the result without a follow-up
  // GET.
  if (existing.status === 'executed') {
    return c.json({
      approval: existing,
      execution: parseExecutedOutcome(existing),
    });
  }
  if (existing.status === 'failed') {
    return c.json({
      approval: existing,
      execution: {
        ok: false,
        error: existing.execution_error ?? 'execution_failed',
      },
    });
  }
  if (existing.status !== 'pending') {
    return c.json(
      {
        error: {
          code: 'conflict',
          message: `Approval is already ${existing.status}`,
        },
      },
      409
    );
  }

  const approved = await approvals.approve(id, userId);

  // Dispatch the mutation. Failures are captured by the executor and fed
  // into `markExecuted` so the final queue row reflects the outcome.
  //
  // Special case: when `outcome.queued` is true, execution was deferred to a
  // Cloudflare Queue (currently `create_garden_site_plan`) and the queue
  // consumer will call `markExecuted` itself when the async job finishes.
  // The row stays in 'approved' until then, surfacing 'queued' to the client.
  const outcome = await executeApproved(
    {
      id: existing.id,
      household_id: existing.household_id,
      user_id: existing.user_id,
      tool_name: existing.tool_name,
      input_json: existing.input_json,
    },
    c.env
  );
  if (!(outcome.ok && outcome.queued)) {
    await approvals.markExecuted(id, outcome);
  }

  // Re-fetch the row so the returned status reflects the latest state
  // ('executed' / 'failed' for sync paths, 'approved' for queued paths).
  const finalRow = await approvals.get(id);
  return c.json({
    approval: finalRow ?? approved,
    execution: outcome,
  });
});

/**
 * Tools whose `executeApproved` returns `queued: true` and defer the
 * terminal state-write to a queue consumer. Callers MUST update this list
 * when adding more async tools so the approve route remains idempotent.
 */
function isQueuedTool(toolName: string): boolean {
  return toolName === 'create_garden_site_plan';
}

function parseQueuedExecutionResult(
  row: AIToolPending
): Record<string, unknown> {
  try {
    const input = JSON.parse(row.input_json) as Record<string, unknown>;
    return {
      queued: true,
      area_label: typeof input.area_label === 'string' ? input.area_label : undefined,
      plan_type: typeof input.plan_type === 'string' ? input.plan_type : undefined,
    };
  } catch {
    return { queued: true };
  }
}

function parseExecutedOutcome(
  row: AIToolPending
):
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string } {
  try {
    const result = row.execution_result_json
      ? (JSON.parse(row.execution_result_json) as Record<string, unknown>)
      : {};
    return { ok: true, result };
  } catch {
    return { ok: true, result: {} };
  }
}

/**
 * POST /approvals/:id/cancel — user dismisses a parked tool invocation.
 */
aihousekeeper.post('/approvals/:id/cancel', rateLimitDO('aihousekeeper:default'), async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const id = c.req.param('id')!;
  if (!id) throw new ValidationError({ id: ['missing approval id param'] });
  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  const approvals = new ApprovalQueueShim(c.env.DB);
  const existing = await approvals.get(id);
  if (!existing) throw new NotFoundError('Approval');
  if (existing.household_id !== householdId) {
    throw new NotFoundError('Approval');
  }
  if (existing.status !== 'pending') {
    return c.json(
      {
        error: {
          code: 'conflict',
          message: `Approval is already ${existing.status}`,
        },
      },
      409
    );
  }

  const updated = await approvals.cancel(id, userId);
  return c.json({ approval: updated });
});

export default aihousekeeper;
