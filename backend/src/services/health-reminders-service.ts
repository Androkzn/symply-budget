import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import {
  habitLogs,
  healthGoals,
  nutritionEntries,
  waterEntries,
  weightEntries,
} from '../db/schema-health';
import { activityNotificationPreferences } from '../db/schema-health-p2';
import { healthReminderPreferences } from '../db/schema-health-reminders';
import {
  notificationPreferences,
  pushTokens,
  scheduledNotifications,
} from '../db/schema-notifications';
import type { Env } from '../types';
import { zonedWallTimeToUtcIso } from '../utils/timezone';

import { dateInTimezone } from './aihousekeeper/timezone';
import { HEALTH_HABIT_REMINDER_TYPE } from './health/habit-reminder';
import { NotificationService } from './notification-service';

/**
 * Symply Health — the reminder engine (donor "Smart Notifications").
 *
 * WHAT THIS OWNS: turning a member's stored reminder schedule into rows on the
 * platform `scheduled_notifications` queue. It owns NO delivery code and NO
 * settings UI. Delivery is `NotificationService.processScheduledNotifications()`,
 * already running every 5 minutes on every Worker; the settings screen is
 * someone else's file.
 *
 * ============================ SHAPE =======================================
 *
 * Two cron passes, both gated on `isHealthApiEnabled(env)` in
 * `backend/src/cron/scheduled.ts`:
 *
 *   1. MATERIALISE (once daily, 02:0x UTC) — {@link scheduleHealthRemindersForAllUsers}
 *      writes the member's NEXT LOCAL DAY of nudges as concrete
 *      `scheduled_notifications` rows, each at a UTC instant resolved from their
 *      local wall-clock time. Idempotent: it deletes that local day's unsent
 *      health rows before re-inserting, so a re-run (or a cron retry) cannot
 *      double-book.
 *
 *   2. SWEEP (every tick, BEFORE delivery) — {@link sweepSatisfiedHealthReminders}
 *      deletes queued rows that are about to fire but whose whole point has
 *      already been served: lunch was logged at 12:30, the weight is already in,
 *      the habit is ticked, the water goal is met. This is the donor's
 *      `skip_if_already_logged`, implemented as a cancellation rather than a
 *      delivery-time check because our delivery path is shared with every other
 *      brand and must not grow health-specific branches — and because a skipped
 *      nudge should leave nothing in the in-app notification centre either.
 *
 * Why pre-materialise rather than sweep-and-send (the donor's model): the queue
 * is the same one the mortgage statement reminder uses, so a health nudge gets
 * the platform's CAS delivery claim, attempt counting, receipt polling and
 * Expo-token invalidation for free. See
 * `backend/src/services/mortgage/statement-reminder.ts` for the pattern this
 * follows.
 *
 * ========================= BRAND INDEPENDENCE =============================
 *
 * THREE INDEPENDENT LAYERS, because this was a shipped bug once (child apps
 * surfaced House notifications) and one layer is not enough:
 *
 *   1. The cron calls into this file only when `isHealthApiEnabled(env)` — true
 *      for `APP_BRAND=symply-health` alone (`config/brand-capabilities.ts`). The
 *      House / Budget / Kaizen Workers never execute a line of it.
 *   2. Health runs its own Worker against its own D1 (`symply-health-db-*`), so
 *      even the rows are unreachable from another brand's queue.
 *   3. Every type this file emits is prefixed `health_` and is listed in the
 *      client's `HEALTH_DOMAIN_NOTIFICATION_TYPES`, which hides and re-routes
 *      them on any non-Health brand — the same belt-and-braces the House types
 *      get in `src/utils/notificationVisibility.ts`.
 *
 * ============================ CONSENT =====================================
 *
 * A reminder nobody asked for is spam. Four gates, ALL of which must pass before
 * a row is written, checked at materialisation so an un-consented member never
 * even has a queued row:
 *
 *   - every category defaults OFF (0134 DDL + {@link HEALTH_REMINDER_DEFAULTS});
 *   - `activity_notification_preferences.receive_push_notifications` must be on
 *     (the Health-specific delivery switch the settings screen drives);
 *   - `notification_preferences.push_enabled` must be on (platform master);
 *   - the member must have at least one ACTIVE push token, which only exists
 *     after the OS granted notification permission and the device registered —
 *     this is what "never schedule for a member who has not granted OS
 *     permission" reduces to server-side.
 */

/* ====================== TYPES + THE PUBLIC VOCABULARY ====================== */

/**
 * Re-exported, not redeclared: `services/health/habit-reminder.ts` owns habit
 * nudges and owns this string. One definition, so the client's brand filter and
 * this file's sweep can never drift from the module that actually writes it.
 */
export { HEALTH_HABIT_REMINDER_TYPE };

/** `data.type` values. The client routes and brand-filters on these. */
export const HEALTH_MEAL_REMINDER_TYPE = 'health_meal_reminder';
export const HEALTH_WATER_REMINDER_TYPE = 'health_water_reminder';
export const HEALTH_WEIGH_IN_REMINDER_TYPE = 'health_weigh_in_reminder';

/**
 * The three this file schedules. Habit nudges are the fourth health reminder
 * category but are NOT scheduled here — see {@link HEALTH_HABIT_REMINDER_TYPE},
 * re-exported from the module that owns them so there is exactly one definition
 * of the string in the codebase.
 */
export const HEALTH_REMINDER_TYPES = [
  HEALTH_MEAL_REMINDER_TYPE,
  HEALTH_WATER_REMINDER_TYPE,
  HEALTH_WEIGH_IN_REMINDER_TYPE,
] as const;

export type HealthReminderType = (typeof HEALTH_REMINDER_TYPES)[number];

/**
 * `scheduled_notifications.reference_type` for everything this file writes.
 *
 * ONE value for all three categories, deliberately: the nightly re-materialise
 * and the opt-out cancel both want "every queued health nudge for this member",
 * and a per-category reference type would turn each into three deletes that can
 * partially fail. The category is already in `type`.
 *
 * Habit nudges use their own reference type ('health_habit_reminder', keyed on
 * the HABIT id rather than the member) because their owner cancels per habit.
 * The sweep reads both.
 */
export const HEALTH_REMINDER_REFERENCE_TYPE = 'health_reminder';

export type HealthMealSlot = 'breakfast' | 'lunch' | 'snack' | 'dinner';

export const HEALTH_MEAL_SLOTS: readonly HealthMealSlot[] = [
  'breakfast',
  'lunch',
  'snack',
  'dinner',
];

/**
 * The payload every health reminder carries in `scheduled_notifications.data`.
 *
 * `local_date` is the member's LOCAL calendar day the nudge belongs to, written
 * at materialisation. The sweep needs it to ask "has lunch been logged today?"
 * against the right day, and re-deriving it from the fire instant would need the
 * timezone again and would be wrong for anyone whose 23:30 nudge is already
 * tomorrow in UTC.
 */
export interface HealthReminderData extends Record<string, string> {
  /**
   * Includes the habit type even though this file never SCHEDULES one — the
   * sweep normalises a habit row into this shape so both producers can be
   * evaluated by one satisfied-check.
   */
  type: HealthReminderType | typeof HEALTH_HABIT_REMINDER_TYPE;
  local_date: string;
  /** Meal slot for a meal reminder; the habit id for a habit reminder. */
  slot: string;
  /** expo-router path the tap opens. */
  screen: string;
}

export interface HealthReminderPreferences {
  user_id: string;
  timezone: string | null;
  meals_enabled: boolean;
  breakfast_enabled: boolean;
  breakfast_time: string;
  lunch_enabled: boolean;
  lunch_time: string;
  snack_enabled: boolean;
  snack_time: string;
  dinner_enabled: boolean;
  dinner_time: string;
  water_enabled: boolean;
  water_start_time: string;
  water_end_time: string;
  water_interval_minutes: number;
  weigh_in_enabled: boolean;
  weigh_in_time: string;
  /** 1 = Sunday … 7 = Saturday. `null` = every day. */
  weigh_in_days: number[] | null;
  skip_if_already_logged: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  /** null until the member has actually saved a schedule. */
  created_at: string | null;
  updated_at: string | null;
}

/**
 * EVERY CATEGORY OFF. This constant, not the DDL defaults, is the source of
 * truth for both the unsaved read and the first write, so the two can never
 * drift — the same call `ACTIVITY_PREFERENCE_DEFAULTS` makes.
 *
 * The times are pre-filled anyway (donor `NotificationSchedule.default`) so that
 * flipping a toggle immediately has a sensible schedule behind it and the
 * settings screen never renders an empty time field.
 */
export const HEALTH_REMINDER_DEFAULTS = {
  timezone: null,
  meals_enabled: false,
  breakfast_enabled: false,
  breakfast_time: '08:30',
  lunch_enabled: false,
  lunch_time: '13:00',
  snack_enabled: false,
  snack_time: '16:00',
  dinner_enabled: false,
  dinner_time: '19:00',
  water_enabled: false,
  water_start_time: '09:00',
  water_end_time: '21:00',
  water_interval_minutes: 120,
  weigh_in_enabled: false,
  weigh_in_time: '08:00',
  weigh_in_days: null,
  skip_if_already_logged: true,
  quiet_hours_enabled: true,
  quiet_hours_start: '23:00',
  quiet_hours_end: '07:00',
} as const;

/** What a client may send to `PUT /health/reminders/preferences`. */
export type HealthReminderPreferencesPatch = Partial<
  Omit<HealthReminderPreferences, 'user_id' | 'created_at' | 'updated_at'>
>;

/* ============================== BOUNDS ==================================== */

/**
 * The hard ceiling on water nudges in one day.
 *
 * A 09:00-21:00 window at the 15-minute floor below is 48 pings. Nobody wants
 * 48 pings. This clamps the worst case to a number a person could plausibly
 * have meant, and the excess is dropped from the END of the day (the member
 * keeps their morning cadence, which is when hydration reminders actually
 * work).
 */
export const MAX_WATER_REMINDERS_PER_DAY = 8;

/** Below this, a "reminder" is a metronome. Enforced in zod AND here. */
export const MIN_WATER_INTERVAL_MINUTES = 15;
export const MAX_WATER_INTERVAL_MINUTES = 12 * 60;

/**
 * Ceiling on rows written for one member in one nightly pass, across all four
 * categories. A member with 20 habits, 4 meals, a weigh-in and 8 water nudges is
 * already at 33; this stops a pathological account from filling the queue.
 */
const MAX_REMINDERS_PER_USER_PER_DAY = 40;

/** How far ahead of the fire time the sweep considers a row "about to fire". */
const SWEEP_HORIZON_MS = 6 * 60 * 1000;

/* ============================== COPY ====================================== */

/**
 * Donor notification copy (`NotificationManager.getTemplates`, and its backend
 * twin `NOTIFICATION_TEMPLATES.en`), one variant picked per nudge.
 *
 * Rotated rather than fixed for the donor's reason: an identical string every
 * day at the same minute stops being read after a week. Kept brand-neutral —
 * these strings must never say "SimpleHouse" or name a brand (see the AI-prompt
 * de-branding pass); the app name is already the push's title bar.
 */
const MEAL_COPY: Record<HealthMealSlot, { titles: string[]; bodies: string[] }> = {
  breakfast: {
    titles: ['Breakfast time', 'Morning fuel', 'Log breakfast'],
    bodies: [
      "Don't forget to log your breakfast.",
      'Track what you had this morning.',
      'Add breakfast to your food diary.',
    ],
  },
  lunch: {
    titles: ['Lunch time', 'Midday meal', 'Log lunch'],
    bodies: [
      'Time to log your lunch.',
      'Track your midday meal.',
      'Add lunch to your food diary.',
    ],
  },
  snack: {
    titles: ['Snack time', 'Quick bite', 'Log snack'],
    bodies: [
      'Had a snack? Log it now.',
      'Track your afternoon snack.',
      "Don't forget to log your snacks.",
    ],
  },
  dinner: {
    titles: ['Dinner time', 'Evening meal', 'Log dinner'],
    bodies: [
      'Time to log your dinner.',
      'Track your evening meal.',
      'Add dinner to your food diary.',
    ],
  },
};

const WATER_COPY = {
  titles: ['Stay hydrated', 'Water break', 'Drink water'],
  bodies: [
    'Time to drink some water.',
    'Keep yourself hydrated.',
    'Have you had water recently?',
  ],
};

const WEIGH_IN_COPY = {
  titles: ['Weigh-in time', 'Track your progress', 'Weight check'],
  bodies: [
    'Time to log your weight.',
    'Keep your weight log up to date.',
    'A quick morning check-in awaits.',
  ],
};

/**
 * Deterministic variant choice, seeded by the member + day + slot.
 *
 * NOT `Math.random()`, which the donor uses: the nightly pass is idempotent and
 * may legitimately re-run (cron retry, a manual re-materialise after a settings
 * change). With a random pick the re-run rewrites the copy of a row the member
 * may already be looking at in a notification-centre preview. A hash of
 * (user, date, slot) gives the same variation across days and members while
 * being stable for a given nudge.
 */
function pickVariant(seed: string, count: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % count;
}

/* ========================== TIME PRIMITIVES =============================== */

/** 'HH:MM' → minutes from local midnight. Returns null when unparseable. */
export function parseHhmmToMinutes(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * Is `minutes` (from local midnight) inside the quiet window?
 *
 * Wrap-around aware: 23:00→07:00 is the default and crosses midnight, so the
 * naive `start <= x < end` comparison would call it an empty window and let a
 * 03:00 nudge through.
 */
export function isWithinQuietHours(
  minutes: number,
  start: string,
  end: string
): boolean {
  const startMin = parseHhmmToMinutes(start);
  const endMin = parseHhmmToMinutes(end);
  if (startMin === null || endMin === null) return false;
  if (startMin === endMin) return false; // degenerate — no quiet window
  if (startMin < endMin) return minutes >= startMin && minutes < endMin;
  return minutes >= startMin || minutes < endMin;
}

/** The local calendar day `dayOffset` days from today in `timezone`. */
export function localDateParts(
  now: Date,
  timezone: string,
  dayOffset: number
): { year: number; month: number; day: number; iso: string; weekday: number } {
  let iso: string;
  try {
    iso = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    iso = now.toISOString().slice(0, 10);
  }
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  // Calendar-day math on a UTC midnight anchor: adding 86_400_000 ms to a
  // wall-clock instant would land on the wrong day across a DST boundary.
  const shifted = new Date(Date.UTC(y, m - 1, d) + dayOffset * 86_400_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    iso: shifted.toISOString().slice(0, 10),
    // 1 = Sunday … 7 = Saturday, matching `user_habits.custom_days` and Swift
    // `Calendar.weekday`. `getUTCDay()` is 0-indexed from Sunday.
    weekday: shifted.getUTCDay() + 1,
  };
}

/* ============================= THE SERVICE ================================ */

type Db = ReturnType<typeof drizzle>;

/**
 * Read/write side of the feature. Constructed with the raw `D1Database` like
 * every other health service (`new HealthRemindersService(c.env.DB)`), unlike
 * House/Budget services which take `(env, d1)` — health services never send.
 */
export class HealthRemindersService {
  private db: Db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  /**
   * Never null: a member who has never opened the settings screen reads the
   * all-OFF defaults, so the screen renders real toggles instead of blanks and
   * the caller never has to special-case "no row yet".
   */
  async getPreferences(userId: string): Promise<HealthReminderPreferences> {
    const row = await this.db
      .select()
      .from(healthReminderPreferences)
      .where(
        and(
          eq(healthReminderPreferences.user_id, userId),
          isNull(healthReminderPreferences.deleted_at)
        )
      )
      .get();

    if (!row) {
      return {
        user_id: userId,
        ...HEALTH_REMINDER_DEFAULTS,
        created_at: null,
        updated_at: null,
      };
    }
    return rowToPreferences(row);
  }

  /**
   * Upsert keyed on `user_id`. PARTIAL — an omitted field keeps its stored
   * value, so the settings screen can send one toggle at a time without having
   * to hold and re-send the whole object (which is how two screens racing each
   * other silently revert a setting).
   *
   * Re-saving also CLEARS a tombstone: a member who wiped their setup and then
   * turns a reminder back on gets a live row, not a resurrected deleted one.
   */
  async savePreferences(
    userId: string,
    patch: HealthReminderPreferencesPatch
  ): Promise<HealthReminderPreferences> {
    const ts = new Date().toISOString();
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      clean[key] = key === 'weigh_in_days' ? serialiseWeekdays(value as number[] | null) : value;
    }

    // A TOMBSTONED row must come back as DEFAULTS + this patch, not as this
    // patch merged onto whatever it held before the wipe: `clearPreferences`
    // only stamps `deleted_at`, it does not reset the columns, so turning one
    // reminder back on after "clear all data" would otherwise resurrect every
    // OTHER setting exactly as it stood pre-wipe — silently, since nothing
    // about a normal-looking PUT suggests it is un-tombstoning a dead row. A
    // live row keeps ordinary partial-merge semantics: editing one field must
    // never reset the rest to defaults.
    const existing = await this.db
      .select({ deleted_at: healthReminderPreferences.deleted_at })
      .from(healthReminderPreferences)
      .where(eq(healthReminderPreferences.user_id, userId))
      .get();
    const isRevivingATombstone = existing !== undefined && existing.deleted_at !== null;
    const updateSet = isRevivingATombstone
      ? {
          ...HEALTH_REMINDER_DEFAULTS,
          weigh_in_days: serialiseWeekdays(HEALTH_REMINDER_DEFAULTS.weigh_in_days),
          ...clean,
          updated_at: ts,
          deleted_at: null,
        }
      : { ...clean, updated_at: ts, deleted_at: null };

    await this.db
      .insert(healthReminderPreferences)
      .values({
        user_id: userId,
        ...HEALTH_REMINDER_DEFAULTS,
        weigh_in_days: serialiseWeekdays(HEALTH_REMINDER_DEFAULTS.weigh_in_days),
        ...clean,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      })
      .onConflictDoUpdate({
        target: healthReminderPreferences.user_id,
        set: updateSet,
      })
      .run();

    return this.getPreferences(userId);
  }

  /**
   * Tombstone the member's whole reminder setup and drop every queued nudge.
   *
   * Both halves matter: without the cancel, a member who turned reminders off
   * keeps receiving up to a day of already-materialised pushes and reasonably
   * concludes the switch does nothing.
   */
  async clearPreferences(userId: string): Promise<{ deleted: boolean; cancelled: number }> {
    const ts = new Date().toISOString();
    await this.db
      .update(healthReminderPreferences)
      .set({ deleted_at: ts, updated_at: ts })
      .where(
        and(
          eq(healthReminderPreferences.user_id, userId),
          isNull(healthReminderPreferences.deleted_at)
        )
      )
      .run();
    const cancelled = await this.cancelQueuedReminders(userId);
    return { deleted: true, cancelled };
  }

  /**
   * Drop every unsent health nudge for a member.
   *
   * Only unsent rows: a delivered nudge is history and belongs in the in-app
   * notification centre whatever the member changes afterwards.
   */
  async cancelQueuedReminders(userId: string, localDate?: string): Promise<number> {
    const rows = await this.db
      .select({ id: scheduledNotifications.id, data: scheduledNotifications.data })
      .from(scheduledNotifications)
      .where(
        and(
          eq(scheduledNotifications.user_id, userId),
          eq(scheduledNotifications.reference_type, HEALTH_REMINDER_REFERENCE_TYPE),
          isNull(scheduledNotifications.sent_at)
        )
      )
      .all();

    const ids = rows
      .filter((r) => localDate === undefined || parseReminderData(r.data)?.local_date === localDate)
      .map((r) => r.id);
    if (ids.length === 0) return 0;

    await this.db
      .delete(scheduledNotifications)
      .where(inArray(scheduledNotifications.id, ids))
      .run();
    return ids.length;
  }

  // NO habit-reminder read/write methods here. `POST/PUT /health/habits` in
  // `routes/health.ts` already accept `reminder_time` / `reminder_enabled` and
  // call `syncHabitReminders`, so a second write path would mean two ways to set
  // one field with different side effects.
}

/* ======================= PASS 1 — MATERIALISE ============================= */

export interface HealthReminderScheduleResult {
  /** Members holding at least one enabled category. */
  candidates: number;
  /** Members that passed every consent gate and got rows. */
  scheduled: number;
  /** Rows written. */
  reminders: number;
  /** Members skipped, by reason — the only way to debug "why no nudge". */
  skipped: Record<string, number>;
}

/**
 * Materialise the NEXT LOCAL DAY of reminders for every opted-in member.
 *
 * Run once per UTC day from the cron. "Next local day" rather than "next 24
 * hours" is the donor's model and is what makes one daily pass correct for every
 * timezone: whatever the offset, a member's local tomorrow is between ~13 and
 * ~48 hours ahead of a 02:00 UTC run, so the row is always in the future and
 * always materialised exactly once per local day.
 */
export async function scheduleHealthRemindersForAllUsers(
  env: Env,
  d1: D1Database,
  now: Date = new Date()
): Promise<HealthReminderScheduleResult> {
  const db = drizzle(d1);
  const result: HealthReminderScheduleResult = {
    candidates: 0,
    scheduled: 0,
    reminders: 0,
    skipped: {},
  };
  const skip = (reason: string) => {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  };

  let candidates: Array<typeof healthReminderPreferences.$inferSelect>;
  try {
    candidates = await db
      .select()
      .from(healthReminderPreferences)
      .where(
        and(
          isNull(healthReminderPreferences.deleted_at),
          or(
            eq(healthReminderPreferences.meals_enabled, true),
            eq(healthReminderPreferences.water_enabled, true),
            eq(healthReminderPreferences.weigh_in_enabled, true)
          )
        )
      )
      .all();
  } catch (error) {
    // 0134 not applied yet → no table → nothing to schedule. Log once and
    // return, rather than throwing and taking the whole cron tick down with it.
    console.error('[health-reminders] preferences read failed (migration 0134 applied?)', {
      error: (error as Error).message,
    });
    return result;
  }

  result.candidates = candidates.length;

  for (const row of candidates) {
    try {
      const outcome = await materialiseDay(env, d1, db, rowToPreferences(row), now, 1);
      if (outcome.written > 0) {
        result.scheduled += 1;
        result.reminders += outcome.written;
      } else {
        skip(outcome.reason);
      }
    } catch (error) {
      // One member's bad row must not cost every other member their reminders.
      skip('error');
      console.error('[health-reminders] failed to schedule for member', {
        userId: row.user_id,
        error: (error as Error).message,
      });
    }
  }

  return result;
}

/**
 * Materialise ONE member's reminders for the rest of TODAY, right now.
 *
 * Called after a settings save. Without it, a member who switches meal reminders
 * on at 09:00 gets nothing at all until the nightly pass runs, which for anyone
 * west of UTC means their first nudge is nearly two days away — and a feature
 * that appears to do nothing for two days is a feature people switch back off.
 *
 * The `dayOffset: 0` pass only ever writes nudges whose local time has not yet
 * passed (the past-time guard below), so enabling breakfast at lunchtime
 * correctly produces nothing today and starts tomorrow.
 *
 * Best-effort: never throws. A failed materialise must not fail the save that
 * triggered it — the nightly pass will pick the member up regardless.
 */
export async function scheduleHealthRemindersForUserToday(
  env: Env,
  d1: D1Database,
  userId: string,
  now: Date = new Date()
): Promise<number> {
  try {
    const db = drizzle(d1);
    const prefs = await new HealthRemindersService(d1).getPreferences(userId);
    const outcome = await materialiseDay(env, d1, db, prefs, now, 0);
    return outcome.written;
  } catch (error) {
    console.error('[health-reminders] same-day materialise failed', {
      userId,
      error: (error as Error).message,
    });
    return 0;
  }
}

/**
 * Write one member's nudges for the local day `dayOffset` days from now.
 *
 * Shared by the nightly pass (offset 1) and the post-save catch-up (offset 0) so
 * the consent gates, the quiet-hours filter and the idempotent cancel are
 * defined exactly once — two copies of this would be two places for the
 * "already queued" check to drift apart and start double-booking.
 */
async function materialiseDay(
  env: Env,
  d1: D1Database,
  db: Db,
  prefs: HealthReminderPreferences,
  now: Date,
  dayOffset: number
): Promise<{ written: number; reason: string }> {
  const gate = await resolveDeliveryGate(db, prefs.user_id);
  if (!gate.allowed) return { written: 0, reason: gate.reason };

  const timezone = prefs.timezone || gate.timezone;
  const target = localDateParts(now, timezone, dayOffset);
  const planned = planRemindersForDay(prefs, target);
  if (planned.length === 0) {
    return { written: 0, reason: 'nothing_enabled_for_that_day' };
  }

  // Idempotent: drop that local day's unsent rows first, so a cron retry, or a
  // second save a minute later, replaces rather than duplicates. Sent rows are
  // history and are left alone.
  await new HealthRemindersService(d1).cancelQueuedReminders(prefs.user_id, target.iso);

  const notifications = new NotificationService(env, d1);
  let written = 0;
  for (const item of planned) {
    const scheduledFor = new Date(
      zonedWallTimeToUtcIso(
        target.year,
        target.month,
        target.day,
        Math.floor(item.minutes / 60),
        item.minutes % 60,
        timezone
      )
    );
    // Past-time guard, matching the mortgage reminder. On the offset-0 pass this
    // is the load-bearing line: it is what makes "enable breakfast at 14:00"
    // start tomorrow instead of firing immediately.
    if (scheduledFor.getTime() <= now.getTime()) continue;

    await notifications.scheduleNotification({
      userId: prefs.user_id,
      // NO householdId: health data is user-scoped by design (BRD §7) and
      // there is no household read path to leak it into.
      type: item.type,
      title: item.title,
      body: item.body,
      // The FE routes on `data.type`. `sendNotification` force-sets it too, but
      // it is written EXPLICITLY here for the same reason the mortgage reminder
      // does: this object is also what the sweep reads back.
      data: {
        type: item.type,
        local_date: target.iso,
        slot: item.slot,
        screen: item.screen,
      } satisfies HealthReminderData,
      scheduledFor,
      referenceType: HEALTH_REMINDER_REFERENCE_TYPE,
      referenceId: prefs.user_id,
    });
    written += 1;
  }

  return { written, reason: written > 0 ? 'ok' : 'all_in_the_past' };
}

interface PlannedReminder {
  type: HealthReminderType;
  /** Minutes from local midnight. */
  minutes: number;
  title: string;
  body: string;
  slot: string;
  screen: string;
}

/**
 * Pure: what should fire on `target`, given the member's schedule. No I/O, so
 * the whole "which nudges, at what minute" decision is inspectable on its own.
 */
export function planRemindersForDay(
  prefs: HealthReminderPreferences,
  target: { iso: string; weekday: number }
): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  const quiet = (minutes: number) =>
    prefs.quiet_hours_enabled &&
    isWithinQuietHours(minutes, prefs.quiet_hours_start, prefs.quiet_hours_end);

  const push = (item: PlannedReminder) => {
    // Quiet hours are enforced HERE — the row is never created — rather than at
    // delivery. A suppressed nudge that still exists in the queue would surface
    // in the in-app notification centre at the moment it was suppressed from
    // the lock screen, which is exactly the thing quiet hours are for.
    if (quiet(item.minutes)) return;
    out.push(item);
  };

  // ---- meals ----
  if (prefs.meals_enabled) {
    for (const slot of HEALTH_MEAL_SLOTS) {
      if (!prefs[`${slot}_enabled` as const]) continue;
      const minutes = parseHhmmToMinutes(prefs[`${slot}_time` as const]);
      if (minutes === null) continue;
      const copy = MEAL_COPY[slot];
      const seed = `${prefs.user_id}|${target.iso}|${slot}`;
      push({
        type: HEALTH_MEAL_REMINDER_TYPE,
        minutes,
        title: copy.titles[pickVariant(seed, copy.titles.length)],
        body: copy.bodies[pickVariant(`${seed}|b`, copy.bodies.length)],
        slot,
        screen: '/health-nutrition',
      });
    }
  }

  // ---- weigh-in ----
  if (prefs.weigh_in_enabled) {
    const days = prefs.weigh_in_days;
    if (days === null || days.includes(target.weekday)) {
      const minutes = parseHhmmToMinutes(prefs.weigh_in_time);
      if (minutes !== null) {
        const seed = `${prefs.user_id}|${target.iso}|weigh_in`;
        push({
          type: HEALTH_WEIGH_IN_REMINDER_TYPE,
          minutes,
          title: WEIGH_IN_COPY.titles[pickVariant(seed, WEIGH_IN_COPY.titles.length)],
          body: WEIGH_IN_COPY.bodies[pickVariant(`${seed}|b`, WEIGH_IN_COPY.bodies.length)],
          slot: 'weigh_in',
          screen: '/health-weight',
        });
      }
    }
  }

  // ---- water ----
  if (prefs.water_enabled) {
    const start = parseHhmmToMinutes(prefs.water_start_time);
    const end = parseHhmmToMinutes(prefs.water_end_time);
    const interval = Math.min(
      Math.max(prefs.water_interval_minutes, MIN_WATER_INTERVAL_MINUTES),
      MAX_WATER_INTERVAL_MINUTES
    );
    // An end BEFORE the start is not an overnight hydration window, it is a
    // mis-set field. Emitting nothing is the honest reading; wrapping past
    // midnight would nudge somebody at 03:00 for a typo.
    if (start !== null && end !== null && end > start) {
      let count = 0;
      for (
        let minutes = start;
        minutes <= end && count < MAX_WATER_REMINDERS_PER_DAY;
        minutes += interval
      ) {
        const seed = `${prefs.user_id}|${target.iso}|water|${minutes}`;
        const before = out.length;
        push({
          type: HEALTH_WATER_REMINDER_TYPE,
          minutes,
          title: WATER_COPY.titles[pickVariant(seed, WATER_COPY.titles.length)],
          body: WATER_COPY.bodies[pickVariant(`${seed}|b`, WATER_COPY.bodies.length)],
          slot: `water_${minutes}`,
          screen: '/health-water',
        });
        // Only count what survived quiet hours, so a window that overlaps the
        // quiet block still gets its full allowance of audible nudges.
        if (out.length > before) count += 1;
      }
    }
  }

  // NO habit branch. `services/health/habit-reminder.ts` materialises those from
  // `user_habits.reminder_*` on a 14-day horizon of its own; emitting them here
  // as well would double every habit push.

  return out
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, MAX_REMINDERS_PER_USER_PER_DAY);
}

/* ========================= CONSENT RESOLUTION ============================= */

interface DeliveryGate {
  allowed: boolean;
  reason: string;
  timezone: string;
}

/**
 * The four consent gates, in the order that fails cheapest first.
 *
 * `receive_push_notifications` is read from `activity_notification_preferences`
 * — the ONE flag of that table's ten that has anything to do with reminders. Its
 * eight `notify_*` siblings describe other people's activity and are correctly
 * ignored here: a member who does not want to hear that a relative posted a
 * recipe has said nothing about whether they want to be reminded to drink water.
 */
async function resolveDeliveryGate(db: Db, userId: string): Promise<DeliveryGate> {
  const tokenCount = await db
    .select({ n: sql<number>`count(*)` })
    .from(pushTokens)
    .where(and(eq(pushTokens.user_id, userId), eq(pushTokens.is_active, true)))
    .get();
  // No live token means the OS never granted permission (or the member revoked
  // it and Expo told us). Scheduling anyway would fill the in-app notification
  // centre with nudges nobody ever saw on their lock screen.
  if (!tokenCount || Number(tokenCount.n) === 0) {
    return { allowed: false, reason: 'no_push_token', timezone: 'UTC' };
  }

  const platform = await db
    .select({
      push_enabled: notificationPreferences.push_enabled,
      timezone: notificationPreferences.timezone,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.user_id, userId))
    .get();
  // A missing platform row is the default-ON state (NotificationService creates
  // it lazily), so absence must not read as "disabled".
  if (platform && platform.push_enabled === false) {
    return { allowed: false, reason: 'platform_push_disabled', timezone: 'UTC' };
  }
  const timezone = platform?.timezone || 'UTC';

  let healthPush: { receive_push_notifications: boolean } | undefined;
  try {
    healthPush = await db
      .select({
        receive_push_notifications:
          activityNotificationPreferences.receive_push_notifications,
      })
      .from(activityNotificationPreferences)
      .where(eq(activityNotificationPreferences.user_id, userId))
      .get();
  } catch {
    // Table absent (pre-0120 Worker) → treat as the donor default, which is ON.
    healthPush = undefined;
  }
  if (healthPush && healthPush.receive_push_notifications === false) {
    return { allowed: false, reason: 'health_push_disabled', timezone };
  }

  return { allowed: true, reason: 'ok', timezone };
}

/* =========================== PASS 2 — SWEEP =============================== */

export interface HealthReminderSweepResult {
  examined: number;
  cancelled: number;
}

/**
 * Cancel about-to-fire nudges the member has already made pointless.
 *
 * The donor's `skip_if_already_logged`, moved from delivery time to just before
 * it. Runs on EVERY cron tick and must run BEFORE
 * `processScheduledNotifications`, which is what the cron ordering guarantees.
 *
 * Scope is deliberately narrow — only rows due inside {@link SWEEP_HORIZON_MS} —
 * for two reasons: it keeps the query bounded whatever the queue depth, and
 * "already logged" is a question that can only be answered honestly close to the
 * fire time (breakfast being unlogged at 02:00 says nothing about 08:30).
 */
export async function sweepSatisfiedHealthReminders(
  d1: D1Database,
  now: Date = new Date()
): Promise<HealthReminderSweepResult> {
  const db = drizzle(d1);
  const horizon = new Date(now.getTime() + SWEEP_HORIZON_MS).toISOString();
  const result: HealthReminderSweepResult = { examined: 0, cancelled: 0 };

  let due: Array<{
    id: string;
    user_id: string;
    type: string;
    data: string | null;
    scheduled_for: string;
  }>;
  try {
    due = await db
      .select({
        id: scheduledNotifications.id,
        user_id: scheduledNotifications.user_id,
        type: scheduledNotifications.type,
        data: scheduledNotifications.data,
        scheduled_for: scheduledNotifications.scheduled_for,
      })
      .from(scheduledNotifications)
      .where(
        and(
          // BOTH health reference types: the three categories this file
          // schedules, and the habit nudges `services/health/habit-reminder.ts`
          // schedules. That module has no skip-if-logged of its own, so without
          // this second value a member who ticked a habit at 07:00 is still told
          // to do it at 08:00.
          inArray(scheduledNotifications.reference_type, [
            HEALTH_REMINDER_REFERENCE_TYPE,
            HEALTH_HABIT_REMINDER_TYPE,
          ]),
          isNull(scheduledNotifications.sent_at),
          lte(scheduledNotifications.scheduled_for, horizon)
        )
      )
      .limit(200)
      .all();
  } catch (error) {
    console.error('[health-reminders] sweep read failed', { error: (error as Error).message });
    return result;
  }

  result.examined = due.length;
  if (due.length === 0) return result;

  // One preferences read per member, not per row: a member with four meal
  // nudges in the same window would otherwise cost four identical queries.
  const prefsByUser = new Map<string, HealthReminderPreferences>();
  const timezoneByUser = new Map<string, string>();
  const service = new HealthRemindersService(d1);
  const cancelIds: string[] = [];

  for (const row of due) {
    try {
      let prefs = prefsByUser.get(row.user_id);
      if (!prefs) {
        prefs = await service.getPreferences(row.user_id);
        prefsByUser.set(row.user_id, prefs);
      }
      if (!prefs.skip_if_already_logged) continue;

      const data = await resolveSweepData(db, row, prefs, timezoneByUser);
      if (!data) continue;

      if (await isReminderAlreadySatisfied(db, row.user_id, row.type, data, prefs, now)) {
        cancelIds.push(row.id);
      }
    } catch (error) {
      // A row we cannot evaluate is left in the queue and delivered. Erring
      // towards sending a redundant nudge beats silently dropping a wanted one.
      console.error('[health-reminders] sweep row failed', {
        id: row.id,
        error: (error as Error).message,
      });
    }
  }

  if (cancelIds.length > 0) {
    await db
      .delete(scheduledNotifications)
      .where(inArray(scheduledNotifications.id, cancelIds))
      .run();
    result.cancelled = cancelIds.length;
  }

  return result;
}

/**
 * Normalise a queued row into the shape {@link isReminderAlreadySatisfied} needs.
 *
 * The two producers write different payloads and neither is wrong:
 *   - THIS file writes `{ type, local_date, slot, screen }` — `local_date` is
 *     recorded at materialisation because it is free there and exact.
 *   - `services/health/habit-reminder.ts` writes `{ type, habitId, screen }`,
 *     with no date, because it materialises 14 days at once and a per-row date
 *     would be redundant with `scheduled_for`.
 *
 * So for a habit row the local day is DERIVED from the fire instant and the
 * member's zone. Deriving it is the whole reason this function exists: comparing
 * a habit tick against `scheduled_for`'s UTC date would be off by one for every
 * member whose reminder falls on the far side of midnight UTC — which for a
 * 21:00 nudge is most of the Americas, every night.
 */
async function resolveSweepData(
  db: Db,
  row: { type: string; user_id: string; data: string | null; scheduled_for: string },
  prefs: HealthReminderPreferences,
  timezoneByUser: Map<string, string>
): Promise<HealthReminderData | null> {
  const parsed = parseReminderData(row.data);
  if (parsed) return parsed;

  // No `local_date` on the payload → a habit row (or anything else that did not
  // come from this file). Only habit rows are understood; everything else is
  // left alone rather than guessed at.
  if (row.type !== HEALTH_HABIT_REMINDER_TYPE) return null;

  let raw: { habitId?: unknown; screen?: unknown };
  try {
    raw = row.data ? (JSON.parse(row.data) as { habitId?: unknown }) : {};
  } catch {
    return null;
  }
  const habitId = typeof raw.habitId === 'string' ? raw.habitId : null;
  if (!habitId) return null;

  let timezone = timezoneByUser.get(row.user_id);
  if (!timezone) {
    // The member's OWN reminder timezone wins over the platform one — a member
    // who pinned their health reminders to home time while travelling meant it.
    timezone = prefs.timezone || (await resolvePlatformTimezone(db, row.user_id));
    timezoneByUser.set(row.user_id, timezone);
  }

  const firesAt = new Date(row.scheduled_for);
  if (Number.isNaN(firesAt.getTime())) return null;

  return {
    type: HEALTH_HABIT_REMINDER_TYPE,
    local_date: dateInTimezone(firesAt, timezone),
    slot: habitId,
    screen: typeof raw.screen === 'string' ? raw.screen : '/health-habits',
  };
}

/** `notification_preferences.timezone`, or UTC when there is no row yet. */
async function resolvePlatformTimezone(db: Db, userId: string): Promise<string> {
  try {
    const row = await db
      .select({ timezone: notificationPreferences.timezone })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.user_id, userId))
      .get();
    return row?.timezone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Has the member already done the thing this nudge was going to ask for? */
async function isReminderAlreadySatisfied(
  db: Db,
  userId: string,
  type: string,
  data: HealthReminderData,
  prefs: HealthReminderPreferences,
  now: Date
): Promise<boolean> {
  const date = data.local_date;

  if (type === HEALTH_MEAL_REMINDER_TYPE) {
    const slot = data.slot;
    if (!HEALTH_MEAL_SLOTS.includes(slot as HealthMealSlot)) return false;
    const hit = await db
      .select({ id: nutritionEntries.id })
      .from(nutritionEntries)
      .where(
        and(
          eq(nutritionEntries.user_id, userId),
          eq(nutritionEntries.date, date),
          eq(nutritionEntries.meal_type, slot),
          isNull(nutritionEntries.deleted_at)
        )
      )
      .get();
    return !!hit;
  }

  if (type === HEALTH_WEIGH_IN_REMINDER_TYPE) {
    const hit = await db
      .select({ id: weightEntries.id })
      .from(weightEntries)
      .where(
        and(
          eq(weightEntries.user_id, userId),
          eq(weightEntries.date, date),
          isNull(weightEntries.deleted_at)
        )
      )
      .get();
    return !!hit;
  }

  if (type === HEALTH_HABIT_REMINDER_TYPE) {
    const hit = await db
      .select({ id: habitLogs.id })
      .from(habitLogs)
      .where(
        and(
          eq(habitLogs.habit_id, data.slot),
          eq(habitLogs.user_id, userId),
          eq(habitLogs.date, date),
          isNull(habitLogs.deleted_at)
        )
      )
      .get();
    return !!hit;
  }

  if (type === HEALTH_WATER_REMINDER_TYPE) {
    // Water is the one category where "logged today" is the WRONG test — a
    // single sip at 09:05 would silence the entire day. Two narrower tests
    // instead, either of which makes this particular nudge pointless:
    //
    //  (a) the day's goal is already met, so there is nothing left to ask for;
    //  (b) a sip landed within the last interval, so the member is on top of it
    //      and the nudge would arrive on the heels of their own action.
    const rows = await db
      .select({ amount_ml: waterEntries.amount_ml, created_at: waterEntries.created_at })
      .from(waterEntries)
      .where(
        and(
          eq(waterEntries.user_id, userId),
          eq(waterEntries.date, date),
          isNull(waterEntries.deleted_at)
        )
      )
      .all();
    if (rows.length === 0) return false;

    const goal = await db
      .select({ daily_water_ml: healthGoals.daily_water_ml })
      .from(healthGoals)
      // `health_goals` is effective-dated and has NO soft delete (0119/0125):
      // the goal in force on `date` is the latest row not after it.
      .where(and(eq(healthGoals.user_id, userId), lte(healthGoals.effective_date, date)))
      .orderBy(sql`${healthGoals.effective_date} DESC`)
      .get();

    const total = rows.reduce((sum, r) => sum + (Number(r.amount_ml) || 0), 0);
    const target = goal?.daily_water_ml ?? null;
    if (target !== null && target > 0 && total >= target) return true;

    const cutoff = now.getTime() - prefs.water_interval_minutes * 60 * 1000;
    return rows.some((r) => {
      const at = Date.parse(r.created_at);
      return Number.isFinite(at) && at >= cutoff;
    });
  }

  return false;
}

/* ============================== HELPERS =================================== */

function parseReminderData(raw: string | null): HealthReminderData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<HealthReminderData>;
    if (typeof parsed?.type !== 'string' || typeof parsed?.local_date !== 'string') return null;
    return {
      type: parsed.type as HealthReminderData['type'],
      local_date: parsed.local_date,
      slot: typeof parsed.slot === 'string' ? parsed.slot : '',
      screen: typeof parsed.screen === 'string' ? parsed.screen : '/health',
    };
  } catch {
    return null;
  }
}

function serialiseWeekdays(days: number[] | null | undefined): string | null {
  if (!days || days.length === 0) return null;
  const clean = Array.from(
    new Set(days.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))
  ).sort((a, b) => a - b);
  return clean.length > 0 ? JSON.stringify(clean) : null;
}

function parseWeekdays(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const days = parsed
      .map((d) => Number(d))
      .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
    return days.length > 0 ? days : null;
  } catch {
    return null;
  }
}

function rowToPreferences(
  row: typeof healthReminderPreferences.$inferSelect
): HealthReminderPreferences {
  return {
    user_id: row.user_id,
    timezone: row.timezone,
    meals_enabled: !!row.meals_enabled,
    breakfast_enabled: !!row.breakfast_enabled,
    breakfast_time: row.breakfast_time,
    lunch_enabled: !!row.lunch_enabled,
    lunch_time: row.lunch_time,
    snack_enabled: !!row.snack_enabled,
    snack_time: row.snack_time,
    dinner_enabled: !!row.dinner_enabled,
    dinner_time: row.dinner_time,
    water_enabled: !!row.water_enabled,
    water_start_time: row.water_start_time,
    water_end_time: row.water_end_time,
    water_interval_minutes: row.water_interval_minutes,
    weigh_in_enabled: !!row.weigh_in_enabled,
    weigh_in_time: row.weigh_in_time,
    weigh_in_days: parseWeekdays(row.weigh_in_days),
    skip_if_already_logged: !!row.skip_if_already_logged,
    quiet_hours_enabled: !!row.quiet_hours_enabled,
    quiet_hours_start: row.quiet_hours_start,
    quiet_hours_end: row.quiet_hours_end,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
