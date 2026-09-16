import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { InsightsScreen } from '@features/kaizen/screens/InsightsScreen';

export default function Kaizen_InsightsScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <InsightsScreen />;
}
