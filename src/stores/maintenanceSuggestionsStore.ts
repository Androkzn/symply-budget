import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { maintenanceSuggestionsApi, type SuggestionWithTemplate } from '@api/maintenance-suggestions';
import { captureException } from '@services/monitoring';

type SuggestionStatus = 'pending' | 'accepted' | 'dismissed' | 'snoozed';

interface MaintenanceSuggestionsState {
  suggestions: SuggestionWithTemplate[];
  pendingSuggestions: SuggestionWithTemplate[];
  selectedSuggestion: SuggestionWithTemplate | null;
  filterStatus: SuggestionStatus | 'all';
  isLoading: boolean;
  error: string | null;
}

interface MaintenanceSuggestionsActions {
  setSuggestions: (suggestions: SuggestionWithTemplate[]) => void;
  addSuggestion: (suggestion: SuggestionWithTemplate) => void;
  updateSuggestion: (suggestionId: string, updates: Partial<SuggestionWithTemplate>) => void;
  removeSuggestion: (suggestionId: string) => void;
  setSelectedSuggestion: (suggestion: SuggestionWithTemplate | null) => void;
  setFilterStatus: (status: SuggestionStatus | 'all') => void;
  getFilteredSuggestions: () => SuggestionWithTemplate[];
  getPendingCount: () => number;
  // Async actions that call API and update local state
  applySuggestionAsync: (
    householdId: string,
    suggestionId: string
  ) => Promise<{ success: boolean; taskIds?: string[] }>;
  dismissSuggestionAsync: (
    householdId: string,
    suggestionId: string,
    reason?: string
  ) => Promise<{ success: boolean }>;
  snoozeSuggestionAsync: (
    householdId: string,
    suggestionId: string,
    until: string
  ) => Promise<{ success: boolean }>;
  // Local-only state updates (for optimistic updates or when API already called)
  applySuggestion: (suggestionId: string) => void;
  dismissSuggestion: (suggestionId: string, reason?: string) => void;
  snoozeSuggestion: (suggestionId: string, until: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

type MaintenanceSuggestionsStore = MaintenanceSuggestionsState & MaintenanceSuggestionsActions;

const initialState: MaintenanceSuggestionsState = {
  suggestions: [],
  pendingSuggestions: [],
  selectedSuggestion: null,
  filterStatus: 'pending',
  isLoading: false,
  error: null,
};

export const useMaintenanceSuggestionsStore = create<MaintenanceSuggestionsStore>()(
  immer((set, get) => ({
    ...initialState,

      setSuggestions: (suggestions) =>
        set((state) => {
          state.suggestions = suggestions;
          state.pendingSuggestions = suggestions.filter((s) => s.status === 'pending');
        }),

      addSuggestion: (suggestion) =>
        set((state) => {
          state.suggestions.push(suggestion);
          if (suggestion.status === 'pending') {
            state.pendingSuggestions.push(suggestion);
          }
        }),

      updateSuggestion: (suggestionId, updates) =>
        set((state) => {
          const index = state.suggestions.findIndex((s) => s.id === suggestionId);
          if (index !== -1) {
            state.suggestions[index] = { ...state.suggestions[index], ...updates };
          }
          // Update pending list
          state.pendingSuggestions = state.suggestions.filter((s) => s.status === 'pending');
          if (state.selectedSuggestion?.id === suggestionId) {
            state.selectedSuggestion = { ...state.selectedSuggestion, ...updates };
          }
        }),

      removeSuggestion: (suggestionId) =>
        set((state) => {
          state.suggestions = state.suggestions.filter((s) => s.id !== suggestionId);
          state.pendingSuggestions = state.pendingSuggestions.filter((s) => s.id !== suggestionId);
          if (state.selectedSuggestion?.id === suggestionId) {
            state.selectedSuggestion = null;
          }
        }),

      setSelectedSuggestion: (suggestion) =>
        set((state) => {
          state.selectedSuggestion = suggestion;
        }),

      setFilterStatus: (status) =>
        set((state) => {
          state.filterStatus = status;
        }),

      getFilteredSuggestions: () => {
        const { suggestions, filterStatus } = get();
        if (filterStatus === 'all') {
          return suggestions;
        }
        return suggestions.filter((s) => s.status === filterStatus);
      },

      getPendingCount: () => {
        return get().pendingSuggestions.length;
      },

      // Async actions that call API and update local state
      applySuggestionAsync: async (householdId, suggestionId) => {
        try {
          set((state) => {
            state.isLoading = true;
            state.error = null;
          });
          const result = await maintenanceSuggestionsApi.applySuggestions(householdId, {
            suggestion_ids: [suggestionId],
          });
          set((state) => {
            const index = state.suggestions.findIndex((s) => s.id === suggestionId);
            if (index !== -1) {
              state.suggestions[index].status = 'accepted';
              state.suggestions[index].accepted_at = new Date().toISOString();
            }
            state.pendingSuggestions = state.suggestions.filter((s) => s.status === 'pending');
            state.isLoading = false;
          });
          return { success: true, taskIds: result.task_ids };
        } catch (error) {
          captureException(error, {
            source: 'MaintenanceSuggestionsStore',
            action: 'applySuggestionAsync',
            householdId,
            suggestionId,
          });
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : 'Failed to apply suggestion';
          });
          return { success: false };
        }
      },

      dismissSuggestionAsync: async (householdId, suggestionId, reason) => {
        try {
          set((state) => {
            state.isLoading = true;
            state.error = null;
          });
          await maintenanceSuggestionsApi.dismissSuggestion(householdId, suggestionId, { reason });
          set((state) => {
            const index = state.suggestions.findIndex((s) => s.id === suggestionId);
            if (index !== -1) {
              state.suggestions[index].status = 'dismissed';
              state.suggestions[index].dismissed_at = new Date().toISOString();
              if (reason) {
                state.suggestions[index].dismissed_reason = reason;
              }
            }
            state.pendingSuggestions = state.suggestions.filter((s) => s.status === 'pending');
            state.isLoading = false;
          });
          return { success: true };
        } catch (error) {
          captureException(error, {
            source: 'MaintenanceSuggestionsStore',
            action: 'dismissSuggestionAsync',
            householdId,
            suggestionId,
          });
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : 'Failed to dismiss suggestion';
          });
          return { success: false };
        }
      },

      snoozeSuggestionAsync: async (householdId, suggestionId, until) => {
        try {
          set((state) => {
            state.isLoading = true;
            state.error = null;
          });
          await maintenanceSuggestionsApi.snoozeSuggestion(householdId, suggestionId, {
            snooze_until: until,
          });
          set((state) => {
            const index = state.suggestions.findIndex((s) => s.id === suggestionId);
            if (index !== -1) {
              state.suggestions[index].status = 'snoozed';
              state.suggestions[index].snooze_until = until;
            }
            state.pendingSuggestions = state.suggestions.filter((s) => s.status === 'pending');
            state.isLoading = false;
          });
          return { success: true };
        } catch (error) {
          captureException(error, {
            source: 'MaintenanceSuggestionsStore',
            action: 'snoozeSuggestionAsync',
            householdId,
            suggestionId,
          });
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : 'Failed to snooze suggestion';
          });
          return { success: false };
        }
      },

      // Local-only state updates (for optimistic updates or when API already called)
      applySuggestion: (suggestionId) =>
        set((state) => {
          const index = state.suggestions.findIndex((s) => s.id === suggestionId);
          if (index !== -1) {
            state.suggestions[index].status = 'accepted';
          }
          state.pendingSuggestions = state.suggestions.filter((s) => s.status === 'pending');
        }),

      dismissSuggestion: (suggestionId, reason) =>
        set((state) => {
          const index = state.suggestions.findIndex((s) => s.id === suggestionId);
          if (index !== -1) {
            state.suggestions[index].status = 'dismissed';
            if (reason) {
              state.suggestions[index].dismissed_reason = reason;
            }
          }
          state.pendingSuggestions = state.suggestions.filter((s) => s.status === 'pending');
        }),

      snoozeSuggestion: (suggestionId, until) =>
        set((state) => {
          const index = state.suggestions.findIndex((s) => s.id === suggestionId);
          if (index !== -1) {
            state.suggestions[index].status = 'snoozed';
            state.suggestions[index].snooze_until = until;
          }
          state.pendingSuggestions = state.suggestions.filter((s) => s.status === 'pending');
        }),

      setLoading: (loading) =>
        set((state) => {
          state.isLoading = loading;
        }),

      setError: (error) =>
        set((state) => {
          state.error = error;
        }),

      reset: () => set(initialState),
    }))
);
