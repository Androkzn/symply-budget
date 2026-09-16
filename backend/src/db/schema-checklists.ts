import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { users, households } from './schema';

// ============ CHECKLISTS ============

// Checklist templates (daily, weekly, monthly, seasonal)
export const checklists = sqliteTable(
  'checklists',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    frequency: text('frequency').notNull(), // 'daily', 'weekly', 'monthly', 'quarterly', 'seasonal', 'yearly', 'custom'
    icon: text('icon'), // emoji
    color: text('color'), // hex color
    is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    // For seasonal checklists
    season: text('season'), // 'spring', 'summer', 'fall', 'winter'
    // Custom schedule
    custom_days: text('custom_days'), // JSON array of days (for weekly: [0,3,5] = Sun, Wed, Fri)
    sort_order: integer('sort_order').default(0),
    created_by: text('created_by').references(() => users.id),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('checklists_household_id_idx').on(table.household_id),
    frequency_idx: index('checklists_frequency_idx').on(table.frequency),
  })
);

// Individual checklist items
export const checklistItems = sqliteTable(
  'checklist_items',
  {
    id: text('id').primaryKey(),
    checklist_id: text('checklist_id')
      .notNull()
      .references(() => checklists.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    sort_order: integer('sort_order').default(0),
    is_required: integer('is_required', { mode: 'boolean' }).notNull().default(true),
    // Optional link to maintenance task
    linked_task_id: text('linked_task_id'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    checklist_id_idx: index('checklist_items_checklist_id_idx').on(table.checklist_id),
  })
);

// Checklist completion instances (per period)
export const checklistInstances = sqliteTable(
  'checklist_instances',
  {
    id: text('id').primaryKey(),
    checklist_id: text('checklist_id')
      .notNull()
      .references(() => checklists.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    // Period identifiers
    period_start: text('period_start').notNull(), // Start of the period (date)
    period_end: text('period_end').notNull(), // End of the period (date)
    period_label: text('period_label'), // e.g., "Week 3, Jan 2024" or "January 2024"
    // Progress
    total_items: integer('total_items').notNull(),
    completed_items: integer('completed_items').notNull().default(0),
    status: text('status').notNull(), // 'not_started', 'in_progress', 'completed'
    completed_at: text('completed_at'),
    completed_by: text('completed_by').references(() => users.id),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    checklist_id_idx: index('checklist_instances_checklist_id_idx').on(table.checklist_id),
    household_period_idx: index('checklist_instances_household_period_idx').on(
      table.household_id,
      table.period_start
    ),
    status_idx: index('checklist_instances_status_idx').on(table.status),
  })
);

// Individual item completions within an instance
export const checklistItemCompletions = sqliteTable(
  'checklist_item_completions',
  {
    id: text('id').primaryKey(),
    instance_id: text('instance_id')
      .notNull()
      .references(() => checklistInstances.id, { onDelete: 'cascade' }),
    item_id: text('item_id')
      .notNull()
      .references(() => checklistItems.id, { onDelete: 'cascade' }),
    completed_by: text('completed_by')
      .notNull()
      .references(() => users.id),
    completed_at: text('completed_at').notNull(),
    notes: text('notes'),
  },
  (table) => ({
    instance_id_idx: index('checklist_item_completions_instance_id_idx').on(table.instance_id),
    instance_item_idx: uniqueIndex('checklist_item_completions_instance_item_idx').on(
      table.instance_id,
      table.item_id
    ),
  })
);

// Export types
export type Checklist = typeof checklists.$inferSelect;
export type NewChecklist = typeof checklists.$inferInsert;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type NewChecklistItem = typeof checklistItems.$inferInsert;
export type ChecklistInstance = typeof checklistInstances.$inferSelect;
export type NewChecklistInstance = typeof checklistInstances.$inferInsert;
export type ChecklistItemCompletion = typeof checklistItemCompletions.$inferSelect;
export type NewChecklistItemCompletion = typeof checklistItemCompletions.$inferInsert;
