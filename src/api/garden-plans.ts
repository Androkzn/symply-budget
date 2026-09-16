import type { GardenPlanObject } from '@models/garden-objects';

import { createHouseLocalProxy } from '@features/house/local/localApiProxy';
import { useAuthStore } from '@stores/authStore';

import { apiClient } from './client';
import { putUploadViaXhr } from './e2ePutUpload';

export type GardenPlanType = 'front_yard' | 'back_yard' | 'garden' | 'bed' | 'other_outdoor';
export type GardenPlanBoundarySource = 'user_adjusted' | 'user_drawn';
export type GardenPlanMeasurementUnit = 'feet' | 'meters';

export type GardenPlanStatus =
  | 'pending_upload'
  | 'uploaded'
  | 'generating'
  | 'completed'
  | 'failed';
export type GardenPlanContentType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/svg+xml'
  // A plan DRAWN on the map rather than uploaded. It has no bytes at all — the
  // satellite imagery is the background and the geometry is the plan — so this
  // is the honest value for a row whose `original_file_key` is empty. It is
  // deliberately NOT accepted by the upload endpoint's own enum: you can hold
  // this content type, you cannot upload one.
  | 'application/geo+json';

/** Does this plan's picture come from the map rather than an uploaded file? */
export const MAP_PLAN_CONTENT_TYPE = 'application/geo+json';

export function isMapDrawnPlan(plan: Pick<GardenPlan, 'content_type'>): boolean {
  return plan.content_type === MAP_PLAN_CONTENT_TYPE;
}

export interface GardenPlan {
  id: string;
  household_id: string;
  plan_type: GardenPlanType;
  original_file_key: string;
  display_image_key: string | null;
  thumbnail_key: string | null;
  filename: string;
  file_size: number;
  content_type: GardenPlanContentType;
  label: string | null;
  width_px: number | null;
  height_px: number | null;
  status: GardenPlanStatus;
  error_message: string | null;
  reference_image_source?: string | null;
  boundary_draft_id?: string | null;
  boundary_source?: GardenPlanBoundarySource | null;
  boundary_geojson?: string | null;
  geocode_place_name?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface GardenPlanAddressInput {
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

export interface GeoJsonPolygonGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: unknown;
}

export interface GardenPlanBoundaryMeasurements {
  unit: GardenPlanMeasurementUnit;
  width: number;
  depth: number;
  area: number;
}

export interface GardenPlanBoundaryDraft {
  id: string;
  status: string;
  address: GardenPlanAddressInput;
  formatted_address: string;
  geocode: {
    lat: number;
    lon: number;
    place_name: string;
    confidence?: string;
  } | null;
  parcel: null;
  confirmed_boundary: GeoJsonPolygonGeometry | null;
  boundary_source: GardenPlanBoundarySource | null;
  preview_image_key: string | null;
  preview_image_url: string | null;
  reference_image_key: string | null;
  expires_at: string;
}

export interface GardenPlanMarker {
  id: string;
  garden_plan_id: string;
  x_percent: number;
  y_percent: number;
  linked_entity_type: 'task';
  linked_entity_id: string;
  marker_color: string;
  marker_icon: string;
  label: string | null;
  show_label: boolean;
  space_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface UploadUrlRequest {
  filename: string;
  file_size: number;
  content_type: GardenPlanContentType;
  plan_type?: GardenPlanType;
  label?: string;
}

interface UploadUrlResponse {
  garden_plan_id: string;
  upload_url: string;
  expires_at: string;
}

interface ConfirmUploadRequest {
  plan_type?: GardenPlanType;
  label?: string;
}

interface UpdateRequest {
  plan_type?: GardenPlanType;
  label?: string;
}

/** A site plan handed to the model, for it to read back as geometry. */
export interface AnalyzePlanImageRequest {
  /** Raw base64, no `data:` prefix. JPEG/PNG/WebP — the bytes decide, not this. */
  image_base64: string;
  /** Advisory. The Worker sniffs the magic bytes and ignores a lying extension. */
  media_type?: string | null;
  /**
   * Preset ids this build can resolve, sent so the catalogue has exactly one
   * home. See `GARDEN_OBJECT_PRESETS` — the Worker constrains the model to this
   * list and drops anything outside it.
   */
  element_vocabulary: string[];
  hint?: string | null;
}

export interface AnalyzedPlanPoint {
  x: number;
  y: number;
}

export interface AnalyzedPlanZone {
  kind: string;
  label: string | null;
  polygon: AnalyzedPlanPoint[];
  confidence: number | null;
}

export interface AnalyzedPlanElement {
  preset: string;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  confidence: number | null;
}

/**
 * The draft, in coordinates normalized `0..1` over the SUBMITTED IMAGE, y down.
 *
 * Not geographic, and deliberately so: a model asked to georeference a scanned
 * survey answers confidently and wrongly, and a yard plan wrong by a street
 * pins every task in a neighbour's garden. The caller fits this onto the lot the
 * member traced on their own map — see `fitAnalyzedPlanToLot`.
 */
export interface AnalyzedPlanDraft {
  plan_kind: string | null;
  lot_polygon: AnalyzedPlanPoint[] | null;
  zones: AnalyzedPlanZone[];
  elements: AnalyzedPlanElement[];
  north_heading_degrees: number | null;
  notes: string | null;
}

interface AnalyzePlanImageResponse {
  draft: AnalyzedPlanDraft;
}

/**
 * The map wizard's save — a whole plan, in one call.
 *
 * Deliberately not three calls (`create`, then `updateBoundary`, then
 * `replaceObjects`). On the ledger each would be a separate op, and a peer that
 * synced between the first and the third would hold a lot with no areas in it
 * and no way to know more was coming. One op means a plan is never partially
 * real on any device.
 */
export interface CreateMapPlanRequest {
  plan_type: GardenPlanType;
  label?: string | null;
  boundary_geojson: GeoJsonPolygonGeometry;
  /**
   * How the lot line was arrived at. `user_drawn` for a boundary traced from
   * scratch on the map; `user_adjusted` when the member started from a shape
   * something else proposed (the seeded rectangle counts as drawn — they moved
   * every corner — but an AI-drafted outline they corrected does not).
   */
  boundary_source?: GardenPlanBoundarySource;
  /**
   * Zones AND elements together — they are one table and one save. Order is
   * preserved into `sort_order`, so zones sent first render under the elements
   * that sit on them.
   */
  objects?: GardenPlanObject[];
  /**
   * The reverse-geocoded name of the lot's centre, if the device's geocoder
   * produced one. Never sent for a local-first household: it is derived from the
   * home's address, and `localGardenPlansApi` writes it to the ledger without it
   * ever crossing the network.
   */
  geocode_place_name?: string | null;
}

interface CreateMarkerRequest {
  x_percent: number;
  y_percent: number;
  linked_entity_type: 'task';
  linked_entity_id: string;
  marker_color?: string;
  marker_icon?: string;
  label?: string;
  show_label?: boolean;
  space_id?: string;
}

interface UpdateMarkerRequest {
  x_percent?: number;
  y_percent?: number;
  marker_color?: string;
  marker_icon?: string;
  label?: string;
  show_label?: boolean;
  space_id?: string;
}

interface GardenPlansListResponse {
  garden_plans: GardenPlan[];
  next_cursor?: string;
}

interface BoundaryDraftsListResponse {
  boundary_drafts: GardenPlanBoundaryDraft[];
}

interface GardenPlanResponse {
  garden_plan: GardenPlan;
}

interface BoundaryDraftResponse {
  boundary_draft: GardenPlanBoundaryDraft;
}

interface GenerateFromBoundaryResponse {
  garden_plan_id: string;
  queued: boolean;
}

interface MarkersListResponse {
  markers: GardenPlanMarker[];
}

interface MarkerResponse {
  marker: GardenPlanMarker;
}

interface GardenObjectsResponse {
  objects: GardenPlanObject[];
}

const remoteGardenPlansApi = {
  getUploadUrl: (householdId: string, data: UploadUrlRequest) =>
    apiClient
      .post<UploadUrlResponse>(`/households/${householdId}/garden-plans/upload-url`, data)
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
      label: 'garden-plan',
      onProgress,
    });
  },

  confirmUpload: (householdId: string, gardenPlanId: string, data: ConfirmUploadRequest) =>
    apiClient
      .post<GardenPlanResponse>(
        `/households/${householdId}/garden-plans/${gardenPlanId}/confirm-upload`,
        data
      )
      .then((res) => res.data),

  analyzePlanImage: (householdId: string, data: AnalyzePlanImageRequest) =>
    apiClient
      .post<AnalyzePlanImageResponse>(
        `/households/${householdId}/garden-plans/analyze-plan-image`,
        data
      )
      .then((res) => res.data),

  createMapPlan: (householdId: string, data: CreateMapPlanRequest) =>
    apiClient
      .post<GardenPlanResponse>(`/households/${householdId}/garden-plans/map-plan`, data)
      .then((res) => res.data),

  list: (householdId: string, filters?: { limit?: number; cursor?: string }) =>
    apiClient
      .get<GardenPlansListResponse>(`/households/${householdId}/garden-plans`, { params: filters })
      .then((res) => res.data),

  createBoundaryDraft: (householdId: string, data: { address?: GardenPlanAddressInput }) =>
    apiClient
      .post<BoundaryDraftResponse>(`/households/${householdId}/garden-plans/boundary-drafts`, data)
      .then((res) => res.data),

  getBoundaryDraft: (householdId: string, draftId: string) =>
    apiClient
      .get<BoundaryDraftResponse>(
        `/households/${householdId}/garden-plans/boundary-drafts/${draftId}`
      )
      .then((res) => res.data),

  listBoundaryDrafts: (householdId: string) =>
    apiClient
      .get<BoundaryDraftsListResponse>(
        `/households/${householdId}/garden-plans/boundary-drafts`
      )
      .then((res) => res.data),

  deleteBoundaryDraft: (householdId: string, draftId: string) =>
    apiClient
      .delete(`/households/${householdId}/garden-plans/boundary-drafts/${draftId}`)
      .then((res) => res.data),

  confirmBoundaryDraft: (
    householdId: string,
    draftId: string,
    data: {
      boundary_geojson: GeoJsonPolygonGeometry;
      boundary_source: GardenPlanBoundarySource;
    }
  ) =>
    apiClient
      .patch<BoundaryDraftResponse>(
        `/households/${householdId}/garden-plans/boundary-drafts/${draftId}/boundary`,
        data
      )
      .then((res) => res.data),

  generateFromBoundaryDraft: (
    householdId: string,
    draftId: string,
    data: {
      plan_type: GardenPlanType;
      area_label: string;
      vibe: string;
      must_haves?: string[];
      notes?: string | null;
      boundary_measurements?: GardenPlanBoundaryMeasurements;
    }
  ) =>
    apiClient
      .post<GenerateFromBoundaryResponse>(
        `/households/${householdId}/garden-plans/boundary-drafts/${draftId}/generate`,
        data
      )
      .then((res) => res.data),

  get: (householdId: string, gardenPlanId: string) =>
    apiClient
      .get<GardenPlanResponse>(`/households/${householdId}/garden-plans/${gardenPlanId}`)
      .then((res) => res.data),

  update: (householdId: string, gardenPlanId: string, data: UpdateRequest) =>
    apiClient
      .patch<GardenPlanResponse>(
        `/households/${householdId}/garden-plans/${gardenPlanId}`,
        data
      )
      .then((res) => res.data),

  updateBoundary: (
    householdId: string,
    gardenPlanId: string,
    data: {
      boundary_geojson: GeoJsonPolygonGeometry;
      boundary_source: GardenPlanBoundarySource;
    }
  ) =>
    apiClient
      .patch<GardenPlanResponse>(
        `/households/${householdId}/garden-plans/${gardenPlanId}/boundary`,
        data
      )
      .then((res) => res.data),

  delete: (householdId: string, gardenPlanId: string) =>
    apiClient
      .delete(`/households/${householdId}/garden-plans/${gardenPlanId}`)
      .then((res) => res.data),

  cancelGeneration: (householdId: string, gardenPlanId: string) =>
    apiClient
      .post<GardenPlanResponse>(
        `/households/${householdId}/garden-plans/${gardenPlanId}/cancel`
      )
      .then((res) => res.data),

  retryGeneration: (householdId: string, gardenPlanId: string) =>
    apiClient
      .post<GardenPlanResponse>(
        `/households/${householdId}/garden-plans/${gardenPlanId}/retry`
      )
      .then((res) => res.data),

  listObjects: (householdId: string, gardenPlanId: string) =>
    apiClient
      .get<GardenObjectsResponse>(
        `/households/${householdId}/garden-plans/${gardenPlanId}/objects`
      )
      .then((res) => res.data),

  replaceObjects: (
    householdId: string,
    gardenPlanId: string,
    vectorObjects: GardenPlanObject[]
  ) =>
    apiClient
      .put<GardenObjectsResponse>(
        `/households/${householdId}/garden-plans/${gardenPlanId}/objects`,
        { vector_objects: vectorObjects }
      )
      .then((res) => res.data),

  listMarkers: (householdId: string, gardenPlanId: string) =>
    apiClient
      .get<MarkersListResponse>(
        `/households/${householdId}/garden-plans/${gardenPlanId}/markers`
      )
      .then((res) => res.data),

  getMarkersForEntity: (
    householdId: string,
    entityType: 'task',
    entityId: string
  ) =>
    apiClient
      .get<MarkersListResponse>(
        `/households/${householdId}/garden-plans/markers/for-entity/${entityType}/${entityId}`
      )
      .then((res) => res.data),

  createMarker: (householdId: string, gardenPlanId: string, data: CreateMarkerRequest) =>
    apiClient
      .post<MarkerResponse>(
        `/households/${householdId}/garden-plans/${gardenPlanId}/markers`,
        data
      )
      .then((res) => res.data),

  updateMarker: (householdId: string, markerId: string, data: UpdateMarkerRequest) =>
    apiClient
      .patch<MarkerResponse>(
        `/households/${householdId}/garden-plans/markers/${markerId}`,
        data
      )
      .then((res) => res.data),

  deleteMarker: (householdId: string, markerId: string) =>
    apiClient
      .delete(`/households/${householdId}/garden-plans/markers/${markerId}`)
      .then((res) => res.data),
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens call
 * `gardenPlansApi` exactly as before; the Proxy is what makes the H11 C3 cutover
 * cost zero screen edits. See `documents/requirements/House v2/` §6, §11
 * (sub-wave C3).
 *
 * Fifteen of the 23 methods are local. Four of them do real work rather than
 * relaying a row: `replaceObjects` runs the service's clamping (ported into
 * `logic/gardenPlanObjects.ts`, and deliberately NOT the near-identical
 * normaliser in `@models/garden-objects`, which clamps to a different rule),
 * `listObjects` sorts on a column the DTO does not carry, `listBoundaryDrafts`
 * applies five separate filters over ledgered rows, and `updateBoundary` writes
 * the in-app boundary editor's save. Leaving that last pair remote would answer
 * an empty pending list and a 404 to a member looking at their own garden.
 *
 * There is no Tier C surface anywhere in this feature — no catalogue, no
 * template set, nothing identical across households. Every column of all four
 * tables is the member's own, so `remoteMethods` names exactly one method and
 * it is not a table read at all (see the proxy options below).
 *
 * The eight gaps are PRESENT locally as throws with member-facing copy. Three
 * are the H6 byte transfer (a yard plan IS a photo), three are the image model
 * and the queued job around it, and two are the SATELLITE BOUNDARY FLOW — which
 * is retired for every household rather than merely off in private mode. Those
 * last two are still local throws rather than remote-only declarations because
 * `createBoundaryDraft` posts the household's street address, and routing it to
 * the Worker would leak a local-first home's address in exchange for a 410.
 *
 * `createMapPlan` is what closed the hole those three H6 throws left behind.
 * Until it existed, `getUploadUrl` was the ONLY place a `garden_plans` row was
 * created, so a local-first household could not make a yard plan by any route
 * and every local method here operated on a table that could never acquire a
 * first row. A map-drawn plan has no bytes, so it needs no bucket; it is local,
 * and it is the creation path that actually runs in House.
 */
export const gardenPlansApi: typeof remoteGardenPlansApi = createHouseLocalProxy(
  remoteGardenPlansApi,
  {
    moduleName: 'gardenPlansApi',
    /**
     * Remote BY DESIGN, and the one method here that is.
     *
     * `analyzePlanImage` needs the model, the provider key and the member's
     * image, none of which exist on device. It is worth stating the local-first
     * objection plainly rather than waving it through: these ARE bytes leaving a
     * sealed household's device, which is the thing H6 exists to prevent. Three
     * properties make it a different act from an attachment upload, and they are
     * the same three that let `homeProjectsApi.generateSmartProjectPlan` route
     * remote:
     *
     *  - the member has just chosen an AI feature whose entire purpose is to
     *    show this plan to a model, so the bytes reach a third party either way;
     *  - it STORES NOTHING. The image arrives inline as base64 and is never
     *    written to R2, so unlike the Smart Project photo path there is not even
     *    a transient bucket key to clean up. The Worker reads it and forgets it;
     *  - what comes back is a DRAFT the caller saves through `createMapPlan`,
     *    which is local — so the finished plan lands in the ledger and the
     *    server keeps no copy of the yard it just described.
     *
     * The home's ADDRESS still never leaves the device. The coordinates come
     * from the lot the member traced on their own map; this call only ever sees
     * a picture they chose to hand over.
     */
    remoteMethods: ['analyzePlanImage'],
    // Narrow require: the barrel would pull the sync orchestrator and status
    // store into every api call from every screen.
    resolveLocal: () =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@features/house/local/localGardenPlansApi').localGardenPlansApi,
  },
);

export function gardenPlanDisplayLabel(plan: Pick<GardenPlan, 'label' | 'plan_type'>): string {
  if (plan.label?.trim()) return plan.label.trim();
  switch (plan.plan_type) {
    case 'front_yard': return 'Front Yard';
    case 'back_yard': return 'Back Yard';
    case 'garden': return 'Garden';
    case 'bed': return 'Garden Bed';
    case 'other_outdoor': return 'Outdoor Area';
    default: return 'Yard Plan';
  }
}

export function gardenPlanProvenanceLabel(
  plan: Pick<GardenPlan, 'boundary_source' | 'reference_image_source' | 'content_type'>
): string {
  // Checked FIRST, because a map-drawn plan also carries a `boundary_source` and
  // would otherwise be labelled "AI-traced" — telling a member a model drew the
  // outline they dragged corner by corner themselves.
  if (plan.content_type === MAP_PLAN_CONTENT_TYPE) return 'Drawn on the map';
  if (plan.boundary_source) return 'AI-traced from confirmed plot';
  if (plan.reference_image_source === 'user_attachment') return 'AI-traced from your photo';
  if (plan.reference_image_source === 'mapbox_satellite') return 'AI-traced from satellite';
  return 'Stylized concept';
}
