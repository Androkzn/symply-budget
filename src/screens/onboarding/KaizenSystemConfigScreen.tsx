import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRouter } from 'expo-router';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { OnboardingStepScreen } from '@components/onboarding';
import { Button, Typography } from '@components/ui';
import { useTheme } from '@contexts/ThemeContext';
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
import {
  estimateOnboardingStepTotal,
  markSystemConfigured,
  readConfiguredSystems,
  readSetupQueue,
} from '@features/kaizen/services/setupFlow';
import { SYSTEM_TASK_CATALOG } from '@features/kaizen/services/taskCatalog';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import type { OnboardingStackParamList } from '@navigation/types';
import { useAuthStore } from '@stores/authStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';

type NavigationProp = NativeStackNavigationProp<OnboardingStackParamList, 'KaizenSystemConfig'>;
type RouteProps = RouteProp<OnboardingStackParamList, 'KaizenSystemConfig'>;

const SYSTEM_ICONS: Record<string, typeof HealthIcon> = {
  [LifeSystem.Health]: HealthIcon,
  [LifeSystem.Career]: CareerSystemIcon,
  [LifeSystem.Mental]: MentalIcon,
  [LifeSystem.PersonalLife]: RelationshipsIcon,
  [LifeSystem.Administration]: AdminIcon,
  [LifeSystem.Learning]: LearningIcon,
  [LifeSystem.Finance]: FinanceIcon,
};

/**
 * Per-system task-catalog picker, looped once for every system selected on
 * `KaizenSystemsSetupScreen` — always in required-setup mode (the standalone,
 * editable-later version of this screen is `SystemConfigScreen`, reached
 * from Settings/system-detail, which this does not replace). On save, three
 * ways forward mirror `setupFlow.ts`'s `markSystemConfigured`: push the next
 * queued system, hand off to the Career deep-setup wizard, or — for a
 * selection with no Career in it — finish account onboarding right here.
 */
export function KaizenSystemConfigScreen() {
  const colors = useAppColors();
  const { isDark } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const router = useRouter();
  const { system } = route.params;
  const completeOnboarding = useAuthStore((state) => state.completeOnboarding);
  const finishOnboarding = useKaizenStore((state) => state.finishOnboarding);
  const materializeSystemTasks = useKaizenStore((state) => state.materializeSystemTasks);

  const templates = useMemo(
    () => SYSTEM_TASK_CATALOG[system].flatMap((area) => area.tasks),
    [system],
  );
  const [selected, setSelected] = useState(() =>
    templates.filter((task) => task.suggestedDailyCore).map((task) => task.id),
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
  const [saving, setSaving] = useState(false);

  const addCustom = () => {
    const title = customTitle.trim();
    if (!title) return;
    setCustomTasks((current) => [
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

  const save = async () => {
    setSaving(true);
    try {
      await materializeSystemTasks(system, selected, customTasks);
      const result = markSystemConfigured(system);
      if (result.kind === 'next-system') {
        navigation.push('KaizenSystemConfig', { system: result.system as LifeSystem });
        return;
      }
      if (result.kind === 'career-setup') {
        navigation.navigate('KaizenCareerSetup');
        return;
      }
      // No Career in this selection — onboarding finishes here, not on the
      // Career wizard, so both onboarding flags need flipping in this branch.
      await finishOnboarding();
      completeOnboarding();
      router.replace('/');
    } finally {
      setSaving(false);
    }
  };

  const systemLabel = system.replace(/([A-Z])/g, ' $1').replace(/^./, (ch) => ch.toUpperCase()).trim();
  /* istanbul ignore next -- SYSTEM_ICONS maps every LifeSystem value and `system` always comes from a LifeSystem-typed route param, so the CareerSystemIcon fallback is unreachable */
  const SystemIcon = SYSTEM_ICONS[system] ?? CareerSystemIcon;

  return (
    <OnboardingStepScreen
      testID="onboarding-kaizen-system-config-screen"
      title={`Configure ${systemLabel}`}
      subtitle="Choose catalog actions or add your own. You will configure each selected system."
      currentStep={3 + readConfiguredSystems().length}
      totalSteps={estimateOnboardingStepTotal(readSetupQueue())}
      stepLabel={systemLabel}
      onBack={() => navigation.goBack()}
      onContinue={() => void save()}
      continueBusy={saving}
      continueLabel="Save & continue"
    >
      <View style={[styles.systemHeader, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
        <SystemIcon size={26} state={brandIconState(isDark, true)} />
        <Typography variant="headline" weight="bold" color={colors.textPrimary} style={styles.systemHeaderLabel}>
          {systemLabel}
        </Typography>
      </View>

      {SYSTEM_TASK_CATALOG[system].map((area) => (
        <View key={area.id} style={styles.section}>
          <Typography variant="footnote" weight="bold" color={colors.textSecondary} style={styles.sectionTitle}>
            {area.title.toUpperCase()}
          </Typography>
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
            {area.tasks.map((task) => {
              const checked = selected.includes(task.id);
              return (
                <Pressable
                  key={task.id}
                  testID={`onboarding-kaizen-system-config-task-${task.id}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  onPress={() =>
                    setSelected((current) =>
                      checked ? current.filter((id) => id !== task.id) : [...current, task.id],
                    )
                  }
                >
                  <View
                    style={[
                      styles.row,
                      {
                        borderBottomColor: colors.borderColor,
                        backgroundColor: checked ? `${colors.primary}1F` : 'transparent',
                      },
                    ]}
                  >
                    <View style={styles.rowText}>
                      <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                        {task.title}
                      </Typography>
                      <Typography variant="footnote" color={colors.textSecondary} style={styles.detail}>
                        {task.outputDescription}
                      </Typography>
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
          </View>
        </View>
      ))}

      <View style={styles.section} testID="onboarding-kaizen-system-config-custom-actions">
        <Typography variant="footnote" weight="bold" color={colors.textSecondary} style={styles.sectionTitle}>
          CUSTOM ACTIONS
        </Typography>
        <View style={styles.customBody}>
          <TextInput
            value={customTitle}
            onChangeText={setCustomTitle}
            placeholder="Action title"
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.input,
              { backgroundColor: colors.inputFieldBackground, borderColor: colors.borderColor, color: colors.textPrimary },
            ]}
          />
          <TextInput
            value={customOutput}
            onChangeText={setCustomOutput}
            placeholder="Expected output"
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.input,
              { backgroundColor: colors.inputFieldBackground, borderColor: colors.borderColor, color: colors.textPrimary },
            ]}
          />
          <Button title="Add custom action" variant="outline" disabled={!customTitle.trim()} onPress={addCustom} />
          {customTasks.map((task) => (
            <View key={task.title} style={[styles.customChip, { backgroundColor: `${colors.primary}1F` }]}>
              <CompleteIcon size={18} state={brandIconState(isDark, true)} />
              <Typography variant="body" weight="medium" color={colors.textPrimary}>
                {task.title}
              </Typography>
            </View>
          ))}
        </View>
      </View>
    </OnboardingStepScreen>
  );
}

const styles = StyleSheet.create({
  systemHeader: {
    alignItems: 'center',
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.smd,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
  },
  systemHeaderLabel: {
    textTransform: 'capitalize',
  },
  section: { gap: Spacing.sm },
  sectionTitle: {
    letterSpacing: 0.4,
  },
  sectionCard: {
    borderRadius: CornerRadius.listItem,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 58,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.smd,
  },
  rowText: { flex: 1 },
  detail: { marginTop: 3 },
  customBody: { gap: Spacing.md },
  input: {
    borderRadius: CornerRadius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.smd,
  },
  customChip: {
    alignItems: 'center',
    borderRadius: CornerRadius.sm,
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
});
