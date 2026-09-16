import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@contexts/ThemeContext';
import { BrandButton } from '@features/kaizen/brand';
import {
  AdminIcon,
  CareerSystemIcon,
  FinanceIcon,
  FocusIcon,
  HealthIcon,
  LearningIcon,
  MentalIcon,
  RelationshipsIcon,
  brandIconState,
} from '@features/kaizen/brand/iconset';
import { LifeSystem } from '@features/kaizen/constants';
import { selectDailyCoreForSystem } from '@features/kaizen/stores/kaizenSelectors';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { Spacing, Typography } from '@features/kaizen/theme/designTokens';
import type { KaizenImportPurpose } from '@features/kaizen/upload/importHandlers';
import { KaizenImportUploadSection } from '@features/kaizen/upload/KaizenImportUploadSection';

import { EmptyState, KaizenScreen, Section, kaizenStyles } from './common';

const SYSTEM_ICONS: Record<string, typeof HealthIcon> = {
  [LifeSystem.Health]: HealthIcon,
  [LifeSystem.Career]: CareerSystemIcon,
  [LifeSystem.Mental]: MentalIcon,
  [LifeSystem.PersonalLife]: RelationshipsIcon,
  [LifeSystem.Administration]: AdminIcon,
  [LifeSystem.Learning]: LearningIcon,
  [LifeSystem.Finance]: FinanceIcon,
};

function systemImportPurpose(system: string): KaizenImportPurpose {
  if (system === LifeSystem.Career) return 'auto';
  if (system === LifeSystem.Learning) return 'book';
  return 'knowledge';
}

export function SystemDetailScreen() {
  const colors = useAppColors();
  const { isDark } = useTheme();
  const c = useAppColors();
  const { system: rawSystem = 'career' } = useLocalSearchParams<{ system?: string | string[] }>();
  const system = Array.isArray(rawSystem) ? rawSystem[0] ?? 'career' : rawSystem;
  const dailyCoreAll = useKaizenStore(state => state.dailyCore);
  const dailyCore = selectDailyCoreForSystem(dailyCoreAll, system);
  const setSystemActivation = useKaizenStore(state => state.setSystemActivation);
  const hydrate = useKaizenStore(state => state.hydrate);
  const profile = useKaizenStore(state => state.profile);

  useEffect(() => {
    if (!profile) {
      void hydrate();
    }
  }, [hydrate, profile]);
  let status = 'enabled';
  try {
    status = (JSON.parse(profile?.system_activation_states ?? '{}') as Record<string, string>)[system] ?? status;
  } catch {
    /* default */
  }
  const isEnabled = status === 'enabled';
  const pauseLabel = isEnabled ? 'Pause system' : 'Enable system';
  const label = system.replace(/([A-Z])/g, ' $1').replace(/^./, ch => ch.toUpperCase()).trim();
  const SystemIcon = SYSTEM_ICONS[system] ?? CareerSystemIcon;

  return (
    <KaizenScreen title={label} subtitle="Keep the smallest set of actions that supports this area.">
      <View style={[styles.systemHeader, { backgroundColor: c.surfaceSelected, borderColor: c.glassBorder }]}>
        <SystemIcon size={26} state={brandIconState(isDark, true)} />
        <Text style={[styles.systemHeaderLabel, { color: colors.textPrimary }]}>{label}</Text>
        <View
          style={[styles.statusPill, { backgroundColor: isEnabled ? c.surfaceSelected : c.pillBackground }]}
          testID="kaizen-system-status-pill"
          accessibilityLabel={isEnabled ? 'Active' : 'Paused'}
        >
          <Text style={[styles.statusText, { color: isEnabled ? colors.primary : colors.textSecondary }]}>
            {isEnabled ? 'Active' : 'Paused'}
          </Text>
        </View>
      </View>

      <Section title="Daily actions" testID="kaizen-section-daily-actions">
        {dailyCore.length ? (
          dailyCore.map(action => (
            <View key={action.id} style={[kaizenStyles.row, { borderBottomColor: colors.borderColor }]}>
              <FocusIcon size={22} state={brandIconState(isDark, true)} />
              <View style={kaizenStyles.rowText}>
                <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{action.title}</Text>
                <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                  {action.output_description}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <EmptyState>No actions yet. Configure this system to begin.</EmptyState>
        )}
      </Section>

      <View style={styles.actions}>
        <BrandButton
          title="Configure tasks"
          testID="kaizen-system-configure-tasks"
          onPress={() => router.push({ pathname: '/kaizen/system-config', params: { system } })}
        />
        <Pressable
          testID="kaizen-system-pause-toggle"
          accessibilityRole="button"
          accessibilityLabel={pauseLabel}
          style={[styles.pausePill, { backgroundColor: isEnabled ? c.surfaceSelected : c.pillBackground }]}
          onPress={() => {
            const activationState = isEnabled ? 'paused' : 'enabled';
            useKaizenStore.setState(state => {
              const current = state.profile;
              if (!current) return;
              let states: Record<string, string> = {};
              try {
                states = JSON.parse(current.system_activation_states ?? '{}') as Record<string, string>;
              } catch {
                /* reset invalid legacy state */
              }
              state.profile = {
                ...current,
                system_activation_states: JSON.stringify({ ...states, [system]: activationState }),
                updated_at: new Date().toISOString(),
              };
            });
            void setSystemActivation(system, activationState);
          }}
        >
          <Text
            style={[
              styles.pausePillText,
              { color: isEnabled ? colors.primary : colors.textSecondary },
            ]}
          >
            {pauseLabel}
          </Text>
        </Pressable>
      </View>

      <Section title="Files & imports" testID="kaizen-section-files-imports">
        <KaizenImportUploadSection
          purpose={systemImportPurpose(system)}
          showQuickLinks={system === LifeSystem.Career}
        />
      </Section>

      <Pressable
        testID="kaizen-system-back"
        style={styles.backLink}
        onPress={() => router.push('/kaizen-systems')}
      >
        <Text style={{ color: colors.primary, fontWeight: '700' }}>Back to systems →</Text>
      </Pressable>
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  systemHeader: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.smd,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
  },
  systemHeaderLabel: {
    flex: 1,
    fontSize: Typography.bodyMedium.size,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + Spacing.xxs,
  },
  statusText: { fontSize: Typography.caption.size, fontWeight: '700' },
  actions: { gap: Spacing.md, marginTop: Spacing.xl },
  pausePill: {
    alignSelf: 'stretch',
    borderRadius: 999,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  pausePillText: { fontSize: Typography.bodyMedium.size, fontWeight: '700', textAlign: 'center' },
  backLink: { marginTop: Spacing.lg },
});
