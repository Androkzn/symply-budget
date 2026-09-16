import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BackupOptionSheet, type BackupOption } from '@components/backup/BackupOptionSheet';
import {
  CloudFolderPickerSheet,
  type PickedCloudFolder,
} from '@components/backup/CloudFolderPickerSheet';
import { RecoveryPhraseSheet } from '@components/backup/RecoveryPhraseSheet';
import { RestoreProgressCard } from '@components/backup/RestoreProgressCard';
import { AppBackground, SafeAreaView, ScreenHeader } from '@components/common';
import { Card, GradientButton, TextInput, Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import {
  HOUSE_ALL_HOMES_ID,
  HOUSE_ALL_HOMES_LABEL,
  isAllHomesTarget,
} from '@features/house/local/backup/allHomes';
import {
  HOUSE_AUTO_BACKUP_FREQUENCY_LABEL,
  disableHouseAutoBackup,
  enableHouseAutoBackup,
  getHouseAutoBackupPhrase,
  getHouseAutoBackupSettings,
  nextHouseAutoBackupDueAt,
  runHouseAutoBackupIfDue,
  updateHouseAutoBackupSettings,
  type HouseAutoBackupFrequency,
  type HouseAutoBackupSettings,
} from '@features/house/local/backup/autoBackup';
import {
  HOUSE_BACKUP_DEVICE_FOLDER,
  HOUSE_BACKUP_DRIVE_FOLDER,
  autoBackupDestinationLabel,
  chooseCloudBackupFolder,
  chooseDeviceBackupFolder,
  cloudProviderLabel,
  cloudProviderSupportsFolderPicking,
  deleteLocalHouseBackup,
  describeCloudFolder,
  disconnectCloudProvider,
  forgetDeviceFolder,
  getCloudAccount,
  getHouseBackupRetention,
  getRememberedDeviceFolder,
  getRememberedDriveFolder,
  isCloudProviderConfigured,
  listCloudHouseBackups,
  listLocalHouseBackups,
  readCloudHouseBackup,
  readLocalHouseBackup,
  reconnectCloudProvider,
  resetCloudBackupFolder,
  setHouseBackupRetention,
  switchCloudAccount,
  type CloudAccount,
  type HouseBackupCloudProvider,
  type HouseBackupDestination,
  type HouseBackupRetention,
  type LocalHouseBackupEntry,
  type RememberedDeviceFolder,
  type RememberedDriveFolder,
  type HouseAutoBackupDestination,
} from '@features/house/local/backup/backupDestinations';
import {
  backupEvidenceIsLocal,
  getLastHouseBackupEvent,
  type HouseBackupEvent,
} from '@features/house/local/backup/backupHistory';
import {
  consumeHouseBackupPhrase,
  startManualHouseBackup,
  useHouseBackupTaskStore,
} from '@features/house/local/backup/backupTaskStore';
import {
  pickHouseBackupArchive,
  summarizeHouseProperty,
  type HouseBackupSummary,
} from '@features/house/local/backup/houseBackup';
import { HOUSE_RECOVERY_PHRASE_APP } from '@features/house/local/backup/recoveryPhraseFile';
import { getRememberedRestorePhrase } from '@features/house/local/backup/restorePhraseMemory';
import {
  HOUSE_RESTORE_ESTIMATE_MS,
  consumeHouseRestoreSummary,
  startHouseRestore,
  takeHouseRestoreAttempt,
  useHouseRestoreTaskStore,
  type HouseRestoreOutcome,
} from '@features/house/local/backup/restoreTaskStore';
import { getActiveHouseholdId, listLocalHouseProperties } from '@features/house/local/engine';
import {
  exportHouseLedgerCsv,
  type HouseExportResult,
} from '@features/house/local/export/houseLedgerExport';
import {
  toMemberFacingError,
  type MemberFacingError,
} from '@features/house/local/memberFacingError';
// The CTA row metrics are Budget's, deliberately: these three "restore from"
// buttons are the same shape as every other Symply action row, and a second set
// of numbers would be a second thing to keep in step. The module is a leaf —
// it imports nothing but @theme.
import {
  BUDGET_CTA_ICON_WIDTH,
  BUDGET_CTA_ROW_STYLES,
  budgetCtaOutline,
  budgetCtaTint,
} from '@screens/budget/budgetCtaLayout';
import {
  openBackupLocation,
  opensInFilesApp,
  type BackupLocation,
} from '@services/backup/backupFileAccess';
import { CornerRadius, IconSize, Layout, Spacing, hexToRgba, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import {
  blobManifestSentence,
  formatBytes,
  formatCount,
  pluralRows,
  summaryRows,
  totalBlobBytes,
  yieldToPaint,
} from './houseBackupFormat';
import { HousePropertyPicker, type HousePropertyOption } from './HousePropertyPicker';

/**
 * House V2 → Backup & Restore.
 *
 * A port of `BudgetBackupScreen`, and deliberately the same screen: the two
 * apps share one archive format, one scheduler design and one set of
 * destinations, so a member who has used either already knows this one. The
 * shape follows the questions people actually arrive with:
 *
 *  1. "Which home?"           → the property picker, first, because Q15 makes an
 *                               archive cover exactly one home and H5 lets a
 *                               member hold three. Budget has one ledger per
 *                               household and can imply it; House cannot.
 *  2. "Am I safe right now?"  → one status card, colour-coded, for that home.
 *  3. "Back it up."           → a single primary button; nothing competes.
 *  4. "Do it for me."         → automatic backup as a switch plus disclosure
 *                               rows, not a chain of modals.
 *  5. "What is in it?"        → the per-table counts AND the attachment
 *                               manifest. Attachment BYTES are not in the
 *                               archive (Q15); only their descriptors travel. A
 *                               member who believes the file contains their
 *                               photos and later finds it does not has been
 *                               misled, so the screen says it plainly.
 *  6. "Get my data back."     → recent archives listed inline, one tap to
 *                               restore, then the phrase panel.
 *  7. Rare + risky            → restoring a file from elsewhere sits last and
 *                               quiet, since it merges into what is on the phone.
 *
 * The CSV export sits at the very bottom: same rows, no encryption, for people
 * who want a spreadsheet rather than a restorable archive.
 */

const IS_ANDROID = Platform.OS === 'android';

/**
 * The timestamp half of a dated archive name. Absent from `replace`-mode names,
 * which deliberately carry no date so every run lands on the same file.
 */
const ARCHIVE_TIMESTAMP = /(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/;
/** The older `symply-house-<slug>-2026-08-13.backup.json` shape — date only. */
const ARCHIVE_DAY = /(\d{4})-(\d{2})-(\d{2})(?!-\d)/;

/** `symply-house-backup-2026-08-11-0915-….json` → `11 Aug 2026, 09:15`. */
export function formatBackupFileName(fileName: string): string {
  const stripped = fileName.replace(/\.(backup\.)?json$/i, '');
  const match = ARCHIVE_TIMESTAMP.exec(fileName);
  if (match) {
    const [, year, month, day, hour, minute] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
    if (!Number.isNaN(date.getTime())) {
      return `${date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })}, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    }
  }
  const dayOnly = ARCHIVE_DAY.exec(fileName);
  if (dayOnly) {
    const [, year, month, day] = dayOnly;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    }
  }
  return stripped;
}

/**
 * What to call one archive in the list.
 *
 * A dated archive is named by the moment it was sealed, which is in its file
 * name. A `replace`-mode archive has no date in its name on purpose — it is
 * rewritten in place — so the only honest answer is when the file itself last
 * changed. Falling back to the raw name would print
 * `symply-house-backup-maple-street--hh_local_9f2c` at somebody, which names
 * nothing they were looking for.
 */
export function formatBackupEntryLabel(entry: {
  fileName: string;
  modifiedAt: string | null;
}): string {
  if (ARCHIVE_TIMESTAMP.test(entry.fileName) || ARCHIVE_DAY.test(entry.fileName)) {
    return formatBackupFileName(entry.fileName);
  }
  const when = entry.modifiedAt ? new Date(entry.modifiedAt) : null;
  if (!when || Number.isNaN(when.getTime())) return 'Latest backup';
  return `Latest backup · ${when.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}, ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
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
export function backupDestinationLabel(destination: HouseBackupDestination): string {
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
  /** The last backup this app saw written for this home, wherever it went. */
  lastSuccess: HouseBackupEvent | null;
};

/**
 * The single answer the top of the screen exists to give. Derived rather than
 * stored so it can never drift from the settings and the archives on disk.
 *
 * The rule it enforces: **only claim protection we can still point at.** A
 * timestamp is not a backup; the file is. `lastRunAt` survives the archive that
 * run produced being deleted, so trusting it alone produces "Protected · Last
 * backup today" above a list reading "No backups on this device yet".
 */
export function deriveBackupHealth(
  settings: HouseAutoBackupSettings | null,
  evidence: BackupEvidence,
  now: Date = new Date(),
): BackupHealth {
  if (
    settings?.enabled &&
    (settings.lastStatus === 'failed' || settings.lastStatus === 'needs_auth')
  ) {
    return {
      tone: 'bad',
      title: 'Needs attention',
      detail: settings.lastError ?? 'The last automatic backup did not finish.',
      icon: 'alert-circle',
    };
  }

  // A schedule that ran before this build kept only its own timestamp. Read it
  // as a run to whatever the schedule targets, so that history survives — and
  // is held to the same evidence rule.
  const lastSuccess: HouseBackupEvent | null =
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
  //    the folder is the record: whatever is in it now, and nothing else. The
  //    one exception is a folder we could not read, where the record keeps the
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
          detail: 'If you lose this phone, this home goes with it. Back up once to be safe.',
          icon: 'shield-outline',
        };
  }

  if (settings?.enabled) {
    const due = nextHouseAutoBackupDueAt(settings);
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
        : `Last backup ${formatRelativeDay(latest, now)}${where}, ${HOUSE_AUTO_BACKUP_FREQUENCY_LABEL[
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

/** The archive the member picked, before a phrase has been tried against it. */
type PendingRestore = {
  archiveJson: string;
  /** Where it came from, for the panel's first line. */
  sourceLabel: string;
  /** The household id in the archive envelope, when it is readable. */
  householdHint: string | null;
  createdAtHint: string | null;
};

const EXPORT_FAILED = 'We could not put your export together just now. Try again in a moment.';

export function HouseBackupScreen() {
  const colors = useAppColors();
  const navigation = useNavigation();

  // --- Which home ------------------------------------------------------------
  const [properties, setProperties] = useState<HousePropertyOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [autoSettings, setAutoSettings] = useState<HouseAutoBackupSettings | null>(null);
  const [localBackups, setLocalBackups] = useState<LocalHouseBackupEntry[]>([]);
  /**
   * Whether that list is a fact. A failed read must not fall back to `[]`, which
   * renders as "No backups on this device yet" — an assertion we had not earned.
   */
  const [localListKnown, setLocalListKnown] = useState(true);
  const [lastSuccess, setLastSuccess] = useState<HouseBackupEvent | null>(null);
  /**
   * Where Drive backups land. Null until the first upload creates the app's own
   * folder — until then there is a name to promise but no folder to point at.
   */
  const [driveFolder, setDriveFolder] = useState<RememberedDriveFolder | null>(null);
  /** Android only — the folder on the phone, once one has been picked. */
  const [deviceFolder, setDeviceFolder] = useState<RememberedDeviceFolder | null>(null);
  const [retention, setRetention] = useState<HouseBackupRetention>('replace');
  /** The Google account backups are going to, or null when none is connected. */
  const [driveAccount, setDriveAccount] = useState<CloudAccount | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  /** What the selected home's archive would hold — counts plus the blob manifest. */
  const [summary, setSummary] = useState<HouseBackupSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Sheets
  const [destinationSheetOpen, setDestinationSheetOpen] = useState(false);
  const [frequencySheetOpen, setFrequencySheetOpen] = useState(false);
  const [autoDestinationSheetOpen, setAutoDestinationSheetOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  const [cloudPicker, setCloudPicker] = useState<{
    provider: HouseBackupCloudProvider;
    options: BackupOption[];
    loading: boolean;
    /** Listing failed — shown IN the sheet, never as an alert over it. */
    error?: string;
  } | null>(null);

  // The recovery phrase gets its own sheet — an Alert (and a silent clipboard
  // copy) is the wrong home for twelve words somebody has to transcribe.
  const [phraseSheet, setPhraseSheet] = useState<{
    phrase: string;
    intro: string;
    savedTo?: BackupLocation | null;
  } | null>(null);

  // Restore
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
  const [restorePhraseDraft, setRestorePhraseDraft] = useState('');
  const [restorePhraseSource, setRestorePhraseSource] = useState<
    'remembered' | 'clipboard' | 'retry' | 'none'
  >('none');
  /** An archive from another home may only be applied after an explicit yes. */
  const [foreignConfirmed, setForeignConfirmed] = useState(false);
  const [restoreSuccessSummary, setRestoreSuccessSummary] = useState<HouseRestoreOutcome | null>(
    null,
  );

  // CSV export
  const [exportResult, setExportResult] = useState<HouseExportResult | null>(null);
  const [exportError, setExportError] = useState<MemberFacingError | null>(null);

  // The backup that may be sealing right now — started here, or by the
  // scheduler while the member was somewhere else entirely.
  const backupStatus = useHouseBackupTaskStore((t) => t.status);
  const backupKind = useHouseBackupTaskStore((t) => t.kind);
  const pendingPhrase = useHouseBackupTaskStore((t) => t.pendingPhrase);
  const isBackingUp = backupStatus === 'running';

  /**
   * The restore that may be running right now — including one this screen never
   * saw start, because the member left mid-run and came back. Read from the
   * task store rather than local state for exactly that reason: local state
   * dies with the screen, and the run does not.
   */
  const restoreStatus = useHouseRestoreTaskStore((t) => t.status);
  const restoreProgress = useHouseRestoreTaskStore((t) => t.progress);
  const restoreLabel = useHouseRestoreTaskStore((t) => t.label);
  const restoreStartedAt = useHouseRestoreTaskStore((t) => t.startedAt);
  const restoreAttempt = useHouseRestoreTaskStore((t) => t.attempt);
  const pendingRestoreSummary = useHouseRestoreTaskStore((t) => t.pendingSummary);
  const isRestoring = restoreStatus === 'running';

  /** Scrolled to the top when a restore starts, so its card is what you see. */
  const scrollRef = useRef<ScrollView>(null);

  // --- Reading the world -----------------------------------------------------
  const refreshProperties = useCallback(() => {
    let list: HousePropertyOption[] = [];
    let active: string | null = null;
    try {
      list = listLocalHouseProperties().map((property) => ({
        householdId: property.householdId,
        name: property.name,
        isActive: property.isActive,
        awaitingEnrolment: property.awaitingEnrolment,
      }));
      active = getActiveHouseholdId();
    } catch {
      list = [];
      active = null;
    }

    /*
     * "All homes" leads the list once there is more than one, and is the
     * default. A member with three properties who backs up "the one I have
     * open" has two homes they believe are safe and are not — the single most
     * expensive misunderstanding this screen can create. One file with a section
     * per home removes the chance of it, so it is what the screen suggests; the
     * per-home rows below it are still there for anyone who wants a file they
     * can hand to one household's members and nobody else's.
     *
     * Not offered at all for a single property: a row saying "All homes (1)"
     * above the only home is a choice with no content.
     */
    const options =
      list.length > 1
        ? [
            {
              householdId: HOUSE_ALL_HOMES_ID,
              name: HOUSE_ALL_HOMES_LABEL,
              isActive: false,
              awaitingEnrolment: false,
              subtitle: `One file holding all ${list.length} homes, kept apart inside it`,
            },
            ...list,
          ]
        : list;

    setProperties(options);
    setActiveId(active);
    setSelectedId((current) => {
      if (current && options.some((property) => property.householdId === current)) return current;
      if (options.length > list.length) return HOUSE_ALL_HOMES_ID;
      const fallback = list.find((property) => property.isActive)?.householdId ?? active;
      return fallback ?? list[0]?.householdId ?? null;
    });
  }, []);

  /**
   * Everything that is per home, re-read for whichever one is selected.
   *
   * Budget reads the active household and is done; here the member can be
   * looking at a home they have not switched into, and a status card that
   * silently described a different one would be worse than no card.
   */
  const refreshForSelection = useCallback(async (householdId: string | null) => {
    if (!householdId) {
      setAutoSettings(null);
      setLocalBackups([]);
      setLocalListKnown(true);
      setLastSuccess(null);
      return;
    }
    const [settings, listed, folder, success, phoneFolder, storedRetention, account] =
      await Promise.all([
        getHouseAutoBackupSettings(householdId),
        listLocalHouseBackups(householdId).then(
          (entries) => ({ entries, known: true }),
          (error) => {
            console.warn('[house-backup] could not list on-device archives', error);
            return { entries: [] as LocalHouseBackupEntry[], known: false };
          },
        ),
        getRememberedDriveFolder().catch(() => null),
        getLastHouseBackupEvent(householdId).catch(() => null),
        IS_ANDROID ? getRememberedDeviceFolder().catch(() => null) : Promise.resolve(null),
        getHouseBackupRetention().catch(() => 'replace' as HouseBackupRetention),
        getCloudAccount('google-drive').catch(() => null),
      ]);
    setAutoSettings(settings);
    setLocalBackups(listed.entries);
    setLocalListKnown(listed.known);
    setDriveFolder(folder);
    setLastSuccess(success);
    setDeviceFolder(phoneFolder);
    setRetention(storedRetention);
    setDriveAccount(account);
  }, []);

  const refresh = useCallback(async () => {
    refreshProperties();
    await refreshForSelection(selectedId);
  }, [refreshProperties, refreshForSelection, selectedId]);

  /**
   * Put the top of the list back under the member's eyes.
   *
   * The restore card lives at the very top and the button that starts a restore
   * sits near the bottom, so without this the member taps "Verify & restore"
   * and watches the panel vanish with no visible replacement.
   */
  const scrollToTop = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshProperties();
      // Re-entering mid-restore: the progress is at the top, so start there
      // rather than wherever this screen was scrolled to when they left.
      if (useHouseRestoreTaskStore.getState().status === 'running') scrollToTop();
    }, [refreshProperties, scrollToTop]),
  );

  // Selection drives every per-home read, including the first one.
  useEffect(() => {
    void refreshForSelection(selectedId);
  }, [selectedId, refreshForSelection]);

  /**
   * What the archive would hold, for the home in front of the member.
   *
   * Hydrates a cold property, so it is deliberately tied to the SELECTION
   * rather than to every render: one cold read per home the member actually
   * asks about, never three on entry.
   */
  useEffect(() => {
    let cancelled = false;
    if (!selectedId) {
      setSummary(null);
      return () => {
        cancelled = true;
      };
    }
    setSummary(null);
    setSummaryLoading(true);
    void summarizeHouseProperty(selectedId)
      .then((next) => {
        if (!cancelled) setSummary(next);
      })
      .catch(() => {
        // A home that will not open is described by the status card and the
        // error a backup attempt raises; inventing counts here would be worse.
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // A run that finished anywhere (this screen, another screen, the scheduler)
  // changes what this screen shows: a new archive, a new status line.
  useEffect(() => {
    if (backupStatus === 'ok' || backupStatus === 'failed') void refresh();
  }, [backupStatus, refresh]);

  // A restore rewrites the ledger — including the archive list and the status
  // card above it.
  useEffect(() => {
    if (restoreStatus === 'ok') void refresh();
  }, [restoreStatus, refresh]);

  // Present the breakdown the run parked, for the same reason the phrase is
  // parked: the member may have been three screens away when it finished, and
  // "what did I actually get back?" is not a question a toast can answer.
  useEffect(() => {
    if (!pendingRestoreSummary || restoreSuccessSummary) return;
    setRestoreSuccessSummary(consumeHouseRestoreSummary());
  }, [pendingRestoreSummary, restoreSuccessSummary]);

  /**
   * Reopen the phrase panel on a failed run, with the archive and the words
   * already in it.
   *
   * A wrong phrase is the common failure, and the archive behind it came from
   * Drive, Dropbox or a file picker — making someone walk that path again to
   * fix one mistyped word is a punishment for a typo.
   */
  useEffect(() => {
    if (restoreStatus !== 'failed' || !restoreAttempt || pendingRestore) return;
    const attempt = takeHouseRestoreAttempt();
    if (!attempt) return;
    setPendingRestore({
      archiveJson: attempt.archiveJson,
      sourceLabel: 'the backup you chose',
      householdHint: attempt.householdId,
      createdAtHint: null,
    });
    setRestorePhraseDraft(attempt.phrase);
    setRestorePhraseSource('retry');
    setForeignConfirmed(attempt.allowHouseholdReplace);
    // The panel is far down the screen, and a member who failed while they were
    // somewhere else arrives to a screen that looks untouched.
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [restoreStatus, restoreAttempt, pendingRestore]);

  // Collect the once-only phrase as soon as this screen can show it. Parked in
  // the store rather than passed back, precisely so a member who navigated away
  // mid-seal still gets it the moment they return.
  useEffect(() => {
    if (!pendingPhrase || phraseSheet) return;
    setPhraseSheet(consumeHouseBackupPhrase());
  }, [pendingPhrase, phraseSheet]);

  const selectedProperty = useMemo(
    () => properties.find((property) => property.householdId === selectedId) ?? null,
    [properties, selectedId],
  );
  const selectedName = selectedProperty?.name?.trim() || 'this home';
  const activeName = properties.find((property) => property.isActive)?.name ?? null;

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
   * is parked in the task store and collected by the effect above.
   */
  const handleSaveTo = useCallback(
    (destination: HouseBackupDestination) => {
      setDestinationSheetOpen(false);
      startManualHouseBackup(destination, selectedId ?? undefined);
    },
    [selectedId],
  );

  // --- Automatic backup ------------------------------------------------------
  const handleToggleAuto = useCallback(
    async (next: boolean) => {
      if (!selectedId) return;
      setIsBusy(true);
      try {
        if (!next) {
          await disableHouseAutoBackup(selectedId);
          await refresh();
          return;
        }
        // Turning it on needs a destination — reuse the current one if we have
        // it, otherwise the default. Never enable into an unknown target.
        const current = await getHouseAutoBackupSettings(selectedId);
        const { phrase } = await enableHouseAutoBackup({
          frequency: current.frequency,
          destination: current.destination,
          householdId: selectedId,
        });
        await refresh();
        // Say why the user still needs their own copy of a phrase this device
        // already stores. Without that, "keep it safe" reads as busywork next
        // to a "Recovery phrase → Show" row that can produce it on demand — and
        // the one case it is for (the phone is gone, and with it the keychain)
        // is exactly the case where nobody can be told anything.
        setPhraseSheet({
          phrase,
          intro: `Automatic backup is on for ${selectedName}. Every scheduled backup is sealed with this one phrase — this device remembers it, so you can see it again from the “Recovery phrase” row below. Keep your own copy too: lose the phone and that copy goes with it, and only yours can open the backups it already sent.`,
        });
      } catch (error) {
        console.error('[house-backup] toggle failed', error);
        Alert.alert('Automatic backup', 'Could not change automatic backup.');
      } finally {
        setIsBusy(false);
      }
    },
    [refresh, selectedId, selectedName],
  );

  const handleFrequencyPicked = useCallback(
    async (key: string) => {
      setFrequencySheetOpen(false);
      await updateHouseAutoBackupSettings(
        { frequency: key as HouseAutoBackupFrequency },
        selectedId ?? undefined,
      );
      await refresh();
    },
    [refresh, selectedId],
  );

  const handleAutoDestinationPicked = useCallback(
    async (key: string) => {
      setAutoDestinationSheetOpen(false);
      await updateHouseAutoBackupSettings(
        {
          destination: key as HouseAutoBackupDestination,
          // A new target has never succeeded yet — clear a stale error so the
          // status card does not accuse the new destination of the old one's sin.
          lastStatus: null,
          lastError: null,
        },
        selectedId ?? undefined,
      );
      await refresh();
    },
    [refresh, selectedId],
  );

  const handleRunNow = useCallback(() => {
    // Reports itself through the same task slot, so this is fire-and-forget too.
    void runHouseAutoBackupIfDue({ force: true, householdId: selectedId ?? undefined });
  }, [selectedId]);

  const handleShowPhrase = useCallback(async () => {
    const phrase = await getHouseAutoBackupPhrase(selectedId ?? undefined);
    if (!phrase) {
      Alert.alert(
        'Recovery phrase',
        'No stored phrase yet. Turn automatic backup on to create one.',
      );
      return;
    }
    setPhraseSheet({
      phrase,
      // `isAllHomesTarget(selectedId)` rather than the `targetsEveryHome` derived
      // below: that binding is declared further down the component, so naming it
      // in this callback's dependency array would be read during render, before
      // it exists.
      intro: `This one phrase opens every automatic backup of ${selectedName}. This device remembers it, but that copy is gone if you lose the phone — keep your own, or the backups already in the cloud can never be opened. Anyone who has it can read everything ${
        isAllHomesTarget(selectedId) ? 'in all of these homes' : 'in this home'
      }.`,
    });
  }, [selectedId, selectedName]);

  // --- Restore ---------------------------------------------------------------
  const beginRestore = useCallback(
    async (archive: Omit<PendingRestore, 'sourceLabel'> & { sourceLabel: string }) => {
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
      setPendingRestore(archive);
      setForeignConfirmed(false);

      // A phrase that already opened an archive for this home beats the
      // clipboard: it is known-good, whereas the clipboard is whatever the user
      // copied last.
      const remembered = await getRememberedRestorePhrase(
        archive.householdHint ?? selectedId ?? undefined,
      );
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
    [isRestoring, selectedId],
  );

  /** Read the envelope for the two hints the panel shows before decrypting. */
  const readArchiveHints = (archiveJson: string) => {
    try {
      const meta = JSON.parse(archiveJson) as {
        meta?: { householdId?: string; createdAt?: string };
      };
      return {
        householdHint: meta.meta?.householdId ?? null,
        createdAtHint: meta.meta?.createdAt ?? null,
      };
    } catch {
      return { householdHint: null, createdAtHint: null };
    }
  };

  const handleRestoreLocal = useCallback(
    async (entry: LocalHouseBackupEntry) => {
      setIsBusy(true);
      try {
        const archiveJson = await readLocalHouseBackup(entry.fileName);
        await beginRestore({
          archiveJson,
          sourceLabel: formatBackupEntryLabel(entry),
          ...readArchiveHints(archiveJson),
        });
      } catch (error) {
        console.error('[house-restore] read local failed', error);
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
  const handleOpenLocal = useCallback(async (entry: LocalHouseBackupEntry) => {
    const result = await openBackupLocation({ uri: entry.uri, fileName: entry.fileName });
    if (result.status === 'unavailable') Alert.alert('Backup file', result.message);
  }, []);

  const handleDeleteLocal = useCallback(
    (entry: LocalHouseBackupEntry) => {
      Alert.alert('Delete backup', `Delete the backup from ${formatBackupEntryLabel(entry)}?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deleteLocalHouseBackup(entry.fileName).catch(() => undefined);
              await refresh();
            })();
          },
        },
      ]);
    },
    [refresh],
  );

  const openCloudPicker = useCallback(
    async (provider: HouseBackupCloudProvider) => {
      setCloudPicker({ provider, options: [], loading: true });
      try {
        // Not narrowed to the selected home: a member restoring onto a fresh
        // phone has no local property to match against yet, and hiding the
        // archive they came for would be the worst possible moment to be tidy.
        const entries = await listCloudHouseBackups(provider);
        setCloudPicker({
          provider,
          loading: false,
          options: entries.map((entry) => ({
            key: entry.id,
            label: formatBackupEntryLabel(entry),
            description: formatBytes(entry.size),
            icon: 'cloud-download-outline',
            testID: `house-backup-cloud-${entry.fileName}`,
          })),
        });
      } catch (error) {
        console.error('[house-restore] cloud list failed', provider, error);
        // Report the failure INSIDE the sheet instead of closing it and firing
        // an Alert in the same tick: on iOS the native alert presents while the
        // Modal is still dismissing, so BOTH sit on screen. One surface, and
        // the user keeps their place.
        setCloudPicker({
          provider,
          loading: false,
          options: [],
          error: `Could not read your ${cloudProviderLabel(provider)} backups. Reconnect and try again.`,
        });
      }
    },
    [],
  );

  /**
   * Reconnect, then list again. Retrying the read alone re-uses the same dead
   * token and lands on the identical error, which looks like a dead button.
   */
  const reconnectCloud = useCallback(
    async (provider: HouseBackupCloudProvider) => {
      setCloudPicker({ provider, options: [], loading: true });
      try {
        await reconnectCloudProvider(provider);
      } catch (error) {
        console.error('[house-restore] reconnect failed', provider, error);
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
      const label = cloudPicker?.options.find((option) => option.key === fileId)?.label;
      setCloudPicker(null);
      if (!provider) return;
      setIsBusy(true);
      try {
        const archiveJson = await readCloudHouseBackup(provider, fileId);
        await beginRestore({
          archiveJson,
          sourceLabel: label ?? cloudProviderLabel(provider),
          ...readArchiveHints(archiveJson),
        });
      } catch (error) {
        console.error('[house-restore] cloud read failed', error);
        Alert.alert('Restore', 'Could not open that backup.');
      } finally {
        setIsBusy(false);
      }
    },
    [cloudPicker?.provider, cloudPicker?.options, beginRestore],
  );

  const handleRestoreFromFiles = useCallback(async () => {
    setIsBusy(true);
    try {
      const picked = await pickHouseBackupArchive();
      if (picked.status === 'cancelled') return;
      if (picked.status === 'failed') {
        Alert.alert('Restore', picked.message);
        return;
      }
      await beginRestore({
        archiveJson: picked.archiveJson,
        sourceLabel: picked.propertyName ?? 'the file you chose',
        householdHint: picked.householdHint,
        createdAtHint: picked.createdAtHint,
      });
    } finally {
      setIsBusy(false);
    }
  }, [beginRestore]);

  /** The member is pointing at every home, not at one of them. */
  const targetsEveryHome = selectedId == null || isAllHomesTarget(selectedId);
  /** The FILE holds every home, each in its own section. */
  const archiveCoversEveryHome = isAllHomesTarget(pendingRestore?.householdHint ?? null);

  /**
   * Where this archive will actually be written.
   *
   * Four cases, and only the first two are choices the member made:
   *
   *  - they narrowed to one home → that home. A whole-device file is narrowed to
   *    that home's section; a per-home file goes there or is refused as foreign.
   *  - they chose "All homes" and the file holds all homes → every section into
   *    its own home. Nothing to decide and nothing to mix.
   *  - they chose "All homes" and the file holds ONE home this device has →
   *    that home. "All homes" means "put it where it belongs", and refusing
   *    because the active property happens to be a different one would be
   *    pedantry over a request that was never ambiguous.
   *  - they chose "All homes" and the file holds one home this device does NOT
   *    have → the active property, which is what makes the restore refuse and
   *    say so, rather than silently doing nothing.
   */
  const restoreTargetId = (() => {
    if (!targetsEveryHome) return selectedId;
    if (archiveCoversEveryHome) return HOUSE_ALL_HOMES_ID;
    const hint = pendingRestore?.householdHint ?? null;
    return hint && properties.some((property) => property.householdId === hint)
      ? hint
      : (activeId ?? null);
  })();
  const restoreTargetName = archiveCoversEveryHome
    ? HOUSE_ALL_HOMES_LABEL
    : (properties.find((property) => property.householdId === restoreTargetId)?.name?.trim() ||
      selectedName);

  /**
   * The archive was made for a different home than the one it would be applied
   * to. With 1–3 properties (H5) this is a realistic mis-tap, not a corruption,
   * so it is surfaced as a choice rather than an error — but it may never be
   * waved through silently: mixing two homes' rows cannot be undone.
   *
   * A whole-device file is never foreign: it names the home for every row it
   * carries, so there is nothing to rebind and nothing to mix. Neither is a
   * per-home file that resolved to its own home above.
   */
  const isForeign =
    !archiveCoversEveryHome &&
    pendingRestore?.householdHint != null &&
    restoreTargetId != null &&
    pendingRestore.householdHint !== restoreTargetId;
  const foreignName = isForeign
    ? (properties.find((p) => p.householdId === pendingRestore?.householdHint)?.name ??
      'another home')
    : null;

  /**
   * Hand the restore to the background runner and return.
   *
   * Nothing is awaited here. The panel closes, the progress card takes over at
   * the top of the screen, and the member is free to go anywhere — the outcome
   * finds them as a toast, and the breakdown waits in the task store until this
   * screen can present it.
   */
  const runRestore = useCallback(() => {
    if (!pendingRestore || isRestoring) return;
    const phrase = restorePhraseDraft.trim();
    if (!phrase) {
      Alert.alert('Recovery phrase', 'Paste the 12-word phrase for this backup.');
      return;
    }
    // Guarded here as well as on the button: a disabled prop is a hint, not a
    // rule, and mixing two homes' rows is not recoverable.
    if (isForeign && !foreignConfirmed) return;
    if (
      !startHouseRestore(pendingRestore.archiveJson, phrase, {
        householdId: restoreTargetId,
        allowHouseholdReplace: isForeign,
      })
    ) {
      return;
    }
    setPendingRestore(null);
    setRestorePhraseDraft('');
    setRestorePhraseSource('none');
    setForeignConfirmed(false);
    scrollToTop();
  }, [
    pendingRestore,
    restorePhraseDraft,
    isRestoring,
    isForeign,
    foreignConfirmed,
    restoreTargetId,
    scrollToTop,
  ]);

  // --- Drive folder ----------------------------------------------------------
  /**
   * The folder in the words a member would use for it. Before the first upload
   * there is no pointer yet, so this names the folder the app WILL make rather
   * than going blank — the row is a promise about where backups go, and that
   * promise is already true.
   */
  const driveFolderLabel = driveFolder
    ? describeCloudFolder(driveFolder)
    : HOUSE_BACKUP_DRIVE_FOLDER;

  const canPickDriveFolder =
    isCloudProviderConfigured('google-drive') && cloudProviderSupportsFolderPicking('google-drive');

  const handlePickDriveFolder = useCallback(
    async (picked: PickedCloudFolder) => {
      setFolderPickerOpen(false);
      if (!selectedId) return;
      setIsBusy(true);
      try {
        await chooseCloudBackupFolder('google-drive', picked);

        /*
         * Choosing a folder IS the request to back up into it.
         *
         * Picking a folder and then being left to find a toggle, open a second
         * sheet and choose "Google Drive" is three steps to express one
         * intention — and anyone who stops after the first gets a stored
         * pointer and no backups, which reads exactly like the feature is on.
         * So the pick arms the whole thing: schedule on, destination Drive.
         *
         * Nothing here can surprise a connected account into existence — the
         * picker only opens once Drive is authorised — so the schedule this
         * turns on is one that can actually run unattended.
         */
        const current = await getHouseAutoBackupSettings(selectedId);
        const wasArmedForDrive = current.enabled && current.destination === 'google-drive';

        if (current.enabled) {
          await updateHouseAutoBackupSettings(
            { destination: 'google-drive', lastStatus: null, lastError: null },
            selectedId,
          );
        } else {
          const { phrase } = await enableHouseAutoBackup({
            frequency: current.frequency,
            destination: 'google-drive',
            householdId: selectedId,
          });
          // The one thing that genuinely cannot be done for them: this phrase is
          // the only key to every archive, and it is shown exactly once.
          setPhraseSheet({
            phrase,
            intro: `Backups of ${selectedName} now go to ${describeCloudFolder({
              ...picked,
              source: 'picked',
            })} in Google Drive, automatically — ${HOUSE_AUTO_BACKUP_FREQUENCY_LABEL[
              current.frequency
            ].toLowerCase()}. Every one is sealed with this phrase, and this device remembers it, so you can see it again from the “Recovery phrase” row. Keep your own copy too: lose the phone and that copy goes with it.`,
          });
        }

        await refresh();

        // Put a copy in the new folder now rather than at the next due date. It
        // proves the folder is writable while the member is still on this
        // screen to see it fail, and it stops the screen claiming protection
        // while the folder they just chose sits empty.
        void runHouseAutoBackupIfDue({ force: true, householdId: selectedId });

        if (wasArmedForDrive) {
          // Already on this schedule — no phrase sheet is due, so this is the
          // only acknowledgement that the move took effect.
          Alert.alert(
            'Backup folder changed',
            `New backups will go to ${describeCloudFolder({ ...picked, source: 'picked' })}. The ones already saved stay where they are.`,
          );
        }
      } catch (error) {
        console.error('[house-backup] could not arm Drive backups', error);
        Alert.alert(
          'Backup folder',
          'Could not set up automatic backups to that folder. Please try again.',
        );
        await refresh();
      } finally {
        setIsBusy(false);
      }
    },
    [refresh, selectedId, selectedName],
  );

  /**
   * Back to the app's own folder. Offered only once a pick is in place —
   * "Use the default folder" against a default folder is a no-op dressed as a
   * choice.
   */
  const handleResetDriveFolder = useCallback(() => {
    Alert.alert(
      'Use the default folder?',
      `New backups will go to “${HOUSE_BACKUP_DRIVE_FOLDER}” instead. Backups already in ${driveFolderLabel} stay where they are.`,
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
      const current = await getHouseAutoBackupSettings(selectedId ?? undefined);
      if (current.destination === 'google-drive') {
        await updateHouseAutoBackupSettings(
          { destination: 'device', lastStatus: null, lastError: null },
          selectedId ?? undefined,
        );
      }
      await refresh();
      Alert.alert(
        'Signed out of Google Drive',
        'Backups now go to this device. The archives already in Drive are still there — sign in again to reach them.',
      );
    } catch (error) {
      console.error('[house-backup] drive disconnect failed', error);
      Alert.alert('Google Drive', 'Could not sign out. Please try again.');
      await refresh();
    } finally {
      setIsBusy(false);
    }
  }, [refresh, selectedId]);

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
        console.error('[house-backup] drive account switch failed', error);
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
        testID: 'house-backup-drive-switch-account',
      },
      {
        key: 'disconnect',
        label: 'Sign out of Google Drive',
        description: 'Backups go back to this device',
        icon: 'log-out-outline',
        testID: 'house-backup-drive-disconnect',
      },
    ],
    [],
  );

  // --- Keep one copy, or one per date ----------------------------------------
  /**
   * Flipping this changes only what the NEXT run is named. Archives already
   * written are never renamed or removed by the switch — turning "keep every
   * copy" off is a decision about the future, and quietly deleting the history
   * somebody had been keeping is not something a switch should do.
   */
  const handleToggleRetention = useCallback(async (keepEvery: boolean) => {
    const next: HouseBackupRetention = keepEvery ? 'dated' : 'replace';
    setRetention(next); // Optimistic: a switch that lags reads as broken.
    try {
      await setHouseBackupRetention(next);
    } catch (error) {
      console.warn('[house-backup] could not save the retention choice', error);
      setRetention(keepEvery ? 'replace' : 'dated');
      Alert.alert('Backup copies', 'Could not save that choice. Please try again.');
    }
  }, []);

  // --- A folder on the phone (Android) ---------------------------------------
  /**
   * Android's folder grant persists, so picking one arms the schedule exactly
   * the way picking a Drive folder does — see `handlePickDriveFolder`.
   */
  const handlePickDeviceFolder = useCallback(async () => {
    if (!selectedId) return;
    setIsBusy(true);
    try {
      const picked = await chooseDeviceBackupFolder();
      if (!picked) return; // Backed out of the system picker.

      const current = await getHouseAutoBackupSettings(selectedId);
      const wasArmedForFiles = current.enabled && current.destination === 'files';

      if (current.enabled) {
        await updateHouseAutoBackupSettings(
          { destination: 'files', lastStatus: null, lastError: null },
          selectedId,
        );
      } else {
        const { phrase } = await enableHouseAutoBackup({
          frequency: current.frequency,
          destination: 'files',
          householdId: selectedId,
        });
        setPhraseSheet({
          phrase,
          intro: `Backups of ${selectedName} now go to ${picked.label} on this phone, automatically — ${HOUSE_AUTO_BACKUP_FREQUENCY_LABEL[
            current.frequency
          ].toLowerCase()}. Every one is sealed with this phrase, and this device remembers it, so you can see it again from the “Recovery phrase” row. Keep your own copy too: a folder on this phone goes with the phone.`,
        });
      }

      await refresh();
      void runHouseAutoBackupIfDue({ force: true, householdId: selectedId });

      if (wasArmedForFiles) {
        Alert.alert(
          'Backup folder changed',
          `New backups will go to ${picked.label}. The ones already saved stay where they are.`,
        );
      }
    } catch (error) {
      console.error('[house-backup] could not arm phone-folder backups', error);
      Alert.alert('Backup folder', 'Could not set up backups to that folder. Please try again.');
      await refresh();
    } finally {
      setIsBusy(false);
    }
  }, [refresh, selectedId, selectedName]);

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
              await updateHouseAutoBackupSettings(
                { destination: 'device', lastStatus: null, lastError: null },
                selectedId ?? undefined,
              );
              await refresh();
            })();
          },
        },
      ],
    );
  }, [deviceFolder?.label, refresh, selectedId]);

  // --- CSV export ------------------------------------------------------------
  const handleExportCsv = useCallback(async () => {
    if (isBusy) return;
    setIsBusy(true);
    setExportError(null);
    setExportResult(null);
    // Let the button's "Working…" paint before the ledger walk lands.
    await yieldToPaint();
    try {
      setExportResult(await exportHouseLedgerCsv());
    } catch (err) {
      setExportError(toMemberFacingError(err, EXPORT_FAILED));
    } finally {
      setIsBusy(false);
    }
  }, [isBusy]);

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
            testID: 'house-backup-to-drive',
          },
          {
            key: 'dropbox',
            label: 'Dropbox',
            description: 'Off-device copy',
            icon: 'cloud-upload-outline',
            testID: 'house-backup-to-dropbox',
          },
          {
            key: 'files',
            label: IS_ANDROID ? 'Choose a folder' : 'Files app',
            description: IS_ANDROID ? 'Any folder on this phone' : 'On My iPhone or iCloud Drive',
            icon: 'folder-open-outline',
            testID: 'house-backup-to-files',
          },
          {
            key: 'device',
            label: 'This device',
            description: 'Fastest — lost with the phone',
            icon: 'phone-portrait-outline',
            testID: 'house-backup-to-device',
          },
          {
            key: 'share',
            label: 'Share…',
            description: 'AirDrop, Mail, or another app',
            icon: 'share-outline',
            testID: 'house-backup-to-share',
          },
        ] as BackupOption[]
      ).filter((option) => option.key !== 'dropbox' || isCloudProviderConfigured('dropbox')),
    [driveFolderLabel],
  );

  const frequencyOptions = useMemo<BackupOption[]>(
    () =>
      (['daily', 'weekly', 'monthly'] as HouseAutoBackupFrequency[]).map((frequency) => ({
        key: frequency,
        label: HOUSE_AUTO_BACKUP_FREQUENCY_LABEL[frequency],
        description: autoSettings?.frequency === frequency ? 'Current' : undefined,
        icon: 'time-outline',
        testID: `house-backup-frequency-${frequency}`,
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
            testID: 'house-backup-auto-dest-drive',
          },
          {
            key: 'dropbox',
            label: 'Dropbox',
            description: 'Off-device copy',
            icon: 'cloud-upload-outline',
            testID: 'house-backup-auto-dest-dropbox',
          },
          {
            key: 'device',
            label: 'This device',
            description: 'No account needed',
            icon: 'phone-portrait-outline',
            testID: 'house-backup-auto-dest-device',
          },
        ] as BackupOption[]
      ).filter(
        (option) =>
          option.key === 'device' ||
          isCloudProviderConfigured(option.key as HouseBackupCloudProvider),
      ),
    [driveFolderLabel],
  );

  const autoDestinationLabel = autoSettings
    ? autoBackupDestinationLabel(autoSettings.destination)
    : '';

  /**
   * Why the list is empty — three different situations that would all otherwise
   * say "No backups on this device yet".
   *
   * The middle one is the one that makes the screen contradict itself: with a
   * cloud schedule there is nothing here BY DESIGN, and saying "no backups"
   * next to a "Protected" card reads as one of the two being a lie.
   */
  const emptyBackupsMessage = !localListKnown
    ? 'Could not read the backups saved on this device.'
    : lastSuccess && !backupEvidenceIsLocal(lastSuccess.destination)
      ? `Nothing is kept here — the last backup of ${selectedName} went to ${backupDestinationLabel(
          lastSuccess.destination,
        )}.`
      : lastSuccess
        ? 'The backup saved here has since been deleted.'
        : `No backups of ${selectedName} on this device yet.`;

  const blobs = summary?.blobManifest ?? [];
  const rows = summary ? summaryRows(summary.tableCounts) : [];
  /**
   * The per-home split of a whole-device summary. Present only when several
   * homes are in play; the totals above are the same numbers added up.
   */
  const perHomeSummaries = summary?.households ?? null;
  const restoredRows = restoreSuccessSummary
    ? summaryRows(restoreSuccessSummary.summary.tableCounts)
    : [];
  /** Homes the file could not put back — named, never averaged into a count. */
  const restoreMissedHomes = (restoreSuccessSummary?.households ?? []).filter(
    (entry) => entry.status !== 'restored',
  );
  const restoredHomeCount = (restoreSuccessSummary?.households ?? []).filter(
    (entry) => entry.status === 'restored',
  ).length;

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
      style={[
        styles.row,
        !last && { borderBottomColor: colors.borderColor, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
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
   * buttons share the row can sit on `style` directly.
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
        // Three sources share one row on a phone, so a long label shrinks
        // rather than wraps mid-word.
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
      <SafeAreaView edges={[]} testID="house-backup-screen">
        <ScreenHeader
          title="Backup & Restore"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        {/*
          The phrase field sits at the bottom of this list, so a raw ScrollView
          leaves it under the keyboard. `automaticallyAdjustKeyboardInsets`
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
              one thing on this screen that survives leaving the screen. */}
          {isRestoring ? (
            <RestoreProgressCard
              progress={restoreProgress}
              label={restoreLabel}
              startedAt={restoreStartedAt}
              estimateMs={HOUSE_RESTORE_ESTIMATE_MS}
              title="Restoring your home"
              testID="house-backup-restore-progress"
            />
          ) : null}

          {/* 1 — Which home. H5 lets a member hold three properties, so this
              cannot be implied — and "all of them, in one file" is a real
              answer, not a shorthand for the active one. */}
          <HousePropertyPicker
            testIDPrefix="house-backup"
            title="WHICH HOME"
            hint={
              targetsEveryHome && selectedId != null
                ? 'Everything below is about all your homes together. One backup file, one schedule, one set of 12 words — and inside it each home is kept separate, so a restore puts every home back where it belongs.'
                : `Everything below is about ${selectedName}. Each home has its own backups, its own schedule and its own 12 words.`
            }
            emptyMessage="No home is open on this device yet, so there is nothing to back up."
            properties={properties}
            selectedId={selectedId}
            onSelect={setSelectedId}
            disabled={isBusy || isBackingUp || isRestoring}
          />

          {/* 2 — Am I safe? One glance, colour-coded, before any control. */}
          <Card
            style={[styles.statusCard, { borderColor: hexToRgba(healthColor, 0.35) }]}
            testID="house-backup-status-card"
          >
            <View style={[styles.statusIcon, { backgroundColor: hexToRgba(healthColor, 0.14) }]}>
              <Icon name={health.icon} forceIonicons size={26} color={healthColor} />
            </View>
            <View style={styles.statusText}>
              <Typography
                variant="title3"
                weight="semibold"
                color={healthColor}
                testID="house-backup-status-title"
              >
                {health.title}
              </Typography>
              <Typography variant="footnote" color={colors.textSecondary}>
                {health.detail}
              </Typography>
            </View>
          </Card>

          {/* 3 — The 90% action, and the only primary button on the screen. */}
          <GradientButton
            title={isBackingUp ? 'Backing up…' : 'Back up now'}
            disabled={isBusy || isBackingUp || isRestoring || selectedId == null}
            fullWidth
            onPress={() => setDestinationSheetOpen(true)}
            testID="house-backup-now"
          />
          {isBackingUp ? (
            // Says the two things a spinner cannot: you are not stuck here, and
            // you will be told.
            <Card style={styles.progressCard} testID="house-backup-progress">
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
            Sealed with a fresh 12-word phrase, on this device. Choose where it goes — only Drive,
            Dropbox and iCloud survive losing this phone.
          </Typography>

          {/* 4 — Automation as direct manipulation: a switch, not a modal chain. */}
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
                disabled={isBusy || isRestoring || selectedId == null}
                testID="house-backup-auto-toggle"
              />
            </View>

            {autoSettings?.enabled ? (
              <>
                {renderRow(
                  'freq',
                  'How often',
                  HOUSE_AUTO_BACKUP_FREQUENCY_LABEL[autoSettings.frequency],
                  () => setFrequencySheetOpen(true),
                  'house-backup-frequency-row',
                )}
                {renderRow(
                  'dest',
                  'Where',
                  autoDestinationLabel,
                  () => setAutoDestinationSheetOpen(true),
                  'house-backup-auto-destination-row',
                )}
                {renderRow(
                  'phrase',
                  'Recovery phrase',
                  'Show',
                  () => void handleShowPhrase(),
                  'house-backup-show-phrase',
                )}
                {renderRow(
                  'run',
                  'Back up now',
                  '',
                  () => void handleRunNow(),
                  'house-backup-run-now',
                  true,
                )}
              </>
            ) : null}
          </Card>

          {/* 4b — Where Drive puts them. Its own group rather than a row inside
              AUTOMATIC, because the folder applies to manual backups too and
              would otherwise be invisible to anyone who never turns automatic
              on. Hidden entirely when the brand ships no Drive credentials. */}
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
                  testID="house-backup-drive-folder-row"
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
                      testID="house-backup-drive-folder-value"
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
                      HOUSE_BACKUP_DRIVE_FOLDER,
                      handleResetDriveFolder,
                      'house-backup-drive-folder-default',
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
                  'house-backup-drive-account-row',
                  true,
                  'person-circle-outline',
                )}
              </Card>
              {/* Says what the tap will DO before it does it. Choosing a folder
                  turns the schedule on, and a state change that large must not
                  arrive as a surprise after the fact. */}
              <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
                {autoSettings?.enabled && autoSettings.destination === 'google-drive'
                  ? `Backups go here on their own, ${HOUSE_AUTO_BACKUP_FREQUENCY_LABEL[
                      autoSettings.frequency
                    ].toLowerCase()}. Nothing else to do.`
                  : 'Pick a folder and backups start going there on their own — no switch to flip.'}
              </Typography>
            </>
          ) : null}

          {/* 4c — A folder on the phone itself. Android only: its folder grant
              survives a restart, so a picked folder is somewhere scheduled runs
              can keep writing. iOS can only reach an arbitrary folder through
              the share sheet, which needs a person to answer it. */}
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
                  testID="house-backup-device-folder-row"
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
                      testID="house-backup-device-folder-value"
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
                      'house-backup-device-folder-forget',
                      true,
                      'close-circle-outline',
                    )
                  : null}
              </Card>
              <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
                {deviceFolder
                  ? `Archives go in a “${HOUSE_BACKUP_DEVICE_FOLDER}” folder inside it, on their own. Anything on the phone itself is lost with the phone.`
                  : `Pick any folder — we make a “${HOUSE_BACKUP_DEVICE_FOLDER}” folder inside it and back up there automatically.`}
              </Typography>
            </>
          ) : null}

          {/* 4d — One file, or one per date. A switch rather than a sheet: it is
              a two-way choice with a strong default. */}
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
                    : 'Off — each backup replaces the last one. One file per home, always current.'}
                </Typography>
              </View>
              <Toggle
                value={retention === 'dated'}
                onValueChange={(next) => void handleToggleRetention(next)}
                disabled={isBusy || isRestoring}
                testID="house-backup-keep-every-copy"
              />
            </View>
          </Card>
          <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
            Turning this on from now on leaves the backups you already have exactly where they are.
          </Typography>

          {/* 5 — What one archive of this home would hold. */}
          <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
            WHAT IS IN A BACKUP
          </Typography>
          <Card style={styles.group} testID="house-backup-summary">
            <View style={[styles.row, styles.rowDivider, { borderBottomColor: colors.borderColor }]}>
              <Typography variant="body" weight="semibold" style={styles.rowLabel}>
                {summary?.propertyName || selectedName}
              </Typography>
              {summaryLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Typography variant="body" weight="semibold" testID="house-backup-summary-total">
                  {summary ? pluralRows(summary.totalRows) : '—'}
                </Typography>
              )}
            </View>

            {!summary && !summaryLoading ? (
              <View style={styles.row}>
                <Typography
                  variant="footnote"
                  color={colors.textSecondary}
                  testID="house-backup-summary-unavailable"
                >
                  This home is not open on this device yet, so there is nothing to count.
                </Typography>
              </View>
            ) : rows.length === 0 && summary ? (
              <View style={styles.row}>
                <Typography
                  variant="footnote"
                  color={colors.textSecondary}
                  testID="house-backup-summary-empty"
                >
                  This home is still empty, so a backup holds its settings and nothing else.
                </Typography>
              </View>
            ) : (
              <>
                {/*
                  The per-home split, above the combined table counts.

                  "4,812 rows" over three homes is a number nobody can act on.
                  What a member wants to know before they trust one file with
                  everything is that every home is in it — so each is named with
                  its own row count, and a home that came out at zero is visible
                  rather than absorbed into the total.
                */}
                {perHomeSummaries && perHomeSummaries.length > 1
                  ? perHomeSummaries.map((home) => (
                      <View
                        key={home.householdId}
                        style={[
                          styles.row,
                          styles.rowDivider,
                          { borderBottomColor: colors.borderColor },
                        ]}
                        testID={`house-backup-summary-home-${home.householdId}`}
                      >
                        <Icon
                          name="home-outline"
                          forceIonicons
                          size={IconSize.sm}
                          color={colors.textSecondary}
                        />
                        <Typography
                          variant="body"
                          weight="medium"
                          style={styles.rowLabel}
                          accessible={false}
                        >
                          {home.propertyName || 'Home'}
                        </Typography>
                        <Typography variant="body" color={colors.textSecondary} accessible={false}>
                          {pluralRows(home.totalRows)}
                        </Typography>
                      </View>
                    ))
                  : null}
                {rows.map((entry, index) => (
                  <View
                    key={entry.table}
                    style={[
                      styles.row,
                      index < rows.length - 1 && styles.rowDivider,
                      index < rows.length - 1 && { borderBottomColor: colors.borderColor },
                    ]}
                    testID={`house-backup-summary-row-${entry.table}`}
                  >
                    <Typography variant="body" style={styles.rowLabel} accessible={false}>
                      {entry.label}
                    </Typography>
                    <Typography variant="body" color={colors.textSecondary} accessible={false}>
                      {formatCount(entry.count)}
                    </Typography>
                  </View>
                ))}
              </>
            )}
          </Card>

          {/* 5b — Q15: the attachment bytes are NOT in the file. Say so, every
              time, and before anyone relies on it. */}
          <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
            PHOTOS &amp; DOCUMENTS
          </Typography>
          <Card
            style={[styles.noticeCard, { borderColor: hexToRgba(colors.info, 0.35) }]}
            testID="house-backup-blob-manifest"
          >
            {blobs.length === 0 ? (
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                testID="house-backup-blob-empty"
              >
                {blobManifestSentence(0, 0)}
              </Typography>
            ) : (
              <>
                <Typography variant="body" weight="semibold" testID="house-backup-blob-count">
                  {`${formatCount(blobs.length)} ${
                    blobs.length === 1 ? 'attachment' : 'attachments'
                  } listed, not included`}
                </Typography>
                <Typography
                  variant="footnote"
                  color={colors.textSecondary}
                  testID="house-backup-blob-note"
                >
                  {blobManifestSentence(blobs.length, totalBlobBytes(blobs))}
                </Typography>
              </>
            )}
          </Card>

          {/* 6 — Restore is a list, not a scavenger hunt through two sheets. */}
          <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
            YOUR BACKUPS
          </Typography>
          {localBackups.length === 0 ? (
            <Card style={styles.emptyCard} testID="house-backup-empty">
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.emptyText}
                testID="house-backup-empty-message"
              >
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
                    onPress={() => void handleRestoreLocal(entry)}
                    accessibilityRole="button"
                    accessibilityLabel={`Restore backup from ${formatBackupEntryLabel(entry)}`}
                    testID={`house-backup-entry-${entry.fileName}`}
                  >
                    <Typography variant="body" accessible={false}>
                      {formatBackupEntryLabel(entry)}
                    </Typography>
                    <Typography variant="caption2" color={colors.textSecondary} accessible={false}>
                      {/* Which archives are the "everything" ones matters most in
                          this list, because the row tap RESTORES and the trash
                          icon next to it deletes. */}
                      {entry.coversAllHomes ? 'All homes · ' : ''}On this device ·{' '}
                      {formatBytes(entry.size)}
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
                    testID={`house-backup-open-${entry.fileName}`}
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
                    testID={`house-backup-delete-${entry.fileName}`}
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

          {/* 7 — Other locations. Buttons rather than settings rows: each one
              opens a picker, which is an ACTION, and a chevron row promises a
              sub-screen that holds a value. */}
          <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
            RESTORE FROM ELSEWHERE
          </Typography>
          <View style={styles.restoreSourceRow} testID="house-backup-restore-sources">
            {renderRestoreSource(
              'drive',
              'Google Drive',
              'cloud-download-outline',
              () => void openCloudPicker('google-drive'),
              'house-backup-restore-drive',
            )}
            {isCloudProviderConfigured('dropbox')
              ? renderRestoreSource(
                  'dropbox',
                  'Dropbox',
                  'cloud-download-outline',
                  () => void openCloudPicker('dropbox'),
                  'house-backup-restore-dropbox',
                )
              : null}
            {renderRestoreSource(
              'files',
              IS_ANDROID ? 'Browse files' : 'Files app',
              'folder-open-outline',
              () => void handleRestoreFromFiles(),
              'house-backup-restore-files',
            )}
          </View>
          <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
            A restore fills gaps — it does not roll time back. Anything you have changed on this
            device since the backup keeps its newer value, and anything you deleted stays deleted.
          </Typography>

          {/* Phrase entry appears in place once an archive is chosen. */}
          {pendingRestore ? (
            <Card style={styles.restorePanel} testID="house-backup-restore-phrase-panel">
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
                testID="house-backup-restore-phrase"
              />

              {/* What is actually inside the file, before minutes of Argon2 are
                  spent on it. A whole-device archive restores several homes at
                  once, and being told that afterwards is being told too late. */}
              {archiveCoversEveryHome ? (
                <Typography
                  variant="footnote"
                  color={colors.textSecondary}
                  testID="house-backup-restore-all-homes-note"
                >
                  {targetsEveryHome
                    ? 'This backup holds every home that was on the phone that made it. Each one goes back into its own home here — nothing is mixed. Any home in the file that is not on this device is left alone and named at the end.'
                    : `This backup holds every home that was on the phone that made it, but you picked ${selectedName} above — only that home's part of the file will be restored.`}
                </Typography>
              ) : null}

              {/* An archive from another home may only be applied on an explicit
                  yes — with 1–3 homes this is a mis-tap, and mixing their rows
                  cannot be undone. */}
              {isForeign ? (
                <View
                  style={[styles.foreignBox, { borderColor: hexToRgba(colors.warning, 0.45) }]}
                  testID="house-backup-restore-foreign-warning"
                >
                  <Typography variant="body" weight="semibold" color={colors.warning}>
                    This backup is from a different home
                  </Typography>
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                    testID="house-backup-restore-foreign-message"
                  >
                    {`It was made for ${foreignName}, and you are restoring into ${restoreTargetName}. Doing it anyway mixes two homes' rows together, and that cannot be undone. Usually the right move is to pick that home above first.`}
                  </Typography>
                  <Pressable
                    onPress={() => setForeignConfirmed((current) => !current)}
                    disabled={isRestoring}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: foreignConfirmed }}
                    accessibilityLabel="Yes, restore this other home's backup here"
                    style={styles.checkboxRow}
                    testID="house-backup-restore-foreign-confirm"
                  >
                    <View
                      style={[
                        styles.checkbox,
                        {
                          borderColor: foreignConfirmed ? colors.warning : colors.borderColor,
                          backgroundColor: foreignConfirmed
                            ? hexToRgba(colors.warning, 0.16)
                            : 'transparent',
                        },
                      ]}
                    >
                      {foreignConfirmed ? (
                        <Icon
                          name="checkmark"
                          forceIonicons
                          size={IconSize.sm}
                          color={colors.warning}
                        />
                      ) : null}
                    </View>
                    <Typography variant="body" style={styles.rowLabel} accessible={false}>
                      {`I understand — restore it into ${restoreTargetName} anyway`}
                    </Typography>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.restoreActions}>
                <GradientButton
                  title={
                    archiveCoversEveryHome && targetsEveryHome
                      ? 'Verify & restore every home'
                      : `Verify & restore into ${restoreTargetName}`
                  }
                  disabled={isRestoring || (isForeign && !foreignConfirmed)}
                  fullWidth
                  onPress={runRestore}
                  testID="house-backup-restore-confirm"
                />
                {!isRestoring ? (
                  <Pressable
                    onPress={() => {
                      setPendingRestore(null);
                      setRestorePhraseDraft('');
                      setRestorePhraseSource('none');
                      setForeignConfirmed(false);
                    }}
                    style={styles.restoreCancel}
                    accessibilityRole="button"
                    testID="house-backup-restore-cancel"
                  >
                    <Typography variant="body" color={colors.textSecondary} accessible={false}>
                      Cancel
                    </Typography>
                  </Pressable>
                ) : null}
              </View>
            </Card>
          ) : null}

          {/* 8 — CSV export: same rows, no encryption, for spreadsheets. */}
          <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
            EXPORT AS A SPREADSHEET
          </Typography>
          <Card style={styles.exportCard}>
            <Typography variant="footnote" color={colors.textSecondary}>
              A plain CSV of this home&apos;s rows, one section per list. Readable anywhere — and
              not encrypted, so it is not a backup. It cannot be restored.
            </Typography>
            <Typography variant="caption2" color={colors.textSecondary} testID="house-export-note">
              {/* The CSV is not sectioned the way a backup is — it is one home's
                  rows, from the open home. Saying "switch homes first" under an
                  "All homes" selection would be advice nobody can follow, so
                  that case gets its own sentence. */}
              {isAllHomesTarget(selectedId)
                ? `Unlike a backup, the export covers one home at a time — the one you have open${
                    activeName ? ` (${activeName})` : ''
                  }. Switch homes to export another.`
                : activeId && selectedId && selectedId !== activeId
                  ? `The export always covers the home you have open${
                      activeName ? ` (${activeName})` : ''
                    }, not the one picked above. Switch homes first to export ${selectedName}.`
                  : `Covers ${selectedName} — the home you have open.`}
            </Typography>
            <GradientButton
              title={isBusy ? 'Working…' : 'Export CSV'}
              variant="secondary"
              disabled={isBusy}
              fullWidth
              onPress={() => void handleExportCsv()}
              testID="house-export-csv"
            />

            {exportResult ? (
              <View testID="house-export-result">
                <Typography
                  variant="footnote"
                  color={exportResult.status === 'shared' ? colors.success : colors.warning}
                  testID={`house-export-message-${exportResult.status}`}
                >
                  {exportResult.status === 'unsupported'
                    ? `${exportResult.message} The ${pluralRows(
                        exportResult.rows,
                      )} were ready — nothing is lost, but this device cannot hand the file over.`
                    : exportResult.status === 'failed'
                      ? exportResult.message
                      : `${exportResult.message} (${pluralRows(exportResult.rows)} across this home.)`}
                </Typography>
              </View>
            ) : null}

            {exportError ? (
              <View testID="house-export-error">
                <Typography
                  variant="body"
                  weight="semibold"
                  color={exportError.expected ? colors.warning : colors.error}
                  testID="house-export-error-title"
                >
                  {exportError.title}
                </Typography>
                <Typography
                  variant="footnote"
                  color={colors.textSecondary}
                  testID="house-export-error-message"
                >
                  {exportError.message}
                </Typography>
              </View>
            ) : null}
          </Card>
        </ScrollView>

        <BackupOptionSheet
          visible={destinationSheetOpen}
          title="Save backup to"
          subtitle={`One sealed file for ${selectedName} — a backup saved to one place restores from any other.`}
          options={saveDestinationOptions}
          notes={SAVE_NOTES}
          onSelect={(key) => void handleSaveTo(key as HouseBackupDestination)}
          onClose={() => setDestinationSheetOpen(false)}
          testID="house-backup-destination-sheet"
        />

        <RecoveryPhraseSheet
          visible={phraseSheet != null}
          phrase={phraseSheet?.phrase ?? ''}
          intro={phraseSheet?.intro}
          savedTo={phraseSheet?.savedTo ?? null}
          app={HOUSE_RECOVERY_PHRASE_APP}
          locationEyebrow="YOUR HOME — SAVED TO"
          locationTestIDPrefix="house-backup-location"
          locationContents="Everything in this home — tasks, spaces, appliances, utilities and projects — sealed in this one file. Photos and documents are listed in it, not stored in it."
          warning="Lose these words and the backup is gone — nobody can open it without them, not even us."
          testIDPrefix="house-recovery-phrase"
          onClose={() => setPhraseSheet(null)}
        />

        <BackupOptionSheet
          visible={frequencySheetOpen}
          title="How often"
          options={frequencyOptions}
          onSelect={(key) => void handleFrequencyPicked(key)}
          onClose={() => setFrequencySheetOpen(false)}
          testID="house-backup-frequency-sheet"
        />

        <BackupOptionSheet
          visible={autoDestinationSheetOpen}
          title="Back up automatically to"
          subtitle="Only places that need no tapping can run on a schedule."
          options={autoDestinationOptions}
          onSelect={(key) => void handleAutoDestinationPicked(key)}
          onClose={() => setAutoDestinationSheetOpen(false)}
          testID="house-backup-auto-destination-sheet"
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
          testID="house-backup-cloud-sheet"
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
          testID="house-backup-drive-account-sheet"
        />

        <CloudFolderPickerSheet
          visible={folderPickerOpen}
          provider="google-drive"
          currentFolderId={driveFolder?.id ?? null}
          testIDPrefix="house-folder"
          onPick={(picked) => void handlePickDriveFolder(picked)}
          onClose={() => setFolderPickerOpen(false)}
        />

        <Modal
          visible={restoreSuccessSummary != null}
          transparent
          animationType="fade"
          onRequestClose={() => setRestoreSuccessSummary(null)}
        >
          <Pressable
            style={[styles.modalBackdrop, { backgroundColor: hexToRgba(colors.black, 0.45) }]}
            onPress={() => setRestoreSuccessSummary(null)}
          >
            <Pressable
              style={[styles.modalCard, { backgroundColor: colors.cardBackground }]}
              onPress={(e) => e.stopPropagation()}
              accessible={false}
              testID="house-backup-restore-success-modal"
            >
              <Typography variant="title2" weight="semibold" style={styles.modalTitle}>
                {restoredHomeCount > 1 ? `Restored ${restoredHomeCount} homes` : 'Restored'}
              </Typography>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={styles.modalList}
                showsVerticalScrollIndicator={false}
              >
                {/*
                  Which homes came back, before the row counts.

                  A file that held three homes and could place two is a partial
                  success, and the only presentation of it that is not a lie
                  names the third. It sits ABOVE the totals because it changes
                  what those totals mean.
                */}
                {(restoreSuccessSummary?.households ?? []).length > 1
                  ? restoreSuccessSummary!.households.map((home) => {
                      const ok = home.status === 'restored';
                      return (
                        <View
                          key={home.householdId}
                          style={styles.modalRow}
                          testID={`house-backup-restore-home-${home.householdId}`}
                        >
                          <Icon
                            name={ok ? 'home' : 'alert-circle-outline'}
                            forceIonicons
                            size={20}
                            color={ok ? colors.primary : colors.warning}
                          />
                          <Typography
                            variant="body"
                            color={ok ? undefined : colors.warning}
                            accessible={false}
                          >
                            {ok
                              ? `${home.propertyName} — ${pluralRows(home.summary?.totalRows ?? 0)}`
                              : `${home.propertyName} — not restored`}
                          </Typography>
                        </View>
                      );
                    })
                  : null}
                {restoredRows.map((row) => (
                  <View key={row.table} style={styles.modalRow}>
                    <Icon name="checkmark-circle" forceIonicons size={20} color={colors.primary} />
                    <Typography variant="body" accessible={false}>
                      {formatCount(row.count)} {row.label.toLowerCase()}
                    </Typography>
                  </View>
                ))}
              </ScrollView>
              {restoreSuccessSummary ? (
                <Typography
                  variant="caption2"
                  color={colors.textSecondary}
                  style={styles.modalNote}
                  testID="house-backup-restore-success-note"
                >
                  {`${
                    restoredHomeCount > 1
                      ? 'These are the totals across the homes that came back'
                      : "These are this home's totals now"
                  }, after the merge — newer live values and anything you had deleted were kept.${
                    restoreMissedHomes.length > 0
                      ? ` ${restoreMissedHomes[0].message}`
                      : ''
                  } ${blobManifestSentence(
                    restoreSuccessSummary.summary.blobManifest.length,
                    totalBlobBytes(restoreSuccessSummary.summary.blobManifest),
                  )}`}
                </Typography>
              ) : null}
              <GradientButton
                title="OK"
                fullWidth
                onPress={() => setRestoreSuccessSummary(null)}
                testID="house-backup-restore-success-ok"
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
  {
    label: 'Photos and documents',
    text: 'Listed in the file, not stored in it — they come back from this home’s cloud storage.',
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
    marginTop: Spacing.lg,
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
  // Same row metrics as every other Symply CTA row so the buttons line up with
  // the rest of the app rather than inventing a second button shape.
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
  noticeCard: { padding: Spacing.base, gap: Spacing.xs, borderWidth: 1 },
  emptyCard: { padding: Spacing.lg },
  emptyText: { textAlign: 'center' },
  restorePanel: { marginTop: Spacing.lg, padding: Spacing.base, gap: Spacing.sm },
  restoreActions: { marginTop: Spacing.sm, gap: Spacing.xs },
  restoreCancel: { alignItems: 'center', paddingVertical: Spacing.sm },
  foreignBox: {
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    padding: Spacing.base,
    gap: Spacing.xs,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.sm,
    minHeight: 44,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: CornerRadius.xs,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportCard: { padding: Spacing.base, gap: Spacing.md },
  modalBackdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.xl },
  modalCard: { borderRadius: CornerRadius.xl, padding: Spacing.lg, maxHeight: '80%' },
  modalTitle: { textAlign: 'center', marginBottom: Spacing.md },
  modalList: { maxHeight: 320, marginBottom: Spacing.md },
  modalRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 4 },
  modalNote: { marginBottom: Spacing.md },
});

export default HouseBackupScreen;
