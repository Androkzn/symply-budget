/**
 * "Bulk purchase (stock-up)" on the Record spending form.
 *
 * A checkbox row like "On sale / discount"; when on, a card with the estimate
 * ("Should last about 4 months"), a − / + stepper, the one-sentence reason,
 * a per-month preview (portion, and what that month has left after it) and a
 * footer saying what THIS month counts. Everything here is derived from props:
 * the split is `splitEvenly`, the sentence is `describeBulkSuggestion`, the
 * months come from `monthContext`. The form owns the state and the ledger call.
 */
import React, { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import type { BulkMonthContext, BulkSuggestion } from '@api/budget';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { describeBulkSuggestion } from '@features/budget/bulk/bulkEstimate';
import { addMonths, monthKeyOf, splitEvenly } from '@features/budget/bulk/bulkSplit';
import { BULK_MAX_MONTHS, BULK_MIN_MONTHS } from '@features/budget/bulk/bulkTypes';
import { IconSize, useAppColors } from '@theme';

import { formatBudgetCurrency as formatCurrency } from './budgetFormat';
import { monthYearLabel } from './BudgetMonthHeader';

interface Props {
  enabled: boolean;
  onToggle: () => void;
  months: number;
  onChangeMonths: (months: number) => void;
  suggestion: BulkSuggestion | null;
  loading: boolean;
  /** TAX-INCLUSIVE total the plan splits, in cents. */
  totalCents: number;
  /** 'YYYY-MM-DD' — the first portion lands in this month. */
  purchaseDate: string;
  monthContext: BulkMonthContext[];
  /** Editing a plan whose earlier months are already closed. */
  touchesClosedMonths: boolean;
}

function labelForMonthKey(monthKey: string): string {
  return monthYearLabel(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)));
}

export function BudgetBulkPurchaseSection({
  enabled,
  onToggle,
  months,
  onChangeMonths,
  suggestion,
  loading,
  totalCents,
  purchaseDate,
  monthContext,
  touchesClosedMonths,
}: Props) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const accent = theme.pastel.teal;

  const startMonth = monthKeyOf(purchaseDate);
  const portions = useMemo(() => splitEvenly(totalCents, months), [totalCents, months]);
  const contextByMonth = useMemo(
    () => new Map(monthContext.map((entry) => [entry.month, entry])),
    [monthContext],
  );

  const basis = loading
    ? 'Estimating from your spending history…'
    : suggestion
      ? describeBulkSuggestion(suggestion, purchaseDate, formatCurrency)
      : 'Pick how many months this purchase should last.';

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={styles.toggle}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: enabled }}
        testID="budget-item-bulk-toggle"
      >
        <View
          style={[
            styles.checkbox,
            { borderColor: enabled ? accent : colors.borderColor },
            enabled && { backgroundColor: accent },
          ]}
        >
          {enabled && <Icon name="checkmark" size={IconSize.sm} color={colors.white} />}
        </View>
        <View style={styles.toggleText}>
          <Typography variant="body">Bulk purchase (stock-up)</Typography>
          <Typography variant="caption2" color={colors.textSecondary}>
            Spread it over the months it will last, so this month is not charged for all of it.
          </Typography>
        </View>
      </TouchableOpacity>

      {enabled && (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.groupedListBackground, borderColor: colors.borderColor },
          ]}
          testID="budget-item-bulk-card"
        >
          <View style={styles.headline}>
            <View style={styles.headlineText}>
              <Typography variant="caption1" color={colors.textSecondary}>
                Should last about
              </Typography>
              <Typography variant="headline" weight="semibold" testID="budget-item-bulk-months">
                {`${months} ${months === 1 ? 'month' : 'months'}`}
              </Typography>
            </View>
            <View style={[styles.stepper, { borderColor: colors.borderColor }]}>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() => onChangeMonths(Math.max(BULK_MIN_MONTHS, months - 1))}
                disabled={months <= BULK_MIN_MONTHS}
                accessibilityRole="button"
                accessibilityLabel="Fewer months"
                testID="budget-item-bulk-minus"
              >
                <Icon
                  name="remove"
                  size={IconSize.md}
                  color={months <= BULK_MIN_MONTHS ? colors.textTertiary : accent}
                />
              </TouchableOpacity>
              <View style={[styles.stepperDivider, { backgroundColor: colors.borderColor }]} />
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() => onChangeMonths(Math.min(BULK_MAX_MONTHS, months + 1))}
                disabled={months >= BULK_MAX_MONTHS}
                accessibilityRole="button"
                accessibilityLabel="More months"
                testID="budget-item-bulk-plus"
              >
                <Icon
                  name="add"
                  size={IconSize.md}
                  color={months >= BULK_MAX_MONTHS ? colors.textTertiary : accent}
                />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.basisRow}>
            {loading && <ActivityIndicator size="small" color={accent} />}
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              style={styles.basisText}
              testID="budget-item-bulk-basis"
            >
              {basis}
            </Typography>
          </View>

          {touchesClosedMonths && (
            <Typography
              variant="caption2"
              color={colors.warning}
              testID="budget-item-bulk-closed-note"
            >
              Changes earlier months too.
            </Typography>
          )}

          <View style={[styles.preview, { borderTopColor: colors.borderColor }]}>
            {portions.map((portion, index) => {
              const monthKey = addMonths(startMonth, index);
              const context = contextByMonth.get(monthKey);
              const planned = context?.plannedBudget ?? null;
              const leftAfter =
                planned != null ? planned - (context?.countedCents ?? 0) - portion : null;
              return (
                <View
                  key={monthKey}
                  style={[styles.previewRow, index > 0 && { borderTopColor: colors.divider }]}
                  testID={`budget-item-bulk-preview-${index}`}
                >
                  <View style={styles.previewMonth}>
                    <Typography variant="subheadline" weight={index === 0 ? 'semibold' : 'regular'}>
                      {labelForMonthKey(monthKey)}
                    </Typography>
                    <Typography
                      variant="caption2"
                      color={leftAfter != null && leftAfter < 0 ? colors.warning : colors.textSecondary}
                    >
                      {leftAfter == null
                        ? 'No budget set yet'
                        : leftAfter < 0
                          ? `${formatCurrency(-leftAfter)} over after this`
                          : `${formatCurrency(leftAfter)} left after this`}
                    </Typography>
                  </View>
                  <Typography variant="subheadline" weight="semibold" color={accent}>
                    {formatCurrency(portion)}
                  </Typography>
                </View>
              );
            })}
          </View>

          <Typography variant="caption1" color={colors.textSecondary} testID="budget-item-bulk-footer">
            {totalCents > 0
              ? `This month counts ${formatCurrency(portions[0] ?? 0)} of ${formatCurrency(totalCents)}.`
              : 'Enter the amount to see the split.'}
          </Typography>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 12 },
  toggle: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  toggleText: { flex: 1, gap: 2 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  headline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headlineText: { flex: 1, gap: 2 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  stepperButton: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepperDivider: { width: StyleSheet.hairlineWidth, height: 24 },
  basisRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  basisText: { flex: 1 },
  preview: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 4 },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent',
  },
  previewMonth: { flex: 1, gap: 1 },
});
