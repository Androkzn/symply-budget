import { describe, it, expect } from 'vitest';

import { formatRegion } from '../../services/floor-plan-region-pipeline';

describe('formatRegion', () => {
  it('parses JSON fields and builds /files URLs', () => {
    const formatted = formatRegion({
      id: 'reg_1',
      floor_plan_id: 'fp_1',
      kind: 'floor',
      name: 'Main Floor',
      level: 0,
      detached_type: null,
      sort_order: 1,
      bounding_box: JSON.stringify({ x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 }),
      spaces_json: JSON.stringify([
        {
          name: 'Kitchen',
          type: 'kitchen',
          is_outdoor: false,
          dimensions: { width: 10, length: 12, unit: 'ft' },
          area: { value: 120, unit: 'sq_ft' },
          position: { description: 'center' },
        },
      ]),
      status: 'completed',
      trace_status: 'skipped',
      error_message: null,
      crop_image_key: 'floor-plans/hh/fp/regions/reg_1/crop.png',
      vector_semantic_key: 'floor-plans/hh/fp/regions/reg_1/vector-semantic.svg',
      vector_trace_key: null,
      created_at: '2026-07-10T00:00:00.000Z',
      updated_at: '2026-07-10T00:00:00.000Z',
    });

    expect(formatted.id).toBe('reg_1');
    expect(formatted.kind).toBe('floor');
    expect(formatted.bounding_box).toEqual({ x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 });
    expect(formatted.spaces).toHaveLength(1);
    expect(formatted.spaces[0].name).toBe('Kitchen');
    expect(formatted.crop_image_url).toBe('/files/floor-plans/hh/fp/regions/reg_1/crop.png');
    expect(formatted.vector_semantic_url).toBe(
      '/files/floor-plans/hh/fp/regions/reg_1/vector-semantic.svg'
    );
    expect(formatted.vector_trace_url).toBeNull();
  });

  it('handles already-parsed bounding_box objects', () => {
    const formatted = formatRegion({
      id: 'reg_2',
      floor_plan_id: 'fp_1',
      kind: 'detached',
      name: 'Storage',
      level: null,
      detached_type: 'storage',
      sort_order: 0,
      bounding_box: { x1: 0, y1: 0, x2: 0.2, y2: 0.2 },
      spaces_json: null,
      status: 'skipped',
      trace_status: 'skipped',
      error_message: 'No raster available to crop region',
      crop_image_key: null,
      vector_semantic_key: null,
      vector_trace_key: null,
      created_at: '2026-07-10T00:00:00.000Z',
      updated_at: '2026-07-10T00:00:00.000Z',
    });

    expect(formatted.spaces).toEqual([]);
    expect(formatted.crop_image_url).toBeNull();
    expect(formatted.error_message).toContain('No raster');
  });
});
