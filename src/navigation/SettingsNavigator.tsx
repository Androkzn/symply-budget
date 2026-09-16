import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useRef } from 'react';

import { isFullBudget } from '@brand';
import { BudgetHouseholdEditScreen, BudgetHouseholdScreen } from '@features/budget/screens';
import {
  DataSharingScreen,
  SoftTransferConnectScreen,
  SoftTransferFlowRouteScreen,
} from '@features/ecosystem';
import { AIInsightsDashboardScreen } from '@screens/ai';
import { ApplianceDetailScreen } from '@screens/appliances';
import { BudgetInviteCreateScreen } from '@screens/budget/BudgetInviteCreateScreen';
import { BudgetInviteScreen } from '@screens/budget/BudgetInviteScreen';
import { BudgetJoinScreen } from '@screens/budget/BudgetJoinScreen';
import {
  FloorPlansScreen,
  FloorPlanUploadScreen,
  FloorPlanViewerScreen,
  FloorPlanPickerScreen,
  FloorPlanMarkerPlacementScreen,
  FloorPlanAreaEditScreen,
} from '@screens/floor-plans';
import { HouseBackupScreen } from '@screens/house-v2/backup';
import {
  HouseDeviceSyncScreen,
  HouseDevicesScreen,
  HouseInviteCreateScreen,
  HouseInviteScreen,
  HouseJoinScreen,
  HousePropertiesScreen,
} from '@screens/house-v2/enrolment';
import { HouseholdManagementScreen } from '@screens/households/HouseholdManagementScreen';
import { HouseholdMembersScreen } from '@screens/households/HouseholdMembersScreen';
import { PropertyDetailScreen } from '@screens/households/PropertyDetailScreen';
import { SettingsScreen } from '@screens/main/SettingsScreen';
import { AihousekeeperConnectedAccountsScreen } from '@screens/settings/AihousekeeperConnectedAccountsScreen';
import { AihousekeeperSettingsScreen } from '@screens/settings/AihousekeeperSettingsScreen';
import { AIHousePreferencesScreen } from '@screens/settings/AIHousePreferencesScreen';
import { AppearanceScreen } from '@screens/settings/AppearanceScreen';
import { CalendarSyncScreen } from '@screens/settings/CalendarSyncScreen';
import { CurrencyScreen } from '@screens/settings/CurrencyScreen';
import { CustomizationScreen } from '@screens/settings/CustomizationScreen';
import { HouseSettingsScreen } from '@screens/settings/HouseSettingsScreen';
import { NavigationCustomizationScreen } from '@screens/settings/NavigationCustomizationScreen';
import { NotificationSettingsScreen } from '@screens/settings/NotificationSettingsScreen';
import { PrivacyPolicyScreen } from '@screens/settings/PrivacyPolicyScreen';
import { RegionScreen } from '@screens/settings/RegionScreen';
import { TermsOfServiceScreen } from '@screens/settings/TermsOfServiceScreen';
import { WidgetCustomizationScreen } from '@screens/settings/WidgetCustomizationScreen';
import { SpacesManagementScreen, SpaceDetailScreen } from '@screens/spaces';
import { clearSettingsDeepLinkParams } from '@services/deepLinks';
import {
  navigateAfterInteractions,
  runWhenNavigatorReady,
} from '@services/nav-when-ready';
import {
  flushPendingSettingsNavigation,
  registerSettingsStackNavigation,
} from '@stores/settingsNavigationStore';

import type { SettingsStackParamList } from './types';

// Budget presents households as a plain shared-budget group (name + members +
// invites) with none of House's property/address framing. Every other brand
// keeps the property-oriented manager. Brand is fixed per JS bundle, so this
// resolves once at module load.
const HouseholdRootScreen = isFullBudget()
  ? BudgetHouseholdScreen
  : HouseholdManagementScreen;

const Stack = createNativeStackNavigator<SettingsStackParamList>();

type RouterParam = string | string[] | undefined;

interface SettingsNavigatorProps {
  /**
   * Which screen this mount opens on. `SettingsMain` (the More hub) is the tab
   * host; `HouseSettings` is the `/house-settings` root route, which exists so
   * the gear on any House tab can open the settings hub WITHOUT switching the
   * member to the More tab and losing their place.
   */
  initialRouteName?: 'SettingsMain' | 'HouseSettings';
  /**
   * Whether this mount is the one `settingsNavigationStore` should drive.
   *
   * Exactly one may be — the store holds a single navigation object, and a
   * second mount that registered itself would leave notification taps
   * dispatching into a stack that is popped and gone. The tab host registers;
   * the root route does not.
   */
  registerStack?: boolean;
  initialParams?: {
    screen?: RouterParam;
    householdId?: RouterParam;
    floorPlanId?: RouterParam;
    initialZoneType?: RouterParam;
    initialZoneIndex?: RouterParam;
    navNonce?: RouterParam;
    /** `ApplianceDetail` — absent means ADD mode, which is a valid request. */
    applianceId?: RouterParam;
  };
}

function firstString(value: RouterParam): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseZoneType(value: string | undefined): 'floor' | 'detached' | 'full' | undefined {
  if (value === 'floor' || value === 'detached' || value === 'full') return value;
  return undefined;
}

function parseZoneIndex(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function SettingsStackRegistration() {
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();

  useEffect(() => {
    registerSettingsStackNavigation(navigation);
    runWhenNavigatorReady(() => flushPendingSettingsNavigation());
  }, [navigation]);

  return null;
}

function NavigationHandler({
  initialParams,
  children,
}: {
  initialParams?: SettingsNavigatorProps['initialParams'];
  children: React.ReactNode;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  const hasNavigated = useRef<string | null>(null);

  useEffect(() => {
    const screen = firstString(initialParams?.screen);
    if (!screen) return;

    const navNonce = firstString(initialParams?.navNonce) ?? '';

    /**
     * What to push, and the key that dedupes it.
     *
     * The Settings stack lives in a `NavigationIndependentTree`
     * (`app/(tabs)/settings.tsx`), so nothing outside it can `navigate()` into
     * it — a caller on another tab pushes `/settings` with URL params instead
     * and this handler turns them into a real navigation. That is the pattern
     * `src/services/navigation.ts` documents for every cross-tab hop.
     *
     * `navNonce` is part of every key so a second tap on the same card
     * navigates again rather than being swallowed by the dedupe ref.
     */
    let go: (() => void) | null = null;
    let navKey = '';

    if (screen === 'FloorPlanViewer') {
      const floorPlanId = firstString(initialParams?.floorPlanId);
      if (!floorPlanId) return;
      const initialZoneType = parseZoneType(firstString(initialParams?.initialZoneType));
      const initialZoneIndex = parseZoneIndex(firstString(initialParams?.initialZoneIndex));
      navKey = `${screen}:${floorPlanId}:${initialZoneType ?? ''}:${initialZoneIndex ?? ''}:${navNonce}`;
      go = () =>
        navigation.navigate('FloorPlanViewer', {
          floorPlanId,
          initialZoneType,
          initialZoneIndex,
        });
    } else if (screen === 'ApplianceDetail') {
      // `AppliancesScreen` is presented as a modal on the HOME tab, so its two
      // row taps cannot reach this stack directly. An ABSENT `applianceId` is a
      // valid request — it is the "Add appliance" button — which is why this
      // branch has no `if (!id) return` guard, unlike the one above.
      const applianceId = firstString(initialParams?.applianceId);
      const householdId = firstString(initialParams?.householdId);
      navKey = `${screen}:${applianceId ?? 'new'}:${householdId ?? ''}:${navNonce}`;
      go = () => navigation.navigate('ApplianceDetail', { applianceId, householdId });
    }

    if (!go || hasNavigated.current === navKey) return;
    hasNavigated.current = navKey;
    const push = go;
    let cancelled = false;
    navigateAfterInteractions(() => {
      if (cancelled) return;
      try {
        push();
      } catch (err) {
        if (__DEV__) {
          console.warn('[SettingsNavigator] deep-link navigate failed', err);
        }
        return;
      }
      clearSettingsDeepLinkParams();
    });
    return () => {
      cancelled = true;
    };
  }, [initialParams, navigation]);

  return <>{children}</>;
}

export function SettingsNavigator({
  initialParams,
  initialRouteName = 'SettingsMain',
  registerStack = true,
}: SettingsNavigatorProps = {}) {
  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{
        headerShown: false,
        contentStyle: { flex: 1 },
      }}
    >
      <Stack.Screen name="SettingsMain">
        {(props) => (
          <>
            {registerStack && <SettingsStackRegistration />}
            <NavigationHandler initialParams={initialParams}>
              <SettingsScreen {...props} />
            </NavigationHandler>
          </>
        )}
      </Stack.Screen>
      {/* House's settings hub. Registered unconditionally, on the same rule as
          every other screen here: a route that exists only for some brands makes
          `navigate()` throw at runtime everywhere else, so the brand decision
          lives on the gear that opens it, not on the registration. */}
      <Stack.Screen name="HouseSettings" component={HouseSettingsScreen} />
      <Stack.Screen name="HouseholdManagement" component={HouseholdRootScreen} />
      <Stack.Screen name="PropertyDetail" component={PropertyDetailScreen} />
      <Stack.Screen name="HouseholdMembers" component={HouseholdMembersScreen} />
      {/* Budget's own enrolment screen, reachable from My Households. Not
          registered for other brands: they have no local-first control plane,
          and HouseholdMembers above is their real members screen. */}
      {isFullBudget() ? (
        <>
          <Stack.Screen name="BudgetInvite" component={BudgetInviteScreen} />
          {/* The hub's three destinations, registered here too — a hub mounted
              in two stacks with its rows registered in only one has dead rows
              in the other. */}
          <Stack.Screen name="BudgetInviteCreate" component={BudgetInviteCreateScreen} />
          <Stack.Screen name="BudgetJoin" component={BudgetJoinScreen} />
          <Stack.Screen name="BudgetHouseholds" component={BudgetHouseholdScreen} />
          {/* One household's own page — and, with no `householdId`, the form
              that creates one. Registered here too, for the reason above: a
              screen reachable from only one of the two stacks its parent is
              mounted in is a dead tap in the other. */}
          <Stack.Screen name="BudgetHouseholdEdit" component={BudgetHouseholdEditScreen} />
        </>
      ) : null}
      <Stack.Screen name="Appearance" component={AppearanceScreen} />
      <Stack.Screen name="Currency" component={CurrencyScreen} />
      <Stack.Screen name="Region" component={RegionScreen} />
      <Stack.Screen name="Customization" component={CustomizationScreen} />
      <Stack.Screen name="WidgetCustomization" component={WidgetCustomizationScreen} />
      <Stack.Screen name="NavigationCustomization" component={NavigationCustomizationScreen} />
      <Stack.Screen name="AIHousekeeperSettings" component={AIHousePreferencesScreen} />
      <Stack.Screen name="AIInsightsDashboard" component={AIInsightsDashboardScreen} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <Stack.Screen name="CalendarSync" component={CalendarSyncScreen} />
      <Stack.Screen name="TermsOfService" component={TermsOfServiceScreen} />
      <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} />
      <Stack.Screen name="AihousekeeperSettings" component={AihousekeeperSettingsScreen} />
      <Stack.Screen
        name="AihousekeeperConnectedAccounts"
        component={AihousekeeperConnectedAccountsScreen}
      />
      <Stack.Screen name="FloorPlansMain" component={FloorPlansScreen} />
      <Stack.Screen name="FloorPlanUpload" component={FloorPlanUploadScreen} />
      <Stack.Screen name="FloorPlanViewer" component={FloorPlanViewerScreen} />
      <Stack.Screen
        name="FloorPlanPicker"
        component={FloorPlanPickerScreen}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen
        name="FloorPlanMarkerPlacement"
        component={FloorPlanMarkerPlacementScreen}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen
        name="FloorPlanAreaEdit"
        component={FloorPlanAreaEditScreen}
      />
      <Stack.Screen name="SpacesManagement" component={SpacesManagementScreen} />
      <Stack.Screen name="SpaceDetail" component={SpaceDetailScreen} />
      <Stack.Screen name="SoftTransferConnect" component={SoftTransferConnectScreen} />
      <Stack.Screen name="SoftTransferFlow" component={SoftTransferFlowRouteScreen} />
      <Stack.Screen name="DataSharing" component={DataSharingScreen} />
      {/*
        House V2 local-first surface (plan §0.1). Registered unconditionally,
        exactly like every other screen in this navigator: a route that exists
        only for some brands makes `navigate()` throw at runtime everywhere
        else, so the brand decision lives on the Settings *row* instead. Each
        screen draws its own ScreenHeader, so none of them takes `options`.
      */}
      <Stack.Screen name="HouseDeviceSync" component={HouseDeviceSyncScreen} />
      <Stack.Screen name="HouseInvite" component={HouseInviteScreen} />
      <Stack.Screen name="HouseInviteCreate" component={HouseInviteCreateScreen} />
      <Stack.Screen name="HouseJoin" component={HouseJoinScreen} />
      <Stack.Screen name="HouseProperties" component={HousePropertiesScreen} />
      <Stack.Screen name="HouseDevices" component={HouseDevicesScreen} />
      <Stack.Screen name="HouseBackup" component={HouseBackupScreen} />
      {/*
        The appliance detail + its H6 attachment field. Registered
        unconditionally on the same rule as the six above: a route that exists
        only for some brands makes `navigate()` throw at runtime everywhere
        else, so the brand/flag decision lives INSIDE the screen — it gates the
        attachment field on `isHouseLocalFirst()` and still lists the documents
        either way. It draws its own ScreenHeader, so it takes no `options`.
      */}
      <Stack.Screen name="ApplianceDetail" component={ApplianceDetailScreen} />
    </Stack.Navigator>
  );
}
