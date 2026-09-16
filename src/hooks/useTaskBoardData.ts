import { useMemo } from 'react';

import type { HouseholdSpace } from '@api/household-spaces';
import type { HouseholdMember } from '@api/households';
import type { Task } from '@api/tasks';
import type { TaskBoardFilters, TaskGroupBy } from '@stores/taskBoardStore';
import {
  deriveStatus,
  daysUntilDue,
  STATUS_META,
  STATUS_ORDER,
  PRIORITY_META,
  PRIORITY_ORDER,
  UNASSIGNED_KEY,
  NO_AREA_KEY,
  type TaskBoardStatus,
  type IoniconName,
} from '@utils/taskStatus';

export interface BoardSection {
  key: string;
  title: string;
  /** Ionicon shown in the header (preferred over emoji). */
  icon?: IoniconName;
  /** Custom emoji from a space; only used when no `icon` is set. */
  emoji?: string;
  /** Accent color (status/priority); undefined falls back to theme. */
  color?: string;
  tasks: Task[];
}

export interface BoardSummary {
  overdue: number;
  dueToday: number;
  mine: number;
  blocked: number;
  total: number;
}

interface UseTaskBoardDataArgs {
  tasks: Task[];
  members: HouseholdMember[];
  spaces: HouseholdSpace[];
  currentUserId?: string;
  filters: TaskBoardFilters;
  groupBy: TaskGroupBy;
  search: string;
}

interface UseTaskBoardDataResult {
  /** Tasks after all filters + search, ungrouped (board/list both derive from this). */
  filtered: Task[];
  /** Grouped sections in display order. For groupBy='status' empty columns are kept. */
  sections: BoardSection[];
  summary: BoardSummary;
}

/** Sort a section's tasks by due date ascending; no-due-date sinks to the bottom. */
function byDueDate(a: Task, b: Task): number {
  if (!a.next_due_date && !b.next_due_date) return 0;
  if (!a.next_due_date) return 1;
  if (!b.next_due_date) return -1;
  return new Date(a.next_due_date).getTime() - new Date(b.next_due_date).getTime();
}

export function useTaskBoardData({
  tasks,
  members,
  spaces,
  currentUserId,
  filters,
  groupBy,
  search,
}: UseTaskBoardDataArgs): UseTaskBoardDataResult {
  // Summary is computed over the unfiltered task set so the stat badges stay
  // stable regardless of which filters are active.
  const summary = useMemo<BoardSummary>(() => {
    let overdue = 0;
    let dueToday = 0;
    let mine = 0;
    let blocked = 0;
    for (const t of tasks) {
      if (!t.is_active) continue;
      const status = deriveStatus(t);
      if (status === 'overdue') overdue++;
      if (status === 'blocked') blocked++;
      if (daysUntilDue(t) === 0) dueToday++;
      if (currentUserId && t.assigned_to?.id === currentUserId) mine++;
    }
    return { overdue, dueToday, mine, blocked, total: tasks.length };
  }, [tasks, currentUserId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      const status = deriveStatus(t);

      if (filters.hideDone && status === 'done') return false;
      if (filters.mineOnly && t.assigned_to?.id !== currentUserId) return false;
      if (filters.dueTodayOnly && daysUntilDue(t) !== 0) return false;
      if (filters.personalOnly && !t.is_personal) return false;

      if (filters.statuses.length > 0 && !filters.statuses.includes(status)) return false;

      if (filters.assigneeIds.length > 0) {
        const key = t.assigned_to?.id ?? UNASSIGNED_KEY;
        if (!filters.assigneeIds.includes(key)) return false;
      }

      if (filters.spaceIds.length > 0) {
        const key = t.space_id ?? NO_AREA_KEY;
        if (!filters.spaceIds.includes(key)) return false;
      }

      if (filters.priorities.length > 0) {
        const p = t.priority_severity ?? 'nice_to_have';
        if (!filters.priorities.includes(p)) return false;
      }

      if (q) {
        const hay = `${t.title} ${t.description ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [tasks, filters, currentUserId, search]);

  const sections = useMemo<BoardSection[]>(() => {
    if (groupBy === 'status') {
      const buckets = new Map<TaskBoardStatus, Task[]>();
      STATUS_ORDER.forEach((s) => buckets.set(s, []));
      for (const t of filtered) buckets.get(deriveStatus(t))!.push(t);
      return STATUS_ORDER.map((s) => {
        const meta = STATUS_META[s];
        return {
          key: s,
          title: meta.label,
          icon: meta.icon,
          color: meta.color,
          tasks: buckets.get(s)!.sort(byDueDate),
        };
      });
    }

    if (groupBy === 'priority') {
      const buckets = new Map<string, Task[]>();
      for (const t of filtered) {
        const p = t.priority_severity ?? 'nice_to_have';
        (buckets.get(p) ?? buckets.set(p, []).get(p)!).push(t);
      }
      return PRIORITY_ORDER.filter((p) => buckets.has(p)).map((p) => ({
        key: p,
        title: PRIORITY_META[p].label,
        icon: PRIORITY_META[p].icon,
        color: PRIORITY_META[p].color,
        tasks: buckets.get(p)!.sort(byDueDate),
      }));
    }

    if (groupBy === 'assignee') {
      const buckets = new Map<string, Task[]>();
      for (const t of filtered) {
        const key = t.assigned_to?.id ?? UNASSIGNED_KEY;
        (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(t);
      }
      const nameFor = (id: string) => {
        if (id === UNASSIGNED_KEY) return 'Unassigned';
        const m = members.find((mm) => mm.user_id === id);
        return m?.display_name || m?.email || 'Member';
      };
      const keys = Array.from(buckets.keys()).sort((a, b) => {
        // Current user first, Unassigned last, otherwise alphabetical.
        if (a === currentUserId) return -1;
        if (b === currentUserId) return 1;
        if (a === UNASSIGNED_KEY) return 1;
        if (b === UNASSIGNED_KEY) return -1;
        return nameFor(a).localeCompare(nameFor(b));
      });
      return keys.map((id) => ({
        key: id,
        title: id === currentUserId ? `${nameFor(id)} (You)` : nameFor(id),
        icon: (id === UNASSIGNED_KEY ? 'person-circle-outline' : 'person-outline') as IoniconName,
        tasks: buckets.get(id)!.sort(byDueDate),
      }));
    }

    // groupBy === 'area'
    const buckets = new Map<string, Task[]>();
    for (const t of filtered) {
      const key = t.space_id ?? NO_AREA_KEY;
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(t);
    }
    const spaceFor = (id: string) => spaces.find((s) => s.id === id);
    const keys = Array.from(buckets.keys()).sort((a, b) => {
      if (a === NO_AREA_KEY) return 1;
      if (b === NO_AREA_KEY) return -1;
      const sa = spaceFor(a);
      const sb = spaceFor(b);
      return (sa?.display_order ?? 0) - (sb?.display_order ?? 0);
    });
    return keys.map((id) => {
      const space = spaceFor(id);
      if (id === NO_AREA_KEY) {
        return {
          key: id,
          title: 'No area',
          icon: 'home-outline' as IoniconName,
          tasks: buckets.get(id)!.sort(byDueDate),
        };
      }
      // Spaces can carry a user-chosen emoji; fall back to a location Ionicon.
      return {
        key: id,
        title: space?.name ?? 'Area',
        ...(space?.icon_emoji
          ? { emoji: space.icon_emoji }
          : { icon: 'location-outline' as IoniconName }),
        tasks: buckets.get(id)!.sort(byDueDate),
      };
    });
  }, [filtered, groupBy, members, spaces, currentUserId]);

  return { filtered, sections, summary };
}
