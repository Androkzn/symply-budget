import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { queryClient } from '@/lib/queryClient';
import { householdsApi } from '@api/households';
import { isFullBudget, isHouseBrand } from '@brand';
import { useData } from '@contexts/DataContext';
import {
  signalBudgetInviteUpdate,
  signalBudgetMemberUpdate,
} from '@features/budget/local/enrolmentSignal';
import { handleBudgetSyncWakeNotification } from '@features/budget/local/pushWake';
import { CHAT_CONFIGS, budgetChatConfig, houseChatConfig, refreshChatUnread } from '@features/chat';
import { isHealthLocalFirst } from '@features/health/local/flag';
import { handleHealthSyncWakeNotification } from '@features/health/local/pushWake';
import {
  signalHouseInviteUpdate,
  signalHouseMemberUpdate,
} from '@features/house/local/enrolmentSignal';
import { handleHouseSyncWakeNotification } from '@features/house/local/pushWake';
import { householdMembersQueryKey } from '@hooks/useHouseholdMembers';
import { refreshMovementFeed } from '@hooks/useMovementFeed';
import { routeNotificationTap, syncJoinedHousehold } from '@services/notificationRouting';
import { useHouseholdStore } from '@stores/householdStore';
import { useInviteStore } from '@stores/inviteStore';
import { useMemberStore } from '@stores/memberStore';
import { useNotificationStore } from '@stores/notificationStore';
import { logMovementFeed } from '@utils/movementFeedDebug';

const HOUSEHOLD_MEMBER_UPDATE_TYPES = new Set([
  'member_left',
  'member_removed',
  'join_request_received',
  'invitation_accepted',
  'join_request_approved',
]);

function handleHouseholdPushData(
  data: Record<string, unknown> | undefined,
  refreshHouseholdData: () => Promise<void>
) {
  if (!data) return;

  // Local-first home / household enrolment — claimed / approved / revoked /
  // expired.
  //
  // Handled before the legacy membership block below because these carry their
  // own `updateType` vocabulary and none of the server-side membership
  // refreshes apply: a local-first home has no server member list to re-fetch.
  // All the app does is note that something moved, so an open enrolment screen
  // re-reads the control plane (see each brand's `enrolmentSignal`).
  //
  // House first, and brand-guarded inside itself: the two vocabularies overlap
  // because the `budget_*` names shipped first and the shared `/v2` routes sent
  // them to every brand. On House they are House's own events.
  //
  // A MEMBERSHIP event is handled alongside them, and it is the one that acts:
  // `house_member_removed` / `budget_member_removed` send the removed device to
  // check the control plane and take that household — every row of it — off
  // this phone. Both brands wire it; only the signal differs.
  if (isHouseBrand()) {
    if (signalHouseInviteUpdate(data) || signalHouseMemberUpdate(data)) return;
  } else if (signalBudgetInviteUpdate(data) || signalBudgetMemberUpdate(data)) {
    return;
  }

  const updateType = typeof data.updateType === 'string' ? data.updateType : undefined;
  const householdId = typeof data.householdId === 'string' ? data.householdId : undefined;

  if (updateType === 'join_request_approved') {
    logMovementFeed('push: join_request_approved', { householdId });
    void useMemberStore.getState().refreshMyJoinRequests();
    if (householdId) {
      useInviteStore.getState().setJoinRequestOutcome({ householdId, status: 'approved' });
    }
    void syncJoinedHousehold(householdId, refreshHouseholdData);
    return;
  }

  if (updateType === 'join_request_denied') {
    logMovementFeed('push: join_request_denied', { householdId });
    void useMemberStore.getState().refreshMyJoinRequests();
    if (householdId) {
      useInviteStore.getState().setJoinRequestOutcome({ householdId, status: 'denied' });
    }
    return;
  }

  if (householdId && updateType && HOUSEHOLD_MEMBER_UPDATE_TYPES.has(updateType)) {
    logMovementFeed('push: household member update', { householdId, updateType });
    const memberStore = useMemberStore.getState();
    // Prefetch RQ members cache (A7); join-request state stays on the store.
    void queryClient.prefetchQuery({
      queryKey: householdMembersQueryKey(householdId),
      queryFn: async () => {
        const householdData = await householdsApi.get(householdId);
        return householdData.members;
      },
    });
    memberStore.fetchJoinRequests(householdId).catch(() => undefined);
    memberStore.refreshOwnerJoinRequests().catch(() => undefined);
  }
}

/**
 * Route an opaque local-first sync wake to whichever brand's ledger it names.
 *
 * Returns true when the notification was consumed, so the caller does not also
 * route it as a domain notification — a wake carries no user-facing content by
 * design (`{ type, householdId }` and nothing else), so routing it as one would
 * surface an empty notification.
 *
 * All three handlers are hard-equality filters on their own `<brand>_sync_wake`
 * type and each returns false when its own brand flag is off, so exactly one can
 * ever claim a given payload.
 *
 * ⚠️ House's handler was exported (`house/local/index.ts:118`) and never wired
 * here — a House build has been receiving `house_sync_wake` pushes and dropping
 * them since H4. Health inherits nothing from that gap: both are routed below
 * (plan §2 item 4d).
 */
function consumeLocalFirstSyncWake(data: Record<string, unknown> | undefined): boolean {
  if (handleBudgetSyncWakeNotification(data)) return true;
  if (handleHouseSyncWakeNotification(data)) return true;
  // Belt-and-braces flag gate: the handler checks `isHealthLocalFirst()` itself,
  // but a flag-0 build must not take one step down the Health path (plan §5.1).
  if (isHealthLocalFirst() && handleHealthSyncWakeNotification(data)) return true;
  return false;
}

/**
 * Notification handler hook for the expo-router root.
 *
 * Push notification taps and the in-app notification list both route through
 * `@services/notificationRouting` so household invites behave identically.
 */
export function useNotificationHandler({ enabled }: { enabled: boolean }) {
  const { refreshActivePropertyData } = useData();
  const responseListener = useRef<Notifications.Subscription | undefined>(undefined);
  const receivedListener = useRef<Notifications.Subscription | undefined>(undefined);

  const refreshActivePropertyDataRef = useRef(refreshActivePropertyData);
  refreshActivePropertyDataRef.current = refreshActivePropertyData;

  const syncBadges = () => {
    logMovementFeed('syncBadges');
    const notifStore = useNotificationStore.getState();
    void (async () => {
      const hasPermission = await notifStore.checkPermission();
      logMovementFeed('syncBadges permission', { hasPermission });
      if (hasPermission) {
        await notifStore.registerPushToken();
      }
      await refreshMovementFeed('syncBadges');
    })();

    const hid = useHouseholdStore.getState().currentHousehold?.id;
    if (hid) {
      useMemberStore.getState().fetchJoinRequests(hid).catch(() => undefined);
    }
    // Keep the Chat tab unread badge fresh on every foreground.
    if (isHouseBrand()) void refreshChatUnread(houseChatConfig, hid);
    // Budget's floating-chat badge is a separate, isolated feed (same shared code).
    if (isFullBudget()) void refreshChatUnread(budgetChatConfig, hid);
  };

  useEffect(() => {
    if (!enabled) {
      logMovementFeed('useNotificationHandler disabled');
      return undefined;
    }

    logMovementFeed('useNotificationHandler enabled');
    syncBadges();

    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') syncBadges();
    });
    return () => sub.remove();
     
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;

    receivedListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('[NotificationHandler] received in foreground:', notification);
        void refreshMovementFeed('push-foreground');

        const data = notification.request.content.data as Record<string, unknown> | undefined;
        if (consumeLocalFirstSyncWake(data)) {
          return;
        }
        handleHouseholdPushData(data, () => refreshActivePropertyDataRef.current());

        // A chat message arrived while the app is foregrounded — refresh the
        // matching chat's unread badge so it reflects the new activity
        // immediately. Registry-driven, so every app's chat (House, Budget, and
        // any future app) is handled the same way with no per-app branch.
        for (const chatConfig of CHAT_CONFIGS) {
          if (
            data?.type === chatConfig.notif.messageType ||
            data?.type === chatConfig.notif.mentionType
          ) {
            void refreshChatUnread(
              chatConfig,
              typeof data.householdId === 'string' ? data.householdId : undefined
            );
          }
        }
      }
    );

    return () => {
      receivedListener.current?.remove();
      receivedListener.current = undefined;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;

    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as
          | Record<string, unknown>
          | undefined;
        console.log('[NotificationHandler] tap, data=', data);

        useNotificationStore.getState().refreshUnreadCount();

        if (!data) return;

        if (consumeLocalFirstSyncWake(data)) {
          return;
        }

        handleHouseholdPushData(data, () => refreshActivePropertyDataRef.current());

        routeNotificationTap(data, {
          navNonce: response.notification.date,
          refreshHouseholdData: () => refreshActivePropertyDataRef.current(),
        });
      }
    );

    return () => {
      responseListener.current?.remove();
      responseListener.current = undefined;
    };
  }, [enabled]);
}
