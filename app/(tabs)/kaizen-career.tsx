import { Redirect } from 'expo-router';

import { isKaizenBrand, KaizenCareerScreen } from '@features/kaizen';

/** Kaizen Career section as a first-class (customizable) tab. */
export default function KaizenCareerTab() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <KaizenCareerScreen />;
}
