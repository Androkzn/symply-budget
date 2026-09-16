import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { CalendarIcon, CompleteIcon, useBrandIconState } from '@features/kaizen/brand/iconset';
import { useKaizenAttemptsForQuestion } from '@features/kaizen/hooks/useKaizenAttempts';
import { useKaizenInterviewQuestions } from '@features/kaizen/hooks/useKaizenInterviewQuestions';
import { selectQuestionById } from '@features/kaizen/stores/kaizenSelectors';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { Spacing, Typography } from '@features/kaizen/theme/designTokens';

import { EmptyState, KaizenScreen, Section } from './common';

export function AttemptHistoryScreen() {
  const colors = useAppColors();
  const { pillBackground } = useAppColors();
  const dateIcon = useBrandIconState(false);
  const scoreIcon = useBrandIconState(true);
  const { questionId } = useLocalSearchParams<{ questionId: string }>();
  const { data: questions = [] } = useKaizenInterviewQuestions();
  const question = selectQuestionById(questions, questionId);
  const { attempts } = useKaizenAttemptsForQuestion(questionId);

  return (
    <KaizenScreen title="Attempt history" subtitle={question?.prompt ?? ''}>
      <Section title="Past responses">
        {attempts.length ? (
          attempts.map((attempt, index) => (
            <View
              key={attempt.id}
              style={[
                styles.attempt,
                index > 0 && {
                  borderTopColor: colors.borderColor,
                  borderTopWidth: StyleSheet.hairlineWidth,
                },
              ]}
            >
              <View style={styles.header}>
                <CalendarIcon size={20} state={dateIcon} />
                <Text style={[styles.date, { color: colors.textPrimary }]}>
                  {new Date(attempt.attempted_at).toLocaleDateString()}
                </Text>
                <View style={[styles.scoreChip, { backgroundColor: pillBackground }]}>
                  <CompleteIcon size={16} state={scoreIcon} />
                  <Text style={[styles.scoreText, { color: colors.success }]}>
                    {attempt.overall_score ?? '—'}/5
                  </Text>
                </View>
              </View>
              <Text style={{ color: colors.textPrimary, lineHeight: 22 }}>
                {attempt.answer_text}
              </Text>
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: Typography.caption.size,
                  lineHeight: 20,
                }}
              >
                {attempt.judge_reasoning}
              </Text>
            </View>
          ))
        ) : (
          <EmptyState>No attempts yet.</EmptyState>
        )}
      </Section>
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  attempt: { gap: Spacing.sm, padding: Spacing.base },
  header: { alignItems: 'center', flexDirection: 'row', gap: Spacing.sm },
  date: { flex: 1, fontSize: Typography.body.size, fontWeight: '600' },
  scoreChip: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.smd,
    paddingVertical: Spacing.xs,
  },
  scoreText: { fontSize: Typography.caption.size, fontWeight: '700' },
});
