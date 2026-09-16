import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import {
  cloudProviderLabel,
  cloudServiceFor,
  describeCloudFolder,
  isCloudProviderConfigured,
  type RememberedCloudFolder,
} from '@services/cloud-storage/backupProviders';
import { CloudReauthRequiredError, type CloudStorageService } from '@services/cloud-storage/types';

/**
 * "Save the recovery phrase as a file", to any of the places a backup can go.
 *
 * The phrase is the only thing standing between a user and an archive they can
 * never open again, and a clipboard is the worst possible place to keep it: it
 * is overwritten by the next copy, and on iOS every other app can read it. So
 * the phrase is never copied on the user's behalf — it is shown, and from there
 * the user chooses where it goes.
 *
 * The three destinations are the three honest answers to "where should this
 * live", and they are deliberately the same three the backup itself offers:
 *
 *  - `google-drive` — beside the archives, in the folder they already go to.
 *    The only one that survives losing the phone with no further action.
 *  - `device`       — the app's own Documents folder, reachable in Files. Fast,
 *    and gone with the phone: fine as a second copy, not as the only one.
 *  - `share`        — the OS sheet, for a password manager, Mail to yourself,
 *    iCloud Drive, or anywhere else this app does not know about.
 *
 * Written for Budget, shared with House. Everything that differs between the
 * two apps — the strings on the file, and *where* `device`/`google-drive` put
 * it — arrives through `RecoveryPhraseFileApp` rather than a second copy of
 * this file. An app that supplies no `destinations` gets the share sheet and
 * honest `unsupported` answers for the other two, which is what House shipped
 * with; it never gets a guessed folder.
 */

export type RecoveryPhraseDestination = 'google-drive' | 'device' | 'share';

export type RecoveryPhraseFileStatus =
  | 'saved'
  | 'shared'
  | 'needs_auth'
  | 'cancelled'
  | 'unsupported'
  | 'failed';

export interface RecoveryPhraseFileResult {
  status: RecoveryPhraseFileStatus;
  message: string;
  /** Where it landed, when there is somewhere to name. */
  location?: string | null;
}

/**
 * Where an app's `device` and `google-drive` saves go.
 *
 * Deliberately functions rather than values: a directory is read from native
 * file-system state and a default folder may have to be created on the
 * provider, so neither can be computed at module load.
 */
export interface RecoveryPhraseDestinations {
  /** The app's own backups directory, for `device`. */
  directory: () => string;
  /** Where a cloud save lands when the member has picked nothing. */
  defaultCloudFolder: () => Promise<RememberedCloudFolder>;
  /**
   * That folder's name, for the sheet to show before anything is picked.
   *
   * A plain string beside the resolver above because the sheet needs it to
   * render, and `defaultCloudFolder()` reaches the provider — a UI label is not
   * worth a network round trip, still less one per opening.
   */
  defaultFolderName: string;
  /**
   * This app's key for its phrase-folder pointer.
   *
   * Per app, and separate from that app's *backups* pointer — see
   * `getRecoveryPhraseFolder`.
   */
  folderStorageKey: string;
  /** Prefixes this module's warnings so a log line names the app it came from. */
  logTag: string;
}

/** The app the phrase belongs to, in the places the file names it. */
export interface RecoveryPhraseFileApp {
  /** "Symply Budget" / "Symply House" — the heading and the closing sentence. */
  label: string;
  /** `symply-budget` / `symply-house` — the file-name stem. */
  slug: string;
  /** What someone holding the phrase could read: "your budget" / "your home". */
  contents: string;
  /** Omitted by an app that only offers the share sheet. */
  destinations?: RecoveryPhraseDestinations;
}

export const RECOVERY_PHRASE_FILE_FAILED_MESSAGE =
  'We could not put the phrase file together just now. Try again, or copy the words instead.';

/** Whitespace-tolerant split — the words are what matters, not the spacing. */
export function recoveryPhraseWords(phrase: string): string[] {
  return phrase.trim().split(/\s+/).filter(Boolean);
}

/**
 * `2026-08-16-symply-budget-recovery-phrase.txt` — dated, so two exports never
 * collide silently, and date-first for the same reason the archives are: this
 * file can land in the very folder they do, and a folder that sorts by date for
 * half its contents and by prefix for the other half sorts by neither.
 */
export function recoveryPhraseFileName(slug: string, now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${stamp}-${slug}-recovery-phrase.txt`;
}

/**
 * The file's body: the numbered words for reading back, then the phrase on one
 * line for pasting into the restore field, then what it is actually for.
 */
export function buildRecoveryPhraseFileText(
  phrase: string,
  app: RecoveryPhraseFileApp,
  now: Date = new Date(),
): string {
  const words = recoveryPhraseWords(phrase);
  const numbered = words.map((word, index) => `${String(index + 1).padStart(2, ' ')}. ${word}`);
  return [
    `${app.label} — backup recovery phrase`,
    `Saved ${now.toLocaleString()}`,
    '',
    ...numbered,
    '',
    'On one line (paste this into "Enter the recovery phrase"):',
    words.join(' '),
    '',
    `This phrase opens your ${app.label} backups. Without it a backup cannot be`,
    `restored by anyone — including us. Anyone who has it can read ${app.contents},`,
    'so keep this file somewhere private.',
    '',
  ].join('\n');
}

const PHRASE_MIME = 'text/plain';
const PHRASE_PROVIDER = 'google-drive' as const;

/**
 * The phrase's own cloud folder, when the member has chosen one.
 *
 * Separate from the backups' pointer on purpose. Beside the archives is a fine
 * DEFAULT — anyone who can read one folder of a Drive account can read them all,
 * so the co-location costs no real safety and makes the phrase findable in the
 * place you go looking for the backup. But it is only a default, and the member
 * may well want these twelve words somewhere they think of as private, or
 * simply somewhere else. Sharing the backups' key would move the archives too.
 */
export async function getRecoveryPhraseFolder(
  app: RecoveryPhraseFileApp,
): Promise<RememberedCloudFolder | null> {
  const key = app.destinations?.folderStorageKey;
  if (!key) return null;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedCloudFolder>;
    if (!parsed.id || !parsed.name) return null;
    return {
      id: parsed.id,
      name: parsed.name,
      ...(Array.isArray(parsed.path)
        ? { path: parsed.path.filter((part) => typeof part === 'string') }
        : {}),
      source: 'picked',
    };
  } catch {
    return null;
  }
}

export async function rememberRecoveryPhraseFolder(
  app: RecoveryPhraseFileApp,
  folder: RememberedCloudFolder,
): Promise<void> {
  const destinations = app.destinations;
  if (!destinations) return;
  try {
    await AsyncStorage.setItem(destinations.folderStorageKey, JSON.stringify(folder));
  } catch (error) {
    // Losing the pointer costs one fall back to the backups folder next time —
    // never fail the save that just succeeded over it.
    console.warn(`${destinations.logTag} could not remember the phrase folder`, error);
  }
}

export async function forgetRecoveryPhraseFolder(app: RecoveryPhraseFileApp): Promise<void> {
  const key = app.destinations?.folderStorageKey;
  if (!key) return;
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Nothing to do: the next resolve probes the pointer anyway.
  }
}

/**
 * Where a cloud save should land: the member's chosen folder, or the backups'.
 *
 * A chosen folder is probed before it is used. A remembered pointer goes stale
 * silently — the member deletes the folder in Drive's own app — and Drive
 * answers a write against a dead parent by putting the file at the account
 * root, which is how a phrase ends up somewhere nobody looks. A dead pointer is
 * dropped and the backups folder takes over rather than the save failing.
 */
async function resolvePhraseFolder(
  app: RecoveryPhraseFileApp,
  destinations: RecoveryPhraseDestinations,
  service: CloudStorageService,
): Promise<RememberedCloudFolder> {
  const chosen = await getRecoveryPhraseFolder(app);
  if (chosen) {
    if (!service.folderExists) return chosen;
    let stillThere: boolean;
    try {
      stillThere = await service.folderExists(chosen.id);
    } catch (error) {
      if (error instanceof CloudReauthRequiredError) throw error;
      // A probe that failed for its own reasons (offline, provider error) is
      // not Drive saying the folder is gone. Keep the choice; a dead parent
      // fails the write itself, and the next save probes again.
      console.warn(`${destinations.logTag} could not check the chosen phrase folder, keeping it`, error);
      return chosen;
    }
    if (stillThere) return chosen;
    console.warn(`${destinations.logTag} chosen phrase folder is gone, falling back`);
    await forgetRecoveryPhraseFolder(app);
  }
  return destinations.defaultCloudFolder();
}

/**
 * Hand the phrase file to the OS share sheet.
 *
 * The temp file is deleted in `finally` whether the share succeeded, failed, or
 * was cancelled — leaving a plaintext phrase sitting in the cache directory
 * would undo the point of not putting it on the clipboard.
 */
async function shareThePhraseFile(
  body: string,
  fileName: string,
): Promise<RecoveryPhraseFileResult> {
  const path = `${FileSystem.cacheDirectory ?? ''}${fileName}`;
  try {
    await FileSystem.writeAsStringAsync(path, body);
  } catch {
    return { status: 'failed', message: RECOVERY_PHRASE_FILE_FAILED_MESSAGE };
  }

  try {
    if (!(await Sharing.isAvailableAsync())) {
      return {
        status: 'unsupported',
        message: 'This device has no way to share files, so write the words down instead.',
      };
    }
    await Sharing.shareAsync(path, {
      mimeType: PHRASE_MIME,
      UTI: 'public.plain-text',
      dialogTitle: 'Save your recovery phrase',
    });
    return { status: 'shared', message: 'Handed to the share sheet.', location: path };
  } catch {
    return { status: 'failed', message: RECOVERY_PHRASE_FILE_FAILED_MESSAGE };
  } finally {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
  }
}

/**
 * Write the phrase file into the app's own backups folder.
 *
 * The same folder the on-device archives use, so Files shows the phrase beside
 * the backup it opens. This copy dies with the phone — which is exactly why the
 * message says so rather than calling it safe.
 */
async function savePhraseToDevice(
  destinations: RecoveryPhraseDestinations,
  body: string,
  fileName: string,
): Promise<RecoveryPhraseFileResult> {
  try {
    const dir = destinations.directory();
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const uri = `${dir}${fileName}`;
    await FileSystem.writeAsStringAsync(uri, body);
    return {
      status: 'saved',
      message: 'Saved on this device, next to your backups.',
      location: uri,
    };
  } catch {
    return { status: 'failed', message: RECOVERY_PHRASE_FILE_FAILED_MESSAGE };
  }
}

/**
 * Upload the phrase file to the backup folder in the member's Drive.
 *
 * Interactive by definition — this only ever runs from a button the member just
 * pressed, so an unauthenticated account may raise consent rather than failing
 * the way a scheduled backup has to.
 */
async function savePhraseToCloud(
  app: RecoveryPhraseFileApp,
  destinations: RecoveryPhraseDestinations,
  body: string,
  fileName: string,
): Promise<RecoveryPhraseFileResult> {
  const label = cloudProviderLabel(PHRASE_PROVIDER);
  const service = cloudServiceFor(PHRASE_PROVIDER);

  if (!service.uploadFile || !isCloudProviderConfigured(PHRASE_PROVIDER)) {
    return { status: 'unsupported', message: `${label} is not set up in this build.` };
  }

  try {
    if (!(await service.isAuthenticated())) await service.authenticate();
  } catch (error) {
    if (error instanceof CloudReauthRequiredError) {
      return { status: 'needs_auth', message: error.message };
    }
    // Backing out of the consent screen is a choice, not a failure.
    const message = error instanceof Error ? error.message : '';
    if (/cancel/i.test(message)) {
      return { status: 'cancelled', message: `${label} sign-in cancelled.` };
    }
    return { status: 'needs_auth', message: `Could not connect to ${label}. Please try again.` };
  }

  try {
    const folder = await resolvePhraseFolder(app, destinations, service);
    const uploaded = await service.uploadFile({
      name: fileName,
      content: body,
      mimeType: PHRASE_MIME,
      folderId: folder.id,
    });
    return {
      status: 'saved',
      // The full trail for a picked folder, not just its leaf name: "Finance"
      // sends someone hunting the root, "Documents › 2026 › Finance" does not.
      message: `Saved to ${label}, in ${describeCloudFolder(folder)}.`,
      location: uploaded.id,
    };
  } catch (error) {
    if (error instanceof CloudReauthRequiredError) {
      return { status: 'needs_auth', message: error.message };
    }
    return { status: 'failed', message: `Could not save the phrase to ${label}.` };
  }
}

/**
 * Put the recovery phrase somewhere it will still be there when it is needed.
 *
 * An empty phrase is refused before anything is written: a file holding no
 * words would look like a saved phrase and open nothing.
 */
export async function exportRecoveryPhraseFile(
  phrase: string,
  app: RecoveryPhraseFileApp,
  destination: RecoveryPhraseDestination = 'share',
  now: Date = new Date(),
): Promise<RecoveryPhraseFileResult> {
  const words = recoveryPhraseWords(phrase);
  if (words.length === 0) {
    return { status: 'failed', message: RECOVERY_PHRASE_FILE_FAILED_MESSAGE };
  }

  const fileName = recoveryPhraseFileName(app.slug, now);
  const body = buildRecoveryPhraseFileText(phrase, app, now);

  if (destination === 'share') return shareThePhraseFile(body, fileName);

  // Asked for a place this app never wired up. Said plainly rather than
  // quietly falling back to the share sheet: a member who pressed "Drive"
  // and got the OS sheet would reasonably read it as Drive having failed.
  const destinations = app.destinations;
  if (!destinations) {
    return {
      status: 'unsupported',
      message: `${app.label} cannot save the phrase there. Use Share instead.`,
    };
  }

  if (destination === 'device') return savePhraseToDevice(destinations, body, fileName);
  return savePhraseToCloud(app, destinations, body, fileName);
}
