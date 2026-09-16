import { Redirect } from 'expo-router';

import { isUtilitiesEnabled, UtilitiesNavigator } from '@features/utilities';

export default function UtilitiesTab() {
  // Utilities is a House-only feature and is independent of the Budget product.
  // Brands without the `utilities` capability are 404'd by the Worker anyway
  // (backend `gateHomeApiPaths`), so the client refuses to mount it too.
  if (!isUtilitiesEnabled()) {
    return <Redirect href="/" />;
  }
  return <UtilitiesNavigator />;
}
