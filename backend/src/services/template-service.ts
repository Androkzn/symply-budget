import { eq, and, isNull, or, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as maintenanceSchema from '../db/schema-maintenance';
import type { Database, Env, MaintenanceFrequency, SystemCategory } from '../types';
import { NotFoundError } from '../utils/errors';
import { generateId, now } from '../utils/id';

import { TaskService } from './task-service';

export interface MaintenanceTaskTemplateResponse {
  id: string;
  category: string;
  name: string;
  description?: string;
  frequency: string;
  custom_interval_days?: number;
  preferred_months?: number[];
  seasonal_only?: 'spring' | 'summer' | 'fall' | 'winter';
  difficulty?: 'easy' | 'moderate' | 'hard' | 'professional';
  estimated_duration?: number;
  estimated_cost?: {
    diy: number;
    professional: number;
  };
  tools_required?: string[];
  tutorial_url?: string;
  gva_specific: boolean;
  climate_zone?: string;
  created_at: string;
  updated_at: string;
}

export class TemplateService {
  private db: Database;
  private maintenanceService: TaskService;

  constructor(_env: Env, d1: D1Database) {
    this.db = drizzle(d1);
    this.maintenanceService = new TaskService(_env, d1);
  }

  /**
   * Get a template by ID
   */
  async getTemplate(templateId: string): Promise<MaintenanceTaskTemplateResponse> {
    const template = await this.db
      .select()
      .from(maintenanceSchema.maintenanceTaskTemplates)
      .where(
        and(
          eq(maintenanceSchema.maintenanceTaskTemplates.id, templateId),
          isNull(maintenanceSchema.maintenanceTaskTemplates.deleted_at)
        )
      )
      .limit(1);

    if (template.length === 0) {
      throw new NotFoundError('Template not found');
    }

    return this.mapTemplateToResponse(template[0]);
  }

  /**
   * List templates with optional filters
   */
  async listTemplates(filters?: {
    category?: SystemCategory;
    frequency?: MaintenanceFrequency;
    gva_specific?: boolean;
    climate_zone?: string;
    search?: string;
  }): Promise<MaintenanceTaskTemplateResponse[]> {
    const conditions: any[] = [
      isNull(maintenanceSchema.maintenanceTaskTemplates.deleted_at),
    ];

    if (filters?.category) {
      conditions.push(eq(maintenanceSchema.maintenanceTaskTemplates.category, filters.category));
    }

    if (filters?.frequency) {
      conditions.push(eq(maintenanceSchema.maintenanceTaskTemplates.frequency, filters.frequency));
    }

    if (filters?.gva_specific !== undefined) {
      conditions.push(
        eq(
          maintenanceSchema.maintenanceTaskTemplates.gva_specific,
          filters.gva_specific
        )
      );
    }

    if (filters?.climate_zone) {
      conditions.push(eq(maintenanceSchema.maintenanceTaskTemplates.climate_zone, filters.climate_zone));
    }

    if (filters?.search) {
      conditions.push(
        or(
          like(maintenanceSchema.maintenanceTaskTemplates.name, `%${filters.search}%`),
          like(maintenanceSchema.maintenanceTaskTemplates.description, `%${filters.search}%`)
        )
      );
    }

    const templates = await this.db
      .select()
      .from(maintenanceSchema.maintenanceTaskTemplates)
      .where(and(...conditions));

    return templates.map((t) => this.mapTemplateToResponse(t));
  }

  /**
   * Get seasonal templates for current season
   */
  async getSeasonalTemplates(
    season: 'spring' | 'summer' | 'fall' | 'winter',
    climateZone: string = 'pacific_northwest'
  ): Promise<MaintenanceTaskTemplateResponse[]> {
    const templates = await this.db
      .select()
      .from(maintenanceSchema.maintenanceTaskTemplates)
      .where(
        and(
          eq(maintenanceSchema.maintenanceTaskTemplates.seasonal_only, season),
          eq(maintenanceSchema.maintenanceTaskTemplates.climate_zone, climateZone),
          isNull(maintenanceSchema.maintenanceTaskTemplates.deleted_at)
        )
      );

    return templates.map((t) => this.mapTemplateToResponse(t));
  }

  /**
   * Create a task from a template
   */
  async createTaskFromTemplate(
    householdId: string,
    userId: string,
    templateId: string,
    overrides?: {
      title?: string;
      description?: string;
      frequency?: MaintenanceFrequency;
      custom_interval_days?: number;
      next_due_date?: string;
      assigned_to?: string;
      reminder_days_before?: number;
    }
  ) {
    const template = await this.getTemplate(templateId);

    // Calculate next due date if not provided
    let nextDueDate = overrides?.next_due_date;
    if (!nextDueDate && template.preferred_months && template.preferred_months.length > 0) {
      // Set to first preferred month of current or next year
      const now = new Date();
      const currentMonth = now.getMonth() + 1; // 1-12
      const validMonths = template.preferred_months.filter((m) => m >= 1 && m <= 12);
      if (validMonths.length > 0) {
        const nextPreferredMonth = validMonths.find((m) => m >= currentMonth) || validMonths[0];
        const year = nextPreferredMonth >= currentMonth ? now.getFullYear() : now.getFullYear() + 1;
        nextDueDate = `${year}-${String(nextPreferredMonth).padStart(2, '0')}-01`;
      }
    }

    return this.maintenanceService.createTask(householdId, userId, {
      title: overrides?.title || template.name,
      description: overrides?.description || template.description || undefined,
      system_category: template.category as SystemCategory,
      frequency: (overrides?.frequency || template.frequency) as MaintenanceFrequency,
      custom_interval_days: overrides?.custom_interval_days || template.custom_interval_days || undefined,
      next_due_date: nextDueDate,
      assigned_to: overrides?.assigned_to,
      reminder_days_before: overrides?.reminder_days_before || undefined,
    });
  }

  /**
   * Create a new template (admin function)
   */
  async createTemplate(
    input: {
      category: SystemCategory;
      name: string;
      description?: string;
      frequency: MaintenanceFrequency;
      custom_interval_days?: number;
      preferred_months?: number[];
      seasonal_only?: 'spring' | 'summer' | 'fall' | 'winter';
      difficulty?: 'easy' | 'moderate' | 'hard' | 'professional';
      estimated_duration?: number;
      estimated_cost?: { diy: number; professional: number };
      tools_required?: string[];
      tutorial_url?: string;
      gva_specific?: boolean;
      climate_zone?: string;
    }
  ): Promise<MaintenanceTaskTemplateResponse> {
    const templateId = generateId();
    const timestamp = now();

    await this.db.insert(maintenanceSchema.maintenanceTaskTemplates).values({
      id: templateId,
      category: input.category,
      name: input.name,
      description: input.description || null,
      frequency: input.frequency,
      custom_interval_days: input.custom_interval_days || null,
      preferred_months: input.preferred_months ? JSON.stringify(input.preferred_months) : null,
      seasonal_only: input.seasonal_only || null,
      difficulty: input.difficulty || null,
      estimated_duration: input.estimated_duration || null,
      estimated_cost: input.estimated_cost ? JSON.stringify(input.estimated_cost) : null,
      tools_required: input.tools_required ? JSON.stringify(input.tools_required) : null,
      tutorial_url: input.tutorial_url || null,
      gva_specific: input.gva_specific ?? false,
      climate_zone: input.climate_zone || null,
      created_at: timestamp,
      updated_at: timestamp,
    });

    return this.getTemplate(templateId);
  }

  /**
   * Update a template (admin function)
   */
  async updateTemplate(
    templateId: string,
    input: Partial<{
      category: SystemCategory;
      name: string;
      description: string;
      frequency: MaintenanceFrequency;
      custom_interval_days: number;
      preferred_months: number[];
      seasonal_only: 'spring' | 'summer' | 'fall' | 'winter';
      difficulty: 'easy' | 'moderate' | 'hard' | 'professional';
      estimated_duration: number;
      estimated_cost: { diy: number; professional: number };
      tools_required: string[];
      tutorial_url: string;
      gva_specific: boolean;
      climate_zone: string;
    }>
  ): Promise<MaintenanceTaskTemplateResponse> {
    const timestamp = now();
    const updateData: any = {
      updated_at: timestamp,
    };

    if (input.category !== undefined) updateData.category = input.category;
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description || null;
    if (input.frequency !== undefined) updateData.frequency = input.frequency;
    if (input.custom_interval_days !== undefined) updateData.custom_interval_days = input.custom_interval_days || null;
    if (input.preferred_months !== undefined) updateData.preferred_months = input.preferred_months ? JSON.stringify(input.preferred_months) : null;
    if (input.seasonal_only !== undefined) updateData.seasonal_only = input.seasonal_only || null;
    if (input.difficulty !== undefined) updateData.difficulty = input.difficulty || null;
    if (input.estimated_duration !== undefined) updateData.estimated_duration = input.estimated_duration || null;
    if (input.estimated_cost !== undefined) updateData.estimated_cost = input.estimated_cost ? JSON.stringify(input.estimated_cost) : null;
    if (input.tools_required !== undefined) updateData.tools_required = input.tools_required ? JSON.stringify(input.tools_required) : null;
    if (input.tutorial_url !== undefined) updateData.tutorial_url = input.tutorial_url || null;
    if (input.gva_specific !== undefined) updateData.gva_specific = input.gva_specific;
    if (input.climate_zone !== undefined) updateData.climate_zone = input.climate_zone || null;

    await this.db
      .update(maintenanceSchema.maintenanceTaskTemplates)
      .set(updateData)
      .where(eq(maintenanceSchema.maintenanceTaskTemplates.id, templateId));

    return this.getTemplate(templateId);
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
   * Map database record to response
   */
  private mapTemplateToResponse(record: any): MaintenanceTaskTemplateResponse {
    return {
      id: record.id,
      category: record.category,
      name: record.name,
      description: record.description || undefined,
      frequency: record.frequency,
      custom_interval_days: record.custom_interval_days || undefined,
      preferred_months: this.safeJsonParse(record.preferred_months, undefined),
      seasonal_only: record.seasonal_only || undefined,
      difficulty: record.difficulty || undefined,
      estimated_duration: record.estimated_duration || undefined,
      estimated_cost: this.safeJsonParse(record.estimated_cost, undefined),
      tools_required: this.safeJsonParse(record.tools_required, undefined),
      tutorial_url: record.tutorial_url || undefined,
      gva_specific: record.gva_specific === 1,
      climate_zone: record.climate_zone || undefined,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  }
}
