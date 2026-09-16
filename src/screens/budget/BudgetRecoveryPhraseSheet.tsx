import React from 'react';

import { RecoveryPhraseSheet } from '@components/backup/RecoveryPhraseSheet';
import type { BudgetBackupLocation } from '@features/budget/local/backup/backupFileAccess';
import { BUDGET_RECOVERY_PHRASE_APP } from '@features/budget/local/backup/recoveryPhraseFile';

interface Props {
  visible: boolean;
  /** The 12 words. Empty while the phrase is still being fetched. */
  phrase: string;
  /** Why the sheet opened — one line above the words. */
  intro?: string;
  /** Where the backup that minted this phrase landed, or null when re-reading. */
  savedTo?: BudgetBackupLocation | null;
  onClose: () => void;
}

/**
 * Budget's binding of the shared recovery-phrase sheet.
 *
 * The sheet itself moved to `@components/backup/RecoveryPhraseSheet` when House
 * needed the same one. Everything Budget-specific is bound here, and most of it
 * rides in on the app descriptor rather than on props: the .txt heading, and —
 * through `BUDGET_RECOVERY_PHRASE_APP.destinations` — the three destinations,
 * the Drive folder row and its picker. Only the `budget-recovery-phrase-*`
 * testID prefix the E2E flows drive is passed separately.
 */
export function BudgetRecoveryPhraseSheet({ visible, phrase, intro, savedTo, onClose }: Props) {
  return (
    <RecoveryPhraseSheet
      visible={visible}
      phrase={phrase}
      intro={intro}
      savedTo={savedTo ?? null}
      app={BUDGET_RECOVERY_PHRASE_APP}
      testIDPrefix="budget-recovery-phrase"
      onClose={onClose}
    />
  );
}
