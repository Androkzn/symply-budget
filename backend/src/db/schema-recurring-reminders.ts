import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { users, households } from './schema';

// ============ RECURRING REMINDERS ============
//
// "Keep nagging until it's actually done" action items — distinct from
// `scheduled_notifications` (a one-shot delivery queue) and `notification_history`
// (a read/unread inbox of things already sent). One row here tracks the LIFECYCLE
// of a single recurring obligation for one household + period (e.g. "upload the
// August mortgage statement"): whether it's still pending, when it's next due for
// another nudge, at what cadence, and how it was resolved.
//
// A registry (`services/recurring-reminders/registry.ts`) maps `type` → per-type
// behaviour (auto-detect via `isSatisfied`, content templates), mirroring the
// `ChatConfig`/`CHAT_CONFIGS` pattern in `src/features/chat/` — one engine, many
// registered types, no per-brand forking. Delivery of each nudge still goes
// through the existing `scheduled_notifications` queue / `NotificationService` —
// this table only decides WHEN the next nudge is due and whether one is still
// needed at all.
export const recurringReminders = sqliteTable(
  'recurring_reminders',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // registry key, e.g. 'mortgage_statement_reminder'
    reference_type: text('reference_type').notNull(), // e.g. 'mortgage'
    reference_id: text('reference_id').notNull(), // e.g. mortgageId
    // The recurrence period this row covers (e.g. '2026-08'). One row per
    // (household, type, reference, period) — a new period gets a new row rather
    // than reusing/rolling forward this one, so completed periods stay as history.
    period_key: text('period_key').notNull(),
    status: text('status').notNull().default('pending'), // 'pending' | 'done'
    title: text('title').notNull(),
    body: text('body').notNull(),
    // Same shape as a push `data` payload (data.type/screen/...) so a tap from
    // the in-app Active list and a tap on the push notification itself route
    // through the exact same `routeNotificationTap` call.
    data: text('data'),
    frequency: text('frequency').notNull(), // FrequencyId — cadence between nudges
    next_nudge_at: text('next_nudge_at').notNull(),
    last_nudged_at: text('last_nudged_at'),
    nudge_count: integer('nudge_count').notNull().default(0),
    // One-off defer layered on top of `frequency`; once it passes, the regular
    // cadence resumes. Picking a frequency preset sets BOTH fields at once (see
    // `services/recurring-reminders/frequency.ts`), which is what makes "snooze"
    // and "change how often you're nudged" the same user action.
    snoozed_until: text('snoozed_until'),
    completed_at: text('completed_at'),
    completed_by_user_id: text('completed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    completed_reason: text('completed_reason'), // 'manual' | 'auto_detected'
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    household_status_idx: index('recurring_reminders_household_status_idx').on(
      t.household_id,
      t.status
    ),
    // The cron sweep's core query: due, still-pending rows.
    due_idx: index('recurring_reminders_due_idx').on(t.status, t.next_nudge_at),
    reference_idx: index('recurring_reminders_reference_idx').on(
      t.reference_type,
      t.reference_id
    ),
    period_unique_idx: uniqueIndex('recurring_reminders_period_unique_idx').on(
      t.household_id,
      t.type,
      t.reference_id,
      t.period_key
    ),
  })
);

export type RecurringReminder = typeof recurringReminders.$inferSelect;
export type NewRecurringReminder = typeof recurringReminders.$inferInsert;
