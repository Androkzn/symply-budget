/**
 * Polygon arithmetic — the layer everything else trusts.
 *
 * The cases here are the ones that were wrong in an earlier draft or that would
 * be silently wrong in an obvious implementation: a bowtie with a plausible
 * area, a sub-area sharing an edge with its parent, a concave shape whose
 * centroid is outside it, and a cut that produces two pieces which must not
 * count as overlapping.
 */

import { describe, expect, it } from 'vitest';

import {
  EPS_M,
  clampPointToPolygon,
  distanceToSegment,
  edgeCompassPoint,
  ensureCounterClockwise,
  insetPolygon,
  insertVertexOnEdge,
  interiorSample,
  isSimplePolygon,
  orthogonalize,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  polygonContainsPolygon,
  polygonPerimeter,
  polygonsOverlap,
  rectPolygon,
  removeVertex,
  round4,
  signedArea,
  simplifyPolygon,
  snap,
  splitPolygonByLine,
  resizeEdge,
  edgeResizeAffects,
} from '../../src/room-surface/geometry';
import type { Vec2 } from '../../src/room-surface-model';

const RECT: Vec2[] = rectPolygon(0, 0, 4, 3);
/** An L: 4×3 with a 1×1 bite out of the top-right. */
const L_SHAPE: Vec2[] = [
  [0, 0],
  [4, 0],
  [4, 2],
  [3, 2],
  [3, 3],
  [0, 3],
];

describe('area and winding', () => {
  it('measures a rectangle', () => {
    expect(polygonArea(RECT)).toBe(12);
    expect(polygonPerimeter(RECT)).toBe(14);
  });

  it('measures a concave shape by subtracting the notch', () => {
    expect(polygonArea(L_SHAPE)).toBe(11);
  });

  it('reports winding through the sign, and normalises it', () => {
    expect(signedArea(RECT)).toBeGreaterThan(0);
    const clockwise = [...RECT].reverse();
    expect(signedArea(clockwise)).toBeLessThan(0);
    expect(signedArea(ensureCounterClockwise(clockwise))).toBeGreaterThan(0);
    // Already counter-clockwise input is left alone rather than reversed twice.
    expect(ensureCounterClockwise(RECT)).toEqual(RECT);
  });

  it('gives a degenerate ring a usable centroid instead of NaN', () => {
    const collinear: Vec2[] = [
      [0, 0],
      [1, 0],
      [2, 0],
    ];
    const centroid = polygonCentroid(collinear);
    expect(Number.isFinite(centroid[0])).toBe(true);
    expect(Number.isFinite(centroid[1])).toBe(true);
  });

  it('bounds a shape', () => {
    expect(polygonBounds(L_SHAPE)).toMatchObject({
      minX: 0,
      minY: 0,
      maxX: 4,
      maxY: 3,
      width: 4,
      height: 3,
    });
  });
});

describe('simplicity', () => {
  it('accepts a plain rectangle and an L', () => {
    expect(isSimplePolygon(RECT)).toBe(true);
    expect(isSimplePolygon(L_SHAPE)).toBe(true);
  });

  /**
   * The case that matters: a bowtie's shoelace area is the *difference* of its
   * lobes, so an un-checked self-intersection quietly under-orders material
   * rather than failing.
   */
  it('rejects a bowtie whose area still looks plausible', () => {
    const bowtie: Vec2[] = [
      [0, 0],
      [4, 4],
      [4, 0],
      [0, 4],
    ];
    expect(isSimplePolygon(bowtie)).toBe(false);
    expect(polygonArea(bowtie)).toBe(0);
  });
});

describe('containment', () => {
  it('counts a point on the boundary as inside', () => {
    expect(pointInPolygon([0, 0], RECT)).toBe(true);
    expect(pointInPolygon([2, 0], RECT)).toBe(true);
    expect(pointInPolygon([2, 1.5], RECT)).toBe(true);
    expect(pointInPolygon([4.5, 1.5], RECT)).toBe(false);
  });

  it('handles the notch of a concave shape', () => {
    expect(pointInPolygon([3.5, 2.5], L_SHAPE)).toBe(false);
    expect(pointInPolygon([3.5, 1], L_SHAPE)).toBe(true);
  });

  /**
   * A wainscot runs to the corners of its wall, so half its vertices sit
   * exactly on the outline. Rejecting that would reject the commonest shape in
   * the feature.
   */
  it('contains a sub-area that shares edges with its parent', () => {
    const wainscot = rectPolygon(0, 0, 4, 1.1);
    expect(polygonContainsPolygon(RECT, wainscot)).toBe(true);
  });

  it('rejects a region that pokes out of a concave parent', () => {
    const overhang = rectPolygon(2.5, 1.5, 1.4, 1.4);
    expect(polygonContainsPolygon(L_SHAPE, overhang)).toBe(false);
  });

  it('finds an interior point for a concave shape whose centroid is outside', () => {
    const chevron: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [2, 0.4],
      [0, 1],
    ];
    expect(pointInPolygon(interiorSample(chevron), chevron, -EPS_M)).toBe(true);
  });
});

describe('overlap', () => {
  it('does not call two touching regions an overlap', () => {
    const lower = rectPolygon(0, 0, 4, 1.1);
    const upper = rectPolygon(0, 1.1, 4, 1.9);
    expect(polygonsOverlap(lower, upper)).toBe(false);
  });

  it('detects a genuine overlap', () => {
    expect(polygonsOverlap(rectPolygon(0, 0, 2, 2), rectPolygon(1, 1, 2, 2))).toBe(true);
  });

  it('detects full containment as an overlap', () => {
    expect(polygonsOverlap(rectPolygon(0, 0, 4, 4), rectPolygon(1, 1, 1, 1))).toBe(true);
  });
});

describe('editing helpers', () => {
  it('snaps to a grid and rounds to a tenth of a millimetre', () => {
    expect(snap(1.234, 0.05)).toBe(1.25);
    expect(round4(2.4000000000000004)).toBe(2.4);
  });

  /**
   * Without this a finger cannot produce a rectangle: the last corner is left
   * a few millimetres off and every downstream quantity carries the error.
   */
  it('pulls a nearly-square ring square', () => {
    const wobbly: Vec2[] = [
      [0, 0],
      [4.02, 0.03],
      [3.99, 3.01],
      [0.01, 2.98],
    ];
    const squared = orthogonalize(wobbly);
    expect(squared[1][1]).toBe(squared[0][1]);
    expect(squared[2][0]).toBe(squared[1][0]);
    expect(squared[3][1]).toBe(squared[2][1]);
  });

  it('leaves a genuinely canted edge alone', () => {
    const bay: Vec2[] = [
      [0, 0],
      [4, 0],
      [3, 2],
      [0, 2],
    ];
    const squared = orthogonalize(bay);
    expect(squared[2]).toEqual([3, 2]);
  });

  it('drops duplicate and collinear vertices', () => {
    const messy: Vec2[] = [
      [0, 0],
      [2, 0],
      [4, 0],
      [4, 3],
      [4, 3],
      [0, 3],
    ];
    expect(simplifyPolygon(messy)).toEqual(RECT);
  });

  it('adds and removes vertices, refusing to go below a triangle', () => {
    const six = insertVertexOnEdge(RECT, 0);
    expect(six).toHaveLength(5);
    expect(six[1]).toEqual([2, 0]);
    const triangle: Vec2[] = [
      [0, 0],
      [1, 0],
      [0, 1],
    ];
    expect(removeVertex(triangle, 0)).toHaveLength(3);
  });

  it('clamps a stray point back onto the shape', () => {
    expect(clampPointToPolygon([2, 1], RECT)).toEqual([2, 1]);
    expect(clampPointToPolygon([6, 1.5], RECT)).toEqual([4, 1.5]);
  });

  it('measures distance to a segment, including past its ends', () => {
    expect(distanceToSegment([2, 1], [0, 0], [4, 0])).toBe(1);
    expect(distanceToSegment([6, 0], [0, 0], [4, 0])).toBe(2);
  });

  it('insets a rectangle exactly and refuses when it would vanish', () => {
    const inset = insetPolygon(RECT, 0.5);
    expect(inset).toEqual(rectPolygon(0.5, 0.5, 3, 2));
    expect(insetPolygon(RECT, 2)).toBeNull();
  });
});

describe('splitting', () => {
  it('cuts a wall into two pieces that exactly cover it', () => {
    const wall = rectPolygon(0, 0, 4, 2.4);
    const { low, high } = splitPolygonByLine(wall, 'y', 1.1);
    expect(polygonArea(low)).toBeCloseTo(4 * 1.1, 6);
    expect(polygonArea(high)).toBeCloseTo(4 * 1.3, 6);
    expect(polygonArea(low) + polygonArea(high)).toBeCloseTo(polygonArea(wall), 6);
    // Touching, never overlapping — the validator has to accept both.
    expect(polygonsOverlap(low, high)).toBe(false);
  });

  it('cuts a concave shape correctly', () => {
    const { low, high } = splitPolygonByLine(L_SHAPE, 'y', 2);
    expect(polygonArea(low)).toBeCloseTo(8, 6);
    expect(polygonArea(high)).toBeCloseTo(3, 6);
  });

  it('returns an empty piece when the line misses', () => {
    const { low, high } = splitPolygonByLine(RECT, 'y', 5);
    expect(high).toEqual([]);
    expect(polygonArea(low)).toBeCloseTo(12, 6);
  });
});

describe('compass labelling', () => {
  /**
   * The label names the wall of the room, not the direction its face looks.
   * The top edge of a plan is the north wall even though it faces south.
   */
  it('names the edges of a rectangle', () => {
    const centre = polygonCentroid(RECT);
    expect(edgeCompassPoint(RECT[0], RECT[1], centre)).toBe('S');
    expect(edgeCompassPoint(RECT[1], RECT[2], centre)).toBe('E');
    expect(edgeCompassPoint(RECT[2], RECT[3], centre)).toBe('N');
    expect(edgeCompassPoint(RECT[3], RECT[0], centre)).toBe('W');
  });
});

describe('setting an edge to an exact length', () => {
  /**
   * The other half of "drag a corner". A member who measured 3.62 m cannot
   * produce that with a finger, and every quantity in the project comes from
   * these numbers.
   */
  it('widens a rectangle by moving the whole far side', () => {
    const wider = resizeEdge(RECT, 0, 6)!;
    expect(wider).toEqual(rectPolygon(0, 0, 6, 3));
    expect(polygonArea(wider)).toBe(18);
  });

  it('deepens a rectangle from its vertical edge', () => {
    expect(resizeEdge(RECT, 1, 5)).toEqual(rectPolygon(0, 0, 4, 5));
  });

  it('shortens as readily as it lengthens', () => {
    expect(resizeEdge(RECT, 0, 2)).toEqual(rectPolygon(0, 0, 2, 3));
  });

  it('is a no-op when the length already matches', () => {
    expect(resizeEdge(RECT, 0, 4)).toEqual(RECT);
  });

  /**
   * Moving only the single endpoint would skew the two walls either side into
   * diagonals. The shared-coordinate rule keeps an orthogonal room orthogonal.
   */
  it('keeps an L orthogonal, moving only the leg the wall belongs to', () => {
    const longer = resizeEdge(L_SHAPE, 0, 6)!;
    expect(isSimplePolygon(longer)).toBe(true);
    // Every edge is still axis-aligned.
    for (let i = 0; i < longer.length; i += 1) {
      const a = longer[i];
      const b = longer[(i + 1) % longer.length];
      const axisAligned =
        Math.abs(a[0] - b[0]) < EPS_M || Math.abs(a[1] - b[1]) < EPS_M;
      expect(axisAligned).toBe(true);
    }
    // The bottom wall is now 6 and the right-hand side moved out with it.
    expect(longer[1][0]).toBe(6);
    // The cut-out's inner corner stayed at x = 3, so the cut-out STRETCHED
    // from 1 wide to 3 — the documented trade for keeping the room
    // orthogonal. Its own edge is separately editable to put it back.
    expect(polygonArea(longer)).toBeCloseTo(6 * 3 - 3 * 1, 4);
  });

  it('resizes the notch of an L without disturbing the rest', () => {
    // Edge 2 is the notch's horizontal cut, length 1.
    const widened = resizeEdge(L_SHAPE, 2, 2)!;
    expect(isSimplePolygon(widened)).toBe(true);
    expect(polygonArea(widened)).toBeCloseTo(12 - 2, 4);
  });

  it('moves only the far vertex of a diagonal edge', () => {
    const bay: Vec2[] = [
      [0, 0],
      [4, 0],
      [3, 2],
      [0, 2],
    ];
    const changed = resizeEdge(bay, 1, 3)!;
    expect(changed[0]).toEqual([0, 0]);
    expect(changed[1]).toEqual([4, 0]);
    expect(changed[3]).toEqual([0, 2]);
  });

  /** A wall dragged through the opposite wall is a refusal, not a shape. */
  it('refuses a length that would collapse or cross the room', () => {
    expect(resizeEdge(RECT, 0, 0)).toBeNull();
    expect(resizeEdge(RECT, 0, -2)).toBeNull();
    expect(resizeEdge(L_SHAPE, 2, 9)).toBeNull();
  });

  it('reports which corners a change will move, before it happens', () => {
    // The bottom edge of a rectangle carries the whole right-hand side.
    expect(edgeResizeAffects(RECT, 0).sort()).toEqual([1, 2]);
    expect(edgeResizeAffects(RECT, 1).sort()).toEqual([2, 3]);
  });
});
