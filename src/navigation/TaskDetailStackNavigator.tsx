import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { ScheduleTaskScreen, TaskDetailScreen } from '@screens/tasks';

import type { TaskDetailStackParamList } from './types';

const Stack = createNativeStackNavigator<TaskDetailStackParamList>();

export type TaskDetailStackInitialParams = {
  taskId: string;
  householdId?: string;
};

type TaskDetailStackNavigatorProps = {
  /** Used when embedded in iPad split view or Home bottom sheet (no parent route). */
  initialTask?: TaskDetailStackInitialParams;
};

/**
 * Nested stack for task detail → edit. Keeps edit as an in-stack push (card)
 * instead of a sibling modal/formSheet on the parent Tasks stack, which breaks
 * touch handling on iPad.
 */
export function TaskDetailStackNavigator({ initialTask }: TaskDetailStackNavigatorProps = {}) {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { flex: 1 },
      }}
    >
      <Stack.Screen
        name="TaskDetail"
        component={TaskDetailScreen}
        initialParams={initialTask}
      />
      <Stack.Screen name="ScheduleTask" component={ScheduleTaskScreen} />
    </Stack.Navigator>
  );
}
