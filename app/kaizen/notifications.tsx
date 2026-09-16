import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { NotificationsScreen } from '@features/kaizen/screens/NotificationsScreen';

export default function Kaizen_NotificationsScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <NotificationsScreen />;
}
