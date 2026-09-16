import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { QuestionImportScreen } from '@features/kaizen/screens/QuestionImportScreen';

export default function Kaizen_QuestionImportScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <QuestionImportScreen />;
}
