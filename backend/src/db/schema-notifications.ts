import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { users, households } from './schema';

// ============ PUSH NOTIFICATIONS ============

// Device tokens for push notifications
export const pushTokens = sqliteTable(
  'push_tokens',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform').notNull(), // 'ios', 'android', 'web'
    device_name: text('device_name'),
    is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    last_used_at: text('last_used_at'),
    // Aihousekeeper §A7: semver string; null for tokens registered before this column.
    // Backend gates Aihousekeeper-typed pushes on `app_version >= AIHOUSEKEEPER_MIN_APP_VERSION`.
    app_version: text('app_version'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: index('push_tokens_user_id_idx').on(table.user_id),
    token_idx: uniqueIndex('push_tokens_token_idx').on(table.token),
  })
);

// Notification preferences per user
export const notificationPreferences = sqliteTable(
  'notification_preferences',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .unique(),
    // Global settings
    push_enabled: integer('push_enabled', { mode: 'boolean' }).notNull().default(true),
    email_enabled: integer('email_enabled', { mode: 'boolean' }).notNull().default(true),
    quiet_hours_start: text('quiet_hours_start'), // HH:MM format
    quiet_hours_end: text('quiet_hours_end'), // HH:MM format
    timezone: text('timezone').default('America/New_York'),
    // Category settings (JSON with enabled/disabled per type)
    task_reminders: integer('task_reminders', { mode: 'boolean' }).notNull().default(true),
    task_overdue: integer('task_overdue', { mode: 'boolean' }).notNull().default(true),
    task_assigned: integer('task_assigned', { mode: 'boolean' }).notNull().default(true),
    task_completed: integer('task_completed', { mode: 'boolean' }).notNull().default(true),
    household_updates: integer('household_updates', { mode: 'boolean' }).notNull().default(true),
    report_ready: integer('report_ready', { mode: 'boolean' }).notNull().default(true),
    weekly_summary: integer('weekly_summary', { mode: 'boolean' }).notNull().default(true),
    garbage_collection: integer('garbage_collection', { mode: 'boolean' }).notNull().default(true),
    task_drafts_ready: integer('task_drafts_ready', { mode: 'boolean' }).notNull().default(true),
    critical_findings: integer('critical_findings', { mode: 'boolean' }).notNull().default(true),
    maintenance_suggestions: integer('maintenance_suggestions', { mode: 'boolean' }).notNull().default(true),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: uniqueIndex('notification_preferences_user_id_idx').on(table.user_id),
  })
);

// Scheduled notifications queue
export const scheduledNotifications = sqliteTable(
  'scheduled_notifications',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .references(() => households.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'task_reminder', 'task_overdue', 'task_assigned', etc.
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: text('data'), // JSON payload for deep linking
    scheduled_for: text('scheduled_for').notNull(),
    sent_at: text('sent_at'),
    failed_at: text('failed_at'),
    error_message: text('error_message'),
    // B1: CAS delivery claim (never claim with sent_at — see clean-architecture B1)
    claimed_at: text('claimed_at'),
    claim_owner: text('claim_owner'),
    attempt_count: integer('attempt_count').notNull().default(0),
    // Reference to the source entity
    reference_type: text('reference_type'), // 'maintenance_task', 'action_item', 'report'
    reference_id: text('reference_id'),
    // Rich notification support (2026 best practices)
    image_url: text('image_url'), // URL to image attachment for rich notifications
    category_id: text('category_id'), // For notification action buttons
    thread_id: text('thread_id'), // For grouping notifications
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: index('scheduled_notifications_user_id_idx').on(table.user_id),
    scheduled_for_idx: index('scheduled_notifications_scheduled_for_idx').on(table.scheduled_for),
    sent_at_idx: index('scheduled_notifications_sent_at_idx').on(table.sent_at),
    reference_idx: index('scheduled_notifications_reference_idx').on(
      table.reference_type,
      table.reference_id
    ),
  })
);

// Notification history (sent notifications)
export const notificationHistory = sqliteTable(
  'notification_history',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: text('data'),
    sent_at: text('sent_at').notNull(),
    read_at: text('read_at'),
    clicked_at: text('clicked_at'),
    reference_type: text('reference_type'),
    reference_id: text('reference_id'),
  },
  (table) => ({
    user_id_idx: index('notification_history_user_id_idx').on(table.user_id),
    sent_at_idx: index('notification_history_sent_at_idx').on(table.sent_at),
    read_at_idx: index('notification_history_read_at_idx').on(table.read_at),
  })
);

// User engagement tracking for send-time optimization (2026 best practice)
export const notificationEngagement = sqliteTable(
  'notification_engagement',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    notification_id: text('notification_id')
      .notNull()
      .references(() => notificationHistory.id, { onDelete: 'cascade' }),
    // Engagement metrics
    sent_hour: integer('sent_hour').notNull(), // 0-23
    sent_day_of_week: integer('sent_day_of_week').notNull(), // 0-6 (Sun-Sat)
    opened_at: text('opened_at'),
    action_taken: text('action_taken'), // 'view', 'snooze', 'complete', 'dismiss'
    response_time_seconds: integer('response_time_seconds'), // Time from send to action
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: index('notification_engagement_user_id_idx').on(table.user_id),
    sent_hour_idx: index('notification_engagement_sent_hour_idx').on(table.sent_hour),
  })
);

// User optimal send times (computed from engagement data)
export const userOptimalSendTimes = sqliteTable(
  'user_optimal_send_times',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .unique(),
    // Optimal hours for each day of week (JSON array of preferred hours)
    weekday_hours: text('weekday_hours'), // JSON: [9, 12, 18] - preferred hours Mon-Fri
    weekend_hours: text('weekend_hours'), // JSON: [10, 14, 19] - preferred hours Sat-Sun
    // Aggregate engagement scores by hour (for ML optimization)
    hourly_engagement_scores: text('hourly_engagement_scores'), // JSON: {0: 0.1, 1: 0.05, ..., 23: 0.3}
    // Last computed
    last_computed_at: text('last_computed_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: uniqueIndex('user_optimal_send_times_user_id_idx').on(table.user_id),
  })
);

// A/B test variants for notifications (2026 best practice)
export const notificationAbTests = sqliteTable(
  'notification_ab_tests',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(), // e.g., 'task_reminder_copy_v2'
    notification_type: text('notification_type').notNull(), // 'task_reminder', 'garbage_reminder', etc.
    is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    // Variant definitions (JSON)
    variants: text('variants').notNull(), // JSON: [{id: 'control', title: '...', body: '...'}, {id: 'variant_a', ...}]
    // Traffic allocation
    traffic_percentage: integer('traffic_percentage').notNull().default(100), // % of users in test
    // Results tracking
    start_date: text('start_date').notNull(),
    end_date: text('end_date'),
    winning_variant: text('winning_variant'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    notification_type_idx: index('notification_ab_tests_type_idx').on(table.notification_type),
    active_idx: index('notification_ab_tests_active_idx').on(table.is_active),
  })
);

// User assignment to A/B test variants
export const userAbTestAssignments = sqliteTable(
  'user_ab_test_assignments',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    test_id: text('test_id')
      .notNull()
      .references(() => notificationAbTests.id, { onDelete: 'cascade' }),
    variant_id: text('variant_id').notNull(),
    // Metrics
    notifications_sent: integer('notifications_sent').notNull().default(0),
    notifications_opened: integer('notifications_opened').notNull().default(0),
    actions_taken: integer('actions_taken').notNull().default(0),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_test_idx: uniqueIndex('user_ab_test_assignments_user_test_idx').on(
      table.user_id,
      table.test_id
    ),
  })
);

// Pending Expo push delivery receipts to verify. A push "ticket" only means
// Expo accepted the request — actual APNs/FCM delivery failures (bad
// credentials, sandbox/production mismatch, device not registered, etc.)
// only surface via Expo's separate receipts endpoint, polled here on a cron.
export const pushReceiptChecks = sqliteTable(
  'push_receipt_checks',
  {
    id: text('id').primaryKey(),
    ticket_id: text('ticket_id').notNull(),
    push_token_id: text('push_token_id')
      .notNull()
      .references(() => pushTokens.id, { onDelete: 'cascade' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    ticket_id_idx: uniqueIndex('push_receipt_checks_ticket_id_idx').on(table.ticket_id),
    created_at_idx: index('push_receipt_checks_created_at_idx').on(table.created_at),
  })
);

// Singleton cron run leases (B1 — D1 alternative to a lease DO).
export const cronLeases = sqliteTable('cron_leases', {
  job_name: text('job_name').primaryKey(),
  holder: text('holder').notNull(),
  acquired_at: text('acquired_at').notNull(),
  expires_at: text('expires_at').notNull(),
});

// ============ SMART NOTIFICATIONS ============

// Smart Notification gateway decision log (Smart Notifications P1).
//
// One row per resolved recipient per gateway request. In P1 (pass-through) this
// is parity telemetry: it records what the gateway *would* decide (lane,
// recipient rule, copy source) without changing delivery behaviour. Later phases
// read/extend it for dedup, batching, and fatigue learning. Additive only — it
// never alters the canonical `notificationHistory` / `notificationEngagement`
// records, which remain the source of truth for delivery + engagement.
export const smartNotificationDecision = sqliteTable(
  'smart_notification_decision',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id'),
    recipient_user_id: text('recipient_user_id').notNull(),
    producer_type: text('producer_type').notNull(), // e.g. 'task_reminder'
    lane: text('lane').notNull(), // 'A' (immediate) | 'B' (optimizable)
    recipient_rule: text('recipient_rule').notNull(), // e.g. 'passthrough'
    copy_source: text('copy_source').notNull().default('template'), // 'template' | 'ai' | 'abtest'
    batch_role: text('batch_role').notNull().default('single'), // 'single' | 'primary' | 'assisted'
    reference_type: text('reference_type'),
    reference_id: text('reference_id'),
    outcome_ref: text('outcome_ref'), // links to notificationHistory.id once delivered
    suppress_reason: text('suppress_reason'), // 'opt_out' | 'quiet_hours' | 'fatigue_cap' | 'no_token' | 'dedup' | null
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    recipient_idx: index('smart_notification_decision_recipient_idx').on(table.recipient_user_id),
    household_idx: index('smart_notification_decision_household_idx').on(table.household_id),
    created_at_idx: index('smart_notification_decision_created_at_idx').on(table.created_at),
    reference_idx: index('smart_notification_decision_reference_idx').on(
      table.reference_type,
      table.reference_id
    ),
  })
);

// Export types
export type SmartNotificationDecision = typeof smartNotificationDecision.$inferSelect;
export type NewSmartNotificationDecision = typeof smartNotificationDecision.$inferInsert;
export type PushToken = typeof pushTokens.$inferSelect;
export type NewPushToken = typeof pushTokens.$inferInsert;
export type PushReceiptCheck = typeof pushReceiptChecks.$inferSelect;
export type NewPushReceiptCheck = typeof pushReceiptChecks.$inferInsert;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;
export type ScheduledNotification = typeof scheduledNotifications.$inferSelect;
export type NewScheduledNotification = typeof scheduledNotifications.$inferInsert;
export type CronLease = typeof cronLeases.$inferSelect;
export type NewCronLease = typeof cronLeases.$inferInsert;
export type NotificationHistoryItem = typeof notificationHistory.$inferSelect;
export type NotificationEngagement = typeof notificationEngagement.$inferSelect;
export type UserOptimalSendTime = typeof userOptimalSendTimes.$inferSelect;
export type NotificationAbTest = typeof notificationAbTests.$inferSelect;
export type UserAbTestAssignment = typeof userAbTestAssignments.$inferSelect;
export type NewNotificationHistoryItem = typeof notificationHistory.$inferInsert;
