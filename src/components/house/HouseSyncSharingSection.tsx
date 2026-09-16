/**
 * HOME & SHARING — the House rows that answer "where does my home live, and who
 * else has it?": Household & Members, Invite & home, Device sync, Backup &
 * Restore.
 *
 * It renders on **Profile**, not on the settings hub. All four are properties of
 * this account and this device — which copies exist, which phones hold them, who
 * is let in — while House Settings is about the app's own shape (preferences,
 * units, notifications, the AI surfaces). Splitting them that way is why this is
 * a component rather than more JSX on a settings screen; it is the same split
 * full Budget made with `BudgetSyncSharingSection`, which this mirrors.
 *
 * Profile is a sibling TAB of the one hosting the Settings stack these screens
 * live in, so no row here has a `navigation` object that can reach them. Each
 * goes through the `services/navigation` helpers, which re-enter the app by its
 * own URL — an imperative push cannot deliver `screen=` to an already-mounted
 * tab (the same finding behind Profile's own settings gear).
 *
 * The row testIDs keep their `settings-row-*` names on purpose: they identify
 * the ROW, every E2E flow and matrix row already speaks them, and
 * `settings-row-device-sync` in particular is a CONTRACT — the two-device
 * suite's runner defaults `LF_SETTINGS_ROW` to exactly that string.
 */

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { isHouseBrand } from '@brand';
import { Card, IconBackgroundChip, Typography } from '@components/ui';
import { Icon, hasBrandIcon } from '@components/ui/Icon';
import { useHouseBackupSummaryLine } from '@features/house/local/backup/useHouseBackupSummaryLine';
import { isHouseLocalFirst } from '@features/house/local/flag';
import {
  navigateToHouseBackup,
  navigateToHouseDeviceSync,
  navigateToHouseInvite,
  navigateToHouseholds,
} from '@services/navigation';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

interface HouseSyncSharingSectionProps {
  /** Optional container style override (e.g. per-screen margin). */
  style?: StyleProp<ViewStyle>;
}

export function HouseSyncSharingSection({ style }: HouseSyncSharingSectionProps) {
  const colors = useAppColors();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);

  /**
   * The three local-first rows are gated on the FLAG as well as the brand: on a
   * build where the ledger is off they describe machinery that is not running.
   * `isHouseLocalFirst()` is false under Jest by design (flag.ts:29), so the
   * existing Profile suites do not see them.
   */
  const localFirst = isHouseBrand() && isHouseLocalFirst();
  const backup = useHouseBackupSummaryLine(localFirst);

  if (!isHouseBrand()) return null;

  return (
    <View style={style} testID="house-sync-sharing-section">
      {/* An uppercase group label over standalone rows — the same shape the
          settings sections use, so moving here changed the address and not the
          furniture. */}
      <Typography
        variant="caption1"
        weight="semibold"
        style={styles.groupLabel}
        testID="profile-house-sharing-section"
      >
        HOME &amp; SHARING
      </Typography>

      <Card
        variant="filled"
        pressable
        onPress={navigateToHouseholds}
        style={styles.navRow}
        accessibilityRole="button"
        accessibilityLabel="Household and members"
        testID="settings-row-household-members"
      >
        <IconBackgroundChip
          name="home-outline"
          active={hasBrandIcon('home-outline')}
          style={styles.navRowIcon}
        />
        <View style={styles.navRowText}>
          <Typography variant="body" weight="medium">
            Household &amp; Members
          </Typography>
          <Typography variant="footnote" color={colors.textSecondary}>
            {currentHousehold
              ? `${currentHousehold.name} • manage properties & members`
              : 'No property selected'}
          </Typography>
        </View>
        <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
      </Card>

      {localFirst && (
        <>
          <View style={styles.navRowSpacer} />

          {/* The hub, above the machinery. "Who is in this home, and how do I
              add someone" is the question members actually arrive with; Device
              sync answers "which copies exist", which is the follow-up. Both
              rows stay, because a member who has been told to open Device sync
              must still find it under that name. */}
          <Card
            variant="filled"
            pressable
            onPress={navigateToHouseInvite}
            style={styles.navRow}
            accessibilityRole="button"
            accessibilityLabel="Invite and home"
            testID="settings-row-house-invite"
          >
            <IconBackgroundChip
              name="people-outline"
              active={hasBrandIcon('people-outline')}
              style={styles.navRowIcon}
            />
            <View style={styles.navRowText}>
              <Typography variant="body" weight="medium">
                Invite &amp; home
              </Typography>
              <Typography variant="footnote" color={colors.textSecondary}>
                Who shares this home, invite someone, or join theirs
              </Typography>
            </View>
            <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
          </Card>

          <View style={styles.navRowSpacer} />

          <Card
            variant="filled"
            pressable
            onPress={navigateToHouseDeviceSync}
            style={styles.navRow}
            accessibilityRole="button"
            accessibilityLabel="Device sync"
            testID="settings-row-device-sync"
          >
            <IconBackgroundChip
              name="sync-outline"
              active={hasBrandIcon('sync-outline')}
              style={styles.navRowIcon}
            />
            <View style={styles.navRowText}>
              <Typography variant="body" weight="medium">
                Device sync
              </Typography>
              <Typography variant="footnote" color={colors.textSecondary}>
                Share this home, approve devices, and see what synced
              </Typography>
            </View>
            <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
          </Card>

          <View style={styles.navRowSpacer} />

          {/* One row, not two. Restore used to have its own — the reasoning
              being that it is rare and destructive, so it should not hide behind
              a screen called "Backup". What actually happened is that the two
              halves drifted, so restoring your own backup meant finding the file
              in Files first. One screen whose archive list restores on tap. */}
          <Card
            variant="filled"
            pressable
            onPress={navigateToHouseBackup}
            style={styles.navRow}
            accessibilityRole="button"
            accessibilityLabel="Backup and restore"
            testID="settings-row-house-backup"
          >
            <IconBackgroundChip
              name="shield-checkmark-outline"
              active={hasBrandIcon('shield-checkmark-outline')}
              style={styles.navRowIcon}
            />
            <View style={styles.navRowText}>
              <Typography variant="body" weight="medium">
                Backup &amp; Restore
              </Typography>
              <Typography
                variant="footnote"
                // A failed schedule is the whole reason to open this screen
                // unprompted, so it is the one thing the row says in red.
                color={backup.needsAttention ? colors.error : colors.textSecondary}
                testID="settings-row-house-backup-status"
              >
                {backup.line}
              </Typography>
            </View>
            <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
          </Card>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  groupLabel: {
    marginBottom: Spacing.xxs,
    letterSpacing: 0.8,
    opacity: 0.6,
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
