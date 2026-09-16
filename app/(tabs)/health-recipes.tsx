import { HealthRecipesScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health recipes section (starts in the "More" hub).
 *
 * Redirects Home when `recipes` is switched off.
 */
export default function HealthRecipesTab() {
  return (
    <HealthFeatureRoute feature="recipes">
      <HealthRecipesScreen />
    </HealthFeatureRoute>
  );
}
