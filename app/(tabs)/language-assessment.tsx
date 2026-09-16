import { Redirect } from 'expo-router';

import { isLanguageBrand, LanguageAssessmentScreen } from '@features/language';

/** Language Assessment section as a first-class (customizable) tab. */
export default function LanguageAssessmentTab() {
  if (!isLanguageBrand()) {
    return <Redirect href="/" />;
  }
  return <LanguageAssessmentScreen />;
}
