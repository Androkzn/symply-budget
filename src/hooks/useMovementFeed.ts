import { useCallback } from 'react';

import { queryClient } from '@/lib/queryClient';
import {
  notificationHistoryQueryKey,
  notificationUnreadQueryKey,
} from '@hooks/useNotificationHistory';
import { captureException } from '@services/monitoring';
import { useAuthStore } from '@stores/authStore';
import { useMemberStore } from '@stores/memberStore';
import { useNotificationStore } from '@stores/notificationStore';
import { logMovementFeed, logMovementFeedError, decodeJwtSub } from '@utils/movementFeedDebug';

/**
 * How often the app re-asks for movement-feed state while it is foregrounded.
 *
 * Lives here rather than on any one screen because the refresh is app-wide:
 * it was previously a `HomeScreen` constant, which is exactly why nothing
 * arrived anywhere else.
 */
export const MOVEMENT_FEED_POLL_MS = 20_000;

/** Refresh owner join requests + in-app household activity for the Movement Feed. */
export async function refreshMovementFeed(source = 'unknown'): Promise<void> {
  const started = Date.now();
  const auth = useAuthStore.getState();
  logMovementFeed('refresh start', {
    source,
    isAuthenticated: auth.isAuthenticated,
    hasToken: !!auth.token,
    tokenSub: decodeJwtSub(auth.token),
    storeUserId: auth.user?.id,
  });

  const memberStore = useMemberStore.getState();
  const notifStore = useNotificationStore.getState();

  try {
    await Promise.all([
      memberStore.refreshOwnerJoinRequests(),
      memberStore.refreshMyJoinRequests(),
      notifStore.refreshUnreadCount(),
      // RQ owns notification history; invalidate instead of dual store load (A7).
      queryClient.invalidateQueries({ queryKey: notificationHistoryQueryKey }),
      // …and the unread slice behind the Notifications "Active" tab, which a
      // freshly arrived push adds to.
      queryClient.invalidateQueries({ queryKey: notificationUnreadQueryKey }),
    ]);

    const member = useMemberStore.getState();
    const notif = useNotificationStore.getState();
    const cached =
      queryClient.getQueryData<{ notifications: Array<{ type: string; read_at: string | null }> }>(
        notificationHistoryQueryKey
      );
    const householdActivity = (cached?.notifications ?? notif.notifications).filter(
      (n) => n.type === 'household_update'
    );

    logMovementFeed('refresh done', {
      source,
      ms: Date.now() - started,
      ownerPendingJoinRequests: member.ownerPendingJoinRequests.length,
      myPendingJoinRequests: member.myPendingJoinRequests.length,
      unreadCount: notif.unreadCount,
      notificationCount: cached?.notifications.length ?? notif.notifications.length,
      unreadHouseholdUpdates: householdActivity.filter((n) => !n.read_at).length,
      ownerRequests: member.ownerPendingJoinRequests.map((r) => ({
        id: r.id,
        household: r.household_name,
        email: r.email,
      })),
    });
  } catch (error) {
    logMovementFeedError(`refresh failed (${source})`, error);
    captureException(error, { source: 'MovementFeed', refreshSource: source });
    throw error;
  }
}

export function useMovementFeedRefresh() {
  return useCallback(() => {
    void refreshMovementFeed('useMovementFeedRefresh');
  }, []);
}
