/**
 * Every MMKV/AsyncStorage key the Symply Health offline cache writes.
 *
 * Kept in its own module (rather than imported from the storage modules) so
 * `authStore` can clear them on sign-out WITHOUT pulling the whole Health
 * feature — and its API client — into the auth dependency graph. That import
 * cycle is what previously left `ENV` undefined at launch, so it is deliberate.
 *
 * These snapshots contain weight, nutrition, activity, body measurements, cycle,
 * vitality, food-library, recipe and fridge records. Anything cached here MUST be cleared when the
 * session ends, or the next person to sign in on the same handset sees the previous
 * user's health data (see e2e/maestro/health/privacy-cross-user-leak.yaml).
 *
 * Adding a new cached Health key? Add it here in the same commit.
 */
export const HEALTH_CACHE_KEYS = [
  'health.weightLog.v1',
  // The weight GOAL + biometrics (0125). Holds a target weight, a starting
  // weight, a height, a sex and a birth year — the most identifying snapshot in
  // this list after the injury log, and the one a shared handset would leak
  // first because the Weight tab renders it before anything else loads.
  'health.weightGoal.v1',
  // Which Weight-tab widgets are shown, in what order. A UI preference rather
  // than a health record, but still cleared: leaving it behind would tell the
  // next person on a shared handset what the previous one was tracking.
  'health.weightLayout.v1',
  // Which HOME cards are shown, in what order (the donor's customisable
  // dashboard). Same call as the weight layout above: a UI preference rather
  // than a health record, still cleared — the set of cards someone keeps on
  // Home names what they are tracking.
  'health.homeLayout.v1',
  // Which ACTIVITY chart cards are shown, in what order — same mechanism,
  // same reason for clearing.
  'health.activityLayout.v1',
  // Legacy device-local prefs blob — retired 0141 in favour of the
  // server-synced unit system below, but still cleared here for any handset
  // with a pre-migration copy still on disk.
  'health.prefs.v1',
  // The ONE global Metric/Imperial switch (0141, `health_goals.unit_system`),
  // cached for offline reads. A display preference rather than a health
  // record, but still cleared: the next person to sign in on a shared
  // handset should not inherit the previous member's unit choice.
  'health.unitSystem.v1',
  // The ten activity-notification switches (`/health/activity-preferences`).
  // Not a health record, but an account-level preference all the same: leaving
  // it behind would show the next person to sign in on this handset the
  // previous member's choices — and, once a producer exists, would decide what
  // reaches THEIR device from the stale cached copy.
  'health.notifyPrefs.v1',
  // The nightly sleep log + the goal it is measured against. A health record in
  // its own right, and one that reads as a diary: it says what time of life
  // someone is having as plainly as any figure in this list.
  'health.sleep.v1',
  'health.water.v1',
  'health.waterHistory.v1',
  // Today's per-entry water log (the Water tab). Separate from the ±cup counter
  // above because it holds the individual drinks and their times, not a total —
  // "500 ml at 14:12" is a movement record, and a shared handset must not keep
  // the previous user's.
  'health.waterLog.v1',
  // ml vs oz. A display preference rather than a health record, cleared for the
  // same reason `health.weightLayout.v1` is: it is still a fact about the last
  // person who signed in.
  'health.waterPrefs.v1',
  'health.notes.v1',
  'health.meals.v1',
  'health.nutritionGoals.v1',
  // The PER-WEEKDAY calorie plan (Goals screen). A health target like every
  // other key here, and a revealing one on a shared handset: "2,900 on
  // Saturdays, 1,600 on Mondays" describes a training week, not a preference.
  'health.calorieWeek.v1',
  // The PER-WEEKDAY macro plan (0139) — protein/carbs/fat sibling of the
  // calorie week above, same reasoning.
  'health.macroWeek.v1',
  'health.workouts.v1',
  'health.steps.v1',
  'health.activityGoals.v1',
  'health.body.v1',
  'health.habits.v1',
  'health.cycleSettings.v1',
  'health.cyclePeriods.v1',
  'health.cycleSymptoms.v1',
  'health.vitality.v1',
  // Which Men's Health cards the person chose to show. A display preference
  // rather than a health record — but left behind on a shared handset it would
  // tell the next person exactly which intimate topics the previous one was
  // tracking, which is the same disclosure by a quieter route.
  'health.mensSettings.v1',
  'health.foods.v1',
  'health.recipes.v1',
  'health.fridge.v1',
  'health.exercises.v1',
  // The injury log. Medical-adjacent and the most sensitive snapshot in this
  // list: it names body parts and self-reported pain. It also drives the
  // workout-library safety gate, so a leaked copy would flag another person's
  // exercises as unsafe.
  'health.injuries.v1',
  // The AI coach transcript. THE MOST SENSITIVE KEY IN THIS LIST: it holds what
  // the person typed to the coach in their own words, which routinely says more
  // about them than any row of numbers does. The server deliberately does not
  // store it (the donor does not either — history is sent from the device each
  // turn), so this cache IS the conversation, and clearing it on sign-out is the
  // only thing standing between one person's coach history and the next person
  // to sign in on the same handset.
  'health.coach.v1',
  // The coach's consent receipt, mirrored so the screen can render its gate
  // before the network answers. Never authoritative — the Worker refuses a turn
  // on its own copy — but a stale `granted: true` left behind for the next user
  // would show them a consented-looking screen.
  'health.coachConsent.v1',
  // Stored body insights (`body_comprehensive_insights`). Prose ABOUT a person's
  // body, written from their own measurements — which is why it is cached for
  // offline reading and why it has to be cleared with everything else.
  'health.bodyInsights.v1',
  // The coach's commit ledger: what it logged on this person's behalf, and when.
  // No free text (it holds target types, ids and hashes), but it is still a
  // record of one account's activity and would read as the next user's history.
  'health.coachOperations.v1',
  // The user's FILE LIST — names, types, sizes and dates for every photo,
  // document and BODY PHOTO in the account. Metadata only (the bytes are never
  // mirrored here), but a file list is still a description of what a person has
  // photographed of themselves, so it leaves with the session like everything
  // else. The proxied `content_path` it carries is useless without a token,
  // which is the other half of why the bytes stay server-side.
  'health.files.v1',
  // Home Screen widget preferences (which metric the small widget shows, which
  // domains the medium widget may render). A display preference rather than a
  // health record, but it still says what the previous person was tracking.
  'health.widgetPrefs.v1',
  // The next scheduled reminder, mirrored for the widget/watch writer. Holds a
  // user-written reminder TITLE and its time — the one string this app puts on
  // a LOCK SCREEN — so a copy left behind would keep showing the previous
  // member's plans to whoever signs in next.
  'health.glanceReminder.v1',
  // Last-known weight/nutrition/workouts (+ trends, + widget layout prefs)
  // mirrored for the widget/watch writer, same reasoning as the reminder
  // mirror above: it is what a shared handset's Home Screen widget would show
  // for the previous member if left behind.
  'health.glanceExtras.v1',
  // The member's REMINDER SCHEDULE — the clock times they eat, drink and weigh
  // themselves at, plus their quiet hours. Not a health reading, but a daily
  // routine is identifying on its own: it says when this person wakes, when
  // they eat, and when they sleep. Left behind on a shared handset it would
  // also mislead — the next member's settings screen would render the previous
  // one's schedule as if it were theirs, and the first toggle they touched
  // would PUT that schedule to the server under their own account.
  'health.reminders.v1',
  // The DEVICE scheduler's bookkeeping (He3d): a 32-bit hash of the reminder
  // set, the stamp of the last reschedule, and how many it placed. It holds no
  // times and no names — the hash is a digest precisely so it does not — but it
  // is still cleared, for a reason that is about correctness as much as privacy:
  // a stamp left behind makes the NEXT member's first pass think the current
  // schedule is already placed, and their reminders would sit unscheduled for up
  // to six hours after they signed in.
  'health.reminderSchedule.v1',
  // The OFFLINE OUTBOX: rows that were written while the device could not reach
  // the Worker, waiting to be pushed through `POST /health/sync/push`.
  //
  // It holds REAL HEALTH ROWS — a weight reading, a meal, a cycle symptom, a
  // men's-health entry — not just keys, so it is at least as sensitive as any
  // snapshot above it in this list and clearing it on sign-out is not optional.
  //
  // The consequence is stated plainly because it is a real trade: signing out
  // with unsynced changes DISCARDS them. That is the correct side to err on —
  // the alternative is one person's unsynced weight and symptom rows being
  // pushed to the server under the NEXT person to sign in on the same handset,
  // which is the cross-user leak this whole list exists to prevent.
  'health.outbox.v1',
  // HealthKit connection state (last-synced stamp + per-type authorisation).
  // Persisted only when the caller opts into `createStoredHealthKitStore()`,
  // but registered unconditionally: a key that MIGHT be written has to be
  // cleared on sign-out, or the next person to sign in on this handset
  // inherits the previous user's "connected to Apple Health" state.
  'health.healthKit.v1',
  // Food Challenges (Dashboard parity): the challenge catalog, the Home
  // widget's per-challenge weekly overview, and today's per-challenge
  // progress. All three describe what this person is trying to eat more or
  // less of — left behind on a shared handset they read as a diet diary.
  'health.challenges.v1',
  'health.challengesWeekly.v1',
  'health.challengeToday.v1',
  // Whether the widget's "Challenge Details" list is expanded. A UI
  // preference, cleared for the same reason every other layout key here is.
  'health.foodChallengesWidget.expanded.v1',
  // Weekly Trends (Dashboard parity): calories + weight, this week vs last —
  // a derived summary of records already covered above, but still a health
  // reading in its own right.
  'health.weeklyTrend.v1',
] as const;
