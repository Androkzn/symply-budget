import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { SettingsScreen } from '@features/kaizen/screens/SettingsScreen';

export default function Kaizen_SettingsScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <SettingsScreen />;
}
