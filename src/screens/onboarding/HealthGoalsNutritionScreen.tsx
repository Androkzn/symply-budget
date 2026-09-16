import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  OnboardingChoiceChips,
  OnboardingStepScreen,
  OnboardingSuggestionBanner,
} from '@components/onboarding';
import { Card, Icon, InfoButton, NumberWheelPickerSheet, Typography } from '@components/ui';
import type { InfoSource } from '@components/ui';
import { HealthGoalMacroBar, HealthMacroWeekEditor } from '@features/health/components';
import {
  CALORIE_WEEK_DAYS,
  EMPTY_CALORIE_WEEK,
  EMPTY_MACRO_WEEK,
  GOAL_BOUNDS,
  GOAL_CALORIE_ADJUSTMENT,
  MACRO_DIFFERENCE_TOLERANCE,
  MACRO_PERCENT_PRESETS,
  macroGramsFromPercent,
  macroSplit,
  parseWholeNumber,
  sanitizeWholeNumber,
  saveCalorieWeek,
  saveMacroWeek,
  seedCalorieWeek,
  weeklyAverageCalories,
  type CalorieWeek,
  type MacroWeek,
  type SuggestedGoals,
} from '@features/health/healthGoalsStorage';
import {
  DEFAULT_NUTRITION_GOALS,
  saveNutritionGoals,
  type NutritionGoals,
} from '@features/health/healthNutritionStorage';
import { useSuggestedGoals } from '@features/health/useHealthGoalsSuggestion';
import type { OnboardingStackParamList } from '@navigation/types';
import { CornerRadius, scaledFont, Sheet, Spacing, useAppColors } from '@theme';

type NavigationProp = NativeStackNavigationProp<OnboardingStackParamList, 'HealthGoalsNutrition'>;
type RouteProps = RouteProp<OnboardingStackParamList, 'HealthGoalsNutrition'>;

const CALORIE_STEP = 50;

const CALORIE_MODES = [
  { key: 'all', label: 'Apply to all days' },
  { key: 'custom', label: 'Custom week' },
];

const CALORIES_INFO =
  "This is your total food calories for the day — everything eaten across breakfast, lunch, dinner and snacks. It's the target the Nutrition tab's calorie ring tracks against, and you can always change it later in Goals.";

/**
 * References for the "Daily calories" info sheet's "Suggested for you" walk-
 * through below — one per step of the calculation: the BMR formula, then the
 * evidence behind each end of the goal adjustment `GOAL_CALORIE_ADJUSTMENT`
 * applies (there's nothing to cite for the middle "maintain" step, since it's
 * just TDEE unchanged).
 */
const CALORIES_SUGGESTION_SOURCES: InfoSource[] = [
  {
    label:
      'Mifflin, St Jeor et al. (1990) — A new predictive equation for resting energy expenditure in healthy individuals, Am J Clin Nutr',
    url: 'https://doi.org/10.1093/ajcn/51.2.241',
  },
  {
    label:
      'NHLBI (1998) — Clinical Guidelines on the Identification, Evaluation, and Treatment of Overweight and Obesity in Adults (500–1,000 kcal/day deficit for weight loss)',
    url: 'https://www.ncbi.nlm.nih.gov/books/NBK2009/',
  },
  {
    label:
      'Iraki et al. (2019) — Nutrition Recommendations for Bodybuilders in the Off-Season, Sports (10–20% surplus for lean weight gain)',
    url: 'https://doi.org/10.3390/sports7070154',
  },
];

type MacroMode = 'grams' | 'percent';

const MACRO_MODE_OPTIONS = [
  { key: 'percent', label: '% of calories' },
  { key: 'grams', label: 'Grams' },
];

/**
 * Member-facing version of the research cited on `MACRO_PERCENT_PRESETS` in
 * `healthGoalsStorage.ts` — real reference points (AMDR, Feinman et al.'s
 * low-carb threshold, the ISSN protein stand), not marketing copy. Kept in
 * sync with that file's fuller citations if the presets ever change. Stated
 * once here rather than repeated in each preset's own caption below.
 */
const AMDR_REFERENCE =
  'U.S. Acceptable Macronutrient Distribution Range (Institute of Medicine): protein 10–35% · carbs 45–65% · fat 20–35% of calories.';

/** Backs `AMDR_REFERENCE` / `MACRO_PRESET_CITATIONS` above with tappable
 * links — the same three references cited in `MACRO_PERCENT_PRESETS`'
 * fuller comment in `healthGoalsStorage.ts`, kept in sync with it. */
const MACRO_PRESET_SOURCES: InfoSource[] = [
  {
    label: 'Institute of Medicine (2005) — Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids',
    url: 'https://nap.nationalacademies.org/read/10490/chapter/1',
  },
  {
    label: 'Feinman et al. (2015) — Dietary carbohydrate restriction as the first approach in diabetes management, Nutrition',
    url: 'https://doi.org/10.1016/j.nut.2014.06.011',
  },
  {
    label: 'Jäger et al. (2017) — ISSN Position Stand: protein and exercise, J Int Soc Sports Nutr',
    url: 'https://doi.org/10.1186/s12970-017-0177-8',
  },
];

const MACRO_PRESET_CITATIONS: Record<string, string> = {
  balanced:
    'Protein and fat sit inside the Range; carbs (40%) sit just under its 45% floor — the "moderate-carb" tilt nearly every macro-tracking app defaults to.',
  lowCarb:
    'Carbs (20%) clear the 26% cutoff a widely cited 2015 expert consensus (Feinman et al.) uses to define "low-carb"; protein and fat rise above the Range’s 35% ceiling to fill the rest.',
  highProtein:
    "Protein (40%) rises above the Range's ceiling, matching sports-nutrition guidance (the ISSN's protein position stand) for people who strength-train.",
};

/**
 * 2,000 kcal — the exact `DEFAULT_NUTRITION_GOALS.calories` fallback this
 * screen already uses elsewhere, itself the FDA Nutrition Facts reference
 * value. Reused here (not a fresh number) purely to turn each preset's
 * percentages into a real gram/kcal split `HealthGoalMacroBar` can chart —
 * the bars illustrate the RATIO, which does not change with the baseline.
 */
const PRESET_INFO_BASELINE_CALORIES = DEFAULT_NUTRITION_GOALS.calories;

/** Same handful of splits MyFitnessPal/Cronometer/Lose It! all offer as one tap. */
const MACRO_PERCENT_PRESET_OPTIONS = MACRO_PERCENT_PRESETS.map((preset) => ({
  key: preset.key,
  label: preset.label,
}));

/** Whatever was typed, clamped into the route's own bounds — never rejected. */
function clampedOrNull(raw: string, bound: { min: number; max: number }): number | null {
  const value = parseWholeNumber(raw);
  if (value === null) return null;
  return Math.min(bound.max, Math.max(bound.min, value));
}

function clampedCalorieOrNull(value: number | null): number | null {
  if (value === null) return null;
  return Math.min(GOAL_BOUNDS.calories.max, Math.max(GOAL_BOUNDS.calories.min, value));
}

/**
 * Symply Health goals mini-flow, step 3 of 7 — daily calories and the P/C/F
 * split. Writes through `saveNutritionGoals`, the SAME module the in-app
 * Goals screen and the Nutrition tab's calorie ring read from, so this is a
 * real save, not an onboarding-only draft.
 *
 * A "Suggested for you" banner appears once weight (previous step), and
 * gender/age/height/activity level (the "About you" step, now FIRST in the
 * flow) are all on file — `suggestGoals()`'s same "nothing is guessed"
 * refusal the in-app Goals screen already has, reused rather than
 * reimplemented. Tapping it fills the calorie field and switches macros to
 * percent mode with the resulting split; nothing is written until Continue,
 * same as every other field on this screen.
 *
 * Macros can be entered as GRAMS or as a PERCENTAGE of the calorie target —
 * mirroring MyFitnessPal/Cronometer/Lose It!, which all offer exactly this
 * choice, rather than inventing a third convention. Percent mode needs a
 * calorie target to convert into grams; with none typed there is nothing to
 * convert, so the macros are simply left unset on Continue — the same "leave
 * it blank" behaviour every other field on this screen already has.
 *
 * Whichever mode is active, a live kcal breakdown (`macroSplit`, the SAME
 * calculation the in-app Goals screen already shows) appears once at least
 * one macro has a value, so a member sees what their split actually adds up
 * to before they leave the screen rather than only after saving.
 *
 * Every field is optional and every typed value is clamped rather than
 * rejected, so "Continue" (or the header's forward arrow) always advances —
 * there is nothing here that can block the member mid-onboarding.
 *
 * ── LAYOUT ────────────────────────────────────────────────────────────────
 * Two grouped `Card`s (calories, macros) rather than fields floating loose on
 * the background — the same "well" list-row language the in-app Goals screen
 * already uses, so this step reads as a finished part of the app rather than
 * a bare form. The two either/or choices (per-day plan on/off, %-vs-grams)
 * render as a native-style segmented control (`OnboardingChoiceChips`
 * `variant="segmented"`); the always-several-options presets stay pill chips.
 * Protein/carbs/fat share ONE colour key (`colors.primary`/`info`/`warning`)
 * with `HealthGoalMacroBar`'s legend below, so the same macro reads as the
 * same colour everywhere on the screen.
 */
export function HealthGoalsNutritionScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const suggestion = useSuggestedGoals();

  const [calories, setCalories] = useState('');
  const [macroMode, setMacroMode] = useState<MacroMode>('percent');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [proteinPct, setProteinPct] = useState('');
  const [carbsPct, setCarbsPct] = useState('');
  const [fatPct, setFatPct] = useState('');
  const [saving, setSaving] = useState(false);

  const [caloriesManualMode, setCaloriesManualMode] = useState(false);
  const caloriesInputRef = useRef<TextInput>(null);
  const [week, setWeek] = useState<CalorieWeek>(EMPTY_CALORIE_WEEK);
  const [weekManualDays, setWeekManualDays] = useState<boolean[]>(() =>
    CALORIE_WEEK_DAYS.map(() => false)
  );
  const weekInputRefs = useRef<(TextInput | null)[]>([]);
  // `'main'` = the flat daily-calories field, a number = that index into
  // `week.days` — one sheet instance serves both so a per-day row opens the
  // EXACT same wheel the flat field does, "Enter manually" included.
  const [caloriesPickerTarget, setCaloriesPickerTarget] = useState<'main' | number | null>(null);
  const [macroWeek, setMacroWeek] = useState<MacroWeek>(EMPTY_MACRO_WEEK);

  const kcal = clampedOrNull(calories, GOAL_BOUNDS.calories);
  const hasMacroInput =
    macroMode === 'grams'
      ? protein.length > 0 || carbs.length > 0 || fat.length > 0
      : proteinPct.length > 0 || carbsPct.length > 0 || fatPct.length > 0;

  const previewGoals = useMemo((): NutritionGoals | null => {
    if (kcal === null || !hasMacroInput) return null;
    const gramsFor = (gramsRaw: string, pctRaw: string, macro: 'protein' | 'carbs' | 'fat') => {
      if (macroMode === 'grams') return clampedOrNull(gramsRaw, GOAL_BOUNDS.macroGrams) ?? 0;
      const pct = clampedOrNull(pctRaw, GOAL_BOUNDS.macroPercent);
      return pct === null ? 0 : macroGramsFromPercent(pct, kcal, macro);
    };
    return {
      calories: kcal,
      protein: gramsFor(protein, proteinPct, 'protein'),
      carbs: gramsFor(carbs, carbsPct, 'carbs'),
      fat: gramsFor(fat, fatPct, 'fat'),
    };
  }, [kcal, hasMacroInput, macroMode, protein, carbs, fat, proteinPct, carbsPct, fatPct]);

  const split = previewGoals ? macroSplit(previewGoals) : null;

  // What the per-weekday macro editor measures each day's split against — the
  // SAME per-day calorie override "Custom week" above already writes, so a
  // member who set Saturday to 2,900 kcal sees Saturday's macro split judged
  // against 2,900, not the flat target.
  const fallbackKcal = kcal ?? DEFAULT_NUTRITION_GOALS.calories;
  const caloriesByDay = week.days.map((value) => value ?? fallbackKcal);

  const advance = () => navigation.navigate('HealthGoalsActivity', route.params);

  /**
   * Fills GRAMS directly from the suggestion rather than round-tripping
   * through percent mode — `suggestGoals()` already returns grams, and
   * converting those to a percent and back would just introduce a rounding
   * mismatch against the very figures the banner just showed.
   */
  const applySuggestion = () => {
    if (suggestion === null) return;
    setCalories(String(suggestion.calories));
    setMacroMode('grams');
    setProtein(String(suggestion.protein));
    setCarbs(String(suggestion.carbs));
    setFat(String(suggestion.fat));
  };

  const applyPercentPreset = (key: string) => {
    const preset = MACRO_PERCENT_PRESETS.find((candidate) => candidate.key === key);
    if (!preset) return;
    setProteinPct(String(preset.percents.protein));
    setCarbsPct(String(preset.percents.carbs));
    setFatPct(String(preset.percents.fat));
  };

  const handleContinue = async () => {
    const patch: Partial<NutritionGoals> = {};
    if (kcal !== null) patch.calories = kcal;

    if (macroMode === 'grams') {
      const proteinG = clampedOrNull(protein, GOAL_BOUNDS.macroGrams);
      const carbsG = clampedOrNull(carbs, GOAL_BOUNDS.macroGrams);
      const fatG = clampedOrNull(fat, GOAL_BOUNDS.macroGrams);
      if (proteinG !== null) patch.protein = proteinG;
      if (carbsG !== null) patch.carbs = carbsG;
      if (fatG !== null) patch.fat = fatG;
    } else if (kcal !== null) {
      const proteinPctVal = clampedOrNull(proteinPct, GOAL_BOUNDS.macroPercent);
      const carbsPctVal = clampedOrNull(carbsPct, GOAL_BOUNDS.macroPercent);
      const fatPctVal = clampedOrNull(fatPct, GOAL_BOUNDS.macroPercent);
      if (proteinPctVal !== null) {
        patch.protein = macroGramsFromPercent(proteinPctVal, kcal, 'protein');
      }
      if (carbsPctVal !== null) {
        patch.carbs = macroGramsFromPercent(carbsPctVal, kcal, 'carbs');
      }
      if (fatPctVal !== null) {
        patch.fat = macroGramsFromPercent(fatPctVal, kcal, 'fat');
      }
    }

    // Only sent when the member actually turned "Custom week" on — flipping it
    // back off before Continue leaves nothing to write, same as any other
    // untouched field here.
    const weekToSave: CalorieWeek | null = week.usePerDay
      ? { usePerDay: true, days: week.days.map(clampedCalorieOrNull) }
      : null;

    // Same "only sent when actually turned on" rule as the calorie week above.
    const macroWeekToSave: MacroWeek | null = macroWeek.usePerDay
      ? { usePerDay: true, days: macroWeek.days }
      : null;

    if (Object.keys(patch).length === 0 && weekToSave === null && macroWeekToSave === null) {
      advance();
      return;
    }

    setSaving(true);
    try {
      if (Object.keys(patch).length > 0) await saveNutritionGoals(patch);
      if (weekToSave !== null) await saveCalorieWeek(weekToSave);
      if (macroWeekToSave !== null) await saveMacroWeek(macroWeekToSave);
    } catch {
      // Both save helpers already queue the write for offline retry — nothing
      // here needs to block the member's way forward on a failure.
    } finally {
      setSaving(false);
      advance();
    }
  };

  const openCaloriesPicker = () => {
    if (caloriesManualMode) return;
    setCaloriesPickerTarget('main');
  };

  const openDayPicker = (index: number) => {
    if (weekManualDays[index]) return;
    setCaloriesPickerTarget(index);
  };

  const handleCaloriesPickerConfirm = (value: number) => {
    if (caloriesPickerTarget === 'main') {
      setCalories(String(value));
      return;
    }
    if (typeof caloriesPickerTarget === 'number') {
      const index = caloriesPickerTarget;
      setWeek((current) => {
        const days = [...current.days];
        days[index] = value;
        return { ...current, days };
      });
    }
  };

  const handleCaloriesPickerManualEntry = () => {
    const target = caloriesPickerTarget;
    setCaloriesPickerTarget(null);
    if (target === 'main') {
      setCaloriesManualMode(true);
      // Wait out the sheet's close animation so the keyboard isn't fighting the
      // sheet's slide-down for the screen.
      setTimeout(() => caloriesInputRef.current?.focus(), Sheet.dismissAnimDurationMs);
    } else if (typeof target === 'number') {
      const index = target;
      setWeekManualDays((current) => {
        const next = [...current];
        next[index] = true;
        return next;
      });
      setTimeout(() => weekInputRefs.current[index]?.focus(), Sheet.dismissAnimDurationMs);
    }
  };

  const caloriesPickerValue =
    caloriesPickerTarget === 'main'
      ? kcal ?? DEFAULT_NUTRITION_GOALS.calories
      : typeof caloriesPickerTarget === 'number'
        ? week.days[caloriesPickerTarget] ?? kcal ?? DEFAULT_NUTRITION_GOALS.calories
        : DEFAULT_NUTRITION_GOALS.calories;

  const caloriesPickerTitle =
    typeof caloriesPickerTarget === 'number'
      ? `${CALORIE_WEEK_DAYS[caloriesPickerTarget].label} calories`
      : 'Daily calories';

  const weeklyAverage = weeklyAverageCalories(week, kcal ?? DEFAULT_NUTRITION_GOALS.calories);

  return (
    <OnboardingStepScreen
      testID="onboarding-health-goals-nutrition-screen"
      title="Calories & nutrition"
      subtitle="A daily calorie target, and how it splits across protein, carbs and fat if you want that level of detail. Leave anything blank to decide later."
      currentStep={3}
      totalSteps={8}
      stepLabel="Nutrition"
      icon="nutrition-outline"
      onBack={() => navigation.goBack()}
      onContinue={() => void handleContinue()}
      continueBusy={saving}
    >
      {suggestion && (
        <OnboardingSuggestionBanner
          description={`${suggestion.calories.toLocaleString()} kcal · ${suggestion.protein}g protein / ${suggestion.carbs}g carbs / ${suggestion.fat}g fat, based on your weight, height, age, sex, activity level and goal.`}
          onApply={applySuggestion}
          testID="onboarding-health-goals-nutrition-suggestion"
          info={
            <InfoButton
              title="Suggested for you"
              sources={CALORIES_SUGGESTION_SOURCES}
              testID="onboarding-health-goals-nutrition-suggestion-info"
            >
              <CaloriesInfoBody suggestion={suggestion} />
            </InfoButton>
          }
        />
      )}

      <Card variant="filled" style={styles.card} testID="onboarding-health-goals-calories-card">
        <CardSectionHeader
          icon="calories"
          title="Daily calories"
          right={
            <InfoButton
              title="Daily calories"
              sources={CALORIES_SUGGESTION_SOURCES}
              testID="onboarding-health-goals-calories-info"
            >
              <CaloriesInfoBody suggestion={suggestion} />
            </InfoButton>
          }
        />

        <View
          style={[
            styles.valueWell,
            { borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
          ]}
        >
          <TextInput
            ref={caloriesInputRef}
            value={calories}
            onChangeText={(text) => setCalories(sanitizeWholeNumber(text))}
            onFocus={openCaloriesPicker}
            showSoftInputOnFocus={caloriesManualMode}
            caretHidden={!caloriesManualMode}
            placeholder="Tap to choose"
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            autoCorrect={false}
            accessibilityLabel="Daily calories (kcal)"
            testID="onboarding-health-goals-calories-input"
            style={[
              // `style` sizes the placeholder too — RN has no separate hook for
              // it — so the bold "hero stat" look (`valueInput`) is reserved for
              // an actual typed/picked value. Empty (just "Tap to choose")
              // shows at ordinary body size instead of inheriting that same
              // oversized bold weight.
              calories.length > 0 ? styles.valueInput : styles.valueInputEmpty,
              { color: colors.textPrimary },
            ]}
          />
          {kcal !== null && (
            <Typography variant="subheadline" color={colors.textSecondary}>
              kcal
            </Typography>
          )}
          {!caloriesManualMode && (
            <Icon name="chevron-down" size={16} color={colors.textSecondary} />
          )}
        </View>

        <View style={styles.subSection}>
          <Typography variant="caption1" color={colors.textSecondary}>
            Applies across the week
          </Typography>
          <OnboardingChoiceChips
            options={CALORIE_MODES}
            selected={week.usePerDay ? 'custom' : 'all'}
            onSelect={(key) =>
              setWeek((current) =>
                key === 'custom'
                  ? seedCalorieWeek(
                      { ...current, usePerDay: true },
                      kcal ?? DEFAULT_NUTRITION_GOALS.calories
                    )
                  : { ...current, usePerDay: false }
              )
            }
            testIDPrefix="onboarding-health-goals-calorie-mode"
            variant="segmented"
          />
        </View>

        {week.usePerDay && (
          <View style={styles.subSection} testID="onboarding-health-goals-week">
            <View
              style={[
                styles.listWell,
                { borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
              ]}
            >
              {CALORIE_WEEK_DAYS.map((day, index) => (
                <View
                  key={day.key}
                  style={[
                    styles.listRow,
                    index < CALORIE_WEEK_DAYS.length - 1 && [
                      styles.listRowDivider,
                      { borderColor: colors.borderColor },
                    ],
                  ]}
                >
                  <Typography variant="subheadline" color={colors.textPrimary}>
                    {day.label}
                  </Typography>
                  <Pressable
                    style={styles.listRowValue}
                    onPress={() => weekInputRefs.current[index]?.focus()}
                    accessibilityRole="button"
                    accessibilityLabel={`${day.label} calorie target`}
                  >
                    <TextInput
                      ref={(node) => {
                        weekInputRefs.current[index] = node;
                      }}
                      value={week.days[index] === null ? '' : String(week.days[index])}
                      onChangeText={(text) => {
                        const parsed = parseWholeNumber(text);
                        setWeek((current) => {
                          const days = [...current.days];
                          days[index] = parsed;
                          return { ...current, days };
                        });
                      }}
                      onFocus={() => openDayPicker(index)}
                      showSoftInputOnFocus={weekManualDays[index]}
                      caretHidden={!weekManualDays[index]}
                      placeholder={calories || String(DEFAULT_NUTRITION_GOALS.calories)}
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="number-pad"
                      pointerEvents="none"
                      testID={`onboarding-health-goals-week-${day.key}`}
                      style={[styles.listInput, { color: colors.textPrimary }]}
                    />
                    <Typography
                      variant="caption1"
                      color={colors.textSecondary}
                      style={styles.listUnit}
                    >
                      kcal
                    </Typography>
                    {!weekManualDays[index] && (
                      <Icon name="chevron-down" size={14} color={colors.textSecondary} />
                    )}
                  </Pressable>
                </View>
              ))}
            </View>
            <Typography variant="caption2" color={colors.textSecondary}>
              Weekly average {weeklyAverage.toLocaleString()} kcal a day. A day left blank uses your
              single target above.
            </Typography>
          </View>
        )}
      </Card>

      <Card variant="filled" style={styles.card} testID="onboarding-health-goals-macros-card">
        <CardSectionHeader title="Macro targets" />

        <OnboardingChoiceChips
          options={MACRO_MODE_OPTIONS}
          selected={macroMode}
          onSelect={(key) => setMacroMode(key as MacroMode)}
          testIDPrefix="onboarding-health-goals-macro-mode"
          accessibilityLabelPrefix="Enter macros as"
          variant="segmented"
        />

        {macroMode === 'grams' ? (
          <View
            style={[
              styles.listWell,
              { borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
            ]}
          >
            <MacroFieldRow
              label="Protein"
              unit="g"
              dotColor={colors.primary}
              value={protein}
              onChange={(text) => setProtein(sanitizeWholeNumber(text))}
              testID="onboarding-health-goals-protein-input"
            />
            <MacroFieldRow
              label="Carbs"
              unit="g"
              dotColor={colors.info}
              value={carbs}
              onChange={(text) => setCarbs(sanitizeWholeNumber(text))}
              testID="onboarding-health-goals-carbs-input"
            />
            <MacroFieldRow
              label="Fat"
              unit="g"
              dotColor={colors.warning}
              value={fat}
              onChange={(text) => setFat(sanitizeWholeNumber(text))}
              testID="onboarding-health-goals-fat-input"
              last
            />
          </View>
        ) : (
          <>
            <Typography variant="caption2" color={colors.textSecondary}>
              {kcal === null
                ? 'Add a daily calorie target above to turn these into grams.'
                : 'Shares of your calorie target above — grams are worked out for you.'}
            </Typography>

            <View style={styles.labelRow}>
              <Typography variant="caption1" color={colors.textSecondary}>
                Quick presets
              </Typography>
              <InfoButton
                title="Quick presets"
                sources={MACRO_PRESET_SOURCES}
                testID="onboarding-health-goals-macro-preset-info"
              >
                <MacroPresetInfoBody />
              </InfoButton>
            </View>
            <OnboardingChoiceChips
              options={MACRO_PERCENT_PRESET_OPTIONS}
              selected={null}
              onSelect={applyPercentPreset}
              testIDPrefix="onboarding-health-goals-macro-percent-preset"
            />

            <View
              style={[
                styles.listWell,
                { borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
              ]}
            >
              <MacroFieldRow
                label="Protein"
                unit="%"
                dotColor={colors.primary}
                value={proteinPct}
                onChange={(text) => setProteinPct(sanitizeWholeNumber(text))}
                grams={previewGoals?.protein ?? null}
                testID="onboarding-health-goals-protein-percent-input"
              />
              <MacroFieldRow
                label="Carbs"
                unit="%"
                dotColor={colors.info}
                value={carbsPct}
                onChange={(text) => setCarbsPct(sanitizeWholeNumber(text))}
                grams={previewGoals?.carbs ?? null}
                testID="onboarding-health-goals-carbs-percent-input"
              />
              <MacroFieldRow
                label="Fat"
                unit="%"
                dotColor={colors.warning}
                value={fatPct}
                onChange={(text) => setFatPct(sanitizeWholeNumber(text))}
                grams={previewGoals?.fat ?? null}
                testID="onboarding-health-goals-fat-percent-input"
                last
              />
            </View>
          </>
        )}

        {split && (
          <View
            style={[styles.calc, { borderTopColor: colors.borderColor }]}
            testID="onboarding-health-goals-macro-calc"
          >
            <HealthGoalMacroBar split={split} testID="onboarding-health-goals-macro-bar" />
            <Typography
              variant="caption1"
              color={
                Math.abs(split.difference) > MACRO_DIFFERENCE_TOLERANCE
                  ? colors.warning
                  : colors.textSecondary
              }
              testID="onboarding-health-goals-macro-difference"
            >
              {Math.abs(split.difference) <= MACRO_DIFFERENCE_TOLERANCE
                ? `Your macros add up to ${split.total.toLocaleString()} kcal, which matches your calorie target.`
                : split.difference > 0
                  ? `Your macros add up to ${split.total.toLocaleString()} kcal — ${split.difference.toLocaleString()} kcal more than your calorie target.`
                  : `Your macros add up to ${split.total.toLocaleString()} kcal — ${Math.abs(
                      split.difference
                    ).toLocaleString()} kcal less than your calorie target.`}
            </Typography>
          </View>
        )}

        {previewGoals && (
          <View style={[styles.weekEditor, { borderTopColor: colors.borderColor }]}>
            <HealthMacroWeekEditor
              week={macroWeek}
              onChange={setMacroWeek}
              flatTargets={{
                protein: previewGoals.protein,
                carbs: previewGoals.carbs,
                fat: previewGoals.fat,
              }}
              caloriesByDay={caloriesByDay}
              testIDPrefix="onboarding-health-goals-macro-week"
            />
          </View>
        )}
      </Card>

      <NumberWheelPickerSheet
        visible={caloriesPickerTarget !== null}
        title={caloriesPickerTitle}
        value={caloriesPickerValue}
        min={GOAL_BOUNDS.calories.min}
        max={GOAL_BOUNDS.calories.max}
        step={CALORIE_STEP}
        unitLabel="kcal"
        onConfirm={handleCaloriesPickerConfirm}
        onClose={() => setCaloriesPickerTarget(null)}
        onManualEntry={handleCaloriesPickerManualEntry}
        testID="onboarding-health-goals-calories-picker"
      />
    </OnboardingStepScreen>
  );
}

/** Icon + title row a `Card` opens with, an optional control (info button, badge) flush right. */
function CardSectionHeader({
  icon,
  title,
  right,
}: {
  icon?: string;
  title: string;
  right?: React.ReactNode;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.cardHeader}>
      <View style={styles.cardHeaderTitle}>
        {icon && <Icon name={icon} size={16} color={colors.textSecondary} />}
        <Typography variant="subheadline" weight="semibold" color={colors.textPrimary}>
          {title}
        </Typography>
      </View>
      {right}
    </View>
  );
}

/**
 * Rich body for the "Daily calories" `InfoButton` — what the field means,
 * then a step-by-step breakdown of how the "Suggested for you" banner's
 * number is actually worked out, with the member's OWN figures (`suggestion`)
 * filled in once weight, height, age, sex and activity level are all on
 * file. `GOAL_CALORIE_ADJUSTMENT` is read from `healthGoalsStorage` rather
 * than restated here, so the percentages shown can never drift from the ones
 * `suggestGoals()` actually applies.
 */
function CaloriesInfoBody({ suggestion }: { suggestion: SuggestedGoals | null }) {
  const colors = useAppColors();
  const losePercent = Math.round(Math.abs(GOAL_CALORIE_ADJUSTMENT.lose) * 100);
  const gainPercent = Math.round(GOAL_CALORIE_ADJUSTMENT.gain * 100);

  return (
    <View style={styles.caloriesInfo}>
      <Typography variant="caption2" color={colors.textSecondary}>
        {CALORIES_INFO}
      </Typography>

      <Typography variant="subheadline" weight="semibold" color={colors.textPrimary}>
        How &ldquo;Suggested for you&rdquo; is worked out
      </Typography>

      <View style={styles.caloriesInfoSteps}>
        <CaloriesInfoStep
          number={1}
          text="Resting burn (BMR) — from your weight, height, age and sex, using the Mifflin–St Jeor equation."
        />
        <CaloriesInfoStep
          number={2}
          text="Total burn (TDEE) — BMR × an activity multiplier for your activity level, from 1.2 (sedentary) up to 1.9 (extra active)."
        />
        <CaloriesInfoStep
          number={3}
          text={`Goal adjustment — about ${losePercent}% below TDEE to lose weight, unchanged to maintain, or about ${gainPercent}% above to gain, never below a 1,200 kcal safety floor.`}
        />
      </View>

      {suggestion && (
        <View
          style={[styles.caloriesInfoFigures, { backgroundColor: colors.pillBackground }]}
          testID="onboarding-health-goals-calories-info-figures"
        >
          <Typography variant="caption1" weight="semibold" color={colors.textPrimary}>
            Your numbers right now
          </Typography>
          <CaloriesInfoRow label="Resting burn (BMR)" value={`≈ ${suggestion.bmr.toLocaleString()} kcal`} />
          <CaloriesInfoRow label="Total burn (TDEE)" value={`≈ ${suggestion.tdee.toLocaleString()} kcal`} />
          <CaloriesInfoRow
            label="Suggested target"
            value={`${suggestion.calories.toLocaleString()} kcal`}
          />
        </View>
      )}

      <Typography variant="caption2" color={colors.textSecondary}>
        An estimate from a standard formula, not a measurement of you — it moves if your weight,
        activity level or goal changes, and you can always type your own number instead.
      </Typography>
    </View>
  );
}

function CaloriesInfoStep({ number, text }: { number: number; text: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.caloriesInfoStep}>
      <View style={[styles.caloriesInfoStepBadge, { backgroundColor: colors.pillBackground }]}>
        <Typography variant="caption2" weight="semibold" color={colors.textSecondary}>
          {number}
        </Typography>
      </View>
      <Typography variant="caption2" color={colors.textSecondary} style={styles.caloriesInfoStepText}>
        {text}
      </Typography>
    </View>
  );
}

function CaloriesInfoRow({ label, value }: { label: string; value: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.caloriesInfoRow}>
      <Typography variant="caption2" color={colors.textSecondary}>
        {label}
      </Typography>
      <Typography variant="caption2" weight="semibold" color={colors.textPrimary}>
        {value}
      </Typography>
    </View>
  );
}

/**
 * One compact list row per macro — a colour-coded dot (matching
 * `HealthGoalMacroBar`'s legend), the label, an optional live grams preview
 * (percent mode only) and a right-aligned numeric well. Three of these
 * grouped in one `listWell` replace what used to be three separate
 * full-height bordered fields.
 */
function MacroFieldRow({
  label,
  value,
  onChange,
  unit,
  dotColor,
  grams,
  testID,
  last,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  unit: '%' | 'g';
  dotColor: string;
  grams?: number | null;
  testID: string;
  last?: boolean;
}) {
  const colors = useAppColors();
  return (
    <View
      style={[
        styles.listRow,
        !last && [styles.listRowDivider, { borderColor: colors.borderColor }],
      ]}
    >
      <View style={[styles.macroDot, { backgroundColor: dotColor }]} />
      <View style={styles.macroLabelCol}>
        <Typography variant="subheadline" color={colors.textPrimary}>
          {label}
        </Typography>
        {grams !== null && grams !== undefined && value.length > 0 && (
          <Typography variant="caption2" color={colors.textSecondary} testID={`${testID}-grams`}>
            ≈ {grams.toLocaleString()} g
          </Typography>
        )}
      </View>
      <View style={styles.listRowValue}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="0"
          placeholderTextColor={colors.textSecondary}
          keyboardType="number-pad"
          autoCorrect={false}
          accessibilityLabel={label}
          testID={testID}
          style={[styles.listInput, { color: colors.textPrimary }]}
        />
        <Typography variant="caption1" color={colors.textSecondary} style={styles.listUnit}>
          {unit}
        </Typography>
      </View>
    </View>
  );
}

/**
 * Rich body for the "Quick presets" `InfoButton` — the AMDR reference stated
 * ONCE, then each preset as its own labeled `HealthGoalMacroBar` (the SAME
 * chart the live preview below uses, just rendered against a fixed baseline)
 * plus its own short citation, rather than one paragraph mashing all three
 * splits together.
 */
function MacroPresetInfoBody() {
  const colors = useAppColors();
  return (
    <View style={styles.presetInfo}>
      <View style={[styles.presetReference, { backgroundColor: colors.pillBackground }]}>
        <Icon name="document-text-outline" size={14} color={colors.textSecondary} />
        <Typography
          variant="footnote"
          color={colors.textSecondary}
          style={styles.presetReferenceText}
        >
          {AMDR_REFERENCE}
        </Typography>
      </View>

      {MACRO_PERCENT_PRESETS.map((preset) => {
        const split = macroSplit({
          calories: PRESET_INFO_BASELINE_CALORIES,
          protein: macroGramsFromPercent(preset.percents.protein, PRESET_INFO_BASELINE_CALORIES, 'protein'),
          carbs: macroGramsFromPercent(preset.percents.carbs, PRESET_INFO_BASELINE_CALORIES, 'carbs'),
          fat: macroGramsFromPercent(preset.percents.fat, PRESET_INFO_BASELINE_CALORIES, 'fat'),
        });
        return (
          <View key={preset.key} style={styles.presetInfoRow}>
            <Typography variant="subheadline" weight="semibold" color={colors.textPrimary}>
              {preset.label} — {preset.percents.protein}/{preset.percents.carbs}/{preset.percents.fat}
            </Typography>
            <HealthGoalMacroBar
              split={split}
              testID={`onboarding-health-goals-macro-preset-info-${preset.key}-bar`}
            />
            <Typography
              variant="caption1"
              color={colors.textPrimary}
              testID={`onboarding-health-goals-macro-preset-info-${preset.key}-good-for`}
            >
              Good for: {preset.goodFor}
            </Typography>
            <Typography variant="caption2" color={colors.textSecondary}>
              {MACRO_PRESET_CITATIONS[preset.key]}
            </Typography>
          </View>
        );
      })}

      <Typography variant="caption2" color={colors.textSecondary} style={styles.presetInfoFooter}>
        Starting points, not medical advice — change anything, or type your own split.
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  cardHeaderTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  subSection: {
    gap: Spacing.xs,
  },
  valueWell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: 52,
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    paddingHorizontal: Spacing.md,
  },
  valueInput: {
    flex: 1,
    ...scaledFont('titleSmall'),
    fontWeight: '700',
  },
  valueInputEmpty: {
    flex: 1,
    ...scaledFont('body'),
  },
  listWell: {
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    overflow: 'hidden',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
  },
  listRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  listRowValue: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  listInput: {
    minWidth: 44,
    textAlign: 'right',
    padding: 0,
    ...scaledFont('bodyMedium'),
  },
  // `bodyMedium` (22 line-height) sits next to `caption1` (16) inside a
  // `flex-end`-aligned row — without this the caption's shorter line box
  // still leaves it looking raised relative to the value it's labelling.
  listUnit: {
    paddingBottom: 2,
  },
  macroDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  macroLabelCol: {
    flex: 1,
    gap: 1,
  },
  calc: {
    gap: Spacing.xs,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  weekEditor: {
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  presetInfo: { gap: Spacing.md },
  presetReference: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    padding: Spacing.sm,
    borderRadius: CornerRadius.sm,
  },
  presetReferenceText: { flex: 1 },
  presetInfoRow: { gap: Spacing.xs },
  presetInfoFooter: { paddingTop: Spacing.xs },
  caloriesInfo: { gap: Spacing.md },
  caloriesInfoSteps: { gap: Spacing.sm },
  caloriesInfoStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
  },
  caloriesInfoStepBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caloriesInfoStepText: { flex: 1 },
  caloriesInfoFigures: {
    gap: Spacing.xs,
    padding: Spacing.sm,
    borderRadius: CornerRadius.sm,
  },
  caloriesInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
