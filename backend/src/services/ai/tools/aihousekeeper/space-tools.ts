/**
 * Household spaces (rooms / zones) tools — thin wrappers over
 * HouseholdSpaceService. Spaces are the targets of task assignments so
 * creating one is a natural AI action during onboarding or when the user
 * says "add a garage to the house".
 *
 * Write operations require household ownership — the service enforces it
 * and throws ForbiddenError, which we translate to a tool error.
 */
import { z } from 'zod';

import { HouseholdSpaceService } from '../../../household-space-service';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

const SPACE_CATEGORIES = ['indoor', 'outdoor', 'garage', 'basement', 'attic'] as const;

function spaceService(ctx: AihousekeeperToolContext): HouseholdSpaceService {
  return new HouseholdSpaceService(ctx.env, ctx.env.DB);
}

export const listSpaces: AihousekeeperTool = {
  name: 'list_spaces',
  kind: 'READ',
  description:
    'List rooms, zones, and areas defined for the household. Use when the user asks about their spaces or before creating a task tied to a specific room.',
  input: z.object({
    category: z.enum(SPACE_CATEGORIES).optional(),
    floor_level: z.number().int().min(-2).max(10).optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const spaces = await spaceService(ctx).listSpaces(
      ctx.householdId,
      ctx.userId,
      input
    );
    return {
      ok: true,
      count: spaces.length,
      spaces: spaces.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        floor_level: s.floor_level,
        icon_emoji: s.icon_emoji,
        description: s.description,
        area_sqft: s.area_sqft,
      })),
    };
  },
};

export const createSpace: AihousekeeperTool = {
  name: 'create_space',
  kind: 'LOW_WRITE',
  description:
    'Create a new household space (room, zone, or area). Use category to classify (indoor/outdoor/garage/basement/attic). Requires household ownership — tell the user to ask an owner if they\'re not one.',
  input: z.object({
    name: z.string().min(1).max(100),
    category: z.enum(SPACE_CATEGORIES).optional(),
    floor_level: z.number().int().min(-2).max(10).optional(),
    icon_emoji: z.string().max(10).optional(),
    description: z.string().max(500).optional(),
    area_sqft: z.number().int().positive().optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    try {
      const space = await spaceService(ctx).createSpace(
        ctx.householdId,
        ctx.userId,
        { ...input, space_type: 'custom' }
      );
      return {
        ok: true,
        space_id: space.id,
        name: space.name,
        category: space.category,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'create_failed',
      };
    }
  },
};

export const updateSpace: AihousekeeperTool = {
  name: 'update_space',
  kind: 'LOW_WRITE',
  description:
    'Update an existing space (rename, change category, adjust icon, description, or area). Resolve space_id from list_spaces first — never ask the user for an id.',
  input: z.object({
    space_id: z.string().min(1),
    name: z.string().min(1).max(100).optional(),
    category: z.enum(SPACE_CATEGORIES).optional(),
    floor_level: z.number().int().min(-2).max(10).optional(),
    icon_emoji: z.string().max(10).optional(),
    description: z.string().max(500).optional(),
    area_sqft: z.number().int().positive().optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const { space_id, ...updates } = input;
    if (Object.keys(updates).length === 0) {
      return { ok: false, error: 'no_fields_provided' };
    }
    try {
      const space = await spaceService(ctx).updateSpace(
        ctx.householdId,
        space_id,
        ctx.userId,
        updates
      );
      return { ok: true, space_id: space.id, name: space.name };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'update_failed',
      };
    }
  },
};

export const deleteSpace: AihousekeeperTool = {
  name: 'delete_space',
  kind: 'HIGH_WRITE',
  description:
    'Delete a household space (soft-delete). Parks for user approval since tasks may be tied to this space. Resolve space_id from list_spaces first.',
  input: z.object({
    space_id: z.string().min(1),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const { sha256Hex } = await import('../../../aihousekeeper/event-bus');
    const idempotencyKey = await sha256Hex(
      `delete_space:${ctx.householdId}:${input.space_id}`
    );
    const parked = await ctx.approvalQueue.park({
      householdId: ctx.householdId,
      userId: ctx.userId,
      toolName: 'delete_space',
      input: { space_id: input.space_id },
      idempotencyKey,
    });
    return {
      ok: true,
      pending_id: parked.pendingId,
      status: 'parked_for_approval',
      queue_status: parked.status,
      space_id: input.space_id,
    };
  },
};

export const spaceTools: readonly AihousekeeperTool[] = [
  listSpaces,
  createSpace,
  updateSpace,
  deleteSpace,
] as const;
