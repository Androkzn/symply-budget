import {
  buildRecoveryPhraseFileText as buildText,
  exportRecoveryPhraseFile as exportFile,
  forgetRecoveryPhraseFolder as forgetFolder,
  getRecoveryPhraseFolder as getFolder,
  recoveryPhraseFileName as fileName,
  rememberRecoveryPhraseFolder as rememberFolder,
  type RecoveryPhraseDestination,
  type RecoveryPhraseFileApp,
  type RecoveryPhraseFileResult,
} from '@services/backup/recoveryPhraseFile';

import {
  BUDGET_BACKUP_DRIVE_FOLDER,
  budgetBackupDirectory,
  resolveCloudFolder,
  type RememberedDriveFolder,
} from './backupDestinations';

/**
 * Budget's binding of the shared recovery-phrase file writer.
 *
 * The body lives in `@services/backup/recoveryPhraseFile`, which House uses
 * too. Only what is genuinely Budget's is here: the strings that name the app
 * on the file, and the two pointers that decide where `device` and
 * `google-drive` saves land. Those pointers are the reason this binding is not
 * just a re-export — resolving them through Budget's own
 * `backupDestinations` is what keeps one app's phrase out of the other's
 * folder.
 */
export {
  RECOVERY_PHRASE_FILE_FAILED_MESSAGE,
  recoveryPhraseWords,
  type RecoveryPhraseDestination,
  type RecoveryPhraseFileResult,
  type RecoveryPhraseFileStatus,
} from '@services/backup/recoveryPhraseFile';

/**
 * Keyed `budget.` and separate from the backups' own folder pointer — moving
 * the phrase must never move the archives. See `getRecoveryPhraseFolder`.
 */
const PHRASE_FOLDER_STORAGE_KEY = 'budget.recoveryPhrase.driveFolder';

export const BUDGET_RECOVERY_PHRASE_APP: RecoveryPhraseFileApp = {
  label: 'Symply Budget',
  slug: 'symply-budget',
  contents: 'your budget',
  destinations: {
    directory: budgetBackupDirectory,
    defaultCloudFolder: () => resolveCloudFolder('google-drive'),
    defaultFolderName: BUDGET_BACKUP_DRIVE_FOLDER,
    folderStorageKey: PHRASE_FOLDER_STORAGE_KEY,
    logTag: '[budget-backup]',
  },
};

/** `2026-08-16-symply-budget-recovery-phrase.txt` */
export function recoveryPhraseFileName(now: Date = new Date()): string {
  return fileName(BUDGET_RECOVERY_PHRASE_APP.slug, now);
}

export function buildRecoveryPhraseFileText(phrase: string, now: Date = new Date()): string {
  return buildText(phrase, BUDGET_RECOVERY_PHRASE_APP, now);
}

export function getRecoveryPhraseFolder(): Promise<RememberedDriveFolder | null> {
  return getFolder(BUDGET_RECOVERY_PHRASE_APP);
}

export function rememberRecoveryPhraseFolder(folder: RememberedDriveFolder): Promise<void> {
  return rememberFolder(BUDGET_RECOVERY_PHRASE_APP, folder);
}

export function forgetRecoveryPhraseFolder(): Promise<void> {
  return forgetFolder(BUDGET_RECOVERY_PHRASE_APP);
}

export function exportRecoveryPhraseFile(
  phrase: string,
  destination: RecoveryPhraseDestination = 'share',
  now: Date = new Date(),
): Promise<RecoveryPhraseFileResult> {
  return exportFile(phrase, BUDGET_RECOVERY_PHRASE_APP, destination, now);
}
