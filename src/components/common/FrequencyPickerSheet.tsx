import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import type { RecurringReminderFrequency, RecurringReminderFrequencyOption } from '@api/recurringReminders';
import { BottomSheet, Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

interface FrequencyPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  options: RecurringReminderFrequencyOption[];
  selectedId?: RecurringReminderFrequency;
  onSelect: (id: RecurringReminderFrequency) => void;
  title?: string;
}

/**
 * How often a still-pending recurring reminder should re-nudge — the shared
 * picker for `services/recurring-reminders/` across every app (mirrors the
 * one-sheet-per-cross-cutting-concern convention, e.g. `TimePickerSheet`).
 * Picking an option both snoozes the very next nudge AND becomes the ongoing
 * cadence, so this is the same action whether opened from the in-app Active
 * list or after tapping the notification itself.
 */
export function FrequencyPickerSheet({
  visible,
  onClose,
  options,
  selectedId,
  onSelect,
  title = 'Remind me',
}: FrequencyPickerSheetProps) {
  const colors = useAppColors();

  return (
    // `content`, not a fixed fraction: four two-line option cards do not fit in
    // `short` (0.35 of the window), and a fixed-height sheet has no scroller —
    // the last options were simply cut off below the screen edge. `content`
    // hugs however many options the caller passes, up to the `tall` cap, and
    // scrolls only past it.
    <BottomSheet visible={visible} onClose={onClose} height="content" title={title} showCloseButton>
      <View style={styles.list}>
        {options.map((option) => {
          const isSelected = option.id === selectedId;
          return (
            <TouchableOpacity
              key={option.id}
              onPress={() => {
                onSelect(option.id);
                onClose();
              }}
              activeOpacity={0.7}
              testID={`frequency-option-${option.id}`}
            >
              <Card
                variant="outlined"
                style={[styles.row, isSelected && { borderColor: colors.accent, backgroundColor: colors.surfaceSelected }]}
              >
                <View style={styles.rowText}>
                  <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                    {option.label}
                  </Typography>
                  <Typography variant="footnote" color={colors.textSecondary} style={styles.rowDescription}>
                    {option.description}
                  </Typography>
                </View>
                {isSelected && <Icon name="checkmark-circle" size={IconSize.md} color={colors.accent} />}
              </Card>
            </TouchableOpacity>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.sm,
    // No paddingBottom here — a `content` sheet already pads its body by
    // Spacing.xl + the bottom safe-area inset.
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
  },
  rowText: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  rowDescription: {
    marginTop: 2,
  },
});
