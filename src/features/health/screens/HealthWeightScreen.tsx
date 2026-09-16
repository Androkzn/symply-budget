import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useDismissiblePermissionBanner } from '@hooks/useDismissiblePermissionBanner';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import {
  HealthBodyTrendCard,
  HealthKitConnectCard,
  HealthKitSyncProgressModal,
  HealthSectionScreen,
  HealthWeightBodyCompositionCard,
  HealthWeightDashboard,
  HealthWeightSummaryCard,
  HealthWeightWeeklyChart,
  HealthWeightWidget,
  WEIGHT_WIDGETS,
  type WeightWidgetKey,
  type WeightWidgetModel,
} from '../components';
import { loadBodyEntries, type BodyEntry } from '../healthBodyStorage';
import { weeklyAverages, type DatedValue } from '../healthDashboards';
import {
  addWeightEntry,
  deleteWeightEntry,
  formatLoggedAt,
  formatWeightValue,
  isRealDayKey,
  loadHealthPrefs,
  loadWeightLog,
  maskDayKeyInput,
  parseWeightInput,
  sanitizeWeightInput,
  todayDateKey,
  updateWeightEntry,
  weightDayOf,
  type WeightEntry,
  type WeightUnit,
} from '../healthLocalStorage';
import { loadMeals, sumNutrition, type MealEntry } from '../healthNutritionStorage';
import { formatAxisDate } from '../healthTrends';
import {
  ageFromBirthYear,
  bmiFor,
  bmrFor,
  bodyCompositionFor,
  calorieWeightCorrelation,
  dominantUnit,
  entriesInWindow,
  monthOverMonth,
  monthlyWeightProgress,
  periodAverage,
  periodComparison,
  tdeeFor,
  weekOverWeek,
  weightGoalProgress,
  weightHasGapThisWeek,
  weightHistoryStats,
  weightLoggingStreak,
  weightProjection,
  weightWindow,
  WEIGHT_WINDOW_DAYS,
} from '../healthWeightAnalytics';
import {
  DEFAULT_WEIGHT_LAYOUT,
  EMPTY_WEIGHT_GOAL,
  loadWeightGoal,
  loadWeightLayout,
  saveWeightLayout,
  weightInUnit,
  weightToKg,
  type WeightGoal,
  type WeightLayout,
} from '../healthWeightStorage';
import { useHealthKitConnection } from '../useHealthKitConnection';
import { useHealthKitSyncHydration } from '../useHealthKitSyncHydration';

/**
 * Weight — the donor's dedicated Weight tab plus its "Weight Stats" dashboard.
 *
 * The donor splits weight across two full screens (`WeightTabView`, 3,058 lines,
 * and `WeightDashboardView` with fourteen reorderable widgets). Before this,
 * everything weight-related in the RN app lived as a logging card on Home and a
 * summary card on Trends, which cost most of the donor's capabilities: no goal,
 * no entry editing, no entry detail, no full history, no past-window navigation
 * and no dashboard at all.
 *
 * What this screen owns, in donor order:
 *   · a WINDOW navigator — ◀ / ▶ across 7 / 30 / 90 / 365-day windows, so a
 *     reading from last March is reachable. Every range picker in this app used
 *     to be trailing-only, which is why "last month" was the oldest question a
 *     member could ask;
 *   · goal progress, as a fixed section up top rather than a reorderable card;
 *   · a summary for the selected window (latest · change · average · trend);
 *   · quick logging, with a date so a missed morning can be filled in;
 *   · the eleven-widget dashboard, reorderable and hideable via Customise,
 *     defaulting to two of them;
 *   · the full history with edit and delete on every row, and the source of each
 *     reading (typed here vs imported) shown where they differ.
 *
 * Nothing here loads on its own beyond `hydrate()`; every figure is derived by
 * the pure functions in `healthWeightAnalytics.ts`, which are unit-tested
 * without rendering.
 */
export function HealthWeightScreen() {
  const colors = useAppColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(240, width - 2 * Spacing.lg - 2 * Spacing.base);
  const {
    status: healthKitStatus,
    busy: healthKitBusy,
    syncing: healthKitSyncing,
    progress: healthKitProgress,
    connectOrSync: handleHealthKit,
  } = useHealthKitConnection();
  const healthKitBanner = useDismissiblePermissionBanner(
    healthKitStatus !== null && healthKitStatus.state !== 'connected'
  );

  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [goal, setGoal] = useState<WeightGoal>(EMPTY_WEIGHT_GOAL);
  const [layout, setLayout] = useState<WeightLayout>(DEFAULT_WEIGHT_LAYOUT);
  const [meals, setMeals] = useState<MealEntry[]>([]);
  const [body, setBody] = useState<BodyEntry[]>([]);
  const [preferredUnit, setPreferredUnit] = useState<WeightUnit>('kg');
  const [loading, setLoading] = useState(true);

  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<WeightEntry | null>(null);
  /** Set when a tap on an empty day in the Weekly Weight chart pre-fills the log form's date. */
  const [prefillDate, setPrefillDate] = useState<string | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  const hydrate = useCallback(async () => {
    const [log, storedGoal, storedLayout, mealLog, bodyLog, prefs] = await Promise.all([
      loadWeightLog(),
      loadWeightGoal(),
      loadWeightLayout(),
      loadMeals(),
      loadBodyEntries(),
      loadHealthPrefs(),
    ]);
    setEntries(log);
    setGoal(storedGoal);
    setLayout(storedLayout);
    setMeals(mealLog);
    setBody(bodyLog);
    setPreferredUnit(prefs.preferredUnit);
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
  // Also re-hydrate when a HealthKit sync lands while this tab is focused.
  useHealthKitSyncHydration(hydrate);

  // `connectOrSync` writes imported readings straight to `/health/weight/entries`
  // — it has no way to know this screen is even mounted. Re-hydrating after it
  // resolves is what makes a synced reading show up here without the member
  // backing out and back in, or pulling to refresh.
  const handleHealthKitSync = useCallback(async () => {
    await handleHealthKit();
    await hydrate();
  }, [handleHealthKit, hydrate]);

  const today = todayDateKey();
  // The unit the LOG is in wins over the member's typing preference, and one
  // axis carries one unit: readings in the other are left out of the series
  // rather than plotted 2.2× away from their neighbours. Labelling the axis
  // with a unit it is not drawing would be the worse half of that trade.
  const unit = dominantUnit(entries, preferredUnit);

  const window = useMemo(
    () => weightWindow(today, layout.windowDays, offset),
    [today, layout.windowDays, offset]
  );
  const previousWindow = useMemo(
    () => weightWindow(today, layout.windowDays, offset + 1),
    [today, layout.windowDays, offset]
  );

  /** One reading per logged day across the WHOLE log, oldest first, one unit. */
  const allDaily = useMemo<DatedValue[]>(() => {
    const byDay = new Map<string, number>();
    for (const entry of entries) {
      if (entry.unit !== unit) continue;
      const day = weightDayOf(entry);
      if (!byDay.has(day)) byDay.set(day, entry.value);
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ date, value }));
  }, [entries, unit]);

  const windowDaily = useMemo(
    () => allDaily.filter((d) => d.date >= window.start && d.date <= window.end),
    [allDaily, window.start, window.end]
  );

  // Weight Summary card — the donor's `currentWeightCard`, generalised from its
  // week-only selector to whatever window is selected here. `change` and
  // `current` are WITHIN the window (last logged reading minus the first),
  // matching `selectedWeekChange`/`selectedWeekDisplayWeight`, not a
  // window-over-window comparison — those are a separate figure (`windowCompare`).
  const windowCurrent = windowDaily.length > 0 ? windowDaily[windowDaily.length - 1].value : null;
  const windowChange =
    windowDaily.length < 2
      ? null
      : Math.round((windowDaily[windowDaily.length - 1].value - windowDaily[0].value) * 10) / 10;
  const windowAverage = useMemo(
    () =>
      periodAverage(allDaily, { label: 'Selected window', start: window.start, end: window.end })
        .average,
    [allDaily, window.start, window.end]
  );

  const target = goal.targetKg === null ? null : weightInUnit(goal.targetKg, unit);
  const baseline = goal.startingKg === null ? null : weightInUnit(goal.startingKg, unit);
  const history = useMemo(() => weightHistoryStats(allDaily), [allDaily]);
  const latest = history.current?.value ?? null;

  const progress = useMemo(
    () =>
      weightGoalProgress({
        current: latest,
        target,
        // No explicit baseline falls back to the first weight ever logged, which
        // is what the donor does when its profile has no starting weight.
        baseline: baseline ?? history.starting?.value ?? null,
      }),
    [latest, target, baseline, history.starting]
  );

  const bodyFat = useMemo(() => {
    const fats = body
      .filter((entry) => entry.metric === 'bodyFat')
      .sort((a, b) => b.date.localeCompare(a.date));
    return fats.length > 0 ? fats[0].value : null;
  }, [body]);

  // Donor's `hasBodyCompositionHistory` — gates the Body Composition Trends
  // chart; a single reading has nothing to trend against.
  const hasBodyFatHistory = useMemo(
    () => body.filter((entry) => entry.metric === 'bodyFat').length >= 2,
    [body]
  );

  // Every body-metric figure is computed in KILOGRAMS (the formulas are metric)
  // and converted once for display, so a member logging in pounds gets the same
  // BMI as one logging in kilos.
  const latestKg = useMemo(() => {
    if (latest === null) return null;
    return unit === 'lb' ? latest / 2.2046226218 : latest;
  }, [latest, unit]);

  const bmi = useMemo(() => bmiFor(latestKg, goal.heightCm), [latestKg, goal.heightCm]);
  // BMI has no log of its own — it is weight ÷ height² recomputed for every
  // day weight WAS logged, so the Body Composition card can chart it as a
  // trend without a second, parallel history to keep in sync.
  const bmiHistory = useMemo<DatedValue[]>(() => {
    if (goal.heightCm === null) return [];
    return allDaily
      .map((day) => {
        const value = bmiFor(weightToKg(day.value, unit), goal.heightCm);
        return value === null ? null : { date: day.date, value };
      })
      .filter((point): point is DatedValue => point !== null);
  }, [allDaily, unit, goal.heightCm]);
  const bmr = useMemo(
    () =>
      bmrFor({
        weightKg: latestKg,
        heightCm: goal.heightCm,
        age: ageFromBirthYear(goal.birthYear, today),
        gender: goal.gender,
      }),
    [latestKg, goal.heightCm, goal.birthYear, goal.gender, today]
  );
  const composition = useMemo(() => {
    const metric = bodyCompositionFor(latestKg, bodyFat);
    if (metric === null) return null;
    return unit === 'lb'
      ? {
          ...metric,
          fatMassKg: weightInUnit(metric.fatMassKg, 'lb'),
          leanMassKg: weightInUnit(metric.leanMassKg, 'lb'),
        }
      : metric;
  }, [latestKg, bodyFat, unit]);

  const weeklyCalories = useMemo(() => {
    const byDay = new Map<string, MealEntry[]>();
    for (const meal of meals) {
      byDay.set(meal.date, [...(byDay.get(meal.date) ?? []), meal]);
    }
    const daily: DatedValue[] = [...byDay.entries()].map(([date, dayMeals]) => ({
      date,
      value: sumNutrition(dayMeals).calories,
    }));
    return weeklyAverages(daily).map((week) => ({
      weekStart: week.weekStart,
      average: week.average,
    }));
  }, [meals]);

  const weeklyWeight = useMemo(
    () => weeklyAverages(allDaily).map((w) => ({ weekStart: w.weekStart, average: w.average })),
    [allDaily]
  );

  const model = useMemo<WeightWidgetModel>(
    () => ({
      unit,
      windowLabel: window.label,
      daily: windowDaily,
      allDaily,
      target,
      progress,
      streak: weightLoggingStreak(allDaily.map((d) => d.date), today),
      history,
      projection: weightProjection(allDaily),
      monthly: monthlyWeightProgress(allDaily),
      windowCompare: periodComparison(
        allDaily,
        { label: 'This window', start: window.start, end: window.end },
        { label: 'Previous', start: previousWindow.start, end: previousWindow.end }
      ),
      week: weekOverWeek(allDaily, today),
      month: monthOverMonth(allDaily, today),
      bmi,
      bmr,
      tdee: tdeeFor(bmr, goal.activityLevel),
      activityLevel: goal.activityLevel,
      composition,
      correlation: calorieWeightCorrelation(weeklyCalories, weeklyWeight),
      chart: (
        <HealthWeightDashboard
          entries={entries}
          dayKeys={window.dayKeys}
          width={chartWidth}
          goal={layout.showGoalLine ? target : null}
          mode={layout.chartMode}
          onModeChange={(mode) => void persistLayout({ chartMode: mode })}
          showAverageLine={layout.showAverageLine}
          onToggleAverageLine={() =>
            void persistLayout({ showAverageLine: !layout.showAverageLine })
          }
          showValues={layout.showValues}
          onToggleShowValues={() => void persistLayout({ showValues: !layout.showValues })}
          compact
          testID="health-weight-chart"
        />
      ),
      onOpenBody: () => router.push('/health-body' as never),
    }),
    [
      unit,
      window,
      previousWindow,
      windowDaily,
      allDaily,
      target,
      progress,
      history,
      bmi,
      bmr,
      goal.activityLevel,
      composition,
      weeklyCalories,
      weeklyWeight,
      entries,
      chartWidth,
      layout,
      today,
      router,
    ]
  );

  async function persistLayout(patch: Partial<WeightLayout>) {
    setLayout(await saveWeightLayout(patch));
  }

  // `goalProgress` renders as its own fixed section at the top of the screen;
  // `weeklyChange` ("This week") and `dataStack` ("Averages") are dropped
  // entirely — excluded here (not just from the default order) so a layout
  // persisted before this change does not still render any of the three.
  const widgets = layout.widgets.filter(
    (key): key is WeightWidgetKey =>
      WEIGHT_WIDGETS.some((meta) => meta.key === key) &&
      key !== 'goalProgress' &&
      key !== 'weeklyChange' &&
      key !== 'dataStack'
  );

  const windowEntries = useMemo(() => entriesInWindow(entries, window), [entries, window]);
  const historyRows = showAllHistory ? entries : entries.slice(0, 5);
  // Gates the default "LOG A WEIGHT" card — scoped to THIS calendar week
  // regardless of which window width/offset is selected above, since the
  // card's own date always defaults to today and its job is short-term
  // catch-up, not whatever historical span is being browsed.
  const hasGapThisWeek = useMemo(() => weightHasGapThisWeek(allDaily, today), [allDaily, today]);

  return (
    <HealthSectionScreen title="Weight" testID="health-weight-screen" loading={loading}>
      {/* ---- Apple Health connect/sync — surfaced here, not just in More, because
             this is where a member notices a logged reading did NOT come from
             their scale automatically and wants to know why. Hidden once
             connected so the tab does not carry a permanent settings card. */}
      {healthKitBanner.visible && healthKitStatus ? (
        <HealthKitConnectCard
          state={healthKitStatus.state}
          lastSyncedAt={healthKitStatus.lastSyncedAt}
          onConnect={() => void handleHealthKitSync()}
          onOpenSettings={() => void Linking.openSettings()}
          onDismiss={healthKitBanner.dismiss}
          busy={healthKitBusy}
          layout="compact"
          testID="health-weight-healthkit-card"
        />
      ) : null}

      <HealthKitSyncProgressModal
        visible={healthKitSyncing}
        progress={healthKitProgress}
        testID="health-weight-healthkit-sync-progress"
      />

      {/* ---- Window navigator — the donor's week selector, widened ---- */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.navRow}>
          <Pressable
            onPress={() => setOffset((o) => o + 1)}
            accessibilityRole="button"
            accessibilityLabel="Previous window"
            testID="health-weight-window-previous"
            style={[styles.navButton, { borderColor: colors.borderColor }]}
          >
            <Icon name="arrow-back" size={18} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.navCenter}>
            <Typography
              variant="body"
              weight="semibold"
              color={colors.textPrimary}
              testID="health-weight-window-label"
            >
              {window.label}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              {window.isCurrent ? 'Up to today' : `${offset} window${offset === 1 ? '' : 's'} back`}
            </Typography>
          </View>
          <Pressable
            onPress={() => setOffset((o) => Math.max(0, o - 1))}
            disabled={window.isCurrent}
            accessibilityRole="button"
            accessibilityLabel="Next window"
            accessibilityState={{ disabled: window.isCurrent }}
            testID="health-weight-window-next"
            style={[
              styles.navButton,
              { borderColor: colors.borderColor, opacity: window.isCurrent ? 0.35 : 1 },
            ]}
          >
            <Icon name="arrow-forward" size={18} color={colors.textPrimary} />
          </Pressable>
        </View>

        <View style={[styles.rangeRow, { borderColor: colors.borderColor }]}>
          {WEIGHT_WINDOW_DAYS.map((days) => {
            const active = days === layout.windowDays;
            return (
              <Pressable
                key={days}
                onPress={() => {
                  // Changing the width while parked in the past would land on a
                  // different span than the one on screen, so it returns to the
                  // current window — the only window every width agrees on.
                  setOffset(0);
                  void persistLayout({ windowDays: days });
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                testID={`health-weight-range-${days}`}
                style={[styles.rangeOption, active && { backgroundColor: colors.primary }]}
              >
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={active ? colors.white : colors.textSecondary}
                >
                  {days === 365 ? '1 year' : `${days} days`}
                </Typography>
              </Pressable>
            );
          })}
        </View>

        <Typography
          variant="caption1"
          color={colors.textSecondary}
          testID="health-weight-window-count"
        >
          {windowEntries.length === 0
            ? 'Nothing logged in this window.'
            : `${windowEntries.length} reading${windowEntries.length === 1 ? '' : 's'} in this window.`}
        </Typography>
      </Card>

      {/* ---- Goal Progress — moved to the top as the screen's headline metric,
             rather than a reorderable dashboard card further down ---- */}
      <HealthWeightWidget widget="goalProgress" model={model} />

      {/* ---- Weight Summary — donor's `currentWeightCard` ---- */}
      <HealthWeightSummaryCard
        unit={unit}
        current={windowCurrent}
        change={windowChange}
        average={windowAverage}
      />

      {/* ---- Weight Period Chart — the donor's `weeklyWeightChartSection`,
             generalised to follow the SAME window (width + offset) as the
             navigator and summary card above, instead of always this
             calendar week ---- */}
      <HealthWeightWeeklyChart
        allDaily={allDaily}
        window={window}
        today={today}
        unit={unit}
        goal={target}
        onAddForDate={(dateKey) => {
          setEditing(null);
          setPrefillDate(dateKey);
        }}
      />

      {/* ---- Quick log — the default blank card is hidden once every day
             this week through today already has a reading, since there is
             nothing left to catch up on; editing a row or filling a tapped
             gap still opens it regardless. ---- */}
      {editing !== null || prefillDate !== null || hasGapThisWeek ? (
        <WeightEntryEditor
          unit={unit}
          editing={editing}
          prefillDate={prefillDate}
          onCancelEdit={() => {
            setEditing(null);
            setPrefillDate(null);
          }}
          onSubmit={async (draft) => {
            const next =
              editing === null
                ? await addWeightEntry(draft.value, draft.unit, {
                    date: draft.date,
                    note: draft.note,
                  })
                : await updateWeightEntry(editing.id, {
                    value: draft.value,
                    unit: draft.unit,
                    date: draft.date,
                    note: draft.note.length > 0 ? draft.note : null,
                  });
            setEntries(next);
            setEditing(null);
            setPrefillDate(null);
          }}
        />
      ) : null}

      {/* ---- The dashboard — the donor's separate, customisable "Weight Stats"
             screen, folded into this one; the fixed sections above are the
             donor's main Weight tab, always on. Insights (`aiInsights`) is
             held back and rendered AFTER Body Composition below, so that card
             sits directly above it regardless of where the member has it
             ordered among the rest of their dashboard. ---- */}
      {widgets
        .filter((key) => key !== 'aiInsights')
        .map((key) => (
          <HealthWeightWidget key={key} widget={key} model={model} />
        ))}

      {/* ---- Body Composition — donor's `bodyCompositionCard`; the donor also
             hides this card entirely until there is something to show ---- */}
      {bodyFat !== null || bmi !== null ? (
        <HealthWeightBodyCompositionCard
          bodyFatPercent={bodyFat}
          bmi={bmi}
          bmr={bmr}
          gender={goal.gender}
          bmiHistory={bmiHistory}
          window={window}
          chartWidth={chartWidth}
        />
      ) : null}

      {/* ---- Body Composition Trends — donor's `bodyCompositionTrendsChart`,
             directly below the Body Composition card it charts, and — like it
             — above Insights and History ---- */}
      {hasBodyFatHistory ? (
        <HealthBodyTrendCard
          entries={body}
          metrics={['bodyFat']}
          chartWidth={chartWidth}
          title="BODY COMPOSITION TRENDS"
          idPrefix="health-weight-bodyfat-trend"
          color={colors.chartWarm}
        />
      ) : null}

      {widgets.includes('aiInsights') ? (
        <HealthWeightWidget widget="aiInsights" model={model} />
      ) : null}

      {/* ---- History ---- */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.rowBetween}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            HISTORY
          </Typography>
          {entries.length > 5 ? (
            <Pressable
              onPress={() => setShowAllHistory((all) => !all)}
              accessibilityRole="button"
              testID="health-weight-history-see-all"
            >
              <Typography variant="footnote" weight="semibold" color={colors.primary}>
                {showAllHistory ? 'Show fewer' : `See all ${entries.length}`}
              </Typography>
            </Pressable>
          ) : null}
        </View>

        {entries.length === 0 ? (
          <Typography variant="body" color={colors.textSecondary} testID="health-weight-history-empty">
            No weigh-ins yet. Log one above and it appears here.
          </Typography>
        ) : (
          historyRows.map((entry) => (
            <View
              key={entry.id}
              style={[styles.historyRow, { borderTopColor: colors.borderColor }]}
              testID={`health-weight-row-${entry.id}`}
            >
              <View style={styles.historyMain}>
                <Typography variant="body" color={colors.textPrimary}>
                  {formatWeightValue(entry.value)} {entry.unit}
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary}>
                  {formatAxisDate(weightDayOf(entry))}
                  {entry.source === 'healthkit' ? ' · from Apple Health' : ''}
                  {entry.note.length > 0 ? ` · ${entry.note}` : ''}
                </Typography>
              </View>
              <View style={styles.historyActions}>
                <Pressable
                  onPress={() => setEditing(entry)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit the ${formatLoggedAt(entry.loggedAt)} reading`}
                  testID={`health-weight-edit-${entry.id}`}
                  hitSlop={8}
                >
                  <Icon name="edit" size={16} color={colors.textSecondary} />
                </Pressable>
                <Pressable
                  onPress={async () => setEntries(await deleteWeightEntry(entry.id))}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete the ${formatLoggedAt(entry.loggedAt)} reading`}
                  testID={`health-weight-delete-${entry.id}`}
                  hitSlop={8}
                >
                  <Icon name="delete" size={16} color={colors.textSecondary} />
                </Pressable>
              </View>
            </View>
          ))
        )}
      </Card>
    </HealthSectionScreen>
  );
}

/* ------------------------------------------------------------------ */
/* Entry editor — add and edit share one form (the donor's own sheet)  */
/* ------------------------------------------------------------------ */

interface EntryDraft {
  value: number;
  unit: WeightUnit;
  date: string;
  note: string;
}

function WeightEntryEditor({
  unit,
  editing,
  prefillDate,
  onCancelEdit,
  onSubmit,
}: {
  unit: WeightUnit;
  editing: WeightEntry | null;
  /** A day tapped from the Weekly Weight chart's empty slot — pre-fills a NEW entry's date. */
  prefillDate: string | null;
  onCancelEdit: () => void;
  onSubmit: (draft: EntryDraft) => Promise<void>;
}) {
  const colors = useAppColors();
  const [value, setValue] = useState('');
  const [date, setDate] = useState(todayDateKey());
  const [note, setNote] = useState('');
  // The unit is set once, app-wide, from More → Preferences → Units — not
  // re-decided per entry. A fresh add takes the screen's current unit; editing
  // an existing reading keeps the unit it was originally logged in, since
  // that's what its stored value actually is.
  const entryUnit = editing !== null ? editing.unit : unit;

  // Loading an entry for editing is the only time the form is populated from
  // outside; a fresh add starts blank (beyond its date) so yesterday's number
  // is never silently re-submitted as today's. `prefillDate` — a tap on an
  // empty day in the Weekly Weight chart — only ever sets the date, same rule.
  useEffect(() => {
    if (editing === null) {
      setValue('');
      setNote('');
      setDate(prefillDate ?? todayDateKey());
      return;
    }
    setValue(formatWeightValue(editing.value));
    setDate(weightDayOf(editing));
    setNote(editing.note);
  }, [editing, prefillDate]);

  const parsed = parseWeightInput(value);
  const today = todayDateKey();
  // The donor refuses a future date outright; so does this. A weight you have
  // not stood on a scale for is not a measurement.
  // Calendar, not just shape — the field punctuates itself now, so any eight
  // digits arrive looking like a day key and `2026-13-40` would otherwise pass.
  const dateValid = isRealDayKey(date) && date <= today;
  const canSubmit = parsed !== null && dateValid;

  return (
    <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
      <View style={styles.rowBetween}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          {editing !== null
            ? 'EDIT READING'
            : prefillDate !== null
              ? `LOG WEIGHT — ${formatAxisDate(prefillDate)}`
              : 'LOG A WEIGHT'}
        </Typography>
        {editing !== null || prefillDate !== null ? (
          <Pressable
            onPress={onCancelEdit}
            accessibilityRole="button"
            testID="health-weight-edit-cancel"
          >
            <Typography variant="footnote" weight="semibold" color={colors.primary}>
              Cancel
            </Typography>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.logRow}>
        <TextInput
          value={value}
          onChangeText={(text) => setValue(sanitizeWeightInput(text))}
          placeholder="Weight"
          placeholderTextColor={colors.textSecondary}
          keyboardType="decimal-pad"
          returnKeyType="done"
          accessibilityLabel="Weight"
          testID="health-weight-entry-value"
          style={[
            styles.input,
            {
              color: colors.textPrimary,
              borderColor: colors.borderColor,
              backgroundColor: colors.backgroundMain,
            },
          ]}
        />
        <View
          style={[styles.unitBadge, { borderColor: colors.borderColor }]}
          testID="health-weight-entry-unit"
        >
          <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
            {entryUnit}
          </Typography>
        </View>
      </View>

      <View style={styles.logRow}>
        <TextInput
          value={date}
          onChangeText={(text) => setDate(maskDayKeyInput(text))}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="number-pad"
          accessibilityLabel="Date of the reading"
          testID="health-weight-entry-date"
          style={[
            styles.input,
            {
              color: dateValid ? colors.textPrimary : colors.error,
              borderColor: dateValid ? colors.borderColor : colors.error,
              backgroundColor: colors.backgroundMain,
            },
          ]}
        />
        <Pressable
          onPress={() => setDate(today)}
          accessibilityRole="button"
          accessibilityLabel="Use today"
          testID="health-weight-entry-today"
          style={[styles.todayButton, { borderColor: colors.borderColor }]}
        >
          <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
            Today
          </Typography>
        </Pressable>
      </View>

      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Note (optional) — e.g. after a long flight"
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel="Note"
        testID="health-weight-entry-note"
        style={[
          styles.input,
          {
            color: colors.textPrimary,
            borderColor: colors.borderColor,
            backgroundColor: colors.backgroundMain,
          },
        ]}
      />

      {dateValid ? null : (
        <Typography variant="caption1" color={colors.error} testID="health-weight-entry-date-error">
          Use YYYY-MM-DD, and not a day in the future.
        </Typography>
      )}

      <Pressable
        onPress={() => {
          if (parsed === null || !dateValid) return;
          void onSubmit({ value: parsed, unit: entryUnit, date, note: note.trim() });
          setValue('');
          setNote('');
        }}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityLabel={editing === null ? 'Log weight' : 'Save reading'}
        accessibilityState={{ disabled: !canSubmit }}
        testID="health-weight-entry-save"
        style={[
          styles.saveButton,
          { backgroundColor: canSubmit ? colors.primary : colors.borderColor },
        ]}
      >
        <Typography variant="body" weight="semibold" color={colors.white}>
          {editing === null ? 'Log weight' : 'Save changes'}
        </Typography>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  navCenter: {
    flex: 1,
    alignItems: 'center',
  },
  navButton: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  rangeOption: {
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  unitBadge: {
    paddingHorizontal: Spacing.sm,
    height: 44,
    minWidth: 40,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayButton: {
    height: 44,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: {
    height: 44,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  historyMain: {
    flex: 1,
    gap: 2,
  },
  historyActions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
});
