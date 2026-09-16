/**
 * Device-scheduled Health reminders — **He7-lite / He3d** (plan §9, the
 * "Reminders | **P1** rolling horizon" row and the DoD He3d line
 * *"Rolling-horizon reminders (≤56/64, bounded reschedule,
 * `authenticationRequired` decision recorded)"*).
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * `backend/src/services/health-reminders-service.ts` materialises a member's
 * meal / water / weigh-in nudges by reading their `nutrition_entries`,
 * `weight_entries` and `water_entries` out of D1, and
 * `backend/src/services/health/habit-reminder.ts` does the same for
 * `user_habits`. Under local-first the Worker's D1 holds **no plaintext for this
 * member**, so both of those have nothing to read, nothing to suppress and
 * nothing to say. §9 puts reminders on **P1 — on-device compute**, with the
 * consequence the plan states plainly and this file does not engineer around:
 * *the horizon is refilled from the foreground, so a member who never opens the
 * app eventually runs out of reminders* (Q7, accepted with in-product copy —
 * see {@link getHealthLocalRemindersCopy}).
 *
 * Structure follows the two proven references — `budgetLocalReminders.ts` and
 * `house/local/reminders/houseLocalReminders.ts`: cancel-by-prefix, recompute
 * the whole plan from the ledger, schedule through `expo-notifications`
 * directly, never throw. Two things are Health-shaped and neither is optional.
 *
 * ONE — HEALTH REMINDERS ARE **DAILIES**, WHICH IS WHAT MAKES 64 TIGHT
 * -------------------------------------------------------------------
 * House schedules sparse events (a garbage day, a task due date); Budget
 * schedules a handful a month. Health schedules *the same nudges every day*, and
 * §9 is explicit that this costs full price: **"rolling one-shot dailies each
 * consume a slot (repeating triggers count as one)"**. A member with meals,
 * hydration, a weigh-in and six habits spends ~19 slots **per day** — three days
 * of naive scheduling and the 64-request centre is full, at which point iOS
 * keeps the 64 soonest-firing and drops the rest **silently, with no error to
 * catch**.
 *
 * A repeating `CALENDAR` trigger would cost one slot instead of N, and it was
 * considered. It is rejected for three reasons that all bite at once: quiet
 * hours and `skip_if_already_logged` are *per-occurrence* decisions a repeating
 * trigger cannot express; the water window produces up to eight different times
 * of day, so it is not one repeat but eight; and a repeating trigger cannot be
 * suppressed for a member who already logged. One-shots plus a horizon keep
 * every one of those honest, and the price is the budget this file is built
 * around — {@link slotBudget}.
 *
 * TWO — THE RESCHEDULE IS BOUNDED, BECAUSE "ON EVERY FOREGROUND" IS NOT
 * --------------------------------------------------------------------
 * §9 again: *"'Reschedule on every foreground' is unbounded — up to 56 cancels +
 * re-schedules per foreground … Reschedule **only when the reminder set's
 * content hash changes, or ≥6 h since the last reschedule, whichever is
 * sooner**."* {@link healthRescheduleDecision} is that rule, and it is enforced
 * **before any notification I/O happens at all** — the bounded path does not
 * even read the notification centre. A bound that still paid for the read would
 * be a comment, not a bound; `reminders.test.ts` asserts the suppression by
 * counting `scheduleNotificationAsync` calls across a churning ledger.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * - **Notification actions** ("Log water", "Mark habit done"). Recorded decision
 *   — see `decisions.ts`. Under a `WHEN_UNLOCKED_THIS_DEVICE_ONLY` DEK an action
 *   taken from a locked screen is a **silent no-op**, so He3d ships none.
 * - **Cycle and men's-health nudges.** Wave C. Their slot allowance is already
 *   reserved in {@link slotBudget} so their arrival is a table edit rather than
 *   a silent overflow of the 56.
 * - **Copy variant rotation.** The Worker picks one of several phrasings per
 *   nudge from a seeded index. That is flavour, not contract, and re-deriving it
 *   on device would be a second implementation of something with no observable
 *   guarantee — see the plan's warning about paying the re-implementation cost
 *   twice.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { asyncStorage } from '@services/storage';

import {
  HEALTH_REMINDER_SCHEDULE_KEY,
  loadCachedHealthReminders,
  type HealthReminderPreferences,
} from '../../healthRemindersStorage';
import type { HealthLedger } from '../engine';
import { getLocalHealthLedger, isLocalHealthSessionOpen } from '../engine';
import { isHealthLocalFirst } from '../flag';
import type { LocalUserHabit } from '../types';

import {
  HEALTH_NOTIFICATION_SLOT_ALLOCATION,
  HEALTH_REMINDER_SLOTS,
  HE7_LITE_REMINDER_SLOTS,
} from './slotBudget';

/** Stable identifier prefix — cancel/reschedule by scanning pending requests. */
export const HEALTH_REMINDER_PREFIX = 'health.reminder.';

/**
 * Outer bound on how far ahead a candidate may be generated.
 *
 * The per-class allowances in {@link HEALTH_NOTIFICATION_SLOT_ALLOCATION} are
 * what actually decide the horizon for the dense classes — 16 hydration slots is
 * two days whatever this number says. 30 days exists for the *sparse* case: a
 * **weekly** weigh-in needs four weeks of reach to spend its four slots at all,
 * and a habit that runs on one custom weekday needs a week to produce its first
 * occurrence. Generation stops per class as soon as its bucket is full, so the
 * long outer bound costs nothing on a dense schedule.
 */
export const HEALTH_REMINDER_HORIZON_DAYS = 30;

/** §9's bound: reschedule on content change **or** every 6 h, whichever first. */
export const HEALTH_REMINDER_RESCHEDULE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Server ceiling on water nudges per day, mirrored from
 * `MAX_WATER_REMINDERS_PER_DAY` in `health-reminders-service.ts`. A member who
 * sets a 15-minute interval across a 12-hour window is asking for 49 pings; the
 * server has always clamped that to 8 and the local port must clamp it
 * identically, or the same schedule produces a different day on each path.
 */
export const MAX_WATER_REMINDERS_PER_DAY = 8;

const MIN_WATER_INTERVAL_MINUTES = 15;
const MAX_WATER_INTERVAL_MINUTES = 12 * 60;

/** The single Android channel — Health has one reminder voice, not four. */
const HEALTH_REMINDER_CHANNEL_ID = 'health_reminders';

/**
 * `data.type` values, taken from the set `routeNotificationTap` already handles
 * (`src/services/notificationRouting.ts:90-108`). A locally scheduled reminder
 * taps through the exact same router as the server push it replaces, so the deep
 * link is unchanged by the cutover — which is the point. Inventing a
 * `health_local_*` type here would send every tap to Home.
 */
export const HEALTH_REMINDER_TYPES = {
  MEAL: 'health_meal_reminder',
  WATER: 'health_water_reminder',
  WEIGH_IN: 'health_weigh_in_reminder',
  HABIT: 'health_habit_reminder',
} as const;

/** Deep-link targets, mirroring `HEALTH_NOTIFICATION_ROUTES` in the router. */
const HEALTH_REMINDER_ROUTES = {
  MEAL: '/health-nutrition',
  WATER: '/health-water',
  WEIGH_IN: '/health-weight',
  HABIT: '/health-habits',
} as const;

/** Scheduling classes. One-to-one with the He7-lite rows of the slot budget. */
export type HealthReminderClass = 'meals' | 'hydration' | 'weighIn' | 'habits';

export const HEALTH_REMINDER_CLASSES: readonly HealthReminderClass[] = [
  'meals',
  'hydration',
  'weighIn',
  'habits',
];

/** The four meal slots, in day order — mirrors `HEALTH_MEAL_SLOTS` server-side. */
export const HEALTH_MEAL_SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'] as const;
export type HealthMealSlot = (typeof HEALTH_MEAL_SLOTS)[number];

/**
 * One reminder the scheduler intends to place. Plain data, so the whole budget
 * claim is checkable without a device: the cap is a property of the **plan**,
 * and only then of the side effect.
 */
export interface HealthReminderCandidate {
  cls: HealthReminderClass;
  identifier: string;
  title: string;
  /** Never carries a reading — see `decisions.ts`, the lock-screen content rule. */
  body: string;
  fireAt: Date;
  data: Record<string, unknown>;
}

/** The slice of the ledger this scheduler reads. */
export type HealthReminderLedger = Pick<
  HealthLedger,
  | 'userHabits'
  | 'habitLogs'
  | 'nutritionEntries'
  | 'weightEntries'
  | 'waterEntries'
  | 'healthGoals'
>;

export interface HealthReminderInput {
  /** The member's schedule. `health_reminder_preferences` is a **Wave C** table
   * (plan §1.6) and stays server-authoritative, so this is read from the MMKV
   * mirror rather than the ledger — config, never a health record. */
  preferences: HealthReminderPreferences;
  ledger: HealthReminderLedger;
}

// ---------------------------------------------------------------------------
// Time primitives — ported from `health-reminders-service.ts` so the two paths
// cannot disagree about what a member's schedule means.
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 'HH:MM' → minutes from local midnight. `null` when unparseable. */
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
 * Is `minutes` inside the quiet window? Wrap-around aware — the default window
 * is 23:00→07:00, and the naive `start <= x < end` test would call that empty
 * and let a 03:00 nudge through.
 */
export function isWithinQuietHours(minutes: number, start: string, end: string): boolean {
  const startMin = parseHhmmToMinutes(start);
  const endMin = parseHhmmToMinutes(end);
  if (startMin === null || endMin === null) return false;
  if (startMin === endMin) return false; // degenerate — no quiet window
  if (startMin < endMin) return minutes >= startMin && minutes < endMin;
  return minutes >= startMin || minutes < endMin;
}

function dateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Donor / D1 weekday numbering: **1 = Sunday … 7 = Saturday**. */
function weekdayOf(date: Date): number {
  return date.getDay() + 1;
}

/**
 * The horizon, one local calendar day at a time.
 *
 * Stepped with `setDate(+1)` on a **local midnight** anchor rather than by
 * adding 86 400 000 ms. That is the whole DST story: on a spring-forward day the
 * local day is 23 h long, so millisecond stepping drifts an hour and eventually
 * skips or repeats a calendar day — and a skipped day is a reminder that never
 * fires, which is indistinguishable from working. `reminders.test.ts` pins this
 * across both a spring-forward and a fall-back boundary in a real DST zone.
 */
function* horizonDays(now: Date, days: number): Generator<{ date: Date; key: string; weekday: number }> {
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  for (let i = 0; i < days; i += 1) {
    yield { date: new Date(cursor), key: dateKeyOf(cursor), weekday: weekdayOf(cursor) };
    cursor.setDate(cursor.getDate() + 1);
  }
}

/**
 * A local `Date` for a calendar day at a wall-clock minute.
 *
 * Wall-clock is preserved across DST by construction: `new Date(y, m, d, h, m)`
 * resolves in the device's zone, so "08:30 breakfast" stays 08:30 on both sides
 * of a transition rather than sliding to 07:30. The one degenerate case is a
 * wall-clock time that does not exist on a spring-forward day (02:30 in a zone
 * that jumps 02:00→03:00); JS normalises it forward to 03:30, which is the
 * benign direction — the nudge is late by an hour, not lost.
 */
function atLocalMinutes(day: Date, minutes: number): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    0
  );
}

// ---------------------------------------------------------------------------
// `skip_if_already_logged` — the donor default, ported to the ledger
// ---------------------------------------------------------------------------

/**
 * What today's ledger already satisfies.
 *
 * The Worker evaluates this at DELIVERY time against D1
 * (`isReminderAlreadySatisfied`); on device the equivalent moment is the
 * reschedule pass, so suppression can only cover **today**. A nudge two days out
 * cannot be pre-suppressed by a log that has not happened yet — the pass that
 * runs after the log drops it, which is exactly the behaviour the 6 h bound
 * guarantees is not more than six hours late.
 *
 * Water is the one class where "logged today" is the wrong test — a single sip
 * at 09:05 would silence the whole day — so it mirrors the server's narrower
 * rule (a): the day's goal is already met. The server's rule (b) ("a sip landed
 * within the last interval") is a *delivery-time* test with no plan-time
 * meaning and is deliberately not ported.
 */
export interface HealthReminderSatisfaction {
  meals: ReadonlySet<HealthMealSlot>;
  weighIn: boolean;
  waterGoalMet: boolean;
  habits: ReadonlySet<string>;
}

const NOTHING_SATISFIED: HealthReminderSatisfaction = {
  meals: new Set(),
  weighIn: false,
  waterGoalMet: false,
  habits: new Set(),
};

function isLive(row: { deleted_at?: string | null }): boolean {
  return !row.deleted_at;
}

/** The goal row in force on `dateKey` — latest `effective_date` at or before it. */
function effectiveGoal(
  ledger: HealthReminderLedger,
  dateKey: string
): HealthLedger['healthGoals'][number] | null {
  let best: HealthLedger['healthGoals'][number] | null = null;
  for (const goal of ledger.healthGoals) {
    if (!isLive(goal) || goal.effective_date > dateKey) continue;
    if (!best || goal.effective_date > best.effective_date) best = goal;
  }
  return best;
}

export function computeHealthReminderSatisfaction(
  input: HealthReminderInput,
  todayKey: string
): HealthReminderSatisfaction {
  if (!input.preferences.skip_if_already_logged) return NOTHING_SATISFIED;
  const { ledger } = input;

  const meals = new Set<HealthMealSlot>();
  for (const entry of ledger.nutritionEntries) {
    if (!isLive(entry) || entry.date !== todayKey) continue;
    if ((HEALTH_MEAL_SLOTS as readonly string[]).includes(entry.meal_type)) {
      meals.add(entry.meal_type as HealthMealSlot);
    }
  }

  const habits = new Set<string>();
  for (const log of ledger.habitLogs) {
    if (!isLive(log) || log.date !== todayKey || !log.habit_id) continue;
    habits.add(log.habit_id);
  }

  const goalMl = effectiveGoal(ledger, todayKey)?.daily_water_ml ?? null;
  let drunkMl = 0;
  for (const entry of ledger.waterEntries) {
    if (!isLive(entry) || entry.date !== todayKey) continue;
    drunkMl += entry.amount_ml;
  }

  return {
    meals,
    weighIn: ledger.weightEntries.some((entry) => isLive(entry) && entry.date === todayKey),
    waterGoalMet: goalMl !== null && goalMl > 0 && drunkMl >= goalMl,
    habits,
  };
}

// ---------------------------------------------------------------------------
// Plan construction — pure, so the ≤56 claim is provable without a device
// ---------------------------------------------------------------------------

function byFireAt(a: HealthReminderCandidate, b: HealthReminderCandidate): number {
  if (a.fireAt.getTime() !== b.fireAt.getTime()) return a.fireAt.getTime() - b.fireAt.getTime();
  // Identifier is the tie-break purely so a plan is REPRODUCIBLE: two reminders
  // on the same minute must not swap places between passes, or the content hash
  // would churn and the bound would be defeated by its own scheduler.
  return a.identifier.localeCompare(b.identifier);
}

/** Quiet hours are enforced at PLAN time, never at delivery — see the server. */
function quietAt(prefs: HealthReminderPreferences, minutes: number): boolean {
  return (
    prefs.quiet_hours_enabled &&
    isWithinQuietHours(minutes, prefs.quiet_hours_start, prefs.quiet_hours_end)
  );
}

const MEAL_COPY: Record<HealthMealSlot, { title: string; body: string }> = {
  breakfast: { title: 'Breakfast', body: 'Log what you had this morning.' },
  lunch: { title: 'Lunch', body: 'Log your lunch while you remember it.' },
  snack: { title: 'Snack', body: 'Had something? Add it to today.' },
  dinner: { title: 'Dinner', body: 'Log your dinner.' },
};

function mealCandidates(
  input: HealthReminderInput,
  now: Date,
  todayKey: string,
  satisfied: HealthReminderSatisfaction,
  cap: number
): HealthReminderCandidate[] {
  const prefs = input.preferences;
  const out: HealthReminderCandidate[] = [];
  if (!prefs.meals_enabled || cap <= 0) return out;

  const slots = HEALTH_MEAL_SLOTS.map((slot) => ({
    slot,
    minutes: prefs[`${slot}_enabled` as const] ? parseHhmmToMinutes(prefs[`${slot}_time` as const]) : null,
  }))
    .filter((entry): entry is { slot: HealthMealSlot; minutes: number } => entry.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);
  if (slots.length === 0) return out;

  for (const day of horizonDays(now, HEALTH_REMINDER_HORIZON_DAYS)) {
    for (const { slot, minutes } of slots) {
      if (out.length >= cap) return out;
      if (quietAt(prefs, minutes)) continue;
      if (day.key === todayKey && satisfied.meals.has(slot)) continue;
      const fireAt = atLocalMinutes(day.date, minutes);
      if (fireAt.getTime() <= now.getTime()) continue;

      out.push({
        cls: 'meals',
        identifier: `${HEALTH_REMINDER_PREFIX}meal.${slot}.${day.key}`,
        title: MEAL_COPY[slot].title,
        body: MEAL_COPY[slot].body,
        fireAt,
        data: {
          type: HEALTH_REMINDER_TYPES.MEAL,
          slot,
          localDate: day.key,
          screen: HEALTH_REMINDER_ROUTES.MEAL,
        },
      });
    }
  }
  return out;
}

function hydrationCandidates(
  input: HealthReminderInput,
  now: Date,
  todayKey: string,
  satisfied: HealthReminderSatisfaction,
  cap: number
): HealthReminderCandidate[] {
  const prefs = input.preferences;
  const out: HealthReminderCandidate[] = [];
  if (!prefs.water_enabled || cap <= 0) return out;

  const start = parseHhmmToMinutes(prefs.water_start_time);
  const end = parseHhmmToMinutes(prefs.water_end_time);
  // An end BEFORE the start is not an overnight hydration window, it is a
  // mis-set field. Emitting nothing is the honest reading — wrapping past
  // midnight would nudge somebody at 03:00 for a typo. (Server, verbatim.)
  if (start === null || end === null || end <= start) return out;

  const interval = Math.min(
    Math.max(Math.round(prefs.water_interval_minutes), MIN_WATER_INTERVAL_MINUTES),
    MAX_WATER_INTERVAL_MINUTES
  );

  for (const day of horizonDays(now, HEALTH_REMINDER_HORIZON_DAYS)) {
    // Goal met is a TODAY-only fact; tomorrow's window is untouched by it.
    if (day.key === todayKey && satisfied.waterGoalMet) continue;

    let placedToday = 0;
    for (
      let minutes = start;
      minutes <= end && placedToday < MAX_WATER_REMINDERS_PER_DAY;
      minutes += interval
    ) {
      if (out.length >= cap) return out;
      // Only what SURVIVES quiet hours counts against the daily allowance, so a
      // window overlapping the quiet block still gets its full set of audible
      // nudges. Same rule as the server, and the reason this is not a `filter`.
      if (quietAt(prefs, minutes)) continue;
      const fireAt = atLocalMinutes(day.date, minutes);
      if (fireAt.getTime() <= now.getTime()) continue;

      placedToday += 1;
      out.push({
        cls: 'hydration',
        identifier: `${HEALTH_REMINDER_PREFIX}water.${day.key}.${pad2(Math.floor(minutes / 60))}${pad2(minutes % 60)}`,
        title: 'Water',
        body: 'Time for a glass of water.',
        fireAt,
        data: {
          type: HEALTH_REMINDER_TYPES.WATER,
          localDate: day.key,
          minuteOfDay: minutes,
          screen: HEALTH_REMINDER_ROUTES.WATER,
        },
      });
    }
  }
  return out;
}

function weighInCandidates(
  input: HealthReminderInput,
  now: Date,
  todayKey: string,
  satisfied: HealthReminderSatisfaction,
  cap: number
): HealthReminderCandidate[] {
  const prefs = input.preferences;
  const out: HealthReminderCandidate[] = [];
  if (!prefs.weigh_in_enabled || cap <= 0) return out;

  const minutes = parseHhmmToMinutes(prefs.weigh_in_time);
  if (minutes === null || quietAt(prefs, minutes)) return out;

  for (const day of horizonDays(now, HEALTH_REMINDER_HORIZON_DAYS)) {
    if (out.length >= cap) return out;
    // `null` means every day. An EMPTY array is not a valid stored value (see
    // the route), so it is read as "no day matches" rather than "every day" —
    // guessing the other way would nudge a member who switched them all off.
    if (prefs.weigh_in_days !== null && !prefs.weigh_in_days.some((d) => d === day.weekday)) {
      continue;
    }
    if (day.key === todayKey && satisfied.weighIn) continue;
    const fireAt = atLocalMinutes(day.date, minutes);
    if (fireAt.getTime() <= now.getTime()) continue;

    out.push({
      cls: 'weighIn',
      identifier: `${HEALTH_REMINDER_PREFIX}weighin.${day.key}`,
      title: 'Weigh-in',
      body: 'Step on the scale when you get a moment.',
      fireAt,
      data: {
        type: HEALTH_REMINDER_TYPES.WEIGH_IN,
        localDate: day.key,
        screen: HEALTH_REMINDER_ROUTES.WEIGH_IN,
      },
    });
  }
  return out;
}

/** `custom_days` is stored as a JSON array of 1–7 — never trust it to parse. */
function parseCustomDays(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const days = parsed
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7);
    return days.length > 0 ? [...new Set(days)].sort((a, b) => a - b) : null;
  } catch {
    return null;
  }
}

/**
 * Mirrors `isHabitDueOnWeekday` (`backend/src/services/health/habit-reminder.ts`)
 * — and its 1 = Sunday numbering, which `user_habits.custom_days` stores
 * verbatim. A different convention here shifts every custom schedule by a day,
 * silently.
 */
function isHabitDueOnWeekday(habit: LocalUserHabit, weekday: number): boolean {
  switch (habit.frequency) {
    case 'weekdays':
      return weekday >= 2 && weekday <= 6;
    case 'weekends':
      return weekday === 1 || weekday === 7;
    case 'custom': {
      const days = parseCustomDays(habit.custom_days);
      return days === null ? true : days.includes(weekday);
    }
    default:
      return true;
  }
}

/** Reminder-bearing habits, pre-parsed once so the day loop stays cheap. */
function reminderHabits(
  ledger: HealthReminderLedger
): Array<{ habit: LocalUserHabit; minutes: number }> {
  const out: Array<{ habit: LocalUserHabit; minutes: number }> = [];
  for (const habit of ledger.userHabits) {
    if (!isLive(habit) || habit.is_archived) continue;
    if (!habit.reminder_enabled) continue;
    const minutes = parseHhmmToMinutes(habit.reminder_time);
    if (minutes === null) continue;
    out.push({ habit, minutes });
  }
  // Sorted so a plan is reproducible across passes — see `byFireAt`.
  return out.sort((a, b) => a.minutes - b.minutes || a.habit.id.localeCompare(b.habit.id));
}

/**
 * One reminder per habit per due day.
 *
 * ⚠️ **The honest limitation, stated rather than hidden:** the class allowance is
 * 14 slots, so a member with more than 14 reminder-bearing habits gets the **14
 * next-firing** ones and the rest are not scheduled at all — a habit set at
 * 22:00 behind fifteen earlier ones never reaches the notification centre. The
 * alternative (rotating which habits get a slot) would churn the content hash on
 * every pass and defeat the §9 bound, so the trade is taken deliberately and
 * named to the member in {@link getHealthLocalRemindersCopy}. Raising the number
 * means taking slots from another row of {@link HEALTH_NOTIFICATION_SLOT_ALLOCATION},
 * which is a decision about the whole 56 and belongs there, not here.
 */
function habitCandidates(
  input: HealthReminderInput,
  now: Date,
  todayKey: string,
  satisfied: HealthReminderSatisfaction,
  cap: number
): HealthReminderCandidate[] {
  const out: HealthReminderCandidate[] = [];
  if (cap <= 0) return out;

  const habits = reminderHabits(input.ledger);
  if (habits.length === 0) return out;

  for (const day of horizonDays(now, HEALTH_REMINDER_HORIZON_DAYS)) {
    for (const { habit, minutes } of habits) {
      if (out.length >= cap) return out;
      if (!isHabitDueOnWeekday(habit, day.weekday)) continue;
      if (quietAt(input.preferences, minutes)) continue;
      if (day.key === todayKey && satisfied.habits.has(habit.id)) continue;
      const fireAt = atLocalMinutes(day.date, minutes);
      if (fireAt.getTime() <= now.getTime()) continue;

      out.push({
        cls: 'habits',
        identifier: `${HEALTH_REMINDER_PREFIX}habit.${habit.id}.${day.key}`,
        title: habit.name,
        // The habit's own name is the ONE member-authored string a Health
        // notification carries, matching the server push it replaces. No
        // streak, no count, no reading — see `decisions.ts`.
        body: 'Time for your habit.',
        fireAt,
        data: {
          type: HEALTH_REMINDER_TYPES.HABIT,
          habitId: habit.id,
          localDate: day.key,
          screen: HEALTH_REMINDER_ROUTES.HABIT,
        },
      });
    }
  }
  return out;
}

/**
 * Per-class allowance for a budget of `slots`, scaled when the app has less than
 * the full He7-lite allocation left.
 *
 * Straight truncation of the merged, time-sorted plan would be correct and
 * useless: hydration's 8-a-day sorts ahead of everything, so a shrunken budget
 * would be spent entirely on water and the member would lose their weigh-in and
 * their habits without a word. Scaling keeps every class represented.
 */
export function healthReminderClassCaps(
  slots: number = HE7_LITE_REMINDER_SLOTS
): Record<HealthReminderClass, number> {
  const ratio = Math.max(0, Math.min(1, slots / HE7_LITE_REMINDER_SLOTS));
  const caps = {} as Record<HealthReminderClass, number>;
  for (const cls of HEALTH_REMINDER_CLASSES) {
    const full = HEALTH_NOTIFICATION_SLOT_ALLOCATION[cls];
    // `Math.max(1, …)` keeps a class alive at a very small budget; the global
    // truncate below is what makes the total an invariant rather than a hope.
    caps[cls] = slots <= 0 ? 0 : Math.max(1, Math.floor(full * ratio));
  }
  return caps;
}

/**
 * The whole rolling-horizon decision, as data.
 *
 * Exported because the ship gate is a claim about a **count**, and a count is
 * only checkable if it can be produced without a simulator — `reminders.test.ts`
 * runs this against the He10 corpus shape and asserts the result against the 56.
 */
export function buildHealthReminderPlan(
  input: HealthReminderInput,
  now: Date = new Date(),
  slots: number = HE7_LITE_REMINDER_SLOTS
): HealthReminderCandidate[] {
  if (slots <= 0) return [];

  const todayKey = dateKeyOf(now);
  const satisfied = computeHealthReminderSatisfaction(input, todayKey);
  const caps = healthReminderClassCaps(slots);

  const plan = [
    ...mealCandidates(input, now, todayKey, satisfied, caps.meals),
    ...hydrationCandidates(input, now, todayKey, satisfied, caps.hydration),
    ...weighInCandidates(input, now, todayKey, satisfied, caps.weighIn),
    ...habitCandidates(input, now, todayKey, satisfied, caps.habits),
  ];

  plan.sort(byFireAt);
  return plan.slice(0, slots);
}

// ---------------------------------------------------------------------------
// The bound — content hash + last-reschedule stamp (plan §9)
// ---------------------------------------------------------------------------

/**
 * FNV-1a, 32-bit, hex.
 *
 * A digest rather than the canonical string itself, for two reasons: the string
 * names habits and clock times, and nothing outside this file has any business
 * reading a fingerprint of a member's routine out of MMKV; and a fixed-width
 * value keeps the stored state a constant few dozen bytes however many habits
 * the member has. Collision risk is the only cost, and a collision here means
 * one skipped reschedule, bounded to 6 h by the other half of the rule.
 */
/* eslint-disable no-bitwise -- FNV-1a is defined in terms of xor and shifts */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
/* eslint-enable no-bitwise */

/**
 * The content hash the §9 bound turns on: everything that can change **what this
 * scheduler would place**, and nothing that cannot.
 *
 * Three things are in it that a first reading might not expect, each for a
 * reason that shows up as a wrong reminder if omitted:
 *
 *  - **Today's date key.** A pass at 23:55 and a pass at 00:05 must not be
 *    treated as the same reminder set; the horizon has moved a day.
 *  - **The suppression signature** (which meals/habits are already logged
 *    today, whether the weigh-in is done, whether the water goal is met). This
 *    is the only part driven by *logging* rather than by *settings*, and it is
 *    genuinely part of the reminder set: a member who logs lunch has changed
 *    what should fire this afternoon. It is deliberately COARSE — booleans and
 *    ids, never amounts — so a member drinking eight glasses flips one bit, not
 *    eight.
 *  - **Nothing else from the ledger.** Weight readings, calorie totals and body
 *    measurements do not appear, so a busy logging session does not churn the
 *    hash and burn the bound.
 */
export function healthReminderSetHash(input: HealthReminderInput, now: Date = new Date()): string {
  const prefs = input.preferences;
  const todayKey = dateKeyOf(now);
  const satisfied = computeHealthReminderSatisfaction(input, todayKey);

  const parts: string[] = [
    `d:${todayKey}`,
    `m:${prefs.meals_enabled ? 1 : 0}`,
    ...HEALTH_MEAL_SLOTS.map(
      (slot) =>
        `m.${slot}:${prefs[`${slot}_enabled` as const] ? 1 : 0}@${prefs[`${slot}_time` as const]}`
    ),
    `w:${prefs.water_enabled ? 1 : 0}@${prefs.water_start_time}-${prefs.water_end_time}/${prefs.water_interval_minutes}`,
    `g:${prefs.weigh_in_enabled ? 1 : 0}@${prefs.weigh_in_time}/${(prefs.weigh_in_days ?? []).join('')}${prefs.weigh_in_days === null ? '*' : ''}`,
    `q:${prefs.quiet_hours_enabled ? 1 : 0}@${prefs.quiet_hours_start}-${prefs.quiet_hours_end}`,
    `s:${prefs.skip_if_already_logged ? 1 : 0}`,
    `tz:${prefs.timezone ?? ''}`,
  ];

  for (const { habit, minutes } of reminderHabits(input.ledger)) {
    parts.push(
      `h:${habit.id}@${minutes}/${habit.frequency}/${parseCustomDays(habit.custom_days)?.join('') ?? '*'}/${habit.name}`
    );
  }

  parts.push(
    `x.meals:${[...satisfied.meals].sort().join(',')}`,
    `x.weigh:${satisfied.weighIn ? 1 : 0}`,
    `x.water:${satisfied.waterGoalMet ? 1 : 0}`,
    `x.habits:${[...satisfied.habits].sort().join(',')}`
  );

  return fnv1a(parts.join('|'));
}

/** What is persisted between passes. Never holds plaintext — see `fnv1a`. */
export interface HealthReminderScheduleState {
  hash: string;
  /** Epoch ms of the last reschedule that actually touched the centre. */
  at: number;
  /** How many this scheduler placed on that pass — §15's debug count. */
  scheduled: number;
}

export type HealthRescheduleReason =
  | 'first-run'
  | 'content-changed'
  | 'interval-elapsed'
  | 'forced'
  | 'bounded';

/**
 * §9's rule, in one place: *"Reschedule **only when the reminder set's content
 * hash changes, or ≥6 h since the last reschedule, whichever is sooner**."*
 *
 * A clock that has gone BACKWARDS (a manual time change, a restore) counts as
 * elapsed rather than as fresh — otherwise a device whose clock jumped a day
 * into the past would never reschedule again.
 */
export function healthRescheduleDecision(
  hash: string,
  state: HealthReminderScheduleState | null,
  now: number
): { reschedule: boolean; reason: HealthRescheduleReason } {
  if (!state) return { reschedule: true, reason: 'first-run' };
  if (state.hash !== hash) return { reschedule: true, reason: 'content-changed' };
  const elapsed = now - state.at;
  if (elapsed >= HEALTH_REMINDER_RESCHEDULE_INTERVAL_MS || elapsed < 0) {
    return { reschedule: true, reason: 'interval-elapsed' };
  }
  return { reschedule: false, reason: 'bounded' };
}

export async function readHealthReminderScheduleState(): Promise<HealthReminderScheduleState | null> {
  try {
    const raw = await asyncStorage.getItem(HEALTH_REMINDER_SCHEDULE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const state = parsed as Partial<HealthReminderScheduleState>;
    if (typeof state.hash !== 'string' || typeof state.at !== 'number') return null;
    return { hash: state.hash, at: state.at, scheduled: state.scheduled ?? 0 };
  } catch {
    // A corrupt stamp must fail OPEN — reschedule — rather than wedge the
    // scheduler forever on an unreadable value.
    return null;
  }
}

async function writeHealthReminderScheduleState(state: HealthReminderScheduleState): Promise<void> {
  try {
    await asyncStorage.setItem(HEALTH_REMINDER_SCHEDULE_KEY, JSON.stringify(state));
  } catch {
    // Losing the stamp costs one extra reschedule, never correctness.
  }
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/**
 * Declared here rather than imported from `services/notifications.ts`: that
 * module runs `setNotificationHandler` and pulls the API client at import time,
 * and a reminder pass has no business dragging the network layer in.
 * Re-declaring an existing channel id is a no-op update, so the two call sites
 * cannot fork the channel's identity.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(HEALTH_REMINDER_CHANNEL_ID, {
    name: 'Health reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200, 120, 200],
  });
}

async function scheduleCandidate(candidate: HealthReminderCandidate): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: candidate.identifier,
    content: {
      title: candidate.title,
      body: candidate.body,
      data: candidate.data,
      sound: true,
      ...(Platform.OS === 'android' ? { channelId: HEALTH_REMINDER_CHANNEL_ID } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: candidate.fireAt,
    },
  });
}

/**
 * Drop every reminder this module placed, leaving anything else pending alone,
 * and forget the stamp so the next pass rebuilds from scratch.
 *
 * Prefix-scoped rather than `cancelAllScheduledNotificationsAsync()` because the
 * platform surfaces share one notification centre; a blanket cancel from a sync
 * pass would silently delete their work.
 */
export async function cancelHealthLocalReminders(): Promise<void> {
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      pending
        .filter((request) => request.identifier.startsWith(HEALTH_REMINDER_PREFIX))
        .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier))
    );
    await asyncStorage.removeItem(HEALTH_REMINDER_SCHEDULE_KEY);
  } catch (error) {
    console.warn('[health.local] reminder cancel failed', error);
  }
}

export interface HealthReminderSyncResult {
  /** How many this pass left pending for Health. `0` on the bounded path. */
  scheduled: number;
  reason: HealthRescheduleReason | 'inactive' | 'error';
  /** Total pending in the centre AFTER the pass — the §9 assertion's quantity. */
  pending: number;
  /** True when the §9 bound suppressed the work rather than doing it. */
  suppressed: boolean;
}

/**
 * Recompute and re-place every Health reminder from the encrypted ledger.
 *
 * Best-effort and never throws: this runs off a ledger bump and off foreground,
 * and a reminder failure must never take the sync path with it.
 *
 * The budget is measured, not assumed — `foreign` counts what other surfaces
 * already have pending and the allowance shrinks to fit. Note this is
 * **stricter** than House's equivalent: House keeps `others + ours ≤ 64`, while
 * §9 asserts `getAllScheduledNotificationsAsync().length <= 56` — the whole
 * centre, not just our share — so the subtraction is from the 56.
 */
export async function syncHealthLocalReminders(
  options: { force?: boolean; now?: Date } = {}
): Promise<HealthReminderSyncResult> {
  if (!isHealthLocalFirst() || !isLocalHealthSessionOpen()) {
    return { scheduled: 0, reason: 'inactive', pending: 0, suppressed: false };
  }

  try {
    const now = options.now ?? new Date();
    // `loadCachedHealthReminders` reads the MMKV mirror ONLY — deliberately not
    // the read-through `loadHealthReminders()`, which would put a network round
    // trip on a path that runs at foreground and on every ledger bump.
    // `health_reminder_preferences` is a Wave C table that stays
    // server-authoritative, and when the mirror is empty (fresh install, or a
    // member who never opened the screen) the defaults have every category OFF.
    // That is the correct failure direction: no reminders beats reminders the
    // member never asked for.
    const input: HealthReminderInput = {
      preferences: await loadCachedHealthReminders(),
      ledger: getLocalHealthLedger(),
    };

    const hash = healthReminderSetHash(input, now);
    const state = await readHealthReminderScheduleState();
    const decision = options.force
      ? { reschedule: true, reason: 'forced' as HealthRescheduleReason }
      : healthRescheduleDecision(hash, state, now.getTime());

    if (!decision.reschedule) {
      // THE BOUND. Nothing below this line runs — not even a read of the
      // notification centre. §9's complaint about "up to 56 cancels +
      // re-schedules per foreground" is a complaint about work, so the bound has
      // to elide the work, not just the writes.
      return {
        scheduled: state?.scheduled ?? 0,
        reason: 'bounded',
        pending: 0,
        suppressed: true,
      };
    }

    await ensureAndroidChannel();

    // ONE read of the centre serves both jobs: what to cancel, and what is left
    // over from elsewhere in the app. Re-reading after the cancel would race the
    // OS's own bookkeeping on iOS.
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    const ours = pending.filter((request) => request.identifier.startsWith(HEALTH_REMINDER_PREFIX));
    await Promise.all(
      ours.map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier))
    );

    const foreign = pending.length - ours.length;
    const slots = Math.max(0, Math.min(HE7_LITE_REMINDER_SLOTS, HEALTH_REMINDER_SLOTS - foreign));
    const plan = slots > 0 ? buildHealthReminderPlan(input, now, slots) : [];
    for (const candidate of plan) {
      await scheduleCandidate(candidate);
    }

    await writeHealthReminderScheduleState({
      hash,
      at: now.getTime(),
      scheduled: plan.length,
    });

    return {
      scheduled: plan.length,
      reason: decision.reason,
      pending: foreign + plan.length,
      suppressed: false,
    };
  } catch (error) {
    console.warn('[health.local] reminder sync failed', error);
    return { scheduled: 0, reason: 'error', pending: 0, suppressed: false };
  }
}

// ---------------------------------------------------------------------------
// Member-facing coverage copy (plan §9/§0 — never a silent empty state)
// ---------------------------------------------------------------------------

/**
 * What this build actually does, in the member's words.
 *
 * Health ships a mix — four classes live on device, three things the server used
 * to do genuinely off — and saying so in-product is the P4 requirement applied
 * to the parts that fell short rather than to the whole feature.
 */
export const HEALTH_LOCAL_REMINDER_COVERAGE = {
  live: ['Meal reminders', 'Water reminders', 'Weigh-in reminders', 'Habit reminders'],
  dark: [
    'Reminders while the app is never opened',
    'Logging straight from a notification',
    'Cycle and men’s-health reminders',
  ],
} as const;

/** Copy for a notification-settings row. Names the trade, both halves. */
export function getHealthLocalRemindersCopy(): { title: string; message: string } {
  return {
    title: 'Reminders are scheduled on this device',
    message:
      'Your health data stays private, so reminders are worked out on your phone instead of on our servers. Meals, water, weigh-ins and habits all work — including offline. Open the app every few days so upcoming reminders stay topped up. Your phone limits how many can be queued at once, so if you have a lot of habit reminders only the next few are set.',
  };
}

/** The one state where reminders are fully dark: permission denied. */
export function getHealthLocalRemindersDeniedCopy(): { title: string; message: string } {
  return {
    title: 'Reminders are off on this build',
    message:
      'Notifications are turned off for Symply Health, and because your health data is private this device is the only thing that can remind you — there is no server copy to send from. Turn notifications on in Settings to get meal, water, weigh-in and habit reminders back.',
  };
}
