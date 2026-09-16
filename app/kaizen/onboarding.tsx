import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { OnboardingScreen } from '@features/kaizen/screens/OnboardingScreen';

export default function Kaizen_OnboardingScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <OnboardingScreen />;
}
