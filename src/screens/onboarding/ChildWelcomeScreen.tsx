import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useState } from 'react';

import { authApi } from '@api/auth';
import { brandId } from '@brand';
import { OnboardingWelcome } from '@components/onboarding';
import { getWelcomeContent } from '@config/brandContent';
import { isHealthBrand } from '@features/health';
import type { OnboardingStackParamList } from '@navigation/types';
import { useAuthStore } from '@stores/authStore';

import { handleAcceptTermsError } from './acceptTermsError';

type ChildWelcomeScreenNavigationProp = NativeStackNavigationProp<
  OnboardingStackParamList,
  'Welcome'
>;

/**
 * Shared welcome for the non-House, non-Language child brands (Kaizen, Budget,
 * Health). They have no home/household domain, so onboarding is a single branded
 * welcome — same UI as House, different content (from @config/brandContent) —
 * that accepts terms and continues into the next step, which eventually
 * completes onboarding once every step has been answered (or skipped). Any
 * brand-specific setup (e.g. Kaizen's "Build your system", Budget's
 * household) happens in-app afterwards. Contrast House's WelcomeScreen, which
 * continues into the home flow instead.
 *
 * Symply Health alone detours through its goals mini-flow FIRST — before
 * notifications and Apple Health, not after — landing on `EssentialPermissions`
 * only at the far end of `HealthGoalsWater`. `HealthGoalsBiometrics` ("About
 * you") opens the mini-flow, not closes it — gender/age/height/activity level
 * feed the personalised suggestions every later step shows — so this hands
 * off there, not to `HealthGoalsNutrition`.
 */
export function ChildWelcomeScreen() {
  const navigation = useNavigation<ChildWelcomeScreenNavigationProp>();
  const { setUser } = useAuthStore();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleGetStarted = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      const { user } = await authApi.acceptTerms();
      setUser(user);
      if (isHealthBrand()) {
        navigation.navigate('HealthGoalsBiometrics', { onDone: 'complete' });
      } else {
        // Onboarding finishes on the far side of EssentialPermissions, not
        // here — see that screen's `onDone: 'complete'` handling.
        navigation.navigate('EssentialPermissions', { onDone: 'complete' });
      }
    } catch (error: unknown) {
      handleAcceptTermsError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <OnboardingWelcome
      content={getWelcomeContent(brandId)}
      totalSteps={isHealthBrand() ? 8 : 2}
      submitting={isSubmitting}
      onGetStarted={() => void handleGetStarted()}
    />
  );
}
