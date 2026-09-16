import DateTimePicker from '@react-native-community/datetimepicker';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Crypto from 'expo-crypto';
import { RouteProp, useNavigation, useRoute } from 'expo-router/react-navigation';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  savingsApi,
  type EmergencyFundSuggestion,
  type SavingsGoal,
  type SavingsGoalType,
} from '@api/savings';
import { AppBackground, SafeAreaView, SheetHeader } from '@components/common';
import { TextInput, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useUnsavedChanges } from '@hooks/useUnsavedChanges';
import { useIsScrollableFormSheet } from '@navigation/presentation';
import type { BudgetStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { useSavingsStore } from '@stores/savingsStore';
import { IconSize, Layout, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

/**
 * Savings goal create / edit form (Task 2.3). Two modes:
 *   - emergency_fund → months-of-expenses wizard; the target is suggested by
 *     the BE (`getEmergencyFundSuggestion`) and prefilled, never recomputed here.
 *   - custom → name + target (+ optional target_date / monthly allocation).
 * Dollar inputs are converted to int cents on submit; all display money is
 * BE-computed. Mirrors BudgetItemFormScreen's structure.
 */

const MONTH_OPTIONS = [3, 6, 9, 12];
const DEFAULT_MONTHS = 6;

/** Dollar string → integer cents (×100, rounded). Returns undefined for blank / invalid. */
function toCents(dollars: string): number | undefined {
  const n = parseFloat(dollars);
  if (Number.isNaN(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

function toDollarsString(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || cents === 0) return '';
  return (cents / 100).toString();
}

function parseLocalYMD(ymd: string): Date {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
}

function toLocalYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

type SavingsGoalFormRouteProp = RouteProp<BudgetStackParamList, 'SavingsGoalForm'>;
type SavingsGoalFormNavigationProp = NativeStackNavigationProp<
  BudgetStackParamList,
  'SavingsGoalForm'
>;

/** Editable form state that decides whether the goal form is dirty. */
interface SavingsGoalFormValues {
  goalType: SavingsGoalType;
  name: string;
  targetAmount: string;
  currentAmount: string;
  monthlyAllocation: string;
  months: number;
  targetDate: Date | null;
}

/** Empty baseline for a new goal — any input diverges from this. */
const EMPTY_SAVINGS_GOAL_VALUES: SavingsGoalFormValues = {
  goalType: 'emergency_fund',
  name: '',
  targetAmount: '',
  currentAmount: '',
  monthlyAllocation: '',
  months: DEFAULT_MONTHS,
  targetDate: null,
};

export function SavingsGoalForm() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<SavingsGoalFormNavigationProp>();
  const route = useRoute<SavingsGoalFormRouteProp>();
  const goalId = route.params?.goalId;
  const isEditing = !!goalId;
  const { currentHousehold } = useHouseholdStore();
  const { markDirty } = useSavingsStore();
  const insets = useSafeAreaInsets();
  // Page sheet on iPhone: the card starts below the status bar, so the `top`
  // safe-area edge would reserve that inset again inside the card.
  const insideSheet = useIsScrollableFormSheet();

  const [goalType, setGoalType] = useState<SavingsGoalType>('emergency_fund');
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [currentAmount, setCurrentAmount] = useState('');
  const [monthlyAllocation, setMonthlyAllocation] = useState('');
  const [months, setMonths] = useState(DEFAULT_MONTHS);
  const [targetDate, setTargetDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [suggestion, setSuggestion] = useState<EmergencyFundSuggestion | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  // Once the user manually edits the emergency-fund target, stop overwriting it
  // with fresh suggestions.
  const [targetTouched, setTargetTouched] = useState(false);

  const [isLoading, setIsLoading] = useState(isEditing);
  const [isDeleting, setIsDeleting] = useState(false);

  // Snapshot of the last-saved values for dirty-tracking. Empty for a new goal;
  // overwritten with the loaded goal's values in applyGoal when editing.
  const [baseline, setBaseline] = useState<SavingsGoalFormValues>(EMPTY_SAVINGS_GOAL_VALUES);

  // Load existing goal when editing.
  useEffect(() => {
    if (!isEditing || !currentHousehold?.id || !goalId) return;
    const load = async () => {
      try {
        const { goals } = await savingsApi.listGoals(currentHousehold.id);
        const goal = goals.find((g) => g.id === goalId);
        if (goal) {
          applyGoal(goal);
        } else {
          Alert.alert('Goal not found', 'This savings goal no longer exists.');
          navigation.goBack();
        }
      } catch (error) {
        console.error('Error loading savings goal:', error);
        Alert.alert('Could not load goal', 'Please try again.');
        navigation.goBack();
      } finally {
        setIsLoading(false);
      }
    };
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, goalId, currentHousehold?.id]);

  function applyGoal(goal: SavingsGoal) {
    const goalMonths = goal.months_of_expenses || DEFAULT_MONTHS;
    const goalTargetDate = goal.target_date ? parseLocalYMD(goal.target_date) : null;

    setGoalType(goal.type);
    setName(goal.name);
    setTargetAmount(toDollarsString(goal.target_amount_cents));
    setTargetTouched(true);
    setCurrentAmount(toDollarsString(goal.current_amount_cents));
    setMonthlyAllocation(toDollarsString(goal.monthly_allocation_cents));
    if (goal.months_of_expenses) setMonths(goal.months_of_expenses);
    setTargetDate(goalTargetDate);

    // Adopt the loaded goal as the dirty-tracking baseline.
    setBaseline({
      goalType: goal.type,
      name: goal.name,
      targetAmount: toDollarsString(goal.target_amount_cents),
      currentAmount: toDollarsString(goal.current_amount_cents),
      monthlyAllocation: toDollarsString(goal.monthly_allocation_cents),
      months: goalMonths,
      targetDate: goalTargetDate,
    });
  }

  // Emergency-fund suggestion: refetch whenever the months picker changes (new
  // goals only — while editing we keep the stored target unless the user resets).
  useEffect(() => {
    if (goalType !== 'emergency_fund' || !currentHousehold?.id || isEditing) return;
    let cancelled = false;
    setSuggestionLoading(true);
    savingsApi
      .getEmergencyFundSuggestion(currentHousehold.id, months)
      .then((res) => {
        if (cancelled) return;
        setSuggestion(res);
        if (!targetTouched && res.note !== 'NO_HISTORY' && res.suggestedTarget > 0) {
          setTargetAmount(toDollarsString(res.suggestedTarget));
        }
      })
      .catch(() => {
        if (!cancelled) setSuggestion(null);
      })
      .finally(() => {
        if (!cancelled) setSuggestionLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalType, months, currentHousehold?.id, isEditing]);

  const noHistory = suggestion?.note === 'NO_HISTORY';

  const canSubmit = useMemo(() => {
    if (goalType === 'custom' && !name.trim()) return false;
    const cents = toCents(targetAmount);
    return !!cents && cents > 0;
  }, [goalType, name, targetAmount]);

  const handleTypeChange = (type: SavingsGoalType) => {
    if (type === goalType) return;
    setGoalType(type);
    if (type === 'custom') {
      // Custom goals own their target — clear any auto-filled suggestion value.
      if (!isEditing && !targetTouched) setTargetAmount('');
    } else {
      setTargetTouched(false);
    }
  };

  // Live form values, diffed against `baseline` to gate Save. See
  // [[useUnsavedChanges]].
  const values: SavingsGoalFormValues = {
    goalType,
    name,
    targetAmount,
    currentAmount,
    monthlyAllocation,
    months,
    targetDate,
  };

  const { isDirty, isSaving, save } = useUnsavedChanges({
    values,
    baseline,
    successMessage: isEditing ? 'Changes saved' : 'Goal added',
    onClose: () => navigation.goBack(),
    onSave: async () => {
      if (!currentHousehold?.id) return false;

      const resolvedName =
        goalType === 'emergency_fund' ? name.trim() || 'Safety pillow' : name.trim();
      if (goalType === 'custom' && !resolvedName) {
        showToast('error', 'Please give this goal a name.');
        return false;
      }

      const targetCents = toCents(targetAmount);
      if (!targetCents || targetCents <= 0) {
        showToast('error', 'Enter a target amount to save toward.');
        return false;
      }

      const currentCents = toCents(currentAmount);
      const allocationCents = toCents(monthlyAllocation);
      const targetDateStr = targetDate ? toLocalYMD(targetDate) : null;

      if (isEditing && goalId) {
        await savingsApi.updateGoal(currentHousehold.id, goalId, {
          name: resolvedName,
          target_amount_cents: targetCents,
          current_amount_cents: currentCents,
          target_date: targetDateStr,
          months_of_expenses: goalType === 'emergency_fund' ? months : null,
          monthly_allocation_cents: allocationCents ?? null,
        });
      } else {
        await savingsApi.createGoal(currentHousehold.id, {
          id: Crypto.randomUUID(),
          type: goalType,
          name: resolvedName,
          target_amount_cents: targetCents,
          current_amount_cents: currentCents,
          target_date: targetDateStr,
          months_of_expenses: goalType === 'emergency_fund' ? months : null,
          monthly_allocation_cents: allocationCents ?? null,
        });
      }
      markDirty();
      return;
    },
  });

  const handleDelete = () => {
    if (!currentHousehold?.id || !goalId) return;
    Alert.alert('Delete goal', 'This will remove the goal. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (isDeleting) return;
          setIsDeleting(true);
          try {
            await savingsApi.deleteGoal(currentHousehold.id, goalId);
            markDirty();
            navigation.goBack();
          } catch (error) {
            console.error('Error deleting savings goal:', error);
            Alert.alert('Error', 'Could not delete this goal. Please try again.');
          } finally {
            setIsDeleting(false);
          }
        },
      },
    ]);
  };

  const formTitle = isEditing ? 'Edit goal' : 'New savings goal';

  // Save lives only in the header, and only once there is something to save: an
  // untouched form renders no action at all rather than a greyed-out one.
  const showSaveAction = isDirty || isSaving;

  if (isLoading) {
    return (
      <AppBackground>
        <SafeAreaView edges={['top']}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.pastel.teal} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <AppBackground>
      <SafeAreaView
        edges={insideSheet ? ['bottom'] : ['top', 'bottom']}
        style={[styles.flex, { backgroundColor: colors.backgroundMain }]}
        testID="savings-goal-form"
      >
        {/* The app's one sheet header, same as every `BottomSheet` and overlay
            sheet — not a second hand-rolled row of teal text buttons. */}
        <SheetHeader
          title={formTitle}
          titleLines={2}
          leftVariant="close"
          onLeftPress={() => navigation.goBack()}
          leftTestID="savings-goal-form-cancel"
          leftAccessibilityLabel="Cancel"
          {...(showSaveAction
            ? {
                rightLabel: 'Save',
                onRightPress: save,
                rightDisabled: isSaving || !canSubmit,
                rightLoading: isSaving,
                rightTestID: 'savings-goal-form-save-header',
              }
            : {})}
          showDivider
        />

        <ScrollView
          {...keyboardDismissScrollProps}
          style={styles.flex}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + Layout.bottomTabBarClearance },
          ]}
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator
        >
          {/* Goal type toggle — disabled while editing (type is immutable). */}
          <Typography variant="caption1" color={colors.textSecondary} style={styles.fieldLabel}>
            Goal type
          </Typography>
          <View style={styles.segmentRow}>
            {(
              [
                { value: 'emergency_fund' as const, label: 'Safety pillow' },
                { value: 'custom' as const, label: 'Custom goal' },
              ]
            ).map((option) => {
              const active = goalType === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.segmentChip,
                    {
                      borderColor: theme.pastel.teal,
                      backgroundColor: active ? theme.pastel.teal : 'transparent',
                      opacity: isEditing && !active ? 0.4 : 1,
                    },
                  ]}
                  disabled={isEditing}
                  onPress={() => handleTypeChange(option.value)}
                  testID={`savings-goal-type-${option.value}`}
                >
                  <Typography
                    variant="caption1"
                    weight="semibold"
                    color={active ? colors.white : theme.pastel.teal}
                  >
                    {option.label}
                  </Typography>
                </TouchableOpacity>
              );
            })}
          </View>

          {goalType === 'emergency_fund' && (
            <>
              <Typography variant="caption2" color={colors.textSecondary}>
                A safety pillow covers several months of essential spending, so an
                unexpected bill doesn&apos;t derail you.
              </Typography>

              <Typography
                variant="caption1"
                color={colors.textSecondary}
                style={styles.fieldLabel}
              >
                Months of expenses
              </Typography>
              <View style={styles.segmentRow}>
                {MONTH_OPTIONS.map((m) => {
                  const active = months === m;
                  return (
                    <TouchableOpacity
                      key={m}
                      style={[
                        styles.monthChip,
                        {
                          borderColor: theme.pastel.teal,
                          backgroundColor: active ? theme.pastel.teal : 'transparent',
                        },
                      ]}
                      onPress={() => setMonths(m)}
                      testID={`savings-goal-months-${m}`}
                    >
                      <Typography
                        variant="caption1"
                        weight="semibold"
                        color={active ? colors.white : theme.pastel.teal}
                      >
                        {m} mo
                      </Typography>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {suggestionLoading ? (
                <View style={styles.suggestionRow}>
                  <ActivityIndicator size="small" color={theme.pastel.teal} />
                  <Typography variant="caption2" color={colors.textSecondary}>
                    Estimating from your spending…
                  </Typography>
                </View>
              ) : noHistory ? (
                <View
                  style={[
                    styles.suggestionCard,
                    { backgroundColor: colors.groupedListBackground },
                  ]}
                >
                  <Typography variant="caption1" color={colors.textSecondary}>
                    No spending history yet — enter a target manually below.
                  </Typography>
                </View>
              ) : suggestion && suggestion.suggestedTarget > 0 ? (
                <View
                  style={[
                    styles.suggestionCard,
                    { backgroundColor: colors.groupedListBackground },
                  ]}
                >
                  <Typography variant="caption2" color={colors.textSecondary}>
                    Suggested target ({months} months)
                  </Typography>
                  <Typography variant="title3" weight="bold" color={theme.pastel.teal}>
                    {formatCurrency(suggestion.suggestedTarget)}
                  </Typography>
                  <Typography variant="caption2" color={colors.textSecondary}>
                    Based on {formatCurrency(suggestion.essentialMonthlySpending)}/mo of
                    essential spending
                  </Typography>
                </View>
              ) : null}
            </>
          )}

          {goalType === 'custom' && (
            <TextInput
              testID="savings-goal-name"
              label="Name"
              placeholder="e.g. New car fund"
              value={name}
              onChangeText={setName}
            />
          )}

          {goalType === 'emergency_fund' && (
            <TextInput
              testID="savings-goal-name-optional"
              label="Name (optional)"
              placeholder="Safety pillow"
              value={name}
              onChangeText={setName}
            />
          )}

          <TextInput
            testID="savings-goal-target"
            label="Target amount ($)"
            placeholder="0"
            value={targetAmount}
            onChangeText={(text) => {
              setTargetTouched(true);
              setTargetAmount(text);
            }}
            keyboardType="decimal-pad"
          />

          <TextInput
            testID="savings-goal-current"
            label="Already saved ($) — optional"
            placeholder="0"
            value={currentAmount}
            onChangeText={setCurrentAmount}
            keyboardType="decimal-pad"
          />

          {goalType === 'custom' && (
            <TextInput
              testID="savings-goal-allocation"
              label="Monthly allocation ($) — optional"
              placeholder="0"
              value={monthlyAllocation}
              onChangeText={setMonthlyAllocation}
              keyboardType="decimal-pad"
            />
          )}

          {goalType === 'custom' && (
            <>
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                style={styles.fieldLabel}
              >
                Target date (optional)
              </Typography>
              <TouchableOpacity
                style={[
                  styles.pickerButton,
                  {
                    borderColor: colors.borderColor,
                    backgroundColor: colors.groupedListBackground,
                  },
                ]}
                onPress={() => setShowDatePicker((prev) => !prev)}
                testID="savings-goal-date-picker"
              >
                <Typography
                  variant="body"
                  color={targetDate ? colors.textPrimary : colors.textSecondary}
                >
                  {targetDate ? targetDate.toLocaleDateString() : 'No date'}
                </Typography>
                <View style={styles.dateActions}>
                  {targetDate && (
                    <TouchableOpacity
                      onPress={() => {
                        setTargetDate(null);
                        setShowDatePicker(false);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      testID="savings-goal-date-clear"
                    >
                      <Icon
                        name="close-circle"
                        size={IconSize.md}
                        color={colors.textTertiary}
                      />
                    </TouchableOpacity>
                  )}
                  <Icon
                    name="calendar-outline"
                    size={IconSize.md}
                    color={theme.pastel.teal}
                  />
                </View>
              </TouchableOpacity>
              {showDatePicker && (
                <View style={styles.datePickerContainer}>
                  <DateTimePicker
                    value={targetDate ?? new Date()}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    minimumDate={new Date()}
                    onChange={(_event, selectedDate) => {
                      if (Platform.OS === 'android') setShowDatePicker(false);
                      if (selectedDate) setTargetDate(selectedDate);
                    }}
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity
                      onPress={() => setShowDatePicker(false)}
                      style={styles.datePickerDone}
                    >
                      <Typography variant="body" weight="semibold" color={theme.pastel.teal}>
                        Done
                      </Typography>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </>
          )}

          {isEditing && (
            <TouchableOpacity
              onPress={handleDelete}
              disabled={isDeleting}
              style={styles.deleteButton}
              testID="savings-goal-form-delete"
            >
              {isDeleting ? (
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <Typography variant="body" weight="semibold" color={colors.error}>
                  Delete goal
                </Typography>
              )}
            </TouchableOpacity>
          )}
        </ScrollView>
      </SafeAreaView>
      </AppBackground>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 16 },
  fieldLabel: { marginTop: -4 },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segmentChip: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  monthChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  suggestionCard: {
    borderRadius: 12,
    padding: 14,
    gap: 2,
  },
  pickerButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  dateActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  datePickerContainer: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  datePickerDone: { alignSelf: 'flex-end', padding: 8 },
  deleteButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
});
