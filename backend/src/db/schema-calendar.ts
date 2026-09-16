import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { users, households } from './schema';

// ============ CALENDAR SYNC TOKENS ============

export const calendarSyncTokens = sqliteTable(
  'calendar_sync_tokens',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    name: text('name').default('My Calendar'),
    // What to include in the feed
    includes_tasks: integer('includes_tasks', { mode: 'boolean' }).default(true),
    includes_appointments: integer('includes_appointments', { mode: 'boolean' }).default(true),
    includes_garbage: integer('includes_garbage', { mode: 'boolean' }).default(true),
    // Filters
    household_id: text('household_id').references(() => households.id, { onDelete: 'set null' }),
    // Tracking
    last_accessed_at: text('last_accessed_at'),
    access_count: integer('access_count').default(0),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: index('calendar_sync_tokens_user_id_idx').on(table.user_id),
    token_idx: uniqueIndex('calendar_sync_tokens_token_idx').on(table.token),
  })
);

// ============ CALENDAR EVENT LINKS ============

export const calendarEventLinks = sqliteTable(
  'calendar_event_links',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Source entity
    source_type: text('source_type').notNull(), // 'task', 'appointment', 'garbage'
    source_id: text('source_id').notNull(),
    // External calendar
    calendar_type: text('calendar_type').notNull(), // 'apple', 'google', 'device'
    calendar_id: text('calendar_id'),
    event_id: text('event_id').notNull(),
    // Sync status
    last_synced_at: text('last_synced_at').notNull(),
    sync_status: text('sync_status').default('synced'), // 'synced', 'pending', 'failed', 'deleted'
    error_message: text('error_message'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: index('calendar_event_links_user_id_idx').on(table.user_id),
    source_idx: index('calendar_event_links_source_idx').on(table.source_type, table.source_id),
    unique_idx: uniqueIndex('calendar_event_links_unique_idx').on(
      table.user_id,
      table.source_type,
      table.source_id,
      table.calendar_type
    ),
  })
);

// ============ NOTIFICATION OVERRIDES ============

export const notificationOverrides = sqliteTable(
  'notification_overrides',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Target (what this override applies to)
    target_type: text('target_type').notNull(), // 'task', 'space', 'category', 'appliance'
    target_id: text('target_id'), // NULL for category-level overrides
    category: text('category'), // For category-level overrides
    // Override settings (NULL means use default)
    enabled: integer('enabled', { mode: 'boolean' }),
    reminder_days_before: integer('reminder_days_before'),
    reminder_time: text('reminder_time'),
    reminder_repeat: integer('reminder_repeat', { mode: 'boolean' }),
    // Calendar sync settings
    sync_to_calendar: integer('sync_to_calendar', { mode: 'boolean' }).default(false),
    calendar_id: text('calendar_id'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: index('notification_overrides_user_id_idx').on(table.user_id),
    target_idx: index('notification_overrides_target_idx').on(
      table.user_id,
      table.target_type,
      table.target_id
    ),
    category_idx: index('notification_overrides_category_idx').on(
      table.user_id,
      table.target_type,
      table.category
    ),
  })
);

// ============ USER CALENDAR SETTINGS ============

export const userCalendarSettings = sqliteTable(
  'user_calendar_settings',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .unique(),
    // Default calendar for sync
    default_calendar_type: text('default_calendar_type'), // 'apple', 'google', 'device'
    default_calendar_id: text('default_calendar_id'),
    default_calendar_name: text('default_calendar_name'),
    // Sync preferences
    auto_sync_tasks: integer('auto_sync_tasks', { mode: 'boolean' }).default(false),
    auto_sync_appointments: integer('auto_sync_appointments', { mode: 'boolean' }).default(false),
    auto_sync_garbage: integer('auto_sync_garbage', { mode: 'boolean' }).default(false),
    // Task sync settings
    sync_task_due_date: integer('sync_task_due_date', { mode: 'boolean' }).default(true),
    sync_task_reminder: integer('sync_task_reminder', { mode: 'boolean' }).default(true),
    task_event_duration_minutes: integer('task_event_duration_minutes').default(60),
    // Appearance
    task_event_color: text('task_event_color'),
    appointment_event_color: text('appointment_event_color'),
    garbage_event_color: text('garbage_event_color'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: uniqueIndex('user_calendar_settings_user_id_idx').on(table.user_id),
  })
);

// ============ TYPES ============

export type CalendarSyncToken = typeof calendarSyncTokens.$inferSelect;
export type NewCalendarSyncToken = typeof calendarSyncTokens.$inferInsert;
export type CalendarEventLink = typeof calendarEventLinks.$inferSelect;
export type NewCalendarEventLink = typeof calendarEventLinks.$inferInsert;
export type NotificationOverride = typeof notificationOverrides.$inferSelect;
export type NewNotificationOverride = typeof notificationOverrides.$inferInsert;
export type UserCalendarSettings = typeof userCalendarSettings.$inferSelect;
export type NewUserCalendarSettings = typeof userCalendarSettings.$inferInsert;

// Calendar types
export type CalendarType = 'apple' | 'google' | 'device';
export type SourceType = 'task' | 'appointment' | 'garbage';
export type SyncStatus = 'synced' | 'pending' | 'failed' | 'deleted';
export type OverrideTargetType = 'task' | 'space' | 'category' | 'appliance';
