import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, Icon, NumberWheelPickerSheet, Typography } from '@components/ui';
import { CornerRadius, Sheet, Spacing, hexToRgba, useAppColors } from '@theme';
import { numericTextHandler } from '@utils/keyboard';

interface OnboardingWheelNumberFieldProps {
  label: string;
  /** Raw text state the caller owns — same shape `OnboardingNumberField` used, still sanitized by `onChange`. */
  value: string;
  onChange: (text: string) => void;
  min: number;
  max: number;
  step: number;
  /** Where the wheel opens when the field is currently empty. */
  defaultValue: number;
  /** Appended after each wheel value and shown next to a non-empty field, e.g. "kg". */
  unitLabel?: string;
  placeholder?: string;
  /** Rendered next to the label — an `InfoButton` explaining what this field feeds into. */
  infoButton?: React.ReactNode;
  /**
   * Leading icon avatar (Ionicons/brand-kit glyph name). Tinted-brand circle
   * while empty, flips to a solid brand fill once a value is entered. Omit to
   * render the plain text-only well.
   */
  icon?: string;
  /** Forwarded to `NumberWheelPickerSheet` — content between the header and the wheel, e.g. a unit switcher. */
  accessory?: React.ReactNode;
  /**
   * Short label shown next to the field's own label as a tappable pill, e.g.
   * "Units: Metric" — opens the SAME wheel sheet `accessory` lives in. Exists
   * because a switcher rendered only inside the sheet is invisible until this
   * field is tapped; a member who never opens it (height is fully optional)
   * never learns it changes anything beyond height. The pill surfaces the
   * CURRENT choice up front, on the main screen, without adding a second,
   * separate control.
   */
  accessoryHint?: string;
  /** Forwarded to `NumberWheelPickerSheet` — split a fractional step into whole + decimal wheels. */
  splitDecimal?: boolean;
  /**
   * Hide the visible label row while keeping `label` for the picker sheet's
   * title and the accessibility-label fallback. For a caller whose own card
   * already carries this exact word as its section heading a few lines
   * above (Home's "WEIGHT" card) — the field's own label repeated it right
   * back, and to a sighted user that read as two mismatched copies of the
   * same title rather than one.
   */
  showLabel?: boolean;
  testID: string;
  accessibilityLabel?: string;
}

/**
 * A labelled numeric field that opens a native wheel picker in a bottom sheet
 * on tap — the same "Enter manually" escape-hatch pattern the onboarding
 * calorie field (`HealthGoalsNutritionScreen`) pioneered — rather than
 * raising the keyboard directly. Replaces `OnboardingNumberField` across the
 * Health goals mini-flow so every numeric field in onboarding behaves the
 * same way.
 *
 * Stays in free-typing mode once "Enter manually" is tapped (`manualMode`),
 * since a value that does not land on a wheel step (or a member who just
 * prefers typing) needs the keyboard, not another tap-to-reopen wheel.
 */
export function OnboardingWheelNumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  defaultValue,
  unitLabel,
  placeholder = 'Tap to choose',
  infoButton,
  icon,
  accessory,
  accessoryHint,
  splitDecimal,
  showLabel = true,
  testID,
  accessibilityLabel,
}: OnboardingWheelNumberFieldProps) {
  const colors = useAppColors();
  const [manualMode, setManualMode] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const numericValue = value.length > 0 ? Number(value.replace(',', '.')) : NaN;
  const hasValue = Number.isFinite(numericValue);
  const decimalStep = !Number.isInteger(step);

  const openPicker = () => {
    if (manualMode) return;
    setPickerVisible(true);
  };

  const handleWellPress = () => {
    if (manualMode) {
      inputRef.current?.focus();
    } else {
      setPickerVisible(true);
    }
  };

  const handleManualEntry = () => {
    setPickerVisible(false);
    setManualMode(true);
    // Wait out the sheet's close animation so the keyboard isn't fighting the
    // sheet's slide-down for the screen.
    setTimeout(() => inputRef.current?.focus(), Sheet.dismissAnimDurationMs);
  };

  return (
    <View style={styles.field}>
      {showLabel ? (
        <View style={[styles.labelRow, accessoryHint && styles.labelRowSpaced]}>
          <View style={styles.labelMain}>
            <Typography variant="caption1" color={colors.textSecondary}>
              {label}
            </Typography>
            {infoButton}
          </View>
          {accessoryHint ? (
            <Pressable
              onPress={handleWellPress}
              accessibilityRole="button"
              accessibilityLabel={`Units: ${accessoryHint}. Tap to change.`}
              testID={`${testID}-units-hint`}
              style={[styles.hintPill, { borderColor: colors.primary, backgroundColor: hexToRgba(colors.primary, 0.1) }]}
            >
              <Typography variant="caption2" weight="semibold" color={colors.primary}>
                {accessoryHint}
              </Typography>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Card
        variant="elevated"
        pressable
        onPress={handleWellPress}
        style={styles.well}
        // `TextInput` below is `pointerEvents: 'none'` while `!manualMode`, which
        // also drops it out of the accessibility tree on a real device/
        // simulator (VoiceOver and Maestro/XCUITest can no longer find it by
        // `testID`/label there — react-test-renderer has no concept of
        // `pointerEvents` and does not see this, which is why Jest alone
        // never caught it). Card is the REAL tap target whenever the field
        // itself is not, so it carries the same `testID` unconditionally —
        // not instead of the field's, additionally, so there is always
        // something on-screen a real tap-by-id can land on. Being a
        // `Pressable`, Card also carries its OWN internal `onFocus` — any
        // Jest helper disambiguating same-testID matches must key off
        // `onChangeText` (TextInput-exclusive), not `onFocus`.
        testID={testID}
        accessibilityLabel={accessibilityLabel ?? label}
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
        <TextInput
          ref={inputRef}
          value={value}
          // Raw RN `TextInput`, so the shared `@components/ui` field's automatic
          // letter filter does not apply here. Callers each sanitize in their own
          // `onChange`, but the keypad alone stops nothing a paste or a hardware
          // keyboard sends — strip letters at the field so the component is safe
          // for the next caller too.
          onChangeText={numericTextHandler(onChange)}
          onFocus={openPicker}
          showSoftInputOnFocus={manualMode}
          caretHidden={!manualMode}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          keyboardType={decimalStep ? 'decimal-pad' : 'number-pad'}
          autoCorrect={false}
          pointerEvents={manualMode ? 'auto' : 'none'}
          accessibilityLabel={accessibilityLabel ?? label}
          testID={testID}
          style={[styles.input, { color: colors.textPrimary }]}
        />
        {unitLabel && hasValue ? (
          <Typography variant="subheadline" color={colors.textSecondary}>
            {unitLabel}
          </Typography>
        ) : null}
        {!manualMode && (
          <View style={[styles.chevronWrap, { backgroundColor: colors.groupedListBackground }]}>
            <Icon name="chevron-down" size={14} color={colors.textSecondary} />
          </View>
        )}
      </Card>

      <NumberWheelPickerSheet
        visible={pickerVisible}
        title={label}
        value={hasValue ? numericValue : defaultValue}
        min={min}
        max={max}
        step={step}
        unitLabel={unitLabel}
        splitDecimal={splitDecimal}
        onConfirm={(picked) => onChange(String(picked))}
        onClose={() => setPickerVisible(false)}
        onManualEntry={handleManualEntry}
        accessory={accessory}
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
  labelRowSpaced: {
    justifyContent: 'space-between',
  },
  labelMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  hintPill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: CornerRadius.full,
    borderWidth: 1,
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
  input: {
    flex: 1,
    fontSize: 16,
  },
  chevronWrap: {
    width: 26,
    height: 26,
    borderRadius: CornerRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
