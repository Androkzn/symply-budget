import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { isHouseBrand, isLanguageCapableBrand } from '@brand';
import { ThemeProvider } from '@contexts/ThemeContext';
import { isKaizenBrand } from '@features/kaizen';
import type { LifeSystem } from '@features/kaizen/constants';
import { needsCareerSetupStep, nextUnconfiguredSystem } from '@features/kaizen/services/setupFlow';
import { LanguageOnboardingScreen } from '@features/language';
// Imported from the FILE, not the `enrolment` barrel: the barrel also pulls in
// HouseInviteScreen and its siblings, and re-exporting that whole module graph
// through the navigator drags `@components/common` into environments that never
// needed it — which broke this navigator's own test suite at import time.
import { HouseJoinScreen } from '@screens/house-v2/enrolment/HouseJoinScreen';
import {
  WelcomeScreen,
  ChildWelcomeScreen,
  EssentialPermissionsScreen,
  HealthKitPermissionScreen,
  HealthGoalsNutritionScreen,
  HealthGoalsWeightScreen,
  HealthGoalsActivityScreen,
  HealthGoalsWaterScreen,
  HealthGoalsBiometricsScreen,
  KaizenSystemsSetupScreen,
  KaizenSystemConfigScreen,
  KaizenCareerSetupScreen,
  CreateHouseholdScreen,
  JoinHouseholdScreen,
  AIProviderScreen,
  UploadReportScreen,
  GarbageSetupScreen,
  FloorPlanScreen,
  SpaceSetupScreen,
} from '@screens/onboarding';

import type { OnboardingStackParamList } from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export function OnboardingNavigator() {
  // Symply Language has its own learner setup (no household/report flow) and
  // persists onboarding via the donor learner profile + local completeOnboarding.
  if (isLanguageCapableBrand()) {
    return (
      <ThemeProvider>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="LanguageOnboarding" component={LanguageOnboardingScreen} />
          <Stack.Screen name="EssentialPermissions" component={EssentialPermissionsScreen} />
        </Stack.Navigator>
      </ThemeProvider>
    );
  }

  // Non-House child brands (Kaizen, Budget, Health) have no home/household
  // domain, so they skip House's home-inspection flow (property → inspection
  // report → garbage schedule → floor plan). They get a single branded welcome
  // — the SAME shared UI as House, with their own content pack — that accepts
  // terms and completes onboarding. Any brand-specific setup happens in-app.
  if (!isHouseBrand()) {
    // Symply Kaizen alone requires an extra stretch after Notifications:
    // building at least one life system, then (if Career was among them) its
    // own deep setup wizard — see `KaizenSystemsSetupScreen`. `setupFlow.ts`'s
    // MMKV queue survives an app kill mid-setup, so resume straight back into
    // it on relaunch instead of replaying Welcome/Notifications/the picker.
    let initialRouteName: keyof OnboardingStackParamList = 'Welcome';
    let resumeSystem: LifeSystem | undefined;
    if (isKaizenBrand()) {
      const nextSystem = nextUnconfiguredSystem();
      if (nextSystem) {
        initialRouteName = 'KaizenSystemConfig';
        resumeSystem = nextSystem as LifeSystem;
      } else if (needsCareerSetupStep()) {
        initialRouteName = 'KaizenCareerSetup';
      }
    }

    return (
      <ThemeProvider>
        {/* `animation: 'fade'` (not the default horizontal slide) — every step
            here is built on `OnboardingStepScreen`'s floating Continue footer,
            which is absolutely positioned WITHIN each step's own screen. A
            slide transition carries that footer along with it, so back/
            forward navigation visibly drags the button across the screen
            instead of it reading as a fixed piece of chrome. A fade changes
            only opacity, never position, so the footer never appears to move. */}
        <Stack.Navigator
          initialRouteName={initialRouteName}
          screenOptions={{ headerShown: false, animation: 'fade' }}
        >
          <Stack.Screen name="Welcome" component={ChildWelcomeScreen} />
          {/* Reachable only on the Health brand — `ChildWelcomeScreen` routes
              here via `isHealthBrand()` instead of `EssentialPermissions`.
              Goals come FIRST on Health: five steps, then the shared
              `EssentialPermissions` (notifications) and `HealthKitPermission`
              (Apple Health) last, both using the same progress-bar chrome as
              the goals screens. Registered unconditionally here (same as
              Budget/Kaizen never navigating to any of them) rather than
              forking this whole branch per brand. */}
          <Stack.Screen name="HealthGoalsNutrition" component={HealthGoalsNutritionScreen} />
          <Stack.Screen name="HealthGoalsWeight" component={HealthGoalsWeightScreen} />
          <Stack.Screen name="HealthGoalsActivity" component={HealthGoalsActivityScreen} />
          <Stack.Screen name="HealthGoalsWater" component={HealthGoalsWaterScreen} />
          <Stack.Screen name="HealthGoalsBiometrics" component={HealthGoalsBiometricsScreen} />
          <Stack.Screen name="EssentialPermissions" component={EssentialPermissionsScreen} />
          <Stack.Screen name="HealthKitPermission" component={HealthKitPermissionScreen} />
          {/* Reachable only on the Kaizen brand — `EssentialPermissionsScreen`
              routes here via `isKaizenBrand()` instead of completing
              onboarding directly. `KaizenSystemConfig` loops once per
              selected system (`navigation.push`, a new stack entry each
              time); `initialParams` below only matters when this whole
              navigator itself mounts straight onto that screen (the resume
              case above), not for the loop's own pushes. */}
          <Stack.Screen name="KaizenSystemsSetup" component={KaizenSystemsSetupScreen} />
          <Stack.Screen
            name="KaizenSystemConfig"
            component={KaizenSystemConfigScreen}
            initialParams={resumeSystem ? { system: resumeSystem } : undefined}
          />
          <Stack.Screen name="KaizenCareerSetup" component={KaizenCareerSetupScreen} />
        </Stack.Navigator>
      </ThemeProvider>
    );
  }

  return (
    // Symply House — the full home-domain onboarding. Uses the same flat,
    // theme-following background as the rest of the app.
    <ThemeProvider>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen name="EssentialPermissions" component={EssentialPermissionsScreen} />
        <Stack.Screen name="CreateHousehold" component={CreateHouseholdScreen} />
        <Stack.Screen name="JoinHousehold" component={JoinHouseholdScreen} />
        {/*
          The SAME join screen the settings hub uses, reachable before there is
          a home. `JoinHousehold` above is the server-invite path and only ever
          runs when a deep link has already parked a `pendingJoinToken`; a
          member holding a QR code or a written-down code has nothing to hand it
          until here.
        */}
        <Stack.Screen name="HouseJoin" component={HouseJoinScreen} />
        <Stack.Screen name="SpaceSetup" component={SpaceSetupScreen} />
        {/*
          Registered unconditionally, reached conditionally. `AIProvider` is the
          step that decides whether `UploadReport` and `FloorPlan` happen at all
          — both feed a model — so it sits in front of them rather than being
          filtered out of the stack here: an entitled member is forwarded
          straight through it, and a member who skips is routed past the two
          steps it gates. Keeping all three registered means a deep link or a
          `goBack()` still resolves to a real screen.
        */}
        <Stack.Screen name="AIProvider" component={AIProviderScreen} />
        <Stack.Screen name="UploadReport" component={UploadReportScreen} />
        <Stack.Screen name="GarbageSetup" component={GarbageSetupScreen} />
        <Stack.Screen name="FloorPlan" component={FloorPlanScreen} />
      </Stack.Navigator>
    </ThemeProvider>
  );
}
