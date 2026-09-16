import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { garbageCollectionApi } from '@api/garbage-collection';
import { AppBackground, SafeAreaView } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { OnboardingStepHeader } from '@components/onboarding';
import { Button, GradientButton, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import {
  houseOnboardingAiStepsIncluded,
  houseOnboardingProgress,
} from '@features/house/onboarding/aiSteps';
import { recordOnboardingStep } from '@features/house/onboarding/recordStep';
import type { OnboardingStackParamList } from '@navigation/types';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';

type GarbageSetupScreenNavigationProp = NativeStackNavigationProp<
  OnboardingStackParamList,
  'GarbageSetup'
>;

const DAYS_OF_WEEK = [
  { label: 'Monday', value: 1 },
  { label: 'Tuesday', value: 2 },
  { label: 'Wednesday', value: 3 },
  { label: 'Thursday', value: 4 },
  { label: 'Friday', value: 5 },
  { label: 'Saturday', value: 6 },
  { label: 'Sunday', value: 0 },
];

export function GarbageSetupScreen() {
  const navigation = useNavigation<GarbageSetupScreenNavigationProp>();
  const colors = useAppColors();
  const currentHousehold = useHouseholdStore(state => state.currentHousehold);
  const completeOnboarding = useAuthStore(state => state.completeOnboarding);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * The last step for a member who skipped AI — or the way into the floor plan
   * for one who did not.
   *
   * `FloorPlan` reads a drawing with a model; without AI access it is not part
   * of this member's flow at all (`aiSteps.ts`), so this screen finishes
   * onboarding itself rather than handing on to a step that would have nothing
   * to offer. The finish is the same two lines `FloorPlanScreen.handleSkip`
   * runs, including its reason for neither gating NOR waiting on the server
   * call: `hasCompletedOnboarding` is client state, and a private-mode
   * household has every reason to 403 on `/state` until an owner approves the
   * device — which on this endpoint means a full request timeout of a button
   * that looks dead. See `recordOnboardingStep`.
   */
  const advance = () => {
    if (houseOnboardingAiStepsIncluded()) {
      navigation.navigate('FloorPlan');
      return;
    }
    recordOnboardingStep('complete');
    completeOnboarding();
  };

  const handleSave = async () => {
    if (!currentHousehold) {
      Alert.alert('Error', 'Please create a home first');
      return;
    }

    if (selectedDay === null) {
      Alert.alert('Select a Day', 'Please select your garbage collection day');
      return;
    }

    try {
      setSaving(true);

      // Create garbage collection schedule
      await garbageCollectionApi.createSchedule(currentHousehold.id, {
        municipality: 'Default',
        schedules: [
          {
            type: 'garbage',
            frequency: 'weekly',
            dayOfWeek: selectedDay,
          },
        ],
      });

      // Bookkeeping, not a gate — and not something to WAIT on either: awaited
      // here it held Continue for a request timeout after the schedule had
      // already saved.
      recordOnboardingStep('garbage');

      advance();
    } catch (error) {
      console.error('Setup error:', error);
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to set up garbage schedule';
      Alert.alert('Setup Failed', message);
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    advance();
  };

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView>
        <OnboardingStepHeader
          testID="onboarding-garbage-setup"
          {...houseOnboardingProgress('GarbageSetup')}
          stepLabel="Garbage Schedule"
          onBack={() => navigation.goBack()}
          /*
            No forward chevron on the short path, where this screen is the
            LAST one: `advance()` finishes onboarding outright there, and a
            header chevron that drops the member into the app is not a "next
            step" — it is the end of the wizard wearing a stepper's clothes.
            "Skip for Now" below says so in words; the chevron cannot.
          */
          onForward={
            houseOnboardingAiStepsIncluded()
              ? () => navigation.navigate('FloorPlan')
              : undefined
          }
          forwardDisabled={saving}
        />
        {/* Caps the column at reading width and centres it, so the day tiles
            stay tap-sized on iPad instead of stretching to ~390pt pills.
            Same wrapper `CreateHouseholdScreen` (step 1) uses. */}
        <AdaptiveContainer width="reading" padding={0}>
          <ScrollView
            style={styles.container}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.header}>
              <Typography
                variant="largeTitle"
                weight="bold"
                align="center"
                color={colors.textPrimary}
              >
                Set Up Garbage Collection
              </Typography>
              <Typography
                variant="body"
                color={colors.textSecondary}
                align="center"
                style={styles.subtitle}
              >
                Never miss garbage day! Get reminders before collection
              </Typography>
            </View>

            <View style={styles.section}>
              <Typography
                variant="headline"
                weight="semibold"
                color={colors.textPrimary}
                style={styles.sectionTitle}
              >
                Select Collection Day
              </Typography>
              <View style={styles.dayGrid}>
                {DAYS_OF_WEEK.map(day => (
                  <DayButton
                    key={day.value}
                    label={day.label}
                    selected={selectedDay === day.value}
                    onPress={() => setSelectedDay(day.value)}
                  />
                ))}
              </View>
            </View>

            <View
              style={[
                styles.features,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.borderColor,
                },
              ]}
            >
              <FeatureItem
                icon="notifications"
                text="Reminder notifications the night before"
              />
              <FeatureItem
                icon="calendar"
                text="Automatic weekly schedule tracking"
              />
              <FeatureItem
                icon="sync-circle"
                text="Separate recycling schedules"
              />
            </View>

            <View style={styles.actions}>
              <GradientButton
                title={saving ? 'Saving...' : 'Continue'}
                variant="teal"
                onPress={handleSave}
                disabled={saving || selectedDay === null}
                fullWidth
              />
              <Button
                title="Skip for Now"
                variant="ghost"
                onPress={handleSkip}
                disabled={saving}
                fullWidth
              />
            </View>

            <View style={styles.note}>
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                align="center"
              >
                You can customize your schedule later in Settings
              </Typography>
            </View>
          </ScrollView>
        </AdaptiveContainer>
      </SafeAreaView>
    </AppBackground>
  );
}

function DayButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useAppColors();
  return (
    <Button
      title={label}
      variant={selected ? 'primary' : 'secondary'}
      onPress={onPress}
      style={[
        styles.dayButton,
        selected && { backgroundColor: colors.primaryDark },
      ]}
      textColor={selected ? colors.white : colors.textSecondary}
    />
  );
}

function FeatureItem({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.featureItem}>
      <Icon name={icon} size={20} color={colors.primary} />
      <Typography
        variant="body"
        color={colors.textSecondary}
        style={styles.featureItemText}
      >
        {text}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  header: {
    marginTop: 32,
    marginBottom: 32,
  },
  subtitle: {
    marginTop: 16,
    lineHeight: 22,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    marginBottom: 16,
  },
  dayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
    // Wrapped lines must NOT share out the height the ScrollView offers them:
    // with the default (stretch) each of the four lines took a quarter of the
    // available viewport, blowing every day up to ~125pt tall while the grid
    // itself still measured as four 44pt rows — so the tiles overflowed and
    // the features card and buttons painted straight over them.
    alignContent: 'flex-start',
  },
  dayButton: {
    // A definite width, not `flex: 1` + `minWidth: '45%'`: a flexBasis of 0 in
    // a wrapping row leaves the line sizing to the parent, which is what let
    // the tiles stretch. Matches the day/type grids in ScheduleSetupScreen.
    width: '48%',
    alignSelf: 'flex-start',
  },
  features: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 32,
    gap: 16,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featureItemText: {
    flex: 1,
  },
  actions: {
    gap: 12,
  },
  note: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
});
