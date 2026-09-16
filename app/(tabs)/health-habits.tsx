import { HealthHabitsScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health Habits section (starts in the "More" hub).
 *
 * Redirects Home when `habits` is switched off.
 */
export default function HealthHabitsTab() {
  return (
    <HealthFeatureRoute feature="habits">
      <HealthHabitsScreen />
    </HealthFeatureRoute>
  );
}
