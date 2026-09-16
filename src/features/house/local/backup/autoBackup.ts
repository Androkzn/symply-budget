// Polyfill BEFORE `@symply/local-first` (noble caches `crypto` at import, so a
// later arming is too late). `../engine` arms it too, but its import is
// evaluated after the one below — which is exactly how phrase generation broke
// on the Budget side with "crypto.getRandomValues must be defined" while every
// other local-first entry point worked.
import '../cryptoPolyfill';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { AppState, type AppStateStatus } from 'react-native';

import { notificationService } from '@services/notifications';
import { generateRecoveryPhrase } from '@symply/local-first';

import { getActiveHouseholdId, isLocalHouseSessionOpen, listLocalHouseProperties } from '../engine';

import { HOUSE_ALL_HOMES_ID, HOUSE_ALL_HOMES_LABEL, isAllHomesTarget } from './allHomes';
import {
  autoBackupDestinationLabel,
  autoBackupSupports,
  backupFileNameFor,
  cloudProviderLabel,
  deleteCloudHouseBackup,
  deleteDeviceFolderBackup,
  deleteLocalHouseBackup,
  getHouseBackupRetention,
  isCloudBackupProvider,
  isCloudProviderConfigured,
  listCloudHouseBackups,
  listDeviceFolderBackups,
  listLocalHouseBackups,
  saveHouseBackupTo,
  type HouseAutoBackupDestination,
} from './backupDestinations';
import { recordHouseBackupSuccess } from './backupHistory';
import { beginHouseBackupTask, finishHouseBackupTask } from './backupTaskStore';

/**
 * House V2 — scheduled automatic backups. Ported from
 * `budget/local/backup/autoBackup.ts`.
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
 * A manual backup mints a fresh 12-word phrase and shows it once. An unattended
 * backup has nobody to show it to, so a per-run phrase would produce archives
 * that can never be opened. Auto-backup therefore seals every archive under one
 * phrase, generated when the feature is switched on, displayed for the user to
 * save, and kept in the device keychain (`expo-secure-store`) from then on.
 *
 * That is a real trade-off: anyone who can read the keychain can open the
 * backups. It is the same trust boundary as the local ledger's own device keys,
 * which already live there — and the alternative (unopenable backups) is worse.
 *
 * ## Why one run covers EVERY property (Q15 / H5)
 *
 * A member holds up to three homes on one device, and a home is most at risk
 * exactly when it is the one they have not opened in weeks. Backing up only the
 * active property and labelling it "Automatic backup: on" would show three
 * green ticks over archives for one home. So a due run walks every property
 * this device holds, each with its own schedule, phrase, destination and
 * history.
 *
 * They are sealed one after another, never in parallel. Argon2id is deliberately
 * memory-hard; three concurrent seals is three times the memory spike, on the
 * device class most likely to be killed for it, to save time nobody is waiting
 * on.
 */

export type HouseAutoBackupFrequency = 'daily' | 'weekly' | 'monthly';

export type HouseAutoBackupSettings = {
  enabled: boolean;
  frequency: HouseAutoBackupFrequency;
  destination: HouseAutoBackupDestination;
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

export const HOUSE_AUTO_BACKUP_DEFAULTS: HouseAutoBackupSettings = {
  enabled: false,
  frequency: 'weekly',
  destination: 'device',
  keepLast: 5,
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
  overdueNotificationId: null,
};

const SETTINGS_KEY_PREFIX = 'house.backup.autoSettings';
/** Keychain, not AsyncStorage — this phrase opens every scheduled archive. */
const PHRASE_KEY_PREFIX = 'house.backup.autoPhrase';

const settingsKeyFor = (householdId: string) => `${SETTINGS_KEY_PREFIX}:${householdId}`;

/**
 * SecureStore rejects any key outside `[A-Za-z0-9._-]` — it throws rather than
 * degrading — so the keychain half cannot use the `:` separator the
 * AsyncStorage half does. Household ids are `hh_local_<hex>` and already fit;
 * anything a server might issue is folded to `_` rather than trusted.
 */
const phraseKeyFor = (householdId: string) =>
  `${PHRASE_KEY_PREFIX}.${householdId.replace(/[^A-Za-z0-9._-]+/g, '_')}`;

const FREQUENCY_MS: Record<HouseAutoBackupFrequency, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  // Calendar months vary; 30 days is the honest approximation for "monthly"
  // here and keeps the due check a pure function of two timestamps.
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export const HOUSE_AUTO_BACKUP_FREQUENCY_LABEL: Record<HouseAutoBackupFrequency, string> = {
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every 30 days',
};

/** Overdue by this much with no successful run → remind the user. */
const OVERDUE_REMINDER_MS = 3 * 24 * 60 * 60 * 1000;

async function readSettingsAt(key: string): Promise<HouseAutoBackupSettings | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<HouseAutoBackupSettings>;
  // Merge over defaults so a settings blob written by an older build (missing
  // keys added later) can never yield `undefined` where code expects a value.
  return { ...HOUSE_AUTO_BACKUP_DEFAULTS, ...parsed };
}

/**
 * One property's schedule. Defaults to the active home — the one whose settings
 * a screen is showing.
 */
export async function getHouseAutoBackupSettings(
  householdId?: string,
): Promise<HouseAutoBackupSettings> {
  const target = householdId ?? getActiveHouseholdId();
  try {
    if (!target) return { ...HOUSE_AUTO_BACKUP_DEFAULTS };
    return (await readSettingsAt(settingsKeyFor(target))) ?? { ...HOUSE_AUTO_BACKUP_DEFAULTS };
  } catch {
    return { ...HOUSE_AUTO_BACKUP_DEFAULTS };
  }
}

export async function updateHouseAutoBackupSettings(
  patch: Partial<HouseAutoBackupSettings>,
  householdId?: string,
): Promise<HouseAutoBackupSettings> {
  const target = householdId ?? getActiveHouseholdId();
  const next = { ...(await getHouseAutoBackupSettings(target ?? undefined)), ...patch };
  // Without a property there is nowhere honest to file a schedule: a device-wide
  // key would be read back as whichever home opens next, which is the exact
  // cross-attribution the per-property keys exist to prevent.
  if (target) await AsyncStorage.setItem(settingsKeyFor(target), JSON.stringify(next));
  return next;
}

/**
 * The phrase every scheduled archive for one property is sealed under.
 *
 * Per home because the archives are: a member restoring the cabin needs the
 * words that opened the cabin's file, and offering them the house's phrase
 * costs a full Argon2 pass to be told it is wrong.
 */
export async function getHouseAutoBackupPhrase(householdId?: string): Promise<string | null> {
  const target = householdId ?? getActiveHouseholdId();
  if (!target) return null;
  try {
    return await SecureStore.getItemAsync(phraseKeyFor(target));
  } catch {
    return null;
  }
}

/**
 * Turn scheduled backups on for one property, returning the phrase to show the
 * user once.
 *
 * The phrase is generated on first enable and reused forever after, so
 * re-enabling later does not orphan the archives already written — and it is
 * per home for the same reason, since each home's archives are sealed under
 * their own.
 */
export async function enableHouseAutoBackup(options: {
  frequency: HouseAutoBackupFrequency;
  destination: HouseAutoBackupDestination;
  keepLast?: number;
  householdId?: string;
}): Promise<{ settings: HouseAutoBackupSettings; phrase: string }> {
  const target = options.householdId ?? getActiveHouseholdId();
  if (!target) {
    // Showing someone twelve words and storing them nowhere hands them a phrase
    // that opens nothing. Refuse instead.
    throw new Error('No home is open on this device yet, so backups cannot be scheduled.');
  }
  let phrase = await getHouseAutoBackupPhrase(target);
  if (!phrase) {
    phrase = generateRecoveryPhrase();
    await SecureStore.setItemAsync(phraseKeyFor(target), phrase);
  }

  const settings = await updateHouseAutoBackupSettings(
    {
      enabled: true,
      frequency: options.frequency,
      destination: options.destination,
      ...(options.keepLast != null ? { keepLast: options.keepLast } : {}),
      lastStatus: null,
      lastError: null,
    },
    target,
  );

  return { settings, phrase };
}

/**
 * Turn scheduled backups off for one property. The phrase is deliberately kept
 * — archives already written are still sealed under it, and deleting it would
 * strand them.
 */
export async function disableHouseAutoBackup(
  householdId?: string,
): Promise<HouseAutoBackupSettings> {
  const target = householdId ?? getActiveHouseholdId();
  await cancelOverdueReminder(target ?? undefined);
  return updateHouseAutoBackupSettings({ enabled: false }, target ?? undefined);
}

/** Clear one property's pending overdue nag; no-op when none is scheduled. */
async function cancelOverdueReminder(householdId?: string): Promise<void> {
  const { overdueNotificationId } = await getHouseAutoBackupSettings(householdId);
  if (!overdueNotificationId) return;
  await notificationService.cancelNotification(overdueNotificationId).catch(() => undefined);
  await updateHouseAutoBackupSettings({ overdueNotificationId: null }, householdId);
}

export function nextHouseAutoBackupDueAt(settings: HouseAutoBackupSettings): Date | null {
  if (!settings.enabled) return null;
  if (!settings.lastRunAt) return new Date(0); // never run → due immediately
  const last = Date.parse(settings.lastRunAt);
  if (Number.isNaN(last)) return new Date(0);
  return new Date(last + FREQUENCY_MS[settings.frequency]);
}

export function isHouseAutoBackupDue(
  settings: HouseAutoBackupSettings,
  now: Date = new Date(),
): boolean {
  const due = nextHouseAutoBackupDueAt(settings);
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
 * "Empty" means empty OF THIS PROPERTY'S ARCHIVES. Counting every file in the
 * folder would let one home's backups vouch for another's.
 *
 * A folder we could not read is NOT treated as empty: that would seal a fresh
 * archive on every foreground for as long as the read kept failing.
 */
async function isHouseAutoBackupDueOrUnprotected(
  settings: HouseAutoBackupSettings,
  now: Date,
  householdId: string,
): Promise<boolean> {
  if (isHouseAutoBackupDue(settings, now)) return true;
  if (settings.destination !== 'device') return false;
  try {
    return (await listLocalHouseBackups(householdId)).length === 0;
  } catch {
    return false;
  }
}

export type HouseAutoBackupStatus = 'ok' | 'skipped' | 'failed' | 'needs_auth';

/** What one property's leg of a run did. */
export type HouseAutoBackupPropertyResult = {
  householdId: string;
  propertyName: string;
  status: HouseAutoBackupStatus;
  message: string;
  fileName?: string;
  prunedCount?: number;
};

export type HouseAutoBackupRunResult = {
  status: HouseAutoBackupStatus;
  /** Why a run was skipped / what failed — safe to show. */
  message: string;
  fileName?: string;
  prunedCount?: number;
  /**
   * Every property the run touched. The flat fields above summarise these for
   * the task slot's one-line toast; anything that wants to say which home is
   * unprotected has to read this.
   */
  properties: HouseAutoBackupPropertyResult[];
};

/** Guards against a second run starting while a slow Argon2 seal is in flight. */
let runInFlight: Promise<HouseAutoBackupRunResult> | null = null;

/**
 * Run a scheduled backup if one is due.
 *
 * Safe to call on every app foreground: it no-ops unless auto-backup is on, the
 * ledger is open, and the interval has elapsed. Never throws — a backup failure
 * must not take down whatever triggered it.
 */
export async function runHouseAutoBackupIfDue(
  options: { force?: boolean; now?: Date; householdId?: string } = {},
): Promise<HouseAutoBackupRunResult> {
  if (runInFlight) return runInFlight;
  // Announce the run through the shared task slot so a scheduled seal is
  // visible ("Backing up…") and reports its outcome as a toast, wherever the
  // member is. A run that turns out to be a no-op (off, not due, ledger closed)
  // never claimed the slot's attention, so it releases it as `cancelled` and
  // says nothing.
  const runId = beginHouseBackupTask('scheduled');
  runInFlight = executeAutoBackup(options)
    .then((result) => {
      if (runId != null) {
        finishHouseBackupTask(
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

/** A property as this module addresses it: an id to key by, a name to say. */
type AutoBackupTarget = { householdId: string; propertyName: string };

/**
 * The whole-device schedule, as a target this module can treat like any other.
 *
 * Everything a leg needs is keyed by household id — the settings blob, the
 * keychain phrase, the file name token, the "last backup" record, the retention
 * sweep — so "all homes" needs no parallel machinery, only an id. What it
 * produces is one file with a section per home rather than a file per home.
 */
const ALL_HOMES_TARGET: AutoBackupTarget = {
  householdId: HOUSE_ALL_HOMES_ID,
  propertyName: HOUSE_ALL_HOMES_LABEL,
};

/**
 * Which properties this run covers.
 *
 * `householdId` narrows to one — the Backup screen's "Back up now" for the home
 * in front of the member, or `HOUSE_ALL_HOMES_ID` for the whole-device schedule.
 * Otherwise every property on the device, because the whole point of the fan-out
 * is to reach the ones nobody has opened.
 *
 * A property still awaiting enrolment is skipped for its own per-home leg: its
 * rows have not been decrypted onto this device yet, so there is normally
 * nothing to seal and the attempt would fail every run. It is still INSIDE the
 * whole-device file — see `houseBackupTargets`, where that difference is argued.
 */
function targetsFor(householdId?: string): AutoBackupTarget[] {
  if (isAllHomesTarget(householdId)) return [ALL_HOMES_TARGET];
  return listLocalHouseProperties()
    .filter((entry) => !entry.awaitingEnrolment)
    .filter((entry) => !householdId || entry.householdId === householdId)
    .map((entry) => ({
      householdId: entry.householdId,
      propertyName: entry.name.trim() || 'Home',
    }));
}

/**
 * True when the member has put the SCHEDULE on the whole-device file rather than
 * on the individual homes.
 *
 * Checked before the fan-out instead of being added to it as an always-present
 * leg: a leg that reports `skipped` on every run for every member who does not
 * use this mode would show up in `properties` — which is what a caller reads to
 * say which homes are unprotected — as a home called "All homes" that is never
 * backed up. One settings read is cheaper than that confusion.
 */
async function wholeDeviceScheduleIsOn(): Promise<boolean> {
  try {
    return (await getHouseAutoBackupSettings(HOUSE_ALL_HOMES_ID)).enabled;
  } catch {
    return false;
  }
}

async function executeAutoBackup(options: {
  force?: boolean;
  now?: Date;
  householdId?: string;
}): Promise<HouseAutoBackupRunResult> {
  const now = options.now ?? new Date();

  // The seal reads a live ledger — without an open session there is nothing to
  // back up, and this is the normal state right after launch.
  if (!isLocalHouseSessionOpen()) {
    return { status: 'skipped', message: 'Your home is not open yet.', properties: [] };
  }

  const targets = targetsFor(options.householdId);
  // The whole-device schedule leads the run when it is on: it covers every home
  // in one file, so the per-home legs behind it are no-ops unless the member
  // deliberately runs both kinds.
  if (!options.householdId && (await wholeDeviceScheduleIsOn())) {
    targets.unshift(ALL_HOMES_TARGET);
  }
  if (targets.length === 0) {
    // Two different nothings, and they must not read the same. An empty
    // registry behind an open session is the launch race above; a NAMED home
    // that is not in it is a caller holding an id across a removal or a
    // sign-out, and telling them to wait for the ledger would send them to wait
    // for something that has already happened.
    return {
      status: 'skipped',
      message: options.householdId
        ? 'That home is no longer on this device.'
        : 'Your home is not open yet.',
      properties: [],
    };
  }

  const results: HouseAutoBackupPropertyResult[] = [];
  for (const target of targets) {
    // Sequential on purpose — see the module header on Argon2id memory.
    results.push(await backupOneProperty(target, options.force === true, now));
  }
  return summarizeRun(results);
}

/**
 * Seal one property, or record precisely why it was not sealed.
 *
 * Never throws. A run covers several homes and one of them failing must not
 * deprive the rest of theirs.
 */
async function backupOneProperty(
  target: AutoBackupTarget,
  force: boolean,
  now: Date,
): Promise<HouseAutoBackupPropertyResult> {
  const { householdId, propertyName } = target;
  const leg = (
    status: HouseAutoBackupStatus,
    message: string,
    extra: { fileName?: string; prunedCount?: number } = {},
  ): HouseAutoBackupPropertyResult => ({
    householdId,
    propertyName,
    status,
    message,
    ...extra,
  });

  try {
    const settings = await getHouseAutoBackupSettings(householdId);
    if (!settings.enabled) {
      return leg('skipped', 'Automatic backup is off.');
    }
    if (!force && !(await isHouseAutoBackupDueOrUnprotected(settings, now, householdId))) {
      return leg('skipped', 'Not due yet.');
    }

    const phrase = await getHouseAutoBackupPhrase(householdId);
    if (!phrase) {
      // Enabled but no phrase means the keychain entry was lost (restore from a
      // different device, keychain reset). Refuse rather than silently minting
      // a new phrase the user has never seen.
      const message =
        'Recovery phrase missing — turn automatic backup off and on again to reset it.';
      await updateHouseAutoBackupSettings({ lastStatus: 'failed', lastError: message }, householdId);
      return leg('failed', message);
    }

    const destination = settings.destination;
    // `files` is a scheduled destination on Android only — iOS can reach an
    // arbitrary folder only through the share sheet, which nobody is here to
    // answer. A setting carried over from an Android phone must fail loudly
    // rather than silently never run.
    if (!autoBackupSupports(destination)) {
      const message = `${autoBackupDestinationLabel(
        destination,
      )} cannot be backed up to on its own on this phone.`;
      await updateHouseAutoBackupSettings({ lastStatus: 'failed', lastError: message }, householdId);
      return leg('failed', message);
    }
    if (isCloudBackupProvider(destination) && !isCloudProviderConfigured(destination)) {
      const label = cloudProviderLabel(destination);
      await updateHouseAutoBackupSettings(
        { lastStatus: 'failed', lastError: `${label} is not set up in this build.` },
        householdId,
      );
      return leg('failed', `${label} is not set up in this build.`);
    }

    // Named after the home, not just the clock: three properties sealed in the
    // same minute would otherwise produce three files a member cannot tell
    // apart, and a retention sweep could not tell them apart either.
    //
    // The clock half is dropped entirely in `replace` mode, where the whole
    // point is that every run resolves to the same file.
    const fileName = backupFileNameFor(
      await getHouseBackupRetention(),
      { householdId, propertyName },
      now,
    );
    const result = await saveHouseBackupTo(destination, {
      fileName,
      phrase,
      householdId,
      // Never pop a consent screen from a background-ish trigger.
      allowInteractiveAuth: false,
    });

    if (result.status !== 'saved') {
      const status = result.status === 'needs_auth' ? 'needs_auth' : 'failed';
      await updateHouseAutoBackupSettings(
        { lastStatus: status, lastError: result.message },
        householdId,
      );
      await scheduleOverdueReminderIfNeeded(settings, now, target);
      return leg(status, result.message);
    }

    const prunedCount = await pruneOldBackups(destination, settings.keepLast, householdId);

    // Where it went, not just when it ran — the status card has to know whether
    // this is evidence it can re-check (an archive on this device) or evidence
    // it has to take on trust (bytes that left the phone). See backupHistory.ts.
    await recordHouseBackupSuccess(
      {
        at: now.toISOString(),
        destination,
        kind: 'scheduled',
        fileName,
        householdId,
      },
      householdId,
    );
    await updateHouseAutoBackupSettings(
      { lastRunAt: now.toISOString(), lastStatus: 'ok', lastError: null },
      householdId,
    );
    await cancelOverdueReminder(householdId);

    console.log('[house-autobackup] ok', householdId, destination, fileName, 'pruned=', prunedCount);
    return leg('ok', result.message, { fileName, prunedCount });
  } catch (error) {
    console.error('[house-autobackup] run threw', householdId, error);
    await updateHouseAutoBackupSettings(
      { lastStatus: 'failed', lastError: 'Automatic backup could not finish.' },
      householdId,
    ).catch(() => undefined);
    return leg('failed', 'Automatic backup could not finish.');
  }
}

/** Worst outcome wins — a run is only as good as its least protected home. */
const STATUS_RANK: Record<HouseAutoBackupStatus, number> = {
  skipped: 0,
  ok: 1,
  needs_auth: 2,
  failed: 3,
};

/**
 * Collapse the legs into the single line the task slot toasts.
 *
 * One property collapses to exactly its own result — the overwhelmingly common
 * shape. Several collapse to a count plus the worst outcome NAMED: "2 of 3
 * homes backed up" with no idea which one is exposed is the same silence this
 * fan-out exists to break.
 */
function summarizeRun(results: HouseAutoBackupPropertyResult[]): HouseAutoBackupRunResult {
  if (results.length === 1) {
    const only = results[0];
    return {
      status: only.status,
      message: only.message,
      fileName: only.fileName,
      prunedCount: only.prunedCount,
      properties: results,
    };
  }

  const ran = results.filter((entry) => entry.status !== 'skipped');
  if (ran.length === 0) {
    return { status: 'skipped', message: 'Nothing due.', properties: results };
  }
  // Exactly one leg actually did anything — the ordinary shape now that every
  // run also offers the whole-device schedule, which is off for most members and
  // skips silently. Reporting "Backed up 1 homes" over it would be both wrong
  // grammar and a worse answer than the leg's own sentence.
  if (ran.length === 1) {
    const only = ran[0];
    return {
      status: only.status,
      message: only.message,
      fileName: only.fileName,
      prunedCount: only.prunedCount,
      properties: results,
    };
  }

  const worst = ran.reduce((a, b) => (STATUS_RANK[b.status] > STATUS_RANK[a.status] ? b : a));
  const okCount = ran.filter((entry) => entry.status === 'ok').length;
  const message =
    worst.status === 'ok'
      ? `Backed up ${okCount} homes.`
      : `Backed up ${okCount} of ${ran.length} homes — ${worst.propertyName}: ${worst.message}`;
  return { status: worst.status, message, properties: results };
}

/**
 * Keep only the newest `keepLast` archives for ONE property at `destination`.
 *
 * Without this a daily schedule quietly fills the user's Drive/Dropbox (and app
 * Documents) forever. Scoped to a property because the cap is per property: an
 * unscoped sweep with three homes and `keepLast: 5` would leave five archives
 * total and delete two homes' entire history to make room for the third's — a
 * retention setting that destroys data is worse than no retention.
 *
 * **A whole-device archive is never swept by a per-home run**, and that is the
 * same argument one level up. Such a file contains every home, so it lists for
 * every home (`archiveBelongsTo`); three homes each keeping their last five
 * would take turns deleting the same shared files, and the sixth-newest would go
 * because one home counted to five — deleting the other two homes' copies with
 * it. The whole-device bucket is therefore its own cap, swept only by a caller
 * that passes `HOUSE_ALL_HOMES_ID` and means it.
 *
 * Pruning failures are swallowed — a backup that succeeded must not be reported
 * as failed because cleanup afterwards did not.
 */
export async function pruneOldBackups(
  destination: HouseAutoBackupDestination,
  keepLast: number,
  householdId?: string,
): Promise<number> {
  if (keepLast <= 0) return 0;
  const target = householdId ?? getActiveHouseholdId();
  if (!target) return 0;
  const sweepingAllHomes = isAllHomesTarget(target);
  /*
   * `replace` mode writes one file per property, so there is nothing to sweep —
   * and sweeping anyway would be actively wrong. The dated archives still
   * sitting in the folder are the ones written BEFORE the member switched
   * modes; they asked to stop making new copies, not to have the existing ones
   * deleted out from under them.
   */
  if ((await getHouseBackupRetention()) === 'replace') return 0;

  /**
   * Files this sweep is allowed to delete — see the note above. Coerced rather
   * than compared strictly: an entry that does not claim to cover every home
   * does not, and a listing shape from an older build must not become a file
   * that no sweep will ever touch.
   */
  const sweepable = <T extends { coversAllHomes?: boolean }>(entries: T[]): T[] =>
    entries.filter((entry) => Boolean(entry.coversAllHomes) === sweepingAllHomes);

  try {
    if (destination === 'device') {
      const stale = sweepable(await listLocalHouseBackups(target)).slice(keepLast);
      for (const entry of stale) {
        await deleteLocalHouseBackup(entry.fileName).catch(() => undefined);
      }
      return stale.length;
    }

    if (destination === 'files') {
      const stale = sweepable(await listDeviceFolderBackups(target)).slice(keepLast);
      for (const entry of stale) {
        await deleteDeviceFolderBackup(entry.uri).catch(() => undefined);
      }
      return stale.length;
    }

    const stale = sweepable(await listCloudHouseBackups(destination, target)).slice(keepLast);
    for (const entry of stale) {
      await deleteCloudHouseBackup(destination, entry.id).catch(() => undefined);
    }
    return stale.length;
  } catch (error) {
    console.warn('[house-autobackup] prune failed', destination, error);
    return 0;
  }
}

let appStateSubscription: { remove: () => void } | null = null;
let lastForegroundCheckAt = 0;

/**
 * Re-check on every foreground transition, in addition to the check that runs
 * when the local session opens.
 *
 * Idempotent — `DataContext` calls this on every session open (launch, sign-in,
 * property switch) and only the first call subscribes.
 */
export function startHouseAutoBackupScheduler(): void {
  // First check covers the common case: app launched, session just opened.
  void runHouseAutoBackupIfDue();

  if (appStateSubscription) return;
  appStateSubscription = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next !== 'active') return;
    // Tapping through a share sheet or OAuth screen bounces AppState several
    // times in a row; throttle so a slow seal is not queued repeatedly.
    const now = Date.now();
    if (now - lastForegroundCheckAt < 60_000) return;
    lastForegroundCheckAt = now;
    void runHouseAutoBackupIfDue();
  });
}

export function stopHouseAutoBackupScheduler(): void {
  appStateSubscription?.remove();
  appStateSubscription = null;
  lastForegroundCheckAt = 0;
}

/**
 * Nag once when a backup has been due for `OVERDUE_REMINDER_MS`. This is the
 * safety net for the foreground-only design: if the app is not opened, nothing
 * else will tell the user their backups have stopped.
 *
 * One nag per property, and the body names it. A member with three homes would
 * otherwise get up to three identical "Home backup is overdue" notifications
 * and no way to tell which — or, worse, would see one, back up the home they
 * happened to be in, and reasonably assume it was handled. The `householdId`
 * also rides in the payload so a tap can land in the right home.
 */
async function scheduleOverdueReminderIfNeeded(
  settings: HouseAutoBackupSettings,
  now: Date,
  target: AutoBackupTarget,
): Promise<void> {
  const due = nextHouseAutoBackupDueAt(settings);
  if (!due) return;
  if (now.getTime() - due.getTime() < OVERDUE_REMINDER_MS) return;
  // One pending nag at a time, per property — re-scheduling on every failed
  // foreground check would stack up a notification per app open.
  if (settings.overdueNotificationId) return;

  try {
    if (!(await notificationService.hasPermission())) return;
    const identifier = await notificationService.scheduleLocalNotification(
      'Home backup is overdue',
      `Open Symply House to finish the automatic backup for “${target.propertyName}”.`,
      null,
      { type: 'house_auto_backup_overdue', householdId: target.householdId },
    );
    await updateHouseAutoBackupSettings({ overdueNotificationId: identifier }, target.householdId);
  } catch (error) {
    console.warn('[house-autobackup] reminder failed', error);
  }
}
