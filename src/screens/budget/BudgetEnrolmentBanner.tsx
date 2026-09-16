import * as Linking from 'expo-linking';
import React, { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import {
  getActiveBudgetHouseholdId,
  isLocalBudgetSessionOpen,
  listLocalBudgetHouseholds,
  subscribeToLedgerChanges,
} from '@features/budget/local/engine';
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import { describeSyncStage, useBudgetSyncStatusStore } from '@features/budget/local/sync/syncStatusStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';

/**
 * Reach Device Sync by handing the app its own URL, not via `useNavigation`.
 *
 * Two reasons, and the first is a bug I shipped into the dashboard tests. This
 * banner renders inside `BudgetDashboardView`, whose host does not guarantee a
 * navigation context — its suites mock `@react-navigation/native` with only
 * `useFocusEffect`, so calling the hook threw "useNavigation is not a function"
 * in 34 cases. A component that can be dropped into a screen must not demand a
 * navigator the screen never promised.
 *
 * Second, this is how the codebase already reaches a screen nested in the
 * budget stack (see `services/navigation.ts`): the tab reads `screen` off the
 * URL and feeds it to the navigator's `initialParams`, which `NavigationHandler`
 * turns into a real navigate. `navNonce` is not decoration — `NavigationHandler`
 * dedupes on `screen:itemId:navNonce`, so a second tap with the same key is
 * silently ignored and the button appears dead.
 */
function openDeviceSync(screen = 'BudgetSync'): void {
  void Linking.openURL(
    Linking.createURL('/', {
      queryParams: { screen, navNonce: String(Date.now()) },
    }),
  ).catch(() => {
    // Nothing else to try; the copy above still tells the member what to do.
  });
}

/** Initial synchronization for the active household, not another approval of membership. */
export function BudgetEnrolmentBanner() {
  const colors = useAppColors();
  const [awaiting, setAwaiting] = useState(false);
  const stage = useBudgetSyncStatusStore(s => s.stage);
  const phase = useBudgetSyncStatusStore(s => s.phase);
  const backfilling = useBudgetSyncStatusStore(s => s.backfilling);
  const membershipConfirmed = useBudgetSyncStatusStore(s => s.membershipConfirmed);
  const recentPeers = useBudgetSyncStatusStore(s => s.recentlyActivePeers);
  const progress = useBudgetSyncStatusStore(s => s.snapshotProgress);

  // Subscribed, not read once. Enrolment completes inside a SYNC run, when the
  // owner's approval lands and the key is unwrapped — nothing the member does on
  // this screen triggers it, so a value read at mount would leave the banner up
  // after it stopped being true.
  useEffect(() => {
    const read = () => {
      if (!isBudgetLocalFirst() || !isLocalBudgetSessionOpen()) {
        setAwaiting(false);
        return;
      }
      setAwaiting(listLocalBudgetHouseholds().some((h) => h.householdId === getActiveBudgetHouseholdId() && h.awaitingEnrolment));
    };
    read();
    return subscribeToLedgerChanges(read);
  }, []);

  if (!awaiting && !backfilling) return null;
  const noPeers = recentPeers === 0 && stage !== 'applying' && stage !== 'downloading';
  const failed = phase === 'error' || phase === 'offline';
  const tint = failed || noPeers ? colors.warning : colors.primary;
  const title = failed ? 'Sync is temporarily unavailable'
    : stage === 'applying' ? 'Data received, processing…'
    : noPeers ? 'Waiting for a household device'
    : awaiting ? 'Preparing your household data' : 'Syncing your household data';
  const description = failed ? 'Your household data has not finished downloading. Check Device Sync; Budget will retry automatically.'
    : stage === 'applying' ? 'Your household history has arrived. Applying it and updating your budget…'
    : noPeers ? 'No other household device has synced recently. Open Budget on a device with your data. If none is available, you can restore from a backup.'
    : awaiting ? membershipConfirmed
      ? 'Your household is connected. Waiting for secure access from another member’s device. Your data will download automatically; no new invitation is needed.'
      : 'Checking access to your household and finding devices with your data. Open Device Sync to see the current status.'
    : 'Downloading your household history and changes from other members. Your budget will update when the data arrives.';

  return (
    <Card
      variant="filled"
      style={[styles.card, { backgroundColor: tint + '18' }]}
      testID="budget-enrolment-banner"
    >
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: tint + '22' }]}>
          <Icon name="phone-portrait-outline" size={22} color={tint} />
        </View>
        <View style={styles.body}>
          <Typography variant="body" weight="semibold">
            {title}
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            {description}
          </Typography>
          {!failed && !noPeers ? (
            <Typography variant="caption1" color={colors.textSecondary}>
              {stage === 'enrolling' ? 'Waiting for secure access' : describeSyncStage(stage)}
              {progress ? ` · ${progress.done}/${progress.total}` : ''}
            </Typography>
          ) : null}
          {noPeers ? (
            <TouchableOpacity onPress={() => openDeviceSync('BudgetBackup')} accessibilityRole="button" testID="budget-enrolment-backup-cta">
              <Typography variant="caption1" color={colors.primary}>Restore from Backup</Typography>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={() => openDeviceSync()}
            accessibilityRole="button"
            style={styles.cta}
            testID="budget-enrolment-banner-cta"
          >
            <Typography variant="caption1" weight="semibold" color={colors.primary}>
              Open Device Sync
            </Typography>
            <Icon name="chevron-forward" size={14} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.base, borderRadius: CornerRadius.lg },
  row: { flexDirection: 'row', gap: Spacing.md },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: Spacing.xs },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingTop: Spacing.xs,
  },
});
