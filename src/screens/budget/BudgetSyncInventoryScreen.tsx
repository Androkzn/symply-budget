import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { AppBackground, SafeAreaView, ScreenHeader } from '@components/common';
import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import {
  getActiveBudgetHouseholdId,
  subscribeToLedgerChanges,
} from '@features/budget/local/engine';
import {
  formatRecordCount,
  readBudgetSyncInventory,
  type BudgetSyncInventory,
} from '@features/budget/local/sync/syncInventory';
import type { BudgetStackParamList } from '@navigation/types';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';

/**
 * Budget → Device sync → **Records on this device**.
 *
 * The screen a member opens to answer "did everything actually arrive?", and the
 * way they answer it is by standing next to somebody else and comparing. That
 * shapes every decision here:
 *
 *  - **every category is listed, zeroes included.** The two devices then render
 *    the same rows in the same order, and a mismatch is a different NUMBER on a
 *    line rather than a missing line. People spot a changed digit; they do not
 *    spot an absence.
 *  - **no sorting by size**, for the same reason — sorting reorders the list
 *    per device and destroys the line-by-line comparison.
 *  - **counts, not sizes.** "4.2 MB" is unverifiable between two devices;
 *    "18 monthly goals" is checkable in a second.
 *
 * Re-read on every ledger change, so a sync that lands while this is open moves
 * the numbers under the member rather than leaving them reading a stale census
 * of the thing they are trying to verify.
 */
export function BudgetSyncInventoryScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();

  const [inventory, setInventory] = useState<BudgetSyncInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const householdId = getActiveBudgetHouseholdId();
    if (!householdId) {
      setInventory(null);
      setLoading(false);
      return;
    }
    try {
      setInventory(await readBudgetSyncInventory(householdId));
    } catch (error) {
      // An unreadable ledger is not a number this screen may invent. Leaving
      // `inventory` null shows the empty state, which says nothing rather than
      // something false — on a screen whose only job is being trusted.
      console.warn('[BudgetLocal] inventory read failed', error);
      setInventory(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A sync landing while this is open must move these numbers: the member is
  // here precisely because they are unsure, and a census that does not update is
  // the thing that made them unsure.
  useEffect(() => subscribeToLedgerChanges(() => void load()), [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return (
    <AppBackground>
      <SafeAreaView edges={[]} testID="budget-sync-inventory-screen">
        <ScreenHeader
          title="Records on this device"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.textSecondary}
            />
          }
        >
          {loading ? (
            <View style={styles.loading} testID="budget-sync-inventory-loading">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : !inventory ? (
            <Typography variant="caption1" color={colors.textSecondary}>
              No budget is open on this device.
            </Typography>
          ) : (
            <>
              <Card variant="filled" style={styles.totalCard}>
                <Typography
                  variant="largeTitle"
                  weight="semibold"
                  testID="budget-sync-inventory-total"
                >
                  {formatRecordCount(inventory.total)}
                </Typography>
                <Typography variant="footnote" color={colors.textSecondary}>
                  records on this device
                </Typography>
              </Card>

              {/* The instruction that makes the list useful. Without it this is
                  a page of numbers; with it, it is a procedure. */}
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                style={styles.intro}
              >
                Open this screen on another member&apos;s phone and compare. Matching numbers mean
                both devices hold the same budget. A line that differs is the data still on its way.
              </Typography>

              {inventory.groups.map((group) => (
                <View key={group.title} style={styles.group}>
                  <Typography
                    variant="caption2"
                    weight="semibold"
                    color={colors.textSecondary}
                    style={styles.groupLabel}
                  >
                    {group.title.toUpperCase()}
                  </Typography>
                  <Card style={styles.groupCard}>
                    {group.lines.map((line, index) => (
                      <View
                        key={line.table}
                        style={[
                          styles.row,
                          index > 0 && { borderTopWidth: 1, borderTopColor: colors.borderColor },
                        ]}
                        testID={`budget-sync-inventory-row-${line.table}`}
                      >
                        <Typography variant="footnote" style={styles.rowLabel}>
                          {line.label}
                        </Typography>
                        <Typography
                          variant="footnote"
                          weight="semibold"
                          // A zero is data too — it is half of every comparison —
                          // but it is not what the eye should land on first.
                          color={line.count === 0 ? colors.textSecondary : colors.textPrimary}
                          testID={`budget-sync-inventory-count-${line.table}`}
                        >
                          {formatRecordCount(line.count)}
                        </Typography>
                      </View>
                    ))}
                  </Card>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.base, paddingBottom: Layout.bottomTabBarClearance + 48 },
  loading: { paddingVertical: Spacing.xl * 2, alignItems: 'center' },
  totalCard: { alignItems: 'center', paddingVertical: Spacing.lg, gap: Spacing.xxs },
  intro: { marginTop: Spacing.md, marginBottom: Spacing.lg },
  group: { marginBottom: Spacing.lg },
  groupLabel: { marginBottom: Spacing.sm, letterSpacing: 0.6, opacity: 0.6 },
  groupCard: { paddingVertical: 0, borderRadius: CornerRadius.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  rowLabel: { flex: 1 },
});
