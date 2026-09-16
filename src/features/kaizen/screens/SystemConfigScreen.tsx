import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@components/ui';
import { useTheme } from '@contexts/ThemeContext';
import { BrandButton } from '@features/kaizen/brand';
import {
  AddIcon,
  AdminIcon,
  CareerSystemIcon,
  CompleteIcon,
  FinanceIcon,
  HealthIcon,
  LearningIcon,
  MentalIcon,
  RelationshipsIcon,
  brandIconState,
} from '@features/kaizen/brand/iconset';
import { LifeSystem } from '@features/kaizen/constants';
import { markSystemConfigured } from '@features/kaizen/services/setupFlow';
import { SYSTEM_TASK_CATALOG } from '@features/kaizen/services/taskCatalog';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { Spacing, Typography } from '@features/kaizen/theme/designTokens';

import { KaizenScreen, Section, kaizenStyles } from './common';

const SYSTEM_ICONS: Record<string, typeof HealthIcon> = {
  [LifeSystem.Health]: HealthIcon,
  [LifeSystem.Career]: CareerSystemIcon,
  [LifeSystem.Mental]: MentalIcon,
  [LifeSystem.PersonalLife]: RelationshipsIcon,
  [LifeSystem.Administration]: AdminIcon,
  [LifeSystem.Learning]: LearningIcon,
  [LifeSystem.Finance]: FinanceIcon,
};

export function SystemConfigScreen() {
  const colors = useAppColors();
  const { isDark } = useTheme();
  const c = useAppColors();
  const { system: rawSystem, setup } = useLocalSearchParams<{ system?: string; setup?: string }>();
  const isSetupFlow = setup === '1';
  const system = (Object.values(LifeSystem).includes(rawSystem as LifeSystem)
    ? rawSystem
    : LifeSystem.Career) as LifeSystem;
  const templates = useMemo(() => SYSTEM_TASK_CATALOG[system].flatMap(area => area.tasks), [system]);
  const [selected, setSelected] = useState(() =>
    templates.filter(task => task.suggestedDailyCore).map(task => task.id),
  );
  const [customTitle, setCustomTitle] = useState('');
  const [customOutput, setCustomOutput] = useState('');
  const [customTasks, setCustomTasks] = useState<
    Array<{
      title: string;
      outputDescription: string;
      suggestedDailyCore: boolean;
      timeOfDay?: string;
      reminderAnchor?: string;
    }>
  >([]);
  const materializeSystemTasks = useKaizenStore(state => state.materializeSystemTasks);
  const finishOnboarding = useKaizenStore(state => state.finishOnboarding);
  const [saving, setSaving] = useState(false);

  const addCustom = () => {
    const title = customTitle.trim();
    if (!title) return;
    setCustomTasks(current => [
      ...current,
      {
        title,
        outputDescription: customOutput.trim() || title,
        suggestedDailyCore: true,
        timeOfDay: 'anytime',
        reminderAnchor: 'timeOfDay',
      },
    ]);
    setCustomTitle('');
    setCustomOutput('');
  };

  const advanceAfterSave = async () => {
    if (!isSetupFlow) {
      router.replace({ pathname: '/kaizen/system-detail', params: { system } });
      return;
    }
    const result = markSystemConfigured(system);
    if (result.kind === 'next-system') {
      router.replace({
        pathname: '/kaizen/system-config',
        params: { system: result.system, setup: '1' },
      });
      return;
    }
    if (result.kind === 'career-setup') {
      router.replace('/kaizen/career-setup?setup=1');
      return;
    }
    await finishOnboarding();
    router.replace('/');
  };

  const save = async () => {
    setSaving(true);
    try {
      await materializeSystemTasks(system, selected, customTasks);
      await advanceAfterSave();
    } finally {
      setSaving(false);
    }
  };

  const systemLabel = system.replace(/([A-Z])/g, ' $1').replace(/^./, ch => ch.toUpperCase()).trim();
  /* istanbul ignore next -- SYSTEM_ICONS maps every LifeSystem value and `system` is normalized to a valid one, so the CareerSystemIcon fallback is unreachable */
  const SystemIcon = SYSTEM_ICONS[system] ?? CareerSystemIcon;

  return (
    <KaizenScreen
      title={`Configure ${systemLabel}`}
      subtitle={
        isSetupFlow
          ? 'Choose catalog actions or add your own. You will configure each selected system.'
          : 'Choose catalog actions or add your own.'
      }
      showHeaderActions={!isSetupFlow}
    >
      <View style={[styles.systemHeader, { backgroundColor: c.surfaceSelected, borderColor: c.glassBorder }]}>
        <SystemIcon size={26} state={brandIconState(isDark, true)} />
        <Text style={[styles.systemHeaderLabel, { color: colors.textPrimary }]}>{systemLabel}</Text>
      </View>

      {SYSTEM_TASK_CATALOG[system].map(area => (
        <Section key={area.id} title={area.title}>
          {area.tasks.map(task => {
            const checked = selected.includes(task.id);
            return (
              <Pressable
                key={task.id}
                onPress={() =>
                  setSelected(current =>
                    checked ? current.filter(id => id !== task.id) : [...current, task.id],
                  )
                }
              >
                <View
                  style={[
                    kaizenStyles.row,
                    {
                      borderBottomColor: colors.borderColor,
                      backgroundColor: checked ? c.surfaceSelected : 'transparent',
                    },
                  ]}
                >
                  <View style={kaizenStyles.rowText}>
                    <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{task.title}</Text>
                    <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                      {task.outputDescription}
                    </Text>
                  </View>
                  {checked ? (
                    <CompleteIcon size={22} state={brandIconState(isDark, true)} accessibilityLabel="Selected" />
                  ) : (
                    <AddIcon size={22} color={colors.textTertiary} accessibilityLabel="Add" />
                  )}
                </View>
              </Pressable>
            );
          })}
        </Section>
      ))}
      <Section title="Custom actions" testID="kaizen-section-custom-actions">
        <View style={styles.customBody}>
          <TextInput
            value={customTitle}
            onChangeText={setCustomTitle}
            placeholder="Action title"
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.input,
              { backgroundColor: c.inputFieldBackground, borderColor: c.glassBorder, color: colors.textPrimary },
            ]}
          />
          <TextInput
            value={customOutput}
            onChangeText={setCustomOutput}
            placeholder="Expected output"
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.input,
              { backgroundColor: c.inputFieldBackground, borderColor: c.glassBorder, color: colors.textPrimary },
            ]}
          />
          <Button title="Add custom action" variant="outline" disabled={!customTitle.trim()} onPress={addCustom} />
          {customTasks.map(task => (
            <View key={task.title} style={[styles.customChip, { backgroundColor: c.surfaceSelected }]}>
              <CompleteIcon size={18} state={brandIconState(isDark, true)} />
              <Text style={{ color: colors.textPrimary, fontWeight: '500' }}>{task.title}</Text>
            </View>
          ))}
        </View>
      </Section>
      <View style={{ marginTop: Spacing.xl }}>
        <BrandButton
          title={isSetupFlow ? 'Save & continue' : 'Save system'}
          loading={saving}
          onPress={() => void save()}
        />
      </View>
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
    fontSize: Typography.bodyMedium.size,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  customBody: { gap: Spacing.md, padding: Spacing.base },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.smd,
  },
  customChip: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
});
