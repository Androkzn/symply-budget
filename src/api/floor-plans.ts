import { createHouseLocalProxy } from '@features/house/local/localApiProxy';
import { useAuthStore } from '@stores/authStore';

import { apiClient } from './client';
import { putUploadViaXhr } from './e2ePutUpload';

// Types
export interface FloorPlan {
  id: string;
  household_id: string;

  // File storage keys (R2/S3)
  original_file_key: string;
  display_image_key: string | null;
  thumbnail_key: string | null;

  // Metadata
  filename: string;
  file_size: number;
  content_type: 'application/pdf' | 'image/jpeg' | 'image/png';

  // Building/Floor organization
  building_name: string;
  floor_number: number | null;
  floor_label: string | null;

  // Image dimensions
  width_px: number | null;
  height_px: number | null;

  // Scale (Phase 2)
  scale_pixels_per_foot: number | null;
  scale_pixels_per_meter: number | null;
  scale_unit: 'feet' | 'meters' | 'inches';
  scale_calibration_method: 'ocr_auto' | 'manual' | 'none';

  // OCR processing
  ocr_status: 'pending' | 'processing' | 'completed' | 'failed';
  ocr_detected_dimensions: DetectedDimension[] | null;

  // Status
  status: 'pending_upload' | 'uploaded' | 'processing' | 'completed' | 'failed';
  processing_stage: string | null;
  error_message: string | null;

  // AI Analysis
  ai_analysis_status: 'pending' | 'processing' | 'completed' | 'failed' | null;
  ai_analysis_data: FloorPlanAnalysis | null;
  ai_property_address: string | null;
  ai_total_area_sqft: number | null;
  ai_floor_count: number | null;
  ai_analyzed_at: string | null;

  // Vectorization (PR 1: AI semantic SVG; PR 4: pixel-perfect trace)
  vector_semantic_key: string | null;
  vector_trace_key: string | null;
  vectorization_status: 'pending' | 'processing' | 'completed' | 'failed' | null;
  vectorization_error: string | null;
  vectorized_at: string | null;

  created_at: string;
  updated_at: string;
}

export interface FloorPlanVectorAssets {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  vector_semantic_key: string | null;
  vector_semantic_url: string | null;
  vector_trace_key: string | null;
  vector_trace_url: string | null;
  vectorized_at: string | null;
  error: string | null;
}

export interface FloorPlanRegion {
  id: string;
  floor_plan_id: string;
  kind: 'floor' | 'detached';
  name: string;
  level: number | null;
  detached_type: string | null;
  sort_order: number;
  bounding_box: BoundingBox;
  spaces: SpaceInfo[];
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  trace_status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  error_message: string | null;
  crop_image_key: string | null;
  crop_image_url: string | null;
  vector_semantic_key: string | null;
  vector_semantic_url: string | null;
  vector_trace_key: string | null;
  vector_trace_url: string | null;
  created_at: string;
  updated_at: string;
}

interface VectorizeResponse {
  status: 'completed' | 'processing';
  vector_semantic_key?: string | null;
  vector_trace_key?: string | null;
  vectorized_at?: string | null;
}

// Bounding box with normalized coordinates (0-1 scale)
export interface BoundingBox {
  x1: number; // left edge (0-1)
  y1: number; // top edge (0-1)
  x2: number; // right edge (0-1)
  y2: number; // bottom edge (0-1)
}

// AI Analysis Types - NEW STRUCTURE
// Areas contain Spaces (instead of Floors containing Rooms)
// Areas are either Floors (attached to main building) or Detached Areas (separate structures)

export interface SpaceInfo {
  name: string;
  type: string;
  is_outdoor: boolean;
  dimensions: {
    width: number | null;
    length: number | null;
    unit: 'ft' | 'm' | 'in' | null;
  };
  area: {
    value: number | null;
    unit: 'sq_ft' | 'sq_m' | null;
  };
  position: {
    description: string;
  };
}

export interface FloorInfo {
  name: string;
  level: number;
  area: {
    value: number | null;
    unit: 'sq_ft' | 'sq_m' | null;
  };
  bounding_box: BoundingBox | null;
  spaces: SpaceInfo[];
}

export interface DetachedAreaInfo {
  name: string;
  type: string;
  area: {
    value: number | null;
    unit: 'sq_ft' | 'sq_m' | null;
  };
  bounding_box: BoundingBox | null;
  spaces: SpaceInfo[];
}

export interface ExcludedAreaItem {
  name: string;
  area: {
    value: number | null;
    unit: 'sq_ft' | 'sq_m' | null;
  };
}

export interface FloorPlanAnalysis {
  property_address: string | null;
  total_area: {
    value: number | null;
    unit: 'sq_ft' | 'sq_m' | null;
  };
  floors: FloorInfo[];
  detached_areas: DetachedAreaInfo[];
  excluded_from_living_area: {
    total: {
      value: number | null;
      unit: 'sq_ft' | 'sq_m' | null;
    };
    items: ExcludedAreaItem[];
  };
  metadata: {
    scale_bar_detected: boolean;
    dimensions_labeled: boolean;
    space_labels_present: boolean;
    multiple_floors: boolean;
    floor_count: number;
    detached_area_count: number;
    total_space_count: number;
    has_outdoor_spaces: boolean;
    has_garage: boolean;
    garage_type: 'attached' | 'detached' | 'none';
    confidence: 'high' | 'medium' | 'low';
    layout_type?: 'side_by_side' | 'stacked' | 'single' | 'mixed';
  };
}

// Legacy types for backward compatibility
export interface RoomInfo {
  name: string;
  type: string;
  dimensions: {
    width: number | null;
    length: number | null;
    unit: 'ft' | 'm' | 'in' | null;
  };
  area: {
    value: number | null;
    unit: 'sq_ft' | 'sq_m' | null;
  };
  position: {
    description: string;
  };
  bounding_box?: BoundingBox | null;
}

export interface FeatureInfo {
  name: string;
  type: string;
  area: {
    value: number | null;
    unit: 'sq_ft' | 'sq_m' | null;
  };
  location?: string;
  bounding_box?: BoundingBox | null;
}

export interface DetectedDimension {
  text: string;
  value: number;
  unit: string;
  bounding_box: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
}

export interface FloorPlanMarker {
  id: string;
  floor_plan_id: string;

  // Position (percentage-based for scale independence)
  x_percent: number;
  y_percent: number;

  // Linked entity
  linked_entity_type: 'task';
  linked_entity_id: string;

  // Customization
  marker_type: 'pin' | 'circle' | 'square';
  marker_color: string;
  marker_icon: string;
  label: string | null;
  show_label: boolean;

  // Space association
  space_id: string | null;

  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface FloorPlanAnnotation {
  id: string;
  floor_plan_id: string;
  annotation_type: 'line' | 'circle' | 'polygon' | 'text' | 'measurement';
  svg_data: {
    // For line
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;

    // For circle
    cx?: number;
    cy?: number;
    r?: number;

    // For polygon/path
    points?: Array<{ x: number; y: number }>;
    path?: string;

    // For text
    x?: number;
    y?: number;
  };
  stroke_color: string;
  stroke_width: number;
  fill_color: string | null;
  opacity: number;
  text_content: string | null;
  font_size: number;
  measurement_value: number | null;
  measurement_unit: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Request types
interface UploadUrlRequest {
  filename: string;
  file_size: number;
  content_type: 'application/pdf' | 'image/jpeg' | 'image/png';
  building_name?: string;
  floor_number?: number;
  floor_label?: string;
}

interface ConfirmUploadRequest {
  building_name: string;
  floor_number?: number;
  floor_label?: string;
}

interface UpdateFloorPlanRequest {
  building_name?: string;
  floor_number?: number;
  floor_label?: string;
  scale_pixels_per_foot?: number;
  scale_pixels_per_meter?: number;
  scale_unit?: 'feet' | 'meters' | 'inches';
}

interface CreateMarkerRequest {
  x_percent: number;
  y_percent: number;
  linked_entity_type: 'task';
  linked_entity_id: string;
  marker_type?: 'pin' | 'circle' | 'square' | 'task';
  marker_color?: string;
  marker_icon?: string;
  label?: string;
  show_label?: boolean;
  space_id?: string;
}

interface UpdateMarkerRequest {
  x_percent?: number;
  y_percent?: number;
  marker_type?: 'pin' | 'circle' | 'square';
  marker_color?: string;
  marker_icon?: string;
  label?: string;
  show_label?: boolean;
  space_id?: string;
}

interface CalibrateScaleRequest {
  pixel_distance: number;
  actual_distance: number;
  unit: 'feet' | 'meters' | 'inches';
}

interface FloorPlanFilters {
  building_name?: string;
  limit?: number;
  cursor?: string;
}

// Response types
interface UploadUrlResponse {
  floor_plan_id: string;
  upload_url: string;
  expires_at: string;
}

interface FloorPlansListResponse {
  floor_plans: FloorPlan[];
  next_cursor?: string;
}

interface FloorPlanResponse {
  floor_plan: FloorPlan;
}

interface MarkersListResponse {
  markers: FloorPlanMarker[];
  next_cursor?: string;
}

interface MarkerResponse {
  marker: FloorPlanMarker;
}

interface AnnotationsListResponse {
  annotations: FloorPlanAnnotation[];
  next_cursor?: string;
}

interface AnnotationResponse {
  annotation: FloorPlanAnnotation;
}

interface ProcessingStatusResponse {
  status: string;
  processing_stage: string | null;
  error_message: string | null;
  ocr_status: string | null;
}

const remoteFloorPlansApi = {
  // Upload flow (similar to reports)
  getUploadUrl: (householdId: string, data: UploadUrlRequest) =>
    apiClient
      .post<UploadUrlResponse>(
        `/households/${householdId}/floor-plans/upload-url`,
        data
      )
      .then((res) => res.data),

  uploadFile: async (
    uploadUrl: string,
    file: Blob,
    onProgress?: (progress: number) => void
  ) => {
    const token = useAuthStore.getState().token;

    return putUploadViaXhr({
      uploadUrl,
      body: file,
      contentType: file.type || 'application/octet-stream',
      authorization: token,
      label: 'floor-plan',
      onProgress,
    });
  },

  confirmUpload: (householdId: string, floorPlanId: string, data: ConfirmUploadRequest) =>
    apiClient
      .post<FloorPlanResponse>(
        `/households/${householdId}/floor-plans/${floorPlanId}/confirm-upload`,
        data
      )
      .then((res) => res.data),

  // Processing status
  getProcessingStatus: (householdId: string, floorPlanId: string) =>
    apiClient
      .get<ProcessingStatusResponse>(
        `/households/${householdId}/floor-plans/${floorPlanId}/status`
      )
      .then((res) => res.data),

  // Floor Plan CRUD
  list: (householdId: string, filters?: FloorPlanFilters) =>
    apiClient
      .get<FloorPlansListResponse>(`/households/${householdId}/floor-plans`, {
        params: filters,
      })
      .then((res) => res.data),

  get: (householdId: string, floorPlanId: string) =>
    apiClient
      .get<FloorPlanResponse>(
        `/households/${householdId}/floor-plans/${floorPlanId}`
      )
      .then((res) => res.data),

  update: (householdId: string, floorPlanId: string, data: UpdateFloorPlanRequest) =>
    apiClient
      .patch<FloorPlanResponse>(
        `/households/${householdId}/floor-plans/${floorPlanId}`,
        data
      )
      .then((res) => res.data),

  delete: (householdId: string, floorPlanId: string) =>
    apiClient
      .delete(`/households/${householdId}/floor-plans/${floorPlanId}`)
      .then((res) => res.data),

  // Scale calibration (Phase 2) — no client UI call site yet; HOUSE-FP-006 deferred.
  calibrateScale: (householdId: string, floorPlanId: string, data: CalibrateScaleRequest) =>
    apiClient
      .post<FloorPlanResponse>(
        `/households/${householdId}/floor-plans/${floorPlanId}/calibrate-scale`,
        data
      )
      .then((res) => res.data),

  // Markers
  listMarkers: (householdId: string, floorPlanId: string) =>
    apiClient
      .get<MarkersListResponse>(
        `/households/${householdId}/floor-plans/${floorPlanId}/markers`
      )
      .then((res) => res.data),

  getMarkersForEntity: (
    householdId: string,
    entityType: 'task',
    entityId: string
  ) =>
    apiClient
      .get<MarkersListResponse>(
        `/households/${householdId}/floor-plans/markers-for-entity`,
        {
          params: {
            linked_entity_type: entityType,
            linked_entity_id: entityId,
          },
        }
      )
      .then((res) => res.data),

  createMarker: (householdId: string, floorPlanId: string, data: CreateMarkerRequest) =>
    apiClient
      .post<MarkerResponse>(
        `/households/${householdId}/floor-plans/${floorPlanId}/markers`,
        data
      )
      .then((res) => res.data),

  updateMarker: (householdId: string, markerId: string, data: UpdateMarkerRequest) =>
    apiClient
      .patch<MarkerResponse>(
        `/households/${householdId}/floor-plans/markers/${markerId}`,
        data
      )
      .then((res) => res.data),

  deleteMarker: (householdId: string, markerId: string) =>
    apiClient
      .delete(`/households/${householdId}/floor-plans/markers/${markerId}`)
      .then((res) => res.data),

  // Annotations (Phase 3)
  listAnnotations: (householdId: string, floorPlanId: string) =>
    apiClient
      .get<AnnotationsListResponse>(
        `/households/${householdId}/floor-plans/${floorPlanId}/annotations`
      )
      .then((res) => res.data),

  createAnnotation: (
    householdId: string,
    floorPlanId: string,
    data: Partial<FloorPlanAnnotation>
  ) =>
    apiClient
      .post<AnnotationResponse>(
        `/households/${householdId}/floor-plans/${floorPlanId}/annotations`,
        data
      )
      .then((res) => res.data),

  deleteAnnotation: (householdId: string, annotationId: string) =>
    apiClient
      .delete(
        `/households/${householdId}/floor-plan-annotations/${annotationId}`
      )
      .then((res) => res.data),

  // AI Analysis — kicks off background pipeline; client polls getAnalysis
  triggerAnalysis: (householdId: string, floorPlanId: string) => {
    const AI_TIMEOUT = 60000; // start is fast; work continues in waitUntil
    console.log(`[FloorPlans API] Triggering analysis with ${AI_TIMEOUT}ms timeout`);
    return apiClient
      .post<AnalysisResponse>(
        `/households/${householdId}/floor-plans/${floorPlanId}/analyze`,
        undefined,
        { timeout: AI_TIMEOUT }
      )
      .then((res) => res.data);
  },

  getAnalysis: (householdId: string, floorPlanId: string) =>
    apiClient
      .get<AnalysisResponse>(
        `/households/${householdId}/floor-plans/${floorPlanId}/analysis`,
        { timeout: 60000 }
      )
      .then((res) => res.data),

  listRegions: (householdId: string, floorPlanId: string) =>
    apiClient
      .get<{ regions: FloorPlanRegion[] }>(
        `/households/${householdId}/floor-plans/${floorPlanId}/regions`
      )
      .then((res) => res.data),

  processPendingRegions: (householdId: string, floorPlanId: string) => {
    const TIMEOUT = 180000; // one region: crop + spaces + semantic
    return apiClient
      .post<{
        status: 'processing' | 'completed';
        processed: FloorPlanRegion | null;
        remaining: number;
        regions: FloorPlanRegion[];
      }>(
        `/households/${householdId}/floor-plans/${floorPlanId}/regions/process-pending`,
        undefined,
        { timeout: TIMEOUT }
      )
      .then((res) => res.data);
  },

  retryRegion: (householdId: string, floorPlanId: string, regionId: string) => {
    const RETRY_TIMEOUT = 300000;
    return apiClient
      .post<{ region: FloorPlanRegion }>(
        `/households/${householdId}/floor-plans/${floorPlanId}/regions/${regionId}/retry`,
        undefined,
        { timeout: RETRY_TIMEOUT }
      )
      .then((res) => res.data);
  },

  // Persist user-edited areas (floors + detached_areas).
  // Used by the area editor where users rename or resize bounding boxes.
  updateAnalysis: (
    householdId: string,
    floorPlanId: string,
    data: UpdateAnalysisRequest
  ) =>
    apiClient
      .patch<AnalysisResponse>(
        `/households/${householdId}/floor-plans/${floorPlanId}/analysis`,
        data
      )
      .then((res) => res.data),

  // Vectorization — produces the semantic SVG layer used by the editor.
  // Claude Vision is slow, so we set a generous timeout matching analysis.
  triggerVectorization: (householdId: string, floorPlanId: string) => {
    const VECTORIZE_TIMEOUT = 180000;
    console.log(`[FloorPlans API] Triggering vectorization with ${VECTORIZE_TIMEOUT}ms timeout`);
    return apiClient
      .post<VectorizeResponse>(
        `/households/${householdId}/floor-plans/${floorPlanId}/vectorize`,
        undefined,
        { timeout: VECTORIZE_TIMEOUT }
      )
      .then((res) => res.data);
  },

  getVectorAssets: (householdId: string, floorPlanId: string) =>
    apiClient
      .get<FloorPlanVectorAssets>(
        `/households/${householdId}/floor-plans/${floorPlanId}/vector`
      )
      .then((res) => res.data),
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens call
 * `floorPlansApi` exactly as before; the Proxy is what makes the H11 C2 cutover
 * cost zero screen edits. See `documents/requirements/House v2/` §6, §11
 * (sub-wave C2).
 *
 * Seventeen of the 25 methods are local, and four of them carry arithmetic that
 * had to be ported rather than called: `createMarker` hit-tests the pin against
 * the household's spaces and back-fills the linked task's room, `calibrateScale`
 * is the pixels-per-unit division, and `getAnalysis` / `updateAnalysis` read and
 * write `floor_plans.ai_analysis_data`, a ledgered column, through the legacy
 * shape migration in `logic/floorPlanAnalysis.ts`. Leaving that last pair remote
 * would 404 the area editor for a household whose plan the server has never
 * seen, and silently discard every area the member had renamed.
 *
 * `remoteMethods` is EMPTY, and that is a finding rather than an oversight:
 * unlike C1 there is no Tier C surface anywhere in this feature — no catalogue,
 * no shared reference data, nothing identical across households. Every column of
 * all three tables is the member's own.
 *
 * The eight gaps are PRESENT locally as throws with member-facing copy, which is
 * what the coverage rule asks for. Three are the H6 byte transfer (a floor plan
 * IS an image), two are Claude Vision over that image, and three read
 * `floor_plan_regions`, ledgered since the H13 D-wave — a missing
 * key would send that last group to a Worker that would answer `{ regions: [] }`
 * with a 200 for a plan it has never seen, and the viewer would render a home
 * whose floors were simply never found.
 */
export const floorPlansApi: typeof remoteFloorPlansApi = createHouseLocalProxy(
  remoteFloorPlansApi,
  {
    moduleName: 'floorPlansApi',
    // Narrow require: the barrel would pull the sync orchestrator and status
    // store into every api call from every screen.
    resolveLocal: () =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@features/house/local/localFloorPlansApi').localFloorPlansApi,
  },
);

export interface UpdateAnalysisAreaInput {
  name: string;
  bounding_box: BoundingBox;
}

export interface UpdateAnalysisRequest {
  // Caller sends the fully-resolved arrays so the backend can replace them in
  // a single write. Either field may be omitted to leave that list untouched.
  floors?: UpdateAnalysisAreaInput[];
  detached_areas?: (UpdateAnalysisAreaInput & { type?: string })[];
}

interface AnalysisResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  analysis: FloorPlanAnalysis | null;
  analyzed_at?: string;
  message?: string;
  regions?: FloorPlanRegion[];
  partial_failures?: boolean;
}
