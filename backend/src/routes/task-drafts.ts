import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { assertCanUseAI } from '../services/entitlement-service';
import { TaskDraftService } from '../services/task-draft-service';
import type { Env } from '../types';

const taskDrafts = new Hono<{ Bindings: Env }>();

// All routes require authentication
taskDrafts.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// Validation schemas
const taskDraftsQuerySchema = z.object({
  report_id: z.string().optional(),
  status: z.enum(['draft', 'converted', 'dismissed']).optional(),
  severity: z.enum(['critical', 'major', 'minor', 'informational']).optional(),
  system_category: z.string().optional(),
  sort_by: z.enum(['severity', 'category', 'priority_score', 'created_at']).optional(),
  sort_order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

const convertDraftSchema = z.object({
  add_recurring: z.boolean().optional(),
  frequency: z.string().optional(),
  start_date: z.string().optional(),
});

const bulkConvertSchema = z.object({
  draft_ids: z.array(z.string()).min(1).max(50),
});

const dismissDraftSchema = z.object({
  reason: z.string().optional(),
});

/**
 * GET /households/:householdId/task-drafts
 * List task drafts with filtering and sorting
 */
taskDrafts.get('/', zValidator('query', taskDraftsQuerySchema), async (c) => {
  const householdId = getHouseholdId(c);
  const query = c.req.valid('query');
  const service = new TaskDraftService(c.env, c.env.DB);

  const result = await service.getTaskDrafts(householdId, {
    reportId: query.report_id,
    status: query.status,
    severity: query.severity,
    systemCategory: query.system_category,
    sortBy: query.sort_by,
    sortOrder: query.sort_order,
    limit: query.limit,
    offset: query.offset,
  });

  return c.json(result);
});

/**
 * GET /households/:householdId/task-drafts/summary
 * Get summary statistics for task drafts
 */
taskDrafts.get('/summary', async (c) => {
  const householdId = getHouseholdId(c);
  const reportId = c.req.query('report_id');
  const service = new TaskDraftService(c.env, c.env.DB);

  const summary = await service.getTaskDraftsSummary(householdId, reportId);

  return c.json({ summary });
});

/**
 * POST /households/:householdId/task-drafts/generate
 * Generate task drafts from a report's findings
 */
taskDrafts.post('/generate', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await assertCanUseAI(userId, c.env);
  const { report_id } = await c.req.json();

  if (!report_id) {
    return c.json({ error: 'report_id is required' }, 400);
  }

  const service = new TaskDraftService(c.env, c.env.DB, userId);
  const result = await service.generateTaskDraftsFromReport(report_id, householdId);

  if (result.error) {
    return c.json({ error: result.error, draftsCreated: result.draftsCreated }, 500);
  }

  return c.json({ draftsCreated: result.draftsCreated }, 201);
});

/**
 * POST /households/:householdId/task-drafts/bulk-convert
 * Convert multiple drafts at once
 */
taskDrafts.post('/bulk-convert', zValidator('json', bulkConvertSchema), async (c) => {
  const householdId = getHouseholdId(c);
  const { draft_ids } = c.req.valid('json');
  const service = new TaskDraftService(c.env, c.env.DB);

  const result = await service.bulkConvert(draft_ids, householdId);

  return c.json(result);
});

/**
 * GET /households/:householdId/task-drafts/:id
 * Get a single task draft with related data
 */
taskDrafts.get('/:id', async (c) => {
  const householdId = getHouseholdId(c);
  const draftId = c.req.param('id');
  const service = new TaskDraftService(c.env, c.env.DB);

  const draft = await service.getTaskDraft(draftId!, householdId);

  if (!draft) {
    return c.json({ error: 'Task draft not found' }, 404);
  }

  return c.json({ draft });
});

/**
 * POST /households/:householdId/task-drafts/:id/convert
 * Convert a task draft to a task
 */
taskDrafts.post('/:id/convert', zValidator('json', convertDraftSchema), async (c) => {
  const householdId = getHouseholdId(c);
  const draftId = c.req.param('id');
  const input = c.req.valid('json');
  const service = new TaskDraftService(c.env, c.env.DB);

  try {
    const result = await service.convertToMaintenanceTask(draftId!, householdId, {
      addRecurring: input.add_recurring,
      frequency: input.frequency,
      startDate: input.start_date,
    });

    return c.json(result, 201);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Conversion failed' },
      400
    );
  }
});

/**
 * POST /households/:householdId/task-drafts/:id/dismiss
 * Dismiss a task draft
 */
taskDrafts.post('/:id/dismiss', zValidator('json', dismissDraftSchema), async (c) => {
  const householdId = getHouseholdId(c);
  const draftId = c.req.param('id');
  const { reason } = c.req.valid('json');
  const service = new TaskDraftService(c.env, c.env.DB);

  const result = await service.dismissDraft(draftId!, householdId, reason);

  return c.json(result);
});

/**
 * DELETE /households/:householdId/task-drafts/:id
 * Delete a task draft
 */
taskDrafts.delete('/:id', async (c) => {
  const householdId = getHouseholdId(c);
  const draftId = c.req.param('id');
  const service = new TaskDraftService(c.env, c.env.DB);

  const result = await service.deleteDraft(draftId!, householdId);

  return c.json(result);
});

export default taskDrafts;
