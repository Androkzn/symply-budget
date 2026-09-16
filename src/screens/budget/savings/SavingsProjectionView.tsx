import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import {
  PROJECTION_METHODS,
  savingsApi,
  type ProjectionMethod,
  type SavingsGoalPerformance,
  type SavingsProjection,
  type SavingsProjectionMonth,
} from '@api/savings';
import { Card, InfoButton, ProgressBar, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { AppBarChart } from '@components/ui/AppBarChart';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useSavingsStore } from '@stores/savingsStore';
import { CornerRadius, EmptyState, Spacing, useAppColors } from '@theme';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

import { ForecastBridge, forecastChangeText } from './ForecastBridge';
import { ProjectionTargetModal, type TargetSuggestion } from './ProjectionTargetModal';
import { ScenarioExplanation } from './ScenarioExplanation';

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Alpha suffix that renders a projected (not-yet-real) bar as a ghost of its actual color. */
const PROJECTED_ALPHA = '59'; // ~35%

/**
 * Bar color for one projection month. Actuals are solid (green up / red down);
 * months that haven't happened yet render the SAME hue at ~35% so the chart
 * reads at a glance as "banked" vs "planned" without a legend.
 */
export function projectionBarColor(
  month: SavingsProjectionMonth,
  colors: { positive: string; negative: string }
): string {
  const value = month.forecastBreakdown || month.status === 'future' ? month.projectedNet : (month.actualNet ?? 0);
  const base = value < 0 ? colors.negative : colors.positive;
  return month.forecastBreakdown || month.status === 'future' ? `${base}${PROJECTED_ALPHA}` : base;
}

/**
 * The motivational headline. Every variant is grounded in the household's OWN
 * numbers — the stretch figure is a month they have actually hit, never an
 * invented target — so the encouragement stays credible.
 */
export function projectionHeadline(p: SavingsProjection): { title: string; body: string } {
  const uplift = p.potentialYearEnd - p.paceYearEnd;

  if (p.monthsRemaining === 0) {
    if (!p.bestMonth && p.actualToDate === 0) {
      return {
        title: `Nothing tracked for ${p.year}`,
        body: `Add income and spending for ${p.year} to see how the year actually went.`,
      };
    }
    return {
      title: `${p.year} is in the books`,
      body: `You kept ${formatCurrency(p.actualToDate)} across the year — an average of ${formatCurrency(p.paceMonthly)} a month.`,
    };
  }

  if (!p.bestMonth) {
    return {
      title: `Set the pace for ${p.year}`,
      body: `Give the ${p.monthsRemaining} months ahead a savings goal and watch your projected year-end total grow.`,
    };
  }

  const bestName = MONTH_LONG[p.bestMonth.month - 1] ?? '';
  if (uplift <= 0) {
    return {
      title: 'You are running at your best pace',
      body: `${formatCurrency(p.paceMonthly)} a month is as strong as your best month. Hold it for ${p.monthsRemaining} more and ${p.year} closes at ${formatCurrency(p.paceYearEnd)}.`,
    };
  }

  // The figure is REPEATABLE net — one-off income is deliberately excluded, so
  // say so rather than let the number look wrong against the month's own row.
  const oneOffNote = p.excludesOneOffIncome ? ' (one-off income aside)' : '';
  return {
    title: `Your best month was ${bestName}: ${formatCurrency(p.bestMonth.net)}${oneOffNote}`,
    body: `Match it for the ${p.monthsRemaining} months left and you'd close ${p.year} with ${formatCurrency(p.potentialYearEnd)} — ${formatCurrency(uplift)} more than your recent pace.`,
  };
}

/** " · 103% of $8,000 goal" — empty when the month never set a target. */
function goalAttainmentNote(month: SavingsProjectionMonth): string {
  if (month.targetCents == null) return '';
  const pctText = month.goalAttainmentPct != null ? `${month.goalAttainmentPct}% of ` : '';
  return ` · ${pctText}${formatCurrency(month.targetCents)} goal`;
}

/**
 * Right-hand figure + caption for one row of the month list.
 *
 * An elapsed month that carried one-off income says so: the figure is real, but
 * it isn't the pace, and the household would otherwise wonder why a $20k month
 * didn't move their benchmark.
 *
 * Every month is editable — a goal can be set (or graded) on an elapsed month
 * too, it just never changes that month's real figure (see `getProjection`).
 */
export function monthRowMeta(
  month: SavingsProjectionMonth,
  paceMonthly: number
): { amount: number; caption: string; editable: boolean } {
  if (month.forecastBreakdown && month.status !== 'actual') {
    const b = month.forecastBreakdown;
    return {
      amount: month.projectedNet,
      caption: `${formatCurrency(b.income)} income − ${formatCurrency(b.recurring)} payments − ${formatCurrency(b.spending)} spending` +
        ` · income: ${b.incomeSource}, spending: ${b.spendingSource}` +
        (month.status === 'current' ? ` · recorded net ${formatCurrency(month.actualNet ?? 0)}` : '') +
        (month.targetCents != null ? ` · goal ${formatCurrency(month.targetCents)}` : ''),
      editable: true,
    };
  }
  const oneOffNote = month.oneOffIncome ? ` · incl. ${formatCurrency(month.oneOffIncome)} one-off` : '';

  if (month.status === 'actual') {
    return {
      amount: month.actualNet ?? 0,
      caption: (month.hasData ? `Saved${oneOffNote}` : 'No data') + goalAttainmentNote(month),
      editable: true,
    };
  }
  if (month.status === 'current') {
    return {
      amount: month.actualNet ?? 0,
      caption:
        (month.targetCents != null ? `So far${goalAttainmentNote(month)}` : 'So far this month') +
        oneOffNote,
      editable: true,
    };
  }
  // A month ahead the member has already filled in is forecast from those rows.
  // Name the source explicitly and keep the goal visible beside it: the figure
  // is what their entries say, the goal is what they had planned, and hiding
  // either one is how the tab misled a household in the first place.
  if (month.projectionSource === 'entered') {
    return {
      amount: month.projectedNet,
      caption:
        'From your entries' +
        // Income in, spending not: say so rather than let the figure read as a
        // full picture. This is the honest half of "data beats plan".
        (month.spendingLogged === false ? ' · no spending logged yet' : '') +
        (month.targetCents != null ? ` · goal ${formatCurrency(month.targetCents)}` : '') +
        oneOffNote,
      editable: true,
    };
  }

  return {
    amount: month.projectedNet,
    caption:
      month.targetCents != null
        ? 'Your goal'
        : month.projectionSource === 'goal'
          ? 'From your savings goal'
          : `At your recent pace (${formatCurrency(paceMonthly)})`,
    editable: true,
  };
}

export type GoalTone = 'hit' | 'near' | 'miss' | 'none';

/**
 * How a graded month reads at a glance: green once the goal is met, amber
 * within reach (≥75%), red below that. Deficit (≤0) targets have no
 * percentage — they fall back to the plain hit/miss boolean, which already
 * accounts for the sign (losing less than planned still hits).
 */
export function monthGoalTone(month: SavingsProjectionMonth): GoalTone {
  if (month.goalHit == null) return 'none';
  if (month.goalAttainmentPct != null) {
    if (month.goalAttainmentPct >= 100) return 'hit';
    if (month.goalAttainmentPct >= 75) return 'near';
    return 'miss';
  }
  return month.goalHit ? 'hit' : 'miss';
}

/**
 * One-line year-wide scorecard: how many graded months hit their goal, and
 * (when at least one had a meaningful percentage) how close the rest ran on
 * average. Null when the household hasn't graded a single month yet — the
 * card that renders this simply doesn't show.
 */
export function goalPerformanceSummary(perf: SavingsGoalPerformance): string | null {
  if (perf.monthsTracked === 0) return null;
  const monthWord = perf.monthsTracked === 1 ? 'month' : 'months';
  const rate = perf.hitRatePct != null ? ` (${perf.hitRatePct}%)` : '';
  const avg =
    // The MEDIAN, not the mean: attainment is a ratio that can go deeply
    // negative, and one -122% month drags a mean somewhere no month ever sat.
    // Falls back to the mean for a backend that predates the median field.
    perf.medianAttainmentPct != null
      ? ` — typically ${perf.medianAttainmentPct}% of target.`
      : perf.avgAttainmentPct != null
        ? ` — averaging ${perf.avgAttainmentPct}% of target.`
        : '.';
  return `You hit your goal in ${perf.monthsHit} of ${perf.monthsTracked} ${monthWord}${rate}${avg}`;
}

/**
 * "$X saved so far this year — $Y to go" (or "$Y past goal" once cleared).
 * Grounds the hit/miss scorecard in the household's actual banked total —
 * completed months PLUS the current in-progress one — against the year goal,
 * so the card answers "how far are we" in dollars, not just a hit rate. Null
 * when no year goal is set, since there is then no gap to report.
 */
export function goalProgressSummary(p: SavingsProjection): string | null {
  if (p.yearGoal == null) return null;
  const gap = p.yearGoal - p.actualToDate;
  const gapText =
    gap > 0 ? `${formatCurrency(gap)} to go` : `${formatCurrency(Math.abs(gap))} past goal`;
  return `${formatCurrency(p.actualToDate)} saved so far this year · ${gapText}`;
}

/** Display copy for each selectable Projection method — labels only; the "why" lives in `methodExplanationText`. */
export const PROJECTION_METHOD_LABELS: Record<ProjectionMethod, string> = {
  historical_average: 'Recent Average',
  trend: 'Trend',
  planned_budget: 'Planned Budget',
  hybrid: 'Smart Blend',
  pessimistic: 'Pessimistic',
};

/** This method's year-end figure from `methodComparison`, or null if absent (older backend). */
function yearEndFor(p: SavingsProjection, method: ProjectionMethod): number | null {
  return p.methodComparison?.find((m) => m.method === method)?.projectedYearEnd ?? null;
}

/**
 * "How is this calculated" copy for one method's info sheet — grounded in the
 * household's OWN numbers wherever the API already carries them
 * (`paceMonthly`, `methodComparison`, a month's `plannedBudget` breakdown,
 * `goalPerformance.hitRatePct`), not just the abstract formula.
 */
export function methodExplanationText(method: ProjectionMethod, p: SavingsProjection): string {
  if (p.forecast) {
    const scenario = p.forecast.scenarios.find((s) => s.method === method);
    return `${scenario?.label ?? 'Base'} scenario: expected income − recurring payments − variable spending. ` +
      `Uses up to 6 completed months with income and spending (${p.forecast.sampleMonths} available). ` +
      `Base uses median income and spending; Cautious uses lower-quartile income with Base spending; Optimistic keeps Base income with lower spending; Pessimistic combines lower income and higher spending. ` +
      `Recurring income templates or entered future income replace the income estimate. A Planning budget anchors spending, with historical variation around it; spending never falls below logged expenses. ` +
      `One-off income counts only in its own month. Savings goals do not change the forecast. ` +
      `This is a scenario range, not a probability or guarantee.`;
  }
  const yearEnd = yearEndFor(p, method);
  const yearEndNote = yearEnd != null ? ` Projecting ${formatCurrency(yearEnd)} for ${p.year} this way.` : '';

  switch (method) {
    case 'historical_average':
      return (
        `Averages your last few completed months of actual net savings (income minus all spending) ` +
        `and repeats that flat number for every month ahead you haven't planned or logged yet.\n\n` +
        `Your recent average is ${formatCurrency(p.paceMonthly)}/month.${yearEndNote}`
      );
    case 'trend':
      return (
        `Takes your most recent completed month and continues its recent month-over-month direction ` +
        `forward, instead of flattening everything into one flat average — so a savings streak that's ` +
        `improving (or slipping) keeps moving rather than settling in the middle.\n\n` +
        `Your flat average is ${formatCurrency(p.paceMonthly)}/month for comparison.${yearEndNote}`
      );
    case 'planned_budget': {
      const example = p.months.find((m) => m.plannedBudget != null);
      if (!example?.plannedBudget) {
        return (
          `Income minus your recurring payments minus your Planning-tab budget, for each month ahead.\n\n` +
          `We don't have enough set up yet (income sources, recurring payments, or a Planning budget) to ` +
          `calculate this for ${p.year} — it falls back to your recent average until you do.`
        );
      }
      const b = example.plannedBudget;
      const monthName = MONTH_LONG[example.month - 1] ?? '';
      return (
        `Income minus your recurring payments minus your Planning-tab budget, for each month ahead.\n\n` +
        `For ${monthName}: ${formatCurrency(b.expectedIncomeCents)} expected income − ` +
        `${formatCurrency(b.recurringPaymentsCents)} recurring payments − ` +
        `${formatCurrency(b.spendingGoalCents)} Planning budget = ${formatCurrency(b.netCents)}.` +
        `${yearEndNote}`
      );
    }
    case 'hybrid': {
      const hitRate = p.goalPerformance.hitRatePct;
      const reliability =
        hitRate != null
          ? `you've hit your own savings goals ${hitRate}% of the time`
          : `you don't have a track record of goals yet, so it splits evenly`;
      return (
        `Our recommended default. Blends your Planned Budget figure with your Recent Average, weighted ` +
        `by how often you've actually hit your own savings goals in the past — so an optimistic plan gets ` +
        `pulled back toward reality, and a proven habit gets trusted more.\n\n` +
        `Right now ${reliability}.${yearEndNote}`
      );
    }
    default:
      return '';
  }
}

/**
 * Savings → Projection. The year on one screen: what's already banked, an
 * editable goal for every month still ahead (one at a time or the whole rest of
 * the year in one gesture), and the gap between the household's current pace and
 * the pace they have already proven they can hit — the savings room.
 *
 * PROP-LESS and self-fetching like every other Savings sub-view; the year comes
 * from `useSavingsStore` (the container swaps its month stepper for a year
 * stepper on this tab). No money math happens here — every figure below is
 * computed by `GET /savings/projection`.
 */
export function SavingsProjectionView() {
  const colors = useAppColors();
  const { theme } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear, dataRevision, markDirty } = useSavingsStore();
  // Net savings is derived from Budget expenses, so a budget edit must refresh here too.
  const budgetDataRevision = useBudgetStore((s) => s.dataRevision);

  const [projection, setProjection] = useState<SavingsProjection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editorMonth, setEditorMonth] = useState<number | null>(null);
  const [editorApplyAll, setEditorApplyAll] = useState(false);
  // null = "no explicit pick yet, defer to the household default". Once the
  // member taps a method card this pins the view to it until they navigate
  // away — a bare data refresh must not silently switch what they're looking at.
  const [viewMethod, setViewMethod] = useState<ProjectionMethod | null>(null);
  // Captured from the FIRST response that resolved the default itself (i.e.
  // while viewMethod was still null) — kept separately from `projection.method`
  // so "Set as default" can tell whether the method being viewed already IS
  // the household's stored default.
  const [householdDefaultMethod, setHouseholdDefaultMethod] = useState<ProjectionMethod | null>(
    null
  );
  const [settingDefault, setSettingDefault] = useState(false);

  const loadGeneration = React.useRef(0);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!currentHousehold?.id) {
      setProjection(null);
      return;
    }
    try {
      const p = await savingsApi.getProjection(
        currentHousehold.id,
        selectedYear,
        viewMethod ?? undefined
      );
      if (generation !== loadGeneration.current) return;
      setProjection(p);
      if (viewMethod == null) setHouseholdDefaultMethod(p.method);
    } catch (error) {
      console.error('Error loading savings projection:', error);
      if (generation === loadGeneration.current) setProjection(null);
    }
  }, [currentHousehold?.id, selectedYear, viewMethod]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setIsLoading(true);
      load().finally(() => { if (active) setIsLoading(false); });
      return () => {
        active = false;
        ++loadGeneration.current;
      };
    }, [load])
  );

  // Skips only the very first run (useFocusEffect above already covers the
  // initial load) — every later change, including a bare year-nav tap with
  // no mutation, must still refetch. Gating on `dataRevision !== 0` here
  // used to silently no-op year navigation for a household that hadn't
  // triggered a mutation yet this session.
  const didMountRef = React.useRef(false);
  React.useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    void load();
  }, [currentHousehold?.id, selectedYear, dataRevision, budgetDataRevision, load]);

  /** Every month still open to a goal: the live month plus everything after it. */
  const remainingMonths = useMemo(
    () => (projection?.months ?? []).filter((m) => m.status !== 'actual').map((m) => m.month),
    [projection]
  );

  /**
   * Every month of the year, elapsed or not — goals are editable everywhere so
   * a household can grade a month it already lived through, or plan the whole
   * year (including the months behind it) in one "apply to all" gesture.
   */
  const allMonths = useMemo(() => (projection?.months ?? []).map((m) => m.month), [projection]);

  const writeTargets = useCallback(
    async (months: number[], targetCents: number | null) => {
      if (!currentHousehold?.id || !months.length) return;
      setSaving(true);
      try {
        await savingsApi.setProjectionTargets(currentHousehold.id, {
          year: selectedYear, months, targetCents,
        });
        await load();
        setEditorMonth(null);
        // Other Savings surfaces read goals/pace too — keep them in step.
        markDirty();
      } catch (error) {
        console.error('Error saving savings targets:', error);
        Alert.alert('Error', 'Could not save that goal. Please try again.');
      } finally {
        setSaving(false);
      }
    },
    [currentHousehold?.id, selectedYear, markDirty, load]
  );

  const setAsHouseholdDefault = useCallback(async () => {
    if (!currentHousehold?.id || !projection) return;
    setSettingDefault(true);
    try {
      const p = await savingsApi.setDefaultProjectionMethod(
        currentHousehold.id,
        selectedYear,
        projection.method
      );
      setProjection(p);
      setHouseholdDefaultMethod(p.method);
      // Home's stat + the widget/Watch snapshot read the household default too.
      markDirty();
    } catch (error) {
      console.error('Error setting default projection method:', error);
      Alert.alert('Error', 'Could not set that as your household default. Please try again.');
    } finally {
      setSettingDefault(false);
    }
  }, [currentHousehold?.id, selectedYear, projection, markDirty]);

  const selectMethod = async (method: ProjectionMethod) => {
    if (!projection?.forecast) {
      setViewMethod(method);
      return;
    }
    if (!currentHousehold?.id || settingDefault) return;
    setSettingDefault(true);
    const generation = ++loadGeneration.current;
    try {
      const result = await savingsApi.setDefaultProjectionMethod(currentHousehold.id, selectedYear, method);
      if (generation === loadGeneration.current) {
        setProjection(result);
        setHouseholdDefaultMethod(result.method);
      }
      setViewMethod(null);
    } catch (error) {
      console.error('Error saving projection scenario:', error);
      Alert.alert('Error', 'Could not save this scenario. Please try again.');
    } finally {
      setSettingDefault(false);
    }
  };

  const barData = useMemo(
    () =>
      (projection?.months ?? []).map((m) => ({
        value: (m.forecastBreakdown || m.status === 'future' ? m.projectedNet : (m.actualNet ?? 0)) / 100,
        label: MONTH_ABBR[m.month - 1] ?? String(m.month),
        frontColor: projectionBarColor(m, {
          positive: theme.pastel.teal,
          negative: colors.chartNegative,
        }),
      })),
    [projection, theme.pastel.teal, colors.chartNegative]
  );

  const suggestions = useMemo<TargetSuggestion[]>(() => {
    if (!projection) return [];
    const out: TargetSuggestion[] = [];
    if (projection.paceMonthly > 0) out.push({ label: 'Recent pace', cents: projection.paceMonthly });
    if (projection.bestMonth && projection.bestMonth.net > projection.paceMonthly) {
      out.push({ label: 'Your best month', cents: projection.bestMonth.net });
    }
    if (projection.monthlyGoal != null && projection.monthlyGoal > 0) {
      out.push({ label: 'Goal allocation', cents: projection.monthlyGoal });
    }
    return out;
  }, [projection]);

  const chartWidth = Math.max(200, windowWidth - 96);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer} testID="savings-projection-loading">
        <ActivityIndicator size="large" color={theme.pastel.teal} />
      </View>
    );
  }

  if (!projection) {
    return (
      <View style={styles.empty} testID="savings-projection-empty">
        <Typography variant="body" color={colors.textSecondary} align="center">
          Nothing to project yet. Add income or spending to see where your year could land.
        </Typography>
      </View>
    );
  }

  const headline = projectionHeadline(projection);
  // The bar fills toward whichever is more ambitious: the household's own goal
  // or the pace they've proven. Never toward a number below the projection, so
  // an on-track year still reads as progress rather than a full bar.
  const projectionCeiling = Math.max(
    projection.projectedYearEnd,
    projection.potentialYearEnd,
    projection.yearGoal ?? 0,
    1
  );
  const editorTarget =
    editorMonth != null
      ? (projection.months[editorMonth - 1]?.targetCents ?? null)
      : null;
  // "Apply to all" always runs forward from the tapped month through December —
  // even when that month is behind you, so a goal can be backfilled for the
  // whole rest of the year (or the whole year, from January) in one gesture.
  const editorRemainingCount =
    editorMonth != null ? allMonths.filter((m) => m >= editorMonth).length : 0;
  const goalPerformanceLine = goalPerformanceSummary(projection.goalPerformance);
  const goalProgressLine = goalProgressSummary(projection);
  const isViewingHouseholdDefault =
    householdDefaultMethod != null && projection.method === householdDefaultMethod;

  return (
    <View testID="savings-projection" style={styles.root}>
      {/* Year-end hero */}
      <Card variant="elevated" style={styles.heroCard}>
        <Typography variant="caption1" color={colors.textSecondary}>
          {projection.forecast ? `Estimated total at end of ${projection.year}` : `Projected ${projection.year} savings`}
        </Typography>
        <Typography
          variant="largeTitle"
          weight="bold"
          color={projection.projectedYearEnd < 0 ? colors.chartNegative : projection.forecast && projection.projectedYearEnd < projection.actualToDate ? colors.chartNegative : theme.pastel.teal}
          testID="savings-projection-year-end"
        >
          {formatCurrency(projection.projectedYearEnd)}
        </Typography>
        {projection.forecast ? <ForecastBridge recorded={projection.actualToDate} yearEnd={projection.projectedYearEnd} currentMonth={projection.currentMonth} /> : <ProgressBar
          value={Math.max(0, projection.projectedYearEnd)}
          max={projectionCeiling}
          color={theme.pastel.teal}
          height={10}
          testID="savings-projection-progress"
        />}
        {/* Carries three separate figures the member reads as one sentence, so
            it needs its own handle for a UI test to assert them. */}
        <Typography
          variant="caption2"
          color={colors.textSecondary}
          testID="savings-projection-banked"
        >
          {projection.forecast ? 'Based on recorded income and expenses, not your bank balance.' : <>
          {formatCurrency(projection.actualToDate)} banked
          {projection.monthsRemaining > 0
            ? ` · ${projection.monthsRemaining} month${projection.monthsRemaining > 1 ? 's' : ''} to go`
            : ' · year complete'}
          {projection.yearGoal != null ? ` · goal ${formatCurrency(projection.yearGoal)}` : ''}
          </>}
        </Typography>
      </Card>

      {/* Method picker — 4 ways to forecast the year, each with an "i" explaining how */}
      <Card variant="outlined" style={styles.sectionCard} testID="savings-projection-methods">
        <Typography variant="subheadline" weight="semibold">
          {projection.forecast ? 'Savings forecast · scenarios' : 'Projection method'}
        </Typography>
        <Typography variant="caption2" color={colors.textSecondary}>
          {projection.forecast ? 'Your selection applies across the app and is saved on this device.' : ''}
        </Typography>
        <View style={styles.methodGrid}>
          {(projection.forecast?.scenarios.map((s) => s.method) ?? PROJECTION_METHODS).map((method) => {
            const selected = method === projection.method;
            const label = projection.forecast?.scenarios.find((s) => s.method === method)?.label ?? PROJECTION_METHOD_LABELS[method];
            const yearEnd = yearEndFor(projection, method);
            return (
              <TouchableOpacity
                key={method}
                activeOpacity={0.8}
                onPress={() => void selectMethod(method)}
                disabled={settingDefault}
                style={[
                  styles.methodTile,
                  projection.forecast && styles.scenarioTile,
                  {
                    borderColor: selected ? theme.pastel.teal : colors.borderColor,
                    backgroundColor: selected ? `${theme.pastel.teal}14` : 'transparent',
                  },
                ]}
                testID={`savings-projection-method-${method}`}
              >
                <View style={styles.methodTileHeader}>
                  <Typography
                    variant="caption1"
                    weight="semibold"
                    color={selected ? theme.pastel.teal : colors.textPrimary}
                    style={styles.methodTileLabel}
                  >
                    {label}
                  </Typography>
                  <InfoButton
                    testID={`savings-projection-method-info-${method}`}
                    title={label}
                    info={methodExplanationText(method, projection)}
                    sheetHeight={projection.forecast ? 'full' : 'content'}
                  >
                    {projection.forecast ? <ScenarioExplanation projection={projection} method={method} /> : undefined}
                  </InfoButton>
                </View>
                <Typography variant="caption2" color={colors.textSecondary}>
                  {yearEnd != null ? formatCurrency(yearEnd) : '—'}
                </Typography>
                {projection.forecast && yearEnd != null && <Typography
                  variant="caption2"
                  color={yearEnd < projection.actualToDate ? colors.chartNegative : theme.pastel.teal}
                  testID={`scenario-change-${method}`}
                >{forecastChangeText(projection.actualToDate, yearEnd)}</Typography>}
                {!projection.forecast && householdDefaultMethod === method && (
                  <Typography variant="caption2" color={theme.pastel.teal} testID="savings-projection-default-badge">
                    Household default
                  </Typography>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        {!projection.forecast && !isViewingHouseholdDefault && (
          <TouchableOpacity
            onPress={setAsHouseholdDefault}
            disabled={settingDefault}
            testID="savings-projection-set-default"
          >
            <Typography variant="body" weight="semibold" color={theme.pastel.teal}>
              {settingDefault ? 'Setting…' : `Set ${PROJECTION_METHOD_LABELS[projection.method]} as household default`}
            </Typography>
          </TouchableOpacity>
        )}
      </Card>

      {projection.forecast && (
        <Card variant="outlined" style={styles.sectionCard} testID="savings-forecast-assumptions">
          <Typography variant="subheadline" weight="semibold">Forecast range</Typography>
          <Typography variant="body" testID="savings-forecast-range">
            {formatCurrency(Math.min(...projection.forecast.scenarios.map((s) => s.projectedYearEnd)))} – {formatCurrency(Math.max(...projection.forecast.scenarios.map((s) => s.projectedYearEnd)))}
          </Typography>
          <Typography variant="caption2" color={colors.textSecondary}>
            Scenario range, not a guarantee · {projection.forecast.sampleMonths} completed months of history
          </Typography>
          {projection.forecast.goalGap != null && (
            <Typography variant="body">
              {formatCurrency(Math.abs(projection.forecast.goalGap))} {projection.forecast.goalGap >= 0 ? 'above' : 'below'} your year goal
            </Typography>
          )}
          {projection.forecast.requiredMonthly != null && (
            <Typography variant="caption2" color={colors.textSecondary}>
              Additional net needed per open month: {formatCurrency(projection.forecast.requiredMonthly)}
            </Typography>
          )}
          {projection.forecast.warnings.map((warning) => (
            <Typography key={warning} variant="caption2" color={colors.textSecondary}>{warning}</Typography>
          ))}
        </Card>
      )}

      {/* Legacy method insight; scenarios explain assumptions above. */}
      {!projection.forecast && <Card variant="outlined" style={styles.sectionCard}>
        <View style={styles.motivationHeader}>
          <Icon name="sparkles" size={18} color={theme.pastel.teal} />
          <Typography
            variant="subheadline"
            weight="semibold"
            style={styles.motivationTitle}
            testID="savings-projection-headline"
          >
            {headline.title}
          </Typography>
        </View>
        <Typography variant="body" color={colors.textSecondary}>
          {headline.body}
        </Typography>
      </Card>}

      {/* Goal performance — how the household's own graded months actually went */}
      {goalPerformanceLine != null && (
        <Card variant="outlined" style={styles.sectionCard}>
          <View style={styles.motivationHeader}>
            <Icon name="trophy-outline" size={18} color={theme.pastel.teal} />
            <Typography
              variant="subheadline"
              weight="semibold"
              style={styles.motivationTitle}
              testID="savings-projection-goal-performance-title"
            >
              Goal performance
            </Typography>
          </View>
          {goalProgressLine != null && (
            <>
              <ProgressBar
                value={Math.max(0, projection.actualToDate)}
                max={Math.max(projection.yearGoal ?? 0, projection.actualToDate, 1)}
                color={theme.pastel.teal}
                height={8}
                testID="savings-projection-goal-performance-progress"
              />
              <Typography
                variant="caption1"
                weight="semibold"
                color={colors.textPrimary}
                testID="savings-projection-goal-performance-amount"
              >
                {goalProgressLine}
              </Typography>
            </>
          )}
          <Typography
            variant="body"
            color={colors.textSecondary}
            testID="savings-projection-goal-performance"
          >
            {goalPerformanceLine}
          </Typography>
        </Card>
      )}

      {/* Actual vs planned, month by month */}
      {barData.length > 0 && (
        <Card
          variant="outlined"
          style={styles.sectionCard}
          testID="savings-projection-chart"
        >
          <Typography variant="subheadline" weight="semibold">
            {projection.year} month by month
          </Typography>
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: theme.pastel.teal }]} />
              <Typography variant="caption2" color={colors.textSecondary}>
                Saved
              </Typography>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: `${theme.pastel.teal}${PROJECTED_ALPHA}` },
                ]}
              />
              <Typography variant="caption2" color={colors.textSecondary}>
                {projection.forecast ? 'Forecast' : 'Planned'}
              </Typography>
            </View>
          </View>
          <AppBarChart data={barData} width={chartWidth} allowNegative />
        </Card>
      )}

      {/* Per-month list — the write surface */}
      <Card variant="outlined" style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Typography variant="subheadline" weight="semibold">
            {projection.forecast ? 'Monthly forecast and goals' : 'Monthly goals'}
          </Typography>
          {allMonths.length > 1 && (
            <TouchableOpacity
              onPress={() => {
                setEditorApplyAll(true);
                setEditorMonth(allMonths[0]);
              }}
              testID="savings-projection-plan-year"
            >
              <Typography variant="body" weight="semibold" color={theme.pastel.teal}>
                Plan the year
              </Typography>
            </TouchableOpacity>
          )}
        </View>

        {projection.monthsWithTarget === 0 && remainingMonths.length > 0 && (
          <Typography
            variant="caption2"
            color={colors.textSecondary}
            testID="savings-projection-no-goals-hint"
          >
            {projection.forecast
              ? 'Goals are benchmarks, not forecast income. Tap a month to set a goal without changing its forecast.'
              : projection.monthlyGoal != null
              ? `No month-by-month goals yet — the months ahead use your ${formatCurrency(projection.monthlyGoal)}/mo savings goal. Tap a month to set your own figure.`
              : `No goals set for the months ahead — they ride your recent pace for now. Tap a month below, or Plan the year, to set your own.`}
          </Typography>
        )}

        {projection.months.map((m) => {
          const meta = monthRowMeta(m, projection.paceMonthly);
          const isCurrent = m.status === 'current';
          const tone = monthGoalTone(m);
          const amountColor =
            tone === 'hit'
              ? colors.success
              : tone === 'near'
                ? colors.chartNegative
                : tone === 'miss'
                  ? colors.chartNegative
                  : meta.amount < 0
                    ? colors.chartNegative
                    : m.status === 'future'
                      ? colors.textSecondary
                      : colors.textPrimary;
          const row = (
            <View
              style={[
                styles.monthRow,
                isCurrent && {
                  backgroundColor: `${theme.pastel.teal}0F`,
                  borderColor: `${theme.pastel.teal}66`,
                },
              ]}
            >
              <View style={styles.monthLabel}>
                <Typography variant="body" weight={isCurrent ? 'semibold' : 'medium'}>
                  {MONTH_LONG[m.month - 1]}
                </Typography>
                {/* "Saved · 111% of CA$7,000 goal" — the per-month grade. */}
                <Typography
                  variant="caption2"
                  color={colors.textSecondary}
                  testID={`savings-projection-month-caption-${m.month}`}
                >
                  {meta.caption}
                </Typography>
              </View>
              <View style={styles.monthValue}>
                <Typography
                  variant="body"
                  weight="semibold"
                  color={amountColor}
                  testID={`savings-projection-month-${m.month}`}
                >
                  {m.status === 'actual' && !m.hasData ? '—' : formatCurrency(meta.amount)}
                </Typography>
                {meta.editable && (
                  <Icon name="chevron-forward" size={16} color={colors.textSecondary} />
                )}
              </View>
            </View>
          );

          return meta.editable ? (
            <TouchableOpacity
              key={m.month}
              activeOpacity={0.8}
              onPress={() => {
                setEditorApplyAll(false);
                setEditorMonth(m.month);
              }}
              testID={`savings-projection-edit-${m.month}`}
            >
              {row}
            </TouchableOpacity>
          ) : (
            <View key={m.month}>{row}</View>
          );
        })}
      </Card>

      {editorMonth != null && (
        <ProjectionTargetModal
          visible
          year={projection.year}
          month={editorMonth}
          initialTarget={editorTarget}
          remainingCount={editorRemainingCount}
          suggestions={suggestions}
          initialApplyToAll={editorApplyAll}
          saving={saving}
          onClose={() => setEditorMonth(null)}
          onSubmit={(cents, applyToAll) =>
            writeTargets(
              applyToAll ? allMonths.filter((m) => m >= editorMonth) : [editorMonth],
              cents
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    alignSelf: 'stretch',
  },
  loadingContainer: {
    paddingVertical: EmptyState.blockPaddingVertical,
    alignItems: 'center',
  },
  empty: {
    paddingVertical: Spacing.xxl,
  },
  heroCard: {
    marginBottom: Spacing.base,
    gap: Spacing.xs,
  },
  sectionCard: {
    marginBottom: Spacing.base,
    gap: Spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  motivationHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
  },
  motivationTitle: { flex: 1 },
  legendRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  monthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  monthLabel: {
    flex: 1,
    gap: Spacing.xxs,
  },
  monthValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  methodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  methodTile: {
    flexBasis: '47%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    padding: Spacing.sm,
    gap: Spacing.xxs,
  },
  scenarioTile: {
    flexBasis: '100%',
  },
  methodTileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.xs,
  },
  methodTileLabel: {
    flex: 1,
  },
});
