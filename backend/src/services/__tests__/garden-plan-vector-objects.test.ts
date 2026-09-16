/**
 * The vector-object clamp, and the one place it is type-aware.
 *
 * These numbers are a PARITY contract, not a local detail. The same clamp is
 * ported into `src/features/house/local/logic/gardenPlanObjects.ts` so that a
 * local-first household and a D1 household store the same row for the same drag.
 * If an assertion here changes, that port and `src/types/garden-objects.ts`
 * change with it — otherwise the same yard is drawn differently on two devices,
 * for every object anyone ever pushes to an edge.
 */
import { describe, expect, it } from 'vitest';

import {
  normalizeVectorObjects,
  parseVectorObjectsJson,
  type GardenPlanVectorObject,
} from '../garden-plan-vector-objects';

function object(overrides: Partial<GardenPlanVectorObject> = {}): GardenPlanVectorObject {
  return {
    type: 'tree',
    x: 0.5,
    y: 0.5,
    width: 0.1,
    height: 0.1,
    rotation: 0,
    ...overrides,
  };
}

describe('normalizeVectorObjects — the element bounds', () => {
  it('holds an element to 0.03..0.8', () => {
    const [big, small] = normalizeVectorObjects([
      object({ width: 5, height: 5 }),
      object({ width: 0.0001, height: 0.0001 }),
    ]);
    expect(big.width).toBe(0.8);
    expect(small.width).toBe(0.03);
  });

  it('clamps the CENTRE to the plan, letting a body hang over the edge', () => {
    // Deliberately not the client editor's rule, which keeps the whole body
    // inside. The server's answer is what gets stored; see the ported file.
    const [only] = normalizeVectorObjects([object({ x: 1.5, y: -2, width: 0.4 })]);
    expect(only.x).toBe(1);
    expect(only.y).toBe(0);
  });
});

describe('normalizeVectorObjects — zones are exempt from the ceiling', () => {
  it('lets a zone span the entire lot', () => {
    // A back yard commonly spans the full width and most of the depth. Clamping
    // one to 0.8 would shrink the area the member just traced, on save.
    const [zone] = normalizeVectorObjects([
      object({ type: 'zone', width: 1, height: 1 }),
    ]);
    expect(zone.width).toBe(1);
    expect(zone.height).toBe(1);
  });

  it('still bounds a zone at 1 and at 0.01', () => {
    const [big, small] = normalizeVectorObjects([
      object({ type: 'zone', width: 4, height: 4 }),
      object({ type: 'zone', width: 0, height: 0 }),
    ]);
    expect(big.width).toBe(1);
    expect(small.width).toBe(0.01);
  });

  it('does NOT extend the exemption to any other type', () => {
    for (const type of ['tree', 'patio', 'path', 'label'] as const) {
      const [only] = normalizeVectorObjects([object({ type, width: 1 })]);
      expect(only.width).toBe(0.8);
    }
  });

  it('passes zone metadata through untouched — the ring lives there', () => {
    const ring = [
      [0.1, 0.1],
      [0.9, 0.1],
      [0.9, 0.9],
    ];
    const [zone] = normalizeVectorObjects([
      object({
        type: 'zone',
        width: 0.9,
        height: 0.9,
        metadata: { zone: { kind: 'back_yard', polygon: ring } },
      }),
    ]);
    expect(zone.metadata).toEqual({ zone: { kind: 'back_yard', polygon: ring } });
  });
});

describe('normalizeVectorObjects — the rest of the contract', () => {
  it('drops the excess at eighty, silently, as the route also does', () => {
    const many = Array.from({ length: 100 }, () => object());
    expect(normalizeVectorObjects(many)).toHaveLength(80);
  });

  it('turns a non-finite size into the SMALLEST legal one, not an invisible one', () => {
    const [only] = normalizeVectorObjects([object({ width: NaN })]);
    expect(only.width).toBe(0.03);
  });

  it('normalises rotation into [0, 360)', () => {
    const [a, b] = normalizeVectorObjects([
      object({ rotation: -90 }),
      object({ rotation: 450 }),
    ]);
    expect(a.rotation).toBe(270);
    expect(b.rotation).toBe(90);
  });

  it('trims then truncates a label, so leading spaces do not cost characters', () => {
    const [only] = normalizeVectorObjects([
      object({ label: `     ${'a'.repeat(90)}` }),
    ]);
    expect(only.label).toHaveLength(80);
  });

  it('turns a whitespace-only label into null rather than an empty string', () => {
    const [only] = normalizeVectorObjects([object({ label: '   ' })]);
    expect(only.label).toBeNull();
  });
});

describe('parseVectorObjectsJson', () => {
  it('accepts a stored zone now that the type guard knows the type', () => {
    const stored = JSON.stringify([
      {
        type: 'zone',
        x: 0.5,
        y: 0.5,
        width: 0.95,
        height: 0.95,
        rotation: 0,
        metadata: { zone: { kind: 'front_yard', polygon: [[0, 0], [1, 0], [1, 1]] } },
      },
    ]);
    const parsed = parseVectorObjectsJson(stored);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].width).toBe(0.95);
  });

  it('drops a row whose type it does not know', () => {
    const stored = JSON.stringify([{ type: 'helipad', x: 0.5, y: 0.5, width: 0.1, height: 0.1 }]);
    expect(parseVectorObjectsJson(stored)).toEqual([]);
  });

  it('answers empty for malformed JSON rather than throwing', () => {
    expect(parseVectorObjectsJson('{not json')).toEqual([]);
    expect(parseVectorObjectsJson(null)).toEqual([]);
  });
});
