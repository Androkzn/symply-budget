import type { BottomTabBarProps } from "expo-router/js-tabs";
import { CommonActions, StackActions } from "expo-router/react-navigation";

/**
 * Switch to `routeName` and reset that tab's nested stack back to its root.
 *
 * Tapping a bottom-nav item should always land on the tab's root screen and
 * never resurface a previously-visited child (e.g. Budget → BudgetSettings,
 * Utilities → UtilityBills). Tabs that host a nested native-stack (Budget,
 * Utilities, Settings, Tasks) keep their own sub-history; we unwind that
 * history on every tap. Tabs without a nested stack (Mira, Chat) have no
 * sub-history and are left untouched.
 *
 * `popToTop()` alone is NOT enough, because it returns to the stack's FIRST
 * route, which is not always the tab's root screen. A `screen=` deep link into
 * the Home tab (`simplebudget:///?screen=BudgetSettings` — the door Profile's
 * gear, the pending-invite forward in `app/_layout.tsx` and the E2E suites all
 * use) can leave the Budget stack rooted at the drill-down itself: verified on
 * Budget-A, where the Home tab's nested routes were `["BudgetSettings"]` and
 * `["BudgetSettings","BudgetMain"]`. There popToTop is a no-op (or lands back
 * on Budget Settings) and tapping Home never reached the dashboard — the same
 * dead end the header back button hits, which is why the E2E recovery subflows
 * re-open `simplebudget:///` after their blind back-taps.
 *
 * So the tap takes one of two routes:
 *  - healthy stack (first route IS the tab's root) → `popToTop`, which keeps
 *    the root screen mounted with its scroll position and local state;
 *  - anything else → drop the tab's nested state so its navigator rebuilds
 *    itself from its own `initialRouteName`. Authoritative rather than
 *    guessing a root screen name, and it also covers the window right after a
 *    rehydration, where the child navigator has not reported a keyed state
 *    yet and there is nothing to aim a targeted dispatch at.
 *
 * Shared by both tab bars (`FloatingTabBar` on iPhone and `SidebarTabBar` on
 * iPad) so they stay 1:1 in behaviour.
 */
export function navigateToTabRoot(
  navigation: BottomTabBarProps['navigation'],
  state: BottomTabBarProps['state'],
  routeName: string,
): void {
  // Switch to the tapped tab. Using the Tabs navigator's own `navigate`
  // swaps the active tab with proper state updates (and is a no-op for focus
  // when already on that tab).
  navigation.navigate(routeName);

  const targetRoute = state.routes.find(route => route.name === routeName);
  const nestedState = targetRoute?.state;
  if (!nestedState) return;

  const nestedRoutes = nestedState.routes ?? [];
  // Every tab navigator declares its root screen first and names it as its
  // `initialRouteName`, so `routeNames[0]` is the screen the tab must land on.
  // A stack that has not reported yet carries no `routeNames`.
  const rootName = nestedState.routeNames?.[0];
  const startsAtRoot = rootName === undefined || nestedRoutes[0]?.name === rootName;

  if (startsAtRoot && nestedRoutes.length <= 1) return;

  if (startsAtRoot && nestedState.key !== undefined) {
    navigation.dispatch({
      ...StackActions.popToTop(),
      target: nestedState.key,
    });
    return;
  }

  // Rebuild the tab from its navigator's own initial route. The route's params
  // go with the nested state on purpose: they carry the `screen=` deep link
  // that opened the drill-down, and the rebuilt root screen re-runs the
  // handler that reads them — keeping them would immediately re-open the very
  // screen this tap is closing.
  navigation.dispatch(currentState =>
    CommonActions.reset({
      ...currentState,
      routes: currentState.routes.map(route =>
        route.name === routeName ? { key: route.key, name: route.name } : route,
      ),
    }),
  );
}
