import type { FloorPlan } from '@api/floor-plans';

/**
 * Card title: prefer floor label, else floor number, else generic.
 */
export function floorPlanDisplayLabel(
  floorPlan: Pick<FloorPlan, 'floor_label' | 'floor_number' | 'building_name'>
): string {
  if (floorPlan.floor_label) {
    return floorPlan.floor_label;
  }
  if (floorPlan.floor_number !== null && floorPlan.floor_number !== undefined) {
    return `Floor ${floorPlan.floor_number}`;
  }
  return floorPlan.building_name || 'Floor plan';
}
