import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRouter } from 'expo-router';
import { useNavigation } from 'expo-router/react-navigation';
import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { OnboardingStepScreen } from '@components/onboarding';
import { Button, Typography } from '@components/ui';
import {
  CAREER_SETUP_GOALS,
  CAREER_SETUP_STEP_TITLES,
  useCareerSetupWizard,
} from '@features/kaizen/hooks/useCareerSetupWizard';
import {
  estimateOnboardingStepTotal,
  finishSetupAfterCareer,
  readSetupQueue,
} from '@features/kaizen/services/setupFlow';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { KaizenImportUploadSection } from '@features/kaizen/upload/KaizenImportUploadSection';
import type { OnboardingStackParamList } from '@navigation/types';
import { useAuthStore } from '@stores/authStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';

type NavigationProp = NativeStackNavigationProp<OnboardingStackParamList, 'KaizenCareerSetup'>;

/**
 * Account-onboarding wrapper around the same 5-step career wizard
 * (`useCareerSetupWizard`) `CareerSetupScreen` uses outside onboarding — only
 * the chrome (this shell) and the ending differ. Reached only when Career
 * was among the selected systems; it's always the last onboarding screen, so
 * its own last sub-step finishes account onboarding rather than navigating
 * anywhere else.
 */
export function KaizenCareerSetupScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<NavigationProp>();
  const router = useRouter();
  const completeOnboarding = useAuthStore((state) => state.completeOnboarding);
  const finishOnboarding = useKaizenStore((state) => state.finishOnboarding);

  const {
    step,
    back,
    next,
    canContinue,
    busy,
    saving,
    roles,
    setRoles,
    selectedGoals,
    toggleGoal,
    resumeText,
    setResumeText,
    hasResume,
    onResumeImported,
    skill,
    setSkill,
    questions,
    setQuestions,
    manualPrompt,
    setManualPrompt,
    technicalCount,
    behavioralCount,
    questionsSatisfied,
    importPastedQuestions,
    addManual,
  } = useCareerSetupWizard({
    onComplete: async () => {
      finishSetupAfterCareer();
      await finishOnboarding();
      completeOnboarding();
      router.replace('/');
    },
  });

  const isLastStep = step === CAREER_SETUP_STEP_TITLES.length - 1;
  const totalSteps = estimateOnboardingStepTotal(readSetupQueue());
  const inputStyle = [
    styles.input,
    { color: colors.textPrimary, borderColor: colors.borderColor, backgroundColor: colors.backgroundSecondary },
  ];
  const textareaStyle = [
    styles.textarea,
    { color: colors.textPrimary, borderColor: colors.borderColor, backgroundColor: colors.backgroundSecondary },
  ];

  return (
    <OnboardingStepScreen
      testID="onboarding-kaizen-career-setup-screen"
      title={CAREER_SETUP_STEP_TITLES[step]}
      currentStep={3 + readSetupQueue().length + step}
      totalSteps={totalSteps}
      stepLabel={CAREER_SETUP_STEP_TITLES[step]}
      onBack={() => (step === 0 ? navigation.goBack() : back())}
      onContinue={() => void next()}
      continueBusy={busy || saving}
      continueDisabled={!canContinue}
      continueLabel={isLastStep ? 'Finish' : 'Continue'}
      showForwardChevron={!isLastStep}
    >
      {step === 0 && (
        <View style={styles.stack}>
          <TextInput
            value={roles}
            onChangeText={setRoles}
            placeholder="Target roles, comma-separated"
            placeholderTextColor={colors.textSecondary}
            style={inputStyle}
          />
          <View style={styles.chips}>
            {CAREER_SETUP_GOALS.map((goal) => (
              <Button
                key={goal}
                title={selectedGoals.includes(goal) ? `✓ ${goal}` : goal}
                variant={selectedGoals.includes(goal) ? 'primary' : 'outline'}
                onPress={() => toggleGoal(goal)}
              />
            ))}
          </View>
        </View>
      )}

      {step === 1 && (
        <View style={styles.stack}>
          <Typography variant="body" color={colors.textSecondary}>
            Add at least one resume to tailor your plan. Import a file or paste the text — you can
            review and edit it below before continuing.
          </Typography>
          <KaizenImportUploadSection purpose="resume" navigateAfterImport={false} onImported={onResumeImported} />
          <TextInput
            multiline
            value={resumeText}
            onChangeText={setResumeText}
            placeholder="Paste resume text"
            placeholderTextColor={colors.textSecondary}
            style={textareaStyle}
          />
          {!hasResume && (
            <Typography variant="caption1" color={colors.textSecondary} style={styles.hint}>
              A resume is required to continue.
            </Typography>
          )}
        </View>
      )}

      {step === 2 && (
        <View style={styles.stack}>
          <Typography variant="body" color={colors.textSecondary}>
            Add a skill now; you can add more later.
          </Typography>
          <TextInput
            value={skill}
            onChangeText={setSkill}
            placeholder="e.g. System design"
            placeholderTextColor={colors.textSecondary}
            style={inputStyle}
          />
        </View>
      )}

      {step === 3 && (
        <View style={styles.stack}>
          <Typography variant="body" color={colors.textSecondary}>
            Add at least one technical and one behavioural question. Import or paste a list (we sort
            each into the right bank), then top up whichever bank is still empty.
          </Typography>
          <View style={styles.counts}>
            <Typography
              variant="footnote"
              weight="bold"
              color={technicalCount ? colors.primary : colors.textSecondary}
              style={[styles.countPill, { borderColor: colors.borderColor }]}
            >
              Technical: {technicalCount}
            </Typography>
            <Typography
              variant="footnote"
              weight="bold"
              color={behavioralCount ? colors.primary : colors.textSecondary}
              style={[styles.countPill, { borderColor: colors.borderColor }]}
            >
              Behavioural: {behavioralCount}
            </Typography>
          </View>

          <KaizenImportUploadSection purpose="questions" navigateAfterImport={false} />

          <TextInput
            multiline
            value={questions}
            onChangeText={setQuestions}
            placeholder="Paste one question per line"
            placeholderTextColor={colors.textSecondary}
            style={textareaStyle}
          />
          <View style={styles.chips}>
            <Button title="Add to banks" variant="outline" loading={busy} onPress={() => void importPastedQuestions()} />
          </View>

          <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />
          <TextInput
            value={manualPrompt}
            onChangeText={setManualPrompt}
            placeholder="Write a single question"
            placeholderTextColor={colors.textSecondary}
            style={inputStyle}
          />
          <View style={styles.chips}>
            <Button title="Add technical" variant="outline" onPress={() => void addManual('technical')} />
            <Button title="Add behavioural" variant="outline" onPress={() => void addManual('behavioral')} />
          </View>
          {!questionsSatisfied && (
            <Typography variant="caption1" color={colors.textSecondary} style={styles.hint}>
              Need at least one question in each bank to continue.
            </Typography>
          )}
        </View>
      )}

      {step === 4 && (
        <Typography variant="body" color={colors.textSecondary}>
          Your career workspace is ready. You can adjust roles, skills, resume, and questions at any
          time.
        </Typography>
      )}
    </OnboardingStepScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.base },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  counts: { flexDirection: 'row', gap: Spacing.sm },
  countPill: {
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  input: {
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
  },
  textarea: {
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
    minHeight: 150,
    padding: Spacing.base,
    textAlignVertical: 'top',
  },
  divider: { height: 1 },
  hint: { fontStyle: 'italic' },
});
