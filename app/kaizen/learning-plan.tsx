import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { LearningPlanScreen } from '@features/kaizen/screens/LearningPlanScreen';

export default function Kaizen_LearningPlanScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <LearningPlanScreen />;
}
