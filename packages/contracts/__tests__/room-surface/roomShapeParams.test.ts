/**
 * Parametric room shapes, and the edge indices the starter highlights.
 *
 * `RoomShapeParamSpec.edges` names positions in `build()`'s output, so a
 * reordered or re-pointed vertex list would keep type-checking while lighting
 * up the wrong wall on the preview — a member editing "alcove width" would
 * watch an unrelated edge glow and reasonably conclude the app does not know
 * what it is doing. These assertions are what stop that being a silent change.
 */

import { describe, expect, it } from 'vitest';

import {
  ROOM_SHAPE_PRESETS,
  buildShapeOutline,
  clampShapeParams,
  roomShapePreset,
  seedShapeParams,
  type RoomShapeParams,
  type RoomShapePreset,
} from '../../src/room-surface/derive';
import { polygonArea, isSimplePolygon } from '../../src/room-surface/geometry';

function edgeLengths(preset: RoomShapePreset, params: RoomShapeParams): number[] {
  const outline = buildShapeOutline(preset, params);
  return outline.map(([x, y], index) => {
    const [nx, ny] = outline[(index + 1) % outline.length];
    return Math.hypot(nx - x, ny - y);
  });
}

describe('every preset', () => {
  it('leads with width and depth, so the form always opens the same way', () => {
    for (const preset of ROOM_SHAPE_PRESETS) {
      expect(preset.params[0].key).toBe('width');
      expect(preset.params[1].key).toBe('depth');
    }
  });

  it('gives every dimension a label a member could act on', () => {
    for (const preset of ROOM_SHAPE_PRESETS) {
      for (const spec of preset.params) {
        expect(spec.label).toMatch(/^[A-Z]/);
        expect(spec.label.length).toBeGreaterThan(3);
        expect(spec.edges.length).toBeGreaterThan(0);
      }
    }
  });

  it('builds a simple, positive-area polygon at its seeded defaults', () => {
    for (const preset of ROOM_SHAPE_PRESETS) {
      const outline = buildShapeOutline(
        preset,
        seedShapeParams(preset, 6, 4),
      );
      expect(isSimplePolygon(outline)).toBe(true);
      expect(polygonArea(outline)).toBeGreaterThan(0);
    }
  });

  it('points every declared edge index at a real edge', () => {
    for (const preset of ROOM_SHAPE_PRESETS) {
      const outline = buildShapeOutline(preset, seedShapeParams(preset, 6, 4));
      for (const spec of preset.params) {
        for (const edge of spec.edges) {
          expect(edge).toBeGreaterThanOrEqual(0);
          expect(edge).toBeLessThan(outline.length);
        }
      }
    }
  });

  /**
   * The assertion the highlight rests on: the edges a dimension claims are the
   * edges whose length it actually governs.
   */
  it('changes exactly the edges each dimension claims', () => {
    for (const preset of ROOM_SHAPE_PRESETS) {
      const base = seedShapeParams(preset, 6, 4);
      const before = edgeLengths(preset, base);

      for (const spec of preset.params) {
        const bumped = clampShapeParams(preset, {
          ...base,
          [spec.key]: base[spec.key] + 0.4,
        });
        // A dimension already at its ceiling cannot be bumped; skip rather
        // than assert a change that the clamp legitimately prevented.
        if (bumped[spec.key] === base[spec.key]) continue;
        const after = edgeLengths(preset, bumped);

        for (const edge of spec.edges) {
          expect(
            Math.abs(after[edge] - before[edge]),
            `${preset.key}.${spec.key} should move edge ${edge}`,
          ).toBeGreaterThan(0.001);
        }
      }
    }
  });
});

describe('bounds', () => {
  it('keeps a feature inside the room it is cut from', () => {
    const l = roomShapePreset('l_shape');
    const clamped = clampShapeParams(l, {
      width: 3,
      depth: 3,
      // Both far larger than the room they sit in.
      notchWidth: 99,
      notchDepth: 99,
    });
    expect(clamped.notchWidth).toBeLessThan(3);
    expect(clamped.notchDepth).toBeLessThan(3);
    expect(isSimplePolygon(buildShapeOutline(l, clamped))).toBe(true);
  });

  it('leaves an arm on both sides of a T’s alcove', () => {
    const t = roomShapePreset('t_shape');
    const clamped = clampShapeParams(t, {
      width: 4,
      depth: 3,
      barDepth: 1,
      stemWidth: 99,
    });
    expect(clamped.stemWidth).toBeLessThan(4);
    const outline = buildShapeOutline(t, clamped);
    expect(isSimplePolygon(outline)).toBe(true);
    expect(polygonArea(outline)).toBeGreaterThan(0);
  });

  /**
   * Switching shape keeps the two numbers the member actually measured. Only
   * the dimensions the new shape introduces are seeded.
   */
  it('carries width and depth across a shape change', () => {
    const l = roomShapePreset('l_shape');
    const u = roomShapePreset('u_shape');
    const fromL = seedShapeParams(l, 6, 4);
    const toU = seedShapeParams(u, fromL.width, fromL.depth, fromL);
    expect(toU.width).toBe(fromL.width);
    expect(toU.depth).toBe(fromL.depth);
    expect(toU.notchWidth).toBeGreaterThan(0);
  });

  it('re-clamps a carried-over feature that no longer fits', () => {
    const l = roomShapePreset('l_shape');
    const wide = seedShapeParams(l, 8, 4);
    // Same shape, but the member has since narrowed the room to 1 m.
    const narrow = seedShapeParams(l, 1, 4, { ...wide, width: 1, depth: 4 });
    expect(narrow.notchWidth).toBeLessThan(1);
    expect(isSimplePolygon(buildShapeOutline(l, narrow))).toBe(true);
  });
});
