import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppBackground, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';

import { languagePlanApi, type LearningPlan } from '../api/languagePlan';
import { languageProgressApi, type ProgressSnapshot } from '../api/languageProgress';

export function LanguagePlanScreen() {  const colors = useAppColors();
  const router = useRouter();
  const { content: containerPadding } = useLayoutPadding();

  const [plan, setPlan] = useState<LearningPlan | null>(null);
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Guard each backend call independently so a failure of one (or the
      // network) degrades to the empty/plan-only state instead of surfacing an
      // unhandled rejection — mirrors LanguageLearnScreen's hydration pattern.
      const [p, pr] = await Promise.all([
        languagePlanApi.getCurrent().catch(() => null),
        languageProgressApi.get().catch(() => null),
      ]);
      setPlan(p);
      setProgress(pr);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const completion =
    plan && plan.totalTasks && plan.totalTasks > 0
      ? Math.min(1, (plan.completedTasks ?? 0) / plan.totalTasks)
      : 0;

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="language-plan-screen">
        <ScreenHeader
          title="My plan"
          showBackButton
          onBackPress={() => router.back()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingHorizontal: containerPadding }]}
        >
          <AdaptiveContainer width="reading" style={styles.stack}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : !plan ? (
              <View style={styles.center}>
                <Icon name="learning-plan" size={44} color={colors.textSecondary} />
                <Typography variant="title3" weight="semibold" color={colors.textPrimary} style={styles.centerText}>
                  No learning plan yet
                </Typography>
                <Typography variant="body" color={colors.textSecondary} style={styles.centerText}>
                  Take the placement assessment and we’ll build a personalized plan for your level and goals.
                </Typography>
                <Pressable
                  testID="language-plan-start-assessment"
                  onPress={() => router.push('/language-assessment')}
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                >
                  <Typography variant="body" weight="semibold" color={colors.white}>
                    Start assessment
                  </Typography>
                </Pressable>
              </View>
            ) : (
              <>
                <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
                  <View style={styles.levelRow}>
                    <View>
                      <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
                        CURRENT LEVEL
                      </Typography>
                      <Typography variant="title2" weight="bold" color={colors.textPrimary}>
                        {plan.currentCefrLevel ?? plan.currentLevel}
                      </Typography>
                    </View>
                    {plan.targetCefrLevel && (
                      <View style={styles.targetRight}>
                        <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
                          TARGET
                        </Typography>
                        <Typography variant="title3" weight="semibold" color={colors.primary}>
                          {plan.targetCefrLevel}
                        </Typography>
                      </View>
                    )}
                  </View>
                  <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
                    <View style={[styles.progressFill, { width: `${completion * 100}%`, backgroundColor: colors.primary }]} />
                  </View>
                  <Typography variant="footnote" color={colors.textSecondary}>
                    {plan.completedTasks ?? 0}/{plan.totalTasks ?? 0} tasks · {plan.dailyMinutes} min/day
                    {plan.currentWeek ? ` · week ${plan.currentWeek}` : ''}
                  </Typography>
                </Card>

                {!!plan.goals?.length && (
                  <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
                    <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
                      GOALS
                    </Typography>
                    {plan.goals.map((g) => (
                      <View key={g} style={styles.goalRow}>
                        <Icon name="ellipse" size={7} color={colors.primary} />
                        <Typography variant="body" color={colors.textPrimary}>
                          {g}
                        </Typography>
                      </View>
                    ))}
                  </Card>
                )}

                {progress?.today && (
                  <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
                    <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
                      TODAY
                    </Typography>
                    <View style={styles.metricsRow}>
                      <Metric label="Practice" value={`${progress.today.totalPracticeMinutes ?? 0}m`} color={colors.primary} />
                      <Metric label="Grammar" value={`${Math.round((progress.today.grammarAccuracy ?? 0) * 100)}%`} color={colors.primary} />
                      <Metric label="Vocab" value={`${Math.round((progress.today.vocabularyRetention ?? 0) * 100)}%`} color={colors.primary} />
                    </View>
                  </Card>
                )}
              </>
            )}
          </AdaptiveContainer>
        </ScrollView>
      </View>
    </AppBackground>
  );
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.metric}>
      <Typography variant="title3" weight="bold" color={color}>
        {value}
      </Typography>
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  content: { paddingTop: Spacing.base, paddingBottom: Layout.bottomSafeArea + Spacing.xl },
  // The ScrollView has a single child (AdaptiveContainer), so the vertical
  // rhythm has to live here — otherwise every card stacks flush.
  stack: { gap: Spacing.base },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.xxl, gap: Spacing.sm },
  centerText: { textAlign: 'center', maxWidth: 300 },
  card: { padding: Spacing.base, gap: Spacing.sm },
  label: { letterSpacing: 0.6 },
  levelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  targetRight: { alignItems: 'flex-end' },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: Spacing.xs },
  progressFill: { height: 8, borderRadius: 4 },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xxs },
  metricsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metric: { alignItems: 'center', flex: 1, gap: Spacing.xxs },
  primaryBtn: { borderRadius: CornerRadius.md, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, alignItems: 'center', marginTop: Spacing.base },
});
