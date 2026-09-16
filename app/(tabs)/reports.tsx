import { Redirect, useLocalSearchParams } from 'expo-router';

import { isHouseBrand } from '@brand';
import { ReportsNavigator } from '@navigation/ReportsNavigator';

export default function ReportsTab() {
  const params = useLocalSearchParams();
  // Home reports are a House-only feature; child apps bounce home.
  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }
  return <ReportsNavigator initialParams={params} />;
}
