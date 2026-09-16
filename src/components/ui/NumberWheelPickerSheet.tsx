import { Picker } from '@react-native-picker/picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@contexts/ThemeContext';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { BottomSheet } from './BottomSheet';
import { Icon } from './Icon';
import { Typography } from './Typography';

interface NumberWheelPickerSheetProps {
  visible: boolean;
  title: string;
  /** Current value — snapped to the nearest step within [min, max] for the wheel's initial position. */
  value: number;
  min: number;
  max: number;
  step: number;
  /** Appended after each wheel value, e.g. "kcal". */
  unitLabel?: string;
  /**
   * Render a fractional step (e.g. `0.1`) as TWO side-by-side wheels — whole
   * number + decimal digit — instead of one wheel stepping through the
   * entire range. Only worth it for a range wide enough that a single
   * 0.1-step wheel would be hundreds of rows deep (e.g. weight 30–250 kg);
   * leave it off for a narrow decimal range (e.g. water in litres) where one
   * wheel is already short. No-op when `step` is a whole number.
   */
  splitDecimal?: boolean;
  onConfirm: (value: number) => void;
  onClose: () => void;
  /** "Enter manually" was tapped — the sheet closes; the caller switches its field to keyboard entry. */
  onManualEntry: () => void;
  manualEntryLabel?: string;
  /**
   * Optional content rendered between the header and the wheel — e.g. a unit
   * switcher (mL/L/cups/oz) that changes `min`/`max`/`step`/`value` live while
   * the sheet is open. Generic on purpose: this component stays unaware of
   * what the accessory controls, the same way it stays unaware of `unitLabel`'s
   * origin.
   */
  accessory?: React.ReactNode;
  testID?: string;
}

/** Decimal places `step` needs (e.g. `0.1` → 1, `50` → 0) — how finely to round so float drift never surfaces. */
function stepDecimals(step: number): number {
  const text = step.toString();
  const i = text.indexOf('.');
  return i === -1 ? 0 : text.length - i - 1;
}

function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function nearestStep(value: number, min: number, max: number, step: number, decimals: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  return roundToDecimals(min + Math.round((clamped - min) / step) * step, decimals);
}

/**
 * A native wheel (bottom sheet + `Picker`) for a bounded, evenly-stepped
 * numeric range — e.g. a calorie target in steps of 50. Pairs with a field
 * that opens this instead of the keyboard; "Enter manually" is the escape
 * hatch for a value that does not land on a step, and is the caller's cue to
 * switch that field over to free typing.
 */
export function NumberWheelPickerSheet({
  visible,
  title,
  value,
  min,
  max,
  step,
  unitLabel = '',
  splitDecimal = false,
  onConfirm,
  onClose,
  onManualEntry,
  manualEntryLabel = 'Enter a custom number',
  accessory,
  testID = 'number-wheel-picker',
}: NumberWheelPickerSheetProps) {
  const colors = useAppColors();
  const { isDark } = useTheme();

  const decimals = useMemo(() => stepDecimals(step), [step]);
  const isSplit = splitDecimal && decimals > 0;

  // Built from the STEP COUNT (not accumulated addition) — repeatedly adding a
  // fractional `step` (e.g. 0.1) drifts via float error (0.1 + 0.1 + 0.1 !==
  // 0.3), which would otherwise surface as garbage labels like "70.30000000004".
  const values = useMemo(() => {
    const count = Math.round((max - min) / step);
    const list: number[] = [];
    for (let i = 0; i <= count; i++) list.push(roundToDecimals(min + i * step, decimals));
    return list;
  }, [min, max, step, decimals]);

  // Split mode: a whole-number wheel (min..max, integer only) plus a decimal
  // wheel spanning one unit's subdivisions (e.g. 0.0–0.9 for a 0.1 step) —
  // together they land on the exact same grid `values` does, just without
  // forcing a single wheel hundreds of rows deep for a wide range.
  const wholeValues = useMemo(() => {
    if (!isSplit) return [];
    const list: number[] = [];
    for (let i = Math.floor(min); i <= Math.floor(max); i++) list.push(i);
    return list;
  }, [isSplit, min, max]);

  const decimalValues = useMemo(() => {
    if (!isSplit) return [];
    const ticks = Math.round(1 / step);
    const list: number[] = [];
    for (let i = 0; i < ticks; i++) list.push(roundToDecimals(i * step, decimals));
    return list;
  }, [isSplit, step, decimals]);

  const [draft, setDraft] = useState(() => nearestStep(value, min, max, step, decimals));
  const [wholeDraft, setWholeDraft] = useState(() => Math.floor(draft));
  const [decimalDraft, setDecimalDraft] = useState(() => roundToDecimals(draft - Math.floor(draft), decimals));

  useEffect(() => {
    if (!visible) return;
    const snapped = nearestStep(value, min, max, step, decimals);
    setDraft(snapped);
    setWholeDraft(Math.floor(snapped));
    setDecimalDraft(roundToDecimals(snapped - Math.floor(snapped), decimals));
  }, [visible, value, min, max, step, decimals]);

  const handleWholeChange = (picked: number) => {
    setWholeDraft(picked);
    setDraft(roundToDecimals(picked + decimalDraft, decimals));
  };

  const handleDecimalChange = (picked: number) => {
    setDecimalDraft(picked);
    setDraft(roundToDecimals(wholeDraft + picked, decimals));
  };

  const handleDone = () => {
    onConfirm(isSplit ? nearestStep(draft, min, max, step, decimals) : draft);
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="standard"
      noPadding
      title={title}
      showCloseButton
      headerAction={{ label: 'Done', onPress: handleDone, testID: `${testID}-done` }}
    >
      <View style={[styles.body, { backgroundColor: colors.backgroundMain }]}>
        {accessory}
        {isSplit ? (
          <View style={styles.splitRow}>
            <Picker
              selectedValue={wholeDraft}
              onValueChange={(picked) => handleWholeChange(Number(picked))}
              itemStyle={styles.pickerItem}
              style={styles.wholePicker}
              testID={`${testID}-whole`}
            >
              {wholeValues.map((v) => (
                <Picker.Item
                  key={v}
                  value={v}
                  label={String(v)}
                  color={isDark ? colors.textPrimary : undefined}
                />
              ))}
            </Picker>
            <Typography variant="title2" weight="semibold" style={styles.decimalSeparator}>
              .
            </Typography>
            <Picker
              selectedValue={decimalDraft}
              onValueChange={(picked) => handleDecimalChange(Number(picked))}
              itemStyle={styles.pickerItem}
              style={styles.decimalPicker}
              testID={`${testID}-decimal`}
            >
              {decimalValues.map((v) => {
                const digits = Math.round(v * 10 ** decimals)
                  .toString()
                  .padStart(decimals, '0');
                return (
                  <Picker.Item
                    key={v}
                    value={v}
                    label={digits}
                    color={isDark ? colors.textPrimary : undefined}
                  />
                );
              })}
            </Picker>
            {unitLabel ? (
              <Typography variant="subheadline" color={colors.textSecondary} style={styles.splitUnitLabel}>
                {unitLabel}
              </Typography>
            ) : null}
          </View>
        ) : (
          <Picker
            selectedValue={draft}
            onValueChange={(picked) => setDraft(Number(picked))}
            itemStyle={styles.pickerItem}
            testID={testID}
          >
            {values.map((v) => {
              const formatted = v.toLocaleString(undefined, {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
              });
              return (
                <Picker.Item
                  key={v}
                  value={v}
                  label={unitLabel ? `${formatted} ${unitLabel}` : formatted}
                  color={isDark ? colors.textPrimary : undefined}
                />
              );
            })}
          </Picker>
        )}

        <Pressable
          onPress={onManualEntry}
          accessibilityRole="button"
          accessibilityLabel={manualEntryLabel}
          testID={`${testID}-manual`}
          style={[styles.manualRow, { borderTopColor: colors.borderColor }]}
        >
          <Icon name="keypad-outline" size={18} color={colors.primary} />
          <Typography variant="footnote" weight="semibold" color={colors.primary}>
            {manualEntryLabel}
          </Typography>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: Spacing.base,
  },
  pickerItem: {
    fontSize: 22,
  },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wholePicker: {
    flex: 3,
  },
  decimalPicker: {
    flex: 2,
  },
  decimalSeparator: {
    marginTop: -Spacing.sm,
  },
  splitUnitLabel: {
    paddingLeft: Spacing.xs,
  },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderRadius: CornerRadius.sm,
  },
});
