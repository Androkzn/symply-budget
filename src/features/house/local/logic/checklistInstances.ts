/**
 * Recurring-checklist period + instance materialization.
 * Ported from backend/src/services/checklist-service.ts — keep in sync.
 *
 * WHICH server file, exactly. `checklist_instances` rows are server-created
 * today (plan §6, "server business logic that must be re-implemented on
 * device"). The route contract lives in `backend/src/routes/checklists.ts`, but
 * the logic lives in `ChecklistService` — and on `main` today every recurring
 * method there is a `throw new Error('Not implemented')` stub, because the file
 * was rewritten for seasonal checklists. The last working implementation is
 * `backend/src/services/checklist-service.ts` at commit `ed43b610`
 * (`git show ed43b610:backend/src/services/checklist-service.ts`), and THAT is
 * what this module ports: `calculateCurrentPeriod` (:247), `createInstance`
 * (:217), and the progress arithmetic inside `completeItem` (:308) /
 * `uncompleteItem` (:367). Column shapes are pinned by
 * `backend/src/db/schema-checklists.ts`, which is live on both envs.
 *
 * THREE DELIBERATE DEVIATIONS, each of which the offline case forces:
 *
 *  1. **Instance ids are deterministic, not `crypto.randomUUID()`.** The server
 *     decides create-vs-reuse with `where(checklist_id = ? AND period_start = ?)`
 *     — that lookup IS a business uniqueness constraint, even though D1 carries
 *     no unique index for it. Two members who open the Checklists screen offline
 *     in the same period both materialize "this period", and with random ids
 *     both rows survive the merge: the member sees the same week twice and their
 *     completions split across two instances. This is plan §1.5 hazard S3b
 *     applied to a natural key the registry does not list, exactly as
 *     `defaults.ts` applies it to the preset spaces.
 *  2. **`completed_items` is recomputed, never incremented.** The server does
 *     `instance.completed_items + 1` (:343) and leans on the unique index to
 *     stop a double count. An op log has no unique index and no rollback, so an
 *     increment applied twice — two devices, one item — converges to 2 against a
 *     single completion row. Counting the rows is the same answer online and the
 *     only stable one offline.
 *  3. **Period labels are built from tables, not `toLocaleDateString`.** The
 *     server hardcodes `'en-US'` (:258, :269, :275), so a French member already
 *     receives English labels; reproducing that from arrays keeps parity AND
 *     removes the dependency on Hermes' Intl, which is not guaranteed to be
 *     built with full ICU. `period_label` is persisted into a synced row, so two
 *     devices must produce the same bytes for the same period.
 */
import { deterministicRowId } from '@symply/local-first';

import type { LocalChecklistInstance, LocalRecurringChecklist } from '../types';

export type ChecklistFrequency = LocalRecurringChecklist['frequency'];
export type ChecklistInstanceStatus = LocalChecklistInstance['status'];

/** The window one instance covers. Dates are `YYYY-MM-DD`, as in D1. */
export type ChecklistPeriod = {
  start: string;
  end: string;
  label: string;
};

// `toLocaleDateString('en-US', …)` output, tabulated. See deviation 3.
const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
const MONTH_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * `YYYY-MM-DD` from the LOCAL calendar fields.
 *
 * The server ends `calculateCurrentPeriod` with `start.toISOString().split('T')[0]`
 * on a Date built at local midnight (:300). On the Worker that is harmless —
 * UTC is local. On a device east of UTC it silently rolls the key back one day
 * (local midnight Aug 13 in UTC+2 is Aug 12T22:00Z), and `period_start` is half
 * of the instance's natural key, so the member would get two instances for one
 * week. Reading the fields back off the same Date cannot drift.
 */
function toDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The period a checklist of this frequency is currently in.
 * Ported verbatim from `ChecklistService.calculateCurrentPeriod` (:247).
 *
 * `now` is injectable so the suites can pin a period without freezing clocks;
 * production always passes the real one.
 */
export function calculateCurrentPeriod(
  frequency: ChecklistFrequency | string,
  now: Date = new Date(),
): ChecklistPeriod {
  let start: Date;
  let end: Date;
  let label: string;

  switch (frequency) {
    case 'daily': {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(start);
      end.setDate(end.getDate() + 1);
      label = dailyLabel(start);
      break;
    }

    case 'weekly': {
      // Sunday-start weeks, as on the server. `setDate` handles the month and
      // year rollover, so the first days of January land in the right week.
      const dayOfWeek = now.getDay();
      start = new Date(now);
      start.setDate(now.getDate() - dayOfWeek);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(end.getDate() + 7);
      // Kept in the server's shape. `start.getDay()` is 0 by construction here,
      // so this reduces to `ceil((date + 6) / 7)` — the term stays so a reader
      // diffing against the server sees the same expression.
      const weekNum = Math.ceil((start.getDate() + 6 - start.getDay()) / 7);
      label = `Week ${weekNum}, ${MONTH_SHORT[start.getMonth()]} ${start.getFullYear()}`;
      break;
    }

    case 'monthly': {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      label = `${MONTH_LONG[start.getMonth()]} ${start.getFullYear()}`;
      break;
    }

    case 'quarterly': {
      const quarter = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), quarter * 3, 1);
      end = new Date(now.getFullYear(), (quarter + 1) * 3, 1);
      label = `Q${quarter + 1} ${now.getFullYear()}`;
      break;
    }

    case 'yearly': {
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear() + 1, 0, 1);
      label = `${now.getFullYear()}`;
      break;
    }

    default: {
      // `seasonal` and `custom` fall here, exactly as on the server (:291):
      // neither has a period rule, so both bill by the day. Changing that would
      // re-key every instance already materialized under the old rule.
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(start);
      end.setDate(end.getDate() + 1);
      label = dailyLabel(start);
    }
  }

  return { start: toDateKey(start), end: toDateKey(end), label };
}

function dailyLabel(start: Date): string {
  return `${WEEKDAY_LONG[start.getDay()]}, ${MONTH_SHORT[start.getMonth()]} ${start.getDate()}`;
}

/**
 * The instance row key for one (checklist, period). See deviation 1.
 *
 * `period_start` alone identifies the period for a given checklist: every
 * frequency's periods are disjoint and start-aligned.
 */
export function checklistInstanceId(checklistId: string, periodStart: string): string {
  return deterministicRowId('cin', [checklistId, periodStart]);
}

/** A fresh instance. Mirrors `ChecklistService.createInstance` (:217). */
export function buildChecklistInstance(input: {
  checklistId: string;
  householdId: string;
  period: ChecklistPeriod;
  totalItems: number;
  now: string;
}): LocalChecklistInstance {
  return {
    id: checklistInstanceId(input.checklistId, input.period.start),
    checklist_id: input.checklistId,
    household_id: input.householdId,
    period_start: input.period.start,
    period_end: input.period.end,
    period_label: input.period.label,
    total_items: input.totalItems,
    completed_items: 0,
    status: 'not_started',
    completed_at: null,
    completed_by: null,
    created_at: input.now,
    updated_at: input.now,
  };
}

/**
 * One status rule for both the complete and uncomplete paths.
 *
 * The server derives it twice — `isComplete ? 'completed' : 'in_progress'` on
 * the way up (:350) and `count === 0 ? 'not_started' : 'in_progress'` on the way
 * down (:403). Those two agree on every reachable count; collapsing them is what
 * lets the recomputed count (deviation 2) drive the status from either
 * direction.
 */
export function deriveInstanceStatus(
  completedItems: number,
  totalItems: number,
): ChecklistInstanceStatus {
  if (totalItems > 0 && completedItems >= totalItems) return 'completed';
  return completedItems > 0 ? 'in_progress' : 'not_started';
}

/**
 * Re-derive an instance's progress columns from the facts, in place.
 *
 * `totalItems` is refreshed here rather than trusted: the server writes
 * `total_items` once at creation and never again, so adding an item to a
 * checklist leaves every open instance claiming the old total and the ring on
 * `ChecklistsScreen` reads "5/4". We are already inside a write when this runs,
 * so the correction is free.
 */
export function applyInstanceProgress(
  instance: LocalChecklistInstance,
  input: { completedItems: number; totalItems: number; actorId: string; now: string },
): void {
  instance.total_items = input.totalItems;
  instance.completed_items = input.completedItems;
  instance.status = deriveInstanceStatus(input.completedItems, input.totalItems);
  const finished = instance.status === 'completed';
  instance.completed_at = finished ? input.now : null;
  instance.completed_by = finished ? input.actorId : null;
  instance.updated_at = input.now;
}

/**
 * Completion rate + streak over the recent instances.
 * Ported from `ChecklistService.getProgress` (:437-451).
 *
 * `recent` must already be newest-first (`order by period_start desc limit 10`)
 * — the streak walks from the head and stops at the first period that was not
 * finished, so the order is load-bearing, not cosmetic.
 */
export function summarizeInstances(recent: readonly LocalChecklistInstance[]): {
  completionRate: number;
  streak: number;
} {
  const completed = recent.filter((instance) => instance.status === 'completed').length;
  const completionRate = recent.length > 0 ? Math.round((completed / recent.length) * 100) : 0;

  let streak = 0;
  for (const instance of recent) {
    if (instance.status !== 'completed') break;
    streak += 1;
  }

  return { completionRate, streak };
}

/** `getProgress` reads at most this many instances back, as on the server (:434). */
export const RECENT_INSTANCE_WINDOW = 10;
