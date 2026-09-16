import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  OnboardingChoiceChips,
  OnboardingStepScreen,
  OnboardingSuggestionBanner,
  OnboardingWheelNumberField,
} from '@components/onboarding';
import { InfoButton, Typography, type InfoSource } from '@components/ui';
import { saveActivityGoals, type ActivityGoals } from '@features/health/healthActivityStorage';
import {
  GOAL_BOUNDS,
  MINUTES_BY_LEVEL,
  parseWholeNumber,
  sanitizeWholeNumber,
  STEPS_BY_LEVEL,
} from '@features/health/healthGoalsStorage';
import { ACTIVITY_LABELS } from '@features/health/healthWeightAnalytics';
import { useSuggestedGoals } from '@features/health/useHealthGoalsSuggestion';
import type { OnboardingStackParamList } from '@navigation/types';
import { Spacing, useAppColors } from '@theme';

type NavigationProp = NativeStackNavigationProp<OnboardingStackParamList, 'HealthGoalsActivity'>;
type RouteProps = RouteProp<OnboardingStackParamList, 'HealthGoalsActivity'>;

const STEP_PRESETS = [6000, 8000, 10000, 12000].map((value) => ({
  key: String(value),
  label: value.toLocaleString(),
}));
const MINUTE_PRESETS = [20, 30, 45, 60].map((value) => ({
  key: String(value),
  label: `${value} min`,
}));

/** Backs the "Suggested for you" info sheet's per-activity-level reference table below. */
const ACTIVITY_LEVELS_IN_ORDER = Object.keys(ACTIVITY_LABELS) as (keyof typeof ACTIVITY_LABELS)[];

const ACTIVITY_SUGGESTION_SOURCES: InfoSource[] = [
  {
    label:
      'Bull et al. (2020) — World Health Organization 2020 guidelines on physical activity and sedentary behaviour, Br J Sports Med',
    url: 'https://doi.org/10.1136/bjsports-2020-102955',
  },
  {
    label:
      'Tudor-Locke & Bassett (2004) — How many steps/day are enough? Preliminary pedometer indices for public health, Sports Medicine',
    url: 'https://doi.org/10.2165/00007256-200434010-00001',
  },
];

/**
 * Wheel ranges well short of `GOAL_BOUNDS`' validation ceilings (200,000
 * steps / 1,440 minutes) — a realistic picking range, same idea as the
 * weight wheel's narrower-than-storage-bound span. "Enter manually" covers
 * anything outside it.
 */
const STEPS_WHEEL_MIN = 1000;
const STEPS_WHEEL_MAX = 30000;
const STEPS_WHEEL_STEP = 250;
const MINUTES_WHEEL_MAX = 180;

function clampedOrNull(raw: string, bound: { min: number; max: number }): number | null {
  const value = parseWholeNumber(raw);
  if (value === null) return null;
  return Math.min(bound.max, Math.max(bound.min, value));
}

/**
 * Symply Health goals mini-flow, step 4 of 7 — daily steps and movement
 * minutes. Writes through `saveActivityGoals`, the SAME module the Activity
 * tab's step target reads from.
 *
 * A "Suggested for you" banner appears once `useSuggestedGoals()` has an
 * answer — see that hook's own header for what it needs.
 */
export function HealthGoalsActivityScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const suggestion = useSuggestedGoals();

  const [steps, setSteps] = useState('');
  const [minutes, setMinutes] = useState('');
  const [saving, setSaving] = useState(false);

  const advance = () => navigation.navigate('HealthGoalsWater', route.params);

  const applySuggestion = () => {
    if (suggestion === null) return;
    setSteps(String(suggestion.steps));
    setMinutes(String(suggestion.minutes));
  };

  const handleContinue = async () => {
    const patch: Partial<ActivityGoals> = {};
    const stepTarget = clampedOrNull(steps, GOAL_BOUNDS.steps);
    const minuteTarget = clampedOrNull(minutes, GOAL_BOUNDS.minutes);
    if (stepTarget !== null) patch.steps = stepTarget;
    if (minuteTarget !== null) patch.minutes = minuteTarget;

    if (Object.keys(patch).length === 0) {
      advance();
      return;
    }

    setSaving(true);
    try {
      await saveActivityGoals(patch);
    } catch {
      // `saveActivityGoals` already queues the write for offline retry.
    } finally {
      setSaving(false);
      advance();
    }
  };

  return (
    <OnboardingStepScreen
      testID="onboarding-health-goals-activity-screen"
      title="Activity"
      subtitle="A daily step target and how many minutes of movement you're aiming for. Both optional."
      currentStep={4}
      totalSteps={8}
      stepLabel="Activity"
      icon="walk-outline"
      onBack={() => navigation.goBack()}
      onContinue={() => void handleContinue()}
      continueBusy={saving}
    >
      {suggestion && (
        <OnboardingSuggestionBanner
          description={`${suggestion.steps.toLocaleString()} steps · ${suggestion.minutes} min a day, based on your activity level.`}
          onApply={applySuggestion}
          testID="onboarding-health-goals-activity-suggestion"
          info={
            <InfoButton
              title="Suggested for you"
              sources={ACTIVITY_SUGGESTION_SOURCES}
              testID="onboarding-health-goals-activity-suggestion-info"
            >
              <ActivitySuggestionInfoBody />
            </InfoButton>
          }
        />
      )}

      <OnboardingWheelNumberField
        label="Daily steps"
        value={steps}
        onChange={(text) => setSteps(sanitizeWholeNumber(text))}
        min={STEPS_WHEEL_MIN}
        max={STEPS_WHEEL_MAX}
        step={STEPS_WHEEL_STEP}
        defaultValue={8000}
        unitLabel="steps"
        icon="footsteps-outline"
        placeholder="Tap to select daily steps"
        testID="onboarding-health-goals-steps-input"
      />
      <OnboardingChoiceChips
        options={STEP_PRESETS}
        selected={null}
        onSelect={(key) => setSteps(key)}
        testIDPrefix="onboarding-health-goals-steps-preset"
      />

      <OnboardingWheelNumberField
        label="Movement minutes a day"
        value={minutes}
        onChange={(text) => setMinutes(sanitizeWholeNumber(text))}
        min={GOAL_BOUNDS.minutes.min}
        max={MINUTES_WHEEL_MAX}
        step={5}
        defaultValue={30}
        unitLabel="min"
        icon="timer-outline"
        placeholder="Tap to select movement minutes"
        testID="onboarding-health-goals-minutes-input"
      />
      <OnboardingChoiceChips
        options={MINUTE_PRESETS}
        selected={null}
        onSelect={(key) => setMinutes(key)}
        testIDPrefix="onboarding-health-goals-minutes-preset"
      />
    </OnboardingStepScreen>
  );
}

/**
 * Rich body for the "Suggested for you" `InfoButton` on this screen's
 * banner — unlike calories (a per-member formula), steps and minutes are
 * both flat LOOKUP tables keyed by activity level, so there is nothing
 * member-specific to compute here; the table below IS the whole method,
 * shown for every level so a member can see where their own row sits.
 */
function ActivitySuggestionInfoBody() {
  const colors = useAppColors();
  return (
    <View style={styles.info}>
      <Typography variant="caption2" color={colors.textSecondary}>
        Daily steps and movement minutes are each a target set from the activity level you chose
        on the "About you" step — not a formula run on your own data, the way calories is.
      </Typography>

      <Typography variant="caption2" color={colors.textSecondary}>
        Steps follow the activity bands pedometer research uses to classify daily movement.
        Minutes follow WHO's adult guideline of 150–300 minutes of moderate-intensity activity a
        week, spread across the week and scaled by activity level.
      </Typography>

      <View style={[styles.table, { borderColor: colors.borderColor }]}>
        {ACTIVITY_LEVELS_IN_ORDER.map((level, index) => (
          <View
            key={level}
            style={[
              styles.tableRow,
              index < ACTIVITY_LEVELS_IN_ORDER.length - 1 && [
                styles.tableRowDivider,
                { borderColor: colors.borderColor },
              ],
            ]}
          >
            <Typography variant="caption1" color={colors.textPrimary} style={styles.tableLabel}>
              {ACTIVITY_LABELS[level]}
            </Typography>
            <Typography variant="caption2" color={colors.textSecondary}>
              {STEPS_BY_LEVEL[level].toLocaleString()} steps · {MINUTES_BY_LEVEL[level]} min
            </Typography>
          </View>
        ))}
      </View>

      <Typography variant="caption2" color={colors.textSecondary}>
        Starting points, not a prescription — change either target, or your activity level on the
        "About you" step, any time.
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  info: { gap: Spacing.md },
  table: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  tableRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableLabel: { flexShrink: 0 },
});
