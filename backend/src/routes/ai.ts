// Legacy AI Chat Routes — gated / retired under AI Access Migration.
// POST /ai/chat/stream must not be anonymously callable. Prefer Mira chat.
import { Hono } from 'hono';

import { authMiddleware } from '../middleware/auth';
import { assertCanUseAI } from '../services/entitlement-service';
import type { Env } from '../types';
import { GoneError } from '../utils/errors';

const ai = new Hono<{ Bindings: Env }>();

ai.use('/*', authMiddleware());

/**
 * POST /ai/chat/stream — retired.
 * Returns 410 Gone after auth + entitlement so older clients get a stable denial
 * and never reach a provider. Use /households/:id/aihousekeeper/chat instead.
 */
ai.post('/chat/stream', async (c) => {
  const userId = c.get('userId');
  await assertCanUseAI(userId, c.env);
  throw new GoneError(
    'Legacy /ai/chat/stream has been removed. Use Mira chat instead.'
  );
});

export default ai;
