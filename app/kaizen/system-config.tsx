import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { SystemConfigScreen } from '@features/kaizen/screens/SystemConfigScreen';

export default function Kaizen_SystemConfigScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <SystemConfigScreen />;
}
