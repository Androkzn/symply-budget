import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { KaizenFileUploadScreen } from '@features/kaizen/screens/KaizenFileUploadScreen';

export default function Kaizen_FileUploadScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <KaizenFileUploadScreen />;
}
