import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { Icon, Typography } from '@components/ui';
import { Spacing, useAppColors } from '@theme';

/**
 * ABOUT — Terms of Service and Privacy Policy.
 *
 * A PIECE, not a screen: each brand's profile composition decides whether it
 * appears (see `src/screens/main/profile/`). These are account-level documents
 * rather than app preferences, so brands whose More tab became the overflow-tabs
 * hub surface them here; the others still list them in More's own ABOUT section.
 *
 * Root routes rather than stack screens, because Profile is a sibling TAB of the
 * one hosting the Settings stack those screens also live in — an imperative push
 * from here cannot cross tabs.
 */
export function ProfileAboutSection() {
  const colors = useAppColors();
  const router = useRouter();

  return (
    <View style={styles.about}>
      <Typography
        variant="caption1"
        weight="semibold"
        color={colors.textSecondary}
        style={styles.label}
      >
        ABOUT
      </Typography>

      <TouchableOpacity
        onPress={() => router.push('/terms-of-service')}
        style={styles.row}
        accessible
        accessibilityRole="link"
        accessibilityLabel="Terms of Service"
        testID="profile-terms-of-service"
      >
        <Typography variant="body" accessible={false}>
          Terms of Service
        </Typography>
        <Icon name="chevron-forward" size={20} color={colors.textTertiary} />
      </TouchableOpacity>

      <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />

      <TouchableOpacity
        onPress={() => router.push('/privacy-policy')}
        style={styles.row}
        accessible
        accessibilityRole="link"
        accessibilityLabel="Privacy Policy"
        testID="profile-privacy-policy"
      >
        <Typography variant="body" accessible={false}>
          Privacy Policy
        </Typography>
        <Icon name="chevron-forward" size={20} color={colors.textTertiary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  about: {
    marginTop: Spacing.xxl,
  },
  label: {
    marginBottom: Spacing.sm,
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.smd,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.xs,
  },
});
