/**
 * The member-facing "Device sync" card for House V2 (plan §3.5, "local-first
 * surface" pass).
 *
 * Budget shipped two things here and only one of them was a product surface.
 * `SyncStatusBanner` was a Maestro-only strip that said "Synced 3m ago via
 * mailbox" and "5 merge conflicts" — engine vocabulary, useful to us, meaningless
 * to a member; it was deleted 2026-08-16 and its BR-044 notice moved onto
 * Budget's Device Sync screen. The real surface always was the Settings card.
 * Do not grow a dashboard equivalent here. This is House's, and
 * it is **not** dev-gated: House ships local-first brand-default-on, so the
 * device that holds the only copy of a member's home needs a permanent, honest
 * answer to "is my home actually saved anywhere else?".
 *
 * Five states, and the distinction between them is the whole point:
 *
 *   syncing            a run is in flight
 *   awaiting enrolment this device claimed an invite but has no household key
 *                      yet, so nothing it writes can reach anyone
 *   offline            transient, self-healing, nothing to do
 *   error              may or may not be self-healing — `SyncErrorCode` decides,
 *                      and a terminal code disables the retry rather than
 *                      inviting one that cannot work
 *   synced             with the pending count, because "up to date" while five
 *                      changes sit in the outbox is not true
 *
 * BR-044 rides along: `HouseConflictList` renders under the status row, because
 * a discarded edit is discovered *here*, next to the thing that discarded it.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button, Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { isAwaitingHouseEnrolment } from '@features/house/local/engine';
import { toMemberFacingError } from '@features/house/local/memberFacingError';
import { runHouseLocalSync, runHouseLocalSyncFor } from '@features/house/local/sync/orchestrator';
import { useHouseSyncStatusStore } from '@features/house/local/sync/syncStatusStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { HouseConflictList } from './HouseConflictList';
import { houseSyncCopy, resolveHouseSyncState, type HouseSyncState } from './houseSyncCopy';
import { useHouseLedgerRevision } from './useHouseLedgerRevision';

export type HouseSyncStatusCardProps = {
  /** Sync only this property. Omit to fan out over every open property. */
  householdId?: string;
  /** Render the BR-044 list inline. Set false when the screen shows it elsewhere. */
  showConflicts?: boolean;
  /** Header text. Overridable so a Settings screen can supply its own section title. */
  title?: string;
  style?: StyleProp<ViewStyle>;
};

/** Dot colour per state — semantic tokens only, never a literal. */
function useStateColor(state: HouseSyncState): string {
  const colors = useAppColors();
  switch (state) {
    case 'synced':
      return colors.success;
    case 'error':
      return colors.error;
    case 'offline':
    case 'awaiting_enrolment':
      return colors.warning;
    case 'syncing':
    case 'idle':
    default:
      return colors.textTertiary;
  }
}

export function HouseSyncStatusCard({
  householdId,
  showConflicts = true,
  title = 'Device sync',
  style,
}: HouseSyncStatusCardProps) {
  const colors = useAppColors();
  const { phase, lastSyncedAt, pendingOutbound, lastErrorCode, lastAppliedFromPeers } =
    useHouseSyncStatusStore();

  // `isAwaitingHouseEnrolment` reads engine state directly, so without this the
  // card would keep saying "waiting for approval" for the whole session after
  // the HDK actually lands.
  useHouseLedgerRevision(householdId);
  const awaitingEnrolment = isAwaitingHouseEnrolment(householdId);

  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const state = resolveHouseSyncState({
    phase,
    awaitingEnrolment,
    lastErrorCode,
    lastSyncedAt,
  });
  const copy = useMemo(
    () =>
      houseSyncCopy({
        state,
        errorCode: lastErrorCode,
        pendingOutbound,
        lastSyncedAt,
      }),
    [state, lastErrorCode, pendingOutbound, lastSyncedAt],
  );
  const dotColor = useStateColor(state);

  const onSyncNow = useCallback(() => {
    setNote(null);
    setBusy(true);
    const run = householdId
      ? runHouseLocalSyncFor(householdId, 'sync-now-button')
      : runHouseLocalSync('sync-now-button');
    void run
      .then(() => {
        // Inline, beside the button that caused it. An Alert here interrupts
        // whatever the member was doing in order to say "done".
        const next = useHouseSyncStatusStore.getState();
        if (next.phase === 'offline') {
          setNote({
            ok: false,
            text: 'You are offline. Your changes are saved here and will go out automatically.',
          });
          return;
        }
        if (next.phase === 'error') {
          // The card body already renders the classified reason; repeating it
          // in the note would just say the same thing twice.
          setNote(null);
          return;
        }
        setNote({
          ok: true,
          text:
            next.lastAppliedFromPeers > 0
              ? `Up to date — ${next.lastAppliedFromPeers} change${
                  next.lastAppliedFromPeers === 1 ? '' : 's'
                } from your home.`
              : 'Up to date. Nothing new from your home.',
        });
      })
      .catch((error: unknown) => {
        // Never `error.message`: a thrown axios error's message is a raw system
        // string, and the extractor is the only sanctioned way out of one.
        setNote({
          ok: false,
          text: toMemberFacingError(
            error,
            'We could not reach your home just now. Your changes are safe on this device.',
          ).message,
        });
      })
      .finally(() => setBusy(false));
  }, [householdId]);

  const running = busy || state === 'syncing';

  return (
    <Card style={[styles.card, style]} testID="lf-sync-card">
      <Typography variant="title3" weight="semibold">
        {title}
      </Typography>
      <Typography variant="caption1" color={colors.textSecondary} style={styles.blurb}>
        Your home lives on this device. Everyone in it keeps their own copy, and the copies update
        each other — encrypted, so nothing readable is ever stored on our servers.
      </Typography>

      <View style={styles.stateRow} testID="lf-sync-state-row">
        <View style={[styles.dot, { backgroundColor: dotColor }]} testID="lf-sync-dot" />
        <Typography variant="body" weight="medium" style={styles.stateLabel} testID="lf-sync-state">
          {copy.label}
        </Typography>
        {running ? <ActivityIndicator size="small" testID="lf-sync-spinner" /> : null}
      </View>

      {copy.detail ? (
        <Typography variant="caption1" color={colors.textSecondary} testID="lf-sync-detail">
          {copy.detail}
        </Typography>
      ) : null}

      <View style={styles.metaRow}>
        <Typography variant="caption1" color={colors.textTertiary} testID="lf-sync-last">
          {lastSyncedAt == null
            ? 'Never synced on this device'
            : `Last synced ${new Date(lastSyncedAt).toLocaleString()}`}
        </Typography>
        <Typography
          variant="caption1"
          color={pendingOutbound > 0 ? colors.warning : colors.textTertiary}
          testID="lf-sync-pending"
        >
          {pendingOutbound === 0
            ? 'Nothing waiting to send'
            : `${pendingOutbound} waiting to send`}
        </Typography>
      </View>

      {state === 'awaiting_enrolment' ? (
        <View
          style={[styles.enrolment, { backgroundColor: colors.cardSubtle }]}
          testID="lf-sync-enrolment"
        >
          <Typography variant="caption1" color={colors.textSecondary}>
            Ask someone already in this home to open Household settings and approve this device.
            Anything you change before then stays here.
          </Typography>
        </View>
      ) : null}

      <Button
        title={copy.action}
        onPress={onSyncNow}
        loading={running}
        disabled={running || !copy.actionable}
        fullWidth
        style={styles.action}
        accessibilityLabel={`${copy.action}. ${copy.label}`}
        testID="lf-sync-now"
      />

      {note ? (
        <Typography
          variant="caption1"
          color={note.ok ? colors.textSecondary : colors.warning}
          style={styles.note}
          testID="lf-sync-note"
        >
          {note.text}
        </Typography>
      ) : null}

      {lastAppliedFromPeers > 0 && !note ? (
        <Typography
          variant="caption1"
          color={colors.textTertiary}
          style={styles.note}
          testID="lf-sync-applied"
        >
          {lastAppliedFromPeers === 1
            ? '1 change came in from your home on the last sync.'
            : `${lastAppliedFromPeers} changes came in from your home on the last sync.`}
        </Typography>
      ) : null}

      {showConflicts ? (
        <HouseConflictList householdId={householdId} style={styles.conflicts} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.xs,
  },
  blurb: {
    marginBottom: Spacing.sm,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: CornerRadius.full,
  },
  stateLabel: {
    flex: 1,
  },
  metaRow: {
    marginTop: Spacing.xs,
    gap: Spacing.xxs,
  },
  enrolment: {
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
  },
  action: {
    marginTop: Spacing.md,
  },
  note: {
    marginTop: Spacing.xs,
  },
  conflicts: {
    marginTop: Spacing.md,
  },
});
