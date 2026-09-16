import { apiClient } from './client';

/**
 * Symply Health REMINDERS API client — meal, water and weigh-in nudges.
 *
 * Base path: `/health/reminders` on the `symply-health-api` Worker, served by
 * `backend/src/routes/health-reminders.ts`. Every row is scoped to the
 * authenticated USER (a reminder schedule says as much about a person as the
 * readings it nudges for) and the whole surface 404s on any other brand's
 * Worker via `requireHealthApi()`.
 *
 * NOTE — envelope shape. These call `apiClient` DIRECTLY rather than the
 * `api.get/post` helpers in `client.ts`. Those helpers type the body as
 * `ApiResponse<T>` (`{ data: T }`), but this Worker returns the payload BARE —
 * `c.json({ preferences })` — with no wrapping middleware. Going through the
 * helper makes every read resolve `undefined` against the live server while unit
 * tests pass, because the fixtures wrap the same way the type claims. The body
 * IS the payload; `src/api/__tests__/healthEnvelope.test.ts` pins that at source
 * level.
 *
 * HABIT reminders are NOT here. They are set through `healthApi.createHabit` /
 * `updateHabit` (`src/api/health.ts`), which carry `reminder_time` and
 * `reminder_enabled` on the habit itself — one field, one endpoint.
 *
 * DEPLOYED SEMANTICS. Until migration 0134 is applied, `GET` still answers 200
 * with the all-OFF defaults (the Worker returns them for a missing row and
 * treats a missing TABLE the same way) and `PUT` fails. The storage layer maps
 * that failure to a friendly message and keeps the cached schedule — it must
 * never surface the raw error (see the no-raw-error-leaks rule).
 */

/* ============================ Row shapes ============================ */

/**
 * Weekday numbers are 1 = Sunday … 7 = Saturday, matching the donor's Swift
 * `Calendar.weekday` and the `custom_days` already stored on habits. NOT
 * JavaScript's `Date.getDay()` (0 = Sunday) — converting at the edge is the one
 * place a fencepost error silently shifts every schedule by a day.
 */
export type HealthReminderWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface HealthReminderPreferences {
  user_id: string;
  /** IANA zone the `*_time` fields are wall-clock in; null = use the device's. */
  timezone: string | null;

  /** Master switch. A slot fires only when this AND its own flag are on. */
  meals_enabled: boolean;
  breakfast_enabled: boolean;
  /** LOCAL wall-clock 'HH:MM'. Never UTC. */
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
  /** null = every day. An empty array is not a valid value — see the route. */
  weigh_in_days: HealthReminderWeekday[] | null;

  /** Cancel a nudge whose logging already happened. Donor default: ON. */
  skip_if_already_logged: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;

  /** null until the member has actually saved a schedule. */
  created_at: string | null;
  updated_at: string | null;
}

/**
 * PARTIAL by design: the settings screen sends one toggle at a time. Sending the
 * whole object back is what makes two screens racing each other revert a
 * setting, so the client should never assemble one.
 */
export type HealthReminderPreferencesPatch = Partial<
  Omit<HealthReminderPreferences, 'user_id' | 'created_at' | 'updated_at'>
>;

const BASE = '/health';

export const healthRemindersApi = {
  /** Never null — an unsaved member reads the all-OFF defaults. */
  getPreferences: () =>
    apiClient
      .get<{ preferences: HealthReminderPreferences }>(`${BASE}/reminders/preferences`)
      .then((r) => r.data),

  /**
   * `cancelled` is how many already-queued nudges this save dropped (a category
   * switched off, or a time moved, invalidates what was queued). `scheduled` is
   * how many it immediately re-queued for the REST OF TODAY.
   *
   * Read `scheduled` before telling the member anything: `> 0` means their first
   * reminder is today; `0` with a live category means it starts tomorrow. The
   * screen must not guess — a toggle that promises "today" and delivers
   * tomorrow is how people learn to distrust the switch.
   */
  savePreferences: (body: HealthReminderPreferencesPatch) =>
    apiClient
      .put<{
        preferences: HealthReminderPreferences;
        cancelled: number;
        scheduled: number;
      }>(`${BASE}/reminders/preferences`, body)
      .then((r) => r.data),

  /**
   * Wipe the schedule entirely: tombstones the row AND drops the queue.
   *
   * Distinct from switching every category off — the tombstone is what tells
   * another device the setup is GONE rather than letting it re-upload its own
   * cached copy on the next write.
   */
  clearPreferences: () =>
    apiClient
      .delete<{ deleted: boolean; cancelled: number }>(`${BASE}/reminders/preferences`)
      .then((r) => r.data),
};

export default healthRemindersApi;
