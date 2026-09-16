/**
 * The scale brief.
 *
 * These assertions are the feature's central claim in test form: the course
 * counts and cut sizes handed to an image model are arithmetic, not an
 * impression, and they match what the takeoff would have a member order. If a
 * number here can drift from `computeTakeoff`, the preview and the shopping
 * list are describing different rooms.
 */

import { describe, expect, it } from 'vitest';

import {
  buildShapeOutline,
  createRoomSurfaceModel,
  deriveWall,
  roomShapePreset,
  seedShapeParams,
  type RoomShapeKey,
} from '../../src/room-surface/derive';
import { rectPolygon } from '../../src/room-surface/geometry';
import { createMaterial } from '../../src/room-surface/materials';
import {
  buildRoomScaleBrief,
  buildSurfaceScaleBrief,
  fitCourses,
  surfacePreviewInstruction,
} from '../../src/room-surface/preview';
import { splitRegion, updateSubArea } from '../../src/room-surface/subareas';
import type { Material } from '../../src/room-surface-model';

/**
 * The outline a preset produces at a given overall size, with its extra
 * dimensions at their seeded defaults — what the starter builds before the
 * member touches the shape-specific fields.
 */
function shapeOutline(key: RoomShapeKey, width: number, depth: number) {
  const preset = roomShapePreset(key);
  return buildShapeOutline(preset, seedShapeParams(preset, width, depth));
}

const tile: Material = { ...createMaterial({ name: 'Metro white', kind: 'tile' }) };

describe('fitCourses', () => {
  it('divides a run into whole pieces plus the offcut', () => {
    // 4.00 m of 300 mm tile with a 3 mm joint: pitch 303 mm.
    // 13 pieces span 13 × 303 − 3 = 3.936 m, leaving 64 mm.
    const fit = fitCourses(4, 300, 3);
    expect(fit.pitch_m).toBeCloseTo(0.303, 4);
    expect(fit.whole).toBe(13);
    expect(fit.cut_m).toBeCloseTo(0.064, 4);
  });

  /**
   * The last course carries no trailing joint. Ignoring that puts the cut one
   * joint width out, which on a small format is the difference between "this
   * looks right" and "this is not my wall".
   */
  it('does not charge a trailing joint to the final course', () => {
    const fit = fitCourses(0.906, 300, 3);
    expect(fit.whole).toBe(3);
    expect(fit.cut_m).toBeCloseTo(0, 4);
  });

  it('reports an exact fit as no cut', () => {
    expect(fitCourses(1.2, 300, 0).cut_m).toBeCloseTo(0, 4);
    expect(fitCourses(1.2, 300, 0).whole).toBe(4);
  });

  it('answers zero rather than dividing by zero', () => {
    expect(fitCourses(0, 300, 3)).toMatchObject({ whole: 0, cut_m: 0 });
    expect(fitCourses(4, 0, 0).whole).toBe(0);
  });
});

describe('a plain tiled wall', () => {
  const wall = deriveWall(rectPolygon(0, 0, 4, 2.4), 0, 2.4);
  const brief = buildSurfaceScaleBrief({ ...wall, materialId: tile.id }, [tile]);

  it('states the surface size and its orientation', () => {
    expect(brief.width_m).toBe(4);
    expect(brief.height_m).toBe(2.4);
    expect(brief.irregular).toBe(false);
    expect(brief.lines[0]).toContain('a wall seen straight on');
    expect(brief.lines[0]).toContain('4.00 m');
    expect(brief.lines[0]).toContain('2.40 m');
  });

  it('gives absolute piece counts rather than a proportion', () => {
    const region = brief.regions[0];
    expect(region.across).toMatchObject({ whole: 13 });
    expect(region.up).toMatchObject({ whole: 7 });
    const text = brief.lines.join('\n');
    expect(text).toContain('13 whole pieces');
    expect(text).toContain('7 whole courses');
    expect(text).toContain('300 × 300 mm');
    expect(text).toContain('3 mm joint');
  });

  it('never expresses a size as a fraction of the surface', () => {
    expect(brief.lines.join('\n')).not.toMatch(/%|half|third|quarter/i);
  });
});

describe('a wall with two finishes', () => {
  const panel: Material = { ...createMaterial({ name: 'Oak panelling', kind: 'panel' }) };
  const paint: Material = { ...createMaterial({ name: 'Chalk white', kind: 'paint' }) };
  const wall = deriveWall(rectPolygon(0, 0, 4, 2.4), 0, 2.4);
  const split = splitRegion(wall, 'horizontal', 1.1);
  const withFinishes = updateSubArea(
    updateSubArea(split.surface, split.createdIds[0], { materialId: panel.id, label: 'Wainscot' }),
    split.createdIds[1],
    { materialId: paint.id, label: 'Upper wall' }
  );
  const brief = buildSurfaceScaleBrief(withFinishes, [panel, paint]);

  it('describes each area with its own position and size', () => {
    const wainscot = brief.regions.find((region) => region.label === 'Wainscot')!;
    const upper = brief.regions.find((region) => region.label === 'Upper wall')!;
    expect(wainscot).toMatchObject({ x: 0, y: 0, width: 4, height: 1.1 });
    expect(upper).toMatchObject({ x: 0, y: 1.1, width: 4, height: 1.3 });
    const text = brief.lines.join('\n');
    expect(text).toContain('“Wainscot”');
    expect(text).toContain('starting 0.00 m from the left and 1.10 m from the bottom');
  });

  it('says a flat finish has no joints, instead of inventing a repeat', () => {
    const upper = brief.regions.find((region) => region.label === 'Upper wall')!;
    expect(upper.across).toBeNull();
    expect(brief.lines.join('\n')).toContain('no pattern or joints');
  });

  it('drops the emptied base region rather than describing 0 m² of wall', () => {
    expect(brief.regions.map((region) => region.label)).toEqual(['Wainscot', 'Upper wall']);
  });
});

describe('the instruction', () => {
  const wall = deriveWall(rectPolygon(0, 0, 4, 2.4), 0, 2.4);
  const instruction = surfacePreviewInstruction(
    buildSurfaceScaleBrief({ ...wall, materialId: tile.id }, [tile])
  );

  /**
   * The ordering is the whole design: an image model told "make it realistic"
   * first will produce a beautiful picture of a different room. Scale, then
   * shape, then appearance.
   */
  it('puts the measurements above the drawing above the photographs', () => {
    const scale = instruction.indexOf('measurements below are exact');
    const drawing = instruction.indexOf('reference drawing');
    const photos = instruction.indexOf('material photographs');
    expect(scale).toBeGreaterThan(-1);
    expect(scale).toBeLessThan(drawing);
    expect(drawing).toBeLessThan(photos);
  });

  it('forbids the failure mode by name', () => {
    expect(instruction).toContain('do not resize, crop or stretch');
    expect(instruction).toContain('do not choose a tile size that "looks right"');
  });

  it('carries the computed numbers through verbatim', () => {
    expect(instruction).toContain('13 whole pieces');
  });
});

describe('a whole room', () => {
  it('briefs every surface that is in scope, and skips the rest', () => {
    const model = createRoomSurfaceModel({
      outline: shapeOutline('rectangle', 4, 3),
      wallHeight_m: 2.4,
    });
    const excluded = {
      ...model,
      surfaces: model.surfaces.map((surface) =>
        surface.kind === 'ceiling' ? { ...surface, excluded: true } : surface
      ),
    };
    const briefs = buildRoomScaleBrief(excluded);
    expect(briefs).toHaveLength(5);
    expect(briefs.some((brief) => brief.kind === 'ceiling')).toBe(false);
  });

  it('flags a non-rectangular surface so the drawing is followed', () => {
    const gable = deriveWall(rectPolygon(0, 0, 4, 2.4), 0, 2.4);
    const brief = buildSurfaceScaleBrief(
      {
        ...gable,
        outline: [
          [0, 0],
          [4, 0],
          [4, 2],
          [2, 3],
          [0, 2],
        ],
      },
      []
    );
    expect(brief.irregular).toBe(true);
    expect(brief.lines.join('\n')).toContain('not a plain rectangle');
  });
});
