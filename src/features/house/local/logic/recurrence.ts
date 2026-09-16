/**
 * Task recurrence — the next-occurrence math House must run on device.
 *
 * Ported from `backend/src/services/task-service.ts` (`calculateNextDueDate`,
 * :1064), `backend/src/utils/id.ts` (`addDays` :49, `calculateNextDueDate` :58)
 * and `backend/src/services/reminder-service.ts` (`calculateNextDueDate` :363)
 * — keep in sync.
 *
 * WHY THE CLIENT NEEDS THIS AT ALL (plan §6)
 * ------------------------------------------
 * Completing a recurring task is the single most common House write, and the
 * *only* thing that moves `tasks.next_due_date` forward. Without this math on
 * device, a member who completes "change the furnace filter" in airplane mode
 * gets a task that never comes back — the exact failure local-first exists to
 * prevent.
 *
 * THREE SERVER VARIANTS, DELIBERATELY KEPT APART
 * ----------------------------------------------
 * The backend does not have one recurrence engine; it has three, and they do
 * not agree. Collapsing them here would silently change behaviour for whichever
 * call site lost, so each is ported under its own name and each name says which
 * server site it mirrors:
 *
 * | Export | Server site | Anchor | Month = | Output |
 * |---|---|---|---|---|
 * | `nextDueDateAfterCompletion` | `TaskService.calculateNextDueDate` | **now** | 30 days | full ISO |
 * | `calculateNextDueDate` | `utils/id.ts` | `fromDate ?? now` | calendar month | full ISO |
 * | `rollForwardDueDate` | `ReminderService.calculateNextDueDate` | the **current due date** | calendar month | `YYYY-MM-DD` |
 *
 * `nextDueDateAfterCompletion` is the one `POST /tasks/:id/complete` runs
 * (`task-service.ts:915`), so it is the one `localTasksApi.complete` must use.
 * The other two exist because other server paths (the AI tool executor, the
 * cron reminder sweep) call their own copy; H7's on-device reminder horizon
 * will need `rollForwardDueDate`, so it is ported now rather than rediscovered
 * later.
 *
 * THE ONE PLACE THIS PORT IS NOT CHARACTER-FOR-CHARACTER: UTC ACCESSORS
 * --------------------------------------------------------------------
 * The server writes `date.setMonth(date.getMonth() + 3)` — the LOCAL-time
 * accessors. It gets the right answer anyway because the Workers runtime is
 * fixed at UTC, which is exactly what `backend/src/services/__tests__/
 * reminder-date-math.test.ts` says in its header. A phone is not fixed at UTC,
 * and the local-accessor form breaks in two ways there:
 *
 *   - **DST.** `new Date('2026-01-15')` is UTC midnight; in America/Vancouver
 *     that is Jan 14 16:00 PST. Add three months with local accessors and you
 *     land on Apr 14 16:00 **PDT** — an hour short of the UTC day boundary —
 *     so the date-only result is `2026-04-14` where the server says
 *     `2026-04-15`. Measured, not hypothesised: it is why two fixtures in
 *     `__tests__/recurrence.test.ts` failed before this note existed.
 *   - **Two members, two zones.** A household in Vancouver and Toronto would
 *     compute different `next_due_date` values for the same completion, and LWW
 *     would then flap the column between them on every sync — a permanent
 *     disagreement with no user action behind it.
 *
 * So every arm below uses the `setUTC*` / `getUTC*` form. That reproduces what
 * the server actually PRODUCES on every device in every zone, which is the
 * property a port owes; copying the local-time accessors would reproduce only
 * what the server's source LOOKS LIKE. The server fixtures pass unchanged
 * against this file, which is the evidence.
 */
import type { Task } from '@api/tasks';

/** The frequency union as the client already models it (`src/api/tasks.ts`). */
export type TaskFrequency = Task['frequency'];

/**
 * Day intervals for `TaskService.calculateNextDueDate` (task-service.ts:1069).
 *
 * Note `monthly: 30` / `yearly: 365` — the completion path deliberately does
 * NOT use calendar arithmetic, so a task completed on the 31st never skips a
 * month the way `setMonth()` does. Do not "fix" this to calendar months without
 * changing the server first: the two would drift and every member with two
 * devices on different builds would see the due date flap.
 */
export const COMPLETION_INTERVAL_DAYS: Record<Exclude<TaskFrequency, 'one_time'>, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  yearly: 365,
  // `custom` reads the task's own `custom_interval_days`; 30 is the server's
  // fallback when the column is null.
  custom: 30,
};

/** Port of `backend/src/utils/id.ts:49` — add N days, return a full ISO string. */
export function addDays(days: number, fromDate?: Date): string {
  const date = fromDate ? new Date(fromDate) : new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

/**
 * Next due date after a completion — port of `TaskService.calculateNextDueDate`
 * (task-service.ts:1064).
 *
 * Returns `null` for one-time tasks. The server comment on that early return is
 * worth carrying: an earlier implementation looked up `intervals['one_time']`,
 * got `undefined`, handed it to `addDays()` and threw `RangeError: Invalid time
 * value` the first time anyone completed a one-time task.
 */
export function nextDueDateAfterCompletion(
  frequency: TaskFrequency,
  customIntervalDays?: number | null,
  from?: Date,
): string | null {
  if (frequency === 'one_time') return null;
  const interval =
    frequency === 'custom'
      ? customIntervalDays || COMPLETION_INTERVAL_DAYS.custom
      : COMPLETION_INTERVAL_DAYS[frequency];
  return addDays(interval, from);
}

/**
 * Calendar-aware variant — port of `backend/src/utils/id.ts:58`.
 *
 * Used server-side by the AI tool executor and the maintenance-suggestion
 * service, i.e. wherever a due date is *proposed* rather than rolled after a
 * completion. `custom` with no interval falls through unchanged, exactly as the
 * server's `if (customIntervalDays)` guard does.
 */
export function calculateNextDueDate(
  frequency: TaskFrequency,
  customIntervalDays?: number | null,
  fromDate?: Date,
): string {
  const date = fromDate ? new Date(fromDate) : new Date();

  switch (frequency) {
    case 'daily':
      date.setUTCDate(date.getUTCDate() + 1);
      break;
    case 'weekly':
      date.setUTCDate(date.getUTCDate() + 7);
      break;
    case 'monthly':
      date.setUTCMonth(date.getUTCMonth() + 1);
      break;
    case 'quarterly':
      date.setUTCMonth(date.getUTCMonth() + 3);
      break;
    case 'yearly':
      date.setUTCFullYear(date.getUTCFullYear() + 1);
      break;
    case 'custom':
      if (customIntervalDays) {
        date.setUTCDate(date.getUTCDate() + customIntervalDays);
      }
      break;
    case 'one_time':
    default:
      // The server's switch has no `one_time` arm and no default, so the date
      // comes back unmoved. Spelled out here because `noFallthroughCasesInSwitch`
      // would otherwise make the omission look like an oversight.
      break;
  }

  return date.toISOString();
}

/**
 * Roll a due date forward from ITSELF — port of
 * `ReminderService.calculateNextDueDate` (reminder-service.ts:363).
 *
 * Two things differ from the other two variants and both matter:
 *  - the anchor is the task's current `next_due_date`, not "now", so a schedule
 *    that slipped stays on its original cadence instead of resetting;
 *  - the output is date-only (`YYYY-MM-DD`), because that is what the cron
 *    sweep writes back into the column.
 *
 * It also understands `3_years` / `5_years`, which are not in the client's
 * `frequency` union at all — that call site passes `system_category` where the
 * others pass `frequency` (reminder-service.ts:348). Ported verbatim, string
 * in, rather than pretending the union covers it.
 */
export function rollForwardDueDate(fromDate: Date, frequency: string): string {
  const nextDate = new Date(fromDate);

  switch (frequency) {
    case 'daily':
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      break;
    case 'weekly':
      nextDate.setUTCDate(nextDate.getUTCDate() + 7);
      break;
    case 'monthly':
      nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
      break;
    case 'quarterly':
      nextDate.setUTCMonth(nextDate.getUTCMonth() + 3);
      break;
    case 'yearly':
      nextDate.setUTCFullYear(nextDate.getUTCFullYear() + 1);
      break;
    case '3_years':
      nextDate.setUTCFullYear(nextDate.getUTCFullYear() + 3);
      break;
    case '5_years':
      nextDate.setUTCFullYear(nextDate.getUTCFullYear() + 5);
      break;
    default:
      nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
  }

  return nextDate.toISOString().split('T')[0]!;
}

/**
 * Days until a due date, negative when overdue — the formula
 * `TaskPlannerService.daysUntilDue` (task-planner-service.ts:91) and
 * `ReminderService.calculateDaysUntilDue` (reminder-service.ts:311) both use.
 *
 * `Math.ceil` (not `round`/`floor`) is load-bearing: it is what makes a task due
 * later today report `0` rather than `-1`, which is what the planner's
 * "due today" bucket and its +30 urgency boost key on.
 */
export function daysUntilDue(nextDueDate: string | null, now: Date): number | null {
  if (!nextDueDate) return null;
  const due = new Date(nextDueDate).getTime();
  if (Number.isNaN(due)) return null;
  return Math.ceil((due - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * When a subtask's reminder should fire — port of `SubtaskService.createSubtask`
 * (subtask-service.ts:232-240) and its recompute in `updateSubtask` (:372-391).
 *
 * Returns `null` when reminders are off or the parent has no due date; the
 * server stores exactly that null and its notification scheduler treats it as
 * "nothing to schedule" (subtask-service.ts:110).
 */
export function subtaskReminderDate(
  parentNextDueDate: string | null | undefined,
  reminderEnabled: boolean,
  reminderDaysBefore: number | null | undefined,
): string | null {
  if (!reminderEnabled || !parentNextDueDate) return null;
  const due = new Date(parentNextDueDate);
  if (Number.isNaN(due.getTime())) return null;
  due.setUTCDate(due.getUTCDate() - (reminderDaysBefore || 1));
  return due.toISOString();
}
