import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { SkillDetailScreen } from '@features/kaizen/screens/SkillDetailScreen';

export default function Kaizen_SkillDetailScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <SkillDetailScreen />;
}
