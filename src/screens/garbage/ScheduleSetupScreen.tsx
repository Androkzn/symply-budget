import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { garbageCollectionApi } from '@api/garbage-collection';
import type { GarbageScheduleType } from '@api/garbage-collection';
import { Typography, Button } from '@components/ui';
import { BottomSheet } from '@components/ui/BottomSheet';
import { Icon } from '@components/ui/Icon';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors, type AppColors } from '@theme';

/** Optional pre-fill (e.g. from AI detection) for the wizard's initial values. */
export interface ScheduleSetupInitial {
  types?: Array<'garbage' | 'recycling' | 'organics' | 'yardWaste' | 'bulkItem'>;
  frequency?: 'weekly' | 'biweekly' | 'monthly';
  dayOfWeek?: number;
  weekOfMonth?: number[];
  /** Jump straight to the day-of-week step (AI partial-detect flow). When
   *  false/unset (e.g. editing an existing schedule), start at step 1. */
  jumpToDay?: boolean;
}

interface ScheduleSetupScreenProps {
  visible: boolean;
  onClose: () => void;
  onComplete: () => void;
  municipality?: string;
  initial?: ScheduleSetupInitial;
}

type CollectionTypeValue = 'garbage' | 'recycling' | 'organics' | 'yardWaste' | 'bulkItem';

const getCollectionTypes = (colors: AppColors) => [
  { value: 'garbage' as const, label: 'Garbage', icon: 'trash-outline', color: colors.textSecondary },
  { value: 'recycling' as const, label: 'Recycling', icon: 'repeat-outline', color: colors.accent },
  { value: 'organics' as const, label: 'Organics', icon: 'leaf-outline', color: colors.success },
  { value: 'yardWaste' as const, label: 'Yard Waste', icon: 'flower-outline', color: colors.warning },
  { value: 'bulkItem' as const, label: 'Bulky Items', icon: 'cube-outline', color: colors.info },
];

const FREQUENCY_OPTIONS = [
  { value: 'weekly' as const, label: 'Weekly', description: 'Every week' },
  { value: 'biweekly' as const, label: 'Biweekly', description: 'Every other week' },
  { value: 'monthly' as const, label: 'Monthly', description: 'Specific weeks each month' },
];

const WEEK_OF_MONTH_OPTIONS = [
  { value: [1], label: '1st week only', description: 'First week of each month' },
  { value: [2], label: '2nd week only', description: 'Second week of each month' },
  { value: [3], label: '3rd week only', description: 'Third week of each month' },
  { value: [4], label: '4th week only', description: 'Fourth week of each month' },
  { value: [1, 3], label: '1st and 3rd weeks', description: 'First and third weeks' },
  { value: [2, 4], label: '2nd and 4th weeks', description: 'Second and fourth weeks' },
];

const DAY_OF_WEEK_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export function ScheduleSetupScreen({
  visible,
  onClose,
  onComplete,
  municipality,
  initial,
}: ScheduleSetupScreenProps) {  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();
  const collectionTypes = getCollectionTypes(colors);

  // Wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedTypes, setSelectedTypes] = useState<Set<CollectionTypeValue>>(new Set());
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly');
  const [weekOfMonth, setWeekOfMonth] = useState<number[]>([1, 3]);
  const [dayOfWeek, setDayOfWeek] = useState<number>(2); // Tuesday default
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the wizard from AI-detected values when it opens. We pre-fill the
  // streams + frequency we found and drop the user on the day-of-week step,
  // since the missing day is the whole reason we fall back to manual here.
  useEffect(() => {
    if (!visible || !initial) return;
    if (initial.types && initial.types.length > 0) {
      setSelectedTypes(new Set(initial.types));
    }
    if (initial.frequency) setFrequency(initial.frequency);
    if (initial.weekOfMonth && initial.weekOfMonth.length > 0) {
      setWeekOfMonth(initial.weekOfMonth);
    }
    if (initial.dayOfWeek !== undefined) setDayOfWeek(initial.dayOfWeek);
    // Jump straight to the day-of-week step (4) since types/frequency are known.
    setCurrentStep(4);
  }, [visible, initial]);

  // Calculate total steps
  const totalSteps = frequency === 'monthly' ? 5 : 4;

  // Progress percentage
  const progress = (currentStep / totalSteps) * 100;

  // Toggle collection type
  const toggleType = (type: CollectionTypeValue) => {
    const newTypes = new Set(selectedTypes);
    if (newTypes.has(type)) {
      newTypes.delete(type);
    } else {
      newTypes.add(type);
    }
    setSelectedTypes(newTypes);
  };

  // Navigation handlers
  const handleNext = () => {
    if (currentStep === 1 && selectedTypes.size === 0) {
      setError('Please select at least one collection type');
      return;
    }
    setError(null);

    // Skip week of month step if not monthly
    if (currentStep === 2 && frequency !== 'monthly') {
      setCurrentStep(4); // Skip to day of week
    } else {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    // Skip week of month step if going back and not monthly
    if (currentStep === 4 && frequency !== 'monthly') {
      setCurrentStep(2);
    } else {
      setCurrentStep(currentStep - 1);
    }
  };

  // Format schedule description
  const formatScheduleDescription = (): string => {
    const dayName = DAY_OF_WEEK_OPTIONS.find(d => d.value === dayOfWeek)?.label || 'Unknown';

    if (frequency === 'weekly') {
      return `Every ${dayName}`;
    } else if (frequency === 'biweekly') {
      return `Every other ${dayName}`;
    } else if (frequency === 'monthly') {
      const ordinals = ['', '1st', '2nd', '3rd', '4th', '5th'];
      const weeks = weekOfMonth.map(w => ordinals[w] || `${w}th`).join(' and ');
      return `${weeks} ${dayName} of each month`;
    }
    return frequency;
  };

  // Handle save
  const handleSave = async () => {
    if (!currentHousehold) {
      setError('No property selected');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Build schedules array
      const schedules: GarbageScheduleType[] = Array.from(selectedTypes).map(type => ({
        type,
        frequency,
        dayOfWeek,
        ...(frequency === 'monthly' && { weekOfMonth }),
      }));
      console.log('[GARBAGE] ScheduleSetup.handleSave: saving', schedules.length, 'items', JSON.stringify(schedules));

      // Create schedule
      await garbageCollectionApi.createSchedule(currentHousehold.id, {
        municipality: municipality || currentHousehold.city || 'Unknown',
        schedules,
        reminders: {
          nightBefore: { enabled: true, time: '19:00' },
          morningOf: { enabled: false, time: '07:00' },
        },
      });

      onComplete();
      handleReset();
    } catch (err: any) {
      console.error('Failed to save schedule:', err);
      setError(err.response?.data?.message || 'Failed to save schedule');
    } finally {
      setIsLoading(false);
    }
  };

  // Reset wizard
  const handleReset = () => {
    setCurrentStep(1);
    setSelectedTypes(new Set());
    setFrequency('weekly');
    setWeekOfMonth([1, 3]);
    setDayOfWeek(2);
    setError(null);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  // Render step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <View style={styles.stepContent}>
            <Typography variant="title3" weight="semibold" color={colors.textPrimary} style={styles.stepTitle}>
              Select Collection Types
            </Typography>
            <Typography variant="body" color={colors.textSecondary} style={styles.stepDescription}>
              Choose which types of waste collection you have
            </Typography>

            <View style={styles.typeGrid}>
              {collectionTypes.map(type => {
                const isSelected = selectedTypes.has(type.value);
                return (
                  <TouchableOpacity
                    key={type.value}
                    activeOpacity={0.8}
                    onPress={() => toggleType(type.value)}
                    style={[
                      styles.typeTile,
                      {
                        backgroundColor: isSelected ? `${type.color}14` : colors.backgroundMain,
                        borderColor: isSelected ? type.color : colors.borderColor,
                        borderWidth: isSelected ? 2 : 1,
                      },
                    ]}
                  >
                    {isSelected && (
                      <View style={[styles.tileCheck, { backgroundColor: type.color }]}>
                        <Icon name="checkmark" size={13} color={colors.white} />
                      </View>
                    )}
                    <View style={[styles.tileIcon, { backgroundColor: `${type.color}20` }]}>
                      <Icon name={type.icon as any} size={22} color={type.color} />
                    </View>
                    <Typography
                      variant="subheadline"
                      weight={isSelected ? 'semibold' : 'medium'}
                      color={colors.textPrimary}
                      numberOfLines={1}
                      style={styles.tileLabel}
                    >
                      {type.label}
                    </Typography>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );

      case 2:
        return (
          <View style={styles.stepContent}>
            <Typography variant="title3" weight="semibold" color={colors.textPrimary} style={styles.stepTitle}>
              Choose Frequency
            </Typography>
            <Typography variant="body" color={colors.textSecondary} style={styles.stepDescription}>
              How often is your collection?
            </Typography>

            <View style={styles.optionsContainer}>
              {FREQUENCY_OPTIONS.map(option => {
                const isSelected = frequency === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => setFrequency(option.value)}
                    style={[
                      styles.frequencyCard,
                      {
                        backgroundColor: isSelected ? colors.primary + '15' : colors.backgroundMain,
                        borderColor: isSelected ? colors.primary : colors.borderColor,
                        borderWidth: isSelected ? 2 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.radioOuter, { borderColor: colors.borderColor }]}>
                      {isSelected && <View style={[styles.radioInner, { backgroundColor: colors.primary }]} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Typography
                        variant="headline"
                        weight={isSelected ? 'semibold' : 'regular'}
                        color={colors.textPrimary}
                      >
                        {option.label}
                      </Typography>
                      <Typography variant="footnote" color={colors.textSecondary} style={{ marginTop: 2 }}>
                        {option.description}
                      </Typography>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );

      case 3:
        return (
          <View style={styles.stepContent}>
            <Typography variant="title3" weight="semibold" color={colors.textPrimary} style={styles.stepTitle}>
              Week of Month
            </Typography>
            <Typography variant="body" color={colors.textSecondary} style={styles.stepDescription}>
              Which weeks of the month?
            </Typography>

            <View style={styles.optionsContainer}>
              {WEEK_OF_MONTH_OPTIONS.map(option => {
                const isSelected = JSON.stringify(weekOfMonth) === JSON.stringify(option.value);
                return (
                  <TouchableOpacity
                    key={option.label}
                    onPress={() => setWeekOfMonth(option.value)}
                    style={[
                      styles.frequencyCard,
                      {
                        backgroundColor: isSelected ? colors.primary + '15' : colors.backgroundMain,
                        borderColor: isSelected ? colors.primary : colors.borderColor,
                        borderWidth: isSelected ? 2 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.radioOuter, { borderColor: colors.borderColor }]}>
                      {isSelected && <View style={[styles.radioInner, { backgroundColor: colors.primary }]} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Typography
                        variant="headline"
                        weight={isSelected ? 'semibold' : 'regular'}
                        color={colors.textPrimary}
                      >
                        {option.label}
                      </Typography>
                      <Typography variant="footnote" color={colors.textSecondary} style={{ marginTop: 2 }}>
                        {option.description}
                      </Typography>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );

      case 4:
        return (
          <View style={styles.stepContent}>
            <Typography variant="title3" weight="semibold" color={colors.textPrimary} style={styles.stepTitle}>
              Collection Day
            </Typography>
            <Typography variant="body" color={colors.textSecondary} style={styles.stepDescription}>
              What day of the week?
            </Typography>

            <View style={styles.optionsContainer}>
              {DAY_OF_WEEK_OPTIONS.map(option => {
                const isSelected = dayOfWeek === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => setDayOfWeek(option.value)}
                    style={[
                      styles.dayCard,
                      {
                        backgroundColor: isSelected ? colors.primary : colors.backgroundMain,
                        borderColor: isSelected ? colors.primary : colors.borderColor,
                      },
                    ]}
                  >
                    <Typography
                      variant="headline"
                      weight={isSelected ? 'semibold' : 'regular'}
                      color={isSelected ? colors.white : colors.textPrimary}
                    >
                      {option.label}
                    </Typography>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );

      case 5:
        return (
          <View style={styles.stepContent}>
            <Typography variant="title3" weight="semibold" color={colors.textPrimary} style={styles.stepTitle}>
              Review Your Schedule
            </Typography>
            <Typography variant="body" color={colors.textSecondary} style={styles.stepDescription}>
              Confirm your collection schedule
            </Typography>

            <View style={styles.summaryContainer}>
              {Array.from(selectedTypes).map(type => {
                const typeInfo = collectionTypes.find(t => t.value === type);
                if (!typeInfo) return null;

                return (
                  <View
                    key={type}
                    style={[
                      styles.summaryCard,
                      {
                        backgroundColor: colors.backgroundMain,
                        borderLeftColor: typeInfo.color,
                      },
                    ]}
                  >
                    <View style={styles.summaryHeader}>
                      <View style={[styles.summaryIcon, { backgroundColor: `${typeInfo.color}20` }]}>
                        <Icon name={typeInfo.icon as any} size={20} color={typeInfo.color} />
                      </View>
                      <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                        {typeInfo.label}
                      </Typography>
                    </View>
                    <Typography variant="subheadline" color={colors.textSecondary} style={{ marginTop: 8 }}>
                      {formatScheduleDescription()}
                    </Typography>
                  </View>
                );
              })}
            </View>

            <View style={[styles.infoCard, { backgroundColor: colors.primary + '10' }]}>
              <Icon name="information-circle-outline" size={20} color={colors.primary} />
              <Typography variant="footnote" color={colors.textPrimary} style={{ marginLeft: 8, flex: 1 }}>
                You can customize reminder times after setup
              </Typography>
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      height="full"
      showHandle={false}
      title="Schedule Setup"
      showCloseButton
    >
      {/* No top inset here any more: the sheet's own header sits above this and
          already clears the status bar. */}
      <View style={styles.container}>
        {/* Progress Bar */}
        <View style={[styles.progressContainer, { backgroundColor: colors.borderColor }]}>
          <View
            style={[
              styles.progressBar,
              { backgroundColor: colors.primary, width: `${progress}%` },
            ]}
          />
        </View>

        {/* Step Indicator */}
        <View style={styles.stepIndicator}>
          <Typography variant="caption1" weight="semibold" color={colors.primary}>
            STEP {currentStep} OF {totalSteps}
          </Typography>
        </View>

        {/* Content */}
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {renderStepContent()}

          {error && (
            <View style={[styles.errorCard, { backgroundColor: colors.error + '15' }]}>
              <Icon name="alert-circle-outline" size={20} color={colors.error} />
              <Typography variant="footnote" color={colors.error} style={{ marginLeft: 8, flex: 1 }}>
                {error}
              </Typography>
            </View>
          )}
        </ScrollView>

        {/* Footer */}
        <View style={[styles.footer, { borderTopColor: colors.borderColor, paddingBottom: insets.bottom }]}>
          <View style={styles.footerButtons}>
            {currentStep > 1 && (
              <Button
                title="Back"
                onPress={handleBack}
                variant="ghost"
                style={styles.footerButton}
                disabled={isLoading}
              />
            )}
            {currentStep < totalSteps ? (
              <Button
                title="Next"
                onPress={handleNext}
                variant="primary"
                style={[styles.footerButton, currentStep === 1 && { flex: 1 }]}
              />
            ) : (
              <Button
                title="Complete Setup"
                onPress={handleSave}
                variant="primary"
                style={styles.footerButton}
                loading={isLoading}
                disabled={isLoading}
              />
            )}
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  progressContainer: {
    height: 4,
  },
  progressBar: {
    height: '100%',
    borderRadius: 2,
  },
  stepIndicator: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    marginBottom: 8,
  },
  stepDescription: {
    marginBottom: 24,
  },
  optionsContainer: {
    gap: 12,
  },
  typeCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  typeTile: {
    width: '48%',
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 16,
    alignItems: 'flex-start',
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    marginTop: 10,
  },
  tileCheck: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  typeIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frequencyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dayCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  summaryContainer: {
    gap: 12,
    marginBottom: 16,
  },
  summaryCard: {
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  summaryIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  footerButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  footerButton: {
    flex: 1,
  },
});
