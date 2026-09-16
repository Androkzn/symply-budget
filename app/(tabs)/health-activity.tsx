import { HealthActivityScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health Activity section as a first-class (customizable) tab.
 *
 * Redirects Home when `workouts` is switched off.
 */
export default function HealthActivityTab() {
  return (
    <HealthFeatureRoute feature="workouts">
      <HealthActivityScreen />
    </HealthFeatureRoute>
  );
}
