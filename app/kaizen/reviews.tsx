import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { ReviewsScreen } from '@features/kaizen/screens/ReviewsScreen';

export default function Kaizen_ReviewsScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <ReviewsScreen />;
}
