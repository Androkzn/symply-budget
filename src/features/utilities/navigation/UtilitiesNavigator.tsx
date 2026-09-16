import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import {
  UtilitiesScreen,
  UtilityBillsScreen,
  AddUtilityBillScreen,
  ConfirmBillPaymentsScreen,
  UtilityDetailScreen,
  PropertyTaxScreen,
  AddPropertyTaxScreen,
  UtilityChartsScreen,
  UtilitySettingsScreen,
  UtilityProviderScreen,
} from '@features/utilities/screens';

import type { UtilitiesStackParamList } from './types';

const Stack = createNativeStackNavigator<UtilitiesStackParamList>();

export function UtilitiesNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
      initialRouteName="UtilitiesMain"
    >
      <Stack.Screen name="UtilitiesMain" component={UtilitiesScreen} />
      <Stack.Screen name="UtilityBills" component={UtilityBillsScreen} />
      <Stack.Screen name="AddUtilityBill" component={AddUtilityBillScreen} />
      <Stack.Screen name="ConfirmBillPayments" component={ConfirmBillPaymentsScreen} />
      <Stack.Screen name="UtilityDetail" component={UtilityDetailScreen} options={{ presentation: 'card' }} />
      <Stack.Screen name="PropertyTax" component={PropertyTaxScreen} options={{ presentation: 'card' }} />
      <Stack.Screen name="AddPropertyTax" component={AddPropertyTaxScreen} options={{ presentation: 'card' }} />
      <Stack.Screen name="UtilityCharts" component={UtilityChartsScreen} options={{ presentation: 'card' }} />
      <Stack.Screen name="UtilitySettings" component={UtilitySettingsScreen} options={{ presentation: 'card' }} />
      <Stack.Screen
        name="UtilityProvider"
        component={UtilityProviderScreen}
        options={{ presentation: 'card' }}
      />
    </Stack.Navigator>
  );
}
