import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { ENV } from '@config/env';
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

import { listLocalBudgetHouseholds } from '../engine';

import type { BudgetBackupLocation } from './backupFileAccess';
import {
  buildBudgetBackupBundle,
  type BudgetBackupHouseholdCoverage,
} from './budgetBackup';

/**
 * Budget V2 — where an encrypted backup archive can be written.
 *
 * The archive itself (and the 12-word phrase that opens it) is produced by
 * `budgetBackup.ts`; this module only decides *where the bytes land*. Every
 * destination stores the exact same sealed archive, so a backup written to one
 * can always be restored from another.
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
 */
export type BudgetBackupDestination =
  | 'device'
  | 'files'
  | 'google-drive'
  | 'dropbox'
  | 'share';

/** Destinations a scheduled (unattended) backup can write to. */
export type BudgetBackupCloudProvider = BackupCloudProvider;
export type BudgetAutoBackupDestination = 'device' | 'files' | BudgetBackupCloudProvider;

/**
 * The provider half — naming a provider, checking its credentials, re-running
 * its OAuth, browsing its folders — is app-agnostic and lives in
 * `@services/cloud-storage/backupProviders` so House shares one OAuth path with
 * Budget rather than owning a second copy of it. Re-exported here under the
 * names Budget already uses, so nothing that imports this module changed.
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
export function autoBackupSupports(destination: BudgetBackupDestination): boolean {
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
  destination: BudgetBackupDestination,
): destination is BudgetBackupCloudProvider {
  return destination === 'google-drive' || destination === 'dropbox';
}

/** Names any scheduled destination — the cloud ones plus the two local ones. */
export function autoBackupDestinationLabel(destination: BudgetAutoBackupDestination): string {
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
  provider: BudgetBackupCloudProvider,
): Promise<void> {
  await logoutCloudProvider(provider);
  await forgetCloudFolder(provider);
}

/**
 * Swap to a different account: sign out of the current one, then straight into
 * the consent screen. Done as one action because signing out and being left on
 * a "not connected" row is not what "use another account" asked for.
 */
export async function switchCloudAccount(provider: BudgetBackupCloudProvider): Promise<void> {
  await disconnectCloudProvider(provider);
  await cloudServiceFor(provider).authenticate();
}

export type BudgetBackupSaveStatus =
  | 'saved'
  | 'shared'
  | 'cancelled'
  | 'unsupported'
  | 'needs_auth'
  | 'failed';

export type BudgetBackupSaveResult = {
  status: BudgetBackupSaveStatus;
  destination: BudgetBackupDestination;
  message: string;
  /**
   * The 12-word recovery phrase — the ONLY way to open the archive. Present
   * whenever the archive was built, even if the write then failed, so the UI
   * can still show it rather than silently losing a usable secret.
   */
  phrase: string | null;
  fileName: string | null;
  /**
   * Whose budget was sealed. Null only when the archive was never built.
   *
   * Kept for the single-household callers that predate bundles; with a bundle it
   * carries the FIRST household, which is not a meaningful answer on its own —
   * read `householdIds` instead.
   */
  householdId: string | null;
  /**
   * Every household in the file. One entry for a legacy single archive, all of
   * them for a bundle. This is what history and the status card record against:
   * a bundle protects each of these, and attributing it to one would leave the
   * others looking unbacked-up while their data sat in the same file.
   */
  householdIds: string[];
  /** Per-household coverage — rows and attachments carried. For the summary UI. */
  coverage: BudgetBackupHouseholdCoverage[];
  /** Attachment bytes left out because the shared cap was reached. */
  skippedAttachments: number;
  /** Local path, SAF uri, or Drive file id — for display/logging only. */
  location: string | null;
  /**
   * Where the bytes landed, ready to render and — where the destination leaves
   * something durable behind — to open. Null on every outcome that wrote
   * nothing (cancelled, failed, needs_auth). See `backupFileAccess.ts` for why
   * this replaced a sentence of navigation instructions.
   */
  savedTo: BudgetBackupLocation | null;
};

/** What each `saveTo…` helper hands back before the shared fields are added. */
type SaveOutcome = {
  status: BudgetBackupSaveStatus;
  message: string;
  location: string | null;
  savedTo?: BudgetBackupLocation | null;
};

/** Default cloud folder name. Created on first upload if nothing is remembered. */
export const BUDGET_BACKUP_DRIVE_FOLDER = 'Symply Budget Backups';

/**
 * Remembered cloud folder, per provider. Persisting the *id* (not just the
 * name) means every later backup lands in the same folder even if the user
 * renames it or moves it — and it stops a second folder of the same name being
 * created when the first one is nested somewhere the name query misses.
 *
 * The Drive key is unchanged from before Dropbox existed so installs that
 * already have a pointer keep it.
 */
const FOLDER_STORAGE_KEY: Record<BudgetBackupCloudProvider, string> = {
  'google-drive': 'budget.backup.driveFolder',
  dropbox: 'budget.backup.dropboxFolder',
};

/**
 * The pointer shape, shared with House. `default` is the folder this app made
 * for itself (`BUDGET_BACKUP_DRIVE_FOLDER`); `picked` is one the member chose
 * out of their own Drive, which is never recreated when it goes missing — see
 * `resolveCloudFolder`.
 */
export type RememberedDriveFolder = RememberedCloudFolder;

export async function getRememberedCloudFolder(
  provider: BudgetBackupCloudProvider,
): Promise<RememberedDriveFolder | null> {
  try {
    const raw = await AsyncStorage.getItem(FOLDER_STORAGE_KEY[provider]);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedDriveFolder>;
    if (!parsed.id || !parsed.name) return null;
    return {
      id: parsed.id,
      name: parsed.name,
      // Both are optional and both are absent on pointers written before the
      // picker existed, which is exactly the shape `default` describes.
      ...(Array.isArray(parsed.path) ? { path: parsed.path.filter((p) => typeof p === 'string') } : {}),
      ...(parsed.source === 'picked' ? { source: 'picked' as const } : {}),
    };
  } catch {
    return null;
  }
}

export async function rememberCloudFolder(
  provider: BudgetBackupCloudProvider,
  folder: RememberedDriveFolder,
): Promise<void> {
  try {
    await AsyncStorage.setItem(FOLDER_STORAGE_KEY[provider], JSON.stringify(folder));
  } catch (error) {
    // Losing the pointer only costs a name lookup next time — never fail a backup over it.
    console.warn('[budget-backup] could not remember cloud folder', provider, error);
  }
}

export async function forgetCloudFolder(provider: BudgetBackupCloudProvider): Promise<void> {
  await AsyncStorage.removeItem(FOLDER_STORAGE_KEY[provider]).catch(() => undefined);
}

// Drive-named aliases — the original API, kept so callers and stored keys that
// predate Dropbox keep working unchanged.
export const getRememberedDriveFolder = () => getRememberedCloudFolder('google-drive');
export const rememberDriveFolder = (folder: RememberedDriveFolder) =>
  rememberCloudFolder('google-drive', folder);
export const forgetDriveFolder = () => forgetCloudFolder('google-drive');

/**
 * Persist the folder the member chose in the Drive browser, so every later
 * backup — manual and scheduled — lands there without asking again.
 *
 * The id is what is actually written against, which is why renaming or moving
 * the folder in Drive does not break the pointer; `path` only feeds the label.
 */
export async function chooseCloudBackupFolder(
  provider: BudgetBackupCloudProvider,
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
  provider: BudgetBackupCloudProvider,
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
 * account root — not the `Documents/2026/Finance` they picked — and quietly
 * scatter archives somewhere they never agreed to. So a pick that has gone away
 * is dropped, and the next backup falls back to the app's own folder rather
 * than inventing a lookalike.
 */
/**
 * The folder this provider's backups go to — the member's picked one, or the
 * app's own, created on demand.
 *
 * Exported so the recovery phrase file can land in the SAME folder as the
 * archives it opens. Co-locating a plaintext key with the sealed data it
 * unlocks looks wrong at first glance, but the separation would be imaginary:
 * anyone who can read one folder of a Drive account can read every folder of
 * it, so a second folder buys no safety and costs the one thing that matters
 * when a phone is gone — finding the phrase in the same place as the backup.
 */
export async function resolveCloudFolder(
  provider: BudgetBackupCloudProvider,
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
        '[budget-backup] could not check the chosen cloud folder, keeping it',
        provider,
        error,
      );
      return remembered;
    }
    if (stillThere) return remembered;
    console.warn('[budget-backup] chosen cloud folder is gone, falling back', provider);
    await forgetCloudFolder(provider);
  }

  const previous =
    remembered && rememberedFolderSource(remembered) === 'default' ? remembered : null;
  const name = previous?.name ?? BUDGET_BACKUP_DRIVE_FOLDER;
  const id = await service.ensureFolder(name, previous?.id ?? null);
  if (id !== previous?.id || name !== previous?.name) {
    await rememberCloudFolder(provider, { id, name, source: 'default' });
  }
  return { id, name, source: 'default' };
}

/** Sub-folder of the app's Documents dir holding on-device archives. */
const LOCAL_BACKUP_DIRNAME = 'budget-backups';

const BACKUP_MIME = 'application/json';

export function budgetBackupDirectory(): string {
  return `${FileSystem.documentDirectory ?? ''}${LOCAL_BACKUP_DIRNAME}/`;
}

/**
 * Separator between the half of an archive name a member reads and the half
 * this module parses. A single `-` cannot serve: household names are slugged
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
 * point — renaming "Home" to "Main budget" must not orphan the archives already
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
function householdNameSlug(householdName: string): string {
  return (
    householdName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'household'
  );
}

/**
 * The household token carried by an archive name, or null when it carries none.
 *
 * Null means a pre-BR-016 archive: written when this device could only hold one
 * household, so the name never had to say which. Those files are still perfectly
 * restorable — the household id is inside the sealed payload — they simply
 * cannot be attributed from the outside, which is what `archiveBelongsTo` has to
 * be careful about.
 */
export function archiveHouseholdToken(fileName: string): string | null {
  const base = fileName.replace(/\.json$/i, '');
  const at = base.lastIndexOf(HOUSEHOLD_TOKEN_SEPARATOR);
  if (at < 0) return null;
  const token = base.slice(at + HOUSEHOLD_TOKEN_SEPARATOR.length);
  return token.length > 0 ? token : null;
}

/**
 * Every archive name this app has ever written starts with this — both the
 * timestamped shape used on device and in the cloud, and the date-only shape
 * `budgetBackup.ts` still uses for the share flow.
 */
/**
 * Matched WITHOUT a trailing separator, which is what a name-shape test needs.
 *
 * The bundle's `replace` name is exactly `symply-budget-backup.json` — it has no
 * household half to separate — so a test for `'symply-budget-backup-'` would
 * reject the one file the whole scheduled-backup path now writes, and every
 * listing would come back empty while the archives sat there. The stem accepts
 * both that and every dashed name ever written.
 */
const ARCHIVE_NAME_STEM = 'symply-budget-backup';

/**
 * The date-first shape: `2026-08-23-1522-symply-budget-backup-home--hh_x.json`.
 *
 * The stamp moved to the front so a backup folder reads as a dated list at a
 * glance and sorts that way in Drive, Files and every other viewer that orders
 * by name — the old shape buried it eleven characters in, behind a prefix every
 * archive shares, which sorted correctly but told you nothing until you read
 * past it. Names written before this change keep the prefix-first shape and are
 * still archives; both are matched here and ordered together by
 * `compareArchiveNamesNewestFirst`.
 */
const DATE_FIRST_ARCHIVE_NAME = /^\d{4}-\d{2}-\d{2}-\d{4}-symply-budget-backup/;

/** The `YYYY-MM-DD-HHMM` stamp from either name shape, or null for `replace` names. */
const ARCHIVE_NAME_STAMP = /(\d{4}-\d{2}-\d{2}-\d{4})/;

/**
 * Order two archive names newest-first, across both name shapes.
 *
 * A plain name compare was enough while every archive opened with the same
 * prefix. It is not any more: a date-first name starts with a digit and a
 * legacy one with `s`, so comparing the raw strings would file every legacy
 * archive above every new one regardless of date — the newest backup would land
 * at the BOTTOM of the list for as long as one old file survives. Comparing the
 * extracted stamps keeps the two shapes interleaved by the only thing that
 * matters, and still needs no mtime (which the platform may withhold).
 *
 * `replace`-mode names carry no stamp; they sort last among dated ones and fall
 * back to a name compare between themselves, which is stable and, since there
 * is exactly one such file per household, all the ordering they need.
 */
function compareArchiveNamesNewestFirst(a: string, b: string): number {
  const stampA = ARCHIVE_NAME_STAMP.exec(a)?.[1] ?? '';
  const stampB = ARCHIVE_NAME_STAMP.exec(b)?.[1] ?? '';
  if (stampA !== stampB) return stampB.localeCompare(stampA);
  return b.localeCompare(a);
}

/**
 * True only for a file this app wrote as a backup archive.
 *
 * The listings used to accept any `*.json`, which was safe while the cloud
 * folder was always one this app had created for itself — nothing else could be
 * in it. The folder picker ends that: a member can now point backups at
 * `Documents`, sitting alongside their own files. And these listings do not
 * merely display — `pruneOldBackups` DELETES everything they return past
 * `keepLast`, and on a single-household device `archiveBelongsTo` adopts any
 * untagged name as this household's. Without this guard, choosing a folder that
 * happened to contain `taxes.json` would let a scheduled backup delete it.
 *
 * The prefix is checked rather than the full shape so that hand-renamed
 * archives ("symply-budget-backup-2026-08-17 (copy).json") still list and stay
 * restorable.
 */
function isBudgetArchiveName(fileName: string): boolean {
  if (!/\.json$/i.test(fileName)) return false;
  return fileName.startsWith(ARCHIVE_NAME_STEM) || DATE_FIRST_ARCHIVE_NAME.test(fileName);
}

/**
 * Whether an archive counts as `householdId`'s for listing.
 *
 * An untagged name is a bundle, and a bundle contains every household — so it
 * counts for all of them. That inverts the pre-bundle rule, which treated an
 * untagged name as attributable only on a single-household device and otherwise
 * as belonging to nobody.
 *
 * The inversion is safe *because pruning no longer runs through here*: a
 * device-wide cap sweeps a device-wide list (`pruneOldBackups`), so "belongs to
 * everyone" can never be read as licence to delete one household's only copy on
 * another household's behalf — which is what the old rule was guarding.
 */
function archiveBelongsTo(fileName: string, householdId: string): boolean {
  const token = archiveHouseholdToken(fileName);
  if (token === null) return true;
  return token === householdArchiveToken(householdId);
}

/**
 * `token → householdId` for every household on this device.
 *
 * Built once per listing rather than searched per file: attributing a folder of
 * archives is otherwise files × households, and both listings below run on
 * every open of the Backup screen.
 */
function householdsByToken(): Map<string, string> {
  const byToken = new Map<string, string>();
  for (const entry of listLocalBudgetHouseholds()) {
    byToken.set(householdArchiveToken(entry.householdId), entry.householdId);
  }
  return byToken;
}

/**
 * The household an archive names, resolved back to a real one on this device.
 *
 * Null both when the name carries no token and when it carries one this device
 * has no household for (an archive from a household the member has since left).
 * Resolving rather than returning the raw token keeps the claim honest: the
 * token is a lossy transform of the id, so only a match against a household we
 * actually hold proves which one it is.
 */
function resolveArchiveHousehold(fileName: string, byToken: Map<string, string>): string | null {
  const token = archiveHouseholdToken(fileName);
  if (!token) return null;
  return byToken.get(token) ?? null;
}

/**
 * `YYYY-MM-DD-HHMM` in the member's OWN time zone.
 *
 * Deliberately not `toISOString()`, which this used to slice: that stamps UTC,
 * so a backup taken at 15:22 in California was named `2226` and then read back
 * out by `formatBackupFileName` — which parses the parts as local — as "22:26".
 * The one date a member has to recognise is the one they were standing in when
 * they made the backup.
 */
function localArchiveStamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${day}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/**
 * Timestamped file name. The date-only name in `budgetBackup.ts` is kept for
 * the share flow, but on-device and Drive copies accumulate — two backups in
 * one day must not overwrite each other.
 *
 * The stamp opens the name so the folder reads and sorts as a dated list
 * wherever the member looks at it — the app's own list, Drive, Files — instead
 * of hiding the date behind `symply-budget-backup-`, a prefix every archive
 * shares and nobody needs to read. Sort the names descending and the newest
 * backup is the top row.
 *
 * The household half was added by BR-016: a member with three households used
 * to get three files called `symply-budget-backup-2026-08-17-0915.json`, so the
 * only way to tell which budget an archive held was to spend a minute of Argon2
 * opening it. It still sits AFTER the stamp, so the ordering above holds across
 * households rather than grouping by household name first.
 *
 * `household` is optional only so the pre-BR-016 call shape still compiles;
 * every caller in this repo passes one, and an untagged name is a name nothing
 * can attribute later.
 */
export function timestampedBackupFileName(
  now: Date = new Date(),
  household?: { householdId: string; householdName: string },
): string {
  const stamp = `${localArchiveStamp(now)}-symply-budget-backup`;
  if (!household) return `${stamp}.json`;
  const slug = householdNameSlug(household.householdName);
  const token = householdArchiveToken(household.householdId);
  return `${stamp}-${slug}${HOUSEHOLD_TOKEN_SEPARATOR}${token}.json`;
}

/**
 * How many archives a destination is meant to end up holding.
 *
 *  - `replace` — one file per household, rewritten in place every run. The
 *    default, because the overwhelmingly common wish is "keep my budget safe",
 *    not "keep a history of my budget", and the dated pile is what makes a
 *    backup folder unreadable after a month of daily runs.
 *  - `dated`   — the timestamped names, capped by `keepLast`. For anyone who
 *    wants to be able to go back to last Tuesday.
 *
 * The choice changes only the NAME a run writes under. Both modes produce the
 * identical sealed archive, so a backup made in one mode restores in the other.
 */
export type BudgetBackupRetention = 'replace' | 'dated';

export const BUDGET_BACKUP_RETENTION_DEFAULT: BudgetBackupRetention = 'replace';

const RETENTION_STORAGE_KEY = 'budget.backup.retention';

export async function getBudgetBackupRetention(): Promise<BudgetBackupRetention> {
  try {
    const raw = await AsyncStorage.getItem(RETENTION_STORAGE_KEY);
    return raw === 'dated' || raw === 'replace' ? raw : BUDGET_BACKUP_RETENTION_DEFAULT;
  } catch {
    return BUDGET_BACKUP_RETENTION_DEFAULT;
  }
}

export async function setBudgetBackupRetention(mode: BudgetBackupRetention): Promise<void> {
  await AsyncStorage.setItem(RETENTION_STORAGE_KEY, mode);
}

/**
 * The `replace` name: no timestamp, so every run resolves to the same file and
 * the new archive lands on top of the old one.
 *
 * It still carries the household half, and still opens with the shared archive
 * prefix — one file PER HOUSEHOLD, not one file total. Three households sharing
 * a name would otherwise overwrite each other, which is the exact failure
 * BR-016 removed from the timestamped names.
 */
export function stableBackupFileName(household: {
  householdId: string;
  householdName: string;
}): string {
  const slug = householdNameSlug(household.householdName);
  const token = householdArchiveToken(household.householdId);
  return `symply-budget-backup-${slug}${HOUSEHOLD_TOKEN_SEPARATOR}${token}.json`;
}

/** The name a run should write under, given the member's retention choice. */
export function backupFileNameFor(
  retention: BudgetBackupRetention,
  household: { householdId: string; householdName: string },
  now: Date = new Date(),
): string {
  return retention === 'replace'
    ? stableBackupFileName(household)
    : timestampedBackupFileName(now, household);
}

/**
 * The name a BUNDLE is written under — no household half, because it holds them
 * all.
 *
 * That drops it back to the shape archives had before BR-016, which is not a
 * regression but the point: the household token existed to tell one budget's
 * archive from another's in a folder, and a file that contains every budget has
 * nothing to disambiguate. `dated` keeps the stamp in front so a folder still
 * reads and sorts as a dated list; `replace` is a single fixed name, so every
 * run lands on the same file.
 */
export function bundleBackupFileName(
  retention: BudgetBackupRetention,
  now: Date = new Date(),
): string {
  return retention === 'replace' ? `${ARCHIVE_NAME_STEM}.json` : timestampedBackupFileName(now);
}

/**
 * True for a name with no household token — a bundle.
 *
 * Deliberately name-level: attributing a cloud file by opening it would mean
 * downloading a folder's worth of archives to render one list, and a bundle is
 * tens of megabytes.
 *
 * The one imprecision to accept: an archive written BEFORE BR-016 also carries
 * no token, so it reads as a bundle here. Those exist only on installs that
 * have not backed up since, they are single-household v2 files, and the restore
 * path sniffs the real version out of the file itself — so the mislabel costs a
 * word in a list and nothing in behaviour.
 */
export function isBundleArchiveName(fileName: string): boolean {
  return archiveHouseholdToken(fileName) === null;
}

async function ensureLocalBackupDir(): Promise<string> {
  const dir = budgetBackupDirectory();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

export type LocalBudgetBackupEntry = {
  fileName: string;
  uri: string;
  size: number;
  /** ISO string, or null when the platform did not report a mtime. */
  modifiedAt: string | null;
  /**
   * Which household's budget is inside, when the name says so and this device
   * still holds that household. Null for bundles (which hold every household),
   * for pre-BR-016 archives, and for archives belonging to a household the
   * member has left — in all three the file is still restorable, it just cannot
   * be labelled from its name alone.
   */
  householdId: string | null;
  /**
   * `bundle` — every household in one file, what backups write now.
   * `household` — a single-household archive from before the bundle.
   */
  kind: 'bundle' | 'household';
};

/**
 * On-device archives, newest first.
 *
 * `householdId` narrows to the files that protect that household — which now
 * means every BUNDLE (they all contain it) plus any legacy archive tagged with
 * it. Omit it for the plain "what have I got saved here" list.
 *
 * Before bundles this narrowing was the scheduler's retention boundary. It is
 * not any more: one file covers every household, so the cap is device-wide (see
 * `pruneOldBackups`).
 */
export async function listLocalBudgetBackups(
  householdId?: string,
): Promise<LocalBudgetBackupEntry[]> {
  const dir = budgetBackupDirectory();
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) return [];

  const names = await FileSystem.readDirectoryAsync(dir);
  // Both read the session registry, so both are resolved once per call.
  const byToken = householdsByToken();
  const wanted = names.filter(
    (name) =>
      isBudgetArchiveName(name) &&
      (!householdId || archiveBelongsTo(name, householdId)),
  );
  const entries = await Promise.all(
    wanted.map(async (fileName): Promise<LocalBudgetBackupEntry> => {
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
        kind: isBundleArchiveName(fileName) ? 'bundle' : 'household',
      };
    }),
  );

  // The stamp inside the name is ISO-ordered, so sorting on it is a valid
  // recency sort and stays correct when the platform withholds mtimes.
  return entries.sort((a, b) => compareArchiveNamesNewestFirst(a.fileName, b.fileName));
}

export async function readLocalBudgetBackup(fileName: string): Promise<string> {
  return FileSystem.readAsStringAsync(`${budgetBackupDirectory()}${fileName}`);
}

export async function deleteLocalBudgetBackup(fileName: string): Promise<void> {
  await FileSystem.deleteAsync(`${budgetBackupDirectory()}${fileName}`, { idempotent: true });
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
      // name, which is per brand ("Symply Budget", "Symply House", …) — never
      // the literal "Budget". Android keeps this directory app-private, so
      // there is no trail to offer and the Open button shares instead.
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
 * picker and nobody present. iOS has no equivalent — see `saveToFiles`.
 */
export type RememberedDeviceFolder = {
  /** The folder the member chose. Kept so the sub-folder can be remade if deleted. */
  rootUri: string;
  /** `<root>/Symply Budget Backups` — where archives actually go. */
  backupsUri: string;
  /** `Download/Symply Budget Backups` — for the settings row. */
  label: string;
};

const DEVICE_FOLDER_STORAGE_KEY = 'budget.backup.deviceFolder';

/** Sub-folder made inside whatever the member picked, so archives never mix with their files. */
export const BUDGET_BACKUP_DEVICE_FOLDER = 'Symply Budget Backups';

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
    console.warn('[budget-backup] could not remember the device folder', error);
  });
  return folder;
}

/** Create-or-reuse `<root>/Symply Budget Backups`, returning its SAF uri. */
async function ensureDeviceBackupsSubfolder(rootUri: string): Promise<string> {
  const saf = FileSystem.StorageAccessFramework;
  try {
    const children = await saf.readDirectoryAsync(rootUri);
    const existing = children.find((child) => {
      const decoded = decodeURIComponent(child);
      return decoded.endsWith(`/${BUDGET_BACKUP_DEVICE_FOLDER}`);
    });
    if (existing) return existing;
  } catch (error) {
    // Fall through to creating it — a root we cannot list is one where the
    // create will fail loudly, which is the better error to surface.
    console.warn('[budget-backup] could not read the chosen folder', error);
  }
  return saf.makeDirectoryAsync(rootUri, BUDGET_BACKUP_DEVICE_FOLDER);
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
    return (
      children.find((child) => decodeURIComponent(child).endsWith(`/${fileName}`)) ?? null
    );
  } catch {
    return null;
  }
}

async function saveToAndroidFolder(
  archiveJson: string,
  fileName: string,
  options: { allowInteractiveAuth?: boolean; retention?: BudgetBackupRetention } = {},
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
): Promise<LocalBudgetBackupEntry[]> {
  const folder = await getRememberedDeviceFolder();
  if (!folder) return [];
  let children: string[];
  try {
    children = await FileSystem.StorageAccessFramework.readDirectoryAsync(folder.backupsUri);
  } catch {
    return [];
  }
  const byToken = householdsByToken();

  const entries = await Promise.all(
    children.map(async (uri): Promise<LocalBudgetBackupEntry | null> => {
      const decoded = decodeURIComponent(uri);
      const fileName = decoded.slice(decoded.lastIndexOf('/') + 1);
      // Same guard as every other listing: this feeds a prune that deletes.
      if (!isBudgetArchiveName(fileName)) return null;
      if (householdId && !archiveBelongsTo(fileName, householdId)) return null;
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
        kind: isBundleArchiveName(fileName) ? 'bundle' : 'household',
      };
    }),
  );

  return entries
    .filter((entry): entry is LocalBudgetBackupEntry => entry !== null)
    .sort((a, b) => compareArchiveNamesNewestFirst(a.fileName, b.fileName));
}

export async function deleteDeviceFolderBackup(uri: string): Promise<void> {
  await FileSystem.StorageAccessFramework.deleteAsync(uri).catch(() => undefined);
}

async function saveToCloud(
  provider: BudgetBackupCloudProvider,
  archiveJson: string,
  fileName: string,
  /**
   * Scheduled runs pass false: they must never pop an OAuth consent screen at
   * an arbitrary moment. An unauthenticated provider becomes `needs_auth`, and
   * the scheduler surfaces that as "reconnect" rather than hijacking the app.
   */
  options: { allowInteractiveAuth?: boolean; retention?: BudgetBackupRetention } = {},
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
     * `symply-budget-backup-home--hh1.json` side by side. Overwriting means
     * finding the existing one and updating it by id, so "replace" replaces
     * instead of quietly becoming the dated pile it was chosen to avoid.
     */
    let replaceFileId: string | undefined;
    if (options.retention === 'replace' && service.listFiles) {
      try {
        const existing = await service.listFiles(folder.id);
        replaceFileId = existing.find((file) => file.name === fileName)?.id;
      } catch (error) {
        // Worst case we add a second copy rather than replacing one. That is a
        // tidiness problem; failing the backup over it would be a data problem.
        console.warn('[budget-backup] could not look for an archive to replace', error);
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
    // Drive › Finance" sends someone hunting the root, "Google Drive ›
    // Documents › 2026 › Finance" does not. `path` excludes the account
    // root, so it never doubles up with the provider label in front of it.
    const breadcrumb = [label, ...(folder.path?.length ? folder.path : [folder.name])];
    return {
      status: 'saved',
      // The folder, not just the provider: "Uploaded to Google Drive" sent a
      // member looking in the folder they REMEMBERED, while the archives were
      // landing in the one the app had since moved to. Naming it in the toast
      // is the only moment they are told where to look.
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
    console.error('[budget-backup] cloud upload failed', provider, error);
    return {
      status: 'failed',
      message: `Could not upload the backup to ${label}.`,
      location: null,
    };
  }
}

/**
 * Build an encrypted backup and write it to `destination`.
 *
 * Seals a BUNDLE — every household on the device, sectioned inside one file
 * under one recovery phrase (see `budgetBackup.ts`). Before this it sealed one
 * household per call and the scheduler looped, which is why the result type
 * still carries a singular `householdId` alongside the list.
 *
 * The recovery phrase comes back on every non-cancelled result — including
 * failures — because the file is already sealed under it by then. Callers no
 * longer show it on every run (it is the device's one phrase, not this
 * archive's), but they still need to know WHICH words opened the file they just
 * wrote.
 */
export async function saveBudgetBackupTo(
  destination: BudgetBackupDestination,
  options: {
    fileName?: string;
    /**
     * Seal under the device's stored phrase instead of minting a new one.
     * Both callers pass it — see `backupPhrase.ts`.
     */
    phrase?: string;
    /** Pass false from unattended runs so no OAuth screen can appear. */
    allowInteractiveAuth?: boolean;
    /**
     * Narrow the bundle to these households. Omit for every household on the
     * device, which is what a backup is meant to be.
     */
    householdIds?: string[];
    /** Overrides the member's stored choice. Mainly for tests. */
    retention?: BudgetBackupRetention;
  } = {},
): Promise<BudgetBackupSaveResult> {
  let archiveJson: string;
  let phrase: string;
  let coverage: BudgetBackupHouseholdCoverage[];
  let fileName: string;
  // Read before the build so a `replace` run knows to look for the file it is
  // about to land on. An explicit `fileName` still wins — the share flow names
  // its own throwaway copy.
  const retention = options.retention ?? (await getBudgetBackupRetention());
  try {
    const created = await buildBudgetBackupBundle({
      ...(options.phrase ? { phrase: options.phrase } : {}),
      ...(options.householdIds?.length ? { householdIds: options.householdIds } : {}),
    });
    archiveJson = created.bundleJson;
    phrase = created.phrase;
    coverage = created.households;
    fileName = options.fileName ?? bundleBackupFileName(retention);
  } catch (error) {
    console.error('[budget-backup] build failed', error);
    return {
      status: 'failed',
      destination,
      message: 'Could not create a backup just now.',
      phrase: null,
      fileName: null,
      householdId: null,
      householdIds: [],
      coverage: [],
      skippedAttachments: 0,
      location: null,
      savedTo: null,
    };
  }

  const householdIds = coverage.map((entry) => entry.householdId);
  const householdId = householdIds[0] ?? null;
  const skippedAttachments = coverage.reduce(
    (sum, entry) => sum + entry.attachments.skipped,
    0,
  );
  const shared = { householdId, householdIds, coverage, skippedAttachments };

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
          'Encrypted budget backup',
          'Wherever you sent it',
        );
        break;
    }

    return { savedTo: null, ...outcome, destination, phrase, fileName, ...shared };
  } catch (error) {
    console.error('[budget-backup] save failed', destination, error);
    return {
      status: 'failed',
      destination,
      message: 'Could not write the backup file.',
      phrase,
      fileName,
      ...shared,
      location: null,
      savedTo: null,
    };
  }
}

export type DriveBudgetBackupEntry = {
  id: string;
  fileName: string;
  size: number;
  modifiedAt: string | null;
  /** As on `LocalBudgetBackupEntry` — null when the name cannot be attributed. */
  householdId: string | null;
  /** As on `LocalBudgetBackupEntry`. */
  kind: 'bundle' | 'household';
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
export async function listCloudBudgetBackups(
  provider: BudgetBackupCloudProvider,
  householdId?: string,
): Promise<DriveBudgetBackupEntry[]> {
  const service = cloudServiceFor(provider);
  if (!service.ensureFolder || !isCloudProviderConfigured(provider)) return [];
  const folder = await resolveCloudFolder(provider);
  const files = await service.listFiles(folder.id);
  const byToken = householdsByToken();
  return files
    .filter(
      (file) =>
        isBudgetArchiveName(file.name) &&
        (!householdId || archiveBelongsTo(file.name, householdId)),
    )
    .map((file) => ({
      id: file.id,
      fileName: file.name,
      size: file.size,
      modifiedAt: file.modifiedTime ?? null,
      householdId: resolveArchiveHousehold(file.name, byToken),
      kind: isBundleArchiveName(file.name) ? ('bundle' as const) : ('household' as const),
    }))
    // The stamp inside the name is ISO-ordered; sort on it so providers that
    // return arbitrary order still present newest-first.
    .sort((a, b) => compareArchiveNamesNewestFirst(a.fileName, b.fileName));
}

/** Download a cloud archive and return its JSON, ready for verify + restore. */
export async function readCloudBudgetBackup(
  provider: BudgetBackupCloudProvider,
  fileId: string,
): Promise<string> {
  const downloaded = await cloudServiceFor(provider).downloadFile(fileId);
  return FileSystem.readAsStringAsync(downloaded.uri);
}

export async function deleteCloudBudgetBackup(
  provider: BudgetBackupCloudProvider,
  fileId: string,
): Promise<void> {
  const service = cloudServiceFor(provider);
  if (!service.deleteFile) return;
  await service.deleteFile(fileId);
}

// Drive-named aliases — the original API, kept so existing callers and tests
// keep working now that both providers share one implementation.
export const listDriveBudgetBackups = () => listCloudBudgetBackups('google-drive');
export const readDriveBudgetBackup = (fileId: string) =>
  readCloudBudgetBackup('google-drive', fileId);
