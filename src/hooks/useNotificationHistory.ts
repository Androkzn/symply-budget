/**
 * React Query template for notification history (Track A / A7).
 *
 * Pattern:
 *  - Server cache owned by React Query (`usePersistedQuery` for cold-start UX)
 *  - Zustand store keeps UI/ephemeral state (permission, unread badge sync)
 *  - Screen reads `data` from this hook; mutations invalidate the query key
 *
 * See: documents/engineering/react-query-migration.md
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import {
  notificationsApi,
  type NotificationHistoryItem,
} from '@api/notifications';
import { usePersistedQuery } from '@hooks/usePersistedQuery';
import { useMemberStore } from '@stores/memberStore';
import { filterStaleJoinRequestNotifications } from '@stores/notificationStore';
import { brandSupportsNotifications } from '@utils/notificationVisibility';

export const notificationHistoryQueryKey = ['notifications', 'history'] as const;
/**
 * Separate key from the history page above: the "Active" tab needs EVERY unread
 * notification, and history is paginated 20 at a time, so deriving unread from
 * the loaded history page would silently drop anything past page 1 (and
 * disagree with the bell badge, which the server counts across all rows).
 */
export const notificationUnreadQueryKey = ['notifications', 'unread'] as const;

/** One page's worth of unread is plenty for a list a member is meant to clear. */
const UNREAD_PAGE_SIZE = 50;

export interface NotificationHistoryPage {
  notifications: NotificationHistoryItem[];
  nextCursor?: string;
  hasMore: boolean;
}

async function fetchNotificationHistory(
  options: { cursor?: string; unreadOnly?: boolean; limit?: number } = {}
): Promise<NotificationHistoryPage> {
  const { cursor, unreadOnly, limit = 20 } = options;
  const response = await notificationsApi.getHistory({
    limit,
    cursor,
    ...(unreadOnly ? { unread_only: true } : {}),
  });
  const pendingRequestIds = new Set(
    useMemberStore.getState().ownerPendingJoinRequests.map((r) => r.id)
  );
  return {
    notifications: filterStaleJoinRequestNotifications(response.notifications, pendingRequestIds),
    nextCursor: response.nextCursor,
    hasMore: Boolean(response.nextCursor),
  };
}

export function useNotificationHistory(options?: { enabled?: boolean }) {
  const queryClient = useQueryClient();
  const enabled = (options?.enabled ?? true) && brandSupportsNotifications;

  const query = usePersistedQuery<NotificationHistoryPage>({
    queryKey: notificationHistoryQueryKey,
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchNotificationHistory(),
  });

  const loadMore = useCallback(async () => {
    const current = queryClient.getQueryData<NotificationHistoryPage>(notificationHistoryQueryKey);
    if (!current?.hasMore || !current.nextCursor || query.isFetching) {
      return;
    }

    const nextPage = await fetchNotificationHistory({ cursor: current.nextCursor });
    queryClient.setQueryData<NotificationHistoryPage>(notificationHistoryQueryKey, {
      notifications: [...current.notifications, ...nextPage.notifications],
      nextCursor: nextPage.nextCursor,
      hasMore: nextPage.hasMore,
    });
  }, [queryClient, query.isFetching]);

  return { ...query, loadMore };
}

/**
 * Still-unread notifications, newest first — the one-off half of the
 * Notifications screen's "Active" tab (the other half being pending recurring
 * reminders). A notification leaves this list the moment it is read, which is
 * exactly when it stops needing attention and becomes History.
 */
export function useUnreadNotifications(options?: { enabled?: boolean }) {
  const enabled = (options?.enabled ?? true) && brandSupportsNotifications;

  return usePersistedQuery<NotificationHistoryPage>({
    queryKey: notificationUnreadQueryKey,
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchNotificationHistory({ unreadOnly: true, limit: UNREAD_PAGE_SIZE }),
  });
}

/**
 * Invalidate notification lists after mark-read / delete mutations. Both keys,
 * always: every mutation on this screen (read, delete, read-all, clear-all)
 * moves rows between the unread list and the history list.
 */
export function useInvalidateNotificationHistory() {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: notificationHistoryQueryKey }),
      queryClient.invalidateQueries({ queryKey: notificationUnreadQueryKey }),
    ]);
  }, [queryClient]);
}
