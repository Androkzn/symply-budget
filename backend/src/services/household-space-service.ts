import { eq, and, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { PRESET_SPACE_TEMPLATES, SPACE_SET_TEMPLATES } from '../data/preset-spaces';
import * as schema from '../db/schema';
import type { Database, Env } from '../types';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
} from '../utils/errors';
import { generateId, now } from '../utils/id';
import { rowsChanged } from '../utils/optimistic-lock';
import {
  categoryToFloorLevel,
  disambiguatePresetName,
  resolveBulkDuplicateName,
} from '../utils/space-names';
import type {
  CreateHouseholdSpaceInput,
  UpdateHouseholdSpaceInput,
} from '../utils/validation';

import { HouseholdService } from './household-service';

/** Case-insensitive duplicate-name helpers for preset spaces. */
function normalizeSpaceName(name: string): string {
  return name.trim().toLowerCase();
}

function hasDuplicateName(names: Set<string>, name: string): boolean {
  return names.has(normalizeSpaceName(name));
}

export class HouseholdSpaceService {
  private db: Database;
  private householdService: HouseholdService;

  constructor(private env: Env, d1: D1Database) {
    this.db = drizzle(d1, { schema });
    this.householdService = new HouseholdService(env, d1);
  }

  /**
   * Verify user is household owner (for write operations)
   */
  private async verifyOwnership(householdId: string, userId: string) {
    const household = await this.householdService.getHousehold(householdId, userId);
    const members = await this.householdService.getMembers(householdId, userId);
    const currentMember = members.find((m) => m.user_id === userId);

    if (currentMember?.role !== 'owner') {
      throw new ForbiddenError('Only household owners can manage spaces');
    }

    return household;
  }

  /**
   * Create a new household space
   */
  async createSpace(householdId: string, userId: string, input: CreateHouseholdSpaceInput) {
    await this.verifyOwnership(householdId, userId);
    const existingNames = await this.getExistingSpaceNames(householdId);
    return this.insertSpace(householdId, userId, input, existingNames);
  }

  private async getExistingSpaceNames(householdId: string): Promise<Set<string>> {
    const spaces = await this.db
      .select({ name: schema.householdSpaces.name })
      .from(schema.householdSpaces)
      .where(
        and(
          eq(schema.householdSpaces.household_id, householdId),
          isNull(schema.householdSpaces.deleted_at)
        )
      );

    return new Set(spaces.map((s) => normalizeSpaceName(s.name)));
  }

  private async insertSpace(
    householdId: string,
    userId: string,
    input: CreateHouseholdSpaceInput,
    existingNames: Set<string>
  ) {
    let name = input.name;
    if (hasDuplicateName(existingNames, name)) {
      if (input.space_type === 'preset') {
        name = disambiguatePresetName(name, input, existingNames);
      } else {
        throw new ValidationError({ name: ['A space with this name already exists'] });
      }
    }

    const id = generateId();
    const timestamp = now();

    // Get max display_order for this household
    const result = await this.db
      .select({ max: sql<number>`MAX(${schema.householdSpaces.display_order})` })
      .from(schema.householdSpaces)
      .where(
        and(
          eq(schema.householdSpaces.household_id, householdId),
          isNull(schema.householdSpaces.deleted_at)
        )
      );

    const maxOrder = result[0]?.max ?? -1;

    const space = {
      id,
      household_id: householdId,
      ...input,
      name,
      display_order: input.display_order ?? maxOrder + 1,
      created_at: timestamp,
      updated_at: timestamp,
      updated_by: userId,
      deleted_at: null,
      version: 1,
    };

    await this.db.insert(schema.householdSpaces).values(space);
    existingNames.add(normalizeSpaceName(name));

    return this.getSpace(householdId, id, userId);
  }

  /**
   * Get a single household space
   */
  async getSpace(householdId: string, spaceId: string, userId: string) {
    // Verify access (any member can view)
    await this.householdService.getHousehold(householdId, userId);

    const result = await this.db
      .select()
      .from(schema.householdSpaces)
      .where(
        and(
          eq(schema.householdSpaces.id, spaceId),
          eq(schema.householdSpaces.household_id, householdId),
          isNull(schema.householdSpaces.deleted_at)
        )
      );

    const space = result[0];
    if (!space) {
      throw new NotFoundError('Space not found');
    }

    // Get task counts
    const stats = await this.getSpaceStats(householdId, spaceId);

    return {
      ...space,
      custom_image_url: space.custom_image_key
        ? await this.getSignedImageUrl(space.custom_image_key)
        : null,
      ...stats,
    };
  }

  /**
   * List all spaces for a household
   */
  async listSpaces(
    householdId: string,
    userId: string,
    filters?: {
      category?: string;
      floor_level?: number;
    }
  ) {
    await this.householdService.getHousehold(householdId, userId);

    // Build query conditions
    const conditions = [
      eq(schema.householdSpaces.household_id, householdId),
      isNull(schema.householdSpaces.deleted_at),
    ];

    if (filters?.category) {
      conditions.push(eq(schema.householdSpaces.category, filters.category));
    }

    if (filters?.floor_level !== undefined) {
      conditions.push(eq(schema.householdSpaces.floor_level, filters.floor_level));
    }

    const spaces = await this.db
      .select()
      .from(schema.householdSpaces)
      .where(and(...conditions))
      .orderBy(schema.householdSpaces.display_order, schema.householdSpaces.created_at);

    // Add task counts and signed URLs for each space
    return Promise.all(
      spaces.map(async (space) => ({
        ...space,
        custom_image_url: space.custom_image_key
          ? await this.getSignedImageUrl(space.custom_image_key)
          : null,
        ...(await this.getSpaceStats(householdId, space.id)),
      }))
    );
  }

  /**
   * Update a household space (optimistic lock on `version`).
   */
  async updateSpace(
    householdId: string,
    spaceId: string,
    userId: string,
    input: UpdateHouseholdSpaceInput
  ) {
    await this.verifyOwnership(householdId, userId);

    const { version, ...fields } = input;
    if (version === undefined) {
      throw new ValidationError({ version: ['version is required for updates'] });
    }

    const timestamp = now();
    const nextVersion = version + 1;

    const result = await this.db
      .update(schema.householdSpaces)
      .set({
        ...fields,
        updated_at: timestamp,
        updated_by: userId,
        version: nextVersion,
      })
      .where(
        and(
          eq(schema.householdSpaces.id, spaceId),
          eq(schema.householdSpaces.household_id, householdId),
          eq(schema.householdSpaces.version, version),
          isNull(schema.householdSpaces.deleted_at)
        )
      )
      .run();

    if (rowsChanged(result) === 0) {
      const existing = await this.db
        .select({ id: schema.householdSpaces.id })
        .from(schema.householdSpaces)
        .where(
          and(
            eq(schema.householdSpaces.id, spaceId),
            eq(schema.householdSpaces.household_id, householdId),
            isNull(schema.householdSpaces.deleted_at)
          )
        )
        .get();
      if (!existing) {
        throw new NotFoundError('Space not found');
      }
      throw new ConflictError('Space was modified by another request');
    }

    return this.getSpace(householdId, spaceId, userId);
  }

  /**
   * Delete a household space (soft delete). When `expectedVersion` is supplied,
   * uses compare-and-swap; omit for legacy callers without optimistic locking.
   */
  async deleteSpace(
    householdId: string,
    spaceId: string,
    userId: string,
    expectedVersion?: number
  ) {
    await this.verifyOwnership(householdId, userId);

    const timestamp = now();

    const conditions = [
      eq(schema.householdSpaces.id, spaceId),
      eq(schema.householdSpaces.household_id, householdId),
      isNull(schema.householdSpaces.deleted_at),
    ];
    if (expectedVersion !== undefined) {
      conditions.push(eq(schema.householdSpaces.version, expectedVersion));
    }

    const result = await this.db
      .update(schema.householdSpaces)
      .set({
        deleted_at: timestamp,
        updated_at: timestamp,
        updated_by: userId,
        version: expectedVersion !== undefined ? expectedVersion + 1 : sql`${schema.householdSpaces.version} + 1`,
      })
      .where(and(...conditions))
      .run();

    if (expectedVersion !== undefined && rowsChanged(result) === 0) {
      const existing = await this.db
        .select({ id: schema.householdSpaces.id })
        .from(schema.householdSpaces)
        .where(
          and(
            eq(schema.householdSpaces.id, spaceId),
            eq(schema.householdSpaces.household_id, householdId),
            isNull(schema.householdSpaces.deleted_at)
          )
        )
        .get();
      if (!existing) {
        throw new NotFoundError('Space not found');
      }
      throw new ConflictError('Space was modified by another request');
    }

    // Set space_id to null for all associated tasks
    await this.db
      .update(schema.tasks)
      .set({ space_id: null })
      .where(eq(schema.tasks.space_id, spaceId));
  }

  /**
   * Reorder spaces by updating display_order (per-row optimistic lock).
   */
  async reorderSpaces(
    householdId: string,
    userId: string,
    spaceOrders: Array<{ space_id: string; display_order: number; version: number }>
  ) {
    await this.verifyOwnership(householdId, userId);

    const timestamp = now();

    for (const { space_id, display_order, version } of spaceOrders) {
      const result = await this.db
        .update(schema.householdSpaces)
        .set({
          display_order,
          updated_at: timestamp,
          updated_by: userId,
          version: version + 1,
        })
        .where(
          and(
            eq(schema.householdSpaces.id, space_id),
            eq(schema.householdSpaces.household_id, householdId),
            eq(schema.householdSpaces.version, version),
            isNull(schema.householdSpaces.deleted_at)
          )
        )
        .run();

      if (rowsChanged(result) === 0) {
        throw new ConflictError(`Space ${space_id} was modified by another request`);
      }
    }
  }

  /**
   * Bulk create spaces from a template
   */
  async bulkCreateFromTemplate(
    householdId: string,
    userId: string,
    templateType: string
  ) {
    await this.verifyOwnership(householdId, userId);

    const spaceNames = SPACE_SET_TEMPLATES[templateType];
    if (!spaceNames) {
      throw new ValidationError({ templateType: ['Invalid template type'] });
    }

    const templates = PRESET_SPACE_TEMPLATES.filter((t) =>
      spaceNames.includes(t.name)
    );

    const existingNames = await this.getExistingSpaceNames(householdId);
    const nameCounts: Record<string, number> = {};
    const createdSpaces = [];
    for (let i = 0; i < templates.length; i++) {
      const template = templates[i];
      const occurrence = (nameCounts[template.name] ?? 0) + 1;
      nameCounts[template.name] = occurrence;
      const name = resolveBulkDuplicateName(template.name, occurrence, template.category);
      const space = await this.insertSpace(householdId, userId, {
        name,
        space_type: 'preset',
        category: template.category,
        floor_level: categoryToFloorLevel(template.category),
        icon_emoji: template.emoji,
        icon_color: template.color,
        display_order: i,
      }, existingNames);
      existingNames.add(normalizeSpaceName(name));
      createdSpaces.push(space);
    }

    return createdSpaces;
  }

  /**
   * Get task statistics for a space
   */
  private async getSpaceStats(householdId: string, spaceId: string) {
    const result = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.space_id, spaceId),
          eq(schema.tasks.household_id, householdId),
          eq(schema.tasks.is_active, true),
          isNull(schema.tasks.deleted_at)
        )
      );

    const taskCount = result[0]?.count ?? 0;

    return {
      task_count: taskCount,
      maintenance_task_count: taskCount,
      action_item_count: 0,
    };
  }

  /**
   * Generate signed URL for custom space image
   */
  private async getSignedImageUrl(imageKey: string): Promise<string> {
    try {
      // Get the object from R2
      const object = await this.env.REPORTS_BUCKET.get(`space-images/${imageKey}`);

      if (!object) {
        console.warn(`Space image not found: ${imageKey}`);
        return '';
      }

      // R2 doesn't support signed URLs directly yet, so we'll construct a public URL
      // In production, you should use a custom domain with R2 public bucket access
      // or implement a proxy endpoint that serves the images

      // For now, return the imageKey as-is and handle it via a proxy endpoint
      // The frontend will call GET /api/space-images/:imageKey
      return `${this.env.API_URL}/api/space-images/${imageKey}`;
    } catch (error) {
      console.error('Error generating signed URL for space image:', error);
      return '';
    }
  }

  /**
   * Get preset templates
   */
  getPresetTemplates() {
    return PRESET_SPACE_TEMPLATES;
  }
}
