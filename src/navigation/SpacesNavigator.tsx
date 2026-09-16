import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { SpacesManagementScreen, SpaceDetailScreen } from '@screens/spaces';

import type { SettingsStackParamList } from './types';

/**
 * Spaces as a first-class tab (House). The two screens keep living in the
 * Settings stack too — they are pushed from Floor Plans and from deep links —
 * so this navigator reuses `SettingsStackParamList` rather than declaring a
 * parallel param list that would fork the screens' navigation typing.
 *
 * Native headers are off across the app; each screen renders its own
 * `ScreenHeader`.
 */
const Stack = createNativeStackNavigator<SettingsStackParamList>();

export function SpacesNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="SpacesManagement"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="SpacesManagement" component={SpacesManagementScreen} />
      <Stack.Screen name="SpaceDetail" component={SpaceDetailScreen} />
    </Stack.Navigator>
  );
}
