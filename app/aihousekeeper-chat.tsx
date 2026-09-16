import { Redirect } from 'expo-router';

import { isHouseBrand } from '@brand';
import { AihousekeeperChatScreen } from '@screens/aihousekeeper/AihousekeeperChatScreen';

export default function AihousekeeperChatRoute() {
  // AI Housekeeper is a House-only feature; child apps bounce home.
  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }
  // Pushed above the tabs (no floating tab bar here): show the back arrow and
  // skip the tab-bar clearance so the composer sits at the bottom safe area.
  return <AihousekeeperChatScreen isTabRoot={false} />;
}
