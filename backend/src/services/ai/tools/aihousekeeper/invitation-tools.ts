/**
 * Household member + invitation tools.
 *
 * Thin wrappers over HouseholdService. Invite creation is HIGH_WRITE because
 * it sends an email — user approval protects against spammy / wrong-address
 * invites generated from voice misinterpretation.
 */
import { z } from 'zod';

import { sha256Hex } from '../../../aihousekeeper/event-bus';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;

export const listHouseholdMembers: AihousekeeperTool = {
  name: 'list_household_members',
  kind: 'READ',
  description:
    'List all active members of the current household with their role, display name, and email.',
  input: z.object({}),
  async execute(ctx: AihousekeeperToolContext, _input): Promise<ToolResult> {
    const members = await ctx.householdService.getMembers(
      ctx.householdId,
      ctx.userId
    );
    return {
      ok: true,
      count: members.length,
      members: members.map((m) => ({
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        display_name: m.display_name ?? null,
        email: m.email ?? null,
      })),
    };
  },
};

export const listPendingInvitations: AihousekeeperTool = {
  name: 'list_pending_invitations',
  kind: 'READ',
  description:
    'List pending (unaccepted, unexpired) invitations to join the current household.',
  input: z.object({}),
  async execute(ctx: AihousekeeperToolContext, _input): Promise<ToolResult> {
    const invitations = await ctx.householdService.getInvitations(
      ctx.householdId,
      ctx.userId
    );
    return { ok: true, count: invitations.length, invitations };
  },
};

export const inviteHouseholdMember: AihousekeeperTool = {
  name: 'invite_household_member',
  kind: 'HIGH_WRITE',
  description:
    'Send an email invitation to add someone to the current household. Parks for user approval; the approval flow actually creates the invitation and dispatches the email. Role defaults to "member" if unspecified.',
  input: z.object({
    email: z.string().email(),
    role: z.enum(ROLES).optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const role = input.role ?? 'member';
    const idempotencyKey = await sha256Hex(
      `invite_member:${ctx.householdId}:${input.email.toLowerCase()}:${role}`
    );
    const parked = await ctx.approvalQueue.park({
      householdId: ctx.householdId,
      userId: ctx.userId,
      toolName: 'invite_household_member',
      input: { email: input.email.toLowerCase(), role },
      idempotencyKey,
    });
    return {
      ok: true,
      pending_id: parked.pendingId,
      status: 'parked_for_approval',
      queue_status: parked.status,
      email: input.email.toLowerCase(),
      role,
    };
  },
};

export const cancelHouseholdInvitation: AihousekeeperTool = {
  name: 'cancel_household_invitation',
  kind: 'LOW_WRITE',
  description:
    'Cancel a pending household invitation by id. Resolve the invitation_id from list_pending_invitations first — never ask the user for an id.',
  input: z.object({
    invitation_id: z.string().min(1),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    try {
      await ctx.householdService.cancelInvitation(
        ctx.householdId,
        input.invitation_id,
        ctx.userId
      );
      return { ok: true, invitation_id: input.invitation_id, cancelled: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'cancel_failed',
      };
    }
  },
};

export const removeHouseholdMember: AihousekeeperTool = {
  name: 'remove_household_member',
  kind: 'HIGH_WRITE',
  description:
    'Remove a member from the current household. Parks for user approval. Resolve member_id from list_household_members first.',
  input: z.object({
    member_id: z.string().min(1),
    reason: z.string().max(500).optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const idempotencyKey = await sha256Hex(
      `remove_member:${ctx.householdId}:${input.member_id}`
    );
    const parked = await ctx.approvalQueue.park({
      householdId: ctx.householdId,
      userId: ctx.userId,
      toolName: 'remove_household_member',
      input: { member_id: input.member_id, reason: input.reason ?? null },
      idempotencyKey,
    });
    return {
      ok: true,
      pending_id: parked.pendingId,
      status: 'parked_for_approval',
      queue_status: parked.status,
      member_id: input.member_id,
    };
  },
};

export const invitationTools: readonly AihousekeeperTool[] = [
  listHouseholdMembers,
  listPendingInvitations,
  inviteHouseholdMember,
  cancelHouseholdInvitation,
  removeHouseholdMember,
] as const;
