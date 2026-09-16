import { Redirect } from 'expo-router';

import { isKaizenBrand, KaizenAssessScreen } from '@features/kaizen';

/** Kaizen Assess section as a first-class (customizable) tab. */
export default function KaizenAssessTab() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <KaizenAssessScreen />;
}
