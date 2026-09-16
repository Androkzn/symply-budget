import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { MainTabParamList } from '@navigation/types';
import { settingsSync } from '@services/settings-sync';
import type { IoniconName } from '@utils/categoryIcons';

export enum TabType {
  MY_HOME = 'my_home',
  HOME = 'home',
  GARDENING = 'gardening',
  TASKS = 'tasks',
  CONTRACTORS = 'contractors',
  REPORTS = 'reports',
  UTILITIES = 'utilities',
  SETTINGS = 'settings',
}

export interface TabMetadata {
  id: TabType;
  displayName: string;
  icon: IoniconName;
  iconFocused: IoniconName;
  screenName: keyof MainTabParamList;
  isRequired: boolean;
}

export interface TabConfig {
  id: string;
  type: TabType;
  order: number;
  isVisible: boolean;
}

interface NavigationCustomizationState {
  tabs: TabConfig[];
  lastModified: number | null;
  isHydrated: boolean;
}

interface NavigationCustomizationActions {
  updateTabOrder: (tabs: TabConfig[]) => void;
  toggleTabVisibility: (tabId: string) => void;
  addTab: (tabType: TabType) => void;
  removeTab: (tabId: string) => void;
  resetToDefaults: () => void;
  canToggleTab: (tabId: string) => boolean;
  hydrate: (settings: { tabs?: TabConfig[]; lastModified?: number | null }) => void;
  setHydrated: (hydrated: boolean) => void;
}

// Tab metadata registry
export const TAB_METADATA: Record<TabType, TabMetadata> = {
  [TabType.MY_HOME]: {
    id: TabType.MY_HOME,
    displayName: 'My Home',
    icon: 'home-outline',
    iconFocused: 'home',
    screenName: 'MyHome',
    isRequired: true,
  },
  [TabType.HOME]: {
    id: TabType.HOME,
    displayName: 'Home',
    icon: 'grid-outline',
    iconFocused: 'grid',
    screenName: 'Home',
    isRequired: true,
  },
  [TabType.GARDENING]: {
    id: TabType.GARDENING,
    displayName: 'Garden',
    icon: 'leaf-outline',
    iconFocused: 'leaf',
    screenName: 'Gardening',
    isRequired: false,
  },
  [TabType.TASKS]: {
    id: TabType.TASKS,
    displayName: 'Tasks',
    icon: 'checkbox-outline',
    iconFocused: 'checkbox',
    screenName: 'Tasks',
    isRequired: false,
  },
  [TabType.CONTRACTORS]: {
    id: TabType.CONTRACTORS,
    displayName: 'Contractors',
    icon: 'construct-outline',
    iconFocused: 'construct',
    screenName: 'Contractors',
    isRequired: false,
  },
  [TabType.REPORTS]: {
    id: TabType.REPORTS,
    displayName: 'Reports',
    icon: 'document-text-outline',
    iconFocused: 'document-text',
    screenName: 'Reports',
    isRequired: false,
  },
  [TabType.UTILITIES]: {
    id: TabType.UTILITIES,
    displayName: 'Bills',
    icon: 'flash-outline',
    iconFocused: 'flash',
    screenName: 'Utilities',
    isRequired: false,
  },
  [TabType.SETTINGS]: {
    id: TabType.SETTINGS,
    displayName: 'Settings',
    icon: 'settings-outline',
    iconFocused: 'settings',
    screenName: 'Settings',
    isRequired: false,
  },
};

const MIN_VISIBLE_TABS = 3;
const MAX_VISIBLE_TABS = 6;

// Use stable IDs to avoid getSnapshot warning and prevent infinite re-renders
const DEFAULT_TABS: TabConfig[] = [
  { id: 'tab-gardening', type: TabType.GARDENING, order: 1, isVisible: true },
  { id: 'tab-reports', type: TabType.REPORTS, order: 2, isVisible: true },
  { id: 'tab-tasks', type: TabType.TASKS, order: 3, isVisible: false },
  { id: 'tab-utilities', type: TabType.UTILITIES, order: 4, isVisible: false },
  { id: 'tab-home', type: TabType.HOME, order: 5, isVisible: true },
  { id: 'tab-settings', type: TabType.SETTINGS, order: 6, isVisible: true },
  { id: 'tab-contractors', type: TabType.CONTRACTORS, order: 7, isVisible: false },
];

/** Merge Garden tab for users who still have a saved tab list from before it existed */
function withGardeningTab(tabs: TabConfig[]): TabConfig[] {
  if (tabs.some((t) => t.type === TabType.GARDENING)) {
    return tabs;
  }
  const sorted = [...tabs].sort((a, b) => a.order - b.order);
  const homeIdx = sorted.findIndex((t) => t.type === TabType.HOME);
  const insertAt = homeIdx >= 0 ? homeIdx + 1 : 0;
  const next: TabConfig[] = [
    ...sorted.slice(0, insertAt),
    { id: 'tab-gardening', type: TabType.GARDENING, order: 0, isVisible: true },
    ...sorted.slice(insertAt),
  ];
  return next.map((t, i) => ({ ...t, order: i }));
}

/**
 * The "My Home" tab has been removed from the app. Existing installs may still
 * have it persisted in their saved tab list, so strip it out and make sure the
 * Dashboard (HOME) tab is present and visible in its place.
 */
function withoutMyHomeTab(tabs: TabConfig[]): TabConfig[] {
  const filtered = tabs.filter((t) => t.type !== TabType.MY_HOME);
  const ensured = filtered.some((t) => t.type === TabType.HOME)
    ? filtered
    : [
        ...filtered,
        { id: 'tab-home', type: TabType.HOME, order: filtered.length, isVisible: true },
      ];
  return [...ensured]
    .sort((a, b) => a.order - b.order)
    .map((t, i) => ({ ...t, order: i }));
}

export const useNavigationCustomizationStore = create<
  NavigationCustomizationState & NavigationCustomizationActions
>()(
  immer((set, get) => ({
    tabs: DEFAULT_TABS,
    lastModified: null,
    isHydrated: false,

    updateTabOrder: (tabs) => {
      set((state) => {
        state.tabs = tabs.map((t, index) => ({ ...t, order: index }));
        state.lastModified = Date.now();
      });
      // Sync to database
      settingsSync.queueSync('navigation.tabs', tabs);
      settingsSync.queueSync('navigation.lastModified', Date.now());
    },

    toggleTabVisibility: (tabId) => {
      if (!get().canToggleTab(tabId)) return;

      set((state) => {
        const tab = state.tabs.find((t) => t.id === tabId);
        if (tab) {
          tab.isVisible = !tab.isVisible;
          // Reorder: visible tabs first, then hidden
          state.tabs.sort((a, b) => {
            if (a.isVisible === b.isVisible) return a.order - b.order;
            return a.isVisible ? -1 : 1;
          });
          // Reassign order numbers
          state.tabs = state.tabs.map((t, index) => ({ ...t, order: index }));
          state.lastModified = Date.now();
        }
      });
      // Sync to database
      const state = get();
      settingsSync.queueSync('navigation.tabs', state.tabs);
      settingsSync.queueSync('navigation.lastModified', state.lastModified);
    },

    addTab: (tabType) => {
      const visibleCount = get().tabs.filter((t) => t.isVisible).length;
      if (visibleCount >= MAX_VISIBLE_TABS) return;

      set((state) => {
        // Check if tab of this type already exists
        const existingTab = state.tabs.find((t) => t.type === tabType);
        if (existingTab) {
          existingTab.isVisible = true;
        } else {
          // Add new tab
          state.tabs.push({
            id: uuidv4(),
            type: tabType,
            order: visibleCount,
            isVisible: true,
          });
        }
        // Reorder
        state.tabs.sort((a, b) => {
          if (a.isVisible === b.isVisible) return a.order - b.order;
          return a.isVisible ? -1 : 1;
        });
        state.tabs = state.tabs.map((t, index) => ({ ...t, order: index }));
        state.lastModified = Date.now();
      });
      // Sync to database
      const state = get();
      settingsSync.queueSync('navigation.tabs', state.tabs);
      settingsSync.queueSync('navigation.lastModified', state.lastModified);
    },

    removeTab: (tabId) => {
      if (!get().canToggleTab(tabId)) return;

      set((state) => {
        const tab = state.tabs.find((t) => t.id === tabId);
        if (tab) {
          tab.isVisible = false;
          // Reorder
          state.tabs.sort((a, b) => {
            if (a.isVisible === b.isVisible) return a.order - b.order;
            return a.isVisible ? -1 : 1;
          });
          state.tabs = state.tabs.map((t, index) => ({ ...t, order: index }));
          state.lastModified = Date.now();
        }
      });
      // Sync to database
      const state = get();
      settingsSync.queueSync('navigation.tabs', state.tabs);
      settingsSync.queueSync('navigation.lastModified', state.lastModified);
    },

    resetToDefaults: () => {
      set((state) => {
        state.tabs = DEFAULT_TABS;
        state.lastModified = Date.now();
      });
      // Sync to database
      settingsSync.queueSync('navigation.tabs', DEFAULT_TABS);
      settingsSync.queueSync('navigation.lastModified', Date.now());
    },

    canToggleTab: (tabId) => {
      const state = get();
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab) return false;

      const metadata = TAB_METADATA[tab.type];
      // Cannot toggle required tabs
      if (metadata.isRequired) return false;

      const visibleCount = state.tabs.filter((t) => t.isVisible).length;

      // If trying to hide and we're at minimum
      if (tab.isVisible && visibleCount <= MIN_VISIBLE_TABS) return false;

      // If trying to show and we're at maximum
      if (!tab.isVisible && visibleCount >= MAX_VISIBLE_TABS) return false;

      return true;
    },

    hydrate: (settings) =>
      set((state) => {
        if (settings.tabs !== undefined) {
          state.tabs = withoutMyHomeTab(withGardeningTab(settings.tabs));
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

// Memoized selectors to avoid infinite re-render loops
// These create stable references by using shallow comparison
export const selectVisibleTabs = (state: NavigationCustomizationState): TabConfig[] => {
  return state.tabs.filter((t) => t.isVisible).sort((a, b) => a.order - b.order);
};

export const selectHiddenTabs = (state: NavigationCustomizationState): TabConfig[] => {
  return state.tabs.filter((t) => !t.isVisible).sort((a, b) => a.order - b.order);
};
