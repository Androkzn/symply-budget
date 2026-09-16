import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useRef } from 'react';

import {
  ContractorsListScreen,
  ContractorDetailScreen,
  AddEditContractorScreen,
  AddVisitScreen,
  ContractorSearchScreen,
  ContractorSearchResultsScreen,
  ComposeContractorEmailScreen,
  MessagesScreen,
  ConversationScreen,
} from '@screens/contractors';
import {
  LaborHubDashboard,
  AppointmentsScreen,
  AppointmentDetailScreen,
  AddEditAppointmentScreen,
  QuotesScreen,
  QuoteDetailScreen,
  RequestQuoteScreen,
  QuoteComparisonScreen,
  ProjectsScreen,
  ProjectDetailScreen,
  AddEditProjectScreen,
  ChecklistsScreen,
  ChecklistEditorScreen,
  VisitModeScreen,
  AITechnicalInfoScreen,
} from '@screens/labor-hub';
import { navigateAfterInteractions } from '@services/nav-when-ready';

// Labor Hub screens

import type { ContractorsStackParamList } from './types';

const Stack = createNativeStackNavigator<ContractorsStackParamList>();

interface ContractorsNavigatorProps {
  initialParams?: {
    screen?: string;
    params?: Record<string, unknown>;
    problemTitle?: string;
    problemDescription?: string;
    systemCategory?: string;
    sourceType?: string;
    sourceId?: string;
    projectId?: string;
    quoteId?: string;
    contractorId?: string;
    contractorName?: string;
  };
}

// Wrapper component to handle navigation after mount
function NavigationHandler({
  initialParams,
  children
}: {
  initialParams?: ContractorsNavigatorProps['initialParams'];
  children: React.ReactNode;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<ContractorsStackParamList>>();
  const hasNavigated = useRef<string | null>(null);

  useEffect(() => {
    // Check if we have search params and haven't navigated for this sourceId yet
    const hasSearchParams = initialParams?.screen === 'ContractorSearch' ||
      (initialParams?.problemTitle && initialParams?.sourceType);

    const currentSourceId = initialParams?.sourceId;

    if (hasSearchParams && currentSourceId && hasNavigated.current !== currentSourceId) {
      hasNavigated.current = currentSourceId;

      const searchParams = {
        problemTitle: initialParams?.problemTitle || '',
        problemDescription: initialParams?.problemDescription || '',
        systemCategory: initialParams?.systemCategory || 'other',
        sourceType: (initialParams?.sourceType || 'task') as 'task',
        sourceId: initialParams?.sourceId || '',
      };

      navigateAfterInteractions(() => {
        navigation.navigate('ContractorSearch', searchParams);
      });
      return;
    }

    // Generic screen forwarding for entry points like Projects/ProjectDetail/Quotes/QuoteDetail
    const screen = initialParams?.screen;
    if (!screen) return;

    // Build a stable key so we don't re-navigate on every render
    const navKey = `${screen}:${initialParams?.projectId || ''}:${initialParams?.quoteId || ''}`;
    if (hasNavigated.current === navKey) return;

    if (screen === 'Projects') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('Projects'));
    } else if (screen === 'ProjectDetail' && initialParams?.projectId) {
      hasNavigated.current = navKey;
      const projectId = initialParams.projectId;
      navigateAfterInteractions(() =>
        navigation.navigate('ProjectDetail', { projectId }),
      );
    } else if (screen === 'Quotes') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('Quotes'));
    } else if (screen === 'Appointments') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('Appointments'));
    } else if (screen === 'Checklists') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('Checklists'));
    } else if (screen === 'QuoteDetail' && initialParams?.quoteId) {
      hasNavigated.current = navKey;
      const quoteId = initialParams.quoteId;
      navigateAfterInteractions(() =>
        navigation.navigate('QuoteDetail', { quoteId }),
      );
    } else if (screen === 'Messages') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('Messages'));
    } else if (screen === 'ContractorSearch') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('ContractorSearch'));
    } else if (screen === 'Conversation' && initialParams?.contractorId) {
      hasNavigated.current = navKey;
      const contractorId = String(initialParams.contractorId);
      const contractorName = String(initialParams.contractorName ?? 'Contractor');
      navigateAfterInteractions(() =>
        navigation.navigate('Conversation', { contractorId, contractorName }),
      );
    }
  }, [initialParams, navigation]);

  return <>{children}</>;
}

export function ContractorsNavigator({ initialParams }: ContractorsNavigatorProps) {
  return (
    <Stack.Navigator
      initialRouteName="LaborHubDashboard"
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      {/* Labor Hub Dashboard - Main Entry Point */}
      <Stack.Screen name="LaborHubDashboard">
        {() => (
          <NavigationHandler initialParams={initialParams}>
            <LaborHubDashboard />
          </NavigationHandler>
        )}
      </Stack.Screen>

      {/* Contractors */}
      <Stack.Screen name="ContractorsList" component={ContractorsListScreen} />
      <Stack.Screen name="ContractorDetail" component={ContractorDetailScreen} />
      <Stack.Screen name="AddEditContractor" component={AddEditContractorScreen} />
      <Stack.Screen name="AddVisit" component={AddVisitScreen} />
      <Stack.Screen name="ContractorSearch" component={ContractorSearchScreen} />
      <Stack.Screen name="ContractorSearchResults" component={ContractorSearchResultsScreen} />
      <Stack.Screen name="ComposeContractorEmail" component={ComposeContractorEmailScreen} />

      {/* Appointments */}
      <Stack.Screen name="Appointments" component={AppointmentsScreen} />
      <Stack.Screen name="AppointmentDetail" component={AppointmentDetailScreen} />
      <Stack.Screen name="AddEditAppointment" component={AddEditAppointmentScreen} />

      {/* Quotes */}
      <Stack.Screen name="Quotes" component={QuotesScreen} />
      <Stack.Screen name="QuoteDetail" component={QuoteDetailScreen} />
      <Stack.Screen name="RequestQuote" component={RequestQuoteScreen} />
      <Stack.Screen name="QuoteComparison" component={QuoteComparisonScreen} />

      {/* Projects */}
      <Stack.Screen name="Projects" component={ProjectsScreen} />
      <Stack.Screen name="ProjectDetail" component={ProjectDetailScreen} />
      <Stack.Screen name="AddEditProject" component={AddEditProjectScreen} />

      {/* Checklists & Visit Mode */}
      <Stack.Screen name="Checklists" component={ChecklistsScreen} />
      <Stack.Screen name="ChecklistEditor" component={ChecklistEditorScreen} />
      <Stack.Screen name="VisitMode" component={VisitModeScreen} />
      <Stack.Screen name="AITechnicalInfo" component={AITechnicalInfoScreen} />

      {/* Messages */}
      <Stack.Screen name="Messages" component={MessagesScreen} />
      <Stack.Screen name="Conversation" component={ConversationScreen} />
    </Stack.Navigator>
  );
}
