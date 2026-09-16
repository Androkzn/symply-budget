/**
 * Device-scheduled House reminders — stage **H7-lite** (plan §9, and the H3 DoD
 * line that blocks Wave A brand-default-on without this file).
 *
 * WHY THIS EXISTS AT ALL
 * ---------------------
 * Under local-first the House Worker's D1 holds no plaintext for this
 * household, so `scheduled.ts`'s task-reminder pass (`:202`), its 08:00 overdue
 * sweep (`:214`) and the garbage-day dispatch have nothing to read and nothing
 * to say. The locked Q6–Q10 assignment puts "task / checklist / garbage / bill
 * reminders + overdue" on **P1 — on-device compute**, with the consequence the
 * plan states plainly and this file does not try to engineer around: *reminders
 * fire only from the device, and a member who never opens the app stops
 * receiving them.*
 *
 * Structure and comment discipline follow the proven reference,
 * `src/features/budget/local/reminders/budgetLocalReminders.ts` (248 lines):
 * cancel-by-prefix, recompute the whole plan from the ledger, schedule with
 * `expo-notifications` directly, never throw.
 *
 * THE ONE THING THAT IS NOT BUDGET-SHAPED: THE 64 CAP
 * --------------------------------------------------
 * iOS keeps only the **64 soonest-firing** pending local notifications per app;
 * everything past that is dropped by the OS, silently, with no error to catch.
 * Budget could ignore this — three recurring payments and a mortgage never come
 * close. House cannot: H10's ten-year corpus carries thousands of `tasks`, each
 * one of which has `reminder_enabled` defaulted true, plus a weekly garbage
 * stream and a pending-nudge table. Scheduling "every reminder" would hand iOS
 * 5,000 requests, keep the 64 nearest, and drop the rest — which looks
 * identical to working until the member misses something.
 *
 * So this is a **rolling-horizon** scheduler, not a batch scheduler:
 *
 *  1. only reminders firing inside {@link HOUSE_REMINDER_HORIZON_DAYS} are
 *     candidates at all;
 *  2. each reminder class carries its own cap ({@link HOUSE_REMINDER_CLASS_CAPS})
 *     so a thousand task reminders cannot starve garbage day, whose whole value
 *     is that it fires the night before;
 *  3. the merged plan is sorted by fire time and truncated to the slots the app
 *     actually has left, measured against what is already pending rather than
 *     assumed;
 *  4. the caller re-runs the pass on every ledger bump and on foreground, which
 *     is what "rolling" means — the horizon advances and the plan tops itself up.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * - **Checklist-instance due dates.** `checklistInstances` is a Wave-A table and
 *   the plan lists checklist due dates under P1, but `routeNotificationTap`
 *   (`src/services/notificationRouting.ts`) has no case for a checklist payload
 *   and no `screen` sentinel that reaches the Checklists tab, so a tap would
 *   fall through to `return false` and open the app on whatever was last
 *   showing. Shipping a nudge that does nothing when tapped is worse than
 *   shipping none, so the class is declared dark in
 *   {@link HOUSE_LOCAL_REMINDER_COVERAGE} instead of scheduled silently.
 * - **Per-member notification preferences.** Those live server-side behind
 *   `notificationsApi`; a local-first household has no server row to read, and
 *   inventing a second, device-local preference store is a Wave-B product
 *   decision, not a scheduler detail.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { GarbageSchedule } from '@api/garbage-collection';

import {
  getLocalHouseLedgerFor,
  isLocalHouseSessionOpen,
  listLocalHouseProperties,
  type HouseLedger,
} from '../engine';
import { isHouseLocalFirst } from '../flag';
import { expandCollectionDates } from '../logic/garbageSchedule';

/** Stable identifier prefix — cancel/reschedule by scanning pending requests. */
export const HOUSE_REMINDER_PREFIX = 'house.reminder.';

/**
 * The platform ceiling this whole file is shaped by. iOS keeps the 64
 * soonest-firing pending local notifications and drops the rest without an
 * error; Android has no comparable cap, but a single cross-platform budget is
 * what keeps the two builds behaving the same.
 */
export const IOS_PENDING_NOTIFICATION_LIMIT = 64;

/**
 * How many of those 64 House reminders may claim.
 *
 * The remaining 8 are headroom for everything else the app schedules locally
 * outside this module. {@link syncHouseLocalReminders} additionally measures
 * what is *actually* pending and shrinks the budget further, so this constant is
 * a ceiling, never an assumption.
 */
export const HOUSE_REMINDER_SLOTS = 56;

/**
 * Rolling window. Long enough that a member who opens the app monthly still
 * gets covered; short enough that the plan is dominated by reminders that will
 * really fire rather than by a year of speculative recurrences that the next
 * completion will move anyway.
 */
export const HOUSE_REMINDER_HORIZON_DAYS = 30;

/** Daily overdue sweep — mirrors `scheduled.ts:214`'s 08:00 local dispatch. */
const OVERDUE_DIGEST_HOUR = 8;

/** `reminder_time` fallback for a task row written before the column existed. */
const DEFAULT_REMINDER_TIME = '09:00';

/**
 * Garbage default when the row carries no `reminders` block. Matches the
 * `CustomReminder` 'evening_before' preset in `@api/garbage-collection`, which
 * is the only garbage nudge that changes behaviour — a morning-of reminder for a
 * 07:00 truck arrives after the bins had to be out.
 */
const DEFAULT_GARBAGE_NIGHT_BEFORE_TIME = '19:00';

/**
 * `data.type` values, chosen from the set `routeNotificationTap` already
 * handles. A locally scheduled reminder taps through the exact same router as
 * the server push it replaces, so the deep-link behaviour is unchanged by the
 * refactor — which is the point.
 */
export const HOUSE_REMINDER_TYPES = {
  TASK_DUE: 'task_reminder',
  TASK_OVERDUE: 'task_overdue',
  GARBAGE: 'garbage_collection',
} as const;

export type HouseReminderClass = 'taskDue' | 'overdue' | 'garbage' | 'recurring';

/**
 * Per-class ceilings, applied **before** the global truncate.
 *
 * Sorting the merged plan by fire time alone would be correct and useless: the
 * ten-year corpus can put 200 task reminders inside the next fortnight, and
 * every one of them sorts ahead of next Thursday's garbage. The caps are what
 * guarantee each class survives contact with a large household.
 *
 * Their sum is deliberately **below** {@link HOUSE_REMINDER_SLOTS}, so a
 * single-property member is inside the cap by construction and not merely by
 * the truncate — `__tests__/houseLocalReminders.test.ts` asserts that
 * relationship rather than trusting it.
 */
export const HOUSE_REMINDER_CLASS_CAPS: Record<HouseReminderClass, number> = {
  taskDue: 24,
  overdue: 1,
  garbage: 10,
  recurring: 12,
};

/**
 * One reminder the scheduler intends to place. Kept as plain data so the plan
 * can be built, asserted and counted without touching `expo-notifications` —
 * the cap is a property of the plan, not of the side effect.
 */
export type HouseReminderCandidate = {
  cls: HouseReminderClass;
  identifier: string;
  title: string;
  body: string;
  fireAt: Date;
  data: Record<string, unknown>;
  /** Android channel id — mirrors `services/notifications.ts:99,106`. */
  channelId: 'task_reminders' | 'garbage_reminders';
};

/** The slice of the ledger this scheduler reads. */
export type HouseReminderLedger = Pick<
  HouseLedger,
  'household' | 'tasks' | 'garbageSchedules' | 'recurringReminders'
>;

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Accepts both shapes the ledger really holds: `tasks.next_due_date` is a bare
 * `YYYY-MM-DD` while anything minted through `isoNow()` is a full ISO instant.
 * Taking the first ten characters reads the calendar day the member set,
 * without the timezone shift `new Date(iso)` would introduce on a device west
 * of UTC (the same hazard `logic/garbageSchedule.ts` documents).
 */
function parseDateKey(value: string | null | undefined): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** `HH:MM` → minutes past midnight, falling back rather than throwing. */
function parseClock(value: string | null | undefined, fallback: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  const source = match ?? /^(\d{1,2}):(\d{2})/.exec(fallback)!;
  const hour = Math.min(23, Math.max(0, Number(source[1])));
  const minute = Math.min(59, Math.max(0, Number(source[2])));
  return { hour, minute };
}

/** A local `Date` for a calendar day at a wall-clock time. */
function atLocalTime(dateKey: string, time: string | null | undefined, fallbackTime: string): Date | null {
  const parts = parseDateKey(dateKey);
  if (!parts) return null;
  const { hour, minute } = parseClock(time, fallbackTime);
  return new Date(parts.year, parts.month - 1, parts.day, hour, minute, 0, 0);
}

function dateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function shiftDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// ---------------------------------------------------------------------------
// Plan construction — pure, so the 64-cap claim is testable without a device
// ---------------------------------------------------------------------------

function withinHorizon(fireAt: Date, now: Date, horizonEnd: Date): boolean {
  return fireAt.getTime() > now.getTime() && fireAt.getTime() <= horizonEnd.getTime();
}

function byFireAt(a: HouseReminderCandidate, b: HouseReminderCandidate): number {
  if (a.fireAt.getTime() !== b.fireAt.getTime()) return a.fireAt.getTime() - b.fireAt.getTime();
  // Identifier is the tie-break purely so a plan is reproducible: two reminders
  // on the same minute must not swap places between runs, or every pass would
  // cancel and re-place the same notifications.
  return a.identifier.localeCompare(b.identifier);
}

/**
 * Per-task due reminder — the local equivalent of `ReminderService`'s
 * `next_due_date − reminder_days_before @ reminder_time`.
 *
 * A task already past that instant is intentionally NOT re-placed at "now": the
 * member would get a due reminder for something that is already overdue, and
 * the overdue class below is the surface that owns that state.
 */
function taskDueCandidates(
  ledger: HouseReminderLedger,
  now: Date,
  horizonEnd: Date,
): HouseReminderCandidate[] {
  const householdId = ledger.household.id;
  const out: HouseReminderCandidate[] = [];

  for (const task of ledger.tasks) {
    if (!task.is_active || !task.reminder_enabled || !task.next_due_date) continue;

    const dueAt = atLocalTime(task.next_due_date, task.reminder_time, DEFAULT_REMINDER_TIME);
    if (!dueAt) continue;

    // `snooze_until` is a member's explicit "not yet"; honouring it here is what
    // stops the next ledger bump from resurrecting a dismissed reminder.
    const snoozedUntil = task.snooze_until ? new Date(task.snooze_until) : null;
    const leadDays = Math.max(0, task.reminder_days_before ?? 0);
    let fireAt = shiftDays(dueAt, -leadDays);
    if (snoozedUntil && !Number.isNaN(snoozedUntil.getTime()) && snoozedUntil > fireAt) {
      fireAt = snoozedUntil;
    }
    if (!withinHorizon(fireAt, now, horizonEnd)) continue;

    const dueKey = task.next_due_date.slice(0, 10);
    out.push({
      cls: 'taskDue',
      identifier: `${HOUSE_REMINDER_PREFIX}task.${householdId}.${task.id}.${dueKey}`,
      title: task.title,
      body:
        leadDays > 0
          ? `Due ${dueKey} — ${leadDays === 1 ? 'tomorrow' : `in ${leadDays} days`}.`
          : `Due today.`,
      fireAt,
      data: {
        type: HOUSE_REMINDER_TYPES.TASK_DUE,
        householdId,
        taskId: task.id,
        screen: 'TaskDetail',
        dueDate: dueKey,
      },
      channelId: 'task_reminders',
    });
  }

  return out;
}

/**
 * One daily digest, not one notification per overdue task.
 *
 * The server sends per-task overdue pushes because its budget is unbounded;
 * ours is 64 total, and a household with 30 overdue tasks would spend the
 * entire budget restating a fact one line can carry. `taskId` still travels so
 * the tap lands on a task rather than a dashboard — the oldest one, which is the
 * one the member has been ignoring longest.
 */
function overdueCandidates(
  ledger: HouseReminderLedger,
  now: Date,
  horizonEnd: Date,
): HouseReminderCandidate[] {
  const householdId = ledger.household.id;
  const todayKey = dateKeyOf(now);

  let oldest: { id: string; title: string; dueKey: string } | null = null;
  let count = 0;
  for (const task of ledger.tasks) {
    if (!task.is_active || !task.next_due_date) continue;
    const dueKey = task.next_due_date.slice(0, 10);
    if (dueKey >= todayKey) continue;
    count += 1;
    if (!oldest || dueKey < oldest.dueKey) {
      oldest = { id: task.id, title: task.title, dueKey };
    }
  }
  if (!oldest) return [];

  // Next 08:00 — today's if it has not passed, otherwise tomorrow's. Re-running
  // the pass later the same day therefore keeps the same slot rather than
  // sliding the digest forward every time a row changes.
  let fireAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), OVERDUE_DIGEST_HOUR, 0, 0, 0);
  if (fireAt.getTime() <= now.getTime()) fireAt = shiftDays(fireAt, 1);
  if (!withinHorizon(fireAt, now, horizonEnd)) return [];

  return [
    {
      cls: 'overdue',
      identifier: `${HOUSE_REMINDER_PREFIX}overdue.${householdId}.${dateKeyOf(fireAt)}`,
      title: count === 1 ? '1 task is overdue' : `${count} tasks are overdue`,
      body:
        count === 1
          ? `"${oldest.title}" was due ${oldest.dueKey}.`
          : `Oldest: "${oldest.title}", due ${oldest.dueKey}.`,
      fireAt,
      data: {
        type: HOUSE_REMINDER_TYPES.TASK_OVERDUE,
        householdId,
        taskId: oldest.id,
        screen: 'TaskDetail',
        overdueCount: count,
      },
      channelId: 'task_reminders',
    },
  ];
}

/** The reminder slots a garbage row asks for, normalised to `(offset, time)`. */
function garbageReminderSlots(
  schedule: GarbageSchedule,
): Array<{ key: string; daysOffset: number; time: string; label: string }> {
  const configured = schedule.reminders;
  if (!configured) {
    return [
      {
        key: 'night',
        daysOffset: -1,
        time: DEFAULT_GARBAGE_NIGHT_BEFORE_TIME,
        label: 'Bins out tonight',
      },
    ];
  }

  const slots: Array<{ key: string; daysOffset: number; time: string; label: string }> = [];
  if (configured.nightBefore?.enabled) {
    slots.push({
      key: 'night',
      daysOffset: -1,
      time: configured.nightBefore.time || DEFAULT_GARBAGE_NIGHT_BEFORE_TIME,
      label: 'Bins out tonight',
    });
  }
  if (configured.morningOf?.enabled) {
    slots.push({
      key: 'morning',
      daysOffset: 0,
      time: configured.morningOf.time || '06:30',
      label: 'Collection today',
    });
  }
  for (const custom of configured.custom ?? []) {
    if (!custom?.enabled) continue;
    slots.push({
      key: `custom.${custom.id}`,
      daysOffset: custom.daysOffset ?? 0,
      time: custom.time || DEFAULT_GARBAGE_NIGHT_BEFORE_TIME,
      label: custom.label || 'Collection reminder',
    });
  }
  return slots;
}

/**
 * Garbage day, expanded on device.
 *
 * The pickup dates come from `logic/garbageSchedule.ts` — the port of
 * `GarbageCollectionService.getNextCollectionDates` that H3 already owns.
 * Re-deriving them here would create a second implementation of municipality
 * expansion to keep in sync, which is exactly the cost the plan's "server
 * business logic that must be re-implemented on device" table warns about
 * paying twice.
 */
function garbageCandidates(
  ledger: HouseReminderLedger,
  now: Date,
  horizonEnd: Date,
): HouseReminderCandidate[] {
  const householdId = ledger.household.id;
  const out: HouseReminderCandidate[] = [];

  for (const schedule of ledger.garbageSchedules) {
    const slots = garbageReminderSlots(schedule);
    if (slots.length === 0) continue;

    const pickups = expandCollectionDates(schedule.schedules, HOUSE_REMINDER_HORIZON_DAYS, now);
    for (const pickup of pickups) {
      for (const slot of slots) {
        const anchor = atLocalTime(pickup.date, slot.time, DEFAULT_GARBAGE_NIGHT_BEFORE_TIME);
        if (!anchor) continue;
        const fireAt = shiftDays(anchor, slot.daysOffset);
        if (!withinHorizon(fireAt, now, horizonEnd)) continue;

        out.push({
          cls: 'garbage',
          identifier: `${HOUSE_REMINDER_PREFIX}garbage.${householdId}.${schedule.id}.${pickup.date}.${slot.key}`,
          title: slot.label,
          body: `${pickup.types.join(', ')} — collection on ${pickup.date}.`,
          fireAt,
          data: {
            type: HOUSE_REMINDER_TYPES.GARBAGE,
            householdId,
            screen: 'GarbageCollection',
            collectionDate: pickup.date,
            types: pickup.types,
          },
          channelId: 'garbage_reminders',
        });
      }
    }
  }

  return out;
}

/**
 * The `recurring_reminders` "keep nagging until it's done" rows.
 *
 * These already carry everything a push needs — `title`, `body`, `next_nudge_at`
 * and a `data` field the API doc describes as "same shape as a push `data`
 * payload — pass straight into `routeNotificationTap`". So this class does not
 * compose copy or invent a route: it re-emits what the row says, which keeps a
 * locally scheduled nudge byte-identical to the server one it replaces.
 */
function recurringCandidates(
  ledger: HouseReminderLedger,
  now: Date,
  horizonEnd: Date,
): HouseReminderCandidate[] {
  const householdId = ledger.household.id;
  const out: HouseReminderCandidate[] = [];

  for (const reminder of ledger.recurringReminders) {
    if (reminder.status !== 'pending' || reminder.completed_at) continue;

    const snoozedUntil = reminder.snoozed_until ? new Date(reminder.snoozed_until) : null;
    const nextNudge = new Date(reminder.next_nudge_at);
    if (Number.isNaN(nextNudge.getTime())) continue;
    const fireAt =
      snoozedUntil && !Number.isNaN(snoozedUntil.getTime()) && snoozedUntil > nextNudge
        ? snoozedUntil
        : nextNudge;
    if (!withinHorizon(fireAt, now, horizonEnd)) continue;

    out.push({
      cls: 'recurring',
      identifier: `${HOUSE_REMINDER_PREFIX}nudge.${householdId}.${reminder.id}.${fireAt.getTime()}`,
      title: reminder.title,
      body: reminder.body,
      fireAt,
      data: {
        ...parseReminderData(reminder.data),
        type: reminder.type,
        householdId,
        recurringReminderId: reminder.id,
      },
      channelId: 'task_reminders',
    });
  }

  return out;
}

/** `data` is member-authored JSON from a peer device — never trust it to parse. */
function parseReminderData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Class cap first, then a global sort/truncate — see {@link HOUSE_REMINDER_CLASS_CAPS}. */
function capByClass(candidates: HouseReminderCandidate[]): HouseReminderCandidate[] {
  const byClass = new Map<HouseReminderClass, HouseReminderCandidate[]>();
  for (const candidate of candidates) {
    const bucket = byClass.get(candidate.cls);
    if (bucket) bucket.push(candidate);
    else byClass.set(candidate.cls, [candidate]);
  }

  const kept: HouseReminderCandidate[] = [];
  for (const [cls, bucket] of byClass) {
    bucket.sort(byFireAt);
    kept.push(...bucket.slice(0, HOUSE_REMINDER_CLASS_CAPS[cls]));
  }
  return kept;
}

/**
 * The whole rolling-horizon decision for ONE property, as data.
 *
 * Exported because the ship gate is a claim about a count, and a count is only
 * checkable if it can be produced without a simulator: the suite runs this
 * against the H10 ten-year corpus shape and asserts the result against
 * {@link IOS_PENDING_NOTIFICATION_LIMIT}.
 */
export function buildHouseReminderPlan(
  ledger: HouseReminderLedger,
  now: Date = new Date(),
  slots: number = HOUSE_REMINDER_SLOTS,
): HouseReminderCandidate[] {
  if (slots <= 0) return [];
  const horizonEnd = shiftDays(now, HOUSE_REMINDER_HORIZON_DAYS);

  const candidates = [
    ...taskDueCandidates(ledger, now, horizonEnd),
    ...overdueCandidates(ledger, now, horizonEnd),
    ...garbageCandidates(ledger, now, horizonEnd),
    ...recurringCandidates(ledger, now, horizonEnd),
  ];

  const capped = capByClass(candidates);
  capped.sort(byFireAt);
  return capped.slice(0, slots);
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/**
 * Mirrors the two channels `services/notifications.ts:99,106` declares rather
 * than importing it: that module runs `setNotificationHandler` and pulls the API
 * client at import time, and a reminder pass has no business dragging the
 * network layer in. Re-declaring an existing channel id is a no-op update, so
 * the two call sites cannot fork the channel's identity.
 */
async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('task_reminders', {
    name: 'Task Reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#4A90D9',
  });
  await Notifications.setNotificationChannelAsync('garbage_reminders', {
    name: 'Garbage Collection',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#4CAF50',
  });
}

async function scheduleCandidate(candidate: HouseReminderCandidate): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: candidate.identifier,
    content: {
      title: candidate.title,
      body: candidate.body,
      data: candidate.data,
      sound: true,
      ...(Platform.OS === 'android' ? { channelId: candidate.channelId } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: candidate.fireAt,
    },
  });
}

/**
 * Drop every reminder this module placed, leaving anything else pending alone.
 *
 * Prefix-scoped rather than `cancelAllScheduledNotificationsAsync()` because
 * other brands and other House surfaces share the same notification centre; a
 * blanket cancel from a sync pass would silently delete their work.
 */
export async function cancelHouseLocalReminders(): Promise<void> {
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      pending
        .filter((request) => request.identifier.startsWith(HOUSE_REMINDER_PREFIX))
        .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
    );
  } catch (error) {
    console.warn('[house.local] reminder cancel failed', error);
  }
}

/**
 * Recompute and re-place every House reminder from the encrypted ledger.
 *
 * Returns the number of notifications actually scheduled — the DoD's measurable
 * quantity. Best-effort otherwise: this runs off a ledger bump, and a reminder
 * failure must never take the sync path with it.
 *
 * `includeColdProperties` is the H5 trade-off made explicit. A property that has
 * not been hydrated this session costs `rows × 35 µs` to open (H10 §4.2: 1.03 s
 * at ten years on V8, 1.5–15 s on Hermes), so the change-driven pass reads only
 * hydrated properties and the app-start / foreground pass passes `true` to sweep
 * the rest. A member who never switches to their second property still gets its
 * reminders — once per foreground, not once per merged op.
 */
export async function syncHouseLocalReminders(
  options: { includeColdProperties?: boolean } = {},
): Promise<number> {
  if (!isHouseLocalFirst() || !isLocalHouseSessionOpen()) return 0;

  try {
    await ensureAndroidChannels();

    // ONE read of the notification centre serves both jobs: it tells us what to
    // cancel, and what is left over from elsewhere in the app. Re-reading after
    // the cancel would race the OS's own bookkeeping on iOS.
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    const ours = pending.filter((request) => request.identifier.startsWith(HOUSE_REMINDER_PREFIX));
    await Promise.all(
      ours.map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
    );

    const foreign = pending.length - ours.length;
    const slots = Math.max(
      0,
      Math.min(HOUSE_REMINDER_SLOTS, IOS_PENDING_NOTIFICATION_LIMIT - foreign),
    );
    if (slots === 0) return 0;

    const properties = listLocalHouseProperties().filter(
      // An un-enrolled property has no HDK yet, so its ledger is empty by
      // definition — hydrating it would cost a session build for no reminders.
      (property) =>
        !property.awaitingEnrolment && (property.hydrated || options.includeColdProperties === true),
    );
    if (properties.length === 0) return 0;

    const now = new Date();
    const perProperty = Math.max(1, Math.floor(slots / properties.length));
    const plan: HouseReminderCandidate[] = [];
    for (const property of properties) {
      const ledger = await getLocalHouseLedgerFor(property.householdId);
      plan.push(...buildHouseReminderPlan(ledger, now, perProperty));
    }

    // The per-property allocation above already bounds the total, but the floor
    // of `Math.max(1, …)` means a member with more properties than slots could
    // still overshoot. This truncate is the invariant, not an optimisation.
    plan.sort(byFireAt);
    const scheduled = plan.slice(0, slots);
    for (const candidate of scheduled) {
      await scheduleCandidate(candidate);
    }
    return scheduled.length;
  } catch (error) {
    console.warn('[house.local] reminder sync failed', error);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Member-facing coverage copy (plan §9 — "never a silent empty state")
// ---------------------------------------------------------------------------

/**
 * What this build actually does, in the member's words.
 *
 * The H3 DoD accepts either working reminders **or** explicit "reminders dark"
 * copy, and House ships a mix: four classes are live on device, and two things
 * the server used to do are genuinely off. Stating that in-product is the P4
 * requirement ("must surface member-facing copy, never a silent empty state")
 * applied to the parts that fell short, rather than to the whole feature.
 */
export const HOUSE_LOCAL_REMINDER_COVERAGE = {
  live: [
    'Task due reminders',
    'Daily overdue summary',
    'Garbage and recycling day',
    'Follow-up nudges',
  ],
  dark: ['Checklist due dates', 'Emailed and pushed weekly digests'],
} as const;

/**
 * Copy for a notification-settings row. `title` names the trade the member is
 * actually making; `message` states both halves — the device-only limitation
 * that P1 accepts, and the two classes that are off on this build.
 */
export function getHouseLocalRemindersCopy(): { title: string; message: string } {
  return {
    title: 'Reminders are scheduled on this device',
    message:
      'Your home stays private, so reminders are worked out on your phone instead of on our servers. Task due dates, overdue summaries, garbage day and follow-up nudges all work — including offline. Open the app every few weeks so upcoming reminders stay topped up. Checklist due dates and emailed weekly digests are off on this build.',
  };
}

/**
 * Copy for the one state where reminders are fully dark: the member declined
 * notification permission, so nothing this file schedules can ever fire.
 */
export function getHouseLocalRemindersDeniedCopy(): { title: string; message: string } {
  return {
    title: 'Reminders are off on this build',
    message:
      'Notifications are turned off for Symply House, and because your home data is private this device is the only thing that can remind you — there is no server copy to send from. Turn notifications on in Settings to get task, overdue and garbage-day reminders back.',
  };
}
