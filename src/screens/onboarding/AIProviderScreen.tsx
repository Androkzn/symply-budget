import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRouter } from 'expo-router';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { brand } from '@brand';
import { AppBackground, SafeAreaView } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { OnboardingStepHeader, OnboardingProgress } from '@components/onboarding';
import { Button, GradientButton, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import {
  houseOnboardingProgress,
  markHouseOnboardingAiAvailable,
  markHouseOnboardingAiSkipped,
} from '@features/house/onboarding/aiSteps';
import { useAIEntitlement } from '@hooks/useAIEntitlement';
import type { OnboardingStackParamList } from '@navigation/types';
import { useAuthStore } from '@stores/authStore';
import { useAppColors } from '@theme';

type AIProviderScreenNavigationProp = NativeStackNavigationProp<
  OnboardingStackParamList,
  'AIProvider'
>;

/**
 * The step that decides whether the two AI-dependent steps happen at all.
 *
 * ## Why it sits here rather than at the end
 *
 * `UploadReport` and `FloorPlan` both exist to feed a model — one reads an
 * inspection report, the other turns a drawing into rooms and areas. Asked
 * AFTER them, a member has already picked a file for a feature that cannot run,
 * which is exactly the dead end this flow used to have: `FloorPlanScreen` raised
 * an `Upload Failed` alert carrying a "not on this build yet" sentence, and the
 * member had no way to act on it. Asked BEFORE them, the question is answerable
 * and the answer plans the rest of the flow.
 *
 * ## Three outcomes, and only one of them is a screen
 *
 *  - **Already entitled** — a Pro subscription includes AI, and so does a key
 *    the member connected earlier. Neither is worth interrupting for, so the
 *    step forwards on sight and the member never knows it was here.
 *  - **AI is off fleet-wide** (`aiFeaturesEnabled` false) — there is nothing to
 *    offer and nothing to buy. Treated as skipped rather than shown as a dead
 *    card.
 *  - **Not entitled** — the ask, with both routes into `/ai-access` and a plain
 *    "Skip for now" that drops `UploadReport` and `FloorPlan` from the flow.
 *
 * ## Coming back from `/ai-access`
 *
 * Connecting a key leaves this stack for the expo-router `ai-access` routes and
 * returns here. `useFocusEffect` refetches entitlement on the way back, so a
 * member who connects a provider is forwarded automatically instead of being
 * asked a question they have just answered.
 */
export function AIProviderScreen() {
  const navigation = useNavigation<AIProviderScreenNavigationProp>();
  const router = useRouter();
  const colors = useAppColors();

  const {
    canUseAI,
    isPaid,
    isLoading,
    aiFeaturesEnabled,
    subscriptionsEnabled,
    bringYourOwnAIEnabled,
    refetch,
  } = useAIEntitlement();

  /**
   * `useAIEntitlement` does not fire its query until auth has rehydrated, and a
   * DISABLED react-query reports `isLoading: false` with no data — which reads
   * exactly like "this member has no AI access". Waiting on hydration too is
   * what makes the "no flash" claim below actually true; without it a Pro
   * member sees the upsell for as long as the SecureStore token takes to load.
   */
  const hasHydrated = useAuthStore(s => s.hasHydrated);
  const entitlementSettled = hasHydrated && !isLoading;

  const { currentStep, totalSteps } = houseOnboardingProgress('AIProvider');

  // Returning from `/ai-access/connect` does not remount this screen, so a
  // freshly connected key would otherwise sit behind a 30s `staleTime` and the
  // member would be asked again on a screen that is already satisfied.
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  /**
   * `replace`, not `navigate`: a forwarded step must not be on the back stack,
   * or "back" from `UploadReport` lands on a screen that immediately forwards
   * again and the member cannot reach `SpaceSetup`.
   */
  useEffect(() => {
    if (!entitlementSettled) return;

    if (canUseAI) {
      markHouseOnboardingAiAvailable();
      navigation.replace('UploadReport');
      return;
    }

    if (!aiFeaturesEnabled) {
      markHouseOnboardingAiSkipped();
      navigation.replace('GarbageSetup');
    }
  }, [aiFeaturesEnabled, canUseAI, entitlementSettled, navigation]);

  const handleSkip = () => {
    markHouseOnboardingAiSkipped();
    navigation.navigate('GarbageSetup');
  };

  // Held on the spinner rather than flashing the ask: a Pro member seeing
  // "unlock AI" for the half-second before entitlement resolves is being sold
  // something they already own.
  if (!entitlementSettled || canUseAI || !aiFeaturesEnabled) {
    return (
      <AppBackground opacity={0.5}>
        <SafeAreaView>
          {/* The bar alone, no arrows: this render lasts a moment and then
              `replace`s itself, so a back arrow here would be a control the
              member cannot reliably hit and a forward one would race the
              redirect it duplicates. */}
          <OnboardingProgress
            currentStep={currentStep}
            totalSteps={totalSteps}
            stepLabel="AI Access"
          />
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView>
        <OnboardingStepHeader
          testID="onboarding-ai-provider"
          currentStep={currentStep}
          totalSteps={totalSteps}
          stepLabel="AI Access"
          onBack={() => navigation.goBack()}
          // Forward IS "Skip for Now", down to recording the decision — the
          // step's whole content is a question, and passing over a question is
          // answering it "no". Reversible: coming back here and connecting a
          // provider marks the two AI steps in again.
          onForward={handleSkip}
        />
        <AdaptiveContainer width="reading" padding={0}>
          <ScrollView
            style={styles.container}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            testID="onboarding-ai-provider-scroll"
          >
            <View style={styles.header}>
              <Typography
                variant="largeTitle"
                weight="bold"
                align="center"
                color={colors.textPrimary}
              >
                Turn On AI Features
              </Typography>
              <Typography
                variant="body"
                color={colors.textSecondary}
                align="center"
                style={styles.subtitle}
              >
                Two of the next steps read a document for you. They need a model
                — either {brand.displayName} Pro, or a provider key of your own.
              </Typography>
            </View>

            <View
              style={[
                styles.features,
                { backgroundColor: colors.card, borderColor: colors.borderColor },
              ]}
            >
              <FeatureItem
                icon="document-text"
                text="Read your home inspection report and file what it found"
              />
              <FeatureItem
                icon="grid"
                text="Turn a floor plan into rooms, areas and pinned locations"
              />
              <FeatureItem
                icon="sparkles"
                text="Scan bills, draft tasks and compare contractor quotes"
              />
            </View>

            <View style={styles.actions}>
              {subscriptionsEnabled ? (
                <GradientButton
                  title={isPaid ? 'Manage subscription' : `Get ${brand.displayName} Pro`}
                  variant="teal"
                  onPress={() => router.push('/ai-access/paywall')}
                  fullWidth
                  testID="onboarding-ai-provider-pro"
                />
              ) : null}
              {bringYourOwnAIEnabled ? (
                <Button
                  title="Connect your own provider"
                  variant="secondary"
                  onPress={() => router.push('/ai-access/providers')}
                  fullWidth
                  testID="onboarding-ai-provider-connect"
                />
              ) : null}
              <Button
                title="Skip for Now"
                variant="ghost"
                onPress={handleSkip}
                fullWidth
                testID="onboarding-ai-provider-skip"
              />
            </View>

            {/* Says out loud what skipping costs, so the choice is informed
                rather than discovered two screens later. The rest of House is
                genuinely unaffected — that is the pricing model, not a
                consolation. */}
            <View style={styles.note}>
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                align="center"
              >
                Skip and we&apos;ll leave those two steps out. Everything else in{' '}
                {brand.displayName} works without AI, and you can turn it on any
                time from Settings.
              </Typography>
            </View>
          </ScrollView>
        </AdaptiveContainer>
      </SafeAreaView>
    </AppBackground>
  );
}

function FeatureItem({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.featureItem}>
      <Icon name={icon} size={20} color={colors.primary} />
      <Typography
        variant="body"
        color={colors.textSecondary}
        style={styles.featureItemText}
      >
        {text}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    marginTop: 32,
    marginBottom: 32,
  },
  subtitle: {
    marginTop: 16,
    lineHeight: 22,
  },
  features: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 32,
    gap: 16,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featureItemText: {
    flex: 1,
  },
  actions: {
    gap: 12,
  },
  note: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
});
