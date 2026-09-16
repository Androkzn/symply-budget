import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { PracticeSessionScreen } from '@features/kaizen/screens/PracticeSessionScreen';

export default function Kaizen_PracticeSessionScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <PracticeSessionScreen />;
}
