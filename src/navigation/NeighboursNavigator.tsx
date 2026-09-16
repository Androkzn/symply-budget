import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { router } from 'expo-router';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useRef } from 'react';

import {
  AddEditNeighbourScreen,
  NeighbourDetailScreen,
  NeighbourImportContactsScreen,
  NeighbourPickOnMapScreen,
  NeighbourhoodsScreen,
  NeighboursMapScreen,
} from '@screens/neighbours';
import { navigateAfterInteractions } from '@services/nav-when-ready';

import type { NeighboursStackParamList } from './types';

const Stack = createNativeStackNavigator<NeighboursStackParamList>();

type RouterParam = string | string[] | undefined;

interface NeighboursNavigatorProps {
  initialParams?: {
    screen?: RouterParam;
    neighbourId?: RouterParam;
  };
}

function firstString(value: RouterParam): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Deep-link handoff, the same shape `HomeProjectsNavigator` uses.
 *
 * `/neighbours?neighbourId=…` opens straight onto that home — the link a
 * notification or an AI Housekeeper suggestion would carry. The map is still
 * pushed underneath it, so Back lands somewhere sensible rather than closing the
 * feature.
 */
function NavigationHandler({
  initialParams,
  children,
}: {
  initialParams?: NeighboursNavigatorProps['initialParams'];
  children: React.ReactNode;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<NeighboursStackParamList>>();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const screen = firstString(initialParams?.screen);
    const neighbourId = firstString(initialParams?.neighbourId);
    if (!screen && !neighbourId) return;

    const key = `${screen ?? ''}:${neighbourId ?? ''}`;
    if (handled.current === key) return;
    handled.current = key;

    let cancelled = false;
    navigateAfterInteractions(() => {
      if (cancelled) return;
      try {
        if (neighbourId) {
          navigation.navigate('NeighbourDetail', { neighbourId });
        } else if (screen === 'Neighbourhoods') {
          navigation.navigate('Neighbourhoods');
        }
      } catch (err) {
        if (__DEV__) console.warn('[NeighboursNavigator] deep-link navigate failed', err);
        return;
      }
      try {
        router.setParams({ screen: undefined, neighbourId: undefined });
      } catch {
        // ignore
      }
    });

    return () => {
      cancelled = true;
    };
  }, [initialParams, navigation]);

  return <>{children}</>;
}

export function NeighboursNavigator({ initialParams }: NeighboursNavigatorProps = {}) {
  return (
    <NavigationHandler initialParams={initialParams}>
      {/* Native header off everywhere in this app — every screen renders its own
          shared `ScreenHeader` with a `BackButton`, so Neighbours matches the
          rest of the fleet. */}
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="NeighboursMap" component={NeighboursMapScreen} />
        <Stack.Screen name="NeighbourPickOnMap" component={NeighbourPickOnMapScreen} />
        <Stack.Screen name="AddEditNeighbour" component={AddEditNeighbourScreen} />
        <Stack.Screen name="NeighbourDetail" component={NeighbourDetailScreen} />
        <Stack.Screen name="Neighbourhoods" component={NeighbourhoodsScreen} />
        <Stack.Screen name="NeighbourImportContacts" component={NeighbourImportContactsScreen} />
      </Stack.Navigator>
    </NavigationHandler>
  );
}
