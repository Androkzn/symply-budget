/**
 * Garden boundary draft tools.
 *
 * These let Mira manage pending garden boundary drafts from chat.
 * Satellite map preview was removed; create/edit now return map_preview_removed.
 */
import { z } from 'zod';

import { MAP_PREVIEW_REMOVED } from '../../../../types/geo';
import { GardenPlanBoundaryService } from '../../../garden-plan-boundary-service';
import type { AihousekeeperTool, ToolResult } from '../index';

const geoJsonPolygonSchema = z.object({
  type: z.enum(['Polygon', 'MultiPolygon']),
  coordinates: z.array(z.any()),
});

const addressSchema = z.object({
  address_line1: z.string().min(1).optional(),
  address_line2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state_province: z.string().optional().nullable(),
  postal_code: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
});

function mapPreviewRemovedResult(): ToolResult {
  return {
    ok: false,
    error: MAP_PREVIEW_REMOVED,
    message:
      'Satellite map boundary drafts are no longer available. Upload a yard photo in Gardening or ask Mira for a stylized concept plan.',
    ui: {
      type: 'action_row',
      actions: [
        {
          label: 'Upload yard photo',
          variant: 'primary',
          action: {
            type: 'navigate',
            screen: 'GardenPlanUpload',
          },
        },
      ],
    },
  };
}

function projectBoundary(draft: {
  id: string;
  status: string;
  formatted_address: string;
  geocode: { place_name: string } | null;
  boundary_source: string | null;
  preview_image_url: string | null;
  expires_at: string;
}) {
  return {
    boundary_draft_id: draft.id,
    status: draft.status,
    formatted_address: draft.formatted_address,
    geocode_place_name: draft.geocode?.place_name ?? null,
    boundary_source: draft.boundary_source,
    preview_image_url: draft.preview_image_url,
    expires_at: draft.expires_at,
  };
}

function toolError(toolName: string, err: unknown): ToolResult {
  const e = err as Error;
  console.error(`[aihousekeeper-tool] ${toolName} failed`, {
    name: e?.name,
    message: e?.message,
    stack: e?.stack,
  });
  return {
    ok: false,
    error: e?.message ?? `${toolName}_failed`,
  };
}

// ============ create_pending_garden_boundary ============

export const createPendingGardenBoundary: AihousekeeperTool = {
  name: 'create_pending_garden_boundary',
  kind: 'LOW_WRITE',
  description:
    'Create a pending garden boundary draft from chat. Satellite map preview was removed — this tool now directs the user to upload a yard photo or request a stylized concept plan instead.',
  input: z.object({
    address_line: z
      .string()
      .min(3)
      .max(180)
      .optional()
      .describe(
        'Free-form property address from the user, e.g. "8135 138 st Surrey BC". Omit to use the current household saved address.'
      ),
    address: addressSchema
      .optional()
      .describe('Structured address. Prefer address_line unless the user gave structured parts.'),
  }),
  async execute(): Promise<ToolResult> {
    return mapPreviewRemovedResult();
  },
};

// ============ list_pending_garden_boundaries ============

export const listPendingGardenBoundaries: AihousekeeperTool = {
  name: 'list_pending_garden_boundaries',
  kind: 'READ',
  description:
    "List the current household user's pending garden boundary drafts. Use before editing or deleting when the user says 'that boundary', 'the pending boundary', or asks what's waiting. Returns draft and confirmed boundaries that have not expired.",
  input: z.object({}),
  async execute(ctx): Promise<ToolResult> {
    try {
      const service = new GardenPlanBoundaryService(ctx.env, ctx.env.DB);
      const result = await service.listPendingDrafts(ctx.householdId, ctx.userId);
      return {
        ok: true,
        pending_boundaries: result.boundary_drafts.map(projectBoundary),
        count: result.boundary_drafts.length,
      };
    } catch (err) {
      return toolError('list_pending_garden_boundaries', err);
    }
  },
};

// ============ edit_pending_garden_boundary ============

export const editPendingGardenBoundary: AihousekeeperTool = {
  name: 'edit_pending_garden_boundary',
  kind: 'LOW_WRITE',
  description:
    'Edit a pending garden boundary by saving replacement GeoJSON. Satellite map preview was removed — this tool now directs the user to upload a yard photo or request a stylized concept plan instead.',
  input: z.object({
    boundary_draft_id: z
      .string()
      .min(1)
      .describe('The draft id from create/list pending garden boundary tools. Never invent it.'),
    boundary_geojson: geoJsonPolygonSchema.describe(
      'Replacement boundary geometry as GeoJSON Polygon or MultiPolygon.'
    ),
    boundary_source: z
      .enum(['user_adjusted', 'user_drawn'])
      .default('user_adjusted')
      .describe('Use user_drawn only when the user supplied a fully drawn boundary.'),
  }),
  async execute(): Promise<ToolResult> {
    return mapPreviewRemovedResult();
  },
};

// ============ delete_pending_garden_boundary ============

export const deletePendingGardenBoundary: AihousekeeperTool = {
  name: 'delete_pending_garden_boundary',
  kind: 'LOW_WRITE',
  description:
    "Delete a pending garden boundary draft that has not yet been used to generate a plan. Always call list_pending_garden_boundaries first to discover the boundary_draft_id unless the id is already present in the chat. Use when the user says 'delete that boundary', 'cancel the pending boundary', or 'start over'.",
  input: z.object({
    boundary_draft_id: z
      .string()
      .min(1)
      .describe('The draft id from create/list pending garden boundary tools. Never invent it.'),
  }),
  async execute(ctx, input): Promise<ToolResult> {
    try {
      const service = new GardenPlanBoundaryService(ctx.env, ctx.env.DB);
      await service.deleteDraft(ctx.householdId, ctx.userId, input.boundary_draft_id);
      return {
        ok: true,
        status: 'garden_boundary_deleted',
        boundary_draft_id: input.boundary_draft_id,
      };
    } catch (err) {
      return toolError('delete_pending_garden_boundary', err);
    }
  },
};

export const gardenBoundaryTools: readonly AihousekeeperTool[] = [
  createPendingGardenBoundary,
  listPendingGardenBoundaries,
  editPendingGardenBoundary,
  deletePendingGardenBoundary,
] as const;
