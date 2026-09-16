import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';

import { CornerRadius, getButtonGradientColors, useAppColors, type AppColors } from '@theme';

interface OnboardingProgressProps {
  currentStep: number;
  totalSteps: number;
  stepLabel: string;
}

/**
 * Slim gradient progress bar shared by every onboarding flow (House, the
 * child-brand welcome + permissions flow, Symply Health's goals mini-flow,
 * and Language). Matches Symply Health's original bar chrome — the step
 * label is a11y-only, never printed, so there is no "Step X of Y: Label"
 * caption cluttering the screen.
 */
export function OnboardingProgress({ currentStep, totalSteps, stepLabel }: OnboardingProgressProps) {
  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // A single-step flow (child brands) has no progress to show — the bar
  // would just read as decoration, so render nothing and reclaim the space.
  if (totalSteps <= 1) {
    return null;
  }
  const progress = (currentStep + 1) / totalSteps;
  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${currentStep + 1} of ${totalSteps}: ${stepLabel}`}
    >
      <View style={styles.track}>
        <LinearGradient
          colors={getButtonGradientColors('primary')}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fill, { width: `${progress * 100}%` }]}
        />
      </View>
    </View>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    container: {
      paddingTop: 16,
      paddingBottom: 12,
      paddingHorizontal: 24,
    },
    track: {
      height: 6,
      borderRadius: CornerRadius.full,
      overflow: 'hidden',
      backgroundColor: colors.pillBackground,
    },
    fill: {
      height: '100%',
      borderRadius: CornerRadius.full,
    },
  });
