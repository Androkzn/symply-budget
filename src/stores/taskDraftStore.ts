import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type {
  TaskDraft,
  TaskDraftWithRelations,
  TaskDraftsSummary,
  TaskDraftsFilters,
} from '@api/task-drafts';

interface TaskDraftState {
  // Drafts list
  drafts: TaskDraft[];
  total: number;
  currentDraft: TaskDraftWithRelations | null;

  // Summary
  summary: TaskDraftsSummary | null;

  // Filters
  filters: TaskDraftsFilters;
  groupBy: 'none' | 'severity' | 'category' | 'timeframe';

  // Selection for bulk operations
  selectedDraftIds: string[];

  // UI State
  isLoading: boolean;
  isGenerating: boolean;
  isConverting: boolean;
  error: string | null;
}

interface TaskDraftActions {
  // Drafts
  setDrafts: (drafts: TaskDraft[], total: number) => void;
  addDraft: (draft: TaskDraft) => void;
  updateDraft: (draftId: string, updates: Partial<TaskDraft>) => void;
  removeDraft: (draftId: string) => void;
  setCurrentDraft: (draft: TaskDraftWithRelations | null) => void;

  // Summary
  setSummary: (summary: TaskDraftsSummary | null) => void;

  // Filters
  setFilters: (filters: Partial<TaskDraftsFilters>) => void;
  resetFilters: () => void;
  setGroupBy: (groupBy: 'none' | 'severity' | 'category' | 'timeframe') => void;

  // Selection
  selectDraft: (draftId: string) => void;
  deselectDraft: (draftId: string) => void;
  toggleDraftSelection: (draftId: string) => void;
  selectAllDrafts: () => void;
  clearSelection: () => void;
  selectBySeverity: (severity: string) => void;

  // UI State
  setLoading: (loading: boolean) => void;
  setGenerating: (generating: boolean) => void;
  setConverting: (converting: boolean) => void;
  setError: (error: string | null) => void;

  // Reset
  reset: () => void;
}

type TaskDraftStore = TaskDraftState & TaskDraftActions;

const defaultFilters: TaskDraftsFilters = {
  status: 'draft',
  sort_by: 'priority_score',
  sort_order: 'desc',
  limit: 100,
  offset: 0,
};

const initialState: TaskDraftState = {
  drafts: [],
  total: 0,
  currentDraft: null,
  summary: null,
  filters: defaultFilters,
  groupBy: 'none',
  selectedDraftIds: [],
  isLoading: false,
  isGenerating: false,
  isConverting: false,
  error: null,
};

export const useTaskDraftStore = create<TaskDraftStore>()(
  immer((set, _get) => ({
    ...initialState,

      // Drafts
      setDrafts: (drafts, total) =>
        set((state) => {
          state.drafts = drafts;
          state.total = total;
        }),

    addDraft: (draft) =>
      set((state) => {
        state.drafts.unshift(draft);
        state.total++;
      }),

    updateDraft: (draftId, updates) =>
      set((state) => {
        const index = state.drafts.findIndex((d) => d.id === draftId);
        if (index !== -1) {
          state.drafts[index] = { ...state.drafts[index], ...updates };
        }
        if (state.currentDraft?.id === draftId) {
          state.currentDraft = { ...state.currentDraft, ...updates };
        }
      }),

    removeDraft: (draftId) =>
      set((state) => {
        state.drafts = state.drafts.filter((d) => d.id !== draftId);
        state.total = Math.max(0, state.total - 1);
        state.selectedDraftIds = state.selectedDraftIds.filter((id) => id !== draftId);
        if (state.currentDraft?.id === draftId) {
          state.currentDraft = null;
        }
      }),

    setCurrentDraft: (draft) =>
      set((state) => {
        state.currentDraft = draft;
      }),

    // Summary
    setSummary: (summary) =>
      set((state) => {
        state.summary = summary;
      }),

    // Filters
    setFilters: (filters) =>
      set((state) => {
        state.filters = { ...state.filters, ...filters };
      }),

    resetFilters: () =>
      set((state) => {
        state.filters = defaultFilters;
        state.groupBy = 'none';
      }),

    setGroupBy: (groupBy) =>
      set((state) => {
        state.groupBy = groupBy;
      }),

    // Selection
    selectDraft: (draftId) =>
      set((state) => {
        if (!state.selectedDraftIds.includes(draftId)) {
          state.selectedDraftIds.push(draftId);
        }
      }),

    deselectDraft: (draftId) =>
      set((state) => {
        state.selectedDraftIds = state.selectedDraftIds.filter((id) => id !== draftId);
      }),

    toggleDraftSelection: (draftId) =>
      set((state) => {
        const index = state.selectedDraftIds.indexOf(draftId);
        if (index === -1) {
          state.selectedDraftIds.push(draftId);
        } else {
          state.selectedDraftIds.splice(index, 1);
        }
      }),

    selectAllDrafts: () =>
      set((state) => {
        state.selectedDraftIds = state.drafts.map((d) => d.id);
      }),

    clearSelection: () =>
      set((state) => {
        state.selectedDraftIds = [];
      }),

    selectBySeverity: (severity) =>
      set((state) => {
        const draftIds = state.drafts
          .filter((d) => d.severity === severity)
          .map((d) => d.id);
        state.selectedDraftIds = draftIds;
      }),

    // UI State
    setLoading: (loading) =>
      set((state) => {
        state.isLoading = loading;
      }),

    setGenerating: (generating) =>
      set((state) => {
        state.isGenerating = generating;
      }),

    setConverting: (converting) =>
      set((state) => {
        state.isConverting = converting;
      }),

    setError: (error) =>
      set((state) => {
        state.error = error;
      }),

      // Reset
      reset: () => set(initialState),
    }))
);

// Selectors for grouped drafts
export const selectDraftsGroupedBySeverity = (state: TaskDraftState) => {
  const groups: Record<string, TaskDraft[]> = {
    critical: [],
    major: [],
    minor: [],
    informational: [],
  };

  for (const draft of state.drafts) {
    if (groups[draft.severity]) {
      groups[draft.severity].push(draft);
    }
  }

  return groups;
};

export const selectDraftsGroupedByCategory = (state: TaskDraftState) => {
  const groups: Record<string, TaskDraft[]> = {};

  for (const draft of state.drafts) {
    if (!groups[draft.system_category]) {
      groups[draft.system_category] = [];
    }
    groups[draft.system_category].push(draft);
  }

  // Sort categories alphabetically
  return Object.fromEntries(
    Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  );
};

export const selectDraftsGroupedByTimeframe = (state: TaskDraftState) => {
  const groups: Record<string, TaskDraft[]> = {
    '0-30_days': [],
    '3-6_months': [],
    '1_year': [],
    '2-5_years': [],
    '5-10_years': [],
    unknown: [],
  };

  for (const draft of state.drafts) {
    const timeframe = draft.suggested_timeframe || 'unknown';
    if (groups[timeframe]) {
      groups[timeframe].push(draft);
    } else {
      groups.unknown.push(draft);
    }
  }

  return groups;
};

// Selector for filtered and grouped drafts
export const selectGroupedDrafts = (state: TaskDraftState) => {
  switch (state.groupBy) {
    case 'severity':
      return selectDraftsGroupedBySeverity(state);
    case 'category':
      return selectDraftsGroupedByCategory(state);
    case 'timeframe':
      return selectDraftsGroupedByTimeframe(state);
    default:
      return { all: state.drafts };
  }
};
