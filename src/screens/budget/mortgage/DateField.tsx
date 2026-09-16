import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

interface DateFieldProps {
  label: string;
  /** Canonical value as `YYYY-MM-DD` (matches the API date columns). */
  value: string;
  onChange: (ymd: string) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  testID?: string;
}

/** Local `YYYY-MM-DD` (never UTC — avoids the off-by-one-day shift in `toISOString`). */
function dateToYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse `YYYY-MM-DD` back into a LOCAL Date (falls back to today for empty/garbage). */
function ymdToDate(ymd: string): Date {
  const [y, m, d] = (ymd || '').split('-').map((n) => parseInt(n, 10));
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) return new Date(y, m - 1, d);
  return new Date();
}

/**
 * Tappable date field for the mortgage forms — replaces free-text `YYYY-MM-DD`
 * entry with the native date picker so the user never types a date. Mirrors the
 * inline pattern in BudgetItemFormScreen (iOS: spinner + Done revealed below the
 * field; Android: the system dialog) and the field styling of `LenderPicker`, so
 * it sits consistently among the other form fields. Stores the chosen day as a
 * plain `YYYY-MM-DD` string, matching what the API expects.
 */
export function DateField({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
  testID = 'date-field',
}: DateFieldProps) {
  const colors = useAppColors();
  const { isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const current = ymdToDate(value);

  const handleChange = (_e: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setOpen(false);
    if (selected) onChange(dateToYMD(selected));
  };

  return (
    <View testID={testID}>
      <Typography variant="caption1" color={colors.textSecondary} style={styles.label}>
        {label}
      </Typography>

      <TouchableOpacity
        style={[styles.field, { borderColor: colors.borderColor, backgroundColor: colors.inputFieldBackground }]}
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.7}
        testID={`${testID}-field`}
      >
        <Typography variant="body" color={colors.textPrimary} testID={`${testID}-value`}>
          {current.toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </Typography>
        <Icon name="calendar-outline" size={IconSize.md} color={colors.primary} />
      </TouchableOpacity>

      {open && Platform.OS === 'ios' && (
        <View style={[styles.panel, { borderColor: colors.borderColor, backgroundColor: colors.cardBackground }]}>
          <DateTimePicker
            value={current}
            mode="date"
            display="spinner"
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            themeVariant={isDark ? 'dark' : 'light'}
            onChange={handleChange}
          />
          <TouchableOpacity onPress={() => setOpen(false)} style={styles.done} testID={`${testID}-done`}>
            <Typography variant="body" weight="semibold" color={colors.primary}>
              Done
            </Typography>
          </TouchableOpacity>
        </View>
      )}

      {open && Platform.OS === 'android' && (
        <DateTimePicker
          value={current}
          mode="date"
          display="default"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={handleChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: Spacing.xs },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    minHeight: 52,
  },
  panel: {
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  done: { alignSelf: 'flex-end', paddingVertical: Spacing.sm, paddingHorizontal: Spacing.xs },
});
