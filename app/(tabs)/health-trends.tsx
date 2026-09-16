import { HealthTrendsScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health Trends section as a first-class (customizable) tab.
 *
 * Redirects Home when `trends` is switched off.
 */
export default function HealthTrendsTab() {
  return (
    <HealthFeatureRoute feature="trends">
      <HealthTrendsScreen />
    </HealthFeatureRoute>
  );
}
