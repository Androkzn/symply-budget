import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useRef } from 'react';

import { HomeFeaturesScreen } from '@screens/home';
import {
  TasksScreen,
  ScheduleTaskScreen,
  TaskTemplatesScreen,
  CopyFromExistingTasksScreen,
  TaskDraftsScreen,
  TaskDraftDetailScreen,
  MaintenanceSetupScreen,
  TimeBudgetPlannerScreen,
} from '@screens/tasks';
import { ContractorSelectionScreen } from '@screens/tasks/ContractorSelectionScreen';
import { QuoteComparisonScreen } from '@screens/tasks/QuoteComparisonScreen';
import { QuoteManagementScreen } from '@screens/tasks/QuoteManagementScreen';
import { ScheduleWorkScreen } from '@screens/tasks/ScheduleWorkScreen';
import { navigateAfterInteractions } from '@services/nav-when-ready';

import { useScrollableFormPresentation, useTaskDetailFlowPresentation } from './presentation';
import { TaskDetailStackNavigator } from './TaskDetailStackNavigator';
import type { TasksStackParamList } from './types';

const Stack = createNativeStackNavigator<TasksStackParamList>();

interface TasksNavigatorProps {
  initialParams?: {
    screen?: string;
    reportId?: string;
    reportName?: string;
    taskId?: string;
    householdId?: string;
    draftId?: string;
    navNonce?: string;
  };
}

function NavigationHandler({
  initialParams,
  children,
}: {
  initialParams?: TasksNavigatorProps['initialParams'];
  children: React.ReactNode;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<TasksStackParamList>>();
  const hasNavigated = useRef<string | null>(null);

  useEffect(() => {
    const screen = initialParams?.screen;
    if (!screen) return;

    const navKey = `${screen}:${initialParams?.reportId || ''}:${initialParams?.taskId || ''}:${initialParams?.draftId || ''}:${initialParams?.navNonce || ''}`;
    if (hasNavigated.current === navKey) return;

    if (screen === 'TaskDrafts') {
      hasNavigated.current = navKey;
      const reportId = initialParams?.reportId;
      const reportName = initialParams?.reportName;
      navigateAfterInteractions(() =>
        navigation.navigate(
          'TaskDrafts',
          reportId ? { reportId, reportName } : undefined
        )
      );
    } else if (screen === 'TaskDraftDetail' && initialParams?.draftId) {
      hasNavigated.current = navKey;
      const draftId = initialParams.draftId;
      navigateAfterInteractions(() =>
        navigation.navigate('TaskDraftDetail', { draftId })
      );
    } else if (screen === 'TaskDetail' && initialParams?.taskId) {
      hasNavigated.current = navKey;
      const taskId = initialParams.taskId;
      const householdId = initialParams.householdId;
      navigateAfterInteractions(() =>
        navigation.navigate('TaskDetailFlow', {
          screen: 'TaskDetail',
          params: { taskId, householdId },
        })
      );
    } else if (screen === 'MaintenanceSetup') {
      hasNavigated.current = navKey;
      const reportId = initialParams?.reportId;
      navigateAfterInteractions(() =>
        navigation.navigate(
          'MaintenanceSetup',
          reportId ? { reportId } : undefined
        )
      );
    } else if (screen === 'ScheduleTask') {
      hasNavigated.current = navKey;
      const taskId = initialParams?.taskId;
      navigateAfterInteractions(() =>
        navigation.navigate('ScheduleTask', taskId ? { taskId } : undefined)
      );
    }
  }, [initialParams, navigation]);

  return <>{children}</>;
}

export function TasksNavigator({ initialParams }: TasksNavigatorProps = {}) {
  const detailFlowPresentation = useTaskDetailFlowPresentation('card');
  const taskFormPresentation = useScrollableFormPresentation('modal');

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
      initialRouteName="TasksMain"
    >
      <Stack.Screen name="TasksMain">
        {(props) => (
          <NavigationHandler initialParams={initialParams}>
            <TasksScreen {...props} />
          </NavigationHandler>
        )}
      </Stack.Screen>
      <Stack.Screen
        name="TaskDetailFlow"
        component={TaskDetailStackNavigator}
        options={{ presentation: detailFlowPresentation, contentStyle: { flex: 1 } }}
      />
      <Stack.Screen
        name="ScheduleTask"
        component={ScheduleTaskScreen}
        options={{
          presentation: taskFormPresentation,
          contentStyle: { flex: 1 },
        }}
      />
      <Stack.Screen
        name="TaskTemplates"
        component={TaskTemplatesScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="CopyFromExistingTasks"
        component={CopyFromExistingTasksScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="TaskDrafts"
        component={TaskDraftsScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="TaskDraftDetail"
        component={TaskDraftDetailScreen}
        options={{ presentation: detailFlowPresentation }}
      />
      <Stack.Screen
        name="MaintenanceSetup"
        component={MaintenanceSetupScreen}
        options={{
          presentation: taskFormPresentation,
          contentStyle: { flex: 1 },
        }}
      />
      <Stack.Screen
        name="HomeFeatures"
        component={HomeFeaturesScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="TimeBudgetPlanner"
        component={TimeBudgetPlannerScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="QuoteManagement"
        component={QuoteManagementScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="QuoteComparison"
        component={QuoteComparisonScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="ContractorSelection"
        component={ContractorSelectionScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="ScheduleWork"
        component={ScheduleWorkScreen}
        options={{ presentation: 'card' }}
      />
    </Stack.Navigator>
  );
}
