import { Redirect } from 'expo-router';

import { isKaizenBrand, KaizenSystemsScreen } from '@features/kaizen';

/** Kaizen Systems section as a first-class (customizable) tab. */
export default function KaizenSystemsTab() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <KaizenSystemsScreen />;
}
