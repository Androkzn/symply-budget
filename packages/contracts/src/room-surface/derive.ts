/**
 * Building a Room Surface Model, and keeping it in step with its floor plan.
 *
 * Three jobs live here, and they are together because they all answer the same
 * question — *what surfaces does this room have?* — from three different inputs:
 * a shape the member picked, a plan they then edited, and a v1 geometry payload
 * written by an older build.
 *
 * ## Walls are derived, and derivation must not destroy work
 *
 * A room's walls are not drawn. There is one per edge of the floor plan, its
 * run is that edge's length and its height is the room's, and that is true the
 * moment the plan exists — which is what makes the feature usable in ten
 * seconds instead of ten minutes. The cost is that the plan can change *after*
 * the member has spent real time on a wall: cut a gable into it, split it into
 * a wainscot and a paint band, assign a tile.
 *
 * `reconcileSurfaces` is the whole answer to that, and its rules are:
 *
 *  - a wall is matched to its plan edge by `planEdge`, never by index in the
 *    array and never by label — both change when a member inserts a corner;
 *  - a wall whose outline the member has edited carries `outlineLocked`, and is
 *    **never re-shaped**. It is reported as stale instead, so the UI can offer
 *    the choice rather than take it;
 *  - an unlocked wall is re-shaped to the new run, and its sub-areas are
 *    re-scaled along `x` with it, so a wainscot that ran the length of a wall
 *    still does after the wall grows;
 *  - a wall whose edge no longer exists is **kept and flagged orphaned**, not
 *    deleted. Deleting it would throw away materials and sub-areas on the
 *    strength of a drag the member may be about to undo.
 */

import {
  OPENING_DEDUCTS_BY_DEFAULT,
  ROOM_SURFACE_SCHEMA_VERSION,
  type Material,
  type Opening,
  type OpeningType,
  type RoomSurfaceModel,
  type SubArea,
  type Surface,
  type Vec2,
  parseLegacyGeometryPayload,
  type LegacyGeometryPayload,
} from '../room-surface-model';

import {
  distance,
  edgeCompassPoint,
  ensureCounterClockwise,
  normalizeToOrigin,
  polygonArea,
  polygonCentroid,
  rectPolygon,
  round4,
  simplifyPolygon,
} from './geometry';

/** Fallback ceiling height when nothing better is known, metres. */
export const DEFAULT_WALL_HEIGHT_M = 2.4;

/** What a brand-new project's room starts as, metres. */
export const DEFAULT_ROOM_WIDTH_M = 3.6;
export const DEFAULT_ROOM_DEPTH_M = 3;

/**
 * Document-local ids.
 *
 * These name parts of one JSON value, not rows: nothing joins to them across
 * tables, no index depends on them, and the whole document is written as a
 * unit under last-writer-wins. So the requirement is uniqueness *within one
 * document*, and the reason they are random rather than sequential is a
 * different one — two members editing offline both append a sub-area, and
 * sequential ids would give both the same name for two different regions, so
 * the surviving document would carry a duplicate that the renderer's keys and
 * the takeoff's grouping would both mis-handle.
 *
 * `newSurfaceId` is deliberately NOT `newLocalId`: that lives in the local-first
 * tree, captures `globalThis.crypto` through @noble at module load, and pulling
 * it in here would make a pure geometry module drag the ledger into every
 * screen that renders a swatch.
 */
let idCounter = 0;
export function newSurfaceId(prefix: string): string {
  idCounter = (idCounter + 1) % 0xffff;
  const random = Math.floor(Math.random() * 0xffffff).toString(36);
  const seq = idCounter.toString(36);
  return `${prefix}_${random}${seq}`;
}

// ---------------------------------------------------------------------------
// Room shape presets
// ---------------------------------------------------------------------------

export type RoomShapeKey = 'rectangle' | 'l_shape' | 't_shape' | 'u_shape';

/** The dimensions of a shape, keyed by `RoomShapeParamSpec.key`, in metres. */
export type RoomShapeParams = Record<string, number>;

export interface RoomShapeParamSpec {
  key: string;
  /** As the member reads it — "Alcove width", not "notchX". */
  label: string;
  /** Seeded from the overall size when the shape is first chosen. */
  seed: (width: number, depth: number) => number;
  min: (params: RoomShapeParams) => number;
  max: (params: RoomShapeParams) => number;
  /**
   * Indices into `build()`'s edge list whose LENGTH this parameter governs.
   *
   * The starter highlights them on the plan while the member edits the value,
   * which is the only way "alcove width" means anything on a shape with eight
   * walls. They are fixed indices because each preset emits its vertices in a
   * fixed order — an invariant `roomShapeParams.test.ts` pins, since a
   * reordered `build()` would silently highlight the wrong wall.
   *
   * Only the edges this parameter is *about*. Widening a T also nudges the two
   * shoulder edges, but lighting up half the room would say nothing.
   */
  edges: number[];
}

export interface RoomShapePreset {
  key: RoomShapeKey;
  label: string;
  description: string;
  /**
   * Always width and depth first, then whatever else the shape needs.
   *
   * **A starter-only concept.** Once the room exists it is a free polygon that
   * members edit by dragging corners, and nothing stores these numbers — a
   * parameter list that survived into the document would have to be kept in
   * step with a shape it can no longer describe the moment a corner moves.
   */
  params: RoomShapeParamSpec[];
  build: (params: RoomShapeParams) => Vec2[];
}

/** The smallest a notch, alcove or arm may be, metres. */
const MIN_FEATURE_M = 0.2;

const widthParam: RoomShapeParamSpec = {
  key: 'width',
  label: 'Width',
  seed: (width) => width,
  min: () => 0.5,
  max: () => 30,
  edges: [0],
};

const depthParam: RoomShapeParamSpec = {
  key: 'depth',
  label: 'Depth',
  seed: (_width, depth) => depth,
  min: () => 0.5,
  max: () => 30,
  edges: [1],
};

/**
 * The four shapes members actually start from.
 *
 * The research is unanimous on this — every plan tool worth using offers
 * presets and then lets you drag corners, because drawing a room vertex by
 * vertex on a phone is miserable and produces a shape that is nearly but not
 * quite square. A preset lands ortho-aligned and dimensioned in one tap, and
 * the corner drag is then a correction rather than a construction.
 *
 * Every shape past the rectangle carries its own extra dimensions, because
 * width × depth does not describe it: an L with a 2 m bite and an L with a
 * 0.4 m bite are different rooms with the same bounding box, and seeding the
 * notch at a third of the extent — as this used to — was a guess the member
 * then had to undo by dragging.
 */
export const ROOM_SHAPE_PRESETS: RoomShapePreset[] = [
  {
    key: 'rectangle',
    label: 'Rectangle',
    description: 'Four walls, square corners',
    params: [
      { ...widthParam, edges: [0, 2] },
      { ...depthParam, edges: [1, 3] },
    ],
    build: ({ width, depth }) => rectPolygon(0, 0, width, depth),
  },
  {
    key: 'l_shape',
    label: 'L-shape',
    description: 'Six walls — a room with one corner taken out',
    params: [
      widthParam,
      { ...depthParam, edges: [5] },
      {
        key: 'notchWidth',
        label: 'Cut-out width',
        seed: (width) => round4(width / 3),
        min: () => MIN_FEATURE_M,
        max: (p) => Math.max(MIN_FEATURE_M, p.width - MIN_FEATURE_M),
        edges: [2],
      },
      {
        key: 'notchDepth',
        label: 'Cut-out depth',
        seed: (_width, depth) => round4(depth / 3),
        min: () => MIN_FEATURE_M,
        max: (p) => Math.max(MIN_FEATURE_M, p.depth - MIN_FEATURE_M),
        edges: [3],
      },
    ],
    build: ({ width: w, depth: d, notchWidth, notchDepth }) => {
      const nx = Math.min(notchWidth, w - MIN_FEATURE_M);
      const ny = Math.min(notchDepth, d - MIN_FEATURE_M);
      return [
        [0, 0],
        [w, 0],
        [w, round4(d - ny)],
        [round4(w - nx), round4(d - ny)],
        [round4(w - nx), d],
        [0, d],
      ];
    },
  },
  {
    key: 't_shape',
    label: 'T-shape',
    description: 'Eight walls — a room with an alcove',
    /**
     * The bar is at the TOP and the stem hangs below it, so the shape reads as
     * a T on screen.
     *
     * Worth stating because the model is `+y` up and the renderer flips it, so
     * building the bar at `y = 0` — which looks like the natural way to write
     * it — draws a ⊥. Nothing downstream cares (a room is a room, and members
     * drag the corners anyway), but the preset is picked from a picture of
     * itself and a shape that does not match its own name is the kind of thing
     * that makes a member distrust everything else on the screen.
     */
    params: [
      { ...widthParam, edges: [6] },
      { ...depthParam, edges: [1, 3] },
      {
        key: 'barDepth',
        label: 'Top band depth',
        seed: (_width, depth) => round4(depth / 3),
        min: () => MIN_FEATURE_M,
        max: (p) => Math.max(MIN_FEATURE_M, p.depth - MIN_FEATURE_M),
        edges: [5, 7],
      },
      {
        key: 'stemWidth',
        label: 'Alcove width',
        seed: (width) => round4(width / 3),
        min: () => MIN_FEATURE_M,
        max: (p) => Math.max(MIN_FEATURE_M, p.width - MIN_FEATURE_M * 2),
        edges: [2],
      },
    ],
    build: ({ width: w, depth: d, barDepth, stemWidth }) => {
      const bar = Math.min(barDepth, d - MIN_FEATURE_M);
      const stem = Math.min(stemWidth, w - MIN_FEATURE_M * 2);
      const armX = round4((w - stem) / 2);
      const barY = round4(d - bar);
      return [
        [0, barY],
        [armX, barY],
        [armX, 0],
        [round4(w - armX), 0],
        [round4(w - armX), barY],
        [w, barY],
        [w, d],
        [0, d],
      ];
    },
  },
  {
    key: 'u_shape',
    label: 'U-shape',
    description: 'Eight walls — a room wrapping a central block',
    params: [
      widthParam,
      { ...depthParam, edges: [1, 7] },
      {
        key: 'notchWidth',
        label: 'Centre block width',
        seed: (width) => round4(width / 3),
        min: () => MIN_FEATURE_M,
        max: (p) => Math.max(MIN_FEATURE_M, p.width - MIN_FEATURE_M * 2),
        edges: [4],
      },
      {
        key: 'notchDepth',
        label: 'Centre block depth',
        seed: (_width, depth) => round4(depth / 2),
        min: () => MIN_FEATURE_M,
        max: (p) => Math.max(MIN_FEATURE_M, p.depth - MIN_FEATURE_M),
        edges: [3, 5],
      },
    ],
    build: ({ width: w, depth: d, notchWidth, notchDepth }) => {
      const gap = Math.min(notchWidth, w - MIN_FEATURE_M * 2);
      const cut = Math.min(notchDepth, d - MIN_FEATURE_M);
      const armX = round4((w - gap) / 2);
      const notch = round4(d - cut);
      return [
        [0, 0],
        [w, 0],
        [w, d],
        [round4(w - armX), d],
        [round4(w - armX), notch],
        [armX, notch],
        [armX, d],
        [0, d],
      ];
    },
  },
];

export function roomShapePreset(key: RoomShapeKey): RoomShapePreset {
  return ROOM_SHAPE_PRESETS.find((preset) => preset.key === key) ?? ROOM_SHAPE_PRESETS[0];
}

/**
 * Starting values for a shape's dimensions.
 *
 * Used when the member first picks a shape, and when they switch shapes — the
 * width and depth they already entered carry across, so changing your mind
 * about an L does not throw away the two numbers you measured.
 */
export function seedShapeParams(
  preset: RoomShapePreset,
  width: number,
  depth: number,
  carryOver?: RoomShapeParams
): RoomShapeParams {
  const params: RoomShapeParams = {};
  for (const spec of preset.params) {
    const carried = carryOver?.[spec.key];
    params[spec.key] = carried !== undefined ? carried : round4(spec.seed(width, depth));
  }
  // Seeds are fractions of the overall size, so they are always legal — but a
  // carried-over value may not be (a 2 m alcove in a room narrowed to 1.5 m).
  // Clamping here means `build()` never has to defend itself against its own
  // parameters, and the field shows the corrected number rather than drawing a
  // shape that disagrees with it.
  return clampShapeParams(preset, params);
}

/** Pull every dimension inside the bounds its spec declares, in order. */
export function clampShapeParams(
  preset: RoomShapePreset,
  params: RoomShapeParams
): RoomShapeParams {
  const out: RoomShapeParams = { ...params };
  for (const spec of preset.params) {
    const value = out[spec.key] ?? round4(spec.seed(out.width ?? 1, out.depth ?? 1));
    out[spec.key] = round4(Math.min(spec.max(out), Math.max(spec.min(out), value)));
  }
  return out;
}

/** The outline for a shape at these dimensions, clamped and normalised. */
export function buildShapeOutline(
  preset: RoomShapePreset,
  params: RoomShapeParams
): Vec2[] {
  return preset.build(clampShapeParams(preset, params));
}

// ---------------------------------------------------------------------------
// Surface construction
// ---------------------------------------------------------------------------

/**
 * The wall standing on plan edge `index`.
 *
 * Wall-local coordinates are the unfolded-elevation convention: `+x` runs along
 * the wall and `+y` runs up from the floor, so a plain wall is
 * `run × height` and anything else — a gable, a stairwell rake, a dormer
 * cheek — is a polygon in the same frame with no special case anywhere else in
 * the system.
 */
export function deriveWall(
  outline: readonly Vec2[],
  index: number,
  height: number,
  existingId?: string
): Surface {
  const a = outline[index];
  const b = outline[(index + 1) % outline.length];
  const run = round4(distance(a, b));
  const compass = edgeCompassPoint(a, b, polygonCentroid(outline));
  return {
    id: existingId ?? newSurfaceId('sf'),
    kind: 'wall',
    label: `${compass} wall`,
    outline: rectPolygon(0, 0, run, height),
    openings: [],
    subAreas: [],
    materialId: null,
    planEdge: index,
    run_m: run,
    height_m: round4(height),
  };
}

export function deriveFloor(outline: readonly Vec2[], existingId?: string): Surface {
  const normalized = normalizeToOrigin(ensureCounterClockwise(outline));
  return {
    id: existingId ?? newSurfaceId('sf'),
    kind: 'floor',
    label: 'Floor',
    outline: normalized,
    openings: [],
    subAreas: [],
    materialId: null,
  };
}

/**
 * The ceiling, which is the floor polygon again.
 *
 * Not mirrored. A drafting-correct reflected ceiling plan flips left for right,
 * and doing that here would mean a member who taps "Ceiling" after "Floor" sees
 * the same room backwards with no explanation — a correctness the audience for
 * this feature has not asked for and would read as a bug. The area, which is
 * what the takeoff uses, is identical either way.
 */
export function deriveCeiling(outline: readonly Vec2[], existingId?: string): Surface {
  const normalized = normalizeToOrigin(ensureCounterClockwise(outline));
  return {
    id: existingId ?? newSurfaceId('sf'),
    kind: 'ceiling',
    label: 'Ceiling',
    outline: normalized,
    openings: [],
    subAreas: [],
    materialId: null,
  };
}

export function createOpening(
  type: OpeningType,
  x: number,
  y: number,
  width: number,
  height: number,
  label?: string
): Opening {
  return {
    id: newSurfaceId('op'),
    type,
    ...(label ? { label } : {}),
    x: round4(x),
    y: round4(y),
    width: round4(width),
    height: round4(height),
    deducts: OPENING_DEDUCTS_BY_DEFAULT[type],
  };
}

/**
 * A fresh model for a room.
 *
 * The plan polygon is normalised — counter-clockwise, bounding box at the
 * origin, redundant vertices dropped — *before* anything is derived from it, so
 * that a preset and a hand-drawn shape produce the same kind of document and
 * `planEdge` indices mean the same thing in both.
 */
export function createRoomSurfaceModel(input: {
  outline: readonly Vec2[];
  wallHeight_m?: number;
  label?: string;
  origin?: string;
  materials?: Material[];
}): RoomSurfaceModel {
  const outline = normalizeToOrigin(ensureCounterClockwise(simplifyPolygon(input.outline)));
  const height = round4(input.wallHeight_m ?? DEFAULT_WALL_HEIGHT_M);
  const walls = outline.map((_, index) => deriveWall(outline, index, height));
  return {
    schema_version: ROOM_SURFACE_SCHEMA_VERSION,
    units: 'm',
    room: {
      outline,
      wallHeight_m: height,
      ...(input.label ? { label: input.label } : {}),
    },
    surfaces: [deriveFloor(outline), deriveCeiling(outline), ...walls],
    materials: input.materials ?? [],
    source_meta: {
      captured_at: new Date().toISOString(),
      origin: input.origin ?? 'manual',
    },
  };
}

/** A default room for a project that has no geometry at all yet. */
export function createDefaultRoomSurfaceModel(): RoomSurfaceModel {
  return createRoomSurfaceModel({
    outline: rectPolygon(0, 0, DEFAULT_ROOM_WIDTH_M, DEFAULT_ROOM_DEPTH_M),
    origin: 'manual',
  });
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  model: RoomSurfaceModel;
  /** Walls the member has hand-edited whose plan edge changed length. */
  staleWallIds: string[];
  /** Walls whose plan edge no longer exists. Kept, not deleted. */
  orphanedWallIds: string[];
}

/**
 * Bring the surfaces back in step with the plan after the plan was edited.
 *
 * See this module's header for the four rules. The one worth restating is that
 * **nothing is deleted**: a member who drags a corner to merge two walls has
 * probably not decided that the tile they picked for one of them was a mistake,
 * and an editor that silently throws away work on a gesture is an editor
 * members stop trusting with anything real.
 */
export function reconcileSurfaces(model: RoomSurfaceModel): ReconcileResult {
  const outline = model.room.outline;
  const height = model.room.wallHeight_m;
  const staleWallIds: string[] = [];
  const orphanedWallIds: string[] = [];

  const floor = model.surfaces.find((s) => s.kind === 'floor');
  const ceiling = model.surfaces.find((s) => s.kind === 'ceiling');
  const walls = model.surfaces.filter((s) => s.kind === 'wall');
  const normalized = normalizeToOrigin(ensureCounterClockwise(outline));

  const nextFloor = floor?.outlineLocked
    ? floor
    : { ...(floor ?? deriveFloor(normalized)), outline: normalized };
  const nextCeiling = ceiling?.outlineLocked
    ? ceiling
    : { ...(ceiling ?? deriveCeiling(normalized)), outline: normalized };

  const byEdge = new Map<number, Surface>();
  for (const wall of walls) {
    if (typeof wall.planEdge === 'number' && wall.planEdge !== null) {
      // First writer wins if two walls somehow claim one edge — the duplicate
      // falls through to the orphan branch below and is kept rather than lost.
      if (!byEdge.has(wall.planEdge)) byEdge.set(wall.planEdge, wall);
    }
  }

  const nextWalls: Surface[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const existing = byEdge.get(index);
    const fresh = deriveWall(normalized, index, height, existing?.id);
    if (!existing) {
      nextWalls.push(fresh);
      continue;
    }
    const runChanged = Math.abs((existing.run_m ?? 0) - (fresh.run_m ?? 0)) > 0.005;
    const heightChanged = Math.abs((existing.height_m ?? 0) - height) > 0.005;
    if (existing.outlineLocked) {
      if (runChanged || heightChanged) staleWallIds.push(existing.id);
      // The label still follows the plan: a wall that is now on the north side
      // must not keep calling itself the east wall just because it was drawn.
      nextWalls.push({ ...existing, label: labelFor(existing, fresh), planEdge: index });
      continue;
    }
    nextWalls.push({
      ...existing,
      label: labelFor(existing, fresh),
      planEdge: index,
      run_m: fresh.run_m,
      height_m: fresh.height_m,
      outline: fresh.outline,
      subAreas: rescaleSubAreas(
        existing.subAreas,
        existing.run_m ?? fresh.run_m ?? 1,
        existing.height_m ?? height,
        fresh.run_m ?? 1,
        height
      ),
      openings: rescaleOpenings(
        existing.openings,
        existing.run_m ?? fresh.run_m ?? 1,
        fresh.run_m ?? 1
      ),
    });
  }

  for (const wall of walls) {
    const claimed = nextWalls.some((w) => w.id === wall.id);
    if (claimed) continue;
    orphanedWallIds.push(wall.id);
    nextWalls.push({ ...wall, planEdge: null });
  }

  return {
    model: {
      ...model,
      room: { ...model.room, outline: normalized },
      surfaces: [nextFloor, nextCeiling, ...nextWalls],
    },
    staleWallIds,
    orphanedWallIds,
  };
}

/**
 * Keep a member's own name for a wall; refresh a derived one.
 *
 * A label that still matches the "<Compass> wall" pattern was never typed by
 * anyone, so following the plan is free. Anything else — "Shower wall", "Behind
 * the range" — is the member's and survives every plan edit.
 */
function labelFor(existing: Surface, fresh: Surface): string {
  return /^(N|NE|E|SE|S|SW|W|NW) wall$/.test(existing.label) ? fresh.label : existing.label;
}

/**
 * Stretch a wall's regions with the wall.
 *
 * Proportional in both axes, so a wainscot at 40% of the height stays at 40%
 * and a panel covering the left half still covers the left half. The
 * alternative — leaving regions at their absolute coordinates — puts a
 * wainscot's top edge halfway up a wall whose height just changed, and floats
 * a panel off the end of a wall that got shorter.
 */
function rescaleSubAreas(
  subAreas: readonly SubArea[],
  fromRun: number,
  fromHeight: number,
  toRun: number,
  toHeight: number
): SubArea[] {
  if (fromRun <= 0 || fromHeight <= 0) return [...subAreas];
  const sx = toRun / fromRun;
  const sy = toHeight / fromHeight;
  if (Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6) return [...subAreas];
  return subAreas.map((area) => ({
    ...area,
    outline: area.outline.map(([x, y]) => [round4(x * sx), round4(y * sy)] as Vec2),
  }));
}

/**
 * Move openings with the wall — position only.
 *
 * A door does not get wider because the wall did, so `width`/`height` are left
 * alone and only `x` is scaled. Scaling the size too would silently change the
 * deduction and therefore the paint quantity.
 */
function rescaleOpenings(
  openings: readonly Opening[],
  fromRun: number,
  toRun: number
): Opening[] {
  if (fromRun <= 0) return [...openings];
  const sx = toRun / fromRun;
  if (Math.abs(sx - 1) < 1e-6) return [...openings];
  return openings.map((opening) => ({
    ...opening,
    x: round4(Math.max(0, Math.min(toRun - opening.width, opening.x * sx))),
  }));
}

// ---------------------------------------------------------------------------
// v1 upgrade
// ---------------------------------------------------------------------------

/**
 * Turn a v1 geometry payload into a v2 document.
 *
 * v1 held a floor polygon, a flat list of four walls with a width and a height,
 * and a ceiling area — enough to reconstruct everything except sub-areas and
 * materials, which v1 could not express. So the upgrade is lossless in the only
 * sense that matters: nothing a member entered is dropped.
 *
 * Two v1 shapes have to be handled and neither is hypothetical, because
 * `FloorPlanEditor` wrote both:
 *
 *  - a payload with a real `floor.polygon` — the normal case, and the polygon
 *    drives everything;
 *  - a payload with no usable polygon but with walls that carry `width_m` — a
 *    RoomPlan scan of a room the old editor could not draw. Falling back to the
 *    bounding rectangle implied by the wall runs keeps the areas right, which
 *    is what the member is looking at.
 *
 * Wall heights are taken from the v1 walls when they agree, because a scan that
 * measured 2.62 m is better information than the 2.4 m default — and when they
 * disagree the tallest wins, since a room's ceiling is one height and the short
 * reading is the one that clipped.
 *
 * **This does not save.** It returns a document; deciding to write it is the
 * caller's, because a reader that rewrote the row on every render would fight
 * every other device in the household. See `parseRoomSurfaceModel`.
 */
export function roomSurfaceModelFromLegacy(input: unknown): RoomSurfaceModel | null {
  const legacy = parseLegacyGeometryPayload(input);
  if (!legacy) return null;
  const outline = legacyOutline(legacy);
  if (!outline) return null;
  const height = legacyWallHeight(legacy);
  const model = createRoomSurfaceModel({
    outline,
    wallHeight_m: height,
    origin: 'upgraded_v1',
  });
  // The v1 wall labels ("North", "East", …) are the old editor's fixed strings
  // and carry no member intent, so the derived compass labels replace them
  // rather than being merged in. `captured_at` is kept: it is the only piece of
  // provenance v1 recorded and a member may recognise the date.
  const capturedAt = legacy.source_meta?.captured_at;
  return capturedAt
    ? { ...model, source_meta: { ...model.source_meta, captured_at: capturedAt } }
    : model;
}

function legacyOutline(legacy: LegacyGeometryPayload): Vec2[] | null {
  const polygon = legacy.floor?.polygon;
  if (polygon && polygon.length >= 3) {
    const simplified = simplifyPolygon(polygon);
    if (simplified.length >= 3 && polygonArea(simplified) > 0.01) return simplified;
  }
  // Fall back to the rectangle the wall runs describe. v1 always wrote walls in
  // the order north, east, south, west — width, depth, width, depth — so the
  // first two runs are the two dimensions.
  const walls = legacy.walls ?? [];
  const runs = walls.map((w) => Number(w.width_m) || 0).filter((v) => v > 0);
  if (runs.length >= 2) {
    return rectPolygon(0, 0, round4(runs[0]), round4(runs[1]));
  }
  const area = legacy.floor?.area_m2;
  if (area && area > 0) {
    const side = round4(Math.sqrt(area));
    return rectPolygon(0, 0, side, side);
  }
  return null;
}

function legacyWallHeight(legacy: LegacyGeometryPayload): number {
  const heights = (legacy.walls ?? [])
    .map((w) => Number(w.height_m) || 0)
    .filter((v) => v > 0.5 && v < 30);
  if (heights.length === 0) return DEFAULT_WALL_HEIGHT_M;
  return round4(Math.max(...heights));
}
