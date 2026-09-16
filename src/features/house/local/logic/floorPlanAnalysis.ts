/**
 * Floor-plan analysis arithmetic — the part of the AI feature that is NOT AI
 * (H11 C2).
 *
 * Ported from `backend/src/ai/prompts/analyze-floor-plan.ts`
 * (`convertLegacyToNewFormat`, and the legacy-detection predicate that
 * `floor-plan-service.ts` repeats at four call sites) and from the merge half of
 * `FloorPlanService.updateAnalysisAreas` — keep in sync.
 *
 * WHY THE CLIENT NEEDS THIS AT ALL (plan §6)
 * ------------------------------------------
 * Three of `floorPlansApi`'s methods look like AI and are not. `getAnalysis`,
 * `list` and `get` all read `floor_plans.ai_analysis_data` — a ledgered column —
 * and hand it back after a shape migration. `updateAnalysis` writes that same
 * column from the area editor, where a member renames "Floor 1" to "Upstairs" or
 * drags a bounding box. None of the four runs a model, reaches R2, or looks
 * anything up; every one of them is a pure function of a row the device already
 * holds.
 *
 * Leaving them remote is the C1 failure again and worse. A local-first
 * household's floor plan does not exist server-side at all, so `getAnalysis`
 * would 404 where the device holds the full analysis — or, for a household
 * mid-migration, answer with the analysis as it stood before the cutover and
 * silently discard every area the member has renamed since. `updateAnalysis`
 * remote would be the true disaster: the member's rename would 404 or land on a
 * stale server row, and the local one would never be written at all.
 *
 * WHY THE LEGACY CONVERSION IS NOT DEAD CODE
 * ------------------------------------------
 * It is tempting to drop it — the device cannot RUN an analysis (that is a P4
 * throw), so where would a legacy one come from? From the same place C1's
 * pre-cutover `task_id`s come from: a household that used Symply before it went
 * local-first arrives with `ai_analysis_data` already written, and rows written
 * by the older prompt carry `floors[].rooms` instead of `floors[].spaces` plus a
 * flat `features` array. `FloorPlanViewer` renders `spaces`, so a legacy row
 * displays as a plan with no rooms on it — complete-looking and wrong, which is
 * the same class of failure as a marker outside a read window.
 *
 * The Worker converts on READ and never writes the result back (see
 * `getFloorPlan`, which returns a converted copy and leaves the row alone), so
 * the conversion is idempotent and stays a read-time concern here too.
 *
 * ONE SHAPE NOTE
 * --------------
 * The backend's `FloorPlanAnalysisResult` and the client's `FloorPlanAnalysis`
 * are the same shape under two names, so this module speaks the CLIENT's types
 * throughout — that is the type the screens read and the type `tsc` checks.
 */
import type {
  DetachedAreaInfo,
  ExcludedAreaItem,
  FeatureInfo,
  FloorInfo,
  FloorPlanAnalysis,
  RoomInfo,
  SpaceInfo,
  UpdateAnalysisRequest,
} from '@api/floor-plans';

/**
 * A stored analysis in the OLD shape: `floors[].rooms` rather than
 * `floors[].spaces`, a flat `features` array, and `excluded_areas` whose items
 * are bare strings.
 *
 * Declared structurally rather than imported because the client has no name for
 * it — `RoomInfo` and `FeatureInfo` are exported from `src/api/floor-plans.ts`
 * as "legacy types for backward compatibility" and the enclosing shape is not.
 */
export type LegacyFloorPlanAnalysis = {
  property_address: string | null;
  total_area: { value: number | null; unit: 'sq_ft' | 'sq_m' | null };
  floors: {
    name: string;
    level: number;
    area: { value: number | null; unit: 'sq_ft' | 'sq_m' | null };
    rooms: RoomInfo[];
  }[];
  features?: FeatureInfo[];
  excluded_areas?: {
    total: { value: number | null; unit: 'sq_ft' | 'sq_m' | null };
    items: string[];
  };
  metadata?: Record<string, unknown>;
};

/** Space types the old prompt treated as outdoor. Verbatim from the Worker. */
const OUTDOOR_SPACE_TYPES = ['deck', 'patio', 'porch', 'balcony', 'covered_patio'];

/** Feature types that belong ON a floor rather than beside the building. */
const ATTACHED_FEATURE_TYPES = [
  'deck',
  'patio',
  'porch',
  'balcony',
  'covered_patio',
  'garage',
  'attached_garage',
];

/** Feature types that are their own structure. */
const DETACHED_STRUCTURE_TYPES = [
  'shed',
  'workshop',
  'greenhouse',
  'guest_house',
  'pool_house',
  'carport',
  'detached_garage',
  'storage',
];

/**
 * The Worker's own legacy test, which it repeats verbatim in `listFloorPlans`,
 * `getFloorPlan` and `getAnalysis`.
 *
 * Two independent signals, either of which is enough: a floor that has `rooms`
 * and no `spaces`, or a non-empty `features` array. Note it is `f.rooms &&
 * !f.spaces` rather than `!f.spaces` alone — a NEW analysis with an empty
 * `floors` array must not be converted, because converting it would replace a
 * populated `detached_areas` with `[]`.
 */
export function isLegacyFloorPlanAnalysis(analysis: unknown): boolean {
  if (!analysis || typeof analysis !== 'object') return false;
  const candidate = analysis as {
    floors?: { rooms?: unknown; spaces?: unknown }[];
    features?: unknown[];
  };
  const floorsAreLegacy = Array.isArray(candidate.floors)
    ? candidate.floors.some((floor) => !!floor?.rooms && !floor?.spaces)
    : false;
  const hasFeatures = Array.isArray(candidate.features) && candidate.features.length > 0;
  return floorsAreLegacy || hasFeatures;
}

/**
 * Migrate a legacy analysis to the current shape.
 *
 * Ported line for line from `convertLegacyToNewFormat`, including the two
 * behaviours that look like bugs and are load-bearing:
 *
 *  - **An attached feature is skipped when a space of the same name already
 *    exists on the target floor.** The comparison is case-insensitive and the
 *    check is by NAME only, so a "Garage" feature is dropped when the floor
 *    already lists a "garage" space. Removing the guard would double-count the
 *    garage in `total_space_count`.
 *  - **The target floor is `level === 0`, falling back to the FIRST floor.**
 *    Not "the lowest level" — a plan whose only floor is level 2 gets the
 *    attached deck on level 2, which is what the Worker does.
 *
 * `garage_type` is derived, not read: `detached` if any detached area is a
 * `detached_garage`, otherwise `attached` if any floor holds a `garage` space,
 * otherwise `none`. The legacy `metadata.has_garage` is carried across
 * separately and the two can disagree — that is the server's behaviour and a
 * household that migrated online must not see a different answer here.
 */
export function convertLegacyFloorPlanAnalysis(
  legacy: LegacyFloorPlanAnalysis,
): FloorPlanAnalysis {
  const metadata = (legacy.metadata ?? {}) as Record<string, unknown>;
  const flag = (key: string): boolean | undefined => {
    const value = metadata[key];
    return typeof value === 'boolean' ? value : undefined;
  };

  const floors: FloorInfo[] = (legacy.floors ?? []).map((floor) => ({
    name: floor.name,
    level: floor.level,
    area: floor.area,
    // The legacy prompt produced no bounding boxes, so there is nothing to
    // recover here. `null` is what the area editor renders as "not placed".
    bounding_box: null,
    spaces: (floor.rooms ?? []).map((room) => ({
      name: room.name,
      type: room.type,
      is_outdoor: OUTDOOR_SPACE_TYPES.includes(room.type.toLowerCase()),
      dimensions: room.dimensions,
      area: room.area,
      position: room.position,
    })),
  }));

  const detachedAreas: DetachedAreaInfo[] = [];
  for (const feature of legacy.features ?? []) {
    const featureType = feature.type.toLowerCase();
    const isDetached =
      feature.location?.toLowerCase().includes('detached') ||
      DETACHED_STRUCTURE_TYPES.includes(featureType);

    if (isDetached) {
      detachedAreas.push({
        name: feature.name,
        type: featureType === 'garage' ? 'detached_garage' : feature.type,
        area: feature.area,
        bounding_box: null,
        spaces: [
          {
            name: feature.name,
            type: feature.type,
            is_outdoor: false,
            dimensions: { width: null, length: null, unit: null },
            area: feature.area,
            position: { description: 'main' },
          },
        ],
      });
      continue;
    }

    if (!ATTACHED_FEATURE_TYPES.includes(featureType)) continue;

    const targetFloor = floors.find((f) => f.level === 0) ?? floors[0];
    if (!targetFloor) continue;
    const exists = targetFloor.spaces.some(
      (space) => space.name.toLowerCase() === feature.name.toLowerCase(),
    );
    if (exists) continue;

    const attached: SpaceInfo = {
      name: feature.name,
      type: featureType === 'attached_garage' ? 'garage' : feature.type,
      is_outdoor: OUTDOOR_SPACE_TYPES.includes(featureType),
      dimensions: { width: null, length: null, unit: null },
      area: feature.area,
      position: { description: feature.location || 'attached' },
    };
    targetFloor.spaces.push(attached);
  }

  const excludedItems: ExcludedAreaItem[] = (legacy.excluded_areas?.items ?? []).map((name) => ({
    name,
    area: { value: null, unit: null },
  }));

  return {
    property_address: legacy.property_address,
    total_area: legacy.total_area,
    floors,
    detached_areas: detachedAreas,
    excluded_from_living_area: {
      total: legacy.excluded_areas?.total || { value: null, unit: null },
      items: excludedItems,
    },
    metadata: {
      scale_bar_detected: flag('scale_bar_detected') ?? false,
      dimensions_labeled: flag('dimensions_labeled') ?? false,
      // The old prompt called this `room_labels_present`; the new one calls it
      // `space_labels_present`. Both are read, old name first, exactly as the
      // Worker does — a legacy row only ever has the old one.
      space_labels_present: flag('room_labels_present') ?? flag('space_labels_present') ?? false,
      multiple_floors: flag('multiple_floors') ?? false,
      floor_count:
        typeof metadata.floor_count === 'number' ? metadata.floor_count : floors.length,
      detached_area_count: detachedAreas.length,
      total_space_count:
        floors.reduce((sum, f) => sum + f.spaces.length, 0) +
        detachedAreas.reduce((sum, d) => sum + d.spaces.length, 0),
      has_outdoor_spaces:
        floors.some((f) => f.spaces.some((s) => s.is_outdoor)) ||
        (flag('has_outdoor_areas') ?? false),
      has_garage: flag('has_garage') ?? false,
      garage_type: detachedAreas.some((d) => d.type === 'detached_garage')
        ? 'detached'
        : floors.some((f) => f.spaces.some((s) => s.type === 'garage'))
          ? 'attached'
          : 'none',
      confidence:
        metadata.confidence === 'high' || metadata.confidence === 'medium'
          ? metadata.confidence
          : 'low',
    },
  };
}

/** The shape `updateAnalysisAreas` starts from when a plan has never been analysed. */
export function emptyFloorPlanAnalysis(): FloorPlanAnalysis {
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
    },
  };
}

/**
 * Apply the area editor's edit to a stored analysis — `updateAnalysisAreas`
 * without the Tier-D region re-sync.
 *
 * The merge rule is BY INDEX, not by name, and that is the whole of it: the
 * caller sends the fully-resolved list, entry `i` of the new list inherits
 * `level`, `area`, `spaces` and `type` from entry `i` of the old one, and the
 * name and bounding box come from the caller. So a rename keeps the rooms, a
 * reorder moves them, and an insertion in the middle shifts every room down one
 * floor. That last one is the server's behaviour and reproducing it is the
 * point: an editor that behaved differently offline would produce a different
 * plan for the same drag.
 *
 * A missing `floors` (or `detached_areas`) means "leave that list alone", which
 * is why each half is guarded rather than defaulted to `[]`.
 *
 * `metadata.floor_count`, `detached_area_count` and `multiple_floors` are
 * recomputed here because the Worker recomputes them; `total_space_count` is
 * NOT, because the Worker does not — the edit changes no space, so the count
 * cannot have moved. Do not "fix" that asymmetry.
 */
export function applyAnalysisAreaEdit(
  existing: FloorPlanAnalysis,
  data: UpdateAnalysisRequest,
): FloorPlanAnalysis {
  const next: FloorPlanAnalysis = { ...existing };

  if (data.floors) {
    next.floors = data.floors.map((incoming, index) => {
      const previous = existing.floors?.[index];
      return {
        name: incoming.name,
        // `?? index` and not `?? 0`: a plan whose second floor is new gets
        // level 1, which is what keeps the area editor's ordering stable.
        level: previous?.level ?? index,
        area: previous?.area ?? { value: null, unit: null },
        bounding_box: incoming.bounding_box,
        spaces: previous?.spaces ?? [],
      };
    });
  }

  if (data.detached_areas) {
    next.detached_areas = data.detached_areas.map((incoming, index) => {
      const previous = existing.detached_areas?.[index];
      return {
        name: incoming.name,
        type: incoming.type ?? previous?.type ?? 'other',
        area: previous?.area ?? { value: null, unit: null },
        bounding_box: incoming.bounding_box,
        spaces: previous?.spaces ?? [],
      };
    });
  }

  next.metadata = {
    ...next.metadata,
    floor_count: next.floors?.length ?? 0,
    detached_area_count: next.detached_areas?.length ?? 0,
    multiple_floors: (next.floors?.length ?? 0) > 1,
  };

  return next;
}
