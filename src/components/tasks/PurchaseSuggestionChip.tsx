import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { tasksApi, Task } from '@api/tasks';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { isFullBudget } from '@features/budget';
import { memberFacingMessage } from '@features/house/local/memberFacingError';
import { showToast } from '@services/toastManager';
import { useBudgetStore } from '@stores/budgetStore';
import { CornerRadius, IconSize, LegacyTextVariant, Spacing, useAppColors } from '@theme';
import type { AppColors } from '@theme';

interface PurchaseSuggestionChipProps {
  task: Task;
  householdId: string;
  /** Called with the refreshed task after add/dismiss so the screen updates. */
  onTaskUpdated: (task: Task) => void;
}

/**
 * Presentational "add to planned spending" chip. All logic — whether to show,
 * which state, the copy, the cost formatting — is computed by the backend and
 * delivered in `task.purchase_suggestion`. This component only renders those
 * strings and fires the two actions.
 */
export function PurchaseSuggestionChip({
  task,
  householdId,
  onTaskUpdated,
}: PurchaseSuggestionChipProps) {
  const colors = useAppColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const markInsightsDirty = useBudgetStore((s) => s.markInsightsDirty);
  const [busy, setBusy] = useState(false);

  const suggestion = task.purchase_suggestion;
  if (!isFullBudget() || !suggestion) return null;

  const handleAdd = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await tasksApi.createBudgetItemFromTask(householdId, task.id);
      onTaskUpdated(res.task);
      markInsightsDirty(householdId);
      showToast('success', 'Added to planned spending');
    } catch (error) {
      /**
       * DoD H7, positive half — the sixth and last P4 call site.
       *
       * `createBudgetItemFromTask` is disabled on a local-first build, and
       * `unsupportedCopy.ts` has a written explanation for why. 'Could not add
       * to budget' read as a failure in a feature that is working as designed.
       *
       * `memberFacingMessage` returns the deliberate copy when there is some
       * and this sentence otherwise. It reads `.message`, never `.method`, so
       * no identifier can reach a toast — the negative half, locked by
       * `h7-p4-purchase-suggestion-no-false-success.yaml`, which asserts this
       * exact surface shows no false success and leaks no identifier.
       */
      showToast('error', memberFacingMessage(error, 'Could not add to budget'));
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await tasksApi.dismissPurchaseSuggestion(householdId, task.id);
      onTaskUpdated(res.task);
    } catch {
      // Non-fatal — just leave the chip in place for a later retry.
    } finally {
      setBusy(false);
    }
  };

  if (suggestion.state === 'added') {
    return (
      <View style={[styles.container, styles.addedContainer]} testID="task-purchase-added">
        <Icon
          name="checkmark-circle"
          size={LegacyTextVariant.title3.size}
          color={colors.success}
          style={styles.addedIcon}
        />
        <Text style={styles.addedText}>{suggestion.title}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="task-purchase-suggestion">
      <Icon
        name="cart"
        size={LegacyTextVariant.title3.size}
        color={colors.accent}
        style={styles.icon}
      />
      <View style={styles.body}>
        <Text style={styles.title}>{suggestion.title}</Text>
        {suggestion.subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {suggestion.subtitle}
          </Text>
        ) : null}
      </View>
      <TouchableOpacity
        style={[styles.addButton, busy && styles.addButtonBusy]}
        onPress={handleAdd}
        disabled={busy}
        testID="task-purchase-add-button"
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.white} />
        ) : (
          <Text style={styles.addButtonText}>{suggestion.action_label}</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.dismissButton}
        onPress={handleDismiss}
        disabled={busy}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        testID="task-purchase-dismiss-button"
      >
        <Icon name="close" size={IconSize.sm} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: CornerRadius.md,
      borderWidth: 1,
      borderColor: colors.accent,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.base,
      marginBottom: Spacing.base,
    },
    icon: {
      marginRight: Spacing.md,
    },
    body: {
      flex: 1,
    },
    title: {
      fontSize: LegacyTextVariant.callout.size,
      lineHeight: LegacyTextVariant.callout.lineHeight,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    subtitle: {
      fontSize: LegacyTextVariant.footnote.size,
      lineHeight: LegacyTextVariant.footnote.lineHeight,
      color: colors.textSecondary,
      marginTop: Spacing.xxs,
    },
    addButton: {
      backgroundColor: colors.accent,
      borderRadius: CornerRadius.sm,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.base,
      marginLeft: Spacing.sm,
      minWidth: 56,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addButtonBusy: {
      opacity: 0.7,
    },
    addButtonText: {
      fontSize: LegacyTextVariant.subheadline.size,
      lineHeight: LegacyTextVariant.subheadline.lineHeight,
      fontWeight: '600',
      color: colors.white,
    },
    dismissButton: {
      marginLeft: Spacing.sm,
      padding: Spacing.xs,
    },
    // "Added" confirmation variant.
    addedContainer: {
      borderColor: colors.success,
    },
    addedIcon: {
      marginRight: Spacing.md,
    },
    addedText: {
      flex: 1,
      fontSize: LegacyTextVariant.callout.size,
      lineHeight: LegacyTextVariant.callout.lineHeight,
      fontWeight: '600',
      color: colors.textPrimary,
    },
  });
}
