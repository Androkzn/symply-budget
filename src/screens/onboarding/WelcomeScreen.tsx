import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useState } from 'react';

import { authApi } from '@api/auth';
import { brandId } from '@brand';
import { OnboardingWelcome } from '@components/onboarding';
import { getWelcomeContent } from '@config/brandContent';
import { houseOnboardingProgress } from '@features/house/onboarding/aiSteps';
import type { OnboardingStackParamList } from '@navigation/types';
import { useAuthStore } from '@stores/authStore';
import { useInviteStore } from '@stores/inviteStore';

import { handleAcceptTermsError } from './acceptTermsError';

type WelcomeScreenNavigationProp = NativeStackNavigationProp<
  OnboardingStackParamList,
  'Welcome'
>;

/**
 * Symply House welcome — step 1 of the full home-domain onboarding. Uses the
 * shared OnboardingWelcome UI with House's content pack, then continues into the
 * household setup flow (or the invite-join flow) rather than completing
 * onboarding outright. Child brands use ChildWelcomeScreen instead.
 */
export function WelcomeScreen() {
  const { setUser } = useAuthStore();
  const pendingJoinToken = useInviteStore((s) => s.pendingJoinToken);
  const navigation = useNavigation<WelcomeScreenNavigationProp>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleGetStarted = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      const { user } = await authApi.acceptTerms();
      setUser(user);
      if (navigation) {
        // Arrived via an invite link → join the inviting home instead of
        // setting up a new one (skips the home-owner setup steps) — decided
        // here, then handed to EssentialPermissions as where to continue once
        // the member has answered (or skipped) the permission ask.
        navigation.navigate('EssentialPermissions', {
          onDone: pendingJoinToken ? 'JoinHousehold' : 'CreateHousehold',
        });
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
      // Sized from the plan, not a constant: a member who goes on to skip the
      // AI step walks six steps, not eight, and the bar must not have promised
      // otherwise. Step 0 either way, so only the total is read here.
      totalSteps={houseOnboardingProgress('Welcome').totalSteps}
      buttonVariant="teal"
      submitting={isSubmitting}
      onGetStarted={() => void handleGetStarted()}
    />
  );
}
