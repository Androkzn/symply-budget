import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { TouchableOpacity } from 'react-native-gesture-handler';

import { SafeAreaView, AppBackground, HeaderLogo } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography, GradientButton, IconBackgroundChip } from '@components/ui';
import type { GradientButtonVariant } from '@components/ui';
import { Icon, hasBrandIcon } from '@components/ui/Icon';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useAuthStore } from '@stores/authStore';
import { IconSize, Spacing, useAppColors } from '@theme';

import { LegalAgreement } from './LegalAgreement';
import { OnboardingProgress } from './OnboardingProgress';

/** One value-prop card on the welcome screen. */
export interface OnboardingFeature {
  /** Ordered brushed-kit keys; the first one the active brand ships is used. */
  brandIcons: string[];
  /** Ionicons glyph rendered only if the brand kit has none of `brandIcons`. */
  fallbackIcon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
}

/** Per-brand content for the shared welcome screen. */
export interface OnboardingWelcomeContent {
  subtitle: string;
  features: OnboardingFeature[];
}

interface OnboardingWelcomeProps {
  content: OnboardingWelcomeContent;
  /** Steps in this brand's onboarding (House = full flow, children = 1). */
  totalSteps: number;
  /** 0-based index of this welcome step. */
  currentStep?: number;
  /** Button gradient; omit to use the brand's default (primary) gradient. */
  buttonVariant?: GradientButtonVariant;
  /** True while the get-started action is running. */
  submitting: boolean;
  /** Run after the user has agreed to terms and tapped the button. */
  onGetStarted: () => void;
}

/**
 * Shared onboarding welcome UI for every brand. The chrome (progress, brand
 * logo, feature cards, terms agreement, primary button) is identical across
 * apps — only `content` (subtitle + feature cards) and the get-started behavior
 * differ. This is the "shared UI, different content" contract: House drives it
 * with a home-domain content pack and navigates into its household flow; child
 * brands drive it with their own content and complete onboarding directly.
 */
export function OnboardingWelcome({
  content,
  totalSteps,
  currentStep = 0,
  buttonVariant,
  submitting,
  onGetStarted,
}: OnboardingWelcomeProps) {
  const colors = useAppColors();
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const logout = useAuthStore((state) => state.logout);
  // Same "main padding horizontal" every other screen uses (`useLayoutPadding`)
  // so the Get Started button's edges — and every floating CTA that mirrors
  // its width — line up with the rest of the app's content margins.
  const { content: horizontalPadding } = useLayoutPadding();

  // This is a member's first onboarding screen, arrived at straight from
  // Login/Register — there is no earlier in-app screen to pop back to, only
  // signing out and landing back on Login.
  //
  // So the control SAYS where it goes. Every later step of the wizard now
  // carries a plain back chevron that pops one step, and an identical-looking
  // chevron here would promise the same thing while actually ending the
  // session. "Sign In" names the destination, and the prompt below is what
  // makes the difference recoverable: back on the first screen a member is one
  // stray tap away from discarding the sign-in they just completed.
  const handleBack = () => {
    Alert.alert(
      'Sign out?',
      'Going back returns you to the sign-in screen. You can sign in again to pick up setup where you left off.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void logout() },
      ],
    );
  };

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView>
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={handleBack}
            style={styles.signInBack}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Back to sign in"
            testID="onboarding-welcome-back"
          >
            <Icon
              name="chevron-back"
              forceIonicons
              size={IconSize.md}
              color={colors.primary}
            />
            <Typography variant="body" style={{ color: colors.primary }}>
              Sign In
            </Typography>
          </TouchableOpacity>
        </View>
        <OnboardingProgress currentStep={currentStep} totalSteps={totalSteps} stepLabel="Welcome" />
        <AdaptiveContainer width="reading" padding={0}>
          <View
            testID="onboarding-welcome-content"
            style={[styles.container, { paddingHorizontal: horizontalPadding }]}
          >
            <ScrollView
              style={styles.content}
              contentContainerStyle={styles.contentInner}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.textContainer}>
                <Typography variant="largeTitle" weight="bold" align="center" color={colors.textPrimary}>
                  Welcome to
                </Typography>
                <View style={styles.logoContainer}>
                  <HeaderLogo height={76} orientation="vertical" />
                </View>
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  align="center"
                  style={styles.subtitle}
                >
                  {content.subtitle}
                </Typography>
              </View>

              <View style={styles.features}>
                {content.features.map((feature) => (
                  <FeatureItem key={feature.title} feature={feature} />
                ))}
              </View>
            </ScrollView>

            <View style={styles.footer}>
              <LegalAgreement
                agreed={agreedToTerms}
                onToggle={() => setAgreedToTerms(!agreedToTerms)}
              />

              <GradientButton
                title={submitting ? 'Please wait...' : 'Get Started'}
                variant={buttonVariant}
                size="lg"
                onPress={onGetStarted}
                disabled={!agreedToTerms || submitting}
                style={(!agreedToTerms || submitting) ? styles.buttonDisabled : undefined}
                fullWidth
                testID="onboarding-get-started"
                // This is the very first screen of its own `NavigationIndependentTree`
                // (see `app/_layout.tsx`'s pre-onboarding branch) — the default
                // reanimated `Pressable` here silently never receives taps, while
                // plain `TouchableOpacity` siblings on this same screen (the
                // checkbox, the legal links) work fine. RNGH's `TouchableOpacity`
                // doesn't depend on the RN responder system the same way and
                // reliably receives the tap instead.
                TouchableComponent={TouchableOpacity}
              />
            </View>
          </View>
        </AdaptiveContainer>
      </SafeAreaView>
    </AppBackground>
  );
}

function FeatureItem({ feature }: { feature: OnboardingFeature }) {
  const colors = useAppColors();
  // Prefer the active brand artwork, colored with the current palette.
  const brandKey = feature.brandIcons.find(hasBrandIcon);
  return (
    <View style={[styles.featureItemWrapper, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
      <View style={styles.featureItemContent}>
        <IconBackgroundChip
          name={brandKey ?? feature.fallbackIcon}
          size={24}
          active={!!brandKey}
          style={styles.featureIcon}
        />
        <View style={styles.featureText}>
          <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
            {feature.title}
          </Typography>
          <Typography variant="subheadline" color={colors.textSecondary}>
            {feature.description}
          </Typography>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
    // The row is only as wide as the label, so the tap target does not spread
    // across the whole width and swallow taps meant for the content below.
    alignItems: 'flex-start',
  },
  signInBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingVertical: Spacing.xs,
  },
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  textContainer: {
    alignItems: 'center',
    marginBottom: 18,
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 2,
  },
  subtitle: {
    marginTop: 10,
    paddingHorizontal: 16,
    lineHeight: 20,
  },
  features: {
    gap: 10,
  },
  featureItemWrapper: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  featureItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 13,
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  featureText: {
    flex: 1,
  },
  footer: {
    paddingBottom: 20,
    gap: 12,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
