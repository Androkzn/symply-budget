import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { ENV } from '@config/env';
import type { BackupLocation } from '@services/backup/backupFileAccess';
import {
  cloudProviderLabel,
  cloudServiceFor,
  isCloudProviderConfigured,
  logoutCloudProvider,
  rememberedFolderSource,
  type BackupCloudProvider,
  type RememberedCloudFolder,
} from '@services/cloud-storage/backupProviders';
import { CloudReauthRequiredError } from '@services/cloud-storage/types';

import { listLocalHouseProperties } from '../engine';

import { HOUSE_ALL_HOMES_ID, HOUSE_ALL_HOMES_LABEL, isAllHomesTarget } from './allHomes';
import { buildHouseBackupArchive, type HouseBackupScope } from './houseBackup';

/**
 * House V2 — where an encrypted backup archive can be written.
 *
 * A port of `budget/local/backup/backupDestinations.ts`, which is where every
 * decision in this file was argued out. The archive itself (and the 12-word
 * phrase that opens it) is produced by `houseBackup.ts`; this module only
 * decides *where the bytes land*. Every destination stores the exact same
 * sealed archive, so a backup written to one can always be restored from
 * another.
 *
 *  - `device`       — inside the app's own Documents folder. Survives app
 *                     restarts and, because the iOS build sets
 *                     UIFileSharingEnabled + LSSupportsOpeningDocumentsInPlace,
 *                     is also browsable in Files under "On My iPhone".
 *  - `files`        — the user picks the location. iOS has no save-panel API,
 *                     so this is the share sheet, whose "Save to Files" action
 *                     writes anywhere in On My iPhone / iCloud Drive. Android
 *                     gets a real folder picker via Storage Access Framework.
 *  - `google-drive` — uploaded to a dedicated Drive folder over `drive.file`.
 *  - `dropbox`      — uploaded to the app-folder-scoped Dropbox account.
 *  - `share`        — the plain share sheet (AirDrop, Mail, any installed app).
 *
 * `device`, `google-drive` and `dropbox` need no user interaction, which is
 * what makes them the only destinations scheduled backups can use — `files` and
 * `share` both open OS UI that nobody would be there to answer.
 *
 * ## Archives are property-addressed — including the one addressed to all of them
 *
 * The Budget original is already household-addressed (BR-016) and House needs
 * exactly that: a member holds 1–3 properties (H5), each with its own HDK, key
 * epoch and membership. So every listing, every prune and every file name here
 * is property-scoped, and an archive that cannot be attributed to a property is
 * never deleted by a sweep.
 *
 * A whole-device archive (`HOUSE_ALL_HOMES_ID`, one file holding every home in
 * its own section) travels those same paths, because it is addressed to a
 * household id like anything else. Two consequences are load-bearing:
 *
 *  - it LISTS for every home, since it really does contain every home. A status
 *    card that ignored it would tell a member with one whole-device backup that
 *    none of their three homes is protected;
 *  - it is never PRUNED by a per-home sweep. Three homes each keeping their last
 *    five would otherwise take turns deleting the same shared files, and the
 *    fifth-oldest whole-device archive would go because one home said so. The
 *    sweep is explicitly scoped (`pruneOldBackups`), and the whole-device bucket
 *    is swept only by a caller that says it means that bucket.
 */
export type HouseBackupDestination =
  | 'device'
  | 'files'
  | 'google-drive'
  | 'dropbox'
  | 'share';

/** Destinations a scheduled (unattended) backup can write to. */
export type HouseBackupCloudProvider = BackupCloudProvider;
export type HouseAutoBackupDestination = 'device' | 'files' | HouseBackupCloudProvider;

/**
 * The provider half — naming a provider, checking its credentials, re-running
 * its OAuth, browsing its folders — is shared with Budget rather than forked.
 */
export {
  cloudFolderAccess,
  cloudProviderLabel,
  cloudProviderSupportsFolderPicking,
  cloudServiceFor,
  createCloudFolder,
  describeCloudFolder,
  getCloudAccount,
  isCloudProviderConfigured,
  listCloudFolders,
  reconnectCloudProvider,
  rememberedFolderSource,
  type CloudAccount,
  type CloudFolderAccess,
  type RememberedFolderSource,
} from '@services/cloud-storage/backupProviders';

/**
 * Whether `destination` can run with nobody watching.
 *
 * `files` is the one that depends on the platform. Android's folder grant is
 * persistable, so a remembered folder is writable forever after; iOS can only
 * reach an arbitrary folder through the share sheet, which is OS UI that would
 * sit there unanswered. `share` never qualifies anywhere, for the same reason.
 */
export function autoBackupSupports(destination: HouseBackupDestination): boolean {
  switch (destination) {
    case 'device':
    case 'google-drive':
    case 'dropbox':
      return true;
    case 'files':
      return Platform.OS === 'android';
    default:
      return false;
  }
}

export function isCloudBackupProvider(
  destination: HouseBackupDestination,
): destination is HouseBackupCloudProvider {
  return destination === 'google-drive' || destination === 'dropbox';
}

/** Names any scheduled destination — the cloud ones plus the two local ones. */
export function autoBackupDestinationLabel(destination: HouseAutoBackupDestination): string {
  if (destination === 'device') return 'This device';
  if (destination === 'files') return 'A folder on this phone';
  return cloudProviderLabel(destination);
}

/**
 * Sign out of the provider and forget where its backups were going.
 *
 * Dropping the folder pointer is not tidiness — it is correctness. A folder id
 * only means anything inside the account that issued it; carried into a second
 * account it resolves to nothing (or, worse, to some unrelated folder that
 * happens to share the id space), and the next backup would land somewhere
 * nobody chose. Signing in again picks a folder again.
 *
 * Archives already uploaded are untouched: they belong to that Drive account,
 * and the member can still reach them by signing back into it.
 */
export async function disconnectCloudProvider(
  provider: HouseBackupCloudProvider,
): Promise<void> {
  await logoutCloudProvider(provider);
  await forgetCloudFolder(provider);
}

/**
 * Swap to a different account: sign out of the current one, then straight into
 * the consent screen. Done as one action because signing out and being left on
 * a "not connected" row is not what "use another account" asked for.
 */
export async function switchCloudAccount(provider: HouseBackupCloudProvider): Promise<void> {
  await disconnectCloudProvider(provider);
  await cloudServiceFor(provider).authenticate();
}

export type HouseBackupSaveStatus =
  | 'saved'
  | 'shared'
  | 'cancelled'
  | 'unsupported'
  | 'needs_auth'
  | 'failed';

export type HouseBackupSaveResult = {
  status: HouseBackupSaveStatus;
  destination: HouseBackupDestination;
  message: string;
  /**
   * The 12-word recovery phrase — the ONLY way to open the archive. Present
   * whenever the archive was built, even if the write then failed, so the UI
   * can still show it rather than silently losing a usable secret.
   */
  phrase: string | null;
  fileName: string | null;
  /**
   * Which property was sealed. Null only when the archive was never built, and
   * present on every other outcome so the caller can record the write against
   * the right home instead of assuming the active one.
   *
   * `HOUSE_ALL_HOMES_ID` for a whole-device archive — read `householdIds` for
   * the homes actually inside it.
   */
  householdId: string | null;
  /**
   * Every home the archive holds, in section order. One entry for a per-home
   * file. Empty only when the archive was never built.
   *
   * The caller records protection against these, not against `householdId`: a
   * whole-device file protects three homes, and filing that fact under a
   * pseudo-id would leave all three reading "No backup yet".
   */
  householdIds: string[];
  /** Whether the file holds one home or every home, sectioned. */
  scope: HouseBackupScope | null;
  /** Local path, SAF uri, or Drive file id — for display/logging only. */
  location: string | null;
  /**
   * Where the bytes landed, ready to render and — where the destination leaves
   * something durable behind — to open. Null on every outcome that wrote
   * nothing (cancelled, failed, needs_auth).
   */
  savedTo: BackupLocation | null;
};

/** What each `saveTo…` helper hands back before the shared fields are added. */
type SaveOutcome = {
  status: HouseBackupSaveStatus;
  message: string;
  location: string | null;
  savedTo?: BackupLocation | null;
};

/** Default cloud folder name. Created on first upload if nothing is remembered. */
export const HOUSE_BACKUP_DRIVE_FOLDER = 'Symply House Backups';

/**
 * Remembered cloud folder, per provider. Persisting the *id* (not just the
 * name) means every later backup lands in the same folder even if the user
 * renames it or moves it — and it stops a second folder of the same name being
 * created when the first one is nested somewhere the name query misses.
 */
const FOLDER_STORAGE_KEY: Record<HouseBackupCloudProvider, string> = {
  'google-drive': 'house.backup.driveFolder',
  dropbox: 'house.backup.dropboxFolder',
};

/** The pointer shape, shared with Budget. */
export type RememberedDriveFolder = RememberedCloudFolder;

export async function getRememberedCloudFolder(
  provider: HouseBackupCloudProvider,
): Promise<RememberedDriveFolder | null> {
  try {
    const raw = await AsyncStorage.getItem(FOLDER_STORAGE_KEY[provider]);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedDriveFolder>;
    if (!parsed.id || !parsed.name) return null;
    return {
      id: parsed.id,
      name: parsed.name,
      ...(Array.isArray(parsed.path)
        ? { path: parsed.path.filter((p) => typeof p === 'string') }
        : {}),
      ...(parsed.source === 'picked' ? { source: 'picked' as const } : {}),
    };
  } catch {
    return null;
  }
}

export async function rememberCloudFolder(
  provider: HouseBackupCloudProvider,
  folder: RememberedDriveFolder,
): Promise<void> {
  try {
    await AsyncStorage.setItem(FOLDER_STORAGE_KEY[provider], JSON.stringify(folder));
  } catch (error) {
    // Losing the pointer only costs a name lookup next time — never fail a backup over it.
    console.warn('[house-backup] could not remember cloud folder', provider, error);
  }
}

export async function forgetCloudFolder(provider: HouseBackupCloudProvider): Promise<void> {
  await AsyncStorage.removeItem(FOLDER_STORAGE_KEY[provider]).catch(() => undefined);
}

export const getRememberedDriveFolder = () => getRememberedCloudFolder('google-drive');

/**
 * Persist the folder the member chose in the Drive browser, so every later
 * backup — manual and scheduled — lands there without asking again.
 *
 * The id is what is actually written against, which is why renaming or moving
 * the folder in Drive does not break the pointer; `path` only feeds the label.
 */
export async function chooseCloudBackupFolder(
  provider: HouseBackupCloudProvider,
  folder: { id: string; name: string; path?: string[] },
): Promise<void> {
  await rememberCloudFolder(provider, { ...folder, source: 'picked' });
}

/**
 * Drop the pick and go back to the app's own folder on the next backup.
 *
 * Named `reset…` rather than `useDefault…` on purpose: a `use` prefix makes
 * React's lint rules read this as a hook and reject every call from inside a
 * callback, which is the only place it is ever called from.
 */
export async function resetCloudBackupFolder(
  provider: HouseBackupCloudProvider,
): Promise<void> {
  await forgetCloudFolder(provider);
}

/**
 * Folder to write to / read from, re-validating whatever was remembered and
 * re-persisting the answer so a stale pointer self-heals after one call.
 *
 * A PICKED folder is validated and never recreated. The two cases genuinely
 * differ: the app's own folder is ours to make again by name, but recreating a
 * folder the member chose would silently make a NEW folder of that name at the
 * account root — not the `Documents/2026/Home` they picked — and quietly
 * scatter archives somewhere they never agreed to. So a pick that has gone away
 * is dropped, and the next backup falls back to the app's own folder rather
 * than inventing a lookalike.
 *
 * Exported so the recovery phrase file can land in the SAME folder as the
 * archives it opens. Co-locating a plaintext key with the sealed data it
 * unlocks looks wrong at first glance, but the separation would be imaginary:
 * anyone who can read one folder of a Drive account can read every folder of
 * it, so a second folder buys no safety and costs the one thing that matters
 * when a phone is gone — finding the phrase in the same place as the backup.
 */
export async function resolveCloudFolder(
  provider: HouseBackupCloudProvider,
): Promise<RememberedDriveFolder> {
  const service = cloudServiceFor(provider);
  if (!service.ensureFolder) {
    throw new Error(`${cloudProviderLabel(provider)} folders are not available in this build.`);
  }
  const remembered = await getRememberedCloudFolder(provider);

  if (remembered && rememberedFolderSource(remembered) === 'picked') {
    // No `folderExists` (a provider that cannot probe) means we have nothing
    // better than the pointer itself — trust it rather than throw away a
    // deliberate choice on a capability gap.
    if (!service.folderExists) return remembered;
    let stillThere: boolean;
    try {
      stillThere = await service.folderExists(remembered.id);
    } catch (error) {
      // A revoked grant is the caller's problem to surface (it maps to
      // "reconnect"), and nothing below could succeed without one anyway.
      if (error instanceof CloudReauthRequiredError) throw error;
      // Everything else — offline, a provider hiccup — says nothing about the
      // folder. Keep the pick and let the write speak for itself: a genuinely
      // dead parent fails that write loudly, and the next run probes again.
      // Forgetting here is what used to move backups to a fresh root folder
      // after one flaky probe, without a word to the member.
      console.warn(
        '[house-backup] could not check the chosen cloud folder, keeping it',
        provider,
        error,
      );
      return remembered;
    }
    if (stillThere) return remembered;
    console.warn('[house-backup] chosen cloud folder is gone, falling back', provider);
    await forgetCloudFolder(provider);
  }

  const previous =
    remembered && rememberedFolderSource(remembered) === 'default' ? remembered : null;
  const name = previous?.name ?? HOUSE_BACKUP_DRIVE_FOLDER;
  const id = await service.ensureFolder(name, previous?.id ?? null);
  if (id !== previous?.id || name !== previous?.name) {
    await rememberCloudFolder(provider, { id, name, source: 'default' });
  }
  return { id, name, source: 'default' };
}

/** Sub-folder of the app's Documents dir holding on-device archives. */
const LOCAL_BACKUP_DIRNAME = 'house-backups';

const BACKUP_MIME = 'application/json';

export function houseBackupDirectory(): string {
  return `${FileSystem.documentDirectory ?? ''}${LOCAL_BACKUP_DIRNAME}/`;
}

/**
 * Separator between the half of an archive name a member reads and the half
 * this module parses. A single `-` cannot serve: property names are slugged
 * into `-`-joined words, so there would be no way to tell where the name ends
 * and the household token begins. Runs of `-` are collapsed everywhere else in
 * a name, which is what makes a doubled one an unambiguous marker.
 */
const HOUSEHOLD_TOKEN_SEPARATOR = '--';

/**
 * The machine-readable half of an archive name: a household id reduced to
 * characters every filesystem, Drive and Dropbox accept.
 *
 * Derived from the household ID, never from its name, and that is the whole
 * point — renaming "Home" to "Maple Street" must not orphan the archives already
 * written, which is exactly what a name-derived tag would do on the next prune.
 */
export function householdArchiveToken(householdId: string): string {
  return householdId
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The readable half — what tells three archives in one folder apart at a glance. */
function propertyNameSlug(propertyName: string): string {
  return (
    propertyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'home'
  );
}

/**
 * The household token carried by an archive name, or null when it carries none.
 *
 * Null means an archive written by the pre-destinations House build, whose name
 * was `symply-house-<slug>-<day>.backup.json` and said nothing about which
 * property it held. Those files are still perfectly restorable — the household
 * id is inside the sealed payload — they simply cannot be attributed from the
 * outside, which is what `archiveBelongsTo` has to be careful about.
 */
export function archiveHouseholdToken(fileName: string): string | null {
  const base = fileName.replace(/\.json$/i, '');
  const at = base.lastIndexOf(HOUSEHOLD_TOKEN_SEPARATOR);
  if (at < 0) return null;
  const token = base.slice(at + HOUSEHOLD_TOKEN_SEPARATOR.length);
  return token.length > 0 ? token : null;
}

/**
 * Every archive name this app has ever written starts with one of these — the
 * timestamped shape used on device and in the cloud, and the older
 * `symply-house-<slug>-<day>.backup.json` shape that the first H9 screen wrote
 * through the share sheet.
 */
const ARCHIVE_NAME_PREFIXES = ['symply-house-backup-', 'symply-house-'];

/**
 * True only for a file this app wrote as a backup archive.
 *
 * These listings do not merely display — `pruneOldBackups` DELETES everything
 * they return past `keepLast`, and on a single-property device
 * `archiveBelongsTo` adopts any untagged name as this home's. Without this
 * guard, choosing a folder that happened to contain `deed.json` would let a
 * scheduled backup delete it.
 *
 * The prefix is checked rather than the full shape so that hand-renamed
 * archives ("symply-house-backup-2026-08-17 (copy).json") still list and stay
 * restorable.
 */
function isHouseArchiveName(fileName: string): boolean {
  return (
    ARCHIVE_NAME_PREFIXES.some((prefix) => fileName.startsWith(prefix)) &&
    /\.json$/i.test(fileName)
  );
}

/**
 * True when this device holds exactly one property.
 *
 * It is the licence to treat an untagged archive as that property's: there is
 * only one home it could possibly have come from. The moment a second one
 * exists the inference is gone, and untagged archives become unattributable.
 */
function holdsOnePropertyOnly(): boolean {
  return listLocalHouseProperties().length <= 1;
}

/** The token a whole-device archive carries — derived, never spelled twice. */
const ALL_HOMES_TOKEN = householdArchiveToken(HOUSE_ALL_HOMES_ID);

/** True for a file holding every home on the device, one section each. */
export function archiveCoversAllHomes(fileName: string): boolean {
  return archiveHouseholdToken(fileName) === ALL_HOMES_TOKEN;
}

/**
 * Whether an archive counts as `householdId`'s for listing and pruning.
 *
 * Three cases, and the two that are not a plain token match both exist because
 * pruning DELETES:
 *
 *  - **untagged.** On a single-property device an untagged archive is
 *    unambiguously that home's. On a device that holds two or three it is
 *    unattributable, and the rule is that pruning never deletes a file it cannot
 *    attribute — a stale archive costs a few hundred kilobytes, deleting another
 *    home's only copy costs the home.
 *  - **whole-device.** It contains this home, so it counts as this home's for
 *    LISTING. It is not this home's to delete, which is why the sweep asks for
 *    it separately rather than reading this answer (see `pruneOldBackups`).
 */
function archiveBelongsTo(fileName: string, householdId: string, adoptUntagged: boolean): boolean {
  if (isAllHomesTarget(householdId)) return archiveCoversAllHomes(fileName);
  const token = archiveHouseholdToken(fileName);
  if (token === null) return adoptUntagged;
  if (token === ALL_HOMES_TOKEN) return true;
  return token === householdArchiveToken(householdId);
}

/**
 * `token → householdId` for every property on this device.
 *
 * Built once per listing rather than searched per file: attributing a folder of
 * archives is otherwise files × properties, and both listings below run on
 * every open of the Backup screen.
 */
function propertiesByToken(): Map<string, string> {
  const byToken = new Map<string, string>();
  for (const entry of listLocalHouseProperties()) {
    byToken.set(householdArchiveToken(entry.householdId), entry.householdId);
  }
  return byToken;
}

/**
 * The property an archive names, resolved back to a real one on this device.
 *
 * Null both when the name carries no token and when it carries one this device
 * has no property for (an archive from a home the member has since left).
 */
function resolveArchiveHousehold(fileName: string, byToken: Map<string, string>): string | null {
  const token = archiveHouseholdToken(fileName);
  if (!token) return null;
  return byToken.get(token) ?? null;
}

/**
 * Timestamped file name — two backups in one day must not overwrite each other.
 *
 * The property half exists because a member with three homes would otherwise
 * get three files called `symply-house-backup-2026-08-17-0915.json`, and the
 * only way to tell which home an archive held would be to spend a minute of
 * Argon2 opening it. The date still comes first, because every listing here
 * sorts by name to get newest-first and must keep doing so across properties.
 */
export function timestampedBackupFileName(
  now: Date = new Date(),
  property?: { householdId: string; propertyName: string },
): string {
  const iso = now.toISOString();
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 16).replace(':', '');
  const stamp = `symply-house-backup-${day}-${time}`;
  if (!property) return `${stamp}.json`;
  // A whole-device archive's readable half and its machine half are the same
  // word, so it carries the token alone: `…-0915--all-homes.json` rather than
  // `…-0915-all-homes--all-homes.json`.
  if (isAllHomesTarget(property.householdId)) {
    return `${stamp}${HOUSEHOLD_TOKEN_SEPARATOR}${ALL_HOMES_TOKEN}.json`;
  }
  const slug = propertyNameSlug(property.propertyName);
  const token = householdArchiveToken(property.householdId);
  return `${stamp}-${slug}${HOUSEHOLD_TOKEN_SEPARATOR}${token}.json`;
}

/**
 * How many archives a destination is meant to end up holding.
 *
 *  - `replace` — one file per property, rewritten in place every run. The
 *    default, because the overwhelmingly common wish is "keep my home safe",
 *    not "keep a history of my home", and the dated pile is what makes a
 *    backup folder unreadable after a month of daily runs.
 *  - `dated`   — the timestamped names, capped by `keepLast`. For anyone who
 *    wants to be able to go back to last Tuesday.
 *
 * The choice changes only the NAME a run writes under. Both modes produce the
 * identical sealed archive, so a backup made in one mode restores in the other.
 */
export type HouseBackupRetention = 'replace' | 'dated';

export const HOUSE_BACKUP_RETENTION_DEFAULT: HouseBackupRetention = 'replace';

const RETENTION_STORAGE_KEY = 'house.backup.retention';

export async function getHouseBackupRetention(): Promise<HouseBackupRetention> {
  try {
    const raw = await AsyncStorage.getItem(RETENTION_STORAGE_KEY);
    return raw === 'dated' || raw === 'replace' ? raw : HOUSE_BACKUP_RETENTION_DEFAULT;
  } catch {
    return HOUSE_BACKUP_RETENTION_DEFAULT;
  }
}

export async function setHouseBackupRetention(mode: HouseBackupRetention): Promise<void> {
  await AsyncStorage.setItem(RETENTION_STORAGE_KEY, mode);
}

/**
 * The `replace` name: no timestamp, so every run resolves to the same file and
 * the new archive lands on top of the old one.
 *
 * It still carries the property half — one file PER PROPERTY, not one file
 * total. Three homes sharing a name would overwrite each other.
 */
export function stableBackupFileName(property: {
  householdId: string;
  propertyName: string;
}): string {
  if (isAllHomesTarget(property.householdId)) {
    return `symply-house-backup${HOUSEHOLD_TOKEN_SEPARATOR}${ALL_HOMES_TOKEN}.json`;
  }
  const slug = propertyNameSlug(property.propertyName);
  const token = householdArchiveToken(property.householdId);
  return `symply-house-backup-${slug}${HOUSEHOLD_TOKEN_SEPARATOR}${token}.json`;
}

/** The name a run should write under, given the member's retention choice. */
export function backupFileNameFor(
  retention: HouseBackupRetention,
  property: { householdId: string; propertyName: string },
  now: Date = new Date(),
): string {
  return retention === 'replace'
    ? stableBackupFileName(property)
    : timestampedBackupFileName(now, property);
}

async function ensureLocalBackupDir(): Promise<string> {
  const dir = houseBackupDirectory();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

export type LocalHouseBackupEntry = {
  fileName: string;
  uri: string;
  size: number;
  /** ISO string, or null when the platform did not report a mtime. */
  modifiedAt: string | null;
  /**
   * Which property is inside, when the name says so and this device still holds
   * that home. Null for untagged archives, for archives belonging to a home the
   * member has left, and for whole-device archives (which name no single home —
   * read `coversAllHomes` for those). In every case the file is still
   * restorable, it just cannot be labelled without opening it.
   */
  householdId: string | null;
  /** True when this one file holds every home, one section each. */
  coversAllHomes: boolean;
};

/**
 * On-device archives, newest first.
 *
 * `householdId` narrows to one property's archives; omit it for every archive
 * on the device, which is what a "what have I got saved here" list wants. The
 * scheduler always narrows, because its retention cap is per property and a
 * prune that saw all of them would delete across the boundary.
 */
export async function listLocalHouseBackups(
  householdId?: string,
): Promise<LocalHouseBackupEntry[]> {
  const dir = houseBackupDirectory();
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) return [];

  const names = await FileSystem.readDirectoryAsync(dir);
  const adoptUntagged = holdsOnePropertyOnly();
  const byToken = propertiesByToken();
  const wanted = names.filter(
    (name) =>
      isHouseArchiveName(name) &&
      (!householdId || archiveBelongsTo(name, householdId, adoptUntagged)),
  );
  const entries = await Promise.all(
    wanted.map(async (fileName): Promise<LocalHouseBackupEntry> => {
      const uri = `${dir}${fileName}`;
      const info = await FileSystem.getInfoAsync(uri);
      // `modificationTime` is seconds since epoch and only present when the
      // file exists — guard both so a racing delete can't throw here.
      const mtime =
        info.exists && typeof info.modificationTime === 'number'
          ? new Date(info.modificationTime * 1000).toISOString()
          : null;
      return {
        fileName,
        uri,
        size: info.exists && typeof info.size === 'number' ? info.size : 0,
        modifiedAt: mtime,
        householdId: resolveArchiveHousehold(fileName, byToken),
        coversAllHomes: archiveCoversAllHomes(fileName),
      };
    }),
  );

  // Names are ISO-ordered, so a name sort is a valid recency sort and stays
  // correct when the platform withholds mtimes. The property half of the name
  // sits AFTER the timestamp precisely so this stays true across homes.
  return entries.sort((a, b) => b.fileName.localeCompare(a.fileName));
}

export async function readLocalHouseBackup(fileName: string): Promise<string> {
  return FileSystem.readAsStringAsync(`${houseBackupDirectory()}${fileName}`);
}

export async function deleteLocalHouseBackup(fileName: string): Promise<void> {
  await FileSystem.deleteAsync(`${houseBackupDirectory()}${fileName}`, { idempotent: true });
}

async function saveToDevice(archiveJson: string, fileName: string): Promise<SaveOutcome> {
  const dir = await ensureLocalBackupDir();
  const uri = `${dir}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, archiveJson);
  return {
    status: 'saved',
    message: 'Saved on this device.',
    location: uri,
    savedTo: {
      kind: 'device',
      where: 'On this device',
      // iOS surfaces the app's Documents folder in Files under the *display*
      // name, which is per brand ("Symply House", "Symply Budget", …) — never a
      // literal. Android keeps this directory app-private, so there is no trail
      // to offer and the Open button shares instead.
      breadcrumb:
        Platform.OS === 'ios'
          ? ['Files', 'On My iPhone', ENV.APP_NAME, LOCAL_BACKUP_DIRNAME]
          : null,
      fileName,
      uri,
      icon: 'phone-portrait-outline',
    },
  };
}

async function saveViaShareSheet(
  archiveJson: string,
  fileName: string,
  dialogTitle: string,
  /** How to describe the resting place the user picked inside the sheet. */
  landedAs: string,
): Promise<SaveOutcome> {
  // Share needs a real file on disk; cache is the right home for a throwaway
  // copy the OS reads synchronously during the sheet.
  const path = `${FileSystem.cacheDirectory ?? ''}${fileName}`;
  await FileSystem.writeAsStringAsync(path, archiveJson);
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return {
        status: 'unsupported',
        message: 'This device has no way to share files.',
        location: null,
      };
    }
    await Sharing.shareAsync(path, {
      mimeType: BACKUP_MIME,
      UTI: 'public.json',
      dialogTitle,
    });
    return {
      status: 'shared',
      message: 'Handed to the share sheet.',
      location: path,
      savedTo: {
        kind: 'handoff',
        where: landedAs,
        breadcrumb: null,
        fileName,
        // The cache copy is deleted in the `finally` below, and only the user
        // knows what the sheet did with it — so there is nothing to reopen.
        uri: null,
        icon: 'share-outline',
      },
    };
  } finally {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
  }
}

// --- The phone's own file system (Android) ------------------------------------

/**
 * A folder on the phone the member picked through the system folder picker,
 * plus the sub-folder this app made inside it for the archives.
 *
 * Android's Storage Access Framework hands back a **persistable** grant, which
 * is what makes this a real destination rather than a one-off save: the URI
 * keeps working after a restart, so scheduled runs can write to it with no
 * picker and nobody present. iOS has no equivalent.
 */
export type RememberedDeviceFolder = {
  /** The folder the member chose. Kept so the sub-folder can be remade if deleted. */
  rootUri: string;
  /** `<root>/Symply House Backups` — where archives actually go. */
  backupsUri: string;
  /** `Download/Symply House Backups` — for the settings row. */
  label: string;
};

const DEVICE_FOLDER_STORAGE_KEY = 'house.backup.deviceFolder';

/** Sub-folder made inside whatever the member picked, so archives never mix with their files. */
export const HOUSE_BACKUP_DEVICE_FOLDER = 'Symply House Backups';

/**
 * `…/tree/primary%3ADownload/document/primary%3ADownload%2FBackups` →
 * `Download/Backups`. Best-effort and display-only: a SAF URI is an opaque
 * handle, and the readable part of it is a convenience, never something to
 * address the folder by.
 */
function safFolderLabel(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    const afterColon = decoded.slice(decoded.lastIndexOf(':') + 1);
    return afterColon.replace(/^\/+|\/+$/g, '') || 'the folder you picked';
  } catch {
    return 'the folder you picked';
  }
}

export async function getRememberedDeviceFolder(): Promise<RememberedDeviceFolder | null> {
  try {
    const raw = await AsyncStorage.getItem(DEVICE_FOLDER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedDeviceFolder>;
    if (!parsed.rootUri || !parsed.backupsUri) return null;
    return {
      rootUri: parsed.rootUri,
      backupsUri: parsed.backupsUri,
      label: parsed.label ?? safFolderLabel(parsed.backupsUri),
    };
  } catch {
    return null;
  }
}

export async function forgetDeviceFolder(): Promise<void> {
  await AsyncStorage.removeItem(DEVICE_FOLDER_STORAGE_KEY).catch(() => undefined);
}

/** True when the SAF grant still resolves — a member can revoke it in Settings. */
async function deviceFolderIsUsable(folder: RememberedDeviceFolder): Promise<boolean> {
  try {
    await FileSystem.StorageAccessFramework.readDirectoryAsync(folder.backupsUri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask for a folder on the phone and make our own sub-folder inside it.
 *
 * The sub-folder is not decoration: the picker hands back somewhere like
 * `Download`, which is full of the member's own files, and dropping archives
 * loose among them is both untidy and the setup where a listing that DELETES
 * (see `pruneOldBackups`) is standing next to things it must never touch.
 *
 * Returns null when the member backed out of the picker.
 */
export async function chooseDeviceBackupFolder(): Promise<RememberedDeviceFolder | null> {
  const saf = FileSystem.StorageAccessFramework;
  const permission = await saf.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;

  const backupsUri = await ensureDeviceBackupsSubfolder(permission.directoryUri);
  const folder: RememberedDeviceFolder = {
    rootUri: permission.directoryUri,
    backupsUri,
    label: safFolderLabel(backupsUri),
  };
  await AsyncStorage.setItem(DEVICE_FOLDER_STORAGE_KEY, JSON.stringify(folder)).catch((error) => {
    // The grant itself is already taken; losing the note of it only costs one
    // more trip through the picker.
    console.warn('[house-backup] could not remember the device folder', error);
  });
  return folder;
}

/** Create-or-reuse `<root>/Symply House Backups`, returning its SAF uri. */
async function ensureDeviceBackupsSubfolder(rootUri: string): Promise<string> {
  const saf = FileSystem.StorageAccessFramework;
  try {
    const children = await saf.readDirectoryAsync(rootUri);
    const existing = children.find((child) => {
      const decoded = decodeURIComponent(child);
      return decoded.endsWith(`/${HOUSE_BACKUP_DEVICE_FOLDER}`);
    });
    if (existing) return existing;
  } catch (error) {
    // Fall through to creating it — a root we cannot list is one where the
    // create will fail loudly, which is the better error to surface.
    console.warn('[house-backup] could not read the chosen folder', error);
  }
  return saf.makeDirectoryAsync(rootUri, HOUSE_BACKUP_DEVICE_FOLDER);
}

/**
 * The folder to write to, or null when there is none and we may not ask.
 *
 * `allowInteractive` is false for scheduled runs, which must never throw a
 * system folder picker at somebody mid-task.
 */
async function resolveDeviceFolder(
  allowInteractive: boolean,
): Promise<RememberedDeviceFolder | null> {
  const remembered = await getRememberedDeviceFolder();
  if (remembered && (await deviceFolderIsUsable(remembered))) return remembered;
  if (remembered) {
    // The grant is dead (revoked, or the folder was deleted). Re-picking is the
    // only thing that can restore it, so drop the stale pointer.
    await forgetDeviceFolder();
  }
  return allowInteractive ? chooseDeviceBackupFolder() : null;
}

/** The archive in `folder` already carrying `fileName`, or null. */
async function findDeviceArchive(
  folder: RememberedDeviceFolder,
  fileName: string,
): Promise<string | null> {
  try {
    const children = await FileSystem.StorageAccessFramework.readDirectoryAsync(folder.backupsUri);
    return children.find((child) => decodeURIComponent(child).endsWith(`/${fileName}`)) ?? null;
  } catch {
    return null;
  }
}

async function saveToAndroidFolder(
  archiveJson: string,
  fileName: string,
  options: { allowInteractiveAuth?: boolean; retention?: HouseBackupRetention } = {},
): Promise<SaveOutcome> {
  const saf = FileSystem.StorageAccessFramework;
  const folder = await resolveDeviceFolder(options.allowInteractiveAuth !== false);
  if (!folder) {
    return options.allowInteractiveAuth === false
      ? {
          status: 'needs_auth',
          message: 'Pick a folder on this phone before backups can run there.',
          location: null,
        }
      : { status: 'cancelled', message: 'No folder chosen.', location: null };
  }

  // In `replace` mode write over the file already there. SAF's createFileAsync
  // does NOT overwrite — it side-steps the collision with `name (1).json`, so
  // without this the "one file" mode quietly grows a numbered pile.
  let uri = options.retention === 'replace' ? await findDeviceArchive(folder, fileName) : null;
  if (!uri) {
    // SAF appends the extension from the mime type, so strip ours to avoid
    // `…json.json`.
    uri = await saf.createFileAsync(folder.backupsUri, fileName.replace(/\.json$/, ''), BACKUP_MIME);
  }
  await FileSystem.writeAsStringAsync(uri, archiveJson, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  return {
    status: 'saved',
    message: `Saved to ${folder.label}.`,
    location: uri,
    savedTo: {
      kind: 'folder',
      where: folder.label,
      breadcrumb: null,
      fileName,
      // A SAF `content://` uri is scoped to our grant and is not a file
      // expo-sharing can hand on, so no Open button is offered.
      uri: null,
      icon: 'folder-open-outline',
    },
  };
}

/** Archives in the remembered phone folder, newest first. Android only. */
export async function listDeviceFolderBackups(
  householdId?: string,
): Promise<LocalHouseBackupEntry[]> {
  const folder = await getRememberedDeviceFolder();
  if (!folder) return [];
  let children: string[];
  try {
    children = await FileSystem.StorageAccessFramework.readDirectoryAsync(folder.backupsUri);
  } catch {
    return [];
  }
  const adoptUntagged = holdsOnePropertyOnly();
  const byToken = propertiesByToken();

  const entries = await Promise.all(
    children.map(async (uri): Promise<LocalHouseBackupEntry | null> => {
      const decoded = decodeURIComponent(uri);
      const fileName = decoded.slice(decoded.lastIndexOf('/') + 1);
      // Same guard as every other listing: this feeds a prune that deletes.
      if (!isHouseArchiveName(fileName)) return null;
      if (householdId && !archiveBelongsTo(fileName, householdId, adoptUntagged)) return null;
      const info = await FileSystem.getInfoAsync(uri).catch(() => null);
      return {
        fileName,
        uri,
        size: info?.exists && typeof info.size === 'number' ? info.size : 0,
        modifiedAt:
          info?.exists && typeof info.modificationTime === 'number'
            ? new Date(info.modificationTime * 1000).toISOString()
            : null,
        householdId: resolveArchiveHousehold(fileName, byToken),
        coversAllHomes: archiveCoversAllHomes(fileName),
      };
    }),
  );

  return entries
    .filter((entry): entry is LocalHouseBackupEntry => entry !== null)
    .sort((a, b) => b.fileName.localeCompare(a.fileName));
}

export async function deleteDeviceFolderBackup(uri: string): Promise<void> {
  await FileSystem.StorageAccessFramework.deleteAsync(uri).catch(() => undefined);
}

async function saveToCloud(
  provider: HouseBackupCloudProvider,
  archiveJson: string,
  fileName: string,
  /**
   * Scheduled runs pass false: they must never pop an OAuth consent screen at
   * an arbitrary moment. An unauthenticated provider becomes `needs_auth`, and
   * the scheduler surfaces that as "reconnect" rather than hijacking the app.
   */
  options: { allowInteractiveAuth?: boolean; retention?: HouseBackupRetention } = {},
): Promise<SaveOutcome> {
  const service = cloudServiceFor(provider);
  const label = cloudProviderLabel(provider);

  if (!service.uploadFile || !isCloudProviderConfigured(provider)) {
    return {
      status: 'unsupported',
      message: `${label} is not set up in this build.`,
      location: null,
    };
  }

  if (!(await service.isAuthenticated())) {
    if (options.allowInteractiveAuth === false) {
      return {
        status: 'needs_auth',
        message: `${label} needs to be reconnected before backups can run.`,
        location: null,
      };
    }
    try {
      await service.authenticate();
    } catch (error) {
      if (error instanceof CloudReauthRequiredError) {
        return { status: 'needs_auth', message: error.message, location: null };
      }
      // A cancelled consent screen is a user choice, not a failure.
      const message = error instanceof Error ? error.message : '';
      if (/cancel/i.test(message)) {
        return { status: 'cancelled', message: `${label} sign-in cancelled.`, location: null };
      }
      return {
        status: 'needs_auth',
        message: `Could not connect to ${label}. Please try again.`,
        location: null,
      };
    }
  }

  try {
    const folder = await resolveCloudFolder(provider);
    /*
     * In `replace` mode the same name comes back every run, and providers do
     * NOT treat a name as unique — Drive will happily hold five files called
     * `symply-house-backup-maple-street--hh1.json` side by side. Overwriting
     * means finding the existing one and updating it by id, so "replace"
     * replaces instead of quietly becoming the dated pile it was chosen to
     * avoid.
     */
    let replaceFileId: string | undefined;
    if (options.retention === 'replace' && service.listFiles) {
      try {
        const existing = await service.listFiles(folder.id);
        replaceFileId = existing.find((file) => file.name === fileName)?.id;
      } catch (error) {
        // Worst case we add a second copy rather than replacing one. That is a
        // tidiness problem; failing the backup over it would be a data problem.
        console.warn('[house-backup] could not look for an archive to replace', error);
      }
    }

    const uploaded = await service.uploadFile({
      name: fileName,
      content: archiveJson,
      mimeType: BACKUP_MIME,
      folderId: folder.id,
      replaceFileId,
    });
    // A picked folder's trail is what makes it findable again — "Google
    // Drive › Home" sends someone hunting the root, "Google Drive ›
    // Documents › 2026 › Home" does not. `path` excludes the account root,
    // so it never doubles up with the provider label in front of it.
    const breadcrumb = [label, ...(folder.path?.length ? folder.path : [folder.name])];
    return {
      status: 'saved',
      // The folder, not just the provider — see the Budget twin: a member
      // looking in the folder they remember is told where the file actually is.
      message: `Saved to ${breadcrumb.join(' › ')}.`,
      location: uploaded.id,
      savedTo: {
        kind: 'cloud',
        where: label,
        breadcrumb,
        fileName: uploaded.name,
        // Reaching it means the provider's own app — not a file this phone holds.
        uri: null,
        icon: 'cloud-done-outline',
      },
    };
  } catch (error) {
    if (error instanceof CloudReauthRequiredError) {
      return { status: 'needs_auth', message: error.message, location: null };
    }
    // Never surface the raw provider body — it carries request ids and quota text.
    console.error('[house-backup] cloud upload failed', provider, error);
    return {
      status: 'failed',
      message: `Could not upload the backup to ${label}.`,
      location: null,
    };
  }
}

/**
 * Build an encrypted archive and write it to `destination`.
 *
 * The recovery phrase comes back on every non-cancelled result — including
 * failures — because the archive is already sealed under it by then and the
 * UI must show it exactly once.
 *
 * The default file name is derived AFTER the build: naming an archive after the
 * home it holds means knowing which home was sealed, and only the build knows
 * that.
 */
export async function saveHouseBackupTo(
  destination: HouseBackupDestination,
  options: {
    fileName?: string;
    /** Seal under an existing phrase (scheduled backups) instead of a new one. */
    phrase?: string;
    /** Pass false from unattended runs so no OAuth screen can appear. */
    allowInteractiveAuth?: boolean;
    /**
     * Which property to seal. Defaults to the active one; pass
     * `HOUSE_ALL_HOMES_ID` for one file holding every home, sectioned per
     * household.
     */
    householdId?: string;
    /** Overrides the member's stored choice. Mainly for tests. */
    retention?: HouseBackupRetention;
  } = {},
): Promise<HouseBackupSaveResult> {
  let archiveJson: string;
  let phrase: string;
  let householdId: string;
  let householdIds: string[];
  let scope: HouseBackupScope;
  let fileName: string;
  // Read before the build so a `replace` run knows to look for the file it is
  // about to land on. An explicit `fileName` still wins.
  const retention = options.retention ?? (await getHouseBackupRetention());
  try {
    const created = await buildHouseBackupArchive({
      phrase: options.phrase,
      householdId: options.householdId,
    });
    archiveJson = created.archiveJson;
    phrase = created.phrase;
    scope = created.scope ?? 'single';
    householdIds = created.householdIds ?? [created.summary.householdId];
    // The pseudo-id for a whole-device file, so the name it is written under and
    // the id it is attributed by agree — `archiveBelongsTo` reads that token.
    householdId = scope === 'multi' ? HOUSE_ALL_HOMES_ID : created.summary.householdId;
    fileName =
      options.fileName ??
      backupFileNameFor(retention, {
        householdId,
        propertyName:
          scope === 'multi'
            ? HOUSE_ALL_HOMES_LABEL
            : created.summary.propertyName?.trim() || 'Home',
      });
  } catch (error) {
    console.error('[house-backup] build failed', error);
    return {
      status: 'failed',
      destination,
      message: 'Could not create a backup just now.',
      phrase: null,
      fileName: null,
      householdId: null,
      householdIds: [],
      scope: null,
      location: null,
      savedTo: null,
    };
  }

  try {
    let outcome: SaveOutcome;

    switch (destination) {
      case 'device':
        outcome = await saveToDevice(archiveJson, fileName);
        break;
      case 'files':
        // Android exposes a true folder picker whose grant PERSISTS, so the
        // folder becomes a real unattended destination. iOS has no such API —
        // its only route to an arbitrary folder is the share sheet, which needs
        // somebody present to answer it, which is why `files` is Android-only
        // as a scheduled destination (see `autoBackupSupports`).
        outcome =
          Platform.OS === 'android'
            ? await saveToAndroidFolder(archiveJson, fileName, {
                allowInteractiveAuth: options.allowInteractiveAuth,
                retention,
              })
            : await saveViaShareSheet(
                archiveJson,
                fileName,
                'Save backup to Files',
                'Wherever you saved it',
              );
        break;
      case 'google-drive':
      case 'dropbox':
        outcome = await saveToCloud(destination, archiveJson, fileName, {
          allowInteractiveAuth: options.allowInteractiveAuth,
          retention,
        });
        break;
      case 'share':
      default:
        outcome = await saveViaShareSheet(
          archiveJson,
          fileName,
          'Encrypted home backup',
          'Wherever you sent it',
        );
        break;
    }

    return {
      savedTo: null,
      ...outcome,
      destination,
      phrase,
      fileName,
      householdId,
      householdIds,
      scope,
    };
  } catch (error) {
    console.error('[house-backup] save failed', destination, error);
    return {
      status: 'failed',
      destination,
      message: 'Could not write the backup file.',
      phrase,
      fileName,
      householdId,
      householdIds,
      scope,
      location: null,
      savedTo: null,
    };
  }
}

export type CloudHouseBackupEntry = {
  id: string;
  fileName: string;
  size: number;
  modifiedAt: string | null;
  /** As on `LocalHouseBackupEntry` — null when the name cannot be attributed. */
  householdId: string | null;
  /** True when this one file holds every home, one section each. */
  coversAllHomes: boolean;
};

/**
 * Archives this app previously uploaded, newest first. Both providers are
 * scoped to app-created content (Drive `drive.file`, Dropbox app folder), so
 * the listing can never contain anything else in the user's account.
 *
 * `householdId` narrows the same way the on-device listing does. It has to be a
 * name-level decision here, because attributing a cloud archive by reading its
 * payload would mean downloading every file in the folder just to prune one.
 */
export async function listCloudHouseBackups(
  provider: HouseBackupCloudProvider,
  householdId?: string,
): Promise<CloudHouseBackupEntry[]> {
  const service = cloudServiceFor(provider);
  if (!service.ensureFolder || !isCloudProviderConfigured(provider)) return [];
  const folder = await resolveCloudFolder(provider);
  const files = await service.listFiles(folder.id);
  const adoptUntagged = holdsOnePropertyOnly();
  const byToken = propertiesByToken();
  return files
    .filter(
      (file) =>
        isHouseArchiveName(file.name) &&
        (!householdId || archiveBelongsTo(file.name, householdId, adoptUntagged)),
    )
    .map((file) => ({
      id: file.id,
      fileName: file.name,
      size: file.size,
      modifiedAt: file.modifiedTime ?? null,
      householdId: resolveArchiveHousehold(file.name, byToken),
      coversAllHomes: archiveCoversAllHomes(file.name),
    }))
    // Names are ISO-ordered; sort by name so providers that return arbitrary
    // order still present newest-first.
    .sort((a, b) => b.fileName.localeCompare(a.fileName));
}

/** Download a cloud archive and return its JSON, ready for verify + restore. */
export async function readCloudHouseBackup(
  provider: HouseBackupCloudProvider,
  fileId: string,
): Promise<string> {
  const downloaded = await cloudServiceFor(provider).downloadFile(fileId);
  return FileSystem.readAsStringAsync(downloaded.uri);
}

export async function deleteCloudHouseBackup(
  provider: HouseBackupCloudProvider,
  fileId: string,
): Promise<void> {
  const service = cloudServiceFor(provider);
  if (!service.deleteFile) return;
  await service.deleteFile(fileId);
}
