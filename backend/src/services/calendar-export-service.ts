import { eq, and, isNull } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { tasks as taskTable, householdMembers, households } from '../db/schema';
import {
  calendarSyncTokens,
  userCalendarSettings,
  type CalendarSyncToken,
  type UserCalendarSettings,
} from '../db/schema-calendar';
import { appointments } from '../db/schema-labor-hub';
import type { Env } from '../types';
import { NotFoundError } from '../utils/errors';
import { nowIso } from '../utils/id';

// Types for calendar events
interface CalendarEvent {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end?: Date;
  allDay?: boolean;
  reminderMinutes?: number;
  url?: string;
  categories?: string[];
  color?: string;
}

interface GarbageCollectionEvent {
  date: Date;
  types: string[];
}

export class CalendarExportService {
  private db: DrizzleD1Database;
  private env: Env;

  constructor(env: Env, d1: D1Database) {
    this.env = env;
    this.db = drizzle(d1);
  }

  // ============ SUBSCRIBE URL MANAGEMENT ============

  /**
   * Generate a new calendar subscribe token for a user
   */
  async createSubscribeToken(
    userId: string,
    options: {
      name?: string;
      includeTasks?: boolean;
      includeAppointments?: boolean;
      includeGarbage?: boolean;
      householdId?: string;
    } = {}
  ): Promise<{ token: string; subscribeUrl: string }> {
    const id = crypto.randomUUID();
    const token = this.generateSecureToken();

    await this.db.insert(calendarSyncTokens).values({
      id,
      user_id: userId,
      token,
      name: options.name || 'SimpleHouse Calendar',
      includes_tasks: options.includeTasks ?? true,
      includes_appointments: options.includeAppointments ?? true,
      includes_garbage: options.includeGarbage ?? true,
      household_id: options.householdId || null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    const subscribeUrl = `${this.env.API_URL}/calendar/ical/${token}.ics`;

    return { token, subscribeUrl };
  }

  /**
   * Get all subscribe tokens for a user
   */
  async getSubscribeTokens(userId: string): Promise<CalendarSyncToken[]> {
    return this.db
      .select()
      .from(calendarSyncTokens)
      .where(eq(calendarSyncTokens.user_id, userId))
      .all();
  }

  /**
   * Delete a subscribe token
   */
  async deleteSubscribeToken(userId: string, tokenId: string): Promise<void> {
    const token = await this.db
      .select()
      .from(calendarSyncTokens)
      .where(and(eq(calendarSyncTokens.id, tokenId), eq(calendarSyncTokens.user_id, userId)))
      .get();

    if (!token) {
      throw new NotFoundError('Calendar token not found');
    }

    await this.db.delete(calendarSyncTokens).where(eq(calendarSyncTokens.id, tokenId));
  }

  /**
   * Validate and get token data
   */
  async validateToken(token: string): Promise<CalendarSyncToken> {
    const tokenData = await this.db
      .select()
      .from(calendarSyncTokens)
      .where(eq(calendarSyncTokens.token, token))
      .get();

    if (!tokenData) {
      throw new NotFoundError('Invalid calendar token');
    }

    // Update access tracking
    await this.db
      .update(calendarSyncTokens)
      .set({
        last_accessed_at: nowIso(),
        access_count: (tokenData.access_count || 0) + 1,
      })
      .where(eq(calendarSyncTokens.id, tokenData.id));

    return tokenData;
  }

  // ============ ICAL GENERATION ============

  /**
   * Generate complete iCal feed for a token
   */
  async generateICalFeed(token: string): Promise<string> {
    const tokenData = await this.validateToken(token);
    const events: CalendarEvent[] = [];

    // Get user's households
    const userHouseholds = await this.getUserHouseholds(tokenData.user_id);
    const householdIds = tokenData.household_id
      ? [tokenData.household_id]
      : userHouseholds.map((h) => h.household_id);

    // Collect events based on token settings
    if (tokenData.includes_tasks) {
      const taskEvents = await this.getTaskEvents(householdIds, tokenData.user_id);
      events.push(...taskEvents);
    }

    if (tokenData.includes_appointments) {
      const appointmentEvents = await this.getAppointmentEvents(householdIds);
      events.push(...appointmentEvents);
    }

    if (tokenData.includes_garbage) {
      const garbageEvents = await this.getGarbageEvents(householdIds);
      events.push(...garbageEvents);
    }

    return this.formatICalendar(events, tokenData.name || 'SimpleHouse');
  }

  /**
   * Get task events for calendar
   */
  private async getTaskEvents(householdIds: string[], _userId: string): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];
    const now = new Date();
    const futureLimit = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year ahead

    for (const householdId of householdIds) {
      const tasks = await this.db
        .select()
        .from(taskTable)
        .where(
          and(
            eq(taskTable.household_id, householdId),
            eq(taskTable.is_active, true),
            isNull(taskTable.deleted_at)
          )
        )
        .all();

      for (const task of tasks) {
        if (!task.next_due_date) continue;

        const dueDate = new Date(task.next_due_date);
        if (dueDate > futureLimit) continue;

        // Calculate reminder if enabled
        let reminderMinutes: number | undefined;
        if (task.reminder_enabled && task.reminder_days_before) {
          reminderMinutes = task.reminder_days_before * 24 * 60;
        }

        events.push({
          uid: `task-${task.id}@simplehouse.app`,
          title: `🔧 ${task.title}`,
          description: task.description || undefined,
          start: dueDate,
          allDay: true,
          reminderMinutes,
          categories: ['Maintenance', task.system_category || 'General'].filter(Boolean) as string[],
          url: `${this.env.APP_URL}/tasks/${task.id}`,
        });
      }
    }

    return events;
  }

  /**
   * Get appointment events for calendar
   */
  private async getAppointmentEvents(householdIds: string[]): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];
    const now = new Date();
    const pastLimit = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    const futureLimit = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000); // 6 months ahead

    for (const householdId of householdIds) {
      const appointmentList = await this.db
        .select()
        .from(appointments)
        .where(eq(appointments.household_id, householdId))
        .all();

      for (const appt of appointmentList) {
        const schedDate = new Date(appt.scheduled_date);
        if (schedDate < pastLimit || schedDate > futureLimit) continue;
        if (['cancelled', 'no_show'].includes(appt.status)) continue;

        // Parse start time
        const startDate = new Date(appt.scheduled_date);
        let endDate: Date | undefined;
        let allDay = true;

        if (appt.scheduled_time_start) {
          const [hours, minutes] = appt.scheduled_time_start.split(':').map(Number);
          startDate.setHours(hours, minutes, 0, 0);
          allDay = false;

          // Calculate end time
          if (appt.scheduled_time_end) {
            const [endHours, endMinutes] = appt.scheduled_time_end.split(':').map(Number);
            endDate = new Date(appt.scheduled_date);
            endDate.setHours(endHours, endMinutes, 0, 0);
          } else if (appt.estimated_duration_minutes) {
            endDate = new Date(startDate.getTime() + appt.estimated_duration_minutes * 60 * 1000);
          } else {
            endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // Default 1 hour
          }
        }

        events.push({
          uid: `appointment-${appt.id}@simplehouse.app`,
          title: `📅 ${appt.title}`,
          description: appt.description || undefined,
          location: appt.location || undefined,
          start: startDate,
          end: endDate,
          allDay,
          reminderMinutes: 60, // 1 hour before
          categories: ['Appointment'],
          url: `${this.env.APP_URL}/appointments/${appt.id}`,
        });
      }
    }

    return events;
  }

  /**
   * Get garbage collection events for calendar
   */
  private async getGarbageEvents(householdIds: string[]): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];

    // Import garbage schedule schema
    const { garbageSchedules } = await import('../db/schema-maintenance');

    for (const householdId of householdIds) {
      const schedules = await this.db
        .select()
        .from(garbageSchedules)
        .where(eq(garbageSchedules.household_id, householdId))
        .all();

      for (const schedule of schedules) {
        if (!schedule.schedules) continue;

        const scheduleData = JSON.parse(schedule.schedules as string);
        const collectionDates = this.calculateUpcomingCollectionDates(scheduleData, 60); // 60 days ahead

        for (const collection of collectionDates) {
          const typeIcons: Record<string, string> = {
            garbage: '🗑️',
            recycling: '♻️',
            organics: '🥬',
            yardWaste: '🌿',
            bulkItem: '📦',
          };

          const typeLabels = collection.types.map(
            (t) => `${typeIcons[t] || ''} ${t.charAt(0).toUpperCase() + t.slice(1)}`
          );

          events.push({
            uid: `garbage-${schedule.id}-${collection.date.toISOString().split('T')[0]}@simplehouse.app`,
            title: `Collection: ${collection.types.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(', ')}`,
            description: `Waste collection day:\n${typeLabels.join('\n')}`,
            start: collection.date,
            allDay: true,
            reminderMinutes: 12 * 60, // 12 hours before (evening reminder)
            categories: ['Garbage Collection'],
          });
        }
      }
    }

    return events;
  }

  /**
   * Calculate upcoming collection dates from schedule data
   */
  private calculateUpcomingCollectionDates(
    schedules: Array<{
      type: string;
      frequency: string;
      dayOfWeek?: number;
      week?: string;
      weekOfMonth?: number[];
    }>,
    daysAhead: number
  ): GarbageCollectionEvent[] {
    const collections: Map<string, string[]> = new Map();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + daysAhead);

    for (const schedule of schedules) {
      if (schedule.dayOfWeek === undefined) continue;

      const dates = this.getUpcomingDates(
        schedule.frequency,
        schedule.dayOfWeek,
        daysAhead,
        schedule.week,
        schedule.weekOfMonth
      );

      for (const date of dates) {
        const dateKey = date.toISOString().split('T')[0];
        const existing = collections.get(dateKey) || [];
        if (!existing.includes(schedule.type)) {
          existing.push(schedule.type);
          collections.set(dateKey, existing);
        }
      }
    }

    return Array.from(collections.entries())
      .map(([dateStr, types]) => ({
        date: new Date(dateStr),
        types,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  private getUpcomingDates(
    frequency: string,
    dayOfWeek: number,
    daysAhead: number,
    _week?: string,
    _weekOfMonth?: number[]
  ): Date[] {
    const dates: Date[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + daysAhead);

    if (frequency === 'weekly') {
      const currentDate = new Date(today);
      const daysUntilNext = (dayOfWeek - currentDate.getDay() + 7) % 7;
      currentDate.setDate(currentDate.getDate() + daysUntilNext);

      while (currentDate <= endDate) {
        dates.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 7);
      }
    } else if (frequency === 'biweekly') {
      const currentDate = new Date(today);
      const daysUntilNext = (dayOfWeek - currentDate.getDay() + 7) % 7;
      currentDate.setDate(currentDate.getDate() + daysUntilNext);

      while (currentDate <= endDate) {
        dates.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 14);
      }
    }

    return dates;
  }

  // ============ ICAL FORMATTING ============

  /**
   * Format events into iCalendar format (RFC 5545)
   */
  private formatICalendar(events: CalendarEvent[], calendarName: string): string {
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SimpleHouse//Calendar Export//EN',
      `X-WR-CALNAME:${this.escapeText(calendarName)}`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];

    for (const event of events) {
      lines.push(...this.formatEvent(event));
    }

    lines.push('END:VCALENDAR');

    return lines.join('\r\n');
  }

  private formatEvent(event: CalendarEvent): string[] {
    const lines: string[] = ['BEGIN:VEVENT'];

    // UID is required
    lines.push(`UID:${event.uid}`);

    // Timestamp
    lines.push(`DTSTAMP:${this.formatDateTimeUTC(new Date())}`);

    // Start time
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${this.formatDate(event.start)}`);
      if (event.end) {
        lines.push(`DTEND;VALUE=DATE:${this.formatDate(event.end)}`);
      }
    } else {
      lines.push(`DTSTART:${this.formatDateTimeUTC(event.start)}`);
      if (event.end) {
        lines.push(`DTEND:${this.formatDateTimeUTC(event.end)}`);
      }
    }

    // Summary (title)
    lines.push(`SUMMARY:${this.escapeText(event.title)}`);

    // Description
    if (event.description) {
      lines.push(`DESCRIPTION:${this.escapeText(event.description)}`);
    }

    // Location
    if (event.location) {
      lines.push(`LOCATION:${this.escapeText(event.location)}`);
    }

    // URL
    if (event.url) {
      lines.push(`URL:${event.url}`);
    }

    // Categories
    if (event.categories && event.categories.length > 0) {
      lines.push(`CATEGORIES:${event.categories.join(',')}`);
    }

    // Alarm/Reminder
    if (event.reminderMinutes) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:Reminder: ${event.title}`,
        `TRIGGER:-PT${event.reminderMinutes}M`,
        'END:VALARM'
      );
    }

    lines.push('END:VEVENT');

    return lines;
  }

  private formatDateTimeUTC(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0].replace(/-/g, '');
  }

  private escapeText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  private generateSecureToken(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  // ============ USER CALENDAR SETTINGS ============

  async getCalendarSettings(userId: string): Promise<UserCalendarSettings | null> {
    const row = await this.db
      .select()
      .from(userCalendarSettings)
      .where(eq(userCalendarSettings.user_id, userId))
      .get();
    return row ?? null;
  }

  async updateCalendarSettings(
    userId: string,
    updates: Partial<Omit<UserCalendarSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
  ): Promise<UserCalendarSettings> {
    const existing = await this.getCalendarSettings(userId);

    if (existing) {
      await this.db
        .update(userCalendarSettings)
        .set({
          ...updates,
          updated_at: nowIso(),
        })
        .where(eq(userCalendarSettings.user_id, userId));

      return { ...existing, ...updates } as UserCalendarSettings;
    } else {
      const id = crypto.randomUUID();
      const now = nowIso();

      const newSettings: UserCalendarSettings = {
        id,
        user_id: userId,
        default_calendar_type: updates.default_calendar_type || null,
        default_calendar_id: updates.default_calendar_id || null,
        default_calendar_name: updates.default_calendar_name || null,
        auto_sync_tasks: updates.auto_sync_tasks ?? false,
        auto_sync_appointments: updates.auto_sync_appointments ?? false,
        auto_sync_garbage: updates.auto_sync_garbage ?? false,
        sync_task_due_date: updates.sync_task_due_date ?? true,
        sync_task_reminder: updates.sync_task_reminder ?? true,
        task_event_duration_minutes: updates.task_event_duration_minutes ?? 60,
        task_event_color: updates.task_event_color || null,
        appointment_event_color: updates.appointment_event_color || null,
        garbage_event_color: updates.garbage_event_color || null,
        created_at: now,
        updated_at: now,
      };

      await this.db.insert(userCalendarSettings).values(newSettings);

      return newSettings;
    }
  }

  // ============ HELPERS ============

  private async getUserHouseholds(
    userId: string
  ): Promise<Array<{ household_id: string; name: string }>> {
    const members = await this.db
      .select({
        household_id: householdMembers.household_id,
        name: households.name,
      })
      .from(householdMembers)
      .innerJoin(households, eq(householdMembers.household_id, households.id))
      .where(and(eq(householdMembers.user_id, userId), isNull(householdMembers.deleted_at)))
      .all();

    return members;
  }
}
