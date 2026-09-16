import { eq, and, isNull, desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as maintenanceSchema from '../db/schema-maintenance';
import type { Database, Env } from '../types';
import { NotFoundError } from '../utils/errors';
import { generateId, now } from '../utils/id';

import { HouseholdService } from './household-service';

export interface SeasonalChecklistResponse {
  id: string;
  household_id: string;
  season: 'spring' | 'summer' | 'fall' | 'winter';
  year: number;
  climate_zone: string;
  progress: number;
  completed_at?: string;
  items: SeasonalChecklistItemResponse[];
  created_at: string;
  updated_at: string;
}

export interface SeasonalChecklistItemResponse {
  id: string;
  checklist_id: string;
  task_template_id?: string;
  title: string;
  category?: string;
  is_completed: boolean;
  completed_at?: string;
  completed_by?: string;
  notes?: string;
  photo_keys?: string[];
  sort_order?: number;
}

export class ChecklistService {
  private db: Database;
  private householdService: HouseholdService;

  constructor(_env: Env, d1: D1Database) {
    this.db = drizzle(d1);
    this.householdService = new HouseholdService(_env, d1);
  }

  /**
   * Get or create seasonal checklist for a household
   */
  async getOrCreateChecklist(
    householdId: string,
    userId: string,
    season: 'spring' | 'summer' | 'fall' | 'winter',
    year: number,
    climateZone: string = 'pacific_northwest'
  ): Promise<SeasonalChecklistResponse> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    // Try to get existing checklist
    const existing = await this.db
      .select()
      .from(maintenanceSchema.seasonalChecklists)
      .where(
        and(
          eq(maintenanceSchema.seasonalChecklists.household_id, householdId),
          eq(maintenanceSchema.seasonalChecklists.season, season),
          eq(maintenanceSchema.seasonalChecklists.year, year),
          isNull(maintenanceSchema.seasonalChecklists.deleted_at)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return this.getChecklist(householdId, existing[0].id, userId);
    }

    // Create new checklist
    return this.createChecklist(householdId, userId, {
      season,
      year,
      climate_zone: climateZone,
    });
  }

  /**
   * Create a new seasonal checklist
   */
  async createChecklist(
    householdId: string,
    userId: string,
    input: {
      season: 'spring' | 'summer' | 'fall' | 'winter';
      year: number;
      climate_zone: string;
    }
  ): Promise<SeasonalChecklistResponse> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    const checklistId = generateId();
    const timestamp = now();

    await this.db.insert(maintenanceSchema.seasonalChecklists).values({
      id: checklistId,
      household_id: householdId,
      season: input.season,
      year: input.year,
      climate_zone: input.climate_zone,
      progress: 0,
      created_at: timestamp,
      updated_at: timestamp,
      updated_by: userId,
    });

    return this.getChecklist(householdId, checklistId, userId);
  }

  /**
   * Get a seasonal checklist with items
   */
  async getChecklist(
    householdId: string,
    checklistId: string,
    userId: string
  ): Promise<SeasonalChecklistResponse> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    const checklist = await this.db
      .select()
      .from(maintenanceSchema.seasonalChecklists)
      .where(
        and(
          eq(maintenanceSchema.seasonalChecklists.id, checklistId),
          eq(maintenanceSchema.seasonalChecklists.household_id, householdId),
          isNull(maintenanceSchema.seasonalChecklists.deleted_at)
        )
      )
      .limit(1);

    if (checklist.length === 0) {
      throw new NotFoundError('Seasonal checklist not found');
    }

    // Get items
    const items = await this.db
      .select()
      .from(maintenanceSchema.seasonalChecklistItems)
      .where(eq(maintenanceSchema.seasonalChecklistItems.checklist_id, checklistId))
      .orderBy(maintenanceSchema.seasonalChecklistItems.sort_order);

    return {
      id: checklist[0].id,
      household_id: checklist[0].household_id,
      season: checklist[0].season as any,
      year: checklist[0].year,
      climate_zone: checklist[0].climate_zone,
      progress: checklist[0].progress || 0,
      completed_at: checklist[0].completed_at || undefined,
      items: items.map((item) => ({
        id: item.id,
        checklist_id: item.checklist_id,
        task_template_id: item.task_template_id || undefined,
        title: item.title,
        category: item.category || undefined,
        is_completed: Boolean(item.is_completed),
        completed_at: item.completed_at || undefined,
        completed_by: item.completed_by || undefined,
        notes: item.notes || undefined,
        photo_keys: this.safeJsonParse(item.photo_keys, undefined),
        sort_order: item.sort_order || undefined,
      })),
      created_at: checklist[0].created_at,
      updated_at: checklist[0].updated_at,
    };
  }

  /**
   * List seasonal checklists for a household
   */
  async listChecklists(
    householdId: string,
    userId: string,
    filters?: {
      season?: 'spring' | 'summer' | 'fall' | 'winter';
      year?: number;
    }
  ): Promise<SeasonalChecklistResponse[]> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    const conditions: any[] = [
      eq(maintenanceSchema.seasonalChecklists.household_id, householdId),
      isNull(maintenanceSchema.seasonalChecklists.deleted_at),
    ];

    if (filters?.season) {
      conditions.push(eq(maintenanceSchema.seasonalChecklists.season, filters.season));
    }

    if (filters?.year) {
      conditions.push(eq(maintenanceSchema.seasonalChecklists.year, filters.year));
    }

    const checklists = await this.db
      .select()
      .from(maintenanceSchema.seasonalChecklists)
      .where(and(...conditions))
      .orderBy(desc(maintenanceSchema.seasonalChecklists.year), desc(maintenanceSchema.seasonalChecklists.season));

    // Get items for each checklist
    const result: SeasonalChecklistResponse[] = [];
    for (const checklist of checklists) {
      const items = await this.db
        .select()
        .from(maintenanceSchema.seasonalChecklistItems)
        .where(eq(maintenanceSchema.seasonalChecklistItems.checklist_id, checklist.id))
        .orderBy(maintenanceSchema.seasonalChecklistItems.sort_order);

      result.push({
        id: checklist.id,
        household_id: checklist.household_id,
        season: checklist.season as any,
        year: checklist.year,
        climate_zone: checklist.climate_zone,
        progress: checklist.progress || 0,
        completed_at: checklist.completed_at || undefined,
        items: items.map((item) => ({
          id: item.id,
          checklist_id: item.checklist_id,
          task_template_id: item.task_template_id || undefined,
          title: item.title,
          category: item.category || undefined,
          is_completed: Boolean(item.is_completed),
          completed_at: item.completed_at || undefined,
          completed_by: item.completed_by || undefined,
          notes: item.notes || undefined,
          photo_keys: this.safeJsonParse(item.photo_keys, undefined),
          sort_order: item.sort_order || undefined,
        })),
        created_at: checklist.created_at,
        updated_at: checklist.updated_at,
      });
    }

    return result;
  }

  /**
   * Add item to checklist
   */
  async addItem(
    householdId: string,
    checklistId: string,
    userId: string,
    input: {
      task_template_id?: string;
      title: string;
      category?: string;
      sort_order?: number;
    }
  ): Promise<SeasonalChecklistItemResponse> {
    // Verify checklist exists and user has access
    await this.getChecklist(householdId, checklistId, userId);

    const itemId = generateId();
    const timestamp = now();

    await this.db.insert(maintenanceSchema.seasonalChecklistItems).values({
      id: itemId,
      checklist_id: checklistId,
      task_template_id: input.task_template_id || null,
      title: input.title,
      category: input.category || null,
      is_completed: false,
      sort_order: input.sort_order || null,
      created_at: timestamp,
      updated_at: timestamp,
      updated_by: userId,
    });

    // Update progress
    await this.updateProgress(householdId, checklistId, userId);

    const item = await this.db
      .select()
      .from(maintenanceSchema.seasonalChecklistItems)
      .where(eq(maintenanceSchema.seasonalChecklistItems.id, itemId))
      .limit(1);

    if (item.length === 0) {
      throw new NotFoundError('Checklist item not found');
    }

    return {
      id: item[0].id,
      checklist_id: item[0].checklist_id,
      task_template_id: item[0].task_template_id || undefined,
      title: item[0].title,
      category: item[0].category || undefined,
      is_completed: Boolean(item[0].is_completed),
      sort_order: item[0].sort_order || undefined,
    };
  }

  /**
   * Update checklist item
   */
  async updateItem(
    householdId: string,
    checklistId: string,
    itemId: string,
    userId: string,
    input: {
      is_completed?: boolean;
      notes?: string;
      photo_keys?: string[];
    }
  ): Promise<SeasonalChecklistItemResponse> {
    // Verify checklist exists and user has access
    await this.getChecklist(householdId, checklistId, userId);

    const timestamp = now();
    const updateData: any = {
      updated_at: timestamp,
      updated_by: userId,
    };

    if (input.is_completed !== undefined) {
      updateData.is_completed = input.is_completed;
      if (input.is_completed) {
        updateData.completed_at = timestamp;
        updateData.completed_by = userId;
      } else {
        updateData.completed_at = null;
        updateData.completed_by = null;
      }
    }

    if (input.notes !== undefined) updateData.notes = input.notes || null;
    if (input.photo_keys !== undefined) updateData.photo_keys = input.photo_keys ? JSON.stringify(input.photo_keys) : null;

    await this.db
      .update(maintenanceSchema.seasonalChecklistItems)
      .set(updateData)
      .where(
        and(
          eq(maintenanceSchema.seasonalChecklistItems.id, itemId),
          eq(maintenanceSchema.seasonalChecklistItems.checklist_id, checklistId)
        )
      );

    // Update progress
    await this.updateProgress(householdId, checklistId, userId);

    const item = await this.db
      .select()
      .from(maintenanceSchema.seasonalChecklistItems)
      .where(eq(maintenanceSchema.seasonalChecklistItems.id, itemId))
      .limit(1);

    if (item.length === 0) {
      throw new NotFoundError('Checklist item not found');
    }

    return {
      id: item[0].id,
      checklist_id: item[0].checklist_id,
      task_template_id: item[0].task_template_id || undefined,
      title: item[0].title,
      category: item[0].category || undefined,
      is_completed: Boolean(item[0].is_completed),
      completed_at: item[0].completed_at || undefined,
      completed_by: item[0].completed_by || undefined,
      notes: item[0].notes || undefined,
      photo_keys: this.safeJsonParse(item[0].photo_keys, undefined),
      sort_order: item[0].sort_order || undefined,
    };
  }

  /**
   * Safe JSON parse helper
   */
  private safeJsonParse<T>(json: string | null | undefined, defaultValue: T): T {
    if (!json) return defaultValue;
    try {
      return JSON.parse(json);
    } catch (e) {
      console.error('Error parsing JSON:', e);
      return defaultValue;
    }
  }

  /**
   * Update checklist progress
   */
  private async updateProgress(
    householdId: string,
    checklistId: string,
    userId: string
  ): Promise<void> {
    const items = await this.db
      .select()
      .from(maintenanceSchema.seasonalChecklistItems)
      .where(eq(maintenanceSchema.seasonalChecklistItems.checklist_id, checklistId));

    const totalItems = items.length;
    const completedItems = items.filter((item) => {
      // Handle both boolean and integer (0/1) from database
      const isCompleted = typeof item.is_completed === 'boolean' 
        ? item.is_completed 
        : item.is_completed === 1;
      return isCompleted;
    }).length;
    const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

    const timestamp = now();
    const updateData: any = {
      progress,
      updated_at: timestamp,
      updated_by: userId,
    };

    if (progress === 100 && totalItems > 0) {
      updateData.completed_at = timestamp;
    }

    await this.db
      .update(maintenanceSchema.seasonalChecklists)
      .set(updateData)
      .where(
        and(
          eq(maintenanceSchema.seasonalChecklists.id, checklistId),
          eq(maintenanceSchema.seasonalChecklists.household_id, householdId)
        )
      );
  }

  /**
   * Delete a checklist
   */
  async deleteChecklist(_householdId: string, _checklistId: string, _userId: string): Promise<void> {
    throw new Error('Not implemented');
  }

  /**
   * Get progress for all checklists
   */
  async getProgress(_householdId: string, _userId: string): Promise<any> {
    throw new Error('Not implemented');
  }

  /**
   * Get current instance for a checklist
   */
  async getCurrentInstance(_householdId: string, _checklistId: string, _userId: string): Promise<any> {
    throw new Error('Not implemented');
  }

  /**
   * Complete a checklist item
   */
  async completeItem(_householdId: string, _instanceId: string, _itemId: string, _userId: string, _notes?: string): Promise<any> {
    throw new Error('Not implemented');
  }

  /**
   * Uncomplete a checklist item
   */
  async uncompleteItem(_householdId: string, _instanceId: string, _itemId: string, _userId: string): Promise<any> {
    throw new Error('Not implemented');
  }

  /**
   * Create default checklists for a household
   */
  async createDefaultChecklists(_householdId: string, _userId: string): Promise<void> {
    throw new Error('Not implemented');
  }
}
