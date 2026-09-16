/**
 * The one notification budget every Symply Health feature draws from — plan §9,
 * the ⚠️ line that gates Wave C:
 *
 * > **Wave C contends for the same 64 slots.** Cycle predictions + habit
 * > reminders + hydration on a rolling one-shot horizon all draw from one pool.
 * > **Name the per-feature allocation in He7-lite before Wave C schedules
 * > anything.**
 *
 * This file is that naming, and it is deliberately a module of its own rather
 * than a constant inside the scheduler. Wave C's cycle-prediction and
 * men's-health schedulers must be able to read their allowance *without*
 * importing `healthLocalReminders.ts` — if the allocation lived there, the first
 * Wave C author would either import a whole reminder engine to read one number
 * or, far more likely, pick a number of their own. Two independent numbers
 * summing past 56 is precisely the failure the plan asks He7-lite to prevent,
 * and it fails silently: iOS keeps the 64 soonest-firing pending requests and
 * **drops the rest with no error to catch**.
 *
 * WHY 56 AND NOT 64
 * -----------------
 * The 64 is a platform ceiling on *everything the app has pending*, not on what
 * this feature scheduled. Push-registration retries, the platform reminder
 * surfaces and anything a sibling module schedules all sit in the same list. The
 * 8-slot gap is the space those get to occupy without silently truncating the
 * far end of the health horizon. {@link HEALTH_REMINDER_SLOTS} is therefore a
 * ceiling, never an assumption — `syncHealthLocalReminders` additionally
 * measures what is *actually* pending and shrinks its budget to fit.
 *
 * HOW THE NUMBERS WERE PICKED
 * ---------------------------
 * Health's reminders are **dailies**, which is what makes it different from
 * House and Budget: a one-shot daily consumes one slot per occurrence (plan §9 —
 * "rolling one-shot dailies each consume a slot"), so an allocation is really a
 * statement about *how many days of horizon* a feature gets:
 *
 * | Feature | Slots | Horizon that buys |
 * |---|---|---|
 * | `meals` | 12 | 4 meal slots × **3 days** |
 * | `hydration` | 16 | up to 8 water nudges/day × **2 days** |
 * | `weighIn` | 4 | **4 occurrences** — 4 days daily, or 4 weeks weekly |
 * | `habits` | 14 | the **14 next-firing** habit reminders |
 * | `cycle` (Wave C) | 6 | reserved — period/fertile-window predictions |
 * | `mensHealth` (Wave C) | 4 | reserved |
 *
 * Hydration gets the largest share and the shortest horizon on purpose: it is
 * the only class that can legitimately want 8 nudges in one day, so giving it 3
 * days would cost 24 of 46 and starve everything else. Weigh-in gets the fewest
 * and the longest reach because a weekly weigh-in needs a horizon measured in
 * weeks to catch its next occurrence at all.
 *
 * **The two Wave C rows are reserved, not spent.** Nothing schedules them today.
 * They are subtracted from the live budget anyway
 * ({@link HE7_LITE_REMINDER_SLOTS}) so that Wave C shipping is a change to one
 * table here rather than a silent overflow of the 56 the day cycle predictions
 * land.
 */

/**
 * iOS keeps the **64 soonest-firing** pending local notification requests per
 * app and discards the rest — silently, with no error and no callback (plan §9,
 * quoting Apple's `UILocalNotification` reference). Android has no comparable
 * cap, but one cross-platform budget is what keeps the two builds behaving the
 * same.
 */
export const IOS_PENDING_NOTIFICATION_LIMIT = 64;

/** Slots left free for everything outside this budget. See the header. */
export const HEALTH_NOTIFICATION_HEADROOM = 8;

/**
 * The plan's stated budget: **≤56 used / 64**. Asserted after every reschedule
 * by `reminders.test.ts`, which is the DoD He3d line.
 */
export const HEALTH_REMINDER_SLOTS =
  IOS_PENDING_NOTIFICATION_LIMIT - HEALTH_NOTIFICATION_HEADROOM;

/**
 * Every Health surface that may schedule a local notification, now or at Wave C.
 *
 * Adding a member without adding its row to
 * {@link HEALTH_NOTIFICATION_SLOT_ALLOCATION} is a compile error, which is the
 * point: a Wave C feature cannot start scheduling before its allowance exists.
 */
export type HealthNotificationFeature =
  | 'meals'
  | 'hydration'
  | 'weighIn'
  | 'habits'
  | 'cycle'
  | 'mensHealth';

/** Which wave owns each feature — `'wave-c'` rows are reserved, not scheduled. */
export const HEALTH_NOTIFICATION_SLOT_WAVE: Record<
  HealthNotificationFeature,
  'he7-lite' | 'wave-c'
> = {
  meals: 'he7-lite',
  hydration: 'he7-lite',
  weighIn: 'he7-lite',
  habits: 'he7-lite',
  cycle: 'wave-c',
  mensHealth: 'wave-c',
};

/**
 * **The named per-feature allocation** the plan requires before Wave C
 * schedules anything. Sums to exactly {@link HEALTH_REMINDER_SLOTS}; the suite
 * fails if it ever sums above.
 */
export const HEALTH_NOTIFICATION_SLOT_ALLOCATION: Record<HealthNotificationFeature, number> = {
  meals: 12,
  hydration: 16,
  weighIn: 4,
  habits: 14,
  cycle: 6,
  mensHealth: 4,
};

/** Every feature name, so callers can iterate without re-listing the union. */
export const HEALTH_NOTIFICATION_FEATURES = Object.keys(
  HEALTH_NOTIFICATION_SLOT_ALLOCATION
) as HealthNotificationFeature[];

/** The four classes `healthLocalReminders.ts` actually schedules at He7-lite. */
export const HE7_LITE_REMINDER_FEATURES = HEALTH_NOTIFICATION_FEATURES.filter(
  (feature) => HEALTH_NOTIFICATION_SLOT_WAVE[feature] === 'he7-lite'
);

/** Sum of a subset's allowances. */
export function allocatedHealthNotificationSlots(
  features: readonly HealthNotificationFeature[]
): number {
  return features.reduce(
    (total, feature) => total + HEALTH_NOTIFICATION_SLOT_ALLOCATION[feature],
    0
  );
}

/** Sum of the whole table — the number that must stay ≤ 56. */
export function totalAllocatedHealthNotificationSlots(): number {
  return allocatedHealthNotificationSlots(HEALTH_NOTIFICATION_FEATURES);
}

/**
 * What `healthLocalReminders.ts` may spend today: the 56 **minus the Wave C
 * reservation**, so the live scheduler is already living inside the world Wave C
 * will arrive into. Enlarging the live budget to "everything unclaimed" would
 * make Wave C's first ship a regression for meals and hydration.
 */
export const HE7_LITE_REMINDER_SLOTS = allocatedHealthNotificationSlots(
  HE7_LITE_REMINDER_FEATURES
);
