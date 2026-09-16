import { Redirect } from 'expo-router';

import { isHouseBrand } from '@brand';
import { AihousekeeperConnectedAccountsScreen } from '@screens/settings/AihousekeeperConnectedAccountsScreen';

export default function AihousekeeperConnectedAccountsRoute() {
  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }
  return <AihousekeeperConnectedAccountsScreen />;
}
