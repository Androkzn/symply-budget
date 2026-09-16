import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { HEALTH_ACTIVITY_LEVELS, type HealthActivityLevel } from '@api/health';
import {
  OnboardingChoiceChips,
  OnboardingStepScreen,
  OnboardingWheelNumberField,
  OnboardingWheelSelectField,
} from '@components/onboarding';
import { Button, Icon, InfoButton, Typography } from '@components/ui';
import { HealthScienceInfoSheet } from '@features/health/components/HealthScienceInfoSheet';
import {
  MINUTES_BY_LEVEL,
  sanitizeWholeNumber,
  STEPS_BY_LEVEL,
} from '@features/health/healthGoalsStorage';
import {
  heightUnitFor,
  loadHealthPrefs,
  setUnitSystem,
  type HealthUnitSystem,
  type HeightUnit,
} from '@features/health/healthLocalStorage';
import { ACTIVITY_LABELS } from '@features/health/healthWeightAnalytics';
import {
  heightInUnit,
  heightToCm,
  saveWeightGoal,
  type HealthGender,
} from '@features/health/healthWeightStorage';
import type { OnboardingStackParamList } from '@navigation/types';
import { Spacing, useAppColors } from '@theme';

type NavigationProp = NativeStackNavigationProp<OnboardingStackParamList, 'HealthGoalsBiometrics'>;
type RouteProps = RouteProp<OnboardingStackParamList, 'HealthGoalsBiometrics'>;

const UNIT_SYSTEMS: { key: HealthUnitSystem; label: string }[] = [
  { key: 'metric', label: 'Metric (kg, cm, km)' },
  { key: 'imperial', label: 'Imperial (lb, ft/in, mi)' },
];

const GENDERS: { key: HealthGender; label: string }[] = [
  { key: 'female', label: 'Female' },
  { key: 'male', label: 'Male' },
  { key: 'other', label: 'Other' },
];

/**
 * What each level means — standard exercise-frequency wording (the same
 * descriptors Mifflin–St Jeor calculators everywhere use), not a
 * Symply-specific scale.
 */
const ACTIVITY_LEVEL_EXERCISE_TEXT: Record<HealthActivityLevel, string> = {
  sedentary: 'Little or no exercise, a desk job',
  lightlyActive: 'Light exercise or sports 1–3 days a week',
  moderatelyActive: 'Moderate exercise or sports 3–5 days a week',
  veryActive: 'Hard exercise or sports 6–7 days a week',
  extraActive: 'Very hard exercise, a physical job, or training twice a day',
};

/**
 * A concrete, checkable metric alongside the exercise wording above — someone
 * staring at "moderately active" vs. "very active" with no idea which is them
 * can instead compare against a number they already know (their phone's step
 * count, or the Health app's Move data). Derived from `STEPS_BY_LEVEL`
 * (`healthGoalsStorage.ts`) rather than hand-typed, so this hint can never
 * drift from the actual daily-step target picking that level sets later.
 */
function stepsHintFor(level: HealthActivityLevel): string {
  const index = HEALTH_ACTIVITY_LEVELS.indexOf(level);
  const upper = STEPS_BY_LEVEL[level].toLocaleString();
  if (index === 0) return `usually under ${upper} steps a day`;
  const lower = STEPS_BY_LEVEL[HEALTH_ACTIVITY_LEVELS[index - 1]].toLocaleString();
  if (index === HEALTH_ACTIVITY_LEVELS.length - 1) return `${lower}+ steps a day`;
  return `roughly ${lower}–${upper} steps a day`;
}

/**
 * What each level means, and what picking it actually changes elsewhere in
 * the app — the `ActivityLevelInfoBody` sheet below, one entry per level.
 * Combines the exercise wording with the step-count hint so the single line
 * `OptionWheelPickerSheet` shows live under the wheel carries both.
 */
const ACTIVITY_LEVEL_DESCRIPTIONS: Record<HealthActivityLevel, string> = HEALTH_ACTIVITY_LEVELS.reduce(
  (acc, level) => {
    acc[level] = `${ACTIVITY_LEVEL_EXERCISE_TEXT[level]} — ${stepsHintFor(level)}.`;
    return acc;
  },
  {} as Record<HealthActivityLevel, string>
);

/** One glyph per level, rising in intensity — shown next to the description on the wheel itself. */
const ACTIVITY_LEVEL_ICONS: Record<HealthActivityLevel, string> = {
  sedentary: 'bed',
  lightlyActive: 'walk',
  moderatelyActive: 'bicycle',
  veryActive: 'barbell',
  extraActive: 'flame',
};

/**
 * `description`/`icon` drive the live panel `OptionWheelPickerSheet` renders
 * below its wheel — the same two lookups the static `ActivityLevelInfoBody`
 * sheet below already uses, just keyed onto the option list instead of a
 * separate render.
 */
const ACTIVITY_LEVELS: { key: HealthActivityLevel; label: string; description: string; icon: string }[] =
  HEALTH_ACTIVITY_LEVELS.map((level) => ({
    key: level,
    label: ACTIVITY_LABELS[level],
    description: ACTIVITY_LEVEL_DESCRIPTIONS[level],
    icon: ACTIVITY_LEVEL_ICONS[level],
  }));

const MIN_AGE = 1;
const MAX_AGE = 120;

/** Wheel range per unit — a realistic adult height span, whole units only. */
const HEIGHT_WHEEL_BOUNDS: Record<HeightUnit, { min: number; max: number; defaultValue: number }> = {
  cm: { min: 100, max: 230, defaultValue: 170 },
  in: { min: 39, max: 91, defaultValue: 67 },
};

/** Age is what the member types; `birthYear` is what the route stores. */
function birthYearFromAge(raw: string): number | null {
  const age = parseInt(raw, 10);
  if (!Number.isFinite(age) || age < MIN_AGE || age > MAX_AGE) return null;
  return new Date().getFullYear() - age;
}

/**
 * Symply Health goals mini-flow, step 1 of 7 — "About you": gender, age,
 * height and activity level. Writes through `saveWeightGoal`, the SAME
 * module the Weight tab's "Goal & body details" section uses.
 *
 * MOVED TO THE FRONT of the mini-flow (it used to be last) so every screen
 * after this one can show a real, personalised suggestion instead of a
 * generic preset row: `suggestGoals()` (`healthGoalsStorage.ts`) needs
 * weight + height + age + gender + activity level, all five, or it refuses
 * to guess rather than default a missing one — see its own header comment.
 * Height and activity level are NEW here (donor parity: they already existed
 * on `health_goals`, but nothing before this asked for them in onboarding,
 * only in the Weight tab, which meant the calorie/step/water suggestions on
 * the in-app Goals screen were unreachable for anyone who had not separately
 * visited Weight → "Goal & body details"). Weight itself is asked on the
 * NEXT step, which is why calories/steps/water cannot be suggested here yet
 * — this screen only clears four of the five inputs.
 *
 * Nothing here is required to advance — every field is skippable, and a
 * member who skips one simply sees no suggestion later rather than a
 * suggestion built on a guess.
 */
export function HealthGoalsBiometricsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();

  const [unitSystem, setUnitSystemState] = useState<HealthUnitSystem>('metric');
  const [unitSystemTouched, setUnitSystemTouched] = useState(false);
  const [gender, setGender] = useState<HealthGender | null>(null);
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [activityLevel, setActivityLevel] = useState<HealthActivityLevel | null>(null);
  const [saving, setSaving] = useState(false);
  const [scienceInfoVisible, setScienceInfoVisible] = useState(false);

  useEffect(() => {
    void loadHealthPrefs().then((prefs) => setUnitSystemState(prefs.unitSystem));
  }, []);

  const heightUnit = heightUnitFor(unitSystem);

  const handleUnitSystemChange = (system: HealthUnitSystem) => {
    // Convert whatever height is already typed so switching units mid-entry
    // doesn't silently change the member's actual height.
    if (height.length > 0) {
      const cm = heightToCm(Number(height), heightUnit);
      setHeight(String(heightInUnit(cm, heightUnitFor(system))));
    }
    setUnitSystemTouched(true);
    setUnitSystemState(system);
  };

  const advance = () => navigation.navigate('HealthGoalsWeight', route.params);

  const handleContinue = async () => {
    const birthYear = birthYearFromAge(age);
    const heightCm = height.length > 0 ? heightToCm(Number(height), heightUnit) : null;

    if (
      gender === null &&
      birthYear === null &&
      heightCm === null &&
      activityLevel === null &&
      !unitSystemTouched
    ) {
      advance();
      return;
    }

    setSaving(true);
    try {
      await Promise.all([
        saveWeightGoal({
          ...(gender !== null ? { gender } : {}),
          ...(birthYear !== null ? { birthYear } : {}),
          ...(heightCm !== null ? { heightCm } : {}),
          ...(activityLevel !== null ? { activityLevel } : {}),
        }),
        ...(unitSystemTouched ? [setUnitSystem(unitSystem)] : []),
      ]);
    } catch {
      // `saveWeightGoal`/`setUnitSystem` already queue the write for offline retry.
    } finally {
      setSaving(false);
      advance();
    }
  };

  return (
    <OnboardingStepScreen
      testID="onboarding-health-goals-biometrics-screen"
      title="About you"
      subtitle="Gender, age, height and activity level power the personalised calorie, step and water suggestions on the next few steps. Optional, and never shared with anyone else."
      currentStep={1}
      totalSteps={8}
      stepLabel="About you"
      icon="body-outline"
      onBack={() => navigation.goBack()}
      onContinue={() => void handleContinue()}
      continueBusy={saving}
    >
      <OnboardingWheelSelectField
        label="Gender"
        options={GENDERS}
        value={gender}
        onChange={setGender}
        icon="profile"
        placeholder="Tap to select gender"
        testID="onboarding-health-goals-gender"
        accessibilityLabel="Gender"
        infoButton={
          <InfoButton
            title="Gender"
            testID="onboarding-health-goals-gender-info"
            accessibilityLabel="About gender"
            info="Gender changes your estimated calorie burn (BMR) — the same baseline age and height feed into — so filling it in gives you a more accurate calorie, step and water suggestion later in setup."
          />
        }
      />
      <OnboardingWheelNumberField
        label="Age"
        value={age}
        onChange={(text) => setAge(sanitizeWholeNumber(text).slice(0, 3))}
        min={MIN_AGE}
        max={MAX_AGE}
        step={1}
        defaultValue={30}
        icon="time-outline"
        placeholder="Tap to select age"
        testID="onboarding-health-goals-age-input"
        infoButton={
          <InfoButton
            title="Age"
            testID="onboarding-health-goals-age-info"
            accessibilityLabel="About age"
            info="Age shifts your estimated calorie burn (BMR) alongside gender and height, so it directly shapes your personalised calorie, step and water suggestions."
          />
        }
      />
      <OnboardingWheelNumberField
        label={heightUnit === 'in' ? 'Height (in)' : 'Height (cm)'}
        value={height}
        onChange={(text) => setHeight(sanitizeWholeNumber(text).slice(0, 3))}
        min={HEIGHT_WHEEL_BOUNDS[heightUnit].min}
        max={HEIGHT_WHEEL_BOUNDS[heightUnit].max}
        step={1}
        defaultValue={HEIGHT_WHEEL_BOUNDS[heightUnit].defaultValue}
        unitLabel={heightUnit}
        icon="height"
        placeholder="Tap to select height"
        // Surfaced up front — the Metric/Imperial switch itself only lives
        // inside this field's wheel sheet (below), which nobody opens who
        // skips height. Showing the CURRENT choice here, tappable to the same
        // sheet, is what makes it discoverable at all.
        accessoryHint={unitSystem === 'imperial' ? 'Imperial' : 'Metric'}
        testID="onboarding-health-goals-height-input"
        infoButton={
          <InfoButton
            title="Height"
            testID="onboarding-health-goals-height-info"
            accessibilityLabel="About height"
            info="Height feeds into the same calorie-burn estimate (BMR) as age and gender, so it directly shapes your personalised calorie, step and water suggestions."
          />
        }
        accessory={
          <OnboardingChoiceChips
            options={UNIT_SYSTEMS}
            selected={unitSystem}
            onSelect={(key) => handleUnitSystemChange(key as HealthUnitSystem)}
            testIDPrefix="onboarding-health-goals-unit-system"
            accessibilityLabelPrefix="Units"
            variant="segmented"
          />
        }
      />
      <OnboardingWheelSelectField
        label="Activity level"
        options={ACTIVITY_LEVELS}
        value={activityLevel}
        onChange={setActivityLevel}
        icon={activityLevel ? ACTIVITY_LEVEL_ICONS[activityLevel] : 'activity-tab'}
        placeholder="Tap to select activity level"
        testID="onboarding-health-goals-activity-level"
        accessibilityLabel="Activity level"
        infoButton={
          <InfoButton
            title="Activity level"
            testID="onboarding-health-goals-activity-level-info"
            accessibilityLabel="About activity level"
          >
            <ActivityLevelInfoBody />
          </InfoButton>
        }
      />
      <View style={styles.scienceLink}>
        <Button
          title="The science behind these numbers"
          variant="ghost"
          size="sm"
          onPress={() => setScienceInfoVisible(true)}
          testID="onboarding-health-goals-science-link"
          accessibilityLabel="The science behind gender, age, height and activity level"
          fullWidth
        />
      </View>
      <HealthScienceInfoSheet
        visible={scienceInfoVisible}
        onClose={() => setScienceInfoVisible(false)}
      />
    </OnboardingStepScreen>
  );
}

/**
 * The five levels, one line each on what they mean plus two checkable
 * metrics (typical daily steps, minutes of movement most days) so someone
 * unsure which one is them can match against a number instead of guessing
 * from adjectives alone. Also explains how the pick is actually used: it is
 * the multiplier that turns a calculated BMR into a calorie target
 * (`ACTIVITY_MULTIPLIERS`), and separately sets the suggested daily steps,
 * movement minutes and water target on the steps after this one
 * (`STEPS_BY_LEVEL` / `MINUTES_BY_LEVEL` / `WATER_ML_PER_KG` in
 * `healthGoalsStorage.ts`) — a harder-training pick suggests more of all
 * three, not just more calories.
 */
function ActivityLevelInfoBody() {
  const colors = useAppColors();
  return (
    <View style={styles.infoBody}>
      <Typography variant="caption1" color={colors.textSecondary}>
        Not sure which is you? Match against your typical week — the steps and minutes below are
        rough guides, not a strict cutoff.
      </Typography>
      {ACTIVITY_LEVELS.map((level) => (
        <View key={level.key} style={styles.infoRow}>
          <Typography variant="subheadline" weight="semibold" color={colors.textPrimary}>
            {level.label}
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            {`${ACTIVITY_LEVEL_EXERCISE_TEXT[level.key]}.`}
          </Typography>
          <View style={styles.infoMetrics}>
            <View style={styles.infoMetric}>
              <Icon name="footsteps-outline" size={13} color={colors.textTertiary} />
              <Typography variant="caption2" color={colors.textTertiary}>
                {stepsHintFor(level.key)}
              </Typography>
            </View>
            <View style={styles.infoMetric}>
              <Icon name="time-outline" size={13} color={colors.textTertiary} />
              <Typography variant="caption2" color={colors.textTertiary}>
                {`~${MINUTES_BY_LEVEL[level.key]} min of movement most days`}
              </Typography>
            </View>
          </View>
        </View>
      ))}
      <Typography variant="caption2" color={colors.textSecondary} style={styles.infoFooter}>
        This also sets the suggested daily steps, movement minutes and water target on the steps
        after this one — a more active pick suggests more of all three, not just more calories.
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  scienceLink: {
    paddingTop: Spacing.sm,
  },
  infoBody: {
    gap: Spacing.md,
  },
  infoRow: {
    gap: 2,
  },
  infoMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    paddingTop: 2,
  },
  infoMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  infoFooter: {
    paddingTop: Spacing.xs,
  },
});
