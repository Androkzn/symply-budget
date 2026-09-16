import { Redirect } from 'expo-router';

import { isLanguageBrand, LanguagePlanScreen } from '@features/language';

/** Language Plan section as a first-class (customizable) tab. */
export default function LanguagePlanTab() {
  if (!isLanguageBrand()) {
    return <Redirect href="/" />;
  }
  return <LanguagePlanScreen />;
}
