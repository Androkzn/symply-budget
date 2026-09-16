import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { InterviewPipelineScreen } from '@features/kaizen/screens/InterviewPipelineScreen';

export default function Kaizen_InterviewPipelineScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <InterviewPipelineScreen />;
}
