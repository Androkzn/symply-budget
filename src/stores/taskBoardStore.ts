import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { TaskPrioritySeverity } from '@api/tasks';
import { asyncStorage } from '@services/storage';
import type { TaskBoardStatus } from '@utils/taskStatus';

/** Default list (vertical, grouped sections) vs. Board (horizontal columns). */
export type TaskViewMode = 'list' | 'board';

/** Dimension the dashboard groups tasks by. */
export type TaskGroupBy = 'status' | 'assignee' | 'area' | 'priority';

export interface TaskBoardFilters {
  /** Only tasks assigned to the current user. */
  mineOnly: boolean;
  /** Only tasks due today (driven by the summary bar). */
  dueTodayOnly: boolean;
  /** Hide tasks whose derived status is "done". */
  hideDone: boolean;
  /** Selected assignee user ids (empty = all). May include UNASSIGNED_KEY. */
  assigneeIds: string[];
  /** Selected space/area ids (empty = all). May include NO_AREA_KEY. */
  spaceIds: string[];
  /** Selected priorities (empty = all). */
  priorities: TaskPrioritySeverity[];
  /** Selected derived statuses (empty = all). */
  statuses: TaskBoardStatus[];
  /** Only personal tasks (created by the current user and marked private). */
  personalOnly: boolean;
}

interface TaskBoardState {
  viewMode: TaskViewMode;
  groupBy: TaskGroupBy;
  filters: TaskBoardFilters;
  setViewMode: (mode: TaskViewMode) => void;
  setGroupBy: (groupBy: TaskGroupBy) => void;
  toggleMineOnly: () => void;
  toggleDueTodayOnly: () => void;
  toggleHideDone: () => void;
  togglePersonalOnly: () => void;
  toggleStatus: (status: TaskBoardStatus) => void;
  setAssigneeIds: (ids: string[]) => void;
  setSpaceIds: (ids: string[]) => void;
  setPriorities: (p: TaskPrioritySeverity[]) => void;
  setStatuses: (s: TaskBoardStatus[]) => void;
  clearFilters: () => void;
}

const emptyFilters: TaskBoardFilters = {
  mineOnly: false,
  dueTodayOnly: false,
  hideDone: false,
  assigneeIds: [],
  spaceIds: [],
  priorities: [],
  statuses: [],
  personalOnly: false,
};

/** True when any narrowing filter is active (drives the "Clear" affordance). */
export function hasActiveFilters(f: TaskBoardFilters): boolean {
  return (
    f.mineOnly ||
    f.dueTodayOnly ||
    f.hideDone ||
    f.personalOnly ||
    f.assigneeIds.length > 0 ||
    f.spaceIds.length > 0 ||
    f.priorities.length > 0 ||
    f.statuses.length > 0
  );
}

export const useTaskBoardStore = create<TaskBoardState>()(
  persist(
    (set) => ({
      viewMode: 'list',
      groupBy: 'status',
      filters: emptyFilters,
      setViewMode: (viewMode) => set({ viewMode }),
      setGroupBy: (groupBy) => set({ groupBy }),
      toggleMineOnly: () =>
        set((s) => ({ filters: { ...s.filters, mineOnly: !s.filters.mineOnly } })),
      toggleDueTodayOnly: () =>
        set((s) => ({ filters: { ...s.filters, dueTodayOnly: !s.filters.dueTodayOnly } })),
      toggleHideDone: () =>
        set((s) => ({ filters: { ...s.filters, hideDone: !s.filters.hideDone } })),
      togglePersonalOnly: () =>
        set((s) => ({ filters: { ...s.filters, personalOnly: !s.filters.personalOnly } })),
      toggleStatus: (status) =>
        set((s) => ({
          filters: {
            ...s.filters,
            statuses: s.filters.statuses.includes(status)
              ? s.filters.statuses.filter((x) => x !== status)
              : [...s.filters.statuses, status],
          },
        })),
      setAssigneeIds: (assigneeIds) =>
        set((s) => ({ filters: { ...s.filters, assigneeIds } })),
      setSpaceIds: (spaceIds) => set((s) => ({ filters: { ...s.filters, spaceIds } })),
      setPriorities: (priorities) => set((s) => ({ filters: { ...s.filters, priorities } })),
      setStatuses: (statuses) => set((s) => ({ filters: { ...s.filters, statuses } })),
      clearFilters: () => set({ filters: emptyFilters }),
    }),
    {
      name: 'task-board-prefs',
      storage: createJSONStorage(() => asyncStorage),
    }
  )
);
