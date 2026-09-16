import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Platform,
  TouchableOpacity,
  ScrollView,
} from 'react-native';

import { formatTime12Hour, formatTime24Hour } from '@api/garbage-collection';
import type { CustomReminder } from '@api/garbage-collection';
import { Typography, Button, TextInput } from '@components/ui';
import { BottomSheet } from '@components/ui/BottomSheet';
import { Icon } from '@components/ui/Icon';
import { useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

interface CustomReminderModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (reminder: Omit<CustomReminder, 'id'>) => void;
  existingReminder?: CustomReminder;
  nextCollectionDate?: Date;
}

const DAYS_OFFSET_OPTIONS = [
  { value: -3, label: '3 days before' },
  { value: -2, label: '2 days before' },
  { value: -1, label: '1 day before' },
  { value: 0, label: 'Same day' },
];

export function CustomReminderModal({
  visible,
  onClose,
  onSave,
  existingReminder,
  nextCollectionDate,
}: CustomReminderModalProps) {  const colors = useAppColors();

  // Form state
  const [label, setLabel] = useState('');
  const [time, setTime] = useState('19:00');
  const [daysOffset, setDaysOffset] = useState(-1);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [timePickerValue, setTimePickerValue] = useState(new Date());

  // Validation
  const [labelError, setLabelError] = useState('');

  // Initialize form from existing reminder
  useEffect(() => {
    if (existingReminder) {
      setLabel(existingReminder.label);
      setTime(existingReminder.time);
      setDaysOffset(existingReminder.daysOffset);

      // Parse time for picker
      const [hour, minute] = existingReminder.time.split(':');
      const date = new Date();
      date.setHours(parseInt(hour, 10), parseInt(minute, 10), 0, 0);
      setTimePickerValue(date);
    } else {
      // Reset to defaults
      setLabel('');
      setTime('19:00');
      setDaysOffset(-1);

      const defaultTime = new Date();
      defaultTime.setHours(19, 0, 0, 0);
      setTimePickerValue(defaultTime);
    }
    setLabelError('');
  }, [existingReminder, visible]);

  // Calculate preview date
  const previewDate = useMemo(() => {
    if (!nextCollectionDate) return null;

    const preview = new Date(nextCollectionDate);
    preview.setDate(preview.getDate() + daysOffset);

    const [hour, minute] = time.split(':');
    preview.setHours(parseInt(hour, 10), parseInt(minute, 10), 0, 0);

    return preview;
  }, [nextCollectionDate, daysOffset, time]);

  const previewText = useMemo(() => {
    if (!previewDate) return '';

    const dateStr = previewDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const timeStr = formatTime12Hour(time);

    return `You'll be reminded on ${dateStr} at ${timeStr}`;
  }, [previewDate, time]);

  // Handle time picker change
  const handleTimeChange = (_event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowTimePicker(false);
    }

    if (selectedDate) {
      setTimePickerValue(selectedDate);
      setTime(formatTime24Hour(selectedDate));
    }
  };

  // Validate form
  const validate = (): boolean => {
    let isValid = true;

    if (!label.trim()) {
      setLabelError('Label is required');
      isValid = false;
    } else {
      setLabelError('');
    }

    return isValid;
  };

  // Handle save
  const handleSave = () => {
    if (!validate()) return;

    onSave({
      type: 'custom',
      time,
      daysOffset,
      label: label.trim(),
      enabled: true,
    });

    // Reset form
    setLabel('');
    setTime('19:00');
    setDaysOffset(-1);
    setLabelError('');
  };

  // Handle cancel
  const handleCancel = () => {
    setLabel('');
    setTime('19:00');
    setDaysOffset(-1);
    setLabelError('');
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={handleCancel}
      height="tall"
      title={existingReminder ? 'Edit Custom Reminder' : 'Add Custom Reminder'}
      showHandle
      showCloseButton
    >
      <ScrollView {...keyboardDismissScrollProps}
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Label Input */}
        <View style={styles.field}>
          <Typography variant="callout" weight="semibold" color={colors.textPrimary} style={styles.label}>
            LABEL
          </Typography>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="e.g., 2 Days Before, Morning Reminder"
            error={labelError}
            helperText="Give this reminder a descriptive name"
            maxLength={50}
          />
        </View>

        {/* Time Selection */}
        <View style={styles.field}>
          <Typography variant="callout" weight="semibold" color={colors.textPrimary} style={styles.label}>
            TIME
          </Typography>
          <TouchableOpacity
            onPress={() => setShowTimePicker(true)}
            style={[styles.timeButton, { backgroundColor: colors.backgroundMain, borderColor: colors.borderColor }]}
          >
            <Typography variant="body" color={colors.textPrimary}>
              {formatTime12Hour(time)}
            </Typography>
            <Icon name="chevron-down" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          <Typography variant="caption1" color={colors.textSecondary} style={styles.helperText}>
            When you want to be reminded
          </Typography>
        </View>

        {/* Days Offset Selection */}
        <View style={styles.field}>
          <Typography variant="callout" weight="semibold" color={colors.textPrimary} style={styles.label}>
            REMIND ME
          </Typography>
          <View style={styles.optionsContainer}>
            {DAYS_OFFSET_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                onPress={() => setDaysOffset(option.value)}
                style={[
                  styles.optionButton,
                  {
                    backgroundColor: daysOffset === option.value ? colors.primary : colors.backgroundMain,
                    borderColor: daysOffset === option.value ? colors.primary : colors.borderColor,
                  },
                ]}
              >
                <Typography
                  variant="subheadline"
                  weight={daysOffset === option.value ? 'semibold' : 'regular'}
                  color={daysOffset === option.value ? colors.white : colors.textPrimary}
                >
                  {option.label}
                </Typography>
              </TouchableOpacity>
            ))}
          </View>
          <Typography variant="caption1" color={colors.textSecondary} style={styles.helperText}>
            How many days before collection
          </Typography>
        </View>

        {/* Preview */}
        {previewText && (
          <View style={[styles.previewCard, { backgroundColor: colors.backgroundMain }]}>
            <Typography variant="caption1" weight="semibold" color={colors.primary} style={{ marginBottom: 4 }}>
              PREVIEW
            </Typography>
            <Typography variant="subheadline" color={colors.textPrimary}>
              {previewText}
            </Typography>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <Button
            title="Cancel"
            onPress={handleCancel}
            variant="ghost"
            style={styles.actionButton}
          />
          <Button
            title={existingReminder ? 'Save Changes' : 'Add Reminder'}
            onPress={handleSave}
            variant="primary"
            style={styles.actionButton}
          />
        </View>
      </ScrollView>

      {/* Time Picker */}
      {showTimePicker && (
        <DateTimePicker
          value={timePickerValue}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleTimeChange}
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  field: {
    marginBottom: 24,
  },
  label: {
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  timeButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  helperText: {
    marginTop: 6,
  },
  optionsContainer: {
    gap: 10,
  },
  optionButton: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  previewCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
  },
});
