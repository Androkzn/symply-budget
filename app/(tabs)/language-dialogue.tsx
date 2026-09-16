import { Redirect } from 'expo-router';

import { isLanguageBrand, LanguageDialogueScreen } from '@features/language';

/** Language Dialogue section as a first-class (customizable) tab. */
export default function LanguageDialogueTab() {
  if (!isLanguageBrand()) {
    return <Redirect href="/" />;
  }
  return <LanguageDialogueScreen />;
}
