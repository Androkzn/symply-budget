import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { BookDetailScreen } from '@features/kaizen/screens/BookDetailScreen';

export default function Kaizen_BookDetailScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <BookDetailScreen />;
}
