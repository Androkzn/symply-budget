/**
 * Read-only access to floor plans (indoor) and garden plans (outdoor) for Aihousekeeper.
 */
import { z } from 'zod';

import { FloorPlanService } from '../../../floor-plan-service';
import { GardenPlanService } from '../../../garden-plan-service';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

const listSitePlans: AihousekeeperTool = {
  name: 'list_site_plans',
  kind: 'READ',
  description:
    "List the household's uploaded plans: indoor floor plans and/or outdoor garden/yard plans. Returns id, kind, label/building, and status.",
  input: z.object({
    scope: z
      .enum(['garden', 'interior', 'all'])
      .optional()
      .default('garden')
      .describe(
        'garden = outdoor yard/garden plans only. interior = indoor floor plans only. all = both.'
      ),
  }),
  async execute(
    ctx: AihousekeeperToolContext,
    input: { scope?: 'garden' | 'interior' | 'all' }
  ): Promise<ToolResult> {
    const scope = input.scope ?? 'garden';

    const result: Record<string, unknown>[] = [];

    if (scope === 'interior' || scope === 'all') {
      const fpService = new FloorPlanService(ctx.env, ctx.env.DB);
      const { floor_plans } = await fpService.listFloorPlans(
        ctx.householdId,
        ctx.userId
      );
      for (const fp of floor_plans as Record<string, unknown>[]) {
        result.push({
          id: fp.id,
          kind: 'floor_plan',
          building_name: fp.building_name,
          floor_label: fp.floor_label,
          floor_number: fp.floor_number,
          status: fp.status,
        });
      }
    }

    if (scope === 'garden' || scope === 'all') {
      const gpService = new GardenPlanService(ctx.env, ctx.env.DB);
      const { garden_plans } = await gpService.list(ctx.householdId, ctx.userId);
      for (const gp of garden_plans as Record<string, unknown>[]) {
        result.push({
          id: gp.id,
          kind: 'garden_plan',
          plan_type: gp.plan_type,
          label: gp.label,
          status: gp.status,
        });
      }
    }

    return { ok: true, site_plans: result };
  },
};

export const floorPlanTools: readonly AihousekeeperTool[] = [listSitePlans] as const;
