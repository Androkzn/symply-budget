import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { CareerProgressScreen } from '@features/kaizen/screens/CareerProgressScreen';

export default function Kaizen_CareerProgressScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <CareerProgressScreen />;
}
