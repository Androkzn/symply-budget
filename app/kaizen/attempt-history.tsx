import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { AttemptHistoryScreen } from '@features/kaizen/screens/AttemptHistoryScreen';

export default function Kaizen_AttemptHistoryScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <AttemptHistoryScreen />;
}
