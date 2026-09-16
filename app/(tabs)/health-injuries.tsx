import { HealthInjuriesScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health Injury Tracker section (starts in the "More" hub).
 *
 * Redirects Home when `injuries` is switched off.
 */
export default function HealthInjuriesTab() {
  return (
    <HealthFeatureRoute feature="injuries">
      <HealthInjuriesScreen />
    </HealthFeatureRoute>
  );
}
