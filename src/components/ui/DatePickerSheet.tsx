import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useTheme } from '@contexts/ThemeContext';
import { Spacing, useAppColors } from '@theme';

import { BottomSheet } from './BottomSheet';
import { Typography } from './Typography';

interface DatePickerSheetProps {
  visible: boolean;
  /** Committed value — re-seeds the wheel every time the sheet opens. */
  value: Date;
  /** Fired on Done with the wheel's value; Cancel discards it. */
  onConfirm: (date: Date) => void;
  onClose: () => void;
  title?: string;
  /** Constraint note under the wheel, e.g. "Must be in August 2026." */
  helperText?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  testID?: string;
}

/**
 * iOS spinner's intrinsic wheel height. Stated explicitly because the sheet is
 * content-sized (`flex: 0`) — without a height the wheel measures to nothing.
 */
const WHEEL_HEIGHT = 216;

/**
 * The native date wheel in a small, content-hugging bottom sheet, instead of
 * inline below the field — the inline spinner pushes the rest of the form off
 * screen and leaves the tapped field and its Done button far apart. Cancel /
 * Done semantics (draft until Done) match `TimePickerSheet`.
 *
 * Android keeps the system dialog, which is that platform's convention and
 * already modal.
 */
export function DatePickerSheet({
  visible,
  value,
  onConfirm,
  onClose,
  title = 'Select date',
  helperText,
  minimumDate,
  maximumDate,
  testID = 'date-picker-sheet',
}: DatePickerSheetProps) {
  const colors = useAppColors();
  const { isDark } = useTheme();
  const [draft, setDraft] = useState<Date>(value);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  if (Platform.OS === 'android') {
    if (!visible) return null;
    return (
      <DateTimePicker
        value={value}
        mode="date"
        display="default"
        minimumDate={minimumDate}
        maximumDate={maximumDate}
        onChange={(event: DateTimePickerEvent, date?: Date) => {
          onClose();
          if (event.type === 'dismissed' || !date) return;
          onConfirm(date);
        }}
      />
    );
  }

  const handleDone = () => {
    onConfirm(draft);
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="content"
      noPadding
      title={title}
      showCloseButton
      headerAction={{ label: 'Done', onPress: handleDone, testID: `${testID}-done` }}
    >
      <View style={styles.body}>
        <DateTimePicker
          value={draft}
          mode="date"
          display="spinner"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(_event: DateTimePickerEvent, date?: Date) => {
            if (date) setDraft(date);
          }}
          style={styles.picker}
        />
        {helperText ? (
          <Typography variant="caption2" color={colors.textSecondary} style={styles.helper}>
            {helperText}
          </Typography>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.sm,
  },
  picker: {
    width: '100%',
    height: WHEEL_HEIGHT,
  },
  helper: {
    textAlign: 'center',
    paddingTop: Spacing.xs,
  },
});
