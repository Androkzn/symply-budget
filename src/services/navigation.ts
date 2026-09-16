import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { createNavigationContainerRef } from "expo-router/react-navigation";

import { isBudgetBrand, isBudgetOff, isFullBudget, sanitizeBudgetNavigation } from '@features/budget';
import type { RootStackParamList } from '@navigation/types';
import { runWhenNavigatorReady } from '@services/nav-when-ready';
import { useGardeningNavigationStore } from '@stores/gardeningNavigationStore';
import { queueSettingsNavigation, flushPendingSettingsNavigation } from '@stores/settingsNavigationStore';
import { useTaskStore } from '@stores/taskStore';

/**
 * Cross-stack navigation helpers — expo-router edition.
 *
 * The app's runtime entry point is `expo-router/entry` (per
 * `package.json#main`); the legacy `src/App.tsx` `NavigationContainer`
 * never mounts. These helpers therefore route through
 * `expo-router`'s imperative `router.push`. For helpers that target a
 * screen nested inside one of the React-Navigation stacks owned by a
 * tab (Tasks, Reports, Settings, …) we push to the tab's path and pass
 * `screen` + extra params via the URL — the tab files in `app/(tabs)/`
 * read them via `useLocalSearchParams()` and feed them into the
 * navigator's `initialParams`, which a `NavigationHandler` inside the
 * navigator turns into a `navigation.navigate(...)` call.
 *
 * `navigationRef` is kept as a no-op-friendly export for legacy
 * callers (e.g. unauth-flow `RootNavigator`). Nothing currently
 * attaches it under expo-router, so `isReady()` always returns false,
 * and any caller that imports it should treat it as advisory only.
 */

/**
 * Hand a destination to the app through its own URL instead of `router.push`.
 *
 * The `screen=`-param handoff described above has one hole: an imperative push
 * does NOT deliver new search params to a tab that is already mounted. The tab
 * gets focused, `useLocalSearchParams()` keeps returning the params it was
 * mounted with, and the nested navigator never hears about the request — the
 * tap moves the tab and stops there.
 *
 * That is precisely the state every notification tap arrives in, so the push
 * silently loses the destination exactly when it matters. Handing the same URL
 * to `Linking` does deliver it — the route is re-entered from the outside, the
 * way a real deep link (and every E2E `openLink`) reaches these screens.
 * `app/_layout.tsx` reached the same conclusion for captured invite links.
 */
function openViaAppUrl(pathname: string, queryParams: Record<string, string>) {
  const url = Linking.createURL(pathname, { queryParams });
  void Linking.openURL(url).catch(() => {
    // Nothing left to try but the lossy door: it at least lands the member on
    // the right tab rather than leaving the tap dead.
    router.push({ pathname, params: queryParams } as Parameters<typeof router.push>[0]);
  });
}

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Generic top-level navigate. Maps legacy RN screen names → expo-router paths. */
export function navigate(name: string, params?: Record<string, unknown>) {
  // Subset of names AssistantUIBlock and other tools may emit. The
  // canonical mapping (with rationale) lives in
  // `AssistantUIBlock.tsx` — this is the lowest-common-denominator
  // fallback when callers go through this helper.
  switch (name) {
    case 'Briefing':
      if (params && typeof params.date === 'string' && params.date) {
        router.push(`/briefing/${params.date}`);
      } else {
        router.push('/aihousekeeper-briefings');
      }
      return;
    case 'BriefingHistory':
    case 'AihousekeeperBriefings':
      router.push('/aihousekeeper-briefings');
      return;
    case 'TrustLedger':
    case 'AihousekeeperTrustLedger':
      router.push('/aihousekeeper-trust-ledger');
      return;
    case 'AihousekeeperApprovals':
      router.push('/aihousekeeper-approvals');
      return;
    case 'AihousekeeperChat':
    case 'MeetAihousekeeper':
      router.push('/aihousekeeper-chat');
      return;
    case 'AihousekeeperSettings':
      router.push('/aihousekeeper-settings');
      return;
    case 'AihousekeeperConnectedAccounts':
      router.push('/aihousekeeper-connected-accounts');
      return;
    case 'Home':
      router.push('/');
      return;
    case 'GardenPlanAddress': {
      const initialAddressLine1 =
        params && typeof params.initialAddressLine1 === 'string'
          ? params.initialAddressLine1
          : undefined;
      useGardeningNavigationStore.getState().setPendingNavigation({
        screen: 'GardenPlanAddress',
        initialAddressLine1,
      });
      router.push('/gardening');
      return;
    }
    case 'GardenPlanBoundaryConfirm': {
      const draftId = params && typeof params.draftId === 'string' ? params.draftId : undefined;
      if (draftId) {
        useGardeningNavigationStore
          .getState()
          .setPendingNavigation({ screen: 'GardenPlanBoundaryConfirm', draftId });
      }
      router.push('/gardening');
      return;
    }
    case 'Tasks':
    case 'TasksMain':
      router.push('/tasks');
      return;
    case 'Reports':
    case 'ReportsMain':
      router.push('/reports');
      return;
    case 'Settings':
    case 'SettingsMain':
      router.push('/settings');
      return;
    default:
      console.warn('[navigation.navigate] no expo-router mapping for:', name, params);
  }
}

/**
 * Navigate to a specific report detail screen (Reports tab → ReportDetail).
 *
 * `app/(tabs)/reports.tsx` reads the URL params via
 * `useLocalSearchParams()` and passes them as `initialParams` to
 * `ReportsNavigator`, whose `NavigationHandler` will then call
 * `navigation.navigate('ReportDetail', ...)`.
 */
export function navigateToReport(reportId: string, householdId: string) {
  router.push({
    pathname: '/reports',
    params: { screen: 'ReportDetail', reportId, householdId },
  });
}

/**
 * Navigate to a specific task detail screen (Tasks tab → TaskDetail).
 *
 * Uses the existing `pendingTaskNavigation` bridge in
 * `useTaskStore` — `TasksScreen` has a `useEffect` that picks up the
 * pending id and calls `navigation.navigate('TaskDetail', ...)`. This
 * is the same path Home cards use, so behavior is consistent.
 */
export function navigateToTask(taskId: string) {
  useTaskStore.getState().setPendingTaskNavigation(taskId);
  router.push('/tasks');
}

/**
 * Navigate to the Gardening tab. Optional `gardenPlanId` is forwarded as
 * a screen+param hint that GardeningNavigator can pick up to push directly
 * into GardenPlanViewer; if it's not wired up there, the user just lands
 * on the list and taps the (newly visible) plan card.
 */
export function navigateToGardening(gardenPlanId?: string) {
  if (gardenPlanId) {
    router.push({
      pathname: '/gardening',
      params: { screen: 'GardenPlanViewer', gardenPlanId },
    });
  } else {
    router.push('/gardening');
  }
}

/** Navigate to Home Projects (House-only, brand-gated). */
export function navigateToHomeProject(projectId?: string, screen?: string) {
  if (projectId) {
    router.push({
      pathname: '/projects',
      params: { screen: screen || 'HomeProjectHub', projectId },
    });
  } else {
    router.push('/projects');
  }
}

/**
 * Navigate to garbage collection screen.
 *
 * TODO: GarbageNavigator exists at src/navigation/GarbageNavigator.tsx
 * but is not currently mounted under expo-router (no `app/garbage/`
 * route). Falling back to the home tab so notifications don't dead-end;
 * a follow-up should wire up the dedicated route. Tracked separately —
 * out of scope for the navigation-fix patch.
 */
export function navigateToGarbageCollection() {
  router.push('/');
}

/**
 * Navigate to the Budget tab (e.g. from an over-budget alert, weekly digest, or
 * budget reminder). Pass `extra.activeView: 'savings'` to land on the Savings
 * sub-view (optionally deep-linking a Savings sub-tab via `extra.subTab`); the
 * BudgetScreen reads these off the URL params and flips its store on mount.
 */
export function navigateToBudget(
  screen: 'BudgetMain' | 'BudgetSettings' = 'BudgetMain',
  extra?: { activeView?: 'savings'; subTab?: string }
) {
  if (isBudgetOff()) {
    router.push('/');
    return;
  }
  const sanitized = sanitizeBudgetNavigation({
    screen,
    ...(extra?.activeView ? { activeView: extra.activeView } : {}),
  });
  const safeScreen =
    sanitized.screen === 'BudgetSettings' ? 'BudgetSettings' : 'BudgetMain';
  const safeExtra = isFullBudget() ? extra : undefined;

  router.push({
    pathname: '/budget',
    params: {
      screen: safeScreen,
      ...(sanitized.activeView ? { activeView: sanitized.activeView } : {}),
      ...(safeExtra?.subTab ? { subTab: safeExtra.subTab } : {}),
    },
  });
}

/**
 * Navigate to Budget → Invite & Household (Budget tab → BudgetInvite).
 *
 * `navNonce` because `BudgetNavigator` de-dupes by `screen:itemId:navNonce`: an
 * owner who taps a second "someone is waiting" notification while already on
 * this screen must still be taken there — otherwise the tap does nothing and
 * reads as a broken notification.
 *
 * Re-entered through the app's own URL rather than `router.push` — see
 * `openViaAppUrl`. Verified on Budget-A: tapping "Lisa is waiting to join" in
 * the notification list closed the list and stopped on Home, because the push
 * could not deliver `screen=` to a Home tab that was already mounted.
 */
export function navigateToBudgetInvite() {
  if (isBudgetOff()) {
    router.push('/');
    return;
  }
  // Aim at the tab that actually hosts the stack. On the Budget brand `/budget`
  // is not a tab at all — it only `<Redirect>`s to Home, and that redirect is
  // itself an imperative navigation, so it re-opens the very hole this helper
  // exists to route around. Other brands (House minimal) keep the real tab.
  openViaAppUrl(isBudgetBrand() ? '/' : '/budget', {
    screen: 'BudgetInvite',
    navNonce: String(Date.now()),
  });
}

/**
 * Navigate to Budget → Backup & Restore (Budget tab → BudgetBackup).
 *
 * The destination for every "backups cannot run" message: reconnecting a cloud
 * provider, changing where backups go, and the status card that explains what
 * the last run did all live on that one screen. Without a way to reach it from
 * the toast, "Google Drive needs to be reconnected before backups can run"
 * fades after six seconds having told the member about a problem and nothing
 * about where to fix it.
 *
 * Same shape as {@link navigateToBudgetInvite}, and for the same reasons: the
 * app's own URL because an imperative push cannot deliver `screen=` to a tab
 * that is already mounted (which is exactly where a toast tap comes from), and
 * a `navNonce` because `BudgetNavigator` de-dupes by `screen:itemId:navNonce`.
 */
export function navigateToBudgetBackup() {
  if (isBudgetOff()) {
    router.push('/');
    return;
  }
  // On the Budget brand `/budget` only `<Redirect>`s to Home, and that redirect
  // is itself an imperative navigation — aim at the tab that hosts the stack.
  openViaAppUrl(isBudgetBrand() ? '/' : '/budget', {
    screen: 'BudgetBackup',
    navNonce: String(Date.now()),
  });
}

/**
 * Navigate to Budget → Device Sync (Budget tab → BudgetSync).
 *
 * Same shape and same reasons as {@link navigateToBudgetInvite}. This one earns
 * its keep because Sync & Sharing now lives on **Profile**, which is a sibling
 * tab of the one hosting the Budget stack: every row there is a cross-tab jump
 * that an imperative push cannot make carry `screen=`.
 */
export function navigateToBudgetSync() {
  if (isBudgetOff()) {
    router.push('/');
    return;
  }
  openViaAppUrl(isBudgetBrand() ? '/' : '/budget', {
    screen: 'BudgetSync',
    navNonce: String(Date.now()),
  });
}

/** Navigate to Budget → Households (Budget tab → BudgetHouseholds). */
export function navigateToBudgetHouseholds() {
  if (isBudgetOff()) {
    router.push('/');
    return;
  }
  openViaAppUrl(isBudgetBrand() ? '/' : '/budget', {
    screen: 'BudgetHouseholds',
    navNonce: String(Date.now()),
  });
}

/** Navigate to Budget → Export (Budget tab → BudgetExport). */
export function navigateToBudgetExport() {
  if (isBudgetOff()) {
    router.push('/');
    return;
  }
  openViaAppUrl(isBudgetBrand() ? '/' : '/budget', {
    screen: 'BudgetExport',
    navNonce: String(Date.now()),
  });
}

/**
 * Navigate to House → Device sync, which is its own root route.
 *
 * The root route rather than the Settings-stack screen of the same name: the
 * row that leads here is on PROFILE now, a sibling tab of the one hosting that
 * stack, and `/device-sync` mounts the identical component (see the note in
 * `app/device-sync.tsx`) while keeping the member on the tab they were on.
 */
export function navigateToHouseDeviceSync() {
  router.push('/device-sync');
}

/** Navigate to House → Backup & Restore, which is its own root route. */
export function navigateToHouseBackup() {
  router.push('/house-backup');
}

/** Navigate to the task drafts list (Tasks tab → TaskDrafts). */
export function navigateToTaskDrafts(reportId?: string, reportName?: string) {
  const params: Record<string, string> = { screen: 'TaskDrafts' };
  if (reportId) params.reportId = reportId;
  if (reportName) params.reportName = reportName;
  router.push({ pathname: '/tasks', params });
}

/** Navigate to a specific task draft (Tasks tab → TaskDraftDetail). */
export function navigateToTaskDraftDetail(draftId: string) {
  router.push({
    pathname: '/tasks',
    params: { screen: 'TaskDraftDetail', draftId },
  });
}

/** Navigate to maintenance setup (Tasks tab → MaintenanceSetup). */
export function navigateToMaintenanceSetup(reportId?: string) {
  const params: Record<string, string> = { screen: 'MaintenanceSetup' };
  if (reportId) params.reportId = reportId;
  router.push({ pathname: '/tasks', params });
}

/** Navigate to household members screen (Settings tab → HouseholdMembers). */
export function navigateToHouseholdMembers(householdId: string) {
  queueSettingsNavigation({ screen: 'HouseholdMembers', householdId });
  router.push('/settings');
  runWhenNavigatorReady(() => flushPendingSettingsNavigation());
}

/**
 * Navigate to House's enrolment hub (Settings tab → HouseInvite).
 *
 * The hub is where every invite notification lands: "X is waiting to join" is
 * answered there, and so is "your device was approved". Both sides of the
 * hand-off are shown on it, so a tap does not have to know which half of the
 * exchange the member is on.
 */
export function navigateToHouseInvite() {
  queueSettingsNavigation({ screen: 'HouseInvite' });
  router.push('/settings');
  runWhenNavigatorReady(() => flushPendingSettingsNavigation());
}

/**
 * Navigate to House's Join screen with a tapped invite already in hand.
 *
 * The code and secret travel through the pending-navigation store, never
 * through the URL: route params end up in navigation state and in anything that
 * logs a route, and this pair opens a home. Nothing is claimed by arriving —
 * the confirmation on the screen is what enrols, so a link forwarded into a
 * group chat cannot enrol whoever taps it first.
 */
export function navigateToHouseJoin(invite?: { code: string; secret: string }) {
  queueSettingsNavigation({
    screen: 'HouseJoin',
    ...(invite ? { inviteCode: invite.code, inviteSecret: invite.secret } : {}),
  });
  router.push('/settings');
  runWhenNavigatorReady(() => flushPendingSettingsNavigation());
}

/** Navigate to spaces management (Settings tab → SpacesManagement). */
export function navigateToSpacesManagement(householdId?: string) {
  queueSettingsNavigation({ screen: 'SpacesManagement', householdId });
  router.push('/settings');
  runWhenNavigatorReady(() => flushPendingSettingsNavigation());
}

/** Navigate to floor plan picker to place a task pin (Settings tab → FloorPlanPicker). */
export function navigateToFloorPlanPicker(taskId: string) {
  queueSettingsNavigation({ screen: 'FloorPlanPicker', linkedEntityId: taskId });
  router.push('/settings');
  runWhenNavigatorReady(() => flushPendingSettingsNavigation());
}

/**
 * Navigate to households list screen (Settings tab → HouseholdManagement).
 *
 * The legacy code dispatched to a `Households` screen that doesn't
 * exist; the registered name is `HouseholdManagement` — fixed here.
 */
export function navigateToHouseholds() {
  queueSettingsNavigation({ screen: 'HouseholdManagement' });
  router.push('/settings');
  runWhenNavigatorReady(() => flushPendingSettingsNavigation());
}

/** Navigate to the accept-invite screen (root-level deep link). */
export function navigateToAcceptInvite(token: string) {
  router.push(`/invite/${encodeURIComponent(token)}`);
}

/** Navigate to schedule/edit task screen (Tasks tab → ScheduleTask). */
export function navigateToScheduleTask(taskId?: string) {
  const params: Record<string, string> = {
    screen: 'ScheduleTask',
    navNonce: `${Date.now()}`,
  };
  if (taskId) params.taskId = taskId;
  router.push({ pathname: '/tasks', params });
}

/** Navigate to copy from existing tasks screen (Tasks tab → CopyFromExistingTasks). */
export function navigateToCopyFromExistingTasks() {
  router.push({
    pathname: '/tasks',
    params: { screen: 'CopyFromExistingTasks' },
  });
}

/** Navigate to task templates screen (Tasks tab → TaskTemplates). */
export function navigateToTaskTemplates() {
  router.push({
    pathname: '/tasks',
    params: { screen: 'TaskTemplates' },
  });
}