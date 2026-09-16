import { z } from 'zod';

/** Lean task row for GET /households/:id/tasks list (hot path). */
export const taskListItemSchema = z.object({
  id: z.string(),
  system_category: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  frequency: z.enum([
    'one_time',
    'daily',
    'weekly',
    'monthly',
    'quarterly',
    'yearly',
    'custom',
  ]),
  custom_interval_days: z.number().int().nullable(),
  next_due_date: z.string().nullable(),
  last_completed_at: z.string().nullable(),
  assigned_to: z
    .object({
      id: z.string(),
      display_name: z.string().nullable(),
    })
    .nullable(),
  space_id: z.string().nullable().optional(),
  is_active: z.boolean(),
  source: z.enum(['manual', 'ai_generated', 'template']),
  priority_severity: z
    .enum(['nice_to_have', 'low', 'medium', 'high', 'urgent', 'critical'])
    .optional(),
  risk_level: z.enum(['low', 'medium', 'high', 'critical']).nullable().optional(),
  complexity: z
    .enum(['trivial', 'simple', 'moderate', 'involved', 'expert'])
    .nullable()
    .optional(),
  time_effort: z
    .enum(['quick', 'short', 'medium', 'half_day', 'all_day'])
    .nullable()
    .optional(),
  enrichment_status: z
    .enum(['pending', 'enriching', 'enriched', 'needs_clarification', 'failed'])
    .nullable()
    .optional(),
  reminder_enabled: z.boolean(),
  reminder_days_before: z.number().int(),
  reminder_time: z.string(),
  reminder_repeat: z.boolean(),
  workflow_stage: z
    .enum([
      'planning',
      'getting_quotes',
      'comparing_quotes',
      'quote_selected',
      'scheduled',
      'in_progress',
      'completed',
      'cancelled',
    ])
    .optional(),
  is_personal: z.boolean().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  cover_photo_url: z.string().nullable().optional(),
});

export type TaskListItem = z.infer<typeof taskListItemSchema>;

/** GET /households/:id/tasks response envelope. */
export const tasksListResponseSchema = z.object({
  tasks: z.array(taskListItemSchema),
  next_cursor: z.string().optional(),
});

export type TasksListResponse = z.infer<typeof tasksListResponseSchema>;
