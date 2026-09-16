import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import React from 'react';

import type { SettingsStackParamList } from '@navigation/types';

import { SoftTransferFlowScreen } from './SoftTransferFlowScreen';

type SoftTransferFlowRoute = RouteProp<SettingsStackParamList, 'SoftTransferFlow'>;

/** Route-param wrapper for stack navigators. */
export function SoftTransferFlowRouteScreen() {
  const route = useRoute<SoftTransferFlowRoute>();
  const params = route.params ?? {};
  return (
    <SoftTransferFlowScreen
      title={params.title ?? 'Soft Transfer'}
      preset={params.preset}
      fixedPackageId={params.fixedPackageId}
    />
  );
}
