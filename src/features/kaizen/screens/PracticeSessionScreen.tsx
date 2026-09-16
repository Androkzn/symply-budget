import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@components/ui';
import { BrandButton } from '@features/kaizen/brand';
import { CompleteIcon, InterviewIcon } from '@features/kaizen/brand/iconset';
import { CommandCenterCard } from '@features/kaizen/components/CommandCenter';
import {
  useInvalidateKaizenInterviewQuestions,
  useKaizenInterviewQuestions,
} from '@features/kaizen/hooks/useKaizenInterviewQuestions';
import {
  selectPracticeSessionQuestion,
  selectQuestionById,
} from '@features/kaizen/stores/kaizenSelectors';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { CornerRadius, Spacing, Typography } from '@features/kaizen/theme/designTokens';
import { useRequireAIAccess } from '@hooks/useRequireAIAccess';
import { useAuthStore } from '@stores/authStore';

import { EmptyState, KaizenScreen, Section } from './common';

export function PracticeSessionScreen() {
  const colors = useAppColors();  const appColors = useAppColors();
  const userId = useAuthStore(state => state.user?.id);
  const { questionId } = useLocalSearchParams<{ questionId?: string }>();
  const { data: questions = [] } = useKaizenInterviewQuestions();
  const invalidateQuestions = useInvalidateKaizenInterviewQuestions();
  const submitInterviewAttempt = useKaizenStore(state => state.submitInterviewAttempt);
  const question = selectPracticeSessionQuestion(questions, questionId);
  const [answer, setAnswer] = useState('');
  const [score, setScore] = useState(3);
  const [useAI, setUseAI] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);
  // Practising and self-scoring are core and always available. "Score with AI"
  // is the optional extra: turning it ON without entitlement routes to the
  // unlock hub instead of arming a request the backend will refuse.
  const { ensureCanUseAI } = useRequireAIAccess();
  const toggleUseAI = () => {
    if (useAI) {
      setUseAI(false);
      return;
    }
    if (!ensureCanUseAI()) return;
    setUseAI(true);
  };
  const completedQuestion = selectQuestionById(questions, question?.id ?? '');
  const submit = async () => {
    if (!question || !answer.trim()) return;
    setSaving(true);
    try {
      await submitInterviewAttempt(question.id, answer.trim(), score, { useAI });
      if (userId) {
        await invalidateQuestions(userId);
      }
      setCompleted(true);
    } catch {
      // Stay on the composer when save fails.
    } finally {
      setSaving(false);
    }
  };
  if (!question) return <KaizenScreen title="Practice" subtitle="Practice a question when you are ready."><Section title="Questions"><EmptyState>No interview questions are available.</EmptyState></Section></KaizenScreen>;
  const progress = completed ? 1 : answer.trim() ? 0.6 : 0.2;
  return <KaizenScreen title="Practice" subtitle={question.question_bank}>
    <View style={styles.progressBlock}>
      <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>SESSION PROGRESS</Text>
      <View style={[styles.progressTrack, { backgroundColor: appColors.pillBackground }]}>
        <LinearGradient
          colors={appColors.gradientAction.colors as [string, string, ...string[]]}
          locations={appColors.gradientAction.locations as [number, number, ...number[]]}
          start={appColors.gradientAction.start}
          end={appColors.gradientAction.end}
          style={[styles.progressFill, { width: `${progress * 100}%` }]}
        />
      </View>
    </View>

    <CommandCenterCard tint={colors.primary}>
      <View style={styles.questionHeader}>
        <InterviewIcon size={24} color={colors.primary} />
        <Text style={[styles.questionEyebrow, { color: colors.textSecondary }]}>{question.question_bank}</Text>
      </View>
      <Text style={[styles.prompt, { color: colors.textPrimary }]}>{question.prompt}</Text>
    </CommandCenterCard>

    {completed ? <Section title="Saved"><View style={styles.content}>
      <View style={styles.savedHeader}>
        <CompleteIcon size={24} color={colors.success} />
        <Text style={{ color: colors.textPrimary, flex: 1 }}>Your response was saved with a {score}/5 self-score.</Text>
      </View>
      <Text style={{ color: colors.textSecondary }}>Next review: {completedQuestion?.due_at ? new Date(completedQuestion.due_at).toLocaleString() : 'calculating'}</Text>
      <Button title="View attempt history" variant="outline" onPress={() => router.push(`/kaizen/attempt-history?questionId=${question.id}`)} />
      <BrandButton title="Practice next due question" onPress={() => { setAnswer(''); setCompleted(false); router.replace('/kaizen/banks'); }} />
    </View></Section> : <>
      <Section title="Your answer"><View style={styles.content}><TextInput multiline value={answer} onChangeText={setAnswer} placeholder="Write or paste your answer…" placeholderTextColor={colors.textSecondary} style={[styles.answer, { color: colors.textPrimary, borderColor: appColors.glassBorder, backgroundColor: appColors.inputFieldBackground }]} /></View></Section>
      <Section title="Self-score"><View style={styles.content}>
        <View style={styles.scores}>{[1, 2, 3, 4, 5].map(value => {
          const active = value === score;
          return (
            <Pressable key={value} style={styles.scoreWrap} onPress={() => setScore(value)}>
              {active ? (
                <LinearGradient
                  colors={appColors.gradientAction.colors as [string, string, ...string[]]}
                  locations={appColors.gradientAction.locations as [number, number, ...number[]]}
                  start={appColors.gradientAction.start}
                  end={appColors.gradientAction.end}
                  style={styles.score}
                >
                  <Text style={styles.scoreTextActive}>{value}</Text>
                </LinearGradient>
              ) : (
                <View style={[styles.score, { backgroundColor: appColors.pillBackground }]}>
                  <Text style={[styles.scoreText, { color: colors.textPrimary }]}>{value}</Text>
                </View>
              )}
            </Pressable>
          );
        })}</View>
        <Pressable testID="kaizen-practice-score-with-ai" style={[styles.aiToggle, { backgroundColor: useAI ? appColors.surfaceSelected : appColors.pillBackground }]} onPress={toggleUseAI}>
          {useAI ? <CompleteIcon size={18} color={colors.primary} /> : null}
          <Text style={{ color: useAI ? colors.primary : colors.textSecondary, fontWeight: '700' }}>Score with AI</Text>
        </Pressable>
        <BrandButton title="Submit response" loading={saving} disabled={!answer.trim()} onPress={() => void submit()} />
      </View></Section>
    </>}
  </KaizenScreen>;
}
const styles = StyleSheet.create({
  progressBlock: { gap: Spacing.sm, marginTop: Spacing.sm },
  progressLabel: { fontSize: Typography.caption.size, fontWeight: '700', letterSpacing: 0.4, marginLeft: Spacing.xs, textTransform: 'uppercase' },
  progressTrack: { height: 8, borderRadius: CornerRadius.full, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: CornerRadius.full },
  questionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.smd },
  questionEyebrow: { fontSize: Typography.caption.size, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  content: { gap: 16, padding: 16 },
  prompt: { fontSize: 18, lineHeight: 27, fontWeight: '600' },
  savedHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  answer: { borderWidth: 1, borderRadius: 10, minHeight: 150, padding: 12, textAlignVertical: 'top' },
  scores: { flexDirection: 'row', gap: 8 },
  scoreWrap: { borderRadius: 22 },
  score: { alignItems: 'center', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  scoreText: { fontWeight: '700' },
  scoreTextActive: { color: '#fff', fontWeight: '700' },
  aiToggle: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 44, borderRadius: CornerRadius.full, paddingHorizontal: Spacing.base },
});
