import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireHealthApi } from '../middleware/brand-gate';
import {
  HealthRemindersService,
  MAX_WATER_INTERVAL_MINUTES,
  MIN_WATER_INTERVAL_MINUTES,
  scheduleHealthRemindersForUserToday,
} from '../services/health-reminders-service';
import type { Env } from '../types';

/**
 * Symply Health — reminder schedule (`/health/reminders/*`).
 *
 * Its own router, not an addition to `routes/health.ts` or
 * `routes/health-body-extras.ts`, for the reason the P2 header already gives:
 * each health router owns disjoint sub-paths, so mount order at the shared
 * `/health` prefix does not matter, and a self-contained feature that can be
 * reverted in one file is worth more than one fewer file.
 *
 * Same contract as every other health surface: `requireHealthApi()` 404s the
 * whole thing on the House / Budget / Kaizen Workers, `authMiddleware()` scopes
 * every row to the authenticated USER, and there is no household path — health
 * data is personal (BRD §7).
 *
 * NOTE the middleware ORDER: brand gate BEFORE auth, so probing a surface this
 * Worker does not serve answers 404 (it does not exist here) rather than 401
 * (it exists and you are not allowed) — the latter confirms the endpoint.
 *
 * THIS ROUTER DOES NOT SEND ANYTHING. It only stores the schedule. Nudges are
 * materialised by the nightly cron pass in `services/health-reminders-service.ts`
 * and delivered by the platform's existing `processScheduledNotifications`
 * sweep.
 */
const healthReminders = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

healthReminders.use('/*', requireHealthApi());
healthReminders.use('/*', authMiddleware());

function uid(c: { get: (k: 'userId') => string }): string {
  return c.get('userId');
}

function svc(c: { env: Env }): HealthRemindersService {
  return new HealthRemindersService(c.env.DB);
}

/**
 * LOCAL wall-clock 'HH:MM'. Never a UTC time and never seconds — the member
 * picks "08:30", and the scheduler resolves it against their timezone. Rejected
 * loudly here rather than stored and silently mis-fired at UTC.
 */
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM (24h, local wall-clock)');

/**
 * 1 = Sunday … 7 = Saturday, matching `user_habits.custom_days` and Swift
 * `Calendar.weekday`. `null` means every day, which is NOT the same as `[]` —
 * an empty list would mean "never", and a settings screen that sends `[]` while
 * the toggle is on has a bug we would rather surface than encode.
 */
const weekdays = z.array(z.number().int().min(1).max(7)).min(1).max(7).nullable();

/**
 * An IANA zone id, loosely shaped. Not validated against the tz database: the
 * scheduler already falls back to the platform timezone (then UTC) when
 * `Intl` rejects the string, so a bad value degrades instead of 500-ing, and
 * hard-coding a zone allowlist here would break the day tzdata adds one.
 */
const timezone = z.string().min(1).max(64).nullable();

const preferencesPatch = z.object({
  timezone: timezone.optional(),

  meals_enabled: z.boolean().optional(),
  breakfast_enabled: z.boolean().optional(),
  breakfast_time: hhmm.optional(),
  lunch_enabled: z.boolean().optional(),
  lunch_time: hhmm.optional(),
  snack_enabled: z.boolean().optional(),
  snack_time: hhmm.optional(),
  dinner_enabled: z.boolean().optional(),
  dinner_time: hhmm.optional(),

  water_enabled: z.boolean().optional(),
  water_start_time: hhmm.optional(),
  water_end_time: hhmm.optional(),
  // Bounded at the schema edge as well as in the planner: a 1-minute interval
  // stored is a 1-minute interval every consumer has to remember to clamp.
  water_interval_minutes: z
    .number()
    .int()
    .min(MIN_WATER_INTERVAL_MINUTES)
    .max(MAX_WATER_INTERVAL_MINUTES)
    .optional(),

  weigh_in_enabled: z.boolean().optional(),
  weigh_in_time: hhmm.optional(),
  weigh_in_days: weekdays.optional(),

  habits_enabled: z.boolean().optional(),

  skip_if_already_logged: z.boolean().optional(),
  quiet_hours_enabled: z.boolean().optional(),
  quiet_hours_start: hhmm.optional(),
  quiet_hours_end: hhmm.optional(),
});

/** Never null: an unsaved member reads the all-OFF defaults (service header). */
healthReminders.get('/reminders/preferences', async (c) => {
  return c.json({ preferences: await svc(c).getPreferences(uid(c)) });
});

/**
 * Upsert keyed on `user_id`. PARTIAL: omitted fields keep their stored value.
 *
 * Turning a category OFF also drops that member's already-queued nudges, so the
 * switch takes effect now rather than after tonight's re-materialise — a member
 * who switches reminders off and still gets pushed for the next 24 hours has
 * every reason to believe the switch is broken.
 */
healthReminders.put(
  '/reminders/preferences',
  zValidator('json', preferencesPatch),
  async (c) => {
    const patch = c.req.valid('json');
    const service = svc(c);
    const preferences = await service.savePreferences(uid(c), patch);

    const turnedSomethingOff = (
      ['meals_enabled', 'water_enabled', 'weigh_in_enabled', 'habits_enabled'] as const
    ).some((key) => patch[key] === false);
    // A time/window change invalidates the queue just as thoroughly as an
    // off-switch: yesterday's materialised 13:00 lunch nudge is wrong the moment
    // the member moves lunch to 14:00.
    const rescheduleNeeded =
      turnedSomethingOff ||
      Object.keys(patch).some((key) => key.endsWith('_time') || key === 'timezone');

    let cancelled = 0;
    if (rescheduleNeeded) {
      cancelled = await service.cancelQueuedReminders(uid(c));
    }

    // Then re-materialise the rest of TODAY against the new schedule. Without
    // this a member who switches meal reminders on at 09:00 gets nothing until
    // the nightly 02:00 UTC pass — up to two days for anyone west of UTC — and
    // a feature that appears dead for two days is one people switch back off.
    // Only future local times are written, so enabling breakfast at lunchtime
    // still correctly starts tomorrow. Never throws.
    const scheduled = await scheduleHealthRemindersForUserToday(c.env, c.env.DB, uid(c));

    // Both counts are reported so the settings screen can say something true:
    // `scheduled > 0` means "your first reminder is today", `scheduled === 0`
    // with a live category means "starting tomorrow". Guessing either would be
    // the kind of small lie that teaches people not to trust the toggle.
    return c.json({ preferences, cancelled, scheduled });
  }
);

/**
 * Wipe the member's reminder setup entirely (soft delete + cancel the queue).
 *
 * Distinct from PUTting every flag to false: this tombstones the row, so a
 * device holding a stale cached schedule learns the setup is GONE rather than
 * re-uploading it on its next write.
 */
healthReminders.delete('/reminders/preferences', async (c) => {
  return c.json(await svc(c).clearPreferences(uid(c)));
});

// NO `/reminders/habits*` routes. Per-habit reminders are set through
// `POST/PUT /health/habits` in `routes/health.ts`, which already accept
// `reminder_time` / `reminder_enabled` and call `syncHabitReminders` to
// materialise the horizon. A second write path for the same two columns would
// be two endpoints with different side effects.

export default healthReminders;
