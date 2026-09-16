import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, ProgressBar, Toggle, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors, useIsDarkMode } from '@theme';

import { HealthGoalMacroBar, HealthMacroWeekEditor, HealthSectionScreen } from '../components';
import { saveActivityGoals } from '../healthActivityStorage';
import {
  BASELINE_DATE_MESSAGE,
  CALORIE_WEEK_DAYS,
  checkBound,
  EMPTY_GOALS_SNAPSHOT,
  GOAL_BOUNDS,
  GOAL_SAVED_MESSAGE,
  KCAL_PER_GRAM,
  loadHealthGoals,
  MACRO_DIFFERENCE_TOLERANCE,
  MACRO_LABELS,
  MACRO_WEEK_DAYS,
  macroSplit,
  parseDayKey,
  parseWholeNumber,
  rebalanceMacros,
  sanitizeWholeNumber,
  saveCalorieWeek,
  saveMacroWeek,
  seedCalorieWeek,
  setEveryCalorieDay,
  suggestGoals,
  suggestionInputsFor,
  missingSuggestionInputs,
  weekdayIndexOf,
  weeklyAverageCalories,
  type CalorieWeek,
  type HealthGoalsSnapshot,
  type MacroKey,
  type MacroWeek,
} from '../healthGoalsStorage';
import {
  CUP_ML,
  formatWeightValue,
  parseWeightInput,
  sanitizeWeightInput,
  setWaterTarget,
} from '../healthLocalStorage';
import { saveNutritionGoals, type NutritionGoals } from '../healthNutritionStorage';
import { weightGoalProgress } from '../healthWeightAnalytics';
import {
  saveWeightGoal,
  weightInUnit,
  type HealthWeightGoalType,
} from '../healthWeightStorage';
import { useHealthKitSyncHydration } from '../useHealthKitSyncHydration';

/**
 * Goals — the donor's `Settings/GoalsSettingsView.swift` (2,233 lines).
 *
 * This is the screen the app was missing. Before it, `NutritionGoals` carried
 * `protein` / `carbs` / `fat` and **nothing wrote them**; the calorie goal was
 * four preset values in an `Alert`; the per-weekday calorie columns had shipped
 * in migration `0119` and been accepted by `PUT /goals` ever since with no
 * client to send them; and the weight GOAL TYPE (lose / maintain / gain) could
 * only ever be cleared, never set.
 *
 * ── HOW IT WRITES ────────────────────────────────────────────────────────────
 *
 * Every target on this screen lives on ONE server row (`health_goals`, keyed by
 * user + effective date), but it is cached in four different places because
 * four other screens render from it. So each section here saves through the
 * module that OWNS its field — `saveNutritionGoals`, `saveActivityGoals`,
 * `setWaterTarget`, `saveWeightGoal` — and only the per-weekday calorie plan is
 * written by this feature's own `saveCalorieWeek`. The reasoning is in the
 * header of `healthGoalsStorage.ts`; the short version is that a Goals screen
 * writing to its own cache would leave the Nutrition ring, the Activity target
 * and Home's water goal showing yesterday's number while offline.
 *
 * That is also why saving is PER SECTION rather than one button at the bottom:
 * the writes are genuinely separate round-trips, and a single "Save" would have
 * to report four outcomes as one.
 *
 * ── DELIBERATE DIFFERENCES FROM THE DONOR ────────────────────────────────────
 *
 *  - **Free numeric entry, not presets.** The donor's calorie control is a
 *    stepper plus four presets; the ported one was four presets in an `Alert`
 *    with no way to type 2,150. Here every target is a text field, and the
 *    presets remain as one-tap shortcuts beside it.
 *  - **Everything is inline; there are no sheets.** The donor stacks eleven
 *    editor sheets (`CalorieGoalEditorSheet`, `MacroGoalEditorWithRebalance`,
 *    `StepsGoalEditor`, …) and carries an in-code note about the resulting
 *    "Attempt to present while a presentation is in progress" bug. The diary's
 *    edit verbs and the injury form shipped inline for the same reason.
 *  - **Bounds are enforced before the write, in words.** `writeThrough` folds a
 *    failed write into the offline path and KEEPS the optimistic value, so a
 *    400 from the route would leave a target on screen that never persists. The
 *    route's own limits are restated in `GOAL_BOUNDS` and refused here first.
 *  - **The suggestion refuses to guess.** The donor's `GoalCalculator` defaults
 *    a missing weight to 70 kg, a missing height to 170 cm, a missing age to 30
 *    and a missing sex to "other", then presents the result as a personalised
 *    calculation. This one names what is missing and where to enter it.
 *  - **Heart-rate zones, active-calorie and sleep targets are not here.** The
 *    donor edits all three. Nothing in this app reads them — there is no
 *    workout-detail screen, no burned-calorie series and no sleep surface — and
 *    a target that nothing scores against is a control that does nothing.
 *  - **Biometrics are NOT duplicated.** Height, sex, birth year and activity
 *    level are edited on the Weight tab (migration `0125`) and only READ here,
 *    by the suggestion engine, which says where to go when one is missing.
 */

type SectionKey = 'nutrition' | 'activity' | 'water' | 'weight' | 'suggested';

const GOAL_TYPES: { key: HealthWeightGoalType; label: string; note: string }[] = [
  {
    key: 'lose',
    label: 'Lose',
    note: 'Suggested calories come out 20% below your daily burn.',
  },
  {
    key: 'maintain',
    label: 'Maintain',
    note: 'Suggested calories match your daily burn.',
  },
  {
    key: 'gain',
    label: 'Gain',
    note: 'Suggested calories come out 15% above your daily burn, for lean gain.',
  },
];

const CALORIE_PRESETS = [1500, 2000, 2500, 3000];
const STEP_PRESETS = [6000, 8000, 10000, 12000];
const MINUTE_PRESETS = [20, 30, 45, 60];
const WATER_PRESETS = [6, 8, 10, 12];

export function HealthGoalsScreen() {
  const colors = useAppColors();

  const [snapshot, setSnapshot] = useState<HealthGoalsSnapshot>(EMPTY_GOALS_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<SectionKey | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Drafts. Kept as strings so a half-typed field is never coerced to 0 and
  // written back over the member's target between keystrokes.
  const [calories, setCalories] = useState('');
  const [macros, setMacros] = useState<Record<MacroKey, string>>({
    protein: '',
    carbs: '',
    fat: '',
  });
  const [week, setWeek] = useState<CalorieWeek>(EMPTY_GOALS_SNAPSHOT.calorieWeek);
  const [macroWeek, setMacroWeek] = useState<MacroWeek>(EMPTY_GOALS_SNAPSHOT.macroWeek);
  const [steps, setSteps] = useState('');
  const [minutes, setMinutes] = useState('');
  const [cups, setCups] = useState('');
  const [targetWeight, setTargetWeight] = useState('');
  const [startingWeight, setStartingWeight] = useState('');
  const [baselineDate, setBaselineDate] = useState('');
  const [goalType, setGoalType] = useState<HealthWeightGoalType | null>(null);

  const applySnapshot = useCallback((next: HealthGoalsSnapshot) => {
    setSnapshot(next);
    setCalories(String(next.nutrition.calories));
    setMacros({
      protein: String(next.nutrition.protein),
      carbs: String(next.nutrition.carbs),
      fat: String(next.nutrition.fat),
    });
    setWeek(next.calorieWeek);
    setMacroWeek(next.macroWeek);
    setSteps(String(next.activity.steps));
    setMinutes(String(next.activity.minutes));
    setCups(String(next.waterCups));
    setTargetWeight(
      next.weight.targetKg === null
        ? ''
        : formatWeightValue(weightInUnit(next.weight.targetKg, next.unit))
    );
    setStartingWeight(
      next.weight.startingKg === null
        ? ''
        : formatWeightValue(weightInUnit(next.weight.startingKg, next.unit))
    );
    setBaselineDate(next.weight.startingDate ?? '');
    setGoalType(next.weight.goalType);
  }, []);

  const hydrate = useCallback(async () => {
    applySnapshot(await loadHealthGoals());
    setLoading(false);
  }, [applySnapshot]);

  // Hydrates on mount AND every subsequent focus (leave-and-return) — a plain
  // mount-only `useEffect` would be redundant with this, since `useFocusEffect`
  // already fires immediately when the screen is focused on first render.
  useFocusEffect(
    useCallback(() => {
      void hydrate();
    }, [hydrate]),
  );
  // Also re-hydrate the instant a HealthKit sync lands while already on this
  // tab — the background observer/catch-up paths don't wait for a nav event.
  useHealthKitSyncHydration(hydrate);

  /* ---------------- derived ---------------- */

  const draftNutrition: NutritionGoals = useMemo(
    () => ({
      calories: parseWholeNumber(calories) ?? snapshot.nutrition.calories,
      protein: parseWholeNumber(macros.protein) ?? 0,
      carbs: parseWholeNumber(macros.carbs) ?? 0,
      fat: parseWholeNumber(macros.fat) ?? 0,
    }),
    [calories, macros, snapshot.nutrition.calories]
  );

  const split = useMemo(() => macroSplit(draftNutrition), [draftNutrition]);

  const weeklyAverage = useMemo(
    () => weeklyAverageCalories(week, draftNutrition.calories),
    [week, draftNutrition.calories]
  );

  // What the per-weekday macro editor measures each day's split against — the
  // per-weekday CALORIE plan above when it's on, the flat target otherwise.
  const caloriesByDay = useMemo(
    () => week.days.map((value) => value ?? draftNutrition.calories),
    [week, draftNutrition.calories]
  );

  const todayIndex = useMemo(
    () => (snapshot.today.length === 10 ? weekdayIndexOf(snapshot.today) : -1),
    [snapshot.today]
  );

  const suggestionInputs = useMemo(() => suggestionInputsFor(snapshot), [snapshot]);
  const suggestion = useMemo(() => suggestGoals(suggestionInputs), [suggestionInputs]);
  const missing = useMemo(
    () => missingSuggestionInputs(suggestionInputs),
    [suggestionInputs]
  );

  const progress = useMemo(
    () =>
      weightGoalProgress({
        current: snapshot.currentWeightKg,
        target: snapshot.weight.targetKg,
        baseline: snapshot.weight.startingKg,
      }),
    [snapshot.currentWeightKg, snapshot.weight.targetKg, snapshot.weight.startingKg]
  );

  const unit = snapshot.unit;

  /* ---------------- saves ---------------- */

  const runSave = async (section: SectionKey, work: () => Promise<string | null>) => {
    setSaving(section);
    setMessage(null);
    const failure = await work();
    setSaving(null);
    setMessage(failure ?? GOAL_SAVED_MESSAGE);
  };

  const saveNutritionSection = () =>
    runSave('nutrition', async () => {
      const kcal = parseWholeNumber(calories);
      const calorieError = checkBound(kcal, GOAL_BOUNDS.calories);
      if (calorieError !== null) return calorieError;

      for (const key of Object.keys(MACRO_LABELS) as MacroKey[]) {
        const grams = parseWholeNumber(macros[key]);
        const error = checkBound(grams, GOAL_BOUNDS.macroGrams);
        if (error !== null) return `${MACRO_LABELS[key]}: ${error}`;
      }

      const perDayError = week.usePerDay ? checkCalorieWeek(week) : null;
      if (perDayError !== null) return perDayError;

      const perDayMacroError = macroWeek.usePerDay ? checkMacroWeek(macroWeek) : null;
      if (perDayMacroError !== null) return perDayMacroError;

      const nutrition = await saveNutritionGoals(draftNutrition);
      const savedWeek = await saveCalorieWeek(week);
      const savedMacroWeek = await saveMacroWeek(macroWeek);
      setSnapshot((current) => ({
        ...current,
        nutrition,
        calorieWeek: savedWeek,
        macroWeek: savedMacroWeek,
      }));
      return null;
    });

  const saveActivitySection = () =>
    runSave('activity', async () => {
      const stepTarget = parseWholeNumber(steps);
      const stepError = checkBound(stepTarget, GOAL_BOUNDS.steps);
      if (stepError !== null) return stepError;

      const minuteTarget = parseWholeNumber(minutes);
      const minuteError = checkBound(minuteTarget, GOAL_BOUNDS.minutes);
      if (minuteError !== null) return minuteError;

      const activity = await saveActivityGoals({
        steps: stepTarget as number,
        minutes: minuteTarget as number,
      });
      setSnapshot((current) => ({ ...current, activity }));
      return null;
    });

  const saveWaterSection = () =>
    runSave('water', async () => {
      const target = parseWholeNumber(cups);
      const error = checkBound(target, GOAL_BOUNDS.waterCups);
      if (error !== null) return error;
      const day = await setWaterTarget(target as number);
      setSnapshot((current) => ({ ...current, waterCups: day.target }));
      return null;
    });

  const saveWeightSection = () =>
    runSave('weight', async () => {
      const parsedDate = parseDayKey(baselineDate);
      if (!parsedDate.valid) return BASELINE_DATE_MESSAGE;

      const target = targetWeight.trim().length === 0 ? null : parseWeightInput(targetWeight);
      if (targetWeight.trim().length > 0 && target === null) {
        return `Enter a target weight in ${unit}, or leave it blank to have no target.`;
      }
      const starting =
        startingWeight.trim().length === 0 ? null : parseWeightInput(startingWeight);
      if (startingWeight.trim().length > 0 && starting === null) {
        return `Enter a starting weight in ${unit}, or leave it blank to measure from your first reading.`;
      }

      const patch: Parameters<typeof saveWeightGoal>[0] = { target, starting, goalType, unit };
      // OMITTED, not `null`, when a baseline is set with no date typed: passing
      // `null` there would store an undated baseline ("40% complete" since
      // when?), whereas omitting it lets `saveWeightGoal` keep the date already
      // on file or stamp today — which is what the field's own hint promises.
      if (starting === null) {
        patch.startingDate = null;
      } else if (parsedDate.date !== null) {
        patch.startingDate = parsedDate.date;
      }

      const weight = await saveWeightGoal(patch);
      setSnapshot((current) => ({ ...current, weight }));
      return null;
    });

  const clearTarget = () =>
    runSave('weight', async () => {
      const weight = await saveWeightGoal({ target: null, goalType: null });
      setSnapshot((current) => ({ ...current, weight }));
      setTargetWeight('');
      setGoalType(null);
      return null;
    });

  /**
   * The donor's "Reset All Goals to Defaults", minus its guessing.
   *
   * Writes nutrition, activity and water in one go — they are three separate
   * round-trips, so the message names the whole set rather than any one of
   * them. The WEIGHT target is deliberately untouched: it is a decision the
   * member made, not a figure a formula can propose.
   */
  const applySuggestion = () =>
    runSave('suggested', async () => {
      // Defensive only: the button that calls this is rendered exclusively
      // inside the `suggestion !== null` branch below, and `suggestion` is
      // captured from that same render — this can never actually run null.
      /* istanbul ignore next */
      if (suggestion === null) return null;
      const nutrition = await saveNutritionGoals({
        calories: suggestion.calories,
        protein: suggestion.protein,
        carbs: suggestion.carbs,
        fat: suggestion.fat,
      });
      const activity = await saveActivityGoals({
        steps: suggestion.steps,
        minutes: suggestion.minutes,
      });
      const day = await setWaterTarget(suggestion.waterCups);

      // Only the drafts this actually changed are reseeded. Calling
      // `applySnapshot` would have been shorter and would have thrown away an
      // unsaved weight target the member was in the middle of typing.
      setCalories(String(nutrition.calories));
      setMacros({
        protein: String(nutrition.protein),
        carbs: String(nutrition.carbs),
        fat: String(nutrition.fat),
      });
      setSteps(String(activity.steps));
      setMinutes(String(activity.minutes));
      setCups(String(day.target));
      setSnapshot((current) => ({
        ...current,
        nutrition,
        activity,
        waterCups: day.target,
      }));
      return null;
    });

  /* ---------------- render ---------------- */

  return (
    <HealthSectionScreen title="Goals" testID="health-goals-screen" loading={loading}>
      {message !== null && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-goals-message"
        >
          <Typography variant="footnote" color={colors.textSecondary} accessibilityLabel={message}>
            {message}
          </Typography>
        </Card>
      )}

      {/* ============================ NUTRITION ============================ */}
      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-goals-nutrition-card"
      >
        <SectionHeading icon="calories" label="NUTRITION" />

        <NumberField
          label="Daily calories (kcal)"
          value={calories}
          onChange={(text) => setCalories(sanitizeWholeNumber(text))}
          testID="health-goals-calories-input"
        />
        <PresetRow
          presets={CALORIE_PRESETS}
          onPick={(value) => setCalories(String(value))}
          testIDPrefix="health-goals-calorie-preset"
          suffix=" kcal"
        />

        {/* Per-weekday plan — columns shipped in 0119, first client here. */}
        <View style={styles.rowBetween}>
          <View style={styles.grow}>
            <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
              Different target per weekday
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              For training days, rest days or a weekend that looks nothing like a Tuesday.
            </Typography>
          </View>
          <Toggle
            value={week.usePerDay}
            onValueChange={(on) =>
              setWeek((current) =>
                on
                  ? seedCalorieWeek({ ...current, usePerDay: true }, draftNutrition.calories)
                  : { ...current, usePerDay: false }
              )
            }
            accessibilityLabel="Use a different calorie target per weekday"
            testID="health-goals-perday-toggle"
          />
        </View>

        {week.usePerDay && (
          <View style={styles.weekBlock} testID="health-goals-week">
            {CALORIE_WEEK_DAYS.map((day, index) => (
              <View key={day.key} style={styles.weekRow}>
                <Typography
                  variant="footnote"
                  weight={index === todayIndex ? 'semibold' : 'regular'}
                  color={index === todayIndex ? colors.primary : colors.textPrimary}
                  style={styles.weekLabel}
                >
                  {day.label}
                  {index === todayIndex ? ' · today' : ''}
                </Typography>
                <TextInput
                  value={week.days[index] === null ? '' : String(week.days[index])}
                  onChangeText={(text) => {
                    const parsed = parseWholeNumber(text);
                    setWeek((current) => {
                      const days = [...current.days];
                      days[index] = parsed;
                      return { ...current, days };
                    });
                  }}
                  placeholder={String(draftNutrition.calories)}
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="number-pad"
                  accessibilityLabel={`${day.label} calorie target`}
                  testID={`health-goals-week-${day.key}`}
                  style={[
                    styles.input,
                    styles.weekInput,
                    {
                      color: colors.textPrimary,
                      borderColor: colors.borderColor,
                      backgroundColor: colors.backgroundMain,
                    },
                  ]}
                />
              </View>
            ))}

            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID="health-goals-week-average"
            >
              Weekly average {weeklyAverage.toLocaleString()} kcal a day. A day left blank uses
              your single target of {draftNutrition.calories.toLocaleString()} kcal.
            </Typography>

            <Typography variant="caption1" color={colors.textSecondary}>
              Set every day to
            </Typography>
            <PresetRow
              presets={CALORIE_PRESETS}
              onPick={(value) => setWeek((current) => setEveryCalorieDay(current, value))}
              testIDPrefix="health-goals-week-preset"
              suffix=" kcal"
            />
          </View>
        )}

        {/* Macros */}
        <Typography variant="caption1" color={colors.textSecondary} style={styles.spacedLabel}>
          Macro targets
        </Typography>
        {(Object.keys(MACRO_LABELS) as MacroKey[]).map((key) => (
          <View key={key} style={styles.macroRow}>
            <NumberField
              label={`${MACRO_LABELS[key]} (g)`}
              value={macros[key]}
              onChange={(text) =>
                setMacros((current) => ({ ...current, [key]: sanitizeWholeNumber(text) }))
              }
              testID={`health-goals-macro-${key}-input`}
            />
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID={`health-goals-macro-${key}-share`}
            >
              {split.calories[key].toLocaleString()} kcal ·{' '}
              {Math.round(split.share[key] * 100)}% of your calorie target · {KCAL_PER_GRAM[key]}{' '}
              kcal per gram
            </Typography>
            <Pressable
              onPress={() => {
                const next = rebalanceMacros(draftNutrition, key);
                setMacros({
                  protein: String(next.protein),
                  carbs: String(next.carbs),
                  fat: String(next.fat),
                });
              }}
              accessibilityRole="button"
              accessibilityLabel={`Keep ${MACRO_LABELS[key]} and rebalance the other two`}
              testID={`health-goals-macro-${key}-rebalance`}
              hitSlop={6}
              style={styles.linkRow}
            >
              <Icon name="refresh" size={13} color={colors.primary} />
              <Typography variant="caption1" weight="semibold" color={colors.primary}>
                Keep this, rebalance the other two
              </Typography>
            </Pressable>
          </View>
        ))}

        <HealthGoalMacroBar split={split} testID="health-goals-macro-bar" />

        <Typography
          variant="caption1"
          color={
            Math.abs(split.difference) > MACRO_DIFFERENCE_TOLERANCE
              ? colors.warning
              : colors.textSecondary
          }
          testID="health-goals-macro-difference"
        >
          {Math.abs(split.difference) <= MACRO_DIFFERENCE_TOLERANCE
            ? `Your macros add up to ${split.total.toLocaleString()} kcal, which matches your calorie target.`
            : split.difference > 0
              ? `Your macros add up to ${split.total.toLocaleString()} kcal — ${split.difference.toLocaleString()} kcal MORE than your calorie target. Both are saved as you set them; nothing is adjusted for you.`
              : `Your macros add up to ${split.total.toLocaleString()} kcal — ${Math.abs(split.difference).toLocaleString()} kcal LESS than your calorie target. Both are saved as you set them; nothing is adjusted for you.`}
        </Typography>

        <HealthMacroWeekEditor
          week={macroWeek}
          onChange={setMacroWeek}
          flatTargets={{
            protein: draftNutrition.protein,
            carbs: draftNutrition.carbs,
            fat: draftNutrition.fat,
          }}
          caloriesByDay={caloriesByDay}
          testIDPrefix="health-goals-macro-week"
        />

        <SaveButton
          label="Save nutrition targets"
          busy={saving === 'nutrition'}
          onPress={() => void saveNutritionSection()}
          testID="health-goals-nutrition-save"
        />
      </Card>

      {/* ============================= ACTIVITY ============================ */}
      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-goals-activity-card"
      >
        <SectionHeading icon="steps" label="ACTIVITY" />

        <NumberField
          label="Daily steps"
          value={steps}
          onChange={(text) => setSteps(sanitizeWholeNumber(text))}
          testID="health-goals-steps-input"
        />
        <PresetRow
          presets={STEP_PRESETS}
          onPick={(value) => setSteps(String(value))}
          testIDPrefix="health-goals-steps-preset"
        />

        <NumberField
          label="Movement minutes a day"
          value={minutes}
          onChange={(text) => setMinutes(sanitizeWholeNumber(text))}
          testID="health-goals-minutes-input"
        />
        <PresetRow
          presets={MINUTE_PRESETS}
          onPick={(value) => setMinutes(String(value))}
          testIDPrefix="health-goals-minutes-preset"
          suffix=" min"
        />
        <Typography variant="caption1" color={colors.textSecondary}>
          The WHO recommends 150–300 minutes of moderate activity a week, which is roughly 20–45
          minutes a day.
        </Typography>

        <SaveButton
          label="Save activity targets"
          busy={saving === 'activity'}
          onPress={() => void saveActivitySection()}
          testID="health-goals-activity-save"
        />
      </Card>

      {/* ============================ HYDRATION =========================== */}
      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-goals-water-card"
      >
        <SectionHeading icon="water" label="HYDRATION" />

        <NumberField
          label="Daily water (cups)"
          value={cups}
          onChange={(text) => setCups(sanitizeWholeNumber(text))}
          testID="health-goals-water-input"
        />
        <PresetRow
          presets={WATER_PRESETS}
          onPick={(value) => setCups(String(value))}
          testIDPrefix="health-goals-water-preset"
          suffix=" cups"
        />
        <Typography variant="caption1" color={colors.textSecondary} testID="health-goals-water-ml">
          {(parseWholeNumber(cups) ?? snapshot.waterCups).toLocaleString()} cups is{' '}
          {(((parseWholeNumber(cups) ?? snapshot.waterCups) * CUP_ML) / 1000).toFixed(1)} L — a cup
          is {CUP_ML} ml here, and that is the figure sent to the server.
        </Typography>

        <SaveButton
          label="Save water target"
          busy={saving === 'water'}
          onPress={() => void saveWaterSection()}
          testID="health-goals-water-save"
        />
      </Card>

      {/* =========================== WEIGHT GOAL ========================== */}
      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-goals-weight-card"
      >
        <SectionHeading icon="weight" label="WEIGHT GOAL" />

        <Typography variant="caption1" color={colors.textSecondary}>
          What you are aiming for
        </Typography>
        <View style={styles.chipWrap} testID="health-goals-type-row">
          {GOAL_TYPES.map((type) => (
            <SelectChip
              key={type.key}
              label={type.label}
              selected={goalType === type.key}
              onPress={() => setGoalType(goalType === type.key ? null : type.key)}
              accessibilityLabel={`Weight goal: ${type.label}`}
              testID={`health-goals-type-${type.key}`}
            />
          ))}
        </View>
        <Typography variant="caption1" color={colors.textSecondary} testID="health-goals-type-note">
          {goalType === null
            ? 'Pick one and the suggested calorie target below adjusts to match. It changes nothing you have already saved.'
            : (GOAL_TYPES.find((type) => type.key === goalType)?.note ?? '')}
        </Typography>

        <NumberField
          label={`Target weight (${unit})`}
          value={targetWeight}
          onChange={(text) => setTargetWeight(sanitizeWeightInput(text))}
          keyboardType="decimal-pad"
          testID="health-goals-target-input"
        />
        <NumberField
          label={`Starting weight (${unit}) — optional`}
          value={startingWeight}
          onChange={(text) => setStartingWeight(sanitizeWeightInput(text))}
          keyboardType="decimal-pad"
          testID="health-goals-starting-input"
        />
        <BaselineDateField
          label="Starting date — optional"
          value={baselineDate}
          onChange={setBaselineDate}
          testID="health-goals-starting-date-input"
        />
        <Typography variant="caption1" color={colors.textSecondary}>
          Progress is measured from your starting weight. Leave the weight blank and it is
          measured from your first logged reading instead; leave the date blank and today is used.
        </Typography>

        {snapshot.weight.targetKg !== null && snapshot.currentWeightKg !== null && (
          <View style={styles.progressBlock} testID="health-goals-progress">
            <View style={styles.rowBetween}>
              <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                {progress.reached
                  ? 'Target reached'
                  : `${Math.round(progress.fraction * 100)}% of the way there`}
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                {formatWeightValue(
                  Math.abs(weightInUnit(progress.remaining, unit))
                )}{' '}
                {unit} to go
              </Typography>
            </View>
            <ProgressBar progress={progress.fraction} />
            <Typography variant="caption1" color={colors.textSecondary}>
              Now {formatWeightValue(weightInUnit(snapshot.currentWeightKg, unit))} {unit} ·
              target {formatWeightValue(weightInUnit(snapshot.weight.targetKg, unit))} {unit}
              {snapshot.weight.startingKg === null
                ? ' · measured from your first reading'
                : ` · from ${formatWeightValue(weightInUnit(snapshot.weight.startingKg, unit))} ${unit}`}
            </Typography>
          </View>
        )}

        {snapshot.weight.targetKg !== null && snapshot.currentWeightKg === null && (
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID="health-goals-progress-empty"
          >
            Log a weight reading and this will show how far along you are.
          </Typography>
        )}

        <View style={styles.actions}>
          <SaveButton
            label="Save weight goal"
            busy={saving === 'weight'}
            onPress={() => void saveWeightSection()}
            testID="health-goals-weight-save"
          />
          {snapshot.weight.targetKg !== null && (
            <Pressable
              onPress={() => void clearTarget()}
              accessibilityRole="button"
              accessibilityLabel="Clear target weight"
              testID="health-goals-weight-clear"
              style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
            >
              <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
                Clear target
              </Typography>
            </Pressable>
          )}
        </View>

        <Typography variant="caption1" color={colors.textSecondary}>
          Height, sex, birth year and activity level were set during onboarding. They are read
          here to work out the suggestions below.
        </Typography>
      </Card>

      {/* ========================= SUGGESTED TARGETS ====================== */}
      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-goals-suggested-card"
      >
        <SectionHeading icon="goals" label="SUGGESTED TARGETS" />

        {suggestion === null ? (
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            testID="health-goals-suggested-missing"
          >
            To work these out we need {listInWords(missing)}. Weight comes from your weight log;
            the rest were set during onboarding. Nothing is guessed — a suggestion built on a
            default height would describe somebody else.
          </Typography>
        ) : (
          <>
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID="health-goals-suggested-basis"
            >
              At rest you burn about {suggestion.bmr.toLocaleString()} kcal a day, and about{' '}
              {suggestion.tdee.toLocaleString()} kcal once your activity level is counted. These
              are estimates from a standard formula (Mifflin–St Jeor), not a measurement of you.
            </Typography>

            <SuggestedRow label="Calories" value={`${suggestion.calories.toLocaleString()} kcal`} />
            <SuggestedRow
              label="Protein / carbs / fats"
              value={`${suggestion.protein} / ${suggestion.carbs} / ${suggestion.fat} g`}
            />
            <SuggestedRow label="Daily steps" value={suggestion.steps.toLocaleString()} />
            <SuggestedRow label="Movement minutes" value={`${suggestion.minutes} min`} />
            <SuggestedRow label="Water" value={`${suggestion.waterCups} cups`} />

            <SaveButton
              label="Use these targets"
              busy={saving === 'suggested'}
              onPress={() => void applySuggestion()}
              testID="health-goals-suggested-apply"
            />
            <Typography variant="caption1" color={colors.textSecondary}>
              This replaces your calorie, macro, step, movement and water targets. Your weight
              target is left alone — that is your decision, not a formula's.
              {snapshot.calorieWeek.usePerDay
                ? ' Your per-weekday calorie plan is also left alone, and it still takes precedence over the single target above.'
                : ''}
            </Typography>
          </>
        )}
      </Card>

      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-goals-footnote"
      >
        <Typography variant="caption1" color={colors.textSecondary}>
          Changing a target does not rewrite the past: each goal is stored against the day you set
          it, so a chart of last month is still scored against the target you had then.
        </Typography>
      </Card>
    </HealthSectionScreen>
  );
}

/* ------------------------------------------------------------------ */
/* Validation that needs the whole week                                */
/* ------------------------------------------------------------------ */

/**
 * Every SET weekday has to satisfy the route's own calorie bounds. A blank day
 * is legal (it falls back to the single target), so it is not checked.
 */
function checkCalorieWeek(week: CalorieWeek): string | null {
  for (let index = 0; index < CALORIE_WEEK_DAYS.length; index += 1) {
    const value = week.days[index];
    if (value === null) continue;
    const error = checkBound(value, GOAL_BOUNDS.calories);
    if (error !== null) return `${CALORIE_WEEK_DAYS[index].label}: ${error}`;
  }
  return null;
}

/** Macro sibling of `checkCalorieWeek` — every SET gram field per day, same "blank is legal" rule. */
function checkMacroWeek(week: MacroWeek): string | null {
  for (let index = 0; index < MACRO_WEEK_DAYS.length; index += 1) {
    const day = week.days[index];
    for (const [label, value] of [
      ['Protein', day.protein],
      ['Carbs', day.carbs],
      ['Fat', day.fat],
    ] as const) {
      if (value === null) continue;
      const error = checkBound(value, GOAL_BOUNDS.macroGrams);
      if (error !== null) return `${MACRO_WEEK_DAYS[index].label} ${label}: ${error}`;
    }
  }
  return null;
}

/** "a weight reading, your height and your sex" — never a comma-run. */
function listInWords(items: string[]): string {
  // The only call site passes `missing`, which — by `suggestGoals`'s own
  // contract — is non-empty exactly when this branch of the screen renders at
  // all (`suggestion === null` iff `missingSuggestionInputs(...).length > 0`).
  /* istanbul ignore next */
  if (items.length === 0) return 'nothing';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/* ------------------------------------------------------------------ */
/* Small local pieces                                                  */
/* ------------------------------------------------------------------ */

function SectionHeading({ icon, label }: { icon: string; label: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.heading}>
      <Icon name={icon} size={16} color={colors.textSecondary} />
      <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
        {label}
      </Typography>
    </View>
  );
}

function NumberField({
  label,
  value,
  onChange,
  keyboardType = 'number-pad',
  testID,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  /**
   * Only the two keypads that produce a number and nothing else. The union used
   * to admit `numbers-and-punctuation`, which carries an `ABC` key — every field
   * this component renders is a goal figure, so a keypad that can type letters
   * was never a legitimate option here.
   */
  keyboardType?: 'number-pad' | 'decimal-pad';
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.field}>
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        autoCorrect={false}
        accessibilityLabel={label}
        testID={testID}
        style={[
          styles.input,
          {
            color: colors.textPrimary,
            borderColor: colors.borderColor,
            backgroundColor: colors.backgroundMain,
          },
        ]}
      />
    </View>
  );
}

/** Local `YYYY-MM-DD` (never UTC — avoids the off-by-one-day shift `toISOString` gives). */
function dateToYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse `YYYY-MM-DD` into a local `Date`; blank/garbage falls back to today. */
function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) return new Date(y, m - 1, d);
  return new Date();
}

/**
 * The baseline date field — a native picker, not free-text entry.
 *
 * Replaces a `YYYY-MM-DD` `TextInput` (still validated defensively by
 * `parseDayKey` on save, in case a stale cached snapshot ever carries a
 * malformed string). Blank stays blank on screen — the field's own hint
 * already promises "leave the date blank and today is used," and a picker
 * defaulting to a visible date the moment it opens would contradict that.
 */
function BaselineDateField({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  onChange: (ymd: string) => void;
  testID: string;
}) {
  const colors = useAppColors();
  const isDark = useIsDarkMode();
  const [open, setOpen] = useState(false);
  const current = value.length > 0 ? ymdToDate(value) : new Date();

  const handleChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setOpen(false);
    if (selected) onChange(dateToYMD(selected));
  };

  return (
    <View style={styles.field}>
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
      <View style={styles.dateRow}>
        <Pressable
          onPress={() => setOpen((prev) => !prev)}
          accessibilityRole="button"
          accessibilityLabel={label}
          testID={testID}
          style={[
            styles.input,
            styles.dateField,
            { borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
          ]}
        >
          <Typography
            variant="body"
            color={value.length > 0 ? colors.textPrimary : colors.textSecondary}
          >
            {value.length > 0
              ? current.toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : 'Not set — today will be used'}
          </Typography>
          <Icon name="calendar-outline" size={18} color={colors.primary} />
        </Pressable>
        {value.length > 0 && (
          <Pressable
            onPress={() => {
              onChange('');
              setOpen(false);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            testID={`${testID}-clear`}
            hitSlop={8}
            style={styles.dateClear}
          >
            <Icon name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {open && Platform.OS === 'ios' && (
        <View
          style={[
            styles.datePanel,
            { borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
          ]}
        >
          <DateTimePicker
            value={current}
            mode="date"
            display="spinner"
            maximumDate={new Date()}
            themeVariant={isDark ? 'dark' : 'light'}
            onChange={handleChange}
          />
          <Pressable onPress={() => setOpen(false)} style={styles.dateDone} testID={`${testID}-done`}>
            <Typography variant="footnote" weight="semibold" color={colors.primary}>
              Done
            </Typography>
          </Pressable>
        </View>
      )}
      {open && Platform.OS === 'android' && (
        <DateTimePicker
          value={current}
          mode="date"
          display="default"
          maximumDate={new Date()}
          onChange={handleChange}
        />
      )}
    </View>
  );
}

function PresetRow({
  presets,
  onPick,
  testIDPrefix,
  suffix = '',
}: {
  presets: number[];
  onPick: (value: number) => void;
  testIDPrefix: string;
  suffix?: string;
}) {
  return (
    <View style={styles.chipWrap}>
      {presets.map((preset) => (
        <SelectChip
          key={preset}
          label={`${preset.toLocaleString()}${suffix}`}
          selected={false}
          onPress={() => onPick(preset)}
          accessibilityLabel={`Set to ${preset}${suffix}`}
          testID={`${testIDPrefix}-${preset}`}
        />
      ))}
    </View>
  );
}

function SelectChip({
  label,
  selected,
  onPress,
  accessibilityLabel,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      testID={testID}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.backgroundMain,
          borderColor: colors.borderColor,
        },
      ]}
    >
      <Typography
        variant="caption1"
        weight="semibold"
        color={selected ? colors.white : colors.textSecondary}
      >
        {label}
      </Typography>
    </Pressable>
  );
}

function SuggestedRow({ label, value }: { label: string; value: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.rowBetween}>
      <Typography variant="footnote" color={colors.textSecondary}>
        {label}
      </Typography>
      <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
        {value}
      </Typography>
    </View>
  );
}

function SaveButton({
  label,
  busy,
  onPress,
  testID,
}: {
  label: string;
  busy: boolean;
  onPress: () => void;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy }}
      accessibilityLabel={label}
      testID={testID}
      style={[
        styles.primaryButton,
        { backgroundColor: busy ? colors.borderColor : colors.primary },
      ]}
    >
      <Typography variant="footnote" weight="semibold" color={colors.white}>
        {busy ? 'Saving…' : label}
      </Typography>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  spacedLabel: {
    paddingTop: Spacing.xs,
  },
  field: {
    gap: Spacing.xs,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  dateField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateClear: {
    padding: Spacing.xs,
  },
  datePanel: {
    marginTop: Spacing.xs,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  dateDone: {
    alignSelf: 'flex-end',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  grow: {
    flex: 1,
  },
  weekBlock: {
    gap: Spacing.xs,
    paddingTop: Spacing.xs,
  },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  weekLabel: {
    flex: 1,
  },
  weekInput: {
    width: 110,
    textAlign: 'right',
  },
  macroRow: {
    gap: 2,
    paddingBottom: Spacing.xs,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingTop: 2,
  },
  progressBlock: {
    gap: Spacing.xs,
    paddingTop: Spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  primaryButton: {
    flex: 1,
    height: 44,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    flex: 1,
    height: 44,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
