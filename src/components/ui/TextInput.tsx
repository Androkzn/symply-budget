import React, { forwardRef, useCallback } from 'react';
import {
  Platform,
  StyleProp,
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  TextInputProps as RNTextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  CornerRadius,
  Elevation,
  LegacyTextVariant,
  Opacity,
  Spacing,
  TypographyTokens,
  UIFoundation,
  useAppColors,
} from '@theme';
import { isNumericKeyboardType, stripLettersForNumericInput } from '@utils/keyboard';

interface TextInputProps extends RNTextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  labelColor?: string;
  helperTextColor?: string;
  /** Styles the outer wrapper (e.g. `flex: 1` to fill a row); `style` targets the inner field. */
  containerStyle?: StyleProp<ViewStyle>;
}

export const TextInput = forwardRef<RNTextInput, TextInputProps>(
  (
    { label, error, hint, helperText, leftIcon, rightIcon, labelColor, helperTextColor, containerStyle, style, keyboardType, onChangeText, ...props },
    ref
  ) => {    const colors = useAppColors();
    // A numeric keypad is a suggestion, not a constraint — a paste, a Bluetooth
    // keyboard, or an Android IME that keeps its alphabetic row can still put
    // letters into a money field. Every field in the app funnels through this
    // component, so filtering here is what actually makes "digits only" true.
    // See `@utils/keyboard` for why only letters are stripped.
    const numeric = isNumericKeyboardType(keyboardType);
    const handleChangeText = useCallback(
      (text: string) => onChangeText?.(numeric ? stripLettersForNumericInput(text) : text),
      [numeric, onChangeText]
    );
    const borderColorAnim = useSharedValue(0);

    const baseBorder = error ? colors.error : colors.borderColor;
    const focusedBorder = error ? colors.error : colors.primary;

    const handleFocus = () => {
      borderColorAnim.value = withTiming(1, { duration: 200 });
    };

    const handleBlur = () => {
      borderColorAnim.value = withTiming(0, { duration: 200 });
    };

    const animatedBorderStyle = useAnimatedStyle(() => ({
      borderColor: interpolateColor(borderColorAnim.value, [0, 1], [baseBorder, focusedBorder]),
    }));

    return (
      <View style={[styles.container, containerStyle]}>
        {label && (
          <Text
            style={[
              styles.label,
              { color: error ? colors.error : (labelColor || colors.textPrimary) },
            ]}
          >
            {label}
          </Text>
        )}

        <Animated.View
          style={[
            styles.inputContainer,
            {
              backgroundColor: colors.card,
              borderColor: error ? colors.error : baseBorder,
              ...Platform.select({
                ios: {
                  shadowColor: colors.black,
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: Opacity.textFieldSubtle,
                  shadowRadius: 2,
                },
                android: {
                  elevation: Elevation.input,
                },
              }),
            },
            animatedBorderStyle,
          ]}
        >
          {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}

          <RNTextInput
            ref={ref}
            style={[
              styles.input,
              { color: colors.textPrimary },
              leftIcon ? styles.inputWithLeftIcon : undefined,
              rightIcon ? styles.inputWithRightIcon : undefined,
              style,
            ]}
            placeholderTextColor={colors.textTertiary}
            onFocus={handleFocus}
            onBlur={handleBlur}
            selectionColor={colors.primary}
            keyboardType={keyboardType}
            onChangeText={onChangeText ? handleChangeText : undefined}
            {...props}
          />

          {rightIcon && <View style={styles.rightIcon}>{rightIcon}</View>}
        </Animated.View>

        {(error || hint || helperText) && (
          <Text
            style={[
              styles.helperText,
              {
                color: error
                  ? colors.error
                  : (helperTextColor || colors.textSecondary),
              },
            ]}
          >
            {error || hint || helperText}
          </Text>
        )}
      </View>
    );
  }
);

TextInput.displayName = 'TextInput';

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.base,
  },
  label: {
    fontSize: TypographyTokens.bodySmall.size,
    lineHeight: TypographyTokens.bodySmall.lineHeight,
    fontWeight: '500',
    marginBottom: Spacing.sm,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    paddingVertical: Spacing.md + Spacing.xxs,
    paddingHorizontal: Spacing.base,
    fontSize: LegacyTextVariant.callout.size,
    lineHeight: LegacyTextVariant.callout.lineHeight,
    letterSpacing: UIFoundation.textLetterSpacing,
  },
  inputWithLeftIcon: {
    paddingLeft: Spacing.sm,
  },
  inputWithRightIcon: {
    paddingRight: Spacing.sm,
  },
  leftIcon: {
    paddingLeft: Spacing.base,
  },
  rightIcon: {
    paddingRight: Spacing.base,
  },
  helperText: {
    fontSize: LegacyTextVariant.caption1.size,
    lineHeight: LegacyTextVariant.caption1.lineHeight,
    marginTop: Spacing.xs + 2,
    marginLeft: Spacing.xs,
  },
});
