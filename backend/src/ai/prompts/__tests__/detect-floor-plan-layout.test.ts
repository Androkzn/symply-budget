import { describe, it, expect } from 'vitest';

import {
  FLOOR_PLAN_LAYOUT_USER_PROMPT,
  buildRegionSpacesUserPrompt,
  type FloorPlanLayoutResult,
} from '../detect-floor-plan-layout';

describe('detect-floor-plan-layout prompts', () => {
  it('layout prompt asks for floors and detached areas without deep spaces', () => {
    expect(FLOOR_PLAN_LAYOUT_USER_PROMPT).toContain('floors');
    expect(FLOOR_PLAN_LAYOUT_USER_PROMPT).toContain('detached_areas');
    expect(FLOOR_PLAN_LAYOUT_USER_PROMPT).toContain('bounding_box');
    expect(FLOOR_PLAN_LAYOUT_USER_PROMPT).toMatch(/Do NOT list individual rooms/i);
  });

  it('region spaces prompt is scoped to one named region', () => {
    const prompt = buildRegionSpacesUserPrompt('Main Floor', 'floor');
    expect(prompt).toContain('Main Floor');
    expect(prompt).toContain('floor');
    expect(prompt).toContain('spaces');
  });

  it('layout result shape supports the Surrey flyer regions', () => {
    const sample: FloorPlanLayoutResult = {
      property_address: '8135 138 Street, Surrey',
      total_area: { value: 1949, unit: 'sq_ft' },
      floors: [
        {
          name: 'Below Main Floor',
          level: -1,
          area: { value: 843, unit: 'sq_ft' },
          bounding_box: { x1: 0.05, y1: 0.35, x2: 0.48, y2: 0.95 },
        },
        {
          name: 'Main Floor',
          level: 0,
          area: { value: 1106, unit: 'sq_ft' },
          bounding_box: { x1: 0.5, y1: 0.35, x2: 0.95, y2: 0.95 },
        },
      ],
      detached_areas: [
        {
          name: 'Storage',
          type: 'storage',
          area: { value: null, unit: null },
          bounding_box: { x1: 0.05, y1: 0.12, x2: 0.22, y2: 0.28 },
        },
      ],
      excluded_from_living_area: {
        total: { value: 727, unit: 'sq_ft' },
        items: [
          { name: 'Deck', area: { value: 476, unit: 'sq_ft' } },
          { name: 'Garage', area: { value: 251, unit: 'sq_ft' } },
        ],
      },
      metadata: {
        multiple_floors: true,
        floor_count: 2,
        detached_area_count: 1,
        confidence: 'high',
        layout_type: 'side_by_side',
      },
    };

    expect(sample.floors).toHaveLength(2);
    expect(sample.detached_areas).toHaveLength(1);
    expect(sample.metadata.floor_count + sample.metadata.detached_area_count).toBe(3);
  });
});
