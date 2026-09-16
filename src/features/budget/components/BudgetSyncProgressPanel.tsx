import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { ProgressBar } from '@components/ui/ProgressBar';
import { formatRecordCount } from '@features/budget/local/sync/syncInventory';
import {
  describeSyncStage,
  useBudgetSyncStatusStore,
} from '@features/budget/local/sync/syncStatusStore';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

/**
 * What the sync is DOING, while it does it.
 *
 * The budget did not use to need this: a mailbox round is two seconds and a
 * spinner covers it. A join is not that. The first sync after being let into a
 * household reaches the control plane, waits for the household key, downloads a
 * snapshot that can be years of budget across several chunks, and only then
 * merges. Behind one undifferentiated "Syncing…" every one of those looks
 * identical to a hang — and the member is staring at a budget that is genuinely
 * incomplete while it happens, which is precisely when silence gets read as
 * "the app lost my data".
 *
 * Two states, and the difference is the whole point of the component:
 *
 *  - BACKFILLING — this device is still owed the household's history. The copy
 *    says so, and says the data lands all at once, because the alternative
 *    reading of a half-populated budget is that it is broken.
 *  - a plain sync — a step label, no alarm.
 *
 * Renders nothing when there is nothing to report, so callers place it
 * unconditionally next to `BudgetJoinWaitingPanel`.
 */
export function BudgetSyncProgressPanel() {
  const colors = useAppColors();
  const stage = useBudgetSyncStatusStore((s) => s.stage);
  const backfilling = useBudgetSyncStatusStore((s) => s.backfilling);
  const progress = useBudgetSyncStatusStore((s) => s.snapshotProgress);
  const phase = useBudgetSyncStatusStore((s) => s.phase);
  const records = useBudgetSyncStatusStore((s) => s.recordsThisSession);

  const running = stage !== 'idle' && stage !== 'done';
  // A backfill that is OWED but not currently running still shows: the member is
  // looking at a partial budget either way, and a panel that vanishes between
  // sync passes would flicker in and out for the entire wait.
  if (!running && !backfilling) return null;

  const downloading = progress != null && progress.total > 0;

  return (
    <Card
      style={[styles.card, { borderColor: backfilling ? colors.primary : colors.borderColor }]}
      testID="budget-sync-progress-panel"
    >
      <View style={styles.head}>
        {running ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Icon name="cloud-download-outline" forceIonicons size={IconSize.lg} color={colors.primary} />
        )}
        <Typography variant="footnote" weight="semibold" style={styles.headText}>
          {backfilling ? 'Setting up your budget' : 'Syncing'}
        </Typography>
        {downloading ? (
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID="budget-sync-progress-count"
          >
            {progress.done}/{progress.total}
          </Typography>
        ) : null}
      </View>

      <Typography
        variant="caption1"
        color={colors.textSecondary}
        testID="budget-sync-progress-stage"
      >
        {/* An idle stage under an owed backfill means the last pass ended
            without the snapshot — the owner's device has not published it yet.
            Saying that beats repeating "Idle" at somebody who is waiting. */}
        {running ? describeSyncStage(stage) : 'Waiting for the household to share its history'}
      </Typography>

      {downloading ? (
        <ProgressBar
          value={progress.done}
          max={progress.total}
          testID="budget-sync-progress-bar"
        />
      ) : null}

      {/* The count that moves.
          A chunk fraction is only available while a snapshot is downloading, and
          most syncs are not that — they are a handful of ops, where the honest
          progress signal is how much has actually landed. Records rather than
          ops, because one op can be a single edited amount or four hundred rows
          from an import, and a member cannot tell those apart from "3 changes".
          Hidden at zero: a run that legitimately finds nothing should say
          nothing, not claim "0 records". */}
      {records > 0 ? (
        <Typography
          variant="caption1"
          weight="semibold"
          color={colors.primary}
          testID="budget-sync-records-received"
        >
          {formatRecordCount(records)} record{records === 1 ? '' : 's'} received
        </Typography>
      ) : null}

      {backfilling ? (
        // The promise the whole feature rests on, in one sentence: nothing is
        // half-applied, so a member who sees an incomplete budget is watching a
        // download rather than a loss.
        <Typography variant="caption2" color={colors.textSecondary}>
          Every month, goal and income entry from this household is being copied to this device.
          It all appears at once when the copy is complete.
        </Typography>
      ) : null}

      {phase === 'offline' ? (
        <Typography variant="caption2" color={colors.textSecondary}>
          Waiting for a connection — this continues on its own.
        </Typography>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm, borderWidth: 1, borderRadius: CornerRadius.lg, marginBottom: Spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headText: { flex: 1 },
});
