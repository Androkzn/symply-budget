/**
 * The model end to end: build a room, split a wall, price it, store it.
 *
 * The tests are written as the member's journey rather than per function,
 * because the failures that matter are the ones that only appear when two
 * correct pieces meet — a wainscot that is counted twice, a window deducted
 * from both the region it is in and the wall behind it, a plan edit that
 * silently discards a tile selection.
 */

import { describe, expect, it } from 'vitest';

import { parseRoomSurfaceModel, type Material, type Surface } from '../../src/room-surface-model';

import {
  DEFAULT_WALL_HEIGHT_M,
  createRoomSurfaceModel,
  createOpening,
  deriveWall,
  reconcileSurfaces,
  roomShapePreset,
  buildShapeOutline,
  seedShapeParams,
  type RoomShapeKey,
  roomSurfaceModelFromLegacy,
} from '../../src/room-surface/derive';
import {
  polygonArea,
  rectPolygon,
  splitPolygonByLine,
} from '../../src/room-surface/geometry';
import {
  MATERIAL_KIND_DEFAULTS,
  createMaterial,
  describeMaterialUnit,
  patternCell,
  purchaseUnitsForArea,
  unitFootprintM2,
  unitsForArea,
} from '../../src/room-surface/materials';
import { loadRoomSurfaceModel, sameSurfaceModel, serializeRoomSurfaceModel, withLegacyMirror } from '../../src/room-surface/serialize';
import {
  makeRectSubArea,
  regionsOf,
  removeSubArea,
  splitRegion,
  surfaceNetArea,
  updateSubArea,
  validateSubArea,
} from '../../src/room-surface/subareas';
import { computeTakeoff, quantityGap } from '../../src/room-surface/takeoff';

/**
 * The outline a preset produces at a given overall size, with its extra
 * dimensions at their seeded defaults — what the starter builds before the
 * member touches the shape-specific fields.
 */
function shapeOutline(key: RoomShapeKey, width: number, depth: number) {
  const preset = roomShapePreset(key);
  return buildShapeOutline(preset, seedShapeParams(preset, width, depth));
}

function room(width = 4, depth = 3, height = 2.4) {
  return createRoomSurfaceModel({
    outline: shapeOutline('rectangle', width, depth),
    wallHeight_m: height,
  });
}

function wallsOf(model: ReturnType<typeof room>): Surface[] {
  return model.surfaces.filter((surface) => surface.kind === 'wall');
}

describe('building a room', () => {
  it('derives a floor, a ceiling and one wall per plan edge', () => {
    const model = room();
    expect(model.surfaces.filter((s) => s.kind === 'floor')).toHaveLength(1);
    expect(model.surfaces.filter((s) => s.kind === 'ceiling')).toHaveLength(1);
    expect(wallsOf(model)).toHaveLength(4);
    expect(model.schema_version).toBe(2);
    expect(model.units).toBe('m');
  });

  it('gives an L-shaped room six walls with the right runs', () => {
    const model = createRoomSurfaceModel({
      outline: shapeOutline('l_shape', 6, 3),
    });
    const walls = wallsOf(model);
    expect(walls).toHaveLength(6);
    const total = walls.reduce((sum, wall) => sum + (wall.run_m ?? 0), 0);
    // The wall runs must sum to the plan's perimeter — a wall that lost its
    // edge or double-counted one shows up here and nowhere else. The L is
    // 6 × 3 with a 2 × 1 bite: 6 + 2 + 2 + 1 + 4 + 3.
    expect(total).toBeCloseTo(18, 4);
  });

  /**
   * The presets are now picked from a picture of themselves
   * (`RoomShapeIcon` builds its outline by calling `build()`), so their
   * orientation is a product fact rather than an internal detail. The model is
   * `+y` up and the renderer flips it, which makes "build the bar at y = 0" —
   * the natural way to write a T — draw a ⊥.
   */
  it('orients each preset the way its name reads on screen', () => {
    // How much of the room sits in the top half versus the bottom half. A span
    // of vertex x-positions cannot tell a solid bar from two arms with a gap
    // between them, so this measures actual area on each side of the cut.
    const halves = (key: RoomShapeKey) => {
      const outline = shapeOutline(key, 6, 3);
      const { low, high } = splitPolygonByLine(outline, 'y', 1.5);
      return { bottom: polygonArea(low), top: polygonArea(high) };
    };

    // A T is wide across the top and narrow below it.
    const t = halves('t_shape');
    expect(t.top).toBeGreaterThan(t.bottom);

    // A U is the other way round — a solid base with two arms rising from it.
    const u = halves('u_shape');
    expect(u.bottom).toBeGreaterThan(u.top);

    // An L keeps its full width, with the bite taken out of one corner.
    const l = shapeOutline('l_shape', 6, 3);
    expect(Math.max(...l.map(([x]) => x))).toBe(6);
    expect(polygonArea(l)).toBeLessThan(18);
  });

  it('makes each wall run × height, in its own bottom-left frame', () => {
    const model = room(4, 3, 2.5);
    const wall = wallsOf(model)[0];
    expect(wall.run_m).toBe(4);
    expect(wall.height_m).toBe(2.5);
    expect(wall.outline).toEqual(rectPolygon(0, 0, 4, 2.5));
    expect(polygonArea(wall.outline)).toBe(10);
  });

  it('labels walls by compass point, and only the derived ones', () => {
    const model = room();
    const labels = wallsOf(model).map((wall) => wall.label);
    expect(labels).toEqual(['S wall', 'E wall', 'N wall', 'W wall']);
  });

  it('normalises the plan before deriving anything', () => {
    const offset = createRoomSurfaceModel({
      outline: [
        [10, 10],
        [14, 10],
        [14, 13],
        [10, 13],
      ],
    });
    expect(offset.room.outline).toEqual(rectPolygon(0, 0, 4, 3));
  });
});

describe('keeping the walls in step with the plan', () => {
  it('re-shapes an untouched wall when its edge changes length', () => {
    const model = room(4, 3);
    const widened = {
      ...model,
      room: { ...model.room, outline: rectPolygon(0, 0, 5, 3) },
    };
    const { model: next, staleWallIds } = reconcileSurfaces(widened);
    const south = next.surfaces.find((s) => s.planEdge === 0);
    expect(south?.run_m).toBe(5);
    expect(staleWallIds).toEqual([]);
  });

  /**
   * The rule the whole reconciler exists for: a member who cut a gable into a
   * wall must not have it flattened by a later corner drag.
   */
  it('never re-shapes a hand-edited wall, and reports it instead', () => {
    const model = room(4, 3);
    const gabled = {
      ...model,
      surfaces: model.surfaces.map((surface) =>
        surface.planEdge === 0
          ? {
              ...surface,
              outlineLocked: true,
              outline: [
                [0, 0],
                [4, 0],
                [4, 2],
                [2, 3],
                [0, 2],
              ] as Surface['outline'],
            }
          : surface
      ),
      room: { ...model.room, outline: rectPolygon(0, 0, 5, 3) },
    };
    const { model: next, staleWallIds } = reconcileSurfaces(gabled);
    const south = next.surfaces.find((s) => s.planEdge === 0);
    expect(south?.outline).toHaveLength(5);
    expect(staleWallIds).toEqual([south?.id]);
  });

  it('keeps a wall whose edge disappeared rather than deleting its work', () => {
    const model = room(4, 3);
    const triangle = {
      ...model,
      room: {
        ...model.room,
        outline: [
          [0, 0],
          [4, 0],
          [0, 3],
        ] as Surface['outline'],
      },
    };
    const { model: next, orphanedWallIds } = reconcileSurfaces(triangle);
    expect(orphanedWallIds).toHaveLength(1);
    expect(next.surfaces.filter((s) => s.kind === 'wall')).toHaveLength(4);
    const orphan = next.surfaces.find((s) => s.id === orphanedWallIds[0]);
    expect(orphan?.planEdge).toBeNull();
  });

  it('stretches a wall’s sub-areas with the wall', () => {
    const model = room(4, 3);
    const wall = wallsOf(model)[0];
    const band = makeRectSubArea(wall, 0, 0, 4, 1.2, 'Wainscot');
    const withBand = {
      ...model,
      surfaces: model.surfaces.map((s) => (s.id === wall.id ? { ...s, subAreas: [band] } : s)),
      room: { ...model.room, outline: rectPolygon(0, 0, 8, 3) },
    };
    const { model: next } = reconcileSurfaces(withBand);
    const grown = next.surfaces.find((s) => s.id === wall.id);
    // The band still runs the full width, at the same proportional height.
    expect(grown?.subAreas[0].outline).toEqual(rectPolygon(0, 0, 8, 1.2));
  });

  it('moves openings with the wall without resizing them', () => {
    const model = room(4, 3);
    const wall = wallsOf(model)[0];
    const window = createOpening('window', 2, 0.9, 1.2, 1.2);
    const withWindow = {
      ...model,
      surfaces: model.surfaces.map((s) => (s.id === wall.id ? { ...s, openings: [window] } : s)),
      room: { ...model.room, outline: rectPolygon(0, 0, 8, 3) },
    };
    const { model: next } = reconcileSurfaces(withWindow);
    const grown = next.surfaces.find((s) => s.id === wall.id);
    expect(grown?.openings[0].x).toBe(4);
    expect(grown?.openings[0].width).toBe(1.2);
    expect(grown?.openings[0].height).toBe(1.2);
  });

  it('keeps a member’s own wall name through a plan edit', () => {
    const model = room(4, 3);
    const wall = wallsOf(model)[0];
    const renamed = {
      ...model,
      surfaces: model.surfaces.map((s) => (s.id === wall.id ? { ...s, label: 'Shower wall' } : s)),
      room: { ...model.room, outline: rectPolygon(0, 0, 5, 3) },
    };
    const { model: next } = reconcileSurfaces(renamed);
    expect(next.surfaces.find((s) => s.id === wall.id)?.label).toBe('Shower wall');
  });
});

describe('sub-areas', () => {
  it('splits a wall into two areas that exactly cover it', () => {
    const wall = deriveWall(rectPolygon(0, 0, 4, 2.4), 0, 2.4);
    const result = splitRegion(wall, 'horizontal', 1.1);
    expect(result.ok).toBe(true);
    expect(result.surface.subAreas).toHaveLength(2);
    const regions = regionsOf(result.surface);
    // Base + two areas; the base is what is left over, which is nothing.
    expect(regions).toHaveLength(3);
    expect(regions[0].netM2).toBeCloseTo(0, 4);
    expect(regions[1].netM2 + regions[2].netM2).toBeCloseTo(polygonArea(wall.outline), 4);
  });

  it('splits an area again, so a wall can carry three finishes', () => {
    const wall = deriveWall(rectPolygon(0, 0, 4, 2.4), 0, 2.4);
    const first = splitRegion(wall, 'horizontal', 1.1);
    const second = splitRegion(first.surface, 'horizontal', 2, {
      regionId: first.createdIds[1],
    });
    expect(second.ok).toBe(true);
    expect(second.surface.subAreas).toHaveLength(3);
    expect(surfaceNetArea(second.surface)).toBeCloseTo(9.6, 4);
  });

  it('refuses to split a surface that already has areas', () => {
    const wall = deriveWall(rectPolygon(0, 0, 4, 2.4), 0, 2.4);
    const first = splitRegion(wall, 'horizontal', 1.1);
    const again = splitRegion(first.surface, 'horizontal', 2);
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already split/i);
  });

  it('refuses a split outside the surface', () => {
    const wall = deriveWall(rectPolygon(0, 0, 4, 2.4), 0, 2.4);
    expect(splitRegion(wall, 'horizontal', 5).ok).toBe(false);
    expect(splitRegion(wall, 'horizontal', 0).ok).toBe(false);
  });

  it('rejects an overlapping area and names what it hit', () => {
    const wall = deriveWall(rectPolygon(0, 0, 4, 2.4), 0, 2.4);
    const panel = makeRectSubArea(wall, 0, 0, 2, 2, 'Panel');
    const withPanel = { ...wall, subAreas: [panel] };
    const clash = makeRectSubArea(withPanel, 1, 1, 2, 1, 'Clash');
    const validation = validateSubArea(withPanel, clash.outline);
    expect(validation.ok).toBe(false);
    expect(validation.code).toBe('overlaps_existing');
    expect(validation.conflictId).toBe(panel.id);
    expect(validation.message).toContain('Panel');
  });

  it('accepts an area that touches another without overlapping', () => {
    const wall = deriveWall(rectPolygon(0, 0, 4, 2.4), 0, 2.4);
    const lower = makeRectSubArea(wall, 0, 0, 4, 1.1, 'Lower');
    const withLower = { ...wall, subAreas: [lower] };
    const upper = makeRectSubArea(withLower, 0, 1.1, 4, 1.3, 'Upper');
    expect(validateSubArea(withLower, upper.outline).ok).toBe(true);
  });

  it('rejects an area that leaves the surface', () => {
    const wall = deriveWall(rectPolygon(0, 0, 4, 2.4), 0, 2.4);
    const validation = validateSubArea(wall, rectPolygon(3, 0, 3, 1));
    expect(validation.ok).toBe(false);
    expect(validation.code).toBe('outside_surface');
  });

  it('ignores a region’s own previous shape while it is being moved', () => {
    const wall = deriveWall(rectPolygon(0, 0, 4, 2.4), 0, 2.4);
    const panel = makeRectSubArea(wall, 0, 0, 2, 2, 'Panel');
    const withPanel = { ...wall, subAreas: [panel] };
    expect(validateSubArea(withPanel, rectPolygon(0.2, 0.2, 2, 2), panel.id).ok).toBe(true);
    expect(validateSubArea(withPanel, rectPolygon(0.2, 0.2, 2, 2)).ok).toBe(false);
  });
});

describe('openings', () => {
  it('deducts a door from the wall’s net area', () => {
    const wall = deriveWall(rectPolygon(0, 0, 4, 2.4), 0, 2.4);
    const door = createOpening('door', 1, 0, 0.813, 2.032);
    const withDoor = { ...wall, openings: [door] };
    expect(surfaceNetArea(withDoor)).toBeCloseTo(9.6 - 0.813 * 2.032, 3);
  });

  it('does not deduct a niche', () => {
    const wall = deriveWall(rectPolygon(0, 0, 4, 2.4), 0, 2.4);
    const niche = createOpening('niche', 1, 1, 0.6, 0.4);
    expect(niche.deducts).toBe(false);
    expect(surfaceNetArea({ ...wall, openings: [niche] })).toBeCloseTo(9.6, 4);
  });

  /**
   * A window inside a wainscot must be charged to the wainscot only. Charging
   * it to both the region and the base is the double-deduction that makes a
   * quantity quietly too small.
   */
  it('charges an opening to exactly one region', () => {
    const wall = deriveWall(rectPolygon(0, 0, 4, 2.4), 0, 2.4);
    const split = splitRegion(wall, 'horizontal', 1.2);
    const window = createOpening('window', 1, 1.5, 1, 0.8);
    const withWindow = { ...split.surface, openings: [window] };
    const regions = regionsOf(withWindow);
    const charged = regions.filter((region) => region.openings.length > 0);
    expect(charged).toHaveLength(1);
    expect(charged[0].label).toMatch(/Upper/);
    expect(surfaceNetArea(withWindow)).toBeCloseTo(9.6 - 0.8, 4);
  });
});

describe('materials and tiling', () => {
  it('includes the joint in a unit’s footprint', () => {
    const tile = createMaterial({ name: '300 square', kind: 'tile' });
    expect(tile.unit_w_mm).toBe(300);
    expect(tile.groutMm).toBe(3);
    // 0.303 × 0.303
    expect(unitFootprintM2(tile)).toBeCloseTo(0.0918, 4);
  });

  it('counts tiles from the joint-inclusive footprint plus waste', () => {
    const tile = createMaterial({ name: 'Tile', kind: 'tile' });
    // 10 m² at 10% waste = 11 m²; 11 / 0.091809 = 119.8 → 120
    expect(unitsForArea(tile, 10)).toBe(120);
  });

  it('turns paint area into litres, allowing for coats', () => {
    const paint = createMaterial({ name: 'Wall paint', kind: 'paint' });
    expect(paint.coats).toBe(2);
    expect(paint.coverageM2PerUnit).toBe(11);
    // 30 m² × 2 coats / 11 = 5.45 → 6 L
    expect(purchaseUnitsForArea(paint, 30)).toBe(6);
  });

  it('builds a one-unit cell for a straight grid', () => {
    const tile = createMaterial({ name: 'Tile', kind: 'tile' });
    const cell = patternCell(tile)!;
    expect(cell.width).toBeCloseTo(0.303, 4);
    expect(cell.height).toBeCloseTo(0.303, 4);
    expect(cell.tiles).toHaveLength(1);
  });

  /**
   * Each offset row draws its unit twice — once wrapped to the left — or the
   * pattern shows a bare stripe at the cell's left edge on every other course.
   */
  it('builds a two-row cell with wrap-around copies for a running bond', () => {
    const tile = createMaterial({ name: 'Subway', kind: 'tile' });
    const cell = patternCell({ ...tile, pattern: 'brick' })!;
    expect(cell.height).toBeCloseTo(cell.width * 2, 6);
    expect(cell.tiles).toHaveLength(4);
    expect(cell.tiles.some((t) => t.x < 0)).toBe(true);
  });

  it('rotates a herringbone cell and fills it four ways', () => {
    const tile = createMaterial({ name: 'Herringbone', kind: 'tile' });
    const cell = patternCell({ ...tile, pattern: 'herringbone', unit_w_mm: 600, unit_h_mm: 300 })!;
    expect(cell.rotationDeg).toBe(45);
    expect(cell.tiles).toHaveLength(4);
  });

  it('has no cell for a flat colour', () => {
    const paint = createMaterial({ name: 'Paint', kind: 'paint' });
    expect(patternCell(paint)).toBeNull();
    expect(unitFootprintM2(paint)).toBeNull();
    expect(describeMaterialUnit(paint)).toBeNull();
  });

  it('keeps a kind’s defaults consistent with its label', () => {
    for (const kind of Object.keys(MATERIAL_KIND_DEFAULTS) as Array<keyof typeof MATERIAL_KIND_DEFAULTS>) {
      const material = createMaterial({ name: 'x', kind });
      expect(material.colorHex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(material.kind).toBe(kind);
    }
  });
});

describe('takeoff', () => {
  function pricedRoom() {
    const model = room(4, 3, 2.4);
    const paint: Material = {
      ...createMaterial({ name: 'Wall paint', kind: 'paint' }),
      unitPriceCents: 4500,
    };
    const tile: Material = {
      ...createMaterial({ name: 'Floor tile', kind: 'tile' }),
      unitPriceCents: 320,
    };
    const floor = model.surfaces.find((s) => s.kind === 'floor')!;
    return {
      ...model,
      materials: [paint, tile],
      surfaces: model.surfaces.map((surface) =>
        surface.kind === 'wall'
          ? { ...surface, materialId: paint.id }
          : surface.id === floor.id
            ? { ...surface, materialId: tile.id }
            : surface
      ),
    };
  }

  it('groups by material and totals the priced lines', () => {
    const takeoff = computeTakeoff(pricedRoom());
    expect(takeoff.lines).toHaveLength(2);
    const paintLine = takeoff.lines.find((line) => line.name === 'Wall paint')!;
    // Four walls: 2 × (4 × 2.4) + 2 × (3 × 2.4) = 33.6
    expect(paintLine.netM2).toBeCloseTo(33.6, 3);
    expect(paintLine.purchaseUnits).toBe(Math.ceil((33.6 * 2) / 11));
    expect(takeoff.totalEstimateCents).toBeGreaterThan(0);
  });

  it('reports unpriced work as “no price” rather than zero', () => {
    const model = pricedRoom();
    const stripped = {
      ...model,
      materials: model.materials.map((material) => ({
        ...material,
        unitPriceCents: undefined,
      })),
    };
    const takeoff = computeTakeoff(stripped);
    expect(takeoff.totalEstimateCents).toBeNull();
    expect(takeoff.lines.every((line) => line.estimateCents === null)).toBe(true);
  });

  it('counts area with no material as still-to-decide', () => {
    const takeoff = computeTakeoff(pricedRoom());
    const ceiling = 12;
    expect(takeoff.unassignedM2).toBeCloseTo(ceiling, 3);
    expect(takeoff.totalNetM2).toBeCloseTo(33.6 + 12 + 12, 3);
  });

  it('leaves an excluded surface out of every total', () => {
    const model = pricedRoom();
    const excluded = {
      ...model,
      surfaces: model.surfaces.map((surface) =>
        surface.kind === 'ceiling' ? { ...surface, excluded: true } : surface
      ),
    };
    const takeoff = computeTakeoff(excluded);
    expect(takeoff.unassignedM2).toBeCloseTo(0, 3);
    expect(takeoff.totalNetM2).toBeCloseTo(33.6 + 12, 3);
  });

  /**
   * The sum that proves sub-areas carve rather than stack: a wall split in two
   * must contribute exactly its own area, no more.
   */
  it('does not double-count a wall that has been split', () => {
    const model = pricedRoom();
    const paint = model.materials[0];
    const panel: Material = { ...createMaterial({ name: 'Panelling', kind: 'panel' }) };
    const wall = model.surfaces.find((s) => s.kind === 'wall')!;
    const split = splitRegion(wall, 'horizontal', 1.1);
    const withPanel = updateSubArea(split.surface, split.createdIds[0], {
      materialId: panel.id,
    });
    const next = {
      ...model,
      materials: [...model.materials, panel],
      surfaces: model.surfaces.map((s) => (s.id === wall.id ? withPanel : s)),
    };
    const takeoff = computeTakeoff(next);
    const paintLine = takeoff.lines.find((line) => line.materialId === paint.id)!;
    const panelLine = takeoff.lines.find((line) => line.materialId === panel.id)!;
    expect(panelLine.netM2).toBeCloseTo(4 * 1.1, 3);
    // The other three walls, plus the top band of this one.
    expect(paintLine.netM2).toBeCloseTo(33.6 - 4 * 1.1, 3);
    expect(paintLine.netM2 + panelLine.netM2).toBeCloseTo(33.6, 3);
  });

  it('names the missing input when a quantity cannot be computed', () => {
    const paint = createMaterial({ name: 'Paint', kind: 'paint' });
    expect(quantityGap({ ...paint, coverageM2PerUnit: undefined })).toMatch(/coverage/i);
    expect(quantityGap(paint)).toBeNull();
  });

  it('drops a region cleanly when it is removed', () => {
    const wall = deriveWall(rectPolygon(0, 0, 4, 2.4), 0, 2.4);
    const split = splitRegion(wall, 'horizontal', 1.1);
    const back = removeSubArea(split.surface, split.createdIds[0]);
    expect(back.subAreas).toHaveLength(1);
    expect(surfaceNetArea(back)).toBeCloseTo(9.6, 4);
  });
});

describe('storage', () => {
  it('round-trips through the contract parser', () => {
    const model = serializeRoomSurfaceModel(room());
    const parsed = parseRoomSurfaceModel(JSON.stringify(model));
    expect(parsed).not.toBeNull();
    expect(parsed?.surfaces).toHaveLength(6);
  });

  /**
   * Two live readers still parse the v1 keys out of this column — the Worker's
   * takeoff seeder and the old editor's prefill — and neither knows v2 exists.
   * Dropping the mirror makes both answer zero, silently.
   */
  it('writes the v1 keys the old readers depend on', () => {
    const mirrored = withLegacyMirror(room(4, 3, 2.4));
    expect(mirrored.floor?.area_m2).toBeCloseTo(12, 4);
    expect(mirrored.ceiling?.area_m2).toBeCloseTo(12, 4);
    expect(mirrored.walls).toHaveLength(4);
    const wallArea = (mirrored.walls ?? []).reduce(
      (sum, wall) => sum + wall.width_m * wall.height_m,
      0
    );
    expect(wallArea).toBeCloseTo(33.6, 3);
    expect(mirrored.floor?.polygon).toEqual(rectPolygon(0, 0, 4, 3));
  });

  it('reads a v2 payload back as v2', () => {
    const json = JSON.stringify(serializeRoomSurfaceModel(room()));
    const loaded = loadRoomSurfaceModel(json);
    expect(loaded.origin).toBe('v2');
    expect(loaded.needsSave).toBe(false);
  });

  it('upgrades a v1 payload and flags that it has never been stored', () => {
    const legacy = JSON.stringify({
      units: 'm',
      floor: {
        polygon: [
          [0, 0],
          [3.2, 0],
          [3.2, 2.4],
          [0, 2.4],
        ],
        area_m2: 7.68,
        openings: [],
      },
      walls: [
        { id: 'w1', label: 'North', width_m: 3.2, height_m: 2.6, openings: [] },
        { id: 'w2', label: 'East', width_m: 2.4, height_m: 2.6, openings: [] },
        { id: 'w3', label: 'South', width_m: 3.2, height_m: 2.6, openings: [] },
        { id: 'w4', label: 'West', width_m: 2.4, height_m: 2.6, openings: [] },
      ],
      ceiling: { area_m2: 7.68 },
      source_meta: { captured_at: '2026-01-02T03:04:05.000Z' },
    });
    const loaded = loadRoomSurfaceModel(legacy);
    expect(loaded.origin).toBe('upgraded_v1');
    expect(loaded.needsSave).toBe(true);
    expect(loaded.model?.room.wallHeight_m).toBe(2.6);
    expect(loaded.model?.surfaces.filter((s) => s.kind === 'wall')).toHaveLength(4);
    expect(loaded.model?.source_meta.captured_at).toBe('2026-01-02T03:04:05.000Z');
    expect(loaded.model?.source_meta.origin).toBe('upgraded_v1');
  });

  it('reconstructs a room from wall runs when v1 had no usable polygon', () => {
    const model = roomSurfaceModelFromLegacy({
      units: 'm',
      walls: [
        { width_m: 5, height_m: 2.4 },
        { width_m: 4, height_m: 2.4 },
      ],
    });
    expect(model?.room.outline).toEqual(rectPolygon(0, 0, 5, 4));
  });

  it('falls back to the default height when v1 recorded none', () => {
    const model = roomSurfaceModelFromLegacy({
      floor: {
        polygon: [
          [0, 0],
          [3, 0],
          [3, 3],
          [0, 3],
        ],
      },
    });
    expect(model?.room.wallHeight_m).toBe(DEFAULT_WALL_HEIGHT_M);
  });

  it('answers empty rather than throwing for junk', () => {
    expect(loadRoomSurfaceModel(null).origin).toBe('empty');
    expect(loadRoomSurfaceModel('').origin).toBe('empty');
    expect(loadRoomSurfaceModel('not json at all').origin).toBe('empty');
    expect(loadRoomSurfaceModel('{"schema_version":99}').origin).toBe('empty');
  });

  /**
   * `sameSurfaceModel` gates the autosave. If it compared `source_meta` — which
   * is re-stamped on every serialisation — the answer would always be "changed"
   * and every screen focus would put a write through the ledger.
   */
  it('ignores the re-stamped timestamp when comparing two documents', () => {
    const model = room();
    const a = serializeRoomSurfaceModel(model);
    const b = serializeRoomSurfaceModel({
      ...model,
      source_meta: { ...model.source_meta, captured_at: '2020-01-01T00:00:00.000Z' },
    });
    expect(sameSurfaceModel(a, b)).toBe(true);
  });

  it('sees a real edit', () => {
    const model = room();
    const edited = { ...model, room: { ...model.room, wallHeight_m: 3 } };
    expect(sameSurfaceModel(model, edited)).toBe(false);
  });
});
