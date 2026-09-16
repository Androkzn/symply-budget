import { Redirect, useLocalSearchParams } from 'expo-router';

import { isHouseBrand } from '@brand';
import { TasksNavigator } from '@navigation/TasksNavigator';

export default function TasksTab() {
  const params = useLocalSearchParams();
  // Home tasks / smart-task assistant are House-only; child apps bounce home.
  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }
  return <TasksNavigator initialParams={params} />;
}
