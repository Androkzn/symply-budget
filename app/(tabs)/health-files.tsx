import { HealthFilesScreen, HealthFeatureRoute } from '@features/health';

/**
 * Symply Health files section (starts in the "More" hub).
 *
 * Redirects Home when `files` is switched off.
 */
export default function HealthFilesTab() {
  return (
    <HealthFeatureRoute feature="files">
      <HealthFilesScreen />
    </HealthFeatureRoute>
  );
}
