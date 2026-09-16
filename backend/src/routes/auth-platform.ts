/**
 * House platform authority routes: deletion, companion mint, shared-user.
 * Mounted only when platformAuthority capability is enabled (House Worker).
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { checkRateLimitDO } from '../middleware/rate-limit';
import {
  assertHouseOnly,
  getDeletionStatusBySecret,
  startPlatformDeletion,
  revokeSessionBySid,
} from '../services/deletion-saga-service';
import { HouseholdService } from '../services/household-service';
import { getSharedUserMe } from '../services/shared-user-service';
import type { Env } from '../types';
import { RateLimitError, ForbiddenError } from '../utils/errors';
import { signCompanionToken, hasPlatformJwtPrivateKey } from '../utils/platform-jwt';

const platform = new Hono<{ Bindings: Env }>();

async function rateLimit(c: { env: Env; req: { header: (n: string) => string | undefined }; get: (k: 'userId') => string | undefined; header: (k: string, v: string) => void }, action: string) {
  const id = c.get('userId') || c.req.header('CF-Connecting-IP') || 'unknown';
  try {
    const r = await checkRateLimitDO(c.env, action, id);
    if (!r.allowed) throw new RateLimitError(60);
  } catch (e) {
    if (e instanceof RateLimitError) throw e;
    throw new RateLimitError(60);
  }
}

platform.use('*', async (c, next) => {
  assertHouseOnly(c.env);
  await next();
});

platform.get('/me', authMiddleware(), async (c) => {
  const me = await getSharedUserMe(c.env, c.get('userId'));
  return c.json({ data: me });
});

platform.post(
  '/deletion',
  authMiddleware(),
  zValidator(
    'json',
    z.object({
      idempotency_key: z.string().min(16),
      status_secret: z.string().min(32),
    })
  ),
  async (c) => {
    await rateLimit(c, 'auth:deletion-status');
    const body = c.req.valid('json');
    const result = await startPlatformDeletion(
      c.env,
      c.get('userId'),
      body.idempotency_key,
      body.status_secret
    );
    return c.json(result, 202);
  }
);

platform.post(
  '/deletion-status',
  zValidator('json', z.object({ status_secret: z.string().min(32) })),
  async (c) => {
    await rateLimit(c, 'auth:deletion-status');
    const { status_secret } = c.req.valid('json');
    const result = await getDeletionStatusBySecret(c.env, status_secret);
    return c.json(result);
  }
);

platform.post(
  '/companion',
  authMiddleware(),
  zValidator(
    'json',
    z.object({
      household_id: z.string().min(1),
      scope: z.string().default('tasks:read home-insight:read'),
    })
  ),
  async (c) => {
    if (!hasPlatformJwtPrivateKey(c.env)) {
      throw new ForbiddenError('Companion mint requires PLATFORM_JWT_PRIVATE_JWK');
    }
    const { household_id, scope } = c.req.valid('json');
    const userId = c.get('userId');
    const households = new HouseholdService(c.env, c.env.DB);
    await households.getHousehold(household_id, userId);

    const token = await signCompanionToken(
      { sub: userId, household_id, scope },
      c.env,
      3600
    );
    return c.json({ companion_token: token, expires_in: 3600, token_type: 'companion+jwt' });
  }
);

platform.post(
  '/revoke-session',
  authMiddleware(),
  zValidator('json', z.object({ sid: z.string().min(1), reason: z.string().default('user_logout') })),
  async (c) => {
    const { sid, reason } = c.req.valid('json');
    await revokeSessionBySid(c.env, c.get('userId'), sid, reason);
    return c.json({ ok: true });
  }
);

export default platform;
