import { Redirect, useLocalSearchParams } from 'expo-router';

import { isHouseBrand } from '@brand';
import { GardeningNavigator } from '@navigation/GardeningNavigator';

export default function GardeningTab() {
  const params = useLocalSearchParams();
  // Gardening is a House-only feature; child apps bounce to home if reached.
  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }
  return <GardeningNavigator initialParams={params} />;
}
