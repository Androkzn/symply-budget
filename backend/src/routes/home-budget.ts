import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { BudgetService } from '../services/budget-service';
import type { Env } from '../types';

/**
 * Symply House lightweight home-budget API.
 * Full money product lives on Symply Budget Worker (`/budget`, `/savings`, `/wishes`).
 * House only exposes a monthly glance for home-operations context.
 */
const homeBudget = new Hono<{ Bindings: Env }>();

homeBudget.use(authMiddleware());

function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

const monthQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

/**
 * GET /households/:householdId/home-budget/monthly-overview?year=&month=
 * Same shape as Budget monthly-overview so House minimal UI can reuse types.
 */
homeBudget.get('/monthly-overview', zValidator('query', monthQuerySchema), async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const { year, month } = c.req.valid('query');
  const budgetService = new BudgetService(c.env, c.env.DB);
  const overview = await budgetService.getMonthlyOverview(householdId, userId, year, month);
  return c.json(overview);
});

/** Alias for Home status strip / Mira cues. */
homeBudget.get('/glance', zValidator('query', monthQuerySchema), async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const { year, month } = c.req.valid('query');
  const budgetService = new BudgetService(c.env, c.env.DB);
  const overview = await budgetService.getMonthlyOverview(householdId, userId, year, month);
  return c.json({
    year,
    month,
    remaining: overview.remainingBudget,
    planned: overview.plannedBudget > 0 ? overview.plannedBudget : null,
    spent: overview.actualSpent,
  });
});

export default homeBudget;
