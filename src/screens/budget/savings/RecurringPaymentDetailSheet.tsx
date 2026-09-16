import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import type { SavingsRecurringPayment } from '@api/savings';
import { BottomSheet, Typography } from '@components/ui';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

import { LoanPaymentInsights } from './LoanPaymentInsights';
import { RecurringPaymentMonthsChart } from './RecurringPaymentMonthsChart';

interface RecurringPaymentDetailSheetProps {
  visible: boolean;
  /** The row that was tapped. Null while closed — never read once `visible` is false. */
  item: SavingsRecurringPayment | null;
  /** Scopes the loan-schedule / monthly-history fetches below. */
  householdId: string;
  /** The Monthly tab's currently-viewed year — drives the non-loan months chart. */
  year: number;
  onClose: () => void;
  /**
   * Header "Edit" action — hands off to the SAME full edit flow as
   * Monthly Payments → Manage → tap item (`SavingsRecurringPaymentsScreen`):
   * loan-tracked payments open their loan detail sheet first, everything
   * else opens the full edit form directly, with every field the "Add
   * payment" form exposes (group picker, month scope, renewal reminders,
   * loan tracking, delete) editable there.
   */
  onEdit: (item: SavingsRecurringPayment) => void;
}

/**
 * Read-only detail for one Monthly-Payments row, opened by tapping it in
 * `SavingsMonthlyView`. This sheet never edits anything itself — its header
 * "Edit" action hands off to `SavingsRecurringPaymentsScreen`'s shared edit
 * flow via `onEdit`, so it can never silently omit a field that flow
 * supports.
 */
export function RecurringPaymentDetailSheet({
  visible,
  item,
  householdId,
  year,
  onClose,
  onEdit,
}: RecurringPaymentDetailSheetProps) {
  const colors = useAppColors();

  if (!item) return null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="tall"
      noPadding
      disableSwipe
      title={item.label}
      showCloseButton
      closeTestID="savings-payment-detail-left"
      headerAction={{
        label: 'Edit',
        onPress: () => onEdit(item),
        testID: 'savings-payment-detail-edit',
      }}
    >
      <View
        style={[styles.container, { backgroundColor: colors.backgroundMain }]}
        testID="savings-payment-detail-sheet"
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.amountBlock}>
            <Typography variant="title1" weight="bold">
              {formatCurrency(item.amount_cents)}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              per month
            </Typography>
          </View>

          <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
            <View style={styles.infoRow}>
              <Typography variant="body" color={colors.textSecondary}>
                Group
              </Typography>
              <Typography variant="body" weight="medium">
                {item.group_label ?? 'No group'}
              </Typography>
            </View>
            <View style={[styles.infoRow, styles.infoRowDivider, { borderTopColor: colors.borderColor }]}>
              <Typography variant="body" color={colors.textSecondary}>
                {item.is_automated ? 'Autopay' : 'Due day'}
              </Typography>
              <Typography variant="body" weight="medium">
                {item.is_automated ? 'On' : item.day_of_month != null ? `Day ${item.day_of_month}` : '—'}
              </Typography>
            </View>
            <View style={[styles.infoRow, styles.infoRowDivider, { borderTopColor: colors.borderColor }]}>
              <Typography variant="body" color={colors.textSecondary}>
                Essential
              </Typography>
              <Typography variant="body" weight="medium">
                {item.is_essential ? 'Yes' : 'No'}
              </Typography>
            </View>
            <View style={[styles.infoRow, styles.infoRowDivider, { borderTopColor: colors.borderColor }]}>
              <Typography variant="body" color={colors.textSecondary}>
                Status
              </Typography>
              <Typography
                variant="body"
                weight="medium"
                color={item.active ? colors.textPrimary : colors.textTertiary}
              >
                {item.active ? 'Active' : 'Inactive'}
              </Typography>
            </View>
          </View>

          {item.loan_summary ? (
            <LoanPaymentInsights item={item} householdId={householdId} />
          ) : (
            <RecurringPaymentMonthsChart item={item} householdId={householdId} year={year} />
          )}
        </ScrollView>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexShrink: 1 },
  scrollContent: { padding: Spacing.base, paddingBottom: Spacing.xxl, gap: Spacing.base },
  amountBlock: { alignItems: 'center', gap: Spacing.xxs, marginBottom: Spacing.xs },
  card: {
    borderRadius: CornerRadius.lg,
    padding: Spacing.base,
    gap: Spacing.smd,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoRowDivider: {
    paddingTop: Spacing.smd,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
