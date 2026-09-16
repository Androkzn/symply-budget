/**
 * Aihousekeeper delegation tools — plan §4 / §C3.
 *
 * Contractor messaging tools (email + quote batch). Server-side SMS was removed;
 * users can still open native `sms:` links from the mobile contractor UI.
 *
 *   draft_email_to_contractor  → LOW_WRITE
 *   send_email_to_contractor   → HIGH_WRITE (parks)
 *   request_quotes_from_saved_contractors → HIGH_WRITE (single batch park)
 *   forward_briefing_to        → LOW_WRITE  (push/email via dispatcher)
 *
 * HIGH_WRITE paths park via `ApprovalQueueShim`.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { householdMembers, users } from '../../../../db/schema';
import { contractors } from '../../../../db/schema-contractors';
import { pushTokens } from '../../../../db/schema-notifications';
import { generateId, nowIso } from '../../../../utils/id';
import { sha256Hex } from '../../../aihousekeeper/event-bus';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

function draftId(): string {
  return `draft-${generateId()}`;
}

async function verifyContractor(
  ctx: AihousekeeperToolContext,
  contractorId: string
): Promise<
  | { ok: true; row: typeof contractors.$inferSelect }
  | { ok: false; error: 'contractor_not_found' }
> {
  const row = await ctx.db
    .select()
    .from(contractors)
    .where(
      and(
        eq(contractors.id, contractorId),
        eq(contractors.household_id, ctx.householdId)
      )
    )
    .get();
  if (!row) return { ok: false, error: 'contractor_not_found' };
  return { ok: true, row };
}

// ============ draft_email_to_contractor ============

export const draftEmailToContractor: AihousekeeperTool = {
  name: 'draft_email_to_contractor',
  kind: 'LOW_WRITE',
  description:
    'Draft an email to a saved contractor. Does NOT send. Returns a draft_id for a subsequent send_email_to_contractor call.',
  input: z.object({
    contractor_id: z.string().min(1),
    intent: z.string().min(1).max(4000),
    context_refs: z.array(z.string()).max(10).optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    await ctx.householdService.getHousehold(ctx.householdId, ctx.userId);
    const c = await verifyContractor(ctx, input.contractor_id);
    if (!c.ok) return { ok: false, error: c.error };
    if (!c.row.email) {
      return { ok: false, error: 'contractor_has_no_email' };
    }

    const id = draftId();
    const idem = await sha256Hex(`delegation_drafted:email:${id}`);
    await ctx.events.emit({
      kind: 'delegation_drafted',
      householdId: ctx.householdId,
      eventIdempotencyKey: idem,
      tool: 'draft_email_to_contractor',
      draftId: id,
    });

    return {
      ok: true,
      draft_id: id,
      channel: 'email',
      contractor_id: input.contractor_id,
      contractor_name: c.row.name,
      contractor_email: c.row.email,
      intent: input.intent,
      context_refs: input.context_refs ?? [],
    };
  },
};

// ============ send_email_to_contractor ============

export const sendEmailToContractor: AihousekeeperTool = {
  name: 'send_email_to_contractor',
  kind: 'HIGH_WRITE',
  description:
    'Send a previously-drafted email. Parks for user approval before any outbound call.',
  input: z.object({
    draft_id: z.string().min(1),
    contractor_id: z.string().min(1),
    subject: z.string().min(1).max(255),
    body_html: z.string().min(1).max(50_000),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    await ctx.householdService.getHousehold(ctx.householdId, ctx.userId);
    const c = await verifyContractor(ctx, input.contractor_id);
    if (!c.ok) return { ok: false, error: c.error };
    if (!c.row.email) {
      return { ok: false, error: 'contractor_has_no_email' };
    }

    const idempotencyKey = await sha256Hex(
      `send_email:${ctx.householdId}:${input.draft_id}:${input.contractor_id}`
    );
    const parked = await ctx.approvalQueue.park({
      householdId: ctx.householdId,
      userId: ctx.userId,
      toolName: 'send_email_to_contractor',
      input: {
        draft_id: input.draft_id,
        contractor_id: input.contractor_id,
        subject: input.subject,
        body_html: input.body_html,
      },
      idempotencyKey,
    });

    return {
      ok: true,
      pending_id: parked.pendingId,
      status: 'parked_for_approval',
      queue_status: parked.status,
    };
  },
};

// ============ request_quotes_from_saved_contractors ============

export const requestQuotesFromSavedContractors: AihousekeeperTool = {
  name: 'request_quotes_from_saved_contractors',
  kind: 'HIGH_WRITE',
  description:
    'Fan out a quote request to every saved contractor with an email address matching a category. Parks a SINGLE batch approval (not N approvals).',
  input: z.object({
    category: z.string().min(1).max(64),
    scope: z.string().min(1).max(4000),
    deadline_days: z.number().int().positive().max(180),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    await ctx.householdService.getHousehold(ctx.householdId, ctx.userId);

    const candidates = await ctx.db
      .select()
      .from(contractors)
      .where(
        and(
          eq(contractors.household_id, ctx.householdId),
          eq(contractors.is_blocked, false)
        )
      )
      .all();

    const matched = candidates.filter((c) => {
      if (c.specialty && c.specialty.toLowerCase() === input.category.toLowerCase()) {
        return true;
      }
      if (!c.secondary_specialties) return false;
      try {
        const arr = JSON.parse(c.secondary_specialties) as unknown;
        if (Array.isArray(arr)) {
          return arr.some(
            (s) => typeof s === 'string' && s.toLowerCase() === input.category.toLowerCase()
          );
        }
      } catch {
        /* ignored */
      }
      return false;
    });

    const withEmail = matched.filter((c) => Boolean(c.email));

    if (withEmail.length === 0) {
      return {
        ok: false,
        error: 'no_eligible_contractors',
        category: input.category,
        matched_count: matched.length,
      };
    }

    const idempotencyKey = await sha256Hex(
      `request_quotes:${ctx.householdId}:${input.category}:${input.deadline_days}:${withEmail.map((c) => c.id).sort().join(',')}`
    );
    const parked = await ctx.approvalQueue.park({
      householdId: ctx.householdId,
      userId: ctx.userId,
      toolName: 'request_quotes_from_saved_contractors',
      input: {
        category: input.category,
        scope: input.scope,
        deadline_days: input.deadline_days,
        contractor_ids: withEmail.map((c) => c.id),
      },
      idempotencyKey,
    });

    return {
      ok: true,
      pending_id: parked.pendingId,
      status: 'parked_for_approval',
      queue_status: parked.status,
      contractor_count: withEmail.length,
      contractor_ids: withEmail.map((c) => c.id),
    };
  },
};

// ============ forward_briefing_to ============

interface ResolvedChannel {
  channel: 'push' | 'email';
  push?: { token: string };
  email?: { address: string };
}

async function resolveForwardChannel(
  ctx: AihousekeeperToolContext,
  memberId: string
): Promise<ResolvedChannel | { ok: false; error: string }> {
  const member = await ctx.db
    .select({
      id: householdMembers.id,
      user_id: householdMembers.user_id,
      notification_channel_preference: householdMembers.notification_channel_preference,
      email: users.email,
    })
    .from(householdMembers)
    .innerJoin(users, eq(householdMembers.user_id, users.id))
    .where(
      and(
        eq(householdMembers.id, memberId),
        eq(householdMembers.household_id, ctx.householdId),
        isNull(householdMembers.deleted_at)
      )
    )
    .get();
  if (!member) return { ok: false, error: 'member_not_found' };

  const pref = member.notification_channel_preference;

  if (pref === 'none') {
    return { ok: false, error: 'member_opted_out' };
  }

  if (pref === 'push' || pref === 'auto') {
    const token = await ctx.db
      .select({ token: pushTokens.token })
      .from(pushTokens)
      .where(
        and(
          eq(pushTokens.user_id, member.user_id),
          eq(pushTokens.is_active, true)
        )
      )
      .get();
    if (token) {
      return { channel: 'push', push: { token: token.token } };
    }
    if (pref === 'auto' && member.email) {
      return { channel: 'email', email: { address: member.email } };
    }
    if (pref === 'push') {
      return { ok: false, error: 'member_has_no_push_token' };
    }
  }

  if (pref === 'email' || pref === 'auto') {
    if (member.email) {
      return { channel: 'email', email: { address: member.email } };
    }
    return { ok: false, error: 'member_has_no_email' };
  }

  return { ok: false, error: `unsupported_channel:${pref}` };
}

export const forwardBriefingTo: AihousekeeperTool = {
  name: 'forward_briefing_to',
  kind: 'LOW_WRITE',
  description:
    'Forward the most recent morning briefing to another household member via their preferred channel. Push if installed, email fallback.',
  input: z.object({
    member_id: z.string().min(1),
    briefing_summary: z.string().min(1).max(4000),
    briefing_url: z.string().url().optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    await ctx.householdService.getHousehold(ctx.householdId, ctx.userId);

    const resolved = await resolveForwardChannel(ctx, input.member_id);
    if ('ok' in resolved && resolved.ok === false) {
      return { ok: false, error: resolved.error };
    }
    const r = resolved as ResolvedChannel;

    const idempotencyKey = await sha256Hex(
      `forward_briefing:${ctx.householdId}:${input.member_id}:${nowIso().slice(0, 10)}`
    );

    if (r.channel === 'push' && r.push) {
      const result = await ctx.dispatcher.sendPush({
        householdId: ctx.householdId,
        toMemberId: input.member_id,
        toExpoToken: r.push.token,
        title: 'Aihousekeeper forwarded a briefing',
        body: input.briefing_summary.slice(0, 300),
        data: input.briefing_url ? { url: input.briefing_url } : undefined,
        template: 'forward_briefing_to',
        severity: 2,
        kind: 'briefing',
        idempotencyKey,
      });
      return { ok: true, channel: 'push', status: result.status };
    }

    if (r.channel === 'email' && r.email) {
      const html = input.briefing_url
        ? `<p>${escapeHtml(input.briefing_summary)}</p><p><a href="${input.briefing_url}">Open briefing</a></p>`
        : `<p>${escapeHtml(input.briefing_summary)}</p>`;
      const result = await ctx.dispatcher.sendEmail({
        householdId: ctx.householdId,
        toMemberId: input.member_id,
        toEmail: r.email.address,
        subject: 'Aihousekeeper forwarded a briefing',
        html,
        template: 'forward_briefing_to',
        severity: 2,
        kind: 'briefing',
        idempotencyKey,
      });
      return { ok: true, channel: 'email', status: result.status };
    }

    return { ok: false, error: 'no_channel_resolved' };
  },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const delegationTools: readonly AihousekeeperTool[] = [
  draftEmailToContractor,
  sendEmailToContractor,
  requestQuotesFromSavedContractors,
  forwardBriefingTo,
] as const;
