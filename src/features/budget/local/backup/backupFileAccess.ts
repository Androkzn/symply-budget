/**
 * Budget's names for the shared backup-file plumbing.
 *
 * The implementation moved to `@services/backup/backupFileAccess` when House
 * needed the identical behaviour — it never referenced Budget in the first
 * place. This file stays as the Budget-facing spelling so every existing
 * caller, test and stored type keeps working unchanged.
 */
export {
  openBackupLocation as openBudgetBackupLocation,
  opensInFilesApp,
  type BackupLocation as BudgetBackupLocation,
  type BackupLocationKind as BudgetBackupLocationKind,
  type OpenBackupLocationResult,
} from '@services/backup/backupFileAccess';
