/**
 * House V2 — the combined "Device sync" surface (plan §5.1).
 *
 * The three enrolment screens are separately routable, but a member does not
 * think in three screens: they think "share this home with my partner". This
 * composes the same three bodies under one header, in the order the job
 * happens — sync, invite, join, devices — with no duplicated logic, because
 * each body is the component the standalone screen also renders.
 *
 * It is also the shape the two-device suite already expects: one surface, found
 * at `simplehouse://device-sync` or from a Settings row, anchored by
 * `house-local-first-sync-card`. The three ids the runner defaults to and that
 * exist nowhere else — the card, `house-settings-sync-now`, `house-sync-status`
 * — are spelled exactly here so those three need no override at all.
 *
 * Sync belongs on this surface rather than the invite screen for a reason that
 * is easy to miss: approving a device only WRITES the wrapped household key
 * into the peer's mailbox on the owner's next sync run. Without a manual "Sync
 * now" the owner has to wait out the background schedule before the person they
 * just approved can read anything.
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { HouseConflictList } from '@components/house-v2';
import { Card, GradientButton, Typography } from '@components/ui';
import { HouseSyncProgressPanel } from '@features/house/components/HouseSyncProgressPanel';
import { houseHouseholdControlPlaneStatus } from '@features/house/local/controlPlaneClient';
import {
  getActiveHouseholdId,
  getLocalHouseLedger,
  isLocalHouseSessionOpen,
  requestHouseholdBackfill,
} from '@features/house/local/engine';
import { runHouseLocalSync } from '@features/house/local/sync/orchestrator';
import { useHouseSyncStatusStore } from '@features/house/local/sync/syncStatusStore';
import { describeHouseSyncInventory } from '@features/house/local/syncInventory';
import { Spacing, useAppColors } from '@theme';

import {
  EnrolmentShell,
  NoticeCard,
  StatusLine,
  enrolmentUnreachableNotice,
  gateNotice,
  useEnrolmentGate,
  type NoticeTone,
} from './enrolmentShared';
import { HouseDevicesBody } from './HouseDevicesScreen';
import { HouseInviteBody } from './HouseInviteCreateScreen';
import { HouseJoinBody } from './HouseJoinScreen';

export default function HouseDeviceSyncScreen() {
  const colors = useAppColors();
  // expo-router, not the Settings stack: this screen is mounted in BOTH trees
  // and only the global router resolves from either. See app/sync-inventory.tsx.
  const router = useRouter();
  const gate = useEnrolmentGate();
  const conflicts = useHouseSyncStatusStore((s) => s.conflicts);

  const [isSyncing, setIsSyncing] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [note, setNote] = useState<{ tone: NoticeTone; text: string } | null>(null);

  /**
   * How much this device holds, refreshed after every run.
   *
   * `null` means "cannot be counted" — no local session — and hides the row
   * entirely, rather than rendering a truthful `0` that reads as data loss on a
   * device which has simply not enrolled yet.
   *
   * Re-read after a sync and after a history repair because both are exactly
   * the operations that change it: the number moving from 1,600 to 1,645 is the
   * clearest confirmation that a run did something, and a stale count sitting
   * under a successful sync is the opposite.
   */
  const [inventoryTotal, setInventoryTotal] = useState<number | null>(null);
  const refreshInventory = useCallback(() => {
    if (!isLocalHouseSessionOpen()) {
      setInventoryTotal(null);
      return;
    }
    try {
      setInventoryTotal(describeHouseSyncInventory(getLocalHouseLedger()).total);
    } catch {
      setInventoryTotal(null);
    }
  }, []);
  useEffect(refreshInventory, [refreshInventory]);

  const handleSync = useCallback(() => {
    setNote(null);
    setIsSyncing(true);
    void runHouseLocalSync('sync-now-button')
      .then(async () => {
        // Read the phase the run left behind rather than assuming success:
        // an offline run resolves normally and must not claim "up to date".
        const s = useHouseSyncStatusStore.getState();
        if (s.phase === 'offline') {
          setNote({
            tone: 'warn',
            text: 'You are offline. Everything you change is saved here and goes out by itself when you are back.',
          });
          return;
        }
        // 'idle' means this home never ran — it is not "up to date".
        //
        // `syncOneProperty` returns early when the home has no control-plane
        // row, which is correct: a private ledger is a file on this phone and
        // must not be published because somebody tapped a button. What was wrong
        // was what the member was then told — 'idle' fell through to the success
        // branch with `lastAppliedFromPeers === 0` and reported "Up to date.
        // Nothing new from your home", word for word what a healthy shared home
        // reports. That is the "Sync now does nothing" report.
        //
        // WHICH 'idle' it is has to be ASKED, not assumed: offline and private
        // both look the same from here, and claiming "only on this device" off
        // that would tell a member of a real shared home, on a train, that their
        // home is not shared — then invite them to fix it by inviting somebody
        // who is already in it. `houseHouseholdControlPlaneStatus` separates them.
        if (s.phase === 'idle') {
          const householdId = getActiveHouseholdId();
          const status = householdId
            ? await houseHouseholdControlPlaneStatus(householdId)
            : 'unknown';
          setNote(
            status === 'no'
              ? {
                  tone: 'ok',
                  text: 'This home is only on this device. Invite someone to start syncing.',
                }
              : {
                  // 'unknown' — do not guess in either direction. Nothing was
                  // sent and nothing was lost, and that is the whole message.
                  tone: 'warn',
                  text: 'Could not check your home just now. Your changes are safe on this device and will sync when it is back.',
                },
          );
          return;
        }
        // Both directions, because "nothing new from your home" over a run that
        // just pushed twelve of this device's own changes reads as a sync that
        // did nothing.
        const received =
          s.lastAppliedFromPeers > 0
            ? `${s.lastAppliedFromPeers} change${s.lastAppliedFromPeers === 1 ? '' : 's'} received`
            : null;
        const sent =
          s.lastPushedOps > 0
            ? `${s.lastPushedOps} change${s.lastPushedOps === 1 ? '' : 's'} sent`
            : null;
        const moved = [received, sent].filter(Boolean).join(' · ');
        setNote({
          tone: 'ok',
          text: moved ? `Up to date — ${moved}.` : 'Up to date. Nothing new from your home.',
        });
      })
      .catch(() =>
        setNote({
          tone: 'error',
          text: 'Could not reach your home right now. Everything you changed is safe on this device.',
        }),
      )
      .finally(() => {
        setIsSyncing(false);
        refreshInventory();
      });
  }, [refreshInventory]);

  /**
   * "I can see less than the others can" — the repair for a partial ledger.
   *
   * Re-arms the durable backfill marker and runs a sync, which downloads and
   * installs the home's checkpoint. Non-destructive by construction:
   * `installHouseCheckpointPlaintext` replaces the projection and then replays
   * every local op newer than the snapshot, so anything authored on this device
   * survives.
   *
   * Manual rather than automatic because there is no signal a device can read to
   * know it is missing history — that is exactly the shape of the bug, a ledger
   * that looks healthy from the inside. Devices that joined before the marker
   * shipped are in precisely that state, and the member comparing two phones is
   * the only detector that exists.
   */
  const handleDownloadHistory = useCallback(() => {
    const householdId = getActiveHouseholdId();
    if (!householdId) return;
    setNote(null);
    setIsRepairing(true);
    void requestHouseholdBackfill(householdId)
      .then(() => runHouseLocalSync('history-repair'))
      .then(() => {
        setNote(
          useHouseSyncStatusStore.getState().backfilling
            ? {
                // Still owed: the home has not published a snapshot yet. Says
                // whose action is missing, because the member cannot do anything
                // about it themselves and should not keep retrying.
                tone: 'warn',
                text: 'No home snapshot to download yet. Ask another member to open their app once — it publishes one — then try again.',
              }
            : { tone: 'ok', text: 'This device now holds the full home history.' },
        );
      })
      .catch((error: unknown) => {
        console.warn('[HouseLocal] history repair failed', error);
        setNote({
          tone: 'error',
          text: 'Could not download the history right now. Nothing on this device was changed.',
        });
      })
      .finally(() => {
        setIsRepairing(false);
        refreshInventory();
      });
  }, [refreshInventory]);

  const notice = gateNotice(gate);

  return (
    <EnrolmentShell title="Device sync" testID="lf-sync-screen">
      <Card style={styles.card} testID="house-local-first-sync-card">
        <Typography variant="title3" weight="semibold">
          Device sync
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary} style={styles.subtitle}>
          Your home lives on this device. Everyone you share it with keeps their own copy, and the
          copies update each other — encrypted, so nothing readable is ever stored on our servers.
        </Typography>

        {notice ? <NoticeCard notice={notice} testID="lf-sync-gate-notice" /> : null}

        {/* Above the progress panel, and only when the wait is provably hopeless.
            The panel's own step label for this state reads "Waiting for the home
            key", which is true and, once nobody is left to hand it over, the most
            misleading thing on the screen — a member reading it has no way to
            learn that the answer is never. */}
        {gate.enrolmentUnreachable ? (
          <NoticeCard
            notice={enrolmentUnreachableNotice(gate.householdName)}
            testID="lf-sync-enrolment-unreachable"
          />
        ) : null}

        {/* Above the button, because it is what the button produces. A joiner
            who taps Sync now and watches a download run to completion needs no
            further explanation; one who taps it and sees nothing move is the
            member who files "sync is broken". */}
        <HouseSyncProgressPanel />

        {/*
          What this device actually holds, as one number.

          Below the progress panel and above the button, because it is the
          standing answer to "is everything here?" while the panel is only about
          the run that just happened. Tapping opens the per-category breakdown —
          the number alone says the device is not empty, and the breakdown is
          what a member compares against another phone.

          Hidden entirely when the count cannot be read (no local session yet):
          a "0 items" row on a device that simply has not enrolled would be a
          true statement that reads as data loss.
        */}
        {inventoryTotal !== null ? (
          <Pressable
            onPress={() => router.push('/sync-inventory')}
            style={[styles.inventoryRow, { borderColor: colors.borderColor }]}
            accessibilityRole="button"
            accessibilityLabel={`${inventoryTotal} items synced to this device. See the breakdown.`}
            testID="house-sync-inventory-row"
          >
            <Typography variant="body">
              <Typography variant="body" weight="semibold">
                {inventoryTotal.toLocaleString()}
              </Typography>{' '}
              synced
            </Typography>
            <Typography variant="body" color={colors.textSecondary}>
              ›
            </Typography>
          </Pressable>
        ) : null}

        <View style={styles.block}>
          <GradientButton
            title={isSyncing ? 'Syncing…' : 'Sync now'}
            disabled={isSyncing || isRepairing || !gate.ready}
            onPress={handleSync}
            testID="house-settings-sync-now"
          />
        </View>
        {note ? <StatusLine text={note.text} tone={note.tone} testID="house-sync-status" /> : null}

        {/* The manual repair. Deliberately quiet — a secondary line rather than
            a second button of equal weight — because the case it fixes is rare
            and the member who needs it arrives having already noticed that one
            phone shows less than another. */}
        {gate.ready ? (
          <View style={styles.block}>
            <Typography variant="caption1" color={colors.textSecondary}>
              Seeing less here than on another device? Download this home&apos;s full history again.
            </Typography>
            <GradientButton
              title={isRepairing ? 'Downloading…' : 'Download full history'}
              variant="secondary"
              disabled={isSyncing || isRepairing}
              onPress={handleDownloadHistory}
              testID="house-sync-download-history"
            />
          </View>
        ) : null}
        {conflicts > 0 ? (
          <>
            <StatusLine
              text={`${conflicts} change${conflicts === 1 ? '' : 's'} were overwritten when two of you edited the same thing. Open the item to check it still reads the way you meant.`}
              tone="warn"
              testID="house-sync-conflicts"
            />
            {/*
              The count alone tells a member something went wrong without
              telling them what — and BR-044 exists because a silent overwrite
              in a shared home is indistinguishable from data loss. This list
              names each discarded edit ("Due date on a task"), says whether it
              was theirs, and is the only trace the losing edit ever existed.
            */}
            <HouseConflictList style={styles.conflicts} />
          </>
        ) : null}

        {/* One notice, not four: each body renders its own when it cannot
            work, and stacking four copies of "your home is still opening" is
            noise. The bodies only mount once the gate is actually open. */}
        {gate.ready ? (
          <>
            <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
              INVITE SOMEONE
            </Typography>
            <HouseInviteBody gate={gate} />

            <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
              JOIN SOMEONE ELSE&apos;S HOME
            </Typography>
            <HouseJoinBody gate={gate} />

            <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
              DEVICES
            </Typography>
            <HouseDevicesBody gate={gate} />
          </>
        ) : null}
      </Card>
    </EnrolmentShell>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.lg },
  subtitle: { marginTop: Spacing.xxs },
  block: { marginTop: Spacing.md },
  conflicts: { marginTop: Spacing.sm },
  groupLabel: { marginTop: Spacing.xl, marginBottom: Spacing.xs },
  inventoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
