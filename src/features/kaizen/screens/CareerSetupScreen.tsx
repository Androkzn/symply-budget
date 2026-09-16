import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@components/ui';
import { BrandButton, GlassCard } from '@features/kaizen/brand';
import {
  CAREER_SETUP_GOALS as goals,
  CAREER_SETUP_STEP_TITLES as STEP_TITLES,
  useCareerSetupWizard,
} from '@features/kaizen/hooks/useCareerSetupWizard';
import { finishSetupAfterCareer } from '@features/kaizen/services/setupFlow';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { CornerRadius, Spacing, Typography } from '@features/kaizen/theme/designTokens';
import { KaizenImportUploadSection } from '@features/kaizen/upload/KaizenImportUploadSection';
import { useAppColors } from '@theme';

import { KaizenScreen } from './common';

export function CareerSetupScreen() {
  const colors = useAppColors();
  const { setup } = useLocalSearchParams<{ setup?: string }>();
  const isSetupFlow = setup === '1';
  const finishOnboarding = useKaizenStore(state => state.finishOnboarding);

  const {
    step,
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
      if (isSetupFlow) {
        finishSetupAfterCareer();
        await finishOnboarding();
        router.replace('/');
      } else {
        router.replace('/kaizen-career');
      }
    },
  });

  const title = STEP_TITLES[step];
  const inputStyle = [
    styles.input,
    {
      color: colors.textPrimary,
      borderColor: colors.borderColor,
      backgroundColor: colors.backgroundSecondary,
    },
  ];
  const textareaStyle = [
    styles.textarea,
    {
      color: colors.textPrimary,
      borderColor: colors.borderColor,
      backgroundColor: colors.backgroundSecondary,
    },
  ];

  return (
    <KaizenScreen
      title="Career setup"
      subtitle={`Step ${step + 1} of ${STEP_TITLES.length} · ${title}`}
    >
      <GlassCard>
        <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>{title}</Text>
        <View style={styles.form}>
          {step === 0 && (
            <>
              <TextInput
                value={roles}
                onChangeText={setRoles}
                placeholder="Target roles, comma-separated"
                placeholderTextColor={colors.textSecondary}
                style={inputStyle}
              />
              <View style={styles.chips}>
                {goals.map(goal => (
                  <Button
                    key={goal}
                    title={selectedGoals.includes(goal) ? `✓ ${goal}` : goal}
                    variant={selectedGoals.includes(goal) ? 'primary' : 'outline'}
                    onPress={() => toggleGoal(goal)}
                  />
                ))}
              </View>
            </>
          )}

          {step === 1 && (
            <>
              <Text style={{ color: colors.textSecondary }}>
                Add at least one resume to tailor your plan. Import a file or paste the text — you
                can review and edit it below before continuing.
              </Text>
              <KaizenImportUploadSection
                purpose="resume"
                navigateAfterImport={false}
                onImported={onResumeImported}
              />
              <TextInput
                multiline
                value={resumeText}
                onChangeText={setResumeText}
                placeholder="Paste resume text"
                placeholderTextColor={colors.textSecondary}
                style={textareaStyle}
              />
              {!hasResume && (
                <Text style={[styles.hint, { color: colors.textSecondary }]}>
                  A resume is required to continue.
                </Text>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <Text style={{ color: colors.textSecondary }}>
                Add a skill now; you can add more later.
              </Text>
              <TextInput
                value={skill}
                onChangeText={setSkill}
                placeholder="e.g. System design"
                placeholderTextColor={colors.textSecondary}
                style={inputStyle}
              />
            </>
          )}

          {step === 3 && (
            <>
              <Text style={{ color: colors.textSecondary }}>
                Add at least one technical and one behavioural question. Import or paste a list (we
                sort each into the right bank), then top up whichever bank is still empty.
              </Text>
              <View style={styles.counts}>
                <Text
                  style={[
                    styles.countPill,
                    {
                      color: technicalCount ? colors.primary : colors.textSecondary,
                      borderColor: colors.borderColor,
                    },
                  ]}
                >
                  Technical: {technicalCount}
                </Text>
                <Text
                  style={[
                    styles.countPill,
                    {
                      color: behavioralCount ? colors.primary : colors.textSecondary,
                      borderColor: colors.borderColor,
                    },
                  ]}
                >
                  Behavioural: {behavioralCount}
                </Text>
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
                <Button
                  title="Add to banks"
                  variant="outline"
                  loading={busy}
                  onPress={() => void importPastedQuestions()}
                />
              </View>

              <View style={styles.divider} />
              <TextInput
                value={manualPrompt}
                onChangeText={setManualPrompt}
                placeholder="Write a single question"
                placeholderTextColor={colors.textSecondary}
                style={inputStyle}
              />
              <View style={styles.chips}>
                <Button
                  title="Add technical"
                  variant="outline"
                  onPress={() => void addManual('technical')}
                />
                <Button
                  title="Add behavioural"
                  variant="outline"
                  onPress={() => void addManual('behavioral')}
                />
              </View>
              {!questionsSatisfied && (
                <Text style={[styles.hint, { color: colors.textSecondary }]}>
                  Need at least one question in each bank to continue.
                </Text>
              )}
            </>
          )}

          {step === 4 && (
            <Text style={{ color: colors.textSecondary }}>
              Your career workspace is ready. You can adjust roles, skills, resume, and questions at
              any time.
            </Text>
          )}

          <BrandButton
            title={step === STEP_TITLES.length - 1 ? 'Finish setup' : 'Continue'}
            loading={saving || busy}
            disabled={!canContinue}
            testID="kaizen-career-setup-continue"
            onPress={() => void next()}
          />
        </View>
      </GlassCard>
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  stepTitle: {
    fontSize: Typography.title.size,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: Spacing.base,
  },
  form: { gap: Spacing.base },
  input: {
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
    fontSize: Typography.body.size,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
  },
  textarea: {
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
    minHeight: 150,
    padding: Spacing.base,
    textAlignVertical: 'top',
    fontSize: Typography.body.size,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  counts: { flexDirection: 'row', gap: Spacing.sm },
  countPill: {
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
    fontSize: Typography.label.size,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  divider: { height: 1, backgroundColor: 'rgba(127,127,127,0.2)', marginVertical: Spacing.xs },
  hint: { fontSize: Typography.caption.size, fontStyle: 'italic' },
});
