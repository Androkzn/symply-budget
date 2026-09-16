import { Redirect } from 'expo-router';

import { isHouseBrand } from '@brand';
import { AihousekeeperSettingsScreen } from '@screens/settings/AihousekeeperSettingsScreen';

export default function AihousekeeperSettingsRoute() {
  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }
  return <AihousekeeperSettingsScreen />;
}
