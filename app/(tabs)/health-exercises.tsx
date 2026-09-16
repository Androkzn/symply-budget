import { HealthWorkoutLibraryScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health Workout Library section (starts in the "More" hub).
 *
 * Redirects Home when `workoutLibrary` is switched off.
 */
export default function HealthExercisesTab() {
  return (
    <HealthFeatureRoute feature="workoutLibrary">
      <HealthWorkoutLibraryScreen />
    </HealthFeatureRoute>
  );
}
