import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Typography } from '@components/ui';
import { CornerRadius, Spacing, useAppColors } from '@theme';

interface OnboardingSuggestionBannerProps {
  description: string;
  onApply: () => void;
  testID: string;
  /**
   * An `InfoButton` the caller builds itself (title/body/sources vary by
   * screen — calories vs. steps vs. water) and passes in ready to render,
   * same "slot" pattern as `CardSectionHeader`'s `right`. Omit for a screen
   * that has nothing more to explain than `description` already says.
   */
  info?: React.ReactNode;
}

/**
 * "Suggested for you" — a soft-tinted row the Nutrition, Activity and Water
 * onboarding steps each show once `useSuggestedGoals()` has a real answer
 * (weight, height, age, sex and activity level all on file). Tapping "Use
 * suggested" only fills that screen's own local fields — nothing is written
 * until the screen's own Continue, same as every other field on these steps.
 *
 * Deliberately not a `Card`: this is a hint about a value the member has not
 * typed yet, not a finished piece of content, so it uses a flat tinted fill
 * rather than the elevated card language the rest of each screen speaks.
 */
export function OnboardingSuggestionBanner({
  description,
  onApply,
  testID,
  info,
}: OnboardingSuggestionBannerProps) {
  const colors = useAppColors();
  return (
    <View
      style={[styles.wrap, { backgroundColor: colors.pillBackground }]}
      testID={testID}
    >
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <Typography variant="subheadline" weight="semibold" color={colors.textPrimary}>
            Suggested for you
          </Typography>
          {info}
        </View>
        <Typography variant="caption1" color={colors.textSecondary}>
          {description}
        </Typography>
      </View>
      <Button
        title="Use suggested"
        variant="outline"
        size="sm"
        onPress={onApply}
        testID={`${testID}-apply`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
});
