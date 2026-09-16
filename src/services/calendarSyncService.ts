import * as Calendar from 'expo-calendar';
import * as Clipboard from 'expo-clipboard';
import { Platform, Alert, Linking } from 'react-native';

import { ENV } from '@config/env';

import { Task as MaintenanceTaskResponse } from '../api/tasks';


// Types
export interface DeviceCalendar {
  id: string;
  title: string;
  color: string;
  source: {
    id: string;
    name: string;
    type: string;
  };
  isPrimary: boolean;
  allowsModifications: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  notes?: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  calendarId: string;
  alarms?: { relativeOffset: number }[];
}

export interface SyncResult {
  success: boolean;
  eventId?: string;
  error?: string;
}

class CalendarSyncService {
  private permissionGranted: boolean = false;

  /**
   * Request calendar permissions from the user
   */
  async requestPermissions(): Promise<boolean> {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      this.permissionGranted = status === 'granted';
      
      if (!this.permissionGranted) {
        Alert.alert(
          'Calendar Access Required',
          `${ENV.APP_NAME} needs access to your calendar to sync tasks and appointments. Please enable calendar access in Settings.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'Open Settings', 
              onPress: () => Linking.openSettings() 
            },
          ]
        );
      }
      
      return this.permissionGranted;
    } catch (error) {
      console.error('Error requesting calendar permissions:', error);
      return false;
    }
  }

  /**
   * Check if calendar permissions are granted
   */
  async hasPermissions(): Promise<boolean> {
    try {
      const { status } = await Calendar.getCalendarPermissionsAsync();
      this.permissionGranted = status === 'granted';
      return this.permissionGranted;
    } catch (error) {
      console.error('Error checking calendar permissions:', error);
      return false;
    }
  }

  /**
   * Get all available calendars on the device
   */
  async getCalendars(): Promise<DeviceCalendar[]> {
    if (!await this.hasPermissions()) {
      return [];
    }

    try {
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      
      return calendars
        .filter(cal => cal.allowsModifications)
        .map(cal => ({
          id: cal.id,
          title: cal.title,
          color: cal.color || '#007AFF',
          source: {
            id: cal.source.id ?? '',
            name: cal.source.name,
            type: cal.source.type,
          },
          isPrimary: cal.isPrimary || false,
          allowsModifications: cal.allowsModifications,
        }));
    } catch (error) {
      console.error('Error getting calendars:', error);
      return [];
    }
  }

  /**
   * Get the default calendar for the platform
   */
  async getDefaultCalendarId(): Promise<string | null> {
    try {
      if (Platform.OS === 'ios') {
        const defaultCalendar = await Calendar.getDefaultCalendarAsync();
        return defaultCalendar?.id || null;
      } else {
        // On Android, find a primary calendar
        const calendars = await this.getCalendars();
        const primary = calendars.find(c => c.isPrimary);
        return primary?.id || calendars[0]?.id || null;
      }
    } catch (error) {
      console.error('Error getting default calendar:', error);
      return null;
    }
  }

  /**
   * Create a calendar event from a maintenance task
   */
  async syncTaskToCalendar(
    task: MaintenanceTaskResponse,
    calendarId: string,
    options: {
      durationMinutes?: number;
      reminderMinutes?: number;
    } = {}
  ): Promise<SyncResult> {
    if (!await this.hasPermissions()) {
      const granted = await this.requestPermissions();
      if (!granted) {
        return { success: false, error: 'Calendar permissions not granted' };
      }
    }

    if (!task.next_due_date) {
      return { success: false, error: 'Task has no due date' };
    }

    try {
      const dueDate = new Date(task.next_due_date);
      const durationMinutes = options.durationMinutes || 60;
      
      // Create event details
      const eventDetails: NonNullable<Parameters<typeof Calendar.createEventAsync>[1]> = {
        title: `🔧 ${task.title}`,
        notes: this.buildTaskNotes(task),
        startDate: dueDate,
        endDate: new Date(dueDate.getTime() + durationMinutes * 60 * 1000),
        allDay: true,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        alarms: [],
      };

      // Add reminder if specified
      if (options.reminderMinutes || task.reminder_days_before) {
        const reminderMinutes = options.reminderMinutes || 
          (task.reminder_days_before ? task.reminder_days_before * 24 * 60 : 60);
        eventDetails.alarms = [{ relativeOffset: -reminderMinutes }];
      }

      const eventId = await Calendar.createEventAsync(calendarId, eventDetails);
      
      return { success: true, eventId };
    } catch (error) {
      console.error('Error syncing task to calendar:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Update an existing calendar event
   */
  async updateCalendarEvent(
    eventId: string,
    task: MaintenanceTaskResponse,
    options: {
      durationMinutes?: number;
      reminderMinutes?: number;
    } = {}
  ): Promise<SyncResult> {
    if (!await this.hasPermissions()) {
      return { success: false, error: 'Calendar permissions not granted' };
    }

    if (!task.next_due_date) {
      return { success: false, error: 'Task has no due date' };
    }

    try {
      const dueDate = new Date(task.next_due_date);
      const durationMinutes = options.durationMinutes || 60;

      await Calendar.updateEventAsync(eventId, {
        title: `🔧 ${task.title}`,
        notes: this.buildTaskNotes(task),
        startDate: dueDate,
        endDate: new Date(dueDate.getTime() + durationMinutes * 60 * 1000),
        alarms: task.reminder_days_before 
          ? [{ relativeOffset: -(task.reminder_days_before * 24 * 60) }] 
          : [],
      });

      return { success: true, eventId };
    } catch (error) {
      console.error('Error updating calendar event:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Delete a calendar event
   */
  async deleteCalendarEvent(eventId: string): Promise<SyncResult> {
    if (!await this.hasPermissions()) {
      return { success: false, error: 'Calendar permissions not granted' };
    }

    try {
      await Calendar.deleteEventAsync(eventId);
      return { success: true };
    } catch (error) {
      console.error('Error deleting calendar event:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Open calendar URL in the device's calendar app
   * Works for both webcal:// and https:// URLs
   */
  async openCalendarSubscription(url: string): Promise<boolean> {
    try {
      // Convert https to webcal for iOS/macOS
      const webcalUrl = url.replace('https://', 'webcal://');
      
      const canOpen = await Linking.canOpenURL(webcalUrl);
      if (canOpen) {
        await Linking.openURL(webcalUrl);
        return true;
      }
      
      // Fallback to https
      const canOpenHttps = await Linking.canOpenURL(url);
      if (canOpenHttps) {
        await Linking.openURL(url);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error opening calendar subscription:', error);
      return false;
    }
  }

  /**
   * Copy calendar URL to clipboard with user feedback
   */
  async copyCalendarUrl(url: string): Promise<void> {
    try {
      await Clipboard.setStringAsync(url);
      Alert.alert(
        'URL Copied',
        'The calendar subscription URL has been copied to your clipboard. You can paste it in your calendar app.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      Alert.alert('Error', 'Failed to copy URL to clipboard');
    }
  }

  /**
   * Open Google Calendar subscription page
   */
  async openGoogleCalendarSubscription(url: string): Promise<void> {
    const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url)}`;
    
    try {
      const canOpen = await Linking.canOpenURL(googleUrl);
      if (canOpen) {
        await Linking.openURL(googleUrl);
      } else {
        // Copy URL as fallback
        await this.copyCalendarUrl(googleUrl);
      }
    } catch (error) {
      console.error('Error opening Google Calendar:', error);
    }
  }

  /**
   * Build notes string for task event
   */
  private buildTaskNotes(task: MaintenanceTaskResponse): string {
    const parts: string[] = [];
    
    if (task.description) {
      parts.push(task.description);
    }
    
    parts.push('');
    parts.push(`--- ${ENV.APP_NAME} Task ---`);
    parts.push(`Frequency: ${task.frequency}`);
    
    if (task.system_category) {
      parts.push(`Category: ${task.system_category}`);
    }
    
    if (task.assigned_to) {
      parts.push(`Assigned to: ${task.assigned_to.display_name || 'Unknown'}`);
    }
    
    return parts.join('\n');
  }

  // ============ BATCH SYNC (2026 Best Practice - Real-time sync) ============

  /**
   * Sync all tasks with due dates to the device calendar
   * This provides real-time sync instead of waiting for iCal polling
   */
  async syncAllTasks(
    tasks: MaintenanceTaskResponse[],
    calendarId: string,
    eventIdMap: Map<string, string> = new Map()
  ): Promise<{
    synced: number;
    updated: number;
    failed: number;
    newEventIds: Map<string, string>;
  }> {
    if (!await this.hasPermissions()) {
      const granted = await this.requestPermissions();
      if (!granted) {
        return { synced: 0, updated: 0, failed: 0, newEventIds: new Map() };
      }
    }

    let synced = 0;
    let updated = 0;
    let failed = 0;
    const newEventIds = new Map<string, string>();

    // Filter tasks with due dates
    const tasksWithDates = tasks.filter(t => t.next_due_date && t.is_active);

    for (const task of tasksWithDates) {
      try {
        const existingEventId = eventIdMap.get(task.id);

        if (existingEventId) {
          // Update existing event
          const result = await this.updateCalendarEvent(existingEventId, task);
          if (result.success) {
            updated++;
            newEventIds.set(task.id, existingEventId);
          } else {
            // Event might have been deleted, create new
            const createResult = await this.syncTaskToCalendar(task, calendarId);
            if (createResult.success && createResult.eventId) {
              synced++;
              newEventIds.set(task.id, createResult.eventId);
            } else {
              failed++;
            }
          }
        } else {
          // Create new event
          const result = await this.syncTaskToCalendar(task, calendarId);
          if (result.success && result.eventId) {
            synced++;
            newEventIds.set(task.id, result.eventId);
          } else {
            failed++;
          }
        }
      } catch (error) {
        console.error(`Error syncing task ${task.id}:`, error);
        failed++;
      }
    }

    return { synced, updated, failed, newEventIds };
  }

  /**
   * Remove all app-created events from a calendar
   * Useful for cleanup or switching calendars
   */
  async removeAllEvents(
    _calendarId: string,
    eventIds: string[]
  ): Promise<{ removed: number; failed: number }> {
    let removed = 0;
    let failed = 0;

    for (const eventId of eventIds) {
      try {
        const result = await this.deleteCalendarEvent(eventId);
        if (result.success) {
          removed++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error(`Error removing event ${eventId}:`, error);
        failed++;
      }
    }

    return { removed, failed };
  }

  /**
   * Get info about calendar sync latency (for user education)
   */
  getSyncLatencyInfo(): {
    directSync: string;
    iCalSubscription: string;
    recommendation: string;
  } {
    return {
      directSync: 'Changes appear immediately in your device calendar.',
      iCalSubscription: 'iCal subscriptions refresh every 15-60 minutes (varies by calendar app). This is a platform limitation.',
      recommendation: 'For real-time updates, use "Push to Calendar" instead of iCal subscription, or manually refresh your calendar app.',
    };
  }
}

// Export singleton instance
export const calendarSyncService = new CalendarSyncService();
export default calendarSyncService;
