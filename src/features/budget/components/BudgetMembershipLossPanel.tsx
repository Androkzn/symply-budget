import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import {
  dismissBudgetMembershipLoss,
  hydrateBudgetMembershipLosses,
  useBudgetMembershipLosses,
} from '@features/budget/local/membershipWatch';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

/**
 * "That household is gone from this phone, and here is why."
 *
 * The sibling of `BudgetJoinWaitingPanel`, and it exists for the sharper
 * version of the same reason. A member who is removed from a household — or who
 * left from their other phone — loses a household's entire budget off THIS
 * device, and the act that caused it happened somewhere they could not see.
 * `membershipWatch` performs the erasure correctly and silently; silently is
 * the half that is not acceptable on its own. Without this the budget simply
 * is not there the next time they open the app, which reads as data loss.
 *
 * The notice outlives the run that wrote it (see `membershipWatch` on why it is
 * persisted), so it is still here when they next look — the removal often lands
 * on a locked phone, and the push that announces it is best-effort besides.
 *
 * Renders nothing when there is nothing to say, so callers place it
 * unconditionally.
 */
export function BudgetMembershipLossPanel() {
  const colors = useAppColors();
  const losses = useBudgetMembershipLosses((state) => state.losses);

  useEffect(() => {
    void hydrateBudgetMembershipLosses();
  }, []);

  if (losses.length === 0) return null;

  return (
    <View testID="budget-membership-loss-panel">
      {losses.map((loss) => (
        <Card
          key={loss.householdId}
          style={[styles.card, { borderColor: colors.warning }]}
          testID={`budget-membership-loss-${loss.householdId}`}
        >
          <View style={styles.head}>
            <Icon name="alert-circle" forceIonicons size={IconSize.lg} color={colors.warning} />
            <Typography variant="footnote" weight="semibold" style={styles.headText}>
              {`You are no longer in "${loss.householdName}"`}
            </Typography>
          </View>
          {/* Names what went, in the same words the Leave confirmation uses —
              the two are the same act and must not describe it differently.
              Says it is unrecoverable because it is: the copy was local, and a
              re-invite starts from whatever the household holds now. */}
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID="budget-membership-loss-body"
          >
            Your membership ended, so everything that household held on this phone — budget,
            planning, spending, savings and history — has been deleted and cannot be recovered.
            You need a fresh invite to join it again.
          </Typography>
          <Pressable
            onPress={() => {
              void dismissBudgetMembershipLoss(loss.householdId);
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={Spacing.sm}
            testID={`budget-membership-loss-dismiss-${loss.householdId}`}
          >
            <Typography variant="caption1" weight="semibold" color={colors.primary}>
              Dismiss
            </Typography>
          </Pressable>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm, borderWidth: 1, borderRadius: CornerRadius.lg, marginBottom: Spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headText: { flex: 1 },
});
