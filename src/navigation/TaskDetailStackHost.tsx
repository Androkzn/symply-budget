import { NavigationContainer, NavigationIndependentTree } from "expo-router/react-navigation";
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import {
  TaskDetailStackNavigator,
  type TaskDetailStackInitialParams,
} from './TaskDetailStackNavigator';

type TaskDetailStackHostProps = {
  initialTask: TaskDetailStackInitialParams;
};

/**
 * Isolated navigation host for task detail → edit when embedded outside the
 * parent Tasks stack (iPad split-view detail pane, Home bottom sheet).
 */
export function TaskDetailStackHost({ initialTask }: TaskDetailStackHostProps) {
  return (
    <GestureHandlerRootView style={styles.flex}>
      <NavigationIndependentTree>
        <NavigationContainer>
          <View style={styles.flex}>
            <TaskDetailStackNavigator initialTask={initialTask} />
          </View>
        </NavigationContainer>
      </NavigationIndependentTree>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
