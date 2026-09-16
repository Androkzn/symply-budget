import {
  getFocusedRouteNameFromRoute,
  type RouteProp,
} from "expo-router/react-navigation";

import type { MainTabParamList } from './types';

type MainTabName = keyof MainTabParamList;
type MainTabRoute = RouteProp<MainTabParamList, MainTabName>;
type RouteLike = MainTabRoute | {
  name: string;
  state?: {
    index?: number;
    routes?: Array<{ name: string }>;
  };
};

const ROOT_ROUTE_BY_TAB: Partial<Record<MainTabName, string>> = {
  Gardening: 'GardeningMain',
  Reports: 'ReportsMain',
  Tasks: 'TasksMain',
  Contractors: 'LaborHubDashboard',
  Utilities: 'UtilitiesMain',
  Settings: 'SettingsMain',
  Budget: 'BudgetMain',
};

const HIDE_ALL_NESTED_TABS = new Set<MainTabName>([
  'Gardening',
]);

// Specific nested routes that hide the floating tab bar (the tab otherwise
// keeps it on all its screens). WishDetail is a chat/feed screen with its own
// bottom composer, which the floating tab bar would otherwise cover.
const HIDDEN_ROUTES_BY_TAB: Partial<Record<MainTabName, ReadonlySet<string>>> = {
  Budget: new Set(['WishDetail']),
};

export function shouldHideTabBarForRoute(
  tabName: string,
  route: RouteLike,
): boolean {
  return shouldHideTabBarForFocusedRoute(tabName, getFocusedRouteName(route));
}

export function shouldHideTabBarForFocusedRoute(
  tabName: string,
  focusedRouteName?: string,
): boolean {
  if (!isMainTabName(tabName)) return false;

  const rootRouteName = ROOT_ROUTE_BY_TAB[tabName];
  if (!rootRouteName) return false;

  const routeName = focusedRouteName ?? rootRouteName;

  if (HIDE_ALL_NESTED_TABS.has(tabName)) {
    return routeName !== rootRouteName;
  }

  return HIDDEN_ROUTES_BY_TAB[tabName]?.has(routeName) ?? false;
}

export function getTabBarStyleForRoute(
  tabName: MainTabName,
  route: MainTabRoute,
) {
  return shouldHideTabBarForRoute(tabName, route) ? { display: 'none' as const } : undefined;
}

function isMainTabName(tabName: string): tabName is MainTabName {
  return tabName in ROOT_ROUTE_BY_TAB;
}

function getFocusedRouteName(route: RouteLike): string | undefined {
  const state = 'state' in route ? route.state : undefined;
  const index = state?.index ?? 0;
  const focusedFromState = state?.routes?.[index]?.name;
  return focusedFromState ?? getFocusedRouteNameFromRoute(route as MainTabRoute);
}
