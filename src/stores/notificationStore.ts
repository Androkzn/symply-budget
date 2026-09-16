import AsyncStorage from '@react-native-async-storage/async-storage';
import { AxiosError } from 'axios';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import {
  notificationsApi,
  type NotificationPreferences,
  type NotificationHistoryItem,
} from '@api/notifications';
import { captureException } from '@services/monitoring';
import { notificationService } from '@services/notifications';
import { useAuthStore } from '@stores/authStore';
import { useMemberStore } from '@stores/memberStore';
import { logMovementFeed, logMovementFeedError } from '@utils/movementFeedDebug';
import { brandSupportsNotifications } from '@utils/notificationVisibility';

// Storage key for permission prompt tracking (2026 best practice)
const PERMISSION_PROMPTED_KEY = '@notification_permission_prompted';

function matchesJoinRequestNotification(
  notification: NotificationHistoryItem,
  requestId: string
): boolean {
  if (notification.reference_type === 'household_join_request' && notification.reference_id === requestId) {
    return true;
  }
  if (notification.type !== 'household_update' || !notification.data) {
    return false;
  }
  try {
    const data =
      typeof notification.data === 'string'
        ? (JSON.parse(notification.data) as Record<string, unknown>)
        : (notification.data as Record<string, unknown>);
    return data.updateType === 'join_request_received' && data.requestId === requestId;
  } catch {
    return false;
  }
}

function findJoinRequestNotifications(
  notifications: NotificationHistoryItem[],
  requestId: string
): NotificationHistoryItem[] {
  return notifications.filter((n) => matchesJoinRequestNotification(n, requestId));
}

function isJoinRequestReceivedNotification(notification: NotificationHistoryItem): boolean {
  if (notification.title === 'New Join Request') {
    return true;
  }
  if (notification.type !== 'household_update' || !notification.data) {
    return false;
  }
  try {
    const data =
      typeof notification.data === 'string'
        ? (JSON.parse(notification.data) as Record<string, unknown>)
        : (notification.data as Record<string, unknown>);
    return data.updateType === 'join_request_received';
  } catch {
    return false;
  }
}

function getJoinRequestReferenceId(notification: NotificationHistoryItem): string | null {
  if (notification.reference_id) {
    return notification.reference_id;
  }
  if (!notification.data) {
    return null;
  }
  try {
    const data =
      typeof notification.data === 'string'
        ? (JSON.parse(notification.data) as Record<string, unknown>)
        : (notification.data as Record<string, unknown>);
    return typeof data.requestId === 'string' && data.requestId ? data.requestId : null;
  } catch {
    return null;
  }
}

/** Drop handled join-request alerts (including stale cached history rows). */
export function filterStaleJoinRequestNotifications(
  notifications: NotificationHistoryItem[],
  pendingRequestIds: Set<string>
): NotificationHistoryItem[] {
  return notifications.filter((notification) => {
    if (!isJoinRequestReceivedNotification(notification)) {
      return true;
    }
    const requestId = getJoinRequestReferenceId(notification);
    if (!requestId) {
      return false;
    }
    return pendingRequestIds.has(requestId);
  });
}

interface NotificationState {
  preferences: NotificationPreferences | null;
  notifications: NotificationHistoryItem[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  nextCursor: string | undefined;
  // Permission state (2026 best practice: delay until value shown)
  permissionGranted: boolean;
  permissionPrompted: boolean;
}

interface NotificationActions {
  // Initialization
  initialize: () => Promise<void>;
  registerPushToken: () => Promise<void>;
  // Permission handling (2026 best practice)
  requestPermission: () => Promise<boolean>;
  checkPermission: () => Promise<boolean>;

  // Preferences
  loadPreferences: () => Promise<void>;
  updatePreferences: (updates: Partial<NotificationPreferences>) => Promise<void>;

  // Notifications
  // Server list cache — prefer `useNotificationHistory` (React Query template, A7).
  loadNotifications: (refresh?: boolean) => Promise<void>;
  loadMoreNotifications: () => Promise<void>;
  markAsRead: (notificationId: string) => Promise<void>;
  /** Remove owner "join request received" notifications after approve/decline. */
  dismissJoinRequestNotifications: (requestId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;
  deleteAllNotifications: () => Promise<void>;
  refreshUnreadCount: () => Promise<void>;

  // State
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setUnreadCount: (count: number) => void;
  reset: () => void;
}

type NotificationStore = NotificationState & NotificationActions;

const initialState: NotificationState = {
  preferences: null,
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  error: null,
  hasMore: true,
  nextCursor: undefined,
  // Permission state (2026 best practice)
  permissionGranted: false,
  permissionPrompted: false,
};

export const useNotificationStore = create<NotificationStore>()(
  immer((set, get) => ({
    ...initialState,

    initialize: async () => {
      // Symply Language runs on the donor backend, which has no `/notifications/*`
      // API — bootstrapping here would just 404 on every call. Skip it (the bell
      // is also hidden for this brand). See brandSupportsNotifications.
      if (!brandSupportsNotifications) {
        logMovementFeed('notificationStore.initialize skipped — brand has no notification API');
        return;
      }
      logMovementFeed('notificationStore.initialize start');
      try {
        // Check if we've already prompted for permission (2026 best practice)
        const prompted = await AsyncStorage.getItem(PERMISSION_PROMPTED_KEY);
        const status = await notificationService.getPermissionStatus();
        const hasPermission = status === 'granted';

        set((state) => {
          state.permissionPrompted = prompted === 'true';
          state.permissionGranted = hasPermission;
        });

        if (hasPermission) {
          await notificationService.initialize();
          await get().registerPushToken();
          logMovementFeed('push initialized + token registered');
        } else if (status === 'undetermined') {
          // Never asked at the OS level yet — ask right after sign up / login.
          logMovementFeed('push permission undetermined — requesting after sign up/login');
          await get().requestPermission();
        } else {
          logMovementFeed('push skipped — permission previously denied', { status });
        }
        
        await get().loadPreferences();
        await get().refreshUnreadCount();
        await useMemberStore.getState().refreshOwnerJoinRequests();
        await useMemberStore.getState().refreshMyJoinRequests();
        await get().loadNotifications(true);
        logMovementFeed('notificationStore.initialize done', {
          unreadCount: get().unreadCount,
          notificationCount: get().notifications.length,
          permissionGranted: get().permissionGranted,
        });
      } catch (error) {
        logMovementFeedError('notificationStore.initialize failed', error);
        captureException(error, { source: 'NotificationStore', phase: 'initialize' });
      }
    },

    registerPushToken: async () => {
      logMovementFeed('registerPushToken start');
      try {
        await notificationService.registerWithServer();
        try {
          const { registerBudgetLocalPushToken } = await import(
            '@features/budget/local/pushWake'
          );
          await registerBudgetLocalPushToken();
        } catch {
          /* non-budget or local-first off */
        }
        logMovementFeed('registerPushToken done');
      } catch (error) {
        logMovementFeedError('registerPushToken failed', error);
      }
    },

    /**
     * Request notification permission (2026 best practice)
     * Call this AFTER user has seen value (e.g., after creating first task)
     * Returns true if permission was granted
     */
    requestPermission: async () => {
      try {
        // Mark that we've prompted (even if they decline)
        await AsyncStorage.setItem(PERMISSION_PROMPTED_KEY, 'true');
        set((state) => {
          state.permissionPrompted = true;
        });

        const granted = await notificationService.requestPermission();
        set((state) => {
          state.permissionGranted = granted;
        });

        if (granted) {
          // Now initialize fully
          await notificationService.initialize();
          await get().registerPushToken();
        }

        return granted;
      } catch (error) {
        console.error('Error requesting notification permission:', error);
        return false;
      }
    },

    /**
     * Check current permission status without prompting
     */
    checkPermission: async () => {
      try {
        const hasPermission = await notificationService.hasPermission();
        set((state) => {
          state.permissionGranted = hasPermission;
        });
        return hasPermission;
      } catch (error) {
        console.error('Error checking notification permission:', error);
        return false;
      }
    },

    loadPreferences: async () => {
      try {
        const { preferences } = await notificationsApi.getPreferences();
        set((state) => {
          state.preferences = preferences;
        });

        // Keep the backend timezone aligned with the device so notifications and
        // reminders (quiet hours, task reminder time, garbage reminders) fire in
        // the user's local time. Mirrors the Aihousekeeper timezone auto-sync.
        try {
          const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (deviceTimezone && preferences?.timezone !== deviceTimezone) {
            await get().updatePreferences({ timezone: deviceTimezone });
          }
        } catch (tzError) {
          console.error('Error syncing notification timezone:', tzError);
        }
      } catch (error) {
        // A 401 here just means the session expired and the client is already
        // refreshing / logging out — don't surface it as a loud error (it would
        // trigger the red LogBox overlay on every cold start with a stale token).
        if (error instanceof AxiosError && error.response?.status === 401) {
          return;
        }
        console.error('Error loading preferences:', error);
        captureException(error, { source: 'NotificationStore', phase: 'loadPreferences' });
      }
    },

    updatePreferences: async (updates) => {
      try {
        // Filter out null values for timezone to match UpdatePreferencesRequest type
        const filteredUpdates = {
          ...updates,
          timezone: updates.timezone === null ? undefined : updates.timezone,
        };
        const { preferences } = await notificationsApi.updatePreferences(filteredUpdates);
        set((state) => {
          state.preferences = preferences;
        });
      } catch (error) {
        console.error('Error updating preferences:', error);
        throw error;
      }
    },

    loadNotifications: async (refresh = false) => {
      logMovementFeed('loadNotifications start', { refresh });
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const response = await notificationsApi.getHistory({
          limit: 20,
          cursor: refresh ? undefined : get().nextCursor,
        });

        set((state) => {
          const pendingRequestIds = new Set(
            useMemberStore.getState().ownerPendingJoinRequests.map((r) => r.id)
          );
          const sanitized = filterStaleJoinRequestNotifications(
            response.notifications,
            pendingRequestIds
          );

          if (refresh) {
            state.notifications = sanitized;
          } else {
            state.notifications = filterStaleJoinRequestNotifications(
              [...state.notifications, ...sanitized],
              pendingRequestIds
            );
          }
          state.nextCursor = response.nextCursor;
          state.hasMore = !!response.nextCursor;
          state.isLoading = false;
        });

        await get().refreshUnreadCount();
        logMovementFeed('loadNotifications ok', {
          refresh,
          loaded: get().notifications.length,
          householdUpdates: get().notifications.filter((n) => n.type === 'household_update').length,
        });
      } catch (error) {
        logMovementFeedError('loadNotifications failed', error);
        captureException(error, { source: 'NotificationStore', phase: 'loadNotifications' });
        set((state) => {
          state.error = 'Failed to load notifications';
          state.isLoading = false;
        });
      }
    },

    loadMoreNotifications: async () => {
      const { hasMore, isLoading, nextCursor } = get();
      if (!hasMore || isLoading || !nextCursor) return;
      await get().loadNotifications(false);
    },

    markAsRead: async (notificationId) => {
      try {
        await notificationsApi.markAsRead(notificationId);
        set((state) => {
          const notification = state.notifications.find((n) => n.id === notificationId);
          if (notification && !notification.read_at) {
            notification.read_at = new Date().toISOString();
          }
        });
        await get().refreshUnreadCount();
      } catch (error) {
        console.error('Error marking notification as read:', error);
        throw error;
      }
    },

    dismissJoinRequestNotifications: async (requestId) => {
      const pendingRequestIds = useMemberStore.getState().ownerPendingJoinRequests.map((r) => r.id);
      const removeLocally = (items: NotificationHistoryItem[]) => {
        const removeIds = new Set(items.map((n) => n.id));
        set((state) => {
          state.notifications = filterStaleJoinRequestNotifications(
            state.notifications.filter((n) => !removeIds.has(n.id)),
            new Set(pendingRequestIds.filter((id) => id !== requestId))
          );
        });
      };

      let toRemove = findJoinRequestNotifications(get().notifications, requestId);
      removeLocally(toRemove);

      try {
        await notificationsApi.clearJoinRequestNotifications(requestId);
      } catch (error) {
        logMovementFeedError('clearJoinRequestNotifications failed', error);
      }

      if (toRemove.length === 0) {
        await get().loadNotifications(true);
        toRemove = findJoinRequestNotifications(get().notifications, requestId);
        removeLocally(toRemove);
      }

      logMovementFeed('dismissJoinRequestNotifications', {
        requestId,
        count: toRemove.length,
      });

      if (toRemove.length > 0) {
        const results = await Promise.allSettled(
          toRemove.map((n) => notificationsApi.deleteNotification(n.id))
        );
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.length > 0) {
          logMovementFeedError('dismissJoinRequestNotifications delete failed', failed[0]);
        }
      }

      removeLocally(findJoinRequestNotifications(get().notifications, requestId));
      await get().refreshUnreadCount();
    },

    markAllAsRead: async () => {
      try {
        await notificationsApi.markAllAsRead();
        set((state) => {
          state.notifications.forEach((n) => {
            if (!n.read_at) {
              n.read_at = new Date().toISOString();
            }
          });
          state.unreadCount = 0;
        });
        await notificationService.setBadgeCount(0);
      } catch (error) {
        console.error('Error marking all as read:', error);
        throw error;
      }
    },

    deleteNotification: async (notificationId) => {
      try {
        await notificationsApi.deleteNotification(notificationId);
        set((state) => {
          state.notifications = state.notifications.filter((n) => n.id !== notificationId);
        });
        await get().refreshUnreadCount();
      } catch (error) {
        console.error('Error deleting notification:', error);
        throw error;
      }
    },

    deleteAllNotifications: async () => {
      try {
        await notificationsApi.deleteAllNotifications();
        set((state) => {
          state.notifications = [];
          state.unreadCount = 0;
          state.hasMore = false;
          state.nextCursor = undefined;
        });
        await notificationService.setBadgeCount(0);
      } catch (error) {
        console.error('Error clearing notifications:', error);
        throw error;
      }
    },

    refreshUnreadCount: async () => {
      const { token, isAuthenticated } = useAuthStore.getState();
      if (!isAuthenticated || !token) {
        logMovementFeed('refreshUnreadCount skipped — not authenticated');
        return;
      }

      try {
        const { count } = await notificationsApi.getUnreadCount();
        set((state) => {
          state.unreadCount = count;
        });
        await notificationService.setBadgeCount(count);
        logMovementFeed('refreshUnreadCount ok', { count });
      } catch (error) {
        if (error instanceof AxiosError && error.response?.status === 401) {
          logMovementFeed('refreshUnreadCount 401 — waiting for token refresh');
          return;
        }
        logMovementFeedError('refreshUnreadCount failed', error);
      }
    },

    setLoading: (loading) =>
      set((state) => {
        state.isLoading = loading;
      }),

    setError: (error) =>
      set((state) => {
        state.error = error;
      }),

    setUnreadCount: (count) => {
      set((state) => {
        state.unreadCount = count;
      });
      void notificationService.setBadgeCount(count);
    },

    reset: () => set(initialState),
  }))
);
