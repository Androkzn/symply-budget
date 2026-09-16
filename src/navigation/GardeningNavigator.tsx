import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { router } from 'expo-router';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useRef } from 'react';

import {
  GardenPlansScreen,
  GardenPlanAddressScreen,
  GardenPlanBoundaryConfirmScreen,
  GardenPlanMapWizardScreen,
  GardenPlanObjectEditorScreen,
  GardenPlanUploadScreen,
  GardenPlanViewerScreen,
} from '@screens/garden';
import { navigateAfterInteractions } from '@services/nav-when-ready';
import { useGardeningNavigationStore } from '@stores/gardeningNavigationStore';
import { useTabBarVisibilityStore } from '@stores/tabBarVisibilityStore';

import type { GardeningStackParamList } from './types';

const Stack = createNativeStackNavigator<GardeningStackParamList>();

/**
 * Params surfaced from expo-router via `useLocalSearchParams`. Values can be
 * `string | string[] | undefined` because URL search params can repeat;
 * callers should normalize via `firstString` before reading.
 */
type RouterParam = string | string[] | undefined;

interface GardeningNavigatorProps {
  initialParams?: {
    screen?: RouterParam;
    gardenPlanId?: RouterParam;
    draftId?: RouterParam;
    initialAddressLine1?: RouterParam;
  };
}

function firstString(value: RouterParam): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Picks up a deep-link `{ screen: 'GardenPlanViewer', gardenPlanId }` hint
 * forwarded by `app/(tabs)/gardening.tsx` from a push notification and
 * navigates into the viewer stack.
 *
 * Two safeguards on top of the obvious "navigate once":
 *   - Wait for the parent navigator to be ready (`navigation.isFocused()`)
 *     before pushing — on cold-start the timeout-based hack we used before
 *     could fire before the stack mounted on Android.
 *   - Clear the URL params via `router.setParams` after consuming them so
 *     a tab unmount/remount can't re-fire the same deep link.
 */
function NavigationHandler({
  initialParams,
  children,
}: {
  initialParams?: GardeningNavigatorProps['initialParams'];
  children: React.ReactNode;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<GardeningStackParamList>>();
  const hasNavigated = useRef<string | null>(null);
  const pendingNavigation = useGardeningNavigationStore((s) => s.pendingNavigation);
  const setPendingNavigation = useGardeningNavigationStore((s) => s.setPendingNavigation);

  useEffect(() => {
    const screen = firstString(initialParams?.screen);
    const gardenPlanId = firstString(initialParams?.gardenPlanId);
    const draftId = firstString(initialParams?.draftId);
    const initialAddressLine1 = firstString(initialParams?.initialAddressLine1);
    if (
      screen !== 'GardenPlanViewer' &&
      screen !== 'GardenPlanAddress' &&
      screen !== 'GardenPlanBoundaryConfirm'
    ) {
      return;
    }
    if (screen === 'GardenPlanViewer' && !gardenPlanId) return;
    if (screen === 'GardenPlanBoundaryConfirm' && !draftId) return;

    const navKey = `${screen}:${gardenPlanId ?? draftId ?? initialAddressLine1 ?? ''}`;
    if (hasNavigated.current === navKey) return;
    hasNavigated.current = navKey;

    let cancelled = false;
    navigateAfterInteractions(() => {
      if (cancelled) return;
      try {
        if (screen === 'GardenPlanAddress') {
          navigation.navigate('GardenPlanAddress', {
            initialAddressLine1,
          });
        } else if (screen === 'GardenPlanBoundaryConfirm' && draftId) {
          navigation.navigate('GardenPlanBoundaryConfirm', { draftId });
        } else if (gardenPlanId) {
          navigation.navigate('GardenPlanViewer', { gardenPlanId });
        }
      } catch (err) {
        if (__DEV__) {
          console.warn('[GardeningNavigator] deep-link navigate failed', err);
        }
        return;
      }
      // One-shot: drop the URL params so a later tab focus doesn't replay.
      try {
        router.setParams({
          screen: undefined,
          gardenPlanId: undefined,
          draftId: undefined,
          initialAddressLine1: undefined,
        });
      } catch {
        // expo-router can throw if the route is no longer mounted; ignore.
      }
    });

    return () => {
      cancelled = true;
    };
  }, [initialParams, navigation]);

  useEffect(() => {
    if (!pendingNavigation) return;

    const navKey = `pending:${JSON.stringify(pendingNavigation)}`;
    if (hasNavigated.current === navKey) return;
    hasNavigated.current = navKey;

    let cancelled = false;
    navigateAfterInteractions(() => {
      if (cancelled) return;
      if (pendingNavigation.screen === 'GardenPlanAddress') {
        navigation.navigate('GardenPlanAddress', {
          initialAddressLine1: pendingNavigation.initialAddressLine1,
        });
      } else if (pendingNavigation.screen === 'GardenPlanBoundaryConfirm') {
        navigation.navigate('GardenPlanBoundaryConfirm', {
          draftId: pendingNavigation.draftId,
        });
      } else {
        navigation.navigate('GardenPlanViewer', {
          gardenPlanId: pendingNavigation.gardenPlanId,
        });
      }
      setPendingNavigation(null);
    });

    return () => {
      cancelled = true;
    };
  }, [navigation, pendingNavigation, setPendingNavigation]);

  return <>{children}</>;
}

export function GardeningNavigator({ initialParams }: GardeningNavigatorProps = {}) {
  const setFocusedRoute = useTabBarVisibilityStore((s) => s.setFocusedRoute);

  return (
    <Stack.Navigator
      initialRouteName="GardeningMain"
      screenOptions={{
        headerShown: false,
        contentStyle: { flex: 1 },
      }}
      screenListeners={({ route }) => ({
        focus: () => {
          setFocusedRoute('Gardening', route.name as keyof GardeningStackParamList);
        },
        state: (event) => {
          const state = event.data.state;
          const focusedRoute = state.routes[state.index]?.name;
          if (focusedRoute) {
            setFocusedRoute('Gardening', focusedRoute);
          }
        },
      })}
    >
      <Stack.Screen name="GardeningMain">
        {() => (
          <NavigationHandler initialParams={initialParams}>
            <GardenPlansScreen />
          </NavigationHandler>
        )}
      </Stack.Screen>
      <Stack.Screen name="GardenPlanAddress" component={GardenPlanAddressScreen} />
      <Stack.Screen name="GardenPlanBoundaryConfirm" component={GardenPlanBoundaryConfirmScreen} />
      <Stack.Screen
        name="GardenPlanObjectEditor"
        component={GardenPlanObjectEditorScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="GardenPlanMapWizard"
        component={GardenPlanMapWizardScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen name="GardenPlanUpload" component={GardenPlanUploadScreen} />
      <Stack.Screen name="GardenPlanViewer" component={GardenPlanViewerScreen} />
    </Stack.Navigator>
  );
}
