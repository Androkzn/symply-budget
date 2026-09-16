import { HealthBodyScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health Body measurements section (starts in the "More" hub).
 *
 * Redirects Home when `body` is switched off.
 */
export default function HealthBodyTab() {
  return (
    <HealthFeatureRoute feature="body">
      <HealthBodyScreen />
    </HealthFeatureRoute>
  );
}
