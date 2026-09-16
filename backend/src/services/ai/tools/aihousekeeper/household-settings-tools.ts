/**
 * Household settings tools — view, create, update, and delete household/property records.
 *
 * Wraps HouseholdService.updateHousehold. Address/timezone-type changes are
 * LOW_WRITE: the service enforces permissions and the changes are easy to
 * reverse via the same tool. Deleting a property is HIGH_WRITE and parks for
 * explicit user approval.
 */
import { z } from 'zod';

import { sha256Hex } from '../../../aihousekeeper/event-bus';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

const householdInput = {
  name: z.string().min(1).max(200).optional(),
  address_line1: z.string().max(200).optional(),
  address_line2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state_province: z.string().max(100).optional(),
  postal_code: z.string().max(20).optional(),
  country: z.enum(['CA', 'US']).optional(),
  timezone: z.string().max(100).optional(),
} as const;

function projectHousehold(household: {
  id: string;
  name: string;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country?: string | null;
  photo_key?: string | null;
}) {
  return {
    id: household.id,
    name: household.name,
    address_line1: household.address_line1 ?? null,
    address_line2: household.address_line2 ?? null,
    city: household.city ?? null,
    state_province: household.state_province ?? null,
    postal_code: household.postal_code ?? null,
    country: household.country ?? null,
    photo_key: household.photo_key ?? null,
  };
}

export const listHouseholdProperties: AihousekeeperTool = {
  name: 'list_household_properties',
  kind: 'READ',
  description:
    'List all saved household properties/homes the user belongs to. Use before editing/deleting when the user references a property by name, or when the user asks what properties are saved.',
  input: z.object({}),
  async execute(ctx: AihousekeeperToolContext, _input): Promise<ToolResult> {
    const households = await ctx.householdService.getUserHouseholds(ctx.userId);
    return {
      ok: true,
      households: households.map(projectHousehold),
      count: households.length,
    };
  },
};

export const getHouseholdDetails: AihousekeeperTool = {
  name: 'get_household_details',
  kind: 'READ',
  description:
    'Get the current household\'s name, address, country, and photo. Use when the user asks what\'s on file or before proposing an update.',
  input: z.object({}),
  async execute(ctx: AihousekeeperToolContext, _input): Promise<ToolResult> {
    const household = await ctx.householdService.getHousehold(
      ctx.householdId,
      ctx.userId
    );
    return {
      ok: true,
      household: projectHousehold(household),
    };
  },
};

export const createHouseholdProperty: AihousekeeperTool = {
  name: 'create_household_property',
  kind: 'LOW_WRITE',
  description:
    'Create a new saved property/home for the user. Use when the user asks to add/create a house, home, property, rental, cabin, etc. Name is required. Address fields are optional but strongly preferred for map/garden/floor-plan features.',
  input: z.object({
    name: z.string().min(1).max(200),
    address_line1: z.string().max(200).optional(),
    address_line2: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    state_province: z.string().max(100).optional(),
    postal_code: z.string().max(20).optional(),
    country: z.enum(['CA', 'US']).optional(),
    timezone: z.string().max(100).optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    try {
      const created = await ctx.householdService.createHousehold(ctx.userId, input);
      return {
        ok: true,
        household: projectHousehold(created),
        invalidate: ['households'],
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'create_failed',
      };
    }
  },
};

export const updateHouseholdDetails: AihousekeeperTool = {
  name: 'update_household_details',
  kind: 'LOW_WRITE',
  description:
    'Update household name and/or address fields. Only include fields the user explicitly wants to change. Requires the user to be an owner or admin — the service enforces permissions.',
  input: z.object(householdInput),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    if (Object.keys(input).length === 0) {
      return { ok: false, error: 'no_fields_provided' };
    }
    try {
      const updated = await ctx.householdService.updateHousehold(
        ctx.householdId,
        ctx.userId,
        input
      );
      return {
        ok: true,
        household: projectHousehold(updated),
        invalidate: ['households'],
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'update_failed',
      };
    }
  },
};

export const updateHouseholdProperty: AihousekeeperTool = {
  name: 'update_household_property',
  kind: 'LOW_WRITE',
  description:
    'Update a saved property/home by household_id. Use list_household_properties first if the user refers to the property by name. If household_id is omitted, updates the current household/property.',
  input: z.object({
    household_id: z.string().optional(),
    ...householdInput,
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const { household_id: householdIdFromInput, ...patch } = input;
    const householdId = householdIdFromInput ?? ctx.householdId;
    if (Object.keys(patch).length === 0) {
      return { ok: false, error: 'no_fields_provided' };
    }
    try {
      const updated = await ctx.householdService.updateHousehold(
        householdId,
        ctx.userId,
        patch
      );
      return {
        ok: true,
        household: projectHousehold(updated),
        invalidate: ['households'],
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'update_failed',
      };
    }
  },
};

export const deleteHouseholdProperty: AihousekeeperTool = {
  name: 'delete_household_property',
  kind: 'HIGH_WRITE',
  description:
    'Delete a saved property/home. Use list_household_properties first if the user refers to a property by name. This is destructive and parks for explicit approval; never delete without user confirmation through Approvals.',
  input: z.object({
    household_id: z.string().optional().describe('Property/household id to delete. Omit to delete the current property.'),
    property_name: z.string().min(1).max(200).optional().describe('Human-readable property name for the approval summary.'),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const householdId = input.household_id ?? ctx.householdId;
    let propertyName = input.property_name;
    try {
      const household = await ctx.householdService.getHousehold(householdId, ctx.userId);
      propertyName = propertyName ?? household.name;
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'property_not_found',
      };
    }

    const idempotencyKey = await sha256Hex(
      ['delete_household_property', ctx.userId, householdId].join(':')
    );
    const parked = await ctx.approvalQueue.park({
      householdId: ctx.householdId,
      userId: ctx.userId,
      toolName: 'delete_household_property',
      input: {
        household_id: householdId,
        property_name: propertyName,
      },
      idempotencyKey,
    });
    return {
      ok: true,
      pending_id: parked.pendingId,
      status: 'parked_for_approval',
      queue_status: parked.status,
      property_name: propertyName,
      message: `Delete "${propertyName}" is pending approval.`,
    };
  },
};

export const householdSettingsTools: readonly AihousekeeperTool[] = [
  listHouseholdProperties,
  getHouseholdDetails,
  createHouseholdProperty,
  updateHouseholdDetails,
  updateHouseholdProperty,
  deleteHouseholdProperty,
] as const;
