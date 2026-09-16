import {
  healthRemindersApi,
  type HealthReminderPreferences,
  type HealthReminderPreferencesPatch,
  type HealthReminderWeekday,
} from '@api/healthReminders';
import { notificationService } from '@services/notifications';
import { storageHelpers } from '@services/storage';

import { healthSyncStateFor, readThrough, writeThrough } from './healthRepository';

/**
 * Symply Health — REMINDERS (donor "Smart Notifications").
 *
 * The member's meal / water / weigh-in schedule. Read-through cached like every
 * other Health store so the settings screen renders instantly and offline, and
 * write-through so a toggle reflects immediately even when the network is gone.
 *
 * WHAT THIS MODULE IS NOT: it does not schedule anything on the device. The
 * nudges are materialised server-side by `backend/src/services/health-reminders-service.ts`
 * and delivered by the platform push pipeline, so they arrive whether or not the
 * app has been opened — which is the whole point of a reminder, and something a
 * device-local `scheduleNotificationAsync` cannot promise after a reinstall, a
 * restore, or 64 pending notifications (iOS drops the rest silently).
 *
 * ⚠️ **THAT SPLIT MOVES UNDER LOCAL-FIRST (He3d).** With the V2 flag on, the
 * Worker's D1 holds no plaintext for this member, so the server-side
 * materialiser has nothing to read and nothing to suppress. The SCHEDULE still
 * lives here — `health_reminder_preferences` is a Wave C table and stays
 * server-authoritative (plan §1.6) — but the PLACEMENT moves on-device to
 * `local/reminders/healthLocalReminders.ts`, which reads this cache through
 * {@link loadCachedHealthReminders} and the ledger, and pays the 64-pending cap
 * the paragraph above warns about with an explicit ≤56 budget. The cost is
 * stated rather than hidden: a member who never opens the app runs out of
 * horizon (plan §9 Q7, accepted with in-product copy).
 *
 * THE PERMISSION RULE. A reminder nobody can receive is worse than no reminder:
 * the member believes they are covered and finds out they were not. So
 * {@link enableHealthReminders} REFUSES to turn a category on until the OS has
 * granted notification permission, and returns the reason instead of throwing.
 * The server enforces the same rule independently (it will not queue for a
 * member with no active push token) — this half exists so the UI can explain
 * itself rather than silently failing.
 *
 * HABIT reminders are not here. They ride on the habit itself
 * (`user_habits.reminder_time` / `reminder_enabled`), so they are set through
 * `healthApi.createHabit` / `updateHabit` and cached with `health.habits.v1`.
 */

export const HEALTH_REMINDERS_KEY = 'health.reminders.v1';

/**
 * The device scheduler's bookkeeping — **He3d's bounded reschedule** (plan §9:
 * *"Reschedule only when the reminder set's content hash changes, or ≥6 h since
 * the last reschedule, whichever is sooner."*).
 *
 * Holds `{ hash, at, scheduled }` and nothing else: a 32-bit digest of the
 * reminder set, the epoch-ms stamp of the last reschedule, and the count that
 * pass placed. No times, no habit names, no readings — the hash exists partly so
 * that a fingerprint of a member's daily routine is not sitting in MMKV in
 * clear.
 *
 * Declared HERE rather than beside the scheduler for one mechanical reason:
 * `healthCacheKeys.test.ts` scans `health*Storage.ts` for `*_KEY` declarations
 * and fails a key that is not registered for sign-out clearing. A key declared
 * under `local/` would be invisible to that scan — which is exactly how a key
 * survives `logout()` and greets the next member on a shared handset.
 * Written and read by `local/reminders/healthLocalReminders.ts`.
 */
export const HEALTH_REMINDER_SCHEDULE_KEY = 'health.reminderSchedule.v1';

export type {
  HealthReminderPreferences,
  HealthReminderPreferencesPatch,
  HealthReminderWeekday,
};

/** The four reminder categories, as the settings screen groups them. */
export type HealthReminderCategory = 'meals' | 'water' | 'weigh_in';

/**
 * Mirror of the server's `HEALTH_REMINDER_DEFAULTS`. EVERY CATEGORY OFF.
 *
 * Used as the offline fallback and as the shape check for a stale cache. Kept in
 * sync with the backend constant by hand — if they ever disagree the server
 * wins, because `readThrough` replaces the cache wholesale on any successful
 * read.
 */
export const DEFAULT_HEALTH_REMINDERS: HealthReminderPreferences = {
  user_id: '',
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
  created_at: null,
  updated_at: null,
};

/** Matches the server's zod bound — a shorter interval is a metronome. */
export const MIN_WATER_INTERVAL_MINUTES = 15;
export const MAX_WATER_INTERVAL_MINUTES = 12 * 60;

/* ============================== READ =============================== */

async function fetchPreferences(): Promise<HealthReminderPreferences> {
  const res = await healthRemindersApi.getPreferences();
  return { ...DEFAULT_HEALTH_REMINDERS, ...(res.preferences ?? {}) };
}

export async function loadHealthReminders(): Promise<HealthReminderPreferences> {
  return readThrough(HEALTH_REMINDERS_KEY, fetchPreferences, DEFAULT_HEALTH_REMINDERS);
}

/**
 * The mirror only — no network, no read-through, no outbox flush.
 *
 * For the He3d device scheduler, which runs on foreground and on every ledger
 * bump. {@link loadHealthReminders} would put an HTTP round trip on both of
 * those, and the answer would be the same one already in MMKV: the settings
 * screen refreshes the mirror whenever the member is actually looking at their
 * schedule.
 *
 * Missing or shape-wrong cache falls back to {@link DEFAULT_HEALTH_REMINDERS},
 * which has EVERY CATEGORY OFF — so a fresh install schedules nothing rather
 * than guessing a routine.
 */
export async function loadCachedHealthReminders(): Promise<HealthReminderPreferences> {
  try {
    const cached = await storageHelpers.getObject<Partial<HealthReminderPreferences>>(
      HEALTH_REMINDERS_KEY
    );
    if (!cached || typeof cached !== 'object' || Array.isArray(cached)) {
      return DEFAULT_HEALTH_REMINDERS;
    }
    return { ...DEFAULT_HEALTH_REMINDERS, ...cached };
  } catch {
    return DEFAULT_HEALTH_REMINDERS;
  }
}

/** Is any category on? Drives the "Reminders · On/Off" row summary. */
export function hasAnyReminderEnabled(prefs: HealthReminderPreferences): boolean {
  return prefs.meals_enabled || prefs.water_enabled || prefs.weigh_in_enabled;
}

/**
 * A one-line summary of what is on, for a settings row's subtitle.
 *
 * Built here rather than in the screen so the phrasing is identical wherever it
 * is shown, and so it stays honest: it names only categories that will actually
 * produce a nudge (meals with no slot enabled produce nothing, and saying
 * "Meals" there would be a lie).
 */
export function describeHealthReminders(prefs: HealthReminderPreferences): string {
  const parts: string[] = [];
  if (prefs.meals_enabled && enabledMealSlots(prefs).length > 0) {
    parts.push(`Meals (${enabledMealSlots(prefs).length})`);
  }
  if (prefs.water_enabled) parts.push('Water');
  if (prefs.weigh_in_enabled) parts.push('Weigh-in');
  return parts.length > 0 ? parts.join(' · ') : 'Off';
}

/** Which meal slots would actually fire, in day order. */
export function enabledMealSlots(
  prefs: HealthReminderPreferences
): Array<'breakfast' | 'lunch' | 'snack' | 'dinner'> {
  if (!prefs.meals_enabled) return [];
  return (['breakfast', 'lunch', 'snack', 'dinner'] as const).filter(
    (slot) => prefs[`${slot}_enabled`]
  );
}

/**
 * How many water nudges the current window/interval produces in a day.
 *
 * Exposed so the settings screen can show the real number BEFORE the member
 * saves — "every 30 min from 09:00 to 21:00" reads harmless until you notice it
 * is 25 pings, and the server would silently clamp it to 8 anyway.
 */
export function waterRemindersPerDay(prefs: HealthReminderPreferences): number {
  const start = minutesFromHhmm(prefs.water_start_time);
  const end = minutesFromHhmm(prefs.water_end_time);
  if (start === null || end === null || end <= start) return 0;
  const interval = clampWaterInterval(prefs.water_interval_minutes);
  // Server ceiling — see MAX_WATER_REMINDERS_PER_DAY in the reminder service.
  return Math.min(Math.floor((end - start) / interval) + 1, 8);
}

export function clampWaterInterval(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_HEALTH_REMINDERS.water_interval_minutes;
  return Math.min(
    Math.max(Math.round(minutes), MIN_WATER_INTERVAL_MINUTES),
    MAX_WATER_INTERVAL_MINUTES
  );
}

function minutesFromHhmm(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

/* ============================== WRITE ============================== */

/**
 * The outcome of a reminder write, in the vocabulary the UI needs.
 *
 * Never carries an error object or a server string: a failed save must render
 * as "Couldn't save your reminders. They'll sync when you're back online.", not
 * as an HTTP status or an axios message (no-raw-error-leaks).
 */
export interface HealthReminderSaveResult {
  preferences: HealthReminderPreferences;
  status: 'saved' | 'offline' | 'permission_denied';
  /** Ready-to-render, already friendly. Empty when `status === 'saved'`. */
  message: string;
  /**
   * How many nudges the server queued for the REST OF TODAY as a result of this
   * save. `> 0` → the member's first reminder is today; `0` with a category on →
   * it starts tomorrow. Read it before promising either; do not infer.
   */
  scheduledToday: number;
}

const OFFLINE_MESSAGE =
  "Couldn't save your reminders just now. They'll sync when you're back online.";
const PERMISSION_MESSAGE =
  'Turn on notifications for this app to get reminders. You can enable them in Settings.';

/**
 * Save a partial change to the schedule.
 *
 * Does NOT check permission — use {@link enableHealthReminders} for anything
 * that switches a category ON. Changing a TIME, or switching something off, is
 * always allowed: a member with notifications denied must still be able to tidy
 * up their schedule, and blocking that would trap them.
 */
export async function saveHealthReminders(
  patch: HealthReminderPreferencesPatch
): Promise<HealthReminderSaveResult> {
  const current = await loadHealthReminders();
  const optimistic: HealthReminderPreferences = { ...current, ...patch };

  // `writeThrough` returns the REFRESHED preferences, not the PUT's own body, so
  // `scheduled` has to be caught on the way past. It stays 0 when the write
  // failed, which is exactly right — nothing was queued.
  let scheduledToday = 0;
  const next = await writeThrough(
    HEALTH_REMINDERS_KEY,
    async () => {
      const res = await healthRemindersApi.savePreferences(patch);
      scheduledToday = res.scheduled ?? 0;
      return res;
    },
    fetchPreferences,
    optimistic,
    `reminders ${Object.keys(patch).join(',')}`
  );

  // `writeThrough` deliberately swallows the error and hands back the optimistic
  // value so the toggle does not visibly snap back. `healthSyncStateFor` is the
  // repository's own record of whether that write actually reached the server —
  // the only honest signal available, and the one that decides whether the
  // member is told their change is pending.
  const synced = healthSyncStateFor(HEALTH_REMINDERS_KEY) === 'synced';
  return synced
    ? { preferences: next, status: 'saved', message: '', scheduledToday }
    : { preferences: next, status: 'offline', message: OFFLINE_MESSAGE, scheduledToday: 0 };
}

/**
 * Turn a category ON, asking for OS notification permission first.
 *
 * Returns `permission_denied` (with a friendly message and the UNCHANGED
 * preferences) rather than enabling something that can never be delivered. This
 * is the "never schedule for a member who has not granted OS permission" rule,
 * enforced at the point the member asks for it — the server enforces its own
 * half independently by refusing to queue without an active push token.
 */
export async function enableHealthReminders(
  category: HealthReminderCategory,
  patch: HealthReminderPreferencesPatch = {}
): Promise<HealthReminderSaveResult> {
  const granted = await ensureHealthReminderPermission();
  if (!granted) {
    return {
      preferences: await loadHealthReminders(),
      status: 'permission_denied',
      message: PERMISSION_MESSAGE,
      scheduledToday: 0,
    };
  }

  const enableKey = `${category}_enabled` as const;
  return saveHealthReminders({
    [enableKey]: true,
    // Always send the device zone alongside an enable. Without it the server
    // falls back to `notification_preferences.timezone`, which DEFAULTS to
    // 'America/New_York' — a member in Berlin who never opened the platform
    // notification screen would get their 08:00 weigh-in at 14:00.
    timezone: deviceTimezone(),
    ...patch,
  });
}

/** Switch a category off. Never needs permission. */
export async function disableHealthReminders(
  category: HealthReminderCategory
): Promise<HealthReminderSaveResult> {
  return saveHealthReminders({ [`${category}_enabled`]: false });
}

/**
 * Drop the whole schedule (tombstone + cancel the queue).
 *
 * Note this is NOT what sign-out does — sign-out clears the local CACHE
 * (`healthCacheKeys.ts`) and leaves the server-side schedule intact, because the
 * member signing back in wants their reminders back.
 */
export async function clearHealthReminders(): Promise<HealthReminderSaveResult> {
  try {
    await healthRemindersApi.clearPreferences();
    const fresh = await readThrough(
      HEALTH_REMINDERS_KEY,
      fetchPreferences,
      DEFAULT_HEALTH_REMINDERS
    );
    return { preferences: fresh, status: 'saved', message: '', scheduledToday: 0 };
  } catch {
    return {
      preferences: await loadHealthReminders(),
      status: 'offline',
      message: OFFLINE_MESSAGE,
      scheduledToday: 0,
    };
  }
}

/* =========================== PERMISSION ============================ */

/**
 * Ask the OS for notification permission if we do not already have it, and
 * register the push token so the server has somewhere to send.
 *
 * Both halves are needed: permission without a registered token means the
 * server's `no_push_token` gate refuses to queue anything, and the member sees
 * a switch that is on and does nothing.
 */
export async function ensureHealthReminderPermission(): Promise<boolean> {
  try {
    if (await notificationService.hasPermission()) {
      // Already granted — but the token may never have been registered on this
      // install (a restore carries the permission, not the Expo token).
      await notificationService.registerWithServer();
      return true;
    }
    const granted = await notificationService.requestPermission();
    if (!granted) return false;
    await notificationService.registerWithServer();
    return true;
  } catch {
    // A permission/token failure must not throw into a settings screen. The
    // caller renders PERMISSION_MESSAGE, which is true either way: we cannot
    // deliver.
    return false;
  }
}

/**
 * Whether the member could receive a reminder right now, without prompting.
 *
 * For the settings screen's inline warning ("Notifications are off for this
 * app") — call it on focus, never in a render.
 */
export async function healthReminderPermissionStatus(): Promise<
  'granted' | 'denied' | 'undetermined'
> {
  try {
    const status = await notificationService.getPermissionStatus();
    if (status === 'granted') return 'granted';
    if (status === 'undetermined') return 'undetermined';
    return 'denied';
  } catch {
    return 'undetermined';
  }
}

/* ============================== SYNC =============================== */

/**
 * Keep the stored schedule pointing at the device's ACTUAL timezone.
 *
 * Call on app start (and on foreground) for a signed-in Health member. Reminder
 * times are LOCAL wall-clock resolved server-side against the stored zone, so a
 * member who flies to Tokyo and never re-saves would otherwise keep getting
 * their 08:00 breakfast nudge at 08:00 *London* time. Mirrors what
 * `notificationStore.loadPreferences` already does for the platform row.
 *
 * No-ops when nothing is enabled — there is no schedule to keep accurate, and a
 * write would create a row for a member who never asked for reminders.
 *
 * Best-effort and never throws: this runs at launch, and a launch path must not
 * be able to fail on a preferences write.
 */
export async function syncHealthReminderTimezone(): Promise<void> {
  try {
    const prefs = await loadHealthReminders();
    if (!hasAnyReminderEnabled(prefs)) return;
    const device = deviceTimezone();
    if (!device || device === prefs.timezone) return;
    await saveHealthReminders({ timezone: device });
  } catch {
    // Deliberately silent — see the header.
  }
}

function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
