/**
 * SYNC & SHARING — the five destinations that answer "where does my budget
 * live, and who else has it?": Device Sync, Backup & Restore, Households,
 * Invite & Household, Export.
 *
 * It renders on **Profile**, not on Budget Settings. All five are properties of
 * this account and this device — which copies exist, which phones hold them, who
 * is let in — while Budget Settings is about the budget's own shape (caps,
 * categories, sub-budgets, transfers). Splitting them that way is why this
 * section is a component rather than more JSX on the settings screen.
 *
 * Profile is a sibling tab of the one hosting the Budget stack, so no row here
 * has a `navigation` object that can reach these screens. Each goes through the
 * `services/navigation` helpers, which re-enter the app by its own URL — an
 * imperative push cannot deliver `screen=` to an already-mounted tab (the same
 * finding behind Profile's own settings gear).
 *
 * The row testIDs keep their `budget-settings-*` names on purpose: they identify
 * the ROW, every E2E flow and matrix row already speaks them, and renaming a
 * live selector to describe its new neighbourhood buys nothing.
 */

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Card, IconBackgroundChip, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { isFullBudget } from '@features/budget';
import {
  getBudgetAutoBackupSettings,
  type BudgetAutoBackupSettings,
} from '@features/budget/local/backup/autoBackup';
import { useBudgetBackupTaskStore } from '@features/budget/local/backup/backupTaskStore';
import {
  getActiveBudgetHouseholdId,
  getLedgerRevision,
  isAwaitingHouseholdEnrolment,
  listLocalBudgetHouseholds,
  subscribeToLedgerChanges,
} from '@features/budget/local/engine';
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import { useBudgetSyncStatusStore } from '@features/budget/local/sync/syncStatusStore';
import { useBudgetJoinWait } from '@features/budget/local/useBudgetJoinWait';
import {
  navigateToBudgetBackup,
  navigateToBudgetExport,
  navigateToBudgetHouseholds,
  navigateToBudgetInvite,
  navigateToBudgetSync,
} from '@services/navigation';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

interface BudgetSyncSharingSectionProps {
  /** Optional container style override (e.g. per-screen margin). */
  style?: StyleProp<ViewStyle>;
}

/**
 * Re-render when the ACTIVE household's ledger moves, and say which household
 * that is.
 *
 * `isAwaitingHouseholdEnrolment` reads engine state directly — a module map, not
 * a React store — so without a subscription this section would keep offering
 * "Waiting for approval…" for the rest of the session after the household key
 * actually landed. The gate flips inside a sync run, which is exactly a moment
 * nothing else re-renders Profile.
 */
function useActiveBudgetHouseholdId(): string | null {
  const subscribe = useCallback(
    (onChange: () => void) =>
      subscribeToLedgerChanges((_revision, change) => {
        if (change.householdId !== getActiveBudgetHouseholdId()) return;
        onChange();
      }),
    [],
  );
  useSyncExternalStore(subscribe, getLedgerRevision, getLedgerRevision);
  return getActiveBudgetHouseholdId();
}

/**
 * Gate first, hooks second: the rows below subscribe to the ledger and poll for
 * a pending join, and neither belongs on a brand that has no local budget at
 * all. Splitting the component in two is what lets the gate be an early return.
 */
export function BudgetSyncSharingSection({ style }: BudgetSyncSharingSectionProps) {
  if (!isFullBudget() || !isBudgetLocalFirst()) return null;
  return <BudgetSyncSharingRows style={style} />;
}

function BudgetSyncSharingRows({ style }: BudgetSyncSharingSectionProps) {
  const colors = useAppColors();
  const { currentHousehold } = useHouseholdStore();

  // Backup itself lives on BudgetBackupScreen; this section only summarises it
  // on the row that navigates there.
  const [autoSettings, setAutoSettings] = useState<BudgetAutoBackupSettings | null>(null);

  const refreshAutoSettings = useCallback(async () => {
    setAutoSettings(await getBudgetAutoBackupSettings());
  }, []);

  useEffect(() => {
    void refreshAutoSettings();
  }, [refreshAutoSettings]);

  // A seal can be running from anywhere — this screen, the Backup screen, or
  // the scheduler on app open. Say so on the row rather than leaving a stale
  // status while work is in flight.
  const backupTaskStatus = useBudgetBackupTaskStore((t) => t.status);

  /** One line of truth for the row — schedule if on, else the manual reminder. */
  const backupSummaryLine = useMemo(() => {
    if (backupTaskStatus === 'running') return 'Backing up… we’ll let you know when it’s done';
    if (!autoSettings) return 'Save a sealed copy, or restore one';
    if (!autoSettings.enabled) {
      return autoSettings.lastRunAt
        ? 'Automatic backup is off'
        : 'Not backed up yet — tap to protect your budget';
    }
    if (autoSettings.lastStatus && autoSettings.lastStatus !== 'ok') {
      return autoSettings.lastError ?? 'Last automatic backup did not finish';
    }
    return autoSettings.lastRunAt
      ? `Automatic · last ${new Date(autoSettings.lastRunAt).toLocaleDateString()}`
      : 'Automatic · runs next time you open the app';
  }, [autoSettings, backupTaskStatus]);

  // Sync itself lives on BudgetSyncScreen (with the trusted devices and the
  // danger zone); this section only summarises it on the row that leads there.
  const syncPhase = useBudgetSyncStatusStore((s) => s.phase);
  const lastSyncedAt = useBudgetSyncStatusStore((s) => s.lastSyncedAt);
  const pendingOutbound = useBudgetSyncStatusStore((s) => s.pendingOutbound);

  const syncSummaryLine = useMemo(() => {
    if (syncPhase === 'syncing') return 'Syncing…';
    const waiting =
      pendingOutbound > 0
        ? ` · ${pendingOutbound} change${pendingOutbound === 1 ? '' : 's'} waiting to send`
        : '';
    if (!lastSyncedAt) return 'Not synced on this device yet';
    return `Last synced ${new Date(lastSyncedAt).toLocaleDateString()}${waiting}`;
  }, [syncPhase, lastSyncedAt, pendingOutbound]);

  // Surfaced on the Invite row so a member waiting on approval is not left
  // wondering where that state went once the panel moved off this screen.
  //
  // The household is NAMED rather than left to default. Enrolment is per
  // household (BR-016): joining a second budget must not make the first one —
  // the one this row is describing — claim it is waiting for approval, and
  // being fully enrolled in the active one must not hide a pending join
  // elsewhere behind a row that says everything is fine.
  const activeHouseholdId = useActiveBudgetHouseholdId();
  const awaitingEnrolment =
    activeHouseholdId !== null && isAwaitingHouseholdEnrolment(activeHouseholdId);
  // A wait that ended badly is news this row has to carry too. Once the dead
  // claim is dropped the engine says this device is awaiting nothing, so the
  // row above would silently revert to "share this budget" and the member
  // would never learn why the household they joined is gone.
  const { outcome: joinOutcome, sas: joinSas } = useBudgetJoinWait();

  return (
    <View style={style} testID="budget-local-first-sync-card">
      {/* An uppercase group label over standalone rows — the same shape the
          Budget Settings sections use, so moving here changed the address and
          not the furniture. */}
      <Typography
        variant="caption1"
        weight="semibold"
        style={styles.groupLabel}
        testID="budget-settings-sync-section"
      >
        SYNC &amp; SHARING
      </Typography>
      <Typography variant="caption1" color={colors.textSecondary} style={styles.groupHint}>
        Your budget lives on this device. Everyone in the household keeps their own copy, and the
        copies update each other — encrypted, so nothing readable is ever stored on our servers.
      </Typography>

      {/* Five dedicated destinations, not one card of stacked controls. Each
          answers a different question ("is this device up to date?", "am I safe
          if I lose the phone?", "how do I share this?", "how do I get my data
          out?"), and each owns its own screen. */}
      <Card
        variant="filled"
        pressable
        onPress={navigateToBudgetSync}
        style={styles.navRow}
        accessibilityRole="button"
        accessibilityLabel="Device sync"
        testID="budget-settings-sync-link"
      >
        <IconBackgroundChip name="sync-outline" style={styles.navRowIcon} />
        <View style={styles.navRowText}>
          <Typography variant="body" weight="medium">
            Device Sync
          </Typography>
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            testID="budget-settings-sync-status"
          >
            {syncSummaryLine}
          </Typography>
        </View>
        <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
      </Card>

      <View style={styles.navRowSpacer} />

      {/* Backup grew its own screen — status, schedule, archive list and
          restore all live there. */}
      <Card
        variant="filled"
        pressable
        onPress={navigateToBudgetBackup}
        style={styles.navRow}
        accessibilityRole="button"
        accessibilityLabel="Backup and restore"
        testID="budget-settings-backup-link"
      >
        <IconBackgroundChip name="shield-checkmark-outline" style={styles.navRowIcon} />
        <View style={styles.navRowText}>
          <Typography variant="body" weight="medium">
            Backup &amp; Restore
          </Typography>
          <Typography
            variant="footnote"
            color={
              backupTaskStatus !== 'running' &&
              autoSettings?.lastStatus &&
              autoSettings.lastStatus !== 'ok'
                ? colors.error
                : colors.textSecondary
            }
            testID="budget-settings-backup-status"
          >
            {backupSummaryLine}
          </Typography>
        </View>
        <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
      </Card>

      <View style={styles.navRowSpacer} />

      <Card
        variant="filled"
        pressable
        onPress={navigateToBudgetHouseholds}
        style={styles.navRow}
        accessibilityRole="button"
        accessibilityLabel="Households"
        testID="budget-settings-households-link"
      >
        <IconBackgroundChip name="home-outline" style={styles.navRowIcon} />
        <View style={styles.navRowText}>
          <Typography variant="body" weight="medium">
            Households
          </Typography>
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            testID="budget-settings-households-status"
          >
            {currentHousehold?.name
              ? listLocalBudgetHouseholds().length > 1
                ? `Showing ${currentHousehold.name} — tap to switch`
                : currentHousehold.name
              : 'Create or switch which budget this phone opens'}
          </Typography>
        </View>
        <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
      </Card>

      <View style={styles.navRowSpacer} />

      {/* Invite / approve / join — the whole enrolment story (BR-011). */}
      <Card
        variant="filled"
        pressable
        onPress={navigateToBudgetInvite}
        style={styles.navRow}
        accessibilityRole="button"
        accessibilityLabel="Invite and household"
        testID="budget-settings-invite-link"
      >
        <IconBackgroundChip name="person-add-outline" style={styles.navRowIcon} />
        <View style={styles.navRowText}>
          <Typography variant="body" weight="medium">
            Invite &amp; Household
          </Typography>
          <Typography
            variant="footnote"
            color={joinOutcome || awaitingEnrolment ? colors.warning : colors.textSecondary}
            testID="budget-settings-invite-entry-status"
          >
            {joinOutcome
              ? joinOutcome === 'revoked'
                ? 'That invite was cancelled'
                : 'That invite expired'
              : awaitingEnrolment
                ? joinSas ? 'Waiting for approval…' : 'Waiting for household data…'
                : 'Share this budget, approve a device, or join a household'}
          </Typography>
        </View>
        <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
      </Card>

      <View style={styles.navRowSpacer} />

      {/* Export — a spreadsheet or raw CSV, with a toggle per section. */}
      <Card
        variant="filled"
        pressable
        onPress={navigateToBudgetExport}
        style={styles.navRow}
        accessibilityRole="button"
        accessibilityLabel="Export"
        testID="budget-settings-export-link"
      >
        <IconBackgroundChip name="download-outline" style={styles.navRowIcon} />
        <View style={styles.navRowText}>
          <Typography variant="body" weight="medium">
            Export
          </Typography>
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            testID="budget-settings-export-status"
          >
            Excel or CSV — choose what to include
          </Typography>
        </View>
        <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  groupLabel: {
    marginBottom: Spacing.xxs,
    letterSpacing: 0.8,
    opacity: 0.6,
  },
  groupHint: {
    marginBottom: Spacing.sm,
  },
  // Card owns the surface + radius; this just lays the row out and tightens the
  // default card padding a touch vertically.
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    gap: Spacing.smd,
  },
  navRowIcon: {
    width: Spacing.xxl,
    height: Spacing.xxl,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navRowText: { flex: 1 },
  navRowSpacer: { height: Spacing.sm },
});
