import { Redirect } from 'expo-router';

import { isHouseBrand } from '@brand';
import { BriefingHistoryScreen } from '@screens/aihousekeeper/BriefingHistoryScreen';

export default function AihousekeeperBriefingsRoute() {
  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }
  return <BriefingHistoryScreen />;
}
