/**
 * Hono middleware: require AI entitlement after auth.
 * Use on AI-only routes: `router.post('/path', requireAIEntitlement(), handler)`
 * or router-wide: `router.use('*', requireAIEntitlement())`.
 *
 * The denial is mapped to the shared `{ error: { code, message } }` shape HERE
 * rather than left to `app.onError`, for the same reason `routes/health-ai.ts`
 * maps it locally: several suites mount routers STANDALONE, where the app error
 * handler does not exist. Mapping in the middleware makes a denial identical
 * composed or standalone, and lets the client read `error.code` (one of the
 * `AIDenialReason` codes) to route the user to `/ai-access` with the right copy.
 *
 * Built with `createMiddleware` rather than a bare arrow so Hono keeps inferring
 * the route's path params through it — a hand-typed `(c: Context<…>, next)`
 * collapses `c.req.param('id')` to `string | undefined` in every handler placed
 * behind it.
 */

import { createMiddleware } from 'hono/factory';

import { assertCanUseAI } from '../services/entitlement-service';
import type { Env } from '../types';
import { AIAccessError } from '../utils/errors';

export function requireAIEntitlement() {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ error: { code: 'unauthorized', message: 'Unauthorized' } }, 401);
    }
    try {
      await assertCanUseAI(userId, c.env);
    } catch (err) {
      if (err instanceof AIAccessError || (err as Error)?.name === 'AIAccessError') {
        const e = err as AIAccessError & { statusCode?: number; code?: string; message: string };
        return c.json(
          { error: { code: e.code ?? 'ai_access_denied', message: e.message } },
          (e.statusCode ?? 403) as 402 | 403 | 409 | 422 | 503
        );
      }
      throw err;
    }
    await next();
  });
}
