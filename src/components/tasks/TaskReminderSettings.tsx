import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Platform,
} from 'react-native';

import { Typography, Card, Toggle } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import {IconSize, useAppColors } from '@theme';

export interface ReminderSettings {
  reminder_enabled: boolean;
  reminder_days_before: number;
  reminder_time: string; // HH:MM format
  reminder_repeat: boolean;
}

interface TaskReminderSettingsProps {
  settings: ReminderSettings;
  onChange: (settings: ReminderSettings) => void;
  taskDueDate?: Date | null;
  isEditing?: boolean;
}

const DAYS_BEFORE_OPTIONS = [
  { label: 'On due date', value: 0 },
  { label: '1 day before', value: 1 },
  { label: '2 days before', value: 2 },
  { label: '3 days before', value: 3 },
  { label: '1 week before', value: 7 },
  { label: '2 weeks before', value: 14 },
  { label: '1 month before', value: 30 },
];

export function TaskReminderSettings({
  settings,
  onChange,
  taskDueDate,
}: TaskReminderSettingsProps) {
  const colors = useAppColors();  const [showDaysBeforePicker, setShowDaysBeforePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const updateSetting = <K extends keyof ReminderSettings>(
    key: K,
    value: ReminderSettings[K]
  ) => {
    onChange({ ...settings, [key]: value });
  };

  const parseTime = (timeStr: string): Date => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  };

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatTimeForStorage = (date: Date): string => {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  const getDaysBeforeLabel = (days: number): string => {
    const option = DAYS_BEFORE_OPTIONS.find((o) => o.value === days);
    if (option) return option.label;
    return `${days} days before`;
  };

  const getReminderPreview = (): string | null => {
    if (!settings.reminder_enabled || !taskDueDate) return null;

    const reminderDate = new Date(taskDueDate);
    reminderDate.setDate(reminderDate.getDate() - settings.reminder_days_before);

    return `Reminder will be sent on ${reminderDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })} at ${formatTime(parseTime(settings.reminder_time))}`;
  };

  const reminderPreview = getReminderPreview();

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerTitleRow}>
          <Icon name="notifications" size={IconSize.md} color={colors.textPrimary} />
          <Typography variant="headline" weight="semibold">
            Reminders
          </Typography>
        </View>
        <Toggle
          value={settings.reminder_enabled}
          onValueChange={(value) => updateSetting('reminder_enabled', value)}
        />
      </View>

      {settings.reminder_enabled && (
        <>
          {/* Reminder Preview */}
          {reminderPreview && (
            <Card
              variant="filled"
              style={[styles.previewCard, { backgroundColor: colors.primary + '15' }]}
            >
              <Typography variant="footnote" color={colors.primary}>
                {reminderPreview}
              </Typography>
            </Card>
          )}

          {/* Days Before */}
          <View style={styles.settingRow}>
            <Typography variant="subheadline" color={colors.textSecondary}>
              When to remind
            </Typography>
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => setShowDaysBeforePicker(!showDaysBeforePicker)}
            >
              <Typography variant="body" color={colors.textPrimary}>
                {getDaysBeforeLabel(settings.reminder_days_before)}
              </Typography>
              <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>

          {showDaysBeforePicker && (
            <View
              style={[styles.pickerOptions, { backgroundColor: colors.backgroundMain }]}
            >
              {DAYS_BEFORE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.pickerOption,
                    settings.reminder_days_before === option.value &&
                      styles.pickerOptionActive,
                  ]}
                  onPress={() => {
                    updateSetting('reminder_days_before', option.value);
                    setShowDaysBeforePicker(false);
                  }}
                >
                  <Typography
                    variant="body"
                    color={
                      settings.reminder_days_before === option.value
                        ? colors.primary
                        : colors.textPrimary
                    }
                  >
                    {option.label}
                  </Typography>
                  {settings.reminder_days_before === option.value && (
                    <Icon name="checkmark" size={IconSize.md} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.divider} />

          {/* Time */}
          <View style={styles.settingRow}>
            <Typography variant="subheadline" color={colors.textSecondary}>
              Reminder time
            </Typography>
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => setShowTimePicker(true)}
            >
              <Typography variant="body" color={colors.textPrimary}>
                {formatTime(parseTime(settings.reminder_time))}
              </Typography>
              <Icon name="time" size={IconSize.md} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>

          {showTimePicker && (
            <>
              <DateTimePicker
                value={parseTime(settings.reminder_time)}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_event, selectedDate) => {
                  if (Platform.OS === 'android') {
                    setShowTimePicker(false);
                  }
                  if (selectedDate) {
                    updateSetting('reminder_time', formatTimeForStorage(selectedDate));
                  }
                }}
              />
              {Platform.OS === 'ios' && (
                <TouchableOpacity
                  style={styles.datePickerDone}
                  onPress={() => setShowTimePicker(false)}
                >
                  <Typography
                    variant="body"
                    color={colors.primary}
                    weight="semibold"
                  >
                    Done
                  </Typography>
                </TouchableOpacity>
              )}
            </>
          )}

          <View style={styles.divider} />

          {/* Repeat Reminder */}
          <View style={styles.settingRow}>
            <View style={styles.settingLabelContainer}>
              <Typography variant="subheadline" color={colors.textSecondary}>
                Repeat after completion
              </Typography>
              <Typography
                variant="caption1"
                color={colors.textTertiary}
                style={styles.settingHint}
              >
                Schedule new reminder when task is completed
              </Typography>
            </View>
            <Toggle
              value={settings.reminder_repeat}
              onValueChange={(value) => updateSetting('reminder_repeat', value)}
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  previewCard: {
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  settingLabelContainer: {
    flex: 1,
    marginRight: 12,
  },
  settingHint: {
    marginTop: 2,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pickerOptions: {
    borderRadius: 12,
    marginTop: 8,
    marginBottom: 12,
    overflow: 'hidden',
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  pickerOptionActive: {
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  datePickerDone: {
    alignItems: 'flex-end',
    paddingVertical: 8,
  },
});

export default TaskReminderSettings;
