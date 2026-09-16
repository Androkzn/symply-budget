import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRouter } from 'expo-router';
import { useNavigation } from 'expo-router/react-navigation';
import React from 'react';
import { Linking } from 'react-native';

import { OnboardingStepScreen } from '@components/onboarding';
import { HealthKitConnectCard, HealthKitSyncProgressModal } from '@features/health/components';
import { useHealthKitConnection } from '@features/health/useHealthKitConnection';
import type { OnboardingStackParamList } from '@navigation/types';
import { useAuthStore } from '@stores/authStore';

type NavigationProp = NativeStackNavigationProp<OnboardingStackParamList, 'HealthKitPermission'>;
type HealthKitPermissionRouteProp = RouteProp<OnboardingStackParamList, 'HealthKitPermission'>;

/**
 * Symply Health — the domain-specific onboarding step for Apple Health,
 * shown once, immediately after the shared notification-permission step
 * (`EssentialPermissionsScreen`), reached ONLY on the Health brand.
 *
 * ## Why its own screen, not a second card
 *
 * Notifications are a fleet-wide concern; Apple Health is a Symply Health
 * concern with a real decision behind it (five data types, read-only,
 * explained in full by `HealthKitConnectCard`'s own scope list). Bolting that
 * onto the shared permissions screen would either force every other brand's
 * layout to reserve space for a card that never renders, or make the one
 * screen try to explain two unrelated things at once. A brand-specific step
 * gets a brand-specific "why" instead.
 *
 * ## Skippable, always
 *
 * Same rule as the notification step: "Finish" is never blocked on
 * connecting anything. `HealthKitConnectCard` already says manual entry
 * keeps working in every state, including `not-requested`.
 *
 * ## The last step, not a detour into another
 *
 * Symply Health's onboarding runs goals FIRST (`HealthGoalsNutritionScreen`
 * through `HealthGoalsBiometricsScreen`, five steps), THEN this shared
 * `EssentialPermissionsScreen` (notifications), and THIS screen last — step 7
 * of 7, same dot-only `OnboardingStepScreen` chrome the goals steps use, no
 * printed "Step X of Y" caption. The footer button reads "Finish" rather than
 * "Continue" (`continueLabel="Finish"`) and the header's forward-chevron
 * shortcut is hidden (`showForwardChevron={false}`), since this is the end of
 * the flow, not another step to skip ahead through. Both still resolve
 * `onDone` directly here (complete onboarding outright, or hand off to the
 * House step the caller decided on), exactly like `EssentialPermissionsScreen`'s
 * own `handleContinue` does for every other brand. Going back returns to
 * `EssentialPermissionsScreen` with its own state intact, since native-stack
 * keeps pushed screens mounted.
 */
export function HealthKitPermissionScreen() {
  const router = useRouter();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<HealthKitPermissionRouteProp>();
  const completeOnboarding = useAuthStore((s) => s.completeOnboarding);

  const {
    status: healthKitStatus,
    busy: healthKitBusy,
    syncing: healthKitSyncing,
    progress: healthKitProgress,
    connectOrSync: handleHealthKit,
  } = useHealthKitConnection();

  const handleContinue = () => {
    const { onDone } = route.params;
    if (onDone === 'complete') {
      completeOnboarding();
      router.replace('/');
    } else {
      navigation.navigate(onDone);
    }
  };

  return (
    <>
      <OnboardingStepScreen
        testID="onboarding-healthkit-permission-screen"
        title="Sync with Apple Health"
        currentStep={7}
        totalSteps={8}
        stepLabel="Apple Health"
        icon="heart-outline"
        onBack={() => navigation.goBack()}
        onContinue={handleContinue}
        continueLabel="Finish"
        showForwardChevron={false}
      >
        {healthKitStatus ? (
          <HealthKitConnectCard
            state={healthKitStatus.state}
            lastSyncedAt={healthKitStatus.lastSyncedAt}
            onConnect={() => void handleHealthKit()}
            onOpenSettings={() => void Linking.openSettings()}
            busy={healthKitBusy}
            testID="onboarding-healthkit-card"
          />
        ) : null}
      </OnboardingStepScreen>

      <HealthKitSyncProgressModal
        visible={healthKitSyncing}
        progress={healthKitProgress}
        testID="onboarding-healthkit-sync-progress"
      />
    </>
  );
}
