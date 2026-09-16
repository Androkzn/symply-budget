/**
 * The two coordinate spaces, and the arithmetic between them.
 *
 * The single most valuable assertion in this file is the round trip in
 * "geo ↔ normalized". `geoToNormalized` and `normalizedToGeo` both flip the
 * latitude axis (north is up, canvas y is down), and a version that forgets the
 * flip in ONE of them is not obviously broken — it produces a yard plan mirrored
 * top-to-bottom, which looks like a plausible garden right up until the member
 * notices the house is behind the back fence. Asserting they are inverses is
 * what makes that failure loud.
 */
import {
  boundsOfRing,
  boxOfNormalizedRing,
  formatArea,
  formatLength,
  geoToNormalized,
  insertVertexNearest,
  isPointInRing,
  normalizedToGeo,
  polygonAreaSqM,
  polygonPerimeterM,
  ringCentroid,
  seedRectangle,
  type GeoBounds,
} from '../gardenGeo';

/** A ~100m x ~111m box, near enough square in metres at this latitude. */
const BOUNDS: GeoBounds = {
  minLat: 43.65,
  maxLat: 43.651,
  minLon: -79.38,
  maxLon: -79.3787,
};

describe('boundsOfRing', () => {
  it('returns the bounding box of a ring', () => {
    const bounds = boundsOfRing([
      { latitude: 43.651, longitude: -79.38 },
      { latitude: 43.651, longitude: -79.3787 },
      { latitude: 43.65, longitude: -79.3787 },
      { latitude: 43.65, longitude: -79.38 },
    ]);
    expect(bounds).toEqual(BOUNDS);
  });

  it('refuses fewer than three points', () => {
    expect(
      boundsOfRing([
        { latitude: 1, longitude: 1 },
        { latitude: 2, longitude: 2 },
      ]),
    ).toBeNull();
  });

  it('refuses a degenerate box rather than handing back a divide-by-zero', () => {
    // Three collinear points: a real thing a member can produce mid-drag, and
    // every caller's next move is to divide by the span.
    expect(
      boundsOfRing([
        { latitude: 43.65, longitude: -79.38 },
        { latitude: 43.65, longitude: -79.379 },
        { latitude: 43.65, longitude: -79.3785 },
      ]),
    ).toBeNull();
  });
});

describe('geo ↔ normalized', () => {
  it('puts the north-west corner at the ORIGIN, not the south-west', () => {
    // The y flip, asserted directly. Latitude increases north; canvas y
    // increases down, so max latitude must map to y = 0.
    const northWest = normalizedToGeo({ x: 0, y: 0 }, BOUNDS);
    expect(northWest.latitude).toBeCloseTo(BOUNDS.maxLat, 10);
    expect(northWest.longitude).toBeCloseTo(BOUNDS.minLon, 10);

    const southEast = normalizedToGeo({ x: 1, y: 1 }, BOUNDS);
    expect(southEast.latitude).toBeCloseTo(BOUNDS.minLat, 10);
    expect(southEast.longitude).toBeCloseTo(BOUNDS.maxLon, 10);
  });

  it('round-trips every point back to itself', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.5, y: 0.5 },
      { x: 0.13, y: 0.87 },
      { x: 0.999, y: 0.001 },
    ];
    for (const point of points) {
      const back = geoToNormalized(normalizedToGeo(point, BOUNDS), BOUNDS);
      expect(back.x).toBeCloseTo(point.x, 9);
      expect(back.y).toBeCloseTo(point.y, 9);
    }
  });

  it('does NOT clamp a point outside the lot', () => {
    // A zone corner a metre past the lot line is a real thing to draw; clamping
    // it here would silently square off a driveway. The storage clamp decides
    // what is legal to persist, not this.
    const outside = geoToNormalized(
      { latitude: BOUNDS.maxLat + 0.001, longitude: BOUNDS.minLon - 0.0013 },
      BOUNDS,
    );
    expect(outside.y).toBeLessThan(0);
    expect(outside.x).toBeLessThan(0);
  });
});

describe('polygonAreaSqM', () => {
  it('measures a rectangle at roughly its real size', () => {
    // 0.001° of latitude ≈ 111.3 m; 0.0013° of longitude at 43.65° ≈ 104.8 m.
    const area = polygonAreaSqM([
      { latitude: 43.651, longitude: -79.38 },
      { latitude: 43.651, longitude: -79.3787 },
      { latitude: 43.65, longitude: -79.3787 },
      { latitude: 43.65, longitude: -79.38 },
    ]);
    expect(area).toBeGreaterThan(11_000);
    expect(area).toBeLessThan(12_500);
  });

  it('is orientation-independent', () => {
    const clockwise = [
      { latitude: 43.651, longitude: -79.38 },
      { latitude: 43.651, longitude: -79.3787 },
      { latitude: 43.65, longitude: -79.3787 },
      { latitude: 43.65, longitude: -79.38 },
    ];
    expect(polygonAreaSqM(clockwise)).toBeCloseTo(
      polygonAreaSqM([...clockwise].reverse()),
      6,
    );
  });

  it('treats a half-drawn shape as having no area rather than throwing', () => {
    // Rendered live while the member is still tapping corners.
    expect(polygonAreaSqM([])).toBe(0);
    expect(polygonAreaSqM([{ latitude: 1, longitude: 1 }])).toBe(0);
    expect(
      polygonAreaSqM([
        { latitude: 1, longitude: 1 },
        { latitude: 2, longitude: 2 },
      ]),
    ).toBe(0);
  });
});

describe('polygonPerimeterM', () => {
  it('closes the ring — the last edge back to the first corner counts', () => {
    const ring = [
      { latitude: 43.651, longitude: -79.38 },
      { latitude: 43.651, longitude: -79.3787 },
      { latitude: 43.65, longitude: -79.3787 },
      { latitude: 43.65, longitude: -79.38 },
    ];
    const perimeter = polygonPerimeterM(ring);
    // ~2 * (111 + 105)
    expect(perimeter).toBeGreaterThan(400);
    expect(perimeter).toBeLessThan(450);
  });
});

describe('seedRectangle', () => {
  it('centres a rectangle of about the requested size on the point', () => {
    const centre = { latitude: 43.65, longitude: -79.38 };
    const ring = seedRectangle(centre, 22, 30);
    expect(ring).toHaveLength(4);

    // Every corner distinct — the bug a copy-paste in the fourth corner makes,
    // which collapses the seed into a triangle.
    const unique = new Set(ring.map((p) => `${p.latitude},${p.longitude}`));
    expect(unique.size).toBe(4);

    const width = polygonPerimeterM([ring[0], ring[1]]) / 2;
    const depth = polygonPerimeterM([ring[1], ring[2]]) / 2;
    expect(width).toBeGreaterThan(20);
    expect(width).toBeLessThan(24);
    expect(depth).toBeGreaterThan(28);
    expect(depth).toBeLessThan(32);
  });

  it('starts at the north-west corner and runs clockwise', () => {
    const ring = seedRectangle({ latitude: 43.65, longitude: -79.38 }, 20, 20);
    expect(ring[0].latitude).toBeGreaterThan(ring[3].latitude);
    expect(ring[0].longitude).toBeLessThan(ring[1].longitude);
  });
});

describe('isPointInRing', () => {
  const square = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 },
  ];

  it('finds a point inside', () => {
    expect(isPointInRing({ x: 0.5, y: 0.5 }, square)).toBe(true);
  });

  it('rejects a point outside', () => {
    expect(isPointInRing({ x: 0.1, y: 0.5 }, square)).toBe(false);
    expect(isPointInRing({ x: 0.5, y: 0.95 }, square)).toBe(false);
  });

  it('handles a concave shape — an L-shaped back yard', () => {
    const ell = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0.4 },
      { x: 0.4, y: 0.4 },
      { x: 0.4, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(isPointInRing({ x: 0.2, y: 0.8 }, ell)).toBe(true);
    // The notch — inside the bounding box, outside the shape.
    expect(isPointInRing({ x: 0.8, y: 0.8 }, ell)).toBe(false);
  });

  it('rejects everything for a degenerate ring', () => {
    expect(isPointInRing({ x: 0.5, y: 0.5 }, [{ x: 0, y: 0 }])).toBe(false);
  });
});

describe('boxOfNormalizedRing', () => {
  it('reports the CENTRE and the spans, not the corners', () => {
    const box = boxOfNormalizedRing([
      { x: 0.2, y: 0.1 },
      { x: 0.6, y: 0.1 },
      { x: 0.6, y: 0.5 },
      { x: 0.2, y: 0.5 },
    ]);
    // Per-field `toBeCloseTo`: `0.6 - 0.2` is `0.39999999999999997` in IEEE 754,
    // and asserting exact equality here would be testing floating point rather
    // than the box.
    expect(box?.x).toBeCloseTo(0.4, 10);
    expect(box?.y).toBeCloseTo(0.3, 10);
    expect(box?.width).toBeCloseTo(0.4, 10);
    expect(box?.height).toBeCloseTo(0.4, 10);
  });
});

describe('ringCentroid', () => {
  it('averages the vertices', () => {
    const centre = ringCentroid([
      { latitude: 0, longitude: 0 },
      { latitude: 2, longitude: 0 },
      { latitude: 2, longitude: 2 },
      { latitude: 0, longitude: 2 },
    ]);
    expect(centre).toEqual({ latitude: 1, longitude: 1 });
  });

  it('is null for an empty ring', () => {
    expect(ringCentroid([])).toBeNull();
  });
});

describe('insertVertexNearest', () => {
  const square = [
    { latitude: 1, longitude: 0 },
    { latitude: 1, longitude: 1 },
    { latitude: 0, longitude: 1 },
    { latitude: 0, longitude: 0 },
  ];

  it('splits the nearest edge and returns where the corner landed', () => {
    // Just outside the top edge (index 0), so that edge should take it.
    const target = { latitude: 1.01, longitude: 0.5 };
    const result = insertVertexNearest(square, target);
    expect(result.ring).toHaveLength(5);
    expect(result.insertedIndex).toBe(1);
    expect(result.ring[1]).toEqual(target);
  });

  it('keeps the ring in order so the shape does not fold', () => {
    const result = insertVertexNearest(square, { latitude: 0.5, longitude: 1.01 });
    // The right edge runs from index 1 to 2, so the new corner belongs at 2.
    expect(result.insertedIndex).toBe(2);
    expect(result.ring[1]).toEqual(square[1]);
    expect(result.ring[3]).toEqual(square[2]);
  });
});

describe('formatting', () => {
  it('sheds the decimal once a length is long enough not to need it', () => {
    expect(formatLength(12.34, 'meters')).toBe('12.3 m');
    expect(formatLength(123.4, 'meters')).toBe('123 m');
  });

  it('converts to feet', () => {
    expect(formatLength(10, 'feet')).toBe('32.8 ft');
  });

  it('groups thousands in an area', () => {
    expect(formatArea(4844.2, 'meters')).toBe('4,844 m²');
    expect(formatArea(450.25, 'meters')).toBe('450.3 m²');
  });
});
