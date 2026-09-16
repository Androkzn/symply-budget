import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { brandId } from '@brand';
import { AppBackground, PermissionCard, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, IconBackgroundChip, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { getNotificationBenefit } from '@config/brandContent';
import { useDismissiblePermissionBanner } from '@hooks/useDismissiblePermissionBanner';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useNotificationPermission } from '@hooks/useNotificationPermission';
import { useAuthStore } from '@stores/authStore';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';

import { languageAssessmentApi } from '../api/languageAssessment';
import { languageCardsApi } from '../api/languageCards';
import { languagePlanApi } from '../api/languagePlan';
import {
  type DailyGoalId,
  type LanguageDaily,
  DAILY_GOALS,
  allGoalsComplete,
  completedGoalCount,
  loadDaily,
  loadStreak,
  saveDaily,
  updateStreakOnGoalChange,
} from '../languageLocalStorage';
import { publishLanguageSnapshots } from '../languageWidgetSnapshot';

interface NavCard {
  key: string;
  icon: string;
  title: string;
  subtitle: string;
  route: string;
  badge?: string;
}

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function LanguageLearnScreen() {  const colors = useAppColors();
  const router = useRouter();
  const { content: containerPadding } = useLayoutPadding();
  const displayName = useAuthStore((state) => state.user?.display_name);
  const { state: pushState, busy: pushBusy, request: requestPush } = useNotificationPermission();
  const notificationBanner = useDismissiblePermissionBanner(
    pushState !== 'granted' && pushState !== 'unavailable',
  );

  const [daily, setDaily] = useState<LanguageDaily | null>(null);
  const [streakCount, setStreakCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [assessmentDue, setAssessmentDue] = useState(true);
  const [hasPlan, setHasPlan] = useState(false);
  const [dueCount, setDueCount] = useState(0);

  const hydrateLocal = useCallback(async () => {
    const [nextDaily, streak] = await Promise.all([loadDaily(), loadStreak()]);
    setDaily(nextDaily);
    setStreakCount(streak.count);
    setLoading(false);
  }, []);

  const hydrateBackend = useCallback(async () => {
    const [status, plan, due] = await Promise.all([
      languageAssessmentApi.getStatus().catch(() => null),
      languagePlanApi.getCurrent().catch(() => null),
      languageCardsApi.due().catch(() => ({ dueCards: [], totalDue: 0 })),
    ]);
    if (status) setAssessmentDue(status.due);
    setHasPlan(!!plan);
    setDueCount(due.totalDue ?? 0);
  }, []);

  useEffect(() => {
    void hydrateLocal();
  }, [hydrateLocal]);

  // Refresh backend-driven state whenever the tab regains focus (e.g. after an
  // assessment or review completes on a pushed screen).
  useFocusEffect(
    useCallback(() => {
      void hydrateBackend();
    }, [hydrateBackend]),
  );

  // Feed the Language widget + Watch face as today's progress changes, so the home
  // screen tracks the streak without waiting for the next system timeline refresh.
  // Both keys go through the shared producer in `languageWidgetSnapshot.ts` — the
  // same one `app/_layout.tsx` publishes from on sign-in — so a screen render and a
  // cold launch can never disagree about today.
  const userId = useAuthStore((state) => state.user?.id);
  useEffect(() => {
    publishLanguageSnapshots(
      { streak: streakCount, wordsDue: dueCount, assessmentDue, hasPlan },
      userId,
    );
  }, [streakCount, dueCount, assessmentDue, hasPlan, userId]);

  const toggleGoal = useCallback(
    async (id: DailyGoalId) => {
      if (!daily) return;
      const goals = { ...daily.goals, [id]: !daily.goals[id] };
      const next: LanguageDaily = { ...daily, goals };
      setDaily(next);
      await saveDaily(next);
      const streak = await updateStreakOnGoalChange(goals);
      setStreakCount(streak.count);
    },
    [daily],
  );

  const greeting = greetingForNow();
  const nameSuffix = displayName ? `, ${displayName.split(' ')[0]}` : '';
  const completed = daily ? completedGoalCount(daily.goals) : 0;
  const allDone = daily ? allGoalsComplete(daily.goals) : false;

  const navCards: NavCard[] = [
    assessmentDue && !hasPlan
      ? {
          key: 'assessment',
          icon: 'assessment',
          title: 'Placement assessment',
          subtitle: 'Find your level and unlock a personalized plan',
          route: '/language-assessment',
        }
      : {
          key: 'plan',
          icon: 'learning-plan',
          title: 'My learning plan',
          subtitle: hasPlan ? 'Track your progress and goals' : 'Build your plan',
          route: '/language-plan',
        },
    {
      key: 'review',
      icon: 'review-due',
      title: 'Review vocabulary',
      subtitle: dueCount > 0 ? `${dueCount} card${dueCount === 1 ? '' : 's'} due now` : 'Spaced-repetition practice',
      route: '/language-review',
      badge: dueCount > 0 ? String(dueCount) : undefined,
    },
    {
      key: 'dialogue',
      icon: 'conversation',
      title: 'Conversation practice',
      subtitle: 'Role-play a real scene with translations',
      route: '/language-dialogue',
    },
    {
      key: 'tutor',
      icon: 'teaching-chat',
      title: 'Talk to your tutor',
      subtitle: 'Ask anything — practice a real conversation',
      route: '/chat',
    },
  ];

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="language-learn-screen">
        <ScreenHeader
          onNotificationPress={() => router.push('/notifications')}
          onProfilePress={() => router.push('/profile')}
        />

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            testID="language-learn-scroll"
            style={styles.scrollView}
            contentContainerStyle={[styles.content, { paddingHorizontal: containerPadding }]}
            showsVerticalScrollIndicator={false}
          >
            <AdaptiveContainer width="reading" style={styles.stack}>
              {notificationBanner.visible ? (
                <PermissionCard
                  state={pushState}
                  icon="notifications"
                  title="Notifications"
                  copy={{
                    'not-requested': { body: getNotificationBenefit(brandId) },
                    denied: {
                      body: "That's a fine choice — everything still works without them. If you change your mind, notifications live in Settings.",
                    },
                  }}
                  onRequest={() => void requestPush()}
                  onOpenSettings={() => void Linking.openSettings()}
                  onDismiss={notificationBanner.dismiss}
                  busy={pushBusy}
                  layout="compact"
                  testID="language-learn-notification-permission-card"
                />
              ) : null}

              <View style={styles.intro}>
                <Typography variant="title2" weight="bold" color={colors.textPrimary}>
                  {greeting}
                  {nameSuffix}
                </Typography>
                <Typography variant="body" color={colors.textSecondary}>
                  A little every day — keep your streak going.
                </Typography>
              </View>

              <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
                <View style={styles.streakRow}>
                  <View style={[styles.streakBadge, { backgroundColor: colors.primary + '1F' }]}>
                    <Icon name="streak" size={22} color={colors.primary} />
                  </View>
                  <View style={styles.streakCopy}>
                    <Typography variant="title3" weight="semibold" color={colors.textPrimary}>
                      {streakCount} day{streakCount === 1 ? '' : 's'}
                    </Typography>
                    <Typography variant="footnote" color={colors.textSecondary}>
                      Practice streak — finish all 3 goals to keep it going
                    </Typography>
                  </View>
                </View>
              </Card>

              {navCards.map((card) => (
                <Card
                  key={card.key}
                  accessibilityLabel={card.title}
                  variant="filled"
                  pressable
                  onPress={() => router.push(card.route as never)}
                  style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
                >
                  <View testID={`language-learn-nav-${card.key}`} style={styles.nextRow}>
                    <IconBackgroundChip name={card.icon} size={20} style={styles.iconTile} />
                    <View style={styles.nextBody}>
                      <Typography variant="body" weight="medium" color={colors.textPrimary}>
                        {card.title}
                      </Typography>
                      <Typography variant="footnote" color={colors.textSecondary}>
                        {card.subtitle}
                      </Typography>
                    </View>
                    {card.badge ? (
                      <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                        <Typography variant="caption1" weight="bold" color={colors.white}>
                          {card.badge}
                        </Typography>
                      </View>
                    ) : (
                      <Icon name="chevron-forward" size={20} color={colors.textSecondary} />
                    )}
                  </View>
                </Card>
              ))}

              <Card
                variant="filled"
                style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
                testID="language-learn-daily-goals"
              >
                <View style={styles.cardHeaderRow}>
                  <Typography variant="title3" weight="semibold" color={colors.textPrimary}>
                    {allDone ? 'All done — great work' : 'Daily goals'}
                  </Typography>
                  <Typography variant="footnote" color={colors.textSecondary}>
                    {completed}/{DAILY_GOALS.length}
                  </Typography>
                </View>

                {DAILY_GOALS.map((goal) => {
                  const checked = !!daily?.goals[goal.id];
                  return (
                    <Pressable
                      key={goal.id}
                      testID={`language-learn-goal-${goal.id}`}
                      style={styles.goalRow}
                      onPress={() => void toggleGoal(goal.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked, selected: checked }}
                      accessibilityLabel={goal.label}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          {
                            borderColor: checked ? colors.primary : colors.borderColor,
                            backgroundColor: checked ? colors.primary : 'transparent',
                          },
                        ]}
                      >
                        {checked && <Icon name="checkmark" size={16} color={colors.white} />}
                      </View>
                      <Typography
                        variant="body"
                        color={checked ? colors.textSecondary : colors.textPrimary}
                        style={checked ? styles.goalDone : undefined}
                      >
                        {goal.label}
                      </Typography>
                    </Pressable>
                  );
                })}
              </Card>
            </AdaptiveContainer>
          </ScrollView>
        )}
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollView: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingTop: Spacing.base, paddingBottom: Layout.bottomTabBarClearance },
  // The ScrollView has a single child (AdaptiveContainer), so the vertical
  // rhythm has to live here — otherwise every card stacks flush.
  stack: { gap: Spacing.base },
  intro: { gap: Spacing.xs },
  card: { padding: Spacing.base, gap: Spacing.sm },
  sectionLabel: { letterSpacing: 0.6 },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xxs,
  },
  streakRow: { flexDirection: 'row', alignItems: 'center' },
  streakBadge: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md },
  streakCopy: { flex: 1, gap: Spacing.xxs },
  nextRow: { flexDirection: 'row', alignItems: 'center' },
  iconTile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md },
  nextBody: { flex: 1, gap: Spacing.xxs },
  badge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' },
  goalRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: CornerRadius.xs + Spacing.xxs,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  goalDone: { textDecorationLine: 'line-through' },
});
