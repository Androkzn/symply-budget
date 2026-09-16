import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Typography } from '@components/ui';
import { CornerRadius, Spacing, hexToRgba, useAppColors } from '@theme';

export interface OnboardingChoiceOption {
  key: string;
  label: string;
}

interface OnboardingChoiceChipsProps {
  options: OnboardingChoiceOption[];
  /** Highlights the matching chip. Pass `null` for a preset row with nothing "selected". */
  selected: string | null;
  onSelect: (key: string) => void;
  testIDPrefix: string;
  accessibilityLabelPrefix?: string;
  /**
   * `'chip'` (default) — left-aligned, wrapping pill buttons for a shortcut/
   * preset row (several options, nothing forced to be "selected").
   *
   * `'segmented'` — a single full-width grouped control, iOS `UISegmentedControl`
   * style, for an exclusive either/or choice (always exactly one option active).
   */
  variant?: 'chip' | 'segmented';
  /**
   * `'chip'` variant only — centers the row and gives every pill the same
   * width instead of sizing each to its own label. For small fixed-choice
   * sets (e.g. a 3-way goal-type picker) as opposed to a left-aligned
   * wrapping preset row.
   */
  equalWidth?: boolean;
}

/**
 * A row of tappable chips — used both as a single-choice picker (gender,
 * weight-goal type) and as a preset shortcut row (calorie/step/water
 * quick-picks), which is why `selected` is nullable: a preset row highlights
 * nothing, it just fills the field above it.
 */
export function OnboardingChoiceChips({
  options,
  selected,
  onSelect,
  testIDPrefix,
  accessibilityLabelPrefix,
  variant = 'chip',
  equalWidth = false,
}: OnboardingChoiceChipsProps) {
  const colors = useAppColors();
  const segmented = variant === 'segmented';
  const equalWidthChips = equalWidth && !segmented;
  /** Subtle lift on the active segment — same recipe `Card`'s `elevated` variant uses. */
  const activeSegmentShadow = Platform.select({
    ios: {
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.12,
      shadowRadius: 2,
    },
    android: { elevation: 2 },
  });

  return (
    <View
      style={[
        styles.wrap,
        segmented && [styles.track, { backgroundColor: colors.groupedListBackground }],
        equalWidthChips && styles.wrapCentered,
      ]}
    >
      {options.map((option) => {
        const isSelected = option.key === selected;
        return (
          <Pressable
            key={option.key}
            onPress={() => onSelect(option.key)}
            accessibilityRole="button"
            accessibilityLabel={
              accessibilityLabelPrefix ? `${accessibilityLabelPrefix}: ${option.label}` : option.label
            }
            accessibilityState={{ selected: isSelected }}
            testID={`${testIDPrefix}-${option.key}`}
            style={[
              segmented ? styles.segment : styles.chip,
              equalWidthChips && styles.chipEqualWidth,
              segmented
                ? [
                    { backgroundColor: isSelected ? hexToRgba(colors.primary, 0.14) : 'transparent' },
                    isSelected && activeSegmentShadow,
                  ]
                : {
                    backgroundColor: isSelected
                      ? hexToRgba(colors.primary, 0.14)
                      : colors.backgroundMain,
                    borderColor: isSelected ? colors.primary : colors.borderColor,
                  },
            ]}
          >
            <Typography
              variant="footnote"
              weight="semibold"
              color={isSelected ? colors.primary : colors.textSecondary}
            >
              {option.label}
            </Typography>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: CornerRadius.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  wrapCentered: {
    justifyContent: 'center',
  },
  chipEqualWidth: {
    flex: 1,
    alignItems: 'center',
  },
  track: {
    flexWrap: 'nowrap',
    borderRadius: CornerRadius.md,
    padding: 3,
    gap: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: CornerRadius.sm,
  },
});
