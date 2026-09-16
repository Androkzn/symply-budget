/**
 * Feature Flags Routes
 *
 * GET  /features  — PUBLIC. Returns the global flag config. Intentionally
 *                   unauthenticated so the mobile app can resolve flags on the
 *                   auth / onboarding screens, before a user logs in. Edge-cached
 *                   for 60s as a lightweight kill-switch fast path.
 *
 * PUT  /features  — ADMIN. Merges a partial { key: boolean } map into KV. Gated
 *                   by a valid JWT (authMiddleware) AND a shared-secret header
 *                   (X-Admin-Secret === FEATURE_FLAGS_ADMIN_SECRET). If the
 *                   secret env var is unset, the route is denied (safe default):
 *                   configure it with `wrangler secret put FEATURE_FLAGS_ADMIN_SECRET`.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { getFlags, setFlags } from '../services/featureFlagService';
import type { Env } from '../types';
import { nowIso } from '../utils/id';

const features = new Hono<{ Bindings: Env }>();

// Public read.
features.get('/', async (c: Context<{ Bindings: Env }>) => {
  const payload = await getFlags(c.env.CONFIG_KV);
  c.header('Cache-Control', 'public, max-age=60');
  return c.json(payload);
});

// Admin write — auth first, then the shared-secret check.
const UpdateSchema = z.object({
  flags: z.record(z.boolean()),
});

features.put('/', authMiddleware(), async (c: Context<{ Bindings: Env }>) => {
  const expected = c.env.FEATURE_FLAGS_ADMIN_SECRET;
  const provided = c.req.header('X-Admin-Secret');
  if (!expected || provided !== expected) {
    return c.json(
      { error: { code: 'forbidden', message: 'Admin secret required' } },
      403
    );
  }

  const parsed = UpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'validation_error',
          message: 'Body must be { flags: Record<string, boolean> }',
        },
      },
      400
    );
  }

  const payload = await setFlags(
    c.env.CONFIG_KV,
    parsed.data.flags,
    nowIso()
  );
  return c.json(payload);
});

export default features;
