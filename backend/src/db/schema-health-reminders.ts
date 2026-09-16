import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Symply Health — reminder schedule (migration 0134).
 *
 * One row per member describing WHEN their meal / water / weigh-in / habit
 * nudges fire. Ported from the donor's `user_notification_schedule` +
 * `smart_reminder_preferences` pair, collapsed into one table because we did not
 * port the pattern analyser that was the only reason to split them — see the
 * migration header for the full donor mapping and deviation list.
 *
 * NOT the same thing as `activity_notification_preferences` (0120). That table
 * is about OTHER PEOPLE's activity (a family member shared a recipe, a photo, a
 * milestone) plus two delivery-channel switches. This one is about the member's
 * own logging habits. Both are read by the reminder engine, for different
 * questions: this one answers "should a nudge exist", that one answers "may we
 * push it".
 *
 * Times are LOCAL wall-clock 'HH:MM' in `timezone`, never UTC. They become a UTC
 * instant only at materialisation, inside `health-reminders-service.ts`.
 *
 * Kept in its own module rather than appended to `schema-health.ts` /
 * `schema-health-p2.ts` because those mirror donor migrations 001-018 and 074+
 * one-for-one; this table has no single donor counterpart.
 */
export const healthReminderPreferences = sqliteTable(
  'health_reminder_preferences',
  {
    /** PRIMARY KEY — at most one reminder setup per member, no separate `id`. */
    user_id: text('user_id').primaryKey(),

    /**
     * IANA zone the 'HH:MM' columns are wall-clock in. NULL falls back to
     * `notification_preferences.timezone`, then UTC.
     */
    timezone: text('timezone'),

    // ---- meals: master switch AND per-slot switches, both required to fire ----
    meals_enabled: integer('meals_enabled', { mode: 'boolean' }).notNull().default(false),
    breakfast_enabled: integer('breakfast_enabled', { mode: 'boolean' })
      .notNull()
      .default(false),
    breakfast_time: text('breakfast_time').notNull().default('08:30'),
    lunch_enabled: integer('lunch_enabled', { mode: 'boolean' }).notNull().default(false),
    lunch_time: text('lunch_time').notNull().default('13:00'),
    snack_enabled: integer('snack_enabled', { mode: 'boolean' }).notNull().default(false),
    snack_time: text('snack_time').notNull().default('16:00'),
    dinner_enabled: integer('dinner_enabled', { mode: 'boolean' }).notNull().default(false),
    dinner_time: text('dinner_time').notNull().default('19:00'),

    // ---- water: a window + an interval, not a clock time ----
    water_enabled: integer('water_enabled', { mode: 'boolean' }).notNull().default(false),
    water_start_time: text('water_start_time').notNull().default('09:00'),
    water_end_time: text('water_end_time').notNull().default('21:00'),
    water_interval_minutes: integer('water_interval_minutes').notNull().default(120),

    // ---- weigh-in ----
    weigh_in_enabled: integer('weigh_in_enabled', { mode: 'boolean' }).notNull().default(false),
    weigh_in_time: text('weigh_in_time').notNull().default('08:00'),
    /** JSON weekday array, 1 = Sunday … 7 = Saturday. NULL = every day. */
    weigh_in_days: text('weigh_in_days'),

    // NO habits column. Habit reminders are owned end-to-end by
    // `services/health/habit-reminder.ts` off `user_habits.reminder_*`; a second
    // switch here would be a second authority over the same nudge.

    // ---- behaviour ----
    skip_if_already_logged: integer('skip_if_already_logged', { mode: 'boolean' })
      .notNull()
      .default(true),
    quiet_hours_enabled: integer('quiet_hours_enabled', { mode: 'boolean' })
      .notNull()
      .default(true),
    quiet_hours_start: text('quiet_hours_start').notNull().default('23:00'),
    quiet_hours_end: text('quiet_hours_end').notNull().default('07:00'),

    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  }
  // No index declarations here: 0134 hand-writes the only two indexes this
  // feature needs (a partial "has opted into anything" probe on this table, and
  // a partial "has a habit reminder" probe on `user_habits`), and drizzle cannot
  // express a partial index. Declaring non-partial lookalikes would claim an
  // index shape the DDL does not create.
);

export type HealthReminderPreferencesRow = typeof healthReminderPreferences.$inferSelect;
export type NewHealthReminderPreferencesRow = typeof healthReminderPreferences.$inferInsert;
