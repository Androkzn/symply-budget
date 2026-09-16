import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useState } from 'react';

import {
  OnboardingChoiceChips,
  OnboardingStepScreen,
  OnboardingWheelNumberField,
} from '@components/onboarding';
import {
  loadHealthPrefs,
  parseWeightInput,
  sanitizeWeightInput,
  WEIGHT_WHEEL_BOUNDS,
  WEIGHT_WHEEL_STEP,
  type WeightUnit,
} from '@features/health/healthLocalStorage';
import { saveWeightGoal, type HealthWeightGoalType } from '@features/health/healthWeightStorage';
import type { OnboardingStackParamList } from '@navigation/types';

type NavigationProp = NativeStackNavigationProp<OnboardingStackParamList, 'HealthGoalsWeight'>;
type RouteProps = RouteProp<OnboardingStackParamList, 'HealthGoalsWeight'>;

const GOAL_TYPES: { key: HealthWeightGoalType; label: string }[] = [
  { key: 'lose', label: 'Lose' },
  { key: 'maintain', label: 'Maintain' },
  { key: 'gain', label: 'Gain' },
];

/**
 * Symply Health goals mini-flow, step 2 of 7 — the weight goal. Writes
 * through `saveWeightGoal`, the SAME module the Weight tab and the in-app
 * Goals screen use, so a target set here shows up there immediately.
 *
 * Picking a goal type alone (no numbers typed) is a legitimate save on its
 * own — "Lose" with no target yet is still useful context for later. Nothing
 * here is required to advance.
 */
export function HealthGoalsWeightScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();

  const [goalType, setGoalType] = useState<HealthWeightGoalType | null>(null);
  const [target, setTarget] = useState('');
  const [starting, setStarting] = useState('');
  const [startingTouched, setStartingTouched] = useState(false);
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadHealthPrefs().then((prefs) => setUnit(prefs.preferredUnit));
  }, []);

  const advance = () => navigation.navigate('HealthGoalsNutrition', route.params);

  const handleContinue = async () => {
    const targetValue = parseWeightInput(target);
    const startingValue = parseWeightInput(starting);

    if (goalType === null && targetValue === null && startingValue === null) {
      advance();
      return;
    }

    setSaving(true);
    try {
      await saveWeightGoal({
        goalType,
        unit,
        ...(targetValue !== null ? { target: targetValue } : {}),
        ...(startingValue !== null ? { starting: startingValue } : {}),
      });
    } catch {
      // `saveWeightGoal` already queues the write for offline retry — a
      // failed request here must not stand between the member and the next step.
    } finally {
      setSaving(false);
      advance();
    }
  };

  return (
    <OnboardingStepScreen
      testID="onboarding-health-goals-weight-screen"
      title="Weight goal"
      subtitle="What are you aiming for? A target and a starting point are both optional."
      currentStep={2}
      totalSteps={8}
      stepLabel="Weight"
      icon="scale-outline"
      onBack={() => navigation.goBack()}
      onContinue={() => void handleContinue()}
      continueBusy={saving}
    >
      <OnboardingChoiceChips
        options={GOAL_TYPES}
        selected={goalType}
        onSelect={(key) => setGoalType(goalType === key ? null : (key as HealthWeightGoalType))}
        testIDPrefix="onboarding-health-goals-weight-type"
        accessibilityLabelPrefix="Weight goal"
        equalWidth
      />

      <OnboardingWheelNumberField
        label={`Target weight (${unit})`}
        value={target}
        onChange={(text) => {
          const sanitized = sanitizeWeightInput(text);
          setTarget(sanitized);
          if (!startingTouched) {
            setStarting(sanitized);
          }
        }}
        min={WEIGHT_WHEEL_BOUNDS[unit].min}
        max={WEIGHT_WHEEL_BOUNDS[unit].max}
        step={WEIGHT_WHEEL_STEP}
        defaultValue={WEIGHT_WHEEL_BOUNDS[unit].defaultValue}
        unitLabel={unit}
        splitDecimal
        icon="flag-outline"
        placeholder="Tap to select target weight"
        testID="onboarding-health-goals-target-weight-input"
      />
      <OnboardingWheelNumberField
        label={`Starting weight (${unit})`}
        value={starting}
        onChange={(text) => {
          setStartingTouched(true);
          setStarting(sanitizeWeightInput(text));
        }}
        min={WEIGHT_WHEEL_BOUNDS[unit].min}
        max={WEIGHT_WHEEL_BOUNDS[unit].max}
        step={WEIGHT_WHEEL_STEP}
        defaultValue={WEIGHT_WHEEL_BOUNDS[unit].defaultValue}
        unitLabel={unit}
        splitDecimal
        icon="body-outline"
        placeholder="Tap to select starting weight"
        testID="onboarding-health-goals-starting-weight-input"
      />
    </OnboardingStepScreen>
  );
}
