import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { ButtonMetrics, CornerRadius, IconSize, Spacing, hexToRgba, useAppColors } from '@theme';

export type BackupOption = {
  key: string;
  label: string;
  description?: string;
  /** Ionicons glyph — rendered with forceIonicons so it bypasses the brand kit. */
  icon: string;
  disabled?: boolean;
  /** Show a trash affordance on this row (requires `onDelete`). */
  deletable?: boolean;
  testID?: string;
};

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  options: BackupOption[];
  /** Shown in place of the list while options are still being fetched. */
  loading?: boolean;
  /** Shown when `options` is empty and not loading. */
  emptyMessage?: string;
  /**
   * The list could not be read. Distinct from `emptyMessage`: "nothing here" is
   * an answer, "we couldn't look" is a failure the member can act on — so it
   * gets its own icon, drops the list subtitle (there is no list to describe),
   * and pairs with `onRetry`.
   */
  error?: string;
  /** Retry affordance for `error` — omitted, the sheet just explains. */
  onRetry?: () => void;
  /** Verb for the retry button. Defaults to the generic "Try again". */
  retryLabel?: string;
  onSelect: (key: string) => void;
  /** Enables the trash affordance on rows flagged `deletable`. */
  onDelete?: (key: string) => void;
  /**
   * Explanatory rows shown under the options — what each place actually means
   * for the backup (does it survive losing the phone, who can reach it).
   * Rendered inside the scroll area so long lists stay fully reachable.
   */
  notes?: { label: string; text: string }[];
  onClose: () => void;
  testID?: string;
};

/**
 * Option list used by the backup flows — picking where to save an archive,
 * where to restore one from, and which archive in that location. Shared by
 * Budget and House; it holds no app state, only what the caller hands it.
 *
 * A plain in-app Modal rather than Alert buttons: iOS caps an Alert at three
 * actions, native alerts here have repeatedly left an invisible tap shield on
 * device (see the restore notes in BudgetSettingsScreen), and the list needs to
 * scroll once a device or Drive folder holds many archives.
 */
export function BackupOptionSheet({
  visible,
  title,
  subtitle,
  options,
  loading = false,
  emptyMessage,
  onSelect,
  onDelete,
  notes,
  error,
  onRetry,
  retryLabel = 'Try again',
  onClose,
  testID,
}: Props) {
  const colors = useAppColors();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: hexToRgba(colors.black, 0.45) }]}
        onPress={onClose}
      >
        <Pressable
          style={[styles.card, { backgroundColor: colors.cardBackground }]}
          onPress={(e) => e.stopPropagation()}
          testID={testID}
          // Keep the card itself non-accessible so option rows expose their own
          // testIDs to Maestro / VoiceOver (a parent Pressable otherwise flattens
          // the whole sheet into one node — only Cancel was reachable).
          accessible={false}
        >
          <Typography variant="title2" weight="semibold" style={styles.title}>
            {title}
          </Typography>
          {/* A subtitle describes the LIST ("Newest first."). With no list to
              describe it is just noise above an error, so it steps aside. */}
          {subtitle && !error ? (
            <Typography variant="caption1" color={colors.textSecondary} style={styles.subtitle}>
              {subtitle}
            </Typography>
          ) : null}

          {error ? (
            <View style={styles.errorBox} testID={testID ? `${testID}-error` : undefined}>
              <View style={[styles.errorIcon, { backgroundColor: hexToRgba(colors.error, 0.12) }]}>
                <Icon
                  name="cloud-offline-outline"
                  forceIonicons
                  size={IconSize.lg}
                  color={colors.error}
                />
              </View>
              <Typography variant="body" color={colors.textSecondary} style={styles.errorText}>
                {error}
              </Typography>
              {onRetry ? (
                <Pressable
                  onPress={onRetry}
                  style={[styles.retry, { borderColor: colors.primary }]}
                  accessibilityRole="button"
                  accessibilityLabel={retryLabel}
                  testID={testID ? `${testID}-retry` : undefined}
                >
                  <Icon
                    name="refresh-outline"
                    forceIonicons
                    size={IconSize.sm}
                    color={colors.primary}
                  />
                  <Typography
                    variant="body"
                    weight="semibold"
                    color={colors.primary}
                    accessible={false}
                  >
                    {retryLabel}
                  </Typography>
                </Pressable>
              ) : null}
            </View>
          ) : loading ? (
            <View style={styles.stateBox} testID={testID ? `${testID}-loading` : undefined}>
              <ActivityIndicator />
            </View>
          ) : options.length === 0 ? (
            <View style={styles.stateBox} testID={testID ? `${testID}-empty` : undefined}>
              <Typography variant="body" color={colors.textSecondary} style={styles.emptyText}>
                {emptyMessage ?? 'Nothing here yet.'}
              </Typography>
            </View>
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              {options.map((option) => (
                <Pressable
                  key={option.key}
                  disabled={option.disabled}
                  onPress={() => onSelect(option.key)}
                  style={[
                    styles.row,
                    {
                      backgroundColor: hexToRgba(colors.primary, 0.08),
                      opacity: option.disabled ? 0.4 : 1,
                    },
                  ]}
                  testID={option.testID}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                >
                  <View
                    style={[styles.rowIcon, { backgroundColor: hexToRgba(colors.primary, 0.14) }]}
                  >
                    <Icon
                      name={option.icon}
                      forceIonicons
                      size={IconSize.md}
                      color={colors.primary}
                    />
                  </View>
                  <View style={styles.rowText}>
                    <Typography variant="body" weight="medium" accessible={false}>
                      {option.label}
                    </Typography>
                    {option.description ? (
                      <Typography variant="caption2" color={colors.textSecondary} accessible={false}>
                        {option.description}
                      </Typography>
                    ) : null}
                  </View>
                  {onDelete && option.deletable ? (
                    <Pressable
                      onPress={() => onDelete(option.key)}
                      hitSlop={Spacing.sm}
                      testID={option.testID ? `${option.testID}-delete` : undefined}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${option.label}`}
                    >
                      <Icon
                        name="trash-outline"
                        forceIonicons
                        size={IconSize.md}
                        color={colors.textSecondary}
                      />
                    </Pressable>
                  ) : (
                    <Icon name="chevron-forward" size={IconSize.sm} color={colors.textSecondary} />
                  )}
                </Pressable>
              ))}

              {notes?.length ? (
                <View
                  style={[styles.notes, { borderTopColor: hexToRgba(colors.textSecondary, 0.18) }]}
                  testID={testID ? `${testID}-notes` : undefined}
                >
                  <Typography
                    variant="caption2"
                    weight="semibold"
                    color={colors.textSecondary}
                    style={styles.notesHeading}
                  >
                    Which one should I pick?
                  </Typography>
                  {notes.map((note) => (
                    <Typography
                      key={note.label}
                      variant="caption2"
                      color={colors.textSecondary}
                      accessibilityLabel={`${note.label}. ${note.text}`}
                    >
                      <Typography variant="caption2" weight="semibold" color={colors.textSecondary}>
                        {note.label}
                      </Typography>
                      {` — ${note.text}`}
                    </Typography>
                  ))}
                </View>
              ) : null}
            </ScrollView>
          )}

          <Pressable
            onPress={onClose}
            style={styles.cancel}
            testID={testID ? `${testID}-cancel` : undefined}
            accessibilityRole="button"
          >
            <Typography variant="body" color={colors.textSecondary} accessible={false}>
              {/* Nothing was in progress to cancel when the read failed —
                  the only thing left to do is close it. */}
              {error ? 'Close' : 'Cancel'}
            </Typography>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  card: {
    borderRadius: CornerRadius.xl,
    padding: Spacing.lg,
    maxHeight: '80%',
  },
  title: { textAlign: 'center', marginBottom: Spacing.xs },
  subtitle: { textAlign: 'center', marginBottom: Spacing.md },
  list: { maxHeight: 420 },
  listContent: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  stateBox: { paddingVertical: Spacing.xl, alignItems: 'center' },
  emptyText: { textAlign: 'center' },
  // Tighter than `stateBox`: one short sentence and a button do not need the
  // dead vertical space a loading spinner gets.
  errorBox: { paddingTop: Spacing.sm, alignItems: 'center', gap: Spacing.md },
  errorIcon: {
    width: Spacing.xxl,
    height: Spacing.xxl,
    borderRadius: Spacing.xxl / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: { textAlign: 'center' },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderWidth: 1.5,
    borderRadius: CornerRadius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    minHeight: ButtonMetrics.minTapTarget,
    alignSelf: 'stretch',
  },
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
  notes: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  notesHeading: { marginBottom: Spacing.xxs },
  cancel: { marginTop: Spacing.md, alignItems: 'center', paddingVertical: Spacing.sm },
});
