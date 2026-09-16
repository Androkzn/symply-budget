import { eq, and, isNull, desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';
import * as gardenSchema from '../db/schema-garden-plans';
import type {
  GardenPlanBoundarySource,
  GardenPlanType,
  GardenPlanContentType,
} from '../db/schema-garden-plans';
import type { Database, Env } from '../types';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import { generateId, now } from '../utils/id';

import {
  normalizeVectorObjects,
  type GardenPlanVectorObject,
} from './garden-plan-vector-objects';
import { HouseholdService } from './household-service';

type LinkedEntityType = 'maintenance_task' | 'action_item';

export class GardenPlanService {
  private db: Database;
  private env: Env;
  private householdService: HouseholdService;

  constructor(env: Env, d1: D1Database) {
    this.db = drizzle(d1, { schema: { ...schema, ...gardenSchema } });
    this.env = env;
    this.householdService = new HouseholdService(env, d1);
  }

  async generateUploadUrl(
    householdId: string,
    userId: string,
    input: {
      filename: string;
      file_size: number;
      content_type: GardenPlanContentType;
      plan_type?: GardenPlanType;
      label?: string;
    }
  ): Promise<{ garden_plan_id: string; upload_url: string; expires_at: string }> {
    await this.householdService.getHousehold(householdId, userId);

    const gardenPlanId = generateId();
    const fileKey = `garden-plans/${householdId}/${gardenPlanId}/${input.filename}`;
    const timestamp = now();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.db.insert(gardenSchema.gardenPlans).values({
      id: gardenPlanId,
      household_id: householdId,
      plan_type: input.plan_type || 'garden',
      filename: input.filename,
      file_size: input.file_size,
      content_type: input.content_type,
      original_file_key: fileKey,
      label: input.label,
      status: 'pending_upload',
      created_by: userId,
      created_at: timestamp,
      updated_at: timestamp,
    });

    const uploadUrl = `${this.env.API_URL}/households/${householdId}/garden-plans/${gardenPlanId}/upload`;

    return {
      garden_plan_id: gardenPlanId,
      upload_url: uploadUrl,
      expires_at: expiresAt.toISOString(),
    };
  }

  async uploadFile(
    householdId: string,
    gardenPlanId: string,
    userId: string,
    file: ArrayBuffer,
    contentType: string
  ): Promise<void> {
    const plan = await this.getInternal(gardenPlanId);
    if (!plan || plan.household_id !== householdId) {
      throw new NotFoundError('Garden plan');
    }
    if (plan.status !== 'pending_upload') {
      throw new ForbiddenError(`Garden plan already uploaded. Current status: ${plan.status}`);
    }

    await this.householdService.getHousehold(householdId, userId);

    await this.env.REPORTS_BUCKET.put(plan.original_file_key, file, {
      httpMetadata: { contentType },
    });
  }

  async confirmUpload(
    householdId: string,
    gardenPlanId: string,
    userId: string,
    data: {
      plan_type?: GardenPlanType;
      label?: string;
    }
  ): Promise<any> {
    const plan = await this.getInternal(gardenPlanId);
    if (!plan || plan.household_id !== householdId) {
      throw new NotFoundError('Garden plan');
    }
    if (plan.status !== 'pending_upload' && plan.status !== 'uploaded') {
      throw new ForbiddenError(`Garden plan already processed. Current status: ${plan.status}`);
    }

    await this.householdService.getHousehold(householdId, userId);

    const object = await this.env.REPORTS_BUCKET.head(plan.original_file_key);
    if (!object) {
      throw new NotFoundError('File not found in storage');
    }

    await this.db
      .update(gardenSchema.gardenPlans)
      .set({
        status: 'completed',
        display_image_key: plan.original_file_key,
        thumbnail_key: plan.original_file_key,
        plan_type: data.plan_type ?? plan.plan_type,
        label: data.label ?? plan.label,
        updated_at: now(),
      })
      .where(eq(gardenSchema.gardenPlans.id, gardenPlanId));

    return this.get(householdId, gardenPlanId, userId);
  }

  /**
   * Create a yard plan that was DRAWN on a map rather than uploaded.
   *
   * ## Why this is not `createUploadUrl` with a different content type
   *
   * The upload path exists to hand out a presigned R2 URL and then wait for the
   * bytes to land; `confirmUpload` refuses to complete a plan whose object is not
   * in the bucket (`REPORTS_BUCKET.head`). A map-drawn plan has no bytes at all —
   * the imagery is the device's own map tiles and the plan IS the geometry — so
   * there is nothing to presign, nothing to wait for and nothing to head. It goes
   * straight to `completed`.
   *
   * `original_file_key` is stored EMPTY rather than as a plausible-looking key
   * that resolves to nothing. Clients tell the two kinds apart by
   * `content_type === 'application/geo+json'` (`isMapDrawnPlan`), and a fake key
   * would send every image fetcher on a round trip to a 404 instead.
   *
   * ## The whole plan lands in one request
   *
   * The boundary and the objects arrive together and are written together, so a
   * concurrent reader never sees a lot with no areas in it. This mirrors
   * `localGardenPlansApi.createMapPlan`, which writes the same rows in a single
   * ledger op for the same reason — and which is the path that actually runs for
   * a local-first household, this one being here so the two agree.
   */
  async createMapPlan(
    householdId: string,
    userId: string,
    data: {
      plan_type: GardenPlanType;
      label?: string | null;
      boundary_geojson: unknown;
      boundary_source?: 'user_adjusted' | 'user_drawn';
      geocode_place_name?: string | null;
      objects?: GardenPlanVectorObject[];
    }
  ): Promise<any> {
    await this.householdService.getHousehold(householdId, userId);

    const timestamp = now();
    const gardenPlanId = generateId();
    const label = data.label?.trim() ? data.label.trim() : null;

    await this.db.insert(gardenSchema.gardenPlans).values({
      id: gardenPlanId,
      household_id: householdId,
      plan_type: data.plan_type,
      original_file_key: '',
      display_image_key: null,
      thumbnail_key: null,
      filename: `${label ?? 'yard-plan'}.geojson`,
      file_size: 0,
      content_type: 'application/geo+json',
      label,
      status: 'completed',
      boundary_source: data.boundary_source ?? 'user_drawn',
      boundary_geojson: JSON.stringify(data.boundary_geojson),
      geocode_place_name: data.geocode_place_name ?? null,
      created_by: userId,
      created_at: timestamp,
      updated_at: timestamp,
    });

    const normalizedObjects = normalizeVectorObjects(data.objects ?? []);
    if (normalizedObjects.length > 0) {
      await this.db.insert(gardenSchema.gardenPlanObjects).values(
        normalizedObjects.map((object, index) => ({
          id: generateId(),
          garden_plan_id: gardenPlanId,
          type: object.type,
          x: object.x,
          y: object.y,
          width: object.width,
          height: object.height,
          rotation: object.rotation,
          label: object.label ?? null,
          color: object.color ?? null,
          metadata_json: object.metadata ? JSON.stringify(object.metadata) : null,
          sort_order: index,
          created_by: userId,
          created_at: timestamp,
          updated_at: timestamp,
        }))
      );
    }

    return this.get(householdId, gardenPlanId, userId);
  }

  async list(
    householdId: string,
    userId: string,
    filters?: { limit?: number; cursor?: string }
  ): Promise<{ garden_plans: any[]; next_cursor?: string }> {
    await this.householdService.getHousehold(householdId, userId);

    const limit = Math.min(filters?.limit || 50, 100);

    const rows = await this.db
      .select()
      .from(gardenSchema.gardenPlans)
      .where(
        and(
          eq(gardenSchema.gardenPlans.household_id, householdId),
          isNull(gardenSchema.gardenPlans.deleted_at)
        )
      )
      .orderBy(desc(gardenSchema.gardenPlans.created_at))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      garden_plans: items,
      next_cursor: hasMore ? items[items.length - 1].id : undefined,
    };
  }

  async get(householdId: string, gardenPlanId: string, userId: string): Promise<any> {
    const plan = await this.getInternal(gardenPlanId);
    if (!plan || plan.household_id !== householdId || plan.deleted_at) {
      throw new NotFoundError('Garden plan');
    }
    await this.householdService.getHousehold(householdId, userId);
    return { garden_plan: plan };
  }

  async update(
    householdId: string,
    gardenPlanId: string,
    userId: string,
    data: { plan_type?: GardenPlanType; label?: string }
  ): Promise<any> {
    const plan = await this.getInternal(gardenPlanId);
    if (!plan || plan.household_id !== householdId) {
      throw new NotFoundError('Garden plan');
    }
    await this.householdService.getHousehold(householdId, userId);

    await this.db
      .update(gardenSchema.gardenPlans)
      .set({ ...data, updated_at: now() })
      .where(eq(gardenSchema.gardenPlans.id, gardenPlanId));

    return this.get(householdId, gardenPlanId, userId);
  }

  async updateBoundary(
    householdId: string,
    gardenPlanId: string,
    userId: string,
    data: {
      boundary_geojson: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
      boundary_source: GardenPlanBoundarySource;
    }
  ): Promise<any> {
    const plan = await this.getInternal(gardenPlanId);
    if (!plan || plan.household_id !== householdId || plan.deleted_at) {
      throw new NotFoundError('Garden plan');
    }
    await this.householdService.getHousehold(householdId, userId);

    await this.db
      .update(gardenSchema.gardenPlans)
      .set({
        boundary_geojson: JSON.stringify(data.boundary_geojson),
        boundary_source: data.boundary_source,
        updated_at: now(),
      })
      .where(eq(gardenSchema.gardenPlans.id, gardenPlanId));

    return this.get(householdId, gardenPlanId, userId);
  }

  async delete(householdId: string, gardenPlanId: string, userId: string): Promise<void> {
    const plan = await this.getInternal(gardenPlanId);
    if (!plan || plan.household_id !== householdId) {
      throw new NotFoundError('Garden plan');
    }
    await this.householdService.getHousehold(householdId, userId);

    await this.db
      .update(gardenSchema.gardenPlans)
      .set({ deleted_at: now(), updated_at: now() })
      .where(eq(gardenSchema.gardenPlans.id, gardenPlanId));
  }

  // ============ VECTOR OBJECTS ============

  async listObjects(
    householdId: string,
    gardenPlanId: string,
    userId: string
  ): Promise<{ objects: GardenPlanVectorObject[] }> {
    const plan = await this.getInternal(gardenPlanId);
    if (!plan || plan.household_id !== householdId || plan.deleted_at) {
      throw new NotFoundError('Garden plan');
    }
    await this.householdService.getHousehold(householdId, userId);

    const rows = await this.db
      .select()
      .from(gardenSchema.gardenPlanObjects)
      .where(
        and(
          eq(gardenSchema.gardenPlanObjects.garden_plan_id, gardenPlanId),
          isNull(gardenSchema.gardenPlanObjects.deleted_at)
        )
      )
      .orderBy(gardenSchema.gardenPlanObjects.sort_order);

    return {
      objects: rows.map(row => ({
        id: row.id,
        type: row.type as GardenPlanVectorObject['type'],
        x: row.x,
        y: row.y,
        width: row.width,
        height: row.height,
        rotation: row.rotation,
        label: row.label,
        color: row.color,
        metadata: parseMetadata(row.metadata_json),
      })),
    };
  }

  async replaceObjects(
    householdId: string,
    gardenPlanId: string,
    userId: string,
    objects: GardenPlanVectorObject[]
  ): Promise<{ objects: GardenPlanVectorObject[] }> {
    const plan = await this.getInternal(gardenPlanId);
    if (!plan || plan.household_id !== householdId || plan.deleted_at) {
      throw new NotFoundError('Garden plan');
    }
    await this.householdService.getHousehold(householdId, userId);

    const timestamp = now();
    const normalizedObjects = normalizeVectorObjects(objects);
    await this.db
      .update(gardenSchema.gardenPlanObjects)
      .set({ deleted_at: timestamp, updated_at: timestamp })
      .where(
        and(
          eq(gardenSchema.gardenPlanObjects.garden_plan_id, gardenPlanId),
          isNull(gardenSchema.gardenPlanObjects.deleted_at)
        )
      );

    if (normalizedObjects.length > 0) {
      await this.db.insert(gardenSchema.gardenPlanObjects).values(
        normalizedObjects.map((object, index) => ({
          id: generateId(),
          garden_plan_id: gardenPlanId,
          type: object.type,
          x: object.x,
          y: object.y,
          width: object.width,
          height: object.height,
          rotation: object.rotation,
          label: object.label ?? null,
          color: object.color ?? null,
          metadata_json: object.metadata ? JSON.stringify(object.metadata) : null,
          sort_order: index,
          created_by: userId,
          created_at: timestamp,
          updated_at: timestamp,
        }))
      );
    }

    return this.listObjects(householdId, gardenPlanId, userId);
  }

  // ============ MARKERS ============

  async listMarkers(
    householdId: string,
    gardenPlanId: string,
    userId: string
  ): Promise<{ markers: any[] }> {
    const plan = await this.getInternal(gardenPlanId);
    if (!plan || plan.household_id !== householdId) {
      throw new NotFoundError('Garden plan');
    }
    await this.householdService.getHousehold(householdId, userId);

    const markers = await this.db
      .select()
      .from(gardenSchema.gardenPlanMarkers)
      .where(
        and(
          eq(gardenSchema.gardenPlanMarkers.garden_plan_id, gardenPlanId),
          isNull(gardenSchema.gardenPlanMarkers.deleted_at)
        )
      )
      .orderBy(desc(gardenSchema.gardenPlanMarkers.created_at));

    return { markers };
  }

  async getMarkersForEntity(
    householdId: string,
    userId: string,
    entityType: LinkedEntityType,
    entityId: string
  ): Promise<{ markers: any[] }> {
    await this.householdService.getHousehold(householdId, userId);

    const markers = await this.db
      .select()
      .from(gardenSchema.gardenPlanMarkers)
      .where(
        and(
          eq(gardenSchema.gardenPlanMarkers.linked_entity_type, entityType),
          eq(gardenSchema.gardenPlanMarkers.linked_entity_id, entityId),
          isNull(gardenSchema.gardenPlanMarkers.deleted_at)
        )
      );

    return { markers };
  }

  async createMarker(
    householdId: string,
    gardenPlanId: string,
    userId: string,
    data: {
      x_percent: number;
      y_percent: number;
      linked_entity_type: LinkedEntityType;
      linked_entity_id: string;
      marker_color?: string;
      marker_icon?: string;
      label?: string;
      show_label?: boolean;
      space_id?: string;
    }
  ): Promise<any> {
    const plan = await this.getInternal(gardenPlanId);
    if (!plan || plan.household_id !== householdId) {
      throw new NotFoundError('Garden plan');
    }
    await this.householdService.getHousehold(householdId, userId);

    const markerId = generateId();
    const timestamp = now();

    await this.db.insert(gardenSchema.gardenPlanMarkers).values({
      id: markerId,
      garden_plan_id: gardenPlanId,
      x_percent: data.x_percent,
      y_percent: data.y_percent,
      linked_entity_type: data.linked_entity_type,
      linked_entity_id: data.linked_entity_id,
      marker_color: data.marker_color || '#4CAF50',
      marker_icon: data.marker_icon || '🌿',
      label: data.label,
      show_label: data.show_label ?? true,
      space_id: data.space_id,
      created_by: userId,
      created_at: timestamp,
      updated_at: timestamp,
    });

    const marker = await this.db
      .select()
      .from(gardenSchema.gardenPlanMarkers)
      .where(eq(gardenSchema.gardenPlanMarkers.id, markerId))
      .limit(1);

    return { marker: marker[0] };
  }

  async updateMarker(
    householdId: string,
    markerId: string,
    userId: string,
    data: {
      x_percent?: number;
      y_percent?: number;
      marker_color?: string;
      marker_icon?: string;
      label?: string;
      show_label?: boolean;
      space_id?: string;
    }
  ): Promise<any> {
    const marker = await this.db
      .select()
      .from(gardenSchema.gardenPlanMarkers)
      .where(eq(gardenSchema.gardenPlanMarkers.id, markerId))
      .limit(1);

    if (!marker[0]) {
      throw new NotFoundError('Marker');
    }

    const plan = await this.getInternal(marker[0].garden_plan_id);
    if (!plan || plan.household_id !== householdId) {
      throw new NotFoundError('Marker');
    }
    await this.householdService.getHousehold(householdId, userId);

    await this.db
      .update(gardenSchema.gardenPlanMarkers)
      .set({ ...data, updated_at: now() })
      .where(eq(gardenSchema.gardenPlanMarkers.id, markerId));

    const updated = await this.db
      .select()
      .from(gardenSchema.gardenPlanMarkers)
      .where(eq(gardenSchema.gardenPlanMarkers.id, markerId))
      .limit(1);

    return { marker: updated[0] };
  }

  async deleteMarker(householdId: string, markerId: string, userId: string): Promise<void> {
    const marker = await this.db
      .select()
      .from(gardenSchema.gardenPlanMarkers)
      .where(eq(gardenSchema.gardenPlanMarkers.id, markerId))
      .limit(1);

    if (!marker[0]) {
      throw new NotFoundError('Marker');
    }

    const plan = await this.getInternal(marker[0].garden_plan_id);
    if (!plan || plan.household_id !== householdId) {
      throw new NotFoundError('Marker');
    }
    await this.householdService.getHousehold(householdId, userId);

    await this.db
      .update(gardenSchema.gardenPlanMarkers)
      .set({ deleted_at: now(), updated_at: now() })
      .where(eq(gardenSchema.gardenPlanMarkers.id, markerId));
  }

  // ============ HELPERS ============

  private async getInternal(gardenPlanId: string): Promise<any> {
    const rows = await this.db
      .select()
      .from(gardenSchema.gardenPlans)
      .where(eq(gardenSchema.gardenPlans.id, gardenPlanId))
      .limit(1);
    return rows[0];
  }
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
