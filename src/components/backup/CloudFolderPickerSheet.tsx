import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, TextInput, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import {
  cloudFolderAccess,
  cloudProviderLabel,
  createCloudFolder,
  listCloudFolders,
  reconnectCloudProvider,
  type BackupCloudProvider,
} from '@services/cloud-storage/backupProviders';
import { CloudReauthRequiredError } from '@services/cloud-storage/types';
import { ButtonMetrics, CornerRadius, IconSize, Spacing, hexToRgba, useAppColors } from '@theme';

/** What the member chose. `path` excludes the account root — see `describeCloudFolder`. */
export type PickedCloudFolder = { id: string; name: string; path: string[] };

type Props = {
  visible: boolean;
  provider: BackupCloudProvider;
  /** Folder id currently in use, so the row for it can say so. */
  currentFolderId?: string | null;
  /**
   * `budget-folder` / `house-folder` — drives every testID in the sheet.
   *
   * Defaults to Budget's, which is what the component shipped with and what the
   * Budget Maestro flows already drive; House passes its own so the two apps'
   * flows never assert against each other's tree.
   */
  testIDPrefix?: string;
  /**
   * Sheet heading. Defaults to the backups' own, since that is what this picker
   * was built for; the recovery phrase picks its folder through the same sheet
   * and has to say which folder it is choosing.
   */
  title?: string;
  /**
   * What is being filed, in the words the confirm button and the empty state
   * use: "Save {subject} in …". Keep it a noun phrase that reads after "Save".
   */
  subject?: string;
  onPick: (folder: PickedCloudFolder) => void;
  onClose: () => void;
};

/**
 * One level of the tree. `id: null` is the account root, which has no id of its
 * own — the provider is asked for "the root's children" by omission.
 */
type Level = { id: string | null; name: string };

/**
 * Every provider's root reads as this; only Drive has a browsable one today.
 *
 * `id: null` browses it (the provider infers the root from an omitted parent),
 * but choosing it has to store something a later `folderExists` can probe —
 * hence `ROOT_FOLDER_ID`, Drive's own alias for My Drive.
 */
const ROOT_LEVEL: Level = { id: null, name: 'My Drive' };
const ROOT_FOLDER_ID = 'root';

/**
 * How many folders a level needs before the filter field appears.
 *
 * Below this they are all on screen at once and scanning beats typing, so the
 * field would only cost a row of height in a card that is already capped at
 * 82% of the screen. A Drive root with thirty folders is the case this is for.
 */
const FILTER_MIN_FOLDERS = 6;

/**
 * Browse a cloud account's folders and choose where backups land.
 *
 * Built as a drill-down rather than a flat list because the folder people want
 * is rarely at the root — it is two or three levels into a structure they
 * already keep. The trail across the top is both the breadcrumb and the way
 * back up: tapping an ancestor returns to it, which is the gesture a "‹ Back"
 * button only half provides once you are four levels deep.
 *
 * Nothing is chosen by drilling in. "Save backups here" is a separate, explicit
 * action on the folder you are *standing in*, so opening a folder to look
 * inside it can never be mistaken for selecting it.
 */
export function CloudFolderPickerSheet({
  visible,
  provider,
  currentFolderId,
  testIDPrefix = 'budget-folder',
  title = 'Backup folder',
  subject = 'backups',
  onPick,
  onClose,
}: Props) {
  const colors = useAppColors();
  const label = cloudProviderLabel(provider);
  // The card is centred in a raw `Modal`, and its two fields (the level filter
  // and "Folder name") sit at the bottom of it — an open keyboard landed on top
  // of the very field that summoned it, and on the Create button beside it.
  // Padding the backdrop re-centres the card in what is LEFT above the keyboard
  // and, because `maxHeight: '82%'` resolves against the backdrop's content box,
  // shrinks the ceiling by the same amount so a tall level cannot run off the
  // top instead. See `@hooks/useKeyboardInset`.
  const keyboardInset = useKeyboardInset();

  const [trail, setTrail] = useState<Level[]>([ROOT_LEVEL]);
  const [folders, setFolders] = useState<Level[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the fix is a reconnect rather than a retry — see `cloudFolderAccess`. */
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * Filters the level you are standing in — not the whole account.
   *
   * Deliberately client-side over `folders`: that array is already the complete
   * contents of this level, so typing narrows it with no round trip and no
   * spinner. A provider-wide search would be a different feature with a
   * different promise (it would return matches from folders you are not in),
   * and mixing the two in one field is how a picker starts lying about where
   * the thing it found actually lives. The placeholder names the level for
   * exactly that reason.
   */
  const [query, setQuery] = useState('');

  const trailRef = useRef<ScrollView>(null);

  const here = trail[trail.length - 1];
  /** The trail below the account root — what gets stored and displayed. */
  const pathBelowRoot = useMemo(() => trail.slice(1).map((level) => level.name), [trail]);

  const trimmedQuery = query.trim();
  const visibleFolders = useMemo(() => {
    if (!trimmedQuery) return folders;
    const needle = trimmedQuery.toLowerCase();
    return folders.filter((folder) => folder.name.toLowerCase().includes(needle));
  }, [folders, trimmedQuery]);

  const load = useCallback(
    async (level: Level) => {
      setLoading(true);
      setError(null);
      setNeedsReconnect(false);
      try {
        // Checked per level, not once on open: a token can expire mid-browse,
        // and "reconnect" is a different remedy from "try again".
        const access = await cloudFolderAccess(provider);
        if (access !== 'ready') {
          setFolders([]);
          setNeedsReconnect(true);
          setError(
            access === 'signed-out'
              ? `Connect ${label} to choose a folder.`
              : `${label} needs permission to save into your own folders. Reconnect to grant it.`,
          );
          return;
        }
        const listed = await listCloudFolders(provider, level.id ?? undefined);
        setFolders(listed.map((folder) => ({ id: folder.id, name: folder.name })));
      } catch (caught) {
        setFolders([]);
        const reauth = caught instanceof CloudReauthRequiredError;
        setNeedsReconnect(reauth);
        setError(
          reauth
            ? caught.message
            : `Could not read your ${label} folders. Check your connection and try again.`,
        );
      } finally {
        setLoading(false);
      }
    },
    [label, provider],
  );

  // Each opening starts at the root: the trail from last time describes folders
  // that may since have moved, and resuming mid-tree hides where you are.
  useEffect(() => {
    if (!visible) return;
    setTrail([ROOT_LEVEL]);
    setCreating(false);
    setNewFolderName('');
    setQuery('');
    void load(ROOT_LEVEL);
  }, [visible, load]);

  /**
   * Every move through the tree clears the filter and puts the keyboard away.
   *
   * The query goes because it describes names in the level it was typed for;
   * carrying it into the next one silently hides most of what you just opened,
   * which reads as an empty folder. The keyboard goes because the rows are
   * tapped through `keyboardShouldPersistTaps`, so the first tap opens the
   * folder instead of dismissing it — and it would otherwise still be sitting
   * over the confirm button in a level that may not even show the field.
   */
  const leaveLevel = useCallback(() => {
    setCreating(false);
    setQuery('');
    Keyboard.dismiss();
  }, []);

  const openFolder = useCallback(
    (folder: Level) => {
      setTrail((previous) => [...previous, folder]);
      leaveLevel();
      void load(folder);
    },
    [load, leaveLevel],
  );

  /** Tap an ancestor in the trail to go back to it. */
  const goToLevel = useCallback(
    (index: number) => {
      if (index === trail.length - 1) return;
      const next = trail.slice(0, index + 1);
      setTrail(next);
      leaveLevel();
      void load(next[next.length - 1]);
    },
    [trail, load, leaveLevel],
  );

  const handleReconnect = useCallback(async () => {
    setBusy(true);
    try {
      await reconnectCloudProvider(provider);
      await load(here);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '';
      // A cancelled consent screen is a choice, not a failure — leave the sheet
      // exactly as it was rather than shouting at someone who backed out.
      if (!/cancel/i.test(message)) {
        setError(`Could not connect to ${label}. Please try again.`);
      }
    } finally {
      setBusy(false);
    }
  }, [provider, load, here, label]);

  const handleCreate = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const created = await createCloudFolder(provider, name, here.id);
      setNewFolderName('');
      setCreating(false);
      // Step into it: a folder made for this purpose is almost certainly the
      // one being chosen, and this puts "Save backups here" one tap away.
      openFolder({ id: created.id, name: created.name });
    } catch (caught) {
      const reauth = caught instanceof CloudReauthRequiredError;
      setNeedsReconnect(reauth);
      setError(reauth ? caught.message : `Could not create that folder in ${label}.`);
    } finally {
      setBusy(false);
    }
  }, [newFolderName, busy, provider, here.id, openFolder, label]);

  const handleUseHere = useCallback(() => {
    if (!here.id) {
      // The account root itself — allowed, and stored under the provider's own
      // alias for it so the pointer stays probeable like any other folder.
      onPick({ id: ROOT_FOLDER_ID, name: ROOT_LEVEL.name, path: [] });
      return;
    }
    onPick({ id: here.id, name: here.name, path: pathBelowRoot });
  }, [here, pathBelowRoot, onPick]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[
          styles.backdrop,
          { backgroundColor: hexToRgba(colors.black, 0.45) },
          keyboardInset > 0 ? { paddingBottom: keyboardInset } : null,
        ]}
        onPress={onClose}
      >
        <Pressable
          style={[styles.card, { backgroundColor: colors.cardBackground }]}
          onPress={(e) => e.stopPropagation()}
          testID={`${testIDPrefix}-picker`}
          // As in BackupOptionSheet: a parent Pressable marked accessible
          // flattens every row into one node and hides them from VoiceOver and
          // the E2E runner alike.
          accessible={false}
        >
          <Typography variant="title2" weight="semibold" style={styles.title}>
            {title}
          </Typography>

          {/* The trail is the navigation, so it sits above everything that
              changes when you move through it. */}
          <ScrollView
            ref={trailRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.trail}
            contentContainerStyle={styles.trailContent}
            // Keeps the deepest level — where you are — in view once the trail
            // outgrows the card. Driven by content size rather than by `trail`,
            // so the scroll happens after the new crumb has actually been laid
            // out and not a frame before it exists.
            onContentSizeChange={() => trailRef.current?.scrollToEnd({ animated: false })}
          >
            {trail.map((level, index) => (
              <React.Fragment key={`${level.id ?? 'root'}-${index}`}>
                {index > 0 ? (
                  <Icon name="chevron-forward" size={IconSize.sm} color={colors.textTertiary} />
                ) : null}
                <Pressable
                  onPress={() => goToLevel(index)}
                  disabled={index === trail.length - 1}
                  hitSlop={Spacing.xs}
                  accessibilityRole="button"
                  accessibilityLabel={`Go to ${level.name}`}
                  testID={`${testIDPrefix}-crumb-${index}`}
                >
                  <Typography
                    variant="caption1"
                    weight={index === trail.length - 1 ? 'semibold' : 'regular'}
                    color={index === trail.length - 1 ? colors.textPrimary : colors.primary}
                    accessible={false}
                  >
                    {level.name}
                  </Typography>
                </Pressable>
              </React.Fragment>
            ))}
          </ScrollView>

          {error ? (
            <View style={styles.stateBox} testID={`${testIDPrefix}-picker-error`}>
              <View style={[styles.errorIcon, { backgroundColor: hexToRgba(colors.error, 0.12) }]}>
                <Icon
                  name="cloud-offline-outline"
                  forceIonicons
                  size={IconSize.lg}
                  color={colors.error}
                />
              </View>
              <Typography variant="body" color={colors.textSecondary} style={styles.centered}>
                {error}
              </Typography>
              <Button
                title={needsReconnect ? `Reconnect ${label}` : 'Try again'}
                variant="outline"
                disabled={busy}
                onPress={() => void (needsReconnect ? handleReconnect() : load(here))}
                testID={`${testIDPrefix}-picker-retry`}
              />
            </View>
          ) : loading ? (
            <View style={styles.stateBox} testID={`${testIDPrefix}-picker-loading`}>
              <ActivityIndicator />
            </View>
          ) : (
            <>
              {/* Above the list, not inside it: it must stay put while the
                  results it controls scroll under it. */}
              {folders.length >= FILTER_MIN_FOLDERS ? (
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={`Search in ${here.name}`}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  clearButtonMode="never"
                  containerStyle={styles.searchInput}
                  accessibilityLabel={`Search folders in ${here.name}`}
                  leftIcon={
                    <Icon name="search" forceIonicons size={IconSize.sm} color={colors.textTertiary} />
                  }
                  // Own button rather than `clearButtonMode`, which iOS draws
                  // only while the field has focus — the one moment you do not
                  // need it. This one is reachable after the keyboard is gone.
                  rightIcon={
                    trimmedQuery ? (
                      <Pressable
                        onPress={() => setQuery('')}
                        hitSlop={Spacing.sm}
                        accessibilityRole="button"
                        accessibilityLabel="Clear search"
                        testID={`${testIDPrefix}-search-clear`}
                      >
                        <Icon
                          name="close-circle"
                          forceIonicons
                          size={IconSize.sm}
                          color={colors.textTertiary}
                        />
                      </Pressable>
                    ) : undefined
                  }
                  testID={`${testIDPrefix}-search`}
                />
              ) : null}

              <ScrollView
                style={styles.list}
                contentContainerStyle={styles.listContent}
                // The list is under a text field now: a tap on a folder row must
                // spend itself opening that folder, not dismissing the keyboard.
                keyboardShouldPersistTaps="handled"
              >
              {folders.length === 0 ? (
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  style={styles.centered}
                  testID={`${testIDPrefix}-picker-empty`}
                >
                  No folders in here. You can still save {subject} to this one, or make a new
                  folder.
                </Typography>
              ) : visibleFolders.length === 0 ? (
                // A filtered-to-nothing level is NOT the empty state above:
                // this folder has contents, they just do not match. Saying
                // "no folders in here" would be false and would push someone
                // toward making a duplicate of a folder that already exists.
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  style={styles.centered}
                  testID={`${testIDPrefix}-picker-no-matches`}
                >
                  Nothing in {here.name} matches “{trimmedQuery}”.
                </Typography>
              ) : (
                visibleFolders.map((folder) => (
                  <Pressable
                    key={folder.id ?? folder.name}
                    onPress={() => openFolder(folder)}
                    style={[styles.row, { backgroundColor: hexToRgba(colors.primary, 0.08) }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${folder.name}`}
                    testID={`${testIDPrefix}-row-${folder.name}`}
                  >
                    <View
                      style={[styles.rowIcon, { backgroundColor: hexToRgba(colors.primary, 0.14) }]}
                    >
                      <Icon
                        name="folder-outline"
                        forceIonicons
                        size={IconSize.md}
                        color={colors.primary}
                      />
                    </View>
                    <View style={styles.rowText}>
                      <Typography variant="body" weight="medium" accessible={false}>
                        {folder.name}
                      </Typography>
                      {folder.id === currentFolderId ? (
                        // Named by subject: over the phrase picker, "Backups go
                        // here now" would point at the wrong file entirely.
                        <Typography variant="caption2" color={colors.primary} accessible={false}>
                          {subject === 'backups' ? 'Backups go here now' : `Where ${subject} goes now`}
                        </Typography>
                      ) : null}
                    </View>
                    <Icon name="chevron-forward" size={IconSize.sm} color={colors.textSecondary} />
                  </Pressable>
                ))
              )}
              </ScrollView>
            </>
          )}

          {!error && !loading ? (
            <View style={styles.footer}>
              {creating ? (
                <View style={styles.createRow}>
                  <TextInput
                    value={newFolderName}
                    onChangeText={setNewFolderName}
                    placeholder="Folder name"
                    autoFocus
                    containerStyle={styles.createInput}
                    testID={`${testIDPrefix}-new-name`}
                  />
                  <Button
                    title="Create"
                    size="sm"
                    disabled={!newFolderName.trim() || busy}
                    onPress={() => void handleCreate()}
                    testID={`${testIDPrefix}-new-create`}
                  />
                </View>
              ) : (
                <Pressable
                  onPress={() => setCreating(true)}
                  style={styles.newFolder}
                  hitSlop={Spacing.xs}
                  accessibilityRole="button"
                  accessibilityLabel="New folder"
                  testID={`${testIDPrefix}-new`}
                >
                  <Icon
                    name="add-circle-outline"
                    forceIonicons
                    size={IconSize.sm}
                    color={colors.primary}
                  />
                  <Typography variant="body" color={colors.primary} accessible={false}>
                    New folder
                  </Typography>
                </Pressable>
              )}

              <Button
                title={
                  here.id
                    ? `Save ${subject} in “${here.name}”`
                    : `Save ${subject} in ${ROOT_LEVEL.name}`
                }
                fullWidth
                disabled={busy}
                onPress={handleUseHere}
                testID={`${testIDPrefix}-use-here`}
              />
            </View>
          ) : null}

          <Pressable
            onPress={onClose}
            style={styles.cancel}
            accessibilityRole="button"
            testID={`${testIDPrefix}-picker-cancel`}
          >
            <Typography variant="body" color={colors.textSecondary} accessible={false}>
              Cancel
            </Typography>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.xl },
  card: { borderRadius: CornerRadius.xl, padding: Spacing.lg, maxHeight: '82%' },
  title: { textAlign: 'center', marginBottom: Spacing.xs },
  // `flexGrow: 0` or the horizontal trail claims the whole card height.
  trail: { flexGrow: 0, marginBottom: Spacing.sm },
  trailContent: { alignItems: 'center', gap: Spacing.xxs },
  // Overrides TextInput's own form-field bottom margin: this one sits directly
  // above the list it filters, and a form-sized gap reads as a break between
  // the two rather than a label for what follows.
  searchInput: { marginBottom: Spacing.sm },
  list: { maxHeight: 320 },
  listContent: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  stateBox: { paddingVertical: Spacing.lg, alignItems: 'center', gap: Spacing.md },
  errorIcon: {
    width: Spacing.xxl,
    height: Spacing.xxl,
    borderRadius: Spacing.xxl / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: { textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.smd,
    padding: Spacing.md,
    borderRadius: CornerRadius.lg,
  },
  rowIcon: {
    width: Spacing.xxl,
    height: Spacing.xxl,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  footer: { marginTop: Spacing.md, gap: Spacing.sm },
  newFolder: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    minHeight: ButtonMetrics.minTapTarget,
  },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  createInput: { flex: 1, marginBottom: 0 },
  cancel: { marginTop: Spacing.sm, alignItems: 'center', paddingVertical: Spacing.sm },
});
