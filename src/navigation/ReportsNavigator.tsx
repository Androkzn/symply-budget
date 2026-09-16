import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useRef } from 'react';

import { ReportsScreen, ReportDetailScreen } from '@screens/reports';
import { navigateAfterInteractions } from '@services/nav-when-ready';

import { useModalPresentation } from './presentation';
import type { ReportsStackParamList } from './types';

const Stack = createNativeStackNavigator<ReportsStackParamList>();

interface ReportsNavigatorProps {
  initialParams?: {
    screen?: string;
    reportId?: string;
    householdId?: string;
  };
}

function NavigationHandler({
  initialParams,
  children,
}: {
  initialParams?: ReportsNavigatorProps['initialParams'];
  children: React.ReactNode;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<ReportsStackParamList>>();
  const hasNavigated = useRef<string | null>(null);

  useEffect(() => {
    const screen = initialParams?.screen;
    if (!screen) return;

    const navKey = `${screen}:${initialParams?.reportId || ''}:${initialParams?.householdId || ''}`;
    if (hasNavigated.current === navKey) return;

    if (
      screen === 'ReportDetail' &&
      initialParams?.reportId &&
      initialParams?.householdId
    ) {
      hasNavigated.current = navKey;
      const reportId = initialParams.reportId;
      const householdId = initialParams.householdId;
      navigateAfterInteractions(() =>
        navigation.navigate('ReportDetail', { reportId, householdId })
      );
    }
  }, [initialParams, navigation]);

  return <>{children}</>;
}

export function ReportsNavigator({ initialParams }: ReportsNavigatorProps = {}) {
  // On iPad regular width, detail opens as a form sheet (list stays visible behind).
  // On phone, detail pushes as a standard card.
  const detailPresentation = useModalPresentation('card');
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
      initialRouteName="ReportsMain"
    >
      <Stack.Screen name="ReportsMain">
        {(props) => (
          <NavigationHandler initialParams={initialParams}>
            <ReportsScreen {...props} />
          </NavigationHandler>
        )}
      </Stack.Screen>
      <Stack.Screen
        name="ReportDetail"
        component={ReportDetailScreen}
        options={{ presentation: detailPresentation }}
      />
    </Stack.Navigator>
  );
}
