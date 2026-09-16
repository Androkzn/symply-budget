import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@contexts/ThemeContext';
import { BrandButton, GlassCard } from '@features/kaizen/brand';
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
import { beginSetupQueue } from '@features/kaizen/services/setupFlow';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { Spacing, Typography } from '@features/kaizen/theme/designTokens';

import { KaizenScreen } from './common';

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

export function OnboardingScreen() {
  const colors = useAppColors();
  const c = colors;
  const { isDark } = useTheme();
  const [selected, setSelected] = useState<LifeSystem[]>([LifeSystem.Career]);
  const beginSetupSystems = useKaizenStore(state => state.beginSetupSystems);
  const [isSaving, setIsSaving] = useState(false);
  const systems = [...PRIMARY_LIFE_SYSTEMS, ...OPTIONAL_LIFE_SYSTEMS];

  const toggle = (system: LifeSystem) => {
    setSelected(current =>
      current.includes(system) ? current.filter(item => item !== system) : [...current, system],
    );
  };

  const continueOnboarding = async () => {
    setIsSaving(true);
    try {
      await beginSetupSystems(selected);
      beginSetupQueue(selected);
      const first = selected[0];
      if (first) {
        router.replace({
          pathname: '/kaizen/system-config',
          params: { system: first, setup: '1' },
        });
      } else {
        router.replace('/kaizen-systems');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <KaizenScreen
      title="Build your system"
      subtitle="Choose the areas you want Kaizen to organize. Next you'll configure each system."
      showHeaderActions={false}
    >
      <GlassCard padding={16} radius={24}>
        <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>Your life systems</Text>
        <View style={styles.tiles}>
          {systems.map(system => {
            const isSelected = selected.includes(system);
            const Icon = SYSTEM_ICONS[system];
            return (
              <Pressable
                key={system}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                style={[
                  styles.tile,
                  {
                    backgroundColor: isSelected ? c.surfaceSelected : c.pillBackground,
                    borderColor: isSelected ? colors.primary : c.glassBorder,
                  },
                ]}
                onPress={() => toggle(system)}
              >
                <Icon size={24} state={brandIconState(isDark, isSelected)} />
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={[
                    styles.tileLabel,
                    { color: isSelected ? colors.primary : colors.textPrimary },
                  ]}
                >
                  {LABELS[system]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </GlassCard>

      <View style={styles.continue}>
        <BrandButton title="Continue" loading={isSaving} onPress={() => void continueOnboarding()} />
      </View>
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  cardLabel: {
    fontSize: Typography.caption.size,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: Spacing.md,
    textTransform: 'uppercase',
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.smd },
  tile: {
    alignItems: 'center',
    borderRadius: 18,
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
    fontSize: Typography.label.size,
    fontWeight: '600',
    lineHeight: Typography.label.lineHeight,
  },
  continue: { marginTop: Spacing.xl },
});
