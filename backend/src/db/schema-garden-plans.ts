import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

import { households, users, householdSpaces } from './schema';

// ============ GARDEN PLANS ============
//
// A garden plan is a photo or sketch of a yard, bed, or outdoor area with
// task markers pinned to specific spots. Intentionally separate from
// floor_plans — no floor detection, no OCR, no scale calibration.

export const GARDEN_PLAN_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
] as const;
export type GardenPlanContentType = (typeof GARDEN_PLAN_CONTENT_TYPES)[number];

export const GARDEN_PLAN_STATUSES = ['pending_upload', 'uploaded', 'generating', 'completed', 'failed'] as const;
export type GardenPlanStatus = (typeof GARDEN_PLAN_STATUSES)[number];

export const GARDEN_PLAN_TYPES = ['front_yard', 'back_yard', 'garden', 'bed', 'other_outdoor'] as const;
export type GardenPlanType = (typeof GARDEN_PLAN_TYPES)[number];

export const GARDEN_PLAN_BOUNDARY_DRAFT_STATUSES = ['draft', 'confirmed', 'generating', 'generated', 'expired'] as const;
export type GardenPlanBoundaryDraftStatus = (typeof GARDEN_PLAN_BOUNDARY_DRAFT_STATUSES)[number];

export const GARDEN_PLAN_BOUNDARY_SOURCES = ['user_adjusted', 'user_drawn'] as const;
export type GardenPlanBoundarySource = (typeof GARDEN_PLAN_BOUNDARY_SOURCES)[number];

export const GARDEN_PLAN_OBJECT_TYPES = [
  'tree',
  'shrub',
  'flower',
  'raised_bed',
  'path',
  'patio',
  'label',
  // An AREA within the lot — front yard, back yard, house footprint, driveway.
  // The ring lives in `metadata_json` under `zone.polygon` (normalized to the
  // plan's bounding box, as every object's coordinates are), while the row's
  // own x/y/width/height carry that ring's bounding box so selection and the
  // fallback renderer keep working without parsing the metadata.
  //
  // No migration is needed: `type` is a text column with no CHECK constraint,
  // and this list is the only thing that has ever validated it.
  'zone',
] as const;
export type GardenPlanObjectType = (typeof GARDEN_PLAN_OBJECT_TYPES)[number];

export const gardenPlans = sqliteTable(
  'garden_plans',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),

    plan_type: text('plan_type').notNull().default('garden'),

    // File storage (R2)
    original_file_key: text('original_file_key').notNull(),
    display_image_key: text('display_image_key'),
    thumbnail_key: text('thumbnail_key'),

    // Metadata
    filename: text('filename').notNull(),
    file_size: integer('file_size').notNull(),
    content_type: text('content_type').notNull(),

    // Optional user label (e.g. "North bed", "Back lawn")
    label: text('label'),

    // Image dimensions (populated after upload)
    width_px: integer('width_px'),
    height_px: integer('height_px'),

    content_hash: text('content_hash'),

    status: text('status').default('pending_upload').notNull(),
    error_message: text('error_message'),

    // ai_tool_pending.id of the approval that triggered AI generation. NULL
    // for manually-uploaded plans. /retry + /cancel endpoints follow this to
    // re-fetch the original prompt and clean up the linked approval row.
    source_approval_id: text('source_approval_id'),

    // Which reference image (if any) was passed into gpt-image-1's edits
    // endpoint. Drives the mobile caption ("AI-traced from your lot" for
    // user_attachment / mapbox_satellite, "Stylized concept" for none).
    // NULL for legacy rows + manually-uploaded plans.
    reference_image_source: text('reference_image_source'),

    // Boundary-confirmed generation path. NULL for manual uploads and legacy
    // chat-generated concept plans.
    boundary_draft_id: text('boundary_draft_id'),
    boundary_source: text('boundary_source'),
    boundary_geojson: text('boundary_geojson'),
    geocode_place_name: text('geocode_place_name'),
    generation_prompt: text('generation_prompt'),

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
    household_id_idx: index('garden_plans_household_id_idx').on(table.household_id),
    status_idx: index('garden_plans_status_idx').on(table.status),
    source_approval_idx: index('garden_plans_source_approval_idx').on(
      table.source_approval_id
    ),
    boundary_draft_idx: index('garden_plans_boundary_draft_idx').on(table.boundary_draft_id),
  })
);

export const gardenPlanBoundaryDrafts = sqliteTable(
  'garden_plan_boundary_drafts',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    address_json: text('address_json').notNull(),
    formatted_address: text('formatted_address').notNull(),
    geocode_json: text('geocode_json'),
    geocode_place_name: text('geocode_place_name'),
    geocode_lat: real('geocode_lat'),
    geocode_lon: real('geocode_lon'),

    parcel_provider: text('parcel_provider'),
    parcel_id: text('parcel_id'),
    parcel_geojson: text('parcel_geojson'),
    parcel_confidence: text('parcel_confidence'),
    parcel_match_json: text('parcel_match_json'),

    confirmed_geojson: text('confirmed_geojson'),
    boundary_source: text('boundary_source'),
    preview_image_key: text('preview_image_key'),
    reference_image_key: text('reference_image_key'),

    status: text('status').notNull().default('draft'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    expires_at: text('expires_at').notNull(),
  },
  (table) => ({
    household_status_idx: index('garden_boundary_drafts_household_status_idx').on(
      table.household_id,
      table.status
    ),
    user_idx: index('garden_boundary_drafts_user_idx').on(table.user_id),
  })
);

// ============ GARDEN PLAN VECTOR OBJECTS ============

export const gardenPlanObjects = sqliteTable(
  'garden_plan_objects',
  {
    id: text('id').primaryKey(),
    garden_plan_id: text('garden_plan_id')
      .notNull()
      .references(() => gardenPlans.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    x: real('x').notNull(),
    y: real('y').notNull(),
    width: real('width').notNull(),
    height: real('height').notNull(),
    rotation: real('rotation').notNull().default(0),
    label: text('label'),
    color: text('color'),
    metadata_json: text('metadata_json'),
    sort_order: integer('sort_order').notNull().default(0),
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
    garden_plan_id_idx: index('garden_plan_objects_plan_id_idx').on(table.garden_plan_id),
  })
);

// ============ GARDEN PLAN MARKERS ============

export const GARDEN_MARKER_LINKED_ENTITY_TYPES = ['maintenance_task', 'action_item'] as const;
export type GardenMarkerLinkedEntityType = (typeof GARDEN_MARKER_LINKED_ENTITY_TYPES)[number];

export const gardenPlanMarkers = sqliteTable(
  'garden_plan_markers',
  {
    id: text('id').primaryKey(),
    garden_plan_id: text('garden_plan_id')
      .notNull()
      .references(() => gardenPlans.id, { onDelete: 'cascade' }),

    // Position (percentage-based)
    x_percent: integer('x_percent').notNull(),
    y_percent: integer('y_percent').notNull(),

    linked_entity_type: text('linked_entity_type').notNull(),
    linked_entity_id: text('linked_entity_id').notNull(),

    marker_color: text('marker_color').default('#4CAF50').notNull(),
    marker_icon: text('marker_icon').default('🌿').notNull(),
    label: text('label'),
    show_label: integer('show_label', { mode: 'boolean' }).default(true),

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
    garden_plan_id_idx: index('garden_plan_markers_plan_id_idx').on(table.garden_plan_id),
    linked_entity_idx: index('garden_plan_markers_linked_entity_idx').on(
      table.linked_entity_type,
      table.linked_entity_id
    ),
    space_id_idx: index('garden_plan_markers_space_id_idx').on(table.space_id),
  })
);
