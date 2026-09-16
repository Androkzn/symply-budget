import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { CareerSetupScreen } from '@features/kaizen/screens/CareerSetupScreen';

export default function Kaizen_CareerSetupScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <CareerSetupScreen />;
}
