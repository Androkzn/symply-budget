-- Symply Health — REMINDERS. Give the app the one thing the donor's notification
-- feature is entirely built around and this port has none of: a per-member
-- schedule for meal, water, weigh-in and habit nudges.
--
-- WHY THIS EXISTS AT ALL. `grep -rni reminder src/features/health` returned TWO
-- hits, both comments, and `grep -rni reminder backend/src/routes/health*.ts`
-- returned ZERO. There is no row anywhere on the wire that can say "remind me to
-- log lunch at 13:00" — the ten `notify_*` booleans on
-- `activity_notification_preferences` (0120) are about OTHER PEOPLE's activity
-- (a family member shared a recipe / a photo / hit a milestone) plus two
-- delivery-channel switches. Not one of them is a reminder. Without this table
-- the entire donor "Smart Notifications" surface — the single biggest engagement
-- feature in the donor app — has nowhere to store its state.
--
-- ============================ DONOR MAPPING ================================
--
-- Donor = `~/Desktop/Symply Ecosystem/Simply Health/`, read-only.
-- Sources: `backend/migrations/005_smart_notifications.sql`,
--          `backend/migrations/094_reminder_delivery_channels.sql`,
--          `SimpleHealth/Data/Services/NotificationManager.swift`.
--
-- The donor splits reminder state across TWO tables:
--   `user_notification_schedule`    → WHEN each routine fires (times + per-slot
--                                     enabled flags + timezone)
--   `smart_reminder_preferences`    → WHETHER a category fires at all, plus the
--                                     skip rules and quiet hours
--
--   donor `user_notification_schedule.breakfast_time`     → `breakfast_time`
--   donor `user_notification_schedule.breakfast_enabled`  → `breakfast_enabled`
--   donor (…lunch/snack/dinner, same pair)                → same pairs
--   donor `user_notification_schedule.morning_time`       → `weigh_in_time`
--   donor `user_notification_schedule.timezone`           → `timezone`
--   donor `smart_reminder_preferences.meal_logging_enabled`      → `meals_enabled`
--   donor `smart_reminder_preferences.water_reminders_enabled`   → `water_enabled`
--   donor `smart_reminder_preferences.morning_weight_enabled`    → `weigh_in_enabled`
--   donor `smart_reminder_preferences.skip_if_already_logged`    → `skip_if_already_logged`
--   donor `smart_reminder_preferences.skip_during_sleep`         → `quiet_hours_enabled`
--   donor `smart_reminder_preferences.quiet_hours_start`/`_end`  → same names
--
-- ============================ DEVIATIONS ===================================
--
--   * ONE TABLE, NOT TWO. The donor's split exists because its schedule half is
--     written by a PATTERN ANALYSER (`patternAnalyzer.ts`) that infers meal times
--     from logging history and overwrites the auto-detected rows, while the
--     preferences half is only ever written by the member. We ported no pattern
--     analyser, so every column here has exactly one writer — the member — and
--     two tables would mean two upserts, two round trips and two ways for the
--     halves to disagree about whether breakfast is on.
--
--   * NO `*_auto_detected` / `pattern_confidence` / `last_pattern_analysis`
--     COLUMNS, for the same reason. They are the pattern analyser's bookkeeping.
--     A column that no code can ever set to anything but its default is not
--     "future-proofing", it is a lie about what the app knows: the settings UI
--     would have to render "auto-detected: yes" over a time the member typed.
--
--   * WATER GETS A REAL SCHEDULE (`water_start_time` / `water_end_time` /
--     `water_interval_minutes`), which the donor does NOT have. This is a donor
--     BUG we are declining to port: `smart_reminder_preferences` ships
--     `water_reminders_enabled` and the Settings screen renders a toggle for it
--     (`NotificationSettingsView.swift:409`), but `scheduleNotificationsForUser`
--     (`smartNotifications.ts:753-845`) only ever emits morning / breakfast /
--     lunch / snack / dinner / evening. The toggle is wired to nothing. A water
--     reminder is intrinsically a RECURRING nudge across the waking day, not a
--     single clock time, so it needs a window and an interval or it cannot exist.
--
--   * WEIGH-IN IS ITS OWN CATEGORY, not the donor's `morning_routine` bundle.
--     The donor fires one "morning routine" push gated by
--     `morning_weight_enabled OR morning_photo_enabled` and leaves the member to
--     work out which of the two it meant. We have no progress-photo capture on
--     the Weight tab, so half that OR is dead here, and a push that says
--     "log your weight" when it means weight is the honest version.
--
--   * `weigh_in_days` IS A JSON WEEKDAY ARRAY, so "weigh in on Mondays and
--     Thursdays" is expressible. The donor's legacy `notification_settings`
--     already had `weight_reminder_days` with exactly that default ([1,4]) and
--     its smart-notification rewrite silently dropped it, regressing anyone who
--     did not weigh daily into a daily nag. NULL = every day.
--     CONVENTION: 1 = Sunday … 7 = Saturday, matching Swift `Calendar.weekday`
--     and the existing `user_habits.custom_days` comment. Do not renumber:
--     `user_habits.custom_days` rows already exist in this vocabulary.
--
--   * HABIT REMINDERS ARE NOT IN THIS TABLE AND NOT IN THIS FEATURE'S WRITE
--     PATH. `user_habits` (0119) already carries `reminder_time`,
--     `reminder_enabled`, `frequency` and `custom_days` — the exact donor
--     `UserHabit.reminders` + `HabitFrequency` shape — and
--     `backend/src/services/health/habit-reminder.ts` already materialises from
--     them (14-day horizon, topped up by its own cron sweep), driven by
--     `POST/PUT /health/habits`. There is deliberately NO `habits_enabled`
--     master switch here: `user_habits.reminder_enabled` is already a per-habit
--     switch, a second global one would be a second authority over the same
--     nudge, and the two would disagree the first time one of them was written
--     without the other. What the reminder ENGINE adds for habits is the one
--     thing that module has no way to do — cancelling a queued habit nudge whose
--     habit has already been ticked today (`skip_if_already_logged` below).
--
--   * NO DELIVERY-CHANNEL COLUMNS (donor `094`'s `push_enabled` /
--     `in_app_enabled`). This platform already has both, one layer up:
--     `notification_preferences.push_enabled` is the master push switch every
--     `NotificationService.sendNotification` call already honours, and
--     `activity_notification_preferences.receive_push_notifications` is the
--     Health-specific one the settings screen is being built against. Adding a
--     third copy would create a three-way disagreement with no tiebreak rule.
--
--   * NO FOREIGN KEY ON `user_id`. Consistent with the health domain's other
--     preference tables and deliberate: D1 DOES enforce FKs, and a preferences
--     row is not worth failing a write over. `users` deletion already clears
--     health rows through the deletion saga.
--
-- ============================ CONVENTIONS ==================================
--
-- `IF NOT EXISTS` throughout; `updated_at` on the row (this is a delta-syncable
-- health table like every other one in 0119/0120); `deleted_at` soft delete so a
-- member who clears their reminder setup leaves a tombstone another device can
-- act on rather than silently re-inheriting the old schedule from its cache.
--
-- Times are LOCAL wall-clock 'HH:MM' strings interpreted in `timezone`. They are
-- never UTC. The scheduler resolves them to a UTC instant at materialisation
-- time (`zonedWallTimeToUtcIso`), which is what makes a 08:00 weigh-in nudge
-- arrive at 08:00 wherever the member is, and survive a DST change.
--
-- ========================= NOT APPLIED / NOT DEPLOYED ======================
--
-- Written but NOT run against any D1 and NOT deployed. Until it is applied,
-- `GET /health/reminders/preferences` answers the all-OFF defaults from
-- `HEALTH_REMINDER_DEFAULTS` (the service returns them for a missing row, and
-- treats a missing TABLE the same way), `PUT` fails and is surfaced to the
-- client as "couldn't save", and the cron's daily materialisation finds no
-- opted-in members and schedules nothing. Nothing is sent. That is the correct
-- unapplied behaviour: silence.

CREATE TABLE IF NOT EXISTS health_reminder_preferences (
  -- PRIMARY KEY, not a separate `id`: at most one reminder setup per member.
  -- Same shape as `activity_notification_preferences` (0120).
  user_id TEXT PRIMARY KEY,

  -- IANA zone the 'HH:MM' columns below are wall-clock in. NULL = fall back to
  -- `notification_preferences.timezone`, then UTC. Stored HERE rather than only
  -- on the platform row because a member can legitimately keep their health
  -- reminders on home time while travelling, and because the platform row's
  -- default ('America/New_York') is a guess we must not silently apply to a
  -- 07:00 weigh-in.
  timezone TEXT,

  -- ------------------------------ meals ------------------------------------
  -- Master switch (donor `meal_logging_enabled`) AND per-slot switches, both,
  -- exactly as the donor does it: the master is what a "meal reminders" toggle
  -- flips, the per-slot flags are what someone who only wants a dinner nudge
  -- sets. A slot fires only when BOTH are on.
  meals_enabled INTEGER NOT NULL DEFAULT 0,
  breakfast_enabled INTEGER NOT NULL DEFAULT 0,
  breakfast_time TEXT NOT NULL DEFAULT '08:30',
  lunch_enabled INTEGER NOT NULL DEFAULT 0,
  lunch_time TEXT NOT NULL DEFAULT '13:00',
  snack_enabled INTEGER NOT NULL DEFAULT 0,
  snack_time TEXT NOT NULL DEFAULT '16:00',
  dinner_enabled INTEGER NOT NULL DEFAULT 0,
  dinner_time TEXT NOT NULL DEFAULT '19:00',

  -- ------------------------------ water ------------------------------------
  -- A window + an interval, not a clock time. Defaults describe a waking day at
  -- a two-hourly cadence (7 nudges) — deliberately gentler than the 30-60 min
  -- most hydration apps default to, because left alone this is the one category
  -- capable of being the noisiest thing the app does. The interval is bounded
  -- 15 min - 12 h at the route, and the resulting count is clamped to
  -- MAX_WATER_REMINDERS_PER_DAY (8) in `health-reminders-service.ts`, so even a
  -- pathological setting cannot produce a day of pinging.
  water_enabled INTEGER NOT NULL DEFAULT 0,
  water_start_time TEXT NOT NULL DEFAULT '09:00',
  water_end_time TEXT NOT NULL DEFAULT '21:00',
  water_interval_minutes INTEGER NOT NULL DEFAULT 120,

  -- ----------------------------- weigh-in ----------------------------------
  weigh_in_enabled INTEGER NOT NULL DEFAULT 0,
  weigh_in_time TEXT NOT NULL DEFAULT '08:00',
  -- JSON array of weekday numbers, 1 = Sunday … 7 = Saturday. NULL = every day.
  weigh_in_days TEXT,

  -- ---------------------------- behaviour ----------------------------------
  -- Donor `skip_if_already_logged`, ON by default. This is the rule that makes
  -- reminders tolerable: a member who already logged lunch at 12:30 must not be
  -- told to log lunch at 13:00. Enforced by cancelling the queued row before
  -- delivery, so a satisfied reminder is never sent AND never lands in the
  -- in-app notification centre.
  --
  -- Applies to HABIT nudges too, even though this table does not schedule them:
  -- the sweep reads it before deciding whether to cancel a queued
  -- `health_habit_reminder` row whose habit is already ticked for that day.
  skip_if_already_logged INTEGER NOT NULL DEFAULT 1,

  -- Donor `skip_during_sleep` + `quiet_hours_*`. Enforced at MATERIALISATION
  -- time (the row is simply not created) rather than at delivery, so a
  -- suppressed nudge leaves no half-state behind.
  quiet_hours_enabled INTEGER NOT NULL DEFAULT 1,
  quiet_hours_start TEXT NOT NULL DEFAULT '23:00',
  quiet_hours_end TEXT NOT NULL DEFAULT '07:00',

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Soft delete. See the conventions note above.
  deleted_at TEXT
);

-- "Which members have opted into anything at all" — the ONLY read the nightly
-- materialisation pass makes across the whole table, and the one that decides
-- whether this feature costs a full table scan per night or an index probe.
-- Partial so members who have opened the settings screen and left everything
-- OFF (which is every member on day one, since all five categories default to
-- 0) never enter the index at all.
CREATE INDEX IF NOT EXISTS idx_health_reminder_prefs_active
  ON health_reminder_preferences(user_id)
  WHERE deleted_at IS NULL
    AND (
      meals_enabled = 1
      OR water_enabled = 1
      OR weigh_in_enabled = 1
    );

-- Not this feature's table, but this feature's sibling's hot query:
-- `topUpHabitReminders` (services/health/habit-reminder.ts) scans `user_habits`
-- for reminder-carrying rows on every daily sweep, unfiltered by user. Partial,
-- so it stays close to empty — `reminder_enabled` is false on every habit row
-- written before habit reminders existed, i.e. all of them.
CREATE INDEX IF NOT EXISTS idx_user_habits_reminder_due
  ON user_habits(user_id, reminder_time)
  WHERE reminder_enabled = 1
    AND is_archived = 0
    AND deleted_at IS NULL;
