import { and, desc, eq, inArray, gt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';
import {
  GARDEN_PLAN_BOUNDARY_SOURCES,
  GARDEN_PLAN_TYPES,
  gardenPlanBoundaryDrafts,
  type GardenPlanBoundarySource,
  type GardenPlanType,
} from '../db/schema-garden-plans';
import type { Database, Env } from '../types';
import {
  formatAddressForGeocoding,
  MAP_PREVIEW_REMOVED,
  type GeoJsonPolygonGeometry,
  type NormalizedAddress,
} from '../types/geo';
import { NotFoundError, ValidationError } from '../utils/errors';
import { now as nowIso } from '../utils/id';

import { createVectorGardenPlanFromBoundary } from './ai/garden-plan-generation-service';
import { buildDiagramPromptFromStructuredInput } from './ai/tools/aihousekeeper/garden-site-plan-tool';
import { HouseholdService } from './household-service';

export interface BoundaryDraftResponse {
  id: string;
  status: string;
  address: NormalizedAddress;
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

export interface CreateBoundaryDraftInput {
  address?: Partial<NormalizedAddress>;
}

export interface ConfirmBoundaryInput {
  boundary_geojson: GeoJsonPolygonGeometry;
  boundary_source: GardenPlanBoundarySource;
}

export interface GenerateFromBoundaryInput {
  plan_type: GardenPlanType;
  area_label: string;
  vibe: string;
  must_haves?: string[];
  notes?: string | null;
  boundary_measurements?: {
    unit: 'feet' | 'meters';
    width: number;
    depth: number;
    area: number;
  };
}

export interface BoundaryDraftsListResponse {
  boundary_drafts: BoundaryDraftResponse[];
}

export class GardenPlanBoundaryService {
  private readonly db: Database;
  private readonly householdService: HouseholdService;

  constructor(private readonly env: Env, d1: D1Database) {
    this.db = drizzle(d1, { schema }) as unknown as Database;
    this.householdService = new HouseholdService(env, d1);
  }

  async createDraft(
    householdId: string,
    userId: string,
    input: CreateBoundaryDraftInput
  ): Promise<{ boundary_draft: BoundaryDraftResponse }> {
    const household = await this.householdService.getHousehold(householdId, userId);
    const address = normalizeAddress(input.address ?? household);
    const formattedAddress = formatAddressForGeocoding(address);
    if (!formattedAddress) {
      throw new ValidationError({ address: ['address_required'] });
    }

    throw new Error(MAP_PREVIEW_REMOVED);
  }

  async confirmBoundary(
    householdId: string,
    userId: string,
    draftId: string,
    input: ConfirmBoundaryInput
  ): Promise<{ boundary_draft: BoundaryDraftResponse }> {
    if (!GARDEN_PLAN_BOUNDARY_SOURCES.includes(input.boundary_source)) {
      throw new ValidationError({ boundary_source: ['invalid_boundary_source'] });
    }
    assertPolygonGeometry(input.boundary_geojson);
    await this.getInternal(draftId, householdId, userId);
    throw new Error(MAP_PREVIEW_REMOVED);
  }

  async getDraft(
    householdId: string,
    userId: string,
    draftId: string
  ): Promise<{ boundary_draft: BoundaryDraftResponse }> {
    const row = await this.getInternal(draftId, householdId, userId);
    return { boundary_draft: this.toResponse(row) };
  }

  async listPendingDrafts(
    householdId: string,
    userId: string
  ): Promise<BoundaryDraftsListResponse> {
    const rows = await this.db
      .select()
      .from(gardenPlanBoundaryDrafts)
      .where(
        and(
          eq(gardenPlanBoundaryDrafts.household_id, householdId),
          eq(gardenPlanBoundaryDrafts.user_id, userId),
          inArray(gardenPlanBoundaryDrafts.status, ['draft', 'confirmed']),
          gt(gardenPlanBoundaryDrafts.expires_at, nowIso())
        )
      )
      .orderBy(desc(gardenPlanBoundaryDrafts.updated_at))
      .limit(10);

    return { boundary_drafts: rows.map((row) => this.toResponse(row)) };
  }

  async deleteDraft(householdId: string, userId: string, draftId: string): Promise<void> {
    const row = await this.getInternal(draftId, householdId, userId);
    if (row.status !== 'draft' && row.status !== 'confirmed') {
      throw new NotFoundError('Garden plan boundary draft');
    }
    await this.db.delete(gardenPlanBoundaryDrafts).where(eq(gardenPlanBoundaryDrafts.id, row.id));
  }

  async generateFromBoundary(
    householdId: string,
    userId: string,
    draftId: string,
    input: GenerateFromBoundaryInput
  ): Promise<{ garden_plan_id: string; queued: boolean }> {
    const row = await this.getInternal(draftId, householdId, userId);
    if (row.status !== 'confirmed' || !row.confirmed_geojson) {
      throw new ValidationError({ boundary: ['boundary_not_confirmed'] });
    }
    if (!GARDEN_PLAN_TYPES.includes(input.plan_type)) {
      throw new ValidationError({ plan_type: ['invalid_plan_type'] });
    }
    const confirmedBoundary = parseJson<GeoJsonPolygonGeometry>(row.confirmed_geojson);
    console.log('[GardenPlanBoundaryService] generateFromBoundary:start', {
      householdId,
      userId,
      draftId,
      status: row.status,
      source: row.boundary_source,
      referenceImageKey: row.reference_image_key,
      geocodePlaceName: row.geocode_place_name,
      geometry: confirmedBoundary ? summarizeBoundaryGeometry(confirmedBoundary) : null,
      input: {
        planType: input.plan_type,
        areaLabel: input.area_label,
        vibe: input.vibe,
        mustHaveCount: input.must_haves?.length ?? 0,
        hasNotes: Boolean(input.notes),
        boundaryMeasurements: input.boundary_measurements ?? null,
      },
    });

    const diagramPrompt = buildDiagramPromptFromStructuredInput({
      plan_type: input.plan_type,
      area_label: input.area_label,
      vibe: input.vibe,
      must_haves: input.must_haves ?? [],
      notes: input.notes ?? null,
      boundary_measurements: input.boundary_measurements,
    });
    console.log('[GardenPlanBoundaryService] generateFromBoundary:promptBuilt', {
      householdId,
      userId,
      draftId,
      promptLength: diagramPrompt.length,
      promptPreview: diagramPrompt.slice(0, 240),
    });

    const result = await createVectorGardenPlanFromBoundary(this.env, {
      householdId,
      userId,
      diagramPrompt,
      planType: input.plan_type,
      areaLabel: input.area_label,
      referenceImageR2Key: row.reference_image_key,
      boundaryDraftId: row.id,
      boundarySource: row.boundary_source,
      boundaryGeojson: row.confirmed_geojson,
      geocodePlaceName: row.geocode_place_name,
    });
    console.log('[GardenPlanBoundaryService] generateFromBoundary:createdVector', {
      householdId,
      userId,
      draftId,
      gardenPlanId: result.gardenPlanId,
      referenceImageKey: row.reference_image_key,
      boundarySource: row.boundary_source,
    });

    await this.db
      .update(gardenPlanBoundaryDrafts)
      .set({ status: 'generated', updated_at: nowIso() })
      .where(eq(gardenPlanBoundaryDrafts.id, row.id));
    console.log('[GardenPlanBoundaryService] generateFromBoundary:draftUpdated', {
      householdId,
      userId,
      draftId,
      status: 'generated',
      gardenPlanId: result.gardenPlanId,
    });

    return { garden_plan_id: result.gardenPlanId, queued: result.queued };
  }

  private async getInternal(id: string, householdId: string, userId: string) {
    const row = await this.db
      .select()
      .from(gardenPlanBoundaryDrafts)
      .where(
        and(
          eq(gardenPlanBoundaryDrafts.id, id),
          eq(gardenPlanBoundaryDrafts.household_id, householdId),
          eq(gardenPlanBoundaryDrafts.user_id, userId)
        )
      )
      .get();
    if (!row) throw new NotFoundError('Garden plan boundary draft');
    return row;
  }

  private toResponse(row: typeof gardenPlanBoundaryDrafts.$inferSelect): BoundaryDraftResponse {
    const address = parseJson<NormalizedAddress>(row.address_json) ?? {
      address_line1: row.formatted_address,
    };
    const confirmed = parseJson<GeoJsonPolygonGeometry>(row.confirmed_geojson);
    return {
      id: row.id,
      status: row.status,
      address,
      formatted_address: row.formatted_address,
      geocode:
        row.geocode_lat != null && row.geocode_lon != null
          ? {
              lat: row.geocode_lat,
              lon: row.geocode_lon,
              place_name: row.geocode_place_name ?? row.formatted_address,
            }
          : null,
      parcel: null,
      confirmed_boundary: confirmed,
      boundary_source: (row.boundary_source as GardenPlanBoundarySource | null) ?? null,
      preview_image_key: row.preview_image_key,
      preview_image_url: row.preview_image_key
        ? `${this.env.API_URL}/files/${row.preview_image_key}`
        : null,
      reference_image_key: row.reference_image_key,
      expires_at: row.expires_at,
    };
  }
}

function normalizeAddress(input: Partial<NormalizedAddress>): NormalizedAddress {
  return {
    address_line1: normalizeString(input.address_line1),
    address_line2: normalizeString(input.address_line2),
    city: normalizeString(input.city),
    state_province: normalizeString(input.state_province),
    postal_code: normalizeString(input.postal_code),
    country: normalizeString(input.country) ?? 'US',
  };
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

type BoundaryLatLng = { latitude: number; longitude: number };

function summarizeBoundaryGeometry(geometry: GeoJsonPolygonGeometry) {
  const rings = ringsFromGeometry(geometry);
  const coordinates = rings.flat();
  return {
    type: geometry.type,
    ringCount: rings.length,
    coordinateCount: coordinates.length,
    closed: rings.every(isClosedRing),
    bbox: coordinates.length > 0 ? summarizeCoordinateBBox(coordinates) : null,
    approxAreaSqM: roundNumber(
      rings.reduce((sum, ring) => sum + areaSquareMeters(ring), 0),
      2
    ),
    firstRing: rings[0]?.map(summarizeCoordinate) ?? [],
  };
}

function ringsFromGeometry(geometry: GeoJsonPolygonGeometry): BoundaryLatLng[][] {
  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates as unknown[];
    return rings.map(ringFromUnknown).filter((ring) => ring.length > 0);
  }

  const polygons = geometry.coordinates as unknown[];
  return polygons.flatMap((polygon) =>
    Array.isArray(polygon)
      ? polygon.map(ringFromUnknown).filter((ring) => ring.length > 0)
      : []
  );
}

function ringFromUnknown(value: unknown): BoundaryLatLng[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((coord) => {
      if (!Array.isArray(coord)) return null;
      const lon = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { latitude: lat, longitude: lon };
    })
    .filter((coord): coord is BoundaryLatLng => coord !== null);
}

function summarizeCoordinate(coordinate: BoundaryLatLng) {
  return {
    lat: roundNumber(coordinate.latitude, 6),
    lon: roundNumber(coordinate.longitude, 6),
  };
}

function summarizeCoordinateBBox(coordinates: BoundaryLatLng[]) {
  const lats = coordinates.map((coord) => coord.latitude);
  const lons = coordinates.map((coord) => coord.longitude);
  return {
    minLon: roundNumber(Math.min(...lons), 6),
    minLat: roundNumber(Math.min(...lats), 6),
    maxLon: roundNumber(Math.max(...lons), 6),
    maxLat: roundNumber(Math.max(...lats), 6),
  };
}

function isClosedRing(ring: BoundaryLatLng[]) {
  if (ring.length < 2) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first.latitude === last.latitude && first.longitude === last.longitude;
}

function areaSquareMeters(coordinates: BoundaryLatLng[]): number {
  if (coordinates.length < 3) return 0;
  const averageLatitude =
    coordinates.reduce((sum, coord) => sum + coord.latitude, 0) / coordinates.length;
  const metersPerDegree = 111320;
  const xScale = metersPerDegree * Math.cos((averageLatitude * Math.PI) / 180);
  const projected = coordinates.map((coord) => ({
    x: coord.longitude * xScale,
    y: coord.latitude * metersPerDegree,
  }));
  const area = projected.reduce((sum, point, index) => {
    const next = projected[(index + 1) % projected.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  return Math.abs(area) / 2;
}

function roundNumber(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function assertPolygonGeometry(geometry: GeoJsonPolygonGeometry): void {
  if (
    !geometry ||
    (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') ||
    !Array.isArray(geometry.coordinates)
  ) {
    throw new ValidationError({ boundary_geojson: ['invalid_boundary_geojson'] });
  }
}

