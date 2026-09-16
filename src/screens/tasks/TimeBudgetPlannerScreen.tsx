/**
 * TimeBudgetPlannerScreen — "I have N minutes, what can I do right now?"
 *
 * Asks the backend planner (deterministic selection over risk + priority +
 * urgency + effort) for the set of tasks — and partial subtasks — that fit a
 * chosen time budget, then renders them as an ordered, actionable plan. Each
 * task shows its effort tier (Quick … All day), not a precise time.
 */
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity } from 'react-native';


import { tasksApi, TaskBudgetPlan, TIME_EFFORT_LABELS } from '@api/tasks';
import { AppBackground, SafeAreaView, screenScrollViewStyle, ScreenHeader } from '@components/common';
import { Typography, Card, Chip } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import type { TasksStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { Layout, Spacing, useAppColors } from '@theme';

type PlannerNavigationProp = NativeStackNavigationProp<TasksStackParamList>;

const BUDGET_OPTIONS = [15, 30, 60, 120];

function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function TimeBudgetPlannerScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<PlannerNavigationProp>();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);

  const [budget, setBudget] = useState(60);
  const [plan, setPlan] = useState<TaskBudgetPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadPlan = useCallback(
    async (minutes: number) => {
      if (!currentHousehold) return;
      setIsLoading(true);
      try {
        const result = await tasksApi.getPlan(currentHousehold.id, minutes);
        setPlan(result);
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : 'Failed to build plan');
      } finally {
        setIsLoading(false);
      }
    },
    [currentHousehold]
  );

  useEffect(() => {
    loadPlan(budget);
  }, [budget, loadPlan]);

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView style={styles.container} testID="time-budget-planner-screen">
        {/* Header */}
        <ScreenHeader
        title="What can I do now?"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

        <ScrollView
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Typography variant="body" color={colors.textSecondary} style={styles.prompt}>
            How much time do you have?
          </Typography>

          {/* Budget chooser */}
          <View style={styles.chips}>
            {BUDGET_OPTIONS.map((opt) => (
              <Chip
                key={opt}
                label={formatMinutes(opt)}
                variant={budget === opt ? 'primary' : 'secondary'}
                onPress={() => setBudget(opt)}
              />
            ))}
          </View>

          {isLoading && (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}

          {!isLoading && plan && (
            <>
              {/* Summary */}
              <Card style={styles.summaryCard}>
                <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                  {plan.selected.length === 0
                    ? 'Nothing fits this window'
                    : `${plan.selected.length} task${plan.selected.length === 1 ? '' : 's'} · ${formatMinutes(plan.used_minutes)}`}
                </Typography>
                <Typography variant="footnote" color={colors.textSecondary}>
                  {plan.selected.length === 0
                    ? 'Try a longer window, or your tasks may need a contractor.'
                    : `Using ${formatMinutes(plan.used_minutes)} of your ${formatMinutes(plan.budget_minutes)}.`}
                </Typography>
              </Card>

              {/* Selected plan */}
              {plan.selected.map((item, idx) => (
                <TouchableOpacity
                  key={`${item.task_id}-${idx}`}
                  onPress={() =>
                    navigation.navigate('TaskDetailFlow', {
                      screen: 'TaskDetail',
                      params: { taskId: item.task_id },
                    })
                  }
                  activeOpacity={0.8}
                >
                  <Card style={styles.taskCard}>
                    <View style={styles.taskRow}>
                      <View style={[styles.indexBadge, { backgroundColor: colors.primary }]}>
                        <Typography variant="footnote" weight="bold" color={colors.white}>
                          {idx + 1}
                        </Typography>
                      </View>
                      <View style={styles.taskBody}>
                        <Typography variant="headline" weight="semibold" color={colors.textPrimary} numberOfLines={2}>
                          {item.title}
                        </Typography>
                        <Typography variant="caption2" color={colors.textSecondary}>
                          {item.reason}
                        </Typography>
                      </View>
                      <View style={styles.taskMeta}>
                        {item.time_effort && (
                          <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                            {TIME_EFFORT_LABELS[item.time_effort]}
                          </Typography>
                        )}
                        {item.partial && (
                          <Typography variant="caption2" color={colors.primary}>
                            partial
                          </Typography>
                        )}
                      </View>
                    </View>
                  </Card>
                </TouchableOpacity>
              ))}

              {/* Skipped (didn't fit) */}
              {plan.skipped.length > 0 && (
                <View style={styles.skippedSection}>
                  <Typography variant="footnote" weight="semibold" color={colors.textSecondary} style={styles.skippedHeader}>
                    Didn't fit ({plan.skipped.length})
                  </Typography>
                  {plan.skipped.map((item, idx) => (
                    <View key={`${item.task_id}-${idx}`} style={styles.skippedRow}>
                      <Typography variant="footnote" color={colors.textSecondary} numberOfLines={1} style={styles.skippedTitle}>
                        {item.title}
                      </Typography>
                      <Typography variant="caption2" color={colors.textSecondary}>
                        {item.reason === 'too_long'
                          ? item.time_effort
                            ? `${TIME_EFFORT_LABELS[item.time_effort]} — too big`
                            : 'too big'
                          : 'no time left'}
                      </Typography>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    paddingHorizontal: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
  },
  prompt: {
    marginBottom: Spacing.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  loading: {
    padding: Spacing.xxl + Spacing.sm,
    alignItems: 'center',
  },
  summaryCard: {
    padding: Spacing.base,
    marginBottom: Spacing.base,
    gap: Spacing.xs,
  },
  taskCard: {
    padding: Spacing.md + Spacing.xxs,
    marginBottom: Spacing.smd,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  indexBadge: {
    width: Spacing.xl + Spacing.xxs,
    height: Spacing.xl + Spacing.xxs,
    borderRadius: (Spacing.xl + Spacing.xxs) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  taskBody: {
    flex: 1,
    gap: Spacing.xxs,
  },
  taskMeta: {
    marginLeft: Spacing.smd,
    alignItems: 'flex-end',
  },
  skippedSection: {
    marginTop: Spacing.base,
  },
  skippedHeader: {
    marginBottom: Spacing.sm,
  },
  skippedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs + Spacing.xxs,
  },
  skippedTitle: {
    flex: 1,
    marginRight: Spacing.md,
  },
});
