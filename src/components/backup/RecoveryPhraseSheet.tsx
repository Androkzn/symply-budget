import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { BackupLocationCard } from '@components/backup/BackupLocationCard';
import {
  CloudFolderPickerSheet,
  type PickedCloudFolder,
} from '@components/backup/CloudFolderPickerSheet';
import { BottomSheet, Button, GradientButton, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import type { BackupLocation } from '@services/backup/backupFileAccess';
import {
  exportRecoveryPhraseFile,
  getRecoveryPhraseFolder,
  recoveryPhraseWords,
  rememberRecoveryPhraseFolder,
  type RecoveryPhraseDestination,
  type RecoveryPhraseFileApp,
} from '@services/backup/recoveryPhraseFile';
import {
  cloudFolderAccess,
  cloudProviderSupportsFolderPicking,
  describeCloudFolder,
  isCloudProviderConfigured,
  type RememberedCloudFolder,
} from '@services/cloud-storage/backupProviders';
import { CornerRadius, IconSize, Spacing, hexToRgba, useAppColors } from '@theme';

const BUDGET_APP: RecoveryPhraseFileApp = {
  label: 'Symply Budget',
  slug: 'symply-budget',
  contents: 'your budget',
};

/** The only provider either app files a phrase with today. */
const PHRASE_PROVIDER = 'google-drive' as const;

interface Props {
  visible: boolean;
  /** The 12 words. Empty while the phrase is still being fetched. */
  phrase: string;
  /** Why the sheet opened — one line above the words. */
  intro?: string;
  /**
   * Where the backup that minted this phrase landed. Rendered above the intro
   * as a card with its own Open button, because "where is my file" and "write
   * these words down" are two separate jobs and used to share one paragraph.
   * Null when the sheet was opened to re-read a stored phrase, where no file
   * was just written.
   */
  savedTo?: BackupLocation | null;
  /** Names the app in the exported .txt. Defaults to Budget, its first caller. */
  app?: RecoveryPhraseFileApp;
  /** Eyebrow + contents line for the location card, when one is shown. */
  locationEyebrow?: string;
  locationContents?: string;
  /**
   * testID prefix for that card. Separate from `testIDPrefix` because the card
   * is a different surface with its own ids — `house-backup-location-where` is
   * not a recovery-phrase id, and a flow asserting it should not have to know
   * which sheet happened to render it.
   */
  locationTestIDPrefix?: string;
  /** The sentence under the grid — what losing the words costs. */
  warning?: string;
  /** `budget-recovery-phrase` / `house-recovery-phrase`; drives every testID. */
  testIDPrefix?: string;
  onClose: () => void;
}

/**
 * The recovery phrase, shown properly. Shared by Budget and House.
 *
 * It used to arrive as a system `Alert` with the twelve words run together in
 * the body, and the app copied them to the clipboard on the user's behalf. Both
 * halves were wrong:
 *
 *  - A wrapped wall of lowercase words is the hardest possible thing to
 *    transcribe, and transcribing is exactly what this screen is asking for.
 *    The words are numbered here, one per cell, so a pen can follow them.
 *  - Copying silently is a decision the user never made. The clipboard is
 *    readable by other apps and is overwritten by the next copy, so it is a
 *    place a phrase passes through, not one it should be put in by surprise.
 *    Copy is now a button, next to a "Save as .txt" that puts the phrase
 *    somewhere that outlives this phone.
 *
 * The action row follows what the app can actually do. An app whose
 * `app.destinations` is set (Budget and House both, now) offers the three
 * places a backup can go — Drive, this device, the share sheet — and a row
 * naming the Drive folder, with no Copy: the share sheet already offers Copy,
 * and a second button for it competed with the three that put the phrase
 * somewhere durable. An app without them falls back to Copy + "Save as .txt",
 * which is the share sheet under another name. The sheet asks the app rather
 * than taking a flag so the buttons can never promise a destination the writer
 * would answer `unsupported` for — which is exactly what House did while it
 * shipped without destinations.
 */
export function RecoveryPhraseSheet({
  visible,
  phrase,
  intro,
  savedTo,
  app = BUDGET_APP,
  locationEyebrow,
  locationContents,
  locationTestIDPrefix,
  warning = 'Lose these words and the backup is gone — nobody can open it without them, not even us.',
  testIDPrefix = 'budget-recovery-phrase',
  onClose,
}: Props) {
  const colors = useAppColors();
  const [copied, setCopied] = useState(false);
  /** Which destination is in flight, so only its own button says so. */
  const [saving, setSaving] = useState<RecoveryPhraseDestination | null>(null);
  /** The member's chosen cloud folder for the phrase; null means the default. */
  const [driveFolder, setDriveFolder] = useState<RememberedCloudFolder | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  /** False until the provider is authorised with a scope wide enough to browse. */
  const [canPickFolder, setCanPickFolder] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const words = recoveryPhraseWords(phrase);

  const destinations = app.destinations;
  // Drive is hidden rather than disabled in a build with no Drive credentials:
  // an always-failing button is worse than one destination fewer.
  const canUseDrive = destinations != null && isCloudProviderConfigured(PHRASE_PROVIDER);

  const clearCopiedTimer = () => {
    if (copiedTimer.current) {
      clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    }
  };

  useEffect(() => clearCopiedTimer, []);

  // Each opening starts from "not copied" — a stale ✓ would claim a copy that
  // belongs to a previous phrase. A close that lands mid-save must likewise not
  // leave the next opening spinning for a run that belongs to a phrase already
  // gone.
  useEffect(() => {
    if (!visible) {
      clearCopiedTimer();
      setCopied(false);
      setSaving(null);
      setFolderPickerOpen(false);
    }
  }, [visible]);

  /*
   * Read the pointer on every opening rather than once on mount: the sheet
   * outlives any single phrase, and the folder can change from the picker below
   * or be dropped underneath us when the provider says it is gone.
   */
  useEffect(() => {
    if (!visible || !canUseDrive) return;
    let alive = true;
    void (async () => {
      const [folder, access] = await Promise.all([
        getRecoveryPhraseFolder(app),
        cloudFolderAccess(PHRASE_PROVIDER),
      ]);
      if (!alive) return;
      setDriveFolder(folder);
      // Browsing needs a wider grant than uploading. Offering "change folder"
      // to an account that cannot list them ends in a picker full of nothing.
      setCanPickFolder(access === 'ready' && cloudProviderSupportsFolderPicking(PHRASE_PROVIDER));
    })();
    return () => {
      alive = false;
    };
  }, [visible, canUseDrive, app]);

  /** Choosing a folder is the whole point — remember it, and say so from now on. */
  const handlePickFolder = useCallback(
    async (picked: PickedCloudFolder) => {
      setFolderPickerOpen(false);
      const folder: RememberedCloudFolder = {
        id: picked.id,
        name: picked.name,
        path: picked.path,
        source: 'picked',
      };
      setDriveFolder(folder);
      await rememberRecoveryPhraseFolder(app, folder);
    },
    [app],
  );

  const handleCopy = useCallback(async () => {
    const text = words.join(' ');
    if (!text) return;
    try {
      await Clipboard.setStringAsync(text);
    } catch {
      Alert.alert('Recovery phrase', 'Could not copy the phrase. Write the words down instead.');
      return;
    }
    setCopied(true);
    clearCopiedTimer();
    copiedTimer.current = setTimeout(() => setCopied(false), 2500);
  }, [words]);

  /**
   * Save the phrase to one of the places it can go.
   *
   * Every outcome except a share handoff is reported: a share sheet tells us
   * nothing about what the member did with the file, so announcing anything
   * would be a guess, while "saved to Drive" and every failure are facts worth
   * saying out loud — this is the one moment these words exist.
   */
  const handleSaveTo = useCallback(
    async (destination: RecoveryPhraseDestination) => {
      if (words.length === 0 || saving) return;
      setSaving(destination);
      try {
        const result = await exportRecoveryPhraseFile(words.join(' '), app, destination);
        if (result.status === 'cancelled' || result.status === 'shared') return;
        Alert.alert('Recovery phrase', result.message);
      } finally {
        setSaving(null);
      }
    },
    [words, saving, app],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Your recovery phrase"
      height="content"
      showCloseButton
    >
      <View style={styles.body} testID={`${testIDPrefix}-sheet`}>
        {savedTo ? (
          <BackupLocationCard
            location={savedTo}
            {...(locationEyebrow ? { eyebrow: locationEyebrow } : {})}
            {...(locationContents ? { contents: locationContents } : {})}
            {...(locationTestIDPrefix ? { testIDPrefix: locationTestIDPrefix } : {})}
          />
        ) : null}

        <Typography variant="caption1" color={colors.textSecondary}>
          {intro ??
            `These words open every backup you make. Write them down somewhere safe — anyone who has them can read ${app.contents}.`}
        </Typography>

        {/* Each word is its own accessible node, carrying its position: a
            screen reader user transcribing this needs to land on "Word 7,
            industry" and stay there, not re-hear all twelve to find their
            place. Grouping the grid into one node would also hide the cells
            from the accessibility tree the E2E runner drives. */}
        <View
          style={[
            styles.grid,
            { backgroundColor: hexToRgba(colors.primary, 0.06), borderColor: colors.borderColor },
          ]}
          testID={`${testIDPrefix}-words`}
        >
          {words.map((word, index) => (
            <View
              key={`${index}-${word}`}
              style={styles.cell}
              accessible
              accessibilityLabel={`Word ${index + 1}: ${word}`}
              testID={`${testIDPrefix}-word-${index + 1}`}
            >
              <Typography
                variant="caption2"
                color={colors.textTertiary}
                style={styles.index}
                accessible={false}
              >
                {index + 1}
              </Typography>
              <Typography
                variant="bodyLarge"
                weight="semibold"
                style={styles.word}
                accessible={false}
              >
                {word}
              </Typography>
            </View>
          ))}
        </View>

        <View style={styles.warning}>
          <Icon
            name="alert-circle-outline"
            forceIonicons
            size={IconSize.md}
            color={colors.warning}
          />
          <Typography variant="caption2" color={colors.textSecondary} style={styles.warningText}>
            {warning}
          </Typography>
        </View>

        {destinations ? (
          <View style={styles.actions}>
            {canUseDrive ? (
              <Button
                title={saving === PHRASE_PROVIDER ? 'Saving…' : 'Drive'}
                variant="outline"
                size="sm"
                disabled={saving != null}
                style={styles.action}
                leftIcon={
                  <Icon
                    name="cloud-upload-outline"
                    forceIonicons
                    size={IconSize.sm}
                    color={colors.primary}
                  />
                }
                onPress={() => void handleSaveTo(PHRASE_PROVIDER)}
                testID={`${testIDPrefix}-save-drive`}
              />
            ) : null}
            <Button
              title={saving === 'device' ? 'Saving…' : 'Device'}
              variant="outline"
              size="sm"
              disabled={saving != null}
              style={styles.action}
              leftIcon={
                <Icon
                  name="phone-portrait-outline"
                  forceIonicons
                  size={IconSize.sm}
                  color={colors.primary}
                />
              }
              onPress={() => void handleSaveTo('device')}
              testID={`${testIDPrefix}-save-device`}
            />
            <Button
              title="Share"
              variant="outline"
              size="sm"
              disabled={saving != null}
              style={styles.action}
              leftIcon={
                <Icon name="share-outline" forceIonicons size={IconSize.sm} color={colors.primary} />
              }
              onPress={() => void handleSaveTo('share')}
              testID={`${testIDPrefix}-share`}
            />
          </View>
        ) : (
          <View style={styles.actions}>
            <Button
              title={copied ? 'Copied' : 'Copy'}
              variant="outline"
              size="sm"
              style={styles.action}
              leftIcon={
                <Icon
                  name={copied ? 'checkmark' : 'copy-outline'}
                  forceIonicons
                  size={IconSize.sm}
                  color={copied ? colors.success : colors.primary}
                />
              }
              onPress={() => void handleCopy()}
              testID={`${testIDPrefix}-copy`}
            />
            <Button
              title={saving ? 'Saving…' : 'Save as .txt'}
              variant="outline"
              size="sm"
              disabled={saving != null}
              style={styles.action}
              leftIcon={
                <Icon
                  name="document-text-outline"
                  forceIonicons
                  size={IconSize.sm}
                  color={colors.primary}
                />
              }
              onPress={() => void handleSaveTo('share')}
              testID={`${testIDPrefix}-save-file`}
            />
          </View>
        )}

        {/* Where Drive will put it, and the way to change that. Stated rather
            than left to be discovered after the fact: "Saved to Google Drive"
            is only reassuring if you know which folder it means. */}
        {destinations && canUseDrive && canPickFolder ? (
          <Pressable
            onPress={() => setFolderPickerOpen(true)}
            disabled={saving != null}
            style={styles.folderRow}
            hitSlop={Spacing.xs}
            accessibilityRole="button"
            accessibilityLabel={`Drive folder: ${
              driveFolder ? describeCloudFolder(driveFolder) : destinations.defaultFolderName
            }. Tap to change.`}
            testID={`${testIDPrefix}-folder-row`}
          >
            <Icon name="folder-outline" forceIonicons size={IconSize.sm} color={colors.textTertiary} />
            <Typography
              variant="caption2"
              color={colors.textSecondary}
              style={styles.folderText}
              numberOfLines={1}
              accessible={false}
            >
              Drive folder ·{' '}
              {driveFolder ? describeCloudFolder(driveFolder) : destinations.defaultFolderName}
            </Typography>
            <Typography variant="caption2" color={colors.primary} accessible={false}>
              Change
            </Typography>
          </Pressable>
        ) : null}

        <GradientButton
          title="Done"
          fullWidth
          onPress={onClose}
          testID={`${testIDPrefix}-done`}
        />
      </View>

      {/* Nested inside the sheet's own Modal rather than beside it: two sibling
          Modals presented at once is the arrangement iOS handles worst, and the
          picker has to open over a sheet that stays put behind it. */}
      {destinations && canUseDrive ? (
        <CloudFolderPickerSheet
          visible={folderPickerOpen}
          provider={PHRASE_PROVIDER}
          currentFolderId={driveFolder?.id ?? null}
          // Same sheet the backups use, saying what it is choosing here — a
          // picker headed "Backup folder" over the phrase sheet reads as if it
          // were about to move the archives.
          title="Recovery phrase folder"
          subject="the phrase"
          testIDPrefix={`${testIDPrefix}-folder`}
          onPick={(picked) => void handlePickFolder(picked)}
          onClose={() => setFolderPickerOpen(false)}
        />
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.base, paddingBottom: Spacing.lg },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: CornerRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  cell: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  index: { minWidth: 18, textAlign: 'right' },
  word: { flex: 1 },
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  warningText: { flex: 1 },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1 },
  folderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  /** Takes the slack so a long trail truncates instead of pushing "Change" off. */
  folderText: { flex: 1 },
});
