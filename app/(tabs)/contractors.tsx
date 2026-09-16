import { Redirect, useLocalSearchParams } from 'expo-router';

import { isHouseBrand } from '@brand';
import { ContractorsNavigator } from '@navigation/ContractorsNavigator';

export default function ContractorsTab() {
  const params = useLocalSearchParams();

  // Contractors / pros are a House-only feature; child apps bounce home.
  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }

  // Pass any navigation params to the ContractorsNavigator
  return <ContractorsNavigator initialParams={params} />;
}
