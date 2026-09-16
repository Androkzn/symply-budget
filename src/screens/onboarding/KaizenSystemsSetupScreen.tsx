import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { OnboardingStepScreen } from '@components/onboarding';
import { Typography } from '@components/ui';
import { useTheme } from '@contexts/ThemeContext';
import {
  AdminIcon,
  CareerSystemIcon,
  FinanceIcon,
  HealthIcon,
  LearningIcon,
  MentalIcon,
  RelationshipsIcon,
  brandIconState,
} from '@features/kaizen/brand/iconset';
import { LifeSystem, OPTIONAL_LIFE_SYSTEMS, PRIMARY_LIFE_SYSTEMS } from '@features/kaizen/constants';
import { beginSetupQueue, estimateOnboardingStepTotal } from '@features/kaizen/services/setupFlow';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import type { OnboardingStackParamList } from '@navigation/types';
import { CornerRadius, Spacing, useAppColors } from '@theme';

type NavigationProp = NativeStackNavigationProp<OnboardingStackParamList, 'KaizenSystemsSetup'>;

const LABELS: Record<LifeSystem, string> = {
  [LifeSystem.Health]: 'Health',
  [LifeSystem.Career]: 'Career',
  [LifeSystem.Mental]: 'Mental health',
  [LifeSystem.PersonalLife]: 'Personal life',
  [LifeSystem.Administration]: 'Administration',
  [LifeSystem.Learning]: 'Learning',
  [LifeSystem.Finance]: 'Finances',
};

const SYSTEM_ICONS: Record<LifeSystem, typeof HealthIcon> = {
  [LifeSystem.Health]: HealthIcon,
  [LifeSystem.Career]: CareerSystemIcon,
  [LifeSystem.Mental]: MentalIcon,
  [LifeSystem.PersonalLife]: RelationshipsIcon,
  [LifeSystem.Administration]: AdminIcon,
  [LifeSystem.Learning]: LearningIcon,
  [LifeSystem.Finance]: FinanceIcon,
};

const SYSTEMS = [...PRIMARY_LIFE_SYSTEMS, ...OPTIONAL_LIFE_SYSTEMS];

/**
 * Kaizen's required "Build your system" onboarding step. Unlike every other
 * step in this shell (deliberately skippable), picking at least one life
 * system is mandatory — Continue stays disabled at zero selected, so a
 * member always starts the app with something to work from.
 */
export function KaizenSystemsSetupScreen() {
  const colors = useAppColors();
  const { isDark } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const [selected, setSelected] = useState<LifeSystem[]>([LifeSystem.Career]);
  const beginSetupSystems = useKaizenStore((state) => state.beginSetupSystems);
  const [isSaving, setIsSaving] = useState(false);

  const toggle = (system: LifeSystem) => {
    setSelected((current) =>
      current.includes(system) ? current.filter((item) => item !== system) : [...current, system],
    );
  };

  const handleContinue = async () => {
    if (selected.length === 0) return;
    setIsSaving(true);
    try {
      await beginSetupSystems(selected);
      beginSetupQueue(selected);
      navigation.navigate('KaizenSystemConfig', { system: selected[0] });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <OnboardingStepScreen
      testID="onboarding-kaizen-systems-screen"
      title="Build your system"
      subtitle="Choose the areas you want Kaizen to organize. Next you'll configure each one."
      currentStep={2}
      totalSteps={estimateOnboardingStepTotal(selected)}
      stepLabel="Build your system"
      onBack={() => navigation.goBack()}
      onContinue={() => void handleContinue()}
      continueBusy={isSaving}
      continueDisabled={selected.length === 0}
    >
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
        <Typography variant="footnote" weight="bold" color={colors.textSecondary} style={styles.cardLabel}>
          Your life systems
        </Typography>
        <View style={styles.tiles}>
          {SYSTEMS.map((system) => {
            const isSelected = selected.includes(system);
            const Icon = SYSTEM_ICONS[system];
            return (
              <Pressable
                key={system}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                testID={`onboarding-kaizen-system-${system}`}
                style={[
                  styles.tile,
                  {
                    backgroundColor: isSelected ? `${colors.primary}1F` : colors.pillBackground,
                    borderColor: isSelected ? colors.primary : colors.borderColor,
                  },
                ]}
                onPress={() => toggle(system)}
              >
                <Icon size={24} state={brandIconState(isDark, isSelected)} />
                <Typography
                  variant="subheadline"
                  weight="semibold"
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  color={isSelected ? colors.primary : colors.textPrimary}
                  style={styles.tileLabel}
                >
                  {LABELS[system]}
                </Typography>
              </Pressable>
            );
          })}
        </View>
      </View>
    </OnboardingStepScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: CornerRadius.listItem,
    borderWidth: 1,
    padding: Spacing.base,
  },
  cardLabel: {
    letterSpacing: 0.4,
    marginBottom: Spacing.md,
    textTransform: 'uppercase',
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.smd },
  tile: {
    alignItems: 'center',
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.xs,
    minHeight: 56,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.md,
    width: '47.5%',
  },
  tileLabel: {
    flex: 1,
    flexShrink: 1,
  },
});
