import { router } from 'expo-router';
import { Alert } from 'react-native';

import { householdsApi } from '@api/households';
import { isHealthCapableBrand, isHouseBrand } from '@brand';
import { isBudgetOff, isFullBudget } from '@features/budget';
import {
  BUDGET_INVITE_UPDATE_TYPES,
  useBudgetEnrolmentSignal,
} from '@features/budget/local/enrolmentSignal';
import { CHAT_CONFIGS } from '@features/chat/configs';
import {
  HOUSE_INVITE_UPDATE_TYPES,
  useHouseEnrolmentSignal,
} from '@features/house/local/enrolmentSignal';
// Import from the light config module, not the '@features/chat' barrel — the
// barrel re-exports chat SCREENS (→ cloud-storage → charts → theme), which a
// routing service must not pull into its module graph (fragile at init + heavy).
import { navigateAfterInteractions } from '@services/nav-when-ready';
import {
  navigateToBudget,
  navigateToBudgetInvite,
  navigateToGardening,
  navigateToGarbageCollection,
  navigateToHomeProject,
  navigateToHouseInvite,
  navigateToHouseholdMembers,
  navigateToMaintenanceSetup,
  navigateToReport,
  navigateToTask,
  navigateToTaskDraftDetail,
  navigateToTaskDrafts,
} from '@services/navigation';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useInviteStore } from '@stores/inviteStore';
import { useMemberStore } from '@stores/memberStore';

export interface NotificationRouteOptions {
  /** e.g. close the in-app notification list before navigating */
  beforeNavigate?: () => void;
  /** Push-tap dedupe for chat deep links */
  navNonce?: string | number;
  /** Refresh household-scoped data after joining via invite */
  refreshHouseholdData?: () => Promise<void>;
}

/**
 * House-domain notification payloads (types + legacy `screen` values) whose tap
 * handlers navigate into House-only screens — tasks, reports, maintenance,
 * garbage, garden plans, and the AI Housekeeper. These belong to the House app.
 *
 * `notificationVisibility.ts` already hides these types from a child app's
 * notification *list*, but a tapped push or a crafted deep link still flows
 * through `routeNotificationTap`. In a child app (Budget, etc.) we send those
 * taps to home instead of pushing a House screen the app no longer surfaces —
 * mirroring the `isBudgetOff()` redirect the budget handlers already use.
 * (Household invite/membership and chat payloads are shared and NOT listed.)
 */
const HOUSE_NOTIFICATION_TYPES = new Set<string>([
  'aihousekeeper_briefing',
  'task_reminder',
  'task_overdue',
  'task_assigned',
  'task_due_soon',
  'task_due_today',
  'task_drafts_ready',
  'drafts_ready',
  'critical_drafts',
  'task_draft_detail',
  'draft_detail',
  'maintenance_suggestions',
  'maintenance_setup',
  'report_ready',
  'critical_findings',
  'garbage_collection',
  'garden_plan_ready',
  'garden_plan_failed',
  'home_project_blocker_added',
  'home_project_budget_over',
  'home_project_phase_due',
  'home_project_selection_approved',
  'home_project_schematic_ready',
  'home_project_schematic_failed',
  'home_project_mentioned',
]);

/**
 * Symply Health reminder payloads — meal / water / weigh-in / habit nudges.
 *
 * The Health counterpart of the House list above. `notificationVisibility.ts`
 * already hides these from a non-Health app's notification LIST, but a tapped
 * push or a crafted deep link still reaches this function, and none of the
 * Health screens exist outside the Health app — so the tap goes home instead of
 * pushing a route that would 404.
 *
 * Keep in step with `HEALTH_REMINDER_TYPES` + `HEALTH_HABIT_REMINDER_TYPE` in
 * `backend/src/services/health-reminders-service.ts`.
 */
const HEALTH_NOTIFICATION_TYPES = new Set<string>([
  'health_meal_reminder',
  'health_water_reminder',
  'health_weigh_in_reminder',
  'health_habit_reminder',
]);

/**
 * Where each reminder drops the member: the screen where they can DO the thing
 * the nudge asked for, not a generic dashboard. A "log your lunch" push that
 * lands on Home has made the member navigate twice for something they were
 * already interrupted for.
 */
const HEALTH_NOTIFICATION_ROUTES: Record<string, string> = {
  health_meal_reminder: '/health-nutrition',
  health_water_reminder: '/health-water',
  health_weigh_in_reminder: '/health-weight',
  health_habit_reminder: '/health-habits',
};

const HOUSE_NOTIFICATION_SCREENS = new Set<string>([
  'TaskDetail',
  'TaskDrafts',
  'TaskDraftDetail',
  'MaintenanceSetup',
  'ReportDetail',
  'GarbageCollection',
]);

function isHouseDomainNotification(
  type: string | undefined,
  screen: string | undefined,
): boolean {
  return (
    (type != null && HOUSE_NOTIFICATION_TYPES.has(type)) ||
    (screen != null && HOUSE_NOTIFICATION_SCREENS.has(screen))
  );
}

function runRoute(action: () => void, options?: NotificationRouteOptions) {
  if (options?.beforeNavigate) {
    options.beforeNavigate();
    navigateAfterInteractions(action);
  } else {
    action();
  }
}

/** After accepting an invite or join approval, switch household and reload data. */
export function syncJoinedHousehold(
  householdId?: string,
  refreshHouseholdData?: () => Promise<void>
) {
  const store = useHouseholdStore.getState();
  return store
    .fetchHouseholds()
    .then(() => {
      if (householdId) {
        const hh = useHouseholdStore.getState().households.find((h) => h.id === householdId);
        if (hh) useHouseholdStore.getState().setCurrentHousehold(hh);
      }
      return refreshHouseholdData?.();
    })
    .catch((err) => console.warn('[notificationRouting] household sync failed:', err));
}

/** Invitee tapped a household invitation — accept or decline in-app. */
export function promptHouseholdInvitation(
  invitationId: string,
  householdName: string,
  householdId?: string,
  refreshHouseholdData?: () => Promise<void>
) {
  Alert.alert(
    'Join Property',
    `You've been invited to join "${householdName}". Accept?`,
    [
      {
        text: 'Decline',
        style: 'destructive',
        onPress: () => {
          householdsApi
            .declineInvitationInApp(invitationId)
            .catch((err) => console.warn('[notificationRouting] decline invite failed:', err));
        },
      },
      {
        text: 'Accept',
        onPress: () => {
          householdsApi
            .acceptInvitationInApp(invitationId)
            .then(() => syncJoinedHousehold(householdId, refreshHouseholdData))
            .catch((err) => {
              console.warn('[notificationRouting] accept invite failed:', err);
              Alert.alert(
                'Could not join',
                err instanceof Error ? err.message : 'Please try again.'
              );
            });
        },
      },
    ]
  );
}

/**
 * Shared tap handler for push notifications and the in-app notification list.
 * Returns true when the payload was recognized and handled.
 */
export function routeNotificationTap(
  data: Record<string, unknown>,
  options?: NotificationRouteOptions
): boolean {
  const type = typeof data.type === 'string' ? data.type : undefined;
  const screen = typeof data.screen === 'string' ? data.screen : undefined;
  const updateType = typeof data.updateType === 'string' ? data.updateType : undefined;
  const invitationType =
    typeof data.invitationType === 'string' ? data.invitationType : undefined;

  // Child apps (Budget, Kaizen, …) don't host House screens: a stale House push
  // or deep link lands on home instead of a screen the app no longer surfaces.
  if (!isHouseBrand() && isHouseDomainNotification(type, screen)) {
    runRoute(() => router.push('/'), options);
    return true;
  }

  // Symply Health reminders. Checked BEFORE the House block below because the
  // brand guard is the inverse one: these belong to Health and must be sent home
  // on every OTHER app, including House.
  if (type != null && HEALTH_NOTIFICATION_TYPES.has(type)) {
    if (!isHealthCapableBrand()) {
      runRoute(() => router.push('/'), options);
      return true;
    }
    // The Worker puts the destination in `data.screen`; the table is the
    // fallback for a row written before that key existed, and the guard against
    // a payload naming a route this build does not have.
    const declared = typeof data.screen === 'string' ? data.screen : undefined;
    const target =
      declared && Object.values(HEALTH_NOTIFICATION_ROUTES).includes(declared)
        ? declared
        : (HEALTH_NOTIFICATION_ROUTES[type] ?? '/');
    runRoute(() => router.push(target as '/'), options);
    return true;
  }

  // "Your home backup is overdue" — the local nag `house/local/backup/autoBackup`
  // schedules when a due backup has gone days without the app being opened.
  // Land on the screen that can fix it, not on Home: the whole point of the
  // notification is that nobody has opened the app, so asking them to go find
  // Settings → Backup & Restore afterwards wastes the one tap we got.
  if (type === 'house_auto_backup_overdue') {
    runRoute(() => router.push(isHouseBrand() ? '/house-backup' : '/'), options);
    return true;
  }

  // AI key disconnected — open the provider hub so the user can reconnect.
  // Shared across all brands (BYOK is ecosystem-wide), so it's intentionally
  // NOT in HOUSE_NOTIFICATION_TYPES.
  // A household member shared their AI key, or stopped. Same destination as
  // `ai_disconnected` — the provider hub is where the shared key is accepted
  // and used — and shared across brands for the same reason.
  if (type === 'ai_disconnected' || type === 'ai_key_shared') {
    runRoute(() => router.push('/ai-access/manage'), options);
    return true;
  }

  if (type === 'aihousekeeper_briefing') {
    runRoute(() => {
      if (typeof data.date === 'string' && data.date) {
        router.push(`/briefing/${data.date}`);
      } else {
        router.push('/aihousekeeper-briefings');
      }
    }, options);
    return true;
  }

  if (
    type === 'task_reminder' ||
    type === 'task_overdue' ||
    type === 'task_assigned' ||
    type === 'task_due_soon' ||
    type === 'task_due_today' ||
    screen === 'TaskDetail'
  ) {
    const taskId = typeof data.taskId === 'string' ? data.taskId : undefined;
    if (taskId) {
      runRoute(() => navigateToTask(taskId), options);
      return true;
    }
  }

  if (
    type === 'task_drafts_ready' ||
    type === 'drafts_ready' ||
    type === 'critical_drafts' ||
    screen === 'TaskDrafts'
  ) {
    const reportId = typeof data.reportId === 'string' ? data.reportId : undefined;
    const reportName = typeof data.reportName === 'string' ? data.reportName : undefined;
    if (reportId) {
      runRoute(() => navigateToTaskDrafts(reportId, reportName), options);
      return true;
    }
  }

  if (type === 'task_draft_detail' || type === 'draft_detail' || screen === 'TaskDraftDetail') {
    const draftId = typeof data.draftId === 'string' ? data.draftId : undefined;
    if (draftId) {
      runRoute(() => navigateToTaskDraftDetail(draftId), options);
      return true;
    }
  }

  if (type === 'maintenance_suggestions' || type === 'maintenance_setup' || screen === 'MaintenanceSetup') {
    const reportId = typeof data.reportId === 'string' ? data.reportId : undefined;
    runRoute(() => navigateToMaintenanceSetup(reportId), options);
    return true;
  }

  if (
    type === 'report_ready' ||
    type === 'critical_findings' ||
    screen === 'ReportDetail'
  ) {
    const reportId = typeof data.reportId === 'string' ? data.reportId : undefined;
    const householdId = typeof data.householdId === 'string' ? data.householdId : undefined;
    if (reportId && householdId) {
      runRoute(() => navigateToReport(reportId, householdId), options);
      return true;
    }
  }

  // --- Household invite / membership (push + in-app must match) ---

  // Invitee: email invitation to an existing app user.
  if (invitationType === 'invitation_received' || screen === 'AcceptInvite') {
    const invitationId = typeof data.invitationId === 'string' ? data.invitationId : undefined;
    const householdId = typeof data.householdId === 'string' ? data.householdId : undefined;
    const householdName =
      typeof data.householdName === 'string' ? data.householdName : 'this property';
    if (invitationId) {
      options?.beforeNavigate?.();
      promptHouseholdInvitation(
        invitationId,
        householdName,
        householdId,
        options?.refreshHouseholdData
      );
      return true;
    }
  }

  // Requester: owner declined their join request.
  if (updateType === 'join_request_denied') {
    const householdId = typeof data.householdId === 'string' ? data.householdId : undefined;
    const householdName =
      typeof data.householdName === 'string' ? data.householdName : 'this property';
    void useMemberStore.getState().refreshMyJoinRequests();
    if (householdId) {
      useInviteStore.getState().setJoinRequestOutcome({ householdId, status: 'denied' });
    }
    options?.beforeNavigate?.();
    Alert.alert(
      'Request Declined',
      `Your request to join "${householdName}" was declined by the owner.`
    );
    return true;
  }

  // Owner: pending join request, new member joined, member left, etc.
  if (
    screen === 'HouseholdMembers' ||
    updateType === 'join_request_received' ||
    updateType === 'join_request_approved' ||
    updateType === 'invitation_accepted' ||
    updateType === 'member_left' ||
    updateType === 'member_removed'
  ) {
    const householdId = typeof data.householdId === 'string' ? data.householdId : undefined;
    if (updateType === 'join_request_approved') {
      void useMemberStore.getState().refreshMyJoinRequests();
      if (householdId) {
        useInviteStore.getState().setJoinRequestOutcome({ householdId, status: 'approved' });
        // Wait for the household/membership sync before navigating — landing on
        // the Members screen before this resolves can race the screen's own
        // fetch and surface a stale/empty list right after approval.
        syncJoinedHousehold(householdId, options?.refreshHouseholdData).finally(() => {
          runRoute(() => navigateToHouseholdMembers(householdId), options);
        });
        return true;
      }
    }
    if (householdId) {
      runRoute(() => navigateToHouseholdMembers(householdId), options);
      return true;
    }
  }

  if (screen === 'GarbageCollection' || type === 'garbage_collection') {
    runRoute(() => navigateToGarbageCollection(), options);
    return true;
  }

  if (type === 'garden_plan_ready') {
    const gardenPlanId =
      typeof data.garden_plan_id === 'string' ? data.garden_plan_id : undefined;
    runRoute(() => navigateToGardening(gardenPlanId), options);
    return true;
  }

  if (type === 'garden_plan_failed') {
    runRoute(() => navigateToGardening(), options);
    return true;
  }

  if (
    type === 'home_project_blocker_added' ||
    type === 'home_project_budget_over' ||
    type === 'home_project_phase_due' ||
    type === 'home_project_selection_approved' ||
    type === 'home_project_schematic_ready' ||
    type === 'home_project_schematic_failed' ||
    type === 'home_project_mentioned'
  ) {
    const projectId =
      typeof data.project_id === 'string'
        ? data.project_id
        : typeof data.home_project_id === 'string'
          ? data.home_project_id
          : typeof data.projectId === 'string'
            ? data.projectId
            : undefined;
    runRoute(() => navigateToHomeProject(projectId), options);
    return true;
  }

  // House home enrolment — someone claimed an invite, or a claim of ours was
  // approved / cancelled / expired. Every one of these is answered on the same
  // hub, so they route together; matched on `updateType` because the Worker
  // sends them all as the shared `household_update` type.
  //
  // BEFORE the Budget branch, and brand-guarded, because the two sets overlap:
  // the `budget_*` names shipped first and the shared `/v2` routes sent them to
  // every brand, House included. On House those payloads are House's own invite
  // events and must open House's hub; on any other brand this branch does not
  // run at all.
  if (
    isHouseBrand() &&
    ((updateType && HOUSE_INVITE_UPDATE_TYPES.has(updateType)) || screen === 'HouseInvite')
  ) {
    // Nudge first, then navigate: the hub may already be mounted, in which case
    // the push IS the only thing that will make it re-read.
    useHouseEnrolmentSignal.getState().bump();
    runRoute(() => navigateToHouseInvite(), options);
    return true;
  }

  // Budget household enrolment — the same four events on the Budget brand.
  if (
    (updateType && BUDGET_INVITE_UPDATE_TYPES.has(updateType)) ||
    screen === 'BudgetInvite'
  ) {
    if (isBudgetOff()) {
      runRoute(() => router.push('/'), options);
      return true;
    }
    // Nudge first, then navigate: the screen may already be mounted, in which
    // case the push IS the only thing that will make it re-read.
    useBudgetEnrolmentSignal.getState().bump();
    runRoute(() => navigateToBudgetInvite(), options);
    return true;
  }

  if (type === 'budget_reminder' || screen === 'BudgetSettings') {
    if (isBudgetOff()) {
      runRoute(() => router.push('/'), options);
      return true;
    }
    const year = typeof data.year === 'string' ? parseInt(data.year, 10) : undefined;
    const month = typeof data.month === 'string' ? parseInt(data.month, 10) : undefined;
    if (year && month) {
      useBudgetStore.getState().setSelectedMonth(year, month);
    }
    runRoute(
      () => navigateToBudget(isFullBudget() ? 'BudgetSettings' : 'BudgetMain'),
      options,
    );
    return true;
  }

  if (
    type === 'budget_alert' ||
    type === 'budget_digest' ||
    type === 'budget_encouragement' ||
    screen === 'BudgetMain'
  ) {
    if (isBudgetOff()) {
      runRoute(() => router.push('/'), options);
      return true;
    }
    runRoute(() => navigateToBudget(), options);
    return true;
  }

  if (type === 'savings_pace') {
    if (isBudgetOff()) {
      runRoute(() => router.push('/'), options);
      return true;
    }
    runRoute(
      () =>
        navigateToBudget(
          'BudgetMain',
          isFullBudget() ? { activeView: 'savings' } : undefined,
        ),
      options,
    );
    return true;
  }

  // Mortgage reminders (renewal window, or the monthly "upload your statement"
  // nudge) → the Mortgage tab (Budget-only). The tab wrapper itself redirects to
  // '/' when the brand isn't full-budget.
  if (type === 'mortgage_renewal' || type === 'mortgage_statement_reminder') {
    runRoute(() => router.push(isBudgetOff() ? '/' : '/mortgage'), options);
    return true;
  }

  // Renewal reminders for Monthly Payments (condo/car insurance, warranties,
  // memberships, licenses — Budget-only) → Savings' Monthly Payments list.
  // Lands on the list rather than deep-linking into the specific item's edit
  // modal — the row's "Renews in N days" pill makes the right item obvious.
  if (type === 'budget_renewal_reminder') {
    runRoute(
      () => navigateToBudget('BudgetMain', isFullBudget() ? { activeView: 'savings' } : undefined),
      options,
    );
    return true;
  }

  // Monthly income rollover — "confirm this month's carried-over income"
  // (Budget-only) → Savings, where drafts show a "Draft" badge + Confirm action.
  if (type === 'savings_income_rollover_reminder') {
    runRoute(
      () => navigateToBudget('BudgetMain', isFullBudget() ? { activeView: 'savings' } : undefined),
      options,
    );
    return true;
  }

  // "This payment is due soon" (Budget-only, non-automated recurring
  // payments) → Savings, same landing as the other savings reminders above;
  // the Monthly Payments list is one tap away via "Manage".
  if (type === 'savings_recurring_payment_due_reminder') {
    runRoute(
      () => navigateToBudget('BudgetMain', isFullBudget() ? { activeView: 'savings' } : undefined),
      options,
    );
    return true;
  }

  // Household chat — registry-driven so every app's chat (House, Budget, and any
  // future app) routes the same way with no per-app branch. Each config's push
  // types + `screen` sentinel identify it; its `route.host` is the expo-router
  // path to open. Data stays isolated (each app's pushes carry its own types).
  for (const chatConfig of CHAT_CONFIGS) {
    const matches =
      type === chatConfig.notif.messageType ||
      type === chatConfig.notif.mentionType ||
      screen === chatConfig.route.screen;
    if (!matches) continue;

    const roomId = typeof data.roomId === 'string' ? data.roomId : undefined;
    if (!roomId) break;

    const roomName = typeof data.roomName === 'string' ? data.roomName : undefined;
    const householdId = typeof data.householdId === 'string' ? data.householdId : undefined;
    const navNonce = String(options?.navNonce ?? Date.now());

    const openRoom = () =>
      router.push({
        pathname: chatConfig.route.host as '/chat',
        params: {
          roomId,
          ...(roomName ? { roomName } : {}),
          navNonce,
        },
      });

    // The room lives in `householdId`, which may not be the household the app
    // is currently showing (e.g. the user was just added to another home and
    // tapped its chat notification). Switch first so the room screen loads
    // messages + marks read against the correct household — otherwise the
    // room 404s and shows empty with its unread counter stuck.
    const currentHouseholdId = useHouseholdStore.getState().currentHousehold?.id;
    if (householdId && householdId !== currentHouseholdId) {
      options?.beforeNavigate?.();
      void syncJoinedHousehold(householdId, options?.refreshHouseholdData).finally(() =>
        navigateAfterInteractions(openRoom)
      );
    } else {
      runRoute(openRoom, options);
    }
    return true;
  }

  return false;
}
