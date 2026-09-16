import { Ionicons } from '@expo/vector-icons';

import type { Task, TaskPrioritySeverity } from '@api/tasks';

export type IoniconName = keyof typeof Ionicons.glyphMap;

/**
 * Canonical board status for a task.
 *
 * The backend has NO single `status` column — task state is a composite of
 * `is_active`, `workflow_stage` (contractor path only), `blocked`,
 * `last_completed_at` and `next_due_date`. This module collapses that into one
 * enum so the Tasks dashboard can group/column tasks consistently. It is
 * derived purely on the client (zero migration); persisting a real status is a
 * future enhancement that would let the board support drag-to-change.
 */
export type TaskBoardStatus = 'overdue' | 'todo' | 'in_progress' | 'blocked' | 'done';

/** Workflow stages that mean "actively being worked" (contractor path). */
const IN_PROGRESS_STAGES = new Set([
  'getting_quotes',
  'comparing_quotes',
  'quote_selected',
  'scheduled',
  'in_progress',
]);

const DAY_MS = 1000 * 60 * 60 * 24;

/** Whole-day delta from now to the due date (negative = overdue). */
export function daysUntilDue(task: Pick<Task, 'next_due_date'>): number | null {
  if (!task.next_due_date) return null;
  const days = Math.ceil(
    (new Date(task.next_due_date).getTime() - Date.now()) / DAY_MS,
  );
  // Math.ceil yields -0 when the due time is a few ms into today's past; callers
  // and the UI should see a plain 0 ("due today"), and 0 !== -0 under Object.is.
  return days === 0 ? 0 : days;
}

/** A task completed within the last 7 days reads as "done" on the board. */
export function isRecentlyCompleted(task: Pick<Task, 'last_completed_at'>): boolean {
  if (!task.last_completed_at) return false;
  const diff = Date.now() - new Date(task.last_completed_at).getTime();
  return diff >= 0 && diff <= 7 * DAY_MS;
}

/**
 * Collapse a task's composite state into one board status.
 * Order matters: archived/blocked/done take precedence over due-date buckets.
 */
export function deriveStatus(task: Task): TaskBoardStatus {
  if (!task.is_active) return 'done';
  if (task.blocked) return 'blocked';
  if (isRecentlyCompleted(task)) return 'done';
  if (task.workflow_stage && IN_PROGRESS_STAGES.has(task.workflow_stage)) return 'in_progress';
  const days = daysUntilDue(task);
  if (days !== null && days < 0) return 'overdue';
  return 'todo';
}

export interface StatusMeta {
  status: TaskBoardStatus;
  label: string;
  /** Ionicon rendered in section/column headers (replaces legacy emoji). */
  icon: IoniconName;
  /** Accent color used for headers, column rails and dots. */
  color: string;
  /** Soft tint for column backgrounds / chips. */
  tint: string;
  /** Display order for sections & board columns. */
  order: number;
}

export const STATUS_META: Record<TaskBoardStatus, StatusMeta> = {
  overdue: {
    status: 'overdue',
    label: 'Overdue',
    icon: 'alert-circle',
    color: '#DC2626',
    tint: 'rgba(239, 68, 68, 0.10)',
    order: 0,
  },
  todo: {
    status: 'todo',
    label: 'To Do',
    icon: 'ellipse-outline',
    color: '#2563EB',
    tint: 'rgba(37, 99, 235, 0.08)',
    order: 1,
  },
  in_progress: {
    status: 'in_progress',
    label: 'In Progress',
    icon: 'time',
    color: '#D97706',
    tint: 'rgba(217, 119, 6, 0.10)',
    order: 2,
  },
  blocked: {
    status: 'blocked',
    label: 'Blocked',
    icon: 'remove-circle',
    color: '#B91C1C',
    tint: 'rgba(185, 28, 28, 0.10)',
    order: 3,
  },
  done: {
    status: 'done',
    label: 'Done',
    icon: 'checkmark-circle',
    color: '#16A34A',
    tint: 'rgba(34, 197, 94, 0.10)',
    order: 4,
  },
};

/** Board column / section order. */
export const STATUS_ORDER: TaskBoardStatus[] = (
  Object.values(STATUS_META) as StatusMeta[]
)
  .sort((a, b) => a.order - b.order)
  .map((m) => m.status);

export const PRIORITY_META: Record<
  TaskPrioritySeverity,
  { label: string; icon: IoniconName; color: string; order: number }
> = {
  critical: { label: 'Critical', icon: 'alert-circle', color: '#DC2626', order: 0 },
  urgent: { label: 'Urgent', icon: 'warning', color: '#EA580C', order: 1 },
  high: { label: 'High', icon: 'arrow-up-circle', color: '#D97706', order: 2 },
  medium: { label: 'Medium', icon: 'remove-circle', color: '#2563EB', order: 3 },
  low: { label: 'Low', icon: 'arrow-down-circle', color: '#64748B', order: 4 },
  nice_to_have: { label: 'Nice to Have', icon: 'leaf', color: '#16A34A', order: 5 },
};

export const PRIORITY_ORDER: TaskPrioritySeverity[] = (
  Object.entries(PRIORITY_META) as [TaskPrioritySeverity, { order: number }][]
)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([k]) => k);

export const UNASSIGNED_KEY = '__unassigned__';
export const NO_AREA_KEY = '__no_area__';
