import { z } from 'zod';

import type { AihousekeeperTool, ToolResult } from '../index';

const NON_HOUSE_KEYWORDS = [
  'apartment',
  'apt',
  'condo',
  'condominium',
  'flat',
  'suite',
  'unit',
] as const;

function formatSavedAddress(home: {
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country?: string | null;
}): string {
  return [
    home.address_line1,
    home.address_line2,
    home.city,
    home.state_province,
    home.postal_code,
    home.country,
  ]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(', ');
}

function looksLikeHouse(home: {
  name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
}): boolean {
  const searchable = [home.name, home.address_line1, home.address_line2]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return !NON_HOUSE_KEYWORDS.some((keyword) =>
    new RegExp(`\\b${keyword}\\b`).test(searchable)
  );
}

function mapPreviewRemovedResult(): ToolResult {
  return {
    ok: true,
    status: 'garden_plan_map_preview_removed',
    message:
      'Satellite map preview is no longer available. Upload a yard photo in Gardening, or describe your garden here for a stylized concept plan.',
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

export const startGardenPlanFlow: AihousekeeperTool = {
  name: 'start_garden_plan_flow',
  kind: 'READ',
  description:
    'Start the garden/yard plan flow from chat. Use when the homeowner asks to create, draw, design, or generate a garden, yard, landscaping, outdoor, front-yard, backyard, or site plan. Satellite map preview was removed — this tool directs the user to upload a yard photo or request a stylized concept plan. If the user has multiple saved homes and did not name one, return house selection buttons first.',
  input: z.object({
    address_line: z
      .string()
      .min(3)
      .max(180)
      .optional()
      .describe(
        'The property address from the user message, e.g. "8135 138 st Surrey BC". Omit if the user did not provide an address.'
      ),
  }),
  async execute(ctx, input): Promise<ToolResult> {
    const addressLine = input.address_line?.trim();

    try {
      if (!addressLine) {
        const allHomes = await ctx.householdService.getUserHouseholds(ctx.userId);
        if (allHomes.length === 0) {
          return {
            ok: true,
            status: 'garden_plan_needs_first_property',
            message:
              'Create your first property first, then upload a yard photo or ask me for a stylized concept plan.',
            ui: {
              type: 'action_row',
              actions: [
                {
                  label: 'Create first property',
                  variant: 'primary',
                  action: {
                    type: 'navigate',
                    screen: 'Settings',
                  },
                },
              ],
            },
          };
        }

        const homes = allHomes
          .map((home) => ({
            ...home,
            formattedAddress: formatSavedAddress(home),
          }))
          .filter((home) => home.formattedAddress.length > 0 && looksLikeHouse(home));

        if (homes.length === 0) {
          return {
            ok: true,
            status: 'garden_plan_needs_first_property',
            message:
              'Create your first house property first, then upload a yard photo or ask me for a stylized concept plan.',
            ui: {
              type: 'action_row',
              actions: [
                {
                  label: 'Create house property',
                  variant: 'primary',
                  action: {
                    type: 'navigate',
                    screen: 'Settings',
                  },
                },
              ],
            },
          };
        }

        if (homes.length > 1) {
          return {
            ok: true,
            status: 'garden_plan_select_home',
            message: 'Which home should I use for this garden plan?',
            ui: {
              type: 'action_row',
              actions: homes.slice(0, 6).map((home) => ({
                label: home.name || home.formattedAddress,
                variant: 'primary',
                action: {
                  type: 'send_message',
                  text: `Create a garden plan for ${home.formattedAddress}`,
                },
              })),
            },
          };
        }
      }

      return mapPreviewRemovedResult();
    } catch (err) {
      return {
        ok: false,
        error: (err as Error).message || 'garden_plan_flow_failed',
        message: 'I could not start the garden plan flow. Please try again from the Gardening tab.',
      };
    }
  },
};

export const gardenPlanFlowTools: readonly AihousekeeperTool[] = [startGardenPlanFlow] as const;
