import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { MemorySettingsScreen } from '@features/kaizen/screens/MemorySettingsScreen';

export default function Kaizen_MemorySettingsScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <MemorySettingsScreen />;
}
