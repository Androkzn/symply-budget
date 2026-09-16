/**
 * The Planning / Spending "add" actions, behind one header button.
 *
 * They used to be a permanent three-button CTA row pinned above the list (Add
 * Manually · Scan Receipt · Add with AI). At three buttons the row had to shrink
 * its labels to fit a phone, it pushed the first spending row a third of a
 * screen down, and it re-stated itself on every month the member paged through.
 *
 * So the row moved behind the standard header "+" (see `BudgetScreen`) and
 * became this sheet: the same actions, each with the room to say what it does.
 * The per-action testIDs are deliberately UNCHANGED from the old row — the
 * Maestro flows that drive them only had to learn to open the sheet first.
 */
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { Typography } from '@components/ui';
import { BottomSheet } from '@components/ui/BottomSheet';
import { Icon } from '@components/ui/Icon';
import {
  CornerRadius,
  hexToRgba,
  IconSize,
  Spacing,
  useAppColors,
} from '@theme';

interface BudgetAddActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Which tab opened it — decides the copy and which actions are offered. */
  variant: 'planned' | 'spent';
  onAddPlanned: () => void;
  onAddSpent: () => void;
  onAddAIPress: () => void;
  /** Spent tab only, and only when the brand ships receipt scanning. */
  onScanReceipt?: () => void;
}

interface AddActionRowProps {
  icon: string;
  title: string;
  description: string;
  onPress: () => void;
  /** The AI row — filled brand chip, matching the old row's primary CTA. */
  emphasis?: boolean;
  testID: string;
}

function AddActionRow({
  icon,
  title,
  description,
  onPress,
  emphasis = false,
  testID,
}: AddActionRowProps) {
  const colors = useAppColors();
  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: colors.backgroundSecondary }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={testID}
    >
      <View
        style={[
          styles.iconChip,
          {
            backgroundColor: emphasis
              ? colors.primary
              : hexToRgba(colors.primary, 0.12),
          },
        ]}
      >
        <Icon
          name={icon}
          size={IconSize.md}
          color={emphasis ? colors.white : colors.primary}
        />
      </View>
      <View style={styles.rowText}>
        <Typography variant="subheadline" weight="semibold">
          {title}
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary}>
          {description}
        </Typography>
      </View>
      <Icon
        name="chevron-forward"
        size={IconSize.md}
        color={colors.textTertiary}
      />
    </TouchableOpacity>
  );
}

export function BudgetAddActionsSheet({
  visible,
  onClose,
  variant,
  onAddPlanned,
  onAddSpent,
  onAddAIPress,
  onScanReceipt,
}: BudgetAddActionsSheetProps) {
  const isPlanned = variant === 'planned';

  // Close before handing over — every action pushes a screen, and a form left
  // behind a live sheet is a surface the member cannot reach. Same order as
  // `AttachmentSourceSheet`, and synchronous so a tap is one frame, not two.
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="content"
      title={isPlanned ? 'Add a planned item' : 'Add a spending'}
      showCloseButton
      closeTestID="budget-add-actions-close"
    >
      <View style={styles.body} testID="budget-add-actions-sheet">
        {isPlanned ? (
          <AddActionRow
            icon="calendar-outline"
            title="Add Manually"
            description="Enter the item and the month you plan it for"
            onPress={run(onAddPlanned)}
            testID="budget-add-planned"
          />
        ) : (
          <AddActionRow
            icon="cash-outline"
            title="Add Manually"
            description="Enter the amount, date and category yourself"
            onPress={run(onAddSpent)}
            testID="budget-add-spent"
          />
        )}

        {!isPlanned && onScanReceipt ? (
          <AddActionRow
            icon="receipt-outline"
            title="Scan Receipt"
            description="Photograph a receipt and let it fill the details in"
            onPress={run(onScanReceipt)}
            testID="budget-scan-receipt"
          />
        ) : null}

        <AddActionRow
          icon="sparkles"
          title="Add with AI"
          description={
            isPlanned
              ? 'Describe what you are planning in plain words'
              : 'Describe what you spent in plain words'
          }
          onPress={run(onAddAIPress)}
          emphasis
          testID="budget-add-with-ai"
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
  },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: Spacing.xxs },
});
