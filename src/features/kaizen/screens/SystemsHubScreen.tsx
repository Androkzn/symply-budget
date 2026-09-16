import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
import { LifeSystem } from '@features/kaizen/constants';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { Spacing, Typography } from '@features/kaizen/theme/designTokens';

import { EmptyState, KaizenScreen, Section, kaizenStyles, parseSystems } from './common';

const SYSTEM_ICONS: Record<string, typeof HealthIcon> = {
  [LifeSystem.Health]: HealthIcon,
  [LifeSystem.Career]: CareerSystemIcon,
  [LifeSystem.Mental]: MentalIcon,
  [LifeSystem.PersonalLife]: RelationshipsIcon,
  [LifeSystem.Administration]: AdminIcon,
  [LifeSystem.Learning]: LearningIcon,
  [LifeSystem.Finance]: FinanceIcon,
};

export function SystemsHubScreen() {
  const colors = useAppColors();
  const { isDark } = useTheme();
  const c = useAppColors();
  const profile = useKaizenStore(state => state.profile);
  const setSystemActivation = useKaizenStore(state => state.setSystemActivation);
  const systems = parseSystems(profile?.enabled_systems ?? null);
  let activationStates: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(profile?.system_activation_states ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) activationStates = parsed as Record<string, string>;
  } catch {
    activationStates = {};
  }
  return (
    <KaizenScreen variant="root" title="Systems" subtitle="The areas of life you have chosen to support." screenTestId="kaizen-systems-screen">
      <Section title="Enabled">
        {systems.length === 0 ? (
          <EmptyState>Choose systems during onboarding to begin.</EmptyState>
        ) : (
          systems.map(system => {
            const isEnabled = (activationStates[system] ?? 'enabled') === 'enabled';
            const Icon = SYSTEM_ICONS[system] ?? CareerSystemIcon;
            return (
              <View
                key={system}
                style={[kaizenStyles.row, { borderBottomColor: colors.borderColor }]}
              >
                <Pressable
                  testID={`kaizen-system-row-${system}`}
                  style={styles.rowMain}
                  onPress={() =>
                    router.push({ pathname: '/kaizen/system-detail', params: { system } })
                  }
                >
                  <Icon size={24} state={brandIconState(isDark, isEnabled)} />
                  <Text
                    style={[
                      kaizenStyles.rowText,
                      { color: colors.textPrimary, textTransform: 'capitalize' },
                    ]}
                  >
                    {system.replace(/([A-Z])/g, ' $1')}
                  </Text>
                </Pressable>
                <Pressable
                  testID={`kaizen-system-pause-${system}`}
                  style={[
                    styles.activation,
                    { backgroundColor: isEnabled ? c.surfaceSelected : c.pillBackground },
                  ]}
                  onPress={() => void setSystemActivation(system, isEnabled ? 'paused' : 'enabled')}
                >
                  <Text
                    style={[
                      styles.activationText,
                      { color: isEnabled ? colors.primary : colors.textSecondary },
                    ]}
                  >
                    {isEnabled ? 'Pause' : 'Enable'}
                  </Text>
                </Pressable>
                <Text style={{ color: colors.textTertiary }}>›</Text>
              </View>
            );
          })
        )}
      </Section>
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  rowMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  activation: {
    borderRadius: 999,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + Spacing.xxs,
  },
  activationText: { fontSize: Typography.caption.size, fontWeight: '700' },
});
