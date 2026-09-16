import React from 'react';

import { SoftTransferFlowScreen } from '@features/ecosystem';

/** Budget stack — import a shared property/profile summary into Budget. */
export function SoftTransferImportScreen() {
  return (
    <SoftTransferFlowScreen
      title="Import a shared summary"
      preset="house-to-budget"
    />
  );
}
