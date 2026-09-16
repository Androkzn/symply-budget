import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { PROJECT_STATUSES, MILESTONE_STATUSES, PAYMENT_TYPES, PAYMENT_STATUSES } from '../db/schema-labor-hub';
import { authMiddleware } from '../middleware/auth';
import { ProjectService } from '../services/project-service';
import type { Env } from '../types';

const projectsRouter = new Hono<{ Bindings: Env }>();

// All routes require authentication
projectsRouter.use('/*', authMiddleware());

// Helper to get householdId
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// ============ VALIDATION SCHEMAS ============

const createProjectSchema = z.object({
  contractor_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  quote_id: z.string().uuid().optional(),
  start_date: z.string().optional(),
  estimated_end_date: z.string().optional(),
  total_budget_cents: z.number().int().min(0).optional(),
  linked_report_id: z.string().uuid().optional(),
  linked_task_ids: z.array(z.string().uuid()).optional(),
  notes: z.string().max(2000).optional(),
});

const updateProjectSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  start_date: z.string().optional(),
  estimated_end_date: z.string().optional(),
  actual_end_date: z.string().optional(),
  total_budget_cents: z.number().int().min(0).optional(),
  total_spent_cents: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
});

const projectFiltersSchema = z.object({
  contractor_id: z.string().uuid().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  active_only: z.coerce.boolean().optional(),
});

const createMilestoneSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  due_date: z.string().optional(),
  sort_order: z.number().int().optional(),
});

const updateMilestoneSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  status: z.enum(MILESTONE_STATUSES).optional(),
  due_date: z.string().optional(),
  completed_date: z.string().optional(),
  notes: z.string().max(1000).optional(),
  sort_order: z.number().int().optional(),
});

const createPaymentSchema = z.object({
  type: z.enum(PAYMENT_TYPES),
  amount_cents: z.number().int().min(0),
  due_date: z.string().optional(),
  notes: z.string().max(500).optional(),
});

const updatePaymentSchema = z.object({
  type: z.enum(PAYMENT_TYPES).optional(),
  amount_cents: z.number().int().min(0).optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  due_date: z.string().optional(),
  paid_date: z.string().optional(),
  receipt_document_key: z.string().optional(),
  notes: z.string().max(500).optional(),
});

const createProgressPhotoSchema = z.object({
  photo_key: z.string().min(1),
  caption: z.string().max(500).optional(),
  milestone_id: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
});

// ============ PROJECT ROUTES ============

/**
 * GET /households/:householdId/projects
 * List all projects
 */
projectsRouter.get('/', zValidator('query', projectFiltersSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const filters = c.req.valid('query');
  const service = new ProjectService(c.env, c.env.DB);

  const projects = await service.getProjects(householdId, userId, {
    contractorId: filters.contractor_id,
    status: filters.status,
    activeOnly: filters.active_only,
  });

  return c.json({ projects });
});

/**
 * GET /households/:householdId/projects/active
 * Get active projects (convenience endpoint)
 */
projectsRouter.get('/active', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new ProjectService(c.env, c.env.DB);

  const projects = await service.getProjects(householdId, userId, { activeOnly: true });

  return c.json({ projects });
});

/**
 * GET /households/:householdId/projects/:id
 * Get project detail with milestones and payments
 */
projectsRouter.get('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projectId = c.req.param('id');
  const service = new ProjectService(c.env, c.env.DB);

  const project = await service.getProject(householdId, projectId!, userId);

  return c.json({ project });
});

/**
 * POST /households/:householdId/projects
 * Create project
 */
projectsRouter.post('/', zValidator('json', createProjectSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new ProjectService(c.env, c.env.DB);

  const project = await service.createProject(householdId, userId, {
    contractorId: input.contractor_id,
    title: input.title,
    description: input.description,
    quoteId: input.quote_id,
    startDate: input.start_date,
    estimatedEndDate: input.estimated_end_date,
    totalBudgetCents: input.total_budget_cents,
    linkedReportId: input.linked_report_id,
    linkedTaskIds: input.linked_task_ids,
    notes: input.notes,
  });

  return c.json({ project }, 201);
});

/**
 * PATCH /households/:householdId/projects/:id
 * Update project
 */
projectsRouter.patch('/:id', zValidator('json', updateProjectSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projectId = c.req.param('id');
  const input = c.req.valid('json');
  const service = new ProjectService(c.env, c.env.DB);

  const project = await service.updateProject(householdId, projectId!, userId, {
    title: input.title,
    description: input.description,
    status: input.status,
    startDate: input.start_date,
    estimatedEndDate: input.estimated_end_date,
    actualEndDate: input.actual_end_date,
    totalBudgetCents: input.total_budget_cents,
    totalSpentCents: input.total_spent_cents,
    notes: input.notes,
  });

  return c.json({ project });
});

/**
 * DELETE /households/:householdId/projects/:id
 * Delete project
 */
projectsRouter.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projectId = c.req.param('id');
  const service = new ProjectService(c.env, c.env.DB);

  await service.deleteProject(householdId, projectId!, userId);

  return c.body(null, 204);
});

// ============ MILESTONE ROUTES ============

/**
 * GET /households/:householdId/projects/:projectId/milestones
 * List project milestones
 */
projectsRouter.get('/:projectId/milestones', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projectId = c.req.param('projectId');
  const service = new ProjectService(c.env, c.env.DB);

  const milestones = await service.getMilestones(householdId, projectId!, userId);

  return c.json({ milestones });
});

/**
 * POST /households/:householdId/projects/:projectId/milestones
 * Create milestone
 */
projectsRouter.post('/:projectId/milestones', zValidator('json', createMilestoneSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projectId = c.req.param('projectId');
  const input = c.req.valid('json');
  const service = new ProjectService(c.env, c.env.DB);

  const milestone = await service.createMilestone(householdId, projectId!, userId, {
    title: input.title,
    description: input.description,
    dueDate: input.due_date,
    sortOrder: input.sort_order,
  });

  return c.json({ milestone }, 201);
});

/**
 * PATCH /households/:householdId/projects/:projectId/milestones/:milestoneId
 * Update milestone
 */
projectsRouter.patch('/:projectId/milestones/:milestoneId', zValidator('json', updateMilestoneSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projectId = c.req.param('projectId');
  const milestoneId = c.req.param('milestoneId');
  const input = c.req.valid('json');
  const service = new ProjectService(c.env, c.env.DB);

  const milestone = await service.updateMilestone(householdId, projectId!, milestoneId!, userId, {
    title: input.title,
    description: input.description,
    status: input.status,
    dueDate: input.due_date,
    completedDate: input.completed_date,
    notes: input.notes,
    sortOrder: input.sort_order,
  });

  return c.json({ milestone });
});

/**
 * DELETE /households/:householdId/projects/:projectId/milestones/:milestoneId
 * Delete milestone
 */
projectsRouter.delete('/:projectId/milestones/:milestoneId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projectId = c.req.param('projectId');
  const milestoneId = c.req.param('milestoneId');
  const service = new ProjectService(c.env, c.env.DB);

  await service.deleteMilestone(householdId, projectId!, milestoneId!, userId);

  return c.body(null, 204);
});

/**
 * POST /households/:householdId/projects/:projectId/milestones/:milestoneId/complete
 * Mark milestone as completed
 */
projectsRouter.post('/:projectId/milestones/:milestoneId/complete', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projectId = c.req.param('projectId');
  const milestoneId = c.req.param('milestoneId');
  const service = new ProjectService(c.env, c.env.DB);

  const milestone = await service.completeMilestone(householdId, projectId!, milestoneId!, userId);

  return c.json({ milestone });
});

// ============ PAYMENT ROUTES ============

/**
 * GET /households/:householdId/projects/:projectId/payments
 * List project payments
 */
projectsRouter.get('/:projectId/payments', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projectId = c.req.param('projectId');
  const service = new ProjectService(c.env, c.env.DB);

  const payments = await service.getPayments(householdId, projectId!, userId);

  return c.json({ payments });
});

/**
 * POST /households/:householdId/projects/:projectId/payments
 * Create payment
 */
projectsRouter.post('/:projectId/payments', zValidator('json', createPaymentSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projectId = c.req.param('projectId');
  const input = c.req.valid('json');
  const service = new ProjectService(c.env, c.env.DB);

  const payment = await service.createPayment(householdId, projectId!, userId, {
    type: input.type,
    amountCents: input.amount_cents,
    dueDate: input.due_date,
    notes: input.notes,
  });

  return c.json({ payment }, 201);
});

/**
 * PATCH /households/:householdId/projects/:projectId/payments/:paymentId
 * Update payment
 */
projectsRouter.patch('/:projectId/payments/:paymentId', zValidator('json', updatePaymentSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projectId = c.req.param('projectId');
  const paymentId = c.req.param('paymentId');
  const input = c.req.valid('json');
  const service = new ProjectService(c.env, c.env.DB);

  const payment = await service.updatePayment(householdId, projectId!, paymentId!, userId, {
    type: input.type,
    amountCents: input.amount_cents,
    status: input.status,
    dueDate: input.due_date,
    paidDate: input.paid_date,
    receiptDocumentKey: input.receipt_document_key,
    notes: input.notes,
  });

  return c.json({ payment });
});

/**
 * POST /households/:householdId/projects/:projectId/payments/:paymentId/mark-paid
 * Mark payment as paid
 */
projectsRouter.post('/:projectId/payments/:paymentId/mark-paid', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projectId = c.req.param('projectId');
  const paymentId = c.req.param('paymentId');
  const body = await c.req.json().catch(() => ({}));
  const service = new ProjectService(c.env, c.env.DB);

  const payment = await service.markPaymentPaid(householdId, projectId!, paymentId!, userId, body.receipt_document_key);

  return c.json({ payment });
});

// ============ PROGRESS PHOTO ROUTES ============

/**
 * GET /households/:householdId/projects/:projectId/photos
 * List project progress photos
 */
projectsRouter.get('/:projectId/photos', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projectId = c.req.param('projectId');
  const service = new ProjectService(c.env, c.env.DB);

  const photos = await service.getProgressPhotos(householdId, projectId!, userId);

  return c.json({ photos });
});

/**
 * POST /households/:householdId/projects/:projectId/photos
 * Add progress photo
 */
projectsRouter.post('/:projectId/photos', zValidator('json', createProgressPhotoSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projectId = c.req.param('projectId');
  const input = c.req.valid('json');
  const service = new ProjectService(c.env, c.env.DB);

  const photo = await service.addProgressPhoto(householdId, projectId!, userId, {
    photoKey: input.photo_key,
    caption: input.caption,
    milestoneId: input.milestone_id,
    tags: input.tags,
  });

  return c.json({ photo }, 201);
});

/**
 * DELETE /households/:householdId/projects/:projectId/photos/:photoId
 * Delete progress photo
 */
projectsRouter.delete('/:projectId/photos/:photoId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const projectId = c.req.param('projectId');
  const photoId = c.req.param('photoId');
  const service = new ProjectService(c.env, c.env.DB);

  await service.deleteProgressPhoto(householdId, projectId!, photoId!, userId);

  return c.body(null, 204);
});

export default projectsRouter;
