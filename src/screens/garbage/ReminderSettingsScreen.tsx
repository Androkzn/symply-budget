import DateTimePicker from '@react-native-community/datetimepicker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute, RouteProp } from 'expo-router/react-navigation';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Calendar } from 'react-native-calendars';

import { garbageCollectionApi, formatTime12Hour, formatTime24Hour, parseTime24Hour } from '@api/garbage-collection';
import type { GarbageSchedule, CollectionDate, CustomReminder } from '@api/garbage-collection';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { CustomReminderModal } from '@components/garbage/CustomReminderModal';
import { Typography, Button, Card, Toggle } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { GarbageStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Header, Spacing, useAppColors } from '@theme';

type ReminderSettingsScreenNavigationProp = NativeStackNavigationProp<GarbageStackParamList, 'ReminderSettings'>;
type ReminderSettingsScreenRouteProp = RouteProp<GarbageStackParamList, 'ReminderSettings'>;

interface PresetReminders {
  nightBefore: { enabled: boolean; time: string };
  morningOf: { enabled: boolean; time: string };
}

export function ReminderSettingsScreen() {  const colors = useAppColors();
  const navigation = useNavigation<ReminderSettingsScreenNavigationProp>();
  const route = useRoute<ReminderSettingsScreenRouteProp>();
  const { scheduleId } = route.params;
  const { currentHousehold } = useHouseholdStore();

  // State
  const [schedule, setSchedule] = useState<GarbageSchedule | null>(null);
  const [upcomingDates, setUpcomingDates] = useState<CollectionDate[]>([]);
  const [presetReminders, setPresetReminders] = useState<PresetReminders>({
    nightBefore: { enabled: true, time: '19:00' },
    morningOf: { enabled: false, time: '07:00' },
  });
  const [customReminders, setCustomReminders] = useState<CustomReminder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Time picker states
  const [showNightBeforePicker, setShowNightBeforePicker] = useState(false);
  const [showMorningOfPicker, setShowMorningOfPicker] = useState(false);
  const [nightBeforeTime, setNightBeforeTime] = useState(new Date());
  const [morningOfTime, setMorningOfTime] = useState(new Date());

  // Custom reminder modal
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [editingReminder, setEditingReminder] = useState<CustomReminder | undefined>();

  // Calendar collapsed state
  const [isCalendarCollapsed, setIsCalendarCollapsed] = useState(false);

  // Load schedule and upcoming dates
  const loadData = useCallback(async () => {
    if (!currentHousehold) return;

    try {
      setIsLoading(true);
      setError(null);

      // Load schedule
      const scheduleResponse = await garbageCollectionApi.getSchedule(currentHousehold.id);
      const foundSchedule = scheduleResponse.schedule;

      if (!foundSchedule || foundSchedule.id !== scheduleId) {
        setError('Schedule not found');
        return;
      }

      setSchedule(foundSchedule);

      // Load upcoming collection dates
      const datesResponse = await garbageCollectionApi.getNextCollections(
        currentHousehold.id,
        scheduleId,
        30
      );
      setUpcomingDates(datesResponse.dates);

      // Initialize reminders from schedule
      if (foundSchedule.reminders) {
        setPresetReminders({
          nightBefore: foundSchedule.reminders.nightBefore || { enabled: true, time: '19:00' },
          morningOf: foundSchedule.reminders.morningOf || { enabled: false, time: '07:00' },
        });

        // Initialize time picker values
        setNightBeforeTime(parseTime24Hour(foundSchedule.reminders.nightBefore?.time || '19:00'));
        setMorningOfTime(parseTime24Hour(foundSchedule.reminders.morningOf?.time || '07:00'));

        // Load custom reminders if they exist
        if (foundSchedule.reminders.custom && Array.isArray(foundSchedule.reminders.custom)) {
          setCustomReminders(foundSchedule.reminders.custom);
        } else {
          setCustomReminders([]);
        }
      } else {
        setCustomReminders([]);
      }
    } catch (err) {
      console.error('Failed to load reminder settings:', err);
      setError('Failed to load reminder settings');
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold, scheduleId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle save
  const handleSave = async () => {
    if (!schedule || !currentHousehold) return;

    setIsSaving(true);
    try {
      // Combine preset and custom reminders
      const allReminders: CustomReminder[] = [];

      // Add nightBefore if enabled
      if (presetReminders.nightBefore.enabled) {
        allReminders.push({
          id: 'nightBefore',
          type: 'evening_before',
          time: presetReminders.nightBefore.time,
          daysOffset: -1,
          label: 'Evening Before',
          enabled: true,
        });
      }

      // Add morningOf if enabled
      if (presetReminders.morningOf.enabled) {
        allReminders.push({
          id: 'morningOf',
          type: 'morning_of',
          time: presetReminders.morningOf.time,
          daysOffset: 0,
          label: 'Morning Of',
          enabled: true,
        });
      }

      // Add custom reminders
      allReminders.push(...customReminders);

      await garbageCollectionApi.updateReminders(
        currentHousehold.id,
        schedule.id,
        allReminders
      );

      if (Platform.OS === 'ios') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      // Navigate back
      navigation.goBack();
    } catch (err) {
      console.error('Failed to save reminders:', err);
      setError('Failed to save reminders');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle nightBefore time change
  const handleNightBeforeTimeChange = (_event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowNightBeforePicker(false);
    }

    if (selectedDate) {
      setNightBeforeTime(selectedDate);
      setPresetReminders(prev => ({
        ...prev,
        nightBefore: {
          ...prev.nightBefore,
          time: formatTime24Hour(selectedDate),
        },
      }));
    }
  };

  // Handle morningOf time change
  const handleMorningOfTimeChange = (_event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowMorningOfPicker(false);
    }

    if (selectedDate) {
      setMorningOfTime(selectedDate);
      setPresetReminders(prev => ({
        ...prev,
        morningOf: {
          ...prev.morningOf,
          time: formatTime24Hour(selectedDate),
        },
      }));
    }
  };

  // Handle custom reminder save
  const handleCustomReminderSave = (reminder: Omit<CustomReminder, 'id'>) => {
    if (editingReminder) {
      // Update existing
      setCustomReminders(prev =>
        prev.map(r => (r.id === editingReminder.id ? { ...reminder, id: r.id } : r))
      );
    } else {
      // Add new
      setCustomReminders(prev => [
        ...prev,
        { ...reminder, id: `custom_${Date.now()}` },
      ]);
    }

    setShowCustomModal(false);
    setEditingReminder(undefined);
  };

  // Handle custom reminder delete
  const handleCustomReminderDelete = (id: string) => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setCustomReminders(prev => prev.filter(r => r.id !== id));
  };

  // Calendar marked dates
  const markedDates = useMemo(() => {
    const marked: { [date: string]: any } = {};

    upcomingDates.forEach(({ date, types }) => {
      const dots = types.map(type => {
        switch (type) {
          case 'garbage':
            return { key: 'garbage', color: colors.textSecondary };
          case 'recycling':
            return { key: 'recycling', color: colors.blue };
          case 'organics':
            return { key: 'organics', color: colors.success };
          default:
            return { key: type, color: colors.primary };
        }
      });

      marked[date] = {
        dots,
        marked: true,
      };
    });

    return marked;
  }, [upcomingDates, colors.primary, colors.textSecondary, colors.blue, colors.success]);

  // Next collection date for custom reminder preview
  const nextCollectionDate = useMemo(() => {
    if (upcomingDates.length === 0) return undefined;
    return new Date(upcomingDates[0].date);
  }, [upcomingDates]);

  const renderScreenHeader = (rightElement?: React.ReactNode, onBackPress?: () => void) => (
    <ScreenHeader
      title="Reminder Settings"
      showBackButton
      onBackPress={onBackPress ?? (() => navigation.goBack())}
      showNotificationBell={false}
      showAvatar={false}
      rightElement={rightElement}
    />
  );

  // Loading state
  if (isLoading) {
    return (
      <AppBackground opacity={0.5}>
        <View style={styles.container}>
          {renderScreenHeader()}

          {/* Loading indicator */}
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Typography variant="body" color={colors.textSecondary} style={styles.loadingText}>
              Loading reminders...
            </Typography>
          </View>
        </View>
      </AppBackground>
    );
  }

  // Error state
  if (error || !schedule) {
    return (
      <AppBackground opacity={0.5}>
        <View style={styles.container}>
          {renderScreenHeader()}

          {/* Error card */}
          <View style={styles.content}>
            <Card variant="outlined" style={styles.errorCard}>
              <Typography variant="title3" weight="semibold" color={colors.error} style={styles.errorTitle}>
                {error || 'Schedule not found'}
              </Typography>
              <Typography variant="body" color={colors.textSecondary} style={styles.errorMessage}>
                Unable to load reminder settings. Please try again.
              </Typography>
              <Button title="Retry" onPress={loadData} variant="secondary" size="sm" />
            </Card>
          </View>
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container}>
        {renderScreenHeader(
          <TouchableOpacity onPress={handleSave} style={styles.saveButton} disabled={isSaving}>
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Typography variant="body" weight="semibold" color={colors.primary}>
                Save
              </Typography>
            )}
          </TouchableOpacity>,
          () => {
            if (!isSaving) navigation.goBack();
          }
        )}

        <ScrollView
          style={[screenScrollViewStyle.scroll, styles.scrollView]}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Upcoming Collections Calendar */}
          <View style={styles.section}>
            <TouchableOpacity
              onPress={() => setIsCalendarCollapsed(!isCalendarCollapsed)}
              style={styles.sectionHeader}
            >
              <Typography variant="callout" weight="semibold" color={colors.textPrimary} style={styles.sectionTitle}>
                UPCOMING COLLECTIONS
              </Typography>
              <Icon
                name={isCalendarCollapsed ? 'chevron-forward' : 'chevron-down'}
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {!isCalendarCollapsed && (
              <Card variant="elevated" style={styles.calendarCard}>
                <Calendar
                  markingType="multi-dot"
                  markedDates={markedDates}
                  firstDay={1}
                  theme={{
                    backgroundColor: colors.backgroundSecondary,
                    calendarBackground: colors.backgroundSecondary,
                    textSectionTitleColor: colors.textSecondary,
                    selectedDayBackgroundColor: colors.primary,
                    selectedDayTextColor: colors.white,
                    todayTextColor: colors.primary,
                    dayTextColor: colors.textPrimary,
                    textDisabledColor: colors.borderColor,
                    dotColor: colors.primary,
                    monthTextColor: colors.textPrimary,
                    textMonthFontWeight: '600',
                  }}
                />
                <View style={styles.legendContainer}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: colors.textSecondary }]} />
                    <Typography variant="caption1" color={colors.textSecondary}>Garbage</Typography>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: colors.blue }]} />
                    <Typography variant="caption1" color={colors.textSecondary}>Recycling</Typography>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
                    <Typography variant="caption1" color={colors.textSecondary}>Organics</Typography>
                  </View>
                </View>
              </Card>
            )}
          </View>

          {/* Quick Reminders */}
          <View style={styles.section}>
            <Typography variant="callout" weight="semibold" color={colors.textPrimary} style={styles.sectionTitle}>
              QUICK REMINDERS
            </Typography>

            {/* Evening Before */}
            <Card variant="outlined" style={styles.reminderCard}>
              <View style={styles.reminderHeader}>
                <View style={styles.reminderInfo}>
                  <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                    Evening Before
                  </Typography>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    Get notified the night before collection day
                  </Typography>
                </View>
                <Toggle
                  value={presetReminders.nightBefore.enabled}
                  onValueChange={(value) => {
                    if (Platform.OS === 'ios') {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }
                    setPresetReminders(prev => ({
                      ...prev,
                      nightBefore: { ...prev.nightBefore, enabled: value },
                    }));
                  }}
                  disabled={isSaving}
                />
              </View>

              {presetReminders.nightBefore.enabled && (
                <TouchableOpacity
                  onPress={() => setShowNightBeforePicker(true)}
                  style={[styles.timeButton, { backgroundColor: colors.backgroundMain }]}
                  disabled={isSaving}
                >
                  <Typography variant="subheadline" color={colors.textPrimary}>
                    {formatTime12Hour(presetReminders.nightBefore.time)}
                  </Typography>
                  <Icon name="chevron-down" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </Card>

            {/* Morning Of */}
            <Card variant="outlined" style={styles.reminderCard}>
              <View style={styles.reminderHeader}>
                <View style={styles.reminderInfo}>
                  <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                    Morning Of
                  </Typography>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    Get notified on collection day morning
                  </Typography>
                </View>
                <Toggle
                  value={presetReminders.morningOf.enabled}
                  onValueChange={(value) => {
                    if (Platform.OS === 'ios') {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }
                    setPresetReminders(prev => ({
                      ...prev,
                      morningOf: { ...prev.morningOf, enabled: value },
                    }));
                  }}
                  disabled={isSaving}
                />
              </View>

              {presetReminders.morningOf.enabled && (
                <TouchableOpacity
                  onPress={() => setShowMorningOfPicker(true)}
                  style={[styles.timeButton, { backgroundColor: colors.backgroundMain }]}
                  disabled={isSaving}
                >
                  <Typography variant="subheadline" color={colors.textPrimary}>
                    {formatTime12Hour(presetReminders.morningOf.time)}
                  </Typography>
                  <Icon name="chevron-down" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </Card>
          </View>

          {/* Custom Reminders */}
          <View style={styles.section}>
            <Typography variant="callout" weight="semibold" color={colors.textPrimary} style={styles.sectionTitle}>
              CUSTOM REMINDERS
            </Typography>

            {customReminders.length > 0 ? (
              customReminders.map((reminder) => (
                <Card key={reminder.id} variant="outlined" style={styles.reminderCard}>
                  <View style={styles.customReminderHeader}>
                    <View style={styles.customReminderInfo}>
                      <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                        {reminder.label}
                      </Typography>
                      <Typography variant="caption1" color={colors.textSecondary}>
                        {Math.abs(reminder.daysOffset)} day{Math.abs(reminder.daysOffset) !== 1 ? 's' : ''} {reminder.daysOffset < 0 ? 'before' : 'on'} collection at {formatTime12Hour(reminder.time)}
                      </Typography>
                    </View>
                    <View style={styles.customReminderActions}>
                      <Toggle
                        value={reminder.enabled}
                        onValueChange={(value) => {
                          if (Platform.OS === 'ios') {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          }
                          setCustomReminders(prev =>
                            prev.map(r => (r.id === reminder.id ? { ...r, enabled: value } : r))
                          );
                        }}
                        disabled={isSaving}
                      />
                      <TouchableOpacity
                        onPress={() => handleCustomReminderDelete(reminder.id)}
                        style={styles.deleteButton}
                        disabled={isSaving}
                      >
                        <Icon name="trash" size={18} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </Card>
              ))
            ) : (
              <Card variant="outlined" style={styles.emptyCard}>
                <Typography variant="body" color={colors.textSecondary} style={styles.emptyTextCenter}>
                  No custom reminders yet
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary} style={styles.emptySubtext}>
                  Create custom reminders for extra notifications
                </Typography>
              </Card>
            )}

            <Button
              title="Add Custom Reminder"
              onPress={() => setShowCustomModal(true)}
              variant="secondary"
              style={styles.addButton}
              disabled={isSaving}
            />
          </View>

          {/* Help tip */}
          <View style={styles.helpSection}>
            <Icon name="bulb" size={16} color={colors.textSecondary} style={styles.helpIcon} />
            <Typography variant="caption1" color={colors.textSecondary} style={styles.helpText}>
              Tip: Custom reminders are useful if you need extra time to prepare (e.g., defrost freezer scraps for organics).
            </Typography>
          </View>
        </ScrollView>

        {/* Time Pickers */}
        {showNightBeforePicker && (
          <DateTimePicker
            value={nightBeforeTime}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={handleNightBeforeTimeChange}
          />
        )}

        {showMorningOfPicker && (
          <DateTimePicker
            value={morningOfTime}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={handleMorningOfTimeChange}
          />
        )}

        {/* Custom Reminder Modal */}
        <CustomReminderModal
          visible={showCustomModal}
          onClose={() => {
            setShowCustomModal(false);
            setEditingReminder(undefined);
          }}
          onSave={handleCustomReminderSave}
          existingReminder={editingReminder}
          nextCollectionDate={nextCollectionDate}
        />
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  saveButton: {
    padding: Spacing.sm,
    width: Header.sideColumnWidth,
    alignItems: 'flex-end',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: Spacing.base,
  },
  content: {
    flex: 1,
    padding: Spacing.base,
  },
  errorCard: {
    padding: Spacing.lg,
  },
  errorTitle: {
    marginBottom: Spacing.sm,
  },
  errorMessage: {
    marginBottom: Spacing.base,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    letterSpacing: 0.5,
  },
  calendarCard: {
    padding: 0,
    overflow: 'hidden',
  },
  legendContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.base,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0, 0, 0, 0.1)',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + Spacing.xxs,
  },
  legendDot: {
    width: Spacing.sm,
    height: Spacing.sm,
    borderRadius: Spacing.xs,
  },
  reminderCard: {
    padding: Spacing.base,
    marginBottom: Spacing.md,
  },
  reminderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reminderInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  timeButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: CornerRadius.sm,
  },
  customReminderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  customReminderInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  customReminderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  deleteButton: {
    padding: Spacing.xs,
  },
  emptyCard: {
    padding: Spacing.xl,
    alignItems: 'center',
  },
  emptyTextCenter: {
    textAlign: 'center',
  },
  emptySubtext: {
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  addButton: {
    marginTop: Spacing.md,
  },
  helpSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    padding: Spacing.base,
    marginTop: Spacing.sm,
  },
  helpIcon: {
    marginTop: 1,
  },
  helpText: {
    flex: 1,
  },
});
