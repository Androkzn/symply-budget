import type { ClaudeProvider } from '../ai/claude-provider';
import {
  FLOOR_PLAN_ANALYSIS_SYSTEM_PROMPT,
  FLOOR_PLAN_ANALYSIS_USER_PROMPT,
  type FloorPlanAnalysisResult,
  type SpaceInfo,
  type FloorInfo,
  type DetachedAreaInfo,
  type BoundingBox,
  convertLegacyToNewFormat,
} from '../ai/prompts/analyze-floor-plan';
import {
  FLOOR_PLAN_LAYOUT_SYSTEM_PROMPT,
  FLOOR_PLAN_LAYOUT_USER_PROMPT,
  FLOOR_PLAN_REGION_SPACES_SYSTEM_PROMPT,
  buildRegionSpacesUserPrompt,
  type FloorPlanLayoutResult,
} from '../ai/prompts/detect-floor-plan-layout';
import { createAnthropicAdapterForUser } from '../ai/provider-factory';
import type { Env } from '../types';

/**
 * Helper to parse and validate bounding box coordinates
 */
function parseBoundingBox(bbox: any): BoundingBox | null {
  if (!bbox || typeof bbox !== 'object') return null;

  const x1 = parseFloat(bbox.x1);
  const y1 = parseFloat(bbox.y1);
  const x2 = parseFloat(bbox.x2);
  const y2 = parseFloat(bbox.y2);

  if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return null;
  if (x1 < 0 || x1 > 1 || y1 < 0 || y1 > 1 || x2 < 0 || x2 > 1 || y2 < 0 || y2 > 1) return null;
  if (x2 <= x1 || y2 <= y1) return null;

  return { x1, y1, x2, y2 };
}

function stripJsonFences(responseText: string): string {
  let jsonStr = responseText.trim();
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }
  return jsonStr.trim();
}

/**
 * Floor Plan Analysis Service
 * Uses Claude Vision to analyze floor plan images and extract structured data
 */
export class FloorPlanAnalysisService {
  private env: Env;
  private userId?: string | null;
  private model: string = 'claude-sonnet-4-5-20250929';

  /** `userId` bills the acting user's own Anthropic key when connected (BYOK). */
  constructor(env: Env, userId?: string | null) {
    this.env = env;
    this.userId = userId;
  }

  /**
   * Anthropic adapter bound to the acting user: their own connected BYOK key
   * when present, otherwise the SimpleHouse-managed key.
   */
  private async getProvider(): Promise<ClaudeProvider> {
    return createAnthropicAdapterForUser(
      this.env,
      this.userId,
      { feature: 'floor_plan_analysis', userId: this.userId },
      this.model
    );
  }

  /**
   * Pass 1 — detect floors / detached areas / bounding boxes only.
   */
  async detectLayout(params: {
    imageBase64: string;
    mediaType: 'image/jpeg' | 'image/png' | 'application/pdf';
  }): Promise<FloorPlanLayoutResult> {
    console.log('[FLOOR-PLAN-LAYOUT] Starting layout detection...');
    const startTime = Date.now();

    const provider = await this.getProvider();
    const { text: resultText } = await provider.generateFromMediaContent({
      systemPrompt: FLOOR_PLAN_LAYOUT_SYSTEM_PROMPT,
      userText: FLOOR_PLAN_LAYOUT_USER_PROMPT,
      media: { base64: params.imageBase64, mediaType: params.mediaType },
      maxTokens: 2048,
      model: this.model,
    });
    const result = this.parseLayoutResponse(resultText);

    console.log(`[FLOOR-PLAN-LAYOUT] Done in ${Date.now() - startTime}ms:`, {
      floors: result.floors.length,
      detached: result.detached_areas.length,
      confidence: result.metadata.confidence,
    });

    return result;
  }

  /**
   * Pass 2a — extract spaces for a single cropped region.
   */
  async analyzeRegionSpaces(params: {
    imageBase64: string;
    mediaType: 'image/jpeg' | 'image/png';
    regionName: string;
    kind: 'floor' | 'detached';
  }): Promise<SpaceInfo[]> {
    console.log(`[FLOOR-PLAN-REGION] Analyzing spaces for "${params.regionName}"...`);

    const provider = await this.getProvider();
    const { text: resultText } = await provider.generateFromMediaContent({
      systemPrompt: FLOOR_PLAN_REGION_SPACES_SYSTEM_PROMPT,
      userText: buildRegionSpacesUserPrompt(params.regionName, params.kind),
      media: { base64: params.imageBase64, mediaType: params.mediaType },
      maxTokens: 2048,
      model: this.model,
    });

    try {
      const parsed = JSON.parse(stripJsonFences(resultText));
      return (parsed.spaces || []).map((space: any) => this.parseSpace(space));
    } catch (error) {
      console.error('[FLOOR-PLAN-REGION] Failed to parse spaces:', error);
      return [];
    }
  }

  private parseLayoutResponse(responseText: string): FloorPlanLayoutResult {
    try {
      const parsed = JSON.parse(stripJsonFences(responseText));

      const floors = (parsed.floors || []).map((floor: any, idx: number) => ({
        name: floor.name || `Floor ${idx + 1}`,
        level: floor.level ?? idx,
        area: {
          value: floor.area?.value ?? null,
          unit: floor.area?.unit || null,
        },
        bounding_box: parseBoundingBox(floor.bounding_box),
      }));

      const detached_areas = (parsed.detached_areas || []).map((area: any) => ({
        name: area.name || 'Detached Area',
        type: area.type || 'other',
        area: {
          value: area.area?.value ?? null,
          unit: area.area?.unit || null,
        },
        bounding_box: parseBoundingBox(area.bounding_box),
      }));

      return {
        property_address: parsed.property_address || null,
        total_area: {
          value: parsed.total_area?.value ?? null,
          unit: parsed.total_area?.unit || null,
        },
        floors,
        detached_areas,
        excluded_from_living_area: {
          total: {
            value: parsed.excluded_from_living_area?.total?.value ?? null,
            unit: parsed.excluded_from_living_area?.total?.unit || null,
          },
          items: (parsed.excluded_from_living_area?.items || []).map((item: any) => ({
            name: typeof item === 'string' ? item : item.name || 'Unknown',
            area:
              typeof item === 'string'
                ? { value: null, unit: null }
                : {
                    value: item.area?.value ?? null,
                    unit: item.area?.unit || null,
                  },
          })),
        },
        metadata: {
          multiple_floors: parsed.metadata?.multiple_floors ?? floors.length > 1,
          floor_count: parsed.metadata?.floor_count ?? floors.length,
          detached_area_count: parsed.metadata?.detached_area_count ?? detached_areas.length,
          confidence: parsed.metadata?.confidence || 'low',
          layout_type: parsed.metadata?.layout_type || undefined,
        },
      };
    } catch (error) {
      console.error('[FLOOR-PLAN-LAYOUT] Failed to parse response:', error);
      return {
        property_address: null,
        total_area: { value: null, unit: null },
        floors: [],
        detached_areas: [],
        excluded_from_living_area: { total: { value: null, unit: null }, items: [] },
        metadata: {
          multiple_floors: false,
          floor_count: 0,
          detached_area_count: 0,
          confidence: 'low',
        },
      };
    }
  }

  /**
   * Full single-shot analysis (legacy path / fallback).
   */
  async analyzeFloorPlan(params: {
    imageBase64: string;
    mediaType: 'image/jpeg' | 'image/png' | 'application/pdf';
    filename?: string;
  }): Promise<FloorPlanAnalysisResult> {
    console.log('[FLOOR-PLAN-ANALYSIS] Starting analysis...');
    const startTime = Date.now();

    try {
      const provider = await this.getProvider();
      const { text: resultText } = await provider.generateFromMediaContent({
        systemPrompt: FLOOR_PLAN_ANALYSIS_SYSTEM_PROMPT,
        userText: FLOOR_PLAN_ANALYSIS_USER_PROMPT,
        media: { base64: params.imageBase64, mediaType: params.mediaType },
        maxTokens: 4096,
        model: this.model,
      });

      const processingTime = Date.now() - startTime;
      console.log(`[FLOOR-PLAN-ANALYSIS] Response received in ${processingTime}ms`);

      const result = this.parseAnalysisResponse(resultText);

      console.log(`[FLOOR-PLAN-ANALYSIS] Analysis complete:`, {
        floors: result.floors.length,
        detachedAreas: result.detached_areas.length,
        totalSpaces: result.metadata.total_space_count,
        totalArea: result.total_area.value,
        garageType: result.metadata.garage_type,
        confidence: result.metadata.confidence,
      });

      return result;
    } catch (error) {
      console.error('[FLOOR-PLAN-ANALYSIS] Analysis failed:', error);
      throw new Error(
        `Floor plan analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private parseAnalysisResponse(responseText: string): FloorPlanAnalysisResult {
    try {
      const parsed = JSON.parse(stripJsonFences(responseText));

      const isLegacyFormat =
        parsed.floors?.some((f: any) => f.rooms && !f.spaces) ||
        (parsed.features && parsed.features.length > 0);

      if (isLegacyFormat) {
        console.log('[FLOOR-PLAN-ANALYSIS] Detected legacy format, converting...');
        return convertLegacyToNewFormat(parsed);
      }

      const floors: FloorInfo[] = (parsed.floors || []).map((floor: any) => ({
        name: floor.name || 'Unknown Floor',
        level: floor.level ?? 0,
        area: {
          value: floor.area?.value ?? null,
          unit: floor.area?.unit || null,
        },
        bounding_box: parseBoundingBox(floor.bounding_box),
        spaces: (floor.spaces || []).map((space: any) => this.parseSpace(space)),
      }));

      const detached_areas: DetachedAreaInfo[] = (parsed.detached_areas || []).map((area: any) => ({
        name: area.name || 'Unknown Area',
        type: area.type || 'other',
        area: {
          value: area.area?.value ?? null,
          unit: area.area?.unit || null,
        },
        bounding_box: parseBoundingBox(area.bounding_box),
        spaces: (area.spaces || []).map((space: any) => this.parseSpace(space)),
      }));

      const totalSpaceCount =
        floors.reduce((sum, f) => sum + f.spaces.length, 0) +
        detached_areas.reduce((sum, d) => sum + d.spaces.length, 0);

      const hasOutdoorSpaces = floors.some((f) => f.spaces.some((s) => s.is_outdoor));
      const hasAttachedGarage = floors.some((f) => f.spaces.some((s) => s.type === 'garage'));
      const hasDetachedGarage = detached_areas.some((d) => d.type === 'detached_garage');

      return {
        property_address: parsed.property_address || null,
        total_area: {
          value: parsed.total_area?.value ?? null,
          unit: parsed.total_area?.unit || null,
        },
        floors,
        detached_areas,
        excluded_from_living_area: {
          total: {
            value: parsed.excluded_from_living_area?.total?.value ?? null,
            unit: parsed.excluded_from_living_area?.total?.unit || null,
          },
          items: (parsed.excluded_from_living_area?.items || []).map((item: any) => ({
            name: typeof item === 'string' ? item : item.name || 'Unknown',
            area:
              typeof item === 'string'
                ? { value: null, unit: null }
                : {
                    value: item.area?.value ?? null,
                    unit: item.area?.unit || null,
                  },
          })),
        },
        metadata: {
          scale_bar_detected: parsed.metadata?.scale_bar_detected ?? false,
          dimensions_labeled: parsed.metadata?.dimensions_labeled ?? false,
          space_labels_present:
            parsed.metadata?.space_labels_present ??
            parsed.metadata?.room_labels_present ??
            false,
          multiple_floors: parsed.metadata?.multiple_floors ?? floors.length > 1,
          floor_count: parsed.metadata?.floor_count ?? floors.length,
          detached_area_count: parsed.metadata?.detached_area_count ?? detached_areas.length,
          total_space_count: parsed.metadata?.total_space_count ?? totalSpaceCount,
          has_outdoor_spaces: parsed.metadata?.has_outdoor_spaces ?? hasOutdoorSpaces,
          has_garage: parsed.metadata?.has_garage ?? (hasAttachedGarage || hasDetachedGarage),
          garage_type:
            parsed.metadata?.garage_type ??
            (hasDetachedGarage ? 'detached' : hasAttachedGarage ? 'attached' : 'none'),
          confidence: parsed.metadata?.confidence || 'low',
          layout_type: parsed.metadata?.layout_type || undefined,
        },
      };
    } catch (error) {
      console.error('[FLOOR-PLAN-ANALYSIS] Failed to parse response:', error);
      console.error('[FLOOR-PLAN-ANALYSIS] Raw response:', responseText.substring(0, 500));

      return {
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
          layout_type: undefined,
        },
      };
    }
  }

  private parseSpace(space: any): SpaceInfo {
    const type = space.type || 'other';
    const outdoorTypes = ['deck', 'patio', 'porch', 'balcony', 'covered_patio'];

    return {
      name: space.name || 'Unknown Space',
      type,
      is_outdoor: space.is_outdoor ?? outdoorTypes.includes(type.toLowerCase()),
      dimensions: {
        width: space.dimensions?.width ?? null,
        length: space.dimensions?.length ?? null,
        unit: space.dimensions?.unit || null,
      },
      area: {
        value: space.area?.value ?? null,
        unit: space.area?.unit || null,
      },
      position: {
        description: space.position?.description || 'unknown',
      },
    };
  }
}
