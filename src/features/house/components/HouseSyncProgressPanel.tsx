import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, ProgressBar, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import {
  describeSyncStage,
  useHouseSyncStatusStore,
} from '@features/house/local/sync/syncStatusStore';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

/**
 * "1 record" / "1,204 records" — grouped, because four digits of history read as
 * a serial number without a separator.
 */
function formatCount(value: number, noun: string): string {
  return `${value.toLocaleString()} ${noun}${value === 1 ? '' : 's'}`;
}

/**
 * What the sync is DOING, while it does it.
 *
 * A home did not use to need this: a mailbox round is two seconds and a spinner
 * covers it. A join is not that. The first sync after being let into a home
 * reaches the control plane, waits for the household key, downloads a snapshot
 * that can be years of rooms, appliances, tasks and documents across several
 * chunks, and only then merges. Behind one undifferentiated "Syncing…" every one
 * of those looks identical to a hang — and the member is staring at a home that
 * is genuinely incomplete while it happens, which is precisely when silence gets
 * read as "the app lost my house".
 *
 * Two states, and the difference is the whole point of the component:
 *
 *  - BACKFILLING — this device is still owed the home's history. The copy says
 *    so, and says the data lands all at once, because the alternative reading of
 *    a half-populated home is that it is broken.
 *  - a plain sync — a step label, no alarm.
 *
 * Renders nothing when there is nothing to report, so callers place it
 * unconditionally next to `HouseJoinWaitingPanel`.
 */
export function HouseSyncProgressPanel() {
  const colors = useAppColors();
  const stage = useHouseSyncStatusStore((s) => s.stage);
  const backfilling = useHouseSyncStatusStore((s) => s.backfilling);
  const progress = useHouseSyncStatusStore((s) => s.snapshotProgress);
  const snapshotRecords = useHouseSyncStatusStore((s) => s.snapshotRecords);
  const applied = useHouseSyncStatusStore((s) => s.lastAppliedFromPeers);
  const pushed = useHouseSyncStatusStore((s) => s.lastPushedOps);
  const phase = useHouseSyncStatusStore((s) => s.phase);

  const running = stage !== 'idle' && stage !== 'done';
  // A backfill that is OWED but not currently running still shows: the member is
  // looking at a partial home either way, and a panel that vanished between sync
  // passes would flicker in and out for the entire wait.
  if (!running && !backfilling) return null;

  const downloading = progress != null && progress.total > 0;

  return (
    <Card
      style={[styles.card, { borderColor: backfilling ? colors.primary : colors.borderColor }]}
      testID="house-sync-progress-panel"
    >
      <View style={styles.head}>
        {running ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Icon
            name="cloud-download-outline"
            forceIonicons
            size={IconSize.lg}
            color={colors.primary}
          />
        )}
        <Typography variant="footnote" weight="semibold" style={styles.headText}>
          {backfilling ? 'Setting up your home' : 'Syncing'}
        </Typography>
        {downloading ? (
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID="house-sync-progress-count"
          >
            {progress.done}/{progress.total}
          </Typography>
        ) : null}
      </View>

      <Typography
        variant="caption1"
        color={colors.textSecondary}
        testID="house-sync-progress-stage"
      >
        {/* An idle stage under an owed backfill means the last pass ended without
            the snapshot — the owner's device has not published it yet. Saying
            that beats repeating "Idle" at somebody who is waiting. */}
        {running ? describeSyncStage(stage) : 'Waiting for the home to share its history'}
      </Typography>

      {downloading ? (
        <ProgressBar value={progress.done} max={progress.total} testID="house-sync-progress-bar" />
      ) : null}

      {/*
       * The count in records, which is the one that means something.
       *
       * Chunks measure the download and say nothing about the home: "4/7" is the
       * same number for a studio flat and for a decade of a house. A snapshot
       * being installed reports its row count; an ordinary round reports what
       * actually moved, in both directions, and says so only when something did
       * — "0 received, 0 sent" is noise on a home where nothing has changed.
       */}
      {snapshotRecords != null ? (
        <Typography variant="caption1" color={colors.textPrimary} testID="house-sync-records">
          {formatCount(snapshotRecords, 'record')} restored to this device
        </Typography>
      ) : applied > 0 || pushed > 0 ? (
        <Typography variant="caption1" color={colors.textPrimary} testID="house-sync-records">
          {[
            applied > 0 ? `${formatCount(applied, 'change')} received` : null,
            pushed > 0 ? `${formatCount(pushed, 'change')} sent` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
      ) : null}

      {backfilling ? (
        // The promise the whole feature rests on, in one sentence: nothing is
        // half-applied, so a member who sees an incomplete home is watching a
        // download rather than a loss.
        <Typography variant="caption2" color={colors.textSecondary}>
          Every room, appliance, task and document in this home is being copied to this device. It
          all appears at once when the copy is complete.
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
