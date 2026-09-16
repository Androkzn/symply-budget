import { eq, and, isNull, desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as maintenanceSchema from '../db/schema-maintenance';
import type { Database, Env } from '../types';
import { NotFoundError } from '../utils/errors';
import { generateId, now } from '../utils/id';

import { HouseholdService } from './household-service';
import { MunicipalityService } from './municipality-service';
import { NotificationService } from './notification-service';

export interface GarbageScheduleResponse {
  id: string;
  household_id: string;
  municipality: string;
  schedules: Array<{
    type: 'garbage' | 'recycling' | 'organics' | 'yardWaste' | 'bulkItem';
    frequency: 'weekly' | 'biweekly' | 'monthly' | 'seasonal' | 'on-request';
    dayOfWeek?: number;
    week?: 'A' | 'B';
    weekOfMonth?: number[];
    seasonStart?: { month: number; day: number };
    seasonEnd?: { month: number; day: number };
  }>;
  set_out_time?: string;
  collection_start_time?: string;
  remove_by_time?: string;
  holiday_shifts: Array<{
    holiday: string;
    date: string;
    shiftDays: number;
    affectedDays: number[];
  }>;
  reminders: {
    nightBefore: { enabled: boolean; time: string };
    morningOf: { enabled: boolean; time: string };
  };
  source: 'municipal_api' | 'manual' | 'scraped';
  last_verified?: string;
  created_at: string;
  updated_at: string;
}

export interface MunicipalityConfigResponse {
  id: string;
  name: string;
  code: string;
  garbage_provider?: string;
  garbage_schedule_lookup_url?: string;
  waste_regulations?: {
    garbage: Array<{ title: string; url: string }>;
    recycling: Array<{ title: string; url: string }>;
    organics: Array<{ title: string; url: string }>;
  };
  noise_bylaws?: {
    quietHoursWeekday: { start: string; end: string };
    quietHoursWeekend: { start: string; end: string };
    lawnEquipmentHours: { start: string; end: string };
  };
  property_maintenance_bylaws?: {
    lawnHeightMax?: number;
    snowClearanceHours?: number;
    sidewalkResponsibility: 'owner' | 'city';
    noxiousWeedControl: boolean;
  };
  contacts?: {
    bylawEnforcement: string;
    wasteCollection: string;
    general: string;
  };
  last_updated?: string;
}

export class GarbageCollectionService {
  private db: Database;
  private householdService: HouseholdService;
  private municipalityService: MunicipalityService;
  private notificationService: NotificationService;

  constructor(env: Env, d1: D1Database) {
    this.db = drizzle(d1);
    this.householdService = new HouseholdService(env, d1);
    this.municipalityService = new MunicipalityService(env, d1);
    this.notificationService = new NotificationService(env, d1);
  }

  /**
   * Get or create garbage schedule for a household
   */
  async getOrCreateSchedule(
    householdId: string,
    userId: string
  ): Promise<GarbageScheduleResponse> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    // Try to get existing schedule. Order by created_at DESC so that if a
    // household ended up with duplicate rows (from the pre-upsert bug), we
    // return the most recently saved one — the one with real data.
    const existing = await this.db
      .select()
      .from(maintenanceSchema.garbageSchedules)
      .where(
        and(
          eq(maintenanceSchema.garbageSchedules.household_id, householdId),
          isNull(maintenanceSchema.garbageSchedules.deleted_at)
        )
      )
      .orderBy(desc(maintenanceSchema.garbageSchedules.created_at))
      .limit(1);

    if (existing.length > 0) {
      return this.mapScheduleToResponse(existing[0]);
    }

    // Get household to determine municipality
    const household = await this.householdService.getHousehold(householdId, userId);
    const municipality = await this.municipalityService.detectMunicipality(household.city, household.postal_code);

    // Create default schedule
    return this.createSchedule(householdId, userId, {
      municipality,
      schedules: [],
      reminders: {
        nightBefore: { enabled: true, time: '19:00' },
        morningOf: { enabled: false, time: '07:00' },
      },
    });
  }

  /**
   * Create a new garbage schedule
   */
  async createSchedule(
    householdId: string,
    userId: string,
    input: {
      municipality: string;
      schedules: GarbageScheduleResponse['schedules'];
      set_out_time?: string;
      collection_start_time?: string;
      remove_by_time?: string;
      holiday_shifts?: GarbageScheduleResponse['holiday_shifts'];
      reminders?: GarbageScheduleResponse['reminders'];
      source?: 'municipal_api' | 'manual' | 'scraped';
    }
  ): Promise<GarbageScheduleResponse> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    // Upsert: a household has at most ONE active schedule. getOrCreateSchedule
    // auto-creates an empty row on first view, so a plain insert here would
    // create a duplicate and reads (which return one row) could surface the
    // stale empty one. If a schedule already exists, update it in place.
    const existingSchedule = await this.db
      .select()
      .from(maintenanceSchema.garbageSchedules)
      .where(
        and(
          eq(maintenanceSchema.garbageSchedules.household_id, householdId),
          isNull(maintenanceSchema.garbageSchedules.deleted_at)
        )
      )
      .orderBy(desc(maintenanceSchema.garbageSchedules.created_at))
      .limit(1);

    if (existingSchedule.length > 0) {
      return this.updateSchedule(householdId, existingSchedule[0].id, userId, input);
    }

    const scheduleId = generateId();
    const timestamp = now();

    await this.db.insert(maintenanceSchema.garbageSchedules).values({
      id: scheduleId,
      household_id: householdId,
      municipality: input.municipality,
      schedules: JSON.stringify(input.schedules),
      set_out_time: input.set_out_time || '19:00',
      collection_start_time: input.collection_start_time || '07:00',
      remove_by_time: input.remove_by_time || '19:00',
      holiday_shifts: input.holiday_shifts ? JSON.stringify(input.holiday_shifts) : null,
      reminders: input.reminders ? JSON.stringify(input.reminders) : JSON.stringify({
        nightBefore: { enabled: true, time: '19:00' },
        morningOf: { enabled: false, time: '07:00' },
      }),
      source: input.source || 'manual',
      last_verified: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
      updated_by: userId,
    });

    const schedule = await this.getSchedule(householdId, scheduleId, userId);
    
    // Schedule reminder notifications
    await this.scheduleReminders(schedule);
    
    return schedule;
  }

  /**
   * Get a garbage schedule
   */
  async getSchedule(
    householdId: string,
    scheduleId: string,
    userId: string
  ): Promise<GarbageScheduleResponse> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    const schedule = await this.db
      .select()
      .from(maintenanceSchema.garbageSchedules)
      .where(
        and(
          eq(maintenanceSchema.garbageSchedules.id, scheduleId),
          eq(maintenanceSchema.garbageSchedules.household_id, householdId),
          isNull(maintenanceSchema.garbageSchedules.deleted_at)
        )
      )
      .limit(1);

    if (schedule.length === 0) {
      throw new NotFoundError('Garbage schedule not found');
    }

    return this.mapScheduleToResponse(schedule[0]);
  }

  /**
   * Update a garbage schedule
   */
  async updateSchedule(
    householdId: string,
    scheduleId: string,
    userId: string,
    input: {
      municipality?: string;
      schedules?: GarbageScheduleResponse['schedules'];
      set_out_time?: string;
      collection_start_time?: string;
      remove_by_time?: string;
      holiday_shifts?: GarbageScheduleResponse['holiday_shifts'];
      reminders?: GarbageScheduleResponse['reminders'];
      source?: 'municipal_api' | 'manual' | 'scraped';
    }
  ): Promise<GarbageScheduleResponse> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    const timestamp = now();
    const updateData: any = {
      updated_at: timestamp,
      updated_by: userId,
    };

    if (input.municipality !== undefined) updateData.municipality = input.municipality;
    if (input.schedules !== undefined) updateData.schedules = JSON.stringify(input.schedules);
    if (input.set_out_time !== undefined) updateData.set_out_time = input.set_out_time;
    if (input.collection_start_time !== undefined) updateData.collection_start_time = input.collection_start_time;
    if (input.remove_by_time !== undefined) updateData.remove_by_time = input.remove_by_time;
    if (input.holiday_shifts !== undefined) updateData.holiday_shifts = JSON.stringify(input.holiday_shifts);
    if (input.reminders !== undefined) updateData.reminders = JSON.stringify(input.reminders);
    if (input.source !== undefined) updateData.source = input.source;

    await this.db
      .update(maintenanceSchema.garbageSchedules)
      .set(updateData)
      .where(
        and(
          eq(maintenanceSchema.garbageSchedules.id, scheduleId),
          eq(maintenanceSchema.garbageSchedules.household_id, householdId)
        )
      );

    const schedule = await this.getSchedule(householdId, scheduleId, userId);

    // Re-schedule reminder notifications if schedules or reminders changed
    if (input.schedules !== undefined || input.reminders !== undefined) {
      await this.scheduleReminders(schedule);
    }

    return schedule;
  }

  /**
   * Update custom reminders for a schedule
   */
  async updateReminders(
    householdId: string,
    scheduleId: string,
    userId: string,
    customReminders: Array<{
      id: string;
      type: 'evening_before' | 'morning_of' | 'custom';
      time: string;
      daysOffset: number;
      label: string;
      enabled: boolean;
    }>
  ): Promise<GarbageScheduleResponse> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    // Get current schedule to preserve existing reminders
    const currentSchedule = await this.getSchedule(householdId, scheduleId, userId);

    // Separate preset reminders from custom ones
    const nightBefore = customReminders.find(r => r.type === 'evening_before');
    const morningOf = customReminders.find(r => r.type === 'morning_of');
    const custom = customReminders.filter(r => r.type === 'custom');

    // Build reminders object
    const updatedReminders = {
      nightBefore: nightBefore
        ? { enabled: nightBefore.enabled, time: nightBefore.time }
        : currentSchedule.reminders.nightBefore,
      morningOf: morningOf
        ? { enabled: morningOf.enabled, time: morningOf.time }
        : currentSchedule.reminders.morningOf,
      custom: custom.length > 0 ? custom : undefined,
    };

    const timestamp = now();

    // Update reminders in database
    await this.db
      .update(maintenanceSchema.garbageSchedules)
      .set({
        reminders: JSON.stringify(updatedReminders),
        updated_at: timestamp,
        updated_by: userId,
      })
      .where(
        and(
          eq(maintenanceSchema.garbageSchedules.id, scheduleId),
          eq(maintenanceSchema.garbageSchedules.household_id, householdId)
        )
      );

    // Get updated schedule
    const schedule = await this.getSchedule(householdId, scheduleId, userId);

    // Re-schedule all notifications with new reminders
    await this.scheduleReminders(schedule);

    return schedule;
  }

  /**
   * Get municipality configuration
   */
  async getMunicipalityConfig(municipalityName: string): Promise<MunicipalityConfigResponse | null> {
    return this.municipalityService.getMunicipalityByName(municipalityName);
  }

  /**
   * Get next collection dates for a schedule
   */
  async getNextCollectionDates(
    householdId: string,
    scheduleId: string,
    userId: string,
    daysAhead: number = 30
  ): Promise<Array<{ date: string; types: string[] }>> {
    const schedule = await this.getSchedule(householdId, scheduleId, userId);
    const dates: Array<{ date: string; types: string[] }> = [];
    const today = new Date();
    const endDate = new Date(today);
    
    // Validate and clamp daysAhead
    const validDaysAhead = Math.max(1, Math.min(365, daysAhead || 30));
    endDate.setDate(today.getDate() + validDaysAhead);

    // Process each schedule type
    if (!schedule.schedules || schedule.schedules.length === 0) {
      return dates; // Return empty array if no schedules
    }

    for (const scheduleItem of schedule.schedules) {
      if (!scheduleItem || !scheduleItem.type || !scheduleItem.frequency) {
        continue; // Skip invalid schedule items
      }

      if (scheduleItem.frequency === 'weekly' && scheduleItem.dayOfWeek !== undefined) {
        // Weekly collection
        const currentDate = new Date(today);
        // Find next occurrence of this day
        const daysUntilNext = (scheduleItem.dayOfWeek - currentDate.getDay() + 7) % 7;
        if (daysUntilNext === 0 && currentDate.getHours() >= 7) {
          // If today is the day and past collection time, move to next week
          currentDate.setDate(currentDate.getDate() + 7);
        } else {
          currentDate.setDate(currentDate.getDate() + daysUntilNext);
        }

        while (currentDate <= endDate) {
          const dateStr = currentDate.toISOString().split('T')[0];
          const existing = dates.find((d) => d.date === dateStr);
          if (existing) {
            if (!existing.types.includes(scheduleItem.type)) {
              existing.types.push(scheduleItem.type);
            }
          } else {
            dates.push({ date: dateStr, types: [scheduleItem.type] });
          }
          currentDate.setDate(currentDate.getDate() + 7);
        }
      } else if (scheduleItem.frequency === 'biweekly' && scheduleItem.dayOfWeek !== undefined) {
        // Biweekly collection. `week` ('A' | 'B') models alternating-week
        // streams (e.g. Surrey: garbage on week A, recycling on week B). Week B
        // is offset by 7 days from week A so the two never land on the same day.
        const weekOffset = scheduleItem.week === 'B' ? 7 : 0;
        const currentDate = new Date(today);
        const daysUntilNext = (scheduleItem.dayOfWeek - currentDate.getDay() + 7) % 7;
        currentDate.setDate(currentDate.getDate() + daysUntilNext + weekOffset);

        while (currentDate <= endDate) {
          const dateStr = currentDate.toISOString().split('T')[0];
          const existing = dates.find((d) => d.date === dateStr);
          if (existing) {
            if (!existing.types.includes(scheduleItem.type)) {
              existing.types.push(scheduleItem.type);
            }
          } else {
            dates.push({ date: dateStr, types: [scheduleItem.type] });
          }
          currentDate.setDate(currentDate.getDate() + 14);
        }
      } else if (scheduleItem.frequency === 'monthly' && scheduleItem.dayOfWeek !== undefined) {
        // Monthly collection - on specific week(s) of month
        const weeksOfMonth = scheduleItem.weekOfMonth || [1]; // Default to first week
        const currentDate = new Date(today);

        while (currentDate <= endDate) {
          const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);

          for (const weekNum of weeksOfMonth) {
            // Find the Nth occurrence of dayOfWeek in this month
            let occurrenceCount = 0;
            const checkDate = new Date(firstDayOfMonth);

            while (checkDate.getMonth() === currentDate.getMonth()) {
              if (checkDate.getDay() === scheduleItem.dayOfWeek) {
                occurrenceCount++;
                if (occurrenceCount === weekNum && checkDate >= today) {
                  const dateStr = checkDate.toISOString().split('T')[0];
                  const existing = dates.find((d) => d.date === dateStr);
                  if (existing) {
                    if (!existing.types.includes(scheduleItem.type)) {
                      existing.types.push(scheduleItem.type);
                    }
                  } else {
                    dates.push({ date: dateStr, types: [scheduleItem.type] });
                  }
                  break;
                }
              }
              checkDate.setDate(checkDate.getDate() + 1);
            }
          }

          // Move to next month
          currentDate.setMonth(currentDate.getMonth() + 1);
          currentDate.setDate(1);
        }
      } else if (scheduleItem.frequency === 'seasonal' && scheduleItem.seasonStart && scheduleItem.seasonEnd) {
        // Seasonal collection - only during specific months
        const { seasonStart, seasonEnd } = scheduleItem;
        const currentDate = new Date(today);

        while (currentDate <= endDate) {
          const currentMonth = currentDate.getMonth() + 1;
          const currentDay = currentDate.getDate();

          // Check if current date is within season
          const isInSeason =
            (seasonStart.month < seasonEnd.month &&
             currentMonth >= seasonStart.month &&
             currentMonth <= seasonEnd.month) ||
            (seasonStart.month > seasonEnd.month && // Season crosses year boundary
             (currentMonth >= seasonStart.month ||
              currentMonth <= seasonEnd.month));

          // Check if day matches (for start/end dates)
          const isAfterSeasonStart =
            currentMonth > seasonStart.month ||
            (currentMonth === seasonStart.month && currentDay >= seasonStart.day);
          const isBeforeSeasonEnd =
            currentMonth < seasonEnd.month ||
            (currentMonth === seasonEnd.month && currentDay <= seasonEnd.day);

          if (isInSeason && isAfterSeasonStart && isBeforeSeasonEnd &&
              scheduleItem.dayOfWeek !== undefined &&
              currentDate.getDay() === scheduleItem.dayOfWeek) {
            const dateStr = currentDate.toISOString().split('T')[0];
            const existing = dates.find((d) => d.date === dateStr);
            if (existing) {
              if (!existing.types.includes(scheduleItem.type)) {
                existing.types.push(scheduleItem.type);
              }
            } else {
              dates.push({ date: dateStr, types: [scheduleItem.type] });
            }
          }

          currentDate.setDate(currentDate.getDate() + 1);
        }
      } else if (scheduleItem.frequency === 'on-request') {
        // On-request items don't have scheduled dates - skip
        continue;
      }
    }

    // Sort by date
    dates.sort((a, b) => a.date.localeCompare(b.date));

    return dates;
  }


  /**
   * Map database record to response
   */
  private mapScheduleToResponse(record: any): GarbageScheduleResponse {
    let schedules: GarbageScheduleResponse['schedules'] = [];
    let holiday_shifts: GarbageScheduleResponse['holiday_shifts'] = [];
    let reminders: GarbageScheduleResponse['reminders'] = {
      nightBefore: { enabled: true, time: '19:00' },
      morningOf: { enabled: false, time: '07:00' },
    };

    try {
      if (record.schedules) {
        schedules = JSON.parse(record.schedules);
      }
    } catch (e) {
      console.error('Error parsing schedules:', e);
    }

    try {
      if (record.holiday_shifts) {
        holiday_shifts = JSON.parse(record.holiday_shifts);
      }
    } catch (e) {
      console.error('Error parsing holiday_shifts:', e);
    }

    try {
      if (record.reminders) {
        reminders = JSON.parse(record.reminders);
      }
    } catch (e) {
      console.error('Error parsing reminders:', e);
    }

    return {
      id: record.id,
      household_id: record.household_id,
      municipality: record.municipality,
      schedules,
      set_out_time: record.set_out_time,
      collection_start_time: record.collection_start_time,
      remove_by_time: record.remove_by_time,
      holiday_shifts,
      reminders,
      source: record.source || 'manual',
      last_verified: record.last_verified,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  }

  /**
   * Schedule reminder notifications for a garbage collection schedule
   * Called automatically when schedules are created or updated
   */
  async scheduleReminders(schedule: GarbageScheduleResponse): Promise<number> {
    if (!schedule.schedules || schedule.schedules.length === 0) {
      return 0;
    }

    try {
      const count = await this.notificationService.scheduleGarbageReminders(
        schedule.household_id,
        schedule.id,
        schedule.schedules,
        schedule.reminders,
        schedule.set_out_time,
        schedule.collection_start_time
      );
      console.log(`Scheduled ${count} garbage collection reminders for schedule ${schedule.id}`);
      return count;
    } catch (error) {
      console.error('Error scheduling garbage collection reminders:', error);
      return 0;
    }
  }

  /**
   * Refresh all garbage collection reminders for a household
   * Can be called by a cron job to ensure reminders are always up to date
   */
  async refreshAllReminders(householdId: string, userId: string): Promise<number> {
    const schedule = await this.getOrCreateSchedule(householdId, userId);
    return this.scheduleReminders(schedule);
  }

}
