import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { WeeklyRotationScreen } from '@features/kaizen/screens/WeeklyRotationScreen';

export default function Kaizen_WeeklyRotationScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <WeeklyRotationScreen />;
}
