import { HealthChallengesScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health Food Challenges management (reached from the Home widget's
 * pencil icon and empty-state button, not a pinned/hidden tab).
 */
export default function HealthChallengesTab() {
  return (
    <HealthFeatureRoute feature="calories">
      <HealthChallengesScreen />
    </HealthFeatureRoute>
  );
}
