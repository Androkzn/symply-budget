/**
 * App-Group task projection for the Home Screen widget and the Watch — stage
 * **H7-lite** (plan §9, N4).
 *
 * THE PROBLEM (N4)
 * ----------------
 * `WidgetDataService.load()` authenticates to the Worker and reads
 * `/households/:id/tasks/watch`. Under local-first that endpoint returns nothing
 * — the household's rows are ciphertext the Worker cannot open — and the widget
 * extension cannot read the ledger either: it is a separate process with no DEK,
 * no SQLite handle and no session. Left alone, a Wave-A brand-default-on build
 * ships a widget that renders an empty task list forever, which the plan
 * explicitly refuses as a ship gate.
 *
 * THE APPROVED FIX, AND ITS LIMITS
 * --------------------------------
 * Q9 approves a **widget projection**: a minimal plaintext task slice written
 * into the App Group container the widget already reads. This is the plan's
 * *"explicit exception to the P3 ban, not P3"* — the data never leaves the
 * device, no server sees it, and no consent flow or server projection is built
 * here. **P3 (consented plaintext projection to the server) is not approved and
 * is not implemented in this file or anywhere else.**
 *
 * Two channels, deliberately not one file's worth of assumptions:
 *
 *  - **Widget** → `widgetSync.setTasks`, which writes the `widget_tasks` key in
 *    the App Group (`modules/widget-sync/ios/WidgetSyncModule.swift`) and
 *    reloads the timeline. Shape must satisfy `WidgetTask`
 *    (`ios/SymplyEcosystemWidget/WidgetModels.swift:60`), decoded with
 *    `.convertFromSnakeCase`.
 *  - **Watch** → `watchSyncService.syncTasks`, i.e. WatchConnectivity. The App
 *    Group does **not** reach the watch, so the same slice has to travel a
 *    second path; it is decoded by `SharedTask`
 *    (`ios/Shared/Models/SharedTask.swift`), whose `CodingKeys` are snake_case.
 *
 * MINIMAL FIELDS ARE THE POINT
 * ----------------------------
 * {@link HOUSE_WIDGET_TASK_FIELDS} is an allowlist, not a convenience. The
 * ledger's `tasks` row is 58 columns wide and carries the free text a household
 * would least like sitting in plaintext outside the encrypted store —
 * `description`, `ai_rationale`, `blocker_reason`, `clarification_question`,
 * assignee identity, photo keys. None of them are needed to render "next few
 * things due", so none of them are projected, and the suite asserts the
 * projected key set exactly rather than trusting this comment.
 */
import { watchSyncService } from '@services/watch-sync';
import { widgetSync } from '@services/widget-sync';

import {
  getActiveHouseholdId,
  getLocalHouseLedger,
  isLocalHouseSessionOpen,
  subscribeToHouseLedgerChanges,
  type HouseLedger,
} from '../engine';
import { isHouseLocalFirst } from '../flag';

/**
 * How many tasks travel. The widget renders 3–5 rows and the watch complication
 * one; a dozen leaves room for the extension's own filtering (it drops
 * completed/inactive rows and re-sorts by its `priorityRank`) without turning
 * the App Group into a mirror of the ledger.
 */
export const HOUSE_WIDGET_TASK_LIMIT = 12;

/**
 * The complete set of fields that may leave the encrypted ledger for the App
 * Group. Every entry earns its place in one of the two consumers:
 *
 * | field              | why it is projected                                   |
 * |--------------------|-------------------------------------------------------|
 * | `id`               | `WidgetTask.id` / deep link target on tap             |
 * | `household_id`     | `SharedTask.householdId` — the watch scopes by it     |
 * | `title`            | the only line the widget actually renders             |
 * | `space_id`         | plan N4 names "space" in the approved slice           |
 * | `system_category`  | `WidgetTask.systemCategory` — the row icon            |
 * | `next_due_date`    | `WidgetTask.dueDate` — ordering and the "overdue" tint |
 * | `priority_severity`| `WidgetTask.priorityRank` — same-day tie-break        |
 * | `is_active`        | the extension's own filter                            |
 */
export const HOUSE_WIDGET_TASK_FIELDS = [
  'id',
  'household_id',
  'title',
  'space_id',
  'system_category',
  'next_due_date',
  'priority_severity',
  'is_active',
] as const;

export type HouseWidgetTask = {
  id: string;
  household_id: string;
  title: string;
  space_id: string | null;
  system_category: string | null;
  next_due_date: string | null;
  priority_severity: string | null;
  is_active: boolean;
};

/** Mirrors `WidgetTask.priorityRank` — higher is more urgent. */
const PRIORITY_RANK: Record<string, number> = {
  critical: 5,
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function priorityRank(value: string | null | undefined): number {
  return value ? (PRIORITY_RANK[value] ?? 0) : 0;
}

/**
 * Sortable due instant. A task with no due date sorts last rather than first —
 * `null` would otherwise compare as 0 and push undated backlog ahead of
 * tomorrow's overdue boiler service.
 */
function dueOrder(task: { next_due_date: string | null }): number {
  if (!task.next_due_date) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(task.next_due_date);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

/**
 * Build the plaintext slice from a ledger.
 *
 * Pure and exported so the field allowlist and the ordering are assertable
 * without a native module — the widget itself cannot be unit-tested from here,
 * so what crosses the boundary is what gets tested.
 *
 * `now` participates only in ordering (overdue first); it is not a filter,
 * because a widget that hides overdue work is worse than one that shows it.
 */
export function projectHouseWidgetTasks(
  ledger: Pick<HouseLedger, 'household' | 'tasks'>,
  now: Date = new Date(),
  limit: number = HOUSE_WIDGET_TASK_LIMIT,
): HouseWidgetTask[] {
  const householdId = ledger.household.id;
  const nowMs = now.getTime();

  const projected: HouseWidgetTask[] = [];
  for (const task of ledger.tasks) {
    // Inactive rows are dropped here rather than in the extension so they never
    // occupy one of the twelve slots. `is_active` is still projected because the
    // widget's own cache path expects the field to exist.
    if (!task.is_active) continue;
    projected.push({
      id: task.id,
      household_id: householdId,
      title: task.title,
      space_id: task.space_id ?? null,
      system_category: task.system_category ?? null,
      next_due_date: task.next_due_date ?? null,
      priority_severity: task.priority_severity ?? null,
      is_active: true,
    });
  }

  projected.sort((a, b) => {
    const aDue = dueOrder(a);
    const bDue = dueOrder(b);
    const aOverdue = aDue < nowMs;
    const bOverdue = bDue < nowMs;
    // Overdue first as a block, most overdue at the top; then soonest-due; then
    // priority; then id, so two identical rows never swap between passes and
    // trigger a needless widget reload.
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    if (aDue !== bDue) return aDue - bDue;
    const rank = priorityRank(b.priority_severity) - priorityRank(a.priority_severity);
    if (rank !== 0) return rank;
    return a.id.localeCompare(b.id);
  });

  return projected.slice(0, limit);
}

/**
 * Last payload written, so an unchanged ledger does not reload the widget.
 *
 * A House catch-up is ~98 deposits (H10 §4.2) and every one of them bumps the
 * ledger; without this, each would call `WidgetCenter.reloadAllTimelines()` and
 * iOS would start budget-limiting the widget's refreshes.
 */
let lastPublished: string | null = null;
let unsubscribe: (() => void) | null = null;
let pendingRepublish: ReturnType<typeof setTimeout> | null = null;

/**
 * Coalescing window. Long enough to absorb a burst of deposits landing during
 * one sync pass, short enough that a member editing a task in the app sees the
 * widget follow before they put the phone down.
 */
const REPUBLISH_DEBOUNCE_MS = 500;

/**
 * Project the ACTIVE property only.
 *
 * The App Group carries a single `current_household_id` (written by
 * `app/_layout.tsx` on sign-in) and the widget renders that one home, so
 * publishing a second property's tasks would put rows on the widget that belong
 * to a home the widget is not claiming to show. Property switching re-runs this
 * through the session-level ledger bump.
 */
export function publishHouseWidgetProjection(now: Date = new Date()): HouseWidgetTask[] | null {
  if (!isHouseLocalFirst() || !isLocalHouseSessionOpen()) return null;

  try {
    const tasks = projectHouseWidgetTasks(getLocalHouseLedger(), now);
    const encoded = JSON.stringify(tasks);
    if (encoded === lastPublished) return tasks;
    lastPublished = encoded;

    // Both services no-op off iOS and when their native module is absent, so
    // there is no Platform guard here — one place to get the check wrong.
    widgetSync.setTasks(tasks);
    void watchSyncService.syncTasks(tasks);
    return tasks;
  } catch (error) {
    // A widget that misses a refresh is a cosmetic failure; taking the ledger
    // listener down with it would not be.
    console.warn('[house.local] widget projection failed', error);
    return null;
  }
}

/** Run any debounced republish immediately (foreground, and the suites). */
export function flushHouseWidgetProjection(): void {
  if (pendingRepublish) {
    clearTimeout(pendingRepublish);
    pendingRepublish = null;
  }
  publishHouseWidgetProjection();
}

/**
 * Wipe the projection.
 *
 * MUST be called on logout: the App Group survives sign-out on its own, so a
 * signed-out phone would keep showing the previous member's task titles on the
 * home screen. Writing empty arrays rather than calling `widgetSync.clear()`
 * keeps this narrow — `clear()` also drops `current_household_id`, `user_id` and
 * every other brand's snapshot, and that key set is owned by `app/_layout.tsx`.
 *
 * `app/_layout.tsx:219` already calls `widgetSync.clear()` when authentication
 * drops, which removes `widget_tasks` outright; this function covers the House
 * local-first teardown path (`teardownHouseLocalSession`), which can run without
 * an auth transition — switching accounts, or a wipe-and-reopen.
 */
export function clearHouseWidgetProjection(): void {
  lastPublished = null;
  try {
    widgetSync.setTasks([]);
    void watchSyncService.syncTasks([]);
  } catch (error) {
    console.warn('[house.local] widget projection clear failed', error);
  }
}

/**
 * Keep the App Group in step with the ledger.
 *
 * Subscribes to the same change stream `sync/ledgerRefresh.ts` uses, and applies
 * the same two filters it does (plan §5.2): a background property's sync must
 * not repaint the active surface, and a change that did not touch `tasks` has
 * nothing for the widget. An empty `tables` array is the engine's session-level
 * bump (property activated, enrolment completed) and DOES republish, because
 * that is how a property switch reaches the widget.
 */
export function startHouseWidgetProjection(): void {
  if (!isHouseLocalFirst() || unsubscribe) return;

  unsubscribe = subscribeToHouseLedgerChanges((change) => {
    if (change.householdId && change.householdId !== getActiveHouseholdId()) return;
    if (change.tables.length > 0 && !change.tables.includes('tasks')) return;

    if (pendingRepublish) clearTimeout(pendingRepublish);
    pendingRepublish = setTimeout(() => {
      pendingRepublish = null;
      publishHouseWidgetProjection();
    }, REPUBLISH_DEBOUNCE_MS);
  });

  // Publish once immediately: the whole point of a widget is to be right before
  // the member has opened a single screen (plan §9 DoD — "verified on device
  // from a cold, signed-in, never-opened-a-screen launch").
  publishHouseWidgetProjection();
}

export function stopHouseWidgetProjection(): void {
  if (pendingRepublish) {
    clearTimeout(pendingRepublish);
    pendingRepublish = null;
  }
  unsubscribe?.();
  unsubscribe = null;
}

/**
 * Member-facing copy for the builds where the projection genuinely cannot run:
 * Android and Expo Go have no `WidgetSync` native module at all, so
 * `widgetSync.isAvailable()` is false and nothing this file writes lands
 * anywhere.
 *
 * Plan §9, P4: "must surface member-facing copy, never a silent empty state."
 */
export function getHouseWidgetProjectionCopy(): { title: string; message: string } {
  if (widgetSync.isAvailable()) {
    return {
      title: 'Your widget shows your next tasks',
      message:
        'Because your home data is private, the Home Screen widget and Apple Watch read a short list of upcoming task names kept on this device — never on our servers. Signing out clears it.',
    };
  }
  return {
    title: 'Widget is off on this build',
    message:
      'The Home Screen widget and Apple Watch complication are not available in this build. Your tasks, reminders and everything else in the app work normally.',
  };
}
