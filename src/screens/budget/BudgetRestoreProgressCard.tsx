import React from 'react';

import { RestoreProgressCard } from '@components/backup/RestoreProgressCard';
import { BUDGET_RESTORE_ESTIMATE_MS } from '@features/budget/local/backup/restoreTaskStore';

export { resumeFillFraction } from '@components/backup/RestoreProgressCard';

type Props = {
  /** 0–1 floor reported by the restore itself. */
  progress: number;
  /** Stage wording, e.g. "Decrypting…". */
  label: string;
  /** When the run claimed the slot — what makes resuming mid-run possible. */
  startedAt: number | null;
  estimateMs?: number;
  testID?: string;
};

/**
 * Budget's binding of the shared restore progress card.
 *
 * The card moved to `@components/backup/RestoreProgressCard` when House needed
 * the same UI-thread bar; the Budget estimate and wording are bound here.
 */
export function BudgetRestoreProgressCard({
  progress,
  label,
  startedAt,
  estimateMs = BUDGET_RESTORE_ESTIMATE_MS,
  testID,
}: Props) {
  return (
    <RestoreProgressCard
      progress={progress}
      label={label}
      startedAt={startedAt}
      estimateMs={estimateMs}
      title="Restoring your budget"
      testID={testID}
    />
  );
}
