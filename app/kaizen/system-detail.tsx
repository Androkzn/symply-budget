import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { SystemDetailScreen } from '@features/kaizen/screens/SystemDetailScreen';

export default function Kaizen_SystemDetailScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <SystemDetailScreen />;
}
