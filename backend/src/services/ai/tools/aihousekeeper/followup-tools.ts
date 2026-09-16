/**
 * Aihousekeeper followup tools — plan §4 / §C2.
 *
 * - schedule_self_followup(at, prompt, context_ref?)  → LOW_WRITE
 * - cancel_followup(followup_id, reason)              → LOW_WRITE
 *
 * Writes to `assistant_followups`. The cron-driven `FollowupRunner` (§B7) is
 * the consumer; it polls rows where `status='pending' AND scheduled_for <=
 * now()` on each tick.
 *
 * Scoped to chat modes: task_assistant, morning_briefing.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { assistantFollowups } from '../../../../db/schema-aihousekeeper';
import { generateId, now as nowIso } from '../../../../utils/id';
import { sha256Hex } from '../../../aihousekeeper/event-bus';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

// ============ schedule_self_followup ============

export const scheduleSelfFollowup: AihousekeeperTool = {
  name: 'schedule_self_followup',
  kind: 'LOW_WRITE',
  description:
    'Ask Aihousekeeper to re-engage at a future time (e.g. "check back next Tuesday about the water heater"). Produces one `assistant_followups` row.',
  input: z.object({
    at: z
      .string()
      .datetime({ offset: true })
      .describe('ISO-8601 UTC timestamp when the followup should fire'),
    prompt: z.string().min(1).max(2000),
    context_ref: z
      .record(z.unknown())
      .optional()
      .describe('Optional JSON blob captured for the runner (task_id, memory_id, etc.)'),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    await ctx.householdService.getHousehold(ctx.householdId, ctx.userId);

    // Reject past-dated schedules — the runner would fire on the very next
    // tick and a mis-timed followup is almost certainly an LLM hallucination.
    const scheduledAt = new Date(input.at);
    if (Number.isNaN(scheduledAt.getTime())) {
      return { ok: false, error: 'invalid_at_timestamp' };
    }
    if (scheduledAt.getTime() <= Date.now()) {
      return { ok: false, error: 'scheduled_for_must_be_in_future' };
    }

    const id = generateId();
    const ts = nowIso();
    await ctx.db.insert(assistantFollowups).values({
      id,
      household_id: ctx.householdId,
      scheduled_for: scheduledAt.toISOString(),
      prompt: input.prompt,
      context_ref_json: input.context_ref ? JSON.stringify(input.context_ref) : null,
      origin: 'self_scheduled',
      status: 'pending',
      created_at: ts,
      updated_at: ts,
    });

    const idem = await sha256Hex(`followup_scheduled:${id}`);
    await ctx.events.emit({
      kind: 'followup_scheduled',
      householdId: ctx.householdId,
      eventIdempotencyKey: idem,
      followupId: id,
      scheduledFor: scheduledAt.toISOString(),
    });

    return {
      ok: true,
      followup_id: id,
      scheduled_for: scheduledAt.toISOString(),
    };
  },
};

// ============ cancel_followup ============

export const cancelFollowup: AihousekeeperTool = {
  name: 'cancel_followup',
  kind: 'LOW_WRITE',
  description:
    'Cancel a pending followup. No-ops if the followup is already fired, cancelled, or skipped.',
  input: z.object({
    followup_id: z.string().min(1),
    reason: z.string().min(1).max(500),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    await ctx.householdService.getHousehold(ctx.householdId, ctx.userId);

    // Scope the UPDATE to THIS household + pending status. A cross-household
    // id would simply not match and we return a predictable error.
    const existing = await ctx.db
      .select({
        id: assistantFollowups.id,
        status: assistantFollowups.status,
      })
      .from(assistantFollowups)
      .where(
        and(
          eq(assistantFollowups.id, input.followup_id),
          eq(assistantFollowups.household_id, ctx.householdId)
        )
      )
      .get();
    if (!existing) {
      return { ok: false, error: 'followup_not_found' };
    }
    if (existing.status !== 'pending') {
      return {
        ok: false,
        error: `followup_not_pending`,
        current_status: existing.status,
      };
    }

    const ts = nowIso();
    await ctx.db
      .update(assistantFollowups)
      .set({
        status: 'cancelled',
        updated_at: ts,
        outcome_json: JSON.stringify({ cancelled_reason: input.reason, by: 'tool:cancel_followup' }),
      })
      .where(eq(assistantFollowups.id, input.followup_id));

    const idem = await sha256Hex(`followup_cancelled:${input.followup_id}`);
    await ctx.events.emit({
      kind: 'decision_made',
      householdId: ctx.householdId,
      eventIdempotencyKey: idem,
      summary: `Followup ${input.followup_id.slice(0, 8)}… cancelled`,
      rationale: input.reason.slice(0, 200),
      reversible: false,
    });

    return { ok: true, followup_id: input.followup_id, status: 'cancelled' };
  },
};

export const followupTools: readonly AihousekeeperTool[] = [
  scheduleSelfFollowup,
  cancelFollowup,
] as const;
