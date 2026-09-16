/**
 * `tasksApi`, served from the on-device ledger (plan §6, Stage H3).
 *
 * A 1:1 local counterpart for all 31 methods on `src/api/tasks.ts`. The Proxy in
 * `localApiProxy.ts` swaps this in per call, so no screen and no store changes;
 * `parityGap()` in the H3 test suite fails the build if a remote method ever
 * appears here without a partner.
 *
 * FOUR RULES THIS FILE IS BUILT ON
 * -------------------------------
 * 1. **A ledger row IS the DTO.** `LocalTask` is `Task` minus the two derived
 *    collections (`types.ts`), so a read is a filter and a projection, never a
 *    reshape. Where the server composes something at response time — subtasks,
 *    progress, the assignee object — this file composes the same thing from the
 *    same rows, and only on the endpoints that actually returned it.
 * 2. **Server behaviour is mirrored, including its quirks.** Where the server
 *    caps `list` at 20, sorts by `next_due_date DESC` while paginating on
 *    `created_at`, or auto-renumbers a subtask whose `sort_order` is explicitly
 *    `0`, so does this. A quirk reproduced is a screen that keeps working; a
 *    quirk quietly "fixed" is two devices that disagree the moment one of them
 *    is online. Every such site says so in a comment.
 * 3. **Tier B throws, it never returns empty.** Quotes and the budget-item
 *    linkage are server-owned; they raise `HouseLocalUnsupportedError` with copy
 *    a member can read. Returning `{ quotes: [] }` would render a correct-looking
 *    empty screen, which is the failure mode §6 calls the worst one available.
 * 4. **One write, one op.** Multi-row writes go through `writeLocal` /
 *    `writeLocalBulk` (`localWrite.ts`) — never a loop of single mutations,
 *    which is quadratic because every call re-diffs the whole ledger.
 *
 * Ported server logic lives beside this file: `logic/recurrence.ts` (the
 * next-occurrence math) and `logic/taskWorkflow.ts` (the contractor pipeline).
 * The planner port is inline below, under "TASK PLANNER".
 */
// Bare side-effect, FIRST: @noble/* captures `globalThis.crypto` at module load
// and `localWrite` reaches @symply/local-first before it reaches the engine.
import './cryptoPolyfill';

import type {
  MaintenanceCompletion,
  MaintenanceSubtask,
  PlannedTaskItem,
  QuickCreateTaskRequest,
  SkippedTaskItem,
  SubtaskProgress,
  Task,
  TaskBudgetPlan,
  TaskNote,
  TaskPhoto,
  TaskPrioritySeverity,
  TaskReport,
  TaskRiskLevel,
  TimeEffort,
} from '@api/tasks';
import { ENV } from '@config/env';

import type { HouseBlobDescriptor } from './blobs';
import { getLocalHouseMemberId } from './engine';
import { HouseLocalUnsupportedError } from './errors';
import { newLocalId } from './ids';
import { ledger, nowIso, rowsOf, writeLocal, writeLocalBulk } from './localWrite';
import {
  addDays,
  daysUntilDue,
  nextDueDateAfterCompletion,
  subtaskReminderDate,
} from './logic/recurrence';
import {
  scheduleWorkPatch,
  selectQuotePatch,
  setStagePatch,
  type TaskWorkflowPatch,
} from './logic/taskWorkflow';
import type {
  LocalMaintenanceCompletion,
  LocalMaintenanceSubtask,
  LocalTask,
  LocalTaskNote,
} from './types';

/**
 * The request shapes `src/api/tasks.ts` declares but does not export.
 *
 * Re-declared rather than imported because that module is owned by another
 * step of H3 and must not grow exports for our convenience. They are structural
 * copies — if one drifts, the Proxy's own `typeof remoteTasksApi` typing is what
 * catches it at the call site.
 */
type CreateTaskInput = {
  title: string;
  description?: string;
  system_category?: string;
  frequency: Task['frequency'];
  custom_interval_days?: number;
  next_due_date?: string;
  assigned_to?: string;
  priority_severity?: TaskPrioritySeverity;
  time_effort?: TimeEffort | null;
  reminder_enabled?: boolean;
  reminder_days_before?: number;
  reminder_time?: string;
  reminder_repeat?: boolean;
  space_id?: string | null;
  is_personal?: boolean;
  /**
   * `blob` rides alongside `photo_key` so the H6 descriptor reaches the ledger
   * row. Optional — a photo uploaded on the legacy R2 path has only the key.
   */
  photos?: Array<{ photo_key: string; blob?: HouseBlobDescriptor }>;
  cover_photo_index?: number;
};

type UpdateTaskInput = Partial<Omit<CreateTaskInput, 'assigned_to'>> & {
  is_active?: boolean;
  space_id?: string | null;
  snooze_until?: string;
  /** Nullable so a task can be unassigned, not just reassigned. */
  assigned_to?: string | null;
  /**
   * `blob` rides alongside `photo_key` so the H6 descriptor reaches the ledger
   * row. Optional — a photo uploaded on the legacy R2 path has only the key.
   */
  photos?: Array<{ photo_key: string; blob?: HouseBlobDescriptor }>;
  cover_photo_index?: number;
};

type CompleteTaskInput = { notes?: string; photo_keys?: string[] };

type TaskFilters = {
  system_category?: string;
  is_active?: boolean;
  limit?: number;
  cursor?: string;
};

type PaginationFilters = { limit?: number; cursor?: string };

type CreateSubtaskInput = {
  title: string;
  description?: string;
  sort_order?: number;
  reminder_enabled?: boolean;
  reminder_days_before?: number;
  reminder_time?: string;
};

type UpdateSubtaskInput = {
  title?: string;
  description?: string;
  reminder_enabled?: boolean;
  reminder_days_before?: number;
  reminder_time?: string;
};

/** `TaskService.listTasks` / `getCompletionHistory` default (`task-service.ts:488`, `:1008`). */
const DEFAULT_PAGE_LIMIT = 20;

/** `TaskService.listNotes` default (`task-service.ts:1446`). */
const NOTES_LIMIT = 50;

/** `TaskService.MAX_TASK_PHOTOS` (`task-service.ts:68`). */
const MAX_TASK_PHOTOS = 5;

// ---------------------------------------------------------------------------
// Row access + composition
// ---------------------------------------------------------------------------

type MemberRef = { id: string; display_name: string | null };

/**
 * Resolve a user id to the `{id, display_name}` object every task DTO carries.
 *
 * Divergence worth naming: the server LEFT JOINs the Tier-B `users` table and
 * returns `null` for the whole object when there is no row
 * (`task-service.ts:1225`). Here the id came out of the ledger and IS
 * authoritative, so an unknown member degrades to a nameless reference rather
 * than to "unassigned" — dropping it would make an assignment disappear on a
 * device that has not yet synced the member list.
 */
function memberRef(userId: string | null | undefined): MemberRef | null {
  if (!userId) return null;
  const member = ledger().householdMembers.find((row) => row.user_id === userId);
  return { id: userId, display_name: member?.display_name ?? null };
}

/** Rows of `tasks` for the active property. */
function taskRows(): LocalTask[] {
  return rowsOf<LocalTask>('tasks');
}

/**
 * Personal-task visibility — `task-service.ts:451` and the `or(...)` guard in
 * every list query. Personal rows still sync (they belong to the household's
 * ledger); it is the READ that is scoped, exactly as on the server.
 */
function visibleToMe(task: LocalTask, memberId: string): boolean {
  return !task.is_personal || task.created_by === memberId;
}

/** The household's task, or `NotFoundError`'s message. Personal rows respect the same scope. */
function requireTask(householdId: string, taskId: string): LocalTask {
  const memberId = getLocalHouseMemberId();
  const task = taskRows().find((row) => row.id === taskId && row.household_id === householdId);
  if (!task || !visibleToMe(task, memberId)) {
    throw new Error('Maintenance task not found');
  }
  return task;
}

function subtaskRowsFor(taskId: string): LocalMaintenanceSubtask[] {
  return rowsOf<LocalMaintenanceSubtask>('maintenanceSubtasks')
    .filter((row) => row.task_id === taskId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** Port of `SubtaskService.getSubtaskProgress` (`subtask-service.ts:632`). */
function subtaskProgress(taskId: string): SubtaskProgress {
  const rows = subtaskRowsFor(taskId);
  const total = rows.length;
  const completed = rows.filter((row) => row.is_completed).length;
  return {
    completed,
    total,
    percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

/**
 * Drop the ledger-only columns before a row leaves this module.
 *
 * `household_id` is on every row so one device can hold several properties, and
 * `task_id` is on completions and notes because a flat op log has to carry its
 * own parentage where the nested API response implied it (`types.ts`). Neither
 * is part of the shape screens type against. One helper, so four converters
 * cannot drift about which columns are internal — and so the copy is explicit:
 * handing a screen the live ledger row would let a render mutate merge state.
 */
function stripLedgerColumns<T extends object, K extends keyof T>(
  row: T,
  ...columns: K[]
): Omit<T, K> {
  const copy = { ...row } as Record<string, unknown>;
  for (const column of columns) delete copy[column as string];
  return copy as Omit<T, K>;
}

/**
 * The list/upcoming DTO: the row itself, with the derived collections absent.
 *
 * `mapTaskResponse` omits `subtasks`/`subtask_progress` on every endpoint except
 * `getTask`, and screens branch on their presence (`TaskDetailScreen` loads
 * subtasks separately when the list DTO has none), so adding them everywhere
 * would change behaviour, not just payload size.
 */
function toTaskDto(task: LocalTask): Task {
  return stripLedgerColumns(task, 'household_id');
}

/** The detail DTO — `TaskService.getTask` composes subtasks + progress (`:465`). */
function toTaskDetailDto(task: LocalTask): Task {
  return {
    ...toTaskDto(task),
    subtasks: subtaskRowsFor(task.id).map(toSubtaskDto),
    subtask_progress: subtaskProgress(task.id),
  };
}

function toSubtaskDto(row: LocalMaintenanceSubtask): MaintenanceSubtask {
  return stripLedgerColumns(row, 'household_id');
}

function toCompletionDto(row: LocalMaintenanceCompletion): MaintenanceCompletion {
  return stripLedgerColumns(row, 'household_id', 'task_id');
}

function toNoteDto(row: LocalTaskNote): TaskNote {
  return stripLedgerColumns(row, 'household_id', 'task_id');
}

/**
 * Photo metadata for a task — port of `TaskService.syncTaskPhotos`
 * (`task-service.ts:1151`) and `buildTaskPhotoUrl` (`:1083`).
 *
 * **The BYTES are local-first now (plan §8 / H6).** They were not in Wave A:
 * keys reached us already uploaded because the picker POSTed to
 * `/tasks/photos/upload-url` first, which meant a local-first household stored
 * a key naming an R2 object its Worker never wrote — the row synced and the
 * bytes did not. `TaskFormPhotos` now seals the image through
 * `@features/house/local/blobs` and hands the descriptor down with the key, so
 * this function carries it onto the row and a synced peer can actually open the
 * photo.
 *
 * `photo_url` is the fork. For a legacy key it is still rebuilt from the same
 * `${API_URL}/files/{key}` shape the server uses. For a blob-backed photo there
 * is NO url — the bytes are AES-GCM sealed and only `resolveHouseBlobUri` can
 * produce something renderable — so it is left empty rather than fabricated.
 * An empty string is falsy at every `<Image>` call site (including the task
 * card's cover), which degrades to "no image" instead of a broken request to a
 * `/files/lf-blob/…` path that will never resolve.
 *
 * The metadata this has always owned — order, count cap, which one is the cover
 * — is unchanged, so a member who reorders photos offline still keeps that edit.
 */
function buildPhotoRows(
  photos: Array<{ photo_key: string; blob?: HouseBlobDescriptor }>,
  coverIndex: number | undefined,
): { photos: TaskPhoto[]; coverPhotoId: string | null; coverPhotoUrl: string | null } {
  if (photos.length > MAX_TASK_PHOTOS) {
    throw new Error(`A task can have at most ${MAX_TASK_PHOTOS} photos`);
  }
  const rows: TaskPhoto[] = photos.map((photo, index) => ({
    id: newLocalId('tp'),
    photo_key: photo.photo_key,
    photo_url: photo.blob ? '' : `${ENV.API_BASE_URL}/files/${photo.photo_key}`,
    sort_order: index,
    // Spread rather than `blob: photo.blob ?? null` so a legacy photo row keeps
    // exactly the four fields it has always had — the projection, the parity
    // suites and every existing snapshot compare whole rows.
    ...(photo.blob ? { blob: photo.blob } : {}),
  }));
  // Same clamp as the server (`task-service.ts:1184`): out-of-range or missing
  // index falls back to the first photo, never to "no cover".
  const clamped =
    rows.length === 0 ? -1 : Math.min(Math.max(coverIndex ?? 0, 0), rows.length - 1);
  const cover = clamped >= 0 ? rows[clamped]! : null;
  return { photos: rows, coverPhotoId: cover?.id ?? null, coverPhotoUrl: cover?.photo_url ?? null };
}

/** Apply a photo replacement to a draft row. Mirrors delete-all-then-insert. */
function applyPhotos(
  draft: LocalTask,
  photos: Array<{ photo_key: string; blob?: HouseBlobDescriptor }>,
  coverIndex: number | undefined,
): void {
  const built = buildPhotoRows(photos, coverIndex);
  draft.photos = built.photos;
  draft.cover_photo_id = built.coverPhotoId;
  draft.cover_photo_url = built.coverPhotoUrl;
}

/** A note row, shared by `addNote` and the blocker/resolution auto-notes. */
function buildNoteRow(
  householdId: string,
  taskId: string,
  kind: TaskNote['kind'],
  body: string,
): LocalTaskNote {
  return {
    id: newLocalId('note'),
    household_id: householdId,
    task_id: taskId,
    kind,
    // The server caps the column at 2000 chars (`task-service.ts:1435`).
    body: body.trim().slice(0, 2000),
    created_at: nowIso(),
    author: memberRef(getLocalHouseMemberId()),
  };
}

// ---------------------------------------------------------------------------
// TASK PLANNER
// Ported from backend/src/services/task-planner-service.ts and
// backend/src/services/time-effort.ts — keep in sync.
//
// `getPlan`/`getReport` are pure functions of rows this ledger already holds, so
// they are Tier A even though they look like server intelligence. The server's
// own header explains why they must stay deterministic: the AI estimates
// {risk, priority, effort} upstream, the SELECTION is code, so the answer is
// reproducible and cannot hallucinate a task. Running it on device keeps that
// property and makes "what can I do in 30 minutes" work in a basement with no
// signal — which is where it gets asked.
// ---------------------------------------------------------------------------

/** `time-effort.ts:21` — representative minutes per tier, planner-only. */
const EFFORT_MINUTES: Record<TimeEffort, number> = {
  quick: 15,
  short: 30,
  medium: 90,
  half_day: 240,
  all_day: 480,
};

/** `task-planner-service.ts:72`. */
const DEFAULT_TASK_MINUTES = 30;

const PRIORITY_WEIGHT: Record<TaskPrioritySeverity, number> = {
  critical: 100,
  urgent: 80,
  high: 60,
  medium: 40,
  low: 20,
  nice_to_have: 10,
};

const RISK_BOOST: Record<TaskRiskLevel, number> = {
  critical: 40,
  high: 25,
  medium: 10,
  low: 0,
};

/** `task-planner-service.ts:98`. */
function urgencyBoost(days: number | null): number {
  if (days === null) return 0;
  if (days < 0) return 50; // overdue
  if (days === 0) return 30; // due today
  if (days <= 7) return 15; // due this week
  return 0;
}

/** `task-planner-service.ts:106`. */
function scoreTask(task: LocalTask, now: Date): number {
  const priority = PRIORITY_WEIGHT[task.priority_severity ?? 'nice_to_have'] ?? 10;
  const risk = RISK_BOOST[task.risk_level ?? 'low'] ?? 0;
  return priority + risk + urgencyBoost(daysUntilDue(task.next_due_date, now));
}

function effectiveMinutes(task: LocalTask): number {
  const minutes = task.time_effort ? EFFORT_MINUTES[task.time_effort] : null;
  return typeof minutes === 'number' && minutes > 0 ? minutes : DEFAULT_TASK_MINUTES;
}

/** `task-planner-service.ts:117`. */
function reasonFor(task: LocalTask, now: Date): string {
  const days = daysUntilDue(task.next_due_date, now);
  const bits: string[] = [];
  if (days !== null) {
    if (days < 0) bits.push(`${Math.abs(days)}d overdue`);
    else if (days === 0) bits.push('due today');
    else if (days <= 7) bits.push('due this week');
  }
  if (task.risk_level === 'critical' || task.risk_level === 'high') {
    bits.push(`${task.risk_level} risk`);
  }
  if (!bits.length && task.priority_severity) bits.push(`${task.priority_severity} priority`);
  return bits.join(' • ') || 'good use of time';
}

/** Active, non-deleted tasks with their incomplete subtasks (`task-planner-service.ts:294`). */
function plannerTasks(householdId: string): LocalTask[] {
  return taskRows().filter((task) => task.household_id === householdId && task.is_active);
}

function incompleteSubtasks(taskId: string): LocalMaintenanceSubtask[] {
  return subtaskRowsFor(taskId).filter((row) => !row.is_completed);
}

/**
 * Greedy budget packing — port of `planSchedule` (`task-planner-service.ts:137`).
 *
 * The tie-break chain (score → shorter → sooner-due → id) is what makes the plan
 * reproducible across devices; `'￿'` as the missing-due-date sentinel sorts
 * undated tasks last, exactly as the server's does.
 */
function planSchedule(tasks: LocalTask[], budgetMinutes: number, now: Date): TaskBudgetPlan {
  const budget = Math.max(0, Math.round(budgetMinutes));

  const ranked = tasks
    .filter((task) => !task.blocked)
    .map((task) => ({ task, score: scoreTask(task, now), minutes: effectiveMinutes(task) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.minutes !== b.minutes) return a.minutes - b.minutes;
      const ad = a.task.next_due_date ?? '￿';
      const bd = b.task.next_due_date ?? '￿';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return a.task.id < b.task.id ? -1 : 1;
    });

  const selected: PlannedTaskItem[] = [];
  const skipped: SkippedTaskItem[] = [];
  let remaining = budget;

  for (const { task, score, minutes } of ranked) {
    if (minutes <= remaining) {
      selected.push({
        task_id: task.id,
        title: task.title,
        minutes,
        time_effort: task.time_effort ?? null,
        score,
        partial: false,
        reason: reasonFor(task, now),
      });
      remaining -= minutes;
      continue;
    }

    // Won't fit whole — schedule a prefix of its incomplete subtasks instead.
    const subs = incompleteSubtasks(task.id);
    if (subs.length > 0) {
      const perSub = Math.max(1, Math.round(minutes / subs.length));
      const fitCount = Math.min(subs.length, Math.floor(remaining / perSub));
      if (fitCount > 0) {
        const chosen = subs.slice(0, fitCount);
        const alloc = perSub * fitCount;
        selected.push({
          task_id: task.id,
          title: task.title,
          minutes: alloc,
          time_effort: task.time_effort ?? null,
          score,
          partial: true,
          subtask_ids: chosen.map((sub) => sub.id),
          reason: `${reasonFor(task, now)} — start ${fitCount} of ${subs.length} steps`,
        });
        remaining -= alloc;
        continue;
      }
    }

    skipped.push({
      task_id: task.id,
      title: task.title,
      minutes,
      time_effort: task.time_effort ?? null,
      reason: minutes > budget ? 'too_long' : 'no_time_left',
    });
  }

  return { budget_minutes: budget, used_minutes: budget - remaining, selected, skipped };
}

/** Port of `buildReport` (`task-planner-service.ts:239`). */
function buildReport(tasks: LocalTask[], now: Date, topN = 10): TaskReport {
  let overdue = 0;
  let dueToday = 0;
  let dueThisWeek = 0;
  let later = 0;
  let noDue = 0;
  let highRisk = 0;

  for (const task of tasks) {
    if (task.risk_level === 'high' || task.risk_level === 'critical') highRisk += 1;
    const days = daysUntilDue(task.next_due_date, now);
    if (days === null) noDue += 1;
    else if (days < 0) overdue += 1;
    else if (days === 0) dueToday += 1;
    else if (days <= 7) dueThisWeek += 1;
    else later += 1;
  }

  const top = tasks
    .map((task) => ({ task, score: scoreTask(task, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(({ task, score }) => ({
      task_id: task.id,
      title: task.title,
      score,
      risk_level: task.risk_level ?? null,
      priority_severity: task.priority_severity ?? null,
      time_effort: task.time_effort ?? null,
      days_until_due: daysUntilDue(task.next_due_date, now),
    }));

  return {
    generated_at: now.toISOString(),
    total_active: tasks.length,
    overdue,
    due_today: dueToday,
    due_this_week: dueThisWeek,
    later,
    no_due_date: noDue,
    high_risk: highRisk,
    top_tasks: top,
  };
}

// ---------------------------------------------------------------------------
// Subtask validation — port of SubtaskService's private validators
// (subtask-service.ts:32, :45, :55).
// ---------------------------------------------------------------------------

const REMINDER_TIME_RE = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

function validateSubtaskTitle(title: string): void {
  if (!title || title.trim().length === 0) throw new Error('Subtask title is required');
  if (title.length > 500) throw new Error('Subtask title cannot exceed 500 characters');
}

function validateSubtaskDescription(description: string | undefined): void {
  if (description && description.length > 2000) {
    throw new Error('Subtask description cannot exceed 2000 characters');
  }
}

function validateSubtaskReminder(daysBefore?: number, time?: string): void {
  if (daysBefore !== undefined && (daysBefore < 0 || daysBefore > 365)) {
    throw new Error('Reminder days before must be between 0 and 365');
  }
  if (time !== undefined && !REMINDER_TIME_RE.test(time)) {
    throw new Error('Reminder time must be in HH:MM format (24-hour)');
  }
}

function requireSubtask(taskId: string, subtaskId: string): LocalMaintenanceSubtask {
  const row = subtaskRowsFor(taskId).find((sub) => sub.id === subtaskId);
  if (!row) throw new Error('Subtask not found');
  return row;
}

/** Apply a workflow patch inside a mutator, skipping keys the action did not set. */
function applyWorkflowPatch(draft: LocalTask, patch: TaskWorkflowPatch): void {
  if (patch.workflow_stage !== undefined) draft.workflow_stage = patch.workflow_stage;
  if (patch.selected_quote_id !== undefined) draft.selected_quote_id = patch.selected_quote_id;
  if (patch.scheduled_work_date !== undefined) {
    draft.scheduled_work_date = patch.scheduled_work_date;
  }
  if (patch.scheduled_work_time_start !== undefined) {
    draft.scheduled_work_time_start = patch.scheduled_work_time_start;
  }
  if (patch.scheduled_work_time_end !== undefined) {
    draft.scheduled_work_time_end = patch.scheduled_work_time_end;
  }
}

/** Find the draft copy of a task inside a mutator. */
function draftTask(draftTasks: LocalTask[], householdId: string, taskId: string): LocalTask {
  const task = draftTasks.find((row) => row.id === taskId && row.household_id === householdId);
  if (!task) throw new Error('Maintenance task not found');
  return task;
}

// ---------------------------------------------------------------------------
// The facade
// ---------------------------------------------------------------------------

export const localTasksApi = {
  // ===== Task CRUD =====

  /**
   * `GET /tasks` — `TaskService.listTasks` (`task-service.ts:475`).
   *
   * Two server behaviours reproduced rather than improved: the default page is
   * 20 (so `DataContext`'s unparameterised call still gets 20 here, not the
   * whole ledger — H3's zero-screen-churn rule cuts both ways), and pagination
   * compares `created_at` while the sort is `next_due_date DESC`. That cursor is
   * incoherent on the server too; fixing it locally would give the two
   * implementations different page boundaries for the same household.
   */
  list: async (householdId: string, filters?: TaskFilters) => {
    const memberId = getLocalHouseMemberId();
    const limit = filters?.limit || DEFAULT_PAGE_LIMIT;

    const matched = taskRows()
      .filter((task) => task.household_id === householdId && visibleToMe(task, memberId))
      .filter((task) =>
        filters?.system_category ? task.system_category === filters.system_category : true,
      )
      .filter((task) => (filters?.is_active !== undefined ? task.is_active === filters.is_active : true))
      .filter((task) => (filters?.cursor ? task.created_at < filters.cursor : true))
      // `ORDER BY next_due_date DESC` in SQLite sorts NULL smallest, so undated
      // tasks land at the END of a descending page.
      .sort((a, b) => {
        const ad = a.next_due_date;
        const bd = b.next_due_date;
        if (ad === bd) return 0;
        if (!ad) return 1;
        if (!bd) return -1;
        return ad < bd ? 1 : -1;
      });

    const hasMore = matched.length > limit;
    const page = matched.slice(0, limit);
    return {
      tasks: page.map(toTaskDto),
      next_cursor: hasMore ? page[page.length - 1]?.created_at : undefined,
    };
  },

  /**
   * `GET /tasks/upcoming` — `TaskService.getUpcomingTasks` (`task-service.ts:548`).
   *
   * Overdue tasks are included by design (the filter is an upper bound only),
   * and rows with no due date are excluded because the server's `lte` is a SQL
   * comparison against NULL. The horizon is a date-only string compared
   * lexically, which works against both stored forms (`YYYY-MM-DD` from a picker
   * and full ISO from a completion roll) exactly as it does in D1.
   */
  getUpcoming: async (householdId: string, days: number = 7) => {
    const memberId = getLocalHouseMemberId();
    const horizon = addDays(days).split('T')[0]!;
    const tasks = taskRows()
      .filter(
        (task) =>
          task.household_id === householdId &&
          task.is_active &&
          !!task.next_due_date &&
          task.next_due_date <= horizon &&
          visibleToMe(task, memberId),
      )
      .sort((a, b) => (a.next_due_date! < b.next_due_date! ? -1 : 1));
    return { tasks: tasks.map(toTaskDto) };
  },

  /** `POST /tasks` — `TaskService.createTask` (`task-service.ts:191`). Defaults copied field for field. */
  create: async (householdId: string, data: CreateTaskInput) => {
    const memberId = getLocalHouseMemberId();
    const timestamp = nowIso();
    const task: LocalTask = {
      id: newLocalId('task'),
      household_id: householdId,
      title: data.title,
      description: data.description ?? null,
      system_category: data.system_category ?? null,
      frequency: data.frequency,
      custom_interval_days: data.custom_interval_days ?? null,
      next_due_date: data.next_due_date ?? null,
      last_completed_at: null,
      assigned_to: memberRef(data.assigned_to),
      space_id: data.space_id ?? null,
      is_active: true,
      source: 'manual',
      priority_severity: data.priority_severity ?? 'nice_to_have',
      time_effort: data.time_effort ?? null,
      // AI enrichment is Tier D on device (plan §1.2) — a manually created task
      // has no enrichment on the server either (`enrichment_status` stays NULL).
      risk_level: null,
      complexity: null,
      ai_rationale: null,
      enrichment_status: null,
      clarification_question: null,
      purchase_suggestion: null,
      blocked: false,
      blocker_reason: null,
      blocked_at: null,
      blocked_by: null,
      reminder_enabled: data.reminder_enabled ?? true,
      reminder_days_before: data.reminder_days_before ?? 1,
      reminder_time: data.reminder_time ?? '09:00',
      reminder_repeat: data.reminder_repeat ?? true,
      needs_contractor: false,
      is_personal: data.is_personal ?? false,
      created_by: memberId,
      created_at: timestamp,
      updated_at: timestamp,
      photos: [],
      cover_photo_id: null,
      cover_photo_url: null,
    };
    if (data.photos !== undefined) applyPhotos(task, data.photos, data.cover_photo_index);

    await writeLocal(
      (draft) => {
        draft.tasks.push(task);
      },
      { opType: 'TASK_CREATE', entityType: 'task', entityId: task.id, payload: { title: task.title } },
    );
    return { task: toTaskDetailDto(task) };
  },

  /**
   * `POST /tasks/quick` — `TaskService.createQuickTask` (`task-service.ts:306`).
   *
   * The capture half is exactly the point of local-first and works verbatim.
   * The enrichment half cannot: there is no queue offline and on-device
   * enrichment is H7. Rather than invent a state, this reuses the server's OWN
   * fallback for "the enrichment job could not be enqueued"
   * (`task-service.ts:381`) — `enrichment_status: 'failed'`. That branch exists
   * precisely so the card does not spin forever, and it is the one status the
   * task cards render as an ordinary, editable task.
   */
  quickCreate: async (householdId: string, data: QuickCreateTaskRequest) => {
    const memberId = getLocalHouseMemberId();
    const timestamp = nowIso();
    const cleaned = data.text.trim();
    const provisionalTitle = (cleaned.slice(0, 120) || 'New task').replace(/\s+/g, ' ');

    const task: LocalTask = {
      id: newLocalId('task'),
      household_id: householdId,
      title: provisionalTitle,
      description: null,
      system_category: null,
      frequency: 'one_time',
      custom_interval_days: null,
      next_due_date: null,
      last_completed_at: null,
      assigned_to: memberRef(data.assigned_to),
      space_id: data.space_id ?? null,
      is_active: true,
      source: 'ai_generated',
      priority_severity: 'medium',
      time_effort: null,
      risk_level: null,
      complexity: null,
      ai_rationale: null,
      enrichment_status: 'failed',
      clarification_question: null,
      purchase_suggestion: null,
      blocked: false,
      blocker_reason: null,
      blocked_at: null,
      blocked_by: null,
      reminder_enabled: true,
      reminder_days_before: 1,
      reminder_time: '09:00',
      reminder_repeat: true,
      needs_contractor: false,
      is_personal: data.is_personal ?? false,
      created_by: memberId,
      created_at: timestamp,
      updated_at: timestamp,
      photos: [],
      cover_photo_id: null,
      cover_photo_url: null,
    };

    await writeLocal(
      (draft) => {
        draft.tasks.push(task);
      },
      {
        opType: 'TASK_QUICK_CREATE',
        entityType: 'task',
        entityId: task.id,
        payload: { title: provisionalTitle },
      },
    );
    return { task: toTaskDetailDto(task) };
  },

  /** `GET /tasks/:id` — the one endpoint that composes subtasks + progress. */
  get: async (householdId: string, taskId: string) => ({
    task: toTaskDetailDto(requireTask(householdId, taskId)),
  }),

  /** `GET /tasks/plan?minutes=` — `TaskPlannerService.getPlan`. */
  getPlan: async (householdId: string, minutes: number) => {
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new Error('minutes must be a positive number');
    }
    return planSchedule(plannerTasks(householdId), minutes, new Date());
  },

  /** `GET /tasks/report` — `TaskPlannerService.getReport`. */
  getReport: async (householdId: string) => buildReport(plannerTasks(householdId), new Date()),

  // ===== Blockers + activity feed =====

  /**
   * `POST /tasks/:id/block` — `TaskService.reportBlocker` (`task-service.ts:1281`).
   *
   * The flag and the blocker note are ONE op, not two. The server writes them in
   * one request; splitting them here would let a peer receive a blocked task
   * whose activity feed does not say why, and (worse) let the two halves merge
   * against different concurrent edits.
   */
  reportBlocker: async (householdId: string, taskId: string, reason: string) => {
    requireTask(householdId, taskId);
    const memberId = getLocalHouseMemberId();
    const timestamp = nowIso();
    const note = buildNoteRow(householdId, taskId, 'blocker', reason);

    await writeLocal(
      (draft) => {
        const task = draftTask(draft.tasks, householdId, taskId);
        task.blocked = true;
        task.blocker_reason = reason.slice(0, 1000);
        task.blocked_at = timestamp;
        task.blocked_by = memberRef(memberId);
        task.updated_at = timestamp;
        draft.maintenanceTaskNotes.push(note);
      },
      { opType: 'TASK_BLOCK', entityType: 'task', entityId: taskId, payload: { noteId: note.id } },
    );
    return { task: toTaskDetailDto(requireTask(householdId, taskId)) };
  },

  /** `POST /tasks/:id/unblock` — `TaskService.resolveBlocker` (`task-service.ts:1335`). */
  resolveBlocker: async (householdId: string, taskId: string, note?: string) => {
    requireTask(householdId, taskId);
    const timestamp = nowIso();
    // Same default copy as the server (`task-service.ts:1373`).
    const row = buildNoteRow(householdId, taskId, 'resolution', note?.trim() || 'Blocker resolved');

    await writeLocal(
      (draft) => {
        const task = draftTask(draft.tasks, householdId, taskId);
        task.blocked = false;
        task.blocker_reason = null;
        task.blocked_at = null;
        task.blocked_by = null;
        task.updated_at = timestamp;
        draft.maintenanceTaskNotes.push(row);
      },
      { opType: 'TASK_UNBLOCK', entityType: 'task', entityId: taskId, payload: { noteId: row.id } },
    );
    return { task: toTaskDetailDto(requireTask(householdId, taskId)) };
  },

  // ===== Purchase → planned-spending =====

  /**
   * Tier B, and structurally so. `BudgetService.createBudgetItemFromTask`
   * (`routes/tasks.ts:168`) writes a row into the BUDGET household's ledger —
   * a different feature, a different SQLite database and a different DEK on this
   * device. Cross-ledger writes are explicitly out of Wave A (plan §6, Q11).
   */
  createBudgetItemFromTask: async () => {
    throw new HouseLocalUnsupportedError('tasks.createBudgetItemFromTask');
  },

  /**
   * `POST /tasks/:id/dismiss-purchase` — `TaskService.dismissPurchaseSuggestion`.
   *
   * The server stores a `purchase_suggestion_dismissed` flag and recomputes the
   * DTO from it (`task-purchase-suggestion.ts:56`). The ledger stores the
   * computed DTO instead (it is what `types.ts` says a row is), and the only
   * thing dismissal does to that DTO is remove it — so clearing the field is the
   * same end state by a shorter route.
   */
  dismissPurchaseSuggestion: async (householdId: string, taskId: string) => {
    requireTask(householdId, taskId);
    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const task = draftTask(draft.tasks, householdId, taskId);
        task.purchase_suggestion = null;
        task.updated_at = timestamp;
      },
      { opType: 'TASK_DISMISS_PURCHASE', entityType: 'task', entityId: taskId, payload: {} },
    );
    return { task: toTaskDetailDto(requireTask(householdId, taskId)) };
  },

  /** `GET /tasks/:id/notes` — newest first, capped at 50 (`task-service.ts:1442`). */
  listNotes: async (householdId: string, taskId: string) =>
    rowsOf<LocalTaskNote>('maintenanceTaskNotes')
      .filter((row) => row.task_id === taskId && row.household_id === householdId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, NOTES_LIMIT)
      .map(toNoteDto),

  /** `POST /tasks/:id/notes` — `TaskService.addNote` (`task-service.ts:1418`). */
  addNote: async (householdId: string, taskId: string, body: string) => {
    requireTask(householdId, taskId);
    if (!body.trim()) throw new Error('Note body is required');
    const note = buildNoteRow(householdId, taskId, 'progress', body);
    await writeLocal(
      (draft) => {
        draft.maintenanceTaskNotes.push(note);
      },
      { opType: 'TASK_NOTE_CREATE', entityType: 'taskNote', entityId: note.id, payload: {} },
    );
    return { id: note.id, created_at: note.created_at };
  },

  /**
   * `PATCH /tasks/:id` — `TaskService.updateTask` (`task-service.ts:687`).
   *
   * Only keys the caller actually sent are written. That is not just tidiness:
   * LWW is per field, so touching a column this edit did not mean to change
   * would beat a peer's concurrent edit to it with an accidental value.
   */
  update: async (householdId: string, taskId: string, data: UpdateTaskInput) => {
    requireTask(householdId, taskId);
    const timestamp = nowIso();

    await writeLocal(
      (draft) => {
        const task = draftTask(draft.tasks, householdId, taskId);
        if (data.title !== undefined) task.title = data.title;
        if (data.description !== undefined) task.description = data.description ?? null;
        if (data.system_category !== undefined) task.system_category = data.system_category ?? null;
        if (data.frequency !== undefined) task.frequency = data.frequency;
        if (data.custom_interval_days !== undefined) {
          task.custom_interval_days = data.custom_interval_days ?? null;
        }
        if (data.next_due_date !== undefined) task.next_due_date = data.next_due_date ?? null;
        if (data.assigned_to !== undefined) task.assigned_to = memberRef(data.assigned_to);
        if (data.priority_severity !== undefined) task.priority_severity = data.priority_severity;
        if (data.time_effort !== undefined) task.time_effort = data.time_effort ?? null;
        if (data.reminder_enabled !== undefined) task.reminder_enabled = data.reminder_enabled;
        if (data.reminder_days_before !== undefined) {
          task.reminder_days_before = data.reminder_days_before;
        }
        if (data.reminder_time !== undefined) task.reminder_time = data.reminder_time;
        if (data.reminder_repeat !== undefined) task.reminder_repeat = data.reminder_repeat;
        if (data.snooze_until !== undefined) task.snooze_until = data.snooze_until;
        if (data.space_id !== undefined) task.space_id = data.space_id ?? null;
        if (data.is_active !== undefined) task.is_active = data.is_active;
        if (data.is_personal !== undefined) task.is_personal = data.is_personal;
        if (data.photos !== undefined) applyPhotos(task, data.photos, data.cover_photo_index);
        task.updated_at = timestamp;
      },
      { opType: 'TASK_UPDATE', entityType: 'task', entityId: taskId, payload: {} },
    );
    return { task: toTaskDetailDto(requireTask(householdId, taskId)) };
  },

  /**
   * `DELETE /tasks/:id` — soft delete server-side, a ledger tombstone here.
   *
   * Children (subtasks, notes, completions) are deliberately left in place: the
   * server soft-deletes only the task row too, so removing them locally would
   * make the two implementations disagree about what a restore or an
   * out-of-order peer op resurrects.
   */
  delete: async (householdId: string, taskId: string): Promise<void> => {
    requireTask(householdId, taskId);
    await writeLocal(
      (draft) => {
        draft.tasks = draft.tasks.filter(
          (task) => !(task.id === taskId && task.household_id === householdId),
        );
      },
      { opType: 'TASK_DELETE', entityType: 'task', entityId: taskId, payload: {} },
    );
  },

  // ===== Completion =====

  /**
   * `POST /tasks/:id/complete` — `TaskService.completeTask` (`task-service.ts:864`).
   *
   * The completion row, the rolled `next_due_date` and the subtask reset are one
   * op, matching the one request they are on the server. The next-occurrence
   * math is `nextDueDateAfterCompletion` (`logic/recurrence.ts`), which is the
   * 30-day-month variant — see that file for why it must not be "corrected" to
   * calendar months.
   *
   * Not reproduced: the completion push to other members. Notifications are Tier
   * B and a device that is offline has nothing to send them with; the peer finds
   * out when the op syncs.
   */
  complete: async (householdId: string, taskId: string, data: CompleteTaskInput) => {
    const existing = requireTask(householdId, taskId);
    const memberId = getLocalHouseMemberId();
    const timestamp = nowIso();
    const nextDue = nextDueDateAfterCompletion(existing.frequency, existing.custom_interval_days);

    const completion: LocalMaintenanceCompletion = {
      id: newLocalId('mc'),
      household_id: householdId,
      task_id: taskId,
      completed_by: memberRef(memberId) ?? { id: memberId, display_name: null },
      completed_at: timestamp,
      notes: data.notes ?? null,
      photo_keys: data.photo_keys ?? [],
    };

    await writeLocal(
      (draft) => {
        const task = draftTask(draft.tasks, householdId, taskId);
        task.last_completed_at = timestamp;
        task.next_due_date = nextDue;
        task.updated_at = timestamp;
        draft.maintenanceCompletions.push(completion);

        // `SubtaskService.resetSubtasksForRecurrence` (`subtask-service.ts:661`)
        // — a recurring task starts its next cycle with every step open again.
        if (existing.frequency !== 'one_time' && nextDue) {
          for (const sub of draft.maintenanceSubtasks) {
            if (sub.task_id !== taskId) continue;
            sub.is_completed = false;
            sub.completed_at = null;
            sub.completed_by = null;
            sub.updated_at = timestamp;
          }
        }
      },
      {
        opType: 'TASK_COMPLETE',
        entityType: 'task',
        entityId: taskId,
        payload: { completionId: completion.id },
      },
    );

    return {
      task: toTaskDetailDto(requireTask(householdId, taskId)),
      completion: { id: completion.id, completed_at: timestamp, notes: completion.notes },
    };
  },

  /** `GET /tasks/:id/history` — `TaskService.getCompletionHistory` (`task-service.ts:987`). */
  getHistory: async (householdId: string, taskId: string, filters?: PaginationFilters) => {
    // The server re-reads the task first, so a missing/invisible task 404s
    // before the history query runs.
    requireTask(householdId, taskId);
    const limit = filters?.limit || DEFAULT_PAGE_LIMIT;
    const matched = rowsOf<LocalMaintenanceCompletion>('maintenanceCompletions')
      .filter((row) => row.task_id === taskId && row.household_id === householdId)
      .filter((row) => (filters?.cursor ? row.completed_at < filters.cursor : true))
      .sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1));

    const hasMore = matched.length > limit;
    const page = matched.slice(0, limit);
    return {
      completions: page.map(toCompletionDto),
      next_cursor: hasMore ? page[page.length - 1]?.completed_at : undefined,
    };
  },

  // ===== Quotes =====
  //
  // These three still throw, but NOT because the tables are unledgered — H11 B1
  // brought `contractors` into the ledger and B2 brought `appointments`,
  // `quotes`, `contractor_quotes` and `quote_requests`. The reason is narrower
  // and survives the activation: these methods do not read a table, they run a
  // CONVERSATION with a third party. `requestTaskQuotes` has the Worker notify
  // contractors the household does not control, `getTaskQuotes` reads what those
  // contractors sent back through it, and `compareTaskQuotesWithAI` runs a model
  // over the result. None of that has an on-device equivalent.
  //
  // What ledgering `contractor_quotes` and `quote_requests` bought is
  // convergence, not creation: a quote row a member already holds now merges on
  // a deterministic id instead of duplicating. When a device can obtain one of
  // those rows without a server, this is where the local read goes.
  //
  // Returning an empty list instead of throwing would render as "no contractor
  // has quoted you", which is the exact silence the coverage rule forbids.

  getTaskQuotes: async () => {
    throw new HouseLocalUnsupportedError('tasks.getTaskQuotes');
  },

  requestTaskQuotes: async () => {
    throw new HouseLocalUnsupportedError('tasks.requestTaskQuotes');
  },

  compareTaskQuotesWithAI: async () => {
    throw new HouseLocalUnsupportedError('tasks.compareTaskQuotesWithAI');
  },

  /**
   * `POST /tasks/:taskId/select-quote` — local, unlike its three neighbours.
   *
   * The route touches no quote service at all: it writes `selected_quote_id` and
   * a stage onto the TASK and re-reads it (`routes/tasks.ts:499`). Both are
   * ledger columns, the id comes from a list the member is already looking at,
   * and making this throw would mean a member who picked a quote online cannot
   * record that decision the moment the tunnel drops.
   */
  selectTaskQuote: async (householdId: string, taskId: string, data: { quote_id: string }) => {
    requireTask(householdId, taskId);
    const timestamp = nowIso();
    const patch = selectQuotePatch(data.quote_id);
    await writeLocal(
      (draft) => {
        const task = draftTask(draft.tasks, householdId, taskId);
        applyWorkflowPatch(task, patch);
        task.updated_at = timestamp;
      },
      {
        opType: 'TASK_SELECT_QUOTE',
        entityType: 'task',
        entityId: taskId,
        payload: { quoteId: data.quote_id },
      },
    );
    return { task: toTaskDetailDto(requireTask(householdId, taskId)) };
  },

  /** `PATCH /tasks/:taskId/workflow-stage` — see `logic/taskWorkflow.ts`. */
  updateWorkflowStage: async (
    householdId: string,
    taskId: string,
    data: { workflow_stage: string },
  ) => {
    requireTask(householdId, taskId);
    const timestamp = nowIso();
    const patch = setStagePatch(data.workflow_stage);
    await writeLocal(
      (draft) => {
        const task = draftTask(draft.tasks, householdId, taskId);
        applyWorkflowPatch(task, patch);
        task.updated_at = timestamp;
      },
      {
        opType: 'TASK_WORKFLOW_STAGE',
        entityType: 'task',
        entityId: taskId,
        payload: { stage: data.workflow_stage },
      },
    );
    return { task: toTaskDetailDto(requireTask(householdId, taskId)) };
  },

  /**
   * `POST /tasks/:taskId/schedule-work` — `routes/tasks.ts:534`.
   *
   * The task half is local; the appointment half is not written here. That was
   * forced before H11 B2 (`appointments` had no ledger array) and is now a
   * choice: the route wraps appointment creation in try/catch with the comment
   * "Don't fail the request if appointment creation fails" (`:588`), so a
   * scheduled task with no appointment row is a state the server ships too, and
   * a member who wants the booking can make it through `appointmentsApi` — which
   * is fully local since B2. Writing it from here would mean two tables in one
   * op for a route the server itself treats as best-effort.
   */
  scheduleTaskWork: async (
    householdId: string,
    taskId: string,
    data: {
      scheduled_date: string;
      scheduled_time_start?: string;
      scheduled_time_end?: string;
      contractor_id?: string;
    },
  ) => {
    requireTask(householdId, taskId);
    const timestamp = nowIso();
    const patch = scheduleWorkPatch(data);
    await writeLocal(
      (draft) => {
        const task = draftTask(draft.tasks, householdId, taskId);
        applyWorkflowPatch(task, patch);
        task.updated_at = timestamp;
      },
      {
        opType: 'TASK_SCHEDULE_WORK',
        entityType: 'task',
        entityId: taskId,
        payload: { scheduledDate: data.scheduled_date },
      },
    );
    return { task: toTaskDetailDto(requireTask(householdId, taskId)) };
  },

  // ===== Subtasks =====

  /**
   * `POST /tasks/:taskId/subtasks` — `SubtaskService.createSubtask` (`subtask-service.ts:193`).
   *
   * The sort-order rule is the server's, quirk included: an EXPLICIT
   * `sort_order: 0` is treated the same as an omitted one and re-derived as
   * `max + 1` (`subtask-service.ts:209`). A caller cannot currently insert at the
   * front, and reproducing that keeps the two implementations agreeing about
   * where a new step lands.
   */
  createSubtask: async (householdId: string, taskId: string, data: CreateSubtaskInput) => {
    const parent = requireTask(householdId, taskId);
    validateSubtaskTitle(data.title);
    validateSubtaskDescription(data.description);
    validateSubtaskReminder(data.reminder_days_before, data.reminder_time);

    const siblings = subtaskRowsFor(taskId);
    const explicit = data.sort_order;
    const sortOrder =
      explicit === undefined || explicit === 0
        ? siblings.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1
        : explicit;

    const timestamp = nowIso();
    const subtask: LocalMaintenanceSubtask = {
      id: newLocalId('sub'),
      household_id: householdId,
      task_id: taskId,
      title: data.title.trim(),
      description: data.description?.trim() || null,
      sort_order: sortOrder,
      is_completed: false,
      completed_at: null,
      completed_by: null,
      reminder_enabled: data.reminder_enabled || false,
      reminder_days_before: data.reminder_days_before || 1,
      reminder_time: data.reminder_time || '09:00',
      reminder_date: subtaskReminderDate(
        parent.next_due_date,
        data.reminder_enabled ?? false,
        data.reminder_days_before,
      ),
      created_at: timestamp,
      updated_at: timestamp,
    };

    await writeLocal(
      (draft) => {
        draft.maintenanceSubtasks.push(subtask);
      },
      { opType: 'SUBTASK_CREATE', entityType: 'subtask', entityId: subtask.id, payload: {} },
    );
    return toSubtaskDto(subtask);
  },

  /** `GET /tasks/:taskId/subtasks` — ordered by `sort_order`. */
  listSubtasks: async (householdId: string, taskId: string) => {
    requireTask(householdId, taskId);
    return subtaskRowsFor(taskId).map(toSubtaskDto);
  },

  /** `GET /tasks/:taskId/subtasks/:subtaskId`. */
  getSubtask: async (householdId: string, taskId: string, subtaskId: string) => {
    requireTask(householdId, taskId);
    return toSubtaskDto(requireSubtask(taskId, subtaskId));
  },

  /**
   * `PATCH /tasks/:taskId/subtasks/:subtaskId` — `SubtaskService.updateSubtask`.
   *
   * `reminder_date` is recomputed only when `reminder_enabled` or
   * `reminder_days_before` moved (`subtask-service.ts:374`); a title-only edit
   * must not silently re-anchor a reminder to a due date that has since changed.
   */
  updateSubtask: async (
    householdId: string,
    taskId: string,
    subtaskId: string,
    data: UpdateSubtaskInput,
  ) => {
    const parent = requireTask(householdId, taskId);
    if (data.title !== undefined) validateSubtaskTitle(data.title);
    if (data.description !== undefined) validateSubtaskDescription(data.description);
    validateSubtaskReminder(data.reminder_days_before, data.reminder_time);
    const existing = requireSubtask(taskId, subtaskId);

    const reminderEnabled = data.reminder_enabled ?? existing.reminder_enabled;
    const reminderDays = data.reminder_days_before ?? existing.reminder_days_before ?? 1;
    const recompute =
      data.reminder_enabled !== undefined || data.reminder_days_before !== undefined;
    const reminderDate = recompute
      ? subtaskReminderDate(parent.next_due_date, reminderEnabled, reminderDays)
      : existing.reminder_date;

    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const row = draft.maintenanceSubtasks.find((sub) => sub.id === subtaskId)!;
        if (data.title !== undefined) row.title = data.title.trim();
        if (data.description !== undefined) row.description = data.description?.trim() || null;
        row.reminder_enabled = reminderEnabled;
        row.reminder_days_before = reminderDays;
        if (data.reminder_time !== undefined) row.reminder_time = data.reminder_time;
        row.reminder_date = reminderDate;
        row.updated_at = timestamp;
      },
      { opType: 'SUBTASK_UPDATE', entityType: 'subtask', entityId: subtaskId, payload: {} },
    );
    return toSubtaskDto(requireSubtask(taskId, subtaskId));
  },

  /** `DELETE /tasks/:taskId/subtasks/:subtaskId` — soft delete → ledger tombstone. */
  deleteSubtask: async (householdId: string, taskId: string, subtaskId: string) => {
    requireTask(householdId, taskId);
    requireSubtask(taskId, subtaskId);
    await writeLocal(
      (draft) => {
        draft.maintenanceSubtasks = draft.maintenanceSubtasks.filter(
          (sub) => sub.id !== subtaskId,
        );
      },
      { opType: 'SUBTASK_DELETE', entityType: 'subtask', entityId: subtaskId, payload: {} },
    );
    return { message: 'Subtask deleted successfully' };
  },

  /** `POST /.../complete` — refuses a double-complete, exactly as `subtask-service.ts:490` does. */
  completeSubtask: async (householdId: string, taskId: string, subtaskId: string) => {
    requireTask(householdId, taskId);
    const existing = requireSubtask(taskId, subtaskId);
    if (existing.is_completed) throw new Error('Subtask is already completed');

    const memberId = getLocalHouseMemberId();
    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const row = draft.maintenanceSubtasks.find((sub) => sub.id === subtaskId)!;
        row.is_completed = true;
        row.completed_at = timestamp;
        row.completed_by = memberRef(memberId);
        row.updated_at = timestamp;
      },
      { opType: 'SUBTASK_COMPLETE', entityType: 'subtask', entityId: subtaskId, payload: {} },
    );
    return {
      subtask: toSubtaskDto(requireSubtask(taskId, subtaskId)),
      // The route re-reads the parent so the caller gets fresh progress.
      task: toTaskDetailDto(requireTask(householdId, taskId)),
    };
  },

  /** `POST /.../uncomplete` — refuses when it was never completed (`subtask-service.ts:544`). */
  uncompleteSubtask: async (householdId: string, taskId: string, subtaskId: string) => {
    requireTask(householdId, taskId);
    const existing = requireSubtask(taskId, subtaskId);
    if (!existing.is_completed) throw new Error('Subtask is not completed');

    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const row = draft.maintenanceSubtasks.find((sub) => sub.id === subtaskId)!;
        row.is_completed = false;
        row.completed_at = null;
        row.completed_by = null;
        row.updated_at = timestamp;
      },
      { opType: 'SUBTASK_UNCOMPLETE', entityType: 'subtask', entityId: subtaskId, payload: {} },
    );
    return {
      subtask: toSubtaskDto(requireSubtask(taskId, subtaskId)),
      task: toTaskDetailDto(requireTask(householdId, taskId)),
    };
  },

  /**
   * `POST /tasks/:taskId/subtasks/reorder` — `SubtaskService.reorderSubtasks`.
   *
   * A whole-list reorder only: the server rejects a partial array outright
   * (`subtask-service.ts:599`) because a partial reorder cannot produce a total
   * order. This is the module's one bulk write, so it goes through
   * `writeLocalBulk` — one op per chunk, never one per subtask.
   */
  reorderSubtasks: async (householdId: string, taskId: string, subtaskIds: string[]) => {
    requireTask(householdId, taskId);
    if (!subtaskIds || subtaskIds.length === 0) {
      throw new Error('Subtask IDs array cannot be empty');
    }
    const existing = subtaskRowsFor(taskId);
    if (subtaskIds.length !== existing.length) {
      throw new Error(
        `Expected ${existing.length} subtask IDs, but received ${subtaskIds.length}`,
      );
    }
    const existingIds = new Set(existing.map((row) => row.id));
    for (const id of subtaskIds) {
      if (!existingIds.has(id)) {
        throw new Error(`Subtask ${id} not found or doesn't belong to this task`);
      }
    }

    const timestamp = nowIso();
    const ordered = subtaskIds.map((id, index) => ({ id, sort_order: index }));
    await writeLocalBulk(
      ordered,
      (draft, chunk) => {
        const bySortOrder = new Map(chunk.map((entry) => [entry.id, entry.sort_order]));
        for (const row of draft.maintenanceSubtasks) {
          const next = bySortOrder.get(row.id);
          if (next === undefined) continue;
          row.sort_order = next;
          row.updated_at = timestamp;
        }
      },
      (_chunk, index) => ({
        opType: 'SUBTASK_REORDER',
        entityType: 'task',
        entityId: taskId,
        payload: { chunk: index },
      }),
    );
    return subtaskRowsFor(taskId).map(toSubtaskDto);
  },
};
