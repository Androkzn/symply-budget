import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Typography } from '@components/ui';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { numericTextHandler } from '@utils/keyboard';

interface OnboardingNumberFieldProps {
  label: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'number-pad' | 'decimal-pad';
  testID: string;
}

/** A labelled numeric text field, styled to match the in-app Goals screen. */
export function OnboardingNumberField({
  label,
  value,
  onChange,
  placeholder,
  keyboardType = 'number-pad',
  testID,
}: OnboardingNumberFieldProps) {
  const colors = useAppColors();
  return (
    <View style={styles.field}>
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
      <TextInput
        value={value}
        // Raw RN `TextInput`, so it does NOT get the shared `@components/ui`
        // field's automatic letter filter. The keypad is only a suggestion —
        // a paste, a Bluetooth keyboard or an Android IME with its alphabetic
        // row still delivers letters — so strip them here rather than leaving
        // it to whichever caller wires `onChange`.
        onChangeText={numericTextHandler(onChange)}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        keyboardType={keyboardType}
        autoCorrect={false}
        accessibilityLabel={label}
        testID={testID}
        style={[
          styles.input,
          {
            color: colors.textPrimary,
            borderColor: colors.borderColor,
            backgroundColor: colors.backgroundMain,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.xs,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
});
