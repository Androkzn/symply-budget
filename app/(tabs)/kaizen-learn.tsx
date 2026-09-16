import { Redirect } from 'expo-router';

import { isKaizenBrand, KaizenLearnScreen } from '@features/kaizen';

/** Kaizen Learn section as a first-class (customizable) tab. */
export default function KaizenLearnTab() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <KaizenLearnScreen />;
}
