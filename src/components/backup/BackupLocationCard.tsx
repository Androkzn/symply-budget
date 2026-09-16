import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import {
  openBackupLocation,
  opensInFilesApp,
  type BackupLocation,
} from '@services/backup/backupFileAccess';
import { CornerRadius, IconSize, Spacing, hexToRgba, useAppColors } from '@theme';

type Props = {
  location: BackupLocation;
  /**
   * What was saved, above the destination. Names the THING, not just the place:
   * "SAVED TO / On this device" answered "where?" and left the obvious question
   * — saved WHAT? — for the user to guess at.
   */
  eyebrow?: string;
  /**
   * One line on what is actually inside the file, because "a backup" is not
   * something anyone can picture — and knowing it is EVERYTHING is what tells
   * you this one file is worth keeping.
   */
  contents?: string;
  style?: StyleProp<ViewStyle>;
  /**
   * `budget-backup-location` / `house-backup-location` — drives every testID in
   * the card.
   *
   * Defaults to Budget's, which is what the component shipped with and what the
   * Budget Maestro flows already drive; House passes its own so a flow never
   * asserts against the other app's tree.
   */
  testIDPrefix?: string;
  testID?: string;
};

/**
 * "Your backup is here" — the answer that used to be a sentence.
 *
 * The old copy inlined the route as `Files → On My iPhone → Budget →
 * budget-backups` inside a paragraph that also carried the file name and the
 * recovery-phrase warning, so the one piece of information the user had to act
 * on was the least visible thing in the block.
 *
 * Three changes:
 *
 *  - The route is a breadcrumb, not prose. It wraps as folder chips, so a
 *    four-level path stays readable on a small screen instead of reflowing
 *    mid-arrow.
 *  - The file name gets its own line, at a weight you can read back to
 *    yourself while looking at a folder listing.
 *  - There is a button. Walking the breadcrumb by hand is now the fallback for
 *    when the OS refuses, not the only way in — see `backupFileAccess.ts`.
 */
export function BackupLocationCard({
  location,
  eyebrow = 'YOUR BUDGET — SAVED TO',
  contents = 'Everything in Budget — spendings, planning, savings and debts — sealed in this one file.',
  style,
  testIDPrefix = 'budget-backup-location',
  testID,
}: Props) {
  const colors = useAppColors();
  const [opening, setOpening] = useState(false);

  const canOpen = location.uri != null;
  const opensInFiles = opensInFilesApp(location.uri);

  const handleOpen = useCallback(async () => {
    setOpening(true);
    try {
      const result = await openBackupLocation(location);
      if (result.status === 'unavailable') {
        Alert.alert('Backup file', result.message);
      }
    } finally {
      setOpening(false);
    }
  }, [location]);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: hexToRgba(colors.primary, 0.06), borderColor: colors.borderColor },
        style,
      ]}
      testID={testID ?? `${testIDPrefix}-card`}
    >
      <View style={styles.header}>
        <View style={[styles.iconChip, { backgroundColor: hexToRgba(colors.primary, 0.12) }]}>
          <Icon name={location.icon} forceIonicons size={IconSize.md} color={colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Typography variant="caption2" color={colors.textSecondary} style={styles.eyebrow}>
            {eyebrow}
          </Typography>
          <Typography variant="body" weight="semibold" testID={`${testIDPrefix}-where`}>
            {location.where}
          </Typography>
        </View>
      </View>

      <Typography
        variant="caption1"
        color={colors.textSecondary}
        style={styles.fileName}
        testID={`${testIDPrefix}-file`}
      >
        {location.fileName}
      </Typography>

      <Typography
        variant="caption2"
        color={colors.textSecondary}
        testID={`${testIDPrefix}-contents`}
      >
        {contents}
      </Typography>

      {location.breadcrumb?.length ? (
        <View style={styles.breadcrumb} testID={`${testIDPrefix}-breadcrumb`}>
          {location.breadcrumb.map((segment, index) => (
            <React.Fragment key={`${index}-${segment}`}>
              {index > 0 ? (
                <Icon
                  name="chevron-forward"
                  size={IconSize.sm}
                  color={colors.textTertiary}
                  forceIonicons
                />
              ) : null}
              <View style={[styles.crumb, { backgroundColor: colors.cardBackground }]}>
                <Typography variant="caption2" color={colors.textSecondary} accessible={false}>
                  {segment}
                </Typography>
              </View>
            </React.Fragment>
          ))}
        </View>
      ) : null}

      {canOpen ? (
        <Button
          title={opening ? 'Opening…' : opensInFiles ? 'Open in Files' : 'Open or share'}
          variant="outline"
          size="sm"
          disabled={opening}
          style={styles.action}
          leftIcon={
            <Icon
              name={opensInFiles ? 'folder-open-outline' : 'open-outline'}
              forceIonicons
              size={IconSize.sm}
              color={colors.primary}
            />
          }
          onPress={() => void handleOpen()}
          testID={`${testIDPrefix}-open`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: CornerRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 1 },
  eyebrow: { letterSpacing: 0.6 },
  fileName: { marginTop: -Spacing.xs },
  breadcrumb: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.xs },
  crumb: {
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  action: { marginTop: Spacing.xs },
});
