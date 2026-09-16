/**
 * Fitting a model's reading of a drawing onto the lot the member traced.
 *
 * The cases that matter here are the defensive ones. This function's input is a
 * language model's answer round-tripped through a Worker, so "the model returned
 * something structurally silly" is not a hypothetical — it is Tuesday. Every
 * such case must degrade to a smaller draft, never to a crash inside a render
 * pass and never to `NaN` coordinates, which React Native Svg draws as nothing
 * at all with no error anywhere.
 */
import type { AnalyzedPlanDraft } from '@api/garden-plans';

import { fitAnalyzedPlanToLot, gardenElementVocabulary } from '../gardenPlanDraft';

function draft(overrides: Partial<AnalyzedPlanDraft> = {}): AnalyzedPlanDraft {
  return {
    plan_kind: 'site_plan',
    lot_polygon: null,
    zones: [],
    elements: [],
    north_heading_degrees: null,
    notes: null,
    ...overrides,
  };
}

describe('gardenElementVocabulary', () => {
  it('offers the whole preset catalogue', () => {
    const vocabulary = gardenElementVocabulary();
    expect(vocabulary.length).toBeGreaterThan(50);
    // The ids the user asked for by name, spot-checked.
    expect(vocabulary).toEqual(expect.arrayContaining(['shed', 'driveway', 'pool', 'deck']));
  });

  it('has no duplicates — the model is told to pick exactly one', () => {
    const vocabulary = gardenElementVocabulary();
    expect(new Set(vocabulary).size).toBe(vocabulary.length);
  });
});

describe('fitAnalyzedPlanToLot — the transform', () => {
  it('stretches the model\'s lot bbox to fill plan space', () => {
    // The drawing sits in the middle half of the page; after fitting, its
    // corners must be the corners of the plan.
    const result = fitAnalyzedPlanToLot(
      draft({
        lot_polygon: [
          { x: 0.25, y: 0.25 },
          { x: 0.75, y: 0.25 },
          { x: 0.75, y: 0.75 },
          { x: 0.25, y: 0.75 },
        ],
        zones: [
          {
            kind: 'house',
            label: null,
            polygon: [
              { x: 0.25, y: 0.25 },
              { x: 0.5, y: 0.25 },
              { x: 0.5, y: 0.5 },
              { x: 0.25, y: 0.5 },
            ],
            confidence: 0.9,
          },
        ],
      }),
    );

    expect(result.zones).toHaveLength(1);
    const ring = result.zones[0].ring;
    expect(ring[0].x).toBeCloseTo(0, 6);
    expect(ring[0].y).toBeCloseTo(0, 6);
    expect(ring[1].x).toBeCloseTo(0.5, 6);
    expect(ring[2].y).toBeCloseTo(0.5, 6);
  });

  it('falls back to the identity when the model found no lot outline', () => {
    // The aerial-photo case: the member cropped to their yard, so the image IS
    // the lot and the coordinates pass straight through.
    const result = fitAnalyzedPlanToLot(
      draft({
        lot_polygon: null,
        zones: [
          {
            kind: 'back_yard',
            label: null,
            polygon: [
              { x: 0.1, y: 0.1 },
              { x: 0.9, y: 0.1 },
              { x: 0.9, y: 0.9 },
              { x: 0.1, y: 0.9 },
            ],
            confidence: null,
          },
        ],
      }),
    );
    expect(result.zones[0].ring[0]).toEqual({ x: 0.1, y: 0.1 });
    expect(result.zones[0].ring[2]).toEqual({ x: 0.9, y: 0.9 });
  });

  it('falls back to the identity for a DEGENERATE lot rather than dividing by zero', () => {
    // Every corner on one line — a real model failure. A naive 1/span here is
    // Infinity, and Infinity coordinates render as an invisible element.
    const result = fitAnalyzedPlanToLot(
      draft({
        lot_polygon: [
          { x: 0.2, y: 0.5 },
          { x: 0.5, y: 0.5 },
          { x: 0.8, y: 0.5 },
        ],
        zones: [
          {
            kind: 'garden',
            label: null,
            polygon: [
              { x: 0.2, y: 0.2 },
              { x: 0.4, y: 0.2 },
              { x: 0.4, y: 0.4 },
            ],
            confidence: null,
          },
        ],
      }),
    );
    for (const point of result.zones[0].ring) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
    expect(result.zones[0].ring[0]).toEqual({ x: 0.2, y: 0.2 });
  });

  it('scales element SIZES but does not translate them', () => {
    const result = fitAnalyzedPlanToLot(
      draft({
        lot_polygon: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0 },
          { x: 0.5, y: 0.5 },
          { x: 0, y: 0.5 },
        ],
        elements: [
          {
            preset: 'shed',
            label: null,
            x: 0.25,
            y: 0.25,
            width: 0.1,
            height: 0.1,
            rotation: 0,
            confidence: 0.8,
          },
        ],
      }),
    );
    expect(result.elements).toHaveLength(1);
    // The lot occupies half the page, so the transform doubles everything.
    expect(result.elements[0].x).toBeCloseTo(0.5, 6);
    expect(result.elements[0].width).toBeCloseTo(0.2, 6);
  });
});

describe('fitAnalyzedPlanToLot — defending against the model', () => {
  it('drops a preset it cannot resolve rather than guessing', () => {
    const result = fitAnalyzedPlanToLot(
      draft({
        elements: [
          {
            preset: 'helipad',
            label: null,
            x: 0.5,
            y: 0.5,
            width: 0.1,
            height: 0.1,
            rotation: 0,
            confidence: 1,
          },
          {
            preset: 'shed',
            label: null,
            x: 0.5,
            y: 0.5,
            width: 0.1,
            height: 0.1,
            rotation: 0,
            confidence: 1,
          },
        ],
      }),
    );
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0].metadata?.presetId).toBe('shed');
  });

  it('drops a zone with too few corners', () => {
    const result = fitAnalyzedPlanToLot(
      draft({
        zones: [
          {
            kind: 'house',
            label: null,
            polygon: [
              { x: 0.1, y: 0.1 },
              { x: 0.2, y: 0.2 },
            ],
            confidence: null,
          },
        ],
      }),
    );
    expect(result.zones).toHaveLength(0);
  });

  it('maps an unknown zone kind onto "other" instead of discarding the shape', () => {
    // The shape is still useful even when the label is not — the member can
    // rename it. Discarding it would throw away the traced geometry.
    const result = fitAnalyzedPlanToLot(
      draft({
        zones: [
          {
            kind: 'orchard',
            label: 'Orchard',
            polygon: [
              { x: 0.1, y: 0.1 },
              { x: 0.5, y: 0.1 },
              { x: 0.5, y: 0.5 },
            ],
            confidence: null,
          },
        ],
      }),
    );
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0].kind).toBe('other');
    // The model's own label survives, so the member keeps the useful half.
    expect(result.zones[0].label).toBe('Orchard');
  });

  it('names an unlabelled zone from its kind', () => {
    const result = fitAnalyzedPlanToLot(
      draft({
        zones: [
          {
            kind: 'back_yard',
            label: '   ',
            polygon: [
              { x: 0.1, y: 0.1 },
              { x: 0.5, y: 0.1 },
              { x: 0.5, y: 0.5 },
            ],
            confidence: null,
          },
        ],
      }),
    );
    expect(result.zones[0].label).toBe('Back yard');
  });

  it('marks every element as AI-drafted so the UI can say so', () => {
    const result = fitAnalyzedPlanToLot(
      draft({
        elements: [
          {
            preset: 'pool',
            label: null,
            x: 0.5,
            y: 0.5,
            width: 0.2,
            height: 0.1,
            rotation: 0,
            confidence: 0.7,
          },
        ],
      }),
    );
    expect(result.elements[0].metadata?.aiDrafted).toBe(true);
  });

  it('gives every element a distinct id', () => {
    const element = {
      preset: 'tree',
      label: null,
      x: 0.5,
      y: 0.5,
      width: 0.1,
      height: 0.1,
      rotation: 0,
      confidence: 1,
    };
    const result = fitAnalyzedPlanToLot(draft({ elements: [element, element, element] }));
    expect(new Set(result.elements.map((e) => e.id)).size).toBe(3);
  });

  it('surfaces a north heading rather than applying it', () => {
    const result = fitAnalyzedPlanToLot(draft({ north_heading_degrees: 45 }));
    expect(result.northHeadingDegrees).toBe(45);
  });
});
