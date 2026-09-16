/**
 * Budget's spelling of the shared backup option sheet.
 *
 * The component moved to `@components/backup/BackupOptionSheet` when House
 * needed the identical list — it never held Budget state, only what its caller
 * passed in. This file keeps the import path every Budget caller and test
 * already uses.
 */
export { BackupOptionSheet, type BackupOption } from '@components/backup/BackupOptionSheet';
