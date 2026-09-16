import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppBackground, SafeAreaView, ScreenHeader } from '@components/common';
import { Card, GradientButton, TextInput, Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { BackupOptionSheet, type BackupOption } from '@features/budget/components/BackupOptionSheet';
import {
  CloudFolderPickerSheet,
  type PickedCloudFolder,
} from '@features/budget/components/CloudFolderPickerSheet';
import {
  BUDGET_AUTO_BACKUP_FREQUENCY_LABEL,
  disableBudgetAutoBackup,
  enableBudgetAutoBackup,
  getBudgetAutoBackupSettings,
  nextBudgetAutoBackupDueAt,
  runBudgetAutoBackupIfDue,
  updateBudgetAutoBackupSettings,
  type BudgetAutoBackupFrequency,
  type BudgetAutoBackupSettings,
} from '@features/budget/local/backup/autoBackup';
import {
  autoBackupDestinationLabel,
  chooseCloudBackupFolder,
  chooseDeviceBackupFolder,
  disconnectCloudProvider,
  getCloudAccount,
  switchCloudAccount,
  type CloudAccount,
  cloudProviderLabel,
  cloudProviderSupportsFolderPicking,
  forgetDeviceFolder,
  getBudgetBackupRetention,
  getRememberedDeviceFolder,
  setBudgetBackupRetention,
  BUDGET_BACKUP_DEVICE_FOLDER,
  type BudgetBackupRetention,
  type RememberedDeviceFolder,
  deleteLocalBudgetBackup,
  describeCloudFolder,
  getRememberedDriveFolder,
  isCloudProviderConfigured,
  listCloudBudgetBackups,
  listLocalBudgetBackups,
  readCloudBudgetBackup,
  readLocalBudgetBackup,
  reconnectCloudProvider,
  resetCloudBackupFolder,
  BUDGET_BACKUP_DRIVE_FOLDER,
  type BudgetAutoBackupDestination,
  type BudgetBackupCloudProvider,
  type BudgetBackupDestination,
  type LocalBudgetBackupEntry,
  type RememberedDriveFolder,
} from '@features/budget/local/backup/backupDestinations';
import {
  openBudgetBackupLocation,
  opensInFilesApp,
  type BudgetBackupLocation,
} from '@features/budget/local/backup/backupFileAccess';
import {
  backupEvidenceIsLocal,
  getLastBudgetBackupEvent,
  type BudgetBackupEvent,
} from '@features/budget/local/backup/backupHistory';
import {
  ensureBudgetBackupPhrase,
  rotateBudgetBackupPhrase,
} from '@features/budget/local/backup/backupPhrase';
import {
  consumeBudgetBackupPhrase,
  startManualBudgetBackup,
  useBudgetBackupTaskStore,
} from '@features/budget/local/backup/backupTaskStore';
import {
  getBudgetRestoreBreakdownLines,
  pickBudgetBackupArchive,
  type BudgetRestoreHouseholdOutcome,
} from '@features/budget/local/backup/budgetBackup';
import { getRememberedRestorePhrase } from '@features/budget/local/backup/restorePhraseMemory';
import {
  consumeBudgetRestoreOutcomes,
  startBudgetRestore,
  takeBudgetRestoreAttempt,
  useBudgetRestoreTaskStore,
} from '@features/budget/local/backup/restoreTaskStore';
import { listLocalBudgetHouseholds } from '@features/budget/local/engine';
import type { BudgetStackParamList } from '@navigation/types';
import { CornerRadius, IconSize, Layout, Spacing, hexToRgba, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import {
  BUDGET_CTA_ICON_WIDTH,
  BUDGET_CTA_ROW_STYLES,
  budgetCtaOutline,
  budgetCtaTint,
} from './budgetCtaLayout';
import { formatDataSize } from './budgetFormat';
import { BudgetRecoveryPhraseSheet } from './BudgetRecoveryPhraseSheet';
import { BudgetRestoreProgressCard } from './BudgetRestoreProgressCard';

/**
 * Budget → Backup & Restore.
 *
 * Split out of BudgetSettingsScreen, where backup had grown into four
 * same-weight buttons ("Save a backup", "Restore from backup", "Automatic
 * backup: Off", a dev loader) stacked in one group. Everything looked equally
 * important, so the screen answered none of the questions people actually
 * arrive with.
 *
 * The shape here follows those questions in order:
 *
 *  1. "Am I safe right now?"  → one status card, colour-coded, at the top.
 *  2. "Back it up."           → a single primary button; nothing competes.
 *  2b."What opens my files?"  → the device's one recovery phrase, shown or
 *                               replaced. Its own group, always visible.
 *  3. "Do it for me."         → automatic backup as a switch plus two
 *                               disclosure rows, not a chain of modals.
 *  4. "Get my data back."     → recent archives listed inline, one tap to
 *                               restore, instead of button → sheet → sheet.
 *  5. Rare + risky            → restoring a file from elsewhere sits last and
 *                               quiet, since it overwrites what is on the phone.
 *
 * (2b) used to be a row inside (3), because the phrase existed only for
 * scheduled runs — manual backups minted their own, per archive, and showed
 * them once. One device phrase now seals both, so the row had to come out from
 * behind a switch a member may never touch.
 */

const IS_ANDROID = Platform.OS === 'android';

/**
 * The timestamp half of a dated archive name. Absent from `replace`-mode names,
 * which deliberately carry no date so every run lands on the same file.
 */
const ARCHIVE_TIMESTAMP = /(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/;

/** `symply-budget-backup-2026-08-11-0915.json` → `11 Aug 2026, 09:15`. */
export function formatBackupFileName(fileName: string): string {
  const match = ARCHIVE_TIMESTAMP.exec(fileName);
  if (!match) return fileName.replace(/\.json$/, '');
  const [, year, month, day, hour, minute] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  if (Number.isNaN(date.getTime())) return fileName.replace(/\.json$/, '');
  return `${date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * What to call one archive in the list.
 *
 * A dated archive is named by the moment it was sealed, which is in its file
 * name. A `replace`-mode archive has no date in its name on purpose — it is
 * rewritten in place — so the only honest answer is when the file itself last
 * changed. Falling back to the raw name would print
 * `symply-budget-backup-home--hh_local_9f2c` at somebody, which names nothing
 * they were looking for.
 */
export function formatBackupEntryLabel(entry: {
  fileName: string;
  modifiedAt: string | null;
}): string {
  if (ARCHIVE_TIMESTAMP.test(entry.fileName)) return formatBackupFileName(entry.fileName);
  const when = entry.modifiedAt ? new Date(entry.modifiedAt) : null;
  if (!when || Number.isNaN(when.getTime())) return 'Latest backup';
  return `Latest backup · ${when.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}, ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/** Shared with the Danger Zone's retired-ledger rows — one size vocabulary. */
export function formatBackupSize(bytes: number): string {
  return formatDataSize(bytes);
}

/** Rough, friendly age — exactness is not what anyone reads this for. */
export function formatRelativeDay(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'recently';
  const days = Math.floor((now.getTime() - then.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? 'a month ago' : `${months} months ago`;
}

/** Names any destination in the same words the picker offered it under. */
export function backupDestinationLabel(destination: BudgetBackupDestination): string {
  switch (destination) {
    case 'device':
      return 'this device';
    case 'files':
      return IS_ANDROID ? 'the folder you picked' : 'the Files app';
    case 'share':
      return 'wherever you sent it';
    default:
      return cloudProviderLabel(destination);
  }
}

export type BackupHealth = {
  tone: 'good' | 'warn' | 'bad';
  title: string;
  detail: string;
  icon: string;
};

/**
 * Everything the card is allowed to reason from: what is on this device right
 * now, and what the app recorded about the last write.
 */
export type BackupEvidence = {
  /** Newest archive still present in the app's own folder, or null when none. */
  newestLocalBackupAt: string | null;
  /**
   * False when that folder could not be read. An unreadable folder is not an
   * empty one, and the difference decides whether "no archives" is a fact.
   */
  localListKnown: boolean;
  /** The last backup this app saw written, wherever it went. */
  lastSuccess: BudgetBackupEvent | null;
};

/**
 * The single answer the top of the screen exists to give. Derived rather than
 * stored so it can never drift from the settings and the archives on disk.
 *
 * The rule it enforces: **only claim protection we can still point at.** This
 * card used to read "Protected · Last backup today" above a list reading "No
 * backups on this device yet", because it trusted `lastRunAt` — a record that a
 * run happened, which survives the archive that run produced being deleted. A
 * timestamp is not a backup; the file is.
 */
export function deriveBackupHealth(
  settings: BudgetAutoBackupSettings | null,
  evidence: BackupEvidence,
  now: Date = new Date(),
): BackupHealth {
  if (settings?.enabled && (settings.lastStatus === 'failed' || settings.lastStatus === 'needs_auth')) {
    return {
      tone: 'bad',
      title: 'Needs attention',
      detail: settings.lastError ?? 'The last automatic backup did not finish.',
      icon: 'alert-circle',
    };
  }

  // Installs that backed up before this build kept only the schedule's
  // timestamp. Read it as a run to whatever the schedule targets, so their
  // history survives the change — and is held to the same evidence rule.
  const lastSuccess: BudgetBackupEvent | null =
    evidence.lastSuccess ??
    (settings?.lastRunAt
      ? {
          at: settings.lastRunAt,
          destination: settings.destination,
          kind: 'scheduled',
          fileName: null,
        }
      : null);

  // What we can still point at:
  //  - an archive in the app's folder proves itself;
  //  - a run that left the phone cannot be re-checked from a status card, so
  //    its record stands;
  //  - a run that wrote to THIS device is worth exactly the file it left, so
  //    the folder is the record: whatever is in it now, and nothing else. That
  //    file may have been deleted since — here, or from Files. The one
  //    exception is a folder we could not read, where the record keeps the
  //    benefit of the doubt rather than us inventing a loss.
  const wroteHere = lastSuccess != null && backupEvidenceIsLocal(lastSuccess.destination);
  const recordedAt =
    lastSuccess == null ? null : !wroteHere || !evidence.localListKnown ? lastSuccess.at : null;
  const localEvidenceGone = wroteHere && evidence.localListKnown && !evidence.newestLocalBackupAt;
  const latest =
    [evidence.newestLocalBackupAt, recordedAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .pop() ?? null;

  if (!latest) {
    return localEvidenceGone
      ? {
          tone: 'warn',
          title: 'Backup missing',
          // Names what happened instead of pretending nothing ever did — the
          // member DID back up, and the copy is gone.
          detail: `The backup from ${formatRelativeDay(
            lastSuccess!.at,
            now,
          )} is no longer on this device. Back up again to be safe.`,
          icon: 'alert-circle-outline',
        }
      : {
          tone: 'warn',
          title: 'No backup yet',
          detail: 'If you lose this phone, your budget goes with it. Back up once to be safe.',
          icon: 'shield-outline',
        };
  }

  if (settings?.enabled) {
    const due = nextBudgetAutoBackupDueAt(settings);
    const overdue = due != null && now.getTime() > due.getTime() + 2 * 24 * 60 * 60 * 1000;
    // Say where they go when it is not here: an empty "YOUR BACKUPS" list under
    // a "Protected" card otherwise reads as the same contradiction all over.
    const where =
      settings.destination === 'device'
        ? ''
        : ` to ${autoBackupDestinationLabel(settings.destination)}`;
    return {
      tone: overdue ? 'warn' : 'good',
      title: overdue ? 'Backup overdue' : 'Protected',
      detail: overdue
        ? `Last backup ${formatRelativeDay(latest, now)}${where}. Open the app more often, or back up now.`
        : `Last backup ${formatRelativeDay(latest, now)}${where}, ${BUDGET_AUTO_BACKUP_FREQUENCY_LABEL[
            settings.frequency
          ].toLowerCase()}.`,
      icon: overdue ? 'time-outline' : 'shield-checkmark',
    };
  }

  const age = formatRelativeDay(latest, now);
  const stale = age.includes('month');
  return {
    tone: stale ? 'warn' : 'good',
    title: stale ? 'Backup is old' : 'Backed up',
    detail: `Last backup ${age}. Automatic backup is off.`,
    icon: stale ? 'time-outline' : 'shield-checkmark',
  };
}

export function BudgetBackupScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();

  const [autoSettings, setAutoSettings] = useState<BudgetAutoBackupSettings | null>(null);
  const [localBackups, setLocalBackups] = useState<LocalBudgetBackupEntry[]>([]);
  /**
   * Whether that list is a fact. A failed read used to fall back to `[]`, which
   * renders as "No backups on this device yet" — an assertion we had not earned
   * and could not have made honestly.
   */
  const [localListKnown, setLocalListKnown] = useState(true);
  const [lastSuccess, setLastSuccess] = useState<BudgetBackupEvent | null>(null);
  /**
   * Where Drive backups land. Null until the first upload creates the app's own
   * folder — until then there is a name to promise but no folder to point at.
   */
  const [driveFolder, setDriveFolder] = useState<RememberedDriveFolder | null>(null);
  /** Android only — the folder on the phone, once one has been picked. */
  const [deviceFolder, setDeviceFolder] = useState<RememberedDeviceFolder | null>(null);
  const [retention, setRetention] = useState<BudgetBackupRetention>('replace');
  /** The Google account backups are going to, or null when none is connected. */
  const [driveAccount, setDriveAccount] = useState<CloudAccount | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Sheets
  const [destinationSheetOpen, setDestinationSheetOpen] = useState(false);
  const [frequencySheetOpen, setFrequencySheetOpen] = useState(false);
  const [autoDestinationSheetOpen, setAutoDestinationSheetOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  const [cloudPicker, setCloudPicker] = useState<{
    provider: BudgetBackupCloudProvider;
    options: BackupOption[];
    loading: boolean;
    /** Listing failed — shown IN the sheet, never as an alert over it. */
    error?: string;
  } | null>(null);

  // The recovery phrase gets its own sheet — see BudgetRecoveryPhraseSheet for
  // why an Alert (and a silent clipboard copy) was the wrong home for it.
  const [phraseSheet, setPhraseSheet] = useState<{
    phrase: string;
    intro: string;
    savedTo?: BudgetBackupLocation | null;
  } | null>(null);

  // Restore
  const [pendingRestoreJson, setPendingRestoreJson] = useState<string | null>(null);
  const [restorePhraseDraft, setRestorePhraseDraft] = useState('');
  const [restorePhraseSource, setRestorePhraseSource] = useState<
    'remembered' | 'clipboard' | 'retry' | 'none'
  >('none');
  /**
   * What the finished restore did, per household.
   *
   * A list rather than one summary since the bundle: a file can restore three
   * budgets and fail a fourth, and a single breakdown has nowhere to say so —
   * the member would read "Restored" over a household that never came back.
   */
  const [restoreSuccessOutcomes, setRestoreSuccessOutcomes] = useState<
    BudgetRestoreHouseholdOutcome[] | null
  >(null);

  // The backup that may be sealing right now — started here, or by the
  // scheduler while the member was somewhere else entirely.
  const backupStatus = useBudgetBackupTaskStore((t) => t.status);
  const backupKind = useBudgetBackupTaskStore((t) => t.kind);
  const pendingPhrase = useBudgetBackupTaskStore((t) => t.pendingPhrase);
  const isBackingUp = backupStatus === 'running';

  /**
   * The restore that may be running right now — including one this screen never
   * saw start, because the member left mid-run and came back. Read from the
   * task store rather than local state for exactly that reason: local state
   * dies with the screen, and the run does not.
   */
  const restoreStatus = useBudgetRestoreTaskStore((t) => t.status);
  const restoreProgress = useBudgetRestoreTaskStore((t) => t.progress);
  const restoreLabel = useBudgetRestoreTaskStore((t) => t.label);
  const restoreStartedAt = useBudgetRestoreTaskStore((t) => t.startedAt);
  const restoreAttempt = useBudgetRestoreTaskStore((t) => t.attempt);
  const pendingRestoreOutcomes = useBudgetRestoreTaskStore((t) => t.pendingOutcomes);
  const isRestoring = restoreStatus === 'running';

  /**
   * How many budgets one backup now covers.
   *
   * Read once per render from the session registry — a synchronous, cold-safe
   * read (`listLocalBudgetHouseholds` touches no hydrated state), so this needs
   * no effect and cannot show a stale count after a household is added or left.
   */
  const householdCount = listLocalBudgetHouseholds().length;

  /** Scrolled to the top when a restore starts, so its card is what you see. */
  const scrollRef = useRef<ScrollView>(null);

  const refresh = useCallback(async () => {
    const [settings, listed, folder, success, phoneFolder, storedRetention, account] =
      await Promise.all([
      getBudgetAutoBackupSettings(),
      listLocalBudgetBackups().then(
        (entries) => ({ entries, known: true }),
        (error) => {
          console.warn('[budget-backup] could not list on-device archives', error);
          return { entries: [] as LocalBudgetBackupEntry[], known: false };
        },
      ),
      getRememberedDriveFolder().catch(() => null),
      getLastBudgetBackupEvent().catch(() => null),
      IS_ANDROID ? getRememberedDeviceFolder().catch(() => null) : Promise.resolve(null),
      getBudgetBackupRetention().catch(() => 'replace' as BudgetBackupRetention),
      getCloudAccount('google-drive').catch(() => null),
    ]);
    setDeviceFolder(phoneFolder);
    setRetention(storedRetention);
    setDriveAccount(account);
    setAutoSettings(settings);
    setLocalBackups(listed.entries);
    setLocalListKnown(listed.known);
    setDriveFolder(folder);
    setLastSuccess(success);
  }, []);

  /**
   * Put the top of the list back under the member's eyes.
   *
   * The restore card lives at the very top and the button that starts a restore
   * sits at the very bottom, so without this the member taps "Verify & restore"
   * and watches the panel vanish with no visible replacement. Deferred a frame
   * so the card is mounted before we scroll to where it will be.
   */
  const scrollToTop = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      // Re-entering mid-restore: the progress is at the top, so start there
      // rather than wherever this screen was scrolled to when they left.
      if (useBudgetRestoreTaskStore.getState().status === 'running') scrollToTop();
    }, [refresh, scrollToTop]),
  );

  // A run that finished anywhere (this screen, another screen, the scheduler)
  // changes what this screen shows: a new archive, a new status line.
  useEffect(() => {
    if (backupStatus === 'ok' || backupStatus === 'failed') void refresh();
  }, [backupStatus, refresh]);

  // A restore rewrites the whole ledger — including the archive list and the
  // status card above it.
  useEffect(() => {
    if (restoreStatus === 'ok') void refresh();
  }, [restoreStatus, refresh]);

  // Present the breakdown the run parked, for the same reason the phrase is
  // parked: the member may have been three screens away when it finished, and
  // "what did I actually get back?" is not a question a toast can answer.
  useEffect(() => {
    if (pendingRestoreOutcomes.length === 0 || restoreSuccessOutcomes) return;
    setRestoreSuccessOutcomes(consumeBudgetRestoreOutcomes());
  }, [pendingRestoreOutcomes, restoreSuccessOutcomes]);

  /**
   * Reopen the phrase panel on a failed run, with the archive and the words
   * already in it.
   *
   * A wrong phrase is the common failure, and the archive behind it came from
   * Drive, Dropbox or a file picker — making someone walk that path again to
   * fix one mistyped word is a punishment for a typo.
   */
  useEffect(() => {
    if (restoreStatus !== 'failed' || !restoreAttempt || pendingRestoreJson) return;
    const attempt = takeBudgetRestoreAttempt();
    if (!attempt) return;
    setPendingRestoreJson(attempt.archiveJson);
    setRestorePhraseDraft(attempt.phrase);
    setRestorePhraseSource('retry');
    // The panel is the last thing on the screen, and a member who failed while
    // they were somewhere else arrives to a screen that looks untouched. Put
    // the field in front of them rather than under two more sections.
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [restoreStatus, restoreAttempt, pendingRestoreJson]);

  // Collect the once-only phrase as soon as this screen can show it. Parked in
  // the store rather than passed back, precisely so a member who navigated away
  // mid-seal still gets it the moment they return.
  useEffect(() => {
    if (!pendingPhrase || phraseSheet) return;
    setPhraseSheet(consumeBudgetBackupPhrase());
  }, [pendingPhrase, phraseSheet]);

  const health = useMemo(
    () =>
      deriveBackupHealth(autoSettings, {
        newestLocalBackupAt: localBackups[0]?.modifiedAt ?? null,
        localListKnown,
        lastSuccess,
      }),
    [autoSettings, localBackups, localListKnown, lastSuccess],
  );

  const healthColor =
    health.tone === 'good' ? colors.success : health.tone === 'warn' ? colors.warning : colors.error;

  // --- Manual backup ---------------------------------------------------------
  /**
   * Hand the seal to the background runner and return.
   *
   * Nothing is awaited here: the member can leave this screen the moment they
   * pick a destination, and the outcome finds them as a toast. The fresh phrase
   * is parked in the task store and collected by the effect below — including
   * the case where they came back to this screen after wandering off.
   */
  const handleSaveTo = useCallback((destination: BudgetBackupDestination) => {
    setDestinationSheetOpen(false);
    startManualBudgetBackup(destination);
  }, []);

  // --- Automatic backup ------------------------------------------------------
  const handleToggleAuto = useCallback(
    async (next: boolean) => {
      setIsBusy(true);
      try {
        if (!next) {
          await disableBudgetAutoBackup();
          await refresh();
          return;
        }
        // Turning it on needs a destination — reuse the current one if we have
        // it, otherwise ask. Never enable into an unknown target.
        const current = await getBudgetAutoBackupSettings();
        const { phrase, phraseIsNew } = await enableBudgetAutoBackup({
          frequency: current.frequency,
          destination: current.destination,
        });
        await refresh();
        // Shown on every enable, new phrase or not: switching on unattended
        // backups is the moment the member stops being present for their own
        // archives, so it is the moment to put the words in front of them.
        //
        // What changes is which sentence they need. For a phrase this call
        // minted, it is "here is your one phrase". For the one they already have
        // — from a manual backup, or an earlier enable — it is "the schedule
        // uses the phrase you already saved", because being handed familiar
        // words with no explanation reads as a second, different secret.
        setPhraseSheet({
          phrase,
          intro: phraseIsNew
            ? 'Automatic backup is on. Every backup — scheduled or manual — is sealed with this one phrase, and it stays the same, so you only have to save it once. This device remembers it, but that copy goes with the phone: keep your own, or the backups it has already sent can never be opened.'
            : 'Automatic backup is on. It uses the recovery phrase this device already has — the same words below, unchanged, so anything you saved earlier still opens every backup it makes from now on.',
        });
      } catch (error) {
        console.error('[budget-backup] toggle failed', error);
        Alert.alert('Automatic backup', 'Could not change automatic backup.');
      } finally {
        setIsBusy(false);
      }
    },
    [refresh],
  );

  const handleFrequencyPicked = useCallback(
    async (key: string) => {
      setFrequencySheetOpen(false);
      await updateBudgetAutoBackupSettings({ frequency: key as BudgetAutoBackupFrequency });
      await refresh();
    },
    [refresh],
  );

  const handleAutoDestinationPicked = useCallback(
    async (key: string) => {
      setAutoDestinationSheetOpen(false);
      await updateBudgetAutoBackupSettings({
        destination: key as BudgetAutoBackupDestination,
        // A new target has never succeeded yet — clear a stale error so the
        // status card does not accuse the new destination of the old one's sin.
        lastStatus: null,
        lastError: null,
      });
      await refresh();
    },
    [refresh],
  );

  const handleRunNow = useCallback(() => {
    // Reports itself through the same task slot (see runBudgetAutoBackupIfDue),
    // so this is fire-and-forget too.
    void runBudgetAutoBackupIfDue({ force: true });
  }, []);

  /**
   * Show the device's phrase, creating it if this device has never needed one.
   *
   * It used to refuse with "turn automatic backup on to create one", which was
   * true of a phrase that only existed for scheduled runs and is now simply a
   * dead end: the phrase belongs to every backup, and the member asking to see
   * it is asking a question this screen can always answer. Minting on demand
   * costs nothing — the next backup seals under whatever is stored, so a phrase
   * created by looking at it is the same phrase the backup would have made.
   */
  const handleShowPhrase = useCallback(async () => {
    try {
      const { phrase, created } = await ensureBudgetBackupPhrase();
      setPhraseSheet({
        phrase,
        intro: created
          ? 'These 12 words seal every backup you make from now on, and they do not change — save them once and you are covered. This device remembers them; that copy goes with the phone.'
          : 'This one phrase opens every backup from this device, automatic or not. It remembers it, but that copy is gone if you lose the phone — keep your own, or the backups already in the cloud can never be opened. Anyone who has it can read your budget.',
      });
    } catch (error) {
      console.error('[budget-backup] could not read the phrase', error);
      Alert.alert('Recovery phrase', 'Could not read the recovery phrase just now.');
    }
  }, []);

  /**
   * Replace the phrase — the revoke half of "saved once, reused forever".
   *
   * The confirm is not ceremony. Nothing can re-seal a file that has already
   * left the device, so every existing archive keeps the OLD words: a member who
   * rotates without keeping their old copy has silently locked themselves out of
   * every backup they have. That has to be said before it happens, not after.
   */
  const handleRotatePhrase = useCallback(() => {
    Alert.alert(
      'Create a new phrase',
      'Backups made from now on will be sealed with the new phrase. The ones you already have keep the old one — if you have not saved it, they can never be opened again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create new',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setIsBusy(true);
              try {
                const phrase = await rotateBudgetBackupPhrase();
                setPhraseSheet({
                  phrase,
                  intro:
                    'This is your new recovery phrase, and every backup from now on is sealed with it. Save it — the previous phrase is gone from this device, and only your own copy of it can still open the backups it made.',
                });
              } catch (error) {
                console.error('[budget-backup] rotate failed', error);
                Alert.alert('Recovery phrase', 'Could not create a new phrase just now.');
              } finally {
                setIsBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, []);

  // --- Restore ---------------------------------------------------------------
  const beginRestore = useCallback(
    async (archiveJson: string) => {
      // Opening a second archive while one is being applied cannot be honoured —
      // the slot is single-flight — so say that here rather than letting them
      // type a phrase into a panel whose button is dead.
      if (isRestoring) {
        Alert.alert(
          'Restore in progress',
          'One backup is being restored right now. It keeps going if you leave this screen, and we’ll let you know when it’s done.',
        );
        return;
      }
      setPendingRestoreJson(archiveJson);

      // A phrase that already opened an archive here beats the clipboard: it is
      // known-good, whereas the clipboard is whatever the user copied last.
      const remembered = await getRememberedRestorePhrase();
      if (remembered) {
        setRestorePhraseDraft(remembered);
        setRestorePhraseSource('remembered');
        return;
      }

      let phrase = '';
      try {
        phrase = (await Clipboard.getStringAsync()).trim();
      } catch {
        phrase = '';
      }
      const words = phrase.split(/\s+/).filter(Boolean);
      const fromClipboard = words.length >= 12 && words.length <= 24 ? words.join(' ') : '';
      setRestorePhraseDraft(fromClipboard);
      setRestorePhraseSource(fromClipboard ? 'clipboard' : 'none');
    },
    [isRestoring],
  );

  const handleRestoreLocal = useCallback(
    async (fileName: string) => {
      setIsBusy(true);
      try {
        await beginRestore(await readLocalBudgetBackup(fileName));
      } catch (error) {
        console.error('[budget-restore] read local failed', error);
        Alert.alert('Restore', 'Could not open that backup.');
      } finally {
        setIsBusy(false);
      }
    },
    [beginRestore],
  );

  /**
   * Reveal an on-device archive where it actually lives.
   *
   * Restoring is what a row tap does, but "restore this over everything I have"
   * is not the only reason to reach for a backup — copying one off the phone
   * before wiping it, or checking that the file the app claims to have written
   * is really there, both need the file itself. That used to mean retyping a
   * four-level path into Files by hand.
   */
  const handleOpenLocal = useCallback(async (entry: LocalBudgetBackupEntry) => {
    const result = await openBudgetBackupLocation({
      uri: entry.uri,
      fileName: entry.fileName,
    });
    if (result.status === 'unavailable') Alert.alert('Backup file', result.message);
  }, []);

  const handleDeleteLocal = useCallback(
    (entry: LocalBudgetBackupEntry) => {
      Alert.alert('Delete backup', `Delete the backup from ${formatBackupEntryLabel(entry)}?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deleteLocalBudgetBackup(entry.fileName).catch(() => undefined);
              await refresh();
            })();
          },
        },
      ]);
    },
    [refresh],
  );

  const openCloudPicker = useCallback(async (provider: BudgetBackupCloudProvider) => {
    setCloudPicker({ provider, options: [], loading: true });
    try {
      const entries = await listCloudBudgetBackups(provider);
      setCloudPicker({
        provider,
        loading: false,
        options: entries.map((entry) => ({
          key: entry.id,
          label: formatBackupEntryLabel(entry),
          description: formatBackupSize(entry.size),
          icon: 'cloud-download-outline',
          testID: `budget-backup-cloud-${entry.fileName}`,
        })),
      });
    } catch (error) {
      console.error('[budget-restore] cloud list failed', provider, error);
      // Report the failure INSIDE the sheet instead of closing it and firing an
      // Alert in the same tick: on iOS the native alert presents while the
      // Modal is still dismissing, so BOTH sit on screen (and an alert racing a
      // dismissing modal is what leaves the invisible tap shield documented in
      // BackupOptionSheet). One surface, and the user keeps their place —
      // closing the sheet is their call, and retrying is one tap.
      setCloudPicker({
        provider,
        loading: false,
        options: [],
        error: `Could not read your ${cloudProviderLabel(provider)} backups. Reconnect and try again.`,
      });
    }
  }, []);

  /**
   * Reconnect, then list again. Retrying the read alone re-uses the same dead
   * token and lands on the identical error, which looks like a dead button.
   */
  const reconnectCloud = useCallback(
    async (provider: BudgetBackupCloudProvider) => {
      setCloudPicker({ provider, options: [], loading: true });
      try {
        await reconnectCloudProvider(provider);
      } catch (error) {
        console.error('[budget-restore] reconnect failed', provider, error);
        setCloudPicker({
          provider,
          loading: false,
          options: [],
          error: `Could not connect to ${cloudProviderLabel(provider)}. Check the connection and try again.`,
        });
        return;
      }
      await openCloudPicker(provider);
    },
    [openCloudPicker],
  );

  const handleCloudArchivePicked = useCallback(
    async (fileId: string) => {
      const provider = cloudPicker?.provider;
      setCloudPicker(null);
      if (!provider) return;
      setIsBusy(true);
      try {
        await beginRestore(await readCloudBudgetBackup(provider, fileId));
      } catch (error) {
        console.error('[budget-restore] cloud read failed', error);
        Alert.alert('Restore', 'Could not open that backup.');
      } finally {
        setIsBusy(false);
      }
    },
    [cloudPicker?.provider, beginRestore],
  );

  const handleRestoreFromFiles = useCallback(async () => {
    setIsBusy(true);
    try {
      const picked = await pickBudgetBackupArchive();
      if (picked.status === 'cancelled') return;
      if (picked.status === 'failed') {
        Alert.alert('Restore', picked.message);
        return;
      }
      await beginRestore(picked.archiveJson);
    } finally {
      setIsBusy(false);
    }
  }, [beginRestore]);

  /**
   * Hand the restore to the background runner and return.
   *
   * Nothing is awaited here. The panel closes, the progress card takes over at
   * the top of the screen, and the member is free to go anywhere — the outcome
   * finds them as a toast, and the breakdown waits in the task store until this
   * screen can present it. Both are why the phrase field is emptied now rather
   * than on success: the run owns the archive and the words from this point on.
   */
  const runRestore = useCallback(() => {
    if (!pendingRestoreJson || isRestoring) return;
    const phrase = restorePhraseDraft.trim();
    if (!phrase) {
      Alert.alert('Recovery phrase', 'Paste the 12-word phrase for this backup.');
      return;
    }
    if (!startBudgetRestore(pendingRestoreJson, phrase)) return;
    setPendingRestoreJson(null);
    setRestorePhraseDraft('');
    setRestorePhraseSource('none');
    scrollToTop();
  }, [pendingRestoreJson, restorePhraseDraft, isRestoring, scrollToTop]);

  // --- Drive folder ----------------------------------------------------------
  /**
   * The folder in the words a member would use for it. Before the first upload
   * there is no pointer yet, so this names the folder the app WILL make rather
   * than going blank — the row is a promise about where backups go, and that
   * promise is already true.
   */
  const driveFolderLabel = driveFolder
    ? describeCloudFolder(driveFolder)
    : BUDGET_BACKUP_DRIVE_FOLDER;

  const canPickDriveFolder =
    isCloudProviderConfigured('google-drive') && cloudProviderSupportsFolderPicking('google-drive');

  const handlePickDriveFolder = useCallback(
    async (picked: PickedCloudFolder) => {
      setFolderPickerOpen(false);
      setIsBusy(true);
      try {
        await chooseCloudBackupFolder('google-drive', picked);

        /*
         * Choosing a folder IS the request to back up into it.
         *
         * Picking a folder and then being left to find a toggle, open a second
         * sheet and choose "Google Drive" was three steps to express one
         * intention — and anyone who stopped after the first got a stored
         * pointer and no backups, which reads exactly like the feature is on.
         * So the pick arms the whole thing: schedule on, destination Drive.
         *
         * Nothing here can surprise a connected account into existence — the
         * picker only opens once Drive is authorised (see `cloudFolderAccess`),
         * so the schedule this turns on is one that can actually run
         * unattended.
         */
        const current = await getBudgetAutoBackupSettings();
        const wasArmedForDrive = current.enabled && current.destination === 'google-drive';

        if (current.enabled) {
          await updateBudgetAutoBackupSettings({
            destination: 'google-drive',
            // A new target has never succeeded yet — see handleAutoDestinationPicked.
            lastStatus: null,
            lastError: null,
          });
        } else {
          const { phrase } = await enableBudgetAutoBackup({
            frequency: current.frequency,
            destination: 'google-drive',
          });
          // The one thing that genuinely cannot be done for them: this phrase is
          // the only key to every archive, and it is shown exactly once. Same
          // sheet the toggle raises — see handleToggleAuto for why the copy
          // labours the point about keeping their own copy.
          setPhraseSheet({
            phrase,
            intro: `Backups now go to ${describeCloudFolder({ ...picked, source: 'picked' })} in Google Drive, automatically — ${BUDGET_AUTO_BACKUP_FREQUENCY_LABEL[
              current.frequency
            ].toLowerCase()}. Every one is sealed with this phrase, and this device remembers it, so you can see it again from the “Recovery phrase” row. Keep your own copy too: lose the phone and that copy goes with it.`,
          });
        }

        await refresh();

        // Put a copy in the new folder now rather than at the next due date.
        // It proves the folder is writable while the member is still on this
        // screen to see it fail, and it stops the Backup screen claiming
        // protection while the folder they just chose sits empty. Reports
        // itself through the shared task slot, so it is fire-and-forget.
        void runBudgetAutoBackupIfDue({ force: true });

        if (wasArmedForDrive) {
          // Already on this schedule — no phrase sheet is due, so this is the
          // only acknowledgement that the move took effect.
          Alert.alert(
            'Backup folder changed',
            `New backups will go to ${describeCloudFolder({ ...picked, source: 'picked' })}. The ones already saved stay where they are.`,
          );
        }
      } catch (error) {
        console.error('[budget-backup] could not arm Drive backups', error);
        Alert.alert(
          'Backup folder',
          'Could not set up automatic backups to that folder. Please try again.',
        );
        await refresh();
      } finally {
        setIsBusy(false);
      }
    },
    [refresh],
  );

  /**
   * Back to the app's own folder. Offered only once a pick is in place —
   * "Use the default folder" against a default folder is a no-op dressed as a
   * choice.
   */
  const handleResetDriveFolder = useCallback(() => {
    Alert.alert(
      'Use the default folder?',
      `New backups will go to “${BUDGET_BACKUP_DRIVE_FOLDER}” instead. Backups already in ${driveFolderLabel} stay where they are.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Use default',
          onPress: () => {
            void (async () => {
              await resetCloudBackupFolder('google-drive');
              await refresh();
            })();
          },
        },
      ],
    );
  }, [driveFolderLabel, refresh]);

  // --- The Google account ----------------------------------------------------
  /**
   * Sign out. The schedule has to come off Drive with it: leaving it pointed at
   * a provider this app can no longer reach turns every future run into a
   * "reconnect" failure, and the member would have to work out for themselves
   * that signing out is what broke it. `device` is the destination that always
   * works, so it is where the schedule lands.
   */
  const handleDisconnectDrive = useCallback(async () => {
    setAccountSheetOpen(false);
    setIsBusy(true);
    try {
      await disconnectCloudProvider('google-drive');
      const current = await getBudgetAutoBackupSettings();
      if (current.destination === 'google-drive') {
        await updateBudgetAutoBackupSettings({
          destination: 'device',
          lastStatus: null,
          lastError: null,
        });
      }
      await refresh();
      Alert.alert(
        'Signed out of Google Drive',
        'Backups now go to this device. The archives already in Drive are still there — sign in again to reach them.',
      );
    } catch (error) {
      console.error('[budget-backup] drive disconnect failed', error);
      Alert.alert('Google Drive', 'Could not sign out. Please try again.');
      await refresh();
    } finally {
      setIsBusy(false);
    }
  }, [refresh]);

  /**
   * Swap accounts, then go straight to picking a folder in the new one. The old
   * account's folder pointer is dropped by `switchCloudAccount` — a folder id
   * means nothing outside the Drive that issued it — so there is a choice to
   * make here, and making it now beats a silent fall back to a default folder.
   */
  const handleSwitchDriveAccount = useCallback(async () => {
    setAccountSheetOpen(false);
    setIsBusy(true);
    try {
      await switchCloudAccount('google-drive');
      await refresh();
      setFolderPickerOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      // Backing out of the consent screen is a choice, not a failure — but the
      // sign-out already happened, so the screen must still be told.
      if (!/cancel/i.test(message)) {
        console.error('[budget-backup] drive account switch failed', error);
        Alert.alert('Google Drive', 'Could not switch accounts. Please try again.');
      }
      await refresh();
    } finally {
      setIsBusy(false);
    }
  }, [refresh]);

  const driveAccountOptions = useMemo<BackupOption[]>(
    () => [
      {
        key: 'switch',
        label: 'Use a different Google account',
        description: 'Sign out, then sign in as someone else',
        icon: 'swap-horizontal-outline',
        testID: 'budget-backup-drive-switch-account',
      },
      {
        key: 'disconnect',
        label: 'Sign out of Google Drive',
        description: 'Backups go back to this device',
        icon: 'log-out-outline',
        testID: 'budget-backup-drive-disconnect',
      },
    ],
    [],
  );

  // --- Keep one copy, or one per date ----------------------------------------
  /**
   * Flipping this changes only what the NEXT run is named. Archives already
   * written are never renamed or removed by the switch — turning "keep every
   * copy" off is a decision about the future, and quietly deleting the history
   * somebody had been keeping is not something a checkbox should do.
   */
  const handleToggleRetention = useCallback(
    async (keepEvery: boolean) => {
      const next: BudgetBackupRetention = keepEvery ? 'dated' : 'replace';
      setRetention(next); // Optimistic: a switch that lags reads as broken.
      try {
        await setBudgetBackupRetention(next);
      } catch (error) {
        console.warn('[budget-backup] could not save the retention choice', error);
        setRetention(keepEvery ? 'replace' : 'dated');
        Alert.alert('Backup copies', 'Could not save that choice. Please try again.');
      }
    },
    [],
  );

  // --- A folder on the phone (Android) ---------------------------------------
  /**
   * Android's folder grant persists, so picking one arms the schedule exactly
   * the way picking a Drive folder does — see `handlePickDriveFolder` for why
   * the pick IS the request.
   */
  const handlePickDeviceFolder = useCallback(async () => {
    setIsBusy(true);
    try {
      const picked = await chooseDeviceBackupFolder();
      if (!picked) return; // Backed out of the system picker.

      const current = await getBudgetAutoBackupSettings();
      const wasArmedForFiles = current.enabled && current.destination === 'files';

      if (current.enabled) {
        await updateBudgetAutoBackupSettings({
          destination: 'files',
          lastStatus: null,
          lastError: null,
        });
      } else {
        const { phrase } = await enableBudgetAutoBackup({
          frequency: current.frequency,
          destination: 'files',
        });
        setPhraseSheet({
          phrase,
          intro: `Backups now go to ${picked.label} on this phone, automatically — ${BUDGET_AUTO_BACKUP_FREQUENCY_LABEL[
            current.frequency
          ].toLowerCase()}. Every one is sealed with this phrase, and this device remembers it, so you can see it again from the “Recovery phrase” row. Keep your own copy too: a folder on this phone goes with the phone.`,
        });
      }

      await refresh();
      void runBudgetAutoBackupIfDue({ force: true });

      if (wasArmedForFiles) {
        Alert.alert(
          'Backup folder changed',
          `New backups will go to ${picked.label}. The ones already saved stay where they are.`,
        );
      }
    } catch (error) {
      console.error('[budget-backup] could not arm phone-folder backups', error);
      Alert.alert('Backup folder', 'Could not set up backups to that folder. Please try again.');
      await refresh();
    } finally {
      setIsBusy(false);
    }
  }, [refresh]);

  const handleForgetDeviceFolder = useCallback(() => {
    Alert.alert(
      'Stop using this folder?',
      `New backups will go to this device's own storage instead. Backups already in ${
        deviceFolder?.label ?? 'that folder'
      } stay where they are.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop using it',
          onPress: () => {
            void (async () => {
              await forgetDeviceFolder();
              // The schedule would otherwise point at a folder we have just
              // forgotten, and every run would fail asking for one.
              await updateBudgetAutoBackupSettings({
                destination: 'device',
                lastStatus: null,
                lastError: null,
              });
              await refresh();
            })();
          },
        },
      ],
    );
  }, [deviceFolder?.label, refresh]);

  // --- Option lists ----------------------------------------------------------
  const saveDestinationOptions = useMemo<BackupOption[]>(
    () =>
      (
        [
          {
            key: 'google-drive',
            label: 'Google Drive',
            description: `Folder: ${driveFolderLabel}`,
            icon: 'cloud-upload-outline',
            testID: 'budget-backup-to-drive',
          },
          {
            key: 'dropbox',
            label: 'Dropbox',
            description: 'Off-device copy',
            icon: 'cloud-upload-outline',
            testID: 'budget-backup-to-dropbox',
          },
          {
            key: 'files',
            label: IS_ANDROID ? 'Choose a folder' : 'Files app',
            description: IS_ANDROID
              ? 'Any folder on this phone'
              : 'On My iPhone or iCloud Drive',
            icon: 'folder-open-outline',
            testID: 'budget-backup-to-files',
          },
          {
            key: 'device',
            label: 'This device',
            description: 'Fastest — lost with the phone',
            icon: 'phone-portrait-outline',
            testID: 'budget-backup-to-device',
          },
          {
            key: 'share',
            label: 'Share…',
            description: 'AirDrop, Mail, or another app',
            icon: 'share-outline',
            testID: 'budget-backup-to-share',
          },
        ] as BackupOption[]
      ).filter((option) => option.key !== 'dropbox' || isCloudProviderConfigured('dropbox')),
    [driveFolderLabel],
  );

  const frequencyOptions = useMemo<BackupOption[]>(
    () =>
      (['daily', 'weekly', 'monthly'] as BudgetAutoBackupFrequency[]).map((frequency) => ({
        key: frequency,
        label: BUDGET_AUTO_BACKUP_FREQUENCY_LABEL[frequency],
        description: autoSettings?.frequency === frequency ? 'Current' : undefined,
        icon: 'time-outline',
        testID: `budget-backup-frequency-${frequency}`,
      })),
    [autoSettings?.frequency],
  );

  const autoDestinationOptions = useMemo<BackupOption[]>(
    () =>
      (
        [
          {
            key: 'google-drive',
            label: 'Google Drive',
            description: `Folder: ${driveFolderLabel}`,
            icon: 'cloud-upload-outline',
            testID: 'budget-backup-auto-dest-drive',
          },
          {
            key: 'dropbox',
            label: 'Dropbox',
            description: 'Off-device copy',
            icon: 'cloud-upload-outline',
            testID: 'budget-backup-auto-dest-dropbox',
          },
          {
            key: 'device',
            label: 'This device',
            description: 'No account needed',
            icon: 'phone-portrait-outline',
            testID: 'budget-backup-auto-dest-device',
          },
        ] as BackupOption[]
      ).filter(
        (option) =>
          option.key === 'device' ||
          isCloudProviderConfigured(option.key as BudgetBackupCloudProvider),
      ),
    [driveFolderLabel],
  );

  const autoDestinationLabel = autoSettings
    ? autoBackupDestinationLabel(autoSettings.destination)
    : '';

  /**
   * Why the list is empty — three different situations that all used to say
   * "No backups on this device yet".
   *
   * The middle one is the one that made the screen contradict itself: with a
   * cloud schedule there is nothing here BY DESIGN, and saying "no backups"
   * next to a "Protected" card reads as one of the two being a lie.
   */
  const emptyBackupsMessage = !localListKnown
    ? 'Could not read the backups saved on this device.'
    : lastSuccess && !backupEvidenceIsLocal(lastSuccess.destination)
      ? `Nothing is kept here — your last backup went to ${backupDestinationLabel(
          lastSuccess.destination,
        )}.`
      : lastSuccess
        ? 'The backup saved here has since been deleted.'
        : 'No backups on this device yet.';

  /** Shared row chrome for the disclosure rows inside a settings group. */
  const renderRow = (
    key: string,
    label: string,
    value: string,
    onPress: () => void,
    testID: string,
    last = false,
    icon?: string,
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      style={[styles.row, !last && { borderBottomColor: colors.borderColor, borderBottomWidth: StyleSheet.hairlineWidth }]}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      testID={testID}
    >
      {icon ? (
        <Icon name={icon} forceIonicons size={IconSize.md} color={colors.textSecondary} />
      ) : null}
      <Typography variant="body" style={styles.rowLabel} accessible={false}>
        {label}
      </Typography>
      <Typography variant="body" color={colors.textSecondary} accessible={false}>
        {value}
      </Typography>
      <Icon name="chevron-forward" size={IconSize.sm} color={colors.textTertiary} />
    </Pressable>
  );

  /**
   * A restore SOURCE — an outline CTA, not a settings row. Plain `Pressable`
   * rather than RNGH's `TouchableOpacity` so the `flex: 1` that makes the
   * buttons share the row can sit on `style` directly (RNGH puts `style` on its
   * inner view, where flex would do nothing — see BUDGET_CTA_ROW_STYLES).
   */
  const renderRestoreSource = (
    key: string,
    label: string,
    icon: string,
    onPress: () => void,
    testID: string,
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      style={[BUDGET_CTA_ROW_STYLES.addCta, budgetCtaOutline(colors.primary)]}
      accessibilityRole="button"
      accessibilityLabel={`Restore from ${label}`}
      testID={testID}
    >
      <Icon
        name={icon}
        forceIonicons
        size={BUDGET_CTA_ICON_WIDTH}
        color={budgetCtaTint('outline', colors)}
      />
      <Typography
        variant="caption1"
        weight="semibold"
        color={budgetCtaTint('outline', colors)}
        // Three sources ("Google Drive" / "Dropbox" / "Files app") share one
        // row on a phone, so a long label shrinks rather than wraps mid-word.
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        accessible={false}
      >
        {label}
      </Typography>
    </Pressable>
  );

  return (
    <AppBackground>
      <SafeAreaView edges={[]} testID="budget-backup-screen">
        <ScreenHeader
          title="Backup & Restore"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        {/*
          The phrase field sits at the very bottom of this list, so a raw
          ScrollView leaves it under the keyboard. `automaticallyAdjustKeyboardInsets`
          insets the scroll content by the keyboard on iOS and scrolls the
          focused input into view; Android does the same via adjustResize.
        */}
        <ScrollView
          {...keyboardDismissScrollProps}
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.content}
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
        >
          {/* 0 — A restore in flight outranks everything below it, and it is the
              one thing on this screen that survives leaving the screen. So it
              sits above the status card (which is about the LAST backup, not
              about what is happening right now) and the screen scrolls here on
              entry while it runs. */}
          {isRestoring ? (
            <BudgetRestoreProgressCard
              progress={restoreProgress}
              label={restoreLabel}
              startedAt={restoreStartedAt}
              testID="budget-backup-restore-progress"
            />
          ) : null}

          {/* 1 — Am I safe? One glance, colour-coded, before any control. */}
          <Card
            style={[styles.statusCard, { borderColor: hexToRgba(healthColor, 0.35) }]}
            testID="budget-backup-status-card"
          >
            <View style={[styles.statusIcon, { backgroundColor: hexToRgba(healthColor, 0.14) }]}>
              <Icon name={health.icon} forceIonicons size={26} color={healthColor} />
            </View>
            <View style={styles.statusText}>
              <Typography
                variant="title3"
                weight="semibold"
                color={healthColor}
                testID="budget-backup-status-title"
              >
                {health.title}
              </Typography>
              <Typography variant="footnote" color={colors.textSecondary}>
                {health.detail}
              </Typography>
            </View>
          </Card>

          {/* 2 — The 90% action, and the only primary button on the screen. */}
          <GradientButton
            title={isBackingUp ? 'Backing up…' : 'Back up now'}
            disabled={isBusy || isBackingUp || isRestoring}
            fullWidth
            onPress={() => setDestinationSheetOpen(true)}
            testID="budget-backup-now"
          />
          {isBackingUp ? (
            // Says the two things a spinner cannot: you are not stuck here, and
            // you will be told. Without it, "Backing up…" on a disabled button
            // reads as "wait on this screen".
            <Card style={styles.progressCard} testID="budget-backup-progress">
              <ActivityIndicator size="small" color={colors.primary} />
              <View style={styles.progressText}>
                <Typography variant="footnote" weight="medium">
                  {backupKind === 'scheduled' ? 'Automatic backup in progress' : 'Backup in progress'}
                </Typography>
                <Typography variant="caption2" color={colors.textSecondary}>
                  Keep using the app — we&apos;ll let you know when it&apos;s done.
                </Typography>
              </View>
            </Card>
          ) : null}
          <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
            {/*
              * Naming the count is the point of the bundle, not decoration. A
              * member holding three budgets used to get three files under three
              * phrases and had no way to tell, from this screen, whether all
              * three were covered. One sentence now answers it.
              */}
            {householdCount > 1
              ? `Every one of your ${householdCount} budgets goes into a single file, sealed with one 12-word phrase — the same one every time. `
              : 'Sealed with your 12-word phrase — the same one every time. '}
            Choose where it goes — only Drive, Dropbox and iCloud survive losing this phone.
          </Typography>

          {/* 2b — The phrase, always reachable.
              It used to live inside AUTOMATIC and appear only while the schedule
              was on, which was wrong the moment manual backups started reusing
              it too: a member who never turned automation on had been shown
              twelve words once and had nowhere to look them up. One secret opens
              every archive this device writes, so it gets its own group at the
              level of the thing it protects. */}
          <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
            RECOVERY PHRASE
          </Typography>
          <Card style={styles.group}>
            {renderRow(
              'phrase',
              'Recovery phrase',
              'Show',
              () => void handleShowPhrase(),
              'budget-backup-show-phrase',
            )}
            {renderRow(
              'phrase-new',
              'Create a new phrase',
              '',
              handleRotatePhrase,
              'budget-backup-rotate-phrase',
              true,
            )}
          </Card>
          <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
            One phrase opens every backup from this phone, so you only save it
            once. Create a new one if you think someone else has seen it — older
            backups keep the old phrase.
          </Typography>

          {/* 3 — Automation as direct manipulation: a switch, not a modal chain. */}
          <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
            AUTOMATIC
          </Typography>
          <Card style={styles.group}>
            <View style={[styles.row, styles.rowDivider, { borderBottomColor: colors.borderColor }]}>
              <View style={styles.rowLabel}>
                <Typography variant="body">Back up automatically</Typography>
                <Typography variant="caption2" color={colors.textSecondary}>
                  Runs when you open the app and one is due
                </Typography>
              </View>
              <Toggle
                value={autoSettings?.enabled ?? false}
                onValueChange={(next) => void handleToggleAuto(next)}
                disabled={isBusy || isRestoring}
                testID="budget-backup-auto-toggle"
              />
            </View>

            {autoSettings?.enabled ? (
              <>
                {renderRow(
                  'freq',
                  'How often',
                  BUDGET_AUTO_BACKUP_FREQUENCY_LABEL[autoSettings.frequency],
                  () => setFrequencySheetOpen(true),
                  'budget-backup-frequency-row',
                )}
                {renderRow(
                  'dest',
                  'Where',
                  autoDestinationLabel,
                  () => setAutoDestinationSheetOpen(true),
                  'budget-backup-auto-destination-row',
                )}
                {/* The phrase row is deliberately NOT here any more — it moved
                    to its own group above, because the words it shows seal
                    manual backups too and were unreachable with the schedule
                    off. */}
                {renderRow(
                  'run',
                  'Back up now',
                  '',
                  () => void handleRunNow(),
                  'budget-backup-run-now',
                  true,
                )}
              </>
            ) : null}
          </Card>

          {/* 3b — Where Drive puts them. Its own group rather than a row inside
              AUTOMATIC, because the folder applies to manual backups too and
              would otherwise be invisible to anyone who never turns automatic
              on. Hidden entirely when the brand ships no Drive credentials —
              there is no folder to choose in a build that cannot upload. */}
          {canPickDriveFolder ? (
            <>
              <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
                GOOGLE DRIVE
              </Typography>
              <Card style={styles.group}>
                <Pressable
                  onPress={() => setFolderPickerOpen(true)}
                  style={[
                    styles.row,
                    driveFolder?.source === 'picked' && styles.rowDivider,
                    driveFolder?.source === 'picked' && { borderBottomColor: colors.borderColor },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Backup folder: ${driveFolderLabel}. Choose a different folder`}
                  testID="budget-backup-drive-folder-row"
                >
                  <Icon
                    name="folder-outline"
                    forceIonicons
                    size={IconSize.md}
                    color={colors.textSecondary}
                  />
                  <View style={styles.rowLabel}>
                    <Typography variant="body" accessible={false}>
                      Backup folder
                    </Typography>
                    <Typography
                      variant="caption2"
                      color={colors.textSecondary}
                      // A deep trail is the useful half of this label, so let it
                      // wrap to two lines rather than truncating the folder name
                      // people are actually looking for off the end.
                      numberOfLines={2}
                      accessible={false}
                      testID="budget-backup-drive-folder-value"
                    >
                      {driveFolderLabel}
                    </Typography>
                  </View>
                  <Icon name="chevron-forward" size={IconSize.sm} color={colors.textTertiary} />
                </Pressable>

                {driveFolder?.source === 'picked'
                  ? renderRow(
                      'drive-folder-default',
                      'Use the default folder',
                      BUDGET_BACKUP_DRIVE_FOLDER,
                      handleResetDriveFolder,
                      'budget-backup-drive-folder-default',
                      false,
                      'refresh-outline',
                    )
                  : null}

                {/* Which account this is all going to, and the way out of it.
                    Shown even when nobody is signed in, because "Not connected"
                    is the answer to the question the row asks — and tapping it
                    is how you sign in without first having to pick a folder. */}
                {renderRow(
                  'drive-account',
                  'Google account',
                  driveAccount?.email ?? driveAccount?.name ?? 'Not connected',
                  () => {
                    if (driveAccount) {
                      setAccountSheetOpen(true);
                    } else {
                      // Nothing to sign out of — the folder picker owns the
                      // sign-in, and lands them where they were headed anyway.
                      setFolderPickerOpen(true);
                    }
                  },
                  'budget-backup-drive-account-row',
                  true,
                  'person-circle-outline',
                )}
              </Card>
              {/* Says what the tap will DO before it does it. Choosing a folder
                  turns the schedule on, and a state change that large must not
                  arrive as a surprise after the fact. */}
              <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
                {autoSettings?.enabled && autoSettings.destination === 'google-drive'
                  ? `Backups go here on their own, ${BUDGET_AUTO_BACKUP_FREQUENCY_LABEL[
                      autoSettings.frequency
                    ].toLowerCase()}. Nothing else to do.`
                  : 'Pick a folder and backups start going there on their own — no switch to flip.'}
              </Typography>
            </>
          ) : null}

          {/* 3c — A folder on the phone itself. Android only: its folder grant
              survives a restart, so a picked folder is somewhere scheduled runs
              can keep writing. iOS can only reach an arbitrary folder through
              the share sheet, which needs a person to answer it — there, "This
              device" already IS the automatic on-phone destination, and the
              app's own folder shows up in Files under On My iPhone. */}
          {IS_ANDROID ? (
            <>
              <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
                THIS PHONE
              </Typography>
              <Card style={styles.group}>
                <Pressable
                  onPress={() => void handlePickDeviceFolder()}
                  disabled={isBusy}
                  style={[
                    styles.row,
                    deviceFolder && styles.rowDivider,
                    deviceFolder && { borderBottomColor: colors.borderColor },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={
                    deviceFolder
                      ? `Backup folder on this phone: ${deviceFolder.label}. Choose a different folder`
                      : 'Choose a folder on this phone'
                  }
                  testID="budget-backup-device-folder-row"
                >
                  <Icon
                    name="phone-portrait-outline"
                    forceIonicons
                    size={IconSize.md}
                    color={colors.textSecondary}
                  />
                  <View style={styles.rowLabel}>
                    <Typography variant="body" accessible={false}>
                      Folder on this phone
                    </Typography>
                    <Typography
                      variant="caption2"
                      color={colors.textSecondary}
                      numberOfLines={2}
                      accessible={false}
                      testID="budget-backup-device-folder-value"
                    >
                      {deviceFolder?.label ?? 'Not set — tap to choose'}
                    </Typography>
                  </View>
                  <Icon name="chevron-forward" size={IconSize.sm} color={colors.textTertiary} />
                </Pressable>

                {deviceFolder
                  ? renderRow(
                      'device-folder-forget',
                      'Stop using this folder',
                      '',
                      handleForgetDeviceFolder,
                      'budget-backup-device-folder-forget',
                      true,
                      'close-circle-outline',
                    )
                  : null}
              </Card>
              <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
                {deviceFolder
                  ? `Archives go in a “${BUDGET_BACKUP_DEVICE_FOLDER}” folder inside it, on their own. Anything on the phone itself is lost with the phone.`
                  : `Pick any folder — we make a “${BUDGET_BACKUP_DEVICE_FOLDER}” folder inside it and back up there automatically.`}
              </Typography>
            </>
          ) : null}

          {/* 3d — One file, or one per date. A checkbox rather than a sheet:
              it is a two-way choice with a strong default, and burying it
              behind a picker would make the default look deliberate. */}
          <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
            BACKUP COPIES
          </Typography>
          <Card style={styles.group}>
            <View style={styles.row}>
              <View style={styles.rowLabel}>
                <Typography variant="body">Keep every copy</Typography>
                <Typography variant="caption2" color={colors.textSecondary}>
                  {retention === 'dated'
                    ? `A new dated file each time, newest ${autoSettings?.keepLast ?? 5} kept.`
                    : 'Off — each backup replaces the last one. One file, always current.'}
                </Typography>
              </View>
              <Toggle
                value={retention === 'dated'}
                onValueChange={(next) => void handleToggleRetention(next)}
                disabled={isBusy || isRestoring}
                testID="budget-backup-keep-every-copy"
              />
            </View>
          </Card>
          <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
            Turning this on from now on leaves the backups you already have exactly where they are.
          </Typography>

          {/* 4 — Restore is a list, not a scavenger hunt through two sheets. */}
          <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
            YOUR BACKUPS
          </Typography>
          {localBackups.length === 0 ? (
            <Card style={styles.emptyCard} testID="budget-backup-empty">
              <Typography variant="footnote" color={colors.textSecondary} style={styles.emptyText}>
                {emptyBackupsMessage}
              </Typography>
            </Card>
          ) : (
            <Card style={styles.group}>
              {localBackups.slice(0, 5).map((entry, index, shown) => (
                <View
                  key={entry.fileName}
                  style={[
                    styles.row,
                    index < shown.length - 1 && styles.rowDivider,
                    index < shown.length - 1 && { borderBottomColor: colors.borderColor },
                  ]}
                >
                  <Pressable
                    style={styles.rowLabel}
                    onPress={() => void handleRestoreLocal(entry.fileName)}
                    accessibilityRole="button"
                    accessibilityLabel={`Restore backup from ${formatBackupEntryLabel(entry)}`}
                    testID={`budget-backup-entry-${entry.fileName}`}
                  >
                    <Typography variant="body" accessible={false}>
                      {formatBackupEntryLabel(entry)}
                    </Typography>
                    <Typography variant="caption2" color={colors.textSecondary} accessible={false}>
                      On this device · {formatBackupSize(entry.size)}
                    </Typography>
                  </Pressable>
                  {/* Reach the file itself, not just its contents — the row
                      tap restores, which is the one thing you cannot undo. */}
                  <Pressable
                    onPress={() => void handleOpenLocal(entry)}
                    hitSlop={Spacing.sm}
                    accessibilityRole="button"
                    accessibilityLabel={
                      opensInFilesApp(entry.uri)
                        ? `Open ${formatBackupEntryLabel(entry)} in Files`
                        : `Open or share the backup from ${formatBackupEntryLabel(entry)}`
                    }
                    testID={`budget-backup-open-${entry.fileName}`}
                  >
                    <Icon
                      name={opensInFilesApp(entry.uri) ? 'folder-open-outline' : 'open-outline'}
                      forceIonicons
                      size={IconSize.md}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => handleDeleteLocal(entry)}
                    hitSlop={Spacing.sm}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete backup from ${formatBackupEntryLabel(entry)}`}
                    testID={`budget-backup-delete-${entry.fileName}`}
                  >
                    <Icon
                      name="trash-outline"
                      forceIonicons
                      size={IconSize.md}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                </View>
              ))}
            </Card>
          )}

          {/* 5 — Other locations. Buttons rather than settings rows: each one
              opens a picker, which is an ACTION, and a chevron row promises a
              sub-screen that holds a value. Same CTA language as every other
              Budget action row (Add Manually / Scan Receipt / Add with AI). */}
          <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
            RESTORE FROM ELSEWHERE
          </Typography>
          <View style={styles.restoreSourceRow}>
            {renderRestoreSource(
              'drive',
              'Google Drive',
              'cloud-download-outline',
              () => void openCloudPicker('google-drive'),
              'budget-backup-restore-drive',
            )}
            {isCloudProviderConfigured('dropbox')
              ? renderRestoreSource(
                  'dropbox',
                  'Dropbox',
                  'cloud-download-outline',
                  () => void openCloudPicker('dropbox'),
                  'budget-backup-restore-dropbox',
                )
              : null}
            {renderRestoreSource(
              'files',
              IS_ANDROID ? 'Browse files' : 'Files app',
              'folder-open-outline',
              () => void handleRestoreFromFiles(),
              'budget-backup-restore-files',
            )}
          </View>

          {/* Phrase entry appears in place once an archive is chosen. */}
          {pendingRestoreJson ? (
            <Card style={styles.restorePanel} testID="budget-backup-restore-phrase-panel">
              <Typography variant="body" weight="semibold">
                Enter the recovery phrase
              </Typography>
              <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
                {restorePhraseSource === 'retry'
                  ? // The failure itself was toasted; this says what to do about
                    // it, next to the field where it gets done.
                    'That phrase did not open this backup. Check the words — the archive is still here.'
                  : restorePhraseSource === 'remembered' && restorePhraseDraft.trim()
                    ? 'Saved on this device from your last restore — edit it if this backup used a different phrase.'
                    : restorePhraseSource === 'clipboard' && restorePhraseDraft.trim()
                      ? 'Filled from your clipboard — check it, then restore.'
                      : 'The 12 words from when this backup was made.'}{' '}
                Decrypting runs on this device and can take a few minutes — you can leave this
                screen while it does.
              </Typography>
              <TextInput
                label="Recovery phrase (12 words)"
                value={restorePhraseDraft}
                onChangeText={setRestorePhraseDraft}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isRestoring}
                testID="budget-backup-restore-phrase"
              />
              <View style={styles.restoreActions}>
                <GradientButton
                  title="Verify & restore"
                  disabled={isRestoring}
                  fullWidth
                  onPress={runRestore}
                  testID="budget-backup-restore-confirm"
                />
                {!isRestoring ? (
                  <Pressable
                    onPress={() => {
                      setPendingRestoreJson(null);
                      setRestorePhraseDraft('');
                      setRestorePhraseSource('none');
                    }}
                    style={styles.restoreCancel}
                    accessibilityRole="button"
                    testID="budget-backup-restore-cancel"
                  >
                    <Typography variant="body" color={colors.textSecondary} accessible={false}>
                      Cancel
                    </Typography>
                  </Pressable>
                ) : null}
              </View>
            </Card>
          ) : null}
        </ScrollView>

        <BackupOptionSheet
          visible={destinationSheetOpen}
          title="Save backup to"
          subtitle="Same sealed file everywhere — a backup saved to one place restores from any other."
          options={saveDestinationOptions}
          notes={SAVE_NOTES}
          onSelect={(key) => void handleSaveTo(key as BudgetBackupDestination)}
          onClose={() => setDestinationSheetOpen(false)}
          testID="budget-backup-destination-sheet"
        />

        <BudgetRecoveryPhraseSheet
          visible={phraseSheet != null}
          phrase={phraseSheet?.phrase ?? ''}
          intro={phraseSheet?.intro}
          savedTo={phraseSheet?.savedTo ?? null}
          onClose={() => setPhraseSheet(null)}
        />

        <BackupOptionSheet
          visible={frequencySheetOpen}
          title="How often"
          options={frequencyOptions}
          onSelect={(key) => void handleFrequencyPicked(key)}
          onClose={() => setFrequencySheetOpen(false)}
          testID="budget-backup-frequency-sheet"
        />

        <BackupOptionSheet
          visible={autoDestinationSheetOpen}
          title="Back up automatically to"
          subtitle="Only places that need no tapping can run on a schedule."
          options={autoDestinationOptions}
          onSelect={(key) => void handleAutoDestinationPicked(key)}
          onClose={() => setAutoDestinationSheetOpen(false)}
          testID="budget-backup-auto-destination-sheet"
        />

        <BackupOptionSheet
          visible={cloudPicker != null}
          title={cloudPicker ? `${cloudProviderLabel(cloudPicker.provider)} backups` : ''}
          subtitle="Newest first."
          options={cloudPicker?.options ?? []}
          loading={cloudPicker?.loading ?? false}
          emptyMessage="No backups uploaded from this app yet."
          error={cloudPicker?.error}
          // Re-runs OAuth and then the listing, in place — the member never has
          // to close the sheet and find the button again.
          onRetry={cloudPicker ? () => void reconnectCloud(cloudPicker.provider) : undefined}
          retryLabel="Reconnect"
          onSelect={(key) => void handleCloudArchivePicked(key)}
          onClose={() => setCloudPicker(null)}
          testID="budget-backup-cloud-sheet"
        />

        <BackupOptionSheet
          visible={accountSheetOpen}
          title="Google account"
          subtitle={driveAccount?.email ?? driveAccount?.name ?? undefined}
          options={driveAccountOptions}
          onSelect={(key) =>
            void (key === 'switch' ? handleSwitchDriveAccount() : handleDisconnectDrive())
          }
          onClose={() => setAccountSheetOpen(false)}
          testID="budget-backup-drive-account-sheet"
        />

        <CloudFolderPickerSheet
          visible={folderPickerOpen}
          provider="google-drive"
          currentFolderId={driveFolder?.id ?? null}
          onPick={(picked) => void handlePickDriveFolder(picked)}
          onClose={() => setFolderPickerOpen(false)}
        />

        <Modal
          visible={restoreSuccessOutcomes != null}
          transparent
          animationType="fade"
          onRequestClose={() => setRestoreSuccessOutcomes(null)}
        >
          <Pressable
            style={[styles.modalBackdrop, { backgroundColor: hexToRgba(colors.black, 0.45) }]}
            onPress={() => setRestoreSuccessOutcomes(null)}
          >
            <Pressable
              style={[styles.modalCard, { backgroundColor: colors.cardBackground }]}
              onPress={(e) => e.stopPropagation()}
              accessible={false}
              testID="budget-backup-restore-success-modal"
            >
              <Typography variant="title2" weight="semibold" style={styles.modalTitle}>
                Restored
              </Typography>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={styles.modalList}
                showsVerticalScrollIndicator={false}
              >
                {(restoreSuccessOutcomes ?? []).map((household) => (
                  <View key={household.householdId}>
                    {/*
                      * The household header appears only when there are several.
                      * With one budget it would be a heading over the whole list
                      * restating the screen you are already on; with three it is
                      * the only thing that says which counts belong to which.
                      */}
                    {(restoreSuccessOutcomes ?? []).length > 1 ? (
                      <Typography
                        variant="callout"
                        weight="semibold"
                        style={styles.modalHouseholdHeading}
                      >
                        {household.householdName}
                      </Typography>
                    ) : null}
                    {household.summary ? (
                      getBudgetRestoreBreakdownLines(household.summary).map((row) => (
                        <View key={`${household.householdId}-${row.label}`} style={styles.modalRow}>
                          <Icon
                            name="checkmark-circle"
                            forceIonicons
                            size={20}
                            color={colors.primary}
                          />
                          <Typography variant="body" accessible={false}>
                            {row.count} {row.label}
                          </Typography>
                        </View>
                      ))
                    ) : (
                      /*
                       * A household with no summary did not come back. Saying so
                       * here is the whole reason the modal renders a list: a
                       * "Restored" panel that silently omitted it would be the
                       * data-loss-wearing-a-reassuring-label failure again.
                       */
                      <View style={styles.modalRow}>
                        <Icon
                          name="alert-circle"
                          forceIonicons
                          size={20}
                          color={colors.error}
                        />
                        <Typography variant="body" accessible={false}>
                          {household.message}
                        </Typography>
                      </View>
                    )}
                    {household.attachments && household.attachments.restored > 0 ? (
                      <View style={styles.modalRow}>
                        <Icon
                          name="checkmark-circle"
                          forceIonicons
                          size={20}
                          color={colors.primary}
                        />
                        <Typography variant="body" accessible={false}>
                          {household.attachments.restored}{' '}
                          {household.attachments.restored === 1 ? 'photo' : 'photos'}
                        </Typography>
                      </View>
                    ) : null}
                  </View>
                ))}
              </ScrollView>
              <GradientButton
                title="OK"
                fullWidth
                onPress={() => setRestoreSuccessOutcomes(null)}
                testID="budget-backup-restore-success-ok"
              />
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    </AppBackground>
  );
}

const SAVE_NOTES = [
  {
    label: 'Google Drive / Dropbox',
    text: 'Kept off this phone, so it survives a lost, broken, or replaced device.',
  },
  {
    label: IS_ANDROID ? 'Choose a folder' : 'Files app',
    text: IS_ANDROID
      ? 'You pick the folder. Anything on the phone itself is lost with the phone.'
      : '"iCloud Drive" survives losing this phone; "On My iPhone" survives only deleting the app.',
  },
  {
    label: 'This device',
    text: 'Fastest, and enough to undo a bad import — but lost with the phone.',
  },
  {
    label: 'Every copy is encrypted',
    text: 'Sealed with a 12-word phrase. Nobody can open it without that phrase — not even us.',
  },
];

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.base, paddingBottom: Layout.bottomTabBarClearance + 48 },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.base,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  statusIcon: {
    width: 52,
    height: 52,
    borderRadius: CornerRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: { flex: 1, gap: 2 },
  hint: { marginTop: Spacing.sm },
  progressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.base,
    marginTop: Spacing.md,
  },
  progressText: { flex: 1, gap: 2 },
  groupLabel: { marginTop: Spacing.xl, marginBottom: Spacing.sm, letterSpacing: 0.6 },
  // Same row metrics as the Planning/Spending CTA rows so the buttons line up
  // with the rest of Budget rather than inventing a second button shape.
  restoreSourceRow: BUDGET_CTA_ROW_STYLES.addRow,
  group: { padding: 0, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    minHeight: 56,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { flex: 1, gap: 2 },
  emptyCard: { padding: Spacing.lg },
  emptyText: { textAlign: 'center' },
  restorePanel: { marginTop: Spacing.lg, padding: Spacing.base, gap: Spacing.sm },
  restoreActions: { marginTop: Spacing.sm, gap: Spacing.xs },
  restoreCancel: { alignItems: 'center', paddingVertical: Spacing.sm },
  modalBackdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.xl },
  modalCard: { borderRadius: CornerRadius.xl, padding: Spacing.lg, maxHeight: '80%' },
  modalTitle: { textAlign: 'center', marginBottom: Spacing.md },
  modalList: { maxHeight: 360, marginBottom: Spacing.md },
  modalRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 4 },
  modalHouseholdHeading: { paddingTop: Spacing.md, paddingBottom: 2 },
});
