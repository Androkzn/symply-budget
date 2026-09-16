import type { HouseholdSpace } from '@api/household-spaces';

/** Normalize tap coords to 0–100 to match stored plan bounding boxes. */
function toPercent(value: number): number {
  return value <= 1 ? value * 100 : value;
}

/**
 * Hit-test a tap against household spaces linked to a floor plan via
 * normalized bounding boxes (plan_x/y/width/height in 0–100).
 */
export function detectSpaceAtPoint(
  spaces: HouseholdSpace[],
  xPercent: number,
  yPercent: number,
  floorPlanId: string
): HouseholdSpace | null {
  const x = toPercent(xPercent);
  const y = toPercent(yPercent);

  const candidates = spaces.filter(
    (s) =>
      s.floor_plan_id === floorPlanId &&
      s.plan_x_percent != null &&
      s.plan_y_percent != null &&
      s.plan_width_percent != null &&
      s.plan_height_percent != null
  );

  for (const space of candidates) {
    const x1 = space.plan_x_percent!;
    const y1 = space.plan_y_percent!;
    const x2 = x1 + space.plan_width_percent!;
    const y2 = y1 + space.plan_height_percent!;
    if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
      return space;
    }
  }

  return null;
}
