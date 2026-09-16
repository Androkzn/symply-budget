// Aihousekeeper tab route — `/mira`. Symply Kaizen uses this slot for Guide.
import { Redirect } from 'expo-router';

import { isHouseBrand } from '@brand';
import {
  isKaizenBrand,
  KaizenGuideScreen,
} from '@features/kaizen';
import { AihousekeeperChatScreen } from '@screens/aihousekeeper/AihousekeeperChatScreen';

export default function MiraTab() {
  if (isKaizenBrand()) {
    return <KaizenGuideScreen />;
  }
  // The AI Housekeeper is a House-only feature. Child apps (Budget, etc.) don't
  // show it — the route stays registered but bounces to home if reached via a
  // stale deep link (`<scheme>://mira`) or programmatic push.
  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }
  // Always a tab root: the floating tab bar is present, so the composer needs
  // clearance above it and the back arrow is hidden (leave via the tab bar).
  return <AihousekeeperChatScreen isTabRoot />;
}
