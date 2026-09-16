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
  HOUSE_BACKUP_DRIVE_FOLDER,
  houseBackupDirectory,
  resolveCloudFolder,
  type RememberedDriveFolder,
} from './backupDestinations';

/**
 * House's binding of the shared recovery-phrase file writer.
 *
 * The body lives in `@services/backup/recoveryPhraseFile`, which Budget uses
 * too. Only what is genuinely House's is here: the strings that name the app on
 * the file, and the two pointers that decide where `device` and `google-drive`
 * saves land. Those pointers are the reason this binding is not just a
 * re-export — resolving them through House's own `backupDestinations` is what
 * keeps one app's phrase out of the other's folder.
 *
 * House shipped without them, which left the sheet offering Copy + a share
 * sheet and the writer answering `unsupported` for Drive — the twelve words
 * that open a home's only backup could not be put anywhere that survives the
 * phone. Filling them in is what turns those two buttons into the three Budget
 * already offers.
 */
export {
  RECOVERY_PHRASE_FILE_FAILED_MESSAGE,
  recoveryPhraseWords,
  type RecoveryPhraseDestination,
  type RecoveryPhraseFileResult,
  type RecoveryPhraseFileStatus,
} from '@services/backup/recoveryPhraseFile';

/**
 * Keyed `house.` and separate from the backups' own folder pointer — moving the
 * phrase must never move the archives. See `getRecoveryPhraseFolder`.
 */
const PHRASE_FOLDER_STORAGE_KEY = 'house.recoveryPhrase.driveFolder';

export const HOUSE_RECOVERY_PHRASE_APP: RecoveryPhraseFileApp = {
  label: 'Symply House',
  slug: 'symply-house',
  contents: 'everything in your home',
  destinations: {
    directory: houseBackupDirectory,
    defaultCloudFolder: () => resolveCloudFolder('google-drive'),
    defaultFolderName: HOUSE_BACKUP_DRIVE_FOLDER,
    folderStorageKey: PHRASE_FOLDER_STORAGE_KEY,
    logTag: '[house-backup]',
  },
};

/** `2026-08-31-symply-house-recovery-phrase.txt` */
export function recoveryPhraseFileName(now: Date = new Date()): string {
  return fileName(HOUSE_RECOVERY_PHRASE_APP.slug, now);
}

export function buildRecoveryPhraseFileText(phrase: string, now: Date = new Date()): string {
  return buildText(phrase, HOUSE_RECOVERY_PHRASE_APP, now);
}

export function getRecoveryPhraseFolder(): Promise<RememberedDriveFolder | null> {
  return getFolder(HOUSE_RECOVERY_PHRASE_APP);
}

export function rememberRecoveryPhraseFolder(folder: RememberedDriveFolder): Promise<void> {
  return rememberFolder(HOUSE_RECOVERY_PHRASE_APP, folder);
}

export function forgetRecoveryPhraseFolder(): Promise<void> {
  return forgetFolder(HOUSE_RECOVERY_PHRASE_APP);
}

export function exportRecoveryPhraseFile(
  phrase: string,
  destination: RecoveryPhraseDestination = 'share',
  now: Date = new Date(),
): Promise<RecoveryPhraseFileResult> {
  return exportFile(phrase, HOUSE_RECOVERY_PHRASE_APP, destination, now);
}
