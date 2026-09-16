import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { brandId } from '@brand';
import { PermissionCard, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId } from '@components/common';
import { getNotificationBenefit } from '@config/brandContent';
import { BrandBackground, BrandButton, CheckIcon, CoachIcon, GlassCard } from '@features/kaizen/brand';
import { CommandCenterCard, ProgressRing } from '@features/kaizen/components/CommandCenter';
import { useKaizenInterviewQuestions } from '@features/kaizen/hooks/useKaizenInterviewQuestions';
import {
  groupDailyCoreActions,
  habitStackNameForAction,
  isFirstInHabitStack,
} from '@features/kaizen/services/dailyCoreOrdering';
import { publishKaizenSnapshots } from '@features/kaizen/services/kaizenWidgetSnapshot';
import { selectDueInterviewQuestions } from '@features/kaizen/stores/kaizenSelectors';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { Layout, Spacing, Typography } from '@features/kaizen/theme/designTokens';
import { useDismissiblePermissionBanner } from '@hooks/useDismissiblePermissionBanner';
import { useNotificationPermission } from '@hooks/useNotificationPermission';
import { useAuthStore } from '@stores/authStore';

import { EmptyState, kaizenScrollViewStyle, kaizenStyles } from './common';

export function TodayScreen() {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { state: pushState, busy: pushBusy, request: requestPush } = useNotificationPermission();
  const notificationBanner = useDismissiblePermissionBanner(
    pushState !== 'granted' && pushState !== 'unavailable',
  );
  const dailyCore = useKaizenStore(state => state.dailyCore);
  const todayLogs = useKaizenStore(state => state.todayLogs);
  const deepWork = useKaizenStore(state => state.deepWork);
  const { data: questions = [] } = useKaizenInterviewQuestions();
  const rotations = useKaizenStore(state => state.rotations);
  const habitStacks = useKaizenStore(state => state.habitStacks);
  const habitStackSteps = useKaizenStore(state => state.habitStackSteps);
  const wakeConfirmedToday = useKaizenStore(state => state.wakeConfirmedToday);
  const isSyncing = useKaizenStore(state => state.isSyncing);
  const completeDailyAction = useKaizenStore(state => state.completeDailyAction);
  const skipDailyAction = useKaizenStore(state => state.skipDailyAction);
  const confirmWake = useKaizenStore(state => state.confirmWake);
  const hydrate = useKaizenStore(state => state.hydrate);
  const sync = useKaizenStore(state => state.sync);

  const completedActionIds = useMemo(
    () => new Set(todayLogs.filter(log => !log.skipped && log.completed_at).map(log => log.action_id)),
    [todayLogs],
  );
  const completedCount = dailyCore.filter(action => completedActionIds.has(action.id)).length;
  const progress = dailyCore.length ? completedCount / dailyCore.length : 0;

  // Feed the Kaizen widget + Watch face (they read `widget_kaizen_today` /
  // `watch_kaizen_today` from the shared App Group). Re-published whenever today's
  // progress changes so the home screen tracks the ring without waiting for the
  // next system timeline refresh.
  const userId = useAuthStore(state => state.user?.id);
  useEffect(() => {
    void publishKaizenSnapshots({ dailyCore, todayLogs }, userId);
  }, [dailyCore, todayLogs, userId]);
  const dueQuestions = selectDueInterviewQuestions(questions);
  const weekday = ((new Date().getDay() + 6) % 7) + 1; // 1 Mon ... 7 Sun
  const rotation = rotations.find(item => item.weekday === weekday);
  const today = new Date().toISOString().slice(0, 10);
  const todayDeepWork = deepWork.filter(block => block.date === today);
  const groupedDailyCore = useMemo(
    () => groupDailyCoreActions(dailyCore, habitStackSteps),
    [dailyCore, habitStackSteps],
  );

  const onRefresh = async () => {
    await hydrate();
    await sync();
  };

  return (
    <BrandBackground>
      <View testID="kaizen-today-screen" style={styles.screenRoot}>
      <ScreenHeader
        onNotificationPress={() => router.push('/kaizen/notifications')}
        onProfilePress={() => router.push('/profile')}
      />
      <ScrollView
        testID="kaizen-today-scroll"
        style={kaizenScrollViewStyle.scroll}
        contentContainerStyle={[
          styles.content,
          kaizenScrollViewStyle.contentGrow,
          { paddingBottom: Spacing.xxl + insets.bottom + 49 },
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isSyncing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.primary}
          />
        }
      >
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
            testID="kaizen-today-notification-permission-card"
          />
        ) : null}

        <Text
          style={[
            styles.title,
            {
              color: colors.textPrimary,
              fontSize: Typography.display.size,
              lineHeight: Typography.display.lineHeight,
              fontWeight: Typography.display.weight,
              letterSpacing: Typography.display.letterSpacing,
            },
          ]}
        >
          Today
        </Text>
        <Text style={{ color: colors.textSecondary, marginBottom: Spacing.md }}>
          {completedCount} of {dailyCore.length} daily actions complete
        </Text>

        {!wakeConfirmedToday && (
          <GlassCard strong>
            <View style={styles.wakeRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 16 }}>
                  Start your day
                </Text>
                <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                  Confirm you are up and ready.
                </Text>
              </View>
              <BrandButton
                title="Confirm"
                style={{ width: 120 }}
                onPress={() => void confirmWake()}
              />
            </View>
          </GlassCard>
        )}

        <CommandCenterCard tint={colors.primary}>
          <View style={styles.progressHeader}>
            <Text
              testID="kaizen-daily-core-header"
              style={{ color: colors.primary, fontWeight: '700', fontSize: 17 }}
            >
              Daily Core
            </Text>
            <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>
              {completedCount}/{dailyCore.length}
            </Text>
          </View>
          <View style={styles.ringWrap}>
            <ProgressRing progress={progress} />
          </View>
          {progress >= 1 && dailyCore.length > 0 ? (
            <View style={[styles.completePill, { backgroundColor: `${colors.success}22` }]}>
              <Text style={{ color: colors.success, fontWeight: '600' }}>
                Daily Core complete
              </Text>
            </View>
          ) : null}
        </CommandCenterCard>

        {rotation?.focus_title ? (
          <CommandCenterCard>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>
              TODAY&apos;S FOCUS
            </Text>
            <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 4 }}>
              {rotation.focus_title}
            </Text>
            {rotation.system ? (
              <Text style={{ color: colors.textSecondary, marginTop: 2 }}>{rotation.system}</Text>
            ) : null}
          </CommandCenterCard>
        ) : null}

        {groupedDailyCore.map(group => (
            <CommandCenterCard key={group.timeOfDay}>
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 12,
                  fontWeight: '700',
                  letterSpacing: 0.4,
                  marginBottom: 8,
                  textTransform: 'uppercase',
                }}
              >
                {group.timeOfDay}
              </Text>
              {group.actions.map(action => {
                const logged = todayLogs.find(log => log.action_id === action.id);
                const done = Boolean(logged?.completed_at);
                const stackName = habitStackNameForAction(action, habitStacks, habitStackSteps);
                const stackLead = isFirstInHabitStack(action, group.actions, habitStackSteps);
                return (
                  <View
                    key={action.id}
                    style={[kaizenStyles.row, { borderBottomColor: colors.borderColor, paddingHorizontal: 0 }]}
                  >
                    {done ? (
                      <CheckIcon size={22} gradient />
                    ) : (
                      <View style={[styles.bullet, { borderColor: colors.borderColor }]} />
                    )}
                    <View style={kaizenStyles.rowText}>
                      {stackLead && stackName ? (
                        <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>
                          {stackName}
                        </Text>
                      ) : null}
                      <Text
                        style={{
                          color: done ? colors.textSecondary : colors.textPrimary,
                          fontSize: 16,
                          fontWeight: '500',
                          textDecorationLine: done ? 'line-through' : 'none',
                        }}
                      >
                        {action.title}
                      </Text>
                      <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                        {action.output_description || action.system}
                      </Text>
                      {action.voice_log_prompt && !done ? (
                        <Text style={[kaizenStyles.detail, { color: colors.textSecondary, fontStyle: 'italic' }]}>
                          Say: “{action.voice_log_prompt}”
                        </Text>
                      ) : null}
                      {action.watch_quick_log_enabled ? (
                        <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>
                          Watch quick-log
                        </Text>
                      ) : null}
                    </View>
                    {logged?.skipped ? (
                      <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>Skipped</Text>
                    ) : done ? (
                      <View style={[styles.autoBadge, { backgroundColor: `${colors.success}22` }]}>
                        <Text style={{ color: colors.success, fontWeight: '700', fontSize: 11 }}>
                          {logged?.source === 'watch' || logged?.source === 'notification' ? 'auto' : 'done'}
                        </Text>
                      </View>
                    ) : (
                      <>
                        <Pressable
                          style={[styles.complete, { borderColor: colors.primary }]}
                          onPress={() => void completeDailyAction(action.id)}
                        >
                          <Text style={{ color: colors.primary, fontWeight: '700' }}>Done</Text>
                        </Pressable>
                        <Pressable onPress={() => void skipDailyAction(action.id)}>
                          <Text style={{ color: colors.textSecondary }}>Skip</Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                );
              })}
            </CommandCenterCard>
          ))}

        {dailyCore.length === 0 && (
          <CommandCenterCard>
            <EmptyState>Your daily core will appear here after onboarding.</EmptyState>
          </CommandCenterCard>
        )}

        <CommandCenterCard>
          <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '700' }}>
            CAREER REPS
          </Text>
          <Pressable
            testID="kaizen-today-career-reps-open"
            style={[kaizenStyles.row, { borderBottomWidth: 0, paddingHorizontal: 0 }]}
            onPress={() => router.push('/kaizen/banks')}
          >
            <View style={kaizenStyles.rowText}>
              <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
                {dueQuestions.length} questions due
              </Text>
              <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                Keep your interview recall fresh.
              </Text>
            </View>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Open</Text>
          </Pressable>
        </CommandCenterCard>

        <CommandCenterCard>
          <View style={styles.progressHeader}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '700' }}>
              DEEP WORK
            </Text>
            <Pressable onPress={() => router.push('/kaizen/deep-work')}>
              <Text style={{ color: colors.primary, fontWeight: '700' }}>Add</Text>
            </Pressable>
          </View>
          {todayDeepWork.length === 0 ? (
            <Text style={{ color: colors.textSecondary, marginTop: 8 }}>
              No focus blocks scheduled today.
            </Text>
          ) : (
            todayDeepWork.map(block => (
              <View
                key={block.id}
                style={[kaizenStyles.row, { borderBottomColor: colors.borderColor, paddingHorizontal: 0 }]}
              >
                <Text style={[kaizenStyles.rowText, { color: colors.textPrimary }]}>
                  {block.topic ?? 'Focus block'}
                </Text>
                <Text style={{ color: colors.textSecondary }}>
                  {[block.start_time, block.end_time].filter(Boolean).join(' – ') || 'Unscheduled'}
                </Text>
              </View>
            ))
          )}
        </CommandCenterCard>

        <Pressable style={styles.coach} onPress={() => router.push('/mira')}>
          <CoachIcon size={20} color={colors.primary} />
          <Text style={{ color: colors.primary, fontWeight: '700' }}>
            Ask your coach for a next step →
          </Text>
        </Pressable>
        <ScreenScrollEnd testID={screenScrollEndTestId('kaizen-today-screen')} />
      </ScrollView>
      </View>
    </BrandBackground>
  );
}

const styles = StyleSheet.create({
  screenRoot: { flex: 1 },
  content: {
    paddingHorizontal: Layout.pageMargin,
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  title: { marginBottom: Spacing.xs },
  wakeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  ringWrap: { alignItems: 'center', paddingVertical: Spacing.md },
  completePill: {
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  bullet: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  complete: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  autoBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  coach: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
});
