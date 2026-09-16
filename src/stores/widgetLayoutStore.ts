import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { MainTabParamList } from '@navigation/types';
import { settingsSync } from '@services/settings-sync';
import type { IoniconName } from '@utils/categoryIcons';

export enum WidgetType {
  TODO_LIST = 'todo_list',
  MAINTENANCE_TIPS = 'maintenance_tips',
  SERVICE_HISTORY = 'service_history',
  FIND_PRO = 'find_pro',
  REPORTS = 'reports',
  REMINDERS = 'reminders',
  CALENDAR = 'calendar',
  SCHEDULE_TASK = 'schedule_task',
  APPLIANCES = 'appliances',
  GARBAGE_SCHEDULE = 'garbage_schedule',
  SEASONAL_CHECKLIST = 'seasonal_checklist',
}

export interface WidgetMetadata {
  id: WidgetType;
  displayName: string;
  icon: IoniconName;
  color: string;
  gradientColors: [string, string];
  navigationTarget?: keyof MainTabParamList;
  minDeviceType?: 'phone' | 'tablet';
}

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  order: number;
  isVisible: boolean;
}

interface WidgetLayoutState {
  widgets: WidgetConfig[];
  lastModified: number | null;
  isEditMode: boolean;
  isHydrated: boolean;
}

interface WidgetLayoutActions {
  updateWidgetOrder: (widgets: WidgetConfig[]) => void;
  toggleWidgetVisibility: (widgetId: string) => void;
  addWidget: (widgetType: WidgetType) => void;
  removeWidget: (widgetId: string) => void;
  resetToDefaults: () => void;
  getVisibleWidgets: () => WidgetConfig[];
  getHiddenWidgets: () => WidgetConfig[];
  setEditMode: (isEditMode: boolean) => void;
  hydrate: (settings: { widgets?: WidgetConfig[]; lastModified?: number | null }) => void;
  setHydrated: (hydrated: boolean) => void;
}

// Widget metadata registry
export const WIDGET_METADATA: Record<WidgetType, WidgetMetadata> = {
  [WidgetType.TODO_LIST]: {
    id: WidgetType.TODO_LIST,
    displayName: 'To-Do List',
    icon: 'list',
    color: '#4A90D9',
    gradientColors: ['#5B9FE3', '#3A7FC9'],
    navigationTarget: 'Tasks',
  },
  [WidgetType.MAINTENANCE_TIPS]: {
    id: WidgetType.MAINTENANCE_TIPS,
    displayName: 'Maintenance Tips',
    icon: 'construct',
    color: '#8BC34A',
    gradientColors: ['#9ACD59', '#7BB33A'],
  },
  [WidgetType.SERVICE_HISTORY]: {
    id: WidgetType.SERVICE_HISTORY,
    displayName: 'Service History',
    icon: 'document-text',
    color: '#FFB300',
    gradientColors: ['#FFC020', '#E9A300'],
    navigationTarget: 'Reports',
  },
  [WidgetType.FIND_PRO]: {
    id: WidgetType.FIND_PRO,
    displayName: 'Find a Pro',
    icon: 'people',
    color: '#5DADE2',
    gradientColors: ['#6DBDEC', '#4D9DD2'],
  },
  [WidgetType.REPORTS]: {
    id: WidgetType.REPORTS,
    displayName: 'Reports',
    icon: 'bar-chart',
    color: '#9B59B6',
    gradientColors: ['#AB69C6', '#8B49A6'],
    navigationTarget: 'Reports',
    minDeviceType: 'tablet',
  },
  [WidgetType.REMINDERS]: {
    id: WidgetType.REMINDERS,
    displayName: 'Reminders',
    icon: 'notifications',
    color: '#E74C3C',
    gradientColors: ['#F75C4C', '#D73C2C'],
    minDeviceType: 'tablet',
  },
  [WidgetType.CALENDAR]: {
    id: WidgetType.CALENDAR,
    displayName: 'Calendar',
    icon: 'calendar',
    color: '#1ABC9C',
    gradientColors: ['#2ACCAC', '#0AAC8C'],
    minDeviceType: 'tablet',
  },
  [WidgetType.SCHEDULE_TASK]: {
    id: WidgetType.SCHEDULE_TASK,
    displayName: 'Schedule Task',
    icon: 'add-circle',
    color: '#3498DB',
    gradientColors: ['#44A8EB', '#2488CB'],
  },
  [WidgetType.APPLIANCES]: {
    id: WidgetType.APPLIANCES,
    displayName: 'My Appliances',
    icon: 'tv',
    color: '#E91E63',
    gradientColors: ['#F02E73', '#D90E53'],
  },
  [WidgetType.GARBAGE_SCHEDULE]: {
    id: WidgetType.GARBAGE_SCHEDULE,
    displayName: 'Garbage Day',
    icon: 'trash',
    color: '#607D8B',
    gradientColors: ['#708D9B', '#506D7B'],
  },
  [WidgetType.SEASONAL_CHECKLIST]: {
    id: WidgetType.SEASONAL_CHECKLIST,
    displayName: 'Seasonal Prep',
    icon: 'leaf',
    color: '#FF9800',
    gradientColors: ['#FFA810', '#E98800'],
  },
};

// Use stable IDs to avoid getSnapshot warning
const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'widget-todo-list', type: WidgetType.TODO_LIST, order: 0, isVisible: true },
  { id: 'widget-garbage-schedule', type: WidgetType.GARBAGE_SCHEDULE, order: 1, isVisible: true },
  { id: 'widget-seasonal-checklist', type: WidgetType.SEASONAL_CHECKLIST, order: 2, isVisible: true },
  { id: 'widget-appliances', type: WidgetType.APPLIANCES, order: 3, isVisible: true },
  { id: 'widget-maintenance-tips', type: WidgetType.MAINTENANCE_TIPS, order: 4, isVisible: true },
  { id: 'widget-service-history', type: WidgetType.SERVICE_HISTORY, order: 5, isVisible: true },
  { id: 'widget-find-pro', type: WidgetType.FIND_PRO, order: 6, isVisible: true },
  { id: 'widget-reports', type: WidgetType.REPORTS, order: 7, isVisible: false },
  { id: 'widget-reminders', type: WidgetType.REMINDERS, order: 8, isVisible: false },
  { id: 'widget-calendar', type: WidgetType.CALENDAR, order: 9, isVisible: false },
  { id: 'widget-schedule-task', type: WidgetType.SCHEDULE_TASK, order: 10, isVisible: false },
];

export const useWidgetLayoutStore = create<WidgetLayoutState & WidgetLayoutActions>()(
  immer((set, get) => ({
    widgets: DEFAULT_WIDGETS,
    lastModified: null,
    isEditMode: false,
    isHydrated: false,

    updateWidgetOrder: (widgets) => {
      set((state) => {
        state.widgets = widgets.map((w, index) => ({ ...w, order: index }));
        state.lastModified = Date.now();
      });
      // Sync to database
      const state = get();
      settingsSync.queueSync('widgets.layout', state.widgets);
      settingsSync.queueSync('widgets.lastModified', state.lastModified);
    },

    setEditMode: (isEditMode) =>
      set((state) => {
        state.isEditMode = isEditMode;
        // Note: isEditMode is transient state, don't sync to DB
      }),

    toggleWidgetVisibility: (widgetId) => {
      set((state) => {
        const widget = state.widgets.find((w) => w.id === widgetId);
        if (widget) {
          widget.isVisible = !widget.isVisible;
          // Reorder: visible widgets first, then hidden
          state.widgets.sort((a, b) => {
            if (a.isVisible === b.isVisible) return a.order - b.order;
            return a.isVisible ? -1 : 1;
          });
          // Reassign order numbers
          state.widgets = state.widgets.map((w, index) => ({ ...w, order: index }));
          state.lastModified = Date.now();
        }
      });
      // Sync to database
      const state = get();
      settingsSync.queueSync('widgets.layout', state.widgets);
      settingsSync.queueSync('widgets.lastModified', state.lastModified);
    },

    addWidget: (widgetType) => {
      set((state) => {
        // Check if widget of this type already exists
        const existingWidget = state.widgets.find((w) => w.type === widgetType);
        if (existingWidget) {
          existingWidget.isVisible = true;
        } else {
          // Add new widget
          const visibleCount = state.widgets.filter((w) => w.isVisible).length;
          state.widgets.push({
            id: uuidv4(),
            type: widgetType,
            order: visibleCount,
            isVisible: true,
          });
        }
        // Reorder
        state.widgets.sort((a, b) => {
          if (a.isVisible === b.isVisible) return a.order - b.order;
          return a.isVisible ? -1 : 1;
        });
        state.widgets = state.widgets.map((w, index) => ({ ...w, order: index }));
        state.lastModified = Date.now();
      });
      // Sync to database
      const state = get();
      settingsSync.queueSync('widgets.layout', state.widgets);
      settingsSync.queueSync('widgets.lastModified', state.lastModified);
    },

    removeWidget: (widgetId) => {
      set((state) => {
        const widget = state.widgets.find((w) => w.id === widgetId);
        if (widget) {
          widget.isVisible = false;
          // Reorder
          state.widgets.sort((a, b) => {
            if (a.isVisible === b.isVisible) return a.order - b.order;
            return a.isVisible ? -1 : 1;
          });
          state.widgets = state.widgets.map((w, index) => ({ ...w, order: index }));
          state.lastModified = Date.now();
        }
      });
      // Sync to database
      const state = get();
      settingsSync.queueSync('widgets.layout', state.widgets);
      settingsSync.queueSync('widgets.lastModified', state.lastModified);
    },

    resetToDefaults: () => {
      set((state) => {
        state.widgets = DEFAULT_WIDGETS;
        state.lastModified = Date.now();
      });
      // Sync to database
      settingsSync.queueSync('widgets.layout', DEFAULT_WIDGETS);
      settingsSync.queueSync('widgets.lastModified', Date.now());
    },

    getVisibleWidgets: () => {
      return get()
        .widgets.filter((w) => w.isVisible)
        .sort((a, b) => a.order - b.order);
    },

    getHiddenWidgets: () => {
      return get()
        .widgets.filter((w) => !w.isVisible)
        .sort((a, b) => a.order - b.order);
    },

    hydrate: (settings) =>
      set((state) => {
        if (settings.widgets !== undefined) {
          state.widgets = settings.widgets;
        }
        if (settings.lastModified !== undefined) {
          state.lastModified = settings.lastModified;
        }
      }),

    setHydrated: (hydrated) =>
      set((state) => {
        state.isHydrated = hydrated;
      }),
  }))
);
