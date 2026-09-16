import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { QuestionBanksScreen } from '@features/kaizen/screens/QuestionBanksScreen';

export default function Kaizen_QuestionBanksScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <QuestionBanksScreen />;
}
