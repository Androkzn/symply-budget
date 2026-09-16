/**
 * Per-region hybrid floor plan extraction pipeline.
 * Pass 1: layout detect → region rows
 * Pass 2: crop → spaces → semantic SVG → visual trace
 */

import { eq, and } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

import type {
  FloorPlanAnalysisResult,
  SpaceInfo,
  BoundingBox,
} from '../ai/prompts/analyze-floor-plan';
import * as floorPlanSchema from '../db/schema-floor-plans';
import type { Env } from '../types';
import { NotFoundError } from '../utils/errors';
import {
  cropImageByBoundingBox,
  isRasterContentType,
  type BoundingBox as CropBox,
} from '../utils/floor-plan-crop';
import { generateId, now } from '../utils/id';

import { FloorPlanAnalysisService } from './floor-plan-analysis-service';
import { FloorPlanVectorizationService } from './floor-plan-vectorization-service';


type Db = DrizzleD1Database<any>;

export class FloorPlanRegionPipeline {
  constructor(
    private env: Env,
    private db: Db,
    private arrayBufferToBase64: (bytes: Uint8Array) => string,
    // Acting user, so the AI analysis/vectorization run on their BYOK key.
    private userId: string | null = null
  ) {}

  async run(householdId: string, floorPlanId: string, floorPlan: any): Promise<any> {
    const analysisService = new FloorPlanAnalysisService(this.env, this.userId);
    const vectorizer = new FloorPlanVectorizationService(this.env, this.userId);

    const fileObject = await this.env.REPORTS_BUCKET.get(floorPlan.original_file_key);
    if (!fileObject) {
      throw new NotFoundError('Floor plan file not found in storage');
    }
    const originalBytes = new Uint8Array(await fileObject.arrayBuffer());
    const mediaType = floorPlan.content_type as 'image/jpeg' | 'image/png' | 'application/pdf';

    let rasterBytes: Uint8Array | null = null;
    let rasterContentType: 'image/png' | 'image/jpeg' | null = null;

    if (isRasterContentType(mediaType)) {
      rasterBytes = originalBytes;
      rasterContentType = mediaType === 'image/png' ? 'image/png' : 'image/jpeg';
    } else if (floorPlan.display_image_key) {
      const displayObj = await this.env.REPORTS_BUCKET.get(floorPlan.display_image_key);
      if (displayObj) {
        rasterBytes = new Uint8Array(await displayObj.arrayBuffer());
        rasterContentType = 'image/png';
      }
    }

    if (!rasterBytes && mediaType === 'application/pdf' && vectorizer.isTraceConfigured()) {
      try {
        const rasterized = await vectorizer.rasterizeToPng({
          imageBase64: this.arrayBufferToBase64(originalBytes),
          contentType: mediaType,
        });
        if (rasterized) {
          rasterBytes = rasterized.pngBytes;
          rasterContentType = 'image/png';
          const displayKey = `floor-plans/${householdId}/${floorPlanId}/display.png`;
          await this.env.REPORTS_BUCKET.put(displayKey, rasterBytes, {
            httpMetadata: { contentType: 'image/png' },
          });
          await this.db
            .update(floorPlanSchema.floorPlans)
            .set({ display_image_key: displayKey, updated_at: now() })
            .where(eq(floorPlanSchema.floorPlans.id, floorPlanId));
        }
      } catch (err) {
        console.warn('[FLOOR-PLAN] PDF rasterize failed, continuing with PDF for layout:', err);
      }
    }

    await this.db
      .update(floorPlanSchema.floorPlans)
      .set({ processing_stage: 'layout_detect', updated_at: now() })
      .where(eq(floorPlanSchema.floorPlans.id, floorPlanId));

    const layoutSourceBytes = rasterBytes ?? originalBytes;
    const layoutMediaType = (rasterBytes
      ? rasterContentType!
      : mediaType) as 'image/jpeg' | 'image/png' | 'application/pdf';
    const layout = await analysisService.detectLayout({
      imageBase64: this.arrayBufferToBase64(layoutSourceBytes),
      mediaType: layoutMediaType,
    });

    await this.db
      .delete(floorPlanSchema.floorPlanRegions)
      .where(eq(floorPlanSchema.floorPlanRegions.floor_plan_id, floorPlanId));

    const regionSpecs: Array<{
      id: string;
      kind: 'floor' | 'detached';
      name: string;
      level: number | null;
      detached_type: string | null;
      sort_order: number;
      bounding_box: BoundingBox;
      area: { value: number | null; unit: 'sq_ft' | 'sq_m' | null };
    }> = [];

    let sortOrder = 0;
    for (const floor of layout.floors) {
      if (!floor.bounding_box) continue;
      regionSpecs.push({
        id: generateId(),
        kind: 'floor',
        name: floor.name,
        level: floor.level,
        detached_type: null,
        sort_order: sortOrder++,
        bounding_box: floor.bounding_box,
        area: floor.area,
      });
    }
    for (const area of layout.detached_areas) {
      if (!area.bounding_box) continue;
      regionSpecs.push({
        id: generateId(),
        kind: 'detached',
        name: area.name,
        level: null,
        detached_type: area.type,
        sort_order: sortOrder++,
        bounding_box: area.bounding_box,
        area: area.area,
      });
    }

    if (regionSpecs.length === 0) {
      regionSpecs.push({
        id: generateId(),
        kind: 'floor',
        name: layout.floors[0]?.name || 'Main Floor',
        level: layout.floors[0]?.level ?? 0,
        detached_type: null,
        sort_order: 0,
        bounding_box: { x1: 0, y1: 0, x2: 1, y2: 1 },
        area: layout.floors[0]?.area ?? { value: null, unit: null },
      });
    }

    const timestamp = now();
    for (const spec of regionSpecs) {
      await this.db.insert(floorPlanSchema.floorPlanRegions).values({
        id: spec.id,
        floor_plan_id: floorPlanId,
        kind: spec.kind,
        name: spec.name,
        level: spec.level,
        detached_type: spec.detached_type,
        sort_order: spec.sort_order,
        bounding_box: JSON.stringify(spec.bounding_box),
        status: 'pending',
        trace_status: 'pending',
        created_at: timestamp,
        updated_at: timestamp,
      });
    }

    await this.db
      .update(floorPlanSchema.floorPlans)
      .set({
        processing_stage: 'region_extract',
        ai_property_address: layout.property_address,
        ai_total_area_sqft: layout.total_area.unit === 'sq_ft' ? layout.total_area.value : null,
        ai_floor_count: layout.metadata.floor_count,
        // Skeleton analysis so My Home can show zone cards while Pass 2 runs
        ai_analysis_data: JSON.stringify({
          property_address: layout.property_address,
          total_area: layout.total_area,
          floors: regionSpecs
            .filter((s) => s.kind === 'floor')
            .map((s) => ({
              name: s.name,
              level: s.level ?? 0,
              area: s.area,
              bounding_box: s.bounding_box,
              spaces: [],
            })),
          detached_areas: regionSpecs
            .filter((s) => s.kind === 'detached')
            .map((s) => ({
              name: s.name,
              type: s.detached_type || 'other',
              area: s.area,
              bounding_box: s.bounding_box,
              spaces: [],
            })),
          excluded_from_living_area: layout.excluded_from_living_area,
          metadata: {
            scale_bar_detected: false,
            dimensions_labeled: false,
            space_labels_present: false,
            multiple_floors: layout.metadata.multiple_floors,
            floor_count: layout.metadata.floor_count,
            detached_area_count: layout.metadata.detached_area_count,
            total_space_count: 0,
            has_outdoor_spaces: false,
            has_garage: false,
            garage_type: 'none',
            confidence: layout.metadata.confidence,
            layout_type: layout.metadata.layout_type,
          },
        } satisfies FloorPlanAnalysisResult),
        updated_at: now(),
      })
      .where(eq(floorPlanSchema.floorPlans.id, floorPlanId));

    // Pass 2 runs one region per HTTP request (processNextPendingRegion) so
    // Workers don't get killed mid-Claude-call by waitUntil CPU/wall limits.
    return {
      status: 'processing',
      message: 'Layout detected; process regions via POST .../regions/process-pending',
      region_count: regionSpecs.length,
      regions: regionSpecs.map((s) => ({
        id: s.id,
        kind: s.kind,
        name: s.name,
        status: 'pending',
      })),
    };
  }

  /**
   * Process the next pending (or stuck) region for a floor plan.
   * Call repeatedly until remaining === 0.
   */
  async processNextPendingRegion(params: {
    householdId: string;
    floorPlanId: string;
    floorPlan: any;
  }): Promise<{
    status: 'processing' | 'completed';
    processed: ReturnType<typeof formatRegion> | null;
    remaining: number;
    regions: ReturnType<typeof formatRegion>[];
  }> {
    const { householdId, floorPlanId, floorPlan } = params;

    // Reset regions stuck in processing for > 2 minutes
    const allRegions = await this.db
      .select()
      .from(floorPlanSchema.floorPlanRegions)
      .where(eq(floorPlanSchema.floorPlanRegions.floor_plan_id, floorPlanId));

    const twoMinAgo = Date.now() - 2 * 60 * 1000;
    for (const r of allRegions) {
      if (r.status === 'processing') {
        const updated = Date.parse(r.updated_at || r.created_at || '');
        if (!Number.isFinite(updated) || updated < twoMinAgo) {
          await this.db
            .update(floorPlanSchema.floorPlanRegions)
            .set({
              status: 'pending',
              error_message: 'Reset after stuck processing',
              updated_at: now(),
            })
            .where(eq(floorPlanSchema.floorPlanRegions.id, r.id));
        }
      }
    }

    const refreshed = await this.db
      .select()
      .from(floorPlanSchema.floorPlanRegions)
      .where(eq(floorPlanSchema.floorPlanRegions.floor_plan_id, floorPlanId));

    const next = [...refreshed]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .find((r) => r.status === 'pending');

    if (!next) {
      const remainingWork = refreshed.some(
        (r) => r.status === 'pending' || r.status === 'processing'
      );

      // Layout Pass 1 may still be running in waitUntil — do not mark completed
      // just because region rows are not inserted yet.
      if (!remainingWork && refreshed.length === 0) {
        const [fresh] = await this.db
          .select()
          .from(floorPlanSchema.floorPlans)
          .where(eq(floorPlanSchema.floorPlans.id, floorPlanId))
          .limit(1);
        const stage = fresh?.processing_stage;
        const analysisStatus = fresh?.ai_analysis_status;
        if (analysisStatus === 'failed') {
          const listed = await this.listRegions(floorPlanId);
          return {
            status: 'processing',
            processed: null,
            remaining: 0,
            regions: listed.regions,
          };
        }
        if (
          analysisStatus === 'processing' &&
          (stage === 'layout_detect' || stage === 'pending' || !fresh?.ai_analysis_data)
        ) {
          const listed = await this.listRegions(floorPlanId);
          return {
            status: 'processing',
            processed: null,
            remaining: -1, // layout not ready
            regions: listed.regions,
          };
        }
      }

      if (!remainingWork && refreshed.length > 0) {
        await this.rebuildAnalysisFromRegions(floorPlanId, floorPlan);
        await this.db
          .update(floorPlanSchema.floorPlans)
          .set({
            ai_analysis_status: 'completed',
            processing_stage: 'completed',
            ai_analyzed_at: now(),
            vectorization_status: refreshed.some((r) => r.vector_semantic_key)
              ? 'completed'
              : 'pending',
            updated_at: now(),
          })
          .where(eq(floorPlanSchema.floorPlans.id, floorPlanId));
      }

      const listed = await this.listRegions(floorPlanId);
      const stillWaiting =
        refreshed.length === 0 &&
        (floorPlan.ai_analysis_status === 'processing' || listed.regions.length === 0);
      return {
        status: remainingWork || stillWaiting ? 'processing' : 'completed',
        processed: null,
        remaining: remainingWork
          ? refreshed.filter((r) => r.status === 'pending' || r.status === 'processing').length
          : refreshed.length === 0
            ? -1
            : 0,
        regions: listed.regions,
      };
    }

    const analysisService = new FloorPlanAnalysisService(this.env, this.userId);
    const vectorizer = new FloorPlanVectorizationService(this.env, this.userId);
    const { rasterBytes, rasterContentType } = await this.loadRaster(floorPlan);
    const bbox = JSON.parse(next.bounding_box) as BoundingBox;

    await this.processRegion({
      householdId,
      floorPlanId,
      regionId: next.id,
      kind: next.kind as 'floor' | 'detached',
      name: next.name,
      boundingBox: bbox,
      rasterBytes,
      rasterContentType,
      vectorizer,
      analysisService,
    });

    await this.rebuildAnalysisFromRegions(floorPlanId, floorPlan);

    const after = await this.db
      .select()
      .from(floorPlanSchema.floorPlanRegions)
      .where(eq(floorPlanSchema.floorPlanRegions.floor_plan_id, floorPlanId));

    const remaining = after.filter(
      (r) => r.status === 'pending' || r.status === 'processing'
    ).length;

    if (remaining === 0) {
      await this.db
        .update(floorPlanSchema.floorPlans)
        .set({
          ai_analysis_status: 'completed',
          processing_stage: 'completed',
          ai_analyzed_at: now(),
          vectorization_status: after.some((r) => r.vector_semantic_key) ? 'completed' : 'pending',
          updated_at: now(),
        })
        .where(eq(floorPlanSchema.floorPlans.id, floorPlanId));
    }

    const processedRow = after.find((r) => r.id === next.id);
    const listed = await this.listRegions(floorPlanId);

    return {
      status: remaining === 0 ? 'completed' : 'processing',
      processed: processedRow ? formatRegion(processedRow) : null,
      remaining,
      regions: listed.regions,
    };
  }

  async processRegion(params: {
    householdId: string;
    floorPlanId: string;
    regionId: string;
    kind: 'floor' | 'detached';
    name: string;
    boundingBox: BoundingBox;
    rasterBytes: Uint8Array | null;
    rasterContentType: 'image/png' | 'image/jpeg' | null;
    vectorizer: FloorPlanVectorizationService;
    analysisService: FloorPlanAnalysisService;
  }): Promise<void> {
    const {
      householdId,
      floorPlanId,
      regionId,
      kind,
      name,
      boundingBox,
      rasterBytes,
      rasterContentType,
      vectorizer,
      analysisService,
    } = params;

    await this.db
      .update(floorPlanSchema.floorPlanRegions)
      .set({ status: 'processing', error_message: null, updated_at: now() })
      .where(eq(floorPlanSchema.floorPlanRegions.id, regionId));

    try {
      let cropKey: string | null = null;
      let cropBase64: string | null = null;
      const cropMediaType: 'image/png' | 'image/jpeg' = 'image/png';

      if (rasterBytes && rasterContentType) {
        try {
          const crop = cropImageByBoundingBox({
            imageBytes: rasterBytes,
            contentType: rasterContentType,
            boundingBox: boundingBox as CropBox,
          });
          cropKey = `floor-plans/${householdId}/${floorPlanId}/regions/${regionId}/crop.png`;
          await this.env.REPORTS_BUCKET.put(cropKey, crop.pngBytes, {
            httpMetadata: { contentType: 'image/png' },
          });
          cropBase64 = this.arrayBufferToBase64(crop.pngBytes);
        } catch (cropErr) {
          console.warn(`[FLOOR-PLAN] Crop failed for region ${regionId}:`, cropErr);
        }
      }

      if (!cropBase64) {
        await this.db
          .update(floorPlanSchema.floorPlanRegions)
          .set({
            status: 'skipped',
            trace_status: 'skipped',
            error_message: 'No raster available to crop region',
            updated_at: now(),
          })
          .where(eq(floorPlanSchema.floorPlanRegions.id, regionId));
        return;
      }

      const spaces = await analysisService.analyzeRegionSpaces({
        imageBase64: cropBase64,
        mediaType: cropMediaType,
        regionName: name,
        kind,
      });

      let semanticKey: string | null = null;
      try {
        const semantic = await vectorizer.generateSemanticSvg({
          imageBase64: cropBase64,
          mediaType: cropMediaType,
        });
        semanticKey = `floor-plans/${householdId}/${floorPlanId}/regions/${regionId}/vector-semantic.svg`;
        await this.env.REPORTS_BUCKET.put(semanticKey, semantic.svg, {
          httpMetadata: { contentType: 'image/svg+xml' },
        });
      } catch (semErr) {
        console.warn(`[FLOOR-PLAN] Semantic SVG failed for ${regionId}:`, semErr);
      }

      let traceKey: string | null = null;
      let traceStatus = 'skipped';
      if (vectorizer.isTraceConfigured()) {
        try {
          await this.db
            .update(floorPlanSchema.floorPlanRegions)
            .set({ trace_status: 'processing', updated_at: now() })
            .where(eq(floorPlanSchema.floorPlanRegions.id, regionId));

          const traced = await vectorizer.traceFloorPlan({
            imageBase64: cropBase64,
            contentType: 'image/png',
          });
          traceKey = `floor-plans/${householdId}/${floorPlanId}/regions/${regionId}/vector-trace.svg`;
          await this.env.REPORTS_BUCKET.put(traceKey, traced.svg, {
            httpMetadata: { contentType: 'image/svg+xml' },
          });
          traceStatus = 'completed';
        } catch (traceErr) {
          console.warn(`[FLOOR-PLAN] Trace failed for ${regionId}:`, traceErr);
          traceStatus = 'failed';
        }
      }

      await this.db
        .update(floorPlanSchema.floorPlanRegions)
        .set({
          crop_image_key: cropKey,
          vector_semantic_key: semanticKey,
          vector_trace_key: traceKey,
          spaces_json: JSON.stringify(spaces),
          status: 'completed',
          trace_status: traceStatus,
          error_message: null,
          updated_at: now(),
        })
        .where(eq(floorPlanSchema.floorPlanRegions.id, regionId));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Region processing failed';
      console.error(`[FLOOR-PLAN] Region ${regionId} failed:`, error);
      await this.db
        .update(floorPlanSchema.floorPlanRegions)
        .set({
          status: 'failed',
          error_message: message,
          updated_at: now(),
        })
        .where(eq(floorPlanSchema.floorPlanRegions.id, regionId));
    }
  }

  async listRegions(floorPlanId: string) {
    const regions = await this.db
      .select()
      .from(floorPlanSchema.floorPlanRegions)
      .where(eq(floorPlanSchema.floorPlanRegions.floor_plan_id, floorPlanId));

    return {
      regions: [...regions]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((r) => formatRegion(r)),
    };
  }

  async retryRegion(params: {
    householdId: string;
    floorPlanId: string;
    regionId: string;
    floorPlan: any;
  }) {
    const { householdId, floorPlanId, regionId, floorPlan } = params;
    const regionRows = await this.db
      .select()
      .from(floorPlanSchema.floorPlanRegions)
      .where(
        and(
          eq(floorPlanSchema.floorPlanRegions.id, regionId),
          eq(floorPlanSchema.floorPlanRegions.floor_plan_id, floorPlanId)
        )
      )
      .limit(1);

    const region = regionRows[0];
    if (!region) throw new NotFoundError('Floor plan region');

    const bbox = JSON.parse(region.bounding_box) as BoundingBox;
    const analysisService = new FloorPlanAnalysisService(this.env, this.userId);
    const vectorizer = new FloorPlanVectorizationService(this.env, this.userId);
    const { rasterBytes, rasterContentType } = await this.loadRaster(floorPlan);

    await this.processRegion({
      householdId,
      floorPlanId,
      regionId,
      kind: region.kind as 'floor' | 'detached',
      name: region.name,
      boundingBox: bbox,
      rasterBytes,
      rasterContentType,
      vectorizer,
      analysisService,
    });

    await this.rebuildAnalysisFromRegions(floorPlanId, floorPlan);

    const updated = await this.db
      .select()
      .from(floorPlanSchema.floorPlanRegions)
      .where(eq(floorPlanSchema.floorPlanRegions.id, regionId))
      .limit(1);

    return { region: formatRegion(updated[0]) };
  }

  async syncRegionsAfterAreaEdit(
    householdId: string,
    floorPlanId: string,
    floorPlan: any,
    analysis: FloorPlanAnalysisResult
  ): Promise<void> {
    const existingRegions = await this.db
      .select()
      .from(floorPlanSchema.floorPlanRegions)
      .where(eq(floorPlanSchema.floorPlanRegions.floor_plan_id, floorPlanId));

    const analysisService = new FloorPlanAnalysisService(this.env, this.userId);
    const vectorizer = new FloorPlanVectorizationService(this.env, this.userId);
    const { rasterBytes, rasterContentType } = await this.loadRaster(floorPlan);

    const desired: Array<{
      kind: 'floor' | 'detached';
      name: string;
      level: number | null;
      detached_type: string | null;
      sort_order: number;
      bounding_box: BoundingBox;
    }> = [];

    analysis.floors.forEach((f, idx) => {
      if (!f.bounding_box) return;
      desired.push({
        kind: 'floor',
        name: f.name,
        level: f.level,
        detached_type: null,
        sort_order: idx,
        bounding_box: f.bounding_box,
      });
    });
    analysis.detached_areas.forEach((d, idx) => {
      if (!d.bounding_box) return;
      desired.push({
        kind: 'detached',
        name: d.name,
        level: null,
        detached_type: d.type,
        sort_order: analysis.floors.length + idx,
        bounding_box: d.bounding_box,
      });
    });

    const usedIds = new Set<string>();

    for (const spec of desired) {
      const match =
        existingRegions.find(
          (r) => !usedIds.has(r.id) && r.kind === spec.kind && r.sort_order === spec.sort_order
        ) ||
        existingRegions.find(
          (r) => !usedIds.has(r.id) && r.kind === spec.kind && r.name === spec.name
        );

      if (match) {
        usedIds.add(match.id);
        const prevBox = JSON.parse(match.bounding_box) as BoundingBox;
        const boxChanged =
          prevBox.x1 !== spec.bounding_box.x1 ||
          prevBox.y1 !== spec.bounding_box.y1 ||
          prevBox.x2 !== spec.bounding_box.x2 ||
          prevBox.y2 !== spec.bounding_box.y2 ||
          match.name !== spec.name;

        await this.db
          .update(floorPlanSchema.floorPlanRegions)
          .set({
            name: spec.name,
            level: spec.level,
            detached_type: spec.detached_type,
            sort_order: spec.sort_order,
            bounding_box: JSON.stringify(spec.bounding_box),
            ...(boxChanged
              ? {
                  crop_image_key: null,
                  vector_semantic_key: null,
                  vector_trace_key: null,
                  spaces_json: null,
                  status: 'pending',
                  trace_status: 'pending',
                  error_message: null,
                }
              : {}),
            updated_at: now(),
          })
          .where(eq(floorPlanSchema.floorPlanRegions.id, match.id));

        if (boxChanged) {
          await this.processRegion({
            householdId,
            floorPlanId,
            regionId: match.id,
            kind: spec.kind,
            name: spec.name,
            boundingBox: spec.bounding_box,
            rasterBytes,
            rasterContentType,
            vectorizer,
            analysisService,
          });
        }
      } else {
        const id = generateId();
        const ts = now();
        await this.db.insert(floorPlanSchema.floorPlanRegions).values({
          id,
          floor_plan_id: floorPlanId,
          kind: spec.kind,
          name: spec.name,
          level: spec.level,
          detached_type: spec.detached_type,
          sort_order: spec.sort_order,
          bounding_box: JSON.stringify(spec.bounding_box),
          status: 'pending',
          trace_status: 'pending',
          created_at: ts,
          updated_at: ts,
        });
        usedIds.add(id);
        await this.processRegion({
          householdId,
          floorPlanId,
          regionId: id,
          kind: spec.kind,
          name: spec.name,
          boundingBox: spec.bounding_box,
          rasterBytes,
          rasterContentType,
          vectorizer,
          analysisService,
        });
      }
    }

    for (const r of existingRegions) {
      if (!usedIds.has(r.id)) {
        await this.db
          .delete(floorPlanSchema.floorPlanRegions)
          .where(eq(floorPlanSchema.floorPlanRegions.id, r.id));
      }
    }

    await this.rebuildAnalysisFromRegions(floorPlanId, {
      ...floorPlan,
      ai_analysis_data: JSON.stringify(analysis),
    });
  }

  async rebuildAnalysisFromRegions(floorPlanId: string, floorPlan: any): Promise<void> {
    const regions = await this.db
      .select()
      .from(floorPlanSchema.floorPlanRegions)
      .where(eq(floorPlanSchema.floorPlanRegions.floor_plan_id, floorPlanId));

    const existing: FloorPlanAnalysisResult = floorPlan.ai_analysis_data
      ? JSON.parse(floorPlan.ai_analysis_data)
      : {
          property_address: floorPlan.ai_property_address,
          total_area: { value: floorPlan.ai_total_area_sqft, unit: 'sq_ft' },
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
            garage_type: 'none' as const,
            confidence: 'medium' as const,
          },
        };

    const floors: FloorPlanAnalysisResult['floors'] = [];
    const detached_areas: FloorPlanAnalysisResult['detached_areas'] = [];

    for (const region of [...regions].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
      const bbox = JSON.parse(region.bounding_box) as BoundingBox;
      const spaces: SpaceInfo[] = region.spaces_json ? JSON.parse(region.spaces_json) : [];
      if (region.kind === 'floor') {
        const prev = existing.floors.find((f) => f.name === region.name);
        floors.push({
          name: region.name,
          level: region.level ?? prev?.level ?? 0,
          area: prev?.area ?? { value: null, unit: null },
          bounding_box: bbox,
          spaces,
        });
      } else {
        const prev = existing.detached_areas.find((d) => d.name === region.name);
        detached_areas.push({
          name: region.name,
          type: region.detached_type || prev?.type || 'other',
          area: prev?.area ?? { value: null, unit: null },
          bounding_box: bbox,
          spaces,
        });
      }
    }

    const totalSpaceCount =
      floors.reduce((s, f) => s + f.spaces.length, 0) +
      detached_areas.reduce((s, d) => s + d.spaces.length, 0);

    const analysis: FloorPlanAnalysisResult = {
      ...existing,
      floors,
      detached_areas,
      metadata: {
        ...existing.metadata,
        floor_count: floors.length,
        detached_area_count: detached_areas.length,
        multiple_floors: floors.length > 1,
        total_space_count: totalSpaceCount,
      },
    };

    await this.db
      .update(floorPlanSchema.floorPlans)
      .set({
        ai_analysis_data: JSON.stringify(analysis),
        ai_floor_count: floors.length,
        updated_at: now(),
      })
      .where(eq(floorPlanSchema.floorPlans.id, floorPlanId));
  }

  private async loadRaster(floorPlan: any): Promise<{
    rasterBytes: Uint8Array | null;
    rasterContentType: 'image/png' | 'image/jpeg' | null;
  }> {
    const rasterKey = floorPlan.display_image_key || floorPlan.original_file_key;
    const rasterObj = await this.env.REPORTS_BUCKET.get(rasterKey);
    if (!rasterObj) return { rasterBytes: null, rasterContentType: null };

    const ct =
      (rasterObj.httpMetadata?.contentType as string) ||
      (floorPlan.display_image_key ? 'image/png' : floorPlan.content_type);
    if (!isRasterContentType(ct)) {
      return { rasterBytes: null, rasterContentType: null };
    }
    return {
      rasterBytes: new Uint8Array(await rasterObj.arrayBuffer()),
      rasterContentType: ct.includes('png') ? 'image/png' : 'image/jpeg',
    };
  }
}

export function formatRegion(r: any) {
  const fileUrl = (key: string | null) => (key ? `/files/${key}` : null);
  return {
    id: r.id,
    floor_plan_id: r.floor_plan_id,
    kind: r.kind,
    name: r.name,
    level: r.level,
    detached_type: r.detached_type,
    sort_order: r.sort_order,
    bounding_box: typeof r.bounding_box === 'string' ? JSON.parse(r.bounding_box) : r.bounding_box,
    spaces: r.spaces_json ? JSON.parse(r.spaces_json) : [],
    status: r.status,
    trace_status: r.trace_status,
    error_message: r.error_message,
    crop_image_key: r.crop_image_key,
    crop_image_url: fileUrl(r.crop_image_key),
    vector_semantic_key: r.vector_semantic_key,
    vector_semantic_url: fileUrl(r.vector_semantic_key),
    vector_trace_key: r.vector_trace_key,
    vector_trace_url: fileUrl(r.vector_trace_key),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}
