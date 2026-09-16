import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { BooksScreen } from '@features/kaizen/screens/BooksScreen';

export default function Kaizen_BooksScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <BooksScreen />;
}
