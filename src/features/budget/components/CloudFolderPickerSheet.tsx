/**
 * Budget's spelling of the shared cloud folder browser.
 *
 * The component moved to `@components/backup/CloudFolderPickerSheet` when House
 * needed the same drill-down. It only ever called provider-level helpers (now
 * `@services/cloud-storage/backupProviders`), never Budget's own destinations.
 */
export {
  CloudFolderPickerSheet,
  type PickedCloudFolder,
} from '@components/backup/CloudFolderPickerSheet';
