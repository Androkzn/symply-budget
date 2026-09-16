/**
 * Aihousekeeper assign-task tool — plan §4 / §C5.
 *
 * assign_task_to_member(task_id, member_id?, reason?) → HIGH_WRITE
 *
 * The plan's example pseudocode runs synchronously (assign then push). Per
 * Stream C's instructions: HIGH_WRITE tools MUST NOT mutate directly — they
 * park via `ApprovalQueueShim.park(...)`. The real approval flow mutates the
 * task and dispatches the push after the user approves. This tool's
 * responsibility is therefore:
 *
 *   1. Verify household membership + task ownership.
 *   2. Resolve the target member (explicit, else FamilyRouter).
 *   3. Verify that member is in THIS household.
 *   4. Park the intent with a deterministic idempotency key.
 *
 * Scoped to chat modes: task_assistant, family_chat.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { householdMembers, tasks } from '../../../../db/schema';
import { sha256Hex } from '../../../aihousekeeper/event-bus';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

export const assignTaskToMember: AihousekeeperTool = {
  name: 'assign_task_to_member',
  kind: 'HIGH_WRITE',
  description:
    'Assign a task to a household member. If member_id is omitted, FamilyRouter picks the best candidate based on responsibilities. Parks for user approval; the approval flow performs the actual assignment and sends a push to the assignee.',
  input: z.object({
    task_id: z.string().min(1),
    member_id: z.string().min(1).optional(),
    reason: z.string().max(500).optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    await ctx.householdService.getHousehold(ctx.householdId, ctx.userId);

    // Verify the task belongs to this household.
    const task = await ctx.db
      .select({
        id: tasks.id,
        title: tasks.title,
        system_category: tasks.system_category,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, input.task_id),
          eq(tasks.household_id, ctx.householdId)
        )
      )
      .get();
    if (!task) {
      return { ok: false, error: 'task_not_found' };
    }

    // Resolve target member. Explicit id wins; else FamilyRouter.
    let memberId: string;
    let routingReason: string;
    if (input.member_id) {
      const m = await ctx.db
        .select({ id: householdMembers.id })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.id, input.member_id),
            eq(householdMembers.household_id, ctx.householdId),
            isNull(householdMembers.deleted_at)
          )
        )
        .get();
      if (!m) {
        return { ok: false, error: 'member_not_found' };
      }
      memberId = input.member_id;
      routingReason = input.reason ?? 'Explicit assignment';
    } else {
      if (!task.system_category) {
        return {
          ok: false,
          error: 'no_category_for_routing',
          hint: 'Provide member_id explicitly, or add a system_category to the task first.',
        };
      }
      try {
        const pick = await ctx.familyRouter.pickAssignee(
          ctx.householdId,
          task.system_category
        );
        memberId = pick.memberId;
        routingReason =
          input.reason ??
          `FamilyRouter (${pick.confidence.toFixed(2)}): ${pick.reason}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'routing_failed';
        return { ok: false, error: 'routing_failed', detail: message };
      }
    }

    // Park for approval. The approval handler (not this tool) will:
    //   - UPDATE maintenance_tasks.assigned_to = user_id(memberId)
    //   - Dispatch the 'task_assigned' push via OutboundDispatcher
    //   - Emit `task_assigned` on the event bus
    const idempotencyKey = await sha256Hex(
      `assign_task:${ctx.householdId}:${input.task_id}:${memberId}`
    );
    const parked = await ctx.approvalQueue.park({
      householdId: ctx.householdId,
      userId: ctx.userId,
      toolName: 'assign_task_to_member',
      input: {
        task_id: input.task_id,
        member_id: memberId,
        reason: routingReason,
        task_title: task.title,
      },
      idempotencyKey,
    });

    return {
      ok: true,
      pending_id: parked.pendingId,
      status: 'parked_for_approval',
      queue_status: parked.status,
      task_id: input.task_id,
      member_id: memberId,
      reason: routingReason,
    };
  },
};

export const assignTools: readonly AihousekeeperTool[] = [assignTaskToMember] as const;
