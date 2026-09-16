/**
 * The zone ring's frame, which is the whole reason zones can live in the
 * ordinary object editor.
 *
 * A zone is a `garden_plan_objects` row, so `GardenPlanVectorEditor` will drag,
 * resize and delete it like any other object — updating `x`/`y`/`width`/`height`
 * and never touching `metadata`. Storing the outline in the OBJECT's frame is
 * what makes that safe: the box IS the transform, so a moved zone keeps its
 * shape with no bookkeeping at all.
 *
 * The two tests that would have caught the bug this design replaces are
 * "survives a move" and "survives a resize". Under the obvious alternative — an
 * absolute plan-space ring — both fail by SAVING the old shape while rendering
 * the new one, so the member sees their drag work and finds it undone next time
 * they open the plan.
 */
import { boxOfNormalizedRing, type NormalizedPoint } from '@utils/gardenGeo';

import type { GardenPlanObject } from '../garden-objects';
import {
  GARDEN_ZONE_KINDS,
  GARDEN_ZONE_KIND_SPECS,
  buildZoneMetadata,
  gardenZoneKindSpec,
  isGardenZoneKind,
  isZoneObject,
  splitZonesAndElements,
  zoneMetadataFromObject,
  zoneRingInPlanSpace,
} from '../garden-zones';

/** An L-shaped back yard — concave, so a bbox-only model cannot fake it. */
const RING: NormalizedPoint[] = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.5 },
  { x: 0.5, y: 0.5 },
  { x: 0.5, y: 0.9 },
  { x: 0.1, y: 0.9 },
];

function zoneObject(overrides: Partial<GardenPlanObject> = {}): GardenPlanObject {
  const box = boxOfNormalizedRing(RING)!;
  return {
    id: 'zone-1',
    type: 'zone',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: 0,
    label: 'Back yard',
    color: '#15803D',
    metadata: buildZoneMetadata('back_yard', RING, box),
    ...overrides,
  };
}

describe('buildZoneMetadata / zoneRingInPlanSpace', () => {
  it('round-trips the ring back to the plan coordinates it came from', () => {
    const rebuilt = zoneRingInPlanSpace(zoneObject());
    expect(rebuilt).toHaveLength(RING.length);
    RING.forEach((point, index) => {
      expect(rebuilt![index].x).toBeCloseTo(point.x, 10);
      expect(rebuilt![index].y).toBeCloseTo(point.y, 10);
    });
  });

  it('puts a box corner at exactly ±0.5 in the object frame', () => {
    const zone = zoneMetadataFromObject(zoneObject());
    const xs = zone!.polygon.map((p) => p.x);
    const ys = zone!.polygon.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(-0.5, 10);
    expect(Math.max(...xs)).toBeCloseTo(0.5, 10);
    expect(Math.min(...ys)).toBeCloseTo(-0.5, 10);
    expect(Math.max(...ys)).toBeCloseTo(0.5, 10);
  });

  it('SURVIVES A MOVE — the outline follows the object', () => {
    const moved = zoneObject({ x: zoneObject().x + 0.1, y: zoneObject().y - 0.05 });
    const rebuilt = zoneRingInPlanSpace(moved)!;
    RING.forEach((point, index) => {
      expect(rebuilt[index].x).toBeCloseTo(point.x + 0.1, 10);
      expect(rebuilt[index].y).toBeCloseTo(point.y - 0.05, 10);
    });
  });

  it('SURVIVES A RESIZE — the outline scales about the centre', () => {
    const base = zoneObject();
    const resized = zoneObject({ width: base.width / 2, height: base.height / 2 });
    const rebuilt = zoneRingInPlanSpace(resized)!;
    RING.forEach((point, index) => {
      expect(rebuilt[index].x).toBeCloseTo(base.x + (point.x - base.x) / 2, 10);
      expect(rebuilt[index].y).toBeCloseTo(base.y + (point.y - base.y) / 2, 10);
    });
  });

  it('keeps the shape CONCAVE rather than collapsing it to its box', () => {
    // The notch is what distinguishes a traced L-shaped yard from a rectangle.
    const rebuilt = zoneRingInPlanSpace(zoneObject())!;
    expect(rebuilt).toHaveLength(6);
    expect(rebuilt[3].x).toBeCloseTo(0.5, 10);
    expect(rebuilt[3].y).toBeCloseTo(0.5, 10);
  });
});

describe('zoneMetadataFromObject — reading rows that round-tripped two databases', () => {
  it('is null for anything that is not a zone', () => {
    expect(zoneMetadataFromObject({ type: 'tree', metadata: null })).toBeNull();
  });

  it('is null when the metadata is missing or the wrong shape', () => {
    expect(zoneMetadataFromObject({ type: 'zone', metadata: null })).toBeNull();
    expect(zoneMetadataFromObject({ type: 'zone', metadata: { zone: 'nope' } })).toBeNull();
    expect(zoneMetadataFromObject({ type: 'zone', metadata: { zone: { kind: 'house' } } })).toBeNull();
  });

  it('is null when too few corners survive parsing', () => {
    expect(
      zoneMetadataFromObject({
        type: 'zone',
        metadata: { zone: { kind: 'house', polygon: [[0, 0], [1, 1]] } },
      }),
    ).toBeNull();
  });

  it('skips an unparseable corner rather than defaulting it to the origin', () => {
    const zone = zoneMetadataFromObject({
      type: 'zone',
      metadata: {
        zone: {
          kind: 'house',
          polygon: [[0, 0], ['x', 1], [1, 1], [0, 1]],
        },
      },
    });
    expect(zone!.polygon).toHaveLength(3);
  });

  it('falls back to "other" for a kind from a future version', () => {
    const zone = zoneMetadataFromObject({
      type: 'zone',
      metadata: {
        zone: { kind: 'orchard', polygon: [[0, 0], [1, 0], [1, 1]] },
      },
    });
    expect(zone!.kind).toBe('other');
  });

  it('declares a rectangle shape so an OLD build still draws the row', () => {
    // The degradation the design depends on: a build that predates zones reads
    // `metadata.shape` and renders a rectangle in the right place rather than
    // dropping the row entirely.
    const metadata = buildZoneMetadata('house', RING, boxOfNormalizedRing(RING)!);
    expect(metadata.shape).toBe('rectangle');
  });
});

describe('the zone palette', () => {
  it('has a spec for every kind', () => {
    for (const kind of GARDEN_ZONE_KINDS) {
      expect(gardenZoneKindSpec(kind).id).toBe(kind);
    }
    expect(GARDEN_ZONE_KIND_SPECS).toHaveLength(GARDEN_ZONE_KINDS.length);
  });

  it('excludes the house and the driveway from maintained yard', () => {
    // The reason for tracing them: "1,100 m² of lot" is a registry fact,
    // "640 m² of yard" is what decides how long mowing takes.
    expect(gardenZoneKindSpec('house').countsAsYard).toBe(false);
    expect(gardenZoneKindSpec('driveway').countsAsYard).toBe(false);
    expect(gardenZoneKindSpec('back_yard').countsAsYard).toBe(true);
  });

  it('offers the house first, because it is the one members forget', () => {
    expect(GARDEN_ZONE_KIND_SPECS[0].id).toBe('house');
  });

  it('recognises its own kinds and nothing else', () => {
    expect(isGardenZoneKind('back_yard')).toBe(true);
    expect(isGardenZoneKind('orchard')).toBe(false);
    expect(isGardenZoneKind(null)).toBe(false);
  });
});

describe('splitZonesAndElements', () => {
  it('separates the two layers in one pass, preserving order', () => {
    const { zones, elements } = splitZonesAndElements([
      { type: 'zone' as const, id: 'a' },
      { type: 'tree' as const, id: 'b' },
      { type: 'zone' as const, id: 'c' },
    ]);
    expect(zones.map((z) => z.id)).toEqual(['a', 'c']);
    expect(elements.map((e) => e.id)).toEqual(['b']);
  });

  it('agrees with isZoneObject', () => {
    expect(isZoneObject({ type: 'zone' })).toBe(true);
    expect(isZoneObject({ type: 'patio' })).toBe(false);
  });
});
