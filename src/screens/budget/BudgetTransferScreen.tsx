import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import type { ComponentProps } from 'react';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { budgetApi } from '@api/budget';
import type {
  BudgetTransferContext,
  BudgetTransferRecord,
  TransferDestinationOption,
} from '@api/budget';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { GradientButton, IconBackgroundChip, TextInput, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { BudgetStackParamList } from '@navigation/types';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Layout, Spacing, hexToRgba, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { formatBudgetCurrency } from './budgetFormat';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** Stable identity for a destination option (id is null for "next month"). */
function destinationKey(option: TransferDestinationOption): string {
  return `${option.type}:${option.id ?? 'self'}`;
}

/** Cents → editable dollar string, dropping a trailing ".00" / ".x0". */
function centsToInput(cents: number): string {
  if (cents <= 0) return '';
  return String(Math.round(cents) / 100);
}

export function BudgetTransferScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear, selectedMonth, markInsightsDirty } = useBudgetStore();

  const [context, setContext] = useState<BudgetTransferContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset the form to reflect a fresh context (on load and after every mutation).
  const applyContext = useCallback((next: BudgetTransferContext) => {
    setContext(next);
    setAmount(centsToInput(next.leftoverCents));
    setSelectedKey((prev) => {
      if (prev && next.destinations.some((d) => destinationKey(d) === prev)) return prev;
      return next.destinations.length > 0 ? destinationKey(next.destinations[0]) : null;
    });
  }, []);

  const load = useCallback(async () => {
    if (!currentHousehold?.id) return;
    try {
      const next = await budgetApi.getTransferContext(
        currentHousehold.id,
        selectedYear,
        selectedMonth
      );
      applyContext(next);
    } catch (error) {
      console.error('Error loading budget transfer context:', error);
      Alert.alert('Error', 'Could not load your budget transfer options.');
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold?.id, selectedYear, selectedMonth, applyContext]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedOption = context?.destinations.find((d) => destinationKey(d) === selectedKey) ?? null;

  const handleTransfer = async () => {
    if (!currentHousehold?.id || !context || !selectedOption) return;
    const dollars = parseFloat(amount);
    if (Number.isNaN(dollars) || dollars <= 0) {
      Alert.alert('Invalid amount', 'Enter an amount greater than zero.');
      return;
    }
    const cents = Math.round(dollars * 100);
    if (cents > context.leftoverCents) {
      Alert.alert(
        'Too much',
        `You can move at most ${formatBudgetCurrency(context.leftoverCents)} this month.`
      );
      return;
    }

    const householdId = currentHousehold.id;
    setIsSubmitting(true);
    try {
      const next = await budgetApi.createTransfer(householdId, {
        source_year: context.year,
        source_month: context.month,
        amount_cents: cents,
        destination_type: selectedOption.type,
        destination_id: selectedOption.id,
        note: note.trim() ? note.trim() : null,
      });
      markInsightsDirty(householdId);
      setNote('');
      applyContext(next);
      Alert.alert('Transferred', `${formatBudgetCurrency(cents)} moved to ${selectedOption.label}.`);
    } catch (error) {
      console.error('Error creating budget transfer:', error);
      Alert.alert('Error', 'Could not complete the transfer. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmUndo = (record: BudgetTransferRecord) => {
    Alert.alert(
      'Undo transfer?',
      `Return ${formatBudgetCurrency(record.amountCents)} from ${record.destinationLabel} back to ${
        context?.monthLabel ?? 'this month'
      }.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Undo', style: 'destructive', onPress: () => handleUndo(record.id) },
      ]
    );
  };

  const handleUndo = async (transferId: string) => {
    if (!currentHousehold?.id) return;
    const householdId = currentHousehold.id;
    setIsSubmitting(true);
    try {
      const next = await budgetApi.deleteTransfer(householdId, transferId);
      markInsightsDirty(householdId);
      applyContext(next);
    } catch (error) {
      console.error('Error undoing budget transfer:', error);
      Alert.alert('Error', 'Could not undo that transfer.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading || !context) {
    return (
      <AppBackground>
        <SafeAreaView edges={[]} testID="budget-transfer-screen">
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  const leftover = context.leftoverCents;
  const hasLeftover = leftover > 0;

  return (
    <AppBackground>
    <SafeAreaView edges={[]} testID="budget-transfer-screen">
      <ScreenHeader
        title="Move Budget"
        showBackButton
        backButtonTestID="back-button"
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
      />

      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.flex]}
        contentContainerStyle={styles.content}
        {...keyboardDismissScrollProps}
      >
        <Typography variant="caption1" color={colors.textSecondary} style={styles.sectionSubtitle}>
          Move this month’s leftover into next month, a savings goal, or a TFSA/RRSP account.
        </Typography>

        {/* Leftover hero */}
        <View style={[styles.hero, { backgroundColor: colors.card }]}>
          <Typography variant="caption1" color={colors.textSecondary}>
            Leftover in {context.monthLabel}
          </Typography>
          <Typography
            variant="largeTitle"
            weight="bold"
            color={hasLeftover ? colors.success : colors.textSecondary}
            style={styles.heroAmount}
          >
            {formatBudgetCurrency(leftover)}
          </Typography>
          <Typography variant="footnote" color={colors.textTertiary}>
            Budget {formatBudgetCurrency(context.plannedBudgetCents)} · Spent{' '}
            {formatBudgetCurrency(context.actualSpentCents)}
          </Typography>
          {context.carriedInCents > 0 && (
            <Typography variant="footnote" color={colors.textTertiary}>
              Includes {formatBudgetCurrency(context.carriedInCents)} carried over
            </Typography>
          )}
          {context.transferredOutCents > 0 && (
            <Typography variant="footnote" color={colors.textTertiary}>
              Already moved out {formatBudgetCurrency(context.transferredOutCents)}
            </Typography>
          )}
          {(context.bulkDeferredCents ?? 0) > 0 && (
            <Typography
              variant="footnote"
              color={colors.textTertiary}
              testID="budget-transfer-bulk-deferred"
            >
              {`Includes ${formatBudgetCurrency(
                context.bulkDeferredCents ?? 0,
              )} paid this month for bulk purchases that count in later months`}
            </Typography>
          )}
        </View>

        {hasLeftover ? (
          <>
            <Typography
              variant="footnote"
              weight="semibold"
              color={colors.textTertiary}
              style={styles.groupLabel}
            >
              MOVE TO
            </Typography>
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              {context.destinations.map((option, index) => {
                const key = destinationKey(option);
                const selected = key === selectedKey;
                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => setSelectedKey(key)}
                    activeOpacity={0.7}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={option.label}
                    testID={`budget-transfer-dest-${option.type}-${option.id ?? 'self'}`}
                    style={[
                      styles.row,
                      index > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.divider,
                      },
                      selected && { backgroundColor: hexToRgba(colors.primary, 0.06) },
                    ]}
                  >
                    <IconBackgroundChip
                      name={option.icon as IoniconName}
                      style={styles.rowIcon}
                    />
                    <View style={styles.rowText}>
                      <Typography variant="body" weight="medium" numberOfLines={1}>
                        {option.label}
                      </Typography>
                      {option.sublabel && (
                        <Typography variant="footnote" color={colors.textSecondary} numberOfLines={1}>
                          {option.sublabel}
                        </Typography>
                      )}
                    </View>
                    <Icon
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={22}
                      color={selected ? colors.primary : colors.textTertiary}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.amountHeader}>
              <Typography
                variant="footnote"
                weight="semibold"
                color={colors.textTertiary}
                style={styles.amountLabel}
              >
                AMOUNT
              </Typography>
              <TouchableOpacity
                onPress={() => setAmount(centsToInput(leftover))}
                accessibilityRole="button"
                testID="budget-transfer-move-all"
              >
                <Typography variant="subheadline" weight="medium" color={colors.primary}>
                  Move all
                </Typography>
              </TouchableOpacity>
            </View>
            <TextInput
              testID="budget-transfer-amount"
              placeholder="0"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
            <TextInput
              testID="budget-transfer-note"
              label="Note (optional)"
              placeholder="e.g. Save for winter tires"
              value={note}
              onChangeText={setNote}
            />

            <GradientButton
              title={selectedOption ? `Transfer to ${selectedOption.label}` : 'Transfer'}
              variant="teal"
              onPress={handleTransfer}
              disabled={isSubmitting || !selectedOption}
              fullWidth
              style={styles.transferButton}
              testID="budget-transfer-submit"
            />
          </>
        ) : (
          <View style={[styles.card, styles.emptyCard, { backgroundColor: colors.card }]}>
            <Icon name="wallet-outline" size={36} color={colors.textTertiary} />
            <Typography variant="body" color={colors.textSecondary} style={styles.emptyStateText}>
              No leftover to move this month. Come back once you’re under budget.
            </Typography>
          </View>
        )}

        {/* History */}
        <Typography
          variant="footnote"
          weight="semibold"
          color={colors.textTertiary}
          style={styles.groupLabel}
        >
          TRANSFERS FROM {context.monthLabel.toUpperCase()}
        </Typography>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {context.history.length === 0 ? (
            <View style={styles.emptyRow}>
              <Typography variant="body" color={colors.textSecondary}>
                No transfers yet.
              </Typography>
            </View>
          ) : (
            context.history.map((record, index) => (
              <View
                key={record.id}
                style={[
                  styles.row,
                  index > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.divider,
                  },
                ]}
                testID={`budget-transfer-history-${record.id}`}
              >
                <View style={styles.rowText}>
                  <Typography variant="body" weight="medium" numberOfLines={1}>
                    {record.destinationLabel}
                  </Typography>
                  <Typography variant="footnote" color={colors.textSecondary} numberOfLines={1}>
                    {formatBudgetCurrency(record.amountCents)}
                    {record.note ? ` · ${record.note}` : ''}
                  </Typography>
                </View>
                <TouchableOpacity
                  onPress={() => confirmUndo(record)}
                  disabled={isSubmitting}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Undo transfer to ${record.destinationLabel}`}
                  testID={`budget-transfer-undo-${record.id}`}
                  style={styles.undoButton}
                >
                  <Icon name="arrow-undo-outline" size={18} color={colors.destructive} />
                  <Typography variant="subheadline" weight="medium" color={colors.destructive}>
                    Undo
                  </Typography>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: Layout.bottomTabBarClearance },
  sectionSubtitle: { marginBottom: Spacing.md },
  hero: {
    borderRadius: CornerRadius.lg,
    padding: Spacing.base,
    gap: 2,
  },
  heroAmount: { marginVertical: 2 },
  groupLabel: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
    letterSpacing: 0.5,
  },
  card: { borderRadius: CornerRadius.lg, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    gap: Spacing.smd,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  amountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  amountLabel: { letterSpacing: 0.5 },
  transferButton: { marginTop: Spacing.lg },
  emptyCard: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.sm },
  emptyStateText: { textAlign: 'center', paddingHorizontal: Spacing.lg },
  emptyRow: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.base },
  undoButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
