import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { SkillAssessmentScreen } from '@features/kaizen/screens/SkillAssessmentScreen';

export default function Kaizen_SkillAssessmentScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <SkillAssessmentScreen />;
}
