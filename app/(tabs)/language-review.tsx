import { Redirect } from 'expo-router';

import { isLanguageBrand, LanguageReviewScreen } from '@features/language';

/** Language Review section as a first-class (customizable) tab. */
export default function LanguageReviewTab() {
  if (!isLanguageBrand()) {
    return <Redirect href="/" />;
  }
  return <LanguageReviewScreen />;
}
