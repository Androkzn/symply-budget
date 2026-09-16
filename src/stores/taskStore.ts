import { Platform } from 'react-native';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { QuoteWithDetails } from '@api/quotes';
import type { AIQuoteComparison } from '@api/quotes';
import type { Task, MaintenanceSubtask, TaskWorkflowStage } from '@api/tasks';
import { watchSyncService } from '@services/watch-sync';

interface TaskState {
  // Tasks
  maintenanceTasks: Task[];
  upcomingTasks: Task[];
  currentMaintenanceTask: Task | null;

  // Quote Management
  taskQuotes: Record<string, QuoteWithDetails[]>; // taskId -> quotes
  aiComparisons: Record<string, AIQuoteComparison>; // taskId -> AI analysis

  // UI State
  isLoading: boolean;
  error: string | null;
  selectedTimeframe: '0-30_days' | '3-6_months' | '1_year' | '2-5_years' | '5-10_years' | null;

  // Navigation State
  pendingTaskNavigation: string | null;
}

interface TaskActions {
  // Tasks
  setMaintenanceTasks: (tasks: Task[]) => void;
  addMaintenanceTask: (task: Task) => void;
  updateMaintenanceTask: (taskId: string, updates: Partial<Task>) => void;
  removeMaintenanceTask: (taskId: string) => void;
  setUpcomingTasks: (tasks: Task[]) => void;
  setCurrentMaintenanceTask: (task: Task | null) => void;

  // Quote Management
  setTaskQuotes: (taskId: string, quotes: QuoteWithDetails[]) => void;
  addTaskQuote: (taskId: string, quote: QuoteWithDetails) => void;
  setAIComparison: (taskId: string, comparison: AIQuoteComparison) => void;
  updateTaskWorkflowStage: (taskId: string, stage: TaskWorkflowStage) => void;
  selectQuoteForTask: (taskId: string, quoteId: string) => void;

  // Subtask Management
  addSubtask: (taskId: string, subtask: MaintenanceSubtask) => void;
  updateSubtask: (taskId: string, subtaskId: string, updates: Partial<MaintenanceSubtask>) => void;
  removeSubtask: (taskId: string, subtaskId: string) => void;
  updateTaskWithSubtasks: (taskId: string, task: Task) => void;

  // UI State
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSelectedTimeframe: (
    timeframe: '0-30_days' | '3-6_months' | '1_year' | '2-5_years' | '5-10_years' | null
  ) => void;
  reset: () => void;

  // Navigation
  setPendingTaskNavigation: (taskId: string | null) => void;
}

type TaskStore = TaskState & TaskActions;

const initialState: TaskState = {
  maintenanceTasks: [],
  upcomingTasks: [],
  currentMaintenanceTask: null,
  taskQuotes: {},
  aiComparisons: {},
  isLoading: false,
  error: null,
  selectedTimeframe: null,
  pendingTaskNavigation: null,
};

export const useTaskStore = create<TaskStore>()(
  immer((set) => ({
    ...initialState,

    // Tasks
    setMaintenanceTasks: (tasks) => {
      set((state) => {
        state.maintenanceTasks = tasks;
      });

      // Sync to Apple Watch (iOS only)
      if (Platform.OS === 'ios') {
        watchSyncService.syncTasks(tasks);
      }
    },

    addMaintenanceTask: (task) => {
      set((state) => {
        state.maintenanceTasks.unshift(task);
      });

      // Sync to Apple Watch (iOS only)
      if (Platform.OS === 'ios') {
        const tasks = useTaskStore.getState().maintenanceTasks;
        watchSyncService.syncTasks(tasks);
      }
    },

    updateMaintenanceTask: (taskId, updates) => {
      set((state) => {
        const index = state.maintenanceTasks.findIndex((t) => t.id === taskId);
        if (index !== -1) {
          state.maintenanceTasks[index] = {
            ...state.maintenanceTasks[index],
            ...updates,
          };
        }
        // Also update in upcoming tasks
        const upcomingIndex = state.upcomingTasks.findIndex((t) => t.id === taskId);
        if (upcomingIndex !== -1) {
          state.upcomingTasks[upcomingIndex] = {
            ...state.upcomingTasks[upcomingIndex],
            ...updates,
          };
        }
        if (state.currentMaintenanceTask?.id === taskId) {
          state.currentMaintenanceTask = {
            ...state.currentMaintenanceTask,
            ...updates,
          };
        }
      });

      // Sync to Apple Watch (iOS only)
      if (Platform.OS === 'ios') {
        const tasks = useTaskStore.getState().maintenanceTasks;
        watchSyncService.syncTasks(tasks);
      }
    },

    removeMaintenanceTask: (taskId) => {
      set((state) => {
        state.maintenanceTasks = state.maintenanceTasks.filter(
          (t) => t.id !== taskId
        );
        state.upcomingTasks = state.upcomingTasks.filter((t) => t.id !== taskId);
        if (state.currentMaintenanceTask?.id === taskId) {
          state.currentMaintenanceTask = null;
        }
      });

      // Sync to Apple Watch (iOS only)
      if (Platform.OS === 'ios') {
        const tasks = useTaskStore.getState().maintenanceTasks;
        watchSyncService.syncTasks(tasks);
      }
    },

    setUpcomingTasks: (tasks) =>
      set((state) => {
        state.upcomingTasks = tasks;
      }),

    setCurrentMaintenanceTask: (task) =>
      set((state) => {
        state.currentMaintenanceTask = task;
      }),

    // Quote Management
    setTaskQuotes: (taskId, quotes) =>
      set((state) => {
        state.taskQuotes[taskId] = quotes;
      }),

    addTaskQuote: (taskId, quote) =>
      set((state) => {
        if (!state.taskQuotes[taskId]) {
          state.taskQuotes[taskId] = [];
        }
        state.taskQuotes[taskId].push(quote);
      }),

    setAIComparison: (taskId, comparison) =>
      set((state) => {
        state.aiComparisons[taskId] = comparison;
      }),

    updateTaskWorkflowStage: (taskId, stage) =>
      set((state) => {
        const index = state.maintenanceTasks.findIndex((t) => t.id === taskId);
        if (index !== -1) {
          state.maintenanceTasks[index].workflow_stage = stage;
        }
        const upcomingIndex = state.upcomingTasks.findIndex((t) => t.id === taskId);
        if (upcomingIndex !== -1) {
          state.upcomingTasks[upcomingIndex].workflow_stage = stage;
        }
        if (state.currentMaintenanceTask?.id === taskId) {
          state.currentMaintenanceTask.workflow_stage = stage;
        }
      }),

    selectQuoteForTask: (taskId, quoteId) =>
      set((state) => {
        const index = state.maintenanceTasks.findIndex((t) => t.id === taskId);
        if (index !== -1) {
          state.maintenanceTasks[index].selected_quote_id = quoteId;
          state.maintenanceTasks[index].workflow_stage = 'quote_selected';
        }
        const upcomingIndex = state.upcomingTasks.findIndex((t) => t.id === taskId);
        if (upcomingIndex !== -1) {
          state.upcomingTasks[upcomingIndex].selected_quote_id = quoteId;
          state.upcomingTasks[upcomingIndex].workflow_stage = 'quote_selected';
        }
        if (state.currentMaintenanceTask?.id === taskId) {
          state.currentMaintenanceTask.selected_quote_id = quoteId;
          state.currentMaintenanceTask.workflow_stage = 'quote_selected';
        }
      }),

    // Subtask Management
    addSubtask: (taskId, subtask) =>
      set((state) => {
        // Update main tasks array
        const taskIndex = state.maintenanceTasks.findIndex((t) => t.id === taskId);
        if (taskIndex !== -1) {
          const task = state.maintenanceTasks[taskIndex];
          task.subtasks = task.subtasks || [];
          task.subtasks.push(subtask);
          // Recalculate progress
          const completed = task.subtasks.filter((s) => s.is_completed).length;
          task.subtask_progress = {
            completed,
            total: task.subtasks.length,
            percentage: Math.round((completed / task.subtasks.length) * 100),
          };
        }

        // Update upcoming tasks array
        const upcomingIndex = state.upcomingTasks.findIndex((t) => t.id === taskId);
        if (upcomingIndex !== -1) {
          const task = state.upcomingTasks[upcomingIndex];
          task.subtasks = task.subtasks || [];
          task.subtasks.push(subtask);
          const completed = task.subtasks.filter((s) => s.is_completed).length;
          task.subtask_progress = {
            completed,
            total: task.subtasks.length,
            percentage: Math.round((completed / task.subtasks.length) * 100),
          };
        }

        // Update current task
        if (state.currentMaintenanceTask?.id === taskId) {
          const task = state.currentMaintenanceTask;
          task.subtasks = task.subtasks || [];
          task.subtasks.push(subtask);
          const completed = task.subtasks.filter((s) => s.is_completed).length;
          task.subtask_progress = {
            completed,
            total: task.subtasks.length,
            percentage: Math.round((completed / task.subtasks.length) * 100),
          };
        }
      }),

    updateSubtask: (taskId, subtaskId, updates) =>
      set((state) => {
        // Helper to update subtask in a task's subtasks array
        const updateTaskSubtask = (task: Task) => {
          if (!task.subtasks) return;
          const subtaskIndex = task.subtasks.findIndex((s) => s.id === subtaskId);
          if (subtaskIndex !== -1) {
            task.subtasks[subtaskIndex] = {
              ...task.subtasks[subtaskIndex],
              ...updates,
            };
            // Recalculate progress
            const completed = task.subtasks.filter((s) => s.is_completed).length;
            task.subtask_progress = {
              completed,
              total: task.subtasks.length,
              percentage: Math.round((completed / task.subtasks.length) * 100),
            };
          }
        };

        // Update main tasks array
        const taskIndex = state.maintenanceTasks.findIndex((t) => t.id === taskId);
        if (taskIndex !== -1) {
          updateTaskSubtask(state.maintenanceTasks[taskIndex]);
        }

        // Update upcoming tasks array
        const upcomingIndex = state.upcomingTasks.findIndex((t) => t.id === taskId);
        if (upcomingIndex !== -1) {
          updateTaskSubtask(state.upcomingTasks[upcomingIndex]);
        }

        // Update current task
        if (state.currentMaintenanceTask?.id === taskId) {
          updateTaskSubtask(state.currentMaintenanceTask);
        }
      }),

    removeSubtask: (taskId, subtaskId) =>
      set((state) => {
        // Helper to remove subtask from a task's subtasks array
        const removeTaskSubtask = (task: Task) => {
          if (!task.subtasks) return;
          task.subtasks = task.subtasks.filter((s) => s.id !== subtaskId);
          // Recalculate progress
          const completed = task.subtasks.filter((s) => s.is_completed).length;
          const total = task.subtasks.length;
          task.subtask_progress =
            total > 0
              ? {
                  completed,
                  total,
                  percentage: Math.round((completed / total) * 100),
                }
              : undefined;
        };

        // Update main tasks array
        const taskIndex = state.maintenanceTasks.findIndex((t) => t.id === taskId);
        if (taskIndex !== -1) {
          removeTaskSubtask(state.maintenanceTasks[taskIndex]);
        }

        // Update upcoming tasks array
        const upcomingIndex = state.upcomingTasks.findIndex((t) => t.id === taskId);
        if (upcomingIndex !== -1) {
          removeTaskSubtask(state.upcomingTasks[upcomingIndex]);
        }

        // Update current task
        if (state.currentMaintenanceTask?.id === taskId) {
          removeTaskSubtask(state.currentMaintenanceTask);
        }
      }),

    updateTaskWithSubtasks: (taskId, task) =>
      set((state) => {
        // Update main tasks array
        const taskIndex = state.maintenanceTasks.findIndex((t) => t.id === taskId);
        if (taskIndex !== -1) {
          state.maintenanceTasks[taskIndex] = task;
        }

        // Update upcoming tasks array
        const upcomingIndex = state.upcomingTasks.findIndex((t) => t.id === taskId);
        if (upcomingIndex !== -1) {
          state.upcomingTasks[upcomingIndex] = task;
        }

        // Update current task
        if (state.currentMaintenanceTask?.id === taskId) {
          state.currentMaintenanceTask = task;
        }
      }),

    // UI State
    setLoading: (loading) =>
      set((state) => {
        state.isLoading = loading;
      }),

    setError: (error) =>
      set((state) => {
        state.error = error;
      }),

    setSelectedTimeframe: (timeframe) =>
      set((state) => {
        state.selectedTimeframe = timeframe;
      }),

    // Navigation
    setPendingTaskNavigation: (taskId) =>
      set((state) => {
        state.pendingTaskNavigation = taskId;
      }),

    reset: () => set(initialState),
  }))
);
