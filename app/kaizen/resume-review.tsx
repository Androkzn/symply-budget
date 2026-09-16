import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { ResumeReviewScreen } from '@features/kaizen/screens/ResumeReviewScreen';

export default function Kaizen_ResumeReviewScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <ResumeReviewScreen />;
}
