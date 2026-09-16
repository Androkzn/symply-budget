import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { BookReaderScreen } from '@features/kaizen/screens/BookReaderScreen';

export default function Kaizen_BookReaderScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <BookReaderScreen />;
}
