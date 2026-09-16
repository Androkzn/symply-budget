import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { authMiddleware } from '../middleware/auth';
import { AuthService } from '../services/auth-service';
import type { Env } from '../types';
import { NotFoundError } from '../utils/errors';
import { updateUserSchema } from '../utils/validation';

const users = new Hono<{ Bindings: Env }>();

// All user routes require authentication
users.use('/*', authMiddleware());

/**
 * GET /users/me - Get current user
 */
users.get('/me', async (c) => {
  const userId = c.get('userId');
  const authService = new AuthService(c.env, c.env.DB);

  const user = await authService.getUserById(userId);
  if (!user) {
    throw new NotFoundError('User');
  }

  return c.json({ user });
});

/**
 * PATCH /users/me - Update current user profile
 */
users.patch('/me', zValidator('json', updateUserSchema), async (c) => {
  const userId = c.get('userId');
  const updates = c.req.valid('json');
  const authService = new AuthService(c.env, c.env.DB);

  const user = await authService.updateUser(userId, updates);

  return c.json({ user });
});

/**
 * GET /users/me/sessions - Get all active sessions for current user
 */
users.get('/me/sessions', async (c) => {
  const userId = c.get('userId');
  const authService = new AuthService(c.env, c.env.DB);

  const sessions = await authService.getUserSessions(userId);

  return c.json({ sessions });
});

/**
 * DELETE /users/me/sessions/:sessionId - Revoke a specific session
 */
users.delete('/me/sessions/:sessionId', async (c) => {
  const userId = c.get('userId');
  const sessionId = c.req.param('sessionId');
  const authService = new AuthService(c.env, c.env.DB);

  await authService.revokeSession(userId, sessionId);

  return c.body(null, 204);
});

/**
 * DELETE /users/me/sessions - Revoke all sessions except current
 */
users.delete('/me/sessions', async (c) => {
  const userId = c.get('userId');
  const currentToken = c.req.header('Authorization')?.replace('Bearer ', '');
  const authService = new AuthService(c.env, c.env.DB);

  await authService.revokeAllSessionsExceptCurrent(userId, currentToken);

  return c.json({ message: 'All other sessions have been revoked' });
});

/**
 * GET /users/:id - Get user by ID
 */
users.get('/:id', async (c) => {
  const targetUserId = c.req.param('id');
  const authService = new AuthService(c.env, c.env.DB);

  const user = await authService.getUserById(targetUserId);
  if (!user) {
    throw new NotFoundError('User');
  }

  return c.json({ user });
});

/**
 * GET /users/me/onboarding - Get onboarding status
 */
users.get('/me/onboarding', async (c) => {
  const userId = c.get('userId');
  const authService = new AuthService(c.env, c.env.DB);

  const status = await authService.getOnboardingStatus(userId);

  return c.json(status);
});

/**
 * POST /users/me/onboarding/:step - Update onboarding progress
 * Steps: household, report, garbage, floor_plan, complete
 */
users.post('/me/onboarding/:step', async (c) => {
  const userId = c.get('userId');
  const step = c.req.param('step') as 'household' | 'report' | 'garbage' | 'floor_plan' | 'complete';

  const validSteps = ['household', 'report', 'garbage', 'floor_plan', 'complete'];
  if (!validSteps.includes(step)) {
    return c.json({ error: 'Invalid onboarding step' }, 400);
  }

  const authService = new AuthService(c.env, c.env.DB);
  const user = await authService.updateOnboardingProgress(userId, step);

  return c.json({ user });
});

export default users;
