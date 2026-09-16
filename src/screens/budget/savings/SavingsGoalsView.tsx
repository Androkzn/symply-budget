import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { savingsApi, type SavingsGoal } from '@api/savings';
import { Card, GradientButton, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useSavingsStore } from '@stores/savingsStore';
import {
  CornerRadius,
  IconSize,
  Layout,
  Spacing,
  useAppColors,
} from '@theme';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

/**
 * Savings → Goals sub-view (Task 2.1). Prop-less tab body that self-fetches its
 * goal list. Every money figure (target / current / paceCents) is BE-computed —
 * this view only renders them and derives the progress bar width as a pure
 * visual ratio (not a financial recomputation).
 */

const GOAL_TYPE_LABEL: Record<SavingsGoal['type'], string> = {
  emergency_fund: 'Safety pillow',
  custom: 'Custom goal',
};

function paceText(goal: SavingsGoal): string | null {
  if (goal.status === 'achieved') return 'Fully funded 🎉';
  if (goal.paceCents && goal.paceCents > 0) {
    return `Set aside ${formatCurrency(goal.paceCents)}/mo to stay on track`;
  }
  if (goal.monthly_allocation_cents && goal.monthly_allocation_cents > 0) {
    return `Allocating ${formatCurrency(goal.monthly_allocation_cents)}/mo`;
  }
  return null;
}

/** Pure visual ratio for the progress bar — clamped 0..1, not a money figure. */
function progressRatio(goal: SavingsGoal): number {
  if (goal.target_amount_cents <= 0) return 0;
  const ratio = goal.current_amount_cents / goal.target_amount_cents;
  if (!Number.isFinite(ratio) || ratio < 0) return 0;
  return Math.min(1, ratio);
}

export function SavingsGoalsView() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const { currentHousehold } = useHouseholdStore();
  const { dataRevision } = useSavingsStore();

  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentHousehold?.id) {
      // No household hydrated yet — drop into the empty state instead of leaving
      // the spinner stuck forever (Budget's decoupled households can be unset).
      setGoals([]);
      setIsLoading(false);
      return;
    }
    try {
      const res = await savingsApi.listGoals(currentHousehold.id);
      setGoals(res.goals);
    } catch (error) {
      console.error('Error loading savings goals:', error);
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold?.id]);

  useEffect(() => {
    setIsLoading(true);
    void load();
  }, [currentHousehold?.id, dataRevision, load]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer} testID="savings-goals-loading">
        <ActivityIndicator size="large" color={theme.pastel.teal} />
      </View>
    );
  }

  return (
    <View style={styles.container} testID="savings-goals">
      {/* Registered accounts (RRSP/TFSA/FHSA/pensions) now live in the dedicated
          Budget → Pension tab, so this view no longer links out to them. */}
      <View style={styles.headerRow}>
        <Typography variant="title3" weight="semibold">
          Savings goals
        </Typography>
      </View>

      {goals.length === 0 ? (
        <Card variant="elevated" style={styles.emptyCard} testID="savings-goals-empty">
          <View style={styles.emptyBadge}>
            <Icon name="flag" size={72} color={theme.pastel.teal} />
          </View>

          <Typography
            variant="title3"
            weight="bold"
            align="center"
            style={styles.emptyTitle}
          >
            No savings goals yet
          </Typography>
          <Typography
            variant="body"
            color={colors.textSecondary}
            align="center"
            style={styles.emptyDescription}
          >
            Build a safety pillow or set a custom goal, and we&apos;ll pace your monthly savings
            toward it.
          </Typography>

          <GradientButton
            title="Add goal"
            variant="teal"
            size="md"
            fullWidth
            icon={<Icon name="add" size={IconSize.md} color={colors.white} />}
            onPress={() => navigation.navigate('SavingsGoalForm')}
            style={styles.emptyButton}
            testID="savings-goals-add-empty"
          />
        </Card>
      ) : (
        <>
          {goals.map((goal) => {
            const ratio = progressRatio(goal);
            const pace = paceText(goal);
            return (
              <Card
                key={goal.id}
                variant="elevated"
                pressable
                onPress={() => navigation.navigate('SavingsGoalForm', { goalId: goal.id })}
                style={styles.goalCard}
                testID={`savings-goal-card-${goal.id}`}
              >
                <View style={styles.goalTop}>
                  <View style={styles.goalTitleWrap}>
                    <Typography variant="headline" weight="semibold" numberOfLines={1}>
                      {goal.name}
                    </Typography>
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {GOAL_TYPE_LABEL[goal.type]}
                    </Typography>
                  </View>
                  <Icon
                    name="chevron-forward"
                    size={IconSize.md}
                    color={colors.textTertiary}
                  />
                </View>

                <View style={styles.amountRow}>
                  <Typography variant="title3" weight="bold">
                    {formatCurrency(goal.current_amount_cents)}
                  </Typography>
                  <Typography variant="body" color={colors.textSecondary}>
                    {' '}
                    of {formatCurrency(goal.target_amount_cents)}
                  </Typography>
                </View>

                <View style={[styles.progressTrack, { backgroundColor: colors.divider }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.round(ratio * 100)}%`,
                        backgroundColor:
                          goal.status === 'achieved' ? colors.success : theme.pastel.teal,
                      },
                    ]}
                  />
                </View>

                {pace && (
                  <Typography
                    variant="caption1"
                    color={colors.textSecondary}
                    style={styles.paceText}
                  >
                    {pace}
                  </Typography>
                )}
              </Card>
            );
          })}

          <GradientButton
            title="Add goal"
            variant="teal"
            size="md"
            fullWidth
            icon={<Icon name="add" size={IconSize.md} color={colors.white} />}
            onPress={() => navigation.navigate('SavingsGoalForm')}
            style={styles.addButton}
            testID="savings-goals-add-list"
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.md,
    paddingBottom: Layout.bottomTabBarClearance,
  },
  loadingContainer: {
    paddingVertical: Spacing.xxl * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    gap: Spacing.xs,
  },
  emptyBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.base,
  },
  emptyTitle: {
    marginBottom: Spacing.xxs,
  },
  emptyDescription: {
    maxWidth: 300,
    marginBottom: Spacing.lg,
  },
  emptyButton: {
    marginTop: Spacing.sm,
  },
  goalCard: {
    gap: Spacing.sm,
  },
  goalTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  goalTitleWrap: {
    flex: 1,
    gap: Spacing.xxs,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  progressTrack: {
    height: 8,
    borderRadius: CornerRadius.xs,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: CornerRadius.xs,
  },
  paceText: {
    marginTop: Spacing.xxs,
  },
  addButton: {
    marginTop: Spacing.sm,
  },
});
