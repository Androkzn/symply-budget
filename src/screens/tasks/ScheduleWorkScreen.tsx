import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useRoute } from "expo-router/react-navigation";
import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';

import { tasksApi } from '@api/tasks';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import type { TasksStackScreenProps } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';
import { toLocalDateKey } from '@utils/localDate';

export function ScheduleWorkScreen() {
  const navigation = useNavigation<TasksStackScreenProps<'ScheduleWork'>['navigation']>();
  const route = useRoute<TasksStackScreenProps<'ScheduleWork'>['route']>();
  const { taskId, contractorId } = route.params;
  const colors = useAppColors();

  const [scheduledDate, setScheduledDate] = useState(new Date());
  const [startTime, setStartTime] = useState(new Date());
  const [endTime, setEndTime] = useState(() => {
    const end = new Date();
    end.setHours(end.getHours() + 2);
    return end;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);

  const { currentHousehold } = useHouseholdStore();

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleSchedule = async () => {
    if (!currentHousehold) return;

    // Serialize the local calendar day the user sees — not toISOString(), which
    // converts to UTC and books the next day when picking in the evening west of GMT.
    const dateStr = toLocalDateKey(scheduledDate);
    const startTimeStr = `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}`;
    const endTimeStr = `${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`;

    try {
      await tasksApi.scheduleTaskWork(currentHousehold.id, taskId, {
        scheduled_date: dateStr,
        scheduled_time_start: startTimeStr,
        scheduled_time_end: endTimeStr,
        contractor_id: contractorId, // Pass contractor ID to create appointment
      });

      Alert.alert('Success', 'Work scheduled successfully!', [
        {
          text: 'OK',
          onPress: () => {
            // Navigate back to task detail
            navigation.navigate('TaskDetailFlow', {
              screen: 'TaskDetail',
              params: { taskId },
            });
          },
        },
      ]);
    } catch {
      Alert.alert('Error', 'Failed to schedule work');
    }
  };

  return (
    <AppBackground>
    <SafeAreaView edges={[]} style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
      <ScreenHeader
        title="Schedule Work"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
      <ScrollView
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.scrollContent}
      >
      <Typography variant="body" color={colors.textTertiary} >
        Choose date and time for contractor visit
      </Typography>

      <View style={styles.section}>
        <View style={[styles.sectionTitle, styles.sectionTitleRow]}>
          <Icon name="calendar" size={18} color={colors.textPrimary} />
          <Typography variant="bodyLarge" weight="semibold" color={colors.textPrimary}>
            Date
          </Typography>
        </View>
        <TouchableOpacity
          style={[styles.dateTimeCard, { backgroundColor: colors.card, borderColor: colors.borderColor }]}
          onPress={() => setShowDatePicker(true)}
        >
          <Typography variant="bodySmall" color={colors.textTertiary} style={styles.dateTimeLabel}>
            Selected Date:
          </Typography>
          <Typography variant="bodyLarge" weight="semibold" color={colors.primary}>
            {formatDate(scheduledDate)}
          </Typography>
        </TouchableOpacity>

        {showDatePicker && (
          <DateTimePicker
            value={scheduledDate}
            mode="date"
            minimumDate={new Date()}
            onChange={(_, selectedDate) => {
              setShowDatePicker(Platform.OS === 'ios');
              if (selectedDate) {
                setScheduledDate(selectedDate);
              }
            }}
          />
        )}
      </View>

      <View style={styles.section}>
        <View style={[styles.sectionTitle, styles.sectionTitleRow]}>
          <Icon name="time" size={18} color={colors.textPrimary} />
          <Typography variant="bodyLarge" weight="semibold" color={colors.textPrimary}>
            Start Time
          </Typography>
        </View>
        <TouchableOpacity
          style={[styles.dateTimeCard, { backgroundColor: colors.card, borderColor: colors.borderColor }]}
          onPress={() => setShowStartTimePicker(true)}
        >
          <Typography variant="bodySmall" color={colors.textTertiary} style={styles.dateTimeLabel}>
            Work Starts At:
          </Typography>
          <Typography variant="bodyLarge" weight="semibold" color={colors.primary}>
            {formatTime(startTime)}
          </Typography>
        </TouchableOpacity>

        {showStartTimePicker && (
          <DateTimePicker
            value={startTime}
            mode="time"
            onChange={(_, selectedTime) => {
              setShowStartTimePicker(Platform.OS === 'ios');
              if (selectedTime) {
                setStartTime(selectedTime);
                // Auto-adjust end time to 2 hours after start
                const newEndTime = new Date(selectedTime);
                newEndTime.setHours(newEndTime.getHours() + 2);
                setEndTime(newEndTime);
              }
            }}
          />
        )}
      </View>

      <View style={styles.section}>
        <View style={[styles.sectionTitle, styles.sectionTitleRow]}>
          <Icon name="time" size={18} color={colors.textPrimary} />
          <Typography variant="bodyLarge" weight="semibold" color={colors.textPrimary}>
            End Time (Optional)
          </Typography>
        </View>
        <TouchableOpacity
          style={[styles.dateTimeCard, { backgroundColor: colors.card, borderColor: colors.borderColor }]}
          onPress={() => setShowEndTimePicker(true)}
        >
          <Typography variant="bodySmall" color={colors.textTertiary} style={styles.dateTimeLabel}>
            Expected End:
          </Typography>
          <Typography variant="bodyLarge" weight="semibold" color={colors.primary}>
            {formatTime(endTime)}
          </Typography>
        </TouchableOpacity>

        {showEndTimePicker && (
          <DateTimePicker
            value={endTime}
            mode="time"
            minimumDate={startTime}
            onChange={(_, selectedTime) => {
              setShowEndTimePicker(Platform.OS === 'ios');
              if (selectedTime) {
                setEndTime(selectedTime);
              }
            }}
          />
        )}
      </View>

      <View style={[styles.infoBox, { backgroundColor: colors.backgroundSecondary }]}>
        <Icon name="information-circle" size={20} color={colors.info} style={styles.infoIcon} />
        <Typography variant="bodySmall" color={colors.textSecondary} style={styles.infoText}>
          The contractor will be notified of this scheduled time. You can reschedule later if needed.
        </Typography>
      </View>

      <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
        <Typography variant="bodyLarge" weight="semibold" color={colors.textPrimary} style={styles.summaryTitle}>
          Scheduled Work Summary
        </Typography>
        <View style={styles.summaryRow}>
          <Typography variant="body" color={colors.textTertiary}>Date:</Typography>
          <Typography variant="body" weight="medium" color={colors.textPrimary}>
            {formatDate(scheduledDate)}
          </Typography>
        </View>
        <View style={styles.summaryRow}>
          <Typography variant="body" color={colors.textTertiary}>Time:</Typography>
          <Typography variant="body" weight="medium" color={colors.textPrimary}>
            {formatTime(startTime)} - {formatTime(endTime)}
          </Typography>
        </View>
        <View style={styles.summaryRow}>
          <Typography variant="body" color={colors.textTertiary}>Duration:</Typography>
          <Typography variant="body" weight="medium" color={colors.textPrimary}>
            {Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60))} hours
          </Typography>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.scheduleButton, { backgroundColor: colors.success }]}
        onPress={handleSchedule}
      >
        <Typography variant="bodyLarge" weight="semibold" color={colors.white}>
          Confirm Schedule
        </Typography>
      </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Layout.bottomTabBarClearance,
  },
  header: {
    padding: Spacing.lg,
    borderBottomWidth: 1,
  },
  title: {
    marginBottom: Spacing.xs,
  },
  section: {
    padding: Spacing.base,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  dateTimeCard: {
    borderRadius: CornerRadius.md,
    padding: Spacing.base,
    borderWidth: 1,
  },
  dateTimeLabel: {
    marginBottom: Spacing.xs + Spacing.xxs,
  },
  infoBox: {
    flexDirection: 'row',
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    marginHorizontal: Spacing.base,
    marginBottom: Spacing.base,
  },
  infoIcon: {
    marginRight: Spacing.md,
  },
  infoText: {
    flex: 1,
    lineHeight: Spacing.lg,
  },
  summaryCard: {
    borderRadius: CornerRadius.md,
    padding: Spacing.lg,
    marginHorizontal: Spacing.base,
    marginBottom: Spacing.base,
    borderWidth: 1,
  },
  summaryTitle: {
    marginBottom: Spacing.base,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  scheduleButton: {
    paddingVertical: Spacing.base,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    marginHorizontal: Spacing.base,
    marginBottom: Spacing.xxl,
  },
});
