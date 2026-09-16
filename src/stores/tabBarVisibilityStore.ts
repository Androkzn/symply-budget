import { create } from 'zustand';

import type { MainTabParamList } from '@navigation/types';

type MainTabName = keyof MainTabParamList;

interface TabBarVisibilityState {
  focusedRoutesByTab: Partial<Record<MainTabName, string>>;
  setFocusedRoute: (tabName: MainTabName, routeName: string) => void;
  /**
   * True when the iPad sidebar tab bar is actually rendered. False when the
   * sidebar is hidden (compact widths / phone) or suppressed by route-level
   * rules (e.g. fullscreen garden editor). Screens use this to decide whether
   * to reserve leading space for the sidebar.
   */
  isSidebarVisible: boolean;
  setSidebarVisible: (visible: boolean) => void;
}

export const useTabBarVisibilityStore = create<TabBarVisibilityState>((set) => ({
  focusedRoutesByTab: {},
  setFocusedRoute: (tabName, routeName) =>
    set((state) => ({
      focusedRoutesByTab: {
        ...state.focusedRoutesByTab,
        [tabName]: routeName,
      },
    })),
  isSidebarVisible: false,
  setSidebarVisible: (visible) =>
    set((state) => (state.isSidebarVisible === visible ? state : { isSidebarVisible: visible })),
}));
