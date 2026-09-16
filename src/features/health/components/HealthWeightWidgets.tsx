import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, ProgressRing, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import type { DatedValue } from '../healthDashboards';
import { formatWeightValue, type WeightUnit } from '../healthLocalStorage';
import { formatAxisDate } from '../healthTrends';
import {
  ACTIVITY_LABELS,
  MIN_CORRELATION_SAMPLES,
  MIN_PROJECTION_SAMPLES,
  bmiCategory,
  type BodyComposition,
  type CalorieWeightCorrelation,
  type MonthlyWeight,
  type PeriodComparison,
  type WeightGoalProgress,
  type WeightHistoryStats,
  type WeightProjection,
  type WeightStreak,
} from '../healthWeightAnalytics';
import type { HealthActivityLevel } from '../healthWeightStorage';

import { HealthStatRow } from './HealthWeightDashboard';

/**
 * Symply Health — the donor's fourteen reorderable Weight-dashboard widgets.
 *
 * `WeightDashboardLayoutManager.WeightDashboardWidgetType` declares exactly
 * fourteen cases and `WeightDashboardView.widgetView(for:)` switches over all of
 * them. Five of those fourteen render nothing in the donor but a "coming soon"
 * line — `monthlyProgress`, `streaks`, `predictions`, `measurements` and
 * `calorieCorrelation`. Four of the five are built for real here (the maths is
 * in `healthWeightAnalytics.ts`); `measurements` links to the Body tab, which
 * already owns the sites the donor's placeholder promised.
 *
 * Every widget is a PURE function of one model computed once on the screen, so
 * a figure cannot differ between two widgets that quote it, and each can be
 * unit-tested without the screen. None of them loads anything.
 *
 * Two rules run through all of them:
 *  - a widget with nothing to show says so IN WORDS and names what would fill
 *    it, rather than rendering a zero or an empty box;
 *  - any derived figure that rests on an assumption states the assumption next
 *    to it (sample size, formula, the unit, the fact that a correlation is not
 *    a cause).
 */

/* ------------------------------------------------------------------ */
/* The registry                                                        */
/* ------------------------------------------------------------------ */

export const WEIGHT_WIDGET_KEYS = [
  'mainChart',
  'dataStack',
  'goalProgress',
  'weeklyChange',
  'bodyComposition',
  'aiInsights',
  'bmiTracker',
  'weightHistory',
  'monthlyProgress',
  'leanMass',
  'streaks',
  'predictions',
  'measurements',
  'calorieCorrelation',
] as const;

export type WeightWidgetKey = (typeof WEIGHT_WIDGET_KEYS)[number];

export interface WeightWidgetMeta {
  key: WeightWidgetKey;
  title: string;
  icon: string;
  description: string;
}

/** Titles + one-line descriptions, ported from the donor's `displayName`/`description`. */
export const WEIGHT_WIDGETS: readonly WeightWidgetMeta[] = [
  {
    key: 'mainChart',
    title: 'Weight chart',
    icon: 'trends-tab',
    description: 'Your readings over the selected window, as a trend or as daily change.',
  },
  {
    key: 'dataStack',
    title: 'Averages',
    icon: 'insights',
    description: 'This window’s average against the one before it.',
  },
  {
    key: 'goalProgress',
    title: 'Goal progress',
    icon: 'goals',
    description: 'How far you are from your target weight.',
  },
  {
    key: 'weeklyChange',
    title: 'This week',
    icon: 'weight',
    description: 'Weight change over the past week, in figures.',
  },
  {
    key: 'bodyComposition',
    title: 'Body composition',
    icon: 'body-measurements',
    description: 'Fat mass and lean mass, from your logged body fat.',
  },
  {
    key: 'aiInsights',
    title: 'Insights',
    icon: 'ai-coach',
    description: 'Plain-language readings of your own numbers.',
  },
  {
    key: 'bmiTracker',
    title: 'BMI tracker',
    icon: 'score-gauge',
    description: 'Body Mass Index and where it sits on the scale.',
  },
  {
    key: 'weightHistory',
    title: 'Weight history',
    icon: 'history',
    description: 'Starting, current, lowest and highest — each with its date.',
  },
  {
    key: 'monthlyProgress',
    title: 'Monthly progress',
    icon: 'calendar',
    description: 'Month-by-month averages and the change between them.',
  },
  {
    key: 'leanMass',
    title: 'Lean mass',
    icon: 'strength',
    description: 'Body weight minus fat mass, tracked over time.',
  },
  {
    key: 'streaks',
    title: 'Logging streak',
    icon: 'streak',
    description: 'Consecutive days you have stepped on the scale.',
  },
  {
    key: 'predictions',
    title: 'Projection',
    icon: 'trends',
    description: 'Where your current rate of change leads, and when.',
  },
  {
    key: 'measurements',
    title: 'Body measurements',
    icon: 'height',
    description: 'Waist, chest and the other sites, on the Body tab.',
  },
  {
    key: 'calorieCorrelation',
    title: 'Calories vs weight',
    icon: 'calories',
    description: 'Whether your intake and your weight moved together.',
  },
] as const;

/**
 * The default dashboard set.
 *
 * `goalProgress` is not in this list — the screen renders it as its own fixed
 * section at the top rather than as a reorderable dashboard card. `weeklyChange`
 * ("This week") and `dataStack` ("Averages") are both dropped entirely: the
 * same window-over-window comparison is already the first line `aiInsights`
 * states in words, so a card repeating it as bare figures is redundant. None
 * of the three appears in Customise either — see the screen's own filter over
 * `WEIGHT_WIDGETS`.
 */
export const DEFAULT_WEIGHT_WIDGETS: readonly WeightWidgetKey[] = ['mainChart', 'aiInsights'];

/* ------------------------------------------------------------------ */
/* The model every widget reads                                        */
/* ------------------------------------------------------------------ */

export interface WeightWidgetModel {
  /** The unit every figure below is expressed in. */
  unit: WeightUnit;
  /** Human span of the selected window, e.g. `13 Jun – 12 Jul`. */
  windowLabel: string;
  /** Readings inside the window, oldest first. */
  daily: DatedValue[];
  /** The whole log, oldest first — history, streak, projection and months. */
  allDaily: DatedValue[];
  /** Target in the display unit; null when none is set. */
  target: number | null;
  progress: WeightGoalProgress;
  streak: WeightStreak;
  history: WeightHistoryStats;
  projection: WeightProjection;
  monthly: MonthlyWeight[];
  /** Window vs the window before it. */
  windowCompare: PeriodComparison;
  week: PeriodComparison;
  month: PeriodComparison;
  bmi: number | null;
  bmr: number | null;
  tdee: number | null;
  activityLevel: HealthActivityLevel | null;
  composition: BodyComposition | null;
  correlation: CalorieWeightCorrelation;
  /** The main chart, rendered by the screen (it owns the width and the toggles). */
  chart: React.ReactNode;
  /** Opens the Body tab from the measurements widget. */
  onOpenBody?: () => void;
}

/* ------------------------------------------------------------------ */
/* Shared shell                                                        */
/* ------------------------------------------------------------------ */

function WidgetCard({
  meta,
  children,
  testID,
}: {
  meta: WeightWidgetMeta;
  children: React.ReactNode;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <Card
      variant="filled"
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      testID={testID}
    >
      <View style={styles.head}>
        <Icon name={meta.icon} size={16} color={colors.textSecondary} />
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          {meta.title.toUpperCase()}
        </Typography>
      </View>
      {children}
    </Card>
  );
}

/** An empty widget always names what would fill it — never a bare "no data". */
function Empty({ children, testID }: { children: string; testID: string }) {
  const colors = useAppColors();
  return (
    <Typography variant="body" color={colors.textSecondary} testID={testID}>
      {children}
    </Typography>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  const colors = useAppColors();
  return (
    <Typography variant="caption1" color={colors.textSecondary}>
      {children}
    </Typography>
  );
}

function withUnit(value: number | null | undefined, unit: WeightUnit): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${formatWeightValue(value)} ${unit}`
    : '—';
}

function signed(value: number | null | undefined, unit: WeightUnit): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${formatWeightValue(rounded)} ${unit}`;
}

/* ------------------------------------------------------------------ */
/* The fourteen                                                        */
/* ------------------------------------------------------------------ */

function MainChartWidget({ model }: { model: WeightWidgetModel }) {
  return (
    <WidgetCard meta={WEIGHT_WIDGETS[0]} testID="health-weight-widget-mainChart">
      {model.chart}
    </WidgetCard>
  );
}

function DataStackWidget({ model }: { model: WeightWidgetModel }) {
  const { windowCompare, unit } = model;
  return (
    <WidgetCard meta={WEIGHT_WIDGETS[1]} testID="health-weight-widget-dataStack">
      {windowCompare.current.average === null && windowCompare.previous.average === null ? (
        <Empty testID="health-weight-dataStack-empty">
          Nothing logged in this window or the one before it, so there is no average to compare.
        </Empty>
      ) : (
        <>
          <HealthStatRow
            stats={[
              {
                label: windowCompare.current.label,
                value: withUnit(windowCompare.current.average, unit),
                testID: 'health-weight-dataStack-current',
              },
              {
                label: windowCompare.previous.label,
                value: withUnit(windowCompare.previous.average, unit),
                testID: 'health-weight-dataStack-previous',
              },
              {
                label: 'Change',
                value: signed(windowCompare.change, unit),
                testID: 'health-weight-dataStack-change',
              },
            ]}
          />
          <Note>
            Each average covers only the days you logged — {windowCompare.current.days} in this
            window, {windowCompare.previous.days} in the one before.
          </Note>
        </>
      )}
    </WidgetCard>
  );
}

function GoalProgressWidget({ model }: { model: WeightWidgetModel }) {
  const colors = useAppColors();
  const { progress, target, unit, history } = model;
  const current = history.current?.value ?? null;

  return (
    <WidgetCard meta={WEIGHT_WIDGETS[2]} testID="health-weight-widget-goalProgress">
      {target === null ? (
        <Empty testID="health-weight-goal-empty">
          No target weight set yet. Set one to see progress and a goal line on the chart.
        </Empty>
      ) : (
        <>
          <View style={styles.ringRow}>
            <ProgressRing
              progress={progress.fraction}
              size={104}
              stroke={11}
              color={colors.primary}
              label="of the way"
              testID="health-weight-goal-ring"
            />
            <View style={styles.ringStats}>
              <HealthStatRow
                stats={[
                  {
                    label: 'Current',
                    value: withUnit(current, unit),
                    testID: 'health-weight-goal-current',
                  },
                  {
                    label: 'Target',
                    value: withUnit(target, unit),
                    testID: 'health-weight-goal-target',
                  },
                  {
                    label: progress.reached ? 'Reached' : 'To go',
                    value: progress.reached
                      ? 'Yes'
                      : withUnit(Math.abs(progress.remaining), unit),
                    testID: 'health-weight-goal-remaining',
                  },
                ]}
              />
            </View>
          </View>
          <Note>
            {progress.direction === 'maintain'
              ? 'Measured against holding your current weight.'
              : // Deliberately not "your starting weight": the baseline is the
                // one you set OR your first logged weight, and this widget is
                // not told which — it used to claim the former either way.
                'Measured from where you started, so it does not change when you switch the chart range.'}
          </Note>
        </>
      )}
    </WidgetCard>
  );
}

function WeeklyChangeWidget({ model }: { model: WeightWidgetModel }) {
  const { week, unit } = model;
  return (
    <WidgetCard meta={WEIGHT_WIDGETS[3]} testID="health-weight-widget-weeklyChange">
      {week.change === null ? (
        <Empty testID="health-weight-weekly-empty">
          Log a weight this week and last week to see the change between them.
        </Empty>
      ) : (
        <>
          <HealthStatRow
            stats={[
              {
                label: 'Change',
                value: signed(week.change, unit),
                testID: 'health-weight-weekly-change',
              },
              {
                label: 'Percent',
                value:
                  week.changePercent === null
                    ? '—'
                    : `${week.changePercent > 0 ? '+' : ''}${week.changePercent}%`,
                testID: 'health-weight-weekly-percent',
              },
              {
                label: 'This week',
                value: withUnit(week.current.average, unit),
                testID: 'health-weight-weekly-current',
              },
            ]}
          />
          <Note>Week averages, Monday to Sunday — not a first-to-last reading.</Note>
        </>
      )}
    </WidgetCard>
  );
}

function BodyCompositionWidget({ model }: { model: WeightWidgetModel }) {
  const { composition, unit } = model;
  return (
    <WidgetCard meta={WEIGHT_WIDGETS[4]} testID="health-weight-widget-bodyComposition">
      {composition === null ? (
        <Empty testID="health-weight-composition-empty">
          Log a body-fat percentage on the Body tab to split your weight into fat and lean mass.
        </Empty>
      ) : (
        <>
          <HealthStatRow
            stats={[
              {
                label: 'Body fat',
                value: `${composition.bodyFatPercent}%`,
                testID: 'health-weight-composition-fat-percent',
              },
              {
                label: 'Fat mass',
                value: withUnit(composition.fatMassKg, unit),
                testID: 'health-weight-composition-fat-mass',
              },
              {
                label: 'Lean mass',
                value: withUnit(composition.leanMassKg, unit),
                testID: 'health-weight-composition-lean-mass',
              },
            ]}
          />
          <Note>
            Fat mass = weight × body fat %. The percentage is the one you measured on the Body
            tab, not a reading from a scale.
          </Note>
        </>
      )}
    </WidgetCard>
  );
}

/**
 * Insights.
 *
 * The donor calls this widget `aiInsights` and sends the member's weight
 * history to an AI provider. That is a P3 item here AND a privacy boundary the
 * BRD draws hard: health rows are never sent to an AI provider. So this reads
 * the SAME figures the donor's prompt would have sent and states them in plain
 * language on-device — every sentence is arithmetic already on this screen, and
 * nothing leaves the handset.
 */
function InsightsWidget({ model }: { model: WeightWidgetModel }) {
  const colors = useAppColors();
  const lines: string[] = [];
  const { unit, windowCompare, streak, projection, progress, target, history } = model;

  if (windowCompare.change !== null) {
    lines.push(
      windowCompare.change === 0
        ? 'Your average held steady against the previous window.'
        : // The direction is already in the verb, so the figure is a MAGNITUDE:
          // "fell -2 kg" is a double negative that reads as a gain.
          `Your average ${windowCompare.change < 0 ? 'fell' : 'rose'} ${withUnit(
            Math.abs(windowCompare.change),
            unit
          )} against the previous window.`
    );
  }
  if (projection.samples >= MIN_PROJECTION_SAMPLES && projection.slopePerDay !== 0) {
    const perWeek = Math.round(projection.slopePerDay * 7 * 10) / 10;
    lines.push(
      `At the current rate you are ${perWeek < 0 ? 'losing' : 'gaining'} about ${withUnit(
        Math.abs(perWeek),
        unit
      )} a week, fitted over ${projection.samples} readings.`
    );
  }
  if (target !== null && !progress.reached && progress.direction !== 'maintain') {
    lines.push(
      `${withUnit(Math.abs(progress.remaining), unit)} to go — ${Math.round(
        progress.fraction * 100
      )}% of the way from your baseline.`
    );
  }
  if (target !== null && progress.reached) {
    lines.push('You are at or past your target weight.');
  }
  if (streak.current > 0) {
    lines.push(
      `You have weighed in ${streak.current} day${streak.current === 1 ? '' : 's'} running; your best run is ${streak.best}.`
    );
  }
  if (history.lowest && history.current && history.lowest.value === history.current.value) {
    lines.push(`Today's reading is your lowest since ${formatAxisDate(history.lowest.date)}.`);
  }

  return (
    <WidgetCard meta={WEIGHT_WIDGETS[5]} testID="health-weight-widget-aiInsights">
      {lines.length === 0 ? (
        <Empty testID="health-weight-insights-empty">
          Log a few more weigh-ins and this reads your own numbers back to you.
        </Empty>
      ) : (
        <View style={styles.rows}>
          {lines.map((line) => (
            <View key={line} style={styles.insightRow}>
              <Icon name="insights" size={14} color={colors.primary} />
              <Typography variant="body" color={colors.textPrimary} style={styles.insightText}>
                {line}
              </Typography>
            </View>
          ))}
        </View>
      )}
      <Note>Worked out on this device from your own entries. Nothing is sent anywhere.</Note>
    </WidgetCard>
  );
}

function BmiWidget({ model }: { model: WeightWidgetModel }) {
  const colors = useAppColors();
  const band = bmiCategory(model.bmi);
  return (
    <WidgetCard meta={WEIGHT_WIDGETS[6]} testID="health-weight-widget-bmiTracker">
      {model.bmi === null || band === null ? (
        <Empty testID="health-weight-bmi-empty">
          Add your height in Goal &amp; body details to see your BMI.
        </Empty>
      ) : (
        <>
          <View style={styles.bigRow}>
            <Typography
              variant="title1"
              weight="bold"
              color={colors.textPrimary}
              testID="health-weight-bmi-value"
            >
              {String(model.bmi)}
            </Typography>
            <Typography variant="body" color={colors.textSecondary} testID="health-weight-bmi-band">
              {band.label} · {band.range}
            </Typography>
          </View>
          {model.bmr === null ? null : (
            <HealthStatRow
              stats={[
                {
                  label: 'BMR',
                  value: `${model.bmr} kcal`,
                  testID: 'health-weight-bmi-bmr',
                },
                {
                  label: 'Daily burn',
                  value: model.tdee === null ? '—' : `${model.tdee} kcal`,
                  testID: 'health-weight-bmi-tdee',
                },
                {
                  label: 'Activity',
                  value:
                    model.activityLevel === null ? '—' : ACTIVITY_LABELS[model.activityLevel],
                  testID: 'health-weight-bmi-activity',
                },
              ]}
            />
          )}
          <Note>
            BMI = weight ÷ height². It does not know the difference between muscle and fat, so a
            trained body reads high. BMR uses the Mifflin–St Jeor equation; daily burn multiplies
            it by your activity level.
          </Note>
        </>
      )}
    </WidgetCard>
  );
}

function HistoryWidget({ model }: { model: WeightWidgetModel }) {
  const { history, unit } = model;
  const dated = (point: DatedValue | null) =>
    point === null ? '—' : `${formatWeightValue(point.value)} ${unit}`;
  return (
    <WidgetCard meta={WEIGHT_WIDGETS[7]} testID="health-weight-widget-weightHistory">
      {history.current === null ? (
        <Empty testID="health-weight-history-empty">
          No weigh-ins yet — your first one becomes your starting weight.
        </Empty>
      ) : (
        <>
          <HealthStatRow
            stats={[
              {
                label: 'Starting',
                value: dated(history.starting),
                testID: 'health-weight-history-starting',
              },
              {
                label: 'Current',
                value: dated(history.current),
                testID: 'health-weight-history-current',
              },
              {
                label: 'Lowest',
                value: dated(history.lowest),
                testID: 'health-weight-history-lowest',
              },
              {
                label: 'Highest',
                value: dated(history.highest),
                testID: 'health-weight-history-highest',
              },
            ]}
          />
          <Note>
            Starting {history.starting ? formatAxisDate(history.starting.date) : '—'} · lowest{' '}
            {history.lowest ? formatAxisDate(history.lowest.date) : '—'} · highest{' '}
            {history.highest ? formatAxisDate(history.highest.date) : '—'}.
          </Note>
        </>
      )}
    </WidgetCard>
  );
}

function MonthlyProgressWidget({ model }: { model: WeightWidgetModel }) {
  const colors = useAppColors();
  const months = model.monthly.slice(-6).reverse();
  return (
    <WidgetCard meta={WEIGHT_WIDGETS[8]} testID="health-weight-widget-monthlyProgress">
      {months.length === 0 ? (
        <Empty testID="health-weight-monthly-empty">
          Log weights across a calendar month to see month-by-month averages.
        </Empty>
      ) : (
        <>
          {/* This calendar month against last, from `monthOverMonth`. The list
              below carries the per-month averages; the change BETWEEN the two
              most recent months is the figure the widget's own description
              promises, and it was computed and thrown away until now. Both
              sides are month MEANS, so an early-month reading is not compared
              against a full month's worth. */}
          {model.month.change === null ? (
            <Note>
              Log a weight this month and last month to see the change between them.
            </Note>
          ) : (
            <HealthStatRow
              stats={[
                {
                  label: 'vs last month',
                  value: signed(model.month.change, model.unit),
                  testID: 'health-weight-monthly-change',
                },
                {
                  label: 'Percent',
                  value:
                    model.month.changePercent === null
                      ? '—'
                      : `${model.month.changePercent > 0 ? '+' : ''}${model.month.changePercent}%`,
                  testID: 'health-weight-monthly-percent',
                },
                {
                  label: 'This month',
                  value: withUnit(model.month.current.average, model.unit),
                  testID: 'health-weight-monthly-current',
                },
              ]}
            />
          )}
          <View style={styles.rows}>
            {months.map((month) => (
              <View
                key={month.month}
                style={[styles.listRow, { borderTopColor: colors.borderColor }]}
                testID={`health-weight-monthly-${month.month}`}
              >
                <Typography variant="body" color={colors.textPrimary}>
                  {monthLabel(month.month)}
                </Typography>
                <View style={styles.listRowRight}>
                  <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                    {withUnit(month.average, model.unit)}
                  </Typography>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    {/* The day count is on EVERY row, not just the first: the
                        note below promises it, and a −4 kg month built from two
                        readings has to be readable as such. */}
                    {month.change === null
                      ? `${month.days} d`
                      : `${signed(month.change, model.unit)} · ${month.days} d`}
                  </Typography>
                </View>
              </View>
            ))}
          </View>
          <Note>
            Each month is the mean of the days you logged in it, so a month with two readings is
            shown next to one with thirty — the day count is on the right.
          </Note>
        </>
      )}
    </WidgetCard>
  );
}

function monthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return new Date(year, (m ?? 1) - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function LeanMassWidget({ model }: { model: WeightWidgetModel }) {
  const colors = useAppColors();
  const { composition, unit } = model;
  return (
    <WidgetCard meta={WEIGHT_WIDGETS[9]} testID="health-weight-widget-leanMass">
      {composition === null ? (
        <Empty testID="health-weight-lean-empty">
          Lean mass needs a body-fat percentage. Log one on the Body tab.
        </Empty>
      ) : (
        <>
          <View style={styles.bigRow}>
            <Typography
              variant="title1"
              weight="bold"
              color={colors.textPrimary}
              testID="health-weight-lean-value"
            >
              {formatWeightValue(composition.leanMassKg)}
            </Typography>
            <Typography variant="body" color={colors.textSecondary}>
              {unit} of lean mass
            </Typography>
          </View>
          <Note>
            Everything that is not fat — muscle, bone, organs and water. Holding this while total
            weight falls is what a good cut looks like.
          </Note>
        </>
      )}
    </WidgetCard>
  );
}

function StreakWidget({ model }: { model: WeightWidgetModel }) {
  const { streak } = model;
  return (
    <WidgetCard meta={WEIGHT_WIDGETS[10]} testID="health-weight-widget-streaks">
      {streak.best === 0 ? (
        <Empty testID="health-weight-streak-empty">
          Weigh in on two days in a row to start a streak.
        </Empty>
      ) : (
        <>
          <HealthStatRow
            stats={[
              {
                label: 'Current',
                value: `${streak.current} d`,
                testID: 'health-weight-streak-current',
              },
              { label: 'Best', value: `${streak.best} d`, testID: 'health-weight-streak-best' },
              {
                label: 'Last',
                value: streak.lastLogged ? formatAxisDate(streak.lastLogged) : '—',
                testID: 'health-weight-streak-last',
              },
            ]}
          />
          <Note>
            A streak survives until the end of the following day, so it is not broken before
            you have had a chance to weigh in.
          </Note>
        </>
      )}
    </WidgetCard>
  );
}

function ProjectionWidget({ model }: { model: WeightWidgetModel }) {
  const { projection, unit, target } = model;
  const enough = projection.samples >= MIN_PROJECTION_SAMPLES;
  const inThirty = enough ? projection.project(30) : null;
  const eta = enough && target !== null ? projection.daysToTarget(target) : null;

  return (
    <WidgetCard meta={WEIGHT_WIDGETS[11]} testID="health-weight-widget-predictions">
      {!enough ? (
        <Empty testID="health-weight-projection-empty">
          {`A projection needs at least ${MIN_PROJECTION_SAMPLES} weigh-ins — you have ${projection.samples}. Two readings would fit a perfect line through pure water weight.`}
        </Empty>
      ) : (
        <>
          <HealthStatRow
            stats={[
              {
                label: 'Per week',
                value: signed(Math.round(projection.slopePerDay * 7 * 10) / 10, unit),
                testID: 'health-weight-projection-rate',
              },
              {
                label: 'In 30 days',
                value: withUnit(inThirty, unit),
                testID: 'health-weight-projection-30',
              },
              {
                label: 'Target in',
                value: eta === null ? '—' : `${eta} d`,
                testID: 'health-weight-projection-eta',
              },
            ]}
          />
          <Note>
            A straight line fitted through {projection.samples} readings over {projection.spanDays}{' '}
            days. It assumes nothing changes, which is the one thing you can be sure of.
            {target === null ? ' Set a target to see an arrival date.' : ''}
          </Note>
        </>
      )}
    </WidgetCard>
  );
}

/**
 * Measurements.
 *
 * The donor's widget is a "coming soon" placeholder. The sites it promised —
 * waist, chest, arms and the rest — are already tracked and charted on the Body
 * tab here, so this links there instead of forking a second copy of them onto
 * the Weight tab.
 */
function MeasurementsWidget({ model }: { model: WeightWidgetModel }) {
  const colors = useAppColors();
  return (
    <WidgetCard meta={WEIGHT_WIDGETS[12]} testID="health-weight-widget-measurements">
      <Typography variant="body" color={colors.textPrimary}>
        Waist, chest, arms and the other sites live on the Body tab, with their own trend charts
        and a two-date compare.
      </Typography>
      {model.onOpenBody ? (
        <Typography
          variant="body"
          weight="semibold"
          color={colors.primary}
          onPress={model.onOpenBody}
          accessibilityRole="button"
          testID="health-weight-measurements-open"
        >
          Open the Body tab
        </Typography>
      ) : null}
    </WidgetCard>
  );
}

function CorrelationWidget({ model }: { model: WeightWidgetModel }) {
  const { correlation, unit } = model;
  const enough = correlation.samples >= MIN_CORRELATION_SAMPLES && correlation.r !== null;
  return (
    <WidgetCard meta={WEIGHT_WIDGETS[13]} testID="health-weight-widget-calorieCorrelation">
      {!enough ? (
        <Empty testID="health-weight-correlation-empty">
          {`This needs at least ${MIN_CORRELATION_SAMPLES} weeks with both meals and weigh-ins logged — you have ${correlation.samples}.`}
        </Empty>
      ) : (
        <>
          <HealthStatRow
            stats={[
              {
                label: 'Together',
                value: strengthLabel(correlation.r as number),
                testID: 'health-weight-correlation-strength',
              },
              {
                label: 'Avg intake',
                value: `${correlation.averageCalories} kcal`,
                testID: 'health-weight-correlation-calories',
              },
              {
                label: 'Avg weekly',
                value: signed(correlation.averageChange, unit),
                testID: 'health-weight-correlation-change',
              },
            ]}
          />
          <Note>
            Weekly, not daily — day-to-day weight is mostly water. Over {correlation.samples} weeks
            the coefficient is {correlation.r}. Things moving together is not one causing the
            other.
          </Note>
        </>
      )}
    </WidgetCard>
  );
}

/** Plain words for a coefficient — a bare `r = 0.42` means nothing to a member. */
export function strengthLabel(r: number): string {
  const magnitude = Math.abs(r);
  const direction = r >= 0 ? 'same way' : 'opposite ways';
  if (magnitude < 0.2) return 'Barely';
  if (magnitude < 0.4) return `Weakly, ${direction}`;
  if (magnitude < 0.7) return `Somewhat, ${direction}`;
  return `Strongly, ${direction}`;
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

const RENDERERS: Record<
  WeightWidgetKey,
  (props: { model: WeightWidgetModel }) => React.JSX.Element
> = {
  mainChart: MainChartWidget,
  dataStack: DataStackWidget,
  goalProgress: GoalProgressWidget,
  weeklyChange: WeeklyChangeWidget,
  bodyComposition: BodyCompositionWidget,
  aiInsights: InsightsWidget,
  bmiTracker: BmiWidget,
  weightHistory: HistoryWidget,
  monthlyProgress: MonthlyProgressWidget,
  leanMass: LeanMassWidget,
  streaks: StreakWidget,
  predictions: ProjectionWidget,
  measurements: MeasurementsWidget,
  calorieCorrelation: CorrelationWidget,
};

/** One widget by key. Unknown keys render nothing rather than throwing. */
export function HealthWeightWidget({
  widget,
  model,
}: {
  widget: WeightWidgetKey;
  model: WeightWidgetModel;
}) {
  const Renderer = RENDERERS[widget];
  if (!Renderer) return null;
  return <Renderer model={model} />;
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  rows: {
    gap: Spacing.xxs,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    paddingVertical: Spacing.xxs,
  },
  insightText: {
    flex: 1,
  },
  ringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
  },
  ringStats: {
    flex: 1,
  },
  bigRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.sm,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  listRowRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  chip: {
    borderRadius: CornerRadius.sm,
  },
});
