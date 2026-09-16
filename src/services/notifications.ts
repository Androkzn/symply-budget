import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { notificationsApi, type NotificationPreferences } from '@api/notifications';
import { logMovementFeed, logMovementFeedError } from '@utils/movementFeedDebug';

import { publishNotificationPermission } from './notificationPermissionEvents';

// Notification category identifiers (must match backend)
export const NOTIFICATION_CATEGORIES = {
  TASK_REMINDER: 'task_reminder',
  TASK_OVERDUE: 'task_overdue',
  GARBAGE_REMINDER: 'garbage_reminder',
} as const;

// Notification action identifiers
export const NOTIFICATION_ACTIONS = {
  SNOOZE_1_DAY: 'snooze_1_day',
  SNOOZE_1_HOUR: 'snooze_1_hour',
  MARK_COMPLETE: 'mark_complete',
  VIEW_DETAILS: 'view_details',
  DISMISS: 'dismiss',
} as const;

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const IOS_PERMISSIONS: Notifications.IosNotificationPermissionsRequest = {
  allowAlert: true,
  allowBadge: true,
  allowSound: true,
};

/**
 * Set up notification categories with action buttons (2026 best practice)
 * This allows users to take quick actions directly from the notification
 */
async function setupNotificationCategories(): Promise<void> {
  if (Platform.OS === 'ios') {
    await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORIES.TASK_REMINDER, [
      {
        identifier: NOTIFICATION_ACTIONS.SNOOZE_1_DAY,
        buttonTitle: 'Snooze 1 Day',
        options: { opensAppToForeground: false },
      },
      {
        identifier: NOTIFICATION_ACTIONS.MARK_COMPLETE,
        buttonTitle: 'Mark Complete',
        options: { opensAppToForeground: false },
      },
      {
        identifier: NOTIFICATION_ACTIONS.VIEW_DETAILS,
        buttonTitle: 'View',
        options: { opensAppToForeground: true },
      },
    ]);

    await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORIES.TASK_OVERDUE, [
      {
        identifier: NOTIFICATION_ACTIONS.SNOOZE_1_HOUR,
        buttonTitle: 'Snooze 1 Hour',
        options: { opensAppToForeground: false },
      },
      {
        identifier: NOTIFICATION_ACTIONS.MARK_COMPLETE,
        buttonTitle: 'Complete Now',
        options: { opensAppToForeground: false },
      },
      {
        identifier: NOTIFICATION_ACTIONS.VIEW_DETAILS,
        buttonTitle: 'View',
        options: { opensAppToForeground: true },
      },
    ]);

    await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORIES.GARBAGE_REMINDER, [
      {
        identifier: NOTIFICATION_ACTIONS.SNOOZE_1_HOUR,
        buttonTitle: 'Remind in 1 Hour',
        options: { opensAppToForeground: false },
      },
      {
        identifier: NOTIFICATION_ACTIONS.DISMISS,
        buttonTitle: 'Done',
        options: { opensAppToForeground: false },
      },
    ]);
  }

  // Android handles actions differently through notification channels
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('task_reminders', {
      name: 'Task Reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4A90D9',
    });

    await Notifications.setNotificationChannelAsync('garbage_reminders', {
      name: 'Garbage Collection',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4CAF50',
    });
  }
}

class NotificationService {
  private expoPushToken: string | null = null;
  private categoriesSetUp = false;

  async initialize(): Promise<string | null> {
    if (!Device.isDevice) {
      console.log('Push notifications require a physical device');
      return null;
    }

    // Check existing permissions
    const existingPermission = await Notifications.getPermissionsAsync();
    publishNotificationPermission(existingPermission);
    const existingStatus = existingPermission.status;
    let finalStatus = existingStatus;

    // Request permissions if not granted
    if (existingStatus !== 'granted') {
      const response = await Notifications.requestPermissionsAsync({
        ios: IOS_PERMISSIONS,
      });
      publishNotificationPermission(response);
      finalStatus = response.status;
    }

    if (finalStatus !== 'granted') {
      logMovementFeed('push permission not granted', { status: finalStatus });
      return null;
    }

    // Set up notification categories with action buttons (2026 best practice)
    if (!this.categoriesSetUp) {
      await setupNotificationCategories();
      this.categoriesSetUp = true;
      console.log('Notification categories set up');
    }

    // Get Expo push token
    try {
      // Try multiple ways to get projectId (works in both managed and bare workflow)
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ||
        Constants.easConfig?.projectId ||
        Constants.manifest2?.extra?.expoClient?.extra?.eas?.projectId ||
        '349d934d-f0ca-4dab-ba2a-a4d6c54df62e'; // Fallback to hardcoded value

      console.log('Initializing push notifications with projectId:', projectId);

      const token = await Notifications.getExpoPushTokenAsync({
        projectId,
      });

      this.expoPushToken = token.data;
      logMovementFeed('expo push token obtained', {
        tokenPrefix: token.data.slice(0, 20),
        isDevice: Device.isDevice,
      });
      return token.data;
    } catch (error) {
      logMovementFeedError('expo push token failed', error);
      return null;
    }
  }

  /**
   * Check if notification permissions have been granted
   */
  async hasPermission(): Promise<boolean> {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  }

  /**
   * Raw OS permission status without prompting: 'granted' | 'denied' | 'undetermined'.
   * 'undetermined' means the user has never been asked at the OS level.
   */
  async getPermissionStatus() {
    const { status } = await Notifications.getPermissionsAsync();
    return status;
  }

  /**
   * Request notification permissions (2026 best practice: call after user sees value)
   * Returns true if permission was granted
   */
  async requestPermission(): Promise<boolean> {
    const existingPermission = await Notifications.getPermissionsAsync();
    publishNotificationPermission(existingPermission);
    const existingStatus = existingPermission.status;
    if (existingStatus === 'granted') {
      // Set up categories if not already done
      if (!this.categoriesSetUp) {
        await setupNotificationCategories();
        this.categoriesSetUp = true;
      }
      return true;
    }

    const response = await Notifications.requestPermissionsAsync({
      ios: IOS_PERMISSIONS,
    });
    publishNotificationPermission(response);
    if (response.status === 'granted') {
      // Set up categories after permission granted
      await setupNotificationCategories();
      this.categoriesSetUp = true;
      return true;
    }

    return false;
  }

  async registerWithServer(): Promise<void> {
    if (!this.expoPushToken) {
      await this.initialize();
    }

    if (!this.expoPushToken) {
      logMovementFeed('registerWithServer skipped — no expo push token');
      return;
    }

    try {
      // Plan §A7-FE: include app_version so the backend can gate Aihousekeeper-typed
      // pushes (`data.type: 'aihousekeeper_briefing'`) on `app_version >= AIHOUSEKEEPER_MIN_APP_VERSION`.
      // Tokens registered before this column / older clients → backend falls
      // back to `data.type: 'cards_refresh'`.
      const appVersion =
        Constants.expoConfig?.version ??
        undefined;

      await notificationsApi.registerToken({
        token: this.expoPushToken,
        platform: Platform.OS as 'ios' | 'android',
        device_name: Device.deviceName || undefined,
        app_version: appVersion,
      });
      logMovementFeed('push token registered with server', {
        platform: Platform.OS,
        appVersion,
      });
    } catch (error) {
      logMovementFeedError('push token register failed', error);
    }
  }

  async unregisterFromServer(): Promise<void> {
    if (!this.expoPushToken) {
      return;
    }

    try {
      await notificationsApi.unregisterToken(this.expoPushToken);
      console.log('Push token unregistered from server');
    } catch (error) {
      console.error('Error unregistering push token:', error);
    }
  }

  async getPreferences(): Promise<NotificationPreferences | null> {
    try {
      const { preferences } = await notificationsApi.getPreferences();
      return preferences;
    } catch (error) {
      console.error('Error getting notification preferences:', error);
      return null;
    }
  }

  async updatePreferences(
    updates: Partial<NotificationPreferences>
  ): Promise<NotificationPreferences | null> {
    try {
      // Filter out null values from timezone to match UpdatePreferencesRequest type
      // which expects timezone?: string (not string | null)
      const filteredUpdates: Parameters<typeof notificationsApi.updatePreferences>[0] = {};

      if (updates.push_enabled !== undefined) filteredUpdates.push_enabled = updates.push_enabled;
      if (updates.email_enabled !== undefined) filteredUpdates.email_enabled = updates.email_enabled;
      if (updates.quiet_hours_start !== undefined) filteredUpdates.quiet_hours_start = updates.quiet_hours_start;
      if (updates.quiet_hours_end !== undefined) filteredUpdates.quiet_hours_end = updates.quiet_hours_end;
      if (updates.timezone !== undefined && updates.timezone !== null) filteredUpdates.timezone = updates.timezone;
      if (updates.task_reminders !== undefined) filteredUpdates.task_reminders = updates.task_reminders;
      if (updates.task_overdue !== undefined) filteredUpdates.task_overdue = updates.task_overdue;
      if (updates.task_assigned !== undefined) filteredUpdates.task_assigned = updates.task_assigned;
      if (updates.task_completed !== undefined) filteredUpdates.task_completed = updates.task_completed;
      if (updates.household_updates !== undefined) filteredUpdates.household_updates = updates.household_updates;
      if (updates.report_ready !== undefined) filteredUpdates.report_ready = updates.report_ready;
      if (updates.weekly_summary !== undefined) filteredUpdates.weekly_summary = updates.weekly_summary;
      if (updates.garbage_collection !== undefined) filteredUpdates.garbage_collection = updates.garbage_collection;

      const { preferences } = await notificationsApi.updatePreferences(filteredUpdates);
      return preferences;
    } catch (error) {
      console.error('Error updating notification preferences:', error);
      return null;
    }
  }

  async getUnreadCount(): Promise<number> {
    try {
      const { count } = await notificationsApi.getUnreadCount();
      return count;
    } catch (error) {
      console.error('Error getting unread count:', error);
      return 0;
    }
  }

  async setBadgeCount(count: number): Promise<void> {
    try {
      await Notifications.setBadgeCountAsync(count);
    } catch (error) {
      console.error('Error setting badge count:', error);
    }
  }

  // Add notification listeners
  addNotificationReceivedListener(
    callback: (notification: Notifications.Notification) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationReceivedListener(callback);
  }

  addNotificationResponseReceivedListener(
    callback: (response: Notifications.NotificationResponse) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationResponseReceivedListener(callback);
  }

  // Schedule local notification (for testing or local reminders)
  async scheduleLocalNotification(
    title: string,
    body: string,
    trigger: Notifications.NotificationTriggerInput,
    data?: Record<string, unknown>
  ): Promise<string> {
    return Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: true,
      },
      trigger,
    });
  }

  async cancelAllNotifications(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  async cancelNotification(identifier: string): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  }

  /**
   * Extract action identifier from notification response (2026 best practice)
   * Returns the action ID if an action button was pressed, or null if notification was just tapped
   */
  getActionFromResponse(response: Notifications.NotificationResponse): string | null {
    // Check if this was an action button press vs regular tap
    if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      return null; // User just tapped the notification
    }
    return response.actionIdentifier;
  }

  /**
   * Get notification data from response
   */
  getDataFromResponse(response: Notifications.NotificationResponse): Record<string, unknown> | undefined {
    return response.notification.request.content.data as Record<string, unknown> | undefined;
  }

  /**
   * Check if a specific action was taken
   */
  isAction(response: Notifications.NotificationResponse, actionId: string): boolean {
    return response.actionIdentifier === actionId;
  }
}

export const notificationService = new NotificationService();
