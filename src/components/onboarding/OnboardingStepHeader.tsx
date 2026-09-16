import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { BackButton, HeaderLogo } from '@components/common';
import {
  BackButtonChrome,
  CornerRadius,
  Header,
  Spacing,
  getButtonGradientColors,
  useAppColors,
} from '@theme';

interface OnboardingStepHeaderProps {
  /** Prefix for this step's control ids — `<testID>-back` / `-forward` / `-dots`. */
  testID: string;
  currentStep: number;
  totalSteps: number;
  stepLabel: string;
  onBack: () => void;
  /**
   * Advance without acting on the step — the header twin of its "Skip"
   * button. Omit on a step that has nowhere to go yet (a required answer is
   * still missing) or nowhere to go at all (the flow's last screen), and the
   * chevron is replaced by a spacer so the lockup stays centred.
   */
  onForward?: () => void;
  /** Greys the forward chevron while the step is mid-save. */
  forwardDisabled?: boolean;
}

/**
 * The back / brand / forward row every onboarding step wears, with its
 * progress bar directly underneath.
 *
 * Extracted from `OnboardingStepScreen`, which still renders it and is
 * unchanged by the move. It exists on its own because House's household steps
 * cannot adopt that whole shell — each one owns its scroll content and its own
 * footer buttons — and they were the screens with no way back at all: a member
 * who reached "Set Up Your Spaces" could not return to the home they had just
 * named, and the only exit from the wizard was to finish it or kill the app.
 *
 * Both arrows are chrome, never the step's own action: forward is the same
 * "carry on without answering" its Skip button offers, so a member who has
 * decided nothing loses nothing by using it.
 */
export function OnboardingStepHeader({
  testID,
  currentStep,
  totalSteps,
  stepLabel,
  onBack,
  onForward,
  forwardDisabled = false,
}: OnboardingStepHeaderProps) {
  return (
    <>
      <View style={styles.headerRow} testID={`${testID}-header`}>
        <BackButton onPress={onBack} testID={`${testID}-back`} />
        <HeaderLogo height={Header.logoHeight} centered />
        {onForward ? (
          <BackButton
            icon="chevron-forward"
            onPress={onForward}
            disabled={forwardDisabled}
            testID={`${testID}-forward`}
          />
        ) : (
          // Keeps the logo centred (the row is `space-between`) without a
          // tappable "next" on a step that has none to offer.
          <View style={styles.forwardSpacer} />
        )}
      </View>
      <OnboardingStepProgress
        currentStep={currentStep}
        totalSteps={totalSteps}
        stepLabel={stepLabel}
        testID={`${testID}-dots`}
      />
    </>
  );
}

/** Slim gradient progress bar below the header row — the label is a11y-only, never printed. */
export function OnboardingStepProgress({
  currentStep,
  totalSteps,
  stepLabel,
  testID,
}: {
  currentStep: number;
  totalSteps: number;
  stepLabel: string;
  testID: string;
}) {
  const colors = useAppColors();
  // A single-step flow has no progress to show — a full bar would just read
  // as decoration, so render nothing and reclaim the vertical space (matches
  // `OnboardingProgress`'s same rule).
  if (totalSteps <= 1) {
    return null;
  }
  const progress = (currentStep + 1) / totalSteps;
  return (
    <View
      style={styles.progressRow}
      testID={testID}
      accessible
      accessibilityLabel={`Step ${currentStep + 1} of ${totalSteps}: ${stepLabel}`}
      accessibilityRole="progressbar"
    >
      <View style={[styles.progressTrack, { backgroundColor: colors.pillBackground }]}>
        <LinearGradient
          colors={getButtonGradientColors('primary')}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.progressFill, { width: `${progress * 100}%` }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
  },
  progressRow: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  progressTrack: {
    height: 6,
    borderRadius: CornerRadius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: CornerRadius.full,
  },
  forwardSpacer: {
    width: BackButtonChrome.md.size,
    height: BackButtonChrome.md.size,
  },
});
