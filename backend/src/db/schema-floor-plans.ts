import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, real } from 'drizzle-orm/sqlite-core';

import { households, users, householdSpaces } from './schema';

// ============ FLOOR PLANS ============

export const FLOOR_PLAN_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type FloorPlanContentType = (typeof FLOOR_PLAN_CONTENT_TYPES)[number];

export const FLOOR_PLAN_STATUSES = ['pending_upload', 'uploaded', 'processing', 'completed', 'failed'] as const;
export type FloorPlanStatus = (typeof FLOOR_PLAN_STATUSES)[number];

export const OCR_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
export type OcrStatus = (typeof OCR_STATUSES)[number];

export const SCALE_UNITS = ['feet', 'meters', 'inches'] as const;
export type ScaleUnit = (typeof SCALE_UNITS)[number];

export const SCALE_CALIBRATION_METHODS = ['ocr_auto', 'manual', 'none'] as const;
export type ScaleCalibrationMethod = (typeof SCALE_CALIBRATION_METHODS)[number];

export const VECTORIZATION_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
export type VectorizationStatus = (typeof VECTORIZATION_STATUSES)[number];

export const FLOOR_PLAN_REGION_KINDS = ['floor', 'detached'] as const;
export type FloorPlanRegionKind = (typeof FLOOR_PLAN_REGION_KINDS)[number];

export const FLOOR_PLAN_REGION_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
  'skipped',
] as const;
export type FloorPlanRegionStatus = (typeof FLOOR_PLAN_REGION_STATUSES)[number];

export const floorPlans = sqliteTable(
  'floor_plans',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),

    // File storage keys (R2/S3)
    original_file_key: text('original_file_key').notNull(),
    display_image_key: text('display_image_key'),
    thumbnail_key: text('thumbnail_key'),

    // Metadata
    filename: text('filename').notNull(),
    file_size: integer('file_size').notNull(),
    content_type: text('content_type').notNull(),

    // Building/Floor organization
    building_name: text('building_name').notNull(),
    floor_number: integer('floor_number'),
    floor_label: text('floor_label'),

    // Image dimensions
    width_px: integer('width_px'),
    height_px: integer('height_px'),

    // Scale (Phase 2)
    scale_pixels_per_foot: real('scale_pixels_per_foot'),
    scale_pixels_per_meter: real('scale_pixels_per_meter'),
    scale_unit: text('scale_unit').default('feet'),
    scale_calibration_method: text('scale_calibration_method').default('none'),

    // OCR processing
    ocr_status: text('ocr_status').default('pending'),
    ocr_detected_dimensions: text('ocr_detected_dimensions'), // JSON array

    // AI Analysis
    ai_analysis_status: text('ai_analysis_status').default('pending'), // pending, processing, completed, failed
    ai_analysis_data: text('ai_analysis_data'), // JSON - full analysis result
    ai_property_address: text('ai_property_address'),
    ai_total_area_sqft: real('ai_total_area_sqft'),
    ai_floor_count: integer('ai_floor_count'),
    ai_analyzed_at: text('ai_analyzed_at'),

    /** SHA-256 hex of the source bytes, copied from aihousekeeper_attachments at routing time. */
    content_hash: text('content_hash'),

    // Vectorization (Phase 1: AI semantic SVG; Phase 2: pixel-perfect trace SVG)
    vector_trace_key: text('vector_trace_key'),
    vector_semantic_key: text('vector_semantic_key'),
    vectorization_status: text('vectorization_status').default('pending'),
    vectorization_error: text('vectorization_error'),
    vectorized_at: text('vectorized_at'),

    // Status
    status: text('status').default('pending_upload').notNull(),
    processing_stage: text('processing_stage'),
    error_message: text('error_message'),

    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    deleted_at: text('deleted_at'),
  },
  (table) => ({
    household_id_idx: index('floor_plans_household_id_idx').on(table.household_id),
    building_name_idx: index('floor_plans_building_name_idx').on(table.building_name),
    status_idx: index('floor_plans_status_idx').on(table.status),
  })
);

// ============ FLOOR PLAN REGIONS ============
// Per-floor / detached-area crops + hybrid vector assets (trace + semantic).

export const floorPlanRegions = sqliteTable(
  'floor_plan_regions',
  {
    id: text('id').primaryKey(),
    floor_plan_id: text('floor_plan_id')
      .notNull()
      .references(() => floorPlans.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // floor | detached
    name: text('name').notNull(),
    level: integer('level'),
    detached_type: text('detached_type'),
    sort_order: integer('sort_order').notNull().default(0),
    bounding_box: text('bounding_box').notNull(), // JSON BoundingBox
    crop_image_key: text('crop_image_key'),
    vector_trace_key: text('vector_trace_key'),
    vector_semantic_key: text('vector_semantic_key'),
    spaces_json: text('spaces_json'), // JSON SpaceInfo[]
    status: text('status').notNull().default('pending'),
    trace_status: text('trace_status').notNull().default('pending'),
    error_message: text('error_message'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    floor_plan_id_idx: index('floor_plan_regions_floor_plan_id_idx').on(table.floor_plan_id),
    status_idx: index('floor_plan_regions_status_idx').on(table.status),
  })
);

// ============ FLOOR PLAN MARKERS ============

export const MARKER_TYPES = ['pin', 'circle', 'square'] as const;
export type MarkerType = (typeof MARKER_TYPES)[number];

export const LINKED_ENTITY_TYPES = ['maintenance_task', 'action_item'] as const;
export type LinkedEntityType = (typeof LINKED_ENTITY_TYPES)[number];

export const floorPlanMarkers = sqliteTable(
  'floor_plan_markers',
  {
    id: text('id').primaryKey(),
    floor_plan_id: text('floor_plan_id')
      .notNull()
      .references(() => floorPlans.id, { onDelete: 'cascade' }),

    // Position (percentage-based for scale independence)
    x_percent: real('x_percent').notNull(),
    y_percent: real('y_percent').notNull(),

    // Linked entity
    linked_entity_type: text('linked_entity_type').notNull(),
    linked_entity_id: text('linked_entity_id').notNull(),

    // Customization
    marker_type: text('marker_type').default('pin').notNull(),
    marker_color: text('marker_color').default('#FF6B6B').notNull(),
    marker_icon: text('marker_icon').default('📍').notNull(),
    label: text('label'),
    show_label: integer('show_label', { mode: 'boolean' }).default(true),

    // Space association
    space_id: text('space_id').references(() => householdSpaces.id, { onDelete: 'set null' }),

    created_by: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    deleted_at: text('deleted_at'),
  },
  (table) => ({
    floor_plan_id_idx: index('floor_plan_markers_floor_plan_id_idx').on(table.floor_plan_id),
    linked_entity_idx: index('floor_plan_markers_linked_entity_idx').on(
      table.linked_entity_type,
      table.linked_entity_id
    ),
    space_id_idx: index('floor_plan_markers_space_id_idx').on(table.space_id),
  })
);

// ============ FLOOR PLAN ANNOTATIONS ============

export const ANNOTATION_TYPES = ['line', 'circle', 'polygon', 'text', 'measurement'] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

export const floorPlanAnnotations = sqliteTable(
  'floor_plan_annotations',
  {
    id: text('id').primaryKey(),
    floor_plan_id: text('floor_plan_id')
      .notNull()
      .references(() => floorPlans.id, { onDelete: 'cascade' }),
    annotation_type: text('annotation_type').notNull(),
    svg_data: text('svg_data').notNull(), // JSON object
    stroke_color: text('stroke_color').default('#000000').notNull(),
    stroke_width: real('stroke_width').default(2).notNull(),
    fill_color: text('fill_color'),
    opacity: real('opacity').default(1).notNull(),
    text_content: text('text_content'),
    font_size: integer('font_size').default(14),
    measurement_value: real('measurement_value'),
    measurement_unit: text('measurement_unit'),
    created_by: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    deleted_at: text('deleted_at'),
  },
  (table) => ({
    floor_plan_id_idx: index('floor_plan_annotations_floor_plan_id_idx').on(table.floor_plan_id),
    annotation_type_idx: index('floor_plan_annotations_type_idx').on(table.annotation_type),
  })
);
