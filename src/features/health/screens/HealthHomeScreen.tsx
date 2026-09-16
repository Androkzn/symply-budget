import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, Linking, ScrollView, StyleSheet, View } from 'react-native';

import { brandId } from '@brand';
import { AppBackground, PermissionCard, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { getNotificationBenefit } from '@config/brandContent';
import { visibleGlanceKeys, visibleHomeRingKeys, visibleHomeWidgets } from '@config/healthFeatures';
import { useDismissiblePermissionBanner } from '@hooks/useDismissiblePermissionBanner';
import { useHealthFeatures } from '@hooks/useHealthFeature';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useNotificationPermission } from '@hooks/useNotificationPermission';
import { useAuthStore } from '@stores/authStore';
import { Layout, Spacing, useAppColors } from '@theme';

import {
  buildHomeMetricDetail,
  DEFAULT_HOME_WIDGETS,
  HealthHomeMetricSheet,
  HealthHomeWidget,
  HealthKitConnectCard,
  HealthKitSyncProgressModal,
  homeMetricFromTarget,
  homeMetricTarget,
  HOME_WIDGET_KEYS,
  type HealthGlanceCard,
  type HomeMetricKey,
  type HomeMetricSources,
  type HomeWidgetModel,
} from '../components';
import {
  DEFAULT_ACTIVITY_GOALS,
  loadActivityGoals,
  loadStepDays,
  loadWorkouts,
  recentDayKeys,
  type ActivityGoals,
  type StepDay,
  type WorkoutEntry,
} from '../healthActivityStorage';
import {
  PRIMARY_BODY_METRICS,
  loadBodyEntries,
  summarizeBody,
  type BodyEntry,
} from '../healthBodyStorage';
import {
  loadChallengesWeeklyOverview,
  loadChallengesWidgetExpanded,
  saveChallengesWidgetExpanded,
  type ChallengeWeeklyOverviewEntry,
} from '../healthChallengesStorage';
import { isDoneOn, loadHabits, type Habit } from '../healthHabitsStorage';
import { loadHomeLayout } from '../healthHomeStorage';
import {
  adjustWater,
  DEFAULT_HEALTH_PREFS,
  DEFAULT_WATER_TARGET,
  loadHealthPrefs,
  loadNoteForDate,
  loadWaterHistory,
  loadWaterToday,
  loadWeightLog,
  saveNoteForDate,
  todayDateKey,
  type WaterDay,
  type WeightEntry,
  type WeightUnit,
} from '../healthLocalStorage';
import {
  DEFAULT_NUTRITION_GOALS,
  loadMeals,
  loadNutritionGoals,
  sumNutrition,
  type MealEntry,
  type NutritionGoals,
} from '../healthNutritionStorage';
import {
  EMPTY_SLEEP_LOG,
  loadSleepLog,
  logSleep,
  parseSleepHoursInput,
  sanitizeSleepInput,
  summarizeSleep,
  type SleepLog,
} from '../healthSleepStorage';
import { loadWeeklyTrend, type HealthWeeklyTrendResponse } from '../healthWeeklyTrendStorage';
import { moveFraction, publishHealthGlance } from '../healthWidgetStorage';
import { useHealthKitConnection } from '../useHealthKitConnection';
import { useHealthKitSyncHydration } from '../useHealthKitSyncHydration';

/** The window every drill-down and the sleep card summarise. */
const HOME_TREND_DAYS = 7;

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Home — the donor's Dashboard.
 *
 * The donor's dashboard is a ring for the calorie budget, a 2×2 "Quick Stats"
 * grid of tappable tiles, and a short list of what was logged. This rebuilds
 * that shape on the surfaces this app actually has: three goal rings for the
 * day, an at-a-glance grid and a sleep card — on top of the manual water /
 * note entry Home already owned.
 *
 * Two things about this screen are deliberate and must survive any edit:
 *
 *  1. THE CARDS ARE REORDERABLE. `DashboardLayoutManager` keeps the donor's nine
 *     widgets in a stored order with move / hide / reset, and Home was a fixed
 *     stack. The cards now live in `HealthHomeWidgets` and the order comes from
 *     `healthHomeStorage` — the same mechanism the Weight tab already uses, not
 *     a second one.
 *
 *  2. NO `InputAccessoryView`. Home used to mount two of them for the "Done"
 *     buttons. Under the New Architecture they render nothing AND swallow the
 *     pan gesture for the whole screen — Home was unscrollable for every member.
 *     The replacements are ordinary rows inside their card.
 */
export function HealthHomeScreen() {
  const colors = useAppColors();
  const router = useRouter();
  const { content: containerPadding } = useLayoutPadding();
  const displayName = useAuthStore((state) => state.user?.display_name);

  const { state: pushState, busy: pushBusy, request: requestPush } = useNotificationPermission();
  const notificationBanner = useDismissiblePermissionBanner(
    pushState !== 'granted' && pushState !== 'unavailable',
  );
  const {
    status: healthKitStatus,
    busy: healthKitBusy,
    syncing: healthKitSyncing,
    progress: healthKitProgress,
    connectOrSync: handleHealthKit,
  } = useHealthKitConnection();
  const healthKitBanner = useDismissiblePermissionBanner(
    healthKitStatus !== null &&
      healthKitStatus.state !== 'connected' &&
      healthKitStatus.state !== 'unavailable',
  );
  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [draftUnit, setDraftUnit] = useState<WeightUnit>(DEFAULT_HEALTH_PREFS.preferredUnit);
  const [waterDay, setWaterDay] = useState<WaterDay | null>(null);
  const [waterHistory, setWaterHistory] = useState<WaterDay[]>([]);
  const [noteDraft, setNoteDraft] = useState('');
  const [allMeals, setAllMeals] = useState<MealEntry[]>([]);
  const [nutritionGoals, setNutritionGoals] = useState<NutritionGoals>(DEFAULT_NUTRITION_GOALS);
  const [workouts, setWorkouts] = useState<WorkoutEntry[]>([]);
  const [stepDays, setStepDays] = useState<StepDay[]>([]);
  const [activityGoals, setActivityGoals] = useState<ActivityGoals>(DEFAULT_ACTIVITY_GOALS);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [bodyEntries, setBodyEntries] = useState<BodyEntry[]>([]);
  const [sleep, setSleep] = useState<SleepLog>(EMPTY_SLEEP_LOG);
  const [sleepDraft, setSleepDraft] = useState('');
  const [weeklyTrend, setWeeklyTrend] = useState<HealthWeeklyTrendResponse | null>(null);
  const [challengesOverview, setChallengesOverview] = useState<ChallengeWeeklyOverviewEntry[]>([]);
  const [challengesExpanded, setChallengesExpanded] = useState(true);
  const [widgets, setWidgets] = useState<string[]>([...DEFAULT_HOME_WIDGETS]);
  const [activeMetric, setActiveMetric] = useState<HomeMetricKey | null>(null);
  const [loading, setLoading] = useState(true);
  // Which field owns the keyboard. Drives the inline "Done" rows below.
  const [sleepFieldFocused, setSleepFieldFocused] = useState(false);
  const [noteFieldFocused, setNoteFieldFocused] = useState(false);

  // Which trackers this user has. A common user always resolves to the
  // default-on set (calories / weight / workouts / water / foods / recipes);
  // an admin gets whatever they switched on in More → Health features.
  const healthFeatures = useHealthFeatures();

  const hydrate = useCallback(async () => {
    const [
      log,
      storedPrefs,
      water,
      hydration,
      note,
      meals,
      mealGoals,
      workoutLog,
      steps,
      moveGoals,
      habitList,
      body,
      sleepLog,
      layout,
      trend,
      challengesWeekly,
      challengesExpandedStored,
    ] = await Promise.all([
      loadWeightLog(),
      loadHealthPrefs(),
      loadWaterToday(),
      loadWaterHistory(),
      loadNoteForDate(),
      // The whole window, not just today: every drill-down needs the last seven
      // days, and `loadMealsForDate` is a filter over this same cached call — so
      // this costs nothing extra and avoids a second read of the same rows.
      loadMeals(),
      loadNutritionGoals(),
      loadWorkouts(),
      loadStepDays(),
      loadActivityGoals(),
      loadHabits(),
      loadBodyEntries(),
      loadSleepLog(),
      loadHomeLayout(HOME_WIDGET_KEYS),
      loadWeeklyTrend(),
      loadChallengesWeeklyOverview(),
      loadChallengesWidgetExpanded(),
    ]);
    setEntries(log);
    setDraftUnit(storedPrefs.preferredUnit);
    setWaterDay(water);
    setWaterHistory(hydration);
    setNoteDraft(note);
    setAllMeals(meals);
    setNutritionGoals(mealGoals);
    setWorkouts(workoutLog);
    setStepDays(steps);
    setActivityGoals(moveGoals);
    setHabits(habitList);
    setBodyEntries(body);
    setSleep(sleepLog);
    setWidgets(layout.widgets);
    setWeeklyTrend(trend);
    setChallengesOverview(challengesWeekly);
    setChallengesExpanded(challengesExpandedStored);
    setLoading(false);
  }, []);

  // Hydrates on mount AND every subsequent focus (leave-and-return) — a plain
  // mount-only `useEffect` would be redundant with this, since `useFocusEffect`
  // already fires immediately when the screen is focused on first render.
  useFocusEffect(
    useCallback(() => {
      void hydrate();
    }, [hydrate]),
  );
  // Also re-hydrate when a HealthKit sync lands while this tab is focused —
  // the background observer/catch-up paths don't wait for a nav event.
  useHealthKitSyncHydration(hydrate);

  useFocusEffect(
    useCallback(() => {
      void loadNoteForDate().then(setNoteDraft);
    }, []),
  );

  // Abandoned drafts must not survive leaving the Home tab (HOME-065).
  useFocusEffect(
    useCallback(() => {
      return () => {
        setSleepDraft('');
      };
    }, []),
  );

  const parsedSleepMinutes = parseSleepHoursInput(sleepDraft);
  const canLogSleep = parsedSleepMinutes !== null;

  const handleWater = async (delta: number) => {
    setWaterDay(await adjustWater(delta));
  };

  const handleLogSleep = async () => {
    if (parsedSleepMinutes === null) return;
    setSleep(await logSleep(parsedSleepMinutes));
    setSleepDraft('');
  };

  const handleSaveNote = async (text?: string) => {
    const value = (text ?? noteDraft).trim();
    setNoteDraft(value);
    await saveNoteForDate(value);
  };

  /**
   * One handler for every ring, tile, feed row and section tile.
   *
   * A `metric:` token opens that metric's own detail sheet (the donor presents
   * `StepsDetailView` rather than swapping tabs); anything else is a route.
   */
  const openTarget = useCallback(
    (target: string) => {
      const metric = homeMetricFromTarget(target);
      if (metric) {
        setActiveMetric(metric);
        return;
      }
      router.push(target as never);
    },
    [router],
  );

  const handleToggleChallengesExpanded = useCallback(() => {
    setChallengesExpanded((prev) => {
      const next = !prev;
      void saveChallengesWidgetExpanded(next);
      return next;
    });
  }, []);

  const handleManageChallenges = useCallback(() => {
    router.push('/health-challenges' as never);
  }, [router]);

  const greeting = greetingForNow();
  const nameSuffix = displayName ? `, ${displayName.split(' ')[0]}` : '';

  /* ---------------- the day at a glance ---------------- */

  const today = todayDateKey();
  const dayKeys = useMemo(() => recentDayKeys(HOME_TREND_DAYS, today), [today]);
  const meals = useMemo(() => allMeals.filter((meal) => meal.date === today), [allMeals, today]);
  const steps = useMemo(
    () => stepDays.find((day) => day.date === today)?.steps ?? 0,
    [stepDays, today],
  );
  const nutritionTotals = useMemo(() => sumNutrition(meals), [meals]);
  const moveMinutes = useMemo(
    () => workouts.filter((w) => w.date === today).reduce((sum, w) => sum + w.minutes, 0),
    [workouts, today],
  );

  /**
   * NOTE — this effect MUST stay below the `moveMinutes` memo it reads.
   * Its dependency array is evaluated during render, so declaring it above
   * left `moveMinutes` in the temporal dead zone: a ReferenceError on device
   * (Hermes keeps `const`), and merely a silently-`undefined` dependency
   * under the Jest transform — which is why no unit test caught it and
   * `tsc` did (TS2448).
   */
  /**
   * Feed the Health widget / watch (the shared kit reads `widget_health_today`).
   *
   * Water is tracked in cups here → converted to ml for the widget's ml fields
   * (~240 ml/cup). Steps and move are now written too: the Swift widget has
   * always READ `steps`, `steps_goal` and `move_pct`, but nothing wrote them, so
   * those tiles rendered empty on every device. Home already loads all three.
   *
   * `move_pct` is a FRACTION in [0,1] — `HealthWidgetData` treats it as a
   * fraction-or-percent double, and sending 85 for 85% would render a ring 85×
   * over target. Clamped so a big day cannot overflow it.
   *
   * `next_reminder` comes from the reminder scheduler, not from this screen, so
   * `publishHealthGlance` folds in whatever the scheduler last mirrored rather
   * than this effect inventing one.
   */
  useEffect(() => {
    if (!waterDay) return;
    const CUP_ML = 240;
    void publishHealthGlance({
      steps,
      stepsGoal: activityGoals.steps,
      waterMl: (waterDay.cups ?? 0) * CUP_ML,
      waterGoalMl: (waterDay.target ?? DEFAULT_WATER_TARGET) * CUP_ML,
      movePct: moveFraction(moveMinutes, activityGoals.minutes),
    });
  }, [waterDay, steps, moveMinutes, activityGoals]);
  const habitsDone = useMemo(
    () => habits.filter((habit) => isDoneOn(habit, today)).length,
    [habits, today],
  );
  // Counted over the PRIMARY tape-measure set only, so the numerator and the
  // denominator below describe the same set. Counting all 41 sites against a
  // denominator of 20 would read "25/20" for anyone who opened the detailed
  // tier on the Body tab.
  const bodySitesMeasured = useMemo(
    () =>
      summarizeBody(bodyEntries).filter(
        (summary) =>
          summary.latest !== null &&
          (PRIMARY_BODY_METRICS as readonly string[]).includes(summary.metric),
      ).length,
    [bodyEntries],
  );
  const sleepSummary = useMemo(
    () => summarizeSleep(sleep.nights, dayKeys),
    [sleep.nights, dayKeys],
  );
  const nothingLoggedToday =
    nutritionTotals.calories === 0 && steps === 0 && moveMinutes === 0;

  // Fixed hue order — the same goal keeps the same colour whatever else is on
  // screen, and every ring is directly labelled so colour is never the only cue.
  // Each ring opens its OWN detail sheet, which carries the link to the tab.
  const dayRings = useMemo(
    () => [
      {
        key: 'calories',
        label: 'Calories',
        value: Math.round(nutritionTotals.calories),
        target: nutritionGoals.calories,
        suffix: 'kcal',
        color: colors.chartWarm,
        route: homeMetricTarget('calories'),
        testID: 'health-today-ring-calories',
      },
      {
        key: 'steps',
        label: 'Steps',
        value: steps,
        target: activityGoals.steps,
        color: colors.chartCool,
        route: homeMetricTarget('steps'),
        testID: 'health-today-ring-steps',
      },
      {
        key: 'move',
        label: 'Move',
        value: moveMinutes,
        target: activityGoals.minutes,
        suffix: 'min',
        color: colors.primary,
        route: homeMetricTarget('move'),
        testID: 'health-today-ring-move',
      },
    ].filter((ring) => visibleHomeRingKeys(healthFeatures).includes(ring.key)),
    [
      nutritionTotals.calories,
      nutritionGoals.calories,
      steps,
      activityGoals,
      moveMinutes,
      colors,
      healthFeatures,
    ],
  );

  const glanceCards: HealthGlanceCard[] = useMemo(
    () => [
      {
        key: 'habits',
        icon: 'streak',
        label: 'Habits',
        value: `${habitsDone}/${habits.length}`,
        caption: habits.length > 0 ? 'done today' : 'none yet',
        route: homeMetricTarget('habits'),
        testID: 'health-glance-habits',
      },
      {
        key: 'body',
        icon: 'body-measurements',
        label: 'Body',
        // Denominator is the PRIMARY tape-measure set (20), not all 41 sites.
        // The other 21 are finer points behind a switch on the Body tab; counting
        // them here would show "2/41" to somebody who has measured everything the
        // app actually asks for on the default form.
        value: `${bodySitesMeasured}/${PRIMARY_BODY_METRICS.length}`,
        caption: 'sites measured',
        route: homeMetricTarget('body'),
        testID: 'health-glance-body',
      },
    ].filter((card) => visibleGlanceKeys(healthFeatures).includes(card.key)),
    [habitsDone, habits.length, bodySitesMeasured, healthFeatures],
  );

  /* ---------------- what this user is allowed to see ---------------- */

  // The stored card order narrows to the enabled features. Filtering the
  // STORED order (not the default) keeps an admin's arrangement intact across
  // a toggle off and back on.
  const shownWidgets = useMemo(
    () => visibleHomeWidgets(widgets, healthFeatures),
    [widgets, healthFeatures],
  );

  /* ---------------- per-metric drill-down ---------------- */

  const metricSources: HomeMetricSources = useMemo(
    () => ({
      dayKeys,
      meals: allMeals,
      nutritionGoals,
      stepDays,
      workouts,
      activityGoals,
      waterToday: waterDay,
      waterHistory,
      weights: entries,
      weightUnit: draftUnit,
      sleepNights: sleep.nights,
      sleepGoalHours: sleep.goalHours,
      habits,
      bodyEntries,
    }),
    [
      dayKeys,
      allMeals,
      nutritionGoals,
      stepDays,
      workouts,
      activityGoals,
      waterDay,
      waterHistory,
      entries,
      draftUnit,
      sleep,
      habits,
      bodyEntries,
    ],
  );

  const activeDetail = useMemo(
    () => (activeMetric ? buildHomeMetricDetail(activeMetric, metricSources) : null),
    [activeMetric, metricSources],
  );

  /* ---------------- the model every card reads ---------------- */

  const model: HomeWidgetModel = {
    onOpenTarget: openTarget,

    rings: dayRings,
    nothingLoggedToday,

    weeklyTrend,

    challengesOverview,
    challengesExpanded,
    onToggleChallengesExpanded: handleToggleChallengesExpanded,
    onManageChallenges: handleManageChallenges,
    todayKey: today,

    glanceCards,

    sleepGoalHours: sleep.goalHours,
    lastNight: sleepSummary.last,
    sleepAverageMinutes: sleepSummary.averageMinutes,
    sleepNightsLogged: sleepSummary.nightsLogged,
    sleepDraft,
    canLogSleep,
    sleepFieldFocused,
    onSleepDraftChange: (text) => setSleepDraft(sanitizeSleepInput(text)),
    onLogSleep: () => void handleLogSleep(),
    onSleepFocus: () => setSleepFieldFocused(true),
    onSleepBlur: () => setSleepFieldFocused(false),

    waterCups: waterDay?.cups ?? 0,
    waterTarget: waterDay?.target ?? DEFAULT_WATER_TARGET,
    onAdjustWater: (amount) => void handleWater(amount),

    noteDraft,
    noteFieldFocused,
    onNoteChange: setNoteDraft,
    onNoteFocus: () => setNoteFieldFocused(true),
    onNoteBlur: () => {
      setNoteFieldFocused(false);
      void handleSaveNote();
    },
    onNoteEndEditing: (text) => void handleSaveNote(text),
    onNoteSubmit: () => void handleSaveNote(),
    onDismissKeyboard: () => Keyboard.dismiss(),
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="health-home-screen">
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
            style={styles.scrollView}
            contentContainerStyle={[styles.content, { paddingHorizontal: containerPadding }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            // The keyboard used to sit ON TOP of whichever row summoned it — a
            // card's decimal pad could land right over its own log button. This
            // insets the list by the keyboard's height so the focused field —
            // and the row it sits in — can be reached.
            automaticallyAdjustKeyboardInsets
            // Every other scroll container in this feature is addressable —
            // `HealthSectionScreen` renders `${testID}-scroll` and More renders
            // `health-more-scroll`. Home was the one exception, which is also
            // the one list the E2E driver could never scroll.
            testID="health-home-scroll"
          >
            <AdaptiveContainer width="reading" style={styles.stack}>
              <View style={styles.intro}>
                <Typography variant="title2" weight="bold" color={colors.textPrimary}>
                  {greeting}
                  {nameSuffix}
                </Typography>
                <Typography variant="body" color={colors.textSecondary}>
                  Track your wellness at your own pace — your data is private to you.
                </Typography>
              </View>

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
                  testID="health-home-notification-permission-card"
                />
              ) : null}

              {healthKitBanner.visible && healthKitStatus ? (
                <HealthKitConnectCard
                  state={healthKitStatus.state}
                  lastSyncedAt={healthKitStatus.lastSyncedAt}
                  onConnect={() => void handleHealthKit()}
                  onOpenSettings={() => void Linking.openSettings()}
                  onDismiss={healthKitBanner.dismiss}
                  busy={healthKitBusy}
                  layout="compact"
                  testID="health-home-healthkit-card"
                />
              ) : null}

              {/* The cards, in the member's own order */}
              {shownWidgets.map((key) => (
                <HealthHomeWidget key={key} widget={key} model={model} />
              ))}

              <ScreenScrollEnd testID={screenScrollEndTestId('health-home-screen')} />
            </AdaptiveContainer>
          </ScrollView>
        )}

        {/* One metric, its goal and its history — the donor's detail views */}
        <HealthHomeMetricSheet
          detail={activeDetail}
          onClose={() => setActiveMetric(null)}
          onOpenRoute={(route) => {
            setActiveMetric(null);
            router.push(route as never);
          }}
        />

        <HealthKitSyncProgressModal
          visible={healthKitSyncing}
          progress={healthKitProgress}
          testID="health-home-healthkit-sync-progress"
        />
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    paddingTop: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
  },
  // The ScrollView has a single child (AdaptiveContainer), so the vertical
  // rhythm has to live here — otherwise every card stacks flush.
  stack: {
    gap: Spacing.base,
  },
  intro: {
    gap: Spacing.xs,
  },
});
