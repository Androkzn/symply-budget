import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';

/**
 * "Where did my backup go", as something the phone can act on.
 *
 * Written for Budget first (`features/budget/local/backup/backupFileAccess.ts`,
 * now a re-export of this file) and lifted here unchanged when House needed the
 * same answer. Nothing in it is app-specific: it takes a uri and a file name and
 * either reveals the file or hands it to the share sheet.
 *
 * The save destinations used to answer that question in prose, inside the same
 * paragraph as the recovery phrase: *"Saved on this device as
 * symply-budget-backup-2026-08-16-0915.json. Find it in Files → On My iPhone →
 * Budget → budget-backups."* Three things were wrong with it.
 *
 *  - It asked the user to walk a four-level path by hand, from memory, in
 *    another app — the one moment they are also being told to write down twelve
 *    words they will never be shown again.
 *  - The folder it named did not exist. "Budget" is hardcoded, but the folder
 *    Files shows is `CFBundleDisplayName`, which is "Symply Budget" (and
 *    "Symply House", "Symply Kaizen", … in the sibling brands).
 *  - It said "On My iPhone" on Android, where the directory is app-private and
 *    no file manager can reach it at all.
 *
 * So a destination now returns a `BackupLocation`: the place in the user's
 * words, an optional breadcrumb that is already correct for this platform and
 * brand, and — the part that matters — a uri the OS can open.
 */

export type BackupLocationKind = 'device' | 'folder' | 'cloud' | 'handoff';

export type BackupLocation = {
  kind: BackupLocationKind;
  /** Where it landed, in the user's words. Never a filesystem path. */
  where: string;
  /**
   * The trail to walk by hand when there is no Open button — already resolved
   * for this platform and this brand. Null when no trail exists (the folder is
   * app-private, or the user chose the destination themselves and we were never
   * told which one).
   */
  breadcrumb: string[] | null;
  fileName: string;
  /**
   * Something `openBackupLocation` can act on later, or null when nothing
   * durable was left behind — the share-sheet copies live in the cache
   * directory and are deleted the moment the sheet closes. Null is also what
   * tells the UI not to offer an Open button it cannot honour.
   */
  uri: string | null;
  /** Ionicons glyph for the location card. */
  icon: string;
};

export type OpenBackupLocationResult =
  | { status: 'opened' }
  | { status: 'shared' }
  | { status: 'unavailable'; message: string };

const BACKUP_MIME = 'application/json';

/**
 * The scheme the Files app registers for documents it can already see — which
 * is exactly our Documents directory, because the iOS build ships
 * `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace`. Opening
 * `shareddocuments:///var/mobile/.../Documents/budget-backups/x.json` lands the
 * user *in* that folder instead of describing the route to it.
 *
 * It is deliberately reached through `openURL` and not `canOpenURL`:
 * `canOpenURL` answers false for any scheme missing from
 * `LSApplicationQueriesSchemes`, so probing first would refuse a URL that opens
 * perfectly well. A failure here is caught and falls through to the share
 * sheet, which is the supported path and the only one Android has.
 */
const FILES_APP_SCHEME = 'shareddocuments://';

/** True when the Open button should say "Open in Files" rather than "Share…". */
export function opensInFilesApp(uri: string | null | undefined): boolean {
  return Platform.OS === 'ios' && typeof uri === 'string' && uri.startsWith('file://');
}

/**
 * Show the user their backup file where it actually lives.
 *
 * Reveal-in-Files on iOS, share sheet everywhere else — and the share sheet
 * again whenever the reveal is refused, so the button never dead-ends.
 */
export async function openBackupLocation(
  location: Pick<BackupLocation, 'uri' | 'fileName'>,
): Promise<OpenBackupLocationResult> {
  const { uri, fileName } = location;

  if (!uri) {
    return {
      status: 'unavailable',
      message: 'This copy is not on the phone, so there is nothing here to open.',
    };
  }

  // Deleted from Files, or lost with the app's data, since it was written.
  // Saying so beats a share sheet that fails halfway through with no reason.
  if (uri.startsWith('file://')) {
    const info = await FileSystem.getInfoAsync(uri).catch(() => null);
    if (info && !info.exists) {
      return { status: 'unavailable', message: `${fileName} is no longer on this device.` };
    }
  }

  if (opensInFilesApp(uri)) {
    try {
      await Linking.openURL(`${FILES_APP_SCHEME}${uri.slice('file://'.length)}`);
      return { status: 'opened' };
    } catch (error) {
      console.warn('[backup] Files reveal refused, falling back to share', error);
    }
  }

  try {
    if (!(await Sharing.isAvailableAsync())) {
      return { status: 'unavailable', message: 'This device has no way to open that file.' };
    }
    await Sharing.shareAsync(uri, {
      mimeType: BACKUP_MIME,
      UTI: 'public.json',
      dialogTitle: fileName,
    });
    return { status: 'shared' };
  } catch (error) {
    console.error('[backup] open failed', error);
    return { status: 'unavailable', message: 'Could not open that backup file.' };
  }
}
