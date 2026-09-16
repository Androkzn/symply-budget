import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { GarbageScheduleScreen, CategoryDetailScreen, ReminderSettingsScreen } from '@screens/garbage';

import type { GarbageStackParamList } from './types';

const Stack = createNativeStackNavigator<GarbageStackParamList>();

export function GarbageNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
      initialRouteName="GarbageMain"
    >
      <Stack.Screen
        name="GarbageMain"
        component={GarbageScheduleScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="CategoryDetail"
        component={CategoryDetailScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="ReminderSettings"
        component={ReminderSettingsScreen}
        options={{ presentation: 'card' }}
      />
    </Stack.Navigator>
  );
}
