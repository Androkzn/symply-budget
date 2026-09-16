/**
 * Sub-areas — the part of the feature that makes a wall more than one thing.
 *
 * "Half a wall painted, the other half wall panels" is the request, and the
 * shape of the answer is that a surface carries a **base material** plus any
 * number of regions that override it. The base is what is left over, not a
 * layer underneath: assigning a wainscot removes its area from the paint
 * quantity in the same breath as it adds it to the panelling one, so the two
 * always sum to the wall.
 *
 * ## Regions do not overlap, and that is enforced rather than resolved
 *
 * Two overlapping regions have no correct area. Whichever rule is picked —
 * painter's order, splitting the intersection, first-wins — a member will read
 * the quantities off the screen and order materials against it, and any of
 * those rules is a plausible-looking number that is wrong for the other one.
 * So `validateSubArea` refuses the overlap at draw time, where the member can
 * see what they just did, instead of the takeoff inventing a convention later.
 *
 * ## Splitting is the primary gesture, drawing is the fallback
 *
 * Every finish boundary members actually describe is a straight line across a
 * surface — chair rail, wainscot cap, tile-to-paint, a change of flooring at a
 * doorway. `splitRegion` is therefore the operation the UI leads with, and it
 * is exact: the two pieces are the clip of the parent by one line, so they
 * cover it precisely with no gap and no overlap. Free-drawing a polygon is
 * available for the rest, and goes through the same validator.
 */

import type { Opening, SubArea, Surface, Vec2 } from '../room-surface-model';

import { newSurfaceId } from './derive';
import {
  EPS_M,
  ensureCounterClockwise,
  isSimplePolygon,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonContainsPolygon,
  polygonsOverlap,
  rectPolygon,
  round4,
  simplifyPolygon,
  splitPolygonByLine,
} from './geometry';

/** Below this a region is a drawing accident, not an intent. m². */
export const MIN_SUB_AREA_M2 = 0.01;

export type SubAreaRejection =
  | 'too_few_points'
  | 'self_intersecting'
  | 'too_small'
  | 'outside_surface'
  | 'overlaps_existing';

export interface SubAreaValidation {
  ok: boolean;
  code?: SubAreaRejection;
  /** Member-facing, and specific — a rejection nobody can act on is a bug. */
  message?: string;
  /** For `overlaps_existing`: which region it collided with. */
  conflictId?: string;
}

/**
 * Is this outline a legal region of this surface?
 *
 * `ignoreId` exists for editing: a region being dragged must not be tested
 * against its own previous self, or every move of a region that touches another
 * one is rejected on arrival.
 */
export function validateSubArea(
  surface: Surface,
  outline: readonly Vec2[],
  ignoreId?: string
): SubAreaValidation {
  const candidate = simplifyPolygon(outline);
  if (candidate.length < 3) {
    return { ok: false, code: 'too_few_points', message: 'An area needs at least three corners.' };
  }
  if (!isSimplePolygon(candidate)) {
    return {
      ok: false,
      code: 'self_intersecting',
      message: 'This shape crosses itself. Untangle it and try again.',
    };
  }
  if (polygonArea(candidate) < MIN_SUB_AREA_M2) {
    return { ok: false, code: 'too_small', message: 'That area is too small to finish.' };
  }
  if (!polygonContainsPolygon(surface.outline, candidate)) {
    return {
      ok: false,
      code: 'outside_surface',
      message: `That area goes outside the ${surface.label.toLowerCase()}.`,
    };
  }
  for (const existing of surface.subAreas) {
    if (existing.id === ignoreId) continue;
    if (polygonsOverlap(existing.outline, candidate)) {
      return {
        ok: false,
        code: 'overlaps_existing',
        conflictId: existing.id,
        message: `That overlaps "${existing.label}". Areas can touch but not overlap.`,
      };
    }
  }
  return { ok: true };
}

function nextSortOrder(surface: Surface): number {
  return surface.subAreas.reduce((max, area) => Math.max(max, area.sortOrder), -1) + 1;
}

export function makeSubArea(
  surface: Surface,
  outline: readonly Vec2[],
  label: string,
  materialId: string | null = null
): SubArea {
  return {
    id: newSurfaceId('sa'),
    label,
    outline: ensureCounterClockwise(simplifyPolygon(outline)),
    materialId,
    sortOrder: nextSortOrder(surface),
  };
}

export function addSubArea(surface: Surface, subArea: SubArea): Surface {
  return { ...surface, subAreas: [...surface.subAreas, subArea] };
}

export function removeSubArea(surface: Surface, subAreaId: string): Surface {
  return { ...surface, subAreas: surface.subAreas.filter((area) => area.id !== subAreaId) };
}

export function updateSubArea(
  surface: Surface,
  subAreaId: string,
  patch: Partial<Omit<SubArea, 'id'>>
): Surface {
  return {
    ...surface,
    subAreas: surface.subAreas.map((area) =>
      area.id === subAreaId ? { ...area, ...patch } : area
    ),
  };
}

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

export type SplitAxis = 'horizontal' | 'vertical';

export interface SplitResult {
  ok: boolean;
  surface: Surface;
  /** The two regions produced, low piece first. Empty when the split missed. */
  createdIds: string[];
  message?: string;
}

/**
 * Cut a surface — or one of its regions — in two along a straight line.
 *
 * `at` is a coordinate in the surface's own frame: a height above the floor for
 * a horizontal cut on a wall, a distance along the run for a vertical one. That
 * is what the member is typing ("panelling to 1.1 m"), so it is what the API
 * takes; converting from a dragged handle is the caller's job and is one
 * division.
 *
 * Splitting the **surface** (`regionId` omitted) is only offered when it has no
 * regions yet, and produces two that cover it completely. Splitting a
 * **region** replaces it with its two halves. Both go through the same clip, so
 * the pieces meet exactly on the line — `polygonsOverlap` returns false for
 * shapes that merely touch, which is why the result validates.
 */
export function splitRegion(
  surface: Surface,
  axis: SplitAxis,
  at: number,
  options?: { regionId?: string; lowLabel?: string; highLabel?: string; keepMaterial?: boolean }
): SplitResult {
  const regionId = options?.regionId;
  const region = regionId ? surface.subAreas.find((area) => area.id === regionId) : undefined;
  if (regionId && !region) {
    return { ok: false, surface, createdIds: [], message: 'That area no longer exists.' };
  }
  if (!regionId && surface.subAreas.length > 0) {
    return {
      ok: false,
      surface,
      createdIds: [],
      message: 'This surface is already split. Split one of its areas instead.',
    };
  }

  const source = region ? region.outline : surface.outline;
  const bounds = polygonBounds(source);
  const min = axis === 'horizontal' ? bounds.minY : bounds.minX;
  const max = axis === 'horizontal' ? bounds.maxY : bounds.maxX;
  if (at <= min + EPS_M || at >= max - EPS_M) {
    return {
      ok: false,
      surface,
      createdIds: [],
      message: `Pick a point between ${round4(min)} m and ${round4(max)} m.`,
    };
  }

  const { low, high } = splitPolygonByLine(source, axis === 'horizontal' ? 'y' : 'x', at);
  if (low.length < 3 || high.length < 3) {
    return { ok: false, surface, createdIds: [], message: 'That line does not cross the area.' };
  }

  const inheritedMaterial =
    options?.keepMaterial === false ? null : region ? region.materialId : surface.materialId;
  const [lowLabel, highLabel] = defaultSplitLabels(axis, options, region?.label);

  const base: Surface = region ? removeSubArea(surface, region.id) : surface;
  const lowArea = makeSubArea(base, low, lowLabel, inheritedMaterial);
  const withLow = addSubArea(base, lowArea);
  const highArea = makeSubArea(withLow, high, highLabel, inheritedMaterial);

  return {
    ok: true,
    surface: addSubArea(withLow, highArea),
    createdIds: [lowArea.id, highArea.id],
  };
}

function defaultSplitLabels(
  axis: SplitAxis,
  options: { lowLabel?: string; highLabel?: string } | undefined,
  parentLabel?: string
): [string, string] {
  if (options?.lowLabel && options?.highLabel) return [options.lowLabel, options.highLabel];
  const prefix = parentLabel ? `${parentLabel} — ` : '';
  return axis === 'horizontal'
    ? [options?.lowLabel ?? `${prefix}Lower`, options?.highLabel ?? `${prefix}Upper`]
    : [options?.lowLabel ?? `${prefix}Left`, options?.highLabel ?? `${prefix}Right`];
}

/**
 * A rectangular region, in surface coordinates, clamped to the surface.
 *
 * The clamp is to the bounding box rather than the polygon, so on a
 * non-rectangular surface the result can still poke out — and is then rejected
 * by `validateSubArea` with a message that says so. That is the right split of
 * responsibilities: this function makes the shape the member asked for, the
 * validator says whether it fits.
 */
export function makeRectSubArea(
  surface: Surface,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  materialId: string | null = null
): SubArea {
  const bounds = polygonBounds(surface.outline);
  const clampedX = Math.max(bounds.minX, Math.min(x, bounds.maxX - EPS_M));
  const clampedY = Math.max(bounds.minY, Math.min(y, bounds.maxY - EPS_M));
  const clampedW = Math.max(EPS_M, Math.min(width, bounds.maxX - clampedX));
  const clampedH = Math.max(EPS_M, Math.min(height, bounds.maxY - clampedY));
  return makeSubArea(
    surface,
    rectPolygon(clampedX, clampedY, clampedW, clampedH),
    label,
    materialId
  );
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

export interface Region {
  /** `null` for the surface's own leftover area. */
  subAreaId: string | null;
  label: string;
  outline: Vec2[];
  materialId: string | null;
  /** Gross polygon area, m². */
  grossM2: number;
  /** Gross minus the openings that deduct from it, m². Never below zero. */
  netM2: number;
  /** The openings charged to this region. */
  openings: Opening[];
}

/**
 * Which region does an opening belong to?
 *
 * By its **centre**, not by overlap. A window that straddles the wainscot line
 * has to be deducted from exactly one region or the two deductions double-count
 * it, and splitting the opening rectangle across the boundary would be exact
 * arithmetic in service of a distinction no trade makes. The centre rule is
 * stable, explainable in one sentence, and wrong by at most half a window on a
 * shape members do not build.
 */
export function openingCentre(opening: Opening): Vec2 {
  return [opening.x + opening.width / 2, opening.y + opening.height / 2];
}

/**
 * Break a surface into the regions a takeoff and a renderer both need: every
 * sub-area, plus whatever the base material is left with.
 *
 * The base region's **outline** is the whole surface — SVG draws it first and
 * the sub-areas paint over it, which is exactly right visually — while its
 * **area** has the sub-areas subtracted. Those two facts disagreeing is
 * deliberate and is the only place in the model where they do: it is what lets
 * the renderer stay simple (no polygon differencing on device) while the
 * quantities stay exact.
 */
export function regionsOf(surface: Surface): Region[] {
  const deducting = surface.openings.filter((o) => o.deducts);
  const claimed = new Set<string>();

  const subRegions: Region[] = [...surface.subAreas]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((area) => {
      const gross = polygonArea(area.outline);
      const inside = deducting.filter((opening) => {
        if (claimed.has(opening.id)) return false;
        if (!pointInPolygon(openingCentre(opening), area.outline)) return false;
        claimed.add(opening.id);
        return true;
      });
      const deduction = inside.reduce((sum, o) => sum + o.width * o.height, 0);
      return {
        subAreaId: area.id,
        label: area.label,
        outline: area.outline,
        materialId: area.materialId,
        grossM2: round4(gross),
        netM2: round4(Math.max(0, gross - deduction)),
        openings: inside,
      };
    });

  const surfaceGross = polygonArea(surface.outline);
  const subGross = subRegions.reduce((sum, region) => sum + region.grossM2, 0);
  const baseOpenings = deducting.filter((opening) => !claimed.has(opening.id));
  const baseDeduction = baseOpenings.reduce((sum, o) => sum + o.width * o.height, 0);
  const baseGross = Math.max(0, surfaceGross - subGross);

  const base: Region = {
    subAreaId: null,
    label: surface.subAreas.length > 0 ? `${surface.label} (rest)` : surface.label,
    outline: surface.outline,
    materialId: surface.materialId,
    grossM2: round4(baseGross),
    netM2: round4(Math.max(0, baseGross - baseDeduction)),
    openings: baseOpenings,
  };

  // Base first: the renderer paints in array order and the base is the
  // background. A takeoff that filters this list does not care about order.
  return [base, ...subRegions];
}

/** Gross area of a surface, m² — the outline, ignoring openings and regions. */
export function surfaceGrossArea(surface: Surface): number {
  return round4(polygonArea(surface.outline));
}

/** Net finished area of a surface, m² — every region's net, summed. */
export function surfaceNetArea(surface: Surface): number {
  return round4(regionsOf(surface).reduce((sum, region) => sum + region.netM2, 0));
}
