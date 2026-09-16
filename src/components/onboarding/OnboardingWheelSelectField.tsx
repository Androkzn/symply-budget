import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Icon, OptionWheelPickerSheet, Typography } from '@components/ui';
import type { OptionWheelPickerOption } from '@components/ui';
import { CornerRadius, Spacing, hexToRgba, useAppColors } from '@theme';

export type { OptionWheelPickerOption as OnboardingWheelSelectOption };

interface OnboardingWheelSelectFieldProps<T extends string> {
  label: string;
  options: OptionWheelPickerOption<T>[];
  /** `null` renders the placeholder — nothing picked yet, the field is skippable. */
  value: T | null;
  onChange: (value: T) => void;
  placeholder?: string;
  /** Rendered next to the label — an `InfoButton` explaining what this field feeds into. */
  infoButton?: React.ReactNode;
  /**
   * Leading icon avatar (Ionicons/brand-kit glyph name). Tinted-brand circle
   * while empty, flips to a solid brand fill once a value is picked — a quiet
   * "this one's answered" signal. Omit to render the plain text-only well.
   */
  icon?: string;
  testID: string;
  accessibilityLabel?: string;
}

/**
 * A labelled dropdown field that opens a native wheel picker in a bottom
 * sheet on tap — the enum counterpart to `OnboardingWheelNumberField`, for a
 * small fixed set of choices (gender, activity level) instead of a numeric
 * range. Every option is shown on the wheel, so there is no "Enter manually"
 * escape hatch.
 */
export function OnboardingWheelSelectField<T extends string>({
  label,
  options,
  value,
  onChange,
  placeholder = 'Tap to choose',
  infoButton,
  icon,
  testID,
  accessibilityLabel,
}: OnboardingWheelSelectFieldProps<T>) {
  const colors = useAppColors();
  const [pickerVisible, setPickerVisible] = useState(false);

  const selectedLabel = options.find((option) => option.key === value)?.label ?? null;
  const hasValue = selectedLabel !== null;

  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Typography variant="caption1" color={colors.textSecondary}>
          {label}
        </Typography>
        {infoButton}
      </View>
      <Card
        variant="elevated"
        pressable
        onPress={() => setPickerVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        testID={testID}
        style={styles.well}
      >
        {icon ? (
          <View
            style={[
              styles.iconAvatar,
              { backgroundColor: hasValue ? colors.primary : hexToRgba(colors.primary, 0.12) },
            ]}
          >
            <Icon
              name={icon}
              size={18}
              color={hasValue ? colors.white : colors.primary}
            />
          </View>
        ) : null}
        <Typography
          variant="body"
          weight={hasValue ? 'semibold' : 'regular'}
          style={styles.value}
          color={hasValue ? colors.textPrimary : colors.textSecondary}
          numberOfLines={1}
        >
          {selectedLabel ?? placeholder}
        </Typography>
        <View style={[styles.chevronWrap, { backgroundColor: colors.groupedListBackground }]}>
          <Icon name="chevron-down" size={14} color={colors.textSecondary} />
        </View>
      </Card>

      <OptionWheelPickerSheet
        visible={pickerVisible}
        title={label}
        options={options}
        value={value ?? options[0].key}
        onConfirm={onChange}
        onClose={() => setPickerVisible(false)}
        testID={`${testID}-picker`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.xs,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  well: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 44,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  iconAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    flex: 1,
  },
  chevronWrap: {
    width: 26,
    height: 26,
    borderRadius: CornerRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
