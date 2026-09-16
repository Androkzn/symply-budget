import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { GradientButton, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

export type JoinTarget = {
  householdId: string;
  /** Display name from the control plane; null on an older Worker. */
  householdName: string | null;
};

type Props = {
  visible: boolean;
  /** The household this device is bound to today — the one being replaced. */
  currentHouseholdName: string | null;
  target: JoinTarget | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Never an id. A name nobody chose is still better than `hh_local_9f3a…`. */
function label(name: string | null | undefined, fallback: string): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

/**
 * The last question before a join, asked properly.
 *
 * What this replaced was a pair of buttons under a line of orange text — a
 * warning that said "this device's own budget will be replaced" without saying
 * WHICH budget, or by which. That is a fine sentence when a person has one
 * household and has just scanned a code they were handed across a table. It is
 * not fine when they belong to several: the destructive half of the sentence
 * ("your budget") and the incoming half ("theirs") are exactly the two things
 * they cannot check, and getting it wrong costs them a ledger.
 *
 * So both sides are named, opposed, and shown in the shape of the thing that is
 * about to happen — one household in, one household out.
 *
 * An in-app modal styled as an alert, deliberately, rather than `Alert.alert`:
 * iOS renders `UIAlertController` in its own window, which XCUITest snapshots
 * of the app window cannot see, so a native alert here would be invisible to
 * the automated runs that guard this flow — and it could not show two named
 * rows either.
 */
export function BudgetJoinConfirmDialog({
  visible,
  currentHouseholdName,
  target,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const colors = useAppColors();
  const joining = label(target?.householdName, 'their household');
  const replacing = label(currentHouseholdName, 'this device’s budget');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={busy ? undefined : onCancel}
      testID="budget-join-confirm-modal"
    >
      {/* Tapping the scrim cancels — the non-destructive answer, which is what
          an accidental tap outside a destructive dialog should always be. */}
      <Pressable
        style={styles.scrim}
        onPress={busy ? undefined : onCancel}
        accessibilityLabel="Cancel joining"
        testID="budget-join-confirm-scrim"
      >
        <Pressable
          style={[styles.dialog, { backgroundColor: colors.backgroundMain }]}
          onPress={() => {}}
          testID="budget-settings-join-confirm-panel"
        >
          <ScrollView bounces={false} contentContainerStyle={styles.body}>
            <View style={styles.header}>
              <Icon
                name="alert-circle"
                forceIonicons
                size={IconSize.xl}
                color={colors.warning}
              />
              <Typography variant="title3" weight="semibold" style={styles.centered}>
                Replace this budget?
              </Typography>
            </View>

            {/* The two halves, named. Order is deliberate: what arrives first,
                then what it costs — the same order the sentence is read in. */}
            <View style={[styles.row, { borderColor: colors.borderColor }]}>
              <Icon name="download-outline" forceIonicons size={IconSize.md} color={colors.success} />
              <View style={styles.rowText}>
                <Typography variant="caption2" color={colors.textSecondary}>
                  You will join
                </Typography>
                <Typography
                  variant="footnote"
                  weight="semibold"
                  testID="budget-join-confirm-target"
                >
                  {joining}
                </Typography>
              </View>
            </View>

            <View style={[styles.row, { borderColor: colors.borderColor }]}>
              <Icon name="trash-outline" forceIonicons size={IconSize.md} color={colors.error} />
              <View style={styles.rowText}>
                <Typography variant="caption2" color={colors.textSecondary}>
                  This device will lose
                </Typography>
                <Typography
                  variant="footnote"
                  weight="semibold"
                  testID="budget-join-confirm-current"
                >
                  {replacing}
                </Typography>
              </View>
            </View>

            <Typography
              variant="caption1"
              color={colors.textSecondary}
              style={styles.explain}
              testID="budget-join-confirm-explain"
            >
              Everything in {replacing} on this device — expenses, categories, goals and savings —
              is replaced by {joining}&apos;s shared budget. Other devices in {replacing} keep
              their copy. This cannot be undone from here.
            </Typography>

            <GradientButton
              title={busy ? 'Joining…' : 'Replace and join'}
              disabled={busy}
              fullWidth
              onPress={onConfirm}
              testID="budget-settings-join-confirm"
            />
            <GradientButton
              title="Cancel"
              variant="secondary"
              disabled={busy}
              fullWidth
              onPress={onCancel}
              testID="budget-settings-join-cancel"
            />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    borderRadius: CornerRadius.xl,
    overflow: 'hidden',
  },
  body: { padding: Spacing.lg, gap: Spacing.md },
  header: { alignItems: 'center', gap: Spacing.xs },
  centered: { textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: CornerRadius.md,
  },
  rowText: { flex: 1, gap: 2 },
  explain: { marginTop: Spacing.xxs },
});

export default BudgetJoinConfirmDialog;
