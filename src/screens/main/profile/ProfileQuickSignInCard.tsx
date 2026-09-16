import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Icon, Toggle, Typography } from '@components/ui';
import { useBiometricQuickSignIn } from '@hooks/useBiometricQuickSignIn';
import { Spacing, useAppColors } from '@theme';

/**
 * Face ID / Touch ID quick sign-in, as a Profile row.
 *
 * A PIECE, not a screen: each brand's profile composition decides whether it
 * appears (see `src/screens/main/profile/`). It used to be inline JSX in the
 * shared ProfileScreen behind `(isFullBudget() || isHouseBrand())`, which is
 * exactly the kind of shell-level brand conditional that made two brands
 * conflict on the same lines while doing the SAME refactor independently
 * (2026-09-04, PR #88 — 23 conflict hunks across Profile/Settings).
 *
 * It renders nothing until the platform reports an enrolled biometric, so a
 * composition can include it unconditionally and let the device decide.
 *
 * The two testIDs are the ones this row has always had, kept on purpose: they
 * identify the ROW and the TOGGLE, `auth/biometric-*` and the Kaizen suites
 * already speak them, and renaming a live selector to describe its new
 * neighbourhood buys nothing.
 */
export function ProfileQuickSignInCard() {
  const colors = useAppColors();
  const biometric = useBiometricQuickSignIn();

  if (!biometric.available) return null;

  return (
    <Card variant="filled" style={styles.card} testID="settings-row-biometric">
      <View style={styles.row}>
        <Icon name={biometric.icon} size={24} color={colors.primary} />
        <View style={styles.text}>
          <Typography variant="body" weight="medium">
            {biometric.typeName}
          </Typography>
          <Typography variant="footnote" color={colors.textSecondary}>
            {biometric.enabled ? 'Enabled for quick sign in' : 'Enable for faster login'}
          </Typography>
        </View>
        <Toggle
          value={biometric.enabled}
          onValueChange={biometric.toggle}
          disabled={biometric.busy}
          testID="settings-toggle-biometric"
          accessibilityLabel={`${biometric.typeName} quick sign in`}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: Spacing.base,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  text: {
    flex: 1,
  },
});
