// Polyfill BEFORE `@symply/local-first` (noble caches `crypto` at import, so a
// later arming is too late). `../engine` arms it too, but its import is
// evaluated after the one below — which is exactly how phrase generation broke
// with "crypto.getRandomValues must be defined" while every other local-first
// entry point worked.
import '../cryptoPolyfill';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';

import { notificationService } from '@services/notifications';

import { isLocalBudgetSessionOpen, listLocalBudgetHouseholds } from '../engine';

import {
  autoBackupDestinationLabel,
  autoBackupSupports,
  bundleBackupFileName,
  cloudProviderLabel,
  deleteCloudBudgetBackup,
  deleteDeviceFolderBackup,
  deleteLocalBudgetBackup,
  getBudgetBackupRetention,
  isBundleArchiveName,
  isCloudBackupProvider,
  isCloudProviderConfigured,
  listCloudBudgetBackups,
  listDeviceFolderBackups,
  listLocalBudgetBackups,
  saveBudgetBackupTo,
  type BudgetAutoBackupDestination,
} from './backupDestinations';
import { recordBudgetBackupSuccessFor } from './backupHistory';
import {
  ensureBudgetBackupPhrase,
  getBudgetBackupPhrase,
  perHouseholdFoldCandidates,
} from './backupPhrase';
import { beginBudgetBackupTask, finishBudgetBackupTask } from './backupTaskStore';

/**
 * Budget V2 — scheduled automatic backups.
 *
 * ## Why this is foreground-driven, not a background task
 *
 * Sealing an archive runs Argon2id (`RECOVERY_KDF_MOBILE`) — deliberately slow
 * and memory-hard, budgeted at up to ~2.5 min on device by the restore UI. An
 * iOS `BGAppRefreshTask` gets ~30s and is killed for memory spikes, so the seal
 * cannot reliably finish there. Instead the scheduler runs a *catch-up* check
 * whenever the app becomes usable: if a backup is due, it runs then, with the
 * app in the foreground and no execution limit. A local notification nags when
 * a backup has been due for a while and the app hasn't been opened.
 *
 * ## Why the phrase is stored
 *
 * An unattended backup has nobody to show a phrase to, so a per-run phrase would
 * produce archives that can never be opened. Every scheduled archive is
 * therefore sealed under one stored phrase — and, since the manual path joined
 * it, that is now simply THE device's phrase, minted on first use and reused
 * afterwards. It lives in `./backupPhrase`, which owns both the keychain entry
 * and the trade-off that comes with one secret opening everything.
 *
 * This module only ever reads it, with one exception: switching automatic backup
 * on will mint the phrase if nothing else has yet, because the member is present
 * at exactly that moment to be shown the words.
 *
 * ## Why one run covers EVERY household — and now writes ONE file
 *
 * Originally the schedule, phrase, retention cap and last-run stamp were all
 * device-wide, while the archive held one household: a run backed up whichever
 * household happened to be active and the settings screen reported that as
 * "Automatic backup: on" for all of them. BR-016 fixed the lie by splitting
 * everything per household — N schedules, N phrases, N archives.
 *
 * That was correct and unusable. Being covered then required all N to be right,
 * and when one was not — a phrase never written down, a destination that had
 * quietly started failing — nothing looked wrong, because the other archives
 * were still there. The member held three secrets and could not tell which of
 * their budgets a lost one cost them.
 *
 * The bundle collapses it back: one file holding every household, one phrase,
 * one schedule, one destination, one retention cap — with per-household sections
 * inside, so nothing about selective restore is given up (see
 * `budgetBackup.buildBudgetBackupBundle`). The per-household SETTINGS written by
 * the BR-016 build are read once and folded back into the device-level ones.
 *
 * Crucially the Argon2id pass is paid once for the whole file rather than once
 * per household, which is what makes a device-wide seal finish at all: three
 * sequential seals at `RECOVERY_KDF_MOBILE` is minutes of memory-hard work on
 * the device class most likely to be killed for it.
 *
 * The per-household backup HISTORY stays per household — "is this budget
 * recoverable" is still the right question — and a bundle simply answers it yes
 * for every household inside it.
 */

export type BudgetAutoBackupFrequency = 'daily' | 'weekly' | 'monthly';

export type BudgetAutoBackupSettings = {
  enabled: boolean;
  frequency: BudgetAutoBackupFrequency;
  destination: BudgetAutoBackupDestination;
  /** Archives to keep at the destination; older ones are pruned after a run. */
  keepLast: number;
  /** ISO timestamp of the last successful run, or null if never. */
  lastRunAt: string | null;
  lastStatus: 'ok' | 'failed' | 'needs_auth' | null;
  /** User-safe reason for the last failure — never a raw provider body. */
  lastError: string | null;
  /**
   * Identifier of the pending "overdue" reminder, as returned by Expo. Kept so
   * a later success can cancel exactly that notification — Expo cancels by its
   * own generated id, so a constant of ours would never match anything.
   */
  overdueNotificationId: string | null;
};

export const BUDGET_AUTO_BACKUP_DEFAULTS: BudgetAutoBackupSettings = {
  enabled: false,
  frequency: 'weekly',
  destination: 'device',
  keepLast: 5,
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
  overdueNotificationId: null,
};

/**
 * The device-level keys — one schedule, one phrase, for the whole device.
 *
 * They carry their original names (no suffix) because those are the keys the
 * pre-BR-016 builds wrote and the ones a device-wide schedule should own again.
 * An install that never saw the per-household build reads its own settings back
 * with no migration at all.
 */
const SETTINGS_KEY = 'budget.backup.autoSettings';

/**
 * The per-household settings key the BR-016 build wrote. Read once each, to be
 * folded back into the device-level one — see `adoptPerHouseholdSettings`. The
 * phrase half of the same fold lives in `./backupPhrase`.
 */
const perHouseholdSettingsKey = (householdId: string) => `${SETTINGS_KEY}:${householdId}`;

const FREQUENCY_MS: Record<BudgetAutoBackupFrequency, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  // Calendar months vary; 30 days is the honest approximation for "monthly"
  // here and keeps the due check a pure function of two timestamps.
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export const BUDGET_AUTO_BACKUP_FREQUENCY_LABEL: Record<BudgetAutoBackupFrequency, string> = {
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every 30 days',
};

/** Overdue by this much with no successful run → remind the user. */
const OVERDUE_REMINDER_MS = 3 * 24 * 60 * 60 * 1000;

async function readSettingsAt(key: string): Promise<BudgetAutoBackupSettings | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<BudgetAutoBackupSettings>;
  // Merge over defaults so a settings blob written by an older build (missing
  // keys added later) can never yield `undefined` where code expects a value.
  return { ...BUDGET_AUTO_BACKUP_DEFAULTS, ...parsed };
}

/**
 * Fold a per-household schedule back into the device-level one.
 *
 * The first candidate that has one wins, and the rest are cleared — leaving them
 * would mean a later build (or a stale read) resurrecting a schedule the member
 * cannot see or turn off from any screen.
 */
async function adoptPerHouseholdSettings(): Promise<BudgetAutoBackupSettings | null> {
  const candidates = perHouseholdFoldCandidates();
  if (candidates.length === 0) return null;
  let adopted: BudgetAutoBackupSettings | null = null;
  for (const householdId of candidates) {
    const key = perHouseholdSettingsKey(householdId);
    try {
      const found = await readSettingsAt(key);
      if (found && !adopted) {
        adopted = found;
        await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(found));
      }
      if (found) await AsyncStorage.removeItem(key);
    } catch {
      // Bookkeeping — a key we cannot read is a key we leave alone.
    }
  }
  return adopted;
}

/**
 * The device's schedule.
 *
 * `householdId` is accepted and ignored: the schedule is device-level again now
 * that one run writes one file covering every household. Keeping the parameter
 * means the screens that pass one (and the ones that do not) both keep
 * compiling, and a caller asking for "this household's schedule" gets the truth
 * — it is the same schedule for all of them.
 */
export async function getBudgetAutoBackupSettings(
  _householdId?: string,
): Promise<BudgetAutoBackupSettings> {
  try {
    const own = await readSettingsAt(SETTINGS_KEY);
    if (own) return own;
    return (await adoptPerHouseholdSettings()) ?? { ...BUDGET_AUTO_BACKUP_DEFAULTS };
  } catch {
    return { ...BUDGET_AUTO_BACKUP_DEFAULTS };
  }
}

async function writeSettings(settings: BudgetAutoBackupSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function updateBudgetAutoBackupSettings(
  patch: Partial<BudgetAutoBackupSettings>,
  _householdId?: string,
): Promise<BudgetAutoBackupSettings> {
  const next = { ...(await getBudgetAutoBackupSettings()), ...patch };
  await writeSettings(next);
  return next;
}

/**
 * The phrase every scheduled bundle is sealed under.
 *
 * One phrase for the device, because one file covers the device — and, since
 * manual backups joined it, because one file is all there is. Under BR-016 this
 * was per household and a member with three budgets had three sets of twelve
 * words to keep; the bundle ended that, and reusing the phrase across manual
 * runs ended the rest of it.
 *
 * Kept under its old name because every caller already speaks it, and it is
 * still the honest answer to "what opens my scheduled backups".
 */
export const getBudgetAutoBackupPhrase = (_householdId?: string): Promise<string | null> =>
  getBudgetBackupPhrase();

/**
 * Turn scheduled backups on, returning the phrase to show the user.
 *
 * The phrase is the device's — whatever a manual backup or an earlier enable
 * already minted — so switching automatic backup on never orphans the archives
 * already written. `phraseIsNew` says whether this call is what created it; the
 * screen leans on it to word the sheet, since "keep these words safe" reads
 * differently for words the member has been shown before.
 */
export async function enableBudgetAutoBackup(options: {
  frequency: BudgetAutoBackupFrequency;
  destination: BudgetAutoBackupDestination;
  keepLast?: number;
  /** Accepted and ignored — the schedule is device-level. */
  householdId?: string;
}): Promise<{
  settings: BudgetAutoBackupSettings;
  phrase: string;
  phraseIsNew: boolean;
}> {
  const { phrase, created } = await ensureBudgetBackupPhrase();

  const settings = await updateBudgetAutoBackupSettings({
    enabled: true,
    frequency: options.frequency,
    destination: options.destination,
    ...(options.keepLast != null ? { keepLast: options.keepLast } : {}),
    lastStatus: null,
    lastError: null,
  });

  return { settings, phrase, phraseIsNew: created };
}

/**
 * Turn scheduled backups off. The phrase is deliberately kept — archives already
 * written are still sealed under it, and deleting it would strand them.
 */
export async function disableBudgetAutoBackup(
  _householdId?: string,
): Promise<BudgetAutoBackupSettings> {
  await cancelOverdueReminder();
  return updateBudgetAutoBackupSettings({ enabled: false });
}

/** Clear the pending overdue nag; no-op when none is scheduled. */
async function cancelOverdueReminder(): Promise<void> {
  const { overdueNotificationId } = await getBudgetAutoBackupSettings();
  if (!overdueNotificationId) return;
  await notificationService.cancelNotification(overdueNotificationId).catch(() => undefined);
  await updateBudgetAutoBackupSettings({ overdueNotificationId: null });
}

export function nextBudgetAutoBackupDueAt(settings: BudgetAutoBackupSettings): Date | null {
  if (!settings.enabled) return null;
  if (!settings.lastRunAt) return new Date(0); // never run → due immediately
  const last = Date.parse(settings.lastRunAt);
  if (Number.isNaN(last)) return new Date(0);
  return new Date(last + FREQUENCY_MS[settings.frequency]);
}

export function isBudgetAutoBackupDue(
  settings: BudgetAutoBackupSettings,
  now: Date = new Date(),
): boolean {
  const due = nextBudgetAutoBackupDueAt(settings);
  return due != null && now.getTime() >= due.getTime();
}

/**
 * The due check plus the one case the interval cannot see: an on-device
 * schedule whose archive is no longer there.
 *
 * `lastRunAt` says a backup happened, not that it survived. Deleting the archive
 * — from the Backup screen's list, or from Files — removes the protection while
 * leaving the timestamp behind, so a weekly schedule would sit out the rest of
 * the week believing the member was covered. Finding the folder empty is
 * therefore reason enough to run again now.
 *
 * "Empty" is device-wide again, because the file is: one bundle protects every
 * household, so any archive in the folder is evidence for all of them. Under the
 * per-household archives this had to be scoped, or one household's backups would
 * have vouched for another's.
 *
 * A folder we could not read is NOT treated as empty: that would seal a fresh
 * archive on every foreground for as long as the read kept failing.
 */
async function isBudgetAutoBackupDueOrUnprotected(
  settings: BudgetAutoBackupSettings,
  now: Date,
): Promise<boolean> {
  if (isBudgetAutoBackupDue(settings, now)) return true;
  if (settings.destination !== 'device') return false;
  try {
    return (await listLocalBudgetBackups()).length === 0;
  } catch {
    return false;
  }
}

export type BudgetAutoBackupStatus = 'ok' | 'skipped' | 'failed' | 'needs_auth';

/** What one household's leg of a run did. */
export type BudgetAutoBackupHouseholdResult = {
  householdId: string;
  householdName: string;
  status: BudgetAutoBackupStatus;
  message: string;
  fileName?: string;
  prunedCount?: number;
};

export type BudgetAutoBackupRunResult = {
  status: BudgetAutoBackupStatus;
  /** Why a run was skipped / what failed — safe to show. */
  message: string;
  fileName?: string;
  prunedCount?: number;
  /**
   * Every household the run touched. The flat fields above summarise these for
   * the task slot's one-line toast; anything that wants to say which budget is
   * unprotected has to read this.
   */
  households: BudgetAutoBackupHouseholdResult[];
};

/** Guards against a second run starting while a slow Argon2 seal is in flight. */
let runInFlight: Promise<BudgetAutoBackupRunResult> | null = null;

/**
 * Run a scheduled backup if one is due.
 *
 * Safe to call on every app foreground: it no-ops unless auto-backup is on, the
 * ledger is open, and the interval has elapsed. Never throws — a backup failure
 * must not take down whatever triggered it.
 */
export async function runBudgetAutoBackupIfDue(
  options: { force?: boolean; now?: Date; householdId?: string } = {},
): Promise<BudgetAutoBackupRunResult> {
  if (runInFlight) return runInFlight;
  // Announce the run through the shared task slot so a scheduled seal is
  // visible ("Backing up…") and reports its outcome as a toast, wherever the
  // member is — instead of finishing silently as it used to. A run that turns
  // out to be a no-op (off, not due, ledger closed) never claimed the slot's
  // attention, so it releases it as `cancelled` and says nothing.
  const runId = beginBudgetBackupTask('scheduled');
  runInFlight = executeAutoBackup(options)
    .then((result) => {
      if (runId != null) {
        finishBudgetBackupTask(
          runId,
          result.status === 'skipped'
            ? { status: 'cancelled', message: result.message }
            : { status: result.status, message: result.message },
        );
      }
      return result;
    })
    .finally(() => {
      runInFlight = null;
    });
  return runInFlight;
}

/** A household as this module addresses it: an id to key by, a name to say. */
type AutoBackupTarget = { householdId: string; householdName: string };

/**
 * Which households this run covers.
 *
 * `householdId` narrows the bundle to one — the Backup screen's "back up just
 * this budget". Otherwise every household on the device, which is what a
 * scheduled run always wants: a household is most at risk exactly when it is the
 * one nobody has opened in weeks.
 */
function targetsFor(householdId?: string): AutoBackupTarget[] {
  return listLocalBudgetHouseholds()
    .filter((entry) => !householdId || entry.householdId === householdId)
    .map((entry) => ({
      householdId: entry.householdId,
      householdName: entry.name.trim() || 'Household',
    }));
}

/**
 * One run, one file, every household.
 *
 * This used to loop `backupOneHousehold` over the registry, paying a full
 * Argon2id pass per household and writing N archives under N phrases. The bundle
 * removed both: one seal covers the device, so the schedule, the phrase, the
 * destination, the retention cap and the failure state are single values again —
 * and there is no longer a way for two of a member's budgets to disagree about
 * whether they are backed up.
 *
 * Never throws: a backup failure must not take down whatever triggered it.
 */
async function executeAutoBackup(
  options: { force?: boolean; now?: Date; householdId?: string },
): Promise<BudgetAutoBackupRunResult> {
  const now = options.now ?? new Date();

  // The seal reads live ledgers — without an open session there is nothing to
  // back up, and this is the normal state right after launch.
  if (!isLocalBudgetSessionOpen()) {
    return { status: 'skipped', message: 'Local ledger is not open yet.', households: [] };
  }

  const targets = targetsFor(options.householdId);
  if (targets.length === 0) {
    // Two different nothings, and they must not read the same. An empty
    // registry behind an open session is the launch race above; a NAMED
    // household that is not in it is a caller holding an id across a removal or
    // a sign-out, and telling them to wait for the ledger would send them to
    // wait for something that has already happened.
    return {
      status: 'skipped',
      message: options.householdId
        ? 'That household is no longer on this device.'
        : 'Local ledger is not open yet.',
      households: [],
    };
  }

  const leg = (
    status: BudgetAutoBackupStatus,
    message: string,
    extra: { fileName?: string; prunedCount?: number } = {},
  ): BudgetAutoBackupRunResult => ({
    status,
    message,
    ...extra,
    households: targets.map((target) => ({ ...target, status, message, ...extra })),
  });

  try {
    const settings = await getBudgetAutoBackupSettings();
    if (!settings.enabled) {
      return leg('skipped', 'Automatic backup is off.');
    }
    if (options.force !== true && !(await isBudgetAutoBackupDueOrUnprotected(settings, now))) {
      return leg('skipped', 'Not due yet.');
    }

    const phrase = await getBudgetBackupPhrase();
    if (!phrase) {
      // Enabled but no phrase means the keychain entry was lost (restore from a
      // different device, keychain reset). Refuse rather than silently minting
      // a new phrase the user has never seen — an unattended run is the one
      // caller that must NOT call `ensureBudgetBackupPhrase`, because nobody is
      // there to be shown what it created, and the archive it sealed would be
      // openable only by a secret the member has never laid eyes on.
      const message =
        'Recovery phrase missing — open Backup & Restore and tap “Recovery phrase” to set one.';
      await updateBudgetAutoBackupSettings({ lastStatus: 'failed', lastError: message });
      return leg('failed', message);
    }

    const destination = settings.destination;
    // `files` is a scheduled destination on Android only — iOS can reach an
    // arbitrary folder only through the share sheet, which nobody is here to
    // answer. A setting carried over from an Android phone (or set before this
    // guard existed) must fail loudly rather than silently never run.
    if (!autoBackupSupports(destination)) {
      const message = `${autoBackupDestinationLabel(
        destination,
      )} cannot be backed up to on its own on this phone.`;
      await updateBudgetAutoBackupSettings({ lastStatus: 'failed', lastError: message });
      return leg('failed', message);
    }
    if (isCloudBackupProvider(destination) && !isCloudProviderConfigured(destination)) {
      const label = cloudProviderLabel(destination);
      const message = `${label} is not set up in this build.`;
      await updateBudgetAutoBackupSettings({ lastStatus: 'failed', lastError: message });
      return leg('failed', message);
    }

    // No household half in the name any more: the file holds all of them, so
    // there is nothing to disambiguate. `replace` drops the clock too, which is
    // the point of that mode — every run resolves to the same file.
    const fileName = bundleBackupFileName(await getBudgetBackupRetention(), now);
    const result = await saveBudgetBackupTo(destination, {
      fileName,
      phrase,
      ...(options.householdId ? { householdIds: [options.householdId] } : {}),
      // Never pop a consent screen from a background-ish trigger.
      allowInteractiveAuth: false,
    });

    if (result.status !== 'saved') {
      const status = result.status === 'needs_auth' ? 'needs_auth' : 'failed';
      await updateBudgetAutoBackupSettings({ lastStatus: status, lastError: result.message });
      await scheduleOverdueReminderIfNeeded(settings, now);
      return leg(status, result.message);
    }

    const prunedCount = await pruneOldBackups(destination, settings.keepLast);

    // Where it went, not just when it ran — the status card has to know whether
    // this is evidence it can re-check (an archive on this device) or evidence
    // it has to take on trust (bytes that left the phone). See backupHistory.ts.
    //
    // Recorded against EVERY household in the file. The history stays per
    // household because "is this budget recoverable" is still the right
    // question, and a bundle's honest answer is yes for all of them.
    await recordBudgetBackupSuccessFor(result.householdIds, {
      at: now.toISOString(),
      destination,
      kind: 'scheduled',
      fileName,
    });
    await updateBudgetAutoBackupSettings({
      lastRunAt: now.toISOString(),
      lastStatus: 'ok',
      lastError: null,
    });
    await cancelOverdueReminder();

    console.log(
      '[budget-autobackup] ok',
      destination,
      fileName,
      'households=',
      result.householdIds.length,
      'pruned=',
      prunedCount,
    );

    // Keep the destination in the multi-budget line too — the count is why the
    // bundle exists, but WHERE it went is what a member checking Drive needs.
    const where = result.savedTo?.breadcrumb?.length
      ? ` to ${result.savedTo.breadcrumb.join(' › ')}`
      : '';
    const message =
      result.householdIds.length > 1
        ? `Backed up ${result.householdIds.length} budgets${where}.`
        : result.message;
    return {
      status: 'ok',
      message,
      fileName,
      prunedCount,
      households: targets.map((target) => ({
        ...target,
        status: 'ok' as const,
        message,
        fileName,
        prunedCount,
      })),
    };
  } catch (error) {
    console.error('[budget-autobackup] run threw', error);
    await updateBudgetAutoBackupSettings({
      lastStatus: 'failed',
      lastError: 'Automatic backup could not finish.',
    }).catch(() => undefined);
    return leg('failed', 'Automatic backup could not finish.');
  }
}

/**
 * Keep only the newest `keepLast` BUNDLES at `destination`.
 *
 * Without this a daily schedule quietly fills the user's Drive/Dropbox (and app
 * Documents) forever.
 *
 * Device-wide, because the file is: `keepLast: 5` now means "the last five
 * backups", each of which holds every household. Under the per-household
 * archives this had to be scoped per household or a sweep of five would have
 * deleted two budgets' entire history to make room for the third's.
 *
 * Legacy single-household archives are NEVER swept — `isBundleArchiveName`
 * filters them out. They are the member's only copy of whatever those budgets
 * looked like before the first bundle ran, they are a fixed set that nothing
 * adds to, and deleting someone's older backups on the way past is not what
 * a retention cap on new ones asked for. They stay until the member removes
 * them from the Backup screen.
 *
 * Pruning failures are swallowed — a backup that succeeded must not be reported
 * as failed because cleanup afterwards did not.
 */
export async function pruneOldBackups(
  destination: BudgetAutoBackupDestination,
  keepLast: number,
  /** Ignored — kept so pre-bundle callers keep compiling. */
  _householdId?: string,
): Promise<number> {
  if (keepLast <= 0) return 0;
  /*
   * `replace` mode writes one file, so there is nothing to sweep — and sweeping
   * anyway would be actively wrong. The dated archives still sitting in the
   * folder are the ones written BEFORE the member switched modes; they asked to
   * stop making new copies, not to have the existing ones deleted out from
   * under them.
   */
  if ((await getBudgetBackupRetention()) === 'replace') return 0;
  const bundlesOnly = <T extends { fileName: string }>(entries: T[]): T[] =>
    entries.filter((entry) => isBundleArchiveName(entry.fileName));
  try {
    if (destination === 'device') {
      const stale = bundlesOnly(await listLocalBudgetBackups()).slice(keepLast);
      for (const entry of stale) {
        await deleteLocalBudgetBackup(entry.fileName).catch(() => undefined);
      }
      return stale.length;
    }

    if (destination === 'files') {
      const stale = bundlesOnly(await listDeviceFolderBackups()).slice(keepLast);
      for (const entry of stale) {
        await deleteDeviceFolderBackup(entry.uri).catch(() => undefined);
      }
      return stale.length;
    }

    const stale = bundlesOnly(await listCloudBudgetBackups(destination)).slice(keepLast);
    for (const entry of stale) {
      await deleteCloudBudgetBackup(destination, entry.id).catch(() => undefined);
    }
    return stale.length;
  } catch (error) {
    console.warn('[budget-autobackup] prune failed', destination, error);
    return 0;
  }
}

let appStateSubscription: { remove: () => void } | null = null;
let lastForegroundCheckAt = 0;

/**
 * Re-check on every foreground transition, in addition to the check that runs
 * when the local session opens.
 *
 * Idempotent — `ensureBudgetLocalSession` calls this on every session open
 * (launch, sign-in, household switch) and only the first call subscribes.
 */
export function startBudgetAutoBackupScheduler(): void {
  // First check covers the common case: app launched, session just opened.
  void runBudgetAutoBackupIfDue();

  if (appStateSubscription) return;
  appStateSubscription = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next !== 'active') return;
    // Tapping through a share sheet or OAuth screen bounces AppState several
    // times in a row; throttle so a slow seal is not queued repeatedly.
    const now = Date.now();
    if (now - lastForegroundCheckAt < 60_000) return;
    lastForegroundCheckAt = now;
    void runBudgetAutoBackupIfDue();
  });
}

export function stopBudgetAutoBackupScheduler(): void {
  appStateSubscription?.remove();
  appStateSubscription = null;
  lastForegroundCheckAt = 0;
}

/**
 * Nag once when a backup has been due for `OVERDUE_REMINDER_MS`. This is the
 * safety net for the foreground-only design: if the app is not opened, nothing
 * else will tell the user their backups have stopped.
 *
 * ONE nag for the device, because one file covers the device. Under the
 * per-household archives this had to name a household — a member with three
 * budgets got up to three identical notifications with no way to tell which was
 * exposed, and acting on one told them nothing about the other two. With a
 * bundle there is one schedule to be overdue and one thing to say about it.
 */
async function scheduleOverdueReminderIfNeeded(
  settings: BudgetAutoBackupSettings,
  now: Date,
): Promise<void> {
  const due = nextBudgetAutoBackupDueAt(settings);
  if (!due) return;
  if (now.getTime() - due.getTime() < OVERDUE_REMINDER_MS) return;
  // One pending nag at a time — re-scheduling on every failed foreground check
  // would stack up a notification per app open.
  if (settings.overdueNotificationId) return;

  try {
    if (!(await notificationService.hasPermission())) return;
    const identifier = await notificationService.scheduleLocalNotification(
      'Budget backup is overdue',
      'Open Symply Budget to finish the automatic backup.',
      null,
      { type: 'budget_auto_backup_overdue' },
    );
    await updateBudgetAutoBackupSettings({ overdueNotificationId: identifier });
  } catch (error) {
    console.warn('[budget-autobackup] reminder failed', error);
  }
}
