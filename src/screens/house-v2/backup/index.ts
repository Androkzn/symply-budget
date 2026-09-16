/**
 * House V2 backup / restore / export screen (plan §10, H9).
 *
 * One screen, not two. Restore used to live on its own `HouseRestoreScreen`
 * behind its own Settings row; it now sits inside Backup & Restore the way
 * Budget's does — the archive list restores on tap, and "Restore from
 * elsewhere" reaches Drive, Dropbox and Files. Two doorways to one flow meant
 * two places to keep in step and no way to reach an on-device archive from the
 * screen that made it.
 */
export { HouseBackupScreen, default as HouseBackupScreenDefault } from './HouseBackupScreen';
export {
  backupDestinationLabel,
  deriveBackupHealth,
  formatBackupEntryLabel,
  formatBackupFileName,
  formatRelativeDay,
  type BackupEvidence,
  type BackupHealth,
} from './HouseBackupScreen';
export { HousePropertyPicker, type HousePropertyOption } from './HousePropertyPicker';
export {
  blobManifestSentence,
  formatBytes,
  formatCount,
  pluralRows,
  summaryRows,
  tableLabel,
  totalBlobBytes,
  type HouseBackupSummaryRow,
} from './houseBackupFormat';
