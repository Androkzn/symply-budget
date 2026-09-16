/**
 * "What is on this phone" — the breakdown behind the total on the sync card.
 *
 * The member's question is "is everything up to date?", and on a local-first
 * home there is no server page they can open to answer it. The check that
 * actually works is comparing this screen against the same screen on another
 * device in the household: the two totals should agree, and when they do not,
 * the category that differs says where to look.
 *
 * So the screen is a list of counts and nothing else. No progress bars, no
 * "healthy" badge, no derived verdict — a verdict here would be this device's
 * opinion of itself, which is exactly the thing a member with a half-synced
 * phone cannot trust. Two numbers they can hold side by side is worth more than
 * any reassurance the device could offer about itself.
 *
 * Zero rows are SHOWN, not hidden. "Appliances 0" is the answer for someone
 * checking whether their appliances made it across; hiding empty categories
 * turns a useful negative into a missing row and sends them hunting.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { getLocalHouseLedger, isLocalHouseSessionOpen } from '@features/house/local/engine';
import {
  describeHouseSyncInventory,
  type HouseSyncInventory,
} from '@features/house/local/syncInventory';
import { Spacing, useAppColors } from '@theme';

import { EnrolmentShell } from './enrolmentShared';

/** Thousands separators, because 1645 and 1,645 are not equally scannable. */
function grouped(n: number): string {
  return n.toLocaleString();
}

export default function HouseSyncInventoryScreen() {
  const colors = useAppColors();

  /**
   * Read once per mount rather than subscribing to the ledger.
   *
   * A live-updating count would tick while the member is reading it and make
   * the comparison they came here to do impossible — the whole point is to hold
   * this number against another device's. Leaving and re-entering re-reads.
   */
  const inventory = useMemo<HouseSyncInventory | null>(() => {
    if (!isLocalHouseSessionOpen()) return null;
    try {
      return describeHouseSyncInventory(getLocalHouseLedger());
    } catch {
      // A ledger that will not open is the enrolment gate's story to tell, not
      // this screen's: it renders the empty state rather than an error.
      return null;
    }
  }, []);

  return (
    <EnrolmentShell title="Synced data" testID="lf-sync-inventory-screen">
      <Card style={styles.card} testID="house-sync-inventory-card">
        {inventory ? (
          <>
            <Typography variant="largeTitle" weight="bold" testID="house-sync-inventory-total">
              {grouped(inventory.total)}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary} style={styles.subtitle}>
              items on this phone. Open this screen on another device in your
              home — the totals should match once both have finished syncing.
            </Typography>

            <View style={styles.list}>
              {inventory.categories.map(category => (
                <View
                  key={category.key}
                  style={[styles.row, { borderBottomColor: colors.borderColor }]}
                  testID={`house-sync-category-${category.key}`}
                >
                  <Typography variant="body" style={styles.rowLabel}>
                    {category.label}
                  </Typography>
                  <Typography
                    variant="body"
                    weight="semibold"
                    // Muted at zero: an empty category is information, but it is
                    // not the information anyone is scanning for.
                    color={category.count === 0 ? colors.textSecondary : colors.textPrimary}
                    testID={`house-sync-count-${category.key}`}
                  >
                    {grouped(category.count)}
                  </Typography>
                </View>
              ))}
            </View>
          </>
        ) : (
          <Typography
            variant="body"
            color={colors.textSecondary}
            testID="house-sync-inventory-empty"
          >
            This home is not stored on this device yet, so there is nothing to
            count. Finish setting up device sync first.
          </Typography>
        )}
      </Card>
    </EnrolmentShell>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm },
  subtitle: { marginTop: Spacing.xs },
  list: { marginTop: Spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.md,
  },
  rowLabel: { flex: 1 },
});
