import { Redirect } from 'expo-router';

import { isHouseBrand } from '@brand';
import { ApprovalsScreen } from '@screens/aihousekeeper/ApprovalsScreen';

export default function AihousekeeperApprovalsRoute() {
  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }
  return <ApprovalsScreen />;
}
