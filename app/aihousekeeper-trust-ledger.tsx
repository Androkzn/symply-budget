import { Redirect } from 'expo-router';

import { isHouseBrand } from '@brand';
import { TrustLedgerScreen } from '@screens/aihousekeeper/TrustLedgerScreen';

export default function AihousekeeperTrustLedgerRoute() {
  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }
  return <TrustLedgerScreen />;
}
