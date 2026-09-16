import { HealthAddFoodScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health "Add Food" (donor `AddNutritionEntrySheet`) — reached from the
 * Nutrition diary's meal-group "Add" button, e.g.
 * `router.push({ pathname: '/health-add-food', params: { slot: groupSlot } })`.
 *
 * A pushed route rather than a tab, same reasoning as `health-features.tsx`:
 * this is a step inside the Calories/meals flow, not a destination of its
 * own, so it must not take a slot in the customizable bar. Gated on the
 * `calories` feature — the tracker this screen serves — via the same
 * `HealthFeatureRoute` every tab route uses, so switching that feature off
 * makes this route un-navigable too, not just hidden from the bar.
 */
export default function HealthAddFoodRoute() {
  return (
    <HealthFeatureRoute feature="calories">
      <HealthAddFoodScreen />
    </HealthFeatureRoute>
  );
}
