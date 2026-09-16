import type { HouseholdSpace } from '@api/household-spaces';
import { detectSpaceAtPoint } from '@utils/spaceHitTest';

function makeSpace(overrides: Partial<HouseholdSpace> & { id: string; name: string }): HouseholdSpace {
  return {
    version: 1,
    household_id: 'hh1',
    space_type: 'preset',
    category: 'indoor',
    floor_level: null,
    icon_emoji: null,
    icon_color: null,
    custom_image_key: null,
    custom_image_url: null,
    description: null,
    area_sqft: null,
    display_order: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('detectSpaceAtPoint', () => {
  const floorPlanId = 'fp1';

  it('returns null when no spaces match the floor plan', () => {
    const spaces = [makeSpace({ id: '1', name: 'Kitchen', floor_plan_id: 'other' })];
    expect(detectSpaceAtPoint(spaces, 50, 50, floorPlanId)).toBeNull();
  });

  it('detects a hit inside a bounding box (0-100 coords)', () => {
    const spaces = [
      makeSpace({
        id: 'bath',
        name: 'Main Bathroom',
        floor_plan_id: floorPlanId,
        plan_x_percent: 10,
        plan_y_percent: 20,
        plan_width_percent: 30,
        plan_height_percent: 25,
      }),
    ];
    const hit = detectSpaceAtPoint(spaces, 25, 30, floorPlanId);
    expect(hit?.id).toBe('bath');
    expect(hit?.name).toBe('Main Bathroom');
  });

  it('normalizes 0-1 tap coordinates to percent', () => {
    const spaces = [
      makeSpace({
        id: 'garage',
        name: 'Garage',
        floor_plan_id: floorPlanId,
        plan_x_percent: 0,
        plan_y_percent: 0,
        plan_width_percent: 50,
        plan_height_percent: 50,
      }),
    ];
    const hit = detectSpaceAtPoint(spaces, 0.25, 0.25, floorPlanId);
    expect(hit?.id).toBe('garage');
  });

  it('returns null outside all boxes', () => {
    const spaces = [
      makeSpace({
        id: 'bath',
        name: 'Bathroom',
        floor_plan_id: floorPlanId,
        plan_x_percent: 0,
        plan_y_percent: 0,
        plan_width_percent: 10,
        plan_height_percent: 10,
      }),
    ];
    expect(detectSpaceAtPoint(spaces, 90, 90, floorPlanId)).toBeNull();
  });
});
