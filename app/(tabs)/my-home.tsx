import { Redirect } from 'expo-router';

import { isHouseBrand } from '@brand';
import { MyHomeScreen } from '@screens/main/MyHomeScreen';

export default function MyHomeTab() {
  // My Home (spaces / property ops) is a House-only feature; child apps bounce home.
  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }
  return <MyHomeScreen />;
}
