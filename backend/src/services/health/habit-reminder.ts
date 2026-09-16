import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { userHabits } from '../../db/schema-health';
import { notificationPreferences, scheduledNotifications } from '../../db/schema-notifications';
import type { Env } from '../../types';
import { zonedWallTimeToUtcIso, todayPartsInTz } from '../../utils/timezone';
import { NotificationService } from '../notification-service';

/**
 * Per-habit reminders for Symply Health (donor `HabitRemindersSection` +
 * `NotificationManager.scheduleHabitReminders`).
 *
 * Reuses the PLATFORM's `scheduled_notifications` table and its every-5-minute
 * `processScheduledNotifications` sweep — there is no Health-specific delivery
 * path, and there must not be one. Delivery is brand-independent, so a row
 * written here by the `symply-health-api` Worker is delivered from the Health D1
 * by the same code that delivers a mortgage nudge from the Budget D1.
 *
 * WHY MATERIALISE INSTEAD OF REPEAT: `scheduled_notifications` has no recurrence
 * column (see `backend/migrations/0002_notifications.sql`), so a repeating
 * reminder is N one-off rows. Two in-repo precedents:
 *   - mortgage `statement-reminder.ts` — ONE row, rolled forward on the next write.
 *   - `scheduleGarbageReminders` — pre-materialises 14 days of occurrences.
 * A habit reminder has no "next write" to hang off (someone who never opens the
 * app is exactly who needs the nudge), so this follows the garbage pattern:
 * {@link REMINDER_HORIZON_DAYS} days ahead, topped up by a daily cron sweep
 * ({@link topUpHabitReminders}). The garbage version has a known hole — nothing
 * re-materialises it, so it runs dry after 14 days — and the sweep is precisely
 * the fix for that hole, not an optional extra.
 *
 * The donor supports MANY reminders per habit; `user_habits` carries a single
 * `reminder_time` (migration 0119), so this ships ONE reminder per habit. That
 * is a deliberate scope call, not an oversight: a second reminder needs a
 * child table, and one reminder covers the donor's own 19 presets, every one of
 * which is a once-a-day habit.
 */

/** `data.type` the app routes on (`src/services/notificationRouting.ts`). */
export const HEALTH_HABIT_REMINDER_TYPE = 'health_habit_reminder';
const REMINDER_REFERENCE_TYPE = 'health_habit_reminder';

/** How many days of occurrences are materialised at a time. */
export const REMINDER_HORIZON_DAYS = 14;

/** Fallback when the member has no `notification_preferences` row yet. */
const FALLBACK_TIMEZONE = 'UTC';

type HabitScheduleRow = {
  id: string;
  user_id: string;
  name: string;
  frequency: string;
  custom_days: string | null;
  reminder_time: string | null;
  reminder_enabled: boolean;
  is_archived: boolean;
  deleted_at: string | null;
};

/** Parse 'HH:MM' → [hour, minute]; anything malformed answers null. */
export function parseReminderTime(raw: string | null | undefined): [number, number] | null {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return [hour, minute];
}

/**
 * Is this habit due on `weekday`?
 *
 * `weekday` is the donor's Apple `Calendar` numbering — **1 = Sunday … 7 =
 * Saturday** — because `user_habits.custom_days` stores exactly those numbers
 * (0119 header). Converting to a different convention here would silently shift
 * every custom schedule by a day.
 */
export function isHabitDueOnWeekday(
  frequency: string,
  customDays: number[] | null,
  weekday: number
): boolean {
  switch (frequency) {
    case 'weekdays':
      return weekday >= 2 && weekday <= 6;
    case 'weekends':
      return weekday === 1 || weekday === 7;
    case 'custom':
      // An empty/absent custom set means "no day was chosen"; the donor treats
      // that as every day rather than silently muting the habit.
      return customDays && customDays.length > 0 ? customDays.includes(weekday) : true;
    case 'daily':
    case 'twice_daily':
    default:
      return true;
  }
}

/** `custom_days` is stored as a JSON array of 1–7; a corrupt blob reads as null. */
export function parseCustomDays(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const days = parsed
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
    return days.length > 0 ? days : null;
  } catch {
    return null;
  }
}

/** One materialised nudge: when it fires, and the local day it belongs to. */
export interface HabitReminderOccurrence {
  fireAt: Date;
  /** The member's LOCAL calendar day — what the satisfied-sweep asks against. */
  localDate: string;
}

/**
 * The occurrences a habit's reminder should produce over the next
 * {@link REMINDER_HORIZON_DAYS} days, in the member's own timezone.
 *
 * Exported for tests and for the sweep; pure, so it never touches the DB.
 */
export function habitReminderOccurrences(
  habit: Pick<HabitScheduleRow, 'frequency' | 'custom_days' | 'reminder_time'>,
  timezone: string,
  now: Date,
  horizonDays = REMINDER_HORIZON_DAYS
): HabitReminderOccurrence[] {
  const hhmm = parseReminderTime(habit.reminder_time);
  if (!hhmm) return [];
  const [hour, minute] = hhmm;
  const customDays = parseCustomDays(habit.custom_days);

  // Anchor on the member's LOCAL calendar day, then walk forward in whole UTC
  // days reading only Y/M/D back off the cursor. The wall-clock hour is
  // re-anchored per day via `zonedWallTimeToUtcIso`, so a DST change moves the
  // instant rather than the reminder's local time — 08:00 stays 08:00.
  const parts = todayPartsInTz(timezone);
  const cursor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

  const out: HabitReminderOccurrence[] = [];
  for (let offset = 0; offset < horizonDays; offset += 1) {
    const day = new Date(cursor.getTime() + offset * 86_400_000);
    // JS getUTCDay(): 0 = Sunday. Apple `Calendar`: 1 = Sunday.
    const weekday = day.getUTCDay() + 1;
    if (!isHabitDueOnWeekday(habit.frequency, customDays, weekday)) continue;
    const fireAt = new Date(
      zonedWallTimeToUtcIso(
        day.getUTCFullYear(),
        day.getUTCMonth() + 1,
        day.getUTCDate(),
        hour,
        minute,
        timezone
      )
    );
    // Today's time may already have passed — the member gets tomorrow's.
    if (fireAt.getTime() <= now.getTime()) continue;
    out.push({ fireAt, localDate: day.toISOString().slice(0, 10) });
  }
  return out;
}

/** The member's IANA zone, or {@link FALLBACK_TIMEZONE} when unknown. */
async function resolveUserTimezone(d1: D1Database, userId: string): Promise<string> {
  try {
    const row = await drizzle(d1)
      .select({ timezone: notificationPreferences.timezone })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.user_id, userId))
      .get();
    return row?.timezone || FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

/**
 * Drop every UNSENT reminder for a habit. Sent rows are history and stay.
 *
 * Best-effort — NEVER throws, same contract as {@link syncHabitReminders} and
 * {@link topUpHabitReminders}. The `DELETE /health/habits/:id` route calls this
 * AFTER the habit row is already tombstoned, with no try/catch of its own — a
 * transient failure here (a D1 hiccup, a lock) must not turn an already-
 * successful delete into a client-visible 500. The worst outcome of swallowing
 * the error is a stray queued nudge for a habit that no longer exists, which
 * the satisfied-sweep and the next `topUpHabitReminders` pass both tolerate;
 * the alternative — reporting the delete itself as failed — would make the
 * client retry a DELETE that already succeeded, which 404s and reads as a bug.
 */
export async function cancelHabitReminders(d1: D1Database, habitId: string): Promise<void> {
  try {
    await drizzle(d1)
      .delete(scheduledNotifications)
      .where(
        and(
          eq(scheduledNotifications.reference_type, REMINDER_REFERENCE_TYPE),
          eq(scheduledNotifications.reference_id, habitId),
          isNull(scheduledNotifications.sent_at)
        )
      );
  } catch (error) {
    console.error('[health-habit-reminder] failed to cancel', {
      habitId,
      error: (error as Error).message,
    });
  }
}

/**
 * Re-materialise a habit's reminders. Idempotent: it cancels the unsent rows
 * first, so calling it twice leaves the same schedule rather than double pings.
 *
 * Best-effort — NEVER throws. A reminder that could not be scheduled must not
 * fail the habit write that asked for it.
 */
export async function syncHabitReminders(
  env: Env,
  d1: D1Database,
  habitId: string,
  now: Date = new Date()
): Promise<number> {
  try {
    const db = drizzle(d1);
    const habit = (await db
      .select({
        id: userHabits.id,
        user_id: userHabits.user_id,
        name: userHabits.name,
        frequency: userHabits.frequency,
        custom_days: userHabits.custom_days,
        reminder_time: userHabits.reminder_time,
        reminder_enabled: userHabits.reminder_enabled,
        is_archived: userHabits.is_archived,
        deleted_at: userHabits.deleted_at,
      })
      .from(userHabits)
      .where(eq(userHabits.id, habitId))
      .get()) as HabitScheduleRow | undefined;

    await cancelHabitReminders(d1, habitId);

    if (!habit) return 0;
    if (habit.deleted_at || habit.is_archived) return 0;
    if (!habit.reminder_enabled || !habit.reminder_time) return 0;

    const timezone = await resolveUserTimezone(d1, habit.user_id);
    const occurrences = habitReminderOccurrences(habit, timezone, now);
    if (occurrences.length === 0) return 0;

    const notifications = new NotificationService(env, d1);
    for (const { fireAt, localDate } of occurrences) {
      await notifications.scheduleNotification({
        userId: habit.user_id,
        // No householdId: health data is personal and never household-scoped.
        type: HEALTH_HABIT_REMINDER_TYPE,
        title: habit.name,
        body: 'Time to complete your habit.',
        data: {
          // The app routes on `data.type` — set it explicitly rather than
          // relying on `sendNotification` folding the row's `type` in.
          type: HEALTH_HABIT_REMINDER_TYPE,
          // `slot` + `local_date` are `HealthReminderData` (health-reminders-service.ts):
          // its satisfied-sweep drops a queued nudge once the habit is ticked,
          // and its per-habit cancel matches on `slot`. Emitting the shared
          // payload is what lets ONE sweep serve all four health categories.
          slot: habit.id,
          local_date: localDate,
          habitId: habit.id,
          screen: 'HealthHabits',
        },
        scheduledFor: fireAt,
        referenceType: REMINDER_REFERENCE_TYPE,
        referenceId: habit.id,
      });
    }
    return occurrences.length;
  } catch (error) {
    console.error('[health-habit-reminder] failed to schedule', {
      habitId,
      error: (error as Error).message,
    });
    return 0;
  }
}

/**
 * Daily sweep: re-materialise the horizon for every habit that wants reminders.
 *
 * Without this, reminders run dry {@link REMINDER_HORIZON_DAYS} days after the
 * last habit edit — which is the documented hole in `scheduleGarbageReminders`.
 * Cheap: one query plus a re-sync per reminder-enabled habit, and the whole
 * thing is a no-op on any Worker whose D1 has no such habits.
 */
export async function topUpHabitReminders(
  env: Env,
  d1: D1Database,
  now: Date = new Date()
): Promise<number> {
  try {
    const rows = await drizzle(d1)
      .select({ id: userHabits.id })
      .from(userHabits)
      .where(
        and(
          eq(userHabits.reminder_enabled, true),
          eq(userHabits.is_archived, false),
          isNull(userHabits.deleted_at),
          sql`${userHabits.reminder_time} IS NOT NULL`
        )
      )
      .all();

    let scheduled = 0;
    for (const row of rows) {
      scheduled += await syncHabitReminders(env, d1, row.id, now);
    }
    return scheduled;
  } catch (error) {
    console.error('[health-habit-reminder] top-up failed', {
      error: (error as Error).message,
    });
    return 0;
  }
}
