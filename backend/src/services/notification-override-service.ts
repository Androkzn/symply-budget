import { eq, and } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import {
  notificationOverrides,
  type NotificationOverride,
  type OverrideTargetType,
} from '../db/schema-calendar';
import type { Env } from '../types';
import { NotFoundError } from '../utils/errors';
import { nowIso } from '../utils/id';

export interface EffectiveReminderSettings {
  enabled: boolean;
  reminder_days_before: number;
  reminder_time: string;
  reminder_repeat: boolean;
  sync_to_calendar: boolean;
  calendar_id?: string;
  source: 'default' | 'category' | 'space' | 'task';
}

export class NotificationOverrideService {
  private db: DrizzleD1Database;

  constructor(_env: Env, d1: D1Database) {
    this.db = drizzle(d1);
  }

  // ============ CRUD OPERATIONS ============

  /**
   * Create a notification override
   */
  async createOverride(
    userId: string,
    input: {
      targetType: OverrideTargetType;
      targetId?: string;
      category?: string;
      enabled?: boolean;
      reminderDaysBefore?: number;
      reminderTime?: string;
      reminderRepeat?: boolean;
      syncToCalendar?: boolean;
      calendarId?: string;
    }
  ): Promise<NotificationOverride> {
    const id = crypto.randomUUID();
    const now = nowIso();

    const override: NotificationOverride = {
      id,
      user_id: userId,
      target_type: input.targetType,
      target_id: input.targetId || null,
      category: input.category || null,
      enabled: input.enabled ?? null,
      reminder_days_before: input.reminderDaysBefore ?? null,
      reminder_time: input.reminderTime || null,
      reminder_repeat: input.reminderRepeat ?? null,
      sync_to_calendar: input.syncToCalendar ?? false,
      calendar_id: input.calendarId || null,
      created_at: now,
      updated_at: now,
    };

    await this.db.insert(notificationOverrides).values(override);

    return override;
  }

  /**
   * Get all overrides for a user
   */
  async getOverrides(
    userId: string,
    filters?: {
      targetType?: OverrideTargetType;
      category?: string;
    }
  ): Promise<NotificationOverride[]> {
    const query = this.db
      .select()
      .from(notificationOverrides)
      .where(eq(notificationOverrides.user_id, userId));

    const results = await query.all();

    // Apply filters in memory (simpler than complex SQL)
    return results.filter((o) => {
      if (filters?.targetType && o.target_type !== filters.targetType) return false;
      if (filters?.category && o.category !== filters.category) return false;
      return true;
    });
  }

  /**
   * Get a specific override
   */
  async getOverride(userId: string, overrideId: string): Promise<NotificationOverride> {
    const override = await this.db
      .select()
      .from(notificationOverrides)
      .where(and(eq(notificationOverrides.id, overrideId), eq(notificationOverrides.user_id, userId)))
      .get();

    if (!override) {
      throw new NotFoundError('Notification override not found');
    }

    return override;
  }

  /**
   * Update an override
   */
  async updateOverride(
    userId: string,
    overrideId: string,
    updates: {
      enabled?: boolean | null;
      reminderDaysBefore?: number | null;
      reminderTime?: string | null;
      reminderRepeat?: boolean | null;
      syncToCalendar?: boolean;
      calendarId?: string | null;
    }
  ): Promise<NotificationOverride> {
    const existing = await this.getOverride(userId, overrideId);

    await this.db
      .update(notificationOverrides)
      .set({
        enabled: updates.enabled !== undefined ? updates.enabled : existing.enabled,
        reminder_days_before:
          updates.reminderDaysBefore !== undefined
            ? updates.reminderDaysBefore
            : existing.reminder_days_before,
        reminder_time:
          updates.reminderTime !== undefined ? updates.reminderTime : existing.reminder_time,
        reminder_repeat:
          updates.reminderRepeat !== undefined ? updates.reminderRepeat : existing.reminder_repeat,
        sync_to_calendar:
          updates.syncToCalendar !== undefined ? updates.syncToCalendar : existing.sync_to_calendar,
        calendar_id:
          updates.calendarId !== undefined ? updates.calendarId : existing.calendar_id,
        updated_at: nowIso(),
      })
      .where(eq(notificationOverrides.id, overrideId));

    return this.getOverride(userId, overrideId);
  }

  /**
   * Delete an override
   */
  async deleteOverride(userId: string, overrideId: string): Promise<void> {
    await this.getOverride(userId, overrideId); // Verify exists

    await this.db.delete(notificationOverrides).where(eq(notificationOverrides.id, overrideId));
  }

  // ============ EFFECTIVE SETTINGS ============

  /**
   * Get effective reminder settings for a task
   * Hierarchy: Task-specific > Space > Category > User defaults
   */
  async getEffectiveTaskSettings(
    userId: string,
    taskId: string,
    spaceId: string | null,
    systemCategory: string | null,
    taskDefaults: {
      reminderEnabled: boolean;
      reminderDaysBefore: number;
      reminderTime: string;
      reminderRepeat: boolean;
    }
  ): Promise<EffectiveReminderSettings> {
    // Get all relevant overrides
    const overrides = await this.db
      .select()
      .from(notificationOverrides)
      .where(eq(notificationOverrides.user_id, userId))
      .all();

    // Find task-specific override
    const taskOverride = overrides.find(
      (o) => o.target_type === 'task' && o.target_id === taskId
    );
    if (taskOverride) {
      return this.mergeWithDefaults(taskOverride, taskDefaults, 'task');
    }

    // Find space override
    if (spaceId) {
      const spaceOverride = overrides.find(
        (o) => o.target_type === 'space' && o.target_id === spaceId
      );
      if (spaceOverride) {
        return this.mergeWithDefaults(spaceOverride, taskDefaults, 'space');
      }
    }

    // Find category override
    if (systemCategory) {
      const categoryOverride = overrides.find(
        (o) => o.target_type === 'category' && o.category === systemCategory
      );
      if (categoryOverride) {
        return this.mergeWithDefaults(categoryOverride, taskDefaults, 'category');
      }
    }

    // Use task defaults
    return {
      enabled: taskDefaults.reminderEnabled,
      reminder_days_before: taskDefaults.reminderDaysBefore,
      reminder_time: taskDefaults.reminderTime,
      reminder_repeat: taskDefaults.reminderRepeat,
      sync_to_calendar: false,
      source: 'default',
    };
  }

  private mergeWithDefaults(
    override: NotificationOverride,
    defaults: {
      reminderEnabled: boolean;
      reminderDaysBefore: number;
      reminderTime: string;
      reminderRepeat: boolean;
    },
    source: 'task' | 'space' | 'category'
  ): EffectiveReminderSettings {
    return {
      enabled: override.enabled ?? defaults.reminderEnabled,
      reminder_days_before: override.reminder_days_before ?? defaults.reminderDaysBefore,
      reminder_time: override.reminder_time ?? defaults.reminderTime,
      reminder_repeat: override.reminder_repeat ?? defaults.reminderRepeat,
      sync_to_calendar: override.sync_to_calendar ?? false,
      calendar_id: override.calendar_id || undefined,
      source,
    };
  }

  // ============ BULK OPERATIONS ============

  /**
   * Set override for all tasks in a category
   */
  async setCategoryOverride(
    userId: string,
    category: string,
    settings: {
      enabled?: boolean;
      reminderDaysBefore?: number;
      reminderTime?: string;
      reminderRepeat?: boolean;
      syncToCalendar?: boolean;
      calendarId?: string;
    }
  ): Promise<NotificationOverride> {
    // Check if override already exists
    const existing = await this.db
      .select()
      .from(notificationOverrides)
      .where(
        and(
          eq(notificationOverrides.user_id, userId),
          eq(notificationOverrides.target_type, 'category'),
          eq(notificationOverrides.category, category)
        )
      )
      .get();

    if (existing) {
      return this.updateOverride(userId, existing.id, settings);
    }

    return this.createOverride(userId, {
      targetType: 'category',
      category,
      ...settings,
    });
  }

  /**
   * Set override for all tasks in a space
   */
  async setSpaceOverride(
    userId: string,
    spaceId: string,
    settings: {
      enabled?: boolean;
      reminderDaysBefore?: number;
      reminderTime?: string;
      reminderRepeat?: boolean;
      syncToCalendar?: boolean;
      calendarId?: string;
    }
  ): Promise<NotificationOverride> {
    // Check if override already exists
    const existing = await this.db
      .select()
      .from(notificationOverrides)
      .where(
        and(
          eq(notificationOverrides.user_id, userId),
          eq(notificationOverrides.target_type, 'space'),
          eq(notificationOverrides.target_id, spaceId)
        )
      )
      .get();

    if (existing) {
      return this.updateOverride(userId, existing.id, settings);
    }

    return this.createOverride(userId, {
      targetType: 'space',
      targetId: spaceId,
      ...settings,
    });
  }
}
