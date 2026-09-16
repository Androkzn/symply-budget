import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { BookQuizScreen } from '@features/kaizen/screens/BookQuizScreen';

export default function Kaizen_BookQuizScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <BookQuizScreen />;
}
