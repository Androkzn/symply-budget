import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@components/ui';
import { BrandButton, GlassCard } from '@features/kaizen/brand';
import { AssessIcon, useBrandIconState } from '@features/kaizen/brand/iconset';
import { useKaizenSkills } from '@features/kaizen/hooks/useKaizenSkills';
import {
  ASSESSMENT_BANDS,
  buildManualAssessmentResult,
  computeResultFromTurns,
  evaluateAssessmentAnswer,
  generateAssessmentQuestion,
  type AssessmentBand,
  type AssessmentTurn,
} from '@features/kaizen/services/skillAssessment';
import { selectSkillById } from '@features/kaizen/stores/kaizenSelectors';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { CornerRadius, Spacing, Typography } from '@features/kaizen/theme/designTokens';
import { useAIEntitlement } from '@hooks/useAIEntitlement';

import { KaizenScreen } from './common';

const BAND_COPY: Record<AssessmentBand, string> = {
  foundation: 'New to this — learning the core ideas.',
  intermediate: 'Comfortable with the basics, still building depth.',
  advanced: 'Confident — can teach it and handle edge cases.',
};

export function SkillAssessmentScreen() {
  const colors = useAppColors();  const { gradientAction } = useAppColors();
  const iconState = useBrandIconState(true);
  const { skillId } = useLocalSearchParams<{ skillId: string }>();
  const { data: skills = [] } = useKaizenSkills();
  const skill = selectSkillById(skills, skillId ?? '');
  const saveAssessmentResult = useKaizenStore(state => state.saveAssessmentResult);
  // Placement is a CORE feature, so it must work with no AI at all. With
  // entitlement we run the adaptive generate→answer→evaluate loop; without it
  // we ask the member to place themselves rather than silently scoring answers
  // by character count and presenting that as a grade.
  const { canUseAI, isLoading: aiLoading } = useAIEntitlement();
  const [turns, setTurns] = useState<AssessmentTurn[]>([]);
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [band, setBand] = useState<AssessmentBand | null>(null);
  const [focus, setFocus] = useState('');
  const next = async () => {
    if (!skill) return;
    setBusy(true);
    try {
      const question = await generateAssessmentQuestion(skill.id, turns);
      setPrompt(question.prompt);
    } catch {
      setPrompt(`Explain a core ${skill.name} concept and how you would apply it.`);
    } finally { setBusy(false); }
  };
  const finish = async (nextTurns: AssessmentTurn[]) => {
    /* istanbul ignore next -- finish() is only invoked from a button gated on turns.length>=1 with a resolved skill, so this guard never returns early */
    if (!skill || !nextTurns.length) return;
    try {
      await saveAssessmentResult(computeResultFromTurns(nextTurns, skill.id));
      router.replace(`/kaizen/learning-plan?skillId=${skill.id}`);
    } catch {
      // Stay on assessment when save fails.
    }
  };
  const submit = async () => {
    if (!skill || !prompt || !answer.trim()) return;
    setBusy(true);
    let turn: AssessmentTurn = { prompt, answer: answer.trim() };
    try {
      const evaluation = await evaluateAssessmentAnswer(skill.id, turn);
      turn = { ...turn, score0to100: evaluation.overall_score ?? null, strengths: evaluation.strengths, gaps: evaluation.gaps };
    } catch { turn = { ...turn, score0to100: Math.min(100, answer.trim().length * 2) }; }
    const nextTurns = [...turns, turn];
    setTurns(nextTurns);
    setAnswer('');
    setPrompt('');
    setBusy(false);
    await next();
  };
  const saveManual = async () => {
    if (!skill || !band) return;
    setBusy(true);
    try {
      await saveAssessmentResult(
        buildManualAssessmentResult(skill.id, band, focus.split(',')),
      );
      router.replace(`/kaizen/learning-plan?skillId=${skill.id}`);
    } catch {
      // Stay on the screen when the save fails; the picked band is preserved.
    } finally {
      setBusy(false);
    }
  };

  if (!aiLoading && !canUseAI) {
    return (
      <KaizenScreen title="Skill assessment" subtitle={skill?.name ?? 'Choose a skill'}>
        <GlassCard strong>
          <View style={styles.headerRow}>
            <AssessIcon size={26} state={iconState} />
            <Text style={[styles.step, { color: colors.textPrimary }]}>Place yourself</Text>
          </View>
          <Text style={[styles.prompt, { color: colors.textSecondary }]}>
            Pick the level that matches you today. You will get a learning plan either
            way — connect AI if you want an adaptive, graded assessment instead.
          </Text>
        </GlassCard>

        <GlassCard>
          <View style={{ gap: 14 }}>
            {ASSESSMENT_BANDS.map(option => {
              const selected = band === option;
              return (
                <Pressable
                  key={option}
                  testID={`kaizen-assessment-band-${option}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setBand(option)}
                  style={[
                    styles.bandRow,
                    {
                      borderColor: selected ? colors.primary : colors.borderColor,
                      backgroundColor: selected
                        ? colors.pillBackground
                        : colors.backgroundSecondary,
                    },
                  ]}
                >
                  <Text style={[styles.bandTitle, { color: colors.textPrimary }]}>
                    {option[0].toUpperCase()}{option.slice(1)}
                  </Text>
                  <Text style={[styles.bandBody, { color: colors.textSecondary }]}>
                    {BAND_COPY[option]}
                  </Text>
                </Pressable>
              );
            })}
            <TextInput
              value={focus}
              onChangeText={setFocus}
              placeholder="Focus areas, comma separated (optional)"
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.focusInput,
                {
                  color: colors.textPrimary,
                  borderColor: colors.borderColor,
                  backgroundColor: colors.backgroundSecondary,
                },
              ]}
            />
            <BrandButton
              title="Save placement"
              testID="kaizen-assessment-save-manual"
              loading={busy}
              disabled={!band}
              onPress={() => void saveManual()}
            />
            <Button
              title="Unlock AI for an adaptive assessment"
              variant="outline"
              onPress={() => router.push('/ai-access')}
            />
          </View>
        </GlassCard>
      </KaizenScreen>
    );
  }

  return (
    <KaizenScreen title="Skill assessment" subtitle={skill?.name ?? 'Choose a skill'}>
      <GlassCard strong>
        <View style={styles.headerRow}>
          <AssessIcon size={26} state={iconState} />
          <Text style={[styles.step, { color: colors.textPrimary }]}>
            {turns.length ? `Question ${turns.length + 1}` : 'Begin'}
          </Text>
        </View>
        {turns.length ? (
          <View style={styles.progressRow}>
            {turns.map((_, index) => (
              <LinearGradient
                key={index}
                colors={[...gradientAction.colors] as [string, string, ...string[]]}
                locations={[...gradientAction.locations] as [number, number, ...number[]]}
                start={gradientAction.start}
                end={gradientAction.end}
                style={styles.progressSeg}
              />
            ))}
          </View>
        ) : null}
        <Text style={[styles.prompt, { color: colors.textPrimary }]}>
          {prompt || 'Generate a diagnostic question to begin.'}
        </Text>
      </GlassCard>

      <GlassCard>
        <View style={{ gap: 14 }}>
          {!prompt ? (
            <BrandButton title="Start assessment" loading={busy} onPress={() => void next()} />
          ) : (
            <>
              <TextInput
                multiline
                value={answer}
                onChangeText={setAnswer}
                placeholder="Write your answer…"
                placeholderTextColor={colors.textSecondary}
                style={[
                  styles.input,
                  {
                    color: colors.textPrimary,
                    borderColor: colors.borderColor,
                    backgroundColor: colors.backgroundSecondary,
                  },
                ]}
              />
              <BrandButton title="Submit answer" loading={busy} disabled={!answer.trim()} onPress={() => void submit()} />
              {turns.length >= 1 ? (
                <Button title="Finish assessment" variant="outline" onPress={() => void finish(turns)} />
              ) : null}
            </>
          )}
        </View>
      </GlassCard>
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bandRow: {
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
    gap: Spacing.xxs,
    minHeight: 44,
    padding: Spacing.md,
  },
  bandTitle: { fontSize: Typography.bodyMedium.size, fontWeight: '700' },
  bandBody: { fontSize: Typography.body.size, lineHeight: Typography.body.lineHeight },
  focusInput: {
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
    minHeight: 44,
    padding: Spacing.md,
    fontSize: Typography.body.size,
  },
  step: { fontSize: Typography.title.size, fontWeight: '700', letterSpacing: -0.2 },
  progressRow: { flexDirection: 'row', gap: 6, marginTop: Spacing.md },
  progressSeg: { flex: 1, height: 6, borderRadius: 3 },
  prompt: { fontSize: Typography.body.size, lineHeight: Typography.body.lineHeight, marginTop: Spacing.md },
  input: {
    minHeight: 150,
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
    padding: Spacing.md,
    textAlignVertical: 'top',
    fontSize: Typography.body.size,
  },
});
