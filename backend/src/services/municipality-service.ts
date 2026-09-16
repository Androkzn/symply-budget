import { eq, and, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as maintenanceSchema from '../db/schema-maintenance';
import type { Database, Env } from '../types';
import { generateId, now } from '../utils/id';

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

export class MunicipalityService {
  private db: Database;

  constructor(_env: Env, d1: D1Database) {
    this.db = drizzle(d1);
  }

  /**
   * Get municipality configuration by name
   */
  async getMunicipalityByName(name: string): Promise<MunicipalityConfigResponse | null> {
    const config = await this.db
      .select()
      .from(maintenanceSchema.municipalityConfigs)
      .where(
        and(
          eq(maintenanceSchema.municipalityConfigs.name, name),
          isNull(maintenanceSchema.municipalityConfigs.deleted_at)
        )
      )
      .limit(1);

    if (config.length === 0) {
      return null;
    }

    return this.mapConfigToResponse(config[0]);
  }

  /**
   * Get municipality configuration by code
   */
  async getMunicipalityByCode(code: string): Promise<MunicipalityConfigResponse | null> {
    const config = await this.db
      .select()
      .from(maintenanceSchema.municipalityConfigs)
      .where(
        and(
          eq(maintenanceSchema.municipalityConfigs.code, code),
          isNull(maintenanceSchema.municipalityConfigs.deleted_at)
        )
      )
      .limit(1);

    if (config.length === 0) {
      return null;
    }

    return this.mapConfigToResponse(config[0]);
  }

  /**
   * List all municipalities
   */
  async listMunicipalities(): Promise<MunicipalityConfigResponse[]> {
    const configs = await this.db
      .select()
      .from(maintenanceSchema.municipalityConfigs)
      .where(isNull(maintenanceSchema.municipalityConfigs.deleted_at));

    return configs.map((c) => this.mapConfigToResponse(c));
  }

  /**
   * Create or update municipality configuration (admin function)
   */
  async upsertMunicipality(
    input: {
      name: string;
      code: string;
      garbage_provider?: string;
      garbage_schedule_lookup_url?: string;
      noise_bylaws?: MunicipalityConfigResponse['noise_bylaws'];
      property_maintenance_bylaws?: MunicipalityConfigResponse['property_maintenance_bylaws'];
      contacts?: MunicipalityConfigResponse['contacts'];
    }
  ): Promise<MunicipalityConfigResponse> {
    const timestamp = now();

    // Check if exists
    const existing = await this.db
      .select()
      .from(maintenanceSchema.municipalityConfigs)
      .where(
        and(
          eq(maintenanceSchema.municipalityConfigs.code, input.code),
          isNull(maintenanceSchema.municipalityConfigs.deleted_at)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Update
      await this.db
        .update(maintenanceSchema.municipalityConfigs)
        .set({
          name: input.name,
          garbage_provider: input.garbage_provider || null,
          garbage_schedule_lookup_url: input.garbage_schedule_lookup_url || null,
          noise_bylaws: input.noise_bylaws ? JSON.stringify(input.noise_bylaws) : null,
          property_maintenance_bylaws: input.property_maintenance_bylaws
            ? JSON.stringify(input.property_maintenance_bylaws)
            : null,
          contacts: input.contacts ? JSON.stringify(input.contacts) : null,
          last_updated: timestamp,
          updated_at: timestamp,
        })
        .where(eq(maintenanceSchema.municipalityConfigs.code, input.code));

      const updated = await this.db
        .select()
        .from(maintenanceSchema.municipalityConfigs)
        .where(eq(maintenanceSchema.municipalityConfigs.code, input.code))
        .limit(1);

      return this.mapConfigToResponse(updated[0]);
    } else {
      // Create
      const configId = generateId();

      await this.db.insert(maintenanceSchema.municipalityConfigs).values({
        id: configId,
        name: input.name,
        code: input.code,
        garbage_provider: input.garbage_provider || null,
        garbage_schedule_lookup_url: input.garbage_schedule_lookup_url || null,
        noise_bylaws: input.noise_bylaws ? JSON.stringify(input.noise_bylaws) : null,
        property_maintenance_bylaws: input.property_maintenance_bylaws
          ? JSON.stringify(input.property_maintenance_bylaws)
          : null,
        contacts: input.contacts ? JSON.stringify(input.contacts) : null,
        last_updated: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
      });

      const created = await this.db
        .select()
        .from(maintenanceSchema.municipalityConfigs)
        .where(eq(maintenanceSchema.municipalityConfigs.id, configId))
        .limit(1);

      return this.mapConfigToResponse(created[0]);
    }
  }

  /**
   * Detect municipality from city and postal code
   */
  async detectMunicipality(city?: string | null, _postalCode?: string | null): Promise<string> {
    if (city) {
      const normalizedCity = city.toLowerCase().trim();
      // Try to find exact match first
      const configs = await this.listMunicipalities();
      for (const config of configs) {
        if (config.name.toLowerCase() === normalizedCity) {
          return config.name;
        }
      }

      // Try partial match
      for (const config of configs) {
        if (normalizedCity.includes(config.name.toLowerCase()) || config.name.toLowerCase().includes(normalizedCity)) {
          return config.name;
        }
      }
    }

    // Default to Vancouver if can't determine
    return 'Vancouver';
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
  private mapConfigToResponse(record: any): MunicipalityConfigResponse {
    return {
      id: record.id,
      name: record.name,
      code: record.code,
      garbage_provider: record.garbage_provider || undefined,
      garbage_schedule_lookup_url: record.garbage_schedule_lookup_url || undefined,
      waste_regulations: this.safeJsonParse(record.waste_regulations, undefined),
      noise_bylaws: this.safeJsonParse(record.noise_bylaws, undefined),
      property_maintenance_bylaws: this.safeJsonParse(record.property_maintenance_bylaws, undefined),
      contacts: this.safeJsonParse(record.contacts, undefined),
      last_updated: record.last_updated || undefined,
    };
  }
}
