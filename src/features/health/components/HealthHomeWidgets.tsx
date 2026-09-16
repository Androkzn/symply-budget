import React from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, ProgressRing, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import type { ChallengeWeeklyOverviewEntry } from '../healthChallengesStorage';
import { formatDayKey } from '../healthNutritionStorage';
import { formatSleepDuration, sleepHours, type SleepNight } from '../healthSleepStorage';
import type { HealthWeeklyTrendResponse } from '../healthWeeklyTrendStorage';

import {
  HealthDashboardCards,
  HealthDayRings,
  type HealthDayRing,
  type HealthGlanceCard,
} from './HealthDashboardCards';
import { HealthFoodChallengesWidget } from './HealthFoodChallengesWidget';
import { HealthWeeklyTrendsWidget } from './HealthWeeklyTrendsWidget';

/**
 * Symply Health — Home's REORDERABLE cards (the donor's customisable dashboard).
 *
 * `DashboardLayoutManager` declares nine widget cases, keeps them in a stored
 * order, and `DashboardCustomizationView` lets a member move, hide and reset
 * them. Home here was a fixed stack: the first screen everybody opens was the
 * only one they could not shape.
 *
 * This mirrors `HealthWeightWidgets.tsx` on purpose — same registry shape, same
 * `HealthXWidget({ widget, model })` dispatch, same pure-function rule — because
 * the Weight tab already ships fourteen reorderable widgets through
 * `healthWeightStorage`, and a second, differently-shaped customisation
 * mechanism in the same feature is how two screens drift apart.
 *
 * WHAT THESE ARE. The donor's nine cases are its own surfaces
 * (`calorieBalance`, `quickStats`, `weeklyTrendChart`, `foodChallenges`,
 * `todayWorkouts`, `todayInsights`, `recentActivity`, `badSnacks`, `deskHero` —
 * two of which render nothing there). These are the cards Home actually has,
 * plus `sleep`, which is new: sleep existed in this app as a habit preset, a
 * HealthKit read type and a Vitality scale, and appeared on Home nowhere.
 *
 * EVERY WIDGET IS A PURE FUNCTION of one model the screen computes once, so a
 * figure cannot differ between two cards that quote it, and none of them loads
 * anything. The interactive cards (water, note, sleep) take their state
 * and their callbacks from the model rather than owning any — which is what lets
 * the screen keep one hydrate, one keyboard story and one set of testIDs.
 *
 * NO `InputAccessoryView`, ANYWHERE IN HERE. Home used to hang its "Done"
 * buttons off always-mounted accessory views. Under the New Architecture that
 * component renders nothing AND its mounted native container swallows the pan
 * gesture for the whole screen — Home could not be scrolled at all. The "Done"
 * affordances below are ordinary rows inside their card.
 */

/* ------------------------------------------------------------------ */
/* The registry                                                        */
/* ------------------------------------------------------------------ */

export const HOME_WIDGET_KEYS = [
  'today',
  'weeklyTrends',
  'foodChallenges',
  'glance',
  'sleep',
  'water',
  'note',
] as const;

export type HomeWidgetKey = (typeof HOME_WIDGET_KEYS)[number];

export interface HomeWidgetMeta {
  key: HomeWidgetKey;
  /** Shown in the customise list. */
  title: string;
  icon: string;
  description: string;
}

export const HOME_WIDGETS: readonly HomeWidgetMeta[] = [
  {
    key: 'today',
    title: 'Today',
    icon: 'today-summary',
    description: 'Calories, steps and move as rings against the day’s goals.',
  },
  {
    key: 'weeklyTrends',
    title: 'Weekly trends',
    icon: 'trends-tab',
    description: 'Calories and weight, this week compared with last.',
  },
  {
    key: 'foodChallenges',
    title: 'Food challenges',
    icon: 'goals',
    description: 'Weekly progress toward the food goals you set, like "500g vegetables".',
  },
  {
    key: 'glance',
    title: 'At a glance',
    icon: 'insights',
    description: 'Habits and body as tappable tiles.',
  },
  {
    key: 'sleep',
    title: 'Sleep',
    icon: 'sleep',
    description: 'Last night against your sleep goal, and a row to log it.',
  },
  {
    key: 'water',
    title: 'Water',
    icon: 'hydration',
    description: 'Today’s cups against your target, one tap at a time.',
  },
  {
    key: 'note',
    title: 'Today’s note',
    icon: 'log-entry',
    description: 'A private line about how the day went.',
  },
] as const;

/**
 * Everything on, in the order Home already shipped.
 *
 * The Weight tab defaults to five of its fourteen because fourteen cards is a
 * wall. Home is different: this IS the layout members already have, and hiding
 * half of it on first run would read as data loss rather than as a default.
 *
 * KEEP IN SYNC with `DEFAULT_HOME_WIDGET_ORDER` in `healthHomeStorage`, which
 * is the same list for a member who has never customised. The two are
 * deliberately duplicated rather than shared: that module is reached from the
 * sign-out cache purge and must not import a component.
 */
export const DEFAULT_HOME_WIDGETS: readonly HomeWidgetKey[] = [
  'today',
  'weeklyTrends',
  'foodChallenges',
  'glance',
  'sleep',
  'water',
  'note',
];

/* ------------------------------------------------------------------ */
/* The model every widget reads                                        */
/* ------------------------------------------------------------------ */

export interface HomeWidgetModel {
  /**
   * Open a ring, a tile or a section.
   *
   * Takes either a route (`/health-weight`) or a per-metric drill-down token
   * (`metric:water`); the screen owns the distinction. Tiles that used to jump
   * straight to a whole tab now open the metric's own detail sheet, which is
   * where the tab link lives — the donor opens `StepsDetailView` from its steps
   * tile rather than swapping tabs under you.
   */
  onOpenTarget: (target: string) => void;

  /* today */
  rings: HealthDayRing[];
  nothingLoggedToday: boolean;

  /* weekly trends */
  weeklyTrend: HealthWeeklyTrendResponse | null;

  /* food challenges */
  challengesOverview: ChallengeWeeklyOverviewEntry[];
  challengesExpanded: boolean;
  onToggleChallengesExpanded: () => void;
  onManageChallenges: () => void;
  /** Local `YYYY-MM-DD` — shared with the widget's future-day suppression and status badge. */
  todayKey: string;

  /* glance */
  glanceCards: HealthGlanceCard[];

  /* sleep */
  sleepGoalHours: number;
  lastNight: SleepNight | null;
  sleepAverageMinutes: number | null;
  sleepNightsLogged: number;
  sleepDraft: string;
  canLogSleep: boolean;
  sleepFieldFocused: boolean;
  onSleepDraftChange: (text: string) => void;
  onLogSleep: () => void;
  onSleepFocus: () => void;
  onSleepBlur: () => void;

  /* water */
  waterCups: number;
  waterTarget: number;
  onAdjustWater: (delta: number) => void;

  /* note */
  noteDraft: string;
  noteFieldFocused: boolean;
  onNoteChange: (text: string) => void;
  onNoteFocus: () => void;
  onNoteBlur: () => void;
  onNoteEndEditing: (text: string) => void;
  onNoteSubmit: () => void;
  onDismissKeyboard: () => void;
}

/* ------------------------------------------------------------------ */
/* Shared shell                                                        */
/* ------------------------------------------------------------------ */

/**
 * One card.
 *
 * The label keeps the plain uppercase heading Home has always drawn (and the
 * testIDs the suites address) rather than gaining the Weight tab's icon+title
 * row — Home's headings are load-bearing in E2E and in three unit tests.
 */
function WidgetCard({
  label,
  labelTestID,
  children,
  testID,
}: {
  label: string;
  labelTestID?: string;
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
      <Typography
        variant="footnote"
        color={colors.textSecondary}
        style={styles.sectionLabel}
        testID={labelTestID}
      >
        {label}
      </Typography>
      {children}
    </Card>
  );
}

/**
 * The inline "Done" row.
 *
 * NOT an `InputAccessoryView` — see the module header. iOS only, because it
 * exists to dismiss a keyboard that has no return key of its own (the decimal
 * pad), and Android's keyboards all carry one.
 */
function DoneRow({
  onPress,
  testID,
  visible,
}: {
  onPress: () => void;
  testID: string;
  visible: boolean;
}) {
  const colors = useAppColors();
  if (Platform.OS !== 'ios' || !visible) return null;
  return (
    <View style={styles.accessoryBar}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Done"
        testID={testID}
        style={styles.accessoryDone}
      >
        <Typography variant="body" weight="semibold" color={colors.primary}>
          Done
        </Typography>
      </Pressable>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* The eight                                                           */
/* ------------------------------------------------------------------ */

function TodayWidget({ model }: { model: HomeWidgetModel }) {
  const colors = useAppColors();
  return (
    <WidgetCard label="TODAY" labelTestID="health-today-label" testID="health-home-widget-today">
      <HealthDayRings rings={model.rings} onOpen={model.onOpenTarget} />
      {model.nothingLoggedToday ? (
        // Honest: zeroed rings are the truth, but say why in words.
        <Typography variant="caption1" color={colors.textSecondary} testID="health-today-empty">
          Nothing logged today yet — these fill in as you add meals, steps and workouts.
        </Typography>
      ) : null}
    </WidgetCard>
  );
}

function WeeklyTrendsHomeWidget({ model }: { model: HomeWidgetModel }) {
  return (
    <WidgetCard
      label="WEEKLY TRENDS"
      labelTestID="health-weekly-trends-label"
      testID="health-home-widget-weeklyTrends"
    >
      <HealthWeeklyTrendsWidget trend={model.weeklyTrend} testID="health-home-weekly-trends" />
    </WidgetCard>
  );
}

function FoodChallengesHomeWidget({ model }: { model: HomeWidgetModel }) {
  return (
    <WidgetCard
      label="FOOD CHALLENGES"
      labelTestID="health-food-challenges-label"
      testID="health-home-widget-foodChallenges"
    >
      <HealthFoodChallengesWidget
        overview={model.challengesOverview}
        todayKey={model.todayKey}
        expanded={model.challengesExpanded}
        onToggleExpanded={model.onToggleChallengesExpanded}
        onManage={model.onManageChallenges}
        testID="health-home-food-challenges"
      />
    </WidgetCard>
  );
}

function GlanceWidget({ model }: { model: HomeWidgetModel }) {
  return (
    <WidgetCard
      label="AT A GLANCE"
      labelTestID="health-glance-label"
      testID="health-home-widget-glance"
    >
      <HealthDashboardCards cards={model.glanceCards} onOpen={model.onOpenTarget} />
    </WidgetCard>
  );
}

/**
 * Sleep.
 *
 * The donor's dashboard opens a whole `SleepDetailView` from a sleep tile, fed
 * by HealthKit. HealthKit is not connected here — "Apple Health sync" is still
 * on Home's COMING SOON list — so this logs the night by hand and says so. The
 * row it writes is the SAME `/health/entries` sleep record the importer will
 * write later (minutes, not hours), and the importer already refuses to
 * overwrite a manual day.
 */
function SleepWidget({ model }: { model: HomeWidgetModel }) {
  const colors = useAppColors();
  const goalMinutes = Math.max(1, Math.round(model.sleepGoalHours * 60));
  const last = model.lastNight;
  const progress = last ? last.minutes / goalMinutes : 0;

  return (
    <WidgetCard label="SLEEP" labelTestID="health-sleep-label" testID="health-home-widget-sleep">
      <Pressable
        onPress={() => model.onOpenTarget('metric:sleep')}
        accessibilityRole="button"
        accessibilityLabel={
          last
            ? `Sleep: ${formatSleepDuration(last.minutes)} of ${
                model.sleepGoalHours
              } hours, ${formatDayKey(last.date)}`
            : 'Sleep: not logged yet'
        }
        testID="health-sleep-summary"
        style={styles.sleepRow}
      >
        <ProgressRing
          progress={progress}
          size={72}
          stroke={9}
          color={colors.chartCool}
          showPercent={false}
        >
          <Typography variant="footnote" weight="bold" color={colors.textPrimary}>
            {last ? `${sleepHours(last.minutes)}` : '—'}
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            h
          </Typography>
        </ProgressRing>
        <View style={styles.sleepText}>
          {last ? (
            <>
              <Typography
                variant="headline"
                weight="semibold"
                color={colors.textPrimary}
                testID="health-sleep-last-value"
              >
                {formatSleepDuration(last.minutes)}
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                {formatDayKey(last.date)} · of {model.sleepGoalHours} h
              </Typography>
            </>
          ) : (
            <Typography
              variant="body"
              color={colors.textSecondary}
              testID="health-sleep-empty"
            >
              No nights logged yet. Add last night below — Apple Health sync is not connected, so
              sleep is yours to enter.
            </Typography>
          )}
          {model.sleepAverageMinutes !== null ? (
            <Typography variant="caption1" color={colors.textSecondary}>
              {formatSleepDuration(model.sleepAverageMinutes)} average across{' '}
              {model.sleepNightsLogged} night{model.sleepNightsLogged === 1 ? '' : 's'} this week
            </Typography>
          ) : null}
        </View>
      </Pressable>

      <View style={styles.logRow}>
        <TextInput
          value={model.sleepDraft}
          onChangeText={model.onSleepDraftChange}
          placeholder="Hours slept"
          placeholderTextColor={colors.textSecondary}
          keyboardType="decimal-pad"
          returnKeyType="done"
          onSubmitEditing={model.onLogSleep}
          onFocus={model.onSleepFocus}
          onBlur={model.onSleepBlur}
          accessibilityLabel="Hours slept"
          testID="health-sleep-input"
          style={[
            styles.logInput,
            {
              color: colors.textPrimary,
              borderColor: colors.borderColor,
              backgroundColor: colors.backgroundMain,
            },
          ]}
        />
        <Pressable
          onPress={model.onLogSleep}
          disabled={!model.canLogSleep}
          accessibilityRole="button"
          accessibilityLabel="Log sleep"
          testID="health-log-sleep-button"
          style={[
            styles.logButton,
            { backgroundColor: model.canLogSleep ? colors.primary : colors.borderColor },
          ]}
        >
          <Icon name="add" size={22} color={colors.white} />
        </Pressable>
      </View>

      <DoneRow
        visible={model.sleepFieldFocused}
        onPress={model.onLogSleep}
        testID="health-sleep-keyboard-done"
      />
    </WidgetCard>
  );
}

function WaterWidget({ model }: { model: HomeWidgetModel }) {
  const colors = useAppColors();
  const target = model.waterTarget > 0 ? model.waterTarget : 1;

  return (
    <WidgetCard label="WATER" testID="health-home-widget-water">
      <View style={styles.waterRow}>
        <Pressable
          onPress={() => model.onAdjustWater(-1)}
          accessibilityRole="button"
          accessibilityLabel="Remove a cup"
          testID="health-water-minus"
          style={[styles.waterBtn, { borderColor: colors.borderColor }]}
        >
          <Icon name="remove" size={22} color={colors.textPrimary} />
        </Pressable>
        <Pressable
          onPress={() => model.onOpenTarget('metric:water')}
          accessibilityRole="button"
          accessibilityLabel={`Water: ${model.waterCups} of ${model.waterTarget} cups`}
          testID="health-water-open-detail"
          style={styles.waterCenter}
        >
          <View style={styles.latestValueRow}>
            <Typography
              variant="title1"
              weight="bold"
              color={colors.textPrimary}
              testID="health-water-cups-count"
              accessibilityLabel={`${model.waterCups} cups`}
            >
              {model.waterCups}
            </Typography>
            {/* testID, not just accessibilityLabel: the parent Pressable already
                claims a composite "Water: X of Y cups" label, which swallows
                plain child Text nodes from the accessibility tree UNLESS the
                child carries its own testID (→ accessibilityIdentifier on
                iOS) — an XCUITest handle survives ancestor aggregation, a
                bare label alone does not (confirmed live, 2026-07-31: the
                label-only version never appeared in the accessibility tree
                at all). Mirrors the sibling `health-water-cups-count` node
                just above, which already does this correctly. */}
            <Typography
              variant="title3"
              color={colors.textSecondary}
              style={styles.unitSuffix}
              testID="health-water-target-suffix"
              accessibilityLabel={`/ ${model.waterTarget} cups`}
            >
              / {model.waterTarget} cups
            </Typography>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: colors.primary,
                  width: `${Math.min(100, (model.waterCups / target) * 100)}%`,
                },
              ]}
            />
          </View>
        </Pressable>
        <Pressable
          onPress={() => model.onAdjustWater(1)}
          accessibilityRole="button"
          accessibilityLabel="Add a cup"
          testID="health-water-plus"
          style={[styles.waterBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
        >
          <Icon name="add" size={22} color={colors.white} />
        </Pressable>
      </View>
    </WidgetCard>
  );
}

function NoteWidget({ model }: { model: HomeWidgetModel }) {
  const colors = useAppColors();
  return (
    <WidgetCard label={"TODAY'S NOTE"} testID="health-home-widget-note">
      {/*
       * Rendered BEFORE the field, not after (2026-08-02, HEALTH-HOME-070 —
       * `home-keyboard-accessories.yaml` re-failed a THIRD time in a row after
       * a prior pass widened the wait 10000ms → 20000ms; that bump only hid
       * the symptom for one run because it's not a timing problem).
       *
       * Every failure screenshot across all three runs (2026-08-01 22:55,
       * 2026-08-02 02:00, 2026-08-02 12:38 — different days, identical
       * framing) shows the SAME crop: the note card fills the screen down to
       * exactly where the software keyboard begins, with no Done row ever in
       * frame. `assertVisible` on `health-note-keyboard-done` passed fast
       * right after focus (it only checks the RN accessibility tree has an
       * in-bounds frame, not whether a system window sits on top of it) —
       * but the follow-up tap never dismissed the keyboard, in any of the
       * three runs, even after a full 20s wait. That combination means the
       * row was being placed behind the on-screen keyboard: iOS's
       * scroll-to-reveal-responder only guarantees the FOCUSED field itself
       * clears the keyboard, not a sibling view mounted after it, and this
       * field's own box (no `multiline`, so a fixed single-line height) was
       * tall enough that the row immediately below it landed in the
       * keyboard's territory. Every tap Maestro sent at that testID's
       * coordinates was therefore delivered to the keyboard's own window,
       * not this Pressable — a silent no-op, which is exactly why the
       * keyboard was still up in all three failure screenshots and the
       * `notVisible` wait ran out its full budget instead of resolving late.
       *
       * Moving the row above the field puts it in the region the OS is
       * already forced to keep clear of the keyboard to show the field
       * itself (confirmed present in every failure screenshot: the WATER
       * card and the "TODAY'S NOTE" label above the field stayed visible
       * every time) — so it can no longer end up in the keyboard's shadow.
       * Do not move it back below the field without re-verifying the row is
       * actually tappable with a keyboard up (not just present in the tree).
       */}
      <DoneRow
        visible={model.noteFieldFocused}
        onPress={model.onDismissKeyboard}
        testID="health-note-keyboard-done"
      />
      <TextInput
        value={model.noteDraft}
        onChangeText={model.onNoteChange}
        onChange={(e) => {
          const text = e.nativeEvent.text;
          if (text !== model.noteDraft) model.onNoteChange(text);
        }}
        onFocus={model.onNoteFocus}
        onBlur={model.onNoteBlur}
        onEndEditing={(e) => model.onNoteEndEditing(e.nativeEvent.text)}
        onSubmitEditing={model.onNoteSubmit}
        placeholder="How are you feeling today?"
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel="Today's note"
        accessibilityValue={{ text: model.noteDraft }}
        testID="health-note-input"
        style={[
          styles.noteInput,
          {
            color: colors.textPrimary,
            borderColor: colors.borderColor,
            backgroundColor: colors.backgroundMain,
          },
        ]}
      />
      {model.noteDraft.trim().length > 0 ? (
        <View
          testID="health-note-saved-text"
          accessibilityLabel={model.noteDraft}
          accessible
          importantForAccessibility="yes"
          collapsable={false}
          style={styles.noteSavedProbe}
        />
      ) : null}
    </WidgetCard>
  );
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

const RENDERERS: Record<
  HomeWidgetKey,
  (props: { model: HomeWidgetModel }) => React.JSX.Element
> = {
  today: TodayWidget,
  weeklyTrends: WeeklyTrendsHomeWidget,
  foodChallenges: FoodChallengesHomeWidget,
  glance: GlanceWidget,
  sleep: SleepWidget,
  water: WaterWidget,
  note: NoteWidget,
};

/** True for a key this registry can render — used to drop a stale stored key. */
export function isHomeWidgetKey(key: string): key is HomeWidgetKey {
  return (HOME_WIDGET_KEYS as readonly string[]).includes(key);
}

/** One widget by key. Unknown keys render nothing rather than throwing. */
export function HealthHomeWidget({
  widget,
  model,
}: {
  widget: string;
  model: HomeWidgetModel;
}) {
  if (!isHomeWidgetKey(widget)) return null;
  const Renderer = RENDERERS[widget];
  if (!Renderer) return null;
  return <Renderer model={model} />;
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  latestRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  latestValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.xs,
  },
  unitSuffix: {
    marginBottom: 2,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  logInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  logButton: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sleepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
  },
  sleepText: {
    flex: 1,
    gap: 2,
  },
  waterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
  },
  waterCenter: {
    flex: 1,
    gap: Spacing.sm,
  },
  waterBtn: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
  },
  noteInput: {
    minHeight: 88,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  /**
   * A zero-content probe carrying the saved note as its accessibility label.
   *
   * The note lives in a `TextInput`, whose VALUE the E2E driver cannot read back
   * on iOS; this gives the suite a labelled node that says what was saved
   * without drawing a second copy of the text.
   */
  noteSavedProbe: {
    height: 24,
    width: '100%',
  },
  // Was a keyboard accessory bar (hairline top border, its own horizontal
  // padding). It is now a row INSIDE the card, so the border and the extra
  // padding would draw a stray rule across the card.
  accessoryBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  accessoryDone: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
});
