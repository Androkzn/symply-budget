import { create } from 'zustand';

import { notificationService } from '@services/notifications';

import { effectiveUnreadCount } from '../services/focusSurfaces';
import {
  attachNotificationInboxListener,
  clearInbox,
  listInboxNotifications,
  markAllInboxRead,
  markInboxRead,
  syncScheduledIntoInbox,
  unreadInboxCount,
  type KaizenInboxNotification,
} from '../services/notificationInbox';

interface NotificationState {
  permissionGranted: boolean;
  isRegistering: boolean;
  error: string | null;
  unreadCount: number;
  inbox: KaizenInboxNotification[];
}

interface NotificationActions {
  initialize: () => Promise<void>;
  registerPushToken: () => Promise<void>;
  refreshInbox: () => Promise<void>;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  setUnreadCount: (count: number) => void;
  reset: () => void;
}

type NotificationStore = NotificationState & NotificationActions;

const initialState: NotificationState = {
  permissionGranted: false,
  isRegistering: false,
  error: null,
  unreadCount: 0,
  inbox: [],
};

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  ...initialState,

  initialize: async () => {
    set({ isRegistering: true, error: null });
    try {
      attachNotificationInboxListener();
      const token = await notificationService.initialize();
      const granted = await notificationService.hasPermission();
      // Permission can be granted even when Expo push token fails (common on Simulator).
      set({ permissionGranted: granted });
      if (token) await notificationService.registerWithServer();
      await get().refreshInbox();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Could not register notifications',
      });
    } finally {
      set({ isRegistering: false });
    }
  },

  registerPushToken: async () => {
    set({ isRegistering: true, error: null });
    try {
      const token = await notificationService.initialize();
      const granted = await notificationService.hasPermission();
      set({ permissionGranted: granted });
      if (token) await notificationService.registerWithServer();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Could not register notifications',
      });
    } finally {
      set({ isRegistering: false });
    }
  },

  refreshInbox: async () => {
    await syncScheduledIntoInbox();
    const inbox = listInboxNotifications();
    set({ inbox, unreadCount: effectiveUnreadCount(unreadInboxCount(), inbox) });
  },

  markRead: id => {
    markInboxRead(id);
    const inbox = listInboxNotifications();
    set({ inbox, unreadCount: effectiveUnreadCount(unreadInboxCount(), inbox) });
  },

  markAllRead: () => {
    markAllInboxRead();
    const inbox = listInboxNotifications();
    set({ inbox, unreadCount: 0 });
  },

  clearAll: () => {
    clearInbox();
    set({ inbox: [], unreadCount: 0 });
  },

  setUnreadCount: count => set({ unreadCount: Math.max(0, count) }),

  reset: () => set(initialState),
}));
