import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { MESSAGE_DIRECTIONS, MESSAGE_CHANNELS } from '../db/schema-labor-hub';
import { authMiddleware } from '../middleware/auth';
import { MessageService } from '../services/message-service';
import type { Env } from '../types';

const messagesRouter = new Hono<{ Bindings: Env }>();

// All routes require authentication
messagesRouter.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// ============ VALIDATION SCHEMAS ============

const createMessageSchema = z.object({
  contractor_id: z.string().uuid(),
  direction: z.enum(MESSAGE_DIRECTIONS),
  channel: z.enum(MESSAGE_CHANNELS),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(10000),
  attachments: z.array(z.string()).max(10).optional(),
});

const filterSchema = z.object({
  contractor_id: z.string().uuid().optional(),
  channel: z.enum(MESSAGE_CHANNELS).optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const applyTemplateSchema = z.object({
  variables: z.record(z.string()),
});

// ============ MESSAGE ROUTES ============

/**
 * GET /households/:householdId/messages
 * Get all messages with optional filters
 */
messagesRouter.get('/', zValidator('query', filterSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const filters = c.req.valid('query');
  const service = new MessageService(c.env, c.env.DB);

  const messages = await service.getMessages(householdId, userId, {
    contractorId: filters.contractor_id,
    channel: filters.channel,
    status: filters.status,
    limit: filters.limit,
  });

  return c.json({ messages });
});

/**
 * GET /households/:householdId/messages/conversations
 * Get conversation summaries
 */
messagesRouter.get('/conversations', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new MessageService(c.env, c.env.DB);

  const conversations = await service.getConversationSummaries(householdId, userId);

  return c.json({ conversations });
});

/**
 * GET /households/:householdId/messages/conversation/:contractorId
 * Get full conversation with a contractor
 */
messagesRouter.get('/conversation/:contractorId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const contractorId = c.req.param('contractorId');
  const service = new MessageService(c.env, c.env.DB);

  const messages = await service.getConversation(householdId, contractorId!, userId);

  return c.json({ messages });
});

/**
 * GET /households/:householdId/messages/:id
 * Get single message
 */
messagesRouter.get('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const messageId = c.req.param('id');
  const service = new MessageService(c.env, c.env.DB);

  const message = await service.getMessage(householdId, messageId!, userId);

  return c.json({ message });
});

/**
 * POST /households/:householdId/messages
 * Create a new message
 */
messagesRouter.post('/', zValidator('json', createMessageSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new MessageService(c.env, c.env.DB);

  const message = await service.createMessage(householdId, input.contractor_id, userId, {
    direction: input.direction,
    channel: input.channel,
    subject: input.subject,
    body: input.body,
    attachments: input.attachments,
  });

  return c.json({ message }, 201);
});

/**
 * POST /households/:householdId/messages/:id/read
 * Mark message as read
 */
messagesRouter.post('/:id/read', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const messageId = c.req.param('id');
  const service = new MessageService(c.env, c.env.DB);

  const message = await service.markAsRead(householdId, messageId!, userId);

  return c.json({ message });
});

/**
 * POST /households/:householdId/messages/conversation/:contractorId/read
 * Mark all messages in conversation as read
 */
messagesRouter.post('/conversation/:contractorId/read', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const contractorId = c.req.param('contractorId');
  const service = new MessageService(c.env, c.env.DB);

  await service.markConversationAsRead(householdId, contractorId!, userId);

  return c.json({ success: true });
});

/**
 * DELETE /households/:householdId/messages/:id
 * Delete message
 */
messagesRouter.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const messageId = c.req.param('id');
  const service = new MessageService(c.env, c.env.DB);

  await service.deleteMessage(householdId, messageId!, userId);

  return c.body(null, 204);
});

// ============ TEMPLATE ROUTES ============

/**
 * GET /households/:householdId/messages/templates
 * Get all message templates
 */
messagesRouter.get('/templates/all', async (c) => {
  getHouseholdId(c);
  const category = c.req.query('category');
  const service = new MessageService(c.env, c.env.DB);

  const templates = await service.getTemplates(category);

  return c.json({ templates });
});

/**
 * GET /households/:householdId/messages/templates/:templateId
 * Get single template
 */
messagesRouter.get('/templates/:templateId', async (c) => {
  getHouseholdId(c);
  const templateId = c.req.param('templateId');
  const service = new MessageService(c.env, c.env.DB);

  const template = await service.getTemplate(templateId!);

  return c.json({ template });
});

/**
 * POST /households/:householdId/messages/templates/:templateId/apply
 * Apply template with variables
 */
messagesRouter.post(
  '/templates/:templateId/apply',
  zValidator('json', applyTemplateSchema),
  async (c) => {
    getHouseholdId(c);
    const templateId = c.req.param('templateId');
    const input = c.req.valid('json');
    const service = new MessageService(c.env, c.env.DB);

    const result = await service.applyTemplate(templateId!, input.variables);

    return c.json(result);
  }
);

export default messagesRouter;
