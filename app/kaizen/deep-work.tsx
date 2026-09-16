import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { DeepWorkScreen } from '@features/kaizen/screens/DeepWorkScreen';

export default function Kaizen_DeepWorkScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <DeepWorkScreen />;
}
