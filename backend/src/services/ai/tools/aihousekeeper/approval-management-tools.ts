/**
 * Approval-management tools — let Mira read and cancel her own parked
 * approvals via chat instead of redirecting users to the approvals screen
 * for every action.
 *
 * Why these exist: the screenshot bug at 2:46 PM showed Mira saying "I'm
 * canceling both approvals" while she had no tool to actually do it. Users
 * who say "I don't see approvals" or "cancel that" expect Mira to either
 * (a) tell them what's actually pending, or (b) cancel it. Without these
 * tools, Mira either hallucinates or punts.
 *
 * Tools:
 *   - `list_pending_approvals` (READ): Snapshot of currently-pending parked
 *     tool invocations for the household. Mira calls this when the user
 *     says "what's pending", "I don't see approvals", or "cancel that".
 *   - `cancel_pending_approval` (LOW_WRITE): Flip a single pending row to
 *     'cancelled'. Reversible — no external side-effects fire because the
 *     approval never executed. Refunds the daily counter for
 *     `create_garden_site_plan` since that's the only tool that consumes
 *     quota at park time (currently it doesn't, but the cancel path is
 *     symmetric with the route handler for consistency).
 *
 * Security: both tools are scoped by `ctx.householdId` — Mira cannot read
 * or cancel approvals belonging to another household even if the model
 * ever fabricates an id. Cross-household ids return `not_found`.
 *
 * NOT included: approve_pending_approval. Approving a HIGH_WRITE action is
 * the security guardrail; it must remain a deliberate, explicit user
 * gesture in the approvals screen, never something the LLM can trigger
 * from chat.
 */

import { z } from 'zod';

import { sha256Hex } from '../../../aihousekeeper/event-bus';
import { ApprovalQueueShim } from '../../approval-queue-shim';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

// Number of pending rows the model is allowed to see in one call. Anthropic
// pricing makes huge tool results expensive, and 20 covers every realistic
// household — anything more is almost certainly a runaway agent.
const MAX_LIST_LIMIT = 20;

/**
 * Parse `input_json` defensively. The store is plain text; a hand-edited
 * row could leave invalid JSON in there. Treat that as an empty object so
 * we don't crash the chat turn for a single bad row.
 */
function safeParseInput(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Project a parked row to the minimum shape Mira needs to talk about it
 * without leaking implementation details (no idempotency keys, no expiry
 * timestamps the user wouldn't recognize).
 */
function projectPending(row: {
  id: string;
  tool_name: string;
  input_json: string;
  created_at: string;
}): {
  pending_id: string;
  tool_name: string;
  summary: string;
  created_at: string;
} {
  const input = safeParseInput(row.input_json);
  return {
    pending_id: row.id,
    tool_name: row.tool_name,
    summary: summarizeParkedTool(row.tool_name, input),
    created_at: row.created_at,
  };
}

/**
 * Human-readable summary of a parked tool invocation. Pulls the most
 * recognizable field out of the tool input so Mira can say "Front yard
 * garden plan (parked 2 min ago)" rather than "tool invocation #abc".
 */
function summarizeParkedTool(
  toolName: string,
  input: Record<string, unknown>
): string {
  switch (toolName) {
    case 'create_garden_site_plan': {
      const label = typeof input.area_label === 'string' ? input.area_label : null;
      const planType = typeof input.plan_type === 'string' ? input.plan_type : null;
      if (label && planType) return `${label} (${planType.replace(/_/g, ' ')})`;
      if (label) return label;
      if (planType) return planType.replace(/_/g, ' ');
      return 'Garden site plan';
    }
    case 'assign_task_to_member': {
      const title = typeof input.task_title === 'string' ? input.task_title : null;
      return title ? `Assign task: ${title}` : 'Assign task to member';
    }
    case 'send_sms_to_contractor':
      return 'Send SMS to contractor';
    case 'send_email_to_contractor':
      return 'Send email to contractor';
    case 'request_quotes_from_saved_contractors':
      return 'Request quotes from contractors';
    case 'invite_household_member': {
      const email = typeof input.email === 'string' ? input.email : null;
      return email ? `Invite ${email} to household` : 'Invite household member';
    }
    case 'delete_household_property': {
      const name = typeof input.property_name === 'string' ? input.property_name : null;
      return name ? `Delete property: ${name}` : 'Delete property';
    }
    case 'open_manage_subscription':
      return 'Explain how to manage Apple subscription';
    case 'classify_and_save_attachment': {
      const kind = typeof input.kind === 'string' ? input.kind : null;
      return kind ? `Save attachment as ${kind}` : 'Save attachment';
    }
    default:
      return toolName.replace(/_/g, ' ');
  }
}

// ============ list_pending_approvals ============

export const listPendingApprovals: AihousekeeperTool = {
  name: 'list_pending_approvals',
  kind: 'READ',
  description:
    "List parked HIGH_WRITE tool invocations awaiting the user's approval in this household. Use when the user asks 'what's pending', 'what am I waiting on', 'I don't see approvals', or 'cancel that' (so you know which pending_id to cancel). Returns id, tool name, a short human summary, and created_at. Returns an empty array when nothing is pending — say so honestly rather than guessing.",
  input: z.object({}),
  async execute(ctx: AihousekeeperToolContext, _input): Promise<ToolResult> {
    const approvals = new ApprovalQueueShim(ctx.env.DB);
    const rows = await approvals.list(ctx.householdId, {
      status: 'pending',
      limit: MAX_LIST_LIMIT,
    });
    return {
      ok: true,
      pending_approvals: rows.map(projectPending),
      count: rows.length,
    };
  },
};

// ============ cancel_pending_approval ============

export const cancelPendingApproval: AihousekeeperTool = {
  name: 'cancel_pending_approval',
  kind: 'LOW_WRITE',
  description:
    "Cancel a single parked tool invocation that hasn't been approved yet. Use when the user says 'cancel the front yard plan', 'never mind, drop that', or 'cancel both'. Always call list_pending_approvals first to discover the pending_id (the user never knows ids). Returns 'not_found' if the id doesn't belong to this household; returns 'not_pending' with the current status if the row was already approved/cancelled/executed. Reversible from the user's perspective — the tool just never runs.",
  input: z.object({
    pending_id: z
      .string()
      .min(1)
      .describe(
        "The ai_tool_pending row id from list_pending_approvals. Never invent — always look it up first."
      ),
    reason: z
      .string()
      .min(1)
      .max(300)
      .optional()
      .describe(
        'Short reason captured in the audit ledger ("user changed mind", "wrong plan_type"). Defaults to "Cancelled via chat".'
      ),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const approvals = new ApprovalQueueShim(ctx.env.DB);

    // Cross-household scoping: re-fetch and verify household_id BEFORE the
    // mutation. ApprovalQueueShim.cancel doesn't check household membership
    // (the route handler does) — we have to enforce it here so a fabricated
    // id can't reach into another household's approval queue.
    const existing = await approvals.get(input.pending_id);
    if (!existing || existing.household_id !== ctx.householdId) {
      return { ok: false, error: 'not_found' };
    }
    if (existing.status !== 'pending') {
      return {
        ok: false,
        error: 'not_pending',
        current_status: existing.status,
        tool_name: existing.tool_name,
      };
    }

    const updated = await approvals.cancel(input.pending_id, ctx.userId);
    if (!updated) {
      // Race: row vanished between get() and cancel() — shouldn't happen
      // in production but the API contract allows null.
      return { ok: false, error: 'not_found' };
    }

    // Ledger row so cancellation appears in the audit feed alongside other
    // user decisions. `reversible: false` because the user can always re-
    // park the same action by asking again — the cancel itself isn't undone
    // by a single tool call.
    try {
      const idem = await sha256Hex(
        `approval_cancelled_via_chat:${input.pending_id}`
      );
      await ctx.events.emit({
        kind: 'decision_made',
        householdId: ctx.householdId,
        eventIdempotencyKey: idem,
        summary: `Cancelled pending: ${summarizeParkedTool(
          existing.tool_name,
          safeParseInput(existing.input_json)
        )}`,
        rationale: (input.reason ?? 'Cancelled via chat').slice(0, 200),
        reversible: false,
      });
    } catch (ledgerErr) {
      // Ledger failure is non-fatal — the cancel already committed.
      console.warn('[approval-management] ledger emit failed', {
        pendingId: input.pending_id,
        error: (ledgerErr as Error).message,
      });
    }

    return {
      ok: true,
      pending_id: input.pending_id,
      tool_name: existing.tool_name,
      status: 'cancelled',
    };
  },
};

export const approvalManagementTools: readonly AihousekeeperTool[] = [
  listPendingApprovals,
  cancelPendingApproval,
] as const;
