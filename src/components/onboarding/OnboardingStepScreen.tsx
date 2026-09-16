import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';

import {
  AppBackground,
  SafeAreaView,
  ScreenFooterGlass,
  screenScrollViewStyle,
} from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Button, Icon, Typography } from '@components/ui';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import {
  Elevation,
  Layout,
  Opacity,
  Spacing,
  getButtonGradientColors,
  useAppColors,
} from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { OnboardingStepHeader } from './OnboardingStepHeader';

interface OnboardingStepScreenProps {
  testID: string;
  title: string;
  subtitle?: string;
  currentStep: number;
  totalSteps: number;
  stepLabel: string;
  onBack: () => void;
  onContinue: () => void;
  continueLabel?: string;
  continueBusy?: boolean;
  /** Block Continue (footer button + header chevron) until the caller's own validation passes — e.g. a required tile selection, or a wizard sub-step's field gate. Omit for the default "always advanceable" behavior every other step in this shell uses. */
  continueDisabled?: boolean;
  /** Hide the header's forward-chevron shortcut — e.g. the flow's last step, where "Continue" reads as "Finish". */
  showForwardChevron?: boolean;
  /** Ionicons/brand-kit glyph shown in a gradient badge above the title — a hero moment for the step, e.g. "profile". Omit for no badge. */
  icon?: string;
  children?: React.ReactNode;
}

/**
 * Shared chrome for a multi-step onboarding sub-flow (Symply Health's goals
 * setup, currently the only user).
 *
 * The header is a `SafeAreaView`-anchored row — back arrow, brand lockup,
 * forward arrow — sitting clear of the status bar/notch rather than a fixed
 * pixel offset, which is what let a bare-padding version of this collide
 * with the clock on notched phones. The progress bar lives on its own row
 * directly below the header, rather than crowded between the two arrows,
 * so it reads as a distinct progress indicator. Both arrows and the
 * "Continue" button below drive the SAME `onContinue`, so it does not
 * matter which control a member taps. Going back pops to the previous step
 * with its draft still intact (native-stack keeps pushed screens mounted).
 *
 * `onContinue` is greyed out while `continueBusy` mid-save, and optionally
 * blocked outright via `continueDisabled` — most steps in a flow built on
 * this are meant to be skippable (so bounds/blank checks default to living
 * with the caller, not this shell), but a few genuinely require an answer
 * before advancing (e.g. Kaizen's "pick at least one system" step), and
 * `continueDisabled` is how a caller opts into that instead.
 *
 * "Continue" is a FLOATING footer, not the last item in the scrolling stack —
 * the same pinned-CTA-over-`ScreenFooterGlass` recipe `AIFlowScaffold` and
 * every other sticky-footer screen in the app use, so it reads like a
 * standard bottom button rather than one this flow invented. The footer's
 * own height is measured (`onLayout`, since `continueBusy`'s spinner and
 * Dynamic Type both change it) and fed back into the ScrollView's bottom
 * padding, so the LAST thing in a step's content — a chart, a field, a
 * caption — can always scroll fully clear of the button instead of sitting
 * permanently hidden behind it.
 */
export function OnboardingStepScreen({
  testID,
  title,
  subtitle,
  currentStep,
  totalSteps,
  stepLabel,
  onBack,
  onContinue,
  continueLabel = 'Continue',
  continueBusy = false,
  continueDisabled = false,
  showForwardChevron = true,
  icon,
  children,
}: OnboardingStepScreenProps) {
  const colors = useAppColors();
  const { content: containerPadding } = useLayoutPadding();
  const [footerHeight, setFooterHeight] = useState(0);

  /** Same lift `Card`'s `elevated` variant uses — theme-aware, so can't live in the static `StyleSheet`. */
  const heroIconShadow = Platform.select({
    ios: {
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: Opacity.gradientButton,
      shadowRadius: 8,
    },
    android: {
      elevation: Elevation.cardRaised,
    },
  });

  return (
    <AppBackground opacity={0.6}>
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <OnboardingStepHeader
          testID={testID}
          currentStep={currentStep}
          totalSteps={totalSteps}
          stepLabel={stepLabel}
          onBack={onBack}
          onForward={showForwardChevron ? onContinue : undefined}
          forwardDisabled={continueBusy || continueDisabled}
        />
      </SafeAreaView>

      {/* Every onboarding step's fields sit mid-screen under a header, so an
          opening keypad lands on top of the one just tapped. `keyboardDismissScrollProps`
          is what actually scrolls it back into view (a `KeyboardAvoidingView`
          only shrinks the viewport) — see `@utils/keyboard`. */}
      <ScrollView
        testID={testID}
        {...keyboardDismissScrollProps}
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: containerPadding, paddingBottom: footerHeight + Spacing.xl },
        ]}
      >
        <AdaptiveContainer width="reading" style={styles.stack}>
          {icon ? (
            <View style={styles.heroIconWrap}>
              <LinearGradient
                colors={getButtonGradientColors('primary')}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.heroIcon, heroIconShadow]}
              >
                <Icon name={icon} size={28} color={colors.white} forceIonicons />
              </LinearGradient>
            </View>
          ) : null}
          <Typography variant="title2" weight="bold" color={colors.textPrimary} align="center">
            {title}
          </Typography>
          {subtitle ? (
            <Typography
              variant="body"
              color={colors.textSecondary}
              align="center"
              style={styles.subtitle}
            >
              {subtitle}
            </Typography>
          ) : null}

          {children}
        </AdaptiveContainer>
      </ScrollView>

      <View
        testID={`${testID}-footer`}
        style={styles.footerOverlay}
        pointerEvents="box-none"
        onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
      >
        <ScreenFooterGlass />
        <AdaptiveContainer width="reading" padding={0} style={{ paddingHorizontal: containerPadding }}>
          <Button
            title={continueLabel}
            variant="primary"
            size="lg"
            onPress={onContinue}
            loading={continueBusy}
            disabled={continueBusy || continueDisabled}
            testID={`${testID}-continue`}
          />
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  headerSafeArea: {
    flex: 0,
  },
  content: { paddingTop: Spacing.md },
  stack: { gap: Spacing.base },
  heroIconWrap: {
    alignItems: 'center',
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitle: { marginBottom: Spacing.sm },
  footerOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Tall enough that the glass fade begins well above the button, so its
    // top edge reads as transparent rather than a hard line over the content.
    paddingTop: 32,
    paddingBottom: Layout.bottomSafeArea,
    overflow: 'hidden',
  },
});
