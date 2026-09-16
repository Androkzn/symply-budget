import { eq, and, isNull, desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as maintenanceSchema from '../db/schema-maintenance';
import type { Database, Env } from '../types';
import { NotFoundError } from '../utils/errors';
import { generateId, now } from '../utils/id';

import { HouseholdService } from './household-service';

export interface ApplianceResponse {
  id: string;
  household_id: string;
  space_id?: string;
  name: string;
  category: string;
  type: string;
  location?: string;
  brand?: string;
  model?: string;
  serial_number?: string;
  purchase_date?: string;
  install_date?: string;
  expected_lifespan?: number;
  warranty: {
    manufacturer?: {
      expiration: string;
      coverage: string;
    };
    extended?: {
      provider: string;
      expiration: string;
      coverage: string;
      claimPhone?: string;
    };
  };
  purchase_cost?: number;
  total_maintenance_cost: number;
  created_at: string;
  updated_at: string;
}

export interface ApplianceDocumentResponse {
  id: string;
  appliance_id: string;
  type: 'receipt' | 'warranty' | 'manual' | 'service_record' | 'photo';
  r2_key: string;
  upload_date: string;
}

export interface ApplianceServiceHistoryResponse {
  id: string;
  appliance_id: string;
  service_date: string;
  description: string;
  cost?: number;
  provider_id?: string;
  completed_by?: string;
}

export class ApplianceService {
  private db: Database;
  private householdService: HouseholdService;

  constructor(_env: Env, d1: D1Database) {
    this.db = drizzle(d1);
    this.householdService = new HouseholdService(_env, d1);
  }

  /**
   * Create a new appliance
   */
  async createAppliance(
    householdId: string,
    userId: string,
    input: {
      space_id?: string;
      name: string;
      category: string;
      type: string;
      location?: string;
      brand?: string;
      model?: string;
      serial_number?: string;
      purchase_date?: string;
      install_date?: string;
      expected_lifespan?: number;
      warranty?: ApplianceResponse['warranty'];
      purchase_cost?: number;
    }
  ): Promise<ApplianceResponse> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    const applianceId = generateId();
    const timestamp = now();

    await this.db.insert(maintenanceSchema.appliances).values({
      id: applianceId,
      household_id: householdId,
      space_id: input.space_id || null,
      name: input.name,
      category: input.category,
      type: input.type,
      location: input.location || null,
      brand: input.brand || null,
      model: input.model || null,
      serial_number: input.serial_number || null,
      purchase_date: input.purchase_date || null,
      install_date: input.install_date || null,
      expected_lifespan: input.expected_lifespan || null,
      warranty: input.warranty ? JSON.stringify(input.warranty) : null,
      purchase_cost: input.purchase_cost ? Math.round(input.purchase_cost * 100) : null, // Convert to cents
      total_maintenance_cost: 0,
      created_at: timestamp,
      updated_at: timestamp,
      updated_by: userId,
    });

    return this.getAppliance(householdId, applianceId, userId);
  }

  /**
   * Get an appliance
   */
  async getAppliance(
    householdId: string,
    applianceId: string,
    userId: string
  ): Promise<ApplianceResponse> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    const appliance = await this.db
      .select()
      .from(maintenanceSchema.appliances)
      .where(
        and(
          eq(maintenanceSchema.appliances.id, applianceId),
          eq(maintenanceSchema.appliances.household_id, householdId),
          isNull(maintenanceSchema.appliances.deleted_at)
        )
      )
      .limit(1);

    if (appliance.length === 0) {
      throw new NotFoundError('Appliance not found');
    }

    return this.mapApplianceToResponse(appliance[0]);
  }

  /**
   * List appliances for a household
   */
  async listAppliances(
    householdId: string,
    userId: string,
    filters?: {
      category?: string;
      space_id?: string;
    }
  ): Promise<ApplianceResponse[]> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    const conditions: any[] = [
      eq(maintenanceSchema.appliances.household_id, householdId),
      isNull(maintenanceSchema.appliances.deleted_at),
    ];

    if (filters?.category) {
      conditions.push(eq(maintenanceSchema.appliances.category, filters.category));
    }

    if (filters?.space_id) {
      conditions.push(eq(maintenanceSchema.appliances.space_id, filters.space_id));
    }

    const appliances = await this.db
      .select()
      .from(maintenanceSchema.appliances)
      .where(and(...conditions))
      .orderBy(desc(maintenanceSchema.appliances.created_at));

    return appliances.map((a) => this.mapApplianceToResponse(a));
  }

  /**
   * Update an appliance
   */
  async updateAppliance(
    householdId: string,
    applianceId: string,
    userId: string,
    input: {
      space_id?: string;
      name?: string;
      category?: string;
      type?: string;
      location?: string;
      brand?: string;
      model?: string;
      serial_number?: string;
      purchase_date?: string;
      install_date?: string;
      expected_lifespan?: number;
      warranty?: ApplianceResponse['warranty'];
      purchase_cost?: number;
    }
  ): Promise<ApplianceResponse> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    const timestamp = now();
    const updateData: any = {
      updated_at: timestamp,
      updated_by: userId,
    };

    if (input.space_id !== undefined) updateData.space_id = input.space_id || null;
    if (input.name !== undefined) updateData.name = input.name;
    if (input.category !== undefined) updateData.category = input.category;
    if (input.type !== undefined) updateData.type = input.type;
    if (input.location !== undefined) updateData.location = input.location || null;
    if (input.brand !== undefined) updateData.brand = input.brand || null;
    if (input.model !== undefined) updateData.model = input.model || null;
    if (input.serial_number !== undefined) updateData.serial_number = input.serial_number || null;
    if (input.purchase_date !== undefined) updateData.purchase_date = input.purchase_date || null;
    if (input.install_date !== undefined) updateData.install_date = input.install_date || null;
    if (input.expected_lifespan !== undefined) updateData.expected_lifespan = input.expected_lifespan || null;
    if (input.warranty !== undefined) updateData.warranty = input.warranty ? JSON.stringify(input.warranty) : null;
    if (input.purchase_cost !== undefined) {
      updateData.purchase_cost = input.purchase_cost ? Math.round(input.purchase_cost * 100) : null;
    }

    await this.db
      .update(maintenanceSchema.appliances)
      .set(updateData)
      .where(
        and(
          eq(maintenanceSchema.appliances.id, applianceId),
          eq(maintenanceSchema.appliances.household_id, householdId)
        )
      );

    return this.getAppliance(householdId, applianceId, userId);
  }

  /**
   * Delete an appliance (soft delete)
   */
  async deleteAppliance(
    householdId: string,
    applianceId: string,
    userId: string
  ): Promise<void> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    const timestamp = now();

    await this.db
      .update(maintenanceSchema.appliances)
      .set({
        deleted_at: timestamp,
        updated_at: timestamp,
        updated_by: userId,
      })
      .where(
        and(
          eq(maintenanceSchema.appliances.id, applianceId),
          eq(maintenanceSchema.appliances.household_id, householdId)
        )
      );
  }

  /**
   * Add a document to an appliance
   */
  async addDocument(
    householdId: string,
    applianceId: string,
    userId: string,
    input: {
      type: 'receipt' | 'warranty' | 'manual' | 'service_record' | 'photo';
      r2_key: string;
    }
  ): Promise<ApplianceDocumentResponse> {
    // Verify appliance exists and user has access
    await this.getAppliance(householdId, applianceId, userId);

    const documentId = generateId();
    const timestamp = now();

    await this.db.insert(maintenanceSchema.applianceDocuments).values({
      id: documentId,
      appliance_id: applianceId,
      type: input.type,
      r2_key: input.r2_key,
      upload_date: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
      updated_by: userId,
    });

    const document = await this.db
      .select()
      .from(maintenanceSchema.applianceDocuments)
      .where(eq(maintenanceSchema.applianceDocuments.id, documentId))
      .limit(1);

    if (document.length === 0) {
      throw new NotFoundError('Document not found');
    }

    return {
      id: document[0].id,
      appliance_id: document[0].appliance_id,
      type: document[0].type as any,
      r2_key: document[0].r2_key,
      upload_date: document[0].upload_date,
    };
  }

  /**
   * List documents for an appliance
   */
  async listDocuments(
    householdId: string,
    applianceId: string,
    userId: string
  ): Promise<ApplianceDocumentResponse[]> {
    // Verify appliance exists and user has access
    await this.getAppliance(householdId, applianceId, userId);

    const documents = await this.db
      .select()
      .from(maintenanceSchema.applianceDocuments)
      .where(eq(maintenanceSchema.applianceDocuments.appliance_id, applianceId))
      .orderBy(desc(maintenanceSchema.applianceDocuments.upload_date));

    return documents.map((d) => ({
      id: d.id,
      appliance_id: d.appliance_id,
      type: d.type as any,
      r2_key: d.r2_key,
      upload_date: d.upload_date,
    }));
  }

  /**
   * Add service history entry
   */
  async addServiceHistory(
    householdId: string,
    applianceId: string,
    userId: string,
    input: {
      service_date: string;
      description: string;
      cost?: number;
      provider_id?: string;
    }
  ): Promise<ApplianceServiceHistoryResponse> {
    // Verify appliance exists and user has access
    const appliance = await this.getAppliance(householdId, applianceId, userId);

    const historyId = generateId();
    const timestamp = now();

    await this.db.insert(maintenanceSchema.applianceServiceHistory).values({
      id: historyId,
      appliance_id: applianceId,
      service_date: input.service_date,
      description: input.description,
      cost: input.cost ? Math.round(input.cost * 100) : null, // Convert to cents
      provider_id: input.provider_id || null,
      completed_by: userId,
      created_at: timestamp,
      updated_at: timestamp,
      updated_by: userId,
    });

    // Update total maintenance cost (stored in cents). `appliance` came from
    // getAppliance(), whose mapper already divides total_maintenance_cost by 100
    // (dollars) — convert it back to cents before accumulating, otherwise every
    // entry after the first mixes dollars + cents and corrupts the running total.
    const currentCost = Math.round((appliance.total_maintenance_cost || 0) * 100);
    const newCost = input.cost ? Math.round(input.cost * 100) : 0;
    const newTotalCost = currentCost + newCost;
    await this.db
      .update(maintenanceSchema.appliances)
      .set({
        total_maintenance_cost: newTotalCost,
        updated_at: timestamp,
        updated_by: userId,
      })
      .where(eq(maintenanceSchema.appliances.id, applianceId));

    const history = await this.db
      .select()
      .from(maintenanceSchema.applianceServiceHistory)
      .where(eq(maintenanceSchema.applianceServiceHistory.id, historyId))
      .limit(1);

    if (history.length === 0) {
      throw new NotFoundError('Service history entry not found');
    }

    return {
      id: history[0].id,
      appliance_id: history[0].appliance_id,
      service_date: history[0].service_date,
      description: history[0].description,
      cost: history[0].cost ? history[0].cost / 100 : undefined,
      provider_id: history[0].provider_id || undefined,
      completed_by: history[0].completed_by || undefined,
    };
  }

  /**
   * Get service history for an appliance
   */
  async getServiceHistory(
    householdId: string,
    applianceId: string,
    userId: string
  ): Promise<ApplianceServiceHistoryResponse[]> {
    // Verify appliance exists and user has access
    await this.getAppliance(householdId, applianceId, userId);

    const history = await this.db
      .select()
      .from(maintenanceSchema.applianceServiceHistory)
      .where(eq(maintenanceSchema.applianceServiceHistory.appliance_id, applianceId))
      .orderBy(desc(maintenanceSchema.applianceServiceHistory.service_date));

    return history.map((h) => ({
      id: h.id,
      appliance_id: h.appliance_id,
      service_date: h.service_date,
      description: h.description,
      cost: h.cost ? h.cost / 100 : undefined,
      provider_id: h.provider_id || undefined,
      completed_by: h.completed_by || undefined,
    }));
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
  private mapApplianceToResponse(record: any): ApplianceResponse {
    return {
      id: record.id,
      household_id: record.household_id,
      space_id: record.space_id || undefined,
      name: record.name,
      category: record.category,
      type: record.type,
      location: record.location || undefined,
      brand: record.brand || undefined,
      model: record.model || undefined,
      serial_number: record.serial_number || undefined,
      purchase_date: record.purchase_date || undefined,
      install_date: record.install_date || undefined,
      expected_lifespan: record.expected_lifespan || undefined,
      warranty: this.safeJsonParse(record.warranty, {}),
      purchase_cost: record.purchase_cost ? record.purchase_cost / 100 : undefined,
      total_maintenance_cost: record.total_maintenance_cost ? record.total_maintenance_cost / 100 : 0,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  }
}
