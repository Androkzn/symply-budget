import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRouter } from 'expo-router';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { brandId, isHouseBrand } from '@brand';
import { AppBackground, PermissionCard } from '@components/common';
import { OnboardingStepScreen } from '@components/onboarding';
import { Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { getNotificationBenefit } from '@config/brandContent';
import { ENV } from '@config/env';
import { isHealthBrand } from '@features/health';
import {
  ensureHealthReminderPermission,
  saveHealthReminders,
} from '@features/health/healthRemindersStorage';
import { isKaizenBrand } from '@features/kaizen';
import { LifeSystem } from '@features/kaizen/constants';
import { estimateOnboardingStepTotal } from '@features/kaizen/services/setupFlow';
import { useNotificationPermission } from '@hooks/useNotificationPermission';
import type { OnboardingStackParamList } from '@navigation/types';
import { useAuthStore } from '@stores/authStore';
import { Spacing, useAppColors } from '@theme';

type NavigationProp = NativeStackNavigationProp<OnboardingStackParamList, 'EssentialPermissions'>;
type PermissionsRouteProp = RouteProp<OnboardingStackParamList, 'EssentialPermissions'>;

/**
 * Symply Ecosystem — the notification-permission onboarding step, shown once,
 * right after a new member accepts terms and before they land in the app.
 *
 * ## Why this exists
 *
 * Before this screen, notifications were only ever explained deep in Settings
 * (`NotificationSettingsScreen`) — a member had to already know to look for
 * it. Asking here, once, with the "why" attached, means the OS sheet a member
 * sees moments later isn't a cold, unexplained interruption.
 *
 * ## Every brand, notifications only
 *
 * Camera and microphone are deliberately NOT here — those are requested by
 * the OS at the exact screen that uses them (barcode scan, receipt capture,
 * voice mode), which is the right moment to ask "why", not a generic
 * onboarding step nobody will remember by the time they actually open the
 * camera. Domain-specific permissions (Apple Health, on Symply Health) get
 * their OWN dedicated screen instead of a second card bolted onto this one —
 * see `HealthKitPermissionScreen` — so `handleContinue` routes there first on
 * that brand rather than resolving `onDone` directly.
 *
 * ## Last on Symply Health, not first
 *
 * Every other brand reaches this screen straight from Welcome. Health instead
 * detours through its whole goals mini-flow FIRST — `ChildWelcomeScreen`
 * sends it to `HealthGoalsBiometrics` ("About you", the mini-flow's first
 * step), and `HealthGoalsWaterScreen` (its last step) is what lands here.
 * `OnboardingStepScreen`'s progress bar reflects that: step 7 of 8 on Health
 * (Welcome counts as step 1), step 2 of 2 on Budget/Language (Welcome is
 * step 1 of their short flow), and hidden entirely on House, whose own much
 * longer household-setup count doesn't include this step. Kaizen detours
 * into its own required systems-setup after this screen instead of
 * completing (see `KaizenSystemsSetupScreen`) — its total here is an
 * estimate (assuming the picker's own default selection) that firms up once
 * the member actually reaches the picker and chooses.
 *
 * ## Skippable, always
 *
 * "Continue" is never blocked on granting anything — the card already says so
 * ("Entirely optional"), and the button below repeats it structurally:
 * tapping through with the permission still `not-requested` is a fully
 * supported path, not an edge case to handle later.
 *
 * ## Already granted? Skip it — except on Health
 *
 * If push permission reads back `granted` (member allowed it in a previous
 * onboarding attempt, or the app was reinstalled after already being
 * allowed), there is nothing left to ask for most brands — showing an
 * "Allow" screen with nothing to do just adds a tap. `handleContinue` fires
 * automatically once the OS answer comes back, and the loading spinner
 * covers the brief read.
 *
 * Symply Health is the exception: this screen also lists the actual reminder
 * categories the backend can send (meals, water, weigh-ins — see
 * `healthRemindersStorage.ts`), default ALL ON, so a granted member still has
 * something to look at and customize. Auto-skipping past a screen with
 * content on it would silently throw that choice away, so Health never takes
 * the fast path — it always renders the card (now showing "Access is on.")
 * plus the toggles below it.
 */
export function EssentialPermissionsScreen() {
  const colors = useAppColors();
  const router = useRouter();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<PermissionsRouteProp>();
  const completeOnboarding = useAuthStore((s) => s.completeOnboarding);
  const isHealth = isHealthBrand();
  const isKaizen = isKaizenBrand();

  const {
    state: pushState,
    busy: pushBusy,
    checked: pushChecked,
    request: requestPush,
  } = useNotificationPermission();

  // Health has reminder categories to customize below, so a granted read
  // must still render the screen — every other brand has nothing further to
  // ask and takes the fast path straight past it.
  //
  // ONCE, though. The fast path is an arrival behaviour: a member who is sent
  // here with the permission already granted has nothing to answer, so the
  // screen forwards itself. A member who walks BACK to it from the next step
  // is a different case entirely — they asked to be here — and re-forwarding
  // them would make the whole flow one-way. Worse, the render guard below does
  // not need the effect to re-fire to trap them: it paints a spinner for as
  // long as the permission reads `granted`, so back from step 3 landed on a
  // screen that spins forever with no control on it. Latching the skip after
  // its first use is what makes going back land on the real card.
  const [autoAdvanced, setAutoAdvanced] = useState(false);
  const skipWhenGranted = !isHealth && !autoAdvanced;

  const [mealsEnabled, setMealsEnabled] = useState(true);
  const [waterEnabled, setWaterEnabled] = useState(true);
  const [weighInEnabled, setWeighInEnabled] = useState(true);

  const handleContinue = useCallback(() => {
    const { onDone } = route.params;
    if (isHealth) {
      if (pushState === 'granted') {
        void ensureHealthReminderPermission().then((granted) => {
          if (!granted) return;
          void saveHealthReminders({
            meals_enabled: mealsEnabled,
            water_enabled: waterEnabled,
            weigh_in_enabled: weighInEnabled,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
        });
      }
      navigation.navigate('HealthKitPermission', { onDone });
    } else if (isKaizen && onDone === 'complete') {
      // Kaizen's onboarding isn't actually done yet — building at least one
      // life system (and, if Career's among them, its own deep setup) is
      // required before `completeOnboarding()` ever fires.
      navigation.navigate('KaizenSystemsSetup');
    } else if (onDone === 'complete') {
      completeOnboarding();
      router.replace('/');
    } else {
      navigation.navigate(onDone);
    }
  }, [
    route.params,
    isHealth,
    isKaizen,
    pushState,
    mealsEnabled,
    waterEnabled,
    weighInEnabled,
    navigation,
    completeOnboarding,
    router,
  ]);

  useEffect(() => {
    if (pushChecked && pushState === 'granted' && skipWhenGranted) {
      setAutoAdvanced(true);
      handleContinue();
    }
  }, [pushChecked, pushState, skipWhenGranted, handleContinue]);

  if (!pushChecked || (pushState === 'granted' && skipWhenGranted)) {
    return (
      <AppBackground opacity={0.6}>
        <View style={styles.loadingContainer} testID="onboarding-essential-permissions-loading">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  return (
    <OnboardingStepScreen
      testID="onboarding-essential-permissions-screen"
      title="Stay in the loop"
      subtitle={`An optional permission makes ${ENV.APP_NAME} more useful. Nothing here is required, and you can change your mind any time in Settings.`}
      currentStep={isHealth ? 6 : 1}
      totalSteps={
        isHealth
          ? 8
          : isKaizen
            ? estimateOnboardingStepTotal([LifeSystem.Career])
            : isHouseBrand()
              ? 1
              : 2
      }
      stepLabel="Notifications"
      icon="notifications-outline"
      onBack={() => navigation.goBack()}
      onContinue={handleContinue}
    >
      <PermissionCard
        state={pushState}
        icon="notifications"
        title="Notifications"
        copy={{
          'not-requested': { body: getNotificationBenefit(brandId) },
          denied: {
            body: "That's a fine choice — everything still works without them. To turn them on later, tap Open Settings, then Notifications, then turn on Allow Notifications.",
          },
          granted: isHealth
            ? { body: "Notifications are on. Choose what you'd like reminders for below." }
            : undefined,
        }}
        onRequest={() => void requestPush()}
        onOpenSettings={() => void Linking.openSettings()}
        busy={pushBusy}
        testID="onboarding-notification-permission-card"
      />

      {isHealth ? (
        <View style={styles.reminders} testID="onboarding-reminder-toggles">
          <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
            REMINDERS
          </Typography>
          <ReminderToggleRow
            title="Meal reminders"
            description="Nudges to log breakfast, lunch, and dinner"
            value={mealsEnabled}
            onValueChange={setMealsEnabled}
            testID="onboarding-reminder-toggle-meals"
          />
          <ReminderToggleRow
            title="Water reminders"
            description="Stay on top of your daily water intake"
            value={waterEnabled}
            onValueChange={setWaterEnabled}
            testID="onboarding-reminder-toggle-water"
          />
          <ReminderToggleRow
            title="Weigh-in reminders"
            description="A gentle nudge on your check-in days"
            value={weighInEnabled}
            onValueChange={setWeighInEnabled}
            testID="onboarding-reminder-toggle-weigh-in"
          />
        </View>
      ) : null}
    </OnboardingStepScreen>
  );
}

function ReminderToggleRow({
  title,
  description,
  value,
  onValueChange,
  testID,
}: {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.reminderRow}>
      <View style={styles.reminderText}>
        <Typography variant="body" weight="medium" color={colors.textPrimary}>
          {title}
        </Typography>
        <Typography variant="footnote" color={colors.textSecondary}>
          {description}
        </Typography>
      </View>
      <Toggle value={value} onValueChange={onValueChange} testID={testID} />
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  reminders: { gap: Spacing.sm },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.base,
    paddingVertical: Spacing.xs,
  },
  reminderText: { flex: 1, gap: 2 },
});
