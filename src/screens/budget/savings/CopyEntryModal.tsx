import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';

// Concrete path, not the @components/common barrel: that barrel re-exports
// screens' headers which import from @components/ui, so reaching SheetHeader
// through it closes a ui <-> common circular require and the component
// arrives undefined at render (see the same note in ui/BottomSheet).
import { SheetHeader } from '@components/common/SheetHeader';
import { GradientButton, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { CornerRadius, Spacing, useAppColors } from '@theme';

/**
 * "Copy to another month or day" sheet for a single income / spending entry.
 *
 * The parent owns the actual copy (a client-side `createIncome`/`createSpending`
 * with a fresh UUID and the chosen date). This sheet only lets the user choose
 * the target date: quick shifts (±1 day, ±1 month keeping the same day) plus a
 * free date picker. Dates are handled as local `YYYY-MM-DD` strings to match the
 * BE `income_date` / `spending_date` columns and avoid timezone drift.
 */

/** Parse a `YYYY-MM-DD` string into a local Date anchored at noon (TZ-safe). */
export function parseYMD(ymd: string): Date {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

/** Format a local Date back to `YYYY-MM-DD`. */
export function dateToYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Shift a `YYYY-MM-DD` by whole days. */
export function addDaysYMD(ymd: string, days: number): string {
  const date = parseYMD(ymd);
  date.setDate(date.getDate() + days);
  return dateToYMD(date);
}

/**
 * Shift a `YYYY-MM-DD` by whole months, clamping the day to the last day of the
 * target month (e.g. Jan 31 + 1 month → Feb 28/29).
 */
export function addMonthsYMD(ymd: string, months: number): string {
  const date = parseYMD(ymd);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return dateToYMD(date);
}

function formatLong(ymd: string): string {
  return parseYMD(ymd).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface CopyEntryModalProps {
  visible: boolean;
  /** Sheet title, e.g. "Copy income" / "Copy spending". */
  title: string;
  /** Label of the entry being copied, shown for context. */
  entryLabel: string;
  /** Source entry date as `YYYY-MM-DD`; seeds the initial target. */
  sourceDateYMD: string;
  busy?: boolean;
  onClose: () => void;
  /** Called with the chosen target `YYYY-MM-DD`. */
  onConfirm: (targetYMD: string) => void;
}

export function CopyEntryModal({
  visible,
  title,
  entryLabel,
  sourceDateYMD,
  busy = false,
  onClose,
  onConfirm,
}: CopyEntryModalProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const [target, setTarget] = useState<string>(sourceDateYMD);
  const [showPicker, setShowPicker] = useState(false);

  // Re-seed the target each time the sheet opens for a (possibly different) entry.
  useEffect(() => {
    if (visible) {
      setTarget(sourceDateYMD);
      setShowPicker(false);
    }
  }, [visible, sourceDateYMD]);

  const quickShifts = useMemo(
    () => [
      { key: 'prev-month', label: 'Prev month', ymd: addMonthsYMD(sourceDateYMD, -1) },
      { key: 'next-day', label: 'Next day', ymd: addDaysYMD(sourceDateYMD, 1) },
      { key: 'next-month', label: 'Next month', ymd: addMonthsYMD(sourceDateYMD, 1) },
    ],
    [sourceDateYMD]
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.backgroundMain }]}>
          {/* The app's one sheet header — glass ✕ on the left, centred title —
              instead of a teal "Cancel" balanced by a hand-measured spacer. */}
          <SheetHeader
            title={title}
            leftVariant="close"
            onLeftPress={onClose}
            leftTestID="copy-entry-cancel"
            leftAccessibilityLabel="Cancel"
            style={styles.header}
          />

          <Typography variant="caption1" color={colors.textSecondary} numberOfLines={1}>
            {entryLabel}
          </Typography>

          <View style={styles.chipRow}>
            {quickShifts.map((shift) => {
              const on = target === shift.ymd;
              return (
                <TouchableOpacity
                  key={shift.key}
                  onPress={() => setTarget(shift.ymd)}
                  activeOpacity={0.8}
                  testID={`copy-entry-quick-${shift.key}`}
                  style={[
                    styles.chip,
                    {
                      borderColor: on ? theme.pastel.teal : colors.borderColor,
                      backgroundColor: on ? `${theme.pastel.teal}1A` : colors.card,
                    },
                  ]}
                >
                  <Typography
                    variant="caption1"
                    weight={on ? 'semibold' : 'regular'}
                    color={on ? theme.pastel.teal : colors.textPrimary}
                  >
                    {shift.label}
                  </Typography>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[styles.dateRow, { borderColor: colors.borderColor, backgroundColor: colors.card }]}
            onPress={() => setShowPicker((v) => !v)}
            activeOpacity={0.8}
            testID="copy-entry-date-picker"
          >
            <Icon name="calendar-outline" size={18} color={theme.pastel.teal} />
            <Typography variant="body" weight="medium" testID="copy-entry-target-label">
              {formatLong(target)}
            </Typography>
          </TouchableOpacity>

          {showPicker && (
            <View style={styles.pickerContainer}>
              <DateTimePicker
                value={parseYMD(target)}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_event, selectedDate) => {
                  if (Platform.OS === 'android') setShowPicker(false);
                  if (selectedDate) setTarget(dateToYMD(selectedDate));
                }}
                testID="copy-entry-datetimepicker"
              />
            </View>
          )}

          <GradientButton
            title={busy ? 'Copying…' : `Copy to ${formatLong(target)}`}
            variant="blue"
            onPress={() => onConfirm(target)}
            disabled={busy}
            fullWidth
            style={styles.confirmBtn}
            testID="copy-entry-confirm"
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: CornerRadius.xl,
    borderTopRightRadius: CornerRadius.xl,
    padding: Spacing.base,
    gap: Spacing.md,
  },
  // The sheet already pads its own edges, so the header drops the horizontal
  // padding it carries by default rather than indenting the ✕ twice.
  header: { paddingHorizontal: 0 },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
  },
  pickerContainer: {
    alignItems: 'center',
  },
  confirmBtn: { marginTop: Spacing.xs },
});
