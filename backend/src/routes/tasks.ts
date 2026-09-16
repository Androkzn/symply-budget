import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { authMiddleware } from '../middleware/auth';
import { AppointmentService } from '../services/appointment-service';
import { BudgetService } from '../services/budget-service';
import { assertCanUseAI } from '../services/entitlement-service';
import { TaskPlannerService } from '../services/task-planner-service';
import { TaskService } from '../services/task-service';
import type { Env } from '../types';
import { NotFoundError, ForbiddenError, BadRequestError } from '../utils/errors';
import {
  createMaintenanceTaskSchema,
  quickCreateMaintenanceTaskSchema,
  updateMaintenanceTaskSchema,
  completeMaintenanceTaskSchema,
  maintenanceTaskFiltersSchema,
  paginationSchema,
} from '../utils/validation';

const maintenance = new Hono<{ Bindings: Env }>();

// All maintenance routes require authentication
maintenance.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

/**
 * GET /households/:householdId/tasks
 * List maintenance tasks for a household
 */
maintenance.get('/', zValidator('query', maintenanceTaskFiltersSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const filters = c.req.valid('query');
    console.log('[maintenance] List tasks for household:', householdId, 'user:', userId);
    const maintenanceService = new TaskService(c.env, c.env.DB);

    const result = await maintenanceService.listTasks(householdId, userId, filters);
    console.log('[maintenance] Listed', result.tasks.length, 'tasks');

    return c.json(result);
  } catch (error) {
    console.error('[maintenance] Error listing tasks:', (error as Error).message, (error as Error).stack);
    throw error;
  }
});

/**
 * GET /households/:householdId/tasks/upcoming
 * Get upcoming tasks (due within next 7 days by default)
 */
maintenance.get('/upcoming', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const daysAhead = parseInt(c.req.query('days') || '7', 10);
  const maintenanceService = new TaskService(c.env, c.env.DB);

  const tasks = await maintenanceService.getUpcomingTasks(householdId, userId, daysAhead);

  return c.json({ tasks });
});

/**
 * GET /households/:householdId/tasks/watch
 * Apple Watch companion feed. Returns a BARE JSON array of Watch-shaped tasks
 * (see TaskService.getWatchTasks). The Watch decodes `[WatchTask]` directly, so
 * this endpoint intentionally does NOT wrap the array in an object.
 */
maintenance.get('/watch', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const daysAhead = parseInt(c.req.query('days') || '7', 10);
  const maintenanceService = new TaskService(c.env, c.env.DB);

  const tasks = await maintenanceService.getWatchTasks(
    householdId,
    userId,
    Number.isFinite(daysAhead) && daysAhead > 0 ? daysAhead : 7
  );

  return c.json(tasks);
});

/**
 * GET /households/:householdId/tasks/plan?minutes=60
 * "What can I do right now?" — deterministic selection of tasks (and partial
 * subtasks) that fit a time budget, ranked by priority + risk + urgency.
 * Registered before /:id so the static segment isn't captured by the param.
 */
maintenance.get('/plan', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const minutes = parseInt(c.req.query('minutes') || '60', 10);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new BadRequestError('minutes must be a positive number');
  }
  const planner = new TaskPlannerService(c.env, c.env.DB);
  const plan = await planner.getPlan(householdId, userId, minutes);
  return c.json({ plan });
});

/**
 * GET /households/:householdId/tasks/report
 * Actionable summary over active tasks (overdue / due-soon counts, high-risk
 * count, and the highest-priority items).
 */
maintenance.get('/report', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const planner = new TaskPlannerService(c.env, c.env.DB);
  const report = await planner.getReport(householdId, userId);
  return c.json({ report });
});

/**
 * POST /households/:householdId/tasks
 * Create a new maintenance task
 */
maintenance.post('/', zValidator('json', createMaintenanceTaskSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const maintenanceService = new TaskService(c.env, c.env.DB);

  const task = await maintenanceService.createTask(householdId, userId, input);

  return c.json({ task }, 201);
});

/**
 * POST /households/:householdId/tasks/quick
 * Smart Task Assistant fast capture: persist a minimal task instantly from a
 * raw voice/typed description and kick off async AI enrichment. Returns 201
 * immediately with the provisional task (enrichment_status='pending').
 */
maintenance.post('/quick', zValidator('json', quickCreateMaintenanceTaskSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { text, assigned_to, space_id, is_personal } = c.req.valid('json');
  const maintenanceService = new TaskService(c.env, c.env.DB);

  const task = await maintenanceService.createQuickTask(householdId, userId, text, {
    assigned_to,
    space_id: space_id ?? undefined,
    is_personal: is_personal ?? false,
  });

  return c.json({ task }, 201);
});

/**
 * POST /households/:householdId/tasks/:id/budget-item
 * Accept the AI "this task is a purchase" suggestion: create a planned-spending
 * item linked to the task and return both the new item and the refreshed task.
 * Idempotent — re-tapping returns the already-linked item.
 */
maintenance.post('/:id/budget-item', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('id');
  const budgetService = new BudgetService(c.env, c.env.DB);
  const item = await budgetService.createBudgetItemFromTask(householdId, userId, taskId);
  const maintenanceService = new TaskService(c.env, c.env.DB);
  const task = await maintenanceService.getTask(householdId, taskId, userId);
  return c.json({ item, task }, 201);
});

/**
 * POST /households/:householdId/tasks/:id/dismiss-purchase
 * Dismiss the "add to planned spending" suggestion for a task so the chip stops
 * showing (without creating a budget item).
 */
maintenance.post('/:id/dismiss-purchase', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('id');
  const maintenanceService = new TaskService(c.env, c.env.DB);
  const task = await maintenanceService.dismissPurchaseSuggestion(householdId, taskId, userId);
  return c.json({ task });
});

/**
 * GET /households/:householdId/tasks/:id
 * Get a single maintenance task
 */
maintenance.get('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('id');
  const maintenanceService = new TaskService(c.env, c.env.DB);

  const task = await maintenanceService.getTask(householdId, taskId, userId);

  return c.json({ task });
});

/**
 * PATCH /households/:householdId/tasks/:id
 * Update a maintenance task
 */
maintenance.patch('/:id', zValidator('json', updateMaintenanceTaskSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('id');
  const input = c.req.valid('json');
  const maintenanceService = new TaskService(c.env, c.env.DB);

  const task = await maintenanceService.updateTask(householdId, taskId, userId, input);

  return c.json({ task });
});

/**
 * DELETE /households/:householdId/tasks/:id
 * Delete a maintenance task
 */
maintenance.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('id');
  const maintenanceService = new TaskService(c.env, c.env.DB);

  await maintenanceService.deleteTask(householdId, taskId, userId);

  return c.body(null, 204);
});

/**
 * POST /households/:householdId/tasks/:id/complete
 * Complete a maintenance task
 */
maintenance.post(
  '/:id/complete',
  zValidator('json', completeMaintenanceTaskSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const taskId = c.req.param('id');
    const input = c.req.valid('json');
    const maintenanceService = new TaskService(c.env, c.env.DB);

    const result = await maintenanceService.completeTask(
      householdId,
      taskId,
      userId,
      input
    );

    return c.json(result);
  }
);

/**
 * GET /households/:householdId/tasks/:id/history
 * Get completion history for a task
 */
maintenance.get('/:id/history', zValidator('query', paginationSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('id');
  const filters = c.req.valid('query');
  const maintenanceService = new TaskService(c.env, c.env.DB);

  const result = await maintenanceService.getCompletionHistory(
    householdId,
    taskId,
    userId,
    filters
  );

  return c.json(result);
});

// ============ REMINDER MANAGEMENT ============

/**
 * POST /households/:householdId/tasks/:id/snooze
 * Snooze task reminders until a specific date/time
 */
maintenance.post('/:id/snooze', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('id');
  const body = await c.req.json();
  const maintenanceService = new TaskService(c.env, c.env.DB);

  if (!body.snooze_until) {
    return c.json({ error: 'snooze_until is required (ISO date string)' }, 400);
  }

  const task = await maintenanceService.snoozeTaskReminder(
    householdId,
    taskId,
    userId,
    body.snooze_until
  );

  return c.json({ task });
});

/**
 * POST /households/:householdId/tasks/:id/clear-snooze
 * Clear snooze for a task and resume normal reminders
 */
maintenance.post('/:id/clear-snooze', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('id');
  const maintenanceService = new TaskService(c.env, c.env.DB);

  const task = await maintenanceService.clearSnooze(
    householdId,
    taskId,
    userId
  );

  return c.json({ task });
});

// ============ BLOCKERS + ACTIVITY FEED ============

/**
 * POST /households/:householdId/tasks/:id/block
 * Flag a task as blocked with a reason (household sharing).
 */
maintenance.post('/:id/block', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) throw new BadRequestError('reason is required');
  const maintenanceService = new TaskService(c.env, c.env.DB);
  const task = await maintenanceService.reportBlocker(householdId, taskId, userId, reason);
  return c.json({ task });
});

/**
 * POST /households/:householdId/tasks/:id/unblock
 * Clear a task's blocked state (optionally with a resolution note).
 */
maintenance.post('/:id/unblock', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const note = typeof body.note === 'string' ? body.note : undefined;
  const maintenanceService = new TaskService(c.env, c.env.DB);
  const task = await maintenanceService.resolveBlocker(householdId, taskId, userId, note);
  return c.json({ task });
});

/**
 * GET /households/:householdId/tasks/:id/notes
 * List a task's household activity feed (newest first).
 */
maintenance.get('/:id/notes', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('id');
  const maintenanceService = new TaskService(c.env, c.env.DB);
  const notes = await maintenanceService.listNotes(householdId, taskId, userId);
  return c.json({ notes });
});

/**
 * POST /households/:householdId/tasks/:id/notes
 * Add a progress note to a task's activity feed.
 */
maintenance.post('/:id/notes', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) throw new BadRequestError('body is required');
  const maintenanceService = new TaskService(c.env, c.env.DB);
  const note = await maintenanceService.addNote(householdId, taskId, userId, 'progress', text);
  return c.json({ note }, 201);
});

// ============ QUOTE MANAGEMENT FOR TASKS ============

/**
 * GET /households/:householdId/tasks/:taskId/quotes
 * Get all quotes for a maintenance task
 */
maintenance.get('/:taskId/quotes', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('taskId');

  // Import QuoteService here to avoid circular dependency
  const { QuoteService } = await import('../services/quote-service');
  const quoteService = new QuoteService(c.env, c.env.DB);

  const quotes = await quoteService.getQuotes(householdId, userId, {
    // Filter quotes linked to this maintenance task
  });

  // Filter for this specific task
  const taskQuotes = quotes.filter(q => (q as any).linked_maintenance_task_id === taskId);

  return c.json({ quotes: taskQuotes });
});

/**
 * POST /households/:householdId/tasks/:taskId/quotes/request
 * Request quotes from contractors for a task
 */
maintenance.post('/:taskId/quotes/request', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('taskId');
  const body = await c.req.json();

  const { QuoteService } = await import('../services/quote-service');
  const quoteService = new QuoteService(c.env, c.env.DB);
  const maintenanceService = new TaskService(c.env, c.env.DB);

  // Get task details
  const task = await maintenanceService.getTask(householdId, taskId, userId);

  // Create quotes for each contractor
  const quotes = [];
  for (const contractorId of body.contractor_ids || []) {
    const quote = await quoteService.createQuote(householdId, userId, {
      contractorId,
      title: task.title,
      description: body.description || task.description || '',
      linkedMaintenanceTaskId: taskId,
    });
    quotes.push(quote);
  }

  // Update task workflow stage
  await maintenanceService.updateTask(householdId, taskId, userId, {
    workflow_stage: 'getting_quotes',
  });

  return c.json({ quotes }, 201);
});

/**
 * POST /households/:householdId/tasks/:taskId/quotes/compare-ai
 * Compare quotes for a task using AI
 */
maintenance.post('/:taskId/quotes/compare-ai', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('taskId');
  const body = await c.req.json();

  const { QuoteService } = await import('../services/quote-service');
  const quoteService = new QuoteService(c.env, c.env.DB);
  const maintenanceService = new TaskService(c.env, c.env.DB);

  // Get task details for context
  const task = await maintenanceService.getTask(householdId, taskId, userId);
  await assertCanUseAI(userId, c.env);

  const comparison = await quoteService.compareQuotesWithAI(
    householdId,
    userId,
    body.quote_ids || [],
    {
      title: task.title,
      description: task.description || undefined,
      category: task.system_category || task.contractor_category || undefined,
    }
  );

  // Update workflow stage
  await maintenanceService.updateTask(householdId, taskId, userId, {
    workflow_stage: 'comparing_quotes',
  });

  return c.json({ comparison });
});

/**
 * POST /households/:householdId/tasks/:taskId/select-quote
 * Select a quote for a task
 */
maintenance.post('/:taskId/select-quote', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('taskId');
  const body = await c.req.json();

  const maintenanceService = new TaskService(c.env, c.env.DB);

  await maintenanceService.updateTask(householdId, taskId, userId, {
    selected_quote_id: body.quote_id,
    workflow_stage: 'quote_selected',
  });

  const task = await maintenanceService.getTask(householdId, taskId, userId);

  return c.json({ task });
});

/**
 * PATCH /households/:householdId/tasks/:taskId/workflow-stage
 * Update workflow stage for a task
 */
maintenance.patch('/:taskId/workflow-stage', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('taskId');
  const body = await c.req.json();

  const maintenanceService = new TaskService(c.env, c.env.DB);

  await maintenanceService.updateTask(householdId, taskId, userId, {
    workflow_stage: body.workflow_stage,
  });

  const task = await maintenanceService.getTask(householdId, taskId, userId);

  return c.json({ task });
});

/**
 * POST /households/:householdId/tasks/:taskId/schedule-work
 * Schedule work for a task (creates appointment)
 */
maintenance.post('/:taskId/schedule-work', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('taskId');
  const body = await c.req.json();

  const maintenanceService = new TaskService(c.env, c.env.DB);
  const appointmentService = new AppointmentService(c.env, c.env.DB);

  // Get the task to access selected quote and contractor info
  const task = await maintenanceService.getTask(householdId, taskId, userId);

  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  // Get contractor_id from either the request body or the selected quote
  let contractorId = body.contractor_id;

  if (!contractorId && task.selected_quote_id) {
    // Fetch the quote to get contractor_id
    const { QuoteService } = await import('../services/quote-service');
    const quoteService = new QuoteService(c.env, c.env.DB);
    try {
      const quote = await quoteService.getQuote(householdId, task.selected_quote_id, userId);
      contractorId = quote.contractor_id;
    } catch (error) {
      console.error('[maintenance] Failed to fetch quote for contractor_id:', error);
    }
  }

  // Update task with scheduled date/time and workflow stage
  await maintenanceService.updateTask(householdId, taskId, userId, {
    scheduled_work_date: body.scheduled_date,
    scheduled_work_time_start: body.scheduled_time_start,
    scheduled_work_time_end: body.scheduled_time_end,
    workflow_stage: 'scheduled',
  });

  // Create appointment if we have a contractor
  if (contractorId) {
    try {
      await appointmentService.createAppointment(householdId, userId, {
        contractorId,
        type: 'work',
        title: task.title,
        description: task.description || `Scheduled work for maintenance task: ${task.title}`,
        scheduledDate: body.scheduled_date,
        scheduledTimeStart: body.scheduled_time_start,
        scheduledTimeEnd: body.scheduled_time_end,
        linkedQuoteId: task.selected_quote_id || undefined,
      });
    } catch (error) {
      console.error('[maintenance] Failed to create appointment:', error);
      // Don't fail the request if appointment creation fails
      // The task is still scheduled, just without an appointment record
    }
  } else {
    console.warn('[maintenance] No contractor_id available, skipping appointment creation');
  }

  const updatedTask = await maintenanceService.getTask(householdId, taskId, userId);

  return c.json({ task: updatedTask });
});

/**
 * POST /households/:householdId/tasks/photos/upload-url
 * Generate pre-signed URL for photo upload
 */
maintenance.post('/photos/upload-url', async (c) => {
  const householdId = getHouseholdId(c);
  const body = await c.req.json();

  const { filename, content_type } = body;

  if (!filename || !content_type) {
    return c.json({ error: 'filename and content_type are required' }, 400);
  }

  const photoId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const fileKey = `maintenance-photos/${householdId}/${photoId}/${filename}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // Return upload endpoint
  const uploadUrl = `${c.env.API_URL}/households/${householdId}/tasks/photos/${photoId}/upload`;

  return c.json({
    photo_id: photoId,
    photo_key: fileKey,
    upload_url: uploadUrl,
    expires_at: expiresAt.toISOString(),
  }, 200);
});

/**
 * PUT /households/:householdId/tasks/photos/:photoId/upload
 * Direct photo upload endpoint
 */
maintenance.put('/photos/:photoId/upload', async (c) => {
  const householdId = getHouseholdId(c);
  const photoId = c.req.param('photoId');

  try {
    const contentType = c.req.header('content-type') || 'image/jpeg';
    const body = await c.req.arrayBuffer();

    if (body.byteLength === 0) {
      return c.json({ error: 'File is empty' }, 400);
    }

    // Extract filename from content-disposition header or use a default
    const contentDisposition = c.req.header('content-disposition');
    const filenameMatch = contentDisposition?.match(/filename="?([^"]+)"?/);
    const filename = filenameMatch?.[1] || `photo-${photoId}.jpg`;

    const fileKey = `maintenance-photos/${householdId}/${photoId}/${filename}`;

    // Upload to R2
    await c.env.REPORTS_BUCKET.put(fileKey, body, {
      httpMetadata: {
        contentType,
      },
    });

    return c.json({
      message: 'Photo uploaded successfully',
      photo_key: fileKey,
    }, 200);
  } catch (error) {
    console.error(`[photo upload] Failed for ${photoId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Upload failed';
    return c.json({ error: errorMessage }, 500);
  }
});

// ============================================
// SUBTASK ROUTES
// ============================================

/**
 * POST /households/:householdId/tasks/:taskId/subtasks
 * Create a new subtask for a task
 */
maintenance.post('/:taskId/subtasks', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('taskId');

  try {
    const body = await c.req.json();
    const { SubtaskService } = await import('../services/subtask-service');
    const subtaskService = new SubtaskService(c.env, c.env.DB);

    const subtask = await subtaskService.createSubtask(
      householdId,
      taskId,
      userId,
      body
    );

    return c.json({ subtask }, 201);
  } catch (error) {
    console.error('[subtasks] Create failed:', error);
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof ForbiddenError) {
      return c.json({ error: error.message }, 403);
    }
    if (error instanceof BadRequestError) {
      return c.json({ error: error.message }, 400);
    }
    const errorMessage = error instanceof Error ? error.message : 'Failed to create subtask';
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * GET /households/:householdId/tasks/:taskId/subtasks
 * List all subtasks for a task (ordered by sort_order)
 */
maintenance.get('/:taskId/subtasks', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('taskId');

  try {
    const { SubtaskService } = await import('../services/subtask-service');
    const subtaskService = new SubtaskService(c.env, c.env.DB);

    const subtasks = await subtaskService.listSubtasks(
      householdId,
      taskId,
      userId
    );

    return c.json({ subtasks }, 200);
  } catch (error) {
    console.error('[subtasks] List failed:', error);
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof ForbiddenError) {
      return c.json({ error: error.message }, 403);
    }
    const errorMessage = error instanceof Error ? error.message : 'Failed to list subtasks';
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * GET /households/:householdId/tasks/:taskId/subtasks/:subtaskId
 * Get a single subtask
 */
maintenance.get('/:taskId/subtasks/:subtaskId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('taskId');
  const subtaskId = c.req.param('subtaskId');

  try {
    const { SubtaskService } = await import('../services/subtask-service');
    const subtaskService = new SubtaskService(c.env, c.env.DB);

    const subtask = await subtaskService.getSubtask(
      householdId,
      taskId,
      subtaskId,
      userId
    );

    return c.json({ subtask }, 200);
  } catch (error) {
    console.error('[subtasks] Get failed:', error);
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof ForbiddenError) {
      return c.json({ error: error.message }, 403);
    }
    const errorMessage = error instanceof Error ? error.message : 'Failed to get subtask';
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * PATCH /households/:householdId/tasks/:taskId/subtasks/:subtaskId
 * Update a subtask
 */
maintenance.patch('/:taskId/subtasks/:subtaskId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('taskId');
  const subtaskId = c.req.param('subtaskId');

  try {
    const body = await c.req.json();
    const { SubtaskService } = await import('../services/subtask-service');
    const subtaskService = new SubtaskService(c.env, c.env.DB);

    const subtask = await subtaskService.updateSubtask(
      householdId,
      taskId,
      subtaskId,
      userId,
      body
    );

    return c.json({ subtask }, 200);
  } catch (error) {
    console.error('[subtasks] Update failed:', error);
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof ForbiddenError) {
      return c.json({ error: error.message }, 403);
    }
    if (error instanceof BadRequestError) {
      return c.json({ error: error.message }, 400);
    }
    const errorMessage = error instanceof Error ? error.message : 'Failed to update subtask';
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * DELETE /households/:householdId/tasks/:taskId/subtasks/:subtaskId
 * Soft delete a subtask
 */
maintenance.delete('/:taskId/subtasks/:subtaskId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('taskId');
  const subtaskId = c.req.param('subtaskId');

  try {
    const { SubtaskService } = await import('../services/subtask-service');
    const subtaskService = new SubtaskService(c.env, c.env.DB);

    await subtaskService.deleteSubtask(
      householdId,
      taskId,
      subtaskId,
      userId
    );

    return c.json({ message: 'Subtask deleted successfully' }, 200);
  } catch (error) {
    console.error('[subtasks] Delete failed:', error);
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof ForbiddenError) {
      return c.json({ error: error.message }, 403);
    }
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete subtask';
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * POST /households/:householdId/tasks/:taskId/subtasks/:subtaskId/complete
 * Mark a subtask as complete
 */
maintenance.post('/:taskId/subtasks/:subtaskId/complete', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('taskId');
  const subtaskId = c.req.param('subtaskId');

  try {
    const { SubtaskService } = await import('../services/subtask-service');
    const subtaskService = new SubtaskService(c.env, c.env.DB);

    const result = await subtaskService.completeSubtask(
      householdId,
      taskId,
      subtaskId,
      userId
    );

    // Get updated task with progress
    const { TaskService } = await import('../services/task-service');
    const maintenanceService = new TaskService(c.env, c.env.DB);
    const task = await maintenanceService.getTask(householdId, taskId, userId);

    return c.json({
      subtask: result.subtask,
      task,
    }, 200);
  } catch (error) {
    console.error('[subtasks] Complete failed:', error);
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof ForbiddenError) {
      return c.json({ error: error.message }, 403);
    }
    if (error instanceof BadRequestError) {
      return c.json({ error: error.message }, 400);
    }
    const errorMessage = error instanceof Error ? error.message : 'Failed to complete subtask';
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * POST /households/:householdId/tasks/:taskId/subtasks/:subtaskId/uncomplete
 * Mark a subtask as incomplete
 */
maintenance.post('/:taskId/subtasks/:subtaskId/uncomplete', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('taskId');
  const subtaskId = c.req.param('subtaskId');

  try {
    const { SubtaskService } = await import('../services/subtask-service');
    const subtaskService = new SubtaskService(c.env, c.env.DB);

    const result = await subtaskService.uncompleteSubtask(
      householdId,
      taskId,
      subtaskId,
      userId
    );

    // Get updated task with progress
    const { TaskService } = await import('../services/task-service');
    const maintenanceService = new TaskService(c.env, c.env.DB);
    const task = await maintenanceService.getTask(householdId, taskId, userId);

    return c.json({
      subtask: result.subtask,
      task,
    }, 200);
  } catch (error) {
    console.error('[subtasks] Uncomplete failed:', error);
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof ForbiddenError) {
      return c.json({ error: error.message }, 403);
    }
    if (error instanceof BadRequestError) {
      return c.json({ error: error.message }, 400);
    }
    const errorMessage = error instanceof Error ? error.message : 'Failed to uncomplete subtask';
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * POST /households/:householdId/tasks/:taskId/subtasks/reorder
 * Reorder subtasks (batch operation)
 */
maintenance.post('/:taskId/subtasks/reorder', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const taskId = c.req.param('taskId');

  try {
    const body = await c.req.json();
    const { subtask_ids } = body;

    if (!Array.isArray(subtask_ids)) {
      return c.json({ error: 'subtask_ids must be an array' }, 400);
    }

    const { SubtaskService } = await import('../services/subtask-service');
    const subtaskService = new SubtaskService(c.env, c.env.DB);

    const subtasks = await subtaskService.reorderSubtasks(
      householdId,
      taskId,
      userId,
      subtask_ids
    );

    return c.json({ subtasks }, 200);
  } catch (error) {
    console.error('[subtasks] Reorder failed:', error);
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof ForbiddenError) {
      return c.json({ error: error.message }, 403);
    }
    if (error instanceof BadRequestError) {
      return c.json({ error: error.message }, 400);
    }
    const errorMessage = error instanceof Error ? error.message : 'Failed to reorder subtasks';
    return c.json({ error: errorMessage }, 500);
  }
});

export default maintenance;
