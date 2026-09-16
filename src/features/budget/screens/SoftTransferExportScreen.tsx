import React from 'react';

import { SoftTransferFlowScreen } from '@features/ecosystem';

/** Budget stack — export budget.summary as a shareable summary. */
export function SoftTransferExportScreen() {
  return (
    <SoftTransferFlowScreen
      title="Share a summary"
      preset="budget-to-house"
      fixedPackageId="budget.summary.v1"
    />
  );
}
