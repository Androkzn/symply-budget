import { eq, and, isNull, desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { convertLegacyToNewFormat, type FloorPlanAnalysisResult } from '../ai/prompts/analyze-floor-plan';
import * as schema from '../db/schema';
import * as floorPlanSchema from '../db/schema-floor-plans';
import type { Database, Env } from '../types';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import { generateId, now } from '../utils/id';

import { FloorPlanRegionPipeline } from './floor-plan-region-pipeline';
import { FloorPlanVectorizationService } from './floor-plan-vectorization-service';
import { HouseholdService } from './household-service';

export class FloorPlanService {
  private db: Database;
  private env: Env;
  private householdService: HouseholdService;
  private regionPipeline: FloorPlanRegionPipeline;
  private userId: string | null;

  constructor(env: Env, d1: D1Database, userId?: string | null) {
    this.db = drizzle(d1, { schema: { ...schema, ...floorPlanSchema } });
    this.env = env;
    // Acting user, so floor-plan AI runs on their BYOK key when connected.
    this.userId = userId ?? null;
    this.householdService = new HouseholdService(env, d1);
    this.regionPipeline = new FloorPlanRegionPipeline(
      env,
      this.db as any,
      (bytes) => this.arrayBufferToBase64(bytes),
      this.userId
    );
  }

  /**
   * Generate a pre-signed URL for uploading a floor plan to R2
   */
  async generateUploadUrl(
    householdId: string,
    userId: string,
    input: {
      filename: string;
      file_size: number;
      content_type: 'application/pdf' | 'image/jpeg' | 'image/png';
      building_name?: string;
      floor_number?: number;
      floor_label?: string;
    }
  ): Promise<{ floor_plan_id: string; upload_url: string; expires_at: string }> {
    // Verify user is a member of the household
    await this.householdService.getHousehold(householdId, userId);

    const floorPlanId = generateId();
    const fileKey = `floor-plans/${householdId}/${floorPlanId}/${input.filename}`;
    const timestamp = now();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Create floor plan record in pending state
    await this.db.insert(floorPlanSchema.floorPlans).values({
      id: floorPlanId,
      household_id: householdId,
      filename: input.filename,
      file_size: input.file_size,
      content_type: input.content_type,
      original_file_key: fileKey,
      building_name: input.building_name || 'Main Building',
      floor_number: input.floor_number,
      floor_label: input.floor_label,
      status: 'pending_upload',
      created_at: timestamp,
      updated_at: timestamp,
    });

    // Return upload endpoint (client uploads directly to our endpoint which stores in R2)
    const uploadUrl = `${this.env.API_URL}/households/${householdId}/floor-plans/${floorPlanId}/upload`;

    return {
      floor_plan_id: floorPlanId,
      upload_url: uploadUrl,
      expires_at: expiresAt.toISOString(),
    };
  }

  /**
   * Handle direct file upload
   */
  async uploadFile(
    householdId: string,
    floorPlanId: string,
    userId: string,
    file: ArrayBuffer,
    contentType: string
  ): Promise<void> {
    // Verify floor plan exists and belongs to household
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }

    if (floorPlan.status !== 'pending_upload') {
      throw new ForbiddenError(`Floor plan has already been uploaded. Current status: ${floorPlan.status}`);
    }

    // Verify user has access
    await this.householdService.getHousehold(householdId, userId);

    // Upload to R2
    try {
      console.log(`Uploading floor plan to R2: ${floorPlan.original_file_key} (${file.byteLength} bytes)`);
      await this.env.REPORTS_BUCKET.put(floorPlan.original_file_key, file, {
        httpMetadata: {
          contentType,
        },
      });
      console.log(`Successfully uploaded floor plan to R2: ${floorPlan.original_file_key}`);
    } catch (r2Error) {
      console.error(`R2 upload failed for ${floorPlan.original_file_key}:`, r2Error);
      throw new Error(`Failed to upload file to storage: ${r2Error instanceof Error ? r2Error.message : 'Unknown error'}`);
    }
  }

  /**
   * Confirm file upload and update status
   */
  async confirmUpload(
    householdId: string,
    floorPlanId: string,
    userId: string,
    data: {
      building_name: string;
      floor_number?: number;
      floor_label?: string;
    }
  ): Promise<any> {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);

    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }

    // Allow retry for pending_upload and uploaded (stuck) status
    if (floorPlan.status !== 'pending_upload' && floorPlan.status !== 'uploaded') {
      throw new ForbiddenError(`Floor plan has already been processed. Current status: ${floorPlan.status}`);
    }

    // Verify user has access
    await this.householdService.getHousehold(householdId, userId);

    // Verify file exists in R2
    const object = await this.env.REPORTS_BUCKET.head(floorPlan.original_file_key);
    if (!object) {
      throw new NotFoundError('File not found in storage');
    }

    // Update floor plan status and metadata
    await this.db
      .update(floorPlanSchema.floorPlans)
      .set({
        status: 'completed',
        display_image_key: floorPlan.original_file_key,
        thumbnail_key: floorPlan.original_file_key,
        building_name: data.building_name,
        floor_number: data.floor_number,
        floor_label: data.floor_label,
        updated_at: now(),
      })
      .where(eq(floorPlanSchema.floorPlans.id, floorPlanId));

    return this.getFloorPlan(householdId, floorPlanId, userId);
  }

  /**
   * Get processing status
   */
  async getProcessingStatus(
    householdId: string,
    floorPlanId: string,
    userId: string
  ): Promise<{
    status: string;
    processing_stage: string | null;
    error_message: string | null;
    ocr_status: string | null;
  }> {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }

    await this.householdService.getHousehold(householdId, userId);

    return {
      status: floorPlan.status,
      processing_stage: floorPlan.processing_stage,
      error_message: floorPlan.error_message,
      ocr_status: floorPlan.ocr_status,
    };
  }

  /**
   * List floor plans for a household
   */
  async listFloorPlans(
    householdId: string,
    userId: string,
    filters?: {
      building_name?: string;
      limit?: number;
      cursor?: string;
    }
  ): Promise<{ floor_plans: any[]; next_cursor?: string }> {
    await this.householdService.getHousehold(householdId, userId);

    const limit = Math.min(filters?.limit || 50, 100);

    const conditions = [
      eq(floorPlanSchema.floorPlans.household_id, householdId),
      isNull(floorPlanSchema.floorPlans.deleted_at),
    ];

    if (filters?.building_name) {
      conditions.push(eq(floorPlanSchema.floorPlans.building_name, filters.building_name));
    }

    const floorPlans = await this.db
      .select()
      .from(floorPlanSchema.floorPlans)
      .where(and(...conditions))
      .orderBy(desc(floorPlanSchema.floorPlans.created_at))
      .limit(limit + 1);

    const hasMore = floorPlans.length > limit;
    const items = hasMore ? floorPlans.slice(0, limit) : floorPlans;
    const nextCursor = hasMore ? items[items.length - 1].id : undefined;

    // Convert legacy format analysis data for each floor plan
    const convertedItems = items.map((fp: any) => {
      if (fp.ai_analysis_data) {
        try {
          const analysisData = JSON.parse(fp.ai_analysis_data);
          const isLegacyFormat = analysisData.floors?.some((f: any) => f.rooms && !f.spaces) || 
                                 (analysisData.features && analysisData.features.length > 0);
          
          if (isLegacyFormat) {
            const convertedAnalysis = convertLegacyToNewFormat(analysisData);
            return { ...fp, ai_analysis_data: JSON.stringify(convertedAnalysis) };
          }
        } catch (e) {
          // If parsing fails, return as-is
          console.error(`[FLOOR-PLAN-SERVICE] Failed to parse analysis data for ${fp.id}:`, e);
        }
      }
      return fp;
    });

    return {
      floor_plans: convertedItems,
      next_cursor: nextCursor,
    };
  }

  /**
   * Get a single floor plan
   */
  async getFloorPlan(householdId: string, floorPlanId: string, userId: string): Promise<any> {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }

    await this.householdService.getHousehold(householdId, userId);

    if (floorPlan.deleted_at) {
      throw new NotFoundError('Floor plan');
    }

    // Convert legacy format analysis data if present
    if (floorPlan.ai_analysis_data) {
      const analysisData = JSON.parse(floorPlan.ai_analysis_data);
      const isLegacyFormat = analysisData.floors?.some((f: any) => f.rooms && !f.spaces) || 
                             (analysisData.features && analysisData.features.length > 0);
      
      if (isLegacyFormat) {
        console.log(`[FLOOR-PLAN-SERVICE] Converting legacy format for floor plan ${floorPlanId}`);
        const convertedAnalysis = convertLegacyToNewFormat(analysisData);
        return { 
          floor_plan: { 
            ...floorPlan, 
            ai_analysis_data: JSON.stringify(convertedAnalysis) 
          } 
        };
      }
    }

    return { floor_plan: floorPlan };
  }

  /**
   * Update floor plan metadata
   */
  async updateFloorPlan(
    householdId: string,
    floorPlanId: string,
    userId: string,
    data: {
      building_name?: string;
      floor_number?: number;
      floor_label?: string;
      scale_pixels_per_foot?: number;
      scale_pixels_per_meter?: number;
      scale_unit?: 'feet' | 'meters' | 'inches';
    }
  ): Promise<any> {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }

    await this.householdService.getHousehold(householdId, userId);

    await this.db
      .update(floorPlanSchema.floorPlans)
      .set({
        ...data,
        updated_at: now(),
      })
      .where(eq(floorPlanSchema.floorPlans.id, floorPlanId));

    return this.getFloorPlan(householdId, floorPlanId, userId);
  }

  /**
   * Delete floor plan (soft delete)
   */
  async deleteFloorPlan(householdId: string, floorPlanId: string, userId: string): Promise<void> {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }

    await this.householdService.getHousehold(householdId, userId);

    await this.db
      .update(floorPlanSchema.floorPlans)
      .set({
        deleted_at: now(),
        updated_at: now(),
      })
      .where(eq(floorPlanSchema.floorPlans.id, floorPlanId));
  }

  /**
   * Calibrate scale
   */
  async calibrateScale(
    householdId: string,
    floorPlanId: string,
    userId: string,
    data: {
      pixel_distance: number;
      actual_distance: number;
      unit: 'feet' | 'meters' | 'inches';
    }
  ): Promise<any> {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }

    await this.householdService.getHousehold(householdId, userId);

    // Calculate pixels per unit
    const pixelsPerUnit = data.pixel_distance / data.actual_distance;

    const updateData: any = {
      scale_unit: data.unit,
      scale_calibration_method: 'manual',
      updated_at: now(),
    };

    if (data.unit === 'feet') {
      updateData.scale_pixels_per_foot = pixelsPerUnit;
    } else if (data.unit === 'meters') {
      updateData.scale_pixels_per_meter = pixelsPerUnit;
    }

    await this.db
      .update(floorPlanSchema.floorPlans)
      .set(updateData)
      .where(eq(floorPlanSchema.floorPlans.id, floorPlanId));

    return this.getFloorPlan(householdId, floorPlanId, userId);
  }

  // ============ MARKERS ============

  /**
   * List markers for a floor plan
   */
  async listMarkers(
    householdId: string,
    floorPlanId: string,
    userId: string
  ): Promise<{ markers: any[] }> {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }

    await this.householdService.getHousehold(householdId, userId);

    const markers = await this.db
      .select()
      .from(floorPlanSchema.floorPlanMarkers)
      .where(
        and(
          eq(floorPlanSchema.floorPlanMarkers.floor_plan_id, floorPlanId),
          isNull(floorPlanSchema.floorPlanMarkers.deleted_at)
        )
      )
      .orderBy(desc(floorPlanSchema.floorPlanMarkers.created_at));

    return { markers };
  }

  /**
   * Get markers for a specific entity
   */
  async getMarkersForEntity(
    householdId: string,
    userId: string,
    entityType: 'maintenance_task' | 'action_item',
    entityId: string
  ): Promise<{ markers: any[] }> {
    await this.householdService.getHousehold(householdId, userId);

    const markers = await this.db
      .select()
      .from(floorPlanSchema.floorPlanMarkers)
      .where(
        and(
          eq(floorPlanSchema.floorPlanMarkers.linked_entity_type, entityType),
          eq(floorPlanSchema.floorPlanMarkers.linked_entity_id, entityId),
          isNull(floorPlanSchema.floorPlanMarkers.deleted_at)
        )
      );

    return { markers };
  }

  /**
   * Create a marker
   */
  async createMarker(
    householdId: string,
    floorPlanId: string,
    userId: string,
    data: {
      x_percent: number;
      y_percent: number;
      linked_entity_type: 'maintenance_task' | 'action_item';
      linked_entity_id: string;
      marker_type?: 'pin' | 'circle' | 'square' | 'task';
      marker_color?: string;
      marker_icon?: string;
      label?: string;
      show_label?: boolean;
      space_id?: string;
    }
  ): Promise<any> {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }

    await this.householdService.getHousehold(householdId, userId);

    let spaceId = data.space_id;
    if (!spaceId) {
      spaceId = await this.resolveSpaceAtPoint(householdId, floorPlanId, data.x_percent, data.y_percent);
    }

    const markerId = generateId();
    const timestamp = now();

    await this.db.insert(floorPlanSchema.floorPlanMarkers).values({
      id: markerId,
      floor_plan_id: floorPlanId,
      x_percent: data.x_percent,
      y_percent: data.y_percent,
      linked_entity_type: data.linked_entity_type,
      linked_entity_id: data.linked_entity_id,
      marker_type: data.marker_type || 'pin',
      marker_color: data.marker_color || '#FF6B6B',
      marker_icon: data.marker_icon || '📍',
      label: data.label,
      show_label: data.show_label ?? true,
      space_id: spaceId,
      created_by: userId,
      created_at: timestamp,
      updated_at: timestamp,
    });

    if (
      spaceId &&
      data.linked_entity_type === 'maintenance_task'
    ) {
      const task = await this.db
        .select({ space_id: schema.tasks.space_id })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, data.linked_entity_id))
        .get();
      if (task && !task.space_id) {
        await this.db
          .update(schema.tasks)
          .set({ space_id: spaceId, updated_at: timestamp })
          .where(eq(schema.tasks.id, data.linked_entity_id))
          .run();
      }
    }

    const marker = await this.db
      .select()
      .from(floorPlanSchema.floorPlanMarkers)
      .where(eq(floorPlanSchema.floorPlanMarkers.id, markerId))
      .limit(1);

    return { marker: marker[0] };
  }

  /**
   * Update a marker
   */
  async updateMarker(
    householdId: string,
    markerId: string,
    userId: string,
    data: {
      x_percent?: number;
      y_percent?: number;
      marker_type?: 'pin' | 'circle' | 'square';
      marker_color?: string;
      marker_icon?: string;
      label?: string;
      show_label?: boolean;
      space_id?: string;
    }
  ): Promise<any> {
    const marker = await this.db
      .select()
      .from(floorPlanSchema.floorPlanMarkers)
      .where(eq(floorPlanSchema.floorPlanMarkers.id, markerId))
      .limit(1);

    if (!marker[0]) {
      throw new NotFoundError('Marker');
    }

    // Verify household access through floor plan
    const floorPlan = await this.getFloorPlanInternal(marker[0].floor_plan_id);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Marker');
    }

    await this.householdService.getHousehold(householdId, userId);

    await this.db
      .update(floorPlanSchema.floorPlanMarkers)
      .set({
        ...data,
        updated_at: now(),
      })
      .where(eq(floorPlanSchema.floorPlanMarkers.id, markerId));

    const updated = await this.db
      .select()
      .from(floorPlanSchema.floorPlanMarkers)
      .where(eq(floorPlanSchema.floorPlanMarkers.id, markerId))
      .limit(1);

    return { marker: updated[0] };
  }

  /**
   * Delete a marker (soft delete)
   */
  async deleteMarker(householdId: string, markerId: string, userId: string): Promise<void> {
    const marker = await this.db
      .select()
      .from(floorPlanSchema.floorPlanMarkers)
      .where(eq(floorPlanSchema.floorPlanMarkers.id, markerId))
      .limit(1);

    if (!marker[0]) {
      throw new NotFoundError('Marker');
    }

    // Verify household access
    const floorPlan = await this.getFloorPlanInternal(marker[0].floor_plan_id);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Marker');
    }

    await this.householdService.getHousehold(householdId, userId);

    await this.db
      .update(floorPlanSchema.floorPlanMarkers)
      .set({
        deleted_at: now(),
        updated_at: now(),
      })
      .where(eq(floorPlanSchema.floorPlanMarkers.id, markerId));
  }

  // ============ ANNOTATIONS ============

  /**
   * List annotations for a floor plan
   */
  async listAnnotations(
    householdId: string,
    floorPlanId: string,
    userId: string
  ): Promise<{ annotations: any[] }> {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }

    await this.householdService.getHousehold(householdId, userId);

    const annotations = await this.db
      .select()
      .from(floorPlanSchema.floorPlanAnnotations)
      .where(
        and(
          eq(floorPlanSchema.floorPlanAnnotations.floor_plan_id, floorPlanId),
          isNull(floorPlanSchema.floorPlanAnnotations.deleted_at)
        )
      )
      .orderBy(desc(floorPlanSchema.floorPlanAnnotations.created_at));

    return { annotations };
  }

  /**
   * Create an annotation
   */
  async createAnnotation(
    householdId: string,
    floorPlanId: string,
    userId: string,
    data: {
      annotation_type: 'line' | 'circle' | 'polygon' | 'text' | 'measurement';
      svg_data?: any;
      stroke_color?: string;
      stroke_width?: number;
      fill_color?: string;
      opacity?: number;
      text_content?: string;
      font_size?: number;
      measurement_value?: number;
      measurement_unit?: string;
    }
  ): Promise<any> {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }

    await this.householdService.getHousehold(householdId, userId);

    const annotationId = generateId();
    const timestamp = now();

    await this.db.insert(floorPlanSchema.floorPlanAnnotations).values({
      id: annotationId,
      floor_plan_id: floorPlanId,
      annotation_type: data.annotation_type,
      svg_data: JSON.stringify(data.svg_data),
      stroke_color: data.stroke_color || '#000000',
      stroke_width: data.stroke_width || 2,
      fill_color: data.fill_color,
      opacity: data.opacity || 1,
      text_content: data.text_content,
      font_size: data.font_size || 14,
      measurement_value: data.measurement_value,
      measurement_unit: data.measurement_unit,
      created_by: userId,
      created_at: timestamp,
      updated_at: timestamp,
    });

    const annotation = await this.db
      .select()
      .from(floorPlanSchema.floorPlanAnnotations)
      .where(eq(floorPlanSchema.floorPlanAnnotations.id, annotationId))
      .limit(1);

    return { annotation: annotation[0] };
  }

  /**
   * Delete an annotation (soft delete)
   */
  async deleteAnnotation(householdId: string, annotationId: string, userId: string): Promise<void> {
    const annotation = await this.db
      .select()
      .from(floorPlanSchema.floorPlanAnnotations)
      .where(eq(floorPlanSchema.floorPlanAnnotations.id, annotationId))
      .limit(1);

    if (!annotation[0]) {
      throw new NotFoundError('Annotation');
    }

    // Verify household access
    const floorPlan = await this.getFloorPlanInternal(annotation[0].floor_plan_id);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Annotation');
    }

    await this.householdService.getHousehold(householdId, userId);

    await this.db
      .update(floorPlanSchema.floorPlanAnnotations)
      .set({
        deleted_at: now(),
        updated_at: now(),
      })
      .where(eq(floorPlanSchema.floorPlanAnnotations.id, annotationId));
  }

  // ============ AI ANALYSIS (per-region hybrid pipeline) ============

  /**
   * Trigger per-region pipeline: layout detect → crop → spaces + semantic + trace.
   *
   * When `background` is provided (route waitUntil), the heavy pipeline runs
   * after the HTTP response so Workers don't hit the request wall-clock limit.
   */
  async analyzeFloorPlan(
    householdId: string,
    floorPlanId: string,
    userId: string,
    background?: (promise: Promise<unknown>) => void
  ): Promise<any> {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }

    await this.householdService.getHousehold(householdId, userId);

    if (floorPlan.ai_analysis_status === 'processing') {
      return {
        status: 'processing',
        message: 'Analysis already in progress',
      };
    }

    await this.db
      .update(floorPlanSchema.floorPlans)
      .set({
        ai_analysis_status: 'processing',
        processing_stage: 'layout_detect',
        error_message: null,
        updated_at: now(),
      })
      .where(eq(floorPlanSchema.floorPlans.id, floorPlanId));

    const run = async () => {
      try {
        return await this.regionPipeline.run(householdId, floorPlanId, floorPlan);
      } catch (error) {
        console.error('Floor plan analysis failed:', error);
        await this.db
          .update(floorPlanSchema.floorPlans)
          .set({
            ai_analysis_status: 'failed',
            error_message: error instanceof Error ? error.message : 'Analysis failed',
            processing_stage: 'failed',
            updated_at: now(),
          })
          .where(eq(floorPlanSchema.floorPlans.id, floorPlanId));
        throw error;
      }
    };

    if (background) {
      background(run().catch((err) => {
        console.error('[FLOOR-PLAN] Background analysis error:', err);
      }));
      return {
        status: 'processing',
        message: 'Per-region analysis started',
      };
    }

    return run();
  }

  async listRegions(householdId: string, floorPlanId: string, userId: string) {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }
    await this.householdService.getHousehold(householdId, userId);
    return this.regionPipeline.listRegions(floorPlanId);
  }

  async processPendingRegions(
    householdId: string,
    floorPlanId: string,
    userId: string
  ) {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }
    await this.householdService.getHousehold(householdId, userId);
    return this.regionPipeline.processNextPendingRegion({
      householdId,
      floorPlanId,
      floorPlan,
    });
  }

  async retryRegion(
    householdId: string,
    floorPlanId: string,
    regionId: string,
    userId: string
  ) {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }
    await this.householdService.getHousehold(householdId, userId);
    return this.regionPipeline.retryRegion({
      householdId,
      floorPlanId,
      regionId,
      floorPlan,
    });
  }

  /**
   * Get AI analysis results for a floor plan
   */
  async getAnalysis(householdId: string, floorPlanId: string, userId: string): Promise<any> {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }

    await this.householdService.getHousehold(householdId, userId);

    if (!floorPlan.ai_analysis_data) {
      return {
        status: floorPlan.ai_analysis_status || 'pending',
        analysis: null,
        message: floorPlan.ai_analysis_status === 'failed' 
          ? floorPlan.error_message 
          : 'No analysis available yet',
      };
    }

    // Parse the stored analysis data
    let analysis: FloorPlanAnalysisResult = JSON.parse(floorPlan.ai_analysis_data);
    
    // Check if this is legacy format (has 'rooms' instead of 'spaces', or has 'features')
    const isLegacyFormat = analysis.floors?.some((f: any) => f.rooms && !f.spaces) || 
                           ((analysis as any).features && (analysis as any).features.length > 0);
    
    if (isLegacyFormat) {
      console.log(`[FLOOR-PLAN-SERVICE] Converting legacy format for floor plan ${floorPlanId}`);
      analysis = convertLegacyToNewFormat(analysis as any);
    }

    return {
      status: 'completed',
      analysis,
      analyzed_at: floorPlan.ai_analyzed_at,
    };
  }

  /**
   * Replace user-editable area lists in the AI analysis (floors + detached areas).
   * Used by the area editor on the client to rename and resize bounding boxes.
   *
   * Each entry in floors/detached_areas updates the matching index by name+bbox;
   * we always replace the full list so additions and reorders are atomic.
   * Other fields on FloorInfo/DetachedAreaInfo (level, area, spaces, type) are
   * preserved when the entry already existed at the same index.
   */
  async updateAnalysisAreas(
    householdId: string,
    floorPlanId: string,
    userId: string,
    data: {
      floors?: { name: string; bounding_box: { x1: number; y1: number; x2: number; y2: number } }[];
      detached_areas?: {
        name: string;
        type?: string;
        bounding_box: { x1: number; y1: number; x2: number; y2: number };
      }[];
    }
  ): Promise<any> {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }

    await this.householdService.getHousehold(householdId, userId);

    const existing: FloorPlanAnalysisResult = floorPlan.ai_analysis_data
      ? JSON.parse(floorPlan.ai_analysis_data)
      : {
          property_address: null,
          total_area: { value: null, unit: null },
          floors: [],
          detached_areas: [],
          excluded_from_living_area: { total: { value: null, unit: null }, items: [] },
          metadata: {
            scale_bar_detected: false,
            dimensions_labeled: false,
            space_labels_present: false,
            multiple_floors: false,
            floor_count: 0,
            detached_area_count: 0,
            total_space_count: 0,
            has_outdoor_spaces: false,
            has_garage: false,
            garage_type: 'none',
            confidence: 'low',
          },
        };

    const next: FloorPlanAnalysisResult = { ...existing };

    if (data.floors) {
      next.floors = data.floors.map((incoming, idx) => {
        const prev = existing.floors?.[idx];
        return {
          name: incoming.name,
          level: prev?.level ?? idx,
          area: prev?.area ?? { value: null, unit: null },
          bounding_box: incoming.bounding_box,
          spaces: prev?.spaces ?? [],
        };
      });
    }

    if (data.detached_areas) {
      next.detached_areas = data.detached_areas.map((incoming, idx) => {
        const prev = existing.detached_areas?.[idx];
        return {
          name: incoming.name,
          type: incoming.type ?? prev?.type ?? 'other',
          area: prev?.area ?? { value: null, unit: null },
          bounding_box: incoming.bounding_box,
          spaces: prev?.spaces ?? [],
        };
      });
    }

    next.metadata = {
      ...next.metadata,
      floor_count: next.floors?.length ?? 0,
      detached_area_count: next.detached_areas?.length ?? 0,
      multiple_floors: (next.floors?.length ?? 0) > 1,
    };

    await this.db
      .update(floorPlanSchema.floorPlans)
      .set({
        ai_analysis_data: JSON.stringify(next),
        ai_floor_count: next.metadata.floor_count,
        ai_analysis_status: 'completed',
        updated_at: now(),
      })
      .where(eq(floorPlanSchema.floorPlans.id, floorPlanId));

    // Invalidate / reprocess regions whose bounding boxes changed
    await this.regionPipeline.syncRegionsAfterAreaEdit(
      householdId,
      floorPlanId,
      floorPlan,
      next
    );

    return {
      status: 'completed',
      analysis: next,
      analyzed_at: floorPlan.ai_analyzed_at ?? now(),
    };
  }

  // ============ VECTORIZATION ============

  /**
   * Generate the semantic SVG layer for the floor plan.
   *
   * Pulls the original raster from R2, asks Claude Vision to redraw it as a
   * semantic SVG (each room/wall/door/window has a stable id and data-kind),
   * stores the result in R2 and persists the key on `floor_plans`.
   *
   * The literal pixel-perfect trace layer is produced separately by the
   * Cloudflare Container worker (PR 4) and lives at `vector_trace_key`.
   */
  async vectorizeFloorPlan(
    householdId: string,
    floorPlanId: string,
    userId: string
  ): Promise<{
    status: 'completed' | 'processing';
    vector_semantic_key?: string | null;
    vector_trace_key?: string | null;
    vectorized_at?: string | null;
  }> {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }

    await this.householdService.getHousehold(householdId, userId);

    if (floorPlan.vectorization_status === 'processing') {
      return { status: 'processing' };
    }

    await this.db
      .update(floorPlanSchema.floorPlans)
      .set({
        vectorization_status: 'processing',
        vectorization_error: null,
        updated_at: now(),
      })
      .where(eq(floorPlanSchema.floorPlans.id, floorPlanId));

    try {
      const fileObject = await this.env.REPORTS_BUCKET.get(floorPlan.original_file_key);
      if (!fileObject) {
        throw new NotFoundError('Floor plan file not found in storage');
      }

      const arrayBuffer = await fileObject.arrayBuffer();
      const base64 = this.arrayBufferToBase64(new Uint8Array(arrayBuffer));
      const mediaType = floorPlan.content_type as 'image/jpeg' | 'image/png' | 'application/pdf';

      const vectorizer = new FloorPlanVectorizationService(this.env, this.userId);
      const result = await vectorizer.generateSemanticSvg({ imageBase64: base64, mediaType });

      const semanticKey = `floor-plans/${householdId}/${floorPlanId}/vector-semantic.svg`;
      await this.env.REPORTS_BUCKET.put(semanticKey, result.svg, {
        httpMetadata: { contentType: 'image/svg+xml' },
      });

      const vectorizedAt = now();
      await this.db
        .update(floorPlanSchema.floorPlans)
        .set({
          vector_semantic_key: semanticKey,
          vectorization_status: 'completed',
          vectorization_error: null,
          vectorized_at: vectorizedAt,
          updated_at: vectorizedAt,
        })
        .where(eq(floorPlanSchema.floorPlans.id, floorPlanId));

      return {
        status: 'completed',
        vector_semantic_key: semanticKey,
        vector_trace_key: floorPlan.vector_trace_key,
        vectorized_at: vectorizedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Vectorization failed';
      console.error(`[FLOOR-PLAN-SERVICE] Vectorization failed for ${floorPlanId}:`, error);

      await this.db
        .update(floorPlanSchema.floorPlans)
        .set({
          vectorization_status: 'failed',
          vectorization_error: message,
          updated_at: now(),
        })
        .where(eq(floorPlanSchema.floorPlans.id, floorPlanId));

      throw error;
    }
  }

  /**
   * Return the keys + relative URLs for the vectorized layers.
   * Layers may be null if the corresponding pipeline hasn't run yet.
   */
  async getVectorAssets(
    householdId: string,
    floorPlanId: string,
    userId: string
  ): Promise<{
    status: string;
    vector_semantic_key: string | null;
    vector_semantic_url: string | null;
    vector_trace_key: string | null;
    vector_trace_url: string | null;
    vectorized_at: string | null;
    error: string | null;
  }> {
    const floorPlan = await this.getFloorPlanInternal(floorPlanId);
    if (!floorPlan || floorPlan.household_id !== householdId) {
      throw new NotFoundError('Floor plan');
    }
    await this.householdService.getHousehold(householdId, userId);

    const fileUrl = (key: string | null) => (key ? `/files/${key}` : null);

    return {
      status: floorPlan.vectorization_status || 'pending',
      vector_semantic_key: floorPlan.vector_semantic_key,
      vector_semantic_url: fileUrl(floorPlan.vector_semantic_key),
      vector_trace_key: floorPlan.vector_trace_key,
      vector_trace_url: fileUrl(floorPlan.vector_trace_key),
      vectorized_at: floorPlan.vectorized_at,
      error: floorPlan.vectorization_error,
    };
  }

  // ============ INTERNAL METHODS ============

  private async getFloorPlanInternal(floorPlanId: string): Promise<any> {
    const result = await this.db
      .select()
      .from(floorPlanSchema.floorPlans)
      .where(eq(floorPlanSchema.floorPlans.id, floorPlanId))
      .limit(1);
    return result[0];
  }

  /** Hit-test a marker position against household space bounding boxes. */
  private async resolveSpaceAtPoint(
    householdId: string,
    floorPlanId: string,
    xPercent: number,
    yPercent: number
  ): Promise<string | undefined> {
    const spaces = await this.db
      .select()
      .from(schema.householdSpaces)
      .where(
        and(
          eq(schema.householdSpaces.household_id, householdId),
          eq(schema.householdSpaces.floor_plan_id, floorPlanId),
          isNull(schema.householdSpaces.deleted_at)
        )
      )
      .all();

    for (const space of spaces) {
      if (
        space.plan_x_percent == null ||
        space.plan_y_percent == null ||
        space.plan_width_percent == null ||
        space.plan_height_percent == null
      ) {
        continue;
      }
      const x1 = space.plan_x_percent;
      const y1 = space.plan_y_percent;
      const x2 = x1 + space.plan_width_percent;
      const y2 = y1 + space.plan_height_percent;
      if (xPercent >= x1 && xPercent <= x2 && yPercent >= y1 && yPercent <= y2) {
        return space.id;
      }
    }
    return undefined;
  }

  /**
   * Convert Uint8Array to base64 string safely (handles large files)
   */
  private arrayBufferToBase64(bytes: Uint8Array): string {
    const CHUNK_SIZE = 0x8000; // 32KB chunks
    let result = '';
    
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      const chunk = bytes.subarray(i, i + CHUNK_SIZE);
      result += String.fromCharCode.apply(null, chunk as any);
    }
    
    return btoa(result);
  }
}
