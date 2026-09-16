import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { createAnthropicAdapterForUser } from '../ai/provider-factory';
import { CHECKLIST_PRIORITIES } from '../db/schema-labor-hub';
import { authMiddleware } from '../middleware/auth';
import { assertCanUseAI } from '../services/entitlement-service';
import { VisitChecklistService } from '../services/visit-checklist-service';
import type { Env } from '../types';

const visitChecklistsRouter = new Hono<{ Bindings: Env }>();

// All routes require authentication
visitChecklistsRouter.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// ============ VALIDATION SCHEMAS ============

const createChecklistSchema = z.object({
  title: z.string().min(1).max(200),
  appointment_id: z.string().uuid().optional(),
  visit_id: z.string().uuid().optional(),
  template_id: z.string().uuid().optional(),
});

const updateChecklistSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  appointment_id: z.string().uuid().optional(),
  visit_id: z.string().uuid().optional(),
});

const createFromTemplateSchema = z.object({
  appointment_id: z.string().uuid().optional(),
  visit_id: z.string().uuid().optional(),
});

const addItemSchema = z.object({
  text: z.string().min(1).max(500),
  has_info_icon: z.boolean().optional(),
  technical_term: z.string().max(100).optional(),
  category: z.string().max(50).optional(),
  priority: z.enum(CHECKLIST_PRIORITIES).optional(),
});

const updateItemSchema = z.object({
  text: z.string().min(1).max(500).optional(),
  has_info_icon: z.boolean().optional(),
  technical_term: z.string().max(100).optional(),
  category: z.string().max(50).optional(),
  priority: z.enum(CHECKLIST_PRIORITIES).optional(),
  comment: z.string().max(2000).optional(),
  sort_order: z.number().int().min(0).optional(),
});

const checkItemSchema = z.object({
  checked: z.boolean(),
});

const voiceNoteSchema = z.object({
  voice_note_key: z.string().min(1),
});

const reorderItemsSchema = z.object({
  item_order: z.array(z.string().uuid()),
});

const aiConversationSchema = z.object({
  technical_term: z.string().min(1).max(100),
  checklist_item_id: z.string().uuid().optional(),
  context: z.record(z.unknown()).optional(),
});

const aiMessageSchema = z.object({
  content: z.string().min(1).max(2000),
});

const generateAISuggestionsSchema = z.object({
  task_id: z.string().uuid().optional(),
  task_category: z.string().max(50).optional(),
  task_title: z.string().max(200).optional(),
  task_description: z.string().max(2000).optional(),
  contractor_specialty: z.string().max(50).optional(),
  visit_purpose: z.string().max(100).optional(),
  image_descriptions: z.array(z.string().max(500)).optional(),
});

const addPhotoSchema = z.object({
  photo_key: z.string().min(1),
  thumbnail_key: z.string().optional(),
  caption: z.string().max(500).optional(),
  taken_at: z.string().optional(),
  file_size: z.number().int().min(0).optional(),
  mime_type: z.string().max(50).optional(),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
});

// ============ CHECKLIST ROUTES ============

/**
 * GET /households/:householdId/visit-checklists
 * List all checklists for household
 */
visitChecklistsRouter.get('/', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new VisitChecklistService(c.env, c.env.DB);

  const checklists = await service.getChecklists(householdId, userId);

  return c.json({ checklists });
});

/**
 * GET /households/:householdId/visit-checklists/:id
 * Get checklist with items
 */
visitChecklistsRouter.get('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const service = new VisitChecklistService(c.env, c.env.DB);

  const checklist = await service.getChecklist(householdId, checklistId!, userId);

  return c.json({ checklist });
});

/**
 * POST /households/:householdId/visit-checklists
 * Create new checklist
 */
visitChecklistsRouter.post('/', zValidator('json', createChecklistSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new VisitChecklistService(c.env, c.env.DB);

  const checklist = await service.createChecklist(householdId, userId, {
    title: input.title,
    appointmentId: input.appointment_id,
    visitId: input.visit_id,
    templateId: input.template_id,
  });

  return c.json({ checklist }, 201);
});

/**
 * POST /households/:householdId/visit-checklists/from-template/:templateId
 * Create checklist from template
 */
visitChecklistsRouter.post(
  '/from-template/:templateId',
  zValidator('json', createFromTemplateSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const templateId = c.req.param('templateId');
    const input = c.req.valid('json');
    const service = new VisitChecklistService(c.env, c.env.DB);

    const checklist = await service.createChecklistFromTemplate(householdId, userId, templateId!, {
      appointmentId: input.appointment_id,
      visitId: input.visit_id,
    });

    return c.json({ checklist }, 201);
  }
);

/**
 * PATCH /households/:householdId/visit-checklists/:id
 * Update checklist
 */
visitChecklistsRouter.patch('/:id', zValidator('json', updateChecklistSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const input = c.req.valid('json');
  const service = new VisitChecklistService(c.env, c.env.DB);

  const checklist = await service.updateChecklist(householdId, checklistId!, userId, {
    title: input.title,
    appointmentId: input.appointment_id,
    visitId: input.visit_id,
  });

  return c.json({ checklist });
});

/**
 * DELETE /households/:householdId/visit-checklists/:id
 * Delete checklist
 */
visitChecklistsRouter.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const service = new VisitChecklistService(c.env, c.env.DB);

  await service.deleteChecklist(householdId, checklistId!, userId);

  return c.body(null, 204);
});

// ============ CHECKLIST ITEM ROUTES ============

/**
 * POST /households/:householdId/visit-checklists/:id/items
 * Add item to checklist
 */
visitChecklistsRouter.post('/:id/items', zValidator('json', addItemSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const input = c.req.valid('json');
  const service = new VisitChecklistService(c.env, c.env.DB);

  const item = await service.addItem(householdId, checklistId!, userId, {
    text: input.text,
    hasInfoIcon: input.has_info_icon,
    technicalTerm: input.technical_term,
    category: input.category,
    priority: input.priority,
  });

  return c.json({ item }, 201);
});

/**
 * PATCH /households/:householdId/visit-checklists/:id/items/:itemId
 * Update item
 */
visitChecklistsRouter.patch('/:id/items/:itemId', zValidator('json', updateItemSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const input = c.req.valid('json');
  const service = new VisitChecklistService(c.env, c.env.DB);

  const item = await service.updateItem(householdId, checklistId!, itemId!, userId, {
    text: input.text,
    hasInfoIcon: input.has_info_icon,
    technicalTerm: input.technical_term,
    category: input.category,
    priority: input.priority,
    comment: input.comment,
    sortOrder: input.sort_order,
  });

  return c.json({ item });
});

/**
 * DELETE /households/:householdId/visit-checklists/:id/items/:itemId
 * Delete item
 */
visitChecklistsRouter.delete('/:id/items/:itemId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const service = new VisitChecklistService(c.env, c.env.DB);

  await service.deleteItem(householdId, checklistId!, itemId!, userId);

  return c.body(null, 204);
});

/**
 * PUT /households/:householdId/visit-checklists/:id/items/:itemId/check
 * Toggle item check status
 */
visitChecklistsRouter.put('/:id/items/:itemId/check', zValidator('json', checkItemSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const input = c.req.valid('json');
  const service = new VisitChecklistService(c.env, c.env.DB);

  const item = await service.checkItem(householdId, checklistId!, itemId!, userId, input.checked);

  return c.json({ item });
});

/**
 * POST /households/:householdId/visit-checklists/:id/items/:itemId/voice-note
 * Add voice note to item
 */
visitChecklistsRouter.post('/:id/items/:itemId/voice-note', zValidator('json', voiceNoteSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const input = c.req.valid('json');
  const service = new VisitChecklistService(c.env, c.env.DB);

  const item = await service.addVoiceNoteToItem(householdId, checklistId!, itemId!, userId, input.voice_note_key);

  return c.json({ item });
});

/**
 * PUT /households/:householdId/visit-checklists/:id/reorder
 * Reorder checklist items
 */
visitChecklistsRouter.put('/:id/reorder', zValidator('json', reorderItemsSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const input = c.req.valid('json');
  const service = new VisitChecklistService(c.env, c.env.DB);

  const checklist = await service.reorderItems(householdId, checklistId!, userId, input.item_order);

  return c.json({ checklist });
});

// ============ TEMPLATE ROUTES ============

/**
 * GET /households/:householdId/visit-checklists/templates
 * List all templates
 */
visitChecklistsRouter.get('/templates/all', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new VisitChecklistService(c.env, c.env.DB);

  // Just verify access
  await service.getChecklists(householdId, userId);

  const templates = await service.getTemplates();

  return c.json({ templates });
});

/**
 * GET /households/:householdId/visit-checklists/templates/category/:category
 * Get templates by category
 */
visitChecklistsRouter.get('/templates/category/:category', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const category = c.req.param('category');
  const service = new VisitChecklistService(c.env, c.env.DB);

  // Just verify access
  await service.getChecklists(householdId, userId);

  const templates = await service.getTemplatesByCategory(category!);

  return c.json({ templates });
});

/**
 * GET /households/:householdId/visit-checklists/templates/:templateId
 * Get single template
 */
visitChecklistsRouter.get('/templates/:templateId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const templateId = c.req.param('templateId');
  const service = new VisitChecklistService(c.env, c.env.DB);

  // Just verify access
  await service.getChecklists(householdId, userId);

  const template = await service.getTemplate(templateId!);

  return c.json({ template });
});

// ============ AI INFO ROUTES ============

/**
 * POST /households/:householdId/visit-checklists/ai/conversation
 * Start or get AI conversation for technical term
 */
visitChecklistsRouter.post('/ai/conversation', zValidator('json', aiConversationSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new VisitChecklistService(c.env, c.env.DB);

  const conversation = await service.getOrCreateAIConversation(
    householdId,
    userId,
    input.technical_term,
    input.checklist_item_id,
    input.context
  );

  // Also get technical term info if available
  const termInfo = await service.getTechnicalTerm(input.technical_term);

  return c.json({ conversation, term_info: termInfo });
});

/**
 * POST /households/:householdId/visit-checklists/ai/conversation/:conversationId/message
 * Add message to AI conversation
 */
visitChecklistsRouter.post(
  '/ai/conversation/:conversationId/message',
  zValidator('json', aiMessageSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const conversationId = c.req.param('conversationId');
    const input = c.req.valid('json');
    await assertCanUseAI(userId, c.env);
    const service = new VisitChecklistService(c.env, c.env.DB);

    // Add user message first
    const conversationWithUserMessage = await service.addMessageToAIConversation(
      householdId,
      conversationId!,
      userId,
      'user',
      input.content
    );

    // Generate AI response using Claude
    let aiResponse: string;

    try {
      // Get technical term info for system prompt
      const termInfo = await service.getTechnicalTerm(conversationWithUserMessage.technical_term);

      // Parse existing messages for context
      const existingMessages = JSON.parse(conversationWithUserMessage.messages_json || '[]') as Array<{
        role: 'user' | 'assistant';
        content: string;
        timestamp: string;
      }>;

      // Build system prompt
      const basePrompt = termInfo?.base_prompt || '';
      const contextJson = conversationWithUserMessage.context_json
        ? JSON.parse(conversationWithUserMessage.context_json)
        : {};

      const systemPrompt = `You are a knowledgeable home maintenance assistant helping homeowners understand technical terms and concepts related to their home. You provide clear, helpful explanations that are educational but not overly technical.

${basePrompt ? `Technical Background:\n${basePrompt}\n\n` : ''}Topic: ${conversationWithUserMessage.technical_term.replace(/_/g, ' ')}
${termInfo?.display_name ? `Display Name: ${termInfo.display_name}` : ''}
${termInfo?.category ? `Category: ${termInfo.category}` : ''}
${contextJson.visitPurpose ? `Visit Purpose: ${contextJson.visitPurpose}` : ''}
${contextJson.contractorSpecialty ? `Contractor Specialty: ${contextJson.contractorSpecialty}` : ''}
${contextJson.homeDetails?.yearBuilt ? `Home Year Built: ${contextJson.homeDetails.yearBuilt}` : ''}

Guidelines:
- Provide clear, actionable information that helps homeowners make informed decisions
- Explain technical concepts in simple terms without being condescending
- Include relevant questions the homeowner might want to ask their contractor
- Mention typical costs or ranges when relevant
- Keep responses focused and concise (2-4 paragraphs)
- Be helpful and reassuring while being honest about potential concerns`;

      // Build messages array for Claude
      const claudeMessages: Array<{ role: 'user' | 'assistant'; content: string }> = existingMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const provider = await createAnthropicAdapterForUser(
        c.env,
        userId,
        {
          feature: 'visit_checklist_chat',
          householdId: c.req.param('householdId') ?? null,
          userId,
        },
        'claude-sonnet-4-5-20250929'
      );

      const result = await provider.generate({
        model: 'claude-sonnet-4-5-20250929',
        systemPrompt,
        messages: claudeMessages.map((msg) => ({ role: msg.role, content: msg.content })),
        maxTokens: 1024,
      });

      aiResponse =
        result.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n') ||
        'I apologize, but I was unable to generate a response. Please try again.';
    } catch (error) {
      console.error('Error generating AI response:', error);
      aiResponse = 'I apologize, but I encountered an error while generating a response. Please try again later.';
    }

    // Add assistant response to conversation
    const conversation = await service.addMessageToAIConversation(
      householdId,
      conversationId!,
      userId,
      'assistant',
      aiResponse
    );

    return c.json({ conversation });
  }
);

/**
 * GET /households/:householdId/visit-checklists/technical-terms/:termKey
 * Get technical term info
 */
visitChecklistsRouter.get('/technical-terms/:termKey', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const termKey = c.req.param('termKey');
  const service = new VisitChecklistService(c.env, c.env.DB);

  // Just verify access
  await service.getChecklists(householdId, userId);

  const term = await service.getTechnicalTerm(termKey!);

  if (!term) {
    return c.json({ term: null });
  }

  return c.json({ term });
});

// ============ AI SUGGESTION GENERATION ============

/**
 * POST /households/:householdId/visit-checklists/:id/generate-ai-suggestions
 * Generate AI question suggestions for checklist
 */
visitChecklistsRouter.post(
  '/:id/generate-ai-suggestions',
  zValidator('json', generateAISuggestionsSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    await assertCanUseAI(userId, c.env);
    const checklistId = c.req.param('id');
    const input = c.req.valid('json');
    const service = new VisitChecklistService(c.env, c.env.DB);

    const result = await service.generateAISuggestions(householdId, checklistId!, userId, {
      taskId: input.task_id,
      taskCategory: input.task_category,
      taskTitle: input.task_title,
      taskDescription: input.task_description,
      contractorSpecialty: input.contractor_specialty,
      visitPurpose: input.visit_purpose,
      imageDescriptions: input.image_descriptions,
    });

    return c.json({ suggestions: result.suggestions, ai_context: result.aiContext }, 201);
  }
);

/**
 * POST /households/:householdId/visit-checklists/:id/items/:itemId/accept
 * Accept AI suggestion
 */
visitChecklistsRouter.post('/:id/items/:itemId/accept', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const service = new VisitChecklistService(c.env, c.env.DB);

  const item = await service.acceptAISuggestion(householdId, checklistId!, itemId!, userId);

  return c.json({ item });
});

/**
 * POST /households/:householdId/visit-checklists/:id/items/:itemId/dismiss
 * Dismiss AI suggestion
 */
visitChecklistsRouter.post('/:id/items/:itemId/dismiss', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const service = new VisitChecklistService(c.env, c.env.DB);

  await service.dismissAISuggestion(householdId, checklistId!, itemId!, userId);

  return c.body(null, 204);
});

// ============ PHOTO MANAGEMENT ============

/**
 * POST /households/:householdId/visit-checklists/:id/items/:itemId/photos
 * Add photo to checklist item
 */
visitChecklistsRouter.post('/:id/items/:itemId/photos', zValidator('json', addPhotoSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const input = c.req.valid('json');
  const service = new VisitChecklistService(c.env, c.env.DB);

  const photo = await service.addPhotoToItem(householdId, checklistId!, itemId!, userId, {
    photoKey: input.photo_key,
    thumbnailKey: input.thumbnail_key,
    caption: input.caption,
    takenAt: input.taken_at,
    fileSize: input.file_size,
    mimeType: input.mime_type,
    width: input.width,
    height: input.height,
  });

  return c.json({ photo }, 201);
});

/**
 * GET /households/:householdId/visit-checklists/:id/items/:itemId/photos
 * Get photos for checklist item
 */
visitChecklistsRouter.get('/:id/items/:itemId/photos', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const service = new VisitChecklistService(c.env, c.env.DB);

  const photos = await service.getPhotosForItem(householdId, checklistId!, itemId!, userId);

  return c.json({ photos });
});

/**
 * DELETE /households/:householdId/visit-checklists/:id/items/:itemId/photos/:photoId
 * Delete photo from checklist item
 */
visitChecklistsRouter.delete('/:id/items/:itemId/photos/:photoId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const checklistId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const photoId = c.req.param('photoId');
  const service = new VisitChecklistService(c.env, c.env.DB);

  await service.deletePhotoFromItem(householdId, checklistId!, itemId!, photoId!, userId);

  return c.body(null, 204);
});

// ============ MULTI-CONTRACTOR COMPARISON ============

/**
 * GET /households/:householdId/visit-checklists/for-task/:taskId
 * Get all checklists for a task (for comparison)
 */
visitChecklistsRouter.get('/for-task/:taskId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('taskId');
  const service = new VisitChecklistService(c.env, c.env.DB);

  const checklists = await service.getChecklistsForTask(householdId, taskId!, userId);

  return c.json({ checklists });
});

/**
 * GET /households/:householdId/visit-checklists/comparison/:taskId
 * Get multi-contractor comparison data for a task
 */
visitChecklistsRouter.get('/comparison/:taskId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('taskId');
  const service = new VisitChecklistService(c.env, c.env.DB);

  const comparison = await service.getMultiContractorComparison(householdId, taskId!, userId);

  return c.json(comparison);
});

export default visitChecklistsRouter;
