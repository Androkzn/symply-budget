/**
 * House companion read-only GETs — companion+jwt only.
 * Brand-gated to platformAuthority in src/index.ts.
 */
import { Hono } from 'hono';

import { checkRateLimitDO } from '../middleware/rate-limit';
import { getHomeInsight } from '../services/aihousekeeper/route-service';
import { HouseholdService } from '../services/household-service';
import { TaskService } from '../services/task-service';
import type { Env } from '../types';
import { RateLimitError, UnauthorizedError, ForbiddenError } from '../utils/errors';
import { now } from '../utils/id';
import { verifyCompanionToken } from '../utils/platform-jwt';

const companion = new Hono<{ Bindings: Env }>();

async function requireCompanion(c: {
  env: Env;
  req: { header: (n: string) => string | undefined };
}) {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) throw new UnauthorizedError('Missing companion token');
  const token = auth.slice(7);
  const payload = await verifyCompanionToken(token, c.env);
  if (!payload?.sub || typeof payload.household_id !== 'string') {
    throw new UnauthorizedError('Invalid companion token');
  }
  return {
    userId: payload.sub,
    householdId: payload.household_id,
    scope: typeof payload.scope === 'string' ? payload.scope : '',
  };
}

async function enforceCompanionRateLimit(c: { env: Env; req: { header: (n: string) => string | undefined }; userId: string }) {
  const ip = c.req.header('CF-Connecting-IP') || c.userId;
  try {
    const r = await checkRateLimitDO(c.env, 'companion:get', ip);
    if (!r.allowed) throw new RateLimitError(60);
  } catch (e) {
    if (e instanceof RateLimitError) throw e;
    throw new RateLimitError(60);
  }
}

companion.get('/v1/tasks', async (c) => {
  const { userId, householdId, scope } = await requireCompanion(c);
  await enforceCompanionRateLimit({ env: c.env, req: c.req, userId });

  if (!scope.includes('tasks:read')) throw new ForbiddenError('Missing tasks:read scope');

  const days = Math.min(7, Math.max(1, parseInt(c.req.query('days') || '7', 10) || 7));
  const households = new HouseholdService(c.env, c.env.DB);
  await households.getHousehold(householdId, userId);

  // Same Watch-shaped feed the product route serves, so the widget gets real
  // due-date semantics plus priority/category — the fields its urgency ranking
  // needs. Companion callers never reach the product route (companion+jwt only).
  const tasks = new TaskService(c.env, c.env.DB);
  const data = await tasks.getWatchTasks(householdId, userId, days);

  return c.json({
    data,
    fetched_at: now(),
  });
});

companion.get('/v1/home-insight', async (c) => {
  const { userId, householdId, scope } = await requireCompanion(c);
  await enforceCompanionRateLimit({ env: c.env, req: c.req, userId });

  if (!scope.includes('home-insight:read')) {
    throw new ForbiddenError('Missing home-insight:read scope');
  }

  const households = new HouseholdService(c.env, c.env.DB);
  await households.getHousehold(householdId, userId);

  // Deterministic, no per-request AI call — the same composer the Home hero
  // banner uses, so the widget and the app never disagree. `tz` is the device
  // zone so "days until due" is computed in the household's local day.
  const tz = c.req.query('tz') || undefined;
  const insight = await getHomeInsight(c.env, householdId, userId, tz);

  return c.json({
    data: {
      household_id: householdId,
      insight,
    },
    fetched_at: now(),
  });
});

export default companion;
