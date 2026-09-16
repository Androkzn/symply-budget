import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { rateLimitDO } from '../middleware/rate-limit';
import { requireAIEntitlement } from '../middleware/require-ai-entitlement';
import { ChatService } from '../services/chat-service';
import type { Env } from '../types';

const chat = new Hono<{ Bindings: Env }>();

// All chat routes require authentication
chat.use('/*', authMiddleware());

const chatMessageSchema = z.object({
  message: z.string().min(1).max(2000),
  report_id: z.string().optional(),
});

/**
 * POST /households/:householdId/chat - Send a chat message
 *
 * Asking a question about a report is inference, so it needs an entitlement.
 * `/suggestions` below is not gated — it is built from the report's own findings
 * rows, no model involved, and is what a member without AI still sees.
 */
chat.post(
  '/',
  rateLimitDO('chat:message'),
  requireAIEntitlement(),
  zValidator('json', chatMessageSchema),
  async (c) => {
    const householdId = c.req.param('householdId') as string;
    const userId = c.get('userId');
    const { message, report_id } = c.req.valid('json');
    const chatService = new ChatService(c.env, c.env.DB);

    const response = await chatService.chat(householdId, userId, message, report_id);

    return c.json(response);
  }
);

/**
 * GET /households/:householdId/chat/suggestions - Get chat suggestions
 */
chat.get('/suggestions', async (c) => {
  const householdId = c.req.param('householdId') as string;
  const userId = c.get('userId');
  const reportId = c.req.query('report_id');
  const chatService = new ChatService(c.env, c.env.DB);

  const suggestions = await chatService.getSuggestions(householdId, userId, reportId);

  return c.json({ suggestions });
});

export default chat;
