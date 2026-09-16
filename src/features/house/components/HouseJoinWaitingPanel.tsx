import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import type { HouseJoinWait } from '@features/house/local/useHouseJoinWait';
import { formatEnrolmentSas } from '@symply/local-first';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

/**
 * "You are waiting, and here is the number they need to hear."
 *
 * The invitee's counterpart to `HouseJoinRequestsPanel`, and the reason both are
 * components rather than screen-local markup: each is the one urgent thing for
 * the person looking at it, and each has to appear on the hub as well as on the
 * screen where the act was performed.
 *
 * The digits are derived on THIS device from THIS device's own keys, so they are
 * a claim about what this device actually holds — not a number it was handed.
 * That is the whole content of the comparison.
 *
 * The outcome replaces the digits rather than joining them: reading a
 * verification number to somebody is pointless once there is nothing left to
 * verify, and "waiting for approval" about a cancelled invite is the screen
 * lying to the person who is waiting.
 *
 * Renders nothing when there is no wait, so callers can place it
 * unconditionally.
 */
export function HouseJoinWaitingPanel({ awaiting, sas, outcome, dismiss }: HouseJoinWait) {
  const colors = useAppColors();
  if (outcome) {
    return (
      <Card style={[styles.card, { borderColor: colors.warning }]} testID="house-join-outcome-panel">
        <View style={styles.head}>
          <Icon name="alert-circle" forceIonicons size={IconSize.lg} color={colors.warning} />
          <Typography variant="footnote" weight="semibold" style={styles.headText}>
            {outcome === 'revoked'
              ? 'That invite was cancelled'
              : outcome === 'expired'
                ? 'That invite expired'
                : 'You were removed from that home'}
          </Typography>
        </View>
        {/* Says that the home went with it, because it did — the half-joined
            property is dropped the moment the wait is known to have failed, and
            a device that quietly loses one is owed the sentence explaining why.
            Nothing of theirs was in it: no home key ever arrived, so it never
            held a readable row. */}
        <Typography variant="caption1" color={colors.textSecondary} testID="house-join-outcome">
          {outcome === 'revoked'
            ? 'It was cancelled before your device was approved, so that home has been taken off this device. Ask them to send a new invite — you can join with it here.'
            : outcome === 'expired'
              ? 'It ran out before your device was approved, so that home has been taken off this device. Ask them to send a new invite — you can join with it here.'
              : // Says approved, because it was — the dead end this describes is
                // the one where nothing about the INVITE ever looked wrong.
                'Your device was approved, but the home was taken off it before anything arrived. Ask them to send a new invite — you can join with it here.'}
        </Typography>
        <Pressable
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={Spacing.sm}
          testID="house-join-outcome-dismiss"
        >
          <Typography variant="caption1" weight="semibold" color={colors.primary}>
            Dismiss
          </Typography>
        </Pressable>
      </Card>
    );
  }

  if (!awaiting || !sas) return null;

  return (
    <Card style={[styles.card, { borderColor: colors.primary }]} testID="house-join-sas-panel">
      <View style={styles.head}>
        <Icon name="hourglass-outline" forceIonicons size={IconSize.lg} color={colors.primary} />
        <Typography variant="footnote" weight="semibold" style={styles.headText}>
          Waiting to be let in
        </Typography>
      </View>
      <Typography variant="caption1" color={colors.textSecondary}>
        Read this number to whoever invited you. They approve only if it matches what they see.
      </Typography>
      <Typography variant="title2" weight="semibold" style={styles.sas} testID="house-join-sas">
        {formatEnrolmentSas(sas)}
      </Typography>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm, borderWidth: 1, borderRadius: CornerRadius.lg, marginBottom: Spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headText: { flex: 1 },
  sas: { letterSpacing: 4, textAlign: 'center' },
});
