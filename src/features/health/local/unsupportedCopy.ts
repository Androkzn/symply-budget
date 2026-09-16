/**
 * User-facing copy for the Health surfaces that are off on a local-first device.
 *
 * The rule House arrived at, restated for Health: *every disabled feature shows
 * explicit user-facing copy in the Symply Health voice — no raw error strings.*
 * `errors.ts` currently throws the developer sentence
 * `Health local-first: "healthApi.listChallenges" is not available offline.` A
 * screen rendering `error.message` would put that identifier in front of the
 * person using the app, which is precisely the raw error string this file
 * exists to replace. `memberFacingError.ts` is the reader; this is the source.
 *
 * ## Voice — single user, no roster
 *
 * Health is a **personal** ledger: one user, N devices, exactly one household,
 * and He5 makes the control plane refuse a second `user_id` (plan §1.2). So the
 * words House uses — member, invite, partner, household, "the owner" — are all
 * wrong here, and the He12(partial) E2E asserts it directly: *no invite-partner
 * copy on any screen*. Write to one person about their own devices. Say "your
 * other device", never "someone else".
 *
 * The state is named the way the plan's own first-launch copy names it (§1.3a):
 * **"on this device"**, not House's coined "private mode". Same state, wording
 * the Health user has already been shown once.
 *
 * Each entry answers the two questions the user actually has — *what can't I do*
 * and *what do I do instead* — and neither mentions encryption mechanics, method
 * names, or the word "unsupported".
 *
 * ## What belongs here, and what emphatically does not
 *
 * **Belongs:** a surface that is OFF because the ledger cannot serve it and the
 * server no longer may.
 *
 * **Does not belong — Tier B.** `/health/ai/*` (the coach, label scan, meal
 * photo) and the FatSecret lookup chokepoint stay *server-side by design* until
 * BYOK (plan §1.4). They are not off; they are remote. Declare them in the
 * Proxy's `remoteMethods` so they keep working online, and leave them out of
 * this map — an entry here would tell the user a working feature is disabled.
 *
 * **Does not belong — anything He7-lite owns.** The daily summary, streaks,
 * trends and weekly averages are Tier D, derived on device, and the plan's Hard
 * Exit is explicit: a summary method that throws `HealthLocalUnsupportedError`
 * is *not* an acceptable He3 exit. If `healthApi.getWeeklyTrend` ever appears as
 * a key in this file, He3c was skipped.
 *
 * ## Key format
 *
 * Keyed by the exact string passed to `HealthLocalUnsupportedError`, which the
 * Proxy builds as `` `${moduleName}.${method}` ``. The three Health api modules
 * must therefore pick their `moduleName` once and keep it: **`healthApi`**
 * (`src/api/health.ts`), **`healthAiApi`** (`src/api/healthAi.ts`),
 * **`healthFoodApi`** (`src/api/healthFood.ts`). A facade that passes a
 * different `moduleName` silently lands on the fallback below.
 */

export type HealthUnsupportedCopy = {
  title: string;
  message: string;
};

/**
 * The map and the throw sites cannot be allowed to drift apart — He3's
 * `unsupportedCopy.test.ts` walks the source for `HealthLocalUnsupportedError`
 * construction sites and fails if one has no entry here.
 *
 * It starts deliberately short. He3 owns the throw sites, and a speculative
 * entry for a method that is never disabled is worse than no entry: it reads as
 * a decision that was never made.
 */
export const HEALTH_UNSUPPORTED_COPY: Record<string, HealthUnsupportedCopy> = {
  /*
   * Food challenges — Tier D, and the one Health surface whose disposition the
   * plan leaves open (§1.5).
   *
   * `food_challenge_progress` is computed from `nutrition_entries`, which the
   * He12(full) truncate empties, so challenge progress goes permanently stale
   * against a source that is gone. §1.5 gives He3a two ways out: (a) recompute
   * on device over the local `nutritionEntries`, or (b) dark the two Home
   * challenge loaders behind the flag with in-product copy.
   *
   * These four entries are the copy for (b). If He3a picks (a) they are unused
   * — harmless, and cheaper than shipping (b) with a raw error string. What is
   * NOT acceptable is leaving the loaders reading a D1 table whose source has
   * been truncated, which renders a confident zero.
   */
  'healthApi.listChallenges': {
    title: 'Food challenges are paused',
    message:
      'Challenges are scored on our servers from your meal log, and your meals now stay on this device. Everything you log still counts toward your calorie and macro goals.',
  },
  'healthApi.getChallengeProgressToday': {
    title: 'Food challenges are paused',
    message:
      "Today's challenge score is worked out on our servers from your meal log, which now stays on this device. Your meals, calories and macros are all still here.",
  },
  'healthApi.getChallengeWeeklyProgress': {
    title: 'Food challenges are paused',
    message:
      'Weekly challenge totals are worked out on our servers from your meal log, which now stays on this device. Your meals, calories and macros are all still here.',
  },
  'healthApi.createChallenge': {
    title: 'New food challenges are paused',
    message:
      'A challenge has to be scored against your meal log on our servers, and your meals now stay on this device. You can still set calorie and macro goals, which work the same way and work offline.',
  },
};

/**
 * Fallback for a method with no entry.
 *
 * Deliberately says nothing specific and — importantly — **does not include the
 * method name**. A generic honest sentence is better user-facing copy than an
 * identifier, and `unsupportedCopy.test.ts` is what stops this fallback from
 * quietly becoming the common case.
 */
export const HEALTH_UNSUPPORTED_FALLBACK: HealthUnsupportedCopy = {
  title: 'That part is off on this device',
  message:
    'This one needs a server that can read your health data, and Symply Health keeps that data on your device. Your weight, water, meals, workouts, sleep, body measurements, habits and goals all keep working.',
};

export function getHealthUnsupportedCopy(method: string): HealthUnsupportedCopy {
  return HEALTH_UNSUPPORTED_COPY[method] ?? HEALTH_UNSUPPORTED_FALLBACK;
}
